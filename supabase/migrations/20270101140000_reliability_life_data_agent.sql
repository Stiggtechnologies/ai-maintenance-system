-- ============================================================================
-- C1.03 / C7.01 — governed Reliability Engineer life-data execution.
--
-- Customer-recorded failures and scheduled removals enter the existing
-- component_life_events store.  The controlled calculation service reads the
-- complete same-tenant component population, runs the pinned TypeScript
-- estimator, and records one immutable advisory report plus retained agent-run
-- provenance.  Scheduled removals remain right-censored observations; they
-- are never relabelled as failures.  No report changes a PM interval, creates
-- work, accepts risk, approves a strategy, or authorizes expenditure.
-- ============================================================================

create or replace function public.sync_reliability_life_kernel_version()
returns text
language sql
immutable
set search_path=public
as $$ select 'reliability-life/1/2027-01-01'::text $$;

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'analyse_censored_life_data','Analyse censored life data',
  'Run the pinned life-data estimator over exact tenant component failures and right-censored scheduled removals without changing source or maintenance records.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'reliability_engineering','Reliability Engineer','strategic','active',
       'advisory','Waiting for a governed reliability analysis request',
       'Reliability Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='reliability_engineering'
);

update public.ai_agents
set name='Reliability Engineer',category='strategic',autonomy_mode='advisory',
    supervisor='Reliability Manager',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact tenant reliability evidence into reproducible engineering readings and explicit evidence gaps.',
      'modes',jsonb_build_array('life-data analysis','bad-actor review','failure analysis','strategy support'),
      'triggers',jsonb_build_array('new component life event','repeat failure','engineering review request'),
      'inputs',jsonb_build_array('component life events','operating-hour exposure','failure coding','work history','verified engineering evidence'),
      'outputs',jsonb_build_array('immutable advisory life-data report','method-selection basis','model warning','named evidence gaps'),
      'guardrails',jsonb_build_array(
        'Never count a scheduled working removal as a failure',
        'Never invent exposure, failure, suspension, mechanism or model fit',
        'Never change a PM interval or approve a maintenance strategy',
        'Never create or release work, accept risk, commit spend or return equipment to service',
        'Refuse a fitted distribution when the shape is not identifiable'),
      'routes',jsonb_build_array('/reliability','/reliability/intervals','/learning-loop'))
where key='reliability_engineering';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_reliability_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_reliability_charter_shape
      check (key <> 'reliability_engineering' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Upgrade only untouched platform baselines. Customer-authored controls and
-- any agent with customer control history but no active profile remain closed.
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
    where a.key='reliability_engineering'
  loop
    if r.old_profile is not null and r.old_basis <> v_basis then continue; end if;
    if r.old_profile is null and exists (
      select 1 from public.agent_control_profiles history
      where history.agent_id=r.agent_id
    ) then continue; end if;
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
       coalesce(r.required_human_approver_role,'reliability_engineer'),
       coalesce(r.proposal_risk_ceiling,'Critical'),
       coalesce(r.proposal_cost_ceiling_usd,0),
       coalesce(r.proposal_downtime_ceiling_hours,0),false,
       v_basis,'draft',v_version,null)
    returning id into v_profile;

    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d
    where d.right_key='recommend_inspection_review';

    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in
      ('analyse_reliability','read_work_context','draft_recommendation',
       'analyse_censored_life_data');

    update public.agent_control_profiles
    set status='adopted',adopted_at=now() where id=v_profile;
  end loop;
end
$$;

alter table public.component_life_events
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists source_basis text;

alter table public.agent_runs
  add column if not exists component_scope text;

create index if not exists idx_agent_runs_retained_component
  on public.agent_runs(organization_id,component_scope,created_at desc)
  where retained_for_governance and component_scope is not null;

-- Extend the retained-run invariant without weakening the planner or site
-- manager paths. Each writer receives one transaction-local marker only.
create or replace function public.enforce_retained_agent_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_planner_marker text := coalesce(current_setting('app.planner_agent_run_write',true),'');
  v_site_marker text := coalesce(current_setting('app.site_manager_agent_run_write',true),'');
  v_reliability_marker text := coalesce(current_setting('app.reliability_agent_run_write',true),'');
  v_allowed boolean := v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted';
