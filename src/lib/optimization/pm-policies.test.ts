import { describe, expect, it } from "vitest";
import {
  ageAtWeibullFailureRate,
  hasPmCostEvidence,
  opportunisticAgeThreshold,
  optimizePmPolicies,
  pmIntervalWriteAllowed,
  weibullFailureRate,
  type PmComponentInput,
} from "./pm-policies";

const BASIS =
  "Recorded planned-task and failure-consequence costs from the maintenance programme.";

function component(
  overrides: Partial<PmComponentInput> & Pick<PmComponentInput, "key">,
): PmComponentInput {
  return {
    label: overrides.key,
    method: "mle",
    failures: 20,
    suspensions: 0,
    beta: 3,
    eta: 1000,
    eventIds: [1, 2],
    planVersion: 1,
    plannedItemCost: 200,
    failureCost: 8000,
    costBasis: BASIS,
    safetyCritical: false,
    regulatoryRequired: false,
    ageHours: null,
    ...overrides,
  };
}

describe("Weibull hazard inversion", () => {
  it("inverts h(t) = (β/η) (t/η)^(β−1) exactly", () => {
    const fit = { beta: 2, eta: 1000 };
    expect(weibullFailureRate(fit, 1000)).toBeCloseTo(0.002, 12);
    expect(ageAtWeibullFailureRate(fit, 0.002)).toBeCloseTo(1000, 6);
  });

  it("refuses a non-increasing hazard", () => {
    expect(ageAtWeibullFailureRate({ beta: 1, eta: 1000 }, 0.001)).toBeNull();
    expect(ageAtWeibullFailureRate({ beta: 0.8, eta: 1000 }, 0.001)).toBeNull();
  });
});

