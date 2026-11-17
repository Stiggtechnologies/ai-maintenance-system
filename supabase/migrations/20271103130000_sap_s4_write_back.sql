-- Human-approved SAP S/4HANA OData V2 write-back.
--
-- Canonical reuse:
--   * public.connectors is the source binding (one service root per connector);
--   * public.app_has_approval_authority() / public.app_user_has_approval_authority()
--     is the approval-rights check shared with the autonomous orchestrator;
--   * public.audit_events is the one append-only ledger (D11.31). This migration
--     does not create a second audit table, does not grant UPDATE/DELETE on
--     audit_events, and does not replace trg_audit_events_append_only.
--   * public.user_profiles and public.app_current_org() stay the tenant boundary.
--
-- sap_s4_write_requests is the pending external write, not a second approval
-- engine. approvals.action_type is constrained to maintenance change control,
-- and SAP transport state (CSRF execution, HTTP status, idempotency claim)
-- does not fit that row. Internal maintenance_notifications and the CMMS/PM
-- read adapter are not modified.
--
-- Writes are off until set_sap_s4_write_enabled(true) and the connector is
-- explicitly enabled. Nothing in this migration calls SAP.

alter table public.connectors
  drop constraint if exists connectors_sap_s4_write_profile_check;
alter table public.connectors
  add constraint connectors_sap_s4_write_profile_check check (
    connector_type is distinct from 'sap_s4_write'
    or (
      system_kind = 'cmms'
      and connector_profile = 'sap_s4_odata_v2_write'
      and (
        (direction = 'read_only' and not write_enabled)
        or (direction = 'read_write' and write_enabled)
      )
      and pagination_mode = 'none'
      and pagination_next_path is null
      and pagination_max_pages = 1
      and (
        endpoint_hint ~ '/API_MAINTNOTIFICATION/?$'
        or endpoint_hint ~ '/API_MAINTENANCEORDER(;v=(2|0002))?/?$'
      )
    )
  );

create table if not exists public.sap_s4_write_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  basis text not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint sap_s4_write_settings_basis_check check (length(btrim(basis)) between 20 and 2000)
);

comment on table public.sap_s4_write_settings is
  'Per-tenant SAP S/4HANA write flag. Absent or enabled=false means no SAP write is claimable. Default is disabled.';

create table if not exists public.sap_s4_write_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid not null references public.connectors(id) on delete restrict,
  operation text not null,
  service_name text not null,
  entity_name text not null,
  http_method text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  idempotency_key text not null,
  basis text not null,
  status text not null default 'pending',
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  execution_claimed_by uuid references auth.users(id),
  execution_claimed_at timestamptz,
  sap_http_status int,
  sap_error text,
  executed_at timestamptz,
  constraint sap_s4_write_requests_operation_check check (
    operation in (
      'maintenance_notification_create',
      'maintenance_notification_text_update',
      'maintenance_order_release'
    )
  ),
  constraint sap_s4_write_requests_method_check check (http_method in ('POST', 'PATCH')),
  constraint sap_s4_write_requests_status_check check (
    status in ('pending', 'approved', 'rejected', 'executing', 'executed', 'failed')
  ),
  constraint sap_s4_write_requests_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint sap_s4_write_requests_hash_check check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sap_s4_write_requests_basis_check check (length(btrim(basis)) between 20 and 2000),
  constraint sap_s4_write_requests_idempotency_key unique (organization_id, idempotency_key)
);

comment on table public.sap_s4_write_requests is
  'Pending and completed SAP S/4HANA write requests. Payload identity is immutable. SAP is not called from SQL.';

create index if not exists sap_s4_write_requests_org_status_idx
  on public.sap_s4_write_requests (organization_id, status, requested_at desc);

alter table public.sap_s4_write_settings enable row level security;
alter table public.sap_s4_write_requests enable row level security;

