-- ============================================================================
-- C1.02 / C5.09 — governed Site Maintenance Manager agent and durable shift
-- handover packs.
--
-- One agent act reads the canonical site operating picture and freezes it into
-- an immutable, tenant-scoped handover pack.  The pack is advisory evidence:
-- it cannot assign work, close work, release a schedule, alter custody, accept
-- risk, commit spend, or return equipment to service.  A different named human
-- on the incoming shift must acknowledge the pack; acknowledgement changes no
-- source record and is never treated as action closeout.
-- ============================================================================

insert into public.agent_software_tools
  (tool_key,title,purpose,access_kind)
values
  ('generate_shift_handover_pack','Generate shift handover pack',
   'Freeze a tenant-scoped site operating snapshot into a non-authoritative shift handover pack.',
   'draft')
on conflict (tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

update public.decision_rights
set enforcement='enforced', version=version+1
where right_key='generate_meeting_packs';

-- Some older organizations predate complete reference provisioning.  Reuse
-- the canonical maintenance_operations identity where it exists and add only
-- the missing platform identity where it does not.
insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'maintenance_operations','Site Maintenance Manager','operational',
       'active','advisory','Waiting for a governed shift-handover request',
       'Maintenance Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='maintenance_operations'
);

update public.ai_agents
set name='Site Maintenance Manager', category='operational',
    autonomy_mode='advisory', supervisor='Maintenance Manager',
    operating_charter=jsonb_build_object(
      'purpose','Give the accountable site team a source-grounded execution picture for shift coordination and escalation.',
      'modes',jsonb_build_array('site maintenance manager','shift handover'),
      'triggers',jsonb_build_array('shift change','site coordination review','material or recovery constraint change'),
      'inputs',jsonb_build_array(
        'site work orders','process events','equipment custody','material readiness',
        'recovery blockers','operator rounds','daily coordination record'),
      'outputs',jsonb_build_array(
        'immutable shift-handover pack','source freshness','constraints and open-work summary'),
      'guardrails',jsonb_build_array(
        'Never invent an event, work order, material state, blocker, round or disposition',
        'Never assign or close work',
        'Never release or change a schedule',
        'Never change equipment custody or return equipment to service',
        'Never accept risk or commit spend',
        'Require a different named incoming-shift human to acknowledge the pack'),
      'routes',jsonb_build_array('/briefing','/handover','/work','/materials'))
