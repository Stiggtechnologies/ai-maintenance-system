import type { InspectionZoneContract } from "./inspection-contracts";
import { miningDozerTemplate } from "./mining-dozer";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: [
    "uncontrolled machine movement",
    "personnel inside the blade, ripper, or track envelope",
    "flight without approved mission assessment",
    "capture requiring entry onto an operating implement",
  ],
};

export const miningDozerInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "DZ-INSP-STRUCT-IMPLEMENT",
    assetClassCode: miningDozerTemplate.code,
    componentCode: "DZ-STRUCT",
    name: "Frame and implement exterior condition",
    purpose:
      "Collect repeatable evidence of frame, track-frame, blade, and ripper geometry and visible cracking or wear.",
    targetAreas: [
      "main frame",
      "track frames",
      "blade push arms or C-frame",
      "ripper frame",
      "ROPS or FOPS structure",
    ],
    captures: [
      {
        modality: "drone_rgb",
        objective:
          "Record repeatable exterior views of primary load-path members and implement mounts.",
        required: true,
        repeatabilityKey: "dz-struct-implement-rgb",
        acceptanceCriteria: [
          "member identity visible",
          "image sharp enough to resolve paint breaks and crack-like indications",
          "operating or isolation state recorded",
        ],
      },
      {
        modality: "drone_lidar",
        objective:
          "Support repeatable frame and implement-geometry comparison where the mission is approved.",
        required: false,
        repeatabilityKey: "dz-struct-implement-lidar",
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
    code: "DZ-INSP-UNDERCARRIAGE-THERMAL",
    assetClassCode: miningDozerTemplate.code,
    componentCode: "DZ-UNDERCARRIAGE",
    name: "Undercarriage rolling-element thermal route",
    purpose:
      "Identify comparative thermal anomalies at rollers, idlers, sprockets, and accessible final drives.",
    targetAreas: [
      "track rollers",
      "carrier rollers",
      "idlers",
      "sprockets",
      "final-drive housings",
    ],
    captures: [
      {
        modality: "drone_thermal",
        objective:
          "Capture repeatable thermal views without entering the track envelope.",
        required: true,
        repeatabilityKey: "dz-undercarriage-thermal",
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
        repeatabilityKey: "dz-undercarriage-rgb",
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
    code: "DZ-INSP-HYDRAULIC",
    assetClassCode: miningDozerTemplate.code,
    componentCode: "DZ-HYD",
    name: "Hydraulic system exterior condition",
    purpose:
      "Collect evidence of leakage, hose damage, cooling restriction, and abnormal heating.",
    targetAreas: ["pumps", "valves", "reservoir", "hoses", "cylinders", "coolers"],
    captures: [
      {
        modality: "human_visual",
        objective:
          "Confirm suspected leaks under approved isolation. Isolation does not authorize work.",
        required: true,
        repeatabilityKey: "dz-hydraulic-isolated-visual",
        acceptanceCriteria: [
          "isolation state documented",
          "defect location referenced to hose, fitting, or cylinder identity",
          "site approval recorded",
        ],
      },
      {
        modality: "drone_thermal",
        objective: "Capture comparative heat patterns at pumps, coolers, and cylinders.",
        required: false,
        repeatabilityKey: "dz-hydraulic-thermal",
        acceptanceCriteria: [
          "load state recorded",
          "emissivity assumptions documented",
          "comparison basis identified",
        ],
      },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
];
