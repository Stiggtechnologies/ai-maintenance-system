-- ============================================================================
-- Sync Develop — Slice 7A, part 3 of 3.
-- D7.07 (constraint burn-down, spec I.28 — FORWARD-LOOKING and RECORDED) and
-- the Slice 7A reads.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RULING 21 (I.28 burn-down). NO NEW BURN-DOWN TABLE. The projection is a
-- READ over the ONE constraint store; the RECORD of what was projected is a
-- `calculation_runs` row.
--
-- Register row D7.07 says it in one line — "EXTEND — not a new burn-down
-- table" — and the requirement that the burn-down be RECORDED rather than
-- RECOMPUTED pulls the other way, because a projection that lives only in a
-- read has no past at all. Both are satisfied by the ledger this repository
-- already has:
--
--   * the FORWARD PROJECTION is `get_package_constraint_burndown` — one
--     predicate over restoration_constraints' forward fields (required_by,
--     expected_clear_date, probability_of_clearance, schedule_impact_days,
--     added in part 2). It reads; it stores nothing; there is no second
--     source for "what will block this package".
--
--   * the RECORD is `calculation_runs` (20261130090600), D11.29's ONE
--     lineage ledger: method, code version, inputs, outputs, timestamp AND
--     refusals, written only by `record_calculation_run` (revoked from
--     `authenticated`), immutable to every client by trigger, DELETE and
--     UPDATE refused, TRUNCATE revoked and statement-guarded.
--
--   * `compute_package_constraint_burndown` answers the SAME question through
--     the SAME predicate and records the run. This is the 4A split — a stable
--     read cannot write, and lineage that is optional is lineage that is
--     missing — applied to the burn-down.
--
--   * `get_package_burndown_history` returns the RECORDED outputs verbatim.
--     It re-derives nothing. A burn-down that recomputed its own past would
--     show yesterday's projection made with today's constraints, which is a
--     fabrication with a date on it; here yesterday's answer is a row nobody
--     can edit, and today's answer is a new row beside it.
--
-- ── WHAT MAKES IT FORWARD-LOOKING (I.28: "for every FUTURE work package:
--    constraint, owner, required-by date, probability of clearance, schedule
--    impact"). It does not count today's open rows. For each open hard
--    constraint it asks whether the date somebody expects it CLEAR is after
--    the date the work NEEDS it clear, and it classifies every constraint
--    into one of FIVE honest buckets:
--
--      lapsed          the constraint is STILL OPEN and the date somebody said
--                      it would be gone has already passed. Asked FIRST,
--                      because a projection that never compares a forecast to
--                      today reports a lapsed one as "expected clear" and then
--                      names a constraint-free date in the PAST. Time alone
--                      produces this; no bad write is needed.
--      will_block      expected clear date is AFTER the required-by date (the
--                      projection says by how many days), or after the end of
--                      the horizon (it says by how many days beyond it).
--      expected_clear  forecast clear on or before required-by, inside the
--                      horizon, and NOT already lapsed.
--      unforecast      NO expected clear date. Named, never assumed clear.
--                      "No date" is not "soon".
--      not_assessable  NO required-by date. Nothing can say whether clearing
--                      it is early or late, and an alarm wired to an absent
--                      date is worse than no alarm.
--
-- ── REFUSAL-FIRST, and what each refusal prevents:
--      * a package with NO constraints recorded REFUSES. Reporting "0 open
--        constraints" for a package nobody assessed reads as READY.
--      * a burn-down over an EMPTY SET refuses: a horizon containing no
--        constraint to burn down is a window that was not assessed, not a
--        window that is clear.
--      * a non-finite, zero or negative horizon refuses at the door.
--      * the forecast SUMMARY (`forecastComplete`, the projected
--        constraint-free date) is REFUSED — null, with the reason named —
--        while any open constraint is unforecast, not assessable OR LAPSED,
--        and again when no open HARD constraint carries a clear date at all.
--        A projected date computed over a partly-forecast set is a fabricated
--        number; a date drawn from a forecast that already expired is one with
--        a calendar on it; and a bare null with no reason beside it is the
--        third. This file produces none of the three.
--
-- ── WHAT THIS DELIBERATELY DOES NOT COMPUTE. I.28's headline sentence —
--    "63% of next month's planned construction is constraint-free" — is a
--    PORTFOLIO ratio across packages, and the register carries it as D7.08
--    and D7.20 ("one calc, two rows"), not as D7.07. This file produces the
--    PER-PACKAGE projection that ratio will be computed FROM and stops there.
--    Computing the ratio here as well would put two implementations of one
--    number in the tree before the row that owns it is even opened — the
--    duplicate this programme has found in six consecutive chunks.
--
-- Canonical reuse: restoration_constraints, work_packages, work_package_work,
-- work_orders, development_cases, calculation_runs, record_calculation_run,
-- sync_calculation_code_version, sync_awp_level, app_current_org. No new
-- burn-down store, no second constraint projection, no portfolio ratio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CODE VERSION FOR THIS SLICE (D11.29).
--
--    Pinned BEFORE the compute function, because record_calculation_run
--    RAISES on an unpinned key by design. Every existing key keeps its own
--    version: their code did not change, and bumping a version on unchanged
--    code makes the version stop meaning anything.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  -- ONLY KEYS A COMPUTE FUNCTION RECORDS. The slice tests assert that every
  -- key pinned here appears in a record_calculation_run call, so a pin can
  -- never read as coverage that does not exist.
  select v from (values
    ('case_scope_growth',              'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',       'develop-controls/4A/2026-11-24'),
    ('case_earned_value',              'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',         'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',        'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',          'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',       'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',   'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',   'develop-change/4D/2026-12-03'),
    ('case_change_control',            'develop-change/4D/2026-12-03'),
    ('case_decision_latency',          'develop-change/4D/2026-12-03'),
    ('case_decision_debt',             'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',          'develop-design/5B/2026-12-05'),
    ('case_ram_profile',               'develop-ram/5D/2026-12-07'),
    ('case_procurement_position',      'develop-procurement/6A/2026-12-08'),
    ('package_constraint_burndown',    'develop-awp/7A/2026-12-10')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE ONE FORWARD PREDICATE (I.28).
--
--    STABLE and read-only. Everything that answers "what will block this
--    package, and when" — the read surface, the compute function that records
--    a run, and the case read below — goes through this and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.get_package_constraint_burndown(
  p_package_id bigint,
  p_horizon_days int default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p work_packages%rowtype;
  v_horizon int := p_horizon_days;
  v_today date := current_date;
  v_end date;
  v_total int;
  v_hard int;
  v_open int;
  v_items jsonb := '[]'::jsonb;
  v_in_window int := 0;
  v_will_block int := 0;
  v_unforecast int := 0;
  v_not_assessable int := 0;
  v_expected_clear int := 0;
  v_lapsed int := 0;
  v_latest date;
  v_impact numeric := 0;
  v_impact_seen boolean := false;
  r record;
  v_class text;
  v_days_late int;
  v_days_beyond int;
  v_refusals jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;
  -- A horizon is a count of days. Zero is not a window and a negative one is
  -- a window into the past, which a FORWARD projection has nothing to say
  -- about. NULL is refused rather than defaulted: a default silently applied
  -- to a caller who meant something else is a number nobody chose.
  if v_horizon is null or v_horizon <= 0 or v_horizon > 1825 then
    return jsonb_build_object('answered', false,
      'refusal', 'the horizon must be a whole number of days from 1 to 1825 — a burn-down over zero days, a negative window or a five-year-plus window projects nothing');
  end if;
  v_end := v_today + v_horizon;

  select count(*), count(*) filter (where is_hard),
         count(*) filter (where state in ('unknown', 'blocked'))
    into v_total, v_hard, v_open
    from restoration_constraints
   where work_package_id = p.id and organization_id = v_org;

  -- REFUSAL 1: nothing recorded. This is the whole point of the row.
  if v_total = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'refusal', format('No constraint has been recorded against work package %s, so there is nothing to burn down. This is NOT "0 open constraints" and it is not "constraint-free" — it is UNASSESSED, and the two read identically on a screen, which is why this refuses instead of answering zero.',
        p.package_code));
  end if;

  for r in
    select x.id, x.constraint_kind, x.state, x.is_hard, x.description, x.basis,
           x.owner_role, x.owner_id, x.required_by, x.expected_clear_date,
           x.probability_of_clearance, x.probability_basis, x.schedule_impact_days,
           x.impact_basis, x.work_order_id, w.wo_number
      from restoration_constraints x
      left join work_orders w on w.id = x.work_order_id
     where x.work_package_id = p.id and x.organization_id = v_org
       and x.state in ('unknown', 'blocked')
     order by x.required_by nulls last, x.constraint_kind, x.id
  loop
    v_days_late := null;
    v_days_beyond := null;
    if r.required_by is null then
      v_class := 'not_assessable';
      v_not_assessable := v_not_assessable + 1;
    elsif r.expected_clear_date is null then
      v_class := 'unforecast';
      v_unforecast := v_unforecast + 1;
    elsif r.expected_clear_date < v_today then
      -- ── LAPSED. THE CLASSIFIER MUST ASK WHAT DAY IT IS.
      --    This constraint is STILL OPEN and the date somebody said it would
      --    be gone has already passed. The first draft of this loop compared
      --    the expected clear date only against `required_by` and against the
      --    end of the horizon, never against today, so a lapsed forecast fell
      --    into `expected_clear` — and the whole projection then reported
      --    `forecastComplete: true` with a `projectedConstraintFreeDate` in
      --    the PAST, with no refusal, for a package with an open hard
      --    constraint. No adversarial write was needed to reach it: a forecast
      --    recorded today for ten days' time becomes this on day eleven, by
      --    the passage of time alone, and a stale constraint register is the
      --    normal state of one. A projection that answers "constraint-free 25
      --    days ago" while the constraint is open is the invented number
      --    wearing a calendar that this file's header refuses to produce.
      v_class := 'lapsed';
      v_days_late := v_today - r.expected_clear_date;
      v_lapsed := v_lapsed + 1;
    elsif r.expected_clear_date > r.required_by then
      v_class := 'will_block';
      v_days_late := r.expected_clear_date - r.required_by;
      v_will_block := v_will_block + 1;
    elsif r.expected_clear_date > v_end then
      -- Forecast clear before it is needed, but not inside the window this
      -- projection covers. Reported as blocking WITHIN THE HORIZON rather
      -- than silently counted as clear, and it says by how much: `daysLate` is
      -- lateness against the REQUIRED-BY date and does not apply here, so the
      -- overrun gets its own field rather than two meanings in one.
      v_class := 'will_block';
      v_days_beyond := r.expected_clear_date - v_end;
      v_will_block := v_will_block + 1;
    else
      v_class := 'expected_clear';
      v_expected_clear := v_expected_clear + 1;
    end if;

    if r.required_by is not null and r.required_by <= v_end then
      v_in_window := v_in_window + 1;
    end if;
    if r.is_hard and r.expected_clear_date is not null
       and (v_latest is null or r.expected_clear_date > v_latest) then
      v_latest := r.expected_clear_date;
    end if;
    -- THE STATED IMPACT OF WHAT IS FORECAST TO BLOCK, which is what the key
    -- says and what the comment below it always claimed. The first draft
    -- summed EVERY open constraint's impact regardless of bucket, so a
    -- package with one blocking constraint worth 3 days and one clearing in
    -- time worth 5 reported 8 days of blocking impact — and wrote that number
    -- into an immutable lineage row.
    if v_class in ('will_block', 'lapsed') and r.schedule_impact_days is not null then
      v_impact := v_impact + r.schedule_impact_days;
      v_impact_seen := true;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'constraintId', r.id,
      'kind', r.constraint_kind,
      'state', r.state,
      'isHard', r.is_hard,
      'description', r.description,
      'basis', r.basis,
      'ownerRole', r.owner_role,
      'ownerId', r.owner_id,
      'workOrder', r.wo_number,
      'requiredBy', r.required_by,
      'expectedClearDate', r.expected_clear_date,
      'probabilityOfClearance', r.probability_of_clearance,
      'probabilityBasis', r.probability_basis,
      'scheduleImpactDays', r.schedule_impact_days,
      'impactBasis', r.impact_basis,
      'forecast', v_class,
      'daysLate', v_days_late,
      'daysBeyondHorizon', v_days_beyond,
      'inHorizon', r.required_by is not null and r.required_by <= v_end));
  end loop;

  -- REFUSAL 2: an empty set to burn down. Every constraint is cleared or not
  -- applicable, OR none of the open ones falls in the window. Both are
  -- windows this projection did not assess, and both read as "clear".
  if v_open = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'constraintsRecorded', v_total, 'hardConstraints', v_hard, 'openConstraints', 0,
      'refusal', format('Every constraint recorded against work package %s is already satisfied or not applicable, so a BURN-DOWN — which projects what will still be blocking and when — has an empty set to project over. The package''s readiness verdict is release_work_package''s answer, not this one.',
        p.package_code));
  end if;
  if v_in_window = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'constraintsRecorded', v_total, 'openConstraints', v_open,
      'horizonDays', v_horizon, 'horizonEnd', v_end,
      'refusal', format('None of the %s open constraint(s) on work package %s has a required-by date inside the next %s days, so this window has nothing to burn down. That is a window nobody has dated work against — not a window that is clear.',
        v_open, p.package_code, v_horizon));
  end if;

  -- SUM, not a critical path: Sync imports P6's own float and does not
  -- recompute a network, so a "delay" derived here would be a second answer
  -- to a question the schedule already answers. NULL rather than 0 when
  -- nothing blocking carries a stated impact — a zero would read as "no
  -- impact" where the truth is "nobody stated one".
  if not v_impact_seen then
    v_impact := null;
  end if;

  if v_lapsed > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s open constraint(s) were forecast clear on a date that has already passed. A lapsed forecast is not a clearance: the constraint is still open, the date it was expected gone is behind us, and no projected constraint-free date is produced while any of them stands.', v_lapsed),
      'scope', 'constraint'));
  end if;
  if v_unforecast > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s open constraint(s) carry no expected clear date. No date is not "soon": they are listed as unforecast and no projected constraint-free date is produced while any of them stands.', v_unforecast),
      'scope', 'constraint'));
  end if;
  if v_not_assessable > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s open constraint(s) carry no required-by date, so nothing can say whether clearing them is early or late.', v_not_assessable),
      'scope', 'constraint'));
  end if;

  return jsonb_build_object(
    'answered', true,
    'packageId', p.id,
    'packageCode', p.package_code,
    'packageType', p.package_type,
    'level', sync_awp_level(p.package_type),
    'asOf', v_today,
    'horizonDays', v_horizon,
    'horizonEnd', v_end,
    'constraintsRecorded', v_total,
    'hardConstraints', v_hard,
    'openConstraints', v_open,
    'openInHorizon', v_in_window,
    'willBlock', v_will_block,
    'expectedClear', v_expected_clear,
    'lapsed', v_lapsed,
    'unforecast', v_unforecast,
    'notAssessable', v_not_assessable,
    'statedScheduleImpactDays', v_impact,
    -- REFUSED while anything is unforecast, undated OR LAPSED, and refused
    -- again when no open HARD constraint carries a clear date at all. Each
    -- refusal names its own reason: a null with no explanation beside it is
    -- the shape this file refuses everywhere else, and the first draft
    -- produced exactly that for a package whose only open constraints were
    -- soft (v_latest is computed over hard rows only, while the completeness
    -- counters count every open row — so `forecastComplete: true`,
    -- `projectedConstraintFreeDate: null`, no refusal, and the panel simply
    -- printed "not stated").
    'forecastComplete',
      (v_unforecast = 0 and v_not_assessable = 0 and v_lapsed = 0),
    'projectedConstraintFreeDate',
      case when v_unforecast = 0 and v_not_assessable = 0 and v_lapsed = 0
        then v_latest end,
    'projectedConstraintFreeRefusal',
      case
        when v_lapsed > 0
          then format('No projected constraint-free date: %s open constraint(s) were forecast clear on a date that has already passed, and projecting from a forecast that did not happen produces a date in the past for work that is still blocked.', v_lapsed)
        when v_unforecast > 0 or v_not_assessable > 0
          then 'No projected constraint-free date: the open set is only partly forecast, and a date computed over it would be an invented number wearing a calendar.'
        when v_latest is null
          then 'No projected constraint-free date: no OPEN HARD constraint carries an expected clear date, so there is no date to project to. The open set here is soft — it does not stop a release, and it does not date one either.'
        end,
    'constraints', v_items,
    'refusals', v_refusals,
    'basis', 'Forward projection over the recorded constraints of this work package: for each open constraint, the date somebody stated it is expected clear against the date the work needs it clear. No probability is inferred, no clear date is assumed, and no critical path is recomputed here.');
