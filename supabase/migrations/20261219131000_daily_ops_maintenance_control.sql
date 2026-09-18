-- E3.09 Joint operations-maintenance daily control room.
-- Immutable agenda snapshots are assembled from canonical operational stores.
-- Meeting dispositions are a coordination record, never a substitute task or
-- decision queue: action/escalation must link to canonical work_orders or decisions.

create table if not exists public.daily_coordination_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete set null,
  meeting_date date not null default current_date,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  agenda_snapshot jsonb not null,
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  closing_note text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(agenda_snapshot)='object')
);
create unique index if not exists idx_daily_coordination_one_open_scope
  on public.daily_coordination_meetings(organization_id,coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where status='open';
create index if not exists idx_daily_coordination_history
  on public.daily_coordination_meetings(organization_id,meeting_date desc,opened_at desc);

create table if not exists public.daily_coordination_attendees (
  meeting_id uuid not null references public.daily_coordination_meetings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  attendance_function text not null check (attendance_function in ('operations','maintenance')),
  attested_at timestamptz not null default now(),
  primary key(meeting_id,user_id)
);

create table if not exists public.daily_coordination_dispositions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.daily_coordination_meetings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null,
  disposition text not null check (disposition in ('acknowledged','monitor','action','escalated')),
  note text not null,
  owner_role text,
  due_at timestamptz,
  work_order_id uuid references public.work_orders(id) on delete set null,
  decision_id uuid references public.decisions(id) on delete set null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique(meeting_id,source_key),
  check (disposition not in ('action','escalated') or (owner_role is not null and due_at is not null)),
  check (disposition not in ('action','escalated') or work_order_id is not null or decision_id is not null)
);

create index if not exists idx_daily_coordination_dispositions
  on public.daily_coordination_dispositions(organization_id,meeting_id,recorded_at);

alter table public.daily_coordination_meetings enable row level security;
alter table public.daily_coordination_attendees enable row level security;
alter table public.daily_coordination_dispositions enable row level security;
drop policy if exists daily_coordination_meetings_read on public.daily_coordination_meetings;
create policy daily_coordination_meetings_read on public.daily_coordination_meetings
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists daily_coordination_attendees_read on public.daily_coordination_attendees;
create policy daily_coordination_attendees_read on public.daily_coordination_attendees
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists daily_coordination_dispositions_read on public.daily_coordination_dispositions;
create policy daily_coordination_dispositions_read on public.daily_coordination_dispositions
  for select to authenticated using (organization_id=public.app_current_org());
revoke insert,update,delete on public.daily_coordination_meetings,public.daily_coordination_attendees,
  public.daily_coordination_dispositions from authenticated;
grant select on public.daily_coordination_meetings,public.daily_coordination_attendees,
  public.daily_coordination_dispositions to authenticated;

