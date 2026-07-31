import type { EngineeringDnaProfile } from "./engineering-dna";
import { centrifugalPumpTemplate } from "./centrifugal-pump";

const unique = (values: string[]): string[] => [...new Set(values)];

export const centrifugalPumpEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-ROT-CENT-PUMP",
  name: "Centrifugal pump Digital Engineering DNA",
  description: "Governed reusable blueprint for centrifugal pump twins across process, utility, slurry and water services.",
  assetClassCode: centrifugalPumpTemplate.code,
  capabilities: ["canonical_hierarchy", "failure_mechanisms", "telemetry_concepts", "digital_twin_instantiation", "governed_recommendations"],
  componentCodes: centrifugalPumpTemplate.components.map((component) => component.code),
  failureModeCodes: centrifugalPumpTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(centrifugalPumpTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: centrifugalPumpTemplate.standards,
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
