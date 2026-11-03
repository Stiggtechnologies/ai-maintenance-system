import { supabase } from "../lib/supabase";

export interface ZoneCrossing {
  allowed: boolean;
  reason: string;
  zoneId?: number | null;
  zoneKey?: string | null;
  purdueLevel?: number | null;
}

export interface NetworkZoneRecord {
  id: number;
  version: number;
  zoneKey: string;
  label: string;
  purdueLevel: number | null;
  egressPermitted: boolean;
  egressRoute: string | null;
  status: "proposed" | "adopted" | "rejected" | "superseded";
  basis: string | null;
  proposedBy: string | null;
  proposedByLabel: string | null;
  decidedBy: string | null;
  decidedByLabel: string | null;
  supersedesZoneId: number | null;
  supersededByZoneId: number | null;
}

export interface ConnectorZoneAssignment {
  id: number;
  version: number;
  connectorKey: string;
  zoneId: number;
  zoneKey: string | null;
  purdueLevel: number | null;
  status: "proposed" | "adopted" | "rejected" | "superseded";
  basis: string | null;
  proposedBy: string | null;
  proposedByLabel: string | null;
  decidedByLabel: string | null;
  supersedesAssignmentId: number | null;
  supersededByAssignmentId: number | null;
}

export interface ZonedConnector {
  connectorKey: string;
  name: string;
  connectorType: string | null;
  direction: string | null;
  enabled: boolean;
  writeEnabled: boolean;
  read: ZoneCrossing;
  write: ZoneCrossing;
}

export interface NetworkSeparationWorkspace {
  unzoned: boolean;
  boundary: string;
  zones: NetworkZoneRecord[];
  assignments: ConnectorZoneAssignment[];
  connectors: ZonedConnector[];
  operationalAuthority: false;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function requireResult(data: unknown, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  return value;
}

export async function getNetworkSeparation(): Promise<NetworkSeparationWorkspace> {
  const { data, error } = await supabase.rpc("get_network_separation");
  const value = requireResult(data, error);
  return {
    unzoned: Boolean(value.unzoned),
    boundary: String(value.boundary ?? ""),
    zones: (value.zones ?? []) as NetworkZoneRecord[],
    assignments: (value.assignments ?? []) as ConnectorZoneAssignment[],
    connectors: (value.connectors ?? []) as ZonedConnector[],
    operationalAuthority: false,
  };
}

export async function proposeNetworkZone(input: {
  zoneKey: string;
  label: string;
  purdueLevel: number;
  egressPermitted: boolean;
  egressRoute: string;
  basis: string;
  supersedesZoneId?: number | null;
}) {
  const { data, error } = await supabase.rpc("propose_network_zone", {
    p_zone_key: input.zoneKey,
    p_label: input.label,
    p_purdue_level: input.purdueLevel,
    p_egress_permitted: input.egressPermitted,
    p_egress_route: input.egressRoute,
    p_basis: input.basis,
    p_supersedes_zone_id: input.supersedesZoneId ?? null,
  });
  return requireResult(data, error);
}

export async function decideNetworkZone(input: {
  zoneId: number;
  decision: "adopt" | "reject";
  reason: string;
}) {
  const { data, error } = await supabase.rpc("decide_network_zone", {
    p_zone_id: input.zoneId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  return requireResult(data, error);
}

export async function proposeConnectorZoneAssignment(input: {
  connectorKey: string;
  zoneId: number;
  basis: string;
  supersedesAssignmentId?: number | null;
}) {
  const { data, error } = await supabase.rpc(
    "propose_connector_zone_assignment",
    {
      p_connector_key: input.connectorKey,
      p_zone_id: input.zoneId,
      p_basis: input.basis,
      p_supersedes_assignment_id: input.supersedesAssignmentId ?? null,
    },
  );
  return requireResult(data, error);
}

export async function decideConnectorZoneAssignment(input: {
  assignmentId: number;
  decision: "adopt" | "reject";
  reason: string;
}) {
  const { data, error } = await supabase.rpc(
    "decide_connector_zone_assignment",
    {
      p_assignment_id: input.assignmentId,
      p_decision: input.decision,
      p_reason: input.reason,
    },
  );
  return requireResult(data, error);
}
