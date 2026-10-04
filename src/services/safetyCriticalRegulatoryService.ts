import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export interface SafetyCriticalAsset {
  id: string;
  name: string;
  tag: string | null;
}

export interface SafetyCriticalEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  assetId: string | null;
  verifiedBy: string;
  verifiedAt: string;
}

export interface SafetyCriticalElement {
  id: number;
  assetId: string | null;
  assetName: string | null;
  reference: string;
  label: string;
  barrierKind:
    | "instrumented"
    | "mechanical"
    | "passive"
    | "procedural"
    | "human"
    | "structural"
    | "emergency_response";
  barrierRole: "preventive" | "mitigative";
  performanceStandard: string;
  testIntervalMonths: number | null;
  lastTestedOn: string | null;
  testStatus: "interval_unknown" | "never_tested" | "overdue" | "current";
  evidenceItemId: string | null;
  evidenceDescription: string | null;
  evidenceVerifiedBy: string | null;
  evidenceVerifiedAt: string | null;
  effectiveFrom: string;
  reviewDue: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RegulatoryRequirement {
  layerId: string;
  layerVersion: number;
  layerTitle: string;
  jurisdiction: string;
  key: string;
  title: string;
  domain: string;
  requirementClass: "regulatory" | "statutory";
  applicability: "applicable" | "not_applicable" | "undetermined";
  obligation: "advisory" | "mandatory" | "not_applicable";
  authorityReference: string;
  applicabilityBasis: string;
  mandatoryBasis: string | null;
}

export interface SafetyCriticalObligationBinding {
  id: string;
  elementId: number;
  elementVersion: number;
  currentElementVersion: number;
  layerId: string;
  layerVersion: number;
  requirementKey: string;
  evidenceItemId: string;
  evidenceDescription: string | null;
  basis: string;
  linkedBy: string;
  linkedAt: string;
  current: boolean;
}

export interface SafetyCriticalRegulatoryWorkspace {
  elements: SafetyCriticalElement[];
  regulatoryRequirements: RegulatoryRequirement[];
  bindings: SafetyCriticalObligationBinding[];
  verifiedEvidence: SafetyCriticalEvidence[];
  assets: SafetyCriticalAsset[];
  coverage: {
    elements: number;
    elementsWithVerifiedEvidence: number;
    overdueOrUntested: number;
    mandatoryRegulatoryObligations: number;
    currentBindings: number;
    staleBindings: number;
  };
  jurisdiction: string | null;
  decisionBoundary: string;
}

export interface RecordSafetyCriticalElementInput {
  id?: number | null;
  assetId?: string | null;
  reference: string;
  label: string;
  barrierKind: SafetyCriticalElement["barrierKind"];
  barrierRole: SafetyCriticalElement["barrierRole"];
  performanceStandard: string;
  testIntervalMonths?: number | null;
  lastTestedOn?: string | null;
  evidenceItemId: string;
  effectiveFrom: string;
  reviewDue?: string | null;
  expectedVersion: number;
}

export interface LinkRegulatoryObligationInput {
  safetyCriticalElementId: number;
  expectedElementVersion: number;
  capabilityPackLayerId: string;
  expectedLayerVersion: number;
  requirementKey: string;
  evidenceItemId: string;
  basis: string;
}

export async function getSafetyCriticalRegulatoryWorkspace() {
  return callRpc<SafetyCriticalRegulatoryWorkspace>(
    "get_safety_critical_regulatory_workspace",
  );
}

export async function recordSafetyCriticalElement(
  input: RecordSafetyCriticalElementInput,
) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw new Error("Expected version must be a non-negative integer.");
  if (input.reference.trim().length < 2 || input.label.trim().length < 3)
    throw new Error("Record a reference and descriptive label.");
  if (input.performanceStandard.trim().length < 20)
    throw new Error("The testable performance standard needs 20 characters.");
  if (!input.evidenceItemId.trim())
    throw new Error("Choose independently verified canonical evidence.");
  if (
    input.testIntervalMonths != null &&
    (!Number.isInteger(input.testIntervalMonths) ||
      input.testIntervalMonths <= 0)
  )
    throw new Error("Test interval must be a positive whole month count.");

  return callRpc<{
    id: number;
    version: number;
    status: "recorded";
    complianceEstablished: false;
    workAuthorized: false;
    riskAccepted: false;
    operatingLimitChanged: false;
    returnToServiceAuthorized: false;
  }>("record_safety_critical_element", {
    p_record: {
      id: input.id ?? null,
      asset_id: input.assetId?.trim() || null,
      sce_ref: input.reference.trim(),
      label: input.label.trim(),
      barrier_kind: input.barrierKind,
      barrier_role: input.barrierRole,
      performance_standard: input.performanceStandard.trim(),
      test_interval_months: input.testIntervalMonths ?? null,
      last_tested_on: input.lastTestedOn || null,
      evidence_item_id: input.evidenceItemId.trim(),
      effective_from: input.effectiveFrom,
      review_due: input.reviewDue || null,
      expected_version: input.expectedVersion,
    },
  });
}

export async function linkSafetyCriticalRegulatoryObligation(
  input: LinkRegulatoryObligationInput,
) {
  if (!Number.isInteger(input.safetyCriticalElementId))
    throw new Error("Choose a safety-critical element.");
  if (
    !Number.isInteger(input.expectedElementVersion) ||
    input.expectedElementVersion <= 0 ||
    !Number.isInteger(input.expectedLayerVersion) ||
    input.expectedLayerVersion <= 0
  )
    throw new Error(
      "Element and jurisdiction-layer versions must be positive.",
    );
  if (!input.capabilityPackLayerId.trim() || !input.requirementKey.trim())
    throw new Error("Choose an exact adopted regulatory requirement.");
  if (!input.evidenceItemId.trim())
    throw new Error("Choose independently verified canonical evidence.");
  if (input.basis.trim().length < 20)
    throw new Error("Record at least 20 characters of applicability basis.");

  return callRpc<{
    id: string;
    status: "obligation_linked";
    elementVersion: number;
    layerVersion: number;
    complianceEstablished: false;
    workAuthorized: false;
    riskAccepted: false;
    operatingLimitChanged: false;
    returnToServiceAuthorized: false;
  }>("link_safety_critical_regulatory_obligation", {
    p_link: {
      safety_critical_element_id: input.safetyCriticalElementId,
      expected_element_version: input.expectedElementVersion,
      capability_pack_layer_id: input.capabilityPackLayerId.trim(),
      expected_layer_version: input.expectedLayerVersion,
      requirement_key: input.requirementKey.trim(),
      evidence_item_id: input.evidenceItemId.trim(),
      basis: input.basis.trim(),
    },
  });
}
