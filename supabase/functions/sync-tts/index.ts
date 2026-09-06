/**
 * sync-tts — signed-in short-utterance speech for Meet Sync / Sync.
 *
 * PLATFORM JWT VERIFICATION STAYS ON. The caller must be a signed-in user.
 * This function synthesizes speech only. It does not authorize plant execute,
 * raise work, or invent OEM limits. Recommend ≠ authorize.
 *
 * Provider: OpenAI Speech with the existing OPENAI_API_KEY edge secret.
 * Optional SYNC_TTS_VOICE (default onyx). ELEVENLABS_API_KEY is a later
 * overlay and is not required.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  FALLBACK_TTS_MODEL,
  PREFERRED_TTS_MODEL,
  isCloudTtsConfigured,
  resolveTtsVoice,
  synthesizeOpenAiSpeech,
  validateSyncTtsInput,
} from "../_shared/sync-tts-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TTS_VOICE = resolveTtsVoice(Deno.env.get("SYNC_TTS_VOICE"));
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function requireSignedInUser(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return { user: null, error: json({ error: "unauthorized" }, 401) };
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      return { user: null, error: json({ error: "unauthorized" }, 401) };
    }
    return { user: data.user, error: null };
  } catch {
    return { user: null, error: json({ error: "unauthorized" }, 401) };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireSignedInUser(request);
  if (auth.error) return auth.error;

  if (request.method === "GET") {
    const configured = isCloudTtsConfigured(OPENAI_API_KEY);
    return json({
      configured,
      engine: configured ? "openai" : "unconfigured",
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

  try {
    const result = await synthesizeOpenAiSpeech({
      apiKey: OPENAI_API_KEY,
      text: validated.text,
      voice: TTS_VOICE,
      preferredModel: PREFERRED_TTS_MODEL,
      fallbackModel: FALLBACK_TTS_MODEL,
    });
    if (!result.ok) {
      const status = result.status === 401 || result.status === 403
        ? 502
        : result.status >= 400 && result.status < 600
          ? result.status
          : 502;
      return json({ error: "cloud_tts_failed" }, status);
    }
    return new Response(result.bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        fn: "sync-tts",
        event: "synthesize_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return json({ error: "cloud_tts_failed" }, 502);
  }
});
