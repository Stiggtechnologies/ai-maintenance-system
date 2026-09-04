-- ============================================================================
-- Sync Develop Slice 7C, part 4 — the workface metrics.
--
--   D7.08 (spec I.28)   forward constraint-free work
--   D7.20 (spec III.§49) the Constraint-Free Work Index
--   D7.13 (spec II.5)   planned-work-ready %
--   D7.14 (spec II.5)   ready-work-executed %
--
-- ── D7.08 AND D7.20 ARE ONE CALCULATION, AND THIS FILE BUILDS IT ONCE ───────
--
-- D7.20's own gap statement in the register says it outright: "Duplicate spec
-- reference of the I.28 forward metric — one calc, two rows." The
-- specification names the same quantity in two places — I.28 calls it forward
-- constraint-free work and §49 calls it the Constraint-Free Work Index,
-- "ready planned work packages / planned work packages" — and building two
-- functions would put two answers behind one question. That is the defect
-- this programme has found in seven of the last eight chunks, and it is the
-- one thing a metrics chunk is most likely to ship: two percentages that
-- disagree, each defensible on its own page.
--
-- So `get_constraint_free_work_index` is THE calculation, it produces BOTH
-- faces of it in one payload, and both register rows cite it.
--
--     constraintFreeWorkIndex   §49, TODAY: ready / assessed planned packages
--     forwardConstraintFreePct  I.28, FORWARD: ready-or-forecast-clear-in-time
--                               over the same denominator, and REFUSED
--                               outright whenever any non-ready package's
--                               burn-down is not forecast-complete.
--
-- ── EVERY NUMBER HERE READS A PREDICATE THAT ALREADY EXISTS ─────────────────
--
-- A metric that computed readiness its own way would be a second verdict
-- wearing a percentage sign. So:
--
--   * package readiness is `sync_work_package_release_verdict` — the ONE
--     verdict (RULING 22), including its seventh state `stale`. This file
--     calls it and counts; it does not look at a constraint and decide.
--   * the forward half is `get_package_constraint_burndown` — the ONE
--     projection (RULING 21). Its `forecastComplete` flag and its
--     `projectedConstraintFreeDate` are read, not re-derived.
--   * work-order field readiness is `sync_field_readiness_elements` — the ONE
--     element predicate (RULING 22). A work order is READY here when that
--     predicate reports zero `blocked` elements AND the ONE verdict does not
--     hold its package back; `unverifiable` and `not_applicable` are not
--     blockers, which is the predicate's own stated posture and not a policy
--     invented at this door.
--
-- ── THE EMPTY DENOMINATOR ───────────────────────────────────────────────────
--
-- Four percentages, and the classic silent lie in all four is the same:
--
--     0 of 0 rendered as 100% reads as perfect.
--     0 of 0 rendered as   0% reads as broken.
--
-- Both are wrong. Every ratio in this file goes through a guard that REFUSES
-- and names the empty denominator, and refuses a SECOND way that matters just
-- as much: a denominator with members none of which has been assessed.
-- "Nobody looked" and "somebody looked and the answer is none" are opposite
-- facts, and 0% states the second about the first. That distinction is
-- carried in the payload as separate counts, not only in prose.
--
-- ── LINEAGE ────────────────────────────────────────────────────────────────
--
-- Each metric has a `compute_` twin that records an immutable calculation_runs
-- row (D11.29) INCLUDING its refusals, so a history cannot show a clean run of
-- percentages with the unassessable weeks silently missing.
--
-- Canonical reuse: work_packages, work_package_work, work_orders,
-- restoration_constraints, sync_work_package_release_verdict,
-- get_package_constraint_burndown, sync_field_readiness_elements,
-- calculation_runs + record_calculation_run, app_current_org. No new table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ONLY DIVISION IN THIS SLICE.
--
--    Every percentage goes through here. IMMUTABLE and total: it returns a
--    payload for every input, including the ones it refuses, so no caller has
--    to remember to check before dividing.
--
--    NaN AND INFINITY ARE REFUSED BY NAME. In Postgres `'NaN'::numeric =
--    'NaN'::numeric` is TRUE and NaN compares GREATER than every other
--    numeric, so a range check alone admits it — and a NaN numerator would
--    otherwise sail through `numerator <= denominator` and out onto a screen.
-- ---------------------------------------------------------------------------
create or replace function public.sync_metric_ratio(
  p_numerator numeric,
  p_denominator numeric,
  p_subject text,
  p_assessed numeric default null,
  p_existing numeric default null
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  if not sync_is_finite_numeric(p_numerator)
     or not sync_is_finite_numeric(p_denominator)
     or (p_assessed is not null and not sync_is_finite_numeric(p_assessed)) then
    return jsonb_build_object('answered', false, 'kind', 'not_finite',
      'pct', null, 'numerator', null, 'denominator', null,
      'refusal', format('No percentage for %s: one of the counts is not a finite number, and a ratio computed from NaN or infinity is a number nobody can defend.', p_subject));
  end if;
  if p_numerator < 0 or p_denominator < 0 or coalesce(p_assessed, 0) < 0 then
    return jsonb_build_object('answered', false, 'kind', 'negative',
      'pct', null, 'numerator', p_numerator, 'denominator', p_denominator,
      'refusal', format('No percentage for %s: a count below zero was supplied, which is a fault in whatever produced it rather than a position to report.', p_subject));
  end if;
  -- NOT-ASSESSED IS DIAGNOSED FIRST, and the order is the whole point rather
  -- than a preference. Callers pass the ASSESSED count as the denominator —
  -- a package nobody looked at is not a constrained one — so a set nobody has
  -- assessed arrives here as denominator 0 AND assessed 0, and the generic
  -- "the window is empty" would be the less true of two true things. The
  -- caller states how many exist in `p_existing`; when it says nothing, the
  -- sentence says so in words rather than printing the denominator, which is
  -- zero in this branch by construction.
  if p_assessed is not null and p_assessed = 0 then
    return jsonb_build_object('answered', false, 'kind', 'not_assessed',
      'pct', null, 'numerator', p_numerator, 'denominator', p_denominator,
      'refusal', format('No percentage for %s: %s and NONE of them has been assessed. "Not assessed" and "assessed and found not ready" are opposite facts, and reporting 0%% here would state the second one about the first.',
        p_subject,
        -- The caller states how many EXIST in `p_existing`; the denominator is
        -- the assessed count and is therefore zero in exactly this branch, so
        -- falling back to it would print "0 exist in the window and NONE of
        -- them has been assessed" — a sentence that contradicts itself.
        case when coalesce(p_existing, p_denominator) > 0
          then format('%s exist in the window', coalesce(p_existing, p_denominator))
          else 'members of the set exist' end));
  end if;
  if p_denominator = 0 then
    return jsonb_build_object('answered', false, 'kind', 'empty_denominator',
      'pct', null, 'numerator', p_numerator, 'denominator', 0,
      'refusal', format('No percentage for %s: there are none in the window at all, so the denominator is empty. This is NOT 0%% and it is NOT 100%% — it is a window nobody has planned work into, and a percentage over an empty set states a position that does not exist.', p_subject));
  end if;
  if p_numerator > p_denominator then
    return jsonb_build_object('answered', false, 'kind', 'numerator_exceeds',
      'pct', null, 'numerator', p_numerator, 'denominator', p_denominator,
      'refusal', format('No percentage for %s: %s passed out of %s that exist, which is a counting fault rather than a position.', p_subject, p_numerator, p_denominator));
  end if;
  return jsonb_build_object('answered', true, 'kind', 'computed',
    'pct', round(100.0 * p_numerator / p_denominator, 1),
    'numerator', p_numerator, 'denominator', p_denominator);
end
$$;

revoke all on function public.sync_metric_ratio(numeric, numeric, text, numeric, numeric)
  from public, anon;
grant execute on function public.sync_metric_ratio(numeric, numeric, text, numeric, numeric)
  to authenticated, service_role;

comment on function public.sync_metric_ratio(numeric, numeric, text, numeric, numeric) is
  'D7.08/D7.13/D7.14/D7.20: THE division. Every percentage in slice 7C goes through it, and it returns a refusal rather than a number for an empty denominator, an unassessed set, a non-finite input, a negative count and a numerator larger than its denominator. 0 of 0 is neither 0% nor 100%: it is a position that does not exist.';

-- ---------------------------------------------------------------------------
-- 2. THE CONSTRAINT-FREE WORK INDEX (D7.20, spec §49) AND FORWARD
--    CONSTRAINT-FREE WORK (D7.08, spec I.28). ONE calculation.
--
--    THE DENOMINATOR IS THE ASSESSED PLANNED PACKAGES, and that choice is
--    load-bearing rather than convenient. §49 says "ready planned work
--    packages / planned work packages", and a package with NO constraint
--    recorded reads `unassessed` on the ONE verdict (RULING 22). Counting it
--    as not-ready would make the index say "constraints are blocking this
--    work" about work nobody has looked at, which is precisely the reading
--    `get_package_constraint_burndown` refuses over and the reason this whole
--    programme distrusts a comfortable zero. So the unassessed are counted
--    SEPARATELY and reported beside the index with their own coverage figure,
--    and when NONE of the planned packages has been assessed the index is
--    refused outright rather than reported as 0%.
-- ---------------------------------------------------------------------------
create or replace function public.get_constraint_free_work_index(
  p_case_id uuid,
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
  c development_cases%rowtype;
  v_today date := current_date;
  v_end date;
  v_packages int;
  v_planned int;
  v_assessed int := 0;
  v_ready int := 0;
  v_not_ready int := 0;
  v_unassessed int := 0;
  v_stale int := 0;
  v_forecast_clear int := 0;
  v_not_projectable int := 0;
  v_overdue int := 0;
  v_items jsonb := '[]'::jsonb;
  v_overdue_items jsonb := '[]'::jsonb;
  v_index jsonb;
  v_forward jsonb;
  v_coverage jsonb;
  v_refusals jsonb := '[]'::jsonb;
  r record;
  v_verdict jsonb;
  v_burn jsonb;
  v_class text;
  v_forward_class text;
  v_projected date;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if p_horizon_days is null or p_horizon_days <= 0 or p_horizon_days > 1825 then
    return jsonb_build_object('answered', false,
      'refusal', 'the horizon must be a whole number of days from 1 to 1825 — an index over zero days covers nothing and a negative window covers the past');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  v_end := v_today + p_horizon_days;

  select count(*) into v_packages
    from work_packages
   where organization_id = v_org and development_case_id = c.id
     and status = 'draft';

  -- REFUSAL 1: nothing packaged. An index over no packages is not 100%
  -- constraint-free and it is not 0% — it is a project nobody has packaged.
  if v_packages = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'plannedPackages', 0, 'horizonDays', p_horizon_days,
      'refusal', format('No unreleased work package exists on "%s", so there is no planned work to index. This is NOT 100%% constraint-free and it is NOT 0%% — it is a project whose work has not been packaged.', c.title));
  end if;

  -- THE WINDOW IS BOUNDED AT BOTH ENDS, and the lower bound is the fix for a
  -- silent lie the first draft shipped: `required_by <= v_end` alone admits a
  -- package that was needed four hundred days ago into a denominator the
  -- screen labels "the next N days". An index over a one-day horizon computed
  -- entirely from work due last year is a confident number about a window it
  -- never looked at. Overdue draft packages are NOT discarded — they are
  -- counted, listed and named in the refusals below, because work that was
  -- needed and never released is the loudest thing on this payload — but they
  -- are not the forward window's denominator.
  select count(*) filter (where required_by >= v_today),
         count(*) filter (where required_by < v_today)
    into v_planned, v_overdue
    from work_packages
   where organization_id = v_org and development_case_id = c.id
     and status = 'draft'
     and required_by is not null and required_by <= v_end;

  -- REFUSAL 2: an undated set. Every §49 denominator is "PLANNED work
  -- packages", and a package with no required-by date is not planned into any
  -- window. A set that is entirely OVERDUE lands here too, and says so: it is
  -- not an empty diary, it is a late project.
  if v_planned = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'plannedPackages', 0, 'unreleasedPackages', v_packages,
      'overduePackages', v_overdue,
      'horizonDays', p_horizon_days, 'horizonEnd', v_end,
      'refusal', format('None of the %s unreleased work package(s) on "%s" is dated into the next %s days, so the §49 denominator — PLANNED work packages — is empty. A window nobody has dated work into is not a constraint-free one.%s',
        v_packages, c.title, p_horizon_days,
        case when v_overdue > 0
          then format(' %s of them were needed on a date that has ALREADY PASSED and are still unreleased; late work is not forward work and does not make this window answerable.', v_overdue)
          else '' end));
  end if;

  for r in
    select p.id, p.package_code, p.package_type, p.title, p.required_by, p.area
      from work_packages p
     where p.organization_id = v_org and p.development_case_id = c.id
       and p.status = 'draft'
       and p.required_by is not null
       and p.required_by >= v_today and p.required_by <= v_end
     order by p.required_by, p.package_code
  loop
    -- THE ONE VERDICT. Read, never recomputed: this file looks at no
    -- constraint and decides nothing about readiness.
    v_verdict := sync_work_package_release_verdict(r.id);
    v_class := coalesce(v_verdict->>'verdict', 'unknown');

    if v_class = 'unassessed' then
      v_unassessed := v_unassessed + 1;
    else
      v_assessed := v_assessed + 1;
      if v_class = 'ready_for_human' then
        v_ready := v_ready + 1;
      else
        v_not_ready := v_not_ready + 1;
        if v_class = 'stale' then v_stale := v_stale + 1; end if;
      end if;
    end if;

    -- THE FORWARD HALF (I.28). Only meaningful for a package that is not
    -- ready today, and only readable from the ONE projection.
    v_forward_class := null;
    v_projected := null;
    v_burn := null;
    if v_class = 'unassessed' then
      v_forward_class := 'unassessed';
    elsif v_class = 'ready_for_human' then
      v_forward_class := 'ready_now';
    else
      v_burn := get_package_constraint_burndown(r.id,
        greatest(1, least(1825, (r.required_by - v_today) + 1)));
      if (v_burn->>'answered')::boolean is not true then
        v_forward_class := 'not_projectable';
        v_not_projectable := v_not_projectable + 1;
      elsif (v_burn->>'forecastComplete')::boolean is true then
        v_projected := (v_burn->>'projectedConstraintFreeDate')::date;
        if v_projected is not null and v_projected <= r.required_by then
          v_forward_class := 'forecast_clear_in_time';
          v_forecast_clear := v_forecast_clear + 1;
        elsif v_projected is not null then
          v_forward_class := 'forecast_clear_too_late';
        else
          -- Forecast-complete with no date means the open set is entirely
          -- SOFT: it does not stop a release and it does not date one. That
          -- is a position the projection states in words, and it is not a
          -- forward clearance.
          v_forward_class := 'not_projectable';
          v_not_projectable := v_not_projectable + 1;
        end if;
      else
        v_forward_class := 'not_projectable';
        v_not_projectable := v_not_projectable + 1;
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'packageId', r.id,
      'packageCode', r.package_code,
      'packageType', r.package_type,
      'title', r.title,
      'area', r.area,
      'requiredBy', r.required_by,
      'verdict', v_class,
      -- VERBATIM from the ONE verdict. The screen renders this sentence and
      -- never writes its own.
      'readiness', v_verdict->>'reason',
      'openHard', v_verdict->'openHard',
      'constraintsRecorded', v_verdict->'constraintsRecorded',
      'inWindow', true,
      'forward', v_forward_class,
      'projectedConstraintFreeDate', v_projected,
      'daysOverdue', null,
      'projectionRefusal', case
        when v_forward_class = 'not_projectable'
          then coalesce(v_burn->>'refusal', v_burn->>'projectedConstraintFreeRefusal')
        end));
  end loop;

  -- THE OVERDUE SET, listed rather than folded in. A package whose required-by
  -- date has already passed while it is still unreleased is LATE — a fact
  -- about the calendar, not a gap in the constraint register — and it is
  -- neither a forward position nor a silence. The first draft counted these
  -- inside the forward denominator, where a single missed date disabled the
  -- I.28 figure for the whole case permanently: on any project that has ever
  -- slipped, the forward half never answered again. They are reported here in
  -- their own set, with their own sentence, and they do not define a window
  -- labelled "the next N days".
  if v_overdue > 0 then
    for r in
      select p.id, p.package_code, p.package_type, p.title, p.required_by, p.area
        from work_packages p
       where p.organization_id = v_org and p.development_case_id = c.id
         and p.status = 'draft'
         and p.required_by is not null and p.required_by < v_today
       order by p.required_by, p.package_code
    loop
      v_verdict := sync_work_package_release_verdict(r.id);
      v_overdue_items := v_overdue_items || jsonb_build_array(jsonb_build_object(
        'packageId', r.id,
        'packageCode', r.package_code,
        'packageType', r.package_type,
        'title', r.title,
        'area', r.area,
        'requiredBy', r.required_by,
        'verdict', coalesce(v_verdict->>'verdict', 'unknown'),
        'readiness', v_verdict->>'reason',
        'openHard', v_verdict->'openHard',
        'constraintsRecorded', v_verdict->'constraintsRecorded',
        'inWindow', false,
        'forward', 'overdue',
        'projectedConstraintFreeDate', null,
        'daysOverdue', v_today - r.required_by,
        'projectionRefusal', format('Work package %s was needed on %s, %s day(s) ago, and is still unreleased. No forward projection is produced for a window that has closed, and this package is outside the %s-day window this index reports.',
          r.package_code, r.required_by, v_today - r.required_by, p_horizon_days)));
    end loop;
  end if;

  -- §49, TODAY. Denominator = the ASSESSED planned packages; refuses when
  -- none of them was assessed.
  v_index := sync_metric_ratio(v_ready, v_assessed,
    format('the Constraint-Free Work Index of "%s"', c.title), v_assessed, v_planned);
  -- Coverage: how much of the planned set the index is actually about. A 100%
  -- index over one of nine packages is not a project position, and this
  -- number is what says so.
  v_coverage := sync_metric_ratio(v_assessed, v_planned,
    format('constraint assessment coverage of "%s"', c.title));

  -- I.28, FORWARD. REFUSED whenever any non-ready package cannot be
  -- projected: a forward figure computed over a partly unprojectable set is
  -- the invented number this programme keeps deleting.
  if v_not_projectable > 0 then
    v_forward := jsonb_build_object('answered', false, 'kind', 'not_projectable',
      'pct', null, 'numerator', null, 'denominator', v_assessed,
      'refusal', format('No forward constraint-free figure: %s of the %s assessed package(s) cannot be projected at all — their constraint sets are unforecast, lapsed, undated or entirely soft. A forward percentage over a partly unprojectable set states a future nobody forecast.',
        v_not_projectable, v_assessed));
  else
    v_forward := sync_metric_ratio(v_ready + v_forecast_clear, v_assessed,
      format('forward constraint-free work on "%s"', c.title), v_assessed, v_planned);
  end if;

  if v_unassessed > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s of %s planned package(s) have NO constraint recorded against them. They are excluded from the index rather than counted as not-ready: an unassessed package is not a constrained one, and counting it as one would report blocking constraints on work nobody has looked at.', v_unassessed, v_planned),
      'scope', 'package'));
  end if;
  if v_stale > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s package(s) are counted as NOT ready because their recorded field-readiness assessment has been overtaken by their own canonical stores (the ONE verdict''s `stale` state). They are not blocked by a constraint; they are un-rechecked.', v_stale),
      'scope', 'package'));
  end if;
  if v_overdue > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s unreleased work package(s) were needed on a date that has ALREADY PASSED. They are LATE, they are listed in `overdue` with the days by which each has slipped, and they are OUTSIDE the %s-day window these percentages are about — a denominator labelled "the next %s days" that contains work due last year is a number about a window it never looked at. Nothing here reports them as clear.',
        v_overdue, p_horizon_days, p_horizon_days),
      'scope', 'overdue'));
  end if;
  if v_not_projectable > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s package(s) have no usable forward projection — their constraint sets are unforecast, lapsed, undated or entirely soft — so no forward constraint-free percentage is produced.', v_not_projectable),
      'scope', 'projection'));
  end if;

  return jsonb_build_object(
    'answered', true,
    'caseId', c.id,
    'caseTitle', c.title,
    'asOf', v_today,
    'horizonDays', p_horizon_days,
    'horizonEnd', v_end,
    'unreleasedPackages', v_packages,
    'plannedPackages', v_planned,
    'assessedPackages', v_assessed,
    'unassessedPackages', v_unassessed,
    'readyPackages', v_ready,
    'notReadyPackages', v_not_ready,
    'stalePackages', v_stale,
    'forecastClearInTime', v_forecast_clear,
    'notProjectable', v_not_projectable,
    'overduePackages', v_overdue,
    -- §49 (D7.20) and I.28 (D7.08). ONE calculation, two faces, and the
    -- register cites this function from both rows.
    'constraintFreeWorkIndex', v_index,
    'forwardConstraintFreeWork', v_forward,
    'assessmentCoverage', v_coverage,
    'packages', v_items,
    'overdue', v_overdue_items,
    'refusals', v_refusals,
    'basis', 'Spec §49''s Constraint-Free Work Index and spec I.28''s forward constraint-free work are the SAME calculation named twice, and this is it. Readiness per package is the ONE release verdict read verbatim; the forward half is the ONE constraint burn-down read verbatim. Nothing here looks at a constraint and decides. The denominator is the ASSESSED planned packages dated INSIDE the stated window — a package with no constraint recorded is unassessed, not constrained, and a package needed before today is late rather than forward — and both percentages refuse rather than divide over an empty or unassessed set.');
