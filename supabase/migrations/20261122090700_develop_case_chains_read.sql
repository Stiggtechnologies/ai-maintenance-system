-- ============================================================================
-- Sync Develop Slice 3C — the case-surface read for this slice's families
-- (D3.08/D3.09 commitments + coverage, D3.10/D3.11 the regulatory chain and
-- where its conditions landed, D3.16 assurance, D11.22 evidence confidence).
--
-- WHY A SEPARATE READ RATHER THAN A get_development_case v7: the workspace
-- page ALREADY composes several per-section reads beside the aggregate —
-- get_case_governance (GovernancePanel), get_gate_readiness (GateCard),
-- get_case_operational_readiness (OperationalReadinessSection). This is that
-- established shape, not a second workspace read: get_development_case stays
-- the case aggregate and is untouched by this slice, so nothing this file
-- does can perturb the v5 payload the whole page already depends on.
--
-- The #282 principle still binds: what this read RENDERS is what the RPCs
-- ENFORCE. Coverage comes from get_case_commitment_coverage — the same
-- function whose output feeds the gate blocker, not a re-implementation with
-- its own idea of "uncovered". Evidence confidence comes from
-- compute_evidence_confidence through get_case_evidence_confidence — the same
-- refusals, surfaced AS refusals rather than as blanks.
-- ============================================================================

