-- D10.01-D10.03 / D10.05 — governed program architecture and dependency-aware
-- portfolio intelligence.
--
-- Canonical reuse:
--   * development_cases / capital_projects remain the project identities;
--   * risk_objectives remains the shared-outcome identity;
--   * value_metrics remains the one benefit store and verification loop;
--   * evidence_items remains the one evidence store;
--
-- New persistence is limited to the genuinely new nouns: Program membership
-- and project-to-project dependency. No second project, benefit, evidence,
-- approval, recommendation, audit or workflow store is introduced.

create table if not exists public.development_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_code text not null,
  title text not null,
  shared_objective_id uuid not null references public.risk_objectives(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  shared_outcome_label text not null,
  shared_outcome_target numeric not null,
  shared_outcome_unit text not null,
  outcome_capacity_limit numeric,
  outcome_basis text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  target_start date,
  target_finish date,
  status text not null default 'draft'
    check (status in ('draft','active','on_hold','completed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint development_program_code_nonempty check (length(btrim(program_code)) >= 2),
  constraint development_program_title_nonempty check (length(btrim(title)) >= 3),
  constraint development_program_outcome_label_nonempty check (length(btrim(shared_outcome_label)) >= 3),
  constraint development_program_outcome_unit_nonempty check (length(btrim(shared_outcome_unit)) >= 1),
  constraint development_program_outcome_target_nonnegative check (shared_outcome_target >= 0),
  constraint development_program_capacity_nonnegative check (outcome_capacity_limit is null or outcome_capacity_limit >= 0),
  constraint development_program_basis_substantive check (length(btrim(outcome_basis)) >= 20),
  constraint development_program_dates_ordered check (target_start is null or target_finish is null or target_start <= target_finish)
);

create unique index if not exists development_programs_org_code_unique
  on public.development_programs(organization_id, lower(program_code));
create index if not exists development_programs_org_status_idx
  on public.development_programs(organization_id, status);

create table if not exists public.development_program_projects (
  program_id uuid not null references public.development_programs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete restrict,
  contribution_basis text not null,
  added_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (program_id, development_case_id),
  constraint development_program_project_basis_substantive check (length(btrim(contribution_basis)) >= 20)
);

create index if not exists development_program_projects_case_idx
  on public.development_program_projects(organization_id, development_case_id);

create table if not exists public.development_project_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.development_programs(id) on delete cascade,
  predecessor_case_id uuid not null references public.development_cases(id) on delete restrict,
  successor_case_id uuid not null references public.development_cases(id) on delete restrict,
  dependency_kind text not null default 'finish_to_start'
    check (dependency_kind in ('finish_to_start','shared_resource','shared_interface','shared_shutdown','regulatory_sequence')),
  basis text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint development_project_dependency_not_self check (predecessor_case_id <> successor_case_id),
  constraint development_project_dependency_basis_substantive check (length(btrim(basis)) >= 20)
);

create unique index if not exists development_project_dependencies_edge_unique
  on public.development_project_dependencies(program_id, predecessor_case_id, successor_case_id, dependency_kind);
create index if not exists development_project_dependencies_successor_idx
  on public.development_project_dependencies(organization_id, successor_case_id);

alter table public.development_programs enable row level security;
alter table public.development_program_projects enable row level security;
alter table public.development_project_dependencies enable row level security;

drop policy if exists development_programs_read on public.development_programs;
create policy development_programs_read on public.development_programs
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists development_program_projects_read on public.development_program_projects;
create policy development_program_projects_read on public.development_program_projects
  for select to authenticated using (organization_id = public.app_current_org());
drop policy if exists development_project_dependencies_read on public.development_project_dependencies;
create policy development_project_dependencies_read on public.development_project_dependencies
  for select to authenticated using (organization_id = public.app_current_org());

-- Holds every writer, including privileged/direct writers, to the same tenant,
-- membership, objective, evidence and human-authorship rules.
create or replace function public.enforce_development_program_integrity()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.risk_objectives o
    where o.id=new.shared_objective_id and o.organization_id=new.organization_id and o.status='adopted') then
    raise exception 'program shared outcome requires an adopted same-tenant objective';
  end if;
  if not exists(select 1 from public.user_profiles u
    where u.id=new.owner_id and u.organization_id=new.organization_id) then
    raise exception 'program owner must belong to the same organization';
  end if;
  if not exists(select 1 from public.user_profiles u
    where u.id=new.created_by and u.id=auth.uid() and u.organization_id=new.organization_id and u.role<>'ai_admin') then
    raise exception 'program creation and revision require the authenticated named human in the same organization';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified' and e.verified_by is distinct from new.created_by) then
    raise exception 'program outcome basis requires independently verified same-tenant evidence';
  end if;
  if tg_op='UPDATE' and (new.organization_id<>old.organization_id or new.created_by<>old.created_by) then
    raise exception 'program tenant and original author are immutable';
  end if;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists trg_development_program_integrity on public.development_programs;
