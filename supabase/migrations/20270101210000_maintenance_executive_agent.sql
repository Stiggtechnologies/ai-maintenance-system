-- ============================================================================
-- C1.01 — governed Maintenance Executive Specialist.
--
-- The specialist assembles a dated enterprise decision brief from the existing
-- KPI, budget, risk, maintenance-strategy, recommendation, approval, outcome,
-- value, RACI and delegation records. It does not create a second scorecard or
-- workflow. Its facts are frozen with exact source-population fingerprints and
-- remain advisory until a different named human reviews the priorities.
-- ============================================================================

insert into public.agent_software_tools(tool_key,title,purpose,access_kind)
values (
  'assemble_maintenance_executive_brief','Assemble maintenance executive decision brief',
  'Fingerprint canonical enterprise performance, budget, risk, strategy, governance and verified-value records and assemble an advisory decision brief without approving, funding or executing any action.',
  'analyse')
on conflict(tool_key) do update set
  title=excluded.title,purpose=excluded.purpose,access_kind=excluded.access_kind;

insert into public.ai_agents
  (organization_id,key,name,category,status,autonomy_mode,current_task,supervisor)
select o.id,'maintenance_executive','Maintenance Executive Specialist','specialist',
       'active','advisory','Waiting for a governed enterprise briefing request',
       'Accountable Maintenance Executive'
from public.organizations o
where not exists (
  select 1 from public.ai_agents a
  where a.organization_id=o.id and a.key='maintenance_executive'
);

update public.ai_agents
set name='Maintenance Executive Specialist',category='specialist',status='active',
    autonomy_mode='advisory',supervisor='Accountable Maintenance Executive',
    operating_charter=jsonb_build_object(
      'purpose','Turn exact canonical enterprise performance, budget, risk, strategy, governance and outcome evidence into an immutable executive decision brief.',
      'modes',jsonb_build_array('enterprise performance','governance','budgets','risk','maintenance strategy','verified value'),
      'triggers',jsonb_build_array('human briefing request','KPI breach','budget exception','critical or overdue risk','strategy evidence gap','overdue outcome verification'),
      'inputs',jsonb_build_array('KPI catalog and values','budget lines','ISO 31000 risks','maintenance plans and asset-strategy assessments','recommendations and approvals','verification obligations and value metrics','RACI and authority limits'),
      'outputs',jsonb_build_array('immutable source fingerprint','dated executive facts','prioritized decision questions','limitations','independent review receipt'),
      'guardrails',jsonb_build_array(
        'Never invent a KPI, target, budget, forecast, risk score, strategy, benefit or authority limit',
        'Never sum unlike value units or present projected value as verified',
        'Never approve a recommendation, accept risk, commit spend, release work or change maintenance strategy',
        'Never treat missing source data as zero, compliant or on target',
        'Never review or approve its own brief'),
      'routes',jsonb_build_array('/executive','/mission-control','/risk','/reliability')
    )
where key='maintenance_executive';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_agents'::regclass
      and conname='ai_agents_maintenance_executive_charter_shape'
  ) then
    alter table public.ai_agents add constraint ai_agents_maintenance_executive_charter_shape
      check (key <> 'maintenance_executive' or operating_charter ?&
        array['purpose','modes','triggers','inputs','outputs','guardrails','routes']);
  end if;
end $$;

-- Extend only untouched platform advisory baselines. Tenant-authored control
-- history is not overwritten by a migration.
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
      coalesce(r.proposal_risk_ceiling,'Critical'),
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
    where t.tool_key in ('assemble_maintenance_executive_brief','read_work_context');
    update public.agent_control_profiles set status='adopted',adopted_at=now()
    where id=v_profile;
  end loop;
end $$;

-- An enterprise brief has a canonical organization scope. Reusing a random
-- site or asset would make a partial population look enterprise-wide.
alter table public.agent_runs
  add column if not exists organization_scope_id uuid
    references public.organizations(id) on delete restrict;
alter table public.agent_runs
  add column if not exists information_sensitivity text not null default 'internal';
alter table public.agent_runs
  drop constraint if exists agent_runs_information_sensitivity_check;
alter table public.agent_runs
  add constraint agent_runs_information_sensitivity_check check (
    information_sensitivity in ('public','internal','confidential','restricted')
  );
