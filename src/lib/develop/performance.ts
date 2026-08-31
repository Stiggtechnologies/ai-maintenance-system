/**
 * Sync Develop Slice 4B — Performance: rules of credit and progress claims
 * (D5.06), the earned value metric suite (D5.05), the eight-dimension
 * estimate basis (D5.16) and its confidence rating (D5.17), the progress
 * integrity cross-check (D5.20), and the §51 forecast presentation
 * (D5.07/D5.32).
 *
 * WHAT LIVES HERE AND WHAT DOES NOT — the controls.ts precedent, unchanged:
 *
 *   1. THE VOCABULARIES the spec fixes (the six II.9 cross-check sources, the
 *      eight II.7 basis dimensions, the estimate classes, the earned-value
 *      metric keys). They are `as const` so a select box and a database CHECK
 *      cannot drift apart silently; the slice test pins each one against the
 *      migration text.
 *
 *   2. THE TYPES for the get_case_performance payload, so a page cannot read
 *      a key the RPC does not return.
 *
 *   3. PURE PRESENTATION HELPERS over that payload. NOT calculations. Every
 *      earned-value NUMBER in this slice is computed in SQL and arrives with
 *      a calculation_runs row behind it (D11.29); a second implementation
 *      here would be a number with no lineage, which is the thing the lineage
 *      record exists to make impossible. `metricDisplay` formats a figure the
 *      server computed and NAMES THE REFUSAL when the server produced none.
 *      It never adds anything up.
 *
 * THE REFUSAL IS THE POINT. An earned-value number with no basis is worse
 * than no number, so every helper below is written so that "no figure" and
 * "a figure of zero" produce DIFFERENT text, and so that the reason a figure
 * is missing survives all the way to the screen. A blank cell where a CPI
 * belongs is how a refusal becomes an implied 1.0.
 */

/* ────────────────────────── the vocabularies ─────────────────────────── */

/**
 * project_rules_of_credit.applies_to — the work types a rule of credit can
 * govern. Pinned against the migration CHECK by the slice test.
 */
export const RULE_OF_CREDIT_WORK_TYPES = [
  { value: "engineering_deliverable", label: "Engineering deliverable" },
  { value: "procurement_package", label: "Procurement package" },
  { value: "construction_work_package", label: "Construction work package" },
  { value: "commissioning_system", label: "Commissioning system" },
  { value: "fabrication_lot", label: "Fabrication lot" },
  { value: "owner_activity", label: "Owner activity" },
] as const;

export type RuleOfCreditWorkType =
  (typeof RULE_OF_CREDIT_WORK_TYPES)[number]["value"];

/**
 * Spec II.9's six cross-check sources, in the spec's own order: "drawings
 * issued, deliverables approved, quantities complete, procurement releases,
 * field installation, inspection records."
 */
export const PROGRESS_EVIDENCE_SOURCES = [
  { value: "drawings_issued", label: "Drawings issued" },
  { value: "deliverables_accepted", label: "Deliverables accepted (IFC)" },
  { value: "quantities_complete", label: "Quantities complete" },
  { value: "procurement_releases", label: "Procurement releases" },
  { value: "field_installation", label: "Field installation" },
  { value: "inspection_records", label: "Inspection records" },
] as const;

/**
 * Spec II.7's eight dimensions, in the order the migration validates them.
 *
 * The spec paragraph asks SEVEN questions; "Escalation and productivity
 * assumptions?" names two independent bases, and the ruling that splits them
 * is stated in migration 20261201090100. The list is rendered in full even
 * where nothing is recorded — a dimension that quietly disappears from the
 * form is a dimension nobody remembers to answer.
 */
export const ESTIMATE_BASIS_DIMENSIONS = [
  { key: "estimateClass", field: "estimate_class", label: "Estimate class" },
  { key: "scopeMaturity", field: "scope_maturity", label: "Scope maturity" },
  {
    key: "quantityBasedPercent",
    field: "quantity_based_percent",
    label: "% quantity-based vs factored",
  },
  {
    key: "quotationSupport",
    field: "quotation_support",
    label: "Supporting quotations",
  },
  {
    key: "escalationBasis",
    field: "escalation_basis",
    label: "Escalation basis",
  },
  {
    key: "productivityBasis",
    field: "productivity_basis",
    label: "Productivity basis",
  },
  { key: "exclusions", field: "exclusions", label: "Exclusions" },
  {
    key: "contingencyBasis",
    field: "contingency_basis",
    label: "Contingency basis",
  },
] as const;

