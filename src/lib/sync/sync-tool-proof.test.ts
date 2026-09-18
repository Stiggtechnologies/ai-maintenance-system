import { describe, expect, it } from "vitest";
import {
  canonicalProposalPayload,
  decideToolReservation,
  hasCanonicalIdempotencyKey,
  isTerminalToolExecutionStatus,
  proposalIsUnexpired,
  proposalParamsHash,
  SYNC_TOOL_EXECUTION_ENTITY,
  SYNC_TOOL_EXECUTION_RESULT_ENTITY,
  toolExecutionResultEventData,
  toolReservationEventData,
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

describe("Sync tool execution reservation (append-only ledger)", () => {
  const reservation = {
    id: "reserve-1",
    eventData: toolReservationEventData({
      idempotencyKey: "proposal-1",
      proposalId: "proposal-1",
      toolId: "raise_maintenance_notification",
    }),
  };
  const completed = {
    id: "result-1",
    eventData: toolExecutionResultEventData({
      status: "completed",
      idempotencyKey: "proposal-1",
      proposalId: "proposal-1",
      toolId: "raise_maintenance_notification",
      reservationId: "reserve-1",
      result: { id: "notification-1", status: "open" },
    }),
  };

  it("reserves on the first confirmation", () => {
    expect(decideToolReservation({})).toEqual({ action: "proceed" });
    expect(reservation.eventData.status).toBe("running");
    expect(SYNC_TOOL_EXECUTION_ENTITY).toBe("sync_tool_execution");
    expect(SYNC_TOOL_EXECUTION_RESULT_ENTITY).toBe(
      "sync_tool_execution_result",
    );
  });

  it("replays a completed result instead of treating the running reservation as a conflict", () => {
    expect(
      decideToolReservation({ reservation, result: completed }),
    ).toEqual({
      action: "replay",
      reservationId: "reserve-1",
      result: { id: "notification-1", status: "open" },
    });
  });

  it("replays a refused result so idempotent retry does not throw already_reserved", () => {
    const refused = {
      id: "result-refused",
      eventData: toolExecutionResultEventData({
        status: "refused",
        idempotencyKey: "proposal-1",
        proposalId: "proposal-1",
        toolId: "raise_maintenance_notification",
        reservationId: "reserve-1",
        result: { error: "choose the equipment this was observed on" },
      }),
    };
    expect(isTerminalToolExecutionStatus("refused")).toBe(true);
    expect(decideToolReservation({ reservation, result: refused })).toEqual({
      action: "replay",
      reservationId: "reserve-1",
      result: { error: "choose the equipment this was observed on" },
    });
  });

  it("keeps an in-flight reservation exclusive until a terminal result is appended", () => {
    expect(decideToolReservation({ reservation })).toEqual({
      action: "in_progress",
    });
  });

  it("still replays a legacy reservation row that was updated to completed before the ledger became append-only", () => {
    expect(
      decideToolReservation({
        reservation: {
          id: "legacy-1",
          eventData: {
            status: "completed",
            idempotency_key: "proposal-1",
            result: { id: "legacy-notification" },
          },
        },
      }),
    ).toEqual({
      action: "replay",
      reservationId: "legacy-1",
      result: { id: "legacy-notification" },
    });
  });
});
