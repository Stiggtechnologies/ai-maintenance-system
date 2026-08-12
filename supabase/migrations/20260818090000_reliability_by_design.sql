-- ============================================================================
-- Capital projects and reliability by design (register E8.01–E8.14).
--
-- The U4 slice established that the pre-service stages own most of the
-- whole-life cost and that this platform has no record of any of them. This
-- slice is what those stages should PRODUCE.
--
-- It extends the stage-gate machinery rather than building a second one: a
-- project's design review IS a stage gate on the design stage, and giving
-- capital projects their own parallel approval mechanism is how an
-- organisation ends up with two answers to "was this signed off".
--
-- THE ONE PIECE OF REAL ARITHMETIC HERE: RAM ALLOCATION.
--
-- A project is given an availability target for a system. That target has to
-- be allocated down to the subsystems that will deliver it, and the allocation
-- is not a matter of opinion: for subsystems in series the system availability
-- is the PRODUCT of theirs, so a 99% system target across ten series
-- subsystems needs 99.9% from each. Organisations routinely set a system
-- target, hand each subsystem the same number as the system, and are surprised.
-- allocateAvailability does the arithmetic and REFUSES a target that no
-- allocation can reach.
--
-- THE LOOP THAT IS ALMOST NEVER CLOSED (E8.14).
--
-- A failure mode learned in operation should become a requirement on the next
-- project. `design_requirements.derived_from_failure_mode` is that link, and
-- `get_design_feedback_loop()` reports how much operational learning has
-- actually reached a design requirement — usually none, and the number is the
-- point.
--
-- Canonical reuse: lifecycle_stages / stage_gate_criteria / stage_gate_reviews
-- from the whole-life slice, asset_dependencies from the interdependency
-- slice, taxonomy_definitions and failure modes, materials, suppliers,
-- assets, app_current_org(). Additive.
-- ============================================================================

