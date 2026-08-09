-- ============================================================================
-- Universal asset ontology (capability register U3.03–U3.07, U3.09–U3.16).
--
-- The assets table in this platform has the shape of a machine: a tag, a make,
-- a model, a serial number, an installed date. That shape is correct for a
-- pump and a haul truck, and it is WRONG for most of what an asset-intensive
-- organisation actually owns.
--
-- THE PROBLEM IS NOT A MISSING TYPE LIST. IT IS THE MATHS.
--
-- Adding "pipeline" to a dropdown changes nothing. What changes something is
-- noticing that the analyses this platform already runs are not valid for
-- every kind of asset:
--
--   * A 40 km pipeline is not one machine. Its failure rate belongs per
--     kilometre-year; reporting one MTBF for the whole line hides where the
--     failures are and makes two pipelines of different lengths look
--     comparable when they are not.
--   * A firmware-defined asset does not wear out. Fitting a Weibull to it and
--     recommending age replacement is not conservative, it is nonsense: the
--     hazard is version, configuration and vulnerability, not running hours.
--   * A distributed network of 40,000 pole-top devices is a POPULATION. Some
--     of its members have no individual identity, and per-asset reliability is
--     a category error where the meaningful figure is per unit-year.
--   * A bridge is not repaired to as-new on a work order. Its condition is an
--     inspection rating on a scale, and a health score derived from work
--     history says nothing about it.
--
-- So this migration adds a MEASUREMENT BASIS to the ontology and, with it, a
-- record of which analyses apply to which kind of asset and which do not, with
-- the reason. That record is readable by the analysis surfaces, so the
-- platform can decline to compute something rather than compute it wrongly.
--
-- WHAT IS NOT CLAIMED. Declaring a class does not populate it. Every profile
-- below arrives with zero assets against it, and the coverage function reports
-- the classes actually in use rather than presenting the catalogue as
-- capability. A tenant that owns only rotating equipment should see that.
--
-- Canonical reuse: assets, sites, organizations, app_current_org(). The assets
-- table is NOT reshaped — profiles attach to it, and the linear and population
-- extensions hang off it, so nothing that already reads assets changes.
-- Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Measurement basis and class profiles
-- ---------------------------------------------------------------------------
create table if not exists asset_class_profiles (
  class_key text primary key,
  label text not null,
  register_ref text not null,
  -- How the thing is measured at all. This is the field that decides which
  -- arithmetic is even meaningful.
  measurement_basis text not null check (measurement_basis in (
    'point',      -- one discrete machine: pump, truck, compressor
    'linear',     -- measured along a route: pipeline, road, rail, transmission
    'population', -- many near-identical units: pole-top devices, meters
    'structure',  -- civil and buildings: condition-rated, inspection-driven
    'logical',    -- software, firmware, IT/OT: no physical wear
    'natural'     -- reservoirs, waterways: state and capacity, not repair
  )),
  -- What identifies one of these, when a tag and a serial number do not.
  identity_basis text not null,
  -- How its condition is actually established.
  condition_basis text not null,
  -- What "failure" means here. Rarely "it stopped".
  failure_meaning text not null,
  -- The denominator a rate must be expressed over for the number to mean
  -- anything. NULL for point assets, where per-asset-year is the default.
  exposure_unit text,
  notes text
);

insert into asset_class_profiles
  (class_key, label, register_ref, measurement_basis, identity_basis,
   condition_basis, failure_meaning, exposure_unit, notes)
