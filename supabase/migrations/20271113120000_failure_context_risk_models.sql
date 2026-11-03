-- E1.06: differentiated risk models per failure context.
--
-- The canonical failure contexts remain FAILURE_CONTEXTS in
-- src/lib/industry-profiles/index.ts. This migration does not add a second
-- taxonomy, a risk score, or an OEM limit. failure_context_catalog() is the
-- server enforcement mirror of that array, and
-- src/test/failureContextRiskModelContract.test.ts fails if the two drift.
--
-- A named human binds one tenant asset to one context and names the context
-- it must not be treated as. record_failure_context_binding recomputes engines
-- and workflow with the same rule as checkDifferentiation. The client cannot
-- supply engines, a workflow, or a differentiation verdict. The row is an
-- attestation. It does not approve work, accept risk, change an operating
-- limit, or return equipment to service.

create table if not exists public.failure_context_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  context_key text not null,
  comparison_context_key text not null,
  workflow text not null check (workflow in (
    'safety_investigation', 'reliability_analysis',
    'quality_containment', 'capacity_restoration'
  )),
  comparison_workflow text not null check (comparison_workflow in (
    'safety_investigation', 'reliability_analysis',
    'quality_containment', 'capacity_restoration'
  )),
  engines text[] not null,
  comparison_engines text[] not null,
  required_data text[] not null,
  shared_engines text[] not null,
  distinct_subject_engines text[] not null,
  distinct_comparison_engines text[] not null,
  different_workflow boolean not null,
  differentiation_reason text not null,
  differentiated boolean not null default true check (differentiated),
  basis text not null check (length(btrim(basis)) >= 20),
  work_authorized boolean not null default false check (not work_authorized),
  risk_accepted boolean not null default false check (not risk_accepted),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (context_key <> comparison_context_key)
);

create index if not exists idx_failure_context_bindings_asset
  on public.failure_context_bindings (organization_id, asset_id, recorded_at desc);

alter table public.failure_context_bindings enable row level security;
drop policy if exists failure_context_bindings_org_read
  on public.failure_context_bindings;
create policy failure_context_bindings_org_read
  on public.failure_context_bindings
  for select
  to authenticated
  using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate
  on public.failure_context_bindings
  from public, anon, authenticated, service_role;
grant select on public.failure_context_bindings to authenticated;

create or replace function public.protect_failure_context_bindings()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception 'failure-context bindings are append-only';
end
$fn$;

drop trigger if exists trg_protect_failure_context_bindings
  on public.failure_context_bindings;
create trigger trg_protect_failure_context_bindings
  before update or delete on public.failure_context_bindings
  for each row execute function public.protect_failure_context_bindings();

revoke all on function public.protect_failure_context_bindings()
  from public, anon, authenticated;