revoke all on public.sap_s4_write_settings from public, anon, authenticated;
revoke all on public.sap_s4_write_requests from public, anon, authenticated;
grant select on public.sap_s4_write_settings to authenticated;
grant select on public.sap_s4_write_requests to authenticated;

drop policy if exists sap_s4_write_settings_tenant_read on public.sap_s4_write_settings;
create policy sap_s4_write_settings_tenant_read
  on public.sap_s4_write_settings
  for select
  to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists sap_s4_write_requests_tenant_read on public.sap_s4_write_requests;
create policy sap_s4_write_requests_tenant_read
  on public.sap_s4_write_requests
  for select
  to authenticated
  using (organization_id = public.app_current_org());

revoke truncate on table public.sap_s4_write_settings from anon, authenticated, service_role;
revoke truncate on table public.sap_s4_write_requests from anon, authenticated, service_role;

create or replace function public.sap_s4_write_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'SAP write records cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(current_setting('syncai.sap_s4_write', true), '') <> '1' then
    raise exception 'SAP write records change only through governed functions'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'sap_s4_write_requests' then
    if new.organization_id is distinct from old.organization_id
       or new.connector_id is distinct from old.connector_id
       or new.operation is distinct from old.operation
       or new.service_name is distinct from old.service_name
       or new.entity_name is distinct from old.entity_name
       or new.http_method is distinct from old.http_method
       or new.payload is distinct from old.payload
       or new.payload_sha256 is distinct from old.payload_sha256
       or new.idempotency_key is distinct from old.idempotency_key
       or new.requested_by is distinct from old.requested_by
       or new.requested_at is distinct from old.requested_at
       or new.basis is distinct from old.basis
    then
      raise exception 'SAP write identity and payload are immutable'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'sap_s4_write_settings' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'SAP write tenant flag cannot move between tenants'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.sap_s4_write_guard() from public, anon, authenticated;

drop trigger if exists trg_sap_s4_write_settings_guard on public.sap_s4_write_settings;
create trigger trg_sap_s4_write_settings_guard
  before insert or update or delete on public.sap_s4_write_settings
  for each row execute function public.sap_s4_write_guard();

drop trigger if exists trg_sap_s4_write_settings_no_truncate on public.sap_s4_write_settings;
create trigger trg_sap_s4_write_settings_no_truncate
  before truncate on public.sap_s4_write_settings
  for each statement execute function public.sap_s4_write_guard();

drop trigger if exists trg_sap_s4_write_requests_guard on public.sap_s4_write_requests;
create trigger trg_sap_s4_write_requests_guard
  before insert or update or delete on public.sap_s4_write_requests
  for each row execute function public.sap_s4_write_guard();

drop trigger if exists trg_sap_s4_write_requests_no_truncate on public.sap_s4_write_requests;
create trigger trg_sap_s4_write_requests_no_truncate
  before truncate on public.sap_s4_write_requests
  for each statement execute function public.sap_s4_write_guard();

