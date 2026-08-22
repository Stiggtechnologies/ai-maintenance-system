import { describe, expect, it } from "vitest";
import {
  analyzeRiskCulture,
  calculateStressExposure,
  evaluateTreatmentCriticalPath,
  runBayesianBinomial,
  runEventTree,
} from "./advanced";

describe("advanced ISO 31000 deterministic analysis", () => {
  it("updates a beta-binomial likelihood without an LLM calculation", () => {
    const result = runBayesianBinomial({
      priorAlpha: 1,
      priorBeta: 9,
      events: 4,
      opportunities: 20,
    });

    expect(result.posteriorAlpha).toBe(5);
    expect(result.posteriorBeta).toBe(25);
    expect(result.mean).toBeCloseTo(1 / 6, 6);
    expect(result.interval.lower).toBeGreaterThanOrEqual(0);
    expect(result.interval.upper).toBeLessThanOrEqual(1);
  });

  it("rejects impossible Bayesian samples", () => {
    expect(() =>
      runBayesianBinomial({
        priorAlpha: 1,
        priorBeta: 1,
        events: 3,
        opportunities: 2,
      }),
    ).toThrow(/events cannot exceed opportunities/i);
  });

  it("runs a governed event tree and preserves leaf paths", () => {
    const result = runEventTree({
      initiatingProbability: 0.2,
      branches: [
        { key: "barrier_holds", probability: 0.75, consequence: 10 },
        {
          key: "barrier_fails",
          probability: 0.25,
          branches: [
            { key: "recovery", probability: 0.6, consequence: 40 },
            { key: "escalation", probability: 0.4, consequence: 100 },
          ],
        },
      ],
    });

    expect(result.leaves).toHaveLength(3);
    expect(result.conditionalProbabilityMass).toBeCloseTo(1, 10);
    expect(result.initiatingProbabilityMass).toBeCloseTo(0.2, 10);
    expect(result.expectedConsequence).toBeCloseTo(4.7, 10);
  });

  it("prevents duplicate risks and exposes correlated stress uplift", () => {
    const result = calculateStressExposure(
      [
        { riskId: "pump-a", exposure: 60, dependencyGroup: "process-water" },
        { riskId: "pump-a", exposure: 40, dependencyGroup: "process-water" },
        { riskId: "pump-b", exposure: 50, dependencyGroup: "process-water" },
        { riskId: "storm", exposure: 30 },
      ],
      75,
    );

    expect(result.uniqueRiskCount).toBe(3);
    expect(result.correlationUplift).toBeGreaterThan(0);
    expect(result.combinedExposure).toBeGreaterThan(result.independentExposure);
    expect(result.withinCapacity).toBe(false);
    expect(result.methodology).toMatch(/deduplicated/i);
  });

  it("finds the smallest reverse-stress set that breaches a threshold", () => {
    const result = calculateStressExposure(
      [
        { riskId: "a", exposure: 55 },
        { riskId: "b", exposure: 40 },
        { riskId: "c", exposure: 20 },
      ],
      100,
      70,
    );

    expect(result.reverseStressRiskIds).toEqual(["a", "b"]);
  });

  it("calculates a treatment critical path and rejects dependency cycles", () => {
    const result = evaluateTreatmentCriticalPath([
      { id: "engineering", durationDays: 2, dependencies: [] },
      { id: "procure", durationDays: 5, dependencies: ["engineering"] },
      { id: "install", durationDays: 1, dependencies: ["procure"] },
      { id: "train", durationDays: 2, dependencies: ["engineering"] },
    ]);

    expect(result.durationDays).toBe(8);
    expect(result.criticalPath).toEqual(["engineering", "procure", "install"]);
    expect(() =>
      evaluateTreatmentCriticalPath([
        { id: "a", durationDays: 1, dependencies: ["b"] },
        { id: "b", durationDays: 1, dependencies: ["a"] },
      ]),
    ).toThrow(/cycle/i);
  });

  it("turns behavioral evidence into explicit culture signals", () => {
    const signals = analyzeRiskCulture({
      overdueActionRate: 0.4,
      optimisticEstimateMissRate: 0.35,
      controlOverrideRate: 0.2,
      badNewsDelayRate: 0.15,
    });

    expect(signals.map((signal) => signal.key)).toEqual([
      "overdue_actions",
      "optimism_bias",
      "control_override",
      "reporting_delay",
    ]);
    expect(signals.every((signal) => signal.evidenceOnly)).toBe(true);
  });
});
