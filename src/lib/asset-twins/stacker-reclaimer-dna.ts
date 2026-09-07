import type { EngineeringDnaProfile } from "./engineering-dna";
import {
  flexibleCouplingDna,
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  sheaveDna,
  switchgearDna,
  transformerDna,
  variableFrequencyDriveDna,
  wireRopeDna,
} from "./shared-component-dna-library";
import { stackerReclaimerInspectionZones } from "./stacker-reclaimer-inspections";
import { stackerReclaimerTemplate } from "./stacker-reclaimer";

const unique = (values: string[]): string[] => [...new Set(values)];

export const stackerReclaimerEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-STACK-RECLAIM",
  name: "Stacker-reclaimer Digital Engineering DNA",
  description:
    "Governed reusable blueprint for boom-type stacker-reclaimer twins. Shared component intelligence is referenced, not copied. Draft until authorized engineering and field review.",
  assetClassCode: stackerReclaimerTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: stackerReclaimerTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: stackerReclaimerTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: stackerReclaimerInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    stackerReclaimerTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "SR-SLEW",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "slew motors",
    },
    {
      assetComponentCode: "SR-SLEW",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "slew gearboxes",
    },
    {
      assetComponentCode: "SR-SLEW",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "slew bearing support",
    },
    {
      assetComponentCode: "SR-LUFF",
      sharedComponentDnaCode: wireRopeDna.code,
      role: "luffing or hoist ropes",
    },
    {
      assetComponentCode: "SR-LUFF",
      sharedComponentDnaCode: sheaveDna.code,
      role: "luffing sheaves",
    },
    {
      assetComponentCode: "SR-LUFF",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "hydraulic luffing cylinders where fitted",
    },
    {
      assetComponentCode: "SR-LUFF",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "luffing winch motor",
    },
    {
      assetComponentCode: "SR-LUFF",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "luffing holding brakes",
    },
    {
      assetComponentCode: "SR-TRAVEL",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "long-travel motors",
    },
    {
      assetComponentCode: "SR-TRAVEL",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "long-travel gearboxes",
    },
    {
      assetComponentCode: "SR-TRAVEL",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "travel-wheel bearings",
    },
    {
      assetComponentCode: "SR-BOOM-CONV",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "boom-conveyor pulley and idler bearings",
    },
    {
      assetComponentCode: "SR-BOOM-CONV",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "boom-conveyor drive coupling",
    },
    {
      assetComponentCode: "SR-BOOM-CONV",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "boom-conveyor drive motor",
    },
    {
      assetComponentCode: "SR-BOOM-CONV",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "boom-conveyor drive gearbox",
    },
    {
      assetComponentCode: "SR-BOOM-CONV",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "boom-conveyor drive lubrication",
    },
    {
      assetComponentCode: "SR-RECLAIM",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "reclaim-mechanism motor",
    },
    {
      assetComponentCode: "SR-RECLAIM",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "reclaim-mechanism gearbox",
    },
    {
      assetComponentCode: "SR-RECLAIM",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "reclaim-mechanism bearings",
    },
    {
      assetComponentCode: "SR-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "power distribution",
    },
    {
      assetComponentCode: "SR-ELEC-CTRL",
      sharedComponentDnaCode: variableFrequencyDriveDna.code,
      role: "motion drives",
    },
    {
      assetComponentCode: "SR-ELEC-CTRL",
      sharedComponentDnaCode: transformerDna.code,
      role: "site power transformation",
    },
    {
      assetComponentCode: "SR-LUBE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "machine lubrication",
    },
  ],
  standards: stackerReclaimerTemplate.standards,
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