create or replace function public.sap_s4_write_payload_error(
  p_operation text,
  p_payload jsonb
) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_allowed text[];
  v_value text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return 'SAP write payload must be a JSON object';
  end if;
  if p_operation = 'maintenance_notification_create' then
    v_allowed := array['NotificationType', 'NotificationText', 'ReportedByUser'];
  elsif p_operation = 'maintenance_notification_text_update' then
    v_allowed := array['MaintenanceNotification', 'NotificationText'];
  elsif p_operation = 'maintenance_order_release' then
    v_allowed := array['MaintenanceOrder'];
  else
    return 'SAP write operation is not allowlisted';
  end if;
  for v_key in select jsonb_object_keys(p_payload) loop
    if v_key <> all (v_allowed) then
      return 'SAP write payload contains a field outside the allowlist';
    end if;
  end loop;
  if p_operation = 'maintenance_notification_create' then
    v_value := p_payload->>'NotificationType';
    if v_value is null or v_value !~ '^[A-Za-z0-9]{1,4}$' then
      return 'NotificationType must be a 1-4 character published type code';
    end if;
    v_value := p_payload->>'NotificationText';
    if v_value is null or length(v_value) not between 1 and 40 or v_value ~ '[[:cntrl:]]' then
      return 'NotificationText must be 1-40 characters without control characters';
    end if;
    v_value := p_payload->>'ReportedByUser';
    if v_value is not null and v_value !~ '^[A-Za-z0-9._-]{1,12}$' then
      return 'ReportedByUser is outside its published identifier bound';
    end if;
  elsif p_operation = 'maintenance_notification_text_update' then
    v_value := p_payload->>'MaintenanceNotification';
    if v_value is null or v_value !~ '^[A-Za-z0-9]{1,12}$' then
      return 'MaintenanceNotification key is outside its published identifier bound';
    end if;
    v_value := p_payload->>'NotificationText';
    if v_value is null or length(v_value) not between 1 and 40 or v_value ~ '[[:cntrl:]]' then
      return 'NotificationText must be 1-40 characters without control characters';
    end if;
  else
    v_value := p_payload->>'MaintenanceOrder';
    if v_value is null or v_value !~ '^[A-Za-z0-9]{1,12}$' then
      return 'MaintenanceOrder is outside its published identifier bound';
    end if;
  end if;
  return null;
end
$$;

revoke all on function public.sap_s4_write_payload_error(text, jsonb) from public, anon, authenticated;

create or replace function public.set_sap_s4_write_enabled(
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
  v_previous boolean;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'a named human administrator must set the SAP write flag');
  end if;
  if coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('error', 'setting the SAP write flag requires an administrator');
  end if;
  if p_enabled is null or coalesce(length(btrim(p_basis)), 0) not between 20 and 2000 then
    return jsonb_build_object('error', 'record a substantive basis for the SAP write flag');
  end if;
  select enabled into v_previous from public.sap_s4_write_settings where organization_id = v_org;
  perform set_config('syncai.sap_s4_write', '1', true);
  insert into public.sap_s4_write_settings(organization_id, enabled, basis, updated_by, updated_at)
  values (v_org, p_enabled, btrim(p_basis), auth.uid(), now())
  on conflict (organization_id) do update set
    enabled = excluded.enabled,
    basis = excluded.basis,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
  if not p_enabled then
    update public.connectors
    set write_enabled = false,
        direction = 'read_only',
        enabled = false,
        status = 'configured'
    where organization_id = v_org
      and connector_type = 'sap_s4_write';
  end if;
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'sap_s4_write_settings',
    auth.uid()::text,
    jsonb_build_object(
      'action', case when p_enabled then 'tenant_write_enabled' else 'tenant_write_disabled' end,
      'requested_by', auth.uid(),
      'error', null,
      'sap_http_status', null,
      'payload_sha256', null
    ),
    jsonb_build_object('enabled', coalesce(v_previous, false)),
    jsonb_build_object('enabled', p_enabled, 'updated_by', auth.uid(), 'updated_at', now())
  );
  return jsonb_build_object(
    'ok', true,
    'tenantWriteEnabled', p_enabled,
    'note', case when p_enabled
      then 'Tenant SAP writes may now be enabled on an explicit connector. No SAP call was made.'
      else 'Tenant SAP writes are disabled. Existing write connectors were turned off. No SAP call was made.'
    end
  );
end
$$;

revoke all on function public.set_sap_s4_write_enabled(boolean, text) from public, anon;
grant execute on function public.set_sap_s4_write_enabled(boolean, text) to authenticated;

