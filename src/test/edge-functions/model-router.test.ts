// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  edgeBaseEnv,
  edgeRequest,
  installNoNetworkFetch,
  jsonFetchResult,
  loadEdgeFunction,
  readJson,
  type LoadedEdgeFunction,
} from "../support/edgeFunctionHarness";
import { createSupabaseDouble, type SupabaseDouble } from "../support/supabaseQueryMock";

describe("model-router edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/model-router/index.ts", {
      ...edgeBaseEnv,
      OPENAI_API_KEY: "sk-test-openai",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
    edge.env.OPENAI_API_KEY = "sk-test-openai";
    edge.env.ANTHROPIC_API_KEY = "sk-ant-test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, headers?: Record<string, string>) {
    return edge.invoke(edgeRequest("model-router", "", { body, headers }));
  }

  it("answers CORS preflight without selecting a model", async () => {
    const response = await edge.invoke(edgeRequest("model-router", "", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("requires a user id before calling the selector", async () => {
    const response = await post({ task_type: "simple_qa", messages: [] });
    expect(response.status).toBe(400);
    expect(supabase.rpcCalls).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns 404 when no model is selected", async () => {
    supabase.setRpc(() => ({ data: [], error: null }));
    const response = await post({ user_id: "user-1", task_type: "simple_qa", messages: [] });
    expect(response.status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns 500 when the selector fails", async () => {
    supabase.setRpc(() => ({ data: null, error: { message: "selector down" } }));
    const response = await post({ user_id: "user-1", messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toBe("selector down");
  });

  it("sends a reasoning task to the selected OpenAI model and records its cost", async () => {
    supabase.setRpc((_name, args) => {
      expect(args).toMatchObject({
        p_user_id: "user-1",
        p_task_complexity: "reasoning",
        p_data_sensitivity: "internal",
      });
      return {
        data: [{ model_name: "gpt-4o-mini", model_provider: "openai", selection_reason: "cost" }],
        error: null,
      };
    });
    supabase.setFrom((call) => {
      if (call.op === "insert") return { data: { id: "sess-1" }, error: null };
      return { error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
      return jsonFetchResult({
        choices: [{ message: { content: "check the coupling" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
      });
    }));
    const response = await post({
      user_id: "user-1",
      task_type: "root_cause_analysis",
      messages: [{ role: "user", content: "Why did the pump trip?" }],
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      provider: "openai",
      response: "check the coupling",
      session_id: "sess-1",
    });
    const update = supabase.calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({ total_tokens: 2000 });
    expect((update?.payload as { total_cost: number }).total_cost).toBeCloseTo(0.00075, 8);
  });

  it("calls Anthropic with the server key and maps token usage", async () => {
    supabase.setRpc(() => ({
      data: [{ model_name: "claude-3-5-haiku", model_provider: "anthropic", selection_reason: "speed" }],
      error: null,
    }));
    supabase.setFrom((call) => (call.op === "insert" ? { data: { id: "sess-2" }, error: null } : { error: null }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.anthropic.com/v1/messages");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
      const sent = JSON.parse(String(init?.body));
      expect(sent.messages).toEqual([{ role: "user", content: "classify" }]);
      expect(sent.system).toBe("be brief");
      return jsonFetchResult({
        content: [{ text: "class-a" }],
        usage: { input_tokens: 10, output_tokens: 4 },
      });
    }));
    const response = await post({
      user_id: "user-1",
      task_type: "classification",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "classify" },
      ],
    });
    const body = await readJson(response);
    expect(body.response).toBe("class-a");
    expect(body.usage.total_tokens).toBe(14);
  });

  it("returns the provider error and does not invent a completion", async () => {
    supabase.setRpc(() => ({
      data: [{ model_name: "gpt-4o-mini", model_provider: "openai", selection_reason: "cost" }],
      error: null,
    }));
    supabase.setFrom((call) => (call.op === "insert" ? { data: { id: "sess-3" }, error: null } : { error: null }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 503 })));
    const response = await post({
      user_id: "user-1",
      task_type: "simple_qa",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/OpenAI API error: 503/);
  });

  it("reports a missing provider key and an unsupported provider", async () => {
    edge.env.OPENAI_API_KEY = undefined;
    supabase.setRpc(() => ({
      data: [{ model_name: "gpt-4o-mini", model_provider: "openai", selection_reason: "cost" }],
      error: null,
    }));
    supabase.setFrom((call) => (call.op === "insert" ? { data: { id: "sess-4" }, error: null } : { error: null }));
    const missing = await post({ user_id: "user-1", messages: [{ role: "user", content: "hi" }] });
    expect((await readJson(missing)).error).toMatch(/OpenAI API key not configured/);

    supabase.reset();
    supabase.setRpc(() => ({
      data: [{ model_name: "local", model_provider: "mystery", selection_reason: "none" }],
      error: null,
    }));
    supabase.setFrom((call) => (call.op === "insert" ? { data: { id: "sess-5" }, error: null } : { error: null }));
    const unsupported = await post({ user_id: "user-1", messages: [{ role: "user", content: "hi" }] });
    expect((await readJson(unsupported)).error).toMatch(/Unsupported provider: mystery/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  // BUG: supabase/functions/model-router/index.ts:14-27 trusts user_id from the
  // body and calls the provider with the server key. There is no Authorization
  // check. Impact: an anonymous caller can spend the LLM budget and write
  // runtime_sessions for any user id.
  it.fails("BUG: a route without a bearer token is rejected before the provider is called", async () => {
    supabase.setRpc(() => ({
      data: [{ model_name: "gpt-4o-mini", model_provider: "openai", selection_reason: "cost" }],
      error: null,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })));
    const response = await post({ user_id: "user-victim", messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(supabase.rpcCalls).toHaveLength(0);
  });
});
