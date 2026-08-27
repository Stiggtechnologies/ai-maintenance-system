-- ============================================================================
-- Sync Develop Slice 1 — sanction as a delegated, §70-protected act
-- (D1.05 / D3.34 / D11.24).
--
-- "Project sanctioned" is one of the seven determinations the LLM never
-- makes and no client write can assert (spec §70). The machinery:
--
--   1. authority_limits gains action_type — overlap-map ruling 14: the ONE
--      authority store is EXTENDED, never twinned. 'general' is the existing
--      ladder (recommendation approval, risk acceptance ceilings), byte-for-
--      byte unchanged in meaning; 'sanction' is the new delegated right;
--      'regulatory_variance' is reserved for the Slice 3 regulatory chain.
--
--   2. Every consumer that resolves "the adopted limit for this role" gains
--      `action_type = 'general'` so an adopted sanction limit can NEVER be
--      mis-selected as a spend/risk ceiling (or vice versa). Each function is
--      re-created from its latest definition with exactly that predicate
--      added — diffed mechanically at authoring time: adopt_authority_limit,
--      enforce_authority_limit, accept_risk (both signatures),
--      decide_risk_decision, enforce_extended_risk_decision_authority,
--      enforce_extended_risk_acceptance_authority.
--
--   3. sanction_development_case() — the ONLY path to 'sanctioned'. It is
--      fail-CLOSED: no adopted sanction limit for the caller's role means no
--      sanction, administrators included — delegation of sanction authority
--      is an organizational act (adopt_authority_limit), not a platform
--      default. The ai_admin identity is refused by name: §70. The value is
--      checked against the adopted ceiling; blocking gates of the case's
--      current stage must hold passing reviews; the write happens under the
--      transaction-local marker that trg_development_sanction_provenance
--      (20261101090200) demands.
--
--   4. Draft sanction rows are seeded for executive and board so the
--      delegation EXISTS to be adopted — drafts enforce nothing and grant
--      nothing until a human adopts them with a stated instrument (the
--      20260808210000 seed discipline, kept).
-- ============================================================================

alter table public.authority_limits
  add column if not exists action_type text not null default 'general'
    check (action_type in ('general','sanction','regulatory_variance'));

create index if not exists idx_authority_limits_action
  on authority_limits(organization_id, role_key, action_type, status);

create or replace function public.adopt_authority_limit(
  p_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- Adopting a delegation of authority is itself an act of authority.
  if v_role not in ('admin', 'ai_admin', 'executive') then
    return jsonb_build_object('error',
      'adopting a delegation-of-authority limit requires an executive or administrator');
  end if;

  select * into l from authority_limits
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'limit not found');
  end if;
  if l.status <> 'draft' then
    return jsonb_build_object('error', 'only drafts can be adopted');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'state the delegation instrument this limit comes from (10 characters minimum)');
  end if;

  update authority_limits
  set status = 'superseded', superseded_by = l.id
  where organization_id = l.organization_id and role_key = l.role_key
    and action_type = l.action_type
    and status = 'adopted';

  update authority_limits
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = basis || ' | Adopted: ' || trim(p_note)
  where id = l.id;

  return jsonb_build_object('adopted', l.id, 'role_key', l.role_key);
end
$$;

grant execute on function public.adopt_authority_limit(uuid, text) to authenticated;

