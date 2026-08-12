import { describe, expect, it } from "vitest";
import {
  assessTwinDepth,
  shortlistModels,
  type AssetForMatching,
  type CatalogueEntry,
} from "./model-candidates";

const catalogue: CatalogueEntry[] = [
  {
    manufacturer: "Caterpillar",
    model: "992K",
    assetClass: "Wheel Loader",
    sizeClass: "~98 t",
    maturity: "ai_extracted",
  },
  {
    manufacturer: "Caterpillar",
    model: "993K",
    assetClass: "Wheel Loader",
    sizeClass: "~133 t",
    maturity: "ai_extracted",
  },
  {
    manufacturer: "Caterpillar",
    model: "994F",
    assetClass: "Wheel Loader",
    sizeClass: "~240 t",
    maturity: "draft",
  },
  {
    manufacturer: "Caterpillar",
    model: "824H",
    assetClass: "Wheel Dozer",
    sizeClass: "~29 t",
    maturity: "ai_extracted",
  },
  {
    manufacturer: "Komatsu",
    model: "WD600",
    assetClass: "Wheel Dozer",
    sizeClass: "~40 t",
    maturity: "ai_extracted",
  },
  {
    manufacturer: "Caterpillar",
    model: "16M",
    assetClass: "Grader",
    sizeClass: "~26 t",
    maturity: "ai_extracted",
  },
];

const asset = (o: Partial<AssetForMatching>): AssetForMatching => ({
  id: "a1",
  name: "Unit 6701",
  assetClass: "Wheel Loader",
  manufacturer: null,
  model: null,
  ...o,
});

describe("shortlistModels", () => {
  it("never proposes over a model that is already recorded", () => {
    const r = shortlistModels(asset({ model: "993K" }), catalogue);
    expect(r.verdict).toBe("already_known");
    expect(r.candidates).toHaveLength(0);
    expect(r.actionable).toBe(false);
  });

  it("narrows to one make's models when the make is recorded", () => {
    const r = shortlistModels(
      asset({ manufacturer: "Caterpillar" }),
      catalogue,
    );
    expect(r.verdict).toBe("ambiguous_model");
    expect(r.candidates.map((c) => c.model)).toEqual(["992K", "993K", "994F"]);
    expect(r.actionable).toBe(false);
    expect(r.reason).toMatch(/serial number/);
  });

  it("refuses to pick a make when the asset does not record one", () => {
    const r = shortlistModels(asset({ assetClass: "Wheel Dozer" }), catalogue);
    expect(r.verdict).toBe("ambiguous_manufacturer");
    // Both makes survive. Picking Caterpillar because it is more common in the
    // fleet is exactly the fiction this refuses to produce.
    expect(new Set(r.candidates.map((c) => c.manufacturer))).toEqual(
      new Set(["Caterpillar", "Komatsu"]),
    );
    expect(r.actionable).toBe(false);
  });

  it("marks a single match actionable but still not a fact", () => {
    const r = shortlistModels(
      asset({ assetClass: "Grader", manufacturer: "Caterpillar" }),
      catalogue,
    );
    expect(r.verdict).toBe("single_candidate");
    expect(r.actionable).toBe(true);
    expect(r.reason).toMatch(/not a confirmed fact/);
    expect(r.reason).toMatch(/A person assigns it/);
  });

  it("translates a local class label through the alias map", () => {
    const withoutAlias = shortlistModels(
      asset({ assetClass: "Support Loader", manufacturer: "Caterpillar" }),
      catalogue,
    );
    // This is the bug the alias map exists to prevent: an empty result that
    // means "we call it something else" reads exactly like "nothing is known".
    expect(withoutAlias.verdict).toBe("no_candidates");

    const withAlias = shortlistModels(
      asset({ assetClass: "Support Loader", manufacturer: "Caterpillar" }),
      catalogue,
      { "Support Loader": "Wheel Loader" },
    );
    expect(withAlias.verdict).toBe("ambiguous_model");
    expect(withAlias.candidates).toHaveLength(3);
    expect(withAlias.reason).toMatch(/Read as catalogue class "Wheel Loader"/);
  });

  it("says nothing is known rather than reaching for another class", () => {
    const r = shortlistModels(
      asset({ assetClass: "Water Truck", manufacturer: "Caterpillar" }),
      catalogue,
    );
    expect(r.verdict).toBe("no_candidates");
    expect(r.candidates).toHaveLength(0);
    expect(r.reason).toMatch(/Research has not established/);
  });
});

