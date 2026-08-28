-- ============================================================================
-- Sync Develop Slice 3 — the framework profile LIBRARY: six starter profiles
-- (D3.02, spec I.1) under the provenance fence (D11.04).
--
-- THE FENCE, ENFORCED IN THE DATA ITSELF (spec provenance header, register
-- standing constraint 1): every profile and every seeded requirement below
-- is a GENERIC INDUSTRY ARCHETYPE. Nothing is labeled ADEM, nothing is
-- attributed to Suncor or any corporation, and nothing claims authoritative
-- corporate methodology. The spec's own fence says public-source framework
-- detail ships at "INDUSTRY_GUIDANCE / INFERRED at best"; the enforced
-- eight-tier enum (20261101090400) has no INFERRED value and widening an
-- enforced enum to fit a label is forbidden, so the fence maps onto the
-- ladder as:
--
--   INDUSTRY_GUIDANCE — content grounded in public industry practice
--                       (stage-gate / front-end-loading literature);
--   BEST_PRACTICE     — generic inferred good practice with no external
--                       corpus behind it (the "INFERRED at best" tier).
--
-- Both sit BELOW every corporate/authoritative tier, and raising either is
-- the recorded human act promote_requirement_authority already guards
-- (D3.15). A test (developSlice3GovernanceMigration.test.ts) pins this
-- file to those two tiers and to the absence of 'ADEM'/'Suncor' anywhere.
--
-- LIBRARY SEMANTICS. The six profiles arrive as DRAFTS for every
-- organization — the library is a shelf, not an adoption. Selection is the
-- tenant's act: adopt_project_framework (executive, recorded basis) makes
-- one govern anything, exactly as the build plan's "Automated framework
-- activation — never" rule demands. provision_organization is re-created
-- in 20261120090200 (once, after the tailoring seeder also exists) so every
-- FUTURE tenant receives the same shelf; existing organizations are seeded
-- by the DO block at the end of this file.
--
-- The six archetypes (build-plan coverage list): major capital (mining),
-- sustaining capital, turnaround/shutdown, brownfield modification,
-- digital/IT delivery, exploration/study phase.
-- ============================================================================

