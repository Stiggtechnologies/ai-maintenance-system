import { describe, it, expect } from "vitest";
import {
  parseAssetOnboardingCommand,
  createAssetOnboardingSession,
  applyAssetOnboardingAnswer,
  buildAssetOnboardingExports,
  selectOnboardingTemplates,
  getOnboardingContext,
  getTemplateVersion,
} from "./asset-onboarding";
import { getIndustryTemplatePack, listIndustryTemplatePacks } from "./industry-template-packs";
import { getAssetClassTemplate, listAssetClassTemplates } from "./asset-class-templates";

describe("parseAssetOnboardingCommand", () => {
  it("parses oil-sands pump deep onboarding", () => {
    const cmd = parseAssetOnboardingCommand("/onboard used pump P-101 oil-sands deep");
    expect(cmd.isOnboarding).toBe(true);
    expect(cmd.assetClass).toBe("pump");
    expect(cmd.assetId).toBe("P-101");
    expect(cmd.industry).toBe("oil_sands");
    expect(cmd.mode).toBe("deep");
    expect(cmd.lifecycle).toBe("used");
    expect(cmd.intent).toBe("start");
  });

  it("parses power-generation transformer regulatory onboarding", () => {
    const cmd = parseAssetOnboardingCommand("/onboard new transformer TR-01 power-generation regulatory");
    expect(cmd.isOnboarding).toBe(true);
    expect(cmd.assetClass).toBe("transformer");
    expect(cmd.assetId).toBe("TR-01");
    expect(cmd.industry).toBe("power_generation");
    expect(cmd.mode).toBe("regulatory");
    expect(cmd.lifecycle).toBe("new");
  });

  it("parses data-centers chiller deep onboarding", () => {
    const cmd = parseAssetOnboardingCommand("/onboard in-service chiller CH-04 data-centers deep");
    expect(cmd.isOnboarding).toBe(true);
    expect(cmd.assetClass).toBe("chiller");
    expect(cmd.assetId).toBe("CH-04");
    expect(cmd.industry).toBe("data_centers");
    expect(cmd.mode).toBe("deep");
    expect(cmd.lifecycle).toBe("in_service");
  });

  it("parses aviation aircraft-system regulatory onboarding", () => {
    const cmd = parseAssetOnboardingCommand("/onboard transferred aircraft-system ENG-02 aviation regulatory");
    expect(cmd.isOnboarding).toBe(true);
    expect(cmd.assetClass).toBe("aircraft_system");
    expect(cmd.assetId).toBe("ENG-02");
    expect(cmd.industry).toBe("aviation");
    expect(cmd.mode).toBe("regulatory");
    expect(cmd.lifecycle).toBe("transferred");
  });

  it("parses marine-shipping marine-engine deep onboarding", () => {
    const cmd = parseAssetOnboardingCommand("/onboard used marine-engine ME-12 marine-shipping deep");
    expect(cmd.isOnboarding).toBe(true);
    expect(cmd.assetClass).toBe("marine_engine");
    expect(cmd.assetId).toBe("ME-12");
    expect(cmd.industry).toBe("marine_shipping");
    expect(cmd.mode).toBe("deep");
    expect(cmd.lifecycle).toBe("used");
  });

  it("returns non-onboarding for random text", () => {
    const cmd = parseAssetOnboardingCommand("hello world");
    expect(cmd.isOnboarding).toBe(false);
    expect(cmd.assetClass).toBe("generic");
  });

  it("parses pharmaceuticals with GMP alias", () => {
    const cmd = parseAssetOnboardingCommand("/onboard new packaging-line PL-01 pharma regulatory");
    expect(cmd.industry).toBe("pharmaceuticals");
    expect(cmd.assetClass).toBe("packaging_line");
    expect(cmd.mode).toBe("regulatory");
  });

  it("parses mining conveyor standard", () => {
    const cmd = parseAssetOnboardingCommand("/onboard existing conveyor CV-200 mining");
    expect(cmd.assetClass).toBe("conveyor");
    expect(cmd.industry).toBe("mining");
    expect(cmd.lifecycle).toBe("in_service");
    expect(cmd.mode).toBe("standard");
  });
});

