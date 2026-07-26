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
  schemaVersion: "0.1.0",
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
        "dipper and door structure",
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
    },
  },
  telemetryAliases: {
    hoist_current: ["hoist_motor_current"],
    hoist_speed: ["hoist_motor_speed"],
    crowd_current: ["crowd_motor_current"],
    crowd_position: ["crowd_handle_position"],
    swing_current: ["swing_motor_current"],
    swing_speed: ["swing_speed_feedback"],
    payload: ["payload_2_payload"],
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
