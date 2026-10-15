import { describe, expect, it } from "vitest";
import {
  plannedRemovalRecodingSensitivity,
  weibullBetaLikelihoodRatioBounds,
  type RemovalRecord,
} from "./life-data-sensitivity";

/**
 * Synthetic engine removals (38 rows: 9 failures, 29 planned removals) from the
 * "Your Weibull Is Measuring Your PM Policy" reproduction package. The true
 * shape is 1. Reference values below come from that package's Python script
 * (scipy), so this is an independent check of the TypeScript implementation.
 */
const SYNTHETIC: RemovalRecord[] = [
  { ageHours: 951.3, failed: true },
  { ageHours: 3468.5, failed: true },
  { ageHours: 5295.7, failed: true },
  { ageHours: 5955.0, failed: false },
  { ageHours: 6734.7, failed: false },
  { ageHours: 6919.8, failed: true },
  { ageHours: 8198.2, failed: false },
  { ageHours: 8427.0, failed: true },
  { ageHours: 8455.5, failed: true },
  { ageHours: 8672.5, failed: false },
  { ageHours: 9358.7, failed: false },
  { ageHours: 10706.8, failed: true },
  { ageHours: 11169.5, failed: false },
  { ageHours: 11320.7, failed: false },
  { ageHours: 11629.9, failed: false },
  { ageHours: 11649.0, failed: false },
  { ageHours: 11704.6, failed: false },
  { ageHours: 11918.4, failed: false },
  { ageHours: 12099.5, failed: false },
  { ageHours: 12248.0, failed: false },
  { ageHours: 12497.3, failed: false },
  { ageHours: 12585.8, failed: false },
  { ageHours: 12590.7, failed: true },
  { ageHours: 13246.9, failed: false },
  { ageHours: 13362.6, failed: true },
  { ageHours: 13438.8, failed: false },
  { ageHours: 13524.0, failed: false },
  { ageHours: 13567.0, failed: false },
  { ageHours: 13755.7, failed: false },
  { ageHours: 14044.7, failed: false },
  { ageHours: 14108.8, failed: false },
  { ageHours: 14466.6, failed: false },
  { ageHours: 14640.5, failed: false },
  { ageHours: 14653.7, failed: false },
  { ageHours: 15169.5, failed: false },
  { ageHours: 15577.4, failed: false },
  { ageHours: 15722.3, failed: false },
  { ageHours: 16097.2, failed: false },
];

const failures = SYNTHETIC.filter((r) => r.failed).map((r) => r.ageHours);
const censored = SYNTHETIC.filter((r) => !r.failed).map((r) => r.ageHours);

describe("weibullBetaLikelihoodRatioBounds", () => {
  it("matches the independent reference fit and 90% interval", () => {
    const b = weibullBetaLikelihoodRatioBounds(failures, censored, 0.9);
    expect(SYNTHETIC).toHaveLength(38);
    expect(b.failures).toBe(9);
    expect(b.censored).toBe(29);
    expect(b.beta.estimate).toBeCloseTo(1.47, 2);
    expect(b.beta.lower).toBeCloseTo(0.83, 1);
    expect(b.beta.upper).toBeCloseTo(2.36, 1);
    expect(Math.round(b.eta / 10) * 10).toBeCloseTo(30810, -2);
  });

  it("reports an undecided pattern, not wear-out, when the interval spans 1", () => {
    const b = weibullBetaLikelihoodRatioBounds(failures, censored, 0.9);
    expect(b.wearOutDemonstrated).toBe(false);
    expect(b.patternUndecided).toBe(true);
    expect(b.caution).toMatch(/non-informative censoring/);
  });

  it("widens as confidence rises", () => {
    const a = weibullBetaLikelihoodRatioBounds(failures, censored, 0.8);
    const c = weibullBetaLikelihoodRatioBounds(failures, censored, 0.95);
    expect(c.beta.upper! - c.beta.lower!).toBeGreaterThan(
      a.beta.upper! - a.beta.lower!,
    );
  });

  it("the estimate lies inside its own interval", () => {
    const b = weibullBetaLikelihoodRatioBounds(failures, censored, 0.9);
    expect(b.beta.lower!).toBeLessThan(b.beta.estimate);
    expect(b.beta.upper!).toBeGreaterThan(b.beta.estimate);
  });

  it("refuses fewer than two distinct failure times", () => {
    expect(() => weibullBetaLikelihoodRatioBounds([100], [200, 300])).toThrow(
      /at least 2 distinct failure times/,
    );
    expect(() =>
      weibullBetaLikelihoodRatioBounds([100, 100], [200, 300]),
    ).toThrow(/at least 2 distinct failure times/);
  });

  it("refuses an out-of-range confidence", () => {
    expect(() =>
      weibullBetaLikelihoodRatioBounds(failures, censored, 1),
    ).toThrow(/strictly between 0 and 1/);
    expect(() =>
      weibullBetaLikelihoodRatioBounds(failures, censored, 0),
    ).toThrow(/strictly between 0 and 1/);
  });

  it("ignores non-positive ages instead of fitting them", () => {
    const clean = weibullBetaLikelihoodRatioBounds(failures, censored, 0.9);
    const dirty = weibullBetaLikelihoodRatioBounds(
      [...failures, 0, -5],
      [...censored, 0],
      0.9,
    );
    expect(dirty.beta.estimate).toBeCloseTo(clean.beta.estimate, 6);
    expect(dirty.failures).toBe(9);
  });
});

