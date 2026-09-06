-- ============================================================================
-- Engineering Model Supply Chain: build-time GPD-style physics artifacts land
-- in SyncAI's ONE model_register, then move through deterministic verification,
-- evidence, competent human approval, bounded execution and outcome learning.
--
-- Canonical reuse (no parallel stores): model_register, calculation_runs,
-- evidence_items, approvals, model_predictions/model_input_snapshots,
-- damage_mechanisms, asset_failure_mode_libraries, configuration_baselines,
-- recommendations, decisions, work_orders, audit_events and roles.
--
-- GPD is an authoring tool, never a production dependency. Arbitrary imported
-- code is never executable. A production run must name an allowlisted
-- calculation key and the server records both answers and refusals in the
-- immutable calculation_runs ledger. A model can never authorize plant action.
-- ============================================================================

-- The existing model register remains the registry. Extend its vocabulary and
-- attach the machine-readable engineering contract to the version row.
alter table public.model_register
  drop constraint if exists model_register_model_kind_check;
alter table public.model_register
  add constraint model_register_model_kind_check check (model_kind in (
    'statistical','rule_based','machine_learning','llm','hybrid',
    'deterministic_physics','empirical_reliability','oem_curve','standards_method'
  ));

alter table public.model_register
  add column if not exists is_engineering_model boolean not null default false,
  add column if not exists lifecycle_state text not null default 'draft',
  add column if not exists production_eligible boolean not null default false,
  add column if not exists engineering_domain text,
  add column if not exists life_model_type text,
  add column if not exists manifest jsonb,
  add column if not exists manifest_checksum text,
  add column if not exists applicability_envelope jsonb,
  add column if not exists verification_contract jsonb,
  add column if not exists uncertainty_model jsonb,
  add column if not exists convention_set jsonb,
  add column if not exists evidence_requirements jsonb,
  add column if not exists reliability_assurance jsonb,
  add column if not exists reproducible_environment jsonb,
  add column if not exists required_reviewer_role_key text,
  add column if not exists certification_class text,
  add column if not exists escalation_class text,
  add column if not exists source_tool text,
  add column if not exists source_tool_version text,
  add column if not exists source_license text,
  add column if not exists source_reference text,
  add column if not exists source_rights_confirmed boolean not null default false,
  add column if not exists runtime_mode text,
  add column if not exists calculation_key text,
  add column if not exists air_gap_compatible boolean not null default false,
  add column if not exists author_id uuid references auth.users(id) on delete set null,
  add column if not exists supersedes_model_id bigint references public.model_register(id) on delete set null,
  add column if not exists revalidation_reason text,
  add column if not exists retired_at timestamptz;

alter table public.model_register
  add constraint model_register_engineering_lifecycle_check check (
    lifecycle_state in ('draft','derived','verified','bench_validated',
      'field_validated','engineering_approved','production_eligible',
      'revalidation_required','retired')
  ),
  add constraint model_register_engineering_governance_check check (
    not is_engineering_model or (
      human_in_loop
      and runtime_mode = 'allowlisted_deterministic'
      and manifest is not null and jsonb_typeof(manifest) = 'object'
      and applicability_envelope is not null and jsonb_typeof(applicability_envelope) = 'object'
      and verification_contract is not null and jsonb_typeof(verification_contract) = 'object'
      and source_rights_confirmed
      and manifest_checksum ~ '^[0-9a-f]{64}$'
      and btrim(coalesce(required_reviewer_role_key,'')) <> ''
      and btrim(coalesce(calculation_key,'')) <> ''
      and (not production_eligible or lifecycle_state = 'production_eligible')
    )
  );

create index if not exists idx_model_register_engineering
  on public.model_register(organization_id,lifecycle_state,engineering_domain)
  where is_engineering_model;

-- Typed ports make meaning/unit/basis/convention mismatches detectable before
-- a producer can be connected to a consumer.
create table if not exists public.engineering_model_ports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete cascade,
  port_code text not null check (btrim(port_code) <> ''),
  direction text not null check (direction in ('input','output')),
  physical_meaning text not null check (btrim(physical_meaning) <> ''),
  unit text not null check (btrim(unit) <> ''),
  basis text not null check (btrim(basis) <> ''),
  convention text not null check (btrim(convention) <> ''),
  valid_range jsonb,
  required boolean not null default true,
  unique(model_register_id,direction,port_code)
);

create table if not exists public.engineering_model_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  consumer_model_id bigint not null references public.model_register(id) on delete cascade,
  producer_model_id bigint not null references public.model_register(id) on delete restrict,
  producer_port_code text not null,
  consumer_port_code text not null,
  compatibility_state text not null default 'unverified'
    check (compatibility_state in ('unverified','compatible','refused')),
  compatibility_basis text,
  created_at timestamptz not null default now(),
  check (consumer_model_id <> producer_model_id),
  unique(consumer_model_id,producer_model_id,producer_port_code,consumer_port_code)
);

-- Multiple canonical damage mechanisms may be supported by one pack. The
-- mechanism itself is never copied into a new taxonomy.
create table if not exists public.engineering_model_mechanisms (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete cascade,
  mechanism_id uuid not null references public.damage_mechanisms(id) on delete restrict,
  primary key(model_register_id,mechanism_id)
);

-- This is a binding to canonical evidence, not another evidence store.
create table if not exists public.engineering_model_evidence_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete cascade,
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  requirement_key text not null check (btrim(requirement_key) <> ''),
  parameter_code text,
  purpose text not null check (purpose in ('parameter','applicability','verification',
    'bench_validation','field_validation','lab_assay','measurement_quality','configuration')),
  evidence_grade text not null check (evidence_grade in ('A','B','C','D')),
  source_rights text not null check (length(btrim(source_rights)) >= 5),
  bound_by uuid not null references auth.users(id),
  bound_at timestamptz not null default now(),
  unique(model_register_id,requirement_key,evidence_item_id)
);

create table if not exists public.engineering_model_verification_debts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete cascade,
  debt_key text not null,
  description text not null check (length(btrim(description)) >= 10),
  blocking boolean not null default true,
  temporary_approval_expires_at timestamptz,
  raised_by uuid not null references auth.users(id),
  raised_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text,
  unique(model_register_id,debt_key),
  check (resolved_at is null or (resolved_by is not null and length(btrim(coalesce(resolution_note,''))) >= 10))
);

-- A version change does not silently rewrite prior decisions. Affected open
-- recommendations/decisions receive an explicit revalidation record.
create table if not exists public.engineering_model_impacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete cascade,
  calculation_run_id uuid references public.calculation_runs(id) on delete set null,
  recommendation_id uuid references public.recommendations(id) on delete cascade,
  decision_id uuid references public.decisions(id) on delete cascade,
  impact_reason text not null,
  status text not null default 'open' check (status in ('open','reviewed','not_affected','recomputed','closed')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(recommendation_id,decision_id) = 1)
);

create unique index if not exists idx_engineering_model_open_recommendation_impact
  on public.engineering_model_impacts(model_register_id,calculation_run_id,recommendation_id)
  where status='open' and recommendation_id is not null;
create unique index if not exists idx_engineering_model_open_decision_impact
  on public.engineering_model_impacts(model_register_id,calculation_run_id,decision_id)
  where status='open' and decision_id is not null;

-- Maintenance does not magically erase damage. This records the approved
-- effect model and the observed post-maintenance state against canonical work.
create table if not exists public.engineering_model_interventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_register_id bigint not null references public.model_register(id) on delete restrict,
  asset_id uuid not null references public.assets(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  pre_damage_state jsonb not null check (jsonb_typeof(pre_damage_state) = 'object'),
  effect_kind text not null check (effect_kind in ('no_change','partial_reset','full_reset','rate_change_only')),
  effect_model_reference text not null check (length(btrim(effect_model_reference)) >= 5),
  post_damage_state jsonb check (post_damage_state is null or jsonb_typeof(post_damage_state) = 'object'),
  configuration_baseline_id bigint references public.configuration_baselines(id) on delete set null,
  evidence_item_id uuid references public.evidence_items(id) on delete set null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique(model_register_id,work_order_id)
);

-- Reuse the immutable calculation ledger for verification and production runs.
alter table public.calculation_runs
  add column if not exists model_register_id bigint references public.model_register(id) on delete restrict,
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists recommendation_id uuid references public.recommendations(id) on delete set null,
  add column if not exists configuration_baseline_id bigint references public.configuration_baselines(id) on delete set null,
  add column if not exists execution_environment jsonb,
  add column if not exists evidence_bindings jsonb;

create index if not exists idx_calculation_runs_model
  on public.calculation_runs(organization_id,model_register_id,computed_at desc)
  where model_register_id is not null;

