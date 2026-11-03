-- ============================================================================
-- E5.02 — least-privilege permissions.
--
-- Canonical reuse:
--   * user_profiles.role remains the application role. app_current_role()
--     remains its resolver. This is not a second identity and it does not
--     reuse user_role_assignments, which is the competency/reviewer store.
--   * app_current_org() remains the tenant resolver.
--   * security_events and audit_events remain the security and governance
--     ledgers. No parallel audit store is introduced.
--
-- What was missing: permission checks were copied role lists. A tenant could
-- not narrow a role, and nothing named the minimum each role may hold. The
-- ceiling below records only permissions those roles already had. A named
-- admin may propose a narrowing; a different admin must adopt it before it
-- takes effect. The ceiling cannot be widened. Propose and adopt themselves
-- cannot be removed, because they are the only path that can restore a
-- narrowing. ai_admin is refused by name.
--
-- Enforcement: app_has_permission is consulted by get_security_events and by
-- the security_events read policy. organization_role_permission_grants is
-- readable only inside the caller's tenant and only with matrix-read
-- permission. Direct writes are refused for the table owner, service_role
-- and authenticated. Nothing here grants engineering judgement, operational
-- release, or authority over plant equipment.
-- ============================================================================

create table if not exists public.organization_role_permission_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_key text not null,
  permission_key text not null,
  effect text not null check (effect in ('revoked', 'restored')),
  status text not null default 'proposed'
    check (status in ('proposed', 'adopted', 'rejected', 'superseded')),
  version integer not null check (version > 0),
  basis text not null check (length(btrim(basis)) >= 20),
  proposed_by uuid not null references public.user_profiles(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references public.user_profiles(id),
  decided_at timestamptz,
  decision_basis text,
  created_at timestamptz not null default now(),
  constraint organization_role_permission_grant_decision_complete check (
    (
      status = 'proposed'
      and decided_by is null
      and decided_at is null
      and decision_basis is null
    )
    or (
      status in ('adopted', 'rejected', 'superseded')
      and decided_by is not null
      and decided_at is not null
      and length(btrim(decision_basis)) >= 20
    )
  ),
  constraint organization_role_permission_grant_sod check (
    decided_by is null or decided_by <> proposed_by
  ),
  unique (organization_id, role_key, permission_key, version)
);

create unique index if not exists organization_role_permission_one_proposed
  on public.organization_role_permission_grants (organization_id, role_key, permission_key)
  where status = 'proposed';

create unique index if not exists organization_role_permission_one_adopted
  on public.organization_role_permission_grants (organization_id, role_key, permission_key)
  where status = 'adopted';

alter table public.organization_role_permission_grants enable row level security;

revoke all on table public.organization_role_permission_grants
  from public, anon, authenticated;
grant select on table public.organization_role_permission_grants to authenticated;

-- The platform ceiling. Immutable SQL, not a tenant-editable catalogue:
-- a customer must not be able to insert a permission a role never held.
create or replace function public.app_permission_ceiling(
  p_role text,
  p_permission_key text
)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select case lower(coalesce(p_permission_key, ''))
    when 'security.audit.read' then
      lower(coalesce(p_role, '')) in ('admin', 'ai_admin')
    when 'security.permissions.read' then
      lower(coalesce(p_role, '')) in ('admin', 'ai_admin', 'executive')
    when 'security.permissions.propose' then
      lower(coalesce(p_role, '')) = 'admin'
    when 'security.permissions.adopt' then
      lower(coalesce(p_role, '')) = 'admin'
    else false
  end
$fn$;

