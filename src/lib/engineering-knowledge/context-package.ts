import type { EngineeringContextPackage } from "./ontology";

const CODE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$/;
const BARE_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

export interface PhysicsResultRef {
  capabilityCode: string;
  resultRef: string;
  /** Caller-supplied. This package does not check that a stored result exists. */
  unverified: true;
}

export interface RetrievedKnowledgePassage {
  chunkId: string;
  title: string;
  documentClass: string;
  trustRank: number;
  isClientPrivate: boolean;
  content: string;
  sourceId?: string | null;
}

export interface ContextSourceCandidate {
  id: string;
  revision: string | null;
  authorityLevel: string;
  assetClass: string | null;
  reviewState: "draft" | "in_review" | "approved" | "rejected" | "superseded";
  superseded: boolean;
}

export interface ApprovedMappingRef {
  entityType: "component" | "failure_mode" | "physics_capability";
  canonicalId: string;
}

export interface GovernedEngineeringContext extends EngineeringContextPackage {
  retrieved: RetrievedKnowledgePassage[];
  physicsResults: PhysicsResultRef[];
  conflicts: {
    kind: "revision_conflict" | "authority_conflict";
    sourceIds: string[];
  }[];
  unverifiedChunkIds: string[];
  unverifiedEvidenceIds: string[];
  grantsWorkRelease: false;
  grantsApprovalAuthority: false;
  grantsApproval: false;
  decisionBoundary: string;
}

export interface GovernedContextParts {
  tenantId: string;
  assetTwinId?: string;
  assetClassCode?: string;
  componentCodes?: string[];
  failureModeCodes?: string[];
  physicsCapabilityCodes?: string[];
  retrieved?: RetrievedKnowledgePassage[];
  requestedChunkIds?: string[];
  visibleChunkIds?: string[];
  physicsResults?: unknown;
  evidenceIds?: string[];
  verifiedEvidenceIds?: string[];
  approvedMappings?: ApprovedMappingRef[];
  sources?: ContextSourceCandidate[];
}

const DECISION_BOUNDARY =
  "A context package assembles references the caller can already read. It does not approve knowledge, release work, calculate a physics result, or grant permission.";

export function physicsResultRefs(input: unknown): PhysicsResultRef[] {
  if (input == null) return [];
  if (!Array.isArray(input))
    throw new Error("Physics results must be an array of references");
  if (input.length > 20)
    throw new Error("Physics results are limited to 20 references");
  return input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(
        "Physics results may contain only a capability code and a result reference",
      );
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => key !== "capabilityCode" && key !== "resultRef",
      )
    ) {
      throw new Error(
        "Physics results may contain only a capability code and a result reference",
      );
    }
    const { capabilityCode, resultRef } = record;
    if (typeof capabilityCode !== "string" || typeof resultRef !== "string") {
      throw new Error(
        "Physics results may contain only a capability code and a result reference",
      );
    }
    if (
      !CODE.test(capabilityCode) ||
      !CODE.test(resultRef) ||
      BARE_NUMBER.test(resultRef)
    ) {
      throw new Error(
        "Physics results must reference a stored result, not carry a calculated value",
      );
    }
    return { capabilityCode, resultRef, unverified: true };
  });
}

function requireCodes(codes: string[] | undefined): string[] {
  return (codes ?? []).map((code) => {
    if (!CODE.test(code))
      throw new Error("Canonical code is not an identifier");
    return code;
  });
}

function missingCodes(
  entityType: ApprovedMappingRef["entityType"],
  codes: string[],
  mappings: ApprovedMappingRef[],
): string[] {
  return codes
    .filter(
      (code) =>
        !mappings.some(
          (mapping) =>
            mapping.entityType === entityType && mapping.canonicalId === code,
        ),
    )
    .map((code) => `${entityType}:${code}`);
}

/**
 * Assemble a context package from references that have already been checked.
 * Passages are not copied into a new corpus. Confidence is not invented.
 */
export function assembleGovernedEngineeringContext(
  parts: GovernedContextParts,
): GovernedEngineeringContext {
  const componentCodes = requireCodes(parts.componentCodes);
  const failureModeCodes = requireCodes(parts.failureModeCodes);
  const physicsCapabilityCodes = requireCodes(parts.physicsCapabilityCodes);
  const mappings = parts.approvedMappings ?? [];
  const visible = new Set(parts.visibleChunkIds ?? []);
  const requested = parts.requestedChunkIds ?? [];
  const retrieved = (parts.retrieved ?? []).filter((passage) =>
    visible.has(passage.chunkId),
  );
  const unverifiedChunkIds = requested.filter((id) => !visible.has(id));
  const verifiedEvidence = new Set(parts.verifiedEvidenceIds ?? []);
  const evidenceIds = (parts.evidenceIds ?? []).filter((id) =>
    verifiedEvidence.has(id),
  );
  const unverifiedEvidenceIds = (parts.evidenceIds ?? []).filter(
    (id) => !verifiedEvidence.has(id),
  );
  const sourceIds = [
    ...new Set(
      retrieved
        .map((passage) => passage.sourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const assetClass = parts.assetClassCode?.trim() ?? "";
  const candidates = (parts.sources ?? []).filter(
    (source) =>
      source.reviewState === "approved" &&
      !source.superseded &&
      ((assetClass !== "" && source.assetClass === assetClass) ||
        sourceIds.includes(source.id)),
  );
  const conflicts: GovernedEngineeringContext["conflicts"] = [];
  const revisions = new Set(
    candidates
      .map((source) => source.revision?.trim())
      .filter((revision): revision is string => Boolean(revision)),
  );
  const authorities = new Set(
    candidates.map((source) => source.authorityLevel),
  );
  const conflictIds = candidates.map((source) => source.id);
  if (candidates.length > 1 && revisions.size > 1) {
    conflicts.push({ kind: "revision_conflict", sourceIds: conflictIds });
  }
  if (candidates.length > 1 && authorities.size > 1) {
    conflicts.push({ kind: "authority_conflict", sourceIds: conflictIds });
  }

  return {
    tenantId: parts.tenantId,
    assetTwinId: parts.assetTwinId?.trim() ?? "",
    assetClassCode: assetClass,
    componentCodes,
    candidateFailureModeCodes: failureModeCodes,
    physicsCapabilityCodes,
    evidenceIds,
    sourceIds,
    sourceConflictIds: conflicts.length > 0 ? conflictIds : [],
    missingEvidence: [
      ...missingCodes("component", componentCodes, mappings),
      ...missingCodes("failure_mode", failureModeCodes, mappings),
      ...missingCodes("physics_capability", physicsCapabilityCodes, mappings),
    ],
    retrieved,
    physicsResults: physicsResultRefs(parts.physicsResults),
    conflicts,
    unverifiedChunkIds,
    unverifiedEvidenceIds,
    humanApprovalRequired: true,
    autonomousOperationalActionAllowed: false,
    grantsWorkRelease: false,
    grantsApprovalAuthority: false,
    grantsApproval: false,
    decisionBoundary: DECISION_BOUNDARY,
  };
}
