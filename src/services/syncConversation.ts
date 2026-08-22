import { supabase } from "../lib/supabase";
import {
  buildSyncAttachmentObjectPath,
  sha256File,
  validateSyncAttachment,
} from "../lib/sync/attachments";
import type {
  AssistantBlock,
  EvidenceReference,
  InvestigationCheckRecord,
  SyncTurnTelemetry,
} from "../types/sync-stream";

export type SyncConversationMode = "conversation" | "meeting" | "field";

export interface SyncConversationMessage {
  id: string;
  turnId: string | null;
  role: "user" | "agent";
  text: string;
  status: string;
  blocks: AssistantBlock[];
  evidence: EvidenceReference[];
  checks: InvestigationCheckRecord[];
  telemetry: SyncTurnTelemetry | null;
  attachmentIds: string[];
  responseMode?: string | null;
  createdAt: string;
}

export interface SyncConversationSummary {
  id: string;
  title: string;
  mode: SyncConversationMode;
  status: string;
  updatedAt: string;
  lastTurnAt: string | null;
}

export interface SyncConversationSnapshot extends SyncConversationSummary {
  messages: SyncConversationMessage[];
}

export interface SyncAttachment {
  id: string;
  workspaceId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  objectPath: string;
  extractionStatus: "pending" | "extracting" | "ready" | "unsupported" | "failed";
  createdAt: string;
}

function asBlocks(value: unknown): AssistantBlock[] {
  return Array.isArray(value) ? (value as AssistantBlock[]) : [];
}

function asEvidence(value: unknown): EvidenceReference[] {
  return Array.isArray(value) ? (value as EvidenceReference[]) : [];
}

function asChecks(value: unknown): InvestigationCheckRecord[] {
  return Array.isArray(value) ? (value as InvestigationCheckRecord[]) : [];
}

function asTelemetry(value: unknown): SyncTurnTelemetry | null {
  return value && typeof value === "object"
    ? (value as SyncTurnTelemetry)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function modeOf(value: unknown): SyncConversationMode {
  return value === "meeting" || value === "field" ? value : "conversation";
}

function mapSummary(row: Record<string, unknown>): SyncConversationSummary {
  return {
    id: String(row.id),
    title: String(row.title ?? "Sync conversation"),
    mode: modeOf(row.mode),
    status: String(row.status ?? "active"),
    updatedAt: String(row.updated_at ?? ""),
    lastTurnAt: row.last_turn_at ? String(row.last_turn_at) : null,
  };
}

export async function listSyncConversations(options?: {
  includeArchived?: boolean;
  search?: string;
  limit?: number;
}): Promise<SyncConversationSummary[]> {
  let query = supabase
    .from("cowork_workspaces")
    .select("id, title, mode, status, updated_at, last_turn_at")
    .eq("workspace_kind", "sync")
    .order("updated_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, options?.limit ?? 40)));
  if (!options?.includeArchived) query = query.eq("status", "active");
  const search = options?.search?.trim();
  if (search) query = query.ilike("title", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapSummary(row as Record<string, unknown>));
}

export async function loadSyncConversation(
  workspaceId: string,
): Promise<SyncConversationSnapshot | null> {
  const { data: workspace, error: workspaceError } = await supabase
    .from("cowork_workspaces")
    .select("id, title, mode, status, updated_at, last_turn_at")
    .eq("id", workspaceId)
    .eq("workspace_kind", "sync")
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace?.id) return null;

  const { data: rows, error: messageError } = await supabase
    .from("cowork_messages")
    .select(
      "id, turn_id, role, message, delivery_status, metadata, blocks, evidence_refs, created_at",
    )
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: true })
    .limit(400);
  if (messageError) throw messageError;

  const summary = mapSummary(workspace as unknown as Record<string, unknown>);
  return {
    ...summary,
    messages: (rows ?? []).map((row) => {
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      return {
        id: row.id,
        turnId: row.turn_id ?? null,
        role: row.role === "user" ? "user" : "agent",
        text: row.message ?? "",
        status: row.delivery_status ?? "complete",
        blocks: asBlocks(row.blocks),
        evidence: asEvidence(row.evidence_refs),
        checks: asChecks(metadata.investigation_checks),
        telemetry: asTelemetry(metadata.telemetry),
        attachmentIds: asStringArray(metadata.attachment_ids),
        responseMode:
          typeof metadata.response_mode === "string"
            ? metadata.response_mode
            : null,
        createdAt: row.created_at,
      };
    }),
  };
}