create or replace function public.configure_sap_s4_write_source(
  p_key text,
  p_name text,
  p_service_root text,
  p_credential_binding_ref text,
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
  v_endpoint text := nullif(btrim(coalesce(p_service_root, '')), '');
  v_ref text := nullif(btrim(coalesce(p_credential_binding_ref, '')), '');
  v_flag boolean;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'a named human administrator must configure an SAP write source');
  end if;
  if coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('error', 'configuring an SAP write source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)), 0) not between 3 and 160
     or coalesce(length(btrim(p_name)), 0) not between 3 and 160 then
    return jsonb_build_object('error', 'connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)), 0) not between 20 and 2000 then
    return jsonb_build_object('error', 'record a substantive SAP write activation basis');
  end if;
  if p_enabled is null then
    return jsonb_build_object('error', 'enabled must be true or false');
  end if;
  select enabled into v_flag from public.sap_s4_write_settings where organization_id = v_org;
  if p_enabled and coalesce(v_flag, false) is not true then
    return jsonb_build_object('error', 'SAP writes are disabled for this tenant until an administrator sets the explicit write flag');
  end if;
  if v_endpoint is null or length(v_endpoint) > 2048
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]?#]*)?$'
     or (
       v_endpoint !~ '/API_MAINTNOTIFICATION/?$'
       and v_endpoint !~ '/API_MAINTENANCEORDER(;v=(2|0002))?/?$'
     )
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)' then
    return jsonb_build_object('error', 'SAP service root must be a credential-free public HTTPS API_MAINTNOTIFICATION or API_MAINTENANCEORDER URL');
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
      and connector_type is distinct from 'sap_s4_write'
  ) then
    return jsonb_build_object('error', 'connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id, connector_key, name, connector_type, system_kind,
    connector_profile, endpoint_hint, credential_binding_ref, contract_note,
    register_ref, status, enabled, direction, write_enabled,
    pagination_mode, pagination_next_path, pagination_max_pages
  ) values (
    v_org, btrim(p_key), btrim(p_name), 'sap_s4_write', 'cmms',
    'sap_s4_odata_v2_write', v_endpoint, v_ref,
    'Human-approved SAP S/4HANA OData V2 write. Off unless the tenant flag and this connector are both explicitly enabled.',
    'C2.20',
    case when p_enabled then 'active' else 'configured' end,
    p_enabled,
    case when p_enabled then 'read_write' else 'read_only' end,
    p_enabled,
    'none', null, 1
  )
  on conflict (organization_id, connector_key) where connector_key is not null
  do update set
    name = excluded.name,
    connector_type = 'sap_s4_write',
    system_kind = 'cmms',
    connector_profile = 'sap_s4_odata_v2_write',
    endpoint_hint = excluded.endpoint_hint,
    credential_binding_ref = excluded.credential_binding_ref,
    contract_note = excluded.contract_note,
    register_ref = 'C2.20',
    status = excluded.status,
    enabled = excluded.enabled,
    direction = excluded.direction,
    write_enabled = excluded.write_enabled,
    pagination_mode = 'none',
    pagination_next_path = null,
    pagination_max_pages = 1
  returning id into v_id;

  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'sap_s4_write_connector', auth.uid()::text,
    jsonb_build_object(
      'action', case when p_enabled then 'connector_write_enabled' else 'connector_saved_disabled' end,
      'connector_id', v_id,
      'requested_by', auth.uid(),
      'sap_http_status', null,
      'error', null
    ),
    jsonb_build_object('enabled', p_enabled, 'write_enabled', p_enabled, 'direction', case when p_enabled then 'read_write' else 'read_only' end)
  );
  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', p_enabled,
    'write_enabled', p_enabled,
    'note', 'Connector saved. No SAP call was made.'
  );
end
$$;

revoke all on function public.configure_sap_s4_write_source(text, text, text, text, boolean, text) from public, anon;
grant execute on function public.configure_sap_s4_write_source(text, text, text, text, boolean, text) to authenticated;

