/**
 * Choosing the life-data estimator by rule, not by preference.
 *
 * WHY THIS EXISTS.
 *
 * Given the operator's 38 grader engine change-outs, three defensible-looking
 * answers are available: rank regression on all events (beta 1.09), MLE on all
 * events (beta 2.63), and censored MLE (beta 0.87). Handing a reliability
 * engineer three numbers and asking which they prefer is not analysis — it is
 * the analysis being pushed back onto the person who asked for it.
 *
 * Established practice does have an answer, and most of it is not a matter of
 * taste:
 *
 *   1. SUSPENSIONS ARE NOT FAILURES. A component removed while still working is
 *      right-censored. This is not an estimator preference — counting a
 *      suspension as a failure is simply wrong, and it biases life downward by
 *      however much remaining life was thrown away. Any method that cannot
 *      represent suspensions is disqualified the moment one exists.
 *
 *   2. SMALL SAMPLES FAVOUR RANK REGRESSION. MLE is asymptotically efficient
 *      and biased HIGH on beta for small failure counts. Below roughly 15
 *      failures, rank regression is the better-behaved estimator.
 *
 *   3. HEAVY CENSORING FAVOURS MLE. It handles suspensions natively; rank
 *      regression needs rank adjustment, and the adjustment carries its own
 *      error that grows with the suspended fraction.
 *
 *   4. A POOR FIT OUTRANKS BOTH. If the points do not lie on a line, the sample
 *      is more than one population and no single Weibull describes it. Choosing
 *      an estimator at that point is choosing which wrong answer to publish.
 *
 * So the rule is deterministic and the output says which clause fired. Where
 * the rules genuinely conflict the module says so rather than inventing a
 * tie-break.
 *
 * Pure functions. No database, no network.
 */
import { weibullMLE, weibullMRR, type WeibullFit } from "./index";

export type EstimatorChoice =
  "rank_regression" | "mle_censored" | "mle" | "none";

export interface MethodSelection {
  method: EstimatorChoice;
  beta: number | null;
  eta: number | null;
  failures: number;
  suspensions: number;
  suspendedFraction: number;
  /** Set when the sample should not be fitted as one population at all. */
  modelWarning: string | null;
  /** The clause of the rule that decided it. */
  ruleApplied: string;
  reason: string;
}

/** Below this failure count MLE's beta bias is material. */
const SMALL_SAMPLE_FAILURES = 15;
/** Above this suspended fraction, rank adjustment carries too much error. */
const HEAVY_CENSORING = 0.3;
/** Below this R² the points are not on a line. */
const POOR_FIT_R2 = 0.9;

export function selectWeibullMethod(
  failureTimes: number[],
  suspensionTimes: number[] = [],
): MethodSelection {
  const f = failureTimes.filter((t) => t > 0);
  const s = suspensionTimes.filter((t) => t > 0);
  const total = f.length + s.length;
  const suspendedFraction = total > 0 ? s.length / total : 0;

  const base = {
    failures: f.length,
    suspensions: s.length,
    suspendedFraction,
  };

  if (f.length < 2) {
    return {
      ...base,
      method: "none",
      beta: null,
      eta: null,
      modelWarning: null,
      ruleApplied: "Insufficient failures",
      reason: `${f.length} failure(s). Two distinct failures are the minimum for any Weibull estimator — below that the shape parameter is not identifiable, and a fitted line through one point is a drawing rather than an estimate. ${s.length} suspension(s) are present and bound life from below, but suspensions alone cannot locate a distribution.`,
    };
  }

  // Clause 4 first: if a single Weibull is the wrong model, which estimator is
  // used stops mattering. Checked on failures only, which is what MRR fits.
  let modelWarning: string | null = null;
  try {
    const shape = weibullMRR(f);
    if (shape.rSquared < POOR_FIT_R2) {
      modelWarning =
        `R² is ${shape.rSquared.toFixed(3)} against a ${POOR_FIT_R2} threshold: the failure points do not lie on a line, which usually means two populations — early-life failures and end-of-life wear-out — in one sample. ` +
        `Split the sample before trusting any single beta. Choosing between estimators here is choosing which wrong answer to publish.`;
    }
  } catch {
    // Fewer than 2 failures is already handled; nothing else to do.
  }

  // Clause 1: suspensions exist and must be honoured.
  if (s.length > 0) {
    // Clause 3 vs 2: heavy censoring pushes to MLE even at small n, because
    // rank adjustment error grows faster than MLE's small-sample bias.
    const heavy = suspendedFraction > HEAVY_CENSORING;
    const fit: WeibullFit = weibullMLE(f, s);
    const smallSample = f.length < SMALL_SAMPLE_FAILURES;

    return {
      ...base,
      method: "mle_censored",
      beta: fit.beta,
      eta: fit.eta,
      modelWarning,
      ruleApplied: heavy
        ? "Suspensions present and heavily censored → censored MLE"
        : "Suspensions present → censored MLE (rank adjustment not implemented)",
      reason:
        `${f.length} failure(s) and ${s.length} suspension(s), ${(suspendedFraction * 100).toFixed(0)}% censored. Fitted by maximum likelihood WITH the suspensions as suspensions: beta ${fit.beta.toFixed(3)}, eta ${fit.eta.toFixed(0)}. ` +
        `Counting those ${s.length} removals as failures would not be a different opinion, it would be wrong — each was a working component, and treating it as failed discards the life it had left. ` +
        (heavy
          ? `At ${(suspendedFraction * 100).toFixed(0)}% censored, MLE is preferred over rank regression regardless of sample size: rank adjustment error grows with the suspended fraction faster than MLE's small-sample bias does. `
          : `Rank regression would need rank adjustment for the suspensions, which is not implemented here, so MLE is used. `) +
        (smallSample
          ? `NOTE: ${f.length} failures is below ${SMALL_SAMPLE_FAILURES}, where MLE is known to bias beta HIGH. Read this beta as an upper estimate of the shape. `
          : ``) +
        (modelWarning ? `MODEL WARNING: ${modelWarning}` : ``),
    };
  }

  // Clause 2: no suspensions, small sample → rank regression.
  if (f.length < SMALL_SAMPLE_FAILURES) {
    const fit = weibullMRR(f);
    return {
      ...base,
      method: "rank_regression",
      beta: fit.beta,
      eta: fit.eta,
      modelWarning,
      ruleApplied: `No suspensions and fewer than ${SMALL_SAMPLE_FAILURES} failures → rank regression`,
      reason:
        `${f.length} failure(s), none suspended. Fitted by median-rank regression: beta ${fit.beta.toFixed(3)}, eta ${fit.eta.toFixed(0)}. ` +
        `Rank regression rather than MLE because MLE biases beta high on small samples, and at ${f.length} failures that bias is larger than the efficiency it buys. ` +
        (modelWarning ? `MODEL WARNING: ${modelWarning}` : ``),
    };
  }

  const fit = weibullMLE(f);
  return {
    ...base,
    method: "mle",
    beta: fit.beta,
    eta: fit.eta,
    modelWarning,
    ruleApplied: `No suspensions and at least ${SMALL_SAMPLE_FAILURES} failures → MLE`,
    reason:
      `${f.length} failure(s), none suspended. Fitted by maximum likelihood: beta ${fit.beta.toFixed(3)}, eta ${fit.eta.toFixed(0)}. ` +
      `At this sample size MLE's efficiency outweighs its small-sample bias. ` +
      (modelWarning ? `MODEL WARNING: ${modelWarning}` : ``),
  };
}
