-- ============================================================================
-- Thin read-only plant historian adapter (C2.13).
--
-- WHAT THIS IS. The ingest contract already accepts condition_reading
-- (20260810160000 / 20261004090100) and the CSV door already reaches it
-- (/pm-programme → ContractImport → ingest_rows). What was missing is a
-- HTTPS JSON pull so a configured tenant can cite connector-backed readings
-- instead of only seed/sim telemetry. This migration adds that transport
-- configuration on the EXISTING connectors + connector_entity_mappings +
-- ingest_batch plane. It does not invent a second staging store, evidence
-- table, or recommendation writer.
--
-- WHAT THIS IS NOT. It is not a certified PI / OSIsoft / vendor historian
-- client. It is not write-back, execute, or autonomous control. It does not
-- loosen ingest_rows (still manual_upload-only — Feature-lane tests hold
-- that). Vendor OAuth, pagination and unattended polling remain unclaimed.
--
-- CONFIG / ENV BOUNDARY. When no plant_historian connector is configured
-- and enabled, simulate_telemetry_tick keeps walking seed sensors and
-- get_plant_historian_status reports unavailable. Surfaces must not label
-- that state as live plant data. Edge credentials live in
-- PLANT_HISTORIAN_CREDENTIALS_JSON; allowed hosts in
-- PLANT_HISTORIAN_ALLOWED_HOSTS. The database stores only an opaque
-- credential_binding_ref and a credential-free HTTPS endpoint_hint.
--
-- Canonical reuse: connectors, connector_runs, ingest_staging,
-- ingest_watermarks, connector_entity_mappings, condition_readings,
-- evidence_items, recommendations, decisions, app_current_org().
-- ============================================================================

-- Allow the shared mapping table to carry the one historian entity the
-- ingest contract already validates. Recovery's eight types stay valid.
alter table public.connector_entity_mappings
  drop constraint if exists connector_entity_mappings_entity_type_check;
alter table public.connector_entity_mappings
  add constraint connector_entity_mappings_entity_type_check
  check (entity_type in (
    'site','asset','work_order','material','material_stock','craft_capacity',
    'operating_state','production_record','condition_reading'
  ));

create or replace function public.plant_historian_allowed_fields()
returns text[] language sql immutable set search_path=public as $$
  select array[
    'external_id','sensor_name','sensor_id','value','taken_at','quality'
  ];
$$;

create or replace function public.plant_historian_required_fields()
returns text[] language sql immutable set search_path=public as $$
  select array['external_id','value','taken_at'];
$$;

revoke all on function public.plant_historian_allowed_fields() from public, anon, authenticated;
revoke all on function public.plant_historian_required_fields() from public, anon, authenticated;

