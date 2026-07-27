import { describe, expect, it } from "vitest";
import { electricRopeShovelTemplate } from "./mining-library";
import {
  komatsu4100XpcInspectionZones,
  getKomatsu4100XpcInspectionZone,
} from "./komatsu-4100xpc-inspections";
import { validateInspectionZoneContract } from "./inspection-contracts";

const canonicalComponentCodes = new Set(
  electricRopeShovelTemplate.components.map((component) => component.code),
);

describe("4100XPC inspection contracts", () => {
  it("uses unique zone and capture identities", () => {
    const zoneCodes = komatsu4100XpcInspectionZones.map((zone) => zone.code);
    expect(new Set(zoneCodes).size).toBe(zoneCodes.length);

    const captureKeys = komatsu4100XpcInspectionZones.flatMap((zone) =>
      zone.captures.map((capture) => capture.repeatabilityKey),
    );
    expect(new Set(captureKeys).size).toBe(captureKeys.length);
  });

  it("references only canonical components and passes validation", () => {
    expect(
      komatsu4100XpcInspectionZones.flatMap((zone) =>
        validateInspectionZoneContract(zone, canonicalComponentCodes),
      ),
    ).toEqual([]);
  });

  it("keeps site safety approval and controlled-area requirements explicit", () => {
    expect(
      komatsu4100XpcInspectionZones.every(
        (zone) =>
          zone.safety.siteApprovalRequired &&
          zone.safety.exclusionZoneRequired &&
          zone.safety.spotterRequired,
      ),
    ).toBe(true);
  });

  it("does not hard-code flight distances or weather limits without approved sources", () => {
    const serialized = JSON.stringify(komatsu4100XpcInspectionZones);
    expect(serialized).not.toMatch(/stand[- ]?off distance/i);
    expect(serialized).not.toMatch(/\b\d+\s*(m|metres?|meters?|km\/h|mph)\b/i);
    expect(
      komatsu4100XpcInspectionZones.every(
        (zone) => zone.safety.weatherLimitsSource === "mission_specific_assessment",
      ),
    ).toBe(true);
  });

  it("resolves a zone by canonical code", () => {
    expect(getKomatsu4100XpcInspectionZone("4100XPC-INSPECT-HOIST")?.componentCode).toBe("ERS-HOIST");
    expect(getKomatsu4100XpcInspectionZone("UNKNOWN")).toBeUndefined();
  });
});
