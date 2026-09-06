-- ============================================================================
-- Domain-depth specialist runs (serialized after the current migration head).
--
-- Canonical reuse:
--   risks                 -- the decision/risk boundary
--   evidence_items        -- source provenance
--   model_register        -- model approval and human-in-loop posture
--   user_profiles         -- tenant and role authority
--   audit_events          -- immutable operating trail
--
-- The deterministic evaluator executes in the authenticated Edge Function.
-- This migration stores its bounded input/result envelope and enforces the
-- controls that must remain true even if a caller bypasses the UI:
--   * same-tenant risk and evidence only;
--   * only registered module/method pairs;
--   * output is always non-authoritative and human-review-required;
--   * no run can approve a recommendation, dispatch a crew, certify a system,
--     release an asset/product/facility, or change an operating limit.
-- ============================================================================

create table if not exists public.domain_specialist_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_id uuid not null references public.risks(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  module_key text not null,
  method_key text not null,
  model_key text not null,
  model_version text not null,
  required_reviewer_role_key text not null,
  input_envelope jsonb not null,
  result_envelope jsonb not null,
  evidence_item_ids uuid[] not null default '{}',
  run_status text not null check (run_status in ('blocked','draft','reviewed','needs_changes','rejected')),
  authoritative boolean not null default false check (not authoritative),
  human_approval_required boolean not null default true check (human_approval_required),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  review_outcome text check (review_outcome is null or review_outcome in ('reviewed','needs_changes','rejected')),
  check (model_key = 'domain.' || module_key || '.' || method_key),
  check (jsonb_typeof(input_envelope) = 'object'),
  check (jsonb_typeof(result_envelope) = 'object'),
  check (octet_length(input_envelope::text) <= 1048576),
  check (octet_length(result_envelope::text) <= 1048576),
  check (
    (reviewed_at is null and reviewed_by is null and review_note is null and review_outcome is null)
    or
    (reviewed_at is not null and reviewed_by is not null and coalesce(length(btrim(review_note)),0) >= 20 and review_outcome is not null)
  )
);

create index if not exists idx_domain_specialist_runs_risk
  on public.domain_specialist_runs(organization_id, risk_id, created_at desc);
create index if not exists idx_domain_specialist_runs_model
  on public.domain_specialist_runs(organization_id, model_key, created_at desc);

alter table public.domain_specialist_runs enable row level security;
drop policy if exists domain_specialist_runs_org_read on public.domain_specialist_runs;
create policy domain_specialist_runs_org_read on public.domain_specialist_runs
  for select to authenticated
  using (organization_id = public.app_current_org());

create or replace function public.domain_specialist_method_is_registered(
  p_module_key text,
  p_method_key text
)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select (p_module_key, p_method_key) in (
    ('oil-sands-tailings','tailings-geotechnical'),
    ('oil-gas-well-integrity','well-integrity'),
    ('petrochemical-rbi','rbi-corrosion-loop'),
    ('utilities-storm-response','storm-crew-dispatch'),
    ('manufacturing-operations','line-balancing'),
    ('manufacturing-operations','robot-health'),
    ('food-beverage-safety','haccp-verification'),
    ('food-beverage-safety','cip-validation'),
    ('food-beverage-safety','cold-chain'),
    ('pharmaceutical-quality','gxp-validation'),
    ('pharmaceutical-quality','batch-record'),
    ('transport-logistics','route-depot-optimization'),
    ('transport-logistics','inspection-scheduling'),
    ('aviation-airworthiness','airworthiness-compliance'),
    ('aviation-airworthiness','msg3-trace'),
    ('aviation-airworthiness','life-limited-part'),
    ('marine-shipping','class-survey-scheduling'),
    ('marine-shipping','propulsion-efficiency'),
    ('marine-shipping','voyage-optimization'),
    ('data-center-thermal','thermal-airflow'),
    ('defense-readiness','mission-readiness'),
    ('defense-readiness','milspec-configuration'),
    ('defense-readiness','classified-deployment'),
    ('aerospace-launch','reuse-life'),
    ('aerospace-launch','range-safety'),
    ('aerospace-launch','propellant-degradation'),
    ('buildings-infrastructure','code-compliance'),
    ('buildings-infrastructure','fire-life-safety'),
    ('buildings-infrastructure','occupancy-accessibility')
  );
