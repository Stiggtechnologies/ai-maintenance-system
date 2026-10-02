-- C5.10 / C5.11 / C5.17 — governed maintenance change control.
--
-- Canonical reuse:
--   * work_orders is still the one work identity;
--   * approvals is still the one approval workflow;
--   * risks + risk_acceptances remain the risk and acceptance truth;
--   * work_order_status_history + audit_events remain the history/audit truth.
-- No parallel request queue, risk register, work store or audit ledger is added.

alter table public.work_orders
  add column if not exists control_revision integer not null default 1,
  add column if not exists deferred_until timestamptz,
  add column if not exists deferral_approval_id uuid references public.approvals(id) on delete set null,
  add column if not exists schedule_control_approval_id uuid references public.approvals(id) on delete set null,
  add column if not exists schedule_controlled_by uuid references auth.users(id),
  add column if not exists schedule_controlled_at timestamptz;

alter table public.approvals
  add column if not exists decision_right_key text references public.decision_rights(right_key),
  add column if not exists action_type text,
  add column if not exists request_payload jsonb,
  add column if not exists subject_revision integer,
  add column if not exists requested_by uuid references auth.users(id),
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decision_note text,
  add column if not exists decided_payload jsonb;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.work_orders'::regclass
      and conname='work_orders_control_revision_check'
  ) then
    alter table public.work_orders
      add constraint work_orders_control_revision_check
      check(control_revision > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.approvals'::regclass
      and conname='approvals_maintenance_action_check'
  ) then
    alter table public.approvals
      add constraint approvals_maintenance_action_check
      check(action_type is null or action_type in (
        'defer_critical_work',
        'create_safety_critical_work',
        'reschedule_safety_critical_work'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.approvals'::regclass
      and conname='approvals_request_payload_object_check'
  ) then
    alter table public.approvals
      add constraint approvals_request_payload_object_check
      check(request_payload is null or jsonb_typeof(request_payload)='object');
  end if;
end $$;

create unique index if not exists approvals_one_open_maintenance_change
  on public.approvals(work_order_id, action_type)
  where decision_right_key in ('defer_critical_work','schedule_safety_critical_work')
    and status in ('required','pending');

create index if not exists approvals_maintenance_change_queue
  on public.approvals(organization_id, status, created_at desc)
  where decision_right_key in ('defer_critical_work','schedule_safety_critical_work');

update public.decision_rights
set enforcement='enforced', required_authority='reliability_engineer'
where right_key='change_pm_interval' and tier='approval';

update public.decision_rights
set enforcement='enforced', required_authority='maintenance_manager'
where right_key='defer_critical_work' and tier='approval';

update public.decision_rights
set enforcement='enforced', required_authority='maintenance_manager'
where right_key='schedule_safety_critical_work' and tier='approval';

create or replace function public.maintenance_work_is_critical(p_work public.work_orders)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_asset_critical boolean:=false;
begin
  if p_work.asset_id is not null then
    select coalesce(a.criticality,'') in ('critical','high')
      into v_asset_critical
    from public.assets a
    where a.id=p_work.asset_id and a.organization_id=p_work.organization_id;
  end if;
  return coalesce(p_work.safety_flag,false)
    or lower(coalesce(p_work.priority,''))='critical'
    or lower(coalesce(p_work.production_impact,'')) in ('high','critical')
    or coalesce(v_asset_critical,false);
end $$;
revoke all on function public.maintenance_work_is_critical(public.work_orders)
  from public,anon,authenticated;

create or replace function public.protect_maintenance_control_approval()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_governed boolean;
begin
  v_governed:=case when tg_op='DELETE'
    then old.decision_right_key in ('defer_critical_work','schedule_safety_critical_work')
    else new.decision_right_key in ('defer_critical_work','schedule_safety_critical_work')
      or (tg_op='UPDATE' and old.decision_right_key in
        ('defer_critical_work','schedule_safety_critical_work'))
    end;
  if v_governed and coalesce(current_setting('app.maintenance_change_control_write',true),'')<>'granted' then
    raise exception 'governed maintenance approvals may be written only through the maintenance change-control functions'
      using errcode='insufficient_privilege';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.protect_maintenance_control_approval()
  from public,anon,authenticated;
drop trigger if exists trg_protect_maintenance_control_approval on public.approvals;
create trigger trg_protect_maintenance_control_approval
  before insert or update or delete on public.approvals
  for each row execute function public.protect_maintenance_control_approval();

create or replace function public.enforce_governed_work_control()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old_critical boolean:=false;
  v_new_critical boolean:=false;
  v_service_import boolean:=false;
begin
  if coalesce(current_setting('app.maintenance_change_control_write',true),'')='granted' then
    return new;
  end if;
  v_service_import:=coalesce(current_setting('request.jwt.claim.role',true),'')='service_role'
    and nullif(coalesce(new.source_system,''),'') is not null
    and nullif(coalesce(new.external_id,''),'') is not null;
  if v_service_import then return new; end if;

  if tg_op='INSERT' then
    if coalesce(new.safety_flag,false) then
      raise exception 'safety-critical work must be proposed through request_safety_critical_work and independently approved'
        using errcode='insufficient_privilege';
    end if;
    if new.deferred_until is not null or new.deferral_approval_id is not null
       or new.schedule_control_approval_id is not null then
      raise exception 'governed maintenance control provenance cannot be written directly'
        using errcode='insufficient_privilege';
    end if;
    return new;
  end if;

  v_old_critical:=public.maintenance_work_is_critical(old);
  v_new_critical:=public.maintenance_work_is_critical(new);
  if new.deferred_until is distinct from old.deferred_until
     or new.deferral_approval_id is distinct from old.deferral_approval_id
     or new.schedule_control_approval_id is distinct from old.schedule_control_approval_id
     or new.schedule_controlled_by is distinct from old.schedule_controlled_by
     or new.schedule_controlled_at is distinct from old.schedule_controlled_at
     or new.control_revision is distinct from old.control_revision then
    raise exception 'governed maintenance control provenance cannot be changed directly'
      using errcode='insufficient_privilege';
  end if;
  if (v_old_critical or v_new_critical) and (
       new.scheduled_date is distinct from old.scheduled_date
       or new.due_date is distinct from old.due_date
       or new.safety_flag is distinct from old.safety_flag
       or (lower(coalesce(old.priority,''))='critical'
         and lower(coalesce(new.priority,''))<>'critical')
       or (lower(coalesce(old.production_impact,'')) in ('high','critical')
         and lower(coalesce(new.production_impact,'')) not in ('high','critical'))
       or (old.approval_required is true and new.approval_required is distinct from true)
       or ((old.status='approval' or new.status='approval')
         and new.status is distinct from old.status)
     ) then
    raise exception 'critical-work scheduling and deferral must use governed maintenance change control'
      using errcode='insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public.enforce_governed_work_control()
  from public,anon,authenticated;
drop trigger if exists trg_governed_work_control on public.work_orders;
create trigger trg_governed_work_control
  before insert or update on public.work_orders
  for each row execute function public.enforce_governed_work_control();

-- Preserve the canonical adopted-job-plan path while bringing its late safety
-- discovery inside the same control.  A permit-bearing plan may classify an
-- existing order as safety-critical, but that act makes the current schedule
-- inert until a maintenance manager approves it through the C5.17 path.
create or replace function public.apply_job_plan(
  p_work_order_id uuid,
  p_plan_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  p public.job_plans%rowtype;
  w public.work_orders%rowtype;
  s record;
  m record;
  v_hours numeric:=0;
  v_tasks integer:=0;
  v_mats integer:=0;
  v_permits integer;
begin
  select * into p from public.job_plans
  where organization_id=v_org and plan_key=p_plan_key and status='adopted'
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',format(
      'no ADOPTED plan "%s". A draft plan may not be applied to real work.',p_plan_key));
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  select count(*) into v_permits from public.job_plan_permits where job_plan_id=p.id;
  if v_permits>0 and lower(coalesce(w.status,'')) in
      ('in_progress','completed','closed','cancelled') then
    return jsonb_build_object('error',
      'a permit-bearing plan cannot first classify work as safety-critical after execution or closure');
  end if;

  for s in select * from public.job_plan_steps
    where job_plan_id=p.id order by step_number loop
    insert into public.work_order_tasks(
      organization_id,work_order_id,job_plan_step_id,task_sequence,
      description,craft,crew_size,estimated_hours,status
    ) values(v_org,p_work_order_id,s.id,s.step_number,s.description,
      s.craft,s.crew_size,s.estimated_hours*s.crew_size,'pending');
    v_hours:=v_hours+s.estimated_hours*s.crew_size;
    v_tasks:=v_tasks+1;
  end loop;
  for m in select * from public.job_plan_materials where job_plan_id=p.id loop
    perform public.request_wo_material(p_work_order_id,m.material_id,m.qty);
    v_mats:=v_mats+1;
  end loop;

  perform set_config('app.maintenance_change_control_write','granted',true);
  update public.work_orders set
    job_plan_id=p.id,planned_hours=v_hours,estimated_hours=v_hours,
    safety_flag=case when v_permits>0 then true else safety_flag end,
    approval_required=case when v_permits>0 then true else approval_required end,
    status=case when v_permits>0 then 'approval' else status end,
    control_revision=control_revision+case when v_permits>0 then 1 else 0 end,
    updated_at=now()
  where id=p_work_order_id;
  perform set_config('app.maintenance_change_control_write','',true);

  if v_permits>0 then
    insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'maintenance_change_request','job_plan_application',jsonb_build_object(
      'work_order_id',p_work_order_id,'job_plan_id',p.id,
      'action','safety_classification_requires_schedule_approval',
      'permit_count',v_permits,'applied_by',auth.uid()));
  end if;
  return jsonb_build_object('work_order_id',p_work_order_id,'plan',p_plan_key,
    'tasks_created',v_tasks,'planned_hours',v_hours,
    'materials_requested',v_mats,'permits_required',v_permits,
    'safety_flagged',v_permits>0,
    'schedule_approval_required',v_permits>0);
