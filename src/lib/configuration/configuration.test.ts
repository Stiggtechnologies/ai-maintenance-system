/**
 * Validation for configuration management.
 *
 * The failure this module exists to prevent is a dashboard that shows a clean
 * configuration for an asset nobody has ever walked down. So the tests that
 * matter most are the ones proving that "matches" and "never checked" are
 * different answers, and that a lapsed approval stops covering a difference.
 *
 * Dates are passed in rather than read from the clock, so every expiry and
 * overdue figure below is exact arithmetic rather than a moving target.
 */
import { describe, expect, it } from "vitest";
import {
  compareBaselines,
  assessTemporaryModifications,
  reconciliationStatus,
  type Baseline,
  type TempMod,
} from "./index";

const NOW = new Date("2026-08-09T00:00:00Z");

const DESIGNED: Baseline = {
  kind: "as_designed",
  revision: 3,
  sourceReference: "P-101 GA drawing rev C",
  items: [
    {
      positionRef: "impeller",
      partNumber: "IMP-250",
      quantity: 1,
      safetyCritical: false,
    },
    {
      positionRef: "trip relay",
      partNumber: "RLY-9",
      quantity: 1,
      safetyCritical: true,
      safetyBasis: "High-vibration trip; loss of trip defeats the protection",
    },
    {
      positionRef: "controller",
      partNumber: "PLC-A",
      quantity: 1,
      firmwareVersion: "4.2.1",
      safetyCritical: false,
    },
    {
      positionRef: "mech seal",
      partNumber: "SEAL-77",
      quantity: 2,
      safetyCritical: false,
    },
  ],
};

describe("the distinction the module exists for", () => {
  it("REFUSES to compare when there is no as-designed baseline", () => {
    const r = compareBaselines(null, { ...DESIGNED, kind: "as_maintained" });
    expect(r.comparable).toBe(false);
    expect(r.differences).toEqual([]);
    expect(r.reason).toMatch(/no as-designed baseline/i);
    expect(r.reason).toMatch(/not the same as finding no differences/i);
  });

  it("REFUSES to compare when nobody has walked the asset down", () => {
    const r = compareBaselines(DESIGNED, null);
    expect(r.comparable).toBe(false);
    expect(r.reason).toMatch(/no current as-maintained baseline/i);
    expect(r.reason).toMatch(/walkdown/i);
  });

  it("reports a genuine match as a real result, not an empty one", () => {
    const r = compareBaselines(DESIGNED, {
      ...DESIGNED,
      kind: "as_maintained",
    });
    expect(r.comparable).toBe(true);
    expect(r.differences).toEqual([]);
    expect(r.reason).toMatch(/This is a real result: both baselines exist/i);
  });
});

describe("what differs", () => {
  const maintained: Baseline = {
    kind: "as_maintained",
    revision: 1,
    items: [
      // A smaller impeller than specified.
      {
        positionRef: "impeller",
        partNumber: "IMP-230",
        quantity: 1,
        safetyCritical: false,
      },
      // The trip relay is gone entirely.
      // Firmware has moved on without a work order.
      {
        positionRef: "controller",
        partNumber: "PLC-A",
        quantity: 1,
        firmwareVersion: "4.4.0",
        safetyCritical: false,
      },
      // One seal instead of two.
      {
        positionRef: "mech seal",
        partNumber: "SEAL-77",
        quantity: 1,
        safetyCritical: false,
      },
      // Something the design does not mention at all.
      {
        positionRef: "aux filter",
        partNumber: "FLT-2",
        quantity: 1,
        safetyCritical: false,
      },
    ],
  };

  const r = compareBaselines(DESIGNED, maintained, [], NOW);

  it("finds every kind of difference and no others", () => {
    expect(r.differences.map((d) => d.kind).sort()).toEqual(
      [
        "firmware_differs",
        "missing",
        "part_differs",
        "quantity_differs",
        "unexpected",
      ].sort(),
    );
  });

  it("ranks the safety-critical loss first", () => {
    expect(r.differences[0].positionRef).toBe("trip relay");
    expect(r.differences[0].kind).toBe("missing");
    expect(r.differences[0].safetyCritical).toBe(true);
    expect(r.safetyCriticalCount).toBe(1);
  });

  it("names a firmware change as the thing a CMMS cannot see", () => {
    const fw = r.differences.find((d) => d.kind === "firmware_differs");
    expect(fw?.expected).toBe("4.2.1");
    expect(fw?.actual).toBe("4.4.0");
    expect(fw?.detail).toMatch(/invisible to a CMMS/i);
  });

  it("flags an item the design does not describe", () => {
    const x = r.differences.find((d) => d.kind === "unexpected");
    expect(x?.positionRef).toBe("aux filter");
    expect(x?.detail).toMatch(
      /design is out of date or the item should not be there/i,
    );
  });

  it("does not invent a firmware difference where the design states none", () => {
    // The impeller has no specified firmware; silence is not a mismatch.
    expect(
      r.differences.some(
        (d) => d.positionRef === "impeller" && d.kind === "firmware_differs",
      ),
    ).toBe(false);
  });
});

