/**
 * Validation suite for the BoK decision kernels (BOK-05, -06, -07, -11,
 * -12, -13 and the BOK-01 interval consumer).
 *
 * Every numeric expectation below is either a closed form computed by hand
 * in the test, a published identity (renewal-function asymptote, Palm's
 * theorem, the EBO recursion), or a theorem (block replacement never beats age
 * replacement). Every kernel input that must not be guessed has a refusal test.
 */
import { describe, expect, it } from "vitest";
import { weibullMLE } from "./reliability";
import { weibullFisherBounds } from "./reliability/life-data-bounds";
import { mulberry32, sampleWeibull } from "./modelling/random";
import {
  ageReplacementUnderUncertainty,
  optimalBlockReplacement,
  weibullRenewalFunction,
} from "./optimization/interval-under-uncertainty";
import {
  capitalRecoveryFactor,
  compareLifeCycleOptions,
  presentValue,
} from "./lifecycle/discounted-lcc";
import { analyseLopa, sifMeetsLopa } from "./process-safety/lopa";
import type { LopaScenario } from "./process-safety/lopa";
import { planRiskBasedInspection } from "./integrity/rbi";
import type { RbiInput } from "./integrity/rbi";
import {
  expectedBackorders,
  fillRate,
  fleetAvailability,
  optimiseRotableStock,
  pipelineMean,
} from "./spares/rotable-pipeline";
import type { RotableItem } from "./spares/rotable-pipeline";
import { poissonCdf } from "./spares";
import { heartHep } from "./human-factors/heart";

const cost = { plannedCost: 1000, failureCost: 10000 };

describe("BOK-01 consumer: age replacement decided against the beta interval", () => {
  it("withholds an interval when wear-out is not demonstrated", () => {
    const g = mulberry32(5);
    const x = Array.from({ length: 6 }, () => sampleWeibull(g, 1.1, 1000));
    const fit = weibullMLE(x);
    const b = weibullFisherBounds(fit, x, [], 0.9);
    const r = ageReplacementUnderUncertainty(fit, b, cost);
    expect(b.wearOutDemonstrated).toBe(false);
    expect(r.recommended).toBe(false);
    expect(r.reason).toMatch(/not demonstrated/);
  });
  it("reports regret at both bounds when wear-out is demonstrated", () => {
    const rng = mulberry32(31);
    const x = Array.from({ length: 80 }, () => sampleWeibull(rng, 3.5, 1000));
    const fit = weibullMLE(x);
    const r = ageReplacementUnderUncertainty(
      fit,
      weibullFisherBounds(fit, x, [], 0.9),
      cost,
    );
    expect(r.wearOutDemonstrated).toBe(true);
    expect(r.recommended).toBe(true);
    expect(r.regretPct.atLowerBeta).toBeGreaterThanOrEqual(0);
    expect(r.regretPct.atUpperBeta).toBeGreaterThanOrEqual(0);
  });
  it("refuses bounds computed for another fit", () => {
    const x = [300, 500, 800, 900, 1200];
    const fit = weibullMLE(x);
    const b = weibullFisherBounds(fit, x, [], 0.9);
    expect(() =>
      ageReplacementUnderUncertainty({ ...fit, beta: fit.beta + 1 }, b, cost),
    ).toThrow(/different fit/);
  });
});

describe("BOK-11 block replacement", () => {
  it("renewal function is t/η for the exponential", () => {
    expect(
      weibullRenewalFunction({ beta: 1, eta: 100 }, 250) / 2.5,
    ).toBeCloseTo(1, 3);
  });
  it("renewal function matches the large-t asymptote for β = 2", () => {
    const mu = 0.886226925452758;
    const cv2 = (1 - mu * mu) / (mu * mu);
    const asym = 10 / mu + (cv2 - 1) / 2;
    expect(weibullRenewalFunction({ beta: 2, eta: 1 }, 10)).toBeCloseTo(
      asym,
      2,
    );
  });
  it("never beats age replacement (Barlow & Proschan) and refuses β ≤ 1", () => {
    const r = optimalBlockReplacement(
      { beta: 3, eta: 1000, failures: 20 },
      cost,
    );
    expect(r.recommended).toBe(true);
    expect(r.premiumOverAgePct!).toBeGreaterThanOrEqual(0);
    expect(
      optimalBlockReplacement({ beta: 0.9, eta: 1000, failures: 20 }, cost)
        .recommended,
    ).toBe(false);
  });
});

