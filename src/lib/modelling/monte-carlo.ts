/**
 * Monte Carlo risk and production simulation (capability register C7.05).
 *
 * Simulates a fleet over a horizon: each unit alternates between running and
 * being repaired, sampling time-to-failure from its FITTED Weibull and
 * time-to-repair from its observed repair distribution. Production is then
 * whatever the surviving capacity could deliver, subject to the redundancy the
 * dependency graph records.
 *
 * WHERE THE DISCIPLINE IS.
 *
 * The tempting version of this feature invents distributions. Ask for a
 * simulation, get a beta of 2.0 and an MTTR of 8 hours because those are
 * plausible, and the output looks identical to one built on real data. So this
 * takes a `WeibullFit` produced by the validated MLE in src/lib/reliability and
 * REFUSES any unit that does not have one. `simulable` is false, the unit is
 * named, and no number is produced for it.
 *
 * Every run is seeded. The same seed gives the same answer, so a result in a
 * report can be reproduced by whoever is challenging it.
 */
import {
  mulberry32,
  percentile,
  sampleLognormal,
  sampleWeibull,
} from "./random";

export interface SimUnit {
  id: string;
  label: string;
  /** From weibullMLE. Null means never fitted — this unit is refused. */
  beta: number | null;
  eta: number | null;
  /** Median repair hours. Null means unknown — refused. */
  medianRepairHours: number | null;
  /** Lognormal shape for repair spread. Defaults to 0.6 with that stated. */
  repairSigma?: number | null;
  /** Production capacity this unit contributes per hour when running. */
  capacityPerHour: number;
}

export interface SimulationInput {
  units: SimUnit[];
  horizonHours: number;
  iterations: number;
  seed: number;
  /** Capacity the plant is expected to deliver per hour. */
  targetCapacityPerHour: number;
  /**
   * "rated" when capacityPerHour carries real per-asset rated capacity.
   * "unweighted" when every unit was given a nominal 1 because the register
   * holds no rated capacity — in that case the run measures FLEET AVAILABILITY
   * and the capacity commentary is suppressed, because "installed capacity
   * equals target" would be an artifact of the nominal weighting rather than a
   * fact about the plant.
   */
  capacityBasis?: "rated" | "unweighted";
}

export interface SimulationResult {
  simulable: boolean;
  unitsSimulated: number;
  unitsRefused: string[];
  /** Production achieved as a fraction of target, across iterations. */
  productionP10: number | null;
  productionP50: number | null;
  productionP90: number | null;
  /** Fraction of iterations that met the target at all. */
  probabilityOfMeetingTarget: number | null;
  /** Mean number of failure events per iteration. */
  meanFailures: number | null;
  /** Mean hours the plant sat below target. */
  meanHoursBelowTarget: number | null;
  seed: number;
  iterations: number;
  reason: string;
}

const DEFAULT_REPAIR_SIGMA = 0.6;

