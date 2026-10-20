-- Governed pagination for the existing read-only plant historian adapter
-- (C2.13). The pagination columns were introduced on the ONE canonical
-- public.connectors record by C2.12. This slice reuses those columns and the
-- existing mapping, run, staging, watermark and condition-reading contracts.
-- No historian store, integration queue, workflow or audit plane is added.

comment on column public.connector_runs.source_contract_hash is
  'Immutable hash of the approved connector and mapping contract used to open a CMMS or plant-historian run.';

-- Earlier releases allowed an ai_admin identity to approve mappings. Preserve
-- the mapping content, but require a named human administrator to review it
-- before the source can become active or write canonical readings.
update public.connector_entity_mappings m
set status = 'draft',
    approved_by = null,
    approved_at = null,
    updated_at = now()
from public.connectors c
where c.id = m.connector_id
  and c.organization_id = m.organization_id
  and c.connector_type = 'plant_historian'
  and m.entity_type = 'condition_reading'
  and m.status = 'approved'
  and not exists (
    select 1
    from public.user_profiles approver
    where approver.id = m.approved_by
      and approver.organization_id = m.organization_id
      and approver.role = 'admin'
  );

-- A source without a human-approved mapping must not suppress seed/sim
-- telemetry. It can still be previewed while disabled and then reactivated by
-- a human administrator after approval.
update public.connectors c
set enabled = false,
    status = 'configured'
where c.connector_type = 'plant_historian'
  and c.enabled
  and not exists (
    select 1
    from public.connector_entity_mappings m
    join public.user_profiles approver
      on approver.id = m.approved_by
     and approver.organization_id = m.organization_id
     and approver.role = 'admin'
    where m.organization_id = c.organization_id
      and m.connector_id = c.id
      and m.entity_type = 'condition_reading'
      and m.status = 'approved'
  );

