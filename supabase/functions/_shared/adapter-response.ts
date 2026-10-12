/** Bound the stream itself, even when Content-Length is missing or dishonest. */
export async function readAdapterBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Adapter byte budget is exhausted.");
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  ) {
    await response.body?.cancel();
    throw new Error("Adapter response exceeds its byte budget.");
  }
  if (!response.body) throw new Error("Adapter response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Adapter response exceeds its byte budget.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
