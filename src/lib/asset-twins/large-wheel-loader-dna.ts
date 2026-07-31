import type { EngineeringDnaProfile } from "./engineering-dna";
import { largeWheelLoaderTemplate } from "./large-wheel-loader";

const unique = (values: string[]): string[] => [...new Set(values)];

export const largeWheelLoaderEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-WHEEL-LOADER",
  name: "Large mining wheel loader Digital Engineering DNA",
  description: "Governed reusable blueprint for creating large mining wheel loader twins.",
  assetClassCode: largeWheelLoaderTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: largeWheelLoaderTemplate.components.map((component) => component.code),
  failureModeCodes: largeWheelLoaderTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(largeWheelLoaderTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: largeWheelLoaderTemplate.standards,
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
