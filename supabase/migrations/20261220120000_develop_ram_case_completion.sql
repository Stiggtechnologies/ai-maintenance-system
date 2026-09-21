-- ============================================================================
-- D12.13 completion — case RAM across FMEA, RBD, Weibull, availability,
-- reliability growth and PM strategy.
--
-- No parallel noun is introduced. The case scope composes:
--   * development_case_assets — the population;
--   * asset_dependencies + common_cause_* — the declared RBD;
--   * component_life_events — Weibull failures and suspensions;
--   * asset_meter_readings + corrective work_orders — a governed observation
--     window, downtime and timestamped failure arrivals;
--   * asset_failure_mode_libraries — FMEA;
--   * asset_maintenance_strategy_recommendations — PM strategy.
--
-- The database supplies facts and refusals. The one shipped TypeScript kernel
-- performs the mathematics. No target, strategy, model or work is approved.
-- ============================================================================

create or replace function public.sync_ram_kernel_version()
returns text
language sql
immutable
set search_path = public
as $$
  select 'develop-ram/5E/2026-12-20'::text;
$$;

create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select v from (values
    ('case_scope_growth',              'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',       'develop-controls/4A/2026-11-24'),
    ('case_earned_value',              'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',         'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',        'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',          'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',       'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',   'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',   'develop-change/4D/2026-12-03'),
    ('case_change_control',            'develop-change/4D/2026-12-03'),
    ('case_decision_latency',          'develop-change/4D/2026-12-03'),
    ('case_decision_debt',             'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',          'develop-design/5B/2026-12-05'),
    ('case_ram_profile',               'develop-ram/5E/2026-12-20'),
    ('case_procurement_position',      'develop-procurement/6A/2026-12-08'),
    ('package_constraint_burndown',    'develop-awp/7A/2026-12-10'),
    ('package_field_readiness',        'develop-awp/7B/2026-12-11'),
    ('case_resource_balance',          'develop-workforce/7C/2026-12-12'),
    ('competency_readiness',           'develop-workforce/7C/2026-12-12'),
    ('constraint_free_work_index',     'develop-workforce/7C/2026-12-12'),
    ('workface_execution_metrics',     'develop-workforce/7C/2026-12-12')
  ) as versions(k, v) where k = p_key;
$$;

