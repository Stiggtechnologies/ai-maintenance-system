-- ============================================================================
-- Sync Develop — Slice 4C REPAIR (D5.07, D5.08, D5.09, D5.13, D5.15, D5.31,
-- D5.32, D5.28, D11.29).
--
-- 20261202090000/090100/090200 built the schedule-quality diagnostics, the
-- risk→schedule→economics chain and the gated Monte Carlo. Adversarial review
-- of that work found the same defect in eleven different places: the DOOR
-- validated the shape of what a client sent and then trusted its CONTENT, and
-- the READ vouched for the result afterwards in words the server had never
-- checked. This migration closes that class. The rulings, in order:
--
-- R1. A NUMBER THE SERVER CAN DERIVE IS NEVER ACCEPTED FROM THE CLIENT.
--     `costBase`, `currency` and `delayCostPerDay` were taken verbatim off
--     `p_result`. A planner-role token could POST costBase = 999,999,999 on a
--     case whose earned-value EAC REFUSES, and §51 printed a billion-dollar
--     cost P80 under the sentence "these percentiles came off the recorded
--     simulation". That is 4B's deliberate EAC refusal defeated by a POST
--     body. All three are now READ SERVER-SIDE from the canonical function
--     that owns them, and a submitted value that disagrees is refused by name
--     rather than silently overwritten — a client whose inputs have drifted
--     must re-read them, because a result computed against a different cost
--     base is a different result.
--
-- R2. A NUMBER THE SERVER CANNOT DERIVE IS BOUNDED BY SOMETHING IT CAN.
--     `deterministicHours` is the sole anchor of the published P50/P80 DATES
--     (`p50_finish := planned_finish + (p50 - deterministic)`), and it had no
--     check at all: `deterministicHours: 99999` on a 1460-hour network was
--     accepted and produced a "P80 completion date" eleven years before the
--     plan's own finish. Sync deliberately does NOT recompute the network in
--     SQL (090000 ruling R4: a second critical path beside the kernel's), so
--     the bound used here needs no CPM and is true of every network: a path
--     through it is at least as long as its longest activity and at most as
--     long as all of them end to end. `max(duration) <= deterministic <=
--     sum(duration)` kills every fabricated anchor without inventing a
--     second answer to the question the kernel already answers.
--
-- R3. THE GATE IS CHECKED WHERE THE NUMBER IS SERVED, NOT ONLY WHERE IT IS
--     RECORDED. D5.15 gated `record_case_schedule_simulation`. It did not
--     gate `get_case_forecast_confidence`, so a schedule that DEGRADED after
--     a simulation was recorded kept serving that simulation's P80 with
--     `current: true` and an affirmative statement of provenance. D5.32's
--     own evidence says the percentiles are absent when the schedule fails
--     its §50 gate; now they are.
--
-- R4. THE DIGEST COVERS EVERY INPUT THE RECORDED FIGURES DEPEND ON.
--     `planned_start`/`planned_finish` were outside it while the P50/P80
--     DATES were anchored to `max(planned_finish)` at record time and the
--     deterministic finish was read LIVE, so a re-dated schedule — the most
--     common schedule update there is — served a P80 date 78 days BEFORE the
--     deterministic finish, labelled current. The "cosmetic edits must not
--     mark runs stale" reasoning does not reach a date: a date change changes
--     an answer. The same argument adds the cost basis and the delay-cost
--     rate, which drive recorded money, and makes the risk half of the digest
--     follow the same open-risk population the chain reports on, so RETIRING
--     a risk moves the digest instead of leaving it silently sampled.
--
-- R5. THE KERNEL'S NETWORK IS THE NETWORK, OR THE RUN IS REFUSED.
--     `criticalPath` treats every edge as finish-to-start with zero lag; the
--     digest hashed `link_type` and `lag_hours`; and nothing reconciled them.
--     Changing one relationship from FS/0 to SS/120h produced byte-identical
--     percentiles under a different digest, ~46% high against the real logic.
--     Rather than grow a second CPM here, the simulation now REFUSES a case
--     carrying a stated non-FS link type or a non-zero lag, at the kernel AND
--     at the door, and says so. Where a relationship states NO type the CPM's
--     finish-to-start reading is an assumption, so it is disclosed as a
--     refusal on the recorded run rather than passed over in silence.
--
-- R6. §70 REACHES EVERY ACT THAT DETERMINES THE FORECAST, NOT ONLY THE ONE
--     THAT PRINTS IT. `record_case_schedule_simulation` refused the
--     AI-operator identity; `record_local_schedule_activity`,
--     `record_local_schedule_relationship` and the three `compute_*`
--     recorders did not. Proven live: as `ai_admin`, authoring one relationship
--     moved `gate.permitted` from true to false, and `compute_case_schedule_
--     quality` recorded that verdict with `computed_by = <the AI identity>`.
--     §70's words are "no AI/system identity may approve a forecast, accept a
--     schedule, or record a quality judgement" — authoring the logic the gate
--     is computed over IS accepting a schedule, and recording the §50 score
--     IS recording a quality judgement. All five now refuse it by name.
--
-- R7. THE PERSISTENCE TRIGGER ENFORCES WHAT THE DOOR ENFORCES, FOR THE
--     CALLERS THAT GO ROUND THE DOOR. The audited service path on
--     `schedule_simulation_runs` admitted an INSERT with no lineage row, no
--     gate, nothing to sample and `computed_by` set to the AI identity — the
--     exact shape 20261123090500 was written to repair, reintroduced on a new
--     ledger. The INSERT arm now refuses all four for EVERY caller.
--
-- R8. A LEDGER THAT DECIDES THE GATE GETS THE WALL THE OTHER ONE GOT.
--     090000 promoted `shutdown_task_dependencies` into gate-determining
--     status (link type and lag feed four of the nine classes) and left it
--     with one SELECT policy, no trigger, and TRUNCATE granted to anon,
--     authenticated and service_role. Deleting a dependency clears an
--     open-ends finding exactly as editing `total_float_hours` clears a
--     negative-float one, and 090000's own reasoning about the second is the
--     reasoning for the first.
--
-- R9. THE ONE INPUT THAT SETS THE WIDTH OF THE P80 GETS A GOVERNED DOOR.
--     Nothing in the product ever wrote `optimistic_hours`/`pessimistic_hours`
--     — not the import, not `record_local_schedule_activity`, nothing. The
--     two columns that ARE the distribution were reachable only by superuser
--     SQL, which meant D5.14's "expressed uncertainty" component was
--     structurally pinned at zero for every customer (capping the Schedule
--     Confidence Score at 75) and the only P50/P80 the transcript proved came
--     off ranges a fixture had manufactured as `duration_hours * 0.8/1.6` —
--     a spread derived from a deterministic number, which is the first item
--     on this slice's forbidden list. `set_schedule_activity_duration_range`
--     is that door: role-checked, §70-walled, ordered, finite, bracketing the
--     stated duration, with a MANDATORY basis and an audit row, on the same
--     reasoning `record_risk_schedule_impact` already applies to the risk's
--     three-point delay ("the number a P80 is built on").
--
-- R10. A RECORDED SENTENCE STATES WHAT THE SERVER CHECKED. The "no cost
--     exposure was simulated" refusal asserted that no risk edge carries a
--     cost and no cost of delay is recorded — while, on the case it was
--     written against, `financial_assumptions` held a rate with a source and
--     a risk edge held a 400,000 cost. A false sentence in an immutable
--     ledger is worse than no sentence. The branch now reads the real data
--     state, which it computes twenty-five lines later anyway.
--
-- WHAT THIS REPAIR DELIBERATELY DOES NOT DO, and why:
--
--   * NO RATE LIMIT on record_case_schedule_simulation. Review noted that a
--     planner-role user can loop the RPC, each call permanently writing a
--     simulation row, a calculation_runs row with an input_refs array
--     proportional to schedule size, and an audit_events row, on ledgers that
--     are immutable by design. The `criticality` payload — the one unbounded
--     part — is now bounded, and the sampler runs client-side so server CPU
--     per call is bounded too, which leaves storage amplification by an
--     authenticated insider. A per-user ceiling is a platform-wide policy with
--     a platform-wide home (every append-only ledger in this repository has
--     the same shape), and inventing one here would put the first one in the
--     door that happens to have been reviewed rather than in the place that
--     owns it. Named as an open item rather than half-solved.
--
--   * NO `force row level security`. Reviewed and REJECTED as a fix here: the
--     new tables follow the repository-wide convention (zero of the 40-plus
--     migrations from 20261120 onward force it), the owner is `postgres`, and
--     `pg_has_role` confirms none of `authenticator`, `authenticated` or `anon`
--     is a member of it — so there is no client path that FORCE would close.
--     Changing it on three tables and not the other ninety would be a change
--     that looks like a hardening and is a divergence.
--
-- Canonical reuse only: no new store, no second simulator, no sampler in SQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE DIGEST (R4). Dates in; cost basis in; the risk half follows the OPEN
--    risk population the chain reports.
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
  v_cost text;
  v_ev jsonb;
  v_rate jsonb;
begin
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
             -- R4. The calendar anchor of the published P50/P80 DATES, and
             -- the only input two of the nine defect classes have.
             || ':' || coalesce(t.planned_start::text, '-')
             || ':' || coalesce(t.planned_finish::text, '-')
             || ':' || coalesce((select string_agg(d.predecessor_key
                                   || '/' || coalesce(d.link_type, '-')
                                   || '/' || coalesce(d.lag_hours::text, '-'), ',' order by d.predecessor_key)
                                 from shutdown_task_dependencies d
                                 where d.event_id = t.event_id and d.task_key = t.task_key), '') as line
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
     where e.organization_id = (select organization_id from development_cases where id = p_case_id)
       and e.development_case_id = p_case_id) s;

  -- R4. Closed and archived risks are excluded here because they are excluded
  -- from the chain that feeds the kernel (see get_case_risk_schedule_chain
  -- below). If the two populations differed, retiring a risk would leave the
  -- recorded P80 sampling it for ever while the coverage note said otherwise.
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
      join risks r on r.id = i.risk_id
     where i.development_case_id = p_case_id
       and coalesce(r.status, '') not in ('closed', 'archived')) s;

  -- R4. The money half of a recorded run is the EAC plus the simulated
  -- exposure, and the exposure is priced off the delay-cost rate. Neither
  -- moved the digest, so claiming progress or editing a cost line left a
  -- recorded cost P80 "current" on a superseded base. The EAC's own
  -- `basisDigest` (4B, 20261201090300) is reused rather than re-derived here:
  -- one definition of "the cost inputs moved", read by both sides.
  v_ev := get_case_earned_value(p_case_id);
  v_rate := get_case_delay_cost_rate(p_case_id);
  v_cost := coalesce(v_ev->>'basisDigest', '-')
            || ':' || coalesce(v_ev->'metrics'->'eac'->>'value', '-')
            || ':' || coalesce(v_ev->>'currency', '-')
            || ':' || coalesce(v_rate->>'value', '-')
            || ':' || coalesce(v_rate->>'unit', '-');

  return jsonb_build_object(
    'activityDigest', md5(v_activities),
    'riskDigest', md5(v_risks),
    'costDigest', md5(v_cost));
end
$$;

revoke all on function public.sync_case_schedule_digest(uuid) from public, anon, service_role;
grant execute on function public.sync_case_schedule_digest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE PUBLISHED POLICY. Two additions and one honest comment.
-- ---------------------------------------------------------------------------
create or replace function public.sync_schedule_simulation_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'minimumIterations', 1000,
    'maximumIterations', 100000,
    -- What this floor GUARANTEES, stated as what it is rather than as the
    -- argument for a floor it is not: at least one input to the sample must
    -- actually vary, so a run over an entirely fixed network is refused. It
    -- does NOT guarantee the spread is broadly based — one ranged activity
    -- among forty fixed ones passes it. That case is disclosed instead of
    -- blocked: the run records, by name, how many activities were held fixed
    -- and that their contribution to the spread is understated, not zero.
    'minimumSampledRanges', 1,
    'maximumAttributedRisks', 50,
    -- The criticality array is an unbounded, client-supplied, permanently
    -- immutable payload on an append-only ledger. One row per activity is
    -- what the kernel produces; the cap is the same order as the activity
    -- cap the import door enforces.
    'maximumCriticalityRows', 5000,
    'kernelModule', 'src/lib/modelling/integrated-risk.ts',
    -- A kernel version is what makes a recorded distribution re-runnable. An
    -- unpinned free-text field made that guarantee unfalsifiable: the door
    -- accepted "totally-made-up-kernel" as the code identity of a forecast.
    -- Pinned here in the one place the thresholds are pinned, mirrored in
    -- TypeScript, and asserted equal by the slice test.
    'kernelVersions', jsonb_build_array('integrated-risk/4C/2026-12-02'));
$$;

revoke all on function public.sync_schedule_simulation_policy() from public, anon;
grant execute on function public.sync_schedule_simulation_policy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE CHAIN (D5.08): a CLOSED risk stops driving the P80.
--
--    `v_links` selected every impact edge regardless of the risk's status,
--    while `openRiskCount`, `unlinkedRisks` and every coverage sentence in the
--    same payload excluded closed and archived risks. A mitigated risk
--    therefore kept being sampled for ever, inflated the P80, and appeared in
--    §51's "Critical drivers" as a live driver — under a note that said all
--    OPEN risks were accounted for. There is deliberately no client delete on
--    this ledger (a retracted risk edge is history, not a mistake), so the
--    retirement path is the risk's OWN status, which is where a risk is
--    closed. The excluded edges are NAMED rather than silently dropped.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_risk_schedule_chain(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_links jsonb;
  v_rate jsonb;
  v_bound int := 0;
  v_linked int := 0;
  v_unlinked jsonb;
  v_retired jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_rate := get_case_delay_cost_rate(c.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'riskId', r.id,
           'riskTitle', r.title,
           'riskLevel', r.current_risk_level,
           'riskStatus', r.status,
           'activityId', t.id,
           'activityKey', t.task_key,
           'activityLabel', t.label,
           'activityOrigin', t.origin,
           'activityPlannedFinish', t.planned_finish,
           'wbsCode', w.wbs_code,
           'probability', i.probability,
           'delayDaysOptimistic', i.delay_days_optimistic,
           'delayDaysLikely', i.delay_days_likely,
           'delayDaysPessimistic', i.delay_days_pessimistic,
           'costOptimistic', i.cost_optimistic,
           'costLikely', i.cost_likely,
           'costPessimistic', i.cost_pessimistic,
           'currency', i.currency,
           'basis', i.basis,
           'recordedBy', (select email from user_profiles up where up.id = i.recorded_by),
           'recordedAt', i.recorded_at,
           'economicHop', case
             when v_rate->>'value' is not null then format(
               'Delay converts to money at %s %s per day (%s), so this risk''s most-likely %s day(s) carry %s of delay cost before any direct cost.',
               v_rate->>'value', coalesce(v_rate->>'unit', ''), v_rate->>'source',
               i.delay_days_likely,
               round(i.delay_days_likely * (v_rate->>'value')::numeric, 0))
             else v_rate->>'refusal' end,
           'economicHopAvailable', (v_rate->>'value' is not null))
         order by i.probability * i.delay_days_likely desc), '[]'::jsonb)
    into v_links
  from risk_schedule_impacts i
  join risks r on r.id = i.risk_id
  join shutdown_tasks t on t.id = i.schedule_task_id
  left join project_wbs_elements w on w.id = t.wbs_element_id
  where i.organization_id = v_org and i.development_case_id = c.id
    and coalesce(r.status, '') not in ('closed', 'archived');

  select coalesce(jsonb_agg(jsonb_build_object(
           'riskId', r.id, 'riskTitle', r.title, 'riskStatus', r.status,
           'activityKey', t.task_key) order by r.title), '[]'::jsonb)
    into v_retired
  from risk_schedule_impacts i
  join risks r on r.id = i.risk_id
  join shutdown_tasks t on t.id = i.schedule_task_id
  where i.organization_id = v_org and i.development_case_id = c.id
    and coalesce(r.status, '') in ('closed', 'archived');

  select count(*) into v_bound from risks
   where organization_id = v_org and development_case_id = c.id
     and status not in ('closed','archived');

  select count(distinct i.risk_id) into v_linked from risk_schedule_impacts i
   join risks r on r.id = i.risk_id
   where i.organization_id = v_org and i.development_case_id = c.id
     and coalesce(r.status, '') not in ('closed', 'archived');

  select coalesce(jsonb_agg(jsonb_build_object(
           'riskId', r.id, 'riskTitle', r.title, 'riskLevel', r.current_risk_level)
         order by r.current_risk_score desc nulls last, r.title), '[]'::jsonb)
    into v_unlinked
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id
    and r.status not in ('closed','archived')
    and not exists (select 1 from risk_schedule_impacts i where i.risk_id = r.id);

  return jsonb_build_object(
    'caseId', c.id,
    'links', v_links,
    'linkCount', jsonb_array_length(v_links),
    'openRiskCount', v_bound,
    'linkedRiskCount', v_linked,
    'unlinkedRisks', v_unlinked,
    'retiredLinks', v_retired,
    'retiredLinkNote', case when jsonb_array_length(v_retired) = 0 then null else format(
      '%s recorded impact edge(s) belong to risks that are now closed or archived and are EXCLUDED from this chain and from any simulation over it: %s. The edges remain in the ledger — a retracted risk edge is history, not a mistake — but a closed risk that kept driving the P80 would be exposure nobody still carries.',
      jsonb_array_length(v_retired),
      (select string_agg(value->>'riskTitle', '; ') from jsonb_array_elements(v_retired))) end,
    'delayCostRate', v_rate,
    'coverageNote', case
      when v_bound = 0 then
        'No open risk is bound to this case, so there is no risk-driven exposure to simulate. That is a statement about the risk register, not a statement that the project is safe.'
      when v_linked = 0 then format(
        '%s open risk(s) are bound to this case and NONE names the schedule activity it threatens. Spec I.10''s chain starts at a specific activity; until a risk names one, the register can say a risk is Critical and the forecast cannot say what it costs.', v_bound)
      when v_linked < v_bound then format(
        '%s of %s open risk(s) name the activity they threaten. The other %s are in the register and outside the forecast — a simulated P80 understates exposure by exactly them, which is why they are named above rather than counted.',
        v_linked, v_bound, v_bound - v_linked)
      else format('All %s open risk(s) on this case name the activity they threaten.', v_bound) end,
    'evaluable', jsonb_array_length(v_links) > 0);
