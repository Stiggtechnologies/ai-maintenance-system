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

const subscription = {
  id: "sub-1",
  tenant_id: "tenant-1",
  stripe_customer_id: "cus_1",
  current_period_start: "2026-01-01T00:00:00.000Z",
  current_period_end: "2026-02-01T00:00:00.000Z",
  plan: {
    code: "PRO",
    name: "Pro",
    base_price_cad: 100,
    included_assets: 10,
    asset_uplift_cad: 5,
    included_credits: 1000,
    overage_per_credit_cad: 0.02,
  },
  limits: [{ included_credits: 1000 }],
};

describe("billing-invoice edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/billing-invoice/index.ts", {
      ...edgeBaseEnv,
      STRIPE_SECRET_KEY: "sk_test_fake",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble((call) => {
      if (call.table === "billing_subscriptions" && call.op === "select") {
        return { data: subscription, error: null };
      }
      if (call.table === "asset_snapshots") return { data: { asset_count: 12 }, error: null };
      if (call.table === "usage_events") {
        return { data: [{ credits_consumed: 1000 }, { credits_consumed: 500 }], error: null };
      }
      if (call.table === "billing_invoices" && call.op === "insert") {
        return { data: { id: "inv-1" }, error: null };
      }
      return { error: null };
    });
    edge.createClient = supabase.createClient;
    edge.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers CORS preflight", async () => {
    const response = await edge.invoke(edgeRequest("billing-invoice", "", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects a body without subscription_id", async () => {
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: {},
      }),
    );
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/subscription_id/);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("rejects an unknown subscription before pricing", async () => {
    supabase.setFrom((call) =>
      call.table === "billing_subscriptions"
        ? { data: null, error: { message: "missing" } }
        : { error: null },
    );
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { subscription_id: "missing" },
      }),
    );
    expect((await readJson(response)).error).toMatch(/Subscription not found/);
  });

  // BUG: supabase/functions/billing-invoice/index.ts:100 shorthand-references
  // `asset_overage`, but the value is stored in `assetOverage` (line 70).
  // Impact: every invoice request throws ReferenceError, returns 500, and
  // never inserts billing_invoices. The Stripe call and the credit reset
  // below it are unreachable.
  it("BUG: invoice generation stores the priced open invoice", async () => {
    edge.env.STRIPE_SECRET_KEY = undefined;
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { subscription_id: "sub-1" },
      }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.invoice_id).toBe("inv-1");
    expect(body.breakdown).toEqual({ base: 100, asset_uplift: 10, usage_overage: 10, tax: 0 });
    expect(body.total_cad).toBe(120);
    expect(body.stripe_invoice_id).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const invoice = supabase.calls.find((call) => call.table === "billing_invoices" && call.op === "insert");
    expect(invoice?.payload).toMatchObject({
      subscription_id: "sub-1",
      base_amount_cad: 100,
      asset_uplift_cad: 10,
      usage_overage_cad: 10,
      total_cad: 120,
      status: "open",
      asset_count: 12,
      credits_consumed: 1500,
    });
  });

  // BUG: same ReferenceError at billing-invoice/index.ts:100. The Stripe
  // itemisation below it never runs. Impact: a configured Stripe customer
  // still gets HTTP 500 and no hosted invoice.
  it("BUG: a configured Stripe customer gets itemised and finalised", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        if (String(input).endsWith("/v1/invoices") && init?.method === "POST") {
          return jsonFetchResult({ id: "in_1", hosted_invoice_url: "https://pay.stripe.test/in_1" });
        }
        return jsonFetchResult({ id: "ii_1" });
      }),
    );
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { subscription_id: "sub-1" },
      }),
    );
    const body = await readJson(response);
    expect(body.stripe_invoice_id).toBe("in_1");
    expect(body.stripe_hosted_url).toBe("https://pay.stripe.test/in_1");
    expect(urls).toEqual([
      "https://api.stripe.com/v1/invoices",
      "https://api.stripe.com/v1/invoiceitems",
      "https://api.stripe.com/v1/invoiceitems",
      "https://api.stripe.com/v1/invoiceitems",
      "https://api.stripe.com/v1/invoices/in_1/finalize",
    ]);
    const amounts = vi.mocked(fetch).mock.calls.slice(1, 4).map((call) => {
      const params = new URLSearchParams(String(call[1]?.body));
      return params.get("amount");
    });
    expect(amounts).toEqual(["10000", "1000", "1000"]);
    const saved = supabase.calls.find(
      (call) => call.table === "billing_invoices" && call.op === "update",
    );
    expect(saved?.payload).toMatchObject({
      stripe_invoice_id: "in_1",
      stripe_hosted_url: "https://pay.stripe.test/in_1",
    });
  });

  // BUG: supabase/functions/billing-invoice/index.ts:212-231 reset remaining
  // credits and advance the period after the Stripe try/catch, including when
  // invoice creation returns an error. That path is currently shadowed by the
  // asset_overage ReferenceError at line 100. Impact once the throw is fixed:
  // a Stripe outage still zeroes credits and moves the billing window, so the
  // uninvoiced usage is dropped.
  it("BUG: a Stripe invoice failure does not reset credits or advance the period", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("stripe down", { status: 503 })));
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { subscription_id: "sub-1" },
      }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.total_cad).toBe(120);
    expect(body.stripe_invoice_id).toBeNull();
    expect(
      supabase.calls.filter(
        (call) =>
          call.table === "subscription_limits" ||
          (call.table === "billing_subscriptions" && call.op === "update"),
      ),
    ).toHaveLength(0);
  });

  // BUG: supabase/functions/billing-invoice/index.ts:9-21 has no auth check at
  // all. Impact: anyone who can invoke the function generates an invoice and
  // resets the subscription's remaining credits.
  it("BUG: invoice generation without a bearer token is rejected", async () => {
    edge.env.STRIPE_SECRET_KEY = undefined;
    const response = await edge.invoke(
      edgeRequest("billing-invoice", "", {
        body: { subscription_id: "sub-1" },
      }),
    );
    expect(response.status).toBe(401);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
