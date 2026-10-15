-- ============================================================================
-- E6.02 / E6.04 / E6.07 — governed workforce lifecycle and labour rules.
--
-- Extend the canonical training_plans and labour_rules stores.  Training
-- completion is evidence that training occurred; it never declares the member
-- competent.  Labour limits are drafts until a different named human adopts
-- them, and only effective adopted rules enter the fatigue calculation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Training-plan lifecycle.
-- ---------------------------------------------------------------------------
alter table public.training_plans
  drop constraint if exists training_plans_status_check;
alter table public.training_plans
  add constraint training_plans_status_check check (status in
    ('planned','in_progress','complete','abandoned','cancelled','superseded'));

alter table public.training_plans
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists lifecycle_version integer not null default 1,
  add column if not exists lifecycle_basis text,
  add column if not exists started_at timestamptz,
  add column if not exists started_by uuid references auth.users(id),
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id),
  add column if not exists completion_evidence_reference text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid references auth.users(id),
  add column if not exists supersedes_plan_id bigint references public.training_plans(id) on delete restrict,
  add column if not exists superseded_by_plan_id bigint references public.training_plans(id) on delete restrict;

alter table public.training_plans
  drop constraint if exists training_plans_lifecycle_version_check,
  drop constraint if exists training_plans_started_actor_check,
  drop constraint if exists training_plans_completed_actor_check,
  drop constraint if exists training_plans_cancelled_actor_check,
  drop constraint if exists training_plans_superseded_actor_check;
alter table public.training_plans
  add constraint training_plans_lifecycle_version_check check (lifecycle_version >= 1),
  add constraint training_plans_started_actor_check check ((started_at is null)=(started_by is null)),
  add constraint training_plans_completed_actor_check check ((completed_at is null)=(completed_by is null)),
  add constraint training_plans_cancelled_actor_check check ((cancelled_at is null)=(cancelled_by is null)),
  add constraint training_plans_superseded_actor_check check ((superseded_at is null)=(superseded_by is null));

create or replace function public.enforce_training_plan_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.training_plan_write', true), '');
begin
  if tg_op = 'DELETE' then
    raise exception 'training plans are retained lifecycle evidence and cannot be deleted';
  end if;
  if v_marker <> 'granted' or auth.uid() is null then
    raise exception 'training plans are written only by a governed named-human workflow';
  end if;

  if not exists (
    select 1 from public.workforce_members m
    where m.id = new.member_id and m.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.competencies c
    where c.id = new.competency_id and c.organization_id = new.organization_id
  ) then
    raise exception 'training plan member and competency must belong to the same organization';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'planned' or new.lifecycle_version <> 1 then
      raise exception 'a new training plan begins planned at lifecycle version 1';
    end if;
    if new.supersedes_plan_id is not null and not exists (
      select 1 from public.training_plans p
      where p.id = new.supersedes_plan_id
        and p.organization_id = new.organization_id
        and p.member_id = new.member_id
        and p.competency_id = new.competency_id
    ) then
      raise exception 'a replacement training plan must supersede a same-tenant plan for the same member and competency';
    end if;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
    new.updated_at := now();
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.member_id is distinct from old.member_id
     or new.competency_id is distinct from old.competency_id
     or new.plan_kind is distinct from old.plan_kind
     or new.target_date is distinct from old.target_date
     or new.driver is distinct from old.driver
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
     or new.supersedes_plan_id is distinct from old.supersedes_plan_id then
    raise exception 'training plan identity and stated plan are immutable; supersede it with a replacement';
  end if;
  if old.status in ('complete','abandoned','cancelled','superseded') then
    raise exception 'a final training plan cannot transition again';
  end if;
  if new.lifecycle_version <> old.lifecycle_version + 1 then
    raise exception 'training plan lifecycle version must advance exactly once';
  end if;
  if not (
    (old.status = 'planned' and new.status in ('in_progress','cancelled','superseded'))
    or (old.status = 'in_progress' and new.status in ('complete','cancelled','superseded'))
  ) then
    raise exception 'invalid training plan lifecycle transition from % to %', old.status, new.status;
  end if;
  if length(btrim(coalesce(new.lifecycle_basis,''))) < 20 then
    raise exception 'a training lifecycle transition requires a basis of at least 20 characters';
  end if;
  if new.status = 'in_progress' and (new.started_at is null or new.started_by <> auth.uid()) then
    raise exception 'starting a training plan requires the named human start receipt';
  end if;
  if new.status = 'complete' and (
    new.completed_at is null or new.completed_by <> auth.uid()
    or length(btrim(coalesce(new.completion_evidence_reference,''))) < 3
  ) then
    raise exception 'completing training requires a named human and delivery evidence reference';
  end if;
  if new.status in ('cancelled','abandoned')
     and (new.cancelled_at is null or new.cancelled_by <> auth.uid()) then
    raise exception 'cancelling training requires the named human cancellation receipt';
  end if;
  if new.status = 'superseded' and (
    new.superseded_at is null or new.superseded_by <> auth.uid()
    or new.superseded_by_plan_id is null
  ) then
    raise exception 'superseding training requires a linked replacement plan and named human receipt';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.enforce_training_plan_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_training_plan_lifecycle on public.training_plans;
