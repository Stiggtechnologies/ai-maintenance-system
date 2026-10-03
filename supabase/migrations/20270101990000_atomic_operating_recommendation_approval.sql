-- C5.24 follow-through: one governed transaction for the buyer-value loop.
--
-- The browser previously updated the recommendation, decision, approval, work
-- order, projected value and learning event in separate PostgREST requests. A
-- later refusal could therefore leave an approved recommendation with no work
-- action. This function keeps the existing canonical tables and trigger-owned
-- recommendation contract/authority checks, but makes the complete act atomic.

create or replace function public.approve_operating_recommendation(
  p_recommendation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_rec public.recommendations%rowtype;
  v_decision_id uuid;
  v_approval_id uuid;
  v_work_order_id uuid;
  v_now timestamptz := now();
  v_safety_critical boolean;
  v_exposure numeric := 0;
  v_money_match text[];
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object(
      'error',
      'recommendation approval is a named-human act; an AI identity may prepare the decision basis but may not approve it'
    );
  end if;
  if coalesce(v_role, '') not in (
    'admin', 'executive', 'maintenance_manager', 'reliability_engineer',
    'planner', 'technician', 'operator'
  ) then
    return jsonb_build_object('error', 'recommendation approval authority denied');
  end if;

  select * into v_rec
  from public.recommendations
  where id = p_recommendation_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'recommendation not found');
  end if;
  if v_rec.status <> 'pending' then
    return jsonb_build_object(
      'error',
      format('recommendation is already %s; return it to governed review before making a new approval decision', v_rec.status)
    );
  end if;

  -- These triggers remain the single authority and contract gates:
  -- trg_recommendation_contract and trg_enforce_authority_limit. Any refusal
  -- raises and rolls back every statement in this function.
  update public.recommendations
  set status = 'approved', updated_at = v_now
  where id = v_rec.id and organization_id = v_org;

  v_safety_critical := v_rec.urgency = 'critical'
    or v_rec.risk_impact = 'High';

  insert into public.decisions (
    organization_id, recommendation_id, agent_id, asset_id, decision_type,
    action_taken, approval_status, autonomy_mode, confidence_score,
    human_actor, rationale, outcome_status
  ) values (
    v_org, v_rec.id, v_rec.agent_id, v_rec.asset_id, 'work_order',
    'Approved: ' || coalesce(v_rec.action, v_rec.title), 'approved',
    case when v_safety_critical then 'conditional' else 'controlled' end,
    v_rec.confidence, auth.uid()::text, coalesce(v_rec.rationale, v_rec.issue),
    'open'
  ) returning id into v_decision_id;

  select id into v_approval_id
  from public.approvals
  where organization_id = v_org and recommendation_id = v_rec.id
  order by created_at desc
  limit 1
  for update;

  if v_approval_id is null then
    insert into public.approvals (
      organization_id, recommendation_id, status, owner_role, approver,
      reason, decided_at
    ) values (
      v_org, v_rec.id, 'approved', v_rec.accountable, auth.uid()::text,
      v_rec.title, v_now
    ) returning id into v_approval_id;
  else
    update public.approvals
    set status = 'approved', approver = auth.uid()::text, decided_at = v_now
    where id = v_approval_id and organization_id = v_org;
  end if;

  insert into public.work_orders (
    organization_id, asset_id, recommendation_id, wo_number, title,
    description, status, priority, type, risk_score, financial_exposure,
    production_impact, safety_flag, approval_required
  ) values (
    v_org, v_rec.asset_id, v_rec.id,
    'WO-' || right((extract(epoch from clock_timestamp()) * 1000)::bigint::text, 8),
    coalesce(v_rec.action, v_rec.title), coalesce(v_rec.rationale, v_rec.issue),
    case when v_safety_critical then 'approval' else 'scheduled' end,
    case
      when v_rec.urgency = 'critical' then 'critical'
      when v_rec.urgency = 'action' then 'high'
      else 'medium'
    end,
    'ai_generated', v_rec.confidence, v_rec.financial_impact,
    case
      when v_rec.urgency = 'critical' then 'High'
      when v_rec.urgency = 'action' then 'Medium'
      else 'Low'
    end,
    v_safety_critical, v_safety_critical
  ) returning id into v_work_order_id;

  select regexp_match(
    replace(coalesce(v_rec.financial_impact, v_rec.impact, ''), ',', ''),
    '\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([mMkK])?'
  ) into v_money_match;
  if v_money_match is not null then
    v_exposure := (v_money_match[1])::numeric * case
      when lower(coalesce(v_money_match[2], '')) = 'm' then 1000000
      when lower(coalesce(v_money_match[2], '')) = 'k' then 1000
      else 1
    end;
  end if;

  if v_exposure > 0 then
    insert into public.value_metrics (
      organization_id, recommendation_id, asset_id, metric_type, label,
      value, unit, status, period
    ) values (
      v_org, v_rec.id, v_rec.asset_id, 'risk_exposure_reduced',
      'Risk mitigated — ' || v_rec.title, v_exposure, 'usd', 'projected',
      'from_approval'
    );
  end if;

  insert into public.learning_events (
    organization_id, recommendation_id, asset_id, event_type, title, detail,
    expected_value, model_confidence
  ) values (
    v_org, v_rec.id, v_rec.asset_id, 'recommendation_approved',
    'Recommendation approved — ' || v_rec.title,
    'Named human approved the recommendation; work action created'
      || case when v_safety_critical
        then ' (approval-gated, safety-critical)' else '' end
      || '. Outcome is not verified — record verification when the stated method can be measured.',
    nullif(v_exposure, 0), v_rec.confidence
  );

  return jsonb_build_object(
    'recommendationId', v_rec.id,
    'workOrderId', v_work_order_id,
    'decisionId', v_decision_id,
    'approvalId', v_approval_id,
    'status', 'approved',
    'outcomeVerified', false
  );
end
$$;

revoke all on function public.approve_operating_recommendation(uuid)
  from public, anon, service_role;
grant execute on function public.approve_operating_recommendation(uuid)
  to authenticated;

comment on function public.approve_operating_recommendation(uuid) is
  'Atomically records the named-human operating-loop approval, open decision, governed work action, projected value and learning obligation. Existing recommendation contract and authority triggers remain authoritative; no outcome is marked achieved.';

notify pgrst, 'reload schema';
