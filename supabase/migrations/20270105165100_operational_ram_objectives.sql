-- ============================================================================
-- C8.02 — convert operational requirements into measurable RAM and lifecycle
-- objectives without creating a second requirement, objective, KPI, evidence,
-- lifecycle-plan or RAM store.
--
-- Canonical chain:
--   design_requirements
--     -> adopted risk_objectives
--     -> ram_targets (this migration extends the existing row)
--     -> kpi_catalog
--     -> verified evidence_items
--     -> independently adopted asset_lifecycle_plans
--
-- A proposed conversion has no authority.  A different named human verifies
-- the frozen chain.  Verification still cannot create work, approve another
-- decision, accept risk, commit spend, change an operating limit, or return an
-- asset to service.
-- ============================================================================

alter table public.ram_targets
  add column if not exists source_requirement_id bigint
    references public.design_requirements(id) on delete restrict,
  add column if not exists objective_id uuid
    references public.risk_objectives(id) on delete restrict,
  add column if not exists operating_kpi_key text
    references public.kpi_catalog(kpi_key) on delete restrict,
  add column if not exists lifecycle_plan_id uuid
    references public.asset_lifecycle_plans(id) on delete restrict,
  add column if not exists evidence_item_id uuid
    references public.evidence_items(id) on delete restrict,
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists maintainability_target numeric,
  add column if not exists maintainability_unit text,
  add column if not exists maintainability_measure text,
  add column if not exists translation_basis text,
  add column if not exists translation_status text,
  add column if not exists translation_revision integer,
  add column if not exists supersedes_target_id bigint
    references public.ram_targets(id) on delete restrict,
  add column if not exists proposed_by uuid references auth.users(id),
  add column if not exists proposed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists translation_snapshot jsonb;

alter table public.ram_targets
  drop constraint if exists ram_targets_translation_status_valid;
alter table public.ram_targets
  add constraint ram_targets_translation_status_valid check (
    translation_status is null
    or translation_status in ('proposed','verified','rejected','superseded')
  );

alter table public.ram_targets
  drop constraint if exists ram_targets_translation_complete;
alter table public.ram_targets
  add constraint ram_targets_translation_complete check (
    translation_status is null
    or (
      source_requirement_id is not null
      and objective_id is not null
      and operating_kpi_key is not null
      and lifecycle_plan_id is not null
      and evidence_item_id is not null
      and owner_id is not null
      and reliability_target is not null and reliability_target > 0
      and reliability_unit is not null and btrim(reliability_unit) <> ''
      and maintainability_target is not null and maintainability_target > 0
      and maintainability_unit is not null and btrim(maintainability_unit) <> ''
      and maintainability_measure is not null and btrim(maintainability_measure) <> ''
      and translation_basis is not null and length(btrim(translation_basis)) >= 20
      and translation_revision is not null and translation_revision > 0
      and proposed_by is not null and proposed_at is not null
      and translation_snapshot is not null
      and jsonb_typeof(translation_snapshot) = 'object'
      and (
        (translation_status = 'proposed'
          and reviewed_by is null and reviewed_at is null and review_note is null)
        or
        (translation_status in ('verified','rejected','superseded')
          and reviewed_by is not null and reviewed_at is not null
          and review_note is not null and length(btrim(review_note)) >= 20)
      )
    )
  );

create unique index if not exists uq_ram_target_requirement_revision
  on public.ram_targets(organization_id,source_requirement_id,translation_revision)
  where translation_status is not null;

create unique index if not exists uq_ram_target_open_requirement_translation
  on public.ram_targets(organization_id,source_requirement_id)
  where translation_status='proposed';

create index if not exists idx_ram_target_requirement_translation
  on public.ram_targets(organization_id,translation_status,source_requirement_id)
  where translation_status is not null;

-- Every writer, including service roles, must preserve the canonical chain.
create or replace function public.enforce_operational_ram_objective_translation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_marker text:=coalesce(current_setting('app.operational_ram_objective_write',true),'');
  d public.design_requirements%rowtype;
  o public.risk_objectives%rowtype;
  l public.asset_lifecycle_plans%rowtype;
  e public.evidence_items%rowtype;