create or replace function public.configure_plant_historian_source(
  p_key text,
  p_name text,
  p_system_kind text,
  p_endpoint_url text,
  p_expected_interval_minutes int,
  p_credential_binding_ref text,
  p_enabled boolean,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text := nullif(trim(coalesce(p_endpoint_url, '')), '');
  v_ref text := nullif(trim(coalesce(p_credential_binding_ref, '')), '');
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error', 'configuring a plant historian source requires an administrator'
    );
  end if;
  if coalesce(length(trim(p_key)), 0) < 3 or coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'connector key and name are required');
  end if;
  if p_system_kind not in ('historian', 'condition_monitoring') then
    return jsonb_build_object(
      'error', 'plant historian source kind must be historian or condition_monitoring'
    );
  end if;
  if exists (
    select 1 from public.connectors
    where organization_id = v_org and connector_key = trim(p_key)
      and connector_type is distinct from 'plant_historian'
  ) then
    return jsonb_build_object(
      'error', 'connector key already belongs to another governed integration contract'
    );
  end if;
  if coalesce(length(trim(p_basis)), 0) < 20 then
    return jsonb_build_object(
      'error', 'record a substantive plant-source authority and basis'
    );
  end if;
  if v_endpoint is not null and (
    v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' or
    v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)'
  ) then
    return jsonb_build_object(
      'error',
      'REST endpoints must be credential-free public HTTPS URLs; private/local targets are blocked'
    );
  end if;
  if v_ref is not null and (
    v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$' or v_ref ~ '[@?=]'
  ) then
    return jsonb_build_object(
      'error',
      'credential binding must be an opaque secret-store URI without a value or query string'
    );
  end if;
  if p_enabled and (
    v_endpoint is null or coalesce(p_expected_interval_minutes, 0) < 1 or v_ref is null
  ) then
    return jsonb_build_object(
      'error',
      'an enabled historian source requires an HTTPS endpoint, expected interval and secret-store binding'
    );
  end if;

  insert into public.connectors (
    organization_id, connector_key, name, connector_type, system_kind,
    endpoint_hint, expected_interval_minutes, credential_binding_ref,
    contract_note, register_ref, status, enabled, direction, write_enabled
  ) values (
    v_org, trim(p_key), trim(p_name), 'plant_historian', p_system_kind,
    v_endpoint, p_expected_interval_minutes, v_ref,
    'Thin read-only plant historian pull. No source-system write-back, execute, or autonomous control.',
    'C2.13',
    case when p_enabled then 'active' else 'configured' end,
    p_enabled, 'read_only', false
  )
  on conflict (organization_id, connector_key) where connector_key is not null
  do update set
    name = excluded.name,
    connector_type = 'plant_historian',
    system_kind = excluded.system_kind,
    endpoint_hint = excluded.endpoint_hint,
    expected_interval_minutes = excluded.expected_interval_minutes,
    credential_binding_ref = excluded.credential_binding_ref,
    contract_note = excluded.contract_note,
    register_ref = 'C2.13',
    status = excluded.status,
    enabled = excluded.enabled,
    direction = 'read_only',
    write_enabled = false
  returning id into v_id;

  insert into public.decisions (
    organization_id, decision_type, action_taken, approval_status, autonomy_mode,
    confidence_score, human_actor, rationale, outcome_status
  ) values (
    v_org, 'plant_historian_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only plant historian ' || trim(p_key),
    'approved', 'manual', 100, auth.uid()::text, trim(p_basis), 'executed'
  );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', p_enabled,
    'direction', 'read_only',
    'write_enabled', false,
    'transport', 'generic_https_json',
    'note', case when p_enabled
      then 'Enabled read-only. Simulator yields for this organization. Pull is user-triggered, not unattended.'
      else 'Saved disabled. Seed/sim telemetry remains in force until an administrator enables the source.'
    end
  );
end
$$;

revoke all on function public.configure_plant_historian_source(
  text, text, text, text, int, text, boolean, text
) from public, anon;
grant execute on function public.configure_plant_historian_source(
  text, text, text, text, int, text, boolean, text
) to authenticated;