create or replace function public.enforce_authority_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  l authority_limits%rowtype;
  e engineering_approval_rules%rowtype;
  v_accept risk_acceptances%rowtype;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  -- E4.06: engineering sign-off is required of everyone, administrators
  -- included. It is a competence requirement, not a permission one.
  if new.change_class is not null then
    select * into e from engineering_approval_rules
    where organization_id = new.organization_id and change_class = new.change_class;
    if found and new.engineering_signed_at is null then
      raise exception
        'Engineering approval: "%" requires sign-off by the % role before approval.',
        e.title, e.required_role using errcode = 'check_violation';
    end if;
  end if;

  if v_role in ('admin', 'ai_admin') then
    return new;   -- platform administration is audited separately
  end if;

  select * into l from authority_limits
  where organization_id = new.organization_id
    and role_key = v_role and action_type = 'general' and status = 'adopted'
  order by version desc limit 1;

  if not found then
    return new;   -- the organization has not delegated in amounts yet
  end if;

  if l.max_commitment_usd is not null then
    if new.estimated_cost_usd is null then
      raise exception
        'Delegation of authority: % holds a % ceiling of $%; this recommendation states no cost, so authority cannot be verified. Record estimated_cost_usd or escalate to %.',
        v_role, l.tier_label, l.max_commitment_usd, coalesce(l.escalates_to_role, 'a higher authority')
        using errcode = 'check_violation';
    end if;
    if new.estimated_cost_usd > l.max_commitment_usd then
      raise exception
        'Delegation of authority: $% exceeds the % ceiling of $% for %. Escalate to %.',
        new.estimated_cost_usd, l.tier_label, l.max_commitment_usd, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  if l.max_risk_level is not null and new.risk_impact is not null
     and risk_rank(new.risk_impact) > risk_rank(l.max_risk_level) then
    -- E4.04: an active, unexpired acceptance signed by someone whose own
    -- ceiling covers this risk is the legitimate way past the ceiling. Without
    -- one, the ceiling holds.
    select * into v_accept from risk_acceptances
    where organization_id = new.organization_id
      and subject_type = 'recommendation' and subject_id = new.id
      and status = 'active' and expires_at > now()
      and risk_rank(risk_level) >= risk_rank(new.risk_impact)
    order by accepted_at desc limit 1;

    if not found then
      raise exception
        'Delegation of authority: % risk exceeds the % ceiling of % for %. Escalate to %, or record a risk acceptance signed at that level.',
        new.risk_impact, l.tier_label, l.max_risk_level, v_role,
        coalesce(l.escalates_to_role, 'the board')
        using errcode = 'check_violation';
    end if;
  end if;

  new.authority_cleared_by := auth.uid();
  new.authority_cleared_at := now();
  return new;
end
$$;

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
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
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

  -- THE THRESHOLD. Who may accept what is already stated in the delegation
  -- ladder; this reads it rather than inventing a second answer.
  select * into l from authority_limits
  where organization_id = v_org and role_key = v_role and action_type = 'general'
    and status = 'adopted'
  order by version desc limit 1;

  if found and l.max_risk_level is not null
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
      'subject_type', p_subject_type, 'expires_at', p_expires_at));

  return jsonb_build_object('acceptance_id', v_id, 'expires_at', p_expires_at,
    'ceiling_checked', found);
end
$$;

grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz) to authenticated;

