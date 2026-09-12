export type BenefitAgentScreen = {
  caseId: string;
  benefits: Array<{
    id: string;
    label: string;
    expected: number;
    unit: string;
    owner: string;
    currentForecast: number | null;
    forecastStatus: string;
    forecastMetricId?: string | null;
    actual: number | null;
    actualMetricId?: string | null;
    variance: number | null;
  }>;
  valueLeakage: {
    leakageEvaluable: boolean;
    reason?: string;
    unit?: string;
    approvedValue?: number;
    realizedValue?: number;
    approvedToRealizedLeakage?: number;
    trajectoryComplete?: boolean;
    missingPoints?: string[];
    attributions?: Array<{
      id: string;
      bucket: string;
      kind: string;
      value: number;
      basis: string;
      evidenceItemId: string;
    }>;
    unattributedResidual?: number;
    attributionValid?: boolean;
    missingActualBenefits?: number;
  };
};

export type BenefitAgentFinding = {
  benefitId: string;
  label: string;
  owner: string;
  unit: string;
  expected: number;
  forecast: number | null;
  actual: number | null;
  variance: number | null;
  status: "met_or_exceeded" | "shortfall" | "actual_missing";
  sourceRefs: string[];
};

export type BenefitAgentAnalysis = {
  verdict: "on_plan" | "shortfall" | "value_gain" | "incomplete";
  headline: string;
  benefitCount: number;
  verifiedActualCount: number;
  shortfallCount: number;
  findings: BenefitAgentFinding[];
  leakage: {
    evaluable: boolean;
    approved: number | null;
    realized: number | null;
    shortfall: number | null;
    unit: string | null;
    recordedAttributions: Array<{
      bucket: string;
      kind: string;
      value: number;
      basis: string;
      sourceRefs: string[];
    }>;
    unattributedResidual: number | null;
    valid: boolean | null;
    reason: string | null;
  };
  evidenceRefs: string[];
  limitations: string[];
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function analyzeBenefits(
  screen: BenefitAgentScreen,
): BenefitAgentAnalysis {
  const findings: BenefitAgentFinding[] = screen.benefits.map((benefit) => {
    const sourceRefs = [`value_metrics:${benefit.id}`];
    if (benefit.forecastMetricId)
      sourceRefs.push(`value_metrics:${benefit.forecastMetricId}`);
    if (
      benefit.actualMetricId &&
      benefit.actualMetricId !== benefit.forecastMetricId
    )
      sourceRefs.push(`value_metrics:${benefit.actualMetricId}`);
    const status =
      benefit.actual == null || benefit.variance == null
        ? "actual_missing"
        : benefit.variance < 0
          ? "shortfall"
          : "met_or_exceeded";
    return {
      benefitId: benefit.id,
      label: benefit.label,
      owner: benefit.owner,
      unit: benefit.unit,
      expected: benefit.expected,
      forecast: benefit.currentForecast,
      actual: benefit.actual,
      variance: benefit.variance,
      status,
      sourceRefs,
    };
  });

  const leakage = screen.valueLeakage;
  const shortfall =
    leakage.leakageEvaluable && finite(leakage.approvedToRealizedLeakage)
      ? leakage.approvedToRealizedLeakage
      : null;
  const missingActual = findings.filter(
    (item) => item.status === "actual_missing",
  ).length;
  const shortfallCount = findings.filter(
    (item) => item.status === "shortfall",
  ).length;
  const verdict =
    findings.length === 0 || missingActual > 0 || !leakage.leakageEvaluable
      ? "incomplete"
      : shortfall != null && shortfall > 0
        ? "shortfall"
        : shortfall != null && shortfall < 0
          ? "value_gain"
          : "on_plan";

  const headline =
    verdict === "incomplete"
      ? `Benefits answer incomplete: ${missingActual} of ${findings.length} benefit actuals are missing or the approved value basis is not evaluable.`
      : verdict === "shortfall"
        ? `Human-verified realized value is ${leakage.realizedValue} ${leakage.unit} against ${leakage.approvedValue} ${leakage.unit} approved; the recorded shortfall is ${shortfall} ${leakage.unit}.`
        : verdict === "value_gain"
          ? `Human-verified realized value exceeds the approved value by ${shortfall === null ? "an unavailable amount" : Math.abs(shortfall)} ${leakage.unit}.`
          : `Human-verified realized value matches the approved value basis at ${leakage.realizedValue} ${leakage.unit}.`;

  const recordedAttributions = (leakage.attributions ?? []).map((item) => ({
    bucket: item.bucket,
    kind: item.kind,
    value: item.value,
    basis: item.basis,
    sourceRefs: [
      `value_metrics:${item.id}`,
      `evidence_items:${item.evidenceItemId}`,
    ],
  }));
  const evidenceRefs = [
    ...findings.flatMap((item) => item.sourceRefs),
    ...recordedAttributions.flatMap((item) => item.sourceRefs),
  ].filter((value, index, all) => all.indexOf(value) === index);
  const limitations: string[] = [];
  if (missingActual > 0)
    limitations.push(
      `${missingActual} benefit actuals are not human-verified.`,
    );
  if (!leakage.leakageEvaluable)
    limitations.push(
      leakage.reason ??
        "The approved-to-realized value basis is not evaluable.",
    );
  if (leakage.leakageEvaluable && !leakage.trajectoryComplete)
    limitations.push(
      `Lifecycle trajectory is incomplete: ${(leakage.missingPoints ?? []).join(", ") || "missing points not identified"}.`,
    );
  if (leakage.leakageEvaluable && leakage.attributionValid === false)
    limitations.push(
      "Recorded attribution exceeds the governed leakage amount and is invalid.",
    );
  if (
    leakage.leakageEvaluable &&
    finite(leakage.unattributedResidual) &&
    leakage.unattributedResidual !== 0
  )
    limitations.push(
      `${leakage.unattributedResidual} ${leakage.unit} remains explicitly unattributed.`,
    );

  return {
    verdict,
    headline,
    benefitCount: findings.length,
    verifiedActualCount: findings.length - missingActual,
    shortfallCount,
    findings,
    leakage: {
      evaluable: leakage.leakageEvaluable,
      approved: finite(leakage.approvedValue) ? leakage.approvedValue : null,
      realized: finite(leakage.realizedValue) ? leakage.realizedValue : null,
      shortfall,
      unit: leakage.unit ?? null,
      recordedAttributions,
      unattributedResidual: finite(leakage.unattributedResidual)
        ? leakage.unattributedResidual
        : null,
      valid:
        typeof leakage.attributionValid === "boolean"
          ? leakage.attributionValid
          : null,
      reason: leakage.leakageEvaluable ? null : (leakage.reason ?? null),
    },
    evidenceRefs,
    limitations,
  };
}
