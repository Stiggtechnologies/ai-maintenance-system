-- C5.17 / C5.24 integration — recommendation approval must not bypass
-- maintenance change control.
--
-- A recommendation is a decision basis, not permission to schedule
-- safety-critical work.  The operating-loop approval remains one atomic
-- transaction, but its safety-critical branch now creates the canonical
-- work_orders draft and canonical approvals request used by C5.17.  A
-- different named maintenance manager/admin must decide that request before
-- the work receives an executable schedule.

create or replace function public.route_safety_critical_work_request(
  p_request jsonb,
  p_recommendation_id uuid default null,
  p_work_type text default 'human_created',
  p_risk_score numeric default 0,
  p_financial_exposure text default null,
  p_production_impact text default 'High'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_asset uuid;
  v_date timestamptz;
  v_work uuid;
  v_approval uuid;
  v_title text := btrim(coalesce(p_request->>'title', ''));
  v_description text := btrim(coalesce(p_request->>'description', ''));
  v_reason text := btrim(coalesce(p_request->>'reason', ''));
  v_consequence text := btrim(coalesce(p_request->>'consequenceOfWrong', ''));
  v_validation text := btrim(coalesce(p_request->>'requiredValidation', ''));
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error', 'authentication required');
  end if;

  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;

  if v_role is null then
    return jsonb_build_object('error', 'named tenant member required');
  end if;
  if v_role = 'ai_admin' then
    return jsonb_build_object(
      'error',
      'the AI-operator identity cannot request or approve safety-critical work'
    );
  end if;
  if p_work_type not in ('human_created', 'ai_generated') then
    return jsonb_build_object('error', 'unsupported safety-critical work source');
  end if;

  begin
    v_asset := (p_request->>'assetId')::uuid;
    v_date := (p_request->>'proposedDate')::timestamptz;
  exception
    when invalid_text_representation or invalid_datetime_format
      or datetime_field_overflow then
      return jsonb_build_object(
        'error', 'assetId and proposedDate must be valid values'
      );
  end;

  if not exists (
    select 1 from public.assets a
    where a.id = v_asset and a.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'same-tenant asset not found');
  end if;
  if p_recommendation_id is not null and not exists (
    select 1 from public.recommendations r
    where r.id = p_recommendation_id and r.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'same-tenant recommendation not found');
  end if;
  if v_date is null or v_date <= now() then
    return jsonb_build_object('error', 'proposed work date must be in the future');
  end if;
  if length(v_title) < 8 or length(v_description) < 20
     or length(v_reason) < 20 or length(v_consequence) < 20
     or length(v_validation) < 20 then
    return jsonb_build_object(
      'error',
      'title, description, reason, consequence and validation must be substantive'
    );
  end if;

  perform set_config('app.maintenance_change_control_write', 'granted', true);

  insert into public.work_orders (
    organization_id, asset_id, recommendation_id, wo_number, title,
    description, status, priority, type, risk_score, financial_exposure,
    production_impact, safety_flag, approval_required, created_at, updated_at
  ) values (
    v_org, v_asset, p_recommendation_id,
    case when p_recommendation_id is null then 'SCW-PENDING-'
      else 'SCW-REC-' end
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
    v_title, v_description, 'approval', 'critical', p_work_type,
    coalesce(p_risk_score, 0), p_financial_exposure,
    coalesce(nullif(btrim(p_production_impact), ''), 'High'),
    true, true, now(), now()
  ) returning id into v_work;

  insert into public.approvals (
    organization_id, work_order_id, status, owner_role, reason,
    consequence_of_wrong, required_validation, decision_right_key, action_type,
    request_payload, subject_revision, requested_by
  ) values (
    v_org, v_work, 'required', 'maintenance_manager', v_reason,
    v_consequence, v_validation,
    'schedule_safety_critical_work', 'create_safety_critical_work',
    (p_request - array[
      'title', 'description', 'reason', 'consequenceOfWrong',
      'requiredValidation'
    ]::text[])
      || jsonb_build_object('proposedDate', v_date, 'assetId', v_asset),
    1, auth.uid()
  ) returning id into v_approval;

  perform set_config('app.maintenance_change_control_write', '', true);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data
  ) values (
    v_org, 'maintenance_change_request', v_role,
    jsonb_build_object(
      'approval_id', v_approval,
      'work_order_id', v_work,
      'recommendation_id', p_recommendation_id,
      'action', 'create_safety_critical_work',
      'requested_by', auth.uid(),
      'proposed_effective_at', v_date,
      'schedule_basis', p_request->>'scheduleBasis'
    )
  );

  return jsonb_build_object(
    'approval_id', v_approval,
    'work_order_id', v_work,
    'status', 'required',
    'action', 'create_safety_critical_work'
  );
end
$$;

revoke all on function public.route_safety_critical_work_request(
  jsonb, uuid, text, numeric, text, text
) from public, anon, authenticated, service_role;

comment on function public.route_safety_critical_work_request(
  jsonb, uuid, text, numeric, text, text
) is
  'Internal C5.17 writer shared by manual and recommendation-origin safety-critical work. It creates only an inert canonical work draft plus an independent maintenance-manager approval request.';