create or replace function public.accept_risk(
  p_subject_type text,
  p_subject_id uuid,
  p_risk_level text,
  p_rationale text,
  p_compensating_controls text,
  p_expires_at timestamptz,
  p_reassessment_trigger text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  l authority_limits%rowtype;
  r risks%rowtype;
  v_id uuid;
  v_missing text[]:='{}';
  item text;
begin
  if p_subject_type <> 'risk' then
    return jsonb_build_object('error','the seven-argument acceptance contract is for subject_type risk');
  end if;
  select * into r from risks where id=p_subject_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','risk not found in this organization'); end if;
  select role into v_role from user_profiles where id=auth.uid();
  if v_role is null then return jsonb_build_object('error','forbidden'); end if;
  if risk_rank(p_risk_level)=0 then return jsonb_build_object('error','invalid risk level'); end if;
  if coalesce(length(btrim(p_rationale)),0)<20 then
    return jsonb_build_object('error','state why the residual risk is acceptable');
  end if;
  if coalesce(length(btrim(p_compensating_controls)),0)<20 then
    return jsonb_build_object('error','state the compensating controls');
  end if;
  if coalesce(length(btrim(p_reassessment_trigger)),0)<10 then
    return jsonb_build_object('error','record a measurable reassessment trigger');
  end if;
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 year' then
    return jsonb_build_object('error','acceptance must expire in the future and within one year');
  end if;
  if r.residual_risk_level is null or risk_rank(p_risk_level)<risk_rank(r.residual_risk_level) then
    return jsonb_build_object('error','acceptance level cannot understate recorded residual risk');
  end if;
  select * into l from authority_limits where organization_id=v_org
    and role_key=v_role and action_type='general' and status='adopted' order by version desc limit 1;
  if not found then
    return jsonb_build_object('error','no adopted authority limit exists for your role');
  end if;
  if l.max_risk_level is not null and risk_rank(p_risk_level)>risk_rank(l.max_risk_level) then
    return jsonb_build_object('error',format('%s risk exceeds the %s ceiling of %s for your role. Escalate to %s.',
      p_risk_level,l.tier_label,l.max_risk_level,coalesce(l.escalates_to_role,'the board')));
  end if;
  if l.max_exposure is not null and coalesce(r.exposure,0)>l.max_exposure then
    return jsonb_build_object('error','risk exposure exceeds the adopted ceiling for your role');
  end if;
  if jsonb_array_length(l.risk_kinds)>0 and not (l.risk_kinds ? r.kind) then
    return jsonb_build_object('error','your adopted authority does not cover this risk kind');
  end if;
  for item in select jsonb_array_elements_text(l.required_competency_keys) loop
    if not exists(
      select 1 from workforce_members wm
      join member_competencies mc on mc.member_id=wm.id
      join competencies c on c.id=mc.competency_id
      where wm.organization_id=v_org and wm.user_id=auth.uid() and wm.active
        and c.competency_key=item
        and (mc.expires_on is null or mc.expires_on>=current_date)
    ) then v_missing:=array_append(v_missing,'competency: '||item); end if;
  end loop;
  if array_length(v_missing,1)>0 then
    return jsonb_build_object('error','acceptor is not qualified','gaps',v_missing);
  end if;
  insert into risk_acceptances (
    organization_id,subject_type,subject_id,risk_level,rationale,
    compensating_controls,accepted_by,accepted_role,expires_at,review_at,
    reassessment_trigger
  ) values (
    v_org,'risk',r.id,p_risk_level,btrim(p_rationale),btrim(p_compensating_controls),
    auth.uid(),v_role,p_expires_at,least(p_expires_at-interval '30 days',
      coalesce(r.review_date::timestamptz,p_expires_at-interval '30 days')),
    btrim(p_reassessment_trigger)
  ) returning id into v_id;
  update risks set decision_action='ACCEPT',status='monitoring',
    escalation_threshold=btrim(p_reassessment_trigger),
    review_date=least(coalesce(review_date,p_expires_at::date),(p_expires_at-interval '30 days')::date),
    updated_at=now() where id=r.id;
  update decisions set approval_status='approved',human_actor=auth.uid()::text,
    acceptance_expires_at=p_expires_at,reassessment_trigger=btrim(p_reassessment_trigger)
  where risk_id=r.id and risk_decision_action='ACCEPT' and approval_status='pending';
  update approvals set status='approved',approver=auth.uid()::text,decided_at=now(),
    reason=coalesce(reason,'') || ' Residual risk acceptance ' || v_id::text || ' recorded.'
  where risk_id=r.id and status in ('required','pending');
  insert into audit_events (organization_id,entity_type,actor,event_data)
  values (v_org,'risk_acceptance',v_role,jsonb_build_object('acceptance_id',v_id,
    'risk_id',r.id,'risk_level',p_risk_level,'expires_at',p_expires_at,
    'reassessment_trigger',p_reassessment_trigger,'authority_limit_id',l.id));
  return jsonb_build_object('acceptance_id',v_id,'risk_id',r.id,
    'expires_at',p_expires_at,'review_at',least(p_expires_at-interval '30 days',
      coalesce(r.review_date::timestamptz,p_expires_at-interval '30 days')),
    'ceiling_checked',true,'authority_limit_id',l.id);
end;
$$;
grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz, text) to authenticated, service_role;

