import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import witness from "./fixtures/cox-confidence-reference.json";
import uncertainty from "./fixtures/cox-uncertainty-reference.json";
import input from "./fixtures/cox-reference.json";
import { coxModelConfidenceBounds } from "./cox-confidence";
import { analyseCoxSurvival } from "./cox-prediction";

describe("pointwise model sampling-confidence transformation, not predictive coverage", () => {
  it("pins the actual independent R transform and exact full-asset variance artifact", () => {
    expect(witness.provenance.R).toBe("4.6.0");
    expect(witness.provenance.WebR).toBe("0.6.0");
    expect(witness.provenance.criticalValue).toBeCloseTo(
      1.9599639845400536,
      15,
    );
    expect(witness.provenance.data).toContain("not empirical coverage");
    expect(witness.provenance.method).toContain("No clipping");
    expect(
      createHash("sha256")
        .update(readFileSync(witness.provenance.input.path))
        .digest("hex"),
    ).toBe(witness.provenance.input.sha256);
    expect(
      witness.cases.reduce((sum, cohort) => sum + cohort.scenarios.length, 0),
    ).toBe(25);
  });
  for (const [index, cohort] of witness.cases.entries()) {
    it(`matches R log-hazard, failure and survival bounds: ${cohort.name}`, () => {
      expect(cohort.name).toBe(uncertainty.cases[index].name);
      for (const scenario of cohort.scenarios) {
        const actual = coxModelConfidenceBounds(
          scenario.cumulativeHazardIncrement,
          scenario.cumulativeHazardVariance,
        );
        expect(actual.status).toBe("computed");
        if (actual.status !== "computed")
          throw new Error(JSON.stringify(actual));
        expect(actual.nominalConfidenceLevel).toBe(0.95);
        expect(actual.boundsVersion).toBe("cox-model-confidence/1/draft");
        expect(actual.method).toBe(
          "pointwise_asymptotic_log_cumulative_hazard",
        );
        expect(actual.authority).toBe("advisory_only");
        expect(actual.coverageValidated).toBe(false);
        expect(actual.futureEventPredictionInterval).toBe(false);
        expect(actual.logHazardHalfWidth).toBeCloseTo(
          scenario.logHazardHalfWidth,
          12,
        );
        for (const key of [
          "logCumulativeHazard",
          "cumulativeHazard",
          "conditionalFailureProbability",
          "conditionalSurvivalProbability",
        ] as const) {
          expect(actual[key].lower).toBeCloseTo(scenario[key].lower, 12);
          expect(actual[key].upper).toBeCloseTo(scenario[key].upper, 12);
        }
        const source =
          uncertainty.cases[index].scenarios[scenario.scenarioIndex];
        const fit = analyseCoxSurvival(
          input.cases[index].rows,
          input.cases[index].covariateNames,
          new Map(
            input.cases[index].rows.map((row, j) => [
              row.subjectId,
              String(uncertainty.cases[index].assetClusters[j]),
            ]),
          ),
          source.profile,
        );
        if (
          fit.status !== "fitted" ||
          fit.conditionalScenario?.status !== "estimated" ||
          fit.conditionalScenario.predictionUncertainty?.status !== "computed"
        )
          throw new Error(JSON.stringify(fit));
        const retained =
          fit.conditionalScenario.predictionUncertainty.modelConfidenceBounds;
        expect(retained?.status).toBe("computed");
        if (retained?.status !== "computed")
          throw new Error(JSON.stringify(retained));
        expect(retained.conditionalFailureProbability.lower).toBeCloseTo(
          scenario.conditionalFailureProbability.lower,
          8,
        );
        expect(retained.conditionalFailureProbability.upper).toBeCloseTo(
          scenario.conditionalFailureProbability.upper,
          8,
        );
        expect(fit.conditionalScenario.confidenceInterval).toBeNull();
        expect(fit.conditionalScenario.liveAssetForecast).toBe(false);
        expect(fit.conditionalScenario.calibration).toBe("unqualified");
      }
    });
  }
  it("refuses invalid, degenerate, overflowing, boundary-saturated or floating-point-collapsed bounds without clipping", () => {
    for (const [hazard, variance] of [
      [0, 1],
      [-1, 1],
      [1, 0],
      [1, -1],
      [NaN, 1],
      [1, NaN],
      [Infinity, 1],
      [1, Infinity],
      [1e-300, 1], // Log-scale half-width overflows.
      [1, Number.MAX_VALUE], // Exponentiation over/underflows.
      [1e-20, 1e-42], // Survival rounds to one.
      [1000, 1], // Failure rounds to one, survival underflows.
      [1, Number.MIN_VALUE], // Positive variance cannot resolve a nonzero width.
    ]) {
      const result = coxModelConfidenceBounds(hazard, variance);
      expect(result.status).toBe("refused");
      expect(result).not.toHaveProperty("conditionalFailureProbability");
      expect(result).not.toHaveProperty("cumulativeHazard");
      if (result.status !== "refused") throw new Error(JSON.stringify(result));
      expect(result.reason).toMatch(/positive|finite|resolv|boundary/);
    }
  });
  it("keeps the actual browser population's single-asset refusal and separate three-asset bounds", () => {
    const values = [0.2, -0.4, 1, 0, 0.7, -0.8, 0.2, 0.5, -0.1, 0.9, -0.3, 0.4];
    const rows = values.map((value, i) => ({
      id: `interval-${i}`,
      subjectId: `life-${i}`,
      observedAt: 0,
      start: 0,
      stop: i + 1,
      failed: (i + 1) % 3 !== 0,
      stratum: "synthetic-design",
      covariates: [value],
    }));
    rows.push({
      id: "current-interval",
      subjectId: "current-life",
      observedAt: 0,
      start: 0,
      stop: 8,
      failed: false,
      stratum: "synthetic-design",
      covariates: [0.4],
    });
    for (const multipleAssets of [false, true]) {
      const result = analyseCoxSurvival(
        rows,
        ["synthetic_load"],
        new Map(
          rows.map((row, i) => [
            row.subjectId,
            multipleAssets
              ? `asset-${i === 12 ? 0 : Math.floor(i / 4)}`
              : "asset-0",
          ]),
        ),
        {
          stratum: "synthetic-design",
          originHours: 8,
          horizonHours: 10,
          path: [
            {
              startHours: 8,
              stopHours: 10,
              covariates: [0.4],
              observedAtHours: 0,
              availableAtHours: 0,
              validThroughHours: 15,
            },
          ],
        },
      );
      if (
        result.status !== "fitted" ||
        result.conditionalScenario?.status !== "estimated"
      )
        throw new Error(JSON.stringify(result));
      expect(result.subjects).toBe(13);
      expect(result.failures).toBe(8);
      const uncertainty = result.conditionalScenario.predictionUncertainty;
      expect(uncertainty?.status).toBe(multipleAssets ? "computed" : "refused");
      if (multipleAssets) {
        if (uncertainty?.status !== "computed")
          throw new Error(JSON.stringify(uncertainty));
        expect(uncertainty.clusterCount).toBe(3);
        expect(uncertainty.modelConfidenceBounds?.status).toBe("computed");
      }
    }
  });
  it("preserves ordered monotone bounds and complementary endpoints without independent piece variances", () => {
    for (const scenario of witness.cases.flatMap(
      (cohort) => cohort.scenarios,
    )) {
      const actual = coxModelConfidenceBounds(
        scenario.cumulativeHazardIncrement,
        scenario.cumulativeHazardVariance,
      );
      if (actual.status !== "computed") throw new Error(JSON.stringify(actual));
      const failure = -Math.expm1(-scenario.cumulativeHazardIncrement);
      const survival = Math.exp(-scenario.cumulativeHazardIncrement);
      expect(actual.conditionalFailureProbability.lower).toBeLessThan(failure);
      expect(actual.conditionalFailureProbability.upper).toBeGreaterThan(
        failure,
      );
      expect(actual.conditionalSurvivalProbability.lower).toBeLessThan(
        survival,
      );
      expect(actual.conditionalSurvivalProbability.upper).toBeGreaterThan(
        survival,
      );
      expect(
        actual.conditionalFailureProbability.lower +
          actual.conditionalSurvivalProbability.upper,
      ).toBeCloseTo(1, 15);
      expect(
        actual.conditionalFailureProbability.upper +
          actual.conditionalSurvivalProbability.lower,
      ).toBeCloseTo(1, 15);
    }
  });
});