$$;

create or replace function public.domain_specialist_reviewer_role(
  p_module_key text
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case p_module_key
    when 'oil-sands-tailings' then 'domain_tailings_reviewer'
    when 'oil-gas-well-integrity' then 'domain_well_integrity_reviewer'
    when 'petrochemical-rbi' then 'domain_rbi_reviewer'
    when 'utilities-storm-response' then 'domain_storm_dispatch_reviewer'
    when 'manufacturing-operations' then 'domain_manufacturing_reviewer'
    when 'food-beverage-safety' then 'domain_food_safety_reviewer'
    when 'pharmaceutical-quality' then 'domain_pharmaceutical_quality_reviewer'
    when 'transport-logistics' then 'domain_transport_reviewer'
    when 'aviation-airworthiness' then 'domain_airworthiness_reviewer'
    when 'marine-shipping' then 'domain_marine_reviewer'
    when 'data-center-thermal' then 'domain_data_center_thermal_reviewer'
    when 'defense-readiness' then 'domain_defense_readiness_reviewer'
    when 'aerospace-launch' then 'domain_launch_reviewer'
    when 'buildings-infrastructure' then 'domain_building_safety_reviewer'
    else null
  end;
$$;

create or replace function public.domain_specialist_required_evidence(
  p_method_key text
)
returns text[]
language sql
immutable
security invoker
set search_path = public
as $$
  select case p_method_key
    when 'tailings-geotechnical' then array['geotechnical-model','survey-or-instrumentation','approved-criteria']
    when 'well-integrity' then array['well-schematic','barrier-verification','pressure-history','approved-operating-envelope']
    when 'rbi-corrosion-loop' then array['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix']
    when 'storm-crew-dispatch' then array['incident-feed','crew-roster','competency-records','travel-time-source','dispatch-policy']
    when 'line-balancing' then array['time-study','demand-plan','precedence-definition']
    when 'robot-health' then array['robot-controller-history','condition-monitoring','maintenance-history','approved-signal-model']
    when 'haccp-verification' then array['approved-haccp-plan','monitoring-records','corrective-action-records','verification-records']
    when 'cip-validation' then array['validated-cip-recipe','cycle-historian','instrument-calibration','deviation-records']
    when 'cold-chain' then array['temperature-history','sensor-calibration','lot-traceability','approved-stability-or-shelf-life-basis']
    when 'gxp-validation' then array['validation-plan','requirements-specification','test-protocols-and-results','deviations','change-control']
    when 'batch-record' then array['master-batch-record','executed-batch-record','laboratory-results','deviation-and-oos-records']
    when 'route-depot-optimization' then array['orders-or-service-demand','depot-and-fleet-capacity','approved-route-cost-source','operating-constraints']
    when 'inspection-scheduling' then array['inspection-history','applicable-interval-register','fleet-status','qualified-inspector-capacity']
    when 'airworthiness-compliance' then array['current-airworthiness-publications','aircraft-configuration','technical-records','authorized-release-records']
    when 'msg3-trace' then array['approved-msg3-policy','configuration-baseline','decision-records','in-service-data']
    when 'life-limited-part' then array['authorized-component-records','back-to-birth-history','current-approved-life-limit','installation-configuration']
    when 'class-survey-scheduling' then array['class-status-report','credited-survey-history','approved-survey-cycle','docking-plan']
    when 'propulsion-efficiency' then array['fuel-or-energy-metering','distance-and-speed','draft-and-load','weather-current','approved-baseline-model']
    when 'voyage-optimization' then array['approved-route-options','weather-and-current-forecast','vessel-limitations','port-and-channel-constraints','charter-or-schedule-obligations']
    when 'thermal-airflow' then array['power-and-heat-load','airflow-measurement','thermal-sensors','cooling-topology','approved-envelopes']
    when 'mission-readiness' then array['approved-mission-requirements','configuration-status','maintenance-status','crew-qualification','supply-readiness']
    when 'milspec-configuration' then array['approved-configuration-baseline','as-maintained-configuration','deviations-and-waivers','obsolescence-and-substitution-records']
    when 'classified-deployment' then array['authorization-or-accreditation','system-security-plan','boundary-and-data-flow','offline-continuity-test','supply-chain-approval']
    when 'reuse-life' then array['as-flown-configuration','authenticated-mission-history','current-life-limits','inspection-and-refurbishment-records']
    when 'range-safety' then array['range-approved-requirements','trajectory-and-debris-analyses','flight-termination-system-status','weather-and-public-safety-constraints','launch-authorization-records']
    when 'propellant-degradation' then array['material-specification','sample-and-test-results','storage-history','handling-history','approved-degradation-model-or-limits']
    when 'code-compliance' then array['jurisdiction-and-adopted-code-register','approved-design-documents','as-built-records','inspection-and-permit-records']
    when 'fire-life-safety' then array['fire-safety-plan','inspection-test-maintenance-records','impairment-permits','egress-and-occupant-basis','emergency-drill-or-validation']
    when 'occupancy-accessibility' then array['permit-register','final-inspection-records','accessibility-review','fire-and-life-safety-clearance','authority-certificate']
    else null
  end;
$$;

create or replace function public.domain_specialist_actor_has_role(
  p_actor_id uuid,
  p_organization_id uuid,
  p_role_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_actor_id
      and profile.organization_id = p_organization_id
      and profile.role = p_role_key
  ) or exists (
    select 1
    from public.user_role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.user_id = p_actor_id
      and assignment.organization_id = p_organization_id
      and role.organization_id = p_organization_id
      and role.key = p_role_key
  );
$$;

create or replace function public.seed_domain_specialist_reviewer_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles (organization_id,key,code,name,description,level)
  select new.id, definition.key, definition.key, definition.name,
    'Authorizes independent review of non-authoritative SyncAI domain specialist runs only.', 1
  from (values
    ('domain_tailings_reviewer','Tailings Geotechnical Reviewer'),
    ('domain_well_integrity_reviewer','Well Integrity Reviewer'),
    ('domain_rbi_reviewer','RBI Reviewer'),
    ('domain_storm_dispatch_reviewer','Storm Dispatch Reviewer'),
    ('domain_manufacturing_reviewer','Manufacturing Specialist Reviewer'),
    ('domain_food_safety_reviewer','Food Safety Reviewer'),
    ('domain_pharmaceutical_quality_reviewer','Pharmaceutical Quality Reviewer'),
    ('domain_transport_reviewer','Transport Specialist Reviewer'),
    ('domain_airworthiness_reviewer','Airworthiness Reviewer'),
    ('domain_marine_reviewer','Marine Specialist Reviewer'),
    ('domain_data_center_thermal_reviewer','Data Center Thermal Reviewer'),
    ('domain_defense_readiness_reviewer','Defense Readiness Reviewer'),
    ('domain_launch_reviewer','Aerospace and Launch Reviewer'),
    ('domain_building_safety_reviewer','Building Safety Reviewer')
  ) definition(key,name)
  where not exists (
    select 1 from public.roles role
    where role.organization_id = new.id and role.key = definition.key
  );
  return new;
end;
$$;

drop trigger if exists trg_seed_domain_specialist_reviewer_roles on public.organizations;
create trigger trg_seed_domain_specialist_reviewer_roles
  after insert on public.organizations
  for each row execute function public.seed_domain_specialist_reviewer_roles();

insert into public.roles (organization_id,key,code,name,description,level)
select organization.id, definition.key, definition.key, definition.name,
  'Authorizes independent review of non-authoritative SyncAI domain specialist runs only.', 1
from public.organizations organization
cross join (values
  ('domain_tailings_reviewer','Tailings Geotechnical Reviewer'),
  ('domain_well_integrity_reviewer','Well Integrity Reviewer'),
  ('domain_rbi_reviewer','RBI Reviewer'),
  ('domain_storm_dispatch_reviewer','Storm Dispatch Reviewer'),
  ('domain_manufacturing_reviewer','Manufacturing Specialist Reviewer'),
  ('domain_food_safety_reviewer','Food Safety Reviewer'),
  ('domain_pharmaceutical_quality_reviewer','Pharmaceutical Quality Reviewer'),
  ('domain_transport_reviewer','Transport Specialist Reviewer'),
  ('domain_airworthiness_reviewer','Airworthiness Reviewer'),
  ('domain_marine_reviewer','Marine Specialist Reviewer'),
  ('domain_data_center_thermal_reviewer','Data Center Thermal Reviewer'),
  ('domain_defense_readiness_reviewer','Defense Readiness Reviewer'),
  ('domain_launch_reviewer','Aerospace and Launch Reviewer'),
  ('domain_building_safety_reviewer','Building Safety Reviewer')
) definition(key,name)
where not exists (
  select 1 from public.roles role
  where role.organization_id = organization.id and role.key = definition.key
);

create or replace function public.record_domain_specialist_run(
  p_organization_id uuid,
  p_actor_id uuid,
  p_risk_id uuid,
  p_run jsonb,
  p_evidence_item_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := p_organization_id;
  v_role text;
  v_asset uuid;
  v_id uuid;
  v_module text := btrim(coalesce(p_run->>'moduleKey',''));
  v_method text := btrim(coalesce(p_run->>'methodKey',''));
  v_model text := btrim(coalesce(p_run->>'modelKey',''));
  v_version text := btrim(coalesce(p_run->>'modelVersion',''));
  v_status text := btrim(coalesce(p_run->>'status',''));
  v_required_role text := btrim(coalesce(p_run->>'requiredApproverRoleKey',''));
  v_inputs jsonb := p_run->'inputs';
  v_bindings jsonb := p_run->'inputs'->'evidenceBindings';
  v_required_evidence text[];
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('error','specialist persistence is service-only; execute through the authenticated Edge Function');
  end if;
  select role into v_role
  from public.user_profiles
  where id = p_actor_id and organization_id = v_org;
  if p_actor_id is null or v_role is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select asset_id into v_asset
  from public.risks
  where id = p_risk_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error','risk not found in this organization');
  end if;
  if not public.domain_specialist_method_is_registered(v_module,v_method) then
    return jsonb_build_object('error','domain specialist module/method is not registered');
  end if;
  v_required_evidence := public.domain_specialist_required_evidence(v_method);
  if v_model <> 'domain.' || v_module || '.' || v_method then
    return jsonb_build_object('error','model key does not match the registered module/method');
  end if;
  if v_version = '' then
    return jsonb_build_object('error','model version is required');
  end if;
  if v_required_role is distinct from public.domain_specialist_reviewer_role(v_module) then
    return jsonb_build_object('error','required reviewer role does not match the registered specialist module');
  end if;
  if v_status not in ('blocked','draft') then
    return jsonb_build_object('error','new specialist runs must be blocked or draft');
  end if;
  if coalesce((p_run->>'authoritative')::boolean,true)
     or not coalesce((p_run->>'humanApprovalRequired')::boolean,false) then
    return jsonb_build_object('error','specialist output must be non-authoritative and require human approval');
  end if;
  if jsonb_typeof(coalesce(v_inputs,'null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(v_inputs->'parameters','null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(v_bindings,'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_run->'result','null'::jsonb)) <> 'object' then
    return jsonb_build_object('error','bounded parameters, evidence bindings and result objects are required');
  end if;
  if btrim(coalesce(p_run->'result'->>'moduleKey','')) <> v_module
     or btrim(coalesce(p_run->'result'->>'methodKey','')) <> v_method
     or btrim(coalesce(p_run->'result'->>'modelKey','')) <> v_model
     or btrim(coalesce(p_run->'result'->>'modelVersion','')) <> v_version
     or btrim(coalesce(p_run->'result'->>'status','')) <> v_status
     or btrim(coalesce(p_run->'result'->>'requiredApproverRoleKey','')) <> v_required_role
     or coalesce((p_run->'result'->>'authoritative')::boolean,true)
     or not coalesce((p_run->'result'->>'humanApprovalRequired')::boolean,false) then
    return jsonb_build_object('error','result envelope does not match the governed run contract');
  end if;
  if octet_length(v_inputs::text) > 1048576
     or octet_length((p_run->'result')::text) > 1048576 then
    return jsonb_build_object('error','specialist input/result exceeds the 1 MiB envelope limit');
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) evidence_id
    left join public.evidence_items evidence
      on evidence.id = evidence_id and evidence.organization_id = v_org and evidence.risk_id = p_risk_id
    where evidence.id is null
  ) then
    return jsonb_build_object('error','one or more evidence items are outside this risk or organization');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_bindings) binding
    where jsonb_typeof(binding) <> 'object'
      or coalesce(length(btrim(binding->>'key')),0) = 0
      or coalesce(length(btrim(binding->>'sourceReference')),0) = 0
      or coalesce(binding->>'evidenceItemId','') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return jsonb_build_object('error','every evidence binding requires a key, source reference and canonical evidence UUID');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_bindings) binding
    group by binding->>'key' having count(*) > 1
  ) then
    return jsonb_build_object('error','evidence binding keys must be unique');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_bindings) binding
    where not ((binding->>'key') = any(v_required_evidence))
  ) then
    return jsonb_build_object('error','evidence binding key is not required by this specialist method');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_bindings) binding
    where not ((binding->>'evidenceItemId')::uuid = any(coalesce(p_evidence_item_ids,'{}'::uuid[])))
  ) or exists (
    select 1 from unnest(coalesce(p_evidence_item_ids,'{}'::uuid[])) evidence_id
    where not exists (
      select 1 from jsonb_array_elements(v_bindings) binding
      where (binding->>'evidenceItemId')::uuid = evidence_id
    )
  ) then
    return jsonb_build_object('error','canonical evidence IDs must exactly match the explicit evidence bindings');
  end if;
  if v_status = 'draft' and cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[])) = 0 then
    return jsonb_build_object('error','a computed draft must link at least one canonical evidence item');
  end if;
  if v_status = 'draft' and exists (
    select 1 from unnest(v_required_evidence) required_key
    where not exists (
      select 1 from jsonb_array_elements(v_bindings) binding
      where binding->>'key' = required_key
    )
  ) then
    return jsonb_build_object('error','a computed draft must bind every required evidence key to canonical evidence');
  end if;

  insert into public.model_register (
    organization_id,model_key,version,model_kind,purpose,approved_for,
    human_in_loop,verification_reference,limitations
  ) values (
    v_org,v_model,v_version,'rule_based',
    'Governed domain-depth specialist calculation or trace verification.',
    '{}'::text[],true,'src/lib/domain-specialists/domain-specialists.test.ts',
    'Non-authoritative draft. Tenant/OEM/authority inputs and qualified human review are mandatory. The model cannot certify, release, dispatch, approve limits, or authorize operation.'
  ) on conflict (organization_id,model_key,version) do nothing;

  insert into public.domain_specialist_runs (
    organization_id,risk_id,asset_id,module_key,method_key,model_key,model_version,required_reviewer_role_key,
    input_envelope,result_envelope,evidence_item_ids,run_status,
    authoritative,human_approval_required,created_by
  ) values (
    v_org,p_risk_id,v_asset,v_module,v_method,v_model,v_version,v_required_role,
    v_inputs,p_run->'result',coalesce(p_evidence_item_ids,'{}'::uuid[]),v_status,
    false,true,p_actor_id
  ) returning id into v_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values (
    v_org,'domain_specialist_run',v_role,
    jsonb_build_object(
      'run_id',v_id,'risk_id',p_risk_id,'module_key',v_module,
      'method_key',v_method,'model_key',v_model,'model_version',v_version,
      'required_reviewer_role_key',v_required_role,
      'status',v_status,'authoritative',false,'human_approval_required',true,
      'evidence_count',cardinality(coalesce(p_evidence_item_ids,'{}'::uuid[]))
    )
  );
  return jsonb_build_object(
    'run_id',v_id,'status',v_status,'model_key',v_model,
    'authoritative',false,'human_approval_required',true
  );
