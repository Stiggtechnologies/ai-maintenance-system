-- D8.06 / III.§29 — commissioning decomposition above the ONE acceptance-test store.
-- CommissioningResult is an acceptance_tests row; no parallel result or approval store.

create table if not exists public.commissioning_systems (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_case_id uuid not null references public.development_cases(id) on delete cascade,
  project_id bigint not null references public.capital_projects(id) on delete cascade,
  system_ref text not null,
  title text not null,
  description text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, development_case_id, system_ref),
  check (length(btrim(system_ref)) >= 2),
  check (length(btrim(title)) >= 3),
  check (length(btrim(description)) >= 20)
);

create table if not exists public.commissioning_subsystems (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  subsystem_ref text not null,
  title text not null,
  description text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id,system_id) references public.commissioning_systems(organization_id,id) on delete cascade,
  unique (organization_id,system_id,id),
  unique (organization_id, system_id, subsystem_ref),
  check (length(btrim(subsystem_ref)) >= 2),
  check (length(btrim(title)) >= 3),
  check (length(btrim(description)) >= 20)
);

create table if not exists public.commissioning_test_packages (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system_id bigint not null references public.commissioning_systems(id) on delete cascade,
  subsystem_id bigint references public.commissioning_subsystems(id) on delete restrict,
  package_ref text not null,
  title text not null,
  scope text not null,
  required_by date,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id,system_id) references public.commissioning_systems(organization_id,id) on delete cascade,
  foreign key (organization_id,system_id,subsystem_id) references public.commissioning_subsystems(organization_id,system_id,id) on delete restrict,
  unique (organization_id,system_id,id),
  unique (organization_id,id),
  unique (organization_id, system_id, package_ref),
  check (length(btrim(package_ref)) >= 2),
  check (length(btrim(title)) >= 3),
  check (length(btrim(scope)) >= 20)
);

create table if not exists public.commissioning_procedures (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  test_package_id bigint not null references public.commissioning_test_packages(id) on delete cascade,
  procedure_ref text not null,
  title text not null,
  acceptance_criteria text not null,
  source_reference text not null,
  evidence_class text not null check (evidence_class in
    ('MEASURED','INSPECTED','CALCULATED','TESTED','DOCUMENTED','HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE')),
  assessment_basis text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id,test_package_id) references public.commissioning_test_packages(organization_id,id) on delete cascade,
  unique (organization_id,test_package_id,id),
  unique (organization_id, test_package_id, procedure_ref),
  check (length(btrim(procedure_ref)) >= 2),
  check (length(btrim(title)) >= 3),
  check (length(btrim(acceptance_criteria)) >= 10),
  check (length(btrim(source_reference)) >= 3),
  check (length(btrim(assessment_basis)) >= 20)
);

alter table public.acceptance_tests
  add column if not exists commissioning_system_id bigint references public.commissioning_systems(id) on delete restrict,
  add column if not exists commissioning_subsystem_id bigint references public.commissioning_subsystems(id) on delete restrict,
  add column if not exists commissioning_test_package_id bigint references public.commissioning_test_packages(id) on delete restrict,
  add column if not exists commissioning_procedure_id bigint references public.commissioning_procedures(id) on delete restrict;

create index if not exists idx_commissioning_system_case on public.commissioning_systems(organization_id,development_case_id);
create index if not exists idx_commissioning_subsystem_system on public.commissioning_subsystems(organization_id,system_id);
create index if not exists idx_commissioning_package_system on public.commissioning_test_packages(organization_id,system_id);
create index if not exists idx_commissioning_procedure_package on public.commissioning_procedures(organization_id,test_package_id);
create index if not exists idx_acceptance_commissioning_system on public.acceptance_tests(organization_id,commissioning_system_id);

