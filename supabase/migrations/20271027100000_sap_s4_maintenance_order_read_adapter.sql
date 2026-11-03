-- C2.12 — governed SAP S/4HANA Maintenance Order read adapter.
--
-- One connector reads one administrator-approved MaintenancePlanningPlant and
-- promotes MaintenanceOrder headers into the existing work_orders table.
-- Equipment must already exist as a same-tenant, same-site assets.external_id.
-- The adapter does not create assets, approvals, closeout, or a SAP write.

create or replace function public.is_valid_sap_maintenance_phase_map(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item jsonb;
  v_codes text[]:='{}';
begin
  if coalesce(jsonb_typeof(p_value),'')<>'array'
     or jsonb_array_length(p_value)>20 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item)<>'object'
       or exists(select 1 from jsonb_object_keys(v_item) k
         where k not in ('phaseCode','status'))
       or btrim(coalesce(v_item->>'phaseCode','')) !~ '^[A-Za-z0-9]{1,2}$'
       or btrim(coalesce(v_item->>'status','')) not in
         ('pending','scheduled','in_progress','blocked','completed') then
      return false;
    end if;
    if btrim(v_item->>'phaseCode')=any(v_codes) then return false; end if;
    v_codes:=v_codes||btrim(v_item->>'phaseCode');
  end loop;
  return true;
end
$$;

revoke all on function public.is_valid_sap_maintenance_phase_map(jsonb)
  from public,anon,authenticated;

alter table public.connectors
  add column if not exists maintenance_site_id uuid
    references public.sites(id) on delete set null,
  add column if not exists maintenance_planning_plant text,
  add column if not exists maintenance_phase_map jsonb,
  add column if not exists maintenance_max_rows int,
  add column if not exists maintenance_page_size int;

alter table public.connectors
  drop constraint if exists connectors_maintenance_order_read_profile_check;
alter table public.connectors
  add constraint connectors_maintenance_order_read_profile_check check (
    connector_type is distinct from 'maintenance_order_read'
    or (
      system_kind='cmms'
      and connector_profile='sap_s4_maintenance_order'
      and maintenance_site_id is not null
      and maintenance_planning_plant ~ '^[A-Za-z0-9]{1,4}$'
      and public.is_valid_sap_maintenance_phase_map(maintenance_phase_map)
      and maintenance_max_rows between 1 and 25000
      and maintenance_page_size between 1 and least(maintenance_max_rows,5000)
      and pagination_mode='next_url'
      and pagination_next_path='d.__next'
      and pagination_max_pages between 2 and 100
      and direction='read_only'
      and not write_enabled
    )
  );

comment on column public.connectors.maintenance_planning_plant is
  'Administrator-approved SAP MaintenancePlanningPlant. The pull request cannot widen it.';
comment on column public.connectors.maintenance_phase_map is
  'Explicit MaintOrdProcessPhaseCode to existing work_orders status vocabulary. Empty phase codes are not translated.';

