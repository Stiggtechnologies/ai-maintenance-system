# Sync Develop — Asset Investment & Project Delivery Intelligence: source specification

> **PROVENANCE (read before citing).** This document is owner-supplied research synthesis,
> received 2026-08-27. Its inputs are: public Suncor sources and regulatory/sustainability
> filings (ADEM described as a five-stage-gate physical-asset development framework;
> OEMS transformed 2024–2025 toward Leadership/Planning/Scoping/Execution/Enabling with
> HOP principles), PMI's PMBOK® Guide Eighth Edition (Nov 2025: six principles, seven
> performance domains), ISO 31000, and internal SyncAI architecture work.
>
> Per the spec's own rule 1 (methodology provenance): nothing here may be encoded as an
> AUTHORITATIVE CORPORATE REQUIREMENT of Suncor or anyone else. Public-source ADEM detail
> is INDUSTRY_GUIDANCE / INFERRED at best. The product ships framework-as-data
> (ProjectFramework profiles); a real customer's gates are configured from that customer's
> authoritative documents, never assumed from this file. Do not market as "we digitized
> ADEM."
>
> Register: `docs/sync-develop/register.md` (D-family). Build plan:
> `docs/sync-develop/build-plan.md`. Overlap map: `docs/sync-develop/overlap-map.md`.

---

## PART I — Forty capability additions (from the ADEM × PMBOK 8 comparison)

The biggest finding: expand Sync Develop beyond a stage-gate application into a
project-and-asset value delivery system. Public Suncor material confirms ADEM has been
used as a structured physical-asset development framework with problem/opportunity
validation, strategic alignment, alternative generation and screening, stages/gates/
checkpoints, verification of safe/operable/maintainable design, and risk-based
governance; other public documentation describes it as an integrated five-stage gate
process. Suncor substantially transformed OEMS during 2024–2025 into a simpler
integrated framework (Leadership, Planning, Scoping, Execution, Enabling) supported by
Human and Organizational Performance principles; current public material does not expose
the modern internal ADEM gate structure, so Sync must not freeze to an old public ADEM
representation. PMBOK 8 (Nov 2025) centers on six principles — holistic view, value,
quality, accountable leadership, sustainability, empowered teams — and seven performance
domains: governance, scope, schedule, finance, stakeholders, resources, risk; it
emphasizes tailoring, AI, PMOs, procurement, and reintroduces initiating/planning/
executing/monitoring-controlling/closing.

### 1. Sync Tailor — the methodology compiler
The most important architectural addition. Rather than coding ADEM directly, profiles
(Suncor, Shell, Utility, Mining, Manufacturing, Customer-specific) feed a Sync Project
Governance Engine. Object: ProjectFramework — framework_id, framework_version,
organization, project_classes, stages, gates, checkpoints, deliverables, decision
authorities, assurance requirements, risk thresholds, lifecycle model, tailoring rules.
PMBOK 8 treats tailoring as core: select the development approach, tailor for the
organization, tailor for the project, improve continuously. Sync must be able to say:
"Project value $4.5M / Complexity Low / Brownfield risk Medium / Regulatory impact None
→ Light Sustainment: 3 gates instead of 5, 18 required deliverables instead of 63."
And for a $2B project: Major Project Governance, full assurance regime. Avoids
bureaucratic over-processing.

### 2. Risk-Based Governance Intensity
ADEM public documentation refers to risk-based governance; operationalize it.
GovernanceIntensity = f(Value, Risk, Complexity, Novelty, RegulatoryExposure,
Interfaces). Sync determines: required reviews, independent assurance level, approval
authority, documentation, risk-analysis depth, estimate maturity, commissioning
requirements. Better than rigid identical gates.

### 3. Project Success Contract
Every Development Case establishes success before design begins. ProjectSuccessContract:
business, safety, operational, reliability, availability, maintainability, quality,
schedule, cost, environmental, stakeholder outcomes; expected benefits. Example —
crusher replacement: not "Install Crusher 4 by October" but "Increase processing
capability 7%; Availability ≥ 96%; MTTR ≤ 6 h; zero additional permanent maintenance
headcount; OPEX ≤ $X/t; startup target within 45 days; lifecycle value ≥ $38M NPV."
The contract stays with the asset through commissioning.

### 4. Value Hypothesis Tracking
Make every project's economic hypothesis machine-readable: "We believe spending $28M
will eliminate 120 h/year downtime worth $11M/year." Sync tests it continuously:
Gate 1 $46M expected value → Gate 2 $41M → Gate 3 $29M → Execution $23M → Startup $18M
actual trajectory. If the business case collapses: Sync recommendation — reconsider
sanction. Stronger than conventional project controls.

### 5. Kill / Pivot / Pause intelligence
Projects have institutional momentum. Explicit gate decisions: PROCEED, PROCEED WITH
CONDITIONS, PIVOT, REDESIGN, PAUSE, RECYCLE, TERMINATE. Every gate asks: "If this
project were proposed today using what we now know, would we still fund it?" Prevents
sunk-cost thinking.

### 6. Scope Intelligence
PMBOK 8 gives scope its own performance domain. Model the complete scope architecture:
Business need → Requirement → System → WBS → Work package → Contract → Schedule
activity → Cost. Then Sync identifies: "14 schedule activities have no authorized
scope"; "Requirement R-184 does not appear in the WBS"; "$2.3M of current forecast is
associated with scope added after Gate 2."

### 7. Scope Creep Detection
AI + deterministic baselines. Sync reads RFIs, engineering changes, purchase orders,
meeting minutes, contractor correspondence, revised drawings; detects "emerging scope
appears to have changed without a corresponding approved change request." AI flags;
a human determines whether it constitutes scope change.

### 8. Project Controls Engine
Previously too light. Need: WBS, CBS, OBS, schedule, cost baseline, progress,
commitments, actuals, forecast, changes, contingency. Then CPI/SPI where appropriate,
earned value, earned schedule, EAC, VAC, cost trend, schedule trend, milestone
confidence, productivity, rules of credit.

