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

const token = "amzn-registration-token-value-not-a-secret";

describe("marketplace-aws-resolve edge function", () => {
  let edge: LoadedEdgeFunction;
  let supabase: SupabaseDouble;

  beforeAll(() => {
    edge = loadEdgeFunction("supabase/functions/marketplace-aws-resolve/index.ts", {
      ...edgeBaseEnv,
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "AKIATEST",
      AWS_SECRET_ACCESS_KEY: "secret-test",
    });
  });

  beforeEach(() => {
    installNoNetworkFetch();
    supabase = createSupabaseDouble(() => ({ data: "sub-1", error: null }));
    edge.createClient = supabase.createClient;
    edge.env.SUPABASE_URL = edgeBaseEnv.SUPABASE_URL;
    edge.env.SUPABASE_SERVICE_ROLE_KEY = edgeBaseEnv.SUPABASE_SERVICE_ROLE_KEY;
    edge.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    edge.env.AWS_SECRET_ACCESS_KEY = "secret-test";
    edge.env.AWS_REGION = "us-east-1";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function post(body: unknown, method = "POST") {
    return edge.invoke(edgeRequest("marketplace-aws-resolve", "", { method, body }));
  }

  it("answers CORS preflight and rejects other methods", async () => {
    expect(
      (await edge.invoke(edgeRequest("marketplace-aws-resolve", "", { method: "OPTIONS" }))).status,
    ).toBe(200);
    expect((await edge.invoke(edgeRequest("marketplace-aws-resolve", "", { method: "PUT" }))).status).toBe(
      405,
    );
    expect(supabase.clients).toHaveLength(0);
  });

  it("requires a marketplace token before calling AWS", async () => {
    const response = await post({});
    expect(response.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns 500 when AWS credentials are not configured and does not call AWS", async () => {
    edge.env.AWS_SECRET_ACCESS_KEY = undefined;
    const response = await post({ marketplace_token: token });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/AWS credentials/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("returns 500 when Supabase is not configured", async () => {
    edge.env.SUPABASE_URL = undefined;
    const response = await post({ marketplace_token: token });
    expect(response.status).toBe(500);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("signs ResolveCustomer, stores only a token prefix, and returns the AWS error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("AccessDenied", { status: 403 })),
    );
    const response = await post({ marketplace_token: token });
    const body = await readJson(response);
    expect(response.status).toBe(502);
    expect(body.error).toContain("403");
    expect(body.error).not.toContain(token);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://metering.marketplace.us-east-1.amazonaws.com/customer");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Amz-Target"]).toBe("AWSMPMeteringService.ResolveCustomer");
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\//);
    expect(init?.body).toBe(JSON.stringify({ RegistrationToken: token }));
    const audit = supabase.calls.find((call) => call.op === "insert");
    const payload = audit?.payload as { request_payload: { token_prefix: string }; error_message: string };
    expect(payload.request_payload.token_prefix).toBe(token.slice(0, 16));
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("persists a resolved customer through the subscription RPC", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonFetchResult({
          CustomerIdentifier: "cust-1",
          CustomerAWSAccountId: "123456789012",
          ProductCode: "prod-1",
        }),
      ),
    );
    supabase.setRpc(() => ({ data: "sub-77", error: null }));
    const response = await post({ marketplace_token: token });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      subscription_id: "sub-77",
      customer_identifier: "cust-1",
      aws_account_id: "123456789012",
      product_code: "prod-1",
      status: "aws_pending_subscription",
    });
    expect(supabase.rpcCalls[0]).toMatchObject({
      name: "upsert_aws_marketplace_subscription",
      args: {
        p_customer_identifier: "cust-1",
        p_aws_account_id: "123456789012",
        p_product_code: "prod-1",
        p_status: "aws_pending_subscription",
      },
    });
    const success = supabase.calls.find((call) => call.op === "insert");
    const logged = success?.payload as { request_payload: { token_prefix: string }; status: string };
    expect(logged.status).toBe("success");
    expect(logged.request_payload.token_prefix).toHaveLength(16);
    expect(JSON.stringify(logged)).not.toContain(token);
  });

  it("returns 500 and does not claim success when the subscription RPC fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonFetchResult({ CustomerIdentifier: "cust-1", ProductCode: "prod-1" }),
      ),
    );
    supabase.setRpc(() => ({ data: null, error: { message: "rpc down" } }));
    const response = await post({ marketplace_token: token });
    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toMatch(/rpc down/);
    expect(supabase.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});
