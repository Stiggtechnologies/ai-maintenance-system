import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import input from "./fixtures/cox-reference.json";
import witness from "./fixtures/cox-uncertainty-reference.json";
import { analyseCoxSurvival } from "./cox-prediction";

describe("independent synthetic full asset prediction influence reference", () => {
  it("pins exact complete inputs and actual R versions without claiming predictive qualification", () => {
    expect(witness.provenance.versions).toEqual({
      R: "4.6.0",
      survival: "3.8.6",
      Matrix: "1.7.5",
      lattice: "0.22.9",
    });
    expect(witness.provenance.WebR).toBe("0.6.0");
    expect(witness.provenance.data).toContain("No customer calibration");
    expect(witness.provenance.method).toContain(
      "Full joint baseline/coefficient influences",
    );
    expect(witness.provenance.method).toContain("not survfit");
    for (const source of witness.provenance.inputs)
      expect(
        createHash("sha256").update(readFileSync(source.path)).digest("hex"),
      ).toBe(source.sha256);
    expect(witness.cases).toHaveLength(3);
    expect(
      witness.cases.reduce((sum, item) => sum + item.scenarios.length, 0),
    ).toBe(25);
    expect(witness.provenance.deltas).toEqual([1e-4, 1e-5, 1e-6]);
  });
  for (const [index, reference] of witness.cases.entries()) {
    it(`preserves all physical assets and stable independent central differences: ${reference.name}`, () => {
      const cohort = input.cases[index];
      expect(reference.name).toBe(cohort.name);
      expect(reference.assetClusters).toHaveLength(cohort.rows.length);
      expect(reference.clusterIds).toHaveLength(24);
      expect(reference.covariateNames).toEqual(cohort.covariateNames);
      const clusters = new Map(
        cohort.rows.map((row, j) => [
          row.subjectId,
          String(reference.assetClusters[j]),
        ]),
      );
      for (const [j, scenario] of reference.scenarios.entries()) {
        const result = analyseCoxSurvival(
          cohort.rows,
          cohort.covariateNames,
          clusters,
          scenario.profile,
        );
        if (
          result.status !== "fitted" ||
          result.conditionalScenario?.status !== "estimated"
        )
          throw new Error(JSON.stringify(result));
        expect(
          result.conditionalScenario.cumulativeHazardIncrement,
        ).toBeCloseTo(scenario.cumulativeHazardIncrement, 7);
        expect(
          scenario.clusterInfluences.map((asset) => asset.clusterId),
        ).toEqual(reference.clusterIds);
        expect(scenario.cumulativeHazardVariance).toBeCloseTo(
          scenario.clusterInfluences.reduce(
            (sum, asset) => sum + asset.influence ** 2,
            0,
          ),
          14,
        );
        for (const perturbation of reference.perturbations) {
          expect(perturbation.assets.map((asset) => asset.clusterId)).toEqual(
            reference.clusterIds,
          );
          for (const [k, asset] of perturbation.assets.entries()) {
            expect(asset.positive).toHaveLength(reference.scenarios.length);
            expect(asset.negative).toHaveLength(reference.scenarios.length);
            expect(asset.influences[j]).toBe(
              (asset.positive[j] - asset.negative[j]) /
                (2 * perturbation.delta),
            );
            expect(
              Math.abs(
                asset.influences[j] - scenario.clusterInfluences[k].influence,
              ),
            ).toBeLessThan(2e-7);
          }
        }
      }
      expect(
        reference.scenarios.some(
          (scenario) => scenario.profile.path.length === 2,
        ),
      ).toBe(true);
      expect(
        reference.scenarios.some((scenario) =>
          cohort.rows.some(
            (row) => row.failed && row.stop === scenario.profile.originHours,
          ),
        ),
      ).toBe(true);
    });
  }
});
