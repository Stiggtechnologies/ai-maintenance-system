import { describe, expect, it } from "vitest";
import { INDUSTRY_TEMPLATE_PACKS } from "../industry-template-packs";
import { dataCenterReferenceModel as model } from "./data-center-reference-model";
import { getAssetClassTemplate } from "./index";
import {
  getSystemReferenceModelForIndustry,
  planReferenceHierarchy,
  planStepStatuses,
  systemReferenceModelsByIndustry,
} from "./reference-hierarchy-plan";

const plan = planReferenceHierarchy(model, { code: "dh1", name: "Data hall 1" });

describe("reference hierarchy plan", () => {
  it("follows the governed order: area, then systems, then functional locations under verified parents", () => {
    expect(plan.steps.at(0)).toMatchObject({ kind: "area", code: "DH1", parentCode: null });
    const seen = new Map<string, string>();
    for (const step of plan.steps) {
      if (step.parentCode) {
        const parentKind = seen.get(step.parentCode);
        expect(parentKind, step.code).toBeDefined();
        if (step.kind === "system") expect(parentKind).toBe("area");
        if (step.kind === "functional_location") expect(parentKind).toBe("system");
      }
      seen.set(step.code, step.kind);
    }
    expect(plan.steps.map((s) => s.order)).toEqual(plan.steps.map((_, i) => i + 1));
  });

  it("covers every system, subsystem and equipment unit of the model exactly once", () => {
    const refs = plan.steps.map((s) => s.referenceNodeCode).filter(Boolean);
    const expected = model.nodes.filter((n) => n.level === "system" || n.level === "subsystem").map((n) => n.code);
    expect([...refs].sort()).toEqual([...expected].sort());
    const units = model.nodes.filter((n) => n.level === "equipment_unit").map((n) => n.code);
    expect(plan.equipment.map((e) => e.referenceNodeCode).sort()).toEqual([...units].sort());
    expect(new Set(plan.steps.map((s) => s.code)).size).toBe(plan.steps.length);
  });

  it("places equipment under functional locations and points at registered templates", () => {
    const fl = new Set(plan.steps.filter((s) => s.kind === "functional_location").map((s) => s.code));
    for (const item of plan.equipment) {
      expect(fl.has(item.locationCode), item.referenceNodeCode).toBe(true);
      if (item.assetClassTemplateCode) expect(getAssetClassTemplate(item.assetClassTemplateCode)).toBeDefined();
      else expect(item.maintainableItems.length, item.referenceNodeCode).toBeGreaterThan(0);
    }
  });

  it("writes nothing and states the per-step human requirement", () => {
    expect(plan.governance).toEqual({
      writes: "none",
      eachStepRequires: "named_proposer_verified_evidence_independent_reviewer",
    });
    for (const s of plan.steps) expect(s.description.trim().length).toBeGreaterThan(0);
  });

  it("refuses a bad area code or blank name", () => {
    expect(() => planReferenceHierarchy(model, { code: "data hall!", name: "x" })).toThrow(/Area code/);
    expect(() => planReferenceHierarchy(model, { code: "DH1", name: "  " })).toThrow(/Area name/);
  });

  it("links the Data Centers pack to its reference model, and only real packs", () => {
    expect(getSystemReferenceModelForIndustry("data_centers")).toBe(model);
    expect(getSystemReferenceModelForIndustry("toString")).toBeUndefined();
    for (const code of Object.keys(systemReferenceModelsByIndustry)) {
      expect(Object.keys(INDUSTRY_TEMPLATE_PACKS)).toContain(code);
    }
  });
});

describe("plan step statuses", () => {
  const sys = plan.steps.find((s) => s.kind === "system")!;
  const fl = plan.steps.find((s) => s.parentCode === sys.code)!;

  it("starts with only the area ready", () => {
    const st = planStepStatuses(plan, []);
    expect(st.at(0)).toEqual({ code: "DH1", state: "ready", parentLocationId: null });
    expect(st.slice(1).every((s) => s.state === "waiting_for_parent")).toBe(true);
  });

  it("unlocks children only under a verified parent, matched case-insensitively", () => {
    const proposedArea = planStepStatuses(plan, [{ id: "a", code: "dh1", status: "proposed" }]);
    expect(proposedArea.find((s) => s.code === sys.code)!.state).toBe("waiting_for_parent");
    const verifiedArea = planStepStatuses(plan, [{ id: "a", code: "dh1", status: "verified" }]);
    expect(verifiedArea.at(0)!.state).toBe("verified");
    expect(verifiedArea.find((s) => s.code === sys.code)).toEqual({ code: sys.code, state: "ready", parentLocationId: "a" });
    expect(verifiedArea.find((s) => s.code === fl.code)!.state).toBe("waiting_for_parent");
  });

  it("treats a rejected node as absent and prefers a verified duplicate", () => {
    const st = planStepStatuses(plan, [
      { id: "r", code: "DH1", status: "rejected" },
      { id: "v", code: "DH1", status: "verified" },
      { id: "x", code: sys.code, status: "rejected" },
    ]);
    expect(st.find((s) => s.code === sys.code)).toEqual({ code: sys.code, state: "ready", parentLocationId: "v" });
  });
});
