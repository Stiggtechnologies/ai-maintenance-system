// Governed read-only MQTT subscribe for C2.21. This function connects to one
// allowlisted broker over TLS WebSockets (mqtt.js 5.16.1), subscribes to the
// administrator's topic filters, collects a bounded window, and disconnects.
// It never publishes, never sets a last will, and never promotes a payload
// into a condition reading or engineering limit. Deno has no raw TCP here, so
// mqtts:// is refused; the transport is wss:// only.
import { createClient } from "npm:@supabase/supabase-js@2";
import mqtt from "npm:mqtt@5.16.1";
import {
  buildMqttReadConnectOptions,
  canonicalMqttBatch,
  collectMqttReadWindow,
  createMqttJsReadSession,
  normalizeMqttPullRequest,
  parseMqttTopicFilters,
  sha256Hex,
  validateMqttBrokerUrl,
  type MqttReadSession,
} from "../_shared/mqtt-read.ts";

type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("MQTT_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON = Deno.env.get("MQTT_READ_CREDENTIALS_JSON") ?? "{}";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_MESSAGE_BYTES = 8192;
const MAX_TOTAL_BYTES = 262_144;

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeLog(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn: "mqtt-read-pull", event, ...detail }));
}

function safeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : "MQTT pull failed.";
  return text
    .replace(/password[=:][^\s]+/gi, "password=(redacted)")
    .slice(0, 200);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function passwordEntry(binding: string): { username: string; password: string } {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("MQTT credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.type !== "mqtt_password") {
    throw new Error(
      "MQTT credential binding must name an mqtt_password entry in the Edge secret registry.",
    );
  }
  const username = typeof entry.username === "string" ? entry.username : "";
  const password = typeof entry.password === "string" ? entry.password : "";
  return { username, password };
}

function liveSession(
  brokerUrl: string,
  username: string,
  password: string,
): MqttReadSession {
  const clientId = `syncai-ro-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const options = buildMqttReadConnectOptions({ username, password, clientId });
  const client = mqtt.connect(brokerUrl, options);
  return createMqttJsReadSession(client, options.connectTimeout);
}

async function rpc<T>(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    safeLog("rpc_failed", {
      rpc: name,
      code: typeof error.code === "string" ? error.code : "unknown",
    });
    throw new Error("MQTT data operation failed.");
  }
  const payload = data as { error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "service_unavailable" }, 503);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  let connectorKey: string;
  let dryRun: boolean;
  try {
    ({ connectorKey, dryRun } = normalizeMqttPullRequest(body));
  } catch (error) {
    return json({ error: safeReason(error) }, 400);
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let runId: string | null = null;
  let organizationId: string | null = null;
  try {
    const source = await rpc<JsonRecord>(userClient, "get_mqtt_read_source", {
      p_connector_key: connectorKey,
    });
    organizationId = String(source.organization_id ?? "");
    if (
      !source.enabled ||
      source.direction !== "read_only" ||
      source.write_enabled
    ) {
      throw new Error("MQTT source is not enabled and read-only.");
    }
    const broker = validateMqttBrokerUrl(
      String(source.broker_url ?? ""),
      ALLOWED_HOSTS,
    );
    const topicFilters = parseMqttTopicFilters(source.topic_filters);
    const windowSeconds = Number(source.window_seconds ?? 0);
    const maxMessages = Number(source.max_messages ?? 0);
    const subscribeQos = Number(source.subscribe_qos ?? -1);
    if (
      !organizationId ||
      !Number.isSafeInteger(windowSeconds) ||
      windowSeconds < 1 ||
      windowSeconds > 30 ||
      !Number.isSafeInteger(maxMessages) ||
      maxMessages < 1 ||
      maxMessages > 200 ||
      (subscribeQos !== 0 && subscribeQos !== 1 && subscribeQos !== 2)
    ) {
      throw new Error("MQTT source profile is invalid.");
    }
    const secret = passwordEntry(String(source.credential_binding_ref ?? ""));
    const collected = await collectMqttReadWindow(
      liveSession(broker.href, secret.username, secret.password),
      {
        topicFilters,
        qos: subscribeQos,
        windowMs: windowSeconds * 1000,
        maxMessages,
        maxMessageBytes: MAX_MESSAGE_BYTES,
        maxTotalBytes: MAX_TOTAL_BYTES,
      },
    );
    const canonical = canonicalMqttBatch(collected.messages);
    const digest = await sha256Hex(new TextEncoder().encode(canonical));
    const manifest = [
      {
        transport: "mqtt_wss_subscribe",
        broker_host: broker.hostname.toLowerCase(),
        topic_filters: topicFilters,
        subscribe_qos: subscribeQos,
        window_started_at: collected.startedAt,
        window_finished_at: collected.finishedAt,
        sha256: digest,
        bytes: collected.bytes,
        row_count: collected.messages.length,
        truncated: collected.truncated,
      },
    ];
    const cursor = {
      window_started_at: collected.startedAt,
      window_finished_at: collected.finishedAt,
      message_count: collected.messages.length,
      bytes: collected.bytes,
      truncated: collected.truncated,
    };
    const silence =
      collected.messages.length === 0
        ? " No messages arrived. Silence is not a process state."
        : "";
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        messages: collected.messages.length,
        bytes: collected.bytes,
        truncated: collected.truncated,
        note: `No run or staging row was written.${silence}`,
      });
    }

    const rows = [];
    for (const [index, message] of collected.messages.entries()) {
      const externalId = await sha256Hex(
        new TextEncoder().encode(
          [
            index,
            message.topic,
            message.qos,
            message.receivedAt,
            message.payloadEncoding,
            message.payloadText,
          ].join("\n"),
        ),
      );
      rows.push({
        external_id: externalId,
        topic: message.topic,
        payload_text: message.payloadText,
        payload_encoding: message.payloadEncoding,
        qos: message.qos,
        retain: message.retain,
        received_at: message.receivedAt,
      });
    }

    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_mqtt_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_manifest: manifest,
        p_cursor_to: cursor,
        p_source_bytes: collected.bytes,
      },
    );
    runId = begun.run_id;
    const ingested = await rpc<Record<string, number>>(
      serviceClient,
      "ingest_mqtt_read_batch",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_run_id: runId,
        p_rows: rows,
      },
    );
    const rejected = Number(ingested.rejected ?? 0);
    const status = rejected > 0 ? "partial" : "success";
    const finished = await rpc<JsonRecord>(
      serviceClient,
      "finish_mqtt_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          rejected > 0
            ? `${rejected} MQTT messages were refused; inspect retained staging evidence.`
            : null,
      },
    );
    safeLog("pull_finished", {
      organization_id: organizationId,
      run_id: runId,
      status,
      messages: collected.messages.length,
    });
    return json({
      ...finished,
      messages: collected.messages.length,
      bytes: collected.bytes,
      truncated: collected.truncated,
      note: silence.trim(),
    });
  } catch (error) {
    const message = safeReason(error);
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message,
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_mqtt_read_run", {
          p_organization_id: organizationId,
          p_run_id: runId,
          p_status: "failed",
          p_error: message,
        });
      } catch (finishError) {
        safeLog("failed_run_close_error", {
          run_id: runId,
          reason: safeReason(finishError),
        });
      }
    }
    return json({ error: message }, 400);
  }
});
