import type { EngineeringDnaProfile } from "./engineering-dna";
import { thickenerTemplate } from "./thickener";

const unique = (values: string[]): string[] => [...new Set(values)];

export const thickenerEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-PROC-THICKENER",
  name: "Thickener Digital Engineering DNA",
  description:
    "Governed reusable blueprint for manufacturer-neutral mineral-processing thickener twins across clarification and solids-settling circuits.",
  assetClassCode: thickenerTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: thickenerTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: thickenerTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    thickenerTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  standards: thickenerTemplate.standards,
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
