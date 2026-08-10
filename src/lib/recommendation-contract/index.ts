/**
 * The recommendation contract: whether a recommendation is fit to be acted on
 * (capability register C8.11–C8.21).
 *
 * WHY THIS EXISTS EVEN THOUGH THE COLUMNS ALREADY DID.
 *
 * `recommendations` has carried consequence_summary, alternatives_considered,
 * required_completion_date and verification_method for some time. Across 70
 * rows: zero, zero, zero, and one. The schema was complete and the capability
 * was not, which is the same shape as a twin template with no components —
 * something that registers as present and reasons about nothing.
 *
 * A column nobody fills is not a contract. So this measures the contract rather
 * than asserting it, and the gate below refuses to release a recommendation
 * that cannot answer the questions an approver has to ask.
 *
 * WHY MISSING FIELDS BLOCK RELEASE RATHER THAN LOWERING A SCORE.
 *
 * The four unpopulated fields are exactly the ones an approver needs and cannot
 * supply themselves:
 *
 *   consequence      — what happens if this is not done. Without it, approval is
 *                      a judgement about cost with the benefit left blank.
 *   alternatives     — what else was considered. Without it, the approver cannot
 *                      tell a recommendation from the only idea anybody had.
 *   completion date  — by when. "Soon" is not schedulable and cannot be overdue,
 *                      so its absence removes the only accountability there is.
 *   verification     — how we will know it worked. Without it the loop never
 *                      closes and the same recommendation returns next year.
 *
 * A score would let all four be missing and still read 64%. Releasing is
 * binary, so the check is too.
 *
 * Pure functions. No database, no network.
 */

export interface RecommendationRecord {
  id: string;
  title: string | null;
  assetId: string | null;
  issue: string | null;
  rationale: string | null;
  failureMode: string | null;
  consequenceSummary: string | null;
  action: string | null;
  alternativesConsidered: string | null;
  confidence: number | null;
  requiredApproverRole: string | null;
  requiredCompletionDate: string | null;
  verificationMethod: string | null;
  /** Set when the recommendation would change something safety-related. */
  safetyCritical?: boolean;
}

export type FieldKey =
  | "asset"
  | "issue"
  | "evidence"
  | "failureMode"
  | "consequence"
  | "action"
  | "alternatives"
  | "confidence"
  | "approver"
  | "completionDate"
  | "verification";

export interface FieldSpec {
  key: FieldKey;
  register: string;
  label: string;
  /** Blocks release when absent. */
  blocking: boolean;
  whyItMatters: string;
}

export const CONTRACT: FieldSpec[] = [
  {
    key: "asset",
    register: "C8.11",
    label: "Asset and functional location",
    blocking: true,
    whyItMatters:
      "A recommendation nobody can route to a machine cannot be planned.",
  },
  {
    key: "issue",
    register: "C8.12",
    label: "Current condition or problem",
    blocking: true,
    whyItMatters:
      "Without the problem, the action is an instruction rather than a recommendation.",
  },
  {
    key: "evidence",
    register: "C8.13",
    label: "Evidence used",
    blocking: true,
    whyItMatters:
      "An approver has to be able to check the reasoning, not just the conclusion.",
  },
  {
    key: "failureMode",
    register: "C8.14",
    label: "Failure mode or risk scenario",
    blocking: false,
    whyItMatters:
      "Names what is being prevented. Not every recommendation is failure-driven, so it does not block.",
  },
  {
    key: "consequence",
    register: "C8.15",
    label: "Safety, environmental, production and financial consequence",
    blocking: true,
    whyItMatters:
      "Approving without it is a judgement about cost with the benefit left blank.",
  },
  {
    key: "action",
    register: "C8.16",
    label: "Recommended action",
    blocking: true,
    whyItMatters: "Self-evidently.",
  },
  {
    key: "alternatives",
    register: "C8.17",
    label: "Alternative actions considered",
    blocking: true,
    whyItMatters:
      "Without it an approver cannot distinguish a recommendation from the only idea anybody had.",
  },
  {
    key: "confidence",
    register: "C8.19",
    label: "Confidence and uncertainty",
    blocking: true,
    whyItMatters:
      "A recommendation with no stated confidence is read as certain.",
  },
  {
    key: "approver",
    register: "C8.20",
    label: "Required human approval (named authority)",
    blocking: true,
    whyItMatters:
      "Who may say yes. Unstated, it defaults to whoever happens to be looking.",
  },
  {
    key: "completionDate",
    register: "C8.18",
    label: "Required completion date",
    blocking: true,
    whyItMatters:
      '"Soon" is not schedulable and can never be overdue, which removes the only accountability there is.',
  },
  {
    key: "verification",
    register: "C8.21",
    label: "Method for verifying effectiveness",
    blocking: true,
    whyItMatters:
      "Without it the loop never closes and the same recommendation returns next year.",
  },
];