end
$$;

revoke all on function public.get_case_risk_schedule_chain(uuid) from public, anon, service_role;
grant execute on function public.get_case_risk_schedule_chain(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE LOGIC THE KERNEL CANNOT MODEL (R5), computed once and handed to both
--    the kernel and the door.
-- ---------------------------------------------------------------------------
create or replace function public.sync_case_schedule_logic_support(p_case_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- Granted to `authenticated` directly, so it carries its OWN tenant gate
  -- rather than relying on its callers having one: whether another tenant's
  -- schedule uses lags is a fact about that tenant's schedule.
  with rel as (
    select d.link_type, d.lag_hours
      from shutdown_task_dependencies d
      join shutdown_events e on e.id = d.event_id
      join development_cases dc on dc.id = e.development_case_id
     where e.development_case_id = p_case_id
       and dc.organization_id = app_current_org()
       and exists (select 1 from shutdown_tasks t
                    where t.event_id = d.event_id and t.task_key = d.task_key)
       and exists (select 1 from shutdown_tasks t
                    where t.event_id = d.event_id and t.task_key = d.predecessor_key))
  select jsonb_build_object(
    'relationshipCount', (select count(*) from rel),
    'nonFinishToStartCount',
      (select count(*) from rel where link_type is not null and link_type <> 'FS'),
    'laggedCount',
      (select count(*) from rel where lag_hours is not null and lag_hours <> 0),
    'unstatedLinkTypeCount',
      (select count(*) from rel where link_type is null),
    'supported',
      (select count(*) = 0 from rel
        where (link_type is not null and link_type <> 'FS')
           or (lag_hours is not null and lag_hours <> 0)),
    'refusal', case when (select count(*) from rel
        where (link_type is not null and link_type <> 'FS')
           or (lag_hours is not null and lag_hours <> 0)) = 0 then null
      else format(
        'This case''s logic carries %s relationship(s) with a link type other than finish-to-start and %s with a non-zero lag. The simulation kernel''s critical path (src/lib/modelling/schedule-risk.ts) reads every edge as finish-to-start with zero lag, so a distribution computed over this network would be a distribution over a DIFFERENT network — silently, because the percentiles would look exactly like correct ones. The simulation is REFUSED rather than run against logic it does not model. The quality diagnostics, the §50 score and the chain are unaffected and still report.',
        (select count(*) from rel where link_type is not null and link_type <> 'FS'),
        (select count(*) from rel where lag_hours is not null and lag_hours <> 0)) end,
    'assumptionNote', case when (select count(*) from rel where link_type is null) = 0 then null
      else format(
        '%s of this case''s %s relationship(s) state NO link type. The kernel reads them as finish-to-start, which is P6''s own default and is the reading the digest records — but it is a reading, not a fact the export stated, and a schedule whose logic type is unrecorded is one re-export away from meaning something else.',
        (select count(*) from rel where link_type is null), (select count(*) from rel)) end);
$$;

revoke all on function public.sync_case_schedule_logic_support(uuid) from public, anon, service_role;
grant execute on function public.sync_case_schedule_logic_support(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE INPUTS, now carrying the logic verdict (R5).
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

  -- THE NODE ID IS THE ROW ID, NOT THE TASK KEY (090200's ruling, unchanged).
  -- The predecessor rows now carry their stated link type and lag so the
  -- client can see the logic it is NOT being allowed to simulate over, rather
  -- than being handed a bare id list that looks complete.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id::text,
           'key', t.task_key,
           'label', t.label,
           'duration', t.duration_hours,
           'optimistic', t.optimistic_hours,
           'pessimistic', t.pessimistic_hours,
           'plannedFinish', t.planned_finish,
           'predecessors', coalesce((
             select jsonb_agg(p2.id::text order by p2.id)
               from shutdown_task_dependencies d
               join shutdown_tasks p2
                 on p2.event_id = d.event_id and p2.task_key = d.predecessor_key
              where d.event_id = t.event_id and d.task_key = t.task_key),
             '[]'::jsonb),
           'predecessorLogic', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p2.id::text, 'linkType', d.link_type, 'lagHours', d.lag_hours)
                    order by p2.id)
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
    'logicSupport', sync_case_schedule_logic_support(c.id),
    'gate', v_quality->'gate',
    'qualityScore', v_quality->'score',
    'scheduleConfidence', v_quality->'confidence',
    'coverageNote', v_chain->'coverageNote',
    'retiredLinkNote', v_chain->'retiredLinkNote',
    'unlinkedRisks', v_chain->'unlinkedRisks');
end
$$;

revoke all on function public.get_case_simulation_inputs(uuid) from public, anon, service_role;
grant execute on function public.get_case_simulation_inputs(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. COLUMN-LEVEL GUARDS ON THE LEDGER. The door is one caller; these hold
--    for every caller, including the audited service path.
--
--    `probability_on_plan` was the one recorded numeric with no validation
--    anywhere: "NaN" was accepted, stored as SQL NaN, serialised by to_jsonb
--    as the STRING "NaN" (so the TypeScript type `number | null` was wrong
--    too) and rendered as "NaN%" under the heading "On plan". `99999` was
--    accepted and rendered as "9999900%".
-- ---------------------------------------------------------------------------
alter table public.schedule_simulation_runs
  drop constraint if exists ssr_probability_is_a_probability;
alter table public.schedule_simulation_runs
  add constraint ssr_probability_is_a_probability check (
    probability_on_plan is null
    or (probability_on_plan >= 0 and probability_on_plan <= 1));

alter table public.schedule_simulation_runs
  drop constraint if exists ssr_cost_base_non_negative;
alter table public.schedule_simulation_runs
  add constraint ssr_cost_base_non_negative check (
    cost_base is null or (cost_base >= 0 and cost_base < 'Infinity'::numeric));

alter table public.schedule_simulation_runs
  drop constraint if exists ssr_deterministic_positive;
alter table public.schedule_simulation_runs
  add constraint ssr_deterministic_positive check (
    deterministic_hours > 0 and deterministic_hours < 'Infinity'::numeric);

alter table public.schedule_simulation_runs
  drop constraint if exists ssr_percentiles_finite;
alter table public.schedule_simulation_runs
  add constraint ssr_percentiles_finite check (
    p10_hours > '-Infinity'::numeric and p90_hours < 'Infinity'::numeric
    and p10_hours = p10_hours and p50_hours = p50_hours
    and p80_hours = p80_hours and p90_hours = p90_hours);

alter table public.schedule_simulation_runs
  drop constraint if exists ssr_rate_non_negative;
alter table public.schedule_simulation_runs
  add constraint ssr_rate_non_negative check (
    delay_cost_per_day is null
    or (delay_cost_per_day >= 0 and delay_cost_per_day < 'Infinity'::numeric));

-- ---------------------------------------------------------------------------
-- 7. THE PERSISTENCE TRIGGER (R7).
--
--    3D's own header names the shape being repaired here: "enforce_framework_
--    immutability has an explicitly AUDITED SERVICE PATH … and it never looks
--    at adopted_by — so any holder of the service key could write
--    adopted_by=<the AI-operator identity> … with a warning nobody reads as
--    its only trace." 090200 reintroduced it on a new ledger: the INSERT arm
--    admitted a service caller after one security_events row and never looked
--    at computed_by, never required a lineage row, and never asked whether
--    anything varied. Proven live: a service-key POST created a recorded
--    distribution attributed to the ai_admin identity, with p10=1 p90=4 over a
--    schedule with nothing to sample and no calculation_run_id at all — and
--    get_case_schedule_simulation served it as the case's current run.
--
--    These four refusals apply to EVERY caller. A service path that is audited
--    is not the same as a service path that is allowed to write a forecast
--    nobody computed.
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
  v_author_role text;
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

  -- R7a. §70, on the ledger rather than only in the door. A recorded
  -- probabilistic forecast attributed to the AI-operator identity is the
  -- exact claim spec §70 forbids, and the door's check is invisible to a
  -- caller that never goes through the door.
  if new.computed_by is not null then
    select role into v_author_role from user_profiles where id = new.computed_by;
    if coalesce(v_author_role, '') = 'ai_admin' then
      raise exception
        'this simulation is attributed to the AI-operator identity. Recording a probabilistic forecast is determining the exposure a sanction decision is taken against, and no AI or system identity may do that (spec §70). The AI may prepare the inputs and explain the result; a human records it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- R7b. D11.29: a distribution with no lineage row is a P80 with no record
  -- of what produced it. There is exactly one writer that mints one.
  if new.calculation_run_id is null then
    raise exception
      'a recorded distribution carries its lineage run (calculation_run_id). A simulation row with no run behind it states a P80 and nothing about where it came from, which is the one thing the ledger exists to make impossible (D11.29).'
      using errcode = 'check_violation';
  end if;

  -- R7c. A spread over a network in which nothing varies did not come off a
  -- sample. The door refuses this at the input end; the ledger refuses the
  -- ROW, so a caller that skipped the door cannot mint one either.
  if coalesce(new.sampled_range_count, 0) + coalesce(new.risk_link_count, 0) = 0
     and new.p90_hours > new.p10_hours then
    raise exception
      'this row records a distribution with a non-zero width over a schedule in which NOTHING varies: no activity carries a duration range and no risk names an activity. A spread with nothing behind it is the one result this ledger exists to refuse.'
      using errcode = 'check_violation';
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

-- ---------------------------------------------------------------------------
-- 8. §70 REACHES THE ACTS THAT DETERMINE THE FORECAST (R6).
--
--    Five doors are re-issued below with the AI-operator identity refused BY
--    NAME. Nothing else about any of them changes; each is otherwise the body
--    it had in 20261130090100 / 20261202090000 / 090100 / 090200.
--
--      record_local_schedule_activity        — accepting a schedule
--      record_local_schedule_relationship    — accepting a schedule
--      compute_case_schedule_quality         — recording a quality judgement
--      compute_case_risk_schedule_economics  — recording what a risk costs
--      compute_case_forecast_confidence      — recording a forecast
--
--    The reads they wrap (get_case_schedule_quality, get_case_risk_schedule_
--    chain, get_case_forecast_confidence) stay open to the AI identity: the
--    §70 line is between reading a number and RECORDING it as the answer.
-- ---------------------------------------------------------------------------
-- --- record_local_schedule_activity: §70 (R6) ---------------------------------------------------
create or replace function public.record_local_schedule_activity(
  p_case_id uuid,
  p_activity jsonb
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
  v_key text := nullif(btrim(coalesce(p_activity->>'activity_id','')), '');
  v_label text := nullif(btrim(coalesce(p_activity->>'description','')), '');
  v_dur_raw text := nullif(btrim(coalesce(p_activity->>'duration_hours','')), '');
  v_dur numeric := sync_text_as_numeric(v_dur_raw);
  v_start_raw text := nullif(btrim(coalesce(p_activity->>'planned_start','')), '');
  v_finish_raw text := nullif(btrim(coalesce(p_activity->>'planned_finish','')), '');
  v_start timestamptz;
  v_finish timestamptz;
  v_wbs_code text := nullif(btrim(coalesce(p_activity->>'wbs_code','')), '');
  v_wbs uuid;
  v_event_key text;
  v_event uuid;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 (repair ruling R6). record_local_schedule_activity
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'authoring the activities a §50 quality score and a Monte Carlo gate are computed over is ACCEPTING A SCHEDULE. Spec §70: no AI or system identity may do that. Proven in review: one AI-authored activity moved this case''s gate from permitted to refused. The AI may propose activities and explain them; a human records them.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'authoring a schedule activity requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_key is null then
    return jsonb_build_object('error',
      'an activity carries an identifier the rest of the schedule can cite (activity_id)');
  end if;
  if v_label is null or length(v_label) < 3 then
    return jsonb_build_object('error', 'describe the activity (description, 3 characters minimum)');
  end if;
  if v_dur_raw is null then
    return jsonb_build_object('error',
      'state the duration in hours (duration_hours) — this schedule records hours explicitly, exactly as the P6 import does, because converting duration units needs a calendar Sync refuses to guess');
  end if;
  if v_dur is null then
    return jsonb_build_object('error',
      format('duration_hours "%s" is not a number', v_dur_raw));
  end if;
  -- 'NaN' and '±Infinity' are VALID numerics in Postgres and NaN sorts above
  -- every number, so `v_dur < 0` is vacuously false for both. Literal
  -- comparison is the detector (NaN = NaN is TRUE for numeric).
  if v_dur = 'NaN'::numeric or v_dur = 'Infinity'::numeric or v_dur = '-Infinity'::numeric then
    return jsonb_build_object('error',
      format('duration_hours is %s; a duration must be a finite number of hours', v_dur));
  end if;
  if v_dur < 0 then
    return jsonb_build_object('error',
      format('duration_hours is %s; a duration cannot be negative', v_dur));
  end if;
  if v_start_raw is not null then
    v_start := sync_text_as_timestamptz(v_start_raw);
    if v_start is null then
      return jsonb_build_object('error', format('planned_start "%s" is not a date', v_start_raw));
    end if;
    if not isfinite(v_start) then
      return jsonb_build_object('error',
        format('planned_start is %s; a planned date must be a finite calendar date', v_start));
    end if;
  end if;
  if v_finish_raw is not null then
    v_finish := sync_text_as_timestamptz(v_finish_raw);
    if v_finish is null then
      return jsonb_build_object('error', format('planned_finish "%s" is not a date', v_finish_raw));
    end if;
    if not isfinite(v_finish) then
      return jsonb_build_object('error',
        format('planned_finish is %s; a planned date must be a finite calendar date', v_finish));
    end if;
  end if;
  if v_start is not null and v_finish is not null and v_finish < v_start then
    return jsonb_build_object('error',
      'planned_finish is before planned_start — an activity cannot finish before it begins');
  end if;
  if v_wbs_code is not null then
    select id into v_wbs from project_wbs_elements
     where development_case_id = c.id and wbs_code = v_wbs_code;
    if v_wbs is null then
      return jsonb_build_object('error',
        format('WBS code "%s" does not exist on this case — record the WBS element first, or leave wbs_code empty and the activity is reported as unauthorized scope until it is coded', v_wbs_code));
    end if;
  end if;

  v_event_key := 'develop:' || c.id::text || ':sync-local';
  select id into v_event from shutdown_events
   where organization_id = v_org and event_key = v_event_key;
  if v_event is null then
    insert into shutdown_events (organization_id, event_key, title, status, development_case_id)
    values (v_org, v_event_key, 'Sync-authored activities — ' || c.title, 'planning', c.id)
    on conflict (organization_id, event_key) do update
      set development_case_id = excluded.development_case_id
    returning id into v_event;
  end if;

  if exists (select 1 from shutdown_tasks where event_id = v_event and task_key = v_key) then
    return jsonb_build_object('error',
      format('activity "%s" already exists in this case''s Sync-authored schedule', v_key));
  end if;

  perform set_config('app.schedule_activity_write', 'granted', true);
  insert into shutdown_tasks
    (event_id, task_key, label, duration_hours, planned_start, planned_finish,
     wbs_element_id, origin, authored_by)
  values (v_event, v_key, v_label, v_dur, v_start, v_finish, v_wbs, 'local', auth.uid())
  returning id into v_id;
  perform set_config('app.schedule_activity_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'activity_id', v_id, 'activity_key', v_key,
      'action', 'authored_locally'),
    null,
    jsonb_build_object('activity_key', v_key, 'label', v_label, 'duration_hours', v_dur,
      'origin', 'local', 'wbs_code', v_wbs_code));

  return jsonb_build_object('activity_id', v_id, 'activity_key', v_key,
    'origin', 'local', 'wbs_code', v_wbs_code, 'case_id', c.id);
end
$$;

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.record_local_schedule_activity(uuid, jsonb) from public, anon;
grant execute on function public.record_local_schedule_activity(uuid, jsonb) to authenticated, service_role;

-- --- record_local_schedule_relationship: §70 (R6) ---------------------------------------------------
create or replace function public.record_local_schedule_relationship(
  p_case_id uuid,
  p_relationship jsonb
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
  v_key text := nullif(btrim(coalesce(p_relationship->>'activity_id','')), '');
  v_pred text := nullif(btrim(coalesce(p_relationship->>'predecessor','')), '');
  v_link text := upper(nullif(btrim(coalesce(p_relationship->>'link_type','')), ''));
  v_lag_raw text := nullif(btrim(coalesce(p_relationship->>'lag_hours','')), '');
  v_lag numeric;
  v_event uuid;
  t shutdown_tasks%rowtype;
  p shutdown_tasks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 (repair ruling R6). record_local_schedule_relationship
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'authoring the logic the §50 score and the Monte Carlo gate are computed over is ACCEPTING A SCHEDULE. Spec §70: no AI or system identity may do that. Missing logic, open ends, lags and critical-path continuity are four of the nine defect classes, and all four are decided by these rows.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'authoring schedule logic requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_key is null or v_pred is null then
    return jsonb_build_object('error',
      'a relationship names both ends: activity_id and predecessor');
  end if;
  if v_key = v_pred then
    return jsonb_build_object('error',
      'an activity cannot depend on itself');
  end if;

  select id into v_event from shutdown_events
   where organization_id = v_org and event_key = 'develop:' || c.id::text || ':sync-local';
  if v_event is null then
    return jsonb_build_object('error',
      'this case has no Sync-authored schedule yet — author the activities first (record_local_schedule_activity)');
  end if;
  select * into t from shutdown_tasks where event_id = v_event and task_key = v_key;
  if not found then
    return jsonb_build_object('error',
      format('activity "%s" is not in this case''s Sync-authored schedule. Logic on an IMPORTED activity belongs to P6 and is imported with it (spec §22, §77).', v_key));
  end if;
  select * into p from shutdown_tasks where event_id = v_event and task_key = v_pred;
  if not found then
    return jsonb_build_object('error',
      format('predecessor "%s" is not in this case''s Sync-authored schedule', v_pred));
  end if;

  if v_link is not null and v_link not in ('FS','SS','FF','SF') then
    return jsonb_build_object('error',
      format('link_type "%s" is not one of FS, SS, FF, SF', v_link));
  end if;
  if v_lag_raw is not null then
    v_lag := sync_text_as_numeric(v_lag_raw);
    if v_lag is null then
      return jsonb_build_object('error', format('lag_hours "%s" is not a number', v_lag_raw));
    end if;
    if v_lag = 'NaN'::numeric or v_lag = 'Infinity'::numeric or v_lag = '-Infinity'::numeric then
      return jsonb_build_object('error',
        format('lag_hours is %s; a lag must be a finite number of hours', v_lag));
    end if;
  end if;

  perform set_config('app.schedule_logic_write', 'granted', true);
  insert into shutdown_task_dependencies (event_id, task_key, predecessor_key, link_type, lag_hours)
  values (v_event, v_key, v_pred, v_link, v_lag)
  on conflict (event_id, task_key, predecessor_key) do update
    set link_type = excluded.link_type, lag_hours = excluded.lag_hours;
  perform set_config('app.schedule_logic_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'activity_key', v_key, 'action', 'logic_authored'),
    null,
    jsonb_build_object('predecessor', v_pred, 'link_type', v_link, 'lag_hours', v_lag));

  return jsonb_build_object('case_id', c.id, 'activity_key', v_key,
    'predecessor', v_pred, 'link_type', v_link, 'lag_hours', v_lag);
end
$$;

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.record_local_schedule_relationship(uuid, jsonb) from public, anon;
grant execute on function public.record_local_schedule_relationship(uuid, jsonb) to authenticated, service_role;

-- --- compute_case_schedule_quality: §70 (R6) ---------------------------------------------------
create or replace function public.compute_case_schedule_quality(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_q jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 (repair ruling R6). compute_case_schedule_quality
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording the §50 Schedule Quality Score is RECORDING A QUALITY JUDGEMENT, and that judgement is what gates the Monte Carlo. Spec §70 forbids an AI or system identity from doing it. The AI may read get_case_schedule_quality, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'diagnosing a schedule requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_q := get_case_schedule_quality(c.id);
  if v_q ? 'error' then
    return v_q;
  end if;

  -- Every blind class and every failing class is a refusal ON THE RECORD, so
  -- a score computed over four components is distinguishable in the ledger
  -- from one computed over six.
  for rec in select value as cls from jsonb_array_elements(v_q->'classes') loop
    if (rec.cls->>'diagnosable')::boolean is not true then
      v_refusals := v_refusals || to_jsonb(format('%s: %s',
        rec.cls->>'label', coalesce(rec.cls->>'notDiagnosableReason', 'not diagnosable'))::text);
    elsif rec.cls->>'severity' = 'fail' then
      v_refusals := v_refusals || to_jsonb(format('%s is over its published threshold (%s of %s, threshold %s).',
        rec.cls->>'label', rec.cls->>'count', rec.cls->>'denominator', rec.cls->>'failThreshold')::text);
    end if;
  end loop;

  if v_q->>'scoreRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_q->>'scoreRefusal');
  end if;
  if v_q->>'confidenceRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_q->>'confidenceRefusal');
  end if;

  if v_q->'score' is null or v_q->>'score' is null then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'score', v_q->'score',
      'confidence', v_q->'confidence',
      'diagnosableComponents', v_q->'diagnosableComponents',
      'activityCount', v_q->'activityCount',
      'relationshipCount', v_q->'relationshipCount',
      'gatePermitted', v_q->'gate'->'permitted',
      'failingClasses', v_q->'gate'->'failingClasses',
      'classSeverities', (select jsonb_object_agg(value->>'key', value->>'severity')
                            from jsonb_array_elements(v_q->'classes')));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_schedule_quality',
    'The nine II.6 schedule defect classes diagnosed over this case''s schedule activities and their relationships, and the §50 Schedule Quality Score composed from the six components §50 names, with published weights. Classes that could not be diagnosed from the imported data are recorded as refusals and contribute no weight; the score is refused outright below the published sparsity floor or below four diagnosable components. The Schedule Confidence Score composes structure, expressed uncertainty, import history and scope anchoring, and is refused whenever the quality score is.',
    jsonb_build_object(
      'activityCount', v_q->'activityCount',
      'relationshipCount', v_q->'relationshipCount',
      'activitiesWithFloat', v_q->'activitiesWithFloat',
      'activitiesWithPlannedDates', v_q->'activitiesWithPlannedDates',
      'activitiesWithDurationRange', v_q->'activitiesWithDurationRange',
      'activitiesWithWbs', v_q->'activitiesWithWbs',
      'acceptedImportRuns', v_q->'acceptedImportRuns',
      -- REPAIR. Counts cannot see a defect change. This is the content of the
      -- nine classes, and it is what makes a published §50 score go stale when
      -- the diagnosis moves under it.
      'classSignature', v_q->'classSignature',
      'policyDigest', md5(sync_schedule_quality_policy()::text)),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'shutdown_tasks', 'id', t.id))
                from shutdown_tasks t
                join shutdown_events e on e.id = t.event_id
               where e.organization_id = c.organization_id
                 and e.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_q || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_schedule_quality'));
end
$$;

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.compute_case_schedule_quality(uuid) from public, anon, service_role;
grant execute on function public.compute_case_schedule_quality(uuid) to authenticated;

-- --- compute_case_risk_schedule_economics: §70 (R6) ---------------------------------------------------
create or replace function public.compute_case_risk_schedule_economics(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_chain jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 (repair ruling R6). compute_case_risk_schedule_economics
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording the risk → schedule → economics chain fixes, in an immutable ledger, what each risk is understood to cost. Spec §70 keeps that act with a human. The AI may read get_case_risk_schedule_chain, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the risk-schedule-economics chain requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_chain := get_case_risk_schedule_chain(c.id);
  if v_chain ? 'error' then
    return v_chain;
  end if;

  if v_chain->'delayCostRate'->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_chain->'delayCostRate'->>'refusal');
  end if;
  if jsonb_array_length(v_chain->'unlinkedRisks') > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s open risk(s) on this case name no schedule activity and are therefore outside any forecast computed from this chain: %s.',
      jsonb_array_length(v_chain->'unlinkedRisks'),
      (select string_agg(value->>'riskTitle', '; ')
         from jsonb_array_elements(v_chain->'unlinkedRisks')))::text);
  end if;
  for rec in select value as link from jsonb_array_elements(v_chain->'links') loop
    if rec.link->>'costLikely' is null then
      v_refusals := v_refusals || to_jsonb(format(
        'Risk "%s" on activity %s carries no direct cost impact, so its economic exposure is delay cost only.',
        rec.link->>'riskTitle', rec.link->>'activityKey')::text);
    end if;
  end loop;

  if coalesce((v_chain->>'evaluable')::boolean, false) = false then
    v_outputs := null;
    v_refusals := v_refusals || to_jsonb(v_chain->>'coverageNote');
  else
    v_outputs := jsonb_build_object(
      'linkCount', v_chain->'linkCount',
      'openRiskCount', v_chain->'openRiskCount',
      'linkedRiskCount', v_chain->'linkedRiskCount',
      'delayCostPerDay', v_chain->'delayCostRate'->'value',
      'delayCostSource', v_chain->'delayCostRate'->'source',
      'economicHopAvailable', to_jsonb(v_chain->'delayCostRate'->>'value' is not null));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_risk_schedule_economics',
    'The I.10 chain as data: every recorded edge from a risk bound to this case to the schedule activity it threatens, with the edge''s own probability and three-point delay, its optional three-point direct cost, and the case cost-of-delay rate that converts days into money. Risks with no activity named are recorded as refusals BY NAME, because a forecast computed from this chain understates exposure by exactly them.',
    jsonb_build_object(
      'linkCount', v_chain->'linkCount',
      'openRiskCount', v_chain->'openRiskCount',
      'linkedRiskCount', v_chain->'linkedRiskCount',
      'delayCostPerDay', v_chain->'delayCostRate'->'value'),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'risk_schedule_impacts', 'id', i.id))
                from risk_schedule_impacts i
               where i.organization_id = v_org and i.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_chain || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_risk_schedule_economics'));
