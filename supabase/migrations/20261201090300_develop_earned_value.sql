-- ============================================================================
-- Sync Develop Slice 4B — THE EARNED VALUE METRIC SUITE (D5.05, spec I.8) and
-- PERFORMANCE TRENDING (D5.06), each recording a lineage run (D11.29).
--
-- Spec I.8: "Then CPI/SPI where appropriate, earned value, earned schedule,
-- EAC, VAC, cost trend, schedule trend, milestone confidence, productivity,
-- rules of credit."
--
-- ── THE RULE THIS FILE IS WRITTEN AROUND ───────────────────────────────────
-- AN EARNED-VALUE NUMBER WITH NO BASIS IS WORSE THAN NO NUMBER. A CPI of 1.0
-- over an empty activity set is not "on budget": it is arithmetic performed
-- on nothing, and it is indistinguishable on screen from a project that is
-- genuinely on budget. Every metric below therefore REFUSES BY NAME rather
-- than defaulting, and the refusal is recorded on the lineage run beside the
-- metrics that did compute.
--
-- The specific defaults this file must never produce, each with the guard
-- that prevents it:
--
--   100% complete assumed          → EV is a sum over RECORDED claims only;
--                                    an element with no claim contributes
--                                    nothing and is counted as unclaimed.
--   an element silently dropping   → EV is CUMULATIVE TO THE DATA DATE: the
--     out of EV because nobody       latest position PER ELEMENT at or
--     re-typed it this period        before the period end. Summing only
--                                    this period's claim rows manufactures a
--                                    cost overrun out of ordinary reporting
--                                    practice ("claim what moved"), and the
--                                    caveat says how many positions were
--                                    carried forward.
--   claimed scope that is not in   → when EVERY claimed element resolves to
--     the budget → CPI 0.000         a zero element budget the EV REFUSES;
--                                    a zero EV against a positive AC prints
--                                    the most alarming statement earned
--                                    value can make, from arithmetic
--                                    performed on nothing.
--   earned schedule read off an    → ES refuses BELOW the first planned
--     invented origin                point for the same reason it refuses
--                                    ABOVE the last one.
--   a HIGH confidence quoted with  → coverage travels with the band on the
--     no coverage beside it          run and on every consumer of it.
--   absent rule of credit = full   → a claim cannot exist without a rule
--     credit                         (20261201090000); there is no path.
--   missing actual cost → 0        → AC is null when no line carries an
--                                    actual, and CPI refuses. A zero AC with
--                                    a positive EV is infinite efficiency.
--   PV zero/absent → Infinity      → SPI refuses on a null OR zero PV.
--   empty activity set → CPI 1.0   → no claims at all refuses EV outright.
--   forecast with no confidence    → every EAC carries the D5.17 rating.
--   P50/P80 with no distribution   → not in this file at all; 20261201090400
--                                    presents the deterministic figure and
--                                    says what is missing.
--
-- ── WHICH EAC FORMULA, AND WHY IT IS NAMED ─────────────────────────────────
-- Three EAC formulas are in common use and they disagree by tens of percent:
--
--     EAC = BAC / CPI                  (past cost performance continues)
--     EAC = AC + (BAC - EV)            (the remainder runs to plan)
--     EAC = AC + (BAC - EV)/(CPI*SPI)  (cost and schedule pressure both continue)
--
-- RULING: this product computes the FIRST and says so, on the number, every
-- time. `eacFormula` is returned with the value and recorded on the run. When
-- CPI is unavailable the EAC REFUSES; it does not fall back to the second
-- formula, because a figure that silently changes its own definition when an
-- input goes missing is the most dangerous number in project controls — it
-- keeps its shape while changing its meaning, and no reader can see it
-- happen. The other two formulas are a deliberate future addition that must
-- arrive as a CHOICE recorded on the run, not as a fallback.
--
-- ── THE DATA DATE: WHY THE SUITE ONLY COMPUTES AT THE LATEST PERIOD ────────
-- Actual cost lives on project_cost_items.actual as a RUNNING TOTAL (spec
-- §23, Slice 4A). There is no time-phased actuals ledger and this slice does
-- not fork one. So an earned value computed for an EARLIER period would pair
-- that period's earned value with TODAY's actual cost and report a CPI that
-- belongs to neither. The suite therefore computes at the LATEST period only.
-- Historic performance is not recomputed — it is READ from the runs recorded
-- while each period was current, which is what makes the trend a trend
-- (D5.06) rather than today's answer painted along a time axis.
--
-- "AT THE LATEST PERIOD" MEANS AT THAT DATE, NOT OUT OF THAT PERIOD'S INBOX.
-- The earned value is the sum of the latest recorded position PER ELEMENT at
-- or before the period end, which is what cumulative-to-date means. The two
-- readings differ enormously: on a case whose elements are claimed only when
-- they move, the period-rows reading dropped a 100%-complete package out of
-- the total the month after it completed and reported a five-fold EAC error
-- as a cost overrun. Both counts are returned — `claimCount` is the number
-- of element positions the total is made of, `claimsInLatestPeriod` is how
-- many were filed this period — because "eleven elements hold a position"
-- and "two were updated" are different facts.
--
-- AND A CLOSED LATEST PERIOD IS SAID OUT LOUD. Claims freeze on close; the
-- cost ledger does not. A suite computed after the period closed is today's
-- actual cost against a frozen position, so it carries a caveat saying so
-- and get_case_performance_trend refuses to file it as that period's
-- history — otherwise a closed period's recorded point would move whenever
-- somebody revised a cost line, which is the property a trend cannot have.
--
-- ── ONE CURRENCY, OR NO TOTAL ──────────────────────────────────────────────
-- 20261130090200 enforces one currency per cost line against its business
-- case. A case carrying lines in more than one currency (two business cases,
-- two currencies) still cannot be added up, and the refusal NAMES the
-- currencies rather than borrowing the unit of the first row.
--
-- Canonical reuse: project_cost_items (D5.29), project_wbs_elements (D5.01),
-- project_progress_claims / periods / rules (D5.06), record_calculation_run
-- (D11.29), estimate_confidence_rating (D5.17). No second cost store, no
-- second progress store, no second lineage record.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE ONE EARNED-VALUE PREDICATE. A read: it computes and refuses, and it
-- writes nothing. compute_case_earned_value below is the same answer PLUS
-- its lineage row — the 4A split, kept, because a stable read that writes is
-- a read nobody can call twice and optional lineage is missing lineage.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_earned_value(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  p project_progress_periods%rowtype;

  v_currencies text[];
  v_currency text;
  v_bac numeric;
  v_bac_refusal text;
  v_line_count int := 0;
  v_unbaselined int := 0;

  v_claim_count int := 0;
  v_claims_this_period int := 0;
  v_carried_forward int := 0;
  v_position_ids uuid[];
  v_ev numeric;
  v_ev_refusal text;
  v_overlap text;
  v_zero_bac_elements int := 0;
  v_basis_digest text;
  v_closed_note text;

  v_pv numeric;
  v_pv_refusal text;
  v_ac numeric;
  v_ac_refusal text;
  v_ac_lines int := 0;

  v_cpi numeric; v_cpi_refusal text;
  v_spi numeric; v_spi_refusal text;
  v_es numeric;  v_es_refusal text;
  v_spi_t numeric;
  v_eac numeric; v_eac_refusal text;
  v_vac numeric; v_vac_refusal text;

  v_period_index int;
  v_gap_periods text;
  v_plan_count int;
  v_ev_percent numeric;
  v_j int;
  v_plan_j numeric;
  v_plan_next numeric;
  v_plan_last numeric;
  v_plan_first numeric;

  v_refusals jsonb := '[]'::jsonb;
  v_caveats jsonb := '[]'::jsonb;
  v_elements jsonb := '[]'::jsonb;
  v_confidence jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ── BAC. One currency or no total. ──────────────────────────────────────
  select count(*), count(*) filter (where ci.baseline_cost is null),
         array_agg(distinct ci.currency)
    into v_line_count, v_unbaselined, v_currencies
  from project_cost_items ci where ci.development_case_id = c.id;

  if coalesce(v_line_count, 0) = 0 then
    v_bac_refusal :=
      'No cost line is recorded on this case, so there is no budget at completion. Every earned-value metric is a ratio against BAC, and a BAC of zero would make every one of them either zero or infinite — neither of which is a measurement.';
  elsif array_length(v_currencies, 1) > 1 then
    v_bac_refusal := format(
      'The cost lines on this case are denominated in %s. They cannot be added, so there is no budget at completion and no earned-value metric derived from one — borrowing the unit of the first row would produce a figure in a currency nobody chose.',
      array_to_string(v_currencies, ' and '));
  else
    v_currency := v_currencies[1];
    select sum(ci.baseline_cost) into v_bac
      from project_cost_items ci
     where ci.development_case_id = c.id and ci.baseline_cost is not null;
    if v_bac is null then
      v_bac_refusal := format(
        '%s cost line(s) are recorded on this case and none carries a baseline cost. There is no budget at completion to measure performance against; the lines exist, the baseline does not.',
        v_line_count);
    elsif v_bac = 'NaN'::numeric or v_bac = 'Infinity'::numeric or v_bac = '-Infinity'::numeric then
      v_bac := null;
      v_bac_refusal :=
        'The baselined cost lines do not sum to a finite number, so there is no budget at completion.';
    elsif v_bac <= 0 then
      v_bac := null;
      v_bac_refusal :=
        'The baselined cost lines sum to zero or less. Every earned-value metric divides by the budget at completion, and a zero budget produces infinities rather than performance.';
    elsif v_unbaselined > 0 then
      v_caveats := v_caveats || to_jsonb(format(
        '%s of %s cost line(s) carry no baseline cost and are therefore outside the budget at completion. Earned value on the scope they represent is not in these figures.',
        v_unbaselined, v_line_count)::text);
    end if;
  end if;
  if v_bac_refusal is not null then
    v_refusals := v_refusals || to_jsonb(v_bac_refusal);
  end if;

  -- ── The data date. The LATEST period, and only that one. ────────────────
  select * into p from project_progress_periods
   where development_case_id = c.id order by period_end desc limit 1;

  if p.id is not null then
    -- The actual time (AT) the earned schedule below is divided by, resolved
    -- once here rather than inside the metric that happens to need it — a
    -- period index that only exists when earned value computed would leave
    -- the surface unable to say which period it is looking at.
    select count(*) into v_period_index
      from project_progress_periods
     where development_case_id = c.id and period_end <= p.period_end;

    -- A CLOSED LATEST PERIOD PAIRS A FROZEN EARNED VALUE WITH A LIVE ACTUAL.
    -- Claims cannot be made into a closed period, but project_cost_items
    -- keeps moving (actual is a running total, spec §23). So a suite computed
    -- after the period closed is not that period's history and must not be
    -- read as it: it is today's cost against a position that stopped moving.
    -- get_case_performance_trend refuses to attribute such a run to the
    -- period, and the caveat here is why.
    if p.status = 'closed' then
      v_closed_note := format(
        'Period %s is closed, so the claimed positions behind this earned value are frozen while actual cost keeps accruing on the cost lines. This is today''s actual cost against that frozen position, not the performance recorded while the period was current — the trend does not treat it as %s''s history.',
        p.period_ref, p.period_ref);
      v_caveats := v_caveats || to_jsonb(v_closed_note);
    end if;
  end if;

  if p.id is null then
    v_ev_refusal :=
      'No reporting period is recorded on this case, so there is no data date to measure at. Earned value is a position at an instant; without one there is nothing to report a position for.';
    v_pv_refusal := v_ev_refusal;
  else
    -- ── THE POSITION AT THE DATA DATE, NOT THIS PERIOD'S PAPERWORK. ───────
    --
    -- EARNED VALUE IS CUMULATIVE TO DATE, so the claim set is the LATEST
    -- recorded position PER ELEMENT at or before the data date — not the
    -- rows that happen to have been typed into the latest period.
    --
    -- Summing only the current period's claims looks right and is a
    -- fabrication engine: `record_progress_claim` allows one claim per
    -- element per period and offers no carry-forward, so ordinary reporting
    -- practice ("claim what moved") silently drops every element that did
    -- not move this period. A package sitting at 100% complete since March
    -- would leave the earned value in April, and the CPI would report a cost
    -- overrun caused entirely by the reporting convention. An element that
    -- has never been claimed contributes nothing and is counted as unclaimed
    -- below; an element claimed in an earlier period keeps the position it
    -- was last recorded at, and how many did so is said out loud.
    select array_agg(q.id),
           count(*) filter (where q.period_id = p.id),
           count(*) filter (where q.period_id <> p.id)
      into v_position_ids, v_claims_this_period, v_carried_forward
    from (select distinct on (cl.wbs_element_id)
                 cl.id, cl.period_id
            from project_progress_claims cl
            join project_progress_periods pp on pp.id = cl.period_id
           where cl.development_case_id = c.id and pp.period_end <= p.period_end
           order by cl.wbs_element_id, pp.period_end desc) q;
    v_claim_count := coalesce(array_length(v_position_ids, 1), 0);

    -- ── EV. Recorded claims only. ─────────────────────────────────────────
    if v_claim_count = 0 then
      v_ev_refusal := format(
        'No progress has been claimed on this case at or before period %s. That is an empty claim set, not nothing earned — reporting an earned value of zero here would be indistinguishable from a project that genuinely earned nothing, and a CPI computed from it would read as a measurement of performance rather than of silence.',
        p.period_ref);
    elsif v_bac is null then
      v_ev_refusal := format(
        'Earned value is a share of the budget at completion, and this case has none: %s',
        v_bac_refusal);
    else
      -- DOUBLE COUNTING. A claim on an element AND on one of its descendants
      -- counts the descendant's budget twice, because an element's budget is
      -- its own coded lines plus its subtree's. Refused by name — a silently
      -- inflated EV is a CPI that flatters the project for a reason nobody
      -- can see.
      with recursive subtree(root, node) as (
        select cl.wbs_element_id, cl.wbs_element_id
          from project_progress_claims cl where cl.id = any(v_position_ids)
        union all
        select s.root, w.id
          from subtree s join project_wbs_elements w on w.parent_id = s.node
      )
      select string_agg(distinct format('%s contains %s', wr.wbs_code, wn.wbs_code), '; ')
        into v_overlap
      from subtree s
      join project_progress_claims c2 on c2.wbs_element_id = s.node
                                     and c2.id = any(v_position_ids)
      join project_wbs_elements wr on wr.id = s.root
      join project_wbs_elements wn on wn.id = s.node
      where s.node <> s.root;

      if v_overlap is not null then
        v_ev_refusal := format(
          'Progress is claimed on both a WBS element and something inside it at period %s (%s). An element''s budget includes its subtree, so earning credit on both counts the same money twice and inflates every figure derived from it. Claim at one level.',
          p.period_ref, v_overlap);
      else
        with recursive subtree(root, node) as (
          select cl.wbs_element_id, cl.wbs_element_id
            from project_progress_claims cl where cl.id = any(v_position_ids)
          union all
          select s.root, w.id
            from subtree s join project_wbs_elements w on w.parent_id = s.node
        ),
        element_bac as (
          select s.root,
                 coalesce(sum(ci.baseline_cost), 0) as bac
          from subtree s
          left join project_cost_items ci
                 on ci.wbs_element_id = s.node and ci.baseline_cost is not null
          group by s.root
        )
        select
          sum(cl.claimed_percent / 100.0 * eb.bac),
          count(*) filter (where eb.bac = 0),
          jsonb_agg(jsonb_build_object(
            'wbsCode', w.wbs_code, 'title', w.title,
            'claimedPercent', cl.claimed_percent,
            'stepLabel', cl.step_label,
            'ruleRef', r.rule_ref,
            'periodRef', pp.period_ref,
            'carriedForward', (cl.period_id <> p.id),
            'elementBudget', eb.bac,
            'earnedValue', cl.claimed_percent / 100.0 * eb.bac) order by w.wbs_code)
          into v_ev, v_zero_bac_elements, v_elements
        from project_progress_claims cl
        join element_bac eb on eb.root = cl.wbs_element_id
        join project_wbs_elements w on w.id = cl.wbs_element_id
        join project_rules_of_credit r on r.id = cl.rule_id
        join project_progress_periods pp on pp.id = cl.period_id
        where cl.id = any(v_position_ids);

        if v_ev is not null and (v_ev = 'NaN'::numeric or v_ev = 'Infinity'::numeric
                                 or v_ev = '-Infinity'::numeric) then
          v_ev := null;
          v_ev_refusal := 'The earned value did not sum to a finite number.';
        elsif v_zero_bac_elements = v_claim_count then
          -- EVERY claimed element resolves to a zero budget. The sum is 0,
          -- and a zero EV against a positive AC prints CPI 0.000 — the most
          -- alarming statement earned value can make, produced here by
          -- arithmetic performed on nothing. It is the mirror image of "CPI
          -- 1.0 over an empty activity set" and it refuses for the same
          -- reason: on screen it is indistinguishable from a real collapse.
          v_ev := null;
          v_ev_refusal := format(
            'All %s claimed element(s) carry no baselined cost anywhere in their subtree, so the earned value would be zero — not because nothing was earned, but because the scope being claimed is not in the budget at completion. A CPI computed from it would read as catastrophic cost performance rather than as a coding gap between the progress claims and the cost lines.',
            v_claim_count);
        elsif v_zero_bac_elements > 0 then
          v_caveats := v_caveats || to_jsonb(format(
            '%s of %s claimed element(s) carry no baselined cost anywhere in their subtree, so their progress earns nothing. The work is being reported and the money it represents is not in the earned value, which understates every index below.',
            v_zero_bac_elements, v_claim_count)::text);
        end if;
        if v_carried_forward > 0 and v_ev is not null then
          v_caveats := v_caveats || to_jsonb(format(
            '%s of %s element position(s) in this earned value were last claimed in an earlier period and are carried forward at the percent they were recorded at. Earned value is cumulative to the data date: an element that did not move this period keeps its position rather than dropping out of the total.',
            v_carried_forward, v_claim_count)::text);
        end if;
      end if;
    end if;

    -- ── PV. The planned curve, or a named refusal. ───────────────────────
    if p.planned_percent_complete is null then
      v_pv_refusal := format(
        'Period %s carries no planned percent complete, so there is no planned value at this data date. A schedule performance index measured against a blank is a ratio with no denominator, and one measured against an assumed zero would report every project as infinitely behind.',
        p.period_ref);
    elsif v_bac is null then
      v_pv_refusal := format('Planned value is a share of the budget at completion: %s', v_bac_refusal);
    else
      v_pv := p.planned_percent_complete / 100.0 * v_bac;
    end if;
  end if;

  -- ── AC. Absent is not zero. ─────────────────────────────────────────────
  if v_currency is null then
    v_ac_refusal := coalesce(v_bac_refusal,
      'Actual cost cannot be totalled without a single currency on the case.');
  else
    select count(*) filter (where ci.actual is not null), sum(ci.actual)
      into v_ac_lines, v_ac
    from project_cost_items ci where ci.development_case_id = c.id;
    if coalesce(v_ac_lines, 0) = 0 then
      v_ac := null;
      v_ac_refusal :=
        'No cost line on this case carries an actual cost. That is "nothing has been booked yet", not "nothing has been spent" — coalescing it to zero would divide earned value by zero and report infinite cost efficiency on a project nobody has costed.';
    elsif v_ac = 'NaN'::numeric or v_ac = 'Infinity'::numeric or v_ac = '-Infinity'::numeric then
      v_ac := null;
      v_ac_refusal := 'The recorded actual costs do not sum to a finite number.';
    elsif v_ac_lines < v_line_count then
      v_caveats := v_caveats || to_jsonb(format(
        '%s of %s cost line(s) carry an actual cost; the rest have nothing booked against them yet and are absent from the actual cost rather than counted as zero.',
        v_ac_lines, v_line_count)::text);
    end if;
  end if;

  -- ── CPI = EV / AC. ──────────────────────────────────────────────────────
  if v_ev is null then
    v_cpi_refusal := format('No cost performance index: %s',
      coalesce(v_ev_refusal, 'earned value is not available.'));
  elsif v_ac is null then
    v_cpi_refusal := format('No cost performance index: %s',
      coalesce(v_ac_refusal, 'actual cost is not available.'));
  elsif v_ac = 0 then
    v_cpi_refusal :=
      'Actual cost is recorded as zero while work has been earned. A cost performance index would be infinite; the honest reading is that the cost of this work has not reached the ledger yet.';
  else
    v_cpi := v_ev / v_ac;
    if v_cpi = 'NaN'::numeric or v_cpi = 'Infinity'::numeric or v_cpi = '-Infinity'::numeric then
      v_cpi := null;
      v_cpi_refusal := 'The cost performance index did not evaluate to a finite number.';
    end if;
  end if;

  -- ── SPI = EV / PV. ──────────────────────────────────────────────────────
  if v_ev is null then
    v_spi_refusal := format('No schedule performance index: %s',
      coalesce(v_ev_refusal, 'earned value is not available.'));
  elsif v_pv is null then
    v_spi_refusal := format('No schedule performance index: %s',
      coalesce(v_pv_refusal, 'planned value is not available.'));
  elsif v_pv = 0 then
    v_spi_refusal :=
      'Planned value at this data date is zero — the plan says no work should have been done yet. Dividing by it would report an infinite schedule performance index rather than "the plan has not started".';
  else
    v_spi := v_ev / v_pv;
    if v_spi = 'NaN'::numeric or v_spi = 'Infinity'::numeric or v_spi = '-Infinity'::numeric then
      v_spi := null;
      v_spi_refusal := 'The schedule performance index did not evaluate to a finite number.';
    end if;
  end if;

  -- ── ES (earned schedule), in periods, and SPI(t) = ES / AT. ─────────────
  --
  -- Earned schedule reads the earned value BACK ONTO THE PLANNED CURVE: at
  -- what point in the plan was this much value supposed to have been earned?
  -- That requires an unbroken curve, so a plan with holes in it refuses by
  -- name rather than interpolating across the gap — an interpolation over a
  -- missing period silently invents the plan it is measuring against.
  if p.id is null then
    v_es_refusal := 'No reporting period is recorded, so there is no time axis to earn schedule against.';
  elsif v_ev is null or v_bac is null then
    v_es_refusal := format('No earned schedule: %s',
      coalesce(v_ev_refusal, v_bac_refusal, 'earned value is not available.'));
  else
    select count(*) into v_plan_count
      from project_progress_periods
     where development_case_id = c.id and period_end <= p.period_end
       and planned_percent_complete is not null;
    select string_agg(period_ref, ', ' order by period_end) into v_gap_periods
      from project_progress_periods
     where development_case_id = c.id and period_end <= p.period_end
       and planned_percent_complete is null;

    if v_gap_periods is not null then
      v_es_refusal := format(
        'The planned curve has no value at period(s) %s. Earned schedule is measured in periods, so a curve with holes cannot say which period the earned value belongs to — filling the gap by interpolation would invent the plan the project is being measured against.',
        v_gap_periods);
    elsif v_plan_count < 2 then
      v_es_refusal :=
        'Earned schedule needs at least two planned points to place a value between them. One period of plan is a point, not a curve.';
    else
      v_ev_percent := v_ev / v_bac * 100.0;
      select planned_percent_complete into v_plan_first
        from project_progress_periods
       where development_case_id = c.id and period_end <= p.period_end
       order by period_end limit 1;
      select planned_percent_complete into v_plan_last
        from project_progress_periods
       where development_case_id = c.id and period_end <= p.period_end
       order by period_end desc limit 1;

      if v_ev_percent > v_plan_last then
        v_es_refusal := format(
          'The project has earned %s percent of the budget and the recorded plan reaches only %s percent by period %s. Earned schedule cannot be read beyond the end of the curve — extrapolating it would state a date the plan never contained.',
          round(v_ev_percent, 1), v_plan_last, p.period_ref);
      elsif v_ev_percent < v_plan_first then
        -- SYMMETRY WITH THE REFUSAL TWELVE LINES ABOVE. Reading below the
        -- first planned point means interpolating from an assumed origin at
        -- (period 0, 0 percent) — a plan point nobody recorded. The curve is
        -- refused above its last point because "extrapolating it would state
        -- a date the plan never contained"; extrapolating below the first
        -- point states one just as firmly, and the invented origin is
        -- invisible on screen because the result is an ordinary-looking
        -- number of periods.
        v_es_refusal := format(
          'The project has earned %s percent of the budget and the recorded plan''s first point, at period %s, is already %s percent. Earned schedule cannot be read below the start of the curve: placing it there means interpolating from an assumed origin at period zero and zero percent, which is a planned point nobody recorded. Record the planned percent for an earlier period to give the curve a start.',
          round(v_ev_percent, 1), (select period_ref from project_progress_periods
                                    where development_case_id = c.id and period_end <= p.period_end
                                    order by period_end limit 1), v_plan_first);
      else
        select count(*) into v_j
          from project_progress_periods
         where development_case_id = c.id and period_end <= p.period_end
           and planned_percent_complete <= v_ev_percent;
        select planned_percent_complete into v_plan_j
          from (select planned_percent_complete,
                       row_number() over (order by period_end) rn
                  from project_progress_periods
                 where development_case_id = c.id and period_end <= p.period_end) q
         where q.rn = v_j;
        select planned_percent_complete into v_plan_next
          from (select planned_percent_complete,
                       row_number() over (order by period_end) rn
                  from project_progress_periods
                 where development_case_id = c.id and period_end <= p.period_end) q
         where q.rn = v_j + 1;
        if v_plan_next is null then
          -- v_j is the last point and the earned value sits exactly on it.
          v_es := v_j;
        elsif v_plan_next = v_plan_j then
          -- A flat segment: the plan expects no progress across it, so the
          -- earned value cannot be placed anywhere inside it.
          v_es_refusal := format(
            'The planned curve is flat across periods %s and %s, so an earned value sitting on that segment cannot be placed at a point in time — the plan expects no progress there.',
            v_j, v_j + 1);
        else
          v_es := v_j + (v_ev_percent - v_plan_j) / (v_plan_next - v_plan_j);
        end if;
      end if;

      if v_es is not null then
        if v_es = 'NaN'::numeric or v_es = 'Infinity'::numeric or v_es = '-Infinity'::numeric then
          v_es := null;
          v_es_refusal := 'Earned schedule did not evaluate to a finite number.';
        elsif coalesce(v_period_index, 0) > 0 then
          v_spi_t := v_es / v_period_index;
          if v_spi_t = 'NaN'::numeric or v_spi_t = 'Infinity'::numeric
             or v_spi_t = '-Infinity'::numeric then
            v_spi_t := null;
          end if;
        end if;
      end if;
    end if;
  end if;

  -- ── EAC = BAC / CPI. NAMED, AND NEVER SWAPPED FOR ANOTHER FORMULA. ──────
  if v_bac is null then
    v_eac_refusal := format('No estimate at completion: %s', v_bac_refusal);
  elsif v_cpi is null then
    v_eac_refusal := format(
      'No estimate at completion. This product computes EAC = BAC / CPI and there is no cost performance index: %s. It does not fall back to AC + (BAC - EV) — a forecast that silently changes its own formula when an input goes missing keeps its shape while changing its meaning, and nobody reading it can see that happen.',
      coalesce(v_cpi_refusal, 'the index is unavailable.'));
  elsif v_cpi = 0 then
    v_eac_refusal :=
      'The cost performance index is zero, so BAC / CPI is undefined. Nothing has been earned against what has been spent.';
  else
    v_eac := v_bac / v_cpi;
    if v_eac = 'NaN'::numeric or v_eac = 'Infinity'::numeric or v_eac = '-Infinity'::numeric then
      v_eac := null;
      v_eac_refusal := 'The estimate at completion did not evaluate to a finite number.';
    end if;
  end if;

  -- ── VAC = BAC - EAC. ────────────────────────────────────────────────────
  if v_eac is null then
    v_vac_refusal := format('No variance at completion: %s',
      coalesce(v_eac_refusal, 'the estimate at completion is unavailable.'));
  else
    v_vac := v_bac - v_eac;
    if v_vac = 'NaN'::numeric or v_vac = 'Infinity'::numeric or v_vac = '-Infinity'::numeric then
      v_vac := null;
      v_vac_refusal := 'The variance at completion did not evaluate to a finite number.';
    end if;
  end if;

  -- Every named refusal, in the order a reader meets them. This array is
  -- what the lineage run records: a calculation that recorded only its
  -- successes would make a partial answer indistinguishable from a whole one.
  for v_overlap in
    select x from unnest(array[v_ev_refusal, v_pv_refusal, v_ac_refusal, v_cpi_refusal,
                               v_spi_refusal, v_es_refusal, v_eac_refusal, v_vac_refusal]) as x
     where x is not null
  loop
    v_refusals := v_refusals || to_jsonb(v_overlap);
  end loop;

  -- THE FORECAST CARRIES ITS CONFIDENCE (D5.17), always, including when the
  -- rating is `unrated` — that is the state a forecast with no estimate
  -- basis is in, and hiding it is how a number becomes silently confident.
  v_confidence := estimate_confidence_rating(c.id);

  -- ── THE STALENESS DIGEST: AMOUNTS, NOT COUNTS. ──────────────────────────
  --
  -- A fingerprint made of row COUNTS cannot see a revised figure.
  -- `record_cost_item` revises baseline_cost and actual IN PLACE, and actual
  -- is a running total by design — the two most volatile inputs in the suite
  -- move without changing any count. A recorded CPI could therefore be wrong
  -- by a factor of three while the surface captioned it "recorded ... code
  -- version ...", which is the exact opposite of the 4A rule it inherits.
  --
  -- So the digest covers the VALUES the aggregate summed: every cost line's
  -- baselined, actual and forecast amount, every position that earned value
  -- was read from at its claimed percent, and the planned point. It is
  -- computed HERE, in SQL, and the surface compares the recorded digest
  -- against the one this read returns — one definition, on both sides, in
  -- one place. (The 20261130090500 idiom.)
  select md5(
      coalesce((select string_agg(ci.cost_item_ref || '~' || coalesce(ci.baseline_cost::text, '-')
                                  || '~' || coalesce(ci.actual::text, '-')
                                  || '~' || coalesce(ci.forecast::text, '-')
                                  || '~' || ci.currency,
                                  '|' order by ci.cost_item_ref)
                 from project_cost_items ci where ci.development_case_id = c.id), '')
      || '#' ||
      coalesce((select string_agg(w.wbs_code || '~' || cl.claimed_percent::text
                                  || '~' || cl.rule_id::text,
                                  '|' order by w.wbs_code)
                 from project_progress_claims cl
                 join project_wbs_elements w on w.id = cl.wbs_element_id
                where cl.id = any(coalesce(v_position_ids, array[]::uuid[]))), '')
      || '#' || coalesce(p.period_ref, '-')
      || '~' || coalesce(p.planned_percent_complete::text, '-')
      || '~' || coalesce(p.status, '-'))
    into v_basis_digest;

  return jsonb_build_object(
    'caseId', c.id,
    'currency', v_currency,
    'period', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'periodRef', p.period_ref, 'periodEnd', p.period_end,
      'status', p.status, 'plannedPercentComplete', p.planned_percent_complete,
      'index', v_period_index) end,
    'bac', v_bac,
    'bacRefusal', v_bac_refusal,
    'costLineCount', v_line_count,
    -- The number of ELEMENT POSITIONS this earned value is the sum of — the
    -- cumulative set, not the rows typed into the latest period. Both are
    -- reported because "two elements were updated this period" and "eleven
    -- elements hold a position" are different facts.
    'claimCount', v_claim_count,
    'claimsInLatestPeriod', v_claims_this_period,
    'carriedForwardCount', v_carried_forward,
    'periodClosedNote', v_closed_note,
    'basisDigest', v_basis_digest,
    'eacFormula', 'EAC = BAC / CPI (past cost performance continues)',
    'metrics', jsonb_build_object(
      'ev',  jsonb_build_object('label', 'Earned value',      'unit', 'currency', 'value', v_ev,    'refusal', v_ev_refusal),
      'pv',  jsonb_build_object('label', 'Planned value',     'unit', 'currency', 'value', v_pv,    'refusal', v_pv_refusal),
      'ac',  jsonb_build_object('label', 'Actual cost',       'unit', 'currency', 'value', v_ac,    'refusal', v_ac_refusal),
      'cpi', jsonb_build_object('label', 'Cost performance index',     'unit', 'ratio',   'value', v_cpi, 'refusal', v_cpi_refusal),
      'spi', jsonb_build_object('label', 'Schedule performance index', 'unit', 'ratio',   'value', v_spi, 'refusal', v_spi_refusal),
      'es',  jsonb_build_object('label', 'Earned schedule',   'unit', 'periods',  'value', v_es,    'refusal', v_es_refusal),
      'spit',jsonb_build_object('label', 'Schedule performance index (time)', 'unit', 'ratio', 'value', v_spi_t,
             'refusal', case when v_spi_t is null then coalesce(v_es_refusal,
               'Earned schedule is unavailable, so the time-based index cannot be formed.') else null end),
      'eac', jsonb_build_object('label', 'Estimate at completion', 'unit', 'currency', 'value', v_eac, 'refusal', v_eac_refusal),
      'vac', jsonb_build_object('label', 'Variance at completion', 'unit', 'currency', 'value', v_vac, 'refusal', v_vac_refusal)),
    'claimedElements', coalesce(v_elements, '[]'::jsonb),
    'estimateConfidence', v_confidence,
    'caveats', v_caveats,
    'refusals', v_refusals,
    -- `evaluable` means "at least one metric produced a number". It is not a
    -- quality claim, and the surface renders refusals whether it is true or
    -- false.
    'evaluable', (v_ev is not null or v_pv is not null or v_ac is not null));
