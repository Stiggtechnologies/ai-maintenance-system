/**
 * Sync Develop architecture and persistence contract.
 *
 * This is intentionally executable product metadata rather than a diagram
 * that can drift away from the implementation. The case workspace renders it,
 * while the conformance suite inventories every Develop route, RPC and AI edge
 * function against it. Adding an unclassified boundary therefore fails CI.
 */

export type DevelopArchitectureLayerKey =
  | "experience"
  | "decision-workflow"
  | "intelligence"
  | "governance"
  | "knowledge-graph"
  | "enterprise-data"
  | "trust-security";

export interface DevelopArchitectureLayer {
  key: DevelopArchitectureLayerKey;
  label: string;
  responsibility: string;
  implementation: string;
}

export const DEVELOP_ARCHITECTURE_LAYERS: readonly DevelopArchitectureLayer[] =
  [
    {
      key: "experience",
      label: "Experience",
      responsibility: "Role-specific customer surfaces",
      implementation: "React routes and Development Case workspace panels",
    },
    {
      key: "decision-workflow",
      label: "Decision & workflow",
      responsibility: "Governed lifecycle acts and human decisions",
      implementation: "Typed service calls into canonical database RPCs",
    },
    {
      key: "intelligence",
      label: "Intelligence",
      responsibility: "Deterministic analysis and advisory AI",
      implementation:
        "Versioned calculation kernels and JWT-scoped advisory edge functions",
    },
    {
      key: "governance",
      label: "Governance",
      responsibility: "Methodology, authority, policy, assurance and audit",
      implementation:
        "Rules-as-data, SECURITY DEFINER act sites and persistence triggers",
    },
    {
      key: "knowledge-graph",
      label: "Enterprise knowledge graph",
      responsibility: "Objective-to-outcome traceability",
      implementation: "Postgres foreign keys, join tables and recursive CTEs",
    },
    {
      key: "enterprise-data",
      label: "Enterprise data",
      responsibility: "Governed source-system facts",
      implementation: "One ingest contract plus canonical operational stores",
    },
    {
      key: "trust-security",
      label: "Trust & security",
      responsibility: "Identity, tenancy, provenance and model controls",
      implementation:
        "JWT identity, organization RLS, evidence and audit walls",
    },
  ] as const;

export interface DevelopRouteArchitecture {
  path: string;
  audiences: readonly string[];
  workflow: string;
  engines: readonly string[];
  authority: "read-only" | "governed-human-acts";
}

