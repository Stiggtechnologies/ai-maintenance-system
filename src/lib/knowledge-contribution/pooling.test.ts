import { describe, expect, it } from "vitest";
import {
  poolEstimates,
  recomputeWithout,
  type ParameterEstimate,
} from "./pooling";

const est = (
  id: number,
  org: string,
  value: number,
  standardError: number,
  failureEvents = 50,
): ParameterEstimate => ({
  contributionId: id,
  organizationId: org,
  value,
  standardError,
  failureEvents,
});

describe("poolEstimates — validated against the closed form", () => {
  it("reproduces the inverse-variance weighted mean on the log scale", () => {
    // Two fits, one twice as precise as the other. Hand-computable.
    //   y = [ln 2, ln 3]; se(ln x) = se/x = [0.1/2, 0.2/3]
    //   w = 1/se²; pooled y = Σwy/Σw
    const a = est(1, "orgA", 2, 0.1);
    const b = est(2, "orgB", 3, 0.2);
    const r = poolEstimates([a, b]);

    const seA = 0.1 / 2;
    const seB = 0.2 / 3;
    const wA = 1 / seA ** 2;
    const wB = 1 / seB ** 2;
    const expected = Math.exp(
      (wA * Math.log(2) + wB * Math.log(3)) / (wA + wB),
    );
    expect(r.fixedEffect).toBeCloseTo(expected, 12);
  });

  it("lets the more precise fit dominate, which an average would not", () => {
    // 200 failures vs 12: the pooled value must sit far nearer the precise one.
    const precise = est(1, "orgA", 1.5, 0.05, 200);
    const vague = est(2, "orgB", 3.0, 0.9, 12);
    const r = poolEstimates([precise, vague]);
    const arithmeticMean = (1.5 + 3.0) / 2;

    expect(r.fixedEffect!).toBeLessThan(1.8);
    expect(r.fixedEffect!).toBeLessThan(arithmeticMean);
    expect(r.reason).toMatch(/which an average would not do/);
  });

  it("returns the common value when every fit agrees", () => {
    const r = poolEstimates([
      est(1, "a", 2, 0.1),
      est(2, "b", 2, 0.1),
      est(3, "c", 2, 0.1),
    ]);
    expect(r.fixedEffect).toBeCloseTo(2, 12);
    // Perfect agreement means no heterogeneity and no reason for random effects.
    expect(r.iSquared).toBe(0);
    expect(r.recommended).toBe("fixed");
  });

  it("narrows the interval as fits are added", () => {
    const two = poolEstimates([est(1, "a", 2, 0.1), est(2, "b", 2, 0.1)]);
    const four = poolEstimates([
      est(1, "a", 2, 0.1),
      est(2, "b", 2, 0.1),
      est(3, "c", 2, 0.1),
      est(4, "d", 2, 0.1),
    ]);
    expect(four.standardError!).toBeLessThan(two.standardError!);
  });

  it("switches to random effects when fleets genuinely differ", () => {
    // beta 1.1 (infant mortality) and 3.4 (wear-out), both tightly estimated.
    // These are not the same population and a single number would say they are.
    const r = poolEstimates([
      est(1, "a", 1.1, 0.03, 300),
      est(2, "b", 3.4, 0.05, 280),
    ]);
    expect(r.iSquared!).toBeGreaterThan(0.9);
    expect(r.recommended).toBe("random");
    expect(r.reason).toMatch(/real difference rather than sampling error/);
    // The honest consequence: a wider interval.
    expect(r.ci95![1] - r.ci95![0]).toBeGreaterThan(1);
  });

  it("refuses a contribution with no standard error rather than assuming one", () => {
    const r = poolEstimates([
      est(1, "a", 2, 0.1),
      est(2, "b", 2, 0.1),
      { ...est(3, "c", 2, 0), standardError: 0 },
    ]);
    expect(r.poolable).toBe(true);
    expect(r.contributingIds).toEqual([1, 2]);
    expect(r.excluded[0].contributionId).toBe(3);
    expect(r.excluded[0].why).toMatch(/same authority as a measured one/);
  });

  it("refuses to publish a pool of one", () => {
    const r = poolEstimates([est(1, "a", 2, 0.1)]);
    expect(r.poolable).toBe(false);
    expect(r.reason).toMatch(
      /single tenant's fit wearing the word "benchmark"/,
    );
  });

  it("does not read an all-excluded pool as an empty one", () => {
    const r = poolEstimates([
      { ...est(1, "a", 2, 0.1), standardError: 0 },
      { ...est(2, "b", -1, 0.1) },
    ]);
    expect(r.poolable).toBe(false);
    expect(r.excluded).toHaveLength(2);
    expect(r.reason).toMatch(/not an empty pool/);
  });
});

describe("recomputeWithout — a withdrawal is a re-weight, not a dead end", () => {
  const pool = [
    est(1, "a", 1.8, 0.08, 120),
    est(2, "b", 1.9, 0.07, 140),
    est(3, "c", 2.0, 0.09, 110),
    est(4, "d", 1.85, 0.08, 130),
  ];

  it("republishes when the remainder still clears the gate", () => {
    const r = recomputeWithout(pool, [3], 3, 200);
    expect(r.survivesWithdrawal).toBe(true);
    expect(r.pooled.contributingIds).toEqual([1, 2, 4]);
    expect(r.reason).toMatch(/republished rather than withheld/);
  });

  it("changes the answer — the withdrawn fit no longer counts", () => {
    const before = poolEstimates(pool);
    const after = recomputeWithout(pool, [3], 3, 200);
    expect(after.pooled.fixedEffect).not.toBe(before.fixedEffect);
    expect(after.pooled.totalFailureEvents).toBe(390);
  });

  it("withholds on the threshold, and says it will come back", () => {
    // One withdraws, leaving three against a floor of four. Still perfectly
    // poolable — it is the GATE that withholds it, not the withdrawal, and the
    // distinction is the whole point: the benchmark returns on its own when a
    // fourth contributor joins.
    const r = recomputeWithout(pool, [3], 4, 200);
    expect(r.pooled.poolable).toBe(true);
    expect(r.survivesWithdrawal).toBe(false);
    expect(r.reason).toMatch(
      /threshold decision rather than a dead end: it republishes on its own once another contributor joins/,
    );
  });

  it("reports an unpoolable remainder differently from a sub-threshold one", () => {
    // Three of four withdraw, leaving one. That is not a threshold problem —
    // there is no pool at all — and the two must not read alike.
    const r = recomputeWithout(pool, [2, 3, 4], 3, 200);
    expect(r.survivesWithdrawal).toBe(false);
    expect(r.pooled.poolable).toBe(false);
    expect(r.reason).toMatch(/Cannot recompute/);
  });

  it("is unaffected by withdrawing a contribution that was never in the pool", () => {
    const r = recomputeWithout(pool, [999], 3, 200);
    expect(r.survivesWithdrawal).toBe(true);
    expect(r.pooled.contributingIds).toEqual([1, 2, 3, 4]);
  });
});