create or replace function public.save_plant_historian_mapping(
  p_connector_key text,
  p_source_array_path text,
  p_column_mapping jsonb,
  p_value_mappings jsonb,
  p_constants jsonb,
  p_approve boolean,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_allowed text[] := public.plant_historian_allowed_fields();
  v_required text[] := public.plant_historian_required_fields();
  v_key text;
  v_value jsonb;
  v_missing text[];
  v_id uuid;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error', 'approving a plant historian mapping requires an administrator'
    );
  end if;
  if coalesce(length(trim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'record a substantive mapping basis');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian';
  if not found then
    return jsonb_build_object('error', 'plant historian source not found');
  end if;
  if jsonb_typeof(coalesce(p_column_mapping, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_value_mappings, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_constants, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('error', 'mappings and constants must be JSON objects');
  end if;
  if coalesce(p_source_array_path, '') !~ '^[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object('error', 'source array path is not a safe dotted identifier');
  end if;
  for v_key, v_value in select * from jsonb_each(p_column_mapping) loop
    if not (v_key = any (v_allowed)) then
      return jsonb_build_object(
        'error', format('column mapping target "%s" is outside the condition_reading contract', v_key)
      );
    end if;
    if jsonb_typeof(v_value) <> 'string' or length(trim(v_value #>> '{}')) = 0 then
      return jsonb_build_object('error', 'each column mapping value must be a source field name');
    end if;
  end loop;
  if (coalesce(p_constants::text, '') || coalesce(p_column_mapping::text, ''))
     ~* '(password|api[_ -]?key|bearer[[:space:]]|client[_ -]?secret)' then
    return jsonb_build_object('error', 'mappings must not carry credentials');
  end if;
  select array_agg(field) into v_missing
  from unnest(v_required) as field
  where not (p_column_mapping ? field or p_constants ? field);
  if v_missing is not null then
    return jsonb_build_object(
      'error', 'mapping is missing required condition_reading fields',
      'missing_fields', to_jsonb(v_missing)
    );
  end if;
  if not (
    p_column_mapping ? 'sensor_name' or p_constants ? 'sensor_name'
    or p_column_mapping ? 'sensor_id' or p_constants ? 'sensor_id'
  ) then
    return jsonb_build_object(
      'error', 'map sensor_name or sensor_id — ingested readings bind to an existing tenant sensor'
    );
  end if;

  insert into public.connector_entity_mappings (
    organization_id, connector_id, entity_type, source_array_path,
    column_mapping, value_mappings, constants, status, basis,
    created_by, approved_by, approved_at
  ) values (
    v_org, v_connector.id, 'condition_reading',
    coalesce(p_source_array_path, ''),
    p_column_mapping, coalesce(p_value_mappings, '{}'::jsonb),
    coalesce(p_constants, '{}'::jsonb),
    case when p_approve then 'approved' else 'draft' end,
    trim(p_basis), auth.uid(),
    case when p_approve then auth.uid() end,
    case when p_approve then now() end
  )
  on conflict (connector_id, entity_type) do update set
    source_array_path = excluded.source_array_path,
    column_mapping = excluded.column_mapping,
    value_mappings = excluded.value_mappings,
    constants = excluded.constants,
    status = excluded.status,
    basis = excluded.basis,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'mapping_id', v_id,
    'entity_type', 'condition_reading',
    'status', case when p_approve then 'approved' else 'draft' end,
    'note', case when p_approve
      then 'Mapping approved. A user-triggered pull can now promote condition_reading rows through ingest_batch.'
      else 'Draft mapping saved. Approve it before a pull can write canonical rows.'
    end
  );
end
$$;

revoke all on function public.save_plant_historian_mapping(
  text, text, jsonb, jsonb, jsonb, boolean, text
) from public, anon;
grant execute on function public.save_plant_historian_mapping(
  text, text, jsonb, jsonb, jsonb, boolean, text
) to authenticated;

create or replace function public.get_plant_historian_source(
  p_connector_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in
     ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'plant historian source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian';
  if not found then
    return jsonb_build_object('error', 'plant historian source not found');
  end if;
  select * into v_mapping from public.connector_entity_mappings
  where organization_id = v_org
    and connector_id = v_connector.id
    and entity_type = 'condition_reading';
  if not found then
    return jsonb_build_object('error', 'condition_reading mapping not found');
  end if;
  return jsonb_build_object(
    'connector_key', v_connector.connector_key,
    'name', v_connector.name,
    'system_kind', v_connector.system_kind,
    'enabled', v_connector.enabled,
    'direction', v_connector.direction,
    'write_enabled', v_connector.write_enabled,
    'endpoint_url', v_connector.endpoint_hint,
    'expected_interval_minutes', v_connector.expected_interval_minutes,
    'credential_binding_ref', v_connector.credential_binding_ref,
    'entity_type', 'condition_reading',
    'mapping_status', v_mapping.status,
    'source_array_path', v_mapping.source_array_path,
    'column_mapping', v_mapping.column_mapping,
    'value_mappings', v_mapping.value_mappings,
    'constants', v_mapping.constants
  );
end
$$;

revoke all on function public.get_plant_historian_source(text) from public, anon;
grant execute on function public.get_plant_historian_source(text) to authenticated;

create or replace function public.get_plant_historian_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_backed bigint := 0;
  v_other bigint := 0;
  v_last timestamptz;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select * into v_connector from public.connectors
  where organization_id = v_org and connector_type = 'plant_historian'
  order by enabled desc, last_success_at desc nulls last, created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'configured', false,
      'enabled', false,
      'mapping_approved', false,
      'telemetry_mode', 'seed_sim',
      'connector_key', null,
      'name', null,
      'system_kind', null,
      'last_success_at', null,
      'connector_backed_readings', 0,
      'other_readings', 0,
      'recent', '[]'::jsonb,
      'citable_recommendations', '[]'::jsonb,
      'basis',
        'No plant historian is configured for this organization. '
        || 'Recommendations and condition views continue on seed or simulated telemetry. '
        || 'That is not live plant data.'
    );
  end if;

  select * into v_mapping from public.connector_entity_mappings
  where organization_id = v_org
    and connector_id = v_connector.id
    and entity_type = 'condition_reading';

  select count(*) filter (where source_system = v_connector.connector_key),
         count(*) filter (where source_system is distinct from v_connector.connector_key)
    into v_backed, v_other
  from public.condition_readings
  where organization_id = v_org;

  select c.last_success_at into v_last
  from public.connectors c
  where c.id = v_connector.id;

  return jsonb_build_object(
    'configured', true,
    'enabled', v_connector.enabled,
    'mapping_approved', coalesce(v_mapping.status, '') = 'approved',
    'telemetry_mode', case
      when v_connector.enabled then 'historian_owns'
      else 'seed_sim'
    end,
    'connector_key', v_connector.connector_key,
    'name', v_connector.name,
    'system_kind', v_connector.system_kind,
    'direction', v_connector.direction,
    'write_enabled', v_connector.write_enabled,
    'last_success_at', v_last,
    'connector_backed_readings', v_backed,
    'other_readings', v_other,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'external_id', cr.external_id,
        'asset', a.name,
        'asset_id', cr.asset_id,
        'sensor', s.name,
        'value', cr.value,
        'quality', cr.quality,
        'taken_at', cr.taken_at,
        'source_system', cr.source_system
      ) order by cr.taken_at desc)
      from (
        select * from public.condition_readings
        where organization_id = v_org
          and source_system = v_connector.connector_key
        order by taken_at desc
        limit 8
      ) cr
      left join public.assets a on a.id = cr.asset_id
      left join public.sensors s on s.id = cr.sensor_id
    ), '[]'::jsonb),
    'citable_recommendations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rec.id,
        'title', rec.title,
        'asset_id', rec.asset_id,
        'asset', a.name,
        'status', rec.status
      ) order by rec.created_at desc)
      from (
        select r.id, r.title, r.asset_id, r.status, r.created_at
        from public.recommendations r
        where r.organization_id = v_org
          and r.status = 'pending'
          and r.asset_id in (
            select distinct cr.asset_id from public.condition_readings cr
            where cr.organization_id = v_org
              and cr.source_system = v_connector.connector_key
              and cr.asset_id is not null
          )
        order by r.created_at desc
        limit 8
      ) rec
      left join public.assets a on a.id = rec.asset_id
    ), '[]'::jsonb),
    'basis', case
      when not v_connector.enabled then
        'A plant historian source is saved but not enabled. Seed/sim telemetry remains in force. This is not live plant data.'
      when coalesce(v_mapping.status, '') is distinct from 'approved' then
        'The historian source is enabled but the condition_reading mapping is not approved. Pull cannot promote rows. Seed/sim has yielded; connector-backed evidence is not available yet.'
      when coalesce(v_backed, 0) = 0 then
        'Historian source is enabled and mapped. No connector-backed readings have been pulled yet. Seed/sim no longer walks this organization''s sensors. Trigger a read-only pull from Integrations after the host and credential binding are deployed.'
      else
        format(
          '%s connector-backed reading(s) from source_system=%s. Cite these on a pending recommendation; they are not seed telemetry.',
          v_backed, v_connector.connector_key
        )
    end
  );
