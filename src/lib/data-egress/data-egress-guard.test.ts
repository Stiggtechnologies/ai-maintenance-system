import { describe, expect, it, vi } from "vitest";
import {
  exactDestinationHostname,
  withDataEgressGuard,
} from "../../../supabase/functions/_shared/data-egress-guard";

describe("tenant data-egress guard", () => {
  it("normalizes only an exact HTTPS destination hostname", () => {
    expect(
      exactDestinationHostname(
        "https://Api.OpenAI.com/v1/chat/completions?ignored=true",
      ),
    ).toBe("api.openai.com");
    expect(() => exactDestinationHostname("http://api.openai.com/v1")).toThrow(
      "exact_https_destination_required",
    );
    expect(() =>
      exactDestinationHostname("https://api.openai.com:8443/v1"),
    ).toThrow("exact_https_destination_required");
  });

  it("does not open the provider connection when the rule denies", async () => {
    const provider = vi.fn(async () => new Response("provider"));
    const rpc = vi.fn(async () => ({
      data: { allowed: false, reason: "no_current_matching_rule" },
      error: null,
    }));
    const guarded = withDataEgressGuard(
      provider,
      { rpc },
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        dataClass: "operational",
        purpose: "model_inference",
        serviceLabel: "test",
      },
    );

    const response = await guarded(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "data_egress_denied",
        destination: "api.openai.com",
        reason: "no_current_matching_rule",
      },
    });
    expect(provider).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("authorize_service_data_egress", {
      p_organization_id: "11111111-1111-4111-8111-111111111111",
      p_destination: "api.openai.com",
      p_data_class: "operational",
      p_purpose: "model_inference",
      p_redaction_applied: false,
      p_service_label: "test",
    });
  });

  it("authorizes before fetch and reuses one decision for same-host retries", async () => {
    const order: string[] = [];
    const provider = vi.fn(async () => {
      order.push("fetch");
      return new Response("ok", { status: 200 });
    });
    const rpc = vi.fn(async () => {
      order.push("authorize");
      return { data: { allowed: true, ruleId: 7 }, error: null };
    });
    const guarded = withDataEgressGuard(
      provider,
      { rpc },
      {
        dataClass: "commercial",
        purpose: "model_inference",
      },
    );

    expect((await guarded("https://gateway.example.com/v1/a")).status).toBe(
      200,
    );
    expect((await guarded("https://gateway.example.com/v1/b")).status).toBe(
      200,
    );
    expect(order).toEqual(["authorize", "fetch", "fetch"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("re-authorizes a fallback hostname and can refuse it independently", async () => {
    const provider = vi.fn(async () => new Response("ok", { status: 200 }));
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_destination === "gateway.example.com"
          ? { allowed: true, ruleId: 7 }
          : { allowed: false, reason: "no_current_matching_rule" },
      error: null,
    }));
    const guarded = withDataEgressGuard(
      provider,
      { rpc },
      { dataClass: "security_sensitive", purpose: "model_inference" },
    );

    expect(
      (await guarded("https://gateway.example.com/v1/responses")).status,
    ).toBe(200);
    expect((await guarded("https://api.openai.com/v1/responses")).status).toBe(
      403,
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the authorization RPC is unavailable", async () => {
    const provider = vi.fn(async () => new Response("provider"));
    const guarded = withDataEgressGuard(
      provider,
      {
        rpc: async () => ({
          data: null,
          error: { message: "database offline" },
        }),
      },
      { dataClass: "operational", purpose: "speech_synthesis" },
    );

    const response = await guarded("https://api.openai.com/v1/audio/speech");
    expect(response.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
});
