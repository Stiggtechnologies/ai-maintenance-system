-- ============================================================================
-- C1.10 — governed Asset Strategy Specialist.
--
-- The shared TypeScript reliability and optimisation kernels already answer
-- censored-life, age-replacement and P-F interval questions.  This migration
-- connects those kernels to the ONE canonical maintenance programme without
-- copying their mathematics into SQL.  The agent freezes exact source evidence
-- and proposes; only a separately assigned named reliability engineer can
-- change a PM interval, adopt run-to-failure, or create a lifecycle-plan version.
-- ============================================================================

update public.decision_rights
set enforcement='enforced', version=version+1, effective_at=now()
where right_key='change_pm_interval' and enforcement<>'enforced';

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'optimise_asset_strategy','Optimise asset maintenance strategy',
  'Apply the shared censored-life, age-replacement and P-F interval kernels to exact same-tenant maintenance-plan evidence without changing the programme.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'asset_strategy','Asset Strategy Specialist','specialist',
       'active','advisory','Waiting for a governed maintenance-strategy review',
       'Reliability Manager'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='asset_strategy'
);

update public.ai_agents
set name='Asset Strategy Specialist',category='specialist',
    autonomy_mode='advisory',supervisor='Reliability Manager',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact PM-programme, component-life, P-F, economics and lifecycle evidence into a retained asset-strategy assessment and named-human adoption hand-off.',
      'modes',jsonb_build_array('PM optimization','task intervals','run-to-failure screening','lifecycle planning'),
      'triggers',jsonb_build_array('human review request','interval unsupported by failure behavior','material cost-rate opportunity','adopted P-F interval','lifecycle decision or evidence gap'),
      'inputs',jsonb_build_array('maintenance plan','asset register','component life events','adopted P-F intervals','asset economics','lifecycle evaluations'),
      'outputs',jsonb_build_array('immutable strategy assessment','exact source snapshot','kernel result','evidence gaps','review assignment','human-adoptable lifecycle plan'),
      'guardrails',jsonb_build_array(
        'Never invent failure history, operating exposure, cost, P-F interval, safety classification, regulatory status or lifecycle objective',
        'Never recommend run-to-failure when safety or regulatory applicability is true or unknown',
        'Never change a PM interval, deactivate a task, approve strategy, create work, accept risk, commit spend or return equipment to service',
        'Use the shared qualified TypeScript kernels; never reproduce their mathematics in SQL or the browser',
        'Require a separately assigned named reliability engineer for every programme change'),
      'routes',jsonb_build_array('/reliability/intervals','/pm-programme','/lifecycle/decisions'))
where key='asset_strategy';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_asset_strategy_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_asset_strategy_charter_shape
      check (key <> 'asset_strategy' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Extend only untouched platform advisory baselines.  A tenant-authored
-- control history is never silently replaced by a migration.
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
    where a.key='asset_strategy'
  loop
    if r.old_profile is not null and r.old_basis<>v_basis then continue; end if;
    if r.old_profile is null and exists(
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
    values(r.organization_id,r.agent_id,'advisory_only','reliability_engineer',
      coalesce(r.proposal_risk_ceiling,'Critical'),
      coalesce(r.proposal_cost_ceiling_usd,0),
      coalesce(r.proposal_downtime_ceiling_hours,0),false,
      v_basis,'draft',v_version,null)
    returning id into v_profile;
    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d where d.right_key='recommend_inspection_review';
    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in ('optimise_asset_strategy','read_work_context','draft_recommendation');
    update public.agent_control_profiles set status='adopted',adopted_at=now()
    where id=v_profile;
  end loop;
end $$;

-- The maintenance programme stays canonical.  These fields state the exact
-- engineering context the imported task did not historically carry.  NULL is
-- deliberately unknown; false is a human assertion and never a default.
alter table public.maintenance_plans
  add column if not exists component_scope text,
  add column if not exists failure_mode text,
  add column if not exists strategy_kind text,
  add column if not exists planned_task_cost_usd numeric,
  add column if not exists failure_consequence_cost_usd numeric,
  add column if not exists cost_basis text,
  add column if not exists safety_critical boolean,
  add column if not exists regulatory_required boolean,
  add column if not exists lifecycle_objective text,
  add column if not exists engineering_context_updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists version integer not null default 1;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_plans'::regclass
      and conname='maintenance_plans_strategy_kind_check') then
    alter table public.maintenance_plans add constraint maintenance_plans_strategy_kind_check
      check(strategy_kind is null or strategy_kind in
        ('time_based_pm','condition_based','failure_finding','run_to_failure'));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_plans'::regclass
      and conname='maintenance_plans_strategy_costs_check') then
    alter table public.maintenance_plans add constraint maintenance_plans_strategy_costs_check
      check((planned_task_cost_usd is null or planned_task_cost_usd>0)
        and (failure_consequence_cost_usd is null or failure_consequence_cost_usd>0));
  end if;
end $$;

