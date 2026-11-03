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

describe("document-processor edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/document-processor/index.ts", {
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

  function post(body: unknown, options?: { auth?: false }) {
    const headers = options?.auth === false ? undefined : { Authorization: "Bearer user-jwt" };
    return edge.invoke(edgeRequest("document-processor", "", { body, headers }));
  }

  it("answers CORS preflight", async () => {
    expect((await edge.invoke(edgeRequest("document-processor", "", { method: "OPTIONS" }))).status).toBe(200);
  });

  it("returns 400 when the OpenAI key is not configured", async () => {
    edge.env.OPENAI_API_KEY = undefined;
    const response = await post({ fileUrl: "https://files.example.test/a.txt", fileName: "a.txt" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toMatch(/OpenAI API key/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("requires fileUrl and fileName for an analysis", async () => {
    const response = await post({ fileName: "a.txt" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toMatch(/fileUrl and fileName/);
  });

  it("requires a document id before chunking", async () => {
    const response = await post({ action: "process_and_chunk" });
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toMatch(/document_id/);
    expect(supabase.calls).toHaveLength(0);
  });

  it("returns 404 when the document to chunk does not exist", async () => {
    supabase.setFrom(() => ({ data: null, error: null }));
    const response = await post({ action: "process_and_chunk", document_id: "doc-missing" });
    expect(response.status).toBe(404);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("chunks a stored document and writes embeddings with the server key", async () => {
    supabase.setFrom((call) => {
      if (call.table === "knowledge_base_documents" && call.op === "select") {
        return {
          data: { id: "doc-1", tenant_id: "tenant-1", content: "Pump failed. Replace the seal." },
          error: null,
        };
      }
      if (call.table === "knowledge_base_chunks" && call.op === "insert") {
        return { data: { id: "chunk-1" }, error: null };
      }
      return { error: null };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-openai");
        const sent = JSON.parse(String(init?.body));
        expect(sent.model).toBe("text-embedding-ada-002");
        return jsonFetchResult({ data: [{ embedding: [0.1, 0.2] }] });
      }),
    );
    const response = await post({
      action: "process_and_chunk",
      document_id: "doc-1",
      openaiKey: "caller-supplied-key-must-not-be-used",
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.chunks_created).toBe(1);
    expect(body.embeddings_generated).toBe(1);
    const chunk = supabase.calls.find((call) => call.table === "knowledge_base_chunks");
    expect(chunk?.payload).toMatchObject({
      document_id: "doc-1",
      tenant_id: "tenant-1",
      embedding: [0.1, 0.2],
    });
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain("caller-supplied-key");
  });

  it("analyses a text document and stores the upload when a user id is present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://files.example.test/manual.txt") {
        return new Response("Bearing temperature is high.", { status: 200 });
      }
      return jsonFetchResult({ choices: [{ message: { content: "Inspect the bearing." } }] });
    }));
    const response = await post({
      fileUrl: "https://files.example.test/manual.txt",
      fileName: "manual.txt",
      fileType: "text/plain",
      user_id: "user-1",
      query: "What failed?",
    });
    expect(await readJson(response)).toMatchObject({
      success: true,
      analysis: "Inspect the bearing.",
      fileName: "manual.txt",
    });
    const upload = supabase.calls.find((call) => call.table === "document_uploads");
    expect(upload?.payload).toMatchObject({ uploaded_by: "user-1", file_name: "manual.txt" });
  });

  it("returns the embedding provider error instead of storing a chunk", async () => {
    supabase.setFrom((call) =>
      call.op === "select"
        ? { data: { id: "doc-1", tenant_id: "tenant-1", content: "A long enough sentence exists here." }, error: null }
        : { error: null },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const response = await post({ action: "process_and_chunk", document_id: "doc-1" });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/Embedding API error: 429/);
    expect(supabase.calls.filter((call) => call.table === "knowledge_base_chunks")).toHaveLength(0);
  });

  // BUG: supabase/functions/document-processor/index.ts:22-25 fetches whatever
  // fileUrl the caller sends, with no allow-list. Impact: the function can be
  // used to read link-local or internal URLs from the server network.
  it("BUG: an analysis does not fetch a link-local fileUrl", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (String(input).includes("169.254.169.254")) return new Response("secret-metadata", { status: 200 });
      return jsonFetchResult({ choices: [{ message: { content: "nope" } }] });
    }));
    const response = await post({
      fileUrl: "http://169.254.169.254/latest/meta-data/",
      fileName: "meta.txt",
      fileType: "text/plain",
    });
    expect(response.status).toBe(400);
    expect(urls.join(" ")).not.toContain("169.254.169.254");
  });

  // BUG: supabase/functions/document-processor/index.ts:123 creates a service-role
  // client and never reads Authorization. Impact: an anonymous caller can spend
  // the OpenAI key and write document_uploads.
  it("BUG: document analysis without a bearer token is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://files.")) return new Response("text", { status: 200 });
      return jsonFetchResult({ choices: [{ message: { content: "ok" } }] });
    }));
    const response = await post(
      {
        fileUrl: "https://files.example.test/a.txt",
        fileName: "a.txt",
        fileType: "text/plain",
      },
      { auth: false },
    );
    expect(response.status).toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(eqValue(supabase.calls[0] ?? { filters: [], table: "", op: "select", asSingle: false }, "id")).toBeUndefined();
  });

  it("does not fetch a host outside DOCUMENT_URL_ALLOWLIST", async () => {
    edge.env.DOCUMENT_URL_ALLOWLIST = "files.example.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret", { status: 200 })));
    const response = await post({
      fileUrl: "https://evil.example/a.txt",
      fileName: "a.txt",
      fileType: "text/plain",
    });
    expect(response.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
