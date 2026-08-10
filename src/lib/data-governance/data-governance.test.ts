/**
 * Validation for data governance.
 *
 * The duplicate detector is the one that has to be conservative: a wrong merge
 * destroys two histories, so the tests below check as hard for the candidates
 * it must NOT raise as for the ones it must. The sensor validator is tested on
 * the distinction that actually matters — an impossible reading is the
 * instrument, an unusual one may be the process.
 */
import { describe, expect, it } from "vitest";
import {
  assessIdentity,
  detectDuplicates,
  validateReading,
  type AssetIdentity,
} from "./index";

const asset = (
  id: string,
  name: string,
  extra: Partial<AssetIdentity> = {},
): AssetIdentity => ({ id, name, ...extra });

describe("assessIdentity", () => {
  it("counts a tag or a serial number as a stable key", () => {
    const r = assessIdentity([
      asset("1", "Pump A", { tag: "P-101" }),
      asset("2", "Pump B", { serialNumber: "SN-9" }),
      asset("3", "Pump C"),
    ]);
    expect(r.withStableId).toBe(2);
    expect(r.nameOnly).toBe(1);
  });

  it("states the hard limit when NOTHING has a stable key", () => {
    // This is the real state of the 144-asset operator fleet.
    const r = assessIdentity(
      Array.from({ length: 144 }, (_, i) => asset(String(i), `Dozer ${i}`)),
    );
    expect(r.withStableId).toBe(0);
    expect(r.reason).toMatch(/a label a person reads and not a key/);
    expect(r.reason).toMatch(/no amount of analysis downstream can recover it/);
  });

  it("treats whitespace as absent", () => {
    const r = assessIdentity([asset("1", "Pump", { tag: "   " })]);
    expect(r.withTag).toBe(0);
  });

  it("says so plainly when every asset is keyed", () => {
    const r = assessIdentity([asset("1", "Pump", { tag: "P-101" })]);
    expect(r.nameOnly).toBe(0);
    expect(r.reason).toMatch(/joined on a stable key/);
  });
});

describe("detectDuplicates", () => {
  it("calls an identical tag certain", () => {
    const r = detectDuplicates([
      asset("1", "Pump A", { tag: "P-101" }),
      asset("2", "Pump A duplicate", { tag: "p-101" }),
    ]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].confidence).toBe("certain");
    expect(r.candidates[0].basis).toMatch(/A tag is meant to be unique/);
  });

  it("calls an identical serial number certain", () => {
    const r = detectDuplicates([
      asset("1", "Truck 1", { serialNumber: "SN-77" }),
      asset("2", "Haul Truck One", { serialNumber: " sn-77 " }),
    ]);
    expect(r.candidates[0].confidence).toBe("certain");
    expect(r.candidates[0].basis).toMatch(/cannot be two assets/);
  });

  it("does NOT flag similar names in different sites", () => {
    // Two plants each having a "Pump 1" is normal, not a duplicate.
    const r = detectDuplicates([
      asset("1", "Pump 1", { assetClass: "Pump", siteId: "north" }),
      asset("2", "Pump 1", { assetClass: "Pump", siteId: "south" }),
    ]);
    expect(r.candidates).toEqual([]);
  });

  it("does NOT flag similar names in different classes", () => {
    const r = detectDuplicates([
      asset("1", "Unit 4", { assetClass: "Pump", siteId: "s" }),
      asset("2", "Unit 4", { assetClass: "Compressor", siteId: "s" }),
    ]);
    expect(r.candidates).toEqual([]);
  });

  it("raises a same-site same-class name match as evidence, not proof", () => {
    const r = detectDuplicates([
      asset("1", "Slurry Pump 4", { assetClass: "Pump", siteId: "s" }),
      asset("2", "slurry pump 4", { assetClass: "Pump", siteId: "s" }),
    ]);
    expect(r.candidates[0].confidence).toBe("probable");
    expect(r.candidates[0].basis).toMatch(/evidence, not proof/);
  });

  it("does not flag genuinely different units of the same class", () => {
    // "Dozer 5390" and "Dozer 5509" share one token of three.
    const r = detectDuplicates([
      asset("1", "Dozer 5390", { assetClass: "Dozer", siteId: "s" }),
      asset("2", "Dozer 5509", { assetClass: "Dozer", siteId: "s" }),
    ]);
    expect(r.candidates).toEqual([]);
  });

  it("warns when only name similarity was available to compare on", () => {
    const r = detectDuplicates([
      asset("1", "Dozer 5390", { assetClass: "Dozer" }),
      asset("2", "Dozer 5509", { assetClass: "Dozer" }),
    ]);
    expect(r.comparableOn).toEqual(["name similarity"]);
    expect(r.reason).toMatch(/would not have been found/);
  });

  it("never merges, and says so", () => {
    const r = detectDuplicates([
      asset("1", "P", { tag: "X" }),
      asset("2", "Q", { tag: "X" }),
    ]);
    expect(r.reason).toMatch(/Nothing is merged/);
    expect(r.reason).toMatch(/more expensive to undo than a missed one/);
  });
});

describe("validateReading", () => {
  const RULE = {
    minValue: 0,
    maxValue: 100,
    physicalMin: -10,
    physicalMax: 200,
    maxRatePerHour: 20,
    stuckAfterReadings: 4,
  };

  const at = (h: number) => new Date(h * 3_600_000).toISOString();

  it("accepts a normal reading", () => {
    const r = validateReading(
      [
        { at: at(0), value: 40 },
        { at: at(1), value: 45 },
      ],
      RULE,
    );
    expect(r.verdict).toBe("valid");
    expect(r.usable).toBe(true);
  });

  it("distinguishes out-of-range (keep) from impossible (discard)", () => {
    const high = validateReading(
      [
        { at: at(0), value: 100 },
        { at: at(10), value: 110 },
      ],
      RULE,
    );
    expect(high.verdict).toBe("out_of_range");
    expect(high.usable).toBe(true);
    expect(high.reason).toMatch(/may be a real excursion and is kept/);

    const impossible = validateReading([{ at: at(0), value: 5000 }], RULE);
    expect(impossible.verdict).toBe("physically_impossible");
    expect(impossible.usable).toBe(false);
    expect(impossible.reason).toMatch(/the instrument, not the process/);
  });

  it("catches a stuck sensor and names it the dangerous case", () => {
    const r = validateReading(
      [0, 1, 2, 3].map((h) => ({ at: at(h), value: 47.3 })),
      RULE,
    );
    expect(r.verdict).toBe("stuck");
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/a flat line looks like health/);
  });

  it("does not call a genuinely steady process stuck below the threshold", () => {
    const r = validateReading(
      [0, 1, 2].map((h) => ({ at: at(h), value: 47.3 })),
      RULE,
    );
    expect(r.verdict).not.toBe("stuck");
  });

  it("catches an implausible rate of change", () => {
    // 40 -> 90 in one hour is 50/h against a 20/h maximum.
    const r = validateReading(
      [
        { at: at(0), value: 40 },
        { at: at(1), value: 90 },
      ],
      RULE,
    );
    expect(r.verdict).toBe("rate_implausible");
    expect(r.reason).toMatch(
      /Either the reading is wrong or the timestamps are/,
    );
  });

  it("returns no_data rather than valid when there is nothing to check", () => {
    // An empty history must never render as a pass: an unusable count beside a
    // green verdict is exactly the contradiction this guards.
    const r = validateReading([], RULE);
    expect(r.verdict).toBe("no_data");
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/This is not a pass/);
    expect(r.reason).toMatch(
      /an unread sensor and a healthy one look identical/,
    );
  });
});
