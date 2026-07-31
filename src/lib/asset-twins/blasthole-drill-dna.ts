import type { EngineeringDnaProfile } from "./engineering-dna";
import { blastholeDrillInspectionZones } from "./blasthole-drill-inspections";
import { blastholeDrillTemplate } from "./blasthole-drill";

const unique = (values: string[]): string[] => [...new Set(values)];

export const blastholeDrillEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-DRILL-BH",
  name: "Blasthole drill Digital Engineering DNA",
  description: "Governed reusable blueprint for large rotary blasthole drill twins.",
  assetClassCode: blastholeDrillTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: blastholeDrillTemplate.components.map((component) => component.code),
  failureModeCodes: blastholeDrillTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: blastholeDrillInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(blastholeDrillTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: blastholeDrillTemplate.standards,
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
