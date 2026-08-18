-- ============================================================================
-- Close the tenant hop through user_profiles: self-service writes to role
-- and organization_id.
--
-- THE DEFECT. user_profiles_self_update (00000000000001:506-508) reads
-- "for update to authenticated using (id = auth.uid()) with check
-- (id = auth.uid())" — no column restriction, because RLS cannot express one.
-- RLS decides WHICH rows a caller may update, never which COLUMNS, so any
-- authenticated user can PATCH their own row through PostgREST and write
-- role = 'admin' or organization_id = <any tenant's uuid>. The app writes
-- this table from the browser today (OnboardingWizard.tsx:119), so the path
-- is open, not theoretical.
--
-- WHY IT IS TOTAL. app_current_org() (00000000000001:462) reads
-- organization_id from exactly this row, and every org-scoped policy in the
-- schema hangs off app_current_org(). One PATCH is therefore a complete
-- tenant hop: every org_rw policy, every "admins of my org" check, every
-- security-definer helper follows the forged row. And it was silent twice
-- over: the audit trigger (00000000000018:104) fired only on "update of
-- role", so an organization_id rewrite logged nothing at all — while a role
-- hop DID log, into security_events, whose admin-read policy gates on the
-- very role column the attacker just granted themselves. The attacker became
-- the only person cleared to read the alarm they tripped.
--
-- THE MECHANISM. A BEFORE UPDATE trigger that, for end-user sessions, pins
-- NEW.role and NEW.organization_id back to their OLD values. Pinned rather
-- than raised, because the app legitimately upserts this row for benign
-- columns (onboarding flags, display name) and a client that round-trips the
-- whole row would start failing on columns it never meant to change. The
-- attempt is not silent, though: a pinned change that actually differed is
-- recorded in security_events as access_denied before it is neutralised,
-- attributed to the caller's COMMITTED organisation (old.organization_id) —
-- never to the row in flight, so a tenant-hop attempt cannot re-home its own
-- alarm into the org it was trying to enter.
--
-- WHO IS EXEMPT. Callers with no auth.uid(): the service role, the migration
-- runner, and seeds. That is this schema's established service test —
-- migrations 11/12/15 gate their cross-org refusals on "auth.uid() is not
-- null", and 20260825143000 documents the service role as the caller "where
-- there is no auth.uid()". Role and organisation assignment stays a
-- service-side act (persona seeds, provisioning, edge functions on
-- SUPABASE_SERVICE_ROLE_KEY). A search of src/ and supabase/functions/ found
-- NO authenticated flow that updates any user's role or organisation — every
-- edge function that touches user_profiles runs on the service key — so
-- there is no legitimate exception to admit, and none is admitted.
--
-- Canonical reuse: security_events and its recorder shape from
-- 00000000000018; app_current_org() untouched. No policy is weakened,
-- replaced, or removed — the row-level policies stay exactly as they are and
-- the trigger narrows columns beneath them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The pin.
-- ---------------------------------------------------------------------------
create or replace function public.pin_user_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service callers (no auth.uid(): service role, migration runner, seeds)
  -- remain the only writers of role and organisation.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.organization_id is distinct from old.organization_id then
    -- Record the attempt before neutralising it. Attribution goes to the
    -- caller's committed organisation, so the alarm lands in front of the
    -- admins of the org the caller is actually in — not the org they were
    -- trying to write themselves into.
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (old.organization_id, auth.uid(),
       (select coalesce(p.full_name, u.email) from auth.users u
          left join user_profiles p on p.id = u.id where u.id = auth.uid()),
       'access_denied', 'critical',
       'Blocked client-side update of privileged user_profiles columns for '
         || coalesce(old.email, old.id::text)
         || case when new.role is distinct from old.role
              then ' — role ' || coalesce(old.role, 'none')
                || ' to ' || coalesce(new.role, 'none')
              else '' end
         || case when new.organization_id is distinct from old.organization_id
              then ' — organization ' || coalesce(old.organization_id::text, 'none')
                || ' to ' || coalesce(new.organization_id::text, 'none')
              else '' end);
  end if;

  -- The pin itself. Every other column on the row stays writable exactly as
  -- the self-update policy allows.
  new.role := old.role;
  new.organization_id := old.organization_id;
  return new;
end
$$;

drop trigger if exists trg_user_profiles_privilege_pin on user_profiles;
create trigger trg_user_profiles_privilege_pin
  before update on user_profiles
  for each row execute function public.pin_user_profile_privileges();