create trigger trg_training_plan_lifecycle
  before insert or update or delete on public.training_plans
  for each row execute function public.enforce_training_plan_lifecycle();

alter function public.record_site_training_plan(uuid,bigint,bigint,text,date,text)
  rename to record_site_training_plan_authoritative_internal;
revoke all on function public.record_site_training_plan_authoritative_internal(uuid,bigint,bigint,text,date,text)
  from public, anon, authenticated, service_role;

create function public.record_site_training_plan(
  p_site_id uuid,p_member_id bigint,p_competency_id bigint,p_plan_kind text,
  p_target_date date,p_driver text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform set_config('app.training_plan_write','granted',true);
  v_result := public.record_site_training_plan_authoritative_internal(
    p_site_id,p_member_id,p_competency_id,p_plan_kind,p_target_date,p_driver);
  perform set_config('app.training_plan_write','',true);
  return v_result;
exception when others then
  perform set_config('app.training_plan_write','',true);
  raise;
end
$$;
revoke all on function public.record_site_training_plan(uuid,bigint,bigint,text,date,text)
  from public, anon;
grant execute on function public.record_site_training_plan(uuid,bigint,bigint,text,date,text)
  to authenticated;

create or replace function public.transition_training_plan(
  p_plan_id bigint,
  p_action text,
  p_basis text,
  p_evidence_reference text default null,
  p_replacement_target_date date default null,
  p_replacement_driver text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_plan public.training_plans%rowtype;
  v_replacement bigint;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('answered',false,'refusal','authentication required');
  end if;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,
      'refusal','training lifecycle changes require a human planning, supervisory or governance role');
  end if;
  if p_action not in ('start','complete','cancel','supersede') then
    return jsonb_build_object('answered',false,'refusal','training action must be start, complete, cancel or supersede');
  end if;
  if length(btrim(coalesce(p_basis,''))) < 20 then
    return jsonb_build_object('answered',false,
      'refusal','state at least 20 characters of evidence and reasoning for this lifecycle change');
  end if;
  if p_expected_version is null then
    return jsonb_build_object('answered',false,
      'refusal','training lifecycle changes require the version that was reviewed; refresh before recording the act');
  end if;

  select * into v_plan from public.training_plans
  where id=p_plan_id and organization_id=v_org for update;
  if not found then
    return jsonb_build_object('answered',false,'refusal','training plan not found');
  end if;
  if p_expected_version is not null and p_expected_version<>v_plan.lifecycle_version then
    return jsonb_build_object('answered',false,
      'refusal','training plan changed after it was loaded; refresh before recording another lifecycle act',
      'currentVersion',v_plan.lifecycle_version);
  end if;
  if v_plan.status in ('complete','abandoned','cancelled','superseded') then
    return jsonb_build_object('answered',false,'refusal','this training plan is already final');
  end if;
  if p_action='start' and v_plan.status<>'planned' then
    return jsonb_build_object('answered',false,'refusal','only a planned training plan can start');
  end if;
  if p_action='complete' and v_plan.status<>'in_progress' then
    return jsonb_build_object('answered',false,'refusal','training must be in progress before it can be completed');
  end if;
  if p_action='complete' and length(btrim(coalesce(p_evidence_reference,'')))<3 then
    return jsonb_build_object('answered',false,
      'refusal','training completion requires a delivery evidence reference; completion does not grant competency');
  end if;
  if p_action='supersede' and (
    p_replacement_target_date is null or p_replacement_target_date<current_date
    or length(btrim(coalesce(p_replacement_driver,'')))<10
  ) then
    return jsonb_build_object('answered',false,
      'refusal','superseding requires a current replacement target and a replacement driver of at least 10 characters');
  end if;

  perform set_config('app.training_plan_write','granted',true);
  if p_action='supersede' then
    insert into public.training_plans(
      organization_id,member_id,competency_id,plan_kind,target_date,status,driver,
      supersedes_plan_id)
    values(v_org,v_plan.member_id,v_plan.competency_id,v_plan.plan_kind,
      p_replacement_target_date,'planned',btrim(p_replacement_driver),v_plan.id)
    returning id into v_replacement;
  end if;

  update public.training_plans set
    status=case p_action when 'start' then 'in_progress' when 'complete' then 'complete'
      when 'cancel' then 'cancelled' else 'superseded' end,
    lifecycle_version=lifecycle_version+1,
    lifecycle_basis=btrim(p_basis),
    started_at=case when p_action='start' then now() else started_at end,
    started_by=case when p_action='start' then auth.uid() else started_by end,
    completed_at=case when p_action='complete' then now() else completed_at end,
    completed_by=case when p_action='complete' then auth.uid() else completed_by end,
    completion_evidence_reference=case when p_action='complete'
      then btrim(p_evidence_reference) else completion_evidence_reference end,
    cancelled_at=case when p_action='cancel' then now() else cancelled_at end,
    cancelled_by=case when p_action='cancel' then auth.uid() else cancelled_by end,
    superseded_at=case when p_action='supersede' then now() else superseded_at end,
    superseded_by=case when p_action='supersede' then auth.uid() else superseded_by end,
    superseded_by_plan_id=case when p_action='supersede' then v_replacement else superseded_by_plan_id end
  where id=v_plan.id;
  perform set_config('app.training_plan_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'training_plan',v_role,jsonb_build_object(
    'trainingPlanId',v_plan.id,'action',p_action,'replacementPlanId',v_replacement,
    'evidenceReference',nullif(btrim(p_evidence_reference),''),'humanRecorded',true),
    jsonb_build_object('status',v_plan.status,'version',v_plan.lifecycle_version),
    jsonb_build_object('status',case p_action when 'start' then 'in_progress'
      when 'complete' then 'complete' when 'cancel' then 'cancelled' else 'superseded' end,
      'version',v_plan.lifecycle_version+1,'replacementPlanId',v_replacement));

  return jsonb_build_object('answered',true,'trainingPlanId',v_plan.id,
    'status',case p_action when 'start' then 'in_progress' when 'complete' then 'complete'
      when 'cancel' then 'cancelled' else 'superseded' end,
    'version',v_plan.lifecycle_version+1,'replacementPlanId',v_replacement,
    'competencyGranted',false,
    'note',case when p_action='complete'
      then 'Training delivery was recorded. Competency still requires a separate evidence-backed named-human verification.'
      else 'Training lifecycle act recorded.' end);