values
  ('fixed_equipment', 'Fixed equipment', 'U3.01', 'point',
   'Tag and serial number', 'Condition monitoring and work history',
   'Loss of the function the asset performs', null, null),
  ('mobile_fleet', 'Mobile fleet', 'U3.02', 'point',
   'Unit number and serial number', 'Event history, utilisation and inspections',
   'Loss of availability for its duty', null, null),
  ('linear', 'Linear assets (pipeline, road, rail, transmission)', 'U3.03', 'linear',
   'Route identifier plus a from/to measure along it',
   'In-line inspection, survey and defect location',
   'A defect or loss of containment AT A LOCATION, not of the whole route',
   'km-year',
   'One MTBF for a whole route is meaningless: it hides where the failures are and makes routes of different lengths look comparable.'),
  ('distributed_network', 'Distributed network', 'U3.04', 'population',
   'Population membership; individual identity may not be tracked at all',
   'Sampled inspection and aggregate performance',
   'A unit failing, expressed as a rate across the population',
   'unit-year',
   'Per-asset reliability is a category error where members are not individually identified.'),
  ('civil_structural', 'Civil and structural', 'U3.05', 'structure',
   'Structure identifier and element breakdown',
   'Inspection condition rating on a defined scale',
   'Loss of structural capacity or of a serviceability limit', null,
   'Not repaired to as-new on a work order; a health score from work history says nothing about it.'),
  ('building', 'Buildings and facilities', 'U3.06', 'structure',
   'Building and space identifier, with systems beneath it',
   'Condition survey plus the systems within it',
   'Loss of occupant safety, comfort or code compliance', null, null),
  ('electrical_infrastructure', 'Electrical infrastructure', 'U3.07', 'point',
   'Circuit and equipment identifier, with voltage class',
   'Diagnostics, protection testing and loading history',
   'Loss of supply, or failure of protection to operate correctly', null,
   'Protection that fails to operate is a failure with no outage attached to it, and is invisible to availability metrics.'),
  ('instrumentation', 'Instrumentation and controls', 'U3.08', 'point',
   'Loop and tag identifier', 'Calibration record and proof testing',
   'Failure to measure, or to act, within tolerance', null, null),
  ('software_defined', 'Software-defined assets', 'U3.09', 'logical',
   'Product, version and licence instance',
   'Version currency, configuration state and known vulnerabilities',
   'Defect, incompatibility, licence lapse or vulnerability exposure', null,
   'Does not wear out. Age-based replacement is not conservative here, it is meaningless: the hazard is version and configuration, not running hours.'),
  ('it_ot_infrastructure', 'IT and OT infrastructure', 'U3.10', 'logical',
   'Hostname, network zone and firmware or OS version',
   'Patch state, configuration baseline and network position',
   'Loss of service, or loss of the security posture protecting it', null,
   'Failure modes are cyber-physical; a mechanical taxonomy does not describe them.'),
  ('medical_laboratory', 'Medical and laboratory equipment', 'U3.11', 'point',
   'Device identifier and regulatory registration',
   'Calibration, preventive inspection and regulatory status',
   'Out-of-tolerance measurement or unavailability for a clinical need', null,
   'Regulatory status can make an asset unusable while it is in perfect working order.'),
  ('renewable_generation', 'Renewable-energy assets', 'U3.12', 'point',
   'Unit identifier within a site or array',
   'Performance against the available resource, not against nameplate',
   'Output below what the available resource should have produced', null,
   'Low output is not a failure when the wind is not blowing; the resource has to be in the denominator.'),
  ('temporary', 'Temporary assets', 'U3.13', 'point',
   'Unit identifier plus the period it is on site',
   'Condition at mobilisation and demobilisation',
   'Loss of function during the hire period', null,
   'Has an end date by definition, and the register must not keep it forever.'),
  ('leased', 'Leased assets', 'U3.14', 'point',
   'Unit identifier plus lease and lessor',
   'As for its physical class, bounded by lease terms',
   'Loss of function, and separately breach of a lease condition', null,
   'The maintenance strategy is constrained by someone else''s contract.'),
  ('contractor_owned', 'Contractor-owned assets', 'U3.15', 'point',
   'Unit identifier plus the owning contractor',
   'Whatever the contract entitles the site to see',
   'Loss of the service the contractor is engaged to provide', null,
   'The site carries the consequence of failure and usually not the maintenance history.'),
  ('natural', 'Natural assets (reservoirs, dams, waterways)', 'U3.16', 'natural',
   'Feature identifier and extent',
   'Level, capacity, water quality and structural survey',
   'Loss of capacity, of containment, or of ecological or regulatory state', null,
   'Cannot be replaced, and "run to failure" is not an available strategy.')
on conflict (class_key) do update set
  label = excluded.label,
  register_ref = excluded.register_ref,
  measurement_basis = excluded.measurement_basis,
  identity_basis = excluded.identity_basis,
  condition_basis = excluded.condition_basis,
  failure_meaning = excluded.failure_meaning,
  exposure_unit = excluded.exposure_unit,
  notes = excluded.notes;