describe("BOK-07 discounted life-cycle cost", () => {
  const policy = {
    rate: 0.07,
    owner: "CFO, finance committee",
    basis: "Treasury policy TP-12 real WACC 2026",
  };
  it("CRF and NPV match hand calculation", () => {
    expect(capitalRecoveryFactor(0.1, 10)).toBeCloseTo(0.162745, 6);
    expect(capitalRecoveryFactor(0, 5)).toBeCloseTo(0.2, 12);
    expect(
      presentValue(
        [
          { year: 0, amount: 100 },
          { year: 1, amount: 110 },
        ],
        0.1,
      ),
    ).toBeCloseTo(200, 10);
  });
  it("shows when undiscounted comparison misleads and when the rate decides", () => {
    const res = compareLifeCycleOptions(
      [
        {
          name: "Replace now",
          lifeYears: 10,
          cashFlows: [{ year: 0, amount: 1000 }],
        },
        {
          name: "Run and rebuild",
          lifeYears: 10,
          cashFlows: [{ year: 10, amount: 1050 }],
        },
      ],
      policy,
      [0, 0.03, 0.07, 0.1],
    );
    expect(res.preferred).toBe("Run and rebuild");
    expect(res.undiscountedWouldMislead).toBe(true);
    expect(res.rankingSensitiveToRate).toBe(true);
  });
  it("states the like-for-like renewal assumption when lives differ", () => {
    const res = compareLifeCycleOptions(
      [
        {
          name: "Rebuild",
          lifeYears: 5,
          cashFlows: [{ year: 0, amount: 300 }],
        },
        { name: "New", lifeYears: 15, cashFlows: [{ year: 0, amount: 800 }] },
      ],
      policy,
    );
    expect(res.reason).toMatch(/renewed like-for-like/);
  });
  it("refuses an ungoverned rate, a cash flow past life, and a single option", () => {
    const o = [
      { name: "A", lifeYears: 5, cashFlows: [{ year: 0, amount: 10 }] },
      { name: "B", lifeYears: 5, cashFlows: [{ year: 0, amount: 12 }] },
    ];
    expect(() =>
      compareLifeCycleOptions(o, { rate: 0.07, owner: "", basis: "" }),
    ).toThrow(/owner/);
    expect(() =>
      compareLifeCycleOptions(
        [
          o[0],
          { name: "C", lifeYears: 5, cashFlows: [{ year: 6, amount: 1 }] },
        ],
        policy,
      ),
    ).toThrow(/after/);
    expect(() => compareLifeCycleOptions([o[0]], policy)).toThrow(
      /two options/,
    );
  });
});

