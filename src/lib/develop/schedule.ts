/**
 * Sync Develop Slice 4C — Schedule assurance: the nine II.6 defect classes
 * (D5.13), the §50 Schedule Quality Score (D5.31), the Schedule Confidence
 * Score (D5.14), the gated simulation (D5.15), the risk→schedule→economics
 * chain (D5.08) and its per-risk attribution (D5.09).
 *
 * WHAT LIVES HERE AND WHAT DOES NOT — the controls.ts / performance.ts
 * precedent, unchanged:
 *
 *   1. THE VOCABULARIES the spec fixes (the nine defect classes, §50's six
 *      score components, D5.14's four confidence components) and the
 *      PUBLISHED POLICY NUMBERS. They mirror `sync_schedule_quality_policy()`
 *      and `sync_schedule_simulation_policy()` and the slice test pins each
 *      one against the migration text, so a threshold cannot be widened on
 *      one side only.
 *
 *   2. THE TYPES for the payloads, so a page cannot read a key the RPC does
 *      not return.
 *
 *   3. PURE PRESENTATION HELPERS. NOT calculations, and specifically NOT a
 *      percentile. `percentileCell` in performance.ts is still the ONE place
 *      an absent P50/P80 is rendered, and nothing here derives a percentile
 *      from a deterministic figure. The simulation is the kernel's
 *      (src/lib/modelling/integrated-risk.ts); the diagnosis is the server's
 *      (get_case_schedule_quality); this module renders what they produced.
 */

/* ────────────────────────── the vocabularies ─────────────────────────── */

/**
 * Spec II.6's nine, in the spec's own order: "missing logic, open ends,
 * excessive constraints, long-duration activities, negative float,
 * unrealistic lags, broken critical paths, excessive concurrency,
 * unrealistic calendars."
 *
 * `scores` marks the six §50 names. The other three are diagnosed and BLOCK
 * THE GATE in their own right but carry no §50 weight — §50 enumerates its
 * own composition, and inventing three more weighted terms would make the
 * published number stop being the spec's number (migration ruling R8).
 */
export const SCHEDULE_DEFECT_CLASSES = [
  { key: "missing_logic", label: "Missing logic", scores: true },
  { key: "open_ends", label: "Open ends", scores: true },
  {
    key: "excessive_constraints",
    label: "Excessive constraints",
    scores: true,
  },
  { key: "long_durations", label: "Long-duration activities", scores: true },
  { key: "negative_float", label: "Negative float", scores: false },
  { key: "unrealistic_lags", label: "Unrealistic lags", scores: false },
  { key: "broken_critical_path", label: "Broken critical path", scores: true },
  {
    key: "excessive_concurrency",
    label: "Excessive concurrency",
    scores: false,
  },
  {
    key: "unrealistic_calendars",
    label: "Unrealistic calendars",
    scores: true,
  },
] as const;

export type ScheduleDefectClassKey =
  (typeof SCHEDULE_DEFECT_CLASSES)[number]["key"];

/** §50's six components, in the spec's order. */
export const SCHEDULE_SCORE_COMPONENTS = [
  { key: "logic_completeness", label: "Logic completeness", weight: 20 },
  { key: "open_ends", label: "Open ends", weight: 20 },
  { key: "constraints", label: "Constraints", weight: 15 },
  { key: "duration_quality", label: "Duration quality", weight: 15 },
  {
    key: "critical_path_continuity",
    label: "Critical-path continuity",
    weight: 20,
  },
  { key: "calendar_consistency", label: "Calendar consistency", weight: 10 },
] as const;

/** D5.14's four. Distinct from quality: what will this schedule BEAR? */
export const SCHEDULE_CONFIDENCE_COMPONENTS = [
  { key: "structure", label: "Structure (§50 score)", weight: 40 },
  {
    key: "uncertaintyExpressed",
    label: "Uncertainty expressed",
    weight: 25,
  },
  { key: "importHistory", label: "Import history", weight: 15 },
  { key: "scopeAnchoring", label: "Scope anchoring", weight: 20 },
] as const;