end
$$;

revoke all on function public.get_constraint_free_work_index(uuid, int) from public, anon;
grant execute on function public.get_constraint_free_work_index(uuid, int) to authenticated;

comment on function public.get_constraint_free_work_index(uuid, int) is
  'D7.20 (spec III.§49) AND D7.08 (spec I.28) — ONE calculation, cited from both register rows because the specification names the same quantity twice and D7.20''s own gap statement says so. Produces the index today and the forward figure, both over the ASSESSED planned packages, both refusing over an empty or wholly unassessed denominator, and neither recomputing readiness: the verdict comes from sync_work_package_release_verdict and the projection from get_package_constraint_burndown.';

create or replace function public.compute_constraint_free_work_index(
  p_case_id uuid,
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
  c development_cases%rowtype;
  v_result jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_run uuid;
  v_method text :=
    'Ready planned work packages over assessed planned work packages (spec §49), and the same denominator with forecast-clear-in-time packages added (spec I.28). Readiness per package is read from sync_work_package_release_verdict and the forward position from get_package_constraint_burndown — no constraint is inspected here and no readiness rule is stated here. Counting and one guarded division; the division refuses over an empty or wholly unassessed denominator rather than returning a percentage.';
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  -- ADMITS ai_admin: computing a metric is evidence assembly (RULING 22's
  -- scoping of §70). Nothing here declares readiness — the readiness
  -- sentences are the ONE verdict's own, and no act in this file can change
  -- one.
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a constraint-free work index requires a planning, engineering, supervisory or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;

  v_result := get_constraint_free_work_index(c.id, p_horizon_days);

  if (v_result->>'answered')::boolean is not true then
    v_refusals := jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'refusal', 'scope', 'case'));
    v_run := record_calculation_run(c.id, 'constraint_free_work_index', v_method,
      jsonb_build_object('caseId', c.id, 'horizonDays', p_horizon_days),
      jsonb_build_array(
        jsonb_build_object('table', 'work_packages',
          'scope', 'development_case_id = ' || c.id::text || ' and status = draft'),
        jsonb_build_object('table', 'restoration_constraints',
          'scope', 'the constraints of those packages')),
      null, v_refusals);
    return v_result || jsonb_build_object('calculationRunId', v_run,
      'codeVersion', sync_calculation_code_version('constraint_free_work_index'));
  end if;

  v_refusals := coalesce(v_result->'refusals', '[]'::jsonb);
  -- A REFUSED percentage inside an ANSWERED payload is itself a refusal, and
  -- it is recorded as one. The first draft recorded only the top-level
  -- refusal, so a run whose index refused over an unassessed set was stored
  -- with status `computed` and a null percentage — a lineage row asserting a
  -- clean calculation happened.
  if (v_result->'constraintFreeWorkIndex'->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->'constraintFreeWorkIndex'->>'refusal', 'scope', 'index'));
  end if;
  if (v_result->'forwardConstraintFreeWork'->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->'forwardConstraintFreeWork'->>'refusal', 'scope', 'forward'));
  end if;

  v_run := record_calculation_run(c.id, 'constraint_free_work_index', v_method,
    jsonb_build_object('caseId', c.id, 'horizonDays', v_result->'horizonDays',
      'asOf', v_result->'asOf', 'plannedPackages', v_result->'plannedPackages',
      'assessedPackages', v_result->'assessedPackages'),
    jsonb_build_array(
      jsonb_build_object('table', 'work_packages',
        'scope', 'development_case_id = ' || c.id::text || ' and status = draft'),
      jsonb_build_object('table', 'restoration_constraints',
        'scope', 'the constraints of those packages'),
      jsonb_build_object('function', 'sync_work_package_release_verdict',
        'scope', 'the ONE readiness verdict, read per package'),
      jsonb_build_object('function', 'get_package_constraint_burndown',
        'scope', 'the ONE forward projection, read per not-ready package')),
    jsonb_build_object(
      'constraintFreeWorkIndex', v_result->'constraintFreeWorkIndex',
      'forwardConstraintFreeWork', v_result->'forwardConstraintFreeWork',
      'assessmentCoverage', v_result->'assessmentCoverage',
      'readyPackages', v_result->'readyPackages',
      'notReadyPackages', v_result->'notReadyPackages',
      'unassessedPackages', v_result->'unassessedPackages',
      'stalePackages', v_result->'stalePackages',
      'forecastClearInTime', v_result->'forecastClearInTime',
      'notProjectable', v_result->'notProjectable',
      'overduePackages', v_result->'overduePackages',
      'packages', v_result->'packages',
      'overdue', v_result->'overdue'),
    v_refusals);

  return v_result || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('constraint_free_work_index'),
    'recorded', true,
    'recordNote', 'This index is now a row in calculation_runs, with every refusal it hit on the way. It cannot be edited or deleted by any client, and the next one is recorded BESIDE it.');
