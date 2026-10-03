import { describe, expect, it } from "vitest";
import {
  buildMeteringBatchRequest,
  isRetryableMeteringHttpStatus,
  marketplaceMeteringBatchUrl,
  normalizeMeteringBatchResponse,
  normalizeMeteringClaim,
} from "./core";

const claim = normalizeMeteringClaim({
  claimToken: "11111111-1111-4111-8111-111111111111",
  events: [
    {
      recordId: "22222222-2222-4222-8222-222222222222",
      resourceId: "33333333-3333-4333-8333-333333333333",
      dimension: "ai_credits",
      quantity: 12.5,
      effectiveStartTime: "2026-09-29T13:00:00.000Z",
      planId: "enterprise-plus",
    },
  ],
})!;

describe("Azure Marketplace hourly metering contract", () => {
  it("uses Microsoft's singular batch endpoint and resourceId schema", () => {
    expect(marketplaceMeteringBatchUrl()).toBe(
      "https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=2018-08-31",
    );
    expect(buildMeteringBatchRequest(claim)).toEqual({
      request: [
        {
          resourceId: "33333333-3333-4333-8333-333333333333",
          dimension: "ai_credits",
          quantity: 12.5,
          effectiveStartTime: "2026-09-29T13:00:00.000Z",
          planId: "enterprise-plus",
        },
      ],
    });
  });

  it("refuses malformed, duplicate, empty, and oversized claims", () => {
    expect(
      normalizeMeteringClaim({ claimToken: "bad", events: [] }),
    ).toBeNull();
    expect(
      normalizeMeteringClaim({
        claimToken: claim.claimToken,
        events: Array.from({ length: 26 }, (_, index) => ({
          ...claim.events[0],
          recordId: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
        })),
      }),
    ).toBeNull();
    expect(
      normalizeMeteringClaim({
        claimToken: claim.claimToken,
        events: [claim.events[0], claim.events[0]],
      }),
    ).toBeNull();
  });

  it("preserves an accepted result only when Microsoft echoes the exact event", () => {
    const response = {
      count: 1,
      result: [
        {
          ...buildMeteringBatchRequest(claim).request[0],
          usageEventId: "44444444-4444-4444-8444-444444444444",
          status: "Accepted",
          messageTime: "2026-09-29T14:06:00Z",
          futureField: true,
        },
      ],
    };
    expect(normalizeMeteringBatchResponse(response, claim)).toMatchObject([
      {
        recordId: claim.events[0].recordId,
        status: "Accepted",
        acceptedQuantity: 12.5,
        exactDuplicate: false,
      },
    ]);
    expect(
      normalizeMeteringBatchResponse(
        {
          ...response,
          result: [{ ...response.result[0], quantity: 99 }],
        },
        claim,
      ),
    ).toBeNull();
  });

  it("distinguishes an exact retry duplicate from an out-of-band conflict", () => {
    const acceptedMessage = {
      ...buildMeteringBatchRequest(claim).request[0],
      usageEventId: "44444444-4444-4444-8444-444444444444",
      status: "Duplicate",
      messageTime: "2026-09-29T14:06:00Z",
    };
    const exact = normalizeMeteringBatchResponse(
      {
        count: 1,
        result: [
          {
            ...buildMeteringBatchRequest(claim).request[0],
            status: "Duplicate",
            error: { additionalInfo: { acceptedMessage } },
          },
        ],
      },
      claim,
    );
    expect(exact?.[0].exactDuplicate).toBe(true);
    const conflict = normalizeMeteringBatchResponse(
      {
        count: 1,
        result: [
          {
            ...buildMeteringBatchRequest(claim).request[0],
            status: "Duplicate",
            error: {
              additionalInfo: {
                acceptedMessage: { ...acceptedMessage, quantity: 7 },
              },
            },
          },
        ],
      },
      claim,
    );
    expect(conflict?.[0].exactDuplicate).toBe(false);
  });

  it("retries only transport-class failures", () => {
    expect(isRetryableMeteringHttpStatus(429)).toBe(true);
    expect(isRetryableMeteringHttpStatus(503)).toBe(true);
    expect(isRetryableMeteringHttpStatus(400)).toBe(false);
    expect(isRetryableMeteringHttpStatus(401)).toBe(false);
  });
});
