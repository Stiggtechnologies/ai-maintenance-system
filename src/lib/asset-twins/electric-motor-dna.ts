import type { EngineeringDnaProfile } from "./engineering-dna";
import { electricMotorTemplate } from "./electric-motor";
import {
  coolingSystemDna,
  industrialAcMotorDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  switchgearDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const electricMotorEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.2.0",
  code: "DEDNA-IND-ELECTRIC-MOTOR",
  name: "Industrial electric motor Digital Engineering DNA",
  description:
    "Governed reusable blueprint for industrial AC motor twins across mining, process, utilities and energy applications.",
  assetClassCode: electricMotorTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: electricMotorTemplate.components.map(
    (component) => component.code,
  ),
  failureModeCodes: electricMotorTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    electricMotorTemplate.components.flatMap(
      (component) => component.telemetryConcepts,
    ),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "EM-STATOR",
      sharedComponentDnaCode: industrialAcMotorDna.code,
      role: "electrical machine functions and insulation intelligence",
    },
    {
      assetComponentCode: "EM-BEARING",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "supports rotor and preserves air-gap geometry",
    },
    {
      assetComponentCode: "EM-BEARING",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "supplies and conditions bearing lubricant",
    },
    {
      assetComponentCode: "EM-COOLING",
      sharedComponentDnaCode: coolingSystemDna.code,
      role: "rejects motor losses",
    },
    {
      assetComponentCode: "EM-TERMINAL",
      sharedComponentDnaCode: switchgearDna.code,
      role: "power connection and protective interface",
    },
  ],
  standards: electricMotorTemplate.standards,
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