create or replace function public.decide_risk_decision(
  p_decision_id uuid,
  p_approve boolean,
  p_note text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid:=app_current_org();
  v_role text;
  d decisions%rowtype;
  r risks%rowtype;
  a approvals%rowtype;
  l authority_limits%rowtype;
  v_missing text[]:='{}';
  item text;
begin
  select role into v_role from user_profiles where id=auth.uid();
  select * into d from decisions where id=p_decision_id and organization_id=v_org
    and risk_id is not null and approval_status='pending';
  if not found then return jsonb_build_object('error','pending risk decision not found'); end if;
  select * into r from risks where id=d.risk_id and organization_id=v_org;
  select * into a from approvals where decision_id=d.id and organization_id=v_org
    and status in ('required','pending') order by created_at desc limit 1;
  if not found then return jsonb_build_object('error','canonical approval record not found'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','record the approval or rejection basis');
  end if;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role
    and action_type='general' and status='adopted' order by version desc limit 1;
  if not found then v_missing:=array_append(v_missing,'adopted authority limit');
  else
    if l.max_risk_level is not null and risk_rank(r.current_risk_level)>risk_rank(l.max_risk_level) then
      v_missing:=array_append(v_missing,'risk level exceeds role ceiling'); end if;
    if l.max_exposure is not null and coalesce(r.exposure,0)>l.max_exposure then
      v_missing:=array_append(v_missing,'exposure exceeds role ceiling'); end if;
    if jsonb_array_length(l.risk_kinds)>0 and not (l.risk_kinds ? r.kind) then
      v_missing:=array_append(v_missing,'role is not authorized for this risk kind'); end if;
    for item in select jsonb_array_elements_text(l.required_competency_keys) loop
      if not exists(
        select 1 from workforce_members wm
        join member_competencies mc on mc.member_id=wm.id
        join competencies c on c.id=mc.competency_id
        where wm.organization_id=v_org and wm.user_id=auth.uid() and wm.active
          and c.competency_key=item
          and (mc.expires_on is null or mc.expires_on>=current_date)
      ) then v_missing:=array_append(v_missing,'competency: '||item); end if;
    end loop;
  end if;
  if p_approve and array_length(v_missing,1)>0 then
    return jsonb_build_object('error','approver is not qualified','gaps',v_missing,
      'required_role',a.owner_role);
  end if;
  update decisions set approval_status=case when p_approve then 'approved' else 'rejected' end,
    human_actor=auth.uid()::text,rationale=coalesce(rationale,'')||' | Human decision: '||btrim(p_note),
    outcome_status=case when p_approve then 'executed' else 'reverted' end
  where id=d.id;
  update approvals set status=case when p_approve then 'approved' else 'rejected' end,
    approver=auth.uid()::text,reason=coalesce(reason,'')||' '||btrim(p_note),decided_at=now()
  where id=a.id;
  if not p_approve then
    update risks set decision_action='INVESTIGATE',status='analyzed',updated_at=now() where id=r.id;
  elsif d.risk_decision_action='MONITOR' then
    update risks set status='monitoring',updated_at=now() where id=r.id;
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_decision',v_role,jsonb_build_object('risk_id',r.id,'decision_id',d.id,
    'approved',p_approve,'note',btrim(p_note),'authority_limit_id',l.id));
  return jsonb_build_object('decision_id',d.id,'approved',p_approve,
    'risk_status',case when not p_approve then 'analyzed'
      when d.risk_decision_action='MONITOR' then 'monitoring' else r.status end,
    'residual_acceptance_required',p_approve and d.risk_decision_action='ACCEPT');
end;
$$;
grant execute on function public.decide_risk_decision(uuid, boolean, text) to authenticated, service_role;

create or replace function public.enforce_extended_risk_decision_authority()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; r risks%rowtype; c risk_criteria_profiles%rowtype;
  l authority_limits%rowtype; v_criticality text; v_value numeric;