end
$$;

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.compute_case_risk_schedule_economics(uuid) from public, anon, service_role;
grant execute on function public.compute_case_risk_schedule_economics(uuid) to authenticated;

-- --- compute_case_forecast_confidence: §70 (R6) ---------------------------------------------------
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
  -- §70 (repair ruling R6). compute_case_forecast_confidence
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording §51 forecast confidence is recording the forecast a sanction decision is taken against. Spec §70 keeps that act with a human. The AI may read get_case_forecast_confidence, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
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

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.compute_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.compute_case_forecast_confidence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. THE LOGIC LEDGER GETS THE WALL THE ACTIVITY LEDGER HAS (R8).
--
--    090000 gave `shutdown_task_dependencies` `link_type` and `lag_hours` and
--    with them a share of four defect classes, §50 and the Monte Carlo gate.
--    It left the table with one SELECT policy, no trigger of any kind, and
--    TRUNCATE granted to anon, authenticated and service_role — and RLS never
--    applies to TRUNCATE. 090000's own sentence about the activity table is
--    the sentence for this one: a client that could delete a relationship
--    could clear an open-ends finding and open the Monte Carlo gate by typing.
--    Client writes were already refused (no write policy); what was missing is
--    the DELETE/TRUNCATE guard, the audited service path, the P6 field wall
--    for logic on imported activities, and §70.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_schedule_task_dependency()
returns trigger
language plpgsql
as $$
declare
  -- Its OWN marker. `app.schedule_activity_write` is reset before the import
  -- door writes its relationships, so reusing it would have refused the one
  -- caller that must be allowed.
  v_marker text := coalesce(current_setting('app.schedule_logic_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_event uuid;
  v_org uuid;
  v_case uuid;
  v_role text;
  v_origin text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'shutdown_task_dependencies holds the logic every schedule diagnostic reads; truncating it turns every schedule in the database into a pile of unconnected activities in one statement, and a schedule with no logic has no open ends, no missing logic and no critical path to break.'
      using errcode = 'insufficient_privilege';
  end if;

  v_event := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  select e.organization_id, e.development_case_id into v_org, v_case
    from shutdown_events e where e.id = v_event;

  -- §70 (R6), for the develop schedules whose logic decides the gate.
  if v_client and v_case is not null then
    select role into v_role from user_profiles where id = auth.uid();
    if coalesce(v_role, '') = 'ai_admin' then
      raise exception
        'authoring or removing schedule logic on a development case is accepting a schedule, and the §50 score this logic decides is what gates the Monte Carlo. No AI or system identity may do that (spec §70).'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    -- Audited for the DEVELOP schedules whose logic decides the §50 score and
    -- the Monte Carlo gate. A service write to an unrelated turnaround's logic
    -- is not this repair's subject and is not worth burying the signal under.
    if v_marker <> 'granted' and v_org is not null and v_case is not null
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Schedule logic was ' || lower(tg_op) || 'd by a service caller outside the '
           || 'import door and outside record_local_schedule_relationship. Link type '
           || 'and lag feed four of the nine II.6 defect classes, the §50 score and '
           || 'the Monte Carlo gate (D5.13/D5.31/D5.15).');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- A client reaching this table at all is a client going round both doors.
  -- The two legitimate writers declare themselves differently, because they
  -- are allowed different things: the IMPORT door is P6 speaking and may write
  -- logic on imported activities; the Sync-authored door may not.
  if v_marker not in ('granted', 'import') then
    raise exception
      'schedule logic is written by the P6 import door or by record_local_schedule_relationship — a direct write would supply a relationship with no stated provenance, and relationships are what the open-ends and missing-logic findings are computed from.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The P6 field wall, for logic on IMPORTED activities. Sync analyzes P6
  -- schedules and does not write them back (spec §22/§77).
  select t.origin into v_origin from shutdown_tasks t
   where t.event_id = v_event
     and t.task_key = case when tg_op = 'DELETE' then old.task_key else new.task_key end;
  if v_marker <> 'import' and coalesce(v_origin, '') = 'imported' then
    raise exception
      'this relationship belongs to an IMPORTED activity, so it belongs to P6. Correct the logic in P6 and re-import; a relationship edited here would make the schedule diagnostics report on a network the system of record does not hold.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_schedule_task_dependency() from public, anon, authenticated;

drop trigger if exists trg_schedule_task_dependency on public.shutdown_task_dependencies;
create trigger trg_schedule_task_dependency
  before insert or update or delete on public.shutdown_task_dependencies
  for each row execute function public.enforce_schedule_task_dependency();

drop trigger if exists trg_schedule_task_dependency_no_truncate on public.shutdown_task_dependencies;
create trigger trg_schedule_task_dependency_no_truncate
  before truncate on public.shutdown_task_dependencies
  for each statement execute function public.enforce_schedule_task_dependency();

revoke truncate on table public.shutdown_task_dependencies from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. THE GOVERNED DOOR FOR THE RANGE THAT IS THE DISTRIBUTION (R9, D5.28,
--     D5.14, D5.07).
--
--     `optimistic_hours` and `pessimistic_hours` decide the WIDTH of every
--     P80 this slice publishes, feed the §50 "duration quality" component and
--     D5.14's "expressed uncertainty" component, and are the input the
--     simulation's `minimumSampledRanges` floor is about. Nothing in the
--     product wrote them. Not the P6 import (it refuses to convert P6 units
--     and does not carry ranges), not record_local_schedule_activity, not any
--     4C function — only the 2026-08 demo seed and, in the transcript, raw
--     superuser SQL. So D5.14's uncertainty component was zero for every real
--     customer, capping the Schedule Confidence Score at 75 with nothing on
--     screen saying why.
--
--     The rule this door enforces is the slice's central rule at the input
--     end: a range is a range somebody ESTIMATED. It must bracket the stated
--     duration (a "range" that excludes the most likely value is not one),
--     the ends must differ (a triple whose ends meet is a point estimate with
--     three columns — the same refusal risk_schedule_impacts enforces at the
--     schema), and it carries a MANDATORY basis, because the cheapest place
--     to manufacture a distribution is at data entry, where it looks like
--     diligence. `duration_hours * 0.8/1.6` typed into this door is still a
--     fabrication — no door can detect that — but it is now a fabrication a
--     named human recorded with a stated basis and an audit row, instead of
--     an anonymous UPDATE.
-- ---------------------------------------------------------------------------
create table if not exists public.schedule_duration_range_basis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  schedule_task_id bigint not null references shutdown_tasks(id) on delete cascade,
  optimistic_hours numeric not null,
  most_likely_hours numeric not null,
  pessimistic_hours numeric not null,
  basis text not null check (length(btrim(basis)) >= 12),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  constraint sdrb_range_is_a_range check (
    optimistic_hours >= 0
    and optimistic_hours <= most_likely_hours
    and most_likely_hours <= pessimistic_hours
    and pessimistic_hours > optimistic_hours)
);

