-- C4.08 — evidence-linked verification closure.
--
-- Canonical reuse:
--   * recommendations carries the plan before approval;
--   * verification_obligations remains the one outcome-verification ledger;
--   * evidence_items remains the one evidence model;
--   * work_orders remains the canonical CMMS/maintenance record;
--   * approvals, learning_events and audit_events retain their existing roles.
--
-- This migration does not enable plant execution or source-system write-back.
-- A named human plans the verification, the named owner records the result,
-- and the result cites either independently validated recommendation evidence
-- or a work order imported through an active, approved, read-only CMMS path.

alter table public.recommendations
  add column if not exists verification_due_date date,
  add column if not exists verification_intended_outcome text,
  add column if not exists verification_acceptance_criteria text,
  add column if not exists verification_owner_id uuid references auth.users(id) on delete restrict,
  add column if not exists verification_planned_by uuid references auth.users(id) on delete restrict,
  add column if not exists verification_planned_at timestamptz;

alter table public.verification_obligations
  add column if not exists verification_owner_id uuid references auth.users(id) on delete restrict,
  add column if not exists work_order_id uuid references public.work_orders(id) on delete restrict,
  add column if not exists evidence_required boolean not null default false,
  add column if not exists planned_by uuid references auth.users(id) on delete restrict,
  add column if not exists planned_at timestamptz;

comment on column public.recommendations.verification_due_date is
  'C4.08: human-stated date for measuring the outcome, distinct from the action completion date. No +30-day default is accepted for a new approval.';
comment on column public.recommendations.verification_intended_outcome is
  'C4.08: human-stated outcome the approved action is expected to produce. It is distinct from consequence_summary, which remains the consequence of a wrong decision.';
comment on column public.recommendations.verification_acceptance_criteria is
  'C4.08: human-stated pass/fail or decision criterion snapshotted into the canonical verification obligation at approval.';
comment on column public.recommendations.verification_owner_id is
  'C4.08: named same-tenant human accountable for recording the outcome. The AI-operator identity is refused.';
comment on column public.verification_obligations.work_order_id is
  'C4.08: direct canonical CMMS/work-history evidence link. It is not copied into a second evidence store.';
comment on column public.verification_obligations.evidence_required is
  'C4.08 compatibility ratchet: TRUE for all open recommendation obligations and all new ones; historical completed attestations remain legible without being rewritten as evidence-backed.';

create index if not exists idx_verification_owner_open
  on public.verification_obligations(organization_id,verification_owner_id,due_date)
  where status='open';
create index if not exists idx_verification_work_order
  on public.verification_obligations(organization_id,work_order_id)
  where work_order_id is not null;

-- Every currently open recommendation loop must be explicitly planned and
-- evidence-backed before it can close. Historical completed rows are not
-- rewritten; doing so would fabricate evidence they did not carry.
update public.verification_obligations
set evidence_required=true
where recommendation_id is not null and status='open';

create or replace function public.recommendation_verification_plan_valid(
  p_organization_id uuid,
  p_recommendation_id uuid
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.recommendations r
    join public.user_profiles owner
      on owner.id=r.verification_owner_id
     and owner.organization_id=r.organization_id
     and coalesce(owner.role,'')<>'ai_admin'
    join public.user_profiles planner
      on planner.id=r.verification_planned_by
     and planner.organization_id=r.organization_id
     and coalesce(planner.role,'')<>'ai_admin'
    where r.id=p_recommendation_id
      and r.organization_id=p_organization_id
      and length(btrim(coalesce(r.verification_method,'')))>=10
      and length(btrim(coalesce(r.verification_acceptance_criteria,'')))>=20
      and length(btrim(coalesce(r.verification_intended_outcome,'')))>=10
      and r.verification_due_date is not null
      and r.verification_due_date>=greatest(
        current_date,coalesce(r.required_completion_date,current_date)
      )
      and r.verification_planned_by is not null
      and r.verification_planned_at is not null
  );
$$;

