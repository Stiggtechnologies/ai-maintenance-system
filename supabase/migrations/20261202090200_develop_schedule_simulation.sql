-- ============================================================================
-- Sync Develop Slice 4C — THE GATED, SEEDED, RECORDED SIMULATION.
--
--   D5.15  Monte Carlo gated on schedule quality (spec II.6)
--   D5.09  integrated risk-cost-schedule attribution, per risk (spec I.10)
--   D5.07  P50/P80 beside the deterministic figure (spec I.9)
--   D5.32  §51 forecast confidence, cost and schedule
--   D11.29 the modelling kernel finally records a lineage run
--
-- ── WHERE THE SIMULATION RUNS, AND WHY THAT IS NOT A LOOPHOLE ──────────────
-- The Monte Carlo kernel is `src/lib/modelling` and it stays there. One
-- simulator, never two (overlap-map: "Zero new math. Never a second
-- simulator."), and the slice test asserts no sampling machinery exists in
-- this file or any other SQL. The kernel runs in TypeScript, on the client.
--
-- That raises the obvious question: if the client computes the numbers, what
-- is a recorded run worth? The answer is NOT "the server computed it" — the
-- server did not. It is REPRODUCIBILITY UNDER A PINNED INPUT:
--
--   1. THE INPUTS ARE PINNED SERVER-SIDE. `sync_case_schedule_digest` builds
--      a canonical digest of the activities, their ranges, their logic and
--      every risk edge, and the recording door recomputes it and REFUSES any
--      result whose declared digest does not match. A simulation cannot claim
--      to be over a schedule that is not there.
--   2. THE SEED AND ITERATION COUNT ARE RECORDED. The kernel is deterministic
--      given (inputs, seed, iterations) — that is what `mulberry32` is for —
--      so anybody holding the recorded run can re-run the kernel and get the
--      same numbers or prove they cannot.
--   3. THE GATE IS SERVER-SIDE. A gate that lived only in the client is a
--      gate the client can decline to apply, so the door re-runs
--      `get_case_schedule_quality` itself and refuses on the server's verdict.
--   4. THE SHAPE IS CHECKED. Percentiles must be finite and non-decreasing,
--      the sample count must equal the declared iterations, at least one
--      sampled input must carry a real range, and every attributed risk must
--      be an edge that exists. A result that passes those and is still wrong
--      is a result somebody can be shown to have got wrong.
--
-- What that does NOT amount to is stated in the register row rather than
-- softened here: the server does not re-execute the sampler.
--
-- ── THE GATE (D5.15) ───────────────────────────────────────────────────────
-- Spec II.6: "Monte Carlo on poor logic is not useful." The door does not run
-- the simulation with a caveat attached; it REFUSES to record one at all and
-- names the failing defect classes. A caveated P80 and a clean P80 are read
-- identically by the person the paper is written for.
--
-- ── THE THING THIS FILE MUST NOT DO ────────────────────────────────────────
-- Manufacture a distribution. Specifically forbidden and specifically
-- checked: a percentile derived from the deterministic figure, a default
-- variance, a hardcoded interval, a "distribution" over zero or one sampled
-- input, or percentiles off an empty sample. Slice 4B deliberately shipped
-- D5.07/D5.32 as 🟡 with the P50/P80 columns saying ABSENT rather than
-- printing a spread nobody simulated; this file supplies the distribution,
-- and where a case has none it says so in exactly the words 4B used.
--
-- ── §70 ────────────────────────────────────────────────────────────────────
-- Nothing here approves, accepts or sanctions. Recording a distribution is
-- refused to the AI-operator identity by name: the P80 is the number a
-- sanction paper is written against, and an identity that could author it
-- would be determining the forecast it is forbidden to determine. There is
-- deliberately NO waiver act — nobody, of any role, can sign off a failing
-- defect class and open the gate. The way past a failing gate is to fix the
-- schedule.
--
-- Canonical reuse: get_case_schedule_quality (D5.13/D5.31), the D5.08 chain,
-- get_case_earned_value (D5.05), shutdown_tasks through the D5.28 door,
-- record_calculation_run (D11.29), audit_events, security_events. No second
-- forecast store, no second simulator, no sampler in SQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE INPUT DIGEST. ONE definition, used by the read that hands the kernel
--    its inputs AND by the door that accepts the result — so "the same
--    schedule" means the same thing on both sides of the round trip.
--
--    Every field that changes an answer is in it: durations, the ranges that
--    are sampled, the logic and its lags, and every risk edge's probability
--    and impact. `wbs_element_id` and labels are deliberately out — renaming
--    an activity does not change a distribution, and a digest that moved on
--    cosmetic edits would mark every recorded forecast stale for no reason.
-- ---------------------------------------------------------------------------
create or replace function public.sync_case_schedule_digest(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_activities text;
  v_risks text;
begin
  -- Granted to `authenticated` directly, so it carries its own tenant gate
  -- rather than relying on its callers having one. A digest is a fingerprint
  -- of another tenant's schedule and its risk edges; leaking one leaks
  -- whether that schedule changed.
  if v_org is null or not exists (
       select 1 from development_cases
        where id = p_case_id and organization_id = v_org) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select coalesce(string_agg(line, '|' order by line), '')
    into v_activities
  from (
    select t.id::text || ':' || t.duration_hours::text
             || ':' || coalesce(t.optimistic_hours::text, '-')
             || ':' || coalesce(t.pessimistic_hours::text, '-')
             || ':' || coalesce((select string_agg(d.predecessor_key
                                   || '/' || coalesce(d.link_type, '-')
                                   || '/' || coalesce(d.lag_hours::text, '-'), ',' order by d.predecessor_key)
                                 from shutdown_task_dependencies d
                                 where d.event_id = t.event_id and d.task_key = t.task_key), '') as line
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
     where e.organization_id = (select organization_id from development_cases where id = p_case_id)
       and e.development_case_id = p_case_id) s;

  select coalesce(string_agg(line, '|' order by line), '')
    into v_risks
  from (
    select i.risk_id::text || ':' || t.id::text || ':' || i.probability::text
             || ':' || i.delay_days_optimistic::text || ':' || i.delay_days_likely::text
             || ':' || i.delay_days_pessimistic::text
             || ':' || coalesce(i.cost_optimistic::text, '-')
             || ':' || coalesce(i.cost_likely::text, '-')
             || ':' || coalesce(i.cost_pessimistic::text, '-') as line
      from risk_schedule_impacts i
      join shutdown_tasks t on t.id = i.schedule_task_id
     where i.development_case_id = p_case_id) s;

  return jsonb_build_object(
    'activityDigest', md5(v_activities),
    'riskDigest', md5(v_risks));
end
$$;

revoke all on function public.sync_case_schedule_digest(uuid) from public, anon, service_role;
grant execute on function public.sync_case_schedule_digest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE PUBLISHED SIMULATION POLICY. Mirrored in TypeScript and pinned by
--    the slice test. Not tenant-configurable, for the reason the quality
--    policy is not: a floor a tenant can lower is a floor.
-- ---------------------------------------------------------------------------
create or replace function public.sync_schedule_simulation_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    -- Percentile noise at 1000 iterations on a triangular network is already
    -- of the order of a day; below that the reported P80 moves more between
    -- seeds than the risks move it.
    'minimumIterations', 1000,
    'maximumIterations', 100000,
    -- At least this many sampled inputs must actually carry a range. One
    -- ranged activity and forty fixed ones is a point estimate with a
    -- decorative interval on a single task.
    'minimumSampledRanges', 1,
    -- The per-risk marginal attribution costs one extra full simulation per
    -- risk. Beyond this the client is asked to narrow the register rather
    -- than the browser being asked to freeze.
    'maximumAttributedRisks', 50,
    'kernelModule', 'src/lib/modelling/integrated-risk.ts');
$$;

revoke all on function public.sync_schedule_simulation_policy() from public, anon;
grant execute on function public.sync_schedule_simulation_policy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE INPUTS THE KERNEL CONSUMES. Handed out with the digest they hash to
--    and with the gate verdict already attached, so a client that ignores
--    the gate is refused at the door rather than merely discouraged here.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_simulation_inputs(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_quality jsonb;
  v_chain jsonb;
  v_ev jsonb;
  v_activities jsonb;
  v_finish timestamptz;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_quality := get_case_schedule_quality(c.id);
  v_chain := get_case_risk_schedule_chain(c.id);
  v_ev := get_case_earned_value(c.id);

  -- THE NODE ID IS THE ROW ID, NOT THE TASK KEY. `task_key` is unique per
  -- shutdown_event and a case holds TWO of them by design (the P6 import and
  -- Sync's own activities, kept separate so no roll-up mixes them). Keying the
  -- network on task_key would silently merge a P6 activity and a Sync one that
  -- happen to share an id into a single node, and the simulation would run over
  -- a network that does not exist. The key travels alongside for display.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id::text,
           'key', t.task_key,
           'label', t.label,
           'duration', t.duration_hours,
           'optimistic', t.optimistic_hours,
           'pessimistic', t.pessimistic_hours,
           'predecessors', coalesce((
             select jsonb_agg(p2.id::text order by p2.id)
               from shutdown_task_dependencies d
               join shutdown_tasks p2
                 on p2.event_id = d.event_id and p2.task_key = d.predecessor_key
              where d.event_id = t.event_id and d.task_key = t.task_key),
             '[]'::jsonb))
         order by t.id), '[]'::jsonb),
         max(t.planned_finish)
    into v_activities, v_finish
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  return jsonb_build_object(
    'caseId', c.id,
    'activities', v_activities,
    'risks', v_chain->'links',
    'delayCostPerDay', v_chain->'delayCostRate'->'value',
    'delayCostSource', v_chain->'delayCostRate'->'source',
    'delayCostRefusal', v_chain->'delayCostRate'->'refusal',
    'deterministicFinish', v_finish,
    'costBase', v_ev->'metrics'->'eac'->'value',
    'costBaseLabel', 'Estimate at completion',
    'costBaseFormula', v_ev->'eacFormula',
    'costBaseRefusal', v_ev->'metrics'->'eac'->'refusal',
    'currency', v_ev->'currency',
    'digest', sync_case_schedule_digest(c.id),
    'policy', sync_schedule_simulation_policy(),
    'gate', v_quality->'gate',
    'qualityScore', v_quality->'score',
    'scheduleConfidence', v_quality->'confidence',
    'coverageNote', v_chain->'coverageNote',
    'unlinkedRisks', v_chain->'unlinkedRisks');