where key='maintenance_operations';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_site_manager_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_site_manager_charter_shape
      check (key <> 'maintenance_operations' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Upgrade only the exact platform baseline.  Customer-authored profiles are
-- deliberately left untouched and therefore fail closed until their own
-- administrator adds the new right and tool.
do $$
declare
  r record;
  v_profile uuid;
  v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
           p.required_human_approver_role,p.proposal_risk_ceiling,
           p.proposal_cost_ceiling_usd,p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id
     and p.status='adopted'
    where a.key='maintenance_operations'
  loop
    if r.old_profile is not null and r.old_basis <> v_basis then
      continue;
    end if;
    if r.old_profile is null and exists (
      select 1 from public.agent_control_profiles history
      where history.agent_id=r.agent_id
    ) then
      continue;
    end if;
    select coalesce(max(version),0)+1 into v_version
    from public.agent_control_profiles where agent_id=r.agent_id;
    if r.old_profile is not null then
      update public.agent_control_profiles set status='superseded'
      where id=r.old_profile;
    end if;
    insert into public.agent_control_profiles
      (organization_id,agent_id,authority_mode,required_human_approver_role,
       proposal_risk_ceiling,proposal_cost_ceiling_usd,
       proposal_downtime_ceiling_hours,may_approve,basis,status,version,adopted_at)
    values
      (r.organization_id,r.agent_id,'advisory_only',
       coalesce(r.required_human_approver_role,'maintenance_manager'),
       coalesce(r.proposal_risk_ceiling,'Critical'),
       coalesce(r.proposal_cost_ceiling_usd,0),
       coalesce(r.proposal_downtime_ceiling_hours,0),false,
       v_basis,'draft',v_version,null)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d
    where d.right_key in ('recommend_inspection_review','generate_meeting_packs');

    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in (
      'analyse_reliability','draft_recommendation','read_work_context',
      'generate_shift_handover_pack');

    update public.agent_control_profiles
    set status='adopted',adopted_at=now()
    where id=v_profile;
  end loop;
end
$$;

alter table public.agent_runs
  add column if not exists site_id uuid references public.sites(id) on delete set null;

create index if not exists idx_agent_runs_retained_site
  on public.agent_runs(organization_id,site_id,created_at desc)
  where retained_for_governance;

-- Generalize the retained-run invariant introduced by the Planning agent:
-- governed runs must name canonical work OR a canonical site.  Existing
-- planner writes retain their marker; this agent has its own narrow marker.
create or replace function public.enforce_retained_agent_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_planner_marker text := coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text := coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_allowed boolean := v_planner_marker='granted' or v_site_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then
    return null;
  end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op <> 'DELETE' and new.retained_for_governance then
    if new.requested_by is null
       or (new.work_order_id is null and new.site_id is null)
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key),'')=''
       or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site scope, control profile, tool and decision-right provenance';
    end if;
    if not exists (
      select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id
    ) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists (
      select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id
    ) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.work_order_id is not null and not exists (
      select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id
    ) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists (
      select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id
    ) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if new.job_plan_id is not null and not exists (
      select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id
    ) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists (
      select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id
        and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted'
    ) then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create table if not exists public.shift_handover_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  window_start timestamptz not null,
  window_end timestamptz not null,
  outgoing_shift_label text not null check (length(btrim(outgoing_shift_label)) between 2 and 80),
  incoming_shift_label text not null check (length(btrim(incoming_shift_label)) between 2 and 80),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  source_freshness jsonb not null check (jsonb_typeof(source_freshness)='object'),
  limitations jsonb not null check (jsonb_typeof(limitations)='array'),
  status text not null default 'draft' check (status in ('draft','acknowledged')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_role text,
  acknowledged_at timestamptz,
  acknowledgement_note text,
  check (window_start < window_end),
  check (
    (status='draft' and acknowledged_by is null and acknowledged_role is null
      and acknowledged_at is null and acknowledgement_note is null)
    or
    (status='acknowledged' and acknowledged_by is not null
      and acknowledged_by <> created_by
      and length(btrim(acknowledged_role)) >= 2
      and acknowledged_at is not null
      and length(btrim(acknowledgement_note)) >= 10)
  )
);

create index if not exists idx_shift_handover_packs_site
  on public.shift_handover_packs(organization_id,site_id,created_at desc);

alter table public.shift_handover_packs enable row level security;
drop policy if exists shift_handover_packs_read on public.shift_handover_packs;
create policy shift_handover_packs_read on public.shift_handover_packs
  for select to authenticated
  using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on table public.shift_handover_packs
  from public,anon,authenticated;
grant select on table public.shift_handover_packs to authenticated;

create or replace function public.enforce_shift_handover_pack()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_write text := coalesce(current_setting('app.shift_handover_pack_write',true),'');
begin
  if tg_op='DELETE' then
    raise exception 'shift handover packs are retained governance records';
  end if;
  if v_write <> 'granted' then
    raise exception 'shift handover packs are written only by the governed agent and acknowledgement paths';
  end if;
  if tg_op='INSERT' then
    if not exists (
      select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id
    ) or not exists (
      select 1 from public.agent_runs r
      join public.ai_agents a on a.id=r.agent_id
      where r.id=new.agent_run_id and r.organization_id=new.organization_id
        and r.site_id=new.site_id and r.retained_for_governance
        and a.key='maintenance_operations'
    ) or not exists (
      select 1 from public.user_profiles p
      where p.id=new.created_by and p.organization_id=new.organization_id
    ) then
      raise exception 'handover pack crosses tenant/site/run/requester provenance';
    end if;
    return new;
  end if;
  if old.status <> 'draft' or new.status <> 'acknowledged'
     or new.organization_id is distinct from old.organization_id
     or new.site_id is distinct from old.site_id
     or new.agent_run_id is distinct from old.agent_run_id
     or new.window_start is distinct from old.window_start
     or new.window_end is distinct from old.window_end
     or new.outgoing_shift_label is distinct from old.outgoing_shift_label
     or new.incoming_shift_label is distinct from old.incoming_shift_label
     or new.source_snapshot is distinct from old.source_snapshot
     or new.source_freshness is distinct from old.source_freshness
     or new.limitations is distinct from old.limitations
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.acknowledged_by is null
     or new.acknowledged_by=old.created_by
     or new.acknowledged_at is null
     or coalesce(length(btrim(new.acknowledged_role)),0)<2
     or coalesce(length(btrim(new.acknowledgement_note)),0)<10 then
    raise exception 'a draft handover pack may only receive one complete acknowledgement from a different named human';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_shift_handover_pack()
  from public,anon,authenticated;
