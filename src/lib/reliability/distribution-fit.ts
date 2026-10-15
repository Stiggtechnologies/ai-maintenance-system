/**
 * Life-distribution choice beyond the 2-parameter Weibull (BOK-08).
 *
 * The platform fits a Weibull to everything. Fatigue and some bearing data fit
 * a lognormal better; a constant-hazard population is an exponential and a
 * Weibull will report beta ≈ 1 with a wide interval. Choosing the family is a
 * model decision, so this module fits each candidate by right-censored maximum
 * likelihood and ranks them by AIC (Meeker & Escobar 1998 ch. 8; Burnham &
 * Anderson 2002 for the ΔAIC < 2 "indistinguishable" rule).
 *
 * What it does NOT do (tracked as open in the BoK coverage register):
 * 3-parameter Weibull and mixed/competing-mode Weibull.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { weibullMLE } from "./index";
import { weibullLogLikelihood } from "./life-data-bounds";
import { normalCdf } from "./stats";

export type Family = "exponential" | "weibull" | "lognormal";

export interface FamilyFit {
  family: Family;
  params: Record<string, number>;
  logLikelihood: number;
  k: number;
  aic: number;
  /** AIC minus the best AIC; < 2 means statistically indistinguishable. */
  deltaAic: number;
}

export interface DistributionChoice {
  fits: FamilyFit[];
  best: Family;
  /** Families within ΔAIC < 2 of the best, including the best. */
  indistinguishable: Family[];
  reason: string;
}

const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/** ln(1 − Φ(z)), stable in the far upper tail. */
export function logNormalSurvival(z: number): number {
  if (z < 7) return Math.log(Math.max(1e-300, 1 - normalCdf(z)));
  // Mills-ratio asymptotic expansion: 1 − Φ(z) ≈ φ(z)/z · (1 − 1/z² + 3/z⁴).
  const z2 = z * z;
  return (
    -z2 / 2 - LN_SQRT_2PI - Math.log(z) + Math.log(1 - 1 / z2 + 3 / (z2 * z2))
  );
}

export function lognormalLogLikelihood(
  mu: number,
  sigma: number,
  failureTimes: number[],
  censoredTimes: number[] = [],
): number {
  if (!(sigma > 0)) return -Infinity;
  let ll = 0;
  for (const t of failureTimes) {
    const z = (Math.log(t) - mu) / sigma;
    ll += -LN_SQRT_2PI - 0.5 * z * z - Math.log(sigma * t);
  }
  for (const t of censoredTimes)
    ll += logNormalSurvival((Math.log(t) - mu) / sigma);
  return ll;
}

/** Minimal Nelder–Mead for two parameters (maximises f). */
function nelderMead2(
  f: (x: [number, number]) => number,
  start: [number, number],
  step: [number, number],
) {
  let s: [number, number][] = [
    start,
    [start[0] + step[0], start[1]],
    [start[0], start[1] + step[1]],
  ];
  const val = (x: [number, number]) => -f(x);
  for (let it = 0; it < 2000; it++) {
    s.sort((a, b) => val(a) - val(b));
    const [b, g, w] = s;
    if (Math.abs(val(w) - val(b)) < 1e-12) break;
    const c: [number, number] = [(b[0] + g[0]) / 2, (b[1] + g[1]) / 2];
    const r: [number, number] = [2 * c[0] - w[0], 2 * c[1] - w[1]];
    if (val(r) < val(b)) {
      const e: [number, number] = [3 * c[0] - 2 * w[0], 3 * c[1] - 2 * w[1]];
      s = [b, g, val(e) < val(r) ? e : r];
    } else if (val(r) < val(g)) {
      s = [b, g, r];
    } else {
      const k: [number, number] = [(c[0] + w[0]) / 2, (c[1] + w[1]) / 2];
      if (val(k) < val(w)) s = [b, g, k];
      else
        s = [
          b,
          [(b[0] + g[0]) / 2, (b[1] + g[1]) / 2],
          [(b[0] + w[0]) / 2, (b[1] + w[1]) / 2],
        ];
    }
  }
  s.sort((a, b) => val(a) - val(b));
  return s[0];
}

export function fitExponential(
  failureTimes: number[],
  censoredTimes: number[] = [],
) {
  const r = failureTimes.length;
  if (r < 1) throw new Error("An exponential fit needs at least one failure.");
  const total = [...failureTimes, ...censoredTimes].reduce((s, t) => s + t, 0);
  const lambda = r / total;
  return { lambda, logLikelihood: r * Math.log(lambda) - lambda * total };
}

export function fitLognormal(
  failureTimes: number[],
  censoredTimes: number[] = [],
) {
  if (failureTimes.length < 2)
    throw new Error("A lognormal fit needs at least 2 failures.");
  const logs = failureTimes.map(Math.log);
  const m = logs.reduce((s, x) => s + x, 0) / logs.length;
  const sd =
    Math.sqrt(
      logs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, logs.length - 1),
    ) || 0.5;
  const [mu, lnSigma] = nelderMead2(
    ([a, b]) =>
      lognormalLogLikelihood(a, Math.exp(b), failureTimes, censoredTimes),
    [m, Math.log(sd)],
    [0.5 * sd + 0.1, 0.3],
  );
  const sigma = Math.exp(lnSigma);
  return {
    mu,
    sigma,
    logLikelihood: lognormalLogLikelihood(
      mu,
      sigma,
      failureTimes,
      censoredTimes,
    ),
  };
}

/** Fit every candidate family and rank by AIC. */
export function chooseLifeDistribution(
  failureTimes: number[],
  censoredTimes: number[] = [],
): DistributionChoice {
  const f = failureTimes.filter((t) => t > 0);
  const c = censoredTimes.filter((t) => t > 0);
  if (f.length < 3)
    throw new Error(
      `Comparing distribution families needs at least 3 failures (got ${f.length}).`,
    );
  const exp = fitExponential(f, c);
  const w = weibullMLE(f, c);
  const ln = fitLognormal(f, c);
  const raw: {
    family: Family;
    params: Record<string, number>;
    logLikelihood: number;
    k: number;
  }[] = [
    {
      family: "exponential",
      params: { lambda: exp.lambda },
      logLikelihood: exp.logLikelihood,
      k: 1,
    },
    {
      family: "weibull",
      params: { beta: w.beta, eta: w.eta },
      logLikelihood: weibullLogLikelihood(w, f, c),
      k: 2,
    },
    {
      family: "lognormal",
      params: { mu: ln.mu, sigma: ln.sigma },
      logLikelihood: ln.logLikelihood,
      k: 2,
    },
  ];
  const withAic = raw.map((x) => ({
    ...x,
    aic: 2 * x.k - 2 * x.logLikelihood,
  }));
  const bestAic = Math.min(...withAic.map((x) => x.aic));
  const fits = withAic
    .map((x) => ({ ...x, deltaAic: x.aic - bestAic }))
    .sort((a, b) => a.aic - b.aic);
  const indistinguishable = fits
    .filter((x) => x.deltaAic < 2)
    .map((x) => x.family);
  const best = fits[0].family;
  return {
    fits,
    best,
    indistinguishable,
    reason:
      indistinguishable.length > 1
        ? `${indistinguishable.join(", ")} fit within ΔAIC < 2 of each other; the data cannot choose between them. Decide on engineering grounds (failure mechanism) and check the decision is robust under each.`
        : `${best} is preferred by AIC; the next family is ${fits[1].deltaAic.toFixed(1)} AIC units worse.`,
  };
}