### 9. Forecast Confidence, not just forecast
"Completion = May 17" is misleading without uncertainty. Present: deterministic
May 17, P50 May 24, P80 June 19, original sanction May 1. Cost: forecast $414M,
P50 $429M, P80 $471M. Executives then understand actual exposure.

### 10. Integrated Risk–Cost–Schedule simulation
Risks connect directly to schedule and cost: RISK (compressor delivery) → probability
distribution → Schedule Activity 5100 → mechanical completion → production startup →
NPV. Monte Carlo yields decision intelligence: not "Risk 37 = Red" but "Compressor
delivery currently contributes 17 days of P80 schedule exposure and $14.2M expected
economic exposure."

### 11. Finance Intelligence
PMBOK 8 has an explicit Finance Performance Domain. Understand: capital cost, operating
cost, lifecycle cost, NPV, IRR, payback, cash flow, escalation, contingency, economic
assumptions, foreign exchange, commodity sensitivity, funding constraints. And: what
changed economically since sanction?

### 12. Assumption Sensitivity
"Project only works economically if: production gain ≥ 5.2%; installed cost ≤ $84M;
availability ≥ 94%; oil price ≥ X." Sync watches these; when one changes: "Business
case threshold violated." Connects Assumption objects directly into project governance.

### 13. Quality Performance Engine
PMBOK 8 principle: embed quality into processes and deliverables. Beyond punchlists:
QualityRequirement, InspectionTestPlan, HoldPoint, WitnessPoint, NCR, Defect, Rework,
VendorQualityRecord, AcceptanceTest. Metrics: first-pass acceptance, NCR aging, rework
cost, weld rejection, vendor defect rate, inspection effectiveness, turnover package
quality.

### 14. Cost of Poor Quality
COPQ = Rework + Scrap + Retesting + Delay + Claims + StartupFailures. "$7.8M of current
forecast growth is attributable to quality failures rather than scope growth." That
distinction matters.

### 15. Contractor Quality Intelligence
Suncor's public project-risk disclosures mention dependency on contractors, vendors,
material/equipment availability, logistics, quality. Compare vendors across projects:
schedule reliability 87%, NCR rate 1.9%, engineering response 2.7 days, rework 0.8%,
warranty claims $1.4M. Future procurement gets evidence.

### 16. Procurement & Commercial Engine
PMBOK 8 expanded procurement. Objects: ProcurementPackage, Bidder, Bid,
TechnicalEvaluation, CommercialEvaluation, Contract, Commitment, ChangeOrder, Claim,
Invoice, Warranty. Connect: Specification → Bid → Contract → Vendor → Equipment →
Installed Asset → Failure History. Lifecycle commercial intelligence.

### 17. Contract Strategy Recommendation
Before tender: lump sum / unit rate / EPC / EPCM / alliance / owner-executed /
performance contract. Evaluate: definition maturity, uncertainty, market conditions,
owner capability, interface complexity, risk allocation. AI recommends; humans decide.

### 18. Stakeholder & Commitment Intelligence
PMBOK gives stakeholders their own domain; Suncor publicly described ADEM as
incorporating stakeholder and Indigenous/community considerations during early planning.
StakeholderCommitment: stakeholder, concern, commitment, project requirement, owner,
due date, evidence. Then: "Community commitment C-42 has no corresponding project
requirement." Prevents significant failures.

### 19. Regulatory Approval Critical Path
Permits out of spreadsheets: RegulatoryRequirement → Application → Information request
→ Approval → Conditions → Project requirement. Approval conditions connect into
engineering, construction, operating procedures, monitoring, reporting.

### 20. Sustainability by Design
PMBOK 8: Integrate Sustainability Within All Project Areas. Suncor publicly described
ADEM as considering environmental/social risks, sustainability during concept selection,
and climate implications early enough to influence investment decisions. Every option
comparison includes: CAPEX, OPEX, safety, reliability, carbon, energy, water, land,
waste, social effect, climate resilience — at concept selection, not after-the-fact.

### 21. Climate Resilience Engineering
Different from carbon accounting. Will the asset perform under future environmental
conditions? Evaluate extreme temperature, wildfire, flood, precipitation, water
availability, freeze/thaw, permafrost, storm severity. A 40-year asset should not be
designed only for historical conditions.

### 22. Resources Performance Engine
PMBOK Resources domain. ResourceDemand vs ResourceCapacity across engineering, PM,
skilled trades, inspectors, commissioning, cranes, specialty tools, facilities,
suppliers. Then: "All six projects are individually executable — collectively
impossible because all six require the same commissioning team in Q3." Portfolio-level
intelligence.

### 23. Competency Readiness
Suncor's OEMS emphasizes competence, clearer accountabilities, frontline participation,
training. Check required competency vs available, training requirement, certification,
experience. Readiness is not "14 people available" but "14 qualified people available
when needed."

### 24. Human and Organizational Performance (Sync HOP)
Suncor's transformed OEMS is underpinned by HOP with frontline learning. Not worker
surveillance. Analyze: task complexity, conflicting procedures, excessive handoffs,
decision delays, workarounds, repeat deviations, overloaded roles, unclear authority,
error-provoking conditions. Ask "What about the system made this error likely?" rather
than "Who made the error?" Valuable for projects and maintenance.

### 25. Frontline Design Review
PMBOK empowered teams; Suncor frontline involvement. Require maintenance/operators/
constructors to review accessibility, isolation, lifting, inspection, lubrication,
ergonomics, removal routes, emergency response. Capture accepted recommendation /
rejected recommendation / reason. Accountability for maintainability decisions.

### 26. Constructability and Operability scoring
Formalize: Design Readiness, Constructability, Operability, Maintainability,
Reliability, Commissionability. A design can be technically correct and score poorly
on any of these.

