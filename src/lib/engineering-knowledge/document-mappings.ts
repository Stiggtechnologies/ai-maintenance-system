import type { KnowledgeFactoryPlan } from "./knowledge-base-factory";
import type {
  EngineeringRelationshipType,
  KnowledgeReviewState,
} from "./ontology";

/** Entity targets a document mapping may name. Includes the pre-ontology rows. */
export const documentMappingEntityTypes = [
  "site",
  "asset_class",
  "asset",
  "asset_twin",
  "component",
  "shared_component",
  "failure_mode",
  "physics_capability",
  "inspection_method",
  "sensor",
  "evidence",
  "document",
  "procedure",
  "standard",
  "work_order",
  "root_cause_analysis",
  "recommendation",
  "risk",
  "verified_case",
  "maintenance_task",
  "other",
] as const;

export type DocumentMappingEntityType =
  (typeof documentMappingEntityTypes)[number];

export const documentMappingRelationships: readonly EngineeringRelationshipType[] =
  [
    "contains",
    "composed_of",
    "may_fail_by",
    "governed_by",
    "detected_by",
    "verified_by",
    "explained_by",
    "supported_by",
    "contradicted_by",
    "applies_to",
    "observed_on",
    "resulted_in",
    "resolved_by",
    "similar_to",
    "supersedes",
  ];

export interface DocumentEngineeringMapping {
  entityType: DocumentMappingEntityType;
  canonicalId: string;
  relationship: EngineeringRelationshipType;
  confidence?: number;
  reviewState: KnowledgeReviewState;
  provenanceChunkIds: string[];
}

export interface DocumentMappingIssue {
  path: string;
  message: string;
}

const allowed = new Set<string>(documentMappingEntityTypes);

export function validateDocumentEngineeringMapping(
  mapping: DocumentEngineeringMapping,
  path = "mapping",
): DocumentMappingIssue[] {
  const issues: DocumentMappingIssue[] = [];
  if (!allowed.has(mapping.entityType)) {
    issues.push({
      path: `${path}.entityType`,
      message: "Entity type is not a canonical engineering reference.",
    });
  }
  if (!mapping.canonicalId.trim()) {
    issues.push({
      path: `${path}.canonicalId`,
      message: "Canonical id is required.",
    });
  }
  if (!documentMappingRelationships.includes(mapping.relationship)) {
    issues.push({
      path: `${path}.relationship`,
      message: "Relationship is not in the engineering ontology.",
    });
  }
  if (
    mapping.provenanceChunkIds.length === 0 ||
    mapping.provenanceChunkIds.some((id) => !id.trim())
  ) {
    issues.push({
      path: `${path}.provenanceChunkIds`,
      message: "At least one provenance-bearing source chunk is required.",
    });
  }
  if (
    mapping.confidence !== undefined &&
    (!Number.isFinite(mapping.confidence) ||
      mapping.confidence < 0 ||
      mapping.confidence > 1)
  ) {
    issues.push({
      path: `${path}.confidence`,
      message: "Confidence must be between 0 and 1.",
    });
  }
  return issues;
}

/**
 * Turns a factory plan into mapping references. Chunk ids are the provenance;
 * the plan's entity objects are not copied.
 */
export function documentMappingsFromFactoryPlan(
  plan: KnowledgeFactoryPlan,
  provenanceChunkIds: string[],
): DocumentEngineeringMapping[] {
  return plan.relationships.flatMap((relationship) => {
    const entityType = relationship.to.entityType;
    if (!allowed.has(entityType)) return [];
    const mapping: DocumentEngineeringMapping = {
      entityType: entityType as DocumentMappingEntityType,
      canonicalId: relationship.to.canonicalId,
      relationship: relationship.relationshipType,
      reviewState: relationship.reviewState,
      provenanceChunkIds,
    };
    return validateDocumentEngineeringMapping(mapping).length === 0
      ? [mapping]
      : [];
  });
}
