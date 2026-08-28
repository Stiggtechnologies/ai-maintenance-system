-- ============================================================================
-- Sync Develop Slice 2 — the business-case-collapse trigger (D2.03, spec
-- I.4): "If the business case collapses: Sync recommendation — reconsider
-- sanction."
--
-- WHAT FIRES AND WHAT NEVER DOES (§70, standing constraint 2): collapse
-- detection is RULES-BASED AND DETERMINISTIC — the latest RECORDED expected
-- value compared against the DECLARED viability floor. No LLM anywhere in
-- the chain. And the consequence is a RECOMMENDATION through the canonical
-- recommendation store (D11.37's ruling: recommendations + verification_
-- obligations ARE the action store — no second queue, no parallel workflow):
-- only humans re-decide the sanction, through the same §70 gate/sanction
-- machinery that recorded it.
--
-- REFUSAL-FIRST: the evaluator returns "not evaluable", with the missing
-- thing named, when no floor is declared (D2.06's set_case_viability_floor
-- is the tripwire's front door) or when no evaluation is recorded (D2.02's
-- record_case_value_evaluation is the value's front door). It never
-- computes an expected value itself — a collapse verdict on a number nobody
-- recorded would be exactly the fabricated-figure failure this program
-- retracts.
--
-- TWO DETERMINISTIC CALL SITES, both re-created here with that single hook
-- as their delta (bodies otherwise byte-identical to 20261115090400 /
-- 20261115090100 — assembled by exact string replacement at authoring time):
--   * record_case_value_evaluation — a fresh recorded value below the floor
--     is the direct detection;
--   * apply_assumption_invalidation — a violated viability-threshold
--     assumption (D2.07's sweep) re-evaluates its case.
--
-- THE RECOMMENDATION CARRIES THE FULL C8 APPROVER CONTRACT — issue,
-- evidence, action, consequence, alternatives (the spec-I.5 gate outcomes
-- ARE the alternatives), completion date (a stated +30-day review rule,
-- named in the rationale as a rule, not schedule data), approver role,
-- verification method. asset_id rides along exactly when the business case
-- recorded one (C8.11 stays honest — absent means absent). Deduplication:
-- one PENDING reconsideration per case at a time — a second collapse signal
-- lands on the existing open recommendation, audited, not duplicated.
--
-- CASE BINDING travels through the governed door: the column-scoped
-- provenance trigger on recommendations.development_case_id
-- (20261105090400) admits exactly the marker-carrying transaction; this
-- function is the second sanctioned writer after bind_recommendation_to_case
-- and is documented as such here. The insert is audited to audit_events AND
-- security_events in the same transaction.
--
-- Canonical reuse: recommendations, development_cases, business_cases,
-- lifecycle_evaluations, risk_assumptions, audit_events, security_events.
-- No new table, no new queue.
-- ============================================================================

create or replace function public.evaluate_business_case_collapse(
  p_case_id uuid,
  p_organization_id uuid,
  p_trigger text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
  bc business_cases%rowtype;
  ev lifecycle_evaluations%rowtype;
  v_existing uuid;
  v_rec uuid;
  v_gap numeric;
begin
  -- Defense-in-depth: this function is service-only and every caller sits in
  -- an org-validated definer chain, but the case lookup still re-asserts the
  -- org the CALLER validated — a future caller passing an unvalidated id
  -- cannot make this rule fire against another tenant's case.
  select * into c from development_cases
  where id = p_case_id and organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('evaluated', false, 'reason', 'case not found');
  end if;
  if c.status in ('cancelled','completed') then
    return jsonb_build_object('evaluated', false,
      'reason', 'a ' || c.status || ' case has no sanction to reconsider');
  end if;

  select * into bc from business_cases
  where organization_id = c.organization_id and development_case_id = c.id
  order by created_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('evaluated', false,
      'reason', 'not evaluable: no business case is recorded on this case');
  end if;
  if bc.viability_floor is null then
    return jsonb_build_object('evaluated', false,
      'reason', 'not evaluable: no viability floor is declared on the business case — declare the tripwire (set_case_viability_floor) for collapse detection to exist');
  end if;

  select * into ev from lifecycle_evaluations
  where organization_id = c.organization_id and development_case_id = c.id
    and evaluation_kind = 'case_value'
  order by evaluated_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('evaluated', false,
      'reason', 'not evaluable: no value evaluation is recorded on this case — collapse is judged on recorded values only (record_case_value_evaluation)');
  end if;

  if ev.expected_value >= bc.viability_floor then
    return jsonb_build_object('evaluated', true, 'collapsed', false,
      'expectedValue', ev.expected_value,
      'viabilityFloor', bc.viability_floor,
      'headroom', ev.expected_value - bc.viability_floor);
  end if;

  v_gap := bc.viability_floor - ev.expected_value;

  -- One pending reconsideration per case: a second signal is audited onto
  -- the record, never duplicated into a second queue entry.
  select id into v_existing from recommendations
  where organization_id = c.organization_id
    and development_case_id = c.id
    and status = 'pending'
    and title like 'Reconsider sanction:%'
  order by created_at desc limit 1;
  if v_existing is not null then
    insert into audit_events (organization_id, entity_type, actor, event_data)
    values (c.organization_id, 'case_collapse_signal', 'system:collapse-rule',
      jsonb_build_object('case_id', c.id, 'recommendation_id', v_existing,
        'trigger', p_trigger, 'expected_value', ev.expected_value,
        'viability_floor', bc.viability_floor, 'already_open', true));
    return jsonb_build_object('evaluated', true, 'collapsed', true,
      'recommendation_id', v_existing, 'already_open', true,
      'expectedValue', ev.expected_value, 'viabilityFloor', bc.viability_floor);
  end if;

  perform set_config('app.recommendation_case_binding_write', 'granted', true);

  insert into recommendations
    (organization_id, development_case_id, asset_id, title, issue, action,
     impact, confidence, urgency, status, rationale, financial_impact,
     risk_impact, consequence_summary, alternatives_considered,
     required_completion_date, required_approver_role, verification_method)
  values
    (c.organization_id, c.id, bc.asset_id,
     'Reconsider sanction: recorded expected value below the declared viability floor',
     format('Business case %s on development case "%s": the latest recorded expected value is %s %s (evaluated %s, uncertainty %s, basis: %s), below the declared viability floor of %s %s (basis: %s). Trigger: %s.',
            bc.case_ref, c.title,
            ev.expected_value, bc.currency, ev.evaluated_at::date, ev.uncertainty_level, ev.rationale,
            bc.viability_floor, bc.currency, bc.viability_floor_basis, p_trigger),
     'Sync recommendation: reconsider sanction (spec I.4). Convene a gate review on the current stage and record the human determination through record_case_gate_review — proceed only re-clears this if a fresh linked evaluation stands at or above the floor.',
     format('Expected value stands %s %s below the declared viability floor.', v_gap, bc.currency),
     100, 'action', 'pending',
     format('Deterministic rule, not judgement: recorded EV (%s) < declared floor (%s). Both figures carry recorded bases (evaluation %s; floor on business case %s). The evaluation''s own uncertainty is %s — the COMPARISON is certain, the inputs carry their stated uncertainty. Completion date is a +30-day review rule stated by this trigger, not schedule data.',
            ev.expected_value, bc.viability_floor, ev.id, bc.case_ref, ev.uncertainty_level),
     format('%s %s below the declared viability floor', v_gap, bc.currency),
     'High',
     format('Sanctioned capital continuing against a case whose recorded value (%s %s) no longer clears its declared viability floor (%s %s) — every further commitment is spent against a case the organization would not sanction today (spec I.5: "if this project were proposed today, would we still fund it?").',
            ev.expected_value, bc.currency, bc.viability_floor, bc.currency),
     'The spec-I.5 gate outcomes are the alternatives: proceed unchanged (record why the floor no longer binds, or revise it with basis via set_case_viability_floor); pivot or redesign (concept survives at lower value); pause; recycle the stage; terminate. Each is a human gate determination — none is taken here.',
     current_date + 30, 'executive',
     'A fresh gate review recorded through record_case_gate_review (§70 human determination) with a linked value evaluation at or above the declared floor, or a revised floor with stated basis, or a recorded pause/pivot/redesign/terminate outcome.')
  returning id into v_rec;

  perform set_config('app.recommendation_case_binding_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (c.organization_id, 'case_collapse_signal', 'system:collapse-rule',
    jsonb_build_object('case_id', c.id, 'recommendation_id', v_rec,
      'trigger', p_trigger, 'expected_value', ev.expected_value,
      'evaluation_id', ev.id, 'viability_floor', bc.viability_floor,
      'gap', v_gap));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (c.organization_id, null, 'system (collapse rule)',
     'admin_action', 'notice',
     format('Business-case collapse detected on case "%s": recorded EV %s %s below declared floor %s %s. Sanction-reconsideration recommendation %s raised through the canonical store — a human re-decides; nothing was changed automatically.',
            c.title, ev.expected_value, bc.currency, bc.viability_floor, bc.currency, v_rec));

  return jsonb_build_object('evaluated', true, 'collapsed', true,
    'recommendation_id', v_rec,
    'expectedValue', ev.expected_value,
    'viabilityFloor', bc.viability_floor,
    'gap', v_gap);
end
$$;

revoke all on function public.evaluate_business_case_collapse(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.evaluate_business_case_collapse(uuid, uuid, text) to service_role;


-- ---------------------------------------------------------------------------
-- 2. record_case_value_evaluation, re-created from 20261115090400 with ONE
--    delta: the collapse evaluation runs after the record lands, and its
--    verdict rides the response. Everything else byte-identical (assembled
--    by exact string replacement at authoring time).
-- ---------------------------------------------------------------------------
create or replace function public.record_case_value_evaluation(
  p_case_id uuid,
  p_option_id bigint,
  p_expected_value numeric,
  p_value_basis text,
  p_uncertainty_level text,
  p_uncertainty_reasons jsonb default '[]'::jsonb,
  p_computed jsonb default '{}'::jsonb,
  p_engine_version text default 'develop-value/1'
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
  bc business_cases%rowtype;
  o business_case_options%rowtype;
  v_inputs jsonb;
  v_options jsonb;
  v_id uuid;
  v_flow_count int;
  v_collapse jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a value evaluation requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'value is not evaluable on a ' || c.status || ' case');
  end if;

  select * into bc from business_cases
  where organization_id = v_org and development_case_id = c.id
  order by created_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('error',
      'expected value unavailable: no business case is recorded on this case — an evaluation evaluates recorded inputs (create_case_business_case first)');
  end if;
  if bc.discount_rate_source is null or btrim(bc.discount_rate_source) = '' then
    return jsonb_build_object('error',
      'expected value unavailable: the business case''s discount rate has no recorded source — a rate nobody owns is refused as an input');
  end if;
  select * into o from business_case_options
  where id = p_option_id and case_id = bc.id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error',
      'the evaluated option must be one of this business case''s recorded options — an evaluation says WHAT was valued');
  end if;
  v_flow_count := coalesce(jsonb_array_length(o.cash_flows), 0);
  if v_flow_count = 0 then
    return jsonb_build_object('error',
      'expected value unavailable: option "' || o.label || '" carries no dated cash flows — NPV is computed from dated flows or not at all');
  end if;
  if p_expected_value is null then
    return jsonb_build_object('error', 'an evaluation records the expected value it concluded');
  end if;
  if coalesce(length(btrim(p_value_basis)), 0) < 20 then
    return jsonb_build_object('error',
      'a value without its basis is a liability — state what this figure rests on (20 characters minimum)');
  end if;
  if p_uncertainty_level not in ('low','moderate','high') then
    return jsonb_build_object('error', 'uncertainty_level must be low, moderate or high');
  end if;
  if p_computed is null or jsonb_typeof(p_computed) <> 'object' then
    return jsonb_build_object('error', 'computed must be a json object (the kernel''s outputs for the evaluated option)');
  end if;
  if coalesce(length(btrim(p_engine_version)), 0) < 3 then
    return jsonb_build_object('error', 'the evaluation names the engine version that computed it');
  end if;

  -- Freeze the inputs FROM THE RECORD, not from the caller: what the
  -- organization had recorded at this moment is what the figure rests on.
  select jsonb_build_object(
    'businessCaseId', bc.id,
    'caseRef', bc.case_ref,
    'currency', bc.currency,
    'discountRate', bc.discount_rate,
    'discountRateSource', bc.discount_rate_source,
    'hypothesis', case when bc.hypothesis_spend is null then null else jsonb_build_object(
      'spend', bc.hypothesis_spend, 'effect', bc.hypothesis_effect,
      'effectQuantity', bc.hypothesis_effect_quantity,
      'effectUnit', bc.hypothesis_effect_unit,
      'valuePerYear', bc.hypothesis_value_per_year,
      'basis', bc.hypothesis_basis) end,
    'viabilityFloor', bc.viability_floor,
    'evaluatedOption', jsonb_build_object(
      'id', o.id, 'label', o.label, 'lifePeriods', o.life_periods,
      'cashFlows', o.cash_flows, 'benefitProbability', o.benefit_probability,
      'isDoNothing', o.is_do_nothing,
      'contingency', o.contingency, 'contingencyBasis', o.contingency_basis),
    'financialAssumptionVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', latest.assumption_key, 'value', latest.value, 'unit', latest.unit,
        'kind', latest.kind, 'source', latest.source,
        'effectiveFrom', latest.effective_from) order by latest.assumption_key)
      from (
        select distinct on (fa.assumption_key) fa.*
        from financial_assumptions fa
        where fa.organization_id = v_org and fa.effective_from <= current_date
        order by fa.assumption_key, fa.effective_from desc, fa.id desc
      ) latest), '[]'::jsonb))
  into v_inputs;

  v_options := jsonb_build_array(jsonb_build_object(
    'optionId', o.id, 'label', o.label, 'computed', p_computed));

  -- The immutability backstop (trg_case_value_evaluation_immutability)
  -- admits exactly this marker-carrying transaction: the RPC is the ONE
  -- sanctioned writer of a case-value evaluation.
  perform set_config('app.case_value_evaluation_write', 'granted', true);
  insert into lifecycle_evaluations
    (organization_id, asset_id, development_case_id, business_case_id,
     evaluation_kind, expected_value, inputs, options,
     uncertainty_level, uncertainty_reasons, rationale,
     engine_version, evaluated_by)
  values
    (v_org, null, c.id, bc.id,
     'case_value', p_expected_value, v_inputs, v_options,
     p_uncertainty_level, coalesce(p_uncertainty_reasons, '[]'::jsonb),
     btrim(p_value_basis), btrim(p_engine_version), auth.uid())
  returning id into v_id;
  perform set_config('app.case_value_evaluation_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_value_evaluation', coalesce(v_role, 'unknown'),
    jsonb_build_object('evaluation_id', v_id, 'case_id', c.id,
      'business_case_id', bc.id, 'option_id', o.id,
      'expected_value', p_expected_value,
      'uncertainty', p_uncertainty_level, 'engine', btrim(p_engine_version)));

  -- D2.03: a fresh recorded value is the direct collapse-detection moment.
  -- Deterministic; the verdict rides the response so the recorder sees what
  -- the record just triggered.
  v_collapse := public.evaluate_business_case_collapse(c.id, v_org,
    format('value evaluation %s recorded at %s', v_id, now()));

  return jsonb_build_object('evaluation_id', v_id, 'case_id', c.id,
    'expected_value', p_expected_value,
    'collapse', v_collapse,
    'note', 'Recorded with frozen inputs. It becomes a trajectory point when a gate review links it (record_case_gate_review p_evaluation_id).');
