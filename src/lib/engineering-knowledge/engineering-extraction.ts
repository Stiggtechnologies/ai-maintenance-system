import type { CanonicalKnowledgeRegistry } from "./knowledge-base-factory";
import type {
  EngineeringEntityType,
  EngineeringKnowledgeDocumentMetadata,
} from "./ontology";

export type ExtractionDisposition = "accepted" | "ambiguous" | "unknown" | "rejected";

export interface EngineeringExtractionCandidate {
  entityType: Extract<
    EngineeringEntityType,
    "asset_class" | "component" | "shared_component" | "failure_mode" | "physics_capability" | "inspection_method" | "sensor" | "procedure" | "standard"
  >;
  mention: string;
  candidateCanonicalIds: string[];
  confidence: number;
  sourceChunkIds: string[];
  rationale?: string;
}

export interface EngineeringExtractionIssue {
  path: string;
  message: string;
  severity: "blocking" | "review";
}

export interface ResolvedEngineeringExtraction {
  entityType: EngineeringExtractionCandidate["entityType"];
  mention: string;
  canonicalId?: string;
  confidence: number;
  disposition: ExtractionDisposition;
  sourceChunkIds: string[];
  rationale?: string;
}

export interface EngineeringExtractionResult {
  sourceId: string;
  resolved: ResolvedEngineeringExtraction[];
  metadataPatch: Partial<EngineeringKnowledgeDocumentMetadata>;
  issues: EngineeringExtractionIssue[];
  humanReviewRequired: boolean;
}

export interface EngineeringExtractionPolicy {
  minimumAcceptedConfidence: number;
  minimumReviewConfidence: number;
  requireSourceChunks: boolean;
}

export const defaultEngineeringExtractionPolicy: EngineeringExtractionPolicy = {
  minimumAcceptedConfidence: 0.85,
  minimumReviewConfidence: 0.6,
  requireSourceChunks: true,
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function registryCodesFor(
  entityType: EngineeringExtractionCandidate["entityType"],
  registry: CanonicalKnowledgeRegistry,
): string[] | undefined {
  switch (entityType) {
    case "asset_class":
      return registry.assetClassCodes;
    case "component":
      return registry.componentCodes;
    case "shared_component":
      return registry.sharedComponentDnaCodes;
    case "failure_mode":
      return registry.failureModeCodes;
    case "physics_capability":
      return registry.physicsCapabilityCodes;
    default:
      return undefined;
  }
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveCandidate(
  candidate: EngineeringExtractionCandidate,
  registry: CanonicalKnowledgeRegistry,
  policy: EngineeringExtractionPolicy,
): ResolvedEngineeringExtraction {
  const confidence = normalizeConfidence(candidate.confidence);
  const proposed = unique(candidate.candidateCanonicalIds.filter((code) => code.trim().length > 0));
  const registryCodes = registryCodesFor(candidate.entityType, registry);
  const known = registryCodes ? proposed.filter((code) => registryCodes.includes(code)) : proposed;

  let disposition: ExtractionDisposition;
  let canonicalId: string | undefined;

  if (policy.requireSourceChunks && candidate.sourceChunkIds.length === 0) {
    disposition = "rejected";
  } else if (known.length === 0) {
    disposition = "unknown";
  } else if (known.length > 1) {
    disposition = "ambiguous";
  } else if (confidence >= policy.minimumAcceptedConfidence) {
    disposition = "accepted";
    [canonicalId] = known;
  } else if (confidence >= policy.minimumReviewConfidence) {
    disposition = "ambiguous";
    [canonicalId] = known;
  } else {
    disposition = "rejected";
    [canonicalId] = known;
  }

  return {
    entityType: candidate.entityType,
    mention: candidate.mention,
    canonicalId,
    confidence,
    disposition,
    sourceChunkIds: unique(candidate.sourceChunkIds),
    rationale: candidate.rationale,
  };
}

function metadataPatchFromResolved(
  resolved: ResolvedEngineeringExtraction[],
): Partial<EngineeringKnowledgeDocumentMetadata> {
  const accepted = resolved.filter((item) => item.disposition === "accepted" && item.canonicalId);
  const ids = (type: ResolvedEngineeringExtraction["entityType"]): string[] =>
    unique(
      accepted
        .filter((item) => item.entityType === type)
        .map((item) => item.canonicalId as string),
    );

  const assetClassCodes = ids("asset_class");
  return {
    assetClassCode: assetClassCodes.length === 1 ? assetClassCodes[0] : undefined,
    componentCodes: ids("component"),
    sharedComponentDnaCodes: ids("shared_component"),
    failureModeCodes: ids("failure_mode"),
    physicsCapabilityCodes: ids("physics_capability"),
  };
}

export function resolveEngineeringExtraction(
  sourceId: string,
  candidates: EngineeringExtractionCandidate[],
  registry: CanonicalKnowledgeRegistry,
  policy: EngineeringExtractionPolicy = defaultEngineeringExtractionPolicy,
): EngineeringExtractionResult {
  const issues: EngineeringExtractionIssue[] = [];

  if (!sourceId.trim()) {
    issues.push({ path: "sourceId", message: "Source ID is required.", severity: "blocking" });
  }
  if (policy.minimumAcceptedConfidence < policy.minimumReviewConfidence) {
    issues.push({
      path: "policy.minimumAcceptedConfidence",
      message: "Accepted confidence must be greater than or equal to review confidence.",
      severity: "blocking",
    });
  }

  const resolved = candidates.map((candidate, index) => {
    if (!candidate.mention.trim()) {
      issues.push({ path: `candidates[${index}].mention`, message: "Extracted mention is required.", severity: "blocking" });
    }
    const item = resolveCandidate(candidate, registry, policy);
    if (item.disposition === "unknown") {
      issues.push({
        path: `candidates[${index}].candidateCanonicalIds`,
        message: `No canonical mapping exists for ${candidate.mention}.`,
        severity: "review",
      });
    }
    if (item.disposition === "ambiguous") {
      issues.push({
        path: `candidates[${index}]`,
        message: `The mapping for ${candidate.mention} requires human disambiguation.`,
        severity: "review",
      });
    }
    if (item.disposition === "rejected") {
      issues.push({
        path: `candidates[${index}]`,
        message: `The extraction for ${candidate.mention || "unnamed mention"} did not meet evidence or confidence requirements.`,
        severity: "review",
      });
    }
    return item;
  });

  const acceptedAssetClasses = resolved.filter(
    (item) => item.entityType === "asset_class" && item.disposition === "accepted",
  );
  if (acceptedAssetClasses.length > 1) {
    issues.push({
      path: "metadataPatch.assetClassCode",
      message: "A document cannot be automatically assigned to multiple canonical asset classes.",
      severity: "review",
    });
  }

  return {
    sourceId,
    resolved,
    metadataPatch: metadataPatchFromResolved(resolved),
    issues,
    humanReviewRequired: issues.length > 0 || resolved.some((item) => item.disposition !== "accepted"),
  };
}
