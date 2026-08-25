-- Recovery Activation Kit — the first-customer data-to-draft-plan path.
--
-- This extends the canonical connectors -> connector_runs -> ingest_staging
-- contract. Promoted rows land in the existing sites, assets, work_orders,
-- materials, material_stock, craft_capacity, operating_states and
-- production_records tables. Recovery remains a coordination plane and no
-- second work-order, workforce, production, recommendation or approval store
-- is introduced.
--
-- Transport is read-only. Endpoint credentials stay in the Edge Function
-- secret store; this schema records only credential_binding_ref. A dry run
-- never writes canonical or staging rows. The guided plan is created as a
-- draft and must pass the existing approval and release gates.

alter table public.sites
  add column if not exists source_system text,
  add column if not exists external_id text;
create unique index if not exists uq_sites_external
  on public.sites(organization_id,source_system,external_id)
  where external_id is not null;

alter table public.assets
  add column if not exists source_system text,
  add column if not exists external_id text;
create unique index if not exists uq_assets_external
  on public.assets(organization_id,source_system,external_id)
  where external_id is not null;

alter table public.material_stock
  add column if not exists external_id text;
create unique index if not exists uq_material_stock_external
  on public.material_stock(organization_id,source_system,external_id)
  where external_id is not null;

alter table public.craft_capacity
  add column if not exists source_system text,
  add column if not exists external_id text;
create unique index if not exists uq_craft_capacity_external
  on public.craft_capacity(organization_id,source_system,external_id)
  where external_id is not null;

-- One approved mapping per connector/entity. This is configuration and
-- provenance, not a parallel import workflow: run lifecycle and rejects remain
-- in connector_runs and ingest_staging.
create table if not exists public.connector_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null references public.connectors(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'site','asset','work_order','material','material_stock','craft_capacity',
    'operating_state','production_record'
  )),
  source_array_path text not null default '',
  column_mapping jsonb not null default '{}'::jsonb,
  value_mappings jsonb not null default '{}'::jsonb,
  constants jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  basis text not null,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id,entity_type),
  check (jsonb_typeof(column_mapping)='object'),
  check (jsonb_typeof(value_mappings)='object'),
  check (jsonb_typeof(constants)='object'),
  check (source_array_path ~ '^[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$'),
  check (status<>'approved' or (approved_by is not null and approved_at is not null))
);

alter table public.connector_entity_mappings enable row level security;
drop policy if exists connector_entity_mappings_org_read on public.connector_entity_mappings;
create policy connector_entity_mappings_org_read on public.connector_entity_mappings
  for select to authenticated using (organization_id=public.app_current_org());

create or replace function public.recovery_activation_allowed_fields(p_entity_type text)
returns text[] language sql immutable set search_path=public as $$
  select case p_entity_type
    when 'site' then array['external_id','name','code','location']
    when 'asset' then array['external_id','name','site_external_id','tag','asset_class','criticality','status','area','system','manufacturer','model','serial_number']
    when 'work_order' then array['external_id','title','asset_external_id','wo_number','status','priority','work_type','planned_hours','created_at','completed_at','failure_mode','downtime_hours']
    when 'material' then array['external_id','material_code','description','unit_of_measure','category','unit_cost_usd','lead_time_days','criticality','basis']
    when 'material_stock' then array['external_id','material_external_id','site_external_id','qty_on_hand','qty_reserved','qty_on_order','last_counted_at']
    when 'craft_capacity' then array['external_id','site_external_id','craft','weekly_hours','effective_from','basis']
    when 'operating_state' then array['external_id','asset_external_id','state','started_at','ended_at','load_pct','reason_code']
    when 'production_record' then array['external_id','site_external_id','asset_external_id','period_start','period_end','units_produced','unit_of_measure']
    else '{}'::text[] end
$$;

create or replace function public.recovery_activation_required_fields(p_entity_type text)
returns text[] language sql immutable set search_path=public as $$
  select case p_entity_type
    when 'site' then array['external_id','name']
    when 'asset' then array['external_id','name','site_external_id']
    when 'work_order' then array['external_id','title','asset_external_id']
    when 'material' then array['external_id','material_code','description','unit_of_measure','basis']
    when 'material_stock' then array['external_id','material_external_id','site_external_id','qty_on_hand']
    when 'craft_capacity' then array['external_id','site_external_id','craft','weekly_hours','effective_from','basis']
    when 'operating_state' then array['external_id','asset_external_id','state','started_at']
    when 'production_record' then array['external_id','period_start','period_end','units_produced','unit_of_measure']
    else '{}'::text[] end
$$;

revoke all on function public.recovery_activation_allowed_fields(text) from public,anon,authenticated;
revoke all on function public.recovery_activation_required_fields(text) from public,anon,authenticated;