alter table public.commissioning_systems enable row level security;
alter table public.commissioning_subsystems enable row level security;
alter table public.commissioning_test_packages enable row level security;
alter table public.commissioning_procedures enable row level security;
do $$ declare t text; begin
  foreach t in array array['commissioning_systems','commissioning_subsystems','commissioning_test_packages','commissioning_procedures'] loop
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id=public.app_current_org())',t||'_read',t);
  end loop;
end $$;

create or replace function public.commissioning_author_role(p_role text)
returns boolean language sql immutable as $$
  select coalesce(lower(p_role),'') in ('admin','executive','maintenance_manager','reliability_engineer','planner','supervisor');
$$;

create or replace function public.record_commissioning_object(p_case_id uuid,p_kind text,p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; c development_cases%rowtype;
  v_id bigint; v_parent bigint; v_system bigint; v_owner uuid;
begin
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then return jsonb_build_object('error','human commissioning planning authority required'); end if;
  select * into c from development_cases where id=p_case_id and organization_id=v_org;
  if not found or c.capital_project_id is null then return jsonb_build_object('error','same-tenant development case with a capital project is required'); end if;
  if p_kind='system' then
    v_owner:=nullif(p_record->>'ownerId','')::uuid;
    if not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then return jsonb_build_object('error','owner must be a member of this organization'); end if;
    insert into commissioning_systems(organization_id,development_case_id,project_id,system_ref,title,description,owner_id,created_by)
    values(v_org,c.id,c.capital_project_id,btrim(p_record->>'ref'),btrim(p_record->>'title'),btrim(p_record->>'description'),v_owner,v_actor) returning id into v_id;
  elsif p_kind='subsystem' then
    v_owner:=nullif(p_record->>'ownerId','')::uuid;
    if not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then return jsonb_build_object('error','owner must be a member of this organization'); end if;
    v_system:=nullif(p_record->>'systemId','')::bigint;
    if not exists(select 1 from commissioning_systems where id=v_system and organization_id=v_org and development_case_id=c.id) then return jsonb_build_object('error','same-case commissioning system is required'); end if;
    insert into commissioning_subsystems(organization_id,system_id,subsystem_ref,title,description,owner_id,created_by)
    values(v_org,v_system,btrim(p_record->>'ref'),btrim(p_record->>'title'),btrim(p_record->>'description'),v_owner,v_actor) returning id into v_id;
  elsif p_kind='test_package' then
    v_owner:=nullif(p_record->>'ownerId','')::uuid;
    if not exists(select 1 from user_profiles where id=v_owner and organization_id=v_org) then return jsonb_build_object('error','owner must be a member of this organization'); end if;
    v_system:=nullif(p_record->>'systemId','')::bigint; v_parent:=nullif(p_record->>'subsystemId','')::bigint;
    if not exists(select 1 from commissioning_systems where id=v_system and organization_id=v_org and development_case_id=c.id) then return jsonb_build_object('error','same-case commissioning system is required'); end if;
    if v_parent is not null and not exists(select 1 from commissioning_subsystems where id=v_parent and organization_id=v_org and system_id=v_system) then return jsonb_build_object('error','subsystem must belong to the supplied system'); end if;
    insert into commissioning_test_packages(organization_id,system_id,subsystem_id,package_ref,title,scope,required_by,owner_id,created_by)
    values(v_org,v_system,v_parent,btrim(p_record->>'ref'),btrim(p_record->>'title'),btrim(p_record->>'description'),nullif(p_record->>'requiredBy','')::date,v_owner,v_actor) returning id into v_id;
  elsif p_kind='procedure' then
    v_parent:=nullif(p_record->>'testPackageId','')::bigint;
    select p.system_id into v_system from commissioning_test_packages p join commissioning_systems s on s.id=p.system_id
      where p.id=v_parent and p.organization_id=v_org and s.development_case_id=c.id;
    if v_system is null then return jsonb_build_object('error','same-case test package is required'); end if;
    insert into commissioning_procedures(organization_id,test_package_id,procedure_ref,title,acceptance_criteria,source_reference,evidence_class,assessment_basis,created_by)
    values(v_org,v_parent,btrim(p_record->>'ref'),btrim(p_record->>'title'),btrim(p_record->>'acceptanceCriteria'),btrim(p_record->>'sourceReference'),p_record->>'evidenceClass',btrim(p_record->>'assessmentBasis'),v_actor) returning id into v_id;
  else return jsonb_build_object('error','kind must be system, subsystem, test_package or procedure');
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'commissioning_'||p_kind,v_role,jsonb_build_object('id',v_id,'case_id',c.id,'action','recorded'));
  return jsonb_build_object('id',v_id,'kind',p_kind,'status','recorded');
