-- D11.01 / D12.03 / D12.19 — HOP system conditions, never surveillance.
-- Extends the one canonical human_performance_events store. The observed
-- condition has no subject-person field; the audit trail records only that an
-- authorized human performed the recording act.

alter table public.human_performance_events
  add column if not exists development_case_id uuid
    references public.development_cases(id) on delete set null,
  add column if not exists condition_categories text[] not null default '{}',
  add column if not exists observation_basis text,
  add column if not exists evidence_refs jsonb not null default '[]'::jsonb;

alter table public.human_performance_events
  drop constraint if exists human_performance_events_condition_categories_check,
  add constraint human_performance_events_condition_categories_check check (
    cardinality(condition_categories) between 1 and 9
    and condition_categories <@ array[
      'task_complexity','conflicting_procedures','excessive_handoffs',
      'decision_delays','workarounds','repeat_deviations','overloaded_roles',
      'unclear_authority','error_provoking_conditions']::text[]) not valid,
  drop constraint if exists human_performance_events_basis_check,
  add constraint human_performance_events_basis_check check (
    length(btrim(observation_basis)) >= 20) not valid,
  drop constraint if exists human_performance_events_evidence_refs_check,
  add constraint human_performance_events_evidence_refs_check check (
    jsonb_typeof(evidence_refs)='array');

create index if not exists idx_hpe_case
  on public.human_performance_events(organization_id,development_case_id,occurred_at desc)
  where development_case_id is not null;