create or replace function public.configure_recovery_activation_source(
  p_key text,
  p_name text,
  p_system_kind text,
  p_endpoint_url text,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text:=nullif(trim(coalesce(p_endpoint_url,'')),'');
  v_ref text:=nullif(trim(coalesce(p_credential_binding_ref,'')),'');
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring a Recovery activation source requires an administrator');
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if p_system_kind not in ('cmms','eam','erp','inventory','data_lake','scheduling','file') then
    return jsonb_build_object('error','unsupported activation source kind');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org and connector_key=trim(p_key)
    and connector_type is distinct from 'recovery_activation') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive activation authority and basis');
  end if;
  if v_endpoint is not null and (
    v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' or
    v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)'
  ) then
    return jsonb_build_object('error','REST endpoints must be credential-free public HTTPS URLs; private/local targets are blocked');
  end if;
  if v_ref is not null and (v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=#]') then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value or query string');
  end if;
  if p_system_kind='file' and (v_endpoint is not null or v_ref is not null or p_expected_interval_minutes is not null) then
    return jsonb_build_object('error','manual file sources do not poll and cannot carry an endpoint or credential binding');
  end if;
  if p_system_kind<>'file' and p_enabled and (
    v_endpoint is null or coalesce(p_expected_interval_minutes,0)<1 or v_ref is null
  ) then
    return jsonb_build_object('error','active REST sources require an HTTPS endpoint, polling interval and secret-store binding');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,status,
    enabled,direction,write_enabled
  ) values(
    v_org,trim(p_key),trim(p_name),'recovery_activation',p_system_kind,v_endpoint,
    case when p_system_kind='file' then null else p_expected_interval_minutes end,
    v_ref,
    'Recovery Activation Kit source. Read-only into SyncAI; no source-system write-back.',
    case when p_enabled then 'active' else 'configured' end,p_enabled,'read_only',false
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set name=excluded.name,connector_type=excluded.connector_type,
    system_kind=excluded.system_kind,endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,status=excluded.status,
    enabled=excluded.enabled,direction='read_only',write_enabled=false
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'recovery_activation_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end||
      ' read-only Recovery source '||trim(p_key),
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object('ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','transport',case when p_system_kind='file' then 'manual_file' else 'generic_rest' end,
    'credential_binding_recorded',v_ref is not null);
end $$;

create or replace function public.save_recovery_activation_mapping(
  p_connector_key text,
  p_entity_type text,
  p_source_array_path text,
  p_column_mapping jsonb,
  p_value_mappings jsonb,
  p_constants jsonb,
  p_approve boolean,
  p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_allowed text[]:=public.recovery_activation_allowed_fields(p_entity_type);
  v_required text[]:=public.recovery_activation_required_fields(p_entity_type);
  v_key text;
  v_value jsonb;
  v_missing text[];
  v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','approving a Recovery source mapping requires an administrator');
  end if;
  select * into v_connector from public.connectors
    where organization_id=v_org and connector_key=trim(p_connector_key)
      and connector_type='recovery_activation';
  if not found then return jsonb_build_object('error','Recovery activation source not found'); end if;
  if coalesce(array_length(v_allowed,1),0)=0 then return jsonb_build_object('error','unsupported entity type'); end if;
  if jsonb_typeof(coalesce(p_column_mapping,'null'::jsonb))<>'object' or
     jsonb_typeof(coalesce(p_value_mappings,'null'::jsonb))<>'object' or
     jsonb_typeof(coalesce(p_constants,'null'::jsonb))<>'object' then
    return jsonb_build_object('error','column, vocabulary and constant mappings must be JSON objects');
  end if;
  if coalesce(p_source_array_path,'') !~ '^[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object('error','source array path must be a dot-separated property path');
  end if;
  for v_key,v_value in select * from jsonb_each(p_column_mapping) loop
    if not (v_key=any(v_allowed)) then return jsonb_build_object('error','unsupported canonical field: '||v_key); end if;
    if jsonb_typeof(v_value)<>'string' or length(trim(v_value#>>'{}'))=0 then
      return jsonb_build_object('error','every column mapping must name a source field');
    end if;
  end loop;
  for v_key,v_value in select * from jsonb_each(p_value_mappings) loop
    if not (v_key=any(v_allowed)) or jsonb_typeof(v_value)<>'object' then
      return jsonb_build_object('error','every vocabulary mapping must be an object for an allowed canonical field');
    end if;
    if exists(select 1 from jsonb_each(v_value) pair where jsonb_typeof(pair.value)<>'string') then
      return jsonb_build_object('error','every vocabulary target must be a canonical string value');
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_constants) loop
    if not (v_key=any(v_allowed)) then return jsonb_build_object('error','unsupported constant field: '||v_key); end if;
    if jsonb_typeof(p_constants->v_key) in ('object','array') then return jsonb_build_object('error','constant mappings must be scalar values'); end if;
  end loop;
  if (p_constants::text||p_column_mapping::text) ~* '(password|api[_ -]?key|bearer[[:space:]]|client[_ -]?secret)' then
    return jsonb_build_object('error','mapping configuration appears to contain a credential');
  end if;
  select array_agg(field order by field) into v_missing
  from unnest(v_required) field
  where not (p_column_mapping ? field or p_constants ? field);
  if p_entity_type='production_record' and not (
    p_column_mapping ? 'site_external_id' or p_constants ? 'site_external_id' or
    p_column_mapping ? 'asset_external_id' or p_constants ? 'asset_external_id'
  ) then
    v_missing:=coalesce(v_missing,'{}'::text[])||'site_external_id or asset_external_id';
  end if;
  if p_approve and coalesce(array_length(v_missing,1),0)>0 then
    return jsonb_build_object('error','required mappings are missing','missing_fields',v_missing);
  end if;
  if p_approve and coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','approval requires a substantive mapping basis');
  end if;

  insert into public.connector_entity_mappings(
    organization_id,connector_id,entity_type,source_array_path,column_mapping,
    value_mappings,constants,status,basis,created_by,approved_by,approved_at
  ) values(
    v_org,v_connector.id,p_entity_type,coalesce(p_source_array_path,''),
    p_column_mapping,p_value_mappings,p_constants,
    case when p_approve then 'approved' else 'draft' end,trim(p_basis),auth.uid(),
    case when p_approve then auth.uid() end,case when p_approve then now() end
  )
  on conflict(connector_id,entity_type) do update set
    source_array_path=excluded.source_array_path,column_mapping=excluded.column_mapping,
    value_mappings=excluded.value_mappings,constants=excluded.constants,
    status=excluded.status,basis=excluded.basis,approved_by=excluded.approved_by,
    approved_at=excluded.approved_at,updated_at=now()
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'recovery_activation_mapping',
    case when p_approve then 'Approved' else 'Saved draft' end||' '||p_entity_type||
      ' mapping for '||trim(p_connector_key),
    case when p_approve then 'approved' else 'pending' end,'manual',100,
    auth.uid()::text,trim(p_basis),case when p_approve then 'executed' else 'open' end
  );

  return jsonb_build_object('ok',true,'mapping_id',v_id,
    'status',case when p_approve then 'approved' else 'draft' end,
    'missing_fields',coalesce(to_jsonb(v_missing),'[]'::jsonb));
end $$;

create or replace function public.get_recovery_activation_source(
  p_connector_key text,p_entity_type text
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype; v_mapping public.connector_entity_mappings%rowtype;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation source access denied');
  end if;
  select * into v_connector from public.connectors where organization_id=v_org
    and connector_key=trim(p_connector_key) and connector_type='recovery_activation';
  if not found then return jsonb_build_object('error','Recovery activation source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=p_entity_type;
  if not found then return jsonb_build_object('error','entity mapping not found'); end if;
  return jsonb_build_object(
    'connector_key',v_connector.connector_key,'name',v_connector.name,
    'system_kind',v_connector.system_kind,'enabled',v_connector.enabled,
    'direction',v_connector.direction,'write_enabled',v_connector.write_enabled,
    'endpoint_url',v_connector.endpoint_hint,
    'expected_interval_minutes',v_connector.expected_interval_minutes,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'entity_type',v_mapping.entity_type,'mapping_status',v_mapping.status,
    'source_array_path',v_mapping.source_array_path,
    'column_mapping',v_mapping.column_mapping,'value_mappings',v_mapping.value_mappings,
    'constants',v_mapping.constants
  );
end $$;

-- Internal validator shared by preview and commit. It returns resolved tenant
-- identifiers, but it is never executable directly by a client.
create or replace function public.recovery_activation_validate_row(
  p_org uuid,p_source text,p_entity_type text,p_row jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_ext text:=nullif(trim(coalesce(p_row->>'external_id','')),'');
  v_site uuid; v_asset uuid; v_material uuid;
  v_num numeric; v_num2 numeric; v_start timestamptz; v_end timestamptz; v_date date;
begin
  if p_org is null or p_org is distinct from public.app_current_org() then
    return jsonb_build_object('ok',false,'reason','row tenant does not match the active tenant');
  end if;
  if jsonb_typeof(p_row)<>'object' then return jsonb_build_object('ok',false,'reason','row must be a JSON object'); end if;
  if exists(select 1 from jsonb_each(p_row) item where jsonb_typeof(item.value) in ('array','object')) then
    return jsonb_build_object('ok',false,'reason','canonical row values must be scalar');
  end if;
  if exists(select 1 from jsonb_object_keys(p_row) field
    where not (field=any(public.recovery_activation_allowed_fields(p_entity_type)))) then
    return jsonb_build_object('ok',false,'reason','row contains a field outside the approved canonical entity contract');
  end if;
  if v_ext is null then return jsonb_build_object('ok',false,'reason','missing external_id: replay-safe source identity is required'); end if;
  if length(v_ext)>200 then return jsonb_build_object('ok',false,'reason','external_id exceeds 200 characters'); end if;

  if p_entity_type='site' then
    if coalesce(length(trim(p_row->>'name')),0)<2 then return jsonb_build_object('ok',false,'reason','site name is required'); end if;
    if exists(select 1 from public.sites where organization_id=p_org and name=trim(p_row->>'name')
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','site name already exists under another identity; bind it deliberately before import');
    end if;

  elsif p_entity_type='asset' then
    if coalesce(length(trim(p_row->>'name')),0)<2 then return jsonb_build_object('ok',false,'reason','asset name is required'); end if;
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if nullif(p_row->>'criticality','') is not null and p_row->>'criticality' not in ('critical','high','medium','low') then
      return jsonb_build_object('ok',false,'reason','criticality must be mapped to critical, high, medium or low');
    end if;
    if exists(select 1 from public.assets where organization_id=p_org
      and (name=trim(p_row->>'name') or (nullif(p_row->>'tag','') is not null and tag=p_row->>'tag'))
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','asset name/tag already exists under another identity; bind it deliberately before import');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'site_id',v_site);

  elsif p_entity_type='work_order' then
    if coalesce(length(trim(p_row->>'title')),0)<3 then return jsonb_build_object('ok',false,'reason','work-order title is required'); end if;
    select id into v_asset from public.assets where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'asset_external_id'),'');
    if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id: assets must be loaded first'); end if;
    if nullif(p_row->>'priority','') is not null and p_row->>'priority' not in ('critical','high','medium','low') then
      return jsonb_build_object('ok',false,'reason','priority must be mapped to critical, high, medium or low');
    end if;
    if nullif(p_row->>'status','') is not null and p_row->>'status' not in
      ('pending','open','approval','scheduled','in_progress','blocked','critical','completed','closed','cancelled') then
      return jsonb_build_object('ok',false,'reason','work-order status is not in the governed vocabulary');
    end if;
    begin
      if nullif(p_row->>'planned_hours','') is not null then v_num:=(p_row->>'planned_hours')::numeric; if v_num<=0 then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'downtime_hours','') is not null then v_num2:=(p_row->>'downtime_hours')::numeric; if v_num2<0 then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'created_at','') is not null then v_start:=(p_row->>'created_at')::timestamptz; end if;
      if nullif(p_row->>'completed_at','') is not null then v_end:=(p_row->>'completed_at')::timestamptz; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','work-order hours or timestamps are invalid'); end;
    if p_row->>'status' in ('completed','closed') and v_end is null then
      return jsonb_build_object('ok',false,'reason','completed/closed work requires completed_at evidence');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset);

  elsif p_entity_type='material' then
    if coalesce(length(trim(p_row->>'material_code')),0)<1 or coalesce(length(trim(p_row->>'description')),0)<2 or
       coalesce(length(trim(p_row->>'unit_of_measure')),0)<1 then
      return jsonb_build_object('ok',false,'reason','material code, description and unit of measure are required');
    end if;
    if coalesce(length(trim(p_row->>'basis')),0)<10 then return jsonb_build_object('ok',false,'reason','material catalogue evidence basis is required'); end if;
    if nullif(p_row->>'criticality','') is not null and p_row->>'criticality' not in ('critical','essential','routine') then
      return jsonb_build_object('ok',false,'reason','material criticality must be critical, essential or routine');
    end if;
    begin
      if nullif(p_row->>'unit_cost_usd','') is not null and (p_row->>'unit_cost_usd')::numeric<0 then raise exception 'invalid'; end if;
      if nullif(p_row->>'lead_time_days','') is not null and (p_row->>'lead_time_days')::int<0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','material cost or lead time is invalid'); end;
    if exists(select 1 from public.materials where organization_id=p_org and material_code=trim(p_row->>'material_code')
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','material code already exists under another identity; bind it deliberately before import');
    end if;

  elsif p_entity_type='material_stock' then
    select id into v_material from public.materials where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'material_external_id'),'');
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_material is null then return jsonb_build_object('ok',false,'reason','unknown material_external_id: materials must be loaded first'); end if;
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if exists(select 1 from public.material_stock where organization_id=p_org
      and source_system=p_source and external_id=v_ext
      and (material_id is distinct from v_material or site_id is distinct from v_site)) then
      return jsonb_build_object('ok',false,'reason','stock external_id is already bound to another material/site position');
    end if;
    if exists(select 1 from public.material_stock where organization_id=p_org
      and material_id=v_material and site_id is not distinct from v_site
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','material/site stock already exists under another identity; bind it deliberately before import');
    end if;
    begin
      v_num:=(p_row->>'qty_on_hand')::numeric;
      v_num2:=coalesce(nullif(p_row->>'qty_reserved','')::numeric,0);
      if v_num<0 or v_num2<0 or coalesce(nullif(p_row->>'qty_on_order','')::numeric,0)<0 then raise exception 'invalid'; end if;
      if nullif(p_row->>'last_counted_at','') is not null then v_start:=(p_row->>'last_counted_at')::timestamptz; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','stock quantities must be non-negative numbers and count time must parse'); end;
    return jsonb_build_object('ok',true,'external_id',v_ext,'material_id',v_material,'site_id',v_site);

  elsif p_entity_type='craft_capacity' then
    select id into v_site from public.sites where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'site_external_id'),'');
    if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id: sites must be loaded first'); end if;
    if coalesce(length(trim(p_row->>'craft')),0)<2 or coalesce(length(trim(p_row->>'basis')),0)<10 then
      return jsonb_build_object('ok',false,'reason','craft and a substantive operator capacity basis are required');
    end if;
    begin
      v_num:=(p_row->>'weekly_hours')::numeric; v_date:=(p_row->>'effective_from')::date;
      if v_num<=0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','weekly_hours must be positive and effective_from must be a date'); end;
    if exists(select 1 from public.craft_capacity where organization_id=p_org and site_id=v_site
      and craft=trim(p_row->>'craft') and effective_from=v_date
      and (source_system is distinct from p_source or external_id is distinct from v_ext)) then
      return jsonb_build_object('ok',false,'reason','craft capacity already exists under another identity for this site/date');
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'site_id',v_site);

  elsif p_entity_type='operating_state' then
    select id into v_asset from public.assets where organization_id=p_org and source_system=p_source
      and external_id=nullif(trim(p_row->>'asset_external_id'),'');
    if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id: assets must be loaded first'); end if;
    if p_row->>'state' not in ('running','idle','standby','down_planned','down_unplanned','offline') then
      return jsonb_build_object('ok',false,'reason','operating state is not in the governed vocabulary');
    end if;
    begin
      v_start:=(p_row->>'started_at')::timestamptz;
      if nullif(p_row->>'ended_at','') is not null then v_end:=(p_row->>'ended_at')::timestamptz; if v_end<=v_start then raise exception 'invalid'; end if; end if;
      if nullif(p_row->>'load_pct','') is not null then v_num:=(p_row->>'load_pct')::numeric; if v_num<0 or v_num>200 then raise exception 'invalid'; end if; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','operating-state timestamps/load are invalid'); end;
    if exists(select 1 from public.operating_states where organization_id=p_org and source_system=p_source and external_id=v_ext) then
      return jsonb_build_object('ok',true,'external_id',v_ext,'duplicate',true,'asset_id',v_asset);
    end if;
    return jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset);

  elsif p_entity_type='production_record' then
    if nullif(trim(p_row->>'asset_external_id'),'') is not null then
      select id into v_asset from public.assets where organization_id=p_org and source_system=p_source and external_id=trim(p_row->>'asset_external_id');
      if v_asset is null then return jsonb_build_object('ok',false,'reason','unknown asset_external_id'); end if;
    end if;
    if nullif(trim(p_row->>'site_external_id'),'') is not null then
      select id into v_site from public.sites where organization_id=p_org and source_system=p_source and external_id=trim(p_row->>'site_external_id');
      if v_site is null then return jsonb_build_object('ok',false,'reason','unknown site_external_id'); end if;
    end if;
    if v_asset is null and v_site is null then return jsonb_build_object('ok',false,'reason','production must map to a known asset or site'); end if;
    if coalesce(length(trim(p_row->>'unit_of_measure')),0)<1 then return jsonb_build_object('ok',false,'reason','production unit of measure is required'); end if;
    begin
      v_start:=(p_row->>'period_start')::timestamptz; v_end:=(p_row->>'period_end')::timestamptz;
      v_num:=(p_row->>'units_produced')::numeric;
      if v_end<=v_start or v_num<0 then raise exception 'invalid'; end if;
    exception when others then return jsonb_build_object('ok',false,'reason','production period/quantity is invalid'); end;
    if exists(select 1 from public.production_records where organization_id=p_org and source_system=p_source and external_id=v_ext) then
      return jsonb_strip_nulls(jsonb_build_object('ok',true,'external_id',v_ext,'duplicate',true,'asset_id',v_asset,'site_id',v_site));
    end if;
    return jsonb_strip_nulls(jsonb_build_object('ok',true,'external_id',v_ext,'asset_id',v_asset,'site_id',v_site));
  else
    return jsonb_build_object('ok',false,'reason','unsupported entity type');
  end if;
  return jsonb_build_object('ok',true,'external_id',v_ext);