create or replace function public.failure_context_catalog()
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select $catalog$
[{"key":"process_trip","label":"Process trip / loss of containment risk","description":"A protective function operated or should have: trips, reliefs, SIS demands. The question is barrier health, not component life.","engines":["pfd_sil","fault_event_trees","alarm_performance","verification_loop"],"workflow":"safety_investigation","requiredData":["protective function register","demand and proof-test records","alarm history"]},{"key":"mobile_plant_failure","label":"Mobile plant component failure","description":"A wear-driven component on a mobile machine reached end of life or failed early. The question is life distribution against operating hours.","engines":["censored_weibull","interval_optimization","spares_optimization","symptom_coding","cost_forecast"],"workflow":"reliability_analysis","requiredData":["operating hours (meter, not calendar)","component change-out history with censoring","failure narratives"]},{"key":"static_equipment_degradation","label":"Static equipment degradation","description":"Corrosion, erosion, fouling on vessels, piping, exchangers. Progresses continuously; the question is inspection timing and remaining life.","engines":["efficiency_degradation","interval_optimization","verification_loop"],"workflow":"reliability_analysis","requiredData":["inspection measurements over time","design limits","process conditions"]},{"key":"rotating_equipment_failure","label":"Rotating equipment failure","description":"Pumps, compressors, turbines. Condition-monitorable, often redundant; the question is redundancy-aware system risk.","engines":["censored_weibull","rbd","monte_carlo","repairable_availability","cascade_interdependency"],"workflow":"reliability_analysis","requiredData":["failure history per unit","redundancy configuration","condition monitoring where fitted"]},{"key":"quality_loss","label":"Quality loss / defect escape","description":"The plant ran but produced scrap or rework — a weld defect, an out-of-spec batch. The question is containment scope, then process capability.","engines":["crow_amsaa","verification_loop"],"workflow":"quality_containment","requiredData":["defect classification","affected-lot traceability","process parameters at time of production"]},{"key":"network_outage","label":"Network / distributed asset outage","description":"A distributed system lost service — feeder, span, main. Consequence scales with topology and restoration order, not asset value.","engines":["cascade_interdependency","rbd","monte_carlo","schedule_risk"],"workflow":"capacity_restoration","requiredData":["network topology / dependency graph","customer-or-load mapping","crew and restoration constraints"]},{"key":"turnaround_execution","label":"Turnaround / outage execution risk","description":"Planned shutdown work where duration is the risk. The question is schedule confidence, not failure probability.","engines":["schedule_risk","monte_carlo","cost_forecast"],"workflow":"capacity_restoration","requiredData":["task network with duration ranges","critical resource constraints"]},{"key":"structural_deterioration","label":"Structural / civil deterioration","description":"Slow, inspection-rated decline of structures. The question is deterioration rate against intervention windows.","engines":["efficiency_degradation","interval_optimization","cost_forecast"],"workflow":"reliability_analysis","requiredData":["condition ratings over time","load and exposure data","intervention cost model"]},{"key":"electrochemical_degradation","label":"Electrochemical capacity and resistance degradation","description":"Measured capacity, resistance, imbalance, and exposure change over cycles. The question is evidence-backed margin to an approved service criterion, not an inferred universal end-of-life threshold.","engines":["efficiency_degradation","censored_weibull","interval_optimization","verification_loop"],"workflow":"reliability_analysis","requiredData":["chemistry and controlled configuration","cycle/capacity/impedance observations with provenance","manufacturer- or authority-approved service criteria"]},{"key":"battery_safety_event","label":"Battery thermal or high-voltage safety event","description":"A thermal excursion, isolation failure, arc/ground fault, gas release, or fire challenge occurred or was demanded. The question is barrier integrity and governed emergency disposition.","engines":["fault_event_trees","monte_carlo","verification_loop","symptom_coding"],"workflow":"safety_investigation","requiredData":["cell/module temperatures and alarm/event history","high-voltage protection and isolation test records","fire detection, suppression, ventilation, and emergency-response evidence"]}]
  $catalog$::jsonb
$fn$;

revoke all on function public.failure_context_catalog()
  from public, anon, authenticated, service_role;

