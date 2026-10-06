import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coxCapacityInput } from "./fixtures/cox-capacity-input";
import witness from "./fixtures/cox-capacity-reference.json";
import { analyseCoxSurvival } from "./cox-prediction";
import { fitCox } from "./cox";

describe("complete declared computational boundary, not customer fleet qualification", () => {
  it("retains the exact 2000-interval eight-covariate recipe and independent runtime provenance", () => {
    const input = coxCapacityInput();
    expect(input.rows).toHaveLength(2000);
    expect(input.covariateNames).toHaveLength(8);
    expect(input.clusters).toHaveLength(1000);
    expect(new Set(input.clusters.map(([, asset]) => asset)).size).toBe(32);
    expect(new Set(input.rows.map((row) => row.stratum)).size).toBe(4);
    expect(input.rows.some((row) => row.start > 0)).toBe(true);
    expect(input.rows.some((row) => !row.failed)).toBe(true);
    expect(input.profiles.map((profile) => profile.path.length)).toEqual([
      1, 2,
    ]);
    expect(witness.provenance.inputSha256).toBe(
      createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    );
    expect(witness.provenance.inputRecipe).toBe(
      "src/lib/reliability/fixtures/cox-capacity-input.ts",
    );
    expect(witness.provenance.recipeSha256).toBe(
      createHash("sha256")
        .update(readFileSync(witness.provenance.inputRecipe))
        .digest("hex"),
    );
    expect(witness.provenance.largestStabilityDifference).toBeLessThan(
      witness.provenance.stabilityTolerance,
    );
    expect(witness.perturbations.map((item) => item.delta)).toEqual([
      1e-4, 1e-5, 1e-6,
    ]);
    for (const perturbation of witness.perturbations)
      expect(perturbation.assets).toHaveLength(32);
    expect(witness.provenance.versions).toEqual({
      R: "4.6.0",
      survival: "3.8.6",
      Matrix: "1.7.5",
      lattice: "0.22.9",
      WebR: "0.6.0",
    });
    expect(witness.provenance.data).toContain("not customer");
  });
  it("refuses complete out-of-bound cohorts rather than fitting a truncated subset", () => {
    const input = coxCapacityInput();
    const excess = [
      ...input.rows,
      {
        ...input.rows[0],
        id: "synthetic-extra-interval",
        subjectId: "synthetic-extra-life",
      },
    ];
    expect(fitCox(excess, input.covariateNames)).toMatchObject({
      status: "refused",
      code: "invalid_input",
      authority: "advisory_only",
    });
    expect(
      fitCox(
        input.rows.map((row) => ({
          ...row,
          covariates: [...row.covariates, 0],
        })),
        [...input.covariateNames, "synthetic_ninth_condition"],
      ),
    ).toMatchObject({ status: "refused", code: "invalid_input" });
    expect(input.rows).toHaveLength(2000);
    expect(input.covariateNames).toHaveLength(8);
  });
  for (const [index, label] of [
    "constant",
    "known-at-origin piecewise",
  ].entries()) {
    it(`matches independent R at the full boundary: ${label}`, () => {
      const input = coxCapacityInput();
      const result = analyseCoxSurvival(
        input.rows,
        input.covariateNames,
        new Map(input.clusters),
        input.profiles[index],
      );
      if (result.status !== "fitted") throw new Error(result.reason);
      expect(result.subjects).toBe(1000);
      expect(result.failures).toBe(witness.failures);
      result.coefficients.forEach((value, j) =>
        expect(value).toBeCloseTo(witness.coefficients[j], 7),
      );
      result.covariance.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value).toBeCloseTo(witness.covariance[i][j], 7),
        ),
      );
      expect(result.logLikelihood).toBeCloseTo(witness.logLikelihood, 7);
      if (result.diagnostics?.status !== "computed")
        throw new Error(JSON.stringify(result.diagnostics));
      expect(result.diagnostics.clusterCount).toBe(32);
      result.diagnostics.clusteredCovariance.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value).toBeCloseTo(witness.clusteredCovariance[i][j], 7),
        ),
      );
      if (result.diagnostics.phIdentity.status !== "computed")
        throw new Error(result.diagnostics.phIdentity.reason);
      [
        ...result.diagnostics.phIdentity.covariates,
        result.diagnostics.phIdentity.global,
      ].forEach((test, i) => {
        expect(test.statistic).toBeCloseTo(witness.phIdentityTable[i][0], 7);
        expect(test.degreesOfFreedom).toBe(witness.phIdentityTable[i][1]);
        expect(test.pValue).toBeCloseTo(witness.phIdentityTable[i][2], 7);
      });
      const scenario = result.conditionalScenario;
      if (scenario?.status !== "estimated")
        throw new Error(JSON.stringify(scenario));
      const expected = witness.scenarios[index];
      expect(scenario.cumulativeHazardIncrement).toBeCloseTo(
        expected.hazard,
        7,
      );
      if (scenario.predictionUncertainty?.status !== "computed")
        throw new Error(JSON.stringify(scenario.predictionUncertainty));
      expect(scenario.predictionUncertainty.clusterCount).toBe(32);
      expect(
        scenario.predictionUncertainty.clusterInfluences.map(
          (item) => item.clusterId,
        ),
      ).toEqual(expected.influences.map((item) => item.clusterId));
      expect(
        scenario.predictionUncertainty.cumulativeHazardVariance,
      ).toBeCloseTo(expected.variance, 7);
      for (const influence of scenario.predictionUncertainty
        .clusterInfluences) {
        const independent = expected.influences.find(
          (item) => item.clusterId === influence.clusterId,
        );
        expect(independent).toBeDefined();
        expect(influence.influence).toBeCloseTo(independent!.influence, 7);
      }
      const bounds = scenario.predictionUncertainty.modelConfidenceBounds;
      if (bounds?.status !== "computed")
        throw new Error(JSON.stringify(bounds));
      expect(bounds.conditionalFailureProbability.lower).toBeCloseTo(
        expected.failureBounds[0],
        7,
      );
      expect(bounds.conditionalFailureProbability.upper).toBeCloseTo(
        expected.failureBounds[1],
        7,
      );
      expect(bounds.coverageValidated).toBe(false);
      expect(bounds.futureEventPredictionInterval).toBe(false);
      expect(scenario.confidenceInterval).toBeNull();
      expect(scenario.liveAssetForecast).toBe(false);
      expect(result.phAssumptionValidated).toBe(false);
      expect(result.authority).toBe("advisory_only");
    }, 30_000);
  }
});