begin
  if tg_op='DELETE' then
    if old.translation_status is not null then
      raise exception 'translated RAM targets are retained; supersede the verified conversion rather than deleting its evidence chain';
    end if;
    return old;
  end if;

  if tg_op='UPDATE' and old.translation_status is not null then
    if v_marker<>'granted' then
      raise exception 'translated RAM targets are changed only through the governed conversion workflow';
    end if;
    if new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or new.development_case_id is distinct from old.development_case_id
      or new.asset_id is distinct from old.asset_id
      or new.system_label is distinct from old.system_label
      or new.target_availability is distinct from old.target_availability
      or new.target_basis is distinct from old.target_basis
      or new.configuration is distinct from old.configuration
      or new.reliability_target is distinct from old.reliability_target
      or new.reliability_unit is distinct from old.reliability_unit
      or new.maintainability_target is distinct from old.maintainability_target
      or new.maintainability_unit is distinct from old.maintainability_unit
      or new.maintainability_measure is distinct from old.maintainability_measure
      or new.source_requirement_id is distinct from old.source_requirement_id
      or new.objective_id is distinct from old.objective_id
      or new.operating_kpi_key is distinct from old.operating_kpi_key
      or new.lifecycle_plan_id is distinct from old.lifecycle_plan_id
      or new.evidence_item_id is distinct from old.evidence_item_id
      or new.owner_id is distinct from old.owner_id
      or new.translation_basis is distinct from old.translation_basis
      or new.translation_revision is distinct from old.translation_revision
      or new.supersedes_target_id is distinct from old.supersedes_target_id
      or new.proposed_by is distinct from old.proposed_by
      or new.proposed_at is distinct from old.proposed_at
      or new.translation_snapshot is distinct from old.translation_snapshot then
      raise exception 'translation content is immutable; propose the next revision against the new canonical records';
    end if;
    if old.translation_status='proposed'
       and new.translation_status not in ('verified','rejected') then
      raise exception 'a proposed conversion can only be independently verified or rejected';
    end if;
    if old.translation_status='verified'
       and new.translation_status<>'superseded' then
      raise exception 'a verified conversion can only be superseded by a new independently verified revision';
    end if;
    if old.translation_status in ('rejected','superseded') then
      raise exception 'decided RAM-objective translation history is immutable';
    end if;
  elsif new.translation_status is not null and v_marker<>'granted' then
    raise exception 'translated RAM targets are changed only through the governed conversion workflow';
  end if;

  if new.translation_status is null then
    return new;
  end if;

  select * into d from public.design_requirements
  where id=new.source_requirement_id and organization_id=new.organization_id;
  if not found then
    raise exception 'the operational requirement must belong to the RAM target organization';
  end if;
  if d.project_id is distinct from new.project_id
     or new.development_case_id is not null
     or d.satisfied_by_asset_id is distinct from new.asset_id
     or d.objective_id is distinct from new.objective_id
     or d.operating_kpi_key is distinct from new.operating_kpi_key
     or d.owner_id is distinct from new.owner_id then
    raise exception 'the RAM target must freeze the exact project, asset, objective, KPI and owner carried by the canonical requirement; development-case warranty remains a separate purpose';
  end if;

  select * into o from public.risk_objectives
  where id=new.objective_id and organization_id=new.organization_id and status='adopted';
  if not found then
    raise exception 'the requirement objective must be an adopted same-tenant risk objective';
  end if;

  select * into l from public.asset_lifecycle_plans lp
  where lp.id=new.lifecycle_plan_id and lp.organization_id=new.organization_id
    and lp.asset_id=d.satisfied_by_asset_id;
  if not found then
    raise exception 'the lifecycle objective must be an independently adopted plan for the requirement asset';
  end if;
  if exists(select 1 from public.asset_lifecycle_plans newer
    where newer.organization_id=l.organization_id and newer.asset_id=l.asset_id
      and newer.version>l.version) then
    raise exception 'the latest adopted lifecycle-plan version is required; a superseded objective cannot govern a new RAM conversion';
  end if;

  select * into e from public.evidence_items ei
  where ei.id=new.evidence_item_id and ei.organization_id=new.organization_id
    and ei.asset_id=d.satisfied_by_asset_id and ei.verification_status='verified'
    and ei.verified_by is not null and ei.verified_at is not null
    and nullif(btrim(ei.verification_method),'') is not null;
  if not found then
    raise exception 'the conversion requires verified same-tenant evidence for the exact requirement asset';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_operational_ram_objective_translation()
  from public,anon,authenticated;

