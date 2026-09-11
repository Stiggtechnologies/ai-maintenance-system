/**
 * Sync Develop — pure helpers for the case workspace (Slice 1).
 *
 * THE RULE THAT SHAPES THIS FILE: assessGate (src/lib/lifecycle/stages.ts)
 * stays the single gate evaluator on this platform (overlap-map ruling 1).
 * This module does not re-implement readiness arithmetic; it maps the
 * get_development_case JSON onto the assessGate family's inputs and returns
 * its verdicts. The weighted Σ(w·r)/Σw readiness percentage (D3.35) lives in
 * that family too — gateReadiness composes assessGate — and the full §80
 * experience (named risk/condition blockers, deliverable and evidence
 * support, the closure-rate projection with its refusal) renders the
 * get_gate_readiness RPC's rows directly: one query, enforced truth and
 * displayed truth the same rows.
 */
import {
  assessGate,
  gateReadiness,
  type GateAssessment,
  type GateCriterion,
  type GateFinding,
  type WeightedGateReadiness,
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
  weight: number;
  sourceAuthority: string;
  /**
   * D3.19: the APPROVED, UNEXPIRED waiver currently standing in for this
   * requirement on this case. Null when none — absence rendered, not hidden.
   */
  activeWaiver: {
    id: string;
    status: string;
    expiresAt: string;
    justification: string;
  } | null;
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
  /** D3.18 lifecycle: breach survives closure — a late closure stays late. */
  breachedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closureEvidenceId: string | null;
  closureNote: string | null;
}

