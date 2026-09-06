import type {
  ComponentTemplate,
  EvidenceReference,
  ReviewState,
} from "./types";

export type SharedComponentCategory =
  | "bearing"
  | "coupling"
  | "seal"
  | "lubrication_system"
  | "shaft"
  | "gear_stage"
  | "structural_joint"
  | "motor"
  | "gearbox"
  | "brake"
  | "rope"
  | "sheave"
  | "pump"
  | "hydraulic_cylinder"
  | "cooling_system"
  | "switchgear"
  | "vfd"
  | "transformer";

export const requiredSharedComponentCategories: readonly SharedComponentCategory[] =
  [
    "bearing",
    "motor",
    "gearbox",
    "brake",
    "rope",
    "sheave",
    "pump",
    "hydraulic_cylinder",
    "cooling_system",
    "lubrication_system",
    "switchgear",
    "vfd",
    "transformer",
  ];

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
  /** Optional pointer to a core engineering-standard mechanism (FM-*). */
  mechanismStandardCode?: string;
}

/**
 * Manufacturer-neutral shared component intelligence.
 *
 * Asset templates and Engineering DNA bind to these profiles by code. The
 * profile is the single source of truth; consumers must look it up rather than
 * copy functions, mechanisms, or strategies into an asset hierarchy.
 */
export interface SharedComponentDnaProfile {
  schemaVersion: string;
  code: string;
  name: string;
  category: SharedComponentCategory;
  description: string;
  functions: string[];
  telemetryConcepts: string[];
  detectableIndicators: string[];
  maintenanceStrategyCodes: string[];
  /** Reserved for the physics-capability workstream (open PR #104). */
  physicsCapabilityCodes?: string[];
  failureReferences: SharedComponentFailureReference[];
  evidence: EvidenceReference[];
  governance: {
    reviewState: ReviewState;
    engineeringApprovalRequired: true;
    customerOverridesRequireApproval: true;
    autonomousOperationalActionAllowed: false;
    thresholdsPolicy: "approved_source_only";
    recommendDoesNotAuthorize: true;
  };
}

export interface ComponentDependencyEdge {
  fromComponentCode: string;
  toComponentCode: string;
  relationship: ComponentDependencyRelationship;
  rationale: string;
}

export interface SharedIntelligenceReference {
  assetComponentCode: string;
  sharedComponentDnaCode: string;
  reviewState: ReviewState;
}

export interface InheritedSharedIntelligence {
  sharedComponentDnaCode: string;
  functions: string[];
  telemetryConcepts: string[];
  detectableIndicators: string[];
  failureReferenceCodes: string[];
  maintenanceStrategyCodes: string[];
  reviewState: ReviewState;
}

export interface SharedComponentValidationIssue {
  path: string;
  message: string;
}

const knownMaintenanceStrategyCodes = new Set([
  "MS-CONDITION-BASED",
  "MS-PROTECTIVE-TASK",
]);

