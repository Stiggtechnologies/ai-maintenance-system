import { describe, expect, it } from "vitest";
import {
  assembleDraft,
  deriveComponents,
  type ComponentSignature,
  type FailureModeSource,
} from "./index";

// The real operator signature for the Dozer class, top groups.
const dozer: ComponentSignature[] = [
  { systemGroup: "UNDERCARRIAGE", events: 382, downtimeHours: 29822.4 },
  { systemGroup: "HYDRAULIC SYSTEM", events: 630, downtimeHours: 9170.4 },
  { systemGroup: "TRANSMISSION GROUP", events: 131, downtimeHours: 9136.1 },
  { systemGroup: "ENGINE GROUP", events: 427, downtimeHours: 8143.9 },
  { systemGroup: "GROUND ENGAGING TOOL", events: 1064, downtimeHours: 4618.7 },
  { systemGroup: "CAB GROUP", events: 145, downtimeHours: 1335.6 },
  { systemGroup: "ICE LUGS", events: 3, downtimeHours: 40 },
];

describe("deriveComponents", () => {
  it("ranks by consequence, not by how often something is written up", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 8954,
      codedWorkOrders: 3302,
    });
    // GET is the most frequent by a wide margin (1064 events) and undercarriage
    // is the most consequential (29,822 hours). Ranking by event count would
    // put the cheap one first.
    expect(r.components[0].code).toBe("UNDERCARRIAGE");
    expect(r.components.map((c) => c.code)).not.toContain("ICE-LUGS");
  });

  it("separates a rare-and-crippling component from a frequent-and-quick one", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 8954,
      codedWorkOrders: 3302,
    });
    const uc = r.components.find((c) => c.code === "UNDERCARRIAGE")!;
    const get = r.components.find((c) => c.code === "GROUND-ENGAGING-TOOL")!;

    expect(uc.profile).toBe("high_consequence");
    expect(uc.reason).toMatch(/Availability lives here/);
    expect(get.profile).toBe("high_frequency");
    expect(get.reason).toMatch(
      /where labour and parts cost accumulate, not where availability is lost/,
    );
  });

  it("drops groups too thin to be components and says they are not absent", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 8954,
      codedWorkOrders: 3302,
    });
    expect(r.excludedBelowThreshold).toBe(1);
    expect(r.reason).toMatch(
      /not absent from the machine, only from the evidence/,
    );
  });

  it("warns that a third-coded history shows what gets coded, not what fails", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 8954,
      codedWorkOrders: 3302,
    });
    expect(r.codingCoverage).toBeCloseTo(0.3688, 3);
    expect(r.reason).toMatch(/components that get CODED/);
    expect(r.reason).toMatch(/strong starting point and a poor final answer/);
  });

  it("does not warn when coverage is high", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 1000,
      codedWorkOrders: 900,
    });
    expect(r.reason).toMatch(/broadly representative/);
  });

  it("refuses when nothing clears the threshold", () => {
    const r = deriveComponents({
      signatures: [{ systemGroup: "X", events: 2, downtimeHours: 5 }],
      totalWorkOrders: 100,
      codedWorkOrders: 4,
    });
    expect(r.derivable).toBe(false);
    expect(r.reason).toMatch(/anecdote rather than a component/);
  });

  it("states in the provenance that failure modes are NOT derived", () => {
    const r = deriveComponents({
      signatures: dozer,
      totalWorkOrders: 8954,
      codedWorkOrders: 3302,
    });
    expect(r.provenanceNote).toMatch(
      /duplicates the system group in every coded row/,
    );
    expect(r.provenanceNote).toMatch(
      /the part a reviewer should check hardest/,
    );
  });
});

describe("assembleDraft", () => {
  const derived = deriveComponents({
    signatures: dozer,
    totalWorkOrders: 8954,
    codedWorkOrders: 3302,
  });

  const modes: FailureModeSource[] = [
    {
      code: "UC-SEAL",
      name: "Roller or idler seal loss",
      componentCode: "UNDERCARRIAGE",
      detectableBy: ["visual inspection", "oil leak"],
      source: "Dozer undercarriage inspection guidance",
    },
  ];

  it("attaches published modes to derived components", () => {
    const d = assembleDraft(
      "Large mining dozer",
      "mobile_mining_support",
      derived,
      modes,
    );
    const uc = d.components.find((c) => c.code === "UNDERCARRIAGE")!;
    expect(uc.origin).toBe("derived_from_history");
    expect(uc.failureModes[0].origin).toBe("published_engineering");
    // The evidence travels with the component so a reviewer can weigh it.
    expect(uc.evidence.events).toBe(382);
  });

  it("leaves a component with no published mode EMPTY rather than inventing one", () => {
    const d = assembleDraft(
      "Large mining dozer",
      "mobile_mining_support",
      derived,
      modes,
    );
    const engine = d.components.find((c) => c.code === "ENGINE-GROUP")!;
    expect(engine.failureModes).toHaveLength(0);
    // And says so, so the gap is visible rather than looking complete.
    expect(d.componentsWithoutModes).toContain("Engine Group");
  });

  it("would be refused by the promotion gate only if it had no components", () => {
    const d = assembleDraft(
      "Large mining dozer",
      "mobile_mining_support",
      derived,
      modes,
    );
    // The gate refuses zero components. This draft has six, so it is promotable
    // once an engineer reviews it — which is the point of producing it.
    expect(d.components.length).toBeGreaterThan(0);
    expect(d.description).toMatch(/Not reviewed by an engineer/);
  });
});
