-- ============================================================================
-- C1.01 — governed Maintenance Executive agent.
--
-- The agent prepares a retained enterprise briefing from the canonical KPI,
-- governance, budget, risk and asset-strategy records. It is advisory only:
-- it cannot approve a recommendation, accept risk, alter strategy, commit
-- spend, release work, change an operating limit or return equipment to
-- service. Missing source records remain named gaps, never favourable facts.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values(
  'prepare_executive_briefing','Prepare executive maintenance briefing',
  'Freeze tenant-scoped performance, governance, budget, risk and strategy evidence into a reviewable executive briefing without exercising decision authority.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'maintenance_executive','Maintenance Executive','strategic','active','advisory',
  'Waiting for a governed enterprise maintenance briefing','Accountable Executive'
from public.organizations o
where not exists(select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='maintenance_executive');

update public.ai_agents
set name='Maintenance Executive',category='strategic',status='active',
  autonomy_mode='advisory',supervisor='Accountable Executive',
  operating_charter=jsonb_build_object(
    'purpose','Turn exact enterprise maintenance performance, governance, budget, risk and strategy evidence into a retained briefing for named-human review.',
    'modes',jsonb_build_array('enterprise performance','governance','budgets','risk','strategy'),
    'triggers',jsonb_build_array('executive review request','KPI breach','unowned risk','budget evidence gap','strategy evidence gap'),
    'inputs',jsonb_build_array('KPI catalog and latest values','approval and agent-control posture','budget lines and expenditure commitments','ISO 31000 risk register','asset-strategy assessments and adopted lifecycle plans'),
    'outputs',jsonb_build_array('immutable source fingerprints','enterprise facts','explicit evidence gaps','named-human review receipt'),
    'guardrails',jsonb_build_array(
      'Never invent a KPI value, target, budget, forecast, risk, owner, strategy or approval',
      'Never treat absent data as passing or aggregate different currencies into one amount',
      'Never approve its own briefing or create an approval implicitly',
      'Never accept risk, adopt strategy, commit spend, release work, change limits or return equipment to service'),
    'routes',jsonb_build_array('/executive','/risk','/asset-strategy','/approvals')
  )
where key='maintenance_executive';

do $$ begin
  if not exists(select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_maintenance_executive_charter_shape') then
    alter table public.ai_agents add constraint ai_agents_maintenance_executive_charter_shape
      check(key<>'maintenance_executive' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Upgrade only the untouched platform baseline. Customer-authored agent
-- control history is never silently replaced by a migration.
do $$
declare r record; v_profile uuid; v_version integer;
  v_basis constant text :=
    'Platform advisory baseline: pending drafts only; accountable human approval remains mandatory.';
begin
  for r in
    select a.id agent_id,a.organization_id,p.id old_profile,p.basis old_basis,
      p.proposal_risk_ceiling,p.proposal_cost_ceiling_usd,
      p.proposal_downtime_ceiling_hours
    from public.ai_agents a
    left join public.agent_control_profiles p
      on p.agent_id=a.id and p.organization_id=a.organization_id and p.status='adopted'
    where a.key='maintenance_executive'
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
    values(r.organization_id,r.agent_id,'advisory_only','executive',
      coalesce(r.proposal_risk_ceiling,'High'),
      coalesce(r.proposal_cost_ceiling_usd,0),
      coalesce(r.proposal_downtime_ceiling_hours,0),false,
      v_basis,'draft',v_version,null)
    returning id into v_profile;
    insert into public.agent_decision_right_bindings
      (organization_id,profile_id,agent_id,decision_right_id)
    select r.organization_id,v_profile,r.agent_id,d.id
    from public.decision_rights d where d.right_key='generate_meeting_packs';
    insert into public.agent_tool_bindings
      (organization_id,profile_id,agent_id,tool_id)
    select r.organization_id,v_profile,r.agent_id,t.id
    from public.agent_software_tools t
    where t.tool_key in ('prepare_executive_briefing','draft_recommendation');
    update public.agent_control_profiles set status='adopted',adopted_at=now()
    where id=v_profile;
  end loop;
end $$;

-- An executive run is scoped to its organization, not an arbitrary asset or
-- site. The boolean is provenance carried by the retained agent-run row; the
-- row's existing organization FK and tenant checks define the scope.
alter table public.agent_runs
  add column if not exists executive_scope boolean not null default false;
create index if not exists idx_agent_runs_retained_executive
  on public.agent_runs(organization_id,created_at desc)
  where retained_for_governance and executive_scope;

create table if not exists public.maintenance_executive_briefings(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  as_of timestamptz not null,
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  performance jsonb not null check(jsonb_typeof(performance)='object'),
  governance jsonb not null check(jsonb_typeof(governance)='object'),
  budgets jsonb not null check(jsonb_typeof(budgets)='object'),
  risks jsonb not null check(jsonb_typeof(risks)='object'),
  strategy jsonb not null check(jsonb_typeof(strategy)='object'),
  evidence_gaps jsonb not null check(jsonb_typeof(evidence_gaps)='array'),
  limitations jsonb not null check(jsonb_typeof(limitations)='array'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists idx_maintenance_executive_briefings_org
  on public.maintenance_executive_briefings(organization_id,created_at desc);

create table if not exists public.maintenance_executive_review_assignments(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  briefing_id uuid not null references public.maintenance_executive_briefings(id) on delete restrict,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  due_date date not null,
  assignment_note text not null check(length(btrim(assignment_note)) between 10 and 2000),
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique(briefing_id,assigned_to)
);

create table if not exists public.maintenance_executive_acknowledgements(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  briefing_id uuid not null references public.maintenance_executive_briefings(id) on delete restrict,
  disposition text not null check(disposition in ('acknowledged','challenged','update_requested')),
  review_note text not null check(length(btrim(review_note)) between 20 and 4000),
  evidence_reference text,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  unique(briefing_id,reviewed_by)
);

alter table public.maintenance_executive_briefings enable row level security;
alter table public.maintenance_executive_review_assignments enable row level security;
alter table public.maintenance_executive_acknowledgements enable row level security;
drop policy if exists maintenance_executive_briefings_read on public.maintenance_executive_briefings;
create policy maintenance_executive_briefings_read on public.maintenance_executive_briefings
  for select to authenticated using(
    organization_id=public.app_current_org()
    and public.app_current_role() in ('executive','admin'));
drop policy if exists maintenance_executive_reviews_read on public.maintenance_executive_review_assignments;
create policy maintenance_executive_reviews_read on public.maintenance_executive_review_assignments
  for select to authenticated using(
    organization_id=public.app_current_org()
    and public.app_current_role() in ('executive','admin'));
drop policy if exists maintenance_executive_acknowledgements_read on public.maintenance_executive_acknowledgements;
create policy maintenance_executive_acknowledgements_read on public.maintenance_executive_acknowledgements
  for select to authenticated using(
    organization_id=public.app_current_org()
    and public.app_current_role() in ('executive','admin'));
revoke insert,update,delete,truncate on public.maintenance_executive_briefings,
  public.maintenance_executive_review_assignments,
  public.maintenance_executive_acknowledgements from public,anon,authenticated,service_role;
grant select on public.maintenance_executive_briefings,
  public.maintenance_executive_review_assignments,
  public.maintenance_executive_acknowledgements to authenticated;

create or replace function public.protect_maintenance_executive_records()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='TRUNCATE' then
    raise exception 'maintenance-executive evidence cannot be truncated';
  end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'maintenance-executive briefings, assignments and acknowledgements are append-only';
  end if;
  if coalesce(current_setting('app.maintenance_executive_record_write',true),'')<>'granted' then
    raise exception 'maintenance-executive records are written only by governed workflows';
  end if;
  if tg_table_name='maintenance_executive_briefings' and not exists(
    select 1 from public.agent_runs r
    join public.ai_agents a on a.id=r.agent_id and a.organization_id=r.organization_id
    join public.user_profiles u on u.id=new.created_by and u.organization_id=r.organization_id
    where r.id=new.agent_run_id and r.organization_id=new.organization_id
      and r.requested_by=new.created_by
      and r.executive_scope and r.retained_for_governance
      and a.key='maintenance_executive') then
    raise exception 'executive briefing provenance crosses its organization or governed agent run';
  end if;
  if tg_table_name='maintenance_executive_review_assignments' and not exists(
    select 1 from public.maintenance_executive_briefings b
    join public.user_profiles reviewer on reviewer.id=new.assigned_to
      and reviewer.organization_id=b.organization_id
      and reviewer.role in ('executive','admin')
    join public.user_profiles assigner on assigner.id=new.assigned_by
      and assigner.organization_id=b.organization_id
      and assigner.role in ('executive','admin')
    where b.id=new.briefing_id and b.organization_id=new.organization_id
      and new.assigned_to<>b.created_by) then
    raise exception 'executive review assignment crosses its organization or named-human authority';
  end if;
  if tg_table_name='maintenance_executive_acknowledgements' and not exists(
    select 1 from public.maintenance_executive_briefings b
    join public.user_profiles reviewer on reviewer.id=new.reviewed_by
      and reviewer.organization_id=b.organization_id
      and reviewer.role in ('executive','admin')
    join public.maintenance_executive_review_assignments assignment
      on assignment.briefing_id=b.id
      and assignment.organization_id=b.organization_id
      and assignment.assigned_to=new.reviewed_by
    where b.id=new.briefing_id and b.organization_id=new.organization_id
      and new.reviewed_by<>b.created_by) then
    raise exception 'executive review receipt crosses its organization or named-human authority';
  end if;
  return new;
end $$;
revoke all on function public.protect_maintenance_executive_records() from public,anon,authenticated;
drop trigger if exists trg_protect_maintenance_executive_briefings on public.maintenance_executive_briefings;
create trigger trg_protect_maintenance_executive_briefings before insert or update or delete
  on public.maintenance_executive_briefings for each row execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_reviews on public.maintenance_executive_review_assignments;
create trigger trg_protect_maintenance_executive_reviews before insert or update or delete
  on public.maintenance_executive_review_assignments for each row execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_acknowledgements on public.maintenance_executive_acknowledgements;
create trigger trg_protect_maintenance_executive_acknowledgements before insert or update or delete
  on public.maintenance_executive_acknowledgements for each row execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_briefings_truncate on public.maintenance_executive_briefings;
create trigger trg_protect_maintenance_executive_briefings_truncate before truncate
  on public.maintenance_executive_briefings for each statement execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_reviews_truncate on public.maintenance_executive_review_assignments;
create trigger trg_protect_maintenance_executive_reviews_truncate before truncate
  on public.maintenance_executive_review_assignments for each statement execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_acknowledgements_truncate on public.maintenance_executive_acknowledgements;
create trigger trg_protect_maintenance_executive_acknowledgements_truncate before truncate
  on public.maintenance_executive_acknowledgements for each statement execute function public.protect_maintenance_executive_records();

-- Preserve every previously governed retained-run path while adding the
-- organization-wide executive scope.
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
  v_data_marker text:=coalesce(current_setting('app.data_steward_agent_run_write',true),'');
  v_executive_marker text:=coalesce(current_setting('app.maintenance_executive_agent_run_write',true),'');
  v_allowed boolean:=v_planner_marker='granted' or v_site_marker='granted'
    or v_reliability_marker='granted' or v_fracas_marker='granted'
    or v_condition_marker='granted' or v_mro_marker='granted'
    or v_turnaround_marker='granted' or v_strategy_marker='granted'
    or v_data_marker='granted' or v_executive_marker='granted';
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
          and new.outage_window_id is null and new.data_domain_id is null
          and not new.executive_scope)
      or new.agent_control_profile_id is null
      or coalesce(btrim(new.agent_tool_key),'')=''
      or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset/material/outage/data-domain/executive scope, control profile, tool and decision-right provenance';
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
    if new.data_domain_id is not null and not exists(select 1 from public.data_domains d
      where d.id=new.data_domain_id and d.organization_id=new.organization_id) then
      raise exception 'agent run names a data domain outside its organization';
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
    if new.executive_scope and not exists(select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id
        and a.key='maintenance_executive') then
      raise exception 'executive scope is reserved for the governed Maintenance Executive agent';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.sync_maintenance_executive_source_snapshot(p_org uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with latest_kpi as (
    select distinct on(v.kpi_key) v.* from public.kpi_values v
    where v.organization_id=p_org order by v.kpi_key,v.computed_at desc,v.id desc
  )
  select jsonb_build_object(
    'capturedAt',now(),
    'kpis',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'key',c.kpi_key,'computable',c.computable,'sourceNote',c.source_note,
        'value',v.value,'status',v.status,'computedAt',v.computed_at)::text,
        '|' order by c.kpi_key),'empty'),'sha256'),'hex'))
      from public.kpi_catalog c left join latest_kpi v on v.kpi_key=c.kpi_key),
    'budgets',(select jsonb_build_object('count',count(*),
      'currencyStatus','not_recorded_by_budget_lines','sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'year',budget_year,'site',site_id,'category',category,
        'budgeted',budgeted,'committed',committed,'actual',actual,
        'forecast',forecast,'basis',forecast_basis)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.budget_lines where organization_id=p_org),
    'expenditure',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'amount',amount,'currency',currency,'status',status,
        'approval',approval_id,'requestedAt',requested_at,'decidedAt',decided_at)::text,
        '|' order by id),'empty'),'sha256'),'hex'))
      from public.expenditure_commitments where organization_id=p_org),
    'risks',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'level',current_risk_level,'score',current_risk_score,
        'residualLevel',residual_risk_level,'residualScore',residual_risk_score,
        'owner',risk_owner_id,'decisionOwner',decision_owner_id,'reviewDate',review_date)::text,
        '|' order by id),'empty'),'sha256'),'hex'))
      from public.risks where organization_id=p_org
        and status not in ('closed','archived') and public.can_read_risk(id)),
    'governance',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'status',status,'ownerRole',owner_role,'recommendation',recommendation_id,
        'workOrder',work_order_id,'decidedAt',decided_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.approvals where organization_id=p_org),
    'agentControls',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'agent',agent_id,'mode',authority_mode,'role',required_human_approver_role,
        'status',status,'version',version)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.agent_control_profiles where organization_id=p_org),
    'strategy',(select jsonb_build_object(
      'assessments',(select count(*) from public.asset_strategy_assessments where organization_id=p_org),
      'lifecyclePlans',(select count(*) from public.asset_lifecycle_plans where organization_id=p_org),
      'sha256',encode(extensions.digest(
        coalesce((select string_agg(jsonb_build_object('id',id,'asset',asset_id,
          'planVersion',plan_version,'createdAt',created_at)::text,'|' order by id)
          from public.asset_strategy_assessments where organization_id=p_org),'empty')||'|'||
        coalesce((select string_agg(jsonb_build_object('id',id,'asset',asset_id,
          'version',version,'action',adopted_action,'adoptedAt',adopted_at)::text,
          '|' order by id) from public.asset_lifecycle_plans where organization_id=p_org),'empty'),
        'sha256'),'hex'))
  ))
