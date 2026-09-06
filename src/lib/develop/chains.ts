/**
 * Sync Develop Slice 3C — the chains: stakeholder commitments and their
 * coverage (D3.08/D3.09), the regulatory approval chain (D3.10/D3.11),
 * case assurance (D3.16) and Evidence Confidence (D11.22).
 *
 * WHAT IS PURE HERE AND WHAT IS NOT. Three things live in this module:
 *
 *   1. THE VOCABULARIES the spec fixes — the five I.19 obligation domains,
 *      the §46 factor grades, the §14 effectiveness values, the §15
 *      strategies. They are `as const` so a select box and a database CHECK
 *      cannot drift apart silently; the slice's static test pins each one
 *      against the migration text.
 *
 *   2. THE TYPES for the get_case_chains payload, so a page cannot read a
 *      key the RPC does not return.
 *
 *   3. `evidenceConfidence` — the §46 calculation, as a DELIBERATE MIRROR of
 *      compute_evidence_confidence in migration 20261122090600. The same
 *      documented-repeat precedent as governance.ts/apply_case_governance
 *      and assessGate/record_case_gate_review: the lib gives an instant,
 *      offline preview of what a weight change would do; the SQL computes
 *      the number the product reports. It is NOT a second source of truth —
 *      the workspace renders the RPC's numbers, and the static test pins
 *      both sides to the same factor set and the same refusal.
 *
 * THE REFUSAL IS THE POINT (§46 + the register row): a missing factor
 * refuses, NAMING it. Not a midpoint, not a zero, not a dropped term. A
 * midpoint invents a measurement; a zero reads as "assessed and worthless";
 * dropping a term silently re-weights the other three.
 */

/** Spec I.19's own list of where approval conditions connect. */
export const OBLIGATION_DOMAINS = [
  { value: "engineering", label: "Engineering" },
  { value: "construction", label: "Construction" },
  { value: "operating_procedure", label: "Operating procedure" },
  { value: "monitoring", label: "Monitoring" },
  { value: "reporting", label: "Reporting" },
] as const;

export type ObligationDomain = (typeof OBLIGATION_DOMAINS)[number]["value"];

/**
 * Where a condition of each domain LANDS (D3.11). Stated here so the screen
 * can tell a user, before they record the condition, which system will carry
 * it — the propagation is not a surprise that happens later.
 */
export const OBLIGATION_DESTINATION: Record<ObligationDomain, string> = {
  engineering: "project requirement",
  construction: "project requirement",
  operating_procedure: "operations work order",
  monitoring: "operations work order",
  reporting: "operations work order",
};

export const COMMITMENT_KINDS = [
  { value: "community", label: "Community" },
  { value: "indigenous", label: "Indigenous" },
  { value: "regulatory", label: "Regulatory" },
  { value: "landowner", label: "Landowner" },
  { value: "employee", label: "Employee" },
  { value: "customer", label: "Customer" },
  { value: "contractual", label: "Contractual" },
  { value: "environmental", label: "Environmental" },
] as const;

/*
 * REQUIREMENT_CATEGORIES lived here and is REMOVED, not moved.
 *
 * It listed the nine categories design_requirements shipped with. Slice 5A
 * replaced the form's source with REQUIREMENT_CATEGORY_GROUPS
 * (src/lib/develop/requirements.ts), which offers §10's eleven and the five
 * reliability-by-design categories in two labelled groups and is pinned
 * against the database CHECK by the slice test. Leaving the old list exported
 * beside it would give a future form a second, shorter vocabulary to pick up
 * — which is how the eleven came to be legal in the table and unwritable
 * through the product in the first place.
 */

/**
 * Spec II.15: the four conclusions an assurance review may reach. Stated as a
 * vocabulary because a form that offers ONE of them is not asking a question —
 * the first draft of the assurance panel hardcoded `acceptable`, so
 * `not_acceptable` was a state the component could render and never write.
 */
export const ASSURANCE_CONCLUSIONS = [
  { value: "acceptable", label: "Acceptable" },
  { value: "acceptable_with_actions", label: "Acceptable, with actions" },
  { value: "not_acceptable", label: "Not acceptable" },
  { value: "inconclusive", label: "Inconclusive" },
] as const;

export type AssuranceConclusion =
  (typeof ASSURANCE_CONCLUSIONS)[number]["value"];

/** Spec II.15: none < line_1 < line_2 < independent. Mirrors
 *  `assurance_level_rank` in migration 20261122090300 — a demanded level is
 *  met by a review AT OR ABOVE it, never below. */