create or replace function public.plant_historian_contract_hash(
  p_connector_id uuid
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(jsonb_build_object(
    'connector_id', c.id,
    'enabled', c.enabled,
    'direction', c.direction,
    'write_enabled', c.write_enabled,
    'system_kind', c.system_kind,
    'endpoint_hint', c.endpoint_hint,
    'expected_interval_minutes', c.expected_interval_minutes,
    'credential_binding_ref', c.credential_binding_ref,
    'pagination_mode', c.pagination_mode,
    'pagination_next_path', c.pagination_next_path,
    'pagination_max_pages', c.pagination_max_pages,
    'mapping_id', m.id,
    'mapping_status', m.status,
    'mapping_updated_at', m.updated_at,
    'mapping_approved_by', m.approved_by,
    'mapping_approved_at', m.approved_at,
    'source_array_path', m.source_array_path,
    'column_mapping', m.column_mapping,
    'value_mappings', m.value_mappings,
    'constants', m.constants,
    'basis', m.basis
  )::text)
  from public.connectors c
  join public.connector_entity_mappings m
    on m.organization_id = c.organization_id
   and m.connector_id = c.id
   and m.entity_type = 'condition_reading'
  where c.id = p_connector_id
    and c.organization_id = public.app_current_org()
    and c.connector_type = 'plant_historian';
$$;

revoke all on function public.plant_historian_contract_hash(uuid)
  from public, anon, authenticated;

drop function if exists public.configure_plant_historian_source(
  text, text, text, text, int, text, boolean, text
);

create or replace function public.configure_plant_historian_source(
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
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text := nullif(trim(coalesce(p_endpoint_url, '')), '');
  v_ref text := nullif(trim(coalesce(p_credential_binding_ref, '')), '');
  v_mode text := lower(trim(coalesce(p_pagination_mode, 'none')));
  v_next_path text := nullif(trim(coalesce(p_pagination_next_path, '')), '');
  v_max_pages int := coalesce(p_pagination_max_pages, 1);
  v_enabled boolean := coalesce(p_enabled, false);
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object(
      'error', 'configuring a plant historian source requires a named human administrator'
    );
  end if;
  if coalesce(length(trim(p_key)), 0) < 3
     or coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'connector key and name are required');
  end if;
  if coalesce(p_system_kind, '') not in ('historian', 'condition_monitoring') then
    return jsonb_build_object(
      'error', 'plant historian source kind must be historian or condition_monitoring'
    );
  end if;
  if exists (
    select 1 from public.connectors
    where organization_id = v_org
      and connector_key = trim(p_key)
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
    v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
    or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)'
  ) then
    return jsonb_build_object(
      'error',
      'REST endpoints must be credential-free public HTTPS URLs; private/local targets are blocked'
    );
  end if;
  if v_ref is not null and (
    v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
    or v_ref ~ '[@?=#]'
  ) then
    return jsonb_build_object(
      'error',
      'credential binding must be an opaque secret-store URI without a value or query string'
    );
  end if;
  if v_mode not in ('none', 'next_url') then
    return jsonb_build_object('error', 'pagination mode must be none or next_url');
  end if;
  if v_mode = 'none' then
    v_next_path := null;
    v_max_pages := 1;
  elsif v_next_path is null
        or v_next_path !~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object(
      'error', 'next_url pagination requires a safe dotted next-page path'
    );
  elsif v_max_pages not between 2 and 100 then
    return jsonb_build_object(
      'error', 'pagination maximum must be between 2 and 100 pages'
    );
  end if;
  if v_enabled and (
    v_endpoint is null
    or coalesce(p_expected_interval_minutes, 0) < 1
    or v_ref is null
  ) then
    return jsonb_build_object(
      'error',
      'an enabled historian source requires an HTTPS endpoint, expected interval and secret-store binding'
    );
  end if;
  if v_enabled and not exists (
    select 1
    from public.connectors c
    join public.connector_entity_mappings m
      on m.organization_id = c.organization_id
     and m.connector_id = c.id
     and m.entity_type = 'condition_reading'
     and m.status = 'approved'
    join public.user_profiles approver
      on approver.id = m.approved_by
     and approver.organization_id = m.organization_id
     and approver.role = 'admin'
    where c.organization_id = v_org
      and c.connector_key = trim(p_key)
      and c.connector_type = 'plant_historian'
  ) then
    return jsonb_build_object(
      'error', 'a named human administrator must approve the condition_reading mapping before activation'
    );
  end if;

  insert into public.connectors (
    organization_id, connector_key, name, connector_type, system_kind,
    endpoint_hint, expected_interval_minutes, credential_binding_ref,
    contract_note, register_ref, status, enabled, direction, write_enabled,
    pagination_mode, pagination_next_path, pagination_max_pages
  ) values (
    v_org, trim(p_key), trim(p_name), 'plant_historian', p_system_kind,
    v_endpoint, p_expected_interval_minutes, v_ref,
    'Bounded read-only plant historian pull. No source-system write-back, execute, or autonomous control.',
    'C2.13', case when v_enabled then 'active' else 'configured' end,
    v_enabled, 'read_only', false, v_mode, v_next_path, v_max_pages
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
    write_enabled = false,
    pagination_mode = excluded.pagination_mode,
    pagination_next_path = excluded.pagination_next_path,
    pagination_max_pages = excluded.pagination_max_pages
  returning id into v_id;

  insert into public.decisions (
    organization_id, decision_type, action_taken, approval_status,
    autonomy_mode, confidence_score, human_actor, rationale, outcome_status
  ) values (
    v_org, 'plant_historian_source',
    case when v_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only plant historian ' || trim(p_key)
      || ' with pagination mode ' || v_mode,
    'approved', 'manual', 100, auth.uid()::text, trim(p_basis), 'executed'
  );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', v_enabled,
    'direction', 'read_only',
    'write_enabled', false,
    'transport', 'bounded_https_json',
    'pagination_mode', v_mode,
    'pagination_next_path', v_next_path,
    'pagination_max_pages', v_max_pages,
    'note', case when v_enabled
      then 'Enabled bounded read-only historian pull. Simulator yields for this organization. Pull remains user-triggered, not unattended.'
      else 'Saved disabled. Seed/sim telemetry remains in force until an administrator enables the source.'
    end
  );