create or replace function public.record_failure_context_binding(
  p_asset_id uuid,
  p_context_key text,
  p_comparison_key text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_a jsonb;
  v_b jsonb;
  v_workflow text;
  v_comparison_workflow text;
  v_engines_a text[];
  v_engines_b text[];
  v_required text[];
  v_shared text[];
  v_distinct_a text[];
  v_distinct_b text[];
  v_different_workflow boolean;
  v_differentiated boolean;
  v_reason text;
  v_id uuid;
  v_known constant text[] := array[
    'safety_investigation', 'reliability_analysis',
    'quality_containment', 'capacity_restoration'
  ];
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object(
      'recorded', false,
      'error', 'a signed-in tenant is required'
    );
  end if;

  select lower(coalesce(up.role, '')) into v_role
  from public.user_profiles up
  where up.id = auth.uid()
    and up.organization_id = v_org;
  if v_role is null or v_role not in (
    'reliability_engineer', 'maintenance_manager', 'admin'
  ) then
    return jsonb_build_object(
      'recorded', false,
      'error', 'binding a failure context requires a named reliability, maintenance, or admin role'
    );
  end if;

  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object(
      'recorded', false,
      'error', 'evidence basis must be at least 20 characters'
    );
  end if;

  if not exists (
    select 1 from public.assets a
    where a.id = p_asset_id
      and a.organization_id = v_org
  ) then
    return jsonb_build_object(
      'recorded', false,
      'error', 'asset is outside the active tenant'
    );
  end if;

  select value into v_a
  from jsonb_array_elements(public.failure_context_catalog())
  where value->>'key' = p_context_key;
  select value into v_b
  from jsonb_array_elements(public.failure_context_catalog())
  where value->>'key' = p_comparison_key;

  if v_a is null or v_b is null then
    return jsonb_build_object(
      'recorded', false,
      'error', 'Unknown context: ' || case
        when v_a is null then coalesce(p_context_key, '')
        else coalesce(p_comparison_key, '')
      end || '.'
    );
  end if;

  if p_context_key = p_comparison_key then
    return jsonb_build_object(
      'recorded', false,
      'error', 'a failure context is not differentiated from itself'
    );
  end if;

  v_workflow := v_a->>'workflow';
  v_comparison_workflow := v_b->>'workflow';
  if v_workflow is null or not (v_workflow = any(v_known))
     or v_comparison_workflow is null
     or not (v_comparison_workflow = any(v_known)) then
    return jsonb_build_object(
      'recorded', false,
      'error', 'the failure-context catalog names a workflow this door does not recognise'
    );
  end if;

  select coalesce(array_agg(value order by ord), '{}'::text[])
    into v_engines_a
  from jsonb_array_elements_text(v_a->'engines') with ordinality as listed(value, ord);
  select coalesce(array_agg(value order by ord), '{}'::text[])
    into v_engines_b
  from jsonb_array_elements_text(v_b->'engines') with ordinality as listed(value, ord);
  select coalesce(array_agg(value order by ord), '{}'::text[])
    into v_required
  from jsonb_array_elements_text(v_a->'requiredData') with ordinality as listed(value, ord);

  select coalesce(array_agg(e order by ord), '{}'::text[])
    into v_shared
  from unnest(v_engines_a) with ordinality as listed(e, ord)
  where e = any(v_engines_b);
  select coalesce(array_agg(e order by ord), '{}'::text[])
    into v_distinct_a
  from unnest(v_engines_a) with ordinality as listed(e, ord)
  where e <> all(v_engines_b);
  select coalesce(array_agg(e order by ord), '{}'::text[])
    into v_distinct_b
  from unnest(v_engines_b) with ordinality as listed(e, ord)
  where e <> all(v_engines_a);

  v_different_workflow := v_workflow is distinct from v_comparison_workflow;
  v_differentiated := cardinality(v_distinct_a) > 0
    or cardinality(v_distinct_b) > 0
    or v_different_workflow;

  if v_differentiated then
    v_reason := '"' || (v_a->>'label') || '" and "' || (v_b->>'label')
      || '" get genuinely different treatment: '
      || case when v_different_workflow
           then 'different workflows (' || v_workflow || ' vs ' || v_comparison_workflow || ')'
           else 'the same workflow' end
      || ', ' || (cardinality(v_distinct_a) + cardinality(v_distinct_b))::text
      || ' engine(s) unique to one side'
      || case when cardinality(v_shared) > 0
           then ', ' || cardinality(v_shared)::text
             || ' legitimately shared (the kernel is common by design — E1.01)'
           else '' end
      || '.';
  else
    return jsonb_build_object(
      'recorded', false,
      'error', 'These two contexts bind to identical engines and the same workflow. If they are really different kinds of failure, the binding is wrong; if not, one of them should not exist.'
    );
  end if;

  insert into public.failure_context_bindings (
    organization_id, asset_id, context_key, comparison_context_key,
    workflow, comparison_workflow, engines, comparison_engines, required_data,
    shared_engines, distinct_subject_engines, distinct_comparison_engines,
    different_workflow, differentiation_reason, differentiated, basis,
    work_authorized, risk_accepted, recorded_by
  ) values (
    v_org, p_asset_id, p_context_key, p_comparison_key,
    v_workflow, v_comparison_workflow, v_engines_a, v_engines_b, v_required,
    v_shared, v_distinct_a, v_distinct_b,
    v_different_workflow, v_reason, true, btrim(p_basis),
    false, false, auth.uid()
  ) returning id into v_id;

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'failure_context_binding',
    public.app_current_role(),
    jsonb_build_object(
      'action', 'recorded',
      'binding_id', v_id,
      'asset_id', p_asset_id,
      'context_key', p_context_key,
      'comparison_context_key', p_comparison_key,
      'workflow', v_workflow,
      'comparison_workflow', v_comparison_workflow,
      'actor_id', auth.uid(),
      'work_authorized', false,
      'risk_accepted', false
    ),
    null,
    jsonb_build_object(
      'binding_id', v_id,
      'context_key', p_context_key,
      'comparison_context_key', p_comparison_key,
      'workflow', v_workflow,
      'comparison_workflow', v_comparison_workflow,
      'different_workflow', v_different_workflow,
      'shared_engines', to_jsonb(v_shared),
      'distinct_subject_engines', to_jsonb(v_distinct_a),
      'distinct_comparison_engines', to_jsonb(v_distinct_b),
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'recorded', true,
    'bindingId', v_id,
    'assetId', p_asset_id,
    'contextKey', p_context_key,
    'comparisonContextKey', p_comparison_key,
    'workflow', v_workflow,
    'comparisonWorkflow', v_comparison_workflow,
    'engines', to_jsonb(v_engines_a),
    'comparisonEngines', to_jsonb(v_engines_b),
    'requiredData', to_jsonb(v_required),
    'sharedEngines', to_jsonb(v_shared),
    'distinctSubjectEngines', to_jsonb(v_distinct_a),
    'distinctComparisonEngines', to_jsonb(v_distinct_b),
    'differentWorkflow', v_different_workflow,
    'reason', v_reason,
    'workAuthorized', false,
    'riskAccepted', false
  );
end
$fn$;

revoke all on function public.record_failure_context_binding(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.record_failure_context_binding(uuid, text, text, text)
  to authenticated;
