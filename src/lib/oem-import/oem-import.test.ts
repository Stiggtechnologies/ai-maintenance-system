import { describe, expect, it } from "vitest";
import {
  matchGroups,
  mergeHierarchy,
  type DerivedComponentRef,
  type OemGroup,
} from "./index";

// The real derived component codes from the MIN-DOZER draft.
const components: DerivedComponentRef[] = [
  { code: "UNDERCARRIAGE", name: "Undercarriage" },
  { code: "HYDRAULIC-SYSTEM", name: "Hydraulic System" },
  { code: "TRANSMISSION-GROUP", name: "Transmission Group" },
  { code: "ENGINE-GROUP", name: "Engine Group" },
  { code: "FINAL-DRIVE-GROUP", name: "Final Drive Group" },
  { code: "STEERING-SYSTEM", name: "Steering System" },
];

const group = (oemCode: string, name: string, items: string[]): OemGroup => ({
  oemCode,
  name,
  items: items.map((n) => ({ name: n, partNumber: null })),
});

describe("matchGroups", () => {
  it("matches across the OEM's noise words", () => {
    // "Group", "Gp", "Ar" are everywhere in a parts catalogue and discriminate
    // nothing — stripping them is what lets Undercarriage Gp find Undercarriage.
    const m = matchGroups([group("1", "Undercarriage Gp", [])], components);
    expect(m[0].verdict).toBe("matched");
    expect(m[0].componentCode).toBe("UNDERCARRIAGE");
  });

  it("refuses a tie instead of resolving it by sort order", () => {
    // "Hydraulic Steering System" is a real arrangement on these machines and
    // scores IDENTICALLY against Hydraulic System and Steering System — one
    // shared token each. Either placement would look entirely correct in a
    // tree, which is exactly why neither may be chosen.
    const m = matchGroups(
      [group("2", "Hydraulic Steering System", [])],
      components,
    );
    expect(m[0].verdict).toBe("ambiguous");
    expect(m[0].componentCode).toBeNull();
    expect(m[0].reason).toMatch(/resolving a tie by rounding/);
  });

  it("lists an OEM group the register has no name for", () => {
    const m = matchGroups(
      [group("3", "Rollover Protective Structure", [])],
      components,
    );
    expect(m[0].verdict).toBe("unmatched");
    expect(m[0].componentCode).toBeNull();
    expect(m[0].reason).toMatch(/neither is served by a guess/);
  });

  it("does not match on a shared stopword alone", () => {
    // "Cooling System" and "Steering System" share only "system", which is a
    // stopword. Without stripping it this scores 0.33 and could pass a naive
    // threshold.
    const m = matchGroups([group("4", "Cooling System", [])], components);
    expect(m[0].verdict).toBe("unmatched");
  });
});

describe("mergeHierarchy", () => {
  const oem: OemGroup[] = [
    group("1", "Undercarriage Gp", [
      "Track Roller",
      "Carrier Roller",
      "Front Idler",
      "Sprocket Segment",
      "Track Chain Assembly",
    ]),
    group("2", "Engine Gp", ["Turbocharger", "Water Pump"]),
    group("3", "Hydraulic Steering System", ["Steering Metering Pump"]),
    group("4", "Rollover Protective Structure", ["Canopy"]),
  ];

  it("adds real depth under the components it matched", () => {
    const r = mergeHierarchy(oem, components);
    const uc = r.additions.find((a) => a.componentCode === "UNDERCARRIAGE")!;
    expect(uc.items).toHaveLength(5);
    expect(uc.items.map((i) => i.name)).toContain("Front Idler");
    // Provenance travels with each item so a reviewer can see where it came from.
    expect(uc.items[0].oemGroup).toBe("Undercarriage Gp");
  });

  it("attaches nothing from an ambiguous or unmatched group", () => {
    const r = mergeHierarchy(oem, components);
    const allItems = r.additions.flatMap((a) => a.items.map((i) => i.name));
    expect(allItems).not.toContain("Steering Metering Pump"); // ambiguous
    expect(allItems).not.toContain("Canopy"); // unmatched
    expect(r.ambiguous).toHaveLength(1);
    expect(r.unmatched).toHaveLength(1);
  });

  it("names the derived components that gained no depth", () => {
    const r = mergeHierarchy(oem, components);
    // Hydraulic, transmission, final drive and steering got nothing — the OEM
    // extract simply did not cover them, and a silent absence would read as
    // "these components have no parts".
    expect(r.componentsNotDeepened).toContain("Hydraulic System");
    expect(r.reason).toMatch(/gained no depth/);
  });

  it("leaves the consequence ranking alone and says so", () => {
    const r = mergeHierarchy(oem, components);
    // The merge returns ADDITIONS only. It has no mechanism to reorder or
    // reweight anything, which is deliberate.
    expect(Object.keys(r)).not.toContain("components");
    expect(r.reason).toMatch(/knows what exists without knowing what costs/);
  });

  it("handles an empty extract without claiming success", () => {
    const r = mergeHierarchy([], components);
    expect(r.matched).toBe(0);
    expect(r.additions).toHaveLength(0);
    expect(r.componentsNotDeepened).toHaveLength(components.length);
  });
});