create or replace function public.propose_sap_s4_write(
  p_connector_key text,
  p_operation text,
  p_payload jsonb,
  p_idempotency_key text,
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
  v_flag boolean;
  v_error text;
  v_hash text;
  v_canonical text;
  v_service text;
  v_entity text;
  v_method text;
  v_id uuid;
  v_existing public.sap_s4_write_requests%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error', 'the AI-operator identity cannot propose an SAP write');
  end if;
  if coalesce(v_role, '') = '' then
    return jsonb_build_object('error', 'a named tenant member must propose an SAP write');
  end if;
  if coalesce(length(btrim(p_basis)), 0) not between 20 and 2000 then
    return jsonb_build_object('error', 'record why this SAP write is being requested');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,80}$' then
    return jsonb_build_object('error', 'idempotency key must be 8-80 explicit characters');
  end if;
  v_error := public.sap_s4_write_payload_error(p_operation, p_payload);
  if v_error is not null then
    return jsonb_build_object('error', v_error);
  end if;
  v_service := case p_operation
    when 'maintenance_notification_create' then 'API_MAINTNOTIFICATION'
    when 'maintenance_notification_text_update' then 'API_MAINTNOTIFICATION'
    when 'maintenance_order_release' then 'API_MAINTENANCEORDER'
    else null end;
  v_entity := case p_operation
    when 'maintenance_order_release' then 'ReleaseMaintenanceOrder'
    else 'MaintenanceNotification' end;
  v_method := case p_operation
    when 'maintenance_notification_text_update' then 'PATCH'
    else 'POST' end;
  select enabled into v_flag from public.sap_s4_write_settings where organization_id = v_org;
  if coalesce(v_flag, false) is not true then
    return jsonb_build_object('error', 'SAP writes are disabled for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = btrim(p_connector_key)
    and connector_type = 'sap_s4_write';
  if v_connector.id is null
     or not v_connector.enabled
     or not v_connector.write_enabled
     or v_connector.direction <> 'read_write' then
    return jsonb_build_object('error', 'SAP write connector is not explicitly enabled');
  end if;
  if v_service = 'API_MAINTNOTIFICATION' and v_connector.endpoint_hint !~ '/API_MAINTNOTIFICATION/?$'
     or v_service = 'API_MAINTENANCEORDER' and v_connector.endpoint_hint !~ '/API_MAINTENANCEORDER(;v=(2|0002))?/?$' then
    return jsonb_build_object('error', 'SAP write operation does not match the connector service');
  end if;
  v_canonical := p_payload::text;
  if octet_length(v_canonical) > 4000 then
    return jsonb_build_object('error', 'SAP write payload exceeds its 4000-byte bound');
  end if;
  v_hash := encode(extensions.digest(convert_to(v_canonical, 'UTF8'), 'sha256'), 'hex');
  select * into v_existing from public.sap_s4_write_requests
  where organization_id = v_org and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.payload_sha256 = v_hash and v_existing.operation = p_operation then
      return jsonb_build_object(
        'ok', true, 'idempotent_replay', true, 'request_id', v_existing.id, 'status', v_existing.status,
        'payload_sha256', v_existing.payload_sha256
      );
    end if;
    return jsonb_build_object('error', 'idempotency key already belongs to a different SAP write payload');
  end if;
  perform set_config('syncai.sap_s4_write', '1', true);
  insert into public.sap_s4_write_requests(
    organization_id, connector_id, operation, service_name, entity_name, http_method,
    payload, payload_sha256, idempotency_key, basis, status, requested_by
  ) values (
    v_org, v_connector.id, p_operation, v_service, v_entity, v_method,
    p_payload, v_hash, p_idempotency_key, btrim(p_basis), 'pending', auth.uid()
  ) returning id into v_id;
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    v_org, 'sap_s4_write_request', auth.uid()::text,
    jsonb_build_object(
      'action', 'requested',
      'request_id', v_id,
      'operation', p_operation,
      'service_name', v_service,
      'entity_name', v_entity,
      'http_method', v_method,
      'payload_sha256', v_hash,
      'requested_by', auth.uid(),
      'sap_http_status', null,
      'error', null
    ),
    jsonb_build_object('status', 'pending', 'requested_at', now())
  );
  return jsonb_build_object(
    'ok', true, 'request_id', v_id, 'status', 'pending', 'payload_sha256', v_hash,
    'note', 'Stored for human approval. SAP was not called.'
  );
