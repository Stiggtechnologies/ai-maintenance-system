export type EngineeringEntityType =
  | "asset_class"
  | "asset_twin"
  | "component"
  | "shared_component"
  | "failure_mode"
  | "physics_capability"
  | "inspection_method"
  | "sensor"
  | "evidence"
  | "document"
  | "procedure"
  | "standard"
  | "work_order"
  | "root_cause_analysis"
  | "recommendation"
  | "risk"
  | "verified_case";

export type EngineeringRelationshipType =
  | "contains"
  | "composed_of"
  | "may_fail_by"
  | "governed_by"
  | "detected_by"
  | "verified_by"
  | "explained_by"
  | "supported_by"
  | "contradicted_by"
  | "applies_to"
  | "observed_on"
  | "resulted_in"
  | "resolved_by"
  | "similar_to"
  | "supersedes";

export type KnowledgeAuthorityLevel =
  | "customer_approved"
  | "oem_authorized"
  | "regulatory"
  | "engineering_standard"
  | "internal_approved"
  | "verified_operational_record"
  | "authoritative_public"
  | "draft_internal"
  | "general_public"
  | "ai_generated";

export type KnowledgeReviewState = "draft" | "in_review" | "approved" | "rejected" | "superseded";

/**
 * A graph node is a reference to an existing canonical entity. It must not copy
 * complete twin, component, failure, physics, document, or work-order objects.
 */
export interface EngineeringEntityRef {
  entityType: EngineeringEntityType;
  canonicalId: string;
  tenantId?: string;
  siteId?: string;
  assetClassCode?: string;
  assetTwinId?: string;
  componentCode?: string;
}

export interface EngineeringRelationship {
  code: string;
  relationshipType: EngineeringRelationshipType;
  from: EngineeringEntityRef;
  to: EngineeringEntityRef;
  provenanceSourceIds: string[];
  confidence?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  reviewState: KnowledgeReviewState;
  createdBy: "system" | "human" | "agent" | "migration";
}

export interface EngineeringKnowledgeDocumentMetadata {
  sourceId: string;
  title: string;
  documentType: string;
  tenantId?: string;
  siteId?: string;
  functionalLocationId?: string;
  assetClassCode?: string;
  engineeringDnaCode?: string;
  assetTwinId?: string;
  componentCodes: string[];
  sharedComponentDnaCodes: string[];
  failureModeCodes: string[];
  physicsCapabilityCodes: string[];
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  revision?: string;
  effectiveDate?: string;
  supersededDate?: string;
  authorityLevel: KnowledgeAuthorityLevel;
  reviewState: KnowledgeReviewState;
  confidentiality: "public" | "internal" | "customer_confidential" | "restricted";
  sourceUrl?: string;
  checksum?: string;
}

export interface EngineeringContextPackage {
  tenantId: string;
  assetTwinId: string;
  assetClassCode: string;
  // Resolve these from authorized canonical configuration, never page text.
  // An absent context field does not match a source restricted to that field.
  siteId?: string;
  functionalLocationId?: string;
  engineeringDnaCode?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  sharedComponentDnaCodes?: string[];
  operatingState?: string;
  componentCodes: string[];
  candidateFailureModeCodes: string[];
  physicsCapabilityCodes: string[];
  evidenceIds: string[];
  sourceIds: string[];
  sourceConflictIds: string[];
  missingEvidence: string[];
  confidence?: number;
  humanApprovalRequired: boolean;
  autonomousOperationalActionAllowed: false;
}

export interface OntologyValidationIssue {
  path: string;
  message: string;
}

const isBlank = (value: string | undefined): boolean => !value?.trim();

export function validateEntityRef(ref: EngineeringEntityRef, path = "entity"): OntologyValidationIssue[] {
  const issues: OntologyValidationIssue[] = [];
  if (isBlank(ref.canonicalId)) issues.push({ path: `${path}.canonicalId`, message: "Canonical entity ID is required." });
  if (ref.entityType === "asset_twin" && isBlank(ref.assetTwinId ?? ref.canonicalId)) {
    issues.push({ path: `${path}.assetTwinId`, message: "Asset twin references require an asset twin ID." });
  }
  if ((ref.entityType === "component" || ref.entityType === "shared_component") && isBlank(ref.componentCode ?? ref.canonicalId)) {
    issues.push({ path: `${path}.componentCode`, message: "Component references require a component code." });
  }
  return issues;
}

export function validateEngineeringRelationship(
  relationship: EngineeringRelationship,
): OntologyValidationIssue[] {
  const issues: OntologyValidationIssue[] = [];
  if (isBlank(relationship.code)) issues.push({ path: "code", message: "Relationship code is required." });
  issues.push(...validateEntityRef(relationship.from, "from"));
  issues.push(...validateEntityRef(relationship.to, "to"));
  if (
    relationship.from.entityType === relationship.to.entityType &&
    relationship.from.canonicalId === relationship.to.canonicalId
  ) {
    issues.push({ path: "to", message: "A relationship cannot point an entity to itself." });
  }
  if (relationship.provenanceSourceIds.length === 0) {
    issues.push({ path: "provenanceSourceIds", message: "At least one provenance source is required." });
  }
  if (relationship.confidence !== undefined && (relationship.confidence < 0 || relationship.confidence > 1)) {
    issues.push({ path: "confidence", message: "Confidence must be between 0 and 1." });
  }
  return issues;
}

