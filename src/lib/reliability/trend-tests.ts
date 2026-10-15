/**
 * Repairable-system trend tests and the mean cumulative function (BOK-02).
 *
 * Fitting a Weibull to the times BETWEEN failures of one repairable unit
 * assumes renewal: every repair returns the unit to as-new, and successive
 * gaps are independent and identically distributed. A deteriorating pump
 * (gaps shrinking) or an improving one (gaps lengthening after a redesign)
 * violates that, and the fitted interval is wrong in a direction nobody can
 * see from the fit itself (Ascher & Feingold 1984, "Repairable Systems
 * Reliability"; MIL-HDBK-189C §5; Nelson 2003).
 *
 * The renewal gate below must pass before inter-arrival times are handed to a
 * Weibull fit. It uses three tests, all stated:
 *   - Laplace: optimal against a monotone NHPP; null is an HPP.
 *   - MIL-HDBK-189 (Crow) chi-square: optimal against the power-law NHPP.
 *   - Lewis–Robinson: Laplace divided by the coefficient of variation of the
 *     gaps, which keeps the right size when the null is a general renewal
 *     process rather than an HPP. The gate decides on Lewis–Robinson and
 *     MIL-HDBK-189; Laplace is reported for comparison.
 * "No trend detected" is absence of evidence, never proof of renewal, and the
 * result says so.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { normalCdf, normalQuantile, chiSquareCdf } from "./stats";

export type Truncation = "time" | "failure";
export type TrendDirection = "deteriorating" | "improving" | "none";

export interface TrendTestResult {
  test: "laplace" | "lewis-robinson" | "mil-hdbk-189";
  statistic: number;
  /** Two-sided p-value against "no trend". */
  pValue: number;
  direction: TrendDirection;
  events: number;
}

function prepare(
  eventTimes: number[],
  endTime: number,
  truncation: Truncation,
) {
  const t = [...eventTimes].filter((x) => x > 0).sort((a, b) => a - b);
  if (truncation === "time") {
    if (!(endTime > 0))
      throw new Error(
        "Time-truncated data needs a positive observation end time.",
      );
    if (t.length && t[t.length - 1] > endTime)
      throw new Error("An event occurs after the stated observation end time.");
    return { times: t, T: endTime, n: t.length };
  }
  // Failure-truncated: observation ends at the last failure, which is excluded.
  if (t.length < 2)
    throw new Error("Failure-truncated data needs at least 2 events.");
  return { times: t.slice(0, -1), T: t[t.length - 1], n: t.length - 1 };
}

function directionFrom(
  p: number,
  positiveMeansWorse: boolean,
  alpha = 0.05,
): TrendDirection {
  if (p >= alpha) return "none";
  return positiveMeansWorse ? "deteriorating" : "improving";
}

/** Laplace trend test. U > 0 means the event rate is increasing. */
export function laplaceTest(
  eventTimes: number[],
  endTime: number,
  truncation: Truncation = "time",
  alpha = 0.05,
): TrendTestResult {
  const { times, T, n } = prepare(eventTimes, endTime, truncation);
  if (n < 3)
    throw new Error(
      `The Laplace test needs at least 3 usable events (got ${n}).`,
    );
  const mean = times.reduce((s, x) => s + x, 0) / n;
  const U = (mean - T / 2) / (T * Math.sqrt(1 / (12 * n)));
  const p = 2 * (1 - normalCdf(Math.abs(U)));
  return {
    test: "laplace",
    statistic: U,
    pValue: p,
    direction: directionFrom(p, U > 0, alpha),
    events: n,
  };
}

/** Lewis–Robinson test: Laplace scaled by the gap coefficient of variation. */
export function lewisRobinsonTest(
  eventTimes: number[],
  endTime: number,
  truncation: Truncation = "time",
  alpha = 0.05,
): TrendTestResult {
  const lap = laplaceTest(eventTimes, endTime, truncation, alpha);
  const t = [...eventTimes].filter((x) => x > 0).sort((a, b) => a - b);
  const gaps = t.map((x, i) => (i === 0 ? x : x - t[i - 1]));
  if (gaps.length < 3) throw new Error("Lewis–Robinson needs at least 3 gaps.");
  const m = gaps.reduce((s, x) => s + x, 0) / gaps.length;
  const v = gaps.reduce((s, x) => s + (x - m) ** 2, 0) / (gaps.length - 1);
  const cv = Math.sqrt(v) / m;
  if (!(cv > 0))
    throw new Error(
      "All gaps are identical; the coefficient of variation is zero.",
    );
  const U = lap.statistic / cv;
  const p = 2 * (1 - normalCdf(Math.abs(U)));
  return {
    test: "lewis-robinson",
    statistic: U,
    pValue: p,
    direction: directionFrom(p, U > 0, alpha),
    events: lap.events,
  };
}

