-- ============================================================================
-- C1.09 — governed Shutdown / Turnaround Specialist.
--
-- Canonical reuse is deliberate: outage_windows/outage_work remain the scope,
-- shutdown_events/tasks/dependencies remain the schedule graph, and the shared
-- agent control/run/audit models remain the authority and evidence spine. The
-- migration adds only the links, human acts and immutable advisory pack needed
-- to make that existing model executable. The agent cannot add work, freeze or
-- release scope, rewrite a schedule, approve work, waive a readiness blocker,
-- start execution or return equipment to service.
-- ============================================================================

update public.decision_rights
set enforcement='enforced', version=version+1, effective_at=now()
where right_key='release_turnaround_scope'
  and enforcement<>'enforced';

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'analyse_turnaround_readiness','Analyse shutdown and turnaround readiness',
  'Freeze exact outage scope, schedule-graph and readiness evidence into an advisory pack without changing scope, schedule, approvals or execution state.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'shutdown_turnaround','Shutdown / Turnaround Specialist','specialist',
       'active','advisory','Waiting for a governed outage-readiness review',
       'Maintenance Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='shutdown_turnaround'
);

update public.ai_agents
set name='Shutdown / Turnaround Specialist',category='specialist',
    autonomy_mode='advisory',supervisor='Maintenance Manager',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact outage scope, work readiness and the canonical shutdown schedule graph into a retained readiness assessment and named-human review hand-off.',
      'modes',jsonb_build_array('scope integrity','sequence integrity','work readiness','late-work control','release readiness'),
      'triggers',jsonb_build_array('human review request','scope freeze','late work added','readiness blocker','release review'),
      'inputs',jsonb_build_array('outage window','outage work membership','work orders','materials','approvals','safety gates','shutdown event','schedule tasks','task dependencies','connector posture'),
      'outputs',jsonb_build_array('immutable readiness pack','exact source snapshot','five-mode posture','evidence gaps','review plan','named-human review hand-off'),
      'guardrails',jsonb_build_array(
        'Never invent duration, logic, float, craft capacity, material readiness, approval, safety clearance or production permission',
        'Never add or remove work, freeze or release scope, rewrite imported schedule fields, or waive a blocker',
        'Never start execution, issue a permit, approve an isolation, change an operating limit or return equipment to service',
        'Require named-human authority and segregation of duties for turnaround release'),
      'routes',jsonb_build_array('/turnarounds'))