create index if not exists idx_sdrb_case
  on schedule_duration_range_basis(organization_id, development_case_id, recorded_at desc);

alter table public.schedule_duration_range_basis enable row level security;
drop policy if exists sdrb_read on public.schedule_duration_range_basis;
create policy sdrb_read on public.schedule_duration_range_basis
  for select to authenticated using (organization_id = app_current_org());

comment on table public.schedule_duration_range_basis is
  'D5.28/D5.14/D5.07: the stated basis for every optimistic/pessimistic duration range on a development-case schedule activity. The range is what the P80 is made of, so it carries a named author and a written basis exactly as the risk''s three-point delay does. Append-only.';

create or replace function public.enforce_duration_range_basis()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.duration_range_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'schedule_duration_range_basis holds the stated basis for every duration range a P80 was sampled from; truncating it leaves the ranges with no author and no reason in one statement.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    if not v_client and current_user not in ('authenticated','anon') then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values (v_org, null, 'service (' || current_user || ')', 'admin_action', 'warning',
          'A recorded duration-range basis was ' || lower(tg_op) || 'd by a service caller. '
            'The row states who widened a distribution and why (D5.07/D5.14).');
      end if;
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception
      'a recorded duration-range basis is immutable — state a new range and a new basis is recorded beside it.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    if v_client or current_user in ('authenticated','anon') then
      raise exception
        'a duration range is stated through set_schedule_activity_duration_range, which checks the range brackets the stated duration and demands a basis.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values (v_org, null, 'service (' || current_user || ')', 'admin_action', 'warning',
        'A duration-range basis was written by a service caller outside '
          'set_schedule_activity_duration_range, so neither the bracketing check nor the '
          'basis requirement was applied to it.');
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_duration_range_basis() from public, anon, authenticated;

drop trigger if exists trg_duration_range_basis on public.schedule_duration_range_basis;
create trigger trg_duration_range_basis
  before insert or update or delete on public.schedule_duration_range_basis
  for each row execute function public.enforce_duration_range_basis();

drop trigger if exists trg_duration_range_basis_no_truncate on public.schedule_duration_range_basis;
create trigger trg_duration_range_basis_no_truncate
  before truncate on public.schedule_duration_range_basis
  for each statement execute function public.enforce_duration_range_basis();

revoke truncate on table public.schedule_duration_range_basis from anon, authenticated, service_role;

create or replace function public.set_schedule_activity_duration_range(
  p_case_id uuid,
  p_range jsonb
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
  v_key text := nullif(btrim(coalesce(p_range->>'activity_id','')), '');
  v_basis text := nullif(btrim(coalesce(p_range->>'basis','')), '');
  v_opt numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_range->>'optimistic_hours','')), ''));
  v_pes numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_range->>'pessimistic_hours','')), ''));
  t shutdown_tasks%rowtype;
  v_matches int := 0;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70. The range IS the spread. Stating it is stating how uncertain the
  -- project is, which is the judgement a P80 is made of.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'stating how uncertain an activity''s duration is IS the estimate a P80 is built on — the AI-operator identity cannot record one (spec §70). The AI may propose a range and explain it; a human records it.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'stating a duration range requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_key is null then
    return jsonb_build_object('error', 'name the activity (activity_id)');
  end if;
  if v_basis is null or length(v_basis) < 12 then
    return jsonb_build_object('error',
      'state the basis for this range (basis, 12 characters minimum). A range with no basis is a spread somebody typed, and it is the number every percentile on this case is made of.');
  end if;

  -- task_key is unique per shutdown_event and a case holds TWO by design (the
  -- P6 import and Sync's own), so an ambiguous key is REFUSED rather than
  -- resolved with `limit 1` — the same ruling record_risk_schedule_impact
  -- applies.
  select count(*) into v_matches
  from shutdown_tasks x join shutdown_events e on e.id = x.event_id
  where e.organization_id = v_org and e.development_case_id = c.id and x.task_key = v_key;
  if v_matches = 0 then
    return jsonb_build_object('error',
      format('activity "%s" is not on this case''s schedule', v_key));
  end if;
  if v_matches > 1 then
    return jsonb_build_object('error',
      format('activity key "%s" names %s activities on this case — this case holds both an imported P6 schedule and a Sync-authored one, and an activity key is only unique within one of them. Nothing is written, because widening the wrong activity''s distribution is not detectable afterwards.',
             v_key, v_matches));
  end if;
  select x.* into t
  from shutdown_tasks x join shutdown_events e on e.id = x.event_id
  where e.organization_id = v_org and e.development_case_id = c.id and x.task_key = v_key;

  if v_opt is null or v_pes is null then
    return jsonb_build_object('error',
      'a duration range is BOTH ends: optimistic_hours and pessimistic_hours. One end alone is not a range, and the sampler would have to invent the other.');
  end if;
  if v_opt = 'NaN'::numeric or v_pes = 'NaN'::numeric
     or v_opt = 'Infinity'::numeric or v_pes = 'Infinity'::numeric
     or v_opt = '-Infinity'::numeric or v_pes = '-Infinity'::numeric then
    return jsonb_build_object('error', 'a duration range is two finite numbers of hours');
  end if;
  if v_opt < 0 then
    return jsonb_build_object('error', 'an optimistic duration cannot be negative');
  end if;
  if v_pes <= v_opt then
    return jsonb_build_object('error', format(
      'the optimistic and pessimistic durations are %s and %s. A triple whose ends meet is a point estimate with three columns, and the sampler would return the stated duration with a confidence interval of zero width.',
      v_opt, v_pes));
  end if;
  if not (v_opt <= t.duration_hours and t.duration_hours <= v_pes) then
    return jsonb_build_object('error', format(
      'this range (%s to %s hours) does not bracket the activity''s stated duration of %s hours. The triangular sampler takes the stated duration as the MODE, so a range that excludes it is not a range around this estimate — it is a different estimate, and it belongs in duration_hours.',
      v_opt, v_pes, t.duration_hours));
  end if;

  perform set_config('app.schedule_activity_write', 'granted', true);
  update shutdown_tasks
     set optimistic_hours = v_opt, pessimistic_hours = v_pes
   where id = t.id;
  perform set_config('app.schedule_activity_write', '', true);

  perform set_config('app.duration_range_write', 'granted', true);
  insert into schedule_duration_range_basis
    (organization_id, development_case_id, schedule_task_id,
     optimistic_hours, most_likely_hours, pessimistic_hours, basis, recorded_by)
  values (v_org, c.id, t.id, v_opt, t.duration_hours, v_pes, v_basis, auth.uid())
  returning id into v_id;
  perform set_config('app.duration_range_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'activity_key', v_key, 'action', 'duration_range_stated',
      'basis_id', v_id),
    jsonb_build_object('optimistic_hours', t.optimistic_hours, 'pessimistic_hours', t.pessimistic_hours),
    jsonb_build_object('optimistic_hours', v_opt, 'mostLikelyHours', t.duration_hours,
      'pessimistic_hours', v_pes, 'basis', v_basis));

  return jsonb_build_object('case_id', c.id, 'activity_key', v_key, 'basis_id', v_id,
    'optimisticHours', v_opt, 'mostLikelyHours', t.duration_hours, 'pessimisticHours', v_pes,
    'note', 'This range is what the simulation samples. It is recorded with its author and its basis because it, and not the deterministic duration, is what a P80 is made of.');
end
$$;