end
$$;

revoke all on function public.get_package_constraint_burndown(bigint, int) from public, anon;
grant execute on function public.get_package_constraint_burndown(bigint, int) to authenticated;

comment on function public.get_package_constraint_burndown(bigint, int) is
  'D7.07 (spec I.28): THE forward-looking constraint burn-down predicate for one §27 work package — what will block it, and when. RULING 21: no burn-down table; this reads the ONE constraint store and stores nothing. Refuses a package with no constraints recorded, an already-clear set, a window with nothing dated into it, and any horizon that is not 1..1825 days. Classifies every open constraint as lapsed / will_block / expected_clear / unforecast / not_assessable — LAPSED first, because a forecast whose date has passed while the constraint is still open is not a clearance — and produces no projected constraint-free date while the open set is partly forecast, partly lapsed, or carries no open hard clear date at all.';

-- ---------------------------------------------------------------------------
-- 3. THE RECORDED BURN-DOWN. Same predicate, plus a lineage row (D11.29).
--
--    VOLATILE on purpose: a STABLE function cannot write, and a burn-down
--    whose history is optional has no history. The 4A split, exactly.
-- ---------------------------------------------------------------------------
create or replace function public.compute_package_constraint_burndown(
  p_package_id bigint,
  p_horizon_days int default 90
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p work_packages%rowtype;
  v_result jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_run uuid;
  v_method text :=
    'Forward projection over the work package''s recorded constraints: each open constraint''s stated expected clear date against its stated required-by date, inside a caller-stated horizon. Counts and date arithmetic only — no probability is inferred, no clear date is assumed for an unforecast constraint, and no critical path is recomputed.';
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a burn-down requires a planning, engineering, supervisory or governance role');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;

  v_result := get_package_constraint_burndown(p.id, p_horizon_days);

  if (v_result->>'answered')::boolean is not true then
    -- A REFUSAL IS RECORDED TOO. "The burn-down refused on this date, for
    -- this reason" is a fact about the package that a later reader needs; a
    -- history that only kept the answers would show a clean run of
    -- projections with the unassessed weeks silently missing.
    v_refusals := jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'refusal', 'scope', 'package'));
    v_run := record_calculation_run(p.development_case_id, 'package_constraint_burndown',
      v_method,
      jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code,
        'horizonDays', p_horizon_days),
      jsonb_build_array(
        jsonb_build_object('table', 'restoration_constraints',
          'scope', 'work_package_id = ' || p.id::text),
        jsonb_build_object('table', 'work_packages', 'scope', 'id = ' || p.id::text)),
      null, v_refusals);
    return v_result || jsonb_build_object('calculationRunId', v_run,
      'codeVersion', sync_calculation_code_version('package_constraint_burndown'));
  end if;

  v_refusals := coalesce(v_result->'refusals', '[]'::jsonb);
  v_run := record_calculation_run(p.development_case_id, 'package_constraint_burndown',
    v_method,
    jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code,
      'horizonDays', v_result->'horizonDays', 'asOf', v_result->'asOf',
      'constraintsRecorded', v_result->'constraintsRecorded',
      'openConstraints', v_result->'openConstraints'),
    jsonb_build_array(
      jsonb_build_object('table', 'restoration_constraints',
        'scope', 'work_package_id = ' || p.id::text),
      jsonb_build_object('table', 'work_packages', 'scope', 'id = ' || p.id::text)),
    jsonb_build_object(
      'openInHorizon', v_result->'openInHorizon',
      'willBlock', v_result->'willBlock',
      'expectedClear', v_result->'expectedClear',
      'lapsed', v_result->'lapsed',
      'unforecast', v_result->'unforecast',
      'notAssessable', v_result->'notAssessable',
      'statedScheduleImpactDays', v_result->'statedScheduleImpactDays',
      'forecastComplete', v_result->'forecastComplete',
      'projectedConstraintFreeDate', v_result->'projectedConstraintFreeDate',
      'projectedConstraintFreeRefusal', v_result->'projectedConstraintFreeRefusal',
      'constraints', v_result->'constraints'),
    v_refusals);

  return v_result || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('package_constraint_burndown'),
    'recorded', true,
    'recordNote', 'This projection is now a row in calculation_runs. It cannot be edited or deleted by any client, and the next burn-down is recorded BESIDE it rather than over it.');