where key='shutdown_turnaround';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_shutdown_turnaround_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_shutdown_turnaround_charter_shape
      check (key <> 'shutdown_turnaround' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Extend only untouched platform baselines. Tenant-authored control histories
-- remain fail-closed until their administrator explicitly grants the new tool.
do $$
declare r record; v_profile uuid; v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
      p.required_human_approver_role,p.proposal_risk_ceiling,
      p.proposal_cost_ceiling_usd,p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id and p.status='adopted'
    where a.key='shutdown_turnaround'
  loop
    if r.old_profile is not null and r.old_basis<>v_basis then continue; end if;
    if r.old_profile is null and exists (
      select 1 from public.agent_control_profiles h where h.agent_id=r.agent_id
    ) then continue; end if;
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id=r.agent_id;
    if r.old_profile is not null then
      update public.agent_control_profiles set status='superseded' where id=r.old_profile;
    end if;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values(r.organization_id,r.agent_id,'advisory_only',
      coalesce(r.required_human_approver_role,'maintenance_manager'),
      coalesce(r.proposal_risk_ceiling,'Critical'),
      coalesce(r.proposal_cost_ceiling_usd,0),
      coalesce(r.proposal_downtime_ceiling_hours,0),false,
      v_basis,'draft',v_version,null)
    returning id into v_profile;
    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d where d.right_key='produce_schedule_options';
    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in
      ('analyse_turnaround_readiness','read_work_context','draft_recommendation');
    update public.agent_control_profiles
      set status='adopted',adopted_at=now() where id=v_profile;
  end loop;
end $$;

-- One scope and one schedule graph, joined explicitly.
alter table public.outage_windows
  add column if not exists shutdown_event_id uuid
    references public.shutdown_events(id) on delete set null,
  add column if not exists scope_released_by uuid references auth.users(id),
  add column if not exists scope_released_at timestamptz,
  add column if not exists scope_release_note text;
create unique index if not exists idx_outage_windows_shutdown_event
  on public.outage_windows(shutdown_event_id)
  where shutdown_event_id is not null;

alter table public.shutdown_tasks
  add column if not exists outage_work_id uuid
    references public.outage_work(id) on delete set null;
create index if not exists idx_shutdown_tasks_outage_work
  on public.shutdown_tasks(outage_work_id)
  where outage_work_id is not null;

create or replace function public.enforce_turnaround_schedule_link()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event_org uuid; v_window_event uuid; v_work_event uuid;
begin
  if new.outage_work_id is null then return new; end if;
  select e.organization_id into v_event_org
  from public.shutdown_events e where e.id=new.event_id;
  select w.shutdown_event_id,ow.outage_window_id into v_window_event,v_work_event
  from public.outage_work ow join public.outage_windows w on w.id=ow.outage_window_id
  where ow.id=new.outage_work_id and ow.organization_id=v_event_org
    and w.organization_id=v_event_org;
  if not found or v_window_event is distinct from new.event_id then
    raise exception 'schedule activity and outage work must belong to the same tenant and linked outage schedule';
  end if;
  return new;
end $$;
revoke all on function public.enforce_turnaround_schedule_link()
  from public,anon,authenticated;
drop trigger if exists trg_turnaround_schedule_link on public.shutdown_tasks;
create trigger trg_turnaround_schedule_link before insert or update of outage_work_id,event_id
  on public.shutdown_tasks for each row execute function public.enforce_turnaround_schedule_link();

-- Canonical scope provenance on retained agent runs.
alter table public.agent_runs
  add column if not exists outage_window_id uuid
    references public.outage_windows(id) on delete set null;
create index if not exists idx_agent_runs_retained_outage
  on public.agent_runs(organization_id,outage_window_id,created_at desc)
  where retained_for_governance;

create or replace function public.enforce_retained_agent_run()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_planner_marker text:=coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text:=coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_reliability_marker text:=coalesce(current_setting('app.reliability_agent_run_write',true),'');
  v_fracas_marker text:=coalesce(current_setting('app.fracas_agent_run_write',true),'');
  v_condition_marker text:=coalesce(current_setting('app.condition_agent_run_write',true),'');
  v_mro_marker text:=coalesce(current_setting('app.mro_materials_agent_run_write',true),'');
  v_turnaround_marker text:=coalesce(current_setting('app.turnaround_agent_run_write',true),'');
  v_allowed boolean:=v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted' or v_mro_marker='granted'
    or v_turnaround_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then return null; end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op<>'DELETE' and new.retained_for_governance then
    if new.requested_by is null
      or (new.work_order_id is null and new.site_id is null
          and nullif(btrim(new.component_scope),'') is null
          and new.asset_id is null and new.material_id is null
          and new.outage_window_id is null)
      or new.agent_control_profile_id is null
      or coalesce(btrim(new.agent_tool_key),'')=''
      or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset/material/outage scope, control profile, tool and decision-right provenance';
    end if;
    if not exists(select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists(select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.asset_id is not null and not exists(select 1 from public.assets a
      where a.id=new.asset_id and a.organization_id=new.organization_id) then
      raise exception 'agent run names an asset outside its organization';
    end if;
    if new.material_id is not null and not exists(select 1 from public.materials m
      where m.id=new.material_id and m.organization_id=new.organization_id) then
      raise exception 'agent run names a material outside its organization';
    end if;
    if new.outage_window_id is not null and not exists(select 1 from public.outage_windows w
      where w.id=new.outage_window_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names an outage outside its organization';
    end if;
    if new.work_order_id is not null and not exists(select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists(select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists(
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))) then
      raise exception 'agent run names a component population outside its organization';
    end if;
    if new.job_plan_id is not null and not exists(select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists(select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted') then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create table if not exists public.turnaround_readiness_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outage_window_id uuid not null references public.outage_windows(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  assessment jsonb not null check(jsonb_typeof(assessment)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_turnaround_readiness_packs_window
  on public.turnaround_readiness_packs(organization_id,outage_window_id,created_at desc);

create table if not exists public.turnaround_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_id uuid not null references public.turnaround_readiness_packs(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check(length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);
create index if not exists idx_turnaround_review_assignments
  on public.turnaround_review_assignments(organization_id,pack_id,assigned_at desc);

alter table public.turnaround_readiness_packs enable row level security;
alter table public.turnaround_review_assignments enable row level security;
drop policy if exists turnaround_readiness_packs_read on public.turnaround_readiness_packs;
create policy turnaround_readiness_packs_read on public.turnaround_readiness_packs
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists turnaround_review_assignments_read on public.turnaround_review_assignments;
create policy turnaround_review_assignments_read on public.turnaround_review_assignments
  for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.turnaround_readiness_packs,
  public.turnaround_review_assignments from public,anon,authenticated;
grant select on public.turnaround_readiness_packs,
  public.turnaround_review_assignments to authenticated;

create or replace function public.protect_turnaround_agent_records()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'turnaround readiness packs and review assignments are append-only';
  end if;
  if coalesce(current_setting('app.turnaround_record_write',true),'')<>'granted' then
    raise exception 'turnaround agent records are written only by the governed readiness workflow';
  end if;
  return new;
end $$;
revoke all on function public.protect_turnaround_agent_records()
  from public,anon,authenticated;
drop trigger if exists trg_protect_turnaround_readiness_packs on public.turnaround_readiness_packs;
create trigger trg_protect_turnaround_readiness_packs before insert or update or delete
  on public.turnaround_readiness_packs for each row
  execute function public.protect_turnaround_agent_records();
drop trigger if exists trg_protect_turnaround_review_assignments on public.turnaround_review_assignments;
create trigger trg_protect_turnaround_review_assignments before insert or update or delete
  on public.turnaround_review_assignments for each row
  execute function public.protect_turnaround_agent_records();

-- One server-side readiness reading is reused by the agent, the UI and the
-- release act. Missing evidence is never silently converted into readiness.
create or replace function public.evaluate_turnaround_readiness(p_window_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); w public.outage_windows%rowtype;
  v_scope int; v_unsized int; v_material int; v_approval int; v_safety int;
  v_late int; v_late_unjustified int; v_tasks int; v_dependencies int;
  v_unlinked int; v_unscheduled int; v_range_gaps int; v_dangling int;
  v_negative_float int; v_outside int; v_cycle boolean:=false;
  v_blockers int; v_warnings int;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into w from public.outage_windows
  where id=p_window_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','outage window not found'); end if;

  select count(*)::int,
    count(*) filter(where wo.planned_hours is null or wo.planned_hours<=0)::int,
    count(*) filter(where ow.added_after_freeze)::int,
    count(*) filter(where ow.added_after_freeze
      and coalesce(length(btrim(ow.justification)),0)<20)::int
  into v_scope,v_unsized,v_late,v_late_unjustified
  from public.outage_work ow join public.work_orders wo on wo.id=ow.work_order_id
  where ow.organization_id=v_org and ow.outage_window_id=w.id;

  select count(distinct ow.id)::int into v_material
  from public.outage_work ow join public.work_order_materials m
    on m.work_order_id=ow.work_order_id and m.organization_id=ow.organization_id
  where ow.organization_id=v_org and ow.outage_window_id=w.id
    and m.status in ('requested','short');

  select count(distinct ow.id)::int into v_approval
  from public.outage_work ow join public.work_orders wo on wo.id=ow.work_order_id
  where ow.organization_id=v_org and ow.outage_window_id=w.id and (
    exists(select 1 from public.approvals a
      where a.organization_id=v_org and a.work_order_id=wo.id
        and a.status in ('required','pending'))
    or (coalesce(wo.approval_required,false) and not exists(
      select 1 from public.approvals a where a.organization_id=v_org
        and a.work_order_id=wo.id and a.status='approved')));

  select count(distinct ow.id)::int into v_safety
  from public.outage_work ow
  join public.work_orders wo on wo.id=ow.work_order_id
  join public.recommendations r on r.id=wo.recommendation_id
  join public.recommendation_screenings s on s.recommendation_id=r.id
  where ow.organization_id=v_org and ow.outage_window_id=w.id
    and s.requires_gatekeeper and s.gatekeeper_attested_at is null;

  if w.shutdown_event_id is null then
    v_tasks:=0; v_dependencies:=0; v_unlinked:=v_scope; v_unscheduled:=0;
    v_range_gaps:=0; v_dangling:=0; v_negative_float:=0; v_outside:=0;
  else
    select count(*)::int,
      count(*) filter(where t.planned_start is null or t.planned_finish is null)::int,
      count(*) filter(where t.optimistic_hours is null or t.pessimistic_hours is null)::int,
      count(*) filter(where t.total_float_hours<0)::int,
      count(*) filter(where (t.planned_start is not null and t.planned_start<w.starts_at)
        or (t.planned_finish is not null and t.planned_finish>w.ends_at))::int
    into v_tasks,v_unscheduled,v_range_gaps,v_negative_float,v_outside
    from public.shutdown_tasks t where t.event_id=w.shutdown_event_id;
    select count(*)::int into v_dependencies from public.shutdown_task_dependencies d
      where d.event_id=w.shutdown_event_id;
    select count(*)::int into v_unlinked from public.outage_work ow
      where ow.organization_id=v_org and ow.outage_window_id=w.id
        and not exists(select 1 from public.shutdown_tasks t
          where t.event_id=w.shutdown_event_id and t.outage_work_id=ow.id);
    select count(*)::int into v_dangling from public.shutdown_task_dependencies d
      where d.event_id=w.shutdown_event_id and (
        not exists(select 1 from public.shutdown_tasks t
          where t.event_id=d.event_id and t.task_key=d.task_key)
        or not exists(select 1 from public.shutdown_tasks t
          where t.event_id=d.event_id and t.task_key=d.predecessor_key));
    -- Transitive closure with UNION de-duplication is bounded by N² key pairs;
    -- a path from a key back to itself is a cycle. This avoids path explosion
    -- on large but valid schedule graphs.
    with recursive reach(from_key,to_key) as (
      select d.predecessor_key,d.task_key
      from public.shutdown_task_dependencies d where d.event_id=w.shutdown_event_id
      union
      select r.from_key,d.task_key
      from reach r join public.shutdown_task_dependencies d
        on d.event_id=w.shutdown_event_id and d.predecessor_key=r.to_key
    ) select exists(select 1 from reach where from_key=to_key) into v_cycle;
  end if;

  v_blockers:=(case when v_scope=0 then 1 else 0 end)
    +(case when w.shutdown_event_id is null or v_tasks=0 then 1 else 0 end)
    +v_unsized+v_material+v_approval+v_safety+v_late_unjustified
    +v_unlinked+v_unscheduled+v_dangling+v_outside
    +(case when v_cycle then 1 else 0 end);
  v_warnings:=v_range_gaps+v_negative_float;

  return jsonb_build_object(
    'windowId',w.id,'windowKey',w.window_key,'status',w.status,
    'scope',jsonb_build_object('workOrders',v_scope,'unsized',v_unsized,
      'lateAdditions',v_late,'lateWithoutJustification',v_late_unjustified,
      'state',case when v_scope=0 then 'blocked' when v_unsized>0 then 'attention' else 'supported' end),
    'sequence',jsonb_build_object('eventId',w.shutdown_event_id,'tasks',v_tasks,
      'dependencies',v_dependencies,'scopeWithoutTask',v_unlinked,
      'tasksWithoutDates',v_unscheduled,'tasksWithoutRanges',v_range_gaps,
      'danglingDependencies',v_dangling,'cycleDetected',v_cycle,
      'negativeFloatTasks',v_negative_float,'tasksOutsideWindow',v_outside,
      'state',case when w.shutdown_event_id is null or v_tasks=0 or v_unlinked>0
        or v_unscheduled>0 or v_dangling>0 or v_cycle or v_outside>0
        then 'blocked' when v_range_gaps+v_negative_float>0 then 'attention'
        else 'supported' end),
    'readiness',jsonb_build_object('materialBlockedWork',v_material,
      'approvalBlockedWork',v_approval,'safetyBlockedWork',v_safety,
      'state',case when v_material+v_approval+v_safety>0 then 'blocked' else 'supported' end),
    'blockers',v_blockers,'warnings',v_warnings,
    'releaseReady',w.status='frozen' and v_blockers=0,
    'basis','Release readiness requires frozen scope, sized work, a linked and dated acyclic schedule task for every scope item, no material, approval or safety blocker, and a written justification for every late addition. Missing evidence is a blocker, never a pass.',
    'authority','This reading is advisory. Only the governed named-human release act can move scope to executing, and it cannot waive a blocker.');
end $$;
revoke all on function public.evaluate_turnaround_readiness(uuid) from public,anon;
grant execute on function public.evaluate_turnaround_readiness(uuid) to authenticated;

-- Replace the old SQL-only add-work door with a tenant-safe, human-only act.
-- Work added after release invalidates release and returns the window to frozen.
create or replace function public.add_work_to_outage(
  p_window_key text,p_work_order_id uuid,p_justification text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype;
  v_late boolean; v_inserted uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles
    where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','reliability_engineer','admin','supervisor') then
    return jsonb_build_object('error','adding outage work requires a named planning, reliability, maintenance or supervisory role');
  end if;
  select * into w from public.outage_windows
    where organization_id=v_org and window_key=p_window_key for update;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status in ('closed','cancelled') then return jsonb_build_object('error','this outage is '||w.status); end if;
  if not exists(select 1 from public.work_orders wo
    where wo.id=p_work_order_id and wo.organization_id=v_org
      and coalesce(wo.status,'') not in ('completed','cancelled')) then
    return jsonb_build_object('error','open work order not found in this organization');
  end if;
  v_late:=w.status<>'planned';
  if v_late and coalesce(length(btrim(p_justification)),0)<20 then
    return jsonb_build_object('error','frozen or executing scope requires at least 20 characters of late-work justification');
  end if;
  insert into public.outage_work(organization_id,outage_window_id,work_order_id,
    added_by,added_after_freeze,justification)
  values(v_org,w.id,p_work_order_id,auth.uid(),v_late,nullif(btrim(p_justification),''))
  on conflict(outage_window_id,work_order_id) do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('error','work order is already in this outage scope'); end if;
  if w.status='executing' then
    update public.outage_windows set status='frozen' where id=w.id;
    if w.shutdown_event_id is not null then
      update public.shutdown_events set status='frozen'
      where id=w.shutdown_event_id and organization_id=v_org and status='executing';
    end if;
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_scope',v_role,jsonb_build_object('action','work_added',
    'outage_window_id',w.id,'work_order_id',p_work_order_id,'late_addition',v_late,
    'justification',nullif(btrim(p_justification),''),'release_invalidated',w.status='executing',
    'human_actor',auth.uid()));
  return jsonb_build_object('outage',w.window_key,'outageWorkId',v_inserted,
    'workOrderId',p_work_order_id,'lateAddition',v_late,
    'releaseInvalidated',w.status='executing','status',case when w.status='executing' then 'frozen' else w.status end);
end $$;
revoke all on function public.add_work_to_outage(text,uuid,text) from public,anon;
grant execute on function public.add_work_to_outage(text,uuid,text) to authenticated;

create or replace function public.freeze_outage_scope(p_window_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype; v_count int;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','freezing outage scope requires a named planner, maintenance manager or administrator');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','freeze note must contain at least 10 characters'); end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status<>'planned' then return jsonb_build_object('error','only planned scope can be frozen'); end if;
  select count(*) into v_count from public.outage_work
    where organization_id=v_org and outage_window_id=w.id;
  if v_count=0 then return jsonb_build_object('error','scope cannot be frozen with no work orders'); end if;
  update public.outage_windows set status='frozen',frozen_by=auth.uid(),frozen_at=now() where id=w.id;
  if w.shutdown_event_id is not null then
    update public.shutdown_events set status='frozen'
      where id=w.shutdown_event_id and organization_id=v_org and status='planning';
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_scope',v_role,jsonb_build_object('action','scope_frozen',
    'outage_window_id',w.id,'work_orders',v_count,'note',btrim(p_note),
    'human_actor',auth.uid(),'execution_authorized',false));
  return jsonb_build_object('windowId',w.id,'status','frozen','workOrders',v_count,
    'note','Scope is frozen. This is not authority to execute.');
end $$;
revoke all on function public.freeze_outage_scope(uuid,text) from public,anon;
grant execute on function public.freeze_outage_scope(uuid,text) to authenticated;

create or replace function public.create_turnaround_schedule(
  p_window_id uuid,p_event_key text,p_title text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype; v_event uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','creating a turnaround schedule requires a named planner, maintenance manager or administrator');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status in ('executing','closed','cancelled') then return jsonb_build_object('error','schedule cannot be created for an '||w.status||' outage'); end if;
  if w.shutdown_event_id is not null then return jsonb_build_object('error','this outage already has a linked schedule'); end if;
  if coalesce(length(btrim(p_event_key)),0)<2 or coalesce(length(btrim(p_title)),0)<3 then
    return jsonb_build_object('error','schedule key and title are required');
  end if;
  insert into public.shutdown_events(organization_id,event_key,title,planned_start,
    planned_duration_hours,status)
  values(v_org,upper(btrim(p_event_key)),btrim(p_title),w.starts_at,
    round(extract(epoch from(w.ends_at-w.starts_at))/3600.0,2),
    case when w.status='frozen' then 'frozen' else 'planning' end)
  returning id into v_event;
  update public.outage_windows set shutdown_event_id=v_event where id=w.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_schedule',v_role,jsonb_build_object('action','schedule_created',
    'outage_window_id',w.id,'shutdown_event_id',v_event,'human_actor',auth.uid()));
  return jsonb_build_object('windowId',w.id,'shutdownEventId',v_event,'status','linked');
exception when unique_violation then
  return jsonb_build_object('error','that schedule key is already in use or the outage already has a schedule');
end $$;
revoke all on function public.create_turnaround_schedule(uuid,text,text) from public,anon;
grant execute on function public.create_turnaround_schedule(uuid,text,text) to authenticated;

create or replace function public.link_outage_shutdown_schedule(
  p_window_id uuid,p_shutdown_event_id uuid,p_basis text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','linking an outage schedule requires a named planner, maintenance manager or administrator');
  end if;
  if coalesce(length(btrim(p_basis)),0)<10 then return jsonb_build_object('error','link basis must contain at least 10 characters'); end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status in ('executing','closed','cancelled') then return jsonb_build_object('error','schedule cannot be linked for an '||w.status||' outage'); end if;
  if w.shutdown_event_id is not null then return jsonb_build_object('error','this outage already has a linked schedule'); end if;
  if not exists(select 1 from public.shutdown_events e where e.id=p_shutdown_event_id
    and e.organization_id=v_org and e.status in ('planning','frozen')) then
    return jsonb_build_object('error','eligible shutdown schedule not found');
  end if;
  if exists(select 1 from public.outage_windows x where x.organization_id=v_org
    and x.shutdown_event_id=p_shutdown_event_id) then
    return jsonb_build_object('error','that shutdown schedule is already linked to an outage');
  end if;
  update public.outage_windows set shutdown_event_id=p_shutdown_event_id where id=w.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_schedule',v_role,jsonb_build_object('action','schedule_linked',
    'outage_window_id',w.id,'shutdown_event_id',p_shutdown_event_id,
    'basis',btrim(p_basis),'human_actor',auth.uid()));
  return jsonb_build_object('windowId',w.id,'shutdownEventId',p_shutdown_event_id,'status','linked');
end $$;
revoke all on function public.link_outage_shutdown_schedule(uuid,uuid,text) from public,anon;
grant execute on function public.link_outage_shutdown_schedule(uuid,uuid,text) to authenticated;

create or replace function public.record_turnaround_schedule_activity(
  p_window_id uuid,p_task_key text,p_label text,p_duration_hours numeric,
  p_optimistic_hours numeric default null,p_pessimistic_hours numeric default null,
  p_work_order_id uuid default null,p_planned_start timestamptz default null,
  p_planned_finish timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype;
  v_outage_work uuid; v_task bigint;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','authoring a turnaround activity requires a named planner, maintenance manager or administrator');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status in ('executing','closed','cancelled') or w.shutdown_event_id is null then
    return jsonb_build_object('error','an eligible linked outage schedule is required');
  end if;
  if coalesce(length(btrim(p_task_key)),0)<1 or coalesce(length(btrim(p_label)),0)<3 then
    return jsonb_build_object('error','activity key and label are required');
  end if;
  if p_duration_hours is null or not public.sync_is_finite_numeric(p_duration_hours)
    or p_duration_hours<0 then return jsonb_build_object('error','duration must be a finite non-negative number'); end if;
  if p_optimistic_hours is not null and (not public.sync_is_finite_numeric(p_optimistic_hours)
    or p_optimistic_hours<0 or p_optimistic_hours>p_duration_hours) then
    return jsonb_build_object('error','optimistic duration must be finite, non-negative and no greater than duration');
  end if;
  if p_pessimistic_hours is not null and (not public.sync_is_finite_numeric(p_pessimistic_hours)
    or p_pessimistic_hours<p_duration_hours) then
    return jsonb_build_object('error','pessimistic duration must be finite and no less than duration');
  end if;
  if (p_planned_start is null)<>(p_planned_finish is null)
    or (p_planned_start is not null and (p_planned_finish<p_planned_start
      or p_planned_start<w.starts_at or p_planned_finish>w.ends_at)) then
    return jsonb_build_object('error','planned activity dates must be paired, ordered and inside the outage window');
  end if;
  if p_work_order_id is not null then
    select ow.id into v_outage_work from public.outage_work ow
    where ow.organization_id=v_org and ow.outage_window_id=w.id
      and ow.work_order_id=p_work_order_id;
    if v_outage_work is null then return jsonb_build_object('error','work order is not in this outage scope'); end if;
  end if;
  perform set_config('app.schedule_activity_write','granted',true);
  insert into public.shutdown_tasks(event_id,task_key,label,duration_hours,
    optimistic_hours,pessimistic_hours,planned_start,planned_finish,
    outage_work_id,origin,authored_by)
  values(w.shutdown_event_id,upper(btrim(p_task_key)),btrim(p_label),p_duration_hours,
    p_optimistic_hours,p_pessimistic_hours,p_planned_start,p_planned_finish,
    v_outage_work,'local',auth.uid()) returning id into v_task;
  perform set_config('app.schedule_activity_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_schedule',v_role,jsonb_build_object('action','activity_recorded',
    'outage_window_id',w.id,'shutdown_event_id',w.shutdown_event_id,'task_id',v_task,
    'work_order_id',p_work_order_id,'human_actor',auth.uid()));
  return jsonb_build_object('windowId',w.id,'taskId',v_task,'status','recorded');
exception when unique_violation then
  perform set_config('app.schedule_activity_write','',true);
  return jsonb_build_object('error','that activity key already exists in this schedule');
end $$;
revoke all on function public.record_turnaround_schedule_activity(uuid,text,text,numeric,numeric,numeric,uuid,timestamptz,timestamptz)
  from public,anon;
grant execute on function public.record_turnaround_schedule_activity(uuid,text,text,numeric,numeric,numeric,uuid,timestamptz,timestamptz)
  to authenticated;

create or replace function public.link_turnaround_task_to_work(
  p_window_id uuid,p_task_id bigint,p_work_order_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype; v_ow uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','linking schedule activity to scope requires a named planner, maintenance manager or administrator');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org;
  if not found or w.shutdown_event_id is null then return jsonb_build_object('error','linked outage schedule not found'); end if;
  if w.status in ('executing','closed','cancelled') then return jsonb_build_object('error','schedule links are frozen during '||w.status); end if;
  select id into v_ow from public.outage_work where organization_id=v_org
    and outage_window_id=w.id and work_order_id=p_work_order_id;
  if v_ow is null then return jsonb_build_object('error','work order is not in this outage scope'); end if;
  update public.shutdown_tasks set outage_work_id=v_ow
    where id=p_task_id and event_id=w.shutdown_event_id;
  if not found then return jsonb_build_object('error','schedule activity not found'); end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_schedule',v_role,jsonb_build_object('action','activity_scope_linked',
    'outage_window_id',w.id,'task_id',p_task_id,'work_order_id',p_work_order_id,
    'human_actor',auth.uid()));
  return jsonb_build_object('windowId',w.id,'taskId',p_task_id,'workOrderId',p_work_order_id,'status','linked');
end $$;
revoke all on function public.link_turnaround_task_to_work(uuid,bigint,uuid) from public,anon;
grant execute on function public.link_turnaround_task_to_work(uuid,bigint,uuid) to authenticated;

create or replace function public.record_turnaround_task_dependency(
  p_window_id uuid,p_task_key text,p_predecessor_key text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype; v_id bigint;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','maintenance_manager','admin') then
    return jsonb_build_object('error','sequencing turnaround activities requires a named planner, maintenance manager or administrator');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org;
  if not found or w.shutdown_event_id is null then return jsonb_build_object('error','linked outage schedule not found'); end if;
  if w.status in ('executing','closed','cancelled') then return jsonb_build_object('error','schedule logic is frozen during '||w.status); end if;
  if upper(btrim(p_task_key))=upper(btrim(p_predecessor_key)) then return jsonb_build_object('error','an activity cannot depend on itself'); end if;
  if not exists(select 1 from public.shutdown_tasks where event_id=w.shutdown_event_id
    and task_key=upper(btrim(p_task_key))) or not exists(select 1 from public.shutdown_tasks
    where event_id=w.shutdown_event_id and task_key=upper(btrim(p_predecessor_key))) then
    return jsonb_build_object('error','both activities must exist in the linked schedule');
  end if;
  perform set_config('app.schedule_logic_write','granted',true);
  insert into public.shutdown_task_dependencies(event_id,task_key,predecessor_key,link_type,lag_hours)
  values(w.shutdown_event_id,upper(btrim(p_task_key)),upper(btrim(p_predecessor_key)),'FS',0)
  returning id into v_id;
  if coalesce((public.evaluate_turnaround_readiness(w.id)#>>'{sequence,cycleDetected}')::boolean,false) then
    delete from public.shutdown_task_dependencies where id=v_id;
    perform set_config('app.schedule_logic_write','',true);
    return jsonb_build_object('error','dependency would create a schedule cycle');
  end if;
  perform set_config('app.schedule_logic_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_schedule',v_role,jsonb_build_object('action','dependency_recorded',
    'outage_window_id',w.id,'task_key',upper(btrim(p_task_key)),
    'predecessor_key',upper(btrim(p_predecessor_key)),'human_actor',auth.uid()));
  return jsonb_build_object('windowId',w.id,'dependencyId',v_id,'status','recorded');
exception when unique_violation then
  perform set_config('app.schedule_logic_write','',true);
  return jsonb_build_object('error','that dependency already exists');
end $$;
revoke all on function public.record_turnaround_task_dependency(uuid,text,text) from public,anon;
grant execute on function public.record_turnaround_task_dependency(uuid,text,text) to authenticated;

create or replace function public.release_turnaround_scope(
  p_window_id uuid,p_release_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype;
  v_right public.decision_rights%rowtype; v_readiness jsonb;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  select * into v_right from public.decision_rights where right_key='release_turnaround_scope';
  if not found or v_right.tier<>'approval' or v_right.enforcement<>'enforced' then
    return jsonb_build_object('error','turnaround release policy is not enforced; release refused fail-closed');
  end if;
  if coalesce(v_role,'') not in (v_right.required_authority,'admin') or v_role='ai_admin' then
    return jsonb_build_object('error','turnaround scope release requires a named '||v_right.required_authority||' or administrator');
  end if;
  if coalesce(length(btrim(p_release_note)),0)<20 then
    return jsonb_build_object('error','release note must contain at least 20 characters');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  if w.status<>'frozen' then return jsonb_build_object('error','only frozen scope can be released'); end if;
  if w.frozen_by is null or w.frozen_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires release by a named human other than the person who froze scope');
  end if;
  v_readiness:=public.evaluate_turnaround_readiness(w.id);
  if coalesce((v_readiness->>'releaseReady')::boolean,false) is not true then
    return jsonb_build_object('error','turnaround scope is not release-ready; readiness blockers cannot be waived','readiness',v_readiness);
  end if;
  update public.outage_windows set status='executing',scope_released_by=auth.uid(),
    scope_released_at=now(),scope_release_note=btrim(p_release_note) where id=w.id;
  update public.shutdown_events set status='executing'
    where id=w.shutdown_event_id and organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_scope',v_role,jsonb_build_object('action','scope_released',
    'outage_window_id',w.id,'shutdown_event_id',w.shutdown_event_id,
    'released_by',auth.uid(),'frozen_by',w.frozen_by,'release_note',btrim(p_release_note),
    'decision_right','release_turnaround_scope','readiness',v_readiness,
    'return_to_service_authorized',false));
  return jsonb_build_object('windowId',w.id,'status','executing','releasedBy',auth.uid(),
    'readiness',v_readiness,
    'authority','Scope released for controlled execution. Permits, isolations, operating limits and return-to-service remain separate human authorities.');
end $$;
revoke all on function public.release_turnaround_scope(uuid,text) from public,anon;
grant execute on function public.release_turnaround_scope(uuid,text) to authenticated;

create or replace function public.run_turnaround_agent(p_window_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; w public.outage_windows%rowtype;
  ag public.ai_agents%rowtype; v_control jsonb; v_readiness jsonb;
  v_work jsonb:='[]'::jsonb; v_tasks jsonb:='[]'::jsonb; v_dependencies jsonb:='[]'::jsonb;
  v_connectors jsonb:='[]'::jsonb; v_gaps jsonb:='[]'::jsonb;
  v_snapshot jsonb; v_result jsonb; v_plan jsonb; v_run uuid; v_pack uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','running the Shutdown / Turnaround Specialist requires a named planner, reliability engineer, maintenance manager or administrator');
  end if;
  select * into w from public.outage_windows where id=p_window_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','outage window not found'); end if;
  select * into ag from public.ai_agents where organization_id=v_org
    and key='shutdown_turnaround' order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Shutdown / Turnaround Specialist is configured in this organization'); end if;
  v_control:=public.evaluate_agent_control_internal(v_org,ag.id,
    'produce_schedule_options','analyse_turnaround_readiness','Critical',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Shutdown / Turnaround Specialist refused: '||(v_control->>'reason'));
  end if;

  v_readiness:=public.evaluate_turnaround_readiness(w.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'outageWorkId',ow.id,'workOrderId',wo.id,'workOrderNumber',wo.wo_number,
    'title',wo.title,'status',wo.status,'priority',wo.priority,
    'plannedHours',wo.planned_hours,'assetId',wo.asset_id,'safetyFlag',wo.safety_flag,
    'approvalRequired',wo.approval_required,'addedAfterFreeze',ow.added_after_freeze,
    'justification',ow.justification,'addedAt',ow.added_at,
    'materialLines',(select count(*) from public.work_order_materials m
      where m.organization_id=v_org and m.work_order_id=wo.id),
    'materialBlockers',(select count(*) from public.work_order_materials m
      where m.organization_id=v_org and m.work_order_id=wo.id
        and m.status in ('requested','short')),
    'pendingApprovals',(select count(*) from public.approvals a
      where a.organization_id=v_org and a.work_order_id=wo.id
        and a.status in ('required','pending')))
    order by ow.added_at,ow.id),'[]'::jsonb) into v_work
  from public.outage_work ow join public.work_orders wo on wo.id=ow.work_order_id
  where ow.organization_id=v_org and ow.outage_window_id=w.id;

  if w.shutdown_event_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'taskId',t.id,'taskKey',t.task_key,'label',t.label,
      'durationHours',t.duration_hours,'optimisticHours',t.optimistic_hours,
      'pessimisticHours',t.pessimistic_hours,'plannedStart',t.planned_start,
      'plannedFinish',t.planned_finish,'totalFloatHours',t.total_float_hours,
      'origin',t.origin,'sourceSystem',t.source_system,'externalId',t.external_id,
      'outageWorkId',t.outage_work_id,'assetId',t.asset_id)
      order by t.planned_start nulls last,t.task_key),'[]'::jsonb) into v_tasks
    from public.shutdown_tasks t where t.event_id=w.shutdown_event_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'dependencyId',d.id,'taskKey',d.task_key,'predecessorKey',d.predecessor_key,
      'linkType',coalesce(d.link_type,'FS'),'lagHours',coalesce(d.lag_hours,0))
      order by d.task_key,d.predecessor_key),'[]'::jsonb) into v_dependencies
    from public.shutdown_task_dependencies d where d.event_id=w.shutdown_event_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('connectorKey',c.connector_key,
    'systemKind',coalesce(c.system_kind,c.connector_type),'enabled',c.enabled,
    'lastSuccessAt',c.last_success_at) order by c.connector_key),'[]'::jsonb)
  into v_connectors from public.connectors c where c.organization_id=v_org
    and (lower(coalesce(c.system_kind,c.connector_type,'')) in
      ('cmms','eams','planning','scheduler','project_controls')
      or lower(c.connector_key) similar to '%(cmms|p6|primavera|schedule)%');

  if (v_readiness#>>'{scope,workOrders}')::int=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','scope_empty','severity','blocker','detail','No work order is in the outage scope. Scope readiness cannot be inferred from a planning window alone.')); end if;
  if (v_readiness#>>'{scope,unsized}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','scope_unsized','severity','blocker','detail',format('%s scope item(s) have no positive planned hours.',v_readiness#>>'{scope,unsized}'))); end if;
  if w.shutdown_event_id is null then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','schedule_missing','severity','blocker','detail','No canonical shutdown schedule is linked to this outage window.')); end if;
  if (v_readiness#>>'{sequence,scopeWithoutTask}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','scope_sequence_link','severity','blocker','detail',format('%s scope item(s) have no linked schedule activity.',v_readiness#>>'{sequence,scopeWithoutTask}'))); end if;
  if (v_readiness#>>'{sequence,tasksWithoutDates}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','schedule_dates','severity','blocker','detail',format('%s task(s) have no complete planned date window.',v_readiness#>>'{sequence,tasksWithoutDates}'))); end if;
  if coalesce((v_readiness#>>'{sequence,cycleDetected}')::boolean,false) then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','schedule_cycle','severity','blocker','detail','The retained dependency graph contains a cycle and cannot establish an executable sequence.')); end if;
  if (v_readiness#>>'{readiness,materialBlockedWork}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','materials','severity','blocker','detail',format('%s work order(s) have requested or short material.',v_readiness#>>'{readiness,materialBlockedWork}'))); end if;
  if (v_readiness#>>'{readiness,approvalBlockedWork}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','approvals','severity','blocker','detail',format('%s work order(s) do not have required approval evidence.',v_readiness#>>'{readiness,approvalBlockedWork}'))); end if;
  if (v_readiness#>>'{readiness,safetyBlockedWork}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','safety_gate','severity','blocker','detail',format('%s work order(s) carry an uncleared safety gate.',v_readiness#>>'{readiness,safetyBlockedWork}'))); end if;
  if (v_readiness#>>'{sequence,tasksWithoutRanges}')::int>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','duration_uncertainty','severity','attention','detail',format('%s task(s) have no optimistic/pessimistic range; schedule-risk spread is understated.',v_readiness#>>'{sequence,tasksWithoutRanges}'))); end if;

  v_plan:=jsonb_build_array(
    jsonb_build_object('sequence',1,'question','Is the frozen scope complete, sized and traceable?','owner','turnaround planner','completion','Every included work order is explicit, sized, justified if late and linked to the schedule graph.'),
    jsonb_build_object('sequence',2,'question','Is the activity network executable?','owner','scheduler or project controls','completion','Dates fit the outage window, every scope item has an activity, dependencies are present and acyclic, and uncertainty/float evidence is explicit.'),
    jsonb_build_object('sequence',3,'question','Are work-readiness blockers cleared?','owner','materials, approval and safety owners','completion','Requested/short materials, pending approvals and uncleared safety gates are resolved in their canonical systems.'),
    jsonb_build_object('sequence',4,'question','Has late work changed the release basis?','owner','maintenance manager','completion','Every late addition has a documented basis and any prior release has been invalidated and independently re-reviewed.'),
    jsonb_build_object('sequence',5,'question','Can an independent human release this scope?','owner','accountable maintenance manager','completion','A person other than the freezer confirms zero blockers through the enforced release act; permits, isolations and return-to-service remain separate.'));

  v_snapshot:=jsonb_build_object('asOf',now(),'outageWindow',jsonb_build_object(
      'windowId',w.id,'windowKey',w.window_key,'title',w.title,'kind',w.kind,
      'siteId',w.site_id,'startsAt',w.starts_at,'endsAt',w.ends_at,'scope',w.scope,
      'status',w.status,'frozenBy',w.frozen_by,'frozenAt',w.frozen_at,
      'shutdownEventId',w.shutdown_event_id,'scopeReleasedBy',w.scope_released_by,
      'scopeReleasedAt',w.scope_released_at),
    'work',v_work,'scheduleTasks',v_tasks,'dependencies',v_dependencies,
    'connectors',v_connectors,'readiness',v_readiness,
    'sourceTables',jsonb_build_array('outage_windows','outage_work','work_orders',
      'work_order_materials','approvals','recommendations','recommendation_screenings',
      'shutdown_events','shutdown_tasks','shutdown_task_dependencies','connectors'));

  perform set_config('app.turnaround_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,site_id,outage_window_id,
    status,summary,confidence,started_at,requested_by,agent_control_profile_id,
    agent_tool_key,agent_decision_right_key,input_snapshot,retained_for_governance)
  values(v_org,ag.id,w.site_id,w.id,'running',
    'Shutdown / Turnaround Specialist is screening exact tenant evidence.',
    greatest(20,least(90,90-least(70,(v_readiness->>'blockers')::int*8+(v_readiness->>'warnings')::int*2))),
    now(),auth.uid(),(v_control->>'profile_id')::uuid,
    'analyse_turnaround_readiness','produce_schedule_options',v_snapshot,true)
  returning id into v_run;

  v_result:=jsonb_build_object('runId',v_run,'agentId',ag.id,'agentKey',ag.key,
    'windowId',w.id,'windowKey',w.window_key,
    'scopeIntegrity',v_readiness->'scope','sequenceIntegrity',v_readiness->'sequence',
    'workReadiness',v_readiness->'readiness',
    'lateWorkControl',jsonb_build_object('lateAdditions',v_readiness#>'{scope,lateAdditions}',
      'lateWithoutJustification',v_readiness#>'{scope,lateWithoutJustification}',
      'releaseInvalidatesOnLateWork',true),
    'releaseReadiness',jsonb_build_object('status',w.status,
      'blockers',v_readiness->'blockers','warnings',v_readiness->'warnings',
      'releaseReady',v_readiness->'releaseReady',
      'requiredAuthority','maintenance_manager','segregationOfDuties',true),
    'evidenceGaps',v_gaps,'evidencePlan',v_plan,
    'interpretation',case when (v_readiness->>'blockers')::int>0
      then format('The retained outage evidence contains %s release blocker(s). None can be waived by the agent.',v_readiness->>'blockers')
      when w.status<>'frozen' then 'The retained evidence has no calculated blocker, but scope is not frozen and therefore is not release-ready.'
      else 'The retained evidence has no calculated release blocker. This remains an advisory reading; an independent named human must execute the release act.' end,
    'limitations',jsonb_build_array(
      'Schedule dates, logic, durations, ranges and float are read as recorded; the agent invents none and does not rewrite imported P6 fields.',
      'No blocker-free reading is a permit, isolation approval, operating-limit change, execution instruction or return-to-service authority.',
      'Missing material, approval, safety, task, date or scope-link evidence is a blocker rather than an assumed pass.',
      'The agent did not add or remove work, freeze or release scope, modify the schedule, approve work, waive controls or start execution.'),
    'humanReviewRequired',true,'mayAddWork',false,'mayFreezeScope',false,
    'mayReleaseScope',false,'mayRewriteSchedule',false,'mayWaiveBlocker',false,
    'mayStartExecution',false,'mayReturnToService',false);

  perform set_config('app.turnaround_record_write','granted',true);
  insert into public.turnaround_readiness_packs
    (organization_id,outage_window_id,agent_run_id,source_snapshot,assessment,created_by)
  values(v_org,w.id,v_run,v_snapshot,v_result,auth.uid()) returning id into v_pack;
  v_result:=v_result||jsonb_build_object('packId',v_pack);
  update public.agent_runs set status='completed',completed_at=now(),result=v_result,
    summary=format('Created an immutable turnaround readiness pack for %s with %s evidence gap(s).',w.window_key,jsonb_array_length(v_gaps))
  where id=v_run;
  perform set_config('app.turnaround_record_write','',true);
  perform set_config('app.turnaround_agent_run_write','',true);

  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Assessed '||w.window_key,
    last_action='Created a governed shutdown/turnaround readiness assessment',
    recommendations_generated=coalesce(recommendations_generated,0)+1 where id=ag.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'turnaround_agent_run',v_role,jsonb_build_object(
    'action','turnaround_readiness_pack_created','outage_window_id',w.id,
    'pack_id',v_pack,'agent_run_id',v_run,'requested_by',auth.uid(),
    'control_profile_id',v_control->>'profile_id','scope_changed',false,
    'schedule_changed',false,'work_released',false,'execution_started',false));
  return v_result;
end $$;
revoke all on function public.run_turnaround_agent(uuid) from public,anon;
grant execute on function public.run_turnaround_agent(uuid) to authenticated;

create or replace function public.assign_turnaround_review(
  p_pack_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_assignment uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('planner','reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','assigning turnaround review requires a named planner, reliability engineer, maintenance manager or administrator');
  end if;
  if not exists(select 1 from public.turnaround_readiness_packs where id=p_pack_id and organization_id=v_org) then
    return jsonb_build_object('error','turnaround readiness pack not found');
  end if;
  if not exists(select 1 from public.user_profiles where id=p_assigned_to
    and organization_id=v_org and coalesce(role,'')<>'ai_admin') then
    return jsonb_build_object('error','review owner must be a named human member of this organization');
  end if;
  if p_due_date is null or p_due_date<current_date then return jsonb_build_object('error','review due date cannot be in the past'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','assignment note must contain at least 10 characters'); end if;
  perform set_config('app.turnaround_record_write','granted',true);
  insert into public.turnaround_review_assignments
    (organization_id,pack_id,assigned_to,due_date,assignment_note,assigned_by)
  values(v_org,p_pack_id,p_assigned_to,p_due_date,btrim(p_note),auth.uid())
  returning id into v_assignment;
  perform set_config('app.turnaround_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'turnaround_review',v_role,jsonb_build_object('action','review_assigned',
    'pack_id',p_pack_id,'assignment_id',v_assignment,'assigned_to',p_assigned_to,
    'due_date',p_due_date,'assigned_by',auth.uid(),'scope_changed',false,'work_released',false));
  return jsonb_build_object('assignmentId',v_assignment,'packId',p_pack_id,
    'assignedTo',p_assigned_to,'dueDate',p_due_date,
    'note','Named-human review assigned. No scope, schedule or execution action was taken.');
end $$;
revoke all on function public.assign_turnaround_review(uuid,uuid,date,text) from public,anon;
grant execute on function public.assign_turnaround_review(uuid,uuid,date,text) to authenticated;

create or replace function public.get_turnaround_agent_workspace(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_limit int:=least(greatest(coalesce(p_limit,50),1),100);
  v_windows jsonb; v_work jsonb; v_schedules jsonb; v_packs jsonb; v_members jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'windowId',w.id,'windowKey',w.window_key,'title',w.title,'kind',w.kind,
    'siteId',w.site_id,'siteName',s.name,'startsAt',w.starts_at,'endsAt',w.ends_at,
    'scope',w.scope,'status',w.status,'frozenBy',w.frozen_by,'frozenAt',w.frozen_at,
    'shutdownEventId',w.shutdown_event_id,'scopeReleasedBy',w.scope_released_by,
    'scopeReleasedAt',w.scope_released_at,'readiness',public.evaluate_turnaround_readiness(w.id),
    'work',coalesce((select jsonb_agg(jsonb_build_object(
      'outageWorkId',ow.id,'workOrderId',wo.id,'workOrderNumber',wo.wo_number,
      'title',wo.title,'status',wo.status,'priority',wo.priority,
      'plannedHours',wo.planned_hours,'addedAfterFreeze',ow.added_after_freeze,
      'justification',ow.justification,'linkedTaskCount',(select count(*)
        from public.shutdown_tasks t where t.event_id=w.shutdown_event_id
          and t.outage_work_id=ow.id)) order by ow.added_at,ow.id)
      from public.outage_work ow join public.work_orders wo on wo.id=ow.work_order_id
      where ow.organization_id=v_org and ow.outage_window_id=w.id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(jsonb_build_object(
      'taskId',t.id,'taskKey',t.task_key,'label',t.label,
      'durationHours',t.duration_hours,'optimisticHours',t.optimistic_hours,
      'pessimisticHours',t.pessimistic_hours,'plannedStart',t.planned_start,
      'plannedFinish',t.planned_finish,'totalFloatHours',t.total_float_hours,
      'origin',t.origin,'outageWorkId',t.outage_work_id)
      order by t.planned_start nulls last,t.task_key)
      from public.shutdown_tasks t where t.event_id=w.shutdown_event_id),'[]'::jsonb),
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object(
      'dependencyId',d.id,'taskKey',d.task_key,'predecessorKey',d.predecessor_key,
      'linkType',coalesce(d.link_type,'FS'),'lagHours',coalesce(d.lag_hours,0))
      order by d.task_key,d.predecessor_key)
      from public.shutdown_task_dependencies d where d.event_id=w.shutdown_event_id),'[]'::jsonb))
    order by w.starts_at,w.window_key),'[]'::jsonb) into v_windows
  from (select x.* from public.outage_windows x where x.organization_id=v_org
    and x.status<>'cancelled' order by x.starts_at,x.window_key limit v_limit) w
  left join public.sites s on s.id=w.site_id and s.organization_id=w.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object('workOrderId',wo.id,
    'workOrderNumber',wo.wo_number,'title',wo.title,'status',wo.status,
    'priority',wo.priority,'plannedHours',wo.planned_hours,'assetId',wo.asset_id,
    'assetName',a.name) order by case wo.priority when 'critical' then 1 when 'high' then 2 else 3 end,
    wo.created_at,wo.id),'[]'::jsonb) into v_work
  from (select x.* from public.work_orders x where x.organization_id=v_org
    and coalesce(x.status,'') not in ('completed','cancelled')
    order by x.created_at desc limit v_limit) wo
  left join public.assets a on a.id=wo.asset_id and a.organization_id=wo.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object('shutdownEventId',e.id,
    'eventKey',e.event_key,'title',e.title,'plannedStart',e.planned_start,
    'plannedDurationHours',e.planned_duration_hours,'status',e.status,
    'taskCount',(select count(*) from public.shutdown_tasks t where t.event_id=e.id))
    order by e.planned_start nulls last,e.event_key),'[]'::jsonb) into v_schedules
  from public.shutdown_events e where e.organization_id=v_org
    and e.status in ('planning','frozen') and not exists(select 1
      from public.outage_windows w where w.organization_id=v_org and w.shutdown_event_id=e.id);

  select coalesce(jsonb_agg(jsonb_build_object('packId',p.id,
    'windowId',p.outage_window_id,'windowKey',w.window_key,'title',w.title,
    'agentRunId',p.agent_run_id,'assessment',p.assessment,'createdAt',p.created_at,
    'assignment',case when ar.id is null then null else jsonb_build_object(
      'assignmentId',ar.id,'assignedTo',ar.assigned_to,
      'ownerName',coalesce(up.full_name,ar.assigned_to::text),
      'dueDate',ar.due_date,'note',ar.assignment_note) end)
    order by p.created_at desc),'[]'::jsonb) into v_packs
  from (select x.* from public.turnaround_readiness_packs x
    where x.organization_id=v_org order by x.created_at desc limit v_limit) p
  join public.outage_windows w on w.id=p.outage_window_id and w.organization_id=p.organization_id
  left join lateral(select x.* from public.turnaround_review_assignments x
    where x.organization_id=p.organization_id and x.pack_id=p.id
    order by x.assigned_at desc,x.id desc limit 1) ar on true
  left join public.user_profiles up on up.id=ar.assigned_to and up.organization_id=p.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object('id',up.id,
    'name',coalesce(up.full_name,up.id::text),'role',up.role)
    order by coalesce(up.full_name,up.id::text)),'[]'::jsonb) into v_members
  from public.user_profiles up where up.organization_id=v_org and coalesce(up.role,'')<>'ai_admin';

  return jsonb_build_object('windows',v_windows,'openWork',v_work,
    'unlinkedSchedules',v_schedules,'packs',v_packs,'members',v_members,
    'basis','The workspace composes the canonical outage scope and shutdown schedule graph. Human acts create/link schedule evidence, add/freeze/release scope and are audited. The agent only freezes exact evidence into an immutable advisory pack.');
end $$;
revoke all on function public.get_turnaround_agent_workspace(int) from public,anon;
grant execute on function public.get_turnaround_agent_workspace(int) to authenticated;

comment on function public.run_turnaround_agent(uuid) is
  'C1.09: creates an immutable advisory shutdown/turnaround readiness pack from the canonical outage scope and shutdown schedule graph, with no scope, schedule, approval or execution authority.';

notify pgrst,'reload schema';