drop trigger if exists trg_shift_handover_pack on public.shift_handover_packs;
create trigger trg_shift_handover_pack
  before insert or update or delete on public.shift_handover_packs
  for each row execute function public.enforce_shift_handover_pack();

create or replace function public.run_site_maintenance_manager_agent(
  p_site_id uuid,
  p_window_hours integer default 12,
  p_outgoing_shift_label text default 'Outgoing shift',
  p_incoming_shift_label text default 'Incoming shift'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_site public.sites%rowtype;
  v_agent public.ai_agents%rowtype;
  v_control jsonb;
  v_hours integer := least(greatest(coalesce(p_window_hours,12),1),168);
  v_end timestamptz := now();
  v_start timestamptz;
  v_work jsonb := '[]'::jsonb;
  v_events jsonb := '[]'::jsonb;
  v_releases jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_rounds jsonb := '[]'::jsonb;
  v_coordination jsonb := null;
  v_snapshot jsonb;
  v_freshness jsonb;
  v_limitations jsonb;
  v_run uuid;
  v_pack uuid;
  v_result jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('maintenance_manager','supervisor','admin') then
    return jsonb_build_object('error',
      'running the Site Maintenance Manager agent requires a named maintenance manager, supervisor or administrator');
  end if;
  select * into v_site from public.sites
  where id=p_site_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','site not found'); end if;
  if coalesce(length(btrim(p_outgoing_shift_label)),0) not between 2 and 80
     or coalesce(length(btrim(p_incoming_shift_label)),0) not between 2 and 80 then
    return jsonb_build_object('error','name both outgoing and incoming shifts (2–80 characters)');
  end if;
  select * into v_agent from public.ai_agents
  where organization_id=v_org and key='maintenance_operations'
  order by created_at limit 1;
  if not found then
    return jsonb_build_object('error','no Site Maintenance Manager agent is configured in this organization');
  end if;
  v_control:=public.evaluate_agent_control_internal(
    v_org,v_agent.id,'generate_meeting_packs','generate_shift_handover_pack',
    'Critical',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Site Maintenance Manager agent refused: '||(v_control->>'reason'));
  end if;
  v_start:=v_end-make_interval(hours=>v_hours);

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','work:'||w.id,'workOrderId',w.id,'number',w.wo_number,
      'assetId',w.asset_id,'asset',coalesce(a.name,a.asset_tag,'Unassigned asset'),
      'title',w.title,'status',w.status,'priority',w.priority,
      'scheduledDate',w.scheduled_date,'createdAt',w.created_at)
      order by (w.priority='critical') desc,w.scheduled_date nulls last,w.created_at),'[]'::jsonb)
  into v_work
  from public.work_orders w
  left join public.assets a on a.id=w.asset_id and a.organization_id=w.organization_id
  where w.organization_id=v_org and a.site_id=p_site_id
    and w.status not in ('completed','closed','cancelled')
    and w.priority in ('high','critical');

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','event:'||e.id,'eventId',e.id,'assetId',e.asset_id,
      'asset',coalesce(a.name,a.asset_tag,'Unassigned asset'),
      'summary',coalesce(e.description,e.tag,'Process event'),
      'severity',e.severity,'occurredAt',e.occurred_at)
      order by (e.severity='critical') desc,e.occurred_at desc),'[]'::jsonb)
  into v_events
  from public.process_events e
  join public.assets a on a.id=e.asset_id and a.organization_id=e.organization_id
  where e.organization_id=v_org and a.site_id=p_site_id
    and e.occurred_at between v_start and v_end
    and e.severity in ('high','critical');

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','release:'||r.id,'releaseId',r.id,'assetId',r.asset_id,
      'asset',coalesce(a.name,a.asset_tag,'Asset'),'workOrderId',r.work_order_id,
      'status',r.status,'isolationConfirmed',r.isolation_confirmed,
      'releasedAt',r.released_at)
      order by r.released_at),'[]'::jsonb)
  into v_releases
  from public.equipment_releases r
  join public.assets a on a.id=r.asset_id and a.organization_id=r.organization_id
  where r.organization_id=v_org and a.site_id=p_site_id
    and r.status in ('released','returned');

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','material:'||m.id,'workOrderMaterialId',m.id,
      'workOrderId',w.id,'workOrderNumber',w.wo_number,
      'materialId',m.material_id,'materialCode',mat.material_code,
      'description',mat.description,'quantityRequired',m.qty_required,
      'quantityReserved',m.qty_reserved,'status',m.status,
      'neededBy',m.needed_by,'updatedAt',m.updated_at)
      order by m.needed_by nulls last,m.updated_at),'[]'::jsonb)
  into v_materials
  from public.work_order_materials m
  join public.work_orders w on w.id=m.work_order_id and w.organization_id=m.organization_id
  join public.assets a on a.id=w.asset_id and a.organization_id=w.organization_id
  join public.materials mat on mat.id=m.material_id and mat.organization_id=m.organization_id
  where m.organization_id=v_org and a.site_id=p_site_id
    and w.status not in ('completed','closed','cancelled')
    and m.status in ('requested','short');

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','blocker:'||b.id,'blockerId',b.id,'eventId',e.id,
      'eventCode',e.event_code,'description',b.description,
      'ownerRole',b.owner_role,'severity',b.severity,
      'dueAt',b.escalation_due_at,'startedAt',b.started_at)
      order by (b.severity='critical') desc,b.escalation_due_at nulls last,b.started_at),'[]'::jsonb)
  into v_blockers
  from public.restoration_blockers b
  join public.restoration_events e
    on e.id=b.event_id and e.organization_id=b.organization_id
  where b.organization_id=v_org and e.site_id=p_site_id and b.status='open';

  select coalesce(jsonb_agg(jsonb_build_object(
      'sourceKey','round:'||x.id,'executionId',x.id,'assetId',x.asset_id,
      'asset',coalesce(a.name,a.asset_tag,'Asset'),'status',x.status,
      'startedAt',x.started_at)
      order by x.started_at),'[]'::jsonb)
  into v_rounds
  from public.operator_round_executions x
  join public.assets a on a.id=x.asset_id and a.organization_id=x.organization_id
  where x.organization_id=v_org and a.site_id=p_site_id and x.status='in_progress';

  select jsonb_build_object(
      'meetingId',m.id,'status',m.status,'openedAt',m.opened_at,
      'agenda',m.agenda_snapshot,
      'dispositions',coalesce((select jsonb_agg(jsonb_build_object(
        'sourceKey',d.source_key,'disposition',d.disposition,'note',d.note,
        'ownerRole',d.owner_role,'dueAt',d.due_at,'workOrderId',d.work_order_id,
        'decisionId',d.decision_id) order by d.recorded_at)
        from public.daily_coordination_dispositions d
        where d.meeting_id=m.id and d.organization_id=v_org),'[]'::jsonb))
  into v_coordination
  from public.daily_coordination_meetings m
  where m.organization_id=v_org and m.site_id=p_site_id
  order by (m.status='open') desc,m.opened_at desc limit 1;

  v_snapshot:=jsonb_build_object(
    'asOf',v_end,'siteId',v_site.id,'siteName',v_site.name,
    'workOrders',v_work,'processEvents',v_events,
    'equipmentCustody',v_releases,'materialShortages',v_materials,
    'recoveryBlockers',v_blockers,'operatorRounds',v_rounds,
    'dailyCoordination',v_coordination);
  v_freshness:=jsonb_build_object(
    'asOf',v_end,'windowHours',v_hours,
    'workOrders',jsonb_build_object('count',jsonb_array_length(v_work),
      'latestAt',(select max(w.created_at) from public.work_orders w join public.assets a on a.id=w.asset_id where w.organization_id=v_org and a.site_id=p_site_id)),
    'processEvents',jsonb_build_object('count',jsonb_array_length(v_events),
      'latestAt',(select max(e.occurred_at) from public.process_events e join public.assets a on a.id=e.asset_id where e.organization_id=v_org and a.site_id=p_site_id)),
    'equipmentCustody',jsonb_build_object('count',jsonb_array_length(v_releases),
      'latestAt',(select max(r.released_at) from public.equipment_releases r join public.assets a on a.id=r.asset_id where r.organization_id=v_org and a.site_id=p_site_id)),
    'materialShortages',jsonb_build_object('count',jsonb_array_length(v_materials),
      'latestAt',(select max(m.updated_at) from public.work_order_materials m join public.work_orders w on w.id=m.work_order_id join public.assets a on a.id=w.asset_id where m.organization_id=v_org and a.site_id=p_site_id)),
    'recoveryBlockers',jsonb_build_object('count',jsonb_array_length(v_blockers),
      'latestAt',(select max(b.started_at) from public.restoration_blockers b join public.restoration_events e on e.id=b.event_id where b.organization_id=v_org and e.site_id=p_site_id)),
    'operatorRounds',jsonb_build_object('count',jsonb_array_length(v_rounds),
      'latestAt',(select max(x.started_at) from public.operator_round_executions x join public.assets a on a.id=x.asset_id where x.organization_id=v_org and a.site_id=p_site_id)),
    'dailyCoordination',jsonb_build_object('present',v_coordination is not null,
      'latestAt',(select max(m.opened_at) from public.daily_coordination_meetings m where m.organization_id=v_org and m.site_id=p_site_id)));
  v_limitations:=jsonb_build_array(
    'The pack contains only records present in the named canonical tenant stores at the captured time.',
    'An empty section means no matching record was found; it is not evidence that the site is safe, ready or unconstrained.',
    'Acknowledgement confirms receipt of this frozen picture only; it does not close work, accept risk or discharge an action.',
    'The agent cannot assign work, release schedules, alter equipment custody, commit spend or return equipment to service.');

  perform set_config('app.site_manager_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,status,summary,confidence,started_at,
     requested_by,site_id,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,retained_for_governance)
  values
    (v_org,v_agent.id,'running','Site Maintenance Manager agent is freezing canonical site context.',
     100,now(),auth.uid(),v_site.id,(v_control->>'profile_id')::uuid,
     'generate_shift_handover_pack','generate_meeting_packs',
     jsonb_build_object('siteId',v_site.id,'windowStart',v_start,'windowEnd',v_end,
       'outgoingShift',btrim(p_outgoing_shift_label),
       'incomingShift',btrim(p_incoming_shift_label),
       'sourceTables',jsonb_build_array(
         'work_orders','process_events','equipment_releases','work_order_materials',
         'restoration_blockers','operator_round_executions',
         'daily_coordination_meetings','daily_coordination_dispositions')),
     true)
  returning id into v_run;

  perform set_config('app.shift_handover_pack_write','granted',true);
  insert into public.shift_handover_packs
    (organization_id,site_id,agent_run_id,window_start,window_end,
     outgoing_shift_label,incoming_shift_label,source_snapshot,
     source_freshness,limitations,created_by)
  values
    (v_org,v_site.id,v_run,v_start,v_end,btrim(p_outgoing_shift_label),
     btrim(p_incoming_shift_label),v_snapshot,v_freshness,v_limitations,auth.uid())
  returning id into v_pack;
  perform set_config('app.shift_handover_pack_write','',true);

  v_result:=jsonb_build_object(
    'pack_id',v_pack,'run_id',v_run,'site_id',v_site.id,'site_name',v_site.name,
    'status','draft','window_start',v_start,'window_end',v_end,
    'counts',jsonb_build_object(
      'work_orders',jsonb_array_length(v_work),
      'process_events',jsonb_array_length(v_events),
      'equipment_custody',jsonb_array_length(v_releases),
      'material_shortages',jsonb_array_length(v_materials),
      'recovery_blockers',jsonb_array_length(v_blockers),
      'operator_rounds',jsonb_array_length(v_rounds)),
    'human_acknowledgement_required',true,
    'acknowledgement_must_be_different_human',true,
    'may_assign_work',false,'may_close_work',false,
    'may_release_schedule',false,'may_change_equipment_custody',false,
    'may_accept_risk',false,'may_commit_spend',false,
    'may_return_to_service',false,
    'basis','Frozen reading of canonical same-tenant site records. No missing condition, action, readiness or safety conclusion was invented.');

  update public.agent_runs
  set status='completed',completed_at=now(),
      summary='Created one immutable, non-authoritative site shift-handover pack for acknowledgement by a different named human.',
      result=v_result
  where id=v_run;
  perform set_config('app.site_manager_agent_run_write','',true);

  update public.ai_agents
  set last_action_at=now(),status='active',
      current_task='Shift handover for '||v_site.name,
      last_action='Generated a governed shift-handover pack',
      recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=v_agent.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'shift_handover_pack',v_role,
    jsonb_build_object('action','generated','pack_id',v_pack,'agent_run_id',v_run,
      'site_id',v_site.id,'requested_by',auth.uid(),
      'control_profile_id',v_control->>'profile_id',
      'human_acknowledgement_required',true));
  return v_result;