drop trigger if exists trg_operational_ram_objective_translation on public.ram_targets;
create trigger trg_operational_ram_objective_translation
  before insert or update or delete on public.ram_targets
  for each row execute function public.enforce_operational_ram_objective_translation();

revoke insert,update,delete,truncate on table public.ram_targets
  from public,anon,authenticated;

-- Proposed/rejected translations never appear as active RAM allocations.
create or replace function public.get_ram_allocation(p_project_code text)
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'systemLabel',t.system_label,
    'targetAvailability',t.target_availability,
    'configuration',t.configuration,
    'targetBasis',t.target_basis,
    'subsystems',coalesce((select jsonb_agg(jsonb_build_object(
      'label',a.subsystem_label,
      'allocated',a.allocated_availability,
      'demonstrated',a.demonstrated_availability,
      'complexityWeight',a.complexity_weight,
      'evidence',a.evidence) order by a.subsystem_label)
      from public.ram_allocations a where a.target_id=t.id),'[]'::jsonb))),
    '[]'::jsonb)
  from public.ram_targets t
  join public.capital_projects c on c.id=t.project_id
  where c.organization_id=public.app_current_org()
    and c.project_code=p_project_code
    and (t.translation_status is null or t.translation_status='verified');
$$;

revoke all on function public.get_ram_allocation(text) from public,anon;
grant execute on function public.get_ram_allocation(text) to authenticated;

-- The D9 warranty read is a different purpose over the same canonical table.
-- A C8.02 RAM conversion is not silently sold as a seven-metric warranty.
create or replace function public.get_case_operational_warranty(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  c public.development_cases%rowtype;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into c from public.development_cases
  where id=p_case_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','development case not found'); end if;
  if c.capital_project_id is null then
    return jsonb_build_object(
      'caseId',c.id,'available',false,
      'reason','an operational warranty binds to the delivery-side capital project — this case has none',
      'warranties','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'caseId',c.id,'available',true,'capitalProjectId',c.capital_project_id,
    'warranties',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'systemLabel',t.system_label,
      'survivesHandover',t.survives_handover,'startupAt',t.startup_at,
      'basis',t.warranty_basis,'assetId',t.asset_id,
      'metrics',jsonb_build_array(
        jsonb_build_object('key','availability','target',t.target_availability,'unit','fraction'),
        jsonb_build_object('key','throughput','target',t.throughput_target,'unit',t.throughput_unit),
        jsonb_build_object('key','reliability','target',t.reliability_target,'unit',t.reliability_unit),
        jsonb_build_object('key','maintenance_cost','target',t.maintenance_cost_target,'unit',t.maintenance_cost_unit),
        jsonb_build_object('key','energy','target',t.energy_target,'unit',t.energy_unit),
        jsonb_build_object('key','quality','target',t.quality_target,'unit',t.quality_unit),
        jsonb_build_object('key','operating_cost','target',t.operating_cost_target,'unit',t.operating_cost_unit)
      )) order by t.system_label,t.id)
      from public.ram_targets t
      where t.organization_id=v_org
        and (t.development_case_id=c.id or t.project_id=c.capital_project_id)
        and t.translation_status is null),'[]'::jsonb));
end
$$;

revoke all on function public.get_case_operational_warranty(uuid) from public,anon;
grant execute on function public.get_case_operational_warranty(uuid)
  to authenticated,service_role;