### 27. Execution Readiness
Aligns with OEMS Planning/Scoping/Execution. Before a work package is released:
drawing ✓, material ✓, crew ✓, permit ✓, access ✕, scaffold ✕, inspection ✓ →
NOT READY. Construction should not start merely to create reported progress.

### 28. Constraint Burn-Down
For every future work package: constraint, owner, required-by date, probability of
clearance, schedule impact. Then: "63% of next month's planned construction is
constraint-free." A leading indicator of execution performance.

### 29. Project Flow Efficiency
FlowEfficiency = ActiveValueAddingTime / TotalElapsedTime. A design package might spend
10 hours in engineering and 18 days waiting for review — the bottleneck is decision
flow, not engineering productivity.

### 30. Decision Latency
DecisionLatency = t_Decision − t_DecisionRequired. "Engineering decisions account for
11.7 days of current critical-path exposure." Combines PMBOK governance with HOP.

### 31. PMO Intelligence (Sync PMO)
PMBOK 8 expanded PMO discussion with a dedicated appendix. Methodology governance,
framework tailoring, gate calibration, portfolio health, resource conflicts,
benchmarking, performance trends, lessons, assurance, value realization. Not another
dashboard: "Which projects require management intervention today, and why?"

### 32. Pattern-based Project Assurance
With history: "Projects entering execution with <80% engineering maturity have
historically experienced 24% greater schedule growth." "Projects with unresolved vendor
data at Gate X have 3.1× more commissioning defects." Predictive project assurance —
defensible IP.

### 33. Reference-Class Forecasting
"Similar 17 brownfield compressor projects: median cost growth 12%, P80 27%, median
startup delay 16 days. Project team forecast +3% — appears optimistic relative to
reference class." Anti-bias mechanism.

### 34. Project Benchmarking Without Bad Comparisons
Normalize for size, complexity, brownfield/greenfield, geography, project class,
technology novelty, execution strategy. Compare engineering productivity, cost growth,
schedule growth, startup performance, safety, reliability after startup.

### 35. Lifecycle Project Success
Suncor publicly describes project risk across development, engineering, construction,
commissioning/startup — including failure to achieve operating-cost, efficiency, yield,
maintenance-cost targets. Success extends past construction: development, engineering,
construction, commissioning, ramp-up, operational, benefits success. On-budget but
unreliable = not successful.

### 36. Operational Performance Warranty
Every project carries an internal outcome commitment. At 30/90/180/365 days compare
design vs actual: throughput, availability, reliability, maintenance cost, energy,
quality, operating cost. Closes the project-to-operations accountability gap.

### 37. Project FRACAS
Asset FRACAS exists; create Project FRACAS. Failures: bad estimate, late design, poor
vendor data, construction rework, interface failure, commissioning defect, startup
failure, benefit shortfall. Failure → Cause → Corrective Action → Standard Changed →
Future Projects Screened. Sync improves the delivery system itself.

### 38. Standard Work Learning
Suncor's transformed OEMS aims to reduce site-to-site variation, clarify standard work,
institutionalize improvements. STANDARD → ACTUAL EXECUTION → VARIATION → OUTCOME →
LEARNING → IMPROVED STANDARD.

### 39. Knowledge Reuse at Project Start
Creating "797 shop expansion" auto-retrieves similar projects, previous estimates,
lessons, risks, vendor performance, construction productivity, startup problems,
operational reliability: "Here are 37 lessons that apply before you spend the first
engineering dollar." Possibly the most valuable AI experience available.

### 40. Hybrid Development
PMBOK 8 recognizes predictive, adaptive, hybrid. Civil construction → predictive; AI
control optimization → iterative; operator UI → adaptive; digital twin → iterative;
physical installation → predictive. Different workstreams use different delivery
methods inside one Development Case.

### The eight engines
Sync Develop = Asset Investment & Project Delivery Intelligence with: 1 Frame (problem,
opportunity, strategy, options), 2 Value (business case, economics, benefits,
assumptions), 3 Govern (framework, tailoring, gates, decisions, assurance), 4 Design
(requirements, interfaces, RAM, constructability, quality), 5 Control (scope, cost,
schedule, risk, resources, change), 6 Deliver (procurement, contractors, construction,
constraint removal), 7 Ready (commissioning, operational readiness, handover),
8 Realize (ramp-up, benefits, reliability, learning). Surrounding everything: Risk +
Quality + Sustainability + HOP + Stakeholders + Evidence + AI.

Positioning: not "we digitized ADEM." SyncAI ingests and operationalizes an
organization's existing framework — ADEM, PMBOK-based, proprietary stage-gate, other —
and augments it with continuous assurance, project intelligence, lifecycle reliability,
organizational learning. ADEM contributes industrial asset discipline; PMBOK modern PM
breadth; ISO 31000 risk governance; RAM asset-performance assurance; SyncAI connects
all four into one continuously learning system.

---

## PART II — Twenty-five enterprise-grade layers ("did we miss anything?")

Core themes captured: stage-gated development, cross-functional teams, up-front problem
framing, lifecycle thinking, disciplined transition to operations. Remaining gaps are
execution integrity and trust. Sync cannot just digitize a methodology; it must govern
how methodology, evidence, project data and execution connect.

### II.1 Methodology provenance
Every ingested requirement tagged: AUTHORITATIVE CORPORATE REQUIREMENT / REGULATORY
REQUIREMENT / INDUSTRY STANDARD / GUIDANCE / BEST PRACTICE / CUSTOMER-CONFIGURED RULE /
INFERRED REQUIREMENT / AI SUGGESTION. Sync must never turn "this appears to be Suncor
practice" into "this is a mandatory Suncor gate requirement." Becomes a Methodology
Evidence Layer.

