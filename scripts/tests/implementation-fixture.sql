-- Disposable loopback test contract. These are synthetic fixtures, never customer data.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table organizations(id uuid primary key);
create table user_profiles(id uuid primary key, organization_id uuid, role text, full_name text);
create function app_current_org() returns uuid language sql stable as $$ select organization_id from user_profiles where id=auth.uid() $$;
create function can_read_risk(uuid) returns boolean language sql stable as $$ select false $$;
create table billing_subscriptions(id uuid primary key, organization_id uuid, plan text, status text, billing_source text,
 marketplace_status text, marketplace_subscription_id text, current_period_end timestamptz);
create table marketplace_fulfillment_resolutions(id uuid primary key, billing_subscription_id uuid, organization_id uuid,
 marketplace_subscription_id text, internal_status text, marketplace_status text, activated_by uuid);
create table deployment_instances(id uuid primary key default gen_random_uuid(), organization_id uuid, created_by uuid,
 name text, use_case text, status text, created_at timestamptz default now());
create table audit_events(id uuid primary key default gen_random_uuid(), organization_id uuid, entity_type text,
 actor text, event_data jsonb, created_at timestamptz default now());
create table assets(id uuid primary key, organization_id uuid, area text, tag text, name text, asset_class text, site_id uuid);
create table evidence_items(id uuid primary key, organization_id uuid, asset_id uuid, evidence_type text,
 verification_status text, verified_by uuid, verified_at timestamptz, evidence_class text, description text, risk_id uuid);
create table asset_twin_templates(id uuid primary key, maturity text, asset_class text, version text, template jsonb);
create table asset_twin_instances(id uuid primary key default gen_random_uuid(), organization_id uuid, asset_id uuid,
 template_id uuid, overlay_id uuid, customer_overrides jsonb, compiled_version text, compiled_twin jsonb,
 status text default 'draft', created_at timestamptz default now(), unique(asset_id,compiled_version));
create table asset_onboarding_state(asset_id uuid primary key, organization_id uuid, status text,
 approved_by uuid, approved_at timestamptz);
create table onboarding_requirements(key text primary key, required_for_golive boolean);
create table asset_onboarding_items(id uuid primary key default gen_random_uuid(), organization_id uuid, asset_id uuid, requirement_key text, value jsonb, filled_at timestamptz, created_at timestamptz default now());
create table connector_runs(id uuid primary key, organization_id uuid, status text, records_rejected int,
 records_accepted int, finished_at timestamptz);
create function get_golive_readiness(p_asset_id uuid) returns jsonb language sql as $$
 select jsonb_build_object('ready',coalesce((select status='live' from asset_onboarding_state where asset_id=p_asset_id),false),'missing','[]'::jsonb) $$;
create function compile_asset_twin(uuid,uuid,uuid,jsonb) returns uuid language plpgsql as $$
declare v_id uuid;
begin
 insert into asset_twin_instances(organization_id,asset_id,template_id,overlay_id,customer_overrides,compiled_version,compiled_twin)
 select app_current_org(),$1,$2,$3,$4,version||'+customer',template from asset_twin_templates where id=$2 returning id into v_id;
 return v_id;
end $$;
create function run_asset_onboarding(uuid) returns jsonb language plpgsql as $$
begin
 if current_setting('test.fail_onboarding',true)='on' then raise exception 'injected failure'; end if;
 if current_setting('test.delay_onboarding',true)='on' then
  -- Disposable write-before-delay proves an outer request timeout rolls back
  -- nested preparation writes, rather than manufacturing a failure receipt.
  insert into asset_onboarding_items(organization_id,asset_id,requirement_key,value)
   values(app_current_org(),$1,'timeout_fixture','{"synthetic":true}');
  perform pg_sleep(1);
 end if;
 return jsonb_build_object('asset_id',$1);
end $$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
grant execute on all functions in schema public to authenticated,service_role;
