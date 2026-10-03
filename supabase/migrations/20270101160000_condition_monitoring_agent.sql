-- ============================================================================
-- C1.06 — governed Condition Monitoring Analyst execution.
--
-- The agent reads the canonical sensor, condition-reading, alert, operating-
-- state and connector records. It creates an immutable signal-assessment pack
-- from exact source rows and makes missing context, poor quality and thin
-- history explicit. It may recommend a human review; it cannot diagnose a
-- failure, change limits, create/release work, defer maintenance, accept risk
-- or return equipment to service.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'interpret_condition_evidence','Interpret condition evidence',
  'Screen exact vibration, oil, thermography, motor-current and process-condition evidence with operating context, while refusing unsupported diagnosis or execution.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'condition_monitoring','Condition Monitoring Analyst','specialist',
       'active','advisory','Waiting for a governed signal review',
       'Reliability Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='condition_monitoring'
);

update public.ai_agents
set name='Condition Monitoring Analyst',category='specialist',
    autonomy_mode='advisory',supervisor='Reliability Manager',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact condition history and operating context into a retained signal assessment and named-human review hand-off.',
      'modes',jsonb_build_array('vibration','oil analysis','thermography','motor current','process anomaly'),
      'triggers',jsonb_build_array('human review request','warning crossing','alarm crossing','material signal trend','quality or context gap'),
      'inputs',jsonb_build_array('sensor configuration','condition readings','reading quality','condition alerts','exact-time operating state','plant-source posture'),
      'outputs',jsonb_build_array('immutable signal assessment','source snapshot','quality and context gaps','modality-specific evidence plan','named-human review hand-off'),
      'guardrails',jsonb_build_array(
        'Never convert a signal association into a failure diagnosis',
        'Never invent a baseline, alarm limit, duty state, source or missing reading',
        'Never change a limit, maintenance interval, work order, schedule or asset state',
        'Never approve strategy, accept risk, commit spend or return equipment to service',
        'Require named-human review for every operational decision'),
      'routes',jsonb_build_array('/reliability'))
