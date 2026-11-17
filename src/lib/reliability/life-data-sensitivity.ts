/**
 * Likelihood-ratio uncertainty and recoding sensitivity for Weibull life data
 * (BOK-01 follow-on).
 *
 * `life-data-bounds.ts` returns Fisher-matrix bounds and itself says they are
 * optimistic below ~10 failures and that likelihood-ratio bounds are preferred.
 * This module supplies those, and a sensitivity check for the question that
 * decides whether a "wear-out" reading can be trusted:
 *
 *   How many of the planned removals would have to have been hidden failures
 *   before the interval on beta clears 1?
 *
 * Methods (stated, not assumed):
 *   - Profile-likelihood interval on beta: for each beta, eta is replaced by
 *     its conditional MLE, eta(b) = (Σ t^b / r)^(1/b); the interval is the set
 *     of beta whose profile log-likelihood is within χ²(conf; 1)/2 of the
 *     maximum (Meeker & Escobar 1998 §8.3; Abernethy, New Weibull Handbook).
 *   - Recoding sensitivity: the earliest censored (planned) removals are
 *     recoded as failures one at a time and the fit and interval repeated.
 *     The first k at which the lower bound exceeds 1 is reported. It describes
 *     how fragile the reading is. It does NOT claim those removals were
 *     failures, and it never changes the stored event types.
 *   - The value 1 is the exponential boundary of the Weibull family (no age
 *     effect). It is a mathematical landmark, not an engineering threshold.
 *
 * Reuses `weibullMLE` and `weibullLogLikelihood`. Pure: no I/O, no
 * randomness, no LLM.
 */

import { weibullMLE } from "./index";
import { weibullLogLikelihood } from "./life-data-bounds";
import { chiSquareQuantile } from "./stats";

export interface BetaLikelihoodRatioBounds {
  confidence: number;
  method: "profile-likelihood-ratio";
  failures: number;
  censored: number;
  beta: {
    estimate: number;
    /** null when the interval is not bounded below within the search range. */
    lower: number | null;
    /** null when the interval is not bounded above within the search range. */
    upper: number | null;
  };
  eta: number;
  /** Beta's whole interval lies above 1. */
  wearOutDemonstrated: boolean;
  /** Beta's interval includes 1: the failure pattern is undecided. */
  patternUndecided: boolean;
  caution: string;
}

const BETA_SEARCH_MIN = 0.01;
const BETA_SEARCH_MAX = 100;

function profileLogLikelihood(
  beta: number,
  failures: number[],
  censored: number[],
): number {
  const r = failures.length;
  let sum = 0;
  for (const t of [...failures, ...censored]) sum += Math.pow(t, beta);
  const eta = Math.pow(sum / r, 1 / beta);
  return weibullLogLikelihood({ beta, eta }, failures, censored);
}

