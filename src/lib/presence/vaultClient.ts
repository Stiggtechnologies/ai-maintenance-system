/**
 * Signed-in Meet Sync vault I/O.
 *
 * RLS + stamp trigger own tenancy. This client never invents an org, never
 * writes when signed out, and never treats a note as authorization.
 */

import { supabase } from "../supabase";
import type { PresenceSessionMemory } from "./memory";
import {
  buildPresenceVaultDocuments,
  parseSessionDocument,
  type PresenceVaultWriteInput,
  VAULT_PATHS,
} from "./vault";

const TABLE = "presence_meeting_vault";

export async function loadPresenceVaultSession(input: {
  userId: string;
  organizationId: string;
}): Promise<PresenceSessionMemory | null> {
  if (!input.userId || !input.organizationId) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("body_json")
      .eq("organization_id", input.organizationId)
      .eq("user_id", input.userId)
      .eq("path", VAULT_PATHS.session)
      .maybeSingle();
    if (error || !data) return null;
    return parseSessionDocument(data);
  } catch {
    return null;
  }
}

export async function persistPresenceVault(
  input: {
    userId: string;
    organizationId: string;
  } & PresenceVaultWriteInput,
): Promise<boolean> {
  if (!input.userId || !input.organizationId) return false;
  const documents = buildPresenceVaultDocuments(input);
  try {
    for (const document of documents) {
      const { error } = await supabase.from(TABLE).upsert(
        {
          organization_id: input.organizationId,
          user_id: input.userId,
          path: document.path,
          kind: document.kind,
          title: document.title,
          body_markdown: document.bodyMarkdown,
          body_json: document.bodyJson,
          decision_case_id: document.decisionCaseId,
        },
        { onConflict: "organization_id,user_id,path" },
      );
      if (error) return false;
    }
    return true;
  } catch {
    return false;
  }
}
