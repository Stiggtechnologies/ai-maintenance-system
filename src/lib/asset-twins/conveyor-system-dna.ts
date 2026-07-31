import type { EngineeringDnaProfile } from "./engineering-dna";
import { conveyorSystemInspectionZones } from "./conveyor-system-inspections";
import { conveyorSystemTemplate } from "./conveyor-system";

const unique = (values: string[]): string[] => [...new Set(values)];

export const conveyorSystemEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
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
  ],
  componentCodes: conveyorSystemTemplate.components.map((component) => component.code),
  failureModeCodes: conveyorSystemTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: conveyorSystemInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(conveyorSystemTemplate.components.flatMap((component) => component.telemetryConcepts)),
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
