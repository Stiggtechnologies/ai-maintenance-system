/**
 * sync-realtime-session — authenticated WebRTC negotiation for Sync Voice.
 *
 * The OpenAI key remains server-side. The browser sends a WebRTC SDP offer;
 * this function authenticates the user, resolves their tenant, enforces the
 * existing Sync flags and canonical LLM quota reservation, and exchanges the
 * offer with OpenAI Realtime. Plant facts and actions are deliberately absent
 * here: the Realtime model must call the client `ask_sync` tool, which reuses
 * Sync Investigation Runtime and its evidence/approval contracts.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_REALTIME_MODEL,
  MAX_REALTIME_BODY_BYTES,
  REALTIME_SESSION_TOKEN_BUDGET,
  RealtimeRequestError,
  buildRealtimeSessionConfig,
  parseRealtimeSessionRequest,
} from "../_shared/sync-realtime-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const REALTIME_MODEL =
  Deno.env.get("OPENAI_REALTIME_MODEL")?.trim() || DEFAULT_REALTIME_MODEL;
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

interface AuthContext {
  userId: string;
  organizationId: string;
}

interface QuotaDecision {
  allowed?: boolean;
  reservation_id?: number;
  limit?: string;
  resets_at?: string;
}

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearer(req: Request): string {
  const value = req.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  return !origin || origin === ALLOWED_ORIGIN;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearer(req);
  if (!token) return null;
  const admin = adminClient();
  const { data: userResult, error: userError } =
    await admin.auth.getUser(token);
  if (userError || !userResult.user) return null;
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) return null;
  return {
    userId: userResult.user.id,
    organizationId: String(profile.organization_id),
  };
}

async function enabledFlags(organizationId: string): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .from("feature_flags")
    .select("flag_key, enabled")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .in("flag_key", [
      "sync_global_shell",
      "sync_voice_input",
      "sync_voice_output",
    ]);
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.flag_key)));
}

async function reserveQuota(
  organizationId: string,
): Promise<QuotaDecision | null> {
  const { data, error } = await adminClient().rpc("check_llm_quota", {
    p_organization_id: organizationId,
    p_fn: "sync-realtime-session",
    p_model: REALTIME_MODEL,
    p_estimated_tokens: REALTIME_SESSION_TOKEN_BUDGET,
  });
  if (error || !data || typeof data !== "object") {
    console.error("sync-realtime-session quota check unavailable", error);
    return null;
  }
  return data as QuotaDecision;
}

async function releaseQuota(reservationId: number | null): Promise<void> {
  if (reservationId === null) return;
  const { error } = await adminClient().rpc("release_llm_reservation", {
    p_reservation_id: reservationId,
  });
  if (error) {
    console.error("sync-realtime-session quota release failed", error);
  }
}

async function readBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REALTIME_BODY_BYTES) {
    throw new RealtimeRequestError("request_too_large", 413);
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REALTIME_BODY_BYTES) {
    throw new RealtimeRequestError("request_too_large", 413);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RealtimeRequestError("invalid_json");
  }
}

Deno.serve(async (req: Request) => {
  if (!originAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("sync-realtime-session missing Supabase configuration");
    return json({ error: "service_unavailable" }, 503);
  }

  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let flags: Set<string>;
  try {
    flags = await enabledFlags(auth.organizationId);
  } catch (error) {
    console.error("sync-realtime-session feature flag read failed", error);
    return json({ error: "feature_flag_unavailable" }, 503);
  }
  if (!flags.has("sync_global_shell")) {
    return json({ error: "sync_not_enabled" }, 403);
  }
  if (!flags.has("sync_voice_input") || !flags.has("sync_voice_output")) {
    return json({ error: "sync_realtime_voice_disabled" }, 403);
  }
  if (!OPENAI_API_KEY) {
    return json(
      { error: "voice_not_configured", code: "voice_not_configured" },
      503,
    );
  }

  let payload;
  try {
    payload = parseRealtimeSessionRequest(await readBody(req));
  } catch (error) {
    if (error instanceof RealtimeRequestError) {
      return json({ error: error.code, code: error.code }, error.status);
    }
    return json({ error: "invalid_request" }, 400);
  }

  const quota = await reserveQuota(auth.organizationId);
  if (!quota) {
    return json({ error: "quota_check_unavailable" }, 503);
  }
  if (!quota.allowed) {
    return json(
      {
        error: "org_daily_quota_exceeded",
        limit: quota.limit ?? null,
        resets_at: quota.resets_at ?? null,
      },
      429,
    );
  }
  const reservationId =
    typeof quota.reservation_id === "number" ? quota.reservation_id : null;
  if (reservationId === null) {
    console.error("sync-realtime-session quota reservation was not created");
    return json({ error: "quota_check_unavailable" }, 503);
  }

  try {
    const form = new FormData();
    form.set("sdp", payload.sdp);
    form.set(
      "session",
      JSON.stringify(
        buildRealtimeSessionConfig({
          model: REALTIME_MODEL,
          context: payload.context,
        }),
      ),
    );
    const upstream = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: req.signal,
    });
    if (!upstream.ok) {
      const diagnostic = await upstream.text();
      console.error(
        "sync-realtime-session provider rejected negotiation",
        upstream.status,
        diagnostic.slice(0, 500),
      );
      await releaseQuota(reservationId);
      return json(
        { error: "voice_provider_unavailable", code: "provider_error" },
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      );
    }
    return json(
      {
        session: { id: "realtime" },
        model: REALTIME_MODEL,
        transport: {
          type: "webrtc",
          sdp: await upstream.text(),
        },
      },
      201,
    );
  } catch (error) {
    console.error("sync-realtime-session negotiation failed", error);
    await releaseQuota(reservationId);
    return json(
      { error: "voice_connection_failed", code: "voice_connection_failed" },
      502,
    );
  }
});