create or replace function public.record_hop_system_condition(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text; v_id bigint;
  v_case uuid:=nullif(p_record->>'developmentCaseId','')::uuid;
  v_work uuid:=nullif(p_record->>'workOrderId','')::uuid;
  v_categories text[]; v_evidence jsonb:=coalesce(p_record->'evidenceRefs','[]'::jsonb);
  v_forbidden text;
begin
  if v_uid is null or v_org is null then raise exception 'authenticated organization member required'; end if;
  select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner','operator') then
    raise exception 'recording a HOP condition requires an authorized human operations, planning, engineering or governance role';
  end if;

  -- Negative control: neither this API nor its flexible JSON may acquire an
  -- individual-attribution field later without breaking the contract.
  select key into v_forbidden from jsonb_object_keys(p_record) key
   where lower(key) ~ '(person|member|worker|employee|operator|actor|owner|user|individual|name|email|recordedby|createdby)'
   limit 1;
  if v_forbidden is not null then
    raise exception 'HOP records system conditions, not people; individual-attribution field "%" is forbidden',v_forbidden;
  end if;

  select array_agg(distinct value order by value) into v_categories
    from jsonb_array_elements_text(coalesce(p_record->'conditionCategories','[]'::jsonb));
  if coalesce(cardinality(v_categories),0)=0 or not (v_categories <@ array[
      'task_complexity','conflicting_procedures','excessive_handoffs',
      'decision_delays','workarounds','repeat_deviations','overloaded_roles',
      'unclear_authority','error_provoking_conditions']::text[]) then
    raise exception 'select one or more of the nine supported system-condition categories';
  end if;
  if coalesce(p_record->>'errorType','') not in ('slip','lapse','rule_based_mistake','knowledge_based_mistake','routine_violation','situational_violation') then
    raise exception 'select a supported Reason/Rasmussen event classification';
  end if;
  if nullif(p_record->>'outcomeSeverity','') is not null and p_record->>'outcomeSeverity' not in ('near_miss','minor','moderate','serious') then
    raise exception 'select a supported outcome severity';
  end if;
  if length(btrim(coalesce(p_record->>'contributingConditions','')))<20
     or length(btrim(coalesce(p_record->>'observationBasis','')))<20 then
    raise exception 'system conditions and observation basis must each contain at least 20 characters';
  end if;
  if jsonb_typeof(v_evidence)<>'array' then raise exception 'evidenceRefs must be an array'; end if;
  if exists(select 1 from jsonb_array_elements(v_evidence) e
    where jsonb_typeof(e)<>'string' or length(btrim(e#>>'{}'))<3) then
    raise exception 'each evidence reference must be a non-empty string';
  end if;
  if v_case is not null and not exists(select 1 from development_cases where id=v_case and organization_id=v_org) then
    raise exception 'development case not found in this organization';
  end if;
  if v_work is not null and not exists(select 1 from work_orders where id=v_work and organization_id=v_org) then
    raise exception 'work order not found in this organization';
  end if;

  insert into human_performance_events(organization_id,development_case_id,work_order_id,occurred_at,
    error_type,outcome_severity,hours_on_shift,consecutive_days_worked,procedure_available,
    procedure_accurate,correct_tooling_available,first_time_performing_task,supervision_present,
    time_pressure,contributing_conditions,corrective_action,condition_categories,observation_basis,evidence_refs)
  values(v_org,v_case,v_work,coalesce(nullif(p_record->>'occurredAt','')::timestamptz,now()),
    p_record->>'errorType',nullif(p_record->>'outcomeSeverity',''),nullif(p_record->>'hoursOnShift','')::numeric,
    nullif(p_record->>'consecutiveDaysWorked','')::int,nullif(p_record->>'procedureAvailable','')::boolean,
    nullif(p_record->>'procedureAccurate','')::boolean,nullif(p_record->>'correctToolingAvailable','')::boolean,
    nullif(p_record->>'firstTimePerformingTask','')::boolean,nullif(p_record->>'supervisionPresent','')::boolean,
    nullif(p_record->>'timePressure',''),btrim(p_record->>'contributingConditions'),nullif(btrim(p_record->>'correctiveAction'),''),
    v_categories,btrim(p_record->>'observationBasis'),v_evidence)
  returning id into v_id;

  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'hop_system_condition',v_role,jsonb_build_object('action','system_condition_recorded','event_id',v_id,
    'category_count',cardinality(v_categories),'has_case',v_case is not null,'has_work_order',v_work is not null));
  return jsonb_build_object('id',v_id,'status','recorded_system_condition','advisory',true);
end $$;

create or replace function public.screen_hop_agent(p_lookback_days integer default 90,p_case_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org(); v_days int:=least(greatest(coalesce(p_lookback_days,90),1),3650);
  v_limit int:=least(greatest(coalesce(p_case_limit,100),1),250); v_count int; v_cases int; v_role text;
  v_resource jsonb:='[]'::jsonb; r record; b jsonb;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer','planner','operator') then
    return jsonb_build_object('error','forbidden','reason','HOP system-condition screening requires an authorized operations, planning, engineering or governance role.');
  end if;
  select count(*) into v_count from human_performance_events where organization_id=v_org and occurred_at>=now()-make_interval(days=>v_days);
  select count(*) into v_cases from development_cases where organization_id=v_org and status in ('active','on_hold','sanctioned');

  for r in select id,title from development_cases where organization_id=v_org and status in ('active','on_hold','sanctioned') order by created_at desc limit v_limit loop
    b:=get_case_resource_balance(r.id,12);
    if coalesce((b->>'answered')::boolean,false) and coalesce((b->>'overCommitted')::int,0)>0 then
      v_resource:=v_resource||jsonb_build_array(jsonb_build_object('caseId',r.id,'caseTitle',r.title,'overCommittedPools',(b->>'overCommitted')::int,'sourceRef','rpc:get_case_resource_balance'));
    end if;
  end loop;

  return jsonb_build_object(
    'organizationId',v_org,'asOf',now(),'lookbackDays',v_days,'eventCount',v_count,'eventLimit',500,'eventsTruncated',v_count>500,
    'unclassifiedEventCount',(select count(*) from human_performance_events where organization_id=v_org
      and occurred_at>=now()-make_interval(days=>v_days) and cardinality(condition_categories)=0),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'occurredAt',e.occurred_at,'caseId',e.development_case_id,
      'workOrderId',e.work_order_id,'errorType',e.error_type,'outcomeSeverity',e.outcome_severity,
      'categories',e.condition_categories,'conditions',e.contributing_conditions,'correctiveAction',e.corrective_action,
      'basis',e.observation_basis,'evidenceRefs',e.evidence_refs) order by e.occurred_at desc,e.id desc)
      from (select * from human_performance_events where organization_id=v_org and occurred_at>=now()-make_interval(days=>v_days)
        order by occurred_at desc,id desc limit 500) e),'[]'::jsonb),
    'decisionDelays',coalesce((select jsonb_agg(jsonb_build_object('decisionId',d.id,'caseId',d.development_case_id,'caseTitle',c.title,
      'requiredDate',d.decision_required_date,'sourceRef','decisions:'||d.id::text) order by d.decision_required_date,d.id)
      from decisions d join development_cases c on c.id=d.development_case_id and c.organization_id=v_org
      where d.organization_id=v_org and c.status in ('active','on_hold','sanctioned') and d.decision_required_date<current_date
        and d.selected_at is null and coalesce(d.approval_status,'pending')='pending' and (d.risk_id is null or can_read_risk(d.risk_id))),'[]'::jsonb),
    'unclearAuthority',coalesce((select jsonb_agg(jsonb_build_object('constraintId',x.id,'eventId',x.event_id,'eventCode',x.event_code,
      'description',x.description,'sourceRef','restoration_constraints:'||x.id::text) order by x.created_at)
      from (select c.id,c.event_id,e.event_code,c.description,c.created_at from restoration_constraints c join restoration_events e on e.id=c.event_id
        where c.organization_id=v_org and e.status not in ('closed','cancelled') and c.state in ('unknown','blocked') and nullif(btrim(c.owner_role),'') is null limit 200) x),'[]'::jsonb),
    'workarounds',coalesce((select jsonb_agg(jsonb_build_object('modificationId',t.id,'assetId',t.asset_id,'kind',t.modification_kind,
      'requiredRemovalBy',t.required_removal_by,'sourceRef','temporary_modifications:'||t.id::text) order by t.installed_at)
      from temporary_modifications t where t.organization_id=v_org and t.removed_at is null and t.modification_kind in ('jumper','bypass','defeat','software_override','alternative_part','other')),'[]'::jsonb),
    'repeatDeviations',coalesce((select jsonb_agg(jsonb_build_object('assetId',x.asset_id,'activeCount',x.n,'sourceRef','temporary_modifications:asset:'||x.asset_id::text))
      from (select asset_id,count(*)::int n from temporary_modifications where organization_id=v_org and removed_at is null
        and modification_kind in ('jumper','bypass','defeat','software_override','alternative_part','other') group by asset_id having count(*)>1) x),'[]'::jsonb),
    'overloadedRoles',v_resource,'caseCount',v_cases,'caseLimit',v_limit,'casesTruncated',v_cases>v_limit,
    'basis','Recorded human_performance_events plus canonical overdue decisions, unassigned recovery constraints, active temporary modifications and governed resource-balance states. No person-level data is read or returned.',
    'advisory',true);
end $$;

revoke all on function public.record_hop_system_condition(jsonb) from public,anon,service_role;
revoke all on function public.screen_hop_agent(integer,integer) from public,anon,service_role;
grant execute on function public.record_hop_system_condition(jsonb),public.screen_hop_agent(integer,integer) to authenticated;
comment on function public.screen_hop_agent(integer,integer) is 'D12.19 advisory HOP screen of system conditions only. It identifies no person, assigns no blame, scores no worker, and changes no governed record.';
notify pgrst,'reload schema';
