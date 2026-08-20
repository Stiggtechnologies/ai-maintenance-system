import { describe, expect, it } from "vitest";
import {
  canonicalProposalPayload,
  hasCanonicalIdempotencyKey,
  proposalIsUnexpired,
  proposalParamsHash,
} from "../../../supabase/functions/_shared/sync-tool-proof";

describe("Sync tool proposal proof", () => {
  it("canonicalizes equivalent parameter objects identically", async () => {
    const left = await proposalParamsHash("proposal-1", "tool-1", {
      assetId: "asset-1",
      nested: { b: 2, a: 1 },
    });
    const right = await proposalParamsHash("proposal-1", "tool-1", {
      nested: { a: 1, b: 2 },
      assetId: "asset-1",
    });
    expect(left).toBe(right);
    expect(canonicalProposalPayload("p", "t", { b: 2, a: 1 })).toBe(
      '{"params":{"a":1,"b":2},"proposalId":"p","toolId":"t"}',
    );
  });

  it("detects tampering with the issued tool or parameters", async () => {
    const issued = await proposalParamsHash("proposal-1", "tool-1", {
      assetId: "asset-1",
      description: "Observed leak",
    });
    await expect(
      proposalParamsHash("proposal-1", "tool-1", {
        assetId: "asset-2",
        description: "Observed leak",
      }),
    ).resolves.not.toBe(issued);
    await expect(
      proposalParamsHash("proposal-1", "tool-2", {
        assetId: "asset-1",
        description: "Observed leak",
      }),
    ).resolves.not.toBe(issued);
  });

  it("requires the proposal id to be the idempotency key", () => {
    expect(hasCanonicalIdempotencyKey("proposal-1", "proposal-1")).toBe(true);
    expect(hasCanonicalIdempotencyKey("proposal-1", "retry-2")).toBe(false);
    expect(hasCanonicalIdempotencyKey("", "")).toBe(false);
  });

  it("rejects expired or malformed proposal windows", () => {
    const now = Date.parse("2026-08-20T09:00:00.000Z");
    expect(proposalIsUnexpired("2026-08-20T09:30:00.000Z", now)).toBe(true);
    expect(proposalIsUnexpired("2026-08-20T08:59:59.000Z", now)).toBe(false);
    expect(proposalIsUnexpired("not-a-date", now)).toBe(false);
    expect(proposalIsUnexpired(null, now)).toBe(false);
  });
});