end
$$;

revoke all on function public.get_case_simulation_inputs(uuid) from public, anon, service_role;
grant execute on function public.get_case_simulation_inputs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE RECORDED DISTRIBUTION.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,

  -- Reproducibility. A result nobody can reproduce is not evidence.
  seed bigint not null,
  iterations int not null check (iterations >= 1000),
  kernel_version text not null check (btrim(kernel_version) <> ''),
  activity_digest text not null,
  risk_digest text not null,

  -- What was simulated over, so a thin run is visible as a thin run.
  activity_count int not null check (activity_count > 0),
  sampled_range_count int not null check (sampled_range_count >= 0),
  risk_link_count int not null check (risk_link_count >= 0),

  -- The gate verdict AT THE TIME OF THE RUN, recorded rather than assumed:
  -- a schedule that later degrades does not retroactively invalidate the
  -- statement that this run was permitted when it was made.
  quality_score numeric not null,
  schedule_confidence numeric,

  -- Schedule, in hours off the same sorted sample.
  deterministic_hours numeric not null,
  p10_hours numeric not null,
  p50_hours numeric not null,
  p80_hours numeric not null,
  p90_hours numeric not null,
  probability_on_plan numeric,

  -- Schedule, as dates. Null when the plan carries no finish to shift.
  deterministic_finish timestamptz,
  p50_finish timestamptz,
  p80_finish timestamptz,

  -- Cost. The risk-driven EXPOSURE is always present when risks were
  -- simulated; the TOTAL percentiles exist only when a deterministic cost
  -- base does, because a "cost P80" that is only the risk half is not a cost
  -- forecast and must not be shown under that name.
  currency text,
  cost_base numeric,
  cost_exposure_p50 numeric,
  cost_exposure_p80 numeric,
  cost_p50 numeric,
  cost_p80 numeric,
  delay_cost_per_day numeric,

  -- The criticality index and the per-risk marginal attribution, as the
  -- kernel produced them.
  criticality jsonb not null default '[]'::jsonb
    check (jsonb_typeof(criticality) = 'array'),
  attribution jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attribution) = 'array'),
  refusals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(refusals) = 'array'),

  calculation_run_id uuid references calculation_runs(id) on delete set null,
  computed_by uuid references auth.users(id),
  computed_at timestamptz not null default now(),

  -- Percentiles off one sorted sample are non-decreasing by construction.
  -- A row that violates this did not come off a sample.
  constraint ssr_percentiles_ordered check (
    p10_hours <= p50_hours and p50_hours <= p80_hours and p80_hours <= p90_hours),
  constraint ssr_cost_ordered check (
    (cost_p50 is null and cost_p80 is null)
    or (cost_p50 is not null and cost_p80 is not null and cost_p50 <= cost_p80)),
  constraint ssr_exposure_ordered check (
    (cost_exposure_p50 is null and cost_exposure_p80 is null)
    or (cost_exposure_p50 is not null and cost_exposure_p80 is not null
        and cost_exposure_p50 <= cost_exposure_p80)),
  constraint ssr_finish_ordered check (
    (p50_finish is null and p80_finish is null)
    or (p50_finish is not null and p80_finish is not null and p50_finish <= p80_finish))
);

create index if not exists idx_ssr_case
  on schedule_simulation_runs(organization_id, development_case_id, computed_at desc);

alter table public.schedule_simulation_runs enable row level security;
drop policy if exists ssr_read on public.schedule_simulation_runs;
create policy ssr_read on public.schedule_simulation_runs
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: the door below is the only writer.

comment on table public.schedule_simulation_runs is
  'D5.15/D5.09/D5.07/D5.32: one recorded probability distribution per simulation — its seed, its iteration count, the digest of the exact inputs it consumed, the quality score that permitted it, its percentiles off the sorted sample, and the per-risk marginal attribution. Immutable. A P50/P80 anywhere in the product comes from a row here or is shown as ABSENT.';

-- ---------------------------------------------------------------------------
-- 5. IMMUTABILITY. INSERT (door only), UPDATE, DELETE, TRUNCATE.
--
--    Deletion is guarded as hard as mutation: a recorded distribution that
--    can be deleted is a forecast that can be un-made after it is quoted.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_schedule_simulation_run()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.schedule_simulation_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_case_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'schedule_simulation_runs holds every recorded distribution a P50/P80 was read off; truncating it un-makes every forecast in one statement, which no row-level guard can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if tg_op in ('UPDATE', 'DELETE') then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (v_org, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'A recorded schedule simulation was ' || lower(tg_op) || 'd by a service '
             'caller. The row states which seed, which inputs and which quality '
             'score produced a P80 somebody quoted (D5.07/D5.32).');
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception
      'a recorded simulation is immutable — it states what was simulated, from which inputs, under which seed, at an instant that has passed. Simulate again and a new run is recorded beside it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- INSERT
  if v_marker <> 'granted' then
    if v_client or current_user in ('authenticated', 'anon') then
      raise exception
        'a simulation result is recorded through record_case_schedule_simulation, which re-runs the quality gate and re-checks the input digest. A direct insert would put a P80 in the ledger with nothing behind it.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A schedule simulation was recorded by a service caller outside '
           'record_case_schedule_simulation, so neither the quality gate nor the '
           'input digest was checked for it (D5.15).');
    end if;
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this simulation is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_schedule_simulation_run() from public, anon, authenticated;

