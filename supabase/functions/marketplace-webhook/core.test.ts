import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_RESOURCE_ID,
  marketplaceOperationUrl,
  marketplaceSubscriptionUrl,
  normalizeMarketplaceOperation,
  parseMarketplaceWebhook,
  requiresOperationAcknowledgement,
  validateMarketplaceWebhookClaims,
  webhookMatchesOperation,
} from "./core";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
const clientId = "44444444-4444-4444-8444-444444444444";

const webhook = {
  id: operationId,
  activityId: "55555555-5555-4555-8555-555555555555",
  subscriptionId,
  publisherId: "syncai-publisher",
  offerId: "syncai-enterprise",
  planId: "enterprise-plus",
  quantity: 40,
  action: "ChangePlan",
  status: "InProgress",
  timeStamp: "2026-09-29T12:00:00Z",
  operationRequestSource: "Azure",
  futureMicrosoftField: { accepted: true },
};

describe("Azure Marketplace lifecycle webhook contract", () => {
  it("parses required fields without rejecting Microsoft schema extensions", () => {
    expect(parseMarketplaceWebhook(webhook)).toMatchObject({
      operationId,
      subscriptionId,
      action: "ChangePlan",
      planId: "enterprise-plus",
      quantity: 40,
    });
    expect(
      parseMarketplaceWebhook({ ...webhook, id: "not-a-guid" }),
    ).toBeNull();
    expect(
      parseMarketplaceWebhook({ ...webhook, action: "Invented" }),
    ).toBeNull();
    expect(parseMarketplaceWebhook({ ...webhook, quantity: 0 })).toBeNull();
  });

  it("normalizes the authoritative Get Operation response", () => {
    expect(normalizeMarketplaceOperation(webhook)).toEqual({
      operationId,
      subscriptionId,
      publisherId: "syncai-publisher",
      offerId: "syncai-enterprise",
      planId: "enterprise-plus",
      quantity: 40,
      action: "ChangePlan",
      status: "InProgress",
    });
    expect(
      normalizeMarketplaceOperation({ ...webhook, status: "Unknown" }),
    ).toBeNull();
  });

  it("requires the webhook envelope to match Get Operation exactly", () => {
    const parsed = parseMarketplaceWebhook(webhook)!;
    const operation = normalizeMarketplaceOperation(webhook)!;
    expect(webhookMatchesOperation(parsed, operation)).toBe(true);
    expect(
      webhookMatchesOperation(parsed, {
        ...operation,
        planId: "attacker-controlled-plan",
      }),
    ).toBe(false);
  });

  it("validates the documented audience, Microsoft caller, tenant, and issuer claims", () => {
    expect(
      validateMarketplaceWebhookClaims(
        {
          aud: clientId,
          azp: MARKETPLACE_RESOURCE_ID,
          tid: tenantId,
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        },
        { clientId, tenantId },
      ),
    ).toBe(true);
    expect(
      validateMarketplaceWebhookClaims(
        {
          aud: "foreign-audience",
          azp: MARKETPLACE_RESOURCE_ID,
          tid: tenantId,
          iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        },
        { clientId, tenantId },
      ),
    ).toBe(false);
    expect(
      validateMarketplaceWebhookClaims(
        {
          aud: clientId,
          appid: "foreign-caller",
          tid: tenantId,
          iss: `https://sts.windows.net/${tenantId}/`,
        },
        { clientId, tenantId },
      ),
    ).toBe(false);
  });

  it("uses only the v2 operation and subscription endpoints", () => {
    expect(marketplaceOperationUrl(subscriptionId, operationId)).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}/operations/${operationId}?api-version=2018-08-31`,
    );
    expect(marketplaceSubscriptionUrl(subscriptionId)).toBe(
      `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${subscriptionId}?api-version=2018-08-31`,
    );
  });

  it("acknowledges only Microsoft's operation-controlled lifecycle changes", () => {
    expect(requiresOperationAcknowledgement("ChangePlan")).toBe(true);
    expect(requiresOperationAcknowledgement("ChangeQuantity")).toBe(true);
    expect(requiresOperationAcknowledgement("Reinstate")).toBe(true);
    expect(requiresOperationAcknowledgement("Renew")).toBe(false);
    expect(requiresOperationAcknowledgement("Suspend")).toBe(false);
    expect(requiresOperationAcknowledgement("Unsubscribe")).toBe(false);
  });
});