begin
  if tg_op='DELETE' and old.retained_for_governance then return null; end if;
  if tg_op='UPDATE' and old.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are immutable; run the agent again for a new dated reading';
  end if;
  if tg_op='INSERT' and new.retained_for_governance and not v_allowed then
    raise exception 'retained agent runs are written only by a governed agent execution path';
  end if;
  if tg_op <> 'DELETE' and new.retained_for_governance then
    if new.requested_by is null
       or (new.work_order_id is null and new.site_id is null
           and nullif(btrim(new.component_scope),'') is null)
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key),'')=''
       or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component scope, control profile, tool and decision-right provenance';
    end if;
    if not exists (
      select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id
    ) then raise exception 'agent-run requester is not a member of this organization'; end if;
    if not exists (
      select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id
    ) then raise exception 'agent run crosses its organization boundary'; end if;
    if new.work_order_id is not null and not exists (
      select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id
    ) then raise exception 'agent run names work outside its organization'; end if;
    if new.site_id is not null and not exists (
      select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id
    ) then raise exception 'agent run names a site outside its organization'; end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists (
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))
    ) then raise exception 'agent run names a component population outside its organization'; end if;
    if new.job_plan_id is not null and not exists (
      select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id
    ) then raise exception 'agent run names a job plan outside its organization'; end if;
    if not exists (
      select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id
        and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted'
    ) then raise exception 'agent run does not carry the adopted control profile for this agent'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create table if not exists public.reliability_life_data_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  component text not null check (length(btrim(component)) between 2 and 160),
  kernel_version text not null,
  source_event_ids bigint[] not null check (cardinality(source_event_ids)>0),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='array'),
  method_selection jsonb not null check (jsonb_typeof(method_selection)='object'),
  limitations jsonb not null check (jsonb_typeof(limitations)='array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_reliability_life_reports_component
  on public.reliability_life_data_reports
    (organization_id,lower(component),created_at desc);

alter table public.reliability_life_data_reports enable row level security;
drop policy if exists reliability_life_reports_read
  on public.reliability_life_data_reports;
create policy reliability_life_reports_read
  on public.reliability_life_data_reports for select to authenticated
  using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.reliability_life_data_reports
  from public,anon,authenticated;
grant select on public.reliability_life_data_reports to authenticated;

create or replace function public.enforce_reliability_life_report()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    raise exception 'reliability life-data reports are retained calculation records';
  end if;
  if tg_op='UPDATE' then
    raise exception 'reliability life-data reports are immutable; run a new dated analysis';
  end if;
  if coalesce(current_setting('app.reliability_report_write',true),'') <> 'granted' then
    raise exception 'reliability life-data reports are written only by the controlled calculation service';
  end if;
  if not exists (
    select 1 from public.agent_runs r join public.ai_agents a on a.id=r.agent_id
    where r.id=new.agent_run_id and r.organization_id=new.organization_id
      and r.component_scope=new.component and r.retained_for_governance
      and a.key='reliability_engineering'
  ) then raise exception 'life-data report is missing its governed reliability-agent provenance'; end if;
  return new;
end
$$;

revoke all on function public.enforce_reliability_life_report()
  from public,anon,authenticated;
drop trigger if exists trg_reliability_life_report
  on public.reliability_life_data_reports;
create trigger trg_reliability_life_report
  before insert or update or delete on public.reliability_life_data_reports
  for each row execute function public.enforce_reliability_life_report();

create or replace function public.record_component_life_event(
  p_asset_id uuid,
  p_component text,
  p_hours_at_change_out numeric,
  p_event_kind text,
  p_event_date date,
  p_planned_interval_hours numeric default null,
  p_symptom text default null,
  p_work_order_ref text default null,
  p_source_file text default 'manual entry',
  p_source_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_asset public.assets%rowtype;
  v_id bigint;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','recording governed component life data requires a named reliability engineer or administrator');
  end if;
  select * into v_asset from public.assets
  where id=p_asset_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','asset not found'); end if;
  if coalesce(length(btrim(p_component)),0) not between 2 and 160 then
    return jsonb_build_object('error','component must contain 2–160 characters');
  end if;
  if p_hours_at_change_out is null or p_hours_at_change_out<=0 then
    return jsonb_build_object('error','operating hours at removal must be positive');
  end if;
  if p_event_kind not in ('failure','scheduled','other') then
    return jsonb_build_object('error','event kind must be failure, scheduled or other');
  end if;
  if p_event_date is null or p_event_date>current_date then
    return jsonb_build_object('error','event date is required and cannot be in the future');
  end if;
  if p_planned_interval_hours is not null and p_planned_interval_hours<=0 then
    return jsonb_build_object('error','planned interval must be positive when recorded');
  end if;
  if coalesce(length(btrim(p_source_file)),0)<2
     or coalesce(length(btrim(p_source_basis)),0)<10 then
    return jsonb_build_object('error','record a source reference and evidence basis of at least 10 characters');
  end if;

  insert into public.component_life_events
    (organization_id,asset_id,unit_number,component,functional_location,
     hours_at_change_out,planned_interval_hours,event_date,event_kind,symptom,
     work_order_ref,source_file,recorded_by,source_basis)
  values
    (v_org,v_asset.id,coalesce(nullif(v_asset.asset_tag,''),nullif(v_asset.tag,''),v_asset.id::text),
     btrim(p_component),null,p_hours_at_change_out,p_planned_interval_hours,
     p_event_date,p_event_kind,nullif(btrim(coalesce(p_symptom,'')),''),
     nullif(btrim(coalesce(p_work_order_ref,'')),''),btrim(p_source_file),
     auth.uid(),btrim(p_source_basis))
  returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'component_life_event',v_role,jsonb_build_object(
    'action','recorded','event_id',v_id,'asset_id',v_asset.id,
    'component',btrim(p_component),'event_kind',p_event_kind,
    'classification',case when p_event_kind='scheduled'
      then 'right_censored' when p_event_kind='failure' then 'failure'
      else 'excluded_from_fit' end,'recorded_by',auth.uid()));
  return jsonb_build_object('event_id',v_id,'component',btrim(p_component),
    'event_kind',p_event_kind,'classification',case when p_event_kind='scheduled'
      then 'right_censored' when p_event_kind='failure' then 'failure'
      else 'excluded_from_fit' end);
exception when unique_violation then
  return jsonb_build_object('error','this component life event is already recorded');
end
$$;

revoke all on function public.record_component_life_event(uuid,text,numeric,text,date,numeric,text,text,text,text)
  from public,anon;
grant execute on function public.record_component_life_event(uuid,text,numeric,text,date,numeric,text,text,text,text)
  to authenticated;

-- Customer-facing inventory uses the same case-insensitive population and
-- positive-exposure rules as the controlled calculation path.  The older
-- get_component_life_data RPC is retained for existing Development Case RAM
-- callers whose imported source labels are deliberately case-sensitive.
create or replace function public.get_reliability_life_data_groups()
returns table (
  component text,units bigint,"failureHours" numeric[],
  "censoredHours" numeric[],"otherHours" numeric[],
  "plannedIntervalHours" numeric,"censoredShare" numeric,basis text
)
language sql
stable
security definer
set search_path=public
as $$
  select min(e.component),count(distinct e.unit_number),
    array_agg(e.hours_at_change_out order by e.hours_at_change_out)
      filter(where e.event_kind='failure' and e.hours_at_change_out>0),
    array_agg(e.hours_at_change_out order by e.hours_at_change_out)
      filter(where e.event_kind='scheduled' and e.hours_at_change_out>0),
    array_agg(e.hours_at_change_out order by e.hours_at_change_out)
      filter(where e.event_kind='other' or e.hours_at_change_out<=0),
    max(e.planned_interval_hours),
    round(count(*) filter(where e.event_kind='scheduled' and e.hours_at_change_out>0)::numeric
      / nullif(count(*) filter(where e.event_kind in ('failure','scheduled')
        and e.hours_at_change_out>0),0),3),
    format('%s exact source event(s) on %s unit(s): %s failure(s), %s right-censored scheduled working removal(s), and %s event(s) excluded from the fit. The agent reads this complete case-insensitive component population.',
      count(*),count(distinct e.unit_number),
      count(*) filter(where e.event_kind='failure' and e.hours_at_change_out>0),
      count(*) filter(where e.event_kind='scheduled' and e.hours_at_change_out>0),
      count(*) filter(where e.event_kind='other' or e.hours_at_change_out<=0))
  from public.component_life_events e
  where e.organization_id=public.app_current_org()
  group by lower(e.component)
  order by count(*) desc;
$$;

revoke all on function public.get_reliability_life_data_groups()
  from public,anon;
grant execute on function public.get_reliability_life_data_groups()
  to authenticated;

-- The edge runtime reads one exact, complete component population through this
-- service-role-only boundary.  Keeping the case-insensitive match in SQL means
-- the calculation cannot accidentally omit rows whose source used different
-- capitalization.
create or replace function public.get_reliability_life_data_source(
  p_organization_id uuid,p_actor_id uuid,p_component text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_role text;
  v_component text:=btrim(coalesce(p_component,''));
  v_rows jsonb;
begin
  select role into v_role from public.user_profiles
  where id=p_actor_id and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','the controlled reliability calculation requires a named same-tenant reliability engineer or administrator');
  end if;
  if length(v_component) not between 2 and 160 then
    return jsonb_build_object('error','component must contain 2–160 characters');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'hoursAtChangeOut',e.hours_at_change_out,
    'eventKind',e.event_kind,'component',e.component)
    order by e.id),'[]'::jsonb)
  into v_rows
  from public.component_life_events e
  where e.organization_id=p_organization_id
    and lower(e.component)=lower(v_component);
  return jsonb_build_object('component',v_component,'events',v_rows,
    'kernelVersion',public.sync_reliability_life_kernel_version());