describe("BOK-06 LOPA", () => {
  const base: LopaScenario = {
    id: "S-01",
    consequence: "Overpressure of V-101, loss of containment",
    initiatingEvent: {
      description: "BPCS control valve fails open",
      frequencyPerYear: 0.1,
      basis: "Site failure data 2019–2025",
    },
    modifiers: [
      {
        description: "Occupancy",
        probability: 0.5,
        basis: "Shift roster study",
      },
    ],
    layers: [
      {
        name: "Relief valve PSV-101",
        pfd: 0.01,
        basis: "Proof-test history",
        independent: true,
        specific: true,
        auditable: true,
      },
      {
        name: "Operator response to high alarm",
        pfd: 0.1,
        basis: "HEART assessment H-7",
        independent: false,
        specific: true,
        auditable: true,
      },
    ],
    tolerableFrequencyPerYear: 1e-5,
    criteriaBasis: "Corporate risk matrix CRM-3, fatality",
  };
  it("credits only qualifying layers and derives the SIL target", () => {
    const r = analyseLopa(base);
    expect(r.creditedLayers).toEqual(["Relief valve PSV-101"]);
    expect(r.uncreditedLayers[0].why).toMatch(/not independent/);
    expect(r.mitigatedFrequency).toBeCloseTo(0.1 * 0.5 * 0.01, 15);
    expect(r.requiredSifPfd).toBeCloseTo(1e-5 / 5e-4, 12);
    expect(r.silTarget).toBe(1);
    expect(sifMeetsLopa(r, 5e-3).meets).toBe(true);
    expect(sifMeetsLopa(r, 5e-2).meets).toBe(false);
  });
  it("flags a gap beyond SIL 3 and reports no SIF when layers suffice", () => {
    expect(
      analyseLopa({ ...base, tolerableFrequencyPerYear: 1e-9 }).beyondSil3,
    ).toBe(true);
    expect(
      analyseLopa({ ...base, tolerableFrequencyPerYear: 1e-3 }).sifRequired,
    ).toBe(false);
  });
  it("refuses unbased numbers and impossible PFDs", () => {
    expect(() => analyseLopa({ ...base, criteriaBasis: "" })).toThrow(
      /criterion/,
    );
    expect(() =>
      analyseLopa({ ...base, layers: [{ ...base.layers[0], pfd: 1.5 }] }),
    ).toThrow(/PFD/);
    expect(() =>
      analyseLopa({
        ...base,
        initiatingEvent: { ...base.initiatingEvent, basis: "" },
      }),
    ).toThrow(/basis/);
  });
});

describe("BOK-05 risk-based inspection", () => {
  const input: RbiInput = {
    componentId: "V-101 shell",
    genericFailureFrequency: {
      perYear: 3e-5,
      basis: "Licensed API 581 Part 2 Table 3.1, vessel",
    },
    mechanisms: [
      {
        mechanism: "Internal thinning",
        basis: "CML trend 2018–2025, owner assessment",
        curve: [
          { years: 0, df: 1 },
          { years: 10, df: 101 },
        ],
      },
    ],
    combination: "additive",
    combinationBasis: "Owner integrity procedure IP-4 §3",
    managementSystemFactor: { value: 1, basis: "2025 PSM audit score" },
    consequence: { value: 100, unit: "m2", basis: "Consequence study CA-22" },
    riskTarget: { value: 0.05, basis: "Integrity risk target IRT-1" },
  };
  it("finds the date risk reaches the target", () => {
    const r = planRiskBasedInspection(input);
    // risk(y) = 3e-5 · DF(y) · 1 · 100; target 0.05 → DF = 16.667 → y = 1.5667
    expect(r.yearsToTarget!).toBeCloseTo((0.05 / 3e-3 - 1) / 10, 6);
    expect(r.standardClaim).toMatch(/API 580-aligned/);
  });
  it("reports over-target now and below-target across the horizon", () => {
    expect(
      planRiskBasedInspection({
        ...input,
        riskTarget: { value: 1e-3, basis: "Integrity risk target IRT-1" },
      }).exceedsTargetNow,
    ).toBe(true);
    expect(
      planRiskBasedInspection({
        ...input,
        riskTarget: { value: 1, basis: "Integrity risk target IRT-1" },
      }).yearsToTarget,
    ).toBeNull();
  });
  it("combines mechanisms additively or by the governing one", () => {
    const two = {
      ...input,
      mechanisms: [
        ...input.mechanisms,
        {
          mechanism: "External CUI",
          basis: "CUI survey 2024 owner",
          curve: [
            { years: 0, df: 5 },
            { years: 10, df: 5 },
          ],
        },
      ],
    };
    const add = planRiskBasedInspection(two);
    const gov = planRiskBasedInspection({ ...two, combination: "governing" });
    expect(add.pofNow).toBeCloseTo(3e-5 * 6, 15);
    expect(gov.pofNow).toBeCloseTo(3e-5 * 5, 15);
  });
  it("refuses decreasing damage, missing basis and no mechanisms", () => {
    expect(() =>
      planRiskBasedInspection({
        ...input,
        mechanisms: [
          {
            ...input.mechanisms[0],
            curve: [
              { years: 0, df: 5 },
              { years: 5, df: 2 },
            ],
          },
        ],
      }),
    ).toThrow(/cannot decrease/);
    expect(() =>
      planRiskBasedInspection({
        ...input,
        genericFailureFrequency: { perYear: 3e-5, basis: "" },
      }),
    ).toThrow(/basis/);
    expect(() => planRiskBasedInspection({ ...input, mechanisms: [] })).toThrow(
      /mechanism/,
    );
  });
});

