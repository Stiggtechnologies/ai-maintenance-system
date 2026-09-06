export interface CalculationRefusal {
  code: string;
  message: string;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0) throw new Error(`${name} must be greater than zero.`);
}

function nonNegative(value: number, name: string): void {
  finite(value, name);
  if (value < 0) throw new Error(`${name} must be non-negative.`);
}

export interface DamageFractionResult {
  damageFraction: number;
  thresholdStatus:
    | "within_approved_threshold"
    | "at_or_above_approved_threshold"
    | "unassessed";
  refusal?: CalculationRefusal;
}

/** Linear cumulative damage. The failure threshold is never assumed. */
export function calculateMinerDamage(
  bins: Array<{ appliedCycles: number; allowableCycles: number }>,
  approvedFailureThreshold?: number,
): DamageFractionResult {
  if (bins.length === 0)
    throw new Error("At least one stress-cycle bin is required.");
  const damageFraction = bins.reduce((sum, bin, index) => {
    nonNegative(bin.appliedCycles, `bins[${index}].appliedCycles`);
    positive(bin.allowableCycles, `bins[${index}].allowableCycles`);
    return sum + bin.appliedCycles / bin.allowableCycles;
  }, 0);
  if (approvedFailureThreshold === undefined) {
    return {
      damageFraction,
      thresholdStatus: "unassessed",
      refusal: {
        code: "approved_damage_threshold_missing",
        message:
          "Damage was calculated, but no approved source supplied the action or failure threshold.",
      },
    };
  }
  positive(approvedFailureThreshold, "approvedFailureThreshold");
  return {
    damageFraction,
    thresholdStatus:
      damageFraction >= approvedFailureThreshold
        ? "at_or_above_approved_threshold"
        : "within_approved_threshold",
  };
}

/** Arrhenius acceleration factor between a use and accelerated temperature. */
export function calculateArrheniusAccelerationFactor(input: {
  activationEnergyEv: number;
  useTemperatureK: number;
  acceleratedTemperatureK: number;
}): number {
  positive(input.activationEnergyEv, "activationEnergyEv");
  positive(input.useTemperatureK, "useTemperatureK");
  positive(input.acceleratedTemperatureK, "acceleratedTemperatureK");
  const boltzmannEvPerK = 8.617333262145e-5;
  return Math.exp(
    (input.activationEnergyEv / boltzmannEvPerK) *
      (1 / input.useTemperatureK - 1 / input.acceleratedTemperatureK),
  );
}

/** Coffin–Manson plastic-strain relation, returned as reversals/2 cycles. */
export function calculateCoffinMansonCycles(input: {
  plasticStrainAmplitude: number;
  fatigueDuctilityCoefficient: number;
  fatigueDuctilityExponent: number;
}): number {
  positive(input.plasticStrainAmplitude, "plasticStrainAmplitude");
  positive(input.fatigueDuctilityCoefficient, "fatigueDuctilityCoefficient");
  finite(input.fatigueDuctilityExponent, "fatigueDuctilityExponent");
  if (input.fatigueDuctilityExponent >= 0) {
    throw new Error(
      "fatigueDuctilityExponent must be negative for the Coffin–Manson relation.",
    );
  }
  const reversals = Math.pow(
    input.plasticStrainAmplitude / input.fatigueDuctilityCoefficient,
    1 / input.fatigueDuctilityExponent,
  );
  return reversals / 2;
}

/** Paris-law integration for constant stress range and geometry factor. */
export function calculateParisLawCycles(input: {
  initialCrackM: number;
  finalCrackM: number;
  parisC: number;
  parisM: number;
  geometryFactor: number;
  stressRangePa: number;
}): number {
  positive(input.initialCrackM, "initialCrackM");
  positive(input.finalCrackM, "finalCrackM");
  if (input.finalCrackM <= input.initialCrackM) {
    throw new Error("finalCrackM must exceed initialCrackM.");
  }
  positive(input.parisC, "parisC");
  positive(input.parisM, "parisM");
  positive(input.geometryFactor, "geometryFactor");
  positive(input.stressRangePa, "stressRangePa");
  const scale =
    input.parisC *
    Math.pow(
      input.geometryFactor * input.stressRangePa * Math.sqrt(Math.PI),
      input.parisM,
    );
  const exponent = 1 - input.parisM / 2;
  if (Math.abs(exponent) < 1e-12) {
    return Math.log(input.finalCrackM / input.initialCrackM) / scale;
  }
  return (
    (Math.pow(input.finalCrackM, exponent) -
      Math.pow(input.initialCrackM, exponent)) /
    (exponent * scale)
  );
}

/** Robinson-style cumulative creep exposure; no rupture threshold is assumed. */
export function calculateCreepDamage(
  exposures: Array<{ durationHours: number; approvedRuptureTimeHours: number }>,
  approvedFailureThreshold?: number,
): DamageFractionResult {
  return calculateMinerDamage(
    exposures.map((exposure) => ({
      appliedCycles: exposure.durationHours,
      allowableCycles: exposure.approvedRuptureTimeHours,
    })),
    approvedFailureThreshold,
  );
}

