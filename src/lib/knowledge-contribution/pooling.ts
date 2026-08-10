/**
 * Pooling fitted parameters across tenants, and recomputing after a withdrawal.
 *
 * WHY THIS IS NOT AN AVERAGE.
 *
 * Weibull parameters do not average. Two fleets with beta 1.2 and 3.0 do not
 * describe a fleet with beta 2.1 — one is failing early and one is wearing out,
 * and the mean describes neither. What pools correctly is the ESTIMATE together
 * with its uncertainty: a fit from 200 failures should outweigh one from 12, and
 * an arithmetic mean gives them equal say.
 *
 * So this is inverse-variance meta-analysis on the log scale. Log because beta
 * and eta are strictly positive and their sampling distributions are far closer
 * to log-normal than normal; inverse-variance because that is the weighting that
 * minimises the variance of the pooled estimate.
 *
 * WHY RAW DATA IS NEVER NEEDED.
 *
 * This is the property that makes cross-tenant pooling possible at all. A tenant
 * contributes an estimate and its standard error — never a failure time, never
 * an asset, never a date. Those two numbers are sufficient to pool, and they are
 * sufficient to UNPOOL, which is what makes withdrawal recoverable rather than
 * permanent.
 *
 * HETEROGENEITY IS REPORTED, NOT HIDDEN.
 *
 * Fleets genuinely differ — different ground, different operators, different
 * duty. When they differ more than sampling error explains, a single pooled
 * number is a fiction however carefully it was computed. Cochran's Q and I² are
 * computed, and where heterogeneity is substantial the random-effects estimate
 * is the one recommended, because it widens the interval to admit that the
 * fleets are not interchangeable.
 *
 * Pure functions. No database, no network.
 */

export interface ParameterEstimate {
  /** Which contribution this came from, so a withdrawal can be unpicked. */
  contributionId: number;
  organizationId: string;
  /** The fitted value. Must be positive — these are Weibull-family parameters. */
  value: number;
  /** Standard error of the fit. The whole reason pooling is possible. */
  standardError: number;
  failureEvents: number;
}

export interface PooledEstimate {
  poolable: boolean;
  /** Inverse-variance weighted estimate, fixed effect. */
  fixedEffect: number | null;
  /** DerSimonian–Laird random effects — wider, and usually the honest one. */
  randomEffects: number | null;
  /** Standard error of whichever estimate is recommended. */
  standardError: number | null;
  /** 95% interval on the recommended estimate. */
  ci95: [number, number] | null;
  /** Cochran's Q. */
  q: number | null;
  /** I²: share of variation that is real difference rather than sampling error. */
  iSquared: number | null;
  recommended: "fixed" | "random" | null;
  contributingIds: number[];
  contributingTenants: number;
  totalFailureEvents: number;
  excluded: Array<{ contributionId: number; why: string }>;
  reason: string;
}

/** Above this, fleets differ by more than chance and a single number misleads. */
const HIGH_HETEROGENEITY = 0.5;

