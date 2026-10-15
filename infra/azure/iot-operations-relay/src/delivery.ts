import { createHash, createHmac } from "node:crypto";
import {
  NO_USABLE_POINTS_PREFIX,
  normalizeEventHubMessages,
  type NormalizedPoint,
} from "./normalize.js";

/**
 * Host checkpoint rule for the Event Hubs trigger, from Microsoft's
 * "Reliable event processing" and retry-policy articles:
 * a finished execution advances the partition checkpoint even when it throws,
 * unless a function retry policy is still open. maxRetryCount -1 never
 * finishes on a throw, so the checkpoint stays put until this function
 * returns. It returns after HTTP 2xx, or after a dead letter was durably
 * stored. A throw still means the batch was not accepted and not quarantined.
 */
export const relayRetryPolicy = {
  strategy: "exponentialBackoff" as const,
  maxRetryCount: -1,
  minimumInterval: { seconds: 10 },
  maximumInterval: { minutes: 5 },
};

/** Operator recovery budget for one stuck batch. Not an equipment limit. */
export const RELAY_TRANSIENT_ATTEMPT_LIMIT = 8;
export const CONSECUTIVE_FAILURE_ALERT_COUNT = 3;
export const CHECKPOINT_LAG_ALERT_MS = 15 * 60 * 1000;

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

export class PermanentRelayError extends UndeliveredRelayError {
  readonly deadLettered: boolean;

  constructor(message: string, status: number, deadLettered = false) {
    super(message, status);
    this.name = "PermanentRelayError";
    this.deadLettered = deadLettered;
  }
}

export interface RelayInvocation {
  triggerMetadata?: Record<string, unknown> | null;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface DeadLetterRecord {
  reason: "permanent_refusal" | "transient_exhausted" | "undecodable";
  detail: string;
  status: number | null;
  deliveryId: string;
  lagSeconds?: number;
  body?: string;
}

export interface DeliverOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  chunkSize?: number;
  /** Zero-based host retry count. The first invocation is 0. */
  attempt?: number;
  deadLetter?: (record: DeadLetterRecord) => Promise<void>;
}

const IN_PROCESS_ATTEMPTS = 3;
let consecutiveFailures = 0;

export function resetRelayFailureStreak(): void {
  consecutiveFailures = 0;
}

export function relayFailureStreak(): number {
  return consecutiveFailures;
}

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

export function checkpointLagMs(
  metadata: Record<string, unknown> | null | undefined,
  nowMs: number,
): number | null {
  const raw = metadata?.enqueuedTimeUtcArray ?? metadata?.enqueuedTimeUtc;
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const times = values
    .map((value) => Date.parse(String(value)))
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return null;
  return nowMs - Math.min(...times);
}

function noteFailure(context: RelayInvocation): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_ALERT_COUNT) {
    context.error("SyncAI relay consecutive failures", {
      alert: "consecutive_ingress_failures",
      count: consecutiveFailures,
    });
  }
}

function noteSuccess(): void {
  consecutiveFailures = 0;
}