create table if not exists capital_projects (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  project_code text not null,
  title text not null,
  -- The stage the project is at reuses the whole-life stage model rather than
  -- inventing a project-specific one.
  current_stage text references lifecycle_stages(stage_key),
  sanctioned_value numeric,
  target_handover date,
  status text not null default 'active' check (status in
    ('concept', 'active', 'on_hold', 'handed_over', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_capproj_code
  on capital_projects(organization_id, project_code);

alter table capital_projects enable row level security;
drop policy if exists capproj_read on capital_projects;
create policy capproj_read on capital_projects
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E8.01 / E8.07 / E8.14 — requirements, and where they came from
-- ---------------------------------------------------------------------------
create table if not exists design_requirements (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id bigint references capital_projects(id) on delete cascade,
  requirement_ref text not null,
  category text not null check (category in
    ('reliability', 'maintainability', 'access', 'instrumentation',
     'standardisation', 'sparing', 'safety', 'operability', 'data_handover')),
  requirement text not null,
  -- E8.14. The closed loop. A requirement traced to a failure mode learned in
  -- operation is the only evidence that the organisation learns.
  derived_from_failure_mode text,
  derived_from_asset_id uuid references assets(id) on delete set null,
  source text not null default 'engineering' check (source in
    ('engineering', 'operations', 'maintenance', 'incident', 'regulatory',
     'operational_lesson')),
  -- Verification is what turns a requirement into something that happened.
  verification_method text check (verification_method in
    ('review', 'analysis', 'inspection', 'factory_test', 'site_test', 'demonstration')),
  verification_status text not null default 'open' check (verification_status in
    ('open', 'verified', 'waived', 'failed')),
  verified_at timestamptz,
  waiver_reason text,
  created_at timestamptz not null default now(),
  -- A waiver with no reason is a requirement quietly dropped.
  check (verification_status <> 'waived'
         or (waiver_reason is not null and btrim(waiver_reason) <> ''))
);

create unique index if not exists idx_dreq_ref
  on design_requirements(organization_id, requirement_ref);
create index if not exists idx_dreq_project
  on design_requirements(organization_id, project_id, verification_status);

alter table design_requirements enable row level security;
drop policy if exists dreq_read on design_requirements;
create policy dreq_read on design_requirements
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E8.02 — RAM allocation. The arithmetic lives in TypeScript; this stores the
-- target and the allocation someone committed to.
-- ---------------------------------------------------------------------------
create table if not exists ram_targets (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id bigint not null references capital_projects(id) on delete cascade,
  system_label text not null,
  -- Availability as a fraction. Stated to the precision it was specified at.
  target_availability numeric not null
    check (target_availability > 0 and target_availability < 1),
  target_basis text,
  -- Series means every subsystem must work. Most process trains are series and
  -- most people allocate as though they were not.
  configuration text not null default 'series' check (configuration in
    ('series', 'parallel', 'mixed')),
  created_at timestamptz not null default now()
);

create table if not exists ram_allocations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  target_id bigint not null references ram_targets(id) on delete cascade,
  subsystem_label text not null,
  -- What this subsystem is being asked to deliver.
  allocated_availability numeric
    check (allocated_availability > 0 and allocated_availability < 1),
  -- What the vendor or the fleet history says it can actually deliver.
  demonstrated_availability numeric
    check (demonstrated_availability > 0 and demonstrated_availability < 1),
  evidence text,
  -- Relative difficulty, used to weight the allocation away from equal shares.
  complexity_weight numeric not null default 1 check (complexity_weight > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_ramalloc_pair
  on ram_allocations(target_id, subsystem_label);

alter table ram_targets enable row level security;
alter table ram_allocations enable row level security;
drop policy if exists ramt_read on ram_targets;
create policy ramt_read on ram_targets
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists rama_read on ram_allocations;
create policy rama_read on ram_allocations
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E8.03–E8.06, E8.08 — the studies that should happen before steel is cut
-- ---------------------------------------------------------------------------
create table if not exists design_studies (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id bigint not null references capital_projects(id) on delete cascade,
  study_kind text not null check (study_kind in
    ('equipment_selection', 'maintainability_review', 'access_and_lifting',
     'removal_route', 'standardisation_review', 'sparing_review',
     'instrumentation_review', 'ram_study')),
  performed_on date,
  -- E8.04. Who was in the room decides whether the review was real.
  maintainer_participated boolean not null default false,
  operator_participated boolean not null default false,
  findings_count int not null default 0 check (findings_count >= 0),
  findings_closed int not null default 0 check (findings_closed >= 0),
  summary text,
  created_at timestamptz not null default now(),
  check (findings_closed <= findings_count)
);

create index if not exists idx_dstudy_project
  on design_studies(organization_id, project_id, study_kind);

alter table design_studies enable row level security;
drop policy if exists dstudy_read on design_studies;
create policy dstudy_read on design_studies
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E8.09 / E8.10 — acceptance testing and commissioning
-- ---------------------------------------------------------------------------
create table if not exists acceptance_tests (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id bigint not null references capital_projects(id) on delete cascade,
  test_ref text not null,
  test_stage text not null check (test_stage in
    ('factory_acceptance', 'site_acceptance', 'pre_commissioning',
     'commissioning', 'performance_test', 'reliability_run')),
  scheduled_on date,
  performed_on date,
  outcome text check (outcome in ('pass', 'pass_with_punch', 'fail', 'not_performed')),
  -- Punch items that follow the asset into service are the ones that matter.
  punch_items_raised int not null default 0 check (punch_items_raised >= 0),
  punch_items_open int not null default 0 check (punch_items_open >= 0),
  witnessed_by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  check (punch_items_open <= punch_items_raised)
);

create unique index if not exists idx_atest_ref
  on acceptance_tests(organization_id, test_ref);

alter table acceptance_tests enable row level security;
drop policy if exists atest_read on acceptance_tests;
create policy atest_read on acceptance_tests
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- E8.13 — early-life failures, tied to what should have caught them
-- ---------------------------------------------------------------------------
create table if not exists early_life_failures (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  project_id bigint references capital_projects(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,
  occurred_at timestamptz not null,
  months_since_handover numeric check (months_since_handover >= 0),
  failure_mode text,
  -- The question that turns an early-life failure into a design lesson.
  attributed_to text check (attributed_to in
    ('design', 'manufacture', 'installation', 'commissioning',
     'operation_outside_envelope', 'random', 'not_determined')),
  preventable_by text,
  fed_back_to_design boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_elf_org
  on early_life_failures(organization_id, occurred_at desc);

alter table early_life_failures enable row level security;
drop policy if exists elf_read on early_life_failures;
create policy elf_read on early_life_failures
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
drop function if exists get_project_posture();
create or replace function get_project_posture()
returns table (
  projects_total bigint,
  requirements_total bigint,
  requirements_open bigint,
  requirements_waived bigint,
  requirements_from_operations bigint,
  requirements_traced_to_failure_mode bigint,
  ram_targets_set bigint,
  studies_total bigint,
  studies_without_maintainer bigint,
  open_punch_items bigint,
  early_life_failures_total bigint,
  early_life_fed_back bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  p as (select count(*)::bigint n from capital_projects where organization_id = (select id from org)),
  r as (
    select count(*)::bigint n,
           count(*) filter (where verification_status = 'open')::bigint open_n,
           count(*) filter (where verification_status = 'waived')::bigint waived,
           count(*) filter (where source in ('operations','maintenance','operational_lesson'))::bigint from_ops,
           -- The sharper number. Sourced from maintenance is input; traced to a
           -- specific failure mode learned in service is the loop actually closing.
           count(*) filter (where derived_from_failure_mode is not null)::bigint traced
    from design_requirements where organization_id = (select id from org)
  ),
  t as (select count(*)::bigint n from ram_targets where organization_id = (select id from org)),
  s as (
    select count(*)::bigint n,
           count(*) filter (where not maintainer_participated)::bigint no_maintainer
    from design_studies where organization_id = (select id from org)
  ),
  a as (select coalesce(sum(punch_items_open), 0)::bigint n from acceptance_tests
         where organization_id = (select id from org)),
  e as (
    select count(*)::bigint n, count(*) filter (where fed_back_to_design)::bigint fed
    from early_life_failures where organization_id = (select id from org)
  )
  select p.n, r.n, r.open_n, r.waived, r.from_ops, r.traced, t.n, s.n, s.no_maintainer,
         a.n, e.n, e.fed,
    case
      when p.n = 0 then
        'No capital projects are recorded. Reliability by design is a stage of work this platform '
        || 'has never seen — which matches the whole-life coverage finding, and means the design '
        || 'decisions setting the next twenty years of maintenance cost are being made somewhere else.'
      else
        p.n || ' project(s), ' || r.n || ' design requirement(s)'
        || case when r.open_n > 0 then ', ' || r.open_n || ' unverified' else '' end
        || case when r.waived > 0 then ', ' || r.waived || ' waived' else '' end || '. '
        || case when r.n = 0 then ''
                when r.traced = 0 then
                  r.from_ops || ' came from operations or maintenance, but NONE traces to a specific '
                  || 'failure mode learned in service. That is the loop that is almost never closed: '
                  || 'the plant knows what breaks and the next project does not.'
                else r.from_ops || ' came from operations or maintenance, and ' || r.traced
                  || ' trace to a specific failure mode learned in service.' end
    end
    || case when s.no_maintainer > 0 then ' ' || s.no_maintainer
            || ' design study/studies ran without anyone who will maintain the asset in the room.'
            else '' end
    || case when a.n > 0 then ' ' || a.n
            || ' punch item(s) remain open and follow the asset into service.' else '' end
  from p, r, t, s, a, e;
$$;

grant execute on function get_project_posture() to authenticated;

-- The RAM target and its allocation, shaped for the arithmetic engine.
create or replace function get_ram_allocation(p_project_code text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'systemLabel', t.system_label,
    'targetAvailability', t.target_availability,
    'configuration', t.configuration,
    'targetBasis', t.target_basis,
    'subsystems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', a.subsystem_label,
        'allocated', a.allocated_availability,
        'demonstrated', a.demonstrated_availability,
        'complexityWeight', a.complexity_weight,
        'evidence', a.evidence) order by a.subsystem_label)
      from ram_allocations a where a.target_id = t.id
    ), '[]'::jsonb))), '[]'::jsonb)
  from ram_targets t
  join capital_projects c on c.id = t.project_id
  where c.organization_id = app_current_org() and c.project_code = p_project_code;
$$;

grant execute on function get_ram_allocation(text) to authenticated;

-- E8.14 — how much operational learning actually reaches a design requirement.
create or replace function get_design_feedback_loop()
returns table (
  failure_mode text,
  occurrences bigint,
  assets_affected bigint,
  requirements_referencing bigint,
  loop_closed boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with modes as (
    select coalesce(nullif(btrim(w.actual_failure_mode), ''), '(uncoded)') fm,
           count(*)::bigint n,
           count(distinct w.asset_id)::bigint assets
    from work_orders w
    where w.organization_id = app_current_org()
      and w.work_type = 'corrective'
    group by 1
  )
  select m.fm, m.n, m.assets,
         (select count(*) from design_requirements d
           where d.organization_id = app_current_org()
             and d.derived_from_failure_mode = m.fm)::bigint,
         exists (select 1 from design_requirements d
                  where d.organization_id = app_current_org()
                    and d.derived_from_failure_mode = m.fm)
  from modes m
  order by m.n desc
  limit 15;
$$;

grant execute on function get_design_feedback_loop() to authenticated;

notify pgrst, 'reload schema';
