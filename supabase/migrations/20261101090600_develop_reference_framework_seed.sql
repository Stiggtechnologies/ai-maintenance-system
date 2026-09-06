-- ============================================================================
-- Sync Develop Slice 1 — demo reference framework (register standing
-- constraint 1, demo-honest).
--
-- A five-stage "Reference Heavy-Industry Stage Gate" profile for the demo
-- tenant so problem-first intake is demonstrable end-to-end. Provenance is
-- the point of this file's discipline:
--
--   * source_authority = INDUSTRY_GUIDANCE on the framework and on every
--     requirement (one deliberately-advisory AI_SUGGESTION row exists to
--     demonstrate the D3.15 promotion boundary);
--   * the profile is generic front-end-loading practice. It is NOT labeled
--     ADEM, not attributed to any company, and never described as
--     authoritative — a real customer's gates are configured from that
--     customer's authoritative documents (spec provenance header);
--   * seeded as 'adopted' FOR THE DEMO TENANT ONLY, with the basis text
--     saying exactly that. Every other tenant authors and adopts its own.
--
-- Demo tenant only; a database without it gets nothing.
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_fw uuid;
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;
  if exists (select 1 from project_frameworks
             where organization_id = v_org
               and name = 'Reference Heavy-Industry Stage Gate') then
    return;
  end if;

  -- This seed writes an already-adopted framework and its members, which the
  -- immutability backstop (enforce_framework_immutability /
  -- enforce_framework_requirement_immutability) guards. The transaction-
  -- local marker names this block as a governed, deliberate provisioning act
  -- — exactly the recorded-operator-transaction idiom the backstop's header
  -- describes — rather than leaving 28 admit-and-audit rows on every fresh
  -- reset for writes that ARE the sanctioned demo provisioning.
  perform set_config('app.framework_write', 'granted', true);

  insert into project_frameworks
    (organization_id, name, version, source, source_authority, status,
     effective_date, project_classes, basis, adopted_at)
  values
    (v_org, 'Reference Heavy-Industry Stage Gate', 1,
     'Generic heavy-industry front-end-loading practice (public stage-gate literature). A reference profile, not any organization''s authoritative framework.',
     'INDUSTRY_GUIDANCE', 'adopted', current_date, '["reference","demo"]'::jsonb,
     'Demo-tenant reference profile seeded so the intake flow is demonstrable. Adopted for the DEMO TENANT ONLY by seed; a real organization authors its own framework from its own governing documents and adopts it through adopt_project_framework.',
     now())
  returning id into v_fw;

  insert into project_framework_stages
    (organization_id, framework_id, stage_key, sequence, display_name, purpose)
  values
    (v_org, v_fw, 'need_identification', 1, 'Identify',
     'Frame the problem or opportunity and establish that spending anything is justified.'),
    (v_org, v_fw, 'options_analysis', 2, 'Evaluate',
     'Generate and screen credible alternatives, including non-asset options.'),
    (v_org, v_fw, 'design', 3, 'Define',
     'Define scope, estimate and execution plan to sanction quality.'),
    (v_org, v_fw, 'construction', 4, 'Execute',
     'Build to the sanctioned definition under change control.'),
    (v_org, v_fw, 'operation', 5, 'Operate & Close',
     'Stabilize operation, verify benefits, close the case with its lessons.');

  insert into stage_gates
    (organization_id, framework_id, stage_key, name, sequence, decision_type,
     independent_assurance_required, readiness_threshold)
  values
    (v_org, v_fw, 'need_identification', 'G1 — Opportunity screen', 1, 'gate', false, null),
    -- D3.37 demonstrated: a checkpoint is a lighter row on the SAME family.
    (v_org, v_fw, 'options_analysis', 'Alternatives checkpoint', 1, 'checkpoint', false, null),
    (v_org, v_fw, 'options_analysis', 'G2 — Concept selection', 2, 'gate', false, null),
    (v_org, v_fw, 'design', 'G3 — Sanction readiness', 1, 'gate', true, 80),
    (v_org, v_fw, 'construction', 'G4 — Ready for commissioning', 1, 'gate', false, null),
    (v_org, v_fw, 'operation', 'G5 — Close-out', 1, 'gate', false, null);

  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, source_authority)
  select v_org, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
         v.sort_order, v.category, v.evidence_type, v.source_authority
  from stage_gates g
  join (values
    ('G1 — Opportunity screen',
     'The problem or opportunity statement is written and quantified', true,
     'A case that cannot state its problem is a solution looking for one.',
     10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G1 — Opportunity screen',
     'The do-nothing consequence is stated', true,
     'Every option is measured against an honest baseline of doing nothing.',
     20, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G1 — Opportunity screen',
     'Strategic alignment is identified', false,
     'Which objective does this serve, at which organizational level?',
     30, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('Alternatives checkpoint',
     'At least three credible alternatives, including a non-asset option, are on the table', false,
     'A single option is a decision already taken, not a decision being made.',
     10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G2 — Concept selection',
     'Rejected options are recorded with the reason for rejecting them', true,
     'A selection with no recorded rejections cannot be reviewed later.',
     10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G2 — Concept selection',
     'Whole-life cost compares the shortlisted options', true,
     'Capital cost alone selects the option operations pays for later.',
     20, 'cost_schedule', 'CALCULATED', 'INDUSTRY_GUIDANCE'),
    ('G2 — Concept selection',
     'Key assumptions carry owners and validity conditions', false,
     'An assumption nobody owns invalidates silently.',
     30, 'risk', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G3 — Sanction readiness',
     'Scope definition is complete enough to estimate against', true,
     'Sanctioning an undefined scope sanctions a number, not a project.',
     10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G3 — Sanction readiness',
     'An execution risk register exists and HIGH risks carry treatments', true,
     'Untreated high risk at sanction is a decision to accept it without saying so.',
     20, 'risk', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G3 — Sanction readiness',
     'Operations and maintenance have reviewed the design for operability and maintainability', true,
     'The people who will run it see it before the money is committed.',
     30, 'operations', 'INSPECTED', 'INDUSTRY_GUIDANCE'),
    ('G3 — Sanction readiness',
     'The estimate states its basis and maturity', true,
     'A number without a basis cannot carry a confidence.',
     40, 'cost_schedule', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G3 — Sanction readiness',
     'Long-lead procurement risk on rotating equipment has been considered', false,
     'Advisory suggestion surfaced by the evidence agent pattern; promote only through promote_requirement_authority with a named human basis.',
     50, 'supply', 'DOCUMENTED', 'AI_SUGGESTION'),
    ('G4 — Ready for commissioning',
     'Deviations from the sanctioned definition are recorded as concessions', true,
     'An undocumented deviation becomes an unexplained failure mode.',
     10, 'quality', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G4 — Ready for commissioning',
     'A commissioning and handover plan exists with named system owners', true,
     'Handover is a transfer of accountability, not of keys.',
     20, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
    ('G5 — Close-out',
     'Benefit measurement is running against the approved expectation', true,
     'Value realization starts from the sanction reference, not from memory.',
     10, 'value', 'MEASURED', 'INDUSTRY_GUIDANCE'),
    ('G5 — Close-out',
     'Lessons are recorded against the case for the next one', false,
     'The cheapest improvement to the next project is the record of this one.',
     20, 'learning', 'DOCUMENTED', 'INDUSTRY_GUIDANCE')
  ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
    on v.gate_name = g.name
  where g.framework_id = v_fw;
end $$;

notify pgrst, 'reload schema';