create or replace function public.assert_daily_coordination_actor(p_action text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
begin
  if v_org is null or v_uid is null then raise exception '% requires an authenticated organization member',p_action using errcode='insufficient_privilege'; end if;
  select role into v_role from public.user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then raise exception 'AI may prepare the agenda but cannot %; a named human must attest the meeting record',p_action using errcode='insufficient_privilege'; end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','supervisor','operator','technician','planner') then
    raise exception '% requires an accountable operations or maintenance role',p_action using errcode='insufficient_privilege';
  end if;
  return v_uid;
end $$;

create or replace function public.open_daily_coordination_meeting(p_site_id uuid default null,p_window_hours integer default 24)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid; v_id uuid; v_items jsonb; v_hours int:=least(greatest(p_window_hours,1),168);
begin
  v_uid:=public.assert_daily_coordination_actor('open a daily coordination meeting');
  if p_site_id is not null and not exists(select 1 from public.sites where id=p_site_id and organization_id=v_org) then raise exception 'site is not in this organization'; end if;
  if exists(select 1 from public.daily_coordination_meetings where organization_id=v_org and site_id is not distinct from p_site_id and status='open') then raise exception 'this scope already has an open daily coordination meeting'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceKey',q.source_key,'kind',q.kind,'sourceId',q.source_id,'assetId',q.asset_id,
    'asset',q.asset,'summary',q.summary,'severity',q.severity,'critical',q.critical,'occurredAt',q.occurred_at)
    order by q.critical desc,q.occurred_at desc),'[]'::jsonb) into v_items
  from (
    select concat('event:',e.id) source_key,'process_event' kind,e.id::text source_id,e.asset_id,
      coalesce(a.name,a.asset_tag,'Unassigned asset') asset,coalesce(e.description,e.tag,'Process event') summary,
      coalesce(e.severity,'unknown') severity,e.severity='critical' critical,e.occurred_at
    from public.process_events e left join public.assets a on a.id=e.asset_id and a.organization_id=e.organization_id
    where e.organization_id=v_org and e.occurred_at>=now()-make_interval(hours=>v_hours)
      and e.severity in ('high','critical') and (p_site_id is null or a.site_id=p_site_id)
    union all
    select concat('work:',w.id),'work_order',w.id::text,w.asset_id,coalesce(a.name,a.asset_tag,'Unassigned asset'),
      concat(coalesce(w.wo_number,'Work'),': ',w.title),coalesce(w.priority,'unknown'),w.priority='critical',w.created_at
    from public.work_orders w left join public.assets a on a.id=w.asset_id and a.organization_id=w.organization_id
    where w.organization_id=v_org and w.completed_at is null and w.priority in ('high','critical')
      and (p_site_id is null or a.site_id=p_site_id)
    union all
    select concat('release:',r.id),'equipment_release',r.id::text,r.asset_id,coalesce(a.name,a.asset_tag,'Asset'),
      case when r.status='returned' then 'Returned by maintenance; awaiting operations acceptance' else 'Released to maintenance' end,
      case when r.status='returned' then 'high' else 'medium' end,false,r.released_at
    from public.equipment_releases r join public.assets a on a.id=r.asset_id and a.organization_id=r.organization_id
    where r.organization_id=v_org and r.status in ('released','returned') and (p_site_id is null or a.site_id=p_site_id)
    union all
    select concat('blocker:',b.id),'recovery_blocker',b.id::text,e.asset_id,coalesce(a.name,a.asset_tag,'Asset'),
      b.description,b.severity,b.severity='critical' critical,b.started_at
    from public.restoration_blockers b join public.restoration_events e on e.id=b.event_id and e.organization_id=b.organization_id
      join public.assets a on a.id=e.asset_id and a.organization_id=e.organization_id
    where b.organization_id=v_org and b.status='open' and b.severity in ('high','critical')
      and (p_site_id is null or e.site_id=p_site_id)
    union all
    select concat('round:',x.id),'operator_round',x.id::text,x.asset_id,coalesce(a.name,a.asset_tag,'Asset'),
      'Operator round remains in progress','medium',false,x.started_at
    from public.operator_round_executions x join public.assets a on a.id=x.asset_id and a.organization_id=x.organization_id
    where x.organization_id=v_org and x.status='in_progress' and (p_site_id is null or a.site_id=p_site_id)
  ) q;
  insert into public.daily_coordination_meetings(organization_id,site_id,agenda_snapshot,opened_by)
  values(v_org,p_site_id,jsonb_build_object('items',v_items,'windowHours',v_hours,'generatedAt',now(),
    'basis','Snapshot of canonical process events, high-priority work, equipment handovers, recovery blockers and in-progress operator rounds. Empty means no matching records, not that the site is risk-free.'),v_uid)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'daily_coordination_meeting',v_uid::text,
    jsonb_build_object('id',v_id,'action','opened','siteId',p_site_id,'agendaItems',jsonb_array_length(v_items),'windowHours',v_hours));
  return jsonb_build_object('id',v_id,'status','open','agendaItems',jsonb_array_length(v_items));
end $$;