export const DEVELOP_ROUTE_ARCHITECTURE: readonly DevelopRouteArchitecture[] = [
  {
    path: "/develop",
    audiences: ["PM", "Assurance"],
    workflow: "Case portfolio",
    engines: ["Frame", "Govern"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/new",
    audiences: ["PM", "Engineer"],
    workflow: "Opportunity intake",
    engines: ["Frame"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/portfolio",
    audiences: ["Executive", "PM"],
    workflow: "Portfolio allocation",
    engines: ["Value", "Realize"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/operational-readiness",
    audiences: ["Ops", "Assurance"],
    workflow: "Operational readiness",
    engines: ["Ready"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/handover",
    audiences: ["Ops", "Maintenance"],
    workflow: "System handover",
    engines: ["Ready"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/cases/:caseId",
    audiences: [
      "Executive",
      "PM",
      "Engineer",
      "Ops",
      "Maintenance",
      "Assurance",
    ],
    workflow: "End-to-end case",
    engines: [
      "Frame",
      "Value",
      "Govern",
      "Design",
      "Control",
      "Deliver",
      "Ready",
      "Realize",
    ],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/cases/:caseId/gates/:gateId/review",
    audiences: ["Executive", "Assurance"],
    workflow: "Gate review",
    engines: ["Govern"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/cases/:caseId/assurance",
    audiences: ["Assurance", "Engineer"],
    workflow: "Assurance case",
    engines: ["Govern"],
    authority: "governed-human-acts",
  },
  {
    path: "/develop/cases/:caseId/transition",
    audiences: ["Ops", "Maintenance"],
    workflow: "Transition readiness",
    engines: ["Ready"],
    authority: "governed-human-acts",
  },
  {
    path: "/execution-readiness",
    audiences: ["PM", "Ops"],
    workflow: "Execution release",
    engines: ["Deliver"],
    authority: "governed-human-acts",
  },
  {
    path: "/executive/capital",
    audiences: ["Executive"],
    workflow: "Capital briefing",
    engines: ["Value", "Control", "Realize"],
    authority: "read-only",
  },
  {
    path: "/sync-field",
    audiences: ["PM", "Ops"],
    workflow: "Field execution",
    engines: ["Deliver"],
    authority: "governed-human-acts",
  },
  {
    path: "/design",
    audiences: ["Engineer", "Maintenance"],
    workflow: "Reliability by design",
    engines: ["Design"],
    authority: "governed-human-acts",
  },
  {
    path: "/recovery",
    audiences: ["Ops", "Maintenance"],
    workflow: "Live recovery",
    engines: ["Deliver", "Realize"],
    authority: "governed-human-acts",
  },
  {
    path: "/risk",
    audiences: ["Executive", "PM", "Engineer", "Assurance"],
    workflow: "ISO 31000 risk",
    engines: ["Govern", "Control"],
    authority: "governed-human-acts",
  },
] as const;

export interface DevelopAiSurface {
  functionName: string;
  purpose: string;
  layer: "intelligence";
  authority: "advisory-only";
}

export const DEVELOP_AI_SURFACES: readonly DevelopAiSurface[] = [
  {
    functionName: "develop-operational-readiness-agent",
    purpose: "Readiness evidence briefing",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-evidence-agent",
    purpose: "Evidence and gap assembly",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-gate-agent",
    purpose: "Gate evidence briefing",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-methodology-agent",
    purpose: "Draft methodology proposal",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-risk-agent",
    purpose: "Draft risk treatment advice",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-requirements-agent",
    purpose: "Requirement gaps and drafts",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-change-impact-agent",
    purpose: "Change impact briefing",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-contract-strategy-agent",
    purpose: "Contract strategy advice",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-lessons-agent",
    purpose: "Applicable lesson screening",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-benefits-agent",
    purpose: "Benefits evidence briefing",
    layer: "intelligence",
    authority: "advisory-only",
  },
  {
    functionName: "develop-handover-agent",
    purpose: "Evidence-linked handover draft",
    layer: "intelligence",
    authority: "advisory-only",
  },
] as const;

export type DevelopRpcLayer = "decision-workflow" | "intelligence";

export const DEVELOP_RPC_BOUNDARY = {
  intelligence:
    "Reads, screens and validated calculations enter through the Intelligence service boundary.",
  actions:
    "State changes enter through governed Decision & Workflow acts; the browser never writes a D-family table directly.",
  failClosed:
    "A new RPC verb is unclassified until the architecture contract admits it explicitly.",
} as const;

const INTELLIGENCE_RPC_PREFIXES = new Set([
  "case",
  "check",
  "compute",
  "get",
  "run",
  "screen",
]);

const GOVERNED_ACTION_RPC_PREFIXES = new Set([
  "abandon",
  "accept",
  "acknowledge",
  "add",
  "adopt",
  "advance",
  "answer",
  "apply",
  "approve",
  "assemble",
  "assess",
  "assign",
  "attest",
  "attribute",
  "award",
  "bind",
  "cancel",
  "capture",
  "carry",
  "certify",
  "clear",
  "close",
  "complete",
  "create",
  "decide",
  "declare",
  "designate",
  "dismiss",
  "disposition",
  "draft",
  "draw",
  "establish",
  "forecast",
  "grade",
  "implement",
  "initialize",
  "invite",
  "link",
  "open",
  "propagate",
  "propose",
  "raise",
  "reanchor",
  "record",
  "register",
  "release",
  "renew",
  "request",
  "resolve",
  "respond",
  "retire",
  "review",
  "sanction",
  "save",
  "score",
  "seed",
  "select",
  "set",
  "sever",
  "sign",
  "start",
  "state",
  "submit",
  "unlink",
  "upsert",
  "verify",
  "withdraw",
]);

/**
 * Classifies the production service boundary. Unknown verbs return null so a
 * new RPC cannot silently enter the product without an architecture decision.
 */
export function classifyDevelopRpc(name: string): DevelopRpcLayer | null {
  const prefix = name.split("_", 1)[0];
  if (INTELLIGENCE_RPC_PREFIXES.has(prefix)) return "intelligence";
  if (GOVERNED_ACTION_RPC_PREFIXES.has(prefix)) return "decision-workflow";
  return null;
}

export interface DevelopPersistenceDomain {
  key: string;
  label: string;
  authoritativeFor: string;
  mechanism: string;
  prohibition: string;
}

export const DEVELOP_PERSISTENCE_MAP: readonly DevelopPersistenceDomain[] = [
  {
    key: "relational",
    label: "Authoritative relational",
    authoritativeFor:
      "Every D-family business object, state, authority and decision",
    mechanism: "Supabase Postgres tables, foreign keys, RLS and governed RPCs",
    prohibition: "No client-local or parallel business-object system of record",
  },
  {
    key: "graph",
    label: "Knowledge graph projection",
    authoritativeFor:
      "Objective ↔ requirement ↔ risk ↔ decision ↔ asset ↔ work traversal",
    mechanism: "The same Postgres foreign keys, join tables and recursive CTEs",
    prohibition: "No Neo4j copy and no independently mutable graph",
  },
  {
    key: "object",
    label: "Object evidence",
    authoritativeFor:
      "Source documents, deliverable files and evidence artifacts",
    mechanism: "Supabase Storage plus governed KB/document intake metadata",
    prohibition:
      "A blob never becomes an approved fact without evidence provenance",
  },
  {
    key: "vector",
    label: "Vector retrieval",
    authoritativeFor: "Discovery over approved knowledge chunks only",
    mechanism: "pgvector-backed reliability knowledge retrieval",
    prohibition:
      "Similarity is not authority, approval or a business-object store",
  },
  {
    key: "time-series",
    label: "Operational observations",
    authoritativeFor: "Condition readings and operating-state observations",
    mechanism: "Canonical ingest into Postgres observation tables",
    prohibition: "No duplicate D-family state and no ungoverned dedicated TSDB",
  },
  {
    key: "event-workflow-rules",
    label: "Events, workflow and rules",
    authoritativeFor:
      "Named events, lifecycle transitions and governance conditions",
    mechanism: "Postgres triggers, SECURITY DEFINER acts and rules-as-data",
    prohibition: "No Kafka, Temporal or second rules/workflow engine",
  },
  {
    key: "lineage-model-audit",
    label: "Lineage, models and audit",
    authoritativeFor:
      "Calculation runs, model approvals and immutable act history",
    mechanism:
      "calculation_runs, model_register, audit_events and security_events",
    prohibition:
      "No silent model swap, unversioned calculation or second audit ledger",
  },
] as const;

export const DEVELOP_ARCHITECTURE_BOUNDARY = {
  llm: "Every AI edge function is confined to the Intelligence layer and remains advisory-only.",
  authority:
    "Decision authority lives in governed human act sites and persistence triggers, never in a route or model response.",
  persistence:
    "Postgres remains authoritative; graph, vector, object and time-series capabilities are scoped projections or evidence stores.",
} as const;

/** Production accessor consumed by the case workspace. */
export function developArchitectureContract() {
  return {
    layers: DEVELOP_ARCHITECTURE_LAYERS,
    routes: DEVELOP_ROUTE_ARCHITECTURE,
    aiSurfaces: DEVELOP_AI_SURFACES,
    rpcBoundary: DEVELOP_RPC_BOUNDARY,
    boundary: DEVELOP_ARCHITECTURE_BOUNDARY,
  } as const;
}

/** Production accessor kept separate so persistence drift is review-visible. */
export function developPersistenceContract() {
  return DEVELOP_PERSISTENCE_MAP;
}
