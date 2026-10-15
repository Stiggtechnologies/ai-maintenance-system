import { createHmac } from "node:crypto";
import {
  NO_USABLE_POINTS_PREFIX,
  normalizeEventHubMessages,
  type NormalizedPoint,
} from "./normalize.js";

/**
 * Host checkpoint rule for the Event Hubs trigger, from Microsoft's
 * "Reliable event processing" and retry-policy articles:
 * a finished execution advances the partition checkpoint even when it throws,
 * unless a function retry policy is still open. Checkpoints are written only
 * after that policy finishes. maxRetryCount -1 never finishes on failure, so
 * the checkpoint stays on the last batch whose delivery was allowed to return.
 */
export const relayRetryPolicy = {
  strategy: "exponentialBackoff" as const,
  maxRetryCount: -1,
  minimumInterval: { seconds: 10 },
  maximumInterval: { minutes: 5 },
};

export function failureAdvancesCheckpoint(
  policy: { maxRetryCount: number } | undefined,
  failuresSoFar: number,
): boolean {
  if (!policy) return true;
  if (policy.maxRetryCount < 0) return false;
  return failuresSoFar > policy.maxRetryCount;
}

export class UndeliveredRelayError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "UndeliveredRelayError";
    this.status = status;
  }
}

export interface RelayInvocation {
  triggerMetadata?: Record<string, unknown> | null;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface DeliverOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  chunkSize?: number;
}

const IN_PROCESS_ATTEMPTS = 3;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function metadataArray(
  context: RelayInvocation,
  key: string,
  length: number,
): string[] {
  const value = context.triggerMetadata?.[key];
  if (Array.isArray(value)) return value.map(String);
  return Array.from({ length }, () => String(value ?? ""));
}

function normalize(messages: unknown[], context: RelayInvocation) {
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

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postIngress(
  body: string,
  deps: {
    env: NodeJS.ProcessEnv;
    fetch: typeof fetch;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    onError?: (message: string) => void;
  },
): Promise<void> {
  const endpoint = required(deps.env, "SYNCAI_INGRESS_URL");
  const keyId = required(deps.env, "SYNCAI_INGRESS_KEY_ID");
  const secret = required(deps.env, "SYNCAI_INGRESS_SECRET");
  if (secret.length < 32) throw new Error("SYNCAI_INGRESS_SECRET is too short");
  const timestamp = String(Math.floor((deps.now ?? Date.now)() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= IN_PROCESS_ATTEMPTS; attempt += 1) {
    try {
      const response = await deps.fetch(endpoint, {
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
      lastError = new UndeliveredRelayError(
        `SyncAI ingress returned HTTP ${response.status}`,
        response.status,
      );
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      if (error instanceof UndeliveredRelayError) throw error;
      lastError =
        error instanceof Error ? error : new Error("relay failed");
    }
    if (attempt < IN_PROCESS_ATTEMPTS) await sleep(attempt * 500);
  }
  const failure =
    lastError instanceof UndeliveredRelayError
      ? lastError
      : new UndeliveredRelayError(
          lastError?.message ?? "SyncAI relay delivery failed",
          null,
        );
  deps.onError?.(failure.message);
  throw failure;
}

export async function deliverPoints(
  deliveryBase: string,
  points: NormalizedPoint[],
  post: (body: string) => Promise<void>,
  chunkSize = 500,
): Promise<void> {
  const deliveries = Math.ceil(points.length / chunkSize);
  for (let index = 0; index < deliveries; index += 1) {
    const deliveryId = `${deliveryBase}:chunk-${index + 1}-of-${deliveries}`;
    const body = JSON.stringify({
      delivery_id: deliveryId,
      points: points.slice(index * chunkSize, (index + 1) * chunkSize),
    });
    await post(body);
  }
}

export async function deliverEventHubBatch(
  messages: unknown[],
  context: RelayInvocation,
  options: DeliverOptions = {},
): Promise<void> {
  let normalized: ReturnType<typeof normalize>;
  try {
    normalized = normalize(messages, context);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(NO_USABLE_POINTS_PREFIX)
    ) {
      context.log("SyncAI relay withheld a non-data batch", {
        detail: error.message,
      });
      return;
    }
    throw error;
  }
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  await deliverPoints(
    normalized.deliveryBase,
    normalized.points,
    (body) =>
      postIngress(body, {
        env,
        fetch: fetchImpl,
        now: options.now,
        sleep: options.sleep,
        onError: (message) =>
          context.error("SyncAI relay delivery failed", { error: message }),
      }),
    options.chunkSize,
  );
  context.log("SyncAI telemetry delivery accepted", {
    deliveryBase: normalized.deliveryBase,
    points: normalized.points.length,
    skipped: normalized.skipped,
  });
}