create or replace function public.sap_s4_maintenance_order_contract_hash(p_connector_id uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select encode(extensions.digest(jsonb_build_object(
    'organizationId',c.organization_id,
    'connectorId',c.id,
    'connectorKey',c.connector_key,
    'serviceRoot',c.endpoint_hint,
    'credentialBindingRef',c.credential_binding_ref,
    'enabled',c.enabled,
    'direction',c.direction,
    'writeEnabled',c.write_enabled,
    'siteId',c.maintenance_site_id,
    'planningPlant',c.maintenance_planning_plant,
    'phaseMap',c.maintenance_phase_map,
    'maxRows',c.maintenance_max_rows,
    'pageSize',c.maintenance_page_size,
    'maxPages',c.pagination_max_pages
  )::text,'sha256'),'hex')
  from public.connectors c where c.id=p_connector_id
$$;

revoke all on function public.sap_s4_maintenance_order_contract_hash(uuid)
  from public,anon,authenticated;

create or replace function public.configure_sap_s4_maintenance_order_source(
  p_key text,
  p_name text,
  p_service_root text,
  p_planning_plant text,
  p_site_id uuid,
  p_phase_map jsonb,
  p_max_rows int,
  p_page_size int,
  p_max_pages int,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text:=nullif(btrim(coalesce(p_service_root,'')),'');
  v_ref text:=nullif(btrim(coalesce(p_credential_binding_ref,'')),'');
  v_plant text:=btrim(coalesce(p_planning_plant,''));
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','a named human administrator must configure or enable an SAP maintenance order source');
  end if;
  if v_org is null or coalesce(v_role,'')<>'admin' then
    return jsonb_build_object('error','configuring an SAP maintenance order source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)),0) not between 3 and 160
     or coalesce(length(btrim(p_name)),0) not between 3 and 160 then
    return jsonb_build_object('error','connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)),0) not between 20 and 2000 then
    return jsonb_build_object('error','record a substantive bounded SAP maintenance order activation and site-mapping basis');
  end if;
  if not exists(select 1 from public.sites s where s.id=p_site_id and s.organization_id=v_org) then
    return jsonb_build_object('error','the canonical maintenance site is outside the active tenant or does not exist');
  end if;
  if v_plant !~ '^[A-Za-z0-9]{1,4}$' then
    return jsonb_build_object('error','SAP maintenance planning plant must be a 1-4 character identifier');
  end if;
  if not public.is_valid_sap_maintenance_phase_map(p_phase_map) then
    return jsonb_build_object('error','phase map must contain at most 20 unique MaintOrdProcessPhaseCode to pending, scheduled, in_progress, blocked or completed mappings');
  end if;
  if coalesce(p_max_rows,0) not between 1 and 25000 then
    return jsonb_build_object('error','maximum SAP maintenance orders must be between 1 and 25000');
  end if;
  if coalesce(p_page_size,0) not between 1 and least(coalesce(p_max_rows,0),5000) then
    return jsonb_build_object('error','SAP page size must be between 1 and the approved row maximum, capped at 5000');
  end if;
  if coalesce(p_max_pages,0) not between 2 and 100 then
    return jsonb_build_object('error','maximum SAP pages must be between 2 and 100');
  end if;
  if coalesce(p_expected_interval_minutes,0) not between 1 and 525600 then
    return jsonb_build_object('error','expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint)>2048
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or v_endpoint !~ '/API_MAINTENANCEORDER(;v=2)?/?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error','SAP service root must be a credential-free public HTTPS URL ending in API_MAINTENANCEORDER or API_MAINTENANCEORDER;v=2 without query or fragment; private/local targets are blocked');
  end if;
  if v_ref is null or length(v_ref)>500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists(select 1 from public.connectors where organization_id=v_org
    and connector_key=btrim(p_key) and connector_type is distinct from 'maintenance_order_read') then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,
    connector_profile,endpoint_hint,expected_interval_minutes,
    credential_binding_ref,contract_note,register_ref,status,enabled,
    direction,write_enabled,pagination_mode,pagination_next_path,
    pagination_max_pages,maintenance_site_id,maintenance_planning_plant,
    maintenance_phase_map,maintenance_max_rows,maintenance_page_size
  ) values(
    v_org,btrim(p_key),btrim(p_name),'maintenance_order_read','cmms',
    'sap_s4_maintenance_order',regexp_replace(v_endpoint,'/$',''),
    p_expected_interval_minutes,v_ref,
    'Bounded SAP S/4HANA Maintenance Order GET. No source write-back; closeout, approval and safety control fields are preserved.',
    'C2.12',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,'next_url','d.__next',p_max_pages,p_site_id,v_plant,
    p_phase_map,p_max_rows,p_page_size
  )
  on conflict(organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,connector_type='maintenance_order_read',system_kind='cmms',
    connector_profile='sap_s4_maintenance_order',endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,register_ref='C2.12',
    status=excluded.status,enabled=excluded.enabled,direction='read_only',
    write_enabled=false,pagination_mode='next_url',pagination_next_path='d.__next',
    pagination_max_pages=excluded.pagination_max_pages,
    maintenance_site_id=excluded.maintenance_site_id,
    maintenance_planning_plant=excluded.maintenance_planning_plant,
    maintenance_phase_map=excluded.maintenance_phase_map,
    maintenance_max_rows=excluded.maintenance_max_rows,
    maintenance_page_size=excluded.maintenance_page_size
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'sap_s4_maintenance_order_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      ||' read-only SAP planning plant '||v_plant||' mapped to site '||p_site_id,
    'approved','manual',100,auth.uid()::text,btrim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,'connector_id',v_id,'enabled',p_enabled,
    'direction','read_only','write_enabled',false,
    'source_profile','sap_s4_maintenance_order','planning_plant',v_plant,
    'site_id',p_site_id,
    'note',case when p_enabled
      then 'Enabled bounded user-triggered SAP maintenance order reads. Closeout and approval fields remain untouched.'
      else 'Saved disabled. Deploy the approved host and OAuth binding before enabling.' end
  );
end
$$;

revoke all on function public.configure_sap_s4_maintenance_order_source(
  text,text,text,text,uuid,jsonb,int,int,int,int,text,boolean,text
) from public,anon;
grant execute on function public.configure_sap_s4_maintenance_order_source(
  text,text,text,text,uuid,jsonb,int,int,int,int,text,boolean,text
) to authenticated;

create or replace function public.get_sap_s4_maintenance_order_source(p_connector_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
begin
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_org is null or coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP maintenance order source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id=v_org and connector_key=btrim(p_connector_key)
    and connector_type='maintenance_order_read' and system_kind='cmms'
    and connector_profile='sap_s4_maintenance_order' and register_ref='C2.12';
  if not found then return jsonb_build_object('error','governed SAP maintenance order source not found'); end if;
  if not exists(select 1 from public.sites s where s.id=v_connector.maintenance_site_id
    and s.organization_id=v_org) then
    return jsonb_build_object('error','configured maintenance site is no longer available in this tenant');
  end if;
  return jsonb_build_object(
    'organization_id',v_org,'connector_key',v_connector.connector_key,
    'enabled',v_connector.enabled,'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'source_profile',v_connector.connector_profile,
    'service_root',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'site_id',v_connector.maintenance_site_id,
    'planning_plant',v_connector.maintenance_planning_plant,
    'phase_map',v_connector.maintenance_phase_map,
    'max_rows',v_connector.maintenance_max_rows,
    'page_size',v_connector.maintenance_page_size,
    'max_pages',v_connector.pagination_max_pages,
    'contract_hash',public.sap_s4_maintenance_order_contract_hash(v_connector.id)
  );
end
$$;

revoke all on function public.get_sap_s4_maintenance_order_source(text) from public,anon;
grant execute on function public.get_sap_s4_maintenance_order_source(text) to authenticated;

create or replace function public.begin_sap_s4_maintenance_order_read_run(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_connector_key text,
  p_manifest jsonb,
  p_cursor_to jsonb,
  p_source_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_role text;
  v_item jsonb;
  v_page int:=0;
  v_rows int:=0;
  v_bytes bigint:=0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
  v_hash text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP maintenance order transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP maintenance order run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id=p_organization_id and connector_key=btrim(p_connector_key)
    and connector_type='maintenance_order_read' and system_kind='cmms'
    and connector_profile='sap_s4_maintenance_order' and register_ref='C2.12'
    and enabled and direction='read_only' and not write_enabled
  for update;
  if not found then return jsonb_build_object('error','active governed SAP maintenance order source not found'); end if;
  v_hash:=public.sap_s4_maintenance_order_contract_hash(v_connector.id);
  if exists(select 1 from public.connector_runs r where r.connector_id=v_connector.id
    and r.organization_id=p_organization_id and r.entity_type='work_order'
    and r.status='running') then
    return jsonb_build_object('error','an SAP maintenance order pull is already running for this connector');
  end if;
  if coalesce(jsonb_typeof(p_manifest),'')<>'array'
     or jsonb_array_length(p_manifest) not between 1 and v_connector.pagination_max_pages
     or coalesce(jsonb_typeof(p_cursor_to),'')<>'object'
     or coalesce(p_cursor_to->>'fetched_at','')=''
     or coalesce(p_cursor_to->>'contract_hash','')<>v_hash
     or coalesce(p_source_bytes,0)<=0 or p_source_bytes>26214400 then
    return jsonb_build_object('error','bounded SAP maintenance order transport evidence is invalid');
  end if;
  begin v_observed_at:=(p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error','SAP maintenance order transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('error','SAP maintenance order timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page:=v_page+1;
    if jsonb_typeof(v_item)<>'object'
       or coalesce(v_item->>'transport','')<>'sap_s4_odata_v2'
       or coalesce(v_item->>'resource','')<>'MaintenanceOrder'
       or coalesce(v_item->>'page','')<>v_page::text
       or coalesce(v_item->>'planning_plant','')<>v_connector.maintenance_planning_plant
       or coalesce(v_item->>'sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes','') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count','') !~ '^[0-9]+$' then
      return jsonb_build_object('error','SAP maintenance order manifest is missing bounded page provenance');
    end if;
    if (v_item->>'bytes')::bigint<=0 or (v_item->>'bytes')::bigint>10485760 then
      return jsonb_build_object('error','SAP maintenance order source pages must contain no more than 10 MB');
    end if;
    if (v_item->>'row_count')::int>v_connector.maintenance_page_size then
      return jsonb_build_object('error','SAP maintenance order source page exceeds the approved row size');
    end if;
    v_bytes:=v_bytes+(v_item->>'bytes')::bigint;
    v_rows:=v_rows+(v_item->>'row_count')::int;
  end loop;
  if v_bytes<>p_source_bytes or v_rows<1 or v_rows>v_connector.maintenance_max_rows
     or coalesce(p_cursor_to->>'raw_rows','')<>v_rows::text
     or coalesce(p_cursor_to->>'pages','')<>v_page::text
     or coalesce(p_cursor_to->>'mapped_rows','') !~ '^[1-9][0-9]*$'
     or (p_cursor_to->>'mapped_rows')::int>v_rows then
    return jsonb_build_object('error','SAP maintenance order manifest does not reconcile to the complete mapped response');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='work_order';
  if v_from is not null and v_observed_at<=v_from then
    return jsonb_build_object('error','SAP maintenance order observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.sap_maintenance_order_transport','granted',true);
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,watermark_to,triggered_by,source_contract_hash,
    transport_manifest,transport_cursor_to,source_object_count,source_bytes
  ) values(
    p_organization_id,v_connector.id,'work_order','sync','running',now(),
    v_from,v_observed_at,p_triggered_by,v_hash,p_manifest,p_cursor_to,v_page,p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object('ok',true,'run_id',v_run,'watermark_from',v_from,
    'cursor_to',p_cursor_to);
end
$$;

revoke all on function public.begin_sap_s4_maintenance_order_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) from public,anon,authenticated;
grant execute on function public.begin_sap_s4_maintenance_order_read_run(
  uuid,uuid,text,jsonb,jsonb,bigint
) to service_role;

create or replace function public.ingest_sap_s4_maintenance_order_read_batch(
  p_organization_id uuid,
  p_triggered_by uuid,
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_connector public.connectors%rowtype;
  v_run public.connector_runs%rowtype;
  v_role text;
  v_row jsonb;
  v_ext text;
  v_existing public.work_orders%rowtype;
  v_asset_id uuid;
  v_asset_count int;
  v_status text;
  v_phase text;
  v_start text;
  v_end timestamptz;
  v_observed timestamptz;
  v_read int:=0;
  v_ok int:=0;
  v_duplicate int:=0;
  v_rejected int:=0;
  v_reason text;
  v_expected int;
  v_seen text[]:='{}';
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP maintenance order ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id=p_triggered_by and organization_id=p_organization_id;
  if coalesce(v_role,'') not in
    ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','SAP maintenance order ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id
    and r.triggered_by=p_triggered_by and r.status='running'
    and r.entity_type='work_order' and r.records_read=0
    and c.connector_type='maintenance_order_read' and c.system_kind='cmms'
    and c.connector_profile='sap_s4_maintenance_order' and c.register_ref='C2.12'
    and c.enabled and c.direction='read_only' and not c.write_enabled;
  if not found then return jsonb_build_object('error','running attested SAP maintenance order run not found'); end if;
  select * into v_connector from public.connectors c
  where c.id=v_run.connector_id and c.organization_id=p_organization_id;
  if v_run.source_contract_hash is distinct from
     public.sap_s4_maintenance_order_contract_hash(v_connector.id)
     or coalesce(v_run.transport_cursor_to->>'contract_hash','')<>v_run.source_contract_hash then
    return jsonb_build_object('error','SAP maintenance order contract changed during this run');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if coalesce(jsonb_typeof(p_rows),'')<>'array'
     or jsonb_array_length(p_rows)<>v_expected
     or jsonb_array_length(p_rows)<1
     or jsonb_array_length(p_rows)>v_connector.maintenance_max_rows then
    return jsonb_build_object('error','SAP maintenance order rows must exactly reconcile to the attested mapped response');
  end if;

  perform set_config('app.sap_maintenance_order_ingest','granted',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read:=v_read+1; v_reason:=null; v_asset_id:=null; v_end:=null;
    v_ext:=nullif(btrim(v_row->>'external_id'),'');
    v_status:=nullif(btrim(v_row->>'status'),'');
    v_phase:=btrim(coalesce(v_row->>'phase_code',''));
    v_start:=nullif(btrim(v_row->>'scheduled_start'),'');
    if jsonb_typeof(v_row)<>'object'
       or exists(select 1 from jsonb_object_keys(v_row) k where k not in (
         'external_id','wo_number','title','equipment','phase_code','status',
         'scheduled_start','basic_end','site_id','observed_at')) then
      v_reason:='row contains fields outside the governed SAP maintenance order contract';
    elsif v_ext is null or length(v_ext)>40
       or btrim(coalesce(v_row->>'wo_number','')) !~ '^[A-Za-z0-9]{1,12}$'
       or length(btrim(coalesce(v_row->>'title',''))) not between 1 and 40
       or btrim(coalesce(v_row->>'equipment','')) !~ '^[A-Za-z0-9]{1,18}$'
       or coalesce(v_row->>'site_id','')<>v_connector.maintenance_site_id::text
       or v_ext is distinct from v_connector.maintenance_planning_plant||':'||btrim(v_row->>'wo_number') then
      v_reason:='order number, equipment, exact site and external identity are required';
    elsif v_phase<>'' and v_phase !~ '^[A-Za-z0-9]{1,2}$' then
      v_reason:='SAP process phase is invalid';
    elsif v_phase='' and v_status is not null then
      v_reason:='an empty SAP process phase cannot assert a canonical status';
    elsif v_status is not null and not exists(
      select 1 from jsonb_array_elements(v_connector.maintenance_phase_map) item
      where item->>'phaseCode'=v_phase and item->>'status'=v_status) then
      v_reason:='canonical status is not the approved process-phase mapping';
    else
      begin
        v_observed:=(v_row->>'observed_at')::timestamptz;
        if nullif(btrim(v_row->>'basic_end'),'') is not null then
          v_end:=(v_row->>'basic_end')::timestamptz;
        end if;
        if v_start is not null then
          perform v_start::timestamptz;
        end if;
        if not isfinite(v_observed) or v_observed<>v_run.watermark_to
           or (v_end is not null and not isfinite(v_end)) then
          v_reason:='observation or basic end timestamp does not match the attested SAP snapshot';
        end if;
      exception when others then
        v_reason:='observation or basic end timestamp is invalid';
      end;
    end if;
    if v_reason is null and v_ext=any(v_seen) then
      v_reason:='mapped SAP maintenance response repeats an order';
    elsif v_reason is null then
      v_seen:=v_seen||v_ext;
    end if;
    if v_reason is null then
      select count(*) into v_asset_count from public.assets a
      where a.organization_id=p_organization_id
        and a.site_id=v_connector.maintenance_site_id
        and a.external_id=btrim(v_row->>'equipment');
      if v_asset_count<>1 then
        v_reason:='SAP Equipment does not match exactly one canonical asset in the approved site';
      else
        select a.id into v_asset_id from public.assets a
        where a.organization_id=p_organization_id
          and a.site_id=v_connector.maintenance_site_id
          and a.external_id=btrim(v_row->>'equipment');
      end if;
    end if;
    if v_reason is not null then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(p_organization_id,v_connector.id,p_run_id,'work_order',v_ext,v_row,'rejected',v_reason);
      continue;
    end if;
    select * into v_existing from public.work_orders w
    where w.organization_id=p_organization_id
      and w.source_system=v_connector.connector_key
      and w.external_id=v_ext
    for update;
    if found and v_existing.completed_at is not null
       and v_status is not null and v_status is distinct from 'completed' then
      v_rejected:=v_rejected+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status,reject_reason
      ) values(p_organization_id,v_connector.id,p_run_id,'work_order',v_ext,v_row,'rejected',
        'SAP phase mapping would reopen a work order that already has a completion timestamp');
      continue;
    end if;
    if found
       and v_existing.title=btrim(v_row->>'title')
       and v_existing.wo_number=btrim(v_row->>'wo_number')
       and v_existing.asset_id=v_asset_id
       and v_existing.site_id=v_connector.maintenance_site_id
       and v_existing.scheduled_date is not distinct from v_start
       and v_existing.due_date is not distinct from v_end
       and (v_status is null or v_existing.status is not distinct from v_status) then
      v_duplicate:=v_duplicate+1;
      update public.work_orders set updated_at=now()
      where id=v_existing.id and organization_id=p_organization_id;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'work_order',v_ext,v_row,'duplicate');
    elsif found then
      update public.work_orders set
        title=btrim(v_row->>'title'),
        wo_number=btrim(v_row->>'wo_number'),
        asset_id=v_asset_id,
        site_id=v_connector.maintenance_site_id,
        scheduled_date=v_start,
        due_date=v_end,
        status=case when v_status is null then status else v_status end,
        updated_at=now()
      where id=v_existing.id and organization_id=p_organization_id;
      v_ok:=v_ok+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'work_order',v_ext,v_row,'accepted');
    else
      insert into public.work_orders(
        organization_id,asset_id,site_id,wo_number,title,description,status,type,
        scheduled_date,due_date,completed_at,source_system,external_id,updated_at
      ) values(
        p_organization_id,v_asset_id,v_connector.maintenance_site_id,
        btrim(v_row->>'wo_number'),btrim(v_row->>'title'),
        'Read from SAP S/4HANA Maintenance Order. Closeout was not supplied by this adapter.',
        v_status,'human_created',v_start,v_end,
        case when v_status='completed' then v_end else null end,
        v_connector.connector_key,v_ext,now()
      );
      v_ok:=v_ok+1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(p_organization_id,v_connector.id,p_run_id,'work_order',v_ext,v_row,'accepted');
    end if;
  end loop;
  update public.connector_runs set records_read=v_read,records_accepted=v_ok,
    records_rejected=v_rejected,records_duplicate=v_duplicate
  where id=p_run_id and organization_id=p_organization_id;
  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,new_state
  ) values(
    p_organization_id,'sap_s4_maintenance_order_read',v_role,
    jsonb_build_object('action','ingest_snapshot','runId',p_run_id,
      'connectorKey',v_connector.connector_key,'actorId',p_triggered_by,
      'sourceWriteBack',false),
    jsonb_build_object('read',v_read,'accepted',v_ok,'duplicate',v_duplicate,
      'rejected',v_rejected,'preservedFields',jsonb_build_array(
        'actual_failure_mode','actual_cause','corrective_action','labor_hours',
        'downtime_hours','approval_required','safety_flag','priority','work_type'))
  );
  return jsonb_build_object('read',v_read,'accepted',v_ok,
    'duplicate',v_duplicate,'rejected',v_rejected);
end
$$;

revoke all on function public.ingest_sap_s4_maintenance_order_read_batch(
  uuid,uuid,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_sap_s4_maintenance_order_read_batch(
  uuid,uuid,uuid,jsonb
) to service_role;

create or replace function public.enforce_sap_s4_maintenance_order_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(select 1 from public.connectors c where c.id=new.connector_id
    and c.connector_type='maintenance_order_read' and c.system_kind='cmms'
    and c.connector_profile='sap_s4_maintenance_order' and c.register_ref='C2.12') then
    if tg_op='INSERT'
       and coalesce(current_setting('app.sap_maintenance_order_transport',true),'')<>'granted' then
      raise exception 'governed SAP maintenance order runs require service-attested complete transport evidence';
    end if;
    if tg_op='UPDATE'
       and coalesce(current_setting('app.sap_maintenance_order_ingest',true),'')<>'granted'
       and coalesce(current_setting('app.sap_maintenance_order_finish',true),'')<>'granted' then
      raise exception 'governed SAP maintenance order runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_sap_s4_maintenance_order_run_attestation on public.connector_runs;
create trigger trg_sap_s4_maintenance_order_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_sap_s4_maintenance_order_run_attestation();

create or replace function public.finish_sap_s4_maintenance_order_read_run(
  p_organization_id uuid,
  p_run_id uuid,
  p_status text,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.connector_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_clean boolean;
  v_advanced boolean:=false;
  v_expected int;
  v_rows int:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    return jsonb_build_object('error','SAP maintenance order finish is service-only');
  end if;
  if p_status not in ('success','partial','failed') then
    return jsonb_build_object('error','SAP maintenance order status must be success, partial or failed');
  end if;
  select r.* into v_run from public.connector_runs r join public.connectors c
    on c.id=r.connector_id and c.organization_id=r.organization_id
  where r.id=p_run_id and r.organization_id=p_organization_id and r.status='running'
    and c.connector_type='maintenance_order_read' and c.system_kind='cmms'
    and c.connector_profile='sap_s4_maintenance_order' and c.register_ref='C2.12';
  if not found then return jsonb_build_object('error','running governed SAP maintenance order run not found'); end if;
  select * into v_connector from public.connectors
  where id=v_run.connector_id and organization_id=p_organization_id;
  if v_run.source_contract_hash is distinct from
     public.sap_s4_maintenance_order_contract_hash(v_connector.id) then
    return jsonb_build_object('error','SAP maintenance order contract changed before finish');
  end if;
  v_expected:=(v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success','partial') and v_run.records_read<>v_expected then
    return jsonb_build_object('error','SAP maintenance order run rows do not reconcile to the attested mapped response');
  end if;
  if p_status='success' and v_run.records_rejected>0 then
    return jsonb_build_object('error','an SAP maintenance order run with rejected rows cannot finish as success');
  end if;
  v_clean:=p_status='success' and v_run.records_rejected=0
    and v_run.transport_manifest is not null and v_run.transport_cursor_to is not null;
  perform set_config('app.sap_maintenance_order_finish','granted',true);
  update public.connector_runs set status=p_status,finished_at=now(),
    records_processed=records_accepted,
    error_message=case when p_error is null then null else left(p_error,500) end
  where id=p_run_id and organization_id=p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_cursor,last_run_id,updated_at
    ) values(
      p_organization_id,v_run.connector_id,'work_order',v_run.watermark_to,
      v_run.transport_cursor_to,p_run_id,now()
    ) on conflict(connector_id,entity_type) do update set
      last_position=greatest(public.ingest_watermarks.last_position,excluded.last_position),
      last_cursor=excluded.last_cursor,last_run_id=excluded.last_run_id,updated_at=now();
    get diagnostics v_rows=row_count; v_advanced:=v_rows=1;
  end if;
  update public.connectors set
    last_success_at=case when v_clean then now() else last_success_at end,
    last_failure_at=case when not v_clean then now() else last_failure_at end
  where id=v_run.connector_id and organization_id=p_organization_id;
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',p_status,
    'watermark_advanced',v_advanced,'records_read',v_run.records_read,
    'records_accepted',v_run.records_accepted,
    'records_duplicate',v_run.records_duplicate,
    'records_rejected',v_run.records_rejected);
end
$$;

revoke all on function public.finish_sap_s4_maintenance_order_read_run(
  uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.finish_sap_s4_maintenance_order_read_run(
  uuid,uuid,text,text
) to service_role;

notify pgrst,'reload schema';