end;
$$;

create or replace function public.review_domain_specialist_run(
  p_run_id uuid,
  p_outcome text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_run public.domain_specialist_runs%rowtype;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization member required');
  end if;
  select * into v_run
  from public.domain_specialist_runs
  where id = p_run_id and organization_id = v_org and reviewed_at is null
  for update;
  if not found then return jsonb_build_object('error','unreviewed specialist run not found in this organization'); end if;
  if not public.domain_specialist_actor_has_role(
    auth.uid(),v_org,v_run.required_reviewer_role_key
  ) then
    return jsonb_build_object(
      'error','independent domain review requires assigned role ' || v_run.required_reviewer_role_key
    );
  end if;
  select role into v_role
  from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if p_outcome not in ('reviewed','needs_changes','rejected') then
    return jsonb_build_object('error','invalid review outcome');
  end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','record at least 20 characters of review basis');
  end if;
  if v_run.created_by = auth.uid() then
    return jsonb_build_object('error','independent review cannot be completed by the run author');
  end if;
  if p_outcome = 'reviewed' and cardinality(v_run.evidence_item_ids) = 0 then
    return jsonb_build_object('error','a run without canonical evidence cannot be reviewed complete');
  end if;

  update public.domain_specialist_runs
  set run_status = p_outcome,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = btrim(p_note),
      review_outcome = p_outcome,
      authoritative = false,
      human_approval_required = true
  where id = v_run.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values (
    v_org,'domain_specialist_review',v_role,
    jsonb_build_object(
      'run_id',v_run.id,'risk_id',v_run.risk_id,'outcome',p_outcome,
      'required_reviewer_role_key',v_run.required_reviewer_role_key,
      'independent_reviewer',true,'authoritative',false,
      'note',btrim(p_note)
    )
  );
  return jsonb_build_object(
    'run_id',v_run.id,'status',p_outcome,'independent_reviewer',true,
    'authoritative',false,'human_approval_required',true
  );
end;
$$;

revoke all on table public.domain_specialist_runs from anon;
revoke all on function public.domain_specialist_method_is_registered(text,text) from public,anon;
revoke all on function public.domain_specialist_reviewer_role(text) from public,anon,authenticated;
revoke all on function public.domain_specialist_required_evidence(text) from public,anon,authenticated;
revoke all on function public.domain_specialist_actor_has_role(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.seed_domain_specialist_reviewer_roles() from public,anon,authenticated;
revoke all on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.review_domain_specialist_run(uuid,text,text) from public,anon,service_role;
grant select on table public.domain_specialist_runs to authenticated;
grant execute on function public.domain_specialist_method_is_registered(text,text) to authenticated,service_role;
grant execute on function public.domain_specialist_reviewer_role(text) to service_role;
grant execute on function public.domain_specialist_required_evidence(text) to service_role;
grant execute on function public.record_domain_specialist_run(uuid,uuid,uuid,jsonb,uuid[]) to service_role;
grant execute on function public.review_domain_specialist_run(uuid,text,text) to authenticated;

insert into public.standards_capability_map
  (designation,capability_ref,capability_label,dependency,note)
values
  ('API 580','domain.petrochemical-rbi.rbi-corrosion-loop','RBI corrosion-loop screening','normative','Method calculates measured corrosion rate and remaining-life screens from supplied inputs; it is not a full API 581 implementation.'),
  ('API 581','domain.petrochemical-rbi.rbi-corrosion-loop','RBI risk-matrix and remaining-life screening','normative','PoF, CoF, damage factors and minimum thickness are authority inputs, never inferred by this method.'),
  ('MIL-HDBK-338B','domain.defense-readiness.mission-readiness','Defense mission-readiness reliability support','informative','The method uses command-approved readiness definitions and does not infer mission authorization.')
on conflict (designation,capability_ref) do update
set capability_label=excluded.capability_label,
    dependency=excluded.dependency,
    note=excluded.note;

notify pgrst, 'reload schema';
