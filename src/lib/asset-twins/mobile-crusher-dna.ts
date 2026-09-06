import type { EngineeringDnaProfile } from "./engineering-dna";
import { mobileCrusherInspectionZones } from "./mobile-crusher-inspections";
import { mobileCrusherTemplate } from "./mobile-crusher";
import {
  flexibleCouplingDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  switchgearDna,
  variableFrequencyDriveDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const mobileCrusherEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-MOBILE-CRUSH",
  name: "Mobile crusher Digital Engineering DNA",
  description:
    "Governed reusable blueprint for mobile crusher twins. Shared component intelligence is referenced, not copied. Draft until authorized engineering and field review.",
  assetClassCode: mobileCrusherTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: mobileCrusherTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: mobileCrusherTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: mobileCrusherInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    mobileCrusherTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "MC-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "crusher drive and eccentric or rotor bearings",
    },
    {
      assetComponentCode: "MC-DRIVE",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "crusher drive coupling",
    },
    {
      assetComponentCode: "MC-DRIVE",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "crusher drive motor",
    },
    {
      assetComponentCode: "MC-FEED-CONV",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "feed-conveyor pulley and idler bearings",
    },
    {
      assetComponentCode: "MC-FEED-CONV",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "feed-conveyor drive coupling",
    },
    {
      assetComponentCode: "MC-FEED-CONV",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "feed-conveyor drive motor",
    },
    {
      assetComponentCode: "MC-FEED-CONV",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "feed-conveyor drive gearbox",
    },
    {
      assetComponentCode: "MC-FEED-CONV",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "feed-conveyor drive lubrication",
    },
    {
      assetComponentCode: "MC-DISCH-CONV",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "discharge-conveyor pulley and idler bearings",
    },
    {
      assetComponentCode: "MC-DISCH-CONV",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "discharge-conveyor drive coupling",
    },
    {
      assetComponentCode: "MC-DISCH-CONV",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "discharge-conveyor drive motor",
    },
    {
      assetComponentCode: "MC-DISCH-CONV",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "discharge-conveyor drive gearbox",
    },
    {
      assetComponentCode: "MC-DISCH-CONV",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "discharge-conveyor drive lubrication",
    },
    {
      assetComponentCode: "MC-LUBE-HYD",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "crusher and plant lubrication",
    },
    {
      assetComponentCode: "MC-LUBE-HYD",
      sharedComponentDnaCode: hydraulicCylinderDna.code,
      role: "adjustment or folding cylinders",
    },
    {
      assetComponentCode: "MC-PROPEL",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "propel motors",
    },
    {
      assetComponentCode: "MC-PROPEL",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "propel final drives",
    },
    {
      assetComponentCode: "MC-PROPEL",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "track or wheel bearings",
    },
    {
      assetComponentCode: "MC-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "power distribution",
    },
    {
      assetComponentCode: "MC-ELEC-CTRL",
      sharedComponentDnaCode: variableFrequencyDriveDna.code,
      role: "crushing, conveying, and travel drives",
    },
  ],
  standards: mobileCrusherTemplate.standards,
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