revoke all on function public.set_schedule_activity_duration_range(uuid, jsonb) from public, anon, service_role;
grant execute on function public.set_schedule_activity_duration_range(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. THE DOOR, RE-ISSUED (R1, R2, R5, R10, and the numeric guards).
--
--     What changed, and why each one mattered in review:
--
--     * costBase / currency / delayCostPerDay are now READ from
--       get_case_earned_value and get_case_delay_cost_rate. Before: a planner
--       token posted costBase = 999,999,999 on a case whose EAC refuses and
--       §51 printed a $1.000002 B cost P80 with `deterministic: null` beside
--       it, under the sentence "these percentiles came off the recorded
--       simulation". costBase = -1,000,000,000 was accepted too.
--     * deterministicHours is bounded by the network it claims to describe
--       (R2). Before: 99999 on a 1460-hour network produced a P80 finish date
--       in 2016.
--     * probabilityOnPlan is checked. Before: "NaN" rendered as "NaN%" and
--       99999 rendered as "9999900%" under the heading "On plan".
--     * kernelVersion is checked against the published list. Before:
--       "totally-made-up-kernel" was the recorded code identity of a forecast
--       whose whole claim is that it can be re-run.
--     * -Infinity is refused (it was in the seed check and the cost-base check
--       and absent from the five percentile checks, so it was an omission
--       rather than a policy).
--     * every attribution row's NUMBERS are checked, and its risk title is
--       taken from the risk. Before: only the risk id was checked, so
--       `p80DaysContribution: 4200, meanCostContribution: 777000000,
--       riskTitle: "WHATEVER I WANT"` was accepted and rendered as
--       "…contributes 4200.0 day(s) of P80 schedule exposure".
--     * every criticality row is checked at all. Before: nothing was —
--       `{"id":"nope","criticalityIndex":42}` rendered as "An activity that
--       does not exist: on the critical path in 4200% of runs" under the
--       heading "ranked by the simulation, not assumed".
--     * the "no cost exposure was simulated" refusal reads the real data
--       state instead of asserting one (R10).
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
  v_logic jsonb;
  v_ev jsonb;
  v_rate_read jsonb;
  v_seed numeric;
  v_iterations int;
  v_iter_raw numeric;
  v_sample_raw numeric;
  v_kernel text := nullif(btrim(coalesce(p_result->>'kernelVersion','')), '');
  v_activity_count int;
  v_ranges int;
  v_risk_links int;
  v_dur_max numeric;
  v_dur_sum numeric;
  v_det numeric;
  v_p10 numeric; v_p50 numeric; v_p80 numeric; v_p90 numeric;
  v_onplan numeric;
  v_sample int;
  v_finish timestamptz;
  v_p50_finish timestamptz;
  v_p80_finish timestamptz;
  v_cost_base numeric;
  v_cost_base_claim numeric;
  v_currency text;
  v_exp50 numeric; v_exp80 numeric;
  v_cost50 numeric; v_cost80 numeric;
  v_rate numeric;
  v_rate_claim numeric;
  v_costed_edges int := 0;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_attr jsonb := case when jsonb_typeof(p_result->'attribution') = 'array'
                       then p_result->'attribution' else '[]'::jsonb end;
  v_crit jsonb := case when jsonb_typeof(p_result->'criticality') = 'array'
                       then p_result->'criticality' else '[]'::jsonb end;
  v_attr_clean jsonb := '[]'::jsonb;
  v_crit_clean jsonb := '[]'::jsonb;
  v_num numeric;
  v_hours numeric;
  v_days numeric;
  v_title text;
  v_label text;
  v_id uuid;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
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
    v_run := record_calculation_run(
      c.id, 'case_schedule_simulation',
      'A Monte Carlo simulation was requested over this case''s schedule and was REFUSED before any result was accepted, because the schedule failed its §50 quality diagnostics. Spec II.6: "Monte Carlo on poor logic is not useful." The failing classes are recorded as the refusals of this run.',
      jsonb_build_object(
        'qualityScore', v_quality->'score',
        'minimumScore', v_quality->'gate'->'minimumScore',
        'activityCount', v_quality->'activityCount',
        'relationshipCount', v_quality->'relationshipCount',
        -- The seed travels even on a refusal: the run states which attempt
        -- was refused, and an attempt with no seed is not an attempt anybody
        -- can point at.
        'seed', nullif(btrim(coalesce(p_result->>'seed','')), ''),
        'iterations', nullif(btrim(coalesce(p_result->>'iterations','')), ''),
        'kernelVersion', v_kernel),
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

  -- ── THE LOGIC THE KERNEL MODELS (R5) ─────────────────────────────────────
  v_logic := sync_case_schedule_logic_support(c.id);
  if coalesce((v_logic->>'supported')::boolean, false) = false then
    v_run := record_calculation_run(
      c.id, 'case_schedule_simulation',
      'A Monte Carlo simulation was requested over this case''s schedule and was REFUSED because the schedule''s logic uses relationship types or lags the simulation kernel does not model. A distribution computed over a network different from the recorded one is worse than no distribution, because its percentiles are indistinguishable from correct ones.',
      jsonb_build_object(
        'relationshipCount', v_logic->'relationshipCount',
        'nonFinishToStartCount', v_logic->'nonFinishToStartCount',
        'laggedCount', v_logic->'laggedCount',
        'seed', nullif(btrim(coalesce(p_result->>'seed','')), ''),
        'kernelVersion', v_kernel),
      '[]'::jsonb, null,
      jsonb_build_array(v_logic->>'refusal'));
    return jsonb_build_object('error', v_logic->>'refusal',
      'nonFinishToStartCount', v_logic->'nonFinishToStartCount',
      'laggedCount', v_logic->'laggedCount',
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
     or v_seed > 4294967295 then
    return jsonb_build_object('error',
      'a simulation records the seed it was run under (seed, a whole number between 0 and 4294967295 — the kernel''s generator takes a 32-bit seed). Without a seed the numbers cannot be reproduced, and a result nobody can reproduce is not evidence.');
  end if;
  v_iter_raw := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'iterations','')), ''));
  if v_iter_raw is null or v_iter_raw = 'NaN'::numeric or v_iter_raw = 'Infinity'::numeric
     or v_iter_raw = '-Infinity'::numeric
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
  if not (v_policy->'kernelVersions' ? v_kernel) then
    return jsonb_build_object('error', format(
      'kernel version "%s" is not one this server recognises (%s). "A distribution whose code identity is unknown cannot be re-run" is not a sentence a free-text field can keep: an unpinned version makes the replayability guarantee unfalsifiable.',
      v_kernel,
      (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(v_policy->'kernelVersions'))));
  end if;

  -- ── THERE WAS SOMETHING TO SAMPLE, AND WHAT THE NETWORK BOUNDS ARE ───────
  select count(*),
         count(*) filter (where t.optimistic_hours is not null
                            and t.pessimistic_hours is not null
                            and t.pessimistic_hours > t.optimistic_hours),
         max(t.duration_hours), sum(t.duration_hours), max(t.planned_finish)
    into v_activity_count, v_ranges, v_dur_max, v_dur_sum, v_finish
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  -- Closed and archived risks are outside the chain the kernel is handed, so
  -- they are outside the count that describes what it sampled.
  select count(*) into v_risk_links from risk_schedule_impacts i
   join risks r on r.id = i.risk_id
   where i.development_case_id = c.id
     and coalesce(r.status, '') not in ('closed','archived');

  if v_ranges + v_risk_links < (v_policy->>'minimumSampledRanges')::int then
    return jsonb_build_object('error', format(
      'Nothing on this case varies. %s activity(ies) are recorded and NONE carries an optimistic and pessimistic duration, and no open risk names an activity it threatens. A simulation over fixed durations reproduces the deterministic answer with a confidence interval of zero width, and the P80 it printed would equal the plan — a spread nobody estimated, wearing the authority of a simulation.',
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
     or v_p90 = 'Infinity'::numeric
     or v_det = '-Infinity'::numeric or v_p10 = '-Infinity'::numeric
     or v_p50 = '-Infinity'::numeric or v_p80 = '-Infinity'::numeric
     or v_p90 = '-Infinity'::numeric then
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

  -- EXACT EQUALITY WAS THE WHOLE TEST, so `p10 = p50 = p80 = 1460` with
  -- `p90 = 1460.0000001` passed it: a distribution 3.6 MILLISECONDS wide,
  -- recorded as the one result this door exists to refuse. A width smaller
  -- than one part in a million of the project's own duration is below the
  -- precision the percentiles are reported at and cannot change a decision;
  -- it is a deterministic answer with percentile labels and a rounding error.
  -- Written as a multiple of the WIDTH rather than a fraction of the
  -- deterministic figure, deliberately: nothing in this slice multiplies a
  -- deterministic number, the slice test asserts that no such arithmetic
  -- exists in the SQL, and a refusal threshold that looked like a fabricated
  -- spread would be the wrong shape even where it is not one.
  if v_det > 0 and (v_p90 - v_p10) * 1000000 < v_det then
    return jsonb_build_object('error', format(
      'the P10 to P90 range is %s hours across a project of %s hours — a spread of one part in %s. That is narrower than the precision these percentiles are reported at, so it is a deterministic answer with percentile labels and a rounding error, not a distribution.',
      v_p90 - v_p10, v_det, case when (v_p90 - v_p10) > 0 then round(v_det / (v_p90 - v_p10)) else null end));
  end if;

  -- R2. THE DETERMINISTIC ANCHOR, BOUNDED BY THE NETWORK IT DESCRIBES.
  -- Sync does not recompute the critical path in SQL (090000 ruling R4), and
  -- this needs no CPM: a path through a network is at least as long as its
  -- longest activity and at most as long as all of them end to end. That is
  -- true of every network, and it is what stands between the published P50/P80
  -- DATES and an arbitrary anchor — the dates are the plan's own finish
  -- shifted by (percentile - deterministic), so this ONE number moves them.
  if v_det <= 0 or v_dur_max is null or v_dur_sum is null
     or v_det < v_dur_max - 1e-6 or v_det > v_dur_sum + 1e-6 then
    return jsonb_build_object('error', format(
      'the declared deterministic duration of %s hours is not a path through this schedule. Its activities are %s to %s hours long in total, so any critical path through them is at least %s hours (the longest single activity) and at most %s hours (all of them end to end). The P50 and P80 DATES are the plan''s own finish shifted by (percentile - deterministic), so this one number moves them both: a fabricated anchor produces a specific completion date that is simply wrong.',
      v_det, v_dur_max, v_dur_sum, v_dur_max, v_dur_sum));
  end if;

  v_onplan := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'probabilityOnPlan','')), ''));
  if v_onplan is not null then
    if v_onplan = 'NaN'::numeric or v_onplan = 'Infinity'::numeric
       or v_onplan = '-Infinity'::numeric or v_onplan < 0 or v_onplan > 1 then
      return jsonb_build_object('error', format(
        'probabilityOnPlan is %s. It is the share of iterations that finished on or before the plan, so it is a number between 0 and 1 — this field is rendered as a percentage under the heading "On plan", where 9999900%% and NaN%% are both read as a screen fault rather than as a false forecast.',
        v_onplan));
    end if;
  end if;

  -- ── THE DATES ────────────────────────────────────────────────────────────
  if v_finish is not null then
    v_p50_finish := v_finish
      + make_interval(secs => ((v_p50 - v_det) * 3600)::double precision);
    v_p80_finish := v_finish
      + make_interval(secs => ((v_p80 - v_det) * 3600)::double precision);
  else
    v_refusals := v_refusals || to_jsonb(
      'No activity on this case carries a planned finish, so the simulated overrun cannot be anchored to a calendar. The percentiles are reported in HOURS of duration; a P80 DATE would need a date to shift.'::text);
  end if;

  -- ── COST (R1). SERVER-DERIVED, NOT CLIENT-DECLARED. ──────────────────────
  v_chain := get_case_risk_schedule_chain(c.id);
  v_ev := get_case_earned_value(c.id);
  v_rate_read := get_case_delay_cost_rate(c.id);
  v_cost_base := nullif(v_ev->'metrics'->'eac'->>'value', '')::numeric;
  v_currency := nullif(btrim(coalesce(v_ev->>'currency','')), '');
  v_rate := nullif(v_rate_read->>'value', '')::numeric;

  v_cost_base_claim := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costBase','')), ''));
  v_rate_claim := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'delayCostPerDay','')), ''));
  if v_cost_base_claim is distinct from v_cost_base
     and not (v_cost_base_claim is not null and v_cost_base is not null
              and abs(v_cost_base_claim - v_cost_base) <= 1e-6) then
    return jsonb_build_object('error', format(
      'this result declares a cost base of %s and this case''s earned-value estimate at completion is %s. The cost base is not a number the client supplies — it is read here, from get_case_earned_value, because a submitted one is a cost forecast with nothing behind it. Re-read the inputs and simulate again.',
      coalesce(v_cost_base_claim::text, 'none'), coalesce(v_cost_base::text, 'refused')),
      'costBaseRefusal', v_ev->'metrics'->'eac'->'refusal');
  end if;
  if v_rate_claim is distinct from v_rate
     and not (v_rate_claim is not null and v_rate is not null
              and abs(v_rate_claim - v_rate) <= 1e-6) then
    return jsonb_build_object('error', format(
      'this result declares a cost of delay of %s per day and this case''s recorded rate is %s. The rate is read here from the financial assumption that owns it (get_case_delay_cost_rate, which refuses a negative or non-finite rate by name because it would turn every simulated slip into a benefit). Re-read the inputs and simulate again.',
      coalesce(v_rate_claim::text, 'none'), coalesce(v_rate::text, 'refused')),
      'delayCostRefusal', v_rate_read->'refusal');
  end if;

  v_exp50 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costExposureP50','')), ''));
  v_exp80 := sync_text_as_numeric(nullif(btrim(coalesce(p_result->>'costExposureP80','')), ''));

  select count(*) into v_costed_edges
  from jsonb_array_elements(coalesce(v_chain->'links','[]'::jsonb)) l
  where l.value->>'costLikely' is not null;

  if v_exp50 is not null and v_exp80 is not null then
    if v_exp50 = 'NaN'::numeric or v_exp80 = 'NaN'::numeric
       or v_exp50 = 'Infinity'::numeric or v_exp80 = 'Infinity'::numeric
       or v_exp50 = '-Infinity'::numeric or v_exp80 = '-Infinity'::numeric
       or v_exp50 < 0 or v_exp80 < v_exp50 then
      return jsonb_build_object('error', format(
        'the cost exposure percentiles are not a usable pair (P50 %s, P80 %s)', v_exp50, v_exp80));
    end if;
    if v_costed_edges = 0 and v_rate is null then
      return jsonb_build_object('error',
        'this result reports a simulated cost exposure on a case where no open risk edge carries a direct cost and no cost of delay is recorded. There is nothing on this case that turns an iteration into money, so the exposure could not have been simulated.');
    end if;
    if v_cost_base is not null then
      v_cost50 := v_cost_base + v_exp50;
      v_cost80 := v_cost_base + v_exp80;
    else
      v_refusals := v_refusals || to_jsonb(
        'The total cost P50 and P80 are absent because this case has no deterministic cost forecast to add the simulated exposure to (the earned-value EAC refused). The RISK EXPOSURE percentiles below are real and are shown as exposure, not as a cost forecast: a "cost P80" made only of the risk half would be a forecast missing the project.'::text);
    end if;
  else
    -- R10. The recorded sentence states what the SERVER found, not what the
    -- submitted payload happened to omit. The previous wording asserted that
    -- no risk edge carried a cost and no cost of delay was recorded, on cases
    -- where both were false and both are two lines away from here.
    v_refusals := v_refusals || to_jsonb(case
      when v_costed_edges = 0 and v_rate is null then
        'No cost exposure was simulated. Checked here rather than assumed: no open risk edge on this case carries a direct cost impact, and no cost of delay is recorded for it, so there is nothing that converts an iteration into money. The simulation measured time only. Spec I.10''s chain runs risk → schedule → economics and this run stops at the schedule.'
      else format(
        'The submitted result carried no cost exposure percentiles, so none are recorded. This case CAN price one: %s open risk edge(s) carry a direct cost impact and the cost of delay is %s. The run measured time only because the result offered nothing else, not because the money was unavailable.',
        v_costed_edges, coalesce(v_rate::text || ' per day', 'not recorded'))
      end::text);
  end if;

  -- ── ATTRIBUTION (D5.09): the risk exists, AND its numbers are numbers. ───
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
    select r.title into v_title
      from risk_schedule_impacts i join risks r on r.id = i.risk_id
     where i.development_case_id = c.id
       and i.risk_id::text = rec.row->>'riskId'
       and coalesce(r.status, '') not in ('closed','archived')
     limit 1;
    if v_title is null then
      return jsonb_build_object('error', format(
        'the attribution names risk %s, which has no recorded OPEN impact on this case''s schedule. A driver ranking that includes a risk the simulation never sampled is an assumed ordering wearing a computed one''s clothes.',
        coalesce(rec.row->>'riskId', '(null)')));
    end if;

    v_num := sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'occurrenceRate','')), ''));
    if v_num is null or v_num = 'NaN'::numeric or v_num = 'Infinity'::numeric
       or v_num = '-Infinity'::numeric or v_num < 0 or v_num > 1 then
      return jsonb_build_object('error', format(
        'the attribution row for "%s" declares an occurrence rate of %s. It is the share of iterations in which the risk occurred, so it is between 0 and 1.',
        v_title, coalesce(rec.row->>'occurrenceRate', 'nothing')));
    end if;

    v_hours := sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'p80HoursContribution','')), ''));
    if v_hours is null or v_hours = 'NaN'::numeric or v_hours = 'Infinity'::numeric
       or v_hours = '-Infinity'::numeric or abs(v_hours) > v_p90 then
      return jsonb_build_object('error', format(
        'the attribution row for "%s" declares a P80 contribution of %s hours against a recorded P90 of %s. A marginal contribution is the difference between two percentiles of THIS run, so it cannot exceed the run''s own P90 — a figure that does is a ranking somebody wrote, not one the simulation measured.',
        v_title, coalesce(rec.row->>'p80HoursContribution', 'nothing'), v_p90));
    end if;
    v_days := sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'p80DaysContribution','')), ''));
    if v_days is null or v_days = 'NaN'::numeric or v_days = 'Infinity'::numeric
       or v_days = '-Infinity'::numeric or abs(v_days - v_hours / 24) > 1e-6 then
      return jsonb_build_object('error', format(
        'the attribution row for "%s" declares %s hours and %s days of P80 contribution. Spec I.10 states the finding in days and the surface prints the days; two columns that disagree mean the printed sentence is not the measured number.',
        v_title, v_hours, coalesce(rec.row->>'p80DaysContribution', 'nothing')));
    end if;

    for v_num in
      select x from unnest(array[
        sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'meanCostContribution','')), '')),
        sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'p80CostContribution','')), ''))]) as x
    loop
      if v_num is not null then
        if v_exp80 is null then
          return jsonb_build_object('error', format(
            'the attribution row for "%s" declares a money contribution of %s on a run that recorded no simulated cost exposure at all. There is no exposure for it to be a share of.',
            v_title, v_num));
        end if;
        if v_num = 'NaN'::numeric or v_num = 'Infinity'::numeric
           or v_num = '-Infinity'::numeric or abs(v_num) > v_exp80 then
          return jsonb_build_object('error', format(
            'the attribution row for "%s" declares a money contribution of %s against a total simulated exposure of %s. One risk''s marginal share cannot exceed the whole.',
            v_title, v_num, v_exp80));
        end if;
      end if;
    end loop;

    -- The TITLE is the risk's, not the payload's. The surface prints it in
    -- a sentence that asserts the simulation measured this driver.
    v_attr_clean := v_attr_clean || jsonb_build_array(rec.row || jsonb_build_object('riskTitle', v_title));
  end loop;

  -- ── CRITICALITY: checked at all, for the first time. ─────────────────────
  if jsonb_typeof(p_result->'criticality') not in ('array', 'null')
     and p_result ? 'criticality' then
    return jsonb_build_object('error',
      'criticality is an array of per-activity rows, or it is absent');
  end if;
  if jsonb_array_length(v_crit) > least((v_policy->>'maximumCriticalityRows')::int, v_activity_count) then
    return jsonb_build_object('error', format(
      'this result reports a criticality index for %s rows over a schedule of %s activities. The index is one number per activity; a longer array is not a longer answer.',
      jsonb_array_length(v_crit), v_activity_count));
  end if;
  for rec in select value as row from jsonb_array_elements(v_crit) loop
    select t.label into v_label
      from shutdown_tasks t join shutdown_events e on e.id = t.event_id
     where e.organization_id = c.organization_id and e.development_case_id = c.id
       and t.id::text = rec.row->>'id';
    if v_label is null then
      return jsonb_build_object('error', format(
        'the criticality ranking names activity %s, which is not on this case''s schedule. §51 prints this list under "ranked by the simulation, not assumed", so a row naming an activity the simulation never saw is the assumed ordering that heading exists to deny.',
        coalesce(rec.row->>'id', '(null)')));
    end if;
    v_num := sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'criticalityIndex','')), ''));
    if v_num is null or v_num = 'NaN'::numeric or v_num = 'Infinity'::numeric
       or v_num = '-Infinity'::numeric or v_num < 0 or v_num > 1 then
      return jsonb_build_object('error', format(
        'the criticality index for "%s" is %s. It is the share of iterations in which the activity landed on the critical path, so it is between 0 and 1 — it is rendered as a percentage, where 4200%% is read as a screen fault rather than as a false finding.',
        v_label, coalesce(rec.row->>'criticalityIndex', 'nothing')));
    end if;
    v_num := sync_text_as_numeric(nullif(btrim(coalesce(rec.row->>'deterministicFloat','')), ''));
    if v_num is null or v_num = 'NaN'::numeric or v_num = 'Infinity'::numeric
       or v_num = '-Infinity'::numeric then
      return jsonb_build_object('error', format(
        'the criticality row for "%s" carries a deterministic float of %s, which is not a finite number of hours',
        v_label, coalesce(rec.row->>'deterministicFloat', 'nothing')));
    end if;
    v_crit_clean := v_crit_clean || jsonb_build_array(rec.row || jsonb_build_object('label', v_label));
  end loop;

  -- ── THE DISCLOSURES ──────────────────────────────────────────────────────
  if jsonb_array_length(coalesce(v_chain->'unlinkedRisks','[]'::jsonb)) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      'This distribution excludes %s open risk(s) that name no schedule activity: %s. The P80 understates exposure by exactly them.',
      jsonb_array_length(v_chain->'unlinkedRisks'),
      (select string_agg(value->>'riskTitle', '; ')
         from jsonb_array_elements(v_chain->'unlinkedRisks')))::text);
  end if;
  if v_chain->>'retiredLinkNote' is not null then
    v_refusals := v_refusals || to_jsonb(v_chain->>'retiredLinkNote');
  end if;
  if v_ranges < v_activity_count then
    v_refusals := v_refusals || to_jsonb(format(
      '%s of %s activity(ies) carry no duration range and were held FIXED in every iteration. Their contribution to the spread is understated, not zero.',
      v_activity_count - v_ranges, v_activity_count)::text);
  end if;
  if v_logic->>'assumptionNote' is not null then
    v_refusals := v_refusals || to_jsonb(v_logic->>'assumptionNote');
  end if;
  if jsonb_array_length(coalesce(v_quality->'gate'->'notDiagnosableClasses','[]'::jsonb)) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      'The gate passed on the classes it could diagnose. These could NOT be diagnosed and therefore neither passed nor failed: %s.',
      (select string_agg(value #>> '{}', ', ')
         from jsonb_array_elements(v_quality->'gate'->'notDiagnosableClasses')))::text);
  end if;
  if v_cost50 is not null then
    -- Said plainly, because two surfaces used to say the opposite: the TOTAL
    -- is a composition, not a sampled quantity.
    v_refusals := v_refusals || to_jsonb(
      'The total cost P50/P80 are the deterministic earned-value estimate at completion PLUS the simulated risk exposure at each percentile. The base itself carries no simulated uncertainty — only the exposure was sampled — so the total is as uncertain as the exposure and no more.'::text);
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
    'attributedRiskCount', jsonb_array_length(v_attr_clean),
    'activityDigest', v_digest->'activityDigest',
    'riskDigest', v_digest->'riskDigest',
    'costDigest', v_digest->'costDigest');

  v_run := record_calculation_run(
    c.id,
    'case_schedule_simulation',
    format('An integrated risk-cost-schedule Monte Carlo over this case''s schedule activities and the OPEN risks that name them, run by the %s kernel at seed %s for %s iterations and PERMITTED by a §50 Schedule Quality Score of %s. Activity durations are sampled triangularly from the optimistic/most-likely/pessimistic ranges recorded on them; each risk occurs or does not according to its own recorded probability and, when it occurs, adds a triangularly sampled delay to the activity it names. Percentiles are taken off the sorted sample of simulated project durations. Per-risk attribution is MARGINAL: the same seed and iteration count re-run with one risk suppressed, so the ranking comes out of the simulation rather than out of an assumed ordering. The kernel is deterministic given these inputs and this seed; the server pinned the inputs by digest, re-ran the quality gate, checked the schedule''s logic is logic this kernel models, read the cost base and the cost of delay from the functions that own them, and bounded the declared deterministic duration by the network — it did not re-execute the sampler.',
      v_kernel, v_seed, v_iterations, v_quality->>'score'),
    jsonb_build_object(
      'seed', v_seed,
      'iterations', v_iterations,
      'kernelVersion', v_kernel,
      'activityDigest', v_digest->'activityDigest',
      'riskDigest', v_digest->'riskDigest',
      'costDigest', v_digest->'costDigest',
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
     v_rate, v_crit_clean, v_attr_clean, v_refusals,
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
-- 12. THE READ. Three changes.
--
--     * `order by computed_at desc` had no tiebreak, and `computed_at`
--       defaults to `now()` — the TRANSACTION timestamp — so two runs recorded
--       in one transaction picked a non-deterministic "latest".
--     * `staleReason` asserted a history the row cannot know: "The schedule or
--       its risk edges have CHANGED since this simulation was recorded" is
--       false for a row whose digest never matched in the first place (which
--       is exactly what the audited service path can mint). It now says what
--       the server actually compared.
--     * `costDigest` joins the currency of the comparison, so a recorded cost
--       P50/P80 stops being current when the EAC it was added to moves.
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
  v_run_cost text;
  v_current boolean;
  v_cost_current boolean;
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
   order by computed_at desc, id desc limit 1;

  if not found then
    return jsonb_build_object(
      'caseId', c.id, 'exists', false, 'runCount', 0, 'current', false,
      'refusal', 'No simulation has been recorded for this case, so there is no distribution and therefore no P50 and no P80. A percentile is a statement about a distribution; there is no arithmetic that produces one from a deterministic figure.');
  end if;

  v_digest := sync_case_schedule_digest(c.id);
  -- The cost digest is recorded in the lineage run rather than on the ledger
  -- row (the row predates it), so the comparison reads it from there.
  select cr.inputs->>'costDigest' into v_run_cost
    from calculation_runs cr where cr.id = s.calculation_run_id;
  v_current := (s.activity_digest = v_digest->>'activityDigest')
               and (s.risk_digest = v_digest->>'riskDigest');
  v_cost_current := v_run_cost is not null and v_run_cost = (v_digest->>'costDigest');

  return jsonb_build_object(
    'caseId', c.id,
    'exists', true,
    'runCount', v_count,
    'id', s.id,
    'current', v_current,
    'costCurrent', v_cost_current,
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
      'The digest of this case''s schedule and risk edges does not match the digest this simulation recorded, so its percentiles are not about the schedule on file. They are shown as a recorded past run and NOT offered as the current forecast — a P80 a schedule change has already invalidated is more dangerous than no P80, because it is specific. Simulate again.' end,
    'costStaleReason', case when not v_current or v_cost_current then null else
      'The cost inputs this run added its exposure to have moved since it was recorded (the earned-value basis, the estimate at completion, its currency or the recorded cost of delay). The TOTAL cost percentiles are therefore not offered, even though the schedule half of this run is still current.' end);
end
$$;

revoke all on function public.get_case_schedule_simulation(uuid) from public, anon, service_role;
grant execute on function public.get_case_schedule_simulation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. §51 (R3, and the honest sentence).
--
--     `v_have := exists and current` consulted the §50 gate only in the arm
--     that runs when there is NO distribution. So a schedule that degraded
--     after a simulation was recorded — score 87.5, gate refused, one failing
--     class — kept serving `p80Finish: 2027-05-07` with `current: true` and
--     the sentence "these percentiles came off the recorded simulation named
--     below". D5.32's own evidence says the percentiles are absent when the
--     schedule fails its gate. Now they are, and the arm says which of the
--     three reasons it is.
--
--     The cost half gains the same treatment on its own inputs: the recorded
--     total is the EAC plus the exposure, so a moved EAC makes the recorded
--     total a figure about a superseded base, and it is withheld rather than
--     printed beside the live one.
--
--     And the sentence that travels with a shown percentile now describes the
--     composition it actually is. "The deterministic figure beside them was
--     not used to produce them" was true of the SCHEDULE percentiles and false
--     of the cost ones, which are literally `deterministic + exposure`.
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
  v_gate_ok boolean := false;
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

  -- ── IS THERE A DISTRIBUTION THIS FORECAST MAY USE? (R3) ──────────────────
  -- Three conditions, not two. A recorded run may be current AND about a
  -- schedule that no longer passes its §50 gate: D5.15 refuses to RECORD one
  -- over a failing schedule, which says nothing about serving an older one
  -- after the schedule degrades.
  v_gate_ok := coalesce((v_quality->'gate'->>'permitted')::boolean, false);
  v_have := coalesce((v_sim->>'exists')::boolean, false)
            and coalesce((v_sim->>'current')::boolean, false)
            and v_gate_ok;

  if v_have then
    -- The cost total is the EAC plus the exposure. If the EAC has moved (or
    -- has since refused), the recorded total is about a base that is no
    -- longer on file and it is withheld — the exposure half is still real and
    -- is still shown as exposure.
    if coalesce((v_sim->>'costCurrent')::boolean, false)
       and v_eac is not null
       and (v_sim->>'costBase') is not null
       and abs(v_eac - (v_sim->>'costBase')::numeric) <= 1e-6 then
      v_cost_p50 := (v_sim->>'costP50')::numeric;
      v_cost_p80 := (v_sim->>'costP80')::numeric;
    end if;
    v_p50_finish := (v_sim->>'p50Finish')::timestamptz;
    v_p80_finish := (v_sim->>'p80Finish')::timestamptz;
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
        v_sim->>'costStaleReason',
        case when v_eac is null then format(
          'The total cost percentiles are absent because this case has no deterministic cost forecast to add the simulated exposure to. %s The RISK EXPOSURE percentiles are real and are shown as exposure, not as a cost forecast: a "cost P80" made only of the risk half would be a forecast missing the project.',
          coalesce(v_eac_refusal, '')) end,
        case when (v_sim->>'costBase') is not null and v_eac is not null then
          'The estimate at completion has changed since this simulation was recorded, so the recorded total (that EAC plus the simulated exposure) is a figure about a superseded base. It is withheld rather than shown beside the live one.' end,
        (select string_agg(value #>> '{}', ' ') from jsonb_array_elements(v_sim->'refusals')
          where value #>> '{}' like 'The total cost P50%'
             or value #>> '{}' like 'No cost exposure%'
             or value #>> '{}' like 'The submitted result carried no cost%'),
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
         and coalesce((v_sim->>'current')::boolean, false)
         and not v_gate_ok then
      format('A simulation is recorded for this case and its inputs still match, but this case''s schedule NO LONGER passes its §50 quality diagnostics, so its percentiles are not offered as the forecast. D5.15 refuses to RUN a Monte Carlo over a failing schedule; serving one recorded before the schedule degraded would be the same claim made a day later. %s Fix the failing class and simulate again.',
        coalesce(v_quality->'gate'->>'refusal', ''))
    when coalesce((v_sim->>'exists')::boolean, false)
         and coalesce((v_sim->>'current')::boolean, false) = false then
      coalesce(v_sim->>'staleReason', 'The recorded simulation is stale.')
      || ' Until it is re-run, this forecast has a deterministic figure and no percentiles.'
    else
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
          when not v_gate_ok then
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
      -- SAID AS IT IS. The total IS the deterministic EAC plus the sampled
      -- exposure; the previous sentence denied exactly that.
      'percentileRefusal', coalesce(v_no_distribution, v_cost_refusal,
        'These totals are the deterministic estimate at completion beside them PLUS the risk exposure the recorded simulation sampled at each percentile. The base carries no simulated uncertainty of its own — only the exposure was sampled — so the spread here is the exposure''s spread and nothing else. No margin, multiplier or invented spread is applied to the deterministic figure anywhere.'),
      'composition', case when v_cost_p50 is not null then
        'deterministic estimate at completion + simulated risk exposure at this percentile' end),
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
    'scheduleConfidence', jsonb_build_object(
      'score', v_quality->'confidence',
      'qualityScore', v_quality->'score',
      'gatePermitted', v_gate_ok,
      'refusal', v_quality->'confidenceRefusal'),
    'simulation', jsonb_build_object(
      'exists', coalesce((v_sim->>'exists')::boolean, false),
      'current', coalesce((v_sim->>'current')::boolean, false),
      'gatePermitted', v_gate_ok,
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
        'A simulation is recorded, is still about this schedule, and this schedule still passes its §50 gate: %s iterations at seed %s under kernel %s, permitted by a §50 quality score of %s. The percentiles above came off its sorted sample.',
        v_sim->>'iterations', v_sim->>'seed', v_sim->>'kernelVersion', v_sim->>'qualityScore'))),
    'evaluable', (v_eac is not null or v_finish is not null or v_recorded_forecast is not null));