end $$;

revoke all on function public.recovery_activation_validate_row(uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function public.preview_recovery_activation_batch(
  p_connector_key text,p_entity_type text,p_rows jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_row jsonb; v_result jsonb;
  v_read int:=0; v_ok int:=0; v_dup int:=0; v_rejected int:=0; v_results jsonb:='[]'::jsonb;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation preview authority denied');
  end if;
  if jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('error','rows must be a JSON array'); end if;
  if jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','dry-run batches are limited to 500 rows'); end if;
  select * into v_connector from public.connectors where organization_id=v_org
    and connector_key=trim(p_connector_key) and connector_type='recovery_activation';
  if not found then return jsonb_build_object('error','Recovery activation source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=p_entity_type;
  if not found then return jsonb_build_object('error','save the entity mapping before dry-run validation'); end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1;
    v_result:=public.recovery_activation_validate_row(v_org,v_connector.connector_key,p_entity_type,v_row);
    if coalesce((v_result->>'ok')::boolean,false) then
      if coalesce((v_result->>'duplicate')::boolean,false) then v_dup:=v_dup+1; else v_ok:=v_ok+1; end if;
    else v_rejected:=v_rejected+1; end if;
    if v_read<=100 then v_results:=v_results||jsonb_build_array(v_result||jsonb_build_object('row_number',v_read)); end if;
  end loop;
  return jsonb_build_object('dry_run',true,'read',v_read,'accepted',v_ok,'duplicate',v_dup,
    'rejected',v_rejected,'results',v_results,
    'note','A dry run never writes canonical or staging rows. Fix every rejected identity/value before commit.');
end $$;

create or replace function public.begin_recovery_activation_run(
  p_connector_key text,p_entity_type text,p_run_type text default 'manual'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_run uuid; v_from timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation import authority denied');
  end if;
  if p_run_type not in ('manual','sync') then return jsonb_build_object('error','run type must be manual or sync'); end if;
  select * into v_connector from public.connectors where organization_id=v_org
    and connector_key=trim(p_connector_key) and connector_type='recovery_activation';
  if not found or not v_connector.enabled then return jsonb_build_object('error','active Recovery activation source not found'); end if;
  if v_connector.direction<>'read_only' or v_connector.write_enabled then return jsonb_build_object('error','Recovery activation refuses a write-enabled source'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=p_entity_type and status='approved';
  if not found then return jsonb_build_object('error','an administrator must approve the entity mapping before import'); end if;
  select last_position into v_from from public.ingest_watermarks where connector_id=v_connector.id and entity_type=p_entity_type;
  insert into public.connector_runs(organization_id,connector_id,entity_type,run_type,status,started_at,watermark_from,triggered_by)
  values(v_org,v_connector.id,p_entity_type,p_run_type,'running',now(),v_from,auth.uid()) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from);
end $$;

create or replace function public.ingest_recovery_activation_batch(p_run_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_run public.connector_runs%rowtype; v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype; v_row jsonb; v_result jsonb; v_ext text;
  v_site uuid; v_asset uuid; v_material uuid;
  v_read int:=0; v_ok int:=0; v_dup int:=0; v_rejected int:=0; v_max_ts timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','activation ingestion authority denied');
  end if;
  if jsonb_typeof(p_rows)<>'array' then return jsonb_build_object('error','rows must be a JSON array'); end if;
  if jsonb_array_length(p_rows)>500 then return jsonb_build_object('error','commit batches are limited to 500 rows'); end if;
  select * into v_run from public.connector_runs where id=p_run_id and organization_id=v_org and status='running';
  if not found then return jsonb_build_object('error','running connector run not found'); end if;
  select * into v_connector from public.connectors where id=v_run.connector_id and organization_id=v_org
    and connector_type='recovery_activation' and enabled and direction='read_only' and not write_enabled;
  if not found then return jsonb_build_object('error','active read-only Recovery activation source not found'); end if;
  select * into v_mapping from public.connector_entity_mappings where organization_id=v_org
    and connector_id=v_connector.id and entity_type=v_run.entity_type and status='approved';
  if not found then return jsonb_build_object('error','approved mapping not found for this run'); end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_ext:=nullif(trim(v_row->>'external_id'),'');
    v_result:=public.recovery_activation_validate_row(v_org,v_connector.connector_key,v_run.entity_type,v_row);
    if not coalesce((v_result->>'ok')::boolean,false) then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason)
      values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'rejected',v_result->>'reason');
      continue;
    end if;
    if coalesce((v_result->>'duplicate')::boolean,false) then
      v_dup:=v_dup+1;
      insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status)
      values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'duplicate');
      continue;
    end if;

    if v_run.entity_type='site' then
      insert into public.sites(organization_id,name,code,location,source_system,external_id)
      values(v_org,trim(v_row->>'name'),nullif(trim(v_row->>'code'),''),nullif(trim(v_row->>'location'),''),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update
      set name=excluded.name,code=excluded.code,location=excluded.location;

    elsif v_run.entity_type='asset' then
      v_site:=(v_result->>'site_id')::uuid;
      insert into public.assets(organization_id,site_id,tag,name,asset_class,criticality,status,area,system,manufacturer,model,serial_number,source_system,external_id)
      values(v_org,v_site,nullif(trim(v_row->>'tag'),''),trim(v_row->>'name'),nullif(trim(v_row->>'asset_class'),''),
        nullif(v_row->>'criticality',''),nullif(v_row->>'status',''),
        nullif(trim(v_row->>'area'),''),nullif(trim(v_row->>'system'),''),nullif(trim(v_row->>'manufacturer'),''),
        nullif(trim(v_row->>'model'),''),nullif(trim(v_row->>'serial_number'),''),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        site_id=excluded.site_id,tag=excluded.tag,name=excluded.name,asset_class=excluded.asset_class,
        criticality=excluded.criticality,status=excluded.status,area=excluded.area,system=excluded.system,
        manufacturer=excluded.manufacturer,model=excluded.model,serial_number=excluded.serial_number;

    elsif v_run.entity_type='work_order' then
      v_asset:=(v_result->>'asset_id')::uuid;
      insert into public.work_orders(organization_id,asset_id,wo_number,title,status,priority,work_type,planned_hours,
        created_at,completed_at,actual_failure_mode,downtime_hours,source_system,external_id)
      values(v_org,v_asset,coalesce(nullif(trim(v_row->>'wo_number'),''),v_ext),trim(v_row->>'title'),
        nullif(v_row->>'status',''),nullif(v_row->>'priority',''),
        nullif(v_row->>'work_type',''),nullif(v_row->>'planned_hours','')::numeric,
        coalesce(nullif(v_row->>'created_at','')::timestamptz,now()),nullif(v_row->>'completed_at','')::timestamptz,
        nullif(trim(v_row->>'failure_mode'),''),nullif(v_row->>'downtime_hours','')::numeric,v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        asset_id=excluded.asset_id,wo_number=excluded.wo_number,title=excluded.title,status=excluded.status,
        priority=excluded.priority,work_type=excluded.work_type,planned_hours=excluded.planned_hours,
        completed_at=excluded.completed_at,actual_failure_mode=excluded.actual_failure_mode,
        downtime_hours=excluded.downtime_hours,updated_at=now();

    elsif v_run.entity_type='material' then
      insert into public.materials(organization_id,material_code,description,category,unit_of_measure,unit_cost_usd,
        lead_time_days,criticality,is_template,basis,source_system,external_id)
      values(v_org,trim(v_row->>'material_code'),trim(v_row->>'description'),nullif(trim(v_row->>'category'),''),
        trim(v_row->>'unit_of_measure'),nullif(v_row->>'unit_cost_usd','')::numeric,nullif(v_row->>'lead_time_days','')::int,
        nullif(v_row->>'criticality',''),false,trim(v_row->>'basis'),v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        material_code=excluded.material_code,description=excluded.description,category=excluded.category,
        unit_of_measure=excluded.unit_of_measure,unit_cost_usd=excluded.unit_cost_usd,
        lead_time_days=excluded.lead_time_days,criticality=excluded.criticality,basis=excluded.basis;

    elsif v_run.entity_type='material_stock' then
      v_material:=(v_result->>'material_id')::uuid; v_site:=(v_result->>'site_id')::uuid;
      insert into public.material_stock(organization_id,material_id,site_id,qty_on_hand,qty_reserved,qty_on_order,last_counted_at,source_system,external_id)
      values(v_org,v_material,v_site,(v_row->>'qty_on_hand')::numeric,coalesce(nullif(v_row->>'qty_reserved','')::numeric,0),
        coalesce(nullif(v_row->>'qty_on_order','')::numeric,0),nullif(v_row->>'last_counted_at','')::timestamptz,
        v_connector.connector_key,v_ext)
      on conflict(material_id,site_id) do update set qty_on_hand=excluded.qty_on_hand,qty_reserved=excluded.qty_reserved,
        qty_on_order=excluded.qty_on_order,last_counted_at=excluded.last_counted_at,source_system=excluded.source_system,
        external_id=excluded.external_id,updated_at=now();

    elsif v_run.entity_type='craft_capacity' then
      v_site:=(v_result->>'site_id')::uuid;
      insert into public.craft_capacity(organization_id,site_id,craft,weekly_hours,basis,effective_from,source_system,external_id)
      values(v_org,v_site,trim(v_row->>'craft'),(v_row->>'weekly_hours')::numeric,trim(v_row->>'basis'),
        (v_row->>'effective_from')::date,v_connector.connector_key,v_ext)
      on conflict(organization_id,source_system,external_id) where external_id is not null do update set
        site_id=excluded.site_id,craft=excluded.craft,weekly_hours=excluded.weekly_hours,basis=excluded.basis,
        effective_from=excluded.effective_from;

    elsif v_run.entity_type='operating_state' then
      v_asset:=(v_result->>'asset_id')::uuid;
      insert into public.operating_states(organization_id,asset_id,state,load_pct,started_at,ended_at,reason_code,source_system,external_id)
      values(v_org,v_asset,v_row->>'state',nullif(v_row->>'load_pct','')::numeric,(v_row->>'started_at')::timestamptz,
        nullif(v_row->>'ended_at','')::timestamptz,nullif(trim(v_row->>'reason_code'),''),v_connector.connector_key,v_ext);
      v_max_ts:=greatest(coalesce(v_max_ts,(v_row->>'started_at')::timestamptz),(v_row->>'started_at')::timestamptz);

    elsif v_run.entity_type='production_record' then
      v_asset:=nullif(v_result->>'asset_id','')::uuid; v_site:=nullif(v_result->>'site_id','')::uuid;
      insert into public.production_records(organization_id,asset_id,site_id,period_start,period_end,units_produced,unit_of_measure,source_system,external_id)
      values(v_org,v_asset,v_site,(v_row->>'period_start')::timestamptz,(v_row->>'period_end')::timestamptz,
        (v_row->>'units_produced')::numeric,trim(v_row->>'unit_of_measure'),v_connector.connector_key,v_ext);
      v_max_ts:=greatest(coalesce(v_max_ts,(v_row->>'period_end')::timestamptz),(v_row->>'period_end')::timestamptz);
    end if;

    v_ok:=v_ok+1;
    insert into public.ingest_staging(organization_id,connector_id,run_id,entity_type,external_id,payload,status)
    values(v_org,v_connector.id,p_run_id,v_run.entity_type,v_ext,v_row,'accepted');
  end loop;

  update public.connector_runs set records_read=records_read+v_read,records_accepted=records_accepted+v_ok,
    records_rejected=records_rejected+v_rejected,records_duplicate=records_duplicate+v_dup,
    watermark_to=greatest(coalesce(watermark_to,v_max_ts),v_max_ts) where id=p_run_id;
  return jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_dup,'rejected',v_rejected);
end $$;

create or replace function public.get_recovery_activation_rejects(p_run_id uuid,p_limit int default 100)
returns table(row_number bigint,external_id text,reject_reason text,payload jsonb)
language sql stable security definer set search_path=public as $$
  select row_number() over(order by s.received_at,s.id),s.external_id,s.reject_reason,s.payload
  from public.ingest_staging s join public.connector_runs r on r.id=s.run_id and r.organization_id=s.organization_id
  join public.connectors c on c.id=r.connector_id and c.organization_id=r.organization_id
  where s.organization_id=public.app_current_org() and s.run_id=p_run_id and s.status='rejected'
    and c.connector_type='recovery_activation'
  order by s.received_at,s.id limit greatest(least(p_limit,500),1)
$$;

create or replace function public.get_recovery_activation_readiness()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'connector_key',c.connector_key,'name',c.name,'system_kind',c.system_kind,
      'enabled',c.enabled,'direction',c.direction,'write_enabled',c.write_enabled,
      'endpoint_configured',c.endpoint_hint is not null,
      'credential_binding_recorded',c.credential_binding_ref is not null,
      'expected_interval_minutes',c.expected_interval_minutes,'last_success_at',c.last_success_at,
      'state',case when not c.enabled then 'disabled' when c.last_success_at is null then 'never_run'
        when c.expected_interval_minutes is not null and c.last_success_at<now()-make_interval(mins=>c.expected_interval_minutes*2) then 'stale'
        else 'current' end,
      'mappings',coalesce((select jsonb_agg(jsonb_build_object('entity_type',m.entity_type,'status',m.status,
        'approved_at',m.approved_at,'source_array_path',m.source_array_path) order by m.entity_type)
        from public.connector_entity_mappings m where m.connector_id=c.id),'[]'::jsonb)
      ) order by c.name) from public.connectors c where c.organization_id=v_org and c.connector_type='recovery_activation'),'[]'::jsonb),
    'domains',jsonb_build_array(
      jsonb_build_object('key','sites','label','Sites','records',(select count(*) from public.sites where organization_id=v_org),'ready',(select count(*)>0 from public.sites where organization_id=v_org)),
      jsonb_build_object('key','assets','label','Assets','records',(select count(*) from public.assets where organization_id=v_org),'linked_records',(select count(*) from public.assets where organization_id=v_org and site_id is not null),'ready',(select count(*)>0 and count(*)=count(*) filter(where site_id is not null) from public.assets where organization_id=v_org)),
      jsonb_build_object('key','work_orders','label','Work orders','records',(select count(*) from public.work_orders where organization_id=v_org),'open_records',(select count(*) from public.work_orders where organization_id=v_org and completed_at is null),'linked_records',(select count(*) from public.work_orders where organization_id=v_org and asset_id is not null),'ready',(select count(*) filter(where completed_at is null and asset_id is not null)>0 from public.work_orders where organization_id=v_org)),
      jsonb_build_object('key','materials','label','Materials + stock','records',(select count(*) from public.materials where organization_id=v_org),'stock_records',(select count(*) from public.material_stock where organization_id=v_org),'ready',(select exists(select 1 from public.materials where organization_id=v_org) and exists(select 1 from public.material_stock where organization_id=v_org)),
      jsonb_build_object('key','crews','label','Crew capacity','records',(select count(*) from public.craft_capacity where organization_id=v_org),'ready',(select count(*)>0 from public.craft_capacity where organization_id=v_org)),
      jsonb_build_object('key','operating_state','label','Operating state','records',(select count(*) from public.operating_states where organization_id=v_org),'current_down_assets',(select count(distinct asset_id) from public.operating_states where organization_id=v_org and state in ('down_planned','down_unplanned','offline') and (ended_at is null or ended_at>now())),'ready',(select count(*)>0 from public.operating_states where organization_id=v_org)),
      jsonb_build_object('key','production','label','Production','records',(select count(*) from public.production_records where organization_id=v_org),'latest_period_end',(select max(period_end) from public.production_records where organization_id=v_org),'ready',(select count(*)>0 from public.production_records where organization_id=v_org))
    ),
    'minimum_ready_for_draft',
      exists(select 1 from public.sites where organization_id=v_org) and
      exists(select 1 from public.assets where organization_id=v_org) and
      exists(select 1 from public.work_orders where organization_id=v_org and asset_id is not null and completed_at is null),
    'planning_inputs_complete',
      exists(select 1 from public.material_stock where organization_id=v_org) and
      exists(select 1 from public.craft_capacity where organization_id=v_org) and
      exists(select 1 from public.operating_states where organization_id=v_org) and
      exists(select 1 from public.production_records where organization_id=v_org),
    'rejects_30d',(select count(*) from public.ingest_staging where organization_id=v_org and status='rejected' and received_at>now()-interval '30 days'),
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'asset_id',a.id,'asset',a.name,'tag',a.tag,'site_id',a.site_id,
      'open_work_orders',(select count(*) from public.work_orders w where w.organization_id=v_org and w.asset_id=a.id and w.completed_at is null),
      'is_currently_down',exists(select 1 from public.operating_states s where s.organization_id=v_org and s.asset_id=a.id and s.state in ('down_planned','down_unplanned','offline') and (s.ended_at is null or s.ended_at>now())),
      'active_event_id',(select e.id from public.restoration_events e where e.organization_id=v_org and e.asset_id=a.id and e.status in ('open','planning','approval','released','executing','return_pending') limit 1)
      ) order by a.name) from public.assets a where a.organization_id=v_org and exists(select 1 from public.work_orders w where w.organization_id=v_org and w.asset_id=a.id and w.completed_at is null)),'[]'::jsonb),
    'note','No completeness percentage is used as an invented release threshold. Missing domains are named; the canonical plan constraints and approval contract decide what can advance.'
  );