end
$$;

revoke all on function public.get_plant_historian_status() from public, anon;
grant execute on function public.get_plant_historian_status() to authenticated;

create or replace function public.begin_plant_historian_run(
  p_connector_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_run uuid;
  v_from timestamptz;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in
     ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'plant historian pull authority denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian';
  if not found or not v_connector.enabled then
    return jsonb_build_object('error', 'active plant historian source not found');
  end if;
  if v_connector.direction <> 'read_only' or v_connector.write_enabled then
    return jsonb_build_object('error', 'plant historian refuses a write-enabled source');
  end if;
  select * into v_mapping from public.connector_entity_mappings
  where organization_id = v_org
    and connector_id = v_connector.id
    and entity_type = 'condition_reading'
    and status = 'approved';
  if not found then
    return jsonb_build_object(
      'error', 'an administrator must approve the condition_reading mapping before pull'
    );
  end if;
  select last_position into v_from
  from public.ingest_watermarks
  where connector_id = v_connector.id and entity_type = 'condition_reading';
  insert into public.connector_runs (
    organization_id, connector_id, entity_type, run_type, status,
    started_at, watermark_from, triggered_by
  ) values (
    v_org, v_connector.id, 'condition_reading', 'sync', 'running',
    now(), v_from, auth.uid()
  ) returning id into v_run;
  return jsonb_build_object('ok', true, 'run_id', v_run, 'watermark_from', v_from);
end
$$;

revoke all on function public.begin_plant_historian_run(text) from public, anon;
grant execute on function public.begin_plant_historian_run(text) to authenticated;

-- Thin wrapper: verify this run belongs to a plant_historian connector in
-- the caller's tenant, then reuse ingest_batch. ingest_rows stays locked
-- to manual_upload (ingestImportDoor.test.ts).
create or replace function public.ingest_plant_historian_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_run public.connector_runs%rowtype;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in
     ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'plant historian ingest authority denied');
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'rows must be a JSON array');
  end if;
  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('error', 'commit batches are limited to 500 rows');
  end if;
  select cr.* into v_run
  from public.connector_runs cr
  join public.connectors c on c.id = cr.connector_id
  where cr.id = p_run_id
    and cr.organization_id = v_org
    and c.organization_id = v_org
    and c.connector_type = 'plant_historian'
    and c.direction = 'read_only'
    and c.write_enabled = false
    and cr.entity_type = 'condition_reading';
  if not found then
    return jsonb_build_object('error', 'plant historian run not found');
  end if;
  return public.ingest_batch(p_run_id, p_rows);