create trigger trg_development_program_integrity before insert or update on public.development_programs
for each row execute function public.enforce_development_program_integrity();

create or replace function public.enforce_development_program_project_integrity()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.development_programs p
    where p.id=new.program_id and p.organization_id=new.organization_id) then
    raise exception 'program membership requires a same-tenant program';
  end if;
  if not exists(select 1 from public.development_cases c
    where c.id=new.development_case_id and c.organization_id=new.organization_id) then
    raise exception 'program membership requires a same-tenant development case';
  end if;
  if not exists(select 1 from public.user_profiles u
    where u.id=new.added_by and u.id=auth.uid() and u.organization_id=new.organization_id and u.role<>'ai_admin') then
    raise exception 'program membership requires the authenticated named human author';
  end if;
  if tg_op='UPDATE' and (new.program_id<>old.program_id or new.organization_id<>old.organization_id
      or new.development_case_id<>old.development_case_id or new.added_by<>old.added_by) then
    raise exception 'program membership identity and provenance are immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_development_program_project_integrity on public.development_program_projects;
create trigger trg_development_program_project_integrity before insert or update on public.development_program_projects
for each row execute function public.enforce_development_program_project_integrity();

create or replace function public.enforce_development_project_dependency_integrity()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.development_programs p
    where p.id=new.program_id and p.organization_id=new.organization_id) then
    raise exception 'project dependency requires a same-tenant program';
  end if;
  if not exists(select 1 from public.development_program_projects m
    where m.program_id=new.program_id and m.organization_id=new.organization_id
      and m.development_case_id=new.predecessor_case_id)
     or not exists(select 1 from public.development_program_projects m
    where m.program_id=new.program_id and m.organization_id=new.organization_id
      and m.development_case_id=new.successor_case_id) then
    raise exception 'both dependency endpoints must be members of this program';
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=new.evidence_item_id and e.organization_id=new.organization_id
      and e.verification_status='verified' and e.verified_by is distinct from new.created_by) then
    raise exception 'project dependency requires independently verified same-tenant evidence';
  end if;
  if not exists(select 1 from public.user_profiles u
    where u.id=new.created_by and u.id=auth.uid() and u.organization_id=new.organization_id and u.role<>'ai_admin') then
    raise exception 'project dependency requires the authenticated named human author';
  end if;
  if exists(
    with recursive walk(case_id) as (
      select new.successor_case_id
      union
      select d.successor_case_id from public.development_project_dependencies d
      join walk w on d.predecessor_case_id=w.case_id
      where d.program_id=new.program_id and d.organization_id=new.organization_id
        and (tg_op='INSERT' or d.id<>new.id)
    ) select 1 from walk where case_id=new.predecessor_case_id
  ) then
    raise exception 'project dependency would create a cycle; enterprise critical path is refused';
  end if;
  if tg_op='UPDATE' and (new.organization_id<>old.organization_id or new.program_id<>old.program_id
      or new.predecessor_case_id<>old.predecessor_case_id or new.successor_case_id<>old.successor_case_id
      or new.created_by<>old.created_by) then
    raise exception 'project dependency identity and provenance are immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_development_project_dependency_integrity on public.development_project_dependencies;
create trigger trg_development_project_dependency_integrity before insert or update on public.development_project_dependencies
for each row execute function public.enforce_development_project_dependency_integrity();

