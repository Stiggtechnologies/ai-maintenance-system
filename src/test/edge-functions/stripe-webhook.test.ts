// @vitest-environment node
import { createHmac } from "node:crypto";
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

const webhookSecret = "whsec_test_fake";

function stripeSignature(secret: string, body: string, timestamp = "1700000000") {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe("stripe-webhook edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/stripe-webhook/index.ts", {
      ...edgeBaseEnv,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_SECRET_KEY: "sk_test_fake",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble();
    edge.createClient = supabase.createClient;
    edge.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    edge.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, signature?: string) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return edge.invoke(
      edgeRequest("stripe-webhook", "", {
        method: "POST",
        body: raw,
        headers: signature === undefined ? {} : { "stripe-signature": signature },
      }),
    );
  }

  it("answers CORS preflight without reading a signature", async () => {
    const response = await edge.invoke(edgeRequest("stripe-webhook", "", { method: "OPTIONS" }));
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects a delivery that has no Stripe-Signature header", async () => {
    const response = await post({ id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } });
    const body = await readJson(response);
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/signature/i);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects a delivery when the webhook secret is not configured", async () => {
    edge.env.STRIPE_WEBHOOK_SECRET = undefined;
    const response = await post(
      { id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } },
      "t=1,v1=abc",
    );
    expect(response.status).toBe(400);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    const response = await post("not-json", "t=1,v1=abc");
    const body = await readJson(response);
    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
    expect(supabase.calls).toHaveLength(0);
  });

  it("acknowledges an event type it does not handle and does not write", async () => {
    const response = await post(
      { id: "evt_1", type: "charge.refunded", data: { object: { id: "ch_1" } } },
      "t=1,v1=present",
    );
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, event_type: "charge.refunded" });
    expect(supabase.calls.filter((call) => call.op !== "select")).toHaveLength(0);
  });

  it("marks the local invoice paid when invoice.paid arrives with a signature header", async () => {
    const response = await post(
      { id: "evt_paid", type: "invoice.paid", data: { object: { id: "in_42" } } },
      "t=1,v1=present",
    );
    expect(response.status).toBe(200);
    const update = supabase.calls.find(
      (call) => call.table === "billing_invoices" && call.op === "update",
    );
    expect(update?.payload).toMatchObject({ status: "paid" });
    expect(update?.payload).toHaveProperty("paid_at");
    expect(eqValue(update!, "stripe_invoice_id")).toBe("in_42");
  });

  it("marks the invoice failed and the subscription past due", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_invoices" && call.op === "select") {
        return { data: { subscription_id: "local-sub" }, error: null };
      }
      return { error: null };
    });
    const response = await post(
      { id: "evt_fail", type: "invoice.payment_failed", data: { object: { id: "in_9" } } },
      "t=1,v1=present",
    );
    expect(response.status).toBe(200);
    const invoice = supabase.calls.find(
      (call) => call.table === "billing_invoices" && call.op === "update",
    );
    const subscription = supabase.calls.find(
      (call) => call.table === "billing_subscriptions" && call.op === "update",
    );
    expect(invoice?.payload).toEqual({ status: "payment_failed" });
    expect(subscription?.payload).toEqual({ status: "past_due" });
    expect(eqValue(subscription!, "id")).toBe("local-sub");
  });

  it.each([
    ["canceled", "cancelled"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["active", "active"],
  ])("maps Stripe subscription status %s to %s", async (stripeStatus, localStatus) => {
    const response = await post(
      {
        id: "evt_sub",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            status: stripeStatus,
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        },
      },
      "t=1,v1=present",
    );
    expect(response.status).toBe(200);
    const update = supabase.calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({ status: localStatus });
    expect(eqValue(update!, "stripe_subscription_id")).toBe("sub_1");
  });

  it("cancels the local subscription when Stripe deletes it", async () => {
    const response = await post(
      { id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: "sub_9" } } },
      "t=1,v1=present",
    );
    expect(response.status).toBe(200);
    const update = supabase.calls.find((call) => call.op === "update");
    expect(update?.payload).toEqual({ status: "cancelled" });
    expect(eqValue(update!, "stripe_subscription_id")).toBe("sub_9");
  });

  it("does not insert a subscription when Stripe refuses the subscription lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const response = await post(
      {
        id: "evt_checkout",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_1",
            subscription: "sub_missing",
            metadata: { tenant_id: "tenant-1", plan_code: "PRO" },
          },
        },
      },
      "t=1,v1=present",
    );
    expect(await readJson(response)).toMatchObject({ received: true });
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("creates one local subscription and stores the Stripe item ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonFetchResult({
          id: "sub_123",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          items: {
            data: [
              { id: "si_base", price: { metadata: { component: "base" } } },
              { id: "si_credits", price: { metadata: { component: "credits" } } },
            ],
          },
        }),
      ),
    );
    supabase.setFrom((call) => {
      if (call.table === "billing_plans" && call.op === "select") {
        return {
          data: { id: "plan-1", included_assets: 10, included_credits: 100 },
          error: null,
        };
      }
      if (call.table === "billing_subscriptions" && call.op === "select") {
        return { data: null, error: null };
      }
      if (call.table === "billing_subscriptions" && call.op === "insert") {
        return { data: { id: "local-1" }, error: null };
      }
      return { error: null };
    });

    const response = await post(
      {
        id: "evt_checkout",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_1",
            subscription: "sub_123",
            metadata: { tenant_id: "tenant-1", plan_code: "PRO" },
          },
        },
      },
      "t=1,v1=present",
    );
    expect(response.status).toBe(200);
    const insert = supabase.calls.find(
      (call) => call.table === "billing_subscriptions" && call.op === "insert",
    );
    expect(insert?.payload).toMatchObject({
      tenant_id: "tenant-1",
      plan_id: "plan-1",
      status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_123",
    });
    const limits = supabase.calls.find((call) => call.table === "subscription_limits");
    expect(limits?.payload).toMatchObject({
      subscription_id: "local-1",
      included_assets: 10,
      included_credits: 100,
      remaining_credits: 100,
    });
    const meta = supabase.calls.find(
      (call) => call.table === "billing_subscriptions" && call.op === "update",
    );
    expect(meta?.payload).toMatchObject({
      metadata: {
        stripe_base_item_id: "si_base",
        stripe_credits_item_id: "si_credits",
        plan_code: "PRO",
      },
    });
    const fetchUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(fetchUrl).toBe("https://api.stripe.com/v1/subscriptions/sub_123");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer sk_test_fake",
    });
  });

  it("updates an existing subscription instead of inserting a second one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonFetchResult({
          id: "sub_123",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          items: { data: [] },
        }),
      ),
    );
    supabase.setFrom((call) => {
      if (call.table === "billing_plans") {
        return { data: { id: "plan-1", included_assets: 1, included_credits: 1 }, error: null };
      }
      if (call.table === "billing_subscriptions" && call.op === "select") {
        return { data: { id: "local-existing" }, error: null };
      }
      return { error: null };
    });
    await post(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_1",
            subscription: "sub_123",
            metadata: { tenant_id: "tenant-1", plan_code: "PRO" },
          },
        },
      },
      "t=1,v1=present",
    );
    expect(
      supabase.calls.filter((call) => call.table === "billing_subscriptions" && call.op === "insert"),
    ).toHaveLength(0);
    expect(
      supabase.calls.find(
        (call) =>
          call.table === "billing_subscriptions" &&
          call.op === "update" &&
          eqValue(call, "id") === "local-existing",
      )?.payload,
    ).toMatchObject({ status: "active", stripe_customer_id: "cus_1" });
  });

  it("returns 400 when a subscription update has no period timestamps", async () => {
    const response = await post(
      {
        type: "customer.subscription.updated",
        data: { object: { id: "sub_1", status: "active" } },
      },
      "t=1,v1=present",
    );
    expect(response.status).toBe(400);
  });

  // BUG: supabase/functions/stripe-webhook/index.ts:15-23 reads Stripe-Signature
  // and STRIPE_WEBHOOK_SECRET, then JSON.parses the body without computing the
  // HMAC. Impact: anyone who can reach the function can forge invoice.paid and
  // checkout.session.completed and change billing rows.
  it.fails("BUG: rejects a body whose Stripe signature was computed for a different payload", async () => {
    const original = JSON.stringify({
      id: "evt_signed",
      type: "invoice.paid",
      data: { object: { id: "in_original" } },
    });
    const tampered = original.replace("in_original", "in_forged");
    const response = await post(tampered, stripeSignature(webhookSecret, original));
    expect(response.status).toBe(400);
    expect(supabase.calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  // BUG: supabase/functions/stripe-webhook/index.ts:38-41 breaks out of the
  // switch and still returns 200. Impact: Stripe will not retry, so a paid
  // checkout with missing tenant metadata never creates a subscription.
  it.fails("BUG: checkout completion without tenant metadata is not acknowledged as success", async () => {
    const response = await post(
      {
        type: "checkout.session.completed",
        data: { object: { customer: "cus_1", subscription: "sub_1", metadata: {} } },
      },
      stripeSignature(
        webhookSecret,
        JSON.stringify({
          type: "checkout.session.completed",
          data: { object: { customer: "cus_1", subscription: "sub_1", metadata: {} } },
        }),
      ),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(supabase.calls).toHaveLength(0);
  });

  // BUG: supabase/functions/stripe-webhook/index.ts:77-80 then falls through to
  // the 200 at line 265. Impact: an unknown plan code drops the checkout forever.
  it.fails("BUG: checkout completion for an unknown plan is not acknowledged as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonFetchResult({
          id: "sub_123",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          items: { data: [] },
        }),
      ),
    );
    supabase.setFrom(() => ({ data: null, error: null }));
    const response = await post(
      {
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_1",
            subscription: "sub_123",
            metadata: { tenant_id: "tenant-1", plan_code: "NO-SUCH-PLAN" },
          },
        },
      },
      "t=1,v1=present",
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
