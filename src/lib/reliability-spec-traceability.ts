export type SpecStatus =
  | "implemented"
  | "partial"
  | "captured-not-implemented"
  | "missing"
  | "owner-gate";

export type SpecPriority = "P0" | "P1" | "P2" | "P3";

export interface SpecRequirement {
  id: string;
  category: string;
  requirement: string;
  status: SpecStatus;
  priority: SpecPriority;
  phase: string;
  evidence: string[];
  gap: string;
  nextAction: string;
}

export const SPEC_REVIEW_DATE = "2026-05-20";

export const SPEC_STATUS_LABELS: Record<SpecStatus, string> = {
  implemented:
    "Working in code, docs, or public demo with tests where applicable",
  partial:
    "Some product behavior exists, but the commercial requirement is not complete",
  "captured-not-implemented":
    "Captured in docs, prompts, manifests, or plans, but not a working product workflow",
  missing: "Not materially implemented in the current product",
  "owner-gate":
    "Blocked by account, legal, tenant, marketplace, or production credential action",
};

export const SPEC_REQUIREMENTS: SpecRequirement[] = [
  {
    id: "POS-001",
    category: "Positioning",
    requirement:
      "Position the product as Reliability Engineering Copilot for asset-intensive industries.",
    status: "implemented",
    priority: "P0",
    phase: "GTM",
    evidence: [
      "README.md",
      "README-STAKEHOLDER.md",
      "docs/reliability-engineering-copilot-prd.md",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "The public product name is present; custom domain and final brand polish remain outside this requirement.",
    nextAction:
      "Keep all public listing, app, Teams, and marketplace copy aligned to this positioning.",
  },
  {
    id: "POS-002",
    category: "Positioning",
    requirement:
      "Target mining, oil sands, oil and gas, petrochemical, utilities, power generation, pulp and paper, rail, aviation maintenance, ports, heavy manufacturing, water/wastewater, and defense sustainment.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "GTM",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "docs/reliability-engineering-copilot-capabilities.md",
    ],
    gap: "The industries are documented, but the app does not yet switch templates, terminology, failure libraries, or workflows by industry.",
    nextAction:
      "Add industry profile selection during onboarding and bind it to starter asset libraries, prompts, sample data, and report wording.",
  },
  {
    id: "POS-003",
    category: "Positioning",
    requirement:
      "Turn maintenance, inspection, condition-monitoring, and failure-history data into defensible engineering decisions.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-report-engine.test.ts",
    ],
    gap: "CSV failure history produces a defensible starter report, but inspection files, condition monitoring files, uploaded documents, citations, and persistence are not yet live.",
    nextAction:
      "Wire document upload, RAG retrieval, citations, and saved reports into the Copilot workspace.",
  },
  {
    id: "POS-004",
    category: "Positioning",
    requirement:
      "Differentiate as governed reliability engineering decision support, not a generic maintenance chatbot.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/lib/reliability-tool-definitions.ts",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
    ],
    gap: "Governance language and approval boundaries exist, but approval workflow, audit records, and recommendation lifecycle tracking are not wired to production data.",
    nextAction:
      "Add persisted recommendation records with evidence, assumptions, approval status, owner, validation, and effectiveness review.",
  },
  {
    id: "POS-005",
    category: "Positioning",
    requirement:
      "Avoid claims that the product replaces engineers, guarantees reliability improvement, or certifies compliance.",
    status: "implemented",
    priority: "P0",
    phase: "GTM",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/marketplace/appsource-listing.md",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "No material gap in current docs; final legal review is still required before public marketplace submission.",
    nextAction:
      "Run final marketplace copy through legal/business review before AppSource submission.",
  },
  {
    id: "POS-006",
    category: "Positioning",
    requirement:
      "Make the bootstrap wedge RCA + FRACAS starter packs from customer maintenance data.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/lib/reliability-report-engine.ts",
      "docs/90-day-pilot-playbook.md",
    ],
    gap: "Starter packs generate locally, but they are not yet backed by saved cases, customer document citations, or collaboration workflow.",
    nextAction:
      "Promote generated reports into saved RCA/FRACAS case records with source documents and action tracking.",
  },
  {
    id: "ROLE-001",
    category: "Assistant Behavior",
    requirement:
      "Act as a senior reliability engineer and maintenance strategy advisor.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
      "src/lib/reliability-report-engine.ts",
    ],
    gap: "The behavior is present in prompt and deterministic report language, but no live LLM runtime is connected to the web workspace.",
    nextAction:
      "Connect the Copilot workspace to the OpenAI or Azure OpenAI agent endpoint with the production prompt.",
  },
  {
    id: "ROLE-002",
    category: "Assistant Behavior",
    requirement: "Support failure analysis and root cause identification.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "The app drafts RCA actions and evidence gaps; it does not yet build event timelines, cause maps, evidence tables, hypotheses, or verification logic as structured objects.",
    nextAction:
      "Add a structured RCA workspace with timeline, evidence table, cause map, hypotheses, corrective actions, and recurrence verification.",
  },
  {
    id: "ROLE-003",
    category: "Assistant Behavior",
    requirement: "Support FRACAS / DCACAS case management.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-tool-definitions.ts",
      "microsoft/foundry/tool-actions.openapi.yaml",
    ],
    gap: "FRACAS case creation is scaffolded as tool/action definitions and report content, but there is no persisted FRACAS case CRUD workflow.",
    nextAction:
      "Create FRACAS database tables, API mutations, list/detail pages, and case lifecycle states.",
  },
  {
    id: "ROLE-004",
    category: "Assistant Behavior",
    requirement: "Support RAM analysis.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Core RAM metrics are implemented, but maintainability analysis, RBDs, redundancy, operational/achieved availability workflow, and trade-off modeling are not complete.",
    nextAction:
      "Expand deterministic RAM tooling for maintainability, operational availability, series/parallel systems, k-out-of-n, redundancy, and downtime contribution.",
  },
  {
    id: "ROLE-005",
    category: "Assistant Behavior",
    requirement: "Support RCM and PM optimization.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "docs/reliability-engineering-copilot-prd.md",
    ],
    gap: "Reports include RCM/PM recommendations, but there is no RCM decision tree, task interval justification, PM-task-to-failure-mode mapping table, or approval workflow.",
    nextAction:
      "Build RCM/PM structured worksheets with consequence classification, task applicability, interval basis, and approval status.",
  },
  {
    id: "ROLE-006",
    category: "Assistant Behavior",
    requirement: "Support FMEA / FMECA facilitation.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "docs/reliability-engineering-copilot-capabilities.md",
    ],
    gap: "FMEA output is recommendation text only; no editable FMEA table, RPN/criticality scoring, residual risk, or action register exists.",
    nextAction:
      "Add editable FMEA/FMECA table builder with scoring, controls, recommendations, ownership, due dates, and export.",
  },
  {
    id: "ROLE-007",
    category: "Assistant Behavior",
    requirement: "Support asset criticality assessment.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 4",
    evidence: ["docs/reliability-engineering-copilot-capabilities.md"],
    gap: "The capability is documented but no risk matrix, scoring model, heat map, or critical equipment list workflow is in the Copilot product.",
    nextAction:
      "Implement criticality model configuration and asset scoring with production, safety, environmental, cost, redundancy, and spares factors.",
  },
  {
    id: "ROLE-008",
    category: "Assistant Behavior",
    requirement: "Support bad actor analysis.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-report-engine.test.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "The current implementation ranks by downtime, failures, and cost; richer Pareto charting and alternate ranking metrics are still needed.",
    nextAction:
      "Add charted Pareto views and ranking by downtime, count, cost, risk, and failure mode.",
  },
  {
    id: "ROLE-009",
    category: "Assistant Behavior",
    requirement: "Support defect elimination.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["docs/reliability-engineering-copilot-capabilities.md"],
    gap: "Defect elimination is documented, but there is no closed-loop defect register or recurring defect workflow.",
    nextAction:
      "Create defect elimination workflow that links bad actors, RCA, corrective actions, recurrence checks, and benefit capture.",
  },
  {
    id: "ROLE-010",
    category: "Assistant Behavior",
    requirement: "Support maintenance strategy development.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "docs/reliability-engineering-copilot-capabilities.md",
    ],
    gap: "Mode-specific recommendations exist, but the product does not yet generate complete asset strategy documents with task libraries, intervals, operating limits, and spares.",
    nextAction:
      "Create asset strategy builder with equipment templates, failure modes, tasks, intervals, condition monitoring, spares, and approval basis.",
  },
  {
    id: "ROLE-011",
    category: "Assistant Behavior",
    requirement: "Support lifecycle asset management.",
    status: "captured-not-implemented",
    priority: "P2",
    phase: "Phase 4",
    evidence: ["docs/reliability-engineering-copilot-capabilities.md"],
    gap: "Lifecycle asset management is documented but no LCAM workflow, replacement model, lifecycle cost model, or commissioning checklist is built.",
    nextAction:
      "Add LCAM templates after the RCA/FRACAS and PM optimization wedge is revenue-validated.",
  },
  {
    id: "ROLE-012",
    category: "Assistant Behavior",
    requirement:
      "Support reliability data analysis including Weibull, MTBF, MTTR, availability, maintainability, reliability growth, and risk modeling.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-report-engine.ts",
    ],
    gap: "MTBF, MTTR, availability, failure rate, mission reliability, and bad actors exist; Weibull, maintainability modeling, reliability growth, and risk modeling are missing.",
    nextAction:
      "Add life-data, maintainability, Crow-AMSAA, and criticality/risk calculation modules with tests.",
  },
  {
    id: "ROLE-013",
    category: "Assistant Behavior",
    requirement: "Support executive reliability reporting.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Executive brief mode exists, but there is no polished board/plant-manager template, benefit tracker, PDF/Word export, or Power BI handoff.",
    nextAction:
      "Add executive report templates, benefit fields, and PDF/Word export.",
  },
  {
    id: "CHAT-001",
    category: "Reliability Chat Assistant",
    requirement: "Handle natural-language prompts in a chat-style assistant.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/pages/ReliabilityCopilotPage.tsx"],
    gap: "The workspace accepts a prompt and generates a deterministic report, but it is not a streaming conversational LLM chat.",
    nextAction:
      "Add conversation UI, message history, streaming response handling, and tool-call display.",
  },
  {
    id: "CHAT-002",
    category: "Reliability Chat Assistant",
    requirement: "Analyze failure history.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-report-engine.test.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Works for simple CSV inputs; XLSX, SAP/Maximo exports, and richer normalization are not complete.",
    nextAction:
      "Add import mappers for common CMMS export formats and data quality warnings.",
  },
  {
    id: "CHAT-003",
    category: "Reliability Chat Assistant",
    requirement: "Build an RCA.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "The product creates an RCA starter report, not a full structured RCA with timeline, cause logic, evidence table, and approval workflow.",
    nextAction:
      "Build structured RCA artifacts and exportable RCA report templates.",
  },
  {
    id: "CHAT-004",
    category: "Reliability Chat Assistant",
    requirement: "Create a FMEA.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "FMEA mode gives guidance but does not create a structured editable worksheet.",
    nextAction: "Implement FMEA worksheet generation and editing.",
  },
  {
    id: "CHAT-005",
    category: "Reliability Chat Assistant",
    requirement: "Optimize PMs.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "PM optimization mode creates guidance, but no PM import, PM-to-failure-mode linkage, interval analysis, or approval route exists.",
    nextAction:
      "Add PM import and optimization worksheet with evidence, interval basis, risk, and approvals.",
  },
  {
    id: "CHAT-006",
    category: "Reliability Chat Assistant",
    requirement: "Calculate availability.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Inherent availability is in the UI; operational availability exists in the library but not yet exposed in the workspace.",
    nextAction:
      "Expose operational and achieved availability variants in the RAM tool UI.",
  },
  {
    id: "CHAT-007",
    category: "Reliability Chat Assistant",
    requirement: "Summarize bad actors.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Ranking exists; charting and exportable Pareto visuals are pending.",
    nextAction:
      "Add Pareto chart export and filters by system, site, failure mode, cost, and downtime.",
  },
  {
    id: "CHAT-008",
    category: "Reliability Chat Assistant",
    requirement: "Review a FRACAS case.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
    ],
    gap: "No FRACAS case records exist for the assistant to review.",
    nextAction:
      "Implement FRACAS CRUD first, then add quality review rules and assistant critique.",
  },
  {
    id: "CHAT-009",
    category: "Reliability Chat Assistant",
    requirement:
      "Explain whether failure behavior is random, wear-out, infant mortality, or induced failure.",
    status: "missing",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "User-provided spec; no current product workflow implements this.",
    ],
    gap: "The app does not classify failure patterns from life data or event context.",
    nextAction:
      "Add failure-pattern classification using life data, Weibull beta interpretation, event context, and confidence warnings.",
  },
  {
    id: "CHAT-010",
    category: "Reliability Chat Assistant",
    requirement: "Create an executive reliability report.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Executive brief mode exists, but not a polished, exportable executive report pack with charts and ROI.",
    nextAction: "Add executive pack templates and PDF/Word export.",
  },
  {
    id: "CALC-001",
    category: "Deterministic Calculations",
    requirement: "Calculate MTBF as operating time divided by failures.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
    ],
    gap: "No material calculation gap.",
    nextAction:
      "Keep formula visible in the future calculation result payload.",
  },
  {
    id: "CALC-002",
    category: "Deterministic Calculations",
    requirement: "Calculate MTTR as repair time divided by repair events.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
    ],
    gap: "No material calculation gap.",
    nextAction:
      "Keep formula visible in the future calculation result payload.",
  },
  {
    id: "CALC-003",
    category: "Deterministic Calculations",
    requirement:
      "Calculate inherent availability as MTBF divided by MTBF plus MTTR.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
    ],
    gap: "No material calculation gap.",
    nextAction:
      "Keep formula visible in the future calculation result payload.",
  },
  {
    id: "CALC-004",
    category: "Deterministic Calculations",
    requirement:
      "Calculate operational availability as uptime divided by total time.",
    status: "partial",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
    ],
    gap: "The library function exists but it is not exposed in the Copilot UI or tool definition.",
    nextAction:
      "Expose operational availability in RAM calculator and tool definitions.",
  },
  {
    id: "CALC-005",
    category: "Deterministic Calculations",
    requirement:
      "Calculate failure rate lambda as failures divided by exposure.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "No material calculation gap.",
    nextAction:
      "Add units and source of exposure hours to future saved calculation records.",
  },
  {
    id: "CALC-006",
    category: "Deterministic Calculations",
    requirement: "Calculate exponential reliability as e^(-lambda t).",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "No material calculation gap.",
    nextAction:
      "Add formula, units, and assumptions to saved calculation records.",
  },
  {
    id: "CALC-007",
    category: "Deterministic Calculations",
    requirement: "Calculate PM compliance.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "PM compliance function and tool definition exist, but import fields and dashboard metric are not exposed in the Copilot UI.",
    nextAction:
      "Add PM import fields, saved calculation records, and dashboard metric.",
  },
  {
    id: "CALC-008",
    category: "Deterministic Calculations",
    requirement: "Calculate schedule compliance.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "Schedule compliance function and tool definition exist, but CMMS import mapping and UI exposure are not complete.",
    nextAction: "Add schedule compliance to imported work management metrics.",
  },
  {
    id: "CALC-009",
    category: "Deterministic Calculations",
    requirement: "Calculate break-in work percentage.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "Break-in work function exists, but work schedule baseline and classification mapping are not complete.",
    nextAction: "Add work type normalization and break-in dashboard output.",
  },
  {
    id: "CALC-010",
    category: "Deterministic Calculations",
    requirement: "Calculate emergency work percentage.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "Emergency work function exists, but priority/work-type field mapping is not complete.",
    nextAction: "Add emergency work metric to CMMS import mapper and UI.",
  },
  {
    id: "CALC-011",
    category: "Deterministic Calculations",
    requirement: "Calculate planned versus unplanned work.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "Planned work percentage function exists, but planned/unplanned classification and dashboard summary are not complete.",
    nextAction: "Add maintenance mix classification and dashboard summary.",
  },
  {
    id: "CALC-012",
    category: "Deterministic Calculations",
    requirement: "Create bad actor Pareto analysis.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "Bad actor ranking exists; Pareto chart, cumulative percentage, and configurable ranking metric are not fully exposed.",
    nextAction: "Add Pareto chart data generation, tests, and UI chart.",
  },
  {
    id: "CALC-013",
    category: "Deterministic Calculations",
    requirement: "Calculate cost of unreliability.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-report-engine.ts",
    ],
    gap: "Cost-of-unreliability function and captured maintenance-cost report output exist, but production loss assumptions and ROI UI are not complete.",
    nextAction:
      "Expose downtime cost assumptions and ROI/benefit capture fields in the Copilot workspace.",
  },
  {
    id: "CALC-014",
    category: "Deterministic Calculations",
    requirement: "Perform Weibull beta / eta / gamma analysis.",
    status: "missing",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "User-provided spec; no current product function implements this.",
    ],
    gap: "No Weibull fitting, censored data handling, or life data UI exists.",
    nextAction:
      "Add Weibull module with deterministic fitting, tests, and interpretation guardrails.",
  },
  {
    id: "CALC-015",
    category: "Deterministic Calculations",
    requirement: "Perform Crow-AMSAA reliability growth analysis.",
    status: "missing",
    priority: "P2",
    phase: "Phase 4",
    evidence: [
      "User-provided spec; no current product function implements this.",
    ],
    gap: "No reliability growth model exists.",
    nextAction:
      "Add Crow-AMSAA calculation module and eval cases after core RCA/FRACAS workflow.",
  },
  {
    id: "CALC-016",
    category: "Deterministic Calculations",
    requirement: "Calculate spares risk.",
    status: "missing",
    priority: "P2",
    phase: "Phase 4",
    evidence: [
      "User-provided spec; no current product function implements this.",
    ],
    gap: "No inventory, lead-time, stockout consequence, or critical spares model exists.",
    nextAction: "Add critical spares data model and risk calculation.",
  },
  {
    id: "CALC-017",
    category: "Deterministic Calculations",
    requirement: "Calculate lifecycle cost.",
    status: "missing",
    priority: "P2",
    phase: "Phase 4",
    evidence: [
      "User-provided spec; no current product function implements this.",
    ],
    gap: "No lifecycle cost or replacement economics model exists.",
    nextAction:
      "Add lifecycle cost calculator and replacement justification template.",
  },
  {
    id: "CALC-018",
    category: "Deterministic Calculations",
    requirement: "Calculate risk priority / criticality scoring.",
    status: "partial",
    priority: "P1",
    phase: "Phase 4",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "RPN calculation exists, but configurable criticality matrix and FMEA/criticality UI are not complete.",
    nextAction:
      "Use the RPN function inside FMEA and criticality workflows with configurable scoring scales.",
  },
  {
    id: "FRACAS-001",
    category: "FRACAS / DCACAS",
    requirement: "Provide failure event intake.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-tool-definitions.ts",
    ],
    gap: "CSV rows can represent failure events, but there is no case intake form, validation, or persistence.",
    nextAction:
      "Build FRACAS intake form and persist normalized failure events.",
  },
  {
    id: "FRACAS-002",
    category: "FRACAS / DCACAS",
    requirement: "Provide failure coding taxonomy.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "supabase/seed/014_oil_sands_failure_modes.sql",
      "supabase/seed/030_sir_agents_tools.sql",
    ],
    gap: "Some seeded failure modes exist, but Copilot does not expose a governed taxonomy for mode, mechanism, cause, consequence, detection, and action categories.",
    nextAction: "Add tenant-configurable failure taxonomy tables and UI.",
  },
  {
    id: "FRACAS-003",
    category: "FRACAS / DCACAS",
    requirement: "Map cases to asset hierarchy.",
    status: "partial",
    priority: "P1",
    phase: "Phase 3",
    evidence: [
      "supabase/migrations/002_assets_core.sql",
      "supabase/migrations/008_industrial_platform_merged.sql",
    ],
    gap: "Asset hierarchy tables exist in the broader platform, but Copilot reports do not link saved cases to assets.",
    nextAction:
      "Connect Copilot imports and FRACAS cases to asset hierarchy records.",
  },
  {
    id: "FRACAS-004",
    category: "FRACAS / DCACAS",
    requirement: "Capture functional failure.",
    status: "missing",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["User-provided spec; no current product field implements this."],
    gap: "No functional failure field exists in the Copilot workflow.",
    nextAction:
      "Add functional failure to FRACAS schema, RCA, FMEA, and RCM records.",
  },
  {
    id: "FRACAS-005",
    category: "FRACAS / DCACAS",
    requirement: "Capture failure mode.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "CSV parser captures failure mode text, but no governed taxonomy, validation, or case field exists.",
    nextAction: "Normalize failure mode values against a tenant taxonomy.",
  },
  {
    id: "FRACAS-006",
    category: "FRACAS / DCACAS",
    requirement: "Capture failure mechanism.",
    status: "missing",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["User-provided spec; no current product field implements this."],
    gap: "No failure mechanism field exists in the working product.",
    nextAction: "Add mechanism field and library to FRACAS/FMEA taxonomy.",
  },
  {
    id: "FRACAS-007",
    category: "FRACAS / DCACAS",
    requirement: "Capture cause category.",
    status: "missing",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["User-provided spec; no current product field implements this."],
    gap: "No immediate/root/contributing cause category model exists for Copilot cases.",
    nextAction: "Add cause taxonomy and RCA-to-FRACAS mapping.",
  },
  {
    id: "FRACAS-008",
    category: "FRACAS / DCACAS",
    requirement: "Provide evidence log.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "supabase/migrations/20260323065617_20260323090000_add_evidence_and_escalation.sql",
    ],
    gap: "Evidence gaps are listed and broader evidence tables exist, but the Copilot does not attach source evidence to cases and recommendations.",
    nextAction:
      "Wire uploads and retrieved chunks to saved evidence items with source, page, confidence, and case links.",
  },
  {
    id: "FRACAS-009",
    category: "FRACAS / DCACAS",
    requirement: "Support RCA method selection.",
    status: "partial",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-tool-definitions.ts"],
    gap: "Tool definition lists methods, but the UI and runtime do not let users select or run 5-Why, cause map, fishbone, or fault tree workflows.",
    nextAction:
      "Add RCA method selector and method-specific structured outputs.",
  },
  {
    id: "FRACAS-010",
    category: "FRACAS / DCACAS",
    requirement: "Track corrective and preventive actions.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "supabase/migrations/003_work_management.sql",
    ],
    gap: "Reports recommend actions and broader work tables have corrective action text, but there is no Copilot action register with owners, due dates, status, and verification.",
    nextAction:
      "Create corrective/preventive action register tied to FRACAS cases.",
  },
  {
    id: "FRACAS-011",
    category: "FRACAS / DCACAS",
    requirement: "Assign owner and due date.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "microsoft/foundry/evals.jsonl",
    ],
    gap: "Owner and due date are mentioned in generated actions/evals, but not captured as persisted fields.",
    nextAction:
      "Add owner, role, due date, reminders, and overdue status to action records.",
  },
  {
    id: "FRACAS-012",
    category: "FRACAS / DCACAS",
    requirement: "Track verification method and effectiveness review.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Verification is recommended in text, not tracked as a field or workflow.",
    nextAction:
      "Add verification method, check date, evidence, result, and approver fields.",
  },
  {
    id: "FRACAS-013",
    category: "FRACAS / DCACAS",
    requirement: "Detect recurrence.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Recurrence check is mentioned, but the product does not compare future events to closed cases.",
    nextAction:
      "Add recurrence detection against asset, failure mode, cause, and time window.",
  },
  {
    id: "FRACAS-014",
    category: "FRACAS / DCACAS",
    requirement: "Capture lessons learned.",
    status: "missing",
    priority: "P2",
    phase: "Phase 3",
    evidence: [
      "User-provided spec; no current product workflow implements this.",
    ],
    gap: "No lessons learned record or reusable knowledge feedback loop exists.",
    nextAction:
      "Add lessons learned field and promote verified lessons into tenant knowledge base.",
  },
  {
    id: "RAG-001",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest DoD RAM Guide.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
      "tests/test_reliability_rag_corpus.py",
    ],
    gap: "Local corpus exists; it is not yet queried by the web Copilot runtime.",
    nextAction:
      "Load generated chunks into production retrieval and cite them in answers.",
  },
  {
    id: "RAG-002",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest MIL-HDBK-338B.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
      "tests/test_reliability_rag_query.py",
    ],
    gap: "Local corpus exists; web app retrieval is not yet wired.",
    nextAction:
      "Load generated chunks into production retrieval and cite them in answers.",
  },
  {
    id: "RAG-003",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest RADC nonelectronic reliability references.",
    status: "implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
    ],
    gap: "Local corpus exists; web app retrieval is not yet wired.",
    nextAction:
      "Load generated chunks into production retrieval and cite them in answers.",
  },
  {
    id: "RAG-004",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest MIL-HDBK-217F electronic reliability reference.",
    status: "implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
    ],
    gap: "Local corpus exists; web app retrieval is not yet wired.",
    nextAction:
      "Load generated chunks into production retrieval and cite them in answers.",
  },
  {
    id: "RAG-005",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest NSWC-11 mechanical equipment reliability reference.",
    status: "implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
    ],
    gap: "Local corpus exists; web app retrieval is not yet wired.",
    nextAction:
      "Load generated chunks into production retrieval and cite them in answers.",
  },
  {
    id: "RAG-006",
    category: "Standards-Aware Knowledge Base",
    requirement: "Ingest failure investigation reports for RCA examples.",
    status: "implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "scripts/reliability_rag_corpus.py",
      "docs/rag-training-corpus.md",
    ],
    gap: "Local corpus exists; web app retrieval is not yet wired.",
    nextAction: "Use investigation chunks as cited examples in RCA workflows.",
  },
  {
    id: "RAG-007",
    category: "Standards-Aware Knowledge Base",
    requirement:
      "Avoid embedding copyrighted standards verbatim unless redistribution rights exist.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [".gitignore", "docs/rag-training-corpus.md"],
    gap: "Generated corpus is excluded from git; final customer licensing workflow still needs policy UI.",
    nextAction:
      "Add upload terms and admin controls that record customer rights for proprietary/OEM standards.",
  },
  {
    id: "RAG-008",
    category: "Standards-Aware Knowledge Base",
    requirement: "Retrieve knowledge with citations in product responses.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "scripts/query_reliability_rag_corpus.py",
      "tests/test_reliability_rag_query.py",
    ],
    gap: "Local lexical retrieval works, but the web app does not retrieve or display citations.",
    nextAction:
      "Add RAG service endpoint and citation rendering in the Copilot report/chat.",
  },
  {
    id: "RAG-009",
    category: "Standards-Aware Knowledge Base",
    requirement: "Separate retrieved facts from generated recommendations.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-knowledge-base.ts",
    ],
    gap: "The deterministic report now separates source grounding, assumptions, calculations, and governed recommendations, but live LLM response schema enforcement is still missing.",
    nextAction:
      "Apply the same schema to the live agent runtime once connected.",
  },
  {
    id: "RAG-010",
    category: "Standards-Aware Knowledge Base",
    requirement: "Show document confidence.",
    status: "partial",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-knowledge-base.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Seed source confidence is rendered, but production vector retrieval confidence is not wired.",
    nextAction:
      "Replace seed confidence with retrieval score normalization from the production RAG service.",
  },
  {
    id: "RAG-011",
    category: "Standards-Aware Knowledge Base",
    requirement:
      "Use customer documents for standards, failure codes, OEM manuals, operating envelopes, and risk matrices.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "docs/rag-training-corpus.md",
      "docs/reliability-engineering-copilot-prd.md",
    ],
    gap: "The product has a local corpus builder, but no tenant upload, permission, ingestion, or retrieval workflow in the app.",
    nextAction:
      "Build tenant-scoped document upload, parsing, chunking, indexing, retrieval, and citation flow.",
  },
  {
    id: "ARCH-001",
    category: "Architecture",
    requirement: "Provide a web app.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/App.tsx", "src/pages/ReliabilityCopilotPage.tsx"],
    gap: "The app is Vite/React rather than the original Next.js scaffold recommendation.",
    nextAction:
      "Keep Vite/Supabase unless a migration creates clear marketplace or enterprise advantage.",
  },
  {
    id: "ARCH-002",
    category: "Architecture",
    requirement: "Provide chat UI.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/components/UnifiedChatInterface.tsx",
    ],
    gap: "The Copilot page has prompt/report UI, and legacy chat exists, but there is no streaming reliability chat connected to tools.",
    nextAction:
      "Unify reliability Copilot with streaming chat and tool-call panels.",
  },
  {
    id: "ARCH-003",
    category: "Architecture",
    requirement: "Provide file upload.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "supabase/functions/document-processor/index.ts",
    ],
    gap: "CSV upload works locally in the browser; PDF/DOCX/XLSX upload into tenant storage and RAG is not wired.",
    nextAction:
      "Add file upload endpoint and UI for PDFs, DOCX, XLSX, CSV, and text.",
  },
  {
    id: "ARCH-004",
    category: "Architecture",
    requirement: "Provide asset dashboard.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: [
      "src/pages/AssetDetailPage.tsx",
      "src/components/AssetManagement.tsx",
    ],
    gap: "Asset UI exists in the broader app, but Reliability Copilot does not yet use it as context memory.",
    nextAction:
      "Connect Copilot reports and cases to asset profiles and history.",
  },
  {
    id: "ARCH-005",
    category: "Architecture",
    requirement: "Provide RCA / FMEA / FRACAS workspaces.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: ["src/pages/ReliabilityCopilotPage.tsx"],
    gap: "Mode tabs exist, but dedicated workspaces with structured fields, persistence, approvals, and exports do not.",
    nextAction:
      "Split reports into saved RCA, FRACAS, FMEA, RCM, and RAM workspace records.",
  },
  {
    id: "ARCH-006",
    category: "Architecture",
    requirement: "Provide admin console for prompt configuration.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "src/pages/SettingsPage.tsx",
    ],
    gap: "Settings page exists, but prompt version controls are not implemented.",
    nextAction:
      "Add prompt library, versioning, tenant overrides, eval gates, and rollback.",
  },
  {
    id: "ARCH-007",
    category: "Architecture",
    requirement: "Provide backend API server.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["supabase/functions", "supabase/migrations"],
    gap: "Supabase Edge Functions exist, but no dedicated Reliability Copilot API wraps reports, cases, RAG, calculations, and tools.",
    nextAction:
      "Create Reliability Copilot API functions for chat, reports, uploads, RAG, calculations, and cases.",
  },
  {
    id: "ARCH-008",
    category: "Architecture",
    requirement: "Provide auth, RBAC, and tenant isolation.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/components/AuthProvider.tsx",
      "supabase/migrations/009_auth_rbac_phase2.sql",
    ],
    gap: "Auth/RBAC exists in the broader app, but production Vercel has no Supabase env vars configured and Copilot tenant isolation is not verified end-to-end.",
    nextAction:
      "Configure production env vars and run tenant isolation tests for Copilot data.",
  },
  {
    id: "ARCH-009",
    category: "Architecture",
    requirement: "Provide audit logging.",
    status: "partial",
    priority: "P0",
    phase: "Phase 5",
    evidence: [
      "docs/CONTROL_PLANE_AUDIT.md",
      "supabase/migrations/20260405000000_add_audit_triggers_and_rls.sql",
    ],
    gap: "Audit infrastructure exists, but Copilot prompts, uploads, tool calls, generated outputs, user edits, approvals, and exports are not logged.",
    nextAction: "Add Copilot-specific audit events and tests.",
  },
  {
    id: "ARCH-010",
    category: "Architecture",
    requirement: "Provide tool execution service.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-tool-definitions.ts",
      "microsoft/foundry/tool-actions.openapi.yaml",
    ],
    gap: "Tool definitions exist, but no runtime dispatch layer connects LLM calls to deterministic tools and database actions.",
    nextAction:
      "Implement typed tool executor with approval gates and trace logging.",
  },
  {
    id: "ARCH-011",
    category: "Architecture",
    requirement: "Provide calculation engine.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-calculations.ts",
      "src/lib/reliability-calculations.test.ts",
    ],
    gap: "Core calculations exist; full calculator set and persisted calculation records are missing.",
    nextAction:
      "Expand calculation library and save calculation inputs/results/formulas.",
  },
  {
    id: "ARCH-012",
    category: "Architecture",
    requirement: "Provide RAG retrieval service.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "scripts/query_reliability_rag_corpus.py",
      "supabase/functions/rag-semantic-search/index.ts",
    ],
    gap: "Local query tool and legacy semantic search exist, but generated reliability corpus is not indexed into the production app.",
    nextAction:
      "Index reliability corpus into pgvector/OpenAI vector stores and expose retrieval endpoint.",
  },
  {
    id: "ARCH-013",
    category: "Architecture",
    requirement: "Provide workflow engine.",
    status: "partial",
    priority: "P1",
    phase: "Phase 3",
    evidence: [
      "supabase/functions/runbook-executor/index.ts",
      "src/components/ApprovalQueue.tsx",
    ],
    gap: "Generic workflow/approval pieces exist, but Copilot RCA/FRACAS/FMEA workflows are not bound to them.",
    nextAction:
      "Create Copilot workflow states and transitions for cases, recommendations, approvals, and effectiveness checks.",
  },
  {
    id: "ARCH-014",
    category: "Architecture",
    requirement: "Provide integration layer for CMMS/EAM/APM systems.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 5",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/technical-gap-checklist.md",
    ],
    gap: "Integration targets are documented, but SAP, Maximo, Oracle, Hexagon, GE, Aspen, Bentley, PI, Databricks, Snowflake, SharePoint, Teams, and Power BI data flows are not live.",
    nextAction:
      "Start with CSV/XLSX import and SharePoint/Teams file flow before deep CMMS APIs.",
  },
  {
    id: "ARCH-015",
    category: "Architecture",
    requirement: "Provide PostgreSQL data layer.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["supabase/migrations", "supabase/config.toml"],
    gap: "Supabase/Postgres migrations exist, but Reliability Copilot-specific tables are incomplete.",
    nextAction:
      "Add Copilot migrations for cases, documents, chunks, reports, calculations, recommendations, approvals, and benefit tracking.",
  },
  {
    id: "ARCH-016",
    category: "Architecture",
    requirement: "Provide vector database or vector store.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "supabase/migrations/20251024080921_enable_vector_and_create_rag_system.sql",
      "scripts/reliability_rag_corpus.py",
    ],
    gap: "pgvector infrastructure and local chunks exist, but reliability chunks are not loaded and queried by the web app.",
    nextAction:
      "Create ingestion command or function that loads chunk embeddings into the configured vector store.",
  },
  {
    id: "ARCH-017",
    category: "Architecture",
    requirement: "Use LLM via OpenAI API or enterprise model provider.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
    ],
    gap: "Prompt and architecture are documented, but the Copilot workspace currently runs deterministic local generation only.",
    nextAction:
      "Add server-side OpenAI/Azure OpenAI runtime with streaming, tool calling, and secure keys.",
  },
  {
    id: "ARCH-018",
    category: "Architecture",
    requirement: "Provide guardrails and citation requirements.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Safety disclaimers and prompt rules exist, but runtime schema validation, citation enforcement, and unsafe-output eval gates are incomplete.",
    nextAction:
      "Add structured output validation and eval-driven release gates.",
  },
  {
    id: "MVP-001",
    category: "MVP Phase 1",
    requirement: "Provide conversation history.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "supabase/migrations/20251024080921_enable_vector_and_create_rag_system.sql",
    ],
    gap: "Conversation tables exist, but Reliability Copilot conversations are not persisted from the workspace.",
    nextAction: "Persist Copilot sessions and messages by tenant/user.",
  },
  {
    id: "MVP-002",
    category: "MVP Phase 1",
    requirement: "Export to Word/PDF.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/pages/ReliabilityCopilotPage.tsx"],
    gap: "Markdown export exists; PDF and Word export are missing.",
    nextAction: "Add PDF and DOCX export for generated reports and case packs.",
  },
  {
    id: "MVP-003",
    category: "MVP Phase 2",
    requirement: "Import CSV/XLSX work orders.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/pages/ReliabilityCopilotPage.tsx",
      "src/lib/reliability-report-engine.ts",
    ],
    gap: "CSV import works; XLSX and saved import jobs are missing.",
    nextAction:
      "Add XLSX parser, field mapper, validation, and persisted import jobs.",
  },
  {
    id: "MVP-004",
    category: "MVP Phase 2",
    requirement: "Normalize failure events.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "CSV headers normalize, but failure events are not governed by a schema, taxonomy, or quality rules.",
    nextAction: "Add failure event schema and data quality engine.",
  },
  {
    id: "MVP-005",
    category: "MVP Phase 2",
    requirement: "Provide MTBF / MTTR / availability dashboards.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: ["src/pages/ReliabilityCopilotPage.tsx"],
    gap: "RAM metric cards exist in the Copilot page; trend dashboards by asset/site/time are missing.",
    nextAction: "Add metric trend dashboards after persisted imports exist.",
  },
  {
    id: "MVP-006",
    category: "MVP Phase 2",
    requirement: "Provide natural-language data analysis.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 2",
    evidence: ["docs/reliability-engineering-copilot-prd.md"],
    gap: "No LLM-backed data analysis agent is wired to imported datasets.",
    nextAction:
      "Add data analyst agent that can query normalized work-order and failure-event data with deterministic tools.",
  },
  {
    id: "MVP-007",
    category: "MVP Phase 3",
    requirement: "Generate Failure Review Board package.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["docs/reliability-engineering-copilot-capabilities.md"],
    gap: "FRB package is documented but not generated by the product.",
    nextAction:
      "Add FRB export containing case summary, evidence, corrective actions, overdue items, and recurrence status.",
  },
  {
    id: "MVP-008",
    category: "MVP Phase 4",
    requirement: "Provide maintenance strategy library.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 4",
    evidence: [
      "docs/reliability-engineering-copilot-capabilities.md",
      "supabase/seed/014_oil_sands_failure_modes.sql",
    ],
    gap: "Some failure mode seeds exist, but no reusable strategy library is exposed.",
    nextAction:
      "Create asset-class strategy templates for pumps, conveyors, compressors, motors, and fixed equipment first.",
  },
  {
    id: "MVP-009",
    category: "MVP Phase 5",
    requirement: "Provide SSO / SAML / SCIM.",
    status: "captured-not-implemented",
    priority: "P2",
    phase: "Phase 5",
    evidence: ["microsoft/technical-gap-checklist.md"],
    gap: "Enterprise identity requirements are tracked, but not implemented.",
    nextAction:
      "Add SSO/SAML after private pilot proves value, or earlier if a design partner requires it.",
  },
  {
    id: "MVP-010",
    category: "MVP Phase 5",
    requirement: "Provide model governance and evaluation dashboards.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 5",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/foundry/evals.jsonl",
    ],
    gap: "Eval cases exist in files, but no dashboard or release gate exists.",
    nextAction:
      "Add eval runner output and admin dashboard for prompt/model changes.",
  },
  {
    id: "DB-001",
    category: "Database Schema",
    requirement:
      "Provide minimum core tables for tenants, users, roles, assets, asset hierarchy, and work orders.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "supabase/migrations/20251025000000_create_javis_system.sql",
      "supabase/migrations/008_industrial_platform_merged.sql",
      "supabase/migrations/20251019084824_create_maintenance_tables.sql",
    ],
    gap: "Several broad platform tables exist, but schema naming and ownership are inconsistent and not packaged specifically for Reliability Copilot.",
    nextAction:
      "Create a Copilot schema map and migrations that reference canonical tables explicitly.",
  },
  {
    id: "DB-002",
    category: "Database Schema",
    requirement:
      "Provide failure events, failure modes, and failure causes tables.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "supabase/migrations/20260405200000_add_industry_intelligence_templates.sql",
      "supabase/seed/014_oil_sands_failure_modes.sql",
    ],
    gap: "Failure modes exist as industry templates, but failure events and governed causes are not wired to Copilot imports/cases.",
    nextAction: "Add normalized failure event and cause taxonomy tables.",
  },
  {
    id: "DB-003",
    category: "Database Schema",
    requirement:
      "Provide FRACAS cases, corrective actions, and evidence items.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "supabase/migrations/20260323065617_20260323090000_add_evidence_and_escalation.sql",
      "supabase/migrations/003_work_management.sql",
    ],
    gap: "Evidence and corrective action fragments exist, but exact FRACAS case/action/evidence schema is missing.",
    nextAction: "Add first-class FRACAS tables and RLS policies.",
  },
  {
    id: "DB-004",
    category: "Database Schema",
    requirement: "Provide documents and document chunks.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "supabase/migrations/20251024080921_enable_vector_and_create_rag_system.sql",
      "scripts/reliability_rag_corpus.py",
    ],
    gap: "Vector/RAG tables exist and local chunks exist, but generated reliability chunks are not tenant-indexed.",
    nextAction:
      "Load chunks with source metadata, rights metadata, page references, and embeddings.",
  },
  {
    id: "DB-005",
    category: "Database Schema",
    requirement:
      "Provide conversations, messages, calculations, and analysis reports.",
    status: "partial",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "supabase/migrations/20251024080921_enable_vector_and_create_rag_system.sql",
    ],
    gap: "Conversation tables exist broadly, but calculations and Copilot analysis reports are not persisted.",
    nextAction:
      "Persist report, message, and calculation records from Copilot.",
  },
  {
    id: "DB-006",
    category: "Database Schema",
    requirement: "Provide audit logs and integrations.",
    status: "partial",
    priority: "P0",
    phase: "Phase 5",
    evidence: [
      "supabase/migrations/20260405000000_add_audit_triggers_and_rls.sql",
      "supabase/migrations/006_integrations_intelligence.sql",
    ],
    gap: "Audit/integration infrastructure exists, but Copilot-specific event coverage is incomplete.",
    nextAction: "Add Copilot audit events and integration records.",
  },
  {
    id: "GOV-001",
    category: "Safety And Governance",
    requirement: "Require human approval for PM interval changes.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Approval boundary is displayed, but no approval queue or enforcement exists for Copilot changes.",
    nextAction:
      "Connect recommendations to approval workflow before allowing action export.",
  },
  {
    id: "GOV-002",
    category: "Safety And Governance",
    requirement:
      "Require human approval for safety, environmental, regulatory, production-impact, pressure equipment, lifting, electrical protection, shutdown/startup, OEM-limit, and operating-envelope decisions.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
    ],
    gap: "The policy is stated, but runtime approval routing and blocking are not enforced.",
    nextAction: "Add high-risk recommendation classifier and approval gating.",
  },
  {
    id: "GOV-003",
    category: "Safety And Governance",
    requirement:
      "Every recommendation includes evidence used, assumptions, confidence, consequence of being wrong, required validation, owner role, and approval requirement.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Structured governed recommendations now include the required fields in deterministic reports; live LLM runtime must reuse this schema when connected.",
    nextAction:
      "Enforce the governed recommendation schema in server-side agent responses.",
  },
  {
    id: "GOV-004",
    category: "Safety And Governance",
    requirement: "Track assumptions.",
    status: "partial",
    priority: "P1",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Reports now list assumptions, but there is no persisted assumption register with impact, validation owner, and status.",
    nextAction:
      "Add saved assumption register tied to reports, cases, and recommendations.",
  },
  {
    id: "GOV-005",
    category: "Safety And Governance",
    requirement: "Track confidence scoring.",
    status: "partial",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/lib/reliability-report-engine.test.ts",
    ],
    gap: "Confidence is computed from record count only; source quality, data completeness, sample size, and assumption burden are not modeled.",
    nextAction: "Expand confidence model and explain confidence drivers.",
  },
  {
    id: "GOV-006",
    category: "Safety And Governance",
    requirement: "Maintain audit trail for AI recommendations.",
    status: "partial",
    priority: "P0",
    phase: "Phase 5",
    evidence: [
      "supabase/migrations/20260405000000_add_audit_triggers_and_rls.sql",
      "docs/CONTROL_PLANE_AUDIT.md",
    ],
    gap: "Audit infrastructure exists, but Copilot output audit trail is not implemented.",
    nextAction:
      "Log prompt, model, files, retrieved chunks, calculations, recommendations, approvals, edits, and exports.",
  },
  {
    id: "GOV-007",
    category: "Safety And Governance",
    requirement: "Track recommendation lifecycle.",
    status: "missing",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "User-provided spec; no current product workflow implements this.",
    ],
    gap: "No lifecycle state connects recommendation issued, approved, work order created, completed, verified, benefit captured, and lessons learned.",
    nextAction: "Build recommendation lifecycle table and UI.",
  },
  {
    id: "GOV-008",
    category: "Safety And Governance",
    requirement: "Track ROI and benefit capture.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: [
      "docs/90-day-pilot-playbook.md",
      "docs/market-domination-roadmap.md",
    ],
    gap: "Pilot docs mention business value, but no product module captures avoided downtime, cost reduction, risk reduction, or benefit verification.",
    nextAction: "Add benefit capture fields and executive ROI summary.",
  },
  {
    id: "EVAL-001",
    category: "Evaluation Suite",
    requirement: "Test MTBF calculation correctness.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/lib/reliability-calculations.test.ts"],
    gap: "No material gap.",
    nextAction: "Keep expanding calculation coverage as tools are added.",
  },
  {
    id: "EVAL-002",
    category: "Evaluation Suite",
    requirement: "Test availability calculation correctness.",
    status: "implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["src/lib/reliability-calculations.test.ts"],
    gap: "No material gap.",
    nextAction: "Keep test tolerance explicit for future variants.",
  },
  {
    id: "EVAL-003",
    category: "Evaluation Suite",
    requirement: "Test hallucination resistance.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: ["microsoft/foundry/evals.jsonl"],
    gap: "Eval examples exist, but no automated LLM eval runner is wired into CI.",
    nextAction: "Add eval runner for live prompt/model responses.",
  },
  {
    id: "EVAL-004",
    category: "Evaluation Suite",
    requirement: "Test citation accuracy.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "microsoft/foundry/evals.jsonl",
      "tests/test_reliability_rag_query.py",
    ],
    gap: "RAG retrieval tests exist, but no answer-level citation accuracy eval exists.",
    nextAction:
      "Add RAG answer evals that verify cited chunk/source/page support claims.",
  },
  {
    id: "EVAL-005",
    category: "Evaluation Suite",
    requirement: "Test RCA completeness.",
    status: "partial",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-report-engine.test.ts"],
    gap: "Report tests cover presence of workflow actions, but not RCA quality dimensions.",
    nextAction:
      "Add rubric-based tests for problem statement, timeline, evidence, hypotheses, causes, actions, verification, and recurrence.",
  },
  {
    id: "EVAL-006",
    category: "Evaluation Suite",
    requirement: "Test FMEA structure quality.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 4",
    evidence: ["microsoft/foundry/evals.jsonl"],
    gap: "No automated test validates FMEA rows.",
    nextAction: "Add FMEA structured-output tests after FMEA builder exists.",
  },
  {
    id: "EVAL-007",
    category: "Evaluation Suite",
    requirement: "Test unsafe recommendation refusal.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 1",
    evidence: [
      "microsoft/foundry/evals.jsonl",
      "microsoft/foundry/reliability-engineering-copilot.prompt.md",
    ],
    gap: "Prompt and eval intent exist, but not automated against live runtime.",
    nextAction: "Add unsafe recommendation tests to CI/eval runner.",
  },
  {
    id: "EVAL-008",
    category: "Evaluation Suite",
    requirement: "Test CMMS work-order parsing accuracy.",
    status: "partial",
    priority: "P1",
    phase: "Phase 2",
    evidence: ["src/lib/reliability-report-engine.test.ts"],
    gap: "CSV parser tests exist, but no SAP/Maximo/Oracle/Hexagon fixture coverage exists.",
    nextAction: "Add representative CMMS export fixtures and parser tests.",
  },
  {
    id: "MS-001",
    category: "Microsoft Distribution",
    requirement: "Make product available in front of Microsoft customers.",
    status: "partial",
    priority: "P0",
    phase: "Launch",
    evidence: [
      "microsoft/marketplace/appsource-listing.md",
      "docs/azure-marketplace.md",
    ],
    gap: "Listing and marketplace plumbing exist, but Partner Center submission and verification are not complete.",
    nextAction:
      "Complete Partner Center publisher verification and submit a private pilot offer/listing.",
  },
  {
    id: "MS-002",
    category: "Microsoft Distribution",
    requirement: "Provide Teams / Microsoft 365 integration.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Launch",
    evidence: [
      "microsoft/teams/manifest.json",
      "microsoft/teams/adaptive-cards",
    ],
    gap: "Teams manifest and cards are scaffolded, but bot endpoint, SSO, command routing, icons, and sideload validation are missing.",
    nextAction:
      "Create Entra app, bot/Foundry endpoint, replace IDs, add icons, and test sideload.",
  },
  {
    id: "MS-003",
    category: "Microsoft Distribution",
    requirement:
      "Evaluate whether Microsoft Foundry multi-agent templates accelerate the product.",
    status: "implemented",
    priority: "P1",
    phase: "Launch",
    evidence: [
      "docs/microsoft-teams-distribution-plan.md",
      "microsoft/README.md",
    ],
    gap: "Decision captured: Foundry is fastest for Microsoft-native front door; SyncAI app remains system of record.",
    nextAction:
      "Create the actual Foundry agent in Azure tenant and bind it to tool actions.",
  },
  {
    id: "MS-004",
    category: "Microsoft Distribution",
    requirement: "Provide Azure Marketplace SaaS transaction flow.",
    status: "partial",
    priority: "P0",
    phase: "Launch",
    evidence: [
      "docs/azure-marketplace.md",
      "src/lib/azure-marketplace.ts",
      "supabase/functions/marketplace-resolve/index.ts",
      "supabase/migrations/20260430120000_azure_marketplace_integration.sql",
    ],
    gap: "Code path and runbook exist, but production envs and Partner Center offer activation are not complete.",
    nextAction:
      "Configure production secrets, verify offer IDs, test resolve/activate/status end to end.",
  },
  {
    id: "MS-005",
    category: "Microsoft Distribution",
    requirement: "Complete Partner Center identity / publisher verification.",
    status: "owner-gate",
    priority: "P0",
    phase: "Launch",
    evidence: ["microsoft/technical-gap-checklist.md"],
    gap: "Requires Stigg/SyncAI account owner action in Partner Center.",
    nextAction:
      "Submit identity, seller profile, legal business profile, and marketplace program verification.",
  },
  {
    id: "MS-006",
    category: "Microsoft Distribution",
    requirement: "Deploy public app.",
    status: "partial",
    priority: "P0",
    phase: "Launch",
    evidence: ["https://repo-lime-nu.vercel.app/demo/copilot"],
    gap: "Public demo is deployed, but production auth/data env vars are not configured and custom domain is not attached.",
    nextAction:
      "Add Supabase/OpenAI/Azure env vars, custom domain, and production deployment checks.",
  },
  {
    id: "MS-007",
    category: "Microsoft Distribution",
    requirement: "Provide Vercel/public demo that delivers product results.",
    status: "implemented",
    priority: "P0",
    phase: "Launch",
    evidence: [
      "src/App.tsx",
      "src/pages/ReliabilityCopilotPage.tsx",
      "https://repo-lime-nu.vercel.app/demo/copilot",
    ],
    gap: "Demo produces local deterministic reports; production SaaS backend is not complete.",
    nextAction:
      "Keep the demo live while backend/RAG/Teams features are added.",
  },
  {
    id: "GTM-001",
    category: "Commercial Packaging",
    requirement: "Define Starter, Professional, and Enterprise tiers.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "GTM",
    evidence: [
      "docs/reliability-engineering-copilot-prd.md",
      "microsoft/marketplace/appsource-listing.md",
    ],
    gap: "Tiers are documented, but billing plans, entitlements, pricing, and marketplace offer plans are not configured.",
    nextAction:
      "Map tiers to billing plans, entitlements, marketplace plan IDs, and feature flags.",
  },
  {
    id: "GTM-002",
    category: "Commercial Packaging",
    requirement: "Provide pilot onboarding playbook.",
    status: "implemented",
    priority: "P1",
    phase: "GTM",
    evidence: [
      "docs/90-day-pilot-playbook.md",
      "microsoft/pilot/onboarding-checklist.md",
      "microsoft/pilot/design-partner-sow.md",
    ],
    gap: "Pilot docs exist; they need customer-specific tailoring during sales.",
    nextAction:
      "Use these docs for design partner outreach and paid pilot packaging.",
  },
  {
    id: "GTM-003",
    category: "Commercial Packaging",
    requirement: "Provide consulting/service layer.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "GTM",
    evidence: [
      "docs/90-day-pilot-playbook.md",
      "docs/market-domination-roadmap.md",
    ],
    gap: "Service offers are described but not packaged into public pricing/SOW variants.",
    nextAction:
      "Create fixed-scope offers for data quality assessment, RCA sprint, PM optimization sprint, and FRACAS setup.",
  },
  {
    id: "GTM-004",
    category: "Commercial Packaging",
    requirement: "Provide sales collateral, demo scripts, and ROI model.",
    status: "partial",
    priority: "P1",
    phase: "GTM",
    evidence: [
      "microsoft/marketplace/appsource-listing.md",
      "docs/90-day-pilot-playbook.md",
    ],
    gap: "Listing and pilot flow exist, but formal deck, demo script, ROI calculator, and screenshots are not complete.",
    nextAction:
      "Create AppSource screenshots, short demo script, and ROI worksheet from Copilot outputs.",
  },
  {
    id: "CLOSED-001",
    category: "Closed-Loop Reliability Workflow",
    requirement:
      "Implement loop from data ingestion to data quality check to asset risk ranking to bad actor detection.",
    status: "partial",
    priority: "P0",
    phase: "Phase 2",
    evidence: [
      "src/lib/reliability-report-engine.ts",
      "src/pages/ReliabilityCopilotPage.tsx",
    ],
    gap: "Data ingestion and bad actor detection exist for CSV; data quality engine and asset risk ranking are missing.",
    nextAction:
      "Add data quality checks and criticality/risk scoring before RCA/FRACAS routing.",
  },
  {
    id: "CLOSED-002",
    category: "Closed-Loop Reliability Workflow",
    requirement:
      "Implement loop from bad actor detection to RCA/FMEA/RCM to recommendation.",
    status: "partial",
    priority: "P0",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Mode-specific report recommendations exist, but no structured RCA/FMEA/RCM case objects exist.",
    nextAction:
      "Create saved workflow artifacts that are generated from bad actor analysis.",
  },
  {
    id: "CLOSED-003",
    category: "Closed-Loop Reliability Workflow",
    requirement: "Implement approval and work-order/action creation.",
    status: "missing",
    priority: "P0",
    phase: "Phase 3",
    evidence: [
      "User-provided spec; no current Copilot workflow implements this.",
    ],
    gap: "No approval-to-action workflow exists for Copilot recommendations.",
    nextAction:
      "Add recommendation approval records and action/work-order export pathway.",
  },
  {
    id: "CLOSED-004",
    category: "Closed-Loop Reliability Workflow",
    requirement: "Implement effectiveness verification and recurrence checks.",
    status: "captured-not-implemented",
    priority: "P0",
    phase: "Phase 3",
    evidence: ["src/lib/reliability-report-engine.ts"],
    gap: "Verification and recurrence are text recommendations, not tracked workflow states.",
    nextAction:
      "Add effectiveness review schedule and recurrence detection against future failure events.",
  },
  {
    id: "CLOSED-005",
    category: "Closed-Loop Reliability Workflow",
    requirement: "Implement benefit capture.",
    status: "captured-not-implemented",
    priority: "P1",
    phase: "Phase 3",
    evidence: ["docs/90-day-pilot-playbook.md"],
    gap: "Benefits are sales/pilot concepts only; no app fields or reports capture them.",
    nextAction: "Add benefit fields and executive ROI summary.",
  },
  {
    id: "CLOSED-006",
    category: "Closed-Loop Reliability Workflow",
    requirement: "Store lessons learned and improve future recommendations.",
    status: "missing",
    priority: "P2",
    phase: "Phase 3",
    evidence: [
      "User-provided spec; no current product workflow implements this.",
    ],
    gap: "No lessons-learned repository exists for verified cases.",
    nextAction:
      "Add verified lessons learned and optional promotion to tenant knowledge base.",
  },
];

export function summarizeSpecTraceability(requirements = SPEC_REQUIREMENTS) {
  return requirements.reduce(
    (summary, requirement) => {
      summary[requirement.status] += 1;
      return summary;
    },
    {
      implemented: 0,
      partial: 0,
      "captured-not-implemented": 0,
      missing: 0,
      "owner-gate": 0,
    } satisfies Record<SpecStatus, number>,
  );
}

export function getRequirementsByStatus(
  status: SpecStatus,
  requirements = SPEC_REQUIREMENTS,
) {
  return requirements.filter((requirement) => requirement.status === status);
}

export function getP0Gaps(requirements = SPEC_REQUIREMENTS) {
  return requirements.filter(
    (requirement) =>
      requirement.priority === "P0" && requirement.status !== "implemented",
  );
}

export function getRequirementsByCategory(
  category: string,
  requirements = SPEC_REQUIREMENTS,
) {
  return requirements.filter(
    (requirement) => requirement.category === category,
  );
}
