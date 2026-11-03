-- C2.20 — governed read-only OPC-UA adapter.
--
-- One connector names one opc.tcp endpoint, one security mode/policy, one
-- authentication mode and an explicit node list. The Deno edge function does
-- not open OPC-UA TCP. A customer-boundary gateway shim performs Hello,
-- OpenSecureChannel, CreateSession, ActivateSession and Read, then closes.
-- Write and Call are refused. Readings are evidence in the existing staging
-- plane; this migration does not invent a sensor, asset or condition series.

create or replace function public.opc_ua_node_list_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path=public
as $$
declare
  v_item text;
  v_node text;
  v_seen text[] := '{}';
  v_ns text;
  v_num text;
begin
  if coalesce(jsonb_typeof(p_value), '') <> 'array'
     or jsonb_array_length(p_value) not between 1 and 50 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements_text(p_value) loop
    v_node := btrim(v_item);
    if v_node is null
       or length(v_node) not between 1 and 512
       or v_node <> v_item
       or v_node ~ '[[:cntrl:]]'
       or v_node = any(v_seen)
       or v_node !~ '^(i=[0-9]{1,10}|ns=[0-9]{1,5};i=[0-9]{1,10}|s=[^[:space:]](.*[^[:space:]])?|ns=[0-9]{1,5};s=[^[:space:]].*)$' then
      return false;
    end if;
    if v_node ~ '^ns=' then
      v_ns := substring(v_node from '^ns=([0-9]+)');
      if v_ns is null or v_ns::numeric > 65535 then
        return false;
      end if;
    end if;
    if v_node ~ '(^|;)i=' then
      v_num := substring(v_node from 'i=([0-9]+)$');
      if v_num is null or v_num::numeric > 4294967295 then
        return false;
      end if;
    end if;
    v_seen := v_seen || v_node;
  end loop;
  return true;
end
$$;

revoke all on function public.opc_ua_node_list_valid(jsonb)
  from public, anon, authenticated;

-- The original inline check is connectors_system_kind_check. Replace it with
-- the same list plus opc_ua so this profile can be stored.
alter table public.connectors
  drop constraint if exists connectors_system_kind_check;
alter table public.connectors
  add constraint connectors_system_kind_check check (
    system_kind is null
    or system_kind in (
      'historian', 'cmms', 'eam', 'erp', 'inventory',
      'condition_monitoring', 'document', 'scheduling', 'data_lake',
      'financial', 'file', 'opc_ua'
    )
  );

alter table public.connectors
  add column if not exists opcua_security_mode text,
  add column if not exists opcua_security_policy text,
  add column if not exists opcua_auth_mode text,
  add column if not exists opcua_node_ids jsonb;

alter table public.connectors
  drop constraint if exists connectors_opc_ua_read_profile_check;
alter table public.connectors
  add constraint connectors_opc_ua_read_profile_check check (
    connector_type is distinct from 'opc_ua_read'
    or (
      system_kind = 'opc_ua'
      and connector_profile = 'opc_ua_binary_read'
      and opcua_security_mode in ('None', 'Sign', 'SignAndEncrypt')
      and opcua_security_policy in (
        'None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'
      )
      and opcua_auth_mode in ('anonymous', 'username')
      and public.opc_ua_node_list_valid(opcua_node_ids)
      and endpoint_hint ~* '^opc\.tcp://[a-z0-9.-]+:[0-9]{1,5}(/[^[:space:]?#]*)?$'
      and pagination_mode = 'none'
      and pagination_next_path is null
      and pagination_max_pages = 1
      and direction = 'read_only'
      and not write_enabled
    )
  );

comment on column public.connectors.opcua_security_mode is
  'Administrator-selected OPC UA MessageSecurityMode. Sign and SignAndEncrypt are stored and refused by the None-only shim; they are never downgraded.';
comment on column public.connectors.opcua_security_policy is
  'Administrator-selected OPC UA security policy paired with opcua_security_mode.';
comment on column public.connectors.opcua_auth_mode is
  'anonymous or username. The username and password stay in the edge secret registry.';
