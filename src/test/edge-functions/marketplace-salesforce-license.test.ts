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

const license = {
  action: "license_event",
  license_id: "a0X000000000001",
  organization_id: "00D000000000001",
  package_version_id: "04t000000000001",
  seats: 25,
  status: "Active",
  expires_at: "2026-12-31T00:00:00Z",
};

describe("marketplace-salesforce-license edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/marketplace-salesforce-license/index.ts", {
      ...edgeBaseEnv,
      SF_LMA_SHARED_SECRET: "sf-shared-test",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    const events: Record<string, unknown>[] = [];
    supabase.setFrom((call) => {
      if (call.table !== "salesforce_license_events") return { error: null };
      if (call.op === "select") {
        const eventId = eqValue(call, "event_id");
        return { data: events.find((row) => row.event_id === eventId) ?? null, error: null };
      }
      if (call.op === "insert") {
        events.push(call.payload as Record<string, unknown>);
        return { error: null };
      }
      return { error: null };
    });
    supabase.setRpc(() => ({ data: "sub-sf", error: null }));
    edge.createClient = supabase.createClient;
    edge.env.SF_LMA_SHARED_SECRET = "sf-shared-test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, authorization = "Bearer sf-shared-test") {
    return edge.invoke(
      edgeRequest("marketplace-salesforce-license", "", {
        body,
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
  }

  it("answers CORS preflight and rejects non-POST", async () => {
    expect(
      (
        await edge.invoke(
          edgeRequest("marketplace-salesforce-license", "", { method: "OPTIONS" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await edge.invoke(edgeRequest("marketplace-salesforce-license", "", { method: "GET" }))).status,
    ).toBe(405);
  });

  it("fails closed when the shared secret is unset", async () => {
    edge.env.SF_LMA_SHARED_SECRET = undefined;
    const response = await post(license, "Bearer anything");
    expect(response.status).toBe(500);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects a missing or wrong shared secret", async () => {
    expect((await post(license, "")).status).toBe(403);
    expect((await post(license, "Bearer wrong")).status).toBe(403);
    expect((await post(license, "not-the-secret")).status).toBe(403);
    expect(supabase.calls).toHaveLength(0);
  });

  it("accepts the secret with or without a Bearer prefix", async () => {
    expect((await post(license, "Bearer sf-shared-test")).status).toBe(200);
    supabase.reset();
    expect((await post(license, "sf-shared-test")).status).toBe(200);
  });

  it.each([
    [{ ...license, action: "other" }, /license_event/],
    [{ ...license, license_id: "" }, /license_id/],
    [{ ...license, organization_id: "" }, /organization_id/],
    [{ ...license, package_version_id: "" }, /package_version_id/],
    [{ ...license, seats: -1 }, /seats/],
    [{ ...license, status: "Cancelled" }, /unknown status/],
  ])("rejects an invalid license body", async (body, message) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toMatch(message);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("maps an active license onto the Salesforce subscription RPC", async () => {
    const response = await post(license);
    const body = await readJson(response);
    expect(body).toMatchObject({
      ok: true,
      subscription_id: "sub-sf",
      license_id: license.license_id,
      status: "sf_active",
      seats: 25,
    });
    expect(supabase.rpcCalls[0].args).toMatchObject({
      p_sf_license_id: license.license_id,
      p_sf_organization_id: license.organization_id,
      p_sf_package_version_id: license.package_version_id,
      p_seats: 25,
      p_sf_status: "sf_active",
      p_expires_at: license.expires_at,
    });
    const logged = supabase.calls.find((call) => call.op === "insert");
    expect(logged?.payload).toMatchObject({ action: "license_active", status: "pending", seats: 25 });
  });

  it.each([
    ["Trial", "sf_trial", "license_trial"],
    ["Suspended", "sf_suspended", "license_suspended"],
    ["Uninstalled", "sf_uninstalled", "license_uninstalled"],
    ["Expired", "sf_expired", "license_expired"],
  ])("maps %s", async (status, sfStatus, action) => {
    const response = await post({ ...license, status });
    expect((await readJson(response)).status).toBe(sfStatus);
    expect(supabase.rpcCalls[0].args).toMatchObject({ p_sf_status: sfStatus });
    expect(supabase.calls.find((call) => call.op === "insert")?.payload).toMatchObject({ action });
  });

  it("marks the event failed and does not return success when the RPC fails", async () => {
    supabase.setRpc(() => ({ data: null, error: { message: "upsert failed" } }));
    const response = await post(license);
    expect(response.status).toBe(500);
    const failure = supabase.calls.find((call) => call.op === "update");
    expect(failure?.payload).toMatchObject({ status: "failure", error_message: "upsert failed" });
  });

  it("returns 500 when the event log insert fails", async () => {
    supabase.setFrom(() => ({ error: { message: "log down" } }));
    const response = await post(license);
    expect(response.status).toBe(500);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  // BUG: supabase/functions/marketplace-salesforce-license/index.ts:83-84 builds
  // eventId from Date.now() and a random suffix, despite the "Idempotent log"
  // comment. Impact: Salesforce retries insert another license event and call
  // the upsert RPC again instead of returning the original result.
  it("BUG: replaying the same license event does not insert a second log row", async () => {
    await post(license);
    await post(license);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(1);
    expect(supabase.rpcCalls).toHaveLength(1);
  });

  it("records a different license status as its own event", async () => {
    await post(license);
    await post({ ...license, status: "Suspended" });
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(2);
    expect(supabase.rpcCalls).toHaveLength(2);
  });
});
