import { describe, expect, it } from "vitest";
import { dataCenterReferenceModel as model } from "./data-center-reference-model";
import { getAssetClassTemplate } from "./index";
import {
  downstreamImpact,
  singlePointsOfFailure,
  validateSystemReferenceModel,
  type SystemReferenceModel,
} from "./system-model";

const resolve = (code: string) => getAssetClassTemplate(code);
const noNumericLimit = /\d+\s?(%|°|deg|kpa|psi|bar|volts?|vdc|vac|kv|kw|mw|hz|hours?|hrs|minutes?|seconds?|ms)\b/i;

describe("data centre system reference model", () => {
  it("is structurally complete: parents, functions, functional failures, bindings, redundancy slots", () => {
    expect(validateSystemReferenceModel(model, resolve)).toEqual([]);
  });

  it("covers every facility system", () => {
    const systems = model.nodes.filter((n) => n.level === "system").map((n) => n.code);
    expect(systems).toEqual(
      expect.arrayContaining(["DC-ELEC", "DC-MECH", "DC-FLS", "DC-CONTROLS", "DC-SECURITY", "DC-WHITE-SPACE"]),
    );
  });

  it("binds the shipped critical-facility templates and lists maintainable items for the rest", () => {
    const bound = model.nodes.filter((n) => n.assetClassTemplateCode).map((n) => n.assetClassTemplateCode);
    expect(bound).toEqual(
      expect.arrayContaining(["CRIT-STANDBY-GENERATOR", "CRIT-UPS-SYSTEM", "CRIT-TRANSFER-SWITCH", "CRIT-CHILLER", "ROT-CENT-PUMP", "CRIT-CRAH", "CRIT-STATIC-TRANSFER-SWITCH", "CRIT-PDU", "CRIT-BUSWAY", "CRIT-MV-SWITCHGEAR", "CRIT-POWER-TRANSFORMER", "CRIT-COOLING-TOWER", "CRIT-BESS", "CRIT-CDU", "CRIT-RDHX", "CRIT-CLEAN-AGENT", "CRIT-FIRE-DETECTION", "CRIT-PREACTION", "CRIT-ROTARY-UPS", "CRIT-EPO", "CRIT-BMS", "CRIT-EPMS", "CRIT-CRAC", "CRIT-LV-SWITCHBOARD", "CRIT-PARALLELING-SWITCHGEAR", "CRIT-FUEL-SYSTEM"]),
    );
    for (const n of model.nodes.filter((x) => x.equipmentClassStatus === "template_planned")) {
      expect(n.maintainableItems!.length, n.code).toBeGreaterThan(2);
    }
  });

  it("stays draft, cites sources, sets no numeric limits and no autonomous action", () => {
    expect(model.reviewState).toBe("draft");
    expect(model.sources.length).toBeGreaterThan(3);
    expect(model.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(JSON.stringify(model.nodes)).not.toMatch(noNumericLimit);
    for (const g of model.redundancyGroups) expect(g.scheme).toBe("site_specified");
  });

  it("traces what loses power or cooling when a node fails", () => {
    const upsLoss = downstreamImpact(model, "DC-UPS");
    expect(upsLoss).toEqual(expect.arrayContaining(["DC-PDU", "DC-RACK-PDU", "DC-IT-LOAD", "DC-CRAH", "DC-CDU", "DC-BMS"]));
    expect(upsLoss).not.toContain("DC-CHILLER");

    const towerLoss = downstreamImpact(model, "DC-COOLING-TOWER");
    expect(towerLoss).toEqual(expect.arrayContaining(["DC-CHILLER", "DC-CRAH", "DC-IT-LOAD"]));

    expect(downstreamImpact(model, "DC-FUEL-SYSTEM")).toContain("DC-IT-LOAD");
  });

  it("flags every redundancy group until a named person approves a site declaration", () => {
    expect(singlePointsOfFailure(model, [])).toHaveLength(model.redundancyGroups.length);
    const findings = singlePointsOfFailure(model, [
      { groupCode: "RG-UPS", scheme: "2N", approvedBy: "Site reliability engineer" },
      { groupCode: "RG-GENERATION", scheme: "N", approvedBy: "Site reliability engineer" },
      { groupCode: "RG-CHILLERS", scheme: "N+1" },
    ]);
    const byGroup = Object.fromEntries(findings.map((f) => [f.groupCode, f.reason]));
    expect(byGroup["RG-UPS"]).toBeUndefined();
    expect(byGroup["RG-GENERATION"]).toBe("declared_N");
    expect(byGroup["RG-CHILLERS"]).toBe("declaration_not_approved");
    expect(byGroup["RG-PUMPS"]).toBe("not_declared");
  });
});

describe("validateSystemReferenceModel negative paths", () => {
  const clone = (): SystemReferenceModel => JSON.parse(JSON.stringify(model));
  const messages = (m: SystemReferenceModel) => validateSystemReferenceModel(m, resolve).map((i) => `${i.code}: ${i.message}`);

  it("rejects an orphan node and a parent below its child", () => {
    const m = clone();
    m.nodes.find((n) => n.code === "DC-PDU")!.parentCode = "DC-NOWHERE";
    m.nodes.find((n) => n.code === "DC-RPP")!.parentCode = "DC-PDU";
    m.nodes.find((n) => n.code === "DC-RPP")!.level = "subsystem";
    const out = messages(m);
    expect(out).toContain("DC-PDU: missing or unknown parent");
    expect(out.some((x) => x.startsWith("DC-RPP: parent DC-PDU is not above"))).toBe(true);
  });

  it("rejects an unknown template, a planned class with no items, and a function with no failure", () => {
    const m = clone();
    m.nodes.find((n) => n.code === "DC-UPS")!.assetClassTemplateCode = "CRIT-PHANTOM";
    const sts = m.nodes.find((n) => n.code === "DC-DRY-COOLER")!;
    sts.maintainableItems = [];
    sts.functions[0].functionalFailures = [];
    const out = messages(m);
    expect(out).toContain("DC-UPS: unknown template CRIT-PHANTOM");
    expect(out).toContain("DC-DRY-COOLER: planned equipment class must list maintainable items");
    expect(out).toContain("F-DRY-COOLER: function has no functional failure");
  });

  it("rejects a critical function with no redundancy slot, a dangling edge and a non-draft model", () => {
    const m = clone();
    m.redundancyGroups = m.redundancyGroups.filter((g) => g.code !== "RG-PUMPS");
    m.edges.push({ from: "DC-UPS", relation: "supplies_power_to", to: "DC-GHOST" });
    m.reviewState = "approved";
    const out = messages(m);
    expect(out).toContain("F-CHW-PUMP: critical function has no redundancy group slot");
    expect(out).toContain("DC-GHOST: edge to unknown node (supplies_power_to)");
    expect(out).toContain("SRM-DATA-CENTER: reference model must be draft");
  });
});
