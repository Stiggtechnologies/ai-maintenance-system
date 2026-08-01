import type { EngineeringDnaProfile } from "./engineering-dna";
import { primaryCrusherTemplate } from "./primary-crusher";
import {
  flexibleCouplingDna,
  lubricationSystemDna,
  rollingElementBearingDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const primaryCrusherEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.2.0",
  code: "DEDNA-MIN-CRUSH-PRI",
  name: "Primary crusher Digital Engineering DNA",
  description: "Governed reusable blueprint for large primary crusher twins.",
  assetClassCode: primaryCrusherTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
  ],
  componentCodes: primaryCrusherTemplate.components.map((component) => component.code),
  failureModeCodes: primaryCrusherTemplate.components.flatMap((component) =>
    component.failureModes.map((failure) => failure.code),
  ),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(primaryCrusherTemplate.components.flatMap((component) => component.telemetryConcepts)),
  sharedComponentBindings: [
    {
      assetComponentCode: "PCR-DRIVE",
      sharedComponentDnaCode: rollingElementBearingDna.code,
      role: "supports eccentric and rotating drive loads",
    },
    {
      assetComponentCode: "PCR-DRIVE",
      sharedComponentDnaCode: flexibleCouplingDna.code,
      role: "transmits torque from the driver into the crusher drive train",
    },
    {
      assetComponentCode: "PCR-LUBE-HYD",
      sharedComponentDnaCode: lubricationSystemDna.code,
      role: "delivers and conditions lubricant for crusher bearings and drive components",
    },
  ],
  standards: primaryCrusherTemplate.standards,
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