$$;
revoke all on function public.sync_maintenance_executive_source_snapshot(uuid)
  from public,anon,authenticated;

create or replace function public.run_maintenance_executive_agent()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_agent public.ai_agents%rowtype; v_control jsonb; v_snapshot jsonb;
  v_performance jsonb; v_governance jsonb; v_budgets jsonb; v_risks jsonb;
  v_strategy jsonb; v_gaps jsonb:='[]'::jsonb; v_run uuid; v_briefing uuid;
  v_budget_count bigint; v_risk_count bigint; v_strategy_count bigint;
  v_uncomputable bigint; v_missing_risk_owners bigint;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  if coalesce(v_role,'') not in ('executive','admin','ai_admin') then
    return jsonb_build_object('error','running the Maintenance Executive agent requires a named executive or administrator, or the governed automation identity');
  end if;
  select * into v_agent from public.ai_agents
  where organization_id=v_org and key='maintenance_executive' order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Maintenance Executive agent is configured'); end if;
  v_control:=public.evaluate_agent_control_internal(v_org,v_agent.id,
    'generate_meeting_packs','prepare_executive_briefing','High',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Maintenance Executive refused: '||(v_control->>'reason'));
  end if;

  with latest as(select distinct on(kpi_key) * from public.kpi_values
    where organization_id=v_org order by kpi_key,computed_at desc,id desc)
  select jsonb_build_object(
    'catalogCount',(select count(*) from public.kpi_catalog),
    'latestMeasured',count(*),'breaches',count(*) filter(where status='breach'),
    'watch',count(*) filter(where status='watch'),
    'latestComputedAt',max(computed_at)) into v_performance from latest;
  select count(*) into v_uncomputable from public.kpi_catalog where not computable;
  v_performance:=v_performance||jsonb_build_object('awaitingSource',v_uncomputable);

  select jsonb_build_object(
    'pendingApprovals',count(*) filter(where status in ('required','pending')),
    'decidedApprovals',count(*) filter(where status in ('approved','rejected')),
    'adoptedAgentProfiles',(select count(*) from public.agent_control_profiles
      where organization_id=v_org and status='adopted'),
    'agentsWithoutAdoptedProfile',(select count(*) from public.ai_agents a
      where a.organization_id=v_org and not exists(select 1 from public.agent_control_profiles p
        where p.agent_id=a.id and p.status='adopted')))
  into v_governance from public.approvals where organization_id=v_org;

  select count(*) into v_budget_count from public.budget_lines where organization_id=v_org;
  select jsonb_build_object(
    'lineCount',v_budget_count,
    'currencyStatus','not_recorded_by_budget_lines',
    'byYear',coalesce((select jsonb_agg(x order by x.budget_year) from(
      select budget_year,count(*) line_count,
        count(*) filter(where forecast is null) forecast_missing
      from public.budget_lines where organization_id=v_org group by budget_year)x),'[]'::jsonb),
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'year',budget_year,'site',site_id,'category',category,
      'budgeted',budgeted,'committed',committed,'actual',actual,
      'forecast',forecast,'forecastBasis',forecast_basis,'currency',null)
      order by budget_year,id) from public.budget_lines where organization_id=v_org),'[]'::jsonb),
    'expenditureByCurrency',coalesce((select jsonb_agg(x order by x.currency) from(
      select currency,count(*) commitments,
        sum(amount) filter(where status='pending') pending,
        sum(amount) filter(where status='approved') approved,
        sum(amount) filter(where status='rejected') rejected
      from public.expenditure_commitments where organization_id=v_org group by currency)x),'[]'::jsonb))
  into v_budgets;

  select count(*),count(*) filter(where risk_owner_id is null or decision_owner_id is null)
    into v_risk_count,v_missing_risk_owners from public.risks
    where organization_id=v_org and status not in ('closed','archived')
      and public.can_read_risk(id);
  select jsonb_build_object(
    'riskCount',v_risk_count,
    'criticalOrHigh',count(*) filter(where current_risk_level in ('Critical','High')),
    'criticalOrHighResidual',count(*) filter(where residual_risk_level in ('Critical','High')),
    'missingOwners',v_missing_risk_owners,
    'missingCurrentScore',count(*) filter(where current_risk_score is null),
    'overdueReview',count(*) filter(where review_date<current_date),
    'valueAtRiskByCurrency',coalesce((select jsonb_agg(x order by x.currency) from(
      select value_currency currency,sum(value_at_risk) value_at_risk
      from public.risks where organization_id=v_org
        and status not in ('closed','archived') and public.can_read_risk(id)
        and value_at_risk is not null
      group by value_currency)x),'[]'::jsonb)) into v_risks
  from public.risks where organization_id=v_org
    and status not in ('closed','archived') and public.can_read_risk(id);

  select count(*) into v_strategy_count from public.asset_strategy_assessments
  where organization_id=v_org;
  select jsonb_build_object(
    'assessments',v_strategy_count,
    'adoptedLifecyclePlans',(select count(*) from public.asset_lifecycle_plans where organization_id=v_org),
    'assetsAssessed',(select count(distinct asset_id) from public.asset_strategy_assessments where organization_id=v_org),
    'assetsWithAdoptedPlan',(select count(distinct asset_id) from public.asset_lifecycle_plans where organization_id=v_org),
    'pendingStrategyRecommendations',(select count(*) from public.asset_maintenance_strategy_recommendations
      where organization_id=v_org and coalesce(status,'pending')='pending')) into v_strategy;

  if (v_performance->>'latestMeasured')::bigint=0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','kpi_snapshot_missing','area','performance','route','/executive','humanActionRequired',true));
  end if;
  if v_uncomputable>0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','kpi_sources_missing','area','performance','count',v_uncomputable,'route','/integrations','humanActionRequired',true));
  end if;
  if v_budget_count=0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','budget_evidence_missing','area','budgets','route','/value','humanActionRequired',true));
  else
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','budget_currency_missing','area','budgets','count',v_budget_count,'route','/value','humanActionRequired',true,
      'note','Canonical budget lines do not record currency, so their amounts are preserved per line and never combined into a monetary total.'));
  end if;
  if v_risk_count=0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','risk_register_empty','area','risk','route','/risk','humanActionRequired',true));
  elsif v_missing_risk_owners>0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','risk_owners_missing','area','risk','count',v_missing_risk_owners,'route','/risk','humanActionRequired',true));
  end if;
  if v_strategy_count=0 then
    v_gaps:=v_gaps||jsonb_build_array(jsonb_build_object('key','strategy_assessments_missing','area','strategy','route','/asset-strategy','humanActionRequired',true));
  end if;
  if jsonb_array_length(v_gaps)=0 then
    v_gaps:=jsonb_build_array(jsonb_build_object('key','no_current_evidence_gap','area','enterprise','route','/executive','humanActionRequired',true,
      'note','No gap is visible in the recorded sources; this is not certification of completeness or fitness.'));
  end if;

  v_snapshot:=public.sync_maintenance_executive_source_snapshot(v_org);
  perform set_config('app.maintenance_executive_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,status,summary,confidence,
    started_at,completed_at,requested_by,executive_scope,agent_control_profile_id,
    agent_tool_key,agent_decision_right_key,input_snapshot,result,retained_for_governance)
  values(v_org,v_agent.id,'completed',
    'Prepared an immutable executive maintenance briefing from canonical enterprise evidence without decision authority.',
    null,now(),now(),auth.uid(),true,(v_control->>'profile_id')::uuid,
    'prepare_executive_briefing','generate_meeting_packs',v_snapshot,
    jsonb_build_object('performance',v_performance,'governance',v_governance,
      'budgets',v_budgets,'risks',v_risks,'strategy',v_strategy,
      'evidenceGaps',v_gaps,'advisory',true,'mayApprove',false,
      'mayAcceptRisk',false,'mayAdoptStrategy',false,'mayCommitSpend',false,
      'mayReleaseWork',false,'mayChangeOperatingLimits',false,
      'mayReturnToService',false),true) returning id into v_run;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_briefings(organization_id,agent_run_id,
    as_of,source_snapshot,performance,governance,budgets,risks,strategy,
    evidence_gaps,limitations,created_by)
  values(v_org,v_run,now(),v_snapshot,v_performance,v_governance,v_budgets,v_risks,
    v_strategy,v_gaps,jsonb_build_array(
      'The briefing describes only tenant records present at the captured fingerprints; absent external systems remain absent.',
      'KPI status is reproduced from the canonical KPI service; the agent does not create targets or verdicts.',
      'Budget-line amounts are preserved per line because the canonical budget table records no currency; they are never combined with currency-labelled expenditure or presented as a monetary total.',
      'Risk scores and owners are reported as recorded; the agent does not accept or close risk.',
      'Strategy assessment is not strategy adoption, and an acknowledged briefing is not an approval.',
      'The briefing cannot commit spend, release work, change limits or return equipment to service.'),auth.uid())
  returning id into v_briefing;
  perform set_config('app.maintenance_executive_record_write','',true);
  perform set_config('app.maintenance_executive_agent_run_write','',true);
  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Enterprise maintenance evidence briefing',
    last_action='Generated an immutable executive maintenance briefing',
    recommendations_generated=coalesce(recommendations_generated,0)+jsonb_array_length(v_gaps)
  where id=v_agent.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_executive_briefing',v_role,jsonb_build_object(
    'action','generated','briefing_id',v_briefing,'agent_run_id',v_run,
    'requested_by',auth.uid(),'evidence_gap_count',jsonb_array_length(v_gaps),
    'source_snapshot',v_snapshot,'advisory',true));
  return jsonb_build_object('briefingId',v_briefing,'runId',v_run,
    'performance',v_performance,'governance',v_governance,'budgets',v_budgets,
    'risks',v_risks,'strategy',v_strategy,'evidenceGaps',v_gaps,'advisory',true,
    'mayApprove',false,'mayAcceptRisk',false,'mayAdoptStrategy',false,
    'mayCommitSpend',false,'mayReleaseWork',false,
    'mayChangeOperatingLimits',false,'mayReturnToService',false);