describe("C7.08 preventive-maintenance policies", () => {
  it("refuses missing costs and does not invent an interval", () => {
    const result = optimizePmPolicies(
      [
        component({
          key: "pump",
          plannedItemCost: null,
          failureCost: null,
          costBasis: null,
        }),
      ],
      null,
    );
    expect(result.selected).toBe("evidence_gap");
    expect(result.components[0]?.standingIntervalHours).toBeNull();
    expect(result.components[0]?.blockReplacement.recommended).toBe(false);
    expect(result.opportunistic.applicable).toBe(false);
    expect(result.mayChangePmInterval).toBe(false);
    expect(
      hasPmCostEvidence(component({ key: "pump", costBasis: "too short" })),
    ).toBe(false);
  });

  it("refuses block replacement and preventive grouping when beta is not increasing", () => {
    const result = optimizePmPolicies(
      [
        component({ key: "a", beta: 0.9 }),
        component({ key: "b", beta: 1, eta: 800 }),
      ],
      {
        sharedAccessCost: 5000,
        accessExcludedFromTaskCosts: true,
      },
    );
    expect(
      result.components.every(
        (item) => item.blockReplacement.recommended === false,
      ),
    ).toBe(true);
    expect(result.commonBlock.recommended).toBe(false);
    expect(
      result.components.every((item) => item.standingIntervalHours == null),
    ).toBe(true);
    expect(result.opportunistic.applicable).toBe(false);
  });

  it("reports a block premium and does not select block over age without a shared-access saving", () => {
    const result = optimizePmPolicies(
      [component({ key: "bearing" }), component({ key: "seal", eta: 1400 })],
      null,
    );
    expect(result.selected).toBe("separate_age");
    expect(result.commonBlock.recommended).toBe(false);
    expect(result.opportunistic.applicable).toBe(false);
    for (const item of result.components) {
      expect(item.blockReplacement.recommended).toBe(true);
      expect(item.blockReplacement.premiumOverAgePct).not.toBeNull();
      expect(item.blockReplacement.premiumOverAgePct!).toBeGreaterThanOrEqual(
        0,
      );
      expect(item.standingIntervalHours).toBe(item.ageReplacement.optimalAge);
      expect(item.applyInterval).toBe(true);
    }
    expect(result.limitations.join(" ")).toMatch(
      /No shared-access saving is claimed/,
    );
  });

  it("selects a common block when one recorded access cost beats paying it twice", () => {
    const result = optimizePmPolicies(
      [component({ key: "bearing" }), component({ key: "seal" })],
      { sharedAccessCost: 20000, accessExcludedFromTaskCosts: true },
    );
    expect(result.selected).toBe("common_block");
    expect(result.commonBlock.recommended).toBe(true);
    expect(result.commonBlock.intervalHours).toBeGreaterThan(0);
    expect(result.commonBlock.memberKeys).toEqual(["bearing", "seal"]);
    expect(result.commonBlock.premiumOverSeparateAgePct).toBeLessThan(0);
    expect(
      result.components.every(
        (item) =>
          item.standingIntervalHours === result.commonBlock.intervalHours,
      ),
    ).toBe(true);
    expect(result.opportunistic.applicable).toBe(true);
    expect(result.recommendation.humanApprovalRequired).toBe(true);
  });

  it("prices the opportunistic threshold from the dedicated cost rate and current age", () => {
    const fit = { beta: 3, eta: 1000, failures: 20 };
    const dedicated = { plannedCost: 5200, failureCost: 13000 };
    const threshold = opportunisticAgeThreshold(fit, dedicated, 200);
    expect(threshold).not.toBeNull();
    const hazard = threshold!.costRate / (13000 - 200);
    expect(ageAtWeibullFailureRate(fit, hazard)).toBeCloseTo(
      threshold!.thresholdAge,
      4,
    );
    expect(threshold!.thresholdAge).toBeLessThan(threshold!.preventiveAge);

    const open = optimizePmPolicies(
      [
        component({
          key: "bearing",
          ageHours: (threshold!.thresholdAge + threshold!.preventiveAge) / 2,
        }),
      ],
      { sharedAccessCost: 5000, accessExcludedFromTaskCosts: true },
    );
    expect(open.components[0]?.opportunistic.includeOnOpenAccess).toBe(true);

    const early = optimizePmPolicies(
      [component({ key: "bearing", ageHours: 1 })],
      { sharedAccessCost: 5000, accessExcludedFromTaskCosts: true },
    );
    expect(early.components[0]?.opportunistic.includeOnOpenAccess).toBe(false);

    const unknown = optimizePmPolicies(
      [component({ key: "bearing", ageHours: null })],
      { sharedAccessCost: 5000, accessExcludedFromTaskCosts: true },
    );
    expect(unknown.components[0]?.opportunistic.includeOnOpenAccess).toBeNull();
  });

  it("keeps a safety-unknown component off a shared interval and off interval rewrite", () => {
    const result = optimizePmPolicies(
      [
        component({
          key: "guarded",
          safetyCritical: null,
          regulatoryRequired: false,
        }),
        component({ key: "plain" }),
      ],
      { sharedAccessCost: 20000, accessExcludedFromTaskCosts: true },
    );
    expect(
      pmIntervalWriteAllowed(
        component({ key: "guarded", safetyCritical: null }),
      ),
    ).toBe(false);
    expect(result.commonBlock.recommended).toBe(false);
    expect(result.commonBlock.memberKeys).not.toContain("guarded");
    const guarded = result.components.find((item) => item.key === "guarded");
    expect(guarded?.applyInterval).toBe(false);
    expect(result.refusals.join(" ")).toMatch(
      /safety-critical or regulatory applicability is true or unknown/,
    );
  });

  it("does not claim an access saving when the human says task costs already include it", () => {
    const result = optimizePmPolicies(
      [component({ key: "bearing" }), component({ key: "seal" })],
      { sharedAccessCost: 20000, accessExcludedFromTaskCosts: false },
    );
    expect(result.opportunistic.applicable).toBe(false);
    expect(result.selected).not.toBe("common_block");
    expect(result.limitations.join(" ")).toMatch(
      /No shared-access saving is claimed/,
    );
  });
});