end
$$;

revoke all on function public.configure_plant_historian_source(
  text, text, text, text, int, text, text, text, int, boolean, text
) from public, anon;
grant execute on function public.configure_plant_historian_source(
  text, text, text, text, int, text, text, text, int, boolean, text
) to authenticated;

create or replace function public.get_plant_historian_source(
  p_connector_key text
) returns jsonb
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
    'credential_tenant_id', v_org,
    'entity_type', 'condition_reading',
    'mapping_status', case
      when v_mapping.status = 'approved' and exists (
        select 1
        from public.user_profiles approver
        where approver.id = v_mapping.approved_by
          and approver.organization_id = v_org
          and approver.role = 'admin'
      ) then 'approved'
      else 'draft'
    end,
    'source_array_path', v_mapping.source_array_path,
    'column_mapping', v_mapping.column_mapping,
    'value_mappings', v_mapping.value_mappings,
    'constants', v_mapping.constants,
    'pagination_mode', v_connector.pagination_mode,
    'pagination_next_path', v_connector.pagination_next_path,
    'pagination_max_pages', v_connector.pagination_max_pages,
    'contract_hash', public.plant_historian_contract_hash(v_connector.id),
    'can_commit', coalesce(v_role, '') in (
      'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
    )
  );
end
$$;

revoke all on function public.get_plant_historian_source(text) from public, anon;
grant execute on function public.get_plant_historian_source(text) to authenticated;

