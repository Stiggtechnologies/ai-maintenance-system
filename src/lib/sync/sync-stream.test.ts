import { describe, expect, it, vi } from "vitest";
import {
  createSyncEventStream,
  encodeSseFrame,
  sseHeaders,
} from "../../../supabase/functions/_shared/sync-stream";
import {
  SYNC_STREAM_EVENT_TYPES,
  isTerminalEvent,
  parseSyncStreamEvent,
  type SyncStreamEvent,
} from "../../types/sync-stream";
import { createSseFrameParser } from "../../hooks/useSyncStream";

const SAMPLE_EVENTS: SyncStreamEvent[] = [
  { type: "turn.started", turnId: "t-1" },
  { type: "investigation.started", turnId: "t-1", plannedChecks: 2 },
  {
    type: "investigation.check.started",
    checkId: "kpi",
    label: "Operational KPIs",
    category: "operations",
  },
  {
    type: "investigation.check.completed",
    check: {
      id: "kpi",
      label: "Operational KPIs reviewed",
      category: "operations",
      state: "ok",
      detail: "14 current indicators",
      durationMs: 25,
    },
  },
  {
    type: "investigation.completed",
    checks: [
      {
        id: "kpi",
        label: "Operational KPIs reviewed",
        category: "operations",
        state: "ok",
      },
    ],
    evidence: [{ id: "L1", sourceType: "kpi", sourceId: "availability" }],
  },
  { type: "transcript.partial", text: "why has this as" },
  { type: "transcript.final", text: "why has this asset been unreliable?" },
  { type: "assistant.delta", text: "Looking at the failure history, ", sequence: 1 },
  {
    type: "assistant.block",
    block: { kind: "facts", items: ["Five seal leaks in twelve months"] },
  },
  { type: "retrieval.started", query: "P-101 seal failures" },
  {
    type: "retrieval.completed",
    evidence: [{ id: "R1", sourceType: "work_order", sourceId: "wo-9" }],
  },
  {
    type: "agent.started",
    agentId: "rca-fracas",
    label: "RCA / FRACAS specialist",
    executionMode: "executed",
  },
  {
    type: "agent.completed",
    agentId: "rca-fracas",
    label: "RCA / FRACAS specialist",
    status: "success",
    executionMode: "executed",
    durationMs: 310,
  },
  {
    type: "telemetry.updated",
    telemetry: { firstActivityMs: 10, firstTokenMs: 600 },
  },
  {
    type: "tool.proposed",
    proposal: {
      proposalId: "p-1",
      toolId: "create_inspection",
      title: "Create inspection",
    },
  },
  { type: "tool.awaiting_approval", proposalId: "p-1" },
  { type: "tool.started", executionId: "x-1" },
  { type: "tool.completed", executionId: "x-1", result: { id: "insp-4" } },
  { type: "tts.started", audioId: "a-1" },
  { type: "tts.stopped", audioId: "a-1" },
  {
    type: "turn.completed",
    turnId: "t-1",
    telemetry: { totalMs: 900, checkCount: 1, sourceCount: 2 },
  },
  {
    type: "error",
    code: "RETRIEVAL_TIMEOUT",
    message: "kb slow",
    recoverable: true,
  },
];

describe("Sync wire event union", () => {
  it("has one representative sample for every declared event type", () => {
    expect(SAMPLE_EVENTS.map((event) => event.type).sort()).toEqual(
      [...SYNC_STREAM_EVENT_TYPES].sort(),
    );
  });

  it("round-trips every event through the exact SSE encoder/parser", () => {
    for (const event of SAMPLE_EVENTS) {
      const parser = createSseFrameParser();
      const payloads = parser.push(encodeSseFrame(event));
      expect(payloads).toHaveLength(1);
      expect(parseSyncStreamEvent(payloads[0])).toEqual(event);
    }
  });

  it("survives arbitrary frame chunk boundaries", () => {
    const wire = SAMPLE_EVENTS.map(encodeSseFrame).join("");
    for (const chunkSize of [1, 3, 11, 80, wire.length]) {
      const parser = createSseFrameParser();
      const payloads: string[] = [];
      for (let index = 0; index < wire.length; index += chunkSize) {
        payloads.push(...parser.push(wire.slice(index, index + chunkSize)));
      }
      payloads.push(...parser.flush());
      expect(payloads.map(parseSyncStreamEvent)).toEqual(SAMPLE_EVENTS);
    }
  });
});

describe("parseSyncStreamEvent", () => {
  it("skips unknown or malformed future payloads without crashing the turn", () => {
    expect(parseSyncStreamEvent({ type: "future.event", x: 1 })).toBeNull();
    expect(parseSyncStreamEvent("{not json")).toBeNull();
    expect(parseSyncStreamEvent(42)).toBeNull();
    expect(parseSyncStreamEvent(null)).toBeNull();
    expect(parseSyncStreamEvent([{ type: "turn.started" }])).toBeNull();
  });
});

describe("isTerminalEvent", () => {
  it("only ends on turn completion or unrecoverable error", () => {
    expect(isTerminalEvent({ type: "turn.completed", turnId: "t" })).toBe(true);
    expect(
      isTerminalEvent({
        type: "error",
        code: "MODEL_DOWN",
        message: "m",
        recoverable: false,
      }),
    ).toBe(true);
    expect(
      isTerminalEvent({
        type: "error",
        code: "RETRY",
        message: "m",
        recoverable: true,
      }),
    ).toBe(false);
  });
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("createSyncEventStream", () => {
  it("streams and closes cleanly", async () => {
    const stream = createSyncEventStream();
    expect(stream.send({ type: "turn.started", turnId: "t-9" })).toBe(true);
    expect(
      stream.send({
        type: "investigation.check.completed",
        check: {
          id: "safety",
          label: "Safety indicators cross-checked",
          category: "safety",
          state: "ok",
        },
      }),
    ).toBe(true);
    expect(stream.send({ type: "turn.completed", turnId: "t-9" })).toBe(true);
    stream.close();
    const parser = createSseFrameParser();
    const parsed = parser
      .push(await readAll(stream.readable))
      .map(parseSyncStreamEvent);
    expect(parsed).toHaveLength(3);
  });

  it("cancellation stops producers exactly once", async () => {
    const onCancel = vi.fn();
    const stream = createSyncEventStream({ onCancel });
    await stream.readable.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(stream.send({ type: "assistant.delta", text: "late" })).toBe(false);
    stream.close();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("sseHeaders", () => {
  const allowed = ["https://app.syncai.ca", "http://localhost:5173"];
  it("keeps the stream private and origin-scoped", () => {
    const headers = sseHeaders("http://localhost:5173", allowed);
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
});
