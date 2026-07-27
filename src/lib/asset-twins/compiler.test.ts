import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { electricRopeShovelTemplate } from "./mining-library";
import { komatsuPh4100XpcOverlay } from "./oem-overlays";
import type { CustomerAssetTwinInstance } from "./types";

const asset: CustomerAssetTwinInstance = {
  assetId: "shovel-04",
  assetClassCode: electricRopeShovelTemplate.code,
  manufacturer: "Komatsu",
  model: "P&H 4100XPC",
  serialNumber: "TEST-001",
  siteId: "mine-a",
  operatingContext: { ambientTemperatureC: -20 },
  telemetryMap: {},
  customerOverrides: { criticality: "A" },
  baselineStatus: "not_started",
};

describe("compileAssetTwin", () => {
  it("applies the governed model overlay and deterministic telemetry aliases", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      asset,
      komatsuPh4100XpcOverlay,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(compiled.compiledAt).toBe("2026-07-26T00:00:00.000Z");
    expect(compiled.asset.telemetryMap.hoist_current).toBe("hoist_motor_current");
    expect(compiled.template.components.find((item) => item.code === "ERS-HOIST")?.inspectionZones).toContain(
      "hoist drum",
    );
    expect(compiled.provenance.overlay).toEqual({
      manufacturer: "Komatsu",
      model: "P&H 4100XPC",
      schemaVersion: "0.1.0",
    });
    expect(compiled.provenance.customerOverrideKeys).toEqual(["criticality"]);
  });

  it("does not overwrite a customer-provided telemetry mapping", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      { ...asset, telemetryMap: { hoist_current: "SITE_SH04_HOIST_CURRENT" } },
      komatsuPh4100XpcOverlay,
    );

    expect(compiled.asset.telemetryMap.hoist_current).toBe("SITE_SH04_HOIST_CURRENT");
  });

  it("accepts a governed model alias", () => {
    expect(() =>
      compileAssetTwin(
        electricRopeShovelTemplate,
        { ...asset, model: "4100XPC" },
        komatsuPh4100XpcOverlay,
      ),
    ).not.toThrow();
  });

  it("rejects an overlay for another manufacturer", () => {
    expect(() =>
      compileAssetTwin(electricRopeShovelTemplate, asset, {
        ...komatsuPh4100XpcOverlay,
        manufacturer: "Other",
      }),
    ).toThrow("does not match");
  });
});
