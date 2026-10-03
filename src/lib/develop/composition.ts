/**
 * Sync Develop product composition contract.
 *
 * This is navigation over the existing shared model, not a second module
 * registry or a second workflow engine. Every target below resolves either
 * to a section of the canonical Development Case workspace or to an existing
 * routed surface that already reads the platform's canonical records.
 */

export type DevelopEngineKey =
  | "frame"
  | "value"
  | "govern"
  | "design"
  | "control"
  | "deliver"
  | "ready"
  | "realize";

export type DevelopModuleKey =
  | "frame"
  | "value"
  | "govern"
  | "risk"
  | "design"
  | "control"
  | "supply"
  | "field"
  | "ready"
  | "handover"
  | "reliability"
  | "recovery"
  | "realize"
  | "learn"
  | "portfolio";

export interface DevelopEngineDefinition {
  key: DevelopEngineKey;
  label: string;
  question: string;
  anchor: `engine-${DevelopEngineKey}`;
}

export interface DevelopModuleDefinition {
  key: DevelopModuleKey;
  label: string;
  engine: DevelopEngineKey;
  purpose: string;
  target:
    | { kind: "anchor"; anchor: string }
    | { kind: "route"; path: string; carriesCase: boolean };
}

export const DEVELOP_ENGINES: readonly DevelopEngineDefinition[] = [
  {
    key: "frame",
    label: "Frame",
    question: "Define the problem, opportunity, strategy and options.",
    anchor: "engine-frame",
  },
  {
    key: "value",
    label: "Value",
    question: "Test lifecycle economics, benefits and assumptions.",
    anchor: "engine-value",
  },
  {
    key: "govern",
    label: "Govern",
    question: "Apply the framework, gates, authority and assurance.",
    anchor: "engine-govern",
  },
  {
    key: "design",
    label: "Design",
    question: "Control requirements, interfaces, RAM and configuration.",
    anchor: "engine-design",
  },
  {
    key: "control",
    label: "Control",
    question: "See scope, cost, schedule, risk, resources and change.",
    anchor: "engine-control",
  },
  {
    key: "deliver",
    label: "Deliver",
    question: "Coordinate supply, contractors, field work and constraints.",
    anchor: "engine-deliver",
  },
  {
    key: "ready",
    label: "Ready",
    question: "Prove commissioning, operating readiness and handover.",
    anchor: "engine-ready",
  },
  {
    key: "realize",
    label: "Realize",
    question: "Validate outcomes, benefits, reliability and learning.",
    anchor: "engine-realize",
  },
] as const;

export const DEVELOP_MODULES: readonly DevelopModuleDefinition[] = [
  {
    key: "frame",
    label: "Sync Frame",
    engine: "frame",
    purpose: "Need, opportunity and alternatives",
    target: { kind: "anchor", anchor: "engine-frame" },
  },
  {
    key: "value",
    label: "Sync Value",
    engine: "value",
    purpose: "Economics, assumptions and benefits",
    target: { kind: "anchor", anchor: "engine-value" },
  },
  {
    key: "govern",
    label: "Sync Govern",
    engine: "govern",
    purpose: "Frameworks, gates, authority and assurance",
    target: { kind: "anchor", anchor: "engine-govern" },
  },
  {
    key: "risk",
    label: "Sync Risk",
    engine: "govern",
    purpose: "ISO 31000 risks, controls and treatment",
    target: { kind: "anchor", anchor: "module-risk" },
  },
  {
    key: "design",
    label: "Sync Design",
    engine: "design",
    purpose: "Requirements, interfaces and configuration",
    target: { kind: "anchor", anchor: "engine-design" },
  },
  {
    key: "control",
    label: "Sync Control",
    engine: "control",
    purpose: "Scope, cost, schedule, forecast and change",
    target: { kind: "anchor", anchor: "engine-control" },
  },
  {
    key: "supply",
    label: "Sync Supply",
    engine: "deliver",
    purpose: "Procurement, vendors and contracts",
    target: { kind: "anchor", anchor: "engine-deliver" },
  },
  {
    key: "field",
    label: "Sync Field",
    engine: "deliver",
    purpose: "Work packaging, constraints and field readiness",
    target: { kind: "route", path: "/sync-field", carriesCase: true },
  },
  {
    key: "ready",
    label: "Sync Ready",
    engine: "ready",
    purpose: "Commissioning and operational readiness",
    target: { kind: "anchor", anchor: "engine-ready" },
  },
  {
    key: "handover",
    label: "Sync Handover",
    engine: "ready",
    purpose: "System acceptance and configurable handover",
    target: { kind: "route", path: "/develop/handover", carriesCase: true },
  },
  {
    key: "reliability",
    label: "Sync Reliability",
    engine: "design",
    purpose: "RAM, RCM, FMEA and life data",
    target: { kind: "route", path: "/design", carriesCase: false },
  },
  {
    key: "recovery",
    label: "Sync Recovery",
    engine: "deliver",
    purpose: "Live downtime-event orchestration",
    target: { kind: "route", path: "/recovery", carriesCase: false },
  },
  {
    key: "realize",
    label: "Sync Realize",
    engine: "realize",
    purpose: "Benefits and operating-performance validation",
    target: { kind: "anchor", anchor: "engine-realize" },
  },
  {
    key: "learn",
    label: "Sync Learn",
    engine: "realize",
    purpose: "FRACAS, lessons and standards improvement",
    target: { kind: "anchor", anchor: "module-learn" },
  },
  {
    key: "portfolio",
    label: "Sync Portfolio",
    engine: "realize",
    purpose: "Programs, allocation and interdependencies",
    target: { kind: "route", path: "/develop/portfolio", carriesCase: false },
  },
] as const;

export const DEVELOP_OVERLAYS = [
  "Risk",
  "Quality",
  "Sustainability",
  "HOP",
  "Stakeholders",
  "Evidence",
  "AI",
] as const;

export const DEVELOP_COMPOSITION_BOUNDARY = {
  data: "One shared canonical data model — these modules compose existing records; they do not copy them.",
  authority:
    "Navigation never grants approval authority. Governed decisions remain human, role-checked and audited at the persistence boundary.",
  ai: "AI may explain, detect and prepare. It cannot pass a gate, sanction a project, accept risk or certify readiness.",
} as const;

export function developModuleHref(
  module: DevelopModuleDefinition,
  caseId: string,
): string {
  if (module.target.kind === "anchor") return `#${module.target.anchor}`;
  if (!module.target.carriesCase) return module.target.path;
  return `${module.target.path}?case=${encodeURIComponent(caseId)}`;
}