begin
  if new.risk_id is null or new.approval_status<>'approved' or old.approval_status='approved' then return new; end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into r from risks where id=new.risk_id and organization_id=v_org;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role
    and action_type='general' and status='adopted'
    order by version desc limit 1;
  if not found then raise exception 'extended authority: adopted authority limit not found'; end if;
  if jsonb_array_length(l.jurisdictions)>0 and
     (c.jurisdiction is null or not (l.jurisdictions ? c.jurisdiction)) then
    raise exception 'extended authority: jurisdiction is outside the approver scope'; end if;
  if r.asset_id is not null then select criticality into v_criticality from assets where id=r.asset_id and organization_id=v_org; end if;
  if jsonb_array_length(l.asset_criticality_levels)>0 and
     (v_criticality is null or not (l.asset_criticality_levels ? v_criticality)) then
    raise exception 'extended authority: asset criticality is outside the approver scope'; end if;
  v_value:=coalesce(new.decision_value,r.value_at_risk,0);
  if l.max_decision_value is not null and v_value>l.max_decision_value then
    raise exception 'extended authority: decision value exceeds the approver ceiling'; end if;
  if l.independent_assurance_above_level is not null and
     risk_rank(r.current_risk_level)>=risk_rank(l.independent_assurance_above_level) then
    if new.raised_by=auth.uid() then
      raise exception 'segregation of duties: the decision proposer cannot approve at this assurance level'; end if;
    if not exists(select 1 from risk_assurance_reviews ar where ar.organization_id=v_org
      and ar.risk_id=r.id and ar.assurance_level='independent' and ar.status='completed'
      and ar.conclusion in ('acceptable','acceptable_with_actions')) then
      raise exception 'extended authority: completed independent assurance is required'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_extended_risk_acceptance_authority()
returns trigger
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; r risks%rowtype; c risk_criteria_profiles%rowtype;
  l authority_limits%rowtype; v_criticality text;
begin
  if new.subject_type<>'risk' then return new; end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  select * into r from risks where id=new.subject_id and organization_id=v_org;
  select * into c from risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org;
  select * into l from authority_limits where organization_id=v_org and role_key=v_role
    and action_type='general' and status='adopted'
    order by version desc limit 1;
  if jsonb_array_length(l.jurisdictions)>0 and
     (c.jurisdiction is null or not (l.jurisdictions ? c.jurisdiction)) then
    raise exception 'extended authority: jurisdiction is outside the accepting authority scope'; end if;
  if r.asset_id is not null then select criticality into v_criticality from assets where id=r.asset_id and organization_id=v_org; end if;
  if jsonb_array_length(l.asset_criticality_levels)>0 and
     (v_criticality is null or not (l.asset_criticality_levels ? v_criticality)) then
    raise exception 'extended authority: asset criticality is outside the accepting authority scope'; end if;
  if l.max_decision_value is not null and coalesce(r.value_at_risk,0)>l.max_decision_value then
    raise exception 'extended authority: accepted value exceeds the authority ceiling'; end if;
  if l.independent_assurance_above_level is not null and
     risk_rank(new.risk_level)>=risk_rank(l.independent_assurance_above_level) then
    if not exists(select 1 from risk_assurance_reviews ar where ar.organization_id=v_org
      and ar.risk_id=r.id and ar.assurance_level='independent' and ar.status='completed'
      and ar.reviewer_id<>new.accepted_by
      and ar.conclusion in ('acceptable','acceptable_with_actions')) then
      raise exception 'extended authority: independent assurance by a different person is required for acceptance'; end if;
  end if;
  return new;
end;
$$;

