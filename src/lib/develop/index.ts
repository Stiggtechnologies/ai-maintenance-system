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

/** The eight §9 evidence provenance classes (D11.17 — one evidence model). */
export const EVIDENCE_CLASSES = [
  "MEASURED",
  "INSPECTED",
  "CALCULATED",
  "TESTED",
  "DOCUMENTED",
  "HISTORICAL",
  "EXPERT_JUDGEMENT",
  "AI_INFERENCE",
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

export interface WorkspaceDeliverable {
  id: string;
  title: string;
  type: string;
  status: "planned" | "submitted" | "accepted" | "rejected";
  revision: string;
  requiredDate: string | null;
  sourceSystem: string | null;
  requirementId: number | null;
  requirement: {
    criterion: string;
    gateId: number | null;
    isMandatory: boolean;
  } | null;
  owner: string | null;
  ownerId: string;
  document: {
    id: string;
    title: string;
    documentClass: string;
    chunkCount: number;
  } | null;
  acceptance: { acceptedAt: string; by: string | null } | null;
  reviewNote: string | null;
}

export interface WorkspaceEvidence {
  id: string;
  evidenceClass: string | null;
  description: string | null;
  sourceSystem: string | null;
  sourceReference: string | null;
  dataQuality: string | null;
  revision: string | null;
  applicability: string | null;
  observedAt: string | null;
  verificationStatus: "unverified" | "verified" | "rejected";
  verification: {
    verifiedAt: string;
    method: string | null;
    note: string | null;
    by: string | null;
  } | null;
  document: { id: string; title: string } | null;
}

export interface WorkspaceRisk {
  id: string;
  title: string;
  status: string;
  currentRiskLevel: string | null;
  residualRiskLevel: string | null;
  decisionAction: string | null;
  reviewDate: string | null;
  owner: string | null;
}

export interface WorkspaceDecisionOption {
  id: string;
  key: string;
  label: string;
  description: string | null;
  capex: number | null;
  opex: number | null;
  lifecycleCost: number | null;
  scheduleEffect: string | null;
  riskEffect: string | null;
  reliabilityEffect: string | null;
  environmentalEffect: string | null;
  expectedValue: number | null;
  isSelected: boolean;
}

export interface WorkspaceDecision {
  id: string;
  question: string | null;
  requiredDate: string | null;
  approvalLevel: string | null;
  createdAt: string;
  owner: string | null;
  objective: string | null;
  options: WorkspaceDecisionOption[];
  selection: {
    optionId: string;
    selectedAt: string;
    rationale: string | null;
    by: string | null;
  } | null;
  evidenceItemIds: string[];
  assumptions: {
    id: string;
    statement: string;
    status: string;
    confidence: number | null;
  }[];
}

export interface WorkspaceAction {
  id: string;
  title: string;
  action: string | null;
  status: string;
  urgency: string | null;
  binding: "direct" | "via_risk";
  riskTitle: string | null;
  createdAt: string;
  verification: {
    status: string;
    dueDate: string;
    dueDateAssumed: boolean;
    result: string | null;
  } | null;
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
  deliverables: WorkspaceDeliverable[];
  evidence: WorkspaceEvidence[];
  risks: WorkspaceRisk[];
  decisions: WorkspaceDecision[];
  actions: WorkspaceAction[];
}

export interface GateRollup {
  assessment: GateAssessment;
  criteriaTotal: number;
  mandatoryTotal: number;
  hasReview: boolean;
  latestOutcome: string | null;
  /**
   * Unresolved High/Critical case risks, as NAMED blockers (D5.22 — gate
   * readiness consumes open case-risks; spec workflow 2). Names, not a
   * percentage: no readiness number exists until D3.35 ships one.
   */
  riskBlockers: string[];
}

/**
 * A case risk counts against gate readiness while it is UNRESOLVED: neither
 * closed nor archived, and not accepted by a human through the ROS
 * acceptance machinery (acceptance IS resolution — someone took it).
 */
export function openRiskBlockers(risks: WorkspaceRisk[]): string[] {
  return risks
    .filter(
      (r) =>
        (r.currentRiskLevel === "High" || r.currentRiskLevel === "Critical") &&
        !["closed", "archived", "accepted"].includes(r.status),
    )
    .map((r) => `Unresolved ${r.currentRiskLevel} risk: ${r.title}`);
}

/**
 * Per-gate requirement rollup: assessGate's verdict over the gate's criteria
 * and the LATEST review's findings. No review means no findings — and
 * assessGate treats that silence as blocking, which is the honest reading:
 * a gate nobody has assessed is not partially ready.
 *
 * `riskBlockers` (openRiskBlockers over the case's risks) ride the rollup so
 * a gate with unresolved HIGH risks shows them as named blockers beside the
 * requirement verdict — consumption, not enforcement: the DB blocks on
 * mandatory criteria; the risk names tell the reviewer what the findings
 * must answer for.
 */
export function gateRollup(
  gate: WorkspaceGate,
  riskBlockers: string[] = [],
): GateRollup {
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
    riskBlockers,
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
