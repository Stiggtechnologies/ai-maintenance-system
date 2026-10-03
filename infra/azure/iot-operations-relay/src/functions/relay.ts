import { app, type InvocationContext } from "@azure/functions";
import { createHmac } from "node:crypto";
import { normalizeEventHubMessages } from "../normalize.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function metadataArray(
  context: InvocationContext,
  key: string,
  length: number,
): string[] {
  const value = context.triggerMetadata?.[key];
  if (Array.isArray(value)) return value.map(String);
  return Array.from({ length }, () => String(value ?? ""));
}

function normalize(messages: unknown[], context: InvocationContext) {
  const offsets = metadataArray(context, "offsetArray", messages.length);
  const sequences = metadataArray(
    context,
    "sequenceNumberArray",
    messages.length,
  );
  const partitionContext = record(context.triggerMetadata?.partitionContext);
  const partition = String(
    partitionContext?.partitionId ?? context.triggerMetadata?.partitionId ?? "",
  );
  return normalizeEventHubMessages(messages, { partition, offsets, sequences });
}

async function postWithRetry(body: string, context: InvocationContext) {
  const endpoint = required("SYNCAI_INGRESS_URL");
  const keyId = required("SYNCAI_INGRESS_KEY_ID");
  const secret = required("SYNCAI_INGRESS_SECRET");
  if (secret.length < 32) throw new Error("SYNCAI_INGRESS_SECRET is too short");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-syncai-key-id": keyId,
          "x-syncai-timestamp": timestamp,
          "x-syncai-signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return;
      lastError = new Error(`SyncAI ingress returned HTTP ${response.status}`);
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("relay failed");
    }
    if (attempt < 3)
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  context.error("SyncAI relay delivery failed", {
    error: lastError?.message ?? "unknown",
  });
  throw lastError ?? new Error("SyncAI relay delivery failed");
}

export async function relay(
  messages: unknown[],
  context: InvocationContext,
): Promise<void> {
  const normalized = normalize(messages, context);
  const deliveries = Math.ceil(normalized.points.length / 500);
  for (let index = 0; index < deliveries; index += 1) {
    const deliveryId = `${normalized.deliveryBase}:chunk-${index + 1}-of-${deliveries}`;
    const body = JSON.stringify({
      delivery_id: deliveryId,
      points: normalized.points.slice(index * 500, (index + 1) * 500),
    });
    await postWithRetry(body, context);
  }
  context.log("SyncAI telemetry delivery accepted", {
    deliveryBase: normalized.deliveryBase,
    deliveries,
    points: normalized.points.length,
    skipped: normalized.skipped,
  });
}

app.eventHub("syncaiAzureIotOperationsRelay", {
  connection: "AioEventHubs",
  eventHubName: "%AIO_EVENT_HUB_NAME%",
  consumerGroup: "%AIO_EVENT_HUB_CONSUMER_GROUP%",
  cardinality: "many",
  handler: relay,
});
