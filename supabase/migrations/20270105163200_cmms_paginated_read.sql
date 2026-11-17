-- Governed pagination for the existing read-only CMMS adapter (C2.12).
--
-- This is transport metadata on the ONE canonical connector record. It does
-- not create another connector, run, staging, reject or watermark store.
-- Source writes remain impossible: the adapter is still GET-only and every
-- promoted row still passes through public.connector_runs and
-- public.ingest_staging into canonical public.work_orders, with
-- public.connector_entity_mappings and public.ingest_watermarks retained.

alter table public.connectors
  add column if not exists connector_profile text,
  add column if not exists pagination_mode text not null default 'none',
  add column if not exists pagination_next_path text,
  add column if not exists pagination_max_pages int not null default 1;

alter table public.connector_runs
  add column if not exists source_contract_hash text;

-- Upgrade sources configured by the earlier thin adapter. It stored the
-- product name in system_kind; preserve that product as the profile and move
-- the canonical integration category back to cmms/eam.
update public.connectors
set connector_profile=system_kind,
    system_kind=case
      when system_kind in ('generic_cmms','sap_pm') then 'cmms'
      else 'eam' end
where connector_type='cmms_read'
  and connector_profile is null
  and system_kind in ('generic_cmms','sap_pm','maximo','oracle_eam');

-- The predecessor admitted ai_admin as an approver. Preserve the mapping
-- content but remove that approval so a named human administrator must review
-- it before this migration can activate or run the source.
update public.connector_entity_mappings m
set status='draft',
    approved_by=null,
    approved_at=null,
    updated_at=now()
from public.connectors c
where c.id=m.connector_id
  and c.organization_id=m.organization_id
  and c.connector_type='cmms_read'
  and m.entity_type='work_order'
  and m.status='approved'
  and not exists(
    select 1 from public.user_profiles approver
    where approver.id=m.approved_by
      and approver.organization_id=m.organization_id
      and approver.role='admin'
  );

-- connector.system_kind stays the canonical integration category. The
-- customer-selected source product/profile is separate so SAP PM, Maximo and
-- Oracle EAM do not widen or bypass the shared connector taxonomy.
alter table public.connectors
  drop constraint if exists connectors_cmms_profile_check;
alter table public.connectors
  add constraint connectors_cmms_profile_check check (
    connector_type is distinct from 'cmms_read'
    or connector_profile is null
    or connector_profile in ('sap_pm','maximo','oracle_eam','generic_cmms')
  );

alter table public.connectors
  drop constraint if exists connectors_pagination_profile_check;
alter table public.connectors
  add constraint connectors_pagination_profile_check check (
    (
      pagination_mode = 'none'
      and pagination_next_path is null
      and pagination_max_pages = 1
    )
    or
    (
      pagination_mode = 'next_url'
      and pagination_next_path is not null
      and pagination_next_path ~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$'
      and pagination_max_pages between 2 and 100
    )
  );

comment on column public.connectors.pagination_mode is
  'Approved read-transport pagination profile. none is one response; next_url follows a same-origin URL from the configured JSON path.';
comment on column public.connectors.pagination_next_path is
  'Safe dotted JSON path containing the next-page URL. Never evaluated as code and never allowed to change origin.';
comment on column public.connectors.pagination_max_pages is
  'Hard administrator-approved ceiling for one pull. Runtime additionally caps total rows and bytes.';
comment on column public.connectors.connector_profile is
  'Optional product/profile inside the canonical system_kind category; never a credential or source-system authority.';
comment on column public.connector_runs.source_contract_hash is
  'Immutable hash of the approved connector and mapping contract used to open this run. CMMS ingest refuses a changed contract.';

