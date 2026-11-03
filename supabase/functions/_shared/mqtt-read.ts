// Read-only MQTT subscribe window for C2.20.
//
// Supabase Edge runs on Deno and has WebSocket, not raw TCP. The pull function
// therefore uses mqtt.js (mqtt@5.16.1) over TLS WebSockets (`wss://`). This
// module is the pure contract: URL and topic checks, a subscribe-only session
// port, and the bounded collector. It never opens a socket and it has no
// publish method.

export const MQTT_CLIENT_SPECIFIER = "npm:mqtt@5.16.1";

export const MQTT_LIMITS = {
  minFilters: 1,
  maxFilters: 8,
  maxFilterLength: 256,
  maxTopicLength: 256,
  minWindowSeconds: 1,
  maxWindowSeconds: 30,
  minMessages: 1,
  maxMessages: 200,
  maxMessageBytes: 8192,
  maxTotalBytes: 262_144,
  maxSkipped: 1000,
} as const;

const FILTER_CHARS = /^[A-Za-z0-9_./+#-]+$/;
const TOPIC_CHARS = /^[A-Za-z0-9_./-]+$/;

export interface MqttPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

export interface MqttInbound {
  topic: string;
  payload: Uint8Array;
  qos: 0 | 1 | 2;
  retain: boolean;
}

/** Subscribe, read, disconnect. There is intentionally no publish operation. */
export interface MqttReadSession {
  connect(): Promise<void>;
  subscribe(filters: readonly string[], qos: 0 | 1 | 2): Promise<void>;
  nextMessage(timeoutMs: number): Promise<MqttInbound | null>;
  disconnect(): Promise<void>;
}

export interface MqttCollectScope {
  topicFilters: readonly string[];
  qos: 0 | 1 | 2;
  windowMs: number;
  maxMessages: number;
  maxMessageBytes: number;
  maxTotalBytes: number;
}

export interface MqttCollectedMessage {
  topic: string;
  payloadText: string;
  payloadEncoding: "utf8" | "base64";
  qos: 0 | 1 | 2;
  retain: boolean;
  receivedAt: string;
  byteLength: number;
}

export interface MqttCollectedWindow {
  messages: MqttCollectedMessage[];
  bytes: number;
  startedAt: string;
  finishedAt: string;
  truncated: boolean;
}

export interface MqttReadConnectOptions {
  protocol: "wss";
  protocolVersion: 4;
  username: string;
  password: string;
  clientId: string;
  clean: true;
  reconnectPeriod: 0;
  connectTimeout: number;
  resubscribe: false;
  keepalive: number;
}

type MessageHandler = (
  topic: string,
  payload: Uint8Array,
  packet: { qos?: number; retain?: boolean },
) => void;

export interface MqttJsLikeClient {
  connected?: boolean;
  on(event: "connect", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "message", handler: MessageHandler): void;
  subscribe(
    topic: string | string[],
    options: { qos: 0 | 1 | 2 },
    callback: (error: Error | null) => void,
  ): void;
  end(force?: boolean, callback?: () => void): void;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new Error(`${label} exceeds its ${max}-character limit.`);
  }
  return text;
}

function iso(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new Error("MQTT receive clock is invalid.");
  }
  return new Date(ms).toISOString();
}

function qos(value: unknown, label: string): 0 | 1 | 2 {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new Error(`${label} must be 0, 1, or 2.`);
  }
  return value;
}

export function assertMqttTopicFilter(filter: string): void {
  if (
    filter.length < 1 ||
    filter.length > MQTT_LIMITS.maxFilterLength ||
    !FILTER_CHARS.test(filter) ||
    filter.includes("$")
  ) {
    throw new Error(
      "MQTT topic filters must be 1–256 ASCII letters, digits, / . _ - + # and must not address $ topics.",
    );
  }
  const levels = filter.split("/");
  if (levels.some((level) => level.length === 0)) {
    throw new Error("MQTT topic filters must not contain an empty level.");
  }
  levels.forEach((level, index) => {
    if (level === "#") {
      if (index !== levels.length - 1) {
        throw new Error("MQTT multi-level wildcard # must be the last level.");
      }
      return;
    }
    if (level.includes("#") || level.includes("+")) {
      if (level !== "+") {
        throw new Error(
          "MQTT wildcard + must occupy a whole topic level, and # must be the final level.",
        );
      }
    }
  });
}

export function parseMqttTopicFilters(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("MQTT topic filters must be a JSON array.");
  }
  if (
    value.length < MQTT_LIMITS.minFilters ||
    value.length > MQTT_LIMITS.maxFilters
  ) {
    throw new Error("MQTT topic filters must contain 1 to 8 entries.");
  }
  const filters = value.map((item, index) => {
    const filter = requiredText(
      item,
      `MQTT topic filter ${index + 1}`,
      MQTT_LIMITS.maxFilterLength,
    );
    assertMqttTopicFilter(filter);
    return filter;
  });
  if (new Set(filters).size !== filters.length) {
    throw new Error("MQTT topic filters must be unique.");
  }
  return filters;
}