describe("substitutions", () => {
  const maintained: Baseline = {
    kind: "as_maintained",
    revision: 1,
    items: [
      {
        positionRef: "impeller",
        partNumber: "IMP-230",
        quantity: 1,
        safetyCritical: false,
      },
      {
        positionRef: "trip relay",
        partNumber: "RLY-9",
        quantity: 1,
        safetyCritical: true,
        safetyBasis: "High-vibration trip",
      },
      {
        positionRef: "controller",
        partNumber: "PLC-A",
        quantity: 1,
        firmwareVersion: "4.2.1",
        safetyCritical: false,
      },
      {
        positionRef: "mech seal",
        partNumber: "SEAL-77",
        quantity: 2,
        safetyCritical: false,
      },
    ],
  };

  it("clears a difference covered by a current approval", () => {
    const r = compareBaselines(
      DESIGNED,
      maintained,
      [
        {
          specified: "IMP-250",
          substitute: "IMP-230",
          conditions: "Below 1450 rpm only",
          expiresAt: "2027-01-01T00:00:00Z",
        },
      ],
      NOW,
    );
    const d = r.differences[0];
    expect(d.approved).toBe(true);
    expect(d.approvalExpired).toBe(false);
    expect(d.detail).toMatch(/Below 1450 rpm only/);
    expect(r.unapprovedCount).toBe(0);
  });

  it("re-reports the difference once the approval has lapsed", () => {
    const r = compareBaselines(
      DESIGNED,
      maintained,
      [
        {
          specified: "IMP-250",
          substitute: "IMP-230",
          expiresAt: "2026-01-01T00:00:00Z",
        },
      ],
      NOW,
    );
    expect(r.differences[0].approved).toBe(false);
    expect(r.differences[0].approvalExpired).toBe(true);
    expect(r.differences[0].detail).toMatch(
      /A lapsed approval is not an approval/i,
    );
    // Shown to the day, not as a raw timestamp.
    expect(r.differences[0].detail).toMatch(/expired on 2026-01-01\./);
    expect(r.unapprovedCount).toBe(1);
  });

  /** Same baseline with one part swapped, so direction is unambiguous. */
  const withImpeller = (b: Baseline, part: string): Baseline => ({
    ...b,
    items: b.items.map((i) =>
      i.positionRef === "impeller" ? { ...i, partNumber: part } : i,
    ),
  });

  // The approval reads: fit IMP-230 where IMP-250 is specified. Reversing the
  // roles — IMP-250 fitted where IMP-230 is specified — is the case it must
  // NOT cover unless it says it is bidirectional.
  const designed230 = withImpeller(DESIGNED, "IMP-230");
  const maintained250 = withImpeller(maintained, "IMP-250");

  it("only applies a one-way approval in its stated direction", () => {
    const r = compareBaselines(
      designed230,
      maintained250,
      [{ specified: "IMP-250", substitute: "IMP-230", bidirectional: false }],
      NOW,
    );
    expect(r.differences).toHaveLength(1);
    expect(r.differences[0].approved).toBe(false);
  });

  it("applies a bidirectional approval both ways", () => {
    const r = compareBaselines(
      designed230,
      maintained250,
      [{ specified: "IMP-250", substitute: "IMP-230", bidirectional: true }],
      NOW,
    );
    expect(r.differences).toHaveLength(1);
    expect(r.differences[0].approved).toBe(true);
  });
});

