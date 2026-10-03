import { describe, expect, it } from "vitest";
import { EdgeBodyTooLargeError, readBoundedBody } from "./body";

describe("edge evidence bounded request reader", () => {
  it("accepts a chunked body exactly at the governed byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });
    const request = new Request("https://edge.test/ingest", {
      method: "POST",
      body: stream,
      // Node requires this for a streaming request; Deno ignores the extension.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(new TextDecoder().decode(await readBoundedBody(request, 6))).toBe(
      "abcdef",
    );
  });

  it("cancels a chunked body as soon as it crosses the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcd"));
        controller.enqueue(new TextEncoder().encode("efgh"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://edge.test/ingest", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedBody(request, 6)).rejects.toBeInstanceOf(
      EdgeBodyTooLargeError,
    );
    expect(cancelled).toBe(true);
  });
});
