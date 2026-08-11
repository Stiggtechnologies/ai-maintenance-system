import { describe, expect, it } from "vitest";
import {
  assessApplicability,
  assessFleet,
  proposeInterchange,
  type AssetForBulletin,
  type OemBulletin,
} from "./index";

const recall: OemBulletin = {
  bulletinRef: "PSP-2026-014",
  kind: "safety",
  manufacturer: "Caterpillar",
  title: "Final drive retaining bolt torque",
  models: ["D10T"],
  serialFrom: "3KR00100",
  serialTo: "3KR00500",
  mandatory: true,
};

const asset = (o: Partial<AssetForBulletin> = {}): AssetForBulletin => ({
  id: "a1",
  tag: "5501",
  manufacturer: "Caterpillar",
  model: "D10T",
  serialNumber: "3KR00250",
  ...o,
});

describe("assessApplicability", () => {
  it("confirms a machine inside the published serial range", () => {
    const r = assessApplicability(recall, asset());
    expect(r.verdict).toBe("affected");
    expect(r.basis).toBe("serial_range");
  });

  it("rules out a machine of the right model outside the range", () => {
    const r = assessApplicability(recall, asset({ serialNumber: "3KR00900" }));
    expect(r.verdict).toBe("not_affected");
    expect(r.basis).toBe("serial_range");
    expect(r.reason).toMatch(/does not carry the affected part/);
  });

  it("orders serials numerically, not lexically", () => {
    // "3KR9" > "3KR00500" as strings. Lexical comparison would exclude this
    // machine from a mandatory recall it is squarely inside.
    const r = assessApplicability(recall, asset({ serialNumber: "3KR9" }));
    expect(r.verdict).toBe("not_affected"); // 9 < 100, correctly below the range
    const inside = assessApplicability(
      recall,
      asset({ serialNumber: "3KR101" }),
    );
    expect(inside.verdict).toBe("affected");
  });

  it("says POSSIBLY affected when the model matches and no serial is recorded", () => {
    // The real operator situation: 0 of 144 assets have a serial.
    const r = assessApplicability(recall, asset({ serialNumber: null }));
    expect(r.verdict).toBe("possibly_affected");
    expect(r.basis).toBe("model_only");
    expect(r.reason).toMatch(
      /only some builds of a model carry the affected part/,
    );
    // A mandatory bulletin says so, because the consequence differs.
    expect(r.reason).toMatch(/unresolved safety question/);
  });

  it("distinguishes unassessable from not applicable", () => {
    const r = assessApplicability(
      recall,
      asset({ serialNumber: null, model: null, manufacturer: null }),
    );
    expect(r.verdict).toBe("indeterminate");
    expect(r.reason).toMatch(/not the same as it not applying/);
  });

  it("rules out another manufacturer's machine", () => {
    const r = assessApplicability(recall, asset({ manufacturer: "Komatsu" }));
    expect(r.verdict).toBe("not_affected");
    expect(r.basis).toBe("manufacturer_mismatch");
  });

  it("falls back rather than failing on an unparseable serial", () => {
    const r = assessApplicability(
      recall,
      asset({ serialNumber: "UNKNOWN-XY" }),
    );
    expect(r.verdict).toBe("possibly_affected");
    expect(r.reason).toMatch(/over-broad/);
  });

  it("does not place a serial from a different prefix inside the range", () => {
    // 7XM00250 is numerically inside 100–500 and is a different build entirely.
    const r = assessApplicability(recall, asset({ serialNumber: "7XM00250" }));
    expect(r.verdict).toBe("not_affected");
  });
});

describe("assessFleet", () => {
  const fleet: AssetForBulletin[] = [
    asset({ id: "in", serialNumber: "3KR00200" }),
    asset({ id: "out", serialNumber: "3KR00800" }),
    asset({ id: "noserial", serialNumber: null }),
    asset({ id: "blank", serialNumber: null, model: null, manufacturer: null }),
    asset({ id: "other", manufacturer: "Komatsu" }),
  ];

  it("counts the three verdicts separately", () => {
    const r = assessFleet(recall, fleet);
    expect(r.affected.map((a) => a.assetId)).toEqual(["in"]);
    expect(r.possiblyAffected.map((a) => a.assetId)).toEqual(["noserial"]);
    expect(r.indeterminate.map((a) => a.assetId)).toEqual(["blank"]);
    expect(r.notAffected).toBe(2);
  });

  it("is not conclusive while any machine lacks a serial", () => {
    const r = assessFleet(recall, fleet);
    expect(r.conclusive).toBe(false);
    expect(r.reason).toMatch(/THIS BULLETIN IS MANDATORY/);
    expect(r.reason).toMatch(/open safety exposure/);
  });

  it("is conclusive when every machine has a serial", () => {
    const r = assessFleet(recall, [
      asset({ id: "a", serialNumber: "3KR00200" }),
      asset({ id: "b", serialNumber: "3KR00900" }),
    ]);
    expect(r.conclusive).toBe(true);
    expect(r.reason).toMatch(/a finding rather than a question/);
  });

  it("softens the language for a non-mandatory bulletin", () => {
    const r = assessFleet({ ...recall, mandatory: false }, fleet);
    expect(r.reason).not.toMatch(/MANDATORY/);
    expect(r.reason).toMatch(/upper bound on what needs doing/);
  });
});

describe("proposeInterchange", () => {
  const supersession: OemBulletin = {
    bulletinRef: "SUP-114-3392",
    kind: "supersession",
    manufacturer: "Caterpillar",
    title: "Track roller superseded",
    models: ["D10T"],
    serialFrom: null,
    serialTo: null,
    fromPartNumber: "1234567",
    toPartNumber: "7654321",
    mandatory: false,
  };

  it("proposes one-way, never two-way", () => {
    const impact = assessFleet(supersession, [asset({ serialNumber: "3KR1" })]);
    const p = proposeInterchange(supersession, impact)!;
    // Two-way would let somebody fit the superseded part to a machine built
    // for the replacement.
    expect(p.interchangeKind).toBe("one_way");
    expect(p.reason).toMatch(/not that it is acceptable in every position/);
  });

  it("includes possibly-affected assets so the change is not under-scoped", () => {
    const impact = assessFleet(supersession, [
      asset({ id: "sure", serialNumber: "3KR1" }),
      asset({ id: "maybe", serialNumber: null }),
    ]);
    const p = proposeInterchange(supersession, impact)!;
    expect(p.affectedAssetIds.sort()).toEqual(["maybe", "sure"]);
    expect(p.reason).toMatch(/not under-scoped/);
    expect(p.reason).toMatch(/not over-claimed/);
  });

  it("returns nothing for a bulletin that is not a supersession", () => {
    const impact = assessFleet(recall, [asset()]);
    expect(proposeInterchange(recall, impact)).toBeNull();
  });
});
