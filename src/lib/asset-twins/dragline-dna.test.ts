import { describe, expect, it } from "vitest";
import { draglineEngineeringDna } from "./dragline-dna";
import { draglineTemplate } from "./dragline";
import { getEngineeringDnaForAssetClass, getEngineeringDnaProfile } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";

describe("dragline Digital Engineering DNA", () => {
  it("keeps the dragline hierarchy and failure references canonical", () => {
    expect(validateAssetClassTemplate(draglineTemplate)).toEqual([]);
    expect(new Set(draglineTemplate.components.map((component) => component.code)).size).toBe(
      draglineTemplate.components.length,
    );
    expect(
      new Set(
        draglineTemplate.components.flatMap((component) =>
          component.failureModes.map((failure) => failure.code),
        ),
      ).size,
    ).toBe(
      draglineTemplate.components.flatMap((component) => component.failureModes).length,
    );
  });

  it("keeps the DNA profile canonical and approval-gated", () => {
    expect(validateEngineeringDnaProfile(draglineEngineeringDna, draglineTemplate, [])).toEqual([]);
    expect(draglineEngineeringDna.governance.siteApprovalRequired).toBe(true);
    expect(draglineEngineeringDna.governance.engineeringApprovalRequired).toBe(true);
    expect(draglineEngineeringDna.governance.customerOverridesRequireApproval).toBe(true);
    expect(draglineEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(draglineEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });

  it("supports canonical asset and DNA lookup", () => {
    expect(getAssetClassTemplate(draglineTemplate.code)).toBe(draglineTemplate);
    expect(getEngineeringDnaProfile(draglineEngineeringDna.code)).toBe(draglineEngineeringDna);
    expect(getEngineeringDnaForAssetClass(draglineTemplate.code)).toBe(draglineEngineeringDna);
  });

  it("creates a governed customer dragline twin", () => {
    const twin = instantiateEngineeringTwin(draglineEngineeringDna, {
      assetId: "DL-001",
      siteId: "MINE-1",
      manufacturer: "customer-approved",
      model: "site-confirmed",
    });
    expect(twin.assetClassCode).toBe(draglineTemplate.code);
    expect(twin.customerOverrides.engineeringDnaProfileCode).toBe(draglineEngineeringDna.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.baselineStatus).toBe("not_started");
  });

  it("rejects non-canonical component references", () => {
    const invalid = {
      ...draglineEngineeringDna,
      componentCodes: [...draglineEngineeringDna.componentCodes, "DL-UNKNOWN"],
    };
    expect(validateEngineeringDnaProfile(invalid, draglineTemplate, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `componentCodes[${draglineEngineeringDna.componentCodes.length}]`,
        }),
      ]),
    );
  });
});
