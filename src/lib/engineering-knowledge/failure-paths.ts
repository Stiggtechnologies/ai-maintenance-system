import type { CompiledAssetTwin } from "../asset-twins/compiler";
import type { SharedComponentDnaProfile } from "../asset-twins/shared-component-dna";
import type { ComponentTemplate } from "../asset-twins/types";
import {
  validateEngineeringRelationship,
  type EngineeringEntityType,
  type EngineeringRelationship,
  type EngineeringRelationshipType,
  type KnowledgeReviewState,
} from "./ontology";

const PATH_RELATIONSHIPS = new Set<EngineeringRelationshipType>([
  "may_fail_by",
  "detected_by",
  "verified_by",
  "resulted_in",
  "composed_of",
  "contains",
  "supported_by",
]);

const WALKABLE_REVIEW = new Set<KnowledgeReviewState>([
  "draft",
  "in_review",
  "approved",
]);

const DECISION_BOUNDARY =
  "A path lists canonical links already stored for this organization. It does not establish that a failure will occur, release work, or grant permission.";

export interface FailurePathStep {
  relationshipType: EngineeringRelationshipType;
  relationshipCode: string;
  reviewState: KnowledgeReviewState;
  fromEntityType: EngineeringEntityType;
  fromCanonicalId: string;
  toEntityType: EngineeringEntityType;
  toCanonicalId: string;
}

export interface FailurePathQuery {
  rootCanonicalId: string;
  paths: { steps: FailurePathStep[] }[];
  truncated: boolean;
  grantsAuthority: false;
  grantsWorkRelease: false;
  grantsApproval: false;
  decisionBoundary: string;
}

interface WalkItem {
  steps: FailurePathStep[];
  visited: string[];
  entityType: EngineeringEntityType | null;
  canonicalId: string;
  depth: number;
}

/**
 * Walk stored canonical edges. Rejected and superseded edges are omitted.
 * There is no propagation probability: a link is not a prediction.
 */
export function queryFailureDetectionPaths(
  edges: readonly FailurePathStep[],
  rootCanonicalId: string,
  maxDepth = 4,
): FailurePathQuery {
  const root = rootCanonicalId.trim().slice(0, 500);
  if (!root) throw new Error("Root canonical id is required");
  if (maxDepth < 1 || maxDepth > 8)
    throw new Error("Path depth must be between 1 and 8");

  const queue: WalkItem[] = [
    { steps: [], visited: [], entityType: null, canonicalId: root, depth: 0 },
  ];
  const paths: { steps: FailurePathStep[] }[] = [];
  let truncated = false;
  let guard = 0;

  while (queue.length > 0 && guard < 400) {
    guard += 1;
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) {
      if (current.steps.length > 0) {
        paths.push({ steps: current.steps });
        if (paths.length >= 32) {
          truncated = true;
          break;
        }
      }
      continue;
    }

    const outgoing = edges
      .filter((edge) => {
        if (
          !WALKABLE_REVIEW.has(edge.reviewState) ||
          !PATH_RELATIONSHIPS.has(edge.relationshipType)
        )
          return false;
        if (edge.fromCanonicalId !== current.canonicalId) return false;
        if (current.entityType && edge.fromEntityType !== current.entityType)
          return false;
        return !current.visited.includes(
          `${edge.toEntityType}:${edge.toCanonicalId}`,
        );
      })
      .sort((left, right) =>
        left.relationshipCode.localeCompare(right.relationshipCode),
      );

    let expanded = 0;
    for (const edge of outgoing) {
      expanded += 1;
      if (expanded > 12) {
        truncated = true;
        break;
      }
      const fromKey = `${edge.fromEntityType}:${edge.fromCanonicalId}`;
      const toKey = `${edge.toEntityType}:${edge.toCanonicalId}`;
      queue.push({
        steps: [...current.steps, edge],
        visited: [...current.visited, fromKey, toKey],
        entityType: edge.toEntityType,
        canonicalId: edge.toCanonicalId,
        depth: current.depth + 1,
      });
    }

    if (expanded === 0 && current.steps.length > 0) {
      paths.push({ steps: current.steps });
      if (paths.length >= 32) {
        truncated = true;
        break;
      }
    }
  }
  if (guard >= 400) truncated = true;

  return {
    rootCanonicalId: root,
    paths,
    truncated,
    grantsAuthority: false,
    grantsWorkRelease: false,
    grantsApproval: false,
    decisionBoundary: DECISION_BOUNDARY,
  };
}

