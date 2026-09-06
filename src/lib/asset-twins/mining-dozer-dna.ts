import type { EngineeringDnaProfile } from "./engineering-dna";
import { miningDozerInspectionZones } from "./mining-dozer-inspections";
import { miningDozerTemplate } from "./mining-dozer";
import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  switchgearDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const miningDozerEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-DOZER",
  name: "Large mining dozer Digital Engineering DNA",
  description:
    "Governed reusable blueprint for large track-type mining dozer twins. Shared component intelligence is referenced, not copied. Draft until authorized engineering and field review.",
  assetClassCode: miningDozerTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: miningDozerTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: miningDozerTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: miningDozerInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    miningDozerTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "DZ-UNDERCARRIAGE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "roller and idler bearing support",
    },
    {
      assetComponentCode: "DZ-UNDERCARRIAGE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "roller and idler lubrication",
    },
    {
      assetComponentCode: "DZ-IMPLEMENT",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "blade and ripper cylinders",
    },
    {
      assetComponentCode: "DZ-POWER",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "prime-mover cooling",
    },
    {
      assetComponentCode: "DZ-DRIVE",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "transmission and final drives",
    },
    {
      assetComponentCode: "DZ-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "drivetrain bearings",
    },
    {
      assetComponentCode: "DZ-HYD",
      sharedComponentDnaCode: centrifugalPumpComponentDna.code,
      role: "hydraulic pumps",
    },
    {
      assetComponentCode: "DZ-HYD",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "hydraulic actuation",
    },
    {
      assetComponentCode: "DZ-HYD",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "hydraulic cooling",
    },
    {
      assetComponentCode: "DZ-STEER",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "steering clutches or brakes",
    },
    {
      assetComponentCode: "DZ-STEER",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "steering actuation where fitted",
    },
    {
      assetComponentCode: "DZ-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "electrical distribution",
    },
  ],
  standards: miningDozerTemplate.standards,
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
