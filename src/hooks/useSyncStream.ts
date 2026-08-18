/**
 * useSyncStream — client consumer for the §17 Sync stream contract over SSE.
 *
 * fetch + ReadableStream rather than EventSource, because Sync endpoints are
 * authenticated edge functions: EventSource cannot send an Authorization
 * header or a POST body, and this repo's functions take both. The wire
 * format is what supabase/functions/_shared/sync-stream.ts produces; the
 * event payloads are normalized through parseSyncStreamEvent, so unknown
 * event types from a newer server are skipped, not crashed on.
 *
 * CANCELLATION IS THE CONTRACT'S OTHER HALF (FR-012, §43). cancel() aborts
 * the underlying fetch, which propagates to the server as a stream cancel —
 * the edge helper's onCancel fires and upstream work stops. A turn the user
 * stopped must not keep consuming model tokens.
 *
 * Nothing mounts this hook: every sync_* feature flag is seeded OFF
 * (20260912130000) and Phase 0 wires no user-visible behaviour. It exists so
 * Phase 1 consumes a tested contract instead of inventing transport under
 * deadline.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isTerminalEvent,
  parseSyncStreamEvent,
  type SyncStreamEvent,
} from "../types/sync-stream";

/**
 * Incremental SSE frame parser. Feed it raw text chunks in any split; it
 * returns the `data:` payloads of every frame completed so far. Exported for
 * tests and for non-hook consumers.
 *
 * Deliberately data-line-only: our encoder duplicates the type tag into the
 * JSON payload, so `event:` lines are advisory and comment lines (`:`) are
 * keep-alives to ignore, per the SSE spec.
 */
export function createSseFrameParser(): {
  push: (chunk: string) => string[];
  /** Drain any final unterminated frame (stream ended without \n\n). */
  flush: () => string[];
} {
  let buffer = "";

  const dataOf = (frame: string): string | null => {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) return null;
    return dataLines.join("\n");
  };

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      return frames.map(dataOf).filter((data): data is string => data !== null);
    },
    flush(): string[] {
      const last = buffer;
      buffer = "";
      const data = dataOf(last);
      return data === null ? [] : [data];
    },
  };
}

export type SyncStreamStatus =
  "idle" | "streaming" | "done" | "cancelled" | "error";

export interface SyncStreamState {
  events: SyncStreamEvent[];
  status: SyncStreamStatus;
  error: string | null;
  /** Open the stream. Any active stream is cancelled first. */
  start: (url: string, init?: RequestInit) => Promise<void>;
  /** Abort the active stream. Safe to call at any time. */
  cancel: () => void;
}

export function useSyncStream(): SyncStreamState {
  const [events, setEvents] = useState<SyncStreamEvent[]>([]);
  const [status, setStatus] = useState<SyncStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setStatus("cancelled");
    }
  }, []);

  // A stream must not outlive the surface that opened it.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(async (url: string, init?: RequestInit) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setEvents([]);
    setError(null);
    setStatus("streaming");

    const parser = createSseFrameParser();
    const handlePayloads = (payloads: string[]): boolean => {
      let terminal = false;
      const parsed = payloads
        .map(parseSyncStreamEvent)
        .filter((event): event is SyncStreamEvent => event !== null);
      if (parsed.length > 0) {
        setEvents((previous) => [...previous, ...parsed]);
        terminal = parsed.some(isTerminalEvent);
      }
      return terminal;
    };

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok || !response.body) {
        setStatus("error");
        setError(`stream request failed (${response.status})`);
        return;
      }
      const reader = response.body.getReader();
      // Abort must reach the reader directly: cancelling the reader resolves
      // any pending read and propagates cancel to the stream source (the
      // edge helper's onCancel), independent of the fetch implementation.
      const onAbort = () => {
        void reader.cancel().catch(() => {});
      };
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort);
      const decoder = new TextDecoder();
      let sawTerminal = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (
            handlePayloads(parser.push(decoder.decode(value, { stream: true })))
          ) {
            sawTerminal = true;
          }
        }
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
      // A cancelled turn is settled by cancel(); do not relabel it here.
      if (controller.signal.aborted) return;
      if (handlePayloads(parser.flush())) sawTerminal = true;
      // A stream that ended without turn.completed is a broken turn, not a
      // finished one — never present an interrupted stream as success
      // (FR-089's rule applied to transport).
      if (sawTerminal) {
        setStatus("done");
      } else {
        setStatus("error");
        setError("stream ended before turn completion");
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        // cancel() already set the status; aborting is not an error.
        return;
      }
      setStatus("error");
      setError(err instanceof Error ? err.message : "stream failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { events, status, error, start, cancel };
}
