-- ============================================================================
-- Slice 7D — governed, cross-industry quality management (serialized after domain depth).
--
-- Canonical reuse:
--   acceptance_tests  -- extended in place; no competing FAT/SAT store
--   work_orders       -- every rework record classifies a real work order
--   evidence_items    -- inspection, release and closure evidence
--   approvals         -- retained as the enterprise decision/approval record
--   suppliers/assets/capital_projects -- the objects quality applies to
--
-- Seven quality metrics and Cost of Poor Quality are derived from atomic
-- records. They are never editable totals. Currencies are never combined.
-- ============================================================================

create table if not exists public.quality_requirements (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirement_ref text not null,
  title text not null,
  requirement_text text not null,
  source_kind text not null check (source_kind in
    ('contract','customer','design','regulatory','oem','internal_standard','risk_treatment')),
  source_reference text not null,
  acceptance_criterion text not null,
  verification_method text not null check (verification_method in
    ('review','inspection','measurement','analysis','demonstration','factory_test','site_test')),
  severity text not null default 'major' check (severity in ('minor','major','critical')),
  asset_id uuid references public.assets(id) on delete set null,
  project_id bigint references public.capital_projects(id) on delete set null,
  supplier_id bigint references public.suppliers(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  check ((status = 'draft' and approved_by is null and approved_at is null)
      or (status <> 'draft' and approved_by is not null and approved_at is not null
          and coalesce(length(btrim(approval_note)),0) >= 20))
);

create unique index if not exists idx_quality_requirement_ref
  on public.quality_requirements(organization_id,requirement_ref);
create index if not exists idx_quality_requirement_scope
  on public.quality_requirements(organization_id,status,asset_id,project_id);

create table if not exists public.quality_itps (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  itp_ref text not null,
  title text not null,
  revision text not null,
  scope text not null,
  procedure_reference text not null,
  asset_id uuid references public.assets(id) on delete set null,
  project_id bigint references public.capital_projects(id) on delete set null,
  supplier_id bigint references public.suppliers(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  status text not null default 'draft' check (status in
    ('draft','approved','in_progress','blocked','completed','superseded')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  check ((status = 'draft' and approved_by is null and approved_at is null)
      or (status <> 'draft' and approved_by is not null and approved_at is not null
          and coalesce(length(btrim(approval_note)),0) >= 20))
);

create unique index if not exists idx_quality_itp_ref_revision
  on public.quality_itps(organization_id,itp_ref,revision);

create table if not exists public.quality_itp_points (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  itp_id bigint not null references public.quality_itps(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  requirement_id bigint not null references public.quality_requirements(id) on delete restrict,
  control_type text not null check (control_type in ('review','witness','hold')),
  activity text not null,
  acceptance_criterion text not null,
  inspector_role text not null,
  witness_role text,
  status text not null default 'pending' check (status in
    ('pending','awaiting_release','passed','failed','waived')),
  inspection_result text check (inspection_result is null or inspection_result in ('pass','fail')),
  inspection_note text,
  evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  executed_by uuid references auth.users(id) on delete set null,
  executed_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  release_note text,
  witness_attested boolean not null default false,
  check (control_type = 'review' or coalesce(length(btrim(witness_role)),0) > 0),
  check ((status = 'pending' and executed_by is null and executed_at is null)
      or (status <> 'pending' and executed_by is not null and executed_at is not null
          and evidence_item_id is not null)),
  check (status not in ('passed','waived') or
    (case when control_type = 'review' then true
          else released_by is not null and released_at is not null
               and coalesce(length(btrim(release_note)),0) >= 20 end)),
  check (status <> 'passed' or inspection_result = 'pass'),
  check (status <> 'waived' or coalesce(length(btrim(release_note)),0) >= 20)
);

create unique index if not exists idx_quality_itp_point_sequence
  on public.quality_itp_points(itp_id,sequence_no);
create index if not exists idx_quality_itp_point_status
  on public.quality_itp_points(organization_id,status,control_type);

create table if not exists public.quality_ncrs (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ncr_ref text not null,
  requirement_id bigint references public.quality_requirements(id) on delete set null,
  itp_point_id bigint references public.quality_itp_points(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  project_id bigint references public.capital_projects(id) on delete set null,
  supplier_id bigint references public.suppliers(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  title text not null,
  description text not null,
  severity text not null check (severity in ('minor','major','critical')),
  detected_at timestamptz not null default now(),
  due_at timestamptz not null,
  owner_id uuid references public.user_profiles(id) on delete set null,
  status text not null default 'open' check (status in
    ('open','contained','dispositioned','corrective_action','verification','closed','cancelled')),
  containment_action text,
  disposition text check (disposition is null or disposition in
    ('use_as_is','repair','rework','reject','scrap','return_to_vendor','deviation')),
  disposition_basis text,
  root_cause text,
  corrective_action text,
  effectiveness_criterion text,
  closure_evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closure_note text,
  check (due_at >= detected_at),
  check ((status <> 'closed' and closed_by is null and closed_at is null)
      or (status = 'closed' and closed_by is not null and closed_at is not null
          and closure_evidence_item_id is not null
          and coalesce(length(btrim(closure_note)),0) >= 20))
);

create unique index if not exists idx_quality_ncr_ref
  on public.quality_ncrs(organization_id,ncr_ref);
create index if not exists idx_quality_ncr_aging
  on public.quality_ncrs(organization_id,status,due_at,detected_at);

create table if not exists public.quality_defects (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  defect_ref text not null,
  ncr_id bigint references public.quality_ncrs(id) on delete set null,
  requirement_id bigint references public.quality_requirements(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  project_id bigint references public.capital_projects(id) on delete set null,
  supplier_id bigint references public.suppliers(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  source_kind text not null check (source_kind in
    ('incoming','in_process','final','acceptance_test','field','customer','audit')),
  defect_code text not null,
  description text not null,
  detected_at timestamptz not null default now(),
  inspected_quantity numeric not null check (inspected_quantity > 0),
  defective_quantity numeric not null check (defective_quantity >= 0),
  first_pass_accepted_quantity numeric not null check (first_pass_accepted_quantity >= 0),
  reworked_quantity numeric not null default 0 check (reworked_quantity >= 0),
  scrapped_quantity numeric not null default 0 check (scrapped_quantity >= 0),
  repeat_defect boolean not null default false,
  scrap_cost numeric not null default 0 check (scrap_cost >= 0),
  currency text,
  cost_source text,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (defective_quantity <= inspected_quantity),
  check (first_pass_accepted_quantity <= inspected_quantity),
  check (reworked_quantity + scrapped_quantity <= defective_quantity),
  check ((scrap_cost = 0) or
    (currency ~ '^[A-Z]{3}$' and coalesce(length(btrim(cost_source)),0) >= 3))
);

create unique index if not exists idx_quality_defect_ref
  on public.quality_defects(organization_id,defect_ref);
create index if not exists idx_quality_defect_period
  on public.quality_defects(organization_id,detected_at);

create table if not exists public.quality_rework_records (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  defect_id bigint not null references public.quality_defects(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  started_at timestamptz not null,
  completed_at timestamptz,
  reworked_quantity numeric not null check (reworked_quantity > 0),
  accepted_quantity numeric check (accepted_quantity >= 0 and accepted_quantity <= reworked_quantity),
  labour_cost numeric not null default 0 check (labour_cost >= 0),
  material_cost numeric not null default 0 check (material_cost >= 0),
  equipment_cost numeric not null default 0 check (equipment_cost >= 0),
  downtime_cost numeric not null default 0 check (downtime_cost >= 0),
  external_cost numeric not null default 0 check (external_cost >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cost_basis text not null,
  cost_source text not null,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at),
  check (coalesce(length(btrim(cost_basis)),0) >= 3),
  check (coalesce(length(btrim(cost_source)),0) >= 3)
);

create index if not exists idx_quality_rework_period
  on public.quality_rework_records(organization_id,started_at);

create table if not exists public.quality_cost_entries (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ncr_id bigint references public.quality_ncrs(id) on delete set null,
  defect_id bigint references public.quality_defects(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  incurred_at timestamptz not null,
  category text not null check (category in
    ('prevention','appraisal','internal_failure','external_failure')),
  amount numeric not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cost_type text not null,
  source_reference text not null,
  evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (coalesce(length(btrim(cost_type)),0) >= 3),
  check (coalesce(length(btrim(source_reference)),0) >= 3)
);

create index if not exists idx_quality_cost_period
  on public.quality_cost_entries(organization_id,currency,incurred_at,category);

-- Extend the canonical E8 acceptance-test table rather than creating a second
-- AcceptanceTest aggregate.
alter table public.acceptance_tests
  add column if not exists requirement_id bigint references public.quality_requirements(id) on delete set null,
  add column if not exists itp_id bigint references public.quality_itps(id) on delete set null,
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists supplier_id bigint references public.suppliers(id) on delete set null,
  add column if not exists work_order_id uuid references public.work_orders(id) on delete set null,
  add column if not exists acceptance_criteria text,
  add column if not exists test_procedure_reference text,
  add column if not exists tested_samples numeric,
  add column if not exists passed_samples numeric,
  add column if not exists evidence_item_id uuid references public.evidence_items(id) on delete restrict,
  add column if not exists performed_by uuid references auth.users(id) on delete set null,
  add column if not exists release_status text not null default 'pending',
  add column if not exists released_by uuid references auth.users(id) on delete set null,
  add column if not exists released_at timestamptz,
  add column if not exists release_note text;

alter table public.acceptance_tests alter column project_id drop not null;
alter table public.acceptance_tests drop constraint if exists acceptance_tests_test_stage_check;
alter table public.acceptance_tests add constraint acceptance_tests_test_stage_check
  check (test_stage in (
    'factory_acceptance','site_acceptance','pre_commissioning','commissioning',
    'performance_test','reliability_run','receiving','in_process',
    'final_inspection','return_to_service','customer_acceptance'));

do $$ begin
  alter table public.acceptance_tests add constraint acceptance_samples_valid
    check (tested_samples is null or
      (tested_samples > 0 and passed_samples is not null and passed_samples >= 0
       and passed_samples <= tested_samples));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.acceptance_tests add constraint acceptance_sample_outcome_consistent
    check (tested_samples is null or outcome is null or outcome = 'not_performed'
      or (outcome in ('pass','pass_with_punch') and passed_samples = tested_samples)
      or (outcome = 'fail' and passed_samples < tested_samples));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.acceptance_tests add constraint acceptance_release_status_valid
    check (release_status in ('pending','released','rejected'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.acceptance_tests add constraint acceptance_release_evidenced
    check (release_status = 'pending' or
      (released_by is not null and released_at is not null
       and coalesce(length(btrim(release_note)),0) >= 20));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.acceptance_tests add constraint acceptance_has_quality_scope
    check (project_id is not null or asset_id is not null or work_order_id is not null
      or requirement_id is not null or itp_id is not null);
exception when duplicate_object then null; end $$;

-- The baseline approval record remains the canonical decision trail. These
-- nullable links let quality gates use it without changing existing flows.
alter table public.approvals
  add column if not exists quality_requirement_id bigint references public.quality_requirements(id) on delete set null,
  add column if not exists quality_itp_id bigint references public.quality_itps(id) on delete set null,
  add column if not exists quality_itp_point_id bigint references public.quality_itp_points(id) on delete set null,
  add column if not exists quality_ncr_id bigint references public.quality_ncrs(id) on delete set null,
  add column if not exists acceptance_test_id bigint references public.acceptance_tests(id) on delete set null;

alter table public.quality_requirements enable row level security;
alter table public.quality_itps enable row level security;
alter table public.quality_itp_points enable row level security;
alter table public.quality_ncrs enable row level security;
alter table public.quality_defects enable row level security;
alter table public.quality_rework_records enable row level security;
alter table public.quality_cost_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'quality_requirements','quality_itps','quality_itp_points','quality_ncrs',
    'quality_defects','quality_rework_records','quality_cost_entries'
  ] loop
    execute format('drop policy if exists %I on public.%I',t || '_org_read',t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = public.app_current_org())',
      t || '_org_read',t);
  end loop;
end $$;

create or replace function public.quality_control_role(p_role text)
returns boolean language sql immutable security invoker set search_path=public
as $$
  select coalesce(p_role,'') in (
    'admin','ai_admin','executive','owner','org_admin','quality_manager',
    'quality_engineer','engineering_manager','maintenance_manager','reliability_engineer'
  );
$$;

create or replace function public.quality_actor_has_role(
  p_actor uuid,p_org uuid,p_role text)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.user_profiles profile
    where profile.id=p_actor and profile.organization_id=p_org and profile.role=p_role
  ) or exists(
    select 1 from public.user_role_assignments assignment
    join public.roles role on role.id=assignment.role_id
    where assignment.user_id=p_actor and assignment.organization_id=p_org
      and role.organization_id=p_org and role.key=p_role
  );
$$;

create or replace function public.quality_role_exists(p_org uuid,p_role text)
returns boolean language sql stable security definer set search_path=public
as $$
  select coalesce(length(btrim(p_role)),0)>0 and (
    exists(select 1 from public.roles role where role.organization_id=p_org and role.key=p_role)
    or exists(select 1 from public.user_profiles profile where profile.organization_id=p_org and profile.role=p_role)
  );
$$;

create or replace function public.quality_evidence_in_org(p_id uuid,p_org uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select p_id is not null and exists(
    select 1 from public.evidence_items where id=p_id and organization_id=p_org
  );
$$;

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
      select 1 from public.user_profiles where id=(p_record->>'ownerId')::uuid and organization_id=p_org));
$$;

create or replace function public.record_quality_requirement(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
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
    work_order_id,created_by)
  values(v_org,btrim(p_record->>'requirementRef'),btrim(p_record->>'title'),
    btrim(p_record->>'requirementText'),p_record->>'sourceKind',btrim(p_record->>'sourceReference'),
    btrim(p_record->>'acceptanceCriterion'),p_record->>'verificationMethod',
    coalesce(p_record->>'severity','major'),(p_record->>'assetId')::uuid,
    (p_record->>'projectId')::bigint,(p_record->>'supplierId')::bigint,
    (p_record->>'workOrderId')::uuid,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_requirement','member',jsonb_build_object('id',v_id,'action','created'));
  return jsonb_build_object('id',v_id,'status','draft');
end $$;

create or replace function public.approve_quality_requirement(p_id bigint,p_note text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_creator uuid;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if not public.quality_control_role(v_role) then return jsonb_build_object('error','quality control authority required'); end if;
  select created_by into v_creator from public.quality_requirements
   where id=p_id and organization_id=v_org and status='draft' for update;
  if not found then return jsonb_build_object('error','draft quality requirement not found'); end if;
  if v_creator=v_actor then return jsonb_build_object('error','independent requirement approval is required'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','approval note must be at least 20 characters'); end if;
  update public.quality_requirements set status='approved',approved_by=v_actor,approved_at=now(),approval_note=btrim(p_note) where id=p_id;
  insert into public.approvals(organization_id,quality_requirement_id,status,owner_role,approver,reason,required_validation,decided_at)
  values(v_org,p_id,'approved',v_role,v_actor::text,btrim(p_note),'Independent review of source, acceptance criterion and verification method',now());
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_requirement',v_role,jsonb_build_object('id',p_id,'action','approved'));
  return jsonb_build_object('id',p_id,'status','approved');
end $$;

create or replace function public.record_quality_itp(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint; v_point jsonb; v_req bigint;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if coalesce(length(btrim(p_record->>'itpRef')),0)<2
     or coalesce(length(btrim(p_record->>'title')),0)<3
     or coalesce(length(btrim(p_record->>'revision')),0)<1
     or coalesce(length(btrim(p_record->>'scope')),0)<5
     or coalesce(length(btrim(p_record->>'procedureReference')),0)<3 then
    return jsonb_build_object('error','ITP reference, revision, scope and controlled procedure are required');
  end if;
  if jsonb_typeof(coalesce(p_record->'points','null'::jsonb))<>'array'
     or jsonb_array_length(p_record->'points')=0 then
    return jsonb_build_object('error','an ITP requires at least one controlled point');
  end if;
  insert into public.quality_itps(organization_id,itp_ref,title,revision,scope,
    procedure_reference,asset_id,project_id,supplier_id,work_order_id,created_by)
  values(v_org,btrim(p_record->>'itpRef'),btrim(p_record->>'title'),btrim(p_record->>'revision'),
    btrim(p_record->>'scope'),btrim(p_record->>'procedureReference'),
    (p_record->>'assetId')::uuid,(p_record->>'projectId')::bigint,
    (p_record->>'supplierId')::bigint,(p_record->>'workOrderId')::uuid,v_actor)
  returning id into v_id;
  for v_point in select value from jsonb_array_elements(p_record->'points') loop
    v_req:=(v_point->>'requirementId')::bigint;
    if not exists(select 1 from public.quality_requirements where id=v_req and organization_id=v_org) then
      raise exception 'ITP requirement is outside this organization';
    end if;
    if not public.quality_role_exists(v_org,btrim(v_point->>'inspectorRole')) then
      raise exception 'ITP inspector role is not configured for this organization';
    end if;
    if v_point->>'controlType' in ('hold','witness')
       and not public.quality_role_exists(v_org,btrim(v_point->>'witnessRole')) then
      raise exception 'ITP witness role is not configured for this organization';
    end if;
    insert into public.quality_itp_points(organization_id,itp_id,sequence_no,requirement_id,
      control_type,activity,acceptance_criterion,inspector_role,witness_role)
    values(v_org,v_id,(v_point->>'sequenceNo')::integer,v_req,v_point->>'controlType',
      btrim(v_point->>'activity'),btrim(v_point->>'acceptanceCriterion'),
      btrim(v_point->>'inspectorRole'),nullif(btrim(v_point->>'witnessRole'),''));
  end loop;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_itp','member',jsonb_build_object('id',v_id,'action','created','points',jsonb_array_length(p_record->'points')));
  return jsonb_build_object('id',v_id,'status','draft');
end $$;

create or replace function public.approve_quality_itp(p_id bigint,p_note text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text; v_creator uuid;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if not public.quality_control_role(v_role) then return jsonb_build_object('error','quality control authority required'); end if;
  select created_by into v_creator from public.quality_itps where id=p_id and organization_id=v_org and status='draft' for update;
  if not found then return jsonb_build_object('error','draft ITP not found'); end if;
  if v_creator=v_actor then return jsonb_build_object('error','independent ITP approval is required'); end if;
  if exists(select 1 from public.quality_itp_points p join public.quality_requirements r on r.id=p.requirement_id
            where p.itp_id=p_id and r.status<>'approved') then
    return jsonb_build_object('error','all ITP requirements must be approved first');
  end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','approval note must be at least 20 characters'); end if;
  update public.quality_itps set status='approved',approved_by=v_actor,approved_at=now(),approval_note=btrim(p_note) where id=p_id;
  insert into public.approvals(organization_id,quality_itp_id,status,owner_role,approver,reason,required_validation,decided_at)
  values(v_org,p_id,'approved',v_role,v_actor::text,btrim(p_note),'Independent review of every ITP control point and approved requirement',now());
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_itp',v_role,jsonb_build_object('id',p_id,'action','approved'));
  return jsonb_build_object('id',p_id,'status','approved');
end $$;

create or replace function public.record_quality_itp_point_result(
  p_point_id bigint,p_result text,p_evidence_item_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_type text; v_itp bigint; v_status text; v_inspector_role text;
begin
  if p_result not in ('pass','fail') then return jsonb_build_object('error','result must be pass or fail'); end if;
  if not public.quality_evidence_in_org(p_evidence_item_id,v_org) then return jsonb_build_object('error','same-tenant evidence is required'); end if;
  if coalesce(length(btrim(p_note)),0)<10 then return jsonb_build_object('error','inspection note must be at least 10 characters'); end if;
  select p.control_type,p.itp_id,p.inspector_role into v_type,v_itp,v_inspector_role from public.quality_itp_points p
  join public.quality_itps i on i.id=p.itp_id and i.organization_id=v_org and i.status in ('approved','in_progress','blocked')
  where p.id=p_point_id and p.organization_id=v_org and p.status='pending' for update;
  if not found then return jsonb_build_object('error','executable ITP point not found'); end if;
  if not public.quality_actor_has_role(v_actor,v_org,v_inspector_role) then
    return jsonb_build_object('error','ITP inspection requires assigned role ' || v_inspector_role); end if;
  v_status:=case when p_result='fail' then 'failed' when v_type='review' then 'passed' else 'awaiting_release' end;
  update public.quality_itp_points set status=v_status,inspection_result=p_result,inspection_note=btrim(p_note),
    evidence_item_id=p_evidence_item_id,executed_by=v_actor,executed_at=now() where id=p_point_id;
  update public.quality_itps i set status=case
    when p_result='fail' then 'blocked'
    when not exists(select 1 from public.quality_itp_points p where p.itp_id=v_itp and p.status in ('pending','awaiting_release')) then 'completed'
    else 'in_progress' end where i.id=v_itp;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_itp_point','member',jsonb_build_object('id',p_point_id,'action','inspected','result',p_result,'status',v_status));
  return jsonb_build_object('id',p_point_id,'status',v_status);
end $$;

create or replace function public.release_quality_itp_point(
  p_point_id bigint,p_decision text,p_witness_attested boolean,p_note text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_type text; v_executor uuid; v_itp bigint; v_status text; v_witness_role text;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if not public.quality_control_role(v_role) then return jsonb_build_object('error','quality control authority required'); end if;
  if p_decision not in ('release','reject','waive') then return jsonb_build_object('error','decision must be release, reject or waive'); end if;
  if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','release or waiver basis must be at least 20 characters'); end if;
  select control_type,executed_by,itp_id,witness_role into v_type,v_executor,v_itp,v_witness_role
  from public.quality_itp_points where id=p_point_id and organization_id=v_org and status='awaiting_release' for update;
  if not found then return jsonb_build_object('error','ITP point is not awaiting release'); end if;
  if v_type in ('hold','witness') and v_executor=v_actor then return jsonb_build_object('error','hold/witness-point release requires an independent actor'); end if;
  if v_type in ('hold','witness') and not public.quality_actor_has_role(v_actor,v_org,v_witness_role) then
    return jsonb_build_object('error','ITP release requires assigned role ' || v_witness_role); end if;
  if v_type='witness' and p_decision='release' and not p_witness_attested then
    return jsonb_build_object('error','witness point cannot release without witness attestation');
  end if;
  v_status:=case p_decision when 'release' then 'passed' when 'waive' then 'waived' else 'failed' end;
  update public.quality_itp_points set status=v_status,released_by=v_actor,released_at=now(),
    release_note=btrim(p_note),witness_attested=coalesce(p_witness_attested,false) where id=p_point_id;
  insert into public.approvals(organization_id,quality_itp_point_id,status,owner_role,approver,reason,required_validation,decided_at)
  values(v_org,p_point_id,case when p_decision='reject' then 'rejected' else 'approved' end,
    v_role,v_actor::text,btrim(p_note),case when v_type='hold' then 'Independent hold-point evidence release' else 'Witness attestation or controlled waiver' end,now());
  update public.quality_itps i set status=case
    when exists(select 1 from public.quality_itp_points p where p.itp_id=v_itp and p.status='failed') then 'blocked'
    when not exists(select 1 from public.quality_itp_points p where p.itp_id=v_itp and p.status in ('pending','awaiting_release')) then 'completed'
    else 'in_progress' end where i.id=v_itp;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_itp_point',v_role,jsonb_build_object('id',p_point_id,'action',p_decision,'status',v_status));
  return jsonb_build_object('id',p_point_id,'status',v_status);
end $$;

create or replace function public.record_quality_ncr(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint;
begin
  if v_org is null or v_actor is null then return jsonb_build_object('error','forbidden'); end if;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if coalesce(length(btrim(p_record->>'ncrRef')),0)<2
     or coalesce(length(btrim(p_record->>'title')),0)<3
     or coalesce(length(btrim(p_record->>'description')),0)<10
     or nullif(p_record->>'dueAt','') is null then
    return jsonb_build_object('error','NCR reference, description and due date are required');
  end if;
  if nullif(p_record->>'requirementId','') is not null and nullif(p_record->>'itpPointId','') is not null
     and not exists(select 1 from public.quality_itp_points where id=(p_record->>'itpPointId')::bigint
                    and organization_id=v_org and requirement_id=(p_record->>'requirementId')::bigint) then
    return jsonb_build_object('error','NCR requirement does not match the ITP point');
  end if;
  insert into public.quality_ncrs(organization_id,ncr_ref,requirement_id,itp_point_id,asset_id,
    project_id,supplier_id,work_order_id,title,description,severity,detected_at,due_at,owner_id,created_by)
  values(v_org,btrim(p_record->>'ncrRef'),(p_record->>'requirementId')::bigint,
    (p_record->>'itpPointId')::bigint,(p_record->>'assetId')::uuid,
    (p_record->>'projectId')::bigint,(p_record->>'supplierId')::bigint,
    (p_record->>'workOrderId')::uuid,btrim(p_record->>'title'),btrim(p_record->>'description'),
    p_record->>'severity',coalesce((p_record->>'detectedAt')::timestamptz,now()),
    (p_record->>'dueAt')::timestamptz,(p_record->>'ownerId')::uuid,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_ncr','member',jsonb_build_object('id',v_id,'action','opened'));
  return jsonb_build_object('id',v_id,'status','open');
end $$;

create or replace function public.transition_quality_ncr(p_id bigint,p_transition text,p_detail jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_current text; v_creator uuid; v_owner uuid; v_next text; v_evidence uuid;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  select status,created_by,owner_id into v_current,v_creator,v_owner from public.quality_ncrs
   where id=p_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','NCR not found'); end if;
  if v_actor<>v_creator and v_actor is distinct from v_owner and not public.quality_control_role(v_role) then
    return jsonb_build_object('error','NCR owner or quality control authority required');
  end if;
  v_next:=case
    when v_current='open' and p_transition='contain' then 'contained'
    when v_current in ('open','contained') and p_transition='disposition' then 'dispositioned'
    when v_current='dispositioned' and p_transition='correct' then 'corrective_action'
    when v_current='corrective_action' and p_transition='verify' then 'verification'
    when v_current='verification' and p_transition='close' then 'closed'
    when v_current in ('open','contained') and p_transition='cancel' then 'cancelled'
    else null end;
  if v_next is null then return jsonb_build_object('error','invalid NCR lifecycle transition'); end if;
  if v_next in ('closed','cancelled') and not public.quality_control_role(v_role) then
    return jsonb_build_object('error','quality control authority required');
  end if;
  if v_next='closed' and v_creator=v_actor then return jsonb_build_object('error','independent NCR closure is required'); end if;
  if v_next='contained' and coalesce(length(btrim(p_detail->>'containmentAction')),0)<10 then
    return jsonb_build_object('error','containment action is required'); end if;
  if v_next='dispositioned' and (p_detail->>'disposition') not in
    ('use_as_is','repair','rework','reject','scrap','return_to_vendor','deviation') then
    return jsonb_build_object('error','controlled disposition is required'); end if;
  if v_next='corrective_action' and (coalesce(length(btrim(p_detail->>'rootCause')),0)<10
     or coalesce(length(btrim(p_detail->>'correctiveAction')),0)<10) then
    return jsonb_build_object('error','root cause and corrective action are required'); end if;
  if v_next='verification' and coalesce(length(btrim(p_detail->>'effectivenessCriterion')),0)<10 then
    return jsonb_build_object('error','effectiveness criterion is required'); end if;
  if v_next='closed' then
    v_evidence:=(p_detail->>'evidenceItemId')::uuid;
    if not public.quality_evidence_in_org(v_evidence,v_org)
       or coalesce(length(btrim(p_detail->>'note')),0)<20 then
      return jsonb_build_object('error','independent closure evidence and a 20-character closure note are required');
    end if;
  end if;
  update public.quality_ncrs set status=v_next,
    containment_action=coalesce(nullif(btrim(p_detail->>'containmentAction'),''),containment_action),
    disposition=coalesce(nullif(p_detail->>'disposition',''),disposition),
    disposition_basis=coalesce(nullif(btrim(p_detail->>'dispositionBasis'),''),disposition_basis),
    root_cause=coalesce(nullif(btrim(p_detail->>'rootCause'),''),root_cause),
    corrective_action=coalesce(nullif(btrim(p_detail->>'correctiveAction'),''),corrective_action),
    effectiveness_criterion=coalesce(nullif(btrim(p_detail->>'effectivenessCriterion'),''),effectiveness_criterion),
    closure_evidence_item_id=case when v_next='closed' then v_evidence else closure_evidence_item_id end,
    closed_by=case when v_next='closed' then v_actor else closed_by end,
    closed_at=case when v_next='closed' then now() else closed_at end,
    closure_note=case when v_next='closed' then btrim(p_detail->>'note') else closure_note end
  where id=p_id;
  if v_next in ('closed','cancelled') then
    insert into public.approvals(organization_id,quality_ncr_id,status,owner_role,approver,reason,required_validation,decided_at)
    values(v_org,p_id,case when v_next='closed' then 'approved' else 'rejected' end,v_role,v_actor::text,
      coalesce(nullif(btrim(p_detail->>'note'),''),'Controlled NCR cancellation'),
      case when v_next='closed' then 'Independent effectiveness and closure-evidence review' else 'Cancellation authority review' end,now());
  end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_ncr',coalesce(v_role,'member'),jsonb_build_object('id',p_id,'from',v_current,'to',v_next));
  return jsonb_build_object('id',p_id,'status',v_next);
end $$;

create or replace function public.record_quality_defect(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint; v_evidence uuid;
begin
  v_evidence:=(p_record->>'evidenceItemId')::uuid;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if not public.quality_evidence_in_org(v_evidence,v_org) then return jsonb_build_object('error','same-tenant defect evidence is required'); end if;
  if coalesce(length(btrim(p_record->>'defectRef')),0)<2
     or coalesce(length(btrim(p_record->>'defectCode')),0)<2
     or coalesce(length(btrim(p_record->>'description')),0)<5 then
    return jsonb_build_object('error','defect reference, code and description are required');
  end if;
  if nullif(p_record->>'ncrId','') is not null and nullif(p_record->>'requirementId','') is not null
     and exists(select 1 from public.quality_ncrs where id=(p_record->>'ncrId')::bigint
       and organization_id=v_org and requirement_id is not null
       and requirement_id<>(p_record->>'requirementId')::bigint) then
    return jsonb_build_object('error','defect requirement does not match the NCR');
  end if;
  insert into public.quality_defects(organization_id,defect_ref,ncr_id,requirement_id,asset_id,
    project_id,supplier_id,work_order_id,source_kind,defect_code,description,detected_at,
    inspected_quantity,defective_quantity,first_pass_accepted_quantity,reworked_quantity,
    scrapped_quantity,repeat_defect,scrap_cost,currency,cost_source,evidence_item_id,recorded_by)
  values(v_org,btrim(p_record->>'defectRef'),(p_record->>'ncrId')::bigint,
    (p_record->>'requirementId')::bigint,(p_record->>'assetId')::uuid,
    (p_record->>'projectId')::bigint,(p_record->>'supplierId')::bigint,
    (p_record->>'workOrderId')::uuid,p_record->>'sourceKind',btrim(p_record->>'defectCode'),
    btrim(p_record->>'description'),coalesce((p_record->>'detectedAt')::timestamptz,now()),
    (p_record->>'inspectedQuantity')::numeric,(p_record->>'defectiveQuantity')::numeric,
    (p_record->>'firstPassAcceptedQuantity')::numeric,coalesce((p_record->>'reworkedQuantity')::numeric,0),
    coalesce((p_record->>'scrappedQuantity')::numeric,0),coalesce((p_record->>'repeatDefect')::boolean,false),
    coalesce((p_record->>'scrapCost')::numeric,0),upper(nullif(p_record->>'currency','')),
    nullif(btrim(p_record->>'costSource'),''),v_evidence,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_defect','member',jsonb_build_object('id',v_id,'action','recorded'));
  return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_quality_rework(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint; v_evidence uuid;
  v_defect bigint:=(p_record->>'defectId')::bigint; v_work uuid:=(p_record->>'workOrderId')::uuid;
begin
  v_evidence:=(p_record->>'evidenceItemId')::uuid;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if not exists(select 1 from public.quality_defects where id=v_defect and organization_id=v_org)
     or not exists(select 1 from public.work_orders where id=v_work and organization_id=v_org)
     or not public.quality_evidence_in_org(v_evidence,v_org) then
    return jsonb_build_object('error','same-tenant defect, canonical work order and evidence are required');
  end if;
  insert into public.quality_rework_records(organization_id,defect_id,work_order_id,started_at,
    completed_at,reworked_quantity,accepted_quantity,labour_cost,material_cost,equipment_cost,
    downtime_cost,external_cost,currency,cost_basis,cost_source,evidence_item_id,recorded_by)
  values(v_org,v_defect,v_work,(p_record->>'startedAt')::timestamptz,
    (p_record->>'completedAt')::timestamptz,(p_record->>'reworkedQuantity')::numeric,
    (p_record->>'acceptedQuantity')::numeric,coalesce((p_record->>'labourCost')::numeric,0),
    coalesce((p_record->>'materialCost')::numeric,0),coalesce((p_record->>'equipmentCost')::numeric,0),
    coalesce((p_record->>'downtimeCost')::numeric,0),coalesce((p_record->>'externalCost')::numeric,0),
    upper(p_record->>'currency'),btrim(p_record->>'costBasis'),btrim(p_record->>'costSource'),v_evidence,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_rework','member',jsonb_build_object('id',v_id,'work_order_id',v_work,'action','cost_recorded'));
  return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_quality_acceptance_test(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint; v_evidence uuid;
begin
  v_evidence:=(p_record->>'evidenceItemId')::uuid;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if not public.quality_evidence_in_org(v_evidence,v_org) then return jsonb_build_object('error','same-tenant test evidence is required'); end if;
  if coalesce(length(btrim(p_record->>'testRef')),0)<2
     or coalesce(length(btrim(p_record->>'acceptanceCriteria')),0)<5
     or coalesce(length(btrim(p_record->>'testProcedureReference')),0)<3
     or nullif(p_record->>'performedOn','') is null
     or nullif(p_record->>'outcome','') is null then
    return jsonb_build_object('error','test reference, performed date, outcome, procedure and acceptance criteria are required');
  end if;
  if nullif(p_record->>'requirementId','') is not null and nullif(p_record->>'itpId','') is not null
     and not exists(select 1 from public.quality_itp_points where itp_id=(p_record->>'itpId')::bigint
       and organization_id=v_org and requirement_id=(p_record->>'requirementId')::bigint) then
    return jsonb_build_object('error','acceptance requirement is not controlled by the supplied ITP');
  end if;
  insert into public.acceptance_tests(organization_id,project_id,test_ref,test_stage,scheduled_on,
    performed_on,outcome,punch_items_raised,punch_items_open,witnessed_by_owner,
    requirement_id,itp_id,asset_id,supplier_id,work_order_id,acceptance_criteria,
    test_procedure_reference,tested_samples,passed_samples,evidence_item_id,performed_by)
  values(v_org,(p_record->>'projectId')::bigint,btrim(p_record->>'testRef'),p_record->>'testStage',
    (p_record->>'scheduledOn')::date,(p_record->>'performedOn')::date,p_record->>'outcome',
    coalesce((p_record->>'punchItemsRaised')::integer,0),coalesce((p_record->>'punchItemsOpen')::integer,0),
    coalesce((p_record->>'witnessedByOwner')::boolean,false),(p_record->>'requirementId')::bigint,
    (p_record->>'itpId')::bigint,(p_record->>'assetId')::uuid,(p_record->>'supplierId')::bigint,
    (p_record->>'workOrderId')::uuid,btrim(p_record->>'acceptanceCriteria'),
    btrim(p_record->>'testProcedureReference'),(p_record->>'testedSamples')::numeric,
    (p_record->>'passedSamples')::numeric,v_evidence,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'acceptance_test','member',jsonb_build_object('id',v_id,'action','performed','outcome',p_record->>'outcome'));
  return jsonb_build_object('id',v_id,'releaseStatus','pending');
end $$;

create or replace function public.release_quality_acceptance_test(p_id bigint,p_decision text,p_note text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_role text;
  v_performer uuid; v_outcome text; v_open integer; v_status text;
begin
  select role into v_role from public.user_profiles where id=v_actor and organization_id=v_org;
  if not public.quality_control_role(v_role) then return jsonb_build_object('error','quality control authority required'); end if;
  if p_decision not in ('release','reject') or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','release/reject and a 20-character basis are required'); end if;
  select performed_by,outcome,punch_items_open into v_performer,v_outcome,v_open from public.acceptance_tests
   where id=p_id and organization_id=v_org and release_status='pending' for update;
  if not found then return jsonb_build_object('error','pending acceptance test not found'); end if;
  if p_decision='release' and v_performer is null then return jsonb_build_object('error','acceptance performer provenance is required before independent release'); end if;
  if v_performer=v_actor then return jsonb_build_object('error','independent acceptance release is required'); end if;
  if p_decision='release' and (v_outcome<>'pass' or v_open<>0) then
    return jsonb_build_object('error','release requires a pass outcome and zero open punch items'); end if;
  v_status:=case p_decision when 'release' then 'released' else 'rejected' end;
  update public.acceptance_tests set release_status=v_status,released_by=v_actor,released_at=now(),release_note=btrim(p_note) where id=p_id;
  insert into public.approvals(organization_id,acceptance_test_id,status,owner_role,approver,reason,required_validation,decided_at)
  values(v_org,p_id,case when v_status='released' then 'approved' else 'rejected' end,v_role,v_actor::text,
    btrim(p_note),'Independent outcome, punch-item and evidence review',now());
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'acceptance_test',v_role,jsonb_build_object('id',p_id,'action',v_status));
  return jsonb_build_object('id',p_id,'releaseStatus',v_status,
    'authorityBoundary','This quality release records evidence review; it does not certify regulatory compliance or authorize operation.');
end $$;

create or replace function public.record_quality_cost(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_org uuid:=public.app_current_org(); v_actor uuid:=auth.uid(); v_id bigint; v_evidence uuid;
begin
  v_evidence:=(p_record->>'evidenceItemId')::uuid;
  if not public.quality_scope_in_org(p_record,v_org) then return jsonb_build_object('error','one or more scoped records are outside this organization'); end if;
  if v_evidence is not null and not public.quality_evidence_in_org(v_evidence,v_org) then
    return jsonb_build_object('error','cost evidence is outside this organization'); end if;
  insert into public.quality_cost_entries(organization_id,ncr_id,defect_id,work_order_id,incurred_at,
    category,amount,currency,cost_type,source_reference,evidence_item_id,recorded_by)
  values(v_org,(p_record->>'ncrId')::bigint,(p_record->>'defectId')::bigint,
    (p_record->>'workOrderId')::uuid,(p_record->>'incurredAt')::timestamptz,
    p_record->>'category',(p_record->>'amount')::numeric,upper(p_record->>'currency'),
    btrim(p_record->>'costType'),btrim(p_record->>'sourceReference'),v_evidence,v_actor)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'quality_cost','member',jsonb_build_object('id',v_id,'action','recorded','category',p_record->>'category'));
  return jsonb_build_object('id',v_id,'status','recorded');
end $$;

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
  'requirements',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select r.* from quality_requirements r,bounds where r.organization_id=org order by r.created_at desc limit 100) q),'[]'::jsonb),
  'itps',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select i.* from quality_itps i,bounds where i.organization_id=org order by i.created_at desc limit 100) q),'[]'::jsonb),
  'itpPoints',coalesce((select jsonb_agg(to_jsonb(q) order by q.itp_id,q.sequence_no) from (select p.* from quality_itp_points p,bounds where p.organization_id=org order by p.itp_id desc,p.sequence_no limit 500) q),'[]'::jsonb),
  'ncrs',coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('ageDays',floor(greatest(0,extract(epoch from (coalesce(q.closed_at,now())-q.detected_at))/86400)),'overdue',q.status not in ('closed','cancelled') and q.due_at<now()) order by q.detected_at desc) from (select x.* from quality_ncrs x,bounds where x.organization_id=org order by x.detected_at desc limit 100) q),'[]'::jsonb),
  'defects',coalesce((select jsonb_agg(to_jsonb(q) order by q.detected_at desc) from (select x.* from quality_defects x,bounds where x.organization_id=org order by x.detected_at desc limit 100) q),'[]'::jsonb),
  'rework',coalesce((select jsonb_agg(to_jsonb(q) order by q.started_at desc) from (select x.* from quality_rework_records x,bounds where x.organization_id=org order by x.started_at desc limit 100) q),'[]'::jsonb),
  'acceptanceTests',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc) from (select x.* from acceptance_tests x,bounds where x.organization_id=org order by x.created_at desc limit 100) q),'[]'::jsonb),
  'basis','Seven metrics derive from recorded quantities, test outcomes and NCR dates. COPQ is internal plus external failure cost only. Prevention and appraisal are shown separately. Currencies are never combined.'
);
$$;

revoke all on function public.quality_control_role(text) from public,anon,authenticated;
revoke all on function public.quality_actor_has_role(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.quality_role_exists(uuid,text) from public,anon,authenticated;
revoke all on function public.quality_evidence_in_org(uuid,uuid) from public,anon,authenticated;
revoke all on function public.quality_scope_in_org(jsonb,uuid) from public,anon,authenticated;
revoke all on function public.record_quality_requirement(jsonb) from public,anon;
revoke all on function public.approve_quality_requirement(bigint,text) from public,anon;
revoke all on function public.record_quality_itp(jsonb) from public,anon;
revoke all on function public.approve_quality_itp(bigint,text) from public,anon;
revoke all on function public.record_quality_itp_point_result(bigint,text,uuid,text) from public,anon;
revoke all on function public.release_quality_itp_point(bigint,text,boolean,text) from public,anon;
revoke all on function public.record_quality_ncr(jsonb) from public,anon;
revoke all on function public.transition_quality_ncr(bigint,text,jsonb) from public,anon;
revoke all on function public.record_quality_defect(jsonb) from public,anon;
revoke all on function public.record_quality_rework(jsonb) from public,anon;
revoke all on function public.record_quality_acceptance_test(jsonb) from public,anon;
revoke all on function public.release_quality_acceptance_test(bigint,text,text) from public,anon;
revoke all on function public.record_quality_cost(jsonb) from public,anon;
revoke all on function public.get_quality_cockpit(timestamptz,timestamptz) from public,anon;

grant select on public.quality_requirements,public.quality_itps,public.quality_itp_points,
  public.quality_ncrs,public.quality_defects,public.quality_rework_records,
  public.quality_cost_entries to authenticated;
grant execute on function public.record_quality_requirement(jsonb),
  public.approve_quality_requirement(bigint,text),public.record_quality_itp(jsonb),
  public.approve_quality_itp(bigint,text),public.record_quality_itp_point_result(bigint,text,uuid,text),
  public.release_quality_itp_point(bigint,text,boolean,text),public.record_quality_ncr(jsonb),
  public.transition_quality_ncr(bigint,text,jsonb),public.record_quality_defect(jsonb),
  public.record_quality_rework(jsonb),public.record_quality_acceptance_test(jsonb),
  public.release_quality_acceptance_test(bigint,text,text),public.record_quality_cost(jsonb),
  public.get_quality_cockpit(timestamptz,timestamptz) to authenticated;

notify pgrst,'reload schema';
