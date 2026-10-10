/**
 * One commercially bounded path for tenant-scoped model calls.
 *
 * The provider result is deliberately returned only after its reservation has
 * been settled. A caller therefore cannot accidentally parse, persist, or
 * present model output whose actual model and token usage were not recorded.
 * Provider failure releases the reservation because no inference completed;
 * settlement failure keeps the conservative reservation in place. A completed
 * paid call with a missing/non-standard pricing-mode witness is settled as an
 * unknown-price breach so the ledger freezes later commercial spend.
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

/**
 * One paid request must stay inside the short-context price envelope shared by
 * every currently proposed commercial model. The UTF-8 byte count is a safe
 * upper bound for BPE input tokens; the extra 28K-token gap below GPT-4o Mini's
 * 128K context window leaves room for message framing and tokenizer variance.
 * GPT-5.6 Terra and Luna do not enter their long-context price tier until the
 * input alone exceeds 272K tokens, so this single bound also excludes that
 * premium tier rather than trying to estimate its cost after the fact.
 */
export const PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS = 8_192;
export const PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND = 100_000;
const PAID_MESSAGE_FRAMING_TOKEN_ALLOWANCE = 1_024;

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

export function paidStandardRateTokenUpperBound(
  options: LlmCallOptions,
): number {
  const promptBytes = new TextEncoder().encode(
    `${options.systemPrompt}\n${options.userContent}`,
  ).byteLength;
  return (
    promptBytes +
    Math.max(0, Math.ceil(options.maxTokens ?? 0)) +
    PAID_MESSAGE_FRAMING_TOKEN_ALLOWANCE
  );
}

function errorDetail(error: unknown): unknown {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "unknown");
  }
  return error;
}

interface PaidStandardRateWitness {
  serviceTier: string | null;
}

/**
 * The OpenAI API defaults an omitted service_tier to `auto`, which can inherit
 * a project-level Fast setting. Bound paid traffic instead requests `default`
 * explicitly and observes the provider-reported tier before exposing output.
 * GPT-5.6 implicit prompt caching is also disabled: without an explicit
 * breakpoint, `mode: explicit` creates no cache write and therefore cannot
 * introduce the 1.25x cache-write input rate into a 1.0-multiplier policy.
 */
function paidStandardRateFetch(
  fetchLike: LlmFetch,
  requestedModel: string,
  witness: PaidStandardRateWitness,
): LlmFetch {
  return async (url, init) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(init.body ?? "")) as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: { code: "commercial_request_body_invalid" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    payload.service_tier = "default";
    if (requestedModel.startsWith("gpt-5.6-")) {
      payload.prompt_cache_options = { mode: "explicit" };
    }
    const response = await fetchLike(url, {
      ...init,
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      try {
        const data = (await response.clone().json()) as Record<string, unknown>;
        witness.serviceTier =
          typeof data.service_tier === "string" ? data.service_tier : null;
      } catch {
        witness.serviceTier = null;
      }
    }
    return response;
  };
}

/**
 * A bound customer-paid plan may spend only through the direct provider whose
 * configured model exactly matches the canonical model approved at quota
 * reservation. Availability failover is intentionally sacrificed here: an
 * opaque gateway or a different direct safety model would invalidate the
 * plan's price and model-policy snapshot.
 */
export function paidCommercialProviders(
  providers: LlmProvider[],
  requestedModel: string,
): LlmProvider[] {
  return providers.filter(
    (provider) =>
      provider.name === "openai-direct" &&
      provider.baseUrl.replace(/\/$/, "") === "https://api.openai.com" &&
      provider.model === requestedModel,
  );
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
  const suppliedEstimate = Number.isFinite(boundary.estimatedTokens)
    ? Math.max(1, Math.ceil(boundary.estimatedTokens))
    : 1;
  const reservationTokenUpperBound = Math.max(
    suppliedEstimate,
    paidStandardRateTokenUpperBound(providerOptions),
  );
  let quota: CommercialRpcResult;
  try {
    quota = await rpc("check_llm_commercial_quota", {
      p_organization_id: boundary.organizationId,
      p_fn: boundary.functionName,
      p_model: boundary.requestedModel,
      p_estimated_tokens: reservationTokenUpperBound,
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

  const hasCommercialPlan =
    typeof verdict.commercialPlanId === "string" &&
    verdict.commercialPlanId.trim().length > 0;
  const requestedOutputTokens = Math.max(
    0,
    Math.ceil(providerOptions.maxTokens ?? 0),
  );
  if (
    hasCommercialPlan &&
    (requestedOutputTokens > PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS ||
      paidStandardRateTokenUpperBound(providerOptions) >
        PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND)
  ) {
    await releaseReservation(rpc, reservationId, boundary.functionName);
    return {
      status: "quota_refused",
      limit: "commercial_standard_rate_envelope_exceeded",
      resetsAt: null,
    };
  }
  const providersForCall = hasCommercialPlan
    ? paidCommercialProviders(providers, boundary.requestedModel)
    : providers;
  if (hasCommercialPlan && providersForCall.length === 0) {
    await releaseReservation(rpc, reservationId, boundary.functionName);
    return {
      status: "provider_failed",
      events: [
        {
          provider: "(commercial-direct-route)",
          outcome: "exhausted",
          status: null,
          detail:
            "No direct provider exactly matches the plan-approved requested model; gateway and cross-model failover are closed for paid traffic.",
        },
      ],
      error: "commercial_direct_route_unavailable",
    };
  }

  let providerResult: LlmResult;
  const paidRouteWitness: PaidStandardRateWitness = { serviceTier: null };
  try {
    providerResult = await callWithResilience(
      hasCommercialPlan
        ? paidStandardRateFetch(
            fetchLike,
            boundary.requestedModel,
            paidRouteWitness,
          )
        : fetchLike,
      providersForCall,
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
  const pricingModeMismatch =
    hasCommercialPlan && paidRouteWitness.serviceTier !== "default";
  let settlement: CommercialRpcResult;
  try {
    settlement = await rpc("record_llm_usage", {
      p_organization_id: boundary.organizationId,
      p_fn: boundary.functionName,
      p_model: providerResult.model ?? boundary.requestedModel,
      p_prompt_tokens: usage.prompt_tokens ?? 0,
      p_completion_tokens: usage.completion_tokens ?? 0,
      p_reservation_id: reservationId,
      p_service_tier: hasCommercialPlan ? paidRouteWitness.serviceTier : null,
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

  if (pricingModeMismatch) {
    // The provider completed inference. The settlement RPC records actual
    // model/tokens, unknown cost and a durable pricing-mode breach that freezes
    // later paid calls. Output remains withheld for operator reconciliation.
    return {
      status: "settlement_failed",
      events: providerResult.events,
      model: providerResult.model,
      error: "commercial_service_tier_mismatch",
    };
  }

  return { status: "ok", result: providerResult };
}
