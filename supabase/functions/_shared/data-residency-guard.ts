/**
 * Fail-closed client for the canonical tenant residency decision.
 *
 * The database owns the declaration, the binding and the audit row. Callers
 * pass only the path kind and the identifier they are about to use. A missing
 * decision, a transport error, or allowed !== true is a refusal.
 */

export type ResidencyPathKind =
  | "storage"
  | "processing"
  | "connector"
  | "ai_provider";

interface RpcError {
  message?: string;
}

export interface ResidencyRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export interface ResidencyDecision {
  allowed?: boolean;
  reason?: string;
}

export class DataResidencyDeniedError extends Error {
  readonly code = "data_residency_denied";
  readonly destination: string;
  readonly reason: string;

  constructor(destination: string, reason: string) {
    super(`Data residency denied for ${destination}: ${reason}`);
    this.name = "DataResidencyDeniedError";
    this.destination = destination;
    this.reason = reason;
  }
}

export async function dataResidencyDenial(
  client: ResidencyRpcClient,
  pathKind: ResidencyPathKind,
  pathRef: string,
  options?: { organizationId?: string; serviceLabel?: string },
): Promise<string | null> {
  const service = Boolean(options?.organizationId);
  const args: Record<string, unknown> = {
    p_path_kind: pathKind,
    p_path_ref: pathRef,
  };
  if (service) {
    args.p_organization_id = options?.organizationId;
    args.p_service_label = options?.serviceLabel ?? "edge-function";
  }
  const { data, error } = await client.rpc(
    service ? "authorize_service_data_residency" : "authorize_data_residency",
    args,
  );
  if (error) {
    return `residency_authorization_unavailable:${error.message ?? "unknown"}`;
  }
  const decision = data as ResidencyDecision | null;
  if (decision?.allowed !== true) {
    return decision?.reason ?? "residency_refused";
  }
  return null;
}
