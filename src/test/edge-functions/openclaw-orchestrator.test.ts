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

describe("openclaw-orchestrator edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/openclaw-orchestrator/index.ts", {
      ...edgeBaseEnv,
      OPENAI_API_KEY: "sk-test-openai",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble((call) => {
      if (call.op === "insert") return { data: { id: "row-1", ...(call.payload as object) }, error: null };
      if (call.op === "update") return { error: null };
      if (call.op === "select") return { data: [], error: null };
      return { error: null };
    });
    edge.createClient = supabase.createClient;
    edge.env.OPENAI_API_KEY = "sk-test-openai";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, headers?: Record<string, string>) {
    return edge.invoke(edgeRequest("openclaw-orchestrator", "", { body, headers }));
  }

  it("answers CORS preflight and rejects an unknown action", async () => {
    expect(
      (await edge.invoke(edgeRequest("openclaw-orchestrator", "", { method: "OPTIONS" }))).status,
    ).toBe(200);
    const response = await post({ action: "drop_database" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("Unknown action");
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("creates an agent for the tenant in the body", async () => {
    const response = await post({
      action: "create_agent",
      data: { tenant_id: "tenant-1", name: "Planner", agent_type: "planner" },
    });
    const body = await readJson(response);
    expect(body.success).toBe(true);
    expect(body.agent).toMatchObject({ tenant_id: "tenant-1", name: "Planner", agent_type: "planner" });
  });

  it("returns 500 when the agent insert fails", async () => {
    supabase.setFrom(() => ({ data: null, error: { message: "duplicate agent" } }));
    const response = await post({
      action: "create_agent",
      data: { tenant_id: "tenant-1", name: "Planner", agent_type: "planner" },
    });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toBe("Unknown error");
  });

  it("refuses to embed memory when the OpenAI key is missing", async () => {
    edge.env.OPENAI_API_KEY = "";
    const response = await post({
      action: "add_memory",
      data: { tenant_id: "tenant-1", content: "The pump trips on high vibration." },
    });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/OPENAI_API_KEY/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("stores memory with an embedding from the server key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
      return jsonFetchResult({ data: [{ embedding: [0.4, 0.5] }] });
    }));
    const response = await post({
      action: "add_memory",
      data: { tenant_id: "tenant-1", content: "The pump trips on high vibration." },
    });
    expect((await readJson(response)).memory).toMatchObject({
      tenant_id: "tenant-1",
      embedding: [0.4, 0.5],
    });
  });

  it("searches memory inside the requested tenant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ data: [{ embedding: [0.1] }] })));
    supabase.setRpc((_name, args) => {
      expect(args).toMatchObject({ target_tenant_id: "tenant-1", match_count: 5 });
      return { data: [{ id: "mem-1" }], error: null };
    });
    const response = await post({
      action: "search_memory",
      data: { tenant_id: "tenant-1", query: "vibration" },
    });
    expect((await readJson(response)).results).toEqual([{ id: "mem-1" }]);
  });

  it("queues a notification and enqueues a task without calling a model", async () => {
    const note = await post({
      action: "notify",
      data: { tenant_id: "tenant-1", channel: "slack", target: "ops", message: "hello" },
    });
    expect((await readJson(note)).notification).toMatchObject({ message: "hello" });
    const task = await post({
      action: "enqueue",
      data: { tenant_id: "tenant-1", queue_name: "alerts", payload: { type: "notify" } },
    });
    expect((await readJson(task)).task).toMatchObject({ queue_name: "alerts" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns 500 for a body that is not JSON", async () => {
    const response = await edge.invoke(
      edgeRequest("openclaw-orchestrator", "", { body: "nope" }),
    );
    expect(response.status).toBe(500);
  });

  // BUG: supabase/functions/openclaw-orchestrator/index.ts:35-41 has no
  // Authorization check and writes with the service role for the tenant_id in
  // the body. Impact: an anonymous caller can create agents, enqueue work, and
  // spend the embedding key for any tenant.
  it.fails("BUG: create_agent without a bearer token is rejected", async () => {
    const response = await post({
      action: "create_agent",
      data: { tenant_id: "tenant-victim", name: "Intruder", agent_type: "planner" },
    });
    expect(response.status).toBe(401);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
