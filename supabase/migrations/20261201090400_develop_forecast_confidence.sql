-- ============================================================================
-- Sync Develop Slice 4B — FORECAST CONFIDENCE (D5.32, spec §51) and the
-- PROBABILISTIC FORECAST PRESENTATION (D5.07, spec I.9), plus the one
-- Performance read the surface consumes.
--
-- THE SPEC'S OWN SENTENCES:
--
--   I.9  "'Completion = May 17' is misleading without uncertainty. Present:
--         deterministic May 17, P50 May 24, P80 June 19, original sanction
--         May 1. Cost: forecast $414M, P50 $429M, P80 $471M."
--   §51  "Forecast confidence: cost — deterministic, P50, P80, confidence;
--         schedule — current, P50, P80 dates, critical drivers."
--
-- ── THE HARDEST HONESTY IN THIS SLICE ──────────────────────────────────────
-- A P80 is a statement about a DISTRIBUTION. It is not a deterministic number
-- with a margin added to it, and there is no arithmetic that turns one into
-- the other. This case has no recorded distribution: the Monte Carlo binding
-- from project cost items and schedule activities into the modelling kernel
-- is Slice 4C, and the kernel does not run inside the database.
--
-- So this file presents the DETERMINISTIC figures — which are real, derived
-- and lineage-backed — and REFUSES the P50/P80 columns BY NAME, saying
-- exactly what is missing and what would supply it. It would be trivially
-- easy, and completely dishonest, to print "P80 = deterministic x 1.15": the
-- number would look like every other P80 a reader has seen, it would move
-- with the deterministic figure, and nothing on the screen would reveal that
-- no simulation ever ran. That is the failure this slice must not ship, and
-- the refusal is the deliverable until 4C supplies a distribution.
--
-- The refusal is SPECIFIC, not a shrug. It names:
--   * how many schedule activities on this case already carry an optimistic
--     and pessimistic duration (the inputs a simulation would consume), so a
--     reader can see whether the missing piece is data or machinery;
--   * that the deterministic figure and a P50 are different statements, so
--     "P50 = deterministic" is not offered either;
--   * where the distribution will come from.
--
-- ── WHAT THE DETERMINISTIC FIGURES ARE ─────────────────────────────────────
--   cost      the earned-value EAC (20261201090300) — BAC/CPI, named formula,
--             refusing when its inputs are absent. The recorded forecast
--             column total (project_cost_items.forecast, spec §23) is shown
--             BESIDE it rather than instead of it: a bottom-up forecast the
--             team typed and a performance-derived EAC are two different
--             statements, and a screen showing one under the other's label
--             is a screen that has silently chosen.
--   schedule  the latest planned finish across the case's schedule activities
--             (D5.28, P6's own dates through the one governed door).
--
-- ── AGAINST WHAT? ──────────────────────────────────────────────────────────
-- Spec I.9 wants the "original sanction" date beside the forecast. This
-- repository does not record a baselined finish DATE — controls_baseline
-- captures an element count and a digest, not a milestone — so the
-- comparison is REFUSED by name rather than compared against the baseline's
-- approval timestamp, which is when somebody signed rather than when the
-- work was meant to end.
--
-- ── CONFIDENCE TRAVELS WITH THE NUMBER ─────────────────────────────────────
-- Every forecast in this payload carries the D5.17 estimate confidence band
-- and the D5.20 progress confidence band, including when both are `unrated`.
-- §51 asks for "confidence" as a first-class field of the forecast, and a
-- forecast whose confidence is available on a different screen is a forecast
-- shown without it.
--
-- §70: nothing here approves anything. A forecast is presented, never
-- accepted; there is no approve act in this file for any identity.
--
-- Canonical reuse: get_case_earned_value (D5.05), estimate_confidence_rating
-- (D5.17), get_case_progress_integrity (D5.20), shutdown_tasks through the
-- D5.28 door, record_calculation_run (D11.29). No second forecast store and
-- no second simulator — the kernel in src/lib/modelling stays the only one.
-- ============================================================================

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

  v_currency := nullif(v_ev->>'currency', '');
  v_eac := (v_ev->'metrics'->'eac'->>'value')::numeric;
  v_eac_refusal := v_ev->'metrics'->'eac'->>'refusal';

  -- The recorded bottom-up forecast, BESIDE the derived one.
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

  -- The schedule side, through the D5.28 door.
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

  -- ── THE REFUSAL THAT IS THE POINT OF THIS FILE ────────────────────────────
  v_no_distribution := format(
    'No probability distribution is recorded for this case, so there is no P50 and no P80 — for cost or for schedule. A P80 is a statement about a distribution, not a deterministic figure with a margin on it, and there is no arithmetic that converts one into the other: printing "deterministic x 1.15" here would look exactly like every other P80 a reader has seen while nothing on the screen revealed that no simulation ever ran. The deterministic figures beside this note are real, derived and lineage-backed; the percentiles are absent, and absent is what they are shown as. %s The Monte Carlo binding from these cost lines and schedule activities into the simulation kernel is Slice 4C; the kernel itself already exists and is not duplicated here.',
    case
      when coalesce(v_activity_count, 0) = 0 then
        'This case has no schedule activities, so a schedule simulation would have nothing to sample either.'
      when coalesce(v_ranged, 0) = 0 then
        format('None of this case''s %s schedule activity(ies) carries an optimistic and pessimistic duration, so even with the binding in place there would be no range to sample: a single-point duration expresses a certainty the estimate does not have.',
               v_activity_count)
      else
        format('%s of this case''s %s schedule activity(ies) already carry an optimistic and pessimistic duration, so the missing piece here is the binding, not the data.',
               v_ranged, v_activity_count)
    end);

  return jsonb_build_object(
    'caseId', c.id,
    'cost', jsonb_build_object(
      'currency', v_currency,
      'deterministic', v_eac,
      'deterministicLabel', 'Estimate at completion',
      'deterministicFormula', v_ev->'eacFormula',
      'deterministicRefusal', v_eac_refusal,
      -- BESIDE, not INSTEAD OF. Two different statements about the same
      -- project, each labelled as what it is.
      'recordedForecastTotal', v_recorded_forecast,
      'recordedForecastLineCount', v_forecast_lines,
      'costLineCount', v_line_count,
      'recordedForecastNote', case
        when v_recorded_forecast is null then
          'No cost line on this case carries a forecast figure, so there is no bottom-up forecast to show beside the derived one.'
        else
          'This is the sum of the forecast column on the coded cost lines — what the team expects to spend, typed line by line. It is shown BESIDE the earned-value estimate at completion, which is derived from performance to date, because they are two different statements and a screen that showed one under the other''s label would have silently chosen between them.'
        end,
      'p50', null,
      'p80', null,
      'percentileRefusal', v_no_distribution),
    'schedule', jsonb_build_object(
      'deterministicFinish', v_finish,
      'deterministicRefusal', v_schedule_refusal,
      'activityCount', v_activity_count,
      'activitiesWithPlannedFinish', v_dated,
      'activitiesWithDurationRange', v_ranged,
      'p50Finish', null,
      'p80Finish', null,
      'percentileRefusal', v_no_distribution,
      'criticalDrivers', null,
      'criticalDriversRefusal',
        'Critical drivers are the activities a simulation finds on the critical path most often (the criticality index). They are an output of the same simulation that would produce the P50 and P80 dates, and with no distribution recorded there is nothing to rank. The deterministic critical path is a different statement — float computed from single-point durations is not protection — and is deliberately not offered here in its place.'),
    'againstSanction', null,
    'againstSanctionRefusal',
      'This repository records approved baselines and what each controls structure contained at approval; it does not record a baselined COMPLETION DATE. The comparison spec I.9 asks for ("original sanction May 1") is therefore refused rather than computed against the baseline''s approval timestamp, which is the day somebody signed and not the day the work was meant to end.',
    -- §51's fourth field, on both forecasts, always present.
    'estimateConfidence', v_confidence,
    'progressConfidence', jsonb_build_object(
      'band', v_integrity->'confidence',
      'coverage', v_integrity->'coverage',
      'headline', v_integrity->'headline',
      'refusal', v_integrity->'refusal'),
    'distribution', jsonb_build_object(
      'exists', false,
      'reason', v_no_distribution),
    'evaluable', (v_eac is not null or v_finish is not null or v_recorded_forecast is not null));
end
$$;

revoke all on function public.get_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.get_case_forecast_confidence(uuid) to authenticated;

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

  -- THE MISSING PERCENTILES ARE RECORDED AS REFUSALS, every time. A run that
  -- recorded only the deterministic figure would make a forecast with no
  -- distribution behind it indistinguishable, in the ledger, from one that
  -- had a distribution and happened not to show it.
  v_refusals := jsonb_build_array(v_fc->'cost'->>'percentileRefusal');
  v_refusals := v_refusals || to_jsonb(v_fc->>'againstSanctionRefusal');
  v_refusals := v_refusals || to_jsonb(v_fc->'schedule'->>'criticalDriversRefusal');
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

  if coalesce((v_fc->>'evaluable')::boolean, false) = false then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'currency', v_fc->'cost'->'currency',
      'costDeterministic', v_fc->'cost'->'deterministic',
      'costDeterministicFormula', v_fc->'cost'->'deterministicFormula',
      'costRecordedForecastTotal', v_fc->'cost'->'recordedForecastTotal',
      'costP50', 'null'::jsonb,
      'costP80', 'null'::jsonb,
      'scheduleDeterministicFinish', v_fc->'schedule'->'deterministicFinish',
      'scheduleP50Finish', 'null'::jsonb,
      'scheduleP80Finish', 'null'::jsonb,
      'distributionExists', to_jsonb(false),
      'estimateConfidenceBand', coalesce(v_fc->'estimateConfidence'->'band', to_jsonb('unrated'::text)),
      'progressConfidenceBand', coalesce(v_fc->'progressConfidence'->'band', 'null'::jsonb));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_forecast_confidence',
    'The §51 forecast presentation: the deterministic cost figure is the earned-value estimate at completion (EAC = BAC/CPI) with the recorded bottom-up forecast total shown beside it, and the deterministic schedule figure is the latest planned finish across the case''s schedule activities. P50 and P80 are recorded as ABSENT for both, because no probability distribution exists for this case — a percentile derived from a deterministic figure would be a spread nobody simulated.',
    jsonb_build_object(
      'costLineCount', v_fc->'cost'->'costLineCount',
      'forecastLineCount', v_fc->'cost'->'recordedForecastLineCount',
      'activityCount', v_fc->'schedule'->'activityCount',
      'activitiesWithDurationRange', v_fc->'schedule'->'activitiesWithDurationRange',
      'estimateConfidenceBand', coalesce(v_fc->'estimateConfidence'->'band', to_jsonb('unrated'::text))),
    (coalesce((select jsonb_agg(jsonb_build_object('table', 'project_cost_items', 'id', ci.id))
                 from project_cost_items ci where ci.development_case_id = c.id), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'shutdown_tasks', 'id', t.id))
                    from shutdown_tasks t
                    join shutdown_events e on e.id = t.event_id
                   where e.organization_id = c.organization_id
                     and e.development_case_id = c.id), '[]'::jsonb)),
    v_outputs,
    v_refusals);

  return v_fc || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_forecast_confidence'));
