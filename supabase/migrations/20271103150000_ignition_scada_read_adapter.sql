-- C2.21 — governed Ignition SCADA tag read.
--
-- One connector binds one published Ignition WebDev resource and an explicit
-- tag-path list. The adapter issues HTTP GET only. Qualified values are
-- retained on the existing connector, run, staging and watermark planes.
-- Nothing here writes a tag, acknowledges an alarm, or changes a limit.
-- system_kind stays historian; ignition_tag_read is the product profile.

alter table public.connectors
  add column if not exists scada_tag_paths jsonb;

comment on column public.connectors.scada_tag_paths is
  'Administrator-approved Ignition tag paths. The pull request cannot widen this list.';

alter table public.connectors
  drop constraint if exists connectors_ignition_scada_read_profile_check;
alter table public.connectors
  add constraint connectors_ignition_scada_read_profile_check check (
    connector_type is distinct from 'scada_read'
    or (
      system_kind = 'historian'
      and connector_profile = 'ignition_tag_read'
      and register_ref = 'C2.21'
      and direction = 'read_only'
      and not write_enabled
      and pagination_mode = 'none'
      and pagination_next_path is null
      and pagination_max_pages = 1
      and scada_tag_paths is not null
      and jsonb_typeof(scada_tag_paths) = 'array'
      and case
        when jsonb_typeof(scada_tag_paths) = 'array' then
          jsonb_array_length(scada_tag_paths) >= 1
          and jsonb_array_length(scada_tag_paths) <= 20
        else false
      end
    )
  );

