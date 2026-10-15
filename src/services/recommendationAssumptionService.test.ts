import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getRecommendationAssumptionPacket,
  recordRecommendationAssumptions,
} from "./recommendationAssumptionService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recommendationAssumptionService", () => {
  it("loads one tenant-scoped packet through the canonical RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        recommendationId: "rec-1",
        recommendationTitle: "Validate seal failure mechanism",
        recommendationStatus: "pending",
        packet: null,
        recordedBy: null,
        recordedByName: null,
        recordedAt: null,
        valid: false,
        boundary: "Does not approve the recommendation.",
        operationalAuthorization: false,
      },
      error: null,
    });

    const result = await getRecommendationAssumptionPacket("rec-1");
    expect(result.valid).toBe(false);
    expect(rpc).toHaveBeenCalledWith("get_recommendation_assumption_packet", {
      p_recommendation_id: "rec-1",
    });
  });

  it("passes the exact human-authored packet and note to the governed writer", async () => {
    rpc.mockResolvedValue({
      data: {
        recommendationId: "rec-1",
        disposition: "recorded",
        packetSha256: "a".repeat(64),
        recordedBy: "user-1",
        recordedAt: "2026-10-02T00:00:00Z",
      },
      error: null,
    });
    const packet = {
      disposition: "recorded" as const,
      basis: "The observed startup pattern is not yet a verified mechanism.",
      items: [
        {
          statement: "Solids exposure continues during future startups.",
          basis:
            "Recent events cluster after startup under intermittent solids.",
          consequence_if_wrong:
            "The proposed inspection window may target the wrong exposure.",
          validation_method:
            "Measure solids and seal condition through ten representative starts.",
        },
      ],
    };

    await recordRecommendationAssumptions({
      recommendationId: "rec-1",
      packet,
      note: "Recorded for technical-authority review before any release decision.",
    });

    expect(rpc).toHaveBeenCalledWith("record_recommendation_assumptions", {
      p_recommendation_id: "rec-1",
      p_packet: packet,
      p_note:
        "Recorded for technical-authority review before any release decision.",
    });
  });

  it("surfaces an in-band server refusal instead of treating it as success", async () => {
    rpc.mockResolvedValue({
      data: {
        error:
          "recording recommendation assumptions is a named-human engineering judgement",
      },
      error: null,
    });

    await expect(
      recordRecommendationAssumptions({
        recommendationId: "rec-1",
        packet: {
          disposition: "none_identified",
          basis:
            "The complete evidence set and decision boundary were reviewed by the accountable engineer.",
          items: [],
        },
        note: "Reviewed for the current decision scope and evidence revision.",
      }),
    ).rejects.toThrow(/named-human engineering judgement/i);
  });
});
