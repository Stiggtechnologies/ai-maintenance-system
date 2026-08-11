import { describe, expect, it } from "vitest";
import { selectWeibullMethod } from "./method-selection";

/** The operator's 24H/M grader engine: 10 failures, 28 scheduled removals. */
const engineFailures = [
  96.09, 1478.64, 1663.24, 4297.92, 6510.8, 7105.18, 7508.17, 9093.58, 11540.0,
  13225.84,
];
const engineSuspensions = [
  4253.98, 6875.77, 9308.35, 10938.5, 11019.88, 11134.84, 11767.23, 11953.62,
  12113.26, 12159.66, 12178.3, 12278.61, 12462.35, 12979.03, 13019.32, 13716.97,
  14070.16, 14154.9, 14276.69, 14746.57, 14781.51, 15037.57, 15088.47, 15491.7,
  15637.57, 15882.19, 15930.19, 16432.83,
];

describe("selectWeibullMethod — the rule decides, not the analyst", () => {
  it("honours suspensions as suspensions and says why that is not a preference", () => {
    const r = selectWeibullMethod(engineFailures, engineSuspensions);
    expect(r.method).toBe("mle_censored");
    expect(r.suspensions).toBe(28);
    expect(r.reason).toMatch(
      /would not be a different opinion, it would be wrong/,
    );
  });

  it("prefers MLE over rank regression under heavy censoring", () => {
    const r = selectWeibullMethod(engineFailures, engineSuspensions);
    // 74% censored: well past the point where rank adjustment error dominates.
    expect(r.suspendedFraction).toBeCloseTo(28 / 38, 3);
    expect(r.ruleApplied).toMatch(/heavily censored/);
  });

  it("warns that a small failure count biases MLE beta high", () => {
    const r = selectWeibullMethod(engineFailures, engineSuspensions);
    expect(r.failures).toBe(10);
    expect(r.reason).toMatch(/bias beta HIGH/);
    expect(r.reason).toMatch(/upper estimate/);
  });

  it("flags the mixed population, which outranks the estimator choice", () => {
    const r = selectWeibullMethod(engineFailures, engineSuspensions);
    // Failures at 96h and 1479h against a cluster near 10,000h.
    expect(r.modelWarning).toMatch(/two populations/);
    expect(r.modelWarning).toMatch(/which wrong answer to publish/);
  });

  it("uses rank regression on a small uncensored sample", () => {
    const r = selectWeibullMethod([1000, 1200, 1500, 1800, 2100]);
    expect(r.method).toBe("rank_regression");
    expect(r.ruleApplied).toMatch(/fewer than 15 failures/);
    expect(r.reason).toMatch(/biases beta high on small samples/);
  });

  it("uses MLE on a larger uncensored sample", () => {
    const many = Array.from({ length: 20 }, (_, i) => 1000 + i * 137);
    const r = selectWeibullMethod(many);
    expect(r.method).toBe("mle");
    expect(r.ruleApplied).toMatch(/at least 15 failures/);
  });

  it("refuses below two failures rather than drawing a line through a point", () => {
    const r = selectWeibullMethod([5000], [1, 2, 3]);
    expect(r.method).toBe("none");
    expect(r.beta).toBeNull();
    expect(r.reason).toMatch(/a drawing rather than an estimate/);
    // Suspensions are acknowledged rather than ignored.
    expect(r.reason).toMatch(/bound life from below/);
  });

  it("gives one answer, never a menu", () => {
    const r = selectWeibullMethod(engineFailures, engineSuspensions);
    expect(typeof r.beta).toBe("number");
    expect(r.method).not.toBe("none");
    // The clause that fired is named, so the choice is auditable.
    expect(r.ruleApplied.length).toBeGreaterThan(0);
  });
});
