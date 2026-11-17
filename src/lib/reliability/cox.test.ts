import { describe, expect, it } from "vitest";
import reference from "./fixtures/cox-reference.json";
import { fitCox, type CoxInterval } from "./cox";

describe("Cox proportional hazards numerical qualification", () => {
  it("retains the actual independent reference and synthetic-data provenance", () => {
    expect(reference.provenance.statsmodels).toBe("0.14.6");
    expect(reference.provenance.missing).toBe("raise");
    expect(reference.provenance.ties).toBe("efron");
    expect(reference.provenance.data).toContain("Entirely synthetic");
  });
  for (const fixture of reference.cases) {
    it(`matches independent PHReg Efron witness: ${fixture.name}`, () => {
      const result = fitCox(fixture.rows, fixture.covariateNames);
      expect(result.status).toBe("fitted");
      if (result.status !== "fitted") throw new Error(result.reason);
      fixture.expected.coefficients.forEach((value, i) => {
        expect(result.coefficients[i]).toBeCloseTo(value, 7);
        fixture.expected.covariance[i].forEach((cell, j) => {
          expect(result.covariance[i][j]).toBeCloseTo(cell, 7);
        });
      });
      expect(result.logLikelihood).toBeCloseTo(
        fixture.expected.logLikelihood,
        7,
      );
      expect(result.baseline).toHaveLength(
        fixture.expected.baselineEfronPostEvent.length,
      );
      fixture.expected.baselineEfronPostEvent.forEach((row, i) => {
        expect(result.baseline[i].stratum).toBe(row.stratum);
        expect(result.baseline[i].time).toBe(row.time);
        expect(result.baseline[i].cumulativeHazard).toBeCloseTo(
          row.cumulativeHazard,
          7,
        );
      });
      expect(result.authority).toBe("advisory_only");
      expect(result.phAssumptionValidated).toBe(false);
    });
  }

  const input = (): CoxInterval[] => structuredClone(reference.cases[0].rows);
  const refuse = (rows: CoxInterval[], expected: string) => {
    const result = fitCox(rows, reference.cases[0].covariateNames);
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.code).toBe(expected);
  };
  it("never silently drops missing or non-finite observations", () => {
    const rows = input();
    rows[0].covariates[0] = Number.NaN;
    refuse(rows, "invalid_input");
    rows[0].covariates = [];
    refuse(rows, "invalid_input");
  });
  it("refuses outcome leakage and malformed exposure intervals", () => {
    const rows = input();
    rows[0].observedAt = rows[0].stop;
    refuse(rows, "invalid_input");
    rows[0].observedAt = 0;
    rows[0].start = rows[0].stop;
    refuse(rows, "invalid_input");
  });
  it("refuses duplicate identities and overlapping physical lives", () => {
    const rows = input();
    rows[1].id = rows[0].id;
    refuse(rows, "invalid_input");
    rows[1].id = "different";
    rows[1].subjectId = rows[0].subjectId;
    refuse(rows, "invalid_input");
  });
  it("refuses malformed runtime payloads rather than crashing or imputing", () => {
    refuse([null] as unknown as CoxInterval[], "invalid_input");
    const rows = input();
    rows[0].covariates = null as unknown as number[];
    refuse(rows, "invalid_input");
  });
  it("refuses gaps, post-failure intervals and unestimable strata", () => {
    const rows = structuredClone(reference.cases[2].rows);
    const index = rows.findIndex((row) => row.start > 0);
    rows[index].start += 0.5;
    refuse(rows, "invalid_input");
    const source = input();
    source.push({
      ...source[0],
      id: "post-failure",
      start: source[0].stop,
      stop: source[0].stop + 1,
    });
    source[0].failed = true;
    refuse(source, "invalid_input");
    refuse(
      input().map((row) => ({
        ...row,
        stratum: row.failed ? "failure" : "no-failure",
      })),
      "not_identifiable",
    );
  });
  it("refuses no-failure, constant and collinear data", () => {
    refuse(
      input().map((row) => ({ ...row, failed: false })),
      "not_identifiable",
    );
    refuse(
      input().map((row) => ({ ...row, covariates: [1, 1] })),
      "not_identifiable",
    );
    refuse(
      input().map((row) => ({
        ...row,
        covariates: [row.covariates[0], row.covariates[0]],
      })),
      "not_identifiable",
    );
  });
  it("refuses separation rather than returning apparently certain infinite effects", () => {
    const rows = input().map((row, i) => ({
      ...row,
      stop: i + 1,
      failed: true,
      covariates: [i, i * i],
    }));
    const result = fitCox(rows, ["order", "squared_order"]);
    expect(result.status).toBe("refused");
  });
  it("preserves the estimate under reorder and covariate unit changes", () => {
    const original = fitCox(input(), reference.cases[0].covariateNames);
    const transformed = fitCox(
      input()
        .reverse()
        .map((row) => ({
          ...row,
          covariates: [row.covariates[0] * 1000 + 700, row.covariates[1]],
        })),
      reference.cases[0].covariateNames,
    );
    expect(original.status).toBe("fitted");
    expect(transformed.status).toBe("fitted");
    if (original.status === "fitted" && transformed.status === "fitted") {
      expect(transformed.coefficients[0] * 1000).toBeCloseTo(
        original.coefficients[0],
        7,
      );
      expect(transformed.coefficients[1]).toBeCloseTo(
        original.coefficients[1],
        7,
      );
      expect(transformed.logLikelihood).toBeCloseTo(original.logLikelihood, 7);
    }
  });
});