function present(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

export interface ContractAssessment {
  recommendationId: string;
  releasable: boolean;
  presentFields: FieldKey[];
  missingBlocking: FieldSpec[];
  missingAdvisory: FieldSpec[];
  /** Fields present out of the eleven. Reported, never used as the gate. */
  completeness: number;
  reason: string;
}

export function assessContract(r: RecommendationRecord): ContractAssessment {
  const value: Record<FieldKey, unknown> = {
    asset: r.assetId,
    issue: r.issue,
    evidence: r.rationale,
    failureMode: r.failureMode,
    consequence: r.consequenceSummary,
    action: r.action,
    alternatives: r.alternativesConsidered,
    confidence: r.confidence,
    approver: r.requiredApproverRole,
    completionDate: r.requiredCompletionDate,
    verification: r.verificationMethod,
  };

  const presentFields = CONTRACT.filter((f) => present(value[f.key])).map(
    (f) => f.key,
  );
  const missing = CONTRACT.filter((f) => !present(value[f.key]));
  const missingBlocking = missing.filter((f) => f.blocking);
  const missingAdvisory = missing.filter((f) => !f.blocking);

  const completeness = presentFields.length / CONTRACT.length;

  return {
    recommendationId: r.id,
    releasable: missingBlocking.length === 0,
    presentFields,
    missingBlocking,
    missingAdvisory,
    completeness,
    reason:
      missingBlocking.length === 0
        ? `Contract complete on all ${CONTRACT.filter((f) => f.blocking).length} blocking field(s).` +
          (missingAdvisory.length > 0
            ? ` ${missingAdvisory.map((f) => f.label).join(", ")} not stated, which does not block release.`
            : "")
        : `NOT RELEASABLE. ${missingBlocking.length} required field(s) missing: ` +
          missingBlocking
            .map((f) => `${f.label} (${f.register}) — ${f.whyItMatters}`)
            .join(" ") +
          ` Completeness is ${(completeness * 100).toFixed(0)}%, which is reported and deliberately not used as the gate: releasing is binary, and four missing fields do not become acceptable by being outnumbered.`,
  };
}

export interface ContractPosture {
  total: number;
  releasable: number;
  /** Per-field population across the population. The shell detector. */
  fieldCoverage: Array<{
    key: FieldKey;
    register: string;
    label: string;
    populated: number;
    share: number;
    blocking: boolean;
  }>;
  /** Fields present in the schema and populated on nothing. */
  neverPopulated: FieldSpec[];
  reason: string;
}

export function assessPosture(
  records: RecommendationRecord[],
): ContractPosture {
  const assessments = records.map(assessContract);
  const releasable = assessments.filter((a) => a.releasable).length;

  const fieldCoverage = CONTRACT.map((f) => {
    const populated = assessments.filter((a) =>
      a.presentFields.includes(f.key),
    ).length;
    return {
      key: f.key,
      register: f.register,
      label: f.label,
      populated,
      share: records.length > 0 ? populated / records.length : 0,
      blocking: f.blocking,
    };
  });

  const never = CONTRACT.filter(
    (f) => (fieldCoverage.find((c) => c.key === f.key)?.populated ?? 0) === 0,
  );

  return {
    total: records.length,
    releasable,
    fieldCoverage: [...fieldCoverage].sort((a, b) => a.share - b.share),
    neverPopulated: never,
    reason:
      records.length === 0
        ? "No recommendations to assess. That is an absence of evidence, not a clean contract."
        : `${releasable} of ${records.length} recommendation(s) carry every blocking field. ` +
          (never.length > 0
            ? `${never.length} contract field(s) are populated on NOTHING — ${never.map((f) => `${f.label} (${f.register})`).join(", ")}. A column that is never filled is schema, not capability, and it registers as present while reasoning about nothing.`
            : `Every contract field is populated somewhere.`),
  };
}
