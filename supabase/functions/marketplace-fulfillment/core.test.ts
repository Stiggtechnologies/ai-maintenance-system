import { describe, expect, it } from "vitest";
import {
  marketplaceActivateUrl,
  marketplaceResolveUrl,
  marketplaceSubscriptionUrl,
  normalizeMarketplaceSubscription,
  parseMarketplaceRequest,
  publicSubscription,
  shouldActivateMarketplaceSubscription,
  verifiedAzureTenantId,
} from "./core";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const purchaserTenantId = "33333333-3333-4333-8333-333333333333";

const marketplaceResponse = {
  id: subscriptionId,
  name: "SyncAI Enterprise",
  publisherId: "syncai-publisher",
  offerId: "syncai-enterprise",
  planId: "enterprise",
  quantity: 25,
  term: { termUnit: "P1M" },
  saasSubscriptionStatus: "PendingFulfillmentStart",
  beneficiary: {
    tenantId,
    objectId: "44444444-4444-4444-8444-444444444444",
    emailId: "must-not-leave-the-server@example.com",
  },
  purchaser: {
    tenantId: purchaserTenantId,
    objectId: "55555555-5555-4555-8555-555555555555",
    emailId: "also-private@example.com",
  },
};

describe("Azure Marketplace Fulfillment v2 contract", () => {
  it("accepts only the three strict client request shapes", () => {
    expect(
      parseMarketplaceRequest({
        action: "resolve",
        token: "encoded-marketplace-purchase-token",
      }),
    ).toEqual({
      action: "resolve",
      token: "encoded-marketplace-purchase-token",
    });
    expect(
      parseMarketplaceRequest({
        action: "activate",
        resolutionId: subscriptionId,
        activationToken: "a".repeat(43),
      }),
    ).toEqual({
      action: "activate",
      resolutionId: subscriptionId,
      activationToken: "a".repeat(43),
    });
    expect(
      parseMarketplaceRequest({
        action: "status",
        resolutionId: subscriptionId,
        activationToken: "b".repeat(43),
      }),
    ).not.toBeNull();
    expect(
      parseMarketplaceRequest({ action: "resolve", token: "short" }),
    ).toBeNull();
    expect(
      parseMarketplaceRequest({
        action: "activate",
        subscriptionId,
        planId: "client-controlled-plan",
      }),
    ).toBeNull();
  });

  it("normalizes Microsoft's response and rejects malformed status or quantity", () => {
    const normalized = normalizeMarketplaceSubscription(marketplaceResponse);
    expect(normalized).toMatchObject({
      subscriptionId,
      planId: "enterprise",
      quantity: 25,
      termUnit: "P1M",
      status: "PendingFulfillmentStart",
      beneficiary: { tenantId },
      purchaser: { tenantId: purchaserTenantId },
    });
    expect(
      normalizeMarketplaceSubscription({
        ...marketplaceResponse,
        saasSubscriptionStatus: "Invented",
      }),
    ).toBeNull();
    expect(
      normalizeMarketplaceSubscription({ ...marketplaceResponse, quantity: 0 }),
    ).toBeNull();
  });

  it("returns only non-personal subscription fields to the browser", () => {
    const normalized = normalizeMarketplaceSubscription(marketplaceResponse);
    expect(normalized).not.toBeNull();
    const exposed = publicSubscription(normalized!);
    expect(exposed).toEqual({
      id: subscriptionId,
      name: "SyncAI Enterprise",
      publisherId: "syncai-publisher",
      offerId: "syncai-enterprise",
      planId: "enterprise",
      quantity: 25,
      termUnit: "P1M",
      status: "PendingFulfillmentStart",
    });
    expect(JSON.stringify(exposed)).not.toMatch(
      /beneficiary|purchaser|email|objectId/i,
    );
  });

  it("uses the documented v2 endpoints and POST activation target", () => {
    expect(marketplaceResolveUrl()).toBe(
      "https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=2018-08-31",
    );
    expect(marketplaceActivateUrl(subscriptionId)).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/activate?api-version=2018-08-31`,
    );
    expect(marketplaceSubscriptionUrl(subscriptionId)).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}?api-version=2018-08-31`,
    );
  });

  it("activates only a still-pending subscription so ambiguous retries are safe", () => {
    expect(
      shouldActivateMarketplaceSubscription(
        "activate",
        true,
        "PendingFulfillmentStart",
      ),
    ).toBe(true);
    expect(
      shouldActivateMarketplaceSubscription("activate", true, "Subscribed"),
    ).toBe(false);
    expect(
      shouldActivateMarketplaceSubscription("activate", true, "Suspended"),
    ).toBe(false);
    expect(
      shouldActivateMarketplaceSubscription(
        "status",
        true,
        "PendingFulfillmentStart",
      ),
    ).toBe(false);
  });

  it("derives one tenant only from an Azure-backed Auth-server user", () => {
    expect(
      verifiedAzureTenantId({
        app_metadata: { provider: "azure" },
        user_metadata: {
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        },
      }),
    ).toBe(tenantId);
    expect(
      verifiedAzureTenantId({
        app_metadata: { provider: "email" },
        user_metadata: { tenant_id: tenantId },
      }),
    ).toBeNull();
    expect(
      verifiedAzureTenantId({
        app_metadata: { providers: ["azure"] },
        user_metadata: { tenant_id: tenantId },
        identities: [
          {
            provider: "azure",
            identity_data: { tenant_id: purchaserTenantId },
          },
        ],
      }),
    ).toBeNull();
  });
});
