-- Isolated PostgreSQL contract fixture, NOT a Supabase/GoTrue or production witness.
-- Run only in a newly initialized disposable database, before the actual migration.
do $$ begin
  if to_regclass('public.connectors') is not null or to_regclass('auth.users') is not null then
    raise exception 'test bootstrap requires an empty disposable database, never an application database';
  end if;
end $$;
create schema if not exists auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.role() returns text language sql stable as
  $$select current_setting('test.jwt_role',true)$$;
create function public.app_current_org() returns uuid language sql stable as
  $$select nullif(current_setting('test.org',true),'')::uuid$$;
create function public.app_current_role() returns text language sql stable as
  $$select current_setting('test.profile_role',true)$$;
create table public.organizations(id uuid primary key);
create table public.user_profiles(id uuid primary key, organization_id uuid references organizations, role text);
create table public.connectors(
  id uuid primary key default gen_random_uuid(), organization_id uuid references organizations,
  connector_key text, name text, enabled boolean not null default true,
  unique(organization_id,connector_key)
);
create table public.audit_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid, entity_type text, actor text, event_data jsonb,
  previous_state jsonb, new_state jsonb, created_at timestamptz not null default now()
);
grant usage on schema public,auth to authenticated,service_role;
insert into organizations values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into user_profiles values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','admin'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','admin');
insert into connectors(id,organization_id,connector_key,name) values
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','local','Local clock'),
  ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','foreign','Foreign clock'),
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','legacy-malformed','Malformed legacy clock');
-- Deliberately untrusted PRE-GUARD legacy data; no trigger is disabled to create it.
insert into audit_events(organization_id,entity_type,actor,event_data,new_state)
values('11111111-1111-4111-8111-111111111111','connector_time_assurance_configuration','legacy',
  '{"connector_id":"66666666-6666-4666-8666-666666666666"}','{"revision":"not-an-integer"}');