describe("assessTwinDepth", () => {
  // The real production shape after provisioning: 137 twins over 144 assets,
  // 93 of them on a template with no components.
  const fleet = [
    {
      templateKey: "MIN-DOZER",
      fit: "direct" as const,
      componentCount: 0,
      failureModeCount: 0,
      hasOverlay: false,
      assetCount: 93,
    },
    {
      templateKey: "MIN-GRADER",
      fit: "direct" as const,
      componentCount: 0,
      failureModeCount: 0,
      hasOverlay: false,
      assetCount: 24,
    },
    {
      templateKey: "MIN-WHEEL-LOADER",
      fit: "direct" as const,
      componentCount: 5,
      failureModeCount: 6,
      hasOverlay: false,
      assetCount: 12,
    },
    {
      templateKey: "MIN-HYD-SHOVEL",
      fit: "approximate" as const,
      componentCount: 5,
      failureModeCount: 5,
      hasOverlay: false,
      assetCount: 8,
    },
  ];

  it("counts shells out of meaningful coverage", () => {
    const r = assessTwinDepth(fleet, 144);
    expect(r.assetsWithTwin).toBe(137);
    expect(r.assetsOnShellTwins).toBe(117); // 93 dozers + 24 graders
    expect(r.nominalCoveragePct).toBe(95.1);
    // 20 of 144. Reporting 95% here would be true and useless.
    expect(r.meaningfulCoveragePct).toBe(13.9);
    expect(r.reason).toMatch(/would hide it/);
  });

  it("calls a component-free template a shell, not coverage", () => {
    const r = assessTwinDepth(fleet, 144);
    const dozer = r.verdicts.find((v) => v.templateKey === "MIN-DOZER");
    expect(dozer?.depth).toBe("shell");
    expect(dozer?.reason).toMatch(/scaffolding, not a model/);
  });

  it("downgrades a complete template applied on an approximate fit", () => {
    const r = assessTwinDepth(fleet, 144);
    const shovel = r.verdicts.find((v) => v.templateKey === "MIN-HYD-SHOVEL");
    expect(shovel?.depth).toBe("partial");
    expect(shovel?.reason).toMatch(/structure, not as numbers/);
  });

  it("treats components without failure modes as partial", () => {
    const r = assessTwinDepth(
      [
        {
          templateKey: "X",
          fit: "direct",
          componentCount: 4,
          failureModeCount: 0,
          hasOverlay: false,
          assetCount: 2,
        },
      ],
      2,
    );
    expect(r.verdicts[0].depth).toBe("partial");
    expect(r.verdicts[0].reason).toMatch(/cannot predict anything/);
  });

  it("states plainly that no twin carries an OEM overlay", () => {
    const r = assessTwinDepth(fleet, 144);
    expect(r.reason).toMatch(/No twin carries an OEM model overlay/);
    expect(r.reason).toMatch(/indistinguishable from a fact/);
  });

  it("does not divide by zero on an empty fleet", () => {
    const r = assessTwinDepth([], 0);
    expect(r.meaningfulCoveragePct).toBe(0);
    expect(r.reason).toBe("No assets to assess.");
  });

  it("does not read zero twins as a clean bill of health", () => {
    // Caught only by rendering the panel: with no twins at all, the summary
    // said "Every twin rests on a template that carries components" — true of
    // the empty set and the exact opposite of the situation.
    const r = assessTwinDepth([], 37);
    expect(r.assetsWithTwin).toBe(0);
    expect(r.reason).toMatch(/None of the 37 asset\(s\) have a twin/);
    expect(r.reason).toMatch(
      /absence of coverage, not evidence of good coverage/,
    );
    expect(r.reason).not.toMatch(/Every twin rests on/);
  });

  it("keeps two fits on the same template distinguishable", () => {
    // The demo fleet runs 22 autonomous and 2 conventional haul trucks on one
    // template at different fits. Aggregating them into a single row let the
    // worse fit stand for both by alphabetical accident.
    const r = assessTwinDepth(
      [
        {
          templateKey: "MIN-HAUL-TRUCK",
          fit: "approximate",
          componentCount: 6,
          failureModeCount: 9,
          hasOverlay: false,
          assetCount: 22,
        },
        {
          templateKey: "MIN-HAUL-TRUCK",
          fit: "direct",
          componentCount: 6,
          failureModeCount: 9,
          hasOverlay: false,
          assetCount: 2,
        },
      ],
      24,
    );
    expect(r.verdicts).toHaveLength(2);
    expect(r.verdicts.map((v) => `${v.fit}:${v.depth}`)).toEqual([
      "approximate:partial",
      "direct:usable",
    ]);
  });
});
