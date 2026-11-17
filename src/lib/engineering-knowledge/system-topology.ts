import type { SystemModelLevel, SystemReferenceModel } from "../asset-twins/system-model";
import {
  validateEngineeringRelationship,
  type EngineeringEntityType,
  type EngineeringRelationship,
  type EngineeringRelationshipType,
} from "./ontology";
import type { RelationshipEdgeInput } from "./relationship-backfill";

/**
 * Project a facility system reference model onto canonical graph edges for
 * public.backfill_engineering_relationships. Edges carry ids only; names,
 * statements and item lists stay in the versioned reference model. Every edge
 * is draft and its provenance is the reference model code. A knowledge steward
 * runs the backfill; nothing here writes on its own.
 *
 * Produces: containment down to maintainable items, functions and functional
 * failures, template bindings, design-intent topology (power, cooling, fuel,
 * water, protection, control, monitoring) and redundancy-group membership.
 */

const entityForLevel: Record<SystemModelLevel, EngineeringEntityType> = {
  system: "system",
  subsystem: "subsystem",
  equipment_unit: "equipment_unit",
  subunit: "component",
  maintainable_item: "component",
};

/** Backfill RPC accepts at most this many edges per call. */
export const SYSTEM_TOPOLOGY_BATCH_LIMIT = 200;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function systemModelCanonicalId(modelCode: string, localCode: string): string {
  return `${modelCode}:${localCode}`;
}

export function relationshipsFromSystemReferenceModel(model: SystemReferenceModel): RelationshipEdgeInput[] {
  const provenance = [model.code];
  const id = (local: string) => systemModelCanonicalId(model.code, local);
  const out = new Map<string, RelationshipEdgeInput>();

  const add = (
    relationshipType: EngineeringRelationshipType,
    fromType: EngineeringEntityType,
    fromId: string,
    toType: EngineeringEntityType,
    toId: string,
  ) => {
    const relationship: EngineeringRelationship = {
      code: `SRM:${model.code}:${relationshipType}:${fromType}:${fromId}:${toType}:${toId}`,
      relationshipType,
      from: { entityType: fromType, canonicalId: fromId },
      to: { entityType: toType, canonicalId: toId },
      provenanceSourceIds: provenance,
      reviewState: "draft",
      createdBy: "system",
    };
    const issues = validateEngineeringRelationship(relationship);
    if (issues.length > 0) {
      throw new Error(`Invalid system topology edge ${relationship.code}: ${issues.map((i) => i.message).join("; ")}`);
    }
    out.set(relationship.code, {
      relationshipCode: relationship.code,
      relationshipType,
      fromEntityType: fromType,
      fromCanonicalId: fromId,
      toEntityType: toType,
      toCanonicalId: toId,
      provenanceCanonicalIds: provenance,
      provenanceChunkIds: [],
    });
  };

  const nodeType = new Map(model.nodes.map((n) => [n.code, entityForLevel[n.level]]));

  for (const node of model.nodes) {
    const type = entityForLevel[node.level];
    if (node.parentCode) {
      add("contains", nodeType.get(node.parentCode)!, id(node.parentCode), type, id(node.code));
    }
    if (node.assetClassTemplateCode) {
      // Bound equipment inherits components and failure modes from the existing
      // asset-class template; edges to those already come from the twin backfill.
      add("modelled_by", type, id(node.code), "asset_class", node.assetClassTemplateCode);
    }
    for (const item of node.maintainableItems ?? []) {
      add("composed_of", type, id(node.code), "component", id(`${node.code}:${slug(item)}`));
    }
    for (const fn of node.functions) {
      add("performs", type, id(node.code), "function", id(fn.code));
      fn.functionalFailures.forEach((_, i) => {
        add("has_functional_failure", "function", id(fn.code), "functional_failure", id(`${fn.code}:FF${i + 1}`));
      });
    }
  }

  for (const edge of model.edges) {
    add(edge.relation, nodeType.get(edge.from)!, id(edge.from), nodeType.get(edge.to)!, id(edge.to));
  }

  for (const group of model.redundancyGroups) {
    add("member_of", nodeType.get(group.nodeCode)!, id(group.nodeCode), "redundancy_group", id(group.code));
    for (const fnCode of group.functionCodes) {
      add("provides_redundancy_for", "redundancy_group", id(group.code), "function", id(fnCode));
    }
  }

  return [...out.values()];
}

/** Split edges into backfill-sized batches. */
export function batchSystemTopologyEdges(
  edges: RelationshipEdgeInput[],
  size = SYSTEM_TOPOLOGY_BATCH_LIMIT,
): RelationshipEdgeInput[][] {
  if (size < 1 || size > SYSTEM_TOPOLOGY_BATCH_LIMIT) throw new Error("Batch size must be between 1 and 200");
  const batches: RelationshipEdgeInput[][] = [];
  for (let i = 0; i < edges.length; i += size) batches.push(edges.slice(i, i + size));
  return batches;
}
