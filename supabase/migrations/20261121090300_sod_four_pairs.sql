-- ============================================================================
-- Sync Develop Slice 3B — the four segregation-of-duties pairs, refused at
-- the database (D3.33, spec III.§42) and independence enforcement at project
-- scope (D3.17, spec II.15).
--
-- THE FOUR PAIRS AND WHERE EACH ACT LIVES TODAY (the register demands the
-- act's real home, not a table invented to host the rule):
--
--   1. AUTHOR ≠ INDEPENDENT ASSURER — live since 20260921110102:293 as a
--      row-local check on risk_assurance_reviews plus the RPC refusal. THIS
--      FILE EXTENDS IT TO PROJECT SCOPE (D3.17): subject_type gains
--      'development_case', the RPC forces subject_owner_id from the case's
--      own accountable pair (sponsor, else creator — the same pair every
--      independence rule in this family already uses:
--      case_binding_gate_demands, record_case_gate_review), and a trigger
--      enforces reviewer ∉ {sponsor, creator} for independent case reviews
--      CROSS-TABLE, which a row-local check cannot see. The trigger raises
--      for every caller — a conflicted assurance row is corrupt data, not a
--      provenance question (the 20261120090000 tree-integrity posture).
--
--   2. REQUESTER ≠ FINAL APPROVER — anchored on the develop family's final
--      approval, the sanction: development_cases carries both actors as
--      columns, so the 20260921110102:293 row-local idiom applies verbatim
--      (check below) + the RPC refusal lands in sanction_development_case
--      (re-created in 20261121090400 with the rest of the act-site family).
--      In the decisions family the pair is already enforced WHERE POLICY
--      REQUIRES IT (§42's own qualifier) by
--      enforce_extended_risk_decision_authority (20260921110102:1883 — the
--      proposer cannot approve above the adopted assurance threshold); this
--      file does not widen that policy choice into an unconditional rule
--      the spec does not state for decisions.
--
--   3. CONTRACTOR ≠ OWNER ACCEPTANCE — the acceptance act that is LIVE
--      today is deliverable acceptance (accept_deliverable,
--      20261105090100: the producing owner cannot accept their own work —
--      RPC-refused since Slice 1). This file adds the missing DB check so a
--      direct write cannot mint what the RPC refuses. Contract-package /
--      commercial acceptance is Slice 7 territory (supplier_management has
--      no acceptance actor column today — acceptance_tests carries only
--      witnessed_by_owner); the register row records that remainder
--      honestly rather than inventing an actor column nothing writes.
--
--   4. TREATMENT OWNER ≠ RISK ACCEPTOR — treatments ride the canonical
--      recommendation model (ruling: D5.25) and carry treatment_owner_id
--      (20260921110101:468); acceptance lives on risk_acceptances. The
--      trigger below refuses an acceptance recorded BY the owner of a
--      treatment of that same subject — cross-table, so a trigger, not a
--      check; unconditional, because a self-accepted treatment is corrupt
--      governance data whoever writes it; INSERT OR UPDATE, because a
--      re-pointed accepted_by is the same conflict minted with a different
--      verb (bookkeeping updates that change no attribution pass through).
--      The same trigger is the §70 persistence backstop: the AI-operator
--      identity cannot stand as any acceptance's recorded acceptor. Both
--      accept_risk signatures are re-created with the named refusals and
--      the D3.32 scope-aware ladder selection (marked insertions;
--      everything else byte-identical).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. D3.17 — assurance at project scope.
-- ---------------------------------------------------------------------------
alter table public.risk_assurance_reviews
  drop constraint if exists risk_assurance_reviews_subject_type_check;
alter table public.risk_assurance_reviews
  add constraint risk_assurance_reviews_subject_type_check
    check (subject_type in ('risk','control','scenario','decision','acceptance','development_case'));

create index if not exists idx_assurance_case_subject
  on risk_assurance_reviews(organization_id, subject_id, status)
  where subject_type = 'development_case';

-- The cross-table independence wall. Row-local reviewer<>subject_owner_id
-- (20260921110102:293) still holds; this adds what it cannot see — the
-- case's OWN accountable pair. Unconditional: corrupt independence data is
-- refused for clients AND the service path alike.
create or replace function public.enforce_case_assurance_independence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
begin
  if new.subject_type <> 'development_case' or new.assurance_level <> 'independent' then
    return new;
  end if;
  select * into c from development_cases where id = new.subject_id;
  if c.id is null then
    raise exception
      'independent assurance of a development case must name a case that exists'
      using errcode = 'check_violation';
  end if;
  if new.reviewer_id = c.sponsor_id or new.reviewer_id = c.created_by then
    raise exception
      'Segregation of duties (spec II.15/§42): the case sponsor or creator cannot independently assure their own case. '
      'Independence is the product — a PM assuring their own project is the exact conflict this rule exists to refuse.'
      using errcode = 'check_violation';
  end if;
  -- §70: the independent case assurance review is the act that RELEASES the
  -- composite-authority demand (20261121090400) — the exact class of
  -- gate-releasing determination reserved to humans. The AI-operator
  -- identity cannot stand as the independent assurer of a case, whoever
  -- writes the row and whatever its status.
  if exists (select 1 from user_profiles up
             where up.id = new.reviewer_id and up.role = 'ai_admin') then
    raise exception
      'Spec §70: independent assurance of a development case releases gate enforcement, '
      'so it is recorded by a human — the AI-operator identity cannot stand as the reviewer.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_case_assurance_independence() from public, anon, authenticated;

drop trigger if exists trg_case_assurance_independence on public.risk_assurance_reviews;
create trigger trg_case_assurance_independence
  before insert or update on public.risk_assurance_reviews
  for each row execute function public.enforce_case_assurance_independence();

-- record_risk_assurance_review, re-created from its 20260921110102:1626
-- definition with exactly FOUR additions (all D3.17, marked): the
-- 'development_case' subject in the vocabulary + existence branch, the
-- forced subject_owner_id from the case's accountable pair (a caller-stated
-- owner on a case subject would dodge the row-local check), the named
-- project-scope refusal, and the §70 refusal of the AI-operator identity as
-- INDEPENDENT case assurer (the review that releases the composite demand
-- is a gate-releasing determination — humans only, backstopped at the
-- persistence boundary by trg_case_assurance_independence). Everything else
-- is byte-identical — ai_admin keeps its pre-existing standing for the risk
-- family's own line-1/2/independent observations, which release nothing.
create or replace function public.record_risk_assurance_review(p_review jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_role text; v_id uuid;
  v_risk uuid:=nullif(p_review->>'risk_id','')::uuid;
  v_subject uuid:=nullif(p_review->>'subject_id','')::uuid;
  v_owner uuid:=nullif(p_review->>'subject_owner_id','')::uuid;
  v_status text:=coalesce(p_review->>'status','planned');
  v_subject_exists boolean:=false;
  -- D3.17 (20261121090300, marked insertion): the case, when the subject is one.
  v_case development_cases%rowtype;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','forbidden'); end if;
  if v_risk is not null and not exists(select 1 from risks where id=v_risk and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if p_review->>'subject_type' not in ('risk','control','scenario','decision','acceptance','development_case') or v_subject is null or
     p_review->>'assurance_level' not in ('line_1','line_2','independent') or
     coalesce(length(btrim(p_review->>'scope')),0)<10 then
    return jsonb_build_object('error','assurance subject, level and scope are required'); end if;
  if v_owner is not null and not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','subject owner not found in this organization'); end if;
  if p_review->>'subject_type'='risk' then
    select exists(select 1 from risks where id=v_subject and organization_id=v_org) into v_subject_exists;
  elsif p_review->>'subject_type'='control' then
    select exists(select 1 from risk_controls c where c.id=v_subject and c.organization_id=v_org and
      (v_risk is null or exists(select 1 from risk_control_links l where l.control_id=c.id and l.risk_id=v_risk)))
      into v_subject_exists;
  elsif p_review->>'subject_type'='scenario' then
    select exists(select 1 from scenarios where id=v_subject and organization_id=v_org
      and (v_risk is null or risk_id=v_risk)) into v_subject_exists;
  elsif p_review->>'subject_type'='decision' then
    select exists(select 1 from decisions where id=v_subject and organization_id=v_org
      and (v_risk is null or risk_id=v_risk)) into v_subject_exists;
  elsif p_review->>'subject_type'='acceptance' then
    select exists(select 1 from risk_acceptances where id=v_subject and organization_id=v_org
      and (v_risk is null or (subject_type='risk' and subject_id=v_risk))) into v_subject_exists;
  elsif p_review->>'subject_type'='development_case' then
    -- D3.17 (20261121090300, marked insertion): the project-scope subject.
    -- The subject owner is the case's OWN accountable pair, never
    -- caller-stated: sponsor, else creator — the same pair every
    -- independence rule in this family reads.
    select * into v_case from development_cases where id=v_subject and organization_id=v_org;
    v_subject_exists := v_case.id is not null;
    if v_subject_exists then
      v_owner := coalesce(v_case.sponsor_id, v_case.created_by);
    end if;
  end if;
  if not v_subject_exists then
    return jsonb_build_object('error','assurance subject not found in this organization'); end if;
  if p_review->>'subject_type'='risk' then
    if v_risk is not null and v_risk<>v_subject then
      return jsonb_build_object('error','assurance risk and subject do not match'); end if;
    v_risk:=v_subject;
  end if;
  -- D3.17/§70 (20261121090300, marked insertion): the AI-operator identity
  -- cannot record the INDEPENDENT assurance of a case — that review is what
  -- releases the composite-authority demand (20261121090400), a
  -- gate-releasing determination §70 reserves to humans. Backstopped for
  -- every writer at the persistence boundary
  -- (trg_case_assurance_independence).
  if p_review->>'subject_type'='development_case'
     and p_review->>'assurance_level'='independent'
     and v_role='ai_admin' then
    return jsonb_build_object('error',
      'independent assurance of a development case releases gate enforcement — a §70 human determination the AI-operator identity cannot record');
  end if;
  -- D3.17 (20261121090300, marked insertion): PM-of-case cannot assure the
  -- case. Named before the generic owner rule so the refusal says WHY.
  if p_review->>'subject_type'='development_case'
     and p_review->>'assurance_level'='independent'
     and (auth.uid()=v_case.sponsor_id or auth.uid()=v_case.created_by) then
    return jsonb_build_object('error',
      'segregation of duties (spec II.15): the case sponsor or creator cannot independently assure their own case — independence means someone else looks');
  end if;
  if p_review->>'assurance_level'='independent' and v_owner=auth.uid() then
    return jsonb_build_object('error','segregation of duties: independent reviewer cannot own the subject'); end if;
  if v_status='completed' and (p_review->>'conclusion' not in
      ('acceptable','acceptable_with_actions','not_acceptable','inconclusive') or
      jsonb_array_length(coalesce(p_review->'evidence_item_ids','[]'::jsonb))=0) then
    return jsonb_build_object('error','completed assurance requires a conclusion and evidence'); end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_review->'evidence_item_ids','[]'::jsonb)) x
    left join evidence_items e on e.id=x.value::uuid and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','one or more assurance evidence items are outside this organization'); end if;
  insert into risk_assurance_reviews(organization_id,risk_id,subject_type,subject_id,assurance_level,
    subject_owner_id,reviewer_id,scope,conclusion,findings,actions,evidence_item_ids,status,due_date,completed_at)
  values(v_org,v_risk,p_review->>'subject_type',v_subject,p_review->>'assurance_level',v_owner,auth.uid(),
    btrim(p_review->>'scope'),nullif(p_review->>'conclusion',''),coalesce(p_review->'findings','[]'::jsonb),
    coalesce(p_review->'actions','[]'::jsonb),coalesce(p_review->'evidence_item_ids','[]'::jsonb),v_status,
    nullif(p_review->>'due_date','')::date,case when v_status='completed' then now() end) returning id into v_id;
  if v_status='completed' and p_review->>'conclusion'='not_acceptable' and v_risk is not null then
    perform mark_risk_reassessment(v_risk,'Independent assurance found the subject unacceptable'); end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_assurance_review',v_role,jsonb_build_object('review_id',v_id,'risk_id',v_risk,
    'assurance_level',p_review->>'assurance_level','status',v_status));
  return jsonb_build_object('review_id',v_id,'status',v_status);
