-- Disposable GitHub Actions E2E database only. Never apply to an app database.
-- Seeds one foreign-tenant administrator so the First Decision Journey browser
-- witness can show a case in the demo tenant is refused to another tenant.
-- No Decision Case, evidence, approval, membership or invitation is seeded:
-- every journey record is created by real authenticated browser commands.
begin;
do $fixture$
begin
  if coalesce(current_setting('app.ci_first_decision_browser_fixture',true),'')<>'github_actions_only' then
    raise exception 'First Decision browser fixture requires the explicit isolated CI marker';
  end if;
  if not exists(select 1 from public.organizations
    where id='11111111-1111-1111-1111-111111111111'
      and name='Fort McMurray Oil Sands Demo') then
    raise exception 'First Decision browser fixture requires the disposable demo organization';
  end if;
end
$fixture$;

insert into public.organizations(id,name,industry)
values('99999999-9999-4999-8999-999999999975','First Decision foreign tenant','utilities')
on conflict(id) do nothing;

do $seed$
begin
  if not exists(select 1 from auth.users where id='99999999-9999-4999-8999-999999999976') then
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,
      raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change,email_change_token_new,
      email_change_token_current,phone_change,phone_change_token,reauthentication_token)
    values('00000000-0000-0000-0000-000000000000','99999999-9999-4999-8999-999999999976','authenticated','authenticated',
      'fdj-foreign@syncai.ca',extensions.crypt('Journey123!@#',extensions.gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}',jsonb_build_object('full_name','Foreign Tenant Administrator'),
      '','','','','','','','');
  end if;
end
$seed$;

insert into public.user_profiles(id,organization_id,email,full_name,role)
values('99999999-9999-4999-8999-999999999976','99999999-9999-4999-8999-999999999975',
  'fdj-foreign@syncai.ca','Foreign Tenant Administrator','admin')
on conflict(id) do update set organization_id=excluded.organization_id,email=excluded.email,
  full_name=excluded.full_name,role=excluded.role;
commit;