end $$;
revoke all on function public.apply_job_plan(uuid,text) from public,anon;
grant execute on function public.apply_job_plan(uuid,text) to authenticated;

create or replace function public.request_critical_work_deferral(
  p_work_order_id uuid,
  p_deferred_until timestamptz,
  p_reason text,
  p_consequence_of_wrong text,
  p_required_validation text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  w public.work_orders%rowtype;
  v_current_due timestamptz;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','named tenant member required'); end if;
  if v_role='ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot request or approve a critical-work deferral');
  end if;
  if p_deferred_until is null or p_deferred_until<=now() then
    return jsonb_build_object('error','proposed deferral date must be in the future');
  end if;
  if coalesce(length(btrim(p_reason)),0)<20
     or coalesce(length(btrim(p_consequence_of_wrong)),0)<20
     or coalesce(length(btrim(p_required_validation)),0)<20 then
    return jsonb_build_object('error','record the reason, consequence of error and required validation (20 characters each)');
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','same-tenant work order not found'); end if;
  if not public.maintenance_work_is_critical(w) then
    return jsonb_build_object('error','this work order is not recorded as safety- or production-critical');
  end if;
  if lower(coalesce(w.status,'')) in ('completed','cancelled','closed') then
    return jsonb_build_object('error','completed or cancelled work cannot be deferred');
  end if;
  if w.risk_id is null then
    return jsonb_build_object('error','critical-work deferral requires a governed linked risk before approval');
  end if;
  if not exists(select 1 from public.risks r
    where r.id=w.risk_id and r.organization_id=v_org
      and r.status not in ('closed','archived') and r.residual_risk_level is not null) then
    return jsonb_build_object('error','the linked risk must be active, tenant-scoped and carry a residual risk level');
  end if;
  v_current_due:=w.due_date;
  if v_current_due is null and coalesce(w.scheduled_date,'')~'^\d{4}-\d{2}-\d{2}' then
    v_current_due:=w.scheduled_date::timestamptz;
  end if;
  if v_current_due is null then
    return jsonb_build_object('error','critical work needs a recorded current due or schedule date before it can be deferred');
  end if;
  if p_deferred_until<=v_current_due then
    return jsonb_build_object('error','a deferral must move the committed date later');
  end if;
  perform set_config('app.maintenance_change_control_write','granted',true);
  insert into public.approvals(
    organization_id,work_order_id,status,owner_role,reason,
    consequence_of_wrong,required_validation,decision_right_key,action_type,
    request_payload,subject_revision,requested_by
  ) values(
    v_org,w.id,'required','maintenance_manager',btrim(p_reason),
    btrim(p_consequence_of_wrong),btrim(p_required_validation),
    'defer_critical_work','defer_critical_work',
    jsonb_build_object('deferredUntil',p_deferred_until,
      'originalDue',v_current_due,'riskId',w.risk_id),
    w.control_revision,auth.uid()
  ) returning id into v_id;
  perform set_config('app.maintenance_change_control_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_change_request',v_role,jsonb_build_object(
    'approval_id',v_id,'work_order_id',w.id,'action','defer_critical_work',
    'subject_revision',w.control_revision,'requested_by',auth.uid(),
    'proposed_effective_at',p_deferred_until));
  return jsonb_build_object('approval_id',v_id,'work_order_id',w.id,
    'status','required','action','defer_critical_work');
