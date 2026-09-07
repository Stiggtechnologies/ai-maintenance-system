import type { InspectionZoneContract } from "./inspection-contracts";
import { stackerReclaimerTemplate } from "./stacker-reclaimer";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: [
    "personnel inside uncontrolled slew or travel envelope",
    "flight without approved mission assessment",
    "capture requiring entry onto an operating boom conveyor",
  ],
};

export const stackerReclaimerInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "SR-INSP-STRUCT-BOOM",
    assetClassCode: stackerReclaimerTemplate.code,
    componentCode: "SR-STRUCT",
    name: "Boom and supporting-structure exterior condition",
    purpose:
      "Collect repeatable evidence of boom, pylon, and counterweight geometry and visible cracking or corrosion.",
    targetAreas: [
      "boom chords",
      "boom foot",
      "pylon or mast",
      "counterweight structure",
      "portal frames",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Record repeatable exterior views of primary load-path members.",
        required: true,
        repeatabilityKey: "sr-struct-boom-rgb",
        acceptanceCriteria: [
          "member identity visible",
          "image sharp enough to resolve paint breaks and crack-like indications",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "drone_lidar",
        objective:
          "Support repeatable boom-geometry comparison where the mission is approved.",
        required: false,
        repeatabilityKey: "sr-struct-boom-lidar",
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
    code: "SR-INSP-SLEW-TRAVEL-THERMAL",
    assetClassCode: stackerReclaimerTemplate.code,
    componentCode: "SR-SLEW",
    name: "Slew and travel rotating-element thermal route",
    purpose:
      "Identify comparative thermal anomalies at slew drives and accessible travel-wheel bearings.",
    targetAreas: [
      "slew motors",
      "slew gearboxes",
      "slew bearing",
      "travel-wheel bearings",
      "travel gearboxes",
    ],
    captures: [
      {
        modality: "drone_thermal",
        objective:
          "Capture repeatable thermal views without entering the travel or slew envelope.",
        required: true,
        repeatabilityKey: "sr-rotating-elements-thermal",
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
        repeatabilityKey: "sr-rotating-elements-rgb",
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
    code: "SR-INSP-BOOM-CONV",
    assetClassCode: stackerReclaimerTemplate.code,
    componentCode: "SR-BOOM-CONV",
    name: "Boom-conveyor exterior condition",
    purpose:
      "Collect evidence of belt tracking, idler condition, and discharge containment on the boom conveyor.",
    targetAreas: [
      "boom belt edges",
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
        repeatabilityKey: "sr-boom-conv-rgb",
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
        repeatabilityKey: "sr-boom-conv-isolated-visual",
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