create table if not exists public.asset_strategy_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_id uuid not null references public.maintenance_plans(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete restrict,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  plan_version integer not null,
  kernel_version text not null,
  source_event_ids bigint[] not null default '{}',
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  analysis jsonb not null check(jsonb_typeof(analysis)='object'),
  recommendation jsonb not null check(jsonb_typeof(recommendation)='object'),
  limitations jsonb not null default '[]' check(jsonb_typeof(limitations)='array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_asset_strategy_assessments_plan
  on public.asset_strategy_assessments(organization_id,maintenance_plan_id,created_at desc);

create table if not exists public.asset_strategy_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.asset_strategy_assessments(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check(length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique(assessment_id,assigned_to)
);

-- Every row is one immutable, human-adopted lifecycle-plan version.  The latest
-- row is current; history is never rewritten or relabelled.
create table if not exists public.asset_lifecycle_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  maintenance_plan_id uuid not null references public.maintenance_plans(id) on delete restrict,
  source_assessment_id uuid not null unique references public.asset_strategy_assessments(id) on delete restrict,
  version integer not null,
  horizon_years integer not null check(horizon_years between 1 and 30),
  objective text not null check(length(btrim(objective)) between 20 and 2000),
  adopted_action text not null check(adopted_action in ('apply_recommended','retain_current','defer')),
  adopted_strategy jsonb not null check(jsonb_typeof(adopted_strategy)='object'),
  adoption_note text not null check(length(btrim(adoption_note)) between 20 and 4000),
  adopted_by uuid not null references auth.users(id),
  adopted_at timestamptz not null default now()
);
create unique index if not exists uq_asset_lifecycle_plan_version
  on public.asset_lifecycle_plans(organization_id,asset_id,version);

alter table public.asset_strategy_assessments enable row level security;
alter table public.asset_strategy_review_assignments enable row level security;
alter table public.asset_lifecycle_plans enable row level security;
drop policy if exists asset_strategy_assessments_read on public.asset_strategy_assessments;
create policy asset_strategy_assessments_read on public.asset_strategy_assessments
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists asset_strategy_review_assignments_read on public.asset_strategy_review_assignments;
create policy asset_strategy_review_assignments_read on public.asset_strategy_review_assignments
  for select to authenticated using(organization_id=public.app_current_org());
drop policy if exists asset_lifecycle_plans_read on public.asset_lifecycle_plans;
create policy asset_lifecycle_plans_read on public.asset_lifecycle_plans
  for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.asset_strategy_assessments,
  public.asset_strategy_review_assignments,public.asset_lifecycle_plans
  from public,anon,authenticated;
grant select on public.asset_strategy_assessments,
  public.asset_strategy_review_assignments,public.asset_lifecycle_plans to authenticated;

create or replace function public.protect_asset_strategy_records()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'asset-strategy assessments, reviews and lifecycle plans are append-only';
  end if;
  if coalesce(current_setting('app.asset_strategy_record_write',true),'')<>'granted' then
    raise exception 'asset-strategy records are written only by governed workflows';
  end if;
  return new;
end $$;
revoke all on function public.protect_asset_strategy_records() from public,anon,authenticated;
drop trigger if exists trg_protect_asset_strategy_assessments on public.asset_strategy_assessments;
create trigger trg_protect_asset_strategy_assessments before insert or update or delete
  on public.asset_strategy_assessments for each row execute function public.protect_asset_strategy_records();
drop trigger if exists trg_protect_asset_strategy_reviews on public.asset_strategy_review_assignments;
create trigger trg_protect_asset_strategy_reviews before insert or update or delete
  on public.asset_strategy_review_assignments for each row execute function public.protect_asset_strategy_records();
drop trigger if exists trg_protect_asset_lifecycle_plans on public.asset_lifecycle_plans;
create trigger trg_protect_asset_lifecycle_plans before insert or update or delete
  on public.asset_lifecycle_plans for each row execute function public.protect_asset_strategy_records();

-- Preserve every existing retained-run writer while adding this specialist.
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
  v_strategy_marker text:=coalesce(current_setting('app.asset_strategy_agent_run_write',true),'');
  v_allowed boolean:=v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted' or v_mro_marker='granted'
    or v_turnaround_marker='granted' or v_strategy_marker='granted';
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

create or replace function public.sync_asset_strategy_kernel_version()
returns text language sql immutable as $$ select 'asset-strategy/1'::text $$;
revoke all on function public.sync_asset_strategy_kernel_version() from public,anon,authenticated;

create or replace function public.record_asset_strategy_context(
  p_plan_id uuid,p_component_scope text,p_failure_mode text,p_strategy_kind text,
  p_planned_task_cost_usd numeric,p_failure_consequence_cost_usd numeric,
  p_cost_basis text,p_safety_critical boolean,p_regulatory_required boolean,
  p_lifecycle_objective text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; p public.maintenance_plans%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','recording asset-strategy context requires a named reliability engineer or administrator');
  end if;
  select * into p from public.maintenance_plans where id=p_plan_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','maintenance plan not found'); end if;
  if p.asset_id is null then return jsonb_build_object('error','the maintenance plan must name one canonical asset'); end if;
  if coalesce(length(btrim(p_component_scope)),0) not between 2 and 160
     or coalesce(length(btrim(p_failure_mode)),0)<5 then
    return jsonb_build_object('error','record a component scope and failure mode before strategy analysis');
  end if;
  if p_strategy_kind not in ('time_based_pm','condition_based','failure_finding','run_to_failure') then
    return jsonb_build_object('error','strategy kind is not recognized');
  end if;
  if p_planned_task_cost_usd is not null and p_planned_task_cost_usd<=0
     or p_failure_consequence_cost_usd is not null and p_failure_consequence_cost_usd<=0 then
    return jsonb_build_object('error','recorded strategy costs must be positive');
  end if;
  if (p_planned_task_cost_usd is not null or p_failure_consequence_cost_usd is not null)
     and coalesce(length(btrim(p_cost_basis)),0)<20 then
    return jsonb_build_object('error','cost inputs require at least 20 characters of provenance');
  end if;
  if p_safety_critical is null or p_regulatory_required is null then
    return jsonb_build_object('error','safety-critical and regulatory applicability must each be explicitly stated');
  end if;
  if coalesce(length(btrim(p_lifecycle_objective)),0)<20 then
    return jsonb_build_object('error','record a lifecycle objective of at least 20 characters');
  end if;
  update public.maintenance_plans set
    component_scope=btrim(p_component_scope),failure_mode=btrim(p_failure_mode),
    strategy_kind=p_strategy_kind,planned_task_cost_usd=p_planned_task_cost_usd,
    failure_consequence_cost_usd=p_failure_consequence_cost_usd,
    cost_basis=nullif(btrim(coalesce(p_cost_basis,'')),''),
    safety_critical=p_safety_critical,regulatory_required=p_regulatory_required,
    lifecycle_objective=btrim(p_lifecycle_objective),
    engineering_context_updated_by=auth.uid(),updated_at=now(),version=version+1
  where id=p.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_plan_strategy_context',v_role,jsonb_build_object(
    'action','context_recorded','maintenance_plan_id',p.id,'asset_id',p.asset_id,
    'component_scope',btrim(p_component_scope),'failure_mode',btrim(p_failure_mode),
    'strategy_kind',p_strategy_kind,'safety_critical',p_safety_critical,
    'regulatory_required',p_regulatory_required,'recorded_by',auth.uid()));
  return jsonb_build_object('planId',p.id,'version',p.version+1,'status','recorded');
end $$;
revoke all on function public.record_asset_strategy_context(uuid,text,text,text,numeric,numeric,text,boolean,boolean,text)
  from public,anon;
grant execute on function public.record_asset_strategy_context(uuid,text,text,text,numeric,numeric,text,boolean,boolean,text)
  to authenticated;

-- Service-only, exact same-tenant source bundle.  The browser never supplies a
-- trusted fit, cost result, P-F interval or source row set.
create or replace function public.get_asset_strategy_source(
  p_organization_id uuid,p_actor_id uuid,p_plan_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_role text; p public.maintenance_plans%rowtype; a public.assets%rowtype;
  v_events jsonb:='[]'::jsonb; v_pf jsonb:='[]'::jsonb;
  v_economics jsonb:='null'::jsonb; v_lifecycle jsonb:='[]'::jsonb;
begin
  select role into v_role from public.user_profiles
  where id=p_actor_id and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','the controlled asset-strategy calculation requires a named same-tenant reliability engineer, maintenance manager or administrator');
  end if;
  select * into p from public.maintenance_plans
  where id=p_plan_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('error','maintenance plan not found'); end if;
  if p.asset_id is null then return jsonb_build_object('error','maintenance plan has no canonical asset'); end if;
  select * into a from public.assets where id=p.asset_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('error','asset not found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'assetId',e.asset_id,'unitNumber',e.unit_number,
    'component',e.component,'hoursAtChangeOut',e.hours_at_change_out,
    'plannedIntervalHours',e.planned_interval_hours,'eventDate',e.event_date,
    'eventKind',e.event_kind,'symptom',e.symptom,'workOrderRef',e.work_order_ref,
    'sourceFile',e.source_file,'sourceBasis',e.source_basis,'recordedBy',e.recorded_by,
    'importedAt',e.imported_at) order by e.id),'[]'::jsonb) into v_events
  from public.component_life_events e
  where e.organization_id=p_organization_id
    and nullif(btrim(p.component_scope),'') is not null
    and lower(e.component)=lower(btrim(p.component_scope));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'assetClass',f.asset_class,'failureMode',f.failure_mode,
    'detectionTechnique',f.detection_technique,'pfIntervalDays',f.pf_interval_days,
    'recommendedInspectionDays',f.recommended_inspection_days,'basis',f.basis,
    'status',f.status,'adoptedBy',f.adopted_by,'adoptedAt',f.adopted_at)
    order by f.adopted_at desc nulls last,f.created_at desc),'[]'::jsonb) into v_pf
  from public.pf_intervals f
  where f.organization_id=p_organization_id and f.status='adopted'
    and nullif(btrim(p.failure_mode),'') is not null
    and lower(f.failure_mode)=lower(btrim(p.failure_mode))
    and (f.asset_class is null or lower(f.asset_class)=lower(coalesce(a.asset_class,'')));
  select jsonb_build_object('id',e.id,'replacementValueUsd',e.replacement_value_usd,
    'annualMaintenanceCostUsd',e.annual_maintenance_cost_usd,
    'downtimeCostPerHourUsd',e.downtime_cost_per_hour_usd,
    'expectedRepairCostUsd',e.expected_repair_cost_usd,
    'expectedRepairHours',e.expected_repair_hours,
    'expectedRemainingLifeYears',e.expected_remaining_life_years,
    'basis',e.basis,'sourceSystem',e.source_system,'updatedAt',e.updated_at)
  into v_economics from public.asset_economics e
  where e.organization_id=p_organization_id
    and (e.asset_id=a.id or (e.asset_id is null and e.asset_class=a.asset_class))
  order by (e.asset_id is not null) desc,e.updated_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'recommended',x.recommended,
    'uncertaintyLevel',x.uncertainty_level,'rationale',x.rationale,
    'decision',x.decision,'decisionNote',x.decision_note,
    'evaluatedAt',x.evaluated_at,'decidedAt',x.decided_at)
    order by x.evaluated_at desc),'[]'::jsonb) into v_lifecycle
  from (select * from public.lifecycle_evaluations e
    where e.organization_id=p_organization_id and e.asset_id=a.id
    order by e.evaluated_at desc limit 10) x;
  return jsonb_build_object(
    'kernelVersion',public.sync_asset_strategy_kernel_version(),
    'plan',jsonb_build_object('id',p.id,'taskCode',p.task_code,'taskLabel',p.task_label,
      'intervalBasis',p.interval_basis,'intervalValue',p.interval_value,'active',p.active,
      'source',p.source,'componentScope',p.component_scope,'failureMode',p.failure_mode,
      'strategyKind',p.strategy_kind,'plannedTaskCostUsd',p.planned_task_cost_usd,
      'failureConsequenceCostUsd',p.failure_consequence_cost_usd,'costBasis',p.cost_basis,
      'safetyCritical',p.safety_critical,'regulatoryRequired',p.regulatory_required,
      'lifecycleObjective',p.lifecycle_objective,'version',p.version,
      'engineeringContextUpdatedBy',p.engineering_context_updated_by,'updatedAt',p.updated_at),
    'asset',jsonb_build_object('id',a.id,'name',a.name,'tag',a.tag,
      'assetClass',a.asset_class,'criticality',a.criticality,'status',a.status,
      'installedDate',a.installed_date),
    'lifeEvents',v_events,'pfIntervals',v_pf,
    'economics',coalesce(v_economics,'null'::jsonb),
    'lifecycleEvaluations',v_lifecycle);
