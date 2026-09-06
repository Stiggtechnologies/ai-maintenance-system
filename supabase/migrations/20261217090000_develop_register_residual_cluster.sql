-- ============================================================================
-- Sync Develop residual cluster (2026-09-06)
--
-- Honest closes for three rows the last slices left 🟡/❌ after their
-- substrates landed:
--
--   D3.29  Assumption estimate + schedule legs. Slice 4 shipped
--          project_cost_items (uuid) and shutdown_tasks (bigint). The ONE
--          assumption family (risk_assumptions + risk_assumption_dependencies,
--          ruling 5) already carries Decision/Risk/Scenario/Control/Objective/
--          WorkOrder on the uuid dependency table and Business Case as a
--          typed bigint column. Estimate joins that uuid table. Schedule
--          cannot: shutdown_tasks.id is bigserial, and the uuid dependency
--          table cannot carry bigint keys honestly (the business_case_id
--          precedent). So schedule is a typed column on the same row.
--          No fourth assumption store.
--
--   D4.01  QualityRequirement binding to the ONE project requirement table.
--          Slice 7D shipped quality_requirements as a parallel store with no
--          FK. Overlap-map ruling: design_requirements is the §10 table.
--          Binding (not rewriting) is the remaining obligation — a nullable
--          FK plus a write path that REFUSES an unbound create, so a new
--          quality requirement cannot exist that the §10 trace never sees.
--          Pre-existing rows stay visible as unboundQualityRequirements.
--
--   D4.14  Cyber as a first-class gate-blocking category. Case gates and
--          mandatory-block machinery already exist; the register's "no case
--          gates yet" sentence is stale. This migration does not invent a
--          "every design gate must have a cyber criterion" rule (that would
--          refuse every Slice 1–3 transcript). It publishes the category
--          vocabulary the authoring surface offers, including cyber, so a
--          customer-stated mandatory cyber criterion blocks exactly as
--          business/technical/risk already do.
--
-- D3.19 and D11.32 flip in the register without schema: both halves of the
-- waiver model are already reachable, and the first Develop connector
-- (procurement_status, Slice 6B) already ships under analyze-not-author.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D3.29 — estimate (uuid dep) + schedule (typed bigint column)
-- ---------------------------------------------------------------------------
alter table public.risk_assumptions
  add column if not exists schedule_activity_id bigint
    references public.shutdown_tasks(id) on delete set null;

comment on column public.risk_assumptions.schedule_activity_id is
  'D3.29 schedule leg. Typed bigint because shutdown_tasks.id is bigserial and risk_assumption_dependencies.subject_id is uuid — the business_case_id precedent. Null means this assumption does not name a schedule activity.';

create index if not exists idx_risk_assumption_schedule
  on public.risk_assumptions(schedule_activity_id)
  where schedule_activity_id is not null;

do $dep$
begin
  -- Column-level CHECK from 20260921110102 is named
  -- {table}_{column}_check. Drop that exact name; do not add a second
  -- check beside a surviving one (the old list would still refuse estimate).
  alter table public.risk_assumption_dependencies
    drop constraint risk_assumption_dependencies_subject_type_check;
exception when undefined_object then
  raise exception
    'expected risk_assumption_dependencies_subject_type_check (the 20260921110102 column-level check). Refusing to add a second subject_type check beside an unnamed survivor.';
end
$dep$;
alter table public.risk_assumption_dependencies
  add constraint risk_assumption_dependencies_subject_type_check
  check (subject_type in
    ('risk','decision','scenario','control','objective','work_order','estimate'));

