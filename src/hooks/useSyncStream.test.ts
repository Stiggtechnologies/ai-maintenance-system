/**
 * useSyncStream — the hook-level proofs the Phase 0 contract requires:
 * events parse and accumulate in order, a completed turn reads as done, an
 * interrupted stream is never presented as success, and cancellation aborts
 * the underlying fetch (FR-012 / §43: stopped turns stop consuming).
 *
 * The response bodies are produced by the REAL edge helper
 * (createSyncEventStream), so this is the two deployed halves meeting over
 * an actual ReadableStream, not a hand-rolled fixture of the wire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createSyncEventStream } from "../../supabase/functions/_shared/sync-stream";
import type { SyncStreamEvent } from "../types/sync-stream";
import { useSyncStream } from "./useSyncStream";

function sseResponse(events: SyncStreamEvent[]): Response {
  const stream = createSyncEventStream();
  for (const event of events) stream.send(event);
  stream.close();
  return new Response(stream.readable, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSyncStream", () => {
  it("accumulates parsed events in order and ends done on turn.completed", async () => {
    const turn: SyncStreamEvent[] = [
      { type: "turn.started", turnId: "t-1" },
      { type: "assistant.delta", text: "Looking at " },
      { type: "assistant.delta", text: "the history…" },
      { type: "turn.completed", turnId: "t-1" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(turn)));

    const { result } = renderHook(() => useSyncStream());
    await act(() => result.current.start("/functions/v1/sync-turn"));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.events).toEqual(turn);
    expect(result.current.error).toBeNull();
  });

  it("skips unknown event types without losing the rest of the turn", async () => {
    const stream = createSyncEventStream();
    stream.send({ type: "turn.started", turnId: "t-2" });
    stream.send({ type: "future.hologram", payload: 1 });
    stream.send({ type: "turn.completed", turnId: "t-2" });
    stream.close();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream.readable, { status: 200 })),
    );

    const { result } = renderHook(() => useSyncStream());
    await act(() => result.current.start("/functions/v1/sync-turn"));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.events.map((e) => e.type)).toEqual([
      "turn.started",
      "turn.completed",
    ]);
  });

  it("reports a stream that ends without turn completion as an error, not success", async () => {
    const interrupted: SyncStreamEvent[] = [
      { type: "turn.started", turnId: "t-3" },
      { type: "assistant.delta", text: "half an ans" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(interrupted)));

    const { result } = renderHook(() => useSyncStream());
    await act(() => result.current.start("/functions/v1/sync-turn"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("before turn completion");
    expect(result.current.events).toEqual(interrupted);
  });

  it("treats an unrecoverable error event as terminal", async () => {
    const failed: SyncStreamEvent[] = [
      { type: "turn.started", turnId: "t-4" },
      {
        type: "error",
        code: "MODEL_UNAVAILABLE",
        message: "down",
        recoverable: false,
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(failed)));

    const { result } = renderHook(() => useSyncStream());
    await act(() => result.current.start("/functions/v1/sync-turn"));
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.events).toEqual(failed);
  });

  it("surfaces a non-200 response as an error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 403 })),
    );
    const { result } = renderHook(() => useSyncStream());
    await act(() => result.current.start("/functions/v1/sync-turn"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("403");
  });

  it("cancel() aborts the underlying fetch and settles as cancelled, not error", async () => {
    // A stream that never completes: events flow, close never comes.
    const stream = createSyncEventStream();
    stream.send({ type: "turn.started", turnId: "t-5" });
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response(stream.readable, { status: 200 }));
      }),
    );

    const { result } = renderHook(() => useSyncStream());
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.start("/functions/v1/sync-turn");
    });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    expect(observedSignal?.aborted).toBe(false);

    act(() => result.current.cancel());
    await act(() => pending);

    expect(observedSignal?.aborted).toBe(true);
    expect(result.current.status).toBe("cancelled");
    expect(result.current.error).toBeNull();
  });

  it("unmounting aborts an in-flight stream so it cannot outlive its surface", async () => {
    const stream = createSyncEventStream();
    stream.send({ type: "turn.started", turnId: "t-6" });
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return Promise.resolve(new Response(stream.readable, { status: 200 }));
      }),
    );

    const { result, unmount } = renderHook(() => useSyncStream());
    act(() => {
      void result.current.start("/functions/v1/sync-turn");
    });
    await waitFor(() => expect(result.current.events.length).toBe(1));
    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });
});
