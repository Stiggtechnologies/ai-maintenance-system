/**
 * Validation for model-risk analysis.
 *
 * Brier and PSI both have exact closed forms, so the numbers below are hand
 * arithmetic. The refusals matter more: a score with no recorded outcome is
 * unfalsifiable, and reporting a calibration figure from it would be the
 * single most misleading thing this module could do.
 */
import { describe, expect, it } from "vitest";
import {
  assessCalibration,
  populationStabilityIndex,
  reviewModelRegister,
  type Prediction,
} from "./index";

const NOW = new Date("2026-08-18T00:00:00Z");

/** n predictions all at `p`, of which `hits` came true. */
function block(p: number, n: number, hits: number): Prediction[] {
  return Array.from({ length: n }, (_, i) => ({
    predicted: p,
    outcome: i < hits,
  }));
}

describe("assessCalibration — the refusals", () => {
  it("REFUSES to score predictions with no recorded outcomes", () => {
    const r = assessCalibration(
      Array.from({ length: 500 }, () => ({ predicted: 0.3, outcome: null })),
    );
    expect(r.measurable).toBe(false);
    expect(r.brierScore).toBeNull();
    expect(r.reason).toMatch(/these scores are unfalsifiable/);
    expect(r.reason).toMatch(/not the same as being right/);
  });

  it("REFUSES a confident figure from too few outcomes", () => {
    const r = assessCalibration(block(0.5, 10, 5), 5, 30);
    expect(r.measurable).toBe(false);
    expect(r.withOutcome).toBe(10);
    expect(r.reason).toMatch(/noise with a decimal place/);
  });

  it("handles no predictions at all", () => {
    expect(assessCalibration([]).reason).toBe("No predictions are recorded.");
  });
});

describe("assessCalibration — the arithmetic", () => {
  it("computes the Brier score exactly", () => {
    // 50 at p=0.2 with 10 hits: 10 x (0.2-1)^2 + 40 x (0.2-0)^2
    //  = 10(0.64) + 40(0.04) = 6.4 + 1.6 = 8.0 over 50 = 0.16
    const r = assessCalibration(block(0.2, 50, 10));
    expect(r.brierScore).toBeCloseTo(0.16, 12);
    expect(r.baseRate).toBeCloseTo(0.2, 12);
  });

  it("scores a perfectly calibrated constant forecast as zero skill", () => {
    // Predicting the base rate exactly IS climatology, so skill is 0.
    const r = assessCalibration(block(0.2, 50, 10));
    expect(r.climatologyBrier).toBeCloseTo(0.16, 12);
    expect(r.skillScore).toBeCloseTo(0, 12);
    expect(r.reason).toMatch(/does NOT beat simply predicting the base rate/);
    expect(r.reason).toMatch(/add nothing over an average/);
  });

  it("rewards a forecast that separates the outcomes", () => {
    // 40 at p=0.9 all true, 40 at p=0.1 all false. Brier = 0.01.
    const r = assessCalibration([...block(0.9, 40, 40), ...block(0.1, 40, 0)]);
    expect(r.brierScore).toBeCloseTo(0.01, 12);
    expect(r.baseRate).toBeCloseTo(0.5, 12);
    expect(r.climatologyBrier).toBeCloseTo(0.25, 12);
    expect(r.skillScore).toBeCloseTo(0.96, 12);
    expect(r.reason).toMatch(/carry information beyond the average/);
  });

  it("names the worst-calibrated band and the direction of the error", () => {
    // 40 at p=0.9 but only 20% actually happen: over-confident by 70 points.
    const r = assessCalibration([...block(0.9, 40, 8), ...block(0.1, 40, 4)]);
    expect(r.reason).toMatch(/over-confident by 70 points/);
  });

  it("bins predictions and reports the observed rate in each", () => {
    const r = assessCalibration([...block(0.9, 40, 36), ...block(0.1, 40, 4)]);
    const hi = r.bins.find((b) => b.lower === 0.8);
    const lo = r.bins.find((b) => b.lower === 0);
    expect(hi?.observedRate).toBeCloseTo(0.9, 12);
    expect(lo?.observedRate).toBeCloseTo(0.1, 12);
    expect(hi?.gap).toBeCloseTo(0, 12);
  });

  it("says so when every outcome went the same way", () => {
    const r = assessCalibration(block(0.5, 40, 40));
    expect(r.skillScore).toBeNull();
    expect(r.reason).toMatch(
      /nothing for the model to have got right or wrong/,
    );
  });
});

