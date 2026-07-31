import type { AssetClassTemplate, FailureModeTemplate } from "./types";

const draftFailure = (
  code: string,
  componentCode: string,
  name: string,
  mechanism: string,
  detectableBy: string[],
  verificationMethods: string[],
  severity: 1 | 2 | 3 | 4 | 5,
): FailureModeTemplate => ({
  code,
  componentCode,
  name,
  mechanism,
  causes: [],
  effects: [],
  detectableBy,
  verificationMethods,
  recommendedActions: [],
  severity,
  evidence: [],
  reviewState: "draft",
});

export const centrifugalPumpTemplate: AssetClassTemplate = {
  schemaVersion: "0.2.0",
  code: "ROT-CENT-PUMP",
  name: "Centrifugal pump",
  family: "rotating_fluid_equipment",
  description: "Manufacturer-neutral engineering template for process, slurry, water and utility centrifugal pumps.",
  functions: ["move_fluid", "develop_head", "contain_pressure", "seal_process_fluid", "transmit_torque"],
  operatingStates: ["offline", "standby", "starting", "running", "minimum_flow", "stopping", "maintenance_test"],
  standards: ["ISO 55000", "ISO 14224", "ISO 20816"],
  reviewState: "draft",
  components: [
    {
      code: "PUMP-WET-END",
      name: "Casing, impeller and wear components",
      functions: ["convert shaft energy to fluid head", "contain process pressure"],
      telemetryConcepts: ["suction_pressure", "discharge_pressure", "flow_rate", "differential_head", "efficiency_proxy"],
      inspectionZones: ["casing", "impeller", "wear rings", "volute", "connections"],
      failureModes: [
        draftFailure("PUMP-WET-END-EROSION", "PUMP-WET-END", "Erosion or wear", "material loss changes hydraulic geometry and clearances", ["performance_trend", "vibration", "inspection", "ultrasonic_thickness"], ["internal_inspection", "dimensional_check", "performance_test"], 4),
        draftFailure("PUMP-WET-END-CAVITATION", "PUMP-WET-END", "Cavitation damage", "vapour bubble formation and collapse damages wetted surfaces", ["vibration", "acoustic", "pressure", "performance_trend"], ["hydraulic_assessment", "internal_inspection", "operating_point_review"], 4),
      ],
    },
    {
      code: "PUMP-ROTOR-BEARING",
      name: "Shaft, bearings and coupling",
      functions: ["transmit torque", "locate rotor", "maintain alignment"],
      telemetryConcepts: ["vibration", "bearing_temperature", "shaft_speed", "axial_position", "motor_current"],
      inspectionZones: ["bearing housings", "shaft", "coupling", "base and hold-downs"],
      failureModes: [
        draftFailure("PUMP-BEARING-DEGRADE", "PUMP-ROTOR-BEARING", "Bearing degradation", "surface distress, contamination or lubrication loss increases friction and clearance", ["vibration", "temperature", "oil_analysis", "ultrasound"], ["bearing_inspection", "lubricant_analysis", "alignment_check"], 5),
        draftFailure("PUMP-MISALIGNMENT", "PUMP-ROTOR-BEARING", "Shaft misalignment", "driver and pump shaft centerlines are not collinear under operating conditions", ["vibration", "temperature", "coupling_inspection", "motor_current"], ["laser_alignment", "soft_foot_check", "pipe_strain_check"], 4),
      ],
    },
    {
      code: "PUMP-SEAL",
      name: "Mechanical seal and process containment",
      functions: ["control process leakage", "separate process and atmosphere"],
      telemetryConcepts: ["seal_leakage", "seal_temperature", "barrier_pressure", "flush_flow"],
      inspectionZones: ["seal gland", "seal support system", "flush piping", "drains"],
      failureModes: [
        draftFailure("PUMP-SEAL-LEAK", "PUMP-SEAL", "Seal leakage", "seal faces, secondary seals or support conditions fail to control leakage", ["inspection", "leak_detection", "temperature", "barrier_pressure"], ["seal_system_test", "seal_inspection", "flush_system_verification"], 4),
      ],
    },
    {
      code: "PUMP-LUBE-SUPPORT",
      name: "Lubrication, baseplate and support systems",
      functions: ["provide lubrication", "support alignment", "transfer loads to foundation"],
      telemetryConcepts: ["oil_level", "oil_pressure", "oil_temperature", "base_vibration"],
      inspectionZones: ["lubrication system", "baseplate", "foundation", "anchor bolts", "piping interfaces"],
      failureModes: [
        draftFailure("PUMP-LUBE-LOSS", "PUMP-LUBE-SUPPORT", "Lubrication deficiency", "lubricant quantity, quality or delivery becomes inadequate", ["oil_level", "oil_pressure", "temperature", "oil_analysis"], ["lubrication_system_test", "oil_sample_confirmation", "bearing_inspection"], 5),
        draftFailure("PUMP-BASE-LOOSENESS", "PUMP-LUBE-SUPPORT", "Base or foundation looseness", "loss of support stiffness permits movement and alignment change", ["vibration", "inspection", "motion_amplification"], ["hold_down_inspection", "foundation_assessment", "alignment_check"], 4),
      ],
    },
  ],
};