end
$$;

revoke all on function public.compute_constraint_free_work_index(uuid, int) from public, anon;
grant execute on function public.compute_constraint_free_work_index(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. PLANNED-WORK-READY % (D7.13) AND READY-WORK-EXECUTED % (D7.14).
--    Spec II.5, and built together because the second's denominator is the
--    first's numerator.
--
--    THE UNIT IS THE WORK ORDER, NOT THE PACKAGE, and that is what keeps this
--    from being a third answer to §49's question. The Constraint-Free Work
--    Index above is a PACKAGE-level position read from the package verdict;
--    workface planning (spec II.5) is about "exactly what can be executed
--    tomorrow" — the crew's unit is the job. So this metric reads the ONE
--    element predicate per work order and counts jobs, and the two never
--    divide the same set.
--
--    A WORK ORDER IS READY when `sync_field_readiness_elements` reports zero
--    BLOCKED elements AND the ONE verdict does not hold its package back.
--    `unverifiable` and `not_applicable` are not blockers here, which is that
--    predicate's own stated posture (RULING 22: a door that blocked on
--    unverifiable would refuse every job in this repository forever) rather
--    than a leniency chosen at this door. Three of the ten elements are
--    unverifiable for every job in this product, and the payload says so
--    beside the percentage rather than letting a reader assume ten were
--    checked.
--
--    A work order the predicate REFUSES to answer for is `not_assessable` —
--    counted, reported, and excluded from both numerator and denominator, so
--    a job whose job plan cannot be read never silently reads as ready.
--
-- ── THE PACKAGE VERDICT IS AN INPUT, AND IT HAS TO BE ──────────────────────
--
--    The first draft read ONLY the element predicate. That predicate is a
--    WORK-ORDER predicate: it knows about job plans, materials, permits and
--    isolation, and it knows nothing about the ten §28 package constraints.
--    So a package with ZERO constraints recorded — `unassessed` on the ONE
--    verdict, the state spec §27 exists to name — produced this payload:
--
--        constraintFreeWorkIndex   NOT ASSESSED (nobody looked)
--        forwardConstraintFreeWork NOT ASSESSED (nobody looked)
--        plannedWorkReady          100%
--        readyWorkExecuted         100%
--
--    Four tiles about ONE package, two of them refusing to state a position
--    and two of them stating the best possible one. That is the "second
--    verdict wearing a percentage sign" this slice was written to avoid — not
--    because the metric re-derives elements (it does not) but because it
--    applied a readiness standard the other three percentages refuse to
--    apply, on the same screen, in the same payload.
--
--    So the ONE verdict is READ per job, for the earliest-dated package the
--    job sits in, and it is MAPPED, never restated:
--
--      unassessed                  → the package position is UNKNOWN. The job
--                                    is `package_unassessed`: excluded from
--                                    both numerator and denominator, exactly
--                                    as the index excludes it, because "not
--                                    assessed" and "assessed and not ready"
--                                    are opposite facts.
--      released | ready_for_human  → the package does not hold the job back;
--                                    the element predicate decides alone.
--      anything else               → the package holds the job back, and the
--                                    verdict's OWN sentence says why. This
--                                    door writes no readiness sentence.
--
--    A RELEASED package is `canRelease: false` on the ONE verdict and that is
--    NOT a blocker here: it means the release already happened, which is the
--    state a crew executes in. Reading `canRelease` as "ready" would have
--    marked every released job in the product as blocked.
-- ---------------------------------------------------------------------------
create or replace function public.get_workface_execution_metrics(
  p_case_id uuid,
  p_window_start date default null,
  p_window_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_start date := coalesce(p_window_start, current_date);
  v_end date;
  v_planned int := 0;
  v_assessable int := 0;
  v_not_assessable int := 0;
  v_package_unassessed int := 0;
  v_package_blocked int := 0;
  v_ready int := 0;
  v_blocked int := 0;
  v_executed int := 0;
  v_ready_not_started int := 0;
  v_unverifiable_total int := 0;
  v_items jsonb := '[]'::jsonb;
  v_ready_pct jsonb;
  v_executed_pct jsonb;
  v_coverage jsonb;
  v_refusals jsonb := '[]'::jsonb;
  r record;
  v_elements jsonb;
  v_state text;
  v_blocked_here int;
  v_unverifiable_here int;
  v_executed_here boolean;
  v_pkg_verdict jsonb;
  v_pkg_class text;
  v_pkg_clear boolean;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  v_end := coalesce(p_window_end, v_start + 14);
  if v_end <= v_start then
    return jsonb_build_object('answered', false,
      'refusal', 'the workface window ends on or before it starts. A window of no days holds no planned work, and a percentage over it would report a position nobody planned.');
  end if;
  if (v_end - v_start) > 365 then
    return jsonb_build_object('answered', false,
      'refusal', 'a workface look-ahead longer than a year is not a workface window — spec II.5 is about what a crew can execute tomorrow, and a figure over a year of it answers a different question');
  end if;

  for r in
    -- GROUPED, NOT DISTINCT. RULING 19 permits the same work order to belong
    -- to packages at different AWP levels — "the job named in the CWP is the
    -- job the IWP installs" — and a `select distinct` over rows carrying the
    -- package code would return that job TWICE, counting one crew's work
    -- twice in both denominators. The job is the unit here, so it is grouped
    -- to one row and the earliest-dated package it sits in is named beside it.
    select w.id, w.wo_number, w.title, w.status, w.asset_id,
           min(p.required_by) as required_by,
           (array_agg(p.package_code order by p.required_by, p.package_code))[1]
             as package_code,
           (array_agg(p.id order by p.required_by, p.package_code))[1]
             as package_id,
           count(distinct p.id) as package_count
      from work_packages p
      join work_package_work ww on ww.work_package_id = p.id
      join work_orders w on w.id = ww.work_order_id
     where p.organization_id = v_org
       and p.development_case_id = c.id
       and p.status <> 'cancelled'
       and p.required_by is not null
       and p.required_by >= v_start and p.required_by <= v_end
       and w.organization_id = v_org
     group by w.id, w.wo_number, w.title, w.status, w.asset_id
     order by min(p.required_by), w.wo_number
  loop
    v_planned := v_planned + 1;

    -- THE ONE VERDICT, for the package this job sits in. Read and mapped,
    -- never restated: this door does not look at a constraint and decide.
    v_pkg_verdict := sync_work_package_release_verdict(r.package_id);
    v_pkg_class := coalesce(v_pkg_verdict->>'verdict', 'unknown');
    -- `released` is CLEAR, not blocked. The ONE verdict reports `canRelease`
    -- false for an already-released package because it is not released twice,
    -- and that is the state a crew works in.
    v_pkg_clear := v_pkg_class in ('released', 'ready_for_human');

    -- THE ONE ELEMENT PREDICATE. Read, never restated. This file states no
    -- element rule and knows nothing about materials, permits or isolation.
    v_elements := sync_field_readiness_elements(r.id, r.asset_id);

    if v_pkg_class = 'unassessed' then
      -- NOT ASSESSED. Not "ready" and not "blocked": nobody has recorded a
      -- constraint position for the package this job belongs to, and a
      -- percentage that counted it either way would state a position nobody
      -- holds. Excluded from both the numerator and the denominator, exactly
      -- as the Constraint-Free Work Index excludes it.
      v_state := 'package_unassessed';
      v_package_unassessed := v_package_unassessed + 1;
      v_blocked_here := null;
      v_unverifiable_here := null;
    elsif (v_elements->>'answered')::boolean is false then
      v_state := 'not_assessable';
      v_not_assessable := v_not_assessable + 1;
      v_blocked_here := null;
      v_unverifiable_here := null;
    else
      v_assessable := v_assessable + 1;
      v_blocked_here := coalesce((v_elements->>'blocked')::int, 0);
      v_unverifiable_here := coalesce((v_elements->>'unverifiable')::int, 0);
      v_unverifiable_total := v_unverifiable_total + v_unverifiable_here;
      if v_blocked_here = 0 and v_pkg_clear then
        v_state := 'ready';
        v_ready := v_ready + 1;
      else
        v_state := 'blocked';
        v_blocked := v_blocked + 1;
        if v_blocked_here = 0 and not v_pkg_clear then
          v_package_blocked := v_package_blocked + 1;
        end if;
      end if;
    end if;

    -- EXECUTION IS work_orders.status, which is where the execution state of
    -- the work lives (RULING 19). A package's status is its RELEASE state and
    -- says nothing about whether a crew started.
    v_executed_here := coalesce(r.status, '') in ('in_progress', 'completed');
    if v_state = 'ready' then
      if v_executed_here then
        v_executed := v_executed + 1;
      else
        v_ready_not_started := v_ready_not_started + 1;
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'workOrderId', r.id,
      'woNumber', r.wo_number,
      'title', r.title,
      'packageId', r.package_id,
      'packageCode', r.package_code,
      'packageCount', r.package_count,
      'requiredBy', r.required_by,
      'executionStatus', r.status,
      'fieldReady', v_state,
      -- THE PACKAGE POSITION TRAVELS WITH THE JOB, so the two halves of the
      -- screen cannot state opposite things about the same package.
      'packageVerdict', v_pkg_class,
      'packageReadiness', v_pkg_verdict->>'reason',
      'blockedElements', v_blocked_here,
      'unverifiableElements', v_unverifiable_here,
      'executed', v_executed_here,
      'detail', case v_state
        when 'package_unassessed' then v_pkg_verdict->>'reason'
        when 'not_assessable' then v_elements->>'refusal'
        when 'ready' then format('Every element a canonical store can answer is ready%s, and its work package is %s.',
          case when coalesce(v_unverifiable_here, 0) > 0
            then format('; %s element(s) have no store and are reported unverifiable rather than ready', v_unverifiable_here)
            else '' end,
          case when v_pkg_class = 'released' then 'released' else 'clear of open hard constraints' end)
        when 'blocked' then case
          when coalesce(v_blocked_here, 0) = 0 then v_pkg_verdict->>'reason'
          when v_pkg_clear then format('%s of the ten field-ready elements are blocked.', v_blocked_here)
          else format('%s of the ten field-ready elements are blocked, and its work package is held back as well: %s',
            v_blocked_here, v_pkg_verdict->>'reason') end
        else v_elements->>'refusal' end));
  end loop;

  -- REFUSAL 1: an empty denominator. THE ROW. Not 0%, not 100%.
  if v_planned = 0 then
    return jsonb_build_object('answered', false, 'caseId', c.id,
      'windowStart', v_start, 'windowEnd', v_end, 'plannedWorkOrders', 0,
      'refusal', format('No work order on "%s" sits in a work package dated between %s and %s, so the workface denominator is empty. This is NOT 0%% planned-work-ready and it is NOT 100%% — it is a look-ahead window with no planned work in it.',
        c.title, v_start, v_end));
  end if;

  -- D7.13. Denominator = the ASSESSABLE planned work orders; refused when
  -- none could be assessed, because 0% would say "planned and not ready"
  -- about work the predicate could not answer for at all.
  v_ready_pct := sync_metric_ratio(v_ready, v_assessable,
    format('planned-work-ready on "%s"', c.title), v_assessable, v_planned);

  -- COVERAGE, which the index has carried since it was written and these two
  -- did not. A "100% — 1 of 1" tile over ten planned jobs of which nine could
  -- not be assessed is not a workface position, and this is the number that
  -- says so beside the percentage rather than only in the prose below it.
  v_coverage := sync_metric_ratio(v_assessable, v_planned,
    format('workface assessment coverage of "%s"', c.title));

  -- D7.14. Denominator = THE READY SET, which is the previous numerator. An
  -- empty ready set refuses, and the refusal distinguishes the two ways it
  -- can be empty: assessed-and-none-ready, or nothing assessable at all.
  if v_ready = 0 then
    v_executed_pct := jsonb_build_object('answered', false,
      'kind', case when v_assessable = 0 then 'not_assessed' else 'empty_denominator' end,
      'pct', null, 'numerator', 0, 'denominator', 0,
      'refusal', case when v_assessable = 0
        then format('No ready-work-executed percentage for "%s": none of the %s planned work order(s) could be assessed at all (%s in an unassessed work package, %s the field-readiness predicate refused to answer for), so there is no ready set to have executed. "Not assessed" is not "assessed and none ready".',
          c.title, v_planned, v_package_unassessed, v_not_assessable)
        else format('No ready-work-executed percentage for "%s": %s planned work order(s) were assessed and NONE of them is field-ready, so the ready set is empty. That is a real and reportable position — 0%% ready — and it is a different fact from 0%% of ready work being executed, which this refuses to state over an empty set.',
          c.title, v_assessable) end);
  else
    v_executed_pct := sync_metric_ratio(v_executed, v_ready,
      format('ready-work-executed on "%s"', c.title));
  end if;

  if v_package_unassessed > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s of %s planned work order(s) sit in a work package with NO constraint recorded against it — `unassessed` on the ONE release verdict. They are excluded from both percentages rather than counted as ready: the field-readiness elements are a work-order predicate and say nothing about the ten package constraints, so reporting these jobs ready would state a position the release door refuses to state about the same package on the same screen.',
        v_package_unassessed, v_planned),
      'scope', 'work_package'));
  end if;
  if v_package_blocked > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s of %s planned work order(s) are field-ready on every element a store can answer and are still counted NOT ready, because the ONE release verdict holds their work package back. The verdict''s own sentence is carried on each job.',
        v_package_blocked, v_planned),
      'scope', 'work_package'));
  end if;
  if v_not_assessable > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s of %s planned work order(s) could not be assessed by the field-readiness predicate at all — it refused to answer for them. They are excluded from both percentages rather than counted as ready or as blocked.', v_not_assessable, v_planned),
      'scope', 'work_order'));
  end if;
  if v_unverifiable_total > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s element position(s) across the assessed work orders are UNVERIFIABLE — crew, access and work-order predecessors have no canonical store in this product (D7.12). A work order counted READY here is ready on the elements a store can answer, not on all ten.', v_unverifiable_total),
      'scope', 'element'));
  end if;

  return jsonb_build_object(
    'answered', true,
    'caseId', c.id,
    'caseTitle', c.title,
    'windowStart', v_start,
    'windowEnd', v_end,
    'plannedWorkOrders', v_planned,
    'assessableWorkOrders', v_assessable,
    'notAssessableWorkOrders', v_not_assessable,
    'packageUnassessedWorkOrders', v_package_unassessed,
    'packageBlockedWorkOrders', v_package_blocked,
    'readyWorkOrders', v_ready,
    'blockedWorkOrders', v_blocked,
    'executedReadyWorkOrders', v_executed,
    'readyNotStarted', v_ready_not_started,
    'unverifiableElementPositions', v_unverifiable_total,
    'plannedWorkReady', v_ready_pct,
    'readyWorkExecuted', v_executed_pct,
    'assessmentCoverage', v_coverage,
    'workOrders', v_items,
    'refusals', v_refusals,
    'basis', 'Spec II.5 measured on the WORK ORDER, which is the crew''s unit — the Constraint-Free Work Index is the package-level position and the two never divide the same set. Field readiness per job is the ONE element predicate read verbatim AND the ONE release verdict of the job''s package read verbatim: a job in a package nobody has assessed is excluded rather than counted ready, and a job whose package is held back carries the verdict''s own sentence. Execution is work_orders.status, which is where the execution state of the work lives. Both percentages refuse over an empty denominator, the ready-work-executed refusal says WHICH kind of empty it is, and the coverage figure states how much of the planned set the percentages are actually about.');
