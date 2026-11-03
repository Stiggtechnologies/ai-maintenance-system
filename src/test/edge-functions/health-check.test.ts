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
import { createSupabaseDouble, type SupabaseDouble } from "../support/supabaseQueryMock";

describe("health-check edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/health-check/index.ts", { ...edgeBaseEnv });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers CORS preflight without touching the database", async () => {
    const response = await edge.invoke(
      edgeRequest("health-check", "", { method: "OPTIONS" }),
    );
    expect(response.status).toBe(200);
    expect(supabase.calls).toHaveLength(0);
    expect(supabase.clients).toHaveLength(0);
  });

  it("reports healthy when the database, auth admin, and decision log all answer", async () => {
    supabase.setFrom(() => ({ data: [], error: null }));
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.database.status).toBe("healthy");
    expect(body.checks.auth.status).toBe("healthy");
    expect(body.checks.autonomous_system.status).toBe("healthy");
    expect(body.checks.autonomous_system.hasRecentActivity).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(supabase.clients[0]).toMatchObject({
      url: edgeBaseEnv.SUPABASE_URL,
      key: edgeBaseEnv.SUPABASE_SERVICE_ROLE_KEY,
    });
  });

  it("reports degraded, not fully down, when only one dependency fails", async () => {
    supabase.setFrom((call) => {
      if (call.table === "assets") return { data: null, error: { message: "db down" } };
      return { data: [{ id: "decision-1" }], error: null };
    });
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.status).toBe("unhealthy");
    expect(body.checks.auth.status).toBe("healthy");
  });

  it("returns 503 when every dependency is unhealthy", async () => {
    supabase.setFrom(() => ({ data: null, error: { message: "unavailable" } }));
    supabase.setListUsers(() => ({ data: null, error: { message: "auth down" } }));
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });

  it("returns 503 when the client cannot be constructed", async () => {
    edge.createClient = () => {
      throw new Error("missing service role");
    };
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.error).toBe("missing service role");
  });

  it("records an auth admin exception as an unhealthy check instead of failing the whole probe", async () => {
    supabase.setListUsers(() => {
      throw new Error("admin api disabled");
    });
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.auth).toMatchObject({ status: "unhealthy", error: "admin api disabled" });
  });

  // BUG: supabase/functions/health-check/index.ts:37 and :49 copy raw dependency
  // error text into the response, and the handler never checks Authorization.
  // Impact: an unauthenticated caller learns internal database and auth failures.
  it.fails("BUG: dependency error strings are not returned to an unauthenticated caller", async () => {
    supabase.setFrom((call) =>
      call.table === "assets"
        ? { data: null, error: { message: "password authentication failed for user postgres" } }
        : { data: [], error: null },
    );
    const response = await edge.invoke(edgeRequest("health-check"));
    const body = await readJson(response);
    expect(response.status).toBe(401);
    expect(JSON.stringify(body)).not.toContain("password authentication failed");
  });
});
