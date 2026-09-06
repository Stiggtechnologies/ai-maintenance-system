-- Canonical industry selection and durable ISO 31000 implementation discovery.
-- This is a forward-only correction to the deployed implementation copilot:
-- industry guidance must not masquerade as an organizational dependency, and
-- the current-state assessment must remain reviewable after the RPC returns.

alter table public.risk_context_nodes
  add column if not exists implementation_discovery jsonb not null default '{}'::jsonb,
  add column if not exists implementation_gap_assessment jsonb not null default '{}'::jsonb,
  add column if not exists implementation_roadmap jsonb not null default '[]'::jsonb;

alter table public.risk_context_nodes
  drop constraint if exists risk_context_implementation_discovery_object,
  drop constraint if exists risk_context_implementation_gap_object,
  drop constraint if exists risk_context_implementation_roadmap_array;

alter table public.risk_context_nodes
  add constraint risk_context_implementation_discovery_object
    check (jsonb_typeof(implementation_discovery) = 'object'),
  add constraint risk_context_implementation_gap_object
    check (jsonb_typeof(implementation_gap_assessment) = 'object'),
  add constraint risk_context_implementation_roadmap_array
    check (jsonb_typeof(implementation_roadmap) = 'array');

create or replace function public.start_iso31000_implementation(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_context uuid;
  v_criteria uuid;
  v_missing text[] := '{}';
  v_invalid text[] := '{}';
  v_required_arrays text[] := array[
    'objectives',
    'critical_services',
    'stakeholders',
    'obligations',
    'dependencies',
    'existing_systems',
    'risk_capture_systems',
    'consequence_dimensions',
    'likelihood_scale',
    'risk_tolerances',
    'decision_points',
    'treatment_tracking_systems'
  ];
  v_field text;
  v_industry_code text;
  v_industry_label text;
  v_pack_readiness text;
  v_pack_validation text;
  v_focus_source text;
  v_expected_label text;
  v_expected_readiness text;
  v_expected_validation text;
  v_expected_focus_source text;
  v_gap_assessment jsonb;
  v_roadmap jsonb;
begin
  select role into v_role
  from user_profiles
  where id = auth.uid() and organization_id = v_org;

  if v_role is null or v_role not in (
    'admin',
    'ai_admin',
    'executive',
    'maintenance_manager',
    'reliability_engineer'
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('error', 'implementation discovery must be an object');
  end if;
  if octet_length(p_answers::text) > 65536 then
    return jsonb_build_object('error', 'implementation discovery exceeds 64 KB');
  end if;

  foreach v_field in array v_required_arrays loop
    if jsonb_typeof(coalesce(p_answers -> v_field, 'null'::jsonb)) <> 'array' then
      v_invalid := array_append(v_invalid, v_field);
    elsif jsonb_array_length(p_answers -> v_field) = 0 then
      v_missing := array_append(v_missing, v_field);
    end if;
  end loop;

  foreach v_field in array array[
    'thresholds',
    'scoring_weights',
    'decision_thresholds',
    'risk_capacity',
    'aggregate_rules',
    'time_factors'
  ] loop
    if p_answers ? v_field and jsonb_typeof(p_answers -> v_field) <> 'object' then
      v_invalid := array_append(v_invalid, v_field);
    end if;
  end loop;

  foreach v_field in array array[
    'objectives',
    'critical_services',
    'stakeholders',
    'obligations',
    'dependencies',
    'existing_systems',
    'risk_capture_systems',
    'risk_tolerances',
    'decision_points',
    'treatment_tracking_systems'
  ] loop
    if jsonb_typeof(coalesce(p_answers -> v_field, 'null'::jsonb)) = 'array' then
      if exists (
        select 1
        from jsonb_array_elements(p_answers -> v_field) item
        where jsonb_typeof(item) <> 'string'
          or coalesce(btrim(item #>> '{}'), '') = ''
      ) then
        v_invalid := array_append(v_invalid, v_field || '[]');
      end if;
    end if;
  end loop;

  if jsonb_typeof(coalesce(p_answers -> 'consequence_dimensions', 'null'::jsonb)) = 'array' then
    if exists (
       select 1
       from jsonb_array_elements(p_answers -> 'consequence_dimensions') item
       where case
         when jsonb_typeof(item) <> 'object' then true
         when coalesce(btrim(item ->> 'key'), '') = '' then true
         when coalesce(btrim(item ->> 'label'), '') = '' then true
         when jsonb_typeof(coalesce(item -> 'scale', 'null'::jsonb)) <> 'array' then true
         else jsonb_array_length(item -> 'scale') = 0
       end
     ) then
      v_invalid := array_append(v_invalid, 'consequence_dimensions[]');
    end if;
  end if;

  if jsonb_typeof(coalesce(p_answers -> 'likelihood_scale', 'null'::jsonb)) = 'array' then
    if exists (
       select 1
       from jsonb_array_elements(p_answers -> 'likelihood_scale') item
       where jsonb_typeof(item) <> 'object'
         or jsonb_typeof(coalesce(item -> 'score', 'null'::jsonb)) <> 'number'
         or coalesce(btrim(item ->> 'label'), '') = ''
     ) then
      v_invalid := array_append(v_invalid, 'likelihood_scale[]');
    end if;
  end if;

  foreach v_field in array array[
    'industry_risk_objects',
    'industry_kernel_contexts',
    'industry_prose_only'
  ] loop
    if p_answers ? v_field then
      if jsonb_typeof(p_answers -> v_field) <> 'array' then
        v_invalid := array_append(v_invalid, v_field);
      elsif exists (
        select 1
        from jsonb_array_elements(p_answers -> v_field) item
        where jsonb_typeof(item) <> 'string'
      ) then
        v_invalid := array_append(v_invalid, v_field || '[]');
      end if;
    end if;
  end loop;

  if coalesce(btrim(p_answers ->> 'risk_owner_role'), '') = '' then
    v_missing := array_append(v_missing, 'risk_owner_role');
  end if;
  if coalesce(btrim(p_answers ->> 'acceptance_authority'), '') = '' then
    v_missing := array_append(v_missing, 'acceptance_authority');
  end if;

  if jsonb_typeof(coalesce(p_answers -> 'escalation_thresholds', 'null'::jsonb)) <> 'object' then
    v_invalid := array_append(v_invalid, 'escalation_thresholds');
  elsif jsonb_typeof(coalesce(p_answers -> 'escalation_thresholds' -> 'statements', 'null'::jsonb)) <> 'array' then
    v_invalid := array_append(v_invalid, 'escalation_thresholds.statements');
  elsif jsonb_array_length(p_answers -> 'escalation_thresholds' -> 'statements') = 0 then
    v_missing := array_append(v_missing, 'escalation_thresholds');
  end if;

  if array_length(v_invalid, 1) > 0 then
    return jsonb_build_object(
      'error', 'implementation discovery contains invalid field types',
      'invalid', v_invalid
    );
  end if;
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'error', 'implementation discovery is incomplete',
      'missing', v_missing
    );
  end if;

  v_industry_code := btrim(coalesce(p_answers ->> 'industry_code', ''));
  v_industry_label := btrim(coalesce(p_answers ->> 'industry_label', ''));
  v_pack_readiness := btrim(coalesce(p_answers ->> 'industry_pack_readiness', ''));
  v_pack_validation := btrim(coalesce(p_answers ->> 'industry_pack_validation', ''));
  v_focus_source := btrim(coalesce(p_answers ->> 'industry_focus_source', ''));

  if v_industry_code = '' or length(v_industry_code) > 160 then
    return jsonb_build_object('error', 'a valid industry code is required');
  end if;
  if v_industry_label = '' or length(v_industry_label) > 120 then
    return jsonb_build_object('error', 'a valid industry label is required');
  end if;
  if v_pack_readiness not in ('kernel_bound', 'template_only', 'focus_draft', 'custom') then
    return jsonb_build_object('error', 'a valid industry pack readiness is required');
  end if;
  if v_pack_validation not in ('draft', 'reviewed', 'customer_validated', 'deprecated', 'not_applicable') then
    return jsonb_build_object('error', 'a valid industry pack validation status is required');
  end if;
  if v_focus_source not in ('curated', 'template_guidance', 'custom') then
    return jsonb_build_object('error', 'a valid industry focus source is required');
  end if;

  v_expected_validation := 'draft';
  v_expected_focus_source := 'template_guidance';
  case v_industry_code
    when 'oil_sands' then v_expected_label := 'Oil Sands'; v_expected_readiness := 'kernel_bound'; v_expected_focus_source := 'curated';
    when 'mining' then v_expected_label := 'Mining'; v_expected_readiness := 'kernel_bound'; v_expected_focus_source := 'curated';
    when 'oil_gas' then v_expected_label := 'Oil & Gas'; v_expected_readiness := 'kernel_bound'; v_expected_focus_source := 'curated';
    when 'petrochemical' then v_expected_label := 'Petrochemical'; v_expected_readiness := 'kernel_bound';
    when 'power_generation' then v_expected_label := 'Power Generation'; v_expected_readiness := 'kernel_bound';
    when 'utilities' then v_expected_label := 'Utilities'; v_expected_readiness := 'kernel_bound';
    when 'manufacturing' then v_expected_label := 'Manufacturing'; v_expected_readiness := 'kernel_bound'; v_expected_focus_source := 'curated';
    when 'food_beverage' then v_expected_label := 'Food & Beverage'; v_expected_readiness := 'template_only';
    when 'pharmaceuticals' then v_expected_label := 'Pharmaceuticals'; v_expected_readiness := 'kernel_bound';
    when 'transportation_logistics' then v_expected_label := 'Transportation & Logistics'; v_expected_readiness := 'kernel_bound'; v_expected_focus_source := 'curated';
    when 'aviation' then v_expected_label := 'Aviation'; v_expected_readiness := 'template_only';
    when 'marine_shipping' then v_expected_label := 'Marine Shipping'; v_expected_readiness := 'template_only';
    when 'data_centers' then v_expected_label := 'Data Centers'; v_expected_readiness := 'kernel_bound';
    when 'defense' then v_expected_label := 'Defense'; v_expected_readiness := 'template_only';
    when 'aerospace_launch' then v_expected_label := 'Aerospace & Launch'; v_expected_readiness := 'template_only';
    when 'buildings_infrastructure' then v_expected_label := 'Buildings & Infrastructure'; v_expected_readiness := 'focus_draft'; v_expected_focus_source := 'curated';
    else
      if v_industry_code like 'custom:%'
         and coalesce(btrim(substring(v_industry_code from 8)), '') <> '' then
        v_expected_label := btrim(substring(v_industry_code from 8));
        v_expected_readiness := 'custom';
        v_expected_validation := 'not_applicable';
        v_expected_focus_source := 'custom';
      else
        return jsonb_build_object('error', 'industry code is not in the governed catalog');
      end if;
  end case;

  if v_industry_label <> v_expected_label
     or v_pack_readiness <> v_expected_readiness
     or v_pack_validation <> v_expected_validation
     or v_focus_source <> v_expected_focus_source then
    return jsonb_build_object(
      'error', 'industry pack provenance does not match the governed catalog'
    );
  end if;

  v_gap_assessment := jsonb_build_object(
    'status', 'preliminary',
    'evidence_basis', 'Implementation discovery answers only; documents, interviews, operating records and control evidence remain unverified',
    'maturity_score', null,
    'gaps', jsonb_build_array(
      jsonb_build_object(
        'area', 'leadership_and_commitment',
        'status', 'unassessed',
        'finding', 'Leadership commitment, policy authority and governance effectiveness require evidence review'
      ),
      jsonb_build_object(
        'area', 'criteria',
        'status', 'gap',
        'finding', 'Consequence, likelihood, tolerance and escalation inputs are captured as draft criteria and require configuration and authorized adoption'
      ),
      jsonb_build_object(
        'area', 'workflow_integration',
        'status', 'gap',
        'finding', 'Decision points are identified, but governed assessments and authority gates are not yet deployed into those workflows'
      ),
      jsonb_build_object(
        'area', 'systems_integration',
        'status', 'unverified',
        'finding', 'Existing, risk-capture and treatment-tracking systems are named; connector bindings, provenance and write-back controls remain unverified'
      ),
      jsonb_build_object(
        'area', 'monitoring_and_improvement',
        'status', 'gap',
        'finding', 'Indicators, baselines, reassessment triggers, outcome verification and improvement cadence are not yet configured'
      ),
      jsonb_build_object(
        'area', 'industry_pack',
        'status', case
          when v_expected_readiness = 'kernel_bound' then 'validation_required'
          else 'execution_gap'
        end,
        'finding', case
          when v_expected_readiness = 'kernel_bound'
            then 'Kernel bindings exist, but industry content remains draft pending authorized domain and customer validation'
          when v_expected_readiness = 'template_only'
            then 'Template guidance exists, but no executable sector profile is claimed'
          when v_expected_readiness = 'focus_draft'
            then 'Risk-focus guidance exists, but no governed template or executable sector profile is claimed'
          else 'Organization-specific sector content and executable bindings must be configured and validated'
        end
      ),
      jsonb_build_object(
        'area', 'maturity',
        'status', 'unassessed',
        'finding', 'ISO 31000 maturity must be recorded through the separate evidence-based assessment; no score is inferred from feature presence'
      )
    ),
    'human_review_required', true
  );

  v_roadmap := jsonb_build_array(
    jsonb_build_object(
      'phase', 'Current-state assessment',
      'status', 'ready',
      'output', 'Captured objectives, services, stakeholders, obligations, dependencies, systems and decision points'
    ),
    jsonb_build_object(
      'phase', 'Gap assessment',
      'status', 'ready',
      'output', 'Compare principles, framework, process and industry-pack readiness against recorded evidence'
    ),
    jsonb_build_object(
      'phase', 'Implementation roadmap',
      'status', 'ready',
      'output', 'Prioritize governance, criteria, embedded decision points, treatment tracking and integrations'
    ),
    jsonb_build_object(
      'phase', 'Configuration',
      'status', 'draft',
      'output', 'Review context and criteria drafts; no policy is auto-adopted'
    ),
    jsonb_build_object(
      'phase', 'Workflow deployment',
      'status', 'blocked',
      'output', 'Requires approved criteria, named owners and authority limits'
    ),
    jsonb_build_object(
      'phase', 'Monitoring',
      'status', 'blocked',
      'output', 'Bind approved live indicators and reassessment triggers'
    ),
    jsonb_build_object(
      'phase', 'Improvement',
      'status', 'blocked',
      'output', 'Verify outcomes, review framework effectiveness and transfer learning'
    )
  );

  insert into risk_context_nodes (
    organization_id,
    scope_kind,
    name,
    mission_or_service,
    objectives,
    stakeholders,
    regulations,
    dependencies,
    decision_authority,
    status,
    created_by,
    implementation_discovery,
    implementation_gap_assessment,
    implementation_roadmap
  )
  select
    v_org,
    'enterprise',
    o.name || ' enterprise risk context',
    array_to_string(
      array(
        select jsonb_array_elements_text(p_answers -> 'critical_services')
      ),
      '; '
    ),
    p_answers -> 'objectives',
    p_answers -> 'stakeholders',
    p_answers -> 'obligations',
    p_answers -> 'dependencies',
    jsonb_build_object(
      'risk_owner_role', p_answers ->> 'risk_owner_role',
      'acceptance_authority', p_answers ->> 'acceptance_authority',
      'escalation_thresholds', p_answers -> 'escalation_thresholds',
      'decision_points', p_answers -> 'decision_points',
      'treatment_tracking_systems', p_answers -> 'treatment_tracking_systems'
    ),
    'draft',
    auth.uid(),
    p_answers,
    v_gap_assessment,
    v_roadmap
  from organizations o
  where o.id = v_org
  returning id into v_context;

  insert into risk_criteria_profiles (
    organization_id,
    context_id,
    name,
    industry_code,
    status,
    consequence_dimensions,
    likelihood_scale,
    thresholds,
    scoring_weights,
    decision_thresholds,
    risk_capacity,
    aggregate_rules,
    time_factors,
    tolerance_statements,
    basis
  ) values (
    v_org,
    v_context,
    'ISO 31000 implementation draft — ' || v_industry_label,
    v_industry_code,
    'draft',
    p_answers -> 'consequence_dimensions',
    p_answers -> 'likelihood_scale',
    coalesce(p_answers -> 'thresholds', '{}'::jsonb),
    coalesce(p_answers -> 'scoring_weights', '{}'::jsonb),
    coalesce(p_answers -> 'decision_thresholds', '{}'::jsonb),
    coalesce(p_answers -> 'risk_capacity', '{}'::jsonb),
    coalesce(p_answers -> 'aggregate_rules', '{}'::jsonb),
    coalesce(p_answers -> 'time_factors', '{}'::jsonb),
    p_answers -> 'risk_tolerances',
    'Generated from implementation discovery for ' || v_industry_label ||
      '. Pack readiness: ' || v_pack_readiness ||
      '; content validation: ' || v_pack_validation ||
      '. DRAFT: customer governance, domain and legal review required before adoption.'
  )
  returning id into v_criteria;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'iso31000_implementation',
    v_role,
    jsonb_build_object(
      'context_id', v_context,
      'criteria_id', v_criteria,
      'status', 'draft',
      'industry_code', v_industry_code,
      'industry_label', v_industry_label,
      'industry_pack_readiness', v_pack_readiness,
      'industry_pack_validation', v_pack_validation
    )
  );

  return jsonb_build_object(
    'context_id', v_context,
    'criteria_id', v_criteria,
    'current_state', p_answers,
    'gap_assessment', v_gap_assessment,
    'roadmap', v_roadmap,
    'configuration_status', 'draft',
    'human_adoption_required', true
  );
end;
$function$;

revoke execute on function public.start_iso31000_implementation(jsonb) from public, anon;
grant execute on function public.start_iso31000_implementation(jsonb) to authenticated, service_role;

create or replace function public.get_iso31000_implementation_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_org uuid := app_current_org();
  v_state jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select jsonb_build_object(
    'context_id', context.id,
    'context_name', context.name,
    'status', context.status,
    'discovery', context.implementation_discovery,
    'gap_assessment', context.implementation_gap_assessment,
    'roadmap', context.implementation_roadmap,
    'created_at', context.created_at,
    'updated_at', context.updated_at
  )
  into v_state
  from risk_context_nodes context
  where context.organization_id = v_org
    and context.status <> 'superseded'
    and context.implementation_discovery <> '{}'::jsonb
  order by context.created_at desc
  limit 1;

  return v_state;
end;
$function$;

revoke execute on function public.get_iso31000_implementation_state() from public, anon;
grant execute on function public.get_iso31000_implementation_state() to authenticated, service_role;
