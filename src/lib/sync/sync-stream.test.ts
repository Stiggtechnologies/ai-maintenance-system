/**
 * Tests the EXACT files both sides of the Sync wire deploy: the Deno-free
 * edge SSE helper (supabase/functions/_shared/sync-stream.ts) and the client
 * contract (src/types/sync-stream.ts) + frame parser (useSyncStream.ts) —
 * proving they agree with each other, not with a fixture of the wire format.
 */
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

/** One representative event per §17 type — the whole union, no gaps. */
const SAMPLE_EVENTS: SyncStreamEvent[] = [
  { type: "turn.started", turnId: "t-1" },
  { type: "transcript.partial", text: "why has this as" },
  { type: "transcript.final", text: "why has this asset been unreliable?" },
  { type: "assistant.delta", text: "Looking at the failure history, " },
  {
    type: "assistant.block",
    block: { kind: "facts", items: ["Five seal leaks in twelve months"] },
  },
  { type: "retrieval.started", query: "P-101 seal failures" },
  {
    type: "retrieval.completed",
    evidence: [{ id: "e-1", sourceType: "work_order", sourceId: "wo-9" }],
  },
  { type: "agent.started", agentId: "reliability-engineer" },
  {
    type: "agent.completed",
    agentId: "reliability-engineer",
    status: "success",
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
  { type: "turn.completed", turnId: "t-1" },
  {
    type: "error",
    code: "RETRIEVAL_TIMEOUT",
    message: "kb slow",
    recoverable: true,
  },
];

describe("the §17 union and the sample set cover each other", () => {
  it("has one sample per declared event type", () => {
    expect(SAMPLE_EVENTS.map((e) => e.type).sort()).toEqual(
      [...SYNC_STREAM_EVENT_TYPES].sort(),
    );
  });
});

describe("encode → parse round-trip", () => {
  it("every event type survives the wire unchanged", () => {
    for (const event of SAMPLE_EVENTS) {
      const parser = createSseFrameParser();
      const payloads = parser.push(encodeSseFrame(event));
      expect(payloads).toHaveLength(1);
      expect(parseSyncStreamEvent(payloads[0])).toEqual(event);
    }
  });

  it("survives arbitrary chunk boundaries (frames split mid-line, mid-JSON)", () => {
    const wire = SAMPLE_EVENTS.map(encodeSseFrame).join("");
    for (const chunkSize of [1, 3, 7, 50, wire.length]) {
      const parser = createSseFrameParser();
      const payloads: string[] = [];
      for (let i = 0; i < wire.length; i += chunkSize) {
        payloads.push(...parser.push(wire.slice(i, i + chunkSize)));
      }
      payloads.push(...parser.flush());
      const parsed = payloads.map(parseSyncStreamEvent);
      expect(parsed).toEqual(SAMPLE_EVENTS);
    }
  });

  it("ignores SSE comment keep-alives and event: lines without data", () => {
    const parser = createSseFrameParser();
    expect(parser.push(": keep-alive\n\nevent: ping\n\n")).toEqual([]);
  });
});

describe("parseSyncStreamEvent normalization", () => {
  it("returns null for unknown event types instead of throwing", () => {
    expect(parseSyncStreamEvent({ type: "future.event", x: 1 })).toBeNull();
  });

  it("returns null for malformed JSON, non-objects, arrays, missing type", () => {
    expect(parseSyncStreamEvent("{not json")).toBeNull();
    expect(parseSyncStreamEvent(42)).toBeNull();
    expect(parseSyncStreamEvent(null)).toBeNull();
    expect(parseSyncStreamEvent([{ type: "turn.started" }])).toBeNull();
    expect(parseSyncStreamEvent({ turnId: "t-1" })).toBeNull();
  });

  it("accepts both raw objects and JSON strings", () => {
    const event = { type: "turn.started", turnId: "t-2" };
    expect(parseSyncStreamEvent(event)).toEqual(event);
    expect(parseSyncStreamEvent(JSON.stringify(event))).toEqual(event);
  });
});

describe("isTerminalEvent", () => {
  it("turn.completed and unrecoverable errors end the turn; recoverable errors do not", () => {
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
    expect(isTerminalEvent({ type: "assistant.delta", text: "x" })).toBe(false);
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

describe("createSyncEventStream (edge side)", () => {
  it("streams sent events as parseable SSE frames and closes cleanly", async () => {
    const stream = createSyncEventStream();
    expect(stream.send({ type: "turn.started", turnId: "t-9" })).toBe(true);
    expect(stream.send({ type: "turn.completed", turnId: "t-9" })).toBe(true);
    stream.close();
    const parser = createSseFrameParser();
    const payloads = parser.push(await readAll(stream.readable));
    expect(payloads.map(parseSyncStreamEvent)).toEqual([
      { type: "turn.started", turnId: "t-9" },
      { type: "turn.completed", turnId: "t-9" },
    ]);
  });

  it("send after close is refused, and close is idempotent", () => {
    const stream = createSyncEventStream();
    stream.close();
    stream.close();
    expect(stream.closed).toBe(true);
    expect(stream.send({ type: "assistant.delta" })).toBe(false);
  });

  it("client cancellation fires onCancel exactly once and stops the producer", async () => {
    const onCancel = vi.fn();
    const stream = createSyncEventStream({ onCancel });
    expect(stream.send({ type: "turn.started", turnId: "t" })).toBe(true);
    await stream.readable.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(stream.closed).toBe(true);
    // The producer's cue to abort upstream work: send now refuses.
    expect(
      stream.send({ type: "assistant.delta", text: "into the void" }),
    ).toBe(false);
    stream.close(); // must not re-fire onCancel
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("sseHeaders", () => {
  const allowed = ["https://app.syncai.ca", "http://localhost:5173"];

  it("echoes an allowlisted origin and falls back to the first otherwise", () => {
    expect(
      sseHeaders("http://localhost:5173", allowed)[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("http://localhost:5173");
    expect(
      sseHeaders("https://evil.example", allowed)[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("https://app.syncai.ca");
    expect(sseHeaders(null, allowed)["Access-Control-Allow-Origin"]).toBe(
      "https://app.syncai.ca",
    );
  });

  it("declares an event stream that must not be cached or sniffed", () => {
    const headers = sseHeaders(null, allowed);
    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers.Vary).toBe("Origin");
  });
});