comment on column public.connectors.opcua_node_ids is
  'Explicit OPC UA node ids this connector may read. The pull request cannot widen the list.';

create or replace function public.configure_opc_ua_read_source(
  p_key text,
  p_name text,
  p_endpoint_url text,
  p_security_mode text,
  p_security_policy text,
  p_auth_mode text,
  p_node_ids jsonb,
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
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
  v_endpoint text := nullif(btrim(coalesce(p_endpoint_url, '')), '');
  v_ref text := nullif(btrim(coalesce(p_credential_binding_ref, '')), '');
  v_port int;
begin
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'a named human administrator must configure or enable an OPC-UA source');
  end if;
  if v_org is null or coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('error', 'configuring an OPC-UA source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)), 0) not between 3 and 160
     or coalesce(length(btrim(p_name)), 0) not between 3 and 160 then
    return jsonb_build_object('error', 'connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)), 0) not between 20 and 2000 then
    return jsonb_build_object('error', 'record a substantive bounded OPC-UA activation basis');
  end if;
  if p_security_mode not in ('None', 'Sign', 'SignAndEncrypt')
     or p_security_policy not in (
       'None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'
     )
     or p_auth_mode not in ('anonymous', 'username') then
    return jsonb_build_object('error', 'OPC-UA security mode, policy or authentication mode is not supported');
  end if;
  if not public.opc_ua_node_list_valid(p_node_ids) then
    return jsonb_build_object('error', 'OPC-UA node list must be 1 to 50 unique numeric or string node ids');
  end if;
  if coalesce(p_expected_interval_minutes, 0) not between 1 and 525600 then
    return jsonb_build_object('error', 'expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint) > 2048
     or v_endpoint !~* '^opc\.tcp://[a-z0-9.-]+:[0-9]{1,5}(/[^[:space:]?#]*)?$' then
    return jsonb_build_object('error', 'OPC-UA endpoint must be a credential-free opc.tcp URL with an explicit port');
  end if;
  v_port := substring(v_endpoint from 'opc\.tcp://[^:]+:([0-9]+)')::int;
  if v_port is null or v_port not between 1 and 65535 then
    return jsonb_build_object('error', 'OPC-UA endpoint port is outside 1 to 65535');
  end if;
  if v_ref is null or length(v_ref) > 500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object('error', 'credential binding must be an opaque secret-store URI without a value, query or fragment');
  end if;
  if exists (
    select 1 from public.connectors
    where organization_id = v_org
      and connector_key = btrim(p_key)
      and connector_type is distinct from 'opc_ua_read'
  ) then
    return jsonb_build_object('error', 'connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id, connector_key, name, connector_type, system_kind,
    connector_profile, endpoint_hint, expected_interval_minutes,
    credential_binding_ref, contract_note, register_ref, status, enabled,
    direction, write_enabled, pagination_mode, pagination_next_path,
    pagination_max_pages, opcua_security_mode, opcua_security_policy,
    opcua_auth_mode, opcua_node_ids
  ) values (
    v_org, btrim(p_key), btrim(p_name), 'opc_ua_read', 'opc_ua',
    'opc_ua_binary_read', v_endpoint, p_expected_interval_minutes, v_ref,
    'Bounded OPC-UA Binary Read of administrator-approved nodes. No Write, Call or source write-back.',
    'C2.20', case when p_enabled then 'active' else 'configured' end, p_enabled,
    'read_only', false, 'none', null, 1, p_security_mode, p_security_policy,
    p_auth_mode, p_node_ids
  )
  on conflict (organization_id, connector_key) where connector_key is not null
  do update set
    name = excluded.name,
    connector_type = 'opc_ua_read',
    system_kind = 'opc_ua',
    connector_profile = 'opc_ua_binary_read',
    endpoint_hint = excluded.endpoint_hint,
    expected_interval_minutes = excluded.expected_interval_minutes,
    credential_binding_ref = excluded.credential_binding_ref,
    contract_note = excluded.contract_note,
    register_ref = 'C2.20',
    status = excluded.status,
    enabled = excluded.enabled,
    direction = 'read_only',
    write_enabled = false,
    pagination_mode = 'none',
    pagination_next_path = null,
    pagination_max_pages = 1,
    opcua_security_mode = excluded.opcua_security_mode,
    opcua_security_policy = excluded.opcua_security_policy,
    opcua_auth_mode = excluded.opcua_auth_mode,
    opcua_node_ids = excluded.opcua_node_ids
  returning id into v_id;

  insert into public.decisions(
    organization_id, decision_type, action_taken, approval_status, autonomy_mode,
    confidence_score, human_actor, rationale, outcome_status
  ) values (
    v_org, 'opc_ua_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only OPC-UA endpoint ' || v_endpoint,
    'approved', 'manual', 100, auth.uid()::text, btrim(p_basis), 'executed'
  );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', p_enabled,
    'direction', 'read_only',
    'write_enabled', false,
    'source_profile', 'opc_ua_binary_read',
    'security_mode', p_security_mode,
    'security_policy', p_security_policy,
    'node_count', jsonb_array_length(p_node_ids),
    'note', case when p_enabled
      then 'Enabled bounded user-triggered OPC-UA reads. Write and method calls remain impossible.'
      else 'Saved disabled. Deploy the gateway allowlist and credential binding before enabling.' end
  );
end
$$;

revoke all on function public.configure_opc_ua_read_source(
  text, text, text, text, text, text, jsonb, int, text, boolean, text
) from public, anon;
grant execute on function public.configure_opc_ua_read_source(
  text, text, text, text, text, text, jsonb, int, text, boolean, text
) to authenticated;

create or replace function public.get_opc_ua_read_source(p_connector_key text)
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
begin
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if v_org is null or coalesce(v_role, '') not in
    ('admin', 'reliability_engineer', 'maintenance_manager') then
    return jsonb_build_object('error', 'OPC-UA source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = btrim(p_connector_key)
    and connector_type = 'opc_ua_read'
    and system_kind = 'opc_ua'
    and connector_profile = 'opc_ua_binary_read'
    and register_ref = 'C2.20';
  if not found then
    return jsonb_build_object('error', 'governed OPC-UA source not found');
  end if;
  return jsonb_build_object(
    'organization_id', v_org,
    'connector_key', v_connector.connector_key,
    'enabled', v_connector.enabled,
    'direction', v_connector.direction,
    'write_enabled', v_connector.write_enabled,
    'source_profile', v_connector.connector_profile,
    'endpoint_url', v_connector.endpoint_hint,
    'credential_binding_ref', v_connector.credential_binding_ref,
    'security_mode', v_connector.opcua_security_mode,
    'security_policy', v_connector.opcua_security_policy,
    'auth_mode', v_connector.opcua_auth_mode,
    'node_ids', v_connector.opcua_node_ids
  );
end
$$;

revoke all on function public.get_opc_ua_read_source(text) from public, anon;
grant execute on function public.get_opc_ua_read_source(text) to authenticated;

create or replace function public.begin_opc_ua_read_run(
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
  v_page int := 0;
  v_rows int := 0;
  v_bytes bigint := 0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
  v_expected int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'OPC-UA transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id = p_triggered_by and organization_id = p_organization_id;
  if coalesce(v_role, '') not in
    ('admin', 'reliability_engineer', 'maintenance_manager') then
    return jsonb_build_object('error', 'OPC-UA run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id
    and connector_key = btrim(p_connector_key)
    and connector_type = 'opc_ua_read'
    and system_kind = 'opc_ua'
    and connector_profile = 'opc_ua_binary_read'
    and register_ref = 'C2.20'
    and enabled
    and direction = 'read_only'
    and not write_enabled
  for update;
  if not found then
    return jsonb_build_object('error', 'active governed OPC-UA source not found');
  end if;
  if exists (
    select 1 from public.connector_runs r
    where r.connector_id = v_connector.id
      and r.organization_id = p_organization_id
      and r.entity_type = 'opc_ua_node_value'
      and r.status = 'running'
  ) then
    return jsonb_build_object('error', 'an OPC-UA read is already running for this connector');
  end if;
  v_expected := jsonb_array_length(v_connector.opcua_node_ids);
  if coalesce(jsonb_typeof(p_manifest), '') <> 'array'
     or jsonb_array_length(p_manifest) <> 1
     or coalesce(jsonb_typeof(p_cursor_to), '') <> 'object'
     or coalesce(p_cursor_to->>'fetched_at', '') = ''
     or coalesce(p_source_bytes, 0) <= 0
     or p_source_bytes > 1048576 then
    return jsonb_build_object('error', 'bounded OPC-UA transport evidence is invalid');
  end if;
  begin
    v_observed_at := (p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error', 'OPC-UA transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at > now() + interval '5 minutes' then
    return jsonb_build_object('error', 'OPC-UA timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page := v_page + 1;
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'transport', '') <> 'opc_ua_binary_read'
       or coalesce(v_item->>'resource', '') <> 'Read'
       or coalesce(v_item->>'page', '') <> '1'
       or coalesce(v_item->>'security_mode', '') <> v_connector.opcua_security_mode
       or coalesce(v_item->>'security_policy', '') <> v_connector.opcua_security_policy
       or coalesce(v_item->>'sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes', '') !~ '^[0-9]+$'
       or coalesce(v_item->>'row_count', '') !~ '^[0-9]+$' then
      return jsonb_build_object('error', 'OPC-UA manifest is missing bounded read provenance');
    end if;
    if (v_item->>'bytes')::bigint <= 0 or (v_item->>'bytes')::bigint > 1048576 then
      return jsonb_build_object('error', 'OPC-UA source page must contain no more than 1 MB');
    end if;
    v_bytes := v_bytes + (v_item->>'bytes')::bigint;
    v_rows := v_rows + (v_item->>'row_count')::int;
  end loop;
  if v_bytes <> p_source_bytes
     or v_rows <> v_expected
     or coalesce(p_cursor_to->>'raw_rows', '') <> v_rows::text
     or coalesce(p_cursor_to->>'mapped_rows', '') <> v_expected::text
     or coalesce(p_cursor_to->>'pages', '') <> '1' then
    return jsonb_build_object('error', 'OPC-UA manifest does not reconcile to the approved node list');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id = v_connector.id and entity_type = 'opc_ua_node_value';
  if v_from is not null and v_observed_at <= v_from then
    return jsonb_build_object('error', 'OPC-UA observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.opc_ua_transport', 'granted', true);
  insert into public.connector_runs(
    organization_id, connector_id, entity_type, run_type, status, started_at,
    watermark_from, watermark_to, triggered_by, transport_manifest,
    transport_cursor_to, source_object_count, source_bytes
  ) values (
    p_organization_id, v_connector.id, 'opc_ua_node_value', 'sync', 'running', now(),
    v_from, v_observed_at, p_triggered_by, p_manifest, p_cursor_to, v_page, p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object(
    'ok', true, 'run_id', v_run, 'watermark_from', v_from, 'cursor_to', p_cursor_to
  );
end
$$;

revoke all on function public.begin_opc_ua_read_run(
  uuid, uuid, text, jsonb, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.begin_opc_ua_read_run(
  uuid, uuid, text, jsonb, jsonb, bigint
) to service_role;

create or replace function public.ingest_opc_ua_read_batch(
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
  v_observed timestamptz;
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_reason text;
  v_expected int;
  v_seen text[] := '{}';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'OPC-UA ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id = p_triggered_by and organization_id = p_organization_id;
  if coalesce(v_role, '') not in
    ('admin', 'reliability_engineer', 'maintenance_manager') then
    return jsonb_build_object('error', 'OPC-UA ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id = r.connector_id and c.organization_id = r.organization_id
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.triggered_by = p_triggered_by
    and r.status = 'running'
    and r.entity_type = 'opc_ua_node_value'
    and r.records_read = 0
    and c.connector_type = 'opc_ua_read'
    and c.system_kind = 'opc_ua'
    and c.connector_profile = 'opc_ua_binary_read'
    and c.register_ref = 'C2.20'
    and c.enabled
    and c.direction = 'read_only'
    and not c.write_enabled;
  if not found then
    return jsonb_build_object('error', 'running attested OPC-UA run not found');
  end if;
  select * into v_connector from public.connectors c
  where c.id = v_run.connector_id and c.organization_id = p_organization_id;
  v_expected := jsonb_array_length(v_connector.opcua_node_ids);
  if coalesce(jsonb_typeof(p_rows), '') <> 'array'
     or jsonb_array_length(p_rows) <> v_expected
     or jsonb_array_length(p_rows) <> (v_run.transport_cursor_to->>'mapped_rows')::int then
    return jsonb_build_object('error', 'OPC-UA rows must exactly reconcile to the attested node list');
  end if;

  perform set_config('app.opc_ua_ingest', 'granted', true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_reason := null;
    v_ext := nullif(btrim(v_row->>'node_id'), '');
    if jsonb_typeof(v_row) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_row) k
         where k not in ('node_id', 'value', 'status_code', 'source_timestamp')
       ) then
      v_reason := 'row contains fields outside the governed OPC-UA read contract';
    elsif v_ext is null
       or length(v_ext) > 512
       or coalesce(v_row->>'status_code', '') !~ '^0x[0-9a-f]{8}$'
       or jsonb_typeof(v_row->'value') not in ('number', 'string', 'boolean', 'null') then
      v_reason := 'node id, scalar value, status code and source timestamp are required';
    elsif v_row->>'status_code' = '0x00000000' and jsonb_typeof(v_row->'value') = 'null' then
      v_reason := 'a Good OPC-UA reading cannot omit its value';
    elsif not exists (
      select 1 from jsonb_array_elements_text(v_connector.opcua_node_ids) approved
      where approved.value = v_ext
    ) then
      v_reason := 'node is outside the approved OPC-UA list';
    else
      begin
        v_observed := (v_row->>'source_timestamp')::timestamptz;
        if not isfinite(v_observed) or v_observed > now() + interval '5 minutes' then
          v_reason := 'OPC-UA source timestamp is not a finite observation';
        end if;
      exception when others then
        v_reason := 'OPC-UA source timestamp is invalid';
      end;
    end if;
    if v_reason is null and v_ext = any(v_seen) then
      v_reason := 'OPC-UA response repeats a node';
    elsif v_reason is null then
      v_seen := v_seen || v_ext;
    end if;
    if v_reason is not null then
      v_rejected := v_rejected + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'opc_ua_node_value', v_ext, v_row, 'rejected', v_reason
      );
      continue;
    end if;
    if exists (
      select 1 from public.ingest_staging s
      where s.organization_id = p_organization_id
        and s.connector_id = v_connector.id
        and s.entity_type = 'opc_ua_node_value'
        and s.external_id = v_ext
        and s.status = 'accepted'
        and s.payload->>'source_timestamp' = v_row->>'source_timestamp'
    ) then
      v_duplicate := v_duplicate + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'opc_ua_node_value', v_ext, v_row, 'duplicate'
      );
    else
      v_ok := v_ok + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'opc_ua_node_value', v_ext, v_row, 'accepted'
      );
    end if;
  end loop;
  update public.connector_runs
  set records_read = v_read,
      records_accepted = v_ok,
      records_rejected = v_rejected,
      records_duplicate = v_duplicate
  where id = p_run_id and organization_id = p_organization_id;
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    p_organization_id, 'opc_ua_read', v_role,
    jsonb_build_object(
      'action', 'read_nodes', 'runId', p_run_id,
      'connectorKey', v_connector.connector_key, 'actorId', p_triggered_by,
      'sourceWriteBack', false
    ),
    jsonb_build_object(
      'read', v_read, 'accepted', v_ok, 'duplicate', v_duplicate, 'rejected', v_rejected
    )
  );
  return jsonb_build_object(
    'read', v_read, 'accepted', v_ok, 'duplicate', v_duplicate, 'rejected', v_rejected
  );
end
$$;

revoke all on function public.ingest_opc_ua_read_batch(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_opc_ua_read_batch(uuid, uuid, uuid, jsonb)
  to service_role;

create or replace function public.enforce_opc_ua_read_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists (
    select 1 from public.connectors c
    where c.id = new.connector_id
      and c.connector_type = 'opc_ua_read'
      and c.system_kind = 'opc_ua'
      and c.connector_profile = 'opc_ua_binary_read'
      and c.register_ref = 'C2.20'
  ) then
    if tg_op = 'INSERT'
       and coalesce(current_setting('app.opc_ua_transport', true), '') <> 'granted' then
      raise exception 'governed OPC-UA runs require service-attested complete transport evidence';
    end if;
    if tg_op = 'UPDATE'
       and coalesce(current_setting('app.opc_ua_ingest', true), '') <> 'granted'
       and coalesce(current_setting('app.opc_ua_finish', true), '') <> 'granted' then
      raise exception 'governed OPC-UA runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_opc_ua_read_run_attestation on public.connector_runs;
create trigger trg_opc_ua_read_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_opc_ua_read_run_attestation();

create or replace function public.finish_opc_ua_read_run(
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
  v_clean boolean;
  v_advanced boolean := false;
  v_expected int;
  v_rows int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'OPC-UA finish is service-only');
  end if;
  if p_status not in ('success', 'partial', 'failed') then
    return jsonb_build_object('error', 'OPC-UA status must be success, partial or failed');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id = r.connector_id and c.organization_id = r.organization_id
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.status = 'running'
    and c.connector_type = 'opc_ua_read'
    and c.system_kind = 'opc_ua'
    and c.connector_profile = 'opc_ua_binary_read'
    and c.register_ref = 'C2.20';
  if not found then
    return jsonb_build_object('error', 'running governed OPC-UA run not found');
  end if;
  v_expected := (v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success', 'partial') and v_run.records_read <> v_expected then
    return jsonb_build_object('error', 'OPC-UA run rows do not reconcile to the attested node list');
  end if;
  if p_status = 'success' and v_run.records_rejected > 0 then
    return jsonb_build_object('error', 'an OPC-UA run with rejected rows cannot finish as success');
  end if;
  v_clean := p_status = 'success'
    and v_run.records_rejected = 0
    and v_run.transport_manifest is not null
    and v_run.transport_cursor_to is not null;
  perform set_config('app.opc_ua_finish', 'granted', true);
  update public.connector_runs
  set status = p_status,
      finished_at = now(),
      records_processed = records_accepted,
      error_message = case when p_error is null then null else left(p_error, 500) end
  where id = p_run_id and organization_id = p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id, connector_id, entity_type, last_position, last_cursor, last_run_id, updated_at
    ) values (
      p_organization_id, v_run.connector_id, 'opc_ua_node_value', v_run.watermark_to,
      v_run.transport_cursor_to, p_run_id, now()
    )
    on conflict (connector_id, entity_type) do update set
      last_position = greatest(public.ingest_watermarks.last_position, excluded.last_position),
      last_cursor = excluded.last_cursor,
      last_run_id = excluded.last_run_id,
      updated_at = now();
    get diagnostics v_rows = row_count;
    v_advanced := v_rows = 1;
  end if;
  update public.connectors
  set last_success_at = case when v_clean then now() else last_success_at end,
      last_failure_at = case when not v_clean then now() else last_failure_at end
  where id = v_run.connector_id and organization_id = p_organization_id;
  return jsonb_build_object(
    'ok', true,
    'run_id', p_run_id,
    'status', p_status,
    'watermark_advanced', v_advanced,
    'records_read', v_run.records_read,
    'records_accepted', v_run.records_accepted,
    'records_duplicate', v_run.records_duplicate,
    'records_rejected', v_run.records_rejected
  );
end
$$;

revoke all on function public.finish_opc_ua_read_run(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_opc_ua_read_run(uuid, uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