end
$$;

revoke all on function public.get_case_earned_value(uuid) from public, anon, service_role;
grant execute on function public.get_case_earned_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE COMPUTE. Same answer, plus the lineage row (D11.29). Every figure the
-- surface renders comes from a run recorded here.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_earned_value(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_ev jsonb;
  v_integrity jsonb;
  v_refusals jsonb;
  v_outputs jsonb;
  v_run uuid;
  v_m jsonb;
  v_key text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing earned value requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_ev := get_case_earned_value(c.id);
  if v_ev ? 'error' then
    return v_ev;
  end if;
  v_m := v_ev->'metrics';

  -- EVERY METRIC REFUSAL IS RECORDED UNDER THE NAME OF THE METRIC IT BELONGS
  -- TO. The refusals array is what the surface reads back when a run carries
  -- no value for a figure; an unlabelled list forces the screen to guess
  -- which sentence belongs to which cell, and the previous shape made it
  -- fall through to "no reason was recorded" while the reason sat one field
  -- away — the screen accusing the lineage ledger of a defect it did not
  -- have. The prefix is the metric's own label, exactly as the cell prints
  -- it, so the match is by construction rather than by string luck.
  v_refusals := '[]'::jsonb;
  if v_ev->>'bacRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_ev->>'bacRefusal');
  end if;
  for v_key in
    select x from unnest(array['ev','pv','ac','cpi','spi','es','spit','eac','vac']) as x
  loop
    if v_m->v_key->>'refusal' is not null then
      v_refusals := v_refusals || to_jsonb(format('%s: %s',
        v_m->v_key->>'label', v_m->v_key->>'refusal')::text);
    end if;
  end loop;
  v_refusals := v_refusals || coalesce(v_ev->'caveats', '[]'::jsonb);

  -- THE PROGRESS THESE FIGURES REST ON MAY NOT HAVE BEEN CROSS-CHECKED.
  -- D5.20 rates the claimed progress against independent evidence; an earned
  -- value computed from unverified claims is not wrong, but it is not
  -- verified either, and the run says which.
  v_integrity := get_case_progress_integrity(c.id);
  if coalesce(v_integrity->>'confidence', '') in ('', 'unrated')
     or v_integrity->'confidence' is null then
    v_refusals := v_refusals || to_jsonb(
      'The claimed progress behind this earned value has not been cross-checked against independent evidence, so it carries no progress confidence rating (D5.20).'::text);
  elsif v_integrity->>'confidence' = 'low' then
    v_refusals := v_refusals || to_jsonb(format(
      'The claimed progress behind this earned value carries a LOW progress confidence rating: %s',
      coalesce(v_integrity->>'headline', 'reported progress diverges from the independent evidence.'))::text);
  end if;

  -- COVERAGE TRAVELS WITH THE BAND, EVERYWHERE. D5.20's own Rule 3: "a HIGH
  -- confidence over two of nineteen claimed elements is a true statement
  -- about two elements and a false impression of the project." A HIGH band
  -- used to pass through this function silently because only '', 'unrated'
  -- and 'low' were reacted to, so the chip on the earned-value panel read
  -- green with nothing beside it saying how much of the project it covered.
  if v_integrity->>'confidence' is not null
     and coalesce((v_integrity->>'coverage')::numeric, 0) < 100 then
    v_refusals := v_refusals || to_jsonb(format(
      'The %s progress confidence behind this earned value covers %s percent of the claimed elements (%s of %s); the rest carry no independent observation and are unrated. A confidence band quoted without its coverage is a true statement about part of the project and a false impression of all of it.',
      upper(v_integrity->>'confidence'), v_integrity->>'coverage',
      v_integrity->>'coveredElementCount', v_integrity->>'claimedElementCount')::text);
  end if;

  -- THE ESTIMATE CONFIDENCE TRAVELS WITH THE FORECAST (D5.17). An unrated
  -- EAC is recorded as a refusal, not as a silently confident number.
  if coalesce(v_ev->'estimateConfidence'->>'band', 'unrated') = 'unrated' then
    v_refusals := v_refusals || to_jsonb(
      coalesce(v_ev->'estimateConfidence'->>'refusal',
        'No estimate basis is recorded, so the estimate at completion is UNRATED.')::text);
  end if;

  -- A run with no metric at all is a REFUSED run (outputs null). One with
  -- some metrics and some refusals is computed_with_refusals. The recorder
  -- derives the status from exactly this shape.
  if coalesce((v_ev->>'evaluable')::boolean, false) = false then
    v_outputs := null;
    if jsonb_array_length(v_refusals) = 0 then
      v_refusals := jsonb_build_array(
        'No earned-value metric could be produced and no reason was recorded, which is itself a defect worth seeing.');
    end if;
  else
    v_outputs := jsonb_build_object(
      'currency', v_ev->'currency',
      'bac', v_ev->'bac',
      'ev', v_m->'ev'->'value',
      'pv', v_m->'pv'->'value',
      'ac', v_m->'ac'->'value',
      'cpi', v_m->'cpi'->'value',
      'spi', v_m->'spi'->'value',
      'es', v_m->'es'->'value',
      'spit', v_m->'spit'->'value',
      'eac', v_m->'eac'->'value',
      'vac', v_m->'vac'->'value',
      'eacFormula', v_ev->'eacFormula',
      'estimateConfidenceBand', coalesce(v_ev->'estimateConfidence'->'band', to_jsonb('unrated'::text)),
      'progressConfidence', coalesce(v_integrity->'confidence', 'null'::jsonb),
      -- The band NEVER travels alone.
      'progressConfidenceCoverage', coalesce(v_integrity->'coverage', 'null'::jsonb),
      'progressConfidenceCovered', coalesce(v_integrity->'coveredElementCount', 'null'::jsonb),
      'progressConfidenceClaimed', coalesce(v_integrity->'claimedElementCount', 'null'::jsonb),
      -- The per-element breakdown is RECORDED, so the surface can render the
      -- element budgets from the run beside the metrics they add up to
      -- instead of taking them from a live read that has moved on.
      'claimedElements', coalesce(v_ev->'claimedElements', '[]'::jsonb),
      'carriedForwardCount', v_ev->'carriedForwardCount',
      'claimsInLatestPeriod', v_ev->'claimsInLatestPeriod',
      'periodRef', v_ev->'period'->'periodRef',
      'periodStatus', v_ev->'period'->'status',
      'periodEnd', v_ev->'period'->'periodEnd');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_earned_value',
    'Earned value as the CUMULATIVE-TO-DATE sum over the latest recorded position per WBS element at or before the data date — (claimed percent, derived from the cited rule of credit) x (baselined cost of that element and its subtree) — so an element that did not move this period keeps the position it was last claimed at rather than dropping out of the total; planned value as the period''s planned percent complete applied to the budget at completion; actual cost as the sum of recorded actuals on the case''s cost lines. CPI = EV/AC, SPI = EV/PV, earned schedule interpolated strictly between recorded planned points, EAC = BAC/CPI and VAC = BAC - EAC. No input is imputed: every absent input refuses its metric by name.',
    -- The staleness fingerprint the surface compares a displayed run against.
    -- `basisDigest` is the load-bearing field: the counts beside it cannot
    -- see a REVISED amount, and baseline_cost and actual are revised in
    -- place by design.
    jsonb_build_object(
      'periodRef', v_ev->'period'->'periodRef',
      'basisDigest', v_ev->'basisDigest',
      'claimCount', v_ev->'claimCount',
      'costLineCount', v_ev->'costLineCount',
      'plannedPercentComplete', v_ev->'period'->'plannedPercentComplete',
      'estimateConfidenceBand', coalesce(v_ev->'estimateConfidence'->'band', to_jsonb('unrated'::text))),
    -- EXACTLY THE ROWS THE AGGREGATE SUMMED: the cumulative element
    -- positions at the data date — which is not the same set as "the claims
    -- filed this period" — and the cost lines of the case. Replaying from
    -- these refs reproduces the recorded output.
    (coalesce((select jsonb_agg(jsonb_build_object('table', 'project_progress_claims', 'id', q.id))
                 from (select distinct on (cl.wbs_element_id) cl.id
                         from project_progress_claims cl
                         join project_progress_periods pp on pp.id = cl.period_id
                        where cl.development_case_id = c.id
                          and pp.period_end <= (v_ev->'period'->>'periodEnd')::date
                        order by cl.wbs_element_id, pp.period_end desc) q), '[]'::jsonb)
     || coalesce((select jsonb_agg(jsonb_build_object('table', 'project_cost_items', 'id', ci.id))
                    from project_cost_items ci where ci.development_case_id = c.id), '[]'::jsonb)),
    v_outputs,
    v_refusals);

  return v_ev || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_earned_value'));
