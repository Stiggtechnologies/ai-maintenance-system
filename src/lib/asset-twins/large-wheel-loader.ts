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

export const largeWheelLoaderTemplate: AssetClassTemplate = {
  schemaVersion: "0.1.0",
  code: "MIN-WHEEL-LOADER",
  name: "Large mining wheel loader",
  family: "mobile_mining_loading",
  description: "Manufacturer-neutral engineering template for large mining wheel loaders.",
  functions: ["dig", "load", "carry", "dump", "steer", "brake", "propel"],
  operatingStates: ["offline", "idle", "digging", "carrying", "dumping", "returning", "maintenance_test"],
  standards: ["ISO 55000", "ISO 13374", "ISO 23247"],
  reviewState: "draft",
  components: [
    {
      code: "WL-STRUCT",
      name: "Frame, articulation and loader linkage",
      functions: ["support machine loads", "articulate", "position bucket"],
      telemetryConcepts: ["payload", "articulation_angle", "boom_position", "cycle_count"],
      inspectionZones: ["front frame", "rear frame", "articulation joint", "boom", "bucket linkage"],
      failureModes: [
        draftFailure("WL-STRUCT-FATIGUE", "WL-STRUCT", "Structural fatigue cracking", "cyclic loading causes crack initiation and propagation", ["drone_rgb", "inspection", "strain_trend"], ["ndt", "dimensional_survey", "engineering_assessment"], 5),
        draftFailure("WL-LINKAGE-WEAR", "WL-STRUCT", "Linkage pin and bore wear", "oscillating loaded joints lose geometry through wear", ["inspection", "motion_tracking", "clearance_trend"], ["dimensional_measurement", "qualified_mechanical_inspection"], 4),
      ],
    },
    {
      code: "WL-POWER",
      name: "Prime mover and cooling",
      functions: ["generate power", "support auxiliaries", "reject heat"],
      telemetryConcepts: ["engine_speed", "fuel_rate", "coolant_temperature", "oil_pressure", "exhaust_temperature"],
      inspectionZones: ["engine", "cooling pack", "intake", "exhaust", "mounts"],
      failureModes: [
        draftFailure("WL-POWER-OVERHEAT", "WL-POWER", "Abnormal power-system heating", "heat generation exceeds cooling capacity", ["temperature", "thermal", "fault_code"], ["cooling_system_test", "oil_analysis", "performance_test"], 4),
      ],
    },
    {
      code: "WL-DRIVE",
      name: "Transmission, axles and final drives",
      functions: ["transmit power", "control traction", "support wheel torque"],
      telemetryConcepts: ["transmission_temperature", "gear_selection", "axle_temperature", "wheel_speed", "slip"],
      inspectionZones: ["transmission", "drive shafts", "differentials", "axles", "final drives"],
      failureModes: [
        draftFailure("WL-DRIVE-BEARING", "WL-DRIVE", "Drive bearing degradation", "surface distress or lubrication loss increases heat and vibration", ["vibration", "oil_analysis", "thermal"], ["bearing_inspection", "oil_sample_confirmation", "alignment_check"], 5),
      ],
    },
    {
      code: "WL-HYD",
      name: "Hydraulic power and actuation",
      functions: ["raise and tilt bucket", "articulate steering", "manage hydraulic energy"],
      telemetryConcepts: ["system_pressure", "oil_temperature", "pump_command", "cylinder_position", "fluid_level"],
      inspectionZones: ["pumps", "valves", "cylinders", "hoses", "reservoir"],
      failureModes: [
        draftFailure("WL-HYD-LEAK", "WL-HYD", "Hydraulic leakage", "seal, hose or fitting damage permits fluid escape", ["drone_rgb", "inspection", "pressure", "fluid_level"], ["leak_source_inspection", "pressure_hold_test", "fluid_sample"], 4),
      ],
    },
    {
      code: "WL-BRAKE-STEER",
      name: "Braking and steering protection",
      functions: ["decelerate", "hold stationary", "control direction", "protect personnel"],
      telemetryConcepts: ["brake_pressure", "steering_pressure", "deceleration", "parking_brake_state", "fault_code"],
      inspectionZones: ["service brakes", "parking brake", "steering cylinders", "accumulators", "lines"],
      failureModes: [
        draftFailure("WL-BRAKE-PRESSURE", "WL-BRAKE-STEER", "Brake pressure loss", "stored or delivered braking energy is not retained", ["pressure", "fault_code", "inspection"], ["pressure_hold_test", "functional_brake_test", "qualified_brake_inspection"], 5),
      ],
    },
  ],
};
