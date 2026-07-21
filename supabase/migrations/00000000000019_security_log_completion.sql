-- ============================================================================
-- Security log completion (audit round 3).
--
-- 1. Stream security_events over RLS-enforced realtime so the /security-log
--    viewer's LIVE badge is real (same pattern as migration 13).
-- 2. Seed a local admin account — every other role has a persona login
--    (migration 16) but no admin existed locally, so /security-log,
--    /deployments etc. were unreachable in local dev and untestable in E2E.
--    Demo-tier credentials by design, same exposure class as demo@syncai.ca.
--
-- GoTrue gotcha (migrations 4/16): token columns must be '' not NULL.
-- ============================================================================

-- 1. Realtime for the audit log ------------------------------------------------
alter table security_events replica identity full;
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table security_events';
  exception when duplicate_object then
    null; -- already in the publication
  end;
end
$$;

-- 2. Local admin persona --------------------------------------------------------
do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-000000000006';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid,
    'authenticated', 'authenticated', 'admin@syncai.ca',
    extensions.crypt('Admin123!@#', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Avery Cole — Platform Administrator'),
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', 'admin@syncai.ca'),
    'email', now(), now(), now()
  ) on conflict do nothing;

  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_uid, '11111111-1111-1111-1111-111111111111', 'admin@syncai.ca',
          'Avery Cole — Platform Administrator', 'admin')
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    role = excluded.role,
    full_name = excluded.full_name;

  insert into user_role_assignments (organization_id, user_id, role_id)
  values ('11111111-1111-1111-1111-111111111111', v_uid,
          '33333333-0000-0000-0000-000000000006')
  on conflict do nothing;
end
$$;