end
$$;

revoke all on function public.get_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.get_case_forecast_confidence(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 14. THE QUALITY READ: a content signature for staleness, and the lag class
--     counted over the same population as its own denominator.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_schedule_quality(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_policy jsonb := sync_schedule_quality_policy();
  v_n int := 0;                 -- activities on this case
  v_imported int := 0;
  v_local int := 0;
  v_rel int := 0;               -- relationships among them
  v_dated int := 0;             -- activities with BOTH planned dates
  v_ranged int := 0;            -- activities with a real duration range
  v_wbs int := 0;               -- activities resolved to a WBS element
  v_imports int := 0;           -- distinct completed import runs
  -- class counters
  v_missing int := 0;
  v_open int := 0;
  v_hard int := 0;
  v_ctype_present int := 0;
  v_long int := 0;
  v_negfloat int := 0;
  v_float_present int := 0;
  v_neglag int := 0;
  v_biglag int := 0;
  v_lag_present int := 0;
  v_peak int := 0;
  v_calendar int := 0;
  v_continuous boolean;
  v_critical int := 0;
  v_classes jsonb := '[]'::jsonb;
  v_score numeric;
  v_confidence numeric;
  v_components jsonb := '{}'::jsonb;
  v_diagnosable int := 0;
  v_weight_used numeric := 0;
  v_weighted numeric := 0;
  v_refusal text;
  v_gate_fail text[] := '{}';
  v_gate_blind text[] := '{}';
  v_range_share numeric;
  v_wbs_share numeric;
  v_history numeric;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ── the population ───────────────────────────────────────────────────────
  select count(*),
         count(*) filter (where t.origin = 'imported'),
         count(*) filter (where t.origin = 'local'),
         count(*) filter (where t.planned_start is not null and t.planned_finish is not null),
         count(*) filter (where t.optimistic_hours is not null
                            and t.pessimistic_hours is not null
                            and t.pessimistic_hours > t.optimistic_hours),
         count(*) filter (where t.wbs_element_id is not null),
         count(*) filter (where t.total_float_hours is not null),
         count(*) filter (where t.constraint_type is not null)
    into v_n, v_imported, v_local, v_dated, v_ranged, v_wbs, v_float_present, v_ctype_present
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  select count(*), count(*) filter (where d.lag_hours is not null)
    into v_rel, v_lag_present
  from shutdown_task_dependencies d
  join shutdown_events e on e.id = d.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.task_key)
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.predecessor_key);

  -- The import history: how many DISTINCT completed schedule-activity runs
  -- have landed rows on this case. One load is a snapshot; a schedule nobody
  -- has updated has no track record, which is a confidence fact, not a
  -- quality one.
  select count(distinct s.run_id) into v_imports
  from ingest_staging s
  join connector_runs cr on cr.id = s.run_id
  where s.organization_id = c.organization_id
    and s.entity_type = 'schedule_activity'
    and s.status = 'accepted'
    and exists (select 1 from shutdown_tasks t
                join shutdown_events e on e.id = t.event_id
               where e.development_case_id = c.id
                 and t.external_id = s.external_id);

  -- ── R7: too sparse to diagnose ───────────────────────────────────────────
  if v_n = 0 then
    v_refusal :=
      'This case has no schedule activities at all, so there is nothing to diagnose and nothing to score. An empty schedule passes every defect test — no missing logic, no open ends, no long durations — and scoring it 100 would be the most dangerous number this calculation could produce, because a quality score is what gates the Monte Carlo (spec II.6: "Monte Carlo on poor logic is not useful").';
  elsif v_n < (v_policy->>'minimumActivities')::int
        or v_rel < (v_policy->>'minimumRelationships')::int then
    v_refusal := format(
      'This case carries %s schedule activity(ies) and %s relationship(s). Four of §50''s six components — logic completeness, open ends, critical-path continuity and, through the dates it needs, calendar consistency — are statements about a NETWORK, and a network needs a start, a middle, an end and the links joining them. The published floor is %s activities and %s relationships, and it is not configurable: a floor a tenant can lower is a Monte Carlo gate a tenant can open. The individual defect classes below are still reported for what they are worth; the SCORE is refused.',
      v_n, v_rel,
      v_policy->>'minimumActivities', v_policy->>'minimumRelationships');
  end if;

  -- ── the nine classes ─────────────────────────────────────────────────────
  -- 1. missing logic (R1): neither a predecessor nor a successor.
  select count(*) into v_missing
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and not exists (select 1 from shutdown_task_dependencies d
                     where d.event_id = t.event_id and d.task_key = t.task_key)
    and not exists (select 1 from shutdown_task_dependencies d
                     where d.event_id = t.event_id and d.predecessor_key = t.task_key);

  -- 2. open ends (R1): exactly one side missing, minus one legitimate start
  --    and one legitimate finish per schedule (shutdown_event).
  select count(*) into v_open
  from (
    select t.event_id,
           (not exists (select 1 from shutdown_task_dependencies d
                         where d.event_id = t.event_id and d.task_key = t.task_key)) as no_pred,
           (not exists (select 1 from shutdown_task_dependencies d
                         where d.event_id = t.event_id and d.predecessor_key = t.task_key)) as no_succ
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
     where e.organization_id = c.organization_id and e.development_case_id = c.id) s
  where (s.no_pred or s.no_succ) and not (s.no_pred and s.no_succ);
  -- one dangling start and one dangling finish are what every schedule has.
  v_open := greatest(0, v_open - 2 * greatest(1, (
    select count(distinct t.event_id) from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id)));

  -- 3. excessive constraints: the HARD set only.
  select count(*) into v_hard
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.constraint_type in ('mandatory_start','mandatory_finish','start_on','finish_on');

  -- 4. long durations (R2).
  select count(*) into v_long
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.duration_hours > (v_policy->>'longDurationHours')::numeric;

  -- 5. negative float.
  select count(*) into v_negfloat
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.total_float_hours < 0;

  -- 6. unrealistic lags (R5): negative, or beyond the published limit.
  -- REPAIR. The numerator counted every dependency row on the case's events
  -- while the denominator v_rel counts only relationships whose BOTH ends are
  -- present as activities, so the share could exceed 1 on a schedule with
  -- dangling logic. Same population on both sides now.
  select count(*) filter (where d.lag_hours < 0),
         count(*) filter (where d.lag_hours > (v_policy->>'excessiveLagHours')::numeric)
    into v_neglag, v_biglag
  from shutdown_task_dependencies d
  join shutdown_events e on e.id = d.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.task_key)
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.predecessor_key);

  -- 7. critical-path continuity: is there an unbroken chain of critical
  --    activities from a schedule start to a schedule finish? Walked over
  --    the STORED relationships and P6's OWN float — no network is recomputed
  --    here (R4).
  select count(*) into v_critical
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric;

  -- CONTINUITY, DEFINED SO THAT IT CAN FAIL. "Is there a chain of critical
  -- activities?" is answered yes by any single critical activity, which is not
  -- a question worth asking. The chain must run END TO END: from a critical
  -- activity that has NO predecessor at all (a schedule start) to one that has
  -- NO successor at all (a schedule finish). A path that stops short is a date
  -- being driven by something the logic does not connect — the finding.
  --
  -- STATED LIMITATION: the float-carrying activities are walked as ONE
  -- network. A case holding two schedules (a P6 import and Sync's own
  -- activities, which are separate events by design) is continuous if the
  -- chain runs end to end anywhere in that union. Assessing each schedule
  -- separately would need a per-schedule score this row does not define, and
  -- inventing one here would put a number beside §50's name that §50 does not
  -- describe.
  if v_float_present = 0 then
    v_continuous := null;
  else
    with recursive crit as (
      select t.event_id, t.task_key
        from shutdown_tasks t
        join shutdown_events e on e.id = t.event_id
       where e.organization_id = c.organization_id and e.development_case_id = c.id
         and t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric
         and not exists (select 1 from shutdown_task_dependencies d
                          where d.event_id = t.event_id and d.task_key = t.task_key)
      union
      select t.event_id, t.task_key
        from crit
        join shutdown_task_dependencies d
          on d.event_id = crit.event_id and d.predecessor_key = crit.task_key
        join shutdown_tasks t on t.event_id = d.event_id and t.task_key = d.task_key
       where t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric)
    select exists (
      select 1 from crit
      where not exists (select 1 from shutdown_task_dependencies d
                        where d.event_id = crit.event_id
                          and d.predecessor_key = crit.task_key))
    into v_continuous;
  end if;

  -- 8. excessive concurrency: the largest number of activities in flight at
  --    once, as a share of all of them. Every planned start is a candidate
  --    instant; the peak is always at one of them.
  if v_dated > 0 then
    select coalesce(max(inflight), 0) into v_peak from (
      select (select count(*) from shutdown_tasks t2
              join shutdown_events e2 on e2.id = t2.event_id
              where e2.organization_id = c.organization_id
                and e2.development_case_id = c.id
                and t2.planned_start is not null and t2.planned_finish is not null
                and t2.planned_start <= t.planned_start
                and t2.planned_finish > t.planned_start) as inflight
        from shutdown_tasks t
        join shutdown_events e on e.id = t.event_id
       where e.organization_id = c.organization_id and e.development_case_id = c.id
         and t.planned_start is not null and t.planned_finish is not null) s;
  end if;

  -- 9. unrealistic calendars (R3): duration exceeding its own window, or a
  --    duration exactly filling a window longer than a week (24x7, forever).
  select count(*) into v_calendar
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.planned_start is not null and t.planned_finish is not null
    and (
      t.duration_hours > extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0 + 1e-6
      or (extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0 > 168
          and abs(t.duration_hours
                  - extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0) < 1e-6));

  -- ── assemble the classes ─────────────────────────────────────────────────
  -- Each row: what was counted, out of what, against which threshold, and —
  -- when it could not be counted at all — WHY, by name. A class that cannot
  -- be diagnosed never reports "pass".
  v_classes := jsonb_build_array(
    sync_schedule_defect_class('missing_logic', 'Missing logic',
      'Activities with neither a predecessor nor a successor. They float free of the network, so their dates are assertions and no delay anywhere else can reach them.',
      v_missing, v_n, v_n > 0, null, v_policy),
    sync_schedule_defect_class('open_ends', 'Open ends',
      'Activities missing exactly one side of their logic, beyond the one legitimate start and one legitimate finish every schedule has. An activity with no successor cannot push the finish date; one with no predecessor is held by nothing.',
      v_open, v_n, v_rel > 0, case when v_rel = 0 then
        'No relationships are recorded on this case at all, so every activity is an orphan rather than an open end — that is the missing-logic finding above, and reporting it twice would double-count it.' end,
      v_policy),
    sync_schedule_defect_class('excessive_constraints', 'Excessive constraints',
      'Activities carrying a HARD date constraint (mandatory start/finish, start on, finish on). A hard constraint overrides the logic: the network stops explaining the date and starts obeying it.',
      v_hard, v_n, (v_ctype_present > 0 or v_imported = 0),
      case when v_ctype_present = 0 and v_imported > 0 then
        format('None of the %s imported activity(ies) carries a constraint type, and this import cannot tell "this schedule has no constraints" from "the export did not include the constraint column". Re-export with constraint_type and this class becomes answerable.', v_imported) end,
      v_policy),
    sync_schedule_defect_class('long_durations', 'Long-duration activities',
      format('Activities longer than %s elapsed hours (44 calendar days). A duration that long is a summary of work nobody has planned, and it cannot be progressed or resourced honestly.',
             v_policy->>'longDurationHours'),
      v_long, v_n, v_n > 0, null, v_policy),
    sync_schedule_defect_class('negative_float', 'Negative float',
      'Activities P6 computed as already late against their own constraints. Negative float is not a warning about the future; it is a statement that the plan is arithmetically impossible as written.',
      v_negfloat, v_n, v_float_present > 0,
      case when v_float_present = 0 then
        'No activity on this case carries a total float. Float is P6''s own computation and Sync imports it rather than recomputing the network (a second critical path beside the modelling kernel''s would be two answers to one question). Re-export with total_float_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('unrealistic_lags', 'Unrealistic lags',
      format('Relationships with a negative lag (a successor pulled back inside its predecessor) or a lag beyond %s hours (a duration hiding in a relationship nobody resourced).',
             v_policy->>'excessiveLagHours'),
      v_neglag + v_biglag, greatest(v_rel, 1), (v_lag_present > 0 or (v_rel > 0 and v_imported = 0)),
      case when v_rel = 0 then 'No relationships are recorded, so there are no lags to assess.'
           when v_lag_present = 0 and v_imported > 0 then
        'No relationship on this case carries a lag, and this import cannot tell "every link is zero-lag" from "the export did not include the lag column". Re-export the relationships with lag_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('broken_critical_path', 'Broken critical path',
      'Whether an unbroken chain of critical activities runs from a schedule start to a schedule finish. A critical path with a hole in it means the date is being driven by something the logic does not connect.',
      case when v_continuous is null then 0 when v_continuous then 0 else 1 end,
      1, v_continuous is not null,
      case when v_float_present = 0 then
        'Continuity is walked over P6''s own float, and no activity on this case carries one. Re-export with total_float_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('excessive_concurrency', 'Excessive concurrency',
      'The largest number of activities planned to be in flight at the same instant, as a share of the schedule. A plan where a third of the work happens at once is a plan nobody has resourced.',
      v_peak, greatest(v_n, 1), v_dated > 0,
      case when v_dated = 0 then
        'No activity on this case carries both a planned start and a planned finish, so nothing can be said about what overlaps what.' end,
      v_policy),
    sync_schedule_defect_class('unrealistic_calendars', 'Unrealistic calendars',
      'Activities whose duration exceeds their own planned window (impossible under any calendar) or exactly fills a window longer than a week (a 24x7 calendar asserted across more than seven days). A calendar cannot be judged from its NAME, so it is judged from the arithmetic it implies.',
      v_calendar, greatest(v_dated, 1), v_dated > 0,
      case when v_dated = 0 then
        'No activity on this case carries both a planned start and a planned finish, so the arithmetic a calendar implies cannot be checked. The calendar NAME is recorded and is not evidence — "5x8" tells this database nothing it can verify.' end,
      v_policy));

  -- ── §50: the score over the six named components ─────────────────────────
  for rec in
    select value->>'key' as key,
           (value->>'diagnosable')::boolean as diagnosable,
           (value->>'componentScore')::numeric as component_score
      from jsonb_array_elements(v_classes)
  loop
    if rec.key in ('missing_logic','open_ends','excessive_constraints',
                   'long_durations','broken_critical_path','unrealistic_calendars') then
      if rec.diagnosable then
        v_diagnosable := v_diagnosable + 1;
        v_weight_used := v_weight_used + (v_policy->'scoreWeights'->>(
          case rec.key
            when 'missing_logic' then 'logic_completeness'
            when 'open_ends' then 'open_ends'
            when 'excessive_constraints' then 'constraints'
            when 'long_durations' then 'duration_quality'
            when 'broken_critical_path' then 'critical_path_continuity'
            else 'calendar_consistency' end))::numeric;
        v_weighted := v_weighted + rec.component_score * (v_policy->'scoreWeights'->>(
          case rec.key
            when 'missing_logic' then 'logic_completeness'
            when 'open_ends' then 'open_ends'
            when 'excessive_constraints' then 'constraints'
            when 'long_durations' then 'duration_quality'
            when 'broken_critical_path' then 'critical_path_continuity'
            else 'calendar_consistency' end))::numeric;
      else
        v_gate_blind := v_gate_blind || rec.key;
      end if;
    elsif not rec.diagnosable then
      v_gate_blind := v_gate_blind || rec.key;
    end if;
  end loop;

  if v_refusal is null and v_diagnosable < (v_policy->>'minimumDiagnosableComponents')::int then
    v_refusal := format(
      'Only %s of §50''s six components could be diagnosed on this schedule (%s). The published minimum is %s. A number computed over two components and called a "Schedule Quality Score" overstates itself by four, and it is the number that decides whether a Monte Carlo may run — so it is refused rather than scaled up from what happens to be available.',
      v_diagnosable,
      array_to_string(v_gate_blind, ', '),
      v_policy->>'minimumDiagnosableComponents');
  end if;

  if v_refusal is null and v_weight_used > 0 then
    v_score := round(v_weighted / v_weight_used, 1);
  end if;

  -- ── D5.14: confidence, which is a different question ─────────────────────
  v_range_share := case when v_n > 0 then v_ranged::numeric / v_n else 0 end;
  v_wbs_share := case when v_n > 0 then v_wbs::numeric / v_n else 0 end;
  -- One accepted load is a snapshot with no track record; the credit is
  -- capped at three loads, past which "it has been maintained" is established
  -- and more loads say nothing further.
  v_history := least(1.0, greatest(0, v_imports - 1)::numeric / 2.0);

  v_components := jsonb_build_object(
    'structure', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'structure')::numeric,
      'value', v_score,
      'basis', 'The §50 Schedule Quality Score. A schedule that is not built correctly cannot be relied on however much history it has.'),
    'uncertaintyExpressed', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'uncertainty_expressed')::numeric,
      'value', round(v_range_share * 100, 1),
      'basis', format('%s of %s activity(ies) carry an optimistic AND pessimistic duration. A single-point duration expresses a certainty the estimate does not have, and a schedule made entirely of them cannot state its own uncertainty at all.', v_ranged, v_n)),
    'importHistory', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'import_history')::numeric,
      'value', round(v_history * 100, 1),
      'basis', format('%s accepted import run(s) have landed activities on this case. One load is a snapshot; a schedule nobody has re-issued has no track record of being maintained.', v_imports)),
    'scopeAnchoring', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'scope_anchoring')::numeric,
      'value', round(v_wbs_share * 100, 1),
      'basis', format('%s of %s activity(ies) resolve to a WBS element. An activity coded to no authorized scope is work the schedule believes in and the scope baseline has never heard of.', v_wbs, v_n)));

  if v_score is not null then
    v_confidence := round(
      (v_score * (v_policy->'confidenceWeights'->>'structure')::numeric
       + v_range_share * 100 * (v_policy->'confidenceWeights'->>'uncertainty_expressed')::numeric
       + v_history * 100 * (v_policy->'confidenceWeights'->>'import_history')::numeric
       + v_wbs_share * 100 * (v_policy->'confidenceWeights'->>'scope_anchoring')::numeric)
      / 100.0, 1);
  end if;

  -- ── the gate verdict (consumed by D5.15) ─────────────────────────────────
  select coalesce(array_agg(value->>'key' order by value->>'key'), '{}'::text[])
    into v_gate_fail
    from jsonb_array_elements(v_classes)
   where value->>'severity' = 'fail';

  return jsonb_build_object(
    'caseId', c.id,
    'activityCount', v_n,
    'importedCount', v_imported,
    'localCount', v_local,
    'relationshipCount', v_rel,
    'activitiesWithPlannedDates', v_dated,
    'activitiesWithDurationRange', v_ranged,
    'activitiesWithWbs', v_wbs,
    'activitiesWithFloat', v_float_present,
    'criticalActivityCount', v_critical,
    'acceptedImportRuns', v_imports,
    'classes', v_classes,
    -- REPAIR. The staleness fingerprint on the surface was SEVEN COUNTS, and
    -- every one of the nine defect classes can flip without moving a count:
    -- durations, lags, link types, planned dates, a constraint_type on an
    -- already-constrained row, the sign of total_float_hours. Proven in
    -- review: setting duration_hours = 2000 on every activity took the live
    -- score from 100 to 81.3 and closed the gate, while the recorded run kept
    -- printing "§50 Schedule Quality Score 100" with no stale label, because
    -- all seven counts still matched. This is the content of the nine classes,
    -- computed HERE so the surface and the recorded run compare the same
    -- definition of "the diagnosis changed".
    'classSignature', (select jsonb_object_agg(value->>'key',
        coalesce(value->>'severity','-') || ':' || coalesce(value->>'count','-')
          || '/' || coalesce(value->>'denominator','-'))
      from jsonb_array_elements(v_classes)),
    'score', v_score,
    'scoreRefusal', v_refusal,
    'diagnosableComponents', v_diagnosable,
    'notDiagnosable', to_jsonb(v_gate_blind),
    'confidence', v_confidence,
    'confidenceComponents', v_components,
    'confidenceRefusal', case when v_score is null then
      'Schedule confidence is refused because the §50 quality score is refused, and structure is the largest of its four components. A confidence rating built on an unscored schedule would be a second number carrying the first number''s problem while looking like an independent opinion.' end,
    'policy', v_policy,
    'gate', jsonb_build_object(
      'permitted', (v_score is not null
                    and v_score >= (v_policy->>'minimumScoreToSimulate')::numeric
                    and coalesce(array_length(v_gate_fail, 1), 0) = 0),
      'failingClasses', to_jsonb(v_gate_fail),
      'notDiagnosableClasses', to_jsonb(v_gate_blind),
      'minimumScore', (v_policy->>'minimumScoreToSimulate')::numeric,
      'refusal', case
        when v_score is null then v_refusal
        when coalesce(array_length(v_gate_fail, 1), 0) > 0 then format(
          'A Monte Carlo will not run on this schedule. %s defect class(es) are over their published threshold: %s. Spec II.6 is explicit that "Monte Carlo on poor logic is not useful" — a simulation over a network with these defects would produce a distribution with the authority of arithmetic and the content of the defects, and the P80 it printed would be read as a forecast.',
          array_length(v_gate_fail, 1), array_to_string(v_gate_fail, ', '))
        when v_score < (v_policy->>'minimumScoreToSimulate')::numeric then format(
          'A Monte Carlo will not run on this schedule. The §50 Schedule Quality Score is %s against a published minimum of %s. No individual class is over its own threshold; the schedule fails on the composite, which is what the composite is for.',
          v_score, v_policy->>'minimumScoreToSimulate')
        end),
    'evaluable', v_n > 0);
