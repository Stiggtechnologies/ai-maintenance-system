import type { EngineeringDnaProfile } from "./engineering-dna";
import { industrialGearboxTemplate } from "./industrial-gearbox";

const unique = (values: string[]): string[] => [...new Set(values)];

export const industrialGearboxEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-ROT-GEARBOX",
  name: "Industrial gearbox Digital Engineering DNA",
  description: "Governed reusable blueprint for industrial gearbox twins.",
  assetClassCode: industrialGearboxTemplate.code,
  capabilities: ["canonical_hierarchy", "failure_mechanisms", "telemetry_concepts", "digital_twin_instantiation", "governed_recommendations"],
  componentCodes: industrialGearboxTemplate.components.map((component) => component.code),
  failureModeCodes: industrialGearboxTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(industrialGearboxTemplate.components.flatMap((component) => component.telemetryConcepts)),
  standards: industrialGearboxTemplate.standards,
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