create or replace function public.configure_ignition_scada_source(
  p_key text,
  p_name text,
  p_resource_url text,
  p_tag_paths jsonb,
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
  v_endpoint text := nullif(btrim(coalesce(p_resource_url, '')), '');
  v_ref text := nullif(btrim(coalesce(p_credential_binding_ref, '')), '');
  v_item jsonb;
  v_path text;
  v_paths jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object(
      'error', 'a named human administrator must configure or enable an Ignition source'
    );
  end if;
  if v_org is null or coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('error', 'configuring an Ignition source requires an administrator');
  end if;
  if coalesce(length(btrim(p_key)), 0) not between 3 and 160
     or coalesce(length(btrim(p_name)), 0) not between 3 and 160 then
    return jsonb_build_object('error', 'connector key and name must be between 3 and 160 characters');
  end if;
  if coalesce(length(btrim(p_basis)), 0) not between 20 and 2000 then
    return jsonb_build_object(
      'error', 'record a substantive bounded Ignition activation and tag-list basis'
    );
  end if;
  if coalesce(p_expected_interval_minutes, 0) not between 1 and 525600 then
    return jsonb_build_object('error', 'expected interval must be between one minute and one year');
  end if;
  if v_endpoint is null or length(v_endpoint) > 2048
     or v_endpoint !~* '^https://[A-Za-z0-9.-]+(:443)?/system/webdev/[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+/?$'
     or v_endpoint ~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|\[?::1\]?|@|password|token|api[_-]?key|bearer|secret)'
     or v_endpoint ~* 'write|webdev_staging' then
    return jsonb_build_object(
      'error',
      'Ignition resource must be a credential-free public HTTPS /system/webdev read URL; private, write and staging targets are blocked'
    );
  end if;
  v_endpoint := regexp_replace(v_endpoint, '/$', '');
  if v_ref is null or length(v_ref) > 500
     or v_ref !~ '^[a-z][a-z0-9+.-]*://[A-Za-z0-9._:/-]+$'
     or v_ref ~ '[@?=#]' then
    return jsonb_build_object(
      'error', 'credential binding must be an opaque secret-store URI without a value, query or fragment'
    );
  end if;
  if coalesce(jsonb_typeof(p_tag_paths), '') <> 'array'
     or jsonb_array_length(p_tag_paths) < 1
     or jsonb_array_length(p_tag_paths) > 20 then
    return jsonb_build_object('error', 'Ignition tag list must contain 1 to 20 paths');
  end if;
  for v_item in select value from jsonb_array_elements(p_tag_paths) loop
    if jsonb_typeof(v_item) <> 'string' then
      return jsonb_build_object('error', 'every Ignition tag path must be a string');
    end if;
    v_path := btrim(v_item #>> '{}');
    if length(v_path) < 4 or length(v_path) > 200
       or v_path !~ '^\[[A-Za-z][A-Za-z0-9_-]{0,63}\][^[:space:]?#]{1,180}$'
       or strpos(v_path, chr(92)) > 0
       or v_path ~ '\.\.'
       or v_path ~* 'write' then
      return jsonb_build_object(
        'error', 'each Ignition tag path must be an explicit provider path and must not name a write'
      );
    end if;
    if v_path = any(v_seen) then
      return jsonb_build_object('error', 'Ignition tag list repeats a path');
    end if;
    v_seen := v_seen || v_path;
    v_paths := v_paths || to_jsonb(v_path);
  end loop;
  if exists (
    select 1 from public.connectors
    where organization_id = v_org
      and connector_key = btrim(p_key)
      and connector_type is distinct from 'scada_read'
  ) then
    return jsonb_build_object('error', 'connector key already belongs to another governed integration contract');
  end if;

  insert into public.connectors(
    organization_id, connector_key, name, connector_type, system_kind,
    connector_profile, endpoint_hint, expected_interval_minutes,
    credential_binding_ref, contract_note, register_ref, status, enabled,
    direction, write_enabled, pagination_mode, pagination_next_path,
    pagination_max_pages, scada_tag_paths
  ) values (
    v_org, btrim(p_key), btrim(p_name), 'scada_read', 'historian',
    'ignition_tag_read', v_endpoint, p_expected_interval_minutes, v_ref,
    'Bounded Ignition WebDev GET for approved tag paths. No tag write, alarm acknowledgement, or limit change.',
    'C2.21', case when p_enabled then 'active' else 'configured' end, p_enabled,
    'read_only', false, 'none', null, 1, v_paths
  )
  on conflict (organization_id, connector_key) where connector_key is not null
  do update set
    name = excluded.name,
    connector_type = 'scada_read',
    system_kind = 'historian',
    connector_profile = 'ignition_tag_read',
    endpoint_hint = excluded.endpoint_hint,
    expected_interval_minutes = excluded.expected_interval_minutes,
    credential_binding_ref = excluded.credential_binding_ref,
    contract_note = excluded.contract_note,
    register_ref = 'C2.21',
    status = excluded.status,
    enabled = excluded.enabled,
    direction = 'read_only',
    write_enabled = false,
    pagination_mode = 'none',
    pagination_next_path = null,
    pagination_max_pages = 1,
    scada_tag_paths = excluded.scada_tag_paths
  returning id into v_id;

  insert into public.decisions(
    organization_id, decision_type, action_taken, approval_status, autonomy_mode,
    confidence_score, human_actor, rationale, outcome_status
  ) values (
    v_org, 'ignition_scada_read_source',
    case when p_enabled then 'Activated' else 'Configured/disabled' end
      || ' read-only Ignition tag source ' || btrim(p_key),
    'approved', 'manual', 100, auth.uid()::text, btrim(p_basis), 'executed'
  );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_id,
    'enabled', p_enabled,
    'direction', 'read_only',
    'write_enabled', false,
    'source_profile', 'ignition_tag_read',
    'tag_count', jsonb_array_length(v_paths),
    'note', case when p_enabled
      then 'Enabled bounded user-triggered Ignition tag reads. No tag write is possible from this source.'
      else 'Saved disabled. Deploy the approved host and credential binding before enabling.'
    end
  );
end
$$;

revoke all on function public.configure_ignition_scada_source(
  text, text, text, jsonb, int, text, boolean, text
) from public, anon;
grant execute on function public.configure_ignition_scada_source(
  text, text, text, jsonb, int, text, boolean, text
) to authenticated;

create or replace function public.get_ignition_scada_source(p_connector_key text)
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
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'Ignition source access denied');
  end if;
  select * into v_connector from public.connectors
  where organization_id = v_org
    and connector_key = btrim(p_connector_key)
    and connector_type = 'scada_read'
    and system_kind = 'historian'
    and connector_profile = 'ignition_tag_read'
    and register_ref = 'C2.21';
  if not found then
    return jsonb_build_object('error', 'governed Ignition source not found');
  end if;
  return jsonb_build_object(
    'organization_id', v_org,
    'connector_key', v_connector.connector_key,
    'enabled', v_connector.enabled,
    'direction', v_connector.direction,
    'write_enabled', v_connector.write_enabled,
    'source_profile', v_connector.connector_profile,
    'resource_url', v_connector.endpoint_hint,
    'credential_binding_ref', v_connector.credential_binding_ref,
    'tag_paths', v_connector.scada_tag_paths
  );
end
$$;

revoke all on function public.get_ignition_scada_source(text) from public, anon;
grant execute on function public.get_ignition_scada_source(text) to authenticated;

