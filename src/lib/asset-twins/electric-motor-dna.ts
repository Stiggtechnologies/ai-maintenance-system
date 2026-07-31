import type { EngineeringDnaProfile } from "./engineering-dna";
import { electricMotorTemplate } from "./electric-motor";

const unique = (values: string[]): string[] => [...new Set(values)];

export const electricMotorEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-IND-ELECTRIC-MOTOR",
  name: "Industrial electric motor Digital Engineering DNA",
  description: "Governed reusable blueprint for industrial AC motor twins across mining, process, utilities and energy applications.",
  assetClassCode: electricMotorTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: electricMotorTemplate.components.map((component) => component.code),
  failureModeCodes: electricMotorTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(electricMotorTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: electricMotorTemplate.standards,
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
