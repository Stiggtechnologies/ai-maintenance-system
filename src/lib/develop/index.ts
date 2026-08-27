/**
 * Sync Develop — pure helpers for the case workspace (Slice 1).
 *
 * THE RULE THAT SHAPES THIS FILE: assessGate (src/lib/lifecycle/stages.ts)
 * stays the single gate evaluator on this platform (overlap-map ruling 1).
 * This module does not re-implement readiness arithmetic; it maps the
 * get_development_case JSON onto assessGate's inputs and returns its verdict.
 * The weighted Σ(w·r)/Σw readiness percentage is D3.35 (build-plan Slice 1
 * row 10, a separate workstream) — nothing here fabricates a percentage.
 */
import {
  assessGate,
  type GateAssessment,
  type GateCriterion,
  type GateFinding,
} from "../lifecycle/stages";

export const LIFECYCLE_TYPES = [
  { value: "greenfield", label: "Greenfield" },
  { value: "brownfield", label: "Brownfield" },
  { value: "sustaining_capital", label: "Sustaining capital" },
  { value: "replacement", label: "Replacement" },
  { value: "reliability_improvement", label: "Reliability improvement" },
  { value: "regulatory", label: "Regulatory" },
  { value: "capacity", label: "Capacity" },
  { value: "life_extension", label: "Life extension" },
  { value: "decommissioning", label: "Decommissioning" },
] as const;

export const GATE_OUTCOMES = [
  { value: "proceed", label: "Proceed" },
  { value: "proceed_with_conditions", label: "Proceed with conditions" },
  { value: "hold", label: "Hold" },
  { value: "recycle", label: "Recycle" },
  { value: "pivot", label: "Pivot" },
  { value: "redesign", label: "Redesign" },
  { value: "pause", label: "Pause" },
  { value: "terminate", label: "Terminate" },
] as const;

/** Descending authority (register standing constraint 1). */
export const SOURCE_AUTHORITY_TIERS = [
  "LAW",
  "REGULATION",
  "CORPORATE_STANDARD",
  "PROJECT_FRAMEWORK",
  "CONTRACT",
  "INDUSTRY_GUIDANCE",
  "BEST_PRACTICE",
  "AI_SUGGESTION",
] as const;

export interface WorkspaceCriterion {
  id: number;
  criterion: string;
  isMandatory: boolean;
  guidance: string | null;
  category: string | null;
  evidenceType: string | null;
  minimumConfidence: number | null;
  sourceAuthority: string;
}

export interface WorkspaceReviewFinding {
  criterion: string;
  status: "met" | "not_met" | "not_assessed";
  evidence: string | null;
}

export interface WorkspaceCondition {
  id: number;
  description: string;
  dueDate: string;
  status: string;
  evidenceRequirement: string;
  consequenceIfMissed: string;
  owner: string | null;
}

export interface WorkspaceReview {
  id: number;
  outcome: string;
  reviewedAt: string;
  note: string | null;
  findings: WorkspaceReviewFinding[];
  conditions: WorkspaceCondition[];
}

export interface WorkspaceGate {
  id: number;
  name: string;
  sequence: number;
  decisionType: "gate" | "checkpoint";
  independentAssuranceRequired: boolean;
  readinessThreshold: number | null;
  criteria: WorkspaceCriterion[];
  latestReview: WorkspaceReview | null;
}

export interface WorkspaceStage {
  stageKey: string;
  displayName: string;
  sequence: number;
  purpose: string | null;
  isCurrent: boolean;
  gates: WorkspaceGate[];
}

export interface CaseWorkspace {
  id: string;
  title: string;
  status: string;
  lifecycleType: string;
  problemStatement: string;
  opportunityStatement: string | null;
  businessUnit: string | null;
  estimatedCapex: number | null;
  expectedValue: number | null;
  currentStageKey: string | null;
  createdAt: string;
  sponsor: string | null;
  sanction: {
    sanctionedAt: string;
    sanctionedValue: number | null;
    note: string | null;
    by: string | null;
  } | null;
  framework: {
    id: string;
    name: string;
    version: number;
    source: string;
    sourceAuthority: string;
    status: string;
  } | null;
  stages: WorkspaceStage[];
}

export interface GateRollup {
  assessment: GateAssessment;
  criteriaTotal: number;
  mandatoryTotal: number;
  hasReview: boolean;
  latestOutcome: string | null;
}

/**
 * Per-gate requirement rollup: assessGate's verdict over the gate's criteria
 * and the LATEST review's findings. No review means no findings — and
 * assessGate treats that silence as blocking, which is the honest reading:
 * a gate nobody has assessed is not partially ready.
 */
export function gateRollup(gate: WorkspaceGate): GateRollup {
  const criteria: GateCriterion[] = gate.criteria.map((c) => ({
    id: c.id,
    criterion: c.criterion,
    isMandatory: c.isMandatory,
    guidance: c.guidance,
  }));
  const findings: GateFinding[] = (gate.latestReview?.findings ?? []).map(
    (f) => ({
      criterion: f.criterion,
      status: f.status,
      evidence: f.evidence,
    }),
  );
  return {
    assessment: assessGate(criteria, findings),
    criteriaTotal: gate.criteria.length,
    mandatoryTotal: gate.criteria.filter((c) => c.isMandatory).length,
    hasReview: gate.latestReview != null,
    latestOutcome: gate.latestReview?.outcome ?? null,
  };
}

/** A terminal outcome ends the conversation at this gate. */
export function isTerminalOutcome(outcome: string | null): boolean {
  return outcome === "terminate";
}

/** Outcomes that clear the gate for stage advancement. */
export function isPassingOutcome(outcome: string | null): boolean {
  return outcome === "proceed" || outcome === "proceed_with_conditions";
}