describe("temporary modifications", () => {
  const mods: TempMod[] = [
    {
      id: 1,
      assetName: "Pump P-101",
      modificationKind: "jumper",
      description: "Vibration trip jumpered out",
      requiredRemovalBy: "2022-06-01",
      installedAt: "2022-05-25T00:00:00Z",
      affectsSafetyFunction: true,
      riskAssessmentRef: "RA-4471",
    },
    {
      id: 2,
      assetName: "Conveyor C-22",
      modificationKind: "temporary_repair",
      description: "Belt splice clamp",
      requiredRemovalBy: "2026-09-01",
      installedAt: "2026-07-01T00:00:00Z",
      affectsSafetyFunction: false,
    },
    {
      id: 3,
      assetName: "Compressor K-05",
      modificationKind: "bypass",
      description: "Lube pressure switch bypassed",
      requiredRemovalBy: "2026-01-15",
      installedAt: "2025-12-20T00:00:00Z",
      affectsSafetyFunction: false,
    },
    {
      id: 4,
      assetName: "Pump P-201",
      modificationKind: "jumper",
      description: "Removed correctly",
      requiredRemovalBy: "2024-01-01",
      installedAt: "2023-12-01T00:00:00Z",
      removedAt: "2023-12-28T00:00:00Z",
      affectsSafetyFunction: true,
    },
  ];

  const a = assessTemporaryModifications(mods, NOW);

  it("counts only what is still fitted", () => {
    expect(a.open).toBe(3); // #4 was removed
    expect(a.overdue).toBe(2); // #2 is not yet due
  });

  it("measures the overdue period in days, exactly", () => {
    // 2022-06-01 to 2026-08-09 is 1530 days.
    expect(a.longestOverdueDays).toBe(1530);
    expect(a.reason).toMatch(/4\.2 years/);
  });

  it("puts a defeated safety function at the top", () => {
    expect(a.worst[0].id).toBe(1);
    expect(a.overdueSafety).toBe(1);
    // Singular, because exactly one does.
    expect(a.reason).toMatch(/1 of them defeats a safety function/i);
  });

  it("counts open modifications with no risk assessment", () => {
    expect(a.withoutRiskAssessment).toBe(2);
    expect(a.reason).toMatch(
      /2 open modifications carry no risk-assessment reference/i,
    );
  });

  it("does not read an empty register as an absence of jumpers", () => {
    const none = assessTemporaryModifications([], NOW);
    expect(none.reason).toMatch(
      /not being captured rather than that there are none/i,
    );
  });
});

describe("reconciliation status", () => {
  it("says plainly when an asset has never been checked", () => {
    const r = reconciliationStatus(null, NOW);
    expect(r.overdue).toBe(true);
    expect(r.reason).toMatch(/has never been reconciled/i);
    expect(r.reason).toMatch(/nobody has verified against the equipment/i);
  });

  it("calls a stale reconciliation a claim about the past", () => {
    const r = reconciliationStatus(
      {
        performedAt: "2024-01-01T00:00:00Z",
        trigger: "outage",
        differencesFound: 3,
      },
      NOW,
    );
    expect(r.daysSince).toBe(951);
    expect(r.overdue).toBe(true);
    expect(r.reason).toMatch(/a claim about the past/i);
  });

  it("accepts a recent one without editorialising", () => {
    const r = reconciliationStatus(
      {
        performedAt: "2026-05-01T00:00:00Z",
        trigger: "project",
        differencesFound: 0,
      },
      NOW,
    );
    expect(r.overdue).toBe(false);
    expect(r.reason).not.toMatch(/claim about the past/i);
  });
});
