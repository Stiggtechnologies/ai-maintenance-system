-- E4.04 — a risk acceptance is refused unless an adopted authority_limits
-- row covers the act.
--
-- The six-argument accept_risk (the /governance door) selected an adopted
-- general ladder and, when none covered the caller's role and organization,
-- inserted the acceptance anyway and reported ceiling_checked = false. The
-- seven-argument ISO 31000 form already returned
-- 'no adopted authority limit exists for your role'. This migration makes
-- the six-argument form fail closed the same way, and puts the same refusal
-- on risk_acceptances so a writer that does not go through either function
-- cannot record the row either.
--
-- What "covers" means is the existing D3.32 selection, unchanged: an adopted
-- authority_limits row for this organization and the acceptor's role, action
-- type general, org-wide or scoped to a node whose subtree contains this
-- organization. Draft and superseded rows do not cover. A covering row whose
-- max_risk_level is null is the column's existing meaning (that dimension is
-- not limited) and is not treated here as absence. A stated ceiling that the
-- acceptance exceeds is still refused.
--
-- Coordination with the open delegation work (draft PR 746, E4.03): this
-- migration does not alter authority_limits, does not replace
-- state_authority_ceiling, adopt_authority_limit, or state_general_delegation,
-- and does not read a risk_stated column. An adopted instrument that work
-- adds still satisfies this door; an unadopted draft still does not.
--
-- Canonical reuse: authority_limits, risk_acceptances, audit_events,
-- app_current_org(). No new table, queue, or approval store.

create or replace function public.accept_risk(
  p_subject_type text,
  p_subject_id uuid,
  p_risk_level text,
  p_rationale text,
  p_compensating_controls text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles
   where id = auth.uid() and organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- §70: accepting a risk is reserved to humans. The persistence trigger
  -- refuses the AI-operator identity for every writer as well.
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'accepting a residual risk is a §70 human determination — the AI-operator identity cannot record one');
  end if;
  if risk_rank(p_risk_level) = 0 then
    return jsonb_build_object('error', 'risk_level must be Low, Medium, High or Critical');
  end if;
  if coalesce(length(trim(p_rationale)), 0) < 20 then
    return jsonb_build_object('error',
      'state why this residual risk is acceptable (20 characters minimum)');
  end if;
  if coalesce(length(trim(p_compensating_controls)), 0) < 20 then
    return jsonb_build_object('error',
      'state the compensating controls that make the residual risk tolerable');
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    return jsonb_build_object('error',
      'a risk acceptance must expire — risk accepted forever is risk nobody re-examines');
  end if;
  if p_expires_at > now() + interval '1 year' then
    return jsonb_build_object('error',
      'a risk acceptance may not run beyond one year without being re-taken');
  end if;

  if p_subject_type = 'recommendation' and exists (
    select 1 from recommendations r
    where r.id = p_subject_id and r.organization_id = v_org
      and r.treatment_owner_id = auth.uid()
  ) then
    return jsonb_build_object('error',
      'segregation of duties: you own the treatment on this recommendation and cannot also accept its residual risk — escalate the acceptance');
  end if;
  if p_subject_type = 'risk' and exists (
    select 1 from recommendations r
    where r.organization_id = v_org and r.risk_id = p_subject_id
      and r.treatment_owner_id = auth.uid()
      and coalesce(r.status, '') not in ('rejected','dismissed')
  ) then
    return jsonb_build_object('error',
      'segregation of duties: you own an active treatment of this risk and cannot also accept its residual — escalate the acceptance');
  end if;

  -- The threshold is the adopted general ladder. No covering row is a
  -- refusal, not a recorded acceptance with ceiling_checked = false.
  select al.* into l
  from authority_limits al
  left join org_ancestry(v_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = v_org and al.role_key = v_role
    and al.action_type = 'general' and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;
  if not found then
    if exists (
      select 1 from authority_limits
      where organization_id = v_org and role_key = v_role
        and action_type = 'general' and status = 'adopted'
    ) then
      return jsonb_build_object('error',
        format('every ADOPTED general delegation for the %s role is scoped to one organization node whose subtree does not cover this organization — adopt a delegation covering this node, or escalate the acceptance', v_role));
    end if;
    return jsonb_build_object('error',
      'no adopted authority limit covers this risk acceptance for your role');
  end if;

  if l.max_risk_level is not null
     and risk_rank(p_risk_level) > risk_rank(l.max_risk_level) then
    return jsonb_build_object('error',
      format('%s risk exceeds the %s ceiling of %s for your role. Escalate to %s.',
        p_risk_level, l.tier_label, l.max_risk_level,
        coalesce(l.escalates_to_role, 'the board')));
  end if;

  insert into risk_acceptances (organization_id, subject_type, subject_id,
    risk_level, rationale, compensating_controls, accepted_by, accepted_role,
    expires_at, review_at)
  values (v_org, p_subject_type, p_subject_id, p_risk_level, trim(p_rationale),
    trim(p_compensating_controls), auth.uid(), v_role, p_expires_at,
    p_expires_at - interval '30 days')
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'risk_acceptance', v_role,
    jsonb_build_object('acceptance_id', v_id, 'risk_level', p_risk_level,
      'subject_type', p_subject_type, 'expires_at', p_expires_at,
      'authority_limit_id', l.id, 'ceiling_checked', true));

  return jsonb_build_object('acceptance_id', v_id, 'expires_at', p_expires_at,
    'ceiling_checked', true, 'authority_limit_id', l.id);
