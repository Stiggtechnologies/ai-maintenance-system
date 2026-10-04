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

export type HseDomain =
  "occupational_safety" | "process_safety" | "environmental";
export type HseEventDomain = Exclude<HseDomain, "process_safety">;

export interface HseMetricDomain {
  reportingCoverageComplete: boolean;
  actualEvents: number | null;
  nearMisses: number | null;
  independentlyVerified: number;
  pendingClassification: number;
  humanRecordedContainmentLosses: number;
  basis: string;
}

export interface HseMetrics {
  window: { from: string; to: string };
  safety: HseMetricDomain;
  environmental: HseMetricDomain;
  gaps: {
    unverifiedEvents: number;
    eventsWithoutAsset: number;
    eventsWithoutSite: number;
  };
  decisionBoundary: string;
}

export interface HseSite {
  id: string;
  name: string;
}

export interface HseAsset {
  id: string;
  name: string;
  tag: string | null;
  siteId: string | null;
}

export interface HseConnector {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
}

export interface HseEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  assetId: string | null;
  verifiedBy: string;
  verifiedAt: string;
}

export interface HseReportingSource {
  id: string;
  sourceRef: string;
  version: number;
  domain: HseDomain;
  scope: "enterprise" | "site";
  siteId: string | null;
  sourceName: string;
  sourceKind: "manual_register" | "external_system" | "hybrid";
  connectorId: string | null;
  status: "active" | "inactive";
  coverageStart: string;
  coverageEnd: string | null;
  sourceReference: string;
  evidenceItemId: string;
  attestedBy: string;
  attestedAt: string;
}

export interface HseEvent {
  id: string;
  eventRef: string;
  version: number;
  status: "active" | "withdrawn";
  domain: HseEventDomain;
  eventType: string;
  actuality: "actual" | "near_miss";
  occurredAt: string;
  siteId: string | null;
  assetId: string | null;
  containmentLossId: number | null;
  recordability:
    | "recordable"
    | "not_recordable"
    | "pending_determination"
    | "not_applicable";
  regulatoryReportability:
    | "reportable"
    | "not_reportable"
    | "pending_determination"
    | "not_applicable";
  severityLabel: string | null;
  severityScaleReference: string | null;
  description: string;
  sourceReference: string;
  basis: string;
  recordedBy: string;
  recordedAt: string;
  verificationEvidenceId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
}

export interface HseContainmentLoss {
  id: number;
  occurredAt: string;
  assetId: string | null;
  substance: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  tier: "tier_1" | "tier_2" | "tier_3" | "tier_4";
  reachedEnvironment: boolean;
  investigationReference: string | null;
}

export interface EnterpriseHseWorkspace {
  canRecord: boolean;
  requiredAal: "aal2";
  metrics: HseMetrics;
  sites: HseSite[];
  assets: HseAsset[];
  connectors: HseConnector[];
  verifiedEvidence: HseEvidence[];
  reportingSources: HseReportingSource[];
  events: HseEvent[];
  containmentLosses: HseContainmentLoss[];
  decisionBoundary: string;
}

export interface HseReportingSourceInput {
  sourceRef: string;
  expectedVersion: number;
  domain: HseDomain;
  scope: "enterprise" | "site";
  siteId?: string | null;
  sourceName: string;
  sourceKind: "manual_register" | "external_system" | "hybrid";
  connectorId?: string | null;
  status: "active" | "inactive";
  coverageStart: string;
  coverageEnd?: string | null;
  sourceReference: string;
  evidenceItemId: string;
  basis: string;
}

export interface HseEventInput {
  eventRef: string;
  expectedVersion: number;
  status: "active" | "withdrawn";
  domain: HseEventDomain;
  eventType:
    | "injury"
    | "occupational_illness"
    | "exposure"
    | "unsafe_condition"
    | "spill_release"
    | "permit_exceedance"
    | "water_nonconformance"
    | "waste_nonconformance"
    | "wildlife_impact"
    | "other";
  actuality: "actual" | "near_miss";
  occurredAt: string;
  siteId?: string | null;
  assetId?: string | null;
  containmentLossId?: number | null;
  recordability: HseEvent["recordability"];
  regulatoryReportability: HseEvent["regulatoryReportability"];
  severityLabel?: string | null;
  severityScaleReference?: string | null;
  description: string;
  sourceReference: string;
  basis: string;
}

export interface HseReceipt {
  id: string;
  eventRef?: string;
  sourceRef?: string;
  version: number;
  status?: string;
  verified?: boolean;
  incidentClosed: false;
  complianceCertified: false;
  riskAccepted: false;
  workAuthorized: false;
  returnToServiceAuthorized: false;
}

function requiredText(value: string, label: string, min = 1) {
  const cleaned = value.trim();
  if (cleaned.length < min) throw new Error(`${label} is required.`);
  return cleaned;
}

export function getEnterpriseHseWorkspace(windowDays = 30) {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366)
    throw new Error("Window days must be between 1 and 366.");
  return callRpc<EnterpriseHseWorkspace>("get_enterprise_hse_workspace", {
    p_window_days: windowDays,
  });
}

export function recordHseReportingSource(input: HseReportingSourceInput) {
  const payload = {
    ...input,
    sourceRef: requiredText(input.sourceRef, "Source reference", 3),
    sourceName: requiredText(input.sourceName, "Source name"),
    sourceReference: requiredText(
      input.sourceReference,
      "Evidence source reference",
      2,
    ),
    basis: requiredText(input.basis, "Attestation basis", 20),
    siteId: input.scope === "site" ? input.siteId || null : null,
    connectorId:
      input.sourceKind === "manual_register" ? null : input.connectorId || null,
    coverageEnd: input.status === "inactive" ? input.coverageEnd || null : null,
  };
  if (!payload.evidenceItemId)
    throw new Error("Verified evidence is required.");
  if (payload.scope === "site" && !payload.siteId)
    throw new Error("A site is required for site-scoped coverage.");
  if (payload.sourceKind !== "manual_register" && !payload.connectorId)
    throw new Error("External and hybrid sources require a connector.");
  return callRpc<HseReceipt>("record_hse_reporting_source", {
    p_source: payload,
  });
}

export function recordHseEvent(input: HseEventInput) {
  const payload = {
    ...input,
    eventRef: requiredText(input.eventRef, "Event reference", 3),
    description: requiredText(input.description, "Description", 20),
    sourceReference: requiredText(input.sourceReference, "Source reference", 2),
    basis: requiredText(input.basis, "Classification basis", 20),
    siteId: input.siteId || null,
    assetId: input.assetId || null,
    containmentLossId: input.containmentLossId || null,
    severityLabel: input.severityLabel?.trim() || null,
    severityScaleReference: input.severityScaleReference?.trim() || null,
  };
  if (payload.severityLabel && !payload.severityScaleReference)
    throw new Error("A severity scale reference is required with a label.");
  return callRpc<HseReceipt>("record_hse_event", { p_event: payload });
}

export function verifyHseEvent(
  eventId: string,
  evidenceItemId: string,
  note: string,
) {
  if (!eventId || !evidenceItemId)
    throw new Error("Event and evidence are required.");
  return callRpc<HseReceipt>("verify_hse_event", {
    p_event_id: eventId,
    p_evidence_item_id: evidenceItemId,
    p_note: requiredText(note, "Verification note", 20),
  });
}
