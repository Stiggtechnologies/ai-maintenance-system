import { supabase } from "../lib/supabase";
import type { SyncAttachment } from "./syncConversation";

/**
 * Remove a creator-owned Sync source without permitting arbitrary attachment
 * row updates. The RPC verifies org/workspace/creator and tombstones extracted
 * text; the matching creator-private storage policy removes the object.
 */
export async function removeSyncAttachmentGoverned(
  attachment: SyncAttachment,
): Promise<void> {
  const { data: objectPath, error: rpcError } = await supabase.rpc(
    "delete_sync_attachment",
    { p_attachment_id: attachment.id },
  );
  if (rpcError) throw rpcError;
  const path = typeof objectPath === "string" ? objectPath : attachment.objectPath;
  const { error: storageError } = await supabase.storage
    .from("sync-attachments")
    .remove([path]);
  if (storageError) throw storageError;
}