exception when unique_violation then
  select * into v_existing from public.sap_s4_write_requests
  where organization_id = v_org and idempotency_key = p_idempotency_key;
  if v_existing.id is not null and v_existing.payload_sha256 = v_hash then
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'request_id', v_existing.id, 'status', v_existing.status
    );
  end if;
  return jsonb_build_object('error', 'idempotency key already belongs to a different SAP write payload');
end
$$;

revoke all on function public.propose_sap_s4_write(text, text, jsonb, text, text) from public, anon;
grant execute on function public.propose_sap_s4_write(text, text, jsonb, text, text) to authenticated;

create or replace function public.decide_sap_s4_write(
  p_request_id uuid,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  r public.sap_s4_write_requests%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' or not coalesce(public.app_has_approval_authority(), false) then
    return jsonb_build_object('error', 'approval_authority_required');
  end if;
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('error', 'decision must be approved or rejected');
  end if;
  if coalesce(length(btrim(p_note)), 0) not between 20 and 2000 then
    return jsonb_build_object('error', 'record the decision basis in at least 20 characters');
  end if;
  select * into r from public.sap_s4_write_requests
  where id = p_request_id and organization_id = v_org
  for update;
  if r.id is null then
    return jsonb_build_object('error', 'SAP write request not found in this tenant');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('error', 'request_not_pending', 'status', r.status);
  end if;
  if r.requested_by = auth.uid() then
    return jsonb_build_object('error', 'the requester cannot approve their own SAP write');
  end if;
  perform set_config('syncai.sap_s4_write', '1', true);
  update public.sap_s4_write_requests
  set status = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = btrim(p_note)
  where id = r.id and organization_id = v_org and status = 'pending';
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org, 'sap_s4_write_request', auth.uid()::text,
    jsonb_build_object(
      'action', p_decision,
      'request_id', r.id,
      'operation', r.operation,
      'service_name', r.service_name,
      'entity_name', r.entity_name,
      'payload_sha256', r.payload_sha256,
      'requested_by', r.requested_by,
      'decided_by', auth.uid(),
      'sap_http_status', null,
      'error', null
    ),
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision, 'decided_by', auth.uid(), 'decided_at', now())
  );
  return jsonb_build_object(
    'ok', true, 'request_id', r.id, 'status', p_decision,
    'note', case when p_decision = 'approved'
      then 'Approved. SAP is not called until a separate execution of this approved request.'
      else 'Rejected. SAP was not called.' end
  );
end
$$;