create or replace function public.propose_operational_ram_objective(
  p_requirement_id bigint,
  p_lifecycle_plan_id uuid,
  p_evidence_item_id uuid,
  p_system_label text,
  p_availability_target numeric,
  p_reliability_target numeric,
  p_reliability_unit text,
  p_maintainability_target numeric,
  p_maintainability_unit text,
  p_maintainability_measure text,
  p_configuration text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  d public.design_requirements%rowtype;
  o public.risk_objectives%rowtype;
  l public.asset_lifecycle_plans%rowtype;
  e public.evidence_items%rowtype;
  v_previous public.ram_targets%rowtype;
  v_revision integer:=1;
  v_id bigint;
  v_snapshot jsonb;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error','RAM targets must be supplied by a named human in planning, reliability, maintenance or governance');
  end if;

  select * into d from public.design_requirements
  where id=p_requirement_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','operational requirement not found'); end if;
  if d.project_id is null or d.development_case_id is null then
    return jsonb_build_object('error','the requirement must belong to one development case and capital project');
  end if;
  if d.satisfied_by_asset_id is null then
    return jsonb_build_object('error','link the requirement to the installed canonical asset before translating it');
  end if;
  if d.owner_id is null or not exists(select 1 from public.user_profiles u
    where u.id=d.owner_id and u.organization_id=v_org) then
    return jsonb_build_object('error','the operational requirement needs a named same-tenant owner');
  end if;
  if d.objective_id is null or d.operating_kpi_key is null
     or d.verification_method is null
     or coalesce(length(btrim(d.acceptance_criteria)),0)<10 then
    return jsonb_build_object('error','complete the requirement objective, one operating KPI, verification method and measurable acceptance criteria first');
  end if;

  select * into o from public.risk_objectives
  where id=d.objective_id and organization_id=v_org and status='adopted';
  if not found then
    return jsonb_build_object('error','the requirement must trace to an adopted measurable objective');
  end if;
  if not exists(select 1 from public.kpi_catalog k where k.kpi_key=d.operating_kpi_key) then
    return jsonb_build_object('error','the requirement operating KPI is not in the canonical KPI catalogue');
  end if;

  select * into l from public.asset_lifecycle_plans
  where id=p_lifecycle_plan_id and organization_id=v_org
    and asset_id=d.satisfied_by_asset_id;
  if not found then
    return jsonb_build_object('error','choose an independently adopted lifecycle plan for the requirement asset');
  end if;
  if exists(select 1 from public.asset_lifecycle_plans newer
    where newer.organization_id=v_org and newer.asset_id=l.asset_id
      and newer.version>l.version) then
    return jsonb_build_object('error','choose the latest adopted lifecycle-plan version');
  end if;

  select * into e from public.evidence_items ei
  where ei.id=p_evidence_item_id and ei.organization_id=v_org
    and ei.asset_id=d.satisfied_by_asset_id and ei.verification_status='verified'
    and ei.verified_by is not null and ei.verified_at is not null
    and nullif(btrim(ei.verification_method),'') is not null
    and (ei.risk_id is null or public.can_read_risk(ei.risk_id));
  if not found then
    return jsonb_build_object('error','choose visible verified same-tenant evidence for the exact requirement asset');
  end if;

  if coalesce(length(btrim(p_system_label)),0)<2 then
    return jsonb_build_object('error','name the system or service boundary the RAM objective governs');
  end if;
  if p_availability_target is null
     or p_availability_target<=0 or p_availability_target>=1 then
    return jsonb_build_object('error','availability must be a fraction strictly between zero and one');
  end if;
  if p_reliability_target is null or p_reliability_target<=0
     or coalesce(length(btrim(p_reliability_unit)),0)<2 then
    return jsonb_build_object('error','a reliability target requires a positive value and unit');
  end if;
  if p_maintainability_target is null or p_maintainability_target<=0
     or coalesce(length(btrim(p_maintainability_unit)),0)<1
     or coalesce(length(btrim(p_maintainability_measure)),0)<5 then
    return jsonb_build_object('error','a maintainability target requires a positive value, unit and stated measure');
  end if;
  if p_configuration not in ('series','parallel','mixed') then
    return jsonb_build_object('error','configuration must be series, parallel or mixed');
  end if;
  if coalesce(length(btrim(p_basis)),0)<20 then
    return jsonb_build_object('error','state the evidence-backed conversion basis in at least 20 characters');
  end if;

  select * into v_previous from public.ram_targets
  where organization_id=v_org and source_requirement_id=d.id
    and translation_status is not null
  order by translation_revision desc limit 1 for update;
  if found then
    if v_previous.translation_status='proposed' then
      return jsonb_build_object('error','this requirement already has a proposed conversion awaiting independent review');
    end if;
    v_revision:=v_previous.translation_revision+1;
  end if;

  v_snapshot:=jsonb_build_object(
    'requirement',jsonb_build_object(
      'id',d.id,'reference',d.requirement_ref,'statement',d.requirement,
      'acceptanceCriteria',d.acceptance_criteria,
      'verificationMethod',d.verification_method,'ownerId',d.owner_id,
      'assetId',d.satisfied_by_asset_id,'projectId',d.project_id,
      'developmentCaseId',d.development_case_id),
    'objective',jsonb_build_object(
      'id',o.id,'description',o.description,'target',o.target,
      'measurement',o.measurement,'timeframe',o.timeframe,
      'tolerance',o.tolerance,'version',o.version,'status',o.status),
    'ram',jsonb_build_object(
      'availability',jsonb_build_object('target',p_availability_target,'unit','fraction'),
      'reliability',jsonb_build_object('target',p_reliability_target,'unit',btrim(p_reliability_unit)),
      'maintainability',jsonb_build_object('target',p_maintainability_target,
        'unit',btrim(p_maintainability_unit),'measure',btrim(p_maintainability_measure))),
    'operatingKpiKey',d.operating_kpi_key,
    'lifecycle',jsonb_build_object('id',l.id,'version',l.version,
      'horizonYears',l.horizon_years,'objective',l.objective,
      'adoptedBy',l.adopted_by,'adoptedAt',l.adopted_at),
    'evidence',jsonb_build_object('id',e.id,'class',e.evidence_class,
      'description',e.description,'verifiedBy',e.verified_by,
      'verifiedAt',e.verified_at,'verificationMethod',e.verification_method));

  perform set_config('app.operational_ram_objective_write','granted',true);
  insert into public.ram_targets(
    organization_id,project_id,development_case_id,asset_id,system_label,
    target_availability,target_basis,configuration,survives_handover,
    reliability_target,reliability_unit,
    maintainability_target,maintainability_unit,maintainability_measure,
    source_requirement_id,objective_id,operating_kpi_key,lifecycle_plan_id,
    evidence_item_id,owner_id,translation_basis,translation_status,
    translation_revision,supersedes_target_id,proposed_by,proposed_at,
    translation_snapshot)
  values(
    v_org,d.project_id,null,d.satisfied_by_asset_id,btrim(p_system_label),
    p_availability_target,btrim(p_basis),p_configuration,true,
    p_reliability_target,btrim(p_reliability_unit),
    p_maintainability_target,btrim(p_maintainability_unit),btrim(p_maintainability_measure),
    d.id,o.id,d.operating_kpi_key,l.id,e.id,d.owner_id,btrim(p_basis),'proposed',
    v_revision,v_previous.id,auth.uid(),now(),v_snapshot)
  returning id into v_id;
  perform set_config('app.operational_ram_objective_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operational_ram_objective',v_role,jsonb_build_object(
    'action','proposed','ram_target_id',v_id,'requirement_id',d.id,
    'objective_id',o.id,'operating_kpi_key',d.operating_kpi_key,
    'lifecycle_plan_id',l.id,'evidence_item_id',e.id,'revision',v_revision,
    'proposed_by',auth.uid()));

  return jsonb_build_object(
    'ramTargetId',v_id,'status','proposed','revision',v_revision,
    'objectiveId',o.id,'operatingKpiKey',d.operating_kpi_key,
    'lifecyclePlanId',l.id,
    'mayChangeWork',false,'mayApprove',false,'mayAcceptRisk',false,
    'mayCommitSpend',false,'mayChangeOperatingLimits',false,
    'mayReturnToService',false);
exception when unique_violation then
  perform set_config('app.operational_ram_objective_write','',true);
  return jsonb_build_object('error','this requirement already has that conversion revision or an open proposal');
end
$$;

revoke all on function public.propose_operational_ram_objective(
  bigint,uuid,uuid,text,numeric,numeric,text,numeric,text,text,text,text)
  from public,anon;
grant execute on function public.propose_operational_ram_objective(
  bigint,uuid,uuid,text,numeric,numeric,text,numeric,text,text,text,text)
  to authenticated;

create or replace function public.review_operational_ram_objective(
  p_ram_target_id bigint,p_decision text,p_review_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  t public.ram_targets%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','authentication required');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in
     ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','reviewing a RAM-objective conversion requires a named reliability, maintenance or governance authority');
  end if;
  if p_decision not in ('verified','rejected') then
    return jsonb_build_object('error','decision must be verified or rejected');
  end if;
  if coalesce(length(btrim(p_review_note)),0)<20 then
    return jsonb_build_object('error','independent review requires a note of at least 20 characters');
  end if;

  select * into t from public.ram_targets
  where id=p_ram_target_id and organization_id=v_org
    and translation_status='proposed' for update;
  if not found then
    return jsonb_build_object('error','proposed RAM-objective conversion not found');
  end if;
  if t.proposed_by=auth.uid() then
    return jsonb_build_object('error','segregation of duties requires an independent RAM-objective reviewer');
  end if;
  if not exists(select 1 from public.evidence_items e
    where e.id=t.evidence_item_id and e.organization_id=v_org
      and e.verification_status='verified'
      and (e.risk_id is null or public.can_read_risk(e.risk_id))) then
    return jsonb_build_object('error','the reviewer cannot verify a conversion whose evidence is no longer visible and verified');
  end if;

  perform set_config('app.operational_ram_objective_write','granted',true);
  if p_decision='verified' and t.supersedes_target_id is not null then
    update public.ram_targets set
      translation_status='superseded',
      reviewed_by=coalesce(reviewed_by,auth.uid()),
      reviewed_at=coalesce(reviewed_at,now()),
      review_note=coalesce(review_note,btrim(p_review_note))
    where id=t.supersedes_target_id and organization_id=v_org
      and translation_status='verified';
  end if;
  update public.ram_targets set
    translation_status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=btrim(p_review_note)
  where id=t.id;
  perform set_config('app.operational_ram_objective_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'operational_ram_objective',v_role,jsonb_build_object(
    'action',p_decision,'ram_target_id',t.id,
    'requirement_id',t.source_requirement_id,'revision',t.translation_revision,
    'reviewed_by',auth.uid(),'review_note',btrim(p_review_note)));

  return jsonb_build_object(
    'ramTargetId',t.id,'status',p_decision,
    'mayChangeWork',false,'mayApprove',false,'mayAcceptRisk',false,
    'mayCommitSpend',false,'mayChangeOperatingLimits',false,
    'mayReturnToService',false);
end
$$;

revoke all on function public.review_operational_ram_objective(bigint,text,text)
  from public,anon;
grant execute on function public.review_operational_ram_objective(bigint,text,text)
  to authenticated;

create or replace function public.get_operational_requirement_objective_workspace()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'requirements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'reference',d.requirement_ref,'requirement',d.requirement,
      'category',d.category,'projectId',d.project_id,'assetId',d.satisfied_by_asset_id,
      'assetName',a.name,'ownerId',d.owner_id,
      'acceptanceCriteria',d.acceptance_criteria,
      'verificationMethod',d.verification_method,
      'objectiveId',d.objective_id,'objectiveDescription',o.description,
      'objectiveTarget',o.target,'objectiveMeasurement',o.measurement,
      'objectiveTimeframe',o.timeframe,'objectiveTolerance',o.tolerance,
      'operatingKpiKey',d.operating_kpi_key,'operatingKpiName',k.name,
      'eligible',(d.project_id is not null and d.development_case_id is not null
        and d.satisfied_by_asset_id is not null and d.owner_id is not null
        and d.objective_id is not null and o.status='adopted'
        and d.operating_kpi_key is not null and k.kpi_key is not null
        and d.verification_method is not null
        and coalesce(length(btrim(d.acceptance_criteria)),0)>=10),
      'gaps',to_jsonb(array_remove(array[
        case when d.project_id is null or d.development_case_id is null then 'case_and_project' end,
        case when d.satisfied_by_asset_id is null then 'installed_asset' end,
        case when d.owner_id is null then 'owner' end,
        case when d.objective_id is null then 'objective' when o.status is distinct from 'adopted' then 'adopted_objective' end,
        case when d.operating_kpi_key is null then 'operating_kpi' when k.kpi_key is null then 'catalogued_kpi' end,
        case when d.verification_method is null then 'verification_method' end,
        case when coalesce(length(btrim(d.acceptance_criteria)),0)<10 then 'measurable_acceptance_criteria' end
      ]::text[],null))) order by d.requirement_ref)
      from public.design_requirements d
      left join public.assets a on a.id=d.satisfied_by_asset_id
      left join public.risk_objectives o on o.id=d.objective_id and o.organization_id=d.organization_id
      left join public.kpi_catalog k on k.kpi_key=d.operating_kpi_key
      where d.organization_id=public.app_current_org()
        and d.project_id is not null),'[]'::jsonb),
    'lifecyclePlans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'assetId',l.asset_id,'assetName',a.name,'version',l.version,
      'horizonYears',l.horizon_years,'objective',l.objective,
      'adoptedAt',l.adopted_at) order by a.name,l.version desc)
      from public.asset_lifecycle_plans l
      join public.assets a on a.id=l.asset_id
      where l.organization_id=public.app_current_org()
        and not exists(select 1 from public.asset_lifecycle_plans newer
          where newer.organization_id=l.organization_id and newer.asset_id=l.asset_id
            and newer.version>l.version)),'[]'::jsonb),
    'verifiedEvidence',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'assetId',e.asset_id,'description',e.description,
      'evidenceClass',e.evidence_class,'verifiedAt',e.verified_at)
      order by e.verified_at desc)
      from public.evidence_items e
      where e.organization_id=public.app_current_org()
        and e.asset_id is not null and e.verification_status='verified'
        and e.verified_by is not null and e.verified_at is not null
        and nullif(btrim(e.verification_method),'') is not null
        and (e.risk_id is null or public.can_read_risk(e.risk_id))),'[]'::jsonb),
    'translations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'requirementId',t.source_requirement_id,
      'requirementRef',d.requirement_ref,'assetName',a.name,
      'systemLabel',t.system_label,'status',t.translation_status,
      'revision',t.translation_revision,'objectiveTarget',o.target,
      'operatingKpiKey',t.operating_kpi_key,
      'lifecycleObjective',l.objective,'lifecycleHorizonYears',l.horizon_years,
      'availabilityTarget',t.target_availability,
      'reliabilityTarget',t.reliability_target,'reliabilityUnit',t.reliability_unit,
      'maintainabilityTarget',t.maintainability_target,
      'maintainabilityUnit',t.maintainability_unit,
      'maintainabilityMeasure',t.maintainability_measure,
      'basis',t.translation_basis,'proposedBy',t.proposed_by,
      'proposedAt',t.proposed_at,'reviewedBy',t.reviewed_by,
      'reviewedAt',t.reviewed_at,'reviewNote',t.review_note)
      order by t.proposed_at desc)
      from public.ram_targets t
      join public.design_requirements d on d.id=t.source_requirement_id
      join public.assets a on a.id=t.asset_id
      join public.risk_objectives o on o.id=t.objective_id
      join public.asset_lifecycle_plans l on l.id=t.lifecycle_plan_id
      where t.organization_id=public.app_current_org()
        and t.translation_status is not null),'[]'::jsonb),
    'authority',jsonb_build_object(
      'namedHumanProposal',true,'independentReview',true,
      'mayChangeWork',false,'mayApprove',false,'mayAcceptRisk',false,
      'mayCommitSpend',false,'mayChangeOperatingLimits',false,
      'mayReturnToService',false))
$$;

revoke all on function public.get_operational_requirement_objective_workspace()
  from public,anon;
grant execute on function public.get_operational_requirement_objective_workspace()
  to authenticated;

comment on function public.propose_operational_ram_objective(
  bigint,uuid,uuid,text,numeric,numeric,text,numeric,text,text,text,text) is
  'C8.02: freezes one complete canonical requirement → adopted objective → measurable RAM → KPI → verified evidence → adopted lifecycle-plan conversion. Values are named-human inputs, never inferred.';

comment on function public.review_operational_ram_objective(bigint,text,text) is
  'C8.02: independent named-human verification or rejection. It grants no work, approval, risk, spend, operating-limit or return-to-service authority.';

comment on column public.ram_targets.translation_snapshot is
  'C8.02 immutable server-built provenance snapshot of the exact canonical requirement, objective, RAM values, KPI, evidence and lifecycle-plan version reviewed.';

notify pgrst,'reload schema';
