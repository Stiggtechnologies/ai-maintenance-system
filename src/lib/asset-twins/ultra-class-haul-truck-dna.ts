import type { EngineeringDnaProfile } from "./engineering-dna";
import {
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  rollingElementBearingDna,
  switchgearDna,
} from "./shared-component-dna-library";
import { ultraClassHaulTruckInspectionZones } from "./ultra-class-haul-truck-inspections";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * Manufacturer-neutral Digital Engineering DNA profile for ultra-class haul trucks.
 * OEM-specific thresholds, intervals, and model overrides remain external and
 * require approved evidence before activation.
 */
export const ultraClassHaulTruckEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-HAUL-TRUCK",
  name: "Ultra-class haul truck Digital Engineering DNA",
  description:
    "Governed reusable blueprint for creating ultra-class haul truck twins with canonical component, failure, inspection, telemetry, and recommendation references.",
  assetClassCode: ultraClassHaulTruckTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: ultraClassHaulTruckTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: ultraClassHaulTruckTemplate.components.flatMap(
    (component) => component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: ultraClassHaulTruckInspectionZones.map(
    (zone) => zone.code,
  ),
  telemetryConcepts: unique(
    ultraClassHaulTruckTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "HT-POWER",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "power-system heat rejection",
    },
    {
      assetComponentCode: "HT-DRIVE",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "wheel or traction motors",
    },
    {
      assetComponentCode: "HT-DRIVE",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "final drives",
    },
    {
      assetComponentCode: "HT-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "drive bearings",
    },
    {
      assetComponentCode: "HT-BRAKE",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "service and parking brakes",
    },
    {
      assetComponentCode: "HT-STEER-SUSP",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "steering cylinders",
    },
    {
      assetComponentCode: "HT-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "electrical distribution",
    },
  ],
  standards: ultraClassHaulTruckTemplate.standards,
  evidence: [],
  governance: {
    reviewState: "draft",
    siteApprovalRequired: true,
    engineeringApprovalRequired: true,
    customerOverridesRequireApproval: true,
    autonomousOperationalActionAllowed: false,
    thresholdsPolicy: "approved_source_only",
  },
};
