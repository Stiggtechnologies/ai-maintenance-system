/**
 * System reference models: the functional and physical breakdown of a whole
 * facility (systems, subsystems, equipment units, subunits, maintainable
 * items), the functions each level performs, the topology that connects them
 * (power, cooling, backup, control, monitoring) and the redundancy groups a
 * site must declare.
 *
 * This is the layer above AssetClassTemplate. Equipment units point at an
 * existing asset-class template where one exists; they never copy it. Levels
 * map onto the existing persistence rather than a parallel model:
 *
 *   level              ISO 14224 taxonomy   asset_locations.location_kind
 *   system             5 (section/system)   system
 *   subsystem          5 (section/system)   functional_location
 *   equipment_unit     6                    (asset row, not a location)
 *   subunit            7                    (twin component)
 *   maintainable_item  8                    (twin component, leaf)
 *
 * Governance: every model is draft. Performance standards and redundancy
 * schemes are site_specified; the reference model never states a number,
 * capacity or tier rating. A site declares its scheme (N, N+1, 2N, ...) and a
 * named person approves it before any single-point-of-failure finding is used.
 */

import type { ReviewState } from "./types";

export type SystemModelLevel =
  | "system"
  | "subsystem"
  | "equipment_unit"
  | "subunit"
  | "maintainable_item";

const levelRank: Record<SystemModelLevel, number> = {
  system: 0,
  subsystem: 1,
  equipment_unit: 2,
  subunit: 3,
  maintainable_item: 4,
};

export const isoTaxonomyLevel: Record<SystemModelLevel, number> = {
  system: 5,
  subsystem: 5,
  equipment_unit: 6,
  subunit: 7,
  maintainable_item: 8,
};

export const assetLocationKindForLevel: Partial<Record<SystemModelLevel, "system" | "functional_location">> = {
  system: "system",
  subsystem: "functional_location",
};

export interface SystemFunction {
  /** Stable code, unique within the model. */
  code: string;
  /** Verb + object, e.g. "supply conditioned power to the critical load". */
  statement: string;
  /** Loss of this function interrupts or endangers the facility's critical service. */
  critical: boolean;
  /** Ways the function can be lost or degraded (RCM functional failures). */
  functionalFailures: string[];
  /** Always site_specified in a reference model: no numeric standard without an approved source. */
  performanceStandard: "site_specified";
}

export type EquipmentClassStatus = "template_available" | "template_planned";

export interface SystemNode {
  code: string;
  name: string;
  level: SystemModelLevel;
  parentCode?: string;
  /** Asset-class template that models this equipment unit, when one exists. */
  assetClassTemplateCode?: string;
  equipmentClassStatus?: EquipmentClassStatus;
  /** For equipment units without a template yet: the maintainable items to be modelled. */
  maintainableItems?: string[];
  functions: SystemFunction[];
}

export type TopologyRelation =
  | "supplies_power_to"
  | "cools"
  | "rejects_heat_to"
  | "backs_up"
  | "depends_on"
  | "protects"
  | "controls"
  | "monitors"
  | "supplies_fuel_to"
  | "supplies_water_to"
  | "houses";

export interface TopologyEdge {
  from: string;
  relation: TopologyRelation;
  to: string;
}

export type RedundancyScheme =
  | "N"
  | "N+1"
  | "N+2"
  | "2N"
  | "2(N+1)"
  | "distributed_redundant"
  | "block_redundant";

export interface RedundancyGroupSlot {
  code: string;
  name: string;
  /** Node whose members share the duty; the site declares how many and how they are arranged. */
  nodeCode: string;
  /** Critical functions this group protects. */
  functionCodes: string[];
  scheme: "site_specified";
  allowedSchemes: RedundancyScheme[];
}

export interface SystemReferenceModel {
  schemaVersion: string;
  code: string;
  name: string;
  industryPack: string;
  description: string;
  sources: string[];
  reviewState: ReviewState;
  nodes: SystemNode[];
  edges: TopologyEdge[];
  redundancyGroups: RedundancyGroupSlot[];
  governance: {
    thresholdsPolicy: "approved_source_only";
    autonomousOperationalActionAllowed: false;
    redundancyDeclaration: "site_declared_named_human_approval";
  };
}

export interface SystemModelIssue {
  code: string;
  message: string;
}