create or replace function public.seed_governance_framework_library(p_target uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fw uuid;
  v_seeded int := 0;
begin
  if not exists (select 1 from organizations where id = p_target) then
    return 0;
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Major Capital Projects — Mining & Metals
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Major Capital Projects — Mining & Metals') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Major Capital Projects — Mining & Metals', 1,
       'Generic major-capital stage-gate archetype assembled from public front-end-loading and capital-projects literature. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["major_project","mining","greenfield","capacity"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02). Selection and adoption are acts by an accountable person in THIS organization; content is INDUSTRY_GUIDANCE/BEST_PRACTICE tier only and never represents a specific corporation''s framework.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Identify & Frame',
       'Frame the problem or opportunity and establish that spending anything is justified.'),
      (p_target, v_fw, 'options_analysis', 2, 'Concept Alternatives',
       'Generate and screen credible alternatives, including non-asset options.'),
      (p_target, v_fw, 'design', 3, 'Definition',
       'Define scope, estimate and execution plan to sanction quality.'),
      (p_target, v_fw, 'construction', 4, 'Execute',
       'Build to the sanctioned definition under change control.'),
      (p_target, v_fw, 'commissioning', 5, 'Commission & Handover',
       'Verify performance and transfer accountability to operations.'),
      (p_target, v_fw, 'operation', 6, 'Operate & Realize',
       'Stabilize operation, verify benefits, close with lessons.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Opportunity screen', 1, 'gate', false, null),
      (p_target, v_fw, 'options_analysis', 'G2 — Concept selection', 1, 'gate', false, null),
      (p_target, v_fw, 'design', 'Definition checkpoint', 1, 'checkpoint', false, null),
      (p_target, v_fw, 'design', 'G3 — Sanction readiness', 2, 'gate', true, 85),
      (p_target, v_fw, 'construction', 'G4 — Ready for commissioning', 1, 'gate', false, null),
      (p_target, v_fw, 'commissioning', 'G5 — Handover acceptance', 1, 'gate', false, null),
      (p_target, v_fw, 'operation', 'G6 — Benefits close-out', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Opportunity screen', 'The problem or opportunity statement is written and quantified', true,
       'A case that cannot state its problem is a solution looking for one.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G1 — Opportunity screen', 'Strategic alignment names the objective this investment serves', true,
       'Capital serves an objective, or it serves nothing.', 20, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Concept selection', 'At least three credible alternatives, including a non-asset option, were evaluated', true,
       'A single option is a decision already taken, not a decision being made.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Concept selection', 'Whole-life cost compares the shortlisted options', true,
       'Capital cost alone selects the option operations pays for later.', 20, 'cost_schedule', 'CALCULATED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Concept selection', 'Rejected options are recorded with the reason for rejection', false,
       'A selection with no recorded rejections cannot be reviewed later.', 30, 'business', 'DOCUMENTED', 'BEST_PRACTICE'),
      ('Definition checkpoint', 'Long-lead procurement items are identified with order dates', false,
       'A late order discovered at sanction is schedule already lost.', 10, 'supply', 'DOCUMENTED', 'BEST_PRACTICE'),
      ('G3 — Sanction readiness', 'Scope definition is complete enough to estimate against', true,
       'Sanctioning an undefined scope sanctions a number, not a project.', 10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Sanction readiness', 'The execution risk register exists and HIGH risks carry treatments', true,
       'Untreated high risk at sanction is a decision to accept it without saying so.', 20, 'risk', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Sanction readiness', 'The estimate states its basis, maturity class and contingency', true,
       'A number without a basis cannot carry a confidence.', 30, 'cost_schedule', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Sanction readiness', 'Operations and maintenance have reviewed operability and maintainability', true,
       'The people who will run it see it before the money is committed.', 40, 'operations', 'INSPECTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Sanction readiness', 'Regulatory approvals required before execution are identified with owners', true,
       'An unowned approval is a stop-work order with a future date.', 50, 'regulatory', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Ready for commissioning', 'Deviations from the sanctioned definition are recorded as changes', true,
       'An undocumented deviation becomes an unexplained failure mode.', 10, 'quality', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Ready for commissioning', 'A commissioning and handover plan exists with named system owners', true,
       'Handover is a transfer of accountability, not of keys.', 20, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G5 — Handover acceptance', 'Performance tests demonstrate the acceptance criteria', true,
       'Acceptance rests on demonstrated performance, not on completion of construction.', 10, 'technical', 'TESTED', 'INDUSTRY_GUIDANCE'),
      ('G5 — Handover acceptance', 'Operating and maintenance information is delivered and accepted', true,
       'A plant handed over without its information is handed over twice.', 20, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G6 — Benefits close-out', 'Benefit measurement runs against the approved expectation', true,
       'Value realization starts from the sanction reference, not from memory.', 10, 'value', 'MEASURED', 'INDUSTRY_GUIDANCE'),
      ('G6 — Benefits close-out', 'Lessons are recorded against the case for the next one', false,
       'The cheapest improvement to the next project is the record of this one.', 20, 'learning', 'DOCUMENTED', 'BEST_PRACTICE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Sustaining Capital — Light Governance (the spec I.1 light regime:
  --    three gates, not five).
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Sustaining Capital — Light Governance') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Sustaining Capital — Light Governance', 1,
       'Generic light-governance archetype for routine sustaining capital, from public stage-gate practice. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["sustaining_capital","replacement","reliability_improvement"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02): three gates instead of five so routine work is not over-processed (spec I.1). Adoption is this organization''s act; INDUSTRY_GUIDANCE/BEST_PRACTICE tier only.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Screen',
       'State the need and the consequence of doing nothing.'),
      (p_target, v_fw, 'design', 2, 'Define & Commit',
       'Define scope, estimate and schedule to commitment quality.'),
      (p_target, v_fw, 'construction', 3, 'Execute & Close',
       'Execute, capture as-builts and compare outcome to the approved need.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Screen', 1, 'gate', false, null),
      (p_target, v_fw, 'design', 'G2 — Commitment', 1, 'gate', false, null),
      (p_target, v_fw, 'construction', 'G3 — Close', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Screen', 'The need is stated with the consequence of doing nothing', true,
       'Light governance still starts from an honest baseline.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Commitment', 'Scope, estimate and schedule are defined to commitment quality', true,
       'Light does not mean undefined.', 10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Commitment', 'Execution risks are listed with owners', true,
       'A short risk list with owners beats a long one without.', 20, 'risk', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Close', 'As-built records and closeout costs are captured', true,
       'The asset record is part of the asset.', 10, 'quality', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Close', 'The outcome is compared to the approved need', false,
       'Even routine work answers whether it did what it promised.', 20, 'value', 'MEASURED', 'BEST_PRACTICE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Turnaround & Shutdown Delivery
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Turnaround & Shutdown Delivery') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Turnaround & Shutdown Delivery', 1,
       'Generic turnaround/shutdown delivery archetype from public event-management practice: frozen scope, work-pack readiness, constraint clearance before the window. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["turnaround","shutdown","outage"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02). Adoption is this organization''s act; INDUSTRY_GUIDANCE/BEST_PRACTICE tier only.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Scope Intake',
       'Assemble and challenge the candidate scope list.'),
      (p_target, v_fw, 'design', 2, 'Work Pack Definition',
       'Turn frozen scope into executable, constraint-checked work packs.'),
      (p_target, v_fw, 'procurement', 3, 'Materials & Services',
       'Secure materials, services and specialist crews inside the window.'),
      (p_target, v_fw, 'construction', 4, 'Execution Window',
       'Execute the event under daily schedule and constraint control.'),
      (p_target, v_fw, 'operation', 5, 'Startup & Review',
       'Start up, verify and capture the event record.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Scope freeze', 1, 'gate', false, null),
      (p_target, v_fw, 'design', 'G2 — Work-pack readiness', 1, 'gate', false, null),
      (p_target, v_fw, 'procurement', 'Materials checkpoint', 1, 'checkpoint', false, null),
      (p_target, v_fw, 'construction', 'G3 — Execution readiness', 1, 'gate', false, 90),
      (p_target, v_fw, 'operation', 'G4 — Post-event review', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Scope freeze', 'The scope list is frozen and additions require change control', true,
       'An open scope list is an open duration.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Work-pack readiness', 'Every work pack states isolation, access and crew requirements', true,
       'A pack that cannot be started safely is not a pack.', 10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Work-pack readiness', 'Critical-path work is identified with stated float', false,
       'The window is a schedule promise; know what breaks it.', 20, 'cost_schedule', 'CALCULATED', 'BEST_PRACTICE'),
      ('Materials checkpoint', 'Long-lead materials hold confirmed delivery dates inside the window', false,
       'A material date after the window is scope already deferred.', 10, 'supply', 'DOCUMENTED', 'BEST_PRACTICE'),
      ('G3 — Execution readiness', 'Constraints on released work are cleared or carry dated clearance plans', true,
       'Releasing constrained work converts a plan into a queue.', 10, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Execution readiness', 'Permit and isolation plans are approved for the window', true,
       'The event starts on paper before it starts on plant.', 20, 'regulatory', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Post-event review', 'Startup is complete and deviations are recorded with causes', true,
       'An unexplained deviation repeats itself at the next event.', 10, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Post-event review', 'Duration and cost outcomes are compared to plan', false,
       'The next window is planned from this one''s record.', 20, 'value', 'MEASURED', 'BEST_PRACTICE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Brownfield Modification — Operating Site
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Brownfield Modification — Operating Site') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Brownfield Modification — Operating Site', 1,
       'Generic brownfield-modification archetype from public practice: interface registration, simultaneous-operations risk, management of change and tie-in discipline on a live plant. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["brownfield","modification","life_extension","regulatory","decommissioning"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02). Adoption is this organization''s act; INDUSTRY_GUIDANCE/BEST_PRACTICE tier only.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Frame',
       'State the change and its impact on the operating unit.'),
      (p_target, v_fw, 'options_analysis', 2, 'Options',
       'Compare options including production interruption, not capital alone.'),
      (p_target, v_fw, 'design', 3, 'Define',
       'Define the modification with its interfaces and change approvals.'),
      (p_target, v_fw, 'construction', 4, 'Execute',
       'Execute beside a live plant under simultaneous-operations control.'),
      (p_target, v_fw, 'commissioning', 5, 'Tie-in & Commission',
       'Tie in on agreed windows and verify the modified systems.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Framing', 1, 'gate', false, null),
      (p_target, v_fw, 'options_analysis', 'G2 — Option selection', 1, 'gate', false, null),
      (p_target, v_fw, 'design', 'G3 — Definition & interfaces', 1, 'gate', false, 80),
      (p_target, v_fw, 'commissioning', 'G4 — Tie-in readiness', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Framing', 'The operating-unit impact of the change is stated', true,
       'A modification is judged beside the plant it modifies.', 10, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Option selection', 'Options compare production interruption alongside capital cost', true,
       'On a live plant, downtime is a capital cost by another name.', 10, 'business', 'CALCULATED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Definition & interfaces', 'Physical, process and control interfaces with the operating plant are registered with owners', true,
       'The interface nobody owns is the one that leaks.', 10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Definition & interfaces', 'Simultaneous-operations risk during execution is assessed', true,
       'Construction beside operation is its own hazard class.', 20, 'risk', 'DOCUMENTED', 'BEST_PRACTICE'),
      ('G3 — Definition & interfaces', 'Management-of-change approvals are identified for every affected system', true,
       'A modification without its change record is a drawing that lies.', 30, 'regulatory', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Tie-in readiness', 'Tie-in windows are agreed with operations and isolations approved', true,
       'A tie-in without a window is an unplanned outage.', 10, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Tie-in readiness', 'Pre-startup safety review is complete for modified systems', true,
       'The modified plant starts up as a new plant.', 20, 'risk', 'INSPECTED', 'INDUSTRY_GUIDANCE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Digital & IT Delivery
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Digital & IT Delivery') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Digital & IT Delivery', 1,
       'Generic digital/IT delivery archetype from public practice: architecture selection, build readiness, rehearsed cutover, stabilization exit. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["digital","information_technology","software"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02). Adoption is this organization''s act; INDUSTRY_GUIDANCE/BEST_PRACTICE tier only.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Discover',
       'Document the business problem and the current-state workflow.'),
      (p_target, v_fw, 'options_analysis', 2, 'Options & Architecture',
       'Compare build, buy and configure with lifecycle cost and security.'),
      (p_target, v_fw, 'design', 3, 'Build Readiness',
       'Define data migration, acceptance criteria and the test plan.'),
      (p_target, v_fw, 'construction', 4, 'Build & Integrate',
       'Build and integrate under the agreed acceptance criteria.'),
      (p_target, v_fw, 'commissioning', 5, 'Cutover',
       'Rehearse, cut over, and hold a rollback that works.'),
      (p_target, v_fw, 'operation', 6, 'Stabilize & Realize',
       'Stabilize, measure adoption and verify the benefit.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Discovery review', 1, 'gate', false, null),
      (p_target, v_fw, 'options_analysis', 'G2 — Architecture selection', 1, 'gate', false, null),
      (p_target, v_fw, 'design', 'G3 — Build commitment', 1, 'gate', false, null),
      (p_target, v_fw, 'commissioning', 'G4 — Cutover readiness', 1, 'gate', false, null),
      (p_target, v_fw, 'operation', 'G5 — Stabilization exit', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Discovery review', 'The business problem and current-state workflow are documented', true,
       'Software that solves an undocumented problem solves a different one.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Architecture selection', 'Build, buy and configure options were compared with lifecycle cost', true,
       'The cheapest licence is rarely the cheapest system.', 10, 'business', 'CALCULATED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Architecture selection', 'Cyber-security requirements are stated for the selected architecture', true,
       'Security stated after selection is security bolted on.', 20, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Build commitment', 'Data migration scope and quality acceptance criteria are defined', true,
       'Bad data delivered on time is a failed migration on schedule.', 10, 'technical', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Build commitment', 'User acceptance criteria and the test plan are agreed', true,
       'Acceptance defined at the end is negotiation, not verification.', 20, 'quality', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Cutover readiness', 'A rollback plan exists and was rehearsed', true,
       'An unrehearsed rollback is a hope, not a plan.', 10, 'operations', 'TESTED', 'INDUSTRY_GUIDANCE'),
      ('G4 — Cutover readiness', 'The support model and access provisioning are in place for day one', true,
       'Day one without support converts users into testers.', 20, 'operations', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G5 — Stabilization exit', 'Adoption and benefit measures run against the approved expectation', true,
       'A system nobody uses realized nothing.', 10, 'value', 'MEASURED', 'INDUSTRY_GUIDANCE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  -- -------------------------------------------------------------------------
  -- 6. Exploration & Study Phase
  -- -------------------------------------------------------------------------
  if not exists (select 1 from project_frameworks
                 where organization_id = p_target
                   and name = 'Exploration & Study Phase') then
    insert into project_frameworks
      (organization_id, name, version, source, source_authority, status,
       project_classes, basis, created_at)
    values
      (p_target, 'Exploration & Study Phase', 1,
       'Generic study-phase archetype from public practice: a study is framed by the decision it will inform, screened consistently, and closed with a confidence-stated recommendation. A reference profile, not any organization''s authoritative methodology.',
       'INDUSTRY_GUIDANCE', 'draft',
       '["study","exploration","pre_feasibility"]'::jsonb,
       'Seeded as a DRAFT library archetype (D3.02). Adoption is this organization''s act; INDUSTRY_GUIDANCE/BEST_PRACTICE tier only.',
       now())
    returning id into v_fw;

    insert into project_framework_stages
      (organization_id, framework_id, stage_key, sequence, display_name, purpose)
    values
      (p_target, v_fw, 'need_identification', 1, 'Frame Study',
       'State the study question and the decision it will inform.'),
      (p_target, v_fw, 'options_analysis', 2, 'Evaluate',
       'Screen candidates consistently and classify data confidence.'),
      (p_target, v_fw, 'concept_selection', 3, 'Recommend',
       'Close with a recommendation that states its confidence.');

    insert into stage_gates
      (organization_id, framework_id, stage_key, name, sequence, decision_type,
       independent_assurance_required, readiness_threshold)
    values
      (p_target, v_fw, 'need_identification', 'G1 — Study framing', 1, 'gate', false, null),
      (p_target, v_fw, 'options_analysis', 'G2 — Screening', 1, 'gate', false, null),
      (p_target, v_fw, 'concept_selection', 'G3 — Recommendation', 1, 'gate', false, null);

    insert into stage_gate_criteria
      (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
       sort_order, category, evidence_type, source_authority)
    select p_target, g.stage_key, g.id, v.criterion, v.mandatory, v.guidance,
           v.sort_order, v.category, v.evidence_type, v.source_authority
    from stage_gates g
    join (values
      ('G1 — Study framing', 'The study question and the decision it will inform are stated', true,
       'A study that informs no decision is a report.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Screening', 'Screening criteria were applied consistently across candidates', true,
       'Inconsistent screens select the loudest candidate.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G2 — Screening', 'Data confidence for each candidate is classified', false,
       'A ranking without confidence classes is a guess in a table.', 20, 'technical', 'DOCUMENTED', 'BEST_PRACTICE'),
      ('G3 — Recommendation', 'The recommendation states its confidence and the work needed to raise it', true,
       'A study''s honest product is a confidence, not a certainty.', 10, 'business', 'DOCUMENTED', 'INDUSTRY_GUIDANCE'),
      ('G3 — Recommendation', 'Discarded candidates carry the reason for discarding them', false,
       'The next study starts where this one''s rejections are recorded.', 20, 'learning', 'DOCUMENTED', 'BEST_PRACTICE')
    ) as v(gate_name, criterion, mandatory, guidance, sort_order, category, evidence_type, source_authority)
      on v.gate_name = g.name
    where g.framework_id = v_fw;

    v_seeded := v_seeded + 1;
  end if;

  return v_seeded;
end
$$;

revoke all on function public.seed_governance_framework_library(uuid) from public, anon;
grant execute on function public.seed_governance_framework_library(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The tenant-facing verb ("select or seed"): an administrator re-stocks the
-- shelf for their OWN organization. Idempotent — profiles already present
-- (any version, any status) are left alone, so a tenant's adopted copy is
-- never disturbed. ai_admin is permitted: seeding DRAFTS is preparation,
-- adoption stays the human act adopt_project_framework guards.
-- ---------------------------------------------------------------------------
create or replace function public.seed_governance_framework_library()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_n int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error', 'seeding the framework library requires an executive or administrator');
  end if;

  v_n := seed_governance_framework_library(v_org);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('action', 'library_seeded', 'profiles_added', v_n));

  return jsonb_build_object('profiles_added', v_n,
    'note', 'Library profiles arrive as DRAFTS at INDUSTRY_GUIDANCE/BEST_PRACTICE tier. Nothing governs a case until an accountable person adopts it (adopt_project_framework).');
end
$$;

revoke all on function public.seed_governance_framework_library() from public, anon;
grant execute on function public.seed_governance_framework_library() to authenticated;

-- ---------------------------------------------------------------------------
-- Every existing organization receives the shelf now (drafts; idempotent).
-- ---------------------------------------------------------------------------
do $$
declare
  o record;
begin
  for o in select id from organizations loop
    perform seed_governance_framework_library(o.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
