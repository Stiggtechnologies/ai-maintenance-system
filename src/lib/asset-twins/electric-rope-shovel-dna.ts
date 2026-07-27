import { electricRopeShovelTemplate } from "./mining-library";
import { komatsu4100XpcInspectionZones } from "./komatsu-4100xpc-inspections";
import type { EngineeringDnaProfile } from "./engineering-dna";

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * First production-shaped Digital Engineering DNA profile.
 *
 * The profile intentionally references the canonical asset library and governed
 * inspection contracts instead of copying component, failure-mode, or inspection
 * definitions into another persistence model.
 */
export const electricRopeShovelEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-LOAD-ERS",
  name: "Electric rope shovel Digital Engineering DNA",
  description:
    "Governed reusable blueprint for instantiating electric rope shovel twins with canonical engineering, inspection, telemetry and recommendation references.",
  assetClassCode: electricRopeShovelTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "inspection_contracts",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: electricRopeShovelTemplate.components.map((component) => component.code),
  failureModeCodes: electricRopeShovelTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: komatsu4100XpcInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    electricRopeShovelTemplate.components.flatMap((component) => component.telemetryConcepts),
  ),
  standards: electricRopeShovelTemplate.standards,
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

export const engineeringDnaLibrary: EngineeringDnaProfile[] = [electricRopeShovelEngineeringDna];

export function getEngineeringDnaProfile(code: string): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find((profile) => profile.code === code);
}

export function getEngineeringDnaForAssetClass(
  assetClassCode: string,
): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find((profile) => profile.assetClassCode === assetClassCode);
}
