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

const event = {
  message_id: "sqs-1",
  event: {
    action: "subscribe-success" as const,
    "customer-identifier": "cust-1",
    "product-code": "prod-1",
  },
};

describe("marketplace-aws-webhook edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/marketplace-aws-webhook/index.ts", {
      ...edgeBaseEnv,
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble(() => ({ error: null }));
    edge.createClient = supabase.createClient;
    edge.env.SUPABASE_URL = edgeBaseEnv.SUPABASE_URL;
    edge.env.SUPABASE_SERVICE_ROLE_KEY = edgeBaseEnv.SUPABASE_SERVICE_ROLE_KEY;
    edge.env.AWS_MARKETPLACE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const webhookSecret = "aws-webhook-test";

  function post(body: unknown, options?: { auth?: false; signature?: string }) {
    const headers: Record<string, string> = {};
    if (options?.auth !== false) headers.Authorization = `Bearer ${webhookSecret}`;
    if (options?.signature) headers["x-aws-marketplace-signature"] = options.signature;
    return edge.invoke(edgeRequest("marketplace-aws-webhook", "", { method: "POST", body, headers }));
  }

  it("answers CORS preflight", async () => {
    const response = await edge.invoke(
      edgeRequest("marketplace-aws-webhook", "", { method: "OPTIONS" }),
    );
    expect(response.status).toBe(200);
    expect(supabase.clients).toHaveLength(0);
  });

  it("rejects non-POST methods", async () => {
    const response = await edge.invoke(edgeRequest("marketplace-aws-webhook", "", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("requires the idempotency key and the customer identifier", async () => {
    expect((await readJson(await post({}))).error).toMatch(/message_id/);
    expect(
      (await readJson(await post({ message_id: "sqs-1", event: { action: "subscribe-success" } })))
        .error,
    ).toMatch(/customer-identifier/);
    expect(supabase.calls).toHaveLength(0);
  });

  it("rejects an unknown lifecycle action before writing", async () => {
    const response = await post({
      message_id: "sqs-1",
      event: { action: "invented", "customer-identifier": "cust-1" },
    });
    expect(response.status).toBe(400);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("returns 500 when the service role is not configured", async () => {
    edge.env.SUPABASE_SERVICE_ROLE_KEY = undefined;
    const response = await post(event);
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/misconfigured/);
  });

  it.each([
    ["subscribe-success", "aws_subscribed", "active"],
    ["unsubscribe-pending", "aws_unsubscribe_pending", "cancelled"],
    ["unsubscribe-success", "aws_unsubscribed", "cancelled"],
    ["subscribe-fail", "aws_expired", "cancelled"],
  ])("applies %s as %s / %s", async (action, awsStatus, status) => {
    const response = await post({
      message_id: `sqs-${action}`,
      event: { action, "customer-identifier": "cust-1" },
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action, new_status: awsStatus });
    const update = supabase.calls.find(
      (call) => call.table === "billing_subscriptions" && call.op === "update",
    );
    expect(update?.payload).toEqual({ aws_status: awsStatus, status });
    expect(eqValue(update!, "aws_customer_identifier")).toBe("cust-1");
    const logged = supabase.calls.find((call) => call.table === "aws_marketplace_events" && call.op === "insert");
    expect(logged?.payload).toMatchObject({ message_id: `sqs-${action}`, action, status: "pending" });
  });

  it("treats a duplicate message id as success and does not change the subscription", async () => {
    supabase.setFrom((call) => {
      if (call.op === "insert") return { error: { message: "unique violation", code: "23505" } };
      return { error: null };
    });
    const response = await post(event);
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(supabase.calls.filter((call) => call.table === "billing_subscriptions")).toHaveLength(0);
  });

  it("records the event as failed when the subscription update fails", async () => {
    supabase.setFrom((call) => {
      if (call.table === "billing_subscriptions") return { error: { message: "update failed" } };
      return { error: null };
    });
    const response = await post(event);
    expect(response.status).toBe(500);
    const failure = supabase.calls.find(
      (call) => call.table === "aws_marketplace_events" && call.op === "update",
    );
    expect(failure?.payload).toMatchObject({ status: "failure", error_message: "update failed" });
    expect(eqValue(failure!, "message_id")).toBe("sqs-1");
  });

  it("returns the log error when the insert fails for a reason other than a duplicate", async () => {
    supabase.setFrom((call) =>
      call.op === "insert" ? { error: { message: "permission denied", code: "42501" } } : { error: null },
    );
    const response = await post(event);
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/permission denied/);
    expect(supabase.calls.filter((call) => call.table === "billing_subscriptions")).toHaveLength(0);
  });

  // BUG: supabase/functions/marketplace-aws-webhook/index.ts:48-66 accepts any
  // POST. There is no SNS signature, shared secret, or tenant check before
  // billing_subscriptions is updated. Impact: an anonymous caller can set a
  // customer's AWS subscription to active or cancelled.
  it("BUG: a lifecycle event without a shared secret or signature is rejected", async () => {
    const response = await post(event, { auth: false });
    expect(response.status).toBe(401);
    expect(supabase.calls.filter((call) => call.table === "billing_subscriptions")).toHaveLength(0);
  });

  it("accepts an HMAC of the raw body when the shared secret is not sent as a bearer", async () => {
    const { createHmac } = await import("node:crypto");
    const raw = JSON.stringify(event);
    const signature = createHmac("sha256", webhookSecret).update(raw).digest("hex");
    const response = await edge.invoke(
      edgeRequest("marketplace-aws-webhook", "", {
        method: "POST",
        body: raw,
        headers: { "x-aws-marketplace-signature": signature },
      }),
    );
    expect(response.status).toBe(200);
    expect((await readJson(response)).new_status).toBe("aws_subscribed");
  });
});