/**
 * The published policy, mirroring `sync_schedule_quality_policy()` and
 * `sync_schedule_simulation_policy()`. Pinned against the migration by the
 * slice test.
 *
 * NOTHING HERE IS TENANT-CONFIGURABLE and nothing here may be lowered. A
 * schedule-quality threshold somebody can move is a Monte Carlo gate somebody
 * can open, which is the failure spec II.6 exists to prevent.
 */
export const SCHEDULE_QUALITY_POLICY = {
  minimumActivities: 5,
  minimumRelationships: 2,
  minimumDiagnosableComponents: 4,
  minimumScoreToSimulate: 60,
  longDurationHours: 1056,
  excessiveLagHours: 120,
  criticalFloatHours: 0,
} as const;

export const SCHEDULE_SIMULATION_POLICY = {
  minimumIterations: 1000,
  maximumIterations: 100000,
  /**
   * What this floor GUARANTEES: at least one input to the sample varies, so a
   * run over an entirely fixed network is refused. It does NOT guarantee the
   * spread is broadly based — one ranged activity among forty fixed ones
   * passes it, and that case is DISCLOSED (the run records how many
   * activities were held fixed and that their contribution is understated,
   * not zero) rather than blocked.
   */
  minimumSampledRanges: 1,
  maximumAttributedRisks: 50,
  maximumCriticalityRows: 5000,
  kernelModule: "src/lib/modelling/integrated-risk.ts",
  /**
   * The kernel versions the server will accept as the code identity of a
   * recorded distribution. An unpinned free-text field made "a distribution
   * whose code identity is unknown cannot be re-run" unfalsifiable: the door
   * accepted "totally-made-up-kernel". Pinned on both sides.
   */
  kernelVersions: ["integrated-risk/4C/2026-12-02"],
} as const;

/** The default a surface offers. Above the floor, cheap enough to re-run. */
export const DEFAULT_SIMULATION_ITERATIONS = 2000;

/**
 * The code identity recorded on every 4C calculation run.
 *
 * MIRRORS sync_calculation_code_version() in migration 20261202090000 and is
 * pinned against it by the slice test. The SERVER stamps the version on the
 * row; this constant exists so the surface can say WHICH code version it is
 * showing, and so a bump that lands on one side only fails CI.
 */
export const SCHEDULE_CALC_VERSION = "develop-schedule/4C/2026-12-02";

/** The three calculation keys this slice records. */
export const SCHEDULE_CALC_KEYS = [
  "case_schedule_quality",
  "case_risk_schedule_economics",
  "case_schedule_simulation",
] as const;

export type ScheduleCalcKey = (typeof SCHEDULE_CALC_KEYS)[number];

/* ─────────────────────────── payload types ───────────────────────────── */

export type DefectSeverity = "pass" | "warn" | "fail" | "not_diagnosable";

export interface ScheduleDefectClass {
  key: string;
  label: string;
  definition: string;
  diagnosable: boolean;
  count: number | null;
  denominator: number | null;
  share: number | null;
  failThreshold: number;
  warnThreshold: number;
  severity: DefectSeverity;
  componentScore: number | null;
  notDiagnosableReason: string | null;
}

export interface ScheduleQualityGateVerdict {
  permitted: boolean;
  failingClasses: string[];
  notDiagnosableClasses: string[];
  minimumScore: number;
  refusal: string | null;
}

export interface ScheduleConfidenceComponent {
  weight: number;
  value: number | null;
  basis: string;
}

