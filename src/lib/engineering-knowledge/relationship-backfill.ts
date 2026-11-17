import type { CompiledAssetTwin } from "../asset-twins/compiler";
import type { SharedComponentDnaProfile } from "../asset-twins/shared-component-dna";
import type { ComponentTemplate } from "../asset-twins/types";
import {
  validateEngineeringRelationship,
  type EngineeringEntityType,
  type EngineeringRelationship,
  type EngineeringRelationshipType,
} from "./ontology";

export interface RelationshipEdgeInput {
  relationshipCode: string;
  relationshipType: EngineeringRelationshipType;
  fromEntityType: EngineeringEntityType;
  fromCanonicalId: string;
  toEntityType: EngineeringEntityType;
  toCanonicalId: string;
  provenanceCanonicalIds: string[];
  provenanceChunkIds: string[];
}

const edge = (
  twinCode: string,
  provenance: string[],
  relationshipType: EngineeringRelationshipType,
  fromType: EngineeringEntityType,
  fromId: string,
  toType: EngineeringEntityType,
  toId: string,
): RelationshipEdgeInput | null => {
  if (!fromId.trim() || !toId.trim()) return null;
  if (fromType === toType && fromId === toId) return null;
  const relationship: EngineeringRelationship = {
    code: `TWIN:${twinCode}:${relationshipType}:${fromType}:${fromId}:${toType}:${toId}`,
    relationshipType,
    from: { entityType: fromType, canonicalId: fromId },
    to: { entityType: toType, canonicalId: toId },
    provenanceSourceIds: provenance,
    reviewState: "draft",
    createdBy: "system",
  };
  if (validateEngineeringRelationship(relationship).length > 0) return null;
  return {
    relationshipCode: relationship.code,
    relationshipType,
    fromEntityType: fromType,
    fromCanonicalId: fromId,
    toEntityType: toType,
    toCanonicalId: toId,
    provenanceCanonicalIds: provenance,
    provenanceChunkIds: [],
  };
};

/**
 * Canonical edges from a compiled twin and, when supplied, the shared DNA
 * profiles it already references. Review state stays draft. Profile text is
 * not copied onto the edge.
 */
export function relationshipsFromCompiledTwin(
  twin: CompiledAssetTwin,
  lookupShared: (code: string) => SharedComponentDnaProfile | undefined = () =>
    undefined,
): RelationshipEdgeInput[] {
  const provenance = [
    ...new Set(
      [twin.template.code, twin.asset.assetId].filter((id) => id.trim()),
    ),
  ];
  const edges: RelationshipEdgeInput[] = [];
  const push = (item: RelationshipEdgeInput | null) => {
    if (
      item &&
      !edges.some(
        (existing) => existing.relationshipCode === item.relationshipCode,
      )
    ) {
      edges.push(item);
    }
  };
  const components = new Map<string, ComponentTemplate>(
    twin.template.components.map((component) => [component.code, component]),
  );

  for (const component of twin.template.components) {
    push(
      edge(
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
      edge(
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
        edge(
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
        edge(
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
          edge(
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
            edge(
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
            edge(
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
        edge(
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
          edge(
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
          edge(
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
          edge(
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