create or replace function public.get_case_chains(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_commitments jsonb;
  v_coverage jsonb;
  v_requirements jsonb;
  v_regulatory jsonb;
  v_assurance jsonb;
  v_confidence jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- D3.08 — the commitments themselves, all seven fields rendered.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sc.id,
    'commitmentRef', sc.commitment_ref,
    'stakeholder', jsonb_build_object(
      'id', st.id, 'name', st.name, 'type', st.stakeholder_type,
      'externalOrganization', st.external_organization,
      'relationship', st.role_or_relationship, 'influence', st.influence),
    'concern', sc.concern,
    'commitment', sc.commitment,
    'kind', sc.commitment_kind,
    'requirement', case when d.id is null then null else jsonb_build_object(
      'id', d.id, 'ref', d.requirement_ref, 'category', d.category,
      'requirement', d.requirement, 'verificationStatus', d.verification_status) end,
    'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = sc.owner_id),
    'ownerId', sc.owner_id,
    'dueDate', sc.due_date,
    'status', sc.status,
    'overdue', sc.status in ('open','breached') and sc.due_date < current_date,
    'breachedAt', sc.breached_at,
    'evidence', case when ev.id is null then null else jsonb_build_object(
      'id', ev.id, 'description', ev.description,
      'evidenceClass', ev.evidence_class,
      'verificationStatus', ev.verification_status) end,
    'closure', case when sc.closed_at is null then null else jsonb_build_object(
      'closedAt', sc.closed_at, 'note', sc.closure_note,
      'by', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = sc.closed_by)) end,
    'withdrawalReason', sc.withdrawal_reason,
    'createdAt', sc.created_at)
    order by sc.due_date, sc.commitment_ref), '[]'::jsonb)
  into v_commitments
  from stakeholder_commitments sc
  join risk_stakeholders st on st.id = sc.stakeholder_id
  left join design_requirements d on d.id = sc.requirement_id
  left join evidence_items ev on ev.id = sc.evidence_item_id
  where sc.organization_id = v_org and sc.development_case_id = c.id;

  -- D3.09 — the SAME detection the gate blocker reads. Not a second one.
  v_coverage := get_case_commitment_coverage(c.id);

  -- The case's project requirements (the ONE requirement table, case-scoped),
  -- so the coverage report can be acted on without leaving the surface.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'ref', d.requirement_ref,
    'category', d.category,
    'requirement', d.requirement,
    'source', d.source,
    'verificationMethod', d.verification_method,
    'verificationStatus', d.verification_status,
    'commitmentCount', (
      select count(*) from stakeholder_commitments s2
      where s2.requirement_id = d.id and s2.status <> 'withdrawn'),
    'createdAt', d.created_at)
    order by d.requirement_ref), '[]'::jsonb)
  into v_requirements
  from design_requirements d
  where d.organization_id = v_org and d.development_case_id = c.id;

  -- D3.10/D3.11 — the chain, whole, with each approval's conditions and
  -- exactly where each condition landed.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rr.id,
    'ref', rr.requirement_ref,
    'regulator', rr.regulator,
    'jurisdiction', rr.jurisdiction,
    'instrument', rr.instrument,
    'permitType', rr.permit_type,
    'description', rr.description,
    'sourceAuthority', rr.source_authority,
    'triggerCondition', rr.trigger_condition,
    'expectedLeadTimeDays', rr.expected_lead_time_days,
    'requiredByDate', rr.required_by_date,
    'status', rr.status,
    'notRequiredBasis', rr.not_required_basis,
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'ref', a.application_ref,
        'status', a.status,
        'submittedAt', a.submitted_at,
        'submittedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = a.submitted_by),
        'scope', a.scope_description,
        'informationRequests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', q.id, 'ref', q.request_ref, 'requestedAt', q.requested_at,
            'responseDue', q.response_due, 'detail', q.request_detail,
            'status', q.status, 'breachedAt', q.breached_at,
            'overdue', q.status in ('open','overdue') and q.response_due < current_date,
            'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = q.owner_id),
            'respondedAt', q.responded_at,
            'responseEvidenceId', q.response_evidence_id)
            order by q.response_due, q.request_ref)
          from regulatory_information_requests q where q.application_id = a.id), '[]'::jsonb),
        'approval', (
          select jsonb_build_object(
            'id', ap.id, 'permitNumber', ap.permit_number,
            'decidingAuthority', ap.deciding_authority, 'decision', ap.decision,
            'decisionDate', ap.decision_date, 'effectiveFrom', ap.effective_from,
            'expiresAt', ap.expires_at, 'perpetual', ap.perpetual,
            'status', ap.status, 'refusalReason', ap.refusal_reason,
            'recordedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = ap.recorded_by),
            'lapsed', ap.status = 'expired',
            'conditions', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', rc.id, 'ref', rc.condition_ref, 'description', rc.description,
                'obligationDomain', rc.obligation_domain, 'recurrence', rc.recurrence,
                'dueDate', rc.due_date, 'status', rc.status,
                'overdue', rc.status = 'missed' or (rc.status = 'open' and rc.due_date < current_date),
                'breachedAt', rc.breached_at,
                'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = rc.owner_id),
                'evidenceRequirement', rc.evidence_requirement,
                'consequenceIfMissed', rc.consequence_if_missed,
                -- Where it LANDED. The whole point of D3.11: the answer is
                -- on the row, not a guess from a join.
                'propagation', case when rc.propagated_at is null then null else jsonb_build_object(
                  'at', rc.propagated_at,
                  'requirement', case when rc.propagated_requirement_id is null then null else (
                    select jsonb_build_object('id', dr.id, 'ref', dr.requirement_ref,
                      'verificationStatus', dr.verification_status)
                    from design_requirements dr where dr.id = rc.propagated_requirement_id) end,
                  'workOrder', case when rc.propagated_work_order_id is null then null else (
                    select jsonb_build_object('id', wo.id, 'number', wo.wo_number,
                      'title', wo.title, 'status', wo.status, 'assetId', wo.asset_id,
                      'asset', (select ast.name from assets ast where ast.id = wo.asset_id))
                    from work_orders wo where wo.id = rc.propagated_work_order_id) end) end,
                'closure', case when rc.closed_at is null then null else jsonb_build_object(
                  'closedAt', rc.closed_at, 'note', rc.closure_note,
                  'evidenceId', rc.closure_evidence_id,
                  'by', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = rc.closed_by)) end)
                order by rc.condition_ref)
              from regulatory_conditions rc where rc.approval_id = ap.id), '[]'::jsonb))
          from regulatory_approvals ap where ap.application_id = a.id
          order by ap.decision_date desc limit 1))
        order by a.created_at)
      from regulatory_applications a where a.requirement_id = rr.id), '[]'::jsonb))
    order by rr.required_by_date nulls last, rr.requirement_ref), '[]'::jsonb)
  into v_regulatory
  from regulatory_requirements rr
  where rr.organization_id = v_org and rr.development_case_id = c.id;

  -- D3.16 — the assurance reviews of this case, with the II.15 fields.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ar.id,
    'level', ar.assurance_level,
    'status', ar.status,
    'scope', ar.scope,
    'conclusion', ar.conclusion,
    'reviewer', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = ar.reviewer_id),
    'reviewerId', ar.reviewer_id,
    'subjectOwner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = ar.subject_owner_id),
    'competencies', ar.reviewer_competency_keys,
    'competencyBasis', ar.reviewer_competency_basis,
    'conflictsDeclared', ar.conflicts_declared,
    'conflictsDeclaredAt', ar.conflicts_declared_at,
    'gate', case when ar.gate_id is null then null else (
      select jsonb_build_object('id', g.id, 'name', g.name) from stage_gates g where g.id = ar.gate_id) end,
    'findings', ar.findings,
    'evidenceItemIds', ar.evidence_item_ids,
    'dueDate', ar.due_date,
    'completedAt', ar.completed_at,
    'createdAt', ar.created_at)
    order by ar.created_at desc), '[]'::jsonb)
  into v_assurance
  from risk_assurance_reviews ar
  where ar.organization_id = v_org
    and ar.subject_type = 'development_case' and ar.subject_id = c.id;

  -- D11.22 — EC per evidence item, refusals kept visible as refusals.
  v_confidence := get_case_evidence_confidence(c.id);

  return jsonb_build_object(
    'caseId', c.id,
    'commitments', v_commitments,
    'coverage', v_coverage,
    'requirements', v_requirements,
    'regulatory', v_regulatory,
    'assurance', v_assurance,
    'evidenceConfidence', v_confidence);
end
$$;

revoke all on function public.get_case_chains(uuid) from public, anon;
grant execute on function public.get_case_chains(uuid) to authenticated;

notify pgrst, 'reload schema';