export interface WorkspaceReview {
  id: number;
  outcome: string;
  reviewedAt: string;
  note: string | null;
  /** D3.07: the recorded zero-based funding answer (spec I.5). */
  fundingContinuationAnswer: string | null;
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
  /**
   * D3.07: true for sanction-type gates (decision_type 'gate' at-or-after
   * the master sanction stage) — where a passing outcome without the
   * zero-based funding answer is refused at the DB.
   */
  fundingQuestionRequired: boolean;
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

/** The six §20 baseline types, verbatim (D5.26). */
export const BASELINE_TYPES = [
  "SCOPE",
  "COST",
  "SCHEDULE",
  "DESIGN",
  "RISK",
  "BENEFITS",
] as const;

export interface WorkspaceBaseline {
  id: string;
  baselineType: (typeof BASELINE_TYPES)[number];
  version: number;
  status: "draft" | "approved" | "superseded";
  description: string;
  content: Record<string, unknown>;
  document: { id: string; title: string } | null;
  approval: {
    approvedAt: string;
    note: string | null;
    by: string | null;
  } | null;
  supersededAt: string | null;
  createdAt: string;
}

/** One imported schedule activity (D5.28 import half — listing only). */
export interface WorkspaceScheduleActivity {
  activityId: string;
  description: string;
  wbsPath: string | null;
  durationHours: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  calendar: string | null;
  sourceSystem: string | null;
  predecessors: string[];
}

/**
 * One imported schedule (a shutdown_events row keyed to this case). P6 stays
 * system-of-record: these rows are read, listed and later analyzed — never
 * written back.
 */
export interface WorkspaceScheduleEvent {
  id: string;
  eventKey: string;
  title: string;
  status: string;
  activities: WorkspaceScheduleActivity[];
}

export interface WorkspaceObjective {
  id: string;
  description: string;
  level: string;
  target: string;
  targetValue: number | null;
  unit: string | null;
  targetDate: string | null;
  tolerance: string;
  status: string;
  owner: string | null;
  ancestors: { id: string; description: string; level: string }[];
  linkedRisks: number;
}

/** The eleven spec-I.3 outcome dimensions, verbatim (D1.01). */
export const SUCCESS_DIMENSIONS = [
  "business",
  "safety",
  "operational",
  "reliability",
  "availability",
  "maintainability",
  "quality",
  "schedule",
  "cost",
  "environmental",
  "stakeholder",
] as const;

export interface WorkspaceSuccessOutcome {
  id: string;
  dimension: (typeof SUCCESS_DIMENSIONS)[number];
  statement: string;
  targetValue: number | null;
  unit: string | null;
  basis: string;
  owner: string | null;
  ramTarget: {
    id: number;
    systemLabel: string;
    targetAvailability: number;
    basis: string | null;
  } | null;
}

export interface WorkspaceSuccessContract {
  id: string;
  version: number;
  status: "draft" | "recorded" | "superseded";
  recordedAt: string | null;
  recordNote: string | null;
  recordedBy: string | null;
  dimensionsTotal: number;
  outcomes: WorkspaceSuccessOutcome[];
}

export interface WorkspaceBusinessCase {
  id: number;
  caseRef: string;
  title: string;
  driver: string;
  status: string;
  currency: string;
  discountRate: number;
  discountRateSource: string | null;
  hypothesis: {
    spend: number;
    effect: string;
    effectQuantity: number | null;
    effectUnit: string | null;
    valuePerYear: number;
    basis: string;
  } | null;
  viability: { floor: number; basis: string } | null;
  optionCount: number;
  createdAt: string;
}

export interface WorkspaceCaseAssumption {
  id: string;
  statement: string;
  status: string;
  confidence: number | null;
  validUntil: string | null;
  owner: string | null;
  businessCaseId: number | null;
  threshold: {
    parameter: string;
    comparator: string;
    value: number;
    unit: string | null;
  } | null;
  invalidation: { invalidatedAt: string; reason: string | null } | null;
}

export interface WorkspaceBenefit {
  id: string;
  label: string | null;
  value: number | null;
  unit: string | null;
  status: string;
  expectedDate: string | null;
  basis: string | null;
  owner: string | null;
  objective: string | null;
  verification: {
    verifiedAt: string;
    note: string | null;
    by: string | null;
  } | null;
}

export interface WorkspaceWaiver {
  id: string;
  requirementId: number;
  criterion: string | null;
  status: string;
  justification: string;
  compensatingControls: string;
  riskId: string | null;
  riskTitle: string | null;
  requestedAt: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  expiresAt: string;
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
  waivers: WorkspaceWaiver[];
  deliverables: WorkspaceDeliverable[];
  evidence: WorkspaceEvidence[];
  risks: WorkspaceRisk[];
  decisions: WorkspaceDecision[];
  actions: WorkspaceAction[];
  baselines: WorkspaceBaseline[];
  schedule: WorkspaceScheduleEvent[];
  objective: WorkspaceObjective | null;
  successContract: WorkspaceSuccessContract | null;
  businessCases: WorkspaceBusinessCase[];
  caseAssumptions: WorkspaceCaseAssumption[];
  benefits: WorkspaceBenefit[];
}

export interface GateRollup {
  assessment: GateAssessment;
  /** Weighted Σ(w·r)/Σw + per-category rollup (gateReadiness, D3.35). */
  readiness: WeightedGateReadiness;
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
  /**
   * D3.07: the zero-based funding question is unanswered on the latest
   * review of a sanction-type gate. Blocks the readiness verdict exactly
   * where record_case_gate_review refuses the pass — displayed truth and
   * enforced truth agree.
   */
  fundingUnanswered: boolean;
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
    weight: c.weight,
    category: c.category,
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
    readiness: gateReadiness(criteria, findings),
    criteriaTotal: gate.criteria.length,
    mandatoryTotal: gate.criteria.filter((c) => c.isMandatory).length,
    hasReview: gate.latestReview != null,
    latestOutcome: gate.latestReview?.outcome ?? null,
    riskBlockers,
    fundingUnanswered:
      gate.fundingQuestionRequired &&
      !(gate.latestReview?.fundingContinuationAnswer ?? "").trim(),
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

// ---------------------------------------------------------------------------
// RPC result shapes — get_gate_readiness / get_case_operational_readiness
// return exactly these rows, and the panels render them without recomputing
// (enforced truth and displayed truth from one query, the #282 principle).
// ---------------------------------------------------------------------------

export type ReadinessCriterionStatus =
  "met" | "not_met" | "not_assessed" | "never_assessed";

export interface ReadinessCriterionRow {
  id: number;
  criterion: string;
  category: string;
  isMandatory: boolean;
  weight: number;
  sourceAuthority: string;
  evidenceType: string | null;
  status: ReadinessCriterionStatus;
  findingEvidence: string | null;
  deliverables: { total: number; accepted: number };
}

export interface ReadinessCategoryRow {
  category: string;
  criteriaTotal: number;
  mandatoryTotal: number;
  metCount: number;
  unmetMandatory: number;
  weightSum: number;
  readinessPct: number | null;
}

export type ReadinessBlocker =
  | {
      type: "mandatory_criterion";
      id: number;
      name: string;
      status: ReadinessCriterionStatus;
      category: string;
    }
  | {
      type: "open_risk";
      id: string;
      name: string;
      level: string;
      status: string;
    }
  | {
      type: "open_condition";
      id: number;
      name: string;
      dueDate: string;
      overdue: boolean;
      gate: string | null;
    }
  | {
      type: "success_contract";
      id: string;
      name: string;
      status: "missing";
    }
  // Slice 3C (D3.11): a permit condition of this case that is missed, or open
  // and past its date. Refused at the persistence boundary
  // (trg_outstanding_obligations_gate) as well as named here.
  | {
      type: "regulatory_condition";
      id: number;
      name: string;
      dueDate: string;
      overdue: boolean;
      domain: string;
      regulator: string;
    }
  // Slice 3C (D3.09): an overdue commitment to an external party that no
  // project requirement carries. Also refused at the persistence boundary.
  | {
      type: "uncovered_commitment";
      id: number;
      name: string;
      dueDate: string;
      overdue: boolean;
      stakeholder: string;
      kind: string;
    }
  // Slice 3C (D3.16): the adopted intensity binding's assurance demand, unmet
  // at this gate. NAMED here; what an assurance demand costs a gate is
  // enforced by the intensity and composite-authority contracts this slice
  // does not re-open, and the register row says so.
  | {
      type: "assurance_not_satisfied";
      id: number;
      name: string;
      demandedLevel: string;
    }
  // Slice 5B (D4.10/D4.11): the frontline design obligations. These ride the
  // SAME predicate family and the same persistence wall as the two above —
  // case_frontline_design_obligations is appended into
  // case_gate_outstanding_obligations, and enforce_gate_review_outstanding_obligations
  // refuses over all of them together. They are declared here because a union
  // that stops short of the types the server actually emits makes the next
  // exhaustive narrow silently omit the differentiator's own blockers.
  | {
      type: "frontline_finding_open";
      id: number;
      name: string;
      dimension: string;
      discipline: string;
      severity: string;
      studyId: number;
      raisedAt: string;
    }
  | {
      type: "frontline_acceptance_uncarried";
      id: number;
      name: string;
      dimension: string;
      discipline: string;
      outcome: string;
      studyId: number;
    }
  | {
      type: "frontline_acceptance_carried_by_failed_requirement";
      id: number;
      name: string;
      dimension: string;
      discipline: string;
      outcome: string;
      requirementId: number;
      requirementRef: string;
      verificationStatus: string;
      studyId: number;
    }
  | {
      type: "frontline_review_unattended";
      id: number;
      name: string;
      studyKind: string;
      performedOn: string | null;
    }
  // Slice 6A (D6.09, spec III.§25): the procurement obligations. Same
  // machinery again — case_procurement_gate_obligations is appended into
  // case_gate_outstanding_obligations and
  // enforce_gate_review_outstanding_obligations refuses over both types. They
  // are declared here for the reason the 5B block gives: a union that stops
  // short of the types the server actually emits makes the next exhaustive
  // narrow silently omit this slice's own blockers.
  | {
      type: "procurement_package_unawarded";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      awardRequiredBy: string;
      leadTimeDays: number;
      commercialStatus: string;
      mandatoryBasis: string;
    }
  | {
      type: "procurement_package_late";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      forecastDeliveryDate: string;
      slippageDays: number;
      deliveryStatus: string;
      mandatoryBasis: string;
    }
  | {
      /**
       * Leg 3: a MANDATORY package whose awarded contract completes after the
       * date the project needs the equipment. Legs 1 and 2 between them left
       * this silent — leg 1 stops the moment anything is awarded and never
       * asks whether the award happened in time, and leg 2 needs a forecast
       * nobody is required to record — so "awarded sixty days late, contract
       * completing 170 days after the project needs it" raised nothing and the
       * gate passed.
       */
      type: "procurement_package_contract_late";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      contractCompletionDate: string;
      slippageDays: number;
      awardedAt: string;
      forecastDeliveryDate: string | null;
      deliveryStatus: string;
      mandatoryBasis: string;
    };

export interface ReadinessProjection {
  available: boolean;
  closureEvents: number;
  requiredEvents: number;
  remaining: number;
  spanDays?: number;
  ratePerDay?: number;
  projectedDate?: string;
  reason?: string;
}

export interface GateReadinessResult {
  caseId: string;
  gateId: number;
  gateName: string;
  decisionType: "gate" | "checkpoint";
  readinessThreshold: number | null;
  blocked: boolean;
  readinessPct: number | null;
  weightSum: number;
  criteriaTotal: number;
  mandatoryTotal: number;
  mandatoryMet: number;
  latestReview: { id: number; outcome: string; reviewedAt: string } | null;
  criteria: ReadinessCriterionRow[];
  categories: ReadinessCategoryRow[];
  blockers: ReadinessBlocker[];
  successContract: {
    id: string;
    version: number;
    recordedAt: string;
    outcomes: number;
    dimensionsCovered: number;
  } | null;
  evidenceSummary: {
    total: number;
    verified: number;
    rejected: number;
    unverified: number;
    aiInferenceUnverified: number;
  };
  /** Slice 3C (D3.16): what this case's adopted governance intensity demands
   *  of THIS gate, and whether a completed, II.15-complete review bound to it
   *  at or above that level exists. */
  assurance: {
    required: boolean;
    demandedLevel: string;
    bindingLevel: string;
    independentRequiredByBinding: boolean;
    gateId: number | null;
    satisfiedByReviewId: string | null;
    satisfied: boolean;
    reviews: {
      id: string;
      level: string;
      status: string;
      conclusion: string | null;
      reviewer: string | null;
      competencies: string[];
      conflictsDeclaredAt: string | null;
      conflictsDeclared: { conflict: string; mitigation: string }[];
      gateId: number | null;
      completedAt: string | null;
    }[];
  };
  projection: ReadinessProjection;
}

export interface OperationalCategoryRow {
  category: string;
  total: number;
  satisfied: number;
  pct: number;
  safetyOpen: number;
  goliveRequiredOpen: number;
}

export interface OperationalHardBlocker {
  assetId: string;
  asset: string;
  assetTag: string | null;
  item: string;
  section: string;
  category: string;
  status: string;
  kind: "safety_mission_critical" | "golive_required";
}

export interface OperationalAssetRow {
  assetId: string;
  name: string;
  tag: string | null;
  required: number;
  requiredSatisfied: number;
  ready: boolean;
  total: number;
  satisfied: number;
}

export interface OperationalReadinessResult {
  caseId: string;
  assetCount: number;
  assets: OperationalAssetRow[];
  categories: OperationalCategoryRow[];
  hardBlockers: OperationalHardBlocker[];
  overall: {
    total: number;
    satisfied: number;
    pct: number;
    hardBlockerCount: number;
    safetyOpenCount: number;
  } | null;
  note?: string;
  scopeNote?: string;
}

export interface SystemOperationalReadinessItem {
  scopeId: number;
  itemId: string;
  assetId: string;
  asset: string;
  assetTag: string | null;
  requirementKey: string;
  item: string;
  category: string;
  ownerId: string;
  owner: string | null;
  requiredBefore: string;
  status: string;
  evidenceItemId: string | null;
  evidenceReady: boolean;
  overdue: boolean;
}

export interface SystemOperationalReadinessResult {
  caseId: string;
  systems: Array<{
    systemId: number;
    systemRef: string;
    title: string;
    currentState: string | null;
    assetCount: number;
    itemCount: number;
    satisfiedCount: number;
    overdueOpenCount: number;
    items: SystemOperationalReadinessItem[];
  }>;
  readinessStore: "asset_onboarding_items";
  decisionBoundary: string;
}

export interface SystemReadinessDesignOrigin {
  originId: number;
  designRequirementId: number;
  requirementRef: string;
  requirementCategory: string;
  requirement: string;
  onboardingRequirementKey: string;
  readinessCategory: string;
  readinessItem: string;
  ownerId: string;
  owner: string | null;
  requiredBefore: string;
  mappingBasis: string;
  mappingEvidenceItemId: string;
  recordedBy: string;
  recordedAt: string;
  materializedItemCount: number;
  fullyMaterialized: boolean;
}

export interface SystemReadinessDesignOriginsResult {
  caseId: string;
  systems: Array<{
    systemId: number;
    systemRef: string;
    title: string;
    assetCount: number;
    originCount: number;
    pendingOriginCount: number;
    origins: SystemReadinessDesignOrigin[];
  }>;
  requirementStore: "design_requirements";
  readinessStore: "asset_onboarding_items";
  acceptanceStore: "system_handover_packages";
  decisionBoundary: string;
}

// ---------------------------------------------------------------------------
// Slice 2 value-spine RPC result shapes — get_case_finance_model,
// get_case_value_trajectory, get_since_sanction_delta return exactly these
// rows; the panels render them (and the kernel's refusal-first numbers)
// without inventing anything.
// ---------------------------------------------------------------------------

export interface FinanceModelOption {
  id: number;
  label: string;
  lifePeriods: number;
  cashFlows: { period: number; amount: number }[];
  benefitProbability: number | null;
  isDoNothing: boolean;
  notes: string | null;
  contingency: number | null;
  contingencyBasis: string | null;
}

export interface FinanceAssumptionRow {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  source: string;
  kind: string;
  effectiveFrom: string;
  reviewDue: string | null;
}

export interface ViabilityThresholdRow {
  assumptionId: string;
  statement: string;
  status: string;
  parameter: string;
  comparator: string;
  threshold: number;
  unit: string | null;
  operativeValue: number | null;
  margin: number | null;
  operativeSource: string | null;
}

export interface CaseFinanceModel {
  caseId: string;
  available: boolean;
  reason?: string;
  businessCase?: {
    id: number;
    caseRef: string;
    title: string;
    driver: string;
    status: string;
    currency: string;
    discountRate: number;
    discountRateSource: string | null;
    decidedAt: string | null;
  };
  hypothesis?: {
    spend: number;
    effect: string;
    effectQuantity: number | null;
    effectUnit: string | null;
    valuePerYear: number;
    basis: string;
  } | null;
  viability?: { floor: number; basis: string } | null;
  options?: FinanceModelOption[];
  npvInputsComplete?: boolean;
  refusals?: string[];
  economicAssumptions?: FinanceAssumptionRow[];
  viabilityThresholds?: ViabilityThresholdRow[];
  fundingConstraints?: {
    capitalPlanItems: {
      label: string;
      planYear: number;
      cost: number;
      benefitPresentValue: number | null;
      mandatory: boolean;
      mandatoryBasis: string | null;
    }[];
    capitalBudgetLines: {
      budgetYear: number;
      category: string;
      budgeted: number;
      committed: number;
      actual: number;
      forecast: number | null;
      forecastBasis: string | null;
    }[];
  };
}

export interface TrajectoryPoint {
  evaluationId: string;
  expectedValue: number;
  evaluatedAt: string;
  basis: string;
  uncertainty: string;
}

export interface TrajectoryGate {
  gateId: number;
  gateName: string;
  stageKey: string;
  stageSequence: number;
  gateSequence: number;
  decisionType: string;
  latestReview: { id: number; outcome: string; reviewedAt: string } | null;
  evaluated: boolean;
  point: TrajectoryPoint | null;
  note: string | null;
}

export interface CaseValueTrajectory {
  caseId: string;
  sanction: { sanctionedAt: string; sanctionedValue: number | null } | null;
  sanctionBaselineEvaluation: TrajectoryPoint | null;
  anchorBaselines: {
    id: string;
    baselineType: string;
    version: number;
    approvedAt: string;
    description: string;
  }[];
  gates: TrajectoryGate[];
  evaluations: (TrajectoryPoint & { linkedToReview: boolean })[];
}

export interface SinceSanctionDelta {
  caseId: string;
  available: boolean;
  reason?: string;
  sanctionedAt?: string;
  sanctionedValue?: number | null;
  anchorBaselines?: {
    id: string;
    baselineType: string;
    version: number;
    approvedAt: string;
    description: string;
    content: Record<string, unknown>;
  }[];
  sanctionBaseline?: {
    evaluationId: string;
    expectedValue: number;
    evaluatedAt: string;
    basis?: string;
    uncertainty?: string;
  };
  current?: {
    evaluationId: string;
    expectedValue: number;
    evaluatedAt: string;
    basis?: string;
    uncertainty?: string;
  };
  dimensions?: {
    dimension: string;
    atSanction: number;
    current: number;
    delta: number;
  }[];
  notComparable?: { dimension: string; reason: string }[];
}

export interface CollapseVerdict {
  evaluated: boolean;
  collapsed?: boolean;
  reason?: string;
  recommendation_id?: string;
  already_open?: boolean;
  expectedValue?: number;
  viabilityFloor?: number;
  headroom?: number;
  gap?: number;
}
