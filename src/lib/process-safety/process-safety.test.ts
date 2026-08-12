/**
 * Validation for process-safety analysis.
 *
 * PFD has an exact closed form, so the SIL tests are pinned to hand
 * arithmetic: λ_DU = 1e-6/h over a 12-month (8760 h) interval gives
 * PFD = 1e-6 × 8760 / 2 = 4.38e-3, which is SIL 2. Doubling the interval
 * doubles the PFD to 8.76e-3 — still SIL 2 — and tripling it crosses into
 * SIL 1. Those crossings are the whole point: an overdue proof test moves a
 * function between bands without anyone deciding to accept it.
 */
import { describe, expect, it } from "vitest";
import {
  silForPfd,
  verifySIF,
  assessAlarms,
  assessBarriers,
  type Barrier,
} from "./index";

describe("silForPfd — the IEC 61508 bands", () => {
  it("places each band correctly at its boundaries", () => {
    expect(silForPfd(5e-2)).toBe(1);
    expect(silForPfd(5e-3)).toBe(2);
    expect(silForPfd(5e-4)).toBe(3);
    expect(silForPfd(5e-5)).toBe(4);
    // Worse than SIL 1 is not a SIL at all.
    expect(silForPfd(0.5)).toBe(0);
  });
});

describe("verifySIF — 1oo1", () => {
  const BASE = {
    tag: "SIF-101",
    targetSil: 2 as const,
    lambdaDU: 1e-6,
    specifiedIntervalMonths: 12,
  };

  it("computes PFD as lambda x interval / 2, exactly", () => {
    const r = verifySIF({ ...BASE, monthsSinceLastTest: 12 });
    // 1e-6 x (12 x 730) / 2 = 1e-6 x 8760 / 2 = 4.38e-3
    expect(r.designPfd).toBeCloseTo(4.38e-3, 12);
    expect(r.designSil).toBe(2);
    expect(r.meetsTarget).toBe(true);
  });

  it("doubles the PFD when the test is twice as late", () => {
    const r = verifySIF({ ...BASE, monthsSinceLastTest: 24 });
    expect(r.achievedPfd).toBeCloseTo(8.76e-3, 12);
    expect(r.overdueMonths).toBe(12);
    // Still SIL 2 — the band is wide, and saying so is more honest than
    // claiming every overdue test is a SIL breach.
    expect(r.achievedSil).toBe(2);
    expect(r.meetsTarget).toBe(true);
    expect(r.reason).toMatch(/still within SIL 2/);
  });

  it("catches the crossing into a lower band and says nobody chose it", () => {
    // 1e-6 x (36 x 730) / 2 = 1.314e-2 -> SIL 1, below a SIL 2 target.
    const r = verifySIF({ ...BASE, monthsSinceLastTest: 36 });
    expect(r.achievedPfd).toBeCloseTo(1.314e-2, 12);
    expect(r.achievedSil).toBe(1);
    expect(r.degradedByOverdue).toBe(true);
    expect(r.meetsTarget).toBe(false);
    expect(r.reason).toMatch(/NO LONGER MEETS ITS TARGET/);
    expect(r.reason).toMatch(/happened by the test not being done/i);
  });

  it("flags a function that misses its target even when tested on time", () => {
    const r = verifySIF({
      tag: "SIF-202",
      targetSil: 3,
      lambdaDU: 1e-6,
      specifiedIntervalMonths: 12,
      monthsSinceLastTest: 6,
    });
    expect(r.designSil).toBe(2);
    expect(r.reason).toMatch(
      /does not meet its target even when tested on schedule/i,
    );
    expect(r.reason).toMatch(
      /design or interval problem, not a compliance one/i,
    );
  });

  it("REFUSES to treat an unknown test date as compliance", () => {
    const r = verifySIF({ ...BASE, monthsSinceLastTest: null });
    expect(r.achievedPfd).toBeNull();
    expect(r.reason).toMatch(/ACHIEVED integrity is unknown/);
    expect(r.reason).toMatch(/rests on the test actually happening/i);
  });
});

