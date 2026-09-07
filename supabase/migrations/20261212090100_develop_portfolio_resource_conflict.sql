-- ============================================================================
-- Sync Develop Slice 7C, part 2 — portfolio resource-conflict detection
-- (register D7.02, spec I.22).
--
-- THE SENTENCE THIS FILE EXISTS TO PRODUCE, from the specification itself:
--
--     "All six projects are individually executable — collectively impossible
--      because all six require the same commissioning team in Q3."
--
-- Every word of that is a claim about a set of projects, and nothing in this
-- repository could make it. `evaluate_schedule_feasibility` answers about ONE
-- weekly option; `get_case_resource_balance` (part 1) answers about ONE
-- project. Collective feasibility is a different question and it has exactly
-- one honest home: the same predicate both of those already lean on, summed
-- across cases.
--
-- NO SECOND FEASIBILITY ENGINE. The register row for D7.02 says "EXTEND the
-- feasibility pattern rolled up to portfolio periods", and that is what this
-- is: `sync_portfolio_resource_conflicts` is the roll-up, and
-- `evaluate_schedule_feasibility` — the door that already decides whether a
-- week may be frozen — GAINS a check that reads it. It does not gain a second
-- opinion about labour: its labour check now asks the SAME capacity predicate
-- the roll-up asks, so there is one answer to "how many hours does this pool
-- have this week" instead of two that disagree.
--
-- THE LABOUR SUM IS CORRECTED, DELIBERATELY, AND THE REASON IS THIS SLICE'S
-- OWN. The first draft left that arithmetic byte-identical to 20261027090000
-- and pinned the fact in a test as proof a live gate had not moved. But this
-- slice ADDED `effective_to` and `resource_category` to craft_capacity and
-- shipped the first customer write path onto it, so a `sum(weekly_hours)` with
-- no date and no category filter began counting demobilised crews, superseded
-- figures and other categories' pools as available labour — always in the
-- direction of MORE apparent capacity and FEWER warnings. A number that is
-- unchanged while the data beneath it changed meaning has not been protected;
-- it has been left wrong. The correction is stated here, the test pins the
-- CORRECTED predicate, and the overlap map records the divergence that was
-- closed.
--
-- WHAT COUNTS. Only APPROVED, un-withdrawn demand lines. A drafted line is a
-- planner thinking out loud; a portfolio conflict is a statement that two
-- named commitments cannot both be met, and it should rest on commitments.
-- Draft lines are COUNTED SEPARATELY and reported beside the approved figure,
-- so "the conflict is not there yet but it is coming" is visible rather than
-- absent.
--
-- INDIVIDUALLY FEASIBLE, COLLECTIVELY IMPOSSIBLE is computed and named, not
-- implied: a pool is flagged `collective_only` when NO single case exceeds
-- the capacity on its own and the SUM of them does. That is the exact case
-- the specification describes, and it is invisible in every per-project view
-- including the one this slice shipped an hour earlier.
--
-- REFUSAL, INHERITED. A pool with no recorded capacity is NOT ASSESSABLE, in
-- the words `evaluate_schedule_feasibility` has used since 2026-08-11. A
-- portfolio with no approved demand REFUSES rather than reporting that every
-- project is compatible with every other, which is what an empty conflict
-- list reads as.
--
-- Canonical reuse: resource_demand, sync_resource_capacity_hours,
-- sync_resource_category_order, development_cases, schedule_options,
-- craft_capacity, app_current_org, evaluate_schedule_feasibility. No new
-- table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ROLL-UP PREDICATE.
--
--    Revoked from clients — it takes an explicit organization and carries no
--    session filter of its own, so it is only ever called from inside a
--    definer that has established the tenant (the RULING 22 posture for
--    sync_field_readiness_elements).
-- ---------------------------------------------------------------------------
create or replace function public.sync_portfolio_resource_conflicts(
  p_org uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pools jsonb := '[]'::jsonb;
  v_conflicts int := 0;
  v_collective_only int := 0;
  v_not_assessable int := 0;
  v_approved_lines int := 0;
  v_draft_lines int := 0;
  v_cases int := 0;
  r record;
  v_cap jsonb;
  v_capacity numeric;
  v_state text;
  v_worst numeric;
  v_contribs jsonb;
  v_case_count int;
begin
  if p_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    return jsonb_build_object('answered', false,
      'refusal', 'the portfolio window ends on or before it starts. A window of no days holds no demand and no capacity — reporting no conflicts across it would read as a clean portfolio.');
  end if;

  select count(*) filter (where approved_at is not null),
         count(*) filter (where approved_at is null),
         count(distinct development_case_id) filter (where approved_at is not null)
    into v_approved_lines, v_draft_lines, v_cases
    from resource_demand
   where organization_id = p_org
     and withdrawn_at is null
     and period_start < p_to and period_end > p_from;

  -- REFUSAL 1: nothing committed in the window. An empty conflict list reads
  -- as "every project is compatible with every other", and that is the single
  -- most expensive thing this view could be wrong about.
  if v_approved_lines = 0 then
    return jsonb_build_object('answered', false,
      'from', p_from, 'to', p_to,
      'approvedDemandLines', 0, 'draftDemandLines', v_draft_lines,
      'refusal', case when v_draft_lines = 0
        then format('No resource demand at all is recorded across the portfolio between %s and %s. That is UNASSESSED, not conflict-free: an empty conflict list and a compatible portfolio look identical on a screen.', p_from, p_to)
        else format('No APPROVED resource demand exists across the portfolio between %s and %s, though %s draft line(s) do. A draft is a planner thinking out loud; a portfolio conflict is a statement that two committed things cannot both happen. Approve the commitments and the collective position becomes answerable.', p_from, p_to, v_draft_lines) end);
  end if;

  for r in
    select d.resource_category, d.resource_pool,
           sum(d.demand_hours
               * (least(d.period_end, p_to) - greatest(d.period_start, p_from))::numeric
               / nullif((d.period_end - d.period_start)::numeric, 0)) as demand,
           count(distinct d.development_case_id) as cases
      from resource_demand d
     where d.organization_id = p_org
       and d.withdrawn_at is null
       and d.approved_at is not null
       and d.period_start < p_to and d.period_end > p_from
     group by d.resource_category, d.resource_pool
     order by sync_resource_category_order(d.resource_category), d.resource_pool
  loop
    v_cap := sync_resource_capacity_hours(p_org, r.resource_category,
      r.resource_pool, p_from, p_to);
    v_capacity := case when (v_cap->>'answered')::boolean is true
      then (v_cap->>'capacityHours')::numeric end;

    -- Per-case contributions, and the LARGEST single-case contribution. The
    -- second number is what makes "individually executable" a computed claim
    -- rather than a turn of phrase.
    select coalesce(jsonb_agg(jsonb_build_object(
             'caseId', x.development_case_id,
             'caseTitle', x.title,
             'demandHours', round(x.hours, 1),
             'demandLines', x.lines) order by x.hours desc), '[]'::jsonb),
           max(x.hours),
           count(*)
      into v_contribs, v_worst, v_case_count
      from (
        select d.development_case_id, c.title, count(*) as lines,
               sum(d.demand_hours
                   * (least(d.period_end, p_to) - greatest(d.period_start, p_from))::numeric
                   / nullif((d.period_end - d.period_start)::numeric, 0)) as hours
          from resource_demand d
          join development_cases c on c.id = d.development_case_id
         where d.organization_id = p_org
           and d.withdrawn_at is null
           and d.approved_at is not null
           and d.resource_category = r.resource_category
           and d.resource_pool = r.resource_pool
           and d.period_start < p_to and d.period_end > p_from
         group by d.development_case_id, c.title
      ) x;

    if v_capacity is null then
      v_state := 'not_assessable';
      v_not_assessable := v_not_assessable + 1;
    elsif r.demand > v_capacity then
      -- THE SPECIFICATION'S OWN CASE. Every project fits on its own and the
      -- set does not.
      if v_worst is not null and v_worst <= v_capacity and v_case_count > 1 then
        v_state := 'collective_only';
        v_collective_only := v_collective_only + 1;
      else
        v_state := 'over_committed';
      end if;
      v_conflicts := v_conflicts + 1;
    elsif v_capacity - r.demand <= 0.1 then
      v_state := 'at_capacity';
    else
      v_state := 'within_capacity';
    end if;

    v_pools := v_pools || jsonb_build_array(jsonb_build_object(
      'category', r.resource_category,
      'categoryOrder', sync_resource_category_order(r.resource_category),
      'pool', r.resource_pool,
      'from', p_from,
      'to', p_to,
      'committedHours', round(r.demand, 1),
      'capacityHours', case when v_capacity is null then null else round(v_capacity, 1) end,
      'largestSingleCaseHours', case when v_worst is null then null else round(v_worst, 1) end,
      'cases', r.cases,
      'contributions', v_contribs,
      'state', v_state,
      'shortfallHours', case when v_capacity is null then null
        else round(greatest(0, r.demand - v_capacity), 1) end,
      'detail', case v_state
        when 'not_assessable' then v_cap->>'refusal'
        when 'collective_only' then format('%s project(s) each fit inside %s pool "%s" on their own — the largest asks for %s of the %s hours available — and together they ask for %s. Individually executable, collectively impossible.',
          r.cases, r.resource_category, r.resource_pool,
          round(v_worst, 1), round(v_capacity, 1), round(r.demand, 1))
        when 'over_committed' then format('%s pool "%s" is committed to %s hours against %s available between %s and %s, and at least one project exceeds it on its own.',
          r.resource_category, r.resource_pool, round(r.demand, 1),
          round(v_capacity, 1), p_from, p_to)
        when 'at_capacity' then format('%s pool "%s" is committed to %s of its %s hours. Fully committed across the portfolio: nothing absorbs the first slip.',
          r.resource_category, r.resource_pool, round(r.demand, 1), round(v_capacity, 1))
        else format('%s pool "%s" is committed to %s of its %s hours across %s project(s).',
          r.resource_category, r.resource_pool, round(r.demand, 1),
          round(v_capacity, 1), r.cases) end));
  end loop;

  return jsonb_build_object(
    'answered', true,
    'from', p_from,
    'to', p_to,
    'approvedDemandLines', v_approved_lines,
    'draftDemandLines', v_draft_lines,
    'casesWithCommitments', v_cases,
    'pools', v_pools,
    'conflicts', v_conflicts,
    'collectiveOnlyConflicts', v_collective_only,
    'notAssessable', v_not_assessable,
    'basis', 'Approved, un-withdrawn demand summed across every development case in the organization and set beside the capacity in force for each pool. Draft demand is reported as a count and never summed into a conflict. A pool with no recorded capacity is NOT ASSESSABLE and is neither a conflict nor a clearance.');
end
$$;

-- `service_role` IS IN THIS LIST, for the reason Slice 7B wrote out at
-- 20261211090200:466-480: Supabase grants EXECUTE on every new public function
-- to service_role by default, so a revoke that omits it leaves an
-- org-parameterised internal predicate answering over PostgREST for ANY
-- organization id a caller cares to type — while the comment below claims the
-- sync_field_readiness_elements posture, which does revoke it. A stated
-- invariant that is false is worth less than no statement at all.
revoke all on function public.sync_portfolio_resource_conflicts(uuid, date, date)
  from public, anon, authenticated, service_role;

comment on function public.sync_portfolio_resource_conflicts(uuid, date, date) is
  'D7.02 (spec I.22): THE collective-feasibility predicate — approved demand summed ACROSS development cases against the capacity in force, per pool, per window. Names the specification''s own case, `collective_only`: every project fits alone and the set does not. Refuses over a portfolio with no approved demand rather than reporting a compatible one, and reports a pool with no recorded capacity as NOT ASSESSABLE. Revoked from clients — it takes an explicit organization and is only called from a definer that established the tenant.';

-- ---------------------------------------------------------------------------
-- 2. THE CLIENT READ.
-- ---------------------------------------------------------------------------
create or replace function public.get_portfolio_resource_conflicts(
  p_horizon_weeks int default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_today date := current_date;
  v_result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if p_horizon_weeks is null or p_horizon_weeks < 1 or p_horizon_weeks > 260 then
    return jsonb_build_object('answered', false,
      'refusal', 'the horizon must be a whole number of weeks from 1 to 260 — a horizon of zero weeks detects nothing and a negative one detects into the past');
  end if;

  v_result := sync_portfolio_resource_conflicts(v_org, v_today,
    v_today + (p_horizon_weeks * 7));

  return v_result || jsonb_build_object('horizonWeeks', p_horizon_weeks,
    'asOf', v_today);
end
$$;

revoke all on function public.get_portfolio_resource_conflicts(int) from public, anon;
grant execute on function public.get_portfolio_resource_conflicts(int) to authenticated;

comment on function public.get_portfolio_resource_conflicts(int) is
  'D7.02: the portfolio conflict view a person reads — every pool committed across every project in the horizon, and which of them cannot deliver what has been promised. Collective, not per-package: a set of individually feasible projects that is collectively impossible is flagged by name.';

-- ---------------------------------------------------------------------------
-- 3. THE WEEKLY DOOR, EXTENDED.
--
--    Byte-for-byte 20261027090000:431 apart from two additions, and the
--    additions are stated here so a reviewer does not have to diff for them:
--
--    (a) the LABOUR check gains a `scope` field saying what it is about. Its
--        arithmetic is untouched — the same craft sum against the same
--        `sum(weekly_hours)` — because a slice that changed a live release
--        gate's numbers under cover of adding a view would be exactly the
--        move this programme exists to refuse. What that check has always
--        measured is THIS WEEK'S OPTION against the org's craft capacity, and
--        now it says so instead of leaving a reader to assume it covers more.
--        Its CAPACITY SOURCE is corrected in the same breath — see the
--        block at the check itself — because the columns this slice added to
--        craft_capacity changed what an unfiltered `sum(weekly_hours)` means,
--        and a craft carrying work with no capacity in force is now reported
--        `not_assessable` rather than dropped out of the check by a
--        `where cap > 0` that also decided `passed` on its way past.
--
--    (b) a NEW check, 'Portfolio resource commitments', reading the ONE
--        roll-up predicate for the option's own week. This is the collective
--        arm the register row asked for: the labour check cannot see it,
--        because a weekly option knows nothing about the other five projects
--        booking the same commissioning team.
--
--    SOFT, like the labour check beside it, and for the same 2026-08-11
--    reason: over-commitment across a portfolio is a real planning position a
--    manager may knowingly take with overtime or contractors, and a hard
--    block would teach people to route around the system. It is loud and it
--    requires the planner's existing explicit acknowledgement.
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_schedule_feasibility(p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  o schedule_options%rowtype;
  v_ids uuid[];
  v_safety int;
  v_authority int;
  v_short int;
  v_unassessed int;
  v_cap_rows int;
  v_labour jsonb;
  v_recovery_total int := 0;
  v_recovery_in_option int := 0;
  v_recovery_omitted int := 0;
  v_blocking int := 0;
  v_warning int := 0;
  v_checks jsonb := '[]'::jsonb;
  v_portfolio jsonb;
  v_week_end date;
  v_portfolio_conflicts int := 0;
  v_portfolio_unassessed int := 0;
  v_labour_over int := 0;
  v_labour_unassessed int := 0;
  v_craft_cap jsonb;
  r_craft record;
begin
  select * into o from schedule_options where id = p_option_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'schedule option not found');
  end if;

  select array_agg((it->>'wo_id')::uuid)
  into v_ids
  from jsonb_array_elements(o.items) it
  where it->>'wo_id' is not null;

  if v_ids is null then v_ids := '{}'; end if;

  -- HARD: safety gates
  select count(*) into v_safety
  from recommendation_screenings s
  join recommendations r on r.id = s.recommendation_id
  join work_orders w on w.recommendation_id = r.id
  where w.id = any(v_ids) and s.requires_gatekeeper and s.gatekeeper_attested_at is null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Safety consequence clearance', 'severity', 'blocking',
    'register_ref', 'C1.11',
    'passed', v_safety = 0, 'count', v_safety,
    'detail', case when v_safety = 0
      then 'No scheduled work is awaiting gatekeeper clearance.'
      else format('%s scheduled work order(s) carry an un-cleared safety gate. A schedule cannot be frozen around work that is not yet permitted to proceed.', v_safety) end);
  if v_safety > 0 then v_blocking := v_blocking + 1; end if;

  -- HARD: approval authority
  select count(*) into v_authority
  from work_orders w
  join recommendations r on r.id = w.recommendation_id
  where w.id = any(v_ids) and r.status = 'pending' and r.approval_required is not null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Approval authority', 'severity', 'blocking',
    'register_ref', 'E4.03',
    'passed', v_authority = 0, 'count', v_authority,
    'detail', case when v_authority = 0
      then 'No scheduled work is waiting on an approval.'
      else format('%s scheduled work order(s) still require approval.', v_authority) end);
  if v_authority > 0 then v_blocking := v_blocking + 1; end if;

  -- SOFT: materials
  select count(distinct work_order_id) into v_short
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'short';

  select count(distinct work_order_id) into v_unassessed
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'requested';

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Material readiness', 'severity', 'warning',
    'register_ref', 'C6.11',
    'passed', v_short = 0 and v_unassessed = 0,
    'count', v_short + v_unassessed,
    'detail', case
      when v_short = 0 and v_unassessed = 0 then 'Every scheduled job with recorded demand is materially ready.'
      else format('%s job(s) short of material, %s with demand that cannot be assessed. Warned rather than blocked: starting a job while a part is in transit is a legitimate planning judgement.', v_short, v_unassessed) end);
  if v_short + v_unassessed > 0 then v_warning := v_warning + 1; end if;

  -- SOFT: Recovery commitments. This does not resequence work. It makes a
  -- weekly plan acknowledge active restoration scope it omits.
  select
    count(distinct ew.work_order_id),
    count(distinct ew.work_order_id) filter (where ew.work_order_id = any(v_ids))
  into v_recovery_total, v_recovery_in_option
  from restoration_event_work ew
  join restoration_events e
    on e.id = ew.event_id
   and e.organization_id = v_org
  where ew.organization_id = v_org
    and e.status in ('open','planning','approval','released','executing','return_pending')
    and ew.plan_state = 'included'
    and ew.execution_status <> 'complete';

  v_recovery_total := coalesce(v_recovery_total, 0);
  v_recovery_in_option := coalesce(v_recovery_in_option, 0);
  v_recovery_omitted := greatest(0, v_recovery_total - v_recovery_in_option);

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Active Recovery commitments', 'severity', 'warning',
    'register_ref', 'SYNC-RECOVERY',
    'passed', v_recovery_omitted = 0,
    'count', v_recovery_omitted,
    'active_recovery_work', v_recovery_total,
    'included_in_week', v_recovery_in_option,
    'detail', case
      when v_recovery_total = 0 then
        'No active included Recovery work requires weekly-schedule acknowledgement.'
      when v_recovery_omitted = 0 then
        format('All %s active Recovery work order(s) are represented in this option. The Recovery event plan remains authoritative for sequence and verified concurrency.', v_recovery_total)
      else
        format('%s of %s active Recovery work order(s) are omitted from this weekly option. Omission is a capacity warning, not a deferral: the governed Recovery event plan remains authoritative for restoration sequence and execution.', v_recovery_omitted, v_recovery_total)
    end);
  if v_recovery_omitted > 0 then v_warning := v_warning + 1; end if;

  -- SOFT or NOT ASSESSABLE: labour against craft capacity
  select count(*) into v_cap_rows from craft_capacity where organization_id = v_org;

  if v_cap_rows = 0 then
    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08', 'passed', null, 'count', 0,
      'scope', 'this weekly option only',
      'detail', 'Not assessable: no craft capacity is recorded. Capacity is deliberately not inferred from headcount — a fabricated figure would silently authorise an unachievable week.');
  else
    -- ── THE LABOUR CAPACITY SUM HONOURS THE WINDOW AND THE CATEGORY, and
    --    that change is a CORRECTION this slice owes, not an optional
    --    improvement.
    --
    --    The arithmetic that stood here totalled every craft_capacity row for
    --    the craft — organization and craft name only, no date bound and no
    --    category —  byte-identical to 20261027090000, and the first draft of this slice
    --    pinned that fact in a migration test as proof that a live release
    --    gate's numbers could not move under cover of a new view. THE
    --    ARITHMETIC DID NOT MOVE; THE DATA MODEL UNDER IT DID. Slice 7C added
    --    `effective_to` and `resource_category` to craft_capacity and shipped
    --    `record_resource_capacity`, the first customer path that writes
    --    closed, future-dated and non-`skilled_trades` rows into that table.
    --    A sum blind to all three then:
    --
    --      * added a SUPERSEDED figure to the one that superseded it — and the
    --        collision refusal on the write path instructs exactly that
    --        supersession, so the product taught the flow that inflated the
    --        gate;
    --      * counted a contract crew that demobilised in January against a
    --        week in September, because the row is closed and the sum could
    --        not see the close;
    --      * counted a COMMISSIONING pool's hours as trades capacity whenever
    --        the two share a name.
    --
    --    Proven on a live database: recording a 400 h crew closed at
    --    2026-02-01 moved this week's available hours from 120 to 520 and its
    --    utilisation from 33.3% to 7.7% — an over-commitment warning silenced
    --    by capacity that is not in force. The direction of the error is
    --    always the dangerous one: MORE apparent capacity, FEWER warnings.
    --
    --    The fix asks the ONE capacity predicate, so there is one answer to
    --    "how many hours does this pool have this week" rather than two that
    --    disagree — the predicate honours effective_from, effective_to and the
    --    category, and carries the deductions as basis without subtracting
    --    them twice. `skilled_trades` is the category because that is what
    --    craft-week labour capacity IS and what every pre-existing row carries
    --    by the default this slice chose.
    for r_craft in
      select coalesce(t.craft, 'Unassigned') as craft,
             round(sum(t.estimated_hours)::numeric, 1) as req
        from work_order_tasks t
       where t.work_order_id = any(v_ids)
       group by coalesce(t.craft, 'Unassigned')
       order by sum(t.estimated_hours) desc
    loop
      v_craft_cap := sync_resource_capacity_hours(v_org, 'skilled_trades',
        r_craft.craft, o.week_start, o.week_start + 7);
      if (v_craft_cap->>'answered')::boolean is true
         and (v_craft_cap->>'capacityHours')::numeric > 0 then
        v_labour := coalesce(v_labour, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'craft', r_craft.craft,
            'required_hours', r_craft.req,
            'available_hours', round((v_craft_cap->>'capacityHours')::numeric, 1),
            'capacity_basis', v_craft_cap->>'basis',
            'utilisation_pct',
              round(100.0 * r_craft.req / (v_craft_cap->>'capacityHours')::numeric, 1)));
      else
        -- NOT ASSESSABLE, NOT INVISIBLE. The previous shape ended in
        -- `where x.cap > 0`, which DROPPED a craft with no capacity in force
        -- out of the check entirely: forty hours of work against a crew
        -- nobody has sized read as silence rather than as a gap, and `passed`
        -- was then computed over only the crafts that happened to have rows.
        v_labour_unassessed := v_labour_unassessed + 1;
        v_labour := coalesce(v_labour, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'craft', r_craft.craft,
            'required_hours', r_craft.req,
            'available_hours', null,
            'utilisation_pct', null,
            'state', 'not_assessable',
            'detail', coalesce(v_craft_cap->>'refusal',
              format('Not assessable: no usable capacity figure is in force for skilled trades pool "%s" in the week beginning %s.',
                r_craft.craft, o.week_start))));
      end if;
    end loop;

    v_labour_over := (select count(*)
      from jsonb_array_elements(coalesce(v_labour, '[]'::jsonb)) l
     where (l->>'utilisation_pct') is not null
       and (l->>'utilisation_pct')::numeric > 100);

    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08',
      -- NULL, NOT TRUE, where a craft could not be assessed and none of the
      -- assessed ones is over. "Every craft is inside its capacity" is a
      -- statement about crafts somebody sized; it is not a statement about the
      -- ones nobody has.
      'passed', case when v_labour_over > 0 then false
                     when v_labour_unassessed > 0 then null
                     else true end,
      'count', v_labour_over,
      'not_assessable_crafts', v_labour_unassessed,
      'by_craft', coalesce(v_labour, '[]'::jsonb),
      'scope', 'this weekly option only',
      'detail', case
        when v_labour_unassessed > 0 then
          format('Required hours from applied job plans against the capacity IN FORCE for this week — the same predicate the portfolio view uses, honouring each figure''s effective dates and category. %s craft(s) carry work with no usable capacity figure in force and are NOT ASSESSABLE: they are neither a shortfall nor a clearance, and this check does not pass over them. Over-commitment warns rather than blocks — overtime and contractors are real options a planner may take. This check sees THIS WEEK''S option and nothing else; the project commitments standing against the same crews are the next check.',
            v_labour_unassessed)
        else
          'Required hours from applied job plans against the capacity IN FORCE for this week — the same predicate the portfolio view uses, honouring each figure''s effective dates and category, so a superseded or demobilised crew cannot be counted twice. Over-commitment warns rather than blocks — overtime and contractors are real options a planner may take. This check sees THIS WEEK''S option and nothing else; the project commitments standing against the same crews are the next check.'
        end);
    if v_labour_over > 0 or v_labour_unassessed > 0 then
      v_warning := v_warning + 1;
    end if;
  end if;

  -- SOFT or NOT ASSESSABLE: the PORTFOLIO position for this same week
  -- (D7.02). The collective arm of the same engine: approved project demand
  -- across every case in the organization, against the capacity in force.
  -- A weekly option cannot see this on its own, and it is where the
  -- specification's "individually executable, collectively impossible" lives.
  v_week_end := o.week_start + 7;
  v_portfolio := sync_portfolio_resource_conflicts(v_org, o.week_start, v_week_end);

  if (v_portfolio->>'answered')::boolean is true then
    v_portfolio_conflicts := coalesce((v_portfolio->>'conflicts')::int, 0);
    v_portfolio_unassessed := coalesce((v_portfolio->>'notAssessable')::int, 0);
    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Portfolio resource commitments', 'severity', 'warning',
      'register_ref', 'D7.02',
      -- ── NOT ASSESSED IS NOT A PASS, AT A RELEASE GATE.
      --
      --    The roll-up predicate classifies a pool with no capacity in force
      --    as `not_assessable` and states in its own basis that such a pool
      --    "is neither a conflict nor a clearance". The first draft of this
      --    door then read ONLY `conflicts`, set `passed` to `conflicts = 0`,
      --    and on zero printed "Every pool committed across N development
      --    case(s) this week is inside its recorded capacity." Proven live: a
      --    portfolio whose single committed pool had NO capacity row produced
      --    `notAssessable: 1`, `conflicts: 0` and that universal clearance
      --    sentence — zero pools assessed, and the weekly release gate said
      --    everything fits. `get_case_resource_balance` has never made that
      --    mistake ("not counted as conflicts and they are not counted as
      --    clear"), so the right pattern was already in the slice.
      'passed', case when v_portfolio_conflicts > 0 then false
                     when v_portfolio_unassessed > 0 then null
                     else true end,
      'count', v_portfolio_conflicts,
      'scope', 'every development case in this organization, this week',
      'collective_only_conflicts', v_portfolio->'collectiveOnlyConflicts',
      'not_assessable_pools', v_portfolio->'notAssessable',
      'pools', v_portfolio->'pools',
      'detail', case
        when v_portfolio_conflicts = 0 and v_portfolio_unassessed > 0 then
          format('NOT ASSESSABLE: %s pool(s) committed across %s development case(s) this week have no capacity figure in force, so nothing is known about whether they fit. No pool that WAS assessed is over-committed. An empty conflict list over an unassessed portfolio is not a clearance.',
            v_portfolio_unassessed, v_portfolio->>'casesWithCommitments')
        when v_portfolio_conflicts = 0 then
          format('Every pool committed across %s development case(s) this week is inside its recorded capacity.', v_portfolio->>'casesWithCommitments')
        when coalesce((v_portfolio->>'collectiveOnlyConflicts')::int, 0) > 0 then
          format('%s pool(s) are over-committed across the portfolio this week, and %s of them are over-committed ONLY collectively — every project fits alone and the set does not. Warned rather than blocked, and the judgement is a portfolio one: this week cannot resolve it by dropping work from this option.%s',
            v_portfolio_conflicts, v_portfolio->>'collectiveOnlyConflicts',
            case when v_portfolio_unassessed > 0
              then format(' A further %s pool(s) could not be assessed at all.', v_portfolio_unassessed)
              else '' end)
        else
          format('%s pool(s) are committed beyond their recorded capacity across the portfolio this week.%s', v_portfolio_conflicts,
            case when v_portfolio_unassessed > 0
              then format(' A further %s pool(s) could not be assessed at all.', v_portfolio_unassessed)
              else '' end) end);
    if v_portfolio_conflicts > 0 or v_portfolio_unassessed > 0 then
      v_warning := v_warning + 1;
    end if;
  else
    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Portfolio resource commitments', 'severity', 'warning',
      'register_ref', 'D7.02',
      'passed', null, 'count', 0,
      'scope', 'every development case in this organization, this week',
      'detail', format('Not assessable: %s', v_portfolio->>'refusal'));
  end if;

  -- NOT ASSESSABLE: production/operating context
  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Production window', 'severity', 'warning',
    'register_ref', 'C2.04', 'passed', null, 'count', 0,
    'detail', 'Not assessable: operating context and production plans are not ingested. Equipment availability windows cannot be checked against a plan the platform cannot see.');

  return jsonb_build_object(
    'option_id', p_option_id, 'week_start', o.week_start,
    'work_orders', coalesce(array_length(v_ids, 1), 0),
    'blocking_failures', v_blocking, 'warnings', v_warning,
    'releasable', v_blocking = 0,
    'checks', v_checks,
    'policy', 'Hard constraints block a release; soft constraints warn and leave the judgement with the planner. Recovery event sequence remains governed by Recovery and cannot be overridden by a weekly option. The portfolio check is collective across development cases and cannot be resolved by editing this week.');
end
$$;

revoke all on function public.evaluate_schedule_feasibility(uuid) from public, anon;
grant execute on function public.evaluate_schedule_feasibility(uuid) to authenticated;

comment on function public.evaluate_schedule_feasibility(uuid) is
  'C8.08 + D7.02: the ONE weekly feasibility door. Hard constraints (safety clearance, approval authority) block; soft ones (materials, Recovery commitments, labour capacity, PORTFOLIO resource commitments) warn. Slice 7C added the collective arm — approved project demand across every development case against the capacity in force — reading the ONE roll-up predicate rather than computing a second opinion, and CORRECTED the labour check to ask that same capacity predicate, because the effective_to and resource_category columns this slice added made an unfiltered sum(weekly_hours) count demobilised crews and other categories'' pools as available labour. Neither soft check reports `passed` true over a pool or a craft nobody could assess.';

notify pgrst, 'reload schema';
