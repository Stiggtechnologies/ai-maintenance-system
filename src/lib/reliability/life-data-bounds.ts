/**
 * Uncertainty on Weibull life-data results (BOK-01).
 *
 * A Weibull fit from 5–20 field failures is a point estimate with a wide
 * interval around it. The age-replacement kernel refuses when beta ≤ 1; if
 * the 90% interval on beta runs from 0.7 to 2.4, that refusal (or its absence)
 * is decided by sampling noise. This module returns the interval so the
 * decision can be made against it.
 *
 * Methods (stated, not assumed):
 *   - Fisher-matrix bounds: covariance of (beta, eta) from the inverse of the
 *     OBSERVED information at the right-censored MLE, with analytic second
 *     derivatives. Bounds on beta, eta and B-lives use the log transform so
 *     they stay positive (Meeker & Escobar 1998 §8.4; Abernethy, New Weibull
 *     Handbook §5). Fisher bounds are approximate and become optimistic below
 *     ~10 failures; the result says so rather than hiding it.
 *   - Weibayes: when failures are 0–2 and beta is known from documented prior
 *     evidence, the lower bound on eta from the chi-square relation
 *     eta_L = (2 Σ t^beta / χ²(C; 2r + 2))^(1/beta) (Abernethy §6; Nelson 1985).
 *     Beta is NEVER defaulted: the caller must name its evidential basis.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { normalQuantile, chiSquareQuantile } from "./stats";

export interface WeibullParams {
  beta: number;
  eta: number;
}

/** Right-censored Weibull log-likelihood. */
export function weibullLogLikelihood(
  p: WeibullParams,
  failureTimes: number[],
  censoredTimes: number[] = [],
): number {
  const { beta, eta } = p;
  if (!(beta > 0) || !(eta > 0)) return -Infinity;
  let ll = 0;
  for (const t of failureTimes) {
    const z = t / eta;
    ll += Math.log(beta / eta) + (beta - 1) * Math.log(z) - Math.pow(z, beta);
  }
  for (const t of censoredTimes) ll -= Math.pow(t / eta, beta);
  return ll;
}

/** Observed information matrix [[Iββ, Iβη], [Iβη, Iηη]] at (beta, eta). */
export function weibullObservedInformation(
  p: WeibullParams,
  failureTimes: number[],
  censoredTimes: number[] = [],
): [[number, number], [number, number]] {
  const { beta, eta } = p;
  const r = failureTimes.length;
  let su = 0;
  let sul = 0;
  let sul2 = 0;
  for (const t of [...failureTimes, ...censoredTimes]) {
    const l = Math.log(t / eta);
    const u = Math.pow(t / eta, beta);
    su += u;
    sul += u * l;
    sul2 += u * l * l;
  }
  const hbb = -r / (beta * beta) - sul2;
  const hee =
    (r * beta) / (eta * eta) - ((beta * (beta + 1)) / (eta * eta)) * su;
  const hbe = -r / eta + su / eta + (beta / eta) * sul;
  return [
    [-hbb, -hbe],
    [-hbe, -hee],
  ];
}

export interface WeibullBounds {
  confidence: number;
  sides: 1 | 2;
  beta: { estimate: number; lower: number; upper: number };
  eta: { estimate: number; lower: number; upper: number };
  covariance: [[number, number], [number, number]];
  /** True when beta's whole interval lies above 1 (wear-out demonstrated). */
  wearOutDemonstrated: boolean;
  /** True when beta's interval straddles 1: the failure pattern is undecided. */
  patternUndecided: boolean;
  /** Plain-language caution about the method, always present. */
  caution: string;
}

function zFor(confidence: number, sides: 1 | 2): number {
  if (!(confidence > 0 && confidence < 1))
    throw new Error(
      `Confidence must be strictly between 0 and 1 (got ${confidence}).`,
    );
  return normalQuantile(sides === 2 ? (1 + confidence) / 2 : confidence);
}

/**
 * Fisher-matrix confidence bounds on beta and eta at the supplied MLE.
 * `fit` must be the MLE of the same data (e.g. weibullMLE(failures, censored)).
 */
export function weibullFisherBounds(
  fit: WeibullParams,
  failureTimes: number[],
  censoredTimes: number[] = [],
  confidence = 0.9,
  sides: 1 | 2 = 2,
): WeibullBounds {
  const fails = failureTimes.filter((t) => t > 0);
  const cens = censoredTimes.filter((t) => t > 0);
  if (fails.length < 2)
    throw new Error(
      "Fisher bounds need at least 2 failures; use weibayes() with a documented beta for 0–1 failures.",
    );
  // Bounds are only meaningful at the MLE: check the score is zero.
  const r0 = fails.length;
  let su = 0;
  let sul = 0;
  let slf = 0;
  for (const t of fails) slf += Math.log(t / fit.eta);
  for (const t of [...fails, ...cens]) {
    const u = Math.pow(t / fit.eta, fit.beta);
    su += u;
    sul += u * Math.log(t / fit.eta);
  }
  const scoreBeta = (r0 / fit.beta + slf - sul) * fit.beta;
  const scoreEta = -r0 * fit.beta + fit.beta * su;
  if (
    !Number.isFinite(scoreBeta) ||
    !Number.isFinite(scoreEta) ||
    Math.abs(scoreBeta) > 1e-4 * r0 ||
    Math.abs(scoreEta) > 1e-4 * r0
  )
    throw new Error(
      "The supplied beta and eta are not the maximum-likelihood estimate of this data; fit with weibullMLE first.",
    );
  const I = weibullObservedInformation(fit, fails, cens);
  const det = I[0][0] * I[1][1] - I[0][1] * I[1][0];
  if (!(det > 0) || !(I[0][0] > 0))
    throw new Error(
      "The information matrix is not positive definite at these parameters; they are not the MLE of this data.",
    );
  const cov: [[number, number], [number, number]] = [
    [I[1][1] / det, -I[0][1] / det],
    [-I[1][0] / det, I[0][0] / det],
  ];
  const z = zFor(confidence, sides);
  const sb = Math.sqrt(cov[0][0]) / fit.beta;
  const se = Math.sqrt(cov[1][1]) / fit.eta;
  const beta = {
    estimate: fit.beta,
    lower: fit.beta * Math.exp(-z * sb),
    upper: sides === 2 ? fit.beta * Math.exp(z * sb) : Infinity,
  };
  const eta = {
    estimate: fit.eta,
    lower: fit.eta * Math.exp(-z * se),
    upper: sides === 2 ? fit.eta * Math.exp(z * se) : Infinity,
  };
  const r = fails.length;
  return {
    confidence,
    sides,
    beta,
    eta,
    covariance: cov,
    wearOutDemonstrated: beta.lower > 1,
    patternUndecided: beta.lower <= 1 && beta.upper >= 1,
    caution:
      r < 10
        ? `Fisher-matrix bounds from ${r} failures are approximate and tend to be too narrow below about 10 failures; treat them as optimistic and prefer more data or likelihood-ratio bounds before committing an interval.`
        : `Fisher-matrix (normal-approximation) bounds from ${r} failures at ${(confidence * 100).toFixed(0)}% ${sides}-sided confidence.`,
  };
}

