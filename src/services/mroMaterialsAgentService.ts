import { supabase } from "../lib/supabase";

export interface MroMaterialsAgentMaterial {
  materialId: string;
  materialCode: string;
  description: string;
  criticality: "critical" | "essential" | "routine" | null;
  repairable: boolean;
  leadTimeDays: number | null;
  minimumQuantity: number | null;
  maximumQuantity: number | null;
  sourceSystem: string | null;
  stockRecords: number;
  available: number;
  openShortLines: number;
  approvedSuppliers: number;
  lastAssessedAt: string | null;
}

export interface MroMaterialsAgentMember {
  id: string;
  name: string;
  role: string;
}

export interface MroMaterialsEvidenceGap {
  code: string;
  severity: "blocker" | "attention" | "disclosure";
  detail: string;
}

export interface MroMaterialsEvidencePlanStep {
  sequence: number;
  question: string;
  owner: string;
  completion: string;
}

export interface MroMaterialsAgentAssessment {
  criticalSpares: {
    state: string;
    criticality: string | null;
    bomRows: number;
    assetsUsing: number;
    installedComponents: number;
    approvedSources: number;
    approvedAlternatives: number;
  };
  reorderPolicy: {
    state: string;
    configuredMinimum: number | null;
    configuredMaximum: number | null;
    leadTimeDays: number | null;
    observedLeadTimeDemand: number | null;
    basis: string;
  };
  repairables: {
    state: string;
    repairable: boolean;
    returnEventsInWindow: number;
    installedComponents: number;
    turnaroundDays: null;
    repairYield: null;
  };
  stockouts: {
    state: string;
    openDemandLines: number;
    openShortLines: number;
    shortageEventsInWindow: number;
    requiredQuantity: number;
    reservedForDemand: number;
  };
  obsolescence: {
    state: string;
    recordedSuppliers: number;
    approvedSuppliers: number;
    lifecycleUnknown: number;
    eolOrLastTimeBuySuppliers: number;
    earliestLastTimeBuyDate: string | null;
    remainingAssetLife: null;
  };
  inventoryPosition: {
    stockRecords: number;
    onHand: number;
    reserved: number;
    available: number;
    onOrder: number;
    lotRecords: number;
    serviceableLotQuantity: number;
    lotCertificationGaps: number;
  };
  demandEvidence: {
    windowDays: number;
    eventRows: number;
    issueEvents: number;
    issuedQuantity: number;
    firstEventAt: string | null;
    lastEventAt: string | null;
  };
  evidenceGaps: MroMaterialsEvidenceGap[];
  evidencePlan: MroMaterialsEvidencePlanStep[];
  interpretation: string;
  limitations: string[];
  humanReviewRequired: true;
  mayCreatePurchaseOrder: false;
  mayChangeStock: false;
  mayReserveOrIssueMaterial: false;
  mayApproveSupplier: false;
  mayChangeReorderPolicy: false;
  mayApproveSubstitution: false;
  mayCommitSpend: false;
  mayReleaseWork: false;
}

export interface MroMaterialsReviewAssignment {
  assignmentId: string;
  assignedTo: string;
  ownerName: string;
  dueDate: string;
  note: string;
}

export interface MroMaterialsAgentPack {
  packId: string;
  materialId: string;
  materialCode: string;
  description: string;
  criticality: string | null;
  agentRunId: string;
  windowDays: number;
  assessment: MroMaterialsAgentAssessment;
  createdAt: string;
  assignment: MroMaterialsReviewAssignment | null;
}

export interface MroMaterialsAgentWorkspace {
  materials: MroMaterialsAgentMaterial[];
  packs: MroMaterialsAgentPack[];
  members: MroMaterialsAgentMember[];
  basis: string;
}

function rpcError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    return typeof error === "string"
      ? error
      : "The governed MRO-material action failed.";
  }
  return null;
}

export async function loadMroMaterialsAgentWorkspace(): Promise<MroMaterialsAgentWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_mro_materials_agent_workspace",
    { p_limit: 50 },
  );
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
  const value =
    data && typeof data === "object"
      ? (data as Partial<MroMaterialsAgentWorkspace>)
      : {};
  return {
    materials: Array.isArray(value.materials) ? value.materials : [],
    packs: Array.isArray(value.packs) ? value.packs : [],
    members: Array.isArray(value.members) ? value.members : [],
    basis:
      typeof value.basis === "string"
        ? value.basis
        : "No governed MRO-material workspace is available.",
  };
}

export async function runMroMaterialsAgent(input: {
  materialId: string;
  windowDays: number;
}): Promise<void> {
  const { data, error } = await supabase.rpc("run_mro_materials_agent", {
    p_material_id: input.materialId,
    p_window_days: input.windowDays,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}

export async function assignMroMaterialReview(input: {
  packId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc("assign_mro_material_review", {
    p_pack_id: input.packId,
    p_assigned_to: input.assignedTo,
    p_due_date: input.dueDate,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}