drop policy if exists agent_runs_org_rw on public.agent_runs;
drop policy if exists agent_runs_org_read on public.agent_runs;
create policy agent_runs_org_read on public.agent_runs
  for select to authenticated using (
    organization_id=public.app_current_org() and (
      information_sensitivity in ('public','internal')
      or (information_sensitivity='confidential' and coalesce(public.app_current_role(),'')
        in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer'))
      or (information_sensitivity='restricted' and coalesce(public.app_current_role(),'')
        in ('admin','ai_admin','executive'))
    )
  );
create index if not exists idx_agent_runs_retained_organization_scope
  on public.agent_runs(organization_id,organization_scope_id,created_at desc)
  where retained_for_governance;

create table if not exists public.maintenance_executive_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid not null unique references public.agent_runs(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  information_sensitivity text not null default 'internal' check (
    information_sensitivity in ('public','internal','confidential','restricted')
  ),
  source_snapshot jsonb not null,
  facts jsonb not null,
  priorities jsonb not null,
  limitations jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (period_end>=period_start),
  check (jsonb_typeof(source_snapshot)='object'),
  check (jsonb_typeof(facts)='object'),
  check (jsonb_typeof(priorities)='array'),
  check (jsonb_typeof(limitations)='array')
);
create index if not exists idx_maintenance_executive_briefs_org
  on public.maintenance_executive_briefs(organization_id,created_at desc);

create table if not exists public.maintenance_executive_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_id uuid not null references public.maintenance_executive_briefs(id) on delete restrict,
  assigned_to uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  due_date date not null,
  assignment_note text not null check (length(btrim(assignment_note))>=10),
  assigned_at timestamptz not null default now(),
  unique(brief_id,assigned_to)
);

create table if not exists public.maintenance_executive_dispositions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brief_id uuid not null references public.maintenance_executive_briefs(id) on delete restrict,
  priority_key text not null,
  disposition text not null check (disposition in
    ('acknowledged','route_for_action','deferred','rejected')),
  note text not null check (length(btrim(note))>=20),
  action_reference text,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default now(),
  unique(brief_id,priority_key),
  check (disposition<>'route_for_action'
    or length(btrim(coalesce(action_reference,'')))>=3)
);

