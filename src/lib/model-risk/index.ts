/**
 * Model risk: calibration, drift and the limits of both
 * (capability register E5.08, E5.09, E5.10, E5.11).
 *
 * This platform emits numbers that look like probabilities — a health score of
 * 30, a risk score of 82 — and those numbers drive work. The question nobody
 * usually asks is whether they are RIGHT: of the assets scored 30, did about
 * 30% actually fail?
 *
 * THE REFUSAL THAT MATTERS MOST HERE, AND IT IS ABOUT THIS PLATFORM.
 *
 * Calibration cannot be measured without recorded outcomes. A score with no
 * outcome behind it is unfalsifiable: it can never be shown wrong, which is
 * not the same as being right, and it is the state most deployed models live
 * in permanently. `assessCalibration` refuses to report a Brier score or a
 * reliability curve from predictions alone, and says why in those words.
 *
 * BRIER SCORE. Mean squared error of a probabilistic forecast:
 *
 *     BS = (1/n) Σ (p_i − o_i)²
 *
 * Lower is better, but the number is meaningless on its own. It is compared
 * against the CLIMATOLOGY baseline — always predicting the base rate — because
 * a model that cannot beat "assume the average" has earned nothing. The skill
 * score makes that comparison explicit.
 *
 * DRIFT uses the population stability index:
 *
 *     PSI = Σ (a_i − e_i) · ln(a_i / e_i)
 *
 * with the conventional bands: below 0.1 no meaningful shift, 0.1–0.25
 * moderate, above 0.25 significant. Those bands are an industry convention
 * rather than a theorem, and the code says so rather than presenting them as
 * a law.
 *
 * Pure: no database, no network.
 */

export interface Prediction {
  /** Predicted probability of the event, 0–1. */
  predicted: number;
  /** What actually happened. Null means the outcome was never recorded. */
  outcome: boolean | null;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number;
  observedRate: number;
  /** Positive means the model was over-confident in this bin. */
  gap: number;
}

export interface CalibrationResult {
  measurable: boolean;
  scored: number;
  withOutcome: number;
  baseRate: number | null;
  brierScore: number | null;
  /** Brier score of always predicting the base rate. */
  climatologyBrier: number | null;
  /** 1 − BS/BS_climatology. Zero or below means the model adds nothing. */
  skillScore: number | null;
  bins: ReliabilityBin[];
  reason: string;
}

/**
 * How well do the scores correspond to reality?
 *
 * `minimumOutcomes` guards against a confident answer from six data points:
 * a Brier score over a handful of outcomes is noise with a decimal place.
 */
export function assessCalibration(
  predictions: Prediction[],
  binCount = 5,
  minimumOutcomes = 30,
): CalibrationResult {
  const withOutcome = predictions.filter((p) => p.outcome !== null);

  const empty: CalibrationResult = {
    measurable: false,
    scored: predictions.length,
    withOutcome: withOutcome.length,
    baseRate: null,
    brierScore: null,
    climatologyBrier: null,
    skillScore: null,
    bins: [],
    reason: "",
  };

  if (predictions.length === 0) {
    return { ...empty, reason: "No predictions are recorded." };
  }
  if (withOutcome.length === 0) {
    return {
      ...empty,
      reason:
        `${predictions.length} score(s) are recorded and NONE has an outcome against it. ` +
        `Calibration cannot be measured, which means these scores are unfalsifiable — they can never be shown ` +
        `wrong, and that is not the same as being right. Recording what actually happened is the only thing ` +
        `that turns a score into a claim anyone can check.`,
    };
  }
  if (withOutcome.length < minimumOutcomes) {
    return {
      ...empty,
      reason:
        `Only ${withOutcome.length} of ${predictions.length} score(s) have a recorded outcome, below the ${minimumOutcomes} needed ` +
        `for a calibration figure that is not mostly noise. A Brier score over a handful of outcomes is noise with a decimal place.`,
    };
  }

  const n = withOutcome.length;
  const baseRate = withOutcome.filter((p) => p.outcome).length / n;
  const brier =
    withOutcome.reduce((s, p) => {
      const o = p.outcome ? 1 : 0;
      return s + (p.predicted - o) ** 2;
    }, 0) / n;
  // Always predicting the base rate reduces to p(1−p).
  const climatology = baseRate * (1 - baseRate);
  const skill = climatology > 0 ? 1 - brier / climatology : null;

  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const lower = i / binCount;
    const upper = (i + 1) / binCount;
    const inBin = withOutcome.filter(
      (p) =>
        p.predicted >= lower &&
        (i === binCount - 1 ? p.predicted <= upper : p.predicted < upper),
    );
    if (inBin.length === 0) continue;
    const meanPredicted =
      inBin.reduce((s, p) => s + p.predicted, 0) / inBin.length;
    const observedRate = inBin.filter((p) => p.outcome).length / inBin.length;
    bins.push({
      lower,
      upper,
      count: inBin.length,
      meanPredicted,
      observedRate,
      gap: meanPredicted - observedRate,
    });
  }

  const worst = bins.reduce(
    (w, b) => (Math.abs(b.gap) > Math.abs(w?.gap ?? 0) ? b : w),
    bins[0],
  );

  const verdict =
    skill === null
      ? "No skill score is computable: every recorded outcome went the same way, so there is nothing for the model to have got right or wrong."
      : skill <= 0
        ? `Skill score ${skill.toFixed(3)}: the model does NOT beat simply predicting the base rate of ${(baseRate * 100).toFixed(1)}%. On this evidence the scores add nothing over an average.`
        : `Skill score ${skill.toFixed(3)} against a base rate of ${(baseRate * 100).toFixed(1)}% — the scores carry information beyond the average.`;

  return {
    measurable: true,
    scored: predictions.length,
    withOutcome: n,
    baseRate,
    brierScore: brier,
    climatologyBrier: climatology,
    skillScore: skill,
    bins,
    reason:
      `Brier score ${brier.toFixed(4)} over ${n} outcome(s). ${verdict}` +
      (worst && Math.abs(worst.gap) > 0.1
        ? ` The worst-calibrated band is ${(worst.lower * 100).toFixed(0)}–${(worst.upper * 100).toFixed(0)}%, where the model predicts ${(worst.meanPredicted * 100).toFixed(0)}% and ${(worst.observedRate * 100).toFixed(0)}% actually happened — ${worst.gap > 0 ? "over-confident" : "under-confident"} by ${(Math.abs(worst.gap) * 100).toFixed(0)} points.`
        : ""),
  };
}

