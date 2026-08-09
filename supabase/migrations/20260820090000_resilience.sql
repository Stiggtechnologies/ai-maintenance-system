-- ============================================================================
-- Enterprise resilience (register E11.01–E11.12).
--
-- A threat scenario is not a new kind of analysis. Wildfire, flood, grid loss,
-- a cyber incident and a sole-source supplier failing all ask the same
-- question the interdependency slice already answers: which assets stop, and
-- what stops with them. So the analysis REUSES propagateLoss rather than
-- adding a second cascade engine — one engine, one set of tests, one place to
-- be wrong.
--
-- What this adds is the front half: turning a threat into a set of assets, and
-- being honest about how much of that translation is guesswork.
--
-- TWO LIMITS, REPORTED RATHER THAN BURIED.
--
--   * A scenario can only cascade through assets the dependency graph covers.
--     Where a directly affected asset has no recorded dependencies, nothing
--     downstream of it is counted, and the impact figure is a FLOOR. The
--     analysis says so in those words.
--   * An unexercised plan is a document. Same standard the continuity
--     procedures and process-safety barriers use, for the same reason: every
--     plan works on paper.
--
-- OPERATING MODES ARE A STATE MACHINE (E11.12). Normal, degraded, emergency
-- and recovery differ in WHO MAY DECIDE WHAT. A mode with no entry criteria
-- and no declaring authority is a word on a dashboard, so those columns exist
-- and the readiness check counts a mode as unusable without them.
--
-- Canonical reuse: asset_dependencies and common_cause_groups from U2,
-- continuity_procedures from E5, suppliers from E7, safety_critical_elements
-- from E2, decision-rights policy from slice 1, assets, app_current_org().
-- Additive.
-- ============================================================================