exception when check_violation or unique_violation or invalid_text_representation then
  return jsonb_build_object('error','commissioning record is incomplete, invalid or duplicates an existing reference');
end $$;

create or replace function public.record_commissioning_result(p_case_id uuid,p_procedure_id bigint,p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_id bigint; v_project bigint;
  v_system bigint; v_subsystem bigint; v_package bigint; v_criteria text; v_ref text; v_evidence uuid;
begin
  select role into v_role from user_profiles where id=v_actor and organization_id=v_org;
  if not public.commissioning_author_role(v_role) then return jsonb_build_object('error','human commissioning execution authority required'); end if;
  select s.project_id,s.id,pk.subsystem_id,pk.id,pr.acceptance_criteria,pr.procedure_ref
    into v_project,v_system,v_subsystem,v_package,v_criteria,v_ref
    from commissioning_procedures pr join commissioning_test_packages pk on pk.id=pr.test_package_id
    join commissioning_systems s on s.id=pk.system_id
    where pr.id=p_procedure_id and pr.organization_id=v_org and s.development_case_id=p_case_id;
  if not found then return jsonb_build_object('error','same-case commissioning procedure is required'); end if;
  if coalesce(length(btrim(p_record->>'testRef')),0)<2
     or nullif(p_record->>'performedOn','') is null
     or coalesce(p_record->>'testStage','') not in ('pre_commissioning','commissioning','performance_test','reliability_run')
     or coalesce(p_record->>'outcome','') not in ('pass','pass_with_punch','fail','not_performed') then
    return jsonb_build_object('error','test reference, performed date, commissioning stage and outcome are required');
  end if;
  if coalesce(nullif(p_record->>'punchItemsRaised','')::int,0)<0
     or coalesce(nullif(p_record->>'punchItemsOpen','')::int,0)<0
     or coalesce(nullif(p_record->>'punchItemsOpen','')::int,0)>coalesce(nullif(p_record->>'punchItemsRaised','')::int,0) then
    return jsonb_build_object('error','punch counts must be non-negative and open cannot exceed raised');
  end if;
  v_evidence:=nullif(p_record->>'evidenceItemId','')::uuid;
  if not exists(select 1 from evidence_items where id=v_evidence and organization_id=v_org) then return jsonb_build_object('error','same-tenant test evidence is required'); end if;
  insert into acceptance_tests(organization_id,project_id,test_ref,test_stage,scheduled_on,performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,acceptance_criteria,test_procedure_reference,evidence_item_id,performed_by,commissioning_system_id,commissioning_subsystem_id,commissioning_test_package_id,commissioning_procedure_id)
  values(v_org,v_project,btrim(p_record->>'testRef'),p_record->>'testStage',nullif(p_record->>'scheduledOn','')::date,nullif(p_record->>'performedOn','')::date,p_record->>'outcome',coalesce(nullif(p_record->>'punchItemsRaised','')::int,0),coalesce(nullif(p_record->>'punchItemsOpen','')::int,0),coalesce(nullif(p_record->>'witnessedByOwner','')::boolean,false),v_criteria,v_ref,v_evidence,v_actor,v_system,v_subsystem,v_package,p_procedure_id) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'acceptance_test',v_role,jsonb_build_object('id',v_id,'procedure_id',p_procedure_id,'action','performed','outcome',p_record->>'outcome'));
  return jsonb_build_object('id',v_id,'releaseStatus','pending','resultStore','acceptance_tests');
