import { describe, expect, it } from "vitest";
import { automaticTransferSwitchTemplate } from "./automatic-transfer-switch";
import {
  automaticTransferSwitchEngineeringDna,
  criticalFacilityEngineeringDna,
  dataCenterChillerEngineeringDna,
  standbyGeneratorEngineeringDna,
  upsSystemEngineeringDna,
} from "./critical-facility-dna";
import { dataCenterChillerTemplate } from "./data-center-chiller";
import {
  instantiateEngineeringTwin,
  validateEngineeringDnaProfile,
} from "./engineering-dna";
import {
  engineeringDnaLibrary,
  getEngineeringDnaForAssetClass,
} from "./electric-rope-shovel-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import {
  getSharedComponentDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
import { standbyGeneratorTemplate } from "./standby-generator";
import { upsSystemTemplate } from "./ups-system";

const pairs = [
  [standbyGeneratorTemplate, standbyGeneratorEngineeringDna],
  [upsSystemTemplate, upsSystemEngineeringDna],
  [automaticTransferSwitchTemplate, automaticTransferSwitchEngineeringDna],
  [dataCenterChillerTemplate, dataCenterChillerEngineeringDna],
] as const;

describe("critical power and cooling Digital Engineering DNA", () => {
  it.each(pairs)("%s keeps a valid canonical hierarchy and DNA", (template, dna) => {
    expect(validateAssetClassTemplate(template)).toEqual([]);
    expect(
      validateEngineeringDnaProfile(dna, template, [], sharedComponentDnaLibrary),
    ).toEqual([]);
  });

  it.each(pairs)("%s is draft, approval-gated and never acts on its own", (template, dna) => {
    expect(template.reviewState).toBe("draft");
    expect(dna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(dna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(dna.governance.engineeringApprovalRequired).toBe(true);
    for (const component of template.components) {
      for (const failure of component.failureModes) {
        expect(failure.reviewState).toBe("draft");
        expect(failure.recommendedActions).toEqual([]);
        expect(failure.evidence).toEqual([]);
        expect(failure.detectableBy.length).toBeGreaterThan(0);
        expect(failure.verificationMethods.length).toBeGreaterThan(0);
      }
    }
  });

  it.each(pairs)("%s carries no numeric limits in its text", (template) => {
    // Limits, intervals and setpoints come only from an approved source.
    const text = JSON.stringify(template);
    expect(text).not.toMatch(/\d+\s?(%|°|deg|kpa|psi|bar|volts?|vdc|vac|hz|hours?|hrs|minutes?|seconds?|ms)\b/i);
  });

  it.each(pairs)("%s is registered for lookup and twin creation", (template, dna) => {
    expect(getAssetClassTemplate(template.code)).toBe(template);
    expect(getEngineeringDnaForAssetClass(template.code)).toBe(dna);
    expect(engineeringDnaLibrary).toContain(dna);
    const twin = instantiateEngineeringTwin(dna, { assetId: "DC1-ASSET", siteId: "DC1" });
    expect(twin.assetClassCode).toBe(template.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });

  it("binds every component reference to a real shared component", () => {
    for (const dna of criticalFacilityEngineeringDna) {
      for (const binding of dna.sharedComponentBindings ?? []) {
        expect(getSharedComponentDna(binding.sharedComponentDnaCode)).toBeDefined();
      }
    }
    expect(upsSystemEngineeringDna.sharedComponentBindings?.map((b) => b.sharedComponentDnaCode)).toEqual(
      expect.arrayContaining(["COMP-DNA-POWER-CONVERTER", "COMP-DNA-BATTERY-STATIONARY"]),
    );
    expect(standbyGeneratorEngineeringDna.sharedComponentBindings?.map((b) => b.sharedComponentDnaCode)).toContain(
      "COMP-DNA-ENGINE-RECIPROCATING",
    );
    expect(dataCenterChillerEngineeringDna.sharedComponentBindings?.map((b) => b.sharedComponentDnaCode)).toContain(
      "COMP-DNA-REFRIGERATION-CIRCUIT",
    );
  });

  it("rejects a profile that claims a component the template does not have", () => {
    const invalid = {
      ...upsSystemEngineeringDna,
      componentCodes: [...upsSystemEngineeringDna.componentCodes, "UPS-NOT-REAL"],
    };
    expect(
      validateEngineeringDnaProfile(invalid, upsSystemTemplate, [], sharedComponentDnaLibrary).length,
    ).toBeGreaterThan(0);
  });

  it("rejects an unknown shared component reference", () => {
    const broken = {
      ...standbyGeneratorTemplate,
      components: standbyGeneratorTemplate.components.map((component, index) =>
        index === 0 ? { ...component, sharedComponentDnaCodes: ["COMP-DNA-NOT-REAL"] } : component,
      ),
    };
    expect(validateAssetClassTemplate(broken).some((issue) => issue.message.includes("Unknown shared component DNA"))).toBe(true);
  });
});