-- Reuse the prediction/outcome ledger for damage-state, RUL-distribution,
-- censoring/cohort context and counterfactual learning.
alter table public.model_predictions
  add column if not exists model_register_id bigint references public.model_register(id) on delete restrict,
  add column if not exists calculation_run_id uuid references public.calculation_runs(id) on delete set null,
  add column if not exists predicted_distribution jsonb,
  add column if not exists damage_state jsonb,
  add column if not exists consequence_class text,
  add column if not exists censoring_context jsonb,
  add column if not exists cohort_context jsonb,
  add column if not exists counterfactual_review jsonb;

create unique index if not exists idx_model_predictions_engineering_run
  on public.model_predictions(calculation_run_id)
  where calculation_run_id is not null;

-- Model approvals remain approvals. No second approval queue is introduced.
alter table public.approvals
  add column if not exists model_register_id bigint references public.model_register(id) on delete cascade,
  add column if not exists required_competency_role_key text,
  add column if not exists approver_user_id uuid references auth.users(id) on delete set null,
  add column if not exists approval_scope jsonb;

-- The existing failure-mode library becomes FMMEA-capable rather than being
-- copied into a parallel table.
alter table public.asset_failure_mode_libraries
  add column if not exists canonical_asset_id uuid references public.assets(id) on delete set null,
  add column if not exists mechanism_id uuid references public.damage_mechanisms(id) on delete set null,
  add column if not exists stressors jsonb,
  add column if not exists damage_variable text,
  add column if not exists model_register_id bigint references public.model_register(id) on delete set null,
  add column if not exists occurrence_basis text,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists local_effect text,
  add column if not exists system_effect text,
  add column if not exists recommended_action text,
  add column if not exists non_physics_branch boolean not null default false,
  add column if not exists model_conflict_status text default 'not_assessed',
  add column if not exists updated_at timestamptz not null default now();

alter table public.asset_failure_mode_libraries
  add constraint asset_failure_mode_model_conflict_check check (
    model_conflict_status in ('not_assessed','none','unresolved','human_resolved')
  );

-- Child tables are tenant-readable and function-write-only.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'engineering_model_ports','engineering_model_dependencies','engineering_model_mechanisms',
    'engineering_model_evidence_bindings','engineering_model_verification_debts',
    'engineering_model_impacts','engineering_model_interventions'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('drop policy if exists %I on public.%I',v_table || '_read',v_table);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id = public.app_current_org())',v_table || '_read',v_table);
    execute format('revoke insert,update,delete,truncate on table public.%I from anon,authenticated',v_table);
    execute format('grant select on table public.%I to authenticated',v_table);
  end loop;
end $$;

revoke insert,update,delete,truncate on table public.model_register from anon,authenticated;

create or replace function public.engineering_model_actor_has_role(
  p_actor uuid,p_org uuid,p_role_key text
) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.user_profiles p
    where p.id=p_actor and p.organization_id=p_org and p.role=p_role_key
  ) or exists(
    select 1 from public.user_role_assignments a
    join public.roles r on r.id=a.role_id and r.organization_id=a.organization_id
    where a.user_id=p_actor and a.organization_id=p_org and r.key=p_role_key
  );
$$;

create or replace function public.engineering_model_grade_rank(p_grade text)
returns int language sql immutable set search_path=public as $$
  select case p_grade when 'A' then 4 when 'B' then 3 when 'C' then 2 when 'D' then 1 else 0 end;
$$;

create or replace function public.seed_engineering_model_reviewer_roles()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.roles(organization_id,key,code,name,description,level)
  select new.id,v.key,v.key,v.name,
    'Competency-scoped independent review of engineering model packs; does not authorize plant operation.',1
  from (values
    ('model_reviewer_vibration_and_rotordynamics','Vibration and Rotordynamics Model Reviewer'),
    ('model_reviewer_tribology','Tribology Model Reviewer'),
    ('model_reviewer_fracture_mechanics','Fracture Mechanics Model Reviewer'),
    ('model_reviewer_creep_and_high_temperature','Creep and High-Temperature Model Reviewer'),
    ('model_reviewer_corrosion_and_materials','Corrosion and Materials Model Reviewer'),
    ('model_reviewer_electrical_reliability','Electrical Reliability Model Reviewer'),
    ('model_reviewer_fluid_and_thermal','Fluid and Thermal Model Reviewer')
  ) v(key,name)
  where not exists(select 1 from public.roles r where r.organization_id=new.id and r.key=v.key);
  return new;
end $$;

drop trigger if exists trg_seed_engineering_model_reviewer_roles on public.organizations;
create trigger trg_seed_engineering_model_reviewer_roles
after insert on public.organizations for each row execute function public.seed_engineering_model_reviewer_roles();

insert into public.roles(organization_id,key,code,name,description,level)
select o.id,v.key,v.key,v.name,
  'Competency-scoped independent review of engineering model packs; does not authorize plant operation.',1
from public.organizations o cross join (values
  ('model_reviewer_vibration_and_rotordynamics','Vibration and Rotordynamics Model Reviewer'),
  ('model_reviewer_tribology','Tribology Model Reviewer'),
  ('model_reviewer_fracture_mechanics','Fracture Mechanics Model Reviewer'),
  ('model_reviewer_creep_and_high_temperature','Creep and High-Temperature Model Reviewer'),
  ('model_reviewer_corrosion_and_materials','Corrosion and Materials Model Reviewer'),
  ('model_reviewer_electrical_reliability','Electrical Reliability Model Reviewer'),
  ('model_reviewer_fluid_and_thermal','Fluid and Thermal Model Reviewer')
) v(key,name)
where not exists(select 1 from public.roles r where r.organization_id=o.id and r.key=v.key);

