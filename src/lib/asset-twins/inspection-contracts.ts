import type { EvidenceReference, ReviewState } from "./types";

export type InspectionModality =
  | "human_visual"
  | "drone_rgb"
  | "drone_thermal"
  | "drone_lidar"
  | "fixed_camera"
  | "handheld_sensor";

export type AssetIsolationState =
  | "operating_observation_only"
  | "parked"
  | "deenergized"
  | "site_defined";

export interface InspectionCaptureRequirement {
  modality: InspectionModality;
  objective: string;
  required: boolean;
  repeatabilityKey: string;
  acceptanceCriteria: string[];
}

export interface InspectionSafetyConstraint {
  isolationState: AssetIsolationState;
  siteApprovalRequired: boolean;
  exclusionZoneRequired: boolean;
  spotterRequired: boolean;
  weatherLimitsSource: "site_procedure" | "aircraft_manual" | "mission_specific_assessment";
  prohibitedConditions: string[];
}

export interface InspectionZoneContract {
  schemaVersion: string;
  code: string;
  assetClassCode: string;
  model?: string;
  componentCode: string;
  name: string;
  purpose: string;
  targetAreas: string[];
  captures: InspectionCaptureRequirement[];
  safety: InspectionSafetyConstraint;
  evidence: EvidenceReference[];
  reviewState: ReviewState;
}

export interface InspectionContractValidationIssue {
  path: string;
  message: string;
}

export function validateInspectionZoneContract(
  contract: InspectionZoneContract,
  canonicalComponentCodes: ReadonlySet<string>,
): InspectionContractValidationIssue[] {
  const issues: InspectionContractValidationIssue[] = [];

  if (!contract.code.trim()) issues.push({ path: "code", message: "Inspection-zone code is required." });
  if (!canonicalComponentCodes.has(contract.componentCode)) {
    issues.push({ path: "componentCode", message: `Unknown canonical component ${contract.componentCode}.` });
  }
  if (contract.targetAreas.length === 0) {
    issues.push({ path: "targetAreas", message: "At least one target area is required." });
  }
  if (contract.captures.length === 0) {
    issues.push({ path: "captures", message: "At least one capture requirement is required." });
  }

  const repeatabilityKeys = new Set<string>();
  for (const [index, capture] of contract.captures.entries()) {
    if (!capture.repeatabilityKey.trim()) {
      issues.push({
        path: `captures[${index}].repeatabilityKey`,
        message: "A repeatability key is required for comparable inspections.",
      });
    }
    if (repeatabilityKeys.has(capture.repeatabilityKey)) {
      issues.push({
        path: `captures[${index}].repeatabilityKey`,
        message: `Duplicate repeatability key ${capture.repeatabilityKey}.`,
      });
    }
    repeatabilityKeys.add(capture.repeatabilityKey);
    if (capture.acceptanceCriteria.length === 0) {
      issues.push({
        path: `captures[${index}].acceptanceCriteria`,
        message: "Capture acceptance criteria are required.",
      });
    }
  }

  if (!contract.safety.siteApprovalRequired) {
    issues.push({
      path: "safety.siteApprovalRequired",
      message: "Industrial drone inspection contracts must require site approval.",
    });
  }

  return issues;
}