drop trigger if exists trg_schedule_simulation_run on public.schedule_simulation_runs;
create trigger trg_schedule_simulation_run
  before insert or update or delete on public.schedule_simulation_runs
  for each row execute function public.enforce_schedule_simulation_run();

drop trigger if exists trg_schedule_simulation_no_truncate on public.schedule_simulation_runs;
create trigger trg_schedule_simulation_no_truncate
  before truncate on public.schedule_simulation_runs
  for each statement execute function public.enforce_schedule_simulation_run();

revoke truncate on table public.schedule_simulation_runs from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. THE DOOR (D5.15, D5.09, D11.29).
--
--    Every refusal below fails the recording. There is no arm that records a
--    distribution "with a warning": the register's own words for this slice
--    are that a caveated P80 and a clean P80 are read identically.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_schedule_simulation(
  p_case_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_policy jsonb := sync_schedule_simulation_policy();
  v_quality jsonb;
  v_digest jsonb;
  v_chain jsonb;
  v_seed numeric;
  v_iterations int;
  v_iter_raw numeric;
  v_sample_raw numeric;
  v_kernel text := nullif(btrim(coalesce(p_result->>'kernelVersion','')), '');
  v_activity_count int;
  v_ranges int;
  v_risk_links int;
  v_det numeric;
  v_p10 numeric; v_p50 numeric; v_p80 numeric; v_p90 numeric;
  v_onplan numeric;
  v_sample int;
  v_finish timestamptz;
  v_p50_finish timestamptz;
  v_p80_finish timestamptz;
  v_cost_base numeric;
  v_currency text;
  v_exp50 numeric; v_exp80 numeric;
  v_cost50 numeric; v_cost80 numeric;
  v_rate numeric;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_attr jsonb := case when jsonb_typeof(p_result->'attribution') = 'array'
                       then p_result->'attribution' else '[]'::jsonb end;
  v_crit jsonb := case when jsonb_typeof(p_result->'criticality') = 'array'
                       then p_result->'criticality' else '[]'::jsonb end;
  v_id uuid;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70. The P80 is the number a sanction paper is written against.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording a probabilistic forecast is determining the exposure a sanction decision is taken against — the AI-operator identity cannot record one (spec §70). The AI may prepare the inputs and explain the result; a human records it.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a schedule simulation requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ── THE GATE, RE-RUN HERE (D5.15) ────────────────────────────────────────
  v_quality := get_case_schedule_quality(c.id);
  if coalesce((v_quality->'gate'->>'permitted')::boolean, false) = false then
    -- The refusal is RECORDED, not just returned: a simulation that was
    -- refused is a fact about this case's schedule and belongs in the ledger
    -- beside the ones that ran.
    v_run := record_calculation_run(
      c.id, 'case_schedule_simulation',
      'A Monte Carlo simulation was requested over this case''s schedule and was REFUSED before any result was accepted, because the schedule failed its §50 quality diagnostics. Spec II.6: "Monte Carlo on poor logic is not useful." The failing classes are recorded as the refusals of this run.',
      jsonb_build_object(
        'qualityScore', v_quality->'score',
        'minimumScore', v_quality->'gate'->'minimumScore',
        'activityCount', v_quality->'activityCount',
        'relationshipCount', v_quality->'relationshipCount'),
      '[]'::jsonb,
      null,
      jsonb_build_array(coalesce(v_quality->'gate'->>'refusal',
        'The schedule did not pass its quality diagnostics.'))
        || coalesce(v_quality->'gate'->'failingClasses', '[]'::jsonb)
        || coalesce(v_quality->'gate'->'notDiagnosableClasses', '[]'::jsonb));
    return jsonb_build_object('error', coalesce(v_quality->'gate'->>'refusal',
      'this schedule did not pass its quality diagnostics'),
      'failingClasses', v_quality->'gate'->'failingClasses',
      'notDiagnosableClasses', v_quality->'gate'->'notDiagnosableClasses',
      'qualityScore', v_quality->'score',
      'calculationRunId', v_run);
  end if;

  -- ── THE INPUTS WERE THE INPUTS ───────────────────────────────────────────
  v_digest := sync_case_schedule_digest(c.id);
  if coalesce(p_result->>'activityDigest','') <> (v_digest->>'activityDigest')
     or coalesce(p_result->>'riskDigest','') <> (v_digest->>'riskDigest') then
    return jsonb_build_object('error',
      'this result was computed over a different schedule than the one on record — the activity or risk digest does not match. Re-read the inputs and simulate again. A distribution accepted here would name inputs it never saw.');
  end if;

  -- ── REPRODUCIBILITY ──────────────────────────────────────────────────────
  v_seed := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'seed','')), ''));
  if v_seed is null or v_seed = 'NaN'::numeric or v_seed = 'Infinity'::numeric
     or v_seed = '-Infinity'::numeric or v_seed <> trunc(v_seed) or v_seed < 0
     -- mulberry32 takes a 32-bit seed (`seed >>> 0`), so a seed outside that
     -- range would be recorded as a number the kernel cannot be re-run with.
     or v_seed > 4294967295 then
    return jsonb_build_object('error',
      'a simulation records the seed it was run under (seed, a whole number between 0 and 4294967295 — the kernel''s generator takes a 32-bit seed). Without a seed the numbers cannot be reproduced, and a result nobody can reproduce is not evidence.');
  end if;
  v_iter_raw := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'iterations','')), ''));
  if v_iter_raw is null or v_iter_raw = 'NaN'::numeric or v_iter_raw = 'Infinity'::numeric
     or v_iter_raw <> trunc(v_iter_raw) or v_iter_raw < 0
     or v_iter_raw > (v_policy->>'maximumIterations')::numeric then
    return jsonb_build_object('error', format(
      'a simulation records how many iterations it ran, as a whole number no greater than the published maximum of %s (iterations)',
      v_policy->>'maximumIterations'));
  end if;
  v_iterations := v_iter_raw::int;
  if v_iterations < (v_policy->>'minimumIterations')::int then
    return jsonb_build_object('error', format(
      '%s iterations is below the published minimum of %s. Percentile noise at that sample size moves the reported P80 more than the risks do, so the number would be a property of the seed rather than of the project.',
      v_iterations, v_policy->>'minimumIterations'));
  end if;
  v_sample_raw := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'sampleCount','')), ''));
  v_sample := case when v_sample_raw is not null
                    and v_sample_raw = trunc(v_sample_raw)
                    and v_sample_raw >= 0
                    and v_sample_raw <= (v_policy->>'maximumIterations')::numeric
                   then v_sample_raw::int end;
  if coalesce(v_sample, -1) <> v_iterations then
    return jsonb_build_object('error', format(
      'the result declares %s iterations and a sorted sample of %s. Percentiles taken off a sample shorter than the run are percentiles of something else.',
      v_iterations, coalesce(v_sample::text, 'none')));
  end if;
  if v_kernel is null then
    return jsonb_build_object('error',
      'a simulation records which kernel produced it (kernelVersion) — a distribution whose code identity is unknown cannot be re-run');
  end if;

  -- ── THERE WAS SOMETHING TO SAMPLE ────────────────────────────────────────
  select count(*),
         count(*) filter (where t.optimistic_hours is not null
                            and t.pessimistic_hours is not null
                            and t.pessimistic_hours > t.optimistic_hours)
    into v_activity_count, v_ranges
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  select count(*) into v_risk_links from risk_schedule_impacts i
   where i.development_case_id = c.id;

  if v_ranges + v_risk_links < (v_policy->>'minimumSampledRanges')::int then
    return jsonb_build_object('error', format(
      'Nothing on this case varies. %s activity(ies) are recorded and NONE carries an optimistic and pessimistic duration, and no risk names an activity it threatens. A simulation over fixed durations reproduces the deterministic answer with a confidence interval of zero width, and the P80 it printed would equal the plan — a spread nobody estimated, wearing the authority of a simulation.',
      v_activity_count));
  end if;

  -- ── THE SHAPE OF A DISTRIBUTION ──────────────────────────────────────────
  v_det := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'deterministicHours','')), ''));
  v_p10 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'p10Hours','')), ''));
  v_p50 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'p50Hours','')), ''));
  v_p80 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'p80Hours','')), ''));
  v_p90 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'p90Hours','')), ''));
  if v_det is null or v_p10 is null or v_p50 is null or v_p80 is null or v_p90 is null then
    return jsonb_build_object('error',
      'a recorded distribution carries the deterministic duration and P10, P50, P80 and P90 off the same sorted sample. A missing percentile here becomes a blank cell on a forecast, and a blank cell where a P80 belongs is read as "no risk".');
  end if;
  if v_det = 'NaN'::numeric or v_p10 = 'NaN'::numeric or v_p50 = 'NaN'::numeric
     or v_p80 = 'NaN'::numeric or v_p90 = 'NaN'::numeric
     or v_det = 'Infinity'::numeric or v_p10 = 'Infinity'::numeric
     or v_p50 = 'Infinity'::numeric or v_p80 = 'Infinity'::numeric
     or v_p90 = 'Infinity'::numeric then
    return jsonb_build_object('error', 'a percentile must be a finite number of hours');
  end if;
  if not (v_p10 <= v_p50 and v_p50 <= v_p80 and v_p80 <= v_p90) then
    return jsonb_build_object('error', format(
      'the percentiles are not ordered (P10 %s, P50 %s, P80 %s, P90 %s). Percentiles off one sorted sample cannot cross, so these did not come off a sample.',
      v_p10, v_p50, v_p80, v_p90));
  end if;
  if v_p90 <= v_p10 then
    return jsonb_build_object('error', format(
      'P10 and P90 are both %s: the "distribution" has zero width. That is a deterministic answer with percentile labels on it, which is the one result this door exists to refuse.',
      v_p10));
  end if;
  v_onplan := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'probabilityOnPlan','')), ''));

  -- ── THE DATES. The simulation measures a DURATION; the calendar anchor is
  --    the plan's own latest planned finish, shifted by the overrun the
  --    simulation found. Stated on the number rather than assumed.
  select max(t.planned_finish) into v_finish
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  if v_finish is not null then
    v_p50_finish := v_finish
      + make_interval(secs => ((v_p50 - v_det) * 3600)::double precision);
    v_p80_finish := v_finish
      + make_interval(secs => ((v_p80 - v_det) * 3600)::double precision);
  else
    v_refusals := v_refusals || to_jsonb(
      'No activity on this case carries a planned finish, so the simulated overrun cannot be anchored to a calendar. The percentiles are reported in HOURS of duration; a P80 DATE would need a date to shift.'::text);
  end if;

  -- ── COST. Exposure is what was simulated; the total exists only when a
  --    deterministic base does.
  v_currency := nullif(btrim(coalesce(p_result->>'currency','')), '');
  v_cost_base := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costBase','')), ''));
  v_exp50 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costExposureP50','')), ''));
  v_exp80 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costExposureP80','')), ''));
  v_rate := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'delayCostPerDay','')), ''));

  if v_exp50 is not null and v_exp80 is not null then
    if v_exp50 = 'NaN'::numeric or v_exp80 = 'NaN'::numeric
       or v_exp50 = 'Infinity'::numeric or v_exp80 = 'Infinity'::numeric
       or v_exp50 < 0 or v_exp80 < v_exp50 then
      return jsonb_build_object('error', format(
        'the cost exposure percentiles are not a usable pair (P50 %s, P80 %s)', v_exp50, v_exp80));
    end if;
    if v_cost_base is not null and v_cost_base <> 'NaN'::numeric
       and v_cost_base <> 'Infinity'::numeric and v_cost_base <> '-Infinity'::numeric then
      v_cost50 := v_cost_base + v_exp50;
      v_cost80 := v_cost_base + v_exp80;
    else
      v_refusals := v_refusals || to_jsonb(
        'The total cost P50 and P80 are absent because this case has no deterministic cost forecast to add the simulated exposure to (the earned-value EAC refused). The RISK EXPOSURE percentiles below are real and are shown as exposure, not as a cost forecast: a "cost P80" made only of the risk half would be a forecast missing the project.'::text);
    end if;
  else
    v_refusals := v_refusals || to_jsonb(
      'No cost exposure was simulated: no risk edge on this case carries a direct cost impact and no cost of delay is recorded, so the simulation measured time only. Spec I.10''s chain runs risk → schedule → economics and this run stops at the schedule.'::text);
  end if;

  -- ── ATTRIBUTION (D5.09): every attributed risk must be an edge that
  --    exists, so a ranking cannot name a driver the simulation never saw.
  if jsonb_typeof(p_result->'attribution') not in ('array', 'null')
     and p_result ? 'attribution' then
    return jsonb_build_object('error',
      'attribution is an array of per-risk rows, or it is absent — a scalar there is a ranking with no rows in it');
  end if;
  if jsonb_array_length(v_attr) > (v_policy->>'maximumAttributedRisks')::int then
    return jsonb_build_object('error', format(
      'this result attributes the spread to %s risks; the published maximum is %s',
      jsonb_array_length(v_attr), v_policy->>'maximumAttributedRisks'));
  end if;
  for rec in select value as row from jsonb_array_elements(v_attr) loop
    if not exists (select 1 from risk_schedule_impacts i
                    where i.development_case_id = c.id
                      and i.risk_id::text = rec.row->>'riskId') then
      return jsonb_build_object('error', format(
        'the attribution names risk %s, which has no recorded impact on this case''s schedule. A driver ranking that includes a risk the simulation never sampled is an assumed ordering wearing a computed one''s clothes.',
        coalesce(rec.row->>'riskId', '(null)')));
    end if;
  end loop;

  v_chain := get_case_risk_schedule_chain(c.id);
  if jsonb_array_length(coalesce(v_chain->'unlinkedRisks','[]'::jsonb)) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      'This distribution excludes %s open risk(s) that name no schedule activity: %s. The P80 understates exposure by exactly them.',
      jsonb_array_length(v_chain->'unlinkedRisks'),
      (select string_agg(value->>'riskTitle', '; ')
         from jsonb_array_elements(v_chain->'unlinkedRisks')))::text);
  end if;
  if v_ranges < v_activity_count then
    v_refusals := v_refusals || to_jsonb(format(
      '%s of %s activity(ies) carry no duration range and were held FIXED in every iteration. Their contribution to the spread is understated, not zero.',
      v_activity_count - v_ranges, v_activity_count)::text);
  end if;
  if jsonb_array_length(coalesce(v_quality->'gate'->'notDiagnosableClasses','[]'::jsonb)) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      'The gate passed on the classes it could diagnose. These could NOT be diagnosed and therefore neither passed nor failed: %s.',
      (select string_agg(value #>> '{}', ', ')
         from jsonb_array_elements(v_quality->'gate'->'notDiagnosableClasses')))::text);
  end if;

  -- ── RECORD ───────────────────────────────────────────────────────────────
  v_outputs := jsonb_build_object(
    'seed', v_seed,
    'iterations', v_iterations,
    'kernelVersion', v_kernel,
    'qualityScore', v_quality->'score',
    'scheduleConfidence', v_quality->'confidence',
    'deterministicHours', v_det,
    'p10Hours', v_p10, 'p50Hours', v_p50, 'p80Hours', v_p80, 'p90Hours', v_p90,
    'probabilityOnPlan', v_onplan,
    'deterministicFinish', v_finish,
    'p50Finish', v_p50_finish, 'p80Finish', v_p80_finish,
    'currency', v_currency,
    'costBase', v_cost_base,
    'costExposureP50', v_exp50, 'costExposureP80', v_exp80,
    'costP50', v_cost50, 'costP80', v_cost80,
    'activityCount', v_activity_count,
    'sampledRangeCount', v_ranges,
    'riskLinkCount', v_risk_links,
    'attributedRiskCount', jsonb_array_length(v_attr),
    'activityDigest', v_digest->'activityDigest',
    'riskDigest', v_digest->'riskDigest');

  v_run := record_calculation_run(
    c.id,
    'case_schedule_simulation',
    format('An integrated risk-cost-schedule Monte Carlo over this case''s schedule activities and the risks that name them, run by the %s kernel at seed %s for %s iterations and PERMITTED by a §50 Schedule Quality Score of %s. Activity durations are sampled triangularly from the optimistic/most-likely/pessimistic ranges recorded on them; each risk occurs or does not according to its own recorded probability and, when it occurs, adds a triangularly sampled delay to the activity it names. Percentiles are taken off the sorted sample of simulated project durations. Per-risk attribution is MARGINAL: the same seed and iteration count re-run with one risk suppressed, so the ranking comes out of the simulation rather than out of an assumed ordering. The kernel is deterministic given these inputs and this seed; the server pinned the inputs by digest and did not re-execute the sampler.',
      v_kernel, v_seed, v_iterations, v_quality->>'score'),
    jsonb_build_object(
      'seed', v_seed,
      'iterations', v_iterations,
      'kernelVersion', v_kernel,
      'activityDigest', v_digest->'activityDigest',
      'riskDigest', v_digest->'riskDigest',
      'activityCount', v_activity_count,
      'sampledRangeCount', v_ranges,
      'riskLinkCount', v_risk_links,
      'qualityScore', v_quality->'score',
      'delayCostPerDay', v_rate,
      'costBase', v_cost_base),
    (coalesce((select jsonb_agg(jsonb_build_object('table', 'shutdown_tasks', 'id', t.id))
                 from shutdown_tasks t
                 join shutdown_events e on e.id = t.event_id
                where e.organization_id = c.organization_id
                  and e.development_case_id = c.id), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'risk_schedule_impacts', 'id', i.id))
                    from risk_schedule_impacts i
                   where i.development_case_id = c.id), '[]'::jsonb)),
    v_outputs,
    v_refusals);

  perform set_config('app.schedule_simulation_write', 'granted', true);
  insert into schedule_simulation_runs
    (organization_id, development_case_id, seed, iterations, kernel_version,
     activity_digest, risk_digest, activity_count, sampled_range_count, risk_link_count,
     quality_score, schedule_confidence,
     deterministic_hours, p10_hours, p50_hours, p80_hours, p90_hours, probability_on_plan,
     deterministic_finish, p50_finish, p80_finish,
     currency, cost_base, cost_exposure_p50, cost_exposure_p80, cost_p50, cost_p80,
     delay_cost_per_day, criticality, attribution, refusals,
     calculation_run_id, computed_by)
  values
    (v_org, c.id, v_seed::bigint, v_iterations, v_kernel,
     v_digest->>'activityDigest', v_digest->>'riskDigest',
     v_activity_count, v_ranges, v_risk_links,
     (v_quality->>'score')::numeric, (v_quality->>'confidence')::numeric,
     v_det, v_p10, v_p50, v_p80, v_p90, v_onplan,
     v_finish, v_p50_finish, v_p80_finish,
     v_currency, v_cost_base, v_exp50, v_exp80, v_cost50, v_cost80,
     v_rate, v_crit, v_attr, v_refusals,
     v_run, auth.uid())
  returning id into v_id;
  perform set_config('app.schedule_simulation_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_simulation', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'simulation_id', v_id,
      'calculation_run_id', v_run, 'seed', v_seed, 'iterations', v_iterations),
    null,
    jsonb_build_object('qualityScore', v_quality->'score', 'p50Hours', v_p50,
      'p80Hours', v_p80, 'p80Finish', v_p80_finish, 'costP80', v_cost80,
      'refusalCount', jsonb_array_length(v_refusals)));

  return jsonb_build_object('simulation_id', v_id, 'calculation_run_id', v_run,
    'case_id', c.id, 'seed', v_seed, 'iterations', v_iterations,
    'p50Hours', v_p50, 'p80Hours', v_p80, 'p80Finish', v_p80_finish,
    'costP80', v_cost80, 'refusals', v_refusals);
