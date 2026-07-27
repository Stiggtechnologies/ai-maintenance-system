import { supabase } from "../lib/supabase";
import {
  validateInspectionRecommendationPackage,
  type InspectionRecommendationPackage,
} from "../lib/asset-twins/inspection-recommendations";

export interface PersistedInspectionRecommendationPackage {
  recommendationId: string;
  approvalId: string;
  evidenceItemIds: string[];
  created: boolean;
}

interface PersistenceRpcResult {
  recommendation_id?: unknown;
  approval_id?: unknown;
  evidence_item_ids?: unknown;
  created?: unknown;
}

function validateRpcResult(data: unknown): PersistedInspectionRecommendationPackage {
  if (!data || typeof data !== "object") {
    throw new Error("Inspection recommendation persistence returned no result.");
  }

  const result = data as PersistenceRpcResult;
  if (typeof result.recommendation_id !== "string" || !result.recommendation_id) {
    throw new Error("Inspection recommendation persistence returned no recommendation ID.");
  }
  if (typeof result.approval_id !== "string" || !result.approval_id) {
    throw new Error("Inspection recommendation persistence returned no approval ID.");
  }
  if (
    !Array.isArray(result.evidence_item_ids) ||
    result.evidence_item_ids.length === 0 ||
    result.evidence_item_ids.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("Inspection recommendation persistence returned invalid evidence IDs.");
  }
  if (typeof result.created !== "boolean") {
    throw new Error("Inspection recommendation persistence returned no idempotency status.");
  }

  return {
    recommendationId: result.recommendation_id,
    approvalId: result.approval_id,
    evidenceItemIds: result.evidence_item_ids as string[],
    created: result.created,
  };
}

/**
 * Atomically persists a governed inspection recommendation package.
 *
 * The database RPC stamps the caller's organization, verifies that the asset
 * belongs to that organization, normalizes inspection evidence confidence from
 * 0–1 to the operating-loop 0–100 scale, and inserts recommendation, approval,
 * and evidence records in one transaction. Retrying the same source finding is
 * idempotent and returns the existing package.
 */
export async function persistInspectionRecommendationPackage(
  packageDraft: InspectionRecommendationPackage,
): Promise<PersistedInspectionRecommendationPackage> {
  const issues = validateInspectionRecommendationPackage(packageDraft);
  if (!packageDraft.sourceFindingId.trim()) {
    issues.push({ path: "sourceFindingId", message: "Source finding ID is required." });
  }

  if (issues.length > 0) {
    throw new Error(
      `Invalid inspection recommendation package: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const { data, error } = await supabase.rpc(
    "persist_inspection_recommendation_package",
    {
      p_source_finding_id: packageDraft.sourceFindingId,
      p_recommendation: packageDraft.recommendation,
      p_approval: packageDraft.approval,
      p_evidence_items: packageDraft.evidenceItems,
    },
  );

  if (error) {
    throw new Error(`Could not persist inspection recommendation package: ${error.message}`);
  }

  return validateRpcResult(data);
}