create or replace function public.app_has_permission(p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_role text;
  v_key text := lower(coalesce(p_permission_key, ''));
begin
  if auth.uid() is null then
    return false;
  end if;
  v_org := public.app_current_org();
  v_role := public.app_current_role();
  if v_org is null or v_role = '' then
    return false;
  end if;
  if not public.app_permission_ceiling(v_role, v_key) then
    return false;
  end if;
  if exists (
    select 1
    from public.organization_role_permission_grants g
    where g.organization_id = v_org
      and g.role_key = v_role
      and g.permission_key = v_key
      and g.status = 'adopted'
      and g.effect = 'revoked'
  ) then
    return false;
  end if;
  return true;
end
$fn$;

create or replace function public.guard_role_permission_grant_write()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  -- Invoker rights on purpose: current_user is the session, so a client role
  -- cannot pass by setting the writer flag. A governed security-definer
  -- function runs as the owner and still has to present the flag.
  if current_user in ('anon', 'authenticated', 'service_role')
     or coalesce(current_setting('app.role_permission_grant_writer', true), '')
        is distinct from 'governed' then
    raise exception 'direct role-permission writes are refused';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'role permission grants are retained and cannot be deleted';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.role_key is distinct from old.role_key
       or new.permission_key is distinct from old.permission_key
       or new.effect is distinct from old.effect
       or new.version is distinct from old.version
       or new.basis is distinct from old.basis
       or new.proposed_by is distinct from old.proposed_by
       or new.proposed_at is distinct from old.proposed_at
       or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id then
      raise exception 'a role permission grant is immutable aside from its decision';
    end if;
    if not (
      (old.status = 'proposed' and new.status in ('adopted', 'rejected'))
      or (old.status = 'adopted' and new.status = 'superseded')
    ) then
      raise exception 'that role permission transition is not allowed';
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists trg_role_permission_grant_write
  on public.organization_role_permission_grants;
create trigger trg_role_permission_grant_write
  before insert or update or delete on public.organization_role_permission_grants
  for each row execute function public.guard_role_permission_grant_write();

drop policy if exists organization_role_permission_grants_read
  on public.organization_role_permission_grants;
create policy organization_role_permission_grants_read
  on public.organization_role_permission_grants
  for select to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_permission('security.permissions.read')
  );

-- Security audit reads now follow the same permission, so a later narrowing
-- denies a role the old inline list would have kept admitting.
drop policy if exists security_events_admin_read on public.security_events;
create policy security_events_admin_read on public.security_events
  for select to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_permission('security.audit.read')
  );

create or replace function public.get_security_events(p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
begin
  if auth.uid() is null
     or v_org is null
     or not public.app_has_permission('security.audit.read') then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object('events', coalesce((
    select jsonb_agg(row_to_json(e))
    from (
      select id, actor_label, event_type, severity, detail, created_at
      from public.security_events
      where organization_id = v_org
      order by created_at desc
      limit least(greatest(coalesce(p_limit, 1), 1), 500)
    ) e
  ), '[]'::jsonb));
end
$fn$;

create or replace function public.get_role_permission_grants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_can_read boolean := public.app_has_permission('security.permissions.read');
  v_roles text[] := array[
    'admin', 'ai_admin', 'executive', 'board', 'maintenance_manager',
    'supervisor', 'reliability_engineer', 'planner', 'technician', 'operator',
    'assessment_sponsor'
  ];
  v_keys text[] := array[
    'security.audit.read',
    'security.permissions.read',
    'security.permissions.propose',
    'security.permissions.adopt'
  ];
  v_own jsonb;
  v_matrix jsonb;
begin
  if v_uid is null or v_org is null or v_role = '' then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(item order by item->>'permission_key'), '[]'::jsonb)
    into v_own
  from (
    select jsonb_build_object(
      'permission_key', permission_key,
      'ceiling', public.app_permission_ceiling(v_role, permission_key),
      'effective', public.app_permission_ceiling(v_role, permission_key)
        and not exists (
          select 1
          from public.organization_role_permission_grants g
          where g.organization_id = v_org
            and g.role_key = v_role
            and g.permission_key = own_keys.permission_key
            and g.status = 'adopted'
            and g.effect = 'revoked'
        )
    ) as item
    from unnest(v_keys) as own_keys(permission_key)
  ) own_rows;

  if v_can_read then
    select coalesce(jsonb_agg(item order by item->>'role_key', item->>'permission_key'), '[]'::jsonb)
      into v_matrix
    from (
      select jsonb_build_object(
        'role_key', cells.role_key,
        'permission_key', cells.permission_key,
        'ceiling', cells.ceiling,
        'effective', cells.ceiling
          and coalesce(adopted.effect, '') is distinct from 'revoked',
        'adopted_effect', adopted.effect,
        'proposal_id', proposed.id,
        'proposal_effect', proposed.effect,
        'proposed_by', proposed.proposed_by
      ) as item
      from (
        select role_key, permission_key,
          public.app_permission_ceiling(role_key, permission_key) as ceiling
        from unnest(v_roles) as roles(role_key)
        cross join unnest(v_keys) as keys(permission_key)
      ) cells
      left join public.organization_role_permission_grants adopted
        on adopted.organization_id = v_org
       and adopted.role_key = cells.role_key
       and adopted.permission_key = cells.permission_key
       and adopted.status = 'adopted'
      left join public.organization_role_permission_grants proposed
        on proposed.organization_id = v_org
       and proposed.role_key = cells.role_key
       and proposed.permission_key = cells.permission_key
       and proposed.status = 'proposed'
    ) matrix_rows;
  end if;

  return jsonb_build_object(
    'role', v_role,
    'can_read_matrix', v_can_read,
    'can_propose', public.app_has_permission('security.permissions.propose'),
    'can_adopt', public.app_has_permission('security.permissions.adopt'),
    'operational_authority', false,
    'engineering_authority', false,
    'boundary',
      'A grant can only narrow the platform ceiling for this tenant. '
      || 'It does not authorize engineering judgement, operational release, or plant action.',
    'own_permissions', v_own,
    'matrix', case when v_can_read then v_matrix else 'null'::jsonb end
  );