/**
 * MIL-HDBK-189 (Crow) test. Statistic 2 Σ ln(T / t_i) ~ χ²(2n) under an HPP.
 * Small values mean the events bunch late (deteriorating).
 */
export function milHdbk189Test(
  eventTimes: number[],
  endTime: number,
  truncation: Truncation = "time",
  alpha = 0.05,
): TrendTestResult {
  const { times, T, n } = prepare(eventTimes, endTime, truncation);
  if (n < 3)
    throw new Error(
      `The MIL-HDBK-189 test needs at least 3 usable events (got ${n}).`,
    );
  const chi = 2 * times.reduce((s, x) => s + Math.log(T / x), 0);
  const df = 2 * n;
  const lower = chiSquareCdf(chi, df);
  const p = Math.min(1, 2 * Math.min(lower, 1 - lower));
  // Deteriorating when chi is small (lower tail).
  return {
    test: "mil-hdbk-189",
    statistic: chi,
    pValue: p,
    direction: directionFrom(p, lower < 0.5, alpha),
    events: n,
  };
}

export interface RenewalGateResult {
  /** True only when no test detects a trend. */
  weibullOnGapsPermitted: boolean;
  verdict: "trend_detected" | "no_trend_detected" | "insufficient_data";
  direction: TrendDirection;
  tests: TrendTestResult[];
  reason: string;
}

/**
 * Gate: may the gaps between this unit's failures be treated as renewal data?
 * Needs at least 4 events; with fewer, the honest answer is "unknown".
 */
export function renewalGate(
  eventTimes: number[],
  endTime: number,
  truncation: Truncation = "time",
  alpha = 0.05,
): RenewalGateResult {
  const n = eventTimes.filter((x) => x > 0).length;
  if (n < 4)
    return {
      weibullOnGapsPermitted: false,
      verdict: "insufficient_data",
      direction: "none",
      tests: [],
      reason: `${n} events cannot distinguish a trend from noise; a renewal Weibull on the gaps is not supported yet.`,
    };
  const tests = [
    laplaceTest(eventTimes, endTime, truncation, alpha),
    lewisRobinsonTest(eventTimes, endTime, truncation, alpha),
    milHdbk189Test(eventTimes, endTime, truncation, alpha),
  ];
  const deciding = tests.filter((x) => x.test !== "laplace");
  const hit = deciding.find((x) => x.direction !== "none");
  if (hit)
    return {
      weibullOnGapsPermitted: false,
      verdict: "trend_detected",
      direction: hit.direction,
      tests,
      reason: `The ${hit.test} test detects a ${hit.direction} trend (p = ${hit.pValue.toFixed(3)}). The gaps are not identically distributed, so a renewal Weibull would be wrong; model the unit as an NHPP (Crow-AMSAA) instead.`,
    };
  return {
    weibullOnGapsPermitted: true,
    verdict: "no_trend_detected",
    direction: "none",
    tests,
    reason: `No trend detected at alpha = ${alpha}. This is absence of evidence, not proof of renewal; independence of successive gaps is still an engineering judgement.`,
  };
}

export interface McfSystem {
  id: string;
  /** Ages at which this system had a recurrence. */
  eventAges: number[];
  /** Age at which observation of this system ended. */
  endAge: number;
}

export interface McfPoint {
  age: number;
  atRisk: number;
  events: number;
  mcf: number;
  lower: number;
  upper: number;
}

/**
 * Nelson's nonparametric mean cumulative function across a population of
 * repairable systems with staggered observation ends. Bounds use the Poisson
 * variance approximation Σ d/r² on the log scale; they are labelled
 * approximate because Nelson's robust variance needs per-system increments.
 */
export function meanCumulativeFunction(
  systems: McfSystem[],
  confidence = 0.9,
): McfPoint[] {
  if (systems.length === 0)
    throw new Error("The MCF needs at least one system.");
  for (const s of systems) {
    if (!(s.endAge > 0))
      throw new Error(`System ${s.id} needs a positive end age.`);
    if (s.eventAges.some((a) => a > s.endAge))
      throw new Error(
        `System ${s.id} has an event after its end of observation.`,
      );
  }
  const z = normalQuantile((1 + confidence) / 2);
  const ages = [
    ...new Set(systems.flatMap((s) => s.eventAges.filter((a) => a > 0))),
  ].sort((a, b) => a - b);
  let mcf = 0;
  let varSum = 0;
  return ages.map((age) => {
    const atRisk = systems.filter((s) => s.endAge >= age).length;
    const events = systems.reduce(
      (n, s) => n + s.eventAges.filter((a) => a === age).length,
      0,
    );
    mcf += events / atRisk;
    varSum += events / (atRisk * atRisk);
    const sd = Math.sqrt(varSum);
    return {
      age,
      atRisk,
      events,
      mcf,
      lower: mcf * Math.exp((-z * sd) / mcf),
      upper: mcf * Math.exp((z * sd) / mcf),
    };
  });
}