exception when unique_violation then
  return jsonb_build_object('error','an open deferral request already exists for this work order');
end $$;

create or replace function public.request_safety_critical_work(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_asset uuid;
  v_date timestamptz;
  v_work uuid;
  v_approval uuid;
  v_title text:=btrim(coalesce(p_request->>'title',''));
  v_description text:=btrim(coalesce(p_request->>'description',''));
  v_reason text:=btrim(coalesce(p_request->>'reason',''));
  v_consequence text:=btrim(coalesce(p_request->>'consequenceOfWrong',''));
  v_validation text:=btrim(coalesce(p_request->>'requiredValidation',''));
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','named tenant member required'); end if;
  if v_role='ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot request or approve safety-critical work');
  end if;
  begin
    v_asset:=(p_request->>'assetId')::uuid;
    v_date:=(p_request->>'proposedDate')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error','assetId and proposedDate must be valid values');
  end;
  if not exists(select 1 from public.assets a where a.id=v_asset and a.organization_id=v_org) then
    return jsonb_build_object('error','same-tenant asset not found');
  end if;
  if v_date is null or v_date<=now() then return jsonb_build_object('error','proposed work date must be in the future'); end if;
  if length(v_title)<8 or length(v_description)<20 or length(v_reason)<20
     or length(v_consequence)<20 or length(v_validation)<20 then
    return jsonb_build_object('error','title, description, reason, consequence and validation must be substantive');
  end if;
  perform set_config('app.maintenance_change_control_write','granted',true);
  insert into public.work_orders(
    organization_id,asset_id,wo_number,title,description,status,priority,type,
    safety_flag,approval_required,created_at,updated_at
  ) values(
    v_org,v_asset,'SCW-PENDING-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
    v_title,v_description,'approval','critical','human_created',true,true,now(),now()
  ) returning id into v_work;
  insert into public.approvals(
    organization_id,work_order_id,status,owner_role,reason,
    consequence_of_wrong,required_validation,decision_right_key,action_type,
    request_payload,subject_revision,requested_by
  ) values(
    v_org,v_work,'required','maintenance_manager',v_reason,v_consequence,
    v_validation,'schedule_safety_critical_work','create_safety_critical_work',
    jsonb_build_object('proposedDate',v_date,'assetId',v_asset),1,auth.uid()
  ) returning id into v_approval;
  perform set_config('app.maintenance_change_control_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_change_request',v_role,jsonb_build_object(
    'approval_id',v_approval,'work_order_id',v_work,
    'action','create_safety_critical_work','requested_by',auth.uid(),
    'proposed_effective_at',v_date));
  return jsonb_build_object('approval_id',v_approval,'work_order_id',v_work,
    'status','required','action','create_safety_critical_work');
