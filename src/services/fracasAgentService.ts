import { supabase } from "../lib/supabase";

export interface FracasCandidate {
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  completedAt: string;
  rawFailureLabel: string;
  assetTag: string;
  hasPack: boolean;
}

export interface FracasMember {
  id: string;
  name: string;
  role: string;
}

interface FracasAssignment {
  assignmentId: string;
  assignedTo: string;
  ownerName: string;
  dueDate: string;
  note: string;
}

interface FracasVerification {
  verificationId: string;
  status: string;
  effectiveness: "observing" | "effective" | "ineffective";
}

export interface FracasInvestigation {
  problemStatement: string;
  knownFacts: Array<{ fact: string; evidenceRef?: string }>;
  hypotheses: Array<{
    statement: string;
    status: string;
    warning: string;
  }>;
  evidenceGaps: Array<{ code: string; severity: string; detail: string }>;
  evidencePlan: Array<{
    sequence: number;
    question: string;
    owner: string;
    completion: string;
  }>;
  recurrence: { matchingEvents: number; basis: string };
  limitations: string[];
  mayClaimRootCause: false;
  mayCloseInvestigation: false;
  mayAttestVerification: false;
}

export interface FracasPack {
  packId: string;
  workOrderId: string;
  workOrderNumber: string;
  title: string;
  assetTag: string;
  agentRunId: string;
  investigation: FracasInvestigation;
  createdAt: string;
  assignment: FracasAssignment | null;
  verification: FracasVerification | null;
}

export interface FracasWorkspace {
  candidates: FracasCandidate[];
  packs: FracasPack[];
  members: FracasMember[];
  basis: string;
}

function rpcError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    return typeof error === "string" ? error : "The governed action failed.";
  }
  return null;
}

export async function loadFracasWorkspace(): Promise<FracasWorkspace> {
  const { data, error } = await supabase.rpc("get_fracas_workspace", {
    p_limit: 50,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
  return data as FracasWorkspace;
}

export async function runFracasAgent(workOrderId: string): Promise<void> {
  const { data, error } = await supabase.rpc("run_fracas_rca_agent", {
    p_work_order_id: workOrderId,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}

export async function assignFracasInvestigation(input: {
  packId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc("assign_fracas_investigation", {
    p_pack_id: input.packId,
    p_assigned_to: input.assignedTo,
    p_due_date: input.dueDate,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}

export async function startFracasVerification(packId: string): Promise<void> {
  const { data, error } = await supabase.rpc("start_fracas_verification", {
    p_pack_id: packId,
    p_observation_days: 90,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}