exception when others then
  perform set_config('app.training_plan_write','',true);
  raise;
end
$$;
revoke all on function public.transition_training_plan(bigint,text,text,text,date,text,integer)
  from public, anon;
grant execute on function public.transition_training_plan(bigint,text,text,text,date,text,integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Versioned, human-adopted labour rules.
-- ---------------------------------------------------------------------------
drop index if exists public.idx_lr_key;
alter table public.labour_rules
  add column if not exists status text not null default 'draft',
  add column if not exists version integer not null default 1,
  add column if not exists basis text,
  add column if not exists evidence_reference text,
  add column if not exists effective_from date,
  add column if not exists effective_until date,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists adopted_by uuid references auth.users(id),
  add column if not exists adopted_at timestamptz,
  add column if not exists retired_by uuid references auth.users(id),
  add column if not exists retired_at timestamptz,
  add column if not exists decision_basis text,
  add column if not exists supersedes_rule_id bigint references public.labour_rules(id) on delete restrict;

alter table public.labour_rules
  drop constraint if exists labour_rules_status_check,
  drop constraint if exists labour_rules_version_check,
  drop constraint if exists labour_rules_effective_window_check,
  drop constraint if exists labour_rules_adoption_actor_check,
  drop constraint if exists labour_rules_retirement_actor_check;
alter table public.labour_rules
  add constraint labour_rules_status_check check (status in ('draft','adopted','retired','superseded')),
  add constraint labour_rules_version_check check (version>=1),
  add constraint labour_rules_effective_window_check check (
    effective_until is null or effective_from is null or effective_until>=effective_from),
  add constraint labour_rules_adoption_actor_check check ((adopted_at is null)=(adopted_by is null)),
  add constraint labour_rules_retirement_actor_check check ((retired_at is null)=(retired_by is null));

create unique index if not exists uq_labour_rule_version
  on public.labour_rules(organization_id,rule_key,version);
create unique index if not exists uq_labour_rule_current_adopted
  on public.labour_rules(organization_id,rule_key)
  where status='adopted';

create or replace function public.enforce_labour_rule_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_marker text:=coalesce(current_setting('app.labour_rule_write',true),'');
begin
  if tg_op='DELETE' then
    raise exception 'labour rules are retained governance evidence and cannot be deleted';
  end if;
  if v_marker<>'granted' or auth.uid() is null then
    raise exception 'labour rules are written only by a governed named-human workflow';
  end if;
  if tg_op='INSERT' then
    if new.status<>'draft' then raise exception 'a labour rule begins as a draft'; end if;
    if length(btrim(coalesce(new.basis,'')))<20 then
      raise exception 'a labour rule requires a basis of at least 20 characters';
    end if;
    if length(btrim(coalesce(new.evidence_reference,'')))<3 then
      raise exception 'a labour rule requires a stable evidence or agreement reference';
    end if;
    new.recorded_by:=auth.uid(); new.recorded_at:=now();
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id
     or new.rule_key is distinct from old.rule_key
     or new.title is distinct from old.title
     or new.source is distinct from old.source
     or new.limit_kind is distinct from old.limit_kind
     or new.limit_value is distinct from old.limit_value
     or new.applies_to_craft is distinct from old.applies_to_craft
     or new.reference is distinct from old.reference
     or new.version is distinct from old.version
     or new.basis is distinct from old.basis
     or new.evidence_reference is distinct from old.evidence_reference
     or new.effective_from is distinct from old.effective_from
     or new.effective_until is distinct from old.effective_until
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_at is distinct from old.recorded_at
     or new.supersedes_rule_id is distinct from old.supersedes_rule_id then
    raise exception 'labour rule content is immutable; record and adopt a new version';
  end if;
  if not ((old.status='draft' and new.status='adopted')
    or (old.status='adopted' and new.status in ('retired','superseded'))) then
    raise exception 'invalid labour-rule lifecycle transition from % to %',old.status,new.status;
  end if;
  if length(btrim(coalesce(new.decision_basis,'')))<20 then
    raise exception 'a labour-rule decision requires at least 20 characters of evidence and reasoning';
  end if;
  if new.status='adopted' and (
    new.adopted_at is null or new.adopted_by<>auth.uid()
    or new.adopted_by=old.recorded_by
  ) then
    raise exception 'labour-rule adoption requires an independent named human';
  end if;
  if new.status in ('retired','superseded') and (
    new.retired_at is null or new.retired_by<>auth.uid()
  ) then
    raise exception 'retiring or superseding a labour rule requires a named human receipt';
  end if;
  return new;
end
$$;
revoke all on function public.enforce_labour_rule_lifecycle()
  from public,anon,authenticated,service_role;
drop trigger if exists trg_labour_rule_lifecycle on public.labour_rules;
create trigger trg_labour_rule_lifecycle
  before insert or update or delete on public.labour_rules
  for each row execute function public.enforce_labour_rule_lifecycle();

create or replace function public.record_labour_rule(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_key text:=lower(btrim(coalesce(p_payload->>'ruleKey','')));
  v_title text:=btrim(coalesce(p_payload->>'title',''));
  v_source text:=btrim(coalesce(p_payload->>'source',''));
  v_kind text:=btrim(coalesce(p_payload->>'limitKind',''));
  v_value numeric:=public.sync_text_as_numeric(p_payload->>'limitValue');
  v_from date:=public.sync_text_as_date(p_payload->>'effectiveFrom');
  v_until date:=public.sync_text_as_date(p_payload->>'effectiveUntil');
  v_version integer; v_id bigint; v_previous bigint;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('answered',false,'refusal','authentication required');
  end if;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('answered',false,
      'refusal','drafting labour rules requires a human planning, supervisory or governance role');
  end if;
  if length(v_key)<2 or length(v_title)<5 then
    return jsonb_build_object('answered',false,'refusal','a labour rule requires a stable key and title');
  end if;
  if v_source not in ('statutory','labour_agreement','company_standard','fatigue_science')
     or v_kind not in ('max_consecutive_days','max_hours_per_shift',
       'min_rest_hours_between_shifts','max_hours_per_7_days',
       'max_hours_per_14_days','max_consecutive_nights') then
    return jsonb_build_object('answered',false,'refusal','labour-rule source or limit kind is unsupported');
  end if;
  if v_value is null or not public.sync_is_finite_numeric(v_value) or v_value<=0 then
    return jsonb_build_object('answered',false,'refusal','labour-rule limit must be a finite number greater than zero');
  end if;
  if v_from is null or (v_until is not null and v_until<v_from) then
    return jsonb_build_object('answered',false,'refusal','labour rule needs a valid effective date window');
  end if;
  if length(btrim(coalesce(p_payload->>'basis','')))<20
     or length(btrim(coalesce(p_payload->>'evidenceReference','')))<3 then
    return jsonb_build_object('answered',false,
      'refusal','labour rule needs a substantive basis and stable evidence or agreement reference');
  end if;

  perform 1 from public.organizations where id=v_org for update;
  select coalesce(max(version),0)+1,max(id) filter(where status='adopted')
    into v_version,v_previous
  from public.labour_rules where organization_id=v_org and rule_key=v_key;
  perform set_config('app.labour_rule_write','granted',true);
  insert into public.labour_rules(organization_id,rule_key,title,source,limit_kind,
    limit_value,applies_to_craft,reference,status,version,basis,evidence_reference,
    effective_from,effective_until,supersedes_rule_id)
  values(v_org,v_key,v_title,v_source,v_kind,v_value,
    nullif(btrim(p_payload->>'appliesToCraft'),''),
    nullif(btrim(p_payload->>'reference'),''),'draft',v_version,
    btrim(p_payload->>'basis'),btrim(p_payload->>'evidenceReference'),
    v_from,v_until,v_previous)
  returning id into v_id;
  perform set_config('app.labour_rule_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'labour_rule',v_role,jsonb_build_object(
    'labourRuleId',v_id,'ruleKey',v_key,'version',v_version,'action','drafted',
    'source',v_source,'evidenceReference',btrim(p_payload->>'evidenceReference')));
  return jsonb_build_object('answered',true,'labourRuleId',v_id,'status','draft',
    'version',v_version,'note','Draft recorded. A different authorized human must adopt it before fatigue analysis can use it.');
exception when unique_violation then
  perform set_config('app.labour_rule_write','',true);
  return jsonb_build_object('answered',false,'refusal','the labour-rule version changed concurrently; refresh and record again');
when others then
  perform set_config('app.labour_rule_write','',true);
  raise;
end
$$;
revoke all on function public.record_labour_rule(jsonb) from public,anon;
grant execute on function public.record_labour_rule(jsonb) to authenticated;

create or replace function public.decide_labour_rule(
  p_rule_id bigint,p_decision text,p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_rule public.labour_rules%rowtype; v_previous public.labour_rules%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('answered',false,'refusal','authentication required');
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('answered',false,
      'refusal','adopting or retiring a labour rule requires human maintenance-management or governance authority');
  end if;
  if p_decision not in ('adopt','retire') or length(btrim(coalesce(p_note,'')))<20 then
    return jsonb_build_object('answered',false,
      'refusal','record adopt or retire with at least 20 characters of decision basis');
  end if;
  perform 1 from public.organizations where id=v_org for update;
  select * into v_rule from public.labour_rules
  where id=p_rule_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('answered',false,'refusal','labour rule not found'); end if;
  if p_decision='adopt' then
    if v_rule.status<>'draft' then
      return jsonb_build_object('answered',false,'refusal','only a draft labour rule can be adopted');
    end if;
    if length(btrim(coalesce(v_rule.basis,'')))<20
       or length(btrim(coalesce(v_rule.evidence_reference,'')))<3
       or v_rule.effective_from is null then
      return jsonb_build_object('answered',false,
        'refusal','adoption requires a governed draft with a substantive basis, stable evidence and effective date');
    end if;
    if v_rule.recorded_by=auth.uid() then
      return jsonb_build_object('answered',false,
        'refusal','segregation of duties requires adoption by a different named human');
    end if;
    select * into v_previous from public.labour_rules
    where organization_id=v_org and rule_key=v_rule.rule_key and status='adopted'
    for update;
    perform set_config('app.labour_rule_write','granted',true);
    if v_previous.id is not null then
      update public.labour_rules set status='superseded',retired_by=auth.uid(),
        retired_at=now(),decision_basis='Superseded by adopted version '
          ||v_rule.version||': '||btrim(p_note)
      where id=v_previous.id;
    end if;
    update public.labour_rules set status='adopted',adopted_by=auth.uid(),
      adopted_at=now(),decision_basis=btrim(p_note)
    where id=v_rule.id;
  else
    if v_rule.status<>'adopted' then
      return jsonb_build_object('answered',false,'refusal','only an adopted labour rule can be retired');
    end if;
    perform set_config('app.labour_rule_write','granted',true);
    update public.labour_rules set status='retired',retired_by=auth.uid(),
      retired_at=now(),decision_basis=btrim(p_note)
    where id=v_rule.id;
  end if;
  perform set_config('app.labour_rule_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'labour_rule',v_role,jsonb_build_object(
    'labourRuleId',v_rule.id,'ruleKey',v_rule.rule_key,'version',v_rule.version,
    'action',p_decision,'supersededRuleId',v_previous.id),
    jsonb_build_object('status',v_rule.status),
    jsonb_build_object('status',case when p_decision='adopt' then 'adopted' else 'retired' end));
  return jsonb_build_object('answered',true,'labourRuleId',v_rule.id,
    'status',case when p_decision='adopt' then 'adopted' else 'retired' end,
    'supersededRuleId',v_previous.id,
    'note','Labour-rule decision recorded. Fatigue analysis uses only adopted rules inside their effective window.');
exception when others then
  perform set_config('app.labour_rule_write','',true);
  raise;
end
$$;
revoke all on function public.decide_labour_rule(bigint,text,text) from public,anon;
grant execute on function public.decide_labour_rule(bigint,text,text) to authenticated;

create or replace function public.get_roster_window(p_days int default 21)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ruleId',id,'ruleKey',rule_key,'title',title,'source',source,
        'limitKind',limit_kind,'limitValue',limit_value,
        'appliesToCraft',applies_to_craft,'reference',reference,
        'version',version,'effectiveFrom',effective_from,'effectiveUntil',effective_until)
        order by rule_key,version)
      from public.labour_rules where organization_id=public.app_current_org()
        and status='adopted' and effective_from<=current_date
        and (effective_until is null or effective_until>=current_date)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberId',wm.id,'displayName',wm.display_name,'craft',wm.craft,
        'shifts',coalesce((select jsonb_agg(jsonb_build_object(
          'startsAt',sa.starts_at,'endsAt',sa.ends_at,'shiftKind',sa.shift_kind)
          order by sa.starts_at) from public.shift_assignments sa
          where sa.member_id=wm.id and sa.organization_id=public.app_current_org()
            and sa.starts_at>=now()-make_interval(days=>greatest(1,least(p_days,120)))),
          '[]'::jsonb)))
      from public.workforce_members wm
      where wm.organization_id=public.app_current_org() and wm.active
        and exists(select 1 from public.shift_assignments s
          where s.member_id=wm.id and s.organization_id=public.app_current_org())
    ), '[]'::jsonb),
    'ruleState',case when exists(select 1 from public.labour_rules r
      where r.organization_id=public.app_current_org() and r.status='adopted'
        and r.effective_from<=current_date
        and (r.effective_until is null or r.effective_until>=current_date))
      then 'effective_adopted_rules' else 'no_effective_adopted_rules' end
  )
