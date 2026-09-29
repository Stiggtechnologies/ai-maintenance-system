export class EdgeBodyTooLargeError extends Error {
  constructor() {
    super("edge evidence request body is too large");
    this.name = "EdgeBodyTooLargeError";
  }
}

/**
 * Read a request without ever buffering more than the governed limit.
 * Content-Length is only an early hint: a caller can omit it and stream a
 * chunked body, so the limit must be enforced while bytes are being read.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new EdgeBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
