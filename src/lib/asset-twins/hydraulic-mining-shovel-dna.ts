import type { EngineeringDnaProfile } from "./engineering-dna";
import { hydraulicMiningShovelInspectionZones } from "./hydraulic-mining-shovel-inspections";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";

const unique = (values: string[]): string[] => [...new Set(values)];

export const hydraulicMiningShovelEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-HYD-SHOVEL",
  name: "Hydraulic mining shovel Digital Engineering DNA",
  description: "Governed reusable blueprint for creating hydraulic mining shovel twins with canonical component, failure, inspection, telemetry, and recommendation references.",
  assetClassCode: hydraulicMiningShovelTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: hydraulicMiningShovelTemplate.components.map((component) => component.code),
  failureModeCodes: hydraulicMiningShovelTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: hydraulicMiningShovelInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(hydraulicMiningShovelTemplate.components.flatMap((component) => component.telemetryConcepts)),
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
