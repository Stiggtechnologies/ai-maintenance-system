import { supabase } from "../lib/supabase";
import type { DocumentEngineeringMapping } from "../lib/engineering-knowledge/document-mappings";

export interface PersistedDocumentMappings {
  sourceId: string;
  mappingIds: string[];
  count: number;
  grantsAuthority: false;
  grantsWorkRelease: false;
  grantsApproval: false;
  decisionBoundary: string;
}

export async function persistDocumentEngineeringMappings(
  sourceId: string,
  mappings: DocumentEngineeringMapping[],
): Promise<PersistedDocumentMappings> {
  const { data, error } = await supabase.rpc(
    "persist_document_engineering_mappings",
    {
      p_source_id: sourceId,
      p_mappings: mappings,
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as PersistedDocumentMappings & { error?: string };
  if (!payload || payload.error) {
    throw new Error(
      payload?.error ?? "Document mapping persistence returned no result",
    );
  }
  if (
    payload.grantsAuthority !== false ||
    payload.grantsWorkRelease !== false ||
    payload.grantsApproval !== false
  ) {
    throw new Error("A document mapping must not grant authority");
  }
  return payload;
}