/** Archard wear volume. Coefficient and hardness must come from cited evidence. */
export function calculateArchardWearVolumeM3(input: {
  wearCoefficient: number;
  normalLoadN: number;
  slidingDistanceM: number;
  hardnessPa: number;
}): number {
  nonNegative(input.wearCoefficient, "wearCoefficient");
  nonNegative(input.normalLoadN, "normalLoadN");
  nonNegative(input.slidingDistanceM, "slidingDistanceM");
  positive(input.hardnessPa, "hardnessPa");
  return (
    (input.wearCoefficient * input.normalLoadN * input.slidingDistanceM) /
    input.hardnessPa
  );
}

export interface RainflowCycle {
  range: number;
  mean: number;
  count: 0.5 | 1;
}

function turningPoints(series: number[]): number[] {
  if (series.length < 2) return [...series];
  const clean = series.filter(
    (value, index) => index === 0 || value !== series[index - 1],
  );
  const points = [clean[0]];
  for (let index = 1; index < clean.length - 1; index += 1) {
    const left = clean[index] - clean[index - 1];
    const right = clean[index + 1] - clean[index];
    if (left * right <= 0) points.push(clean[index]);
  }
  if (clean.length > 1) points.push(clean[clean.length - 1]);
  return points;
}

/** ASTM-style rainflow extraction for a scalar load history. */
export function extractRainflowCycles(series: number[]): RainflowCycle[] {
  if (series.length < 2)
    throw new Error("At least two load samples are required.");
  series.forEach((value, index) => finite(value, `series[${index}]`));
  const stack: number[] = [];
  const cycles: RainflowCycle[] = [];
  for (const point of turningPoints(series)) {
    stack.push(point);
    while (stack.length >= 3) {
      const x = Math.abs(stack[stack.length - 2] - stack[stack.length - 3]);
      const y = Math.abs(stack[stack.length - 1] - stack[stack.length - 2]);
      if (x > y) break;
      const low = stack[stack.length - 3];
      const high = stack[stack.length - 2];
      cycles.push({
        range: x,
        mean: (low + high) / 2,
        count: stack.length === 3 ? 0.5 : 1,
      });
      if (stack.length === 3) stack.shift();
      else stack.splice(stack.length - 3, 2);
    }
  }
  for (let index = 0; index < stack.length - 1; index += 1) {
    cycles.push({
      range: Math.abs(stack[index + 1] - stack[index]),
      mean: (stack[index + 1] + stack[index]) / 2,
      count: 0.5,
    });
  }
  return cycles.filter((cycle) => cycle.range > 0);
}

export interface HazardCombinationResult {
  totalHazardPerHour: number | null;
  refusal?: CalculationRefusal;
}

export function combineMechanismHazards(input: {
  hazardsPerHour: number[];
  independenceEstablished: boolean;
  interactionModelReference?: string;
  interactionHazardPerHour?: number;
}): HazardCombinationResult {
  input.hazardsPerHour.forEach((hazard, index) =>
    nonNegative(hazard, `hazardsPerHour[${index}]`),
  );
  if (input.independenceEstablished) {
    return {
      totalHazardPerHour: input.hazardsPerHour.reduce(
        (sum, hazard) => sum + hazard,
        0,
      ),
    };
  }
  if (
    !input.interactionModelReference?.trim() ||
    input.interactionHazardPerHour === undefined
  ) {
    return {
      totalHazardPerHour: null,
      refusal: {
        code: "mechanism_interaction_unmodelled",
        message:
          "Mechanisms are not established as independent and no approved interaction model was supplied.",
      },
    };
  }
  nonNegative(input.interactionHazardPerHour, "interactionHazardPerHour");
  return {
    totalHazardPerHour:
      input.hazardsPerHour.reduce((sum, hazard) => sum + hazard, 0) +
      input.interactionHazardPerHour,
  };
}

export interface GaussianStateEstimate {
  mean: number;
  variance: number;
  standardDeviation: number;
}

/** One-dimensional Bayesian/Kalman measurement update for hidden damage state. */
export function updateGaussianDamageState(input: {
  priorMean: number;
  priorVariance: number;
  measurement: number;
  measurementVariance: number;
}): GaussianStateEstimate {
  finite(input.priorMean, "priorMean");
  positive(input.priorVariance, "priorVariance");
  finite(input.measurement, "measurement");
  positive(input.measurementVariance, "measurementVariance");
  const gain =
    input.priorVariance / (input.priorVariance + input.measurementVariance);
  const mean = input.priorMean + gain * (input.measurement - input.priorMean);
  const variance = (1 - gain) * input.priorVariance;
  return { mean, variance, standardDeviation: Math.sqrt(variance) };
}