export function poolEstimates(
  estimates: ParameterEstimate[],
  parameterLabel = "parameter",
): PooledEstimate {
  const excluded: Array<{ contributionId: number; why: string }> = [];
  const usable: ParameterEstimate[] = [];

  for (const e of estimates) {
    if (!(e.value > 0)) {
      excluded.push({
        contributionId: e.contributionId,
        why: `Value ${e.value} is not positive. A Weibull-family parameter cannot be, so this is a bad fit rather than an unusual fleet.`,
      });
      continue;
    }
    if (!(e.standardError > 0) || !Number.isFinite(e.standardError)) {
      excluded.push({
        contributionId: e.contributionId,
        why: `No usable standard error. Without it the estimate cannot be weighted, and giving it an assumed weight would let an unknown-precision fit carry the same authority as a measured one.`,
      });
      continue;
    }
    usable.push(e);
  }

  const empty = {
    poolable: false as boolean,
    fixedEffect: null,
    randomEffects: null,
    standardError: null,
    ci95: null,
    q: null,
    iSquared: null,
    recommended: null,
    contributingIds: [] as number[],
    contributingTenants: 0,
    totalFailureEvents: 0,
    excluded,
  };

  if (usable.length < 2) {
    return {
      ...empty,
      reason:
        usable.length === 0
          ? `Nothing poolable for ${parameterLabel}. ${excluded.length} contribution(s) were excluded, so this is not an empty pool — it is a pool whose members were all unusable.`
          : `One usable contribution for ${parameterLabel}. Pooling one estimate returns that estimate, which is a single tenant's fit wearing the word "benchmark". Not published.`,
    };
  }

  // Log scale, with the delta-method standard error: SE(ln x) ≈ SE(x)/x.
  const y = usable.map((e) => Math.log(e.value));
  const se = usable.map((e) => e.standardError / e.value);
  const w = se.map((s) => 1 / (s * s));

  const sumW = w.reduce((a, b) => a + b, 0);
  const fixedY = y.reduce((acc, yi, i) => acc + w[i] * yi, 0) / sumW;
  const fixedSe = Math.sqrt(1 / sumW);

  // Cochran's Q about the fixed-effect estimate.
  const q = y.reduce((acc, yi, i) => acc + w[i] * (yi - fixedY) ** 2, 0);
  const df = usable.length - 1;
  const iSquared = q > df ? (q - df) / q : 0;

  // DerSimonian–Laird between-study variance.
  const sumW2 = w.reduce((a, b) => a + b * b, 0);
  const tau2 = Math.max(0, (q - df) / (sumW - sumW2 / sumW));

  const wStar = se.map((s) => 1 / (s * s + tau2));
  const sumWStar = wStar.reduce((a, b) => a + b, 0);
  const randomY = y.reduce((acc, yi, i) => acc + wStar[i] * yi, 0) / sumWStar;
  const randomSe = Math.sqrt(1 / sumWStar);

  const useRandom = iSquared > HIGH_HETEROGENEITY;
  const chosenY = useRandom ? randomY : fixedY;
  const chosenSe = useRandom ? randomSe : fixedSe;

  const tenants = new Set(usable.map((e) => e.organizationId)).size;
  const events = usable.reduce((n, e) => n + e.failureEvents, 0);

  return {
    poolable: true,
    fixedEffect: Math.exp(fixedY),
    randomEffects: Math.exp(randomY),
    standardError: chosenSe,
    ci95: [
      Math.exp(chosenY - 1.96 * chosenSe),
      Math.exp(chosenY + 1.96 * chosenSe),
    ],
    q,
    iSquared,
    recommended: useRandom ? "random" : "fixed",
    contributingIds: usable.map((e) => e.contributionId),
    contributingTenants: tenants,
    totalFailureEvents: events,
    excluded,
    reason:
      `Pooled ${parameterLabel} across ${usable.length} fit(s) from ${tenants} tenant(s), ${events} failure event(s), by inverse-variance weighting on the log scale — a fit from more failures carries more weight, which an average would not do. ` +
      (useRandom
        ? `I² is ${(iSquared * 100).toFixed(0)}%, so most of the spread between these fleets is real difference rather than sampling error. The random-effects estimate is reported: ${Math.exp(randomY).toFixed(3)} rather than the fixed-effect ${Math.exp(fixedY).toFixed(3)}, with a wider interval that admits the fleets are not interchangeable. `
        : `I² is ${(iSquared * 100).toFixed(0)}%, so the fleets are consistent enough that the fixed-effect estimate holds: ${Math.exp(fixedY).toFixed(3)}. `) +
      (excluded.length > 0
        ? `${excluded.length} contribution(s) were excluded and are named separately — an excluded contribution is not a missing one.`
        : ``),
  };
}

/**
 * Recompute after a withdrawal.
 *
 * The whole point of storing estimates rather than raw data: removing a
 * contributor is dropping a row and re-weighting, not going back to source data
 * nobody has. A withdrawal that used to withhold a benchmark permanently now
 * costs one re-pool.
 */
export interface RecomputeResult {
  pooled: PooledEstimate;
  removedIds: number[];
  /** True when the pool still satisfies whatever the caller's gate requires. */
  survivesWithdrawal: boolean;
  reason: string;
}

export function recomputeWithout(
  estimates: ParameterEstimate[],
  withdrawnContributionIds: number[],
  minTenants: number,
  minFailureEvents: number,
  parameterLabel = "parameter",
): RecomputeResult {
  const withdrawn = new Set(withdrawnContributionIds);
  const remaining = estimates.filter((e) => !withdrawn.has(e.contributionId));
  const pooled = poolEstimates(remaining, parameterLabel);

  const survives =
    pooled.poolable &&
    pooled.contributingTenants >= minTenants &&
    pooled.totalFailureEvents >= minFailureEvents;

  return {
    pooled,
    removedIds: withdrawnContributionIds,
    survivesWithdrawal: survives,
    reason: survives
      ? `Recomputed without ${withdrawnContributionIds.length} withdrawn contribution(s). ${pooled.contributingTenants} tenant(s) and ${pooled.totalFailureEvents} event(s) remain, still above the ${minTenants}/${minFailureEvents} floor, so the benchmark is republished rather than withheld.`
      : !pooled.poolable
        ? `Cannot recompute: ${pooled.reason}`
        : `Recomputed, but the remaining pool no longer clears the gate — ${pooled.contributingTenants} tenant(s) against ${minTenants} required, ${pooled.totalFailureEvents} event(s) against ${minFailureEvents}. The benchmark stays withheld, which is now a threshold decision rather than a dead end: it republishes on its own once another contributor joins.`,
  };
}
