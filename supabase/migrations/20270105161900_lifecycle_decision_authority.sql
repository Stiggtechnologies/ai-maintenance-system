-- ============================================================================
-- C5.13 / C8.09 — make the repair/replace decision reachable without making
-- it broadly writable.
--
-- The lifecycle analysis and its §70 AI boundary already exist. The product
-- surface now calls this function, which exposed a second boundary that had
-- previously been hidden by zero callers: for low/moderate uncertainty, any
-- authenticated human role could decide. A client-side role check is useful
-- guidance, not authority. This final definition therefore makes the server
-- match the approval contract.
--
-- Canonical reuse only: lifecycle_evaluations, user_profiles, audit_events,
-- app_current_org(). No parallel approval, decision or audit model.
-- ============================================================================

create or replace function public.decide_lifecycle_evaluation(
  p_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  e lifecycle_evaluations%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  -- §70 is absolute: the AI identity may prepare an evaluation and state its
  -- uncertainty, but it may not decide what the organization does with the
  -- asset at any uncertainty level or for any outcome.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'deciding a lifecycle evaluation is a §70 human determination — the AI-operator identity records the evaluation and states its uncertainty; a human decides what the organization does about the asset');
  end if;

  -- The decision right is not "any human". Maintenance management,
  -- reliability engineering and their executive/administrative authorities
  -- are the bounded roles already used by the customer surface. Coalesce is
  -- deliberate: an absent profile must fail closed rather than pass SQL NOT IN
  -- through NULL three-valued logic.
  if coalesce(v_role, '') not in (
    'maintenance_manager',
    'reliability_engineer',
    'executive',
    'admin'
  ) then
    return jsonb_build_object('error',
      'repair/replace decisions require maintenance management, reliability engineering or executive authority');
  end if;

  select * into e
  from lifecycle_evaluations
  where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evaluation not found');
  end if;
  if e.decision is not null then
    return jsonb_build_object('error', 'this evaluation was already ' || e.decision);
  end if;
  if p_decision not in ('accepted', 'rejected', 'deferred_decision') then
    return jsonb_build_object('error',
      'decision must be accepted, rejected or deferred_decision');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'record the reasoning for this decision');
  end if;

  -- High-uncertainty acceptance remains stricter than rejection or deferral.
  -- It is visible and reviewable, never silently normalized into confidence.
  if e.uncertainty_level = 'high' and p_decision = 'accepted'
     and v_role not in ('reliability_engineer', 'executive', 'admin') then
    return jsonb_build_object('error',
      'this evaluation is high-uncertainty; accepting it requires engineering or executive authority');
  end if;

  update lifecycle_evaluations
  set decision = p_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = trim(p_note)
  where id = p_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'lifecycle_decision',
    v_role,
    jsonb_build_object(
      'evaluation_id', p_id,
      'decision', p_decision,
      'recommended', e.recommended,
      'uncertainty', e.uncertainty_level
    )
  );

  return jsonb_build_object(
    'evaluation_id', p_id,
    'decision', p_decision
  );
end
$$;

revoke all on function public.decide_lifecycle_evaluation(uuid, text, text)
  from public, anon;
grant execute on function public.decide_lifecycle_evaluation(uuid, text, text)
  to authenticated;

comment on function public.decide_lifecycle_evaluation(uuid, text, text) is
  'C5.13/C8.09: tenant-scoped human repair/replace/redesign/defer determination. AI, absent-profile and non-authority roles fail closed; no outcome executes operational or financial work.';
