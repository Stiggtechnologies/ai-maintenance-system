import { describe, expect, it } from "vitest";
import { getAssetClassTemplate } from "./index";
import { planReferenceHierarchy, getSystemReferenceModelForIndustry } from "./reference-hierarchy-plan";
import { residentialDwellingReferenceModel as model } from "./residential-dwelling-reference-model";
import { residentialFacilityLibrary } from "./residential-facility";
import { downstreamImpact, singlePointsOfFailure, validateSystemReferenceModel } from "./system-model";

const noNumericLimit = /\d+\s?(%|°|deg|kpa|psi|bar|volts?|vdc|vac|kv|kw|mw|hz|hours?|hrs|minutes?|seconds?|ms|days?|weeks?|months?|years?|gallons?|litres?|liters?|amps?|btu|tons?)\b/i;

describe("residential facility asset classes", () => {
  it("covers the eight classes a housing operation maintains, each registered and resolvable", () => {
    expect(residentialFacilityLibrary.map((t) => t.code).sort()).toEqual([
      "RES-APPLIANCES",
      "RES-ELEC-SERVICE",
      "RES-ENVELOPE",
      "RES-FURNACE",
      "RES-HEAT-PUMP",
      "RES-LIFE-SAFETY",
      "RES-PLUMBING",
      "RES-WATER-HEATER",
    ]);
    for (const t of residentialFacilityLibrary) expect(getAssetClassTemplate(t.code), t.code).toBe(t);
  });

  it("is structurally complete: components with functions, inspection zones and failure modes bound to their component", () => {
    for (const t of residentialFacilityLibrary) {
      expect(t.functions.length, t.code).toBeGreaterThan(0);
      expect(t.components.length, t.code).toBeGreaterThan(1);
      expect(new Set(t.components.map((c) => c.code)).size).toBe(t.components.length);
      for (const c of t.components) {
        expect(c.functions.length, c.code).toBeGreaterThan(0);
        expect(c.inspectionZones.length, c.code).toBeGreaterThan(0);
        expect(c.failureModes.length, c.code).toBeGreaterThan(0);
        for (const fm of c.failureModes) {
          expect(fm.componentCode).toBe(c.code);
          expect(fm.causes.length && fm.effects.length && fm.verificationMethods.length, fm.code).toBeTruthy();
        }
      }
    }
    const failureCodes = residentialFacilityLibrary.flatMap((t) => t.components.flatMap((c) => c.failureModes.map((fm) => fm.code)));
    expect(new Set(failureCodes).size).toBe(failureCodes.length);
  });

  it("stays draft and sets no intervals, limits or recommended actions", () => {
    for (const t of residentialFacilityLibrary) {
      expect(t.reviewState).toBe("draft");
      expect(JSON.stringify(t), t.code).not.toMatch(noNumericLimit);
      for (const c of t.components)
        for (const fm of c.failureModes) {
          expect(fm.reviewState).toBe("draft");
          expect(fm.recommendedActions).toEqual([]);
          expect(fm.evidence).toEqual([]);
        }
    }
  });

  it("models the hazards that matter in northern crew housing", () => {
    const all = JSON.stringify(residentialFacilityLibrary).toLowerCase();
    for (const hazard of ["carbon monoxide", "frozen or burst pipe", "ice damming", "dryer fire", "relief valve"]) {
      expect(all).toContain(hazard);
    }
  });
});

describe("residential dwelling reference model", () => {
  it("is structurally complete and every equipment unit resolves", () => {
    expect(validateSystemReferenceModel(model, (code) => getAssetClassTemplate(code))).toEqual([]);
    const bound = model.nodes.filter((n) => n.equipmentClassStatus === "template_available").map((n) => n.assetClassTemplateCode);
    expect(new Set(bound)).toEqual(new Set(residentialFacilityLibrary.map((t) => t.code)));
  });

  it("stays draft, sets no numeric limits and no autonomous action", () => {
    expect(model.reviewState).toBe("draft");
    expect(model.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(JSON.stringify(model.nodes)).not.toMatch(noNumericLimit);
    for (const g of model.redundancyGroups) expect(g.scheme).toBe("site_specified");
  });

  it("traces what an electrical outage takes down in a unit", () => {
    expect(downstreamImpact(model, "RES-ELEC-PANEL")).toEqual(
      expect.arrayContaining(["RES-FURNACE-UNIT", "RES-WATER-HEATER-UNIT", "RES-ALARMS", "RES-SUMP"]),
    );
    expect(downstreamImpact(model, "RES-PLUMBING-SYSTEM")).toEqual(expect.arrayContaining(["RES-WATER-HEATER-UNIT"]));
    expect(model.edges).toContainEqual({ from: "RES-PLUMBING-SYSTEM", relation: "depends_on", to: "RES-FURNACE-UNIT" });
  });

  it("flags heat, water, power and alarm coverage until a named person approves the site declaration", () => {
    expect(singlePointsOfFailure(model, []).map((f) => f.groupCode).sort()).toEqual([
      "RG-RES-ALARMS",
      "RG-RES-ELEC",
      "RG-RES-HEAT",
      "RG-RES-WATER",
    ]);
  });

  it("is the Buildings & Infrastructure pack's model and plans one unit as an area", () => {
    expect(getSystemReferenceModelForIndustry("buildings_infrastructure")).toBe(model);
    const plan = planReferenceHierarchy(model, { code: "WILSON-TH-01", name: "230 Wilson townhouse 1" });
    expect(plan.steps.at(0)).toMatchObject({ kind: "area", code: "WILSON-TH-01" });
    expect(plan.equipment.map((e) => e.referenceNodeCode)).toEqual(
      expect.arrayContaining(["RES-FURNACE-UNIT", "RES-WATER-HEATER-UNIT", "RES-ALARMS"]),
    );
    expect(plan.governance.writes).toBe("none");
  });
});