export interface DriftResult {
  psi: number | null;
  band: "none" | "moderate" | "significant" | null;
  contributions: {
    bucket: string;
    expected: number;
    actual: number;
    contribution: number;
  }[];
  reason: string;
}

/**
 * Population stability index between a reference and a current distribution.
 *
 * Both are given as counts per bucket. Buckets present in one and not the
 * other are included with a floor, because dropping them would hide exactly
 * the shift PSI exists to detect.
 */
export function populationStabilityIndex(
  reference: Record<string, number>,
  current: Record<string, number>,
  floor = 1e-4,
): DriftResult {
  const buckets = [
    ...new Set([...Object.keys(reference), ...Object.keys(current)]),
  ].sort();

  const refTotal = Object.values(reference).reduce((a, b) => a + b, 0);
  const curTotal = Object.values(current).reduce((a, b) => a + b, 0);

  if (refTotal === 0 || curTotal === 0) {
    return {
      psi: null,
      band: null,
      contributions: [],
      reason:
        "One of the two populations is empty, so there is no shift to measure. A drift figure needs something to drift from.",
    };
  }

  let psi = 0;
  const contributions = buckets.map((b) => {
    const e = Math.max((reference[b] ?? 0) / refTotal, floor);
    const a = Math.max((current[b] ?? 0) / curTotal, floor);
    const c = (a - e) * Math.log(a / e);
    psi += c;
    return { bucket: b, expected: e, actual: a, contribution: c };
  });
  contributions.sort((x, y) => y.contribution - x.contribution);

  const band =
    psi < 0.1
      ? ("none" as const)
      : psi < 0.25
        ? ("moderate" as const)
        : ("significant" as const);

  const top = contributions[0];
  return {
    psi,
    band,
    contributions,
    reason:
      `PSI ${psi.toFixed(4)} — ${band === "none" ? "no meaningful shift" : band === "moderate" ? "a moderate shift" : "a significant shift"} ` +
      `against the conventional 0.1 and 0.25 thresholds, which are an industry convention rather than a theorem. ` +
      (top && top.contribution > 0.01
        ? `Most of it comes from "${top.bucket}", which moved from ${(top.expected * 100).toFixed(1)}% to ${(top.actual * 100).toFixed(1)}% of the population.`
        : "No single bucket dominates the difference.") +
      (band !== "none"
        ? " A model fitted on the reference population is being asked about a different one."
        : ""),
  };
}

export interface ModelRecord {
  modelKey: string;
  version: string;
  approvedFor: string[];
  approvedOn?: string | null;
  approvedBy?: string | null;
  reviewDue?: string | null;
  /** Whether a human must confirm before the output is acted on. */
  humanInLoop: boolean;
}

export interface RegisterVerdict {
  approved: number;
  unapproved: string[];
  reviewOverdue: string[];
  autonomousWithoutApproval: string[];
  reason: string;
}

/**
 * Approved-model register (E5.10).
 *
 * The finding that matters is not how many models are approved; it is whether
 * anything is running WITHOUT approval, and in particular whether anything is
 * acting without a human in the loop and without approval. That combination
 * is the one that should never exist and is the easiest to acquire by
 * accident.
 */
export function reviewModelRegister(
  models: ModelRecord[],
  asOf: Date = new Date(0),
): RegisterVerdict {
  const approved = models.filter((m) => m.approvedOn);
  const unapproved = models.filter((m) => !m.approvedOn);
  const overdue = models.filter(
    (m) => m.reviewDue && new Date(m.reviewDue) < asOf,
  );
  const dangerous = unapproved.filter((m) => !m.humanInLoop);

  return {
    approved: approved.length,
    unapproved: unapproved.map((m) => `${m.modelKey}@${m.version}`),
    reviewOverdue: overdue.map((m) => `${m.modelKey}@${m.version}`),
    autonomousWithoutApproval: dangerous.map(
      (m) => `${m.modelKey}@${m.version}`,
    ),
    reason:
      models.length === 0
        ? "No models are registered. A platform that makes recommendations from models it has not written down cannot say what it is running."
        : `${approved.length} of ${models.length} model(s) carry an approval.` +
          (dangerous.length > 0
            ? ` ${dangerous.length} run WITHOUT approval AND WITHOUT a human in the loop: ${dangerous.map((m) => m.modelKey).join(", ")}. That combination should not exist.`
            : unapproved.length > 0
              ? ` ${unapproved.length} unapproved, all of them human-in-the-loop, so nothing acts on an unapproved model unaided.`
              : "") +
          (overdue.length > 0
            ? ` ${overdue.length} are past their review date — an approval nobody revisits is an approval decaying quietly.`
            : ""),
  };
}