create or replace function public.begin_ignition_scada_read_run(
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
  v_bytes bigint := 0;
  v_run uuid;
  v_from timestamptz;
  v_observed_at timestamptz;
  v_expected int;
  v_seen text[] := '{}';
  v_path text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'Ignition transport attestation is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id = p_triggered_by and organization_id = p_organization_id;
  if coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'Ignition run actor is not authorized for this tenant');
  end if;
  select * into v_connector from public.connectors
  where organization_id = p_organization_id
    and connector_key = btrim(p_connector_key)
    and connector_type = 'scada_read'
    and system_kind = 'historian'
    and connector_profile = 'ignition_tag_read'
    and register_ref = 'C2.21'
    and enabled
    and direction = 'read_only'
    and not write_enabled
  for update;
  if not found then
    return jsonb_build_object('error', 'active governed Ignition source not found');
  end if;
  if exists (
    select 1 from public.connector_runs r
    where r.connector_id = v_connector.id
      and r.organization_id = p_organization_id
      and r.entity_type = 'ignition_tag_reading'
      and r.status = 'running'
  ) then
    return jsonb_build_object('error', 'an Ignition tag read is already running for this connector');
  end if;
  v_expected := jsonb_array_length(v_connector.scada_tag_paths);
  if coalesce(jsonb_typeof(p_manifest), '') <> 'array'
     or jsonb_array_length(p_manifest) <> v_expected
     or coalesce(jsonb_typeof(p_cursor_to), '') <> 'object'
     or coalesce(p_cursor_to->>'fetched_at', '') = ''
     or coalesce(p_source_bytes, 0) <= 0
     or p_source_bytes > 2097152 then
    return jsonb_build_object('error', 'bounded Ignition transport evidence is invalid');
  end if;
  begin
    v_observed_at := (p_cursor_to->>'fetched_at')::timestamptz;
  exception when others then
    return jsonb_build_object('error', 'Ignition transport timestamp is invalid');
  end;
  if not isfinite(v_observed_at) or v_observed_at > now() + interval '5 minutes' then
    return jsonb_build_object('error', 'Ignition timestamp is not a finite current observation');
  end if;
  for v_item in select value from jsonb_array_elements(p_manifest) loop
    v_page := v_page + 1;
    v_path := v_connector.scada_tag_paths->> (v_page - 1);
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'transport', '') <> 'ignition_webdev_get'
       or coalesce(v_item->>'resource', '') <> 'system.tag.readBlocking'
       or coalesce(v_item->>'page', '') <> v_page::text
       or coalesce(v_item->>'tag_path', '') <> v_path
       or coalesce(v_item->>'sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_item->>'bytes', '') !~ '^[0-9]+$'
       or v_path is null
       or v_path = any(v_seen) then
      return jsonb_build_object('error', 'Ignition manifest is missing bounded tag provenance');
    end if;
    if (v_item->>'bytes')::bigint <= 0 or (v_item->>'bytes')::bigint > 65536 then
      return jsonb_build_object('error', 'Ignition source pages must contain no more than 64 KB');
    end if;
    v_seen := v_seen || v_path;
    v_bytes := v_bytes + (v_item->>'bytes')::bigint;
  end loop;
  if v_bytes <> p_source_bytes
     or coalesce(p_cursor_to->>'raw_rows', '') <> v_expected::text
     or coalesce(p_cursor_to->>'pages', '') <> v_page::text
     or coalesce(p_cursor_to->>'mapped_rows', '') <> v_expected::text then
    return jsonb_build_object('error', 'Ignition manifest does not reconcile to the approved tag list');
  end if;
  select last_position into v_from from public.ingest_watermarks
  where connector_id = v_connector.id and entity_type = 'ignition_tag_reading';
  if v_from is not null and v_observed_at <= v_from then
    return jsonb_build_object('error', 'Ignition observation does not advance the clean connector watermark');
  end if;
  perform set_config('app.ignition_scada_transport', 'granted', true);
  insert into public.connector_runs(
    organization_id, connector_id, entity_type, run_type, status, started_at,
    watermark_from, watermark_to, triggered_by, transport_manifest,
    transport_cursor_to, source_object_count, source_bytes
  ) values (
    p_organization_id, v_connector.id, 'ignition_tag_reading', 'sync', 'running', now(),
    v_from, v_observed_at, p_triggered_by, p_manifest, p_cursor_to, v_page, p_source_bytes
  ) returning id into v_run;
  return jsonb_build_object(
    'ok', true, 'run_id', v_run, 'watermark_from', v_from, 'cursor_to', p_cursor_to
  );
end
$$;

revoke all on function public.begin_ignition_scada_read_run(
  uuid, uuid, text, jsonb, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.begin_ignition_scada_read_run(
  uuid, uuid, text, jsonb, jsonb, bigint
) to service_role;

create or replace function public.ingest_ignition_scada_read_batch(
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
  v_prev jsonb;
  v_taken timestamptz;
  v_read int := 0;
  v_ok int := 0;
  v_duplicate int := 0;
  v_rejected int := 0;
  v_reason text;
  v_expected int;
  v_index int := 0;
  v_seen text[] := '{}';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('error', 'Ignition ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles
  where id = p_triggered_by and organization_id = p_organization_id;
  if coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'Ignition ingest actor is not authorized for this tenant');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id = r.connector_id and c.organization_id = r.organization_id
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.triggered_by = p_triggered_by
    and r.status = 'running'
    and r.entity_type = 'ignition_tag_reading'
    and r.records_read = 0
    and c.connector_type = 'scada_read'
    and c.system_kind = 'historian'
    and c.connector_profile = 'ignition_tag_read'
    and c.register_ref = 'C2.21'
    and c.enabled
    and c.direction = 'read_only'
    and not c.write_enabled;
  if not found then
    return jsonb_build_object('error', 'running attested Ignition run not found');
  end if;
  select * into v_connector from public.connectors c
  where c.id = v_run.connector_id and c.organization_id = p_organization_id;
  v_expected := jsonb_array_length(v_connector.scada_tag_paths);
  if coalesce(jsonb_typeof(p_rows), '') <> 'array'
     or jsonb_array_length(p_rows) <> v_expected then
    return jsonb_build_object(
      'error', 'Ignition rows must exactly reconcile to the approved tag list'
    );
  end if;

  perform set_config('app.ignition_scada_ingest', 'granted', true);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_read := v_read + 1;
    v_index := v_index + 1;
    v_reason := null;
    v_ext := nullif(btrim(v_row->>'external_id'), '');
    if jsonb_typeof(v_row) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_row) k
         where k not in ('external_id', 'path', 'value', 'quality', 'timestamp')
       ) then
      v_reason := 'row contains fields outside the governed Ignition tag contract';
    elsif v_ext is null
       or v_ext is distinct from btrim(v_row->>'path')
       or v_ext is distinct from v_connector.scada_tag_paths->> (v_index - 1)
       or coalesce(v_row->>'quality', '') = ''
       or coalesce(v_row->>'timestamp', '') = ''
       or not (v_row ? 'value') then
      v_reason := 'path, value, quality, timestamp and exact approved identity are required';
    elsif jsonb_typeof(v_row->'value') not in ('number', 'string', 'boolean', 'null') then
      v_reason := 'Ignition tag value must be a scalar';
    elsif length(coalesce(v_row->>'quality', '')) > 80
       or length(coalesce(v_row->>'timestamp', '')) > 40
       or (jsonb_typeof(v_row->'value') = 'string' and length(v_row->>'value') > 2000) then
      v_reason := 'Ignition tag field exceeds its retained length';
    else
      begin
        v_taken := (v_row->>'timestamp')::timestamptz;
        if not isfinite(v_taken)
           or v_taken > v_run.watermark_to + interval '5 minutes' then
          v_reason := 'tag timestamp does not match the attested Ignition snapshot';
        end if;
      exception when others then
        v_reason := 'tag timestamp is invalid';
      end;
    end if;
    if v_reason is null and v_ext = any(v_seen) then
      v_reason := 'mapped Ignition response repeats a tag path';
    elsif v_reason is null then
      v_seen := v_seen || v_ext;
    end if;
    if v_reason is not null then
      v_rejected := v_rejected + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'ignition_tag_reading', v_ext, v_row, 'rejected', v_reason
      );
      continue;
    end if;
    select s.payload into v_prev
    from public.ingest_staging s
    where s.organization_id = p_organization_id
      and s.connector_id = v_connector.id
      and s.entity_type = 'ignition_tag_reading'
      and s.external_id = v_ext
      and s.status in ('accepted', 'duplicate')
    order by s.received_at desc
    limit 1;
    if v_prev is not null
       and v_prev->'value' = v_row->'value'
       and v_prev->>'quality' = v_row->>'quality'
       and v_prev->>'timestamp' = v_row->>'timestamp' then
      v_duplicate := v_duplicate + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'ignition_tag_reading', v_ext, v_row, 'duplicate'
      );
    else
      v_ok := v_ok + 1;
      insert into public.ingest_staging(
        organization_id, connector_id, run_id, entity_type, external_id, payload, status
      ) values (
        p_organization_id, v_connector.id, p_run_id, 'ignition_tag_reading', v_ext, v_row, 'accepted'
      );
    end if;
  end loop;
  update public.connector_runs set
    records_read = v_read,
    records_accepted = v_ok,
    records_rejected = v_rejected,
    records_duplicate = v_duplicate
  where id = p_run_id and organization_id = p_organization_id;
  insert into public.audit_events(
    organization_id, entity_type, actor, event_data, new_state
  ) values (
    p_organization_id, 'ignition_scada_read', v_role,
    jsonb_build_object(
      'action', 'read_tags',
      'runId', p_run_id,
      'connectorKey', v_connector.connector_key,
      'actorId', p_triggered_by,
      'sourceWriteBack', false
    ),
    jsonb_build_object(
      'read', v_read,
      'accepted', v_ok,
      'duplicate', v_duplicate,
      'rejected', v_rejected
    )
  );
  return jsonb_build_object(
    'read', v_read, 'accepted', v_ok, 'duplicate', v_duplicate, 'rejected', v_rejected
  );