end $$;

create or replace function public.request_safety_critical_reschedule(
  p_work_order_id uuid,
  p_proposed_date timestamptz,
  p_reason text,
  p_consequence_of_wrong text,
  p_required_validation text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  w public.work_orders%rowtype;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null then return jsonb_build_object('error','named tenant member required'); end if;
  if v_role='ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot request or approve safety-critical work');
  end if;
  if p_proposed_date is null or p_proposed_date<=now() then
    return jsonb_build_object('error','proposed schedule date must be in the future');
  end if;
  if coalesce(length(btrim(p_reason)),0)<20
     or coalesce(length(btrim(p_consequence_of_wrong)),0)<20
     or coalesce(length(btrim(p_required_validation)),0)<20 then
    return jsonb_build_object('error','record the reason, consequence of error and required validation (20 characters each)');
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','same-tenant work order not found'); end if;
  if w.safety_flag is distinct from true then
    return jsonb_build_object('error','only recorded safety-critical work uses this reschedule path');
  end if;
  if lower(coalesce(w.status,'')) in ('completed','cancelled','closed') then
    return jsonb_build_object('error','completed or cancelled work cannot be rescheduled');
  end if;
  perform set_config('app.maintenance_change_control_write','granted',true);
  insert into public.approvals(
    organization_id,work_order_id,status,owner_role,reason,
    consequence_of_wrong,required_validation,decision_right_key,action_type,
    request_payload,subject_revision,requested_by
  ) values(
    v_org,w.id,'required','maintenance_manager',btrim(p_reason),
    btrim(p_consequence_of_wrong),btrim(p_required_validation),
    'schedule_safety_critical_work','reschedule_safety_critical_work',
    jsonb_build_object('proposedDate',p_proposed_date,
      'originalScheduledDate',w.scheduled_date,'originalDueDate',w.due_date),
    w.control_revision,auth.uid()
  ) returning id into v_id;
  perform set_config('app.maintenance_change_control_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_change_request',v_role,jsonb_build_object(
    'approval_id',v_id,'work_order_id',w.id,
    'action','reschedule_safety_critical_work','requested_by',auth.uid(),
    'proposed_effective_at',p_proposed_date));
  return jsonb_build_object('approval_id',v_id,'work_order_id',w.id,
    'status','required','action','reschedule_safety_critical_work');