end
$$;

revoke all on function public.compute_case_forecast_confidence(uuid) from public, anon, service_role;
grant execute on function public.compute_case_forecast_confidence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE ONE PERFORMANCE READ the surface consumes — the 4A shape exactly: the
-- live reads are here for their REFUSALS, their row listings and staleness
-- detection, and every FIGURE on screen is rendered from `latestCalculations`,
-- which are recorded runs (D11.29).
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
                           'case_performance_trend']
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
    'latestCalculations', v_latest,
    'notInThisSlice', jsonb_build_array(
      'P50/P80 cost and schedule (D5.07, D5.32): the deterministic figures are here and the percentiles are refused by name. Binding these cost lines and schedule activities into the Monte Carlo kernel is Slice 4C; the kernel exists and is not duplicated in SQL.',
      'Critical drivers on the forecast: an output of the same simulation, refused with it rather than replaced by the deterministic critical path.',
      'A baselined completion DATE to compare the forecast against (spec I.9''s "original sanction"): the controls baseline captures structures, not milestones.',
      'Contingency drawdown governance (D5.18, spec II.8): the contingency column and its mandatory basis exist on the cost line; the drawdown ledger does not.',
      'Productivity and milestone-confidence metrics (spec I.8): they need recorded quantities and dates per activity, which arrive with the workface-planning family.'));
end
$$;

revoke all on function public.get_case_performance(uuid) from public, anon, service_role;
grant execute on function public.get_case_performance(uuid) to authenticated;
