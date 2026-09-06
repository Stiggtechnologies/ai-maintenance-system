import { blastholeDrillEngineeringDna } from "./blasthole-drill-dna";
import { ballMillEngineeringDna } from "./ball-mill-dna";
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
import { miningDozerEngineeringDna } from "./mining-dozer-dna";
import { miningGraderEngineeringDna } from "./mining-grader-dna";
import { mobileCrusherEngineeringDna } from "./mobile-crusher-dna";
import { stackerReclaimerEngineeringDna } from "./stacker-reclaimer-dna";
import { thickenerEngineeringDna } from "./thickener-dna";
import type { EngineeringDnaProfile } from "./engineering-dna";
import {
  coolingSystemDna,
  frictionBrakeDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  sheaveDna,
  switchgearDna,
  transformerDna,
  variableFrequencyDriveDna,
  wireRopeDna,
} from "./shared-component-dna-library";
import { ultraClassHaulTruckEngineeringDna } from "./ultra-class-haul-truck-dna";

const unique = (values: string[]): string[] => [...new Set(values)];

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
    "shared_component_composition",
  ],
  componentCodes: electricRopeShovelTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: electricRopeShovelTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: komatsu4100XpcInspectionZones.map((zone) => zone.code),
  telemetryConcepts: unique(
    electricRopeShovelTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "ERS-HOIST",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "hoist motors",
    },
    {
      assetComponentCode: "ERS-HOIST",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "hoist brakes",
    },
    {
      assetComponentCode: "ERS-HOIST",
      sharedComponentDnaCode: wireRopeDna.code,
      role: "hoist ropes",
    },
    {
      assetComponentCode: "ERS-HOIST",
      sharedComponentDnaCode: sheaveDna.code,
      role: "hoist sheaves",
    },
    {
      assetComponentCode: "ERS-CROWD",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "crowd motors",
    },
    {
      assetComponentCode: "ERS-CROWD",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "crowd transmissions",
    },
    {
      assetComponentCode: "ERS-SWING",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "swing motors",
    },
    {
      assetComponentCode: "ERS-SWING",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "swing gearcases",
    },
    {
      assetComponentCode: "ERS-SWING",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "swing brakes",
    },
    {
      assetComponentCode: "ERS-ELEC",
      sharedComponentDnaCode: switchgearDna.code,
      role: "power distribution",
    },
    {
      assetComponentCode: "ERS-ELEC",
      sharedComponentDnaCode: variableFrequencyDriveDna.code,
      role: "motion drives",
    },
    {
      assetComponentCode: "ERS-ELEC",
      sharedComponentDnaCode: transformerDna.code,
      role: "site power transformation",
    },
    {
      assetComponentCode: "ERS-LUBE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "machine lubrication",
    },
    {
      assetComponentCode: "ERS-PROPEL",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "propel motors",
    },
    {
      assetComponentCode: "ERS-PROPEL",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "propel transmissions",
    },
    {
      assetComponentCode: "ERS-BRAKE",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "machine braking",
    },
    {
      assetComponentCode: "ERS-COOL",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "equipment cooling",
    },
  ],
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
  ballMillEngineeringDna,
  primaryCrusherEngineeringDna,
  conveyorSystemEngineeringDna,
  centrifugalPumpEngineeringDna,
  electricMotorEngineeringDna,
  industrialGearboxEngineeringDna,
  draglineEngineeringDna,
  sagMillEngineeringDna,
  thickenerEngineeringDna,
  stackerReclaimerEngineeringDna,
  miningDozerEngineeringDna,
  miningGraderEngineeringDna,
  mobileCrusherEngineeringDna,
];

export function getEngineeringDnaProfile(
  code: string,
): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find((profile) => profile.code === code);
}

export function getEngineeringDnaForAssetClass(
  assetClassCode: string,
): EngineeringDnaProfile | undefined {
  return engineeringDnaLibrary.find(
    (profile) => profile.assetClassCode === assetClassCode,
  );
}
