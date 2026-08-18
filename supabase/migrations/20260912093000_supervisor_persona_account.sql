-- ============================================================================
-- Supervisor persona — one login for the organizational layer between the
-- maintenance manager and the crew, in the Fort McMurray demo org only.
--
--   supervisor@syncai.ca   Maint. Supervisor  (crew focus, notifications,
--                                              schedule read, returns)
--
-- navigation-lifecycle-ia.md §3 named the gap this role closes: "until a
-- `supervisor` role exists in code, `maintenance_manager` carries both the
-- department-head and the crew-assignment job." The owner has approved
-- creating the role. This migration seeds ONLY the demo persona account so
-- the runbook credentials row is true and the role tour can sign in as it —
-- the role's navigation lives in src/lib/roleNavigation.ts.
--
-- What the role deliberately does NOT get, anywhere in this migration or
-- elsewhere in this change:
--   * no approval authority — app_role_has_approval_authority (migration 22)
--     continues to exclude 'supervisor';
--   * no decision_rights rows beyond what the register already assigns
--     (which is none for this role key);
--   * no authority_limits row — inventing a placeholder spend ceiling is the
--     fiction the IA design exists to refuse (§5 Step 8).
--
-- Demo-tier credentials (same exposure class as demo@syncai.ca, which ships
-- in this public repo). Idempotent by EMAIL, not just id, following
-- 00000000000021: if a production supervisor account already exists under a
-- different uuid this seed is a no-op.
--
-- GoTrue gotcha (same as migrations 4/16/21): the token columns must be ''
-- not NULL or login 500s with "Database error querying schema".
-- ============================================================================

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-000000000007';
begin
  if not exists (select 1 from organizations
                 where id = '11111111-1111-1111-1111-111111111111') then
    return;
  end if;

  -- The demo org's role row for the new layer (reused by
  -- user_role_assignments below; same pattern as 00000000000004's roles seed).
  insert into roles (id, organization_id, key, name, description) values
    ('33333333-0000-0000-0000-000000000007',
     '11111111-1111-1111-1111-111111111111',
     'supervisor', 'Maintenance Supervisor',
     'Crew assignment + frontline execution')
  on conflict (id) do nothing;

  update roles set code = key, level = 1
  where id = '33333333-0000-0000-0000-000000000007' and code is null;

  if exists (select 1 from auth.users where email = 'supervisor@syncai.ca') then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid,
    'authenticated', 'authenticated', 'supervisor@syncai.ca',
    extensions.crypt('Super123!@#', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Dana Whitfield — Maintenance Supervisor'),
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', 'supervisor@syncai.ca'),
    'email', now(), now(), now()
  ) on conflict do nothing;

  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_uid, '11111111-1111-1111-1111-111111111111',
          'supervisor@syncai.ca', 'Dana Whitfield — Maintenance Supervisor',
          'supervisor')
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    role = excluded.role,
    full_name = excluded.full_name;

  insert into user_role_assignments (organization_id, user_id, role_id)
  values ('11111111-1111-1111-1111-111111111111', v_uid,
          '33333333-0000-0000-0000-000000000007')
  on conflict do nothing;
end
$$;