create or replace function public.create_development_program(p_program jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid; v_objective uuid; v_owner uuid; v_evidence uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','program creation requires an authorized named human');
  end if;
  if v_role='ai_admin' then return jsonb_build_object('error','AI may analyze programs but cannot author the governing program outcome'); end if;
  begin
    v_objective:=(p_program->>'sharedObjectiveId')::uuid;
    v_owner:=(p_program->>'ownerId')::uuid;
    v_evidence:=(p_program->>'evidenceItemId')::uuid;
  exception when others then return jsonb_build_object('error','program objective, owner and verified evidence identifiers are required'); end;
  begin
    insert into public.development_programs(organization_id,program_code,title,shared_objective_id,owner_id,
      shared_outcome_label,shared_outcome_target,shared_outcome_unit,outcome_capacity_limit,outcome_basis,
      evidence_item_id,target_start,target_finish,status,created_by)
    values(v_org,btrim(p_program->>'programCode'),btrim(p_program->>'title'),v_objective,v_owner,
      btrim(p_program->>'sharedOutcomeLabel'),(p_program->>'sharedOutcomeTarget')::numeric,
      btrim(p_program->>'sharedOutcomeUnit'),case when nullif(p_program->>'outcomeCapacityLimit','') is null then null else (p_program->>'outcomeCapacityLimit')::numeric end,
      btrim(p_program->>'outcomeBasis'),v_evidence,public.sync_text_as_date(p_program->>'targetStart'),
      public.sync_text_as_date(p_program->>'targetFinish'),coalesce(nullif(p_program->>'status',''),'draft'),auth.uid())
    returning id into v_id;
  exception when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'development_program_created',v_role,jsonb_build_object('program_id',v_id,'objective_id',v_objective,'evidence_item_id',v_evidence));
  return jsonb_build_object('programId',v_id,'status','draft','automaticFunding',false,'automaticSanction',false);
end $$;

create or replace function public.add_project_to_development_program(p_program_id uuid,p_case_id uuid,p_contribution_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','program membership requires an authorized named human');
  end if;
  if v_role='ai_admin' then return jsonb_build_object('error','AI cannot decide program membership'); end if;
  begin
    insert into public.development_program_projects(program_id,organization_id,development_case_id,contribution_basis,added_by)
    values(p_program_id,v_org,p_case_id,btrim(p_contribution_basis),auth.uid());
  exception when unique_violation then return jsonb_build_object('error','project is already a member of this program');
  when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'development_program_project_added',v_role,jsonb_build_object('program_id',p_program_id,'development_case_id',p_case_id));
  return jsonb_build_object('programId',p_program_id,'developmentCaseId',p_case_id,'status','linked');
end $$;

create or replace function public.record_development_project_dependency(
  p_program_id uuid,p_predecessor_case_id uuid,p_successor_case_id uuid,p_dependency_kind text,p_basis text,p_evidence_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_org is null or v_role not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','dependency recording requires an authorized named human');
  end if;
  if v_role='ai_admin' then return jsonb_build_object('error','AI may identify a possible dependency but cannot establish the program dependency record'); end if;
  begin
    insert into public.development_project_dependencies(organization_id,program_id,predecessor_case_id,successor_case_id,
      dependency_kind,basis,evidence_item_id,created_by)
    values(v_org,p_program_id,p_predecessor_case_id,p_successor_case_id,p_dependency_kind,btrim(p_basis),p_evidence_item_id,auth.uid())
    returning id into v_id;
  exception when unique_violation then return jsonb_build_object('error','this dependency already exists');
  when others then return jsonb_build_object('error',sqlerrm); end;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'development_project_dependency_recorded',v_role,jsonb_build_object('dependency_id',v_id,'program_id',p_program_id,
    'predecessor_case_id',p_predecessor_case_id,'successor_case_id',p_successor_case_id,'evidence_item_id',p_evidence_item_id));
  return jsonb_build_object('dependencyId',v_id,'status','recorded','automaticScheduleChange',false);
end $$;