end
$$;

revoke all on function public.record_case_schedule_simulation(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_case_schedule_simulation(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. THE READ. The latest recorded distribution, and — the load-bearing part
--    — whether it is STILL ABOUT THIS SCHEDULE.
--
--    A simulation whose input digest no longer matches the live schedule is
--    reported as STALE and its percentiles are NOT offered as current. The
--    4B convention (a figure comes from the recorded run; a run whose
--    fingerprint moved is labelled stale) applied to the one figure where
--    showing a stale number would be worst: a P80 that a schedule change has
--    already invalidated is more dangerous than no P80, because it is
--    specific.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_schedule_simulation(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  s schedule_simulation_runs%rowtype;
  v_digest jsonb;
  v_current boolean;
  v_count int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*) into v_count from schedule_simulation_runs
   where organization_id = v_org and development_case_id = c.id;

  select * into s from schedule_simulation_runs
   where organization_id = v_org and development_case_id = c.id
   order by computed_at desc limit 1;

  if not found then
    return jsonb_build_object(
      'caseId', c.id, 'exists', false, 'runCount', 0, 'current', false,
      'refusal', 'No simulation has been recorded for this case, so there is no distribution and therefore no P50 and no P80. A percentile is a statement about a distribution; there is no arithmetic that produces one from a deterministic figure.');
  end if;

  v_digest := sync_case_schedule_digest(c.id);
  v_current := (s.activity_digest = v_digest->>'activityDigest')
               and (s.risk_digest = v_digest->>'riskDigest');

  return jsonb_build_object(
    'caseId', c.id,
    'exists', true,
    'runCount', v_count,
    'id', s.id,
    'current', v_current,
    'seed', s.seed,
    'iterations', s.iterations,
    'kernelVersion', s.kernel_version,
    'qualityScore', s.quality_score,
    'scheduleConfidence', s.schedule_confidence,
    'activityCount', s.activity_count,
    'sampledRangeCount', s.sampled_range_count,
    'riskLinkCount', s.risk_link_count,
    'deterministicHours', s.deterministic_hours,
    'p10Hours', s.p10_hours, 'p50Hours', s.p50_hours,
    'p80Hours', s.p80_hours, 'p90Hours', s.p90_hours,
    'probabilityOnPlan', s.probability_on_plan,
    'deterministicFinish', s.deterministic_finish,
    'p50Finish', s.p50_finish, 'p80Finish', s.p80_finish,
    'currency', s.currency,
    'costBase', s.cost_base,
    'costExposureP50', s.cost_exposure_p50, 'costExposureP80', s.cost_exposure_p80,
    'costP50', s.cost_p50, 'costP80', s.cost_p80,
    'delayCostPerDay', s.delay_cost_per_day,
    'criticality', s.criticality,
    'attribution', s.attribution,
    'refusals', s.refusals,
    'calculationRunId', s.calculation_run_id,
    'computedBy', (select email from user_profiles up where up.id = s.computed_by),
    'computedAt', s.computed_at,
    'staleReason', case when v_current then null else
      'The schedule or its risk edges have changed since this simulation was recorded, so its percentiles are no longer about the schedule on file. They are shown as a recorded past run and NOT offered as the current forecast — a P80 a schedule change has already invalidated is more dangerous than no P80, because it is specific. Simulate again.' end);
end
$$;

revoke all on function public.get_case_schedule_simulation(uuid) from public, anon, service_role;
grant execute on function public.get_case_schedule_simulation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. §51 FORECAST CONFIDENCE, NOW WITH THE PERCENTILES (D5.07, D5.32).
--
--    Replaces the 4B body (20261201090400). The deterministic halves are
--    UNCHANGED — the earned-value EAC with its formula named, the recorded
--    bottom-up forecast total BESIDE it, the latest planned finish, both
--    confidence bands travelling with the numbers, and spec I.9's "original
--    sanction" comparison still refused because this repository records no
--    baselined completion DATE.
--
--    What changes is that P50 and P80 are now supplied FROM A RECORDED
--    SIMULATION when a current one exists, and are still ABSENT — in the same
--    words 4B used, extended with what is now missing — when one does not.
--    There is no branch here that derives a percentile from a deterministic
--    figure, and the slice test asserts there is none in the SQL either.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_forecast_confidence(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_ev jsonb;
  v_confidence jsonb;
  v_integrity jsonb;
  v_sim jsonb;
  v_quality jsonb;
  v_eac numeric;
  v_eac_refusal text;
  v_currency text;
  v_recorded_forecast numeric;
  v_forecast_lines int := 0;
  v_line_count int := 0;
  v_finish timestamptz;
  v_activity_count int := 0;
  v_dated int := 0;
  v_ranged int := 0;
  v_schedule_refusal text;
  v_no_distribution text;
  v_have boolean := false;
  v_cost_p50 numeric; v_cost_p80 numeric;
  v_p50_finish timestamptz; v_p80_finish timestamptz;
  v_drivers jsonb;
  v_cost_refusal text;
  v_sched_pct_refusal text;
  v_drivers_refusal text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_ev := get_case_earned_value(c.id);
  v_confidence := estimate_confidence_rating(c.id);
  v_integrity := get_case_progress_integrity(c.id);
  v_sim := get_case_schedule_simulation(c.id);
  v_quality := get_case_schedule_quality(c.id);

  v_currency := nullif(v_ev->>'currency', '');
  v_eac := (v_ev->'metrics'->'eac'->>'value')::numeric;
  v_eac_refusal := v_ev->'metrics'->'eac'->>'refusal';

  select count(*), count(*) filter (where ci.forecast is not null),
         sum(ci.forecast)
    into v_line_count, v_forecast_lines, v_recorded_forecast
  from project_cost_items ci where ci.development_case_id = c.id;
  if coalesce(v_forecast_lines, 0) = 0 then
    v_recorded_forecast := null;
  elsif v_recorded_forecast is not null
        and (v_recorded_forecast = 'NaN'::numeric or v_recorded_forecast = 'Infinity'::numeric
             or v_recorded_forecast = '-Infinity'::numeric) then
    v_recorded_forecast := null;
  end if;

  select count(*),
         count(*) filter (where t.planned_finish is not null),
         count(*) filter (where t.optimistic_hours is not null
                            and t.pessimistic_hours is not null
                            and t.pessimistic_hours > t.optimistic_hours),
         max(t.planned_finish)
    into v_activity_count, v_dated, v_ranged, v_finish
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  if coalesce(v_activity_count, 0) = 0 then
    v_schedule_refusal :=
      'No schedule activity is recorded on this case, so there is no completion date to forecast. A date stated without a schedule behind it is a target somebody named, not a forecast.';
  elsif coalesce(v_dated, 0) = 0 then
    v_schedule_refusal := format(
      '%s schedule activity(ies) are recorded on this case and none carries a planned finish. There is a schedule and no date to read off it.',
      v_activity_count);
  end if;

  -- ── IS THERE A DISTRIBUTION? ─────────────────────────────────────────────
  v_have := coalesce((v_sim->>'exists')::boolean, false)
            and coalesce((v_sim->>'current')::boolean, false);

  if v_have then
    v_cost_p50 := (v_sim->>'costP50')::numeric;
    v_cost_p80 := (v_sim->>'costP80')::numeric;
    v_p50_finish := (v_sim->>'p50Finish')::timestamptz;
    v_p80_finish := (v_sim->>'p80Finish')::timestamptz;
    -- §51's "critical drivers": the ranked per-risk marginal contribution
    -- when there is one, and the criticality index when the run had no risk
    -- edges. Both come OUT of the simulation.
    if jsonb_array_length(coalesce(v_sim->'attribution', '[]'::jsonb)) > 0 then
      v_drivers := v_sim->'attribution';
    elsif jsonb_array_length(coalesce(v_sim->'criticality', '[]'::jsonb)) > 0 then
      v_drivers := v_sim->'criticality';
      v_drivers_refusal :=
        'No risk on this case names the schedule activity it threatens, so the drivers below are the CRITICALITY INDEX — how often each activity landed on the critical path across the run — rather than a per-risk attribution. That is a statement about the schedule, not about the risk register.';
    else
      v_drivers_refusal :=
        'The recorded simulation produced no driver ranking.';
    end if;

    if v_cost_p50 is null then
      v_cost_refusal := coalesce(
        (select string_agg(value #>> '{}', ' ') from jsonb_array_elements(v_sim->'refusals')
          where value #>> '{}' like 'The total cost P50%'
             or value #>> '{}' like 'No cost exposure%'),
        'The recorded simulation produced no total cost percentiles.');
    end if;
    if v_p50_finish is null then
      v_sched_pct_refusal :=
        'The recorded simulation produced percentiles in HOURS of duration but no P50/P80 DATE, because no activity on this case carries a planned finish to shift. The duration percentiles are real and are shown as hours.';
    end if;
  end if;

  -- ── THE ABSENCE, WHEN THERE IS ONE. 4B's words, extended. ────────────────
  v_no_distribution := case
    when v_have then null
    when coalesce((v_sim->>'exists')::boolean, false)
         and coalesce((v_sim->>'current')::boolean, false) = false then
      coalesce(v_sim->>'staleReason', 'The recorded simulation is stale.')
      || ' Until it is re-run, this forecast has a deterministic figure and no percentiles.'
    else
      -- BOTH HALVES, ALWAYS. The DATA state and the GATE state answer different
      -- questions — "is there anything to sample?" and "may it be sampled?" —
      -- and a reader with one activity and no range needs both. An earlier
      -- draft returned whichever it hit first, so a sparse schedule reported
      -- only that it failed the gate and stopped naming the missing range,
      -- which is the specific-refusal-becomes-a-shrug failure one level down.
      format(
        'No probability distribution is recorded for this case, so there is no P50 and no P80 — for cost or for schedule. A P80 is a statement about a distribution, not a deterministic figure with a margin on it, and there is no arithmetic that converts one into the other: printing "deterministic x 1.15" here would look exactly like every other P80 a reader has seen while nothing on the screen revealed that no simulation ever ran. The deterministic figures beside this note are real, derived and lineage-backed; the percentiles are absent, and absent is what they are shown as. %s%s',
        case
          when coalesce(v_activity_count, 0) = 0 then
            'This case has no schedule activities, so a schedule simulation would have nothing to sample either.'
          when coalesce(v_ranged, 0) = 0 then
            format('None of this case''s %s schedule activity(ies) carries an optimistic and pessimistic duration, so there is no range to sample: a single-point duration expresses a certainty the estimate does not have.',
                   v_activity_count)
          else
            format('%s of this case''s %s schedule activity(ies) carry an optimistic and pessimistic duration, so there IS something to sample.',
                   v_ranged, v_activity_count)
        end,
        case
          when coalesce(v_activity_count, 0) = 0 then ''
          when coalesce((v_quality->'gate'->>'permitted')::boolean, false) = false then
            format(' And this case''s schedule does not pass its §50 quality diagnostics, so a simulation over it is REFUSED rather than run with a caveat (D5.15, spec II.6: "Monte Carlo on poor logic is not useful"). %s',
                   coalesce(v_quality->'gate'->>'refusal', ''))
          else
            ' The schedule passes its quality gate and the binding into the simulation kernel exists, so this forecast can be given percentiles — nobody has run the simulation yet.'
        end)
  end;

  return jsonb_build_object(
    'caseId', c.id,
    'cost', jsonb_build_object(
      'currency', coalesce(v_currency, v_sim->>'currency'),
      'deterministic', v_eac,
      'deterministicLabel', 'Estimate at completion',
      'deterministicFormula', v_ev->'eacFormula',
      'deterministicRefusal', v_eac_refusal,
      'recordedForecastTotal', v_recorded_forecast,
      'recordedForecastLineCount', v_forecast_lines,
      'costLineCount', v_line_count,
      'recordedForecastNote', case
        when v_recorded_forecast is null then
          'No cost line on this case carries a forecast figure, so there is no bottom-up forecast to show beside the derived one.'
        else
          'This is the sum of the forecast column on the coded cost lines — what the team expects to spend, typed line by line. It is shown BESIDE the earned-value estimate at completion, which is derived from performance to date, because they are two different statements and a screen that showed one under the other''s label would have silently chosen between them.'
        end,
      'p50', v_cost_p50,
      'p80', v_cost_p80,
      'exposureP50', case when v_have then (v_sim->>'costExposureP50')::numeric end,
      'exposureP80', case when v_have then (v_sim->>'costExposureP80')::numeric end,
      'percentileRefusal', coalesce(v_no_distribution, v_cost_refusal,
        'These percentiles came off the recorded simulation named below — the deterministic figure beside them was not used to produce them.')),
    'schedule', jsonb_build_object(
      'deterministicFinish', v_finish,
      'deterministicRefusal', v_schedule_refusal,
      'activityCount', v_activity_count,
      'activitiesWithPlannedFinish', v_dated,
      'activitiesWithDurationRange', v_ranged,
      'p50Finish', v_p50_finish,
      'p80Finish', v_p80_finish,
      'deterministicHours', case when v_have then (v_sim->>'deterministicHours')::numeric end,
      'p50Hours', case when v_have then (v_sim->>'p50Hours')::numeric end,
      'p80Hours', case when v_have then (v_sim->>'p80Hours')::numeric end,
      'probabilityOnPlan', case when v_have then (v_sim->>'probabilityOnPlan')::numeric end,
      'percentileRefusal', coalesce(v_no_distribution, v_sched_pct_refusal,
        'These percentiles came off the recorded simulation named below — the deterministic finish beside them was not used to produce them.'),
      'criticalDrivers', v_drivers,
      'criticalDriversRefusal', coalesce(v_no_distribution, v_drivers_refusal,
        'The drivers below are the per-risk marginal contribution measured by the recorded simulation: the same run, at the same seed, re-executed with each risk suppressed.')),
    'againstSanction', null,
    'againstSanctionRefusal',
      'This repository records approved baselines and what each controls structure contained at approval; it does not record a baselined COMPLETION DATE. The comparison spec I.9 asks for ("original sanction May 1") is therefore refused rather than computed against the baseline''s approval timestamp, which is the day somebody signed and not the day the work was meant to end.',
    'estimateConfidence', v_confidence,
    'progressConfidence', jsonb_build_object(
      'band', v_integrity->'confidence',
      'coverage', v_integrity->'coverage',
      'headline', v_integrity->'headline',
      'refusal', v_integrity->'refusal'),
    -- §51's fourth field for the PERCENTILES specifically: how much the
    -- schedule these percentiles came off is worth (D5.14).
    'scheduleConfidence', jsonb_build_object(
      'score', v_quality->'confidence',
      'qualityScore', v_quality->'score',
      'refusal', v_quality->'confidenceRefusal'),
    'simulation', jsonb_build_object(
      'exists', coalesce((v_sim->>'exists')::boolean, false),
      'current', coalesce((v_sim->>'current')::boolean, false),
      'id', v_sim->'id',
      'seed', v_sim->'seed',
      'iterations', v_sim->'iterations',
      'kernelVersion', v_sim->'kernelVersion',
      'computedAt', v_sim->'computedAt',
      'computedBy', v_sim->'computedBy',
      'calculationRunId', v_sim->'calculationRunId',
      'refusals', coalesce(v_sim->'refusals', '[]'::jsonb),
      'staleReason', v_sim->'staleReason'),
    'distribution', jsonb_build_object(
      'exists', v_have,
      'reason', coalesce(v_no_distribution, format(
        'A simulation is recorded and is still about this schedule: %s iterations at seed %s under kernel %s, permitted by a §50 quality score of %s. The percentiles above came off its sorted sample.',
        v_sim->>'iterations', v_sim->>'seed', v_sim->>'kernelVersion', v_sim->>'qualityScore'))),
    'evaluable', (v_eac is not null or v_finish is not null or v_recorded_forecast is not null));
end
$$;

revoke all on function public.get_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.get_case_forecast_confidence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The forecast recorder gains the percentiles it used to refuse.
--    Replaces the 4B body: the refusals it records are now the ones that are
--    actually true of this case, and `distributionExists` is no longer
--    hardcoded false.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_forecast_confidence(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_fc jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing forecast confidence requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_fc := get_case_forecast_confidence(c.id);
  if v_fc ? 'error' then
    return v_fc;
  end if;

  -- Whatever is absent is recorded as absent, every time — including, when a
  -- distribution DOES exist, the caveats the simulation itself recorded.
  if v_fc->'cost'->>'percentileRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_fc->'cost'->>'percentileRefusal');
  end if;
  if v_fc->'schedule'->>'percentileRefusal' is not null
     and v_fc->'schedule'->>'percentileRefusal' is distinct from v_fc->'cost'->>'percentileRefusal' then
    v_refusals := v_refusals || to_jsonb(v_fc->'schedule'->>'percentileRefusal');
  end if;
  v_refusals := v_refusals || to_jsonb(v_fc->>'againstSanctionRefusal');
  if v_fc->'schedule'->>'criticalDriversRefusal' is not null
     and v_fc->'schedule'->>'criticalDriversRefusal'
         is distinct from v_fc->'cost'->>'percentileRefusal' then
    v_refusals := v_refusals || to_jsonb(v_fc->'schedule'->>'criticalDriversRefusal');
  end if;
  if v_fc->'cost'->>'deterministicRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_fc->'cost'->>'deterministicRefusal');
  end if;
  if v_fc->'schedule'->>'deterministicRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_fc->'schedule'->>'deterministicRefusal');
  end if;
  if coalesce(v_fc->'estimateConfidence'->>'band', 'unrated') = 'unrated' then
    v_refusals := v_refusals || to_jsonb(
      coalesce(v_fc->'estimateConfidence'->>'refusal',
        'No estimate basis is recorded, so this forecast is UNRATED.')::text);
  end if;
  if v_fc->'progressConfidence'->>'band' is null then
    v_refusals := v_refusals || to_jsonb(
      coalesce(v_fc->'progressConfidence'->>'refusal',
        'The progress this forecast rests on has not been cross-checked against independent evidence (D5.20).')::text);
  end if;
  -- A distribution's own caveats travel with the forecast that quotes it.
  v_refusals := v_refusals || coalesce(v_fc->'simulation'->'refusals', '[]'::jsonb);

  if coalesce((v_fc->>'evaluable')::boolean, false) = false then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'currency', v_fc->'cost'->'currency',
      'costDeterministic', v_fc->'cost'->'deterministic',
      'costDeterministicFormula', v_fc->'cost'->'deterministicFormula',
      'costRecordedForecastTotal', v_fc->'cost'->'recordedForecastTotal',
      'costP50', coalesce(v_fc->'cost'->'p50', 'null'::jsonb),
      'costP80', coalesce(v_fc->'cost'->'p80', 'null'::jsonb),
      'costExposureP50', coalesce(v_fc->'cost'->'exposureP50', 'null'::jsonb),
      'costExposureP80', coalesce(v_fc->'cost'->'exposureP80', 'null'::jsonb),
      'scheduleDeterministicFinish', v_fc->'schedule'->'deterministicFinish',
      'scheduleP50Finish', coalesce(v_fc->'schedule'->'p50Finish', 'null'::jsonb),
      'scheduleP80Finish', coalesce(v_fc->'schedule'->'p80Finish', 'null'::jsonb),
      'scheduleP50Hours', coalesce(v_fc->'schedule'->'p50Hours', 'null'::jsonb),
      'scheduleP80Hours', coalesce(v_fc->'schedule'->'p80Hours', 'null'::jsonb),
      'distributionExists', v_fc->'distribution'->'exists',
      'simulationId', coalesce(v_fc->'simulation'->'id', 'null'::jsonb),
      'simulationSeed', coalesce(v_fc->'simulation'->'seed', 'null'::jsonb),
      'simulationIterations', coalesce(v_fc->'simulation'->'iterations', 'null'::jsonb),
      'scheduleConfidence', coalesce(v_fc->'scheduleConfidence'->'score', 'null'::jsonb),
      'estimateConfidenceBand', coalesce(v_fc->'estimateConfidence'->'band', to_jsonb('unrated'::text)),
      'progressConfidenceBand', coalesce(v_fc->'progressConfidence'->'band', 'null'::jsonb));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_forecast_confidence',
    'The §51 forecast presentation: the deterministic cost figure is the earned-value estimate at completion (EAC = BAC/CPI) with the recorded bottom-up forecast total shown beside it, and the deterministic schedule figure is the latest planned finish across the case''s schedule activities. P50 and P80 are read off a RECORDED SIMULATION (schedule_simulation_runs) when one exists and its input digest still matches this schedule; where there is none, or the recorded one is stale, they are recorded as ABSENT with the reason, because a percentile derived from a deterministic figure would be a spread nobody simulated.',
    jsonb_build_object(
      'costLineCount', v_fc->'cost'->'costLineCount',
      'forecastLineCount', v_fc->'cost'->'recordedForecastLineCount',
      'activityCount', v_fc->'schedule'->'activityCount',
      'activitiesWithDurationRange', v_fc->'schedule'->'activitiesWithDurationRange',
      'distributionExists', v_fc->'distribution'->'exists',
      'simulationId', coalesce(v_fc->'simulation'->'id', 'null'::jsonb),
      'estimateConfidenceBand', coalesce(v_fc->'estimateConfidence'->'band', to_jsonb('unrated'::text))),
    (coalesce((select jsonb_agg(jsonb_build_object('table', 'project_cost_items', 'id', ci.id))
                 from project_cost_items ci where ci.development_case_id = c.id), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'shutdown_tasks', 'id', t.id))
                    from shutdown_tasks t
                    join shutdown_events e on e.id = t.event_id
                   where e.organization_id = c.organization_id
                     and e.development_case_id = c.id), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'schedule_simulation_runs', 'id', sr.id))
                    from schedule_simulation_runs sr
                   where sr.development_case_id = c.id
                     and sr.id::text = v_fc->'simulation'->>'id'), '[]'::jsonb)),
    v_outputs,
    v_refusals);

  return v_fc || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_forecast_confidence'));
