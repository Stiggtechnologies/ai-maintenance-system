import type { InspectionZoneContract } from "./inspection-contracts";
import { blastholeDrillTemplate } from "./blasthole-drill";

const safety = {
  isolationState: "site_defined" as const,
  siteApprovalRequired: true,
  exclusionZoneRequired: true,
  spotterRequired: true,
  weatherLimitsSource: "mission_specific_assessment" as const,
  prohibitedConditions: ["uncontrolled drilling movement", "unapproved mast movement", "personnel inside controlled area"],
};

const capture = (modality: "drone_rgb" | "drone_thermal" | "drone_lidar" | "human_visual" | "handheld_sensor", key: string, objective: string) => ({
  modality,
  objective,
  required: true,
  repeatabilityKey: key,
  acceptanceCriteria: ["target visible", "capture traceable to asset and zone", "quality sufficient for engineering review"],
});

export const blastholeDrillInspectionZones: InspectionZoneContract[] = [
  {
    schemaVersion: "0.1.0",
    code: "BHD-INSPECT-MAST",
    assetClassCode: blastholeDrillTemplate.code,
    componentCode: "BHD-MAST",
    name: "Mast structural inspection",
    purpose: "Collect repeatable evidence of mast condition, geometry and visible discontinuities.",
    targetAreas: ["mast chords", "welded joints", "pivot structure", "raising-cylinder attachments"],
    captures: [capture("drone_rgb", "bhd-mast-rgb", "Record visible structural condition"), capture("drone_lidar", "bhd-mast-geometry", "Compare mast geometry over time")],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "BHD-INSPECT-ROTARY",
    assetClassCode: blastholeDrillTemplate.code,
    componentCode: "BHD-ROTARY",
    name: "Rotary-head condition inspection",
    purpose: "Collect external thermal and visual evidence around the rotary drive.",
    targetAreas: ["rotary head", "gearcase", "drive motors", "bearing housings"],
    captures: [capture("drone_thermal", "bhd-rotary-thermal", "Identify repeatable external thermal patterns"), capture("human_visual", "bhd-rotary-visual", "Record leaks, looseness and external damage")],
    safety,
    evidence: [],
    reviewState: "draft",
  },
  {
    schemaVersion: "0.1.0",
    code: "BHD-INSPECT-FEED-AIR",
    assetClassCode: blastholeDrillTemplate.code,
    componentCode: "BHD-FEED",
    name: "Feed-path inspection",
    purpose: "Document feed carriage, guides, chains or cables and related routing condition.",
    targetAreas: ["feed carriage", "guides", "chains or cables", "sheaves", "hose routing"],
    captures: [capture("drone_rgb", "bhd-feed-rgb", "Record wear indicators and alignment cues"), capture("handheld_sensor", "bhd-feed-measurement", "Capture approved site measurements where access permits")],
    safety,
    evidence: [],
    reviewState: "draft",
  },
];