end
$fn$;

create or replace function public.propose_role_permission_grant(
  p_role_key text,
  p_permission_key text,
  p_effect text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_target text := lower(btrim(coalesce(p_role_key, '')));
  v_key text := lower(btrim(coalesce(p_permission_key, '')));
  v_effect text := lower(btrim(coalesce(p_effect, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_version integer;
  v_id uuid;
  v_known_roles text[] := array[
    'admin', 'ai_admin', 'executive', 'board', 'maintenance_manager',
    'supervisor', 'reliability_engineer', 'planner', 'technician', 'operator',
    'assessment_sponsor'
  ];
  v_known_keys text[] := array[
    'security.audit.read',
    'security.permissions.read',
    'security.permissions.propose',
    'security.permissions.adopt'
  ];
begin
  if v_uid is null or v_org is null or v_role = '' then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_role = 'ai_admin' then
    insert into public.security_events (
      organization_id, actor_id, actor_label, event_type, severity, detail
    )
    select v_org, v_uid, coalesce(full_name, email), 'access_denied', 'warning',
      'ai_admin cannot change role permissions'
    from public.user_profiles where id = v_uid;
    return jsonb_build_object('error', 'ai_admin cannot change role permissions');
  end if;

  if not public.app_has_permission('security.permissions.propose') then
    insert into public.security_events (
      organization_id, actor_id, actor_label, event_type, severity, detail
    )
    select v_org, v_uid, coalesce(full_name, email), 'access_denied', 'warning',
      'forbidden: ' || v_role || ' cannot change role permissions'
    from public.user_profiles where id = v_uid;
    return jsonb_build_object(
      'error', 'forbidden: ' || v_role || ' cannot change role permissions'
    );
  end if;

  if v_effect not in ('revoked', 'restored') then
    return jsonb_build_object(
      'error',
      'permission changes can only revoke a ceiling grant or restore that revocation'
    );
  end if;
  if not (v_target = any(v_known_roles)) then
    return jsonb_build_object('error', 'unknown role');
  end if;
  if not (v_key = any(v_known_keys)) then
    return jsonb_build_object('error', 'unknown permission');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object(
      'error', 'basis must explain the change in at least 20 characters'
    );
  end if;
  if v_effect = 'revoked' and not public.app_permission_ceiling(v_target, v_key) then
    return jsonb_build_object(
      'error', 'cannot revoke a permission the role ceiling does not grant'
    );
  end if;
  if v_key in ('security.permissions.propose', 'security.permissions.adopt') then
    return jsonb_build_object(
      'error',
      'the propose and adopt permissions cannot be removed; they are the only path that can restore a narrowing'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_org::text || ':' || v_target || ':' || v_key)::bigint
  );

  if exists (
    select 1 from public.organization_role_permission_grants g
    where g.organization_id = v_org
      and g.role_key = v_target
      and g.permission_key = v_key
      and g.status = 'proposed'
  ) then
    return jsonb_build_object(
      'error', 'a proposal is already open for this role and permission'
    );
  end if;

  if v_effect = 'revoked' and exists (
    select 1 from public.organization_role_permission_grants g
    where g.organization_id = v_org
      and g.role_key = v_target
      and g.permission_key = v_key
      and g.status = 'adopted'
      and g.effect = 'revoked'
  ) then
    return jsonb_build_object('error', 'that permission is already revoked');
  end if;

  if v_effect = 'restored' and not exists (
    select 1 from public.organization_role_permission_grants g
    where g.organization_id = v_org
      and g.role_key = v_target
      and g.permission_key = v_key
      and g.status = 'adopted'
      and g.effect = 'revoked'
  ) then
    return jsonb_build_object(
      'error', 'nothing is revoked, so there is nothing to restore'
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.organization_role_permission_grants g
  where g.organization_id = v_org
    and g.role_key = v_target
    and g.permission_key = v_key;

  begin
    perform set_config('app.role_permission_grant_writer', 'governed', true);
    insert into public.organization_role_permission_grants (
      organization_id, role_key, permission_key, effect, status, version,
      basis, proposed_by
    ) values (
      v_org, v_target, v_key, v_effect, 'proposed', v_version, v_basis, v_uid
    )
    returning id into v_id;
    perform set_config('app.role_permission_grant_writer', '', true);
  exception
    when others then
      perform set_config('app.role_permission_grant_writer', '', true);
      raise;
  end;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org, 'role_permission_grant', v_role,
    jsonb_build_object(
      'event', 'role_permission_proposed',
      'grant_id', v_id,
      'role_key', v_target,
      'permission_key', v_key,
      'effect', v_effect,
      'version', v_version,
      'proposed_by', v_uid,
      'operational_authority', false,
      'engineering_authority', false
    )
  );
  insert into public.security_events (
    organization_id, actor_id, actor_label, event_type, severity, detail
  )
  select v_org, v_uid, coalesce(full_name, email), 'admin_action', 'notice',
    'Proposed ' || v_effect || ' of ' || v_key || ' for ' || v_target
  from public.user_profiles where id = v_uid;

  return jsonb_build_object(
    'id', v_id,
    'version', v_version,
    'status', 'proposed',
    'effective', false,
    'operational_authority', false,
    'engineering_authority', false
  );
end
$fn$;

create or replace function public.decide_role_permission_grant(
  p_grant_id uuid,
  p_decision text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_basis text := btrim(coalesce(p_basis, ''));
  v_row public.organization_role_permission_grants%rowtype;
  v_status text;
begin
  if v_uid is null or v_org is null or v_role = '' or p_grant_id is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if v_role = 'ai_admin' then
    insert into public.security_events (
      organization_id, actor_id, actor_label, event_type, severity, detail
    )
    select v_org, v_uid, coalesce(full_name, email), 'access_denied', 'warning',
      'ai_admin cannot change role permissions'
    from public.user_profiles where id = v_uid;
    return jsonb_build_object('error', 'ai_admin cannot change role permissions');
  end if;

  if not public.app_has_permission('security.permissions.adopt') then
    insert into public.security_events (
      organization_id, actor_id, actor_label, event_type, severity, detail
    )
    select v_org, v_uid, coalesce(full_name, email), 'access_denied', 'warning',
      'forbidden: ' || v_role || ' cannot change role permissions'
    from public.user_profiles where id = v_uid;
    return jsonb_build_object(
      'error', 'forbidden: ' || v_role || ' cannot change role permissions'
    );
  end if;

  if v_decision not in ('adopt', 'reject') then
    return jsonb_build_object('error', 'decision must adopt or reject');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object(
      'error', 'basis must explain the change in at least 20 characters'
    );
  end if;

  select * into v_row
  from public.organization_role_permission_grants g
  where g.id = p_grant_id
    and g.organization_id = v_org
  for update;
  if not found or v_row.status <> 'proposed' then
    return jsonb_build_object('error', 'role permission grant not found');
  end if;
  if v_row.proposed_by = v_uid then
    return jsonb_build_object(
      'error', 'the proposer cannot adopt their own permission change'
    );
  end if;

  v_status := case when v_decision = 'adopt' then 'adopted' else 'rejected' end;

  begin
    perform set_config('app.role_permission_grant_writer', 'governed', true);
    if v_status = 'adopted' then
      update public.organization_role_permission_grants g
         set status = 'superseded'
       where g.organization_id = v_org
         and g.role_key = v_row.role_key
         and g.permission_key = v_row.permission_key
         and g.status = 'adopted'
         and g.id <> v_row.id;
    end if;
    update public.organization_role_permission_grants g
       set status = v_status,
           decided_by = v_uid,
           decided_at = now(),
           decision_basis = v_basis
     where g.id = v_row.id
       and g.organization_id = v_org;
    perform set_config('app.role_permission_grant_writer', '', true);
  exception
    when others then
      perform set_config('app.role_permission_grant_writer', '', true);
      raise;
  end;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org, 'role_permission_grant', v_role,
    jsonb_build_object(
      'event', 'role_permission_' || v_status,
      'grant_id', v_row.id,
      'role_key', v_row.role_key,
      'permission_key', v_row.permission_key,
      'effect', v_row.effect,
      'decision', v_decision,
      'decided_by', v_uid,
      'proposed_by', v_row.proposed_by,
      'segregation_of_duties', true,
      'operational_authority', false,
      'engineering_authority', false
    )
  );
  insert into public.security_events (
    organization_id, actor_id, actor_label, event_type, severity, detail
  )
  select v_org, v_uid, coalesce(full_name, email), 'admin_action', 'notice',
    v_status || ' ' || v_row.effect || ' of ' || v_row.permission_key
      || ' for ' || v_row.role_key
  from public.user_profiles where id = v_uid;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_status,
    'operational_authority', false,
    'engineering_authority', false
  );
end
$fn$;

revoke all on function public.app_permission_ceiling(text, text)
  from public, anon, authenticated;
revoke all on function public.app_has_permission(text) from public, anon;
revoke all on function public.guard_role_permission_grant_write()
  from public, anon, authenticated;
revoke all on function public.get_role_permission_grants() from public, anon;
revoke all on function public.propose_role_permission_grant(text, text, text, text)
  from public, anon;
revoke all on function public.decide_role_permission_grant(uuid, text, text)
  from public, anon;
revoke all on function public.get_security_events(int) from public, anon;

grant execute on function public.app_has_permission(text) to authenticated;
grant execute on function public.get_role_permission_grants() to authenticated;
grant execute on function public.propose_role_permission_grant(text, text, text, text)
  to authenticated;
grant execute on function public.decide_role_permission_grant(uuid, text, text)
  to authenticated;
grant execute on function public.get_security_events(int) to authenticated;

comment on table public.organization_role_permission_grants is
  'Tenant narrowings of the platform role-permission ceiling. Direct writes are refused. Effective only once a different admin adopts the proposal.';

-- ---------------------------------------------------------------------------
-- Self-test. The inner block rolls back its fixtures. A real failure aborts
-- the migration; the success marker is swallowed only after every denial and
-- the narrowing/restore both held.
-- ---------------------------------------------------------------------------
do $test$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_admin_a uuid := gen_random_uuid();
  v_admin_a2 uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_tech uuid := gen_random_uuid();
  v_ai uuid := gen_random_uuid();
  v_exec uuid := gen_random_uuid();
  v_result jsonb;
  v_grant uuid;
  v_count integer;
begin
  begin
    insert into public.organizations (name)
    values ('__least_privilege_selftest_a_' || v_admin_a) returning id into v_org_a;
    insert into public.organizations (name)
    values ('__least_privilege_selftest_b_' || v_admin_b) returning id into v_org_b;

    insert into public.user_profiles (id, organization_id, email, full_name, role)
    values
      (v_admin_a, v_org_a, 'lp-admin-a@invalid.syncai.ca', 'LP admin A', 'admin'),
      (v_admin_a2, v_org_a, 'lp-admin-a2@invalid.syncai.ca', 'LP admin A2', 'admin'),
      (v_admin_b, v_org_b, 'lp-admin-b@invalid.syncai.ca', 'LP admin B', 'admin'),
      (v_tech, v_org_a, 'lp-tech@invalid.syncai.ca', 'LP technician', 'technician'),
      (v_ai, v_org_a, 'lp-ai@invalid.syncai.ca', 'LP ai admin', 'ai_admin'),
      (v_exec, v_org_a, 'lp-exec@invalid.syncai.ca', 'LP executive', 'executive');

    perform set_config('request.jwt.claim.sub', v_tech::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);

    v_result := public.propose_role_permission_grant(
      'ai_admin', 'security.audit.read', 'revoked',
      'Technician attempting to revoke an audit read.');
    if v_result->>'error' is distinct from
       'forbidden: technician cannot change role permissions' then
      raise exception 'technician propose was not denied: %', v_result;
    end if;
    if not exists (
      select 1 from public.security_events
      where actor_id = v_tech
        and organization_id = v_org_a
        and event_type = 'access_denied'
    ) then
      raise exception 'technician denial was not recorded';
    end if;

    v_result := public.get_security_events(10);
    if v_result->>'error' is distinct from 'forbidden' then
      raise exception 'technician read the security audit: %', v_result;
    end if;

    begin
      insert into public.organization_role_permission_grants (
        organization_id, role_key, permission_key, effect, version, basis, proposed_by
      ) values (
        v_org_a, 'ai_admin', 'security.audit.read', 'revoked', 1,
        'Owner attempting a direct permission write.', v_admin_a
      );
      raise exception 'owner direct insert was accepted';
    exception
      when others then
        if position('direct role-permission writes are refused' in sqlerrm) = 0 then
          raise exception 'owner direct insert failed unexpectedly: %', sqlerrm;
        end if;
    end;

    perform set_config('request.jwt.claim.sub', v_ai::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_ai::text, 'role', 'authenticated')::text, true);
    v_result := public.propose_role_permission_grant(
      'technician', 'security.audit.read', 'revoked',
      'AI administrator attempting to change a human permission.');
    if v_result->>'error' is distinct from 'ai_admin cannot change role permissions' then
      raise exception 'ai_admin propose was not named and denied: %', v_result;
    end if;
    v_result := public.get_security_events(10);
    if v_result ? 'error' then
      raise exception 'ai_admin lost audit read before any narrowing: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_exec::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_exec::text, 'role', 'authenticated')::text, true);
    v_result := public.get_role_permission_grants();
    if coalesce((v_result->>'can_read_matrix')::boolean, false) is distinct from true
       or coalesce((v_result->>'can_propose')::boolean, true) is distinct from false then
      raise exception 'executive matrix visibility was wrong: %', v_result;
    end if;
    v_result := public.propose_role_permission_grant(
      'ai_admin', 'security.audit.read', 'revoked',
      'Executive attempting to administer permissions.');
    if v_result->>'error' is distinct from
       'forbidden: executive cannot change role permissions' then
      raise exception 'executive propose was not denied: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
    v_result := public.propose_role_permission_grant(
      'technician', 'security.permissions.propose', 'revoked',
      'Attempting to revoke a permission the technician ceiling does not grant.');
    if v_result->>'error' is distinct from
       'cannot revoke a permission the role ceiling does not grant' then
      raise exception 'ceiling widening was not refused: %', v_result;
    end if;
    v_result := public.propose_role_permission_grant(
      'technician', 'security.audit.read', 'granted',
      'Attempting to grant a permission the effect check must refuse.');
    if position('can only revoke' in coalesce(v_result->>'error', '')) = 0 then
      raise exception 'a grant effect was accepted: %', v_result;
    end if;
    v_result := public.propose_role_permission_grant(
      'admin', 'security.permissions.adopt', 'revoked',
      'Attempting to remove the only path that can restore a narrowing.');
    if position('cannot be removed' in coalesce(v_result->>'error', '')) = 0 then
      raise exception 'adopt permission was revocable: %', v_result;
    end if;

    v_result := public.propose_role_permission_grant(
      'ai_admin', 'security.audit.read', 'revoked',
      'Narrow ai_admin audit read to the named human administrators.');
    if v_result ? 'error' then
      raise exception 'admin proposal failed: %', v_result;
    end if;
    v_grant := (v_result->>'id')::uuid;

    v_result := public.decide_role_permission_grant(
      v_grant, 'adopt', 'The proposer must not adopt the same change.');
    if v_result->>'error' is distinct from
       'the proposer cannot adopt their own permission change' then
      raise exception 'proposer self-approval was not denied: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_tech::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
    v_result := public.decide_role_permission_grant(
      v_grant, 'adopt', 'Technician attempting to adopt a permission change.');
    if position('technician cannot change role permissions' in coalesce(v_result->>'error', '')) = 0 then
      raise exception 'technician adopt was not denied: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_admin_b::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);
    v_result := public.decide_role_permission_grant(
      v_grant, 'adopt', 'Foreign administrator attempting a cross-tenant decision.');
    if v_result->>'error' is distinct from 'role permission grant not found' then
      raise exception 'cross-tenant decision was not hidden: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_admin_a2::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a2::text, 'role', 'authenticated')::text, true);
    v_result := public.decide_role_permission_grant(
      v_grant, 'adopt', 'Independent administrator adopts the audit-read narrowing.');
    if v_result->>'status' is distinct from 'adopted' then
      raise exception 'independent adopt failed: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_ai::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_ai::text, 'role', 'authenticated')::text, true);
    v_result := public.get_security_events(10);
    if v_result->>'error' is distinct from 'forbidden' then
      raise exception 'adopted narrowing did not deny ai_admin: %', v_result;
    end if;
    v_result := public.get_role_permission_grants();
    if coalesce((v_result->>'can_read_matrix')::boolean, false) is distinct from true
       or exists (
         select 1
         from jsonb_array_elements(v_result->'matrix') cell
         where cell->>'role_key' = 'ai_admin'
           and cell->>'permission_key' = 'security.audit.read'
           and coalesce((cell->>'effective')::boolean, true)
       ) then
      raise exception 'narrowing was not visible on the ai_admin matrix: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
    v_result := public.get_security_events(10);
    if v_result ? 'error' then
      raise exception 'admin audit read was revoked with ai_admin: %', v_result;
    end if;

    begin
      set local role authenticated;
      select count(*) into v_count
      from public.organization_role_permission_grants;
      reset role;
      if v_count < 1 then
        raise exception 'admin RLS read did not see the adopted grant';
      end if;
    exception
      when others then
        reset role;
        raise;
    end;

    perform set_config('request.jwt.claim.sub', v_tech::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_tech::text, 'role', 'authenticated')::text, true);
    v_result := public.get_role_permission_grants();
    if coalesce((v_result->>'can_read_matrix')::boolean, true)
       or coalesce((v_result->>'can_propose')::boolean, true)
       or jsonb_typeof(v_result->'matrix') is distinct from 'null' then
      raise exception 'technician received the permission matrix: %', v_result;
    end if;
    begin
      set local role authenticated;
      select count(*) into v_count
      from public.organization_role_permission_grants;
      reset role;
      if v_count <> 0 then
        raise exception 'technician RLS read saw % grant row(s)', v_count;
      end if;
    exception
      when others then
        reset role;
        raise;
    end;

    perform set_config('request.jwt.claim.sub', v_admin_b::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);
    begin
      set local role authenticated;
      select count(*) into v_count
      from public.organization_role_permission_grants;
      reset role;
      if v_count <> 0 then
        raise exception 'foreign tenant RLS read saw % grant row(s)', v_count;
      end if;
    exception
      when others then
        reset role;
        raise;
    end;

    perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
    v_result := public.propose_role_permission_grant(
      'ai_admin', 'security.audit.read', 'restored',
      'Restore ai_admin audit read after the narrowing held.');
    if v_result ? 'error' then
      raise exception 'restore proposal failed: %', v_result;
    end if;
    v_grant := (v_result->>'id')::uuid;
    perform set_config('request.jwt.claim.sub', v_admin_a2::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a2::text, 'role', 'authenticated')::text, true);
    v_result := public.decide_role_permission_grant(
      v_grant, 'adopt', 'Independent administrator restores the previous audit read.');
    if v_result->>'status' is distinct from 'adopted' then
      raise exception 'restore adopt failed: %', v_result;
    end if;
    perform set_config('request.jwt.claim.sub', v_ai::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_ai::text, 'role', 'authenticated')::text, true);
    v_result := public.get_security_events(10);
    if v_result ? 'error' then
      raise exception 'restore did not return ai_admin audit read: %', v_result;
    end if;

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.role', '', true);

    raise exception 'least_privilege_selftest_ok';
  exception
    when others then
      if sqlerrm is distinct from 'least_privilege_selftest_ok' then
        raise;
      end if;
  end;
end
$test$;

notify pgrst, 'reload schema';
