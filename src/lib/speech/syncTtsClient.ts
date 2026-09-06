/**
 * Client for the signed-in `sync-tts` edge function.
 *
 * Returns mp3/mpeg bytes. The OpenAI key stays on the server. Missing
 * session, missing key (503), or a failed synthesize are errors so the
 * speech adapter can fall back to browser speechSynthesis.
 */
import { supabase } from "../supabase";
import { supabasePublicKey, supabaseUrl } from "../supabase-config";
import { stripForSpeech } from "../../../supabase/functions/_shared/sync-tts-core";

export const SYNC_TTS_FUNCTION = "sync-tts";
export const SYNC_TTS_TIMEOUT_MS = 20_000;

export class SyncTtsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 0) {
    super(code);
    this.name = "SyncTtsError";
    this.code = code;
    this.status = status;
  }
}

export async function probeSyncTtsConfigured(): Promise<boolean> {
  const token = await readAccessToken();
  if (!token || !supabaseUrl) return false;
  const response = await fetch(syncTtsUrl(), {
    method: "GET",
    headers: authHeaders(token),
    signal: AbortSignal.timeout(SYNC_TTS_TIMEOUT_MS),
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { configured?: unknown };
  return body.configured === true;
}

export async function requestSyncTtsAudio(
  text: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const spoken = stripForSpeech(text);
  if (!spoken) throw new SyncTtsError("text_required", 400);
  const token = await readAccessToken();
  if (!token) throw new SyncTtsError("unauthorized", 401);
  if (!supabaseUrl) throw new SyncTtsError("unconfigured", 503);

  const timeout = AbortSignal.timeout(SYNC_TTS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(syncTtsUrl(), {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: spoken }),
    signal: combined,
  });

  if (response.status === 401) throw new SyncTtsError("unauthorized", 401);
  if (response.status === 503) {
    throw new SyncTtsError("cloud_tts_unconfigured", 503);
  }
  if (!response.ok) {
    throw new SyncTtsError("cloud_tts_failed", response.status);
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("audio/")) {
    throw new SyncTtsError("unexpected_content_type", response.status);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new SyncTtsError("empty_audio", 502);
  return blob;
}

async function readAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function syncTtsUrl(): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${SYNC_TTS_FUNCTION}`;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    apikey: supabasePublicKey,
  };
}