where key='condition_monitoring';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_condition_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_condition_charter_shape
      check (key <> 'condition_monitoring' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Adopt the platform advisory baseline only when the tenant has not authored a
-- different control history. Customer controls are never silently replaced.
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
    where a.key='condition_monitoring'
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
      ('interpret_condition_evidence','read_work_context','draft_recommendation');

    update public.agent_control_profiles
    set status='adopted',adopted_at=now() where id=v_profile;
  end loop;
end
$$;

-- Asset scope is canonical for condition work. Extend the shared retained-run
-- guard without weakening the planner, site, reliability or FRACAS paths.
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
  v_fracas_marker text := coalesce(current_setting('app.fracas_agent_run_write',true),'');
  v_condition_marker text := coalesce(current_setting('app.condition_agent_run_write',true),'');
  v_allowed boolean := v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted';
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
           and nullif(btrim(new.component_scope),'') is null
           and new.asset_id is null)
       or new.agent_control_profile_id is null
       or coalesce(btrim(new.agent_tool_key),'')=''
       or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset scope, control profile, tool and decision-right provenance';
    end if;
    if not exists (select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists (select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.asset_id is not null and not exists (select 1 from public.assets a
      where a.id=new.asset_id and a.organization_id=new.organization_id) then
      raise exception 'agent run names an asset outside its organization';
    end if;
    if new.work_order_id is not null and not exists (select 1 from public.work_orders w
      where w.id=new.work_order_id and w.organization_id=new.organization_id) then
      raise exception 'agent run names work outside its organization';
    end if;
    if new.site_id is not null and not exists (select 1 from public.sites s
      where s.id=new.site_id and s.organization_id=new.organization_id) then
      raise exception 'agent run names a site outside its organization';
    end if;
    if nullif(btrim(new.component_scope),'') is not null and not exists (
      select 1 from public.component_life_events e
      where e.organization_id=new.organization_id
        and lower(e.component)=lower(btrim(new.component_scope))) then
      raise exception 'agent run names a component population outside its organization';
    end if;
    if new.job_plan_id is not null and not exists (select 1 from public.job_plans j
      where j.id=new.job_plan_id and j.organization_id=new.organization_id) then
      raise exception 'agent run names a job plan outside its organization';
    end if;
    if not exists (select 1 from public.agent_control_profiles p
      where p.id=new.agent_control_profile_id
        and p.organization_id=new.organization_id
        and p.agent_id=new.agent_id and p.status='adopted') then
      raise exception 'agent run does not carry the adopted control profile for this agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

create table if not exists public.condition_monitoring_agent_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sensor_id uuid not null references public.sensors(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  window_days integer not null check (window_days between 1 and 365),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  assessment jsonb not null check (jsonb_typeof(assessment)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_condition_agent_packs_sensor
  on public.condition_monitoring_agent_packs
  (organization_id,sensor_id,created_at desc);

create table if not exists public.condition_monitoring_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_id uuid not null references public.condition_monitoring_agent_packs(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);
create index if not exists idx_condition_review_assignments
  on public.condition_monitoring_review_assignments
  (organization_id,pack_id,assigned_at desc);

alter table public.condition_monitoring_agent_packs enable row level security;
alter table public.condition_monitoring_review_assignments enable row level security;
drop policy if exists condition_agent_packs_read on public.condition_monitoring_agent_packs;
create policy condition_agent_packs_read on public.condition_monitoring_agent_packs
  for select to authenticated using (organization_id=public.app_current_org());
drop policy if exists condition_review_assignments_read on public.condition_monitoring_review_assignments;
create policy condition_review_assignments_read on public.condition_monitoring_review_assignments
  for select to authenticated using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.condition_monitoring_agent_packs,
  public.condition_monitoring_review_assignments from public,anon,authenticated;
grant select on public.condition_monitoring_agent_packs,
  public.condition_monitoring_review_assignments to authenticated;

create or replace function public.protect_condition_agent_records()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_marker text:=coalesce(current_setting('app.condition_record_write',true),'');
begin
  if v_marker<>'granted' then
    raise exception 'condition-agent records are written only by the governed assessment workflow';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'condition assessments and review assignments are append-only';
  end if;
  return new;
end $$;
revoke all on function public.protect_condition_agent_records()
  from public,anon,authenticated;
create trigger trg_protect_condition_agent_packs before insert or update or delete
  on public.condition_monitoring_agent_packs for each row
  execute function public.protect_condition_agent_records();
create trigger trg_protect_condition_review_assignments before insert or update or delete
  on public.condition_monitoring_review_assignments for each row
  execute function public.protect_condition_agent_records();

create or replace function public.run_condition_monitoring_agent(
  p_sensor_id uuid,p_window_days int default 30,p_limit int default 120
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  s public.sensors%rowtype;
  a public.assets%rowtype;
  ag public.ai_agents%rowtype;
  v_control jsonb;
  v_window int:=least(greatest(coalesce(p_window_days,30),1),365);
  v_limit int:=least(greatest(coalesce(p_limit,120),3),250);
  v_modality text;
  v_connector_key text;
  v_readings jsonb:='[]'::jsonb;
  v_total int:=0;
  v_good int:=0;
  v_non_good int:=0;
  v_context int:=0;
  v_connector_backed int:=0;
  v_latest numeric;
  v_latest_at timestamptz;
  v_slope numeric;
  v_signal_state text;
  v_trend text;
  v_gaps jsonb:='[]'::jsonb;
  v_plan jsonb:='[]'::jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_run uuid;
  v_pack uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','running the Condition Monitoring Analyst requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into s from public.sensors
  where id=p_sensor_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','sensor not found'); end if;
  select * into a from public.assets
  where id=s.asset_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','sensor asset not found'); end if;
  select * into ag from public.ai_agents
  where organization_id=v_org and key='condition_monitoring'
  order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Condition Monitoring Analyst is configured in this organization'); end if;
  v_control:=public.evaluate_agent_control_internal(
    v_org,ag.id,'recommend_inspection_review','interpret_condition_evidence',
    case when lower(coalesce(a.criticality,''))='critical' then 'Critical'
         when lower(coalesce(a.criticality,''))='high' then 'High'
         when lower(coalesce(a.criticality,''))='medium' then 'Medium' else 'Low' end,
    null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Condition Monitoring Analyst refused: '||(v_control->>'reason'));
  end if;

  v_modality:=case
    when lower(concat_ws(' ',s.signal_type,s.detection_technique,s.name)) ~
      '(vibration|acceler|velocity|displacement|envelope)' then 'vibration'
    when lower(concat_ws(' ',s.signal_type,s.detection_technique,s.name)) ~
      '(oil|lubric|debris|viscos|ferrous|particle)' then 'oil_analysis'
    when lower(concat_ws(' ',s.signal_type,s.detection_technique,s.name)) ~
      '(thermal|thermograph|infrared|temperature|heat)' then 'thermography'
    when lower(concat_ws(' ',s.signal_type,s.detection_technique,s.name)) ~
      '(motor current|current signature|amper|electrical current)' then 'motor_current'
    else 'process_anomaly' end;

  select c.connector_key into v_connector_key
  from public.connectors c where c.organization_id=v_org
    and c.connector_type='plant_historian' and c.enabled
  order by c.last_success_at desc nulls last,c.created_at desc limit 1;

  with scoped as (
    select cr.*,os.id operating_state_id,os.state operating_state,
      os.load_pct,os.reason_code operating_reason,
      os.source_system operating_source
    from public.condition_readings cr
    left join lateral (
      select x.id,x.state,x.load_pct,x.reason_code,x.source_system
      from public.operating_states x
      where x.organization_id=v_org and x.asset_id=cr.asset_id
        and x.started_at<=cr.taken_at
        and (x.ended_at is null or x.ended_at>cr.taken_at)
      order by x.started_at desc limit 1
    ) os on true
    where cr.organization_id=v_org and cr.sensor_id=s.id
      and cr.taken_at>=now()-make_interval(days=>v_window)
    order by cr.taken_at desc,cr.id desc limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'value',value,'quality',quality,'takenAt',taken_at,
      'sourceSystem',source_system,
      'sourcePosture',case when v_connector_key is not null
        and source_system=v_connector_key then 'connector_backed'
        else 'seed_sim_or_import' end,
      'contextKnown',operating_state_id is not null,
      'operatingState',operating_state,'loadPct',load_pct,
      'operatingReason',operating_reason,'operatingSource',operating_source)
      order by taken_at desc,id desc),'[]'::jsonb),
    count(*)::int,
    count(*) filter(where quality='good')::int,
    count(*) filter(where quality<>'good')::int,
    count(*) filter(where operating_state_id is not null)::int,
    count(*) filter(where v_connector_key is not null and source_system=v_connector_key)::int,
    (array_agg(value order by taken_at desc,id desc) filter(where quality='good'))[1],
    (array_agg(taken_at order by taken_at desc,id desc) filter(where quality='good'))[1],
    (regr_slope(value::double precision,
      extract(epoch from taken_at)::double precision/3600.0)
      filter(where quality='good'))::numeric
  into v_readings,v_total,v_good,v_non_good,v_context,v_connector_backed,
       v_latest,v_latest_at,v_slope
  from scoped;

  v_signal_state:=case
    when v_good<2 then 'insufficient_evidence'
    when s.limit_direction='below' and s.alarm_limit is not null
      and v_latest<=s.alarm_limit then 'alarm_exceedance'
    when coalesce(s.limit_direction,'above')='above' and s.alarm_limit is not null
      and v_latest>=s.alarm_limit then 'alarm_exceedance'
    when s.limit_direction='below' and s.warning_limit is not null
      and v_latest<=s.warning_limit then 'warning_exceedance'
    when coalesce(s.limit_direction,'above')='above' and s.warning_limit is not null
      and v_latest>=s.warning_limit then 'warning_exceedance'
    else 'within_configured_limits' end;
  v_trend:=case
    when v_good<3 or v_slope is null then 'insufficient_evidence'
    when abs(v_slope)*24 < greatest(abs(v_latest)*0.05,0.0001) then 'no_material_24h_change'
    when v_slope>0 then 'rising' else 'falling' end;

  if v_total=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','no_history','severity','blocker','detail','No readings exist for this sensor in the selected window.'));
  elsif v_good<3 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','thin_good_history','severity','blocker','detail','Fewer than three good-quality readings are available; trend interpretation is withheld.'));
  end if;
  if s.warning_limit is null or s.alarm_limit is null then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
      'code','limits_not_configured','severity','attention','detail','A warning or alarm limit is missing; within-limit status cannot imply asset health.'));
  end if;
  if v_context<v_total then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','operating_context_unknown','severity','attention',
    'detail',format('%s of %s retained readings lack an exact-time operating-state interval.',v_total-v_context,v_total)));
  end if;
  if v_non_good>0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','reading_quality','severity','attention',
    'detail',format('%s retained reading(s) are suspect, bad or substituted and are excluded from trend calculation.',v_non_good)));
  end if;
  if v_connector_backed=0 then v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object(
    'code','source_posture','severity','disclosure',
    'detail','No retained reading matches an enabled plant-historian connector. Evidence is labelled seed, simulated or imported.'));
  end if;

  v_plan:=jsonb_build_array(
    jsonb_build_object('sequence',1,'question','Is the signal and sensor configuration trustworthy?','owner','condition monitoring specialist','completion','Verify sensor location, unit, technique, calibration, quality and configured limits.'),
    jsonb_build_object('sequence',2,'question','What operating duty existed at each observation?','owner','operations representative','completion','Resolve every unknown exact-time state and load before comparing observations.'),
    case v_modality
      when 'vibration' then jsonb_build_object('sequence',3,'question','Do waveform, spectrum, phase and speed-related components support a mechanical hypothesis?','owner','vibration analyst','completion','Attach governed waveform/spectrum evidence and machine speed/load; do not diagnose from overall level alone.')
      when 'oil_analysis' then jsonb_build_object('sequence',3,'question','Do laboratory trend, sampling practice, contamination controls and wear-debris morphology agree?','owner','lubrication analyst','completion','Confirm sample point, lubricant hours, make-up, lab method and repeat sample before a wear diagnosis.')
      when 'thermography' then jsonb_build_object('sequence',3,'question','Is the thermal delta repeatable under comparable load, emissivity and environment?','owner','thermography analyst','completion','Attach calibrated image, reference target, load and ambient conditions.')
      when 'motor_current' then jsonb_build_object('sequence',3,'question','Do current spectrum, voltage quality, load and motor design support an electrical or mechanical hypothesis?','owner','motor diagnostics analyst','completion','Attach phase currents, voltage, speed/load and spectral sidebands; overall current alone is not diagnostic.')
      else jsonb_build_object('sequence',3,'question','Is the process deviation real under a comparable operating regime and measurement chain?','owner','process and reliability engineer','completion','Verify instrument, control mode, set point, load, upstream/downstream variables and event timing.') end,
    jsonb_build_object('sequence',4,'question','What operational response, if any, is justified?','owner','accountable named human','completion','Review evidence, consequence and alternatives; separately approve any inspection, work or limit change.'));

  v_snapshot:=jsonb_build_object(
    'asOf',now(),'sensor',jsonb_build_object(
      'sensorId',s.id,'name',s.name,'signalType',s.signal_type,'unit',s.unit,
      'detectionTechnique',s.detection_technique,'warningLimit',s.warning_limit,
      'alarmLimit',s.alarm_limit,'limitDirection',s.limit_direction,
      'sourceSystem',s.source_system),
    'asset',jsonb_build_object('assetId',a.id,'assetTag',coalesce(a.asset_tag,a.tag),
      'name',a.name,'assetClass',a.asset_class,'criticality',a.criticality),
    'windowDays',v_window,'retainedReadingLimit',v_limit,'readings',v_readings,
    'plantConnectorKey',v_connector_key,
    'sourceTables',jsonb_build_array('sensors','condition_readings','condition_alerts','operating_states','connectors'));

  perform set_config('app.condition_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,asset_id,status,summary,confidence,started_at,
     requested_by,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,retained_for_governance)
  values
    (v_org,ag.id,a.id,'running','Condition Monitoring Analyst is screening exact tenant evidence.',
     greatest(25,least(85,45+least(v_good,20)+(case when v_context=v_total then 10 else 0 end))),
     now(),auth.uid(),(v_control->>'profile_id')::uuid,
     'interpret_condition_evidence','recommend_inspection_review',v_snapshot,true)
  returning id into v_run;

  v_result:=jsonb_build_object(
    'runId',v_run,'agentId',ag.id,'agentKey',ag.key,
    'sensorId',s.id,'assetId',a.id,'modality',v_modality,
    'signalState',v_signal_state,'trend',v_trend,
    'latest',case when v_latest is null then null else jsonb_build_object(
      'value',v_latest,'unit',s.unit,'takenAt',v_latest_at) end,
    'slopePerHour',case when v_good>=3 then v_slope else null end,
    'population',jsonb_build_object('retained',v_total,'good',v_good,
      'nonGood',v_non_good,'contextKnown',v_context,
      'connectorBacked',v_connector_backed),
    'evidenceGaps',v_gaps,'evidencePlan',v_plan,
    'interpretation',case
      when v_good<2 then 'No signal interpretation is supported by the available good-quality history.'
      when v_signal_state='alarm_exceedance' then 'The latest good-quality reading crosses the configured alarm limit. This is a signal state, not a failure diagnosis.'
      when v_signal_state='warning_exceedance' then 'The latest good-quality reading crosses the configured warning limit. This is a signal state, not a failure diagnosis.'
      else 'The latest good-quality reading is within configured limits. This does not establish asset health or exclude an unmeasured failure mode.' end,
    'limitations',jsonb_build_array(
      'The assessment does not diagnose a failure mode.',
      'Trend and limit state do not prove condition, causation or remaining life.',
      'The agent did not change limits, create work, defer maintenance, approve strategy, accept risk or return equipment to service.'),
    'humanReviewRequired',true,'mayDiagnoseFailure',false,
    'mayChangeLimits',false,'mayCreateOrReleaseWork',false,
    'mayChangeMaintenanceInterval',false,'mayAcceptRisk',false,
    'mayReturnToService',false);

  perform set_config('app.condition_record_write','granted',true);
  insert into public.condition_monitoring_agent_packs
    (organization_id,sensor_id,asset_id,agent_run_id,window_days,
     source_snapshot,assessment,created_by)
  values(v_org,s.id,a.id,v_run,v_window,v_snapshot,v_result,auth.uid())
  returning id into v_pack;
  v_result:=v_result||jsonb_build_object('packId',v_pack);
  update public.agent_runs set status='completed',completed_at=now(),result=v_result,
    summary=format('Created an immutable %s assessment from %s retained reading(s), with %s evidence gap(s).',v_modality,v_total,jsonb_array_length(v_gaps))
  where id=v_run;
  perform set_config('app.condition_record_write','',true);
  perform set_config('app.condition_agent_run_write','',true);

  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Assessed '||coalesce(a.asset_tag,a.tag,a.name)||' / '||s.name,
    last_action='Created a governed condition-evidence assessment',
    recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=ag.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'condition_monitoring_agent_run',v_role,jsonb_build_object(
    'action','signal_assessment_created','sensor_id',s.id,'asset_id',a.id,
    'pack_id',v_pack,'agent_run_id',v_run,'requested_by',auth.uid(),
    'control_profile_id',v_control->>'profile_id','failure_diagnosed',false,
    'operational_action_taken',false));
  return v_result;
