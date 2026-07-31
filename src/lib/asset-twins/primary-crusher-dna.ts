import type { EngineeringDnaProfile } from "./engineering-dna";
import { primaryCrusherTemplate } from "./primary-crusher";

const unique = (values: string[]): string[] => [...new Set(values)];

export const primaryCrusherEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-CRUSH-PRI",
  name: "Primary crusher Digital Engineering DNA",
  description: "Governed reusable blueprint for large primary crusher twins.",
  assetClassCode: primaryCrusherTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: primaryCrusherTemplate.components.map((component) => component.code),
  failureModeCodes: primaryCrusherTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(primaryCrusherTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: primaryCrusherTemplate.standards,
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
