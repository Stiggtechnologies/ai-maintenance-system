/**
 * sync-tts — signed-in short-utterance speech for Meet Sync / Sync.
 *
 * PLATFORM JWT VERIFICATION STAYS ON. The caller must be a signed-in user.
 * This function synthesizes speech only. It does not authorize plant execute,
 * raise work, or invent OEM limits. Recommend ≠ authorize.
 *
 * Provider: OpenAI Speech with the existing OPENAI_API_KEY edge secret.
 * Optional SYNC_TTS_VOICE (default marin). The preferred model also receives
 * a bounded delivery instruction for warm, expressive speech.
 * ELEVENLABS_API_KEY is a later overlay and is not required.
 *
 * Every POST reserves a sync-tts usage row before OpenAI is contacted.
 * The daily character cap and the per-user rate limit come from
 * SYNC_TTS_QUOTA_CONFIG. Env overrides may only lower those caps. Audio is
 * returned only after the reservation is settled. This path does not call
 * the commercial plan policy functions.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { withDataEgressGuard } from "../_shared/data-egress-guard.ts";
import {
  FALLBACK_TTS_MODEL,
  PREFERRED_TTS_MODEL,
  SYNC_TTS_MESSAGES,
  isCloudTtsConfigured,
  resolveSyncTtsQuotaLimits,
  resolveTtsVoice,
  runMeteredSyncTts,
  syncTtsRefusalBody,
  syncTtsRetryAfterSeconds,
  syncTtsUsageHeaders,
  synthesizeOpenAiSpeech,
  validateSyncTtsInput,
} from "../_shared/sync-tts-core.ts";
import type { SyncTtsRpc } from "../_shared/sync-tts-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TTS_VOICE = resolveTtsVoice(Deno.env.get("SYNC_TTS_VOICE"));
const QUOTA_LIMITS = resolveSyncTtsQuotaLimits({
  SYNC_TTS_DAILY_CHAR_QUOTA: Deno.env.get("SYNC_TTS_DAILY_CHAR_QUOTA"),
  SYNC_TTS_USER_RATE_LIMIT: Deno.env.get("SYNC_TTS_USER_RATE_LIMIT"),
  // A shorter window would weaken the per-user limit, so the resolver keeps
  // the configured 60 seconds even when this variable is set.
  SYNC_TTS_USER_RATE_WINDOW_SECONDS: Deno.env.get(
    "SYNC_TTS_USER_RATE_WINDOW_SECONDS",
  ),
});
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function usageRpc(): SyncTtsRpc {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (functionName, args) => {
    const { data, error } = await admin.rpc(functionName, args);
    return { data, error };
  };
}

async function requireSignedInUser(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return {
      user: null,
      client: null,
      error: json({ error: "unauthorized" }, 401),
    };
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      return {
        user: null,
        client: null,
        error: json({ error: "unauthorized" }, 401),
      };
    }
    return { user: data.user, client, error: null };
  } catch {
    return {
      user: null,
      client: null,
      error: json({ error: "unauthorized" }, 401),
    };
  }
}

async function resolveTenant(
  userId: string,
): Promise<
  | { ok: true; organizationId: string }
  | { ok: false; error: string; message: string; status: number }
> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      ok: false,
      error: "tts_usage_unavailable",
      message: SYNC_TTS_MESSAGES.usageUnavailable,
      status: 503,
    };
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin
      .from("user_profiles")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        error: "tts_usage_unavailable",
        message: SYNC_TTS_MESSAGES.usageUnavailable,
        status: 503,
      };
    }
    if (!data?.organization_id) {
      return {
        ok: false,
        error: "organization_required",
        message: SYNC_TTS_MESSAGES.organizationRequired,
        status: 403,
      };
    }
    return { ok: true, organizationId: String(data.organization_id) };
  } catch {
    return {
      ok: false,
      error: "tts_usage_unavailable",
      message: SYNC_TTS_MESSAGES.usageUnavailable,
      status: 503,
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireSignedInUser(request);
  if (auth.error || !auth.user) {
    return auth.error ?? json({ error: "unauthorized" }, 401);
  }

  if (request.method === "GET") {
    const configured = isCloudTtsConfigured(OPENAI_API_KEY);
    return json({
      configured,
      engine: configured ? "openai" : "unconfigured",
      model: configured ? PREFERRED_TTS_MODEL : null,
      voice: configured ? TTS_VOICE : null,
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!isCloudTtsConfigured(OPENAI_API_KEY)) {
    return json({ error: "cloud_tts_unconfigured" }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const validated = validateSyncTtsInput(body);
  if (!validated.ok) {
    return json({ error: validated.error }, validated.status);
  }

  const tenant = await resolveTenant(auth.user.id);
  if (!tenant.ok) {
    console.error(
      JSON.stringify({
        fn: "sync-tts",
        event: "usage_record_failed",
        error: tenant.error,
        user_id: auth.user.id,
      }),
    );
    return json(
      syncTtsRefusalBody({ error: tenant.error, message: tenant.message }),
      tenant.status,
    );
  }

  try {
    const guardedFetch = withDataEgressGuard(fetch, auth.client!, {
      dataClass: "security_sensitive",
      purpose: "speech_synthesis",
      serviceLabel: "sync-tts",
    });
    const metered = await runMeteredSyncTts({
      rpc: usageRpc(),
      organizationId: tenant.organizationId,
      userId: auth.user.id,
      text: validated.text,
      limits: QUOTA_LIMITS,
      synthesize: (text) =>
        synthesizeOpenAiSpeech({
          apiKey: OPENAI_API_KEY,
          text,
          voice: TTS_VOICE,
          preferredModel: PREFERRED_TTS_MODEL,
          fallbackModel: FALLBACK_TTS_MODEL,
          fetchImpl: guardedFetch as typeof fetch,
        }),
    });
    if (!metered.ok) {
      console.error(
        JSON.stringify({
          fn: "sync-tts",
          event:
            metered.error === "cloud_tts_failed"
              ? "synthesize_failed"
              : "usage_refused",
          error: metered.error,
          organization_id: tenant.organizationId,
          user_id: auth.user.id,
          reservation_id: metered.reservationId,
          characters: metered.usage?.characters ?? null,
        }),
      );
      const retryAfter =
        metered.status === 429
          ? syncTtsRetryAfterSeconds(metered.usage?.resetsAt ?? null)
          : null;
      return json(
        syncTtsRefusalBody({
          error: metered.error,
          message: metered.message,
          usage: metered.usage,
        }),
        metered.status,
        retryAfter == null ? {} : { "Retry-After": String(retryAfter) },
      );
    }
    console.log(
      JSON.stringify({
        fn: "sync-tts",
        event: "usage_recorded",
        organization_id: tenant.organizationId,
        user_id: auth.user.id,
        reservation_id: metered.reservationId,
        characters: metered.usage.characters,
        characters_used: metered.usage.charactersUsed,
        model: metered.model,
      }),
    );
    return new Response(metered.bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        ...syncTtsUsageHeaders(metered.usage),
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        fn: "sync-tts",
        event: "usage_record_failed",
        message: error instanceof Error ? error.message : "unknown",
        organization_id: tenant.organizationId,
        user_id: auth.user.id,
      }),
    );
    return json(
      syncTtsRefusalBody({
        error: "tts_usage_unavailable",
        message: SYNC_TTS_MESSAGES.usageUnavailable,
      }),
      503,
    );
  }
});