create or replace function public.cmms_read_contract_hash(p_connector_id uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select md5(jsonb_build_object(
    'connector_id',c.id,
    'enabled',c.enabled,
    'direction',c.direction,
    'write_enabled',c.write_enabled,
    'system_kind',c.system_kind,
    'connector_profile',c.connector_profile,
    'endpoint_hint',c.endpoint_hint,
    'credential_binding_ref',c.credential_binding_ref,
    'pagination_mode',c.pagination_mode,
    'pagination_next_path',c.pagination_next_path,
    'pagination_max_pages',c.pagination_max_pages,
    'mapping_id',m.id,
    'mapping_status',m.status,
    'mapping_updated_at',m.updated_at,
    'mapping_approved_by',m.approved_by,
    'mapping_approved_at',m.approved_at,
    'source_array_path',m.source_array_path,
    'column_mapping',m.column_mapping,
    'basis',m.basis
  )::text)
  from public.connectors c
  join public.connector_entity_mappings m
    on m.organization_id=c.organization_id
   and m.connector_id=c.id
   and m.entity_type='work_order'
  where c.id=p_connector_id
    and c.organization_id=public.app_current_org()
    and c.connector_type='cmms_read';
$$;

revoke all on function public.cmms_read_contract_hash(uuid)
  from public, anon, authenticated;

-- Replace the old configuration signature so every caller states the
-- pagination posture explicitly. Existing sources remain valid as none/1.
drop function if exists public.configure_cmms_read_source(
  text,text,text,text,int,text,boolean,text
);

create or replace function public.configure_cmms_read_source(
  p_key text,
  p_name text,
  p_system_kind text,
  p_endpoint_url text,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_pagination_mode text,
  p_pagination_next_path text,
  p_pagination_max_pages int,
  p_enabled boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text := nullif(trim(coalesce(p_endpoint_url,'')), '');
  v_ref text := nullif(trim(coalesce(p_credential_binding_ref,'')), '');
  v_profile text := lower(trim(coalesce(p_system_kind,'')));
  v_system_kind text;
  v_mode text := lower(trim(coalesce(p_pagination_mode,'none')));
  v_next_path text := nullif(trim(coalesce(p_pagination_next_path,'')), '');
  v_max_pages int := coalesce(p_pagination_max_pages,1);
  v_enabled boolean := coalesce(p_enabled,false);
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') <> 'admin' then
    return jsonb_build_object(
      'error','configuring a CMMS source requires a named human administrator'
    );
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if v_profile not in ('sap_pm','maximo','oracle_eam','generic_cmms') then
    return jsonb_build_object('error','CMMS kind must be sap_pm, maximo, oracle_eam or generic_cmms');
  end if;
  v_system_kind := case v_profile
    when 'generic_cmms' then 'cmms'
    when 'sap_pm' then 'cmms'
    else 'eam'
  end;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive CMMS activation authority and basis');
  end if;
  if exists(
    select 1 from public.connectors
    where organization_id=v_org
      and connector_key=trim(p_key)
      and connector_type is distinct from 'cmms_read'
  ) then
    return jsonb_build_object('error','connector key already belongs to another governed integration contract');
  end if;
  if v_endpoint is not null and (
    v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
    or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)'
  ) then
    return jsonb_build_object('error','CMMS endpoints must be credential-free public HTTPS URLs; private/local targets are blocked');
  end if;
  if v_ref is not null and (
    v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
    or v_ref ~ '[@?=#]'
  ) then
    return jsonb_build_object('error','credential binding must be an opaque secret-store URI without a value or query string');
  end if;
  if v_mode not in ('none','next_url') then
    return jsonb_build_object('error','pagination mode must be none or next_url');
  end if;
  if v_mode='none' then
    v_next_path := null;
    v_max_pages := 1;
  elsif v_next_path is null
    or v_next_path !~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object('error','next_url pagination requires a safe dotted next-page path');
  elsif v_max_pages not between 2 and 100 then
    return jsonb_build_object('error','pagination maximum must be between 2 and 100 pages');
  end if;
  if v_enabled and (
    v_endpoint is null
    or coalesce(p_expected_interval_minutes,0)<1
    or v_ref is null
  ) then
    return jsonb_build_object('error','an enabled CMMS source requires an HTTPS endpoint, expected interval and secret-store binding');
  end if;
  if v_enabled and not exists(
    select 1
    from public.connectors c
    join public.connector_entity_mappings m
      on m.organization_id=c.organization_id
     and m.connector_id=c.id
     and m.entity_type='work_order'
     and m.status='approved'
    join public.user_profiles approver
      on approver.id=m.approved_by
     and approver.organization_id=m.organization_id
     and approver.role='admin'
    where c.organization_id=v_org
      and c.connector_key=trim(p_key)
      and c.connector_type='cmms_read'
  ) then
    return jsonb_build_object(
      'error','a named human administrator must approve the work_order mapping before activation'
    );
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,connector_profile,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,register_ref,
    status,enabled,direction,write_enabled,pagination_mode,
    pagination_next_path,pagination_max_pages
  ) values(
    v_org,trim(p_key),trim(p_name),'cmms_read',v_system_kind,v_profile,v_endpoint,
    p_expected_interval_minutes,v_ref,
    'Bounded read-only CMMS work-order pull. No source-system write-back, execute, or autonomous control.',
    'C2.12',case when v_enabled then 'active' else 'configured' end,v_enabled,
    'read_only',false,v_mode,v_next_path,v_max_pages
  )
  on conflict (organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,
    connector_type='cmms_read',
    system_kind=excluded.system_kind,
    connector_profile=excluded.connector_profile,
    endpoint_hint=excluded.endpoint_hint,
    expected_interval_minutes=excluded.expected_interval_minutes,
    credential_binding_ref=excluded.credential_binding_ref,
    contract_note=excluded.contract_note,
    register_ref='C2.12',
    status=excluded.status,
    enabled=excluded.enabled,
    direction='read_only',
    write_enabled=false,
    pagination_mode=excluded.pagination_mode,
    pagination_next_path=excluded.pagination_next_path,
    pagination_max_pages=excluded.pagination_max_pages
  returning id into v_id;

  insert into public.decisions(
    organization_id,decision_type,action_taken,approval_status,autonomy_mode,
    confidence_score,human_actor,rationale,outcome_status
  ) values(
    v_org,'cmms_read_source',
    case when v_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only CMMS source ' || trim(p_key)
      || ' with pagination mode ' || v_mode,
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,
    'connector_id',v_id,
    'enabled',v_enabled,
    'direction','read_only',
    'write_enabled',false,
    'system_kind',v_system_kind,
    'source_profile',v_profile,
    'pagination_mode',v_mode,
    'pagination_next_path',v_next_path,
    'pagination_max_pages',v_max_pages,
    'note',case when v_enabled
      then 'Enabled bounded read-only CMMS pull. It remains user-triggered, not unattended.'
      else 'Saved disabled. Approve a mapping before activation.' end
  );
end
$$;

revoke all on function public.configure_cmms_read_source(
  text,text,text,text,int,text,text,text,int,boolean,text
) from public, anon;
grant execute on function public.configure_cmms_read_source(
  text,text,text,text,int,text,text,text,int,boolean,text
) to authenticated;

create or replace function public.get_cmms_read_source(p_connector_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in (
    'planner','reliability_engineer','maintenance_manager','admin','ai_admin'
  ) then
    return jsonb_build_object('error','CMMS source access denied');
  end if;
  select * into v_connector
  from public.connectors
  where organization_id=v_org
    and connector_key=trim(p_connector_key)
    and connector_type='cmms_read';
  if not found then
    return jsonb_build_object('error','CMMS source not found');
  end if;
  select * into v_mapping
  from public.connector_entity_mappings
  where organization_id=v_org
    and connector_id=v_connector.id
    and entity_type='work_order';
  if not found then
    return jsonb_build_object('error','work_order mapping not found');
  end if;
  return jsonb_build_object(
    'enabled',v_connector.enabled,
    'direction',v_connector.direction,
    'write_enabled',v_connector.write_enabled,
    'system_kind',v_connector.system_kind,
    'source_profile',v_connector.connector_profile,
    'endpoint_url',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'credential_tenant_id',v_org,
    'mapping_status',case
      when v_mapping.status='approved' and exists(
        select 1 from public.user_profiles approver
        where approver.id=v_mapping.approved_by
          and approver.organization_id=v_org
          and approver.role='admin'
      ) then 'approved'
      else 'draft' end,
    'source_array_path',v_mapping.source_array_path,
    'column_mapping',v_mapping.column_mapping,
    'pagination_mode',v_connector.pagination_mode,
    'pagination_next_path',v_connector.pagination_next_path,
    'pagination_max_pages',v_connector.pagination_max_pages,
    'contract_hash',public.cmms_read_contract_hash(v_connector.id),
    'can_commit',coalesce(v_role,'') in (
      'planner','reliability_engineer','maintenance_manager','admin'
    )
  );
end
$$;

revoke all on function public.get_cmms_read_source(text) from public, anon;
grant execute on function public.get_cmms_read_source(text) to authenticated;

-- Mapping approval and source activation are human governance acts. The AI
-- administrator may inspect and dry-run the source, but it cannot create the
-- approval record that permits canonical promotion.
create or replace function public.save_cmms_work_order_mapping(
  p_connector_key text,
  p_source_array_path text,
  p_column_mapping jsonb,
  p_approve boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_key text;
  v_value jsonb;
  v_missing text[];
  v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') <> 'admin' then
    return jsonb_build_object(
      'error','approving or changing a CMMS mapping requires a named human administrator'
    );
  end if;
  if coalesce(length(trim(p_basis)),0)<20 then
    return jsonb_build_object('error','record a substantive mapping basis');
  end if;
  if coalesce(p_source_array_path,'') !~ '^[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object('error','source array path is not a safe dotted identifier');
  end if;
  select * into v_connector
  from public.connectors
  where organization_id=v_org
    and connector_key=trim(p_connector_key)
    and connector_type='cmms_read';
  if not found then
    return jsonb_build_object('error','CMMS source not found');
  end if;
  if jsonb_typeof(coalesce(p_column_mapping,'null'::jsonb))<>'object' then
    return jsonb_build_object('error','column mapping must be a JSON object');
  end if;
  for v_key,v_value in select * from jsonb_each(p_column_mapping) loop
    if not(v_key=any(public.cmms_work_order_allowed_fields())) then
      return jsonb_build_object(
        'error',format('mapping target "%s" is outside the work_order contract',v_key)
      );
    end if;
    if jsonb_typeof(v_value)<>'string'
      or length(trim(v_value#>>'{}'))=0
      or trim(v_value#>>'{}') !~ '^[A-Za-z0-9_-]+$' then
      return jsonb_build_object(
        'error','each mapping value must be a simple source field name'
      );
    end if;
  end loop;
  select array_agg(field) into v_missing
  from unnest(public.cmms_work_order_required_fields()) field
  where not(p_column_mapping ? field);
  if v_missing is not null then
    return jsonb_build_object(
      'error','mapping is missing required work_order fields',
      'missing_fields',to_jsonb(v_missing)
    );
  end if;

  insert into public.connector_entity_mappings(
    organization_id,connector_id,entity_type,source_array_path,column_mapping,
    value_mappings,constants,status,basis,created_by,approved_by,approved_at
  ) values(
    v_org,v_connector.id,'work_order',coalesce(p_source_array_path,''),
    p_column_mapping,'{}'::jsonb,'{}'::jsonb,
    case when p_approve then 'approved' else 'draft' end,
    trim(p_basis),auth.uid(),case when p_approve then auth.uid() end,
    case when p_approve then now() end
  )
  on conflict(connector_id,entity_type) do update set
    source_array_path=excluded.source_array_path,
    column_mapping=excluded.column_mapping,
    status=excluded.status,
    basis=excluded.basis,
    approved_by=excluded.approved_by,
    approved_at=excluded.approved_at,
    updated_at=now()
  returning id into v_id;

  return jsonb_build_object(
    'ok',true,
    'mapping_id',v_id,
    'entity_type','work_order',
    'status',case when p_approve then 'approved' else 'draft' end,
    'note',case when p_approve
      then 'Mapping approved by a named human. A human-triggered pull can now promote canonical work orders.'
      else 'Draft mapping saved. A named human administrator must approve it before canonical promotion.' end
  );
end
$$;

revoke all on function public.save_cmms_work_order_mapping(
  text,text,jsonb,boolean,text
) from public, anon;
grant execute on function public.save_cmms_work_order_mapping(
  text,text,jsonb,boolean,text
) to authenticated;

-- A machine identity may perform the read-only preview above, but only a
-- named human in an operational role may open a canonical ingest run. Locking
-- the connector serializes the running-run check and prevents two pulls from
-- racing the same watermark.
drop function if exists public.begin_cmms_read_run(text);

create or replace function public.begin_cmms_read_run(
  p_connector_key text,
  p_expected_contract_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_run uuid;
  v_from timestamptz;
  v_contract_hash text;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in (
    'planner','reliability_engineer','maintenance_manager','admin'
  ) then
    return jsonb_build_object(
      'error','a named human planning, engineering, maintenance or administrator role must trigger the CMMS pull'
    );
  end if;
  select * into v_connector
  from public.connectors
  where organization_id=v_org
    and connector_key=trim(p_connector_key)
    and connector_type='cmms_read'
  for update;
  if not found
    or not v_connector.enabled
    or v_connector.direction<>'read_only'
    or v_connector.write_enabled then
    return jsonb_build_object('error','active read-only CMMS source not found');
  end if;
  if not exists(
    select 1
    from public.connector_entity_mappings m
    join public.user_profiles approver
      on approver.id=m.approved_by
     and approver.organization_id=m.organization_id
     and approver.role='admin'
    where m.organization_id=v_org
      and m.connector_id=v_connector.id
      and m.entity_type='work_order'
      and m.status='approved'
  ) then
    return jsonb_build_object(
      'error','a named human administrator must approve the work_order mapping before pull'
    );
  end if;
  if exists(
    select 1 from public.connector_runs
    where organization_id=v_org
      and connector_id=v_connector.id
      and entity_type='work_order'
      and status='running'
  ) then
    return jsonb_build_object('error','a CMMS work_order pull is already running');
  end if;
  v_contract_hash := public.cmms_read_contract_hash(v_connector.id);
  if coalesce(p_expected_contract_hash,'') !~ '^[0-9a-f]{32}$'
    or v_contract_hash is null
    or v_contract_hash is distinct from p_expected_contract_hash then
    return jsonb_build_object(
      'error','CMMS source or mapping changed after transport began; run a fresh pull'
    );
  end if;
  select last_position into v_from
  from public.ingest_watermarks
  where connector_id=v_connector.id and entity_type='work_order';
  insert into public.connector_runs(
    organization_id,connector_id,entity_type,run_type,status,started_at,
    watermark_from,triggered_by,source_contract_hash
  ) values(
    v_org,v_connector.id,'work_order','sync','running',now(),v_from,auth.uid(),
    v_contract_hash
  ) returning id into v_run;
  return jsonb_build_object(
    'ok',true,'run_id',v_run,'watermark_from',v_from,
    'contract_hash',v_contract_hash
  );
end
$$;

revoke all on function public.begin_cmms_read_run(text,text) from public, anon;
grant execute on function public.begin_cmms_read_run(text,text) to authenticated;

-- Dry-run is evidence preparation, so the AI administrator may perform it.
-- It must nevertheless use the exact canonical validator and duplicate key
-- that commit uses; a preview that accepts rows commit rejects is not a
-- governance control. It writes neither staging nor canonical rows.
create or replace function public.preview_cmms_work_order_batch(
  p_connector_key text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_ext text;
  v_reason text;
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in (
    'planner','reliability_engineer','maintenance_manager','admin','ai_admin'
  ) then
    return jsonb_build_object('error','CMMS preview authority denied');
  end if;
  if coalesce(jsonb_typeof(p_rows),'null')<>'array' then
    return jsonb_build_object(
      'error','CMMS rows must be a JSON array of at most 500 rows'
    );
  end if;
  if jsonb_array_length(p_rows)>500 then
    return jsonb_build_object(
      'error','CMMS rows must be a JSON array of at most 500 rows'
    );
  end if;
  select * into v_connector
  from public.connectors
  where organization_id=v_org
    and connector_key=trim(p_connector_key)
    and connector_type='cmms_read'
    and direction='read_only'
    and not write_enabled;
  if not found then
    return jsonb_build_object('error','read-only CMMS source not found');
  end if;
  if not exists(
    select 1 from public.connector_entity_mappings
    where organization_id=v_org
      and connector_id=v_connector.id
      and entity_type='work_order'
  ) then
    return jsonb_build_object(
      'error','save the work_order mapping before dry-run validation'
    );
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_ext := nullif(trim(v_row->>'external_id'),'');
    v_result := public.recovery_activation_validate_row(
      v_org,v_connector.connector_key,'work_order',v_row
    );
    if not coalesce((v_result->>'ok')::boolean,false) then
      v_rejected := v_rejected + 1;
      v_reason := v_result->>'reason';
    elsif exists(
      select 1 from public.work_orders
      where organization_id=v_org
        and source_system=v_connector.connector_key
        and external_id=v_ext
    ) then
      v_duplicate := v_duplicate + 1;
      v_reason := 'duplicate source identity';
    else
      v_ok := v_ok + 1;
      v_reason := null;
    end if;
    if v_read<=100 then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row_number',v_read,
        'ok',v_reason is null,
        'outcome',case
          when v_reason='duplicate source identity' then 'duplicate'
          when v_reason is null then 'accepted'
          else 'rejected' end,
        'reason',v_reason,
        'external_id',v_ext
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run',true,
    'read',v_read,
    'accepted',v_ok,
    'duplicate',v_duplicate,
    'rejected',v_rejected,
    'results',v_results,
    'note','Dry run used the canonical commit validator and wrote no canonical or staging rows.'
  );
end
$$;

revoke all on function public.preview_cmms_work_order_batch(text,jsonb)
  from public, anon;
grant execute on function public.preview_cmms_work_order_batch(text,jsonb)
  to authenticated;

-- The original thin adapter delegated to the 20260810 generic ingest_batch.
-- That older branch resolves work orders by asset_id/asset_name, while the
-- approved CMMS mapping and Recovery activation contract correctly require
-- asset_external_id. Reuse the canonical Recovery row validator here so a
-- work order can never be silently promoted without its source-bound asset.
create or replace function public.ingest_cmms_read_batch(
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_run public.connector_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_ext text;
  v_asset uuid;
  v_created_at timestamptz;
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_max_ts timestamptz;
begin
  if v_org is null or not public.recovery_role_allowed(
    array['planner','maintenance_manager','reliability_engineer','admin']
  ) then
    return jsonb_build_object(
      'error','a named human planning, engineering, maintenance or administrator role must ingest CMMS rows'
    );
  end if;
  if coalesce(jsonb_typeof(p_rows),'null')<>'array' then
    return jsonb_build_object('error','CMMS rows must be a JSON array of at most 500 rows');
  end if;
  if jsonb_array_length(p_rows)>500 then
    return jsonb_build_object('error','CMMS rows must be a JSON array of at most 500 rows');
  end if;
  select cr.* into v_run
  from public.connector_runs cr
  join public.connectors c
    on c.id=cr.connector_id and c.organization_id=cr.organization_id
  where cr.id=p_run_id
    and cr.organization_id=v_org
    and cr.status='running'
    and cr.entity_type='work_order'
    and c.organization_id=v_org
    and c.connector_type='cmms_read'
    and c.enabled
    and c.direction='read_only'
    and not c.write_enabled
    and cr.triggered_by=auth.uid()
  for update of cr;
  if not found then
    return jsonb_build_object('error','active running read-only CMMS run not found');
  end if;
  select * into v_connector
  from public.connectors
  where id=v_run.connector_id and organization_id=v_org;
  select * into v_mapping
  from public.connector_entity_mappings
  where organization_id=v_org
    and connector_id=v_connector.id
    and entity_type='work_order'
    and status='approved';
  if not found then
    return jsonb_build_object('error','approved work_order mapping not found for this run');
  end if;
  if v_run.source_contract_hash is null
    or v_run.source_contract_hash is distinct from
      public.cmms_read_contract_hash(v_connector.id) then
    return jsonb_build_object(
      'error','CMMS source or mapping changed during this run; no further rows were ingested'
    );
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_ext := nullif(trim(v_row->>'external_id'),'');
    v_result := public.recovery_activation_validate_row(
      v_org,v_connector.connector_key,'work_order',v_row
    );
    if not coalesce((v_result->>'ok')::boolean,false) then
      v_rejected := v_rejected + 1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,
        status,reject_reason
      ) values(
        v_org,v_connector.id,p_run_id,'work_order',v_ext,v_row,'rejected',
        v_result->>'reason'
      );
      continue;
    end if;
    if exists(
      select 1 from public.work_orders
      where organization_id=v_org
        and source_system=v_connector.connector_key
        and external_id=v_ext
    ) then
      v_duplicate := v_duplicate + 1;
      insert into public.ingest_staging(
        organization_id,connector_id,run_id,entity_type,external_id,payload,status
      ) values(
        v_org,v_connector.id,p_run_id,'work_order',v_ext,v_row,'duplicate'
      );
      continue;
    end if;

    v_asset := (v_result->>'asset_id')::uuid;
    v_created_at := coalesce(nullif(v_row->>'created_at','')::timestamptz,now());
    insert into public.work_orders(
      organization_id,asset_id,wo_number,title,status,priority,work_type,
      planned_hours,created_at,completed_at,actual_failure_mode,downtime_hours,
      source_system,external_id
    ) values(
      v_org,v_asset,coalesce(nullif(trim(v_row->>'wo_number'),''),v_ext),
      trim(v_row->>'title'),nullif(v_row->>'status',''),
      nullif(v_row->>'priority',''),nullif(v_row->>'work_type',''),
      nullif(v_row->>'planned_hours','')::numeric,v_created_at,
      nullif(v_row->>'completed_at','')::timestamptz,
      nullif(trim(v_row->>'failure_mode'),''),
      nullif(v_row->>'downtime_hours','')::numeric,
      v_connector.connector_key,v_ext
    );
    v_ok := v_ok + 1;
    v_max_ts := greatest(coalesce(v_max_ts,v_created_at),v_created_at);
    insert into public.ingest_staging(
      organization_id,connector_id,run_id,entity_type,external_id,payload,status
    ) values(
      v_org,v_connector.id,p_run_id,'work_order',v_ext,v_row,'accepted'
    );
  end loop;

  update public.connector_runs
  set records_read=records_read+v_read,
      records_accepted=records_accepted+v_ok,
      records_rejected=records_rejected+v_rejected,
      records_duplicate=records_duplicate+v_duplicate,
      watermark_to=greatest(coalesce(watermark_to,v_max_ts),v_max_ts)
  where id=p_run_id and organization_id=v_org;

  return jsonb_build_object(
    'read',v_read,
    'accepted',v_ok,
    'duplicate',v_duplicate,
    'rejected',v_rejected
  );
end
$$;

revoke all on function public.ingest_cmms_read_batch(uuid,jsonb) from public, anon;
grant execute on function public.ingest_cmms_read_batch(uuid,jsonb) to authenticated;

-- Keep the shared finish contract intact for every other connector, while
-- binding a CMMS completion and its watermark decision to the same named
-- human who opened that run. This closes the otherwise reachable generic RPC
-- without creating a second run or watermark lifecycle.
create or replace function public.finish_connector_run(
  p_run_id uuid,
  p_status text default 'success',
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  r public.connector_runs%rowtype;
  c public.connectors%rowtype;
begin
  select * into r
  from public.connector_runs
  where id=p_run_id and organization_id=v_org
  for update;
  if not found then
    return jsonb_build_object('error','run not found');
  end if;
  select * into c
  from public.connectors
  where id=r.connector_id and organization_id=v_org;

  if c.connector_type='cmms_read' then
    select role into v_role from public.user_profiles where id=auth.uid();
    if coalesce(v_role,'') not in (
      'planner','reliability_engineer','maintenance_manager','admin'
    ) or r.triggered_by is distinct from auth.uid() then
      return jsonb_build_object(
        'error','the named human who triggered this CMMS pull must finish it'
      );
    end if;
    if r.status<>'running' then
      return jsonb_build_object('error','CMMS run is not running');
    end if;
  end if;
  if p_status not in ('success','partial','failure') then
    return jsonb_build_object('error','run status must be success, partial or failure');
  end if;

  update public.connector_runs
  set status=p_status,
      finished_at=now(),
      error_message=p_error,
      records_processed=records_accepted
  where id=p_run_id and organization_id=v_org;

  if p_status = 'success'
    and r.records_rejected = 0
    and r.watermark_to is not null then
    insert into public.ingest_watermarks(
      organization_id,connector_id,entity_type,last_position,last_run_id
    ) values(
      v_org,r.connector_id,r.entity_type,r.watermark_to,p_run_id
    )
    on conflict(connector_id,entity_type) do update set
      last_position=greatest(
        public.ingest_watermarks.last_position,excluded.last_position
      ),
      last_run_id=excluded.last_run_id,
      updated_at=now();
  end if;

  update public.connectors
  set last_success_at=case
        when p_status='success' then now() else last_success_at end,
      last_failure_at=case
        when p_status<>'success' then now() else last_failure_at end
  where id=r.connector_id and organization_id=v_org;

  return jsonb_build_object(
    'run_id',p_run_id,
    'status',p_status,
    'watermark_advanced',
      p_status = 'success'
      and r.records_rejected = 0
      and r.watermark_to is not null,
    'records_rejected',r.records_rejected
  );
end
$$;

revoke all on function public.finish_connector_run(uuid,text,text)
  from public, anon;
grant execute on function public.finish_connector_run(uuid,text,text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