export const ASSURANCE_LEVEL_RANK: Record<string, number> = {
  none: 0,
  line_1: 1,
  line_2: 2,
  independent: 3,
};

/** Spec §14: the two dimensions of a ControlAssessment share one vocabulary. */
export const CONTROL_EFFECTIVENESS_VALUES = [
  "effective",
  "partially_effective",
  "ineffective",
  "not_assessed",
] as const;

export type ControlEffectiveness =
  (typeof CONTROL_EFFECTIVENESS_VALUES)[number];

/** Spec §15 / ISO 31000 6.5.2. */
export const TREATMENT_STRATEGIES = [
  "avoid",
  "pursue_opportunity",
  "remove_source",
  "change_likelihood",
  "change_consequence",
  "share",
  "retain",
] as const;

/** Spec §46 factor grades. */
export const QUALITY_GRADES = ["high", "moderate", "low"] as const;
export const APPLICABILITY_GRADES = [
  "direct",
  "analogous",
  "indirect",
] as const;

export type QualityGrade = (typeof QUALITY_GRADES)[number];
export type ApplicabilityGrade = (typeof APPLICABILITY_GRADES)[number];

/* ───────────────────────── get_case_chains payload ───────────────────────── */

export interface CommitmentStakeholder {
  id: string;
  name: string;
  type: string;
  externalOrganization: string | null;
  relationship: string;
  influence: string | null;
}

export interface CommitmentRequirementRef {
  id: number;
  ref: string;
  category: string;
  requirement: string;
  verificationStatus: string;
}

export interface StakeholderCommitment {
  id: number;
  commitmentRef: string;
  stakeholder: CommitmentStakeholder;
  concern: string;
  commitment: string;
  kind: string;
  requirement: CommitmentRequirementRef | null;
  owner: string | null;
  ownerId: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  breachedAt: string | null;
  evidence: {
    id: string;
    description: string | null;
    evidenceClass: string | null;
    verificationStatus: string;
  } | null;
  closure: { closedAt: string; note: string | null; by: string | null } | null;
  withdrawalReason: string | null;
  createdAt: string;
}

export interface CommitmentCoverage {
  caseId: string;
  commitmentsTotal: number;
  uncoveredCount: number;
  /** Null — never 0, never 100 — when there are no commitments to cover. */
  coveragePct: number | null;
  uncoveredCommitments: {
    commitmentId: number;
    commitmentRef: string;
    stakeholder: string;
    kind: string;
    concern: string;
    commitment: string;
    owner: string | null;
    dueDate: string;
    status: string;
    overdue: boolean;
  }[];
  coveredCommitments: {
    commitmentId: number;
    commitmentRef: string;
    stakeholder: string;
    commitment: string;
    requirementRef: string;
    requirementVerification: string;
  }[];
  requirementsWithoutCommitment: {
    requirementId: number;
    requirementRef: string;
    category: string;
    source: string;
    requirement: string;
    verificationStatus: string;
  }[];
}

export interface CaseRequirement {
  id: number;
  ref: string;
  category: string;
  requirement: string;
  source: string;
  verificationMethod: string | null;
  verificationStatus: string;
  commitmentCount: number;
  createdAt: string;
}

export interface RegulatoryCondition {
  id: number;
  ref: string;
  description: string;
  obligationDomain: ObligationDomain;
  recurrence: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  breachedAt: string | null;
  owner: string | null;
  evidenceRequirement: string;
  consequenceIfMissed: string;
  propagation: {
    at: string;
    requirement: {
      id: number;
      ref: string;
      verificationStatus: string;
    } | null;
    workOrder: {
      id: string;
      number: string | null;
      title: string;
      status: string | null;
      assetId: string | null;
      asset: string | null;
    } | null;
  } | null;
  closure: {
    closedAt: string;
    note: string | null;
    evidenceId: string | null;
    by: string | null;
  } | null;
}

export interface RegulatoryApproval {
  id: number;
  permitNumber: string;
  decidingAuthority: string;
  decision: string;
  decisionDate: string;
  effectiveFrom: string | null;
  expiresAt: string | null;
  perpetual: boolean;
  status: string;
  refusalReason: string | null;
  recordedBy: string | null;
  lapsed: boolean;
  conditions: RegulatoryCondition[];
}

export interface RegulatoryInformationRequest {
  id: number;
  ref: string;
  requestedAt: string;
  responseDue: string;
  detail: string;
  status: string;
  breachedAt: string | null;
  overdue: boolean;
  owner: string | null;
  respondedAt: string | null;
  responseEvidenceId: string | null;
}

