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

describe("rag-semantic-search edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/rag-semantic-search/index.ts", {
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

  function post(body: unknown) {
    return edge.invoke(
      edgeRequest("rag-semantic-search", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body,
      }),
    );
  }

  it("answers CORS preflight", async () => {
    expect((await edge.invoke(edgeRequest("rag-semantic-search", "", { method: "OPTIONS" }))).status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("requires a query and a tenant before calling the embedding API", async () => {
    const response = await post({ query: "seal leak" });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/query or tenant_id/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns the embedding error and does not search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    const response = await post({ query: "seal leak", tenant_id: "tenant-1" });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/OpenAI API error/);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("filters by document type and logs the search against the requested tenant", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
      expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
      return jsonFetchResult({ data: [{ embedding: [0.2, 0.3] }] });
    }));
    supabase.setRpc((name, args) => {
      if (name === "search_knowledge_base") {
        expect(args).toMatchObject({
          target_tenant_id: "tenant-1",
          query_text: "seal leak",
          match_threshold: 0.7,
          match_count: 5,
        });
        return {
          data: [
            { chunk_id: "c1", document_type: "manual", similarity: 0.9 },
            { chunk_id: "c2", document_type: "note", similarity: 0.8 },
          ],
          error: null,
        };
      }
      return { error: null };
    });
    const response = await post({
      query: "seal leak",
      tenant_id: "tenant-1",
      user_id: "user-1",
      document_types: ["manual"],
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.results).toEqual([{ chunk_id: "c1", document_type: "manual", similarity: 0.9 }]);
    expect(body.query_embedding_size).toBe(2);
    const log = supabase.calls.find((call) => call.table === "rag_search_logs");
    expect(log?.payload).toMatchObject({
      tenant_id: "tenant-1",
      user_id: "user-1",
      retrieved_chunk_ids: ["c1"],
      num_results: 1,
    });
    expect(supabase.rpcCalls.map((call) => call.name)).toEqual([
      "search_knowledge_base",
      "update_chunk_retrieval_stats",
    ]);
  });

  it("returns the search error from the database", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ data: [{ embedding: [0.1] }] })));
    supabase.setRpc(() => ({ data: null, error: { message: "vector down" } }));
    const response = await post({ query: "seal", tenant_id: "tenant-1" });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toBe("Unknown error");
    expect(supabase.calls.filter((call) => call.table === "rag_search_logs")).toHaveLength(0);
  });

  // BUG: supabase/functions/rag-semantic-search/index.ts:41-54 never checks the
  // caller and searches whatever tenant_id is in the body, using the service
  // role. Impact: a caller can retrieve and log another tenant's knowledge chunks.
  it("BUG: a search for a tenant the caller does not own is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ data: [{ embedding: [0.1] }] })));
    supabase.setRpc(() => ({ data: [], error: null }));
    const response = await post({ query: "seal", tenant_id: "tenant-victim" });
    expect(response.status).toBe(403);
    expect(supabase.rpcCalls).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
