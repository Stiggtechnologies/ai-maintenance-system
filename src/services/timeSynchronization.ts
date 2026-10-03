import { supabase } from "../lib/supabase";

export type TimeAssuranceState =
  | "unconfigured"
  | "disabled"
  | "unproven"
  | "stale"
  | "synchronized"
  | "untrusted";

export interface ConnectorTimeAssurance {
  connectorId: string;
  connectorKey: string | null;
  name: string;
  enabled: boolean;
  protocol: "ntp" | "ptp" | "gnss" | "vendor_managed" | "system_managed" | null;
  referenceAuthority: string | null;
  toleranceMs: number | null;
  maxObservationAgeMinutes: number | null;
  configurationRevision: number;
  configurationEvidenceReference: string | null;
  configuredAt: string | null;
  state: TimeAssuranceState;
  eligibleForTimeSensitiveEvidence: boolean;
  reason: string;
  observationId: string | null;
  sourceClockAt: string | null;
  referenceClockAt: string | null;
  receivedAt: string | null;
  offsetMs: number | null;
  measurementUncertaintyMs: number | null;
  worstCaseOffsetMs: number | null;
  observationEvidenceReference: string | null;
}

export interface TimeAssuranceWorkspace {
  generatedAt: string;
  operationalAuthority: false;
  setsSourceClocks: false;
  connectors: ConnectorTimeAssurance[];
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const payload = data as RpcResult | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

export const timeSynchronizationActions = {
  status: () =>
    call<TimeAssuranceWorkspace>("get_connector_time_assurance", {}),

  configure: (args: {
    connectorId: string;
    protocol: NonNullable<ConnectorTimeAssurance["protocol"]>;
    referenceAuthority: string;
    toleranceMs: number;
    maxObservationAgeMinutes: number;
    evidenceReference: string;
    basis: string;
  }) =>
    call<RpcResult>("configure_connector_time_assurance", {
      p_connector_id: args.connectorId,
      p_protocol: args.protocol,
      p_reference_authority: args.referenceAuthority,
      p_tolerance_ms: args.toleranceMs,
      p_max_observation_age_minutes: args.maxObservationAgeMinutes,
      p_evidence_reference: args.evidenceReference,
      p_basis: args.basis,
    }),

  evaluateEventTime: (connectorId: string, eventTime: string) =>
    call<RpcResult>("evaluate_connector_event_time", {
      p_connector_id: connectorId,
      p_event_time: eventTime,
    }),
};
