/**
 * One commercially bounded path for tenant-scoped model calls.
 *
 * The provider result is deliberately returned only after its reservation has
 * been settled. A caller therefore cannot accidentally parse, persist, or
 * present model output whose actual model and token usage were not recorded.
 * Provider failure releases the reservation because no inference completed;
 * settlement failure keeps the conservative reservation in place.
 */

import {
  callWithResilience,
  type LlmCallOptions,
  type LlmProvider,
  type LlmResult,
  type ProviderEvent,
} from "./llm-provider.ts";

type LlmFetch = Parameters<typeof callWithResilience>[0];

/** Canonical priced fallback used by provider-chain callers with no override. */
export const DEFAULT_COMMERCIALLY_PRICED_MODEL = "gpt-4o-mini";

export interface CommercialRpcResult {
  data: unknown;
  error: unknown;
}

export type CommercialRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<CommercialRpcResult>;

export interface CommercialUsageBoundary {
  organizationId: string;
  functionName: string;
  requestedModel: string;
  estimatedTokens: number;
  costObject: {
    type: string;
    id: string;
  };
}

interface RefusalMetadata {
  limit: string;
  resetsAt: string | null;
}

export type CommercialLlmCallResult =
  | { status: "ok"; result: LlmResult }
  | ({ status: "quota_refused" } & RefusalMetadata)
  | {
      status: "provider_failed";
      events: ProviderEvent[];
      error: unknown | null;
    }
  | {
      status: "settlement_failed";
      events: ProviderEvent[];
      model: string | null;
      error: unknown;
    };

/**
 * Deliberately conservative before-spend estimate. English technical prompts
 * are ordinarily nearer four characters per token; two UTF-16 code units per
 * token plus the full output ceiling leaves headroom without inspecting or
 * retaining prompt content.
 */
export function estimateLlmCallTokens(options: LlmCallOptions): number {
  const inputCodeUnits =
    options.systemPrompt.length + options.userContent.length;
  return Math.max(
    1,
    Math.ceil(inputCodeUnits / 2) + Math.max(0, options.maxTokens ?? 0),
  );
}

function errorDetail(error: unknown): unknown {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "unknown");
  }
  return error;
}

async function releaseReservation(
  rpc: CommercialRpc,
  reservationId: number,
  functionName: string,
): Promise<void> {
  try {
    const { error } = await rpc("release_llm_reservation", {
      p_reservation_id: reservationId,
    });
    if (error) {
      console.error(`${functionName} reservation release failed`, {
        reservationId,
        error: errorDetail(error),
      });
    }
  } catch (error) {
    // A leaked reservation overcounts the allowance. That is the safe failure
    // direction after a provider failure: capacity can be restored manually,
    // but unbounded spend cannot occur.
    console.error(`${functionName} reservation release failed`, {
      reservationId,
      error: errorDetail(error),
    });
  }
}

export async function callWithCommercialBoundary(
  rpc: CommercialRpc,
  fetchLike: LlmFetch,
  providers: LlmProvider[],
  providerOptions: LlmCallOptions,
  boundary: CommercialUsageBoundary,
): Promise<CommercialLlmCallResult> {
  let quota: CommercialRpcResult;
  try {
    quota = await rpc("check_llm_commercial_quota", {
      p_organization_id: boundary.organizationId,
      p_fn: boundary.functionName,
      p_model: boundary.requestedModel,
      p_estimated_tokens: Math.max(1, Math.ceil(boundary.estimatedTokens)),
      p_cost_object_type: boundary.costObject.type,
      p_cost_object_id: boundary.costObject.id,
    });
  } catch {
    return {
      status: "quota_refused",
      limit: "quota_check_unavailable",
      resetsAt: null,
    };
  }

  const verdict = (quota.data ?? {}) as Record<string, unknown>;
  const reservationId = Number(verdict.reservation_id);
  if (
    quota.error ||
    verdict.allowed !== true ||
    !Number.isSafeInteger(reservationId) ||
    reservationId <= 0
  ) {
    return {
      status: "quota_refused",
      limit: quota.error
        ? "quota_check_unavailable"
        : String(verdict.limit ?? "quota_check_unavailable"),
      resetsAt:
        typeof verdict.resets_at === "string" ? verdict.resets_at : null,
    };
  }

  let providerResult: LlmResult;
  try {
    providerResult = await callWithResilience(
      fetchLike,
      providers,
      providerOptions,
    );
  } catch (error) {
    await releaseReservation(rpc, reservationId, boundary.functionName);
    return {
      status: "provider_failed",
      events: [],
      error,
    };
  }

  if (!providerResult.ok) {
    await releaseReservation(rpc, reservationId, boundary.functionName);
    return {
      status: "provider_failed",
      events: providerResult.events,
      error: null,
    };
  }

  const usage = providerResult.usage ?? {};
  let settlement: CommercialRpcResult;
  try {
    settlement = await rpc("record_llm_usage", {
      p_organization_id: boundary.organizationId,
      p_fn: boundary.functionName,
      p_model: providerResult.model ?? boundary.requestedModel,
      p_prompt_tokens: usage.prompt_tokens ?? 0,
      p_completion_tokens: usage.completion_tokens ?? 0,
      p_reservation_id: reservationId,
    });
  } catch (error) {
    return {
      status: "settlement_failed",
      events: providerResult.events,
      model: providerResult.model,
      error,
    };
  }
  if (settlement.error) {
    return {
      status: "settlement_failed",
      events: providerResult.events,
      model: providerResult.model,
      error: settlement.error,
    };
  }

  return { status: "ok", result: providerResult };
}