export interface CaseScheduleQuality {
  caseId: string;
  activityCount: number;
  importedCount: number;
  localCount: number;
  relationshipCount: number;
  activitiesWithPlannedDates: number;
  activitiesWithDurationRange: number;
  activitiesWithWbs: number;
  activitiesWithFloat: number;
  criticalActivityCount: number;
  acceptedImportRuns: number;
  classes: ScheduleDefectClass[];
  /**
   * The content of the nine classes — `severity:count/denominator` per key.
   * The staleness fingerprint used to be seven COUNTS, and every one of the
   * nine classes can flip without moving a count, so a published §50 score
   * stayed labelled current while the diagnosis under it had changed.
   */
  classSignature: Record<string, string>;
  score: number | null;
  scoreRefusal: string | null;
  diagnosableComponents: number;
  notDiagnosable: string[];
  confidence: number | null;
  confidenceComponents: {
    structure: ScheduleConfidenceComponent;
    uncertaintyExpressed: ScheduleConfidenceComponent;
    importHistory: ScheduleConfidenceComponent;
    scopeAnchoring: ScheduleConfidenceComponent;
  };
  confidenceRefusal: string | null;
  gate: ScheduleQualityGateVerdict;
  evaluable: boolean;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface RiskScheduleLink {
  id: string;
  riskId: string;
  riskTitle: string;
  riskLevel: string | null;
  riskStatus: string;
  activityId: number;
  activityKey: string;
  activityLabel: string;
  activityOrigin: string;
  activityPlannedFinish: string | null;
  wbsCode: string | null;
  probability: number;
  delayDaysOptimistic: number;
  delayDaysLikely: number;
  delayDaysPessimistic: number;
  costOptimistic: number | null;
  costLikely: number | null;
  costPessimistic: number | null;
  currency: string | null;
  basis: string;
  recordedBy: string | null;
  recordedAt: string;
  economicHop: string;
  economicHopAvailable: boolean;
}

export interface DelayCostRate {
  caseId: string;
  key: string;
  value: number | null;
  unit: string | null;
  source: string | null;
  effectiveFrom?: string;
  label?: string;
  refusal: string | null;
}

export interface CaseRiskScheduleChain {
  caseId: string;
  links: RiskScheduleLink[];
  linkCount: number;
  openRiskCount: number;
  linkedRiskCount: number;
  unlinkedRisks: {
    riskId: string;
    riskTitle: string;
    riskLevel: string | null;
  }[];
  retiredLinks: {
    riskId: string;
    riskTitle: string;
    riskStatus: string;
    activityKey: string;
  }[];
  /** Named when impact edges belong to risks that are now closed/archived. */
  retiredLinkNote: string | null;
  delayCostRate: DelayCostRate;
  coverageNote: string;
  evaluable: boolean;
  calculationRunId?: string;
  codeVersion?: string;
}

export interface SimulationAttributionRow {
  riskId: string;
  riskTitle: string;
  activityId: string;
  occurrenceRate: number;
  p80HoursContribution: number;
  p80DaysContribution: number;
  meanCostContribution: number | null;
  p80CostContribution: number | null;
  reason: string;
}

export interface CaseScheduleSimulation {
  caseId: string;
  exists: boolean;
  runCount: number;
  /** False when the schedule has changed since this run was recorded. */
  current: boolean;
  id?: string;
  seed?: number;
  iterations?: number;
  kernelVersion?: string;
  qualityScore?: number;
  scheduleConfidence?: number | null;
  activityCount?: number;
  sampledRangeCount?: number;
  riskLinkCount?: number;
  deterministicHours?: number;
  p10Hours?: number;
  p50Hours?: number;
  p80Hours?: number;
  p90Hours?: number;
  probabilityOnPlan?: number | null;
  deterministicFinish?: string | null;
  p50Finish?: string | null;
  p80Finish?: string | null;
  currency?: string | null;
  costBase?: number | null;
  costExposureP50?: number | null;
  costExposureP80?: number | null;
  costP50?: number | null;
  costP80?: number | null;
  delayCostPerDay?: number | null;
  criticality?: {
    id: string;
    label: string;
    criticalityIndex: number;
    deterministicFloat: number;
  }[];
  attribution?: SimulationAttributionRow[];
  refusals?: string[];
  calculationRunId?: string | null;
  computedBy?: string | null;
  computedAt?: string;
  staleReason?: string | null;
  /** False when the EAC / cost-of-delay this run added its exposure to moved. */
  costCurrent?: boolean;
  costStaleReason?: string | null;
  refusal?: string;
}

/**
 * Whether the schedule's LOGIC is logic the kernel models.
 *
 * `criticalPath` in src/lib/modelling/schedule-risk.ts reads every edge as
 * finish-to-start with zero lag. The digest hashes the link type and the lag,
 * so a schedule using SS/FF/SF or lags would have produced a distribution over
 * a DIFFERENT network under a digest that said otherwise — silently, because
 * the percentiles look exactly like correct ones. The simulation refuses
 * instead. A relationship stating NO type is read as finish-to-start (P6's own
 * default) and that reading is disclosed, not hidden.
 */
export interface ScheduleLogicSupport {
  relationshipCount: number;
  nonFinishToStartCount: number;
  laggedCount: number;
  unstatedLinkTypeCount: number;
  supported: boolean;
  refusal: string | null;
  assumptionNote: string | null;
}

/** What `get_case_simulation_inputs` hands the kernel. */
export interface SimulationInputs {
  caseId: string;
  activities: {
    /** The activity ROW id as text — the kernel's node identity. */
    id: string;
    /** The P6/Sync activity id a human recognises. Display only. */
    key: string;
    label: string;
    duration: number;
    optimistic: number | null;
    pessimistic: number | null;
    predecessors: string[];
    /** The stated link type and lag on each edge, for display and refusal. */
    predecessorLogic: {
      id: string;
      linkType: string | null;
      lagHours: number | null;
    }[];
    plannedFinish: string | null;
  }[];
  risks: RiskScheduleLink[];
  delayCostPerDay: number | null;
  delayCostSource: string | null;
  delayCostRefusal: string | null;
  deterministicFinish: string | null;
  costBase: number | null;
  costBaseLabel: string;
  costBaseFormula: string | null;
  costBaseRefusal: string | null;
  currency: string | null;
  digest: { activityDigest: string; riskDigest: string; costDigest: string };
  policy: typeof SCHEDULE_SIMULATION_POLICY;
  logicSupport: ScheduleLogicSupport;
  gate: ScheduleQualityGateVerdict;
  qualityScore: number | null;
  scheduleConfidence: number | null;
  coverageNote: string;
  retiredLinkNote: string | null;
  unlinkedRisks: { riskId: string; riskTitle: string }[];
}

/** What `set_schedule_activity_duration_range` returns (D5.28/D5.14/D5.07). */
export interface DurationRangeStatement {
  case_id: string;
  activity_key: string;
  basis_id: string;
  optimisticHours: number;
  mostLikelyHours: number;
  pessimisticHours: number;
  note: string;
}

/* ────────────────────────── presentation helpers ─────────────────────── */

/**
 * How a defect class is rendered. A NOT-DIAGNOSABLE class is deliberately
 * NOT green: the whole failure mode this slice guards against is a blind spot
 * reading as a clean bill of health.
 */
export function defectTone(severity: DefectSeverity): {
  text: string;
  tone: "good" | "warn" | "bad" | "absent";
} {
  switch (severity) {
    case "pass":
      return { text: "PASS", tone: "good" };
    case "warn":
      return { text: "WARN", tone: "warn" };
    case "fail":
      return { text: "FAIL", tone: "bad" };
    default:
      return { text: "NOT DIAGNOSABLE", tone: "absent" };
  }
}

/**
 * The count a class reports, or the honest absence.
 *
 * "0 of 40" and "not diagnosable" must never render the same way: the first
 * says the schedule is clean on this class, the second says nobody knows.
 */
export function defectCount(cls: ScheduleDefectClass): string {
  if (!cls.diagnosable || cls.count == null || cls.denominator == null) {
    return "not diagnosable";
  }
  if (cls.key === "broken_critical_path") {
    return cls.count === 0 ? "continuous" : "broken";
  }
  const pct = cls.share != null ? ` (${(cls.share * 100).toFixed(1)}%)` : "";
  return `${cls.count} of ${cls.denominator}${pct}`;
}

/** The §50 score band. Bands are presentation; the gate is the number. */
export function qualityBand(score: number | null): {
  text: string;
  tone: "good" | "warn" | "bad" | "absent";
} {
  if (score == null) return { text: "NOT SCORED", tone: "absent" };
  if (score >= 85) return { text: "STRONG", tone: "good" };
  if (score >= SCHEDULE_QUALITY_POLICY.minimumScoreToSimulate) {
    return { text: "ADEQUATE", tone: "warn" };
  }
  return { text: "POOR", tone: "bad" };
}

/**
 * The one-sentence gate statement a planner reads before pressing simulate.
 * Never softened: "cannot" rather than "should not".
 */
export function gateHeadline(quality: CaseScheduleQuality): string {
  if (quality.gate.permitted) {
    const blind = quality.gate.notDiagnosableClasses.length;
    return (
      `A Monte Carlo may run on this schedule: §50 score ${quality.score ?? "—"} against a minimum of ${quality.gate.minimumScore}, and no defect class is over its published threshold.` +
      (blind > 0
        ? ` ${blind} class(es) could not be diagnosed at all and therefore neither passed nor failed — the gate is only as wide as what the data can answer.`
        : "")
    );
  }
  return (
    quality.gate.refusal ??
    "A Monte Carlo cannot run on this schedule: it did not pass its quality diagnostics."
  );
}

/**
 * Whether a recorded simulation may have its percentiles shown as CURRENT.
 *
 * A recorded run whose input digest no longer matches the live schedule is a
 * statement about a schedule that no longer exists. Showing its P80 as the
 * forecast is worse than showing none, because it is specific.
 */
export function simulationIsCurrent(
  sim: CaseScheduleSimulation | null | undefined,
): boolean {
  return sim != null && sim.exists === true && sim.current === true;
}

/**
 * A probability rendered as a percentage, or the honest absence.
 *
 * `probabilityOnPlan` reached the screen through a door that never checked it:
 * `99999` rendered as "9999900%" under the heading "On plan", and a stored SQL
 * NaN (which `to_jsonb` serialises as the STRING "NaN", so the declared
 * `number | null` type was wrong too) rendered as "NaN%". The column now
 * refuses both, and this is the second line of defence on a figure whose
 * failure mode is a confident-looking number.
 */
export function criticalityPercent(
  value: number | string | null | undefined,
): string | null {
  return probabilityPercent(value);
}

/**
 * A criticality index or an on-plan probability rendered as a percentage, or
 * the honest absence. Both are shares of the run, so both live in [0,1].
 */
export function probabilityPercent(
  value: number | string | null | undefined,
): string | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (n == null || !Number.isFinite(n) || n < 0 || n > 1) return null;
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Hours of overrun, in the unit a reader thinks in.
 *
 * This is a UNIT CONVERSION on a simulated figure, not a derivation: it never
 * turns a deterministic number into a percentile. `hours` comes off the
 * sample or it is null and nothing is rendered.
 */
export function overrunDays(
  percentileHours: number | null | undefined,
  deterministicHours: number | null | undefined,
): number | null {
  if (percentileHours == null || deterministicHours == null) return null;
  if (
    !Number.isFinite(percentileHours) ||
    !Number.isFinite(deterministicHours)
  ) {
    return null;
  }
  return (percentileHours - deterministicHours) / 24;
}

/**
 * The live fingerprint of the schedule-quality inputs, for staleness.
 *
 * Same contract as `earnedValueFingerprint` (D11.29): the recorded run holds
 * these values, and a mismatch means the world moved. `policyDigest` is
 * absent here on purpose — the policy is code, and a policy change is a code
 * version change, which the caption already carries.
 */
export function scheduleQualityFingerprint(
  quality: CaseScheduleQuality,
): Record<string, unknown> {
  return {
    activityCount: quality.activityCount,
    relationshipCount: quality.relationshipCount,
    activitiesWithFloat: quality.activitiesWithFloat,
    activitiesWithPlannedDates: quality.activitiesWithPlannedDates,
    activitiesWithDurationRange: quality.activitiesWithDurationRange,
    activitiesWithWbs: quality.activitiesWithWbs,
    acceptedImportRuns: quality.acceptedImportRuns,
    // THE COUNTS CANNOT SEE A DEFECT CHANGE. Every one of the nine classes can
    // flip without moving any count above: durations, lags, link types,
    // planned dates, a constraint_type on an already-constrained row, the sign
    // of total_float_hours. Proven in review — `duration_hours := 2000` on
    // every activity took the live score from 100 to 81.3 and closed the gate
    // while the panel kept printing "§50 Schedule Quality Score 100" with no
    // stale label. `classSignature` is computed IN SQL by
    // get_case_schedule_quality and recorded by compute_case_schedule_quality,
    // so both sides compare one definition of "the diagnosis changed".
    classSignature: quality.classSignature ?? null,
  };
}

/** The live fingerprint of the D5.08 chain. */
export function riskChainFingerprint(
  chain: CaseRiskScheduleChain,
): Record<string, unknown> {
  return {
    linkCount: chain.linkCount,
    openRiskCount: chain.openRiskCount,
    linkedRiskCount: chain.linkedRiskCount,
    delayCostPerDay: chain.delayCostRate?.value ?? null,
  };
}

/**
 * The live fingerprint of a recorded simulation.
 *
 * The digests are what actually decide staleness and the SERVER compares them
 * (`get_case_schedule_simulation.current`), because the client does not hold
 * the raw activity rows the digest is built from. This fingerprint is the
 * surface's second, cheaper check on the same question, so the lineage block
 * and the percentile cells agree about whether a run is current.
 */
export function simulationFingerprint(
  sim: CaseScheduleSimulation,
): Record<string, unknown> {
  return {
    seed: sim.seed ?? null,
    iterations: sim.iterations ?? null,
    kernelVersion: sim.kernelVersion ?? null,
    activityCount: sim.activityCount ?? null,
    sampledRangeCount: sim.sampledRangeCount ?? null,
    riskLinkCount: sim.riskLinkCount ?? null,
  };
}

/**
 * The attribution sentence spec I.10 asks for, in the spec's own shape:
 * "Compressor delivery currently contributes 17 days of P80 schedule exposure
 * and $14.2M expected economic exposure."
 *
 * The money half is OMITTED, not zeroed, when the delay-cost rate is absent.
 */
export function attributionSentence(
  row: SimulationAttributionRow,
  currency: string | null | undefined,
): string {
  const days = `${row.p80DaysContribution.toFixed(1)} day(s) of P80 schedule exposure`;
  if (row.meanCostContribution == null) {
    return `${row.riskTitle} currently contributes ${days}. The economic half is absent: no direct cost impact is recorded for this risk and this case has no cost of delay, so the chain stops at the schedule.`;
  }
  // An unlabelled money figure on a forecast is not a smaller problem than a
  // missing one: 419,851 of WHAT is a question the reader answers by guessing.
  // `formatPerformanceValue` already refuses this way for every other figure
  // on these panels; this helper used to drop the unit silently.
  const amount = Math.round(row.meanCostContribution).toLocaleString();
  const money =
    currency == null || currency.trim() === ""
      ? `${amount} (currency not established)`
      : `${currency} ${amount}`;
  return `${row.riskTitle} currently contributes ${days} and ${money} of expected economic exposure.`;
}