export interface RegulatoryApplication {
  id: number;
  ref: string;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  scope: string;
  informationRequests: RegulatoryInformationRequest[];
  approval: RegulatoryApproval | null;
}

export interface RegulatoryRequirement {
  id: number;
  ref: string;
  regulator: string;
  jurisdiction: string;
  instrument: string;
  permitType: string;
  description: string;
  sourceAuthority: string;
  triggerCondition: string;
  expectedLeadTimeDays: number;
  requiredByDate: string | null;
  status: string;
  notRequiredBasis: string | null;
  applications: RegulatoryApplication[];
}

export interface CaseAssuranceReview {
  id: string;
  level: string;
  status: string;
  scope: string;
  conclusion: string | null;
  reviewer: string | null;
  reviewerId: string;
  subjectOwner: string | null;
  competencies: string[];
  competencyBasis: string | null;
  conflictsDeclared: { conflict: string; mitigation: string }[];
  conflictsDeclaredAt: string | null;
  gate: { id: number; name: string } | null;
  findings: unknown[];
  evidenceItemIds: string[];
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface EvidenceConfidenceFactors {
  quality: { grade: string | null; weight: number };
  applicability: { grade: string | null; weight: number };
  freshness: {
    evidenceClass: string | null;
    observedAt: string | null;
    ageDays: number;
    halfLifeDays: number;
    floor: number;
    weight: number;
  };
  verification: { status: string; weight: number };
}

export interface EvidenceConfidenceItem {
  computed: boolean;
  evidenceId: string;
  /** Raw §46 inputs, carried on every item so a grade can be PREVIEWED. */
  evidenceClass: string | null;
  observedAt: string | null;
  verificationStatus: string;
  description: string | null;
  qualityGrade: QualityGrade | null;
  applicabilityGrade: ApplicabilityGrade | null;
  evidenceConfidence?: number;
  evidenceConfidencePct?: number;
  factors?: EvidenceConfidenceFactors;
  profile?: {
    id: string;
    name: string;
    version: number;
    adoptedAt: string | null;
    basis: string;
  };
  refusal?: string;
  missingFactors?: string[];
  reason?: string;
}

export interface CaseEvidenceConfidence {
  caseId: string;
  profile: {
    id: string;
    name: string;
    version: number;
    basis: string;
    quality: Record<string, number>;
    applicability: Record<string, number>;
    verification: Record<string, number>;
    freshness: Record<string, { halfLifeDays: number; floor: number }>;
  } | null;
  scoredCount: number;
  refusedCount: number;
  meanConfidence: number | null;
  items: EvidenceConfidenceItem[];
}

export interface CaseChains {
  caseId: string;
  commitments: StakeholderCommitment[];
  coverage: CommitmentCoverage;
  requirements: CaseRequirement[];
  regulatory: RegulatoryRequirement[];
  assurance: CaseAssuranceReview[];
  evidenceConfidence: CaseEvidenceConfidence;
}

/* ─────────────────── §46 Evidence Confidence, mirrored ──────────────────── */

export interface EvidenceConfidenceWeights {
  quality: Partial<Record<QualityGrade, number>>;
  applicability: Partial<Record<ApplicabilityGrade, number>>;
  verification: Record<string, number>;
  freshness: Record<string, { halfLifeDays: number; floor: number }>;
}

export interface EvidenceConfidenceInput {
  qualityGrade: QualityGrade | null;
  applicabilityGrade: ApplicabilityGrade | null;
  evidenceClass: string | null;
  observedAt: string | null;
  verificationStatus: string;
  /** Evaluation instant; injected so the preview is deterministic in tests. */
  now?: Date;
}

export type EvidenceConfidenceResult =
  | {
      ok: true;
      evidenceConfidence: number;
      factors: {
        quality: number;
        applicability: number;
        freshness: number;
        verification: number;
      };
      ageDays: number;
    }
  | { ok: false; missingFactors: string[] };

/**
 * A STATED weight, which may legitimately be zero.
 *
 * This guard is deliberately `Number.isFinite`, not `> 0`: the adopted
 * profile scores `verification.rejected` at 0, and that is a stated position
 * — "this evidence was examined and rejected" — not an absent factor. An
 * earlier draft of this mirror rejected 0 as unscored, which made the lib
 * REFUSE exactly where compute_evidence_confidence returns EC = 0. Same
 * inputs, two different answers, is the drift the mirror exists to avoid.
 */
const isWeight = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * EC = Q × A × F × V, refusing by name.
 *
 * Mirrors compute_evidence_confidence (20261122090600) term for term,
 * including the freshness decay `max(floor, 0.5 ^ (ageDays / halfLifeDays))`
 * and its per-evidence-class policy. There is no default weight set here
 * either: `weights` comes from the tenant's ADOPTED profile, and a caller
 * with none has nothing to pass, which is the refusal the row demands.
 */
export function evidenceConfidence(
  input: EvidenceConfidenceInput,
  weights: EvidenceConfidenceWeights,
): EvidenceConfidenceResult {
  const missing: string[] = [];

  let q = Number.NaN;
  if (input.qualityGrade == null) {
    missing.push(
      "quality (Q): this evidence has no quality grade — grade it rather than assuming one",
    );
  } else {
    const w = weights.quality[input.qualityGrade];
    if (!isWeight(w)) {
      missing.push(
        `quality (Q): the adopted weight set scores no value for grade "${input.qualityGrade}"`,
      );
    } else {
      q = w;
    }
  }

  let a = Number.NaN;
  if (input.applicabilityGrade == null) {
    missing.push(
      "applicability (A): this evidence has no applicability grade — is it direct, analogous or indirect to what it is being used for?",
    );
  } else {
    const w = weights.applicability[input.applicabilityGrade];
    if (!isWeight(w)) {
      missing.push(
        `applicability (A): the adopted weight set scores no value for grade "${input.applicabilityGrade}"`,
      );
    } else {
      a = w;
    }
  }

  let f = Number.NaN;
  let ageDays = Number.NaN;
  if (input.observedAt == null) {
    missing.push(
      "freshness (F): this evidence carries no observation time, so its age is unknown",
    );
  } else if (input.evidenceClass == null) {
    missing.push(
      "freshness (F): this evidence has no §9 provenance class, and freshness decays at a class-specific rate",
    );
  } else {
    const policy = weights.freshness[input.evidenceClass];
    const halfLife = policy?.halfLifeDays;
    const floor = policy?.floor;
    if (!isWeight(halfLife) || halfLife <= 0) {
      missing.push(
        `freshness (F): the adopted weight set states no half-life for evidence class ${input.evidenceClass}`,
      );
    } else if (!isWeight(floor)) {
      missing.push(
        `freshness (F): the adopted weight set states no decay floor for evidence class ${input.evidenceClass}`,
      );
    } else {
      const observed = Date.parse(input.observedAt);
      if (!Number.isFinite(observed)) {
        missing.push(
          "freshness (F): the recorded observation time is not a readable instant",
        );
      } else {
        const nowMs = (input.now ?? new Date()).getTime();
        ageDays = Math.max(0, (nowMs - observed) / 86_400_000);
        f = Math.max(floor, Math.pow(0.5, ageDays / halfLife));
      }
    }
  }

  const vWeight = weights.verification[input.verificationStatus];
  let v = Number.NaN;
  if (!isWeight(vWeight)) {
    missing.push(
      `verification (V): the adopted weight set scores no value for status "${input.verificationStatus}"`,
    );
  } else {
    v = vWeight;
  }

  if (missing.length > 0) return { ok: false, missingFactors: missing };

  return {
    ok: true,
    evidenceConfidence: q * a * f * v,
    factors: { quality: q, applicability: a, freshness: f, verification: v },
    ageDays,
  };
}

/**
 * The one-line verdict a coverage report opens with (D3.09).
 *
 * Returns null — not "100%", not "0%" — when the case records no
 * commitments: a coverage percentage over an empty set is an invented
 * number, the same rule get_gate_readiness applies to 0/0.
 */
export function coverageHeadline(coverage: CommitmentCoverage): string {
  if (coverage.commitmentsTotal === 0) {
    return "No stakeholder commitments recorded on this case yet, so there is no coverage to report.";
  }
  if (coverage.uncoveredCount === 0) {
    return `All ${coverage.commitmentsTotal} commitments are carried by a project requirement.`;
  }
  return `${coverage.uncoveredCount} of ${coverage.commitmentsTotal} commitments have no corresponding project requirement.`;
}

/**
 * Overdue AND uncovered — the subset get_gate_readiness blocks on. Kept here
 * so the screen highlights exactly the rows the server will refuse a gate
 * over, rather than a broader or narrower set of its own devising.
 */
export function blockingCommitments(
  coverage: CommitmentCoverage,
): CommitmentCoverage["uncoveredCommitments"] {
  return coverage.uncoveredCommitments.filter((item) => item.overdue);
}
