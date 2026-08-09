-- ============================================================================
-- Process safety and asset integrity (register E2.01–E2.13).
--
-- The safety gatekeeper built earlier stops a recommendation being approved
-- while it is unattested against twelve consequence dimensions. That is a
-- screening control: it asks whether anyone has LOOKED. This slice gives it
-- something concrete to look at — a register of the barriers the site actually
-- relies on, and the arithmetic that says whether each one still works.
--
-- THE EXTENSION, NOT A SECOND GATE. enforce_safety_gate() is redefined here to
-- add ONE condition: a recommendation that would impair a safety-critical
-- barrier cannot be approved while that impairment has no approved,
-- in-date deviation. Adding a parallel trigger would give the platform two
-- places to say no and two places to get it wrong.
--
-- WHAT THE ARITHMETIC IS FOR (E2.07). A safety-instrumented function's SIL is
-- a band of PFD, and PFD depends on the proof-test interval ACTUALLY ACHIEVED,
-- not the one on the schedule. A function tested at 36 months against a
-- 12-month specification has three times the PFD it was designed for and may
-- have dropped a band. Nobody decided to accept that; it happened by the test
-- not being done. src/lib/process-safety computes it and the panel says so.
--
-- BARRIERS SHARE CAUSES, LIKE EVERYTHING ELSE. Four preventive barriers that
-- all depend on instrument air are one barrier with three copies. This reuses
-- the common_cause_groups built in the interdependency slice rather than
-- inventing a second notion of shared cause.
--
-- Canonical reuse: recommendations, recommendation_screenings and
-- enforce_safety_gate() from the safety-gatekeeper slice; common_cause_groups
-- and common_cause_members from U2; temporary_modifications from U7;
-- condition_readings and pf_intervals; assets, work_orders, app_current_org().
-- Additive apart from the redefined trigger function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- E2.01 — safety-critical elements and their performance standards
-- ---------------------------------------------------------------------------
create table if not exists safety_critical_elements (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  sce_ref text not null,
  label text not null,
  barrier_kind text not null check (barrier_kind in
    ('instrumented', 'mechanical', 'passive', 'procedural', 'human',
     'structural', 'emergency_response')),
  barrier_role text not null check (barrier_role in ('preventive', 'mitigative')),
  -- A barrier with no stated performance standard cannot be tested, and an
  -- untestable barrier is a claim. Enforced rather than encouraged.
  performance_standard text,
  test_interval_months int check (test_interval_months > 0),
  last_tested_on date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_sce_ref
  on safety_critical_elements(organization_id, sce_ref);

alter table safety_critical_elements enable row level security;
drop policy if exists sce_read on safety_critical_elements;
create policy sce_read on safety_critical_elements
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.02 — bow-tie: hazard, threats, top event, consequences, barriers
-- ---------------------------------------------------------------------------
create table if not exists major_hazards (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  hazard_ref text not null,
  title text not null,
  top_event text not null,
  worst_credible_consequence text,
  consequence_class text check (consequence_class in
    ('multiple_fatality', 'single_fatality', 'major_injury',
     'major_environmental', 'major_asset_loss')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_haz_ref
  on major_hazards(organization_id, hazard_ref);

create table if not exists hazard_barriers (
  hazard_id bigint not null references major_hazards(id) on delete cascade,
  sce_id bigint not null references safety_critical_elements(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  threat_or_consequence text,
  primary key (hazard_id, sce_id)
);

alter table major_hazards enable row level security;
alter table hazard_barriers enable row level security;
drop policy if exists haz_read on major_hazards;
create policy haz_read on major_hazards
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists hazbar_read on hazard_barriers;
create policy hazbar_read on hazard_barriers
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.03 — integrity operating windows, and exceedances of them
-- ---------------------------------------------------------------------------
create table if not exists integrity_windows (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  parameter text not null,
  unit text,
  -- Standard IOW structure: an inner window operators keep, an outer limit
  -- that engineering must be told about.
  standard_low numeric,
  standard_high numeric,
  critical_low numeric,
  critical_high numeric,
  -- The damage mechanism the window exists to control. A window with no
  -- mechanism behind it is a setpoint somebody liked.
  damage_mechanism text,
  consequence_of_exceedance text,
  created_at timestamptz not null default now()
);

create table if not exists integrity_exceedances (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  window_id bigint not null references integrity_windows(id) on delete cascade,
  occurred_at timestamptz not null,
  ended_at timestamptz,
  peak_value numeric,
  severity text not null check (severity in ('standard', 'critical')),
  acknowledged_by uuid references auth.users(id) on delete set null,
  engineering_assessed boolean not null default false,
  assessment_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_iow_exc
  on integrity_exceedances(organization_id, occurred_at desc);

alter table integrity_windows enable row level security;
alter table integrity_exceedances enable row level security;
drop policy if exists iow_read on integrity_windows;
create policy iow_read on integrity_windows
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists iowe_read on integrity_exceedances;
create policy iowe_read on integrity_exceedances
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.04–E2.06 — pressure equipment, corrosion circuits, risk-based inspection
-- ---------------------------------------------------------------------------
create table if not exists corrosion_circuits (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  circuit_ref text not null,
  description text not null,
  material text,
  service_fluid text,
  damage_mechanisms text,
  design_thickness_mm numeric,
  minimum_thickness_mm numeric,
  created_at timestamptz not null default now(),
  check (minimum_thickness_mm is null or design_thickness_mm is null
         or minimum_thickness_mm <= design_thickness_mm)
);

create unique index if not exists idx_circ_ref
  on corrosion_circuits(organization_id, circuit_ref);

create table if not exists thickness_readings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  circuit_id bigint not null references corrosion_circuits(id) on delete cascade,
  cml_ref text not null,
  measured_on date not null,
  thickness_mm numeric not null check (thickness_mm > 0),
  method text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tml
  on thickness_readings(organization_id, circuit_id, cml_ref, measured_on desc);

create table if not exists inspection_plans (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  circuit_id bigint references corrosion_circuits(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  -- Risk-based inspection is probability x consequence, and the interval
  -- should follow from both rather than from a calendar habit.
  probability_category text check (probability_category in ('1','2','3','4','5')),
  consequence_category text check (consequence_category in ('A','B','C','D','E')),
  risk_rank text,
  interval_months int check (interval_months > 0),
  interval_basis text,
  next_due date,
  last_performed date,
  created_at timestamptz not null default now(),
  check (circuit_id is not null or asset_id is not null)
);

create index if not exists idx_insp_due
  on inspection_plans(organization_id, next_due);

alter table corrosion_circuits enable row level security;
alter table thickness_readings enable row level security;
alter table inspection_plans enable row level security;
drop policy if exists circ_read on corrosion_circuits;
create policy circ_read on corrosion_circuits
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists tml_read on thickness_readings;
create policy tml_read on thickness_readings
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists insp_read on inspection_plans;
create policy insp_read on inspection_plans
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.07 / E2.08 — safety-instrumented functions and relief devices
-- ---------------------------------------------------------------------------
create table if not exists safety_instrumented_functions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  sce_id bigint references safety_critical_elements(id) on delete set null,
  sif_ref text not null,
  description text not null,
  target_sil int not null check (target_sil between 1 and 4),
  architecture text not null default '1oo1' check (architecture in ('1oo1','1oo2','2oo3')),
  -- Dangerous-undetected failure rate per hour. Without it no PFD exists and
  -- the SIL claim rests on nothing.
  lambda_du_per_hour numeric check (lambda_du_per_hour > 0),
  beta_factor numeric check (beta_factor >= 0 and beta_factor < 1),
  proof_test_interval_months int not null check (proof_test_interval_months > 0),
  last_proof_test_on date,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_sif_ref
  on safety_instrumented_functions(organization_id, sif_ref);

create table if not exists relief_devices (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  device_ref text not null,
  device_kind text not null check (device_kind in
    ('psv', 'rupture_disc', 'vacuum_breaker', 'conservation_vent', 'other')),
  set_pressure numeric,
  set_pressure_unit text,
  -- The relieving case the device was sized for. A PSV with no stated case is
  -- a device of unknown adequacy.
  governing_case text,
  test_interval_months int check (test_interval_months > 0),
  last_tested_on date,
  last_test_result text check (last_test_result in
    ('pass', 'pass_after_adjustment', 'fail_leak', 'fail_set_pressure', 'fail_stuck')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_rd_ref
  on relief_devices(organization_id, device_ref);

alter table safety_instrumented_functions enable row level security;
alter table relief_devices enable row level security;
drop policy if exists sif_read on safety_instrumented_functions;
create policy sif_read on safety_instrumented_functions
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists rd_read on relief_devices;
create policy rd_read on relief_devices
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.09 — alarm performance, E2.10 — loss of containment
-- ---------------------------------------------------------------------------
create table if not exists alarm_performance (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  console_label text not null,
  period_start date not null,
  period_end date not null,
  operator_hours numeric not null check (operator_hours > 0),
  total_alarms int not null check (total_alarms >= 0),
  peak_ten_minute_count int,
  standing_alarms int,
  high_priority int,
  medium_priority int,
  low_priority int,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists containment_losses (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete set null,
  hazard_id bigint references major_hazards(id) on delete set null,
  occurred_at timestamptz not null,
  substance text,
  quantity numeric,
  quantity_unit text,
  -- Tier 1 / Tier 2 in the API 754 sense, plus the near-misses that are the
  -- only cheap warning anyone gets.
  tier text not null check (tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4')),
  reached_environment boolean not null default false,
  barrier_that_failed bigint references safety_critical_elements(id) on delete set null,
  investigation_reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_loc_org
  on containment_losses(organization_id, occurred_at desc);

alter table alarm_performance enable row level security;
alter table containment_losses enable row level security;
drop policy if exists alarmp_read on alarm_performance;
create policy alarmp_read on alarm_performance
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists loc_read on containment_losses;
create policy loc_read on containment_losses
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.12 — impairments. A barrier out of service, with a deviation or without.
--
-- Distinct from temporary_modifications, which covers physical changes: an
-- impairment is a BARRIER being unavailable, and it is what the approval gate
-- below actually tests. Where a physical modification caused it, the two are
-- linked rather than duplicated.
-- ---------------------------------------------------------------------------
create table if not exists barrier_impairments (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  sce_id bigint not null references safety_critical_elements(id) on delete cascade,
  temporary_modification_id bigint references temporary_modifications(id) on delete set null,
  started_at timestamptz not null default now(),
  expected_restoration date not null,
  restored_at timestamptz,
  reason text not null,
  -- The compensating control is what makes an impairment tolerable. Without
  -- one, the barrier is simply gone.
  compensating_measures text,
  deviation_approved_by uuid references auth.users(id) on delete set null,
  deviation_approved_at timestamptz,
  deviation_expires_on date,
  created_at timestamptz not null default now(),
  check (restored_at is null or restored_at >= started_at)
);

create index if not exists idx_imp_open
  on barrier_impairments(organization_id, sce_id) where restored_at is null;

alter table barrier_impairments enable row level security;
drop policy if exists imp_read on barrier_impairments;
create policy imp_read on barrier_impairments
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E2.13 — THE GUARD, EXTENDED IN PLACE.
--
-- enforce_safety_gate() already blocks approval past an unattested screening.
-- One condition is added: a recommendation that names a barrier it would
-- impair cannot be approved unless that impairment carries an approved
-- deviation that has not expired. Redefined rather than supplemented, so the
-- platform keeps exactly one place that says no.
-- ---------------------------------------------------------------------------
alter table recommendations
  add column if not exists impairs_sce_id bigint references safety_critical_elements(id);

create or replace function public.enforce_safety_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s recommendation_screenings%rowtype;
  imp barrier_impairments%rowtype;
  sce safety_critical_elements%rowtype;
begin
  if new.status is distinct from 'approved'
     or old.status is not distinct from new.status then
    return new;
  end if;

  -- Original condition: an unattested screening blocks approval.
  select * into s from recommendation_screenings
  where recommendation_id = new.id;

  if found and s.requires_gatekeeper and s.gatekeeper_attested_at is null then
    raise exception
      'Safety gate: recommendation % affects % and requires gatekeeper clearance before approval',
      new.id, s.dimensions_hit
      using errcode = 'check_violation';
  end if;

  -- Added condition: approving something that impairs a safety-critical
  -- barrier requires an approved, in-date deviation for that impairment.
  if new.impairs_sce_id is not null then
    select * into sce from safety_critical_elements where id = new.impairs_sce_id;

    select * into imp from barrier_impairments
     where sce_id = new.impairs_sce_id and restored_at is null
       and deviation_approved_at is not null
       and (deviation_expires_on is null or deviation_expires_on >= current_date)
     order by started_at desc limit 1;

    if not found then
      raise exception
        'Safety gate: recommendation % would impair safety-critical element % (%), and no approved, in-date deviation exists for that impairment. A barrier is not taken out of service by approving a work item.',
        new.id, coalesce(sce.sce_ref, new.impairs_sce_id::text), coalesce(sce.label, 'unknown')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_process_safety_posture();
create or replace function get_process_safety_posture()
returns table (
  barriers_total bigint,
  barriers_without_standard bigint,
  barriers_overdue_test bigint,
  open_impairments bigint,
  impairments_without_deviation bigint,
  impairments_overdue bigint,
  hazards_defined bigint,
  hazards_without_preventive bigint,
  sifs_total bigint,
  sifs_overdue bigint,
  sifs_without_lambda bigint,
  iow_exceedances_unassessed bigint,
  relief_devices_overdue bigint,
  loc_tier1_tier2 bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  b as (
    select count(*)::bigint n,
           count(*) filter (where performance_standard is null
                              or btrim(performance_standard) = '')::bigint no_std,
           count(*) filter (where test_interval_months is not null
                              and (last_tested_on is null
                                   or last_tested_on < current_date
                                      - (test_interval_months || ' months')::interval))::bigint overdue
    from safety_critical_elements where organization_id = (select id from org)
  ),
  i as (
    select count(*) filter (where restored_at is null)::bigint open_n,
           count(*) filter (where restored_at is null
                              and (deviation_approved_at is null
                                   or (deviation_expires_on is not null
                                       and deviation_expires_on < current_date)))::bigint no_dev,
           count(*) filter (where restored_at is null
                              and expected_restoration < current_date)::bigint overdue
    from barrier_impairments where organization_id = (select id from org)
  ),
  h as (
    select count(*)::bigint n,
           count(*) filter (where not exists (
             select 1 from hazard_barriers hb
             join safety_critical_elements e on e.id = hb.sce_id
             where hb.hazard_id = mh.id and e.barrier_role = 'preventive'
           ))::bigint no_prev
    from major_hazards mh where mh.organization_id = (select id from org)
  ),
  f as (
    select count(*)::bigint n,
           count(*) filter (where last_proof_test_on is null
                              or last_proof_test_on < current_date
                                 - (proof_test_interval_months || ' months')::interval)::bigint overdue,
           count(*) filter (where lambda_du_per_hour is null)::bigint no_lambda
    from safety_instrumented_functions where organization_id = (select id from org)
  ),
  x as (
    select count(*) filter (where not engineering_assessed and severity = 'critical')::bigint n
    from integrity_exceedances where organization_id = (select id from org)
  ),
  r as (
    select count(*) filter (where test_interval_months is not null
                              and (last_tested_on is null
                                   or last_tested_on < current_date
                                      - (test_interval_months || ' months')::interval))::bigint n
    from relief_devices where organization_id = (select id from org)
  ),
  l as (
    select count(*) filter (where tier in ('tier_1','tier_2'))::bigint n
    from containment_losses where organization_id = (select id from org)
  )
  select b.n, b.no_std, b.overdue, i.open_n, i.no_dev, i.overdue,
         h.n, h.no_prev, f.n, f.overdue, f.no_lambda, x.n, r.n, l.n,
    case
      when b.n = 0 then
        'No safety-critical elements are registered. The safety gatekeeper can still ask whether '
        || 'anyone has looked at a recommendation, but it has no register of barriers to check it '
        || 'against — and a barrier nobody has written down cannot be protected by a control.'
      else
        b.n || ' safety-critical element(s) registered across ' || h.n || ' major hazard(s).'
        || case when b.no_std > 0 then ' ' || b.no_std
                || ' have NO stated performance standard and cannot be counted as barriers — '
                || 'a barrier nobody can test is a claim.' else '' end
        || case when b.overdue > 0 then ' ' || b.overdue || ' are overdue for test.' else '' end
    end
    || case when h.no_prev > 0 then ' ' || h.no_prev
            || ' hazard(s) have NO preventive barrier recorded at all.' else '' end
    || case when i.no_dev > 0 then ' ' || i.no_dev
            || ' open impairment(s) carry no approved, in-date deviation.' else '' end
    || case when f.overdue > 0 then ' ' || f.overdue || ' of ' || f.n
            || ' safety-instrumented function(s) are overdue for proof test, which raises their '
            || 'PFD and may have moved them out of their target SIL band.' else '' end
    || case when f.no_lambda > 0 then ' ' || f.no_lambda
            || ' SIF(s) have no dangerous-undetected failure rate recorded, so their SIL claim '
            || 'rests on nothing computable.' else '' end
    || case when x.n > 0 then ' ' || x.n
            || ' CRITICAL integrity-window exceedance(s) have not been assessed by engineering.'
            else '' end
  from b, i, h, f, x, r, l;
$$;

grant execute on function get_process_safety_posture() to authenticated;

-- SIFs shaped for the PFD engine.
create or replace function get_sif_register()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tag', f.sif_ref,
    'description', f.description,
    'targetSil', f.target_sil,
    'lambdaDU', f.lambda_du_per_hour,
    'specifiedIntervalMonths', f.proof_test_interval_months,
    'monthsSinceLastTest', case when f.last_proof_test_on is null then null
      else round(extract(epoch from (now() - f.last_proof_test_on::timestamptz)) / 2629800.0, 1) end,
    'architecture', f.architecture,
    'betaFactor', f.beta_factor) order by f.sif_ref), '[]'::jsonb)
  from safety_instrumented_functions f
  where f.organization_id = app_current_org() and f.lambda_du_per_hour is not null;
$$;

grant execute on function get_sif_register() to authenticated;

-- Barrier sets per hazard, with the common-cause groups they belong to.
create or replace function get_hazard_barriers()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'hazard', h.title,
    'topEvent', h.top_event,
    'consequenceClass', h.consequence_class,
    'preventive', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'label', e.label, 'kind', e.barrier_kind,
        'performanceStandardStated',
          (e.performance_standard is not null and btrim(e.performance_standard) <> ''),
        'impaired', exists (select 1 from barrier_impairments bi
                            where bi.sce_id = e.id and bi.restored_at is null),
        'commonCauseGroups', coalesce((
          select jsonb_agg(g.name) from common_cause_members m
          join common_cause_groups g on g.id = m.group_id
          where m.asset_id = e.asset_id), '[]'::jsonb)))
      from hazard_barriers hb
      join safety_critical_elements e on e.id = hb.sce_id
      where hb.hazard_id = h.id and e.barrier_role = 'preventive'
    ), '[]'::jsonb),
    'mitigative', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'label', e.label, 'kind', e.barrier_kind,
        'performanceStandardStated',
          (e.performance_standard is not null and btrim(e.performance_standard) <> ''),
        'impaired', exists (select 1 from barrier_impairments bi
                            where bi.sce_id = e.id and bi.restored_at is null),
        'commonCauseGroups', '[]'::jsonb))
      from hazard_barriers hb
      join safety_critical_elements e on e.id = hb.sce_id
      where hb.hazard_id = h.id and e.barrier_role = 'mitigative'
    ), '[]'::jsonb)) order by h.hazard_ref), '[]'::jsonb)
  from major_hazards h
  where h.organization_id = app_current_org();
$$;

grant execute on function get_hazard_barriers() to authenticated;

notify pgrst, 'reload schema';
