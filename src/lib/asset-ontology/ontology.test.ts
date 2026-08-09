/**
 * Validation for the asset ontology.
 *
 * This module exists to stop the platform computing rotating-equipment maths
 * over things that are not rotating equipment, so most of these tests are
 * about REFUSALS being correct and unskippable. The density fixture is worked
 * out by hand: a 10 km route with eight open defects, six of them inside two
 * kilometres.
 */
import { describe, expect, it } from "vitest";
import {
  checkApplicability,
  normaliseRate,
  defectDensity,
  type ClassProfile,
  type LinearDefect,
} from "./index";

const LINEAR: ClassProfile = {
  classKey: "linear",
  label: "Linear assets",
  measurementBasis: "linear",
  exposureUnit: "km-year",
  applicability: [
    {
      analysisKey: "weibull_age_replacement",
      applicable: false,
      reason:
        "A route does not fail as a unit. Fit distributions to defects per kilometre, not to the age of the whole line.",
    },
    {
      analysisKey: "pf_interval",
      applicable: true,
      reason: "In-line inspection detects a growing defect.",
    },
  ],
};

const LOGICAL: ClassProfile = {
  classKey: "software_defined",
  label: "Software-defined assets",
  measurementBasis: "logical",
  applicability: [
    {
      analysisKey: "weibull_age_replacement",
      applicable: false,
      reason:
        "Software does not wear out. Replacing it on an age schedule is not conservative, it is meaningless.",
    },
  ],
};

const POINT: ClassProfile = {
  classKey: "fixed_equipment",
  label: "Fixed equipment",
  measurementBasis: "point",
  applicability: [
    {
      analysisKey: "weibull_age_replacement",
      applicable: true,
      reason: "Age-driven wear-out is credible.",
    },
  ],
};

describe("checkApplicability — the gate", () => {
  it("allows the analysis where the class supports it", () => {
    const v = checkApplicability(POINT, "weibull_age_replacement");
    expect(v.applicable).toBe(true);
  });

  it("refuses age replacement for a route and says why", () => {
    const v = checkApplicability(LINEAR, "weibull_age_replacement");
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/does not fail as a unit/i);
  });

  it("refuses age replacement for software in the strongest terms", () => {
    const v = checkApplicability(LOGICAL, "weibull_age_replacement");
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/not conservative, it is meaningless/i);
  });

  it("REFUSES an unknown analysis rather than allowing it", () => {
    // The permissive default is the dangerous one.
    const v = checkApplicability(LINEAR, "some_analysis_added_next_year");
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/Refused rather than allowed/i);
    expect(v.reason).toMatch(/silently applies/i);
  });

  it("REFUSES when the asset has no class profile at all", () => {
    const v = checkApplicability(null, "mtbf");
    expect(v.applicable).toBe(false);
    expect(v.reason).toMatch(/no class profile/i);
    expect(v.reason).toMatch(
      /right for rotating equipment and wrong for everything else/i,
    );
  });
});

describe("normaliseRate — the denominator", () => {
  it("gives per-asset-year for a discrete machine", () => {
    const r = normaliseRate("point", 6, 3);
    expect(r.rate).toBeCloseTo(2, 10);
    expect(r.unit).toBe("asset-year");
  });

  it("gives per-kilometre-year for a route, and says why", () => {
    // 12 defects over 40 km observed for 2 years = 80 km-years = 0.15/km-yr.
    const r = normaliseRate("linear", 12, 80, "km-year");
    expect(r.rate).toBeCloseTo(0.15, 10);
    expect(r.unit).toBe("km-year");
    expect(r.reason).toMatch(/hides where the failures are/i);
    expect(r.reason).toMatch(/routes of different lengths look comparable/i);
  });

  it("gives per-unit-year for a population", () => {
    // 400 failures over 40,000 units for 1 year.
    const r = normaliseRate("population", 400, 40_000);
    expect(r.rate).toBeCloseTo(0.01, 10);
    expect(r.unit).toBe("unit-year");
    expect(r.reason).toMatch(/not individually tracked/i);
  });

  it("REFUSES a rate for a structure", () => {
    const r = normaliseRate("structure", 3, 10);
    expect(r.rate).toBeNull();
    expect(r.reason).toMatch(/inspection rating scale/i);
  });

  it("REFUSES a rate for a natural asset", () => {
    const r = normaliseRate("natural", 1, 10);
    expect(r.rate).toBeNull();
    expect(r.reason).toMatch(/no repair cycle/i);
  });

  it("REFUSES to turn a bare count into a rate", () => {
    const r = normaliseRate("linear", 12, 0);
    expect(r.rate).toBeNull();
    expect(r.reason).toMatch(/is a count/i);
    expect(r.reason).toMatch(/invite comparison/i);
  });

  it("rejects a negative failure count", () => {
    expect(normaliseRate("point", -1, 5).rate).toBeNull();
  });
});

