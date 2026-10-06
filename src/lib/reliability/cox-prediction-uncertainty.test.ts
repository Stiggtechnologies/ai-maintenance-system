import { describe, expect, it } from "vitest";
import input from "./fixtures/cox-reference.json";
import reference from "./fixtures/cox-uncertainty-reference.json";
import {
  analyseCoxSurvival,
  type CoxConditionalProfile,
} from "./cox-prediction";

const clusterMap = (index: number) =>
  new Map(
    input.cases[index].rows.map((row, j) => [
      row.subjectId,
      String(reference.cases[index].assetClusters[j]),
    ]),
  );
function estimate(
  index: number,
  profile: CoxConditionalProfile,
  clusters = clusterMap(index),
  reverse = false,
) {
  const cohort = input.cases[index];
  const result = analyseCoxSurvival(
    reverse ? [...cohort.rows].reverse() : cohort.rows,
    cohort.covariateNames,
    clusters,
    profile,
  );
  if (
    result.status !== "fitted" ||
    result.conditionalScenario?.status !== "estimated"
  )
    throw new Error(JSON.stringify(result));
  return result.conditionalScenario;
}

describe("full canonical-asset joint conditional hazard uncertainty", () => {
  for (const [index, witness] of reference.cases.entries()) {
    it(`matches all independent R asset case-weight refits: ${witness.name}`, () => {
      for (const scenario of witness.scenarios) {
        const actual = estimate(index, scenario.profile);
        const uncertainty = actual.predictionUncertainty;
        expect(uncertainty?.status).toBe("computed");
        if (uncertainty?.status !== "computed")
          throw new Error(JSON.stringify(uncertainty));
        expect(uncertainty.uncertaintyVersion).toBe("cox-joint-asset/1/draft");
        expect(uncertainty.authority).toBe("advisory_only");
        expect(uncertainty.clusterCount).toBe(24);
        expect(uncertainty.cumulativeHazardVariance).toBeCloseTo(
          scenario.cumulativeHazardVariance,
          8,
        );
        expect(uncertainty.cumulativeHazardStandardError).toBeCloseTo(
          Math.sqrt(scenario.cumulativeHazardVariance),
          8,
        );
        expect(uncertainty.clusterInfluences).toHaveLength(24);
        for (const asset of scenario.clusterInfluences) {
          const found = uncertainty.clusterInfluences.find(
            (item) => item.clusterId === String(asset.clusterId),
          );
          expect(found?.influence).toBeCloseTo(asset.influence, 8);
        }
        expect(actual.liveAssetForecast).toBe(false);
        expect(actual.calibration).toBe("unqualified");
        expect(actual.confidenceInterval).toBeNull();
      }
    });
  }
  it("retains the point scenario but refuses uncertainty without complete independent asset clusters", () => {
    const profile = reference.cases[0].scenarios[0].profile;
    const incomplete = clusterMap(0);
    incomplete.delete(input.cases[0].rows[0].subjectId);
    const single = new Map(
      input.cases[0].rows.map((row) => [row.subjectId, "one-asset"]),
    );
    const extra = clusterMap(0);
    extra.set("not-an-observed-life", "not-an-asset");
    const singular = new Map(
      input.cases[0].rows.map((row, i) => [row.subjectId, `asset-${i % 2}`]),
    );
    for (const clusters of [incomplete, single, extra, singular]) {
      const actual = estimate(0, profile, clusters);
      expect(actual.predictionUncertainty?.status).toBe("refused");
      expect(actual.confidenceInterval).toBeNull();
      expect(actual.cumulativeHazardIncrement).toBeGreaterThan(0);
    }
  });
  it("preserves joint variance under predictor unit and reference changes", () => {
    const cohort = input.cases[0];
    const profile = reference.cases[0].scenarios.at(-1)!.profile;
    const original = estimate(0, profile);
    const transform = (values: number[]) =>
      values.map((value, j) => (j === 0 ? 100 + value * 10 : value));
    const rows = cohort.rows.map((row) => ({
      ...row,
      covariates: transform(row.covariates),
    }));
    const result = analyseCoxSurvival(
      rows,
      cohort.covariateNames,
      clusterMap(0),
      {
        ...profile,
        path: profile.path.map((piece) => ({
          ...piece,
          covariates: transform(piece.covariates),
        })),
      },
    );
    if (
      original.predictionUncertainty?.status !== "computed" ||
      result.status !== "fitted" ||
      result.conditionalScenario?.status !== "estimated" ||
      result.conditionalScenario.predictionUncertainty?.status !== "computed"
    )
      throw new Error(JSON.stringify(result));
    expect(result.conditionalScenario.cumulativeHazardIncrement).toBeCloseTo(
      original.cumulativeHazardIncrement,
      9,
    );
    expect(
      result.conditionalScenario.predictionUncertainty.cumulativeHazardVariance,
    ).toBeCloseTo(original.predictionUncertainty.cumulativeHazardVariance, 9);
  });
  it("does not turn a no-event window into precise-looking zero uncertainty", () => {
    const profile = structuredClone(reference.cases[0].scenarios[0].profile);
    profile.horizonHours = 1;
    profile.path[0].stopHours = 1;
    const actual = estimate(0, profile);
    expect(actual.cumulativeHazardIncrement).toBe(0);
    expect(actual.predictionUncertainty?.status).toBe("refused");
    if (actual.predictionUncertainty?.status !== "refused")
      throw new Error("Expected uncertainty refusal");
    expect(actual.predictionUncertainty.reason).toMatch(/observed event/);
    expect(actual.confidenceInterval).toBeNull();
  });
  it("is invariant to row order and preserves cross-piece covariance rather than summing variances", () => {
    const profile = reference.cases[0].scenarios.at(-1)!.profile;
    const full = estimate(0, profile);
    const reversed = estimate(0, profile, clusterMap(0), true);
    const first = estimate(0, {
      ...profile,
      horizonHours: profile.path[0].stopHours,
      path: [profile.path[0]],
    });
    const second = estimate(0, {
      ...profile,
      originHours: profile.path[1].startHours,
      path: [profile.path[1]],
    });
    for (const scenario of [full, reversed, first, second])
      if (scenario.predictionUncertainty?.status !== "computed")
        throw new Error(JSON.stringify(scenario));
    if (
      full.predictionUncertainty?.status !== "computed" ||
      reversed.predictionUncertainty?.status !== "computed" ||
      first.predictionUncertainty?.status !== "computed" ||
      second.predictionUncertainty?.status !== "computed"
    )
      throw new Error("Expected complete influences");
    expect(reversed.predictionUncertainty.cumulativeHazardVariance).toBeCloseTo(
      full.predictionUncertainty.cumulativeHazardVariance,
      10,
    );
    const pieceVariance =
      first.predictionUncertainty.cumulativeHazardVariance +
      second.predictionUncertainty.cumulativeHazardVariance;
    expect(
      Math.abs(
        pieceVariance - full.predictionUncertainty.cumulativeHazardVariance,
      ),
    ).toBeGreaterThan(1e-5);
    for (const asset of full.predictionUncertainty.clusterInfluences) {
      const left = first.predictionUncertainty.clusterInfluences.find(
        (item) => item.clusterId === asset.clusterId,
      )!;
      const right = second.predictionUncertainty.clusterInfluences.find(
        (item) => item.clusterId === asset.clusterId,
      )!;
      expect(asset.influence).toBeCloseTo(left.influence + right.influence, 10);
    }
  });
});