### II.2 Common Data Environment / digital thread
Every project object in one traceable thread: Requirement → Tag → Equipment
specification → Vendor document → Drawing → Procurement item → Installed equipment →
Commissioning test → SAP equipment → Operating history. Sync knows: current
authoritative version, what changed, what downstream object is affected, has the
operating system received the change. Critical for tags, P&IDs, equipment lists, BOMs,
vendor data, control narratives, asset master data, inspection data, as-builts. One of
Sync's strongest potential differentiators.

### II.3 Information readiness
Separate physical from information readiness. Physical asset 98% complete; information
readiness 71% — missing 42 equipment BOMs, 8 final vendor manuals, 13 as-built
drawings, 3 PM strategies, 22 material masters, 6 commissioning records. A project is
not finished when the equipment exists but the information needed to operate and
maintain it does not.

### II.4 Advanced Work Packaging
ENGINEERING WP → PROCUREMENT WP → CONSTRUCTION WP → INSTALLATION WP → FIELD EXECUTION.
Sync evaluates whether each package is constraint-free. IWP 214: engineering ✓,
materials ✓, scaffolding ✕, crane ✓, permit ✓, predecessor ✕ → NOT READY TO EXECUTE.
Connects Sync Develop to Sync Recovery execution intelligence.

### II.5 Workface planning
Below the project schedule: field crews need exactly what can be executed tomorrow.
Field-ready packages: scope, drawings, materials, tools, permits, access, labor, QA
hold points, predecessor completion, safety constraints. Measure Planned-work-ready %
and Ready-work-executed %. Prevents busy work when critical work is not ready.

### II.6 Schedule quality assurance
Detect: missing logic, open ends, excessive constraints, long-duration activities,
negative float, unrealistic lags, broken critical paths, excessive concurrency,
unrealistic calendars. Schedule Confidence Score. Monte Carlo on poor logic is not
useful.

### II.7 Estimate quality assurance
What estimate class? Scope maturity? % quantity-based vs factored? Supporting
quotations? Escalation and productivity assumptions? Exclusions? Contingency basis?
Then: forecast $284M, estimate confidence LOW. The distinction is crucial.

### II.8 Contingency governance
Not an invisible slush fund. Contingency: original amount, basis, risk event, drawdown,
approving authority, remaining. "$18M consumed: $7M scope maturation, $4M market
escalation, $3M construction productivity, $4M realized risk."

### II.9 Progress integrity
Cross-check claimed progress against drawings issued, deliverables approved, quantities
complete, procurement releases, field installation, inspection records. "Contractor
reports engineering 92% complete; only 71% of IFC deliverables accepted → progress
confidence LOW."

### II.10 Operating Model Readiness
Beyond PMs/spares/manuals: organization structure, staffing, competencies, shift model,
maintenance strategy, supply chain, contractors, warehouse, engineering support,
operations procedures, emergency response, IT/OT support, budget. A perfectly
commissioned asset can fail at startup because the organization is not ready.

### II.11 Site change saturation
One facility simultaneously: three sustaining projects, turnaround prep, maintenance
backlog, control-system upgrade, restructure. Individually acceptable; together
overwhelming. Change Load Index across projects, outages, MOCs, training, operational
changes, maintenance burden, workforce capacity. "Site change capacity is projected to
exceed available absorption capacity in Q3."

### II.12 Operational disruption modeling
Brownfield projects affect the operating asset during construction. ProjectValue −
ConstructionDisruption − ProductionLoss − SIMOPSRisk. Option A cheaper construction but
four outages; Option B higher cost, one outage — lifecycle decision may favor B.

### II.13 OT cybersecurity by design
PLCs, DCS, instrumentation, sensors, remote monitoring, autonomous equipment, networked
machinery: cyber requirements at design, not after commissioning. Track cyber
requirement, architecture review, segmentation, remote access, vendor access, firmware,
patchability, backup, recovery, cyber acceptance test. Part of gate readiness.

### II.14 Digital asset maintainability
Assets increasingly fail because of software. Extend RAM beyond physical: firmware,
software version, dependencies, licenses, patches, vendor support horizon, backup,
restore procedures, configuration files. The asset handed to operations is physical +
digital.

### II.15 Independent assurance governance
AssuranceReview: required independence level, reviewer, reviewer competency, conflicts
of interest, findings, conditions, approval. A PM must not independently assure their
own project. Sync enforces separation.

### II.16 Conditions and waivers
GO WITH CONDITIONS: every condition has owner, due date, evidence, consequence if
missed. WAIVER / DEVIATION / EXCEPTION: justification, approver, risk assessment,
expiry. Temporary exceptions must not quietly become permanent design decisions.

### II.17 Decision debt
Every postponed decision creates future cost. DecisionDebt = FutureExpectedImpact ×
ProbabilityOfDelay. "You currently have 14 unresolved decisions capable of affecting
the critical path."

### II.18 Technical debt
Projects knowingly hand over imperfect solutions: temporary bypass, manual operation,
temporary supports, incomplete monitoring, deferred redesign. TechnicalDebt: origin,
reason, current risk, lifecycle cost, owner, required resolution. Otherwise operations
inherits invisible liabilities.

### II.19 Project debt to operations (Operational Debt)
Everything transferred incomplete: punch items, temporary repairs, workarounds, missing
spares, missing PMs, documentation gaps, training gaps, software gaps, reliability
defects. "At handover: Operational Debt = $4.6M lifecycle exposure." Changes project
accountability.

### II.20 Program-level architecture
PROGRAM → PROJECTS → SHARED OUTCOME. Mine expansion program contains haul-road,
crusher, power, shop expansion, fleet purchase, automation. A project can succeed
individually while the program fails.

### II.21 Dependency across projects
Cross-project critical path. "Project 148 appears green — but depends on Project 121,
six months late. Enterprise forecast: RED."

### II.22 Portfolio decision optimization
"Where should we invest the next $500M?" Compare regulatory necessity, safety risk,
production benefit, reliability, NPV, asset life, sustainability, resource demand,
execution risk. Efficient frontier, not a simple ranking.

