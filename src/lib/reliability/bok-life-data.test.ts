/**
 * Validation suite for the BoK life-data kernels (BOK-01, -02, -08, -09, -10).
 *
 * Approach, matching reliability.test.ts: published table values for the
 * special functions, analytic identities, a finite-difference check of every
 * hand-derived derivative, seeded Monte Carlo coverage for the confidence
 * bounds, and explicit refusal tests for every input the kernels must not
 * guess.
 */
import { describe, expect, it } from "vitest";
import { weibullMLE } from "./index";
import { mulberry32, sampleWeibull } from "../modelling/random";
import {
  chiSquareQuantile,
  gammaQuantile,
  lnGamma,
  normalCdf,
  normalQuantile,
  regularizedGammaP,
} from "./stats";
import {
  weibayes,
  weibullBLife,
  weibullFisherBounds,
  weibullLogLikelihood,
  weibullObservedInformation,
  weibullReliabilityBounds,
} from "./life-data-bounds";
import {
  laplaceTest,
  lewisRobinsonTest,
  meanCumulativeFunction,
  milHdbk189Test,
  renewalGate,
} from "./trend-tests";
import {
  chooseLifeDistribution,
  fitExponential,
  fitLognormal,
  lognormalLogLikelihood,
  logNormalSurvival,
} from "./distribution-fit";
import {
  gammaPriorFromMeanAndErrorFactor,
  updateFailureRate,
} from "./bayesian-rate";
import {
  idealizedMtbf,
  requiredGrowthRate,
  timeToReachMtbf,
} from "./growth-planning";

const weibullSample = (
  rng: () => number,
  n: number,
  beta: number,
  eta: number,
) => Array.from({ length: n }, () => sampleWeibull(rng, beta, eta));

describe("stats — published table values", () => {
  it("lnGamma matches factorials and Γ(1/2)", () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
    expect(lnGamma(10.5)).toBeCloseTo(13.940625219403763, 10);
  });
  it("chi-square quantiles match standard tables", () => {
    expect(chiSquareQuantile(0.95, 1)).toBeCloseTo(3.841459, 5);
    expect(chiSquareQuantile(0.95, 10)).toBeCloseTo(18.307038, 5);
    expect(chiSquareQuantile(0.05, 4)).toBeCloseTo(0.710723, 5);
    expect(chiSquareQuantile(0.9, 2)).toBeCloseTo(-2 * Math.log(0.1), 9);
  });
  it("normal quantiles and CDF match tables", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644854, 5);
    expect(normalCdf(1)).toBeCloseTo(0.841344746, 8);
    expect(normalCdf(-2)).toBeCloseTo(0.022750132, 8);
  });
  it("gamma quantile inverts the CDF", () => {
    const q = gammaQuantile(0.3, 2.5, 4);
    expect(regularizedGammaP(2.5, q * 4)).toBeCloseTo(0.3, 10);
  });
  it("refuses out-of-domain inputs", () => {
    expect(() => lnGamma(0)).toThrow();
    expect(() => normalQuantile(1)).toThrow();
    expect(() => chiSquareQuantile(0.5, 0)).toThrow();
  });
});