end
$$;
revoke all on function public.run_condition_monitoring_agent(uuid,int,int)
  from public,anon;
grant execute on function public.run_condition_monitoring_agent(uuid,int,int)
  to authenticated;

create or replace function public.assign_condition_monitoring_review(
  p_pack_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_assignment uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','assigning condition review requires a named reliability engineer, maintenance manager or administrator');
  end if;
  if not exists(select 1 from public.condition_monitoring_agent_packs
    where id=p_pack_id and organization_id=v_org) then
    return jsonb_build_object('error','condition assessment pack not found');
  end if;
  if not exists(select 1 from public.user_profiles
    where id=p_assigned_to and organization_id=v_org) then
    return jsonb_build_object('error','review owner must be a named member of this organization');
  end if;
  if p_due_date is null or p_due_date<current_date then
    return jsonb_build_object('error','review due date cannot be in the past');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','assignment note must contain at least 10 characters');
  end if;
  perform set_config('app.condition_record_write','granted',true);
  insert into public.condition_monitoring_review_assignments
    (organization_id,pack_id,assigned_to,due_date,assignment_note,assigned_by)
  values(v_org,p_pack_id,p_assigned_to,p_due_date,btrim(p_note),auth.uid())
  returning id into v_assignment;
  perform set_config('app.condition_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'condition_monitoring_review',v_role,jsonb_build_object(
    'action','review_assigned','pack_id',p_pack_id,'assignment_id',v_assignment,
    'assigned_to',p_assigned_to,'due_date',p_due_date,'assigned_by',auth.uid()));
  return jsonb_build_object('assignmentId',v_assignment,'packId',p_pack_id,
    'assignedTo',p_assigned_to,'dueDate',p_due_date,
    'note','Named-human review assigned. No operational action was taken.');