-- Build-time artifact ingestion. Imported code remains inert; only the
-- calculation_key can route to a separately allowlisted implementation.
create or replace function public.ingest_engineering_model_pack(
  p_organization_id uuid,p_actor_id uuid,p_manifest jsonb,p_manifest_checksum text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=p_organization_id;
  v_role text;
  v_id bigint;
  v_kind text:=btrim(coalesce(p_manifest->>'modelKind',''));
  v_key text:=btrim(coalesce(p_manifest->>'modelKey',''));
  v_version text:=btrim(coalesce(p_manifest->>'version',''));
  v_required_role text:=btrim(coalesce(p_manifest->'governance'->>'requiredReviewerCompetency',''));
  v_artifact_roles text[]:=array['project','requirements','roadmap','state','model','assumptions','conventions','derivation','verification','applicability','manifest'];
  v_check_kinds text[]:=array['dimensional','limiting_case','conservation','symmetry','benchmark','numerical_stability','regression','adversarial'];
  v_item jsonb;
  v_producer bigint;
  v_mechanism uuid;
begin
  if auth.role()<>'service_role' then
    return jsonb_build_object('error','engineering model ingestion is service-only');
  end if;
  select role into v_role from public.user_profiles where id=p_actor_id and organization_id=v_org;
  if p_actor_id is null or v_org is null or coalesce(v_role,'') not in ('admin','reliability_engineer') then
    return jsonb_build_object('error','engineering model ingestion requires an organization admin or reliability engineer');
  end if;
  if jsonb_typeof(coalesce(p_manifest,'null'::jsonb))<>'object' or octet_length(p_manifest::text)>2097152 then
    return jsonb_build_object('error','manifest must be an object no larger than 2 MiB');
  end if;
  if p_manifest->>'schemaVersion'<>'1.0.0' or v_key='' or v_version='' then
    return jsonb_build_object('error','manifest schema 1.0.0, model key and version are required');
  end if;
  if not exists(select 1 from public.roles where organization_id=v_org and key=v_required_role) then
    return jsonb_build_object('error','required reviewer competency is not registered for this organization');
  end if;
  if v_kind not in ('deterministic_physics','empirical_reliability','hybrid','oem_curve','standards_method') then
    return jsonb_build_object('error','unsupported engineering model kind');
  end if;
  if coalesce(p_manifest->'governance'->>'intendedUse','')<>'engineering_decision_support'
     or coalesce((p_manifest->'governance'->>'humanApprovalRequired')::boolean,false)<>true
     or coalesce((p_manifest->'governance'->>'autonomousOperationalActionAllowed')::boolean,true)<>false
     or coalesce(p_manifest->'governance'->>'thresholdsPolicy','')<>'approved_source_only'
     or coalesce((p_manifest->'governance'->>'sourceRightsConfirmed')::boolean,false)<>true then
    return jsonb_build_object('error','manifest violates the human-final engineering governance contract');
  end if;
  if coalesce(p_manifest->'execution'->>'runtimeMode','')<>'allowlisted_deterministic'
     or coalesce((p_manifest->'execution'->>'operationalNetworkRequired')::boolean,true)<>false
     or coalesce((p_manifest->'execution'->>'arbitraryCodeAllowed')::boolean,true)<>false
     or coalesce(p_manifest->'execution'->>'calculationKey','') not in ('pof_shaft_resonance_screening') then
    return jsonb_build_object('error','runtime must be allowlisted deterministic, offline-capable and prohibit arbitrary code');
  end if;
  if p_manifest->'authoring'->>'tool'='gpd'
     and p_manifest->'authoring'->>'sourceLicense'<>'Apache-2.0' then
    return jsonb_build_object('error','GPD provenance must retain Apache-2.0');
  end if;
  if coalesce(p_manifest->'reliabilityAssurance'->>'failureTaxonomy','')<>'canonical_damage_mechanisms'
     or coalesce((p_manifest->'reliabilityAssurance'->>'nonPhysicsRcaBranchesPreserved')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'calibration'->>'calibrationDatasetRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'calibration'->>'holdoutValidationRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'calibration'->>'residualChecksRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'consequenceAwareThresholds')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'inspectionPlanningUsesValueOfInformation')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'probabilityOfDetectionRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'interventionEffectModelRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'asMaintainedConfigurationRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'physicalAndEconomicRulSeparated')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'commonCauseAssessmentRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'modelConflictRequiresHumanReview')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'decisionSupport'->>'repairabilityAndFeasibilityRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'learning'->>'outcomeRecordingRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'learning'->>'counterfactualReviewRequired')::boolean,false)<>true
     or coalesce((p_manifest->'reliabilityAssurance'->'learning'->>'designFeedbackRequired')::boolean,false)<>true then
    return jsonb_build_object('error','the closed-loop reliability assurance contract cannot be weakened');
  end if;
  if btrim(coalesce(p_manifest->'reliabilityAssurance'->>'loadSpectrumMethod',''))=''
     or btrim(coalesce(p_manifest->'reliabilityAssurance'->>'damageAccumulationMethod',''))=''
     or btrim(coalesce(p_manifest->'reliabilityAssurance'->>'censoringPolicy',''))=''
     or jsonb_array_length(coalesce(p_manifest->'reliabilityAssurance'->'cohortingFields','[]'::jsonb))=0
     or jsonb_array_length(coalesce(p_manifest->'reliabilityAssurance'->'calibration'->'recalibrationTriggers','[]'::jsonb))=0
     or jsonb_array_length(coalesce(p_manifest->'reliabilityAssurance'->'learning'->'retirementTriggers','[]'::jsonb))=0 then
    return jsonb_build_object('error','load, damage, censoring, cohorting, recalibration and retirement policies are required');
  end if;
  if coalesce((p_manifest->'governance'->>'chemistryRequiresLabEvidence')::boolean,false)
     and not exists(select 1 from jsonb_array_elements(coalesce(p_manifest->'evidenceRequirements','[]'::jsonb)) req
       where req->>'purpose'='lab_assay' and coalesce((req->>'requiredForProduction')::boolean,false)) then
    return jsonb_build_object('error','chemistry-dependent models require production lab-assay evidence');
  end if;
  if p_manifest_checksum !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error','manifest SHA-256 checksum is required');
  end if;
  if jsonb_typeof(coalesce(p_manifest->'artifacts','null'::jsonb))<>'array'
     or exists(select 1 from unnest(v_artifact_roles) role_key where not exists(
       select 1 from jsonb_array_elements(p_manifest->'artifacts') a where a->>'role'=role_key
     ))
     or exists(select 1 from jsonb_array_elements(p_manifest->'artifacts') a
       where btrim(coalesce(a->>'path',''))='' or a->>'path' like '/%' or a->>'path' like '%..%'
         or coalesce(a->>'sha256','') !~ '^[0-9a-f]{64}$'
         or btrim(coalesce(a->>'mediaType',''))='')
     or exists(select 1 from jsonb_array_elements(p_manifest->'artifacts') a
       group by a->>'path' having count(*)>1) then
    return jsonb_build_object('error','durable project, requirements, roadmap, state, model, assumptions, conventions, derivation, verification, applicability and manifest artifacts are required');
  end if;
  if jsonb_typeof(coalesce(p_manifest->'verification'->'checks','null'::jsonb))<>'array'
     or exists(select 1 from unnest(v_check_kinds) kind_key where not exists(
       select 1 from jsonb_array_elements(p_manifest->'verification'->'checks') c where c->>'kind'=kind_key
     )) then
    return jsonb_build_object('error','verification contract must cover every required check family or record why it is not applicable');
  end if;
  if jsonb_typeof(coalesce(p_manifest->'applicability'->'rules','null'::jsonb))<>'array'
     or jsonb_array_length(p_manifest->'applicability'->'rules')=0
     or jsonb_typeof(coalesce(p_manifest->'ports','null'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_manifest->'evidenceRequirements','null'::jsonb))<>'array' then
    return jsonb_build_object('error','ports, evidence requirements and machine-readable applicability rules are required');
  end if;
  if v_kind='deterministic_physics' and jsonb_array_length(coalesce(p_manifest->'mechanismKeys','[]'::jsonb))=0 then
    return jsonb_build_object('error','deterministic physics models require a canonical damage mechanism');
  end if;
  if exists(select 1 from (values('parameter'),('measurement'),('model_form'),('operating_condition'),('scenario')) required(kind)
    where not exists(select 1 from jsonb_array_elements(coalesce(p_manifest->'uncertainty'->'components','[]'::jsonb)) component
      where component->>'kind'=required.kind)) then
    return jsonb_build_object('error','parameter, measurement, model-form, operating-condition and scenario uncertainty must be represented');
  end if;

  insert into public.model_register(
    organization_id,model_key,version,model_kind,purpose,approved_for,human_in_loop,
    verification_reference,limitations,is_engineering_model,lifecycle_state,production_eligible,
    engineering_domain,life_model_type,manifest,manifest_checksum,applicability_envelope,
    verification_contract,uncertainty_model,convention_set,evidence_requirements,
    reliability_assurance,reproducible_environment,required_reviewer_role_key,
    certification_class,escalation_class,source_tool,source_tool_version,source_license,
    source_reference,source_rights_confirmed,runtime_mode,calculation_key,air_gap_compatible,author_id
  ) values (
    v_org,v_key,v_version,v_kind,p_manifest->>'description','{}'::text[],true,
    'manifest:'||p_manifest_checksum,
    'Imported artifacts remain inert. The version cannot authorize operation and is not production-eligible until every promotion gate passes.',
    true,'draft',false,p_manifest->>'domain',p_manifest->>'lifeModelType',p_manifest,p_manifest_checksum,
    p_manifest->'applicability',p_manifest->'verification',p_manifest->'uncertainty',p_manifest->'conventions',
    p_manifest->'evidenceRequirements',p_manifest->'reliabilityAssurance',p_manifest->'environment',v_required_role,
    p_manifest->'governance'->>'certificationClass',p_manifest->'governance'->>'escalationClass',
    p_manifest->'authoring'->>'tool',p_manifest->'authoring'->>'toolVersion',p_manifest->'authoring'->>'sourceLicense',
    p_manifest->'authoring'->>'sourceReference',true,'allowlisted_deterministic',p_manifest->'execution'->>'calculationKey',
    coalesce((p_manifest->'environment'->>'airGapCompatible')::boolean,false),p_actor_id
  ) on conflict(organization_id,model_key,version) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('error','this organization already has that model key and version'); end if;

  for v_item in select value from jsonb_array_elements(p_manifest->'ports') loop
    if coalesce(v_item->>'direction','') not in ('input','output')
       or btrim(coalesce(v_item->>'code',''))='' or btrim(coalesce(v_item->>'physicalMeaning',''))=''
       or btrim(coalesce(v_item->>'unit',''))='' or btrim(coalesce(v_item->>'basis',''))=''
       or btrim(coalesce(v_item->>'convention',''))='' then
      raise exception 'invalid engineering model port contract' using errcode='check_violation';
    end if;
    insert into public.engineering_model_ports(
      organization_id,model_register_id,port_code,direction,physical_meaning,unit,basis,convention,valid_range,required
    ) values (v_org,v_id,v_item->>'code',v_item->>'direction',v_item->>'physicalMeaning',v_item->>'unit',
      v_item->>'basis',v_item->>'convention',v_item->'validRange',coalesce((v_item->>'required')::boolean,false));
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_manifest->'mechanismKeys','[]'::jsonb)) loop
    v_mechanism:=null;
    select id into v_mechanism from public.damage_mechanisms
    where organization_id=v_org and mechanism_key=trim(both '"' from v_item::text);
    if v_mechanism is null then raise exception 'canonical damage mechanism % is not registered',trim(both '"' from v_item::text); end if;
    insert into public.engineering_model_mechanisms(organization_id,model_register_id,mechanism_id)
    values(v_org,v_id,v_mechanism);
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_manifest->'dependencies','[]'::jsonb)) loop
    v_producer:=null;
    select id into v_producer from public.model_register
    where organization_id=v_org and model_key=v_item->>'modelKey' and version=v_item->>'version';
    if v_producer is null then raise exception 'dependency model % at % is not registered',v_item->>'modelKey',v_item->>'version'; end if;
    insert into public.engineering_model_dependencies(
      organization_id,consumer_model_id,producer_model_id,producer_port_code,consumer_port_code
    ) values(v_org,v_id,v_producer,v_item->>'producerPort',v_item->>'consumerPort');
    if not exists(
      select 1 from public.engineering_model_ports p,public.engineering_model_ports c
      where p.model_register_id=v_producer and p.direction='output' and p.port_code=v_item->>'producerPort'
        and c.model_register_id=v_id and c.direction='input' and c.port_code=v_item->>'consumerPort'
    ) then raise exception 'dependency ports are not registered with output-to-input direction'; end if;
    update public.engineering_model_dependencies d set
      compatibility_state=case when p.physical_meaning=c.physical_meaning and p.unit=c.unit
        and p.basis=c.basis and p.convention=c.convention
        and (not coalesce(c.valid_range ? 'min',false) or (coalesce(p.valid_range ? 'min',false)
          and (p.valid_range->>'min')::numeric >= (c.valid_range->>'min')::numeric
          and not ((p.valid_range->>'min')::numeric=(c.valid_range->>'min')::numeric
            and coalesce((p.valid_range->>'minInclusive')::boolean,true)
            and not coalesce((c.valid_range->>'minInclusive')::boolean,true))))
        and (not coalesce(c.valid_range ? 'max',false) or (coalesce(p.valid_range ? 'max',false)
          and (p.valid_range->>'max')::numeric <= (c.valid_range->>'max')::numeric
          and not ((p.valid_range->>'max')::numeric=(c.valid_range->>'max')::numeric
            and coalesce((p.valid_range->>'maxInclusive')::boolean,true)
            and not coalesce((c.valid_range->>'maxInclusive')::boolean,true))))
        then 'compatible' else 'refused' end,
      compatibility_basis='Evaluated physical meaning, unit, basis, convention and producer-range containment.'
    from public.engineering_model_ports p,public.engineering_model_ports c
    where d.consumer_model_id=v_id and d.producer_model_id=v_producer
      and d.producer_port_code=v_item->>'producerPort' and d.consumer_port_code=v_item->>'consumerPort'
      and p.model_register_id=d.producer_model_id and p.direction='output' and p.port_code=d.producer_port_code
      and c.model_register_id=d.consumer_model_id and c.direction='input' and c.port_code=d.consumer_port_code;
  end loop;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_pack',v_role,jsonb_build_object(
    'model_register_id',v_id,'model_key',v_key,'version',v_version,'manifest_checksum',p_manifest_checksum,
    'lifecycle_state','draft','production_eligible',false,'source_tool',p_manifest->'authoring'->>'tool'));
  return jsonb_build_object('model_register_id',v_id,'model_key',v_key,'version',v_version,
    'lifecycle_state','draft','production_eligible',false);
