import { supabase } from "../lib/supabase";

export interface WorkforceExecutionWorkspace {
  answered: boolean;
  refusal?: string;
  boundary: string;
  competencies: { id: number; title: string }[];
  members: { id: number; displayName: string; craft: string | null }[];
  evidence: { id: string; description: string }[];
  crewTemplates: {
    id: number;
    templateKey: string;
    title: string;
    description: string | null;
    version: number;
    active: boolean;
    basis: string;
    evidenceItemId: string;
    recordedBy: string;
    supersedesTemplateId: number | null;
    roles: {
      id: number;
      roleLabel: string;
      craft: string | null;
      headcount: number;
      requiredCompetencyId: number | null;
      isMandatory: boolean;
    }[];
  }[];
  tools: {
    id: number;
    toolKey: string;
    title: string;
    quantityAvailable: number;
    requiredCompetencyId: number | null;
    leadTimeDays: number | null;
    ownedBy: string | null;
    version: number;
    active: boolean;
    basis: string;
    evidenceItemId: string;
    recordedBy: string;
    supersedesToolId: number | null;
  }[];
  knowledgeAreas: {
    id: number;
    areaKey: string;
    title: string;
    consequenceIfLost: string;
    criticality: "critical" | "high" | "medium" | "low";
    documentedWhere: string | null;
    version: number;
    basis: string;
    evidenceItemId: string;
    holders: {
      memberId: number;
      memberName: string;
      depth: "aware" | "competent" | "expert";
      active: boolean;
      basis: string;
      evidenceItemId: string;
    }[];
  }[];
  standards: {
    id: number;
    workKey: string;
    title: string;
    version: number;
    basis: string | null;
    procedures: {
      id: number;
      languageCode: string;
      translationStatus: string;
      verifiedBy: string | null;
      verifiedAt: string | null;
    }[];
  }[];
}

export interface WorkforceExecutionReceipt {
  answered?: boolean;
  refusal?: string;
  error?: string;
  note?: string;
  status?: string;
  version?: number;
  crewTemplateId?: number;
  toolId?: number;
  knowledgeAreaId?: number;
  trainingPlanId?: number;
  standardWorkId?: number;
}

function unwrap<
  T extends { answered?: boolean; refusal?: string; error?: string },
>(data: unknown, error: { message: string } | null, fallback: string): T {
  if (error) throw new Error(error.message);
  const result = data as T | null;
  if (!result) throw new Error(fallback);
  if (result.answered === false || result.error)
    throw new Error(result.refusal ?? result.error ?? fallback);
  return result;
}

export async function getWorkforceExecutionWorkspace(): Promise<WorkforceExecutionWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_workforce_execution_workspace",
  );
  return unwrap<WorkforceExecutionWorkspace>(
    data,
    error,
    "The workforce execution workspace returned no result.",
  );
}

export async function recordCrewTemplate(input: {
  templateKey: string;
  title: string;
  description?: string;
  basis: string;
  evidenceItemId: string;
  roles: {
    roleLabel: string;
    craft?: string;
    headcount: string;
    requiredCompetencyId?: string;
    isMandatory: boolean;
  }[];
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc("record_crew_template", {
    p_payload: input,
  });
  return unwrap(data, error, "Crew composition was not recorded.");
}

export async function recordSpecialisedTool(input: {
  toolKey: string;
  title: string;
  quantityAvailable: string;
  requiredCompetencyId?: string;
  leadTimeDays?: string;
  ownedBy?: string;
  basis: string;
  evidenceItemId: string;
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc("record_specialised_tool", {
    p_payload: input,
  });
  return unwrap(data, error, "Specialised-tool availability was not recorded.");
}

export async function recordKnowledgeArea(input: {
  areaKey: string;
  title: string;
  consequenceIfLost: string;
  criticality: "critical" | "high" | "medium" | "low";
  documentedWhere?: string;
  basis: string;
  evidenceItemId: string;
  expectedVersion?: number;
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc("record_knowledge_area", {
    p_payload: input,
  });
  return unwrap(data, error, "Critical-knowledge definition was not recorded.");
}

export async function recordKnowledgeHolder(input: {
  areaId: number;
  memberId: number;
  action: "assign" | "end";
  depth: "aware" | "competent" | "expert";
  basis: string;
  evidenceItemId: string;
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc("record_knowledge_holder", {
    p_area_id: input.areaId,
    p_member_id: input.memberId,
    p_action: input.action,
    p_depth: input.depth,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
  });
  return unwrap(data, error, "Knowledge-holder evidence was not recorded.");
}

export async function recordKnowledgeTransferPlan(input: {
  knowledgeAreaId: number;
  memberId: number;
  competencyId: number;
  planKind: "succession" | "cross_training";
  targetDate: string;
  driver: string;
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc("record_knowledge_transfer_plan", {
    p_payload: input,
  });
  return unwrap(data, error, "Knowledge-transfer plan was not recorded.");
}

export async function registerWorkforceStandard(input: {
  workKey: string;
  title: string;
  language: string;
  content: string;
  basis: string;
  evidenceItemId: string;
}): Promise<WorkforceExecutionReceipt> {
  const { data, error } = await supabase.rpc(
    "register_standard_work_baseline",
    {
      p_work_key: input.workKey,
      p_title: input.title,
      p_language: input.language,
      p_content: input.content,
      p_basis: input.basis,
      p_evidence_id: input.evidenceItemId,
    },
  );
  return unwrap(data, error, "Existing controlled procedure was not recorded.");
}