end
$$;
revoke all on function public.assign_condition_monitoring_review(uuid,uuid,date,text)
  from public,anon;
grant execute on function public.assign_condition_monitoring_review(uuid,uuid,date,text)
  to authenticated;

create or replace function public.get_condition_monitoring_agent_workspace(
  p_limit int default 50
)
returns jsonb language sql stable security definer set search_path=public as $$
  with caller as (select public.app_current_org() organization_id),
  sensor_rows as (
    select s.id,s.name,s.signal_type,s.unit,s.detection_technique,
      s.warning_limit,s.alarm_limit,s.limit_direction,
      coalesce(a.asset_tag,a.tag,a.name) asset_tag,
      (select max(cr.taken_at) from public.condition_readings cr
       where cr.organization_id=s.organization_id and cr.sensor_id=s.id) latest_at,
      (select count(*) from public.condition_readings cr
       where cr.organization_id=s.organization_id and cr.sensor_id=s.id) reading_count
    from public.sensors s join caller c on c.organization_id=s.organization_id
    join public.assets a on a.id=s.asset_id and a.organization_id=s.organization_id
    order by latest_at desc nulls last,s.name
    limit least(greatest(coalesce(p_limit,50),1),100)
  ), pack_rows as (
    select p.*,s.name sensor_name,s.signal_type,s.unit,
      coalesce(a.asset_tag,a.tag,a.name) asset_tag,
      latest.id assignment_id,latest.assigned_to,latest.due_date,
      latest.assignment_note,up.full_name owner_name
    from public.condition_monitoring_agent_packs p
    join caller c on c.organization_id=p.organization_id
    join public.sensors s on s.id=p.sensor_id and s.organization_id=p.organization_id
    join public.assets a on a.id=p.asset_id and a.organization_id=p.organization_id
    left join lateral (
      select x.* from public.condition_monitoring_review_assignments x
      where x.pack_id=p.id and x.organization_id=p.organization_id
      order by x.assigned_at desc,x.id desc limit 1
    ) latest on true
    left join public.user_profiles up on up.id=latest.assigned_to
      and up.organization_id=p.organization_id
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit,50),1),100)
  )
  select case when (select organization_id from caller) is null
    then jsonb_build_object('error','forbidden') else jsonb_build_object(
    'sensors',coalesce((select jsonb_agg(jsonb_build_object(
      'sensorId',id,'name',name,'signalType',signal_type,'unit',unit,
      'detectionTechnique',detection_technique,'warningLimit',warning_limit,
      'alarmLimit',alarm_limit,'limitDirection',limit_direction,
      'assetTag',asset_tag,'latestAt',latest_at,'readingCount',reading_count)
      order by latest_at desc nulls last,name) from sensor_rows),'[]'::jsonb),
    'packs',coalesce((select jsonb_agg(jsonb_build_object(
      'packId',id,'sensorId',sensor_id,'sensorName',sensor_name,
      'signalType',signal_type,'unit',unit,'assetTag',asset_tag,
      'agentRunId',agent_run_id,'windowDays',window_days,
      'assessment',assessment,'createdAt',created_at,
      'assignment',case when assignment_id is null then null else jsonb_build_object(
        'assignmentId',assignment_id,'assignedTo',assigned_to,
        'ownerName',coalesce(owner_name,assigned_to::text),
        'dueDate',due_date,'note',assignment_note) end)
      order by created_at desc) from pack_rows),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'id',up.id,'name',coalesce(up.full_name,up.id::text),'role',up.role)
      order by coalesce(up.full_name,up.id::text)) from public.user_profiles up
      join caller c on c.organization_id=up.organization_id),'[]'::jsonb),
    'basis','Each execution freezes the selected sensor configuration, retained readings, source posture and exact-time operating context. Signal states are advisory evidence; a named human owns every operational decision.') end;
$$;
revoke all on function public.get_condition_monitoring_agent_workspace(int)
  from public,anon;
grant execute on function public.get_condition_monitoring_agent_workspace(int)
  to authenticated;

comment on function public.run_condition_monitoring_agent(uuid,int,int) is
  'C1.06: creates an immutable advisory condition-evidence pack for vibration, oil, thermography, motor-current or process signals, with exact source rows, quality/context gaps, agent-control provenance and no diagnosis or execution authority.';

notify pgrst,'reload schema';