-- ---------------------------------------------------------------------------
-- Widen the audit. It fired only on "update of role", so an organisation
-- rewrite — the more valuable half of the attack — left no record. It now
-- covers both privileged columns and logs each changed dimension on its own
-- line. org_changed extends the event vocabulary of 00000000000018: a tenant
-- move is a security event in its own right, whoever performs it, including
-- the service paths that remain allowed to perform it.
-- ---------------------------------------------------------------------------
create or replace function public.on_role_change_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text := (select coalesce(p.full_name, u.email)
                           from auth.users u
                           left join user_profiles p on p.id = u.id
                          where u.id = auth.uid());
  v_subject text := coalesce(new.email, new.id::text);
begin
  if new.role is distinct from old.role then
    insert into security_events (organization_id, actor_id, actor_label,
      event_type, severity, detail)
    values (new.organization_id, auth.uid(), v_actor_label, 'role_changed',
      case when new.role in ('admin','ai_admin') then 'warning' else 'notice' end,
      'Role for ' || v_subject || ' changed from '
        || coalesce(old.role, 'none') || ' to ' || coalesce(new.role, 'none'));
  end if;

  if new.organization_id is distinct from old.organization_id then
    insert into security_events (organization_id, actor_id, actor_label,
      event_type, severity, detail)
    values (new.organization_id, auth.uid(), v_actor_label, 'org_changed',
      'warning',
      'Organization for ' || v_subject || ' changed from '
        || coalesce(old.organization_id::text, 'none') || ' to '
        || coalesce(new.organization_id::text, 'none'));
  end if;

  return new;
end
$$;

drop trigger if exists trg_role_change_audit on user_profiles;
create trigger trg_role_change_audit
  after update of role, organization_id on user_profiles
  for each row execute function public.on_role_change_audit();

-- ---------------------------------------------------------------------------
-- Self-test. Runs wherever the migration runs — the fresh CI chain and the
-- prod replica — against throwaway fixture rows, and aborts the deploy if
-- the pin or the audit fails. The session simulation is the same idiom
-- approval-enforcement.yml uses: auth.uid() reads the request.jwt claims,
-- and settings are transaction-local so nothing leaks past the migration.
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid := gen_random_uuid();
  v_org_a uuid;
  v_org_b uuid;
  v_role text;
  v_org uuid;
begin
  insert into organizations (name)
  values ('__privilege_pin_selftest_a_' || v_user) returning id into v_org_a;
  insert into organizations (name)
  values ('__privilege_pin_selftest_b_' || v_user) returning id into v_org_b;
  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_user, v_org_a, 'privilege-pin-selftest@invalid.syncai.ca',
          'Privilege-pin self-test', 'technician');

  -- An end-user session attempting the exact attack: self-grant admin and
  -- hop organisations in one statement.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  update user_profiles
     set role = 'admin', organization_id = v_org_b
   where id = v_user;

  select up.role, up.organization_id into v_role, v_org
    from user_profiles up where up.id = v_user;
  if v_role is distinct from 'technician' or v_org is distinct from v_org_a then
    raise exception 'user_profiles privilege pin FAILED: an authenticated '
      'self-update reached role=% organization=%', v_role, v_org;
  end if;

  if not exists (
    select 1 from security_events
    where actor_id = v_user
      and event_type = 'access_denied'
      and organization_id = v_org_a
  ) then
    raise exception 'privilege pin blocked the change but recorded no '
      'access_denied event — the attempt would be invisible';
  end if;

  -- Back on the service path (no auth.uid()): assignment must still work,
  -- and the widened audit must now see BOTH columns change.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  update user_profiles
     set role = 'planner', organization_id = v_org_b
   where id = v_user;

  select up.role, up.organization_id into v_role, v_org
    from user_profiles up where up.id = v_user;
  if v_role is distinct from 'planner' or v_org is distinct from v_org_b then
    raise exception 'privilege pin wrongly blocked a service-path update '
      '(role=%, organization=%)', v_role, v_org;
  end if;

  if not exists (
    select 1 from security_events
    where event_type = 'role_changed' and organization_id = v_org_b
  ) then
    raise exception 'service-path role change was not audited';
  end if;
  if not exists (
    select 1 from security_events
    where event_type = 'org_changed' and organization_id = v_org_b
  ) then
    raise exception 'organization change was not audited — the widened '
      'trigger did not fire';
  end if;

  -- Fixture teardown.
  delete from security_events where organization_id in (v_org_a, v_org_b);
  delete from user_profiles where id = v_user;
  delete from organizations where id in (v_org_a, v_org_b);
end $$;

notify pgrst, 'reload schema';