end
$$;

revoke all on function public.get_reliability_life_data_source(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.get_reliability_life_data_source(uuid,uuid,text)
  to service_role;

create or replace function public.record_reliability_life_data_run(
  p_organization_id uuid,
  p_actor_id uuid,
  p_component text,
  p_event_ids bigint[],
  p_kernel_version text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text;
  v_agent public.ai_agents%rowtype;
  v_control jsonb;
  v_expected_ids bigint[];
  v_distinct_claimed bigint[];
  v_snapshot jsonb;
  v_failures integer;
  v_distinct_failure_hours integer;
  v_suspensions integer;
  v_expected_suspended_fraction numeric;
  v_expected_method text;
  v_run uuid;
  v_report uuid;
  v_component text:=btrim(coalesce(p_component,''));
begin
  select role into v_role from public.user_profiles
  where id=p_actor_id and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','the controlled reliability calculation requires a named same-tenant reliability engineer or administrator');
  end if;
  if p_kernel_version<>public.sync_reliability_life_kernel_version() then
    return jsonb_build_object('error','the calculation kernel version is not the server-pinned version');
  end if;
  if jsonb_typeof(coalesce(p_result,'null'::jsonb))<>'object' then
    return jsonb_build_object('error','method selection result must be a JSON object');
  end if;
  if not (p_result ?& array['method','beta','eta','failures','suspensions',
      'suspendedFraction','modelWarning','ruleApplied','reason']) then
    return jsonb_build_object('error','method selection result is incomplete');
  end if;
  if jsonb_typeof(p_result->'method')<>'string'
     or jsonb_typeof(p_result->'failures')<>'number'
     or jsonb_typeof(p_result->'suspensions')<>'number'
     or jsonb_typeof(p_result->'suspendedFraction')<>'number'
     or jsonb_typeof(p_result->'ruleApplied')<>'string'
     or jsonb_typeof(p_result->'reason')<>'string'
     or jsonb_typeof(p_result->'modelWarning') not in ('string','null') then
    return jsonb_build_object('error','method selection result has an invalid field type');
  end if;
  if jsonb_typeof(p_result->'beta') not in ('number','null')
     or jsonb_typeof(p_result->'eta') not in ('number','null') then
    return jsonb_build_object('error','beta and eta must be numeric or null');
  end if;
  if length(btrim(p_result->>'ruleApplied'))<3
     or length(btrim(p_result->>'reason'))<20 then
    return jsonb_build_object('error','method selection must retain its applied rule and engineering reason');
  end if;

  select array_agg(e.id order by e.id),
         jsonb_agg(jsonb_build_object(
           'eventId',e.id,'assetId',e.asset_id,'unitNumber',e.unit_number,
           'component',e.component,'hoursAtChangeOut',e.hours_at_change_out,
           'plannedIntervalHours',e.planned_interval_hours,
           'eventDate',e.event_date,'eventKind',e.event_kind,
           'symptom',e.symptom,'workOrderRef',e.work_order_ref,
           'sourceFile',e.source_file,'sourceBasis',e.source_basis,
           'recordedBy',e.recorded_by,'importedAt',e.imported_at)
           order by e.id),
         count(*) filter(where e.event_kind='failure' and e.hours_at_change_out>0)::integer,
         count(distinct e.hours_at_change_out)
           filter(where e.event_kind='failure' and e.hours_at_change_out>0)::integer,
         count(*) filter(where e.event_kind='scheduled' and e.hours_at_change_out>0)::integer
  into v_expected_ids,v_snapshot,v_failures,v_distinct_failure_hours,v_suspensions
  from public.component_life_events e
  where e.organization_id=p_organization_id
    and lower(e.component)=lower(v_component);
  if coalesce(cardinality(v_expected_ids),0)=0 then
    return jsonb_build_object('error','no same-tenant life data exists for this component');
  end if;
  select array_agg(distinct x order by x) into v_distinct_claimed
  from unnest(coalesce(p_event_ids,'{}'::bigint[])) x;
  if v_expected_ids is distinct from v_distinct_claimed
     or cardinality(coalesce(p_event_ids,'{}'::bigint[]))<>cardinality(v_expected_ids) then
    return jsonb_build_object('error','source event set changed or does not match the complete same-tenant component population');
  end if;
  v_expected_method:=case when v_failures<2 or v_distinct_failure_hours<2 then 'none'
    when v_suspensions>0 then 'mle_censored'
    when v_failures<15 then 'rank_regression' else 'mle' end;
  v_expected_suspended_fraction:=case when v_failures+v_suspensions=0 then 0
    else v_suspensions::numeric/(v_failures+v_suspensions) end;
  if p_result->>'method'<>v_expected_method
     or (p_result->>'failures')::numeric<>v_failures
     or (p_result->>'suspensions')::numeric<>v_suspensions
     or abs((p_result->>'suspendedFraction')::numeric-v_expected_suspended_fraction)>0.0000001 then
    return jsonb_build_object('error','method selection or event counts do not match the server-owned source classification');
  end if;
  if v_expected_method='none' and
      ((p_result->'beta')<>'null'::jsonb or (p_result->'eta')<>'null'::jsonb) then
    return jsonb_build_object('error','an unidentified distribution cannot carry beta or eta');
  end if;
  if v_expected_method<>'none' and
      (coalesce((p_result->>'beta')::numeric,0)<=0
       or coalesce((p_result->>'eta')::numeric,0)<=0) then
    return jsonb_build_object('error','a fitted distribution requires positive beta and eta');
  end if;

  select * into v_agent from public.ai_agents
  where organization_id=p_organization_id and key='reliability_engineering'
  order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Reliability Engineer agent is configured'); end if;
  v_control:=public.evaluate_agent_control_internal(
    p_organization_id,v_agent.id,'recommend_inspection_review',
    'analyse_censored_life_data','High',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Reliability Engineer agent refused: '||(v_control->>'reason'));
  end if;

  perform set_config('app.reliability_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,status,summary,confidence,started_at,completed_at,
     requested_by,component_scope,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,result,retained_for_governance)
  values
    (p_organization_id,v_agent.id,'completed',
     'Computed one governed advisory life-data reading from the complete recorded component population.',
     case when v_expected_method='none' then 0 else 80 end,now(),now(),
     p_actor_id,v_component,(v_control->>'profile_id')::uuid,
     'analyse_censored_life_data','recommend_inspection_review',
     jsonb_build_object('component',v_component,'kernelVersion',p_kernel_version,
       'sourceEventIds',to_jsonb(v_expected_ids),'sourceSnapshot',v_snapshot,
       'classification',jsonb_build_object('failures',v_failures,
         'rightCensoredScheduledRemovals',v_suspensions,
         'excludedFromFit',jsonb_array_length(v_snapshot)-v_failures-v_suspensions)),
     jsonb_build_object('methodSelection',p_result,'advisory',true,
       'mayChangePmInterval',false,'mayCreateWork',false,
       'mayApproveStrategy',false,'mayAcceptRisk',false,
       'mayCommitSpend',false,'mayReturnToService',false),true)
  returning id into v_run;

  perform set_config('app.reliability_report_write','granted',true);
  insert into public.reliability_life_data_reports
    (organization_id,agent_run_id,component,kernel_version,source_event_ids,
     source_snapshot,method_selection,limitations,created_by)
  values
    (p_organization_id,v_run,v_component,p_kernel_version,v_expected_ids,
     v_snapshot,p_result,jsonb_build_array(
       'The fit describes only the recorded component population and source exposure.',
       'Scheduled working removals are right-censored; other removals are excluded from the fit.',
       'A model warning or insufficient-data refusal remains part of the retained report.',
       'This advisory reading cannot change intervals, approve strategy, create or release work, accept risk, commit spend or return equipment to service.'),
     p_actor_id)
  returning id into v_report;
  perform set_config('app.reliability_report_write','',true);
  perform set_config('app.reliability_agent_run_write','',true);

  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Life-data analysis for '||v_component,
    last_action='Generated a governed censored life-data report',
    recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=v_agent.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(p_organization_id,'reliability_life_data_report',v_role,
    jsonb_build_object('action','generated','report_id',v_report,
      'agent_run_id',v_run,'component',v_component,'requested_by',p_actor_id,
      'source_event_ids',to_jsonb(v_expected_ids),'kernel_version',p_kernel_version,
      'method',v_expected_method,'advisory',true));
  return jsonb_build_object('report_id',v_report,'run_id',v_run,
    'component',v_component,'kernel_version',p_kernel_version,
    'method_selection',p_result,'source_event_ids',to_jsonb(v_expected_ids),
    'advisory',true,'may_change_pm_interval',false,'may_create_work',false,
    'may_approve_strategy',false,'may_accept_risk',false,
    'may_commit_spend',false,'may_return_to_service',false);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error','method selection contains an invalid numeric value');
end
$$;

revoke all on function public.record_reliability_life_data_run(uuid,uuid,text,bigint[],text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_reliability_life_data_run(uuid,uuid,text,bigint[],text,jsonb)
  to service_role;

create or replace function public.get_reliability_life_data_reports(
  p_component text default null,p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(jsonb_agg(row_to_json(q) order by q."createdAt" desc),'[]'::jsonb)
  from (
    select r.id,r.component,r.kernel_version as "kernelVersion",
      r.source_event_ids as "sourceEventIds",r.source_snapshot as "sourceSnapshot",
      r.method_selection as "methodSelection",r.limitations,
      r.agent_run_id as "agentRunId",r.created_by as "createdBy",
      r.created_at as "createdAt"
    from public.reliability_life_data_reports r
    where r.organization_id=public.app_current_org()
      and (p_component is null or lower(r.component)=lower(btrim(p_component)))
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit,20),1),100)
  ) q;
$$;

revoke all on function public.get_reliability_life_data_reports(text,integer)
  from public,anon;
grant execute on function public.get_reliability_life_data_reports(text,integer)
  to authenticated;

comment on function public.record_component_life_event(uuid,text,numeric,text,date,numeric,text,text,text,text) is
  'C7.01 named-human life-data capture. Scheduled working removals are stored as right-censored observations, never failures.';
comment on table public.reliability_life_data_reports is
  'C1.03/C7.01 immutable governed Reliability Engineer readings from exact same-tenant component-life evidence. Advisory only.';

notify pgrst,'reload schema';