export const ESTIMATE_CLASSES = [
  { value: "class_5", label: "Class 5 (concept screening)" },
  { value: "class_4", label: "Class 4 (study / feasibility)" },
  { value: "class_3", label: "Class 3 (budget authorisation)" },
  { value: "class_2", label: "Class 2 (control)" },
  { value: "class_1", label: "Class 1 (check estimate / bid)" },
] as const;

export const SCOPE_MATURITIES = [
  { value: "concept", label: "Concept" },
  { value: "feasibility", label: "Feasibility" },
  { value: "pre_feed", label: "Pre-FEED" },
  { value: "feed", label: "FEED" },
  { value: "detailed_design", label: "Detailed design" },
] as const;

export const QUOTATION_SUPPORT_LEVELS = [
  { value: "none", label: "None" },
  { value: "indicative", label: "Indicative" },
  { value: "budgetary", label: "Budgetary" },
  { value: "firm", label: "Firm" },
] as const;

/**
 * The metric suite (spec I.8), in the order a reader meets it: the three
 * quantities, then the two indices, then earned schedule, then the forecast
 * pair. Every one is rendered — including the ones that refused, which is the
 * whole discipline of this slice.
 */
export const EARNED_VALUE_METRICS = [
  { key: "ev", label: "Earned value", unit: "currency" },
  { key: "pv", label: "Planned value", unit: "currency" },
  { key: "ac", label: "Actual cost", unit: "currency" },
  { key: "cpi", label: "Cost performance index", unit: "ratio" },
  { key: "spi", label: "Schedule performance index", unit: "ratio" },
  { key: "es", label: "Earned schedule", unit: "periods" },
  { key: "spit", label: "Schedule performance index (time)", unit: "ratio" },
  { key: "eac", label: "Estimate at completion", unit: "currency" },
  { key: "vac", label: "Variance at completion", unit: "currency" },
] as const;

export type EarnedValueMetricKey = (typeof EARNED_VALUE_METRICS)[number]["key"];

/**
 * The EAC formula this product computes, stated on the number every time.
 *
 * Three formulas are in common use and they disagree by tens of percent. The
 * ruling (migration 20261201090300) is that this one is computed and NAMED,
 * and that a missing CPI REFUSES rather than falling back to
 * `AC + (BAC - EV)`: a forecast that silently changes its own definition when
 * an input goes missing keeps its shape while changing its meaning.
 */
export const EAC_FORMULA = "EAC = BAC / CPI (past cost performance continues)";

/**
 * The code identity recorded on every Slice 4B calculation run.
 *
 * MIRRORS sync_calculation_code_version() in migration 20261201090000 and is
 * pinned against it by the slice test. The SERVER stamps the version on the
 * row; this constant exists so the surface can say WHICH code version it is
 * showing, and so a bump that lands on one side only fails CI.
 */
export const PERFORMANCE_CALC_VERSION = "develop-performance/4B/2026-12-01";

/** The five calculation keys this slice records. */
export const PERFORMANCE_CALC_KEYS = [
  "case_earned_value",
  "case_progress_integrity",
  "case_estimate_confidence",
  "case_forecast_confidence",
  "case_performance_trend",
] as const;

export type PerformanceCalcKey = (typeof PERFORMANCE_CALC_KEYS)[number];

/* ──────────────────── get_case_performance payload ───────────────────── */

export interface RuleOfCreditStep {
  step: string;
  weight: number;
}

export interface RuleOfCredit {
  id: string;
  ruleRef: string;
  title: string;
  appliesTo: string;
  method: string;
  steps: RuleOfCreditStep[];
  basis: string;
  recordedBy: string | null;
  recordedAt: string;
  claimCount: number;
}

export interface ProgressPeriod {
  id: string;
  periodRef: string;
  periodEnd: string;
  /** Null until the planned curve is set — planned value refuses until then. */
  plannedPercentComplete: number | null;
  plannedBasis: string | null;
  status: "open" | "closed";
  closedAt: string | null;
  claimCount: number;
}

export interface ProgressClaim {
  id: string;
  wbsElementId: string;
  wbsCode: string;
  wbsTitle: string;
  ruleRef: string;
  appliesTo: string;
  stepIndex: number;
  stepLabel: string;
  /** DERIVED server-side from the cited rule. Never caller-supplied. */
  claimedPercent: number;
  basis: string;
  claimedBy: string | null;
  claimedAt: string;
}