end
$$;

revoke all on function public.compute_package_constraint_burndown(bigint, int) from public, anon;
grant execute on function public.compute_package_constraint_burndown(bigint, int) to authenticated;

comment on function public.compute_package_constraint_burndown(bigint, int) is
  'D7.07: the burn-down, RECORDED. Same predicate as get_package_constraint_burndown — there is no second projection — plus one immutable calculation_runs row carrying method, pinned code version, inputs, outputs, timestamp and every refusal hit on the way. Refusals are recorded as runs too, so a history cannot show a clean sequence with the unassessed weeks missing.';

-- ---------------------------------------------------------------------------
-- 4. THE HISTORY. Recorded, never recomputed.
-- ---------------------------------------------------------------------------
create or replace function public.get_package_burndown_history(
  p_package_id bigint,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p work_packages%rowtype;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_runs jsonb;
  v_count int;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;

  select count(*) into v_count
    from calculation_runs r
   where r.organization_id = v_org
     and r.calculation_key = 'package_constraint_burndown'
     and (r.inputs->>'workPackageId') = p.id::text;

  if v_count = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'refusal', format('No burn-down has been recorded for work package %s. An empty history is not a history of nothing going wrong — nobody has taken a projection yet, and returning an empty series would read as the former.',
        p.package_code));
  end if;

  select coalesce(jsonb_agg(x order by x->>'computedAt' desc), '[]'::jsonb) into v_runs
    from (
      select jsonb_build_object(
               'runId', r.id,
               'computedAt', r.computed_at,
               'codeVersion', r.code_version,
               'status', r.status,
               'method', r.method,
               'inputs', r.inputs,
               -- VERBATIM. Not re-derived, not re-classified, not re-summed.
               'outputs', r.outputs,
               'refusals', r.refusals) as x
        from calculation_runs r
       where r.organization_id = v_org
         and r.calculation_key = 'package_constraint_burndown'
         and (r.inputs->>'workPackageId') = p.id::text
       order by r.computed_at desc
       limit v_limit) s;

  return jsonb_build_object('answered', true, 'packageId', p.id,
    'packageCode', p.package_code, 'runCount', v_count,
    -- THE NUMBER OF ROWS HANDED BACK, not the number asked for. The first
    -- draft returned `v_limit` here, so a history with one recorded run
    -- reported "returned: 20" — a misstatement of fact in the one payload
    -- whose entire contract is "returned as it was written".
    'returned', jsonb_array_length(v_runs),
    'runs', v_runs,
    'basis', 'Every entry is the calculation_runs row recorded when that burn-down was taken, returned as it was written. Nothing here is recomputed from today''s constraints: a burn-down that rewrote its own past would show a projection nobody ever made.');