create or replace function public.attest_daily_coordination_attendance(p_meeting_id uuid,p_function text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid;
begin
  v_uid:=public.assert_daily_coordination_actor('attest daily meeting attendance');
  if p_function not in ('operations','maintenance') then raise exception 'attendance function must be operations or maintenance'; end if;
  if not exists(select 1 from public.daily_coordination_meetings where id=p_meeting_id and organization_id=v_org and status='open') then raise exception 'open daily meeting not found in this organization'; end if;
  insert into public.daily_coordination_attendees(meeting_id,organization_id,user_id,attendance_function)
  values(p_meeting_id,v_org,v_uid,p_function) on conflict(meeting_id,user_id) do update set attendance_function=excluded.attendance_function,attested_at=now();
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'daily_coordination_attendance',v_uid::text,jsonb_build_object('meetingId',p_meeting_id,'action','attested','function',p_function));
  return jsonb_build_object('meetingId',p_meeting_id,'status','attested','function',p_function);
end $$;

create or replace function public.record_daily_coordination_disposition(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid; v_meeting uuid:=nullif(p_record->>'meeting_id','')::uuid;
  v_source text:=btrim(coalesce(p_record->>'source_key','')); v_disposition text:=p_record->>'disposition'; v_note text:=btrim(coalesce(p_record->>'note',''));
  v_agenda jsonb; v_critical boolean; v_work uuid:=nullif(p_record->>'work_order_id','')::uuid; v_decision uuid:=nullif(p_record->>'decision_id','')::uuid; v_id uuid;
begin
  v_uid:=public.assert_daily_coordination_actor('record a daily meeting disposition');
  select agenda_snapshot into v_agenda from public.daily_coordination_meetings where id=v_meeting and organization_id=v_org and status='open' for update;
  if not found then raise exception 'open daily meeting not found in this organization'; end if;
  if not exists(select 1 from jsonb_array_elements(v_agenda->'items') i where i->>'sourceKey'=v_source) then raise exception 'disposition must name an item in the immutable meeting agenda'; end if;
  select coalesce((i->>'critical')::boolean,false) into v_critical from jsonb_array_elements(v_agenda->'items') i where i->>'sourceKey'=v_source;
  if v_disposition not in ('acknowledged','monitor','action','escalated') or length(v_note)<10 then raise exception 'choose a valid disposition and record a meaningful meeting note'; end if;
  if v_critical and v_disposition not in ('action','escalated') then raise exception 'critical agenda items require a linked action or escalation; acknowledgement alone is not closeout'; end if;
  if v_disposition in ('action','escalated') and (length(btrim(coalesce(p_record->>'owner_role','')))<2 or nullif(p_record->>'due_at','') is null or (v_work is null and v_decision is null)) then raise exception 'actions and escalations require an owner, due date, and canonical work order or decision'; end if;
  if v_work is not null and not exists(select 1 from public.work_orders where id=v_work and organization_id=v_org) then raise exception 'work order is not in this organization'; end if;
  if v_decision is not null and not exists(select 1 from public.decisions where id=v_decision and organization_id=v_org) then raise exception 'decision is not in this organization'; end if;
  insert into public.daily_coordination_dispositions(meeting_id,organization_id,source_key,disposition,note,owner_role,due_at,work_order_id,decision_id,recorded_by)
  values(v_meeting,v_org,v_source,v_disposition,v_note,nullif(btrim(p_record->>'owner_role'),''),nullif(p_record->>'due_at','')::timestamptz,v_work,v_decision,v_uid)
  on conflict(meeting_id,source_key) do update set disposition=excluded.disposition,note=excluded.note,owner_role=excluded.owner_role,due_at=excluded.due_at,
    work_order_id=excluded.work_order_id,decision_id=excluded.decision_id,recorded_by=excluded.recorded_by,recorded_at=now() returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'daily_coordination_disposition',v_uid::text,
    jsonb_build_object('id',v_id,'meetingId',v_meeting,'sourceKey',v_source,'disposition',v_disposition,'workOrderId',v_work,'decisionId',v_decision,'action','recorded'));
  return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.complete_daily_coordination_meeting(p_meeting_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid; v_agenda jsonb; v_missing text[];
begin
  v_uid:=public.assert_daily_coordination_actor('complete a daily coordination meeting');
  if length(btrim(coalesce(p_note,'')))<10 then raise exception 'closing note must record the joint meeting outcome'; end if;
  select agenda_snapshot into v_agenda from public.daily_coordination_meetings where id=p_meeting_id and organization_id=v_org and status='open' for update;
  if not found then raise exception 'open daily meeting not found in this organization'; end if;
  if not exists(select 1 from public.daily_coordination_attendees where meeting_id=p_meeting_id and organization_id=v_org and attendance_function='operations')
     or not exists(select 1 from public.daily_coordination_attendees where meeting_id=p_meeting_id and organization_id=v_org and attendance_function='maintenance') then
    raise exception 'joint closeout requires separate human attendance from both operations and maintenance';
  end if;
  select array_agg(i->>'sourceKey') into v_missing from jsonb_array_elements(v_agenda->'items') i
    where coalesce((i->>'critical')::boolean,false) and not exists(select 1 from public.daily_coordination_dispositions d
      where d.meeting_id=p_meeting_id and d.organization_id=v_org and d.source_key=i->>'sourceKey' and d.disposition in ('action','escalated'));
  if coalesce(array_length(v_missing,1),0)>0 then raise exception 'critical agenda items still require linked action or escalation: %',array_to_string(v_missing,', '); end if;
  update public.daily_coordination_meetings set status='completed',completed_by=v_uid,completed_at=now(),closing_note=btrim(p_note)
   where id=p_meeting_id and organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'daily_coordination_meeting',v_uid::text,
    jsonb_build_object('id',p_meeting_id,'action','completed','closingNote',btrim(p_note)));
  return jsonb_build_object('id',p_meeting_id,'status','completed');