end $$;

create or replace function public.get_recovery_activation_work_orders(p_asset_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  return jsonb_build_object('work_orders',coalesce((select jsonb_agg(jsonb_build_object(
    'id',w.id,'wo_number',w.wo_number,'title',w.title,'priority',w.priority,
    'status',w.status,'planned_hours',w.planned_hours,'estimated_hours',w.estimated_hours
  ) order by case w.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,w.created_at)
  from public.work_orders w where w.organization_id=v_org and w.asset_id=p_asset_id and w.completed_at is null),'[]'::jsonb));
end $$;

create or replace function public.prepare_first_recovery_plan(
  p_asset_id uuid,p_work_order_ids uuid[],p_reason text,p_event_type text,
  p_baseline_return_at timestamptz,p_baseline_method text,p_baseline_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_expected int; v_result jsonb; v_event uuid; v_plan jsonb; v_work uuid;
begin
  if v_org is null or not public.recovery_role_allowed(array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','first-plan preparation authority denied');
  end if;
  if coalesce(array_length(p_work_order_ids,1),0)=0 then return jsonb_build_object('error','select at least one open work order'); end if;
  if coalesce(length(trim(p_reason)),0)<10 then return jsonb_build_object('error','state the restoration event reason'); end if;
  if p_baseline_return_at is null or p_baseline_return_at<=now() then return jsonb_build_object('error','baseline return must be a future timestamp'); end if;
  if p_baseline_method not in ('original_approved_schedule','historical_median','control_estimate','manual_authorized') then return jsonb_build_object('error','invalid baseline method'); end if;
  if coalesce(length(trim(p_baseline_basis)),0)<20 then return jsonb_build_object('error','record a defensible baseline source/basis'); end if;
  select count(*) into v_expected from public.work_orders where organization_id=v_org and asset_id=p_asset_id
    and id=any(p_work_order_ids) and completed_at is null;
  if v_expected<>array_length(p_work_order_ids,1) then return jsonb_build_object('error','one or more selected work orders are closed, missing or belong to another asset'); end if;

  -- This exception block is intentional: if any canonical step refuses, every
  -- preceding event/scope/baseline write in this guided transaction rolls back.
  begin
    v_result:=public.open_restoration_event(p_asset_id,trim(p_reason),p_event_type);
    if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
    v_event:=(v_result->>'event_id')::uuid;
    foreach v_work in array p_work_order_ids loop
      v_result:=public.add_restoration_work(v_event,v_work,'mandatory');
      if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
    end loop;
    v_result:=public.set_restoration_baseline(v_event,p_baseline_return_at,p_baseline_method,trim(p_baseline_basis));
    if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
    v_result:=public.refresh_recovery_planning_inputs(v_event);
    if v_result ? 'error' then raise exception '%',v_result->>'error'; end if;
    v_plan:=public.generate_restoration_plan(v_event);
    if v_plan ? 'error' then raise exception '%',v_plan->>'error'; end if;
  exception when others then
    return jsonb_build_object('error',sqlerrm,'rolled_back',true);
  end;
  return jsonb_build_object('ok',true,'event_id',v_event,'plan_id',v_plan->>'plan_id',
    'plan_status','draft','approval_required',true,'readiness',v_result,
    'note','Draft created from customer-selected scope and baseline. Existing approval and release gates remain mandatory; this workflow never self-approves or releases work.');
end $$;

revoke all on function public.configure_recovery_activation_source(text,text,text,text,int,text,boolean,text) from public,anon;
revoke all on function public.save_recovery_activation_mapping(text,text,text,jsonb,jsonb,jsonb,boolean,text) from public,anon;
revoke all on function public.get_recovery_activation_source(text,text) from public,anon;
revoke all on function public.preview_recovery_activation_batch(text,text,jsonb) from public,anon;
revoke all on function public.begin_recovery_activation_run(text,text,text) from public,anon;
revoke all on function public.ingest_recovery_activation_batch(uuid,jsonb) from public,anon;
revoke all on function public.get_recovery_activation_rejects(uuid,int) from public,anon;
revoke all on function public.get_recovery_activation_readiness() from public,anon;
revoke all on function public.get_recovery_activation_work_orders(uuid) from public,anon;
revoke all on function public.prepare_first_recovery_plan(uuid,uuid[],text,text,timestamptz,text,text) from public,anon;

grant execute on function public.configure_recovery_activation_source(text,text,text,text,int,text,boolean,text) to authenticated;
grant execute on function public.save_recovery_activation_mapping(text,text,text,jsonb,jsonb,jsonb,boolean,text) to authenticated;
grant execute on function public.get_recovery_activation_source(text,text) to authenticated;
grant execute on function public.preview_recovery_activation_batch(text,text,jsonb) to authenticated;
grant execute on function public.begin_recovery_activation_run(text,text,text) to authenticated;
grant execute on function public.ingest_recovery_activation_batch(uuid,jsonb) to authenticated;
grant execute on function public.get_recovery_activation_rejects(uuid,int) to authenticated;
grant execute on function public.get_recovery_activation_readiness() to authenticated;
grant execute on function public.get_recovery_activation_work_orders(uuid) to authenticated;
grant execute on function public.prepare_first_recovery_plan(uuid,uuid[],text,text,timestamptz,text,text) to authenticated;

notify pgrst,'reload schema';
