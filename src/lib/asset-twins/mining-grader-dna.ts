import type { EngineeringDnaProfile } from "./engineering-dna";
import { miningGraderInspectionZones } from "./mining-grader-inspections";
import { miningGraderTemplate } from "./mining-grader";
import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
  rollingElementBearingDna,
  switchgearDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const miningGraderEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-GRADER",
  name: "Motor grader Digital Engineering DNA",
  description:
    "Governed reusable blueprint for motor grader twins. Shared component intelligence is referenced, not copied. Draft until authorized engineering and field review.",
  assetClassCode: miningGraderTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: miningGraderTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: miningGraderTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: miningGraderInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    miningGraderTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "GR-CIRCLE-BLADE",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "circle, blade, and scarifier cylinders",
    },
    {
      assetComponentCode: "GR-POWER",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "prime-mover cooling",
    },
    {
      assetComponentCode: "GR-DRIVE",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "transmission, tandems, and final drives",
    },
    {
      assetComponentCode: "GR-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "drivetrain bearings",
    },
    {
      assetComponentCode: "GR-HYD",
      sharedComponentDnaCode: centrifugalPumpComponentDna.code,
      role: "hydraulic pumps",
    },
    {
      assetComponentCode: "GR-HYD",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "hydraulic actuation",
    },
    {
      assetComponentCode: "GR-HYD",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "hydraulic cooling",
    },
    {
      assetComponentCode: "GR-STEER-ARTIC",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "steering and articulation cylinders",
    },
    {
      assetComponentCode: "GR-BRAKE",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "service and parking brakes",
    },
    {
      assetComponentCode: "GR-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "electrical distribution",
    },
  ],
  standards: miningGraderTemplate.standards,
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
