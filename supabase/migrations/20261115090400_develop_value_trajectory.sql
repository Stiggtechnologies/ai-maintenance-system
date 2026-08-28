-- ============================================================================
-- Sync Develop Slice 2 — recorded value evaluations, the per-gate expected-
-- value trajectory (D2.02, spec I.4), the since-sanction delta (D2.05, spec
-- I.11), and the D1.02 lifecycle invariant wired into the gate machinery.
--
-- WHERE AN EVALUATION LIVES (overlap-map ruling 4's note, applied):
-- lifecycle_evaluations IS "the economic-evaluation record gates link to" —
-- stage_gate_reviews.evaluation_id has referenced it since 20260816090000.
-- This file EXTENDS that record to case scope (asset_id relaxes; a case
-- anchor arrives) rather than creating a second evaluation store. The
-- lifecycle-decisions convention is kept verbatim: "the database supplies
-- inputs and stores results; src/lib does the arithmetic against the single
-- validated engine, and every evaluation is persisted WITH the inputs it
-- used so any figure can be recomputed and challenged." The INPUTS here are
-- FROZEN SERVER-SIDE from the recorded finance model at the moment of
-- evaluation — the client cannot state inputs that were not recorded.
--
-- REFUSAL-FIRST (the register's standing constraint 3, and this slice's
-- charter): an evaluation is REFUSED, with the missing thing named, when
--   * no business case is recorded on the case;
--   * the discount rate has no recorded source;
--   * no option carries a dated cash flow;
--   * the evaluated option is not one of the recorded options;
--   * the value arrives without its basis.
--
-- THE TRAJECTORY IS REAL RECORDED VALUES ONLY (D2.02, binding): each point
-- is an evaluation a gate review LINKED at recording time. A gate whose
-- latest review links no evaluation renders "not evaluated at this gate" —
-- no interpolation, no carry-forward rendered as fresh.
--
-- THE SINCE-SANCTION DELTA (D2.05) diffs the CURRENT evaluation against the
-- SANCTION-BASELINE evaluation — the latest one recorded at or before the
-- sanction moment — and only when both ends exist. The approved BENEFITS and
-- COST baselines (D5.26, #284) anchor the read: they are returned beside the
-- delta as the fixed reference the numbers are judged against. Dimensions
-- present in both frozen input sets diff; dimensions absent on either end
-- are NAMED as not comparable, with the missing side stated.
--
-- D1.02, WIRED (the reason record_case_gate_review is re-created here): the
-- success contract is recorded BEFORE design — so a PROCEED (plain or
-- conditional) through any gate of a design-or-later stage (master
-- lifecycle_stages.stage_order >= the 'design' stage's order) is REFUSED
-- while the case has no recorded contract, and get_gate_readiness names the
-- missing contract as a blocker on those gates. Deltas to both functions are
-- exactly that plus the evaluation link; everything else is byte-identical
-- to the 20261110090400/20261110090100 definitions (diffed at authoring
-- time).
--
-- Canonical reuse: lifecycle_evaluations, stage_gate_reviews.evaluation_id,
-- business_cases/options, financial_assumptions, development_baselines,
-- development_success_contracts, audit_events. No new table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The evaluation record extends to case scope.
-- ---------------------------------------------------------------------------
alter table public.lifecycle_evaluations
  alter column asset_id drop not null;

alter table public.lifecycle_evaluations
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists business_case_id bigint
    references business_cases(id) on delete set null,
  add column if not exists evaluation_kind text not null default 'asset_lifecycle',
  add column if not exists expected_value numeric;

alter table public.lifecycle_evaluations
  drop constraint if exists lifecycle_evaluations_kind_allowed;
alter table public.lifecycle_evaluations
  add constraint lifecycle_evaluations_kind_allowed check
    (evaluation_kind in ('asset_lifecycle','case_value'));

alter table public.lifecycle_evaluations
  drop constraint if exists lifecycle_evaluations_subject_present;
alter table public.lifecycle_evaluations
  add constraint lifecycle_evaluations_subject_present check (
    asset_id is not null or development_case_id is not null
  );

-- A case-value evaluation carries its value and its case; an asset
-- evaluation is exactly what it always was.
alter table public.lifecycle_evaluations
  drop constraint if exists lifecycle_evaluations_case_value_shape;
alter table public.lifecycle_evaluations
  add constraint lifecycle_evaluations_case_value_shape check (
    evaluation_kind <> 'case_value'
    or (development_case_id is not null and expected_value is not null)
  );

create index if not exists idx_lifecycle_eval_case
  on lifecycle_evaluations(organization_id, development_case_id, evaluated_at desc)
  where development_case_id is not null;

-- ---------------------------------------------------------------------------
-- 1b. Immutability backstop for the recorded value record (the success-
--     contract idiom from 20261115090300, applied to the OTHER thing this
--     slice sells): case-value evaluations are the trajectory points gate
--     reviews link ($46M → $41M) and the two ends the since-sanction delta
--     stands on. Clients cannot write lifecycle_evaluations at all (the
--     table is SELECT-only under RLS); this trigger closes the remaining
--     definer/service gap so a case_value row inserted, rewritten or deleted
--     outside record_case_value_evaluation RAISES in client contexts and is
--     admitted AND audited for service callers — a sold number cannot be
--     quietly rewritten without a trail. Asset-kind evaluations keep their
--     existing behavior untouched; BEFORE DELETE returns OLD so sanctioned
--     cascades proceed.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_case_value_evaluation_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.case_value_evaluation_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_guarded boolean;
begin
  if tg_op = 'INSERT' then
    v_guarded := new.evaluation_kind = 'case_value';
  elsif tg_op = 'DELETE' then
    v_guarded := old.evaluation_kind = 'case_value';
  else
    v_guarded := old.evaluation_kind = 'case_value'
              or new.evaluation_kind = 'case_value';
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Case-value evaluation on lifecycle_evaluations ('
           || lower(tg_op) || ', row '
           || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside record_case_value_evaluation. '
           || 'A recorded evaluation is a trajectory point gate reviews linked and '
           || 'a since-sanction delta end; a rewrite of one is recorded here '
           || 'because it changes the value record the case was judged against.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'A recorded value evaluation is immutable — it is the trajectory point a '
      'gate review linked and an end the since-sanction delta stands on (spec '
      'I.4). A changed value is a NEW evaluation: record_case_value_evaluation() '
      'appends with freshly frozen inputs; the record is never rewritten.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_case_value_evaluation_immutability on public.lifecycle_evaluations;
create trigger trg_case_value_evaluation_immutability
  before insert or update or delete on public.lifecycle_evaluations
  for each row execute function public.enforce_case_value_evaluation_immutability();

revoke all on function public.enforce_case_value_evaluation_immutability() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Recording a case value evaluation. Inputs frozen SERVER-side; the
--    number arrives with its engine version and basis; refusals name what
--    is missing. Advisory preparation (the record_lifecycle_evaluation role
--    set, ai_admin included) — gates and sanction stay human-only.
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

  return jsonb_build_object('evaluation_id', v_id, 'case_id', c.id,
    'expected_value', p_expected_value,
    'note', 'Recorded with frozen inputs. It becomes a trajectory point when a gate review links it (record_case_gate_review p_evaluation_id).');
end
$$;

revoke all on function public.record_case_value_evaluation(uuid, bigint, numeric, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_case_value_evaluation(uuid, bigint, numeric, text, text, jsonb, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The trajectory (D2.02): one row per gate in framework order; a point
--    exactly where the latest review LINKS an evaluation; "not evaluated at
--    this gate" everywhere else — the words, not a copied number.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_value_trajectory(p_case_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'caseId', c.id,
    'sanction', case when c.sanctioned_at is null then null else jsonb_build_object(
      'sanctionedAt', c.sanctioned_at,
      'sanctionedValue', c.sanctioned_value) end,
    'sanctionBaselineEvaluation', (
      select jsonb_build_object('id', e.id, 'expectedValue', e.expected_value,
        'evaluatedAt', e.evaluated_at, 'basis', e.rationale,
        'uncertainty', e.uncertainty_level)
      from lifecycle_evaluations e
      where e.organization_id = c.organization_id
        and e.development_case_id = c.id and e.evaluation_kind = 'case_value'
        and c.sanctioned_at is not null and e.evaluated_at <= c.sanctioned_at
      order by e.evaluated_at desc, e.id desc limit 1),
    'anchorBaselines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'baselineType', b.baseline_type, 'version', b.version,
        'approvedAt', b.approved_at, 'description', b.description)
        order by b.baseline_type)
      from development_baselines b
      where b.development_case_id = c.id and b.organization_id = c.organization_id
        and b.baseline_type in ('BENEFITS','COST') and b.status = 'approved'
    ), '[]'::jsonb),
    'gates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'gateId', g.id,
        'gateName', g.name,
        'stageKey', g.stage_key,
        'stageSequence', s.sequence,
        'gateSequence', g.sequence,
        'decisionType', g.decision_type,
        'latestReview', case when r.id is null then null else jsonb_build_object(
          'id', r.id, 'outcome', r.outcome, 'reviewedAt', r.reviewed_at) end,
        'evaluated', r.evaluation_id is not null,
        'point', case when e.id is null then null else jsonb_build_object(
          'evaluationId', e.id,
          'expectedValue', e.expected_value,
          'evaluatedAt', e.evaluated_at,
          'basis', e.rationale,
          'uncertainty', e.uncertainty_level) end,
        'note', case
          when r.id is null then 'not evaluated at this gate — no review recorded'
          when r.evaluation_id is null then 'not evaluated at this gate'
          else null end)
        order by s.sequence, g.sequence, g.name)
      from stage_gates g
      join project_framework_stages s
        on s.framework_id = g.framework_id and s.stage_key = g.stage_key
      left join lateral (
        select r2.id, r2.outcome, r2.reviewed_at, r2.evaluation_id
        from stage_gate_reviews r2
        where r2.organization_id = c.organization_id
          and r2.development_case_id = c.id and r2.gate_id = g.id
        order by r2.reviewed_at desc, r2.id desc limit 1
      ) r on true
      left join lifecycle_evaluations e
        on e.id = r.evaluation_id and e.organization_id = c.organization_id
       and e.evaluation_kind = 'case_value'
      where g.framework_id = c.framework_id
    ), '[]'::jsonb),
    'evaluations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'expectedValue', e.expected_value,
        'evaluatedAt', e.evaluated_at, 'basis', e.rationale,
        'uncertainty', e.uncertainty_level,
        'linkedToReview', exists (
          select 1 from stage_gate_reviews lr
          where lr.evaluation_id = e.id and lr.organization_id = c.organization_id))
        order by e.evaluated_at)
      from lifecycle_evaluations e
      where e.organization_id = c.organization_id
        and e.development_case_id = c.id and e.evaluation_kind = 'case_value'
    ), '[]'::jsonb))
  from development_cases c
  where c.id = p_case_id and c.organization_id = app_current_org();