### II.23 Benefits interdependency
Avoid double counting. Projects A and B each claim +5% throughput; the bottleneck
permits +6%. "Potential benefits double counting." Subtle, extremely valuable.

### II.24 Explicit value leakage analysis
Original $100M → design $95M → sanction $90M → execution forecast $82M → startup $71M →
realized $64M. Attribute the $36M: scope compromise −$8M, schedule delay −$7M, cost
growth −$9M, reliability loss −$5M, ramp-up delay −$7M. Powerful executive capability.

### II.25 Methodology learning
If gate requirement X has no relationship with outcomes, simplify it. If projects
missing requirement Y consistently fail, strengthen it. METHOD → EXECUTION → OUTCOMES →
ANALYSIS → IMPROVED METHOD. Sync becomes more than project software.

### Five additional engines
- **Sync Information** — digital thread, documentation, asset-data readiness.
- **Sync Field** — work packaging, workface planning, constraints, execution readiness.
- **Sync Assurance** — estimate quality, schedule quality, progress integrity,
  independent challenge.
- **Sync Transition** — operating-model readiness, operational debt, startup
  stabilization.
- **Sync Portfolio** — programs, interdependencies, capital allocation, benefit
  optimization.

Complete lifecycle: Frame → Select → Define → Assure → Sanction → Engineer → Procure →
Build → Commission → Handover → Stabilize → Realize → Learn. Underneath every stage:
Objective + Value + Risk + Evidence + Decision + Configuration + Work + Outcome.

The main risk is trying to build all of it at once. Next step: define the minimum
viable Sync Develop — the 10–15 capabilities producing the fastest measurable value for
a Suncor-like customer — with the rest on the roadmap.

---

## PART III — Product architecture and data model

Key design decision: SyncAI is not an ADEM clone, a PMBOK tool, or a CMMS replacement.
It is a configurable asset-investment, project-delivery, risk, and operational-readiness
intelligence layer. A Suncor-style ADEM configuration is one methodology profile.
Exact internal gate rules are configured from authoritative customer documents, never
assumed from public material. ISO 31000 supplies the risk spine: context and criteria →
identification → analysis → evaluation → treatment → monitoring/review, with
communication and recording throughout.

### Target architecture (layers)
EXPERIENCE (Executive | PM | Engineer | Ops | Maintenance | Assurance) → DECISION &
WORKFLOW (Opportunity → Gate → Design → Execute → Ready → Realize) → INTELLIGENCE
ENGINES (Risk | Value | Controls | Schedule | Cost | RAM | Change | Readiness |
Handover | Benefits | Learning | Recovery) → GOVERNANCE (Methodology | Authority |
Policy | Assurance | Audit) → ENTERPRISE KNOWLEDGE GRAPH (Objective ↔ Requirement ↔
Risk ↔ Decision ↔ Asset ↔ Work) → ENTERPRISE DATA (SAP | Maximo | P6 | ERP | DMS |
Historian | GIS | APM) → TRUST & SECURITY (IAM | Provenance | Model Registry | Audit |
Cyber). The LLM sits inside the Intelligence layer. It is not the architecture.

### §1 Product modules
Sync Frame (business need, opportunity, framing, alternatives); Sync Value (business
case, lifecycle economics, assumptions, benefits); Sync Govern (methodologies, stages,
gates, authorities, assurance); Sync Risk (ISO 31000 risk and controls); Sync Design
(requirements, interfaces, RAM, maintainability, configuration); Sync Control (cost,
schedule, scope, change, forecast, project controls); Sync Supply (procurement,
vendors, contracts, long-lead risk); Sync Field (AWP, constraints, field readiness);
Sync Ready (commissioning and operational readiness); Sync Handover (configurable
handover); Sync Reliability (RAM, RCM, FMEA, life data, reliability growth); Sync
Recovery (live downtime-event orchestration); Sync Realize (benefits realization,
operating-performance validation); Sync Learn (FRACAS, project FRACAS, lessons,
standards improvement); Sync Portfolio (programs, capital allocation, shared resources,
dependencies). One shared data model supports all.

### §2–§33 Canonical objects (fields as specified)
- **Organization**: id, name, type, jurisdiction, parent_id, governance_profile_id.
  Enterprise → BU → Site → Area → System.
- **Objective**: id, parent_objective_id, owner_id, organizational_level, description,
  target, unit, target_date, tolerance, status. Risk always links to an objective.
- **DevelopmentCase** (§3, primary object): id, title, sponsor_id, business_unit_id,
  site_id, current_stage_id, framework_id, lifecycle_type, problem_statement,
  opportunity_statement, estimated_capex, expected_value, status, created_at.
  Lifecycle types: GREENFIELD, BROWNFIELD, SUSTAINING_CAPITAL, REPLACEMENT,
  RELIABILITY_IMPROVEMENT, REGULATORY, CAPACITY, LIFE_EXTENSION, DECOMMISSIONING.
- **ProjectFramework** (§4): id, organization_id, name, version, source,
  effective_date, status. HAS Stage[] HAS Gate[] HAS Requirement[]. Examples: Suncor
  ADEM, Corporate Major Projects Model, Light Sustaining Capital, PMBOK-derived,
  Utility Capital Governance.
- **Stage** (§5): id, framework_id, sequence, name, purpose, entry_criteria,
  exit_criteria. Configurable naming (Opportunity, Concept, Definition, Execution,
  Commissioning, Closeout, Benefits). Do not hard-code.
- **Gate** (§6): id, stage_id, name, sequence, decision_type, risk_threshold,
  readiness_threshold, independent_assurance_required. Decisions: PROCEED,
  PROCEED_WITH_CONDITIONS, HOLD, RECYCLE, PIVOT, TERMINATE.