end
$$;

revoke all on function public.compute_case_earned_value(uuid) from public, anon, service_role;
grant execute on function public.compute_case_earned_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- D5.06 — PERFORMANCE TRENDING, over RECORDED periods.
--
-- The trend does not recompute anything. It reads the `case_earned_value`
-- runs recorded while each period was current and reports the series they
-- form. A period with no recorded run appears as a GAP that says so, rather
-- than being interpolated across — an interpolated trend point is a
-- measurement nobody took, presented on the same axis as ones they did.
--
-- It records a run of its own whose input_refs are the calculation_runs rows
-- it read, so a trend is replayable from its own record.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_performance_trend(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_points jsonb;
  v_gaps jsonb;
  v_period_count int;
  v_point_count int;
  v_measured int;
  v_refused_points int;
  v_cpi_trend text;
  v_spi_trend text;
  v_cpi_trend_refusal text;
  v_spi_trend_refusal text;
  v_cpi_prev numeric; v_cpi_last numeric;
  v_spi_prev numeric; v_spi_last numeric;
  v_cpi_from text; v_cpi_to text;
  v_spi_from text; v_spi_to text;
  v_cpi_volatile text;
  v_spi_volatile text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- One point per period: the LAST run recorded WHILE THAT PERIOD WAS THE
  -- REPORTED PERIOD — matched on the run's own recorded periodRef AND
  -- recorded no later than the instant the period closed.
  --
  -- THE closed_at PREDICATE IS NOT DECORATION. Claims freeze when a period
  -- closes; project_cost_items does not, and compute_case_earned_value
  -- always computes at the LATEST period, closed or open. Without the
  -- predicate, computing again after a period closed rewrote that period's
  -- history — a figure a reader had been told was recorded history moved,
  -- and the superseded run (still in calculation_runs, still immutable) was
  -- hidden by the distinct-on. A trend whose past points move is not a
  -- trend, and hiding the movement is worse than not having the point.
  with runs as (
    select distinct on (r.inputs->>'periodRef')
           r.inputs->>'periodRef' as period_ref,
           r.id, r.computed_at, r.status, r.outputs, r.refusals, r.code_version
      from calculation_runs r
      join project_progress_periods pp
        on pp.development_case_id = c.id
       and pp.period_ref = r.inputs->>'periodRef'
     where r.development_case_id = c.id
       and r.calculation_key = 'case_earned_value'
       and r.inputs->>'periodRef' is not null
       and (pp.closed_at is null or r.computed_at <= pp.closed_at)
     order by r.inputs->>'periodRef', r.computed_at desc
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'periodRef', p.period_ref,
      'periodEnd', p.period_end,
      'status', p.status,
      'runId', runs.id,
      'runStatus', runs.status,
      'measured', (runs.outputs is not null and runs.status <> 'refused'),
      'computedAt', runs.computed_at,
      'codeVersion', runs.code_version,
      'cpi', runs.outputs->'cpi',
      'spi', runs.outputs->'spi',
      'spit', runs.outputs->'spit',
      'ev', runs.outputs->'ev',
      'pv', runs.outputs->'pv',
      'ac', runs.outputs->'ac',
      'eac', runs.outputs->'eac',
      'currency', runs.outputs->'currency',
      'refusalCount', jsonb_array_length(runs.refusals)
    ) order by p.period_end), '[]'::jsonb)
    into v_points
  from project_progress_periods p
  join runs on runs.period_ref = p.period_ref
  where p.development_case_id = c.id;

  -- A GAP NAMES ITS OWN KIND. A period nobody computed and a period whose
  -- only run REFUSED are different facts and justify different acts, so they
  -- are not merged into one word.
  select coalesce(jsonb_agg(jsonb_build_object(
           'periodRef', p.period_ref, 'periodEnd', p.period_end, 'status', p.status,
           'kind', case
             when exists (select 1 from calculation_runs r
                           where r.development_case_id = c.id
                             and r.calculation_key = 'case_earned_value'
                             and r.inputs->>'periodRef' = p.period_ref
                             and (p.closed_at is null or r.computed_at <= p.closed_at))
               then 'refused' else 'not_computed' end,
           'reason', case
             when exists (select 1 from calculation_runs r
                           where r.development_case_id = c.id
                             and r.calculation_key = 'case_earned_value'
                             and r.inputs->>'periodRef' = p.period_ref
                             and (p.closed_at is null or r.computed_at <= p.closed_at))
               then 'An earned-value run was recorded while this period was current and it produced no metric — it refused. A refused run is recorded history, but it is not a measured point, and counting it as one would present a period that measured nothing as a period that measured something.'
             when exists (select 1 from calculation_runs r
                           where r.development_case_id = c.id
                             and r.calculation_key = 'case_earned_value'
                             and r.inputs->>'periodRef' = p.period_ref)
               then 'The only earned-value runs carrying this period were recorded AFTER it closed, so they are today''s cost against a frozen position rather than this period''s history. They stay in the lineage ledger and are not drawn on this axis.'
             else 'No earned-value run was recorded while this period was current, so there is no measured point here. The trend leaves the gap rather than interpolating across it: an interpolated point is a measurement nobody took, drawn on the same axis as ones they did.'
             end
         ) order by p.period_end), '[]'::jsonb)
    into v_gaps
  from project_progress_periods p
  where p.development_case_id = c.id
    and not exists (
      select 1 from calculation_runs r
       where r.development_case_id = c.id
         and r.calculation_key = 'case_earned_value'
         and r.inputs->>'periodRef' = p.period_ref
         and (p.closed_at is null or r.computed_at <= p.closed_at)
         and r.outputs is not null
         and r.status <> 'refused');

  select count(*) into v_period_count
    from project_progress_periods where development_case_id = c.id;
  v_point_count := jsonb_array_length(v_points);
  -- A REFUSED RUN IS NOT A MEASURED POINT. `measuredPointCount` is printed
  -- to the reader as "across N recorded period(s)" and gates the "a
  -- direction needs two" refusal, so counting a period that measured nothing
  -- among them would state a measurement that was never taken.
  select count(*) filter (where (pt->>'measured')::boolean),
         count(*) filter (where not coalesce((pt->>'measured')::boolean, false))
    into v_measured, v_refused_points
  from jsonb_array_elements(v_points) pt;
  v_measured := coalesce(v_measured, 0);
  v_refused_points := coalesce(v_refused_points, 0);

  -- ── A DIRECTION IS THE DIRECTION OF THE LAST INTERVAL, AND IT SAYS SO. ──
  --
  -- Comparing the first point against the last ignores everything between
  -- them, so a CPI of 1.20 → 0.24 → 2.00 reported "improving" and a series
  -- that halved, quartered and then doubled was printed as a shape it never
  -- had. The direction below is the LAST MEASURED INTERVAL — the only
  -- interval a "cost performance is deteriorating" sentence can honestly be
  -- about — carried with the two periods it was measured across, and a
  -- series whose slope changes sign carries a volatility note naming how
  -- often, so one word can never stand in for a series that had no one word.
  if v_measured >= 2 then
    -- The last TWO measured points that carry the index, in period order.
    select (pt->>'cpi')::numeric, pt->>'periodRef' into v_cpi_last, v_cpi_to
      from jsonb_array_elements(v_points) with ordinality t(pt, ord)
     where pt->>'cpi' is not null order by ord desc limit 1;
    select (pt->>'cpi')::numeric, pt->>'periodRef' into v_cpi_prev, v_cpi_from
      from jsonb_array_elements(v_points) with ordinality t(pt, ord)
     where pt->>'cpi' is not null and pt->>'periodRef' is distinct from v_cpi_to
     order by ord desc limit 1;
    select (pt->>'spi')::numeric, pt->>'periodRef' into v_spi_last, v_spi_to
      from jsonb_array_elements(v_points) with ordinality t(pt, ord)
     where pt->>'spi' is not null order by ord desc limit 1;
    select (pt->>'spi')::numeric, pt->>'periodRef' into v_spi_prev, v_spi_from
      from jsonb_array_elements(v_points) with ordinality t(pt, ord)
     where pt->>'spi' is not null and pt->>'periodRef' is distinct from v_spi_to
     order by ord desc limit 1;

    if v_cpi_last is not null and v_cpi_prev is not null then
      v_cpi_trend := case
        when v_cpi_last > v_cpi_prev then 'improving'
        when v_cpi_last < v_cpi_prev then 'deteriorating'
        else 'flat' end;
    else
      -- NAMED, NOT OMITTED. A missing cost direction beside a present
      -- schedule direction used to vanish from the sentence entirely.
      v_cpi_trend_refusal :=
        'No cost performance direction: the recorded runs do not carry a cost performance index at two consecutive measured periods, so there is no interval to take a direction across.';
    end if;
    if v_spi_last is not null and v_spi_prev is not null then
      v_spi_trend := case
        when v_spi_last > v_spi_prev then 'improving'
        when v_spi_last < v_spi_prev then 'deteriorating'
        else 'flat' end;
    else
      v_spi_trend_refusal :=
        'No schedule performance direction: the recorded runs do not carry a schedule performance index at two consecutive measured periods, so there is no interval to take a direction across.';
    end if;

    select case when count(*) > 0 then format(
             'The cost performance index changes direction %s time(s) across the recorded series, so no single word describes it — the direction above is the last interval only.',
             count(*)) end
      into v_cpi_volatile
    from (select sign(v - lag(v) over (order by ord)) as d1,
                 sign(lag(v) over (order by ord) - lag(v, 2) over (order by ord)) as d0
            from (select (pt->>'cpi')::numeric v, ord
                    from jsonb_array_elements(v_points) with ordinality t(pt, ord)
                   where pt->>'cpi' is not null) s) d
    where d.d1 is not null and d.d0 is not null and d.d0 <> 0 and d.d1 <> d.d0;
    select case when count(*) > 0 then format(
             'The schedule performance index changes direction %s time(s) across the recorded series, so no single word describes it — the direction above is the last interval only.',
             count(*)) end
      into v_spi_volatile
    from (select sign(v - lag(v) over (order by ord)) as d1,
                 sign(lag(v) over (order by ord) - lag(v, 2) over (order by ord)) as d0
            from (select (pt->>'spi')::numeric v, ord
                    from jsonb_array_elements(v_points) with ordinality t(pt, ord)
                   where pt->>'spi' is not null) s) d
    where d.d1 is not null and d.d0 is not null and d.d0 <> 0 and d.d1 <> d.d0;
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'points', v_points,
    'gaps', v_gaps,
    'periodCount', v_period_count,
    'recordedPointCount', v_point_count,
    'measuredPointCount', v_measured,
    'refusedPointCount', v_refused_points,
    'costTrend', v_cpi_trend,
    'costTrendRefusal', v_cpi_trend_refusal,
    'costTrendInterval', case when v_cpi_trend is null then null
      else format('%s to %s', v_cpi_from, v_cpi_to) end,
    'costTrendVolatility', v_cpi_volatile,
    'scheduleTrend', v_spi_trend,
    'scheduleTrendRefusal', v_spi_trend_refusal,
    'scheduleTrendInterval', case when v_spi_trend is null then null
      else format('%s to %s', v_spi_from, v_spi_to) end,
    'scheduleTrendVolatility', v_spi_volatile,
    'refusal', case
      when v_period_count = 0 then
        'No reporting period is recorded on this case, so there is no time axis to trend along.'
      when v_point_count = 0 then
        'No earned-value run has been recorded on any period of this case, so there is nothing to trend. Trending reads recorded history — it does not recompute it, because a trend recomputed from today''s rows is today''s answer painted along a time axis.'
      when v_measured = 0 then
        'Every earned-value run recorded on this case refused, so there are recorded periods and no measured performance to trend across them.'
      when v_measured = 1 then
        'One measured point is a position, not a trend. A direction needs two.'
      when v_cpi_trend is null and v_spi_trend is null then
        'The recorded runs carry no cost or schedule performance index at two consecutive measured periods, so there is a series of periods and no performance to trend across them.'
      else null end,
    'basis',
      'Each point is the last case_earned_value run recorded while that period was the reported period — matched on the run''s own recorded periodRef and recorded at or before the instant the period closed, so a run computed afterwards cannot rewrite a closed period''s history. Read from that run''s own recorded outputs; nothing here is recomputed from current rows. A direction is the direction of the LAST measured interval, named with the two periods it spans.');
