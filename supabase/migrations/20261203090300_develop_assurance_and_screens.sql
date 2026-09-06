-- ============================================================================
-- Sync Develop Slice 4D (4 of 4) — THE SYNC ASSURANCE ENGINE AND THE TWO
-- SCREENS.
--
-- D5.21 (Sync Assurance engine, composed module), D13.08 (Integrated Controls
-- screen — six control dimensions, one view) and D13.02 (My Decisions screen —
-- per-user queue, seven columns).
--
-- ── THE ONE RULE THIS FILE OBEYS ───────────────────────────────────────────
--
-- THESE READS COMPOSE RECORDED RUNS. THEY DO NOT COMPUTE.
--
-- Every number on the Integrated Controls screen already exists as a row in
-- `calculation_runs`, put there by a compute_* function in Slice 4A, 4B, 4C or
-- 4D. This file selects the LATEST run per key and hands it to the surface. It
-- does not re-derive a single figure, because a screen that recomputes is a
-- second source of truth: the moment its arithmetic drifts from the kernel's —
-- a rounding difference, a filter, a fixed bug on one side — the product shows
-- a number nobody can trace, sitting under a lineage block describing a
-- different one.
--
-- SO A DIMENSION WITH NO RECORDED RUN SAYS "NO RUN RECORDED". It does not fall
-- back to the live read. Falling back is precisely how 4A shipped money figures
-- with no calculation_runs row behind them, and how 4B's forecast panel printed
-- "not available" percentiles under a caption claiming they came off a
-- recorded simulation.
--
-- AND THESE COMPOSITIONS RECORD NO RUN OF THEIR OWN. A lineage row asserts
-- that a calculation happened; a composition performs none, and minting one
-- would put a method, a version and an input digest behind numbers this file
-- did not produce. The screens read `calculation_runs`; they never write it.
--
-- ── D5.21: WHAT "COMPOSED MODULE" MEANS HERE ───────────────────────────────
--
-- Spec: "Sync Assurance — estimate quality, schedule quality, progress
-- integrity, independent challenge." The register recorded 1 of 4 constituents
-- live (independent challenge). The other three landed in 4B and 4C. This is
-- therefore a COMPOSITION row and nothing here is a new primitive: if this file
-- needed to build one, that would be the signal it had over-reached.
--
-- ── D13.02: SEVEN COLUMNS, AND THE ONE THAT DID NOT EXIST ──────────────────
--
-- Spec §44: "My Decisions (decision, project, value at stake, risk, due,
-- recommendation, confidence)." A live risk-scoped queue already exists
-- (get_risk_decision_operations.my_decisions, 20260921110102:2148). What the
-- register named as missing was cross-domain coverage, due-date and latency
-- columns, and the assumption-reopened flag. All three are added HERE, over the
-- SAME canonical `decisions` table — not a second queue.
--
-- Canonical reuse: calculation_runs, decisions, risks, project_changes,
-- contingency_ledger_entries, risk_assurance_reviews, assurance_case_claims,
-- development_cases. Nothing new is persisted by this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE LATEST RUN PER KEY, IN ONE PLACE.
--
--    Returns null when nothing has been recorded, and the caller is required
--    to say so. Every screen in this file goes through here so that "there is
--    no run" is one sentence with one meaning.
-- ---------------------------------------------------------------------------
-- REVIEW REPAIR (4D-R24) — THE ONE CROSS-TENANT HOLE IN THE SLICE.
--
-- As first written this was SECURITY DEFINER (so RLS off), granted to
-- `authenticated`, took an arbitrary case uuid and never called
-- app_current_org(). PostgREST exposes it directly, so any signed-in
-- identity — including one with no user_profiles row at all, for which
-- app_current_org() is null and every other 4D RPC returns `forbidden` —
-- could read the FULL recorded payload of every calculation in the product
-- for any case uuid: another tenant's contingency totals and ledger entry
-- ids, their earned-value suite, their decision-debt figure and the
-- decision question quoted verbatim in the refusal text, plus the email of
-- whoever computed it.
--
-- The canonical sibling reader `get_case_calculation_lineage`
-- (20261130090600) carries the gate; the two OTHER internal helpers with
-- this shape (sync_contingency_authority, sync_change_authority) were
-- revoked from `authenticated` in this same slice with a comment explaining
-- why. This one was missed because definerTenancy.test.ts keys on argument
-- NAMES matching /(org|organization|tenant)/ and this takes `p_case_id`.
--
-- Both fixes are applied, not one: the org predicate is IN the function, so
-- it holds even if the grant is ever restored, AND the grant is revoked from
-- every client role, because there is no non-test client caller — its only
-- callers are the two screen definers below, which are owned by the
-- migration role and execute it regardless of these grants.
create or replace function public.sync_latest_calculation_run(
  p_case_id uuid,
  p_key text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'calculationKey', r.calculation_key, 'method', r.method,
    'codeVersion', r.code_version, 'inputs', r.inputs, 'inputRefs', r.input_refs,
    'outputs', r.outputs, 'refusals', r.refusals, 'status', r.status,
    'computedAt', r.computed_at,
    'computedBy', (select email from user_profiles up where up.id = r.computed_by))
  from calculation_runs r
  join development_cases dc on dc.id = r.development_case_id
  where r.development_case_id = p_case_id
    and r.calculation_key = p_key
    and app_current_org() is not null
    and r.organization_id = app_current_org()
    and dc.organization_id = app_current_org()
  order by r.computed_at desc
  limit 1;
