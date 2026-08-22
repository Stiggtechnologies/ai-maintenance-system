import type { EngineeringDnaProfile } from "./engineering-dna";
import { centrifugalPumpTemplate } from "./centrifugal-pump";
import {
  bearingKinematicsPhysicsCapability,
  rotatingMachineryPhysicsCapability,
} from "./physics-capability-library";
import {
  flexibleCouplingDna,
  lubricationSystemDna,
  mechanicalSealDna,
  rollingElementBearingDna,
} from "./shared-component-dna-library";

const unique = (values: string[]): string[] => [...new Set(values)];

export const centrifugalPumpEngineeringDna: EngineeringDnaProfile = {
  schemaVersion: "0.3.0",
  code: "DEDNA-ROT-CENT-PUMP",
  name: "Centrifugal pump Digital Engineering DNA",
  description: "Governed reusable blueprint for centrifugal pump twins across process, utility, slurry and water services.",
  assetClassCode: centrifugalPumpTemplate.code,
  capabilities: [
    "canonical_hierarchy",
    "failure_mechanisms",
    "telemetry_concepts",
    "digital_twin_instantiation",
    "governed_recommendations",
    "shared_component_composition",
    "physics_capability_composition",
  ],
  componentCodes: centrifugalPumpTemplate.components.map((component) => component.code),
  failureModeCodes: centrifugalPumpTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  inspectionZoneCodes: [],
  telemetryConcepts: unique(centrifugalPumpTemplate.components.flatMap((component) => component.telemetryConcepts)),
  sharedComponentBindings: [
    { assetComponentCode: "PUMP-ROTOR-BEARING", sharedComponentDnaCode: rollingElementBearingDna.code, role: "pump shaft support bearings" },
    { assetComponentCode: "PUMP-ROTOR-BEARING", sharedComponentDnaCode: flexibleCouplingDna.code, role: "driver-to-pump torque coupling" },
    { assetComponentCode: "PUMP-SEAL", sharedComponentDnaCode: mechanicalSealDna.code, role: "rotating process-fluid containment" },
    { assetComponentCode: "PUMP-LUBE-SUPPORT", sharedComponentDnaCode: lubricationSystemDna.code, role: "bearing lubrication delivery and condition control" },
  ],
  physicsCapabilityBindings: [
    {
      assetComponentCode: "PUMP-ROTOR-BEARING",
      physicsCapabilityCode: rotatingMachineryPhysicsCapability.code,
      role: "shaft-speed, surface-speed, and rotational-energy engineering reference",
    },
    {
      assetComponentCode: "PUMP-ROTOR-BEARING",
      physicsCapabilityCode: bearingKinematicsPhysicsCapability.code,
      role: "idealized bearing characteristic-frequency diagnostic reference",
    },
  ],
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