export function validateKnowledgeDocumentMetadata(
  metadata: EngineeringKnowledgeDocumentMetadata,
): OntologyValidationIssue[] {
  const issues: OntologyValidationIssue[] = [];
  if (isBlank(metadata.sourceId)) issues.push({ path: "sourceId", message: "Source ID is required." });
  if (isBlank(metadata.title)) issues.push({ path: "title", message: "Document title is required." });
  if (metadata.reviewState === "approved" && metadata.authorityLevel === "ai_generated") {
    issues.push({ path: "authorityLevel", message: "AI-generated material cannot be approved as an authoritative source." });
  }
  if (metadata.reviewState === "superseded" && isBlank(metadata.supersededDate)) {
    issues.push({ path: "supersededDate", message: "Superseded documents require a superseded date." });
  }
  if (metadata.assetTwinId && isBlank(metadata.tenantId)) {
    issues.push({ path: "tenantId", message: "Asset-twin-specific documents require a tenant ID." });
  }
  return issues;
}

export function rankKnowledgeAuthority(level: KnowledgeAuthorityLevel): number {
  const ranking: Record<KnowledgeAuthorityLevel, number> = {
    customer_approved: 100,
    oem_authorized: 95,
    regulatory: 90,
    engineering_standard: 85,
    internal_approved: 80,
    verified_operational_record: 75,
    authoritative_public: 65,
    draft_internal: 40,
    general_public: 25,
    ai_generated: 5,
  };
  return ranking[level];
}

export type EngineeringApplicabilityContext = Pick<
  EngineeringContextPackage,
  | "tenantId" | "assetTwinId" | "assetClassCode" | "siteId"
  | "functionalLocationId" | "engineeringDnaCode" | "manufacturer"
  | "model" | "serialNumber" | "sharedComponentDnaCodes"
  | "componentCodes" | "candidateFailureModeCodes" | "physicsCapabilityCodes"
>;

/**
 * Applicability only, NOT authentication or authorization. The server must
 * resolve the context and pre-authorize every candidate (including derived
 * metadata and exclusion receipts). Missing source constraints mean general
 * applicability, not evidence of OEM/model-specific engineering authority.
 */
export function getKnowledgeApplicabilityIssues(
  metadata: EngineeringKnowledgeDocumentMetadata,
  context: EngineeringApplicabilityContext,
): string[] {
  const issues: string[] = [];
  for (const key of ["tenantId", "assetTwinId", "assetClassCode"] as const) {
    if (isBlank(context[key])) issues.push(`missing_context_${key}`);
  }
  if (metadata.reviewState === "rejected" || metadata.reviewState === "superseded") {
    issues.push(`source_${metadata.reviewState}`);
  }
  if (metadata.confidentiality !== "public" && isBlank(metadata.tenantId)) {
    issues.push("source_tenant_required");
  }

  for (const key of [
    "tenantId", "assetTwinId", "assetClassCode", "siteId",
    "functionalLocationId", "engineeringDnaCode", "manufacturer", "model", "serialNumber",
  ] as const) {
    const expected = metadata[key];
    if (expected === undefined) continue;
    if (typeof expected !== "string" || isBlank(expected)) {
      issues.push(`invalid_source_scope_${key}`);
    } else if (isBlank(context[key])) {
      issues.push(`missing_context_${key}`);
    } else if (expected !== context[key]) {
      // Do not guess aliases, case-fold serials, or normalize distinct IDs.
      issues.push(`scope_mismatch_${key}`);
    }
  }

  const listScopes: Array<[string, string[], string[] | undefined]> = [
    ["componentCodes", metadata.componentCodes, context.componentCodes],
    ["sharedComponentDnaCodes", metadata.sharedComponentDnaCodes, context.sharedComponentDnaCodes],
    ["failureModeCodes", metadata.failureModeCodes, context.candidateFailureModeCodes],
    ["physicsCapabilityCodes", metadata.physicsCapabilityCodes, context.physicsCapabilityCodes],
  ];
  for (const [key, expected, actual] of listScopes) {
    if (!Array.isArray(expected) || expected.some((code) => typeof code !== "string" || isBlank(code))) {
      issues.push(`invalid_source_scope_${key}`);
    } else if (expected.length > 0 && !expected.some((code) => actual?.includes(code))) {
      issues.push(`scope_mismatch_${key}`);
    }
  }
  return [...new Set(issues)];
}

export function isKnowledgeApplicable(
  metadata: EngineeringKnowledgeDocumentMetadata,
  context: EngineeringApplicabilityContext,
): boolean {
  return getKnowledgeApplicabilityIssues(metadata, context).length === 0;
}
