import { describe, expect, it } from "vitest";
import { getEngineeringDnaForAssetClass, getEngineeringDnaProfile } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { validateInspectionZoneContract } from "./inspection-contracts";
import { ultraClassHaulTruckEngineeringDna } from "./ultra-class-haul-truck-dna";
import { ultraClassHaulTruckInspectionZones } from "./ultra-class-haul-truck-inspections";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";
import { validateAssetClassTemplate } from "./index";

describe("ultra-class haul truck Digital Engineering DNA", () => {
  it("provides a non-empty canonical hierarchy and governed failure library", () => {
    expect(ultraClassHaulTruckTemplate.components.length).toBeGreaterThan(0);
    expect(
      ultraClassHaulTruckTemplate.components.flatMap((component) => component.failureModes).length,
    ).toBeGreaterThan(0);
    expect(validateAssetClassTemplate(ultraClassHaulTruckTemplate)).toEqual([]);
  });

  it("keeps inspection contracts canonical, repeatable, and site approval gated", () => {
    const componentCodes = new Set(
      ultraClassHaulTruckTemplate.components.map((component) => component.code),
    );

    expect(
      ultraClassHaulTruckInspectionZones.flatMap((zone) =>
        validateInspectionZoneContract(zone, componentCodes),
      ),
    ).toEqual([]);
    expect(
      ultraClassHaulTruckInspectionZones.every(
        (zone) =>
          zone.safety.siteApprovalRequired &&
          zone.safety.exclusionZoneRequired &&
          zone.safety.spotterRequired,
      ),
    ).toBe(true);
  });

  it("validates every DNA reference against the canonical truck and inspection contracts", () => {
    expect(
      validateEngineeringDnaProfile(
        ultraClassHaulTruckEngineeringDna,
        ultraClassHaulTruckTemplate,
        ultraClassHaulTruckInspectionZones,
      ),
    ).toEqual([]);
  });

  it("registers one profile for the haul-truck asset class", () => {
    expect(getEngineeringDnaProfile("DEDNA-MIN-HAUL-TRUCK")).toBe(
      ultraClassHaulTruckEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass("MIN-HAUL-TRUCK")).toBe(
      ultraClassHaulTruckEngineeringDna,
    );
  });

  it("instantiates a customer twin without copying canonical engineering definitions", () => {
    const twin = instantiateEngineeringTwin(ultraClassHaulTruckEngineeringDna, {
      assetId: "truck-401",
      siteId: "mine-a",
      manufacturer: "customer_selected",
      model: "site_configured",
      telemetryMap: { payload: "historian.payload" },
    });

    expect(twin.assetClassCode).toBe("MIN-HAUL-TRUCK");
    expect(twin.baselineStatus).toBe("not_started");
    expect(twin.customerOverrides).toMatchObject({
      engineeringDnaProfileCode: "DEDNA-MIN-HAUL-TRUCK",
      approvalRequired: true,
    });
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
  });

  it("does not invent universal engineering or flight thresholds", () => {
    const serialized = JSON.stringify({
      template: ultraClassHaulTruckTemplate,
      inspections: ultraClassHaulTruckInspectionZones,
      dna: ultraClassHaulTruckEngineeringDna,
    });

    expect(serialized).not.toMatch(/stand[- ]?off distance/i);
    expect(serialized).not.toMatch(/replace after \d+/i);
    expect(ultraClassHaulTruckEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
    expect(ultraClassHaulTruckEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });
});