end
$$;

revoke all on function public.get_case_performance_trend(uuid) from public, anon, service_role;
grant execute on function public.get_case_performance_trend(uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.compute_case_performance_trend(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_trend jsonb;
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
      'computing the performance trend requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_trend := get_case_performance_trend(c.id);
  if v_trend->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_trend->>'refusal');
  end if;
  if jsonb_array_length(coalesce(v_trend->'gaps', '[]'::jsonb)) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s reporting period(s) carry no measured earned-value run, so the trend has that many holes in it and does not interpolate across them.',
      jsonb_array_length(v_trend->'gaps'))::text);
  end if;
  -- Each absent direction, and each series with no single direction, named
  -- on the run rather than dropped from the sentence.
  if v_trend->>'costTrendRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_trend->>'costTrendRefusal');
  end if;
  if v_trend->>'scheduleTrendRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_trend->>'scheduleTrendRefusal');
  end if;
  if v_trend->>'costTrendVolatility' is not null then
    v_refusals := v_refusals || to_jsonb(v_trend->>'costTrendVolatility');
  end if;
  if v_trend->>'scheduleTrendVolatility' is not null then
    v_refusals := v_refusals || to_jsonb(v_trend->>'scheduleTrendVolatility');
  end if;
  if coalesce((v_trend->>'refusedPointCount')::int, 0) > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s recorded earned-value run(s) on this case produced no metric and are not counted as measured points.',
      v_trend->>'refusedPointCount')::text);
  end if;

  if coalesce((v_trend->>'measuredPointCount')::int, 0) < 2 then
    v_outputs := null;
    if jsonb_array_length(v_refusals) = 0 then
      v_refusals := jsonb_build_array(
        'The trend produced no direction and no reason was recorded, which is itself a defect worth seeing.');
    end if;
  else
    v_outputs := jsonb_build_object(
      'measuredPointCount', v_trend->'measuredPointCount',
      'refusedPointCount', v_trend->'refusedPointCount',
      'periodCount', v_trend->'periodCount',
      'costTrend', coalesce(v_trend->'costTrend', 'null'::jsonb),
      'costTrendInterval', coalesce(v_trend->'costTrendInterval', 'null'::jsonb),
      'scheduleTrend', coalesce(v_trend->'scheduleTrend', 'null'::jsonb),
      'scheduleTrendInterval', coalesce(v_trend->'scheduleTrendInterval', 'null'::jsonb),
      'points', v_trend->'points');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_performance_trend',
    'The cost and schedule performance series read from the case_earned_value runs recorded while each reporting period was current — one point per period, matched on the run''s own recorded periodRef and recorded at or before the instant that period closed, taken from that run''s own recorded outputs. Nothing is recomputed from current rows, a run recorded after a period closed cannot become that period''s history, and no period without a measured run is interpolated across. The reported direction is the direction of the LAST measured interval, named with the periods it spans.',
    jsonb_build_object(
      'periodCount', v_trend->'periodCount',
      'measuredPointCount', v_trend->'measuredPointCount',
      'refusedPointCount', v_trend->'refusedPointCount',
      'gapCount', jsonb_array_length(coalesce(v_trend->'gaps', '[]'::jsonb))),
    -- A run citing runs: the lineage of a trend is the lineage rows it read.
    coalesce((select jsonb_agg(jsonb_build_object('table', 'calculation_runs',
                                                  'id', (pt->>'runId')))
                from jsonb_array_elements(v_trend->'points') pt), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_trend || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_performance_trend'));
end
$$;

revoke all on function public.compute_case_performance_trend(uuid) from public, anon, service_role;
grant execute on function public.compute_case_performance_trend(uuid) to authenticated;
