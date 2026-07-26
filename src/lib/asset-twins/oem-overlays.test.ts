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

describe("mining OEM overlays", () => {
  it("uses only component identities already defined by the asset-class template", () => {
    expect(Object.keys(komatsuPh4100XpcOverlay.componentOverrides).every((code) => canonicalComponentCodes.has(code))).toBe(
      true,
    );
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

  it("keeps public information in draft status pending authorized engineering review", () => {
    expect(komatsuPh4100XpcOverlay.reviewState).toBe("draft");
    expect(komatsuPh4100XpcOverlay.evidence).not.toHaveLength(0);
    expect(komatsuPh4100XpcOverlay.evidence.every((item) => item.confidence > 0 && item.confidence <= 1)).toBe(true);
  });
});
