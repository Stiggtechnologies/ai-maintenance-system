/**
 * Validation suite for the deterministic reliability engine (register C7.01,
 * C7.03, C7.04, C7.11). Approach: analytic identities and exact small-sample
 * MLE hand-cases, plus seeded-sample parameter recovery — the "validated
 * code, not plausible equations" evidence the spec demands.
 */
import { describe, expect, it } from "vitest";
import { crowAMSAA, pareto, repairableSummary, weibullMLE } from "./index";

/** Deterministic LCG so sampled validations are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
}

function weibullSample(
  beta: number,
  eta: number,
  n: number,
  seed: number,
): number[] {
  const rnd = lcg(seed);
  return Array.from(
    { length: n },
    () => eta * Math.pow(-Math.log(1 - rnd()), 1 / beta),
  );
}

describe("weibullMLE", () => {
  it("recovers known parameters from a seeded wear-out sample (beta=2.5, eta=1000)", () => {
    const fit = weibullMLE(weibullSample(2.5, 1000, 800, 42));
    expect(fit.converged).toBe(true);
    expect(fit.beta).toBeGreaterThan(2.3);
    expect(fit.beta).toBeLessThan(2.7);
    expect(fit.eta).toBeGreaterThan(950);
    expect(fit.eta).toBeLessThan(1050);
  });

  it("recovers infant-mortality shape (beta=0.6)", () => {
    const fit = weibullMLE(weibullSample(0.6, 500, 800, 7));
    expect(fit.beta).toBeGreaterThan(0.54);
    expect(fit.beta).toBeLessThan(0.66);
  });

  it("reduces to the exponential MLE for beta≈1 data: eta ≈ total time / failures", () => {
    const sample = weibullSample(1.0, 300, 1200, 99);
    const fit = weibullMLE(sample);
    expect(fit.beta).toBeGreaterThan(0.93);
    expect(fit.beta).toBeLessThan(1.07);
    const exponentialEta = sample.reduce((s, t) => s + t, 0) / sample.length;
    // with beta≈1 the Weibull eta must sit near the exponential mean
    expect(Math.abs(fit.eta - exponentialEta) / exponentialEta).toBeLessThan(
      0.08,
    );
  });

  it("right censoring raises the fitted characteristic life", () => {
    const fails = weibullSample(2, 100, 200, 5);
    const withoutCens = weibullMLE(fails);
    const withCens = weibullMLE(
      fails,
      [150, 150, 150, 150, 150, 150, 150, 150],
    );
    expect(withCens.eta).toBeGreaterThan(withoutCens.eta);
    expect(withCens.censored).toBe(8);
  });

  it("refuses to fit unidentifiable data instead of guessing", () => {
    expect(() => weibullMLE([100])).toThrow(/at least 2 distinct/);
    expect(() => weibullMLE([100, 100, 100])).toThrow(/at least 2 distinct/);
  });
});

describe("crowAMSAA", () => {
  it("matches the exact hand-computed MLE for times [1,2,4] on (0,8]", () => {
    // beta = 3 / (3·ln8 − (ln1+ln2+ln4)) = 0.7213475…
    const fit = crowAMSAA([1, 2, 4], 8);
    expect(fit.beta).toBeCloseTo(0.7213475, 5);
    // identity: lambda·T^beta = r exactly at the MLE
    expect(fit.lambda * Math.pow(8, fit.beta)).toBeCloseTo(3, 8);
    // identity: instantaneous MTBF at T = T / (r·beta)
    expect(fit.instantaneousMtbf).toBeCloseTo(8 / (3 * fit.beta), 8);
    expect(fit.cumulativeMtbf).toBeCloseTo(8 / 3, 8);
  });

  it("flags a deteriorating system (late-concentrated failures) with beta > 1", () => {
    const fit = crowAMSAA([600, 800, 900, 950, 980, 995], 1000);
    expect(fit.beta).toBeGreaterThan(1.5);
  });

  it("flags an improving system (early-concentrated failures) with beta < 1", () => {
    const fit = crowAMSAA([5, 20, 50, 200, 400], 1000);
    expect(fit.beta).toBeLessThan(1);
  });

  it("refuses degenerate windows", () => {
    expect(() => crowAMSAA([1, 2], 8)).toThrow(/at least 3/);
    expect(() => crowAMSAA([8, 8, 8], 8)).toThrow(/Degenerate/);
  });
});

describe("repairableSummary", () => {
  it("computes MTBF, MTTR, availability from history exactly", () => {
    // 4 failures totalling 100h down over a 1000h window
    const s = repairableSummary([10, 20, 30, 40], 1000);
    expect(s.downtimeHours).toBe(100);
    expect(s.mttrHours).toBe(25);
    expect(s.mtbfHours).toBe(225); // (1000-100)/4
    expect(s.availability).toBeCloseTo(0.9, 10);
  });
});

describe("pareto", () => {
  it("ranks and accumulates shares correctly", () => {
    const rows = pareto([
      { key: "steering", value: 100 },
      { key: "engine", value: 300 },
      { key: "hydraulic", value: 100 },
    ]);
    expect(rows[0].key).toBe("engine");
    expect(rows[0].share).toBeCloseTo(0.6, 10);
    expect(rows[0].cumulativeShare).toBeCloseTo(0.6, 10);
    expect(rows[2].cumulativeShare).toBeCloseTo(1.0, 10);
  });

  it("returns empty for zero totals", () => {
    expect(pareto([{ key: "x", value: 0 }])).toEqual([]);
  });
});
