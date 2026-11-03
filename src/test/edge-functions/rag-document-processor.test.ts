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
import { createSupabaseDouble, eqValue, type SupabaseDouble } from "../support/supabaseQueryMock";

const paragraph = "A".repeat(80);

describe("rag-document-processor edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/rag-document-processor/index.ts", {
      ...edgeBaseEnv,
      OPENAI_API_KEY: "sk-test-openai",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
    edge.env.OPENAI_API_KEY = "sk-test-openai";
    edge.env.SUPABASE_URL = edgeBaseEnv.SUPABASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers CORS preflight and rejects an unknown route", async () => {
    expect(
      (await edge.invoke(edgeRequest("rag-document-processor", "", { method: "OPTIONS" }))).status,
    ).toBe(200);
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/nope", { method: "POST", body: {} }),
    );
    expect(response.status).toBe(404);
  });

  it("requires a document id and tenant before reading the document", async () => {
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/process", { body: { document_id: "doc-1" } }),
    );
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/document_id or tenant_id/);
    expect(supabase.calls).toHaveLength(0);
  });

  it("does not embed a document that is outside the tenant", async () => {
    supabase.setFrom(() => ({ data: null, error: { message: "no row" } }));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/process", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { document_id: "doc-1", tenant_id: "tenant-b" },
      }),
    );
    expect(response.status).toBe(403);
    expect(supabase.calls.filter((call) => call.table === "knowledge_base_documents")).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("embeds one chunk and marks the document completed", async () => {
    supabase.setFrom((call) => {
      if (call.table === "knowledge_base_documents" && call.op === "select") {
        return { data: { id: "doc-1", tenant_id: "tenant-1", content: paragraph }, error: null };
      }
      return { error: null };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
      return jsonFetchResult({ data: [{ embedding: [0.5] }] });
    }));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/process", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { document_id: "doc-1", tenant_id: "tenant-1" },
      }),
    );
    const body = await readJson(response);
    expect(body).toEqual({ success: true, document_id: "doc-1", chunks_created: 1 });
    const chunk = supabase.calls.find((call) => call.table === "knowledge_base_chunks");
    expect(chunk?.payload).toEqual([
      expect.objectContaining({ document_id: "doc-1", tenant_id: "tenant-1", chunk_index: 0 }),
    ]);
    const statuses = supabase.calls
      .filter((call) => call.table === "knowledge_base_documents" && call.op === "update")
      .map((call) => (call.payload as { processing_status?: string }).processing_status);
    expect(statuses).toEqual(["chunking", "embedding", "completed"]);
  });

  it("returns the embedding error and does not mark the document completed", async () => {
    supabase.setFrom((call) =>
      call.op === "select"
        ? { data: { id: "doc-1", content: paragraph }, error: null }
        : { error: null },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/process", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { document_id: "doc-1", tenant_id: "tenant-1" },
      }),
    );
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/OpenAI API error/);
    expect(
      supabase.calls.filter(
        (call) =>
          call.op === "update" &&
          (call.payload as { processing_status?: string }).processing_status === "completed",
      ),
    ).toHaveLength(0);
  });

  it("batch-processes only the pending documents for the tenant", async () => {
    supabase.setFrom(() => ({
      data: [{ id: "doc-9", tenant_id: "tenant-1" }],
      error: null,
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ success: true, chunks_created: 2 })));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/batch-process", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { tenant_id: "tenant-1", max_documents: 3 },
      }),
    );
    expect(await readJson(response)).toEqual({
      results: [{ document_id: "doc-9", success: true, chunks_created: 2 }],
    });
    const pending = supabase.calls.find((call) => call.table === "knowledge_base_documents");
    expect(eqValue(pending!, "tenant_id")).toBe("tenant-1");
    expect(eqValue(pending!, "processing_status")).toBe("pending");
    expect(pending?.rowLimit).toBe(3);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      "https://example.supabase.co/functions/v1/rag-document-processor/process",
    );
  });

  it("reads processing status on the path the function matches", async () => {
    supabase.setFrom(() => ({ data: { processing_status: "completed", chunk_count: 4 }, error: null }));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/status/doc-1?tenant_id=tenant-1", {
        method: "GET",
        headers: { Authorization: "Bearer user-jwt" },
      }),
    );
    expect(await readJson(response)).toEqual({ processing_status: "completed", chunk_count: 4 });
    const statusLookup = supabase.calls.find((call) => call.table === "knowledge_base_documents");
    expect(eqValue(statusLookup!, "id")).toBe("doc-1");
    expect(eqValue(statusLookup!, "tenant_id")).toBe("tenant-1");
  });

  // BUG: supabase/functions/rag-document-processor/index.ts:79 strips only the
  // function name. The batch worker calls
  // /functions/v1/rag-document-processor/process (line 194), which does not
  // match path === "/process". Impact: batch processing reports a route miss
  // for every document when the function is invoked at its own URL.
  it("BUG: the self-call URL /functions/v1/rag-document-processor/process chunks the document", async () => {
    supabase.setFrom((call) =>
      call.op === "select"
        ? { data: { id: "doc-1", tenant_id: "tenant-1", content: paragraph }, error: null }
        : { error: null },
    );
    vi.stubGlobal("fetch", vi.fn(async () => jsonFetchResult({ data: [{ embedding: [0.1] }] })));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/process", {
        root: "deployed",
        headers: { Authorization: "Bearer user-jwt" },
        body: { document_id: "doc-1", tenant_id: "tenant-1" },
      }),
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).chunks_created).toBe(1);
  });

  // BUG: supabase/functions/rag-document-processor/index.ts:226-233 loads a
  // document by id with no tenant predicate. Impact: a caller who knows a
  // document id can read its processing status and chunk count.
  it("BUG: status lookup without a tenant is rejected", async () => {
    supabase.setFrom(() => ({ data: { processing_status: "completed", chunk_count: 4 }, error: null }));
    const response = await edge.invoke(
      edgeRequest("rag-document-processor", "/status/doc-1", { method: "GET" }),
    );
    expect(response.status).toBe(400);
    expect(supabase.calls.filter((call) => eqValue(call, "tenant_id") === undefined && call.table === "knowledge_base_documents")).toHaveLength(0);
  });
});