exception when others then
  perform set_config('app.maintenance_executive_record_write','',true);
  perform set_config('app.maintenance_executive_agent_run_write','',true);
  raise;
end $$;
revoke all on function public.run_maintenance_executive_agent() from public,anon;
grant execute on function public.run_maintenance_executive_agent() to authenticated;

create or replace function public.assign_maintenance_executive_review(
  p_briefing_id uuid,p_assigned_to uuid,p_due_date date,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); b public.maintenance_executive_briefings%rowtype; v_id uuid;
begin
  if auth.uid() is null or coalesce(public.app_current_role(),'') not in
      ('executive','admin') then
    return jsonb_build_object('error','named human executive-review authority is required');
  end if;
  select * into b from public.maintenance_executive_briefings
  where id=p_briefing_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','briefing not found'); end if;
  if p_assigned_to=b.created_by then
    return jsonb_build_object('error','segregation of duties requires a reviewer other than the briefing requester');
  end if;
  if not exists(select 1 from public.user_profiles u where u.id=p_assigned_to
    and u.organization_id=v_org and u.role in
      ('executive','admin')) then
    return jsonb_build_object('error','reviewer must be a same-tenant named executive or administrator');
  end if;
  if p_due_date<current_date or coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','a current due date and review basis of at least 10 characters are required');
  end if;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_review_assignments(organization_id,
    briefing_id,assigned_to,due_date,assignment_note,assigned_by)
  values(v_org,b.id,p_assigned_to,p_due_date,btrim(p_note),auth.uid()) returning id into v_id;
  perform set_config('app.maintenance_executive_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_executive_review',public.app_current_role(),jsonb_build_object(
    'action','assigned','assignment_id',v_id,'briefing_id',b.id,
    'assigned_to',p_assigned_to,'assigned_by',auth.uid(),'due_date',p_due_date));
  return jsonb_build_object('assignmentId',v_id,'status','assigned');