describe("BOK-01 Weibull Fisher bounds, B-life and Weibayes", () => {
  const rng = mulberry32(11);
  const fails = weibullSample(rng, 25, 2.2, 1000);
  const cens = [400, 650, 900, 1200, 1500];
  const fit = weibullMLE(fails, cens);

  it("analytic observed information equals the finite-difference Hessian", () => {
    const I = weibullObservedInformation(fit, fails, cens);
    const ll = (b: number, e: number) =>
      weibullLogLikelihood({ beta: b, eta: e }, fails, cens);
    const hb = 1e-4 * fit.beta;
    const he = 1e-4 * fit.eta;
    const dbb =
      (ll(fit.beta + hb, fit.eta) -
        2 * ll(fit.beta, fit.eta) +
        ll(fit.beta - hb, fit.eta)) /
      (hb * hb);
    const dee =
      (ll(fit.beta, fit.eta + he) -
        2 * ll(fit.beta, fit.eta) +
        ll(fit.beta, fit.eta - he)) /
      (he * he);
    const dbe =
      (ll(fit.beta + hb, fit.eta + he) -
        ll(fit.beta + hb, fit.eta - he) -
        ll(fit.beta - hb, fit.eta + he) +
        ll(fit.beta - hb, fit.eta - he)) /
      (4 * hb * he);
    expect(I[0][0]).toBeCloseTo(-dbb, 2);
    expect(I[1][1] / -dee).toBeCloseTo(1, 4);
    expect(I[0][1] / -dbe).toBeCloseTo(1, 3);
  });

  it("bounds bracket the estimate and B10 matches its closed form", () => {
    const b = weibullFisherBounds(fit, fails, cens, 0.9);
    expect(b.beta.lower).toBeLessThan(fit.beta);
    expect(b.beta.upper).toBeGreaterThan(fit.beta);
    expect(b.eta.lower).toBeLessThan(fit.eta);
    const b10 = weibullBLife(fit, b, 0.1);
    expect(b10.estimate).toBeCloseTo(
      fit.eta * Math.pow(-Math.log(0.9), 1 / fit.beta),
      8,
    );
    expect(b10.lower).toBeLessThan(b10.estimate);
    const r = weibullReliabilityBounds(fit, b, 500);
    expect(r.lower).toBeLessThan(r.estimate);
    expect(r.upper).toBeGreaterThan(r.estimate);
    expect(r.upper).toBeLessThanOrEqual(1);
  });

  it("90% two-sided bounds on beta cover the true value about 90% of the time", () => {
    const g = mulberry32(2026);
    let covered = 0;
    const reps = 400;
    for (let i = 0; i < reps; i++) {
      const x = weibullSample(g, 40, 2, 1000);
      const f = weibullMLE(x);
      const b = weibullFisherBounds(f, x, [], 0.9);
      if (b.beta.lower <= 2 && b.beta.upper >= 2) covered++;
    }
    expect(covered / reps).toBeGreaterThan(0.85);
    expect(covered / reps).toBeLessThan(0.95);
  });

  it("flags an undecided failure pattern when beta's interval straddles 1", () => {
    const g = mulberry32(5);
    const x = weibullSample(g, 6, 1.1, 1000);
    const b = weibullFisherBounds(weibullMLE(x), x, [], 0.9);
    expect(b.patternUndecided).toBe(true);
    expect(b.wearOutDemonstrated).toBe(false);
    expect(b.caution).toMatch(/approximate/);
  });

  it("refuses bounds with fewer than 2 failures and at non-MLE parameters", () => {
    expect(() => weibullFisherBounds({ beta: 2, eta: 100 }, [50], [])).toThrow(
      /weibayes/,
    );
    expect(() =>
      weibullFisherBounds({ beta: 40, eta: 1 }, [500, 900, 1200], []),
    ).toThrow(/not the maximum-likelihood/);
  });

  it("Weibayes with zero failures matches the closed form", () => {
    const ages = [800, 1200, 1500, 2000];
    const res = weibayes({
      failureTimes: [],
      survivorTimes: ages,
      beta: 2,
      betaBasis: "Fleet analysis FA-2026-014 of 38 identical gearboxes",
      confidence: 0.9,
    });
    const s = ages.reduce((a, t) => a + t * t, 0);
    expect(res.eta).toBeNull();
    expect(res.etaLower).toBeCloseTo(Math.sqrt(s / -Math.log(0.1)), 8);
  });

  it("Weibayes refuses an undocumented beta", () => {
    expect(() =>
      weibayes({
        failureTimes: [500],
        survivorTimes: [900],
        beta: 2,
        betaBasis: "assumed",
        confidence: 0.9,
      }),
    ).toThrow(/undocumented beta/);
  });
});