end
$$;

revoke all on function public.get_workface_execution_metrics(uuid, date, date) from public, anon;
grant execute on function public.get_workface_execution_metrics(uuid, date, date) to authenticated;

comment on function public.get_workface_execution_metrics(uuid, date, date) is
  'D7.13 + D7.14 (spec II.5): planned-work-ready % and ready-work-executed %, over the work orders in packages dated into a look-ahead window. Reads the ONE field-readiness element predicate per job and the ONE execution state (work_orders.status); states no element rule of its own. Refuses over an empty denominator, over a set nothing could assess, and — for ready-work-executed — distinguishes "assessed and none ready" from "nothing assessable" in the refusal itself.';

create or replace function public.compute_workface_execution_metrics(
  p_case_id uuid,
  p_window_start date default null,
  p_window_end date default null
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
  c development_cases%rowtype;
  v_result jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_run uuid;
  v_method text :=
    'Ready planned work orders over assessable planned work orders (planned-work-ready), and executed ready work orders over ready work orders (ready-work-executed), across the work orders in work packages dated into a look-ahead window. Field readiness per job is read from sync_field_readiness_elements — a job is ready when it has zero BLOCKED elements — and the ONE release verdict of its work package is read beside it: a job in an `unassessed` package is excluded from both counts and a job whose package is held back is not ready. Execution is read from work_orders.status. Counting and two guarded divisions; each refuses over an empty or unassessed denominator rather than returning a percentage.';
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording workface metrics requires a planning, engineering, supervisory or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;

  v_result := get_workface_execution_metrics(c.id, p_window_start, p_window_end);

  if (v_result->>'answered')::boolean is not true then
    v_refusals := jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'refusal', 'scope', 'case'));
    v_run := record_calculation_run(c.id, 'workface_execution_metrics', v_method,
      jsonb_build_object('caseId', c.id, 'windowStart', p_window_start,
        'windowEnd', p_window_end),
      jsonb_build_array(
        jsonb_build_object('table', 'work_package_work',
          'scope', 'packages of case ' || c.id::text || ' dated into the window'),
        jsonb_build_object('table', 'work_orders', 'scope', 'their member work orders')),
      null, v_refusals);
    return v_result || jsonb_build_object('calculationRunId', v_run,
      'codeVersion', sync_calculation_code_version('workface_execution_metrics'));
  end if;

  v_refusals := coalesce(v_result->'refusals', '[]'::jsonb);
  if (v_result->'plannedWorkReady'->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->'plannedWorkReady'->>'refusal', 'scope', 'planned_work_ready'));
  end if;
  if (v_result->'readyWorkExecuted'->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->'readyWorkExecuted'->>'refusal', 'scope', 'ready_work_executed'));
  end if;
  if (v_result->'assessmentCoverage'->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->'assessmentCoverage'->>'refusal', 'scope', 'assessment_coverage'));
  end if;

  v_run := record_calculation_run(c.id, 'workface_execution_metrics', v_method,
    jsonb_build_object('caseId', c.id, 'windowStart', v_result->'windowStart',
      'windowEnd', v_result->'windowEnd',
      'plannedWorkOrders', v_result->'plannedWorkOrders',
      'assessableWorkOrders', v_result->'assessableWorkOrders'),
    jsonb_build_array(
      jsonb_build_object('table', 'work_package_work',
        'scope', 'packages of case ' || c.id::text || ' dated into the window'),
      jsonb_build_object('table', 'work_orders', 'scope', 'their member work orders'),
      jsonb_build_object('function', 'sync_field_readiness_elements',
        'scope', 'the ONE field-ready predicate, read per work order')),
    jsonb_build_object(
      'plannedWorkReady', v_result->'plannedWorkReady',
      'readyWorkExecuted', v_result->'readyWorkExecuted',
      'assessmentCoverage', v_result->'assessmentCoverage',
      'readyWorkOrders', v_result->'readyWorkOrders',
      'blockedWorkOrders', v_result->'blockedWorkOrders',
      'notAssessableWorkOrders', v_result->'notAssessableWorkOrders',
      'packageUnassessedWorkOrders', v_result->'packageUnassessedWorkOrders',
      'packageBlockedWorkOrders', v_result->'packageBlockedWorkOrders',
      'executedReadyWorkOrders', v_result->'executedReadyWorkOrders',
      'readyNotStarted', v_result->'readyNotStarted',
      'unverifiableElementPositions', v_result->'unverifiableElementPositions',
      'workOrders', v_result->'workOrders'),
    v_refusals);

  return v_result || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('workface_execution_metrics'),
    'recorded', true,
    'recordNote', 'These metrics are now a row in calculation_runs, with every refusal they hit on the way. A history that kept only the answered weeks would show a clean sequence with the unassessable ones missing.');
