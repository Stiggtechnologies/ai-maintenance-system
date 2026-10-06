import { describe, expect, it } from "vitest";
import reference from "./fixtures/cox-reference.json";
import rReference from "./fixtures/cox-r-reference.json";
import {
  analyseCoxSurvival,
  type CoxConditionalProfile,
} from "./cox-prediction";

const fixture = reference.cases[0];
const clusters = new Map(
  fixture.rows.map((row, i) => [row.subjectId, `asset-${Math.floor(i / 3)}`]),
);
const profile = (): CoxConditionalProfile => ({
  stratum: "A",
  originHours: 3,
  horizonHours: 12,
  path: [
    {
      startHours: 3,
      stopHours: 12,
      covariates: fixture.rows[1].covariates,
      observedAtHours: 0,
      availableAtHours: 0,
      validThroughHours: 22,
    },
  ],
});
function scenario(request: CoxConditionalProfile) {
  const result = analyseCoxSurvival(
    fixture.rows,
    fixture.covariateNames,
    clusters,
    request,
  );
  if (result.status !== "fitted") throw new Error(result.reason);
  if (!result.conditionalScenario)
    throw new Error("Expected retained scenario or explicit refusal.");
  return result.conditionalScenario;
}
describe("conditional Cox numerical scenarios, not live forecasts", () => {
  for (const [index, witness] of rReference.cases.entries()) {
    it(`matches actual R predict.coxph conditional hazards and survival: ${witness.name}`, () => {
      const input = reference.cases[index];
      const clusters = new Map(
        input.rows.map((row, i) => [
          row.subjectId,
          String(witness.assetClusters[i]),
        ]),
      );
      for (const scenario of witness.conditionalScenarios) {
        const fit = analyseCoxSurvival(
          input.rows,
          input.covariateNames,
          clusters,
          scenario.profile,
        );
        if (
          fit.status !== "fitted" ||
          fit.conditionalScenario?.status !== "estimated"
        )
          throw new Error(JSON.stringify(fit));
        expect(fit.conditionalScenario.cumulativeHazardIncrement).toBeCloseTo(
          scenario.expected.cumulativeHazardIncrement,
          7,
        );
        expect(
          fit.conditionalScenario.conditionalFailureProbability,
        ).toBeCloseTo(scenario.expected.conditionalFailureProbability, 7);
        expect(
          fit.conditionalScenario.conditionalSurvivalProbability,
        ).toBeCloseTo(scenario.expected.conditionalSurvivalProbability, 7);
        expect(fit.conditionalScenario.liveAssetForecast).toBe(false);
      }
    });
  }
  it("conditions on survival to origin using only post-origin baseline increments", () => {
    const result = scenario(profile());
    expect(result.status).toBe("estimated");
    if (result.status !== "estimated") throw new Error(result.reason);
    const expectedHazard =
      fixture.expected.baselineEfronPostEvent
        .filter((point) => point.stratum === "A" && point.time <= 12)
        .at(-1)!.cumulativeHazard -
      fixture.expected.baselineEfronPostEvent
        .filter((point) => point.stratum === "A" && point.time <= 3)
        .at(-1)!.cumulativeHazard;
    const lp = fixture.rows[1].covariates.reduce(
      (sum, x, j) => sum + x * fixture.expected.coefficients[j],
      0,
    );
    expect(result.cumulativeHazardIncrement).toBeCloseTo(
      expectedHazard * Math.exp(lp),
      7,
    );
    expect(result.conditionalFailureProbability).toBeCloseTo(
      -Math.expm1(-expectedHazard * Math.exp(lp)),
      7,
    );
    expect(result.authority).toBe("advisory_only");
    expect(result.calibration).toBe("unqualified");
    expect(result.liveAssetForecast).toBe(false);
    expect(result.confidenceInterval).toBeNull();
  });
  it("refuses malformed, unknown-stratum and out-of-support requests", () => {
    for (const mutate of [
      (x: CoxConditionalProfile) => {
        x.originHours = Number.NaN;
      },
      (x: CoxConditionalProfile) => {
        x.originHours = -1;
      },
      (x: CoxConditionalProfile) => {
        x.horizonHours = x.originHours;
      },
      (x: CoxConditionalProfile) => {
        x.horizonHours = 1000;
      },
      (x: CoxConditionalProfile) => {
        x.stratum = "unknown";
      },
      (x: CoxConditionalProfile) => {
        x.path = [];
      },
      (x: CoxConditionalProfile) => {
        x.path[0].covariates = [500, 0];
      },
      (x: CoxConditionalProfile) => {
        x.path[0].covariates = [];
      },
      (x: CoxConditionalProfile) => {
        x.path[0].startHours = 4;
      },
      (x: CoxConditionalProfile) => {
        x.path[0].stopHours = 11;
      },
    ]) {
      const x = profile();
      mutate(x);
      expect(scenario(x).status).toBe("refused");
    }
  });
  it("retains malformed runtime requests as scenario refusals without throwing or changing the fit", () => {
    const baseline = analyseCoxSurvival(
      fixture.rows,
      fixture.covariateNames,
      clusters,
    );
    if (baseline.status !== "fitted") throw new Error(baseline.reason);
    for (const request of [
      null,
      true,
      0,
      "profile",
      [],
      { refusal: 12 },
      { refusal: "" },
    ]) {
      const result = analyseCoxSurvival(
        fixture.rows,
        fixture.covariateNames,
        clusters,
        request as unknown as CoxConditionalProfile,
      );
      expect(result.status).toBe("fitted");
      if (result.status !== "fitted") throw new Error(result.reason);
      expect(result.conditionalScenario?.status).toBe("refused");
      expect(result.coefficients).toEqual(baseline.coefficients);
    }
  });
  it("refuses future-available and expired measurements, never inventing persistence", () => {
    for (const mutate of [
      (x: CoxConditionalProfile) => {
        x.path[0].availableAtHours = 4;
      },
      (x: CoxConditionalProfile) => {
        x.path[0].observedAtHours = 1;
        x.path[0].availableAtHours = 0;
      },
      (x: CoxConditionalProfile) => {
        x.path[0].validThroughHours = 11;
      },
    ]) {
      const x = profile();
      mutate(x);
      expect(scenario(x).status).toBe("refused");
    }
  });
  it("keeps conditional risk invariant under row ordering and large covariate offsets", () => {
    const original = scenario(profile());
    const offset = 1e6;
    const rows = fixture.rows
      .map((row) => ({
        ...row,
        covariates: [row.covariates[0] + offset, row.covariates[1]],
      }))
      .reverse();
    const request = profile();
    request.path[0].covariates = [
      request.path[0].covariates[0] + offset,
      request.path[0].covariates[1],
    ];
    const changed = analyseCoxSurvival(
      rows,
      fixture.covariateNames,
      clusters,
      request,
    );
    expect(changed.status).toBe("fitted");
    if (
      original.status !== "estimated" ||
      changed.status !== "fitted" ||
      changed.conditionalScenario?.status !== "estimated"
    )
      throw new Error(
        "Numerically centered conditional estimates are required.",
      );
    expect(
      changed.conditionalScenario.conditionalFailureProbability,
    ).toBeCloseTo(original.conditionalFailureProbability, 7);
  });
  it("adds explicit piecewise hazard increments and refuses gaps or future-available path changes", () => {
    const first = profile();
    first.horizonHours = 8;
    first.path[0].stopHours = 8;
    const second = profile();
    second.originHours = 8;
    second.path[0].startHours = 8;
    second.path[0].covariates = fixture.rows[4].covariates;
    const joint = profile();
    joint.path = [first.path[0], second.path[0]];
    const a = scenario(first),
      b = scenario(second),
      c = scenario(joint);
    if (
      a.status !== "estimated" ||
      b.status !== "estimated" ||
      c.status !== "estimated"
    )
      throw new Error("Expected explicit measured paths.");
    expect(c.cumulativeHazardIncrement).toBeCloseTo(
      a.cumulativeHazardIncrement + b.cumulativeHazardIncrement,
      12,
    );
    joint.path[1].availableAtHours = 8;
    expect(scenario(joint).status).toBe("refused");
    joint.path[1].availableAtHours = 0;
    joint.path[1].startHours = 9;
    expect(scenario(joint).status).toBe("refused");
  });
  it("discloses an event-free-window zero estimate without claiming failure is impossible", () => {
    const request = profile();
    request.originHours = 0.5;
    request.horizonHours = 1;
    request.path[0].startHours = 0.5;
    request.path[0].stopHours = 1;
    const result = scenario(request);
    expect(result.status).toBe("estimated");
    if (result.status !== "estimated") throw new Error(result.reason);
    expect(result.eventTimesInWindow).toBe(0);
    expect(result.conditionalFailureProbability).toBe(0);
    expect(result.limitations.join(" ")).toContain(
      "not proof that failure cannot occur",
    );
  });
});