create or replace function public.record_case_assumption(
  p_case_id uuid,
  p_assumption jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_owner uuid := nullif(p_assumption->>'owner_id','')::uuid;
  v_bc bigint := nullif(p_assumption->>'business_case_id','')::bigint;
  v_schedule bigint := nullif(p_assumption->>'schedule_activity_id','')::bigint;
  v_param text := nullif(btrim(coalesce(p_assumption->>'threshold_parameter','')),'');
  v_comparator text := nullif(btrim(coalesce(p_assumption->>'threshold_comparator','')),'');
  v_threshold numeric := nullif(p_assumption->>'threshold_value','')::numeric;
  v_unit text := nullif(btrim(coalesce(p_assumption->>'threshold_unit','')),'');
  v_id uuid;
  v_indicator uuid;
  v_dependency_exists boolean;
  dep jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','recording a case assumption requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error','assumptions are not recordable on a '||c.status||' case');
  end if;
  if v_owner is null or not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then
    return jsonb_build_object('error','assumption owner not found in this organization');
  end if;
  if coalesce(length(btrim(p_assumption->>'statement')),0)<10 or
     coalesce(length(btrim(p_assumption->>'trigger_for_review')),0)<10 then
    return jsonb_build_object('error','assumption and measurable review trigger are required');
  end if;
  if v_bc is not null and not exists(
    select 1 from business_cases where id=v_bc and organization_id=v_org) then
    return jsonb_build_object('error','business case not found in this organization');
  end if;
  -- Schedule leg: the activity must belong to THIS case. A foreign or
  -- unscoped shutdown task would let an assumption name someone else's
  -- critical path.
  if v_schedule is not null and not exists(
    select 1
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
     where t.id = v_schedule
       and e.organization_id = v_org
       and e.development_case_id = c.id
  ) then
    return jsonb_build_object('error',
      'schedule activity not found on this development case — the schedule leg names a shutdown_tasks row of this case, not a number');
  end if;
  if v_param is not null or v_comparator is not null or v_threshold is not null then
    if v_param is null or v_comparator is null or v_threshold is null then
      return jsonb_build_object('error',
        'a viability threshold is complete or absent: threshold_parameter, threshold_comparator and threshold_value together');
    end if;
    if v_comparator not in ('>=','<=','>','<') then
      return jsonb_build_object('error','threshold_comparator must be one of >=, <=, >, <');
    end if;
    if not exists (select 1 from financial_assumptions
                   where organization_id=v_org and assumption_key=v_param) then
      return jsonb_build_object('error',
        format('no financial assumption series named "%s" is recorded in this organization — record the numeric series first (upsert_financial_assumption); a threshold on a series nobody records is an alarm wired to nothing', v_param));
    end if;
  end if;
  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    if dep->>'subject_type' not in ('risk','decision','scenario','control','objective','work_order','estimate') or
       nullif(dep->>'subject_id','') is null then
      return jsonb_build_object('error','invalid assumption dependency');
    end if;
    begin
      v_dependency_exists:=false;
      if dep->>'subject_type'='risk' then
        select exists(select 1 from risks where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='decision' then
        select exists(select 1 from decisions where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='scenario' then
        select exists(select 1 from scenarios where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='control' then
        select exists(select 1 from risk_controls where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='objective' then
        select exists(select 1 from risk_objectives where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='work_order' then
        select exists(select 1 from work_orders where id=(dep->>'subject_id')::uuid and organization_id=v_org) into v_dependency_exists;
      elsif dep->>'subject_type'='estimate' then
        -- Estimate is a cost line of THIS case. A uuid that exists in another
        -- tenant or on another case is not an estimate-leg of this assumption.
        select exists(
          select 1 from project_cost_items ci
           where ci.id=(dep->>'subject_id')::uuid
             and ci.organization_id=v_org
             and ci.development_case_id=c.id
        ) into v_dependency_exists;
      end if;
      if not v_dependency_exists then
        return jsonb_build_object('error','assumption dependency not found in this organization');
      end if;
    exception when invalid_text_representation then
      return jsonb_build_object('error','invalid assumption dependency identifier');
    end;
  end loop;

  insert into risk_assumptions(organization_id,risk_id,development_case_id,business_case_id,
    schedule_activity_id,
    statement,owner_id,confidence,valid_from,valid_until,trigger_for_review,
    threshold_parameter,threshold_comparator,threshold_value,threshold_unit)
  values(v_org,null,c.id,v_bc,v_schedule,
    btrim(p_assumption->>'statement'),v_owner,
    coalesce((p_assumption->>'confidence')::numeric,0),
    coalesce(nullif(p_assumption->>'valid_from','')::date,current_date),
    nullif(p_assumption->>'valid_until','')::date,btrim(p_assumption->>'trigger_for_review'),
    v_param,v_comparator,v_threshold,v_unit)
  returning id into v_id;

  for dep in select value from jsonb_array_elements(coalesce(p_assumption->'dependencies','[]'::jsonb)) loop
    insert into risk_assumption_dependencies(organization_id,assumption_id,subject_type,subject_id)
    values(v_org,v_id,dep->>'subject_type',(dep->>'subject_id')::uuid) on conflict do nothing;
  end loop;

  if v_param is not null then
    insert into risk_indicators(organization_id,risk_id,assumption_id,name,source_system,
      signal_key,unit,direction,thresholds,current_state,active)
    values(v_org,null,v_id,
      'Viability threshold: '||btrim(p_assumption->>'statement'),
      'financial_assumptions',v_param,v_unit,
      case when v_comparator in ('>=','>') then 'lower_is_worse' else 'higher_is_worse' end,
      jsonb_build_object('critical', v_threshold),
      'unknown',true)
    returning id into v_indicator;
  end if;

  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'case_assumption',coalesce(v_role,'unknown'),jsonb_build_object(
    'case_id',c.id,'assumption_id',v_id,'business_case_id',v_bc,
    'schedule_activity_id',v_schedule,
    'threshold', case when v_param is null then null else
      jsonb_build_object('parameter',v_param,'comparator',v_comparator,'value',v_threshold,'unit',v_unit) end,
    'indicator_id',v_indicator));

  return jsonb_build_object('assumption_id',v_id,'status','active',
    'indicator_id',v_indicator,
    'schedule_activity_id', v_schedule,
    'monitored', v_param is not null);
end;
$$;

revoke all on function public.record_case_assumption(uuid, jsonb) from public, anon;
grant execute on function public.record_case_assumption(uuid, jsonb) to authenticated, service_role;

-- Read path for the new legs. INVOKER so RLS is the boundary — no second
-- tenancy surface. The workspace aggregate is not re-issued (v5 is the
-- last definition and re-issuing it silently drops later insertions).
create or replace function public.get_case_assumption_links(p_case_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  return jsonb_build_object(
    'caseId', c.id,
    'assumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assumptionId', a.id,
        'statement', a.statement,
        'status', a.status,
        'businessCaseId', a.business_case_id,
        'scheduleActivityId', a.schedule_activity_id,
        'scheduleActivityLabel', (
          select t.label from shutdown_tasks t where t.id = a.schedule_activity_id),
        'dependencies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'subjectType', d.subject_type,
            'subjectId', d.subject_id,
            'estimateRef', case when d.subject_type = 'estimate' then (
              select ci.cost_item_ref from project_cost_items ci where ci.id = d.subject_id)
              else null end)
            order by d.subject_type, d.subject_id)
          from risk_assumption_dependencies d
          where d.assumption_id = a.id and d.organization_id = v_org
        ), '[]'::jsonb))
        order by a.created_at desc)
      from risk_assumptions a
      where a.development_case_id = c.id and a.organization_id = v_org
    ), '[]'::jsonb),
    'estimateSubjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ci.id, 'costItemRef', ci.cost_item_ref, 'description', ci.description)
        order by ci.cost_item_ref)
      from project_cost_items ci
      where ci.development_case_id = c.id and ci.organization_id = v_org
    ), '[]'::jsonb),
    'scheduleSubjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'taskKey', t.task_key, 'label', t.label, 'eventTitle', e.title)
        order by e.title, t.task_key)
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
      where e.development_case_id = c.id and e.organization_id = v_org
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.get_case_assumption_links(uuid) from public, anon;
grant execute on function public.get_case_assumption_links(uuid) to authenticated;

