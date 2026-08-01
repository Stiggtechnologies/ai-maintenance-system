import type { EngineeringDnaProfile } from "./engineering-dna";
import { conveyorSystemInspectionZones } from "./conveyor-system-inspections";
import { conveyorSystemTemplate } from "./conveyor-system";
import {
  flexibleCouplingDna,
  lubricationSystemDna,
  rollingElementBearingDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const conveyorSystemEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.2.0",
  code: "DEDNA-FP-CONVEYOR-BELT",
  name: "Bulk material belt conveyor Digital Engineering DNA",
  description: "Governed reusable blueprint for bulk material belt conveyor twins.",
  assetClassCode: conveyorSystemTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: conveyorSystemTemplate.components.map((component) => component.code),
  failureModeCodes: conveyorSystemTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: conveyorSystemInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(conveyorSystemTemplate.components.flatMap((component) => component.telemetryConcepts)),
  sharedComponentBindings: [
    {
      assetComponentCode: "CV-PULLEY",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "pulley bearing support",
    },
    {
      assetComponentCode: "CV-IDLER",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "idler rolling support",
    },
    {
      assetComponentCode: "CV-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "drive train bearing support",
    },
    {
      assetComponentCode: "CV-DRIVE",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "drive torque transmission interface",
    },
    {
      assetComponentCode: "CV-DRIVE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "drive train lubrication support",
    },
  ],
  standards: conveyorSystemTemplate.standards,
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