end
$$;

revoke all on function public.ingest_ignition_scada_read_batch(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_ignition_scada_read_batch(
  uuid, uuid, uuid, jsonb
) to service_role;

create or replace function public.enforce_ignition_scada_run_attestation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists (
    select 1 from public.connectors c
    where c.id = new.connector_id
      and c.connector_type = 'scada_read'
      and c.system_kind = 'historian'
      and c.connector_profile = 'ignition_tag_read'
      and c.register_ref = 'C2.21'
  ) then
    if tg_op = 'INSERT'
       and coalesce(current_setting('app.ignition_scada_transport', true), '') <> 'granted' then
      raise exception 'governed Ignition runs require service-attested complete transport evidence';
    end if;
    if tg_op = 'UPDATE'
       and coalesce(current_setting('app.ignition_scada_ingest', true), '') <> 'granted'
       and coalesce(current_setting('app.ignition_scada_finish', true), '') <> 'granted' then
      raise exception 'governed Ignition runs require service-only ingest or finish';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_ignition_scada_run_attestation on public.connector_runs;
create trigger trg_ignition_scada_run_attestation
before insert or update on public.connector_runs
for each row execute function public.enforce_ignition_scada_run_attestation();

create or replace function public.finish_ignition_scada_read_run(
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
    return jsonb_build_object('error', 'Ignition finish is service-only');
  end if;
  if p_status not in ('success', 'partial', 'failed') then
    return jsonb_build_object('error', 'Ignition status must be success, partial or failed');
  end if;
  select r.* into v_run
  from public.connector_runs r
  join public.connectors c
    on c.id = r.connector_id and c.organization_id = r.organization_id
  where r.id = p_run_id
    and r.organization_id = p_organization_id
    and r.status = 'running'
    and c.connector_type = 'scada_read'
    and c.system_kind = 'historian'
    and c.connector_profile = 'ignition_tag_read'
    and c.register_ref = 'C2.21';
  if not found then
    return jsonb_build_object('error', 'running governed Ignition run not found');
  end if;
  v_expected := (v_run.transport_cursor_to->>'mapped_rows')::int;
  if p_status in ('success', 'partial') and v_run.records_read <> v_expected then
    return jsonb_build_object('error', 'Ignition run rows do not reconcile to the attested tag list');
  end if;
  if p_status = 'success' and v_run.records_rejected > 0 then
    return jsonb_build_object('error', 'an Ignition run with rejected rows cannot finish as success');
  end if;
  v_clean := p_status = 'success'
    and v_run.records_rejected = 0
    and v_run.transport_manifest is not null
    and v_run.transport_cursor_to is not null;
  perform set_config('app.ignition_scada_finish', 'granted', true);
  update public.connector_runs set
    status = p_status,
    finished_at = now(),
    records_processed = records_accepted,
    error_message = case when p_error is null then null else left(p_error, 500) end
  where id = p_run_id and organization_id = p_organization_id;
  if v_clean then
    insert into public.ingest_watermarks(
      organization_id, connector_id, entity_type, last_position, last_cursor, last_run_id, updated_at
    ) values (
      p_organization_id, v_run.connector_id, 'ignition_tag_reading', v_run.watermark_to,
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
  update public.connectors set
    last_success_at = case when v_clean then now() else last_success_at end,
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

revoke all on function public.finish_ignition_scada_read_run(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.finish_ignition_scada_read_run(
  uuid, uuid, text, text
) to service_role;

notify pgrst, 'reload schema';