end
$$;

revoke all on function public.get_case_schedule_quality(uuid) from public, anon, service_role;
grant execute on function public.get_case_schedule_quality(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. THE IMPORT DOOR is the other legitimate writer to the logic ledger, so
--     it declares itself the same way record_local_schedule_relationship
--     does. Nothing else about it changes.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_schedule_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
  v_source text;
  v_conn_type text;
  v_n int;
  i int;
  j int;
  row_in jsonb;
  a_ext text[] := '{}';
  a_status text[] := '{}';
  a_reason text[] := '{}';
  a_case uuid[] := '{}';
  a_event_key text[] := '{}';
  a_event_title text[] := '{}';
  a_event uuid[] := '{}';
  a_wbs text[] := '{}';
  a_descr text[] := '{}';
  a_dur numeric[] := '{}';
  a_start timestamptz[] := '{}';
  a_finish timestamptz[] := '{}';
  a_cal text[] := '{}';
  a_preds text[] := '{}';
  a_float numeric[] := '{}';
  a_ctype text[] := '{}';
  a_cdate timestamptz[] := '{}';
  a_rels jsonb[] := '{}';
  v_seen text[] := '{}';
  v_ext text;
  v_reason text;
  v_case uuid;
  v_case_title text;
  v_case_ids uuid[];
  v_sched text;
  v_event_key text;
  v_event_title text;
  v_event uuid;
  v_descr text;
  v_dur numeric;
  v_start timestamptz;
  v_finish timestamptz;
  v_float numeric;
  v_ctype text;
  v_cdate timestamptz;
  v_rels jsonb;
  rel jsonb;
  v_lag numeric;
  v_link text;
  v_tokens text[];
  v_tok text;
  v_changed boolean;
  v_resolved boolean;
  v_infile boolean;
  v_pass int := 0;
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_max_ts timestamptz;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;
  if not (r.entity_type = 'schedule_activity') then
    return jsonb_build_object('error',
      format('ingest_schedule_batch handles schedule_activity; this run is %s', r.entity_type));
  end if;

  select connector_key, connector_type into v_source, v_conn_type
    from connectors where id = r.connector_id;

  v_n := jsonb_array_length(p_rows);

  -- ── Phase A: per-row field validation, no writes ─────────────────────────
  for i in 1 .. v_n loop
    row_in := p_rows->(i - 1);
    v_read := v_read + 1;
    v_reason := null;
    v_case := null; v_case_title := null; v_event_key := null;
    v_event_title := null; v_event := null;
    v_descr := null; v_dur := null; v_start := null; v_finish := null;
    v_float := null; v_ctype := null; v_cdate := null; v_rels := '[]'::jsonb;
    v_tokens := '{}';

    v_ext := nullif(btrim(coalesce(row_in->>'external_id', row_in->>'activity_id')), '');

    if v_ext is null then
      v_reason := 'missing activity_id: a source row without a stable identifier cannot be replayed safely';
    elsif v_ext = any (v_seen) then
      v_reason := format(
        'activity_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each activity its own identifier.', v_ext);
    else
      v_seen := v_seen || v_ext;
    end if;

    if v_reason is null then
      if nullif(btrim(row_in->>'development_case_id'), '') is not null then
        begin
          v_case := (btrim(row_in->>'development_case_id'))::uuid;
        exception when others then
          v_reason := format('development_case_id "%s" is not a uuid — give case_title instead if you do not have the id',
            btrim(row_in->>'development_case_id'));
        end;
        if v_reason is null then
          select title into v_case_title from development_cases
           where organization_id = v_org and id = v_case;
          if v_case_title is null then
            v_reason := format('unknown development case "%s"', v_case);
            v_case := null;
          end if;
        end if;
      elsif nullif(btrim(row_in->>'case_title'), '') is not null then
        select array_agg(id) into v_case_ids from development_cases
         where organization_id = v_org and title = btrim(row_in->>'case_title');
        if coalesce(array_length(v_case_ids, 1), 0) = 0 then
          v_reason := format('unknown development case "%s"', btrim(row_in->>'case_title'));
        elsif array_length(v_case_ids, 1) > 1 then
          v_reason := format('development case "%s" matches %s cases — give development_case_id instead of case_title',
            btrim(row_in->>'case_title'), array_length(v_case_ids, 1));
        else
          v_case := v_case_ids[1];
          v_case_title := btrim(row_in->>'case_title');
        end if;
      else
        v_reason := 'a schedule activity must name its development case: give case_title or development_case_id';
      end if;
    end if;

    if v_reason is null then
      v_sched := coalesce(nullif(btrim(row_in->>'schedule_name'), ''), 'P6 import');
      v_event_key := 'develop:' || v_case::text || ':' || lower(v_sched);
      v_event_title := v_sched || ' — ' || v_case_title;
      select id into v_event from shutdown_events
       where organization_id = v_org and event_key = v_event_key;
    end if;

    if v_reason is null then
      v_descr := nullif(btrim(row_in->>'description'), '');
      begin
        v_dur := (nullif(btrim(row_in->>'original_duration_hours'), ''))::numeric;
        v_start := (nullif(btrim(row_in->>'planned_start'), ''))::timestamptz;
        v_finish := (nullif(btrim(row_in->>'planned_finish'), ''))::timestamptz;
        v_float := (nullif(btrim(row_in->>'total_float_hours'), ''))::numeric;
        v_cdate := (nullif(btrim(row_in->>'constraint_date'), ''))::timestamptz;
      exception when others then
        v_reason := format('the database could not read this row''s numbers or dates: %s', sqlerrm);
      end;
      if v_reason is not null then
        null;
      elsif v_descr is null then
        v_reason := 'missing description';
      elsif v_dur is null then
        v_reason := 'missing original_duration_hours — durations arrive in hours explicitly, because converting P6 duration units needs the calendar this import refuses to guess';
      elsif v_dur = 'NaN'::numeric or v_dur = 'Infinity'::numeric
            or v_dur = '-Infinity'::numeric then
        v_reason := format('original_duration_hours is %s; a duration must be a finite number of hours', v_dur);
      elsif v_dur < 0 then
        v_reason := format('original_duration_hours is %s; a duration cannot be negative', v_dur);
      elsif v_start is null then
        v_reason := 'missing or unparseable planned_start';
      elsif v_finish is null then
        v_reason := 'missing or unparseable planned_finish';
      elsif not isfinite(v_start) then
        v_reason := format('planned_start is %s; a planned date must be a finite calendar date', v_start);
      elsif not isfinite(v_finish) then
        v_reason := format('planned_finish is %s; a planned date must be a finite calendar date', v_finish);
      elsif v_finish < v_start then
        v_reason := 'planned_finish is before planned_start — an activity cannot finish before it begins';
      -- SLICE 4C: the analysis fields. Non-finite float would sit behind a
      -- negative-float finding that can never be true or false.
      elsif v_float is not null
            and (v_float = 'NaN'::numeric or v_float = 'Infinity'::numeric
                 or v_float = '-Infinity'::numeric) then
        v_reason := format('total_float_hours is %s; a float must be a finite number of hours (negative float is a legitimate, and important, value)', v_float);
      elsif v_cdate is not null and not isfinite(v_cdate) then
        v_reason := format('constraint_date is %s; a constraint date must be a finite calendar date', v_cdate);
      end if;
    end if;

    if v_reason is null then
      v_ctype := lower(nullif(btrim(coalesce(row_in->>'constraint_type', '')), ''));
      if v_ctype is not null and v_ctype not in
         ('mandatory_start','mandatory_finish','start_on','finish_on',
          'start_on_or_after','start_on_or_before','finish_on_or_after','finish_on_or_before',
          'as_late_as_possible') then
        v_reason := format('constraint_type "%s" is not a P6 constraint this import recognises: mandatory_start, mandatory_finish, start_on, finish_on, start_on_or_after, start_on_or_before, finish_on_or_after, finish_on_or_before, as_late_as_possible', v_ctype);
      elsif v_ctype is not null and v_ctype <> 'as_late_as_possible' and v_cdate is null then
        v_reason := format('constraint_type "%s" names a date constraint with no constraint_date — a constraint with no date constrains nothing and would be counted as one that does', v_ctype);
      end if;
    end if;

    if v_reason is null and nullif(btrim(coalesce(row_in->>'predecessors', '')), '') is not null then
      select coalesce(array_agg(distinct t), '{}') into v_tokens
        from (select nullif(btrim(x), '') as t
                from unnest(regexp_split_to_array(row_in->>'predecessors', '[,;]')) as x) s
       where t is not null;
      if v_ext = any (v_tokens) then
        v_reason := format('activity "%s" names itself as a predecessor — an activity cannot depend on itself', v_ext);
      end if;
    end if;

    -- SLICE 4C: relationship annotations. Optional; validated strictly.
    if v_reason is null and jsonb_typeof(row_in->'relationships') = 'array' then
      for j in 1 .. jsonb_array_length(row_in->'relationships') loop
        rel := row_in->'relationships'->(j - 1);
        v_tok := nullif(btrim(coalesce(rel->>'predecessor', '')), '');
        v_link := upper(nullif(btrim(coalesce(rel->>'link_type', '')), ''));
        v_lag := null;
        begin
          v_lag := (nullif(btrim(coalesce(rel->>'lag_hours', '')), ''))::numeric;
        exception when others then
          v_reason := format('relationship lag_hours "%s" is not a number', rel->>'lag_hours');
        end;
        if v_reason is not null then
          exit;
        elsif v_tok is null then
          v_reason := 'a relationship names the predecessor it annotates';
          exit;
        elsif not (v_tok = any (v_tokens)) then
          v_reason := format('relationship names predecessor "%s", which this row does not declare in `predecessors` — a lag attached to a relationship that does not exist is a lag nobody applied', v_tok);
          exit;
        elsif v_link is not null and v_link not in ('FS','SS','FF','SF') then
          v_reason := format('link_type "%s" is not one of FS, SS, FF, SF', v_link);
          exit;
        elsif v_lag is not null
              and (v_lag = 'NaN'::numeric or v_lag = 'Infinity'::numeric
                   or v_lag = '-Infinity'::numeric) then
          v_reason := format('lag_hours is %s; a lag must be a finite number of hours', v_lag);
          exit;
        else
          v_rels := v_rels || jsonb_build_object(
            'predecessor', v_tok, 'link_type', v_link, 'lag_hours', v_lag);
        end if;
      end loop;
    end if;

    a_ext := a_ext || v_ext;
    a_reason := a_reason || v_reason;
    a_case := a_case || v_case;
    a_event_key := a_event_key || v_event_key;
    a_event_title := a_event_title || v_event_title;
    a_event := a_event || v_event;
    a_wbs := a_wbs || nullif(btrim(coalesce(row_in->>'wbs_path', '')), '');
    a_descr := a_descr || v_descr;
    a_dur := a_dur || v_dur;
    a_start := a_start || v_start;
    a_finish := a_finish || v_finish;
    a_cal := a_cal || nullif(btrim(coalesce(row_in->>'calendar', '')), '');
    a_preds := a_preds || coalesce(array_to_string(v_tokens, ','), '');
    a_float := a_float || v_float;
    a_ctype := a_ctype || v_ctype;
    a_cdate := a_cdate || v_cdate;
    a_rels := a_rels || v_rels;

    if v_reason is not null then
      a_status := a_status || 'rejected'::text;
    elsif v_event is not null
      and exists (select 1 from shutdown_tasks t
                   where t.event_id = v_event and t.source_system = v_source
                     and t.external_id = v_ext) then
      a_status := a_status || 'duplicate'::text;
    else
      a_status := a_status || 'pending'::text;
    end if;
  end loop;

  -- ── Phase B: predecessor fixpoint ────────────────────────────────────────
  loop
    v_changed := false;
    v_pass := v_pass + 1;
    for i in 1 .. v_n loop
      if a_status[i] = 'pending' and a_preds[i] <> '' then
        foreach v_tok in array string_to_array(a_preds[i], ',') loop
          v_resolved := false;
          if a_event[i] is not null
             and exists (select 1 from shutdown_tasks t
                          where t.event_id = a_event[i] and t.task_key = v_tok) then
            v_resolved := true;
          else
            for j in 1 .. v_n loop
              if j <> i and a_status[j] in ('pending', 'duplicate')
                 and a_ext[j] = v_tok and a_event_key[j] = a_event_key[i] then
                v_resolved := true;
                exit;
              end if;
            end loop;
          end if;
          if not v_resolved then
            v_infile := false;
            for j in 1 .. v_n loop
              if j <> i and a_ext[j] = v_tok
                 and a_event_key[j] is not distinct from a_event_key[i] then
                v_infile := true;
                exit;
              end if;
            end loop;
            if v_infile then
              a_reason[i] := format('predecessor "%s" was refused in this upload; an activity cannot depend on a row that did not land. Fix that row and upload the file again.', v_tok);
            else
              a_reason[i] := format('unknown predecessor "%s": not already in this schedule and not a valid row of this upload. Predecessors are plain activity ids; relationship type and lag ride the optional `relationships` array.', v_tok);
            end if;
            a_status[i] := 'rejected';
            v_changed := true;
            exit;
          end if;
        end loop;
      end if;
    end loop;
    exit when not v_changed or v_pass > v_n;
  end loop;

  -- ── Phase C: writes, per-row subtransactions, staging for every row ──────
  for i in 1 .. v_n loop
    v_reason := a_reason[i];

    if a_status[i] = 'pending' then
      begin
        v_event := a_event[i];
        if v_event is null then
          select id into v_event from shutdown_events
           where organization_id = v_org and event_key = a_event_key[i];
          if v_event is null then
            insert into shutdown_events (organization_id, event_key, title, status, development_case_id)
            values (v_org, a_event_key[i], a_event_title[i], 'planning', a_case[i])
            on conflict (organization_id, event_key) do update
              set development_case_id = excluded.development_case_id
            returning id into v_event;
          end if;
        end if;

        -- The door names itself to the provenance wall (20261130090100).
        perform set_config('app.schedule_activity_write', 'granted', true);
        insert into shutdown_tasks (event_id, task_key, label, duration_hours,
          wbs_path, planned_start, planned_finish, calendar_name,
          source_system, external_id, origin,
          total_float_hours, constraint_type, constraint_date)
        values (v_event, a_ext[i], a_descr[i], a_dur[i],
          a_wbs[i], a_start[i], a_finish[i], a_cal[i],
          v_source, a_ext[i], 'imported',
          a_float[i], a_ctype[i], a_cdate[i]);
        perform set_config('app.schedule_activity_write', '', true);

        if a_preds[i] <> '' then
          -- The logic ledger now carries its own wall (repair ruling R8), and
          -- the import door is one of its two legitimate writers.
          perform set_config('app.schedule_logic_write', 'import', true);
          foreach v_tok in array string_to_array(a_preds[i], ',') loop
            insert into shutdown_task_dependencies
              (event_id, task_key, predecessor_key, link_type, lag_hours)
            values (v_event, a_ext[i], v_tok,
              (select nullif(btrim(coalesce(x->>'link_type','')),'')
                 from jsonb_array_elements(a_rels[i]) x
                where x->>'predecessor' = v_tok limit 1),
              (select (nullif(btrim(coalesce(x->>'lag_hours','')),''))::numeric
                 from jsonb_array_elements(a_rels[i]) x
                where x->>'predecessor' = v_tok limit 1))
            on conflict (event_id, task_key, predecessor_key) do nothing;
          end loop;
          perform set_config('app.schedule_logic_write', '', true);
        end if;

        v_max_ts := greatest(coalesce(v_max_ts, now()), now());
        a_status[i] := 'accepted';
      exception
        when unique_violation then
          v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
          a_status[i] := 'rejected';
        when others then
          v_reason := format('the database refused this row: %s', sqlerrm);
          a_status[i] := 'rejected';
      end;
      perform set_config('app.schedule_activity_write', '', true);
    end if;

    if a_status[i] = 'accepted' then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'accepted');
    elsif a_status[i] = 'duplicate' then
      v_dup := v_dup + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'duplicate');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'rejected', v_reason);
    end if;
  end loop;

  update connector_runs
  set records_read = records_read + v_read,
      records_accepted = records_accepted + v_ok,
      records_rejected = records_rejected + v_rej,
      records_duplicate = records_duplicate + v_dup,
      watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;

-- `create or replace` PRESERVES an ACL, so restating it here is defensive
-- rather than necessary — and it is the point: a file that re-created the
-- body and stayed silent about the grants would leave the closed posture
-- resting on a migration nobody reads any more, and a later
-- drop-and-recreate would open it.
revoke all on function public.ingest_schedule_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_schedule_batch(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
