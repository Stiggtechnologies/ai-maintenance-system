/**
 * openclaw-* and sir-* ship as parallel copies. These helpers keep each
 * function's test file focused on its own tables and bug lines.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  edgeBaseEnv,
  edgeRequest,
  installNoNetworkFetch,
  loadEdgeFunction,
  readJson,
  type LoadedEdgeFunction,
} from "./edgeFunctionHarness";
import { createSupabaseDouble, eqValue, type SupabaseDouble } from "./supabaseQueryMock";

function useEdge(relativePath: string) {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;
  beforeAll(() => {
    edge = loadEdgeFunction(relativePath, { ...edgeBaseEnv });
  });
  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return {
    get edge() {
      return edge;
    },
    get supabase() {
      return supabase;
    },
  };
}

export function describeAgentHealth(options: {
  name: string;
  path: string;
  agents: string;
  memory: string;
  history: string;
}) {
  describe(`${options.name} edge function`, () => {
    const ctx = useEdge(options.path);

    it("answers CORS preflight without a database client", async () => {
      const response = await ctx.edge.invoke(edgeRequest(options.name, "", { method: "OPTIONS" }));
      expect(response.status).toBe(200);
      expect(ctx.supabase.clients).toHaveLength(0);
    });

    it("rejects a missing Authorization header", async () => {
      const response = await ctx.edge.invoke(edgeRequest(options.name, "", { method: "GET" }));
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });

    it("records a database and memory probe", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "GET",
          headers: { Authorization: "Bearer user-jwt" },
        }),
      );
      const body = await readJson(response);
      expect(response.status).toBe(200);
      expect(body.checks.map((check: { name: string }) => check.name)).toEqual([
        "database",
        "memory_store",
      ]);
      expect(body.checks.every((check: { status: string }) => check.status === "ok")).toBe(true);
      expect(ctx.supabase.calls.filter((call) => call.table === options.history && call.op === "insert")).toHaveLength(
        2,
      );
    });

    it("marks the memory probe as a warning when that table errors", async () => {
      ctx.supabase.setFrom((call) =>
        call.table === options.memory
          ? { data: null, error: { message: "memory offline" } }
          : { error: null },
      );
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: {},
        }),
      );
      const body = await readJson(response);
      expect(body.checks.find((check: { name: string }) => check.name === "memory_store")).toMatchObject({
        status: "warn",
        details: "memory offline",
      });
    });

    it("returns 500 when writing the health history throws", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.op === "insert") throw new Error("history full");
        return { error: null };
      });
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "GET",
          headers: { Authorization: "Bearer user-jwt" },
        }),
      );
      expect(response.status).toBe(500);
      expect((await readJson(response)).error).toBe("history full");
    });

    // The handler comments say "Verify authentication" and then accepts any
    // non-empty header before using the service role (index.ts:14-26).
    it("BUG: a forged bearer token is not treated as authenticated", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "GET",
          headers: { Authorization: "Bearer not-a-jwt" },
        }),
      );
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });

    // index.ts:40 hard-codes status "ok" after a dependency check has failed.
    it("BUG: the overall status is not ok when the database probe fails", async () => {
      ctx.supabase.setFrom((call) =>
        call.table === options.agents
          ? { data: null, error: { message: "connection refused" } }
          : { error: null },
      );
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "GET",
          headers: { Authorization: "Bearer user-jwt" },
        }),
      );
      const body = await readJson(response);
      expect(body.checks.find((check: { name: string }) => check.name === "database").status).toBe("error");
      expect(body.status).not.toBe("ok");
    });
  });
}

export function describeAgentNotifier(options: {
  name: string;
  path: string;
  notifications: string;
  endpoints: string;
}) {
  describe(`${options.name} edge function`, () => {
    const ctx = useEdge(options.path);

    it("rejects a missing Authorization header before reading the queue", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", { method: "POST", body: { limit: 1 } }),
      );
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });

    it("returns 500 when the body is not JSON", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: "not-json",
        }),
      );
      expect(response.status).toBe(500);
    });

    it("sends a queued notification and marks it sent when the endpoint accepts it", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.table === options.notifications && call.op === "select") {
          return {
            data: [{ id: "n-1", channel: "slack", target: "ops", message: "pump down" }],
            error: null,
          };
        }
        if (call.table === options.endpoints) {
          return {
            data: [{ endpoint_url: "https://hooks.example.test/notify", headers: { "X-Test": "1" }, is_active: true }],
            error: null,
          };
        }
        return { error: null };
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 202 })));
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: { limit: 5 },
        }),
      );
      const body = await readJson(response);
      expect(body).toEqual({ success: true, processed: 1, results: [{ id: "n-1", status: "sent" }] });
      expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://hooks.example.test/notify");
      expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ "X-Test": "1" });
      const sent = ctx.supabase.calls.find((call) => call.op === "update");
      expect(sent?.payload).toEqual({ status: "sent" });
      expect(eqValue(sent!, "id")).toBe("n-1");
    });

    it("marks the notification failed when the endpoint call throws", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.op === "select" && call.table === options.notifications) {
          return { data: [{ id: "n-2", channel: "slack", target: "ops", message: "x" }], error: null };
        }
        if (call.table === options.endpoints) {
          return { data: [{ endpoint_url: "https://hooks.example.test/down" }], error: null };
        }
        return { error: null };
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: {},
        }),
      );
      const body = await readJson(response);
      expect(body.results[0].status).toBe("failed");
      expect(
        ctx.supabase.calls.find((call) => call.op === "update")?.payload,
      ).toEqual({ status: "failed" });
    });

    it("does not call fetch when the notification has no active endpoint", async () => {
      ctx.supabase.setFrom((call) =>
        call.op === "select" && call.table === options.notifications
          ? { data: [{ id: "n-3", channel: "email", target: "none", message: "x" }], error: null }
          : { data: [], error: null },
      );
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: { limit: 1 },
        }),
      );
      expect(response.status).toBe(200);
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    // index.ts:53-67 still writes status "sent" when no endpoint_url exists.
    // Impact: the notification is dropped and will not be retried.
    it("BUG: a notification with no active endpoint is not marked sent", async () => {
      ctx.supabase.setFrom((call) =>
        call.op === "select" && call.table === options.notifications
          ? { data: [{ id: "n-3", channel: "email", target: "none", message: "x" }], error: null }
          : { data: [], error: null },
      );
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: { limit: 1 },
        }),
      );
      expect((await readJson(response)).results[0].status).not.toBe("sent");
    });

    it("BUG: a forged bearer token is not treated as authenticated", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer not-a-jwt" },
          body: { limit: 1 },
        }),
      );
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });

    // index.ts:53-67 ignores the HTTP status. A 500 from the endpoint still
    // updates the row to sent. Impact: failed deliveries are reported as sent
    // and will not be retried.
    it("BUG: an endpoint HTTP error is recorded as a failed notification", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.table === options.notifications && call.op === "select") {
          return { data: [{ id: "n-4", channel: "slack", target: "ops", message: "x" }], error: null };
        }
        if (call.table === options.endpoints) {
          return { data: [{ endpoint_url: "https://hooks.example.test/fail" }], error: null };
        }
        return { error: null };
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: { limit: 1 },
        }),
      );
      expect((await readJson(response)).results[0].status).toBe("failed");
      expect(ctx.supabase.calls.find((call) => call.op === "update")?.payload).toEqual({ status: "failed" });
    });
  });
}

export function describeAgentQueue(options: { name: string; path: string; queue: string; notifications: string }) {
  describe(`${options.name} edge function`, () => {
    const ctx = useEdge(options.path);

    it("rejects a missing Authorization header", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", { method: "POST", body: { queue_name: "default" } }),
      );
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });

    it("returns 500 when the queue query fails", async () => {
      ctx.supabase.setFrom(() => ({ data: null, error: { message: "queue locked" } }));
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: {},
        }),
      );
      expect(response.status).toBe(500);
      expect((await readJson(response)).error).toBe("Unknown error");
    });

    it("turns a notify task into a notification and marks the task done", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.table === options.queue && call.op === "select") {
          return {
            data: [
              {
                id: "task-1",
                tenant_id: "tenant-1",
                attempts: 0,
                payload: { type: "notify", channel: "slack", target: "ops", message: "hello" },
              },
            ],
            error: null,
          };
        }
        return { error: null };
      });
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: { queue_name: "alerts", limit: 2 },
        }),
      );
      expect(await readJson(response)).toEqual({
        success: true,
        processed: 1,
        results: [{ id: "task-1", status: "done" }],
      });
      const queued = ctx.supabase.calls.find((call) => call.table === options.queue && call.op === "select");
      expect(eqValue(queued!, "queue_name")).toBe("alerts");
      expect(queued?.rowLimit).toBe(2);
      const note = ctx.supabase.calls.find((call) => call.table === options.notifications && call.op === "insert");
      expect(note?.payload).toMatchObject({
        tenant_id: "tenant-1",
        channel: "slack",
        target: "ops",
        message: "hello",
      });
      expect(
        ctx.supabase.calls.filter((call) => call.op === "update").map((call) => (call.payload as { status: string }).status),
      ).toEqual(["processing", "done"]);
    });

    it("requeues with backoff below 3 attempts and fails on the third", async () => {
      ctx.supabase.setFrom((call) => {
        if (call.table === options.queue && call.op === "select") {
          return { data: [{ id: "task-2", tenant_id: "tenant-1", attempts: 2, payload: {} }], error: null };
        }
        if (call.op === "update" && (call.payload as { status?: string }).status === "processing") {
          throw new Error("cannot lock");
        }
        return { error: null };
      });
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer user-jwt" },
          body: {},
        }),
      );
      const body = await readJson(response);
      expect(body.results[0]).toMatchObject({ id: "task-2", status: "failed" });
      const retry = ctx.supabase.calls.find(
        (call) => call.op === "update" && (call.payload as { attempts?: number }).attempts === 3,
      );
      expect(retry?.payload).toMatchObject({ status: "failed", attempts: 3 });
      expect((retry?.payload as { next_run_at: string }).next_run_at).toBeTruthy();
    });

    it("BUG: a forged bearer token is not treated as authenticated", async () => {
      const response = await ctx.edge.invoke(
        edgeRequest(options.name, "", {
          method: "POST",
          headers: { Authorization: "Bearer not-a-jwt" },
          body: { queue_name: "default" },
        }),
      );
      expect(response.status).toBe(401);
      expect(ctx.supabase.calls).toHaveLength(0);
    });
  });
}