describe("BOK-02 trend tests, renewal gate and MCF", () => {
  it("Laplace is exactly zero for evenly spread events", () => {
    expect(laplaceTest([1, 2, 3, 4], 5).statistic).toBeCloseTo(0, 12);
  });
  it("MIL-HDBK-189 statistic matches the hand calculation", () => {
    expect(milHdbk189Test([1, 2, 3, 4], 5).statistic).toBeCloseTo(
      2 * Math.log(625 / 24),
      10,
    );
  });

  const nhpp = (rng: () => number, beta: number, eta: number, T: number) => {
    const out: number[] = [];
    let cum = 0;
    for (;;) {
      cum += -Math.log(1 - rng());
      const t = eta * Math.pow(cum, 1 / beta);
      if (t > T) return out;
      out.push(t);
    }
  };

  it("detects a deteriorating unit and blocks the renewal Weibull", () => {
    const events = nhpp(mulberry32(3), 3, 100, 1000);
    const gate = renewalGate(events, 1000);
    expect(gate.verdict).toBe("trend_detected");
    expect(gate.direction).toBe("deteriorating");
    expect(gate.weibullOnGapsPermitted).toBe(false);
  });

  it("detects an improving unit", () => {
    const events = nhpp(mulberry32(4), 0.5, 1, 1000);
    expect(renewalGate(events, 1000).direction).toBe("improving");
  });

  it("an HPP is not flagged at the stated false-alarm rate", () => {
    let flagged = 0;
    for (let s = 1; s <= 200; s++) {
      const events = nhpp(mulberry32(1000 + s), 1, 20, 1000);
      if (milHdbk189Test(events, 1000).direction !== "none") flagged++;
    }
    expect(flagged / 200).toBeLessThan(0.1);
  });

  it("Lewis–Robinson equals Laplace scaled by the gap coefficient of variation", () => {
    const ev = [10, 25, 31, 60, 72, 99];
    const gaps = [10, 15, 6, 29, 12, 27];
    const m = gaps.reduce((a, b) => a + b) / 6;
    const cv = Math.sqrt(gaps.reduce((a, g) => a + (g - m) ** 2, 0) / 5) / m;
    expect(lewisRobinsonTest(ev, 110).statistic).toBeCloseTo(
      laplaceTest(ev, 110).statistic / cv,
      10,
    );
  });

  it("refuses a judgement on fewer than 4 events", () => {
    const gate = renewalGate([10, 20, 30], 40);
    expect(gate.verdict).toBe("insufficient_data");
    expect(gate.weibullOnGapsPermitted).toBe(false);
  });

  it("refuses an event after the end of observation", () => {
    expect(() => laplaceTest([1, 2, 3, 9], 5)).toThrow(/after/);
  });

  it("MCF matches Nelson's hand calculation with staggered ends", () => {
    const pts = meanCumulativeFunction([
      { id: "A", eventAges: [100, 300], endAge: 400 },
      { id: "B", eventAges: [200], endAge: 250 },
    ]);
    expect(pts.map((p) => p.mcf)).toEqual([0.5, 1.0, 2.0]);
    expect(pts[2].atRisk).toBe(1);
    expect(() =>
      meanCumulativeFunction([{ id: "X", eventAges: [500], endAge: 400 }]),
    ).toThrow();
  });
});