alter table asset_class_profiles enable row level security;
drop policy if exists acp_read on asset_class_profiles;
create policy acp_read on asset_class_profiles
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Which analyses apply to which basis, and WHY NOT where they do not.
--
-- This is the part that stops the platform computing something wrongly. It is
-- keyed on measurement basis rather than on class, because the reason a
-- Weibull does not apply to firmware is the same reason it does not apply to
-- an IT host, and duplicating it per class invites the two to drift apart.
-- ---------------------------------------------------------------------------
create table if not exists analysis_applicability (
  measurement_basis text not null,
  analysis_key text not null,
  applicable boolean not null,
  reason text not null,
  primary key (measurement_basis, analysis_key)
);

insert into analysis_applicability (measurement_basis, analysis_key, applicable, reason) values
  -- Weibull / age replacement
  ('point', 'weibull_age_replacement', true,
   'Age-driven wear-out is a credible mechanism and running hours are the natural clock.'),
  ('linear', 'weibull_age_replacement', false,
   'A route does not fail as a unit. Fit distributions to defects per kilometre, not to the age of the whole line.'),
  ('population', 'weibull_age_replacement', false,
   'Members are not individually tracked, so there is no per-item age to fit against. Use population failure rate per unit-year.'),
  ('structure', 'weibull_age_replacement', false,
   'Deterioration is assessed by inspection rating, not by time to a discrete failure event. Use a deterioration model against the rating scale.'),
  ('logical', 'weibull_age_replacement', false,
   'Software does not wear out. Replacing it on an age schedule is not conservative, it is meaningless — the hazard is version, configuration and vulnerability.'),
  ('natural', 'weibull_age_replacement', false,
   'A natural asset is not replaced, so there is no replacement interval to optimise.'),
  -- MTBF / repairable-systems metrics
  ('point', 'mtbf', true, 'A discrete repairable item with identifiable failures.'),
  ('linear', 'mtbf', false,
   'Express as defects or failures per kilometre-year. One MTBF for a whole route hides where the failures are and makes routes of different lengths look comparable.'),
  ('population', 'mtbf', false,
   'Express as failures per unit-year across the population.'),
  ('structure', 'mtbf', false,
   'Structures do not produce a failure series to average between.'),
  ('logical', 'mtbf', true,
   'Valid for service interruptions, but the mechanism is not wear, so the trend carries no wear-out information.'),
  ('natural', 'mtbf', false, 'No repair cycle to measure between.'),
  -- Condition monitoring with P-F intervals
  ('point', 'pf_interval', true, 'A detectable degrading condition with a measurable P-F interval.'),
  ('linear', 'pf_interval', true,
   'Valid where in-line inspection or survey detects a growing defect, with the interval set by growth rate.'),
  ('population', 'pf_interval', false,
   'Applied to a sample rather than to each unit; the interval governs the survey, not the item.'),
  ('structure', 'pf_interval', true,
   'Inspection intervals are the standard control, driven by deterioration rate between ratings.'),
  ('logical', 'pf_interval', false,
   'There is no physical potential-failure condition to detect. The equivalent control is patch and vulnerability management.'),
  ('natural', 'pf_interval', true, 'Survey and monitoring against defined state thresholds.'),
  -- Spares holding
  ('point', 'spares_holding', true, 'Discrete replaceable components with a demand rate.'),
  ('linear', 'spares_holding', true, 'For repair materials, sized on defect rate per kilometre rather than per asset.'),
  ('population', 'spares_holding', true, 'Sized on population demand, which is usually the best-conditioned case there is.'),
  ('structure', 'spares_holding', false, 'Structural repair is engineered per event, not held in stock.'),
  ('logical', 'spares_holding', false, 'No physical spare exists. The equivalent is a supported version and a rollback path.'),
  ('natural', 'spares_holding', false, 'Not applicable.'),
  -- Age / replacement economics
  ('point', 'lifecycle_economics', true, 'Repair-versus-replace has a defined comparison.'),
  ('linear', 'lifecycle_economics', true, 'Applied per segment, not to the whole route.'),
  ('population', 'lifecycle_economics', true, 'Applied to the population as a renewal programme.'),
  ('structure', 'lifecycle_economics', true, 'Applied as intervention timing against a deterioration curve.'),
  ('logical', 'lifecycle_economics', true, 'Applied to support lifetime and obsolescence, not to physical condition.'),
  ('natural', 'lifecycle_economics', false, 'There is no replacement option to price.')
