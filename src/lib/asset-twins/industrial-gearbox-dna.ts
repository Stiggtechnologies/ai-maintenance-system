import type { EngineeringDnaProfile } from "./engineering-dna";
import { industrialGearboxTemplate } from "./industrial-gearbox";
import {
  flexibleCouplingDna,
  lubricationSystemDna,
  mechanicalSealDna,
  rollingElementBearingDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const industrialGearboxEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.2.0",
  code: "DEDNA-ROT-GEARBOX",
  name: "Industrial gearbox Digital Engineering DNA",
  description: "Governed reusable blueprint for industrial gearbox twins.",
  assetClassCode: industrialGearboxTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "shared_component_composition",
    "digital_twin_instantiation",
    "governed_recommendations",
  ],
  componentCodes: industrialGearboxTemplate.components.map((component) => component.code),
  failureModeCodes: industrialGearboxTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(
    industrialGearboxTemplate.components.flatMap((component) => component.telemetryConcepts),
  ),
  sharedComponentBindings: [
    {
      assetComponentCode: "GB-BEARINGS",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "shaft_support_and_load_transmission",
    },
    {
      assetComponentCode: "GB-BEARINGS",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "input_or_output_torque_interface",
    },
    {
      assetComponentCode: "GB-LUBE",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "gear_and_bearing_lubrication_delivery",
    },
    {
      assetComponentCode: "GB-HOUSING",
      sharedComponentDnaCode: mechanicalSealDna.code,
      role: "rotating_shaft_lubricant_containment",
    },
  ],
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
