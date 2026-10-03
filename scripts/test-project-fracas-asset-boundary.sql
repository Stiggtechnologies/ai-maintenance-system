\set ON_ERROR_STOP on
-- Disposable dependency fixture, NOT a production schema or RLS qualification.
begin;
create table organizations(id uuid primary key);
insert into organizations values ('00000000-0000-0000-0000-000000000001');
create function app_current_org() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create table ca_verifications (
 id uuid primary key, organization_id uuid, work_order_id uuid, asset_id uuid,
 failure_mode text, status text, effectiveness text,
 observation_start timestamptz, observation_days int,
 effectiveness_evaluated_at timestamptz, recurrence_wo_id uuid
);
create table work_orders (
 id uuid, asset_id uuid, work_type text, actual_failure_mode text,
 completed_at timestamptz
);
create table kpi_values (
 organization_id uuid, kpi_key text, value numeric, status text,
 confidence text, computed_from jsonb
);
\ir ../supabase/migrations/20261225180000_project_fracas_asset_boundary.sql

-- Asset observation can conclude; an otherwise identical project-shaped row
-- has no asset/work-order subject and must not be interpreted as recurrence-free.
insert into ca_verifications values
 ('00000000-0000-0000-0000-000000000010',app_current_org(),
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000030','seal','observing','observing',
  now()-interval '100 days',90,null,null),
 ('00000000-0000-0000-0000-000000000011',app_current_org(),
  null,null,'project_delivery.bad_estimate','observing','observing',
  now()-interval '100 days',90,null,null);

do $$
declare result jsonb;
begin
 result := evaluate_ca_effectiveness();
 if result->>'evaluated' <> '1' then
   raise exception 'Expected exactly one asset evaluation: %', result;
 end if;
 if exists(select 1 from ca_verifications where work_order_id is null
           and (status <> 'observing' or effectiveness_evaluated_at is not null)) then
   raise exception 'Project record was evaluated as an asset';
 end if;
 -- Even malformed historical project conclusions must not enter the asset KPI.
 update ca_verifications set effectiveness='ineffective',
   effectiveness_evaluated_at=now() where work_order_id is null;
 result := get_ca_effectiveness_rate();
 if result->>'concluded' <> '1' or result->>'ineffective' <> '0'
    or (result->>'effectivenessRatePct')::numeric <> 100 then
   raise exception 'Project conclusion polluted asset rate: %',result;
 end if;
 perform snapshot_ca_effectiveness_kpi();
 if (select count(*) from kpi_values where value=100
     and computed_from->>'concluded'='1') <> 1 then
   raise exception 'Scheduled snapshot did not preserve asset denominator';
 end if;
 update ca_verifications set effectiveness='observing',
   effectiveness_evaluated_at=null where work_order_id is null;
 result := get_ca_effectiveness_rate();
 if result->>'observingExcluded' <> '0' then
   raise exception 'Project observation polluted asset observing count';
 end if;
end $$;
rollback;