exception when others then
  return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.bind_engineering_model_evidence(
  p_model_register_id bigint,p_evidence_item_id uuid,p_requirement_key text,
  p_parameter_code text,p_purpose text,p_evidence_grade text,p_source_rights text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; m public.model_register%rowtype;
  v_req jsonb; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then return jsonb_build_object('error','engineering evidence binding requires admin or reliability engineer'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model;
  if not found or m.lifecycle_state='retired' then return jsonb_build_object('error','active engineering model not found in this organization'); end if;
  if not exists(select 1 from public.evidence_items e where e.id=p_evidence_item_id and e.organization_id=v_org) then
    return jsonb_build_object('error','canonical evidence item not found in this organization');
  end if;
  select value into v_req from jsonb_array_elements(m.evidence_requirements) where value->>'key'=p_requirement_key;
  if v_req is null or v_req->>'purpose'<>p_purpose then return jsonb_build_object('error','evidence requirement key and purpose do not match the manifest'); end if;
  if public.engineering_model_grade_rank(p_evidence_grade)<public.engineering_model_grade_rank(v_req->>'minimumGrade') then
    return jsonb_build_object('error','evidence grade is below the manifest requirement');
  end if;
  insert into public.engineering_model_evidence_bindings(
    organization_id,model_register_id,evidence_item_id,requirement_key,parameter_code,purpose,evidence_grade,source_rights,bound_by
  ) values(v_org,m.id,p_evidence_item_id,p_requirement_key,nullif(btrim(p_parameter_code),''),p_purpose,p_evidence_grade,p_source_rights,auth.uid())
  returning id into v_id;
  return jsonb_build_object('binding_id',v_id,'model_register_id',m.id,'requirement_key',p_requirement_key);
exception when unique_violation then return jsonb_build_object('error','this evidence is already bound to that requirement');
end $$;

create or replace function public.add_engineering_model_verification_debt(
  p_model_register_id bigint,p_debt_key text,p_description text,p_blocking boolean,p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then return jsonb_build_object('error','verification-debt authority denied'); end if;
  if not exists(select 1 from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model) then return jsonb_build_object('error','engineering model not found'); end if;
  insert into public.engineering_model_verification_debts(
    organization_id,model_register_id,debt_key,description,blocking,temporary_approval_expires_at,raised_by
  ) values(v_org,p_model_register_id,btrim(p_debt_key),btrim(p_description),coalesce(p_blocking,true),p_expires_at,auth.uid())
  returning id into v_id;
  return jsonb_build_object('debt_id',v_id,'blocking',coalesce(p_blocking,true));
end $$;

create or replace function public.resolve_engineering_model_verification_debt(
  p_debt_id uuid,p_resolution_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_model bigint;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then return jsonb_build_object('error','verification-debt resolution authority denied'); end if;
  if length(btrim(coalesce(p_resolution_note,'')))<10 then return jsonb_build_object('error','resolution note must contain at least 10 characters'); end if;
  update public.engineering_model_verification_debts set resolved_by=auth.uid(),resolved_at=now(),resolution_note=btrim(p_resolution_note)
  where id=p_debt_id and organization_id=v_org and resolved_at is null returning model_register_id into v_model;
  if v_model is null then return jsonb_build_object('error','open verification debt not found in this organization'); end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_verification_debt',v_role,jsonb_build_object('debt_id',p_debt_id,'model_register_id',v_model,'status','resolved','note',btrim(p_resolution_note)));
  return jsonb_build_object('debt_id',p_debt_id,'model_register_id',v_model,'resolved',true);
end $$;

-- CI/Edge-only recorder: a browser cannot fabricate an independently rerun
-- verification suite. Results must cover every required manifest check.
create or replace function public.record_engineering_model_verification(
  p_organization_id uuid,p_actor_id uuid,p_model_register_id bigint,p_results jsonb,
  p_environment jsonb,p_refusals jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.model_register%rowtype; v_required int; v_passed int; v_id uuid; v_outputs jsonb; v_status text;
  v_refusals jsonb:=coalesce(p_refusals,'[]'::jsonb);
begin
  if auth.role()<>'service_role' then return jsonb_build_object('error','verification recording is service-only'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=p_organization_id and is_engineering_model;
  if not found then return jsonb_build_object('error','engineering model not found'); end if;
  if not exists(select 1 from public.user_profiles where id=p_actor_id and organization_id=p_organization_id) then return jsonb_build_object('error','organization member required'); end if;
  if jsonb_typeof(coalesce(p_results,'null'::jsonb))<>'array' or jsonb_typeof(v_refusals)<>'array' then return jsonb_build_object('error','results and refusals must be arrays'); end if;
  select count(*) into v_required from jsonb_array_elements(m.verification_contract->'checks') c where c->>'disposition'='required';
  select count(*) into v_passed from jsonb_array_elements(m.verification_contract->'checks') c
  where c->>'disposition'='required' and exists(
    select 1 from jsonb_array_elements(p_results) r
    where r->>'checkId'=c->>'id' and coalesce((r->>'passed')::boolean,false) and btrim(coalesce(r->>'runReference',''))<>''
  );
  if v_passed<v_required and jsonb_array_length(v_refusals)=0 then
    v_refusals:=jsonb_build_array(jsonb_build_object('code','verification_contract_not_passed',
      'message',(v_required-v_passed)||' required verification check(s) did not pass.'));
  end if;
  v_outputs:=jsonb_build_object('passed',v_passed=v_required and jsonb_array_length(v_refusals)=0,
    'requiredChecks',v_required,'passedChecks',v_passed,'results',p_results);
  v_status:=case when v_passed=v_required and jsonb_array_length(v_refusals)=0 then 'computed' else 'computed_with_refusals' end;
  insert into public.calculation_runs(
    organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by,
    model_register_id,execution_environment,evidence_bindings
  ) values(p_organization_id,'engineering_model_verification',
    'Independent rerun of the version-pinned engineering model verification contract.',
    m.model_key||'@'||m.version,jsonb_build_object('manifestChecksum',m.manifest_checksum),'[]'::jsonb,
    v_outputs,v_refusals,v_status,p_actor_id,m.id,p_environment,'[]'::jsonb) returning id into v_id;
  return jsonb_build_object('calculation_run_id',v_id,'passed',v_passed=v_required and jsonb_array_length(v_refusals)=0,
    'required_checks',v_required,'passed_checks',v_passed);
end $$;

create or replace function public.promote_engineering_model(
  p_model_register_id bigint,p_target_state text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; m public.model_register%rowtype;
  v_allowed boolean:=false; v_missing int; v_run uuid;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','authenticated organization member required'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','reliability_engineer') then return jsonb_build_object('error','engineering model promotion authority denied'); end if;
  if length(btrim(coalesce(p_review_note,'')))<20 then return jsonb_build_object('error','record at least 20 characters of promotion or revalidation basis'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model for update;
  if not found then return jsonb_build_object('error','engineering model not found'); end if;
  v_allowed:=case m.lifecycle_state
    when 'draft' then p_target_state='derived'
    when 'derived' then p_target_state='verified'
    when 'verified' then p_target_state='bench_validated'
    when 'bench_validated' then p_target_state='field_validated'
    when 'field_validated' then p_target_state='engineering_approved'
    when 'engineering_approved' then p_target_state='production_eligible'
    when 'production_eligible' then p_target_state in ('revalidation_required','retired')
    when 'revalidation_required' then p_target_state in ('verified','retired')
    else false end;
  if not v_allowed then return jsonb_build_object('error','invalid lifecycle transition from '||m.lifecycle_state||' to '||p_target_state); end if;

  if p_target_state in ('verified','bench_validated','field_validated','engineering_approved','production_eligible') then
    select id into v_run from public.calculation_runs
    where organization_id=v_org and model_register_id=m.id and calculation_key='engineering_model_verification'
      and status='computed' and outputs->>'passed'='true' order by computed_at desc limit 1;
    if v_run is null then return jsonb_build_object('error','the independent verification contract has not passed'); end if;
  end if;
  if p_target_state in ('bench_validated','field_validated','engineering_approved','production_eligible')
     and not exists(select 1 from public.engineering_model_evidence_bindings where model_register_id=m.id and purpose='bench_validation') then
    return jsonb_build_object('error','bench-validation evidence is required');
  end if;
  if p_target_state in ('field_validated','engineering_approved','production_eligible')
     and not exists(select 1 from public.engineering_model_evidence_bindings where model_register_id=m.id and purpose='field_validation') then
    return jsonb_build_object('error','field-validation evidence is required');
  end if;
  if p_target_state in ('engineering_approved','production_eligible') then
    if auth.uid()=m.author_id then return jsonb_build_object('error','model author cannot complete independent engineering approval'); end if;
    if not public.engineering_model_actor_has_role(auth.uid(),v_org,m.required_reviewer_role_key) then
      return jsonb_build_object('error','independent reviewer requires assigned competency role '||m.required_reviewer_role_key);
    end if;
  end if;
  if p_target_state='production_eligible' then
    if exists(select 1 from public.engineering_model_verification_debts d where d.model_register_id=m.id and d.resolved_at is null
      and (d.blocking or d.temporary_approval_expires_at is null or d.temporary_approval_expires_at<=now())) then
      return jsonb_build_object('error','blocking or expired verification debt remains open');
    end if;
    select count(*) into v_missing from jsonb_array_elements(m.evidence_requirements) req
    where coalesce((req->>'requiredForProduction')::boolean,false) and not exists(
      select 1 from public.engineering_model_evidence_bindings b where b.model_register_id=m.id and b.requirement_key=req->>'key'
    );
    if v_missing>0 then return jsonb_build_object('error',v_missing||' required production evidence binding(s) are missing'); end if;
    if jsonb_array_length(coalesce(m.applicability_envelope->'rules','[]'::jsonb))=0 then return jsonb_build_object('error','machine-readable applicability rules are missing'); end if;
    if exists(select 1 from public.engineering_model_dependencies d
      join public.model_register producer on producer.id=d.producer_model_id
      where d.consumer_model_id=m.id and (d.compatibility_state<>'compatible' or not producer.production_eligible)) then
      return jsonb_build_object('error','a dependency is incompatible or not production-eligible');
    end if;
  end if;

  update public.model_register set lifecycle_state=p_target_state,
    production_eligible=(p_target_state='production_eligible'),
    approved_on=case when p_target_state in ('engineering_approved','production_eligible') then current_date when p_target_state in ('revalidation_required','retired') then null else approved_on end,
    approved_by=case when p_target_state in ('engineering_approved','production_eligible') then auth.uid() when p_target_state in ('revalidation_required','retired') then null else approved_by end,
    revalidation_reason=case when p_target_state='revalidation_required' then btrim(p_review_note) else null end,
    retired_at=case when p_target_state='retired' then now() else null end
  where id=m.id;

  if p_target_state='engineering_approved' then
    insert into public.approvals(organization_id,status,owner_role,approver,reason,consequence_of_wrong,
      required_validation,decided_at,model_register_id,required_competency_role_key,approver_user_id,approval_scope)
    values(v_org,'approved',m.required_reviewer_role_key,v_role,btrim(p_review_note),
      'An inapplicable or invalid physical model can create unsafe confidence and misdirect maintenance.',
      'Verification contract, bench and field evidence, applicability envelope, uncertainty and source rights.',now(),
      m.id,m.required_reviewer_role_key,auth.uid(),jsonb_build_object('modelKey',m.model_key,'version',m.version,'operationalAuthorization',false));
  end if;

  if p_target_state in ('revalidation_required','retired') then
    insert into public.engineering_model_impacts(
      organization_id,model_register_id,calculation_run_id,recommendation_id,impact_reason
    ) select v_org,m.id,r.id,r.recommendation_id,btrim(p_review_note)
      from public.calculation_runs r join public.recommendations rec on rec.id=r.recommendation_id
      where r.organization_id=v_org and r.model_register_id=m.id and r.recommendation_id is not null
        and rec.status in ('pending','approved','escalated')
      on conflict do nothing;
    insert into public.engineering_model_impacts(
      organization_id,model_register_id,calculation_run_id,decision_id,impact_reason
    ) select v_org,m.id,r.id,d.id,btrim(p_review_note)
      from public.calculation_runs r join public.decisions d on d.recommendation_id=r.recommendation_id
      where r.organization_id=v_org and r.model_register_id=m.id and r.recommendation_id is not null
        and d.outcome_status in ('open','executed')
      on conflict do nothing;
  end if;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_promotion',v_role,jsonb_build_object('model_register_id',m.id,'model_key',m.model_key,
    'version',m.version,'from',m.lifecycle_state,'to',p_target_state,'note',btrim(p_review_note),'operational_authorization',false));
  return jsonb_build_object('model_register_id',m.id,'lifecycle_state',p_target_state,
    'production_eligible',p_target_state='production_eligible','operational_authorization',false);
end $$;

-- One production recorder. It records refused attempts as well as answers and
-- independently applies the generic applicability/evidence/configuration gate.
create or replace function public.record_engineering_model_run(
  p_organization_id uuid,p_actor_id uuid,p_model_register_id bigint,p_asset_id uuid,
  p_recommendation_id uuid,p_configuration_baseline_id bigint,p_input_envelope jsonb,
  p_outputs jsonb,p_refusals jsonb,p_execution_environment jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  m public.model_register%rowtype; a public.assets%rowtype; v_id uuid;
  v_refusals jsonb:=coalesce(p_refusals,'[]'::jsonb); v_outputs jsonb:=p_outputs;
  v_status text; v_context jsonb:=p_input_envelope->'context'; v_bindings jsonb:=p_input_envelope->'evidenceBindings';
  v_rule jsonb; v_input jsonb; v_min numeric; v_max numeric; v_value numeric; v_key text;
  v_port record; v_declared_family text; v_canonical_family text;
begin
  if auth.role()<>'service_role' then return jsonb_build_object('error','engineering model execution recording is service-only'); end if;
  select * into m from public.model_register where id=p_model_register_id and organization_id=p_organization_id and is_engineering_model;
  if not found then return jsonb_build_object('error','engineering model not found'); end if;
  if not exists(select 1 from public.user_profiles where id=p_actor_id and organization_id=p_organization_id) then return jsonb_build_object('error','organization member required'); end if;
  select * into a from public.assets where id=p_asset_id and organization_id=p_organization_id;
  if not found then return jsonb_build_object('error','asset not found in this organization'); end if;
  if p_recommendation_id is not null and not exists(select 1 from public.recommendations where id=p_recommendation_id and organization_id=p_organization_id) then return jsonb_build_object('error','recommendation not found in this organization'); end if;
  if jsonb_typeof(coalesce(p_input_envelope,'null'::jsonb))<>'object'
     or jsonb_typeof(coalesce(v_context,'null'::jsonb))<>'object'
     or jsonb_typeof(coalesce(v_context->'inputs','null'::jsonb))<>'object'
     or jsonb_typeof(coalesce(v_context->'activeConditionCodes','null'::jsonb))<>'array'
     or jsonb_typeof(coalesce(v_bindings,'null'::jsonb))<>'array'
     or jsonb_typeof(v_refusals)<>'array'
     or jsonb_typeof(coalesce(p_execution_environment,'null'::jsonb))<>'object'
     or coalesce((p_execution_environment->>'networkUsed')::boolean,true)<>false then
    return jsonb_build_object('error','bounded context, inputs, conditions, evidence bindings, refusal array and offline execution environment are required');
  end if;
  if octet_length(p_input_envelope::text)>1048576 or octet_length(coalesce(p_outputs,'{}'::jsonb)::text)>1048576 then return jsonb_build_object('error','model input or output exceeds 1 MiB'); end if;

  if m.lifecycle_state<>'production_eligible' or not m.production_eligible or m.approved_on is null or not m.human_in_loop then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','model_not_production_eligible','message','Model version is not production-eligible with human-in-loop approval.'));
  end if;
  if coalesce(m.manifest->'execution'->>'arbitraryCodeAllowed','true')<>'false' then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','arbitrary_code_prohibited','message','Imported arbitrary code cannot execute in SyncAI production.'));
  end if;
  if coalesce((m.applicability_envelope->>'configurationBaselineRequired')::boolean,false) then
    if p_configuration_baseline_id is null or not exists(
      select 1 from public.configuration_baselines c where c.id=p_configuration_baseline_id
        and c.organization_id=p_organization_id and c.asset_id=p_asset_id and c.baseline_kind='as_maintained' and c.is_current
    ) then v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','configuration_baseline_missing','message','Current as-maintained configuration baseline is required.')); end if;
    if coalesce(v_context->>'configurationBaselineId','')<>coalesce(p_configuration_baseline_id::text,'') then
      v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','configuration_baseline_mismatch','message','Evaluated context and persisted as-maintained baseline do not match.'));
    end if;
  end if;
  v_declared_family:=coalesce(v_context->>'assetFamily','');
  v_canonical_family:=case lower(coalesce(a.asset_class,''))
    when 'pump' then 'rotating_fluid_equipment'
    when 'compressor' then 'rotating_fluid_equipment'
    when 'motor' then 'rotating_electrical_equipment'
    when 'gearbox' then 'rotating_equipment_power_transmission'
    else coalesce(a.asset_class,'') end;
  if not (v_declared_family=any(array(select jsonb_array_elements_text(m.applicability_envelope->'assetFamilies')))) then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','asset_family_outside_envelope','message','Declared asset family is outside the model envelope.'));
  end if;
  if v_declared_family not in (coalesce(a.asset_class,''),v_canonical_family) then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','asset_family_not_canonical','message','Declared asset family does not match the canonical asset class mapping.'));
  end if;
  if not (coalesce(v_context->>'componentCategory','')=any(array(select jsonb_array_elements_text(m.applicability_envelope->'componentCategories')))) then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','component_outside_envelope','message','Declared component category is outside the model envelope.'));
  end if;
  if not (coalesce(v_context->>'operatingState','')=any(array(select jsonb_array_elements_text(m.applicability_envelope->'operatingStates')))) then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','operating_state_outside_envelope','message','Declared operating state is outside the model envelope.'));
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(v_context->'activeConditionCodes','[]'::jsonb)) c
    where c in (select jsonb_array_elements_text(coalesce(m.applicability_envelope->'excludedConditionCodes','[]'::jsonb)))) then
    v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','excluded_condition_present','message','An excluded operating condition is present.'));
  end if;

  for v_rule in select value from jsonb_array_elements(m.applicability_envelope->'rules') loop
    v_key:=v_rule->>'inputCode'; v_input:=v_context->'inputs'->v_key;
    if v_input is null then v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','applicability_input_missing','path',v_key,'message','Required applicability input is missing.')); continue; end if;
    if coalesce((v_rule->>'evidenceRequired')::boolean,false) and not exists(
      select 1 from jsonb_array_elements(v_bindings) b where b->>'inputCode'=v_key
        and b->>'evidenceItemId'=v_input->>'evidenceItemId'
        and coalesce(b->>'evidenceItemId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','canonical_evidence_missing','path',v_key,'message','Applicability input lacks canonical evidence.')); end if;
    if v_rule ? 'range' then
      begin v_value:=(v_input->>'value')::numeric; exception when others then v_value:=null; end;
      begin v_min:=(v_rule->'range'->>'min')::numeric; exception when others then v_min:=null; end;
      begin v_max:=(v_rule->'range'->>'max')::numeric; exception when others then v_max:=null; end;
      if v_value is null
         or (v_min is not null and (v_value<v_min or (v_value=v_min and coalesce((v_rule->'range'->>'minInclusive')::boolean,true)=false)))
         or (v_max is not null and (v_value>v_max or (v_value=v_max and coalesce((v_rule->'range'->>'maxInclusive')::boolean,true)=false))) then
        v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','input_outside_envelope','path',v_key,'message','Input is outside the approved applicability range.'));
      end if;
    end if;
    if v_rule ? 'allowedValues' and not exists(
      select 1 from jsonb_array_elements(v_rule->'allowedValues') allowed where allowed=v_input->'value'
    ) then
      v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','input_value_not_allowed','path',v_key,'message','Input value is outside the approved applicability set.'));
    end if;
    if coalesce((m.applicability_envelope->>'measurementQualityRequired')::boolean,false) and (
      coalesce((v_input->'measurementQuality'->>'calibrationCurrent')::boolean,false)<>true
      or coalesce((v_input->'measurementQuality'->>'samplingAdequate')::boolean,false)<>true
      or coalesce((v_input->'measurementQuality'->>'driftDetected')::boolean,true)<>false
      or case when coalesce(v_input->'measurementQuality'->>'missingFraction','') ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$'
           then (v_input->'measurementQuality'->>'missingFraction')::numeric else 2 end < 0
      or case when coalesce(v_input->'measurementQuality'->>'missingFraction','') ~ '^-?([0-9]+([.][0-9]+)?|[.][0-9]+)$'
           then (v_input->'measurementQuality'->>'missingFraction')::numeric else 2 end >
         coalesce((m.applicability_envelope->>'maximumMissingFraction')::numeric,0)
    ) then v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','measurement_quality_insufficient','path',v_key,'message','Measurement quality does not meet the model contract.')); end if;
  end loop;

  for v_port in select port_code,unit,required from public.engineering_model_ports
    where model_register_id=m.id and direction='input' loop
    v_input:=v_context->'inputs'->v_port.port_code;
    if v_port.required and v_input is null then
      v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','required_input_missing','path',v_port.port_code,'message','Required model input is missing.'));
    elsif v_input is not null and coalesce(v_input->>'unit','')<>v_port.unit then
      v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','input_unit_mismatch','path',v_port.port_code,'message','Input unit does not match the registered port.'));
    end if;
  end loop;

  if exists(
    select 1 from jsonb_array_elements(v_bindings) b
    left join public.evidence_items e on e.id=case when coalesce(b->>'evidenceItemId','') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (b->>'evidenceItemId')::uuid else null end and e.organization_id=p_organization_id
      and (e.asset_id is null or e.asset_id=p_asset_id)
    where coalesce(b->>'evidenceItemId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or e.id is null or length(btrim(coalesce(b->>'sourceReference','')))<3
      or coalesce(b->>'evidenceGrade','') not in ('A','B','C','D')
  ) then v_refusals:=v_refusals||jsonb_build_array(jsonb_build_object('code','evidence_outside_asset_or_tenant','message','One or more evidence bindings are outside the asset or organization.')); end if;

  if jsonb_array_length(v_refusals)>0 then v_outputs:=null; v_status:='refused';
  elsif jsonb_typeof(coalesce(v_outputs,'null'::jsonb))<>'object' then
    v_refusals:=jsonb_build_array(jsonb_build_object('code','outputs_missing','message','Allowlisted evaluator returned no output object.'));
    v_status:='refused'; v_outputs:=null;
  else v_status:='computed'; end if;

  insert into public.calculation_runs(
    organization_id,calculation_key,method,code_version,inputs,input_refs,outputs,refusals,status,computed_by,
    model_register_id,asset_id,recommendation_id,configuration_baseline_id,execution_environment,evidence_bindings
  ) values(p_organization_id,m.calculation_key,
    'Allowlisted deterministic engineering model execution with server-side applicability and evidence refusal.',
    m.model_key||'@'||m.version,p_input_envelope,'[]'::jsonb,v_outputs,v_refusals,v_status,p_actor_id,
    m.id,p_asset_id,p_recommendation_id,p_configuration_baseline_id,p_execution_environment,v_bindings)
  returning id into v_id;

  return jsonb_build_object('calculation_run_id',v_id,'status',v_status,'outputs',v_outputs,'refusals',v_refusals,
    'model_key',m.model_key,'model_version',m.version,'human_approval_required',true,'operational_authorization',false);
exception when others then return jsonb_build_object('error',sqlerrm);
end $$;

create or replace function public.record_engineering_model_field_outcome(
  p_calculation_run_id uuid,p_outcome boolean,p_work_order_id uuid,p_counterfactual_review jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; r public.calculation_runs%rowtype; v_id bigint;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','field outcome recording authority denied'); end if;
  select * into r from public.calculation_runs where id=p_calculation_run_id and organization_id=v_org and model_register_id is not null;
  if not found then return jsonb_build_object('error','engineering calculation run not found'); end if;
  if r.status<>'computed' then return jsonb_build_object('error','field outcomes can only be attached to a successfully computed engineering run'); end if;
  if p_outcome is null then return jsonb_build_object('error','observed field outcome is required'); end if;
  if jsonb_typeof(coalesce(p_counterfactual_review,'null'::jsonb))<>'object'
     or length(btrim(coalesce(p_counterfactual_review->>'observedBasis','')))<3
     or length(btrim(coalesce(p_counterfactual_review->>'predictionAssessment','')))<3
     or length(btrim(coalesce(p_counterfactual_review->>'designFeedback','')))<3 then
    return jsonb_build_object('error','counterfactual review requires observedBasis, predictionAssessment and designFeedback');
  end if;
  if p_work_order_id is not null and not exists(select 1 from public.work_orders where id=p_work_order_id and organization_id=v_org and (r.asset_id is null or asset_id=r.asset_id)) then return jsonb_build_object('error','work order not found for this asset and organization'); end if;
  insert into public.model_predictions(
    organization_id,model_key,model_version,subject_asset_id,predicted_at,predicted_probability,horizon_days,
    outcome,outcome_recorded_at,outcome_work_order_id,model_register_id,calculation_run_id,predicted_distribution,
    damage_state,consequence_class,censoring_context,cohort_context,counterfactual_review
  ) values(v_org,(select model_key from public.model_register where id=r.model_register_id),
    (select version from public.model_register where id=r.model_register_id),r.asset_id,r.computed_at,
    case when (r.outputs->>'predictedProbability') ~ '^(0([.][0-9]+)?|1([.]0+)?)$' then (r.outputs->>'predictedProbability')::numeric else null end,
    case when (r.outputs->>'horizonDays') ~ '^[0-9]+$' then (r.outputs->>'horizonDays')::int else null end,
    p_outcome,now(),p_work_order_id,r.model_register_id,r.id,r.outputs->'rulDistribution',r.outputs->'damageState',
    r.inputs->'context'->>'consequenceClass',r.inputs->'context'->'censoringContext',r.inputs->'context'->'cohortContext',p_counterfactual_review)
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_outcome',v_role,jsonb_build_object('model_prediction_id',v_id,'calculation_run_id',r.id,'outcome',p_outcome));
  return jsonb_build_object('model_prediction_id',v_id,'outcome_recorded',true,'calculation_run_id',r.id);
end $$;

create or replace function public.record_engineering_model_intervention(
  p_model_register_id bigint,p_asset_id uuid,p_work_order_id uuid,p_pre_damage_state jsonb,
  p_effect_kind text,p_effect_model_reference text,p_post_damage_state jsonb,
  p_configuration_baseline_id bigint,p_evidence_item_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','intervention-effect authority denied'); end if;
  if not exists(select 1 from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model) then return jsonb_build_object('error','engineering model not found'); end if;
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_org) or not exists(select 1 from public.work_orders where id=p_work_order_id and organization_id=v_org and asset_id=p_asset_id) then return jsonb_build_object('error','asset/work-order boundary mismatch'); end if;
  if jsonb_typeof(coalesce(p_pre_damage_state,'null'::jsonb))<>'object' or jsonb_typeof(coalesce(p_post_damage_state,'null'::jsonb))<>'object' then return jsonb_build_object('error','pre- and post-maintenance damage states are required'); end if;
  if p_configuration_baseline_id is null or not exists(select 1 from public.configuration_baselines where id=p_configuration_baseline_id and organization_id=v_org and asset_id=p_asset_id and baseline_kind='as_maintained' and is_current) then return jsonb_build_object('error','current as-maintained configuration is required for an intervention effect'); end if;
  if p_evidence_item_id is null or not exists(select 1 from public.evidence_items where id=p_evidence_item_id and organization_id=v_org and (asset_id is null or asset_id=p_asset_id)) then return jsonb_build_object('error','canonical intervention evidence is required'); end if;
  insert into public.engineering_model_interventions(
    organization_id,model_register_id,asset_id,work_order_id,pre_damage_state,effect_kind,effect_model_reference,
    post_damage_state,configuration_baseline_id,evidence_item_id,recorded_by
  ) values(v_org,p_model_register_id,p_asset_id,p_work_order_id,p_pre_damage_state,p_effect_kind,p_effect_model_reference,
    p_post_damage_state,p_configuration_baseline_id,p_evidence_item_id,auth.uid()) returning id into v_id;
  return jsonb_build_object('intervention_id',v_id,'human_recorded',true);
end $$;

create or replace function public.review_engineering_model_impact(
  p_impact_id uuid,p_status text,p_review_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_model bigint;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','model-impact review authority denied'); end if;
  if p_status not in ('reviewed','not_affected','recomputed','closed') then return jsonb_build_object('error','invalid impact disposition'); end if;
  if length(btrim(coalesce(p_review_note,'')))<10 then return jsonb_build_object('error','review note must contain at least 10 characters'); end if;
  update public.engineering_model_impacts set status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_review_note)
  where id=p_impact_id and organization_id=v_org and status='open' returning model_register_id into v_model;
  if v_model is null then return jsonb_build_object('error','open model impact not found in this organization'); end if;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'engineering_model_impact',v_role,jsonb_build_object('impact_id',p_impact_id,'model_register_id',v_model,'status',p_status,'note',btrim(p_review_note)));
  return jsonb_build_object('impact_id',p_impact_id,'model_register_id',v_model,'status',p_status);
end $$;

create or replace function public.record_fmmea_model_binding(
  p_failure_mode_library_id uuid,p_canonical_asset_id uuid,p_mechanism_id uuid,p_stressors jsonb,
  p_damage_variable text,p_model_register_id bigint,p_occurrence_basis text,p_evidence_item_ids uuid[],
  p_local_effect text,p_system_effect text,p_recommended_action text,p_non_physics_branch boolean,
  p_model_conflict_status text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text;
begin
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','maintenance_manager','reliability_engineer') then return jsonb_build_object('error','FMMEA authority denied'); end if;
  if not exists(select 1 from public.asset_failure_mode_libraries f where f.id=p_failure_mode_library_id and f.organization_id=v_org) then return jsonb_build_object('error','failure-mode row not found in this organization'); end if;
  if p_canonical_asset_id is not null and not exists(select 1 from public.assets where id=p_canonical_asset_id and organization_id=v_org) then return jsonb_build_object('error','asset boundary mismatch'); end if;
  if p_mechanism_id is not null and not exists(select 1 from public.damage_mechanisms where id=p_mechanism_id and organization_id=v_org) then return jsonb_build_object('error','canonical mechanism boundary mismatch'); end if;
  if p_model_register_id is not null and not exists(select 1 from public.model_register where id=p_model_register_id and organization_id=v_org and is_engineering_model and lifecycle_state<>'retired') then return jsonb_build_object('error','active engineering model boundary mismatch'); end if;
  if exists(select 1 from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) evidence_id where not exists(select 1 from public.evidence_items where id=evidence_id and organization_id=v_org)) then return jsonb_build_object('error','evidence boundary mismatch'); end if;
  if coalesce(p_non_physics_branch,false)=false and (
      p_mechanism_id is null or p_model_register_id is null
      or jsonb_typeof(coalesce(p_stressors,'null'::jsonb))<>'array' or jsonb_array_length(p_stressors)=0
      or length(btrim(coalesce(p_damage_variable,'')))<2 or length(btrim(coalesce(p_occurrence_basis,'')))<3
      or cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[]))=0
      or length(btrim(coalesce(p_local_effect,'')))<3 or length(btrim(coalesce(p_system_effect,'')))<3
      or length(btrim(coalesce(p_recommended_action,'')))<3) then
    return jsonb_build_object('error','a PoF FMMEA row requires canonical mechanism, non-empty stressors, damage variable, active model, occurrence evidence, effects and action; otherwise record it explicitly as a non-physics branch');
  end if;
  if coalesce(p_non_physics_branch,false)=false and not exists(
    select 1 from public.engineering_model_mechanisms
    where model_register_id=p_model_register_id and mechanism_id=p_mechanism_id and organization_id=v_org
  ) then
    return jsonb_build_object('error','the selected canonical mechanism is not declared by this model version');
  end if;
  update public.asset_failure_mode_libraries set canonical_asset_id=p_canonical_asset_id,mechanism_id=p_mechanism_id,
    stressors=p_stressors,damage_variable=nullif(btrim(p_damage_variable),''),model_register_id=p_model_register_id,
    occurrence_basis=nullif(btrim(p_occurrence_basis),''),evidence_item_ids=coalesce(p_evidence_item_ids,'{}'::uuid[]),
    local_effect=nullif(btrim(p_local_effect),''),system_effect=nullif(btrim(p_system_effect),''),
    recommended_action=nullif(btrim(p_recommended_action),''),non_physics_branch=coalesce(p_non_physics_branch,false),
    model_conflict_status=coalesce(nullif(btrim(p_model_conflict_status),''),'not_assessed'),updated_at=now()
  where id=p_failure_mode_library_id and organization_id=v_org;
  return jsonb_build_object('failure_mode_library_id',p_failure_mode_library_id,'fmmea_bound',true,
    'human_mechanism_selection_required',true,'non_physics_branch',coalesce(p_non_physics_branch,false));
end $$;

create or replace function public.get_engineering_model_registry()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if v_org is null then return jsonb_build_object('error','authenticated organization required'); end if;
  return jsonb_build_object(
    'models',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'modelKey',m.model_key,'version',m.version,'name',m.manifest->>'name','description',m.manifest->>'description',
      'modelKind',m.model_kind,'domain',m.engineering_domain,'lifeModelType',m.life_model_type,
      'lifecycleState',m.lifecycle_state,'productionEligible',m.production_eligible,'humanInLoop',m.human_in_loop,
      'requiredReviewerRoleKey',m.required_reviewer_role_key,'certificationClass',m.certification_class,
      'escalationClass',m.escalation_class,'sourceTool',m.source_tool,'sourceLicense',m.source_license,
      'airGapCompatible',m.air_gap_compatible,'manifestChecksum',m.manifest_checksum,
      'evidenceRequirements',m.evidence_requirements,'applicabilityEnvelope',m.applicability_envelope,
      'verificationState',case when exists(select 1 from public.calculation_runs r where r.model_register_id=m.id and r.calculation_key='engineering_model_verification' and r.status='computed' and r.outputs->>'passed'='true') then 'passed' else 'not_passed' end,
      'openDebt',(select count(*) from public.engineering_model_verification_debts d where d.model_register_id=m.id and d.resolved_at is null),
      'openDebtRecords',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'debtKey',d.debt_key,'description',d.description,'blocking',d.blocking,'temporaryApprovalExpiresAt',d.temporary_approval_expires_at,'raisedAt',d.raised_at) order by d.raised_at) from public.engineering_model_verification_debts d where d.model_register_id=m.id and d.resolved_at is null),'[]'::jsonb),
      'evidenceBound',(select count(*) from public.engineering_model_evidence_bindings b where b.model_register_id=m.id),
      'recentRuns',(select count(*) from public.calculation_runs r where r.model_register_id=m.id),
      'openImpacts',(select count(*) from public.engineering_model_impacts i where i.model_register_id=m.id and i.status='open')
    ) order by m.model_key,m.version) from public.model_register m where m.organization_id=v_org and m.is_engineering_model),'[]'::jsonb),
    'posture',jsonb_build_object(
      'registered',(select count(*) from public.model_register where organization_id=v_org and is_engineering_model),
      'productionEligible',(select count(*) from public.model_register where organization_id=v_org and is_engineering_model and production_eligible),
      'revalidationRequired',(select count(*) from public.model_register where organization_id=v_org and is_engineering_model and lifecycle_state='revalidation_required'),
      'openBlockingDebt',(select count(*) from public.engineering_model_verification_debts where organization_id=v_org and resolved_at is null and blocking),
      'outcomesRecorded',(select count(*) from public.model_predictions where organization_id=v_org and model_register_id is not null and outcome is not null),
      'basis','Only model_register versions with machine-readable applicability, independent verification, bench and field evidence, competency-scoped approval and no blocking debt can become production-eligible. Every production run remains advisory and human-final.'
    ));
