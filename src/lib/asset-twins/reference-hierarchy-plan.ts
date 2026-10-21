import { dataCenterReferenceModel } from "./data-center-reference-model";
import type { SystemNode, SystemReferenceModel } from "./system-model";

/**
 * Turn a facility system reference model into an ordered plan of governed
 * hierarchy proposals for one customer site.
 *
 * Nothing here writes. Each step is something a named person proposes through
 * the existing governed flow (propose_asset_hierarchy_node), backed by their
 * own verified evidence, and an independent person verifies. The database
 * still enforces the order: site -> area -> system -> functional location,
 * and a child can only be proposed under a verified parent. The plan mirrors
 * that order so the person never hits a refusal for sequencing.
 *
 *   reference level   asset_locations.location_kind
 *   (site-chosen)     area      e.g. "Data hall 1", "Central plant"
 *   system            system
 *   subsystem         functional_location
 *   equipment_unit    not a location: an asset registered under the
 *                     functional location, instantiated from its template
 *
 * Codes are suggestions the site can change; names come from the model.
 */

export interface HierarchyPlanStep {
  /** Position in proposal order; a step's parent always comes earlier. */
  order: number;
  kind: "area" | "system" | "functional_location";
  /** Suggested location code, unique within the plan. */
  code: string;
  name: string;
  description: string;
  /** Code of the plan step this node is proposed under; null = directly under the site. */
  parentCode: string | null;
  /** The reference-model node this step represents, for traceability. */
  referenceNodeCode: string | null;
}

export interface EquipmentPlanItem {
  /** Functional location (plan step code) the asset is registered under. */
  locationCode: string;
  referenceNodeCode: string;
  name: string;
  assetClassTemplateCode: string | null;
  maintainableItems: string[];
}

export interface ReferenceHierarchyPlan {
  modelCode: string;
  areaCode: string;
  steps: HierarchyPlanStep[];
  equipment: EquipmentPlanItem[];
  governance: {
    writes: "none";
    eachStepRequires: "named_proposer_verified_evidence_independent_reviewer";
  };
}

const CODE = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

export function planReferenceHierarchy(
  model: SystemReferenceModel,
  area: { code: string; name: string; description?: string },
): ReferenceHierarchyPlan {
  const areaCode = area.code.trim().toUpperCase();
  if (!CODE.test(areaCode)) throw new Error("Area code must be letters, digits or hyphens");
  if (!area.name.trim()) throw new Error("Area name is required");

  const children = new Map<string, SystemNode[]>();
  for (const node of model.nodes) {
    if (!node.parentCode) continue;
    children.set(node.parentCode, [...(children.get(node.parentCode) ?? []), node]);
  }

  const steps: HierarchyPlanStep[] = [];
  const equipment: EquipmentPlanItem[] = [];
  const push = (step: Omit<HierarchyPlanStep, "order">) => steps.push({ ...step, order: steps.length + 1 });
  const locationCode = (node: SystemNode) => `${areaCode}-${node.code.replace(/^DC-/, "")}`;
  const fnText = (node: SystemNode) => node.functions.map((f) => f.statement).join("; ");

  push({
    kind: "area",
    code: areaCode,
    name: area.name.trim(),
    description: area.description?.trim() || `${model.name} applied to this area`,
    parentCode: null,
    referenceNodeCode: null,
  });

  for (const system of model.nodes.filter((n) => n.level === "system")) {
    push({
      kind: "system",
      code: locationCode(system),
      name: system.name,
      description: `Function: ${fnText(system)}`,
      parentCode: areaCode,
      referenceNodeCode: system.code,
    });
    for (const sub of (children.get(system.code) ?? []).filter((n) => n.level === "subsystem")) {
      push({
        kind: "functional_location",
        code: locationCode(sub),
        name: sub.name,
        description: `Function: ${fnText(sub)}`,
        parentCode: locationCode(system),
        referenceNodeCode: sub.code,
      });
      for (const unit of (children.get(sub.code) ?? []).filter((n) => n.level === "equipment_unit")) {
        equipment.push({
          locationCode: locationCode(sub),
          referenceNodeCode: unit.code,
          name: unit.name,
          assetClassTemplateCode: unit.assetClassTemplateCode ?? null,
          maintainableItems: unit.maintainableItems ?? [],
        });
      }
    }
  }

  return {
    modelCode: model.code,
    areaCode,
    steps,
    equipment,
    governance: {
      writes: "none",
      eachStepRequires: "named_proposer_verified_evidence_independent_reviewer",
    },
  };
}

/** Reference models available per industry pack code (industry-catalog codes). */
export const systemReferenceModelsByIndustry: Readonly<Record<string, SystemReferenceModel>> = {
  data_centers: dataCenterReferenceModel,
};

export function getSystemReferenceModelForIndustry(industryCode: string): SystemReferenceModel | undefined {
  return Object.prototype.hasOwnProperty.call(systemReferenceModelsByIndustry, industryCode)
    ? systemReferenceModelsByIndustry[industryCode]
    : undefined;
}

export interface ExistingLocationRef {
  id: string;
  code: string;
  status: "proposed" | "verified" | "rejected";
}

export type PlanStepState = "verified" | "proposed" | "ready" | "waiting_for_parent";

export interface PlanStepStatus {
  code: string;
  state: PlanStepState;
  /** Verified parent location id to propose under; null for an area or when not ready. */
  parentLocationId: string | null;
}

/**
 * Where each plan step stands against the site's existing hierarchy, matched
 * by location code. A rejected node does not count as present: the step is
 * ready to propose again. Only a verified parent unlocks a child.
 */
export function planStepStatuses(
  plan: ReferenceHierarchyPlan,
  existing: ExistingLocationRef[],
): PlanStepStatus[] {
  const byCode = new Map<string, ExistingLocationRef>();
  for (const loc of existing) {
    const key = loc.code.trim().toUpperCase();
    const prior = byCode.get(key);
    // Prefer verified, then proposed, over rejected duplicates.
    const rank = (s: ExistingLocationRef["status"]) => (s === "verified" ? 2 : s === "proposed" ? 1 : 0);
    if (!prior || rank(loc.status) > rank(prior.status)) byCode.set(key, loc);
  }
  return plan.steps.map((step) => {
    const own = byCode.get(step.code);
    if (own?.status === "verified") return { code: step.code, state: "verified", parentLocationId: null };
    if (own?.status === "proposed") return { code: step.code, state: "proposed", parentLocationId: null };
    if (!step.parentCode) return { code: step.code, state: "ready", parentLocationId: null };
    const parent = byCode.get(step.parentCode);
    return parent?.status === "verified"
      ? { code: step.code, state: "ready", parentLocationId: parent.id }
      : { code: step.code, state: "waiting_for_parent", parentLocationId: null };
  });
}