alter table public.maintenance_executive_briefs enable row level security;
alter table public.maintenance_executive_review_assignments enable row level security;
alter table public.maintenance_executive_dispositions enable row level security;
drop policy if exists maintenance_executive_briefs_read on public.maintenance_executive_briefs;
create policy maintenance_executive_briefs_read on public.maintenance_executive_briefs
  for select to authenticated using(
    organization_id=public.app_current_org()
    and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin')
    and (
      information_sensitivity in ('public','internal')
      or (information_sensitivity='confidential'
        and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin'))
      or (information_sensitivity='restricted'
        and coalesce(public.app_current_role(),'') in ('executive','admin'))
    )
  );
drop policy if exists maintenance_executive_reviews_read on public.maintenance_executive_review_assignments;
create policy maintenance_executive_reviews_read on public.maintenance_executive_review_assignments
  for select to authenticated using(
    organization_id=public.app_current_org()
    and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin')
    and exists (
      select 1 from public.maintenance_executive_briefs b
      where b.id=brief_id and b.organization_id=public.app_current_org()
        and (
          b.information_sensitivity in ('public','internal')
          or (b.information_sensitivity='confidential'
            and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin'))
          or (b.information_sensitivity='restricted'
            and coalesce(public.app_current_role(),'') in ('executive','admin'))
        )
    )
  );
drop policy if exists maintenance_executive_dispositions_read on public.maintenance_executive_dispositions;
create policy maintenance_executive_dispositions_read on public.maintenance_executive_dispositions
  for select to authenticated using(
    organization_id=public.app_current_org()
    and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin')
    and exists (
      select 1 from public.maintenance_executive_briefs b
      where b.id=brief_id and b.organization_id=public.app_current_org()
        and (
          b.information_sensitivity in ('public','internal')
          or (b.information_sensitivity='confidential'
            and coalesce(public.app_current_role(),'') in ('executive','maintenance_manager','admin'))
          or (b.information_sensitivity='restricted'
            and coalesce(public.app_current_role(),'') in ('executive','admin'))
        )
    )
  );
revoke insert,update,delete,truncate on public.maintenance_executive_briefs,
  public.maintenance_executive_review_assignments,public.maintenance_executive_dispositions
  from public,anon,authenticated;
grant select on public.maintenance_executive_briefs,
  public.maintenance_executive_review_assignments,public.maintenance_executive_dispositions
  to authenticated;

-- The canonical audit ledger and retained run carry the same handling label as
-- the brief so their provenance cannot become a lower-classification side
-- channel. Existing history remains internal unless its writer states more.
alter table public.audit_events
  add column if not exists information_sensitivity text not null default 'internal';
alter table public.audit_events
  drop constraint if exists audit_events_information_sensitivity_check;
alter table public.audit_events
  add constraint audit_events_information_sensitivity_check check (
    information_sensitivity in ('public','internal','confidential','restricted')
  );
drop policy if exists audit_events_org_read on public.audit_events;
create policy audit_events_org_read on public.audit_events
  for select to authenticated using (
    organization_id=public.app_current_org() and (
      information_sensitivity in ('public','internal')
      or (information_sensitivity='confidential' and coalesce(public.app_current_role(),'')
        in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer'))
      or (information_sensitivity='restricted' and coalesce(public.app_current_role(),'')
        in ('admin','ai_admin','executive'))
    )
  );

create or replace function public.protect_maintenance_executive_records()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'maintenance-executive briefs, assignments and dispositions are append-only';
  end if;
  if coalesce(current_setting('app.maintenance_executive_record_write',true),'')<>'granted' then
    raise exception 'maintenance-executive records are written only by governed workflows';
  end if;
  return new;
end $$;
revoke all on function public.protect_maintenance_executive_records() from public,anon,authenticated;
drop trigger if exists trg_protect_maintenance_executive_briefs on public.maintenance_executive_briefs;
create trigger trg_protect_maintenance_executive_briefs before insert or update or delete
  on public.maintenance_executive_briefs for each row execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_reviews on public.maintenance_executive_review_assignments;
create trigger trg_protect_maintenance_executive_reviews before insert or update or delete
  on public.maintenance_executive_review_assignments for each row execute function public.protect_maintenance_executive_records();
drop trigger if exists trg_protect_maintenance_executive_dispositions on public.maintenance_executive_dispositions;
create trigger trg_protect_maintenance_executive_dispositions before insert or update or delete
  on public.maintenance_executive_dispositions for each row execute function public.protect_maintenance_executive_records();

-- Preserve every established retained-run writer while adding an explicit
-- organization scope and the executive specialist's marker.
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
          and new.organization_scope_id is null)
      or new.agent_control_profile_id is null
      or coalesce(btrim(new.agent_tool_key),'')=''
      or coalesce(btrim(new.agent_decision_right_key),'')='' then
      raise exception 'retained agent runs require requester, canonical work/site/component/asset/material/outage/data-domain/organization scope, control profile, tool and decision-right provenance';
    end if;
    if not exists(select 1 from public.user_profiles p
      where p.id=new.requested_by and p.organization_id=new.organization_id) then
      raise exception 'agent-run requester is not a member of this organization';
    end if;
    if not exists(select 1 from public.ai_agents a
      where a.id=new.agent_id and a.organization_id=new.organization_id) then
      raise exception 'agent run crosses its organization boundary';
    end if;
    if new.organization_scope_id is not null and new.organization_scope_id<>new.organization_id then
      raise exception 'agent run organization scope crosses its organization boundary';
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
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.sync_maintenance_executive_source_snapshot(
  p_org uuid,p_period_start date,p_period_end date
)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'capturedAt',now(),'periodStart',p_period_start,'periodEnd',p_period_end,
    'kpis',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',v.id,'key',v.kpi_key,'value',v.value,'status',v.status,
        'confidence',v.confidence,'computedAt',v.computed_at)::text,'|' order by v.id),'empty'),'sha256'),'hex'))
      from public.kpi_values v where v.organization_id=p_org
        and v.computed_at::date between p_period_start and p_period_end),
    'budgets',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'year',budget_year,'category',category,'site',site_id,
        'budgeted',budgeted,'committed',committed,'actual',actual,
        'forecast',forecast,'basis',forecast_basis)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.budget_lines where organization_id=p_org
        and budget_year between extract(year from p_period_start)::int and extract(year from p_period_end)::int),
    'risks',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'status',status,'level',current_risk_level,'score',current_risk_score,
        'owner',risk_owner_id,'reviewDate',review_date,'decision',decision_action)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.risks where organization_id=p_org and status not in ('closed','archived')
        and public.can_read_risk(id)
        and (information_sensitivity<>'restricted'
          or coalesce(public.app_current_role(),'') in ('executive','admin'))),
    'maintenancePlans',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'asset',asset_id,'task',task_code,'basis',interval_basis,
        'interval',interval_value,'source',source,'active',active)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.maintenance_plans where organization_id=p_org and active),
    'strategyAssessments',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'plan',maintenance_plan_id,'run',agent_run_id,'createdAt',created_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.asset_strategy_assessments where organization_id=p_org),
    'recommendations',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'status',status,'urgency',urgency,'cost',estimated_cost_usd,
        'risk',risk_impact,'approver',required_approver_role,'due',required_completion_date)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.recommendations where organization_id=p_org),
    'approvals',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'recommendation',recommendation_id,'work',work_order_id,
        'status',status,'ownerRole',owner_role,'decidedAt',decided_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.approvals where organization_id=p_org),
    'outcomes',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'recommendation',recommendation_id,'status',status,'result',result,
        'due',due_date,'verifiedAt',verified_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.verification_obligations where organization_id=p_org),
    'valueMetrics',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'type',metric_type,'value',value,'unit',unit,'status',status,
        'period',period,'createdAt',created_at)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.value_metrics where organization_id=p_org
        and created_at::date between p_period_start and p_period_end),
    'authorityLimits',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'role',role_key,'status',status,'version',version,
        'risk',max_risk_level,'commitment',max_commitment_usd,
        'downtime',max_production_downtime_hours)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.authority_limits where organization_id=p_org),
    'raci',(select jsonb_build_object('count',count(*),'sha256',
      encode(extensions.digest(coalesce(string_agg(jsonb_build_object(
        'id',id,'decision',decision_type,'a',accountable,'r',responsible,
        'c',consulted,'i',informed)::text,'|' order by id),'empty'),'sha256'),'hex'))
      from public.raci_assignments where organization_id=p_org)
  )
