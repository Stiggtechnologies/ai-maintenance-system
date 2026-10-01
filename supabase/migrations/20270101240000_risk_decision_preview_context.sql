-- Governed risk-decision preview context
--
-- The customer-facing analysis and treatment forms need to explain what the
-- authoritative writers will calculate before a user records the action.  A
-- preview must not select "the latest" criteria or accept caller-supplied
-- competency claims: record_risk_analysis binds to risks.criteria_profile_id,
-- and create_risk_treatment checks the canonical active workforce roster.
-- This read projection returns those exact inputs and nothing that can approve,
-- purchase, select or execute a decision.

create or replace function public.get_risk_decision_preview_context(
  p_risk_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_risk public.risks%rowtype;
  v_criteria public.risk_criteria_profiles%rowtype;
  v_active_competencies jsonb := '[]'::jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select *
  into v_risk
  from public.risks
  where id = p_risk_id
    and organization_id = v_org
    and public.can_read_risk(id);

  if not found then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;

  if v_risk.criteria_profile_id is null then
    return jsonb_build_object('error', 'risk has no bound criteria profile');
  end if;

  select *
  into v_criteria
  from public.risk_criteria_profiles
  where id = v_risk.criteria_profile_id
    and organization_id = v_org;

  if not found then
    return jsonb_build_object('error', 'bound criteria profile not found');
  end if;

  select coalesce(jsonb_agg(q.competency_key order by q.competency_key), '[]'::jsonb)
  into v_active_competencies
  from (
    select distinct c.competency_key
    from public.competencies c
    join public.member_competencies mc
      on mc.competency_id = c.id
     and mc.organization_id = v_org
    join public.workforce_members wm
      on wm.id = mc.member_id
     and wm.organization_id = v_org
     and wm.active
    where c.organization_id = v_org
      and (mc.expires_on is null or mc.expires_on >= current_date)
  ) q;

  return jsonb_build_object(
    'risk_id', v_risk.id,
    'criteria', jsonb_build_object(
      'id', v_criteria.id,
      'name', v_criteria.name,
      'status', v_criteria.status,
      'version', v_criteria.version,
      'consequence_dimensions', v_criteria.consequence_dimensions,
      'likelihood_scale', v_criteria.likelihood_scale,
      'thresholds', v_criteria.thresholds,
      'scoring_weights', v_criteria.scoring_weights,
      'decision_thresholds', v_criteria.decision_thresholds,
      'risk_capacity', v_criteria.risk_capacity,
      'time_factors', v_criteria.time_factors
    ),
    'active_competencies', v_active_competencies,
    'generated_at', now(),
    'advisory_only', true,
    'human_decision_required', true
  );
end;
$$;

comment on function public.get_risk_decision_preview_context(uuid) is
  'Sensitivity-filtered, tenant-scoped exact criteria and active-competency inputs for advisory risk analysis and treatment-readiness previews. It grants no decision or execution authority.';

grant execute on function public.get_risk_decision_preview_context(uuid)
  to authenticated, service_role;
revoke execute on function public.get_risk_decision_preview_context(uuid)
  from public, anon;

notify pgrst, 'reload schema';