end $$;

create or replace function public.get_daily_coordination_control()
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_meeting public.daily_coordination_meetings%rowtype;
begin
  if auth.uid() is null or v_org is null then raise exception 'authenticated organization membership is required' using errcode='insufficient_privilege'; end if;
  select * into v_meeting from public.daily_coordination_meetings where organization_id=v_org and status='open' order by opened_at desc limit 1;
  return jsonb_build_object('meeting',case when v_meeting.id is null then null else jsonb_build_object('id',v_meeting.id,'siteId',v_meeting.site_id,'meetingDate',v_meeting.meeting_date,'status',v_meeting.status,'agenda',v_meeting.agenda_snapshot,'openedAt',v_meeting.opened_at) end,
    'attendees',coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'function',a.attendance_function,'attestedAt',a.attested_at) order by a.attested_at) from public.daily_coordination_attendees a where a.meeting_id=v_meeting.id),'[]'::jsonb),
    'dispositions',coalesce((select jsonb_agg(jsonb_build_object('sourceKey',d.source_key,'disposition',d.disposition,'note',d.note,'ownerRole',d.owner_role,'dueAt',d.due_at,'workOrderId',d.work_order_id,'decisionId',d.decision_id) order by d.recorded_at) from public.daily_coordination_dispositions d where d.meeting_id=v_meeting.id),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(x.row) from (select jsonb_build_object('id',m.id,'meetingDate',m.meeting_date,'status',m.status,'completedAt',m.completed_at,'closingNote',m.closing_note) row from public.daily_coordination_meetings m where m.organization_id=v_org and m.status='completed' order by m.completed_at desc limit 5)x),'[]'::jsonb));
end $$;

revoke all on function public.assert_daily_coordination_actor(text) from public,anon,authenticated;
revoke all on function public.open_daily_coordination_meeting(uuid,integer) from public,anon;
revoke all on function public.attest_daily_coordination_attendance(uuid,text) from public,anon;
revoke all on function public.record_daily_coordination_disposition(jsonb) from public,anon;
revoke all on function public.complete_daily_coordination_meeting(uuid,text) from public,anon;
revoke all on function public.get_daily_coordination_control() from public,anon;
grant execute on function public.open_daily_coordination_meeting(uuid,integer) to authenticated;
grant execute on function public.attest_daily_coordination_attendance(uuid,text) to authenticated;
grant execute on function public.record_daily_coordination_disposition(jsonb) to authenticated;
grant execute on function public.complete_daily_coordination_meeting(uuid,text) to authenticated;
grant execute on function public.get_daily_coordination_control() to authenticated;
notify pgrst,'reload schema';
