/**
 * Environmental and sustainability performance
 * (capability register E10.01–E10.11).
 *
 * The connection this module exists to make is between MAINTENANCE CONDITION
 * and ENVIRONMENTAL OUTCOME. A fouled heat exchanger is not only a reliability
 * problem: it burns more fuel for the same duty, every hour, silently, and
 * nobody raises a work order for a machine that is still running.
 *
 * THE ARITHMETIC: EFFICIENCY DEGRADATION AS A RATE, NOT A SNAPSHOT.
 *
 * Comparing today's specific energy consumption against the design figure says
 * an asset is 8% worse than new. That is almost useless on its own — the
 * question is whether it is getting worse, how fast, and when it crosses the
 * point where cleaning pays for itself. `assessDegradation` fits the trend and
 * reports the crossing date, or refuses when the data cannot support one.
 *
 * TWO REFUSALS THAT MATTER.
 *
 * 1. Efficiency compared against nothing. A specific energy figure with no
 *    design or clean-condition baseline is a number, not a performance. It is
 *    refused rather than charted.
 *
 * 2. An emissions figure with no stated factor and no stated scope. Multiplying
 *    fuel by a factor somebody remembered is how an emissions report becomes
 *    unauditable, so the factor and its source travel with the number.
 *
 * WHAT IS NOT CLAIMED. Nothing here is a carbon accounting system, and it does
 * not produce a reportable inventory. It produces the maintenance-controllable
 * portion, which is a smaller and more defensible claim.
 *
 * Pure: no database, no network.
 */

export interface EfficiencyReading {
  /** Days since the reference condition. */
  daysSinceBaseline: number;
  /** Energy per unit of output. Units are the caller's; ratios are unitless. */
  specificEnergy: number;
}

export interface DegradationResult {
  measurable: boolean;
  baseline: number | null;
  latest: number | null;
  /** Fractional worsening against baseline. 0.08 is 8% worse. */
  degradation: number | null;
  /** Fractional worsening per year, from a least-squares fit. */
  ratePerYear: number | null;
  /** Days until the excess energy cost pays for the intervention. */
  daysToPayback: number | null;
  reason: string;
}

/**
 * Is this asset getting worse, how fast, and when is cleaning worth it?
 *
 * `interventionCost` and `energyCostPerUnitPerDay` are optional; without them
 * the trend is still reported and the payback is not invented.
 */
export function assessDegradation(
  designSpecificEnergy: number | null,
  readings: EfficiencyReading[],
  interventionCost?: number | null,
  energyCostPerUnitPerDay?: number | null,
): DegradationResult {
  const none = (reason: string): DegradationResult => ({
    measurable: false,
    baseline: null,
    latest: null,
    degradation: null,
    ratePerYear: null,
    daysToPayback: null,
    reason,
  });

  if (!(designSpecificEnergy && designSpecificEnergy > 0)) {
    return none(
      "No design or clean-condition specific energy is recorded, so today's figure has nothing to be compared against. A specific energy number on its own is a measurement, not a performance.",
    );
  }
  if (readings.length < 2) {
    return none(
      `${readings.length} reading(s) recorded. A degradation RATE needs at least two points separated in time; a single reading can say how bad it is now and never how fast it is getting there.`,
    );
  }

  const sorted = [...readings].sort(
    (a, b) => a.daysSinceBaseline - b.daysSinceBaseline,
  );
  const latest = sorted[sorted.length - 1].specificEnergy;
  const degradation = latest / designSpecificEnergy - 1;

  // Least-squares slope of specific energy against days.
  const n = sorted.length;
  const meanX = sorted.reduce((s, r) => s + r.daysSinceBaseline, 0) / n;
  const meanY = sorted.reduce((s, r) => s + r.specificEnergy, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const r of sorted) {
    sxy += (r.daysSinceBaseline - meanX) * (r.specificEnergy - meanY);
    sxx += (r.daysSinceBaseline - meanX) ** 2;
  }
  if (sxx === 0) {
    return none(
      "Every reading is at the same point in time, so no rate can be fitted. Readings need to be spread across the period they describe.",
    );
  }
  const slopePerDay = sxy / sxx;
  const ratePerYear = (slopePerDay * 365) / designSpecificEnergy;

  // Excess energy cost today, and how long to recover an intervention.
  let payback: number | null = null;
  if (
    interventionCost &&
    interventionCost > 0 &&
    energyCostPerUnitPerDay &&
    energyCostPerUnitPerDay > 0 &&
    degradation > 0
  ) {
    const excessPerDay = degradation * energyCostPerUnitPerDay;
    payback = excessPerDay > 0 ? interventionCost / excessPerDay : null;
  }

  const dir = ratePerYear > 0 ? "worsening" : "improving";

  return {
    measurable: true,
    baseline: designSpecificEnergy,
    latest,
    degradation,
    ratePerYear,
    daysToPayback: payback,
    reason:
      `Running ${(degradation * 100).toFixed(1)}% ${degradation >= 0 ? "above" : "below"} the design specific energy, and ${dir} at ${(Math.abs(ratePerYear) * 100).toFixed(1)}% a year on ${n} readings. ` +
      (payback !== null
        ? `At the recorded energy cost the intervention pays for itself in ${payback.toFixed(0)} days.`
        : degradation > 0
          ? `No intervention cost or energy price is recorded, so the payback is not computed — the degradation is real either way, and it is being paid for in fuel every day whether or not anyone raises a work order.`
          : `The asset is not currently worse than design.`),
  };
}

