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
      and mc.granted_on <= current_date
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

-- ---------------------------------------------------------------------------
-- The preview is sensitivity-filtered, so the authoritative writers it feeds
-- must apply the same boundary.  These legacy SECURITY DEFINER functions were
-- organization-scoped but did not call can_read_risk and did not restrict the
-- human role.  Renaming preserves the one canonical implementation of each
-- calculation/write; the public signature becomes a guarded door in front of
-- it.  The internal functions are executable only by their owner.
-- ---------------------------------------------------------------------------

alter function public.record_risk_analysis(uuid, jsonb)
  rename to record_risk_analysis_authoritative_internal;
revoke all on function public.record_risk_analysis_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.record_risk_analysis(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording risk analysis requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  return public.record_risk_analysis_authoritative_internal(p_risk_id, p_analysis);
end;
$$;

comment on function public.record_risk_analysis(uuid, jsonb) is
  'Sensitivity- and human-role-gated door to the canonical multidimensional risk-analysis writer.';
revoke all on function public.record_risk_analysis(uuid, jsonb) from public, anon;
grant execute on function public.record_risk_analysis(uuid, jsonb)
  to authenticated, service_role;

alter function public.record_risk_value_of_information(uuid, jsonb)
  rename to record_risk_value_of_information_authoritative_internal;
revoke all on function public.record_risk_value_of_information_authoritative_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.record_risk_value_of_information(
  p_risk_id uuid,
  p_analysis jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording value of information requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  return public.record_risk_value_of_information_authoritative_internal(
    p_risk_id,
    p_analysis
  );
end;
$$;

comment on function public.record_risk_value_of_information(uuid, jsonb) is
  'Sensitivity- and human-role-gated door to the canonical value-of-information writer.';
revoke all on function public.record_risk_value_of_information(uuid, jsonb)
  from public, anon;
grant execute on function public.record_risk_value_of_information(uuid, jsonb)
  to authenticated, service_role;

alter function public.create_risk_treatment(uuid, jsonb, boolean)
  rename to create_risk_treatment_authoritative_internal;
revoke all on function public.create_risk_treatment_authoritative_internal(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.create_risk_treatment(
  p_risk_id uuid,
  p_option jsonb,
  p_select boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_required jsonb := coalesce(p_option->'required_competencies', '[]'::jsonb);
  v_competency_gaps jsonb := '[]'::jsonb;
  v_result jsonb;
  v_scenario_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer') then
    return jsonb_build_object('error',
      'recording risk treatment requires an authorized human risk-management role');
  end if;
  if not exists (
    select 1 from public.risks
    where id = p_risk_id and organization_id = v_org
      and public.can_read_risk(p_risk_id)
  ) then
    return jsonb_build_object('error', 'risk not available to this user');
  end if;
  if jsonb_typeof(v_required) <> 'array' then
    return jsonb_build_object('error', 'required_competencies must be an array');
  end if;

  -- The canonical writer already refuses absent and expired holdings.  This
  -- query isolates the only false-positive it admitted: an active person's
  -- unexpired qualification whose grant date is still in the future.
  select coalesce(
    jsonb_agg('competency: ' || required.competency_key order by required.competency_key),
    '[]'::jsonb
  )
  into v_competency_gaps
  from (
    select distinct requirement.competency_key
    from jsonb_array_elements_text(v_required) requirement(competency_key)
    where exists (
      select 1
      from public.competencies c
      join public.member_competencies mc
        on mc.competency_id = c.id
       and mc.organization_id = v_org
      join public.workforce_members wm
        on wm.id = mc.member_id
       and wm.organization_id = v_org
       and wm.active
      where c.organization_id = v_org
        and c.competency_key = requirement.competency_key
        and mc.granted_on > current_date
        and (mc.expires_on is null or mc.expires_on >= current_date)
    )
    and not exists (
      select 1
      from public.competencies c
      join public.member_competencies mc
        on mc.competency_id = c.id
       and mc.organization_id = v_org
      join public.workforce_members wm
        on wm.id = mc.member_id
       and wm.organization_id = v_org
       and wm.active
      where c.organization_id = v_org
        and c.competency_key = requirement.competency_key
        and mc.granted_on <= current_date
        and (mc.expires_on is null or mc.expires_on >= current_date)
    )
  ) required;

  if p_select and jsonb_array_length(v_competency_gaps) > 0 then
    return jsonb_build_object(
      'selected', false,
      'error', 'treatment is not executable',
      'readiness_gaps', v_competency_gaps
    );
  end if;

  v_result := public.create_risk_treatment_authoritative_internal(
    p_risk_id,
    p_option,
    p_select
  );

  -- Non-selected options are valid evidence even when not executable.  Make
  -- the persisted scenario and returned contract agree with the current-date
  -- competency rule the preview applies.
  if jsonb_array_length(v_competency_gaps) > 0 then
    v_scenario_id := nullif(v_result->>'scenario_id', '')::uuid;
    if v_scenario_id is not null then
      update public.scenarios
      set executable = false,
          readiness_gaps = coalesce(readiness_gaps, '[]'::jsonb)
            || v_competency_gaps
      where id = v_scenario_id and organization_id = v_org;

      insert into public.audit_events (
        organization_id,
        entity_type,
        actor,
        event_data,
        previous_state,
        new_state
      ) values (
        v_org,
        'risk_treatment_readiness_correction',
        v_role,
        jsonb_build_object(
          'risk_id', p_risk_id,
          'scenario_id', v_scenario_id,
          'reason', 'future-dated competency holdings are not current'
        ),
        jsonb_build_object('executable', true),
        jsonb_build_object('executable', false, 'readiness_gaps', v_competency_gaps)
      );

      v_result := v_result
        || jsonb_build_object(
          'executable', false,
          'readiness_gaps', coalesce(v_result->'readiness_gaps', '[]'::jsonb)
            || v_competency_gaps
        );
    end if;
  end if;

  return v_result;
end;
$$;

comment on function public.create_risk_treatment(uuid, jsonb, boolean) is
  'Sensitivity- and human-role-gated door to the canonical treatment writer; future-dated qualifications never satisfy readiness.';
revoke all on function public.create_risk_treatment(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.create_risk_treatment(uuid, jsonb, boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';
