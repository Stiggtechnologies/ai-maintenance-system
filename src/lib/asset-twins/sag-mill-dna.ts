import type { EngineeringDnaProfile } from "./engineering-dna";
import { sagMillTemplate } from "./sag-mill";

const unique = (values: string[]): string[] => [...new Set(values)];

export const sagMillEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-PROC-SAG-MILL",
  name: "SAG mill Digital Engineering DNA",
  description:
    "Governed reusable blueprint for semi-autogenous grinding mill twins across mineral-processing comminution circuits.",
  assetClassCode: sagMillTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: sagMillTemplate.components.map((component) => component.code),
  failureModeCodes: sagMillTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    sagMillTemplate.components.flatMap((component) => component.telemetryConcepts),
  ),
  standards: sagMillTemplate.standards,
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
