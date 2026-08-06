import { describe, expect, it } from "vitest";
import {
  breakInWorkPercentage,
  calculateAvailability,
  costOfUnreliability,
  emergencyWorkPercentage,
  exponentialReliability,
  failureRate,
  inherentAvailability,
  mtbf,
  mttr,
  operationalAvailability,
  plannedWorkPercentage,
  pmCompliance,
  riskPriorityNumber,
  scheduleCompliance,
} from "./reliability-calculations";

describe("reliability calculations", () => {
  it("calculates MTBF, MTTR, and inherent availability", () => {
    const result = calculateAvailability(10000, 20, 100, 20);

    expect(result.mtbf).toBe(500);
    expect(result.mttr).toBe(5);
    expect(result.inherentAvailability).toBeCloseTo(0.990099, 6);
  });

  it("calculates core RAM formulas", () => {
    expect(mtbf(10000, 20)).toBe(500);
    expect(mttr(100, 20)).toBe(5);
    expect(inherentAvailability(500, 5)).toBeCloseTo(0.990099, 6);
    expect(operationalAvailability(9500, 10000)).toBe(0.95);
    expect(failureRate(20, 10000)).toBe(0.002);
    expect(exponentialReliability(0.002, 100)).toBeCloseTo(0.818731, 6);
  });

  it("calculates maintenance execution and risk formulas", () => {
    expect(pmCompliance(92, 100)).toBe(0.92);
    expect(scheduleCompliance(45, 50)).toBe(0.9);
    expect(breakInWorkPercentage(8, 40)).toBe(0.2);
    expect(emergencyWorkPercentage(2, 40)).toBe(0.05);
    expect(plannedWorkPercentage(32, 40)).toBe(0.8);
    expect(
      costOfUnreliability({
        downtimeHours: 10,
        productionLossPerHour: 5000,
        maintenanceCost: 12000,
      }),
    ).toBe(62000);
    expect(riskPriorityNumber(8, 6, 4)).toBe(192);
  });

  it("rejects invalid inputs", () => {
    expect(() => mtbf(1000, 0)).toThrow("Failures");
    expect(() => mttr(-1, 3)).toThrow("Total repair hours");
    expect(() => inherentAvailability(0, 1)).toThrow("MTBF");
    expect(() => operationalAvailability(11, 10)).toThrow("cannot exceed");
    expect(() => failureRate(1, 0)).toThrow("Exposure hours");
    expect(() => exponentialReliability(-0.1, 10)).toThrow("Failure rate");
    expect(() => pmCompliance(11, 10)).toThrow("cannot exceed");
    expect(() => riskPriorityNumber(11, 1, 1)).toThrow("Severity");
  });
});
