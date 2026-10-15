/**
 * Shared statistical special functions for the reliability kernels.
 *
 * Every confidence bound, trend test and Bayesian update in the body-of-
 * knowledge kernels (BOK register, docs/enterprise-readiness/
 * bok-coverage-register.json) reduces to one of four distributions: normal,
 * chi-square, gamma or log-gamma. They live here once so that no kernel
 * carries its own approximation of them.
 *
 * Accuracy: lnGamma uses the Lanczos (g = 7, n = 9) approximation, accurate to
 * ~1e-15 relative for positive arguments. The regularized incomplete gamma
 * uses the series for x < a + 1 and the Lentz continued fraction otherwise
 * (Numerical Recipes §6.2), converging to 1e-14. Quantiles are found by
 * bracketed bisection on the CDF, so they are as accurate as the CDF and never
 * diverge. Tests pin each against published table values.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function for x > 0. */
export function lnGamma(x: number): number {
  if (!(x > 0)) throw new Error(`lnGamma requires x > 0 (got ${x}).`);
  if (x < 0.5) {
    // Reflection keeps precision for small arguments.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x) / Γ(a). */
export function regularizedGammaP(a: number, x: number): number {
  if (!(a > 0)) throw new Error(`regularizedGammaP requires a > 0 (got ${a}).`);
  if (x <= 0) return 0;
  const gln = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  // Continued fraction for Q(a, x); P = 1 - Q.
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gln) * h;
  return Math.max(0, 1 - q);
}

/** Gamma(shape, rate) CDF. */
export function gammaCdf(x: number, shape: number, rate = 1): number {
  if (!(rate > 0)) throw new Error("gammaCdf requires rate > 0.");
  return regularizedGammaP(shape, x * rate);
}

/** Bracketed bisection for a monotone increasing CDF. */
function invertCdf(
  cdf: (x: number) => number,
  p: number,
  hiStart: number,
): number {
  if (!(p > 0 && p < 1))
    throw new Error(`Quantile requires 0 < p < 1 (got ${p}).`);
  let lo = 0;
  let hi = Math.max(hiStart, 1e-12);
  let guard = 0;
  while (cdf(hi) < p) {
    hi *= 2;
    if (++guard > 2000) throw new Error("Quantile bracket did not close.");
  }
  for (let i = 0; i < 300; i++) {
    const mid = 0.5 * (lo + hi);
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-14 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}

/** Quantile of Gamma(shape, rate). */
export function gammaQuantile(p: number, shape: number, rate = 1): number {
  if (!(shape > 0) || !(rate > 0))
    throw new Error("gammaQuantile requires shape > 0 and rate > 0.");
  return invertCdf((x) => regularizedGammaP(shape, x), p, shape + 1) / rate;
}

/** Chi-square CDF with `df` degrees of freedom. */
export function chiSquareCdf(x: number, df: number): number {
  return regularizedGammaP(df / 2, x / 2);
}

/** Chi-square quantile: the x with P(X ≤ x) = p. */
export function chiSquareQuantile(p: number, df: number): number {
  if (!(df > 0))
    throw new Error(`chiSquareQuantile requires df > 0 (got ${df}).`);
  return 2 * gammaQuantile(p, df / 2);
}

/** Standard normal CDF Φ(z), via the incomplete gamma identity. */
export function normalCdf(z: number): number {
  if (z === 0) return 0.5;
  const p = regularizedGammaP(0.5, (z * z) / 2);
  return z > 0 ? 0.5 * (1 + p) : 0.5 * (1 - p);
}

/** Standard normal quantile z with Φ(z) = p (bisection on Φ). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1))
    throw new Error(`normalQuantile requires 0 < p < 1 (got ${p}).`);
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
