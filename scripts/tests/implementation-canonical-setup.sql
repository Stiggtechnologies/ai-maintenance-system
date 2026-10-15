-- Disposable PostgreSQL integration substrate. No customer data or external calls.
-- Auth claim shim and later additive columns only; engineering services below
-- are applied verbatim from their canonical migrations, never replaced.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create schema private;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
\ir ../../supabase/migrations/00000000000001_operating_loop_baseline.sql
\ir ../../supabase/migrations/00000000000002_legacy_compat.sql
\ir ../../supabase/migrations/00000000000011_autonomous_onboarding.sql
\ir ../../supabase/migrations/00000000000012_onboarding_governance.sql
\ir ../../supabase/migrations/00000000000019_asset_twin_library.sql
\ir ../../supabase/migrations/20261227100000_azure_marketplace_fulfillment.sql
-- Later evidence/connector substrate is intentionally bounded, not a full-chain claim.
alter table evidence_items add column verification_status text, add column verified_by uuid,
 add column verified_at timestamptz, add column evidence_class text, add column risk_id uuid;
alter table connector_runs add column organization_id uuid, add column records_rejected int,
 add column records_accepted int;
create function can_read_risk(uuid) returns boolean language sql stable as $$ select false $$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant select on auth.users to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
\ir ../../supabase/migrations/20270103140000_native_implementation_journey.sql