-- The two functions whose LAST definition now lives in this file and which
-- carried no revoke before (their prior homes predate the ratchet).
revoke all on function public.adopt_authority_limit(uuid, text) from public, anon;
grant execute on function public.adopt_authority_limit(uuid, text) to authenticated;
revoke all on function public.enforce_authority_limit() from public, anon, authenticated;
revoke all on function public.accept_risk(text, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.accept_risk(text, uuid, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the sanction delegation as DRAFTS (enforce nothing until adopted).
-- ---------------------------------------------------------------------------
insert into authority_limits (organization_id, role_key, tier_label, action_type,
  max_commitment_usd, escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, 'sanction', v.usd, v.escalates, v.basis
from organizations o
cross join (values
  ('executive', 'Executive', 25000000::numeric, 'board',
   'Proposed: executive sanction authority below the board reservation. Placeholder amount — adopt only from the organization''s approved delegation of authority instrument.'),
  ('board', 'Board', null::numeric, null,
   'Proposed: sanction above the executive ceiling is reserved to the board. Reserved-matter list must come from the board charter before adoption.')
) as v(role_key, tier_label, usd, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
    and al.action_type = 'sanction'
);

-- ---------------------------------------------------------------------------
-- The sanction act itself.
-- ---------------------------------------------------------------------------
create or replace function public.sanction_development_case(
  p_case_id uuid,
  p_note text,
  p_sanctioned_value numeric default null
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
  l authority_limits%rowtype;
  v_value numeric;
  v_blockers text[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'project sanction is a §70 human determination — the AI-operator identity cannot sanction a case');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status = 'sanctioned' then
    return jsonb_build_object('error',
      format('already sanctioned on %s. A sanction is not overwritable — the record of the act stands.',
             to_char(c.sanctioned_at, 'YYYY-MM-DD')));
  end if;
  if c.status not in ('active','on_hold') then
    return jsonb_build_object('error', 'a ' || c.status || ' case cannot be sanctioned');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for the sanction decision (20 characters minimum)');
  end if;

  v_value := coalesce(p_sanctioned_value, c.estimated_capex);
  if v_value is null then
    return jsonb_build_object('error',
      'sanction states the value being committed — without one the delegation-of-authority ceiling cannot be verified');
  end if;
  if v_value < 0 then
    return jsonb_build_object('error', 'a sanctioned value cannot be negative');
  end if;

  -- FAIL-CLOSED authority. "No delegation recorded" refuses the act — the
  -- opposite default from the recommendation ceiling, deliberately: spending
  -- limits ratchet DOWN onto an org that adopts them; the RIGHT to sanction
  -- exists only where the org has delegated it.
  select * into l from authority_limits
  where organization_id = v_org and role_key = coalesce(v_role, '')
    and action_type = 'sanction' and status = 'adopted'
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',
      format('no ADOPTED sanction authority exists for the %s role in this organization. Sanction is exercised under the delegation-of-authority ladder: adopt the sanction limit (adopt_authority_limit) from your delegation instrument first.',
             coalesce(v_role, 'none')));
  end if;
  if l.max_commitment_usd is not null and v_value > l.max_commitment_usd then
    return jsonb_build_object('error',
      format('$%s exceeds the %s sanction ceiling of $%s for %s. Escalate to %s.',
             v_value, l.tier_label, l.max_commitment_usd, coalesce(v_role, 'none'),
             coalesce(l.escalates_to_role, 'the board')));
  end if;

  -- The sanction decision does not skip the gates: every gate of the case's
  -- CURRENT stage that carries mandatory criteria must hold a passing review.
  if c.framework_id is not null then
    select coalesce(array_agg(g.name), '{}') into v_blockers
    from stage_gates g
    where g.framework_id = c.framework_id
      and g.stage_key = c.current_stage_key
      and exists (select 1 from stage_gate_criteria sc
                  where sc.gate_id = g.id and sc.is_mandatory)
      and not exists (
        select 1 from stage_gate_reviews r
        where r.organization_id = v_org
          and r.development_case_id = c.id
          and r.gate_id = g.id
          and r.outcome in ('proceed','proceed_with_conditions')
      );
    if array_length(v_blockers, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot sanction: %s gate(s) of the current stage with mandatory criteria hold no passing review for this case',
               array_length(v_blockers, 1)),
        'blocking_gates', to_jsonb(v_blockers));
    end if;
  end if;

  perform set_config('app.development_sanction_write', 'granted', true);

  update development_cases
  set status = 'sanctioned',
      sanctioned_by = auth.uid(),
      sanctioned_at = now(),
      sanctioned_value = v_value,
      sanction_note = btrim(p_note),
      updated_at = now()
  where id = c.id;

  perform set_config('app.development_sanction_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'action', 'sanctioned',
      'sanctioned_value', v_value, 'ceiling', l.max_commitment_usd,
      'tier', l.tier_label));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Development case "%s" sanctioned at $%s by role %s under the %s sanction delegation.',
            c.title, v_value, coalesce(v_role, 'none'), l.tier_label));

  return jsonb_build_object('case_id', c.id, 'status', 'sanctioned',
    'sanctioned_value', v_value, 'tier', l.tier_label);
