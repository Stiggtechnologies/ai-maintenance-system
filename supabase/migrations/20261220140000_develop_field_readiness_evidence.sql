-- Sync Develop D7.12 — close the three evidence gaps in the ONE ten-element
-- field-readiness predicate. This migration extends canonical identities:
-- work_orders stays the work; workforce_members/member_competencies/
-- shift_assignments stay the people, qualifications and roster; evidence_items
-- and verified geospatial assessments stay the provenance; and
-- restoration_constraints stays the release gate. No second verdict, queue,
-- approval model or audit store is introduced.

create table if not exists public.work_order_crew_assignments (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  member_id bigint not null references public.workforce_members(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  assignment_basis text not null,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  constraint work_order_crew_window check (ends_at > starts_at),
  constraint work_order_crew_basis check (length(btrim(assignment_basis)) >= 20),
  constraint work_order_crew_withdrawal_actor check ((withdrawn_at is null) = (withdrawn_by is null)),
  constraint work_order_crew_withdrawal_reason check (
    (withdrawn_at is null and withdrawal_reason is null)
    or (withdrawn_at is not null and length(btrim(coalesce(withdrawal_reason, ''))) >= 20))
);
create unique index if not exists uq_work_order_crew_assignment_live
  on public.work_order_crew_assignments(work_order_id, member_id)
  where withdrawn_at is null;
create index if not exists idx_work_order_crew_assignment_window
  on public.work_order_crew_assignments(organization_id, work_order_id, starts_at, ends_at)
  where withdrawn_at is null;

create table if not exists public.work_face_access_evidence (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  access_state text not null check (access_state in ('clear', 'blocked')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  geospatial_assessment_id uuid references public.geospatial_operational_assessments(id) on delete restrict,
  basis text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references auth.users(id),
  constraint work_face_access_window check (valid_until is null or valid_until > valid_from),
  constraint work_face_access_basis check (length(btrim(basis)) >= 20),
  constraint work_face_access_provenance check (num_nonnulls(evidence_item_id, geospatial_assessment_id) >= 1),
  constraint work_face_access_supersession check ((superseded_at is null) = (superseded_by is null))
);
create unique index if not exists uq_work_face_access_live
  on public.work_face_access_evidence(work_order_id) where superseded_at is null;
create index if not exists idx_work_face_access_position
  on public.work_face_access_evidence(organization_id, work_order_id, access_state, valid_until)
  where superseded_at is null;

create table if not exists public.work_order_predecessor_evidence (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  successor_work_order_id uuid not null references public.work_orders(id) on delete cascade,
  predecessor_work_order_id uuid references public.work_orders(id) on delete restrict,
  dependency_kind text not null check (dependency_kind in ('finish_to_start', 'explicit_none')),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  constraint work_order_predecessor_shape check (
    (dependency_kind = 'explicit_none' and predecessor_work_order_id is null)
    or (dependency_kind = 'finish_to_start' and predecessor_work_order_id is not null)),
  constraint work_order_predecessor_not_self check (
    predecessor_work_order_id is null or predecessor_work_order_id <> successor_work_order_id),
  constraint work_order_predecessor_basis check (length(btrim(basis)) >= 20),
  constraint work_order_predecessor_withdrawal_actor check ((withdrawn_at is null) = (withdrawn_by is null)),
  constraint work_order_predecessor_withdrawal_reason check (
    (withdrawn_at is null and withdrawal_reason is null)
    or (withdrawn_at is not null and length(btrim(coalesce(withdrawal_reason, ''))) >= 20))
);
create unique index if not exists uq_work_order_predecessor_edge_live
  on public.work_order_predecessor_evidence(successor_work_order_id, predecessor_work_order_id)
  where withdrawn_at is null and predecessor_work_order_id is not null;
create unique index if not exists uq_work_order_predecessor_none_live
  on public.work_order_predecessor_evidence(successor_work_order_id)
  where withdrawn_at is null and predecessor_work_order_id is null;
create index if not exists idx_work_order_predecessor_successor
  on public.work_order_predecessor_evidence(organization_id, successor_work_order_id)
  where withdrawn_at is null;

alter table public.work_order_crew_assignments enable row level security;
alter table public.work_face_access_evidence enable row level security;
alter table public.work_order_predecessor_evidence enable row level security;

drop policy if exists work_order_crew_assignments_read on public.work_order_crew_assignments;
create policy work_order_crew_assignments_read on public.work_order_crew_assignments
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists work_face_access_evidence_read on public.work_face_access_evidence;
create policy work_face_access_evidence_read on public.work_face_access_evidence
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists work_order_predecessor_evidence_read on public.work_order_predecessor_evidence;
create policy work_order_predecessor_evidence_read on public.work_order_predecessor_evidence
  for select to authenticated using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate on public.work_order_crew_assignments,
  public.work_face_access_evidence, public.work_order_predecessor_evidence
  from public, anon, authenticated, service_role;

create or replace function public.enforce_field_readiness_evidence_integrity()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_work_org uuid; v_other_org uuid; v_actor_role text; v_actor uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'field-readiness evidence is not truncatable; removing it would make prior release positions unexplainable'
      using errcode='insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id) then return old; end if;
    if tg_table_name='work_order_predecessor_evidence' then
      if not exists(select 1 from public.work_orders where id=old.successor_work_order_id) then return old; end if;
    elsif not exists(select 1 from public.work_orders where id=old.work_order_id) then
      return old;
    end if;
    raise exception 'field-readiness evidence is not deletable; withdraw or supersede it with a recorded reason'
      using errcode='insufficient_privilege';
  end if;

  if tg_table_name='work_order_predecessor_evidence' then
    select organization_id into v_work_org from public.work_orders where id=new.successor_work_order_id;
    v_actor:=coalesce(new.withdrawn_by,new.recorded_by);
  elsif tg_table_name='work_order_crew_assignments' then
    select organization_id into v_work_org from public.work_orders where id=new.work_order_id;
    v_actor:=coalesce(new.withdrawn_by,new.assigned_by);
  elsif tg_table_name='work_face_access_evidence' then
    select organization_id into v_work_org from public.work_orders where id=new.work_order_id;
    v_actor:=coalesce(new.superseded_by,new.recorded_by);
  else
    raise exception 'unsupported field-readiness evidence table %',tg_table_name;
  end if;
  if v_work_org is null or v_work_org<>new.organization_id then
    raise exception 'field-readiness evidence must reference work in its own organization';
  end if;
  if tg_table_name='work_order_crew_assignments' then
    if tg_op='UPDATE' and (new.organization_id,new.work_order_id,new.member_id,new.starts_at,new.ends_at,
        new.assignment_basis,new.assigned_by,new.assigned_at)
      is distinct from (old.organization_id,old.work_order_id,old.member_id,old.starts_at,old.ends_at,
        old.assignment_basis,old.assigned_by,old.assigned_at) then
      raise exception 'crew-assignment evidence is immutable; withdraw it and record a new assignment';
    end if;
    if tg_op='UPDATE' and old.withdrawn_at is not null and new is distinct from old then
      raise exception 'a withdrawn crew assignment is final';
    end if;
    select organization_id into v_other_org from public.workforce_members where id=new.member_id;
    if v_other_org is null or v_other_org<>new.organization_id then
      raise exception 'crew assignment must reference a workforce member in the work order organization';
    end if;
  elsif tg_table_name='work_face_access_evidence' then
    if tg_op='UPDATE' and (new.organization_id,new.work_order_id,new.access_state,new.valid_from,new.valid_until,
        new.evidence_item_id,new.geospatial_assessment_id,new.basis,new.recorded_by,new.recorded_at)
      is distinct from (old.organization_id,old.work_order_id,old.access_state,old.valid_from,old.valid_until,
        old.evidence_item_id,old.geospatial_assessment_id,old.basis,old.recorded_by,old.recorded_at) then
      raise exception 'work-face access evidence is immutable; supersede it with new evidence';
    end if;
    if tg_op='UPDATE' and old.superseded_at is not null and new is distinct from old then
      raise exception 'superseded work-face access evidence is final';
    end if;
    if new.evidence_item_id is not null and not exists(
      select 1 from public.evidence_items e where e.id=new.evidence_item_id
        and e.organization_id=new.organization_id and e.verification_status='verified') then
      raise exception 'work-face access requires independently verified same-tenant evidence';
    end if;
    if new.geospatial_assessment_id is not null and not exists(
      select 1 from public.geospatial_operational_assessments a
       where a.id=new.geospatial_assessment_id and a.organization_id=new.organization_id
         and a.assessment_type='access_route' and a.status='verified') then
      raise exception 'work-face access requires a verified same-tenant access-route assessment';
    end if;
  elsif tg_table_name='work_order_predecessor_evidence' then
    if tg_op='UPDATE' and (new.organization_id,new.successor_work_order_id,new.predecessor_work_order_id,
        new.dependency_kind,new.evidence_item_id,new.basis,new.recorded_by,new.recorded_at)
      is distinct from (old.organization_id,old.successor_work_order_id,old.predecessor_work_order_id,
        old.dependency_kind,old.evidence_item_id,old.basis,old.recorded_by,old.recorded_at) then
      raise exception 'predecessor evidence is immutable; withdraw it and record a new position';
    end if;
    if tg_op='UPDATE' and old.withdrawn_at is not null and new is distinct from old then
      raise exception 'withdrawn predecessor evidence is final';
    end if;
    if new.predecessor_work_order_id is not null then
      select organization_id into v_other_org from public.work_orders where id=new.predecessor_work_order_id;
      if v_other_org is null or v_other_org<>new.organization_id then
        raise exception 'predecessor and successor work orders must belong to the same organization';
      end if;
    end if;
    if not exists(select 1 from public.evidence_items e where e.id=new.evidence_item_id
      and e.organization_id=new.organization_id and e.verification_status='verified') then
      raise exception 'predecessor evidence requires independently verified same-tenant evidence';
    end if;
    if new.withdrawn_at is null and new.predecessor_work_order_id is not null and exists(
      with recursive walk(id) as (
        select new.predecessor_work_order_id
        union
        select d.predecessor_work_order_id
          from public.work_order_predecessor_evidence d join walk w on d.successor_work_order_id=w.id
         where d.organization_id=new.organization_id and d.withdrawn_at is null
           and d.predecessor_work_order_id is not null)
      select 1 from walk where id=new.successor_work_order_id) then
      raise exception 'work-order predecessor edge would create a cycle; readiness is refused';
    end if;
    if new.withdrawn_at is null and new.predecessor_work_order_id is null and exists(
      select 1 from public.work_order_predecessor_evidence d
       where d.organization_id=new.organization_id and d.successor_work_order_id=new.successor_work_order_id
         and d.withdrawn_at is null and d.predecessor_work_order_id is not null and d.id<>coalesce(new.id,0)) then
      raise exception 'explicit-none predecessor evidence cannot coexist with active predecessor edges';
    end if;
    if new.withdrawn_at is null and new.predecessor_work_order_id is not null and exists(
      select 1 from public.work_order_predecessor_evidence d
       where d.organization_id=new.organization_id and d.successor_work_order_id=new.successor_work_order_id
         and d.withdrawn_at is null and d.predecessor_work_order_id is null and d.id<>coalesce(new.id,0)) then
      raise exception 'withdraw the explicit-none review before recording a predecessor edge';
    end if;
  end if;

  select role into v_actor_role from public.user_profiles
   where id=v_actor and organization_id=new.organization_id;
  if v_actor_role is null then
    raise exception 'field-readiness evidence requires a named actor in the work order organization';
  end if;
  if coalesce(v_actor_role,'')='ai_admin' then
    raise exception 'AI may identify a possible field-readiness fact but cannot assign crew, verify work-face access, or establish predecessor evidence';
  end if;
  return new;
end $$;

revoke all on function public.enforce_field_readiness_evidence_integrity()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_work_order_crew_evidence_integrity on public.work_order_crew_assignments;
create trigger trg_work_order_crew_evidence_integrity
  before insert or update or delete on public.work_order_crew_assignments
  for each row execute function public.enforce_field_readiness_evidence_integrity();
drop trigger if exists trg_work_order_crew_evidence_no_truncate on public.work_order_crew_assignments;
create trigger trg_work_order_crew_evidence_no_truncate before truncate on public.work_order_crew_assignments
  for each statement execute function public.enforce_field_readiness_evidence_integrity();
drop trigger if exists trg_work_face_access_evidence_integrity on public.work_face_access_evidence;
create trigger trg_work_face_access_evidence_integrity
  before insert or update or delete on public.work_face_access_evidence
  for each row execute function public.enforce_field_readiness_evidence_integrity();
drop trigger if exists trg_work_face_access_evidence_no_truncate on public.work_face_access_evidence;
create trigger trg_work_face_access_evidence_no_truncate before truncate on public.work_face_access_evidence
  for each statement execute function public.enforce_field_readiness_evidence_integrity();
drop trigger if exists trg_work_order_predecessor_evidence_integrity on public.work_order_predecessor_evidence;
create trigger trg_work_order_predecessor_evidence_integrity
  before insert or update or delete on public.work_order_predecessor_evidence
  for each row execute function public.enforce_field_readiness_evidence_integrity();
drop trigger if exists trg_work_order_predecessor_evidence_no_truncate on public.work_order_predecessor_evidence;
create trigger trg_work_order_predecessor_evidence_no_truncate before truncate on public.work_order_predecessor_evidence
  for each statement execute function public.enforce_field_readiness_evidence_integrity();

-- Human-only write doors. These produce evidence; they never clear a
-- restoration constraint and never release work.
create or replace function public.assign_work_order_crew(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_work uuid:=nullif(p_payload->>'work_order_id','')::uuid;
  v_member bigint:=nullif(p_payload->>'member_id','')::bigint;
  v_start timestamptz:=nullif(p_payload->>'starts_at','')::timestamptz;
  v_end timestamptz:=nullif(p_payload->>'ends_at','')::timestamptz; v_id bigint;
begin
  if v_org is null or coalesce(v_role,'') not in ('planner','supervisor','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','crew assignment requires a named planning, supervisory, management or governance human role'); end if;
  if v_start is null or v_end is null or v_end<=v_start then return jsonb_build_object('error','crew assignment requires a valid start and end'); end if;
  if coalesce(length(btrim(p_payload->>'basis')),0)<20 then return jsonb_build_object('error','record a substantive crew-assignment basis'); end if;
  insert into public.work_order_crew_assignments(organization_id,work_order_id,member_id,starts_at,ends_at,assignment_basis,assigned_by)
  values(v_org,v_work,v_member,v_start,v_end,btrim(p_payload->>'basis'),auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'work_order_crew_assignment',v_role,jsonb_build_object('assignment_id',v_id,'work_order_id',v_work,'member_id',v_member,'automatic_release',false));
  return jsonb_build_object('answered',true,'assignmentId',v_id,'status','assigned');
exception when unique_violation then return jsonb_build_object('error','that workforce member is already actively assigned to this work order');
when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.withdraw_work_order_crew_assignment(p_assignment_id bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); a public.work_order_crew_assignments%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in ('planner','supervisor','maintenance_manager','executive','admin') then return jsonb_build_object('error','crew withdrawal requires a named human authority'); end if;
  if coalesce(length(btrim(p_reason)),0)<20 then return jsonb_build_object('error','record why the crew assignment is withdrawn'); end if;
  select * into a from public.work_order_crew_assignments where id=p_assignment_id and organization_id=v_org and withdrawn_at is null for update;
  if not found then return jsonb_build_object('error','active crew assignment not found'); end if;
  update public.work_order_crew_assignments set withdrawn_by=auth.uid(),withdrawn_at=now(),withdrawal_reason=btrim(p_reason) where id=a.id;
  return jsonb_build_object('answered',true,'assignmentId',a.id,'status','withdrawn');
end $$;

create or replace function public.record_work_face_access(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id bigint;
  v_work uuid:=nullif(p_payload->>'work_order_id','')::uuid;
  v_evidence uuid:=nullif(p_payload->>'evidence_item_id','')::uuid;
  v_geo uuid:=nullif(p_payload->>'geospatial_assessment_id','')::uuid;
  v_from timestamptz:=nullif(p_payload->>'valid_from','')::timestamptz;
  v_until timestamptz:=nullif(p_payload->>'valid_until','')::timestamptz;
begin
  if v_org is null or coalesce(v_role,'') not in ('planner','supervisor','maintenance_manager','reliability_engineer','executive','admin') then return jsonb_build_object('error','work-face access verification requires a named human role'); end if;
  if p_payload->>'access_state' not in ('clear','blocked') then return jsonb_build_object('error','access state must be clear or blocked'); end if;
  if v_from is null or (v_until is not null and v_until<=v_from) then return jsonb_build_object('error','work-face access requires a valid evidence window'); end if;
  if coalesce(length(btrim(p_payload->>'basis')),0)<20 then return jsonb_build_object('error','record a substantive access-verification basis'); end if;
  update public.work_face_access_evidence set superseded_at=now(),superseded_by=auth.uid()
   where organization_id=v_org and work_order_id=v_work and superseded_at is null;
  insert into public.work_face_access_evidence(organization_id,work_order_id,access_state,valid_from,valid_until,evidence_item_id,geospatial_assessment_id,basis,recorded_by)
  values(v_org,v_work,p_payload->>'access_state',v_from,v_until,v_evidence,v_geo,btrim(p_payload->>'basis'),auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'work_face_access_evidence',v_role,jsonb_build_object('access_evidence_id',v_id,'work_order_id',v_work,'state',p_payload->>'access_state','automatic_release',false));
  return jsonb_build_object('answered',true,'accessEvidenceId',v_id,'state',p_payload->>'access_state');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.record_work_order_predecessor(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id bigint;
  v_successor uuid:=nullif(p_payload->>'successor_work_order_id','')::uuid;
  v_predecessor uuid:=nullif(p_payload->>'predecessor_work_order_id','')::uuid;
  v_evidence uuid:=nullif(p_payload->>'evidence_item_id','')::uuid;
begin
  if v_org is null or coalesce(v_role,'') not in ('planner','supervisor','maintenance_manager','reliability_engineer','executive','admin') then return jsonb_build_object('error','predecessor evidence requires a named human role'); end if;
  if coalesce(length(btrim(p_payload->>'basis')),0)<20 then return jsonb_build_object('error','record a substantive predecessor basis'); end if;
  if v_predecessor is null then
    update public.work_order_predecessor_evidence set withdrawn_by=auth.uid(),withdrawn_at=now(),withdrawal_reason='Superseded by an explicit reviewed no-predecessor position.'
     where organization_id=v_org and successor_work_order_id=v_successor and withdrawn_at is null;
  else
    update public.work_order_predecessor_evidence set withdrawn_by=auth.uid(),withdrawn_at=now(),withdrawal_reason='Superseded by a recorded predecessor edge.'
     where organization_id=v_org and successor_work_order_id=v_successor and predecessor_work_order_id is null and withdrawn_at is null;
  end if;
  insert into public.work_order_predecessor_evidence(organization_id,successor_work_order_id,predecessor_work_order_id,dependency_kind,evidence_item_id,basis,recorded_by)
  values(v_org,v_successor,v_predecessor,case when v_predecessor is null then 'explicit_none' else 'finish_to_start' end,v_evidence,btrim(p_payload->>'basis'),auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'work_order_predecessor_evidence',v_role,jsonb_build_object('predecessor_evidence_id',v_id,'successor_work_order_id',v_successor,'predecessor_work_order_id',v_predecessor,'automatic_schedule_change',false,'automatic_release',false));
  return jsonb_build_object('answered',true,'predecessorEvidenceId',v_id,'kind',case when v_predecessor is null then 'explicit_none' else 'finish_to_start' end);
exception when unique_violation then return jsonb_build_object('error','that active predecessor position is already recorded');
when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.withdraw_work_order_predecessor(p_evidence_id bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); d public.work_order_predecessor_evidence%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in ('planner','supervisor','maintenance_manager','reliability_engineer','executive','admin') then return jsonb_build_object('error','predecessor withdrawal requires a named human role'); end if;
  if coalesce(length(btrim(p_reason)),0)<20 then return jsonb_build_object('error','record why the predecessor evidence is withdrawn'); end if;
  select * into d from public.work_order_predecessor_evidence where id=p_evidence_id and organization_id=v_org and withdrawn_at is null for update;
  if not found then return jsonb_build_object('error','active predecessor evidence not found'); end if;
  update public.work_order_predecessor_evidence set withdrawn_by=auth.uid(),withdrawn_at=now(),withdrawal_reason=btrim(p_reason) where id=d.id;
  return jsonb_build_object('answered',true,'predecessorEvidenceId',d.id,'status','withdrawn');
end $$;

revoke all on function public.assign_work_order_crew(jsonb) from public,anon,service_role;
revoke all on function public.withdraw_work_order_crew_assignment(bigint,text) from public,anon,service_role;
revoke all on function public.record_work_face_access(jsonb) from public,anon,service_role;
revoke all on function public.record_work_order_predecessor(jsonb) from public,anon,service_role;
revoke all on function public.withdraw_work_order_predecessor(bigint,text) from public,anon,service_role;
grant execute on function public.assign_work_order_crew(jsonb) to authenticated;
grant execute on function public.withdraw_work_order_crew_assignment(bigint,text) to authenticated;
grant execute on function public.record_work_face_access(jsonb) to authenticated;
grant execute on function public.record_work_order_predecessor(jsonb) to authenticated;
grant execute on function public.withdraw_work_order_predecessor(bigint,text) to authenticated;

-- Each helper returns exactly one element in the existing element shape. They
-- are internal and tenant-neutral; the parent predicate receives a work order
-- it already resolved and client roles cannot call these helpers directly.
create or replace function public.sync_field_readiness_crew_element(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  w public.work_orders%rowtype; v_required int:=0; v_assigned int:=0; v_rostered int:=0;
  v_requirements int:=0; v_requirements_met int:=0; v_detail text; v_state text;
begin
  select * into w from public.work_orders where id=p_work_order_id;
  if not found then return public.sync_field_readiness_element('crew','Crew assigned and competent','derived','unverifiable','Work order not found.','work_order_crew_assignments'); end if;
  select coalesce(sum(x.crew_size),0)::int into v_required from (
    select craft,max(crew_size)::int crew_size from public.job_plan_steps
     where job_plan_id=w.job_plan_id group by craft) x;
  select count(distinct a.member_id)::int,
         count(distinct a.member_id) filter(where exists(
           select 1 from public.shift_assignments s where s.organization_id=w.organization_id
             and s.member_id=a.member_id and s.shift_kind not in ('leave','training')
             and s.starts_at<=a.starts_at and s.ends_at>=a.ends_at))::int
    into v_assigned,v_rostered
    from public.work_order_crew_assignments a join public.workforce_members m on m.id=a.member_id
   where a.organization_id=w.organization_id and a.work_order_id=w.id and a.withdrawn_at is null and m.active;
  with req as (
    select distinct r.id,r.competency_id,r.min_holders
      from public.competency_requirements r
     where r.organization_id=w.organization_id and r.retired_at is null
       and (r.craft in (select distinct craft from public.job_plan_steps where job_plan_id=w.job_plan_id)
         or r.work_package_id in (select k.work_package_id from public.work_package_work k where k.work_order_id=w.id))),
  position as (
    select r.id,r.min_holders,count(distinct a.member_id) filter(where mc.id is not null and
      (mc.expires_on is null or mc.expires_on>=a.ends_at::date)) holders
      from req r left join public.work_order_crew_assignments a on a.organization_id=w.organization_id
        and a.work_order_id=w.id and a.withdrawn_at is null
      left join public.member_competencies mc on mc.organization_id=w.organization_id
        and mc.member_id=a.member_id and mc.competency_id=r.competency_id
     group by r.id,r.min_holders)
  select count(*)::int,count(*) filter(where holders>=min_holders)::int into v_requirements,v_requirements_met from position;
  if v_required=0 then v_state:='unverifiable'; v_detail:='No job-plan crew demand is recorded, so crew completeness cannot be checked.';
  elsif v_requirements=0 then v_state:='unverifiable'; v_detail:='No competency requirement applies to this work order or its package, so assigned headcount cannot be called competent.';
  elsif v_assigned<v_required then v_state:='blocked'; v_detail:=format('%s of %s required crew member(s) are actively assigned.',v_assigned,v_required);
  elsif v_rostered<v_assigned then v_state:='blocked'; v_detail:=format('%s assigned crew member(s) are not covered by a recorded working shift for their assignment window.',v_assigned-v_rostered);
  elsif v_requirements_met<v_requirements then v_state:='blocked'; v_detail:=format('%s of %s competency requirement(s) have enough assigned holders qualified through the work window.',v_requirements_met,v_requirements);
  else v_state:='ready'; v_detail:=format('%s assigned and rostered crew member(s) cover %s required position(s); all %s competency requirement(s) are met through the work window.',v_assigned,v_required,v_requirements); end if;
  return public.sync_field_readiness_element('crew','Crew assigned and competent','derived',v_state,v_detail,'work_order_crew_assignments + member_competencies + shift_assignments');
end $$;

create or replace function public.sync_field_readiness_access_element(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare w public.work_orders%rowtype; a public.work_face_access_evidence%rowtype; v_state text; v_detail text;
begin
  select * into w from public.work_orders where id=p_work_order_id;
  select * into a from public.work_face_access_evidence x where x.organization_id=w.organization_id and x.work_order_id=w.id and x.superseded_at is null order by x.recorded_at desc limit 1;
  if not found then v_state:='unverifiable'; v_detail:='No current evidence-backed work-face access position is recorded for this work order.';
  elsif a.valid_from>now() then v_state:='blocked'; v_detail:=format('Work-face access does not become valid until %s.',a.valid_from);
  elsif a.valid_until is not null and a.valid_until<=now() then v_state:='blocked'; v_detail:=format('Work-face access evidence expired on %s and must be reverified.',a.valid_until);
  elsif a.access_state='blocked' then v_state:='blocked'; v_detail:=a.basis;
  else v_state:='ready'; v_detail:=format('Work-face access is evidence-backed and current%s.',case when a.valid_until is null then '' else ' through '||a.valid_until::text end); end if;
  return public.sync_field_readiness_element('access','Access to the work face','derived',v_state,v_detail,'work_face_access_evidence');
end $$;

create or replace function public.sync_field_readiness_predecessor_element(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare w public.work_orders%rowtype; v_rows int:=0; v_edges int:=0; v_open int:=0; v_state text; v_detail text;
begin
  select * into w from public.work_orders where id=p_work_order_id;
  select count(*)::int,count(*) filter(where d.predecessor_work_order_id is not null)::int,
         count(*) filter(where d.predecessor_work_order_id is not null and coalesce(p.status,'')<>'completed')::int
    into v_rows,v_edges,v_open from public.work_order_predecessor_evidence d
    left join public.work_orders p on p.id=d.predecessor_work_order_id and p.organization_id=d.organization_id
   where d.organization_id=w.organization_id and d.successor_work_order_id=w.id and d.withdrawn_at is null;
  if v_rows=0 then v_state:='unverifiable'; v_detail:='No reviewed predecessor position is recorded for this work order; absence of an edge is not evidence that none exists.';
  elsif v_open>0 then v_state:='blocked'; v_detail:=format('%s of %s recorded predecessor work order(s) are not completed.',v_open,v_edges);
  elsif v_edges=0 then v_state:='not_applicable'; v_detail:='A named human reviewed the sequence and recorded that this work order has no predecessors.';
  else v_state:='ready'; v_detail:=format('All %s recorded predecessor work order(s) are completed.',v_edges); end if;
  return public.sync_field_readiness_element('predecessor','Predecessors complete','derived',v_state,v_detail,'work_order_predecessor_evidence + work_orders');
end $$;

revoke all on function public.sync_field_readiness_crew_element(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sync_field_readiness_access_element(uuid) from public,anon,authenticated,service_role;
revoke all on function public.sync_field_readiness_predecessor_element(uuid) from public,anon,authenticated,service_role;

-- Extend the ONE field-readiness predicate by guarded transformation. The
-- legacy three declared elements must all be present exactly once; otherwise
-- fail the migration rather than silently leaving two definitions alive.
do $patch$
declare v_def text; v_before text; v_after text;
begin
  select pg_get_functiondef('public.sync_field_readiness_elements(uuid,uuid)'::regprocedure) into v_def;
  v_before := $old$
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'crew', 'Crew assigned and competent', 'declared', 'unverifiable',
    'No canonical store binds a competency-verified crew to a work order: work_orders.assignee is free text and member_competencies binds a competency to a PERSON, not to a job. This element is discharged only as a LABOUR constraint a named person clears.',
    'none'));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'access', 'Access to the work face', 'declared', 'unverifiable',
    'No canonical store records physical access to a work face for a work order. Recovery derives a work-zone interference constraint BETWEEN two restoration items from work_zone_relationships, which is a different question. This element is discharged only as an ACCESS or SCAFFOLD constraint a named person clears.',
    'none'));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_element(
    'predecessor', 'Predecessors complete', 'declared', 'unverifiable',
    'No canonical store records work-order-level predecessors. The AWP chain records a PACKAGE parent, which sync_work_package_release_verdict already refuses on, and Recovery records sequence_no within one event; neither says which JOB must finish before this one. This element is discharged only as a PREDECESSOR constraint a named person clears.',
    'none'));
$old$;
  v_after := $new$
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_crew_element(w.id));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_access_element(w.id));
  v_elements := v_elements || jsonb_build_array(sync_field_readiness_predecessor_element(w.id));
$new$;
  if position(v_before in v_def)>0 then
    v_def:=replace(v_def,v_before,v_after);
  elsif position(v_after in v_def)=0 then
    raise exception 'refusing D7.12 predicate patch: neither legacy nor canonical three-element block found';
  end if;
  v_def:=replace(v_def,
    '''basis'', ''The ten §27 field-ready elements for one work order, read from the canonical stores that hold them. Seven are derived; three have no canonical object and say so rather than defaulting to ready.'');',
    '''basis'', ''The ten §27 field-ready elements for one work order. All ten are derived from canonical, evidence-backed stores; missing evidence remains unverifiable or blocked and never defaults to ready.'');');
  execute v_def;
end $patch$;

-- Re-assessment must retire the three machine-generated questions written by
-- the former 7-derived/3-declared model. They are not human evidence and must
-- not survive beside the new store-derived positions as a second answer. The
-- existing assessment audit already records every removed row, including its
-- state and verifier, so this is traceable replacement rather than erasure.
do $patch$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.assess_package_field_readiness(bigint)'::regprocedure) into v_def;
  v_old := $old$and source_kind = 'derived'
       and source_ref like 'awp-field-ready:derived:%'$old$;
  v_new := $new$and source_kind = 'derived'
       and (source_ref like 'awp-field-ready:derived:%'
         or source_ref similar to 'awp-field-ready:declared:(crew|access|predecessor):%')$new$;
  if position(v_old in v_def)>0 then
    v_def:=replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then
    raise exception 'refusing D7.12 assessment patch: neither legacy nor canonical replacement anchor found';
  end if;
  v_def:=replace(v_def,
    'Seven are derived; three have no canonical store and are recorded as UNKNOWN for a person to answer.',
    'All ten are derived from canonical stores. Missing, expired or insufficient evidence is recorded as BLOCKED or UNKNOWN and is resolved by correcting the source evidence, never by hand-clearing a derived row.');
  v_def:=replace(v_def,
    'an element no store can answer is recorded as UNKNOWN for a named person.',
    'an element whose canonical evidence is missing or insufficient is recorded as UNKNOWN until that evidence is supplied.');
  -- `unverifiableElements` formerly counted only the retired DECLARED branch.
  -- Missing canonical evidence now travels through the derived-question arm,
  -- so count it there as well or the lineage output says zero while writing
  -- UNKNOWN rows. Guard the rewrite so local reapplication stays idempotent.
  if position('v_unanswerable := v_unanswerable + 1;
          v_unverifiable := v_unverifiable + 1;' in v_def)=0 then
    v_old := 'v_unanswerable := v_unanswerable + 1;';
    v_new := 'v_unanswerable := v_unanswerable + 1;
          v_unverifiable := v_unverifiable + 1;';
    if position(v_old in v_def)=0 then
      raise exception 'refusing D7.12 unverifiable counter patch: derived-question counter anchor not found';
    end if;
    v_def:=replace(v_def,v_old,v_new);
  end if;
  execute v_def;
end $patch$;

comment on function public.assess_package_field_readiness(bigint) is
  'D7.05/D7.12: assesses all ten field-ready elements through the ONE work-order predicate and records only missing or blocking canonical evidence in the ONE constraint store. Re-assessment traceably replaces both current derived rows and the legacy machine-generated crew/access/predecessor questions. It never writes satisfied and never releases work.';

-- A fully ready assessment legitimately writes ZERO constraints. The legacy
-- verdict tested `v_total = 0` before consulting calculation_runs, making a
-- clean computed package indistinguishable from one nobody assessed. Preserve
-- the unassessed refusal only when no computed field walk exists.
do $patch$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.sync_work_package_release_verdict(bigint)'::regprocedure) into v_def;
  v_old := 'if v_total = 0 then';
  v_new := $new$if v_total = 0 and not exists (
    select 1 from calculation_runs assessed
     where assessed.organization_id = p.organization_id
       and assessed.calculation_key = 'package_field_readiness'
       and assessed.status = 'computed'
       and (assessed.inputs->>'workPackageId') = p.id::text
  ) then$new$;
  if position(v_new in v_def)=0 then
    if position(v_old in v_def)=0 then
      raise exception 'refusing D7.12 release-verdict patch: unassessed anchor not found';
    end if;
    v_def:=replace(v_def,v_old,v_new);
  end if;
  execute v_def;
end $patch$;

-- Keep the two downstream compositions honest. `unverifiable` still means
-- missing evidence, but it no longer means "no store exists"; and with D7.06,
-- D7.07 and D7.12 closed, Sync Field has no open component to report.
do $patch$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.get_workface_execution_metrics(uuid,date,date)'::regprocedure) into v_def;
  v_old := 'element position(s) across the assessed work orders are UNVERIFIABLE — crew, access and work-order predecessors have no canonical store in this product (D7.12). A work order counted READY here is ready on the elements a store can answer, not on all ten.';
  v_new := 'element position(s) across the assessed work orders are UNVERIFIABLE because required canonical evidence is missing, expired or insufficient (D7.12). They are excluded from READY; no missing position defaults to clearance.';
  if position(v_old in v_def)>0 then v_def:=replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'refusing D7.12 workface patch: expected refusal sentence not found'; end if;
  execute v_def;

  select pg_get_functiondef('public.get_sync_field_module(uuid,integer)'::regprocedure) into v_def;
  v_old := $old$'openParts', jsonb_build_array(
      jsonb_build_object('row', 'D7.06', 'gap', 'the release door does not REQUIRE a field-readiness assessment, so a package nobody walked can still read ready for a person'),
      jsonb_build_object('row', 'D7.12', 'gap', 'three of the ten field-ready elements — crew, access, work-order predecessors — have no canonical store and are reported unverifiable')),$old$;
  v_new := $new$'openParts', '[]'::jsonb,$new$;
  if position(v_old in v_def)>0 then v_def:=replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'refusing D7.16 composition patch: expected open-parts block not found'; end if;
  v_def:=replace(v_def,
    'The parts still open are listed rather than implied, because a composed module is not more complete than what it composes.',
    'D7.06, D7.07 and D7.12 are closed; openParts is therefore empty and will become non-empty again only when an owning component reports a proven gap.');
  execute v_def;
end $patch$;

comment on function public.get_sync_field_module(uuid,integer) is
  'D7.16: the complete composed Sync Field module. It returns work packaging, constraint-free work, workface planning, resource demand/capacity, portfolio conflicts and execution readiness verbatim from their owning functions and computes no competing verdict or metric. D7.06, D7.07 and D7.12 are closed, so openParts is empty.';

comment on table public.work_order_crew_assignments is 'D7.12 canonical job-specific crew assignment; competency and roster readiness are derived from existing workforce stores and never authorize release.';
comment on table public.work_face_access_evidence is 'D7.12 evidence-backed physical access position for one work order; requires verified canonical evidence or a verified access-route assessment.';
comment on table public.work_order_predecessor_evidence is 'D7.12 evidence-backed work-order predecessor graph, including an explicit reviewed-none state so absence is never interpreted as clearance.';

notify pgrst,'reload schema';
