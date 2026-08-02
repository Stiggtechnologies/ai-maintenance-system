import type { EngineeringDnaProfile } from "./engineering-dna";
import { draglineTemplate } from "./dragline";

const unique = (values: string[]): string[] => [...new Set(values)];

export const draglineEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-DRAGLINE",
  name: "Mining dragline Digital Engineering DNA",
  description:
    "Governed reusable blueprint for large walking dragline twins, including structural, rope, hoist, drag, swing, walking, electrical, and lubrication systems.",
  assetClassCode: draglineTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: draglineTemplate.components.map((component) => component.code),
  failureModeCodes: draglineTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    draglineTemplate.components.flatMap((component) => component.telemetryConcepts),
  ),
  standards: draglineTemplate.standards,
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