revoke all on function public.decide_sap_s4_write(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_sap_s4_write(uuid, text, text) to authenticated;

create or replace function public.claim_sap_s4_write_execution(
  p_actor uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sap_s4_write_requests%rowtype;
  c public.connectors%rowtype;
  v_org uuid;
  v_role text;
  v_flag boolean;
begin
  if p_actor is null or p_request_id is null then
    return jsonb_build_object('call_sap', false, 'error', 'actor_and_request_required');
  end if;
  select organization_id, role into v_org, v_role
  from public.user_profiles where id = p_actor;
  if v_org is null then
    return jsonb_build_object('call_sap', false, 'error', 'approval_authority_required');
  end if;
  select * into r from public.sap_s4_write_requests
  where id = p_request_id
  for update;
  if r.id is null or r.organization_id is distinct from v_org then
    return jsonb_build_object('call_sap', false, 'error', 'SAP write request not found in this tenant');
  end if;
  if coalesce(v_role, '') = 'ai_admin'
     or not coalesce(public.app_user_has_approval_authority(p_actor), false) then
    insert into public.audit_events(
      organization_id, entity_type, actor, event_data
    ) values (
      r.organization_id, 'sap_s4_write_request', p_actor::text,
      jsonb_build_object(
        'action', 'execution_refused',
        'request_id', r.id,
        'payload_sha256', r.payload_sha256,
        'requested_by', r.requested_by,
        'error', 'approval_authority_required',
        'sap_http_status', null
      )
    );
    return jsonb_build_object('call_sap', false, 'error', 'approval_authority_required');
  end if;
  if p_actor = r.requested_by then
    insert into public.audit_events(
      organization_id, entity_type, actor, event_data
    ) values (
      r.organization_id, 'sap_s4_write_request', p_actor::text,
      jsonb_build_object(
        'action', 'execution_refused',
        'request_id', r.id,
        'payload_sha256', r.payload_sha256,
        'requested_by', r.requested_by,
        'error', 'the requester cannot approve their own SAP write',
        'sap_http_status', null
      )
    );
    return jsonb_build_object('call_sap', false, 'error', 'the requester cannot approve their own SAP write');
  end if;
  if r.status = 'executed' then
    return jsonb_build_object(
      'call_sap', false,
      'idempotent_replay', true,
      'request_id', r.id,
      'status', r.status,
      'payload_sha256', r.payload_sha256,
      'sap_http_status', r.sap_http_status,
      'error', r.sap_error
    );
  end if;
  if r.status = 'executing' then
    return jsonb_build_object('call_sap', false, 'error', 'execution_already_claimed', 'request_id', r.id);
  end if;
  if r.status <> 'approved' then
    insert into public.audit_events(
      organization_id, entity_type, actor, event_data
    ) values (
      r.organization_id, 'sap_s4_write_request', p_actor::text,
      jsonb_build_object(
        'action', 'execution_refused',
        'request_id', r.id,
        'payload_sha256', r.payload_sha256,
        'requested_by', r.requested_by,
        'error', 'request_not_approved',
        'sap_http_status', null,
        'status', r.status
      )
    );
    return jsonb_build_object('call_sap', false, 'error', 'request_not_approved', 'status', r.status);
  end if;
  select enabled into v_flag from public.sap_s4_write_settings where organization_id = r.organization_id;
  select * into c from public.connectors
  where id = r.connector_id and organization_id = r.organization_id and connector_type = 'sap_s4_write';
  if coalesce(v_flag, false) is not true
     or c.id is null
     or not c.enabled
     or not c.write_enabled
     or c.direction <> 'read_write' then
    return jsonb_build_object('call_sap', false, 'error', 'sap_writes_disabled', 'request_id', r.id);
  end if;
  perform set_config('syncai.sap_s4_write', '1', true);
  update public.sap_s4_write_requests
  set status = 'executing',
      execution_claimed_by = p_actor,
      execution_claimed_at = now()
  where id = r.id and status = 'approved';
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    r.organization_id, 'sap_s4_write_request', p_actor::text,
    jsonb_build_object(
      'action', 'execution_started',
      'request_id', r.id,
      'operation', r.operation,
      'service_name', r.service_name,
      'entity_name', r.entity_name,
      'payload_sha256', r.payload_sha256,
      'requested_by', r.requested_by,
      'decided_by', r.decided_by,
      'sap_http_status', null,
      'error', null
    ),
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'executing', 'execution_claimed_by', p_actor)
  );
  return jsonb_build_object(
    'call_sap', true,
    'request_id', r.id,
    'status_at_claim', 'approved',
    'tenant_write_enabled', true,
    'connector_write_enabled', true,
    'operation', r.operation,
    'service_root', c.endpoint_hint,
    'credential_binding_ref', c.credential_binding_ref,
    'payload_json', r.payload::text,
    'payload_sha256', r.payload_sha256,
    'idempotency_key', r.idempotency_key
  );
end
$$;

