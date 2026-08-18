/**
 * SSE transport helper for Sync stream events, shared by future Sync edge
 * functions (spec §17, §50 "prefer SSE for server->client token/tool events").
 *
 * DELIBERATELY DENO-FREE, like llm-provider.ts in this directory: no Deno
 * globals, nothing but TextEncoder and ReadableStream — so the exact file
 * that deploys to the edge runtime is unit-tested by vitest
 * (src/lib/sync/sync-stream.test.ts). An edge change that cannot be
 * typechecked or tested locally is how the previous untypechecked function
 * shipped; this module cannot repeat that.
 *
 * TRANSPORT ONLY, ON PURPOSE. This file does not know the SyncStreamEvent
 * union — it frames `{ type: string }` objects as SSE and closes cleanly.
 * The typed contract lives in src/types/sync-stream.ts on the client side of
 * the wire; keeping the encoder structurally typed means the edge bundle
 * never imports across the src/ boundary (the same one-way dependency rule
 * llm-provider.ts keeps), and a new event type needs no transport change.
 *
 * No function consumes this yet: it ships as Phase 0 architecture with every
 * sync_* flag seeded OFF, so nothing user-visible is wired to it.
 */

/** The minimum an SSE frame needs: a discriminating type tag. The index
 *  signature admits the payload fields each event type carries. */
export interface StreamableEvent {
  type: string;
  [field: string]: unknown;
}

/**
 * Encode one event as an SSE frame. `event:` carries the type tag so
 * consumers can subscribe selectively; `data:` carries the full JSON payload
 * (type included) so a consumer that only reads data lines loses nothing.
 * JSON.stringify never emits a bare newline, so the payload cannot break
 * out of its own frame.
 */
export function encodeSseFrame(event: StreamableEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE response headers in the idiom of this repo's edge functions
 * (public-reliability-agent/index.ts): explicit origin allowlist with the
 * first configured origin as fallback, no-store, nosniff, Vary: Origin.
 */
export function sseHeaders(
  origin: string | null,
  allowedOrigins: readonly string[],
): Record<string, string> {
  const allowed =
    origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowed ?? "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Cache-Control": "no-store",
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export interface SyncEventStream {
  /** Body for `new Response(stream, { headers: sseHeaders(...) })`. */
  readable: ReadableStream<Uint8Array>;
  /** Enqueue one event. Returns false (and drops it) after close/cancel. */
  send: (event: StreamableEvent) => boolean;
  /** End the stream cleanly. Idempotent. */
  close: () => void;
  /** True once closed by the server or cancelled by the client. */
  readonly closed: boolean;
}

/**
 * Create a push-style SSE stream.
 *
 * Cancellation is a first-class path, not an error path: when the client
 * disconnects (the runtime cancels the ReadableStream), `send` starts
 * returning false and `onCancel` fires exactly once — the producer's cue to
 * abort upstream work (model call, retrieval) instead of streaming into the
 * void. §43: "use cancellation signals end-to-end so stopped turns do not
 * continue consuming resources."
 */
export function createSyncEventStream(options?: {
  onCancel?: () => void;
}): SyncEventStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const finish = (cancelled: boolean) => {
    if (closed) return;
    closed = true;
    if (!cancelled) {
      try {
        controller?.close();
      } catch {
        // Already closed by the runtime — closing twice is not an event.
      }
    }
    if (cancelled) options?.onCancel?.();
  };

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      finish(true);
    },
  });

  return {
    readable,
    send(event: StreamableEvent): boolean {
      if (closed || !controller) return false;
      try {
        controller.enqueue(encoder.encode(encodeSseFrame(event)));
        return true;
      } catch {
        // Enqueue after client teardown: mark closed so the producer stops.
        finish(true);
        return false;
      }
    },
    close() {
      finish(false);
    },
    get closed() {
      return closed;
    },
  };
}