end
$$;

revoke all on function public.compute_workface_execution_metrics(uuid, date, date)
  from public, anon;
grant execute on function public.compute_workface_execution_metrics(uuid, date, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE COMPOSED SYNC FIELD READ (D7.16, spec II.engines).
--
--    COMPOSITION, NOT COMPUTATION. Every figure here is another function's,
--    returned as that function returned it. This exists so the Sync Field
--    surface makes ONE round trip instead of five, and so a reader can see in
--    one place that the module is composed rather than re-derived.
--
--    The row it serves stays 🟡 and says why: D7.16 names the AWP chain (7A,
--    closed), the workface metrics (this slice, closed) and a composed
--    navigation surface (this function and its page, closed) — but the
--    engine it composes still carries D7.06, D7.07 and D7.12 open, and a
--    composition is not more complete than its parts.
-- ---------------------------------------------------------------------------
create or replace function public.get_sync_field_module(
  p_case_id uuid,
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
  c development_cases%rowtype;
  v_weeks int;
  v_workface_end date;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  -- THE HORIZON IS VALIDATED HERE, ONCE, FOR THE WHOLE MODULE.
  --
  -- The first draft passed `p_horizon_days` straight through and derived the
  -- resource window as `greatest(1, least(260, p_horizon_days / 7))`. Postgres
  -- GREATEST and LEAST IGNORE null arguments, so a null horizon evaluated to
  -- `greatest(1, 260)` — 260 weeks — and this RPC is granted to
  -- `authenticated`. One payload then refused the index because the horizon
  -- was unusable and answered a FIVE-YEAR resource position computed from the
  -- same unusable input. A module that half-refuses an input is worse than one
  -- that refuses it, because the half that answered looks deliberate.
  if p_horizon_days is null or p_horizon_days <= 0 or p_horizon_days > 1825 then
    return jsonb_build_object('answered', false, 'caseId', p_case_id,
      'refusal', 'the horizon must be a whole number of days from 1 to 1825. Every figure on this module is about that window, so an unusable horizon refuses the whole module rather than half of it.');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'development case not found');
  end if;
  v_weeks := greatest(1, least(260, p_horizon_days / 7));
  -- THE WORKFACE WINDOW IS THE CALLER'S WINDOW, not a constant.
  --
  -- The first draft called `get_workface_execution_metrics(c.id, null, null)`,
  -- which defaults to fourteen days, while the index and the resource reads
  -- honoured `p_horizon_days`. On an ordinary case with packages at +30, +45
  -- and +60 days and a 90-day horizon, the index answered and BOTH workface
  -- percentages showed the empty-window refusal permanently — honest, but a
  -- composed surface that can never display two of the four metrics it exists
  -- to compose, with nothing in the payload saying the window was chosen for
  -- the reader. `get_workface_execution_metrics` refuses a look-ahead longer
  -- than a year by its own rule, so the horizon is clamped to that rule rather
  -- than sent through to be refused.
  v_workface_end := current_date + least(365, p_horizon_days);

  return jsonb_build_object(
    'answered', true,
    'caseId', c.id,
    'caseTitle', c.title,
    'asOf', current_date,
    'horizonDays', p_horizon_days,
    'horizonWeeks', v_weeks,
    'workfaceWindowEnd', v_workface_end,
    'packages', get_case_work_packages(c.id),
    'constraintFreeWork', get_constraint_free_work_index(c.id, p_horizon_days),
    'workface', get_workface_execution_metrics(c.id, current_date, v_workface_end),
    'resourceBalance', get_case_resource_balance(c.id, v_weeks),
    'portfolioConflicts', get_portfolio_resource_conflicts(v_weeks),
    'executionReadiness', get_execution_readiness_board(c.id),
    'composition', jsonb_build_array(
      jsonb_build_object('part', 'Work packaging (AWP chain)', 'row', 'D7.10/D7.17', 'source', 'get_case_work_packages'),
      jsonb_build_object('part', 'Constraint-free work', 'row', 'D7.08/D7.20', 'source', 'get_constraint_free_work_index'),
      jsonb_build_object('part', 'Workface planning', 'row', 'D7.13/D7.14', 'source', 'get_workface_execution_metrics'),
      jsonb_build_object('part', 'Resource demand and capacity', 'row', 'D7.01', 'source', 'get_case_resource_balance'),
      jsonb_build_object('part', 'Portfolio resource conflicts', 'row', 'D7.02', 'source', 'get_portfolio_resource_conflicts'),
      jsonb_build_object('part', 'Execution readiness', 'row', 'D7.19/D13.09', 'source', 'get_execution_readiness_board')),
    'openParts', jsonb_build_array(
      jsonb_build_object('row', 'D7.06', 'gap', 'the release door does not REQUIRE a field-readiness assessment, so a package nobody walked can still read ready for a person'),
      jsonb_build_object('row', 'D7.07', 'gap', 'run_recovery_escalation_clock still has no scheduled caller, so the burn-down''s escalation half is unwired'),
      jsonb_build_object('row', 'D7.12', 'gap', 'three of the ten field-ready elements — crew, access, work-order predecessors — have no canonical store and are reported unverifiable')),
    'basis', 'Sync Field, composed. Every figure on this payload is another function''s answer returned verbatim; nothing here recomputes a readiness verdict, a constraint position or a percentage. The parts still open are listed rather than implied, because a composed module is not more complete than what it composes.');
end
$$;

revoke all on function public.get_sync_field_module(uuid, int) from public, anon;
grant execute on function public.get_sync_field_module(uuid, int) to authenticated;

comment on function public.get_sync_field_module(uuid, int) is
  'D7.16 (spec II.engines): the composed Sync Field module — work packaging, constraint-free work, workface planning, resource demand/capacity, portfolio conflicts and execution readiness in one payload. COMPOSES and never recomputes: each figure is the owning function''s own answer. Carries the list of parts still open, so the composition cannot read as more complete than its pieces.';

notify pgrst, 'reload schema';
