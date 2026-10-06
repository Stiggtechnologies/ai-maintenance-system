import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import input from "./fixtures/cox-reference.json";
import reference from "./fixtures/cox-r-reference.json";
import {
  diagnoseCox,
  coxScoreTailProbability,
  fitCoxWithDiagnostics,
} from "./cox";

describe("independent R survival diagnostics qualification", () => {
  it("retains exact source digest and actual pinned R/survival provenance", () => {
    expect(reference.provenance.inputSha256).toBe(
      createHash("sha256")
        .update(readFileSync(reference.provenance.inputPath))
        .digest("hex"),
    );
    expect(reference.provenance.r).toBe("4.6.0");
    expect(reference.provenance.survival).toBe("3.8.6");
    expect(reference.provenance.noPredictiveQualification).toBe(true);
    expect(reference.provenance.noOperationalAuthority).toBe(true);
  });
  it("matches R chi-square tails for all 1–8 supported degrees, including extreme probabilities", () => {
    for (const fixture of reference.chiSquareTails)
      fixture.statistics.forEach((statistic, i) => {
        const actual = coxScoreTailProbability(
          statistic,
          fixture.degreesOfFreedom,
        );
        expect(actual).toBeCloseTo(fixture.expected[i], 12);
        if (fixture.expected[i] > 0) {
          expect(actual).toBeGreaterThan(0);
          expect(Math.abs(actual / fixture.expected[i] - 1)).toBeLessThan(
            1e-10,
          );
        }
      });
    for (const [statistic, degrees] of [
      [-1, 2],
      [Number.NaN, 2],
      [1, 0],
      [1, 9],
      [1, 1.5],
    ])
      expect(coxScoreTailProbability(statistic, degrees)).toBeNaN();
  });
  const mapping = (index: number) =>
    new Map(
      input.cases[index].rows.map((row, i) => [
        row.subjectId,
        String(reference.cases[index].assetClusters[i]),
      ]),
    );
  for (const [index, fixture] of reference.cases.entries()) {
    it(`matches Efron cluster influences and formal identity PH score tests: ${fixture.name}`, () => {
      const source = input.cases[index];
      const result = diagnoseCox(
        source.rows,
        source.covariateNames,
        mapping(index),
      );
      expect(result.status).toBe("computed");
      if (result.status !== "computed") throw new Error(result.reason);
      result.scoreResiduals.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value).toBeCloseTo(fixture.expected.scoreResiduals[i][j], 7),
        ),
      );
      result.clusteredCovariance.forEach((row, i) =>
        row.forEach((value, j) =>
          expect(value).toBeCloseTo(
            fixture.expected.clusterCovariance[i][j],
            7,
          ),
        ),
      );
      result.clusterInfluences.forEach(({ clusterId, dfbeta }) => {
        const i = fixture.clusterIds.indexOf(Number(clusterId));
        dfbeta.forEach((value, j) =>
          expect(value).toBeCloseTo(fixture.expected.clusterDfbeta[i][j], 7),
        );
      });
      expect(result.phIdentity.status).toBe("computed");
      if (result.phIdentity.status !== "computed")
        throw new Error(result.phIdentity.reason);
      [...result.phIdentity.covariates, result.phIdentity.global].forEach(
        (test, i) => {
          expect(test.statistic).toBeCloseTo(
            fixture.expected.phIdentityTable[i][0],
            7,
          );
          expect(test.degreesOfFreedom).toBe(
            fixture.expected.phIdentityTable[i][1],
          );
          expect(test.pValue).toBeCloseTo(
            fixture.expected.phIdentityTable[i][2],
            7,
          );
        },
      );
      expect(result.authority).toBe("advisory_only");
      expect(result.limitations.join(" ")).toContain("not proof");
    });
  }
  it("refuses missing, extra, empty or single-asset cluster mappings instead of fabricating independence", () => {
    const fixture = input.cases[0];
    const missing = mapping(0);
    missing.delete(fixture.rows[0].subjectId);
    const extra = mapping(0);
    extra.set("not-in-cohort", "asset-extra");
    const empty = mapping(0);
    empty.set(fixture.rows[0].subjectId, " ");
    const single = new Map(
      fixture.rows.map((row) => [row.subjectId, "one-asset"]),
    );
    for (const clusters of [missing, extra, empty, single]) {
      expect(
        diagnoseCox(fixture.rows, fixture.covariateNames, clusters).status,
      ).toBe("refused");
    }
  });
  it("refuses the entire diagnostic for malformed or leaking source observations", () => {
    const fixture = input.cases[0];
    const rows = structuredClone(fixture.rows);
    rows[0].observedAt = rows[0].stop;
    expect(diagnoseCox(rows, fixture.covariateNames, mapping(0)).status).toBe(
      "refused",
    );
  });
  it("refuses singular clustered covariance instead of publishing precise-looking uncertainty", () => {
    const fixture = input.cases[0];
    const clusters = new Map(
      fixture.rows.map((row, i) => [row.subjectId, `asset-${i % 2}`]),
    );
    const result = diagnoseCox(fixture.rows, fixture.covariateNames, clusters);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("Expected refusal.");
    expect(result.reason).toContain("Clustered covariance is singular");
  });
  it("retains clustered uncertainty but explicitly refuses PH when failure times have no variation", () => {
    const fixture = input.cases[0];
    const rows = fixture.rows.map((row) => ({
      ...row,
      start: 0,
      stop: row.failed ? 3 : 6,
      observedAt: 0,
    }));
    const result = fitCoxWithDiagnostics(
      rows,
      fixture.covariateNames,
      mapping(0),
    );
    expect(result.status).toBe("fitted");
    if (result.status !== "fitted") throw new Error(result.reason);
    expect(result.phAssumptionValidated).toBe(false);
    expect(result.diagnostics?.status).toBe("computed");
    if (result.diagnostics?.status !== "computed")
      throw new Error("Expected identifiable clustered uncertainty.");
    expect(result.diagnostics.phIdentity.status).toBe("refused");
    expect(result.covariateNames).toEqual(fixture.covariateNames);
    expect(result.covariateNames).not.toBe(fixture.covariateNames);
    expect(result.authority).toBe("advisory_only");
  });
  it("exercises the multi-asset runtime fixture without claiming customer cluster adequacy", () => {
    const measurements = [
      0.2, -0.4, 1, 0, 0.7, -0.8, 0.2, 0.5, -0.1, 0.9, -0.3, 0.4,
    ];
    const rows = measurements.map((value, index) => ({
      id: `synthetic-event-${index + 1}`,
      subjectId: `synthetic-life-${index + 1}`,
      stratum: "synthetic-design",
      start: 0,
      stop: index + 1,
      failed: (index + 1) % 3 !== 0,
      observedAt: 0,
      covariates: [value],
    }));
    const result = fitCoxWithDiagnostics(
      rows,
      ["synthetic_load"],
      new Map(
        rows.map((row, index) => [
          row.subjectId,
          `synthetic-asset-${Math.floor(index / 4)}`,
        ]),
      ),
    );
    expect(result.status).toBe("fitted");
    if (result.status !== "fitted") throw new Error(result.reason);
    expect(result.diagnostics?.status).toBe("computed");
    if (result.diagnostics?.status !== "computed")
      throw new Error("Expected numerical diagnostics.");
    expect(result.diagnostics.clusterCount).toBe(3);
    expect(result.diagnostics.phIdentity.status).toBe("computed");
    expect(result.phAssumptionValidated).toBe(false);
    expect(result.diagnostics.limitations.join(" ")).toContain(
      "sufficient clusters",
    );
  });
  it("is invariant under row order and covariate units, including formal PH p-values", () => {
    const fixture = input.cases[0];
    const original = diagnoseCox(
      fixture.rows,
      fixture.covariateNames,
      mapping(0),
    );
    const changed = diagnoseCox(
      fixture.rows
        .map((row) => ({
          ...row,
          covariates: [row.covariates[0] * 1000 + 700, row.covariates[1]],
        }))
        .reverse(),
      fixture.covariateNames,
      mapping(0),
    );
    expect(original.status).toBe("computed");
    expect(changed.status).toBe("computed");
    if (original.status === "computed")
      expect(original.phIdentity.status).toBe("computed");
    if (changed.status === "computed")
      expect(changed.phIdentity.status).toBe("computed");
    if (
      original.status === "computed" &&
      changed.status === "computed" &&
      original.phIdentity.status === "computed" &&
      changed.phIdentity.status === "computed"
    ) {
      expect(changed.clusteredCovariance[0][0] * 1e6).toBeCloseTo(
        original.clusteredCovariance[0][0],
        7,
      );
      expect(changed.phIdentity.global.statistic).toBeCloseTo(
        original.phIdentity.global.statistic,
        7,
      );
      expect(changed.phIdentity.global.pValue).toBeCloseTo(
        original.phIdentity.global.pValue,
        7,
      );
    }
  });
});
