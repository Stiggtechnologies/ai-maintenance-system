/**
 * Deterministic reliability-engineering calculations (capability register
 * C7.01 Weibull censored MLE, C7.04 Crow-AMSAA, C7.03 repairable-system
 * availability, C7.11 Pareto).
 *
 * Spec §7 requirement: "calculate through validated code, not merely produce
 * plausible-looking equations." Every function here is pure, closed-form or
 * iteratively solved with documented convergence, and covered by unit tests
 * that validate against analytic identities (exponential reduction, exact
 * small-sample MLE formulas) and seeded-sample parameter recovery. No LLM is
 * involved in any numeric path.
 *
 * References for the estimators (methods, not data): MIL-HDBK-338B §5
 * (reliability modeling and prediction) and the RADC reliability notebook
 * (Weibull analysis, censored life data); Crow-AMSAA per the NHPP power-law
 * model in reliability-growth practice.
 */

export interface WeibullFit {
  /** shape parameter (beta < 1 infant, ≈1 random, > 1 wear-out) */
  beta: number;
  /** scale parameter (characteristic life), same unit as input times */
  eta: number;
  /** failures used */
  failures: number;
  /** right-censored observations used */
  censored: number;
  /** iterations to convergence */
  iterations: number;
  converged: boolean;
}

/**
 * Maximum-likelihood Weibull fit with optional right censoring.
 *
 * Solves the standard one-dimensional MLE equation for beta by damped
 * Newton–Raphson on g(beta) = sum(t^b ln t)/sum(t^b) − 1/b − mean(ln t_f),
 * where sums run over ALL observations (failures + censored) and the mean
 * of logs runs over failures only. Then eta = (sum(t^b)/r)^(1/b).
 *
 * Throws on fewer than 2 distinct failure times (the model is not
 * identifiable) — callers must surface "insufficient data", never a guess.
 */
export function weibullMLE(
  failureTimes: number[],
  censoredTimes: number[] = [],
): WeibullFit {
  const fails = failureTimes.filter((t) => t > 0);
  const cens = censoredTimes.filter((t) => t > 0);
  const r = fails.length;
  if (r < 2 || new Set(fails).size < 2) {
    throw new Error(
      `Weibull MLE requires at least 2 distinct failure times (got ${r}).`,
    );
  }
  const all = [...fails, ...cens];
  const meanLnF = fails.reduce((s, t) => s + Math.log(t), 0) / r;

  const g = (b: number) => {
    let swt = 0;
    let sw = 0;
    for (const t of all) {
      const w = Math.pow(t, b);
      sw += w;
      swt += w * Math.log(t);
    }
    return swt / sw - 1 / b - meanLnF;
  };

  // Damped Newton–Raphson with numeric derivative; beta bounded to (0.01, 50).
  let beta = 1.0;
  let converged = false;
  let i = 0;
  for (; i < 200; i++) {
    const gb = g(beta);
    if (Math.abs(gb) < 1e-10) {
      converged = true;
      break;
    }
    const h = Math.max(1e-6, beta * 1e-6);
    const dg = (g(beta + h) - gb) / h;
    let step = gb / dg;
    if (!Number.isFinite(step)) break;
    // damping: cap the relative step to keep the iteration in-domain
    const maxStep = 0.5 * beta;
    if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
    beta = Math.min(50, Math.max(0.01, beta - step));
  }
  const sw = all.reduce((s, t) => s + Math.pow(t, beta), 0);
  const eta = Math.pow(sw / r, 1 / beta);
  return {
    beta,
    eta,
    failures: r,
    censored: cens.length,
    iterations: i,
    converged,
  };
}

export interface CrowAmsaaFit {
  /** growth parameter: beta > 1 deteriorating, < 1 improving, ≈1 constant */
  beta: number;
  /** scale parameter of the NHPP power law N(t) = lambda * t^beta */
  lambda: number;
  /** instantaneous MTBF at the end of the observation window */
  instantaneousMtbf: number;
  /** cumulative MTBF over the window */
  cumulativeMtbf: number;
  failures: number;
  totalTime: number;
}

/**
 * Crow-AMSAA (NHPP power-law) fit for a repairable system, time-terminated.
 *
 * Exact MLE: beta = r / (r·ln T − Σ ln t_i), lambda = r / T^beta, where t_i
 * are cumulative failure times on (0, T]. Instantaneous MTBF at T is
 * 1 / (lambda·beta·T^(beta−1)).
 */
export function crowAMSAA(
  cumulativeFailureTimes: number[],
  totalTime: number,
): CrowAmsaaFit {
  const times = cumulativeFailureTimes.filter((t) => t > 0 && t <= totalTime);
  const r = times.length;
  if (r < 3) {
    throw new Error(
      `Crow-AMSAA requires at least 3 failures in the window (got ${r}).`,
    );
  }
  if (!(totalTime > 0)) throw new Error("totalTime must be positive.");
  const sumLn = times.reduce((s, t) => s + Math.log(t), 0);
  const denom = r * Math.log(totalTime) - sumLn;
  if (denom <= 0) {
    throw new Error("Degenerate failure-time pattern for Crow-AMSAA MLE.");
  }
  const beta = r / denom;
  const lambda = r / Math.pow(totalTime, beta);
  const instRate = lambda * beta * Math.pow(totalTime, beta - 1);
  return {
    beta,
    lambda,
    instantaneousMtbf: 1 / instRate,
    cumulativeMtbf: totalTime / r,
    failures: r,
    totalTime,
  };
}

export interface RepairableSummary {
  mtbfHours: number;
  mttrHours: number;
  /** operational availability from history: uptime / calendar */
  availability: number;
  failures: number;
  downtimeHours: number;
  calendarHours: number;
}

/** Point estimates for a repairable unit from coded work-order history. */
export function repairableSummary(
  downtimeHoursPerFailure: number[],
  calendarHours: number,
): RepairableSummary {
  const failures = downtimeHoursPerFailure.length;
  if (failures === 0 || !(calendarHours > 0)) {
    throw new Error(
      "repairableSummary needs ≥1 failure and positive calendar time.",
    );
  }
  const down = downtimeHoursPerFailure.reduce((s, d) => s + d, 0);
  const up = Math.max(0, calendarHours - down);
  return {
    mtbfHours: up / failures,
    mttrHours: down / failures,
    availability: up / calendarHours,
    failures,
    downtimeHours: down,
    calendarHours,
  };
}

export interface ParetoRow<K> {
  key: K;
  value: number;
  share: number;
  cumulativeShare: number;
}

/** Pareto ranking with cumulative share (defect-elimination analysis). */
export function pareto<K>(
  items: Array<{ key: K; value: number }>,
): ParetoRow<K>[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!(total > 0)) return [];
  const sorted = [...items].sort((a, b) => b.value - a.value);
  let cum = 0;
  return sorted.map((i) => {
    cum += i.value;
    return {
      key: i.key,
      value: i.value,
      share: i.value / total,
      cumulativeShare: cum / total,
    };
  });
}
