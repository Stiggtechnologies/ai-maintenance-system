import {
  rankKnowledgeAuthority,
  validateKnowledgeDocumentMetadata,
  type EngineeringEntityRef,
  type EngineeringKnowledgeDocumentMetadata,
  type EngineeringRelationship,
  type OntologyValidationIssue,
} from "./ontology";

export type KnowledgeFactoryDecision = "publish" | "review" | "reject";

export interface CanonicalKnowledgeRegistry {
  assetClassCodes: string[];
  engineeringDnaCodes: string[];
  assetTwinIds: string[];
  componentCodes: string[];
  sharedComponentDnaCodes: string[];
  failureModeCodes: string[];
  physicsCapabilityCodes: string[];
}

export interface KnowledgeFactoryInput {
  metadata: EngineeringKnowledgeDocumentMetadata;
  registry: CanonicalKnowledgeRegistry;
  extractedTextLength: number;
  chunkCount: number;
  requestedBy: "human" | "agent" | "migration";
}

export interface KnowledgeFactoryGap {
  field: string;
  code?: string;
  message: string;
  severity: "blocking" | "review";
}

export interface KnowledgeFactoryPlan {
  sourceId: string;
  decision: KnowledgeFactoryDecision;
  authorityScore: number;
  canonicalEntities: EngineeringEntityRef[];
  relationships: EngineeringRelationship[];
  gaps: KnowledgeFactoryGap[];
  validationIssues: OntologyValidationIssue[];
  publicationRequirements: string[];
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function addEntity(
  entities: EngineeringEntityRef[],
  entityType: EngineeringEntityRef["entityType"],
  canonicalId: string | undefined,
  metadata: EngineeringKnowledgeDocumentMetadata,
): void {
  if (!canonicalId?.trim()) return;
  entities.push({
    entityType,
    canonicalId,
    tenantId: metadata.tenantId,
    siteId: metadata.siteId,
    assetClassCode: metadata.assetClassCode,
    assetTwinId: metadata.assetTwinId,
    componentCode:
      entityType === "component" || entityType === "shared_component"
        ? canonicalId
        : undefined,
  });
}

function checkCodes(
  field: string,
  codes: string[],
  knownCodes: string[],
  gaps: KnowledgeFactoryGap[],
): void {
  const known = new Set(knownCodes);
  for (const code of unique(codes)) {
    if (!known.has(code)) {
      gaps.push({
        field,
        code,
        message: `${code} is not present in the canonical registry.`,
        severity: "blocking",
      });
    }
  }
}

function relationshipCode(sourceId: string, relationshipType: string, targetId: string): string {
  return `KNOWLEDGE:${sourceId}:${relationshipType}:${targetId}`;
}

function sourceRef(metadata: EngineeringKnowledgeDocumentMetadata): EngineeringEntityRef {
  return {
    entityType: "document",
    canonicalId: metadata.sourceId,
    tenantId: metadata.tenantId,
    siteId: metadata.siteId,
    assetClassCode: metadata.assetClassCode,
    assetTwinId: metadata.assetTwinId,
  };
}

export function buildKnowledgeFactoryPlan(input: KnowledgeFactoryInput): KnowledgeFactoryPlan {
  const { metadata, registry } = input;
  const validationIssues = validateKnowledgeDocumentMetadata(metadata);
  const gaps: KnowledgeFactoryGap[] = [];
  const entities: EngineeringEntityRef[] = [];

  if (input.extractedTextLength <= 0) {
    gaps.push({ field: "content", message: "Extracted document text is required.", severity: "blocking" });
  }
  if (input.chunkCount <= 0) {
    gaps.push({ field: "chunkCount", message: "At least one retrievable chunk is required.", severity: "blocking" });
  }

  if (metadata.assetClassCode) checkCodes("assetClassCode", [metadata.assetClassCode], registry.assetClassCodes, gaps);
  if (metadata.engineeringDnaCode) checkCodes("engineeringDnaCode", [metadata.engineeringDnaCode], registry.engineeringDnaCodes, gaps);
  if (metadata.assetTwinId) checkCodes("assetTwinId", [metadata.assetTwinId], registry.assetTwinIds, gaps);
  checkCodes("componentCodes", metadata.componentCodes, registry.componentCodes, gaps);
  checkCodes("sharedComponentDnaCodes", metadata.sharedComponentDnaCodes, registry.sharedComponentDnaCodes, gaps);
  checkCodes("failureModeCodes", metadata.failureModeCodes, registry.failureModeCodes, gaps);
  checkCodes("physicsCapabilityCodes", metadata.physicsCapabilityCodes, registry.physicsCapabilityCodes, gaps);

  if (
    metadata.componentCodes.length === 0 &&
    metadata.failureModeCodes.length === 0 &&
    metadata.physicsCapabilityCodes.length === 0 &&
    !metadata.assetClassCode
  ) {
    gaps.push({
      field: "engineeringMapping",
      message: "The document has no canonical engineering applicability mapping.",
      severity: "review",
    });
  }

  addEntity(entities, "document", metadata.sourceId, metadata);
  addEntity(entities, "asset_class", metadata.assetClassCode, metadata);
  addEntity(entities, "asset_twin", metadata.assetTwinId, metadata);
  for (const code of metadata.componentCodes) addEntity(entities, "component", code, metadata);
  for (const code of metadata.sharedComponentDnaCodes) addEntity(entities, "shared_component", code, metadata);
  for (const code of metadata.failureModeCodes) addEntity(entities, "failure_mode", code, metadata);
  for (const code of metadata.physicsCapabilityCodes) addEntity(entities, "physics_capability", code, metadata);

  const from = sourceRef(metadata);
  const relationships: EngineeringRelationship[] = entities
    .filter((entity) => entity.entityType !== "document")
    .map((entity) => ({
      code: relationshipCode(metadata.sourceId, "applies_to", entity.canonicalId),
      relationshipType: "applies_to",
      from,
      to: entity,
      provenanceSourceIds: [metadata.sourceId],
      reviewState: metadata.reviewState,
      createdBy: input.requestedBy,
    }));

  const blocking = gaps.some((gap) => gap.severity === "blocking") || validationIssues.length > 0;
  const requiresReview =
    gaps.some((gap) => gap.severity === "review") ||
    metadata.reviewState !== "approved" ||
    rankKnowledgeAuthority(metadata.authorityLevel) < 65;

  const decision: KnowledgeFactoryDecision = blocking ? "reject" : requiresReview ? "review" : "publish";
  const publicationRequirements: string[] = [];
  if (metadata.reviewState !== "approved") publicationRequirements.push("approved_review_state");
  if (rankKnowledgeAuthority(metadata.authorityLevel) < 65) publicationRequirements.push("authoritative_source_or_explicit_approval");
  if (gaps.some((gap) => gap.field === "engineeringMapping")) publicationRequirements.push("canonical_engineering_mapping");
  if (!metadata.checksum) publicationRequirements.push("source_checksum");

  return {
    sourceId: metadata.sourceId,
    decision,
    authorityScore: rankKnowledgeAuthority(metadata.authorityLevel),
    canonicalEntities: entities,
    relationships,
    gaps,
    validationIssues,
    publicationRequirements: unique(publicationRequirements),
  };
}
