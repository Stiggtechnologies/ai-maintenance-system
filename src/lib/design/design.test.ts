/**
 * Validation for reliability-by-design.
 *
 * The allocation has an exact closed form, so the tests below are pinned to
 * hand arithmetic rather than to whatever the code emitted: two subsystems
 * sharing a 0.81 target must each get exactly 0.9, because 0.9 × 0.9 = 0.81.
 * The remainder cover the refusals, which are the point — an allocation nobody
 * checked against real equipment is a target that survives design review and
 * fails commissioning.
 */
import { describe, expect, it } from "vitest";
import {
  allocateAvailability,
  analyseEarlyLife,
  assessStandardisation,
  type Subsystem,
} from "./index";

describe("allocateAvailability — series", () => {
  it("splits a target so the product is exactly the target", () => {
    // 0.9 x 0.9 = 0.81, by construction.
    const r = allocateAvailability(0.81, [{ label: "A" }, { label: "B" }]);
    expect(r.subsystems[0].allocated).toBeCloseTo(0.9, 12);
    expect(r.subsystems[1].allocated).toBeCloseTo(0.9, 12);
    const product = r.subsystems.reduce((p, s) => p * s.allocated, 1);
    expect(product).toBeCloseTo(0.81, 12);
  });

  it("reduces to equal apportionment for equal weights at any n", () => {
    for (const n of [3, 5, 10]) {
      const subs: Subsystem[] = Array.from({ length: n }, (_, i) => ({
        label: `S${i}`,
      }));
      const r = allocateAvailability(0.99, subs);
      const expected = Math.pow(0.99, 1 / n);
      for (const s of r.subsystems)
        expect(s.allocated).toBeCloseTo(expected, 12);
      expect(r.subsystems.reduce((p, s) => p * s.allocated, 1)).toBeCloseTo(
        0.99,
        12,
      );
    }
  });

  it("shows why ten series subsystems cannot each be given the system target", () => {
    // The whole point: 99% system needs ~99.9% each, not 99% each.
    const subs = Array.from({ length: 10 }, (_, i) => ({ label: `S${i}` }));
    const r = allocateAvailability(0.99, subs);
    expect(r.subsystems[0].allocated).toBeCloseTo(0.998995, 5);
    // And ten subsystems at 99% each would only reach:
    expect(Math.pow(0.99, 10)).toBeCloseTo(0.9044, 4);
  });

  it("gives a heavier subsystem a smaller share of the availability", () => {
    // Weights 1 and 3 over a 0.81 target: 0.81^0.25 and 0.81^0.75.
    const r = allocateAvailability(0.81, [
      { label: "Simple", complexityWeight: 1 },
      { label: "Hard", complexityWeight: 3 },
    ]);
    expect(r.subsystems[0].allocated).toBeCloseTo(Math.pow(0.81, 0.25), 12);
    expect(r.subsystems[1].allocated).toBeCloseTo(Math.pow(0.81, 0.75), 12);
    expect(r.subsystems[1].allocated).toBeLessThan(r.subsystems[0].allocated);
    expect(r.subsystems.reduce((p, s) => p * s.allocated, 1)).toBeCloseTo(
      0.81,
      12,
    );
  });
});

describe("allocateAvailability — parallel", () => {
  it("splits unavailability so the parallel combination is the target", () => {
    // 1 - (0.1 x 0.1) = 0.99, so each leg is 0.9.
    const r = allocateAvailability(
      0.99,
      [{ label: "A" }, { label: "B" }],
      "parallel",
    );
    expect(r.subsystems[0].allocated).toBeCloseTo(0.9, 12);
    const combined =
      1 - r.subsystems.reduce((p, s) => p * (1 - s.allocated), 1);
    expect(combined).toBeCloseTo(0.99, 12);
  });

  it("asks less of each leg than the series case does", () => {
    const series = allocateAvailability(0.99, [{ label: "A" }, { label: "B" }]);
    const parallel = allocateAvailability(
      0.99,
      [{ label: "A" }, { label: "B" }],
      "parallel",
    );
    expect(parallel.subsystems[0].allocated).toBeLessThan(
      series.subsystems[0].allocated,
    );
  });
});

