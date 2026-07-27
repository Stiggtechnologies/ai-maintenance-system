import type {
  AssetClassTemplate,
  CustomerAssetTwinInstance,
  EvidenceReference,
  ReviewState,
} from "./types";
import type { InspectionZoneContract } from "./inspection-contracts";

export type EngineeringDnaCapability =
  | "canonical_hierarchy"
  | "failure_mechanisms"
  | "inspection_contracts"
  | "telemetry_concepts"
  | "digital_twin_instantiation"
  | "governed_recommendations";

export interface EngineeringDnaGovernance {
  reviewState: ReviewState;
  siteApprovalRequired: boolean;
  engineeringApprovalRequired: boolean;
  customerOverridesRequireApproval: boolean;
  autonomousOperationalActionAllowed: false;
  thresholdsPolicy: "approved_source_only";
}

export interface EngineeringDnaProfile {
  schemaVersion: string;
  code: string;
  name: string;
  description: string;
  assetClassCode: string;
  capabilities: EngineeringDnaCapability[];
  componentCodes: string[];
  failureModeCodes: string[];
  inspectionZoneCodes: string[];
  telemetryConcepts: string[];
  standards: string[];
  evidence: EvidenceReference[];
  governance: EngineeringDnaGovernance;
}

export interface EngineeringDnaValidationIssue {
  path: string;
  message: string;
}

export function validateEngineeringDnaProfile(
  profile: EngineeringDnaProfile,
  assetClass: AssetClassTemplate,
  inspectionZones: InspectionZoneContract[],
): EngineeringDnaValidationIssue[] {
  const issues: EngineeringDnaValidationIssue[] = [];
  const canonicalComponentCodes = new Set(assetClass.components.map((component) => component.code));
  const canonicalFailureModeCodes = new Set(
    assetClass.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
  );
  const canonicalTelemetryConcepts = new Set(
    assetClass.components.flatMap((component) => component.telemetryConcepts),
  );
  const canonicalInspectionZoneCodes = new Set(inspectionZones.map((zone) => zone.code));

  if (profile.assetClassCode !== assetClass.code) {
    issues.push({
      path: "assetClassCode",
      message: `DNA profile references ${profile.assetClassCode}, expected ${assetClass.code}.`,
    });
  }

  for (const [index, componentCode] of profile.componentCodes.entries()) {
    if (!canonicalComponentCodes.has(componentCode)) {
      issues.push({
        path: `componentCodes[${index}]`,
        message: `Unknown canonical component ${componentCode}.`,
      });
    }
  }

  for (const [index, failureModeCode] of profile.failureModeCodes.entries()) {
    if (!canonicalFailureModeCodes.has(failureModeCode)) {
      issues.push({
        path: `failureModeCodes[${index}]`,
        message: `Unknown canonical failure mode ${failureModeCode}.`,
      });
    }
  }

  for (const [index, inspectionZoneCode] of profile.inspectionZoneCodes.entries()) {
    if (!canonicalInspectionZoneCodes.has(inspectionZoneCode)) {
      issues.push({
        path: `inspectionZoneCodes[${index}]`,
        message: `Unknown inspection zone ${inspectionZoneCode}.`,
      });
    }
  }

  for (const [index, telemetryConcept] of profile.telemetryConcepts.entries()) {
    if (!canonicalTelemetryConcepts.has(telemetryConcept)) {
      issues.push({
        path: `telemetryConcepts[${index}]`,
        message: `Unknown canonical telemetry concept ${telemetryConcept}.`,
      });
    }
  }

  const duplicateSets: Array<[string, string[]]> = [
    ["componentCodes", profile.componentCodes],
    ["failureModeCodes", profile.failureModeCodes],
    ["inspectionZoneCodes", profile.inspectionZoneCodes],
    ["telemetryConcepts", profile.telemetryConcepts],
  ];

  for (const [path, values] of duplicateSets) {
    if (new Set(values).size !== values.length) {
      issues.push({ path, message: `${path} must not contain duplicate references.` });
    }
  }

  if (!profile.governance.siteApprovalRequired) {
    issues.push({ path: "governance.siteApprovalRequired", message: "Site approval must remain required." });
  }
  if (!profile.governance.engineeringApprovalRequired) {
    issues.push({
      path: "governance.engineeringApprovalRequired",
      message: "Engineering approval must remain required.",
    });
  }
  if (profile.governance.thresholdsPolicy !== "approved_source_only") {
    issues.push({
      path: "governance.thresholdsPolicy",
      message: "Engineering thresholds may only come from approved sources.",
    });
  }

  return issues;
}

export interface InstantiateEngineeringTwinInput {
  assetId: string;
  siteId: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  operatingContext?: Record<string, unknown>;
  telemetryMap?: Record<string, string>;
  customerOverrides?: Record<string, unknown>;
}

export function instantiateEngineeringTwin(
  profile: EngineeringDnaProfile,
  input: InstantiateEngineeringTwinInput,
): CustomerAssetTwinInstance {
  if (!input.assetId.trim()) throw new Error("assetId is required.");
  if (!input.siteId.trim()) throw new Error("siteId is required.");

  return {
    assetId: input.assetId,
    assetClassCode: profile.assetClassCode,
    manufacturer: input.manufacturer,
    model: input.model,
    serialNumber: input.serialNumber,
    siteId: input.siteId,
    operatingContext: input.operatingContext ?? {},
    telemetryMap: input.telemetryMap ?? {},
    customerOverrides: {
      engineeringDnaProfileCode: profile.code,
      engineeringDnaSchemaVersion: profile.schemaVersion,
      approvalRequired: profile.governance.customerOverridesRequireApproval,
      ...(input.customerOverrides ?? {}),
    },
    baselineStatus: "not_started",
  };
}
