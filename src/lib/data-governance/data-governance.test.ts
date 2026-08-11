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

/**
 * Architecture inference and reclassification detection.
 *
 * Both were added after a real investigation on a 144-asset fleet where every
 * free-text field was empty, thirteen assets were mislabelled, and ten more
 * were the same machine recorded twice. The fixtures below are the real
 * numbers from that fleet, so these tests pin the cases that actually occurred
 * rather than invented ones.
 */
import {
  inferArchitecture,
  checkClassAgainstArchitecture,
  detectReclassifications,
  detectDormancy,
  type ArchitectureMarkers,
  type ActivityWindow,
} from "./index";

const MARKERS: ArchitectureMarkers = {
  tracked: ["UNDERCARRIAGE"],
  wheeled: [
    "TIRES/RIMS",
    "TRANSMISSION GROUP",
    "DIFFERENTIAL GROUP",
    "STEERING SYSTEM",
  ],
  boom: ["BOOM GROUP", "BUCKET/STICK GROUP"],
};

describe("inferArchitecture", () => {
  it("calls the real 64-series excavators tracked", () => {
    // Actual counts: 71 undercarriage, 40 bucket/stick, 9 boom, zero wheeled.
    const r = inferArchitecture(
      [
        { systemGroup: "UNDERCARRIAGE", count: 71 },
        { systemGroup: "BUCKET/STICK GROUP", count: 40 },
        { systemGroup: "BOOM GROUP", count: 9 },
        { systemGroup: "ENGINE GROUP", count: 120 },
      ],
      MARKERS,
    );
    expect(r.architecture).toBe("tracked");
    expect(r.provisional).toBe(false);
    expect(r.reason).toMatch(/NO wheeled ones/);
    expect(r.reason).toMatch(/front-end attachment/);
  });

  it("calls the real 67-series wheeled despite them being labelled Shovel", () => {
    // Actual counts: 38 transmission, 9 differential, 9 tires, ZERO undercarriage.
    const r = inferArchitecture(
      [
        { systemGroup: "TRANSMISSION GROUP", count: 38 },
        { systemGroup: "DIFFERENTIAL GROUP", count: 9 },
        { systemGroup: "TIRES/RIMS", count: 9 },
        { systemGroup: "BUCKET/STICK GROUP", count: 29 },
        { systemGroup: "BOOM GROUP", count: 15 },
      ],
      MARKERS,
    );
    expect(r.architecture).toBe("wheeled");
    expect(r.trackedEvents).toBe(0);
    expect(r.wheeledEvents).toBe(56);
  });

  it("flags a thin history as a hint rather than a finding", () => {
    // The real 6601: 21 work orders total.
    const r = inferArchitecture(
      [
        { systemGroup: "TRANSMISSION GROUP", count: 2 },
        { systemGroup: "BUCKET/STICK GROUP", count: 1 },
        { systemGroup: "ENGINE GROUP", count: 1 },
      ],
      MARKERS,
      30,
    );
    expect(r.architecture).toBe("wheeled");
    expect(r.provisional).toBe(true);
    expect(r.reason).toMatch(/a hint, not a finding/);
  });

  it("REFUSES to read an absent history as agreement", () => {
    const r = inferArchitecture([], MARKERS);
    expect(r.architecture).toBe("indeterminate");
    expect(r.reason).toMatch(/not evidence that the recorded class is right/);
  });

  it("reports mixed markers as a vocabulary or data problem, not a verdict", () => {
    const r = inferArchitecture(
      [
        { systemGroup: "UNDERCARRIAGE", count: 20 },
        { systemGroup: "TIRES/RIMS", count: 20 },
      ],
      MARKERS,
    );
    expect(r.architecture).toBe("mixed");
    expect(r.reason).toMatch(/more than one machine, or the marker vocabulary/);
  });
});

describe("checkClassAgainstArchitecture", () => {
  const EXPECT = [
    { assetClass: "Shovel", expected: "tracked" as const },
    { assetClass: "Wheel Loader", expected: "wheeled" as const },
  ];

  it("catches the real mislabelling: Shovel that is wheeled", () => {
    const v = inferArchitecture(
      [
        { systemGroup: "TRANSMISSION GROUP", count: 38 },
        { systemGroup: "TIRES/RIMS", count: 9 },
      ],
      MARKERS,
    );
    const c = checkClassAgainstArchitecture("Shovel", v, EXPECT);
    expect(c.agrees).toBe(false);
    expect(c.reason).toMatch(/Either the class is wrong/);
  });

  it("confirms a class the history agrees with", () => {
    const v = inferArchitecture(
      [{ systemGroup: "TIRES/RIMS", count: 40 }],
      MARKERS,
    );
    expect(
      checkClassAgainstArchitecture("Wheel Loader", v, EXPECT).agrees,
    ).toBe(true);
  });

  it("returns null rather than agreement when nothing can be resolved", () => {
    const v = inferArchitecture([], MARKERS);
    const c = checkClassAgainstArchitecture("Shovel", v, EXPECT);
    expect(c.agrees).toBeNull();
    expect(c.reason).toMatch(/neither confirms nor contradicts/);
  });

  it("returns null for a class with no recorded expectation", () => {
    const v = inferArchitecture(
      [{ systemGroup: "TIRES/RIMS", count: 40 }],
      MARKERS,
    );
    expect(
      checkClassAgainstArchitecture("Transporter", v, EXPECT).agrees,
    ).toBeNull();
  });
});