end
$$;

revoke all on function public.sanction_development_case(uuid, text, numeric) from public, anon;
grant execute on function public.sanction_development_case(uuid, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The Case Workspace read: one call, the whole position. SECURITY INVOKER —
-- every table consulted carries an org-scoped read policy, and a reader who
-- cannot see a row should not see its aggregate either. Names resolve from
-- user_profiles (org-readable), never auth.users — the auth schema is not
-- SELECTable by the authenticated role and an invoker function must not
-- need it.
-- ---------------------------------------------------------------------------
create or replace function public.get_development_case(p_case_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'status', c.status,
    'lifecycleType', c.lifecycle_type,
    'problemStatement', c.problem_statement,
    'opportunityStatement', c.opportunity_statement,
    'businessUnit', c.business_unit,
    'estimatedCapex', c.estimated_capex,
    'expectedValue', c.expected_value,
    'currentStageKey', c.current_stage_key,
    'createdAt', c.created_at,
    'sponsor', (select coalesce(p.full_name, p.email) from user_profiles p
                 where p.id = c.sponsor_id),
    'sanction', case when c.sanctioned_at is null then null else jsonb_build_object(
      'sanctionedAt', c.sanctioned_at,
      'sanctionedValue', c.sanctioned_value,
      'note', c.sanction_note,
      'by', (select coalesce(p.full_name, p.email) from user_profiles p
              where p.id = c.sanctioned_by)) end,
    'framework', case when c.framework_id is null then null else (
      select jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version,
        'source', f.source, 'sourceAuthority', f.source_authority, 'status', f.status)
      from project_frameworks f where f.id = c.framework_id) end,
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stageKey', s.stage_key,
        'displayName', s.display_name,
        'sequence', s.sequence,
        'purpose', s.purpose,
        'isCurrent', s.stage_key = c.current_stage_key,
        'gates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'sequence', g.sequence,
            'decisionType', g.decision_type,
            'independentAssuranceRequired', g.independent_assurance_required,
            'readinessThreshold', g.readiness_threshold,
            'criteria', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sc.id, 'criterion', sc.criterion,
                'isMandatory', sc.is_mandatory, 'guidance', sc.guidance,
                'category', sc.category, 'evidenceType', sc.evidence_type,
                'minimumConfidence', sc.minimum_confidence,
                'sourceAuthority', sc.source_authority)
                order by sc.sort_order, sc.criterion)
              from stage_gate_criteria sc where sc.gate_id = g.id
            ), '[]'::jsonb),
            'latestReview', (
              select jsonb_build_object(
                'id', r.id, 'outcome', r.outcome, 'reviewedAt', r.reviewed_at,
                'note', r.note,
                'findings', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'criterion', fi.criterion_text, 'status', fi.status,
                    'evidence', fi.evidence))
                  from stage_gate_findings fi where fi.review_id = r.id
                ), '[]'::jsonb),
                'conditions', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', gc.id, 'description', gc.description,
                    'dueDate', gc.due_date, 'status', gc.status,
                    'evidenceRequirement', gc.evidence_requirement,
                    'consequenceIfMissed', gc.consequence_if_missed,
                    'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                               where p.id = gc.owner_id))
                    order by gc.due_date)
                  from gate_conditions gc where gc.review_id = r.id
                ), '[]'::jsonb))
              from stage_gate_reviews r
              where r.development_case_id = c.id and r.gate_id = g.id
              order by r.reviewed_at desc limit 1))
            order by g.sequence, g.name)
          from stage_gates g
          where g.framework_id = c.framework_id and g.stage_key = s.stage_key
        ), '[]'::jsonb))
        order by s.sequence)
      from project_framework_stages s
      where s.framework_id = c.framework_id
    ), '[]'::jsonb)
  )
  from development_cases c
  where c.id = p_case_id and c.organization_id = app_current_org();
$$;

revoke all on function public.get_development_case(uuid) from public, anon;
grant execute on function public.get_development_case(uuid) to authenticated;

notify pgrst, 'reload schema';