$$;

create or replace function public.get_workforce_governance_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('answered',false,'refusal','authentication required'); end if;
  return jsonb_build_object('answered',true,
    'trainingPlans',coalesce((select jsonb_agg(jsonb_build_object(
      'planId',p.id,'memberId',p.member_id,'memberName',m.display_name,
      'competencyId',p.competency_id,'competencyTitle',c.title,
      'planKind',p.plan_kind,'targetDate',p.target_date,'status',p.status,
      'driver',p.driver,'version',p.lifecycle_version,'lifecycleBasis',p.lifecycle_basis,
      'completionEvidenceReference',p.completion_evidence_reference,
      'supersedesPlanId',p.supersedes_plan_id,'supersededByPlanId',p.superseded_by_plan_id,
      'createdAt',p.created_at,'updatedAt',p.updated_at) order by p.created_at desc)
      from public.training_plans p
      join public.workforce_members m on m.id=p.member_id and m.organization_id=v_org
      join public.competencies c on c.id=p.competency_id and c.organization_id=v_org
      where p.organization_id=v_org),'[]'::jsonb),
    'labourRules',coalesce((select jsonb_agg(jsonb_build_object(
      'ruleId',r.id,'ruleKey',r.rule_key,'title',r.title,'source',r.source,
      'limitKind',r.limit_kind,'limitValue',r.limit_value,
      'appliesToCraft',r.applies_to_craft,'reference',r.reference,
      'status',r.status,'version',r.version,'basis',r.basis,
      'evidenceReference',r.evidence_reference,'effectiveFrom',r.effective_from,
      'effectiveUntil',r.effective_until,'recordedBy',r.recorded_by,
      'adoptedBy',r.adopted_by,'adoptedAt',r.adopted_at,
      'retiredAt',r.retired_at,'decisionBasis',r.decision_basis,
      'supersedesRuleId',r.supersedes_rule_id) order by r.rule_key,r.version desc)
      from public.labour_rules r where r.organization_id=v_org),'[]'::jsonb),
    'effectiveRuleCount',(select count(*) from public.labour_rules r
      where r.organization_id=v_org and r.status='adopted'
        and r.effective_from<=current_date
        and (r.effective_until is null or r.effective_until>=current_date)),
    'boundary','Training completion records delivery only and never grants competency. Fatigue analysis uses only independently adopted labour rules inside their effective window.') ;
end
$$;
revoke all on function public.get_workforce_governance_workspace() from public,anon;
grant execute on function public.get_workforce_governance_workspace() to authenticated;

comment on function public.transition_training_plan(bigint,text,text,text,date,text,integer) is
  'E6.02 governed start, completion, cancellation and supersession of canonical training plans. Completion never grants competency.';
comment on function public.decide_labour_rule(bigint,text,text) is
  'E6.04/E6.07 independent named-human adoption and retirement of canonical statutory, labour-agreement, enterprise and fatigue-science rules.';

notify pgrst,'reload schema';