end;
$$;
grant execute on function public.record_risk_assurance_review(jsonb) to authenticated,service_role;
revoke execute on function public.record_risk_assurance_review(jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. REQUESTER ≠ FINAL APPROVER at the DB — the 293 idiom, row-local.
-- ---------------------------------------------------------------------------
alter table public.development_cases
  drop constraint if exists dc_sanction_requester_sod;
alter table public.development_cases
  add constraint dc_sanction_requester_sod check
    (sanctioned_by is null or created_by is null or sanctioned_by <> created_by);

comment on constraint dc_sanction_requester_sod on public.development_cases is
  'D3.33 / spec §42: the person who raised the case (requester) cannot record its sanction (final approval). RPC refusal in sanction_development_case (20261121090400); this check holds for every writer.';

-- ---------------------------------------------------------------------------
-- 3. CONTRACTOR ≠ OWNER ACCEPTANCE at the DB — the producing owner cannot
--    be the recorded acceptor (RPC-refused since 20261105090100; now a
--    check, so no direct write can mint it either).
-- ---------------------------------------------------------------------------
alter table public.develop_deliverables
  drop constraint if exists dd_producer_not_acceptor_sod;
alter table public.develop_deliverables
  add constraint dd_producer_not_acceptor_sod check
    (accepted_by is null or accepted_by <> owner_id);

comment on constraint dd_producer_not_acceptor_sod on public.develop_deliverables is
  'D3.33 / spec §42 (contractor <> owner acceptance, where the acceptance act lives today): the deliverable''s producing owner cannot be its recorded acceptor. Commercial contract acceptance lands with the Slice 7 supplier family.';

-- ---------------------------------------------------------------------------
-- 4. TREATMENT OWNER ≠ RISK ACCEPTOR — cross-table, so a trigger; the
--    subject''s treatments ride the canonical recommendation model.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_treatment_owner_not_acceptor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.accepted_by is null then
    return new;
  end if;
  -- On UPDATE, only a change of WHO accepted WHAT re-litigates (the
  -- 20261120090300 is-distinct discipline): the expiry sweep's status flip
  -- and other bookkeeping edits are not a re-attribution, and a row checked
  -- at its own recording is not re-judged against later-created treatments.
  if tg_op = 'UPDATE'
     and new.accepted_by is not distinct from old.accepted_by
     and new.subject_type is not distinct from old.subject_type
     and new.subject_id is not distinct from old.subject_id
     and new.organization_id is not distinct from old.organization_id then
    return new;
  end if;
  -- §70 backstop at the persistence boundary: accepting a risk is one of
  -- the determinations the spec reserves to humans outright. Whoever writes
  -- the row — RPC, service, raw — the AI-operator identity cannot stand as
  -- its recorded acceptor. (Both accept_risk signatures refuse the same
  -- thing by name at the door.)
  if exists (select 1 from user_profiles up
             where up.id = new.accepted_by and up.role = 'ai_admin') then
    raise exception
      'Spec §70: accepting a risk is a human determination — the AI-operator identity '
      'cannot stand as the recorded acceptor of a risk acceptance.'
      using errcode = 'check_violation';
  end if;
  if new.subject_type = 'recommendation' then
    select treatment_owner_id into v_owner
    from recommendations
    where id = new.subject_id and organization_id = new.organization_id;
    if v_owner is not null and v_owner = new.accepted_by then
      raise exception
        'Segregation of duties (spec §42): the treatment owner cannot accept the risk their own treatment answers for. '
        'Ownership of the fix and acceptance of the residual are two chairs, and one person is sitting in both.'
        using errcode = 'check_violation';
    end if;
  elsif new.subject_type = 'risk' then
    if exists (
      select 1 from recommendations r
      where r.organization_id = new.organization_id
        and r.risk_id = new.subject_id
        and r.treatment_owner_id = new.accepted_by
        and coalesce(r.status, '') not in ('rejected','dismissed')
    ) then
      raise exception
        'Segregation of duties (spec §42): the acceptor owns an active treatment of this risk and cannot also accept its residual. '
        'Escalate the acceptance to someone who does not own the fix.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_treatment_owner_not_acceptor() from public, anon, authenticated;

drop trigger if exists trg_treatment_owner_not_acceptor on public.risk_acceptances;
-- INSERT OR UPDATE, like pair 1's wall and the CHECK-constraint pairs: an
-- UPDATE that re-points accepted_by is the same conflict minted with a
-- different verb, and "for every writer" has to mean every verb too.
create trigger trg_treatment_owner_not_acceptor
  before insert or update on public.risk_acceptances
  for each row execute function public.enforce_treatment_owner_not_acceptor();

-- accept_risk (six-argument form), re-created from its 20261101090500:188
-- definition with exactly THREE additions (all marked): the treatment-owner
-- refusal, named, before the insert the trigger would refuse anyway; the
-- §70 refusal of the AI-operator identity (accepting a risk is reserved to
-- humans outright — backstopped for every writer by the pair-4 trigger);
-- and the D3.32 scope-aware ladder selection (the 20261121090100 §3 rule —
-- a node-scoped adopted general ladder governs inside its subtree only, and
-- adopted-but-covering-nothing refuses by name instead of falling back to
-- the no-ladder default). Everything else is byte-identical.
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
  -- §70 (20261121090300, marked insertion): accepting a risk is a
  -- determination the spec reserves to humans outright. Refused by name
  -- here and again at the persistence boundary for every writer
  -- (trg_treatment_owner_not_acceptor).
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

  -- D3.33 (20261121090300, marked insertion): the treatment owner cannot
  -- accept the risk their own treatment answers for. The persistence
  -- boundary (trg_treatment_owner_not_acceptor) refuses the same thing for
  -- every writer; this names it.
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

  -- THE THRESHOLD. Who may accept what is already stated in the delegation
  -- ladder; this reads it rather than inventing a second answer. D3.32
  -- (20261121090300, marked insertion): the selection honors the ladder's
  -- org-node scope — most specific covering scope wins, and adopted rows
  -- that cover no act-site refuse by name rather than falling back to the
  -- no-ladder default (scoping must never DISARM a ladder).
  select al.* into l
  from authority_limits al
  left join org_ancestry(v_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = v_org and al.role_key = v_role
    and al.action_type = 'general' and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;
  if not found and exists (
    select 1 from authority_limits
    where organization_id = v_org and role_key = v_role
      and action_type = 'general' and status = 'adopted'
  ) then
    return jsonb_build_object('error',
      format('every ADOPTED general delegation for the %s role is scoped to one organization node whose subtree does not cover this organization — adopt a delegation covering this node, or escalate the acceptance', v_role));
  end if;

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
revoke all on function public.accept_risk(text, uuid, text, text, text, timestamptz) from public, anon;

-- accept_risk (seven-argument form), re-created from its 20261101090500:266
-- definition with exactly THREE additions (all marked): the same
-- treatment-owner refusal for the risk subject, the §70 refusal of the
-- AI-operator identity, and the D3.32 scope-aware ladder selection (this
-- form was already fail-closed on a missing ladder; the scope rule adds the
-- covering-scope requirement with its own named refusal). Everything else
-- is byte-identical.
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
  -- §70 (20261121090300, marked insertion): accepting a risk is a human
  -- determination — refused by name here, backstopped at the persistence
  -- boundary (trg_treatment_owner_not_acceptor) for every writer.
  if v_role = 'ai_admin' then
    return jsonb_build_object('error',
      'accepting a residual risk is a §70 human determination — the AI-operator identity cannot record one');
  end if;
  -- D3.33 (20261121090300, marked insertion): the treatment owner cannot
  -- accept the residual of the risk their treatment answers for.
  if exists (
    select 1 from recommendations tr
    where tr.organization_id = v_org and tr.risk_id = r.id
      and tr.treatment_owner_id = auth.uid()
      and coalesce(tr.status, '') not in ('rejected','dismissed')
  ) then
    return jsonb_build_object('error',
      'segregation of duties: you own an active treatment of this risk and cannot also accept its residual — escalate the acceptance');
  end if;
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
  -- D3.32 (20261121090300, marked insertion): scope-aware selection — the
  -- 20261121090100 §3 rule, same wording as every other act site.
  select al.* into l
  from authority_limits al
  left join org_ancestry(v_org) anc on anc.node_id = al.org_node_id
  where al.organization_id=v_org and al.role_key=v_role
    and al.action_type='general' and al.status='adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;
  if not found then
    if exists (select 1 from authority_limits
               where organization_id=v_org and role_key=v_role
                 and action_type='general' and status='adopted') then
      return jsonb_build_object('error',
        format('every ADOPTED general delegation for the %s role is scoped to one organization node whose subtree does not cover this organization — adopt a delegation covering this node, or escalate the acceptance', v_role));
    end if;
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

notify pgrst, 'reload schema';
