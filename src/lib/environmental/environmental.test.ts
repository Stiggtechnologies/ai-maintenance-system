/**
 * Validation for environmental analysis.
 *
 * The degradation fit is pinned to a fixture with an exactly known slope, and
 * the emissions arithmetic is trivially checkable. The refusals carry more
 * weight than either: an emissions figure produced from an uncited factor is
 * worse than no figure, because it gets reported anyway.
 */
import { describe, expect, it } from "vitest";
import { assessDegradation, computeEmissions, summariseLosses } from "./index";

describe("assessDegradation", () => {
  // Design 100. Readings rise by exactly 0.02 per day over 200 days:
  // 100 at day 0 -> 104 at day 200. Slope 0.02/day = 7.3/yr = 7.3% of design.
  const READINGS = [0, 50, 100, 150, 200].map((d) => ({
    daysSinceBaseline: d,
    specificEnergy: 100 + 0.02 * d,
  }));

  it("computes the degradation against design exactly", () => {
    const r = assessDegradation(100, READINGS);
    expect(r.latest).toBeCloseTo(104, 12);
    expect(r.degradation).toBeCloseTo(0.04, 12);
  });

  it("fits the annual rate from the slope, not from the endpoints", () => {
    const r = assessDegradation(100, READINGS);
    // 0.02/day x 365 / 100 = 0.073 per year.
    expect(r.ratePerYear).toBeCloseTo(0.073, 12);
    expect(r.reason).toMatch(/worsening at 7\.3% a year on 5 readings/);
  });

  it("computes payback when both cost inputs are present", () => {
    // 4% degradation x $5,000/day of energy = $200/day excess.
    // A $30,000 clean pays back in 150 days.
    const r = assessDegradation(100, READINGS, 30_000, 5_000);
    expect(r.daysToPayback).toBeCloseTo(150, 6);
    expect(r.reason).toMatch(/pays for itself in 150 days/);
  });

  it("does not invent a payback without the cost inputs", () => {
    const r = assessDegradation(100, READINGS);
    expect(r.daysToPayback).toBeNull();
    expect(r.reason).toMatch(/paid for in fuel every day/);
  });

  it("REFUSES a degradation figure with no baseline to compare against", () => {
    const r = assessDegradation(null, READINGS);
    expect(r.measurable).toBe(false);
    expect(r.reason).toMatch(/a measurement, not a performance/);
  });

  it("REFUSES a rate from a single reading", () => {
    const r = assessDegradation(100, [
      { daysSinceBaseline: 10, specificEnergy: 108 },
    ]);
    expect(r.measurable).toBe(false);
    expect(r.reason).toMatch(/never how fast it is getting there/);
  });

  it("REFUSES a rate when every reading is at the same instant", () => {
    const r = assessDegradation(100, [
      { daysSinceBaseline: 5, specificEnergy: 101 },
      { daysSinceBaseline: 5, specificEnergy: 103 },
    ]);
    expect(r.measurable).toBe(false);
    expect(r.reason).toMatch(/spread across the period/);
  });

  it("reports an improving asset as improving", () => {
    // -0.02/day is the mirror of the worsening fixture above, so the rate is
    // exactly 7.3% and the assertion is not testing decimal rounding.
    const r = assessDegradation(
      100,
      [0, 100].map((d) => ({
        daysSinceBaseline: d,
        specificEnergy: 100 - 0.02 * d,
      })),
    );
    expect(r.ratePerYear).toBeCloseTo(-0.073, 12);
    expect(r.reason).toMatch(/improving at 7\.3% a year/);
    expect(r.reason).toMatch(/not currently worse than design/);
  });
});

describe("computeEmissions", () => {
  const base = {
    activityLabel: "Diesel burned",
    activityQuantity: 10_000,
    activityUnit: "L",
    factor: 2.68,
    factorUnit: "kgCO2e/L",
    factorSource: "DEFRA 2026",
    scope: "scope_1" as const,
  };

  it("converts activity to tonnes CO2e exactly", () => {
    // 10,000 L x 2.68 kg/L = 26,800 kg = 26.8 t
    const r = computeEmissions(base);
    expect(r.co2eTonnes).toBeCloseTo(26.8, 12);
    expect(r.auditable).toBe(true);
    expect(r.reason).toMatch(/factor from DEFRA 2026/);
  });

  it("applies a global warming potential for methane", () => {
    // 100 kg CH4 x factor 1 x GWP 28 = 2800 kg = 2.8 t
    const r = computeEmissions({
      ...base,
      activityLabel: "Methane vented",
      activityQuantity: 100,
      activityUnit: "kg",
      factor: 1,
      gwp: 28,
    });
    expect(r.co2eTonnes).toBeCloseTo(2.8, 12);
    expect(r.reason).toMatch(/GWP 28/);
  });

  it("REFUSES a figure with no emission factor", () => {
    const r = computeEmissions({ ...base, factor: null });
    expect(r.co2eTonnes).toBeNull();
    expect(r.reason).toMatch(/fuel burned, not emissions reported/);
  });

  it("REFUSES a factor that cannot be cited", () => {
    const r = computeEmissions({ ...base, factorSource: "  " });
    expect(r.auditable).toBe(false);
    expect(r.reason).toMatch(/unauditable, and it will be reported anyway/);
  });

  it("REFUSES to compute without a scope", () => {
    const r = computeEmissions({ ...base, scope: null });
    expect(r.co2eTonnes).toBeNull();
    expect(r.reason).toMatch(/not interchangeable/);
  });
});

describe("summariseLosses", () => {
  it("aggregates by substance and unit", () => {
    const r = summariseLosses([
      {
        substance: "Hydraulic oil",
        quantity: 200,
        unit: "L",
        attributedToMaintenance: true,
      },
      {
        substance: "Hydraulic oil",
        quantity: 150,
        unit: "L",
        attributedToMaintenance: false,
      },
      {
        substance: "Methane",
        quantity: 40,
        unit: "kg",
        attributedToMaintenance: true,
      },
    ]);
    expect(r.bySubstance[0]).toEqual({
      substance: "Hydraulic oil",
      quantity: 350,
      unit: "L",
    });
    expect(r.maintenanceAttributable).toBe(2);
  });

  it("separates maintenance-attributable losses without framing it as blame", () => {
    const r = summariseLosses([
      {
        substance: "Oil",
        quantity: 10,
        unit: "L",
        attributedToMaintenance: true,
      },
    ]);
    expect(r.reason).toMatch(/the ones this platform can actually change/);
    expect(r.reason).toMatch(/design limitation needs a different owner/);
  });

  it("counts unattributed losses as teaching nobody anything", () => {
    const r = summariseLosses([
      { substance: "Oil", quantity: 10, unit: "L" },
      {
        substance: "Oil",
        quantity: 5,
        unit: "L",
        attributedToMaintenance: true,
      },
    ]);
    expect(r.reason).toMatch(/1 have no attribution recorded/);
  });

  it("does not read an empty register as an absence of losses", () => {
    const r = summariseLosses([]);
    expect(r.reason).toMatch(
      /a weeping seal does not raise its own notification/,
    );
  });
});
