// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  edgeBaseEnv,
  edgeRequest,
  installNoNetworkFetch,
  loadEdgeFunction,
  readJson,
  type LoadedEdgeFunction,
} from "../support/edgeFunctionHarness";
import { createSupabaseDouble, eqValue, type SupabaseDouble } from "../support/supabaseQueryMock";

describe("edge-node-manager edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/edge-node-manager/index.ts", { ...edgeBaseEnv });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function call(action: string, init: { method?: string; body?: unknown } = {}) {
    return edge.invoke(
      edgeRequest("edge-node-manager", `?action=${action}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        body: init.body,
        headers: { Authorization: "Bearer user-jwt" },
      }),
    );
  }

  it("answers CORS preflight and rejects a missing Authorization header", async () => {
    expect((await edge.invoke(edgeRequest("edge-node-manager", "", { method: "OPTIONS" }))).status).toBe(200);
    const response = await edge.invoke(edgeRequest("edge-node-manager", "?action=list", { method: "GET" }));
    expect(response.status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects an unknown action", async () => {
    const response = await call("explode");
    expect(response.status).toBe(400);
    expect((await readJson(response)).available_actions).toContain("register");
  });

  it("registers a new node and replaces its capabilities", async () => {
    supabase.setFrom((call) => {
      if (call.table === "edge_nodes" && call.op === "select") return { data: null, error: null };
      if (call.table === "edge_nodes" && call.op === "insert") return { data: { id: "node-1" }, error: null };
      return { error: null };
    });
    const response = await call("register", {
      body: {
        node_name: "pump-house",
        capabilities: [{ name: "ingest", type: "historian", version: "1", enabled: true }],
      },
    });
    expect(response.status).toBe(201);
    const inserted = supabase.calls.find((row) => row.table === "edge_nodes" && row.op === "insert");
    expect(inserted?.payload).toMatchObject({ node_name: "pump-house", status: "online" });
    const caps = supabase.calls.find((row) => row.table === "edge_node_capabilities" && row.op === "insert");
    expect(caps?.payload).toEqual([
      {
        node_id: "node-1",
        capability_type: "historian",
        capability_name: "ingest",
        capability_version: "1",
        enabled: true,
        config: {},
      },
    ]);
  });

  it("updates an existing node instead of inserting a second one", async () => {
    supabase.setFrom((row) => {
      if (row.table === "edge_nodes" && row.op === "select") return { data: { id: "node-1", status: "offline" }, error: null };
      if (row.op === "update") return { data: { id: "node-1", status: "online" }, error: null };
      return { error: null };
    });
    const response = await call("register", { body: { node_name: "pump-house" } });
    expect(response.status).toBe(201);
    expect(supabase.calls.filter((row) => row.op === "insert")).toHaveLength(0);
    expect(eqValue(supabase.calls.find((row) => row.op === "update")!, "id")).toBe("node-1");
  });

  it("records a heartbeat and refuses one that the database rejects", async () => {
    const ok = await call("heartbeat", { body: { node_id: "node-1", latency_ms: 12 } });
    expect(ok.status).toBe(200);
    expect(supabase.calls[0].payload).toMatchObject({ node_id: "node-1", latency_ms: 12, active_jobs: 0 });

    supabase.reset();
    supabase.setFrom(() => ({ error: { message: "bad node" } }));
    const rejected = await call("heartbeat", { body: { node_id: "missing" } });
    expect(rejected.status).toBe(500);
    expect((await readJson(rejected)).error).toBe("bad node");
  });

  it("lists nodes and requires a node id for status and decommission", async () => {
    supabase.setFrom(() => ({ data: [{ id: "node-1" }], error: null }));
    const listed = await call("list", { method: "GET" });
    expect((await readJson(listed)).nodes).toEqual([{ id: "node-1" }]);

    const status = await call("status", { method: "GET" });
    expect(status.status).toBe(500);
    expect((await readJson(status)).error).toMatch(/node_id/);

    const decommission = await call("decommission", { method: "POST" });
    expect((await readJson(decommission)).error).toMatch(/node_id/);
  });

  it("returns node status, capabilities, and a queue summary", async () => {
    supabase.setFrom((row) => {
      if (row.table === "edge_nodes") return { data: { id: "node-1", status: "online" }, error: null };
      if (row.table === "edge_node_heartbeats") return { data: [{ latency_ms: 4 }], error: null };
      if (row.table === "edge_node_capabilities") return { data: [{ capability_name: "ingest" }], error: null };
      if (row.table === "edge_node_queue") return { data: [{ status: "queued" }, { status: "queued" }], error: null };
      return { error: null };
    });
    const response = await edge.invoke(
      edgeRequest("edge-node-manager", "?action=status&node_id=node-1", {
        method: "GET",
        headers: { Authorization: "Bearer user-jwt" },
      }),
    );
    const body = await readJson(response);
    expect(body.node.id).toBe("node-1");
    expect(body.queue_summary).toEqual({ queued: 2 });
    expect(eqValue(supabase.calls[0], "id")).toBe("node-1");
  });

  it("decommissions a node and reads the stale-node RPCs", async () => {
    supabase.setRpc((name) => ({ data: name === "detect_stale_edge_nodes" ? ["node-9"] : 1, error: null }));
    const off = await edge.invoke(
      edgeRequest("edge-node-manager", "?action=decommission&node_id=node-1", {
        method: "POST",
        headers: { Authorization: "Bearer user-jwt" },
      }),
    );
    expect(off.status).toBe(200);
    expect(supabase.calls.find((row) => row.op === "update")?.payload).toEqual({ status: "decommissioned" });

    const stale = await call("stale", { method: "POST" });
    const marked = await call("mark_offline", { method: "POST" });
    expect((await readJson(stale)).stale_nodes).toEqual(["node-9"]);
    expect((await readJson(marked)).nodes_marked_offline).toBe(1);
    expect(supabase.rpcCalls.map((row) => row.name)).toEqual([
      "detect_stale_edge_nodes",
      "mark_stale_nodes_offline",
    ]);
  });

  // BUG: supabase/functions/edge-node-manager/index.ts:34-41 treats any
  // Authorization value as authentication, then uses the service role.
  // Impact: a forged bearer can register, decommission, or mark nodes offline.
  it.fails("BUG: a forged bearer token cannot register a node", async () => {
    const response = await edge.invoke(
      edgeRequest("edge-node-manager", "?action=register", {
        method: "POST",
        headers: { Authorization: "Bearer not-a-jwt" },
        body: { node_name: "intruder" },
      }),
    );
    expect(response.status).toBe(401);
    expect(supabase.calls.filter((row) => row.op === "insert" || row.op === "update")).toHaveLength(0);
  });
});
