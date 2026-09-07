import type { InspectionZoneContract } from "./inspection-contracts";
import { miningGraderTemplate } from "./mining-grader";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: [
    "uncontrolled machine movement",
    "personnel inside the blade, circle, or articulation envelope",
    "flight without approved mission assessment",
    "capture requiring entry onto an operating moldboard",
  ],
};

export const miningGraderInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "GR-INSP-STRUCT-CIRCLE",
    assetClassCode: miningGraderTemplate.code,
    componentCode: "GR-STRUCT",
    name: "Frame, articulation, and circle-support exterior condition",
    purpose:
      "Collect repeatable evidence of frame, articulation, and circle-support geometry and visible cracking.",
    targetAreas: [
      "front frame",
      "rear frame",
      "articulation joint",
      "circle support or drawbar mounts",
      "ROPS or FOPS structure",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Record repeatable exterior views of primary load-path members and circle mounts.",
        required: true,
        repeatabilityKey: "gr-struct-circle-rgb",
        acceptanceCriteria: [
          "member identity visible",
          "image sharp enough to resolve paint breaks and crack-like indications",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "drone_lidar",
        objective:
          "Support repeatable frame and circle-geometry comparison where the mission is approved.",
        required: false,
        repeatabilityKey: "gr-struct-circle-lidar",
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
    code: "GR-INSP-CIRCLE-BLADE",
    assetClassCode: miningGraderTemplate.code,
    componentCode: "GR-CIRCLE-BLADE",
    name: "Circle, drawbar, and moldboard condition",
    purpose:
      "Collect evidence of circle backlash, wear-strip condition, and moldboard or cutting-edge wear.",
    targetAreas: [
      "circle and teeth",
      "drawbar",
      "moldboard",
      "cutting edges",
      "circle drive",
      "wear strips",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Capture circle, drawbar, and moldboard exterior condition from an approved standoff.",
        required: true,
        repeatabilityKey: "gr-circle-blade-rgb",
        acceptanceCriteria: [
          "circle or moldboard identity visible",
          "wear-strip and cutting-edge boundaries distinguishable",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "human_visual",
        objective:
          "Confirm suspected defects under approved isolation. Isolation does not authorize work.",
        required: true,
        repeatabilityKey: "gr-circle-blade-isolated-visual",
        acceptanceCriteria: [
          "isolation state documented",
          "defect location referenced to circle, drawbar, or moldboard identity",
          "site approval recorded",
        ],
      },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "GR-INSP-DRIVE-THERMAL",
    assetClassCode: miningGraderTemplate.code,
    componentCode: "GR-DRIVE",
    name: "Drive and tandem thermal route",
    purpose:
      "Identify comparative thermal anomalies at the transmission, tandems, and final drives.",
    targetAreas: [
      "transmission",
      "tandem housings",
      "final drives",
      "service brakes",
    ],
    captures: [
      {
        modality: "drone_thermal",
        objective:
          "Capture repeatable thermal views without entering the travel envelope.",
        required: true,
        repeatabilityKey: "gr-drive-thermal",
        acceptanceCriteria: [
          "emissivity and environmental assumptions recorded",
          "comparable load or travel state recorded",
          "target and peer reference visible",
        ],
      },
      {
        modality: "drone_rgb",
        objective: "Provide visual context for each thermal target.",
        required: true,
        repeatabilityKey: "gr-drive-rgb",
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
];
