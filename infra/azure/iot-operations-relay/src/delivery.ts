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
 * returns. It returns after HTTP 2xx, or after a permanent refusal was
 * durably stored with its payload. A transient failure always throws, so a
 * database outage cannot advance the checkpoint or drop the batch.
 */
export const relayRetryPolicy = {
  strategy: "exponentialBackoff" as const,
  maxRetryCount: -1,
  minimumInterval: { seconds: 10 },
  maximumInterval: { minutes: 5 },
};

/**
 * Only these client statuses are permanent. 401 covers signature skew and
 * secret rotation, and 404, 408 and 429 are retryable. Anything else 4xx
 * also throws so the checkpoint stays put.
 */
export const PERMANENT_INGRESS_STATUSES = [400, 413, 422] as const;

/** Operator alarm for a stuck consumer. Not an equipment limit. */
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
  reason: "permanent_refusal" | "undecodable";
  detail: string;
  status: number | null;
  deliveryId: string;
  lagSeconds?: number;
  /** Full normalized points. Present for a permanent refusal. */
  points?: NormalizedPoint[];
  /** Full raw messages. Present when the batch could not be normalized. */
  messages?: unknown[];
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
      if (
        (PERMANENT_INGRESS_STATUSES as readonly number[]).includes(
          response.status,
        )
      ) {
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

function replayableMessage(message: unknown): unknown {
  if (Buffer.isBuffer(message))
    return { encoding: "base64", data: message.toString("base64") };
  if (message instanceof Uint8Array)
    return {
      encoding: "base64",
      data: Buffer.from(message).toString("base64"),
    };
  return message;
}

function deadLetterEnvelope(entry: DeadLetterRecord): string {
  return JSON.stringify({
    delivery_id: entry.deliveryId,
    dead_letter_reason: entry.reason,
    dead_letter_detail: entry.detail.slice(0, 400),
    ...(entry.lagSeconds !== undefined
      ? { checkpoint_lag_seconds: entry.lagSeconds }
      : {}),
    ...(entry.points && entry.points.length > 0
      ? { points: entry.points }
      : {}),
    ...(entry.messages && entry.messages.length > 0
      ? { messages: entry.messages }
      : {}),
  });
}

function splitDeadLetter(entry: DeadLetterRecord): DeadLetterRecord[] {
  const points = entry.points ?? [];
  const messages = entry.messages ?? [];
  if (points.length > 500) {
    const parts = Math.ceil(points.length / 500);
    return Array.from({ length: parts }, (_, index) => ({
      ...entry,
      messages: undefined,
      points: points.slice(index * 500, (index + 1) * 500),
      deliveryId: `${entry.deliveryId}:part-${index + 1}-of-${parts}`.slice(
        0,
        200,
      ),
    }));
  }
  if (messages.length > 500) {
    const parts = Math.ceil(messages.length / 500);
    return Array.from({ length: parts }, (_, index) => ({
      ...entry,
      points: undefined,
      messages: messages.slice(index * 500, (index + 1) * 500),
      deliveryId: `${entry.deliveryId}:part-${index + 1}-of-${parts}`.slice(
        0,
        200,
      ),
    }));
  }
  return [entry];
}

async function postDeadLetterEnvelope(
  entry: DeadLetterRecord,
  deps: {
    env: NodeJS.ProcessEnv;
    fetch: typeof fetch;
    now?: () => number;
  },
): Promise<boolean> {
  const body = deadLetterEnvelope(entry);
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
  const pointCount = entry.points?.length ?? 0;
  const messageCount = entry.messages?.length ?? 0;
  if (pointCount + messageCount < 1)
    throw new UndeliveredRelayError(
      "dead-letter payload is empty, so the checkpoint stays",
      null,
    );
  if (options.deadLetter) {
    await options.deadLetter(entry);
    return;
  }
  for (const part of splitDeadLetter(entry)) {
    const stored = await postDeadLetterEnvelope(part, {
      env,
      fetch: fetchImpl,
      now: options.now,
    });
    if (!stored) {
      await putDeadLetterBlob(entry, { env, fetch: fetchImpl });
      return;
    }
  }
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
        messages: messages.map(replayableMessage),
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
    if (permanent?.deadLettered) {
      noteFailure(context);
      context.log("SyncAI relay advanced past a refused batch already stored", {
        status: permanent.status,
      });
      return;
    }
    if (permanent) {
      const detail = error instanceof Error ? error.message : "delivery failed";
      await persistDeadLetter(
        {
          reason: "permanent_refusal",
          detail,
          status: permanent.status,
          deliveryId: `${normalized.deliveryBase}:dead-letter`.slice(0, 200),
          lagSeconds,
          points: normalized.points,
        },
        options,
        env,
        fetchImpl,
      );
      noteFailure(context);
      context.log("SyncAI relay dead-lettered a batch and will advance", {
        reason: "permanent_refusal",
        points: normalized.points.length,
      });
      return;
    }
    noteFailure(context);
    context.error("SyncAI relay delivery failed", {
      error: error instanceof Error ? error.message : "delivery failed",
      attempt: options.attempt ?? 0,
      retry: "transient_failures_are_not_dead_lettered",
    });
    throw error;
  }
  noteSuccess();
  context.log("SyncAI telemetry delivery accepted", {
    deliveryBase: normalized.deliveryBase,
    points: normalized.points.length,
    skipped: normalized.skipped,
  });
}