export function simulateProduction(input: SimulationInput): SimulationResult {
  const { units, horizonHours, iterations, seed, targetCapacityPerHour } =
    input;

  const refused = units
    .filter(
      (u) =>
        u.beta == null ||
        u.eta == null ||
        !(u.beta > 0) ||
        !(u.eta > 0) ||
        u.medianRepairHours == null ||
        !(u.medianRepairHours >= 0),
    )
    .map((u) => u.label);

  const usable = units.filter((u) => !refused.includes(u.label));

  const base = {
    simulable: false as boolean,
    unitsSimulated: usable.length,
    unitsRefused: refused,
    productionP10: null,
    productionP50: null,
    productionP90: null,
    probabilityOfMeetingTarget: null,
    meanFailures: null,
    meanHoursBelowTarget: null,
    seed,
    iterations,
  };

  if (usable.length === 0) {
    return {
      ...base,
      reason:
        units.length === 0
          ? "No units supplied. Nothing to simulate."
          : `None of the ${units.length} unit(s) have both a fitted life distribution and an observed repair time. A simulation cannot be run on assumed parameters — the output would be indistinguishable from one built on real history.`,
    };
  }

  if (refused.length > 0) {
    // Partial simulation is worse than none: the plant would appear to have
    // fewer units than it has, which flatters availability.
    return {
      ...base,
      reason: `${refused.length} of ${units.length} unit(s) have no fitted life distribution or no observed repair time: ${refused.slice(0, 5).join(", ")}${refused.length > 5 ? ", …" : ""}. The simulation is not run. Dropping them would model a smaller plant than the one that exists and overstate the production it can lose.`,
    };
  }

  if (!(horizonHours > 0) || !(iterations > 0)) {
    return {
      ...base,
      reason: "Horizon and iteration count must both be positive.",
    };
  }

  const totalCapacity = usable.reduce((s, u) => s + u.capacityPerHour, 0);
  const rng = mulberry32(seed);

  const productionFractions: number[] = [];
  let metTarget = 0;
  let failureTotal = 0;
  let belowTargetHoursTotal = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Per-unit up/down timeline, resolved on an hourly grid. An hourly grid is
    // coarse enough to be fast and fine enough for horizons measured in months;
    // repairs shorter than an hour are rounded up, which is conservative.
    const down = new Uint8Array(Math.ceil(horizonHours));
    const perUnitDown: Uint8Array[] = [];
    let failures = 0;

    for (const u of usable) {
      const timeline = new Uint8Array(Math.ceil(horizonHours));
      let t = sampleWeibull(rng, u.beta!, u.eta!);
      while (t < horizonHours) {
        const repair = Math.max(
          1,
          sampleLognormal(
            rng,
            u.medianRepairHours!,
            u.repairSigma ?? DEFAULT_REPAIR_SIGMA,
          ),
        );
        failures++;
        const start = Math.floor(t);
        const end = Math.min(Math.ceil(t + repair), timeline.length);
        for (let h = start; h < end; h++) timeline[h] = 1;
        // Renewal: the unit is as-good-as-repaired, so the clock restarts.
        t = t + repair + sampleWeibull(rng, u.beta!, u.eta!);
      }
      perUnitDown.push(timeline);
    }

    let delivered = 0;
    let belowTargetHours = 0;
    for (let h = 0; h < down.length; h++) {
      let cap = 0;
      for (let i = 0; i < usable.length; i++) {
        if (perUnitDown[i][h] === 0) cap += usable[i].capacityPerHour;
      }
      // A plant cannot bank surplus capacity against a future shortfall, so
      // each hour is capped at the target before summing. Without this cap a
      // fleet with spare capacity would appear to make up outages it cannot.
      delivered += Math.min(cap, targetCapacityPerHour);
      if (cap < targetCapacityPerHour) belowTargetHours++;
    }

    const fraction = delivered / (targetCapacityPerHour * down.length);
    productionFractions.push(fraction);
    if (fraction >= 0.999999) metTarget++;
    failureTotal += failures;
    belowTargetHoursTotal += belowTargetHours;
  }

  productionFractions.sort((a, b) => a - b);

  const p10 = percentile(productionFractions, 0.1);
  const p50 = percentile(productionFractions, 0.5);
  const p90 = percentile(productionFractions, 0.9);

  const sigmaNote = usable.some((u) => u.repairSigma == null)
    ? ` Repair-time spread defaults to sigma ${DEFAULT_REPAIR_SIGMA} where none was observed; that is an assumption, not a measurement.`
    : "";

  const capacityNote =
    input.capacityBasis === "unweighted"
      ? " Units are unweighted — the register holds no rated capacity per asset — so this is fleet availability, not a production figure, and no claim is made about spare capacity."
      : totalCapacity > targetCapacityPerHour
        ? ` Installed capacity is ${((totalCapacity / targetCapacityPerHour - 1) * 100).toFixed(0)}% above target, so some outages are absorbed without production loss.`
        : totalCapacity < targetCapacityPerHour
          ? ` Installed capacity is BELOW target even with every unit running, so the target is unreachable regardless of reliability — this is a capacity problem, not a maintenance one.`
          : ` Installed capacity exactly equals target: every outage is a production loss because there is no redundancy at all.`;

  return {
    simulable: true,
    unitsSimulated: usable.length,
    unitsRefused: [],
    productionP10: p10,
    productionP50: p50,
    productionP90: p90,
    probabilityOfMeetingTarget: metTarget / iterations,
    meanFailures: failureTotal / iterations,
    meanHoursBelowTarget: belowTargetHoursTotal / iterations,
    seed,
    iterations,
    reason:
      `${iterations} iteration(s) over ${horizonHours} hours, seed ${seed} — the same seed reproduces this exactly. ` +
      `Production lands at ${(p50 * 100).toFixed(1)}% of target in the median year, ${(p10 * 100).toFixed(1)}% in a bad one (P10) and ${(p90 * 100).toFixed(1)}% in a good one (P90). ` +
      `The P10-to-P90 spread of ${((p90 - p10) * 100).toFixed(1)} points is the number to plan against; the median alone hides it.` +
      capacityNote +
      sigmaNote,
  };
}
