import type { EngineeringDnaProfile } from "./engineering-dna";
import { draglineTemplate } from "./dragline";
import {
  frictionBrakeDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  sheaveDna,
  switchgearDna,
  transformerDna,
  variableFrequencyDriveDna,
  wireRopeDna,
} from "./shared-component-dna-library";

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
    "shared_component_composition",
  ],
  componentCodes: draglineTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: draglineTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    draglineTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "DL-HOIST-DRAG",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "hoist and drag motors",
    },
    {
      assetComponentCode: "DL-HOIST-DRAG",
      sharedComponentDnaCode: industrialGearboxComponentDna.code,
      role: "hoist and drag gear trains",
    },
    {
      assetComponentCode: "DL-HOIST-DRAG",
      sharedComponentDnaCode: frictionBrakeDna.code,
      role: "hoist and drag brakes",
    },
    {
      assetComponentCode: "DL-HOIST-DRAG",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "machinery bearings",
    },
    {
      assetComponentCode: "DL-ROPE-SHEAVE",
      sharedComponentDnaCode: wireRopeDna.code,
      role: "hoist drag and dump ropes",
    },
    {
      assetComponentCode: "DL-ROPE-SHEAVE",
      sharedComponentDnaCode: sheaveDna.code,
      role: "boom point and fairlead sheaves",
    },
    {
      assetComponentCode: "DL-ELEC-CTRL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "power distribution",
    },
    {
      assetComponentCode: "DL-ELEC-CTRL",
      sharedComponentDnaCode: transformerDna.code,
      role: "site transformers",
    },
    {
      assetComponentCode: "DL-ELEC-CTRL",
      sharedComponentDnaCode: variableFrequencyDriveDna.code,
      role: "motion drives",
    },
    {
      assetComponentCode: "DL-LUBE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "machine lubrication",
    },
  ],
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