describe("BOK-12 rotable spares", () => {
  const item: RotableItem = {
    id: "FD",
    removalsPerYear: 12,
    repairTurnaroundDays: 30,
    condemnationFraction: 0.1,
    procurementLeadDays: 180,
    unitCost: 250000,
    quantityPerSystem: 2,
  };
  it("Palm pipeline mean and the EBO recursion", () => {
    const mu = pipelineMean(item);
    expect(mu).toBeCloseTo((12 * (0.9 * 30 + 0.1 * 180)) / 365, 12);
    expect(expectedBackorders(0, mu)).toBeCloseTo(mu, 10);
    for (let s = 0; s < 5; s++)
      expect(expectedBackorders(s + 1, mu)).toBeCloseTo(
        expectedBackorders(s, mu) - (1 - poissonCdf(s, mu)),
        10,
      );
    expect(fillRate(0, mu)).toBe(0);
  });
  it("fleet availability matches the single-item hand calculation", () => {
    const one = { ...item, quantityPerSystem: 1 };
    const mu = pipelineMean(one);
    expect(fleetAvailability([one], { FD: 0 }, 10)).toBeCloseTo(
      1 - mu / 10,
      12,
    );
    expect(fleetAvailability([one], { FD: 40 }, 10)).toBeCloseTo(1, 9);
    expect(() => fleetAvailability([one], {}, 0)).toThrow(/Fleet size/);
  });
  it("marginal allocation meets the target on a monotone curve and respects a budget", () => {
    const items = [
      item,
      {
        ...item,
        id: "ENG",
        removalsPerYear: 4,
        repairTurnaroundDays: 60,
        unitCost: 900000,
        quantityPerSystem: 1,
      },
    ];
    const r = optimiseRotableStock(items, 20, { targetAvailability: 0.95 });
    expect(r.met).toBe(true);
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i].cost).toBeGreaterThan(r.curve[i - 1].cost);
      expect(r.curve[i].availability).toBeGreaterThanOrEqual(
        r.curve[i - 1].availability,
      );
    }
    const b = optimiseRotableStock(items, 20, { budget: 1_000_000 });
    expect(b.cost).toBeLessThanOrEqual(1_000_000);
  });
  it("refuses with no stopping rule or no turnaround time", () => {
    expect(() => optimiseRotableStock([item], 20, {})).toThrow(
      /target or a budget/,
    );
    expect(() => pipelineMean({ ...item, repairTurnaroundDays: 0 })).toThrow(
      /turnaround/,
    );
  });
});

describe("BOK-13 HEART human error probability", () => {
  const task = {
    description: "Restore valve line-up after maintenance",
    nominalHep: 0.003,
    basis: "HEART GTT row G",
  };
  const epc = (max: number, apoa: number) => ({
    description: `EPC x${max}`,
    maxMultiplier: max,
    assessedProportion: apoa,
    basis: "HEART EPC table row",
    rationale: "Night shift, unfamiliar valve arrangement observed",
  });
  it("matches the hand calculation", () => {
    const r = heartHep(task, [epc(11, 0.4), epc(3, 1)]);
    expect(r.hep).toBeCloseTo(0.003 * 5 * 3, 12);
    expect(r.dominant).toBe("EPC x11");
  });
  it("caps at 1 and says why", () => {
    const r = heartHep(task, [epc(17, 1), epc(11, 1), epc(10, 1)]);
    expect(r.hep).toBe(1);
    expect(r.capped).toBe(true);
  });
  it("refuses unrecorded judgement and out-of-range proportions", () => {
    expect(() => heartHep(task, [{ ...epc(11, 0.4), rationale: "" }])).toThrow(
      /rationale/,
    );
    expect(() => heartHep(task, [epc(11, 1.4)])).toThrow(/proportion/);
    expect(() => heartHep({ ...task, basis: "" }, [])).toThrow(/cite/);
  });
});