function bisect(
  g: (x: number) => number,
  insideX: number,
  outsideX: number,
): number {
  // g(insideX) >= 0 (inside the interval), g(outsideX) < 0.
  let a = insideX;
  let b = outsideX;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (g(m) >= 0) a = m;
    else b = m;
    if (Math.abs(b - a) < 1e-10 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

/**
 * Profile-likelihood (likelihood-ratio) confidence interval on the Weibull
 * shape parameter, two-sided, from failures and right-censored times.
 *
 * Throws on fewer than 2 distinct failure times (the model is not
 * identifiable): callers must surface "insufficient data", never a guess.
 */
export function weibullBetaLikelihoodRatioBounds(
  failureTimes: number[],
  censoredTimes: number[] = [],
  confidence = 0.9,
): BetaLikelihoodRatioBounds {
  if (!(confidence > 0 && confidence < 1))
    throw new Error(
      `Confidence must be strictly between 0 and 1 (got ${confidence}).`,
    );
  const fails = failureTimes.filter((t) => t > 0);
  const cens = censoredTimes.filter((t) => t > 0);
  const fit = weibullMLE(fails, cens);
  if (!fit.converged)
    throw new Error(
      "The maximum-likelihood fit did not converge; no interval is reported.",
    );
  const llHat = profileLogLikelihood(fit.beta, fails, cens);
  const cut = llHat - chiSquareQuantile(confidence, 1) / 2;
  const g = (b: number) => profileLogLikelihood(b, fails, cens) - cut;

  let lower: number | null = null;
  for (let b = fit.beta / 1.05; b >= BETA_SEARCH_MIN; b /= 1.05) {
    if (g(b) < 0) {
      lower = bisect(g, b * 1.05, b);
      break;
    }
  }
  let upper: number | null = null;
  for (let b = fit.beta * 1.05; b <= BETA_SEARCH_MAX; b *= 1.05) {
    if (g(b) < 0) {
      upper = bisect(g, b / 1.05, b);
      break;
    }
  }

  const wearOutDemonstrated = lower !== null && lower > 1;
  const patternUndecided =
    !wearOutDemonstrated &&
    (lower === null || lower <= 1) &&
    (upper === null || upper >= 1);
  const r = fails.length;
  return {
    confidence,
    method: "profile-likelihood-ratio",
    failures: r,
    censored: cens.length,
    beta: { estimate: fit.beta, lower, upper },
    eta: fit.eta,
    wearOutDemonstrated,
    patternUndecided,
    caution:
      `Likelihood-ratio interval on beta from ${r} failures and ${cens.length} ` +
      `right-censored removals at ${(confidence * 100).toFixed(0)}% two-sided ` +
      `confidence. It is valid only if the censored removals are unrelated to ` +
      `their remaining life (non-informative censoring); test that with the ` +
      `recoding sensitivity.`,
  };
}

export interface RemovalRecord {
  ageHours: number;
  /** true = failure; false = planned removal, retirement or rebuild (censored). */
  failed: boolean;
}

export interface RecodingStep {
  /** Number of earliest censored removals recoded as failures. */
  recoded: number;
  beta: number;
  lower: number | null;
  upper: number | null;
  wearOutDemonstrated: boolean;
}

export interface RecodingSensitivity {
  confidence: number;
  steps: RecodingStep[];
  /**
   * Smallest number of earliest planned removals that, if they had been
   * hidden failures, would make the interval clear 1. 0 means the recorded
   * data already clears it; null means it never does within the data.
   */
  tippingRecoded: number | null;
  /** Total censored removals available to recode. */
  censoredAvailable: number;
  summary: string;
  caution: string;
}

/**
 * Recode the earliest censored removals as failures, one at a time, and report
 * how the shape estimate and its likelihood-ratio interval move. Steps at which
 * the fit is not identifiable are omitted; if the recorded data itself is not
 * identifiable the function throws.
 */
export function plannedRemovalRecodingSensitivity(
  records: RemovalRecord[],
  confidence = 0.9,
): RecodingSensitivity {
  const valid = records.filter((x) => x.ageHours > 0);
  const censoredIdx = valid
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !x.failed)
    .sort((a, b) => a.x.ageHours - b.x.ageHours || a.i - b.i)
    .map(({ i }) => i);

  const steps: RecodingStep[] = [];
  for (let k = 0; k <= censoredIdx.length; k++) {
    const recoded = new Set(censoredIdx.slice(0, k));
    const failures: number[] = [];
    const censored: number[] = [];
    valid.forEach((x, i) => {
      if (x.failed || recoded.has(i)) failures.push(x.ageHours);
      else censored.push(x.ageHours);
    });
    try {
      const b = weibullBetaLikelihoodRatioBounds(
        failures,
        censored,
        confidence,
      );
      steps.push({
        recoded: k,
        beta: b.beta.estimate,
        lower: b.beta.lower,
        upper: b.beta.upper,
        wearOutDemonstrated: b.wearOutDemonstrated,
      });
    } catch (e) {
      if (k === 0) throw e;
    }
  }
  const tipping = steps.find((s) => s.wearOutDemonstrated);
  const tippingRecoded = tipping ? tipping.recoded : null;
  const summary =
    tippingRecoded === null
      ? "The interval on beta does not clear 1 even if every planned removal had been a failure."
      : tippingRecoded === 0
        ? "The recorded data already clears 1; check the censoring assumption before relying on it."
        : `The interval on beta clears 1 only if the ${tippingRecoded} earliest planned removal${tippingRecoded === 1 ? "" : "s"} had been hidden failures.`;
  return {
    confidence,
    steps,
    tippingRecoded,
    censoredAvailable: censoredIdx.length,
    summary,
    caution:
      "This describes how fragile the reading is. It does not claim the recoded removals were failures, and it does not change any recorded event type. Whether a planned removal hid a failure is an engineering judgement from the work-order evidence.",
  };
}