export interface HypothesisScore {
  mechanismKey: string;
  physicsConsistency: number;
  evidenceSupport: number;
  contradictingEvidence: number;
  predictionAccuracy: number | null;
}

export function rankMechanismHypotheses(
  hypotheses: HypothesisScore[],
): Array<
  HypothesisScore & {
    score: number;
    rank: number;
    humanSelectionRequired: true;
  }
> {
  const scored = hypotheses.map((hypothesis) => {
    for (const [name, value] of Object.entries(hypothesis)) {
      if (name === "mechanismKey" || value === null) continue;
      finite(value as number, name);
      if ((value as number) < 0 || (value as number) > 1)
        throw new Error(`${name} must be between zero and one.`);
    }
    const accuracy = hypothesis.predictionAccuracy ?? 0;
    const knownWeight = hypothesis.predictionAccuracy === null ? 0.8 : 1;
    const score =
      (0.35 * hypothesis.physicsConsistency +
        0.35 * hypothesis.evidenceSupport +
        0.2 * accuracy -
        0.1 * hypothesis.contradictingEvidence) /
      knownWeight;
    return { ...hypothesis, score, humanSelectionRequired: true as const };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .map((hypothesis, index) => ({ ...hypothesis, rank: index + 1 }));
}

export interface VerificationDebtItem {
  id: string;
  description: string;
  blocking: boolean;
  expiresAt?: string;
  resolvedAt?: string;
}

export function assessVerificationDebt(
  items: VerificationDebtItem[],
  asOf: Date,
): {
  productionEligible: boolean;
  open: VerificationDebtItem[];
  expired: VerificationDebtItem[];
} {
  const open = items.filter((item) => !item.resolvedAt);
  const expired = open.filter(
    (item) =>
      item.expiresAt && new Date(item.expiresAt).getTime() <= asOf.getTime(),
  );
  return {
    productionEligible:
      open.every((item) => !item.blocking) && expired.length === 0,
    open,
    expired,
  };
}

export function applyMaintenanceIntervention(input: {
  currentDamage: number;
  effect: "no_change" | "partial_reset" | "full_reset" | "rate_change_only";
  approvedResetFraction?: number;
}): { postInterventionDamage: number | null; refusal?: CalculationRefusal } {
  nonNegative(input.currentDamage, "currentDamage");
  if (input.effect === "full_reset") return { postInterventionDamage: 0 };
  if (input.effect === "no_change" || input.effect === "rate_change_only") {
    return { postInterventionDamage: input.currentDamage };
  }
  if (
    input.approvedResetFraction === undefined ||
    input.approvedResetFraction < 0 ||
    input.approvedResetFraction > 1
  ) {
    return {
      postInterventionDamage: null,
      refusal: {
        code: "intervention_effect_missing",
        message:
          "A partial reset requires an approved damage-reset fraction between zero and one.",
      },
    };
  }
  return {
    postInterventionDamage:
      input.currentDamage * (1 - input.approvedResetFraction),
  };
}

export function comparePhysicalAndEconomicRul(input: {
  safeRulHours: number;
  economicReplacementHours: number;
  consequenceClass: "low" | "medium" | "high" | "safety_critical";
}): {
  planningHorizonHours: number;
  basis: string;
  humanApprovalRequired: true;
} {
  nonNegative(input.safeRulHours, "safeRulHours");
  nonNegative(input.economicReplacementHours, "economicReplacementHours");
  const planningHorizonHours = Math.min(
    input.safeRulHours,
    input.economicReplacementHours,
  );
  return {
    planningHorizonHours,
    basis:
      input.safeRulHours <= input.economicReplacementHours
        ? `Physical safe-life limit governs for ${input.consequenceClass} consequence.`
        : "The approved economic replacement point occurs before the physical safe-life limit.",
    humanApprovalRequired: true,
  };
}

export function compareModelEstimates(
  estimates: Array<{
    modelKey: string;
    value: number;
    unit: string;
    lower: number;
    upper: number;
  }>,
): { conflict: boolean; reason: string } {
  if (estimates.length < 2)
    return {
      conflict: false,
      reason: "Fewer than two model estimates are available.",
    };
  const units = new Set(estimates.map((estimate) => estimate.unit));
  if (units.size !== 1)
    return {
      conflict: true,
      reason: "Model estimates use incompatible units.",
    };
  const disjoint = estimates.some((left, index) =>
    estimates
      .slice(index + 1)
      .some((right) => left.upper < right.lower || right.upper < left.lower),
  );
  return {
    conflict: disjoint,
    reason: disjoint
      ? "At least two uncertainty intervals do not overlap; human arbitration is required."
      : "The reported uncertainty intervals overlap.",
  };
}

export function runParameterSweep<T>(
  values: number[],
  evaluator: (value: number) => T,
): Array<{ input: number; output: T }> {
  if (values.length === 0)
    throw new Error("Parameter sweep requires at least one value.");
  return values.map((value, index) => {
    finite(value, `values[${index}]`);
    return { input: value, output: evaluator(value) };
  });
}