describe("selectOnboardingTemplates", () => {
  it("selects correct industry pack for oil_sands", () => {
    const selection = selectOnboardingTemplates({
      industry: "oil_sands",
      assetClass: "pump",
      lifecycle: "used",
      mode: "deep",
      source: "manual",
    });
    expect(selection.industryPack).toBeDefined();
    expect(selection.industryPack?.industryCode).toBe("oil_sands");
    expect(selection.assetClassTemplate).toBeDefined();
    expect(selection.assetClassTemplate?.assetClassCode).toBe("pump");
  });

  it("selects correct asset class template for transformer", () => {
    const selection = selectOnboardingTemplates({
      industry: "power_generation",
      assetClass: "transformer",
      lifecycle: "new",
      mode: "regulatory",
      source: "manual",
    });
    expect(selection.assetClassTemplate?.assetClassCode).toBe("transformer");
    expect(selection.assetClassTemplate?.commonComponents.length).toBeGreaterThan(3);
  });

  it("handles unknown industry gracefully", () => {
    const selection = selectOnboardingTemplates({
      industry: "general",
      assetClass: "generic",
      lifecycle: "in_service",
      mode: "standard",
      source: "manual",
    });
    expect(selection.industryPack).toBeUndefined();
    expect(selection.isOfflineMode).toBe(true);
  });
});

describe("createAssetOnboardingSession", () => {
  it("creates oil sands pump session with industry-specific context", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
    });
    expect(session.assetId).toBe("P-101");
    expect(session.industry).toBe("oil_sands");
    expect(session.assetClass).toBe("pump");
    expect(session.mode).toBe("deep");
    expect(session.lifecycle).toBe("used");
    expect(session.status).toBe("active");
    expect(session.steps.length).toBe(15);
    expect(session.profile.criticality.riskDrivers.length).toBeGreaterThan(2);
    expect(session.profile.onboardingContext.industryTemplateCode).toBe("oil_sands");
  });

  it("creates data center chiller session", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard in-service chiller CH-04 data-centers deep",
    });
    expect(session.assetId).toBe("CH-04");
    expect(session.industry).toBe("data_centers");
    expect(session.assetClass).toBe("chiller");
    expect(session.profile.failureModes.length).toBeGreaterThan(3);
  });

  it("creates aviation aircraft-system session with regulatory mode", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard transferred aircraft-system ENG-02 aviation regulatory",
    });
    expect(session.assetId).toBe("ENG-02");
    expect(session.industry).toBe("aviation");
    expect(session.assetClass).toBe("aircraft_system");
    expect(session.mode).toBe("regulatory");
    expect(session.lifecycle).toBe("transferred");
    expect(session.profile.failureModes.length).toBeGreaterThan(3);
  });

  it("creates marine engine session", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used marine-engine ME-12 marine-shipping deep",
    });
    expect(session.industry).toBe("marine_shipping");
    expect(session.assetClass).toBe("marine_engine");
    expect(session.profile.onboardingContext.industryTemplateCode).toBe("marine_shipping");
  });

  it("generates different risk drivers per industry", () => {
    const oilSands = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
    });
    const mining = createAssetOnboardingSession({
      commandText: "/onboard used pump P-201 mining deep",
    });
    expect(oilSands.profile.criticality.riskDrivers).not.toEqual(mining.profile.criticality.riskDrivers);
  });
});

describe("applyAssetOnboardingAnswer", () => {
  it("advances step after sufficient answer", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
    });
    const updated = applyAssetOnboardingAnswer({
      session,
      answer: "Asset tag: P-101. Name: Tailings Transfer Pump. OEM: Warman. Model: AH-300. Serial: WM-2019-4421. Commissioned: 2019-06-15.",
    });
    expect(updated.steps[0].completionStatus).toBe("complete");
    expect(updated.steps[0].completionScore).toBe(100);
    expect(updated.completionScore).toBeGreaterThan(session.completionScore);
  });

  it("does not mark step complete for short answer", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard new transformer TR-01 power-generation regulatory",
    });
    const updated = applyAssetOnboardingAnswer({
      session,
      answer: "TR-01",
    });
    expect(updated.steps[0].completionStatus).toBe("in_progress");
    expect(updated.steps[0].completionScore).toBe(50);
  });
});