export function topicMatchesFilter(topic: string, filter: string): boolean {
  if (
    topic.length < 1 ||
    topic.length > MQTT_LIMITS.maxTopicLength ||
    !TOPIC_CHARS.test(topic) ||
    topic.split("/").some((level) => level.length === 0)
  ) {
    return false;
  }
  if (topic.startsWith("$")) return false;
  const topicLevels = topic.split("/");
  const filterLevels = filter.split("/");
  for (let index = 0; index < filterLevels.length; index += 1) {
    const level = filterLevels[index];
    if (level === "#") return index === filterLevels.length - 1;
    if (index >= topicLevels.length) return false;
    if (level !== "+" && level !== topicLevels[index]) return false;
  }
  return filterLevels.length === topicLevels.length;
}

export function topicMatchesAnyFilter(
  topic: string,
  filters: readonly string[],
): boolean {
  return filters.some((filter) => topicMatchesFilter(topic, filter));
}

function privateHost(host: string): boolean {
  const ipv4 =
    /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      host,
    );
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.startsWith("[") ||
    ipv4
  );
}

export function validateMqttBrokerUrl(
  value: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MQTT broker URL is not a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : 443;
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    privateHost(host)
  ) {
    throw new Error(
      "MQTT broker URL must be a credential-free public wss:// URL without a query or fragment. Raw TCP mqtts:// and cleartext ws:// are refused because this Edge runtime subscribes over TLS WebSockets only.",
    );
  }
  const allowlist = allowedHosts.map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!allowlist.length || !allowlist.includes(host)) {
    throw new Error("Configured MQTT host is not in the deployment allowlist.");
  }
  return url;
}

export function normalizeMqttPullRequest(value: unknown): MqttPullRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MQTT pull request must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const connectorKey = requiredText(body.connector_key, "connector_key", 160);
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  return { connectorKey, dryRun: body.dry_run !== false };
}

export function buildMqttReadConnectOptions(input: {
  username: string;
  password: string;
  clientId: string;
}): MqttReadConnectOptions {
  const username = requiredText(input.username, "MQTT username", 128);
  const password = requiredText(input.password, "MQTT password", 256);
  const clientId = requiredText(input.clientId, "MQTT client id", 23);
  if (hasControlCharacter(username) || hasControlCharacter(password)) {
    throw new Error("MQTT username and password must not contain control characters.");
  }
  if (!/^syncai-ro-[0-9a-f]{12}$/.test(clientId)) {
    throw new Error("MQTT client id must be a generated syncai-ro- identifier.");
  }
  const options: MqttReadConnectOptions = {
    protocol: "wss",
    protocolVersion: 4,
    username,
    password,
    clientId,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    resubscribe: false,
    keepalive: 15,
  };
  if ("will" in options) {
    throw new Error("MQTT read sessions must not set a last-will publish.");
  }
  return options;
}

export function encodeMqttPayload(
  bytes: Uint8Array,
  maxBytes: number,
): { text: string; encoding: "utf8" | "base64" } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("MQTT message byte limit is invalid.");
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error("MQTT payload exceeds the approved message byte limit.");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) {
      throw new Error("nul");
    }
    return { text, encoding: "utf8" };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "MQTT payload exceeds the approved message byte limit."
    ) {
      throw error;
    }
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { text: btoa(binary), encoding: "base64" };
  }
}

