-- Governed pagination for the existing read-only plant historian adapter
-- (C2.13). The pagination columns were introduced on the ONE canonical
-- public.connectors record by C2.12. This slice reuses those columns and the
-- existing mapping, run, staging, watermark and condition-reading contracts.
-- No historian store, integration queue, workflow or audit plane is added.

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
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or coalesce(v_role, '') not in ('admin', 'ai_admin') then
    return jsonb_build_object(
      'error', 'configuring a plant historian source requires an administrator'
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
  if p_enabled and (
    v_endpoint is null
    or coalesce(p_expected_interval_minutes, 0) < 1
    or v_ref is null
  ) then
    return jsonb_build_object(
      'error',
      'an enabled historian source requires an HTTPS endpoint, expected interval and secret-store binding'
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
    'C2.13', case when p_enabled then 'active' else 'configured' end,
    p_enabled, 'read_only', false, v_mode, v_next_path, v_max_pages
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
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only plant historian ' || trim(p_key)
      || ' with pagination mode ' || v_mode,
    'approved', 'manual', 100, auth.uid()::text, trim(p_basis), 'executed'
  );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', p_enabled,
    'direction', 'read_only',
    'write_enabled', false,
    'transport', 'bounded_https_json',
    'pagination_mode', v_mode,
    'pagination_next_path', v_next_path,
    'pagination_max_pages', v_max_pages,
    'note', case when p_enabled
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
    'entity_type', 'condition_reading',
    'mapping_status', v_mapping.status,
    'source_array_path', v_mapping.source_array_path,
    'column_mapping', v_mapping.column_mapping,
    'value_mappings', v_mapping.value_mappings,
    'constants', v_mapping.constants,
    'pagination_mode', v_connector.pagination_mode,
    'pagination_next_path', v_connector.pagination_next_path,
    'pagination_max_pages', v_connector.pagination_max_pages
  );
end
$$;

revoke all on function public.get_plant_historian_source(text) from public, anon;
grant execute on function public.get_plant_historian_source(text) to authenticated;