describe("plannedRemovalRecodingSensitivity", () => {
  const s = plannedRemovalRecodingSensitivity(SYNTHETIC, 0.9);

  it("starts from the recorded data", () => {
    expect(s.steps[0].recoded).toBe(0);
    expect(s.steps[0].beta).toBeCloseTo(1.47, 2);
    expect(s.censoredAvailable).toBe(29);
  });

  it("finds the reference tipping point: 5 earliest planned removals", () => {
    expect(s.tippingRecoded).toBe(5);
    const step4 = s.steps.find((x) => x.recoded === 4)!;
    const step5 = s.steps.find((x) => x.recoded === 5)!;
    expect(step4.lower!).toBeCloseTo(0.98, 1);
    expect(step4.wearOutDemonstrated).toBe(false);
    expect(step5.lower!).toBeCloseTo(1.04, 1);
    expect(step5.wearOutDemonstrated).toBe(true);
    expect(s.summary).toMatch(/5 earliest planned removals/);
  });

  it("recoding every removal reproduces the all-failures fit (beta near 3.8)", () => {
    const last = s.steps[s.steps.length - 1];
    expect(last.recoded).toBe(29);
    expect(last.beta).toBeCloseTo(3.8, 1);
  });

  it("does not mutate its input or change recorded event types", () => {
    const copy = JSON.parse(JSON.stringify(SYNTHETIC));
    plannedRemovalRecodingSensitivity(SYNTHETIC, 0.9);
    expect(SYNTHETIC).toEqual(copy);
    expect(s.caution).toMatch(/does not claim/);
  });

  it("says when the recorded data already clears 1", () => {
    const wear: RemovalRecord[] = [
      ...[5000, 5200, 5400, 5600, 5800, 6000, 6100, 6300, 6500, 6700].map(
        (a) => ({ ageHours: a, failed: true }),
      ),
      { ageHours: 3000, failed: false },
    ];
    const r = plannedRemovalRecodingSensitivity(wear, 0.9);
    expect(r.tippingRecoded).toBe(0);
    expect(r.summary).toMatch(/already clears 1/);
  });

  it("says when the interval never clears 1", () => {
    const flat: RemovalRecord[] = [
      ...[120, 900, 2100, 4800, 300, 7600, 1500, 400].map((a) => ({
        ageHours: a,
        failed: true,
      })),
      { ageHours: 100, failed: false },
    ];
    const r = plannedRemovalRecodingSensitivity(flat, 0.9);
    expect(r.tippingRecoded).toBeNull();
    expect(r.summary).toMatch(/does not clear 1 even if every/);
  });

  it("throws when the recorded data cannot be fitted", () => {
    expect(() =>
      plannedRemovalRecodingSensitivity([
        { ageHours: 100, failed: true },
        { ageHours: 200, failed: false },
      ]),
    ).toThrow(/at least 2 distinct failure times/);
  });
});