$$;
revoke all on function public.sync_maintenance_executive_source_snapshot(uuid,date,date)
  from public,anon,authenticated;

create or replace function public.run_maintenance_executive_agent(
  p_period_start date,p_period_end date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  v_agent public.ai_agents%rowtype; v_control jsonb; v_run uuid; v_brief uuid;
  v_snapshot jsonb; v_facts jsonb; v_priorities jsonb:='[]'::jsonb;
  v_kpi_total bigint; v_kpi_breaches bigint; v_kpi_waiting bigint;
  v_budget_lines bigint; v_budget_missing_basis bigint; v_budget_exception_lines bigint;
  v_risks bigint; v_draft_risks bigint; v_critical_risks bigint;
  v_risks_no_owner bigint; v_overdue_risks bigint;
  v_risk_sensitivity text;
  v_plans bigint; v_plans_no_source bigint; v_strategy_assessments bigint;
  v_pending_recommendations bigint; v_pending_approvals bigint;
  v_outcomes_open bigint; v_outcomes_overdue bigint;
  v_authority_adopted bigint; v_authority_draft bigint; v_raci bigint;
  v_value_by_unit jsonb; v_projected_value bigint; v_other_unverified_value bigint;
  v_unverified_value bigint; v_verified_value bigint;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  if coalesce(v_role,'') not in ('executive','maintenance_manager','admin') then
    return jsonb_build_object('error','running the Maintenance Executive Specialist requires a named executive, maintenance manager or administrator');
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start
     or p_period_end-p_period_start<6 or p_period_end-p_period_start>365
     or p_period_end>current_date then
    return jsonb_build_object('error','reporting period must be a completed 7 to 366 day window');
  end if;
  select * into v_agent from public.ai_agents
  where organization_id=v_org and key='maintenance_executive' order by created_at limit 1;
  if not found then return jsonb_build_object('error','no Maintenance Executive Specialist is configured'); end if;
  v_control:=public.evaluate_agent_control_internal(v_org,v_agent.id,
    'generate_meeting_packs','assemble_maintenance_executive_brief','Critical',null,null);
  if not coalesce((v_control->>'allowed')::boolean,false) then
    return jsonb_build_object('error','Maintenance Executive Specialist refused: '||(v_control->>'reason'));
  end if;

  with latest as (
    select distinct on(v.kpi_key) v.*,c.computable
    from public.kpi_values v join public.kpi_catalog c on c.kpi_key=v.kpi_key
    where v.organization_id=v_org and v.computed_at::date between p_period_start and p_period_end
    order by v.kpi_key,v.computed_at desc,v.id desc
  ) select count(*),count(*) filter(where status='breach')
    into v_kpi_total,v_kpi_breaches from latest;
  select count(*) into v_kpi_waiting from public.kpi_catalog c
    where c.computable=false and (c.audience is null or v_role=any(c.audience));
  select count(*),
    count(*) filter(where forecast is not null and nullif(btrim(forecast_basis),'') is null),
    count(*) filter(where actual>budgeted or (forecast is not null and forecast>budgeted))
    into v_budget_lines,v_budget_missing_basis,v_budget_exception_lines
  from public.budget_lines where organization_id=v_org
    and budget_year between extract(year from p_period_start)::int and extract(year from p_period_end)::int;
  select count(*) filter(where status<>'draft'),
    count(*) filter(where status='draft'),
    count(*) filter(where status<>'draft' and current_risk_level='Critical'),
    count(*) filter(where status<>'draft' and risk_owner_id is null),
    count(*) filter(where status<>'draft' and review_date<current_date)
    into v_risks,v_draft_risks,v_critical_risks,v_risks_no_owner,v_overdue_risks
  from public.risks where organization_id=v_org and status not in ('closed','archived')
    and public.can_read_risk(id)
    and (information_sensitivity<>'restricted' or v_role in ('executive','admin'));
  select case max(case information_sensitivity
      when 'restricted' then 4 when 'confidential' then 3 when 'internal' then 2 else 1 end)
      when 4 then 'restricted' when 3 then 'confidential' else 'internal' end
    into v_risk_sensitivity
  from public.risks where organization_id=v_org and status not in ('closed','archived')
    and public.can_read_risk(id)
    and (information_sensitivity<>'restricted' or v_role in ('executive','admin'));
  select count(*),count(*) filter(where nullif(btrim(source),'') is null)
    into v_plans,v_plans_no_source from public.maintenance_plans
    where organization_id=v_org and active;
  select count(*) into v_strategy_assessments from public.asset_strategy_assessments
    where organization_id=v_org;
  select count(*) into v_pending_recommendations from public.recommendations
    where organization_id=v_org and status in ('pending','escalated','modified');
  select count(*) into v_pending_approvals from public.approvals
    where organization_id=v_org and status in ('required','pending');
  select count(*) filter(where status='open'),
    count(*) filter(where status='open' and due_date<current_date)
    into v_outcomes_open,v_outcomes_overdue from public.verification_obligations
    where organization_id=v_org;
  select count(*) filter(where status='adopted'),count(*) filter(where status='draft')
    into v_authority_adopted,v_authority_draft from public.authority_limits
    where organization_id=v_org;
  select count(*) into v_raci from public.raci_assignments where organization_id=v_org;
  select coalesce(jsonb_object_agg(unit,totals),'{}'::jsonb),
    coalesce(sum(projected_count),0),coalesce(sum(other_unverified_count),0),
    coalesce(sum(unverified_count),0),coalesce(sum(verified_count),0)
    into v_value_by_unit,v_projected_value,v_other_unverified_value,
      v_unverified_value,v_verified_value
  from (
    select coalesce(unit,'unspecified') unit,
      jsonb_build_object(
        'projected',coalesce(sum(value) filter(where status='projected'),0),
        'otherUnverified',coalesce(sum(value) filter(where status not in ('projected','verified')),0),
        'verified',coalesce(sum(value) filter(where status='verified'),0),
        'records',count(*)) totals,
      count(*) filter(where status='projected') projected_count,
      count(*) filter(where status not in ('projected','verified')) other_unverified_count,
      count(*) filter(where status<>'verified') unverified_count,
      count(*) filter(where status='verified') verified_count
    from public.value_metrics where organization_id=v_org
      and created_at::date between p_period_start and p_period_end
    group by coalesce(unit,'unspecified')
  ) grouped;

  if v_kpi_breaches>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','kpi_breaches','category','enterprise_performance','severity','high',
    'observed',format('%s latest recorded KPI values are in breach.',v_kpi_breaches),
    'decisionQuestion','Which accountable owners must bring evidence-backed recovery options to the next review?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if v_kpi_waiting>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','kpi_sources_missing','category','enterprise_performance','severity','medium',
    'observed',format('%s visible KPI definitions are explicitly awaiting a source.',v_kpi_waiting),
    'decisionQuestion','Which source gaps are material enough to fund, and who owns the connection?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if v_budget_lines=0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','budget_not_recorded','category','budget','severity','high',
    'observed','No budget line is recorded for the reporting years.',
    'decisionQuestion','Who will establish the governed maintenance budget source and forecast basis?',
    'route','/executive','humanDecisionRequired',true));
  elsif v_budget_missing_basis>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','budget_forecast_basis_missing','category','budget','severity','high',
    'observed',format('%s budget forecasts have no stated basis.',v_budget_missing_basis),
    'decisionQuestion','Which named budget owner must evidence or withdraw each unsupported forecast?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if v_budget_exception_lines>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','budget_exception_attention','category','budget','severity','high',
    'observed',format('%s budget lines have actual or forecast amounts above their recorded budget.',v_budget_exception_lines),
    'decisionQuestion','Which accountable budget owners must explain the recorded exceptions and route any authorization through the canonical approval process?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if v_critical_risks>0 or v_overdue_risks>0 or v_risks_no_owner>0 then
    v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
      'priorityKey','enterprise_risk_attention','category','risk','severity',
        case when v_critical_risks>0 then 'critical' else 'high' end,
      'observed',format('%s critical, %s overdue-review and %s ownerless active risks are recorded.',v_critical_risks,v_overdue_risks,v_risks_no_owner),
      'decisionQuestion','Which accountable human owns treatment, escalation or a separately governed risk-acceptance decision?',
      'route','/risk','humanDecisionRequired',true));
  end if;
  if v_draft_risks>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','risk_drafts_unqualified','category','risk','severity','medium',
    'observed',format('%s draft risks are recorded separately and are not represented as active assessed risks.',v_draft_risks),
    'decisionQuestion','Which risk owners must qualify, evidence or retire the draft records through the canonical ISO 31000 workflow?',
    'route','/risk','humanDecisionRequired',true)); end if;
  if v_plans=0 or v_plans_no_source>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','maintenance_strategy_evidence_gap','category','maintenance_strategy','severity','high',
    'observed',case when v_plans=0 then 'No active maintenance plan is recorded.'
      else format('%s of %s active maintenance plans have no stated source.',v_plans_no_source,v_plans) end,
    'decisionQuestion','Which strategy owner must establish or review the evidence-backed maintenance programme?',
    'route','/reliability','humanDecisionRequired',true)); end if;
  if v_authority_adopted=0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','authority_instrument_not_adopted','category','governance','severity','high',
    'observed',format('No delegation-of-authority row is adopted; %s draft rows remain non-binding.',v_authority_draft),
    'decisionQuestion','Which authorized executive will adopt the organization-specific authority instrument?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if v_outcomes_overdue>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','outcome_verification_overdue','category','verified_value','severity','high',
    'observed',format('%s recommendation outcome verifications are overdue.',v_outcomes_overdue),
    'decisionQuestion','Which accountable owners must verify results or record that the expected outcome did not occur?',
    'route','/learning-loop','humanDecisionRequired',true)); end if;
  if v_unverified_value>0 then v_priorities:=v_priorities||jsonb_build_array(jsonb_build_object(
    'priorityKey','projected_value_unverified','category','verified_value','severity','medium',
    'observed',format('%s value records remain projected or otherwise unverified; status classes and units remain separate.',v_unverified_value),
    'decisionQuestion','Which claims need independent outcome verification before executive reporting?',
    'route','/executive','humanDecisionRequired',true)); end if;
  if jsonb_array_length(v_priorities)=0 then
    v_priorities:=jsonb_build_array(jsonb_build_object(
      'priorityKey','no_current_exception','category','governance','severity','information',
      'observed','No exception is visible in the currently recorded enterprise evidence.',
      'decisionQuestion','Does an independent human review confirm coverage and source currency?',
      'route','/executive','humanDecisionRequired',true));
  end if;

  v_snapshot:=public.sync_maintenance_executive_source_snapshot(v_org,p_period_start,p_period_end);
  v_facts:=jsonb_build_object(
    'period',jsonb_build_object('start',p_period_start,'end',p_period_end),
    'enterprisePerformance',jsonb_build_object('latestKpis',v_kpi_total,
      'breaches',v_kpi_breaches,'awaitingSourceDefinitions',v_kpi_waiting),
    'budget',jsonb_build_object('lines',v_budget_lines,
      'linesOverBudgetOrForecast',v_budget_exception_lines,
      'forecastsWithoutBasis',v_budget_missing_basis,
      'aggregateAmount','not calculated; canonical budget rows carry no currency field'),
    'risk',jsonb_build_object('active',v_risks,'draftsAwaitingQualification',v_draft_risks,
      'critical',v_critical_risks,
      'withoutOwner',v_risks_no_owner,'overdueReview',v_overdue_risks),
    'maintenanceStrategy',jsonb_build_object('activePlans',v_plans,
      'plansWithoutSource',v_plans_no_source,'governedAssessments',v_strategy_assessments),
    'decisionQueue',jsonb_build_object('pendingRecommendations',v_pending_recommendations,
      'pendingApprovals',v_pending_approvals),
    'governance',jsonb_build_object('adoptedAuthorityLimits',v_authority_adopted,
      'draftAuthorityLimits',v_authority_draft,'raciAssignments',v_raci),
    'outcomes',jsonb_build_object('open',v_outcomes_open,'overdue',v_outcomes_overdue),
    'value',jsonb_build_object('byUnit',v_value_by_unit,
      'projectedRecordCount',v_projected_value,
      'otherUnverifiedRecordCount',v_other_unverified_value,
      'unverifiedRecordCount',v_unverified_value,
      'verifiedRecordCount',v_verified_value));

  perform set_config('app.maintenance_executive_agent_run_write','granted',true);
  insert into public.agent_runs(organization_id,agent_id,status,summary,confidence,
    started_at,completed_at,requested_by,organization_scope_id,information_sensitivity,
    agent_control_profile_id,agent_tool_key,agent_decision_right_key,
    input_snapshot,result,retained_for_governance)
  values(v_org,v_agent.id,'completed',
    'Assembled a canonical maintenance-executive decision brief without approving, funding or executing action.',
    null,now(),now(),auth.uid(),v_org,v_risk_sensitivity,
    (v_control->>'profile_id')::uuid,'assemble_maintenance_executive_brief',
    'generate_meeting_packs',v_snapshot,jsonb_build_object(
      'facts',v_facts,'priorities',v_priorities,'advisory',true,
      'mayApprove',false,'mayAcceptRisk',false,'mayCommitSpend',false,
      'mayReleaseWork',false,'mayChangeStrategy',false,'mayChangeKpiTarget',false,
      'mayReturnToService',false),true) returning id into v_run;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_briefs(organization_id,agent_run_id,
    period_start,period_end,information_sensitivity,source_snapshot,facts,priorities,
    limitations,created_by)
  values(v_org,v_run,p_period_start,p_period_end,v_risk_sensitivity,v_snapshot,v_facts,v_priorities,
    jsonb_build_array(
      'The brief describes only records present at the captured source fingerprints; missing external records remain absent.',
      'KPI results and statuses are reused from the canonical KPI service; this specialist does not recompute them.',
      'Budget rows do not carry a currency field, so budget totals are reported without inventing a currency.',
      'Value is separated by recorded unit and projected value is never promoted to verified value.',
      'Risk inputs preserve canonical information-sensitivity rules; restricted populations are included only in executive or administrator briefs.',
      'A source-population digest detects change but does not prove upstream correctness.',
      'Priorities are advisory decision questions and require independent named-human review.'),auth.uid())
  returning id into v_brief;
  perform set_config('app.maintenance_executive_record_write','',true);
  perform set_config('app.maintenance_executive_agent_run_write','',true);
  update public.ai_agents set last_action_at=now(),status='active',
    current_task='Maintenance executive brief through '||p_period_end,
    last_action='Generated an immutable governed maintenance-executive brief'
  where id=v_agent.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data,information_sensitivity)
  values(v_org,'maintenance_executive_brief',v_role,jsonb_build_object(
    'action','generated','brief_id',v_brief,'agent_run_id',v_run,
    'requested_by',auth.uid(),'period_start',p_period_start,'period_end',p_period_end,
    'priority_count',jsonb_array_length(v_priorities),'advisory',true),v_risk_sensitivity);
  return jsonb_build_object('briefId',v_brief,'runId',v_run,
    'facts',v_facts,'priorities',v_priorities,'advisory',true,
    'mayApprove',false,'mayAcceptRisk',false,'mayCommitSpend',false,
    'mayReleaseWork',false,'mayChangeStrategy',false,'mayChangeKpiTarget',false,
    'mayReturnToService',false);
