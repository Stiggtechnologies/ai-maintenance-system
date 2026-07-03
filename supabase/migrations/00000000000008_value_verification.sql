-- ============================================================================
-- Value instrumentation — makes the ROI claims auditable.
--
-- 1. verify_value_metric(): a human (org member) confirms or rejects a
--    projected value metric. Verification is stamped (who/when/note) and feeds
--    the Learning Loop with the verified value — or a false_positive signal.
-- 2. get_pilot_scorecard(): live 90-day pilot scorecard computed from real
--    operating data (recommendations, decisions, work orders, value metrics).
--    No speculative tables — pure derivation, always current.
-- ============================================================================

alter table value_metrics add column if not exists verified_by uuid;
alter table value_metrics add column if not exists verified_at timestamptz;
alter table value_metrics add column if not exists verification_note text;

-- ---- Human verification of value --------------------------------------------
create or replace function public.verify_value_metric(
  p_metric_id uuid,
  p_verified boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_new_status text;
begin
  select * into m from value_metrics
  where id = p_metric_id and organization_id = app_current_org();

  if m.id is null then
    raise exception 'Value metric not found in your organization';
  end if;
  if m.status not in ('projected', 'baseline_pending_validation') then
    raise exception 'Only projected/baseline metrics can be verified (current: %)', m.status;
  end if;

  v_new_status := case when p_verified then 'verified' else 'rejected' end;

  update value_metrics set
    status = v_new_status,
    verified_by = auth.uid(),
    verified_at = now(),
    verification_note = p_note
  where id = p_metric_id;

  -- Close the learning loop: verified value or false positive.
  insert into learning_events (
    organization_id, recommendation_id, asset_id, event_type, title, detail,
    expected_value, verified_value, model_confidence
  ) values (
    m.organization_id, m.recommendation_id, m.asset_id,
    case when p_verified then 'work_completed' else 'false_positive' end,
    case when p_verified
      then 'Value verified — ' || coalesce(m.label, m.metric_type)
      else 'Value rejected — ' || coalesce(m.label, m.metric_type) end,
    coalesce(p_note,
      case when p_verified
        then 'Projected value confirmed by operator review.'
        else 'Projected value rejected by operator review — model feedback captured.' end),
    m.value,
    case when p_verified then m.value else 0 end,
    null
  );

  return jsonb_build_object(
    'metric_id', p_metric_id,
    'status', v_new_status,
    'value', m.value,
    'verified_at', now()
  );
end
$$;

revoke execute on function public.verify_value_metric(uuid, boolean, text) from public, anon;
grant execute on function public.verify_value_metric(uuid, boolean, text) to authenticated;

-- ---- Live 90-day pilot scorecard ---------------------------------------------
create or replace function public.get_pilot_scorecard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_start timestamptz;
  v_day int;
  v_recs_total int; v_recs_approved int; v_recs_pending int; v_recs_loop int;
  v_actions int;
  v_wo_total int; v_wo_gated int;
  v_verified numeric; v_projected numeric;
  v_downtime numeric;
  v_risk numeric;
begin
  if v_org is null then
    raise exception 'Not signed in to an organization';
  end if;

  select coalesce(min(created_at), now()) into v_start
    from deployment_instances where organization_id = v_org;
  v_day := least(greatest(1, (extract(epoch from now() - v_start) / 86400)::int + 1), 90);

  select count(*),
         count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'pending'),
         count(*) filter (where rationale like 'Raised by the continuous%')
    into v_recs_total, v_recs_approved, v_recs_pending, v_recs_loop
    from recommendations where organization_id = v_org;

  select count(*) into v_actions
    from autonomous_decisions
    where organization_id = v_org and status = 'executed';

  select count(*), count(*) filter (where approval_required)
    into v_wo_total, v_wo_gated
    from work_orders where organization_id = v_org;

  select coalesce(sum(value) filter (where status = 'verified' and unit = 'usd'), 0),
         coalesce(sum(value) filter (where status = 'projected' and unit = 'usd'), 0),
         coalesce(sum(value) filter (where status = 'verified' and metric_type = 'downtime_avoided'), 0),
         coalesce(sum(value) filter (where status in ('verified','projected') and metric_type = 'risk_exposure_reduced' and unit = 'usd'), 0)
    into v_verified, v_projected, v_downtime, v_risk
    from value_metrics where organization_id = v_org;

  return jsonb_build_object(
    'pilot_started_at', v_start,
    'pilot_day', v_day,
    'pilot_length_days', 90,
    'recommendations_total', v_recs_total,
    'recommendations_approved', v_recs_approved,
    'recommendations_pending', v_recs_pending,
    'recommendations_from_agent_loop', v_recs_loop,
    'acceptance_rate_pct', case when v_recs_total > 0
      then round(100.0 * v_recs_approved / v_recs_total) else 0 end,
    'autonomous_actions_executed', v_actions,
    'work_orders_total', v_wo_total,
    'work_orders_approval_gated', v_wo_gated,
    'value_verified_usd', v_verified,
    'value_projected_usd', v_projected,
    'downtime_avoided_hours', v_downtime,
    'risk_exposure_reduced_usd', v_risk
  );
end
$$;

revoke execute on function public.get_pilot_scorecard() from public, anon;
grant execute on function public.get_pilot_scorecard() to authenticated;
