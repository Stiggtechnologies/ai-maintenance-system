const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;

interface ProxyEnvironment {
  SUPABASE_URL?: string;
  VERCEL_ENV?: string;
  VITE_SUPABASE_URL?: string;
}

interface ProxyOptions {
  env?: ProxyEnvironment;
  fetchImpl?: typeof fetch;
}

class ProxyRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function upstreamUrl(env: ProxyEnvironment): URL {
  const configured = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  if (!configured) throw new ProxyRefusal(503, "service_unavailable");

  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new ProxyRefusal(503, "service_unavailable");
  }

  const isLocalDevelopment =
    env.VERCEL_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if (base.protocol !== "https:" && !isLocalDevelopment) {
    throw new ProxyRefusal(503, "service_unavailable");
  }

  return new URL("/functions/v1/marketplace-webhook", base.origin);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new ProxyRefusal(413, "request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new ProxyRefusal(400, "invalid_request");
  return Number(value);
}

function forwardedHeaders(request: Request): Headers {
  const authorization = request.headers.get("authorization") ?? "";
  if (
    authorization.length > 16 * 1024 ||
    !authorization.startsWith("Bearer ") ||
    authorization.slice("Bearer ".length).trim().length === 0
  ) {
    throw new ProxyRefusal(401, "marketplace_webhook_token_required");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new ProxyRefusal(415, "unsupported_media_type");
  }

  const headers = new Headers({ authorization, "content-type": contentType });
  for (const name of [
    "x-ms-requestid",
    "x-ms-correlationid",
    "x-ms-activityid",
  ]) {
    const value = request.headers.get(name);
    if (value && value.length <= 4 * 1024) headers.set(name, value);
  }
  return headers;
}

function relayedHeaders(response: Response): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

export async function proxyMarketplaceWebhook(
  request: Request,
  options: ProxyOptions = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  try {
    const declaredLength = declaredBodyLength(request);
    if (declaredLength !== null && declaredLength > MAX_REQUEST_BYTES) {
      throw new ProxyRefusal(413, "request_too_large");
    }

    const headers = forwardedHeaders(request);
    const body = await readBoundedStream(request.body, MAX_REQUEST_BYTES);
    const target = upstreamUrl(options.env ?? process.env);
    const upstream = await (options.fetchImpl ?? fetch)(target, {
      method: "POST",
      headers,
      body: body.buffer,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // Never let a commerce POST change origin or method through a redirect.
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return jsonError(502, "upstream_refused");
    }

    let responseBody: Uint8Array<ArrayBuffer>;
    try {
      responseBody = await readBoundedStream(upstream.body, MAX_RESPONSE_BYTES);
    } catch {
      return jsonError(502, "upstream_refused");
    }

    return new Response(responseBody.byteLength ? responseBody.buffer : null, {
      status: upstream.status,
      headers: relayedHeaders(upstream),
    });
  } catch (error) {
    if (error instanceof ProxyRefusal) {
      return jsonError(error.status, error.code);
    }
    return jsonError(502, "upstream_unavailable");
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return proxyMarketplaceWebhook(request);
  },
};