end
$$;

create or replace function public.acknowledge_shift_handover_pack(
  p_pack_id uuid,p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_pack public.shift_handover_packs%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('operator','technician','supervisor','planner','maintenance_manager','admin') then
    return jsonb_build_object('error','acknowledgement requires a named incoming operations or maintenance role');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','record a meaningful acknowledgement note (10 characters minimum)');
  end if;
  select * into v_pack from public.shift_handover_packs
  where id=p_pack_id and organization_id=v_org and status='draft'
  for update;
  if not found then return jsonb_build_object('error','draft handover pack not found'); end if;
  if v_pack.created_by=auth.uid() then
    return jsonb_build_object('error','the incoming-shift acknowledgement must come from a different named human');
  end if;
  perform set_config('app.shift_handover_pack_write','granted',true);
  update public.shift_handover_packs
  set status='acknowledged',acknowledged_by=auth.uid(),
      acknowledged_role=v_role,acknowledged_at=now(),
      acknowledgement_note=btrim(p_note)
  where id=v_pack.id;
  perform set_config('app.shift_handover_pack_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'shift_handover_pack',v_role,
    jsonb_build_object('action','acknowledged','pack_id',v_pack.id,
      'site_id',v_pack.site_id,'acknowledged_by',auth.uid(),
      'boundary','receipt only; no work, risk, schedule, custody or return-to-service state changed'));
  return jsonb_build_object('pack_id',v_pack.id,'status','acknowledged',
    'acknowledged_by',auth.uid(),'acknowledged_role',v_role,
    'source_state_changed',false);
end
$$;

create or replace function public.get_shift_handover_packs(
  p_site_id uuid default null,p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_limit integer:=least(greatest(coalesce(p_limit,20),1),100);
begin
  if v_org is null or auth.uid() is null then
    raise exception 'authenticated organization membership is required'
      using errcode='insufficient_privilege';
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id=p_site_id and organization_id=v_org
  ) then raise exception 'site not found'; end if;
  return coalesce((select jsonb_agg(x.row order by x.created_at desc) from (
    select p.created_at,jsonb_build_object(
      'id',p.id,'siteId',p.site_id,'siteName',s.name,
      'agentRunId',p.agent_run_id,'windowStart',p.window_start,
      'windowEnd',p.window_end,'outgoingShiftLabel',p.outgoing_shift_label,
      'incomingShiftLabel',p.incoming_shift_label,
      'sourceSnapshot',p.source_snapshot,'sourceFreshness',p.source_freshness,
      'limitations',p.limitations,'status',p.status,
      'createdBy',p.created_by,'createdAt',p.created_at,
      'acknowledgedBy',p.acknowledged_by,
      'acknowledgedRole',p.acknowledged_role,
      'acknowledgedAt',p.acknowledged_at,
      'acknowledgementNote',p.acknowledgement_note) row
    from public.shift_handover_packs p
    join public.sites s on s.id=p.site_id and s.organization_id=p.organization_id
    where p.organization_id=v_org
      and (p_site_id is null or p.site_id=p_site_id)
    order by p.created_at desc limit v_limit
  ) x),'[]'::jsonb);
end
$$;

revoke all on function public.run_site_maintenance_manager_agent(uuid,integer,text,text)
  from public,anon;
grant execute on function public.run_site_maintenance_manager_agent(uuid,integer,text,text)
  to authenticated;
revoke all on function public.acknowledge_shift_handover_pack(uuid,text)
  from public,anon;
grant execute on function public.acknowledge_shift_handover_pack(uuid,text)
  to authenticated;
revoke all on function public.get_shift_handover_packs(uuid,integer)
  from public,anon;
grant execute on function public.get_shift_handover_packs(uuid,integer)
  to authenticated;

comment on function public.run_site_maintenance_manager_agent(uuid,integer,text,text) is
  'C1.02/C5.09 governed Site Maintenance Manager act: freezes canonical same-tenant site context into one immutable advisory shift-handover pack with retained agent/control provenance. It grants no assignment, closure, schedule, custody, risk, spend or return-to-service authority.';
comment on table public.shift_handover_packs is
  'C5.09 immutable generated site handover evidence. A different named incoming-shift human may acknowledge receipt; acknowledgement is not action closeout or operational authority.';

notify pgrst,'reload schema';