export function validateSharedComponentDna(
  profiles: SharedComponentDnaProfile[],
): SharedComponentValidationIssue[] {
  const issues: SharedComponentValidationIssue[] = [];
  const profileCodes = new Set<string>();
  const failureCodes = new Set<string>();

  for (const [profileIndex, profile] of profiles.entries()) {
    const path = `profiles[${profileIndex}]`;
    if (!profile.code.trim())
      issues.push({
        path: `${path}.code`,
        message: "Component DNA code is required.",
      });
    if (profileCodes.has(profile.code))
      issues.push({
        path: `${path}.code`,
        message: `Duplicate component DNA code ${profile.code}.`,
      });
    profileCodes.add(profile.code);
    if (profile.functions.length === 0)
      issues.push({
        path: `${path}.functions`,
        message: "At least one function is required.",
      });
    if (profile.detectableIndicators.length === 0) {
      issues.push({
        path: `${path}.detectableIndicators`,
        message: "At least one detectable indicator is required.",
      });
    }
    if (profile.maintenanceStrategyCodes.length === 0) {
      issues.push({
        path: `${path}.maintenanceStrategyCodes`,
        message: "At least one maintenance strategy reference is required.",
      });
    }
    if (!profile.governance.engineeringApprovalRequired)
      issues.push({
        path: `${path}.governance.engineeringApprovalRequired`,
        message: "Engineering approval must remain required.",
      });
    if (profile.governance.autonomousOperationalActionAllowed !== false)
      issues.push({
        path: `${path}.governance.autonomousOperationalActionAllowed`,
        message: "Autonomous operational action must remain prohibited.",
      });
    if (profile.governance.thresholdsPolicy !== "approved_source_only")
      issues.push({
        path: `${path}.governance.thresholdsPolicy`,
        message: "Thresholds must remain approved-source-only.",
      });
    if (profile.governance.recommendDoesNotAuthorize !== true) {
      issues.push({
        path: `${path}.governance.recommendDoesNotAuthorize`,
        message:
          "Shared intelligence may recommend a strategy; it must not authorize work.",
      });
    }
    if (
      profile.governance.reviewState === "approved" &&
      profile.evidence.length === 0
    ) {
      issues.push({
        path: `${path}.evidence`,
        message: "Approved shared component DNA requires supporting evidence.",
      });
    }

    const strategyCodes = new Set<string>();
    for (const [
      strategyIndex,
      strategyCode,
    ] of profile.maintenanceStrategyCodes.entries()) {
      const strategyPath = `${path}.maintenanceStrategyCodes[${strategyIndex}]`;
      if (strategyCodes.has(strategyCode)) {
        issues.push({
          path: strategyPath,
          message: `Duplicate maintenance strategy ${strategyCode}.`,
        });
      }
      strategyCodes.add(strategyCode);
      if (!knownMaintenanceStrategyCodes.has(strategyCode)) {
        issues.push({
          path: strategyPath,
          message: `Unknown maintenance strategy ${strategyCode}.`,
        });
      }
    }

    const physicsCodes = new Set<string>();
    for (const [physicsIndex, physicsCode] of (
      profile.physicsCapabilityCodes ?? []
    ).entries()) {
      const physicsPath = `${path}.physicsCapabilityCodes[${physicsIndex}]`;
      if (physicsCodes.has(physicsCode)) {
        issues.push({
          path: physicsPath,
          message: `Duplicate physics capability ${physicsCode}.`,
        });
      }
      physicsCodes.add(physicsCode);
    }

    const profileFailureCodes = new Set<string>();
    for (const [failureIndex, failure] of profile.failureReferences.entries()) {
      const failurePath = `${path}.failureReferences[${failureIndex}]`;
      if (profileFailureCodes.has(failure.code))
        issues.push({
          path: `${failurePath}.code`,
          message: `Duplicate failure reference ${failure.code}.`,
        });
      profileFailureCodes.add(failure.code);
      if (failureCodes.has(failure.code)) {
        issues.push({
          path: `${failurePath}.code`,
          message: `Shared failure identity ${failure.code} is already claimed.`,
        });
      }
      failureCodes.add(failure.code);
      if (failure.detectionMethodCodes.length === 0)
        issues.push({
          path: `${failurePath}.detectionMethodCodes`,
          message: "At least one detection method is required.",
        });
      if (failure.verificationMethodCodes.length === 0)
        issues.push({
          path: `${failurePath}.verificationMethodCodes`,
          message: "At least one verification method is required.",
        });
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
    if (!codes.has(edge.fromComponentCode))
      issues.push({
        path: `${path}.fromComponentCode`,
        message: `Unknown component ${edge.fromComponentCode}.`,
      });
    if (!codes.has(edge.toComponentCode))
      issues.push({
        path: `${path}.toComponentCode`,
        message: `Unknown component ${edge.toComponentCode}.`,
      });
    if (edge.fromComponentCode === edge.toComponentCode)
      issues.push({
        path,
        message: "A component dependency cannot point to itself.",
      });
    const identity = `${edge.fromComponentCode}:${edge.relationship}:${edge.toComponentCode}`;
    if (identities.has(identity))
      issues.push({ path, message: `Duplicate dependency ${identity}.` });
    identities.add(identity);
    if (!edge.rationale.trim())
      issues.push({
        path: `${path}.rationale`,
        message: "Dependency rationale is required.",
      });
  }

  return issues;
}

export function collectSharedComponentReferences(
  components: Array<
    Pick<ComponentTemplate, "code" | "sharedComponentDnaCodes">
  >,
  library: SharedComponentDnaProfile[],
): {
  references: SharedIntelligenceReference[];
  issues: SharedComponentValidationIssue[];
} {
  const issues: SharedComponentValidationIssue[] = [];
  const references: SharedIntelligenceReference[] = [];
  const libraryByCode = new Map(
    library.map((profile) => [profile.code, profile]),
  );
  const identities = new Set<string>();

  for (const [componentIndex, component] of components.entries()) {
    const seen = new Set<string>();
    for (const [refIndex, code] of (
      component.sharedComponentDnaCodes ?? []
    ).entries()) {
      const path = `components[${componentIndex}].sharedComponentDnaCodes[${refIndex}]`;
      if (seen.has(code)) {
        issues.push({
          path,
          message: `Duplicate shared component reference ${code}.`,
        });
      }
      seen.add(code);
      const profile = libraryByCode.get(code);
      if (!profile) {
        issues.push({ path, message: `Unknown shared component DNA ${code}.` });
        continue;
      }
      const identity = `${component.code}:${code}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
      references.push({
        assetComponentCode: component.code,
        sharedComponentDnaCode: code,
        reviewState: profile.governance.reviewState,
      });
    }
  }

  return { references, issues };
}

export function inheritSharedIntelligence(
  sharedComponentDnaCode: string,
  library: SharedComponentDnaProfile[],
): InheritedSharedIntelligence | undefined {
  const profile = library.find(
    (candidate) => candidate.code === sharedComponentDnaCode,
  );
  if (!profile) return undefined;
  return {
    sharedComponentDnaCode: profile.code,
    functions: profile.functions,
    telemetryConcepts: profile.telemetryConcepts,
    detectableIndicators: profile.detectableIndicators,
    failureReferenceCodes: profile.failureReferences.map(
      (failure) => failure.code,
    ),
    maintenanceStrategyCodes: profile.maintenanceStrategyCodes,
    reviewState: profile.governance.reviewState,
  };
}

export function mergeDnaBindingsIntoReferences(
  references: SharedIntelligenceReference[],
  bindings: Array<{
    assetComponentCode: string;
    sharedComponentDnaCode: string;
  }>,
  library: SharedComponentDnaProfile[],
): SharedIntelligenceReference[] {
  const libraryByCode = new Map(
    library.map((profile) => [profile.code, profile]),
  );
  const merged = [...references];
  const identities = new Set(
    references.map(
      (reference) =>
        `${reference.assetComponentCode}:${reference.sharedComponentDnaCode}`,
    ),
  );

  for (const binding of bindings) {
    const identity = `${binding.assetComponentCode}:${binding.sharedComponentDnaCode}`;
    if (identities.has(identity)) continue;
    const profile = libraryByCode.get(binding.sharedComponentDnaCode);
    if (!profile) continue;
    identities.add(identity);
    merged.push({
      assetComponentCode: binding.assetComponentCode,
      sharedComponentDnaCode: binding.sharedComponentDnaCode,
      reviewState: profile.governance.reviewState,
    });
  }

  return merged;
}