$$;

revoke all on function public.sync_latest_calculation_run(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. D5.21 — THE SYNC ASSURANCE ENGINE, COMPOSED.
--
--    Four constituents, four recorded runs (or four honest absences), plus the
--    independent-challenge leg which is a review record rather than a
--    calculation and is reported as such.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_assurance_engine(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_estimate jsonb;
  v_quality jsonb;
  v_integrity jsonb;
  v_challenge jsonb;
  v_reviews jsonb;
  v_claims jsonb;
  v_live int := 0;
  v_missing jsonb := '[]'::jsonb;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  v_estimate  := sync_latest_calculation_run(c.id, 'case_estimate_confidence');
  v_quality   := sync_latest_calculation_run(c.id, 'case_schedule_quality');
  v_integrity := sync_latest_calculation_run(c.id, 'case_progress_integrity');

  -- The fourth constituent is not a calculation: independent challenge is a
  -- REVIEW somebody performed, with a competence record and a declared
  -- conflict position. It is composed as what it is rather than forced into a
  -- run so the four look symmetrical.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'subjectType', r.subject_type, 'assuranceLevel', r.assurance_level,
      'status', r.status, 'conclusion', r.conclusion, 'dueDate', r.due_date,
      'completedAt', r.completed_at,
      'reviewer', (select email from user_profiles up where up.id = r.reviewer_id),
      'conflictsDeclaredAt', r.conflicts_declared_at,
      'competencyKeys', r.reviewer_competency_keys) order by r.created_at desc), '[]'::jsonb)
    into v_reviews
  from risk_assurance_reviews r
  where r.organization_id = v_org
    and (r.subject_type = 'development_case' and r.subject_id = c.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cl.id, 'claimRef', cl.claim_ref, 'statement', cl.statement,
      'claimType', cl.claim_type, 'position', cl.claim_position,
      'positionBasis', cl.position_basis,
      'positionBy', (select email from user_profiles up where up.id = cl.position_by),
      'positionAt', cl.position_at) order by cl.claim_ref), '[]'::jsonb)
    into v_claims
  from assurance_case_claims cl
  where cl.organization_id = v_org and cl.development_case_id = c.id;

  v_challenge := jsonb_build_object(
    'reviews', v_reviews,
    'reviewCount', jsonb_array_length(v_reviews),
    'completedCount', (select count(*) from jsonb_array_elements(v_reviews)
                        where value->>'completedAt' is not null),
    'claims', v_claims,
    'claimCount', jsonb_array_length(v_claims),
    'refusal', case when jsonb_array_length(v_reviews) = 0 and jsonb_array_length(v_claims) = 0 then
      'No independent review and no assurance claim exists for this case. Independent challenge is the one constituent of Sync Assurance that is not a calculation — it is a person, with declared competence and declared conflicts, disagreeing on the record — and there is nobody on this record yet.' end);

  -- REVIEW REPAIR (4D-R25). A REFUSED RUN IS NOT A LIVE CONSTITUENT. The
  -- variable is the whole run jsonb, non-null whenever ANY run exists — so a
  -- case whose estimate-confidence, schedule-quality and progress-integrity
  -- runs had all REFUSED reported "3 of 4 constituents are live on this case",
  -- which is precisely the three the case does not have.
  if v_estimate is not null and v_estimate->>'status' <> 'refused' then v_live := v_live + 1;
  elsif v_estimate is not null then
    v_missing := v_missing || to_jsonb('estimate quality: the last recorded case_estimate_confidence run REFUSED, so this constituent is not live — its reasons are shown on the tile.'::text);
  else
    v_missing := v_missing || to_jsonb('estimate quality: no case_estimate_confidence run has been recorded (compute_case_estimate_confidence). The screen shows NO RUN RECORDED rather than falling back to the live read, because a figure with no lineage under a lineage caption is the failure this convention exists to prevent.'::text); end if;
  if v_quality is not null and v_quality->>'status' <> 'refused' then v_live := v_live + 1;
  elsif v_quality is not null then
    v_missing := v_missing || to_jsonb('schedule quality: the last recorded case_schedule_quality run REFUSED, so this constituent is not live.'::text);
  else
    v_missing := v_missing || to_jsonb('schedule quality: no case_schedule_quality run has been recorded (compute_case_schedule_quality).'::text); end if;
  if v_integrity is not null and v_integrity->>'status' <> 'refused' then v_live := v_live + 1;
  elsif v_integrity is not null then
    v_missing := v_missing || to_jsonb('progress integrity: the last recorded case_progress_integrity run REFUSED, so this constituent is not live.'::text);
  else
    v_missing := v_missing || to_jsonb('progress integrity: no case_progress_integrity run has been recorded (compute_case_progress_integrity).'::text); end if;
  if (v_challenge->>'refusal') is null then v_live := v_live + 1; else
    v_missing := v_missing || to_jsonb((v_challenge->>'refusal')::text); end if;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'constituents', jsonb_build_object(
      'estimateQuality', jsonb_build_object('kind', 'run', 'key', 'case_estimate_confidence',
        'run', v_estimate,
        'refusal', case when v_estimate is null then
          'No estimate-confidence run recorded for this case.' end),
      'scheduleQuality', jsonb_build_object('kind', 'run', 'key', 'case_schedule_quality',
        'run', v_quality,
        'refusal', case when v_quality is null then
          'No schedule-quality run recorded for this case.' end),
      'progressIntegrity', jsonb_build_object('kind', 'run', 'key', 'case_progress_integrity',
        'run', v_integrity,
        'refusal', case when v_integrity is null then
          'No progress-integrity run recorded for this case.' end),
      'independentChallenge', v_challenge || jsonb_build_object('kind', 'record')),
    'constituentsLive', v_live,
    'constituentsTotal', 4,
    'missing', v_missing,
    -- The engine has no score. Four constituents measuring four different
    -- things do not average into an assurance number, and inventing a weighting
    -- would be the "do not pretend universal science" failure §46 names.
    'compositeRefusal',
      'Sync Assurance publishes no single assurance score. Estimate confidence, schedule quality, progress integrity and independent challenge measure four different things on four different scales; averaging them would produce a headline nobody could defend and would let a strong estimate hide a schedule nobody can simulate. The four are shown side by side, each with its own refusals.',
    'notInThisSlice', jsonb_build_array(
      'Cross-case (portfolio) assurance rollup is not composed here. It is the Sync Portfolio engine row (D10.06) and needs a portfolio surface that does not exist yet.'));
