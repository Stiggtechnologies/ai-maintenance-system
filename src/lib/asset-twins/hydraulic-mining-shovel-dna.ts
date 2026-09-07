import type { EngineeringDnaProfile } from "./engineering-dna";
import { hydraulicMiningShovelInspectionZones } from "./hydraulic-mining-shovel-inspections";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";
import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  switchgearDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const hydraulicMiningShovelEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-HYD-SHOVEL",
  name: "Hydraulic mining shovel Digital Engineering DNA",
  description:
    "Governed reusable blueprint for creating hydraulic mining shovel twins with canonical component, failure, inspection, telemetry, and recommendation references.",
  assetClassCode: hydraulicMiningShovelTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: hydraulicMiningShovelTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: hydraulicMiningShovelTemplate.components.flatMap(
    (component) => component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: hydraulicMiningShovelInspectionZones.map(
    (zone) => zone.code,
  ),
  telemetryConcepts: unique(
    hydraulicMiningShovelTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "HMS-ATTACH",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "attachment cylinders",
    },
    {
      assetComponentCode: "HMS-HYD",
      sharedComponentDnaCode: centrifugalPumpComponentDna.code,
      role: "hydraulic pumps",
    },
    {
      assetComponentCode: "HMS-HYD",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "hydraulic actuation",
    },
    {
      assetComponentCode: "HMS-HYD",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "hydraulic cooling",
    },
    {
      assetComponentCode: "HMS-SWING-PROPEL",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "propel motors",
    },
    {
      assetComponentCode: "HMS-SWING-PROPEL",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "final drives",
    },
    {
      assetComponentCode: "HMS-SWING-PROPEL",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "swing and propel holding brakes",
    },
    {
      assetComponentCode: "HMS-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "electrical distribution",
    },
  ],
  standards: hydraulicMiningShovelTemplate.standards,
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
