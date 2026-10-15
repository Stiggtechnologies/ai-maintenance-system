/**
 * Repairable (rotable) spares and system-level stock optimisation (BOK-12).
 *
 * The existing spares kernel sizes ONE consumable part from lead-time demand.
 * Mining fleets run on rotables — engines, final drives, wheel motors — that
 * go to a repair shop and come back. For those, what matters is the repair
 * PIPELINE and the trade-off across many parts toward one fleet-availability
 * target (Sherbrooke, "Optimal Inventory Modeling of Systems", 2nd ed. 2004,
 * ch. 2–3):
 *
 *   - Palm's theorem: with Poisson removals at rate d and any repair-time
 *     distribution with mean RTAT, the number in repair is Poisson with mean
 *     d · RTAT. Condemned units are replaced through procurement instead, so
 *     pipeline mean μ = d · [(1 − c) · RTAT + c · PLT].
 *   - Expected backorders EBO(s) for stock s; fleet availability
 *     A ≈ Π_i (1 − EBO_i(s_i) / (N · Q_i))^{Q_i} (single-site, single-indenture).
 *   - Marginal analysis: add the next unit to whichever part buys the most
 *     EBO reduction per dollar until the availability target or budget is met.
 *     This yields points on the cost–availability efficient curve.
 *
 * Multi-echelon (depot + site) METRIC is NOT covered here and is tracked as
 * open in the BoK coverage register.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { expectedShortage, poissonCdf } from "./index";

export interface RotableItem {
  id: string;
  /** Removals per year across the fleet (measured, not assumed). */
  removalsPerYear: number;
  repairTurnaroundDays: number;
  /** Fraction of removals condemned (not repairable), 0–1. */
  condemnationFraction: number;
  procurementLeadDays: number;
  unitCost: number;
  /** Installed quantity per end item (e.g. 2 final drives per truck). */
  quantityPerSystem: number;
}

export function pipelineMean(item: RotableItem): number {
  if (!(item.removalsPerYear >= 0))
    throw new Error(
      `${item.id}: removals per year must be measured and non-negative.`,
    );
  if (!(item.repairTurnaroundDays > 0))
    throw new Error(`${item.id}: repair turnaround time is required.`);
  if (!(item.condemnationFraction >= 0 && item.condemnationFraction <= 1))
    throw new Error(`${item.id}: condemnation fraction must be in [0, 1].`);
  if (item.condemnationFraction > 0 && !(item.procurementLeadDays > 0))
    throw new Error(
      `${item.id}: a procurement lead time is required when any units are condemned.`,
    );
  const days =
    (1 - item.condemnationFraction) * item.repairTurnaroundDays +
    item.condemnationFraction * (item.procurementLeadDays || 0);
  return (item.removalsPerYear * days) / 365;
}

/** Expected backorders for stock level s with pipeline mean μ. */
export function expectedBackorders(s: number, mu: number): number {
  return expectedShortage(s, mu);
}

/** Fill rate: probability a demand is met from stock immediately. */
export function fillRate(s: number, mu: number): number {
  return s <= 0 ? 0 : poissonCdf(s - 1, mu);
}

export function fleetAvailability(
  items: RotableItem[],
  stock: Record<string, number>,
  fleetSize: number,
): number {
  if (!(fleetSize > 0)) throw new Error("Fleet size must be positive.");
  let a = 1;
  for (const it of items) {
    const mu = pipelineMean(it);
    const ebo = expectedBackorders(stock[it.id] ?? 0, mu);
    const installed = fleetSize * it.quantityPerSystem;
    a *= Math.pow(Math.max(0, 1 - ebo / installed), it.quantityPerSystem);
  }
  return a;
}

export interface CurvePoint {
  cost: number;
  availability: number;
  stock: Record<string, number>;
}

export interface RotableOptimisation {
  target: number | null;
  budget: number | null;
  met: boolean;
  stock: Record<string, number>;
  cost: number;
  availability: number;
  curve: CurvePoint[];
  reason: string;
}

/**
 * Marginal-analysis allocation toward an availability target and/or budget.
 * At least one stopping rule is required.
 */
export function optimiseRotableStock(
  items: RotableItem[],
  fleetSize: number,
  stop: { targetAvailability?: number; budget?: number },
): RotableOptimisation {
  if (items.length === 0)
    throw new Error("At least one rotable item is required.");
  const target = stop.targetAvailability ?? null;
  const budget = stop.budget ?? null;
  if (target === null && budget === null)
    throw new Error(
      "State an availability target or a budget; the kernel does not choose one.",
    );
  if (target !== null && !(target > 0 && target < 1))
    throw new Error("Target availability must be in (0, 1).");
  for (const it of items) {
    if (!(it.unitCost > 0))
      throw new Error(`${it.id}: unit cost must be positive.`);
    if (!(it.quantityPerSystem > 0))
      throw new Error(`${it.id}: quantity per system must be positive.`);
    pipelineMean(it);
  }
  const stock: Record<string, number> = Object.fromEntries(
    items.map((i) => [i.id, 0]),
  );
  let cost = 0;
  let avail = fleetAvailability(items, stock, fleetSize);
  const curve: CurvePoint[] = [
    { cost, availability: avail, stock: { ...stock } },
  ];
  const logA = (st: Record<string, number>) =>
    Math.log(Math.max(1e-300, fleetAvailability(items, st, fleetSize)));
  for (let iter = 0; iter < 10000; iter++) {
    if (target !== null && avail >= target) break;
    let bestId: string | null = null;
    let bestRatio = 0;
    const base = logA(stock);
    for (const it of items) {
      if (budget !== null && cost + it.unitCost > budget) continue;
      const trial = { ...stock, [it.id]: stock[it.id] + 1 };
      const ratio = (logA(trial) - base) / it.unitCost;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = it.id;
      }
    }
    if (!bestId) break;
    const it = items.find((x) => x.id === bestId)!;
    stock[bestId] += 1;
    cost += it.unitCost;
    avail = fleetAvailability(items, stock, fleetSize);
    curve.push({ cost, availability: avail, stock: { ...stock } });
  }
  const met = target === null ? true : avail >= target;
  return {
    target,
    budget,
    met,
    stock,
    cost,
    availability: avail,
    curve,
    reason: met
      ? `Stock of total cost ${cost.toFixed(0)} gives an estimated fleet availability of ${(avail * 100).toFixed(2)}% (supply-limited only; maintenance downtime is separate).`
      : `The ${budget !== null ? "budget" : "search"} is exhausted at ${(avail * 100).toFixed(2)}% availability; the target of ${((target ?? 0) * 100).toFixed(2)}% is not reachable this way.`,
  };
}
