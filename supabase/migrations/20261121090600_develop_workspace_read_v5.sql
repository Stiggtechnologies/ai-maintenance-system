-- ============================================================================
-- Sync Develop Slice 3B — the Case Workspace read, v5, and the governance
-- read extended (D3.18 / D3.07 / D3.19 / D3.34 rendering — enforced truth
-- and displayed truth from one query, the #282 principle).
--
-- get_development_case is RE-CREATED from its LATEST definition (the
-- 20261115090700 v4) with five ADDED keys; every pre-existing key is
-- byte-identical (assembled by exact string patching at authoring time):
--
--   * gates[].fundingQuestionRequired — the D3.07 sanction-type-gate ruling
--     (20261121090200), computed from the ONE stage vocabulary so the panel
--     shows the hard-block exactly where the RPC enforces it;
--   * gates[].latestReview.fundingContinuationAnswer — the recorded answer;
--   * gates[].criteria[].activeWaiver — the approved, unexpired waiver
--     currently standing in for the requirement (null when none: absence
--     rendered, never hidden);
--   * gates[].latestReview.conditions[] closure/breach fields — breachedAt,
--     closedAt/By, closureEvidenceId/Note (D3.18's lifecycle);
--   * waivers[] — the case's gate-requirement waivers with their full
--     request/decision/expiry record (D3.19).
--
-- get_case_governance is RE-CREATED from its 20261120090200 definition with
-- ONE added key (adoptedRuleSet.compositeRules) so the panel renders the
-- composite demands beside the tailoring rules they ride with.
-- ============================================================================

create or replace function public.get_development_case(p_case_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'status', c.status,
    'lifecycleType', c.lifecycle_type,
    'problemStatement', c.problem_statement,
    'opportunityStatement', c.opportunity_statement,
    'businessUnit', c.business_unit,
    'estimatedCapex', c.estimated_capex,
    'expectedValue', c.expected_value,
    'currentStageKey', c.current_stage_key,
    'createdAt', c.created_at,
    'sponsor', (select coalesce(p.full_name, p.email) from user_profiles p
                 where p.id = c.sponsor_id),
    'sanction', case when c.sanctioned_at is null then null else jsonb_build_object(
      'sanctionedAt', c.sanctioned_at,
      'sanctionedValue', c.sanctioned_value,
      'note', c.sanction_note,
      'by', (select coalesce(p.full_name, p.email) from user_profiles p
              where p.id = c.sanctioned_by)) end,
    'framework', case when c.framework_id is null then null else (
      select jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version,
        'source', f.source, 'sourceAuthority', f.source_authority, 'status', f.status)
      from project_frameworks f where f.id = c.framework_id) end,
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stageKey', s.stage_key,
        'displayName', s.display_name,
        'sequence', s.sequence,
        'purpose', s.purpose,
        'isCurrent', s.stage_key = c.current_stage_key,
        'gates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'sequence', g.sequence,
            'decisionType', g.decision_type,
            'independentAssuranceRequired', g.independent_assurance_required,
            'readinessThreshold', g.readiness_threshold,
            'fundingQuestionRequired', (g.decision_type = 'gate' and exists (
              select 1 from lifecycle_stages sanc, lifecycle_stages here
              where sanc.stage_key = 'sanction' and here.stage_key = g.stage_key
                and here.stage_order >= sanc.stage_order)),
            'criteria', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sc.id, 'criterion', sc.criterion,
                'isMandatory', sc.is_mandatory, 'guidance', sc.guidance,
                'category', sc.category, 'evidenceType', sc.evidence_type,
                'minimumConfidence', sc.minimum_confidence,
                'weight', sc.weight,
                'sourceAuthority', sc.source_authority,
                'activeWaiver', (
                  select jsonb_build_object('id', w.id, 'status', w.status,
                    'expiresAt', w.expires_at, 'justification', w.justification)
                  from standard_site_variances w
                  where w.subject_type = 'gate_requirement'
                    and w.development_case_id = c.id and w.requirement_id = sc.id
                    and w.status = 'approved' and w.expires_at > now()
                  order by w.expires_at desc limit 1))
                order by sc.sort_order, sc.criterion)
              from stage_gate_criteria sc where sc.gate_id = g.id
            ), '[]'::jsonb),
            'latestReview', (
              select jsonb_build_object(
                'id', r.id, 'outcome', r.outcome, 'reviewedAt', r.reviewed_at,
                'note', r.note,
                'fundingContinuationAnswer', r.funding_continuation_answer,
                'findings', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'criterion', fi.criterion_text, 'status', fi.status,
                    'evidence', fi.evidence)
                    order by fi.id)
                  from stage_gate_findings fi where fi.review_id = r.id
                ), '[]'::jsonb),
                'conditions', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', gc.id, 'description', gc.description,
                    'dueDate', gc.due_date, 'status', gc.status,
                    'evidenceRequirement', gc.evidence_requirement,
                    'consequenceIfMissed', gc.consequence_if_missed,
                    'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                               where p.id = gc.owner_id),
                    'breachedAt', gc.breached_at,
                    'closedAt', gc.closed_at,
                    'closedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                                  where p.id = gc.closed_by),
                    'closureEvidenceId', gc.closure_evidence_id,
                    'closureNote', gc.closure_note)
                    order by gc.due_date)
                  from gate_conditions gc where gc.review_id = r.id
                ), '[]'::jsonb))
              from stage_gate_reviews r
              where r.development_case_id = c.id and r.gate_id = g.id
              -- The same ordering the gate blockers enforce against: the
              -- row shown IS the row that decides (latest-review semantics).
              order by r.reviewed_at desc, r.id desc limit 1))
            order by g.sequence, g.name)
          from stage_gates g
          where g.framework_id = c.framework_id and g.stage_key = s.stage_key
        ), '[]'::jsonb))
        order by s.sequence)
      from project_framework_stages s
      where s.framework_id = c.framework_id
    ), '[]'::jsonb),
    'waivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'requirementId', w.requirement_id,
        'criterion', (select sc.criterion from stage_gate_criteria sc where sc.id = w.requirement_id),
        'status', w.status,
        'justification', w.justification,
        'compensatingControls', w.compensating_controls,
        'riskId', w.risk_id,
        'riskTitle', (select r.title from risks r where r.id = w.risk_id),
        'requestedAt', w.requested_at,
        'requestedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                         where p.id = w.requested_by),
        'decidedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                       where p.id = w.decided_by),
        'decisionNote', w.decision_note,
        'expiresAt', w.expires_at)
        order by w.requested_at desc)
      from standard_site_variances w
      where w.subject_type = 'gate_requirement' and w.development_case_id = c.id
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'type', d.type,
        'status', d.status,
        'revision', d.revision,
        'requiredDate', d.required_date,
        'sourceSystem', d.source_system,
        'requirementId', d.requirement_id,
        'requirement', case when d.requirement_id is null then null else (
          select jsonb_build_object('criterion', sc.criterion, 'gateId', sc.gate_id,
            'isMandatory', sc.is_mandatory)
          from stage_gate_criteria sc where sc.id = d.requirement_id) end,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = d.owner_id),
        'ownerId', d.owner_id,
        'document', case when d.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title,
            'documentClass', k.document_class, 'chunkCount', k.chunk_count)
          from kb_intake_documents k where k.id = d.document_id) end,
        'acceptance', case when d.accepted_at is null then null else jsonb_build_object(
          'acceptedAt', d.accepted_at,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = d.accepted_by)) end,
        'reviewNote', d.review_note)
        order by d.created_at desc)
      from develop_deliverables d
      where d.development_case_id = c.id and d.organization_id = c.organization_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'evidenceClass', e.evidence_class,
        'description', e.description,
        'sourceSystem', e.source_system,
        'sourceReference', e.source_reference,
        'dataQuality', e.data_quality,
        'revision', e.revision,
        'applicability', e.applicability,
        'observedAt', e.ts,
        'verificationStatus', e.verification_status,
        'verification', case when e.verified_at is null then null else jsonb_build_object(
          'verifiedAt', e.verified_at,
          'method', e.verification_method,
          'note', e.verification_note,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = e.verified_by)) end,
        'document', case when e.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title)
          from kb_intake_documents k where k.id = e.document_id) end)
        order by e.ts desc, e.created_at desc)
      from evidence_items e
      where e.development_case_id = c.id and e.organization_id = c.organization_id
    ), '[]'::jsonb),
    'risks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'status', r.status,
        'currentRiskLevel', r.current_risk_level,
        'residualRiskLevel', r.residual_risk_level,
        'decisionAction', r.decision_action,
        'reviewDate', r.review_date,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = r.risk_owner_id))
        order by case coalesce(r.current_risk_level, '')
                   when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2
                   when 'Low' then 3 when 'Very Low' then 4 else 5 end,
                 r.title)
      from risks r
      where r.development_case_id = c.id and r.organization_id = c.organization_id
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dc.id,
        'question', dc.decision_question,
        'requiredDate', dc.decision_required_date,
        'approvalLevel', dc.approval_level,
        'createdAt', dc.created_at,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = dc.owner_id),
        'objective', case when dc.objective_id is null then null else (
          select o.description from risk_objectives o where o.id = dc.objective_id) end,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', sc2.id, 'key', sc2.key, 'label', sc2.label,
            'description', sc2.description,
            'capex', sc2.capex, 'opex', sc2.opex,
            'lifecycleCost', sc2.lifecycle_cost,
            'scheduleEffect', sc2.schedule_effect,
            'riskEffect', sc2.risk_effect,
            'reliabilityEffect', sc2.reliability_effect,
            'environmentalEffect', sc2.environmental_effect,
            'expectedValue', sc2.expected_value,
            'isSelected', sc2.id = dc.selected_option_id)
            order by sc2.sequence_no nulls last, sc2.created_at)
          from scenarios sc2 where sc2.decision_id = dc.id
        ), '[]'::jsonb),
        'selection', case when dc.selected_at is null then null else jsonb_build_object(
          'optionId', dc.selected_option_id,
          'selectedAt', dc.selected_at,
          'rationale', dc.selection_rationale,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = dc.selected_by)) end,
        'evidenceItemIds', dc.evidence_item_ids,
        'assumptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'statement', a.statement, 'status', a.status,
            'confidence', a.confidence))
          from risk_assumption_dependencies ad
          join risk_assumptions a on a.id = ad.assumption_id
          where ad.subject_type = 'decision' and ad.subject_id = dc.id
            and ad.organization_id = c.organization_id
        ), '[]'::jsonb))
        order by dc.created_at desc)
      from decisions dc
      where dc.development_case_id = c.id and dc.organization_id = c.organization_id
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rec.id,
        'title', rec.title,
        'action', rec.action,
        'status', rec.status,
        'urgency', rec.urgency,
        'binding', case when rec.development_case_id = c.id then 'direct' else 'via_risk' end,
        'riskTitle', case when rec.development_case_id = c.id then null else (
          select r2.title from risks r2 where r2.id = rec.risk_id) end,
        'createdAt', rec.created_at,
        'verification', (
          select jsonb_build_object(
            'status', vo.status, 'dueDate', vo.due_date,
            'dueDateAssumed', vo.due_date_assumed, 'result', vo.result)
          from verification_obligations vo
          where vo.recommendation_id = rec.id))
        order by rec.created_at desc)
      from recommendations rec
      where rec.organization_id = c.organization_id
        and (rec.development_case_id = c.id
             or rec.risk_id in (select r3.id from risks r3
                                where r3.development_case_id = c.id
                                  and r3.organization_id = c.organization_id))
    ), '[]'::jsonb),
    'objective', case when c.objective_id is null then null else (
      with recursive chain as (
        select o.*, 0 as depth from risk_objectives o where o.id = c.objective_id
        union all
        select p.*, chain.depth + 1 from risk_objectives p
        join chain on p.id = chain.parent_id
        where chain.depth < 50
      )
      select jsonb_build_object(
        'id', (select id from chain where depth = 0),
        'description', (select description from chain where depth = 0),
        'level', (select objective_level from chain where depth = 0),
        'target', (select target from chain where depth = 0),
        'targetValue', (select target_value from chain where depth = 0),
        'unit', (select unit from chain where depth = 0),
        'targetDate', (select target_date from chain where depth = 0),
        'tolerance', (select tolerance from chain where depth = 0),
        'status', (select status from chain where depth = 0),
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = (select owner_id from chain where depth = 0)),
        'ancestors', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ch.id, 'description', ch.description, 'level', ch.objective_level)
            order by ch.depth desc)
          from chain ch where ch.depth > 0), '[]'::jsonb),
        'linkedRisks', (select count(*) from risks r
                        where r.objective_id = c.objective_id
                          and r.organization_id = c.organization_id))
    ) end,
    'successContract', (
      select jsonb_build_object(
        'id', sc.id,
        'version', sc.version,
        'status', sc.status,
        'recordedAt', sc.recorded_at,
        'recordNote', sc.record_note,
        'recordedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                        where p.id = sc.recorded_by),
        'dimensionsTotal', 11,
        'outcomes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oc.id,
            'dimension', oc.dimension,
            'statement', oc.outcome_statement,
            'targetValue', oc.target_value,
            'unit', oc.unit,
            'basis', oc.basis,
            'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                       where p.id = oc.owner_id),
            'ramTarget', case when oc.ram_target_id is null then null else (
              select jsonb_build_object('id', rt.id, 'systemLabel', rt.system_label,
                'targetAvailability', rt.target_availability, 'basis', rt.target_basis)
              from ram_targets rt where rt.id = oc.ram_target_id) end)
            order by oc.dimension, oc.outcome_statement)
          from development_success_outcomes oc where oc.contract_id = sc.id
        ), '[]'::jsonb))
      from development_success_contracts sc
      where sc.development_case_id = c.id and sc.organization_id = c.organization_id
        and sc.status in ('recorded','draft')
      order by case sc.status when 'recorded' then 0 else 1 end, sc.version desc
      limit 1),
    'businessCases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bc.id,
        'caseRef', bc.case_ref,
        'title', bc.title,
        'driver', bc.driver,
        'status', bc.status,
        'currency', bc.currency,
        'discountRate', bc.discount_rate,
        'discountRateSource', bc.discount_rate_source,
        'hypothesis', case when bc.hypothesis_spend is null then null else jsonb_build_object(
          'spend', bc.hypothesis_spend,
          'effect', bc.hypothesis_effect,
          'effectQuantity', bc.hypothesis_effect_quantity,
          'effectUnit', bc.hypothesis_effect_unit,
          'valuePerYear', bc.hypothesis_value_per_year,
          'basis', bc.hypothesis_basis) end,
        'viability', case when bc.viability_floor is null then null else jsonb_build_object(
          'floor', bc.viability_floor, 'basis', bc.viability_floor_basis) end,
        'optionCount', (select count(*) from business_case_options o where o.case_id = bc.id),
        'createdAt', bc.created_at)
        order by bc.created_at desc)
      from business_cases bc
      where bc.development_case_id = c.id and bc.organization_id = c.organization_id
    ), '[]'::jsonb),
    'caseAssumptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'statement', a.statement,
        'status', a.status,
        'confidence', a.confidence,
        'validUntil', a.valid_until,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = a.owner_id),
        'businessCaseId', a.business_case_id,
        'threshold', case when a.threshold_parameter is null then null else jsonb_build_object(
          'parameter', a.threshold_parameter,
          'comparator', a.threshold_comparator,
          'value', a.threshold_value,
          'unit', a.threshold_unit) end,
        'invalidation', case when a.invalidated_at is null then null else jsonb_build_object(
          'invalidatedAt', a.invalidated_at,
          'reason', a.invalidation_reason) end)
        order by a.created_at desc)
      from risk_assumptions a
      where a.development_case_id = c.id and a.organization_id = c.organization_id
    ), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', vm.id,
        'label', vm.label,
        'value', vm.value,
        'unit', vm.unit,
        'status', vm.status,
        'expectedDate', vm.expected_date,
        'basis', vm.basis,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = vm.owner_id),
        'objective', case when vm.objective_id is null then null else (
          select o.description from risk_objectives o where o.id = vm.objective_id) end,
        'verification', case when vm.verified_at is null then null else jsonb_build_object(
          'verifiedAt', vm.verified_at,
          'note', vm.verification_note,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = vm.verified_by)) end)
        order by vm.expected_date nulls last, vm.created_at desc)
      from value_metrics vm
      where vm.development_case_id = c.id and vm.organization_id = c.organization_id
    ), '[]'::jsonb),
    'baselines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'baselineType', b.baseline_type,
        'version', b.version,
        'status', b.status,
        'description', b.description,
        'content', b.content,
        'document', case when b.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title)
          from kb_intake_documents k where k.id = b.document_id) end,
        'approval', case when b.approved_at is null then null else jsonb_build_object(
          'approvedAt', b.approved_at,
          'note', b.approval_note,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = b.approved_by)) end,
        'supersededAt', b.superseded_at,
        'createdAt', b.created_at)
        order by b.baseline_type, b.version desc)
      from development_baselines b
      where b.development_case_id = c.id and b.organization_id = c.organization_id
    ), '[]'::jsonb),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'eventKey', e.event_key,
        'title', e.title,
        'status', e.status,
        'activities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'activityId', t.task_key,
            'description', t.label,
            'wbsPath', t.wbs_path,
            'durationHours', t.duration_hours,
            'plannedStart', t.planned_start,
            'plannedFinish', t.planned_finish,
            'calendar', t.calendar_name,
            'sourceSystem', t.source_system,
            'predecessors', coalesce((
              select jsonb_agg(d.predecessor_key order by d.predecessor_key)
              from shutdown_task_dependencies d
              where d.event_id = e.id and d.task_key = t.task_key), '[]'::jsonb))
            order by t.planned_start, t.task_key)
          from shutdown_tasks t where t.event_id = e.id), '[]'::jsonb))
        order by e.created_at)
      from shutdown_events e
      where e.development_case_id = c.id and e.organization_id = c.organization_id
    ), '[]'::jsonb)
  )
  from development_cases c
  where c.id = p_case_id and c.organization_id = app_current_org();
