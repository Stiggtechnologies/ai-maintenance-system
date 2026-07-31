import type { InspectionZoneContract } from "./inspection-contracts";
import { conveyorSystemTemplate } from "./conveyor-system";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: ["personnel inside uncontrolled inspection area", "flight without approved mission assessment", "capture requiring entry into an operating transfer point"],
};

export const conveyorSystemInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "CV-INSP-BELT-SPLICE",
    assetClassCode: conveyorSystemTemplate.code,
    componentCode: "CV-BELT",
    name: "Belt and splice condition",
    purpose: "Collect repeatable evidence of belt cover, edge, repair and splice condition.",
    targetAreas: ["carry cover", "return cover", "belt edges", "splices", "repair patches"],
    captures: [
      { modality: "fixed_camera", objective: "Record repeatable belt and splice imagery during approved operation.", required: true, repeatabilityKey: "cv-belt-splice-fixed-rgb", acceptanceCriteria: ["belt segment or splice identity visible", "image sharp enough to resolve edge and surface damage", "operating state recorded"] },
      { modality: "human_visual", objective: "Confirm suspected defects under approved isolation.", required: true, repeatabilityKey: "cv-belt-splice-isolated-visual", acceptanceCriteria: ["isolation state documented", "defect location referenced to belt or splice identity", "scale included where practicable"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "CV-INSP-PULLEY-IDLER-THERMAL",
    assetClassCode: conveyorSystemTemplate.code,
    componentCode: "CV-PULLEY",
    name: "Pulley and idler thermal route",
    purpose: "Identify comparative thermal anomalies at pulley bearings and accessible idler groups.",
    targetAreas: ["head pulley bearings", "tail pulley bearings", "bend pulley bearings", "carry idlers", "return idlers"],
    captures: [
      { modality: "drone_thermal", objective: "Capture repeatable thermal views without entering guarded areas.", required: true, repeatabilityKey: "cv-rotating-elements-thermal", acceptanceCriteria: ["emissivity and environmental assumptions recorded", "comparable load state recorded", "target and peer reference visible"] },
      { modality: "drone_rgb", objective: "Provide visual context for each thermal target.", required: true, repeatabilityKey: "cv-rotating-elements-rgb", acceptanceCriteria: ["component identity visible", "guarding and surrounding conditions visible", "image registered to thermal capture"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "CV-INSP-TRANSFER-TAKEUP",
    assetClassCode: conveyorSystemTemplate.code,
    componentCode: "CV-TRANSFER",
    name: "Transfer and take-up exterior condition",
    purpose: "Collect evidence of spillage, chute damage, take-up travel and external containment condition.",
    targetAreas: ["chute exterior", "skirts", "spillage zones", "take-up carriage", "counterweight or cylinder exterior"],
    captures: [
      { modality: "drone_rgb", objective: "Capture exterior condition and geometric context.", required: true, repeatabilityKey: "cv-transfer-takeup-rgb", acceptanceCriteria: ["target area fully visible", "position reference visible", "spillage and damage boundaries distinguishable"] },
      { modality: "drone_lidar", objective: "Support repeatable geometry and accumulation comparison where approved.", required: false, repeatabilityKey: "cv-transfer-takeup-lidar", acceptanceCriteria: ["coordinate reference retained", "occlusion documented", "dataset quality sufficient for comparison"] },
    ],
    safety,
    evidence: [],
    reviewState: "draft",
  },
];