on conflict (measurement_basis, analysis_key) do update set
  applicable = excluded.applicable, reason = excluded.reason;

alter table analysis_applicability enable row level security;
drop policy if exists aa_read on analysis_applicability;
create policy aa_read on analysis_applicability
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Attach a profile to an asset. Nothing is guessed from asset_class text.
-- ---------------------------------------------------------------------------
create table if not exists asset_class_assignments (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  class_key text not null references asset_class_profiles(class_key),
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  basis text
);

create index if not exists idx_aca_org
  on asset_class_assignments(organization_id, class_key);

alter table asset_class_assignments enable row level security;
drop policy if exists aca_read on asset_class_assignments;
create policy aca_read on asset_class_assignments
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U3.03 / U3.04 — linear referencing. A point asset cannot express this.
-- ---------------------------------------------------------------------------
create table if not exists linear_asset_routes (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  route_code text not null,
  measure_unit text not null default 'km' check (measure_unit in ('km', 'm', 'mi', 'ft', 'chain')),
  start_measure numeric not null default 0,
  end_measure numeric not null,
  description text,
  created_at timestamptz not null default now(),
  check (end_measure > start_measure)
);

create unique index if not exists idx_lar_code
  on linear_asset_routes(organization_id, route_code);

create table if not exists linear_segments (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  route_id bigint not null references linear_asset_routes(id) on delete cascade,
  from_measure numeric not null,
  to_measure numeric not null,
  -- What makes this stretch different from its neighbours: material, diameter,
  -- coating, soil, traffic loading, span type.
  attributes jsonb not null default '{}',
  condition_rating numeric,
  created_at timestamptz not null default now(),
  check (to_measure > from_measure)
);

create index if not exists idx_lseg_route on linear_segments(route_id, from_measure);

create table if not exists linear_defects (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  route_id bigint not null references linear_asset_routes(id) on delete cascade,
  at_measure numeric not null,
  detected_at timestamptz not null default now(),
  defect_type text not null,
  severity text check (severity in ('minor', 'moderate', 'major', 'critical')),
  -- Growth is what turns a defect into an interval. Without it there is a
  -- location and no schedule.
  size_value numeric,
  size_unit text,
  detection_method text,
  repaired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ldef_route
  on linear_defects(organization_id, route_id, at_measure);

alter table linear_asset_routes enable row level security;
alter table linear_segments enable row level security;
alter table linear_defects enable row level security;
drop policy if exists lar_read on linear_asset_routes;
create policy lar_read on linear_asset_routes
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists lseg_read on linear_segments;
create policy lseg_read on linear_segments
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists ldef_read on linear_defects;
create policy ldef_read on linear_defects
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U3.04 — populations, where individual identity may not exist
-- ---------------------------------------------------------------------------
create table if not exists asset_populations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  population_code text not null,
  description text not null,
  unit_count int not null check (unit_count > 0),
  -- Whether members are individually identified. If they are not, per-asset
  -- anything is a category error and the platform should say so.
  members_individually_tracked boolean not null default false,
  install_period_start date,
  install_period_end date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_pop_code
  on asset_populations(organization_id, population_code);

create table if not exists population_failure_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  population_id bigint not null references asset_populations(id) on delete cascade,
  occurred_at timestamptz not null,
  failure_count int not null default 1 check (failure_count > 0),
  failure_mode text,
  note text
);

create index if not exists idx_popfail
  on population_failure_events(organization_id, population_id, occurred_at desc);

alter table asset_populations enable row level security;
alter table population_failure_events enable row level security;
drop policy if exists pop_read on asset_populations;
create policy pop_read on asset_populations
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists popfail_read on population_failure_events;
create policy popfail_read on population_failure_events
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U3.13–U3.15 — tenure. Who owns it, and what that does to the strategy.
-- ---------------------------------------------------------------------------
create table if not exists asset_tenure (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  tenure text not null check (tenure in
    ('owned', 'leased', 'rented_temporary', 'contractor_owned',
     'oem_maintained', 'customer_owned', 'shared', 'concession')),
  counterparty text,
  agreement_reference text,
  starts_on date,
  ends_on date,
  -- The part that changes maintenance: what the site is and is not allowed to
  -- do, and what it can actually see.
  maintenance_responsibility text check (maintenance_responsibility in
    ('site', 'counterparty', 'shared')),
  history_visible_to_site boolean not null default true,
  strategy_constraint text,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  -- A temporary asset with no end date is not temporary, the same way a
  -- temporary modification with no removal date is not temporary.
  check (tenure <> 'rented_temporary' or ends_on is not null)
);