export interface WbsElementWorkType {
  wbsCode: string;
  title: string;
  /** Null until the work type is recorded — a claim refuses until then. */
  workType: string | null;
  workTypeBasis: string | null;
  /** The rule the recorded work type resolves to, or null if none exists. */
  ruleRef: string | null;
  claimCount: number;
}

export interface CaseProgress {
  caseId: string;
  rules: RuleOfCredit[];
  periods: ProgressPeriod[];
  elements: WbsElementWorkType[];
  elementsWithoutAWorkType: number;
  latestPeriod: {
    id: string;
    periodRef: string;
    periodEnd: string;
    status: "open" | "closed";
    plannedPercentComplete: number | null;
  } | null;
  latestPeriodClaims: ProgressClaim[];
  /** Work types that cannot be claimed against yet, named before anyone tries. */
  workTypesWithoutARule: string[];
  /** Present when nothing can be claimed, or nothing has been. Never a zero. */
  refusal: string | null;
}

export interface EstimateBasisRecord {
  id: string;
  version: number;
  estimateClass: string;
  scopeMaturity: string;
  quantityBasedPercent: number;
  quotationSupport: string;
  supportingQuotationCount: number;
  escalationBasis: string;
  productivityBasis: string;
  exclusions: string;
  contingencyBasis: string;
  preparedBy: string | null;
  recordedAt: string;
}

export interface EstimateConfidence {
  /** Null exactly when the band is `unrated`. */
  rating: "high" | "medium" | "low" | null;
  band: "high" | "medium" | "low" | "unrated";
  basisVersion: number | null;
  drivers: string[];
  mapping?: string;
  /** Present exactly when the band is `unrated`. */
  refusal: string | null;
}

export interface CaseEstimateBasis {
  caseId: string;
  current: EstimateBasisRecord | null;
  versions: {
    version: number;
    estimateClass: string;
    scopeMaturity: string;
    recordedAt: string;
    preparedBy: string | null;
  }[];
  confidence: EstimateConfidence;
  dimensions: string[];
}

export interface EarnedValueMetric {
  label: string;
  unit: "currency" | "ratio" | "periods";
  /** Null whenever the metric refused. Never a stand-in zero. */
  value: number | null;
  /** Present exactly when value is null: the named reason. */
  refusal: string | null;
}

