import type { OemModelOverlay } from "./types";

const komatsu4100XpcProductEvidence = {
  id: "komatsu-4100xpc-product-page",
  source: "oem_manual" as const,
  title: "Komatsu 4100XPC product information",
  locator: "https://www.komatsu.com/en-us/products/equipment/electric-rope-shovels/4100xpc",
  licence: "Public OEM product information; verify against authorized manuals before field use.",
  retrievedAt: "2026-07-26",
  confidence: 0.9,
};

/**
 * Public-information overlay for the P&H 4100XPC.
 *
 * This overlay intentionally limits itself to model identity, publicly stated
 * architecture, inspection vocabulary and telemetry aliases. Exact limits,
 * clearances, alarm thresholds and maintenance intervals require authorized
 * site/OEM documentation and engineering approval.
 */
export const komatsuPh4100XpcOverlay: OemModelOverlay = {
  schemaVersion: "0.2.0",
  assetClassCode: "MIN-LOAD-ERS",
  manufacturer: "Komatsu",
  model: "P&H 4100XPC",
  aliases: ["4100XPC", "P&H 4100 XPC", "Komatsu P&H 4100XPC"],
  componentOverrides: {
    "ERS-STRUCT": {
      inspectionZones: [
        "boom chords and lacings",
        "boom foot and suspension interfaces",
        "A-frame and gantry",
        "twin-leg handle",
        "machinery house",
        "carbody and crawler interface",
      ],
      telemetryConcepts: [
        "structural_vibration",
        "boom_deflection",
        "cycle_count",
        "payload",
        "dipper_position",
      ],
    },
    "ERS-HOIST": {
      inspectionZones: [
        "hoist motors",
        "planetary transmissions",
        "hoist drum",
        "hoist brakes",
        "hoist ropes",
        "boom point sheaves",
      ],
      telemetryConcepts: [
        "hoist_current",
        "hoist_speed",
        "hoist_torque",
        "brake_temperature",
        "bearing_temperature",
        "cycle_energy",
      ],
    },
    "ERS-CROWD": {
      inspectionZones: [
        "crowd motors",
        "crowd transmissions",
        "twin-leg handle",
        "rack and pinion interfaces",
        "saddle blocks",
      ],
      telemetryConcepts: [
        "crowd_current",
        "crowd_speed",
        "crowd_torque",
        "crowd_position",
        "bearing_temperature",
      ],
    },
    "ERS-SWING": {
      inspectionZones: [
        "swing motors",
        "planetary transmissions",
        "swing pinions",
        "swing rack",
        "swing brakes",
        "centre pintle area",
      ],
      telemetryConcepts: [
        "swing_current",
        "swing_speed",
        "swing_torque",
        "swing_acceleration",
        "gearcase_temperature",
      ],
    },
    "ERS-ELEC": {
      inspectionZones: [
        "trailing cable and cable reel interfaces",
        "high-voltage terminations",
        "AC drive cabinets",
        "motion motors",
        "control cabinets",
        "electrical ventilation paths",
      ],
      telemetryConcepts: [
        "line_voltage",
        "line_current",
        "power_factor",
        "drive_current",
        "cabinet_temperature",
        "fault_code",
      ],
    },
    "ERS-LUBE": {
      inspectionZones: [
        "central lubrication reservoir",
        "lubrication pumps",
        "distribution blocks",
        "hoses and hard lines",
        "open-gear lubricant application points",
        "bearing lubrication points",
      ],
      telemetryConcepts: [
        "lubricant_pressure",
        "lubricant_flow",
        "reservoir_level",
        "component_temperature",
        "pump_run_status",
      ],
    },
    "ERS-DIPPER": {
      inspectionZones: [
        "dipper body and lip",
        "dipper teeth and adapters",
        "door and hinge line",
        "door latch and trip mechanism",
        "bail and equalizer interfaces",
        "rigging and attachment points",
      ],
      telemetryConcepts: [
        "payload",
        "dipper_position",
        "door_open_status",
        "door_close_time",
        "cycle_count",
        "impact_event",
      ],
    },
    "ERS-PROPEL": {
      inspectionZones: [
        "propel motors and transmissions",
        "crawler frames",
        "drive tumblers",
        "idler assemblies",
        "crawler shoes and pins",
        "lower-works lubrication points",
      ],
      telemetryConcepts: [
        "propel_current",
        "propel_speed",
        "propel_torque",
        "propel_gearcase_temperature",
        "crawler_alignment",
        "travel_distance",
      ],
    },
    "ERS-BRAKE": {
      inspectionZones: [
        "hoist brake assemblies",
        "crowd brake assemblies",
        "swing brake assemblies",
        "propel brake assemblies",
        "brake release actuators",
        "brake control interfaces",
      ],
      telemetryConcepts: [
        "brake_command",
        "brake_release_status",
        "brake_temperature",
        "stopping_time",
        "holding_drift",
        "brake_fault_code",
      ],
    },
    "ERS-COOL": {
      inspectionZones: [
        "machinery-house intake paths",
        "filters and screens",
        "fans and fan drives",
        "ducting and plenums",
        "motor cooling paths",
        "drive-cabinet cooling paths",
      ],
      telemetryConcepts: [
        "cooling_fan_status",
        "airflow",
        "filter_differential_pressure",
        "inlet_air_temperature",
        "outlet_air_temperature",
        "cabinet_temperature",
      ],
    },
    "ERS-CONTROL": {
      inspectionZones: [
        "operator controls",
        "motion-control interfaces",
        "limit and position devices",
        "interlock circuits",
        "network and communication cabinets",
        "emergency-stop devices",
      ],
      telemetryConcepts: [
        "operating_state",
        "command_feedback_mismatch",
        "interlock_status",
        "network_health",
        "fault_code",
        "emergency_stop_status",
      ],
    },
  },
  telemetryAliases: {
    hoist_current: ["hoist_motor_current"],
    hoist_speed: ["hoist_motor_speed"],
    crowd_current: ["crowd_motor_current"],
    crowd_position: ["crowd_handle_position"],
    swing_current: ["swing_motor_current"],
    swing_speed: ["swing_speed_feedback"],
    propel_current: ["propel_motor_current"],
    propel_speed: ["propel_speed_feedback"],
    payload: ["payload_2_payload"],
    door_open_status: ["dipper_door_open"],
    brake_release_status: ["motion_brake_released"],
    cooling_fan_status: ["machinery_house_fan_running"],
    operating_state: ["shovel_operating_state"],
    fault_code: ["drive_fault_code"],
  },
  evidence: [komatsu4100XpcProductEvidence],
  reviewState: "draft",
};

export const miningOemModelOverlays: OemModelOverlay[] = [komatsuPh4100XpcOverlay];

export function getMiningOemModelOverlay(
  manufacturer: string,
  model: string,
): OemModelOverlay | undefined {
  const normalizedManufacturer = manufacturer.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase();

  return miningOemModelOverlays.find((overlay) => {
    if (overlay.manufacturer.toLowerCase() !== normalizedManufacturer) return false;
    return (
      overlay.model.toLowerCase() === normalizedModel ||
      overlay.aliases?.some((alias) => alias.toLowerCase() === normalizedModel)
    );
  });
}
