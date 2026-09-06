import type { InspectionZoneContract } from "./inspection-contracts";
import { mobileCrusherTemplate } from "./mobile-crusher";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: [
    "personnel inside uncontrolled crush, conveyor, or travel envelope",
    "flight without approved mission assessment",
    "capture requiring entry onto an operating conveyor or chamber",
  ],
};

export const mobileCrusherInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "MC-INSP-STRUCT",
    assetClassCode: mobileCrusherTemplate.code,
    componentCode: "MC-STRUCT",
    name: "Chassis and hopper exterior condition",
    purpose:
      "Collect repeatable evidence of chassis, hopper, and crusher-mount geometry and visible cracking.",
    targetAreas: [
      "main chassis",
      "hopper or dump pocket",
      "crusher mounts",
      "conveyor stringers",
      "access platforms",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Record repeatable exterior views of primary load-path members.",
        required: true,
        repeatabilityKey: "mc-struct-rgb",
        acceptanceCriteria: [
          "member identity visible",
          "image sharp enough to resolve paint breaks and crack-like indications",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "drone_lidar",
        objective:
          "Support repeatable chassis-geometry comparison where the mission is approved.",
        required: false,
        repeatabilityKey: "mc-struct-lidar",
        acceptanceCriteria: [
          "coordinate reference retained",
          "occlusion documented",
          "dataset quality sufficient for comparison",
        ],
      },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "MC-INSP-CRUSH-DRIVE",
    assetClassCode: mobileCrusherTemplate.code,
    componentCode: "MC-DRIVE",
    name: "Crushing-drive thermal and visual route",
    purpose:
      "Identify comparative thermal anomalies at the crusher drive, coupling, and accessible bearings.",
    targetAreas: [
      "drive motor",
      "coupling",
      "flywheel or sheaves",
      "main bearings",
    ],
    captures: [
      {
        modality: "drone_thermal",
        objective:
          "Capture repeatable thermal views without entering the crush envelope.",
        required: true,
        repeatabilityKey: "mc-crush-drive-thermal",
        acceptanceCriteria: [
          "emissivity and environmental assumptions recorded",
          "comparable load state recorded",
          "target and peer reference visible",
        ],
      },
      {
        modality: "drone_rgb",
        objective: "Provide visual context for each thermal target.",
        required: true,
        repeatabilityKey: "mc-crush-drive-rgb",
        acceptanceCriteria: [
          "component identity visible",
          "guarding and surrounding conditions visible",
          "image registered to thermal capture",
        ],
      },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "MC-INSP-CONVEYORS",
    assetClassCode: mobileCrusherTemplate.code,
    componentCode: "MC-DISCH-CONV",
    name: "Onboard conveyor exterior condition",
    purpose:
      "Collect evidence of belt tracking, idler condition, and discharge containment on onboard conveyors.",
    targetAreas: [
      "feed belt or feeder",
      "discharge belt edges",
      "carry idlers",
      "pulleys",
      "discharge chute",
      "skirts",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Capture belt, idler, and discharge exterior condition from an approved standoff.",
        required: true,
        repeatabilityKey: "mc-conveyors-rgb",
        acceptanceCriteria: [
          "belt or idler identity visible",
          "tracking and spillage boundaries distinguishable",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "human_visual",
        objective:
          "Confirm suspected defects under approved isolation. Isolation does not authorize work.",
        required: true,
        repeatabilityKey: "mc-conveyors-isolated-visual",
        acceptanceCriteria: [
          "isolation state documented",
          "defect location referenced to belt or idler identity",
          "site approval recorded",
        ],
      },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
];