revoke all on function public.recommendation_verification_plan_valid(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.verification_obligation_plan_valid(
  p_obligation_id uuid
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.verification_obligations o
    join public.user_profiles owner
      on owner.id=o.verification_owner_id
     and owner.organization_id=o.organization_id
     and coalesce(owner.role,'')<>'ai_admin'
    join public.user_profiles planner
      on planner.id=o.planned_by
     and planner.organization_id=o.organization_id
     and coalesce(planner.role,'')<>'ai_admin'
    where o.id=p_obligation_id
      and length(btrim(coalesce(o.method,'')))>=10
      and length(btrim(coalesce(o.acceptance_criteria,'')))>=20
      and length(btrim(coalesce(o.intended_outcome,'')))>=10
      and o.due_date is not null
      and not o.due_date_assumed
      and o.planned_by is not null
      and o.planned_at is not null
  );
$$;

revoke all on function public.verification_obligation_plan_valid(uuid)
  from public,anon,authenticated,service_role;

-- New plan fields are written only through the governed planning door. Inserts
-- remain compatible with every existing producer; none may smuggle an already
-- attributed plan into a new recommendation.
create or replace function public.enforce_recommendation_verification_plan_write()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_marker text:=coalesce(current_setting('app.verification_plan_write',true),'');
begin
  if tg_op='INSERT' then
    if (new.verification_due_date is not null
        or new.verification_intended_outcome is not null
        or new.verification_acceptance_criteria is not null
        or new.verification_owner_id is not null
        or new.verification_planned_by is not null
        or new.verification_planned_at is not null)
       and v_marker<>'granted' then
      raise exception 'recommendation verification plans are recorded through record_recommendation_verification_plan by a named human';
    end if;
    return new;
  end if;

  if (new.verification_method is distinct from old.verification_method
      or new.verification_due_date is distinct from old.verification_due_date
      or new.verification_intended_outcome is distinct from old.verification_intended_outcome
      or new.verification_acceptance_criteria is distinct from old.verification_acceptance_criteria
      or new.verification_owner_id is distinct from old.verification_owner_id
      or new.verification_planned_by is distinct from old.verification_planned_by
      or new.verification_planned_at is distinct from old.verification_planned_at)
     and v_marker<>'granted' then
    raise exception 'recommendation verification plans are changed through record_recommendation_verification_plan, not by direct update';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_recommendation_verification_plan_write()
  from public,anon,authenticated;

drop trigger if exists trg_recommendation_verification_plan_write on public.recommendations;
create trigger trg_recommendation_verification_plan_write
  before insert or update on public.recommendations
  for each row execute function public.enforce_recommendation_verification_plan_write();

-- Approval/release cannot manufacture a verification horizon. Existing
-- required_completion_date is when the action is due; it is not evidence of
-- when its effect should be measured.
create or replace function public.enforce_recommendation_verification_plan_on_release()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','released','scheduled')
     and not public.recommendation_verification_plan_valid(new.organization_id,new.id) then
    raise exception
      'Approval requires an explicit verification method, acceptance criteria, outcome date at or after the action due date, and a named same-tenant human owner. SyncAI will not invent a +30-day verification date.';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_recommendation_verification_plan_on_release()
  from public,anon,authenticated;

drop trigger if exists trg_recommendation_verification_plan_on_release on public.recommendations;
create trigger trg_recommendation_verification_plan_on_release
  before update of status on public.recommendations
  for each row execute function public.enforce_recommendation_verification_plan_on_release();

-- Re-plan an existing open debt or plan a pending recommendation. The same
-- function serves both states so there is one planning door and one audit
-- vocabulary.
create or replace function public.record_recommendation_verification_plan(
  p_recommendation_id uuid,
  p_method text,
  p_acceptance_criteria text,
  p_intended_outcome text,
  p_due_date date,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_owner_role text;
  r public.recommendations%rowtype;
  o public.verification_obligations%rowtype;
  v_actioned boolean;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','verification planning is a named human act; the AI-operator identity may identify a missing plan but may not supply one');
  end if;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','verification planning requires a planning, engineering, maintenance or governance role');
  end if;
  if length(btrim(coalesce(p_method,'')))<10 then
    return jsonb_build_object('error','state a substantive verification method');
  end if;
  if length(btrim(coalesce(p_acceptance_criteria,'')))<20 then
    return jsonb_build_object('error','state substantive acceptance criteria: what measured result counts as achieved');
  end if;
  if length(btrim(coalesce(p_intended_outcome,'')))<10 then
    return jsonb_build_object('error','state the intended outcome to be tested');
  end if;
  if p_due_date is null then
    return jsonb_build_object('error','state the outcome verification date; SyncAI does not invent one');
  end if;
  select role into v_owner_role from public.user_profiles
  where id=p_owner_id and organization_id=v_org;
  if not found or coalesce(v_owner_role,'')='ai_admin' then
    return jsonb_build_object('error','select a named same-tenant human verification owner');
  end if;

  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('error','same-tenant recommendation not found');
  end if;
  if p_due_date<greatest(current_date,coalesce(r.required_completion_date,current_date)) then
    return jsonb_build_object('error','verification date must not be in the past and must be on or after the action required-completion date');
  end if;
  v_actioned:=r.status in ('approved','released','scheduled','completed');

  if v_actioned then
    select * into o from public.verification_obligations
    where organization_id=v_org and recommendation_id=r.id and status='open'
    for update;
    if not found then
      return jsonb_build_object('error','this action has no open verification obligation to plan; a completed outcome is never overwritten');
    end if;
    perform set_config('app.verification_plan_write','granted',true);
    update public.verification_obligations set
      method=btrim(p_method),
      acceptance_criteria=btrim(p_acceptance_criteria),
      intended_outcome=btrim(p_intended_outcome),
      due_date=p_due_date,
      due_date_assumed=false,
      verification_owner_id=p_owner_id,
      evidence_required=true,
      planned_by=auth.uid(),
      planned_at=now()
    where id=o.id;
    perform set_config('app.verification_plan_write','',true);
  else
    perform set_config('app.verification_plan_write','granted',true);
    update public.recommendations set
      verification_method=btrim(p_method),
      verification_acceptance_criteria=btrim(p_acceptance_criteria),
      verification_intended_outcome=btrim(p_intended_outcome),
      verification_due_date=p_due_date,
      verification_owner_id=p_owner_id,
      verification_planned_by=auth.uid(),
      verification_planned_at=now()
    where id=r.id;
    perform set_config('app.verification_plan_write','',true);
  end if;

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    v_org,'recommendation_verification_plan',v_role,
    jsonb_build_object(
      'recommendation_id',r.id,'obligation_id',o.id,
      'planned_by',auth.uid(),'verification_owner_id',p_owner_id,
      'operational_authorization',false),
    jsonb_build_object(
      'method',case when v_actioned then o.method else r.verification_method end,
      'acceptance_criteria',case when v_actioned then o.acceptance_criteria else r.verification_acceptance_criteria end,
      'intended_outcome',case when v_actioned then o.intended_outcome else r.verification_intended_outcome end,
      'due_date',case when v_actioned then o.due_date else r.verification_due_date end,
      'due_date_assumed',case when v_actioned then o.due_date_assumed else null end,
      'owner_id',case when v_actioned then o.verification_owner_id else r.verification_owner_id end),
    jsonb_build_object(
      'method',btrim(p_method),'acceptance_criteria',btrim(p_acceptance_criteria),
      'intended_outcome',btrim(p_intended_outcome),'due_date',p_due_date,
      'due_date_assumed',false,'owner_id',p_owner_id,
      'state',case when v_actioned then 'open_obligation_planned' else 'recommendation_planned' end,
      'operational_authorization',false)
  );

  return jsonb_build_object(
    'recommendationId',r.id,'obligationId',o.id,
    'method',btrim(p_method),'acceptanceCriteria',btrim(p_acceptance_criteria),
    'intendedOutcome',btrim(p_intended_outcome),'dueDate',p_due_date,
    'dueDateAssumed',false,'ownerId',p_owner_id,
    'state',case when v_actioned then 'open_obligation_planned' else 'recommendation_planned' end,
    'operationalAuthorization',false
  );
end
$$;

revoke all on function public.record_recommendation_verification_plan(uuid,text,text,text,date,uuid)
  from public,anon;
grant execute on function public.record_recommendation_verification_plan(uuid,text,text,text,date,uuid)
  to authenticated;

-- Only the planning door may move the plan on an open obligation. Completed
-- evidence/result immutability remains enforced by the existing provenance
-- trigger as well.
create or replace function public.enforce_verification_plan_write()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_marker text:=coalesce(current_setting('app.verification_plan_write',true),'');
begin
  if (new.method is distinct from old.method
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.intended_outcome is distinct from old.intended_outcome
      or new.due_date is distinct from old.due_date
      or new.due_date_assumed is distinct from old.due_date_assumed
      or new.verification_owner_id is distinct from old.verification_owner_id
      or new.evidence_required is distinct from old.evidence_required
      or new.planned_by is distinct from old.planned_by
      or new.planned_at is distinct from old.planned_at)
     and v_marker<>'granted' then
    raise exception 'verification obligation plans are changed through record_recommendation_verification_plan';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_verification_plan_write()
  from public,anon,authenticated;

drop trigger if exists trg_verification_plan_write on public.verification_obligations;
create trigger trg_verification_plan_write
  before update on public.verification_obligations
  for each row execute function public.enforce_verification_plan_write();

-- Replace the legacy trigger body. New approvals snapshot exactly the human
-- plan; they never derive verification timing from action completion.
create or replace function public.create_verification_obligation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('approved','released','scheduled') then
    if not public.recommendation_verification_plan_valid(new.organization_id,new.id) then
      raise exception 'a governed verification plan is required before approval';
    end if;
    insert into public.verification_obligations(
      organization_id,recommendation_id,asset_id,method,intended_outcome,
      due_date,due_date_assumed,acceptance_criteria,verification_owner_id,
      evidence_required,planned_by,planned_at,created_by
    ) values(
      new.organization_id,new.id,new.asset_id,btrim(new.verification_method),
      btrim(new.verification_intended_outcome),new.verification_due_date,false,
      btrim(new.verification_acceptance_criteria),new.verification_owner_id,
      true,new.verification_planned_by,new.verification_planned_at,auth.uid()
    ) on conflict(recommendation_id) do nothing;
  end if;
  return new;
end
$$;

revoke all on function public.create_verification_obligation()
  from public,anon,authenticated;

-- Eligibility is checked at the persistence wall as well as at the RPC. A
-- caller cannot turn a same-tenant row into evidence merely by knowing its id.
create or replace function public.verification_evidence_item_eligible(
  p_organization_id uuid,
  p_recommendation_id uuid,
  p_evidence_id uuid,
  p_not_before timestamptz
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select p_evidence_id is not null and exists(
    select 1
    from public.evidence_items e
    join public.approvals approval
      on approval.id=e.recommendation_provenance_approval_id
     and approval.organization_id=e.organization_id
     and approval.recommendation_id=e.recommendation_id
     and approval.status='approved'
     and approval.approver_user_id=e.recommendation_provenance_reviewed_by
     and approval.approval_scope->>'kind'='recommendation_evidence_classification'
     and approval.approval_scope->>'evidenceId'=e.id::text
     and approval.approval_scope->>'recommendationId'=e.recommendation_id::text
    where e.id=p_evidence_id
      and e.organization_id=p_organization_id
      and e.recommendation_id=p_recommendation_id
      and e.recommendation_provenance_status='validated'
      and e.recommendation_provenance_reviewed_by is not null
      and e.recommendation_provenance_reviewed_at is not null
      and e.recommendation_provenance_approval_id is not null
      and e.ts>=p_not_before
      and e.ts<=now()
  );
$$;

revoke all on function public.verification_evidence_item_eligible(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.verification_work_order_eligible(
  p_organization_id uuid,
  p_asset_id uuid,
  p_work_order_id uuid,
  p_not_before timestamptz
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select p_work_order_id is not null and p_asset_id is not null and exists(
    select 1
    from public.work_orders w
    join public.connectors c
      on c.organization_id=w.organization_id
     and c.connector_key=w.source_system
     and c.connector_type='cmms_read'
     and c.status='active'
     and c.enabled
     and c.direction='read_only'
     and not c.write_enabled
    join public.connector_entity_mappings m
      on m.organization_id=c.organization_id
     and m.connector_id=c.id
     and m.entity_type='work_order'
     and m.status='approved'
    join public.user_profiles mapping_approver
      on mapping_approver.id=m.approved_by
     and mapping_approver.organization_id=m.organization_id
     and mapping_approver.role='admin'
    where w.id=p_work_order_id
      and w.organization_id=p_organization_id
      and w.asset_id=p_asset_id
      and nullif(btrim(coalesce(w.source_system,'')),'') is not null
      and nullif(btrim(coalesce(w.external_id,'')),'') is not null
      and lower(btrim(coalesce(w.status,''))) in ('completed','closed')
      and w.completed_at is not null
      and w.completed_at>=p_not_before
      and w.completed_at<=now()
      and exists(
        select 1
        from public.ingest_staging s
        join public.connector_runs cr
          on cr.id=s.run_id
         and cr.organization_id=s.organization_id
         and cr.connector_id=s.connector_id
         and cr.entity_type='work_order'
         and cr.status in ('success','partial')
         and cr.finished_at is not null
         and cr.source_contract_hash is not null
         and cr.source_contract_hash=public.cmms_read_contract_hash(c.id)
        join public.user_profiles run_actor
          on run_actor.id=cr.triggered_by
         and run_actor.organization_id=cr.organization_id
         and run_actor.role in (
           'planner','reliability_engineer','maintenance_manager','admin'
         )
        where s.organization_id=w.organization_id
          and s.connector_id=c.id
          and s.entity_type='work_order'
          and s.external_id=w.external_id
          and s.status='accepted'
      )
  );
$$;

revoke all on function public.verification_work_order_eligible(uuid,uuid,uuid,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_verification_evidence_link()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan_marker text:=coalesce(current_setting('app.verification_plan_write',true),'');
  v_result_marker text:=coalesce(current_setting('app.verification_result_write',true),'');
begin
  if new.verification_owner_id is not null and not exists(
    select 1 from public.user_profiles p
    where p.id=new.verification_owner_id
      and p.organization_id=new.organization_id
      and coalesce(p.role,'')<>'ai_admin'
  ) then
    raise exception 'verification owner must be a named human in the same organization';
  end if;
  if new.planned_by is not null and not exists(
    select 1 from public.user_profiles p
    where p.id=new.planned_by
      and p.organization_id=new.organization_id
      and coalesce(p.role,'')<>'ai_admin'
  ) then
    raise exception 'verification planner must be a named human in the same organization';
  end if;
  if new.work_order_id is not null and not exists(
    select 1 from public.work_orders w
    where w.id=new.work_order_id and w.organization_id=new.organization_id
  ) then
    raise exception 'verification work-order evidence must belong to the same organization';
  end if;

  if tg_op='INSERT' then
    if (new.evidence_id is not null or new.work_order_id is not null)
       and v_result_marker<>'granted' then
      raise exception 'verification evidence is linked only while a named owner records the result';
    end if;
  elsif (new.evidence_id is distinct from old.evidence_id
         or new.work_order_id is distinct from old.work_order_id)
        and v_result_marker<>'granted' then
    raise exception 'verification evidence links are written through record_verification_result';
  end if;

  if new.recommendation_id is not null and new.evidence_required then
    if length(btrim(coalesce(new.method,'')))<10
       or length(btrim(coalesce(new.acceptance_criteria,'')))<20
       or length(btrim(coalesce(new.intended_outcome,'')))<10
       or new.due_date is null
       or new.due_date_assumed
       or new.verification_owner_id is null
       or new.planned_by is null
       or new.planned_at is null then
      if new.status<>'open' or v_plan_marker='granted' or v_result_marker='granted' then
        raise exception 'evidence-backed verification requires an explicit human plan before closure';
      end if;
    end if;

    if new.status='completed' then
      if (new.evidence_id is null)=(new.work_order_id is null) then
        raise exception 'a completed recommendation verification must cite exactly one validated evidence item or governed CMMS work order';
      end if;
      if new.evidence_id is not null and not public.verification_evidence_item_eligible(
        new.organization_id,new.recommendation_id,new.evidence_id,new.created_at
      ) then
        raise exception 'verification evidence must be independently validated for this exact recommendation';
      end if;
      if new.work_order_id is not null and not public.verification_work_order_eligible(
        new.organization_id,new.asset_id,new.work_order_id,new.created_at
      ) then
        raise exception 'work-order evidence must be a completed same-asset record imported through an active approved read-only CMMS path';
      end if;
    end if;
  elsif new.work_order_id is not null then
    raise exception 'CMMS work-order evidence is supported only for recommendation outcome verification';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_verification_evidence_link()
  from public,anon,authenticated;

drop trigger if exists trg_verification_evidence_link on public.verification_obligations;
create trigger trg_verification_evidence_link
  before insert or update on public.verification_obligations
  for each row execute function public.enforce_verification_evidence_link();

drop function if exists public.record_verification_result(uuid,text,text,uuid);

create or replace function public.record_verification_result(
  p_obligation_id uuid,
  p_result text,
  p_measured_note text,
  p_evidence_id uuid default null,
  p_work_order_id uuid default null
)
returns table (outcome text,"learningEventId" uuid,detail text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  o public.verification_obligations%rowtype;
  r public.recommendations%rowtype;
  d public.design_requirements%rowtype;
  v_role text;
  v_le uuid;
  v_new_status text;
  v_held boolean:=false;
  v_source text;
begin
  select * into o
  from public.verification_obligations
  where id=p_obligation_id and organization_id=v_org
  for update;
  if not found then
    return query select 'error'::text,null::uuid,
      'No such obligation in this organization.'::text;
    return;
  end if;

  select role into v_role
  from public.user_profiles
  where id=auth.uid() and organization_id=o.organization_id;
  if coalesce(v_role,'')='ai_admin' then
    return query select 'refused'::text,null::uuid,
      ('Recording a verification result is a named-human act. The AI-operator identity may report that an obligation is open, overdue or unverified; it may not decide whether the outcome was achieved.')::text;
    return;
  end if;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner','technician','operator') then
    return query select 'refused'::text,null::uuid,
      'Recording a verification result requires an accountable human role.'::text;
    return;
  end if;
  if o.status<>'open' then
    return query select 'refused'::text,null::uuid,
      format('Obligation is already %s. A verification is recorded once; a second opinion belongs in a new observation, not an overwrite.',o.status);
    return;
  end if;
  if p_result not in ('achieved','not_achieved','inconclusive') then
    return query select 'error'::text,null::uuid,
      'Result must be achieved, not_achieved or inconclusive.'::text;
    return;
  end if;
  if length(btrim(coalesce(p_measured_note,'')))<10 then
    return query select 'refused'::text,null::uuid,
      'A result with no substantive measurement is an opinion. Record what was measured, against what, and when.'::text;
    return;
  end if;

  if o.recommendation_id is not null and o.evidence_required then
    if not public.verification_obligation_plan_valid(o.id) then
      return query select 'refused'::text,null::uuid,
        'This obligation predates the governed verification plan. Record its method, acceptance criteria, intended outcome, explicit date and named owner before closing it.'::text;
      return;
    end if;
    if auth.uid() is distinct from o.verification_owner_id then
      return query select 'refused'::text,null::uuid,
        'Only the named verification owner may record this result. Reassign the open plan through the governed planning action if accountability changed.'::text;
      return;
    end if;
    if (p_evidence_id is null)=(p_work_order_id is null) then
      return query select 'refused'::text,null::uuid,
        'Select exactly one governed source: independently validated recommendation evidence or a completed work order from an active approved read-only CMMS path.'::text;
      return;
    end if;
    if p_evidence_id is not null and not public.verification_evidence_item_eligible(
      o.organization_id,o.recommendation_id,p_evidence_id,o.created_at
    ) then
      return query select 'refused'::text,null::uuid,
        'That evidence is not independently validated for this exact recommendation.'::text;
      return;
    end if;
    if p_work_order_id is not null and not public.verification_work_order_eligible(
      o.organization_id,o.asset_id,p_work_order_id,o.created_at
    ) then
      return query select 'refused'::text,null::uuid,
        'That work order is not a completed same-asset record imported through an active approved read-only CMMS path.'::text;
      return;
    end if;
  else
    if p_work_order_id is not null then
      return query select 'refused'::text,null::uuid,
        'CMMS work-order evidence is supported only for recommendation outcome verification.'::text;
      return;
    end if;
    if p_evidence_id is not null and not exists(
      select 1 from public.evidence_items e
      where e.id=p_evidence_id and e.organization_id=o.organization_id
    ) then
      return query select 'refused'::text,null::uuid,
        'That evidence item is not in this organization.'::text;
      return;
    end if;
  end if;

  if o.requirement_id is not null then
    select * into d from public.design_requirements
    where id=o.requirement_id and organization_id=o.organization_id;
    if not found then
      return query select 'error'::text,null::uuid,
        'That obligation does not resolve to a requirement in this organization.'::text;
      return;
    end if;
  end if;
  if o.recommendation_id is not null then
    select * into r from public.recommendations
    where id=o.recommendation_id and organization_id=o.organization_id;
    if not found then
      return query select 'error'::text,null::uuid,
        'That obligation does not resolve to a recommendation in this organization.'::text;
      return;
    end if;
  end if;

  v_source:=case
    when p_evidence_id is not null then 'validated evidence item '||p_evidence_id::text
    when p_work_order_id is not null then 'governed CMMS work order '||p_work_order_id::text
    else 'no evidence source required for this legacy requirement verification' end;

  if p_result='not_achieved' and o.recommendation_id is not null then
    insert into public.learning_events(
      organization_id,recommendation_id,asset_id,event_type,title,detail
    ) values(
      o.organization_id,o.recommendation_id,o.asset_id,'verification_failed',
      format('Verification failed: %s',coalesce(r.title,'recommendation')),
      format('The approved action did not produce the intended outcome. Method: %s. Acceptance criteria: %s. Measured: %s. Source: %s. Re-examine the strategy rather than repeat the same action.',
        o.method,o.acceptance_criteria,btrim(p_measured_note),v_source)
    ) returning id into v_le;
  end if;

  perform set_config('app.verification_result_write','granted',true);
  update public.verification_obligations set
    status='completed',
    result=p_result,
    measured_note=btrim(p_measured_note),
    evidence_id=case
      when recommendation_id is not null and evidence_required then p_evidence_id
      else coalesce(p_evidence_id,evidence_id) end,
    work_order_id=case
      when recommendation_id is not null and evidence_required then p_work_order_id
      else null end,
    verified_by=auth.uid(),
    verified_at=now(),
    learning_event_id=v_le
  where id=o.id and organization_id=o.organization_id;

  if o.requirement_id is not null then
    v_new_status:=public.derive_requirement_verification_status(
      d.id,d.verification_status
    );
    v_held:=(p_result='achieved' and v_new_status='failed');
    update public.design_requirements set
      verification_status=v_new_status,
      verified_at=case when v_new_status='verified' then now() else verified_at end
    where id=d.id and organization_id=o.organization_id;
  end if;
  perform set_config('app.verification_result_write','',true);

  insert into public.audit_events(
    organization_id,entity_type,actor,event_data,previous_state,new_state
  ) values(
    o.organization_id,
    case when o.requirement_id is not null
      then 'requirement_verification_result' else 'verification_result' end,
    coalesce(v_role,'unknown'),
    jsonb_build_object(
      'obligation_id',o.id,'recommendation_id',o.recommendation_id,
      'requirement_id',o.requirement_id,'result',p_result,
      'evidence_id',p_evidence_id,'work_order_id',p_work_order_id,
      'verification_owner_id',o.verification_owner_id,
      'recorded_by',auth.uid(),'learning_event_id',v_le,
      'operational_authorization',false),
    jsonb_build_object(
      'obligation_status',o.status,'result',o.result,
      'evidence_id',o.evidence_id,'work_order_id',o.work_order_id),
    jsonb_build_object(
      'obligation_status','completed','result',p_result,
      'evidence_id',p_evidence_id,'work_order_id',p_work_order_id,
      'verified_by',auth.uid(),
      'requirement_verification_status',v_new_status,
      'held_by_standing_failure',v_held,
      'operational_authorization',false)
  );

  return query select 'recorded'::text,v_le,
    case
      when v_held then
        format('Result recorded as achieved, but %s stays failed because an earlier failure has not been explicitly superseded.',d.requirement_ref)
      when p_result='achieved' then
        'Outcome verified as achieved against the recorded criteria, measurement and governed source. This loop is closed.'
      when p_result='not_achieved' and v_le is not null then
        format('Outcome not achieved. The measured result and governed source are recorded, and learning event %s carries the failure into strategy re-examination.',v_le)
      when p_result='not_achieved' then
        'Requirement not verified. The measured failure remains on record.'
      else
        'Inconclusive, with the measurement and governed source on record. The result is preserved without claiming success.'
    end;
end
$$;

revoke all on function public.record_verification_result(uuid,text,text,uuid,uuid)
  from public,anon;
grant execute on function public.record_verification_result(uuid,text,text,uuid,uuid)
  to authenticated,service_role;

comment on function public.record_verification_result(uuid,text,text,uuid,uuid) is
  'C4.08: the named verification owner records one measured result, citing exactly one independently validated recommendation evidence item or completed canonical work order from an active approved read-only CMMS path. No work or operating authority is granted.';

create or replace function public.get_verification_plan_owners()
returns table("ownerId" uuid,"fullName" text,role text)
language sql
stable
security definer
set search_path=public
as $$
  select p.id,coalesce(nullif(btrim(p.full_name),''),p.email,p.id::text),p.role
  from public.user_profiles p
  where p.organization_id=public.app_current_org()
    and coalesce(p.role,'')<>'ai_admin'
    and p.role in (
      'admin','executive','maintenance_manager','reliability_engineer',
      'planner','technician','operator'
    )
  order by coalesce(nullif(btrim(p.full_name),''),p.email,p.id::text);
$$;

revoke all on function public.get_verification_plan_owners()
  from public,anon;
grant execute on function public.get_verification_plan_owners()
  to authenticated;

create or replace function public.get_recommendation_verification_plan(
  p_recommendation_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  r public.recommendations%rowtype;
  o public.verification_obligations%rowtype;
  v_owner text;
begin
  select * into r from public.recommendations
  where id=p_recommendation_id and organization_id=v_org;
  if not found then
    return jsonb_build_object('error','same-tenant recommendation not found');
  end if;
  select * into o from public.verification_obligations
  where organization_id=v_org
    and recommendation_id=r.id
    and status='open';

  if o.id is not null then
    select coalesce(nullif(btrim(p.full_name),''),p.email,p.id::text)
    into v_owner from public.user_profiles p
    where p.id=o.verification_owner_id and p.organization_id=v_org;
    return jsonb_build_object(
      'recommendationId',r.id,'obligationId',o.id,'recommendationStatus',r.status,
      'method',o.method,'acceptanceCriteria',o.acceptance_criteria,
      'intendedOutcome',o.intended_outcome,'dueDate',o.due_date,
      'dueDateAssumed',o.due_date_assumed,'ownerId',o.verification_owner_id,
      'ownerName',v_owner,'plannedBy',o.planned_by,'plannedAt',o.planned_at,
      'planComplete',public.verification_obligation_plan_valid(o.id),
      'state','open_obligation','legacyDebt',o.planned_at is null,
      'operationalAuthorization',false
    );
  end if;

  select coalesce(nullif(btrim(p.full_name),''),p.email,p.id::text)
  into v_owner from public.user_profiles p
  where p.id=r.verification_owner_id and p.organization_id=v_org;
  return jsonb_build_object(
    'recommendationId',r.id,'obligationId',null,'recommendationStatus',r.status,
    'method',r.verification_method,
    'acceptanceCriteria',r.verification_acceptance_criteria,
    'intendedOutcome',r.verification_intended_outcome,
    'dueDate',r.verification_due_date,'dueDateAssumed',false,
    'ownerId',r.verification_owner_id,'ownerName',v_owner,
    'plannedBy',r.verification_planned_by,'plannedAt',r.verification_planned_at,
    'planComplete',public.recommendation_verification_plan_valid(v_org,r.id),
    'state',case when r.status='pending' then 'recommendation' else 'closed' end,
    'legacyDebt',false,'operationalAuthorization',false
  );
end
$$;

revoke all on function public.get_recommendation_verification_plan(uuid)
  from public,anon;
grant execute on function public.get_recommendation_verification_plan(uuid)
  to authenticated;

drop function if exists public.get_open_verifications(int);
create or replace function public.get_open_verifications(p_limit int default 25)
returns table(
  "obligationId" uuid,
  "recommendationId" uuid,
  "recommendationTitle" text,
  "assetName" text,
  method text,
  "dueDate" date,
  "dueDateAssumed" boolean,
  "daysOverdue" int,
  "intendedOutcome" text,
  "subjectKind" text,
  "requirementRef" text,
  "methodCode" text,
  "acceptanceCriteria" text,
  "verificationOwnerId" uuid,
  "verificationOwnerName" text,
  "planComplete" boolean,
  "evidenceRequired" boolean,
  "evidenceCandidates" jsonb
)
language sql
stable
security definer
set search_path=public
as $$
  select
    o.id,
    o.recommendation_id,
    coalesce(r.title,d.requirement,'requirement verification'),
    a.name,
    o.method,
    o.due_date,
    o.due_date_assumed,
    greatest(0,(current_date-o.due_date))::int,
    o.intended_outcome,
    case when o.requirement_id is not null then 'requirement' else 'recommendation' end,
    d.requirement_ref,
    o.method_code,
    o.acceptance_criteria,
    o.verification_owner_id,
    coalesce(nullif(btrim(owner.full_name),''),owner.email,owner.id::text),
    public.verification_obligation_plan_valid(o.id),
    o.evidence_required,
    case when o.recommendation_id is null or not o.evidence_required then '[]'::jsonb
      else coalesce((
        select jsonb_agg(candidate.item order by candidate.observed_at desc)
        from (
          select jsonb_build_object(
              'kind','evidence_item','id',e.id,
              'label',coalesce(nullif(btrim(e.description),''),e.source_reference,e.evidence_type,'Validated evidence'),
              'sourceSystem',e.source_system,'sourceReference',e.source_reference,
              'observedAt',e.ts
            ) as item,
            e.ts as observed_at
          from public.evidence_items e
          where e.organization_id=o.organization_id
            and e.recommendation_id=o.recommendation_id
            and public.verification_evidence_item_eligible(
              o.organization_id,o.recommendation_id,e.id,o.created_at
            )
          union all
          select jsonb_build_object(
              'kind','cmms_work_order','id',w.id,
              'label',concat_ws(' · ',coalesce(nullif(w.wo_number,''),w.external_id),w.title),
              'sourceSystem',w.source_system,'sourceReference',w.external_id,
              'observedAt',coalesce(w.completed_at,w.created_at)
            ) as item,
            coalesce(w.completed_at,w.created_at) as observed_at
          from public.work_orders w
          where w.organization_id=o.organization_id
            and w.asset_id=o.asset_id
            and public.verification_work_order_eligible(
              o.organization_id,o.asset_id,w.id,o.created_at
            )
        ) candidate
      ),'[]'::jsonb) end
  from public.verification_obligations o
  left join public.recommendations r
    on r.id=o.recommendation_id and r.organization_id=o.organization_id
  left join public.design_requirements d
    on d.id=o.requirement_id and d.organization_id=o.organization_id
  left join public.assets a
    on a.id=o.asset_id and a.organization_id=o.organization_id
  left join public.user_profiles owner
    on owner.id=o.verification_owner_id
   and owner.organization_id=o.organization_id
   and coalesce(owner.role,'')<>'ai_admin'
  where o.organization_id=public.app_current_org()
    and o.status='open'
  order by o.due_date,coalesce(r.title,d.requirement_ref)
  limit greatest(1,least(coalesce(p_limit,25),100));
$$;

revoke all on function public.get_open_verifications(int)
  from public,anon;
grant execute on function public.get_open_verifications(int)
  to authenticated;

drop function if exists public.get_verification_posture();
create or replace function public.get_verification_posture()
returns table(
  "actionedRecommendations" int,
  "withObligation" int,
  "openObligations" int,
  overdue int,
  achieved int,
  "notAchieved" int,
  inconclusive int,
  waived int,
  "actionedWithoutObligation" int,
  "unplannedOpen" int,
  "evidenceBackedCompleted" int,
  "legacyCompletedWithoutEvidence" int,
  basis text
)
language sql
stable
security definer
set search_path=public
as $$
  with r as (
    select * from public.recommendations
    where organization_id=public.app_current_org()
      and status in ('approved','released','scheduled','completed')
  ),
  o as (
    select * from public.verification_obligations
    where organization_id=public.app_current_org()
      and recommendation_id is not null
  ),
  n as (
    select
      (select count(*)::int from r) as actioned,
      (select count(*)::int from r where exists(
        select 1 from o where o.recommendation_id=r.id)) as watched,
      (select count(*)::int from o where status='open') as open_n,
      (select count(*)::int from o where status='open' and due_date<current_date) as overdue_n,
      (select count(*)::int from o where result='achieved') as achieved_n,
      (select count(*)::int from o where result='not_achieved') as failed_n,
      (select count(*)::int from o where result='inconclusive') as inconclusive_n,
      (select count(*)::int from o where status='waived') as waived_n,
      (select count(*)::int from r where not exists(
        select 1 from o where o.recommendation_id=r.id)) as unwatched_n,
      (select count(*)::int from o where status='open'
        and not public.verification_obligation_plan_valid(id)) as unplanned_n,
      (select count(*)::int from o where status='completed'
        and ((evidence_id is not null)::int+(work_order_id is not null)::int)=1) as backed_n,
      (select count(*)::int from o where status='completed'
        and not evidence_required and evidence_id is null and work_order_id is null) as legacy_n
  )
  select actioned,watched,open_n,overdue_n,achieved_n,failed_n,
    inconclusive_n,waived_n,unwatched_n,unplanned_n,backed_n,legacy_n,
    format(
      'Of %s actioned recommendation(s), %s carry an obligation and %s remain unwatched. %s are open, %s overdue, and %s require an explicit human plan before closure. %s completed outcomes cite governed evidence; %s historical completed outcomes do not and remain labelled legacy.',
      actioned,watched,unwatched_n,open_n,overdue_n,unplanned_n,backed_n,legacy_n
    )
  from n;
$$;

revoke all on function public.get_verification_posture()
  from public,anon;
grant execute on function public.get_verification_posture()
  to authenticated;

notify pgrst,'reload schema';