-- One read composes the program, canonical cases/projects, canonical benefit
-- claims and the persisted dependency graph. Missing duration, mismatched units
-- and missing capacity constraints are explicit; none are silently treated as 0.
create or replace function public.get_development_program_workspace(p_program_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_program uuid;
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  if p_program_id is null then
    select id into v_program from public.development_programs where organization_id=v_org
      order by case status when 'active' then 0 when 'draft' then 1 else 2 end,updated_at desc limit 1;
  else v_program:=p_program_id; end if;
  if v_program is null then
    return jsonb_build_object('program',null,'programs','[]'::jsonb,
      'availableCases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status) order by c.title)
        from public.development_cases c where c.organization_id=v_org and c.status not in ('cancelled','completed')),'[]'::jsonb),
      'adoptedObjectives',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.description,'target',o.target,'measurement',o.measurement) order by o.description)
        from public.risk_objectives o where o.organization_id=v_org and o.status='adopted'),'[]'::jsonb),
      'members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.full_name,''),u.email),'role',u.role)
        order by coalesce(nullif(u.full_name,''),u.email)) from public.user_profiles u where u.organization_id=v_org and u.role<>'ai_admin'),'[]'::jsonb),
      'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'label',coalesce(nullif(e.description,''),e.evidence_type,e.id::text),
        'type',e.evidence_type,'verifiedAt',e.verified_at) order by e.verified_at desc nulls last)
        from (select * from public.evidence_items where organization_id=v_org and verification_status='verified'
          order by verified_at desc nulls last limit 100) e),'[]'::jsonb),
      'decisionBoundary','No program is configured. No program outcome, dependency forecast or double-count conclusion can be inferred.');
  end if;
  if not exists(select 1 from public.development_programs where id=v_program and organization_id=v_org) then
    return jsonb_build_object('error','program not found in this organization');
  end if;
  return jsonb_build_object(
    'programs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.program_code,'title',p.title,'status',p.status) order by p.title)
      from public.development_programs p where p.organization_id=v_org),'[]'::jsonb),
    'program',(select jsonb_build_object('id',p.id,'code',p.program_code,'title',p.title,'status',p.status,
      'sharedObjectiveId',p.shared_objective_id,'sharedOutcomeLabel',p.shared_outcome_label,'sharedOutcomeTarget',p.shared_outcome_target,
      'sharedOutcomeUnit',p.shared_outcome_unit,'outcomeCapacityLimit',p.outcome_capacity_limit,'outcomeBasis',p.outcome_basis,
      'evidenceItemId',p.evidence_item_id,'ownerId',p.owner_id,'targetStart',p.target_start,'targetFinish',p.target_finish)
      from public.development_programs p where p.id=v_program and p.organization_id=v_org),
    'projects',coalesce((select jsonb_agg(jsonb_build_object('caseId',c.id,'capitalProjectId',c.capital_project_id,'title',c.title,
      'status',c.status,'contributionBasis',m.contribution_basis,'durationMonths',i.duration_months,
      'earliestStart',i.earliest_start,'latestStart',i.latest_start,
      'durationSource',case when i.duration_months is null then null else 'capital_plan_items:'||i.id end,
      'claimedOutcome',b.claimed,'verifiedClaimedOutcome',b.verified_claimed,'mismatchedBenefitCount',b.mismatched_count) order by c.title)
      from public.development_program_projects m join public.development_cases c on c.id=m.development_case_id and c.organization_id=v_org
      join public.development_programs p on p.id=m.program_id
      left join lateral (select i.* from public.capital_plan_items i where i.organization_id=v_org and i.development_case_id=c.id
        order by i.updated_at desc nulls last,i.plan_year desc limit 1) i on true
      left join lateral (select coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0) claimed,
        coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit) and vm.status='verified'),0) verified_claimed,
        count(*) filter(where lower(vm.unit)<>lower(p.shared_outcome_unit)) mismatched_count
        from public.value_metrics vm where vm.organization_id=v_org and vm.development_case_id=c.id
          and vm.objective_id=p.shared_objective_id and vm.metric_type='projected_annualized_value'
          and vm.parent_metric_id is null) b on true
      where m.program_id=v_program and m.organization_id=v_org),'[]'::jsonb),
    'dependencies',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'predecessorCaseId',d.predecessor_case_id,
      'successorCaseId',d.successor_case_id,'kind',d.dependency_kind,'basis',d.basis,'evidenceItemId',d.evidence_item_id)
      order by d.created_at) from public.development_project_dependencies d
      where d.program_id=v_program and d.organization_id=v_org),'[]'::jsonb),
    'benefitIntegrity',(select jsonb_build_object(
      'claimedOutcome',coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0),
      'verifiedClaimedOutcome',coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit) and vm.status='verified'),0),
      'target',p.shared_outcome_target,'capacityLimit',p.outcome_capacity_limit,'unit',p.shared_outcome_unit,
      'mismatchedBenefitCount',count(*) filter(where lower(vm.unit)<>lower(p.shared_outcome_unit)),
      'assessable',p.outcome_capacity_limit is not null,
      'potentialDoubleCount',case when p.outcome_capacity_limit is null then null
        else greatest(coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0)-p.outcome_capacity_limit,0) end,
      'constraintAdjustedClaim',case when p.outcome_capacity_limit is null then null
        else least(coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0),p.outcome_capacity_limit) end,
      'programOutcomeAtRisk',case when p.outcome_capacity_limit is null then null
        else least(coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0),p.outcome_capacity_limit)<p.shared_outcome_target end,
      'interpretation',case when p.outcome_capacity_limit is null then 'No capacity constraint is recorded; double counting cannot be assessed.'
        when coalesce(sum(vm.value) filter(where lower(vm.unit)=lower(p.shared_outcome_unit)),0)>p.outcome_capacity_limit
          then 'Project claims exceed the independently evidenced program capacity constraint; potential benefits double counting is present.'
        else 'Recorded project claims do not exceed the program capacity constraint. This is not proof that benefits will be realized.' end)
      from public.development_programs p
      left join public.development_program_projects m on m.program_id=p.id and m.organization_id=v_org
      left join public.value_metrics vm on vm.organization_id=v_org and vm.development_case_id=m.development_case_id
        and vm.objective_id=p.shared_objective_id and vm.metric_type='projected_annualized_value' and vm.parent_metric_id is null
      where p.id=v_program group by p.id),
    'availableCases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'status',c.status) order by c.title)
      from public.development_cases c where c.organization_id=v_org and c.status not in ('cancelled','completed')
        and not exists(select 1 from public.development_program_projects m where m.program_id=v_program and m.development_case_id=c.id)),'[]'::jsonb),
    'adoptedObjectives',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.description,'target',o.target,'measurement',o.measurement) order by o.description)
      from public.risk_objectives o where o.organization_id=v_org and o.status='adopted'),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.full_name,''),u.email),'role',u.role)
      order by coalesce(nullif(u.full_name,''),u.email)) from public.user_profiles u where u.organization_id=v_org and u.role<>'ai_admin'),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'label',coalesce(nullif(e.description,''),e.evidence_type,e.id::text),
      'type',e.evidence_type,'verifiedAt',e.verified_at) order by e.verified_at desc nulls last)
      from (select * from public.evidence_items where organization_id=v_org and verification_status='verified'
        order by verified_at desc nulls last limit 100) e),'[]'::jsonb),
    'decisionBoundary','Program and dependency intelligence is advisory. It does not pass a gate, sanction a project, accept risk, commit funds or authorize work.');
end $$;

revoke all on function public.create_development_program(jsonb) from public,anon,service_role;
revoke all on function public.add_project_to_development_program(uuid,uuid,text) from public,anon,service_role;
revoke all on function public.record_development_project_dependency(uuid,uuid,uuid,text,text,uuid) from public,anon,service_role;
revoke all on function public.get_development_program_workspace(uuid) from public,anon;
revoke all on function public.enforce_development_program_integrity() from public,anon,authenticated,service_role;
revoke all on function public.enforce_development_program_project_integrity() from public,anon,authenticated,service_role;
revoke all on function public.enforce_development_project_dependency_integrity() from public,anon,authenticated,service_role;
grant execute on function public.create_development_program(jsonb) to authenticated;
grant execute on function public.add_project_to_development_program(uuid,uuid,text) to authenticated;
grant execute on function public.record_development_project_dependency(uuid,uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.get_development_program_workspace(uuid) to authenticated;

comment on function public.get_development_program_workspace(uuid) is
  'D10 program composition over canonical projects, objectives, benefits and dependencies. Explicitly reports missing duration, unit mismatch, missing capacity evidence and possible double counting.';

notify pgrst,'reload schema';
