import type { ComponentDependencyEdge, SharedComponentDnaProfile } from "./shared-component-dna";

const governed = {
  reviewState: "draft" as const,
  engineeringApprovalRequired: true as const,
  customerOverridesRequireApproval: true as const,
  autonomousOperationalActionAllowed: false as const,
  thresholdsPolicy: "approved_source_only" as const,
};

export const rollingElementBearingDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-BEARING-ROLLING",
  name: "Rolling-element bearing component DNA",
  category: "bearing",
  description: "Reusable governed engineering profile for rolling-element bearings across rotating equipment.",
  functions: ["support rotating shafts", "transmit radial and axial loads", "maintain controlled relative motion"],
  telemetryConcepts: ["bearing_vibration", "bearing_temperature", "shaft_speed", "lubricant_condition"],
  failureReferences: [
    { code: "BEARING-FATIGUE", mechanismCode: "fatigue", description: "Raceway or rolling-element fatigue damage.", detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"], verificationMethodCodes: ["qualified_engineer_visual_verification", "non_destructive_testing"] },
    { code: "BEARING-LUBRICATION-LOSS", mechanismCode: "wear", description: "Lubrication deficiency or contamination affecting bearing condition.", detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
  ],
  evidence: [],
  governance: governed,
};

export const flexibleCouplingDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-COUPLING-FLEXIBLE",
  name: "Flexible coupling component DNA",
  category: "coupling",
  description: "Reusable governed profile for flexible couplings transmitting torque between rotating shafts.",
  functions: ["transmit torque", "accommodate approved misalignment", "attenuate torsional disturbance"],
  telemetryConcepts: ["coupling_vibration", "shaft_speed", "torsional_response", "coupling_temperature"],
  failureReferences: [
    { code: "COUPLING-WEAR", mechanismCode: "wear", description: "Wear or deterioration of flexible elements or engagement surfaces.", detectionMethodCodes: ["rgb_visual_inspection", "vibration_monitoring"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
    { code: "COUPLING-MISALIGNMENT", mechanismCode: "fatigue", description: "Load amplification associated with alignment or installation condition.", detectionMethodCodes: ["vibration_monitoring", "thermal_imaging"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
  ],
  evidence: [],
  governance: governed,
};

export const mechanicalSealDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-SEAL-MECHANICAL",
  name: "Mechanical seal component DNA",
  category: "seal",
  description: "Reusable governed profile for rotating mechanical seals and containment interfaces.",
  functions: ["contain process fluid", "control leakage", "separate process and atmosphere"],
  telemetryConcepts: ["seal_leakage", "seal_temperature", "seal_flush_pressure", "shaft_speed"],
  failureReferences: [
    { code: "SEAL-FACE-WEAR", mechanismCode: "wear", description: "Seal-face or secondary-sealing deterioration.", detectionMethodCodes: ["rgb_visual_inspection", "thermal_imaging"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
    { code: "SEAL-LEAKAGE", mechanismCode: "corrosion", description: "Loss of containment requiring site-defined evaluation.", detectionMethodCodes: ["rgb_visual_inspection", "fixed_camera"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
  ],
  evidence: [],
  governance: governed,
};

export const lubricationSystemDna: SharedComponentDnaProfile = {
  schemaVersion: "0.1.0",
  code: "COMP-DNA-LUBRICATION-SYSTEM",
  name: "Lubrication system component DNA",
  category: "lubrication_system",
  description: "Reusable governed profile for lubrication delivery, filtration, storage, and condition control.",
  functions: ["deliver lubricant", "remove contaminants", "control lubricant condition", "support heat removal"],
  telemetryConcepts: ["lubricant_pressure", "lubricant_flow", "lubricant_temperature", "filter_differential_pressure", "lubricant_condition"],
  failureReferences: [
    { code: "LUBE-DELIVERY-LOSS", mechanismCode: "wear", description: "Loss or degradation of lubrication delivery.", detectionMethodCodes: ["thermal_imaging", "fixed_camera"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
    { code: "LUBE-CONTAMINATION", mechanismCode: "corrosion", description: "Contamination or degraded lubricant condition.", detectionMethodCodes: ["rgb_visual_inspection"], verificationMethodCodes: ["qualified_engineer_visual_verification"] },
  ],
  evidence: [],
  governance: governed,
};

export const sharedComponentDnaLibrary: SharedComponentDnaProfile[] = [
  rollingElementBearingDna,
  flexibleCouplingDna,
  mechanicalSealDna,
  lubricationSystemDna,
];

export const sharedComponentDependencyGraph: ComponentDependencyEdge[] = [
  { fromComponentCode: flexibleCouplingDna.code, toComponentCode: rollingElementBearingDna.code, relationship: "transmits_load_to", rationale: "Coupling-transmitted torque and alignment loads influence adjacent shaft-bearing systems." },
  { fromComponentCode: lubricationSystemDna.code, toComponentCode: rollingElementBearingDna.code, relationship: "lubricates", rationale: "The lubrication system supplies and conditions lubricant for the bearing system." },
  { fromComponentCode: mechanicalSealDna.code, toComponentCode: rollingElementBearingDna.code, relationship: "protects", rationale: "Seal containment helps limit process-fluid ingress toward adjacent bearing spaces." },
];

export function getSharedComponentDna(code: string): SharedComponentDnaProfile | undefined {
  return sharedComponentDnaLibrary.find((profile) => profile.code === code);
}