export function canonicalMqttBatch(
  messages: readonly MqttCollectedMessage[],
): string {
  return JSON.stringify(
    messages.map((message) => ({
      topic: message.topic,
      payload_text: message.payloadText,
      payload_encoding: message.payloadEncoding,
      qos: message.qos,
      retain: message.retain,
      received_at: message.receivedAt,
    })),
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function asBytes(payload: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  throw new Error("MQTT payload must be bytes.");
}

export async function collectMqttReadWindow(
  session: MqttReadSession,
  scope: MqttCollectScope,
  clock: () => number = Date.now,
): Promise<MqttCollectedWindow> {
  const topicFilters = parseMqttTopicFilters([...scope.topicFilters]);
  const subscribeQos = qos(scope.qos, "MQTT subscribe QoS");
  if (
    !Number.isSafeInteger(scope.windowMs) ||
    scope.windowMs < MQTT_LIMITS.minWindowSeconds * 1000 ||
    scope.windowMs > MQTT_LIMITS.maxWindowSeconds * 1000 ||
    !Number.isSafeInteger(scope.maxMessages) ||
    scope.maxMessages < MQTT_LIMITS.minMessages ||
    scope.maxMessages > MQTT_LIMITS.maxMessages ||
    !Number.isSafeInteger(scope.maxMessageBytes) ||
    scope.maxMessageBytes < 1 ||
    scope.maxMessageBytes > MQTT_LIMITS.maxMessageBytes ||
    !Number.isSafeInteger(scope.maxTotalBytes) ||
    scope.maxTotalBytes < scope.maxMessageBytes ||
    scope.maxTotalBytes > MQTT_LIMITS.maxTotalBytes
  ) {
    throw new Error("MQTT listen window is outside the approved bounds.");
  }

  let opened = false;
  let primary: unknown;
  let disconnectError: unknown;
  let result: MqttCollectedWindow | undefined;
  try {
    await session.connect();
    opened = true;
    await session.subscribe(topicFilters, subscribeQos);
    const startedMs = clock();
    const deadline = startedMs + scope.windowMs;
    const messages: MqttCollectedMessage[] = [];
    let bytes = 0;
    let skipped = 0;
    let truncated = false;

    while (messages.length < scope.maxMessages) {
      const remaining = deadline - clock();
      if (remaining <= 0) break;
      const waitedFrom = clock();
      const inbound = await session.nextMessage(remaining);
      if (!inbound) {
        const elapsed = clock() - waitedFrom;
        if (clock() >= deadline || elapsed >= remaining - 25) break;
        throw new Error("MQTT session ended before the listen window closed.");
      }
      const topic = inbound.topic;
      if (!topicMatchesAnyFilter(topic, topicFilters)) {
        skipped += 1;
        if (skipped > MQTT_LIMITS.maxSkipped) {
          throw new Error(
            "MQTT broker delivered too many messages outside the approved topic filters.",
          );
        }
        continue;
      }
      const payload = asBytes(inbound.payload);
      if (bytes + payload.byteLength > scope.maxTotalBytes) {
        truncated = true;
        break;
      }
      const encoded = encodeMqttPayload(payload, scope.maxMessageBytes);
      const messageQos = qos(inbound.qos, "MQTT message QoS");
      bytes += payload.byteLength;
      messages.push({
        topic,
        payloadText: encoded.text,
        payloadEncoding: encoded.encoding,
        qos: messageQos,
        retain: inbound.retain === true,
        receivedAt: iso(clock()),
        byteLength: payload.byteLength,
      });
      if (messages.length >= scope.maxMessages && clock() < deadline) {
        truncated = true;
      }
    }

    result = {
      messages,
      bytes,
      startedAt: iso(startedMs),
      finishedAt: iso(clock()),
      truncated,
    };
  } catch (error) {
    primary = error;
  } finally {
    if (opened) {
      try {
        await session.disconnect();
      } catch (error) {
        disconnectError = error;
      }
    }
  }
  if (primary !== undefined) {
    throw primary instanceof Error ? primary : new Error("MQTT listen failed.");
  }
  if (disconnectError !== undefined) {
    throw disconnectError instanceof Error
      ? disconnectError
      : new Error("MQTT disconnect failed.");
  }
  if (!result) throw new Error("MQTT listen produced no result.");
  return result;
}

export function createMqttJsReadSession(
  client: MqttJsLikeClient,
  connectTimeoutMs = 10_000,
): MqttReadSession {
  const queue: MqttInbound[] = [];
  let waiter: ((value: MqttInbound | null | Error) => void) | null = null;
  let failed: Error | null = null;
  let opened = client.connected === true;
  let closed = false;
  let settleConnect: ((error?: Error) => void) | null = null;

  const deliver = (value: MqttInbound | null | Error) => {
    if (waiter) {
      const pending = waiter;
      waiter = null;
      pending(value);
      return;
    }
    if (value instanceof Error) failed = value;
    else if (value) queue.push(value);
  };

  client.on("connect", () => {
    opened = true;
    settleConnect?.();
  });
  client.on("error", (error) => {
    failed = error instanceof Error ? error : new Error("MQTT client failed.");
    if (!opened) settleConnect?.(failed);
    else deliver(failed);
  });
  client.on("close", () => {
    closed = true;
    deliver(null);
  });
  client.on("message", (topic, payload, packet) => {
    try {
      deliver({
        topic,
        payload: asBytes(payload),
        qos: qos(packet?.qos ?? 0, "MQTT message QoS"),
        retain: packet?.retain === true,
      });
    } catch (error) {
      deliver(error instanceof Error ? error : new Error("MQTT message was refused."));
    }
  });

  return {
    async connect() {
      if (failed && !opened) throw failed;
      if (opened) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          settleConnect = null;
          reject(new Error("MQTT connect timed out."));
        }, connectTimeoutMs);
        settleConnect = (error?: Error) => {
          clearTimeout(timer);
          settleConnect = null;
          if (error) reject(error);
          else resolve();
        };
        if (opened) settleConnect();
      });
    },
    async subscribe(filters, subscribeQos) {
      if (failed) throw failed;
      await new Promise<void>((resolve, reject) => {
        client.subscribe([...filters], { qos: subscribeQos }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    async nextMessage(timeoutMs) {
      if (failed && queue.length === 0) throw failed;
      const queued = queue.shift();
      if (queued) return queued;
      if (closed) return null;
      const value = await new Promise<MqttInbound | null | Error>((resolve) => {
        const timer = setTimeout(() => {
          waiter = null;
          resolve(null);
        }, Math.max(0, timeoutMs));
        waiter = (incoming) => {
          clearTimeout(timer);
          resolve(incoming);
        };
      });
      if (value instanceof Error) throw value;
      return value;
    },
    async disconnect() {
      await new Promise<void>((resolve, reject) => {
        try {
          client.end(true, () => resolve());
        } catch (error) {
          reject(error instanceof Error ? error : new Error("MQTT disconnect failed."));
        }
      });
    },
  };
}