end $$;
revoke all on function public.run_maintenance_executive_agent(date,date) from public,anon;
grant execute on function public.run_maintenance_executive_agent(date,date) to authenticated;

create or replace function public.assign_maintenance_executive_review(
  p_brief_id uuid,p_assigned_to uuid,p_due_date date,p_note text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); b public.maintenance_executive_briefs%rowtype; v_id uuid;
begin
  if auth.uid() is null or coalesce(public.app_current_role(),'') not in
    ('executive','maintenance_manager','admin') then
    return jsonb_build_object('error','named human executive or maintenance-management authority is required');
  end if;
  select * into b from public.maintenance_executive_briefs
  where id=p_brief_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','brief not found'); end if;
  if b.information_sensitivity='restricted' and coalesce(public.app_current_role(),'')
    not in ('executive','admin') then
    return jsonb_build_object('error','brief not found');
  end if;
  if p_assigned_to=b.created_by then
    return jsonb_build_object('error','segregation of duties requires a reviewer other than the brief requester');
  end if;
  if not exists(select 1 from public.user_profiles u where u.id=p_assigned_to
    and u.organization_id=v_org and u.role in ('executive','maintenance_manager','admin')) then
    return jsonb_build_object('error','reviewer must be a same-tenant named executive, maintenance manager or administrator');
  end if;
  if b.information_sensitivity='restricted' and not exists(
    select 1 from public.user_profiles u where u.id=p_assigned_to
      and u.organization_id=v_org and u.role in ('executive','admin')
  ) then
    return jsonb_build_object('error','restricted briefs require an executive or administrator reviewer');
  end if;
  if p_due_date<current_date or coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','a current due date and review basis of at least 10 characters are required');
  end if;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_review_assignments(organization_id,
    brief_id,assigned_to,assigned_by,due_date,assignment_note)
  values(v_org,b.id,p_assigned_to,auth.uid(),p_due_date,btrim(p_note)) returning id into v_id;
  perform set_config('app.maintenance_executive_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,information_sensitivity)
  values(v_org,'maintenance_executive_review',public.app_current_role(),jsonb_build_object(
    'action','assigned','assignment_id',v_id,'brief_id',b.id,
    'assigned_to',p_assigned_to,'assigned_by',auth.uid(),'due_date',p_due_date),
    b.information_sensitivity);
  return jsonb_build_object('assignmentId',v_id,'status','assigned');
exception when unique_violation then
  perform set_config('app.maintenance_executive_record_write','',true);
  return jsonb_build_object('error','this reviewer is already assigned to the brief');
end $$;
revoke all on function public.assign_maintenance_executive_review(uuid,uuid,date,text) from public,anon;
grant execute on function public.assign_maintenance_executive_review(uuid,uuid,date,text) to authenticated;

create or replace function public.record_maintenance_executive_disposition(
  p_brief_id uuid,p_priority_key text,p_disposition text,p_note text,
  p_action_reference text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); b public.maintenance_executive_briefs%rowtype; v_id uuid;
begin
  if auth.uid() is null or coalesce(public.app_current_role(),'') not in
    ('executive','maintenance_manager','admin') then
    return jsonb_build_object('error','named human executive or maintenance-management review authority is required');
  end if;
  select * into b from public.maintenance_executive_briefs
  where id=p_brief_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','brief not found'); end if;
  if b.information_sensitivity='restricted' and coalesce(public.app_current_role(),'')
    not in ('executive','admin') then
    return jsonb_build_object('error','brief not found');
  end if;
  if b.created_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires disposition by a different named human');
  end if;
  if not exists(select 1 from public.maintenance_executive_review_assignments r
    where r.brief_id=b.id and r.organization_id=v_org and r.assigned_to=auth.uid()) then
    return jsonb_build_object('error','this named human is not assigned to review the brief');
  end if;
  if p_disposition not in ('acknowledged','route_for_action','deferred','rejected')
     or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','valid disposition and a review note of at least 20 characters are required');
  end if;
  if not exists(select 1 from jsonb_array_elements(b.priorities) p
    where p->>'priorityKey'=p_priority_key) then
    return jsonb_build_object('error','priority key is not present in the immutable brief');
  end if;
  if p_disposition='route_for_action' and coalesce(length(btrim(p_action_reference)),0)<3 then
    return jsonb_build_object('error','routing for action requires a stable canonical action reference');
  end if;
  perform set_config('app.maintenance_executive_record_write','granted',true);
  insert into public.maintenance_executive_dispositions(organization_id,brief_id,
    priority_key,disposition,note,action_reference,reviewed_by)
  values(v_org,b.id,p_priority_key,p_disposition,btrim(p_note),
    nullif(btrim(p_action_reference),''),auth.uid()) returning id into v_id;
  perform set_config('app.maintenance_executive_record_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data,information_sensitivity)
  values(v_org,'maintenance_executive_disposition',public.app_current_role(),jsonb_build_object(
    'action','reviewed','disposition_id',v_id,'brief_id',b.id,
    'priority_key',p_priority_key,'disposition',p_disposition,
    'reviewed_by',auth.uid(),'action_reference',nullif(btrim(p_action_reference),''),
    'authority','This receipt does not approve, accept risk, commit spend, release work, change strategy or change a KPI target.'),
    b.information_sensitivity);
  return jsonb_build_object('dispositionId',v_id,'status',p_disposition,
    'approvalGranted',false,'riskAccepted',false,'spendCommitted',false,
    'workReleased',false,'strategyChanged',false,'operationalAuthorization',false);
exception when unique_violation then
  perform set_config('app.maintenance_executive_record_write','',true);
  return jsonb_build_object('error','this priority already has an immutable disposition');
end $$;
revoke all on function public.record_maintenance_executive_disposition(uuid,text,text,text,text)
  from public,anon;
grant execute on function public.record_maintenance_executive_disposition(uuid,text,text,text,text)
  to authenticated;

create or replace function public.get_maintenance_executive_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','authentication required'); end if;
  if coalesce(public.app_current_role(),'') not in
    ('executive','maintenance_manager','admin') then
    return jsonb_build_object('error','executive workspace requires a named executive, maintenance manager or administrator');
  end if;
  return jsonb_build_object(
    'briefs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'agentRunId',b.agent_run_id,'periodStart',b.period_start,
      'periodEnd',b.period_end,'informationSensitivity',b.information_sensitivity,
      'sourceSnapshot',b.source_snapshot,'facts',b.facts,
      'priorities',b.priorities,'limitations',b.limitations,
      'createdBy',b.created_by,'createdAt',b.created_at,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',r.id,'assignedTo',r.assigned_to,'reviewerName',u.full_name,
        'reviewerEmail',u.email,'dueDate',r.due_date,'note',r.assignment_note,
        'assignedAt',r.assigned_at) order by r.assigned_at)
        from public.maintenance_executive_review_assignments r
        left join public.user_profiles u on u.id=r.assigned_to
        where r.brief_id=b.id),'[]'::jsonb),
      'dispositions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',d.id,'priorityKey',d.priority_key,'disposition',d.disposition,
        'note',d.note,'actionReference',d.action_reference,
        'reviewedBy',d.reviewed_by,'reviewedAt',d.reviewed_at) order by d.reviewed_at)
        from public.maintenance_executive_dispositions d where d.brief_id=b.id),'[]'::jsonb))
      order by b.created_at desc) from public.maintenance_executive_briefs b
      where b.organization_id=v_org and (
        b.information_sensitivity in ('public','internal')
        or (b.information_sensitivity='confidential' and coalesce(public.app_current_role(),'')
          in ('executive','maintenance_manager','admin'))
        or (b.information_sensitivity='restricted' and coalesce(public.app_current_role(),'')
          in ('executive','admin'))
      )),'[]'::jsonb),
    'reviewers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',u.id,'name',u.full_name,'email',u.email,'role',u.role)
      order by coalesce(u.full_name,u.email)) from public.user_profiles u
      where u.organization_id=v_org and u.role in
        ('executive','maintenance_manager','admin')),'[]'::jsonb),
    'basis','The Maintenance Executive Specialist reuses canonical KPI, budget, risk, strategy, decision, approval, outcome, value, RACI and authority records. It freezes evidence and frames decision questions; neither the brief nor its review receipt authorizes an operational, financial, risk or strategy action.'
  );
end $$;
revoke all on function public.get_maintenance_executive_workspace() from public,anon;
grant execute on function public.get_maintenance_executive_workspace() to authenticated;

comment on table public.maintenance_executive_briefs is
  'C1.01 immutable Maintenance Executive Specialist brief over exact canonical enterprise source fingerprints.';
comment on function public.run_maintenance_executive_agent(date,date) is
  'C1.01 governed advisory execution across performance, governance, budgets, risk, strategy and verified value without decision authority.';
comment on function public.record_maintenance_executive_disposition(uuid,text,text,text,text) is
  'C1.01 independent named-human review receipt. It is never an approval, risk acceptance, expenditure commitment, work release or strategy change.';

notify pgrst,'reload schema';