create or replace function public.request_safety_critical_work(p_request jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.route_safety_critical_work_request(
    p_request,
    null,
    'human_created',
    0,
    null,
    'High'
  );
$$;

revoke all on function public.request_safety_critical_work(jsonb)
  from public, anon, service_role;
grant execute on function public.request_safety_critical_work(jsonb)
  to authenticated;

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
  v_work_control_approval_id uuid;
  v_work_route jsonb;
  v_proposed_date timestamptz;
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
      format(
        'recommendation is already %s; return it to governed review before making a new approval decision',
        v_rec.status
      )
    );
  end if;

  v_safety_critical := lower(coalesce(v_rec.urgency, '')) = 'critical'
    or lower(coalesce(v_rec.risk_impact, '')) in ('high', 'critical')
    or lower(coalesce(v_rec.risk_impact, '')) like '%safety%';

  if v_safety_critical then
    if v_rec.asset_id is null then
      return jsonb_build_object(
        'error',
        'safety-critical recommendation approval requires a same-tenant asset'
      );
    end if;
    if v_rec.required_completion_date is null then
      return jsonb_build_object(
        'error',
        'safety-critical recommendation approval requires a completion date before work can be routed'
      );
    end if;
    -- required_completion_date is a calendar-day commitment. Route the
    -- inclusive end of that UTC day and retain the date-only source in the
    -- request payload rather than pretending the recommendation supplied a
    -- precise execution time.
    v_proposed_date := (
      v_rec.required_completion_date + time '23:59:59'
    ) at time zone 'UTC';
    if v_proposed_date <= v_now then
      return jsonb_build_object(
        'error',
        'the required completion date is no longer in the future; revise the recommendation contract before approval'
      );
    end if;
  end if;

  -- These triggers remain the single recommendation authority and contract
  -- gates. Any refusal raises and rolls back this complete transaction.
  update public.recommendations
  set status = 'approved', updated_at = v_now
  where id = v_rec.id and organization_id = v_org;

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

  if v_safety_critical then
    v_work_route := public.route_safety_critical_work_request(
      jsonb_build_object(
        'assetId', v_rec.asset_id,
        'title', coalesce(v_rec.action, v_rec.title),
        'description', coalesce(v_rec.rationale, v_rec.issue),
        'proposedDate', v_proposed_date,
        'reason', coalesce(v_rec.rationale, v_rec.issue),
        'consequenceOfWrong', v_rec.consequence_summary,
        'requiredValidation', v_rec.verification_method,
        'recommendationId', v_rec.id,
        'requiredCompletionDate', v_rec.required_completion_date,
        'scheduleBasis', 'recommendations.required_completion_date_end_of_day_utc'
      ),
      v_rec.id,
      'ai_generated',
      v_rec.confidence,
      v_rec.financial_impact,
      'High'
    );
    if v_work_route ? 'error' then
      raise exception '%', v_work_route->>'error' using errcode = 'check_violation';
    end if;
    v_work_order_id := (v_work_route->>'work_order_id')::uuid;
    v_work_control_approval_id := (v_work_route->>'approval_id')::uuid;
  else
    insert into public.work_orders (
      organization_id, asset_id, recommendation_id, wo_number, title,
      description, status, priority, type, risk_score, financial_exposure,
      production_impact, safety_flag, approval_required
    ) values (
      v_org, v_rec.asset_id, v_rec.id,
      'WO-' || right((extract(epoch from clock_timestamp()) * 1000)::bigint::text, 8),
      coalesce(v_rec.action, v_rec.title), coalesce(v_rec.rationale, v_rec.issue),
      'scheduled',
      case when v_rec.urgency = 'action' then 'high' else 'medium' end,
      'ai_generated', v_rec.confidence, v_rec.financial_impact,
      case when v_rec.urgency = 'action' then 'Medium' else 'Low' end,
      false, false
    ) returning id into v_work_order_id;
  end if;

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
        then ' as a non-executable safety-critical draft requiring an independent maintenance-manager decision'
        else '' end
      || '. Outcome is not verified — record verification when the stated method can be measured.',
    nullif(v_exposure, 0), v_rec.confidence
  );

  return jsonb_build_object(
    'recommendationId', v_rec.id,
    'workOrderId', v_work_order_id,
    'decisionId', v_decision_id,
    'approvalId', v_approval_id,
    'maintenanceControlApprovalId', v_work_control_approval_id,
    'status', 'approved',
    'workStatus', case when v_safety_critical then 'approval' else 'scheduled' end,
    'independentWorkApprovalRequired', v_safety_critical,
    'outcomeVerified', false
  );
end
$$;

revoke all on function public.approve_operating_recommendation(uuid)
  from public, anon, service_role;
grant execute on function public.approve_operating_recommendation(uuid)
  to authenticated;

comment on function public.approve_operating_recommendation(uuid) is
  'Atomically records named-human recommendation approval and downstream evidence. Safety-critical work remains an inert canonical draft until a different maintenance manager/admin decides the linked C5.17 request.';

notify pgrst, 'reload schema';