create index if not exists idx_tenure_org on asset_tenure(organization_id, tenure);

alter table asset_tenure enable row level security;
drop policy if exists tenure_read on asset_tenure;
create policy tenure_read on asset_tenure
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_ontology_coverage();
create or replace function get_ontology_coverage()
returns table (
  assets_total bigint,
  assets_classified bigint,
  classes_in_use bigint,
  classes_available bigint,
  bases_in_use text[],
  linear_routes bigint,
  populations bigint,
  untracked_population_units bigint,
  assets_with_tenure bigint,
  non_owned_assets bigint,
  expiring_tenure_90d bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (select count(*)::bigint n from assets where organization_id = (select id from org)),
  cl as (
    select count(*)::bigint n, count(distinct class_key)::bigint k
    from asset_class_assignments where organization_id = (select id from org)
  ),
  bs as (
    select coalesce(array_agg(distinct p.measurement_basis order by p.measurement_basis), '{}') b
    from asset_class_assignments c
    join asset_class_profiles p on p.class_key = c.class_key
    where c.organization_id = (select id from org)
  ),
  lr as (select count(*)::bigint n from linear_asset_routes where organization_id = (select id from org)),
  po as (
    select count(*)::bigint n,
           coalesce(sum(unit_count) filter (where not members_individually_tracked), 0)::bigint untracked
    from asset_populations where organization_id = (select id from org)
  ),
  te as (
    select count(*)::bigint n,
           count(*) filter (where tenure <> 'owned')::bigint non_owned,
           count(*) filter (where ends_on is not null
                              and ends_on between current_date and current_date + 90)::bigint expiring
    from asset_tenure where organization_id = (select id from org)
  )
  select a.n, cl.n, cl.k,
         (select count(*)::bigint from asset_class_profiles),
         bs.b, lr.n, po.n, po.untracked, te.n, te.non_owned, te.expiring,
         case
           when cl.n = 0 then
             'No asset carries a class profile. Sixteen are defined, which is a catalogue and not a '
             || 'capability — the platform still treats every asset as a discrete machine, and that is '
             || 'wrong for anything measured along a route, held as a population, rated by inspection, '
             || 'or defined in software.'
           when cl.n < a.n then
             cl.n || ' of ' || a.n || ' assets carry a class profile across ' || cl.k
             || ' class(es). The remaining ' || (a.n - cl.n) || ' are analysed as discrete machines by '
             || 'default, which is right for rotating equipment and wrong for everything else.'
           else
             'All ' || a.n || ' assets carry a class profile across ' || cl.k || ' class(es).'
         end
         || case when po.untracked > 0 then ' ' || po.untracked
                 || ' population unit(s) are not individually identified, so per-asset reliability '
                 || 'does not exist for them; the meaningful figure is per unit-year.' else '' end
         || case when te.expiring > 0 then ' ' || te.expiring
                 || ' asset(s) have a tenure agreement ending within 90 days.' else '' end
  from a, cl, bs, lr, po, te;
$$;

grant execute on function get_ontology_coverage() to authenticated;

-- Every profile with its applicability matrix, for the analysis surfaces.
create or replace function get_class_profiles()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'classKey', p.class_key,
    'label', p.label,
    'registerRef', p.register_ref,
    'measurementBasis', p.measurement_basis,
    'identityBasis', p.identity_basis,
    'conditionBasis', p.condition_basis,
    'failureMeaning', p.failure_meaning,
    'exposureUnit', p.exposure_unit,
    'notes', p.notes,
    'assetCount', coalesce((select count(*) from asset_class_assignments c
                            where c.class_key = p.class_key
                              and c.organization_id = app_current_org()), 0),
    'applicability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'analysisKey', aa.analysis_key, 'applicable', aa.applicable, 'reason', aa.reason)
        order by aa.analysis_key)
      from analysis_applicability aa where aa.measurement_basis = p.measurement_basis
    ), '[]'::jsonb)
  ) order by p.register_ref), '[]'::jsonb)
  from asset_class_profiles p;
$$;

grant execute on function get_class_profiles() to authenticated;

notify pgrst, 'reload schema';