end $$;
revoke all on function public.get_asset_strategy_source(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_asset_strategy_source(uuid,uuid,uuid) to service_role;

create or replace function public.record_asset_strategy_run(
  p_organization_id uuid,p_actor_id uuid,p_plan_id uuid,p_plan_version integer,
  p_event_ids bigint[],p_kernel_version text,p_result jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; p public.maintenance_plans%rowtype; a public.assets%rowtype;
  ag public.ai_agents%rowtype; v_control jsonb; v_expected_ids bigint[];
  v_claimed bigint[]; v_snapshot jsonb; v_source jsonb; v_failures integer;
  v_suspensions integer; v_distinct_failures integer; v_expected_method text;
  v_method jsonb; v_recommendation jsonb; v_run uuid; v_assessment uuid;
begin
  select role into v_role from public.user_profiles
  where id=p_actor_id and organization_id=p_organization_id;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','the controlled asset-strategy calculation requires a named same-tenant reliability engineer, maintenance manager or administrator');
  end if;
  select * into p from public.maintenance_plans
  where id=p_plan_id and organization_id=p_organization_id for share;
  if not found then return jsonb_build_object('error','maintenance plan not found'); end if;
  if p.asset_id is null then return jsonb_build_object('error','maintenance plan has no canonical asset'); end if;
  if p.version<>p_plan_version then return jsonb_build_object('error','maintenance plan changed during calculation; run a new assessment'); end if;
  if p_kernel_version<>public.sync_asset_strategy_kernel_version() then
    return jsonb_build_object('error','the calculation kernel version is not the server-pinned version');
  end if;
  if jsonb_typeof(coalesce(p_result,'null'::jsonb))<>'object'
     or not (p_result ?& array['methodSelection','ageReplacement','inspection','recommendation','refusals','lifecyclePlan']) then
    return jsonb_build_object('error','asset-strategy result is incomplete');
  end if;
  v_method:=p_result->'methodSelection'; v_recommendation:=p_result->'recommendation';
  if jsonb_typeof(v_method)<>'object' or jsonb_typeof(v_recommendation)<>'object'
     or jsonb_typeof(p_result->'refusals')<>'array'
     or jsonb_typeof(p_result->'lifecyclePlan')<>'object' then
    return jsonb_build_object('error','asset-strategy result has an invalid shape');
  end if;
  select array_agg(e.id order by e.id),count(*) filter(where e.event_kind='failure' and e.hours_at_change_out>0),
    count(*) filter(where e.event_kind='scheduled' and e.hours_at_change_out>0),
    count(distinct e.hours_at_change_out) filter(where e.event_kind='failure' and e.hours_at_change_out>0)
  into v_expected_ids,v_failures,v_suspensions,v_distinct_failures
  from public.component_life_events e
  where e.organization_id=p_organization_id
    and nullif(btrim(p.component_scope),'') is not null
    and lower(e.component)=lower(btrim(p.component_scope));
  select array_agg(distinct x order by x) into v_claimed
  from unnest(coalesce(p_event_ids,'{}'::bigint[])) x;
  if coalesce(v_expected_ids,'{}'::bigint[]) is distinct from coalesce(v_claimed,'{}'::bigint[])
     or cardinality(coalesce(p_event_ids,'{}'::bigint[]))<>cardinality(coalesce(v_expected_ids,'{}'::bigint[])) then
    return jsonb_build_object('error','source event set changed or does not match the complete same-tenant component population');
  end if;
  v_expected_method:=case when coalesce(v_failures,0)<2 or coalesce(v_distinct_failures,0)<2 then 'none'
    when coalesce(v_suspensions,0)>0 then 'mle_censored'
    when v_failures<15 then 'rank_regression' else 'mle' end;
  if coalesce(v_method->>'method','')<>v_expected_method
     or coalesce((v_method->>'failures')::integer,-1)<>coalesce(v_failures,0)
     or coalesce((v_method->>'suspensions')::integer,-1)<>coalesce(v_suspensions,0) then
    return jsonb_build_object('error','method selection does not match the server-owned life-event classification');
  end if;
  if coalesce(v_recommendation->>'kind','') not in
      ('interval_change','inspection_interval','run_to_failure_review','retain_current','evidence_gap','strategy_review') then
    return jsonb_build_object('error','asset-strategy recommendation kind is not recognized');
  end if;
  if v_recommendation->>'kind'='run_to_failure_review'
     and (p.safety_critical is distinct from false or p.regulatory_required is distinct from false) then
    return jsonb_build_object('error','run-to-failure is blocked when safety or regulatory applicability is true or unknown');
  end if;
  if v_recommendation->>'kind' in ('interval_change','run_to_failure_review')
     and (coalesce(p.planned_task_cost_usd,0)<=0
       or coalesce(p.failure_consequence_cost_usd,0)<=0
       or coalesce(length(btrim(p.cost_basis)),0)<20) then
    return jsonb_build_object('error','planned and failure consequence cost evidence is required for this strategy recommendation');
  end if;
  if v_recommendation->>'kind' in ('interval_change','inspection_interval')
     and (coalesce((v_recommendation->>'proposedIntervalValue')::numeric,0)<=0
       or v_recommendation->>'proposedIntervalBasis' not in ('calendar_days','run_hours')) then
    return jsonb_build_object('error','an interval recommendation requires a positive value and recognized basis');
  end if;
  select * into a from public.assets where id=p.asset_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('error','asset not found'); end if;
  v_source:=public.get_asset_strategy_source(p_organization_id,p_actor_id,p.id);
  if v_source ? 'error' then return v_source; end if;
  v_snapshot:=v_source||jsonb_build_object('sourceEventIds',to_jsonb(coalesce(v_expected_ids,'{}'::bigint[])));
  select * into ag from public.ai_agents where organization_id=p_organization_id
    and key='asset_strategy' order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Asset Strategy Specialist is configured'); end if;
  v_control:=public.evaluate_agent_control_internal(p_organization_id,ag.id,
    'recommend_inspection_review','optimise_asset_strategy','Critical',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Asset Strategy Specialist refused: '||(v_control->>'reason'));
  end if;
  perform set_config('app.asset_strategy_agent_run_write','granted',true);
  insert into public.agent_runs
    (organization_id,agent_id,asset_id,status,summary,confidence,started_at,completed_at,
     requested_by,component_scope,agent_control_profile_id,agent_tool_key,
     agent_decision_right_key,input_snapshot,result,retained_for_governance)
  values(p_organization_id,ag.id,a.id,'completed',
    'Computed one governed advisory asset-strategy assessment from the exact canonical maintenance-plan evidence.',
    case when v_expected_method='none' then 0 else 80 end,now(),now(),p_actor_id,
    p.component_scope,(v_control->>'profile_id')::uuid,'optimise_asset_strategy',
    'recommend_inspection_review',v_snapshot,p_result||jsonb_build_object(
      'advisory',true,'mayChangePmInterval',false,'mayDeactivateTask',false,
      'mayApproveStrategy',false,'mayCreateWork',false,'mayAcceptRisk',false,
      'mayCommitSpend',false,'mayReturnToService',false),true)
  returning id into v_run;
  perform set_config('app.asset_strategy_record_write','granted',true);
  insert into public.asset_strategy_assessments
    (organization_id,maintenance_plan_id,asset_id,agent_run_id,plan_version,
     kernel_version,source_event_ids,source_snapshot,analysis,recommendation,
     limitations,created_by)
  values(p_organization_id,p.id,a.id,v_run,p.version,p_kernel_version,
    coalesce(v_expected_ids,'{}'::bigint[]),v_snapshot,p_result,v_recommendation,
    jsonb_build_array(
      'The assessment applies only to the exact plan, component population, costs, P-F records and lifecycle evidence frozen in this version.',
      'A run-to-failure review is never produced when safety or regulatory applicability is true or unknown.',
      'The agent cannot change the programme; a separately assigned named reliability engineer must adopt or reject the proposal.',
      'Work creation, risk acceptance, expenditure, operating limits and return-to-service remain separate authorities.'),p_actor_id)
  returning id into v_assessment;
  perform set_config('app.asset_strategy_record_write','',true);
  perform set_config('app.asset_strategy_agent_run_write','',true);
  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Asset strategy for '||coalesce(a.tag,a.name),
    last_action='Generated a governed asset-strategy assessment',
    recommendations_generated=coalesce(recommendations_generated,0)+1
  where id=ag.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(p_organization_id,'asset_strategy_assessment',v_role,jsonb_build_object(
    'action','generated','assessment_id',v_assessment,'agent_run_id',v_run,
    'maintenance_plan_id',p.id,'asset_id',a.id,'plan_version',p.version,
    'kernel_version',p_kernel_version,'recommendation_kind',v_recommendation->>'kind',
    'requested_by',p_actor_id,'advisory',true));
  return jsonb_build_object('assessment_id',v_assessment,'run_id',v_run,
    'plan_id',p.id,'asset_id',a.id,'plan_version',p.version,
    'kernel_version',p_kernel_version,'analysis',p_result,
    'advisory',true,'may_change_pm_interval',false,'may_deactivate_task',false,
    'may_approve_strategy',false,'may_create_work',false,'may_accept_risk',false,
    'may_commit_spend',false,'may_return_to_service',false);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error','asset-strategy result contains an invalid numeric value');
end $$;
revoke all on function public.record_asset_strategy_run(uuid,uuid,uuid,integer,bigint[],text,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_asset_strategy_run(uuid,uuid,uuid,integer,bigint[],text,jsonb)
  to service_role;

create or replace function public.assign_asset_strategy_review(
  p_assessment_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_reviewer_role text;
  a public.asset_strategy_assessments%rowtype; v_id uuid;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','assigning asset-strategy review requires a named reliability engineer, maintenance manager or administrator');
  end if;
  select * into a from public.asset_strategy_assessments
  where id=p_assessment_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','asset-strategy assessment not found'); end if;
  select role into v_reviewer_role from public.user_profiles
  where id=p_assigned_to and organization_id=v_org;
  if coalesce(v_reviewer_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','review must be assigned to a named reliability engineer or administrator in this organization');
  end if;
  if p_assigned_to=a.created_by then
    return jsonb_build_object('error','segregation of duties requires a reviewer other than the person who requested the assessment');
  end if;
  if p_due_date is null or p_due_date<current_date
     or coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','record a current/future due date and review note of at least 10 characters');
  end if;
  perform set_config('app.asset_strategy_record_write','granted',true);
  insert into public.asset_strategy_review_assignments
    (organization_id,assessment_id,assigned_to,due_date,assignment_note,assigned_by)
  values(v_org,a.id,p_assigned_to,p_due_date,btrim(p_note),auth.uid()) returning id into v_id;
  perform set_config('app.asset_strategy_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_strategy_review',v_role,jsonb_build_object(
    'action','assigned','assignment_id',v_id,'assessment_id',a.id,
    'assigned_to',p_assigned_to,'assigned_by',auth.uid(),'due_date',p_due_date));
  return jsonb_build_object('assignmentId',v_id,'assessmentId',a.id,
    'assignedTo',p_assigned_to,'dueDate',p_due_date);
exception when unique_violation then
  return jsonb_build_object('error','this reviewer is already assigned to the assessment');
end $$;
revoke all on function public.assign_asset_strategy_review(uuid,uuid,date,text) from public,anon;
grant execute on function public.assign_asset_strategy_review(uuid,uuid,date,text) to authenticated;

create or replace function public.adopt_asset_strategy_assessment(
  p_assessment_id uuid,p_action text,p_horizon_years integer,
  p_objective text,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text;
  s public.asset_strategy_assessments%rowtype; p public.maintenance_plans%rowtype;
  v_kind text; v_basis text; v_value numeric; v_strategy text;
  v_lifecycle_version integer; v_lifecycle uuid; v_applied boolean:=false;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','authentication required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('reliability_engineer','admin') then
    return jsonb_build_object('error','adopting asset strategy requires a named reliability engineer or administrator');
  end if;
  if p_action not in ('apply_recommended','retain_current','defer') then
    return jsonb_build_object('error','action must be apply_recommended, retain_current or defer');
  end if;
  if p_horizon_years is null or p_horizon_years not between 1 and 30
     or coalesce(length(btrim(p_objective)),0)<20
     or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','record a 1–30 year horizon, lifecycle objective and adoption note of at least 20 characters');
  end if;
  select * into s from public.asset_strategy_assessments
  where id=p_assessment_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','asset-strategy assessment not found'); end if;
  if s.created_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires adoption by a named human other than the assessment requester');
  end if;
  if not exists(select 1 from public.asset_strategy_review_assignments r
    where r.assessment_id=s.id and r.organization_id=v_org and r.assigned_to=auth.uid()) then
    return jsonb_build_object('error','this named human is not assigned to review the assessment');
  end if;
  if not exists(select 1 from public.decision_rights d where d.right_key='change_pm_interval'
    and d.tier='approval' and d.enforcement='enforced'
    and d.required_authority='reliability_engineer') then
    return jsonb_build_object('error','the change_pm_interval decision right is not enforced as configured');
  end if;
  -- One asset can have several maintenance plans.  Lock the canonical asset
  -- before its plan so concurrent adoptions on different tasks cannot choose
  -- the same next lifecycle-plan version.
  perform 1 from public.assets a
  where a.id=s.asset_id and a.organization_id=v_org for update;
  if not found then return jsonb_build_object('error','asset not found'); end if;
  select * into p from public.maintenance_plans
  where id=s.maintenance_plan_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','maintenance plan not found'); end if;
  if p.version<>s.plan_version then
    return jsonb_build_object('error','maintenance plan changed after assessment; run a new assessment against the current version');
  end if;
  if exists(select 1 from public.asset_lifecycle_plans l where l.source_assessment_id=s.id) then
    return jsonb_build_object('error','this assessment already has an adopted lifecycle-plan version');
  end if;
  v_kind:=s.recommendation->>'kind';
  if p_action='apply_recommended' then
    if v_kind in ('interval_change','inspection_interval') then
      v_basis:=s.recommendation->>'proposedIntervalBasis';
      v_value:=(s.recommendation->>'proposedIntervalValue')::numeric;
      v_strategy:=case when v_kind='inspection_interval' then 'condition_based' else 'time_based_pm' end;
      if v_basis not in ('calendar_days','run_hours') or coalesce(v_value,0)<=0 then
        return jsonb_build_object('error','assessment carries no valid interval to adopt');
      end if;
      update public.maintenance_plans set interval_basis=v_basis,interval_value=v_value,
        strategy_kind=v_strategy,active=true,version=version+1,updated_at=now(),
        source=format('Human-approved assessment %s: %s',s.id,btrim(p_note)),
        engineering_context_updated_by=auth.uid() where id=p.id;
      v_applied:=true;
    elsif v_kind='run_to_failure_review' then
      if p.safety_critical is distinct from false or p.regulatory_required is distinct from false then
        return jsonb_build_object('error','run-to-failure cannot be adopted when safety or regulatory applicability is true or unknown');
      end if;
      update public.maintenance_plans set strategy_kind='run_to_failure',active=false,
        version=version+1,updated_at=now(),
        source=format('Human-approved assessment %s: %s',s.id,btrim(p_note)),
        engineering_context_updated_by=auth.uid() where id=p.id;
      v_applied:=true;
    else
      return jsonb_build_object('error','assessment contains no executable programme recommendation; retain, defer or supply the missing evidence');
    end if;
  end if;
  select coalesce(max(version),0)+1 into v_lifecycle_version
  from public.asset_lifecycle_plans where organization_id=v_org and asset_id=s.asset_id;
  perform set_config('app.asset_strategy_record_write','granted',true);
  insert into public.asset_lifecycle_plans
    (organization_id,asset_id,maintenance_plan_id,source_assessment_id,version,
     horizon_years,objective,adopted_action,adopted_strategy,adoption_note,adopted_by)
  values(v_org,s.asset_id,p.id,s.id,v_lifecycle_version,p_horizon_years,
    btrim(p_objective),p_action,jsonb_build_object(
      'recommendation',s.recommendation,'analysis',s.analysis,
      'programmeChanged',v_applied,'resultingPlanVersion',p.version+case when v_applied then 1 else 0 end),
    btrim(p_note),auth.uid()) returning id into v_lifecycle;
  perform set_config('app.asset_strategy_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'asset_strategy_adoption',v_role,jsonb_build_object(
    'action',p_action,'assessment_id',s.id,'maintenance_plan_id',p.id,
    'asset_id',s.asset_id,'recommendation_kind',v_kind,
    'programme_changed',v_applied,'lifecycle_plan_id',v_lifecycle,
    'lifecycle_plan_version',v_lifecycle_version,'adopted_by',auth.uid(),
    'decision_right','change_pm_interval','note',btrim(p_note)));
  return jsonb_build_object('assessmentId',s.id,'action',p_action,
    'programmeChanged',v_applied,'maintenancePlanId',p.id,
    'maintenancePlanVersion',p.version+case when v_applied then 1 else 0 end,
    'lifecyclePlanId',v_lifecycle,'lifecyclePlanVersion',v_lifecycle_version,
    'authority','Named-human adoption recorded. Work creation, risk acceptance, expenditure, operating limits and return-to-service remain separate authorities.');
exception when unique_violation then
  return jsonb_build_object('error','this assessment already has an adopted lifecycle-plan version');
when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('error','assessment contains an invalid interval value');
end $$;
revoke all on function public.adopt_asset_strategy_assessment(uuid,text,integer,text,text)
  from public,anon;
grant execute on function public.adopt_asset_strategy_assessment(uuid,text,integer,text,text)
  to authenticated;

create or replace function public.get_asset_strategy_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'plans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'assetId',p.asset_id,'assetName',a.name,'assetTag',coalesce(a.tag,a.asset_tag),
      'assetClass',a.asset_class,'taskCode',p.task_code,'taskLabel',p.task_label,
      'intervalBasis',p.interval_basis,'intervalValue',p.interval_value,'active',p.active,
      'source',p.source,'componentScope',p.component_scope,'failureMode',p.failure_mode,
      'strategyKind',p.strategy_kind,'plannedTaskCostUsd',p.planned_task_cost_usd,
      'failureConsequenceCostUsd',p.failure_consequence_cost_usd,'costBasis',p.cost_basis,
      'safetyCritical',p.safety_critical,'regulatoryRequired',p.regulatory_required,
      'lifecycleObjective',p.lifecycle_objective,'version',p.version,'updatedAt',p.updated_at)
      order by a.name,p.task_label)
      from public.maintenance_plans p left join public.assets a on a.id=p.asset_id
      where p.organization_id=public.app_current_org()),'[]'::jsonb),
    'assessments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'planId',s.maintenance_plan_id,'assetId',s.asset_id,
      'assetName',a.name,'taskLabel',p.task_label,'planVersion',s.plan_version,
      'kernelVersion',s.kernel_version,'sourceEventIds',s.source_event_ids,
      'analysis',s.analysis,'recommendation',s.recommendation,
      'limitations',s.limitations,'createdBy',s.created_by,'createdAt',s.created_at,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,
        'assignedTo',r.assigned_to,'reviewerName',u.full_name,'reviewerEmail',u.email,
        'dueDate',r.due_date,'note',r.assignment_note,'assignedAt',r.assigned_at)
        order by r.assigned_at) from public.asset_strategy_review_assignments r
        left join public.user_profiles u on u.id=r.assigned_to where r.assessment_id=s.id),'[]'::jsonb))
      order by s.created_at desc)
      from public.asset_strategy_assessments s
      join public.maintenance_plans p on p.id=s.maintenance_plan_id
      join public.assets a on a.id=s.asset_id
      where s.organization_id=public.app_current_org()),'[]'::jsonb),
    'lifecyclePlans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'assetId',l.asset_id,'assetName',a.name,'maintenancePlanId',l.maintenance_plan_id,
      'sourceAssessmentId',l.source_assessment_id,'version',l.version,
      'horizonYears',l.horizon_years,'objective',l.objective,
      'adoptedAction',l.adopted_action,'adoptedStrategy',l.adopted_strategy,
      'adoptionNote',l.adoption_note,'adoptedBy',l.adopted_by,'adoptedAt',l.adopted_at)
      order by l.adopted_at desc)
      from public.asset_lifecycle_plans l join public.assets a on a.id=l.asset_id
      where l.organization_id=public.app_current_org()),'[]'::jsonb),
    'reviewers',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name,
      'email',u.email,'role',u.role) order by coalesce(u.full_name,u.email))
      from public.user_profiles u where u.organization_id=public.app_current_org()
        and u.role in ('reliability_engineer','admin')),'[]'::jsonb),
    'basis','The workspace composes the canonical maintenance programme with exact component-life, adopted P-F, economics and lifecycle evidence. The controlled calculation service runs the shared kernels; the agent only proposes. A separately assigned named reliability engineer owns any programme change and immutable lifecycle-plan version.');
$$;
revoke all on function public.get_asset_strategy_workspace() from public,anon;
grant execute on function public.get_asset_strategy_workspace() to authenticated;

comment on table public.asset_strategy_assessments is
  'C1.10 immutable Asset Strategy Specialist assessments from exact canonical PM-programme evidence. Advisory only.';
comment on table public.asset_lifecycle_plans is
  'C1.10 immutable named-human lifecycle-plan versions adopted from governed asset-strategy assessments.';
comment on function public.adopt_asset_strategy_assessment(uuid,text,integer,text,text) is
  'C1.10/C5.10 enforced human adoption: optimistic locking, assigned review, separation of duties and fail-closed run-to-failure screening.';

notify pgrst,'reload schema';