end
$$;

revoke all on function public.get_case_assurance_engine(uuid) from public, anon, service_role;
grant execute on function public.get_case_assurance_engine(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. D13.08 — THE INTEGRATED CONTROLS SCREEN. Six dimensions, one view.
--
--    Spec §44: "Integrated Controls (scope, schedule, cost, risk, change,
--    procurement in one coherent view)."
--
--    Each dimension is: the LATEST RECORDED RUN for its key, the run's own
--    refusals, and — where a dimension has no run — the sentence saying so.
--    PROCUREMENT is reported as ABSENT BY NAME: there is no procurement
--    calculation in Slice 4 at all, and a blank sixth tile would read as a
--    procurement position of nothing.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_integrated_controls(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_dims jsonb := '[]'::jsonb;
  v_run jsonb;
  v_dim jsonb;
  v_with_run int := 0;
  v_refused int := 0;
  v_stale_hint jsonb;
  rec record;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  for rec in
    select * from (values
      ('scope',       'Scope',       'case_scope_growth', false,
       'Post-baseline scope growth attributed to the baseline it grew against (D5.03).'),
      ('schedule',    'Schedule',    'case_schedule_quality', false,
       'The nine II.6 defect classes and the §50 Schedule Quality Score that gates the simulation (D5.13/D5.31).'),
      ('cost',        'Cost',        'case_earned_value', false,
       'The earned-value suite: CV, SV, CPI, SPI, EAC, ETC, VAC (D5.05/D5.06).'),
      ('risk',        'Risk',        'case_risk_schedule_economics', false,
       'The risk to schedule to money chain: which risks drive the P80 and what they cost in days (D5.08).'),
      ('change',      'Change',      'case_change_control', true,
       'Approved change carried in money and days, and how much of it has reached what it moves (D5.27/D5.30).'),
      ('contingency', 'Contingency', 'case_contingency_consumption', true,
       'Contingency consumption attributed by cause, against the fund it was drawn from (D5.18/D5.19)')
    ) as t(key, label, calc_key, checkable, what)
  loop
    v_run := sync_latest_calculation_run(c.id, rec.calc_key);
    v_dim := jsonb_build_object(
      'key', rec.key, 'label', rec.label, 'calculationKey', rec.calc_key,
      'what', rec.what, 'run', v_run,
      -- REVIEW REPAIR (4D-R26). WHETHER A TILE'S CURRENCY CAN BE CHECKED HERE
      -- IS ITSELF A FACT THE SCREEN STATES.
      --
      -- Every tile used to print `codeVersion · date` unconditionally, with no
      -- staleness path at all — so an earned-value run from before three cost
      -- re-baselines rendered identically to a fresh one, and the contingency
      -- tile printed a clean caption directly above a section saying "the
      -- ledger has moved since this run was recorded". `currentFingerprints`
      -- below now carries the digests for the four dimensions whose
      -- fingerprint this screen can re-derive WITHOUT running their kernel
      -- (contingency, change, and both decision calculations). For scope,
      -- schedule, cost and risk the kernel's fingerprint (basisDigest, the
      -- traceability link count, the policy digests) cannot be produced here
      -- without performing that kernel's own read — which is the one thing this
      -- screen must not do. Those tiles therefore say the currency of the
      -- figure was NOT checked here rather than printing a clean caption that
      -- implies it was. An unchecked caption and a checked one must not look
      -- the same.
      'stalenessCheckable', rec.checkable,
      'stalenessNote', case when rec.checkable then null else format(
        'The currency of this figure is not checked on this screen: %s records a fingerprint this composition cannot reproduce without performing that calculation''s own read, and a screen that ran a kernel to decide whether to trust it would be recomputing. Open the %s panel, where the live read and the recorded run sit side by side, to see whether it is still current.',
        rec.calc_key, lower(rec.label)) end,
      -- The screen NEVER renders a blank where a number belongs. Either there
      -- is a run with outputs, or there is a sentence.
      'refusal', case
        when v_run is null then format(
          'No %s run has been recorded for this case, so there is nothing to show here. This is not a value of zero and it is not an error: the calculation has simply never been run (%s). The live read is deliberately not used as a fallback — a figure taken from it would be a number with no lineage sitting under a lineage caption.',
          rec.calc_key, 'compute_' || rec.calc_key)
        when v_run->>'status' = 'refused' then
          'The last recorded run of this calculation REFUSED. Its reasons are listed; there are no figures because the calculation declined to produce any.'
        end);
    if v_run is not null then
      v_with_run := v_with_run + 1;
      if v_run->>'status' = 'refused' then v_refused := v_refused + 1; end if;
    end if;
    v_dims := v_dims || jsonb_build_array(v_dim);
  end loop;

  -- The seventh thing §44 names, reported as absent rather than omitted. A
  -- five-of-six view that quietly dropped procurement would be a "one coherent
  -- view" claim with a hole in it.
  v_dims := v_dims || jsonb_build_array(jsonb_build_object(
    'key', 'procurement', 'label', 'Procurement', 'calculationKey', null,
    'what', 'Package status, long-lead exposure and supplier performance (spec §25/§44).',
    'run', null,
    'refusal',
      'Procurement is the sixth dimension spec §44 names and NO procurement calculation exists in Sync Develop yet. It is shown here, empty and labelled, rather than left out of the view: a five-tile "integrated controls" screen would quietly redefine what integrated means, and a reader would have no way to tell that the missing dimension was missing rather than clean.'));

  -- The staleness signal the surface needs, computed from the RUNS' own input
  -- digests against the current ones. This is a comparison, not a
  -- recalculation: each digest is produced by the compute function that
  -- recorded the run, and read back here.
  v_stale_hint := jsonb_build_object(
    'ledgerDigest', coalesce((
      select md5(string_agg(e.id::text || '~' || e.entry_type || '~' || e.amount::text
                            || '~' || coalesce(e.cause_class, '-')
                            || '~' || e.balance_after::text, '|' order by e.recorded_at, e.entry_no))
        from contingency_ledger_entries e
        join project_contingency_pools p on p.id = e.pool_id
       where p.development_case_id = c.id), 'empty'),
    'changeDigest', coalesce((
      select md5(string_agg(ch.id::text || '~' || ch.status
                            || '~' || coalesce(ch.cost_effect::text, '-')
                            || '~' || coalesce(ch.schedule_effect_days::text, '-')
                            || '~' || coalesce(ch.risk_effect, '-')
                            || '~' || coalesce(ch.competence_signed_at::text, '-'),
                            '|' order by ch.created_at, ch.id))
        from project_changes ch where ch.development_case_id = c.id), 'empty'),
    'propagationDigest', coalesce((
      select md5(string_agg(pp.id::text || '~' || pp.status, '|' order by pp.created_at, pp.id))
        from project_change_propagation pp
        join project_changes ch on ch.id = pp.change_id
       where ch.development_case_id = c.id), 'empty'),
    -- The DECISION digests, byte-identical to the expressions
    -- compute_case_decision_latency and compute_case_decision_debt record
    -- (20261203090200). Without them the decision panel printed LIVE-READ
    -- figures under a lineage caption describing an older run, and
    -- `performanceRunIsStale` had nothing to compare — the same 4B failure this
    -- convention exists to prevent, reproduced one screen along.
    'policyDigest', md5(sync_decision_latency_policy()::text),
    'decisionDigest', coalesce((
      select md5(string_agg(dec.id::text
                            || '~' || coalesce(dec.decision_required_date::text, '-')
                            || '~' || coalesce(dec.selected_at::text, '-')
                            || '~' || coalesce(dec.approval_status, '-'),
                            '|' order by dec.created_at, dec.id))
        from decisions dec
       where dec.organization_id = c.organization_id
         and dec.development_case_id = c.id), 'empty'),
    'linkDigest', coalesce((
      select md5(string_agg(l.decision_id::text || '~' || l.shutdown_task_id::text
                            || '~' || coalesce(t.total_float_hours::text, '-'),
                            '|' order by l.decision_id, l.shutdown_task_id))
        from decision_schedule_links l
        join shutdown_tasks t on t.id = l.shutdown_task_id
       where l.development_case_id = c.id), 'empty'),
    'exposureDigest', coalesce((
      select md5(string_agg(x.decision_id::text || '~' || x.expected_impact::text
                            || '~' || x.probability_of_delay::text || '~' || x.currency,
                            '|' order by x.decision_id))
        from (select distinct on (e.decision_id) e.*
                from decision_delay_exposures e
               where e.development_case_id = c.id
               order by e.decision_id, e.recorded_at desc) x), 'empty'),
    'openDecisionDigest', coalesce((
      select md5(string_agg(dec.id::text || '~' || coalesce(dec.decision_required_date::text, '-'),
                            '|' order by dec.id))
        from decisions dec
       where dec.organization_id = c.organization_id
         and dec.development_case_id = c.id
         and dec.selected_at is null
         and coalesce(dec.approval_status, 'pending') = 'pending'), 'empty'));

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'caseStatus', c.status,
    'stageKey', c.current_stage_key,
    'dimensions', v_dims,
    'dimensionsWithRun', v_with_run,
    'dimensionsTotal', 7,
    'refusedRunCount', v_refused,
    'currentFingerprints', v_stale_hint,
    'decisionLatency', sync_latest_calculation_run(c.id, 'case_decision_latency'),
    'decisionDebt', sync_latest_calculation_run(c.id, 'case_decision_debt'),
    'composedNotComputed',
      'Every figure on this screen is read from a recorded calculation run. This read computes nothing and records nothing: a screen that recomputed would be a second source of truth, and the first time its arithmetic drifted from the kernel''s the product would be showing a number nobody could trace.',
    'notInThisSlice', jsonb_build_array(
      'Procurement has no calculation in Sync Develop yet; the dimension is shown empty and named rather than omitted.'));