create or replace function public.get_case_ram_scope(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_assets jsonb := '[]'::jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_topology jsonb := '{}'::jsonb;
  v_fmea jsonb := '[]'::jsonb;
  v_strategies jsonb := '[]'::jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_asset_count int := 0;
  v_target_count int := 0;
  v_edge_count int := 0;
  v_row record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c
    from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*)::int into v_asset_count
    from development_case_assets d
   where d.development_case_id = c.id and d.organization_id = v_org;
  if v_asset_count = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'assets', '[]'::jsonb,
      'targets', '[]'::jsonb, 'topology', null, 'fmea', '[]'::jsonb,
      'pmStrategies', '[]'::jsonb,
      'refusals', jsonb_build_array(
        'No asset is bound to this case, so there is no population for FMEA, RBD, Weibull, availability, reliability growth or PM strategy.'),
      'refusal', 'No asset is bound to this case. §63 needs the delivered asset population before any RAM family has a boundary.');
  end if;

  -- One payload row per bound asset. The observation window exists only when
  -- two distinct governed operating-hour readings advance in both time and
  -- value. Corrective work orders are then restricted to that exact interval.
  select coalesce(jsonb_agg(jsonb_build_object(
      'assetId', q.asset_id,
      'assetTag', q.asset_tag,
      'name', q.asset_name,
      'criticality', q.criticality,
      'failureTimes', q.failure_times,
      'suspensionTimes', q.suspension_times,
      'failureCount', jsonb_array_length(q.failure_times),
      'suspensionCount', jsonb_array_length(q.suspension_times),
      'observationWindow', case
        when q.first_meter_id is null or q.last_meter_id is null
          or q.first_meter_id = q.last_meter_id
          or q.last_meter_at <= q.first_meter_at
          or q.last_meter_value <= q.first_meter_value
        then null
        else jsonb_build_object(
          'startAt', q.first_meter_at,
          'endAt', q.last_meter_at,
          'calendarHours', extract(epoch from (q.last_meter_at - q.first_meter_at)) / 3600.0,
          'operatingHoursDelta', q.last_meter_value - q.first_meter_value,
          'meterReadingIds', jsonb_build_array(q.first_meter_id, q.last_meter_id),
          'meterSources', jsonb_build_array(
            jsonb_build_object('id', q.first_meter_id, 'sourceSystem', q.first_source_system,
              'sourceRef', q.first_source_ref, 'basis', q.first_basis),
            jsonb_build_object('id', q.last_meter_id, 'sourceSystem', q.last_source_system,
              'sourceRef', q.last_source_ref, 'basis', q.last_basis)),
          'downtimeHours', q.downtime_hours,
          'failureEventHours', q.failure_event_hours,
          'workOrderIds', q.work_order_ids,
          'basis', 'Two governed operating-hour readings bound the calendar observation window; corrective work-order downtime and completion timestamps inside that exact window supply the availability and Crow-AMSAA inputs.')
        end)
      order by q.asset_tag), '[]'::jsonb)
    into v_assets
    from (
      select a.id asset_id, coalesce(a.asset_tag, a.tag, a.id::text) asset_tag,
        a.name asset_name, a.criticality,
        coalesce(life.failure_times, '[]'::jsonb) failure_times,
        coalesce(life.suspension_times, '[]'::jsonb) suspension_times,
        fm.id first_meter_id, fm.recorded_at first_meter_at,
        fm.value first_meter_value, fm.source_system first_source_system,
        fm.source_ref first_source_ref, fm.basis first_basis,
        lm.id last_meter_id, lm.recorded_at last_meter_at,
        lm.value last_meter_value, lm.source_system last_source_system,
        lm.source_ref last_source_ref, lm.basis last_basis,
        coalesce(wo.downtime_hours, '[]'::jsonb) downtime_hours,
        coalesce(wo.failure_event_hours, '[]'::jsonb) failure_event_hours,
        coalesce(wo.work_order_ids, '[]'::jsonb) work_order_ids
      from development_case_assets d
      join assets a on a.id = d.asset_id and a.organization_id = v_org
      left join lateral (
        select
          coalesce(jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
            filter (where e.event_kind = 'failure'), '[]'::jsonb) failure_times,
          coalesce(jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
            filter (where e.event_kind <> 'failure'), '[]'::jsonb) suspension_times
        from component_life_events e
        where e.asset_id = a.id and e.organization_id = v_org
          and e.hours_at_change_out > 0
      ) life on true
      left join lateral (
        select m.id, m.recorded_at, m.value, m.source_system, m.source_ref, m.basis
          from asset_meter_readings m
         where m.organization_id = v_org and m.asset_id = a.id
           and m.meter_kind = 'operating_hours'
         order by m.recorded_at, m.id limit 1
      ) fm on true
      left join lateral (
        select m.id, m.recorded_at, m.value, m.source_system, m.source_ref, m.basis
          from asset_meter_readings m
         where m.organization_id = v_org and m.asset_id = a.id
           and m.meter_kind = 'operating_hours'
         order by m.recorded_at desc, m.id desc limit 1
      ) lm on true
      left join lateral (
        select
          coalesce(jsonb_agg(w.downtime_hours order by w.completed_at, w.id), '[]'::jsonb) downtime_hours,
          coalesce(jsonb_agg(extract(epoch from (w.completed_at - fm.recorded_at)) / 3600.0
            order by w.completed_at, w.id), '[]'::jsonb) failure_event_hours,
          coalesce(jsonb_agg(w.id order by w.completed_at, w.id), '[]'::jsonb) work_order_ids
          from work_orders w
         where w.organization_id = v_org and w.asset_id = a.id
           and lower(coalesce(w.work_type, '')) = 'corrective'
           and w.completed_at > fm.recorded_at and w.completed_at <= lm.recorded_at
           and w.downtime_hours is not null and w.downtime_hours >= 0
      ) wo on fm.id is not null and lm.id is not null
     where d.development_case_id = c.id and d.organization_id = v_org
    ) q;

  -- Availability targets remain one independent leg. Their absence no longer
  -- suppresses FMEA/RBD/growth/strategy for an otherwise valid case.
  if c.capital_project_id is null then
    v_refusals := v_refusals || to_jsonb(
      'This case references no capital project, so no recorded availability target or allocation can be read. The other RAM families remain in scope.'::text);
  else
    select count(*)::int into v_target_count
      from ram_targets t
     where t.project_id = c.capital_project_id and t.organization_id = v_org;
    select coalesce(jsonb_agg(jsonb_build_object(
      'targetId', t.id, 'systemLabel', t.system_label,
      'targetAvailability', t.target_availability, 'configuration', t.configuration,
      'basis', t.target_basis, 'allocations', coalesce(al.rows, '[]'::jsonb),
      'allocationCount', coalesce(jsonb_array_length(al.rows), 0))
      order by t.system_label), '[]'::jsonb)
      into v_targets
      from ram_targets t
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'label', r.subsystem_label, 'demonstrated', r.demonstrated_availability,
          'recordedAllocation', r.allocated_availability, 'evidence', r.evidence,
          'complexityWeight', r.complexity_weight) order by r.subsystem_label) rows
          from ram_allocations r where r.target_id = t.id
      ) al on true
     where t.project_id = c.capital_project_id and t.organization_id = v_org;
    if v_target_count = 0 then
      v_refusals := v_refusals || to_jsonb(
        'The capital project carries no ram_targets row. No availability target is invented; the other RAM families remain in scope.'::text);
    end if;
  end if;

  for v_row in
    select value ->> 'systemLabel' label
      from jsonb_array_elements(v_targets)
     where (value ->> 'allocationCount')::int = 0
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'Target "%s" has no subsystem allocation recorded, so there is nothing to allocate it across.', v_row.label));
  end loop;
  for v_row in
    select value ->> 'systemLabel' label
      from jsonb_array_elements(v_targets)
     where value ->> 'configuration' = 'mixed'
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'Target "%s" is MIXED. The allocation kernel models series and parallel only; no share is allocated until its structure is declared.', v_row.label));
  end loop;
  for v_row in
    select value ->> 'assetTag' tag, (value ->> 'failureCount')::int fc,
      value -> 'observationWindow' observation_window
      from jsonb_array_elements(v_assets)
  loop
    if v_row.fc < 2 then
      v_refusals := v_refusals || to_jsonb(format(
        'Asset %s has %s failure record(s) in the component-life store. Two distinct failures are the minimum for a Weibull estimator.',
        v_row.tag, v_row.fc));
    end if;
    if v_row.observation_window is null or v_row.observation_window = 'null'::jsonb then
      v_refusals := v_refusals || to_jsonb(format(
        'Asset %s has no valid observation window bounded by two advancing governed operating-hour readings. Availability and reliability growth are refused.', v_row.tag));
    elsif jsonb_array_length(coalesce(v_row.observation_window -> 'failureEventHours', '[]'::jsonb)) < 3 then
      v_refusals := v_refusals || to_jsonb(format(
        'Asset %s has fewer than three timestamped corrective failures inside its meter-bounded window, so Crow-AMSAA reliability growth is not fitted.', v_row.tag));
    end if;
  end loop;

  -- The declared case dependency graph: both endpoints must be bound to the
  -- same case. Edges are never silently filtered for governance quality; the
  -- client receives every edge and the server names every unconfirmed one.
  select count(*)::int into v_edge_count
    from asset_dependencies ad
    join development_case_assets dd on dd.asset_id = ad.dependent_asset_id
      and dd.development_case_id = c.id and dd.organization_id = v_org
    join development_case_assets ds on ds.asset_id = ad.supplier_asset_id
      and ds.development_case_id = c.id and ds.organization_id = v_org
   where ad.organization_id = v_org;

  select jsonb_build_object(
    'edges', coalesce((select jsonb_agg(jsonb_build_object(
      'edgeId', ad.id, 'dependentAssetId', ad.dependent_asset_id,
      'supplierAssetId', ad.supplier_asset_id,
      'dependencyKind', ad.dependency_kind,
      'redundancyGroup', ad.redundancy_group,
      'minRequired', ad.min_suppliers_required,
      'evidence', ad.evidence, 'source', ad.source,
      'confirmedAt', ad.confirmed_at, 'confirmedBy', ad.confirmed_by,
      'commonCauseGroups', coalesce((select jsonb_agg(g.name order by g.name)
        from common_cause_members cm
        join common_cause_groups g on g.id = cm.group_id and g.organization_id = v_org
       where cm.organization_id = v_org and cm.asset_id = ad.supplier_asset_id), '[]'::jsonb))
      order by ad.id)
      from asset_dependencies ad
      join development_case_assets dd on dd.asset_id = ad.dependent_asset_id
        and dd.development_case_id = c.id and dd.organization_id = v_org
      join development_case_assets ds on ds.asset_id = ad.supplier_asset_id
        and ds.development_case_id = c.id and ds.organization_id = v_org
     where ad.organization_id = v_org), '[]'::jsonb),
    'commonCauseGroups', coalesce((select jsonb_agg(jsonb_build_object(
      'groupId', g.id, 'name', g.name, 'causeKind', g.cause_kind,
      'memberAssetIds', (select jsonb_agg(cm.asset_id order by cm.asset_id)
        from common_cause_members cm
        join development_case_assets dm on dm.asset_id = cm.asset_id
          and dm.development_case_id = c.id and dm.organization_id = v_org
       where cm.group_id = g.id and cm.organization_id = v_org),
      'betaFactor', null) order by g.name)
      from common_cause_groups g
     where g.organization_id = v_org and exists (
       select 1 from common_cause_members cm
       join development_case_assets dm on dm.asset_id = cm.asset_id
         and dm.development_case_id = c.id and dm.organization_id = v_org
      where cm.group_id = g.id and cm.organization_id = v_org)), '[]'::jsonb),
    'note', 'This is the declared case dependency graph only. SyncAI does not infer that unrecorded edges do not exist, and a human must accept topology completeness and common-cause assumptions.')
    into v_topology;

  if v_edge_count = 0 then
    v_refusals := v_refusals || to_jsonb(
      'No RBD is evaluated because the declared case dependency graph has no edge whose dependent and supplier are both bound to this case. An empty graph is not a reliable system.'::text);
  end if;
  for v_row in
    select value ->> 'edgeId' edge_id
      from jsonb_array_elements(v_topology -> 'edges')
     where nullif(btrim(value ->> 'evidence'), '') is null
        or value ->> 'confirmedAt' is null
        or value ->> 'confirmedBy' is null
        or value ->> 'source' = 'demo'
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'RBD edge %s lacks non-demo evidence or named human confirmation. The whole declared topology is refused rather than evaluating a convenient subset.', v_row.edge_id));
  end loop;

  -- Existing FMEA rows, resolved to canonical case assets. Historic rows may
  -- carry UUID, tag or asset_tag in the legacy text field; canonical_asset_id
  -- wins whenever it is present.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'assetId', a.id, 'assetTag', coalesce(a.asset_tag, a.tag, a.id::text),
    'failureMode', f.failure_mode, 'failureMechanism', f.failure_mechanism,
    'cause', f.cause, 'effect', f.effect, 'detectionMethod', f.detection_method,
    'consequence', f.consequence, 'currentControls', f.current_controls,
    'recommendedControls', f.recommended_controls, 'source', f.source)
    order by coalesce(a.asset_tag, a.tag, a.id::text), f.failure_mode, f.id), '[]'::jsonb)
    into v_fmea
    from development_case_assets d
    join assets a on a.id = d.asset_id and a.organization_id = v_org
    join asset_failure_mode_libraries f on f.organization_id = v_org and (
      f.canonical_asset_id = a.id or
      (f.canonical_asset_id is null and f.asset_id in (a.id::text, a.tag, a.asset_tag)))
   where d.development_case_id = c.id and d.organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'assetId', a.id, 'assetTag', coalesce(a.asset_tag, a.tag, a.id::text),
    'recommendation', s.recommendation,
    'failureModeAddressed', s.failure_mode_addressed,
    'riskReduced', s.risk_reduced, 'evidenceUsed', s.evidence_used,
    'assumptions', s.assumptions, 'confidence', s.confidence,
    'requiredApproval', s.required_approval,
    'implementationWorkOrder', s.implementation_work_order,
    'status', s.status)
    order by coalesce(a.asset_tag, a.tag, a.id::text), s.created_at, s.id), '[]'::jsonb)
    into v_strategies
    from development_case_assets d
    join assets a on a.id = d.asset_id and a.organization_id = v_org
    join asset_maintenance_strategy_recommendations s
      on s.organization_id = v_org
     and s.asset_id in (a.id::text, a.tag, a.asset_tag)
   where d.development_case_id = c.id and d.organization_id = v_org;

  if jsonb_array_length(v_fmea) = 0 then
    v_refusals := v_refusals || to_jsonb(
      'No existing FMEA row resolves to a canonical asset bound to this case. Absence is shown, not filled with a generic failure mode.'::text);
  end if;
  if jsonb_array_length(v_strategies) = 0 then
    v_refusals := v_refusals || to_jsonb(
      'No existing PM-strategy recommendation resolves to an asset bound to this case. The agent does not invent or approve one.'::text);
  end if;

  return jsonb_build_object(
    'caseId', c.id, 'projectId', c.capital_project_id, 'refused', false,
    'assetCount', v_asset_count, 'targetCount', v_target_count,
    'assets', v_assets, 'targets', v_targets,
    'topology', v_topology, 'fmea', v_fmea, 'pmStrategies', v_strategies,
    'refusals', v_refusals, 'kernelVersion', sync_ram_kernel_version(),
    'note', 'These are case-scoped inputs and governed source rows, not an approval. Mathematics runs in the pinned shared kernel; a competent human accepts topology, targets and strategy.');