-- Mapping approval is a human governance act. Any mapping change disables the
-- source so the approved transport and mapping contract must be reactivated
-- explicitly after review.
create or replace function public.save_plant_historian_mapping(
  p_connector_key text,
  p_source_array_path text,
  p_column_mapping jsonb,
  p_value_mappings jsonb,
  p_constants jsonb,
  p_approve boolean,
  p_basis text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_key text;
  v_value jsonb;
  v_nested_key text;
  v_nested_value jsonb;
  v_missing text[];
  v_id uuid;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object(
      'error', 'approving or changing a plant historian mapping requires a named human administrator'
    );
  end if;
  if coalesce(length(trim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'record a substantive mapping basis');
  end if;
  if coalesce(p_source_array_path, '') !~ '^[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$' then
    return jsonb_build_object('error', 'source array path is not a safe dotted identifier');
  end if;
  select * into v_connector
  from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian'
  for update;
  if not found then
    return jsonb_build_object('error', 'plant historian source not found');
  end if;
  if jsonb_typeof(coalesce(p_column_mapping, 'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_value_mappings, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_constants, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('error', 'mappings and constants must be JSON objects');
  end if;
  for v_key, v_value in select * from jsonb_each(p_column_mapping) loop
    if not (v_key = any(public.plant_historian_allowed_fields())) then
      return jsonb_build_object(
        'error', format('column mapping target "%s" is outside the condition_reading contract', v_key)
      );
    end if;
    if jsonb_typeof(v_value) <> 'string'
       or trim(v_value #>> '{}') !~ '^[A-Za-z0-9_-]+$' then
      return jsonb_build_object(
        'error', 'each column mapping value must be a simple source field name'
      );
    end if;
  end loop;
  for v_key, v_value in select * from jsonb_each(coalesce(p_constants, '{}'::jsonb)) loop
    if not (v_key = any(public.plant_historian_allowed_fields()))
       or jsonb_typeof(v_value) in ('array', 'object', 'null') then
      return jsonb_build_object(
        'error', 'constants must be scalar values inside the condition_reading contract'
      );
    end if;
  end loop;
  for v_key, v_value in select * from jsonb_each(coalesce(p_value_mappings, '{}'::jsonb)) loop
    if not (v_key = any(public.plant_historian_allowed_fields()))
       or jsonb_typeof(v_value) <> 'object' then
      return jsonb_build_object(
        'error', 'value mappings must be objects keyed by an approved condition_reading field'
      );
    end if;
    for v_nested_key, v_nested_value in select * from jsonb_each(v_value) loop
      if length(v_nested_key) = 0
         or jsonb_typeof(v_nested_value) not in ('string', 'number', 'boolean') then
        return jsonb_build_object('error', 'value mapping entries must map a source value to a scalar');
      end if;
    end loop;
  end loop;
  if (coalesce(p_constants::text, '') || coalesce(p_column_mapping::text, '')
      || coalesce(p_value_mappings::text, ''))
     ~* '(password|api[_ -]?key|bearer[[:space:]]|client[_ -]?secret)' then
    return jsonb_build_object('error', 'mappings must not carry credentials');
  end if;
  select array_agg(field) into v_missing
  from unnest(public.plant_historian_required_fields()) as field
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
      'error', 'map sensor_name or sensor_id — readings must bind to one existing tenant sensor'
    );
  end if;

  insert into public.connector_entity_mappings (
    organization_id, connector_id, entity_type, source_array_path,
    column_mapping, value_mappings, constants, status, basis,
    created_by, approved_by, approved_at
  ) values (
    v_org, v_connector.id, 'condition_reading',
    coalesce(p_source_array_path, ''), p_column_mapping,
    coalesce(p_value_mappings, '{}'::jsonb),
    coalesce(p_constants, '{}'::jsonb),
    case when coalesce(p_approve, false) then 'approved' else 'draft' end,
    trim(p_basis), auth.uid(),
    case when coalesce(p_approve, false) then auth.uid() end,
    case when coalesce(p_approve, false) then now() end
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

  update public.connectors
  set enabled = false,
      status = 'configured'
  where id = v_connector.id and organization_id = v_org;

  return jsonb_build_object(
    'ok', true,
    'mapping_id', v_id,
    'entity_type', 'condition_reading',
    'status', case when coalesce(p_approve, false) then 'approved' else 'draft' end,
    'source_disabled', true,
    'note', case when coalesce(p_approve, false)
      then 'Mapping approved by a named human. Review and reactivate the source before a human-triggered pull.'
      else 'Draft mapping saved. A named human administrator must approve it before activation.'
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

-- One validator is shared by preview and commit so a dry run cannot accept a
-- row that canonical promotion rejects. It resolves a sensor inside the
-- active tenant, refuses ambiguous names, validates quality/value/time, and
-- reports the exact replay key used by canonical condition_readings.
create or replace function public.plant_historian_validate_row(
  p_connector_key text,
  p_row jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_ext text;
  v_sensor_ids uuid[];
  v_sensor uuid;
  v_sensor_name text;
  v_asset uuid;
  v_value numeric;
  v_taken_at timestamptz;
  v_quality text;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'active tenant is required');
  end if;
  if coalesce(jsonb_typeof(p_row), 'null') <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'row must be a JSON object');
  end if;
  if exists (
    select 1 from jsonb_each(p_row) item
    where jsonb_typeof(item.value) in ('array', 'object')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'canonical row values must be scalar');
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_row) field
    where not (field = any(public.plant_historian_allowed_fields()))
  ) then
    return jsonb_build_object(
      'ok', false, 'reason', 'row contains a field outside the approved condition_reading contract'
    );
  end if;
  v_ext := nullif(trim(coalesce(p_row->>'external_id', '')), '');
  if v_ext is null then
    return jsonb_build_object(
      'ok', false, 'reason', 'missing external_id: replay-safe source identity is required'
    );
  end if;
  if length(v_ext) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'external_id exceeds 200 characters');
  end if;

  begin
    if nullif(trim(coalesce(p_row->>'value', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'missing value');
    end if;
    v_value := trim(p_row->>'value')::numeric;
    if not public.sync_is_finite_numeric(v_value) then
      return jsonb_build_object('ok', false, 'reason', 'value must be a finite number');
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'value must be a finite number');
  end;

  begin
    if nullif(trim(coalesce(p_row->>'taken_at', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'missing taken_at');
    end if;
    v_taken_at := trim(p_row->>'taken_at')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'taken_at must be a valid timestamp');
  end;
  if v_taken_at > now() + interval '1 hour' then
    return jsonb_build_object(
      'ok', false, 'reason', 'taken_at is in the future: check the source clock or timezone'
    );
  end if;

  v_quality := lower(trim(coalesce(nullif(p_row->>'quality', ''), 'good')));
  if v_quality not in ('good', 'suspect', 'bad', 'substituted') then
    return jsonb_build_object(
      'ok', false, 'reason', 'quality must be good, suspect, bad or substituted'
    );
  end if;
  if nullif(trim(coalesce(p_row->>'sensor_id', p_row->>'sensor_name', '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'missing sensor_id or sensor_name');
  end if;

  select array_agg(s.id order by s.id)
    into v_sensor_ids
  from public.sensors s
  where s.organization_id = v_org
    and (
      (nullif(trim(p_row->>'sensor_id'), '') is not null
       and s.id::text = trim(p_row->>'sensor_id'))
      or
      (nullif(trim(p_row->>'sensor_name'), '') is not null
       and s.name = trim(p_row->>'sensor_name'))
    );
  if coalesce(array_length(v_sensor_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', format('unknown tenant sensor "%s"', coalesce(p_row->>'sensor_id', p_row->>'sensor_name', '(none)'))
    );
  end if;
  if array_length(v_sensor_ids, 1) > 1 then
    return jsonb_build_object(
      'ok', false,
      'reason', format('sensor reference matches %s tenant sensors; use one unambiguous sensor_id', array_length(v_sensor_ids, 1))
    );
  end if;
  v_sensor := v_sensor_ids[1];
  select asset_id, name into v_asset, v_sensor_name
  from public.sensors
  where organization_id = v_org and id = v_sensor;
  if nullif(trim(p_row->>'sensor_id'), '') is not null
     and nullif(trim(p_row->>'sensor_name'), '') is not null
     and v_sensor_name is distinct from trim(p_row->>'sensor_name') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'sensor_id and sensor_name identify different tenant sensors'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'external_id', v_ext,
    'sensor_id', v_sensor,
    'asset_id', v_asset,
    'value', v_value,
    'taken_at', v_taken_at,
    'quality', v_quality,
    'duplicate', exists (
      select 1 from public.condition_readings
      where organization_id = v_org
        and source_system = trim(p_connector_key)
        and external_id = v_ext
    )
  );
end
$$;

revoke all on function public.plant_historian_validate_row(text, jsonb)
  from public, anon, authenticated;

drop function if exists public.begin_plant_historian_run(text);

create or replace function public.begin_plant_historian_run(
  p_connector_key text,
  p_expected_contract_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_run uuid;
  v_from timestamptz;
  v_contract_hash text;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in (
    'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
  ) then
    return jsonb_build_object(
      'error', 'a named human planning, engineering, maintenance or administrator role must trigger the historian pull'
    );
  end if;
  select * into v_connector
  from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian'
  for update;
  if not found
     or not v_connector.enabled
     or v_connector.direction <> 'read_only'
     or v_connector.write_enabled then
    return jsonb_build_object('error', 'active read-only plant historian source not found');
  end if;
  if not exists (
    select 1
    from public.connector_entity_mappings m
    join public.user_profiles approver
      on approver.id = m.approved_by
     and approver.organization_id = m.organization_id
     and approver.role = 'admin'
    where m.organization_id = v_org
      and m.connector_id = v_connector.id
      and m.entity_type = 'condition_reading'
      and m.status = 'approved'
  ) then
    return jsonb_build_object(
      'error', 'a named human administrator must approve the condition_reading mapping before pull'
    );
  end if;
  if exists (
    select 1 from public.connector_runs
    where organization_id = v_org
      and connector_id = v_connector.id
      and entity_type = 'condition_reading'
      and status = 'running'
  ) then
    return jsonb_build_object('error', 'a plant historian condition_reading pull is already running');
  end if;
  v_contract_hash := public.plant_historian_contract_hash(v_connector.id);
  if coalesce(p_expected_contract_hash, '') !~ '^[0-9a-f]{32}$'
     or v_contract_hash is null
     or v_contract_hash is distinct from p_expected_contract_hash then
    return jsonb_build_object(
      'error', 'plant historian source or mapping changed after transport began; run a fresh pull'
    );
  end if;
  select last_position into v_from
  from public.ingest_watermarks
  where connector_id = v_connector.id and entity_type = 'condition_reading';
  insert into public.connector_runs (
    organization_id, connector_id, entity_type, run_type, status, started_at,
    watermark_from, triggered_by, source_contract_hash
  ) values (
    v_org, v_connector.id, 'condition_reading', 'sync', 'running', now(),
    v_from, auth.uid(), v_contract_hash
  ) returning id into v_run;
  return jsonb_build_object(
    'ok', true, 'run_id', v_run, 'watermark_from', v_from,
    'contract_hash', v_contract_hash
  );
end
$$;

revoke all on function public.begin_plant_historian_run(text, text)
  from public, anon;
grant execute on function public.begin_plant_historian_run(text, text)
  to authenticated;

create or replace function public.preview_plant_historian_batch(
  p_connector_key text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_connector public.connectors%rowtype;
  v_row jsonb;
  v_result jsonb;
  v_ext text;
  v_reason text;
  v_seen_ids text[] := '{}';
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_results jsonb := '[]'::jsonb;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in (
    'planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin'
  ) then
    return jsonb_build_object('error', 'plant historian preview authority denied');
  end if;
  if coalesce(jsonb_typeof(p_rows), 'null') <> 'array'
     or jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object(
      'error', 'plant historian rows must be a JSON array of at most 500 rows'
    );
  end if;
  select * into v_connector
  from public.connectors
  where organization_id = v_org
    and connector_key = trim(p_connector_key)
    and connector_type = 'plant_historian'
    and direction = 'read_only'
    and not write_enabled;
  if not found then
    return jsonb_build_object('error', 'read-only plant historian source not found');
  end if;
  if not exists (
    select 1 from public.connector_entity_mappings
    where organization_id = v_org
      and connector_id = v_connector.id
      and entity_type = 'condition_reading'
  ) then
    return jsonb_build_object(
      'error', 'save the condition_reading mapping before dry-run validation'
    );
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_result := '{}'::jsonb;
    v_ext := nullif(trim(v_row->>'external_id'), '');
    v_reason := null;
    if v_ext is not null and v_ext = any(v_seen_ids) then
      v_reason := format('external_id "%s" appears more than once in this pull', v_ext);
    elsif v_ext is not null then
      v_seen_ids := v_seen_ids || v_ext;
    end if;
    if v_reason is null then
      v_result := public.plant_historian_validate_row(v_connector.connector_key, v_row);
      if not coalesce((v_result->>'ok')::boolean, false) then
        v_reason := v_result->>'reason';
      elsif coalesce((v_result->>'duplicate')::boolean, false) then
        v_duplicate := v_duplicate + 1;
      else
        v_ok := v_ok + 1;
      end if;
    end if;
    if v_reason is not null then
      v_rejected := v_rejected + 1;
    end if;
    if v_read <= 100 then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row_number', v_read,
        'ok', v_reason is null and not coalesce((v_result->>'duplicate')::boolean, false),
        'outcome', case
          when v_reason is not null then 'rejected'
          when coalesce((v_result->>'duplicate')::boolean, false) then 'duplicate'
          else 'accepted'
        end,
        'reason', v_reason,
        'external_id', v_ext
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'dry_run', true,
    'read', v_read,
    'accepted', v_ok,
    'duplicate', v_duplicate,
    'rejected', v_rejected,
    'results', v_results,
    'note', 'Dry run used the canonical commit validator and wrote no canonical or staging rows.'
  );
end
$$;

revoke all on function public.preview_plant_historian_batch(text, jsonb)
  from public, anon;
grant execute on function public.preview_plant_historian_batch(text, jsonb)
  to authenticated;

create or replace function public.ingest_plant_historian_batch(
  p_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_run public.connector_runs%rowtype;
  v_connector public.connectors%rowtype;
  v_result jsonb;
  v_record jsonb;
  v_row jsonb;
  v_ext text;
  v_reason text;
  v_seen_ids text[] := '{}';
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_max_ts timestamptz;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in (
    'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
  ) then
    return jsonb_build_object(
      'error', 'a named human planning, engineering, maintenance or administrator role must ingest historian rows'
    );
  end if;
  if coalesce(jsonb_typeof(p_rows), 'null') <> 'array'
     or jsonb_array_length(p_rows) > 500 then
    return jsonb_build_object(
      'error', 'plant historian rows must be a JSON array of at most 500 rows'
    );
  end if;
  select cr.* into v_run
  from public.connector_runs cr
  join public.connectors c
    on c.id = cr.connector_id and c.organization_id = cr.organization_id
  where cr.id = p_run_id
    and cr.organization_id = v_org
    and cr.status = 'running'
    and cr.entity_type = 'condition_reading'
    and c.organization_id = v_org
    and c.connector_type = 'plant_historian'
    and c.enabled
    and c.direction = 'read_only'
    and not c.write_enabled
    and cr.triggered_by = auth.uid()
  for update of cr;
  if not found then
    return jsonb_build_object('error', 'active running read-only plant historian run not found');
  end if;
  select * into v_connector
  from public.connectors
  where id = v_run.connector_id and organization_id = v_org;
  if not exists (
    select 1
    from public.connector_entity_mappings m
    join public.user_profiles approver
      on approver.id = m.approved_by
     and approver.organization_id = m.organization_id
     and approver.role = 'admin'
    where m.organization_id = v_org
      and m.connector_id = v_connector.id
      and m.entity_type = 'condition_reading'
      and m.status = 'approved'
  ) then
    return jsonb_build_object('error', 'human-approved condition_reading mapping not found for this run');
  end if;
  if v_run.source_contract_hash is null
     or v_run.source_contract_hash is distinct from
       public.plant_historian_contract_hash(v_connector.id) then
    return jsonb_build_object(
      'error', 'plant historian source or mapping changed during this run; no further rows were ingested'
    );
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_result := '{}'::jsonb;
    v_record := '{}'::jsonb;
    v_ext := nullif(trim(v_row->>'external_id'), '');
    v_reason := null;

    if v_ext is not null and v_ext = any(v_seen_ids) then
      v_reason := format('external_id "%s" appears more than once in this pull', v_ext);
    elsif v_ext is not null then
      v_seen_ids := v_seen_ids || v_ext;
    end if;
    if v_reason is null then
      v_result := public.plant_historian_validate_row(v_connector.connector_key, v_row);
      if not coalesce((v_result->>'ok')::boolean, false) then
        v_reason := v_result->>'reason';
      end if;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected + 1;
      insert into public.ingest_staging (
        organization_id, connector_id, run_id, entity_type, external_id,
        payload, status, reject_reason
      ) values (
        v_org, v_connector.id, p_run_id, 'condition_reading', v_ext,
        v_row, 'rejected', v_reason
      );
      continue;
    end if;
    if coalesce((v_result->>'duplicate')::boolean, false) then
      v_duplicate := v_duplicate + 1;
      insert into public.ingest_staging (
        organization_id, connector_id, run_id, entity_type, external_id,
        payload, status
      ) values (
        v_org, v_connector.id, p_run_id, 'condition_reading', v_ext,
        v_row, 'duplicate'
      );
      continue;
    end if;

    begin
      v_record := public.record_condition_reading(
        (v_result->>'sensor_id')::uuid,
        (v_result->>'value')::numeric,
        (v_result->>'taken_at')::timestamptz,
        v_result->>'quality',
        v_connector.connector_key,
        v_ext
      );
      if v_record ? 'error' then
        v_reason := v_record->>'error';
      end if;
    exception
      when unique_violation then
        v_duplicate := v_duplicate + 1;
        insert into public.ingest_staging (
          organization_id, connector_id, run_id, entity_type, external_id,
          payload, status
        ) values (
          v_org, v_connector.id, p_run_id, 'condition_reading', v_ext,
          v_row, 'duplicate'
        );
        continue;
      when others then
        v_reason := format('the database refused this row: %s', sqlerrm);
    end;

    if v_reason is not null then
      v_rejected := v_rejected + 1;
      insert into public.ingest_staging (
        organization_id, connector_id, run_id, entity_type, external_id,
        payload, status, reject_reason
      ) values (
        v_org, v_connector.id, p_run_id, 'condition_reading', v_ext,
        v_row, 'rejected', v_reason
      );
    else
      v_ok := v_ok + 1;
      v_max_ts := greatest(
        coalesce(v_max_ts, (v_result->>'taken_at')::timestamptz),
        (v_result->>'taken_at')::timestamptz
      );
      insert into public.ingest_staging (
        organization_id, connector_id, run_id, entity_type, external_id,
        payload, status
      ) values (
        v_org, v_connector.id, p_run_id, 'condition_reading', v_ext,
        v_row, 'accepted'
      );
    end if;
  end loop;

  update public.connector_runs
  set records_read = records_read + v_read,
      records_accepted = records_accepted + v_ok,
      records_rejected = records_rejected + v_rejected,
      records_duplicate = records_duplicate + v_duplicate,
      watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id and organization_id = v_org;

  return jsonb_build_object(
    'read', v_read,
    'accepted', v_ok,
    'duplicate', v_duplicate,
    'rejected', v_rejected
  );
end
$$;

revoke all on function public.ingest_plant_historian_batch(uuid, jsonb)
  from public, anon;
grant execute on function public.ingest_plant_historian_batch(uuid, jsonb)
  to authenticated;

-- Preserve the shared connector lifecycle while requiring the same human to
-- open, ingest and finish CMMS or historian promotion runs. Only a completely
-- clean success advances the canonical watermark.
create or replace function public.finish_connector_run(
  p_run_id uuid,
  p_status text default 'success',
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  r public.connector_runs%rowtype;
  c public.connectors%rowtype;
begin
  select * into r
  from public.connector_runs
  where id = p_run_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  select * into c
  from public.connectors
  where id = r.connector_id and organization_id = v_org;

  if c.connector_type in ('cmms_read', 'plant_historian') then
    select role into v_role from public.user_profiles where id = auth.uid();
    if coalesce(v_role, '') not in (
      'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
    ) or r.triggered_by is distinct from auth.uid() then
      return jsonb_build_object(
        'error', 'the named human who triggered this governed pull must finish it'
      );
    end if;
    if r.status <> 'running' then
      return jsonb_build_object('error', 'governed connector run is not running');
    end if;
  end if;
  if p_status not in ('success', 'partial', 'failure') then
    return jsonb_build_object('error', 'run status must be success, partial or failure');
  end if;

  update public.connector_runs
  set status = p_status,
      finished_at = now(),
      error_message = p_error,
      records_processed = records_accepted
  where id = p_run_id and organization_id = v_org;

  if p_status = 'success'
     and r.records_rejected = 0
     and r.watermark_to is not null then
    insert into public.ingest_watermarks (
      organization_id, connector_id, entity_type, last_position, last_run_id
    ) values (
      v_org, r.connector_id, r.entity_type, r.watermark_to, p_run_id
    )
    on conflict (connector_id, entity_type) do update set
      last_position = greatest(
        public.ingest_watermarks.last_position, excluded.last_position
      ),
      last_run_id = excluded.last_run_id,
      updated_at = now();
  end if;

  update public.connectors
  set last_success_at = case
        when p_status = 'success' then now() else last_success_at end,
      last_failure_at = case
        when p_status <> 'success' then now() else last_failure_at end
  where id = r.connector_id and organization_id = v_org;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', p_status,
    'watermark_advanced',
      p_status = 'success'
      and r.records_rejected = 0
      and r.watermark_to is not null,
    'records_rejected', r.records_rejected
  );
end
$$;

revoke all on function public.finish_connector_run(uuid, text, text)
  from public, anon;
grant execute on function public.finish_connector_run(uuid, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
