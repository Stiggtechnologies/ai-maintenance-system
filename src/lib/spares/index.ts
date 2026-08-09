/**
 * Spares optimisation (capability register C7.06).
 *
 * The question a storeroom actually asks is "how many should we hold?", and
 * the honest answer depends on three things it usually does not have to hand:
 * how often the part is consumed, how long a replacement takes to arrive, and
 * what a stockout costs relative to holding.
 *
 * Demand during the lead time is modelled as Poisson. For slow-moving critical
 * spares — the ones this matters for — that is the standard and defensible
 * choice: consumption is a count of rare independent events over a fixed
 * window, which is exactly what Poisson describes. It is stated rather than
 * assumed silently, because for fast movers with lumpy demand it is the wrong
 * model and the answer would be confidently wrong.
 *
 * Two failure modes this module is built to avoid:
 *
 *   1. Recommending a holding level from a demand rate nobody measured. No
 *      rate, no answer.
 *   2. Presenting a service level as a guarantee. A 95% service level means
 *      one stockout in twenty lead-time windows, and saying so is the
 *      difference between a decision and a hope.
 *
 * Pure: no database, no network.
 */

export interface SparesInput {
  /** Expected consumptions per year, from failure history or a BOM plan. */
  annualDemand: number;
  /** Replenishment lead time in days. */
  leadTimeDays: number;
  /** Unit cost, for the holding-cost arm. */
  unitCost?: number;
  /** Annual holding cost as a fraction of unit cost (capital + storage). */
  holdingRate?: number;
  /** Cost of being out of stock for one lead time: downtime, expedite, both. */
  stockoutCost?: number;
}

export interface StockLevel {
  level: number;
  serviceLevel: number;
  expectedStockouts: number;
}

export interface SparesResult {
  /** Expected demand during one lead time — the number everything hangs on. */
  demandDuringLeadTime: number;
  /** Levels and the service each achieves, for a human to choose from. */
  ladder: StockLevel[];
  /** Cost-optimal level, when the costs to decide it are present. */
  optimalLevel: number | null;
  optimalAnnualCost: number | null;
  /** Level meeting a target service, always computable from demand alone. */
  levelForTargetService: number | null;
  targetService: number;
  reason: string;
  missingInputs: string[];
}

/** Poisson PMF, computed in log space so large means do not overflow. */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

/** P(X <= k) for X ~ Poisson(lambda). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let s = 0;
  for (let i = 0; i <= Math.floor(k); i++) s += poissonPmf(i, lambda);
  return Math.min(s, 1);
}

/**
 * Expected units short per lead-time cycle when holding s.
 *   E[max(D - s, 0)] = Σ_{k>s} (k - s)·P(k)
 * Truncated where the tail stops contributing at double precision.
 */
export function expectedShortage(s: number, lambda: number): number {
  let total = 0;
  const upper = Math.max(
    Math.ceil(lambda + 12 * Math.sqrt(lambda + 1)),
    s + 30,
  );
  for (let k = s + 1; k <= upper; k++) total += (k - s) * poissonPmf(k, lambda);
  return total;
}

export function optimiseSpares(
  input: SparesInput,
  targetService = 0.95,
  maxLevel = 20,
): SparesResult {
  const missing: string[] = [];
  if (!(input.annualDemand > 0))
    missing.push("an annual demand or failure rate");
  if (!(input.leadTimeDays > 0)) missing.push("a replenishment lead time");

  if (missing.length > 0) {
    return {
      demandDuringLeadTime: 0,
      ladder: [],
      optimalLevel: null,
      optimalAnnualCost: null,
      levelForTargetService: null,
      targetService,
      missingInputs: missing,
      reason: `Cannot size a holding without ${missing.join(" and ")}. A level recommended from a demand rate nobody measured is a guess wearing a number.`,
    };
  }

  const lambda = (input.annualDemand * input.leadTimeDays) / 365;

  const ladder: StockLevel[] = [];
  for (let s = 0; s <= maxLevel; s++) {
    const service = poissonCdf(s, lambda);
    ladder.push({
      level: s,
      serviceLevel: Number(service.toFixed(4)),
      expectedStockouts: Number(expectedShortage(s, lambda).toFixed(4)),
    });
    if (service > 0.9999) break;
  }

  const target = ladder.find((l) => l.serviceLevel >= targetService);
  const levelForTargetService = target ? target.level : null;

  // The cost arm needs all three cost inputs. Without them the service ladder
  // still stands on its own — it is derived from demand alone.
  const haveCosts =
    (input.unitCost ?? 0) > 0 &&
    (input.holdingRate ?? 0) > 0 &&
    (input.stockoutCost ?? 0) > 0;

  let optimalLevel: number | null = null;
  let optimalAnnualCost: number | null = null;

  if (haveCosts) {
    const cyclesPerYear = 365 / input.leadTimeDays;
    let best = Number.POSITIVE_INFINITY;
    for (const l of ladder) {
      const holding =
        l.level * (input.unitCost as number) * (input.holdingRate as number);
      const shortage =
        expectedShortage(l.level, lambda) *
        (input.stockoutCost as number) *
        cyclesPerYear;
      const total = holding + shortage;
      if (total < best) {
        best = total;
        optimalLevel = l.level;
      }
    }
    optimalAnnualCost = Number(best.toFixed(2));
  } else {
    if ((input.unitCost ?? 0) <= 0) missing.push("unit cost");
    if ((input.holdingRate ?? 0) <= 0) missing.push("annual holding rate");
    if ((input.stockoutCost ?? 0) <= 0) missing.push("cost of a stockout");
  }

  const svc =
    levelForTargetService === null
      ? null
      : ladder[levelForTargetService].serviceLevel;

  return {
    demandDuringLeadTime: Number(lambda.toFixed(3)),
    ladder,
    optimalLevel,
    optimalAnnualCost,
    levelForTargetService,
    targetService,
    missingInputs: haveCosts ? [] : missing.slice(missing.length - 3),
    reason:
      `Expected demand over a ${input.leadTimeDays}-day lead time is ${lambda.toFixed(2)} units. ` +
      (levelForTargetService !== null
        ? `Holding ${levelForTargetService} reaches ${((svc as number) * 100).toFixed(1)}% service — meaning about one stockout every ${(1 / Math.max(1 - (svc as number), 1e-9)).toFixed(0)} lead-time windows, not never. `
        : `No level up to ${maxLevel} reaches ${(targetService * 100).toFixed(0)}% service; demand over the lead time is too high for a spares holding to be the right answer. `) +
      (haveCosts
        ? `On the costs given, ${optimalLevel} is cheapest at $${optimalAnnualCost?.toLocaleString()}/yr.`
        : `The cost-optimal level is not computed: no unit cost, holding rate or stockout cost is recorded. The service ladder above needs none of them.`),
  };
}

const LOG_FACT_CACHE = [0, 0];
function logFactorial(n: number): number {
  if (n < LOG_FACT_CACHE.length) return LOG_FACT_CACHE[n];
  let v = LOG_FACT_CACHE[LOG_FACT_CACHE.length - 1];
  for (let i = LOG_FACT_CACHE.length; i <= n; i++) {
    v += Math.log(i);
    LOG_FACT_CACHE[i] = v;
  }
  return v;
}