end
$$;

revoke all on function public.get_case_ram_scope(uuid) from public, anon;
grant execute on function public.get_case_ram_scope(uuid) to authenticated, service_role;

-- Re-declared because D11.29 requires the lineage method and inputs to name
-- every output family. It also closes the caller-declaration hole for the new
-- identities: the report must cover exactly the assets, targets, eligible RBD
-- edges, FMEA rows and PM-strategy rows the server just re-read.
create or replace function public.record_ram_agent_report(
  p_case_id uuid,
  p_kernel_version text,
  p_profile jsonb default '{}'::jsonb,
  p_refusals jsonb default '[]'::jsonb,
  p_narrative text default null,
  p_model text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_scope jsonb;
  v_scope_refused boolean;
  v_scope_rbd_eligible boolean := false;
  v_refusals jsonb := '[]'::jsonb;
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_run uuid;
  v_id bigint;
  v_input_refs jsonb := '[]'::jsonb;
  v_scope_targets text[];
  v_scope_assets text[];
  v_scope_edges text[];
  v_scope_fmea text[];
  v_scope_strategies text[];
  v_claim_targets text[];
  v_claim_assets text[];
  v_claim_edges text[];
  v_claim_fmea text[];
  v_claim_strategies text[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
    from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician','ai_admin') then
    return jsonb_build_object('error',
      'recording a RAM reading requires a role on this project');
  end if;
  select * into c
    from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if coalesce(btrim(p_kernel_version), '') <> sync_ram_kernel_version() then
    return jsonb_build_object('error', format(
      'this report declares RAM kernel "%s" and the server pins "%s"; the run is refused rather than recorded under an unreproducible version',
      coalesce(nullif(btrim(coalesce(p_kernel_version, '')), ''), '(none)'),
      sync_ram_kernel_version()));
  end if;
  if p_narrative is not null and length(p_narrative) > 6000 then
    return jsonb_build_object('error',
      'the narrative is longer than 6000 characters and is refused rather than truncated');
  end if;
  if p_model is not null and length(btrim(p_model)) > 200 then
    return jsonb_build_object('error',
      'the model identifier is longer than 200 characters');
  end if;
  if jsonb_typeof(v_profile) <> 'object' then
    return jsonb_build_object('error', 'the RAM profile must be a JSON object');
  end if;
  if jsonb_typeof(coalesce(p_refusals, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('error', 'RAM refusals must be a JSON array');
  end if;

  v_scope := get_case_ram_scope(c.id);
  if v_scope ? 'error' then
    return jsonb_build_object('error', v_scope ->> 'error');
  end if;
  v_scope_refused := coalesce((v_scope ->> 'refused')::boolean, true);
  v_refusals := coalesce(v_scope -> 'refusals', '[]'::jsonb) ||
    coalesce(p_refusals, '[]'::jsonb);
  if v_scope_refused then
    v_profile := '{}'::jsonb;
  end if;

  if not v_scope_refused then
    select coalesce(array_agg(distinct value ->> 'targetId'
      order by value ->> 'targetId'), '{}'::text[]) into v_scope_targets
      from jsonb_array_elements(coalesce(v_scope -> 'targets', '[]'::jsonb));
    select coalesce(array_agg(distinct value ->> 'assetId'
      order by value ->> 'assetId'), '{}'::text[]) into v_scope_assets
      from jsonb_array_elements(coalesce(v_scope -> 'assets', '[]'::jsonb));
    select coalesce(array_agg(distinct value ->> 'edgeId'
      order by value ->> 'edgeId'), '{}'::text[]) into v_scope_edges
      from jsonb_array_elements(coalesce(v_scope -> 'topology' -> 'edges', '[]'::jsonb));
    select coalesce(array_agg(distinct value ->> 'id'
      order by value ->> 'id'), '{}'::text[]) into v_scope_fmea
      from jsonb_array_elements(coalesce(v_scope -> 'fmea', '[]'::jsonb));
    select coalesce(array_agg(distinct value ->> 'id'
      order by value ->> 'id'), '{}'::text[]) into v_scope_strategies
      from jsonb_array_elements(coalesce(v_scope -> 'pmStrategies', '[]'::jsonb));

    select count(*) > 0 and bool_and(
      nullif(btrim(value ->> 'evidence'), '') is not null
      and value ->> 'confirmedAt' is not null
      and value ->> 'confirmedBy' is not null
      and value ->> 'source' <> 'demo')
      into v_scope_rbd_eligible
      from jsonb_array_elements(coalesce(v_scope -> 'topology' -> 'edges', '[]'::jsonb));

    if v_profile <> '{}'::jsonb then
      if jsonb_typeof(v_profile -> 'targets') <> 'array'
         or jsonb_typeof(v_profile -> 'assets') <> 'array'
         or jsonb_typeof(v_profile -> 'fmea') <> 'array'
         or jsonb_typeof(v_profile -> 'pmStrategies') <> 'array' then
        return jsonb_build_object('error',
          'the profile does not match the server scope: targets, assets, FMEA and PM strategy must be arrays');
      end if;
      select coalesce(array_agg(distinct value ->> 'targetId'
        order by value ->> 'targetId'), '{}'::text[]) into v_claim_targets
        from jsonb_array_elements(v_profile -> 'targets');
      select coalesce(array_agg(distinct value ->> 'assetId'
        order by value ->> 'assetId'), '{}'::text[]) into v_claim_assets
        from jsonb_array_elements(v_profile -> 'assets');
      select coalesce(array_agg(distinct value ->> 'id'
        order by value ->> 'id'), '{}'::text[]) into v_claim_fmea
        from jsonb_array_elements(v_profile -> 'fmea');
      select coalesce(array_agg(distinct value ->> 'id'
        order by value ->> 'id'), '{}'::text[]) into v_claim_strategies
        from jsonb_array_elements(v_profile -> 'pmStrategies');
      select coalesce(array_agg(distinct value order by value), '{}'::text[])
        into v_claim_edges
        from jsonb_array_elements_text(case
          when jsonb_typeof(v_profile -> 'rbd' -> 'edgeIds') = 'array'
          then v_profile -> 'rbd' -> 'edgeIds' else '[]'::jsonb end);

      if v_claim_targets is distinct from v_scope_targets
         or jsonb_array_length(v_profile -> 'targets') <> cardinality(v_claim_targets) then
        return jsonb_build_object('error',
          'the profile target set does not match the server scope');
      end if;
      if v_claim_assets is distinct from v_scope_assets
         or jsonb_array_length(v_profile -> 'assets') <> cardinality(v_claim_assets) then
        return jsonb_build_object('error',
          'the profile asset set does not match the server scope');
      end if;
      if v_claim_fmea is distinct from v_scope_fmea
         or jsonb_array_length(v_profile -> 'fmea') <> cardinality(v_claim_fmea) then
        return jsonb_build_object('error',
          'the profile FMEA set does not match the server scope');
      end if;
      if v_claim_strategies is distinct from v_scope_strategies
         or jsonb_array_length(v_profile -> 'pmStrategies') <> cardinality(v_claim_strategies) then
        return jsonb_build_object('error',
          'the profile PM-strategy set does not match the server scope');
      end if;
      if v_scope_rbd_eligible then
        if jsonb_typeof(v_profile -> 'rbd') <> 'object'
           or v_claim_edges is distinct from v_scope_edges
           or jsonb_array_length(v_profile -> 'rbd' -> 'edgeIds') <> cardinality(v_claim_edges) then
          return jsonb_build_object('error',
            'the profile RBD edge set does not match the server scope');
        end if;
      elsif v_profile -> 'rbd' <> 'null'::jsonb then
        return jsonb_build_object('error',
          'the profile contains an RBD although the server scope says the declared topology is absent or ungoverned');
      end if;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('table', 'assets', 'id', value ->> 'assetId')), '[]'::jsonb)
    into v_input_refs from jsonb_array_elements(coalesce(v_scope -> 'assets', '[]'::jsonb));
  select v_input_refs || coalesce(jsonb_agg(jsonb_build_object('table', 'asset_dependencies', 'id', value ->> 'edgeId')), '[]'::jsonb)
    into v_input_refs from jsonb_array_elements(coalesce(v_scope -> 'topology' -> 'edges', '[]'::jsonb));
  select v_input_refs || coalesce(jsonb_agg(jsonb_build_object('table', 'asset_failure_mode_libraries', 'id', value ->> 'id')), '[]'::jsonb)
    into v_input_refs from jsonb_array_elements(coalesce(v_scope -> 'fmea', '[]'::jsonb));
  select v_input_refs || coalesce(jsonb_agg(jsonb_build_object('table', 'asset_maintenance_strategy_recommendations', 'id', value ->> 'id')), '[]'::jsonb)
    into v_input_refs from jsonb_array_elements(coalesce(v_scope -> 'pmStrategies', '[]'::jsonb));

  v_run := record_calculation_run(
    c.id,
    'case_ram_profile',
    'Pinned shared TypeScript RAM kernel: allocateAvailability; selectWeibullMethod to weibullMLE/weibullMRR; repairableSummary and crowAMSAA inside meter-bounded observation windows; evaluateRbd and blockImportance over the confirmed canonical asset_dependencies graph. FMEA and PM strategy rows are retrieved context, not computed or approved.',
    jsonb_build_object(
      'assetCount', v_scope -> 'assetCount',
      'targetCount', v_scope -> 'targetCount',
      'rbdEdgeCount', coalesce(jsonb_array_length(v_scope -> 'topology' -> 'edges'), 0),
      'fmeaCount', coalesce(jsonb_array_length(v_scope -> 'fmea'), 0),
      'pmStrategyCount', coalesce(jsonb_array_length(v_scope -> 'pmStrategies'), 0),
      'kernelVersion', sync_ram_kernel_version(), 'model', p_model),
    v_input_refs,
    case when v_scope_refused then null else v_profile end,
    v_refusals);

  perform set_config('app.ram_agent_report_write', 'granted', true);
  insert into ram_agent_reports
    (organization_id, development_case_id, scope, profile, kernel_version,
     refused, refusals, narrative, model, calculation_run_id, requested_by)
  values
    (v_org, c.id, v_scope, v_profile, sync_ram_kernel_version(),
     v_scope_refused, v_refusals,
     nullif(btrim(coalesce(p_narrative, '')), ''),
     nullif(btrim(coalesce(p_model, '')), ''),
     v_run, auth.uid())
  returning id into v_id;
  perform set_config('app.ram_agent_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'ram_agent_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'report_id', v_id, 'run_id', v_run,
      'kernel_version', sync_ram_kernel_version(), 'model', p_model),
    null,
    jsonb_build_object('refused', v_scope_refused,
      'refusalCount', jsonb_array_length(v_refusals),
      'assetCount', v_scope -> 'assetCount', 'targetCount', v_scope -> 'targetCount',
      'advisory', true));

  return jsonb_build_object(
    'report_id', v_id, 'run_id', v_run, 'refused', v_scope_refused,
    'refusalCount', jsonb_array_length(v_refusals), 'refusals', v_refusals,
    'kernelVersion', sync_ram_kernel_version(), 'advisory', true,
    'note', case when v_scope_refused
      then 'Recorded as a refusal with lineage; no output was certified.'
      else 'Recorded as an advisory reading. A competent human retains target, topology, strategy, approval and work authority.' end);
end
$$;

revoke all on function public.record_ram_agent_report(uuid, text, jsonb, jsonb, text, text)
  from public, anon;
grant execute on function public.record_ram_agent_report(uuid, text, jsonb, jsonb, text, text)
  to authenticated, service_role;
