import { describe, expect, it } from "vitest";
import { electricRopeShovelTemplate } from "./mining-library";
import { komatsu4100XpcInspectionZones } from "./komatsu-4100xpc-inspections";
import {
  instantiateEngineeringTwin,
  validateEngineeringDnaProfile,
} from "./engineering-dna";
import {
  electricRopeShovelEngineeringDna,
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
} from "./electric-rope-shovel-dna";

describe("Digital Engineering DNA", () => {
  it("references only canonical engineering and inspection identities", () => {
    expect(
      validateEngineeringDnaProfile(
        electricRopeShovelEngineeringDna,
        electricRopeShovelTemplate,
        komatsu4100XpcInspectionZones,
      ),
    ).toEqual([]);
  });

  it("covers the complete current canonical component and failure libraries", () => {
    const canonicalComponents = electricRopeShovelTemplate.components.map((component) => component.code);
    const canonicalFailures = electricRopeShovelTemplate.components.flatMap((component) =>
      component.failureModes.map((failure) => failure.code),
    );

    expect(electricRopeShovelEngineeringDna.componentCodes).toEqual(canonicalComponents);
    expect(electricRopeShovelEngineeringDna.failureModeCodes).toEqual(canonicalFailures);
  });

  it("keeps operational action and threshold governance explicit", () => {
    expect(electricRopeShovelEngineeringDna.governance).toMatchObject({
      siteApprovalRequired: true,
      engineeringApprovalRequired: true,
      customerOverridesRequireApproval: true,
      autonomousOperationalActionAllowed: false,
      thresholdsPolicy: "approved_source_only",
    });
  });

  it("instantiates a customer twin without duplicating engineering definitions", () => {
    const twin = instantiateEngineeringTwin(electricRopeShovelEngineeringDna, {
      assetId: "SHOVEL-101",
      siteId: "MINE-A",
      manufacturer: "Komatsu",
      model: "4100XPC",
      operatingContext: { duty: "production" },
      telemetryMap: { hoist_current: "historian.tag.hoist_current" },
    });

    expect(twin).toMatchObject({
      assetId: "SHOVEL-101",
      siteId: "MINE-A",
      assetClassCode: "MIN-LOAD-ERS",
      baselineStatus: "not_started",
      customerOverrides: {
        engineeringDnaProfileCode: "DEDNA-MIN-LOAD-ERS",
        engineeringDnaSchemaVersion: "0.1.0",
        approvalRequired: true,
      },
    });
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
  });

  it("resolves profiles by DNA or canonical asset-class code", () => {
    expect(getEngineeringDnaProfile("DEDNA-MIN-LOAD-ERS")).toBe(electricRopeShovelEngineeringDna);
    expect(getEngineeringDnaForAssetClass("MIN-LOAD-ERS")).toBe(electricRopeShovelEngineeringDna);
    expect(getEngineeringDnaProfile("UNKNOWN")).toBeUndefined();
  });

  it("rejects unknown canonical references", () => {
    const invalid = {
      ...electricRopeShovelEngineeringDna,
      componentCodes: [...electricRopeShovelEngineeringDna.componentCodes, "UNKNOWN-COMPONENT"],
    };

    expect(
      validateEngineeringDnaProfile(invalid, electricRopeShovelTemplate, komatsu4100XpcInspectionZones),
    ).toContainEqual({
      path: `componentCodes[${invalid.componentCodes.length - 1}]`,
      message: "Unknown canonical component UNKNOWN-COMPONENT.",
    });
  });
});