end
$$;

revoke all on function public.ingest_plant_historian_batch(uuid, jsonb) from public, anon;
grant execute on function public.ingest_plant_historian_batch(uuid, jsonb) to authenticated;

create or replace function public.preview_plant_historian_batch(
  p_connector_key text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_mapping public.connector_entity_mappings%rowtype;
  v_row jsonb;
  v_read int := 0;
  v_ok int := 0;
  v_rejected int := 0;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in
     ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'plant historian preview authority denied');
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'rows must be a JSON array');
  end if;
  if jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object('error', 'dry-run batches are limited to 500 rows');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian';
  if not found then
    return jsonb_build_object('error', 'plant historian source not found');
  end if;
  select * into v_mapping from public.connector_entity_mappings
  where organization_id = v_org
    and connector_id = v_connector.id
    and entity_type = 'condition_reading';
  if not found then
    return jsonb_build_object('error', 'save the condition_reading mapping before dry-run validation');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_reason := null;
    if nullif(trim(coalesce(v_row->>'external_id', '')), '') is null then
      v_reason := 'missing external_id';
    elsif v_row->>'value' is null or v_row->>'value' = '' then
      v_reason := 'missing value';
    elsif v_row->>'taken_at' is null or v_row->>'taken_at' = '' then
      v_reason := 'missing taken_at';
    elsif nullif(trim(coalesce(v_row->>'sensor_name', v_row->>'sensor_id', '')), '') is null then
      v_reason := 'missing sensor_name or sensor_id';
    end if;
    if v_reason is null then
      v_ok := v_ok + 1;
    else
      v_rejected := v_rejected + 1;
    end if;
    if v_read <= 100 then
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'row_number', v_read,
          'ok', v_reason is null,
          'reason', v_reason,
          'external_id', v_row->>'external_id'
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', true,
    'read', v_read,
    'accepted', v_ok,
    'duplicate', 0,
    'rejected', v_rejected,
    'results', v_results,
    'note',
      'A dry run never writes canonical or staging rows. '
      || 'Fix every rejected identity/value before commit.'
  );
end
$$;

revoke all on function public.preview_plant_historian_batch(text, jsonb) from public, anon;
grant execute on function public.preview_plant_historian_batch(text, jsonb) to authenticated;

