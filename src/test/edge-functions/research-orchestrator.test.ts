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

describe("research-orchestrator edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/research-orchestrator/index.ts", {
      ...edgeBaseEnv,
      OPENAI_API_KEY: "sk-test-openai",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
    edge.env.OPENAI_API_KEY = "sk-test-openai";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, authorization = "Bearer user-jwt") {
    return edge.invoke(
      edgeRequest("research-orchestrator", "", {
        body,
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
  }

  it("answers CORS preflight and rejects a missing Authorization header", async () => {
    expect(
      (await edge.invoke(edgeRequest("research-orchestrator", "", { method: "OPTIONS" }))).status,
    ).toBe(200);
    const response = await post({ action: "list_programs" }, "");
    expect(response.status).toBe(401);
    expect(supabase.clients).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("rejects an unknown action and a body that is not JSON", async () => {
    const unknown = await post({ action: "delete_everything" });
    expect(unknown.status).toBe(400);
    expect((await readJson(unknown)).error).toMatch(/Unknown action/);
    const invalid = await edge.invoke(
      edgeRequest("research-orchestrator", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: "not-json",
      }),
    );
    expect(invalid.status).toBe(500);
  });

  it("lists active programs", async () => {
    supabase.setFrom(() => ({ data: [{ id: "prog-1", active: true }], error: null }));
    const response = await post({ action: "list_programs" });
    expect(await readJson(response)).toEqual({ programs: [{ id: "prog-1", active: true }] });
    expect(supabase.calls.find((call) => call.table === "research_programs")).toMatchObject({
      table: "research_programs",
      op: "select",
    });
  });

  it("requires a program id and a stored program before calling the model", async () => {
    const missing = await post({ action: "propose_variant", data: {} });
    expect((await readJson(missing)).error).toMatch(/program_id is required/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    supabase.setFrom(() => ({ data: null, error: { message: "missing" } }));
    const absent = await post({ action: "propose_variant", data: { program_id: "prog-x" } });
    expect((await readJson(absent)).error).toMatch(/Program not found/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("stores one AI-proposed variant and does not send the caller key to the model", async () => {
    supabase.setFrom((call) => {
      if (call.table === "research_programs") {
        return {
          data: {
            id: "prog-1",
            program_code: "PUMP",
            program_name: "Pump prompts",
            domain: "recommendation_quality",
            program_instructions: "Be specific.",
            mutable_surfaces: ["prompt"],
            success_metrics: ["clarity"],
          },
          error: null,
        };
      }
      if (call.table === "research_variants" && call.op === "select") return { count: 2, error: null };
      if (call.op === "insert") return { data: { id: "var-1", variant_code: "PUMP-v3", change_payload: { prompt: "new" } }, error: null };
      return { error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
      return jsonFetchResult({
        choices: [{
          message: {
            content: "```json\n{\"variant_type\":\"prompt_change\",\"change_payload\":{\"prompt\":\"new\"},\"diff_summary\":\"tighter\",\"description\":\"why\"}\n```",
          },
        }],
      });
    }));
    const response = await post({ action: "propose_variant", data: { program_id: "prog-1" } });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.variant_code).toBe("PUMP-v3");
    const inserted = supabase.calls.find((call) => call.table === "research_variants" && call.op === "insert");
    expect(inserted?.payload).toMatchObject({
      program_id: "prog-1",
      variant_code: "PUMP-v3",
      origin: "ai_proposed",
      status: "proposed",
      variant_type: "prompt_change",
    });
  });

  it("returns the model error when the proposal is not JSON", async () => {
    supabase.setFrom((call) =>
      call.table === "research_programs"
        ? {
            data: {
              program_code: "PUMP",
              program_name: "Pump",
              domain: "generic",
              program_instructions: "",
              mutable_surfaces: [],
              success_metrics: [],
            },
            error: null,
          }
        : { count: 0, error: null },
    );
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ choices: [{ message: { content: "not json" } }] })));
    const response = await post({ action: "propose_variant", data: { program_id: "prog-1" } });
    expect(response.status).toBe(500);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("does not call the model when an experiment is missing its ids", async () => {
    const response = await post({ action: "run_experiment", data: { variant_id: "var-1" } });
    expect((await readJson(response)).error).toMatch(/variant_id and benchmark_id/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reports a missing OpenAI key before proposing", async () => {
    edge.env.OPENAI_API_KEY = undefined;
    supabase.setFrom((call) =>
      call.table === "research_programs"
        ? { data: { program_code: "PUMP", program_name: "Pump", domain: "generic" }, error: null }
        : { count: 0, error: null },
    );
    const response = await post({ action: "propose_variant", data: { program_id: "prog-1" } });
    expect((await readJson(response)).error).toMatch(/OPENAI_API_KEY not configured/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  // BUG: supabase/functions/research-orchestrator/index.ts:923-927 comments
  // "Verify authorization" and then accepts any non-empty header before using
  // the service role. Impact: a forged bearer can propose variants and run
  // experiments on the platform OpenAI key.
  it("BUG: a forged bearer token cannot list or propose research programs", async () => {
    supabase.setFrom(() => ({ data: [], error: null }));
    const response = await post({ action: "list_programs" }, "Bearer not-a-jwt");
    expect(response.status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });
});