$$;

revoke all on function public.get_case_value_trajectory(uuid) from public, anon;
grant execute on function public.get_case_value_trajectory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The since-sanction delta (D2.05): both ends or no delta. Scalar
--    dimensions present in BOTH frozen input sets diff; a dimension absent
--    on either end is named as not comparable with the missing side stated.
-- ---------------------------------------------------------------------------
create or replace function public.get_since_sanction_delta(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  base lifecycle_evaluations%rowtype;
  cur lifecycle_evaluations%rowtype;
  v_dims jsonb := '[]'::jsonb;
  v_not_comparable jsonb := '[]'::jsonb;
  v_anchors jsonb;
  dim record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.sanctioned_at is null then
    return jsonb_build_object('caseId', c.id, 'available', false,
      'reason', 'this case is not sanctioned — there is no sanction moment to diff against');
  end if;

  select * into base from lifecycle_evaluations
  where organization_id = v_org and development_case_id = c.id
    and evaluation_kind = 'case_value' and evaluated_at <= c.sanctioned_at
  order by evaluated_at desc, id desc limit 1;
  if not found then
    return jsonb_build_object('caseId', c.id, 'available', false,
      'reason', 'no value evaluation was recorded at or before sanction — the sanction baseline is absent and cannot be reconstructed after the fact');
  end if;

  select * into cur from lifecycle_evaluations
  where organization_id = v_org and development_case_id = c.id
    and evaluation_kind = 'case_value'
  order by evaluated_at desc, id desc limit 1;
  if cur.id = base.id then
    return jsonb_build_object('caseId', c.id, 'available', false,
      'sanctionBaseline', jsonb_build_object('evaluationId', base.id,
        'expectedValue', base.expected_value, 'evaluatedAt', base.evaluated_at),
      'reason', 'no value evaluation has been recorded since sanction — the delta needs both ends');
  end if;

  -- Scalar dimensions: diff where both ends recorded them.
  for dim in
    select * from (values
      ('expected_value',       to_jsonb(base.expected_value),                       to_jsonb(cur.expected_value)),
      ('discount_rate',        base.inputs->'discountRate',                          cur.inputs->'discountRate'),
      ('hypothesis_spend',     base.inputs->'hypothesis'->'spend',                   cur.inputs->'hypothesis'->'spend'),
      ('hypothesis_value_per_year', base.inputs->'hypothesis'->'valuePerYear',       cur.inputs->'hypothesis'->'valuePerYear'),
      ('viability_floor',      base.inputs->'viabilityFloor',                        cur.inputs->'viabilityFloor')
    ) as t(name, base_v, cur_v)
  loop
    if dim.base_v is null or jsonb_typeof(dim.base_v) = 'null'
       or dim.cur_v is null or jsonb_typeof(dim.cur_v) = 'null' then
      v_not_comparable := v_not_comparable || jsonb_build_object(
        'dimension', dim.name,
        'reason', case
          when (dim.base_v is null or jsonb_typeof(dim.base_v) = 'null')
           and (dim.cur_v is null or jsonb_typeof(dim.cur_v) = 'null')
            then 'not recorded at either end'
          when dim.base_v is null or jsonb_typeof(dim.base_v) = 'null'
            then 'missing at the sanction baseline'
          else 'missing in the current evaluation' end);
    else
      v_dims := v_dims || jsonb_build_object(
        'dimension', dim.name,
        'atSanction', dim.base_v,
        'current', dim.cur_v,
        'delta', (dim.cur_v)::text::numeric - (dim.base_v)::text::numeric);
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'baselineType', b.baseline_type, 'version', b.version,
      'approvedAt', b.approved_at, 'description', b.description, 'content', b.content)
      order by b.baseline_type), '[]'::jsonb)
  into v_anchors
  from development_baselines b
  where b.development_case_id = c.id and b.organization_id = v_org
    and b.baseline_type in ('BENEFITS','COST') and b.status = 'approved';

  return jsonb_build_object(
    'caseId', c.id,
    'available', true,
    'sanctionedAt', c.sanctioned_at,
    'sanctionedValue', c.sanctioned_value,
    'anchorBaselines', v_anchors,
    'sanctionBaseline', jsonb_build_object('evaluationId', base.id,
      'expectedValue', base.expected_value, 'evaluatedAt', base.evaluated_at,
      'basis', base.rationale, 'uncertainty', base.uncertainty_level),
    'current', jsonb_build_object('evaluationId', cur.id,
      'expectedValue', cur.expected_value, 'evaluatedAt', cur.evaluated_at,
      'basis', cur.rationale, 'uncertainty', cur.uncertainty_level),
    'dimensions', v_dims,
    'notComparable', v_not_comparable);