end
$$;

revoke all on function public.compute_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.compute_case_forecast_confidence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. THE ONE PERFORMANCE READ grows the schedule family. 4A/4B shape
--     exactly: live reads for refusals, row listings and staleness; every
--     FIGURE from `latestCalculations`, which are recorded runs.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_performance(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_latest jsonb := '{}'::jsonb;
  k text;
  r calculation_runs%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  foreach k in array array['case_earned_value','case_progress_integrity',
                           'case_estimate_confidence','case_forecast_confidence',
                           'case_performance_trend','case_schedule_quality',
                           'case_risk_schedule_economics','case_schedule_simulation']
  loop
    select * into r from calculation_runs
     where development_case_id = c.id and calculation_key = k
     order by computed_at desc limit 1;
    if found then
      v_latest := v_latest || jsonb_build_object(k, jsonb_build_object(
        'id', r.id, 'calculationKey', r.calculation_key, 'method', r.method,
        'codeVersion', r.code_version, 'inputs', r.inputs, 'inputRefs', r.input_refs,
        'outputs', r.outputs, 'refusals', r.refusals, 'status', r.status,
        'computedAt', r.computed_at,
        'computedBy', (select email from user_profiles up where up.id = r.computed_by)));
    end if;
  end loop;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'progress', get_case_progress(c.id),
    'estimateBasis', get_case_estimate_basis(c.id),
    'earnedValue', get_case_earned_value(c.id),
    'progressIntegrity', get_case_progress_integrity(c.id),
    'forecastConfidence', get_case_forecast_confidence(c.id),
    'trend', get_case_performance_trend(c.id),
    'scheduleQuality', get_case_schedule_quality(c.id),
    'riskScheduleChain', get_case_risk_schedule_chain(c.id),
    'simulation', get_case_schedule_simulation(c.id),
    'latestCalculations', v_latest,
    'notInThisSlice', jsonb_build_array(
      'A baselined completion DATE to compare the forecast against (spec I.9''s "original sanction"): the controls baseline captures structures, not milestones, so the comparison is refused rather than computed against an approval timestamp.',
      'Contingency drawdown governance (D5.18, spec II.8): the contingency column and its mandatory basis exist on the cost line; the drawdown ledger does not.',
      'Productivity and milestone-confidence metrics (spec I.8): they need recorded quantities and dates per activity, which arrive with the workface-planning family.',
      'Correlation between risks: every risk edge is sampled independently. Two risks with a common cause will be understated by this run, and the simulation says so rather than modelling a correlation nobody has estimated.',
      'Resource-constrained simulation: the network is sampled against its logic, not against crew availability. A schedule that is logically achievable and unresourceable simulates as achievable.'));
end
$$;

revoke all on function public.get_case_performance(uuid) from public, anon, service_role;
grant execute on function public.get_case_performance(uuid) to authenticated;

notify pgrst, 'reload schema';
