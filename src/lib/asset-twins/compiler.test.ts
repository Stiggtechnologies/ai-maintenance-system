import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { electricRopeShovelTemplate } from "./mining-library";
import type { CustomerAssetTwinInstance, OemModelOverlay } from "./types";

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

const overlay: OemModelOverlay = {
  schemaVersion: "1.0.0",
  assetClassCode: electricRopeShovelTemplate.code,
  manufacturer: "Komatsu",
  model: "P&H 4100XPC",
  componentOverrides: {
    hoist: { inspectionZones: ["left brake", "right brake", "hoist drum"] },
  },
  telemetryAliases: {
    "hoist.motor.current": ["SH04_HOIST_MOTOR_CURRENT"],
  },
  evidence: [],
  reviewState: "draft",
};

describe("compileAssetTwin", () => {
  it("applies model overlays and deterministic telemetry aliases", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      asset,
      overlay,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(compiled.compiledAt).toBe("2026-07-26T00:00:00.000Z");
    expect(compiled.asset.telemetryMap["hoist.motor.current"]).toBe("SH04_HOIST_MOTOR_CURRENT");
    expect(compiled.template.components.find((item) => item.code === "hoist")?.inspectionZones).toContain("hoist drum");
    expect(compiled.provenance.customerOverrideKeys).toEqual(["criticality"]);
  });

  it("rejects an overlay for another manufacturer", () => {
    expect(() => compileAssetTwin(electricRopeShovelTemplate, asset, { ...overlay, manufacturer: "Other" })).toThrow(
      "does not match",
    );
  });
});