exception when check_violation or unique_violation or invalid_text_representation then
  return jsonb_build_object('error','commissioning result is incomplete, invalid or duplicates an existing test reference');
end $$;

create or replace function public.get_case_commissioning(p_case_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_result jsonb;
begin
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then return jsonb_build_object('error','development case not found'); end if;
  select jsonb_build_object(
    'caseId',p_case_id,
    'systems',coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'ref',s.system_ref,'title',s.title,'description',s.description,'ownerId',s.owner_id,
      'subsystems',(select coalesce(jsonb_agg(jsonb_build_object('id',ss.id,'ref',ss.subsystem_ref,'title',ss.title,'description',ss.description,'ownerId',ss.owner_id) order by ss.subsystem_ref),'[]'::jsonb) from commissioning_subsystems ss where ss.system_id=s.id),
      'testPackages',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'ref',p.package_ref,'title',p.title,'scope',p.scope,'subsystemId',p.subsystem_id,'requiredBy',p.required_by,
        'procedures',(select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'ref',pr.procedure_ref,'title',pr.title,'acceptanceCriteria',pr.acceptance_criteria,'sourceReference',pr.source_reference,'evidenceClass',pr.evidence_class,'assessmentBasis',pr.assessment_basis) order by pr.procedure_ref),'[]'::jsonb) from commissioning_procedures pr where pr.test_package_id=p.id)) order by p.package_ref),'[]'::jsonb) from commissioning_test_packages p where p.system_id=s.id),
      'rollup',jsonb_build_object(
        'resultCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id),
        'releasedCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.release_status='released'),
        'failedCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.outcome='fail'),
        'openPunchCount',(select coalesce(sum(a.punch_items_open),0) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id),
        'pendingReleaseCount',(select count(*) from acceptance_tests a where a.organization_id=v_org and a.commissioning_system_id=s.id and a.release_status='pending'))
    ) order by s.system_ref),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'systemId',a.commissioning_system_id,'subsystemId',a.commissioning_subsystem_id,'testPackageId',a.commissioning_test_package_id,'procedureId',a.commissioning_procedure_id,'testRef',a.test_ref,'testStage',a.test_stage,'performedOn',a.performed_on,'outcome',a.outcome,'punchItemsOpen',a.punch_items_open,'witnessedByOwner',a.witnessed_by_owner,'releaseStatus',a.release_status) order by a.created_at desc) from acceptance_tests a join commissioning_systems sx on sx.id=a.commissioning_system_id where sx.development_case_id=p_case_id and a.organization_id=v_org),'[]'::jsonb),
    'resultStore','acceptance_tests',
    'decisionBoundary','Commissioning results and rollups are evidence. Independent quality release remains separate and neither this read nor its writers authorize energization, operation, acceptance or handover.'
  ) into v_result from commissioning_systems s where s.organization_id=v_org and s.development_case_id=p_case_id;
  return v_result;
end $$;

revoke all on function public.record_commissioning_object(uuid,text,jsonb) from public;
revoke all on function public.record_commissioning_result(uuid,bigint,jsonb) from public;
revoke all on function public.get_case_commissioning(uuid) from public;
grant execute on function public.record_commissioning_object(uuid,text,jsonb) to authenticated;
grant execute on function public.record_commissioning_result(uuid,bigint,jsonb) to authenticated;
grant execute on function public.get_case_commissioning(uuid) to authenticated;

comment on table public.commissioning_systems is 'D8.06 §29 system decomposition above canonical acceptance_tests.';
comment on column public.acceptance_tests.commissioning_procedure_id is 'D8.06 CommissioningResult link: the result remains in acceptance_tests.';