create table if not exists threat_scenarios (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  scenario_key text not null,
  title text not null,
  threat_kind text not null check (threat_kind in
    ('wildfire', 'flood', 'extreme_cold', 'grid_interruption', 'cyber_incident',
     'supply_chain', 'utility_failure', 'labour_shortage',
     'major_equipment_loss', 'site_evacuation', 'emergency_shutdown',
     'communications_failure')),
  description text,
  -- How likely, and how bad. Both optional: an unassessed scenario is still
  -- worth recording, and pretending to a probability is worse than a blank.
  annual_likelihood numeric check (annual_likelihood > 0 and annual_likelihood <= 1),
  plan_reference text,
  last_exercised_on date,
  exercise_outcome text check (exercise_outcome in
    ('successful', 'partial', 'failed', 'cancelled')),
  -- Where a scenario is really a realised exposure the platform already
  -- tracks, point at it rather than restating it.
  linked_continuity_procedure bigint references continuity_procedures(id) on delete set null,
  linked_supplier bigint references suppliers(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_threat_key
  on threat_scenarios(organization_id, scenario_key);

create table if not exists scenario_exposure (
  scenario_id bigint not null references threat_scenarios(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Why this asset is exposed: co-location, shared supply, direct hazard.
  basis text,
  primary key (scenario_id, asset_id)
);

create index if not exists idx_scexp_org on scenario_exposure(organization_id);

-- E11.12 — the modes, as a state machine rather than a label.
create table if not exists operating_mode_definitions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  mode text not null check (mode in ('normal', 'degraded', 'emergency', 'recovery')),
  entry_criteria text,
  exit_criteria text,
  -- A mode anyone can declare is not a control.
  declared_by_role text,
  -- Which decisions change hands. This is the part that makes the mode real.
  authority_changes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_modedef
  on operating_mode_definitions(organization_id, mode);

create table if not exists operating_mode_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete set null,
  mode text not null check (mode in ('normal', 'degraded', 'emergency', 'recovery')),
  scenario_id bigint references threat_scenarios(id) on delete set null,
  declared_at timestamptz not null default now(),
  declared_by uuid references auth.users(id) on delete set null,
  ended_at timestamptz,
  note text,
  check (ended_at is null or ended_at >= declared_at)
);

create index if not exists idx_modeevt
  on operating_mode_events(organization_id, declared_at desc);

alter table threat_scenarios enable row level security;
alter table scenario_exposure enable row level security;
alter table operating_mode_definitions enable row level security;
alter table operating_mode_events enable row level security;
drop policy if exists threat_read on threat_scenarios;
create policy threat_read on threat_scenarios
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists scexp_read on scenario_exposure;
create policy scexp_read on scenario_exposure
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists modedef_read on operating_mode_definitions;
create policy modedef_read on operating_mode_definitions
  for select to authenticated using (organization_id = app_current_org());
drop policy if exists modeevt_read on operating_mode_events;
create policy modeevt_read on operating_mode_events
  for select to authenticated using (organization_id = app_current_org());

drop function if exists get_resilience_posture();
create or replace function get_resilience_posture()
returns table (
  scenarios_total bigint,
  threat_kinds_covered bigint,
  scenarios_with_exposure bigint,
  scenarios_never_exercised bigint,
  scenarios_stale_exercise bigint,
  modes_defined bigint,
  modes_fully_specified bigint,
  current_mode text,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  s as (
    select count(*)::bigint n,
           count(distinct threat_kind)::bigint kinds,
           count(*) filter (where exists (
             select 1 from scenario_exposure e where e.scenario_id = t.id))::bigint with_exp,
           count(*) filter (where last_exercised_on is null)::bigint never,
           count(*) filter (where last_exercised_on is not null
                              and last_exercised_on < current_date - 730)::bigint stale
    from threat_scenarios t where t.organization_id = (select id from org)
  ),
  m as (
    select count(*)::bigint n,
           count(*) filter (where entry_criteria is not null and btrim(entry_criteria) <> ''
                              and exit_criteria is not null and btrim(exit_criteria) <> ''
                              and declared_by_role is not null and btrim(declared_by_role) <> ''
                              and authority_changes is not null and btrim(authority_changes) <> ''
                           )::bigint full_n
    from operating_mode_definitions where organization_id = (select id from org)
  ),
  cur as (
    select coalesce((select mode from operating_mode_events
                      where organization_id = (select id from org) and ended_at is null
                      order by declared_at desc limit 1), 'normal') mode
  )
  select s.n, s.kinds, s.with_exp, s.never, s.stale, m.n, m.full_n, cur.mode,
    btrim(
    case
      when s.n = 0 then
        'No threat scenarios are recorded. The register names twelve — wildfire, flood, extreme '
        || 'cold, grid, cyber, supply chain, utilities, labour, equipment loss, evacuation, '
        || 'emergency shutdown and communications — and none has been assessed against this '
        || 'asset base.'
      else
        s.n || ' scenario(s) across ' || s.kinds || ' of the 12 threat kinds. '
        || case when s.with_exp < s.n
                then (s.n - s.with_exp) || ' have NO assets mapped as exposed, so nothing can be '
                     || 'computed for them — a scenario with no exposure mapped is a title. '
                else '' end
        || case when s.never > 0
                then s.never || ' have never been exercised; every plan works on paper, which is '
                     || 'exactly why the paper proves nothing. '
                else '' end
        || case when s.stale > 0
                then s.stale || ' were last exercised more than two years ago. ' else '' end
    end
    || case
         when m.n = 0 then
           'No operating modes are defined, so there is no declared difference between running '
           || 'normally and running in an emergency — which means the decision rights do not change '
           || 'when they most need to.'
         when m.full_n < 4 then
           m.full_n || ' of 4 operating mode(s) are fully specified with entry and exit criteria, a '
           || 'declaring authority and the decisions that move.'
         else 'All four operating modes are fully specified.'
       end)
  from s, m, cur;
$$;

grant execute on function get_resilience_posture() to authenticated;

create or replace function get_threat_scenarios()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'scenarioKey', t.scenario_key, 'title', t.title, 'threatKind', t.threat_kind,
    'description', t.description, 'annualLikelihood', t.annual_likelihood,
    'planReference', t.plan_reference,
    'lastExercisedOn', t.last_exercised_on, 'exerciseOutcome', t.exercise_outcome,
    'directlyAffected', coalesce((
      select jsonb_agg(e.asset_id) from scenario_exposure e where e.scenario_id = t.id
    ), '[]'::jsonb)) order by t.scenario_key), '[]'::jsonb)
  from threat_scenarios t where t.organization_id = app_current_org();
$$;

grant execute on function get_threat_scenarios() to authenticated;

create or replace function get_operating_modes()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'mode', mode, 'entryCriteria', entry_criteria, 'exitCriteria', exit_criteria,
    'declaredByRole', declared_by_role, 'authorityChanges', authority_changes)), '[]'::jsonb)
  from operating_mode_definitions where organization_id = app_current_org();
$$;

grant execute on function get_operating_modes() to authenticated;

notify pgrst, 'reload schema';
