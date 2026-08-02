import { blastholeDrillEngineeringDna } from "./blasthole-drill-dna";
import { centrifugalPumpEngineeringDna } from "./centrifugal-pump-dna";
import { conveyorSystemEngineeringDna } from "./conveyor-system-dna";
import { draglineEngineeringDna } from "./dragline-dna";
import { electricMotorEngineeringDna } from "./electric-motor-dna";
import { electricRopeShovelTemplate } from "./mining-library";
import { hydraulicMiningShovelEngineeringDna } from "./hydraulic-mining-shovel-dna";
import { industrialGearboxEngineeringDna } from "./industrial-gearbox-dna";
import { komatsu4100XpcInspectionZones } from "./komatsu-4100xpc-inspections";
import { largeWheelLoaderEngineeringDna } from "./large-wheel-loader-dna";
import { primaryCrusherEngineeringDna } from "./primary-crusher-dna";
import { sagMillEngineeringDna } from "./sag-mill-dna";
import type { EngineeringDnaProfile } from "./engineering-dna";
import { ultraClassHaulTruckEngineeringDna } from "./ultra-class-haul-truck-dna";

const unique = (values: string[]): string[] => [...new Set(values)];

export const electricRopeShovelEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.1.0",
  code: "DEDNA-MIN-LOAD-ERS",
  name: "Electric rope shovel Digital Engineering DNA",
  description: "Governed reusable blueprint for instantiating electric rope shovel twins with canonical engineering, inspection, telemetry and recommendation references.",
  assetClassCode: electricRopeShovelTemplate.code,
  capabilities: ["canonical_hierarchy", "failure_mechanisms", "inspection_contracts", "telemetry_concepts", "digital_twin_instantiation", "governed_recommendations"],
  componentCodes: electricRopeShovelTemplate.components.map((component) => component.code),
  failureModeCodes: electricRopeShovelTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: komatsu4100XpcInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(electricRopeShovelTemplate.components.flatMap((component) => component.telemetryConcepts)),
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

export const engineeringDnaLibrary: EngineeringDnaProfile[] = [
  electricRopeShovelEngineeringDna,
  ultraClassHaulTruckEngineeringDna,
  hydraulicMiningShovelEngineeringDna,
  largeWheelLoaderEngineeringDna,
  blastholeDrillEngineeringDna,
  primaryCrusherEngineeringDna,
  conveyorSystemEngineeringDna,
  centrifugalPumpEngineeringDna,
  electricMotorEngineeringDna,
  industrialGearboxEngineeringDna,
  draglineEngineeringDna,
  sagMillEngineeringDna,
];

export function getEngineeringDnaProfile(code: string): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find((profile) => profile.code === code);
}

export function getEngineeringDnaForAssetClass(assetClassCode: string): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find((profile) => profile.assetClassCode === assetClassCode);
}