end $$;

create or replace function public.get_recommendation_engineering_model_trace(p_recommendation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org();
begin
  if not exists(select 1 from public.recommendations where id=p_recommendation_id and organization_id=v_org) then return jsonb_build_object('error','recommendation not found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'calculationRunId',r.id,'modelKey',m.model_key,'modelVersion',m.version,'calculationStatus',r.status,
    'verification',case when exists(select 1 from public.calculation_runs v where v.model_register_id=m.id and v.calculation_key='engineering_model_verification' and v.status='computed' and v.outputs->>'passed'='true') then 'pass' else 'not_passed' end,
    'fieldValidation',case when exists(select 1 from public.engineering_model_evidence_bindings b where b.model_register_id=m.id and b.purpose='field_validation') then 'present' else 'missing' end,
    'applicability',case when r.status='computed' then 'within_range' else 'refused' end,
    'engineeringApproval',case when m.approved_on is not null then 'approved' else 'not_approved' end,
    'productionEligibleAtRead',m.production_eligible,'humanApprovalRequired',true,'operationalAuthorization',false,
    'refusals',r.refusals,'computedAt',r.computed_at
  ) order by r.computed_at desc) from public.calculation_runs r join public.model_register m on m.id=r.model_register_id
  where r.organization_id=v_org and r.recommendation_id=p_recommendation_id),'[]'::jsonb);