end
$fn$;

revoke all on function public.accept_risk(text, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz) to authenticated;

-- Persistence boundary for every writer. The expiry sweep flips status and
-- must not re-litigate a row that was checked when it was recorded. A change
-- of who accepted, what was accepted, or the level is a new act.
create or replace function public.enforce_extended_risk_acceptance_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := app_current_org();
  v_role text;
  r risks%rowtype;
  c risk_criteria_profiles%rowtype;
  l authority_limits%rowtype;
  v_cover authority_limits%rowtype;
  v_criticality text;
  v_acceptor_role text;
begin
  if tg_op <> 'UPDATE'
     or new.risk_level is distinct from old.risk_level
     or new.accepted_role is distinct from old.accepted_role
     or new.accepted_by is distinct from old.accepted_by
     or new.subject_type is distinct from old.subject_type
     or new.subject_id is distinct from old.subject_id
     or new.organization_id is distinct from old.organization_id
  then
    select up.role into v_acceptor_role
    from user_profiles up
    where up.id = new.accepted_by
      and up.organization_id = new.organization_id;
    if v_acceptor_role is null then
      raise exception
        'no adopted authority limit covers this risk acceptance: the recorded acceptor has no role in this organization'
        using errcode = 'check_violation';
    end if;
    if v_acceptor_role is distinct from new.accepted_role then
      raise exception
        'no adopted authority limit covers this risk acceptance: accepted_role does not match the recorded acceptor role in this organization'
        using errcode = 'check_violation';
    end if;
    if v_acceptor_role = 'ai_admin' then
      raise exception
        'accepting a residual risk is a §70 human determination — the AI-operator identity cannot record one'
        using errcode = 'check_violation';
    end if;

    select al.* into v_cover
    from authority_limits al
    left join org_ancestry(new.organization_id) anc on anc.node_id = al.org_node_id
    where al.organization_id = new.organization_id
      and al.role_key = v_acceptor_role
      and al.action_type = 'general'
      and al.status = 'adopted'
      and (al.org_node_id is null or anc.node_id is not null)
    order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
    limit 1;
    if not found then
      if exists (
        select 1 from authority_limits
        where organization_id = new.organization_id
          and role_key = v_acceptor_role
          and action_type = 'general'
          and status = 'adopted'
      ) then
        raise exception
          'every ADOPTED general delegation for the % role is scoped to one organization node whose subtree does not cover this organization — adopt a delegation covering this node, or escalate the acceptance',
          v_acceptor_role
          using errcode = 'check_violation';
      end if;
      raise exception
        'no adopted authority limit covers this risk acceptance for your role'
        using errcode = 'check_violation';
    end if;
    if v_cover.max_risk_level is not null
       and risk_rank(new.risk_level) > risk_rank(v_cover.max_risk_level) then
      raise exception
        '% risk exceeds the % ceiling of % for your role. Escalate to %.',
        new.risk_level, v_cover.tier_label, v_cover.max_risk_level,
        coalesce(v_cover.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  -- Extended dimensions, unchanged from 20261101090500, and still only for a
  -- risk subject. A status-only update (the expiry sweep) reaches here
  -- without repeating the covering-row check above.
  if new.subject_type <> 'risk' then
    return new;
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  select * into r from risks where id = new.subject_id and organization_id = v_org;
  select * into c from risk_criteria_profiles where id = r.criteria_profile_id and organization_id = v_org;
  select * into l from authority_limits where organization_id = v_org and role_key = v_role
    and action_type = 'general' and status = 'adopted'
    order by version desc limit 1;
  if jsonb_array_length(l.jurisdictions) > 0 and
     (c.jurisdiction is null or not (l.jurisdictions ? c.jurisdiction)) then
    raise exception 'extended authority: jurisdiction is outside the accepting authority scope';
  end if;
  if r.asset_id is not null then
    select criticality into v_criticality from assets where id = r.asset_id and organization_id = v_org;
  end if;
  if jsonb_array_length(l.asset_criticality_levels) > 0 and
     (v_criticality is null or not (l.asset_criticality_levels ? v_criticality)) then
    raise exception 'extended authority: asset criticality is outside the accepting authority scope';
  end if;
  if l.max_decision_value is not null and coalesce(r.value_at_risk, 0) > l.max_decision_value then
    raise exception 'extended authority: accepted value exceeds the authority ceiling';
  end if;
  if l.independent_assurance_above_level is not null and
     risk_rank(new.risk_level) >= risk_rank(l.independent_assurance_above_level) then
    if not exists (
      select 1 from risk_assurance_reviews ar
      where ar.organization_id = v_org
        and ar.risk_id = r.id
        and ar.assurance_level = 'independent'
        and ar.status = 'completed'
        and ar.reviewer_id <> new.accepted_by
        and ar.conclusion in ('acceptable', 'acceptable_with_actions')
    ) then
      raise exception 'extended authority: independent assurance by a different person is required for acceptance';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function public.enforce_extended_risk_acceptance_authority() from public, anon, authenticated;

notify pgrst, 'reload schema';
