import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { electricRopeShovelEngineeringDna } from "./electric-rope-shovel-dna";
import { electricRopeShovelTemplate } from "./mining-library";
import { komatsuPh4100XpcOverlay } from "./oem-overlays";
import { stackerReclaimerEngineeringDna } from "./stacker-reclaimer-dna";
import { stackerReclaimerTemplate } from "./stacker-reclaimer";
import { inheritSharedIntelligence } from "./shared-component-dna";
import {
  frictionBrakeDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
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
    expect(compiled.asset.telemetryMap.hoist_current).toBe(
      "hoist_motor_current",
    );
    expect(
      compiled.template.components.find((item) => item.code === "ERS-HOIST")
        ?.inspectionZones,
    ).toContain("hoist drum");
    expect(compiled.provenance.overlay).toEqual({
      manufacturer: "Komatsu",
      model: "P&H 4100XPC",
      schemaVersion: "0.2.0",
    });
    expect(compiled.provenance.customerOverrideKeys).toEqual(["criticality"]);
    expect(compiled.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "ERS-BRAKE",
          sharedComponentDnaCode: frictionBrakeDna.code,
        }),
      ]),
    );
  });

  it("references shared intelligence without copying it into the compiled template", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      asset,
      komatsuPh4100XpcOverlay,
      new Date("2026-07-26T00:00:00.000Z"),
      electricRopeShovelEngineeringDna,
    );
    const brake = compiled.template.components.find(
      (item) => item.code === "ERS-BRAKE",
    );
    const inherited = inheritSharedIntelligence(
      frictionBrakeDna.code,
      sharedComponentDnaLibrary,
    );

    expect(brake?.sharedComponentDnaCodes).toContain(frictionBrakeDna.code);
    expect(brake?.failureModes.map((failure) => failure.code)).not.toContain(
      "BRAKE-FAIL-RELEASE",
    );
    expect(inherited?.failureReferenceCodes).toContain("BRAKE-FAIL-RELEASE");
    expect(
      compiled.provenance.sharedComponentReferences.some(
        (reference) =>
          reference.sharedComponentDnaCode === frictionBrakeDna.code,
      ),
    ).toBe(true);
  });

  it("rejects an unknown shared-component reference on a template", () => {
    const invalidTemplate = {
      ...electricRopeShovelTemplate,
      components: electricRopeShovelTemplate.components.map(
        (component, index) =>
          index === 0
            ? { ...component, sharedComponentDnaCodes: ["COMP-DNA-UNKNOWN"] }
            : component,
      ),
    };

    expect(() => compileAssetTwin(invalidTemplate, asset)).toThrow(
      "Unknown shared component DNA",
    );
  });

  it("does not overwrite a customer-provided telemetry mapping", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      { ...asset, telemetryMap: { hoist_current: "SITE_SH04_HOIST_CURRENT" } },
      komatsuPh4100XpcOverlay,
    );

    expect(compiled.asset.telemetryMap.hoist_current).toBe(
      "SITE_SH04_HOIST_CURRENT",
    );
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

  it("keeps electric-rope-shovel compilation backward compatible after catalogue expansion", () => {
    const compiled = compileAssetTwin(
      electricRopeShovelTemplate,
      asset,
      komatsuPh4100XpcOverlay,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(compiled.provenance.assetClassCode).toBe("MIN-LOAD-ERS");
    expect(compiled.template.components.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ERS-CROWD", "ERS-HOIST", "ERS-BRAKE"]),
    );
    expect(
      compiled.template.components.find((item) => item.code === "ERS-CROWD")
        ?.sharedComponentDnaCodes,
    ).toEqual(
      expect.arrayContaining([
        "COMP-DNA-MOTOR-AC",
        "COMP-DNA-GEARBOX-INDUSTRIAL",
      ]),
    );
  });

  it("compiles the stacker-reclaimer without an OEM overlay", () => {
    const compiled = compileAssetTwin(
      stackerReclaimerTemplate,
      {
        assetId: "sr-01",
        assetClassCode: stackerReclaimerTemplate.code,
        siteId: "yard-a",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      stackerReclaimerEngineeringDna,
    );

    expect(compiled.compiledAt).toBe("2026-09-06T00:00:00.000Z");
    expect(compiled.provenance.overlay).toBeUndefined();
    expect(compiled.provenance.sharedComponentReferences.length).toBeGreaterThan(
      0,
    );
  });
});