describe("BOK-08 distribution choice", () => {
  it("exponential censored MLE is r / total time", () => {
    const e = fitExponential([100, 200], [300]);
    expect(e.lambda).toBeCloseTo(2 / 600, 12);
  });
  it("prefers lognormal for lognormal data and weibull for strong wear-out", () => {
    const rng = mulberry32(77);
    const ln = Array.from({ length: 200 }, () => {
      const u1 = rng();
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.exp(6 + 0.9 * z);
    });
    expect(chooseLifeDistribution(ln).best).toBe("lognormal");
    const w = weibullSample(mulberry32(78), 200, 4, 1000);
    expect(chooseLifeDistribution(w).best).toBe("weibull");
  });
  it("lognormal MLE recovers parameters", () => {
    const rng = mulberry32(9);
    const x = Array.from({ length: 400 }, () => {
      const z = Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());
      return Math.exp(5 + 0.5 * z);
    });
    const f = fitLognormal(x);
    expect(f.mu).toBeCloseTo(5, 1);
    expect(f.sigma).toBeCloseTo(0.5, 1);
  });
  it("lognormal log-likelihood matches the density at the median", () => {
    const t = Math.exp(4);
    expect(lognormalLogLikelihood(4, 1, [t])).toBeCloseTo(
      -0.5 * Math.log(2 * Math.PI) - Math.log(t),
      12,
    );
    expect(lognormalLogLikelihood(4, 1, [], [t])).toBeCloseTo(
      Math.log(0.5),
      12,
    );
    expect(lognormalLogLikelihood(4, 0, [t])).toBe(-Infinity);
  });
  it("tail survival stays finite far out", () => {
    expect(Number.isFinite(logNormalSurvival(20))).toBe(true);
    expect(logNormalSurvival(7.5)).toBeCloseTo(
      Math.log(3.190891672910929e-14),
      3,
    );
  });
  it("refuses to compare families on fewer than 3 failures", () => {
    expect(() => chooseLifeDistribution([10, 20])).toThrow(/at least 3/);
  });
});

describe("BOK-09 Bayesian failure rate", () => {
  const source = "OREDA 2015 Vol 1, centrifugal pumps, all modes";
  it("moment-matches a lognormal error factor", () => {
    const p = gammaPriorFromMeanAndErrorFactor(1e-4, 3, source);
    const sigma = Math.log(3) / 1.6448536269514722;
    expect(p.alpha).toBeCloseTo(1 / (Math.exp(sigma * sigma) - 1), 10);
    expect(p.alpha / p.beta).toBeCloseTo(1e-4, 12);
  });
  it("posterior mean is the conjugate update and reports prior weight", () => {
    const p = gammaPriorFromMeanAndErrorFactor(1e-4, 3, source);
    const u = updateFailureRate(p, 2, 50_000);
    expect(u.posteriorMean).toBeCloseTo((p.alpha + 2) / (p.beta + 50_000), 14);
    expect(u.priorWeight).toBeCloseTo(p.beta / (p.beta + 50_000), 12);
    expect(u.lower).toBeLessThan(u.posteriorMean);
    expect(u.upper).toBeGreaterThan(u.posteriorMean);
  });
  it("zero failures has no site-only rate but a bounded posterior", () => {
    const u = updateFailureRate(
      gammaPriorFromMeanAndErrorFactor(1e-4, 3, source),
      0,
      1000,
    );
    expect(u.siteOnlyRate).toBeNull();
    expect(u.reason).toMatch(/prior/);
  });
  it("refuses an uncited prior", () => {
    expect(() => gammaPriorFromMeanAndErrorFactor(1e-4, 3, "handbook")).toThrow(
      /cite/,
    );
    expect(() =>
      updateFailureRate({ alpha: 1, beta: 1000, source: "" }, 1, 10),
    ).toThrow(/cite/);
  });
});

describe("BOK-10 reliability growth planning", () => {
  const plan = { initialMtbf: 50, initialPhaseEnd: 500, growthRate: 0.35 };
  it("time-to-target inverts the idealized curve", () => {
    const t = timeToReachMtbf(plan, 200).time;
    expect(idealizedMtbf(plan, t)).toBeCloseTo(200, 8);
  });
  it("required growth rate inverts the curve", () => {
    const t = timeToReachMtbf(plan, 200).time;
    expect(requiredGrowthRate(50, 500, 200, t).growthRate).toBeCloseTo(0.35, 6);
  });
  it("flags aggressive growth and refuses α ≥ 1", () => {
    expect(timeToReachMtbf({ ...plan, growthRate: 0.6 }, 200).aggressive).toBe(
      true,
    );
    expect(() => idealizedMtbf({ ...plan, growthRate: 1 }, 600)).toThrow();
  });
});
