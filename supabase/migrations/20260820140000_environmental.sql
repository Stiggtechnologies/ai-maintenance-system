-- ============================================================================
-- Environmental and sustainability performance (register E10.01–E10.11).
--
-- The connection this slice exists to make is between MAINTENANCE CONDITION
-- and ENVIRONMENTAL OUTCOME. A fouled heat exchanger is not only a reliability
-- problem: it burns more fuel for the same duty, every hour, silently, and
-- nobody raises a work order for a machine that is still running.
--
-- WHY THE FACTOR AND ITS SOURCE ARE BOTH REQUIRED. An emissions number
-- produced from a factor nobody can cite is unauditable, and it will be
-- reported anyway — which is exactly why the constraint is in the schema
-- rather than in a guideline. Same for scope: summing across scope 1, 2 and 3
-- without saying so produces a total that means nothing.
--
-- E10.11 IS THE ONE THAT CHANGES BEHAVIOUR. Environmental consequence already
-- exists as a dimension in the safety gatekeeper's twelve-dimension screening
-- and as a `consequence_class` on asset_service_levels. This slice does not
-- add a thirteenth place to record it; it adds the environmental exposure
-- itself so that the existing prioritisation has something real to weigh.
--
-- Canonical reuse: containment_losses from E2, disposal_records from U4,
-- condition_readings and operating_states, assets, work_orders,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists emission_factors (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  factor_key text not null,
  label text not null,
  activity_unit text not null,
  factor numeric not null check (factor > 0),
  factor_unit text not null,
  -- Required. A factor nobody can cite makes the whole report unauditable.
  source text not null,
  valid_from date not null default current_date,
  gwp numeric check (gwp > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_emf_key
  on emission_factors(organization_id, factor_key, valid_from);

create table if not exists environmental_activities (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  activity_kind text not null check (activity_kind in
    ('fuel_burn', 'electricity', 'flaring', 'venting', 'fugitive_methane',
     'water_withdrawal', 'water_discharge', 'waste_generated',
     'hazardous_waste', 'lubricant_loss', 'chemical_loss')),
  period_start date not null,
  period_end date not null,
  quantity numeric not null check (quantity >= 0),
  unit text not null,
  factor_key text,
  scope text check (scope in ('scope_1', 'scope_2', 'scope_3')),
  -- Whether maintenance condition is a contributor. Not blame: this is the
  -- portion the platform can actually change.
  maintenance_attributable boolean,
  note text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists idx_envact
  on environmental_activities(organization_id, activity_kind, period_end desc);

-- E10.01 / E10.10 — efficiency against a clean-condition baseline.
create table if not exists efficiency_baselines (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  metric text not null,
  unit text not null,
  -- The design or post-clean figure. Without it a reading is a measurement,
  -- not a performance.
  design_value numeric not null check (design_value > 0),
  basis text,
  established_on date not null default current_date,
  -- What restoring it costs, so a payback can be computed rather than guessed.
  intervention_cost numeric,
  energy_cost_per_day numeric,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_effbase
  on efficiency_baselines(organization_id, asset_id, metric);

create table if not exists efficiency_readings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  baseline_id bigint not null references efficiency_baselines(id) on delete cascade,
  measured_on date not null,
  value numeric not null check (value > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_effread
  on efficiency_readings(baseline_id, measured_on);

-- E10.08 — hazardous materials and batteries in service.
create table if not exists hazardous_inventory (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  substance text not null,
  category text not null check (category in
    ('battery', 'refrigerant', 'solvent', 'lubricant', 'reagent',
     'radioactive_source', 'asbestos', 'other')),
  quantity numeric,
  unit text,
  location text,
  disposal_route_required text,
  -- A hazardous item with no end-of-life route planned becomes somebody's
  -- problem at exactly the moment nobody has budget for it.
  end_of_life_planned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_hazinv on hazardous_inventory(organization_id, category);

alter table emission_factors enable row level security;
alter table environmental_activities enable row level security;
alter table efficiency_baselines enable row level security;
alter table efficiency_readings enable row level security;
alter table hazardous_inventory enable row level security;
drop policy if exists emf_read on emission_factors;
create policy emf_read on emission_factors
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists envact_read on environmental_activities;
create policy envact_read on environmental_activities
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists effbase_read on efficiency_baselines;
create policy effbase_read on efficiency_baselines
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists effread_read on efficiency_readings;
create policy effread_read on efficiency_readings
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists hazinv_read on hazardous_inventory;
create policy hazinv_read on hazardous_inventory
  for select to authenticated using (organization_id = app_current_org());

drop function if exists get_environmental_posture();
create or replace function get_environmental_posture()
returns table (
  activities_recorded bigint,
  activities_without_factor bigint,
  activities_without_scope bigint,
  factors_defined bigint,
  baselines_defined bigint,
  baselines_with_two_readings bigint,
  hazardous_items bigint,
  hazardous_without_eol_plan bigint,
  containment_losses bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (
    select count(*)::bigint n,
           count(*) filter (where factor_key is null)::bigint no_factor,
           count(*) filter (where scope is null)::bigint no_scope
    from environmental_activities where organization_id = (select id from org)
  ),
  f as (select count(*)::bigint n from emission_factors where organization_id = (select id from org)),
  b as (
    select count(*)::bigint n,
           count(*) filter (where (select count(*) from efficiency_readings r
                                   where r.baseline_id = eb.id) >= 2)::bigint two_plus
    from efficiency_baselines eb where eb.organization_id = (select id from org)
  ),
  h as (
    select count(*)::bigint n,
           count(*) filter (where not end_of_life_planned)::bigint no_eol
    from hazardous_inventory where organization_id = (select id from org)
  ),
  l as (select count(*)::bigint n from containment_losses where organization_id = (select id from org))
  select a.n, a.no_factor, a.no_scope, f.n, b.n, b.two_plus, h.n, h.no_eol, l.n,
    btrim(
    case
      when a.n = 0 and b.n = 0 then
        'No environmental activity or efficiency baseline is recorded. The platform can say an asset '
        || 'is degrading and cannot say what that degradation is costing in fuel, emissions or water — '
        || 'which is the part a fouled exchanger quietly charges every hour without raising a notification.'
      else
        a.n || ' activity record(s) and ' || b.n || ' efficiency baseline(s).'
        || case when a.no_factor > 0 then ' ' || a.no_factor
                || ' activity record(s) carry NO emission factor, so they are activity data and not '
                || 'emissions.' else '' end
        || case when a.no_scope > 0 then ' ' || a.no_scope
                || ' carry no scope; scope 1, 2 and 3 are not interchangeable and a total across them '
                || 'means nothing.' else '' end
        || case when b.n > b.two_plus then ' ' || (b.n - b.two_plus)
                || ' baseline(s) have fewer than two readings, so a degradation RATE cannot be fitted '
                || 'for them — only a current gap.' else '' end
    end
    || case when h.no_eol > 0 then ' ' || h.no_eol || ' of ' || h.n
            || ' hazardous item(s) have no end-of-life route planned; that becomes somebody''s problem '
            || 'at exactly the moment nobody has budget for it.' else '' end)
  from a, f, b, h, l;
$$;

grant execute on function get_environmental_posture() to authenticated;

create or replace function get_efficiency_baselines()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'assetName', ast.name, 'metric', eb.metric, 'unit', eb.unit,
    'designValue', eb.design_value, 'basis', eb.basis,
    'interventionCost', eb.intervention_cost,
    'energyCostPerDay', eb.energy_cost_per_day,
    'readings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'daysSinceBaseline', (r.measured_on - eb.established_on),
        'specificEnergy', r.value) order by r.measured_on)
      from efficiency_readings r where r.baseline_id = eb.id
    ), '[]'::jsonb)) order by ast.name, eb.metric), '[]'::jsonb)
  from efficiency_baselines eb
  join assets ast on ast.id = eb.asset_id
  where eb.organization_id = app_current_org();
$$;

grant execute on function get_efficiency_baselines() to authenticated;

create or replace function get_environmental_activities(p_limit int default 50)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- Ordered and limited in a subquery: jsonb_agg cannot take an outer ORDER BY.
  select coalesce(jsonb_agg(x.row), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'activityLabel', a.activity_kind || coalesce(' — ' || ast.name, ''),
      'activityQuantity', a.quantity, 'activityUnit', a.unit,
      'factor', f.factor, 'factorUnit', f.factor_unit, 'factorSource', f.source,
      'gwp', f.gwp, 'scope', a.scope,
      'maintenanceAttributable', a.maintenance_attributable) row
    from environmental_activities a
    left join assets ast on ast.id = a.asset_id
    left join lateral (
      select * from emission_factors ef
      where ef.organization_id = a.organization_id and ef.factor_key = a.factor_key
      order by ef.valid_from desc limit 1
    ) f on true
    where a.organization_id = app_current_org()
    order by a.period_end desc
    limit greatest(1, least(p_limit, 500))
  ) x;
$$;

grant execute on function get_environmental_activities(int) to authenticated;

notify pgrst, 'reload schema';