end
$$;

revoke all on function public.get_package_burndown_history(bigint, int) from public, anon;
grant execute on function public.get_package_burndown_history(bigint, int) to authenticated;

comment on function public.get_package_burndown_history(bigint, int) is
  'D7.07: the RECORDED burn-down history of one work package, read back from calculation_runs verbatim. Refuses an empty history by name rather than returning an empty series, which reads as "nothing was ever blocking".';

-- ---------------------------------------------------------------------------
-- 5. THE CASE READ — the AWP chain, its work and its constraint position.
--
--    The execution status of the WORK comes from `work_orders` and from
--    nowhere else (RULING 19): this read joins to it rather than holding a
--    copy, so "is that job done" has one answer.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_work_packages(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_packages jsonb;
  v_count int;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;

  select count(*) into v_count from work_packages
   where organization_id = v_org and development_case_id = c.id;
  if v_count = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'refusal', 'No work package has been recorded on this case. The AWP chain (spec II.4) starts with an ENGINEERING package; nothing below it can be recorded until one exists.',
      'chain', jsonb_build_array('engineering', 'procurement', 'construction', 'installation', 'commissioning'));
  end if;

  select coalesce(jsonb_agg(x order by x->>'level', x->>'packageCode'), '[]'::jsonb)
    into v_packages
    from (
      select jsonb_build_object(
        'packageId', p.id,
        'packageCode', p.package_code,
        'title', p.title,
        'packageType', p.package_type,
        'level', sync_awp_level(p.package_type),
        -- THE FACT, NOT THE RULE. `parentType` was computed from
        -- sync_awp_parent_type(p.package_type) — the type the parent OUGHT to
        -- be — while the parent row was joined and only its code read. That
        -- read could not report a mismatch under any circumstances: it
        -- rendered any broken chain as a well-typed one, printing "under
        -- QA-P1 (procurement)" over a QA-P1 that is engineering. The
        -- prescribed type is still reported, beside the actual one, plus an
        -- explicit divergence flag — so this surface can say the chain is
        -- wrong instead of being structurally unable to.
        'parentType', parent.package_type,
        'parentTypeExpected', sync_awp_parent_type(p.package_type),
        'parentTypeDiverges',
          p.parent_package_id is not null
          and parent.package_type is distinct from sync_awp_parent_type(p.package_type),
        'parentPackageId', p.parent_package_id,
        'parentPackageCode', parent.package_code,
        'area', p.area,
        'wbsCode', wbs.wbs_code,
        'scope', p.scope,
        'requiredBy', p.required_by,
        'status', p.status,
        'releasedAt', p.released_at,
        'releaseNote', p.release_note,
        'releasedBy', rel.email,
        'workOrders', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'workOrderId', w.id,
                   'woNumber', w.wo_number,
                   'title', w.title,
                   -- FROM work_orders, the one place this lives.
                   'executionStatus', w.status,
                   'basis', m.assignment_basis)
                   order by w.wo_number nulls last, w.id)
            from work_package_work m
            join work_orders w on w.id = m.work_order_id
           where m.work_package_id = p.id), '[]'::jsonb),
        'constraints', jsonb_build_object(
          -- Both counts come from the ONE verdict predicate rather than being
          -- re-typed here, so "recorded" and "openHard" on the screen are the
          -- same two numbers the release door refuses on.
          'recorded', (v.verdict->>'constraintsRecorded')::int,
          'openHard', (v.verdict->>'openHard')::int,
          'satisfied', (select count(*) from restoration_constraints x
                         where x.work_package_id = p.id and x.state = 'satisfied'),
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'constraintId', x.id,
                     'kind', x.constraint_kind,
                     'state', x.state,
                     'isHard', x.is_hard,
                     'description', x.description,
                     'ownerRole', x.owner_role,
                     'requiredBy', x.required_by,
                     'expectedClearDate', x.expected_clear_date,
                     'probabilityOfClearance', x.probability_of_clearance,
                     'scheduleImpactDays', x.schedule_impact_days,
                     'verifiedAt', x.verified_at)
                     order by x.state, x.constraint_kind, x.id)
              from restoration_constraints x
             where x.work_package_id = p.id), '[]'::jsonb)),
        -- THE READINESS SENTENCE A PERSON ACTS ON, taken VERBATIM from
        -- sync_work_package_release_verdict — the same function
        -- release_work_package refuses through. The first draft of this read
        -- re-implemented the verdict inline over two of the door's five
        -- conditions, so a package with no work orders, a package under an
        -- unreleased parent and a cancelled package all rendered as "Every
        -- hard constraint is cleared; release is a §70 human act and has not
        -- been performed" while the door refused them. See section 6 of
        -- 20261210090100 for the ruling; there is one verdict.
        'readiness', v.verdict->>'reason',
        'readinessVerdict', v.verdict->>'verdict',
        'canRelease', (v.verdict->>'canRelease')::boolean) as x
        from work_packages p
        left join work_packages parent on parent.id = p.parent_package_id
        left join project_wbs_elements wbs on wbs.id = p.wbs_element_id
        left join user_profiles rel on rel.id = p.released_by
        cross join lateral (select sync_work_package_release_verdict(p.id) as verdict) v
       where p.organization_id = v_org and p.development_case_id = c.id) s;

  return jsonb_build_object('answered', true, 'caseId', c.id,
    'packageCount', v_count, 'packages', v_packages,
    'chain', jsonb_build_array('engineering', 'procurement', 'construction', 'installation', 'commissioning'),
    'basis', 'The case''s AWP packages with their typed chain, the work orders they REFERENCE (execution status read from work_orders, which is where it lives) and their §28 constraint position.');
end
$$;

revoke all on function public.get_case_work_packages(uuid) from public, anon;
grant execute on function public.get_case_work_packages(uuid) to authenticated;

comment on function public.get_case_work_packages(uuid) is
  'D7.17/D7.10/D7.18: the case''s work packages, their typed EWP→PWP→CWP→IWP chain, the work orders they reference and their constraint position. RULING 19 in the read as well as the write — the execution status of a work order comes from work_orders and is not copied here. The readiness sentence, the constraint counts and canRelease all come from sync_work_package_release_verdict, the ONE predicate release_work_package refuses through, so the screen cannot read as ready where the door refuses. `parentType` is the parent''s ACTUAL type with a divergence flag beside the prescribed one. Refuses a case with no packages rather than rendering an empty chain as a complete one.';
