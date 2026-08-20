import { supabase } from "../lib/supabase";
import type { AssistantBlock, EvidenceReference } from "../types/sync-stream";

export interface SyncConversationMessage {
  id: string;
  turnId: string | null;
  role: "user" | "agent";
  text: string;
  status: string;
  blocks: AssistantBlock[];
  evidence: EvidenceReference[];
  createdAt: string;
}

export interface SyncConversationSnapshot {
  id: string;
  title: string;
  mode: "conversation" | "meeting" | "field";
  messages: SyncConversationMessage[];
}

function asBlocks(value: unknown): AssistantBlock[] {
  return Array.isArray(value) ? (value as AssistantBlock[]) : [];
}

function asEvidence(value: unknown): EvidenceReference[] {
  return Array.isArray(value) ? (value as EvidenceReference[]) : [];
}

/**
 * Resume the caller's most recently active Sync workspace.
 * RLS supplies the organization predicate; no tenant id is accepted here.
 */
export async function loadLatestSyncConversation(): Promise<SyncConversationSnapshot | null> {
  const { data: workspace, error: workspaceError } = await supabase
    .from("cowork_workspaces")
    .select("id, title, mode")
    .eq("workspace_kind", "sync")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace?.id) return null;

  const { data: rows, error: messageError } = await supabase
    .from("cowork_messages")
    .select(
      "id, turn_id, role, message, delivery_status, blocks, evidence_refs, created_at",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (messageError) throw messageError;

  return {
    id: workspace.id,
    title: workspace.title ?? "Sync conversation",
    mode:
      workspace.mode === "meeting" || workspace.mode === "field"
        ? workspace.mode
        : "conversation",
    messages: (rows ?? []).map((row) => ({
      id: row.id,
      turnId: row.turn_id ?? null,
      role: row.role === "user" ? "user" : "agent",
      text: row.message ?? "",
      status: row.delivery_status ?? "complete",
      blocks: asBlocks(row.blocks),
      evidence: asEvidence(row.evidence_refs),
      createdAt: row.created_at,
    })),
  };
}