describe("allocateAvailability — the refusals", () => {
  it("REFUSES a target that the proposed equipment cannot reach", () => {
    const r = allocateAvailability(0.99, [
      { label: "Pump", demonstrated: 0.999 },
      { label: "Drive", demonstrated: 0.98 }, // allocated ~0.995, short
    ]);
    expect(r.feasible).toBe(false);
    expect(r.subsystems[1].shortfall).toBeGreaterThan(0);
    expect(r.achievable).toBeCloseTo(0.999 * 0.98, 12);
    // Singular, because exactly one subsystem falls short.
    expect(r.reason).toMatch(/1 subsystem cannot deliver what it is allocated/);
    expect(r.reason).toMatch(/not achievable as specified/i);
    expect(r.reason).toMatch(/costs the difference for the life of the asset/i);
  });

  it("reports feasibility as UNKNOWN rather than met when evidence is missing", () => {
    const r = allocateAvailability(0.99, [
      { label: "Pump", demonstrated: 0.999 },
      { label: "Drive" },
    ]);
    expect(r.feasible).toBe(false);
    expect(r.achievable).toBeNull();
    expect(r.reason).toMatch(/1 subsystem has no demonstrated availability/);
    expect(r.reason).toMatch(/feasibility is UNKNOWN rather than met/i);
    expect(r.reason).toMatch(/survives design review and fails commissioning/i);
  });

  it("accepts a target every subsystem demonstrably meets", () => {
    const r = allocateAvailability(0.81, [
      { label: "A", demonstrated: 0.95 },
      { label: "B", demonstrated: 0.95 },
    ]);
    expect(r.feasible).toBe(true);
    expect(r.achievable).toBeCloseTo(0.9025, 12);
  });

  it("REFUSES a target of 1.0", () => {
    const r = allocateAvailability(1.0, [{ label: "A" }]);
    expect(r.feasible).toBe(false);
    expect(r.reason).toMatch(/not achievable by anything that can fail/i);
  });

  it("REFUSES an allocation with no subsystems", () => {
    const r = allocateAvailability(0.99, []);
    expect(r.reason).toMatch(/a number in a document/i);
  });
});

describe("analyseEarlyLife", () => {
  const RECORDS = [
    { assetLabel: "P-1", monthsSinceHandover: 2, attributedTo: "installation" },
    { assetLabel: "P-2", monthsSinceHandover: 5, attributedTo: "design" },
    {
      assetLabel: "P-3",
      monthsSinceHandover: 9,
      attributedTo: "commissioning",
      fedBackToDesign: true,
    },
    {
      assetLabel: "P-4",
      monthsSinceHandover: 11,
      attributedTo: "not_determined",
    },
    { assetLabel: "P-5", monthsSinceHandover: 30, attributedTo: "random" },
  ];

  const r = analyseEarlyLife(RECORDS, 12);

  it("counts only failures inside the window", () => {
    expect(r.total).toBe(5);
    expect(r.withinWindow).toBe(4);
    expect(r.proportionWithin).toBeCloseTo(0.8, 12);
  });

  it("splits by attribution rather than lumping into infant mortality", () => {
    expect(r.preventableAtDesignOrBuild).toBe(3);
    expect(r.reason).toMatch(
      /preventable by a different party at a different stage/i,
    );
  });

  it("names unattributed failures as teaching nobody anything", () => {
    expect(r.reason).toMatch(/teaches nobody anything/i);
  });

  it("says plainly when nothing has been fed back", () => {
    const none = analyseEarlyLife(
      RECORDS.map((x) => ({ ...x, fedBackToDesign: false })),
      12,
    );
    expect(none.fedBack).toBe(0);
    expect(none.reason).toMatch(/The next project will buy the same problem/i);
  });

  it("does not read an empty register as an absence of early-life failures", () => {
    const empty = analyseEarlyLife([], 12);
    expect(empty.reason).toMatch(/logged as ordinary corrective work/i);
  });
});

describe("assessStandardisation", () => {
  it("counts variants per function and names the most fragmented", () => {
    const r = assessStandardisation([
      { functionLabel: "Haul truck", makeModel: "Komatsu 930-4", count: 19 },
      { functionLabel: "Haul truck", makeModel: "Cat 793F", count: 3 },
      { functionLabel: "Slurry pump", makeModel: "Warman 8/6", count: 4 },
    ]);
    const trucks = r.functions.find((f) => f.functionLabel === "Haul truck");
    expect(trucks?.variants).toBe(2);
    expect(trucks?.totalUnits).toBe(22);
    expect(trucks?.dominantShare).toBeCloseTo(19 / 22, 12);
    expect(r.reason).toMatch(/most fragmented is Haul truck with 2/);
  });

  it("says who carries the cost of a variant and who chose it", () => {
    const r = assessStandardisation([
      { functionLabel: "Pump", makeModel: "A", count: 2 },
      { functionLabel: "Pump", makeModel: "B", count: 2 },
    ]);
    expect(r.functions[0].reason).toMatch(
      /carried by maintenance, chosen by the project/i,
    );
  });

  it("does not flag a function served by one model", () => {
    const r = assessStandardisation([
      { functionLabel: "Pump", makeModel: "A", count: 6 },
    ]);
    expect(r.functions[0].variants).toBe(1);
    expect(r.reason).toMatch(/served by a single make\/model/i);
  });
});