export interface CaseEarnedValue {
  caseId: string;
  /** Null when the case's cost lines are not in one currency. */
  currency: string | null;
  period: {
    id: string;
    periodRef: string;
    periodEnd: string;
    status: "open" | "closed";
    plannedPercentComplete: number | null;
    index: number | null;
  } | null;
  bac: number | null;
  bacRefusal: string | null;
  costLineCount: number;
  /** Element POSITIONS the earned value is the sum of (cumulative to date). */
  claimCount: number;
  /** How many of those were filed into the latest period. */
  claimsInLatestPeriod: number;
  /** How many were last claimed in an earlier period and carried forward. */
  carriedForwardCount: number;
  /** Present when the latest period is closed: EV frozen, AC still moving. */
  periodClosedNote: string | null;
  /** md5 over the AMOUNTS the suite summed. Counts cannot see a revision. */
  basisDigest: string | null;
  eacFormula: string;
  metrics: Record<EarnedValueMetricKey, EarnedValueMetric>;
  claimedElements: {
    wbsCode: string;
    title: string;
    claimedPercent: number;
    stepLabel: string;
    ruleRef: string;
    periodRef: string;
    carriedForward: boolean;
    elementBudget: number;
    earnedValue: number;
  }[];
  estimateConfidence: EstimateConfidence;
  caveats: string[];
  refusals: string[];
  evaluable: boolean;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface ProgressIntegrityElement {
  wbsCode: string;
  title: string;
  ruleRef: string;
  stepLabel: string;
  claimedPercent: number;
  bindingSource: string | null;
  bindingUnit: string | null;
  observedComplete: number | null;
  observedTotal: number | null;
  observedPercent: number | null;
  divergencePoints: number | null;
  sourceCount: number;
  /** Null exactly when no independent observation exists — unrated, not high. */
  confidence: "high" | "medium" | "low" | null;
  refusal: string | null;
  discrepancy: string | null;
}

export interface CaseProgressIntegrity {
  caseId: string;
  period: {
    id: string;
    periodRef: string;
    periodEnd: string;
    status: string;
  } | null;
  elements: ProgressIntegrityElement[];
  claimedElementCount: number;
  coveredElementCount: number;
  /** Percent of claimed elements the rating was computed over. */
  coverage: number | null;
  /** ONE definition, produced by the read, used by both sides of staleness. */
  evidenceCount: number;
  basisDigest: string | null;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  /** Null when nothing was cross-checked at all. */
  confidence: "high" | "medium" | "low" | null;
  headline: string | null;
  bands: Record<string, string>;
  refusal: string | null;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface ForecastConfidence {
  caseId: string;
  cost: {
    currency: string | null;
    deterministic: number | null;
    deterministicLabel: string;
    deterministicFormula: string;
    deterministicRefusal: string | null;
    recordedForecastTotal: number | null;
    recordedForecastLineCount: number;
    costLineCount: number;
    recordedForecastNote: string;
    /** Always null in this slice. The refusal below says why. */
    p50: number | null;
    p80: number | null;
    percentileRefusal: string;
  };
  schedule: {
    deterministicFinish: string | null;
    deterministicRefusal: string | null;
    activityCount: number;
    activitiesWithPlannedFinish: number;
    activitiesWithDurationRange: number;
    p50Finish: string | null;
    p80Finish: string | null;
    percentileRefusal: string;
    criticalDrivers: string[] | null;
    criticalDriversRefusal: string;
  };
  againstSanction: string | null;
  againstSanctionRefusal: string;
  estimateConfidence: EstimateConfidence;
  progressConfidence: {
    band: "high" | "medium" | "low" | null;
    coverage: number | null;
    headline: string | null;
    refusal: string | null;
  };
  distribution: { exists: boolean; reason: string };
  evaluable: boolean;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface TrendPoint {
  periodRef: string;
  periodEnd: string;
  status: string;
  runId: string;
  runStatus: string;
  /** False when the run refused: a recorded point that measured nothing. */
  measured: boolean;
  computedAt: string;
  codeVersion: string;
  cpi: number | null;
  spi: number | null;
  spit: number | null;
  ev: number | null;
  pv: number | null;
  ac: number | null;
  eac: number | null;
  currency: string | null;
  refusalCount: number;
}

export interface CasePerformanceTrend {
  caseId: string;
  points: TrendPoint[];
  /** Periods with no MEASURED run. Never interpolated across. */
  gaps: {
    periodRef: string;
    periodEnd: string;
    kind: "refused" | "not_computed";
    reason: string;
  }[];
  periodCount: number;
  /** Points recorded at all, measured or refused. */
  recordedPointCount: number;
  /** Points that produced a metric. A refused run is not a measurement. */
  measuredPointCount: number;
  refusedPointCount: number;
  costTrend: "improving" | "deteriorating" | "flat" | null;
  /** Present exactly when costTrend is null and a series exists. */
  costTrendRefusal: string | null;
  /** The two periods the direction was measured across. */
  costTrendInterval: string | null;
  /** Present when the series changes direction: one word cannot describe it. */
  costTrendVolatility: string | null;
  scheduleTrend: "improving" | "deteriorating" | "flat" | null;
  scheduleTrendRefusal: string | null;
  scheduleTrendInterval: string | null;
  scheduleTrendVolatility: string | null;
  refusal: string | null;
  basis: string;
  calculationRunId?: string;
  codeVersion?: string;
}

/** The lineage row shape, identical to the 4A record (D11.29). */
export interface PerformanceCalculationRun {
  id: string;
  calculationKey: string;
  method: string;
  codeVersion: string;
  inputs: Record<string, unknown>;
  inputRefs: { table: string; id: string }[];
  outputs: Record<string, unknown> | null;
  refusals: string[];
  status: "computed" | "computed_with_refusals" | "refused";
  computedAt: string;
  computedBy: string | null;
}

export interface CasePerformance {
  caseId: string;
  caseTitle: string;
  progress: CaseProgress;
  estimateBasis: CaseEstimateBasis;
  earnedValue: CaseEarnedValue;
  progressIntegrity: CaseProgressIntegrity;
  forecastConfidence: ForecastConfidence;
  trend: CasePerformanceTrend;
  latestCalculations: Partial<
    Record<PerformanceCalcKey, PerformanceCalculationRun>
  >;
  notInThisSlice: string[];
}

/* ────────────────────────── presentation helpers ─────────────────────── */

/**
 * Whether a recorded run may have its figures displayed at all.
 *
 * A run that REFUSED has no outputs, and rendering a blank where a number
 * belongs is how a refusal becomes an implied zero.
 */
export function hasRunOutputs(
  run: PerformanceCalculationRun | undefined,
): run is PerformanceCalculationRun & { outputs: Record<string, unknown> } {
  return run != null && run.outputs != null && run.status !== "refused";
}

/**
 * One metric, as the screen must show it: a figure FROM THE RECORDED RUN, or
 * the named reason there is none.
 *
 * The live read is deliberately not a fallback. A figure taken from it would
 * be a number with no lineage sitting under a lineage block describing a
 * different, older run — the 4A failure, repeated one slice later. When no
 * run exists the answer is "nothing has been computed", which is a different
 * sentence from every refusal the calculation itself can produce.
 */
export function metricDisplay(
  key: EarnedValueMetricKey,
  live: CaseEarnedValue,
  run: PerformanceCalculationRun | undefined,
): {
  label: string;
  unit: "currency" | "ratio" | "periods";
  value: number | null;
  refusal: string | null;
  fromRun: boolean;
} {
  const spec = EARNED_VALUE_METRICS.find((m) => m.key === key)!;
  const liveMetric = live.metrics?.[key];
  if (!hasRunOutputs(run)) {
    return {
      label: spec.label,
      unit: spec.unit,
      value: null,
      refusal:
        "No earned-value calculation has been recorded for this case yet, so no figure is shown. Compute and record produces the figure with its lineage.",
      fromRun: false,
    };
  }
  const raw = run.outputs[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    // THE RUN'S OWN REFUSAL, FIRST. compute_case_earned_value records each
    // metric's refusal prefixed with that metric's label, so the reason is
    // recoverable from the run itself. Reaching past it to the LIVE read was
    // wrong twice over: the live read has usually moved on and has a value,
    // so its per-metric refusal is null and the screen fell through to "no
    // reason was recorded" while the reason sat one field away — the surface
    // accusing the lineage ledger of a defect it did not have.
    const prefix = `${spec.label}: `;
    const recorded = run.refusals.find((r) => r.startsWith(prefix));
    return {
      label: spec.label,
      unit: spec.unit,
      value: null,
      refusal:
        recorded?.slice(prefix.length) ??
        liveMetric?.refusal ??
        `${spec.label} was not produced by the recorded calculation, and no reason was recorded — which is itself worth seeing.`,
      fromRun: true,
    };
  }
  return {
    label: spec.label,
    unit: spec.unit,
    value: raw,
    refusal: null,
    fromRun: true,
  };
}

/**
 * A money figure ALWAYS carries its unit, or it is not rendered as money.
 *
 * AND A ROUNDED FIGURE SAYS SO. At `maximumFractionDigits: 0` a positive
 * 0.4 printed as "0 CAD" and a CPI of 0.0004 printed as "0.000" — the same
 * strings a genuine zero produces, in a slice whose whole thesis is that a
 * number must never look more certain than it is. Anything the display
 * rounds is prefixed with "≈", so an exact figure and a rounded one are
 * distinguishable at a glance and neither can be mistaken for the other.
 */
export function formatPerformanceValue(
  value: number | null,
  unit: "currency" | "ratio" | "periods",
  currency: string | null | undefined,
): string {
  if (value == null) return "no figure";
  const mark = (shown: number, text: string) =>
    shown === value ? text : `≈${text}`;
  if (unit === "ratio") {
    return mark(Number(value.toFixed(3)), value.toFixed(3));
  }
  if (unit === "periods") {
    return mark(
      Number(value.toFixed(2)),
      `${value.toFixed(2)} period${Math.abs(value) === 1 ? "" : "s"}`,
    );
  }
  const n = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(
    value,
  );
  const shown = Number(value.toFixed(2));
  if (currency == null || currency.trim() === "") {
    return mark(shown, `${n} (currency not established)`);
  }
  return mark(shown, `${n} ${currency}`);
}

/**
 * The one-line verdict the earned-value section opens with.
 *
 * "Nothing claimed" and "nothing earned" are DIFFERENT sentences, and so are
 * "no calculation recorded" and "the calculation refused". Each gets its own.
 */
export function earnedValueHeadline(
  live: CaseEarnedValue,
  run: PerformanceCalculationRun | undefined,
): string {
  if (run == null) {
    return "No earned-value calculation has been recorded for this case. The inputs below are the recorded rows; press Compute and record to produce the metrics they support, each with its lineage and each refusing by name where an input is absent.";
  }
  if (!hasRunOutputs(run)) {
    return (
      run.refusals[0] ??
      "The recorded earned-value calculation produced no metric and recorded no reason, which is itself a defect worth seeing."
    );
  }
  const cpi = metricDisplay("cpi", live, run);
  const spi = metricDisplay("spi", live, run);
  const currency =
    typeof run.outputs.currency === "string" ? run.outputs.currency : null;
  const eac = metricDisplay("eac", live, run);
  const parts: string[] = [];
  parts.push(
    cpi.value == null
      ? "no cost performance index"
      : `CPI ${cpi.value.toFixed(3)}`,
  );
  parts.push(
    spi.value == null
      ? "no schedule performance index"
      : `SPI ${spi.value.toFixed(3)}`,
  );
  parts.push(
    eac.value == null
      ? "no estimate at completion"
      : `EAC ${formatPerformanceValue(eac.value, "currency", currency)}`,
  );
  const period =
    typeof run.outputs.periodRef === "string"
      ? ` at period ${run.outputs.periodRef}`
      : "";
  return `${parts.join(", ")}${period}. Every absent figure below names the input it is missing.`;
}

/**
 * The confidence chip, for a band that may legitimately be absent.
 *
 * `unrated` and `low` produce different words on purpose: LOW is a finding
 * about a weak estimate, unrated is the absence of any finding, and a screen
 * that printed the same chip for both would let "nobody wrote the basis down"
 * read as "we assessed it and it is poor".
 */
export function confidenceLabel(
  band: "high" | "medium" | "low" | "unrated" | null | undefined,
): { text: string; tone: "good" | "warn" | "bad" | "absent" } {
  switch (band) {
    case "high":
      return { text: "HIGH", tone: "good" };
    case "medium":
      return { text: "MEDIUM", tone: "warn" };
    case "low":
      return { text: "LOW", tone: "bad" };
    default:
      return { text: "UNRATED", tone: "absent" };
  }
}

/**
 * The coverage that must travel with a progress-confidence band.
 *
 * D5.20's own Rule 3: "a HIGH confidence over two of nineteen claimed
 * elements is a true statement about two elements and a false impression of
 * the project." A bare green HIGH chip is that false impression, so the
 * coverage is part of the chip rather than a number on another panel.
 */
export function coverageSuffix(
  coverage: number | null | undefined,
  covered: number | null | undefined,
  claimed: number | null | undefined,
): string | null {
  if (coverage == null || claimed == null || covered == null) return null;
  if (coverage >= 100) return `over all ${claimed} claimed element(s)`;
  return `over ${covered} of ${claimed} claimed element(s) (${coverage}%)`;
}

/**
 * The P50/P80 cell (D5.07, D5.32).
 *
 * There is no branch here that formats a percentile out of the deterministic
 * figure, and there must never be one: a fabricated P80 looks exactly like a
 * simulated one and nothing on the screen would reveal the difference. The
 * helper exists so that the honest absence is rendered the SAME WAY
 * everywhere — one place to read, one place to change when 4C supplies a
 * distribution.
 */
export function percentileCell(
  value: number | string | null,
  refusal: string,
): { text: string; available: boolean; refusal: string | null } {
  if (value == null || value === "") {
    return { text: "not available", available: false, refusal };
  }
  return {
    text: typeof value === "number" ? String(value) : value,
    available: true,
    refusal: null,
  };
}

/**
 * Has the world moved since this run was recorded?
 *
 * The run records the same fingerprint the live read produces, so this is a
 * comparison rather than a second calculation. A recorded figure stays
 * defensible for ever and stops being CURRENT the moment its inputs change.
 */
export function performanceRunIsStale(
  run: PerformanceCalculationRun | undefined,
  current: Record<string, unknown>,
): boolean {
  if (run == null) return false;
  for (const [key, value] of Object.entries(current)) {
    if (!(key in run.inputs)) continue;
    if (
      JSON.stringify(run.inputs[key] ?? null) !== JSON.stringify(value ?? null)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The live fingerprint of the earned-value inputs, for staleness.
 *
 * `basisDigest` is the load-bearing field and it is computed IN SQL by
 * get_case_earned_value, not here — one definition, read by both sides.
 * Counts alone could not see a REVISED amount: `record_cost_item` rewrites
 * baseline_cost and actual in place (actual is a running total by design),
 * so a recorded CPI could be wrong by a factor of three while every count
 * matched and the caption read "recorded … code version …".
 */
export function earnedValueFingerprint(
  ev: CaseEarnedValue,
): Record<string, unknown> {
  return {
    periodRef: ev.period?.periodRef ?? null,
    basisDigest: ev.basisDigest ?? null,
    claimCount: ev.claimCount,
    costLineCount: ev.costLineCount,
    plannedPercentComplete: ev.period?.plannedPercentComplete ?? null,
    estimateConfidenceBand: ev.estimateConfidence?.band ?? "unrated",
  };
}

/**
 * The live fingerprint of the progress-integrity inputs.
 *
 * `evidenceCount` comes from the READ, which is where the recording side
 * gets it too. It used to be re-derived on the surface by summing
 * `sourceCount` over the CLAIMED elements, while the run counted all
 * evidence in the period — so a single observation against an unclaimed
 * element made the two disagree for ever and a just-recorded run read as
 * permanently stale, suppressing its code-version caption on a current
 * figure. Two definitions of one number is one too many.
 */
export function progressIntegrityFingerprint(
  report: CaseProgressIntegrity,
): Record<string, unknown> {
  return {
    periodRef: report.period?.periodRef ?? null,
    basisDigest: report.basisDigest ?? null,
    claimedElementCount: report.claimedElementCount,
    coveredElementCount: report.coveredElementCount,
    evidenceCount: report.evidenceCount,
  };
}

/**
 * The live fingerprint of the §51 forecast inputs.
 *
 * The forecast section renders the single most consequential figure in the
 * slice — the deterministic EAC and finish date a sanction paper is written
 * against — and had no staleness check at all: no fingerprint, no caption,
 * nothing on screen when its inputs moved. The recording side already wrote
 * these fields; only the comparison was missing.
 */
export function forecastConfidenceFingerprint(
  fc: ForecastConfidence,
): Record<string, unknown> {
  return {
    costLineCount: fc.cost.costLineCount,
    forecastLineCount: fc.cost.recordedForecastLineCount,
    activityCount: fc.schedule.activityCount,
    activitiesWithDurationRange: fc.schedule.activitiesWithDurationRange,
    estimateConfidenceBand: fc.estimateConfidence?.band ?? "unrated",
  };
}

/** The live fingerprint of the estimate-confidence inputs. */
export function estimateConfidenceFingerprint(
  basis: CaseEstimateBasis,
): Record<string, unknown> {
  return {
    basisVersion: basis.confidence?.basisVersion ?? null,
    estimateClass: basis.current?.estimateClass ?? null,
    scopeMaturity: basis.current?.scopeMaturity ?? null,
    quantityBasedPercent: basis.current?.quantityBasedPercent ?? null,
    quotationSupport: basis.current?.quotationSupport ?? null,
  };
}

/** The live fingerprint of the trend inputs. */
export function performanceTrendFingerprint(
  trend: CasePerformanceTrend,
): Record<string, unknown> {
  return {
    periodCount: trend.periodCount,
    measuredPointCount: trend.measuredPointCount,
    refusedPointCount: trend.refusedPointCount,
    gapCount: trend.gaps.length,
  };
}

/**
 * The trend sentence. A direction needs two measured points, and a gap is
 * reported rather than smoothed over.
 */
export function trendSentence(trend: CasePerformanceTrend): string {
  if (trend.refusal != null) return trend.refusal;
  const bits: string[] = [];
  // A DIRECTION IS THE DIRECTION OF THE LAST INTERVAL, AND IT SAYS WHICH.
  // An absent direction is NAMED rather than dropped: printing "schedule
  // performance improving" while the cost direction silently vanished from
  // the sentence is the one thing this slice must not do.
  if (trend.costTrend != null) {
    bits.push(
      `cost performance ${trend.costTrend}${
        trend.costTrendInterval ? ` (${trend.costTrendInterval})` : ""
      }`,
    );
  }
  if (trend.scheduleTrend != null) {
    bits.push(
      `schedule performance ${trend.scheduleTrend}${
        trend.scheduleTrendInterval ? ` (${trend.scheduleTrendInterval})` : ""
      }`,
    );
  }
  const absent = [trend.costTrendRefusal, trend.scheduleTrendRefusal]
    .filter((r): r is string => r != null)
    .join(" ");
  const volatile = [trend.costTrendVolatility, trend.scheduleTrendVolatility]
    .filter((v): v is string => v != null)
    .join(" ");
  const gap =
    trend.gaps.length > 0
      ? ` ${trend.gaps.length} period(s) carry no measured run and are left as gaps rather than interpolated across.`
      : "";
  const head =
    bits.length > 0
      ? `Across ${trend.measuredPointCount} measured period(s), by the last interval: ${bits.join(" and ")}.`
      : `Across ${trend.measuredPointCount} measured period(s):`;
  return [head, absent, volatile].filter((s) => s !== "").join(" ") + gap;
}

/**
 * The sentence an EMPTY set gets, one level down from controls.ts's own rule.
 *
 * "No progress discrepancies" over a case with no independent evidence is
 * reassurance about an empty set — the vacuous truth that makes an assurance
 * screen worth ignoring.
 */
export function integrityHeadline(report: CaseProgressIntegrity): string {
  if (report.refusal != null) return report.refusal;
  return (
    report.headline ??
    "The cross-check produced no headline, which should not happen once a rating exists."
  );
}

/**
 * AUTHORING PREVIEW ONLY — the cumulative credit of a rule being TYPED.
 *
 * This runs over steps that do not exist server-side yet, so the form can
 * show what each step will be worth before the rule is recorded. NO CLAIMED
 * FIGURE EVER PASSES THROUGH IT: a claimed percent is derived by
 * trg_progress_claim from the stored rule, for every writer, and arrives on
 * the claim row. If this function and the trigger ever disagree, the trigger
 * is right and this preview is a bug — which is why it is named as a preview
 * and used in exactly one place.
 */
export function previewCumulativeCredit(
  steps: { step: string; weight: number }[],
): number[] {
  const out: number[] = [];
  let running = 0;
  for (const s of steps) {
    // A NON-FINITE WEIGHT PROPAGATES. Treating it as zero made a rule
    // containing NaN preview a ladder that reached a tidy 100 — the form
    // showing a valid convention over an input the server refuses. NaN is
    // what the ladder is worth, so NaN is what it shows.
    running += s.weight;
    out.push(running);
  }
  return out;
}

/**
 * Pre-flight for the rule-of-credit authoring form.
 *
 * The AUTHORITY is `enforce_rule_of_credit` in migration 20261201090000,
 * which re-validates every writer including service callers. This exists so
 * the form can say what is wrong before a round trip, and it deliberately
 * returns the same refusals in the same terms.
 */
export function validateRuleSteps(
  steps: { step: string; weight: number }[],
): string | null {
  if (steps.length === 0) {
    return "A rule of credit is a list of earning steps — add at least one.";
  }
  for (const [i, s] of steps.entries()) {
    if (s.step.trim().length < 3) {
      return `Step ${i + 1} has no label — a claim names a step, and an unnamed step cannot be named.`;
    }
    if (!Number.isFinite(s.weight)) {
      return `Step "${s.step}" carries no finite weight.`;
    }
    if (s.weight <= 0 || s.weight > 100) {
      return `Step "${s.step}" carries a weight of ${s.weight}; a step earns more than nothing and no more than the whole.`;
    }
  }
  // THE SERVER SUMS IN `numeric`, WHICH IS EXACT DECIMAL. A float tolerance
  // here disagreed with it at the boundary in both directions: 33.33 + 33.33
  // + 33.34 is exactly 100 in numeric and 100.00000000000001 in binary
  // floating point, so an exact float test would refuse a rule the server
  // accepts, and a tolerant one would accept weights the server refuses.
  // Summing in fixed-point decimal at the widest scale the caller typed
  // makes the two agree by construction rather than by luck.
  const scale = steps.reduce((m, s) => {
    const dp = (String(s.weight).split(".")[1] ?? "").length;
    return Math.max(m, dp);
  }, 0);
  const factor = 10 ** scale;
  const sum = steps.reduce((a, s) => a + Math.round(s.weight * factor), 0);
  if (sum !== 100 * factor) {
    return `The steps carry ${sum / factor} percent of credit between them, not 100. A rule that does not add to the whole caps or inflates every element it governs, and nothing downstream would say why.`;
  }
  return null;
}
