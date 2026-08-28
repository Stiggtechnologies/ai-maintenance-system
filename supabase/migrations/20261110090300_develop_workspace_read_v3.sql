-- ============================================================================
-- Sync Develop Slice 1 — the Case Workspace read, v3 (rows 9–10 additions).
--
-- get_development_case is RE-CREATED from its 20261105090500 definition with
-- exactly two additions; every pre-existing key is byte-identical (diffed at
-- authoring time) so the existing surface renders unchanged:
--
--   * each gate criterion carries its readiness `weight` (D3.35 — the same
--     value get_gate_readiness computes with, so the workspace's inline
--     rollup and the readiness RPC read one configuration);
--   * a `baselines` section (D5.26): every version of every type, prior
--     versions visible and immutable, the approval record beside each — the
--     anchor Change control will diff against in Slice 4.
--
-- The §80 readiness panel does NOT ride this aggregate: it renders
-- get_gate_readiness (20261110090100) per gate, one query returning the
-- same rows the enforcement consults. The §81 operations view likewise
-- renders get_case_operational_readiness (20261110090200).
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
            'criteria', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sc.id, 'criterion', sc.criterion,
                'isMandatory', sc.is_mandatory, 'guidance', sc.guidance,
                'category', sc.category, 'evidenceType', sc.evidence_type,
                'minimumConfidence', sc.minimum_confidence,
                'weight', sc.weight,
                'sourceAuthority', sc.source_authority)
                order by sc.sort_order, sc.criterion)
              from stage_gate_criteria sc where sc.gate_id = g.id
            ), '[]'::jsonb),
            'latestReview', (
              select jsonb_build_object(
                'id', r.id, 'outcome', r.outcome, 'reviewedAt', r.reviewed_at,
                'note', r.note,
                'findings', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'criterion', fi.criterion_text, 'status', fi.status,
                    'evidence', fi.evidence))
                  from stage_gate_findings fi where fi.review_id = r.id
                ), '[]'::jsonb),
                'conditions', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', gc.id, 'description', gc.description,
                    'dueDate', gc.due_date, 'status', gc.status,
                    'evidenceRequirement', gc.evidence_requirement,
                    'consequenceIfMissed', gc.consequence_if_missed,
                    'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                               where p.id = gc.owner_id))
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
    ), '[]'::jsonb)
  )
  from development_cases c
  where c.id = p_case_id and c.organization_id = app_current_org();
$$;

revoke all on function public.get_development_case(uuid) from public, anon;
grant execute on function public.get_development_case(uuid) to authenticated;

notify pgrst, 'reload schema';