exception when unique_violation then
  perform set_config('app.maintenance_executive_record_write','',true);
  return jsonb_build_object('error','this reviewer is already assigned to the briefing');
end $$;
revoke all on function public.assign_maintenance_executive_review(uuid,uuid,date,text)
  from public,anon;
grant execute on function public.assign_maintenance_executive_review(uuid,uuid,date,text)
  to authenticated;

create or replace function public.acknowledge_maintenance_executive_briefing(
  p_briefing_id uuid,p_disposition text,p_review_note text,
  p_evidence_reference text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); b public.maintenance_executive_briefings%rowtype; v_id uuid;
begin
  if auth.uid() is null or coalesce(public.app_current_role(),'') not in ('executive','admin') then
    return jsonb_build_object('error','named human executive-review authority is required');
  end if;
  select * into b from public.maintenance_executive_briefings
  where id=p_briefing_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','briefing not found'); end if;
  if b.created_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires acknowledgement by a different named human');
  end if;
  if not exists(select 1 from public.maintenance_executive_review_assignments r
    where r.briefing_id=b.id and r.organization_id=v_org and r.assigned_to=auth.uid()) then
    return jsonb_build_object('error','this named human is not assigned to review the briefing');
  end if;
  if p_disposition not in ('acknowledged','challenged','update_requested')
     or coalesce(length(btrim(p_review_note)),0)<20 then
    return jsonb_build_object('error','a valid disposition and review note of at least 20 characters are required');
  end if;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_acknowledgements(organization_id,
    briefing_id,disposition,review_note,evidence_reference,reviewed_by)
  values(v_org,b.id,p_disposition,btrim(p_review_note),
    nullif(btrim(p_evidence_reference),''),auth.uid()) returning id into v_id;
  perform set_config('app.maintenance_executive_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'maintenance_executive_acknowledgement',public.app_current_role(),
    jsonb_build_object('action','recorded','acknowledgement_id',v_id,
      'briefing_id',b.id,'disposition',p_disposition,'reviewed_by',auth.uid(),
      'operational_authorization',false,'approval_created',false));
  return jsonb_build_object('acknowledgementId',v_id,'status',p_disposition,
    'approvalCreated',false,'riskAccepted',false,'strategyAdopted',false,
    'spendCommitted',false,'operationalAuthorization',false);
