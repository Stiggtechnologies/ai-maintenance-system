import { describe, expect, it, vi } from "vitest";
import {
  callWithCommercialBoundary,
  estimateLlmCallTokens,
  paidStandardRateTokenUpperBound,
  paidCommercialProviders,
  PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS,
  PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND,
  type CommercialRpc,
} from "../../supabase/functions/_shared/llm-commercial-usage";

const provider = {
  name: "test-provider",
  baseUrl: "https://provider.example",
  apiKey: "test-key",
  model: "gpt-4o-mini",
};

const options = {
  systemPrompt: "Be concise.",
  userContent: "Assess this decision.",
  maxTokens: 100,
  attemptsPerProvider: 1,
  backoffMs: 0,
};

const boundary = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  functionName: "bounded-test-agent",
  requestedModel: "gpt-4o-mini",
  estimatedTokens: estimateLlmCallTokens(options),
  costObject: { type: "development_case", id: "case-1" },
};

function successResponse(
  model = "gpt-4o-mini-2024-07-18",
  serviceTier = "default",
): Response {
  return new Response(
    JSON.stringify({
      model,
      service_tier: serviceTier,
      choices: [{ message: { content: "bounded answer" } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("commercial LLM usage boundary", () => {
  it("uses a UTF-8 byte upper bound for the paid standard-rate envelope", () => {
    const bounded = {
      ...options,
      systemPrompt: "é",
      userContent: "水",
      maxTokens: 7,
    };
    expect(paidStandardRateTokenUpperBound(bounded)).toBe(1_037);
    expect(PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS).toBe(8_192);
    expect(PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND).toBe(100_000);
  });

  it("pins a bound paid plan to the exact direct model and excludes the gateway", async () => {
    const gateway = {
      name: "stigg-gateway",
      baseUrl: "https://gateway.example",
      apiKey: "gateway-key",
      model: "stigg/fast",
    };
    const direct = {
      name: "openai-direct",
      baseUrl: "https://api.openai.com",
      apiKey: "direct-key",
      model: "gpt-4o-mini",
    };
    const safety = {
      ...direct,
      name: "openai-safety",
      model: "gpt-5.6-luna",
    };
    expect(
      paidCommercialProviders([gateway, safety, direct], "gpt-4o-mini"),
    ).toEqual([direct]);

    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 40,
              commercialPlanId: "professional",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "gpt-4o-mini",
        service_tier: "default",
      });
      expect(JSON.parse(String(init.body))).not.toHaveProperty(
        "prompt_cache_options",
      );
      return successResponse();
    });

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [gateway, safety, direct],
      options,
      boundary,
    );

    expect(result.status).toBe("ok");
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it("pins GPT-5.6 paid calls to Standard processing without implicit cache writes", async () => {
    const terraBoundary = { ...boundary, requestedModel: "gpt-5.6-terra" };
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 45,
              commercialPlanId: "enterprise",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "gpt-5.6-terra",
        service_tier: "default",
        prompt_cache_options: { mode: "explicit" },
      });
      return successResponse("gpt-5.6-terra", "default");
    });

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          ...provider,
          name: "openai-direct",
          baseUrl: "https://api.openai.com",
          model: "gpt-5.6-terra",
        },
      ],
      options,
      terraBoundary,
    );

    expect(result.status).toBe("ok");
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it("withholds paid output and retains the reservation when the provider reports a non-Standard tier", async () => {
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 46,
              commercialPlanId: "starter",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async () => successResponse("gpt-4o-mini", "fast"));

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          ...provider,
          name: "openai-direct",
          baseUrl: "https://api.openai.com",
        },
      ],
      options,
      boundary,
    );

    expect(result).toMatchObject({
      status: "settlement_failed",
      error: "commercial_service_tier_mismatch",
      model: "gpt-4o-mini",
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "release_llm_reservation",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith("record_llm_usage", expect.anything());
  });

  it("retains gateway-first resilience for an unbound engineering call", async () => {
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? { allowed: true, reservation_id: 39 }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://gateway.example/v1/chat/completions");
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "stigg/fast",
      });
      return successResponse();
    });

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          name: "stigg-gateway",
          baseUrl: "https://gateway.example",
          apiKey: "gateway-key",
          model: "stigg/fast",
        },
        {
          name: "openai-direct",
          baseUrl: "https://api.openai.com",
          apiKey: "direct-key",
          model: "gpt-4o-mini",
        },
      ],
      options,
      boundary,
    );

    expect(result.status).toBe("ok");
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation without provider spend when a paid plan has no exact direct route", async () => {
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 41,
              commercialPlanId: "starter",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async () => successResponse());
    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          ...provider,
          name: "stigg-gateway",
          baseUrl: "https://gateway.example",
          model: "stigg/fast",
        },
      ],
      options,
      boundary,
    );

    expect(result).toMatchObject({
      status: "provider_failed",
      error: "commercial_direct_route_unavailable",
    });
    expect(fetchLike).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("release_llm_reservation", {
      p_reservation_id: 41,
    });
  });

  it("releases the reservation without provider spend when a paid call exceeds the standard-rate envelope", async () => {
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 43,
              commercialPlanId: "enterprise",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async () => successResponse());
    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          ...provider,
          name: "openai-direct",
          baseUrl: "https://api.openai.com",
        },
      ],
      {
        ...options,
        maxTokens: PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS + 1,
      },
      boundary,
    );

    expect(result).toEqual({
      status: "quota_refused",
      limit: "commercial_standard_rate_envelope_exceeded",
      resetsAt: null,
    });
    expect(fetchLike).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("release_llm_reservation", {
      p_reservation_id: 43,
    });
  });

  it("refuses an oversized paid prompt even when its output ceiling is small", async () => {
    const rpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? {
              allowed: true,
              reservation_id: 44,
              commercialPlanId: "professional",
            }
          : null,
      error: null,
    }));
    const fetchLike = vi.fn(async () => successResponse());
    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [
        {
          ...provider,
          name: "openai-direct",
          baseUrl: "https://api.openai.com",
        },
      ],
      {
        ...options,
        userContent: "x".repeat(PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND),
        maxTokens: 1,
      },
      boundary,
    );

    expect(result).toMatchObject({
      status: "quota_refused",
      limit: "commercial_standard_rate_envelope_exceeded",
    });
    expect(fetchLike).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("release_llm_reservation", {
      p_reservation_id: 44,
    });
  });

  it("reserves before provider spend and settles actual usage before exposing output", async () => {
    const order: string[] = [];
    const rpc: CommercialRpc = vi.fn(async (name, args) => {
      order.push(name);
      if (name === "check_llm_commercial_quota") {
        expect(args).toMatchObject({
          p_model: "gpt-4o-mini",
          p_cost_object_type: "development_case",
          p_cost_object_id: "case-1",
        });
        return { data: { allowed: true, reservation_id: 42 }, error: null };
      }
      expect(name).toBe("record_llm_usage");
      expect(args).toMatchObject({
        p_model: "gpt-4o-mini-2024-07-18",
        p_prompt_tokens: 20,
        p_completion_tokens: 5,
        p_reservation_id: 42,
      });
      return { data: null, error: null };
    });
    const fetchLike = vi.fn(async () => {
      order.push("provider");
      return successResponse();
    });

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [provider],
      options,
      boundary,
    );

    expect(result.status).toBe("ok");
    expect(order).toEqual([
      "check_llm_commercial_quota",
      "provider",
      "record_llm_usage",
    ]);
  });

  it("does not contact a provider when the commercial gate refuses", async () => {
    const rpc: CommercialRpc = vi.fn(async () => ({
      data: { allowed: false, limit: "max_tokens_per_commercial_period" },
      error: null,
    }));
    const fetchLike = vi.fn(async () => successResponse());

    const result = await callWithCommercialBoundary(
      rpc,
      fetchLike,
      [provider],
      options,
      boundary,
    );

    expect(result).toMatchObject({
      status: "quota_refused",
      limit: "max_tokens_per_commercial_period",
    });
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it("releases only provider failures and retains the reservation on settlement failure", async () => {
    const failedProviderRpc: CommercialRpc = vi.fn(async (name) => ({
      data:
        name === "check_llm_commercial_quota"
          ? { allowed: true, reservation_id: 7 }
          : null,
      error: null,
    }));
    const providerFailure = await callWithCommercialBoundary(
      failedProviderRpc,
      vi.fn(async () => new Response("unavailable", { status: 503 })),
      [provider],
      options,
      boundary,
    );
    expect(providerFailure.status).toBe("provider_failed");
    expect(failedProviderRpc).toHaveBeenCalledWith("release_llm_reservation", {
      p_reservation_id: 7,
    });

    const settlementRpc: CommercialRpc = vi.fn(async (name) => {
      if (name === "check_llm_commercial_quota") {
        return { data: { allowed: true, reservation_id: 8 }, error: null };
      }
      if (name === "record_llm_usage") {
        return { data: null, error: { message: "ledger unavailable" } };
      }
      return { data: null, error: null };
    });
    const settlementFailure = await callWithCommercialBoundary(
      settlementRpc,
      vi.fn(async () => successResponse()),
      [provider],
      options,
      boundary,
    );
    expect(settlementFailure.status).toBe("settlement_failed");
    expect(settlementRpc).not.toHaveBeenCalledWith(
      "release_llm_reservation",
      expect.anything(),
    );
    expect(settlementFailure).not.toHaveProperty("result");
  });
});
