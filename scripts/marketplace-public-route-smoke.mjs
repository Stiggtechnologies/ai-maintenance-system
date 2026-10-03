const DEFAULT_BASE_URL = "https://app.syncai.ca";
const REQUEST_TIMEOUT_MS = 10_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedBaseUrl() {
  const raw = process.env.MARKETPLACE_PUBLIC_BASE_URL ?? DEFAULT_BASE_URL;
  const url = new URL(raw);
  assert(url.protocol === "https:", "Marketplace public smoke requires HTTPS");
  assert(
    url.username === "" && url.password === "" && url.search === "" && url.hash === "",
    "Marketplace public smoke base URL cannot contain credentials, query, or fragment",
  );
  return url;
}

async function probe(baseUrl, path, init = {}) {
  const target = new URL(path, baseUrl);
  const response = await fetch(target, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  return { body, response, target };
}

function assertSecurityHeaders(response, label) {
  assert(
    response.headers.get("cache-control")?.toLowerCase().includes("no-store"),
    `${label} must return Cache-Control: no-store`,
  );
  assert(
    response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    `${label} must return X-Content-Type-Options: nosniff`,
  );
}

async function main() {
  const baseUrl = normalizedBaseUrl();
  const activation = await probe(baseUrl, "/marketplace/activate");
  assert(activation.response.status === 200, "Activation route must return HTTP 200");
  assert(
    activation.response.headers.get("content-type")?.includes("text/html"),
    "Activation route must return HTML",
  );

  const webhookGet = await probe(baseUrl, "/api/marketplace/webhook");
  assert(webhookGet.response.status === 405, "Webhook GET must return HTTP 405");
  assert(webhookGet.response.headers.get("allow") === "POST", "Webhook GET must allow POST");
  assertSecurityHeaders(webhookGet.response, "Webhook GET");
  assert(
    webhookGet.body === JSON.stringify({ error: "method_not_allowed" }),
    "Webhook GET must return the exact method_not_allowed refusal",
  );

  const webhookPost = await probe(baseUrl, "/api/marketplace/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert(webhookPost.response.status === 401, "Unsigned webhook POST must return HTTP 401");
  assertSecurityHeaders(webhookPost.response, "Unsigned webhook POST");
  assert(
    webhookPost.body ===
      JSON.stringify({ error: "marketplace_webhook_token_required" }),
    "Unsigned webhook POST must return the exact token-required refusal",
  );

  console.log(
    JSON.stringify(
      {
        baseUrl: baseUrl.origin,
        observations: {
          activation: { contentType: activation.response.headers.get("content-type"), status: 200 },
          webhookGet: { allow: "POST", error: "method_not_allowed", status: 405 },
          webhookUnsignedPost: {
            error: "marketplace_webhook_token_required",
            status: 401,
          },
        },
        scope:
          "Read-only public route/refusal evidence only; not browser rendering, upstream-project, alias-to-SHA, authenticated lifecycle, metering, certification, or publication evidence.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
