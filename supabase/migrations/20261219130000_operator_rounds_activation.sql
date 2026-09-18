-- E3.01 Operator rounds and operator-driven reliability.
--
-- A round definition is the approved checklist; an execution is the field
-- record; an observation is measured/inspected evidence. Deviations are
-- copied only into the canonical process_events stream (not a new alert
-- queue). SyncAI supplies no limits, pass criteria, or operating decisions.

create table if not exists public.operator_round_definitions (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  round_ref text not null,
  version integer not null default 1 check (version > 0),
  supersedes_definition_id bigint references public.operator_round_definitions(id),
  title text not null,
  cadence text not null,
  checks jsonb not null,
  evidence_basis text not null,
  active boolean not null default true,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, round_ref, version),
  check (jsonb_typeof(checks) = 'array' and jsonb_array_length(checks) > 0)
);

create table if not exists public.operator_round_executions (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition_id bigint not null references public.operator_round_definitions(id),
  asset_id uuid not null references public.assets(id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('in_progress','completed','completed_with_deviation')),
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.operator_round_observations (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  execution_id bigint not null references public.operator_round_executions(id) on delete cascade,
  check_key text not null,
  classification text not null check (classification in ('normal','deviation','critical')),
  reading_numeric numeric,
  reading_text text,
  unit text,
  note text,
  evidence_id uuid not null references public.evidence_items(id),
  process_event_id bigint references public.process_events(id),
  observed_by uuid not null references auth.users(id),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (execution_id, check_key),
  check (reading_numeric is not null or nullif(btrim(reading_text),'') is not null or nullif(btrim(note),'') is not null),
  check ((classification = 'normal' and process_event_id is null) or classification <> 'normal')
);

create index if not exists idx_operator_round_definitions_asset
  on public.operator_round_definitions(organization_id, asset_id, active);
create unique index if not exists idx_operator_round_definitions_active_ref
  on public.operator_round_definitions(organization_id, round_ref) where active;
create index if not exists idx_operator_round_executions_asset
  on public.operator_round_executions(organization_id, asset_id, started_at desc);
create index if not exists idx_operator_round_observations_execution
  on public.operator_round_observations(organization_id, execution_id, observed_at);

alter table public.operator_round_definitions enable row level security;
alter table public.operator_round_executions enable row level security;
alter table public.operator_round_observations enable row level security;

drop policy if exists operator_round_definitions_read on public.operator_round_definitions;
create policy operator_round_definitions_read on public.operator_round_definitions
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists operator_round_executions_read on public.operator_round_executions;
create policy operator_round_executions_read on public.operator_round_executions
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists operator_round_observations_read on public.operator_round_observations;
create policy operator_round_observations_read on public.operator_round_observations
  for select to authenticated using (organization_id = public.app_current_org());

revoke insert, update, delete on public.operator_round_definitions from authenticated;
revoke insert, update, delete on public.operator_round_executions from authenticated;
revoke insert, update, delete on public.operator_round_observations from authenticated;
grant select on public.operator_round_definitions, public.operator_round_executions,
  public.operator_round_observations to authenticated;

create or replace function public.assert_operator_round_actor(p_action text, p_can_define boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid:=auth.uid(); v_role text;
begin
  if v_org is null or v_uid is null then
    raise exception '% requires an authenticated organization member', p_action using errcode='insufficient_privilege';
  end if;
  select role into v_role from public.user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    raise exception 'AI cannot %; a named human must perform and attest the round', p_action using errcode='insufficient_privilege';
  end if;
  if p_can_define and coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer','supervisor') then
    raise exception '% requires accountable maintenance or reliability authority', p_action using errcode='insufficient_privilege';
  end if;
  if not p_can_define and coalesce(v_role,'') not in
    ('admin','executive','maintenance_manager','reliability_engineer','supervisor','operator','technician') then
    raise exception '% requires an accountable field role', p_action using errcode='insufficient_privilege';
  end if;
  return v_uid;
end $$;

create or replace function public.define_operator_round(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid; v_asset uuid:=nullif(p_record->>'asset_id','')::uuid;
  v_checks jsonb:=p_record->'checks'; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
  v_id bigint; v_previous bigint; v_version integer:=1;
begin
  v_uid:=public.assert_operator_round_actor('approve an operator-round definition', true);
  if v_asset is null or not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then
    raise exception 'name an asset in this organization';
  end if;
  if length(btrim(coalesce(p_record->>'round_ref','')))<2
     or length(btrim(coalesce(p_record->>'title','')))<3
     or length(btrim(coalesce(p_record->>'cadence','')))<3
     or v_basis is null or length(v_basis)<20 then
    raise exception 'reference, title, owner-approved cadence and evidence basis are required';
  end if;
  if jsonb_typeof(v_checks) is distinct from 'array' or jsonb_array_length(v_checks)=0
     or exists(select 1 from jsonb_array_elements(v_checks) c
       where length(btrim(coalesce(c->>'key','')))<1
          or length(btrim(coalesce(c->>'label','')))<3
          or coalesce(c->>'required','') not in ('true','false')) then
    raise exception 'checks must be a non-empty array of unique key, label and required declarations; SyncAI does not invent checks or limits';
  end if;
  if (select count(*) from jsonb_array_elements(v_checks)) <>
     (select count(distinct c->>'key') from jsonb_array_elements(v_checks) c) then
    raise exception 'check keys must be unique';
  end if;
  select id,version into v_previous,v_version from public.operator_round_definitions
   where organization_id=v_org and round_ref=btrim(p_record->>'round_ref') and active for update;
  if found then
    if exists(select 1 from public.operator_round_executions
      where organization_id=v_org and definition_id=v_previous and status='in_progress') then
      raise exception 'finish the in-progress round before approving a revised definition';
    end if;
    update public.operator_round_definitions set active=false where id=v_previous and organization_id=v_org;
    v_version:=v_version+1;
  else
    v_version:=1;
  end if;
  insert into public.operator_round_definitions
    (organization_id,asset_id,round_ref,version,supersedes_definition_id,title,cadence,checks,evidence_basis,approved_by)
  values (v_org,v_asset,btrim(p_record->>'round_ref'),v_version,v_previous,btrim(p_record->>'title'),
    btrim(p_record->>'cadence'),v_checks,v_basis,v_uid) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operator_round_definition',v_uid::text,
    jsonb_build_object('id',v_id,'assetId',v_asset,'action','approved','version',v_version,
      'supersedesDefinitionId',v_previous,'evidenceBasis',v_basis));
  return jsonb_build_object('id',v_id,'status','approved','version',v_version);
end $$;

create or replace function public.start_operator_round(p_definition_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid; v_asset uuid; v_id bigint;
begin
  v_uid:=public.assert_operator_round_actor('start an operator round');
  select asset_id into v_asset from public.operator_round_definitions
   where id=p_definition_id and organization_id=v_org and active;
  if not found then raise exception 'active operator-round definition not found in this organization'; end if;
  if exists(select 1 from public.operator_round_executions
    where organization_id=v_org and definition_id=p_definition_id and status='in_progress') then
    raise exception 'this round already has an in-progress execution';
  end if;
  insert into public.operator_round_executions
    (organization_id,definition_id,asset_id,started_by)
  values(v_org,p_definition_id,v_asset,v_uid) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operator_round_execution',v_uid::text,
    jsonb_build_object('id',v_id,'definitionId',p_definition_id,'assetId',v_asset,'action','started'));
  return jsonb_build_object('id',v_id,'status','in_progress');
end $$;

create or replace function public.record_operator_round_observation(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_uid uuid; v_execution bigint:=nullif(p_record->>'execution_id','')::bigint;
  v_check text:=btrim(coalesce(p_record->>'check_key','')); v_class text:=p_record->>'classification';
  v_asset uuid; v_checks jsonb; v_evidence uuid; v_event bigint; v_id bigint; v_description text;
begin
  v_uid:=public.assert_operator_round_actor('record an operator-round observation');
  select e.asset_id,d.checks into v_asset,v_checks
    from public.operator_round_executions e join public.operator_round_definitions d on d.id=e.definition_id
   where e.id=v_execution and e.organization_id=v_org and d.organization_id=v_org and e.status='in_progress' for update of e;
  if not found then raise exception 'in-progress operator round not found in this organization'; end if;
  if not exists(select 1 from jsonb_array_elements(v_checks) c where c->>'key'=v_check) then
    raise exception 'observation must name a check in the approved round definition';
  end if;
  if v_class not in ('normal','deviation','critical') then
    raise exception 'classification must be normal, deviation, or critical and must be chosen by the human observer';
  end if;
  if nullif(p_record->>'reading_numeric','') is null
     and nullif(btrim(p_record->>'reading_text'),'') is null
     and length(btrim(coalesce(p_record->>'note','')))<3 then
    raise exception 'record a numeric reading, text reading, or observation note';
  end if;
  if v_class <> 'normal' and length(btrim(coalesce(p_record->>'note','')))<10 then
    raise exception 'a deviation or critical observation requires a meaningful field note';
  end if;
  v_description:=coalesce(nullif(btrim(p_record->>'note'),''),nullif(btrim(p_record->>'reading_text'),''),
    concat('Observed value ',p_record->>'reading_numeric',nullif(concat(' ',btrim(p_record->>'unit')),' ')));
  insert into public.evidence_items
    (organization_id,asset_id,source_system,evidence_type,description,data_quality,related_asset,ts,evidence_class)
  values(v_org,v_asset,'operator_round','field_observation',v_description,'operator_attested',v_asset::text,
    coalesce(nullif(p_record->>'observed_at','')::timestamptz,now()),
    case when nullif(p_record->>'reading_numeric','') is not null then 'MEASURED' else 'INSPECTED' end)
  returning id into v_evidence;
  if v_class <> 'normal' then
    insert into public.process_events
      (organization_id,asset_id,event_type,severity,tag,description,occurred_at,source_system,external_id)
    values(v_org,v_asset,'excursion',case when v_class='critical' then 'critical' else 'medium' end,
      v_check,v_description,coalesce(nullif(p_record->>'observed_at','')::timestamptz,now()),'operator_round',
      concat('operator-round:',v_execution,':',v_check)) returning id into v_event;
  end if;
  insert into public.operator_round_observations
    (organization_id,execution_id,check_key,classification,reading_numeric,reading_text,unit,note,
     evidence_id,process_event_id,observed_by,observed_at)
  values(v_org,v_execution,v_check,v_class,nullif(p_record->>'reading_numeric','')::numeric,
    nullif(btrim(p_record->>'reading_text'),''),nullif(btrim(p_record->>'unit'),''),nullif(btrim(p_record->>'note'),''),
    v_evidence,v_event,v_uid,coalesce(nullif(p_record->>'observed_at','')::timestamptz,now())) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operator_round_observation',v_uid::text,
    jsonb_build_object('id',v_id,'executionId',v_execution,'checkKey',v_check,'classification',v_class,
      'evidenceId',v_evidence,'processEventId',v_event,'action','recorded'));
  return jsonb_build_object('id',v_id,'status','recorded','evidenceId',v_evidence,'processEventId',v_event);
end $$;

create or replace function public.complete_operator_round(p_execution_id bigint,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_uid uuid; v_checks jsonb; v_missing text[]; v_has_deviation boolean; v_status text;
begin
  v_uid:=public.assert_operator_round_actor('complete an operator round');
  select d.checks into v_checks from public.operator_round_executions e
    join public.operator_round_definitions d on d.id=e.definition_id
   where e.id=p_execution_id and e.organization_id=v_org and d.organization_id=v_org and e.status='in_progress' for update of e;
  if not found then raise exception 'in-progress operator round not found in this organization'; end if;
  select array_agg(c->>'label') into v_missing from jsonb_array_elements(v_checks) c
   where (c->>'required')::boolean and not exists(
     select 1 from public.operator_round_observations o
      where o.organization_id=v_org and o.execution_id=p_execution_id and o.check_key=c->>'key');
  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception 'required checks are missing: %',array_to_string(v_missing,', ');
  end if;
  select exists(select 1 from public.operator_round_observations
    where organization_id=v_org and execution_id=p_execution_id and classification<>'normal') into v_has_deviation;
  v_status:=case when v_has_deviation then 'completed_with_deviation' else 'completed' end;
  update public.operator_round_executions set status=v_status,completed_by=v_uid,completed_at=now(),
    completion_note=nullif(btrim(p_note),'') where id=p_execution_id and organization_id=v_org;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operator_round_execution',v_uid::text,
    jsonb_build_object('id',p_execution_id,'action','completed','status',v_status,'note',nullif(btrim(p_note),'')));
  return jsonb_build_object('id',p_execution_id,'status',v_status);
end $$;

revoke all on function public.assert_operator_round_actor(text,boolean) from public,anon;
revoke all on function public.define_operator_round(jsonb) from public,anon;
revoke all on function public.start_operator_round(bigint) from public,anon;
revoke all on function public.record_operator_round_observation(jsonb) from public,anon;
revoke all on function public.complete_operator_round(bigint,text) from public,anon;
grant execute on function public.define_operator_round(jsonb) to authenticated;
grant execute on function public.start_operator_round(bigint) to authenticated;
grant execute on function public.record_operator_round_observation(jsonb) to authenticated;
grant execute on function public.complete_operator_round(bigint,text) to authenticated;

notify pgrst,'reload schema';
