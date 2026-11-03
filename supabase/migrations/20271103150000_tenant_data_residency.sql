-- E12.14 — tenant-declared data residency.
--
-- One current residency region per tenant, plus current bindings for storage
-- buckets and external storage hosts, processing routes, connector keys and
-- AI-provider hostnames. A path runs only when its binding names that same
-- region. Missing, invalid, unbound and mismatched paths are refused and the
-- decision is written to the canonical audit ledger.
--
-- The region is an identifier the tenant declares. This control does not
-- certify cloud-provider placement, backups, logging or subprocessors, and it
-- does not authorize plant action.

create table if not exists public.tenant_residency_declarations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  residency_region text not null,
  basis text not null,
  status text not null check (status in ('current','superseded')),
  declared_by uuid not null references auth.users(id) on delete restrict,
  supersedes_id bigint references public.tenant_residency_declarations(id) on delete restrict,
  superseded_by_id bigint references public.tenant_residency_declarations(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

create unique index if not exists idx_tenant_residency_current
  on public.tenant_residency_declarations(organization_id)
  where status = 'current';

create table if not exists public.tenant_residency_bindings (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  path_kind text not null check (path_kind in ('storage','processing','connector','ai_provider')),
  path_ref text not null,
  bound_region text not null,
  basis text not null,
  status text not null check (status in ('current','superseded')),
  version integer not null check (version > 0),
  bound_by uuid not null references auth.users(id) on delete restrict,
  supersedes_id bigint references public.tenant_residency_bindings(id) on delete restrict,
  superseded_by_id bigint references public.tenant_residency_bindings(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, path_kind, path_ref, version)
);

create unique index if not exists idx_tenant_residency_binding_current
  on public.tenant_residency_bindings(organization_id, path_kind, path_ref)
  where status = 'current';

alter table public.tenant_residency_declarations enable row level security;
alter table public.tenant_residency_bindings enable row level security;

drop policy if exists tenant_residency_declarations_select on public.tenant_residency_declarations;
create policy tenant_residency_declarations_select
  on public.tenant_residency_declarations
  for select
  to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists tenant_residency_bindings_select on public.tenant_residency_bindings;
create policy tenant_residency_bindings_select
  on public.tenant_residency_bindings
  for select
  to authenticated
  using (organization_id = public.app_current_org());

revoke all on table public.tenant_residency_declarations from public, anon, authenticated, service_role;
revoke all on table public.tenant_residency_bindings from public, anon, authenticated, service_role;
grant select on public.tenant_residency_declarations to authenticated;
grant select on public.tenant_residency_bindings to authenticated;

create or replace function public.guard_tenant_residency_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(current_setting('app.tenant_residency_writer', true), '') <> 'governed' then
    raise exception 'Residency records require the governed declaration workflow';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Residency records are retained; supersede them instead of deleting them';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'tenant_residency_declarations' then
      if new.organization_id is distinct from old.organization_id
         or new.version is distinct from old.version
         or new.residency_region is distinct from old.residency_region
         or new.basis is distinct from old.basis
         or new.declared_by is distinct from old.declared_by
         or new.supersedes_id is distinct from old.supersedes_id
         or new.created_at is distinct from old.created_at then
        raise exception 'Residency declarations are immutable; supersede them';
      end if;
    else
      if new.organization_id is distinct from old.organization_id
         or new.path_kind is distinct from old.path_kind
         or new.path_ref is distinct from old.path_ref
         or new.bound_region is distinct from old.bound_region
         or new.basis is distinct from old.basis
         or new.version is distinct from old.version
         or new.bound_by is distinct from old.bound_by
         or new.supersedes_id is distinct from old.supersedes_id
         or new.created_at is distinct from old.created_at then
        raise exception 'Residency bindings are immutable; supersede them';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_guard_tenant_residency_declarations on public.tenant_residency_declarations;
create trigger trg_guard_tenant_residency_declarations
before insert or update or delete on public.tenant_residency_declarations
for each row execute function public.guard_tenant_residency_write();

drop trigger if exists trg_guard_tenant_residency_bindings on public.tenant_residency_bindings;
create trigger trg_guard_tenant_residency_bindings
before insert or update or delete on public.tenant_residency_bindings
for each row execute function public.guard_tenant_residency_write();

create or replace function public.evaluate_data_residency(
  p_organization_id uuid,
  p_path_kind text,
  p_path_ref text,
  p_actor_id uuid,
  p_actor_label text,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_kind text := lower(btrim(coalesce(p_path_kind, '')));
  v_ref text := lower(btrim(coalesce(p_path_ref, '')));
  v_region text;
  v_bound text;
  v_declaration_id bigint;
  v_binding_id bigint;
  v_allowed boolean := false;
  v_reason text := 'residency_undeclared';
begin
  if p_organization_id is null
     or not exists(select 1 from public.organizations o where o.id = p_organization_id) then
    return jsonb_build_object('allowed', false, 'reason', 'tenant_not_found', 'operationalAuthority', false);
  end if;

  if v_kind not in ('storage', 'processing', 'connector', 'ai_provider')
     or v_ref !~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
     or v_ref like '%..%'
     or (v_kind = 'ai_provider' and position('.' in v_ref) < 2) then
    v_reason := 'residency_path_invalid';
  else
    select d.id, d.residency_region into v_declaration_id, v_region
    from public.tenant_residency_declarations d
    where d.organization_id = p_organization_id and d.status = 'current';
    if not found then
      v_reason := 'residency_undeclared';
    else
      select b.id, b.bound_region into v_binding_id, v_bound
      from public.tenant_residency_bindings b
      where b.organization_id = p_organization_id
        and b.path_kind = v_kind
        and b.path_ref = v_ref
        and b.status = 'current';
      if not found then
        v_reason := 'residency_path_unbound';
      elsif v_bound is distinct from v_region then
        v_reason := 'residency_region_mismatch';
      else
        v_allowed := true;
        v_reason := 'current_binding_matches';
      end if;
    end if;
  end if;

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    p_organization_id,
    'data_residency',
    left(coalesce(p_actor_label, p_channel, 'unknown'), 200),
    jsonb_build_object(
      'event', 'data_residency_decision',
      'allowed', v_allowed,
      'reason', v_reason,
      'pathKind', v_kind,
      'pathRef', v_ref,
      'declarationId', v_declaration_id,
      'bindingId', v_binding_id,
      'declaredRegion', v_region,
      'boundRegion', v_bound,
      'channel', p_channel,
      'operationalAuthority', false
    )
  );
  insert into public.security_events(
    organization_id, actor_id, actor_label, event_type, severity, detail)
  values (
    p_organization_id,
    p_actor_id,
    left(coalesce(p_actor_label, p_channel, 'unknown'), 400),
    case when v_allowed then 'data_residency_allowed' else 'data_residency_denied' end,
    case when v_allowed then 'info' else 'warning' end,
    left(v_kind || ':' || v_ref || '; ' || v_reason, 2000)
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'pathKind', v_kind,
    'pathRef', v_ref,
    'declarationId', v_declaration_id,
    'bindingId', v_binding_id,
    'declaredRegion', v_region,
    'operationalAuthority', false
  );
end;
$fn$;

create or replace function public.authorize_data_residency(
  p_path_kind text,
  p_path_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_label text;
begin
  if v_org is null or v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'assured_tenant_session_required', 'operationalAuthority', false);
  end if;
  select coalesce(full_name, email) into v_label
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  return public.evaluate_data_residency(
    v_org, p_path_kind, p_path_ref, v_uid, v_label, 'authenticated');
end;
$fn$;

create or replace function public.authorize_service_data_residency(
  p_organization_id uuid,
  p_path_kind text,
  p_path_ref text,
  p_service_label text default 'edge-function'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('allowed', false, 'reason', 'service_role_required', 'operationalAuthority', false);
  end if;
  return public.evaluate_data_residency(
    p_organization_id,
    p_path_kind,
    p_path_ref,
    null,
    left(coalesce(p_service_label, 'edge-function'), 400),
    'service'
  );
end;
$fn$;

create or replace function public.storage_residency_permitted(p_bucket_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_decision jsonb;
begin
  if v_org is null or auth.uid() is null then
    return false;
  end if;
  v_decision := public.evaluate_data_residency(
    v_org, 'storage', p_bucket_id, auth.uid(), 'storage-policy', 'storage_policy');
  return coalesce((v_decision ->> 'allowed')::boolean, false);
end;
$fn$;

drop policy if exists tenant_residency_storage_insert on storage.objects;
create policy tenant_residency_storage_insert
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (public.storage_residency_permitted(bucket_id));

create or replace function public.declare_tenant_residency(
  p_region text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_label text;
  v_region text := lower(btrim(coalesce(p_region, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_current public.tenant_residency_declarations%rowtype;
  v_version integer;
  v_id bigint;
begin
  select role, coalesce(full_name, email) into v_role, v_label
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if v_org is null or v_uid is null or coalesce(v_role, '') not in ('admin', 'executive') then
    return jsonb_build_object('error', 'An administrator or executive in this tenant is required');
  end if;
  if not public.app_actor_has_verified_mfa(v_uid) or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error', 'Residency declaration requires a verified factor and an AAL2 session');
  end if;
  if v_region !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    return jsonb_build_object('error', 'Residency region must be a tenant-declared identifier such as canada-central');
  end if;
  if length(v_basis) < 30 or length(v_basis) > 2000 then
    return jsonb_build_object('error', 'State the basis for this region in 30 to 2000 characters');
  end if;

  select * into v_current
  from public.tenant_residency_declarations
  where organization_id = v_org and status = 'current'
  for update;
  select coalesce(max(version), 0) + 1 into v_version
  from public.tenant_residency_declarations
  where organization_id = v_org;

  perform set_config('app.tenant_residency_writer', 'governed', true);
  insert into public.tenant_residency_declarations(
    organization_id, version, residency_region, basis, status, declared_by, supersedes_id)
  values (
    v_org, v_version, v_region, v_basis, 'current', v_uid,
    case when v_current.id is null then null else v_current.id end)
  returning id into v_id;
  if v_current.id is not null then
    update public.tenant_residency_declarations
    set status = 'superseded', superseded_by_id = v_id
    where id = v_current.id;
  end if;
  perform set_config('app.tenant_residency_writer', '', true);

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'data_residency', left(coalesce(v_label, v_role), 200),
    jsonb_build_object(
      'event', 'data_residency_declared',
      'declarationId', v_id,
      'version', v_version,
      'region', v_region,
      'supersedesId', v_current.id,
      'declaredBy', v_uid,
      'aal', 'aal2',
      'verifiedFactor', true,
      'operationalAuthority', false
    )
  );
  return jsonb_build_object(
    'declarationId', v_id,
    'version', v_version,
    'region', v_region,
    'operationalAuthority', false
  );
exception
  when unique_violation then
    perform set_config('app.tenant_residency_writer', '', true);
    return jsonb_build_object('error', 'A residency declaration was recorded concurrently; reload and retry');
  when others then
    perform set_config('app.tenant_residency_writer', '', true);
    raise;
end;
$fn$;

create or replace function public.bind_tenant_residency_path(
  p_path_kind text,
  p_path_ref text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
  v_label text;
  v_kind text := lower(btrim(coalesce(p_path_kind, '')));
  v_ref text := lower(btrim(coalesce(p_path_ref, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_region text;
  v_current public.tenant_residency_bindings%rowtype;
  v_version integer;
  v_id bigint;
begin
  select role, coalesce(full_name, email) into v_role, v_label
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if v_org is null or v_uid is null or coalesce(v_role, '') not in ('admin', 'executive') then
    return jsonb_build_object('error', 'An administrator or executive in this tenant is required');
  end if;
  if not public.app_actor_has_verified_mfa(v_uid) or public.app_current_aal() <> 'aal2' then
    return jsonb_build_object('error', 'Residency binding requires a verified factor and an AAL2 session');
  end if;
  if length(v_basis) < 30 or length(v_basis) > 2000 then
    return jsonb_build_object('error', 'State why this path is bound to the declared region in 30 to 2000 characters');
  end if;
  if v_kind not in ('storage', 'processing', 'connector', 'ai_provider')
     or v_ref !~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
     or v_ref like '%..%'
     or (v_kind = 'ai_provider' and position('.' in v_ref) < 2) then
    return jsonb_build_object('error', 'Path kind or path reference is not a bindable residency target');
  end if;

  select residency_region into v_region
  from public.tenant_residency_declarations
  where organization_id = v_org and status = 'current'
  for update;
  if not found then
    return jsonb_build_object('error', 'Declare a residency region before binding a path');
  end if;

  select * into v_current
  from public.tenant_residency_bindings
  where organization_id = v_org and path_kind = v_kind and path_ref = v_ref and status = 'current'
  for update;
  select coalesce(max(version), 0) + 1 into v_version
  from public.tenant_residency_bindings
  where organization_id = v_org and path_kind = v_kind and path_ref = v_ref;

  perform set_config('app.tenant_residency_writer', 'governed', true);
  insert into public.tenant_residency_bindings(
    organization_id, path_kind, path_ref, bound_region, basis, status, version, bound_by, supersedes_id)
  values (
    v_org, v_kind, v_ref, v_region, v_basis, 'current', v_version, v_uid,
    case when v_current.id is null then null else v_current.id end)
  returning id into v_id;
  if v_current.id is not null then
    update public.tenant_residency_bindings
    set status = 'superseded', superseded_by_id = v_id
    where id = v_current.id;
  end if;
  perform set_config('app.tenant_residency_writer', '', true);

  insert into public.audit_events(organization_id, entity_type, actor, event_data)
  values (
    v_org, 'data_residency', left(coalesce(v_label, v_role), 200),
    jsonb_build_object(
      'event', 'data_residency_path_bound',
      'bindingId', v_id,
      'version', v_version,
      'pathKind', v_kind,
      'pathRef', v_ref,
      'region', v_region,
      'supersedesId', v_current.id,
      'boundBy', v_uid,
      'aal', 'aal2',
      'verifiedFactor', true,
      'operationalAuthority', false
    )
  );
  return jsonb_build_object(
    'bindingId', v_id,
    'version', v_version,
    'pathKind', v_kind,
    'pathRef', v_ref,
    'region', v_region,
    'operationalAuthority', false
  );
exception
  when unique_violation then
    perform set_config('app.tenant_residency_writer', '', true);
    return jsonb_build_object('error', 'That path binding was recorded concurrently; reload and retry');
  when others then
    perform set_config('app.tenant_residency_writer', '', true);
    raise;
end;
$fn$;

create or replace function public.get_tenant_residency()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_role text;
begin
  select role into v_role
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  if v_org is null or v_uid is null or coalesce(v_role, '') not in ('admin', 'executive') then
    return jsonb_build_object('error', 'An administrator or executive in this tenant is required');
  end if;
  return jsonb_build_object(
    'operationalAuthority', false,
    'boundary', 'Bindings compare a path identifier to the tenant-declared region. They do not certify cloud placement, backups, logging or subprocessors, and they do not authorize plant action.',
    'declaration', (
      select jsonb_build_object(
        'id', d.id,
        'version', d.version,
        'region', d.residency_region,
        'basis', d.basis,
        'declaredAt', d.created_at,
        'declaredByLabel', coalesce(p.full_name, p.email)
      )
      from public.tenant_residency_declarations d
      left join public.user_profiles p on p.id = d.declared_by
      where d.organization_id = v_org and d.status = 'current'
    ),
    'bindings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'version', b.version,
        'pathKind', b.path_kind,
        'pathRef', b.path_ref,
        'region', b.bound_region,
        'basis', b.basis,
        'boundAt', b.created_at,
        'boundByLabel', coalesce(p.full_name, p.email)
      ) order by b.path_kind, b.path_ref)
      from public.tenant_residency_bindings b
      left join public.user_profiles p on p.id = b.bound_by
      where b.organization_id = v_org and b.status = 'current'
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', a.event_time,
        'actor', a.actor,
        'allowed', a.event_data -> 'allowed',
        'reason', a.event_data ->> 'reason',
        'pathKind', a.event_data ->> 'pathKind',
        'pathRef', a.event_data ->> 'pathRef',
        'event', a.event_data ->> 'event'
      ) order by a.event_time desc)
      from (
        select event_time, actor, event_data
        from public.audit_events
        where organization_id = v_org
          and entity_type = 'data_residency'
          and event_data ->> 'event' = 'data_residency_decision'
        order by event_time desc
        limit 8
      ) a
    ), '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.begin_connector_run(
  p_connector_key text,
  p_entity_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_org uuid := app_current_org();
  c connectors%rowtype;
  v_run uuid;
  v_from timestamptz;
  v_uid uuid := auth.uid();
  v_label text;
  v_decision jsonb;
begin
  select * into c from connectors
  where organization_id = v_org and connector_key = p_connector_key;
  if not found then
    return jsonb_build_object('error', 'connector not registered');
  end if;
  if not c.enabled then
    return jsonb_build_object('error',
      format('connector "%s" is registered but not enabled', p_connector_key));
  end if;

  select coalesce(full_name, email) into v_label
  from public.user_profiles
  where id = v_uid and organization_id = v_org;
  v_decision := public.evaluate_data_residency(
    v_org, 'connector', p_connector_key, v_uid, v_label, 'begin_connector_run');
  if coalesce((v_decision ->> 'allowed')::boolean, false) is not true then
    return jsonb_build_object(
      'error', 'Data residency refused: ' || coalesce(v_decision ->> 'reason', 'residency_refused'),
      'code', 'data_residency_denied');
  end if;

  select last_position into v_from from ingest_watermarks
  where connector_id = c.id and entity_type = p_entity_type;

  insert into connector_runs (organization_id, connector_id, entity_type,
    run_type, status, started_at, watermark_from, triggered_by)
  values (v_org, c.id, p_entity_type, 'sync', 'running', now(), v_from, auth.uid())
  returning id into v_run;

  return jsonb_build_object('run_id', v_run, 'watermark_from', v_from,
    'note', case when v_from is null
      then 'No prior watermark: this is a full load.'
      else 'Incremental from the last successful position.' end);
end;
$fn$;

revoke all on function public.guard_tenant_residency_write() from public, anon, authenticated, service_role;
revoke all on function public.evaluate_data_residency(uuid, text, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.authorize_data_residency(text, text) from public, anon, service_role;
revoke all on function public.authorize_service_data_residency(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.storage_residency_permitted(text) from public, anon, service_role;
revoke all on function public.declare_tenant_residency(text, text) from public, anon, service_role;
revoke all on function public.bind_tenant_residency_path(text, text, text) from public, anon, service_role;
revoke all on function public.get_tenant_residency() from public, anon, service_role;
revoke all on function public.begin_connector_run(text, text) from public, anon;

grant execute on function public.authorize_data_residency(text, text) to authenticated;
grant execute on function public.authorize_service_data_residency(uuid, text, text, text) to service_role;
grant execute on function public.storage_residency_permitted(text) to authenticated;
grant execute on function public.declare_tenant_residency(text, text) to authenticated;
grant execute on function public.bind_tenant_residency_path(text, text, text) to authenticated;
grant execute on function public.get_tenant_residency() to authenticated;
grant execute on function public.begin_connector_run(text, text) to authenticated;

comment on table public.tenant_residency_declarations is
  'Canonical tenant residency region. One current row. Versions are immutable and superseded, never edited. Not a cloud-placement certificate.';
comment on function public.authorize_data_residency(text, text) is
  'Fail-closed residency decision for the caller tenant. Refuses undeclared, unbound, invalid and mismatched paths and writes audit_events.';

-- The governed AI fetch already stops when authorize_data_egress returns
-- allowed=false. Fold the residency decision into that existing refusal so
-- every supported provider call is checked without a second client.
create or replace function public.evaluate_data_egress(
  p_organization_id uuid,
  p_destination text,
  p_data_class text,
  p_purpose text,
  p_redaction_applied boolean,
  p_actor_id uuid,
  p_actor_label text,
  p_channel text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $egress$
declare
  v_rule public.data_egress_rules%rowtype;
  v_allowed boolean := false;
  v_reason text := 'no_current_rule';
  v_residency jsonb;
begin
  select der.* into v_rule from public.data_egress_rules der
  where der.organization_id=p_organization_id
    and der.destination=p_destination
    and der.data_class=p_data_class
    and p_purpose=any(der.allowed_purposes)
    and der.rule_status='adopted'
    and der.superseded_by_rule_id is null
  order by der.version desc limit 1;

  if not found then
    v_reason := 'no_current_matching_rule';
  elsif not v_rule.permitted then
    v_reason := 'current_rule_denies';
  elsif v_rule.redaction_required and not p_redaction_applied then
    v_reason := 'required_redaction_not_applied';
  else
    v_allowed := true;
    v_reason := 'current_rule_allows';
  end if;

  if v_allowed then
    v_residency := public.evaluate_data_residency(
      p_organization_id, 'ai_provider', p_destination, p_actor_id, p_actor_label, 'ai_provider');
    if coalesce((v_residency ->> 'allowed')::boolean, false) is not true then
      v_allowed := false;
      v_reason := coalesce(v_residency ->> 'reason', 'residency_refused');
    end if;
  end if;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(p_organization_id,'data_egress_decision',left(coalesce(p_actor_label,p_channel,'unknown'),200),
    jsonb_build_object('event','data_egress_decision','allowed',v_allowed,
      'reason',v_reason,'rule_id',v_rule.id,'rule_version',v_rule.version,
      'destination',p_destination,'data_class',p_data_class,
      'purpose',p_purpose,'redaction_applied',p_redaction_applied,
      'channel',p_channel,'operational_authority',false));
  insert into public.security_events(
    organization_id,actor_id,actor_label,event_type,severity,detail)
  values(p_organization_id,p_actor_id,left(p_actor_label,400),
    case when v_allowed then 'data_egress_allowed' else 'data_egress_denied' end,
    case when v_allowed then 'info' else 'warning' end,
    left('destination='||p_destination||'; class='||p_data_class||'; purpose='||p_purpose||'; reason='||v_reason,2000));

  return jsonb_build_object('allowed',v_allowed,'reason',v_reason,
    'ruleId',v_rule.id,'ruleVersion',v_rule.version,
    'redactionRequired',coalesce(v_rule.redaction_required,false),
    'operationalAuthority',false);
end;
$egress$;

revoke all on function public.evaluate_data_egress(uuid,text,text,text,boolean,uuid,text,text) from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
