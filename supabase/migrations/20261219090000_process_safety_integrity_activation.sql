-- ============================================================================
-- Process-safety and integrity activation (E2.06, E2.08, E2.10–E2.12)
--
-- The safety register already exists. This migration deliberately adds no
-- second register: it supplies the only client-facing doors for the canonical
-- inspection, relief, loss-of-containment, impairment and temporary-change
-- records. Every door identifies the human actor, requires an evidence basis,
-- scopes every lookup to the caller's organisation and records an append-only
-- control event. AI identities may read posture but may not make a safety
-- declaration or approve a deviation.
-- ============================================================================

create table if not exists process_safety_control_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  event_type text not null check (event_type in
    ('inspection_plan_recorded','relief_device_registered','containment_loss_recorded',
     'inspection_completed','relief_device_test_recorded',
     'barrier_impairment_declared','barrier_deviation_approved',
     'barrier_impairment_restored','temporary_modification_recorded',
     'temporary_modification_removed')),
  subject_table text not null,
  subject_id bigint not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  evidence_basis text not null check (length(btrim(evidence_basis)) >= 20),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ps_control_events_org_subject
  on process_safety_control_events(organization_id, subject_table, subject_id, created_at desc);

alter table process_safety_control_events enable row level security;
drop policy if exists ps_control_event_read on process_safety_control_events;
create policy ps_control_event_read on process_safety_control_events
  for select to authenticated using (organization_id = app_current_org());

-- The records named below are safety assertions. Browser writes remain closed;
-- SECURITY DEFINER doors make all authority and evidence checks unavoidable.
revoke insert, update, delete on inspection_plans, relief_devices, containment_losses,
  barrier_impairments, temporary_modifications, process_safety_control_events from authenticated;