exception when unique_violation then
  return jsonb_build_object('error','an open safety-critical scheduling request already exists for this work order');
end $$;

create or replace function public.decide_maintenance_change_control(
  p_approval_id uuid,
  p_outcome text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  a public.approvals%rowtype;
  w public.work_orders%rowtype;
  d public.decision_rights%rowtype;
  r public.risks%rowtype;
  ra public.risk_acceptances%rowtype;
  v_effective timestamptz;
  v_old_status text;
  v_new_status text;
  v_result_revision integer;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role='ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot decide maintenance change control');
  end if;
  if coalesce(v_role,'') not in ('maintenance_manager','admin') then
    return jsonb_build_object('error','maintenance change approval requires a named maintenance manager or administrator');
  end if;
  if p_outcome not in ('approved','rejected') then
    return jsonb_build_object('error','outcome must be approved or rejected');
  end if;
  if coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','record the decision basis (20 characters minimum)');
  end if;
  select * into a from public.approvals
  where id=p_approval_id and organization_id=v_org
    and decision_right_key in ('defer_critical_work','schedule_safety_critical_work');
  if not found then return jsonb_build_object('error','maintenance change request not found in this tenant'); end if;
  if a.status not in ('required','pending') then
    return jsonb_build_object('error','maintenance change request is already decided');
  end if;
  if a.requested_by=auth.uid() then
    return jsonb_build_object('error','cannot approve your own maintenance change request');
  end if;
  select * into d from public.decision_rights where right_key=a.decision_right_key;
  if not found or d.tier<>'approval' or d.enforcement<>'enforced'
     or d.required_authority<>'maintenance_manager' then
    return jsonb_build_object('error','the governed decision right is not enforced for maintenance-manager authority');
  end if;
  select * into w from public.work_orders
  where id=a.work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','same-tenant work order not found'); end if;
  -- Requests lock work first.  Re-lock the approval in the same order so a
  -- concurrent request and decision cannot deadlock each other, then recheck
  -- the mutable decision state under that lock.
  select * into a from public.approvals
  where id=p_approval_id and organization_id=v_org
    and decision_right_key in ('defer_critical_work','schedule_safety_critical_work')
  for update;
  if not found then return jsonb_build_object('error','maintenance change request not found in this tenant'); end if;
  if a.status not in ('required','pending') then
    return jsonb_build_object('error','maintenance change request is already decided');
  end if;
  if a.requested_by=auth.uid() then
    return jsonb_build_object('error','cannot approve your own maintenance change request');
  end if;
  if w.control_revision<>a.subject_revision then
    return jsonb_build_object('error','request snapshot is stale; the work order changed after review was requested');
  end if;
  v_result_revision:=w.control_revision;
  v_old_status:=w.status;
  if p_outcome='approved' then
    begin
      v_effective:=coalesce(a.request_payload->>'deferredUntil',a.request_payload->>'proposedDate')::timestamptz;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('error','the requested effective date is invalid');
    end;
    if v_effective is null or v_effective<=now() then
      return jsonb_build_object('error','the requested effective date is no longer in the future');
    end if;
    if a.action_type='defer_critical_work' then
      if not public.maintenance_work_is_critical(w) then
        return jsonb_build_object('error','the work is no longer recorded as critical; request a new review');
      end if;
      if w.risk_id is null then return jsonb_build_object('error','the linked governed risk is missing'); end if;
      select * into r from public.risks
      where id=w.risk_id and organization_id=v_org
        and status not in ('closed','archived') and residual_risk_level is not null;
      if not found then return jsonb_build_object('error','the linked governed risk is not active and evaluated'); end if;
      select * into ra from public.risk_acceptances
      where organization_id=v_org and subject_type='risk' and subject_id=w.risk_id
        and accepted_by=auth.uid() and expires_at>now()
        and public.risk_rank(risk_level)>=public.risk_rank(r.residual_risk_level)
      order by created_at desc limit 1;
      if not found then
        return jsonb_build_object('error','the deciding manager must hold a current acceptance of the linked residual risk at or above its recorded level');
      end if;
      perform set_config('app.maintenance_change_control_write','granted',true);
      update public.work_orders set
        scheduled_date=to_char(v_effective at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        due_date=v_effective,deferred_until=v_effective,
        deferral_approval_id=a.id,
        control_revision=control_revision+1,updated_at=now()
      where id=w.id;
      v_result_revision:=w.control_revision+1;
      v_new_status:=w.status;
    elsif a.action_type='create_safety_critical_work' then
      if w.safety_flag is distinct from true or w.status<>'approval'
         or w.scheduled_date is not null or w.due_date is not null then
        return jsonb_build_object('error','the safety-critical draft changed after it was routed; request a new review');
      end if;
      perform set_config('app.maintenance_change_control_write','granted',true);
      update public.work_orders set
        status='scheduled',scheduled_date=to_char(v_effective at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        due_date=v_effective,approval_required=false,
        schedule_control_approval_id=a.id,schedule_controlled_by=auth.uid(),
        schedule_controlled_at=now(),control_revision=control_revision+1,updated_at=now()
      where id=w.id;
      v_result_revision:=w.control_revision+1;
      v_new_status:='scheduled';
    elsif a.action_type='reschedule_safety_critical_work' then
      if w.safety_flag is distinct from true then
        return jsonb_build_object('error','the work is no longer recorded as safety-critical; request a new review');
      end if;
      perform set_config('app.maintenance_change_control_write','granted',true);
      update public.work_orders set
        status=case when w.status='approval' then 'scheduled' else status end,
        scheduled_date=to_char(v_effective at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        due_date=v_effective,
        approval_required=case when w.status='approval' then false else approval_required end,
        schedule_control_approval_id=a.id,schedule_controlled_by=auth.uid(),
        schedule_controlled_at=now(),control_revision=control_revision+1,updated_at=now()
      where id=w.id;
      v_result_revision:=w.control_revision+1;
      v_new_status:=case when w.status='approval' then 'scheduled' else w.status end;
    else
      return jsonb_build_object('error','unsupported maintenance change action');
    end if;
  else
    perform set_config('app.maintenance_change_control_write','granted',true);
    if a.action_type='create_safety_critical_work' then
      update public.work_orders set status='blocked',control_revision=control_revision+1,
        updated_at=now() where id=w.id;
      v_result_revision:=w.control_revision+1;
      v_new_status:='blocked';
    else
      v_new_status:=w.status;
    end if;
  end if;

  update public.approvals set status=p_outcome,decided_by=auth.uid(),
    decided_at=now(),decision_note=btrim(p_note),
    approver=coalesce((select coalesce(u.full_name,u.email) from public.user_profiles u
      where u.id=auth.uid()),auth.uid()::text),
    decided_payload=jsonb_build_object(
      'effectiveAt',case when p_outcome='approved' then v_effective else null end,
      'riskAcceptanceId',case when a.action_type='defer_critical_work' and p_outcome='approved' then ra.id else null end,
      'resultingRevision',v_result_revision)
  where id=a.id;
  perform set_config('app.maintenance_change_control_write','',true);

  insert into public.work_order_status_history(
    work_order_id,status_from,status_to,changed_by,comments
  ) values(w.id,v_old_status,v_new_status,auth.uid(),format(
    'Governed %s request %s %s by %s: %s',a.action_type,a.id,p_outcome,v_role,btrim(p_note)));
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_change_decision',v_role,jsonb_build_object(
    'approval_id',a.id,'work_order_id',w.id,'action',a.action_type,
    'outcome',p_outcome,'decided_by',auth.uid(),'decision_note',btrim(p_note),
    'effective_at',case when p_outcome='approved' then v_effective else null end,
    'risk_acceptance_id',case when a.action_type='defer_critical_work' and p_outcome='approved' then ra.id else null end));
  return jsonb_build_object('approval_id',a.id,'work_order_id',w.id,
    'action',a.action_type,'status',p_outcome,
    'resulting_revision',v_result_revision,
    'authority','This bounded work-record act does not release a schedule, spend money, change an operating limit or return equipment to service.');
end $$;

create or replace function public.get_maintenance_change_control_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with me as (
    select u.role from public.user_profiles u
    where u.id=auth.uid() and u.organization_id=public.app_current_org()
  )
  select jsonb_build_object(
    'callerRole',coalesce((select role from me),''),
    'canRequest',coalesce((select role<>'ai_admin' from me),false),
    'canDecide',coalesce((select role in ('maintenance_manager','admin') from me),false),
    'control','Approval changes only the bounded work record. It does not release a schedule, spend money, change an operating limit or return equipment to service.',
    'workOrders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'number',w.wo_number,'title',w.title,'assetId',w.asset_id,
      'assetName',a.name,'status',w.status,'priority',w.priority,
      'safetyFlag',w.safety_flag,'scheduledDate',w.scheduled_date,
      'dueDate',w.due_date,'riskId',w.risk_id,
      'controlRevision',w.control_revision,'deferredUntil',w.deferred_until)
      order by w.created_at desc)
      from public.work_orders w left join public.assets a on a.id=w.asset_id
      where w.organization_id=public.app_current_org()
        and lower(coalesce(w.status,'')) not in ('completed','cancelled','closed')
        and (w.safety_flag or public.maintenance_work_is_critical(w))),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'tag',coalesce(a.tag,a.asset_tag)) order by a.name)
      from public.assets a where a.organization_id=public.app_current_org()),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object(
      'id',ap.id,'action',ap.action_type,'status',ap.status,
      'workOrderId',ap.work_order_id,'workOrderTitle',w.title,
      'requestedBy',coalesce(req.full_name,req.email,ap.requested_by::text),
      'requestedAt',ap.created_at,
      'proposedEffectiveAt',coalesce(ap.request_payload->>'deferredUntil',ap.request_payload->>'proposedDate'),
      'reason',ap.reason,'consequenceOfWrong',ap.consequence_of_wrong,
      'requiredValidation',ap.required_validation,
      'riskAcceptanceReady',case when ap.action_type='defer_critical_work' then exists(
        select 1 from public.risk_acceptances ra join public.risks r
          on r.id=w.risk_id and r.organization_id=ap.organization_id
        where ra.organization_id=ap.organization_id and ra.subject_type='risk'
          and ra.subject_id=w.risk_id and ra.accepted_by=auth.uid()
          and ra.expires_at>now()
          and public.risk_rank(ra.risk_level)>=public.risk_rank(r.residual_risk_level)
      ) else true end,
      'isOwnRequest',ap.requested_by=auth.uid(),
      'decidedBy',coalesce(decider.full_name,decider.email,ap.decided_by::text),
      'decidedAt',ap.decided_at,'decisionNote',ap.decision_note)
      order by ap.created_at desc)
      from public.approvals ap
      join public.work_orders w on w.id=ap.work_order_id and w.organization_id=ap.organization_id
      left join public.user_profiles req on req.id=ap.requested_by
      left join public.user_profiles decider on decider.id=ap.decided_by
      where ap.organization_id=public.app_current_org()
        and ap.decision_right_key in ('defer_critical_work','schedule_safety_critical_work')),'[]'::jsonb)
  );
$$;

revoke all on function public.request_critical_work_deferral(uuid,timestamptz,text,text,text)
  from public,anon;
revoke all on function public.request_safety_critical_work(jsonb)
  from public,anon;
revoke all on function public.request_safety_critical_reschedule(uuid,timestamptz,text,text,text)
  from public,anon;
revoke all on function public.decide_maintenance_change_control(uuid,text,text)
  from public,anon;
revoke all on function public.get_maintenance_change_control_workspace()
  from public,anon;
grant execute on function public.request_critical_work_deferral(uuid,timestamptz,text,text,text)
  to authenticated;
grant execute on function public.request_safety_critical_work(jsonb)
  to authenticated;
grant execute on function public.request_safety_critical_reschedule(uuid,timestamptz,text,text,text)
  to authenticated;
grant execute on function public.decide_maintenance_change_control(uuid,text,text)
  to authenticated;
grant execute on function public.get_maintenance_change_control_workspace()
  to authenticated;

notify pgrst,'reload schema';
