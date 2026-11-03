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
import { createSupabaseDouble, eqValue, type QueryCall, type SupabaseDouble } from "../support/supabaseQueryMock";

describe("billing-api edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/billing-api/index.ts", { ...edgeBaseEnv });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function authed(suffix: string, init: Parameters<typeof edgeRequest>[2] = {}) {
    return edgeRequest("billing-api", suffix, {
      ...init,
      headers: { Authorization: "Bearer user-jwt", ...init.headers },
    });
  }

  it("answers CORS preflight without a service client", async () => {
    const response = await edge.invoke(edgeRequest("billing-api", "", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects a request that has no Authorization header", async () => {
    const response = await edge.invoke(edgeRequest("billing-api", "/plans"));
    const body = await readJson(response);
    expect(response.status).toBe(500);
    expect(body.error).toMatch(/authorization/i);
    expect(supabase.calls).toHaveLength(0);
  });

  it("lists active plans", async () => {
    supabase.setFrom(() => ({
      data: [{ code: "PRO", base_price_cad: 100 }],
      error: null,
    }));
    const response = await edge.invoke(authed("/plans", { method: "GET" }));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ plans: [{ code: "PRO", base_price_cad: 100 }] });
    expect(supabase.calls[0]).toMatchObject({ table: "billing_plans", op: "select" });
    expect(eqValue(supabase.calls[0], "is_active")).toBe(true);
  });

  it("creates a subscription and seeds included credits for a known plan", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_plans") {
        return {
          data: { id: "plan-1", code: "PRO", included_assets: 10, included_credits: 1000 },
          error: null,
        };
      }
      if (call.table === "billing_subscriptions" && call.op === "insert") {
        return {
          data: {
            id: "sub-1",
            status: "active",
            current_period_start: "2026-01-01T00:00:00.000Z",
            current_period_end: "2026-02-01T00:00:00.000Z",
          },
          error: null,
        };
      }
      return { error: null };
    });
    const response = await edge.invoke(
      authed("/subscriptions", {
        body: { tenant_id: "tenant-1", plan_code: "PRO", start_date: "2026-01-15T00:00:00.000Z" },
      }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ subscription_id: "sub-1", status: "active", plan_code: "PRO" });
    const limits = supabase.calls.find((call) => call.table === "subscription_limits");
    expect(limits?.payload).toMatchObject({
      subscription_id: "sub-1",
      included_assets: 10,
      included_credits: 1000,
      remaining_credits: 1000,
    });
  });

  it("returns an error when the plan code does not exist", async () => {
    supabase.setFrom(() => ({ data: null, error: { message: "not found" } }));
    const response = await edge.invoke(
      authed("/subscriptions", { body: { tenant_id: "tenant-1", plan_code: "NOPE" } }),
    );
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/Plan not found/);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("rejects a subscription create that omits tenant or plan", async () => {
    const response = await edge.invoke(authed("/subscriptions", { body: { tenant_id: "tenant-1" } }));
    expect((await readJson(response)).error).toMatch(/required fields/);
  });

  it("loads one subscription with its plan and limits", async () => {
    supabase.setFrom(() => ({ data: { id: "sub-1", plan: { code: "PRO" } }, error: null }));
    const response = await edge.invoke(authed("/subscriptions/sub-1", { method: "GET" }));
    expect(response.status).toBe(200);
    expect(eqValue(supabase.calls[0], "id")).toBe("sub-1");
  });

  it("burns LLM credits from token counts and raises a critical alert", async () => {
    supabase.setFrom((call: QueryCall) => {
      if (call.table === "usage_events") return { error: null };
      if (call.table === "subscription_limits" && call.op === "select") {
        return { data: { remaining_credits: 100, included_credits: 1000 }, error: null };
      }
      if (call.table === "billing_subscriptions") {
        return { data: { billing_source: "stripe", marketplace_subscription_id: null }, error: null };
      }
      return { error: null };
    });
    const response = await edge.invoke(
      authed("/usage/track", {
        body: {
          tenant_id: "tenant-1",
          subscription_id: "sub-1",
          event_type: "LLM_token_usage",
          meta: { total_tokens: 2500 },
        },
      }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.credits_burned).toBe(3);
    expect(body.remaining_credits).toBe(97);
    expect(body.alert).toBe("CRITICAL");
    expect(body.marketplace_metering_queued).toBe(false);
    const usage = supabase.calls.find((call) => call.table === "usage_events");
    expect(usage?.payload).toMatchObject({ credits_consumed: 3, tenant_id: "tenant-1" });
  });

  it("reports overage and queues Azure marketplace metering for marketplace subscriptions", async () => {
    supabase.setFrom((call) => {
      if (call.table === "subscription_limits" && call.op === "select") {
        return { data: { remaining_credits: 1, included_credits: 100 }, error: null };
      }
      if (call.table === "billing_subscriptions") {
        return {
          data: { billing_source: "azure_marketplace", marketplace_subscription_id: "ms-1" },
          error: null,
        };
      }
      return { error: null };
    });
    const response = await edge.invoke(
      authed("/usage/track", {
        body: {
          tenant_id: "tenant-1",
          subscription_id: "sub-1",
          event_type: "vision_frame_batch",
          meta: { frames: 250 },
        },
      }),
    );
    const body = await readJson(response);
    expect(body.credits_burned).toBe(15);
    expect(body.alert).toBe("OVERAGE");
    expect(body.overage_credits).toBe(14);
    expect(body.remaining_credits).toBe(0);
    expect(body.marketplace_metering_queued).toBe(true);
    const meter = supabase.calls.find((call) => call.table === "marketplace_metering_records");
    expect(meter?.payload).toMatchObject({
      marketplace_subscription_id: "ms-1",
      dimension: "ai_credits",
      quantity: 15,
      status: "pending",
    });
  });

  it("rejects an unknown usage event before writing", async () => {
    const response = await edge.invoke(
      authed("/usage/track", {
        body: { tenant_id: "tenant-1", subscription_id: "sub-1", event_type: "invented" },
      }),
    );
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/Unknown event type/);
    expect(supabase.calls).toHaveLength(0);
  });

  it("summarises usage in a period by event type", async () => {
    supabase.setFrom(() => ({
      data: [
        { event_type: "optimizer_job", units: 1, credits_consumed: 500 },
        { event_type: "optimizer_job", units: 1, credits_consumed: 500 },
      ],
      error: null,
    }));
    const response = await edge.invoke(
      authed("/usage/summary?subscriptionId=sub-1&period=2026-03", { method: "GET" }),
    );
    const body = await readJson(response);
    expect(body.total_credits).toBe(1000);
    expect(body.by_type.optimizer_job).toEqual({ count: 2, units: 2, credits: 1000 });
    expect(body.period).toBe("2026-03");
  });

  it("requires a subscription id for the usage summary and overage routes", async () => {
    const summary = await edge.invoke(authed("/usage/summary", { method: "GET" }));
    const overage = await edge.invoke(authed("/overage", { method: "GET" }));
    expect((await readJson(summary)).error).toMatch(/subscriptionId/);
    expect((await readJson(overage)).error).toMatch(/subscriptionId/);
  });

  it("returns the overage view for a subscription", async () => {
    supabase.setFrom(() => ({ data: [{ month: "2026-03", credits: 4 }], error: null }));
    const response = await edge.invoke(authed("/overage?subscriptionId=sub-1", { method: "GET" }));
    expect(await readJson(response)).toEqual({ overage_history: [{ month: "2026-03", credits: 4 }] });
    expect(supabase.calls[0].table).toBe("v_billable_overage");
  });

  it("returns 404 for an unknown route", async () => {
    const response = await edge.invoke(authed("/nope", { method: "POST", body: {} }));
    expect(response.status).toBe(404);
  });

  // BUG: supabase/functions/billing-api/index.ts:35 only strips the function
  // name, so /functions/v1/billing-api/plans never equals /plans.
  // Impact: every billing route 404s behind the standard Supabase function URL.
  it.fails("BUG: GET /functions/v1/billing-api/plans lists plans", async () => {
    supabase.setFrom(() => ({ data: [{ code: "PRO" }], error: null }));
    const response = await edge.invoke(
      edgeRequest("billing-api", "/plans", {
        method: "GET",
        root: "deployed",
        headers: { Authorization: "Bearer user-jwt" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ plans: [{ code: "PRO" }] });
  });

  // BUG: supabase/functions/billing-api/index.ts:41-68 treats any Authorization
  // value as enough and writes billing_subscriptions with the service role for
  // the tenant_id in the body. Impact: a caller authenticated for one tenant
  // can create a subscription and burn credits for another.
  it.fails("BUG: subscription creation is refused when the body tenant is not the caller", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_plans") {
        return { data: { id: "plan-1", code: "PRO", included_assets: 1, included_credits: 1 }, error: null };
      }
      if (call.op === "insert" && call.table === "billing_subscriptions") {
        return { data: { id: "sub-x", status: "active", current_period_start: "", current_period_end: "" }, error: null };
      }
      return { error: null };
    });
    const response = await edge.invoke(
      authed("/subscriptions", { body: { tenant_id: "tenant-victim", plan_code: "PRO" } }),
    );
    expect(response.status).toBe(403);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