- **GateRequirement** (§7): id, gate_id, category, description, mandatory,
  evidence_type, minimum_confidence, source_authority. Source authorities: LAW,
  REGULATION, CORPORATE_STANDARD, PROJECT_FRAMEWORK, CONTRACT, INDUSTRY_GUIDANCE,
  BEST_PRACTICE, AI_SUGGESTION. Prevents Sync inventing corporate requirements.
- **Deliverable** (§8): id, development_case_id, requirement_id, type, owner_id,
  revision, status, required_date, accepted_date, source_system, document_id.
- **Evidence** (§9): id, type, source, source_system, document_id, timestamp,
  revision, quality, applicability, verification_status, provenance. Classes:
  MEASURED, INSPECTED, CALCULATED, TESTED, DOCUMENTED, HISTORICAL, EXPERT_JUDGEMENT,
  AI_INFERENCE. An AI inference must never silently become verified evidence.
- **Requirement** (§10): id, development_case_id, parent_requirement_id, source,
  category, description, owner_id, verification_method, acceptance_criteria, status.
  Categories: FUNCTIONAL, PERFORMANCE, SAFETY, RELIABILITY, AVAILABILITY,
  MAINTAINABILITY, ENVIRONMENTAL, CYBER, REGULATORY, OPERABILITY, QUALITY.
  Traceability: Objective → Requirement → Design Object → Procurement Specification →
  Installed Asset → Commissioning Test → Operating KPI.
- **Verification** (§11): id, requirement_id, method, procedure, acceptance_criteria,
  result, evidence_id, status, verified_by, verified_at. Methods: ANALYSIS,
  INSPECTION, DEMONSTRATION, TEST, OPERATIONAL_VALIDATION.
- **Risk** (§12, ISO 31000): id, objective_id, owner_id, title, source, event,
  likelihood, consequence, uncertainty, confidence, current_risk, residual_risk,
  target_risk, review_date, status.
- **Control** (§13): id, risk_id, owner_id, type, description, intended_effect,
  verification_method, criticality, current_effectiveness.
- **ControlAssessment** (§14): id, control_id, assessed_at, assessor_id,
  design_effectiveness, operating_effectiveness, confidence, evidence_id.
  Distinguishes "control exists" from "control works."
- **Treatment** (§15): id, risk_id, owner_id, strategy, expected_reduction, cost,
  expected_benefit, new_risk_created, due_date, status.
- **Decision** (§16, possibly the most strategically valuable object): id,
  development_case_id, objective_id, decision_question, owner_id,
  decision_required_date, selected_option_id, rationale, status, approval_level,
  decision_date. Connects to Options, Risks, Evidence, Assumptions, Requirements,
  Approvals, Outcomes. "Why did we select Vendor B?" — reconstructible years later.
- **DecisionOption** (§17): id, decision_id, description, capex, opex, lifecycle_cost,
  schedule_effect, risk_effect, reliability_effect, environmental_effect,
  expected_value.
- **Assumption** (§18): id, statement, owner_id, valid_from, valid_until, confidence,
  status. Links Decision, Business Case, Risk, Estimate, Schedule. Invalidated
  assumption automatically reopens dependent decisions.
- **Interface** (§19, critical brownfield): id, development_case_id, source_object,
  target_object, interface_type, owner_id, requirement, due_date, status. Types:
  PHYSICAL, PROCESS, ELECTRICAL, CONTROL, DATA, ORGANIZATIONAL, CONTRACTUAL.
- **Baseline** (§20): id, development_case_id, type, version, approved_at,
  approved_by. Types: SCOPE, COST, SCHEDULE, DESIGN, RISK, BENEFITS.
- **Change** (§21): id, baseline_id, proposed_change, reason, requester,
  technical_effect, cost_effect, schedule_effect, risk_effect, status. Propagation:
  Change → Requirements → Drawings → Procurement → Schedule → Cost → Risk → PM
  strategy → Commissioning.
- **ScheduleActivity** (§22): id, project_id, external_id, WBS_id, description,
  duration, start, finish, predecessors[], successors[], calendar,
  resource_requirements[]. P6 or equivalent remains system-of-record; Sync analyzes.
- **CostItem** (§23): id, project_id, CBS_code, WBS_id, baseline_cost, commitment,
  actual, forecast, contingency.
- **Contract** (§24): id, supplier_id, development_case_id, contract_type, value,
  scope, start, completion, performance_requirements, warranty_terms.
- **ProcurementPackage** (§25): id, project_id, equipment_or_scope, required_date,
  supplier_id, technical_status, commercial_status, manufacturing_status,
  delivery_status.
- **Asset** (§26): id, enterprise_asset_id, tag, functional_location, type,
  manufacturer, model, serial_number, criticality, lifecycle_status. DesignObject →
  ProcuredEquipment → InstalledAsset → SAP Equipment: the digital thread must never
  break.
- **WorkPackage** (§27): id, project_id, type, area, scope, required_by, status.
  Types: ENGINEERING, PROCUREMENT, CONSTRUCTION, INSTALLATION, COMMISSIONING.
- **Constraint** (§28): id, work_package_id, type, owner_id, required_by, status,
  expected_clear_date. Types: DRAWING, MATERIAL, ACCESS, LABOUR, CRANE, PERMIT,
  ISOLATION, SCAFFOLD, PREDECESSOR, INSPECTION.
- **Commissioning objects** (§29): CommissioningSystem, CommissioningSubsystem,
  TestPackage, CommissioningProcedure, CommissioningResult. State machine:
  CONSTRUCTION_COMPLETE → MECHANICAL_COMPLETE → READY_FOR_ENERGIZATION →
  PRECOMMISSIONED → COMMISSIONED → PERFORMANCE_VERIFIED → ACCEPTED.
- **OperationalReadinessItem** (§30): id, system_id, category, owner_id,
  required_before, status, evidence. Categories: asset master, BOM, spares, PM, task
  list, procedure, training, inspection, condition monitoring, vendor support,
  documentation, cyber, emergency response.
