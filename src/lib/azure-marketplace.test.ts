import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock("./supabase-config", () => ({
  supabaseUrl: "https://project.supabase.co",
  supabasePublicKey: "public-anon-key",
}));

import {
  activateMarketplaceSubscription,
  getMarketplaceSubscriptionStatus,
  marketplaceContext,
  parseMarketplaceContext,
  resolveMarketplaceToken,
  type MarketplaceFulfillmentContext,
} from "./azure-marketplace";

const resolutionId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const subscription = {
  id: subscriptionId,
  name: "SyncAI Enterprise",
  publisherId: "syncai-publisher",
  offerId: "syncai-enterprise",
  planId: "enterprise",
  quantity: 10,
  termUnit: "P1M",
  status: "PendingFulfillmentStart" as const,
};
const context: MarketplaceFulfillmentContext = {
  version: 1,
  resolutionId,
  activationToken: "a".repeat(43),
  subscription,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Azure Marketplace browser boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "verified-user-jwt" } },
      error: null,
    });
  });

  it("resolves through the SyncAI Edge Function with the public platform JWT", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        resolutionId,
        activationToken: "a".repeat(43),
        state: "resolved",
        bound: false,
        subscription,
      }),
    );

    const result = await resolveMarketplaceToken(
      "encoded-purchase-token-value",
    );

    expect(result.subscription).toEqual(subscription);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://project.supabase.co/functions/v1/marketplace-fulfillment",
    );
    expect(url).not.toContain("marketplaceapi.microsoft.com");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toMatchObject({
      apikey: "public-anon-key",
      Authorization: "Bearer public-anon-key",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      action: "resolve",
      token: "encoded-purchase-token-value",
    });
  });

  it("activates only with the verified user session and opaque internal proof", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        resolutionId,
        state: "active",
        subscription: { ...subscription, status: "Subscribed" },
      }),
    );

    const result = await activateMarketplaceSubscription(context);

    expect(result.state).toBe("active");
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).not.toContain("microsoft.com");
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer verified-user-jwt",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      action: "activate",
      resolutionId,
      activationToken: "a".repeat(43),
    });
    expect(String(request?.body)).not.toContain(subscriptionId);
    expect(String(request?.body)).not.toContain("planId");
  });

  it("uses the same bound proof for a Microsoft-authoritative status refresh", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        resolutionId,
        state: "activation_pending",
        subscription,
      }),
    );

    await getMarketplaceSubscriptionStatus(context);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      action: "status",
      resolutionId,
      activationToken: "a".repeat(43),
    });
  });

  it("fails closed when no verified application session exists", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(activateMarketplaceSubscription(context)).rejects.toThrow(
      "Microsoft session is unavailable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("round-trips only a validated, versioned continuation context", () => {
    const result = {
      resolutionId,
      activationToken: "a".repeat(43),
      state: "resolved",
      bound: false,
      subscription,
    };
    expect(
      parseMarketplaceContext(JSON.stringify(marketplaceContext(result))),
    ).toEqual(context);
    expect(
      parseMarketplaceContext(
        JSON.stringify({ ...context, activationToken: "short" }),
      ),
    ).toBeNull();
    expect(parseMarketplaceContext("not-json")).toBeNull();
  });
});
