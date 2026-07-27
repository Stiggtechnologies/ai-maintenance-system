import type { ComponentTemplate, FailureModeTemplate } from "./types";

const draftFailure = (
  code: string,
  componentCode: string,
  name: string,
  mechanism: string,
  detectableBy: string[],
  verificationMethods: string[],
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
  severity: 3,
  evidence: [],
  reviewState: "draft",
});

/**
 * Canonical electric-rope-shovel subsystems that were missing from the initial
 * foundation template. These are asset-class components, not 4100XPC-specific
 * copies; OEM overlays may refine their zones and telemetry vocabulary.
 */
export const extendedElectricRopeShovelComponents: ComponentTemplate[] = [
  {
    code: "ERS-DIPPER",
    name: "Dipper, door and rigging system",
    functions: ["penetrate and retain material", "release payload", "transfer digging loads"],
    telemetryConcepts: ["dipper_position", "door_state", "payload", "cycle_count", "impact_event"],
    inspectionZones: ["dipper body", "lip and adapters", "door", "door latch", "equalizer and rigging"],
    failureModes: [
      draftFailure(
        "ERS-DIPPER-CRACK",
        "ERS-DIPPER",
        "Dipper or door structural cracking",
        "cyclic loading, impact, wear-section loss or local stress concentration",
        ["drone_rgb", "inspection", "acoustic_emission", "impact_event"],
        ["magnetic_particle", "dye_penetrant", "ultrasonic_test", "engineer_visual"],
      ),
      draftFailure(
        "ERS-DIPPER-LATCH-DEGRADE",
        "ERS-DIPPER",
        "Door latch or release deterioration",
        "wear, deformation, contamination, misadjustment or actuator degradation",
        ["door_state", "cycle_time", "drone_rgb", "inspection"],
        ["functional_test", "wear_measurement", "alignment_inspection"],
      ),
    ],
  },
  {
    code: "ERS-PROPEL",
    name: "Propel and lower-works system",
    functions: ["translate machine", "support ground loads", "steer by differential motion"],
    telemetryConcepts: ["propel_current", "propel_speed", "travel_distance", "bearing_temperature", "track_slip"],
    inspectionZones: ["propel motors", "propel transmissions", "crawler frames", "rollers", "tumblers", "crawler shoes"],
    failureModes: [
      draftFailure(
        "ERS-PROPEL-TRACK-DEGRADE",
        "ERS-PROPEL",
        "Crawler-track and running-gear deterioration",
        "abrasive wear, impact, inadequate lubrication, misalignment or uneven load distribution",
        ["drone_rgb", "drone_thermal", "drone_lidar", "track_slip", "propel_current"],
        ["undercarriage_measurement", "alignment_survey", "bearing_inspection"],
      ),
      draftFailure(
        "ERS-PROPEL-DRIVE-HEAT",
        "ERS-PROPEL",
        "Abnormal propel-drive heating",
        "friction, overload, lubrication loss, bearing damage or gear distress",
        ["drone_thermal", "propel_current", "bearing_temperature", "vibration"],
        ["vibration_analysis", "oil_analysis", "gear_inspection"],
      ),
    ],
  },
  {
    code: "ERS-BRAKE",
    name: "Machine braking system",
    functions: ["stop commanded motion", "hold mechanisms stationary", "provide fail-safe restraint"],
    telemetryConcepts: ["brake_command", "brake_release_state", "brake_temperature", "stopping_time", "motion_feedback"],
    inspectionZones: ["hoist brakes", "crowd brakes", "swing brakes", "propel brakes", "release mechanisms"],
    failureModes: [
      draftFailure(
        "ERS-BRAKE-FAIL-RELEASE",
        "ERS-BRAKE",
        "Brake fails to release completely",
        "binding, inadequate release force, contamination, misalignment or control fault",
        ["brake_temperature", "motor_current", "brake_release_state", "cycle_energy"],
        ["release_system_test", "brake_clearance_inspection", "control_signal_test"],
      ),
      draftFailure(
        "ERS-BRAKE-HOLD-LOSS",
        "ERS-BRAKE",
        "Brake holding-capacity deterioration",
        "friction-material wear, contamination, maladjustment, spring degradation or mechanical damage",
        ["motion_feedback", "stopping_time", "inspection"],
        ["static_hold_test", "lining_measurement", "spring_force_test"],
      ),
    ],
  },
  {
    code: "ERS-COOL",
    name: "Cooling and ventilation system",
    functions: ["remove equipment heat", "maintain cabinet environment", "control contamination ingress"],
    telemetryConcepts: ["airflow", "filter_differential_pressure", "inlet_temperature", "outlet_temperature", "fan_current"],
    inspectionZones: ["fans and motors", "filters", "ducts", "heat exchangers", "cabinet inlets and exhausts"],
    failureModes: [
      draftFailure(
        "ERS-COOL-AIRFLOW-LOSS",
        "ERS-COOL",
        "Cooling-airflow degradation",
        "filter loading, fan failure, obstruction, duct leakage or recirculation",
        ["airflow", "filter_differential_pressure", "fan_current", "drone_thermal", "cabinet_temperature"],
        ["airflow_test", "filter_inspection", "fan_rotation_test", "duct_inspection"],
      ),
    ],
  },
  {
    code: "ERS-CONTROL",
    name: "Operator, protection and control system",
    functions: ["interpret operator commands", "sequence machine motion", "protect personnel and equipment", "record events"],
    telemetryConcepts: ["command_state", "interlock_state", "fault_code", "event_log", "operator_input", "network_health"],
    inspectionZones: ["operator controls", "PLC and I/O", "motion controllers", "safety circuits", "communication networks"],
    failureModes: [
      draftFailure(
        "ERS-CONTROL-INTERMITTENT",
        "ERS-CONTROL",
        "Intermittent control or interlock fault",
        "connection degradation, sensor instability, power-quality disturbance, software state or network interruption",
        ["fault_code", "event_log", "network_health", "command_state", "interlock_state"],
        ["event_sequence_review", "signal_integrity_test", "network_diagnostic", "functional_test"],
      ),
    ],
  },
];
