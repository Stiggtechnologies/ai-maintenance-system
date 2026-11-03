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

const prices = {
  STRIPE_SECRET_KEY: "sk_test_fake",
  APP_BASE_URL: "https://app.syncai.ca",
  STRIPE_STARTER_BASE_PRICE: "price_starter_base",
  STRIPE_STARTER_CREDITS_PRICE: "price_starter_credits",
  STRIPE_PRO_BASE_PRICE: "price_pro_base",
  STRIPE_PRO_CREDITS_PRICE: "price_pro_credits",
  STRIPE_ENTERPRISE_BASE_PRICE: "price_ent_base",
  STRIPE_ENTERPRISE_CREDITS_PRICE: "price_ent_credits",
};

describe("stripe-checkout edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/stripe-checkout/index.ts", {
      ...edgeBaseEnv,
      ...prices,
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStripe(handler: (url: string, init?: RequestInit) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        return handler(url, init);
      }),
    );
  }

  it("answers CORS preflight", async () => {
    const response = await edge.invoke(edgeRequest("stripe-checkout", "", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("returns 404 for an unknown route on the path the function matches", async () => {
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/unknown", { method: "POST", body: {} }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects checkout without a tenant or plan", async () => {
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", { body: { plan_code: "PRO" } }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(500);
    expect(body.error).toMatch(/tenant_id or plan_code/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("rejects an unknown plan code before calling Stripe", async () => {
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", {
        body: { tenant_id: "tenant-1", plan_code: "FREE" },
      }),
    );
    expect((await readJson(response)).error).toMatch(/Invalid plan code/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reuses an existing Stripe customer and sends the configured price ids", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_subscriptions") {
        return { data: { stripe_customer_id: "cus_existing" }, error: null };
      }
      return { data: null, error: null };
    });
    stubStripe((url) => {
      expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
      return jsonFetchResult({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
    });
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", {
        headers: { Authorization: "Bearer user-jwt" },
        body: { tenant_id: "tenant-1", plan_code: "PRO" },
      }),
    );
    expect(await readJson(response)).toEqual({
      url: "https://checkout.stripe.test/cs_1",
      session_id: "cs_1",
    });
    const params = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(params.get("customer")).toBe("cus_existing");
    expect(params.get("mode")).toBe("subscription");
    expect(params.get("line_items[0][price]")).toBe("price_pro_base");
    expect(params.get("line_items[1][price]")).toBe("price_pro_credits");
    expect(params.get("subscription_data[metadata][tenant_id]")).toBe("tenant-1");
    expect(params.get("subscription_data[metadata][plan_code]")).toBe("PRO");
    expect(params.get("success_url")).toContain("https://app.syncai.ca/app/billing");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer sk_test_fake",
    });
  });

  it("creates a Stripe customer from the tenant profile when none exists", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_subscriptions") return { data: null, error: null };
      if (call.table === "user_profiles") {
        return { data: { email: "ada@example.com", full_name: "Ada" }, error: null };
      }
      return { data: null, error: null };
    });
    stubStripe((url) => {
      if (url.endsWith("/customers")) return jsonFetchResult({ id: "cus_new" });
      return jsonFetchResult({ id: "cs_2", url: "https://checkout.stripe.test/cs_2" });
    });
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", {
        body: { tenant_id: "tenant-9", plan_code: "STARTER" },
      }),
    );
    expect(response.status).toBe(200);
    const customerBody = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(customerBody.get("email")).toBe("ada@example.com");
    expect(customerBody.get("name")).toBe("Ada");
    const sessionBody = new URLSearchParams(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(sessionBody.get("customer")).toBe("cus_new");
    expect(sessionBody.get("line_items[0][price]")).toBe("price_starter_base");
  });

  it("surfaces a Stripe checkout error and does not invent a session url", async () => {
    supabase.setFrom(() => ({ data: { stripe_customer_id: "cus_existing" }, error: null }));
    stubStripe(() => new Response("card_declined", { status: 402 }));
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", {
        body: { tenant_id: "tenant-1", plan_code: "ENTERPRISE" },
      }),
    );
    const body = await readJson(response);
    expect(response.status).toBe(500);
    expect(body.error).toContain("card_declined");
    expect(body.url).toBeUndefined();
  });

  it("opens a billing portal for the tenant customer", async () => {
    supabase.setFrom(() => ({ data: { stripe_customer_id: "cus_existing" }, error: null }));
    stubStripe((url) => {
      expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
      return jsonFetchResult({ url: "https://billing.stripe.test/portal" });
    });
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/portal", { body: { tenant_id: "tenant-1" } }),
    );
    expect(await readJson(response)).toEqual({ url: "https://billing.stripe.test/portal" });
    const params = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(params.get("return_url")).toBe("https://app.syncai.ca/app/billing");
  });

  it("rejects a portal request without a tenant", async () => {
    const response = await edge.invoke(edgeRequest("stripe-checkout", "/portal", { body: {} }));
    expect((await readJson(response)).error).toMatch(/tenant_id/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("reports metered usage to the subscription item the caller names", async () => {
    stubStripe((url) => {
      expect(url).toBe("https://api.stripe.com/v1/subscription_items/si_credits/usage_records");
      return jsonFetchResult({ id: "mbur_1", quantity: 3 });
    });
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/usage/report", {
        body: { subscription_item_id: "si_credits", quantity: 3, timestamp: 1700000000, action: "increment" },
      }),
    );
    expect(response.status).toBe(200);
    const params = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(params.get("quantity")).toBe("3");
    expect(params.get("timestamp")).toBe("1700000000");
    expect(params.get("action")).toBe("increment");
  });

  it("rejects a usage report that omits the item or quantity", async () => {
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/usage/report", { body: { quantity: 1 } }),
    );
    expect(response.status).toBe(500);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  // BUG: supabase/functions/stripe-checkout/index.ts:88 replaces only the function
  // name. The billing screen calls /functions/v1/stripe-checkout/portal
  // (src/components/billing/BillingOverview.tsx:69), which becomes
  // /functions/v1/portal and misses every route. Impact: portal, checkout, and
  // usage reporting 404 when invoked the way the app invokes them.
  it.fails("BUG: the deployed /functions/v1/stripe-checkout/portal path opens the portal", async () => {
    supabase.setFrom(() => ({ data: { stripe_customer_id: "cus_existing" }, error: null }));
    stubStripe(() => jsonFetchResult({ url: "https://billing.stripe.test/portal" }));
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/portal", {
        root: "deployed",
        headers: { Authorization: "Bearer user-jwt" },
        body: { tenant_id: "tenant-1" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ url: "https://billing.stripe.test/portal" });
  });

  // BUG: supabase/functions/stripe-checkout/index.ts:91-105 never reads
  // Authorization and posts to Stripe with the service secret for whatever
  // tenant_id is in the body. Impact: a caller can open checkout, the customer
  // portal, or usage records for any tenant and any subscription item.
  it.fails("BUG: checkout without a bearer token is rejected before Stripe is called", async () => {
    supabase.setFrom(() => ({ data: { stripe_customer_id: "cus_existing" }, error: null }));
    stubStripe(() => jsonFetchResult({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
    const response = await edge.invoke(
      edgeRequest("stripe-checkout", "/checkout", {
        body: { tenant_id: "tenant-other", plan_code: "PRO" },
      }),
    );
    expect(response.status).toBe(401);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