revoke all on function public.claim_sap_s4_write_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_sap_s4_write_execution(uuid, uuid) to service_role;

create or replace function public.complete_sap_s4_write_execution(
  p_actor uuid,
  p_request_id uuid,
  p_http_status int,
  p_error text,
  p_succeeded boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sap_s4_write_requests%rowtype;
  v_ok boolean;
  v_status text;
  v_error text;
begin
  if p_actor is null or p_request_id is null then
    return jsonb_build_object('error', 'actor_and_request_required');
  end if;
  select * into r from public.sap_s4_write_requests
  where id = p_request_id
  for update;
  if r.id is null then
    return jsonb_build_object('error', 'SAP write request not found');
  end if;
  if r.status = 'executed' then
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'request_id', r.id,
      'status', r.status, 'sap_http_status', r.sap_http_status
    );
  end if;
  if r.status <> 'executing' or r.execution_claimed_by is distinct from p_actor then
    return jsonb_build_object('error', 'request_not_executing');
  end if;
  v_error := nullif(left(coalesce(p_error, ''), 500), '');
  v_ok := coalesce(p_succeeded, false)
    and p_http_status between 200 and 299
    and v_error is null;
  v_status := case when v_ok then 'executed' else 'failed' end;
  perform set_config('syncai.sap_s4_write', '1', true);
  update public.sap_s4_write_requests
  set status = v_status,
      sap_http_status = p_http_status,
      sap_error = v_error,
      executed_at = now()
  where id = r.id and status = 'executing';
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    r.organization_id, 'sap_s4_write_request', p_actor::text,
    jsonb_build_object(
      'action', 'sap_response',
      'request_id', r.id,
      'operation', r.operation,
      'service_name', r.service_name,
      'entity_name', r.entity_name,
      'payload_sha256', r.payload_sha256,
      'requested_by', r.requested_by,
      'decided_by', r.decided_by,
      'executed_by', p_actor,
      'sap_http_status', p_http_status,
      'error', v_error
    ),
    jsonb_build_object('status', 'executing'),
    jsonb_build_object('status', v_status, 'sap_http_status', p_http_status, 'executed_at', now())
  );
  return jsonb_build_object(
    'ok', true, 'request_id', r.id, 'status', v_status, 'sap_http_status', p_http_status
  );
end
$$;

revoke all on function public.complete_sap_s4_write_execution(uuid, uuid, int, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_sap_s4_write_execution(uuid, uuid, int, text, boolean) to service_role;

create or replace function public.get_sap_s4_write_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_flag boolean;
  v_requests jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  select enabled into v_flag from public.sap_s4_write_settings where organization_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'operation', r.operation,
    'serviceName', r.service_name,
    'entityName', r.entity_name,
    'httpMethod', r.http_method,
    'status', r.status,
    'payload', r.payload,
    'payloadSha256', r.payload_sha256,
    'requestedBy', r.requested_by,
    'requestedAt', r.requested_at,
    'decidedBy', r.decided_by,
    'sapHttpStatus', r.sap_http_status,
    'sapError', r.sap_error
  ) order by r.requested_at desc), '[]'::jsonb)
  into v_requests
  from (
    select * from public.sap_s4_write_requests
    where organization_id = v_org
    order by requested_at desc
    limit 50
  ) r;
  return jsonb_build_object(
    'tenantWriteEnabled', coalesce(v_flag, false),
    'canApprove', public.app_has_approval_authority() and coalesce(v_role, '') <> 'ai_admin',
    'callerId', auth.uid(),
    'role', coalesce(v_role, ''),
    'requests', v_requests,
    'note', 'Built and tested against mocked SAP responses. Not certified against a customer SAP tenant. No SAP call is made by this read.'
  );
end
$$;

revoke all on function public.get_sap_s4_write_workspace() from public, anon, service_role;
grant execute on function public.get_sap_s4_write_workspace() to authenticated;

notify pgrst, 'reload schema';
