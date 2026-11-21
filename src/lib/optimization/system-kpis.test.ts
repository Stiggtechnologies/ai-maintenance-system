import { describe, expect, it } from "vitest";
import {
  missingSystemPages,
  systemOptimizationBlockers,
  type SystemKpiEffectDraft,
} from "./system-kpis";

const pages = ["asset_performance", "executive", "financial", "risk_safety"];

function effect(
  kpiKey: string,
  page: string,
  effectName: SystemKpiEffectDraft["effect"] = "unchanged",
): SystemKpiEffectDraft {
  return {
    kpiKey,
    page,
    effect: effectName,
    basis:
      "Observed from this tenant's current records, not a calculated optimum.",
  };
}

describe("system KPI optimization preview", () => {
  it("refuses a proposal that names only the focal KPI", () => {
    const blockers = systemOptimizationBlockers({
      pages,
      focalKpiKey: "oee",
      focalPage: "executive",
      intent: "Raise overall equipment effectiveness for the packing line.",
      effects: [effect("oee", "executive", "improves")],
    });
    expect(blockers.join(" ")).toMatch(/single KPI/i);
    expect(
      missingSystemPages(pages, "executive", [{ page: "executive" }]),
    ).toEqual(["asset_performance", "financial", "risk_safety"]);
  });

  it("refuses a proposal that skips one system page", () => {
    const blockers = systemOptimizationBlockers({
      pages,
      focalKpiKey: "oee",
      focalPage: "executive",
      intent: "Raise overall equipment effectiveness for the packing line.",
      effects: [
        effect("oee", "executive", "improves"),
        effect("availability", "asset_performance"),
        effect("maintenance_cost_rav", "financial", "worsens"),
      ],
    });
    expect(blockers.join(" ")).toMatch(/Risk Safety/);
  });

  it("accepts a qualitative cover of every other page without scoring it", () => {
    const effects = [
      effect("oee", "executive", "improves"),
      effect("availability", "asset_performance", "unchanged"),
      effect("maintenance_cost_rav", "financial", "unknown"),
      effect("critical_control_compliance", "risk_safety", "worsens"),
    ];
    expect(
      systemOptimizationBlockers({
        pages,
        focalKpiKey: "oee",
        focalPage: "executive",
        intent: "Raise overall equipment effectiveness for the packing line.",
        effects,
      }),
    ).toEqual([]);
    expect(effects.map((item) => item.effect)).toContain("unknown");
    expect(effects.map((item) => item.effect)).toContain("worsens");
  });

  it("does not treat two statements of the same KPI as a system view", () => {
    const blockers = systemOptimizationBlockers({
      pages,
      focalKpiKey: "oee",
      focalPage: "executive",
      intent: "Raise overall equipment effectiveness for the packing line.",
      effects: [
        effect("oee", "executive", "improves"),
        effect("oee", "executive", "improves"),
      ],
    });
    expect(blockers.join(" ")).toMatch(/recorded once/i);
  });
});
