import type { PhysicsCapabilityDefinition } from "./physics-capability";
import type { EvidenceReference, ReviewState } from "./types";

export type SharedComponentCategory =
  | "bearing"
  | "coupling"
  | "seal"
  | "lubrication_system"
  | "shaft"
  | "gear_stage"
  | "structural_joint";

export type ComponentDependencyRelationship =
  | "drives"
  | "driven_by"
  | "supports"
  | "supported_by"
  | "lubricates"
  | "lubricated_by"
  | "seals"
  | "sealed_by"
  | "transmits_load_to"
  | "receives_load_from"
  | "protects"
  | "protected_by";

export interface SharedComponentFailureReference {
  code: string;
  mechanismCode: string;
  description: string;
  detectionMethodCodes: string[];
  verificationMethodCodes: string[];
}

export interface SharedComponentDnaProfile {
  schemaVersion: string;
  code: string;
  name: string;
  category: SharedComponentCategory;
  description: string;
  functions: string[];
  telemetryConcepts: string[];
  physicsCapabilityCodes?: string[];
  failureReferences: SharedComponentFailureReference[];
  evidence: EvidenceReference[];
  governance: {
    reviewState: ReviewState;
    engineeringApprovalRequired: true;
    customerOverridesRequireApproval: true;
    autonomousOperationalActionAllowed: false;
    thresholdsPolicy: "approved_source_only";
  };
}

export interface ComponentDependencyEdge {
  fromComponentCode: string;
  toComponentCode: string;
  relationship: ComponentDependencyRelationship;
  rationale: string;
}

export interface SharedComponentValidationIssue {
  path: string;
  message: string;
}

export function validateSharedComponentDna(
  profiles: SharedComponentDnaProfile[],
  physicsCapabilities: PhysicsCapabilityDefinition[] = [],
): SharedComponentValidationIssue[] {
  const issues: SharedComponentValidationIssue[] = [];
  const profileCodes = new Set<string>();
  const physicsByCode = new Map(physicsCapabilities.map((capability) => [capability.code, capability]));

  for (const [profileIndex, profile] of profiles.entries()) {
    const path = `profiles[${profileIndex}]`;
    if (!profile.code.trim()) issues.push({ path: `${path}.code`, message: "Component DNA code is required." });
    if (profileCodes.has(profile.code)) issues.push({ path: `${path}.code`, message: `Duplicate component DNA code ${profile.code}.` });
    profileCodes.add(profile.code);
    if (profile.functions.length === 0) issues.push({ path: `${path}.functions`, message: "At least one function is required." });
    if (!profile.governance.engineeringApprovalRequired) issues.push({ path: `${path}.governance.engineeringApprovalRequired`, message: "Engineering approval must remain required." });
    if (profile.governance.autonomousOperationalActionAllowed !== false) issues.push({ path: `${path}.governance.autonomousOperationalActionAllowed`, message: "Autonomous operational action must remain prohibited." });
    if (profile.governance.thresholdsPolicy !== "approved_source_only") issues.push({ path: `${path}.governance.thresholdsPolicy`, message: "Thresholds must remain approved-source-only." });

    const physicsCodes = new Set<string>();
    for (const [physicsIndex, physicsCode] of (profile.physicsCapabilityCodes ?? []).entries()) {
      const physicsPath = `${path}.physicsCapabilityCodes[${physicsIndex}]`;
      if (physicsCodes.has(physicsCode)) {
        issues.push({ path: physicsPath, message: `Duplicate physics capability ${physicsCode}.` });
      }
      physicsCodes.add(physicsCode);
      const capability = physicsByCode.get(physicsCode);
      if (!capability) {
        issues.push({ path: physicsPath, message: `Unknown physics capability ${physicsCode}.` });
      } else if (!capability.applicableSharedComponentCategories.includes(profile.category)) {
        issues.push({
          path: physicsPath,
          message: `Physics capability ${physicsCode} is not applicable to shared component category ${profile.category}.`,
        });
      }
    }

    const failureCodes = new Set<string>();
    for (const [failureIndex, failure] of profile.failureReferences.entries()) {
      const failurePath = `${path}.failureReferences[${failureIndex}]`;
      if (failureCodes.has(failure.code)) issues.push({ path: `${failurePath}.code`, message: `Duplicate failure reference ${failure.code}.` });
      failureCodes.add(failure.code);
      if (failure.detectionMethodCodes.length === 0) issues.push({ path: `${failurePath}.detectionMethodCodes`, message: "At least one detection method is required." });
      if (failure.verificationMethodCodes.length === 0) issues.push({ path: `${failurePath}.verificationMethodCodes`, message: "At least one verification method is required." });
    }
  }

  return issues;
}

export function validateComponentDependencyGraph(
  profiles: SharedComponentDnaProfile[],
  edges: ComponentDependencyEdge[],
): SharedComponentValidationIssue[] {
  const issues: SharedComponentValidationIssue[] = [];
  const codes = new Set(profiles.map((profile) => profile.code));
  const identities = new Set<string>();

  for (const [index, edge] of edges.entries()) {
    const path = `edges[${index}]`;
    if (!codes.has(edge.fromComponentCode)) issues.push({ path: `${path}.fromComponentCode`, message: `Unknown component ${edge.fromComponentCode}.` });
    if (!codes.has(edge.toComponentCode)) issues.push({ path: `${path}.toComponentCode`, message: `Unknown component ${edge.toComponentCode}.` });
    if (edge.fromComponentCode === edge.toComponentCode) issues.push({ path, message: "A component dependency cannot point to itself." });
    const identity = `${edge.fromComponentCode}:${edge.relationship}:${edge.toComponentCode}`;
    if (identities.has(identity)) issues.push({ path, message: `Duplicate dependency ${identity}.` });
    identities.add(identity);
    if (!edge.rationale.trim()) issues.push({ path: `${path}.rationale`, message: "Dependency rationale is required." });
  }

  return issues;
}