exception when unique_violation then
  perform set_config('app.maintenance_executive_record_write','',true);
  return jsonb_build_object('error','this reviewer already recorded a disposition for the briefing');
end $$;
revoke all on function public.acknowledge_maintenance_executive_briefing(uuid,text,text,text)
  from public,anon;
grant execute on function public.acknowledge_maintenance_executive_briefing(uuid,text,text,text)
  to authenticated;

create or replace function public.get_maintenance_executive_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  if coalesce(public.app_current_role(),'') not in
      ('executive','admin') then
    return jsonb_build_object('error','executive maintenance workspace access requires an authorized named-human role');
  end if;
  return jsonb_build_object(
    'briefings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'agentRunId',b.agent_run_id,'asOf',b.as_of,
      'sourceSnapshot',b.source_snapshot,'performance',b.performance,
      'governance',b.governance,'budgets',b.budgets,'risks',b.risks,
      'strategy',b.strategy,'evidenceGaps',b.evidence_gaps,
      'limitations',b.limitations,'createdBy',b.created_by,'createdAt',b.created_at,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'assignedTo',r.assigned_to,'reviewerName',u.full_name,
        'reviewerEmail',u.email,'dueDate',r.due_date,'note',r.assignment_note,
        'assignedAt',r.assigned_at) order by r.assigned_at)
        from public.maintenance_executive_review_assignments r
        join public.user_profiles u on u.id=r.assigned_to
          and u.organization_id=r.organization_id
        where r.briefing_id=b.id and r.organization_id=v_org),'[]'::jsonb),
      'acknowledgements',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'disposition',a.disposition,'reviewNote',a.review_note,
        'evidenceReference',a.evidence_reference,'reviewedBy',a.reviewed_by,
        'reviewerName',u.full_name,'reviewedAt',a.reviewed_at) order by a.reviewed_at)
        from public.maintenance_executive_acknowledgements a
        join public.user_profiles u on u.id=a.reviewed_by
          and u.organization_id=a.organization_id
        where a.briefing_id=b.id and a.organization_id=v_org),'[]'::jsonb)) order by b.created_at desc)
      from public.maintenance_executive_briefings b where b.organization_id=v_org),'[]'::jsonb),
    'reviewers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',u.id,'name',u.full_name,'email',u.email,'role',u.role) order by u.full_name,u.email)
      from public.user_profiles u where u.organization_id=v_org and u.id<>auth.uid()
        and u.role in ('executive','admin')),'[]'::jsonb),
    'basis','Immutable advisory briefings from canonical performance, governance, budget, risk and strategy records; acknowledgement grants no decision or operational authority.')
  ;
end $$;
revoke all on function public.get_maintenance_executive_workspace() from public,anon;
grant execute on function public.get_maintenance_executive_workspace() to authenticated;
