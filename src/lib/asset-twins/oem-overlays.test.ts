import { describe, expect, it } from "vitest";
import { electricRopeShovelTemplate } from "./mining-library";
import {
  getMiningOemModelOverlay,
  komatsuPh4100XpcOverlay,
  miningOemModelOverlays,
} from "./oem-overlays";

const canonicalComponentCodes = new Set(
  electricRopeShovelTemplate.components.map((component) => component.code),
);

const required4100XpcSubsystems = [
  "ERS-STRUCT",
  "ERS-HOIST",
  "ERS-CROWD",
  "ERS-SWING",
  "ERS-ELEC",
  "ERS-LUBE",
  "ERS-DIPPER",
  "ERS-PROPEL",
  "ERS-BRAKE",
  "ERS-COOL",
  "ERS-CONTROL",
];

describe("mining OEM overlays", () => {
  it("uses only component identities already defined by the asset-class template", () => {
    expect(Object.keys(komatsuPh4100XpcOverlay.componentOverrides).every((code) => canonicalComponentCodes.has(code))).toBe(
      true,
    );
  });

  it("covers every required 4100XPC canonical subsystem without parallel identities", () => {
    expect(Object.keys(komatsuPh4100XpcOverlay.componentOverrides).sort()).toEqual(
      [...required4100XpcSubsystems].sort(),
    );
  });

  it("provides model-specific inspection and telemetry coverage for every subsystem", () => {
    for (const code of required4100XpcSubsystems) {
      const override = komatsuPh4100XpcOverlay.componentOverrides[code];
      expect(override?.inspectionZones?.length, `${code} inspection zones`).toBeGreaterThan(0);
      expect(override?.telemetryConcepts?.length, `${code} telemetry concepts`).toBeGreaterThan(0);
    }
  });

  it("contains unique manufacturer and model identities", () => {
    const identities = miningOemModelOverlays.map(
      (overlay) => `${overlay.manufacturer.toLowerCase()}:${overlay.model.toLowerCase()}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("resolves canonical names and aliases without creating duplicate overlays", () => {
    expect(getMiningOemModelOverlay("Komatsu", "P&H 4100XPC")).toBe(komatsuPh4100XpcOverlay);
    expect(getMiningOemModelOverlay("komatsu", "4100xpc")).toBe(komatsuPh4100XpcOverlay);
    expect(getMiningOemModelOverlay("Other", "4100XPC")).toBeUndefined();
  });

  it("uses deterministic telemetry aliases without duplicate canonical keys", () => {
    const canonicalKeys = Object.keys(komatsuPh4100XpcOverlay.telemetryAliases);
    expect(new Set(canonicalKeys).size).toBe(canonicalKeys.length);
    expect(Object.values(komatsuPh4100XpcOverlay.telemetryAliases).every((aliases) => aliases.length === 1)).toBe(true);
  });

  it("keeps public information in draft status pending authorized engineering review", () => {
    expect(komatsuPh4100XpcOverlay.reviewState).toBe("draft");
    expect(komatsuPh4100XpcOverlay.evidence).not.toHaveLength(0);
    expect(komatsuPh4100XpcOverlay.evidence.every((item) => item.confidence > 0 && item.confidence <= 1)).toBe(true);
  });
});