describe("defectDensity — where the failures actually are", () => {
  // 10 km route. Six defects between 3.0 and 4.9 km, two elsewhere.
  const DEFECTS: LinearDefect[] = [
    { atMeasure: 0.5, defectType: "corrosion" },
    { atMeasure: 3.1, defectType: "corrosion" },
    { atMeasure: 3.4, defectType: "corrosion" },
    { atMeasure: 3.8, defectType: "corrosion" },
    { atMeasure: 4.1, defectType: "dent" },
    { atMeasure: 4.5, defectType: "corrosion" },
    { atMeasure: 4.9, defectType: "corrosion" },
    { atMeasure: 8.2, defectType: "coating" },
    { atMeasure: 9.1, defectType: "coating", repairedAt: "2026-01-01" },
  ];

  const r = defectDensity(0, 10, DEFECTS, 1);

  it("counts only open defects", () => {
    expect(r.openDefects).toBe(8); // the 9.1 km coating defect was repaired
    expect(r.overallDensity).toBeCloseTo(0.8, 10);
  });

  it("produces one band per unit of length", () => {
    expect(r.bands).toHaveLength(10);
    expect(r.bands[3]).toEqual({
      fromMeasure: 3,
      toMeasure: 4,
      defectCount: 3,
      densityPerUnit: 3,
    });
  });

  it("finds the concentration a single route figure would average away", () => {
    // Bands 3-4 and 4-5 hold 6 of 8 defects in 2 of 10 km.
    expect(r.hotspots.map((h) => h.fromMeasure).sort()).toEqual([3, 4]);
    expect(r.reason).toMatch(
      /75% — fall in 2 unit\(s\) of route, 20% of its length/,
    );
    expect(r.reason).toMatch(/averaged that away/i);
  });

  it("does not manufacture a hotspot from an even spread", () => {
    const even = defectDensity(
      0,
      10,
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => ({
        atMeasure: m,
        defectType: "corrosion",
      })),
      1,
    );
    expect(even.hotspots).toEqual([]);
    expect(even.reason).toMatch(/without a concentration at this band width/i);
  });

  it("does not read an uninspected route as a clean one", () => {
    const none = defectDensity(0, 10, [], 1);
    expect(none.openDefects).toBe(0);
    expect(none.reason).toMatch(
      /an uninspected route also has no recorded defects/i,
    );
  });

  it("handles a final part-band without overstating its density", () => {
    // 2.5 km route, one defect at 2.2 km — in a 0.5 km-wide final band.
    const part = defectDensity(
      0,
      2.5,
      [{ atMeasure: 2.2, defectType: "x" }],
      1,
    );
    const last = part.bands[part.bands.length - 1];
    expect(last.fromMeasure).toBe(2);
    expect(last.toMeasure).toBe(2.5);
    expect(last.defectCount).toBe(1);
    expect(last.densityPerUnit).toBeCloseTo(2, 10); // 1 defect / 0.5 km
  });

  it("REFUSES a route with no length", () => {
    const r0 = defectDensity(5, 5, DEFECTS, 1);
    expect(r0.reason).toMatch(/no length recorded/i);
    expect(r0.bands).toEqual([]);
  });
});
