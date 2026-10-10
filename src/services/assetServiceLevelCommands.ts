import type { RecordAssetServiceLevelInput, ServiceLevelScope } from "./assetServiceLevelService";

/** Transport identity only; the canonical audit receipt remains authority. */
export interface ServiceLevelCommandTarget {
  assetId: string;
  version: number;
  status: "draft" | "verified";
  operation: "record" | "verify";
  request: Record<string, string | number | null>;
}

export function recordServiceLevelCommandTarget(input: RecordAssetServiceLevelInput): ServiceLevelCommandTarget {
  return { assetId: input.assetId, version: (input.expectedVersion ?? 0) + 1, status: "draft", operation: "record", request: {
    p_asset_id: input.assetId, p_service_name: input.serviceName,
    p_beneficiary: input.beneficiary, p_tolerable_downtime_hours: input.tolerableDowntimeHours,
    p_consequence_class: input.consequenceClass, p_restoration_rank: input.restorationRank,
    p_notes: input.notes, p_basis: input.basis, p_evidence_item_id: input.evidenceItemId,
    p_expected_version: input.expectedVersion, p_command_id: input.commandId,
    p_observed_actor_id: input.observedActorId, p_observed_organization_id: input.observedOrganizationId,
  } };
}

export function verifyServiceLevelCommandTarget(assetId: string, expectedVersion: number, reviewNote: string, commandId: string, scope: ServiceLevelScope): ServiceLevelCommandTarget {
  return { assetId, version: expectedVersion + 1, status: "verified", operation: "verify", request: {
    p_asset_id: assetId, p_expected_version: expectedVersion, p_review_note: reviewNote,
    p_command_id: commandId, p_observed_actor_id: scope.actorId,
    p_observed_organization_id: scope.organizationId,
  } };
}