end $$;

revoke all on function public.engineering_model_actor_has_role(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.engineering_model_grade_rank(text) from public,anon;
revoke all on function public.seed_engineering_model_reviewer_roles() from public,anon,authenticated;
revoke all on function public.ingest_engineering_model_pack(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.bind_engineering_model_evidence(bigint,uuid,text,text,text,text,text) from public,anon;
revoke all on function public.add_engineering_model_verification_debt(bigint,text,text,boolean,timestamptz) from public,anon;
revoke all on function public.resolve_engineering_model_verification_debt(uuid,text) from public,anon,service_role;
revoke all on function public.record_engineering_model_verification(uuid,uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.promote_engineering_model(bigint,text,text) from public,anon,service_role;
revoke all on function public.record_engineering_model_run(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.record_engineering_model_field_outcome(uuid,boolean,uuid,jsonb) from public,anon,service_role;
revoke all on function public.record_engineering_model_intervention(bigint,uuid,uuid,jsonb,text,text,jsonb,bigint,uuid) from public,anon,service_role;
revoke all on function public.review_engineering_model_impact(uuid,text,text) from public,anon,service_role;
revoke all on function public.record_fmmea_model_binding(uuid,uuid,uuid,jsonb,text,bigint,text,uuid[],text,text,text,boolean,text) from public,anon,service_role;
revoke all on function public.get_engineering_model_registry() from public,anon;
revoke all on function public.get_recommendation_engineering_model_trace(uuid) from public,anon;

grant execute on function public.engineering_model_grade_rank(text) to authenticated,service_role;
grant execute on function public.ingest_engineering_model_pack(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.bind_engineering_model_evidence(bigint,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.add_engineering_model_verification_debt(bigint,text,text,boolean,timestamptz) to authenticated;
grant execute on function public.resolve_engineering_model_verification_debt(uuid,text) to authenticated;
grant execute on function public.record_engineering_model_verification(uuid,uuid,bigint,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.promote_engineering_model(bigint,text,text) to authenticated;
grant execute on function public.record_engineering_model_run(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.record_engineering_model_field_outcome(uuid,boolean,uuid,jsonb) to authenticated;
grant execute on function public.record_engineering_model_intervention(bigint,uuid,uuid,jsonb,text,text,jsonb,bigint,uuid) to authenticated;
grant execute on function public.review_engineering_model_impact(uuid,text,text) to authenticated;
grant execute on function public.record_fmmea_model_binding(uuid,uuid,uuid,jsonb,text,bigint,text,uuid[],text,text,text,boolean,text) to authenticated;
grant execute on function public.get_engineering_model_registry() to authenticated;
grant execute on function public.get_recommendation_engineering_model_trace(uuid) to authenticated;

comment on function public.ingest_engineering_model_pack(uuid,uuid,jsonb,text) is
  'Service-only build-time GPD/Sync/OEM/standards artifact ingestion into the ONE model_register. The Edge boundary recomputes the manifest digest; imported code stays inert and lifecycle starts at draft.';
comment on function public.record_engineering_model_run(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb) is
  'Service-only model execution recorder. Reapplies production, applicability, evidence, configuration and measurement-quality gates and records refusals in calculation_runs.';
comment on function public.promote_engineering_model(bigint,text,text) is
  'Strict model promotion ladder with independent verification, bench/field evidence, exact reviewer competency, canonical approval and verification-debt gates.';

notify pgrst,'reload schema';