const project = (
  twinCode: string,
  provenance: string[],
  relationshipType: EngineeringRelationshipType,
  fromType: EngineeringEntityType,
  fromId: string,
  toType: EngineeringEntityType,
  toId: string,
): FailurePathStep | null => {
  if (!PATH_RELATIONSHIPS.has(relationshipType)) return null;
  const relationship: EngineeringRelationship = {
    code: `TWIN:${twinCode}:${relationshipType}:${fromType}:${fromId}:${toType}:${toId}`,
    relationshipType,
    from: { entityType: fromType, canonicalId: fromId },
    to: { entityType: toType, canonicalId: toId },
    provenanceSourceIds: provenance,
    reviewState: "draft",
    createdBy: "migration",
  };
  if (validateEngineeringRelationship(relationship).length > 0) return null;
  return {
    relationshipType,
    relationshipCode: relationship.code,
    reviewState: "draft",
    fromEntityType: fromType,
    fromCanonicalId: fromId,
    toEntityType: toType,
    toCanonicalId: toId,
  };
};

/**
 * In-memory projection of a compiled twin onto the path relationship types.
 * Profile prose is not copied. Persistence of these edges is a separate backfill.
 */
export function detectionEdgesFromCompiledTwin(
  twin: CompiledAssetTwin,
  lookupShared: (code: string) => SharedComponentDnaProfile | undefined = () =>
    undefined,
): FailurePathStep[] {
  const provenance = [
    ...new Set(
      [twin.template.code, twin.asset.assetId].filter((id) => id.trim()),
    ),
  ];
  const edges: FailurePathStep[] = [];
  const push = (item: FailurePathStep | null) => {
    if (
      item &&
      !edges.some(
        (existing) => existing.relationshipCode === item.relationshipCode,
      )
    )
      edges.push(item);
  };
  const components = new Map<string, ComponentTemplate>(
    twin.template.components.map((component) => [component.code, component]),
  );

  for (const component of twin.template.components) {
    push(
      project(
        twin.template.code,
        provenance,
        "contains",
        "asset_class",
        twin.template.code,
        "component",
        component.code,
      ),
    );
    push(
      project(
        twin.template.code,
        provenance,
        "contains",
        "asset_twin",
        twin.asset.assetId,
        "component",
        component.code,
      ),
    );
    if (component.parentCode && components.has(component.parentCode)) {
      push(
        project(
          twin.template.code,
          provenance,
          "composed_of",
          "component",
          component.parentCode,
          "component",
          component.code,
        ),
      );
    }
    for (const sharedCode of component.sharedComponentDnaCodes ?? []) {
      push(
        project(
          twin.template.code,
          provenance,
          "supported_by",
          "component",
          component.code,
          "shared_component",
          sharedCode,
        ),
      );
      const profile = lookupShared(sharedCode);
      if (!profile) continue;
      for (const failure of profile.failureReferences) {
        push(
          project(
            twin.template.code,
            provenance,
            "may_fail_by",
            "shared_component",
            sharedCode,
            "failure_mode",
            failure.code,
          ),
        );
        for (const method of failure.detectionMethodCodes) {
          push(
            project(
              twin.template.code,
              provenance,
              "detected_by",
              "failure_mode",
              failure.code,
              "inspection_method",
              method,
            ),
          );
        }
        for (const method of failure.verificationMethodCodes) {
          push(
            project(
              twin.template.code,
              provenance,
              "verified_by",
              "failure_mode",
              failure.code,
              "inspection_method",
              method,
            ),
          );
        }
      }
    }
    for (const failure of component.failureModes) {
      push(
        project(
          twin.template.code,
          provenance,
          "may_fail_by",
          "component",
          component.code,
          "failure_mode",
          failure.code,
        ),
      );
      for (const method of failure.detectableBy) {
        push(
          project(
            twin.template.code,
            provenance,
            "detected_by",
            "failure_mode",
            failure.code,
            "inspection_method",
            method,
          ),
        );
      }
      for (const method of failure.verificationMethods) {
        push(
          project(
            twin.template.code,
            provenance,
            "verified_by",
            "failure_mode",
            failure.code,
            "inspection_method",
            method,
          ),
        );
      }
      for (const effect of failure.effects) {
        if (!components.has(effect)) continue;
        push(
          project(
            twin.template.code,
            provenance,
            "resulted_in",
            "failure_mode",
            failure.code,
            "component",
            effect,
          ),
        );
      }
    }
  }

  return edges;
}
