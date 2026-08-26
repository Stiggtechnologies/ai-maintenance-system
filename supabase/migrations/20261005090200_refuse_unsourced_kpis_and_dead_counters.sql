-- ============================================================================
-- Four numbers that were presented as measurements and were not.
--
-- Each of these renders on an executive-facing surface, carries a unit, and
-- traces to a hand-typed literal rather than to anything the platform
-- measured. This follows the precedent 20260911090000 set for the fabricated
-- fleet aggregates: a FORWARD delete, never an edit to applied history, so a
-- fresh install and a deployed database converge on the same state.
--
-- 1. COST OF DOWNTIME — a hardcoded $10,000/h.
--
--    compute_kpi_snapshot computed `downtime_hours_30d × 10000` and stamped
--    the lineage "closeout downtime hours (30d) × $10k/h assumed rate — set
--    site rate to refine". No site rate could be set: there was no column, no
--    RPC and no screen for one. The lineage promised a refinement path that
--    did not exist, which is worse than the constant, because it reads as an
--    interim measurement rather than an invention. A downtime rate is an
--    economic fact about a specific plant — it varies by orders of magnitude
--    between a conveyor and a gas train — and this platform cannot derive it.
--
--    Refused rather than defaulted. `financial_assumptions` (20260819140000)
--    is the canonical home for a rate like this, and it already requires a
--    `source` on every row because "an assumption with no source is a number
--    somebody liked". Until an organisation records one there, the KPI is not
--    computable and says so.
--
-- 2. ASSET RISK INDEX — an average over a column nothing writes.
--
--    `avg(assets.risk_score)`, headline tile, confidence 'high'. Nothing in
--    src/, supabase/ or scripts/ ever writes assets.risk_score: the only
--    values that have ever existed are the six hand-typed in the demo seed
--    (82, 67, 44, 31, 58, 33). Any real import leaves the column at its
--    default of 0, so a customer's board sees a risk index of 0 at HIGH
--    confidence — the most reassuring possible reading of no data at all.
--
-- 3. ai_agents.actions_executed — a counter with no writer.
--
--    Seeded with 18, 6, 12, 15, 22, 20, 9, 7, 3, 2, 1, 14, 4, 1, 5 across the
--    fifteen demo agents and incremented by nothing, ever. run_agent_loop
--    maintains recommendations_generated and last_action_at; no code path in
--    this repository has ever incremented actions_executed. It is rendered on
--    /ai-workforce and /autonomy-maturity as evidence of autonomous execution.
--    Zeroed rather than dropped: the column has live readers, and removing it
--    is a schema change across three pages that belongs to the feature lane.
--    Zero is the true count.
--
-- 4. 'Autonomous (< $5K)' — an approval threshold that is not policy.
--
--    Two demo recommendations carry approval_required = 'Autonomous (< $5K)'
--    and 'Autonomous', asserting a spend threshold below which the platform
--    acts without a human. No authority_limits row, no policy and no code
--    implements a $5,000 threshold; AGENTS.md invariant 6 says the opposite.
--    A demo that shows the system approving its own spend is precisely the
--    "bypassing approvals to make a demo appear autonomous" the contract
--    prohibits. Reassigned to the accountable role that actually holds it.
--
-- WHAT IS NOT DONE HERE, AND WHY. The demo seed's other hand-typed figures
-- (evidence confidence contributions, scenario costs) are labelled scenario
-- fixtures attached to a demo recommendation, not aggregates presented as
-- measurement, and they have no path into an executive KPI. Removing them is
-- a separate judgement about what the demo is for.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 + 2. Refuse the two unsourced KPIs.
--
-- `computable = false` is the mechanism the catalog already has for "this
-- needs an input you have not supplied": compute_kpi_snapshot loops over
-- `kpi_catalog where computable`, and the dashboard renders `source_note` as
-- "Connects with: …" instead of a number. Nothing new is invented to say no.
-- ---------------------------------------------------------------------------
update kpi_catalog
set computable = false,
    source_note = 'A downtime cost rate for this site. Record it as '
      || 'financial_assumptions.downtime_cost_per_hour with its source — the '
      || 'rate is an economic fact about your plant and cannot be derived '
      || 'from maintenance data. The previous figure used an assumed '
      || '$10,000/h that could not be changed.'
where kpi_key = 'cost_of_downtime';

update kpi_catalog
set computable = false,
    source_note = 'Asset risk scores. Nothing computes assets.risk_score '
      || 'today, so the average was either hand-entered or zero. A criticality '
      || 'or consequence model that writes it makes this computable.'
where kpi_key = 'asset_risk_index';

-- Every value ever written for these two keys came from the constant or the
-- unwritten column. The dashboard reads the LATEST row per key, so leaving
-- them would keep the fabricated number on the tile forever.
delete from kpi_values where kpi_key in ('cost_of_downtime', 'asset_risk_index');

-- ---------------------------------------------------------------------------
-- 3. The counter tells the truth: nothing has been executed autonomously.
-- ---------------------------------------------------------------------------
update ai_agents set actions_executed = 0 where actions_executed > 0;

-- The same claim aggregated: a 'verified' value metric asserting 142
-- autonomous actions, from the same seed, verified by nobody.
delete from value_metrics where metric_type = 'autonomous_actions_executed';

-- ---------------------------------------------------------------------------
-- 4. No recommendation is approved by a threshold that does not exist.
-- ---------------------------------------------------------------------------
update recommendations
set approval_required = accountable
where approval_required in ('Autonomous', 'Autonomous (< $5K)');

-- ---------------------------------------------------------------------------
-- 5. Un-pin the value surfaces from the demo organisation's own identifiers.
--
-- ValueManagement asked for the business case literally named 'DEMO-BC-01'
-- and the capital plan for the literal year 2027. Every real organisation
-- therefore rendered an empty panel — the surface worked only for the demo
-- tenant, which is the shape of a screen that has never been opened by a
-- customer. Both parameters become optional: null means "this organisation's
-- most recent", which is what the caller wanted in the first place.
-- ---------------------------------------------------------------------------
drop function if exists get_business_case(text);
create or replace function public.get_business_case(p_case_ref text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'caseRef', bc.case_ref, 'title', bc.title, 'driver', bc.driver,
    'discountRate', bc.discount_rate, 'discountRateSource', bc.discount_rate_source,
    'status', bc.status,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', o.label, 'lifePeriods', o.life_periods,
        'cashFlows', o.cash_flows, 'benefitProbability', o.benefit_probability,
        'isDoNothing', o.is_do_nothing, 'notes', o.notes) order by o.label)
      from business_case_options o where o.case_id = bc.id
    ), '[]'::jsonb))
  from business_cases bc
  where bc.organization_id = app_current_org()
    and (p_case_ref is null or bc.case_ref = p_case_ref)
  order by bc.created_at desc
  limit 1;
$$;

grant execute on function public.get_business_case(text) to authenticated;

drop function if exists get_capital_plan(int);
create or replace function public.get_capital_plan(p_year int default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with target as (
    select coalesce(
      p_year,
      (select max(plan_year) from capital_plan_items
        where organization_id = app_current_org())
    ) as y
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', label, 'cost', cost,
    'benefit', coalesce(benefit_present_value, 0),
    'mandatory', mandatory, 'mandatoryBasis', mandatory_basis) order by label), '[]'::jsonb)
  from capital_plan_items, target
  where organization_id = app_current_org() and plan_year = target.y;
$$;

grant execute on function public.get_capital_plan(int) to authenticated;

notify pgrst, 'reload schema';
