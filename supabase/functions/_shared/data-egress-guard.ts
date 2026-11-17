/**
 * Fail-closed edge guard for the canonical data_egress_rules register.
 *
 * The database owns policy, tenant resolution and the durable decision receipt.
 * This adapter owns the last safe point before an outbound provider fetch. It
 * never sends payload content to the authorization RPC and never converts an
 * authorization failure into an allow.
 */

export type DataClass =
  | "operational"
  | "personal"
  | "commercial"
  | "safety_critical"
  | "security_sensitive";

export type EgressPurpose =
  | "model_inference"
  | "embedding"
  | "document_extraction"
  | "realtime_voice"
  | "speech_synthesis"
  | "onboarding_enrichment"
  | "agent_enrichment";

interface RpcError {
  message?: string;
}

export interface EgressRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export interface DataEgressContext {
  organizationId?: string;
  dataClass: DataClass;
  purpose: EgressPurpose;
  redactionApplied?: boolean;
  serviceLabel?: string;
}

export interface DataEgressDecision {
  allowed?: boolean;
  reason?: string;
  ruleId?: number | null;
  ruleVersion?: number | null;
  redactionRequired?: boolean;
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class DataEgressDeniedError extends Error {
  readonly code = "data_egress_denied";
  readonly destination: string;
  readonly reason: string;

  constructor(destination: string, reason: string) {
    super(`Data egress denied for ${destination}: ${reason}`);
    this.name = "DataEgressDeniedError";
    this.destination = destination;
    this.reason = reason;
  }
}

export function exactDestinationHostname(url: string | URL): string {
  const parsed = url instanceof URL ? url : new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new DataEgressDeniedError(
      parsed.hostname || "invalid",
      "exact_https_destination_required",
    );
  }
  return parsed.hostname.toLowerCase();
}

export async function authorizeDataEgress(
  client: EgressRpcClient,
  destination: string,
  context: DataEgressContext,
): Promise<DataEgressDecision> {
  const service = Boolean(context.organizationId);
  const rpcName = service
    ? "authorize_service_data_egress"
    : "authorize_data_egress";
  const args: Record<string, unknown> = {
    p_destination: destination,
    p_data_class: context.dataClass,
    p_purpose: context.purpose,
    p_redaction_applied: context.redactionApplied === true,
  };
  if (service) {
    args.p_organization_id = context.organizationId;
    args.p_service_label = context.serviceLabel ?? "edge-function";
  }

  const { data, error } = await client.rpc(rpcName, args);
  if (error) {
    throw new DataEgressDeniedError(
      destination,
      `authorization_unavailable:${error.message ?? "unknown"}`,
    );
  }
  const decision = data as DataEgressDecision | null;
  if (decision?.allowed !== true) {
    throw new DataEgressDeniedError(
      destination,
      decision?.reason ?? "authorization_refused",
    );
  }
  return decision;
}

/**
 * Wrap a provider fetch at request scope. One authorization is retained by the
 * database per exact destination; retries to that same destination reuse it.
 * A fallback provider has a different hostname and must pass independently.
 */
export function withDataEgressGuard(
  fetchLike: FetchLike,
  client: EgressRpcClient,
  context: DataEgressContext,
): FetchLike {
  const decisions = new Map<string, Promise<DataEgressDecision>>();
  return async (url, init) => {
    const destination = exactDestinationHostname(url);
    let decision = decisions.get(destination);
    if (!decision) {
      decision = authorizeDataEgress(client, destination, context);
      decisions.set(destination, decision);
    }
    try {
      await decision;
    } catch (error) {
      const reason =
        error instanceof DataEgressDeniedError
          ? error.reason
          : "authorization_refused";
      return new Response(
        JSON.stringify({
          error: { code: "data_egress_denied", destination, reason },
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return fetchLike(url, init);
  };
}
