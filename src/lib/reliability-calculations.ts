export interface AvailabilityResult {
  mtbf: number;
  mttr: number;
  inherentAvailability: number;
}

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function assertNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
}

export function mtbf(operatingHours: number, failures: number): number {
  assertPositive(operatingHours, "Operating hours");
  assertPositive(failures, "Failures");
  return operatingHours / failures;
}

export function mttr(totalRepairHours: number, repairEvents: number): number {
  assertNonNegative(totalRepairHours, "Total repair hours");
  assertPositive(repairEvents, "Repair events");
  return totalRepairHours / repairEvents;
}

export function inherentAvailability(
  mtbfHours: number,
  mttrHours: number,
): number {
  assertPositive(mtbfHours, "MTBF");
  assertNonNegative(mttrHours, "MTTR");
  return mtbfHours / (mtbfHours + mttrHours);
}

export function operationalAvailability(
  uptimeHours: number,
  totalTimeHours: number,
): number {
  assertNonNegative(uptimeHours, "Uptime hours");
  assertPositive(totalTimeHours, "Total time hours");
  if (uptimeHours > totalTimeHours) {
    throw new Error("Uptime hours cannot exceed total time hours.");
  }
  return uptimeHours / totalTimeHours;
}

export function failureRate(failures: number, exposureHours: number): number {
  assertNonNegative(failures, "Failures");
  assertPositive(exposureHours, "Exposure hours");
  return failures / exposureHours;
}

export function exponentialReliability(
  lambdaRate: number,
  missionTimeHours: number,
): number {
  assertNonNegative(lambdaRate, "Failure rate");
  assertNonNegative(missionTimeHours, "Mission time");
  return Math.exp(-lambdaRate * missionTimeHours);
}

function ratio(numerator: number, denominator: number, label: string): number {
  assertNonNegative(numerator, label);
  assertPositive(denominator, "Total");
  if (numerator > denominator) {
    throw new Error(`${label} cannot exceed total.`);
  }
  return numerator / denominator;
}

export function pmCompliance(completedPmCount: number, scheduledPmCount: number) {
  return ratio(completedPmCount, scheduledPmCount, "Completed PM count");
}

export function scheduleCompliance(
  completedAsScheduledCount: number,
  scheduledWorkCount: number,
) {
  return ratio(
    completedAsScheduledCount,
    scheduledWorkCount,
    "Completed as scheduled count",
  );
}

export function breakInWorkPercentage(
  breakInWorkCount: number,
  totalWorkCount: number,
) {
  return ratio(breakInWorkCount, totalWorkCount, "Break-in work count");
}

export function emergencyWorkPercentage(
  emergencyWorkCount: number,
  totalWorkCount: number,
) {
  return ratio(emergencyWorkCount, totalWorkCount, "Emergency work count");
}

export function plannedWorkPercentage(
  plannedWorkCount: number,
  totalWorkCount: number,
) {
  return ratio(plannedWorkCount, totalWorkCount, "Planned work count");
}

export function costOfUnreliability({
  downtimeHours,
  productionLossPerHour,
  maintenanceCost = 0,
  qualityCost = 0,
  safetyEnvironmentalCost = 0,
}: {
  downtimeHours: number;
  productionLossPerHour: number;
  maintenanceCost?: number;
  qualityCost?: number;
  safetyEnvironmentalCost?: number;
}) {
  assertNonNegative(downtimeHours, "Downtime hours");
  assertNonNegative(productionLossPerHour, "Production loss per hour");
  assertNonNegative(maintenanceCost, "Maintenance cost");
  assertNonNegative(qualityCost, "Quality cost");
  assertNonNegative(safetyEnvironmentalCost, "Safety/environmental cost");

  return (
    downtimeHours * productionLossPerHour +
    maintenanceCost +
    qualityCost +
    safetyEnvironmentalCost
  );
}

export function riskPriorityNumber(
  severity: number,
  occurrence: number,
  detection: number,
) {
  for (const [label, value] of [
    ["Severity", severity],
    ["Occurrence", occurrence],
    ["Detection", detection],
  ] as const) {
    assertPositive(value, label);
    if (value > 10) {
      throw new Error(`${label} must be 10 or lower.`);
    }
  }

  return severity * occurrence * detection;
}

export function calculateAvailability(
  operatingHours: number,
  failures: number,
  totalRepairHours: number,
  repairEvents: number,
): AvailabilityResult {
  const calculatedMtbf = mtbf(operatingHours, failures);
  const calculatedMttr = mttr(totalRepairHours, repairEvents);

  return {
    mtbf: calculatedMtbf,
    mttr: calculatedMttr,
    inherentAvailability: inherentAvailability(calculatedMtbf, calculatedMttr),
  };
}