- **HandoverPackage** (§31): id, system_id, owner_from, owner_to,
  required_acceptance_date, physical_readiness, information_readiness,
  operational_readiness, residual_risks[], accepted_at.
- **Benefit** (§32): id, objective_id, owner_id, expected_value, expected_date,
  realized_value, confidence, status. Every project needs a benefit owner.
- **Lesson / FRACAS object** (§33): id, source_project, source_event, failure_mode,
  cause, corrective_action, applicability, status. Future projects auto-screened
  against applicable lessons.

### §34 Core graph relationships
Objective SUPPORTS Objective; Risk THREATENS Objective; Requirement SUPPORTS Objective;
Control MODIFIES Risk; Treatment MODIFIES Risk; Decision SELECTS Option; Decision USES
Evidence; Decision DEPENDS_ON Assumption; Requirement VERIFIED_BY Verification;
Requirement IMPLEMENTED_BY DesignObject; DesignObject BECOMES Asset; Change MODIFIES
Baseline; Change IMPACTS Requirement; WorkPackage DEPENDS_ON Constraint; Contract
PROVIDES Asset; Asset SUPPORTS Objective; Benefit MEASURES Objective; Failure
RELATES_TO Asset; Lesson APPLIES_TO AssetClass.

### §35–§40 Workflows
1. **Opportunity to sanction**: Problem/Opportunity → Objective → Context →
   Alternatives → Initial Risk → Value Assessment → Concept Selection → Requirements →
   Gate Readiness → Independent Assurance → Decision. Sync never begins with "Create
   Project"; it begins with "What problem are we solving?"
2. **Gate review**: Gate approaching → check requirements → retrieve evidence →
   assess evidence quality → unresolved risks → required approvals → cost/schedule
   confidence → assurance brief → independent review → gate decision. The AI cannot
   pass the gate.
3. **Change control**: Proposed change → identify baseline → dependencies → impacts →
   risk reassessment → cost/schedule impact → required authority → decision →
   propagate approved change.
4. **Execution readiness**: Work package → check engineering, materials, labour,
   access, permit, predecessor, quality → READY / NOT READY. A schedule activity being
   due does not make work executable.
5. **Operational readiness** (begins during design): system definition → asset
   hierarchy → maintenance requirements → spares → training → procedures →
   commissioning → readiness assessment → operations acceptance.
6. **Benefits realization**: expected benefit → design target → commissioning result →
   30/90/180-day and 12-month results. Expected vs actual.

### §41–§43 Permissions
RBAC + ABAC. Roles: PM, Engineer, Planner, Operations, Maintenance, Reliability,
Finance, Procurement, Assurance, Executive. Attributes: site, BU, risk level, asset
criticality, project value, jurisdiction, competency, authority level. Example: a
Maintenance Manager approves operational readiness items but not >$25M sanction nor
major process-safety risk acceptance.
Segregation of duties (§42): AUTHOR ≠ INDEPENDENT ASSURER; REQUESTER ≠ FINAL APPROVER;
CONTRACTOR ≠ OWNER ACCEPTANCE; TREATMENT OWNER ≠ RISK ACCEPTOR where policy requires.
AuthorityRule (§43): action_type, organizational_level, maximum_value, maximum_risk,
required_competency, required_roles. E.g. HIGH risk acceptance → GM; >$100M sanction →
Executive Committee; regulatory variance → Engineering Authority + Compliance.

### §44 Main screens
My Decisions (decision, project, value at stake, risk, due, recommendation,
confidence); Development Portfolio (project, stage, next gate, gate readiness, cost
forecast, schedule forecast, risk, operational readiness, benefit forecast);
Development Case Workspace (objective, business case, options, risks, requirements,
decisions, deliverables, schedule, cost, actions on one page); Gate Readiness (81%
overall with per-category: business 95, technical 88, risk 76, cost/schedule 83,
operations 64, supply 92, regulatory 100 — plus 7 blockers); Assurance Case (claim,
evidence, confidence, open issues, assumptions, independent review — e.g. "Facility
can meet 97.5% availability"); Decision Workspace (options A/B/C × CAPEX, OPEX, risk,
schedule, RAM, value, sustainability; recommended option; evidence; assumptions;
required approval); Integrated Controls (scope, schedule, cost, risk, change,
procurement in one coherent view); Execution Readiness (work package, ready?, missing
constraints, schedule impact, owner); Operational Readiness (system × physical,
information, maintenance, operations, training, spares, regulatory); Handover (system,
commissioning, punchlist, as-built, asset data, residual risk, operations acceptance);
Benefits (benefit, expected, current forecast, actual, variance, owner).

### §45–§55 Calculations
- **Gate Readiness** (§45): GR = Σ(w_i·r_i)/Σw_i, BUT any mandatory requirement FAIL →
  Gate BLOCKED. 97% readiness cannot hide an unresolved mandatory safety issue.
- **Evidence Confidence** (§46): EC = Q × A × F × V (quality, applicability, freshness,
  verification). Configurable weights — do not pretend universal science.
- **Information Readiness Index** (§47): accepted required information objects /
  required information objects; regulatory/safety-critical items are hard blockers.
- **Operational Readiness Index** (§48): f(People, Procedures, AssetData, Maintenance,
  Spares, Training, Operations, Safety, Cyber) — weighted plus hard conditions.
- **Constraint-Free Work Index** (§49): ready planned work packages / planned work
  packages. Leading indicator.
- **Schedule Quality Score** (§50): logic completeness, open ends, constraints,
  duration quality, critical-path continuity, calendar consistency. No Monte Carlo on
  a poor schedule without warning.
- **Forecast confidence** (§51): cost — deterministic, P50, P80, confidence;
  schedule — current, P50, P80 dates, critical drivers.
