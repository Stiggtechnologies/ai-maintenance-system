import type { InspectionZoneContract } from "./inspection-contracts";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: ["active digging cycle", "uncontrolled machine movement", "unapproved energized access"],
};

export const hydraulicMiningShovelInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "HMS-INSPECT-STRUCTURE",
    assetClassCode: hydraulicMiningShovelTemplate.code,
    componentCode: "HMS-STRUCT",
    name: "Primary structure inspection",
    purpose: "Capture repeatable evidence of cracking, deformation, impact, and thermal anomalies.",
    targetAreas: ["carbody", "upper frame", "boom foot", "counterweight supports"],
    captures: [
      { modality: "drone_rgb", objective: "Record visible surface condition", required: true, repeatabilityKey: "hms-structure-rgb", acceptanceCriteria: ["targets visible", "sufficient overlap", "no motion blur"] },
      { modality: "drone_thermal", objective: "Record comparative thermal patterns", required: false, repeatabilityKey: "hms-structure-thermal", acceptanceCriteria: ["emissivity assumptions recorded", "ambient conditions recorded"] },
      { modality: "drone_lidar", objective: "Record geometry for change detection", required: false, repeatabilityKey: "hms-structure-lidar", acceptanceCriteria: ["reference geometry captured", "registration targets available"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "HMS-INSPECT-ATTACHMENT",
    assetClassCode: hydraulicMiningShovelTemplate.code,
    componentCode: "HMS-ATTACH",
    name: "Attachment and linkage inspection",
    purpose: "Capture repeatable evidence for structural condition, wear, leakage, and joint integrity.",
    targetAreas: ["boom", "stick", "bucket", "pins", "bushings", "cylinder mounts"],
    captures: [
      { modality: "drone_rgb", objective: "Record attachment surfaces and joints", required: true, repeatabilityKey: "hms-attachment-rgb", acceptanceCriteria: ["all target joints visible", "scale reference included where practicable"] },
      { modality: "drone_thermal", objective: "Identify comparative heat patterns", required: false, repeatabilityKey: "hms-attachment-thermal", acceptanceCriteria: ["load state recorded", "ambient conditions recorded"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "HMS-INSPECT-HYDRAULIC-DRIVE",
    assetClassCode: hydraulicMiningShovelTemplate.code,
    componentCode: "HMS-HYD",
    name: "Hydraulic system inspection",
    purpose: "Capture evidence of leakage, hose damage, cooling restriction, and abnormal heating.",
    targetAreas: ["pumps", "valves", "reservoir", "hoses", "cylinders", "coolers"],
    captures: [
      { modality: "human_visual", objective: "Record leakage and physical condition", required: true, repeatabilityKey: "hms-hydraulic-visual", acceptanceCriteria: ["isolation state recorded", "all accessible target areas reviewed"] },
      { modality: "handheld_sensor", objective: "Record approved pressure, temperature, or oil evidence", required: false, repeatabilityKey: "hms-hydraulic-sensor", acceptanceCriteria: ["instrument identity recorded", "approved procedure referenced"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
];
