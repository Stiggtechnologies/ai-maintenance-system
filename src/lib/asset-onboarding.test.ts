import { describe, expect, it } from "vitest";
import {
  applyAssetOnboardingAnswer,
  buildAssetOnboardingExports,
  createAssetOnboardingSession,
  getCurrentOnboardingStep,
  getOnboardingSampleAnswer,
  getOnboardingStepDefinitions,
  parseAssetOnboardingCommand,
} from "./asset-onboarding";

describe("asset onboarding", () => {
  it("parses one-command onboarding variants", () => {
    expect(parseAssetOnboardingCommand("/onboard asset")).toMatchObject({
      isOnboarding: true,
      assetClass: "generic",
      mode: "standard",
      source: "manual",
      intent: "start",
    });
    expect(parseAssetOnboardingCommand("/onboard pump P-101")).toMatchObject({
      assetClass: "pump",
      assetId: "P-101",
      lifecycle: "in_service",
      industry: "general",
    });
    expect(
      parseAssetOnboardingCommand("/onboard used pump P-101 oil-sands deep"),
    ).toMatchObject({
      assetClass: "pump",
      assetId: "P-101",
      lifecycle: "used",
      industry: "oil_sands",
      mode: "deep",
    });
    expect(
      parseAssetOnboardingCommand("/onboard new conveyor CV-204 mining"),
    ).toMatchObject({
      assetClass: "conveyor",
      assetId: "CV-204",
      lifecycle: "new",
      industry: "mining",
    });
    expect(
      parseAssetOnboardingCommand("/onboard fleet haul_trucks"),
    ).toMatchObject({
      assetClass: "fleet",
      mode: "fleet",
      assetId: "haul_trucks",
    });
    expect(
      parseAssetOnboardingCommand("/onboard from SAP export"),
    ).toMatchObject({
      source: "sap_export",
    });
    expect(
      parseAssetOnboardingCommand("/onboard from Maximo export"),
    ).toMatchObject({
      source: "maximo_export",
    });
    expect(parseAssetOnboardingCommand("/generate fmea P-101")).toMatchObject({
      intent: "generate_fmea",
      assetId: "P-101",
    });
  });

  it("defines the complete guided workflow without missing major sections", () => {
    expect(getOnboardingStepDefinitions().map((step) => step.id)).toEqual([
      "asset_identity",
      "hierarchy",
      "function",
      "operating_context",
      "criticality",
      "failure_modes",
      "existing_maintenance",
      "recommended_strategy",
      "condition_monitoring",
      "spares",
      "reliability_baseline",
      "fracas_readiness",
      "risk_safeguards",
      "lifecycle",
      "final_package",
    ]);
  });

  it("starts a pump onboarding session with asset-specific generated content", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard pump P-101",
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(session.assetId).toBe("P-101");
    expect(session.assetClass).toBe("pump");
    expect(session.lifecycle).toBe("in_service");
    expect(session.industry).toBe("general");
    expect(session.steps).toHaveLength(15);
    expect(session.currentStep).toBe("asset_identity");
    expect(session.completionScore).toBeGreaterThan(10);
    expect(
      session.profile.failureModes.map((mode) => mode.failureMode),
    ).toEqual(
      expect.arrayContaining([
        "Mechanical seal leakage",
        "Bearing failure",
        "Cavitation damage",
      ]),
    );
    expect(
      session.finalPackage.fracasSetup.rcaTriggerCriteria.join(" "),
    ).toContain("Repeat failure");
  });

  it("applies existing industry templates and lifecycle paths to onboarding content", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard used pump P-101 oil-sands deep",
      now: new Date("2026-05-20T00:00:00.000Z"),
    });
    const operatingContext = session.steps.find(
      (step) => step.id === "operating_context",
    );

    expect(session.mode).toBe("deep");
    expect(session.lifecycle).toBe("used");
    expect(session.industry).toBe("oil_sands");
    expect(session.profile.onboardingContext.industryTemplateName).toContain(
      "Oil sands",
    );
    expect(session.profile.onboardingContext.industryTemplateCode).toBe(
      "oil_sands",
    );
    expect(session.profile.onboardingContext.sourceTables).toContain(
      "industry_failure_mode_packs",
    );
    expect(session.assumptions.join(" ")).toContain("Used or inherited asset");
    expect(session.assumptions.join(" ")).toContain("Oil sands");
    expect(session.profile.criticality.riskDrivers).toEqual(
      expect.arrayContaining([
        "Environmental consequence",
        "Remote execution constraints",
      ]),
    );
    expect(operatingContext?.questions.join(" ")).toContain("winterization");
    expect(getOnboardingSampleAnswer(session)).toContain("Industry template");
  });

  it("updates progress when the user answers guided questions", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard conveyor CV-204",
      now: new Date("2026-05-20T00:00:00.000Z"),
    });
    const sampleAnswer = getOnboardingSampleAnswer(session);
    const updated = applyAssetOnboardingAnswer({
      session,
      answer: sampleAnswer,
      now: new Date("2026-05-20T00:05:00.000Z"),
    });

    expect(updated.steps[0].completionStatus).toBe("complete");
    expect(updated.steps[0].completionScore).toBe(100);
    expect(updated.currentStep).toBe("hierarchy");
    expect(updated.completionScore).toBeGreaterThan(session.completionScore);
    expect(getCurrentOnboardingStep(updated).id).toBe("hierarchy");
  });

  it("builds all requested export payloads for the final package", () => {
    const session = createAssetOnboardingSession({
      commandText: "/onboard pump P-101",
    });
    const exports = buildAssetOnboardingExports(session);

    expect(exports.markdown).toContain(
      "Reliability-Ready Asset Onboarding Package",
    );
    expect(exports.markdown).toContain("Lifecycle path:");
    expect(exports.markdown).toContain("Industry template:");
    expect(exports.markdown).toContain("Template source tables:");
    expect(exports.markdown).toContain("## FMEA");
    expect(exports.markdown).toContain("## FRACAS Setup");
    expect(exports.json).toContain("criticalityAssessment");
    expect(exports.wordHtml).toContain("<h1>");
    expect(exports.pdfHtml).toContain("<h1>");
    expect(exports.excelWorkbookCsv).toContain("completion_score");
    expect(exports.cmmsImportCsv).toContain("asset_tag");
    expect(exports.cmmsImportCsv).toContain("industry_template");
    expect(exports.powerBiDatasetJson).toContain("failureModes");
    expect(exports.apiPayloadJson).toContain("sessionId");
  });
});