export function validateSystemReferenceModel(
  model: SystemReferenceModel,
  resolveTemplate: (code: string) => unknown,
): SystemModelIssue[] {
  const issues: SystemModelIssue[] = [];
  const byCode = new Map<string, SystemNode>();
  const functionOwner = new Map<string, SystemNode>();

  for (const node of model.nodes) {
    if (byCode.has(node.code)) issues.push({ code: node.code, message: "duplicate node code" });
    byCode.set(node.code, node);
    for (const fn of node.functions) {
      if (functionOwner.has(fn.code)) issues.push({ code: fn.code, message: "duplicate function code" });
      functionOwner.set(fn.code, node);
      if (fn.functionalFailures.length === 0)
        issues.push({ code: fn.code, message: "function has no functional failure" });
      if (fn.performanceStandard !== "site_specified")
        issues.push({ code: fn.code, message: "reference model must not set a performance standard" });
    }
  }

  for (const node of model.nodes) {
    if (node.level === "system") {
      if (node.parentCode) issues.push({ code: node.code, message: "system must be a root" });
    } else {
      const parent = node.parentCode ? byCode.get(node.parentCode) : undefined;
      if (!parent) issues.push({ code: node.code, message: "missing or unknown parent" });
      else if (levelRank[parent.level] >= levelRank[node.level])
        issues.push({ code: node.code, message: `parent ${parent.code} is not above ${node.level}` });
    }
    if (node.functions.length === 0) issues.push({ code: node.code, message: "node has no function" });
    if (node.level === "equipment_unit") {
      if (node.assetClassTemplateCode) {
        if (!resolveTemplate(node.assetClassTemplateCode))
          issues.push({ code: node.code, message: `unknown template ${node.assetClassTemplateCode}` });
        if (node.equipmentClassStatus !== "template_available")
          issues.push({ code: node.code, message: "template bound but status is not template_available" });
      } else {
        if (node.equipmentClassStatus !== "template_planned")
          issues.push({ code: node.code, message: "no template bound; status must be template_planned" });
        if (!node.maintainableItems?.length)
          issues.push({ code: node.code, message: "planned equipment class must list maintainable items" });
      }
    }
  }

  const hasChildren = new Set(model.nodes.map((n) => n.parentCode).filter(Boolean));
  for (const node of model.nodes) {
    if ((node.level === "system" || node.level === "subsystem") && !hasChildren.has(node.code))
      issues.push({ code: node.code, message: `${node.level} has no children` });
  }

  for (const edge of model.edges) {
    if (!byCode.has(edge.from)) issues.push({ code: edge.from, message: `edge from unknown node (${edge.relation})` });
    if (!byCode.has(edge.to)) issues.push({ code: edge.to, message: `edge to unknown node (${edge.relation})` });
    if (edge.from === edge.to) issues.push({ code: edge.from, message: "self edge" });
  }

  const covered = new Set<string>();
  for (const group of model.redundancyGroups) {
    if (!byCode.has(group.nodeCode)) issues.push({ code: group.code, message: "redundancy group on unknown node" });
    if (group.allowedSchemes.length === 0) issues.push({ code: group.code, message: "no allowed schemes" });
    for (const fnCode of group.functionCodes) {
      if (!functionOwner.has(fnCode)) issues.push({ code: group.code, message: `unknown function ${fnCode}` });
      covered.add(fnCode);
    }
  }

  // Every critical function below system level needs a redundancy slot, so the
  // site is forced to declare (and a person to approve) how it is protected.
  for (const node of model.nodes) {
    if (node.level === "system") continue;
    for (const fn of node.functions) {
      if (fn.critical && !covered.has(fn.code))
        issues.push({ code: fn.code, message: "critical function has no redundancy group slot" });
    }
  }

  if (model.reviewState !== "draft") issues.push({ code: model.code, message: "reference model must be draft" });
  return issues;
}

export interface SiteRedundancyDeclaration {
  groupCode: string;
  scheme: RedundancyScheme;
  approvedBy?: string;
}

export interface SinglePointOfFailureFinding {
  groupCode: string;
  nodeCode: string;
  functionCodes: string[];
  reason: "not_declared" | "declared_N" | "declaration_not_approved";
}

/**
 * Critical functions with no redundancy, or whose redundancy is not yet a
 * named-person-approved site declaration. Findings are review prompts, never
 * actions.
 */
export function singlePointsOfFailure(
  model: SystemReferenceModel,
  declarations: SiteRedundancyDeclaration[],
): SinglePointOfFailureFinding[] {
  const declared = new Map(declarations.map((d) => [d.groupCode, d]));
  const findings: SinglePointOfFailureFinding[] = [];
  for (const group of model.redundancyGroups) {
    const d = declared.get(group.code);
    const base = { groupCode: group.code, nodeCode: group.nodeCode, functionCodes: group.functionCodes };
    if (!d) findings.push({ ...base, reason: "not_declared" });
    else if (!d.approvedBy?.trim()) findings.push({ ...base, reason: "declaration_not_approved" });
    else if (d.scheme === "N") findings.push({ ...base, reason: "declared_N" });
  }
  return findings;
}

/** Nodes that lose a supply (power, cooling, fuel, water) when `nodeCode` fails, following supply edges downstream. */
export function downstreamImpact(model: SystemReferenceModel, nodeCode: string): string[] {
  const supply: TopologyRelation[] = ["supplies_power_to", "cools", "supplies_fuel_to", "supplies_water_to"];
  const childrenOf = new Map<string, string[]>();
  for (const n of model.nodes) {
    if (!n.parentCode) continue;
    childrenOf.set(n.parentCode, [...(childrenOf.get(n.parentCode) ?? []), n.code]);
  }
  const out = new Map<string, string[]>();
  for (const e of model.edges) {
    if (supply.includes(e.relation)) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    // rejects_heat_to: if the heat sink fails, the equipment rejecting heat to it is affected.
    if (e.relation === "rejects_heat_to") out.set(e.to, [...(out.get(e.to) ?? []), e.from]);
  }
  const seen = new Set<string>();
  const stack = [nodeCode, ...(childrenOf.get(nodeCode) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of out.get(cur) ?? []) {
      if (seen.has(next) || next === nodeCode) continue;
      seen.add(next);
      stack.push(next, ...(childrenOf.get(next) ?? []));
    }
  }
  return [...seen].sort();
}
