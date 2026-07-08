-- ============================================================================
-- Persona accounts — one login per organizational access level, board room
-- down, in the Fort McMurray demo org:
--
--   executive@syncai.ca    Executive        (readiness, value, risk posture)
--   manager@syncai.ca      Maint. Manager   (work, approvals, schedule)
--   demo@syncai.ca         Reliability Eng. (already seeded in migration 4)
--   planner@syncai.ca      Planner          (work orders, materials, windows)
--   technician@syncai.ca   Technician       (execution, closeout, feedback)
--
-- Demo-tier credentials (same exposure class as demo@syncai.ca, which ships
-- in this public repo). The platform admin account is intentionally NOT
-- seeded here — it is provisioned per environment with a private password.
--
-- GoTrue gotcha (same as migration 4): the token columns must be '' not
-- NULL or login 500s with "Database error querying schema".
-- ============================================================================

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('00000000-0000-0000-0000-000000000002'::uuid, 'executive@syncai.ca',
       'Exec123!@#',    'Alexandra Board — VP Operations',  'executive',
       '33333333-0000-0000-0000-000000000001'::uuid),
      ('00000000-0000-0000-0000-000000000003'::uuid, 'manager@syncai.ca',
       'Manager123!@#', 'Marcus Reid — Maintenance Manager', 'maintenance_manager',
       '33333333-0000-0000-0000-000000000002'::uuid),
      ('00000000-0000-0000-0000-000000000004'::uuid, 'planner@syncai.ca',
       'Planner123!@#', 'Priya Sharma — Maintenance Planner', 'planner',
       '33333333-0000-0000-0000-000000000004'::uuid),
      ('00000000-0000-0000-0000-000000000005'::uuid, 'technician@syncai.ca',
       'Tech123!@#',    'Jordan Fields — Field Technician',  'technician',
       '33333333-0000-0000-0000-000000000005'::uuid)
    ) as t(uid, email, pw, full_name, app_role, role_id)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', p.uid,
      'authenticated', 'authenticated', p.email,
      extensions.crypt(p.pw, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', p.full_name),
      '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), p.uid, p.uid,
      jsonb_build_object('sub', p.uid::text, 'email', p.email),
      'email', now(), now(), now()
    ) on conflict do nothing;

    insert into user_profiles (id, organization_id, email, full_name, role)
    values (p.uid, '11111111-1111-1111-1111-111111111111', p.email, p.full_name, p.app_role)
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      role = excluded.role,
      full_name = excluded.full_name;

    insert into user_role_assignments (organization_id, user_id, role_id)
    values ('11111111-1111-1111-1111-111111111111', p.uid, p.role_id)
    on conflict do nothing;
  end loop;
end
$$;