export async function loadLatestSyncConversation(): Promise<SyncConversationSnapshot | null> {
  const recent = await listSyncConversations({ limit: 1 });
  return recent[0] ? loadSyncConversation(recent[0].id) : null;
}

export async function createSyncConversation(
  title = "New Sync conversation",
  mode: SyncConversationMode = "conversation",
): Promise<string> {
  const { data, error } = await supabase.rpc("create_sync_conversation", {
    p_title: title,
    p_mode: mode,
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Sync conversation was not created.");
  return data;
}

export async function renameSyncConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase.rpc("rename_sync_conversation", {
    p_workspace_id: id,
    p_title: title,
  });
  if (error) throw error;
}

export async function archiveSyncConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc("archive_sync_conversation", {
    p_workspace_id: id,
  });
  if (error) throw error;
}

export async function restoreSyncConversation(id: string): Promise<void> {
  const { error } = await supabase.rpc("restore_sync_conversation", {
    p_workspace_id: id,
  });
  if (error) throw error;
}

export async function deleteSyncConversation(id: string): Promise<void> {
  const attachments = await listSyncAttachments(id);
  if (attachments.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("sync-attachments")
      .remove(attachments.map((attachment) => attachment.objectPath));
    if (storageError) throw storageError;
  }
  const { error } = await supabase.rpc("delete_sync_conversation", {
    p_workspace_id: id,
  });
  if (error) throw error;
}

function mapAttachment(row: Record<string, unknown>): SyncAttachment {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    fileName: String(row.file_name),
    mimeType: row.mime_type ? String(row.mime_type) : null,
    sizeBytes: Number(row.size_bytes ?? 0),
    objectPath: String(row.object_path),
    extractionStatus: String(row.extraction_status ?? "pending") as SyncAttachment["extractionStatus"],
    createdAt: String(row.created_at ?? ""),
  };
}

export async function listSyncAttachments(workspaceId: string): Promise<SyncAttachment[]> {
  const { data, error } = await supabase
    .from("cowork_attachments")
    .select(
      "id, workspace_id, file_name, mime_type, size_bytes, object_path, extraction_status, created_at",
    )
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => mapAttachment(row as Record<string, unknown>));
}

async function currentIdentity(): Promise<{ userId: string; organizationId: string }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("Your session has expired.");
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) {
    throw new Error("Your organization context is unavailable.");
  }
  return { userId: user.id, organizationId: profile.organization_id };
}

export async function uploadSyncAttachment(
  workspaceId: string,
  file: File,
): Promise<SyncAttachment> {
  const validation = validateSyncAttachment(file);
  if (validation) throw new Error(validation);
  const { userId, organizationId } = await currentIdentity();
  const objectPath = buildSyncAttachmentObjectPath({
    organizationId,
    userId,
    workspaceId,
    fileName: file.name,
  });
  const { error: uploadError } = await supabase.storage
    .from("sync-attachments")
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type || undefined,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  try {
    const { data, error } = await supabase
      .from("cowork_attachments")
      .insert({
        organization_id: organizationId,
        workspace_id: workspaceId,
        uploaded_by: userId,
        file_name: file.name.slice(0, 240),
        mime_type: file.type || null,
        size_bytes: file.size,
        object_path: objectPath,
        content_sha256: await sha256File(file),
        extraction_status: "pending",
      })
      .select(
        "id, workspace_id, file_name, mime_type, size_bytes, object_path, extraction_status, created_at",
      )
      .single();
    if (error || !data) throw error ?? new Error("Attachment metadata was not created.");
    return mapAttachment(data as unknown as Record<string, unknown>);
  } catch (error) {
    await supabase.storage.from("sync-attachments").remove([objectPath]);
    throw error;
  }
}

export async function removeSyncAttachment(attachment: SyncAttachment): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from("sync-attachments")
    .remove([attachment.objectPath]);
  if (storageError) throw storageError;
  // Attachment rows are intentionally not client-updatable. Removing an unused
  // pre-turn attachment can be represented by deleting its metadata row only
  // through the owner-scoped conversation lifecycle; until then, the missing
  // storage object makes it unusable and the runtime reports extraction failure.
}
