import { describe, expect, it } from "vitest";
import {
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
} from "./electric-rope-shovel-dna";
import {
  instantiateEngineeringTwin,
  validateEngineeringDnaProfile,
} from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { ballMillEngineeringDna } from "./ball-mill-dna";
import { ballMillTemplate } from "./ball-mill";

describe("Ball mill Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy and identifiers valid", () => {
    expect(validateAssetClassTemplate(ballMillTemplate)).toEqual([]);
    expect(
      new Set(ballMillTemplate.components.map((component) => component.code))
        .size,
    ).toBe(ballMillTemplate.components.length);
    const failureCodes = ballMillTemplate.components.flatMap((component) =>
      component.failureModes.map((failure) => failure.code),
    );
    expect(new Set(failureCodes).size).toBe(failureCodes.length);
  });

  it("covers ball-mill-specific systems without OEM thresholds", () => {
    const componentCodes = ballMillTemplate.components.map(
      (component) => component.code,
    );
    expect(componentCodes).toEqual(
      expect.arrayContaining([
        "BM-SHELL-LINER-MEDIA",
        "BM-TRUNNION-BEARING",
        "BM-DRIVE",
        "BM-LUBE-JACK-COOL",
        "BM-FEED-DISCHARGE",
        "BM-CTRL-PROTECT",
      ]),
    );
    expect(
      ballMillTemplate.components.find(
        (component) => component.code === "BM-DRIVE",
      )?.functions,
    ).toContain("accommodate geared or gearless drive applicability");
    expect(JSON.stringify(ballMillTemplate)).not.toMatch(
      /threshold|interval|setpoint|limit/i,
    );
  });

  it("keeps DNA references canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        ballMillEngineeringDna,
        ballMillTemplate,
        [],
      ),
    ).toEqual([]);
    expect(ballMillEngineeringDna.governance.siteApprovalRequired).toBe(true);
    expect(ballMillEngineeringDna.governance.engineeringApprovalRequired).toBe(
      true,
    );
    expect(
      ballMillEngineeringDna.governance.customerOverridesRequireApproval,
    ).toBe(true);
    expect(
      ballMillEngineeringDna.governance.autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(ballMillEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
  });

  it("supports canonical asset and DNA lookup", () => {
    expect(getAssetClassTemplate(ballMillTemplate.code)).toBe(ballMillTemplate);
    expect(getEngineeringDnaProfile(ballMillEngineeringDna.code)).toBe(
      ballMillEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(ballMillTemplate.code)).toBe(
      ballMillEngineeringDna,
    );
  });

  it("creates an approval-gated customer twin", () => {
    const twin = instantiateEngineeringTwin(ballMillEngineeringDna, {
      assetId: "BM-001",
      siteId: "MINE-1",
      manufacturer: "SITE-APPROVED-OEM",
      model: "SITE-APPROVED-MODEL",
    });
    expect(twin.assetClassCode).toBe(ballMillTemplate.code);
    expect(twin.customerOverrides.engineeringDnaProfileCode).toBe(
      ballMillEngineeringDna.code,
    );
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.baselineStatus).toBe("not_started");
  });

  it("rejects unknown canonical component references", () => {
    const invalid = {
      ...ballMillEngineeringDna,
      componentCodes: [...ballMillEngineeringDna.componentCodes, "BM-UNKNOWN"],
    };
    expect(
      validateEngineeringDnaProfile(invalid, ballMillTemplate, []),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `componentCodes[${ballMillEngineeringDna.componentCodes.length}]`,
        }),
      ]),
    );
  });
});