describe("detectReclassifications", () => {
  // The real 5303 pair.
  const DOZER: ActivityWindow = {
    assetId: "a",
    label: "Dozer 5303",
    identifier: "5303",
    assetClass: "Dozer",
    firstActivity: "2010-01-05",
    lastActivity: "2012-04-18",
    eventCount: 194,
  };
  const SUPPORT: ActivityWindow = {
    assetId: "b",
    label: "Support Dozer 5303",
    identifier: "5303",
    assetClass: "Support Dozer",
    firstActivity: "2012-04-20",
    lastActivity: "2012-07-30",
    eventCount: 28,
  };

  it("finds the handover the similarity detector cannot", () => {
    const r = detectReclassifications([DOZER, SUPPORT]);
    expect(r.reclassifications).toHaveLength(1);
    expect(r.reclassifications[0].gapDays).toBe(2);
    expect(r.reclassifications[0].earlier.label).toBe("Dozer 5303");
    expect(r.reclassifications[0].reason).toMatch(
      /why a similarity-based duplicate check would not find this/,
    );
  });

  it("does not depend on which record is supplied first", () => {
    const forward = detectReclassifications([DOZER, SUPPORT]);
    const reverse = detectReclassifications([SUPPORT, DOZER]);
    expect(reverse.reclassifications).toHaveLength(1);
    expect(reverse.reclassifications[0].earlier.label).toBe(
      forward.reclassifications[0].earlier.label,
    );
  });

  it("separates a CONCURRENT shared identifier as the worse problem", () => {
    const overlapping: ActivityWindow = {
      ...SUPPORT,
      firstActivity: "2011-01-01",
      lastActivity: "2012-06-01",
    };
    const r = detectReclassifications([DOZER, overlapping]);
    expect(r.reclassifications).toEqual([]);
    expect(r.concurrent).toHaveLength(1);
    expect(r.concurrent[0].reason).toMatch(
      /every figure keyed on that identifier is ambiguous/,
    );
  });

  it("ignores a gap too long to be a handover", () => {
    const muchLater: ActivityWindow = {
      ...SUPPORT,
      firstActivity: "2019-01-01",
      lastActivity: "2019-06-01",
    };
    const r = detectReclassifications([DOZER, muchLater], 90);
    expect(r.reclassifications).toEqual([]);
  });

  it("says so plainly when nothing shares an identifier", () => {
    const r = detectReclassifications([
      DOZER,
      { ...SUPPORT, identifier: "9999" },
    ]);
    expect(r.reason).toMatch(/No shared identifier shows either a handover/);
  });
});

describe("detectDormancy", () => {
  // The real 6601 against the real dataset end.
  const SIX601 = {
    assetId: "6601",
    label: "Shovel 6601",
    firstActivity: "2010-01-01",
    lastActivity: "2010-04-04",
    eventCount: 21,
  };
  const BUSY = {
    assetId: "5303",
    label: "Dozer 5303",
    firstActivity: "2010-01-05",
    lastActivity: "2012-07-30",
    eventCount: 222,
  };
  const END = "2012-07-30";

  it("separates TRUNCATED from low usage, which an average cannot", () => {
    const [worst] = detectDormancy([SIX601, BUSY], END);
    expect(worst.assetId).toBe("6601");
    expect(worst.pattern).toBe("truncated");
    // 93 active days over 21 events = 4.4 days/event: as intense as the busiest.
    expect(worst.daysPerEvent).toBeCloseTo(93 / 21, 1);
    expect(worst.dormantDays).toBeGreaterThan(800);
    expect(worst.reason).toMatch(
      /That is not low usage; it is an asset that stopped/,
    );
  });

  it("does not flag a genuinely busy asset", () => {
    const r = detectDormancy([BUSY], END);
    expect(r[0].pattern).toBe("active");
  });

  it("calls a thinly-but-continuously used asset low intensity, not truncated", () => {
    const r = detectDormancy(
      [
        {
          assetId: "x",
          label: "Rarely used",
          firstActivity: "2010-01-01",
          lastActivity: "2012-07-01",
          eventCount: 8,
        },
      ],
      END,
    );
    expect(r[0].pattern).toBe("low_intensity");
    expect(r[0].reason).toMatch(
      /Genuinely light duty rather than a machine that stopped/,
    );
  });

  it("measures dormancy against the DATASET end, not today", () => {
    // Against a 2012 extract this asset is active; against today it is not,
    // and that would be a fact about the extract rather than the machine.
    const r = detectDormancy([BUSY], END);
    expect(r[0].dormantDays).toBe(0);
  });

  it("refuses to characterise a single event", () => {
    const r = detectDormancy(
      [
        {
          assetId: "y",
          label: "One",
          firstActivity: "2011-01-01",
          lastActivity: "2011-01-01",
          eventCount: 1,
        },
      ],
      END,
    );
    expect(r[0].pattern).toBe("single_event");
    expect(r[0].reason).toMatch(
      /Nothing can be said about intensity or dormancy/,
    );
  });
});
