/**
 * Tests the EXACT file the edge functions deploy — supabase/functions/_shared/
 * llm-provider.ts is Deno-free precisely so vitest can hold it. The previous
 * edge change shipped untypechecked because Deno is not installed locally;
 * this module cannot ship untested.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildProviderChain,
  callWithResilience,
  resetParamMemo,
  resolveExternalGatewayUrl,
  type LlmProvider,
} from "../../../supabase/functions/_shared/llm-provider";

// The rejection memo persists across calls by design, so every test starts
// from a cold instance rather than inheriting the previous test's discovery.
beforeEach(resetParamMemo);

const gateway: LlmProvider = {
  name: "stigg-gateway",
  baseUrl: "https://stigg-ai-gateway.fly.dev",
  apiKey: "sk-virtual",
  model: "stigg/fast",
};
const openai: LlmProvider = {
  name: "openai-direct",
  baseUrl: "https://api.openai.com",
  apiKey: "sk-real",
  model: "gpt-4o-mini",
};

const OPTS = { systemPrompt: "s", userContent: "u", backoffMs: 1 };
const noSleep = () => Promise.resolve();

describe("resolveExternalGatewayUrl", () => {
  it("recognizes only the exact OpenAI hostname", () => {
    expect(resolveExternalGatewayUrl("https://api.openai.com")).toBeUndefined();
    expect(
      resolveExternalGatewayUrl("https://api.openai.com.attacker.example"),
    ).toBe("https://api.openai.com.attacker.example");
  });

  it("rejects malformed and non-HTTPS gateway URLs", () => {
    expect(resolveExternalGatewayUrl("not a URL")).toBeUndefined();
    expect(resolveExternalGatewayUrl("http://gateway.example")).toBeUndefined();
    expect(resolveExternalGatewayUrl("https://gateway.example/v1/")).toBe(
      "https://gateway.example/v1",
    );
  });
});

function respond(status: number, content = "answer"): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { total_tokens: 10 },
    }),
    { status },
  );
}

describe("callWithResilience", () => {
  it("succeeds first attempt with a single clean event", async () => {
    const r = await callWithResilience(
      async () => respond(200),
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.content).toBe("answer");
    expect(r.provider).toBe("openai-direct");
    expect(r.events).toEqual([
      {
        provider: "openai-direct",
        outcome: "ok",
        status: 200,
        detail: "first attempt",
      },
    ]);
  });

  it("retries a 503 on the SAME provider and records both attempts", async () => {
    let calls = 0;
    const r = await callWithResilience(
      async () => (++calls === 1 ? respond(503) : respond(200)),
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(r.events.map((e) => e.outcome)).toEqual(["retried", "ok"]);
    expect(r.events[1].detail).toBe("succeeded on attempt 2");
  });

  it("fails over IMMEDIATELY on 401 — retrying auth errors wastes the timeout", async () => {
    const hits: string[] = [];
    const r = await callWithResilience(
      async (url) => {
        hits.push(new URL(url).hostname);
        return url.includes("fly.dev") ? respond(401) : respond(200);
      },
      [gateway, openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("openai-direct");
    // Exactly ONE gateway hit: fatal means no second attempt there.
    expect(hits.filter((h) => h.includes("fly"))).toHaveLength(1);
    expect(r.events[0].outcome).toBe("failed_over");
    expect(r.events[0].detail).toMatch(
      /not transient; failing over without retry/,
    );
  });

  it("survives the outage that actually happened: gateway NXDOMAIN, month unnoticed", async () => {
    const r = await callWithResilience(
      async (url) => {
        if (url.includes("fly.dev")) throw new TypeError("dns error");
        return respond(200);
      },
      [gateway, openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("openai-direct");
    // The gateway trail is recorded, not swallowed — a month of silence is the
    // failure mode this module exists to end.
    const gwEvents = r.events.filter((e) => e.provider === "stigg-gateway");
    expect(gwEvents.map((e) => e.outcome)).toEqual(["retried", "failed_over"]);
    expect(gwEvents[0].detail).toMatch(/network failure/);
  });

  it("asks each provider for ITS OWN model — a gateway alias means nothing to OpenAI", async () => {
    const models: string[] = [];
    await callWithResilience(
      async (url, init) => {
        models.push(JSON.parse(String(init.body)).model);
        return url.includes("fly.dev") ? respond(500) : respond(200);
      },
      [gateway, openai],
      { ...OPTS, attemptsPerProvider: 1 },
      noSleep,
    );
    expect(models).toEqual(["stigg/fast", "gpt-4o-mini"]);
  });

  it("exhausts honestly: ok false, full trail, never ending in 'retried'", async () => {
    const r = await callWithResilience(
      async () => respond(500),
      [gateway, openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(false);
    expect(r.provider).toBeNull();
    expect(r.events.map((e) => e.outcome)).toEqual([
      "retried",
      "failed_over",
      "retried",
      "exhausted",
    ]);
  });

  it("names an empty chain a configuration gap, not an outage", async () => {
    const r = await callWithResilience(
      async () => respond(200),
      [],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(false);
    expect(r.events[0].detail).toMatch(/configuration gap, not an outage/);
  });

  it("passes jsonMode through as response_format", async () => {
    let body: Record<string, unknown> = {};
    await callWithResilience(
      async (_u, init) => {
        body = JSON.parse(String(init.body));
        return respond(200);
      },
      [openai],
      { ...OPTS, jsonMode: true },
      noSleep,
    );
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});

describe("parameter negotiation — the real production failure", () => {
  // Verbatim from OpenAI when the chain sent temperature 0.3 to gpt-5.6-terra.
  // It classifies as a 400 = fatal, so the chain failed the provider over and
  // enrichment silently ran on the gpt-4o-mini safety net for its first live
  // run. One unsupported optional parameter looked exactly like an outage.
  const TEMP_REJECTION = JSON.stringify({
    error: {
      message:
        "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported.",
      type: "invalid_request_error",
      param: "temperature",
      code: "unsupported_value",
    },
  });

  it("drops the rejected parameter and retries the SAME provider", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const r = await callWithResilience(
      async (_u, init) => {
        const body = JSON.parse(String(init.body));
        sent.push(body);
        return "temperature" in body
          ? new Response(TEMP_REJECTION, { status: 400 })
          : respond(200);
      },
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("openai-direct"); // did NOT fail over
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toHaveProperty("temperature");
    // max_completion_tokens was never rejected, so it must survive.
    expect(sent[1]).toHaveProperty("max_completion_tokens");
  });

  it("does not consume the retry budget on a renegotiation", async () => {
    // attemptsPerProvider 1 still succeeds: the first request was never tried
    // in a form the provider accepts, so it does not count as an attempt.
    const r = await callWithResilience(
      async (_u, init) =>
        "temperature" in JSON.parse(String(init.body))
          ? new Response(TEMP_REJECTION, { status: 400 })
          : respond(200),
      [openai],
      { ...OPTS, attemptsPerProvider: 1 },
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.events.map((e) => e.outcome)).toEqual(["retried", "ok"]);
  });

  it("terminates instead of looping when the provider rejects it again", async () => {
    // A parameter is renegotiated at most once, so a provider that keeps
    // returning the same complaint must still terminate.
    let calls = 0;
    const r = await callWithResilience(
      async () => {
        calls++;
        return new Response(TEMP_REJECTION, { status: 400 });
      },
      [openai],
      { ...OPTS, attemptsPerProvider: 2 },
      noSleep,
    );
    expect(r.ok).toBe(false);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("leaves a genuine auth failure fatal — negotiation is narrow", async () => {
    const r = await callWithResilience(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "Incorrect API key", code: "invalid_api_key" },
          }),
          { status: 401 },
        ),
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(false);
    expect(r.events[0].outcome).toBe("exhausted");
  });

  it("puts the provider's own words in the health record", async () => {
    // "fatal status 400" is not a diagnosis. Storing only the status is why
    // the production cause took a manual curl to find.
    const r = await callWithResilience(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "model not found" } }),
          {
            status: 404,
          },
        ),
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.events[0].detail).toMatch(/model not found/);
  });

  it("renegotiates ONCE, then remembers — no retry event on every call", async () => {
    // The negotiation fix repeated on every request: a wasted round-trip each
    // time, and a "retried" event on 100% of calls. A health table where noise
    // is constant cannot surface the one failure that matters.
    let requests = 0;
    const call = () =>
      callWithResilience(
        async (_u, init) => {
          requests++;
          return "temperature" in JSON.parse(String(init.body))
            ? new Response(TEMP_REJECTION, { status: 400 })
            : respond(200);
        },
        [openai],
        OPTS,
        noSleep,
      );

    const first = await call();
    expect(first.events.map((e) => e.outcome)).toEqual(["retried", "ok"]);
    expect(requests).toBe(2);

    const second = await call();
    // Clean single event — the discovery is not repeated.
    expect(second.events.map((e) => e.outcome)).toEqual(["ok"]);
    expect(requests).toBe(3);
  });

  it("keeps the memo per MODEL, not just per provider", async () => {
    // Same provider name, different model: gpt-4o-mini accepts temperature
    // even though gpt-5.6 does not, so the rejection must not leak across.
    const strict = { ...openai, model: "gpt-5.6-terra" };
    const sent: Array<{ model: string; hasTemp: boolean }> = [];
    const handler = async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      sent.push({ model: b.model, hasTemp: "temperature" in b });
      return b.model === "gpt-5.6-terra" && "temperature" in b
        ? new Response(TEMP_REJECTION, { status: 400 })
        : respond(200);
    };
    await callWithResilience(handler, [strict], OPTS, noSleep);
    await callWithResilience(handler, [openai], OPTS, noSleep);

    const mini = sent.filter((x) => x.model === "gpt-4o-mini");
    expect(mini).toHaveLength(1);
    expect(mini[0].hasTemp).toBe(true);
  });

  it("re-offers a dropped parameter to the NEXT provider", async () => {
    // What GPT-5.x refuses, the gateway may require. `dropped` is per-provider.
    const seen: Array<{ host: string; hasTemp: boolean }> = [];
    await callWithResilience(
      async (url, init) => {
        const body = JSON.parse(String(init.body));
        seen.push({
          host: new URL(url).hostname,
          hasTemp: "temperature" in body,
        });
        return url.includes("fly.dev") && "temperature" in body
          ? new Response(TEMP_REJECTION, { status: 400 })
          : url.includes("fly.dev")
            ? new Response("{}", { status: 500 })
            : respond(200);
      },
      [gateway, openai],
      { ...OPTS, attemptsPerProvider: 1 },
      noSleep,
    );
    const openaiCalls = seen.filter((x) => x.host.includes("openai"));
    expect(openaiCalls[0].hasTemp).toBe(true);
  });
});

describe("the answering model is what gets recorded", () => {
  it("reports the model the API says it used, not the one requested", async () => {
    // A gateway alias resolves to a concrete model server-side. Recording the
    // alias would put a false provenance claim into a signed record.
    const r = await callWithResilience(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "a" } }],
            model: "claude-sonnet-5",
          }),
          { status: 200 },
        ),
      [gateway],
      OPTS,
      noSleep,
    );
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.model).not.toBe("stigg/fast");
  });

  it("after failover, reports the FALLBACK's model — the whole point", async () => {
    const r = await callWithResilience(
      async (url) => (url.includes("fly.dev") ? respond(401) : respond(200)),
      [gateway, openai],
      OPTS,
      noSleep,
    );
    expect(r.provider).toBe("openai-direct");
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("falls back to the provider's configured model when the API omits one", async () => {
    const r = await callWithResilience(
      async () => respond(200),
      [openai],
      OPTS,
      noSleep,
    );
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("reports no model when nothing answered", async () => {
    const r = await callWithResilience(
      async () => respond(500),
      [openai],
      { ...OPTS, attemptsPerProvider: 1 },
      noSleep,
    );
    expect(r.ok).toBe(false);
    expect(r.model).toBeNull();
  });
});

describe("buildProviderChain", () => {
  it("leads with the gateway when configured, OpenAI as fallback", () => {
    const c = buildProviderChain({
      gatewayUrl: "https://g",
      gatewayKey: "k",
      openaiKey: "o",
    });
    expect(c.map((p) => p.name)).toEqual(["stigg-gateway", "openai-direct"]);
  });

  it("degrades to OpenAI-only when the gateway is unconfigured — today's reality", () => {
    const c = buildProviderChain({ openaiKey: "o", openaiModel: "gpt-4o" });
    expect(c.map((p) => p.name)).toEqual(["openai-direct"]);
    expect(c[0].model).toBe("gpt-4o");
  });

  it("a gateway URL without a key is not half a provider", () => {
    const c = buildProviderChain({ gatewayUrl: "https://g", openaiKey: "o" });
    expect(c.map((p) => p.name)).toEqual(["openai-direct"]);
  });

  it("returns an empty chain when nothing is configured", () => {
    expect(buildProviderChain({})).toEqual([]);
  });

  it("appends a safety-net model so a frontier default cannot go dark", () => {
    // Betting the chain on this key having gpt-5.6 access is the risk; an
    // unavailable model 404s, which is fatal, so the drop must be instant.
    const c = buildProviderChain({
      openaiKey: "o",
      openaiModel: "gpt-5.6-terra",
      openaiSafetyModel: "gpt-4o-mini",
    });
    expect(c.map((p) => p.model)).toEqual(["gpt-5.6-terra", "gpt-4o-mini"]);
    expect(c.map((p) => p.name)).toEqual(["openai-direct", "openai-safety"]);
  });

  it("does not duplicate the provider when the safety net equals the primary", () => {
    const c = buildProviderChain({
      openaiKey: "o",
      openaiModel: "gpt-4o-mini",
      openaiSafetyModel: "gpt-4o-mini",
    });
    expect(c).toHaveLength(1);
  });

  it("an unavailable frontier model degrades instead of going dark", async () => {
    const chain = buildProviderChain({
      openaiKey: "o",
      openaiModel: "gpt-5.6-terra",
      openaiSafetyModel: "gpt-4o-mini",
    });
    const r = await callWithResilience(
      async (_u, init) =>
        JSON.parse(String(init.body)).model === "gpt-5.6-terra"
          ? respond(404)
          : respond(200),
      chain,
      OPTS,
      noSleep,
    );
    expect(r.ok).toBe(true);
    expect(r.model).toBe("gpt-4o-mini");
    expect(r.events[0].outcome).toBe("failed_over");
  });
});