-- Invalidation: estimate/schedule have no reassessment_required column.
-- The assumption status flip IS the reopen; the audit names the legs so a
-- later reader can see what was being assumed. Inventing a second reopen
-- flag on cost lines or P6 activities would be a parallel workflow.
create or replace function public.apply_assumption_invalidation(
  p_assumption_id uuid,
  p_reason text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a risk_assumptions%rowtype;
  dep record; linked record; v_dep_risk uuid;
  v_collapse jsonb;
begin
  select * into a from risk_assumptions where id = p_assumption_id and status = 'active';
  if not found then
    return jsonb_build_object('error','active assumption not found');
  end if;
  update risk_assumptions set status='invalidated',invalidated_by=auth.uid(),invalidated_at=now(),
    invalidation_reason=btrim(p_reason) where id=a.id;
  for dep in select * from risk_assumption_dependencies where assumption_id=a.id loop
    if dep.subject_type='risk' then perform mark_risk_reassessment(dep.subject_id,'Assumption invalidated: '||a.statement); end if;
    if dep.subject_type='decision' then update decisions set reassessment_required=true,
      reassessment_reason='Assumption invalidated: '||a.statement
      where id=dep.subject_id and organization_id=a.organization_id; end if;
    if dep.subject_type='scenario' then
      select risk_id into v_dep_risk from scenarios where id=dep.subject_id and organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent scenario assumption invalidated: '||a.statement); end if;
    end if;
    if dep.subject_type='control' then
      for linked in select risk_id from risk_control_links where control_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent control assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='objective' then
      for linked in select id risk_id from risks where objective_id=dep.subject_id and organization_id=a.organization_id loop
        perform mark_risk_reassessment(linked.risk_id,'Dependent objective assumption invalidated: '||a.statement);
      end loop;
    end if;
    if dep.subject_type='work_order' then
      select coalesce(w.risk_id,rec.risk_id) into v_dep_risk from work_orders w
        left join recommendations rec on rec.id=w.recommendation_id
        where w.id=dep.subject_id and w.organization_id=a.organization_id;
      if v_dep_risk is not null then perform mark_risk_reassessment(v_dep_risk,'Dependent work assumption invalidated: '||a.statement); end if;
    end if;
    -- estimate: no reassessment column on project_cost_items. The assumption
    -- row itself carries the invalidated status; a later reader of
    -- get_case_assumption_links sees the estimate still named and the
    -- assumption no longer active.
  end loop;
  if a.risk_id is not null and not exists (
    select 1 from risk_assumption_dependencies
    where assumption_id = a.id and subject_type = 'risk' and subject_id = a.risk_id
  ) then
    perform mark_risk_reassessment(a.risk_id,'Assumption invalidated: '||a.statement);
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(a.organization_id,'risk_assumption_invalidated',p_actor_role,
    jsonb_build_object('assumption_id',a.id,'reason',btrim(p_reason),
      'development_case_id',a.development_case_id,'business_case_id',a.business_case_id,
      'schedule_activity_id',a.schedule_activity_id));
  if a.development_case_id is not null then
    v_collapse := public.evaluate_business_case_collapse(a.development_case_id,
      a.organization_id, 'assumption invalidated: '||a.statement);
  end if;
  return jsonb_build_object('assumption_id',a.id,'status','invalidated','reassessment_required',true,
    'collapse',v_collapse);
end;
$$;

revoke all on function public.apply_assumption_invalidation(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D4.01 — bind quality_requirements to design_requirements
-- ---------------------------------------------------------------------------
alter table public.quality_requirements
  add column if not exists design_requirement_id bigint
    references public.design_requirements(id) on delete restrict;

comment on column public.quality_requirements.design_requirement_id is
  'D4.01 binding to the ONE project requirement table (design_requirements). New writes refuse a missing or foreign link. Historical unbound rows remain and are named by get_quality_cockpit.unboundQualityRequirements.';

create index if not exists idx_quality_requirement_design
  on public.quality_requirements(design_requirement_id)
  where design_requirement_id is not null;

create or replace function public.quality_scope_in_org(p_record jsonb,p_org uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select p_org is not null
    and (nullif(p_record->>'assetId','') is null or exists(
      select 1 from public.assets where id=(p_record->>'assetId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'projectId','') is null or exists(
      select 1 from public.capital_projects where id=(p_record->>'projectId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'supplierId','') is null or exists(
      select 1 from public.suppliers where id=(p_record->>'supplierId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'workOrderId','') is null or exists(
      select 1 from public.work_orders where id=(p_record->>'workOrderId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'requirementId','') is null or exists(
      select 1 from public.quality_requirements where id=(p_record->>'requirementId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'itpId','') is null or exists(
      select 1 from public.quality_itps where id=(p_record->>'itpId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'itpPointId','') is null or exists(
      select 1 from public.quality_itp_points where id=(p_record->>'itpPointId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'ncrId','') is null or exists(
      select 1 from public.quality_ncrs where id=(p_record->>'ncrId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'defectId','') is null or exists(
      select 1 from public.quality_defects where id=(p_record->>'defectId')::bigint and organization_id=p_org))
    and (nullif(p_record->>'ownerId','') is null or exists(
      select 1 from public.user_profiles where id=(p_record->>'ownerId')::uuid and organization_id=p_org))
    and (nullif(p_record->>'designRequirementId','') is null or exists(
      select 1 from public.design_requirements
       where id=(p_record->>'designRequirementId')::bigint and organization_id=p_org));
$$;

revoke all on function public.quality_scope_in_org(jsonb,uuid) from public,anon,authenticated;

create or replace function public.record_quality_requirement(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_actor uuid:=auth.uid();
  v_id bigint;
  v_design bigint:=nullif(p_record->>'designRequirementId','')::bigint;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.quality_scope_in_org(p_record,v_org) then
    return jsonb_build_object('error','one or more scoped records are outside this organization');
  end if;
  if v_design is null then
    return jsonb_build_object('error',
      'a quality requirement must bind to a design_requirements row — design_requirements is the ONE project requirement table (D4.01); an unbound quality row is a parallel store the §10 trace cannot see');
  end if;
  if not exists(
    select 1 from public.design_requirements
     where id=v_design and organization_id=v_org
  ) then
    return jsonb_build_object('error','design requirement not found in this organization');
  end if;
  if coalesce(length(btrim(p_record->>'requirementRef')),0)<2
     or coalesce(length(btrim(p_record->>'title')),0)<3
     or coalesce(length(btrim(p_record->>'requirementText')),0)<10
     or coalesce(length(btrim(p_record->>'sourceReference')),0)<3
     or coalesce(length(btrim(p_record->>'acceptanceCriterion')),0)<5 then
    return jsonb_build_object('error','requirement reference, text, source and acceptance criterion are required');
  end if;
  insert into public.quality_requirements(
    organization_id,requirement_ref,title,requirement_text,source_kind,source_reference,
    acceptance_criterion,verification_method,severity,asset_id,project_id,supplier_id,
    work_order_id,design_requirement_id,created_by)
  values(v_org,btrim(p_record->>'requirementRef'),btrim(p_record->>'title'),
    btrim(p_record->>'requirementText'),p_record->>'sourceKind',btrim(p_record->>'sourceReference'),
    btrim(p_record->>'acceptanceCriterion'),p_record->>'verificationMethod',
    coalesce(p_record->>'severity','major'),(p_record->>'assetId')::uuid,
    (p_record->>'projectId')::bigint,(p_record->>'supplierId')::bigint,
    (p_record->>'workOrderId')::uuid,v_design,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_requirement','member',jsonb_build_object(
    'id',v_id,'action','created','design_requirement_id',v_design));
  return jsonb_build_object('id',v_id,'status','draft','designRequirementId',v_design);
end $$;

revoke all on function public.record_quality_requirement(jsonb) from public,anon;
grant execute on function public.record_quality_requirement(jsonb) to authenticated;

create or replace function public.get_quality_cockpit(p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path=public
as $$
with bounds as (
  select app_current_org() org,coalesce(p_from,'-infinity'::timestamptz) since,
         coalesce(p_to,'infinity'::timestamptz) until
), d as (
  select coalesce(sum(inspected_quantity),0) inspected,coalesce(sum(defective_quantity),0) defective,
    coalesce(sum(first_pass_accepted_quantity),0) first_pass,coalesce(sum(reworked_quantity),0) reworked,
    coalesce(sum(scrapped_quantity),0) scrapped
  from quality_defects,bounds where organization_id=org and detected_at>=since and detected_at<until
), a as (
  select coalesce(sum(tested_samples) filter(where tested_samples is not null),0) tested,
    coalesce(sum(passed_samples) filter(where tested_samples is not null),0) passed,
    count(*) filter(where tested_samples is null and outcome in ('pass','pass_with_punch','fail')) outcome_tests,
    count(*) filter(where tested_samples is null and outcome='pass') outcome_passes
  from acceptance_tests,bounds where organization_id=org and performed_on::timestamptz>=since and performed_on::timestamptz<until
), n as (
  select count(*) filter(where status<>'cancelled') total,
    count(*) filter(where status='closed') closed,
    count(*) filter(where status not in ('closed','cancelled')) open,
    count(*) filter(where status not in ('closed','cancelled') and due_at<now()) overdue,
    round(avg(greatest(0,extract(epoch from (now()-detected_at))/86400)) filter(where status not in ('closed','cancelled')),1) average_age,
    floor(max(greatest(0,extract(epoch from (now()-detected_at))/86400)) filter(where status not in ('closed','cancelled'))) oldest_age
  from quality_ncrs,bounds where organization_id=org and detected_at>=since and detected_at<until
), costs as (
  select currency,
    sum(prevention) prevention,sum(appraisal) appraisal,sum(internal_failure) internal_failure,
    sum(external_failure) external_failure
  from (
    select currency,0::numeric prevention,0::numeric appraisal,
      scrap_cost internal_failure,0::numeric external_failure
    from quality_defects,bounds where organization_id=org and detected_at>=since and detected_at<until and scrap_cost>0
    union all
    select currency,0,0,labour_cost+material_cost+equipment_cost+downtime_cost+external_cost,0
    from quality_rework_records,bounds where organization_id=org and started_at>=since and started_at<until
    union all
    select currency,case when category='prevention' then amount else 0 end,
      case when category='appraisal' then amount else 0 end,
      case when category='internal_failure' then amount else 0 end,
      case when category='external_failure' then amount else 0 end
    from quality_cost_entries,bounds where organization_id=org and incurred_at>=since and incurred_at<until
  ) q group by currency
), metrics as (
  select jsonb_build_array(
    jsonb_build_object('key','first_pass_yield_pct','label','First-pass yield','formula','first-pass accepted quantity / inspected quantity × 100','value',round(100*d.first_pass/nullif(d.inspected,0),2),'unit','%','numerator',d.first_pass,'denominator',d.inspected),
    jsonb_build_object('key','defect_rate_pct','label','Defect rate','formula','defective quantity / inspected quantity × 100','value',round(100*d.defective/nullif(d.inspected,0),2),'unit','%','numerator',d.defective,'denominator',d.inspected),
    jsonb_build_object('key','rework_rate_pct','label','Rework rate','formula','reworked quantity / inspected quantity × 100','value',round(100*d.reworked/nullif(d.inspected,0),2),'unit','%','numerator',d.reworked,'denominator',d.inspected),
    jsonb_build_object('key','scrap_rate_pct','label','Scrap rate','formula','scrapped quantity / inspected quantity × 100','value',round(100*d.scrapped/nullif(d.inspected,0),2),'unit','%','numerator',d.scrapped,'denominator',d.inspected),
    jsonb_build_object('key','acceptance_pass_rate_pct','label','Acceptance-test pass rate','formula','passed samples / tested samples × 100; test outcomes are used only when sample counts are absent','value',round(100*(case when a.tested>0 then a.passed else a.outcome_passes end)/nullif(case when a.tested>0 then a.tested else a.outcome_tests end,0),2),'unit','%','numerator',case when a.tested>0 then a.passed else a.outcome_passes end,'denominator',case when a.tested>0 then a.tested else a.outcome_tests end),
    jsonb_build_object('key','ncr_closure_rate_pct','label','NCR closure rate','formula','closed NCRs / NCRs detected × 100','value',round(100*n.closed/nullif(n.total,0),2),'unit','%','numerator',n.closed,'denominator',n.total),
    jsonb_build_object('key','overdue_ncr_rate_pct','label','Overdue open-NCR rate','formula','open NCRs past due / open NCRs × 100','value',round(100*n.overdue/nullif(n.open,0),2),'unit','%','numerator',n.overdue,'denominator',n.open)
  ) value from d,a,n
)
select jsonb_build_object(
  'metrics',(select value from metrics),
  'ncrAging',(select jsonb_build_object('open',open,'overdue',overdue,'averageOpenAgeDays',average_age,'oldestOpenAgeDays',oldest_age) from n),
  'costByCurrency',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'prevention',prevention,'appraisal',appraisal,
    'internalFailure',internal_failure,'externalFailure',external_failure,'costOfPoorQuality',internal_failure+external_failure,
    'totalCostOfQuality',prevention+appraisal+internal_failure+external_failure) order by currency) from costs),'[]'::jsonb),
  'requirements',coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object(
      'designRequirementId', q.design_requirement_id,
      'designRequirementRef', (select d.requirement_ref from design_requirements d where d.id = q.design_requirement_id))
      order by q.created_at desc)
    from (select r.* from quality_requirements r,bounds where r.organization_id=org order by r.created_at desc limit 100) q),'[]'::jsonb),
  'unboundQualityRequirements',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'requirementRef', r.requirement_ref, 'title', r.title, 'status', r.status)
      order by r.created_at desc)
    from quality_requirements r, bounds
    where r.organization_id=org and r.design_requirement_id is null
  ), '[]'::jsonb),
  'itps',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select i.* from quality_itps i,bounds where i.organization_id=org order by i.created_at desc limit 100) q),'[]'::jsonb),
  'itpPoints',coalesce((select jsonb_agg(to_jsonb(q) order by q.itp_id,q.sequence_no) from (select p.* from quality_itp_points p,bounds where p.organization_id=org order by p.itp_id desc,p.sequence_no limit 500) q),'[]'::jsonb),
  'ncrs',coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('ageDays',floor(greatest(0,extract(epoch from (coalesce(q.closed_at,now())-q.detected_at))/86400)),'overdue',q.status not in ('closed','cancelled') and q.due_at<now()) order by q.detected_at desc) from (select x.* from quality_ncrs x,bounds where x.organization_id=org order by x.detected_at desc limit 100) q),'[]'::jsonb),
  'defects',coalesce((select jsonb_agg(to_jsonb(q) order by q.detected_at desc) from (select x.* from quality_defects x,bounds where x.organization_id=org order by x.detected_at desc limit 100) q),'[]'::jsonb),
  'rework',coalesce((select jsonb_agg(to_jsonb(q) order by q.started_at desc) from (select x.* from quality_rework_records x,bounds where x.organization_id=org order by x.started_at desc limit 100) q),'[]'::jsonb),
  'acceptanceTests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select x.* from acceptance_tests x,bounds where x.organization_id=org order by x.created_at desc limit 100) q),'[]'::jsonb),
  'basis','Seven metrics derive from recorded quantities, test outcomes and NCR dates. COPQ is internal plus external failure cost only. Prevention and appraisal are shown separately. Currencies are never combined. Quality requirements created after 20261217090000 bind to design_requirements; any unbound historical row is named in unboundQualityRequirements rather than hidden.'
);
$$;

revoke all on function public.get_quality_cockpit(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_quality_cockpit(timestamptz,timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- D4.14 — cyber is a first-class gate-readiness category
-- ---------------------------------------------------------------------------
-- Vocabulary only. Mandatory-block already treats every category the same;
-- publishing the list is what makes cyber authorable rather than a free-text
-- accident. No "every design gate must carry a cyber criterion" rule: that
-- would refuse every existing Slice 1–3 walk.
create or replace function public.sync_gate_readiness_categories()
returns text[]
language sql
immutable
as $$
  select array[
    'business','technical','risk','cost_schedule','operations',
    'supply','regulatory','cyber'
  ];
$$;

revoke all on function public.sync_gate_readiness_categories() from public, anon;
grant execute on function public.sync_gate_readiness_categories() to authenticated;

comment on function public.sync_gate_readiness_categories() is
  'D4.14: the first-class gate-readiness categories a customer can state, including cyber. An unmet mandatory criterion in any of these — cyber included — blocks at any readiness percentage (get_gate_readiness / record_case_gate_review).';

notify pgrst, 'reload schema';