describe("populationStabilityIndex", () => {
  it("is zero for identical distributions", () => {
    const d = { a: 50, b: 30, c: 20 };
    const r = populationStabilityIndex(d, { ...d });
    expect(r.psi).toBeCloseTo(0, 12);
    expect(r.band).toBe("none");
  });

  it("computes PSI exactly for a known shift", () => {
    // Reference 50/50, current 60/40.
    // (0.6-0.5)ln(0.6/0.5) + (0.4-0.5)ln(0.4/0.5)
    //  = 0.1(0.182322) + (-0.1)(-0.223144) = 0.0405466
    const r = populationStabilityIndex({ a: 50, b: 50 }, { a: 60, b: 40 });
    expect(r.psi).toBeCloseTo(0.0405466, 6);
    expect(r.band).toBe("none");
  });

  it("crosses into significant for a large shift", () => {
    const r = populationStabilityIndex({ a: 90, b: 10 }, { a: 40, b: 60 });
    expect(r.psi as number).toBeGreaterThan(0.25);
    expect(r.band).toBe("significant");
    expect(r.reason).toMatch(/being asked about a different one/);
  });

  it("presents the thresholds as convention rather than law", () => {
    const r = populationStabilityIndex({ a: 50, b: 50 }, { a: 55, b: 45 });
    expect(r.reason).toMatch(/industry convention rather than a theorem/);
  });

  it("does not hide a bucket that appears in only one population", () => {
    // 'c' is new. Dropping it would conceal exactly the shift PSI is for.
    const r = populationStabilityIndex(
      { a: 50, b: 50 },
      { a: 40, b: 40, c: 20 },
    );
    expect(r.contributions.some((c) => c.bucket === "c")).toBe(true);
    expect(r.psi as number).toBeGreaterThan(0.25);
  });

  it("REFUSES to measure drift from an empty population", () => {
    const r = populationStabilityIndex({}, { a: 10 });
    expect(r.psi).toBeNull();
    expect(r.reason).toMatch(/needs something to drift from/);
  });
});

describe("reviewModelRegister", () => {
  it("flags the combination that should not exist", () => {
    const r = reviewModelRegister(
      [
        {
          modelKey: "health-score",
          version: "2",
          approvedFor: ["ranking"],
          approvedOn: "2026-01-01",
          humanInLoop: true,
        },
        {
          modelKey: "auto-scheduler",
          version: "1",
          approvedFor: [],
          humanInLoop: false,
        },
      ],
      NOW,
    );
    expect(r.autonomousWithoutApproval).toEqual(["auto-scheduler@1"]);
    expect(r.reason).toMatch(/That combination should not exist/);
  });

  it("distinguishes unapproved-but-supervised from unapproved-and-autonomous", () => {
    const r = reviewModelRegister(
      [
        {
          modelKey: "draft-writer",
          version: "1",
          approvedFor: [],
          humanInLoop: true,
        },
      ],
      NOW,
    );
    expect(r.autonomousWithoutApproval).toEqual([]);
    expect(r.reason).toMatch(/nothing acts on an unapproved model unaided/);
  });

  it("calls an unrevisited approval one that is decaying", () => {
    const r = reviewModelRegister(
      [
        {
          modelKey: "risk-score",
          version: "3",
          approvedFor: ["ranking"],
          approvedOn: "2024-01-01",
          reviewDue: "2025-01-01",
          humanInLoop: true,
        },
      ],
      NOW,
    );
    expect(r.reviewOverdue).toEqual(["risk-score@3"]);
    expect(r.reason).toMatch(/decaying quietly/);
  });

  it("says plainly when nothing is registered", () => {
    expect(reviewModelRegister([], NOW).reason).toMatch(
      /cannot say what it is running/,
    );
  });
});