create or replace function public.assert_process_safety_actor(p_action text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := app_current_org(); v_role text; v_uid uuid := auth.uid();
begin
  if v_org is null or v_uid is null then
    raise exception '% requires an authenticated organization member', p_action using errcode='insufficient_privilege';
  end if;
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') = 'ai_admin' then
    raise exception 'AI may describe a process-safety record but cannot %; a named human must make this safety assertion', p_action using errcode='insufficient_privilege';
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    raise exception '% requires an operations, maintenance, engineering or governance role', p_action using errcode='insufficient_privilege';
  end if;
  return v_uid;
end $$;

create or replace function public.record_inspection_completion(p_plan_id bigint, p_performed_on date, p_next_due date, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid;
begin
 v_uid:=assert_process_safety_actor('record an inspection completion');
 if p_performed_on is null or p_next_due is null or p_next_due<p_performed_on or length(btrim(coalesce(p_basis,'')))<20 then raise exception 'performed date, a due date on or after it, and a 20-character evidence basis are required'; end if;
 update inspection_plans set last_performed=p_performed_on,next_due=p_next_due where id=p_plan_id and organization_id=v_org;
 if not found then raise exception 'inspection plan not found'; end if;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'inspection_completed','inspection_plans',p_plan_id,v_uid,p_basis,jsonb_build_object('performed_on',p_performed_on,'next_due',p_next_due));
 return jsonb_build_object('id',p_plan_id,'status','completed');
end $$;

create or replace function public.record_inspection_plan(p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid;
  v_circuit bigint; v_basis text:=nullif(btrim(p_plan->>'interval_basis'),'');
  v_interval int; v_due date;
begin
  v_uid:=assert_process_safety_actor('record an inspection plan');
  v_asset:=nullif(p_plan->>'asset_id','')::uuid; v_circuit:=nullif(p_plan->>'circuit_id','')::bigint;
  v_interval:=nullif(p_plan->>'interval_months','')::int; v_due:=nullif(p_plan->>'next_due','')::date;
  if v_asset is null and v_circuit is null then raise exception 'an inspection plan must name an asset or corrosion circuit'; end if;
  if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'asset is not in this organization'; end if;
  if v_circuit is not null and not exists(select 1 from corrosion_circuits where id=v_circuit and organization_id=v_org) then raise exception 'corrosion circuit is not in this organization'; end if;
  if v_interval is null or v_interval<=0 or v_due is null or v_basis is null or length(v_basis)<20 then raise exception 'state a positive interval, next due date, and at least 20 characters of interval basis; SyncAI does not invent inspection intervals'; end if;
  insert into inspection_plans(organization_id,circuit_id,asset_id,probability_category,consequence_category,risk_rank,interval_months,interval_basis,next_due,last_performed)
  values(v_org,v_circuit,v_asset,nullif(p_plan->>'probability_category',''),nullif(p_plan->>'consequence_category',''),nullif(p_plan->>'risk_rank',''),v_interval,v_basis,v_due,nullif(p_plan->>'last_performed','')::date) returning id into v_id;
  insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
  values(v_org,'inspection_plan_recorded','inspection_plans',v_id,v_uid,v_basis,jsonb_build_object('asset_id',v_asset,'circuit_id',v_circuit));
  return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_relief_device_test(p_device_id bigint, p_tested_on date, p_result text, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid;
begin
 v_uid:=assert_process_safety_actor('record a relief-device test');
 if p_tested_on is null or p_result not in ('pass','pass_after_adjustment','fail_leak','fail_set_pressure','fail_stuck') or length(btrim(coalesce(p_basis,'')))<20 then raise exception 'test date, recognized result, and a 20-character evidence basis are required'; end if;
 update relief_devices set last_tested_on=p_tested_on,last_test_result=p_result where id=p_device_id and organization_id=v_org;
 if not found then raise exception 'relief device not found'; end if;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'relief_device_test_recorded','relief_devices',p_device_id,v_uid,p_basis,jsonb_build_object('tested_on',p_tested_on,'result',p_result));
 return jsonb_build_object('id',p_device_id,'status','test_recorded');
end $$;

create or replace function public.register_relief_device(p_device jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid:=nullif(p_device->>'asset_id','')::uuid;
 v_ref text:=nullif(btrim(p_device->>'device_ref'),''); v_case text:=nullif(btrim(p_device->>'governing_case'),''); v_basis text:=nullif(btrim(p_device->>'evidence_basis'),'');
begin
 v_uid:=assert_process_safety_actor('register a relief device');
 if v_ref is null or nullif(p_device->>'device_kind','') is null or v_case is null or v_basis is null or length(v_basis)<20 then raise exception 'device reference, kind, governing relieving case, and 20-character evidence basis are required'; end if;
 if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'asset is not in this organization'; end if;
 insert into relief_devices(organization_id,asset_id,device_ref,device_kind,set_pressure,set_pressure_unit,governing_case,test_interval_months,last_tested_on,last_test_result)
 values(v_org,v_asset,v_ref,p_device->>'device_kind',nullif(p_device->>'set_pressure','')::numeric,nullif(btrim(p_device->>'set_pressure_unit'),''),v_case,nullif(p_device->>'test_interval_months','')::int,nullif(p_device->>'last_tested_on','')::date,nullif(p_device->>'last_test_result','')) returning id into v_id;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'relief_device_registered','relief_devices',v_id,v_uid,v_basis,jsonb_build_object('device_ref',v_ref,'governing_case',v_case));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_containment_loss(p_loss jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid:=nullif(p_loss->>'asset_id','')::uuid;
 v_hazard bigint:=nullif(p_loss->>'hazard_id','')::bigint; v_sce bigint:=nullif(p_loss->>'barrier_that_failed','')::bigint; v_basis text:=nullif(btrim(p_loss->>'evidence_basis'),'');
begin
 v_uid:=assert_process_safety_actor('record a loss-of-containment event');
 if nullif(p_loss->>'occurred_at','') is null or nullif(p_loss->>'tier','') is null or v_basis is null or length(v_basis)<20 then raise exception 'occurrence time, API 754 tier, and 20-character evidence basis are required'; end if;
 if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'asset is not in this organization'; end if;
 if v_hazard is not null and not exists(select 1 from major_hazards where id=v_hazard and organization_id=v_org) then raise exception 'hazard is not in this organization'; end if;
 if v_sce is not null and not exists(select 1 from safety_critical_elements where id=v_sce and organization_id=v_org) then raise exception 'barrier is not in this organization'; end if;
 insert into containment_losses(organization_id,asset_id,hazard_id,occurred_at,substance,quantity,quantity_unit,tier,reached_environment,barrier_that_failed,investigation_reference)
 values(v_org,v_asset,v_hazard,(p_loss->>'occurred_at')::timestamptz,nullif(btrim(p_loss->>'substance'),''),nullif(p_loss->>'quantity','')::numeric,nullif(btrim(p_loss->>'quantity_unit'),''),p_loss->>'tier',coalesce((p_loss->>'reached_environment')::boolean,false),v_sce,nullif(btrim(p_loss->>'investigation_reference'),'')) returning id into v_id;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'containment_loss_recorded','containment_losses',v_id,v_uid,v_basis,jsonb_build_object('tier',p_loss->>'tier','barrier_that_failed',v_sce));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.declare_barrier_impairment(p_impairment jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_sce bigint:=nullif(p_impairment->>'sce_id','')::bigint;
 v_basis text:=nullif(btrim(p_impairment->>'evidence_basis'),''); v_expected date:=nullif(p_impairment->>'expected_restoration','')::date;
begin
 v_uid:=assert_process_safety_actor('declare a barrier impairment');
 if v_sce is null or not exists(select 1 from safety_critical_elements where id=v_sce and organization_id=v_org) then raise exception 'name a safety-critical element in this organization'; end if;
 if v_expected is null or v_expected<current_date or length(btrim(coalesce(p_impairment->>'reason','')))<20 or length(btrim(coalesce(p_impairment->>'compensating_measures','')))<20 or v_basis is null or length(v_basis)<20 then raise exception 'expected restoration, reason, compensating measures, and evidence basis must each be stated; no impairment is accepted without a control'; end if;
 insert into barrier_impairments(organization_id,sce_id,temporary_modification_id,started_at,expected_restoration,reason,compensating_measures)
 values(v_org,v_sce,nullif(p_impairment->>'temporary_modification_id','')::bigint,coalesce(nullif(p_impairment->>'started_at','')::timestamptz,now()),v_expected,p_impairment->>'reason',p_impairment->>'compensating_measures') returning id into v_id;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'barrier_impairment_declared','barrier_impairments',v_id,v_uid,v_basis,jsonb_build_object('sce_id',v_sce,'expected_restoration',v_expected));
 return jsonb_build_object('id',v_id,'status','awaiting_independent_deviation_approval');
end $$;

create or replace function public.approve_barrier_deviation(p_impairment_id bigint, p_expires_on date, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_role text; v_declared_by uuid; v_imp barrier_impairments%rowtype;
begin
 v_uid:=assert_process_safety_actor('approve a barrier deviation'); select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
 if v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then raise exception 'barrier-deviation approval requires accountable operations or engineering authority'; end if;
 select * into v_imp from barrier_impairments where id=p_impairment_id and organization_id=v_org and restored_at is null;
 if not found then raise exception 'open barrier impairment not found'; end if;
 select actor_id into v_declared_by from process_safety_control_events where subject_table='barrier_impairments' and subject_id=p_impairment_id and event_type='barrier_impairment_declared' order by created_at limit 1;
 if v_declared_by=v_uid then raise exception 'the person who declared an impairment cannot approve its deviation'; end if;
 if p_expires_on is null or p_expires_on<current_date or p_expires_on>v_imp.expected_restoration or length(btrim(coalesce(p_basis,'')))<20 then raise exception 'approval expiry must be today through the expected restoration date and carry a 20-character basis'; end if;
 update barrier_impairments set deviation_approved_by=v_uid,deviation_approved_at=now(),deviation_expires_on=p_expires_on where id=p_impairment_id;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'barrier_deviation_approved','barrier_impairments',p_impairment_id,v_uid,p_basis,jsonb_build_object('expires_on',p_expires_on));
 return jsonb_build_object('id',p_impairment_id,'status','approved','expires_on',p_expires_on);
end $$;

create or replace function public.restore_barrier_impairment(p_impairment_id bigint, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid;
begin
 v_uid:=assert_process_safety_actor('record barrier restoration');
 if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'state at least 20 characters of restoration evidence basis'; end if;
 update barrier_impairments set restored_at=now() where id=p_impairment_id and organization_id=v_org and restored_at is null;
 if not found then raise exception 'open barrier impairment not found'; end if;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis)
 values(v_org,'barrier_impairment_restored','barrier_impairments',p_impairment_id,v_uid,p_basis);
 return jsonb_build_object('id',p_impairment_id,'status','restored');
end $$;

create or replace function public.record_safety_temporary_modification(p_modification jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid:=nullif(p_modification->>'asset_id','')::uuid;
 v_due date:=nullif(p_modification->>'required_removal_by','')::date; v_basis text:=nullif(btrim(p_modification->>'evidence_basis'),'');
 v_sce bigint:=nullif(p_modification->>'sce_id','')::bigint; v_impairment bigint;
begin
 v_uid:=assert_process_safety_actor('record a temporary modification');
 if v_asset is null or not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'name an asset in this organization'; end if;
 if nullif(p_modification->>'modification_kind','') is null or length(btrim(coalesce(p_modification->>'description','')))<20 or length(btrim(coalesce(p_modification->>'reason','')))<20 or v_due is null or v_due<current_date or v_basis is null or length(v_basis)<20 then raise exception 'kind, description, reason, future removal date, and evidence basis are required'; end if;
 if coalesce((p_modification->>'affects_safety_function')::boolean,false) then
   if v_sce is null or not exists(select 1 from safety_critical_elements where id=v_sce and organization_id=v_org) then raise exception 'a temporary modification affecting a safety function must name the affected safety-critical element'; end if;
   if length(btrim(coalesce(p_modification->>'compensating_measures','')))<20 then raise exception 'a safety-function modification requires stated compensating measures before it is recorded'; end if;
   if length(btrim(coalesce(p_modification->>'risk_assessment_ref','')))<3 then raise exception 'a safety-function modification requires a controlled risk-assessment reference'; end if;
 end if;
 insert into temporary_modifications(organization_id,asset_id,position_ref,modification_kind,description,reason,required_removal_by,installed_at,installed_by,risk_assessment_ref,affects_safety_function,work_order_id)
 values(v_org,v_asset,nullif(btrim(p_modification->>'position_ref'),''),p_modification->>'modification_kind',p_modification->>'description',p_modification->>'reason',v_due,coalesce(nullif(p_modification->>'installed_at','')::timestamptz,now()),v_uid,nullif(btrim(p_modification->>'risk_assessment_ref'),''),coalesce((p_modification->>'affects_safety_function')::boolean,false),nullif(p_modification->>'work_order_id','')::uuid) returning id into v_id;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
 values(v_org,'temporary_modification_recorded','temporary_modifications',v_id,v_uid,v_basis,jsonb_build_object('affects_safety_function',coalesce((p_modification->>'affects_safety_function')::boolean,false),'required_removal_by',v_due));
 if coalesce((p_modification->>'affects_safety_function')::boolean,false) then
   insert into barrier_impairments(organization_id,sce_id,temporary_modification_id,expected_restoration,reason,compensating_measures)
   values(v_org,v_sce,v_id,v_due,p_modification->>'reason',p_modification->>'compensating_measures') returning id into v_impairment;
   insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis,detail)
   values(v_org,'barrier_impairment_declared','barrier_impairments',v_impairment,v_uid,v_basis,jsonb_build_object('sce_id',v_sce,'temporary_modification_id',v_id,'expected_restoration',v_due));
   return jsonb_build_object('id',v_id,'status','awaiting_independent_deviation_approval','barrier_impairment_id',v_impairment);
 end if;
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.remove_safety_temporary_modification(p_modification_id bigint, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid:=app_current_org(); v_uid uuid;
begin
 v_uid:=assert_process_safety_actor('record temporary-modification removal');
 if length(btrim(coalesce(p_basis,'')))<20 then raise exception 'state at least 20 characters of removal evidence basis'; end if;
 update temporary_modifications set removed_at=now(),removed_by=v_uid where id=p_modification_id and organization_id=v_org and removed_at is null;
 if not found then raise exception 'open temporary modification not found'; end if;
 insert into process_safety_control_events(organization_id,event_type,subject_table,subject_id,actor_id,evidence_basis)
 values(v_org,'temporary_modification_removed','temporary_modifications',p_modification_id,v_uid,p_basis);
 return jsonb_build_object('id',p_modification_id,'status','removed');
end $$;

-- Each privileged door is explicitly closed to PUBLIC. Apart from being safer
-- to review, this prevents a later function-list edit from leaving one new
-- SECURITY DEFINER entrypoint with PostgreSQL's default PUBLIC execution.
revoke all on function public.assert_process_safety_actor(text) from public, anon;
revoke all on function public.record_inspection_plan(jsonb) from public, anon;
revoke all on function public.record_inspection_completion(bigint,date,date,text) from public, anon;
revoke all on function public.register_relief_device(jsonb) from public, anon;
revoke all on function public.record_relief_device_test(bigint,date,text,text) from public, anon;
revoke all on function public.record_containment_loss(jsonb) from public, anon;
revoke all on function public.declare_barrier_impairment(jsonb) from public, anon;
revoke all on function public.approve_barrier_deviation(bigint,date,text) from public, anon;
revoke all on function public.restore_barrier_impairment(bigint,text) from public, anon;
revoke all on function public.record_safety_temporary_modification(jsonb) from public, anon;
revoke all on function public.remove_safety_temporary_modification(bigint,text) from public, anon;
grant execute on function public.record_inspection_plan(jsonb), public.record_inspection_completion(bigint,date,date,text), public.register_relief_device(jsonb), public.record_relief_device_test(bigint,date,text,text), public.record_containment_loss(jsonb), public.declare_barrier_impairment(jsonb), public.approve_barrier_deviation(bigint,date,text), public.restore_barrier_impairment(bigint,text), public.record_safety_temporary_modification(jsonb), public.remove_safety_temporary_modification(bigint,text) to authenticated;

notify pgrst, 'reload schema';