end
$$;

revoke all on function public.get_since_sanction_delta(uuid) from public, anon;
grant execute on function public.get_since_sanction_delta(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. record_case_gate_review, re-created from its 20261110090400 definition
--    with the evaluation link (D2.02) and the contract-before-design refusal
--    (D1.02). The defaulted p_evaluation_id changes the signature, so the
--    old signature is dropped first (the 20261110090100 set_gate_requirement
--    precedent). Every other check is byte-identical — assembled from the
--    prior definition by exact string replacement at authoring time.
-- ---------------------------------------------------------------------------
drop function if exists public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb);

create or replace function public.record_case_gate_review(
  p_case_id uuid,
  p_gate_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_conditions jsonb default '[]'::jsonb,
  p_evaluation_id uuid default null
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
  g stage_gates%rowtype;
  v_review_id bigint;
  v_mandatory_total int;
  v_criteria_total int;
  v_unmet text[];
  f jsonb;
  cond jsonb;
  v_cond_count int := 0;
  v_finding_count int := 0;
  v_seen_criteria text[] := '{}';
  v_owner uuid;
  v_conditions_text text;
  v_design_order int;
  v_gate_order int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'a gate decision is a §70 human determination — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'recording a gate decision requires a governance or engineering role');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'gates are not recordable on a ' || c.status || ' case');
  end if;

  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- D2.02: a review may LINK the value evaluation it was taken on. The link
  -- is validated here and never inferred — a trajectory point exists exactly
  -- where a review recorded one.
  if p_evaluation_id is not null and not exists (
    select 1 from lifecycle_evaluations e
    where e.id = p_evaluation_id and e.organization_id = v_org
      and e.development_case_id = c.id and e.evaluation_kind = 'case_value'
  ) then
    return jsonb_build_object('error',
      'that evaluation is not a value evaluation of this case — record one with record_case_value_evaluation and link it here');
  end if;

  if p_outcome in ('pass','pass_with_conditions') then
    return jsonb_build_object('error',
      'case gate reviews use the reconciled vocabulary — record ''proceed'' or ''proceed_with_conditions''');
  end if;
  if p_outcome not in ('proceed','proceed_with_conditions','hold','recycle','pivot','redesign','pause','terminate') then
    return jsonb_build_object('error',
      'outcome must be one of proceed, proceed_with_conditions, hold, recycle, pivot, redesign, pause, terminate');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for this gate decision (20 characters minimum)');
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    return jsonb_build_object('error', 'findings must be a json array');
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return jsonb_build_object('error', 'conditions must be a json array');
  end if;

  -- Slice-1 segregation minimum on independent-assurance gates.
  if g.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      'this gate requires independent assurance: the case sponsor or creator cannot record its decision (segregation of duties)');
  end if;

  -- D1.02 (spec I.3): success is established BEFORE design begins.
  -- Placed AFTER the segregation check deliberately: on an assurance gate a
  -- conflicted recorder is refused for the conflict first — who may record
  -- precedes what the record needs. A gate of
  -- a design-or-later stage cannot PASS while the case has no recorded
  -- success contract. Master stage order is the one stage vocabulary
  -- (ruling 2); 'design' anchors the boundary.
  if p_outcome in ('proceed','proceed_with_conditions') then
    select stage_order into v_design_order from lifecycle_stages where stage_key = 'design';
    select stage_order into v_gate_order from lifecycle_stages where stage_key = g.stage_key;
    if v_gate_order is not null and v_design_order is not null
       and v_gate_order >= v_design_order
       and not exists (
         select 1 from development_success_contracts sc
         where sc.development_case_id = c.id and sc.status = 'recorded'
       ) then
      return jsonb_build_object('error',
        'success is established before design begins (spec I.3): no recorded success contract exists on this case, so a design-or-later gate cannot pass — draft one (draft_success_contract), state its outcomes with owners and bases, and record it (record_success_contract)');
    end if;
  end if;

  -- Validate findings before anything is written.
  for f in select * from jsonb_array_elements(p_findings) loop
    if coalesce(btrim(f->>'criterion_text'), '') = '' then
      return jsonb_build_object('error', 'every finding names its criterion (criterion_text)');
    end if;
    if btrim(f->>'criterion_text') = any(v_seen_criteria) then
      return jsonb_build_object('error',
        format('duplicate finding for criterion "%s" — a review carries exactly one finding per criterion, because two findings on one criterion is a contradiction the gate would have to resolve silently', btrim(f->>'criterion_text')));
    end if;
    v_seen_criteria := v_seen_criteria || btrim(f->>'criterion_text');
    if coalesce(f->>'status', '') not in ('met','not_met','not_assessed') then
      return jsonb_build_object('error', 'finding status must be met, not_met or not_assessed');
    end if;
    if f ? 'criterion_id' and nullif(f->>'criterion_id','') is not null and not exists (
      select 1 from stage_gate_criteria sc
      where sc.id = (f->>'criterion_id')::bigint
        and sc.organization_id = v_org and sc.gate_id = p_gate_id
    ) then
      return jsonb_build_object('error', 'finding references a criterion that does not belong to this gate');
    end if;
    v_finding_count := v_finding_count + 1;
  end loop;

  -- THE MANDATORY BLOCK (assessGate's discipline, repeated at the DB).
  select count(*), count(*) filter (where is_mandatory)
    into v_criteria_total, v_mandatory_total
  from stage_gate_criteria
  where organization_id = v_org and gate_id = p_gate_id;

  if p_outcome in ('proceed','proceed_with_conditions') then
    if v_criteria_total = 0 then
      return jsonb_build_object('error',
        'this gate defines no criteria, so it can block nothing — define what it requires before recording a proceed through it');
    end if;
    select coalesce(array_agg(sc.criterion), '{}') into v_unmet
    from stage_gate_criteria sc
    where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory
      and not exists (
        select 1 from jsonb_array_elements(p_findings) pf
        where btrim(pf->>'criterion_text') = btrim(sc.criterion)
          and pf->>'status' = 'met'
      );
    if array_length(v_unmet, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot record %s: %s mandatory criterion/criteria are not explicitly met in this review — silence and not-assessed block for the same reason a failure does', p_outcome, array_length(v_unmet, 1)),
        'unmet_mandatory', to_jsonb(v_unmet));
    end if;
  end if;

  -- Conditions: exactly with a conditional proceed, never otherwise.
  if p_outcome = 'proceed_with_conditions' then
    if jsonb_array_length(p_conditions) = 0 then
      return jsonb_build_object('error',
        'proceed_with_conditions requires at least one condition, each with owner, due date, evidence requirement and consequence-if-missed (spec II.16)');
    end if;
    for cond in select * from jsonb_array_elements(p_conditions) loop
      if coalesce(length(btrim(cond->>'description')), 0) < 10 then
        return jsonb_build_object('error', 'each condition states what must be done (10 characters minimum)');
      end if;
      v_owner := nullif(cond->>'owner_id','')::uuid;
      if v_owner is null or not exists (
        select 1 from user_profiles up where up.id = v_owner and up.organization_id = v_org
      ) then
        return jsonb_build_object('error', 'each condition names an owner who is a member of this organization');
      end if;
      if nullif(cond->>'due_date','') is null then
        return jsonb_build_object('error', 'each condition carries a due date');
      end if;
      if (cond->>'due_date')::date < current_date then
        return jsonb_build_object('error', 'a condition cannot be born overdue — its due date is today or later');
      end if;
      if coalesce(length(btrim(cond->>'evidence_requirement')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the evidence that will close it');
      end if;
      if coalesce(length(btrim(cond->>'consequence_if_missed')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the consequence if it is missed');
      end if;
      v_cond_count := v_cond_count + 1;
    end loop;
  elsif jsonb_array_length(p_conditions) > 0 then
    return jsonb_build_object('error', 'conditions attach to a proceed_with_conditions outcome only');
  end if;

  if p_outcome = 'proceed_with_conditions' then
    select string_agg(btrim(x->>'description'), '; ') into v_conditions_text
    from jsonb_array_elements(p_conditions) x;
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.gate_review_write', 'granted', true);

  insert into stage_gate_reviews
    (organization_id, development_case_id, gate_id, stage_key, outcome,
     conditions, reviewed_by, reviewed_at, note, evaluation_id)
  values
    (v_org, c.id, g.id, g.stage_key, p_outcome,
     v_conditions_text, auth.uid(), now(), btrim(p_note), p_evaluation_id)
  returning id into v_review_id;

  insert into stage_gate_findings
    (organization_id, review_id, criterion_id, criterion_text, status, evidence)
  select v_org, v_review_id,
         nullif(x->>'criterion_id','')::bigint,
         btrim(x->>'criterion_text'),
         x->>'status',
         nullif(btrim(coalesce(x->>'evidence','')), '')
  from jsonb_array_elements(p_findings) x;

  insert into gate_conditions
    (organization_id, review_id, description, owner_id, due_date,
     evidence_requirement, consequence_if_missed)
  select v_org, v_review_id,
         btrim(x->>'description'),
         (x->>'owner_id')::uuid,
         (x->>'due_date')::date,
         btrim(x->>'evidence_requirement'),
         btrim(x->>'consequence_if_missed')
  from jsonb_array_elements(p_conditions) x;

  perform set_config('app.gate_review_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_gate_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('review_id', v_review_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name, 'decision_type', g.decision_type, 'outcome', p_outcome,
      'findings', v_finding_count, 'conditions', v_cond_count,
      'evaluation_id', p_evaluation_id));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Gate decision "%s" recorded on %s (%s) for case %s as role %s.',
            p_outcome, g.name, g.decision_type, c.title, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'review_id', v_review_id, 'outcome', p_outcome,
    'gate', g.name, 'decision_type', g.decision_type,
    'findings_recorded', v_finding_count, 'conditions_recorded', v_cond_count);
end
$$;

revoke all on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. get_gate_readiness, re-created from its 20261110090100 definition with
--    ONE delta: the D1.02 success-contract blocker (and its summary) on
--    design-or-later gates — the same predicate the record RPC refuses on,
--    named on the panel before anyone attempts the review. Everything else
--    is byte-identical (assembled by exact string replacement at authoring
--    time). Same signature; CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
create or replace function public.get_gate_readiness(
  p_case_id uuid,
  p_gate_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  g stage_gates%rowtype;
  v_review_id bigint;
  v_reviewed_at timestamptz;
  v_outcome text;
  v_criteria jsonb;
  v_categories jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_criteria_total int;
  v_mandatory_total int;
  v_mandatory_met int;
  v_remaining int;
  v_weight_sum numeric;
  v_weighted_met numeric;
  v_readiness numeric;
  v_blocked boolean;
  v_events int;
  v_span_days numeric;
  v_first_closure timestamptz;
  v_last_closure timestamptz;
  v_rate numeric;
  v_projection jsonb;
  v_evidence jsonb;
  v_design_order int;
  v_gate_order int;
  v_contract jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- The operative review: latest wins (the same ordering the gate blockers
  -- enforce against).
  select r.id, r.reviewed_at, r.outcome into v_review_id, v_reviewed_at, v_outcome
  from stage_gate_reviews r
  where r.organization_id = v_org
    and r.development_case_id = c.id and r.gate_id = g.id
  order by r.reviewed_at desc, r.id desc
  limit 1;

  -- Per-criterion rows: text-matched to the latest review's findings, the
  -- record RPC's own matching rule — one finding per criterion, latest wins
  -- (the header's fan-out rule; a plain join would multiply every count by
  -- the number of duplicate findings).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', sc.id,
      'criterion', sc.criterion,
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
      'isMandatory', sc.is_mandatory,
      'weight', sc.weight,
      'sourceAuthority', sc.source_authority,
      'evidenceType', sc.evidence_type,
      'status', coalesce(fi.status, 'never_assessed'),
      'findingEvidence', fi.evidence,
      'deliverables', (
        select jsonb_build_object(
          'total', count(*),
          'accepted', count(*) filter (where d.status = 'accepted'))
        from develop_deliverables d
        where d.requirement_id = sc.id and d.development_case_id = c.id
          and d.organization_id = v_org))
      order by sc.sort_order, sc.criterion), '[]'::jsonb),
    count(*),
    count(*) filter (where sc.is_mandatory),
    count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') = 'met'),
    count(*) filter (where coalesce(fi.status, '') <> 'met'),
    coalesce(sum(sc.weight), 0),
    coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
  into v_criteria, v_criteria_total, v_mandatory_total, v_mandatory_met,
       v_remaining, v_weight_sum, v_weighted_met
  from stage_gate_criteria sc
  left join lateral (
    select f.status, f.evidence
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id;

  -- GR = Σ(w·r)/Σw. Null — not 0, not 100 — when the gate defines nothing:
  -- 0/0 is not a readiness, and rendering one would be an invented number.
  v_readiness := case when v_weight_sum > 0
    then round((v_weighted_met / v_weight_sum) * 100, 1) end;

  -- BLOCKED (spec §45): a mandatory criterion not explicitly met — including
  -- never assessed — blocks at ANY percentage. A gate with no criteria
  -- blocks because it can block nothing (assessGate's refusal, repeated).
  v_blocked := v_criteria_total = 0 or v_mandatory_met < v_mandatory_total;

  -- Per-category rollup: §44 seven first, others after, uncategorized LAST
  -- and visible.
  select coalesce(jsonb_agg(row_obj order by cat_rank, category), '[]'::jsonb)
  into v_categories
  from (
    select
      coalesce(nullif(btrim(sc.category), ''), 'uncategorized') as category,
      case coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
        when 'business' then 1 when 'technical' then 2 when 'risk' then 3
        when 'cost_schedule' then 4 when 'operations' then 5
        when 'supply' then 6 when 'regulatory' then 7
        when 'uncategorized' then 99 else 50 end as cat_rank,
      jsonb_build_object(
        'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
        'criteriaTotal', count(*),
        'mandatoryTotal', count(*) filter (where sc.is_mandatory),
        'metCount', count(*) filter (where coalesce(fi.status, '') = 'met'),
        'unmetMandatory', count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') <> 'met'),
        'weightSum', coalesce(sum(sc.weight), 0),
        'readinessPct', case when coalesce(sum(sc.weight), 0) > 0
          then round((coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
                      / sum(sc.weight)) * 100, 1) end
      ) as row_obj
    from stage_gate_criteria sc
    left join lateral (
      select f.status
      from stage_gate_findings f
      where f.review_id = v_review_id
        and btrim(f.criterion_text) = btrim(sc.criterion)
      order by f.id desc
      limit 1
    ) fi on true
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
  ) grouped;

  -- Named blockers: unmet mandatory criteria + unresolved High/Critical case
  -- risks + open conditions on this case. Each named and typed; none invented.
  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'mandatory_criterion',
      'id', sc.id,
      'name', sc.criterion,
      'status', coalesce(fi.status, 'never_assessed'),
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'))
      order by sc.sort_order, sc.criterion), '[]'::jsonb)
  into v_blockers
  from stage_gate_criteria sc
  left join lateral (
    select f.status
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id
    and sc.is_mandatory and coalesce(fi.status, '') <> 'met';

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_risk',
      'id', r.id,
      'name', r.title,
      'level', r.current_risk_level,
      'status', r.status)
      order by case r.current_risk_level when 'Critical' then 0 else 1 end, r.title), '[]'::jsonb)
  into v_blockers
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id
    and r.current_risk_level in ('High', 'Critical')
    and r.status not in ('closed', 'archived', 'accepted');

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_condition',
      'id', gc.id,
      'name', gc.description,
      'dueDate', gc.due_date,
      'overdue', gc.due_date < current_date,
      'gate', g2.name)
      order by gc.due_date), '[]'::jsonb)
  into v_blockers
  from gate_conditions gc
  join stage_gate_reviews r2 on r2.id = gc.review_id
  left join stage_gates g2 on g2.id = r2.gate_id
  where gc.organization_id = v_org
    and r2.development_case_id = c.id
    and gc.status = 'open';

  -- D1.02: on a design-or-later gate, a missing recorded success contract is
  -- a NAMED blocker — the same predicate record_case_gate_review refuses a
  -- proceed on, displayed before it refuses (enforced truth = displayed
  -- truth). The contract summary rides along for the panel.
  select stage_order into v_design_order from lifecycle_stages where stage_key = 'design';
  select stage_order into v_gate_order from lifecycle_stages where stage_key = g.stage_key;
  select jsonb_build_object(
      'id', sc.id, 'version', sc.version, 'recordedAt', sc.recorded_at,
      'outcomes', (select count(*) from development_success_outcomes o where o.contract_id = sc.id),
      'dimensionsCovered', (select count(distinct o.dimension) from development_success_outcomes o where o.contract_id = sc.id))
  into v_contract
  from development_success_contracts sc
  where sc.development_case_id = c.id and sc.organization_id = v_org
    and sc.status = 'recorded';
  if v_gate_order is not null and v_design_order is not null
     and v_gate_order >= v_design_order and v_contract is null then
    v_blockers := v_blockers || jsonb_build_object(
      'type', 'success_contract',
      'id', c.id,
      'name', 'No recorded success contract — success is established before design begins (spec I.3); this gate cannot pass until one is recorded',
      'status', 'missing');
  end if;

  -- Case evidence summary — display support only; the readiness number never
  -- consumes it, so an unverified AI inference cannot move anything (§70).
  select jsonb_build_object(
    'total', count(*),
    'verified', count(*) filter (where e.verification_status = 'verified'),
    'rejected', count(*) filter (where e.verification_status = 'rejected'),
    'unverified', count(*) filter (where e.verification_status = 'unverified'),
    'aiInferenceUnverified', count(*) filter
      (where e.evidence_class = 'AI_INFERENCE' and e.verification_status <> 'verified'))
  into v_evidence
  from evidence_items e
  where e.organization_id = v_org and e.development_case_id = c.id;

  -- The closure-rate projection, with its refusal (header: the derivation).
  select count(*), min(closed_at), max(closed_at)
  into v_events, v_first_closure, v_last_closure
  from (
    select min(r.reviewed_at) as closed_at
    from stage_gate_criteria sc
    join stage_gate_findings fi
      on btrim(fi.criterion_text) = btrim(sc.criterion) and fi.status = 'met'
    join stage_gate_reviews r
      on r.id = fi.review_id
     and r.organization_id = v_org
     and r.development_case_id = c.id and r.gate_id = g.id
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by sc.id
  ) closures;

  v_span_days := case when v_events >= 2
    then extract(epoch from (v_last_closure - v_first_closure)) / 86400.0 end;

  if v_remaining = 0 and v_criteria_total > 0 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', 0,
      'reason', 'nothing remaining — every criterion is met on the latest review');
  elsif v_events < 3 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'reason', format('not yet: %s of 3 closure events recorded for this gate''s criteria — a rate is an average of intervals, and fewer than three closures gives it nothing defensible to average', v_events));
  elsif v_span_days < 1 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 3),
      'reason', 'not yet: the recorded closures span less than one day — a date-granularity projection cannot stand on a sub-day history');
  else
    v_rate := (v_events - 1) / v_span_days;
    -- Days-to-close is computed as remaining·span/(events−1) — algebraically
    -- remaining/rate, but with ONE division instead of two: dividing by the
    -- already-divided rate lets numeric representation error (2/(2/13) =
    -- 13.000…033) leak through ceil() as a whole extra day.
    v_projection := jsonb_build_object(
      'available', true,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 2),
      'ratePerDay', round(v_rate, 4),
      'projectedDate', (greatest(now(), v_last_closure)
        + make_interval(days => ceil(v_remaining * v_span_days / (v_events - 1))::int))::date);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'gateId', g.id,
    'gateName', g.name,
    'decisionType', g.decision_type,
    'readinessThreshold', g.readiness_threshold,
    'blocked', v_blocked,
    'readinessPct', v_readiness,
    'weightSum', v_weight_sum,
    'criteriaTotal', v_criteria_total,
    'mandatoryTotal', v_mandatory_total,
    'mandatoryMet', v_mandatory_met,
    'latestReview', case when v_review_id is null then null else jsonb_build_object(
      'id', v_review_id, 'outcome', v_outcome, 'reviewedAt', v_reviewed_at) end,
    'criteria', v_criteria,
    'categories', v_categories,
    'blockers', v_blockers,
    'successContract', v_contract,
    'evidenceSummary', v_evidence,
    'projection', v_projection);
end
$$;

revoke all on function public.get_gate_readiness(uuid, bigint) from public, anon;
grant execute on function public.get_gate_readiness(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
