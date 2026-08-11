/**
 * Deterministic pseudo-random source for the simulation engines.
 *
 * Math.random() is banned here for two reasons that both matter more than
 * convenience: a simulation whose answer changes between two runs cannot be
 * tested, and a number a user cannot reproduce cannot be defended in a review.
 * Every simulation in this module takes a seed and returns the same answer for
 * the same seed, forever.
 *
 * mulberry32: small, fast, and adequate for engineering Monte Carlo. It is not
 * cryptographic and is not used for anything that needs to be.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weibull inverse-CDF sampling: t = eta * (-ln U)^(1/beta). */
export function sampleWeibull(
  rng: () => number,
  beta: number,
  eta: number,
): number {
  // Guard U = 0, which would give Infinity.
  const u = Math.max(rng(), Number.EPSILON);
  return eta * Math.pow(-Math.log(u), 1 / beta);
}

/**
 * Lognormal sampling via Box–Muller. Repair times are lognormal far more often
 * than they are normal — a repair can run long but cannot run negative, and the
 * normal distribution allows negative durations.
 */
export function sampleLognormal(
  rng: () => number,
  medianValue: number,
  sigma: number,
): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return medianValue * Math.exp(sigma * z);
}

/** Triangular sampling — the standard choice for expert-estimated durations. */
export function sampleTriangular(
  rng: () => number,
  min: number,
  mode: number,
  max: number,
): number {
  if (!(max > min)) return min;
  const u = rng();
  const c = (mode - min) / (max - min);
  return u < c
    ? min + Math.sqrt(u * (max - min) * (mode - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/**
 * Percentile by linear interpolation on a sorted sample.
 * P10/P50/P90 are reported rather than mean ± sd because the outputs here are
 * skewed and a symmetric interval on a skewed distribution misleads.
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
