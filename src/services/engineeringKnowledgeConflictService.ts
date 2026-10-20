import { supabase } from "../lib/supabase";
import type { KnowledgeConflictKind } from "../lib/engineering-knowledge/knowledge-conflicts";

export interface EngineeringKnowledgeConflictReport {
  entityType: string;
  canonicalId: string;
  findings: Array<{
    kind: KnowledgeConflictKind;
    sourceIds: string[];
    detail: string;
  }>;
  grantsAuthority: false;
  grantsWorkRelease: false;
  grantsApproval: false;
  decisionBoundary: string;
  error?: string;
}

export async function detectEngineeringKnowledgeConflicts(
  entityType: string,
  canonicalId: string,
): Promise<EngineeringKnowledgeConflictReport> {
  const { data, error } = await supabase.rpc(
    "detect_engineering_knowledge_conflicts",
    {
      p_entity_type: entityType,
      p_canonical_id: canonicalId,
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as EngineeringKnowledgeConflictReport;
  if (!payload) throw new Error("Conflict detection returned no result");
  if (payload.error) throw new Error(payload.error);
  if (
    payload.grantsAuthority !== false ||
    payload.grantsWorkRelease !== false ||
    payload.grantsApproval !== false
  ) {
    throw new Error("Conflict detection must not grant authority");
  }
  return payload;
}