end
$$;

revoke all on function public.record_case_value_evaluation(uuid, bigint, numeric, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_case_value_evaluation(uuid, bigint, numeric, text, text, jsonb, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. apply_assumption_invalidation, re-created from 20261115090100 with ONE
--    delta: a case-anchored assumption falling evaluates its case for
--    collapse after the D3.30 reopening walk. Everything else byte-identical
--    (assembled by exact string replacement at authoring time).
-- ---------------------------------------------------------------------------
create or replace function public.apply_assumption_invalidation(
  p_assumption_id uuid,
  p_reason text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a risk_assumptions%rowtype;
  dep record; linked record; v_dep_risk uuid;
  v_collapse jsonb;
begin
  select * into a from risk_assumptions where id = p_assumption_id and status = 'active';
  if not found then
    return jsonb_build_object('error','active assumption not found');
  end if;
  update risk_assumptions set status='invalidated',invalidated_by=auth.uid(),invalidated_at=now(),
    invalidation_reason=btrim(p_reason) where id=a.id;
  for dep in select * from risk_assumption_dependencies where assumption_id=a.id loop
    if dep.subject_type='risk' then perform mark_risk_reassessment(dep.subject_id,'Assumption invalidated: '||a.statement); end if;
    if dep.subject_type='decision' then update decisions set reassessment_required=true,
      reassessment_reason='Assumption invalidated: '||a.statement
      where id=dep.subject_id and organization_id=a.organization_id; end if;
    if dep.subject_type='scenario' then
      select risk_id into v_dep_risk from scenarios where id=dep.subject_id and organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent scenario assumption invalidated: '||a.statement); end if;
    end if;
    if dep.subject_type='control' then
      for linked in select risk_id from risk_control_links where control_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent control assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='objective' then
      for linked in select id risk_id from risks where objective_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent objective assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='work_order' then
      select coalesce(w.risk_id,rec.risk_id) into v_dep_risk from work_orders w
        left join recommendations rec on rec.id=w.recommendation_id
        where w.id=dep.subject_id and w.organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent work assumption invalidated: '||a.statement); end if;
    end if;
  end loop;
  -- The direct risk anchor is a dependency in fact even when the row predates
  -- the dependency seed (record_risk_assumption seeds it; case assumptions
  -- have none).
  if a.risk_id is not null and not exists (
    select 1 from risk_assumption_dependencies
    where assumption_id = a.id and subject_type = 'risk' and subject_id = a.risk_id
  ) then
    perform mark_risk_reassessment(a.risk_id,'Assumption invalidated: '||a.statement);
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(a.organization_id,'risk_assumption_invalidated',p_actor_role,
    jsonb_build_object('assumption_id',a.id,'reason',btrim(p_reason),
      'development_case_id',a.development_case_id,'business_case_id',a.business_case_id));
  -- D2.03: a case-anchored assumption falling re-evaluates its case's
  -- collapse verdict — one chain: threshold violation → invalidation →
  -- D3.30 reopening (above) → collapse evaluation → canonical
  -- recommendation. Deterministic end to end.
  if a.development_case_id is not null then
    v_collapse := public.evaluate_business_case_collapse(a.development_case_id,
      a.organization_id, 'assumption invalidated: '||a.statement);
  end if;
  return jsonb_build_object('assumption_id',a.id,'status','invalidated','reassessment_required',true,
    'collapse',v_collapse);
end;
$$;

revoke all on function public.apply_assumption_invalidation(uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