- **Value realization** (§52): VR = RealizedBenefit / ApprovedExpectedBenefit.
- **Value leakage** (§53): ApprovedValue − RealizedValue, attributed to scope, cost,
  schedule, reliability, ramp-up, operating cost, market assumption.
- **Decision latency** (§54): DL = DecisionDate − DecisionRequiredDate; show
  critical-path impact of delayed decisions.
- **Project Success** (§55): f(Safety, Value, Quality, Schedule, Cost, RAM,
  Operations, Stakeholders) — never merely on-time + on-budget.

### §56–§69 AI agents
Methodology Agent (ingests framework docs → proposes stages/gates/requirements/
authority maps; human-approved); Evidence Agent (retrieves and answers "what evidence
supports this claim?"); Gate Agent (continuously evaluates readiness and blockers;
cannot approve); Requirements Agent (missing/unverified/orphan/inconsistent — "14
requirements have no verification method"); Change Impact Agent (graph traversal:
changing pump P-102 affects power study, foundation, P&ID, HAZOP, BOM, PM, spares,
commissioning); Project Controls Agent (cost/schedule trends, scope movement, progress
anomalies — "engineering reported 91% complete but only 74% IFC accepted"); Risk Agent
(ISO 31000 workflow support; recommends, never accepts high-consequence risk); RAM
Agent (FMEA, RBD, Weibull, maintainability, availability, life data, reliability
growth, PM strategy); Operational Readiness Agent ("could operations take ownership
tomorrow?"); Handover Agent (builds acceptance package; checks commissioning, residual
risk, punchlist, documentation, asset data, readiness); Benefits Agent ("did we get
what we paid for?"); Lessons Agent (compares new projects with history — "23
applicable lessons identified"); Governance Agent (authority, competency, separation
of duty, thresholds, policy, expired waivers, unapproved deviations — one of the most
important); HOP Agent (decision bottlenecks, unclear responsibility, excessive
handoffs, repeated workarounds, conflicting procedures, overload; not surveillance).

### §70 What must remain deterministic
The LLM never determines: gate passed, risk accepted, regulation satisfied, safety
barrier adequate, project sanctioned, equipment safe to start, contract legally
compliant. Rules engines, validated calculations, authorized humans. AI explains,
detects, prepares.

### §71–§78 Technical platform
Hybrid persistence: PostgreSQL for authoritative transactional objects (Project, Gate,
Decision, Risk, Action, Approval); graph capability for relationships (requirements,
dependencies, assets, risks, controls, changes, evidence); object storage for
documents; vector index for semantic retrieval; time-series for condition/operational
data; event bus (GateRequirementChanged, RiskThresholdExceeded, ScheduleUpdated,
WorkPackageBlocked, CommissioningTestFailed). Real workflow engine for approval, gate
review, change control, risk acceptance, handover — serious governance is not
implemented through LLM prompts. Rules engine for gate blocking, authority, risk
escalation, mandatory evidence, jurisdiction, classification (e.g. IF value > $100M
AND risk ≥ HIGH THEN independent assurance + executive approval). Calculation service
(cost forecasting, schedule calcs, Monte Carlo, Weibull, availability, lifecycle
economics, risk models) — every calculation records method, version, inputs, outputs,
timestamp. Model registry (version, purpose, training data, validation, applicability,
limitations, approval — a new model version must not silently change critical
decisions). Audit ledger — who/what/when/why/source/previous/new/approval; never
overwrite decision history. Integration philosophy (§77): Sync is system of
intelligence + governance, not system of record for everything — SAP stays
transactions, P6 stays scheduling, DMS stays controlled documents; Sync connects them.
Initial integrations (§78): SAP EAM/PM, Primavera P6, document repository, cost/ERP,
project risk register, asset hierarchy, procurement status.

### §79 MVP — first 90 days
Twelve capabilities: Development Case; Framework/Stage/Gate; Gate Requirements;
Deliverables; Evidence; Risk; Decision; Actions; Baselines; Gate Readiness;
Operational Readiness; AI Evidence/Gap Agent. Connect document repository, P6, SAP.

### §80–§82 First customer experiences
PM: "Gate 3 — Readiness 74%. Mandatory blockers: 4. (1) Availability requirement
unsupported. (2) Long-lead compressor bid expired. (3) Four HAZOP actions unresolved.
(4) Maintenance BOM readiness only 61%. Projected gate date at current closure rate:
October 14."
Operations Manager: "Operational Readiness 68% — asset hierarchy 95, BOM 64, PM 72,
spares 51, training 83, documentation 88, regulatory 100. 12 safety/mission-critical
readiness items remain" — visibility months before handover.
Executive: "Approved $340M; forecast $397M; expected benefit $82M/yr → $69M/yr; P80
completion +3.7 months; major risk compressor delivery; lifecycle NPV down 18%. Does
this project still deserve the next dollar?" — the real value proposition.

### §83–§85 Expansion and moat
3–6 months: change-impact graph, schedule assurance, estimate assurance, cost/schedule
risk, procurement, interface management, commissioning, AWP, Sync Reliability
integration. 6–12 months: Monte Carlo, portfolio optimization, benefits realization,
vendor intelligence, project FRACAS, HOP, predictive gate assurance, reference-class
forecasting. 12–24 months: the accumulated graph — Past Project → Decision → Design →
Vendor → Installed Asset → Failure History → Maintenance Cost → Production Result —
answering "which design decisions actually produce better lifecycle outcomes?" An
extraordinarily valuable data asset.

### §86 Architectural north star
OBJECTIVE → REQUIREMENT → RISK/OPPORTUNITY → DECISION → DESIGN → PROJECT WORK → ASSET →
OPERATION → OUTCOME → LEARNING → NEXT DECISION. ADEM becomes the customer's
development/governance configuration; PMBOK provides project-management discipline;
ISO 31000 the risk grammar; RAM the engineering assurance. SyncAI links decisions made
before an asset exists to the reliability, cost, risk and value that asset produces
years later.
