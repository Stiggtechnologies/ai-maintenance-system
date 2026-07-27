import type { InspectionZoneContract } from "./inspection-contracts";

const sharedSafety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: [
    "unauthorized personnel inside the controlled inspection area",
    "precipitation, wind or visibility outside approved aircraft and site limits",
    "uncontrolled shovel movement",
    "energized approach where the approved mission requires de-energization",
  ],
};

const rgbCapture = (repeatabilityKey: string, objective: string) => ({
  modality: "drone_rgb" as const,
  objective,
  required: true,
  repeatabilityKey,
  acceptanceCriteria: [
    "target area fully visible without material occlusion",
    "image sharp enough for engineering review at the required zoom level",
    "capture includes a stable location reference for comparison with prior inspections",
  ],
});

const thermalCapture = (repeatabilityKey: string, objective: string) => ({
  modality: "drone_thermal" as const,
  objective,
  required: false,
  repeatabilityKey,
  acceptanceCriteria: [
    "thermal image is captured within the approved operating-state window",
    "emissivity and reflected-temperature assumptions are recorded",
    "comparable reference area is included for relative-temperature assessment",
  ],
});

const lidarCapture = (repeatabilityKey: string, objective: string) => ({
  modality: "drone_lidar" as const,
  objective,
  required: false,
  repeatabilityKey,
  acceptanceCriteria: [
    "registered point cloud covers all nominated geometry surfaces",
    "control or reference points support comparison with the approved baseline",
    "point density and alignment error are recorded with the evidence package",
  ],
});

export const komatsu4100XpcInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "4100XPC-INSPECT-STRUCT-UPPER",
    assetClassCode: "MIN-LOAD-ERS",
    model: "P&H 4100XPC",
    componentCode: "ERS-STRUCT",
    name: "Boom, gantry and upper-structure inspection",
    purpose: "Capture repeatable evidence of visible cracking, deformation, looseness and geometry change.",
    targetAreas: [
      "boom chords and lacings",
      "boom foot and suspension interfaces",
      "A-frame and gantry",
      "machinery-house exterior and primary structural interfaces",
    ],
    captures: [
      rgbCapture("4100xpc-struct-upper-rgb", "Identify visible cracks, coating disturbance, deformation and loose or missing hardware."),
      thermalCapture("4100xpc-struct-upper-thermal", "Identify thermal patterns that may support review of friction, electrical heating or active crack indications."),
      lidarCapture("4100xpc-struct-upper-lidar", "Compare boom and gantry geometry with an approved baseline."),
    ],
    safety: sharedSafety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "4100XPC-INSPECT-HOIST",
    assetClassCode: "MIN-LOAD-ERS",
    model: "P&H 4100XPC",
    componentCode: "ERS-HOIST",
    name: "Hoist machinery and rope-path inspection",
    purpose: "Capture repeatable evidence of rope condition, sheave tracking, leakage, guarding and abnormal heat.",
    targetAreas: ["hoist ropes", "boom point sheaves", "hoist drum interfaces", "hoist brakes and drive housings"],
    captures: [
      rgbCapture("4100xpc-hoist-rgb", "Identify visible rope deterioration, tracking anomalies, leakage, debris and guarding defects."),
      thermalCapture("4100xpc-hoist-thermal", "Compare brake, bearing and drive-housing temperature patterns under an approved operating condition."),
    ],
    safety: sharedSafety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "4100XPC-INSPECT-DIPPER",
    assetClassCode: "MIN-LOAD-ERS",
    model: "P&H 4100XPC",
    componentCode: "ERS-DIPPER",
    name: "Dipper, door and rigging inspection",
    purpose: "Capture repeatable evidence of structural damage, latch deterioration, wear and rigging condition.",
    targetAreas: ["dipper shell and lip", "door and hinge interfaces", "latch and trip mechanism", "bail and rigging interfaces"],
    captures: [
      rgbCapture("4100xpc-dipper-rgb", "Identify cracks, impact damage, wear, missing hardware and rigging deterioration."),
      lidarCapture("4100xpc-dipper-lidar", "Track material loss or geometry change against an approved baseline."),
    ],
    safety: sharedSafety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "4100XPC-INSPECT-LOWER-WORKS",
    assetClassCode: "MIN-LOAD-ERS",
    model: "P&H 4100XPC",
    componentCode: "ERS-PROPEL",
    name: "Crawler, propel and lower-works inspection",
    purpose: "Capture repeatable evidence of running-gear condition, alignment, leakage and abnormal heating.",
    targetAreas: ["crawler frames", "rollers and idlers", "drive tumblers", "propel drive housings", "carbody interfaces"],
    captures: [
      rgbCapture("4100xpc-lower-works-rgb", "Identify visible wear, cracking, leakage, debris packing and hardware condition."),
      thermalCapture("4100xpc-lower-works-thermal", "Compare left-right and component-to-component temperature patterns after an approved operating cycle."),
      lidarCapture("4100xpc-lower-works-lidar", "Compare crawler and carbody geometry with an approved baseline."),
    ],
    safety: sharedSafety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "4100XPC-INSPECT-ELECTRICAL-COOLING",
    assetClassCode: "MIN-LOAD-ERS",
    model: "P&H 4100XPC",
    componentCode: "ERS-ELEC",
    name: "External electrical and ventilation-path inspection",
    purpose: "Capture external evidence of cable damage, termination heating, blocked airflow and cabinet-condition anomalies.",
    targetAreas: [
      "trailing cable and machine entry interfaces",
      "approved external high-voltage termination views",
      "cabinet exterior surfaces",
      "air inlets, outlets, filters and fan discharge paths",
    ],
    captures: [
      rgbCapture("4100xpc-electrical-cooling-rgb", "Identify cable damage, contamination, blocked airflow, damaged covers and loose external hardware."),
      thermalCapture("4100xpc-electrical-cooling-thermal", "Identify relative hot spots at approved external electrical and ventilation targets."),
    ],
    safety: sharedSafety,
    evidence: [],
    reviewState: "draft",
  },
];

export function getKomatsu4100XpcInspectionZone(code: string): InspectionZoneContract | undefined {
  return komatsu4100XpcInspectionZones.find((zone) => zone.code === code);
}