end
$$;

revoke all on function public.get_case_integrated_controls(uuid) from public, anon, service_role;
grant execute on function public.get_case_integrated_controls(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. D13.02 — MY DECISIONS. The per-user queue, seven columns.
--
--    Spec §44: decision, project, value at stake, risk, due, recommendation,
--    confidence.
--
--    CROSS-DOMAIN, over the ONE canonical decisions table (overlap-map ruling
--    4). The existing risk-scoped queue reached only risk-linked rows; this one
--    reaches development-case decisions too, and carries the three columns the
--    register named as missing: the DUE date, the LATENCY against it, and the
--    assumption-reopened flag (`reassessment_required`) — a decision whose
--    basis has been invalidated is a different queue item from one nobody has
--    got to yet, and showing them identically is how a reopened decision goes
--    quiet.
--
--    WHOSE QUEUE. A decision is the caller's when they own it, when they raised
--    it, or when an approval on it is routed to their role. It is NOT everyone's
--    by default: a "my decisions" list that shows every pending decision in the
--    organization is a decisions list, and the personal accountability §44 is
--    describing disappears into it. Administrators and executives see the whole
--    queue, and the payload says which of the two it is showing.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_decisions(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
  v_all_rows jsonb := '[]'::jsonb;
  v_all boolean;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_crit numeric := (sync_decision_latency_policy()->>'criticalFloatHours')::numeric;
  v_total int;
  v_overdue int;
  v_reopened int;
  v_undated int;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  -- The dual-caller gate is auth.uid(): a queue is personal, and a caller with
  -- no signed-in identity has no personal queue to show.
  if v_uid is null then
    return jsonb_build_object('error',
      'My Decisions is a per-user queue and there is no signed-in user on this call.');
  end if;
  select role into v_role from user_profiles where id = v_uid and organization_id = v_org;
  if v_role is null then return jsonb_build_object('error', 'forbidden'); end if;
  v_all := v_role in ('admin','executive');

  with mine as (
    select d.*,
      (select count(*) from decision_schedule_links l
        join shutdown_tasks t on t.id = l.shutdown_task_id
        where l.decision_id = d.id and t.total_float_hours is not null
          and t.total_float_hours <= v_crit) as critical_links,
      (select count(*) from decision_schedule_links l where l.decision_id = d.id) as link_count
    from decisions d
    left join approvals a on a.decision_id = d.id and a.organization_id = v_org
    where d.organization_id = v_org
      and d.selected_at is null
      and coalesce(d.approval_status, 'pending') = 'pending'
      and (d.risk_id is null or can_read_risk(d.risk_id))
      and (v_all
           or d.owner_id = v_uid
           or d.raised_by = v_uid
           or a.owner_role = v_role)
    group by d.id
  ), latest_exposure as (
    select distinct on (e.decision_id) e.* from decision_delay_exposures e
    join mine m on m.id = e.decision_id
    order by e.decision_id, e.recorded_at desc
  )
  -- The WHOLE queue is materialised once, ordered; the page is taken from it
  -- afterwards (4D-R28), so the counts and the page can never disagree.
  select coalesce(jsonb_agg(row_json order by sort_due nulls last, sort_value desc nulls last), '[]'::jsonb)
    into v_all_rows
  from (
    select
      m.decision_required_date as sort_due,
      coalesce(m.decision_value, r.value_at_risk) as sort_value,
      jsonb_build_object(
        -- 1. decision
        'decisionId', m.id,
        'decision', coalesce(m.decision_question, m.action_taken, m.decision_type, 'Untitled decision'),
        'decisionType', m.decision_type,
        -- 2. project (the development case, or the risk it hangs off)
        'caseId', m.development_case_id,
        'project', coalesce(dc.title, r.title),
        'domain', case when m.development_case_id is not null then 'development_case'
                       when m.risk_id is not null then 'risk' else 'operating_loop' end,
        -- 3. value at stake
        'valueAtStake', coalesce(m.decision_value, r.value_at_risk),
        'currency', coalesce(m.decision_currency, r.value_currency),
        'valueRefusal', case when coalesce(m.decision_value, r.value_at_risk) is null then
          'No value at stake is recorded for this decision. It is shown as absent rather than as zero — a decision worth nothing and a decision nobody has valued are different things.' end,
        -- 4. risk
        'riskId', m.risk_id,
        'riskTitle', r.title,
        'riskLevel', coalesce(m.residual_risk_level, r.current_risk_level),
        'riskScore', r.current_risk_score,
        -- 5. due  (the register's first missing column)
        'dueDate', m.decision_required_date,
        'latencyDays', case when m.decision_required_date is null then null
          else round(extract(epoch from (now() - m.decision_required_date::timestamptz)) / 86400.0, 1) end,
        'overdue', case when m.decision_required_date is null then null
          else m.decision_required_date < current_date end,
        'dueRefusal', case when m.decision_required_date is null then
          'This decision carries no required date, so it has no latency and cannot be ranked as overdue. It sits at the bottom of the queue and says why, rather than appearing to be on time.' end,
        -- the register's third missing column: the reopened assumption
        'reassessmentRequired', m.reassessment_required,
        'reassessmentReason', m.reassessment_reason,
        -- 6. recommendation
        'recommendationId', m.recommendation_id,
        'recommendation', rec.action,
        'recommendationStatus', rec.status,
        'recommendationRefusal', case when m.recommendation_id is null then
          'No recommendation is attached to this decision. The queue shows the gap rather than an empty cell, because "nothing recommended" and "a recommendation nobody has recorded" look identical otherwise.' end,
        -- 7. confidence
        'confidence', m.confidence_score,
        -- ...and the critical-path column §54 adds to the seven.
        'linkedActivities', m.link_count,
        'onCriticalPath', case when m.link_count = 0 then null else m.critical_links > 0 end,
        -- REVIEW REPAIR (4D-R27). `delayDebt` re-derived spec II.17's
        -- DecisionDebt = FutureExpectedImpact x ProbabilityOfDelay here, in a
        -- READ, a second time — without compute_case_decision_debt's
        -- multi-currency refusal, and never rendered anywhere. A screen
        -- composes recorded runs; a second source of truth for a governance
        -- figure does not become acceptable by being unused. The stated
        -- exposure is carried as the two numbers a person stated, with the
        -- currency they stated them in; the DEBT is what the recorded
        -- case_decision_debt run says it is.
        'expectedImpact', le.expected_impact,
        'probabilityOfDelay', le.probability_of_delay,
        'exposureCurrency', le.currency,
        'owner', (select email from user_profiles up where up.id = m.owner_id),
        'raisedAt', m.created_at) as row_json
    from mine m
    left join risks r on r.id = m.risk_id
    left join development_cases dc on dc.id = m.development_case_id
    left join recommendations rec on rec.id = m.recommendation_id
    left join latest_exposure le on le.decision_id = m.id
    order by m.decision_required_date nulls last,
             coalesce(m.decision_value, r.value_at_risk) desc nulls last
  ) q;

  -- REVIEW REPAIR (4D-R28). THE COUNTS ARE OVER THE WHOLE QUEUE, NOT THE PAGE.
  --
  -- They used to be aggregated over `v_rows`, which had already been through
  -- `limit v_limit` — so an administrator in an organization with 300 pending
  -- decisions was told "50 pending", a total that silently equalled the page
  -- size. On a screen whose entire claim is personal accountability, that is a
  -- fabricated number of exactly the kind this slice refuses everywhere else.
  -- The counts are now taken over the unlimited `mine` population and the page
  -- size is reported separately, so a truncated queue says it is truncated.
  select count(*),
         count(*) filter (where (value->>'overdue')::boolean is true),
         count(*) filter (where (value->>'reassessmentRequired')::boolean is true),
         count(*) filter (where value->>'dueDate' is null)
    into v_total, v_overdue, v_reopened, v_undated
  from jsonb_array_elements(v_all_rows);

  select coalesce(jsonb_agg(value order by i), '[]'::jsonb) into v_rows
    from jsonb_array_elements(v_all_rows) with ordinality t(value, i)
   where i <= v_limit;

  return jsonb_build_object(
    'decisions', v_rows,
    'count', v_total,
    'overdueCount', v_overdue,
    'reopenedCount', v_reopened,
    'undatedCount', v_undated,
    'returned', jsonb_array_length(v_rows),
    'truncated', v_total > jsonb_array_length(v_rows),
    'truncationNote', case when v_total > jsonb_array_length(v_rows) then format(
      'This page shows the %s most urgent of %s decisions in your queue. The counts above are over ALL %s of them, not over the page — a total that silently equalled the page size would be a fabricated number.',
      jsonb_array_length(v_rows), v_total, v_total) end,
    'scope', case when v_all then 'organization' else 'mine' end,
    'scopeNote', case when v_all then
      'You hold an administrator or executive role, so this queue shows every pending decision in the organization.'
      else
      'This queue shows decisions you own, decisions you raised, and decisions whose approval is routed to your role. It is deliberately not every pending decision in the organization: a list of everything is not a personal accountability.' end,
    'callerRole', v_role,
    'refusal', case when v_total = 0 then
      case when v_all then
        'No decision is pending anywhere in this organization.'
        else
        'No decision is currently routed to you. That is a fact about your queue, not about the organization''s: decisions owned by others, and decisions nobody has assigned an owner or an approval role, are not shown here and are not counted as yours.' end
      end,
    'limit', v_limit);
end
$$;

revoke all on function public.get_my_decisions(int) from public, anon, service_role;
grant execute on function public.get_my_decisions(int) to authenticated;