describe("verifySIF — redundancy and common cause", () => {
  it("shows the common-cause term dominating a 1oo2 arrangement", () => {
    const r = verifySIF({
      tag: "SIF-303",
      targetSil: 3,
      lambdaDU: 1e-6,
      specifiedIntervalMonths: 12,
      monthsSinceLastTest: 6,
      architecture: "1oo2",
      betaFactor: 0.1,
    });
    // lt = 8.76e-3. Independent: 0.9 x lt^2/3 = 2.30e-5.
    // Common cause:  0.1 x lt/2       = 4.38e-4  — nearly 20x larger.
    const lt = 1e-6 * 12 * 730;
    const independent = (0.9 * lt * lt) / 3;
    const commonCause = (0.1 * lt) / 2;
    expect(r.designPfd).toBeCloseTo(independent + commonCause, 12);
    expect(commonCause / independent).toBeGreaterThan(15);
    expect(r.reason).toMatch(/common-cause term is/);
    expect(r.reason).toMatch(/what redundancy does and does not buy/i);
  });

  it("beats the equivalent 1oo1 despite the common-cause penalty", () => {
    const common = {
      tag: "X",
      targetSil: 2 as const,
      lambdaDU: 1e-6,
      specifiedIntervalMonths: 12,
      monthsSinceLastTest: 6,
    };
    const single = verifySIF({ ...common, architecture: "1oo1" });
    const dual = verifySIF({
      ...common,
      architecture: "1oo2",
      betaFactor: 0.1,
    });
    expect(dual.designPfd).toBeLessThan(single.designPfd);
  });

  it("defaults a redundant architecture to a stated beta rather than zero", () => {
    // Assuming perfect independence is the optimistic error; 10% is the
    // conventional default and is applied rather than 0.
    const r = verifySIF({
      tag: "Y",
      targetSil: 2,
      lambdaDU: 1e-6,
      specifiedIntervalMonths: 12,
      architecture: "1oo2",
    });
    const lt = 1e-6 * 12 * 730;
    expect(r.designPfd).toBeGreaterThan((lt * lt) / 3);
  });
});

describe("assessAlarms against EEMUA 191", () => {
  it("accepts a rate inside the benchmark", () => {
    const r = assessAlarms({ operatorHours: 12, totalAlarms: 60 }); // 5/h
    expect(r.benchmark).toBe("acceptable");
    expect(r.findings).toEqual([]);
  });

  it("names the external benchmark rather than a local target", () => {
    const r = assessAlarms({ operatorHours: 12, totalAlarms: 240 }); // 20/h
    expect(r.benchmark).toBe("over_demanding");
    expect(r.reason).toMatch(/EEMUA 191/);
  });

  it("calls a ten-in-ten-minutes peak a flood", () => {
    const r = assessAlarms({
      operatorHours: 12,
      totalAlarms: 60,
      peakTenMinuteCount: 14,
    });
    expect(r.floodPeriod).toBe(true);
    expect(r.reason).toMatch(/stopped conveying information/i);
  });

  it("calls out standing alarms as furniture", () => {
    const r = assessAlarms({
      operatorHours: 12,
      totalAlarms: 60,
      standingAlarms: 25,
    });
    expect(r.reason).toMatch(/is furniture/);
  });

  it("flags a priority distribution where everything is urgent", () => {
    const r = assessAlarms({
      operatorHours: 12,
      totalAlarms: 100,
      highPriority: 40,
      mediumPriority: 30,
      lowPriority: 30,
    });
    expect(r.priorityDistribution?.high).toBeCloseTo(0.4, 12);
    expect(r.reason).toMatch(/When most things are urgent, nothing is/);
  });

  it("REFUSES to turn a raw count into a rate", () => {
    const r = assessAlarms({ operatorHours: 0, totalAlarms: 500 });
    expect(r.alarmsPerHour).toBeNull();
    expect(r.reason).toMatch(/A raw count says nothing/);
  });
});

describe("assessBarriers", () => {
  const std = (label: string, extra: Partial<Barrier> = {}): Barrier => ({
    id: label,
    label,
    kind: "instrumented",
    performanceStandardStated: true,
    impaired: false,
    ...extra,
  });

  it("does not count a barrier with no performance standard", () => {
    const r = assessBarriers({
      hazard: "Loss of containment",
      preventive: [
        std("High-level trip"),
        std("Operator response", { performanceStandardStated: false }),
      ],
      mitigative: [std("Bunding")],
    });
    expect(r.preventiveIntact).toBe(1);
    expect(r.withoutStandard).toEqual(["Operator response"]);
    expect(r.reason).toMatch(/1 barrier has no stated performance standard/);
    expect(r.reason).toMatch(/a barrier nobody can test is a claim/i);
  });

  it("does not count an impaired barrier", () => {
    const r = assessBarriers({
      hazard: "Overpressure",
      preventive: [std("PSV"), std("High-pressure trip", { impaired: true })],
      mitigative: [],
    });
    expect(r.preventiveIntact).toBe(1);
    expect(r.reason).toMatch(/1 impaired: High-pressure trip/);
  });

  it("finds barriers that cannot fail independently", () => {
    const r = assessBarriers({
      hazard: "Overpressure",
      preventive: [
        std("High-pressure trip", { commonCauseGroups: ["Instrument air"] }),
        std("Emergency shutdown valve", {
          commonCauseGroups: ["Instrument air"],
        }),
      ],
      mitigative: [std("PSV")],
    });
    expect(r.sharedCause).toHaveLength(1);
    expect(r.sharedCause[0].group).toBe("Instrument air");
    expect(r.reason).toMatch(/cannot fail independently/);
    expect(r.reason).toMatch(/overstates the defence/);
  });

  it("says plainly when nothing preventive is left standing", () => {
    const r = assessBarriers({
      hazard: "Overpressure",
      preventive: [std("Only trip", { impaired: true })],
      mitigative: [std("PSV")],
    });
    expect(r.preventiveIntact).toBe(0);
    expect(r.reason).toMatch(
      /NO verifiable, unimpaired preventive barrier remains/,
    );
  });
});
