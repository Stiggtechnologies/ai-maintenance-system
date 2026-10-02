-- Governed pagination for the existing read-only CMMS adapter (C2.12).
--
-- This is transport metadata on the ONE canonical connector record. It does
-- not create another connector, run, staging, reject or watermark store.
-- Source writes remain impossible: the adapter is still GET-only and every
-- promoted row still passes through public.connector_runs and
-- public.ingest_staging into canonical public.work_orders, with
-- public.connector_entity_mappings and public.ingest_watermarks retained.

alter table public.connectors
  add column if not exists pagination_mode text not null default 'none',
  add column if not exists pagination_next_path text,
  add column if not exists pagination_max_pages int not null default 1;

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
  v_mode text := lower(trim(coalesce(p_pagination_mode,'none')));
  v_next_path text := nullif(trim(coalesce(p_pagination_next_path,'')), '');
  v_max_pages int := coalesce(p_pagination_max_pages,1);
begin
  select role into v_role from public.user_profiles where id=auth.uid();
  if v_org is null or coalesce(v_role,'') not in ('admin','ai_admin') then
    return jsonb_build_object('error','configuring a CMMS source requires an administrator');
  end if;
  if coalesce(length(trim(p_key)),0)<3 or coalesce(length(trim(p_name)),0)<3 then
    return jsonb_build_object('error','connector key and name are required');
  end if;
  if coalesce(p_system_kind,'') not in ('sap_pm','maximo','oracle_eam','generic_cmms') then
    return jsonb_build_object('error','CMMS kind must be sap_pm, maximo, oracle_eam or generic_cmms');
  end if;
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
  if p_enabled and (
    v_endpoint is null
    or coalesce(p_expected_interval_minutes,0)<1
    or v_ref is null
  ) then
    return jsonb_build_object('error','an enabled CMMS source requires an HTTPS endpoint, expected interval and secret-store binding');
  end if;

  insert into public.connectors(
    organization_id,connector_key,name,connector_type,system_kind,endpoint_hint,
    expected_interval_minutes,credential_binding_ref,contract_note,register_ref,
    status,enabled,direction,write_enabled,pagination_mode,
    pagination_next_path,pagination_max_pages
  ) values(
    v_org,trim(p_key),trim(p_name),'cmms_read',p_system_kind,v_endpoint,
    p_expected_interval_minutes,v_ref,
    'Bounded read-only CMMS work-order pull. No source-system write-back, execute, or autonomous control.',
    'C2.12',case when p_enabled then 'active' else 'configured' end,p_enabled,
    'read_only',false,v_mode,v_next_path,v_max_pages
  )
  on conflict (organization_id,connector_key) where connector_key is not null
  do update set
    name=excluded.name,
    connector_type='cmms_read',
    system_kind=excluded.system_kind,
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
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only CMMS source ' || trim(p_key)
      || ' with pagination mode ' || v_mode,
    'approved','manual',100,auth.uid()::text,trim(p_basis),'executed'
  );

  return jsonb_build_object(
    'ok',true,
    'connector_id',v_id,
    'enabled',p_enabled,
    'direction','read_only',
    'write_enabled',false,
    'pagination_mode',v_mode,
    'pagination_next_path',v_next_path,
    'pagination_max_pages',v_max_pages,
    'note',case when p_enabled
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
    'endpoint_url',v_connector.endpoint_hint,
    'credential_binding_ref',v_connector.credential_binding_ref,
    'mapping_status',v_mapping.status,
    'source_array_path',v_mapping.source_array_path,
    'column_mapping',v_mapping.column_mapping,
    'pagination_mode',v_connector.pagination_mode,
    'pagination_next_path',v_connector.pagination_next_path,
    'pagination_max_pages',v_connector.pagination_max_pages
  );
end
$$;

revoke all on function public.get_cmms_read_source(text) from public, anon;
grant execute on function public.get_cmms_read_source(text) to authenticated;

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
    array['planner','maintenance_manager','reliability_engineer','admin','ai_admin']
  ) then
    return jsonb_build_object('error','CMMS ingest authority denied');
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
    and not c.write_enabled;
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
