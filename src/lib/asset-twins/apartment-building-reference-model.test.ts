import { describe, expect, it } from "vitest";
import { INDUSTRY_TEMPLATE_PACKS } from "../industry-template-packs";
import { apartmentBuildingReferenceModel as model } from "./apartment-building-reference-model";
import { getAssetClassTemplate } from "./index";
import { planReferenceHierarchy, systemReferenceModels } from "./reference-hierarchy-plan";
import { downstreamImpact, singlePointsOfFailure, validateSystemReferenceModel } from "./system-model";

const noNumericLimit = /\d+\s?(%|°|deg|kpa|psi|bar|volts?|vdc|vac|kv|kw|mw|hz|hours?|hrs|minutes?|seconds?|ms|days?|weeks?|months?|years?|gallons?|litres?|liters?|amps?|btu|tons?|ppm)\b/i;

describe("apartment building common-areas reference model", () => {
  it("is structurally complete and every bound equipment unit resolves", () => {
    expect(validateSystemReferenceModel(model, (code) => getAssetClassTemplate(code))).toEqual([]);
  });

  it("reuses the existing fire, emergency lighting, security, switchboard, plumbing and envelope classes", () => {
    const bound = model.nodes.filter((n) => n.assetClassTemplateCode).map((n) => n.assetClassTemplateCode);
    expect(bound).toEqual(
      expect.arrayContaining(["CRIT-FIRE-DETECTION", "CRIT-EMERGENCY-LIGHTING", "CRIT-ACCESS-CONTROL", "CRIT-CCTV", "CRIT-LV-SWITCHBOARD", "RES-PLUMBING", "RES-ENVELOPE"]),
    );
  });

  it("lists maintainable items for the parkade classes that have no template yet", () => {
    for (const code of ["APT-SUMP-PUMPS", "APT-FLOOR-DRAINS", "APT-PARKADE-VENT", "APT-PARKADE-GATE"]) {
      const node = model.nodes.find((n) => n.code === code)!;
      expect(node.equipmentClassStatus, code).toBe("template_planned");
      expect(node.maintainableItems!.length, code).toBeGreaterThan(2);
    }
  });

  it("stays draft, sets no numeric limits and no autonomous action", () => {
    expect(model.reviewState).toBe("draft");
    expect(model.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(JSON.stringify(model.nodes)).not.toMatch(noNumericLimit);
  });

  it("traces what a house-service outage takes down", () => {
    expect(downstreamImpact(model, "APT-HOUSE-SWITCHBOARD")).toEqual(
      expect.arrayContaining(["APT-SUMP-PUMPS", "APT-PARKADE-VENT", "APT-FIRE-ALARM", "APT-EMERGENCY-LIGHTING"]),
    );
  });

  it("flags sump, parkade air, fire, water and power until a named person approves the declaration", () => {
    expect(singlePointsOfFailure(model, []).map((f) => f.groupCode).sort()).toEqual([
      "RG-APT-ELEC",
      "RG-APT-FIRE",
      "RG-APT-PARKADE-AIR",
      "RG-APT-SUMP",
      "RG-APT-WATER",
    ]);
  });

  it("is selectable in the planner and plans a building as an area", () => {
    expect(systemReferenceModels[model.code]).toBe(model);
    for (const m of Object.values(systemReferenceModels)) expect(Object.keys(INDUSTRY_TEMPLATE_PACKS)).toContain(m.industryPack);
    const plan = planReferenceHierarchy(model, { code: "MIL-122", name: "122 Millennium Drive" });
    expect(plan.steps.at(0)).toMatchObject({ kind: "area", code: "MIL-122" });
    expect(plan.equipment.map((e) => e.referenceNodeCode)).toEqual(expect.arrayContaining(["APT-SUMP-PUMPS", "APT-FIRE-ALARM"]));
  });
});