/** Delta-method variance of a function with gradient g = [d/dbeta, d/deta]. */
function deltaVar(
  g: [number, number],
  cov: [[number, number], [number, number]],
): number {
  return (
    g[0] * g[0] * cov[0][0] +
    2 * g[0] * g[1] * cov[0][1] +
    g[1] * g[1] * cov[1][1]
  );
}

/**
 * B-life: the age by which a fraction p of the population has failed
 * (B10 → p = 0.10), with Fisher bounds on the log scale.
 */
export function weibullBLife(
  fit: WeibullParams,
  bounds: WeibullBounds,
  p: number,
): { p: number; estimate: number; lower: number; upper: number } {
  if (!(p > 0 && p < 1))
    throw new Error(`B-life fraction must be in (0, 1) (got ${p}).`);
  const k = Math.log(-Math.log(1 - p));
  const lnT = Math.log(fit.eta) + k / fit.beta;
  const g: [number, number] = [-k / (fit.beta * fit.beta), 1 / fit.eta];
  const sd = Math.sqrt(deltaVar(g, bounds.covariance));
  const z = zFor(bounds.confidence, bounds.sides);
  return {
    p,
    estimate: Math.exp(lnT),
    lower: Math.exp(lnT - z * sd),
    upper: bounds.sides === 2 ? Math.exp(lnT + z * sd) : Infinity,
  };
}

/** Reliability R(t) with Fisher bounds (on the log-log scale, so 0 < R < 1). */
export function weibullReliabilityBounds(
  fit: WeibullParams,
  bounds: WeibullBounds,
  t: number,
): { t: number; estimate: number; lower: number; upper: number } {
  if (!(t > 0)) throw new Error("Reliability bounds need a positive time.");
  const u = fit.beta * (Math.log(t) - Math.log(fit.eta));
  const g: [number, number] = [
    Math.log(t) - Math.log(fit.eta),
    -fit.beta / fit.eta,
  ];
  const sd = Math.sqrt(deltaVar(g, bounds.covariance));
  const z = zFor(bounds.confidence, bounds.sides);
  const R = (x: number) => Math.exp(-Math.exp(x));
  return {
    t,
    estimate: R(u),
    // Larger u → lower reliability.
    lower: R(u + z * sd),
    upper: bounds.sides === 2 ? R(u - z * sd) : 1,
  };
}

export interface WeibayesInput {
  /** Every unit's accumulated age: failures and survivors alike. */
  failureTimes: number[];
  survivorTimes: number[];
  /** Shape parameter taken from prior evidence, never defaulted. */
  beta: number;
  /** Where beta came from (fleet analysis, OEM data, published study). */
  betaBasis: string;
  confidence: number;
}

export interface WeibayesResult {
  failures: number;
  /** Point estimate of eta; null with zero failures (it is not identifiable). */
  eta: number | null;
  /** One-sided lower confidence bound on eta. */
  etaLower: number;
  confidence: number;
  beta: number;
  betaBasis: string;
}

/** Weibayes / zero-failure analysis with an evidenced shape parameter. */
export function weibayes(input: WeibayesInput): WeibayesResult {
  const { beta, confidence } = input;
  if (!(beta > 0)) throw new Error("Weibayes needs a positive beta.");
  if (!input.betaBasis || input.betaBasis.trim().length < 20)
    throw new Error(
      "Weibayes refuses an undocumented beta: name the evidence it came from (at least 20 characters).",
    );
  if (!(confidence > 0 && confidence < 1))
    throw new Error("Confidence must be strictly between 0 and 1.");
  const all = [...input.failureTimes, ...input.survivorTimes].filter(
    (t) => t > 0,
  );
  if (all.length === 0)
    throw new Error("Weibayes needs at least one unit with positive age.");
  const r = input.failureTimes.filter((t) => t > 0).length;
  const s = all.reduce((acc, t) => acc + Math.pow(t, beta), 0);
  const chi = chiSquareQuantile(confidence, 2 * r + 2);
  return {
    failures: r,
    eta: r > 0 ? Math.pow(s / r, 1 / beta) : null,
    etaLower: Math.pow((2 * s) / chi, 1 / beta),
    confidence,
    beta,
    betaBasis: input.betaBasis.trim(),
  };
}
