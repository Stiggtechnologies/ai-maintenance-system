/**
 * Tests the EXACT file the edge functions deploy — supabase/functions/_shared/
 * llm-provider.ts is Deno-free precisely so vitest can hold it. The previous
 * edge change shipped untypechecked because Deno is not installed locally;
 * this module cannot ship untested.
 */
import { describe, expect, it } from "vitest";
import {
  buildProviderChain,
  callWithResilience,
  type LlmProvider,
} from "../../../supabase/functions/_shared/llm-provider";

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
});