-- Cite connector-backed readings on an existing recommendation. Refuses
-- seed/demo/manual readings: only source_system = the tenant's plant
-- historian connector_key is citable as live plant evidence.
create or replace function public.attach_plant_historian_evidence(
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_rec public.recommendations%rowtype;
  v_connector public.connectors%rowtype;
  v_attached int := 0;
  v_reading record;
  v_desc text;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in
     ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'citing plant historian evidence requires an engineering or administrator role');
  end if;
  select * into v_rec from public.recommendations
  where id = p_recommendation_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  if v_rec.asset_id is null then
    return jsonb_build_object('error', 'recommendation has no asset to cite readings against');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_type = 'plant_historian'
    and enabled
  order by last_success_at desc nulls last, created_at desc
  limit 1;
  if not found then
    return jsonb_build_object(
      'error',
      'no plant historian is configured and enabled — seed/sim telemetry is not citable as live plant evidence'
    );
  end if;

  for v_reading in
    select cr.external_id, cr.value, cr.quality, cr.taken_at, cr.source_system,
           s.name as sensor_name
    from public.condition_readings cr
    left join public.sensors s on s.id = cr.sensor_id and s.organization_id = v_org
    where cr.organization_id = v_org
      and cr.asset_id = v_rec.asset_id
      and cr.source_system = v_connector.connector_key
    order by cr.taken_at desc
    limit 5
  loop
    v_desc := format(
      'Historian reading %s on %s = %s (%s) at %s via connector %s.',
      coalesce(v_reading.external_id, '(no external_id)'),
      coalesce(v_reading.sensor_name, 'sensor'),
      v_reading.value,
      coalesce(v_reading.quality, 'good'),
      v_reading.taken_at,
      v_connector.connector_key
    );
    if exists (
      select 1 from public.evidence_items e
      where e.organization_id = v_org
        and e.recommendation_id = v_rec.id
        and e.source_system = v_connector.connector_key
        and e.description = v_desc
    ) then
      continue;
    end if;
    insert into public.evidence_items (
      organization_id, recommendation_id, asset_id, source_system,
      evidence_type, description, confidence_contribution, data_quality, ts
    ) values (
      v_org, v_rec.id, v_rec.asset_id, v_connector.connector_key,
      'historian_reading', v_desc, 0, coalesce(v_reading.quality, 'good'),
      v_reading.taken_at
    );
    v_attached := v_attached + 1;
  end loop;

  if v_attached = 0 and not exists (
    select 1 from public.condition_readings
    where organization_id = v_org
      and asset_id = v_rec.asset_id
      and source_system = v_connector.connector_key
  ) then
    return jsonb_build_object(
      'error',
      'no connector-backed readings for this asset — seed/sim rows are not attached'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'attached', v_attached,
    'source_system', v_connector.connector_key,
    'recommendation_id', v_rec.id,
    'note', case
      when v_attached = 0 then 'Those historian readings were already cited on this recommendation.'
      else format('Attached %s connector-backed historian reading(s) as evidence.', v_attached)
    end
  );
end
$$;

revoke all on function public.attach_plant_historian_evidence(uuid) from public, anon;
grant execute on function public.attach_plant_historian_evidence(uuid) to authenticated;

-- Simulator must observe the real connectors table. The original yield
-- predicate looked at integrations.name ilike '%historian%', and
-- 20261005090400 deleted the four seeded "connected" integrations because
-- no connector code existed. After that delete the simulator walked every
-- org forever. An enabled plant_historian connector now owns telemetry.
create or replace function public.simulate_telemetry_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_updated int := 0;
  v_new numeric;
  v_drift numeric;
  v_new_status text;
begin
  for s in
    select se.*
    from sensors se
    where se.last_value is not null
      -- A configured, enabled plant historian owns this org's telemetry.
      and not exists (
        select 1 from public.connectors c
        where c.organization_id = se.organization_id
          and c.connector_type = 'plant_historian'
          and c.enabled
          and c.direction = 'read_only'
      )
  loop
    v_drift := (random() - 0.5) * 0.03 * greatest(abs(s.last_value), 1);
    if s.threshold is not null then
      v_drift := v_drift + (s.threshold * 0.8 - s.last_value) * 0.02;
      if random() < 0.02 then
        v_drift := v_drift + s.threshold * 0.12;
      end if;
    end if;
    v_new := round((s.last_value + v_drift)::numeric, 2);
    if v_new < 0 then v_new := 0; end if;

    v_new_status := case
      when s.threshold is null then s.status
      when v_new >= s.threshold then 'alarm'
      when v_new >= s.threshold * 0.9 then 'warning'
      else 'normal' end;

    update sensors set
      last_value = v_new,
      status = v_new_status,
      trend = case
        when v_new > s.last_value * 1.005 then 'up'
        when v_new < s.last_value * 0.995 then 'down'
        else 'stable' end
    where id = s.id;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('sensors_updated', v_updated, 'ran_at', now());
end
$$;

revoke execute on function public.simulate_telemetry_tick() from public, anon, authenticated;
grant execute on function public.simulate_telemetry_tick() to service_role;