function alertOnCheckpointLag(
  context: RelayInvocation,
  nowMs: number,
): number | undefined {
  const lag = checkpointLagMs(context.triggerMetadata, nowMs);
  if (lag == null || lag < CHECKPOINT_LAG_ALERT_MS) return undefined;
  context.error("SyncAI relay checkpoint lag", {
    alert: "checkpoint_lag",
    lagMs: lag,
  });
  return Math.floor(lag / 1000);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function signedHeaders(
  body: string,
  env: NodeJS.ProcessEnv,
  now: () => number,
): { endpoint: string; headers: Record<string, string> } {
  const endpoint = required(env, "SYNCAI_INGRESS_URL");
  const keyId = required(env, "SYNCAI_INGRESS_KEY_ID");
  const secret = required(env, "SYNCAI_INGRESS_SECRET");
  if (secret.length < 32) throw new Error("SYNCAI_INGRESS_SECRET is too short");
  const timestamp = String(Math.floor(now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    endpoint,
    headers: {
      "content-type": "application/json",
      "x-syncai-key-id": keyId,
      "x-syncai-timestamp": timestamp,
      "x-syncai-signature": `sha256=${signature}`,
    },
  };
}

async function readDeadLettered(response: Response): Promise<boolean> {
  try {
    const payload = (await response.clone().json()) as {
      dead_lettered?: unknown;
    };
    return payload.dead_lettered === true;
  } catch {
    return false;
  }
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
  const now = deps.now ?? Date.now;
  const signed = signedHeaders(body, deps.env, now);
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= IN_PROCESS_ATTEMPTS; attempt += 1) {
    try {
      const response = await deps.fetch(signed.endpoint, {
        method: "POST",
        headers: signed.headers,
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return;
      if (response.status >= 400 && response.status < 500) {
        throw new PermanentRelayError(
          `SyncAI ingress returned HTTP ${response.status}`,
          response.status,
          await readDeadLettered(response),
        );
      }
      lastError = new UndeliveredRelayError(
        `SyncAI ingress returned HTTP ${response.status}`,
        response.status,
      );
    } catch (error) {
      if (error instanceof UndeliveredRelayError) throw error;
      lastError = error instanceof Error ? error : new Error("relay failed");
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

export function deadLetterBlobUrl(containerUrl: string, name: string): string {
  const splitAt = containerUrl.indexOf("?");
  const base = (
    splitAt === -1 ? containerUrl : containerUrl.slice(0, splitAt)
  ).replace(/\/$/, "");
  const query = splitAt === -1 ? "" : containerUrl.slice(splitAt);
  return `${base}/${name}${query}`;
}

export async function putDeadLetterBlob(
  entry: DeadLetterRecord,
  deps: { env: NodeJS.ProcessEnv; fetch: typeof fetch },
): Promise<void> {
  const container = deps.env.SYNCAI_DEAD_LETTER_CONTAINER_URL?.trim() ?? "";
  if (!container)
    throw new Error(
      "SYNCAI_DEAD_LETTER_CONTAINER_URL is required when ingress cannot store the refusal",
    );
  const name = `${entry.deliveryId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180)}.json`;
  const response = await deps.fetch(deadLetterBlobUrl(container, name), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-ms-blob-type": "BlockBlob",
    },
    body: JSON.stringify(entry),
  });
  if (!response.ok)
    throw new UndeliveredRelayError(
      `dead-letter blob returned HTTP ${response.status}`,
      response.status,
    );
}

async function postDeadLetterEnvelope(
  entry: DeadLetterRecord,
  deps: {
    env: NodeJS.ProcessEnv;
    fetch: typeof fetch;
    now?: () => number;
  },
): Promise<boolean> {
  const body = JSON.stringify({
    delivery_id: entry.deliveryId,
    dead_letter_reason: entry.reason,
    dead_letter_detail: entry.detail.slice(0, 400),
    ...(entry.lagSeconds !== undefined
      ? { checkpoint_lag_seconds: entry.lagSeconds }
      : {}),
  });
  try {
    const signed = signedHeaders(body, deps.env, deps.now ?? Date.now);
    const response = await deps.fetch(signed.endpoint, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function persistDeadLetter(
  entry: DeadLetterRecord,
  options: DeliverOptions,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (options.deadLetter) {
    await options.deadLetter(entry);
    return;
  }
  const stored = await postDeadLetterEnvelope(entry, {
    env,
    fetch: fetchImpl,
    now: options.now,
  });
  if (stored) return;
  await putDeadLetterBlob(entry, { env, fetch: fetchImpl });
}

function deliveryIdFor(messages: unknown[], context: RelayInvocation): string {
  const offsets = metadataArray(context, "offsetArray", messages.length);
  const partitionContext = record(context.triggerMetadata?.partitionContext);
  const partition = String(
    partitionContext?.partitionId ??
      context.triggerMetadata?.partitionId ??
      "na",
  );
  const fingerprint = createHash("sha256")
    .update(String(messages.length))
    .digest("hex")
    .slice(0, 12);
  const base = `${partition}:${offsets[0] || fingerprint}:${offsets.at(-1) || fingerprint}:${messages.length}:dead-letter`;
  return base.length >= 8 ? base.slice(0, 200) : `${base}:batch`;
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
  const nowMs = (options.now ?? Date.now)();
  const lagSeconds = alertOnCheckpointLag(context, nowMs);
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
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
    const detail = error instanceof Error ? error.message : "undecodable batch";
    await persistDeadLetter(
      {
        reason: "undecodable",
        detail,
        status: null,
        deliveryId: deliveryIdFor(messages, context),
        lagSeconds,
      },
      options,
      env,
      fetchImpl,
    );
    noteFailure(context);
    context.log("SyncAI relay dead-lettered an undecodable batch", { detail });
    return;
  }
  try {
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
  } catch (error) {
    const permanent = error instanceof PermanentRelayError ? error : null;
    const exhausted =
      (options.attempt ?? 0) + 1 >= RELAY_TRANSIENT_ATTEMPT_LIMIT;
    if (permanent?.deadLettered) {
      noteFailure(context);
      context.log("SyncAI relay advanced past a refused batch already stored", {
        status: permanent.status,
      });
      return;
    }
    if (permanent || exhausted) {
      const detail = error instanceof Error ? error.message : "delivery failed";
      await persistDeadLetter(
        {
          reason: permanent ? "permanent_refusal" : "transient_exhausted",
          detail,
          status: error instanceof UndeliveredRelayError ? error.status : null,
          deliveryId: `${normalized.deliveryBase}:dead-letter`.slice(0, 200),
          lagSeconds,
          body: JSON.stringify({ points: normalized.points.length }),
        },
        options,
        env,
        fetchImpl,
      );
      noteFailure(context);
      context.log("SyncAI relay dead-lettered a batch and will advance", {
        reason: permanent ? "permanent_refusal" : "transient_exhausted",
      });
      return;
    }
    noteFailure(context);
    throw error;
  }
  noteSuccess();
  context.log("SyncAI telemetry delivery accepted", {
    deliveryBase: normalized.deliveryBase,
    points: normalized.points.length,
    skipped: normalized.skipped,
  });
}