$$;


revoke all on function public.get_development_case(uuid) from public, anon;
grant execute on function public.get_development_case(uuid) to authenticated;

create or replace function public.get_case_governance(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_det jsonb;
  v_chain jsonb;
  v_resolved record;
  v_resolved_fw jsonb;
  v_rule_set jsonb;
  v_bindings jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select jsonb_build_object(
    'id', g.id,
    'intensityLevel', g.intensity_level,
    'computedLevel', g.computed_level,
    'factorInputs', g.factor_inputs,
    'factorLevels', g.factor_levels,
    'drivers', g.drivers,
    'basis', g.basis,
    'determinedAt', g.determined_at,
    'determinedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = g.determined_by),
    'rule', jsonb_build_object('id', r.id, 'priority', r.priority, 'description', r.description,
      'frameworkName', r.framework_name, 'intensityFloor', r.intensity_floor),
    'ruleSet', jsonb_build_object('id', rs.id, 'name', rs.name, 'version', rs.version),
    'framework', jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version),
    'binding', (
      select jsonb_build_object(
        'intensityLevel', b.intensity_level, 'version', b.version, 'status', b.status,
        'independentAssuranceRequired', b.independent_assurance_required,
        'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
        'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days,
        'basis', b.basis)
      from resolve_case_intensity_binding(v_org, g.intensity_level) b
      where b.id is not null))
  into v_det
  from development_case_governance g
  join governance_tailoring_rules r on r.id = g.rule_id
  join governance_tailoring_rule_sets rs on rs.id = g.rule_set_id
  join project_frameworks f on f.id = g.framework_id
  where g.development_case_id = c.id and g.status = 'current';

  -- The org walk, rendered as the chain the resolver saw (node names and
  -- levels only — see the header note on what a DEFINER read may expose).
  select jsonb_agg(jsonb_build_object(
      'nodeId', o.id, 'name', o.name, 'orgLevel', o.org_level, 'depth', a.depth,
      'carriesProfile', o.governance_profile_id is not null)
    order by a.depth)
  into v_chain
  from org_ancestry(v_org) a
  join organizations o on o.id = a.node_id;

  select * into v_resolved from resolve_org_governance_profile(v_org);
  if found then
    select jsonb_build_object(
      'frameworkId', fw.id, 'name', fw.name, 'version', fw.version,
      'sourceAuthority', fw.source_authority,
      'sourceNode', (select jsonb_build_object('nodeId', o.id, 'name', o.name, 'orgLevel', o.org_level)
                     from organizations o where o.id = v_resolved.source_node_id),
      'depth', v_resolved.source_depth,
      'operableHere', fw.organization_id = v_org)
    into v_resolved_fw
    from project_frameworks fw where fw.id = v_resolved.framework_id;
  end if;

  select jsonb_build_object(
    'id', rs.id, 'name', rs.name, 'version', rs.version, 'status', rs.status,
    'valueThresholds', rs.value_thresholds,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'priority', r.priority, 'description', r.description,
        'lifecycleTypes', r.lifecycle_types,
        'minValueUsd', r.min_value_usd, 'maxValueUsd', r.max_value_usd,
        'minIntensity', r.min_intensity, 'maxIntensity', r.max_intensity,
        'frameworkName', r.framework_name, 'intensityFloor', r.intensity_floor)
        order by r.priority), '[]'::jsonb)
      from governance_tailoring_rules r where r.rule_set_id = rs.id),
    'compositeRules', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', cr.id, 'priority', cr.priority, 'description', cr.description,
        'minValueLevel', cr.min_value_level, 'minRiskRating', cr.min_risk_rating,
        'minIntensity', cr.min_intensity, 'minNovelty', cr.min_novelty,
        'consequence', cr.consequence)
        order by cr.priority), '[]'::jsonb)
      from governance_composite_rules cr where cr.rule_set_id = rs.id))
  into v_rule_set
  from governance_tailoring_rule_sets rs
  where rs.organization_id = v_org and rs.status = 'adopted'
  order by rs.adopted_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'intensityLevel', b.intensity_level, 'version', b.version, 'status', b.status,
      'independentAssuranceRequired', b.independent_assurance_required,
      'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
      'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days)
    order by governance_intensity_rank(b.intensity_level)), '[]'::jsonb)
  into v_bindings
  from governance_intensity_bindings b
  where b.organization_id = v_org and b.status = 'adopted';

  return jsonb_build_object(
    'caseId', c.id,
    'caseValueUsd', coalesce(c.sanctioned_value, c.estimated_capex),
    'caseValueSource', case
      when c.sanctioned_value is not null then 'sanctioned_value'
      when c.estimated_capex is not null then 'estimated_capex'
      else null end,
    'bindingUnmet', case_binding_gate_demands(c.id, null),
    'draftRuleSets', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', rs.id, 'name', rs.name, 'version', rs.version) order by rs.name, rs.version), '[]'::jsonb)
      from governance_tailoring_rule_sets rs
      where rs.organization_id = v_org and rs.status = 'draft'),
    'draftBindings', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'intensityLevel', b.intensity_level, 'version', b.version,
          'independentAssuranceRequired', b.independent_assurance_required,
          'evidenceLinkedDeliverablesRequired', b.evidence_linked_deliverables_required,
          'assuranceLevel', b.assurance_level, 'reviewCadenceDays', b.review_cadence_days)
        order by governance_intensity_rank(b.intensity_level), b.version), '[]'::jsonb)
      from governance_intensity_bindings b
      where b.organization_id = v_org and b.status = 'draft'),
    'lifecycleType', c.lifecycle_type,
    'framework', case when c.framework_id is null then null else (
      select jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version, 'status', f.status)
      from project_frameworks f where f.id = c.framework_id) end,
    'determination', v_det,
    'orgChain', coalesce(v_chain, '[]'::jsonb),
    'inheritedProfile', v_resolved_fw,
    'adoptedRuleSet', v_rule_set,
    'adoptedBindings', v_bindings);
end
$$;


revoke all on function public.get_case_governance(uuid) from public, anon;
grant execute on function public.get_case_governance(uuid) to authenticated;

notify pgrst, 'reload schema';