export type EmissionScope = "scope_1" | "scope_2" | "scope_3";

export interface EmissionInput {
  activityLabel: string;
  /** Fuel burned, electricity used, gas vented — in the factor's units. */
  activityQuantity: number;
  activityUnit: string;
  /** Emission factor. Required: no factor, no number. */
  factor?: number | null;
  factorUnit?: string | null;
  /** Where the factor came from. Required for the result to be auditable. */
  factorSource?: string | null;
  scope?: EmissionScope | null;
  /** Global warming potential, for methane and other non-CO2 releases. */
  gwp?: number | null;
}

export interface EmissionResult {
  activityLabel: string;
  co2eTonnes: number | null;
  scope: EmissionScope | null;
  auditable: boolean;
  reason: string;
}

/**
 * Convert an activity to CO2e, or refuse.
 *
 * A number produced from a factor nobody can cite is unauditable, and an
 * unauditable emissions figure is worse than no figure because it will be
 * reported anyway. Both the factor and its source are required.
 */
export function computeEmissions(input: EmissionInput): EmissionResult {
  const fail = (reason: string): EmissionResult => ({
    activityLabel: input.activityLabel,
    co2eTonnes: null,
    scope: input.scope ?? null,
    auditable: false,
    reason,
  });

  if (!(input.factor && input.factor > 0)) {
    return fail(
      `No emission factor is recorded for ${input.activityLabel}. Activity data without a factor is fuel burned, not emissions reported.`,
    );
  }
  if (!input.factorSource?.trim()) {
    return fail(
      `A factor of ${input.factor} is recorded for ${input.activityLabel} with no source. A number produced from a factor nobody can cite is unauditable, and it will be reported anyway — which is why the source is required rather than encouraged.`,
    );
  }
  if (!input.scope) {
    return fail(
      `No scope is recorded for ${input.activityLabel}. Scope 1, 2 and 3 are not interchangeable and summing across them without saying so produces a total that means nothing.`,
    );
  }

  const gwp = input.gwp && input.gwp > 0 ? input.gwp : 1;
  const co2e = (input.activityQuantity * input.factor * gwp) / 1000;

  return {
    activityLabel: input.activityLabel,
    co2eTonnes: co2e,
    scope: input.scope,
    auditable: true,
    reason:
      `${input.activityQuantity} ${input.activityUnit} × ${input.factor} ${input.factorUnit ?? "kg/unit"}` +
      (gwp !== 1 ? ` × GWP ${gwp}` : "") +
      ` = ${co2e.toFixed(2)} tCO2e (${input.scope.replace("_", " ")}), factor from ${input.factorSource}.`,
  };
}

export interface LossRecord {
  substance: string;
  quantity: number;
  unit: string;
  /** Whether the loss was found by a person or by a system. */
  detectedBy?: string | null;
  attributedToMaintenance?: boolean;
}

export interface LossSummary {
  bySubstance: { substance: string; quantity: number; unit: string }[];
  maintenanceAttributable: number;
  totalRecords: number;
  reason: string;
}

/**
 * Fugitive and consumable losses (E10.03, E10.07).
 *
 * The point of separating maintenance-attributable losses is not blame: it is
 * that those are the ones a maintenance system can actually change. A methane
 * release from a design limitation and one from a seal nobody replaced need
 * different owners.
 */
export function summariseLosses(records: LossRecord[]): LossSummary {
  const bySub = new Map<string, { quantity: number; unit: string }>();
  for (const r of records) {
    const key = `${r.substance}|${r.unit}`;
    const cur = bySub.get(key) ?? { quantity: 0, unit: r.unit };
    cur.quantity += r.quantity;
    bySub.set(key, cur);
  }
  const bySubstance = [...bySub.entries()]
    .map(([k, v]) => ({
      substance: k.split("|")[0],
      quantity: v.quantity,
      unit: v.unit,
    }))
    .sort((a, b) => b.quantity - a.quantity);

  const attributable = records.filter((r) => r.attributedToMaintenance).length;
  const undetermined = records.filter(
    (r) => r.attributedToMaintenance === undefined,
  ).length;

  return {
    bySubstance,
    maintenanceAttributable: attributable,
    totalRecords: records.length,
    reason:
      records.length === 0
        ? "No losses are recorded. On any operating plant that means they are not being captured rather than that there are none — a weeping seal does not raise its own notification."
        : `${records.length} loss record(s) across ${bySubstance.length} substance(s). ` +
          `${attributable} attributed to a maintenance cause, which are the ones this platform can actually change; a release from a design limitation needs a different owner.` +
          (undetermined > 0
            ? ` ${undetermined} have no attribution recorded, and an unattributed loss teaches nobody anything.`
            : ""),
  };
}