describe("buildAssetOnboardingExports", () => {
  it("generates all export formats", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
    });
    const exports = buildAssetOnboardingExports(session);
    expect(exports.markdown).toContain("P-101");
    expect(exports.markdown).toContain("Oil sands");
    expect(exports.json).toBeTruthy();
    expect(exports.wordHtml).toContain("<html>");
    expect(exports.pdfHtml).toContain("<html>");
    expect(exports.excelWorkbookCsv).toContain("section");
    expect(exports.cmmsImportCsv).toContain("P-101");
    expect(exports.powerBiDatasetJson).toContain("oil_sands");
    expect(exports.apiPayloadJson).toContain("P-101");
  });

  it("includes industry template name in exports", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard in-service chiller CH-04 data-centers deep",
    });
    const exports = buildAssetOnboardingExports(session);
    expect(exports.markdown).toContain("data_centers");
    expect(exports.cmmsImportCsv).toContain("CH-04");
  });
});

describe("getOnboardingContext", () => {
  it("returns enriched context with industry pack", () => {
    const ctx = getOnboardingContext("oil_sands", "pump");
    expect(ctx.industry.pack).not.toBeNull();
    expect(ctx.industry.pack?.industryCode).toBe("oil_sands");
    expect(ctx.assetClass.template?.assetClassCode).toBe("pump");
    expect(ctx.riskDrivers.length).toBeGreaterThan(2);
    expect(ctx.questions.length).toBeGreaterThan(3);
    expect(ctx.failureModes.length).toBeGreaterThan(2);
  });

  it("returns failure modes from asset class template for new classes", () => {
    const ctx = getOnboardingContext("data_centers", "chiller");
    expect(ctx.failureModes.length).toBeGreaterThan(3);
    expect(ctx.assetClass.template?.commonFailureModes.length).toBeGreaterThan(3);
  });

  it("returns blocked automation rules", () => {
    const ctx = getOnboardingContext("aviation", "aircraft_system");
    expect(ctx.blockedAutomationRules.length).toBeGreaterThan(2);
  });
});

describe("getTemplateVersion", () => {
  it("returns version info", () => {
    const version = getTemplateVersion("oil_sands", "pump");
    expect(version.templateVersion).toBe("1.0.0");
    expect(version.validationStatus).toBe("customer_validated");
  });
});

describe("automation blocked when data missing", () => {
  it("marks session as low readiness without data", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
    });
    expect(session.reliabilityReadiness).toBe("low");
    expect(session.missingFields.length).toBeGreaterThan(5);
    expect(session.profile.reliabilityBaseline.confidence).toBe("low");
  });

  it("includes approval gates blocking automation", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard new transformer TR-01 power-generation regulatory",
    });
    expect(session.approvalRequired.length).toBeGreaterThan(5);
    expect(session.profile.riskSafeguards.doNotChangeRules.length).toBeGreaterThan(0);
  });
});

describe("industry template packs registry", () => {
  it("has at least 15 industry packs", () => {
    const packs = listIndustryTemplatePacks();
    expect(packs.length).toBeGreaterThanOrEqual(15);
  });

  it("each pack has required fields populated", () => {
    const packs = listIndustryTemplatePacks();
    for (const pack of packs) {
      expect(pack.industryCode).toBeTruthy();
      expect(pack.industryName).toBeTruthy();
      expect(pack.commonAssetClasses.length).toBeGreaterThan(3);
      expect(pack.onboardingQuestions.length).toBeGreaterThan(3);
      expect(pack.riskDrivers.length).toBeGreaterThan(2);
      expect(pack.safeguards.length).toBeGreaterThan(2);
      expect(pack.approvalGates.length).toBeGreaterThan(2);
      expect(pack.failureModeFocusAreas.length).toBeGreaterThan(3);
      expect(pack.blockedAutomationRules.length).toBeGreaterThan(2);
    }
  });
});

describe("asset class templates registry", () => {
  it("has at least 23 asset class templates", () => {
    const templates = listAssetClassTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(23);
  });

  it("each template has required fields populated", () => {
    const templates = listAssetClassTemplates();
    for (const t of templates) {
      expect(t.assetClassCode).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.commonComponents.length).toBeGreaterThan(3);
      expect(t.commonFailureModes.length).toBeGreaterThan(3);
      expect(t.conditionMonitoringMethods.length).toBeGreaterThan(2);
      expect(t.pmStrategyPatterns.length).toBeGreaterThan(2);
      expect(t.criticalSpares.length).toBeGreaterThan(2);
    }
  });

  it("resolves transformer by code", () => {
    const t = getAssetClassTemplate("transformer");
    expect(t).toBeDefined();
    expect(t?.label).toContain("ransformer");
  });

  it("resolves chiller by code", () => {
    const t = getAssetClassTemplate("chiller");
    expect(t).toBeDefined();
    expect(t?.commonComponents.length).toBeGreaterThan(3);
  });
});
