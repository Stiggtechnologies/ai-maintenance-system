import { describe, expect, it, vi } from "vitest";
import {
  callWithCommercialBoundary,
  estimateLlmCallTokens,
  paidCommercialProviders,
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

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "gpt-4o-mini-2024-07-18",
      choices: [{ message: { content: "bounded answer" } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("commercial LLM usage boundary", () => {
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
      });
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
