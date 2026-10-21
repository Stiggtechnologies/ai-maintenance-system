/**
 * Meet Sync / Sync speech-output contract.
 *
 * Server-side TTS is a short-utterance adapter for signed-in presence (and
 * any other caller of useSpeechOutput). It is not a plant-execute path, not
 * an orchestrator, and not a license to invent OEM limits.
 *
 * Primary provider: OpenAI Speech (`OPENAI_API_KEY`, already an edge secret).
 * Prefer `gpt-4o-mini-tts`, fall back to `tts-1`. Optional `SYNC_TTS_VOICE`
 * (default `marin`). ElevenLabs (`ELEVENLABS_API_KEY`) is a later overlay and
 * must not block this path.
 *
 * Deno-free so vitest can pin validation without the edge runtime.
 *
 * Spend is metered before the provider call: a per-tenant UTC-day character
 * quota and a per-user rate limit, both capped by SYNC_TTS_QUOTA_CONFIG.
 * The provider is not called unless that usage row is reserved, and the
 * audio is not returned unless the same row is settled.
 */

export const SYNC_TTS_MAX_CHARS = 420;
/**
 * stripForSpeech may append one ellipsis when it cannot cut on a sentence.
 * The quota gate charges the text actually sent, so the ceiling is one
 * character above the strip budget.
 */
export const SYNC_TTS_MAX_UTTERANCE_CHARS = SYNC_TTS_MAX_CHARS + 1;
/**
 * Abuse ceilings for signed-in speech. Not an OEM limit and not a commercial
 * plan allowance. speechOutput may split one turn into two requests, and each
 * request is at most SYNC_TTS_MAX_UTTERANCE_CHARS. Twenty turns is the daily
 * tenant budget. Ten requests a minute is five split turns. Environment
 * overrides may only lower the character and request caps.
 */
export const SYNC_TTS_QUOTA_CONFIG = {
  dailyCharactersPerTenant: 20 * 2 * SYNC_TTS_MAX_UTTERANCE_CHARS,
  userRequestsPerWindow: 10,
  userWindowSeconds: 60,
} as const;
export const PREFERRED_TTS_MODEL = "gpt-4o-mini-tts";
export const FALLBACK_TTS_MODEL = "tts-1";
export const DEFAULT_TTS_VOICE = "marin";
export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const DEFAULT_TTS_INSTRUCTIONS =
  "Speak in a warm, confident, engaging Canadian English voice. Sound intelligent, present, and genuinely interested. Use natural conversational pacing, varied emphasis, and brief pauses. Avoid monotone delivery, exaggerated cheerfulness, theatrical performance, and sales-like energy. For risk or safety content, become calm and precise without sounding cold. Never read markdown syntax aloud.";

export const ALLOWED_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type AllowedTtsVoice = (typeof ALLOWED_TTS_VOICES)[number];

export type SyncTtsValidation =
  { ok: true; text: string } | { ok: false; error: string; status: number };

export type OpenAiSpeechResult =
  | { ok: true; bytes: Uint8Array; contentType: string; model: string }
  | { ok: false; error: string; status: number };

/**
 * Same cap already used by Meet Sync booth replies. Shared so the edge
 * function cannot speak a longer payload than the client already strips.
 */
export function stripForSpeech(
  text: string,
  maxChars = SYNC_TTS_MAX_CHARS,
): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
}

export function resolveTtsVoice(
  raw: string | undefined | null,
): AllowedTtsVoice {
  const voice = (raw ?? "").trim().toLowerCase();
  return (ALLOWED_TTS_VOICES as readonly string[]).includes(voice)
    ? (voice as AllowedTtsVoice)
    : DEFAULT_TTS_VOICE;
}

export function validateSyncTtsInput(body: unknown): SyncTtsValidation {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "invalid_json", status: 400 };
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return { ok: false, error: "text_required", status: 400 };
  }
  const spoken = stripForSpeech(text);
  if (!spoken) {
    return { ok: false, error: "text_required", status: 400 };
  }
  return { ok: true, text: spoken };
}

export function isCloudTtsConfigured(
  apiKey: string | undefined | null,
): boolean {
  return Boolean(apiKey && apiKey.trim());
}

export function shouldRetryWithFallbackModel(
  status: number,
  errorBody: string,
  preferredModel: string,
  fallbackModel: string,
): boolean {
  if (!preferredModel || preferredModel === fallbackModel) return false;
  if (status === 404) return true;
  if (status !== 400 && status !== 422) return false;
  return /model|does not exist|invalid|not found|unknown/i.test(errorBody);
}

export async function synthesizeOpenAiSpeech(input: {
  apiKey: string;
  text: string;
  voice: string;
  instructions?: string;
  preferredModel?: string;
  fallbackModel?: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAiSpeechResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const preferred = input.preferredModel ?? PREFERRED_TTS_MODEL;
  const fallback = input.fallbackModel ?? FALLBACK_TTS_MODEL;
  const first = await callOpenAiSpeech({
    fetchImpl,
    apiKey: input.apiKey,
    text: input.text,
    voice: input.voice,
    instructions: input.instructions ?? DEFAULT_TTS_INSTRUCTIONS,
    model: preferred,
  });
  if (first.ok) return first;
  if (
    shouldRetryWithFallbackModel(first.status, first.error, preferred, fallback)
  ) {
    return callOpenAiSpeech({
      fetchImpl,
      apiKey: input.apiKey,
      text: input.text,
      voice: input.voice,
      instructions: input.instructions ?? DEFAULT_TTS_INSTRUCTIONS,
      model: fallback,
    });
  }
  return first;
}

async function callOpenAiSpeech(input: {
  fetchImpl: typeof fetch;
  apiKey: string;
  text: string;
  voice: string;
  instructions: string;
  model: string;
}): Promise<OpenAiSpeechResult> {
  const supportsInstructions = !["tts-1", "tts-1-hd"].includes(input.model);
  const response = await input.fetchImpl(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      voice: input.voice,
      input: input.text,
      response_format: "mp3",
      ...(supportsInstructions ? { instructions: input.instructions } : {}),
    }),
  });
  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 400);
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      error: errorBody || "cloud_tts_failed",
    };
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    return { ok: false, status: 502, error: "empty_audio" };
  }
  const contentType = response.headers.get("Content-Type") || "audio/mpeg";
  return {
    ok: true,
    bytes: buffer,
    contentType: contentType.includes("audio/") ? contentType : "audio/mpeg",
    model: input.model,
  };
}

export interface SyncTtsQuotaLimits {
  dailyCharactersPerTenant: number;
  userRequestsPerWindow: number;
  userWindowSeconds: number;
}

export const SYNC_TTS_MESSAGES = {
  usageUnavailable:
    "Speech usage could not be recorded, so this request was not sent to the speech provider.",
  usageRecordFailed:
    "Speech usage could not be confirmed on the usage record, so the audio was withheld. The reserved characters stay counted.",
  organizationRequired:
    "Speech cannot be metered for this user without an organization, so the request was not sent.",
  organizationMismatch:
    "Speech usage could not be recorded for this organization, so the request was not sent.",
  utteranceTooLong: "Speech text exceeds the maximum utterance length.",
  cloudFailed: "Cloud speech did not return audio.",
} as const;

export interface SyncTtsUsageSnapshot {
  characters: number;
  charactersUsed: number | null;
  maxCharacters: number | null;
  requestsInWindow: number | null;
  maxRequests: number | null;
  windowSeconds: number | null;
  resetsAt: string | null;
}

export type SyncTtsRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export type MeteredSyncTtsResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string;
      model: string;
      reservationId: number;
      usage: SyncTtsUsageSnapshot;
    }
  | {
      ok: false;
      error: string;
      status: number;
      message: string;
      reservationId: number | null;
      usage: SyncTtsUsageSnapshot | null;
    };

/**
 * Positive integers at or below the configured ceiling. Blank, zero,
 * negative, and non-integer values keep the ceiling so a bad override
 * cannot remove the cap.
 */
export function resolveSyncTtsQuotaLimits(
  env: Record<string, string | undefined> = {},
): SyncTtsQuotaLimits {
  return {
    dailyCharactersPerTenant: tightenPositiveInteger(
      env.SYNC_TTS_DAILY_CHAR_QUOTA,
      SYNC_TTS_QUOTA_CONFIG.dailyCharactersPerTenant,
    ),
    userRequestsPerWindow: tightenPositiveInteger(
      env.SYNC_TTS_USER_RATE_LIMIT,
      SYNC_TTS_QUOTA_CONFIG.userRequestsPerWindow,
    ),
    // The published window is fixed. A shorter window would count fewer
    // requests and weaken the per-user limit.
    userWindowSeconds: SYNC_TTS_QUOTA_CONFIG.userWindowSeconds,
  };
}

export function syncTtsUsageHeaders(
  usage: SyncTtsUsageSnapshot,
): Record<string, string> {
  return {
    "X-Sync-Tts-Characters": String(usage.characters),
    "X-Sync-Tts-Characters-Used":
      usage.charactersUsed == null ? "" : String(usage.charactersUsed),
    "X-Sync-Tts-Daily-Character-Limit":
      usage.maxCharacters == null ? "" : String(usage.maxCharacters),
  };
}

export function syncTtsRefusalBody(input: {
  error: string;
  message: string;
  usage?: SyncTtsUsageSnapshot | null;
}): Record<string, unknown> {
  const usage = input.usage ?? null;
  return {
    error: input.error,
    message: input.message,
    characters_used: usage?.charactersUsed ?? null,
    max_characters: usage?.maxCharacters ?? null,
    requests_in_window: usage?.requestsInWindow ?? null,
    max_requests: usage?.maxRequests ?? null,
    window_seconds: usage?.windowSeconds ?? null,
    resets_at: usage?.resetsAt ?? null,
  };
}

export function syncTtsRetryAfterSeconds(
  resetsAt: string | null,
  nowMs = Date.now(),
): number | null {
  if (!resetsAt) return null;
  const when = Date.parse(resetsAt);
  if (!Number.isFinite(when)) return null;
  return Math.max(1, Math.ceil((when - nowMs) / 1000));
}

/**
 * Reserve speech usage, call the provider, then settle the same row.
 * The provider is not contacted unless the reservation insert succeeds.
 * Audio is returned only after that row is settled. A failed provider call
 * releases the reservation; a failed settlement keeps it.
 */
export async function runMeteredSyncTts(input: {
  rpc: SyncTtsRpc;
  organizationId: string;
  userId: string;
  text: string;
  limits: SyncTtsQuotaLimits;
  synthesize: (text: string) => Promise<OpenAiSpeechResult>;
}): Promise<MeteredSyncTtsResult> {
  const characters = input.text.length;
  if (characters < 1 || characters > SYNC_TTS_MAX_UTTERANCE_CHARS) {
    return refusal({
      error: "utterance_too_long",
      status: 400,
      message: SYNC_TTS_MESSAGES.utteranceTooLong,
      reservationId: null,
      usage: emptyUsage(characters),
    });
  }

  let reserved: { data: unknown; error: unknown };
  try {
    reserved = await input.rpc("reserve_sync_tts_usage", {
      p_organization_id: input.organizationId,
      p_user_id: input.userId,
      p_characters: characters,
      p_max_characters: input.limits.dailyCharactersPerTenant,
      p_max_requests: input.limits.userRequestsPerWindow,
      p_window_seconds: input.limits.userWindowSeconds,
    });
  } catch {
    return unavailable();
  }
  if (reserved.error) return unavailable();

  const verdict = asRecord(reserved.data);
  if (!verdict) return unavailable();
  const usage = snapshotFromVerdict(verdict, characters);
  if (verdict.allowed !== true) {
    return refusalFromVerdict(verdict, usage);
  }
  const reservationId = parseReservationId(verdict.reservation_id);
  if (reservationId === null) return unavailable();

  let speech: OpenAiSpeechResult;
  try {
    speech = await input.synthesize(input.text);
  } catch {
    await releaseReservation(input, reservationId);
    return providerFailed(502, reservationId, usage);
  }
  if (!speech.ok) {
    await releaseReservation(input, reservationId);
    return providerFailed(
      providerFailureStatus(speech.status),
      reservationId,
      usage,
    );
  }

  let settled: { data: unknown; error: unknown };
  try {
    settled = await input.rpc("settle_sync_tts_usage", {
      p_reservation_id: reservationId,
      p_organization_id: input.organizationId,
      p_user_id: input.userId,
      p_model: speech.model,
    });
  } catch {
    return recordFailed(reservationId, usage);
  }
  if (settled.error || !isRecorded(settled.data)) {
    return recordFailed(reservationId, usage);
  }

  return {
    ok: true,
    bytes: speech.bytes,
    contentType: speech.contentType,
    model: speech.model,
    reservationId,
    usage,
  };
}

function tightenPositiveInteger(
  raw: string | undefined,
  ceiling: number,
): number {
  if (raw == null) return ceiling;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return ceiling;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) return ceiling;
  return Math.min(value, ceiling);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseReservationId(value: unknown): number | null {
  const id = readNumber(value);
  if (id == null || !Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

function emptyUsage(characters: number): SyncTtsUsageSnapshot {
  return {
    characters,
    charactersUsed: null,
    maxCharacters: null,
    requestsInWindow: null,
    maxRequests: null,
    windowSeconds: null,
    resetsAt: null,
  };
}

function snapshotFromVerdict(
  verdict: Record<string, unknown>,
  characters: number,
): SyncTtsUsageSnapshot {
  return {
    characters,
    charactersUsed: readNumber(verdict.characters_used),
    maxCharacters: readNumber(verdict.max_characters),
    requestsInWindow: readNumber(verdict.requests_in_window),
    maxRequests: readNumber(verdict.max_requests),
    windowSeconds: readNumber(verdict.window_seconds),
    resetsAt: readString(verdict.resets_at),
  };
}

function unavailable(): MeteredSyncTtsResult {
  return refusal({
    error: "tts_usage_unavailable",
    status: 503,
    message: SYNC_TTS_MESSAGES.usageUnavailable,
    reservationId: null,
    usage: null,
  });
}

function recordFailed(
  reservationId: number,
  usage: SyncTtsUsageSnapshot,
): MeteredSyncTtsResult {
  return refusal({
    error: "tts_usage_record_failed",
    status: 503,
    message: SYNC_TTS_MESSAGES.usageRecordFailed,
    reservationId,
    usage,
  });
}

function providerFailed(
  status: number,
  reservationId: number,
  usage: SyncTtsUsageSnapshot,
): MeteredSyncTtsResult {
  return refusal({
    error: "cloud_tts_failed",
    status,
    message: SYNC_TTS_MESSAGES.cloudFailed,
    reservationId,
    usage,
  });
}

function providerFailureStatus(status: number): number {
  if (status === 401 || status === 403) return 502;
  if (status >= 400 && status < 600) return status;
  return 502;
}

function refusalFromVerdict(
  verdict: Record<string, unknown>,
  usage: SyncTtsUsageSnapshot,
): MeteredSyncTtsResult {
  const limit = readString(verdict.limit) ?? "tts_usage_unavailable";
  if (limit === "org_daily_character_quota_exceeded") {
    return refusal({
      error: limit,
      status: 429,
      message: dailyQuotaMessage(usage.resetsAt),
      reservationId: null,
      usage,
    });
  }
  if (limit === "user_rate_limit_exceeded") {
    return refusal({
      error: limit,
      status: 429,
      message: rateLimitMessage(usage.resetsAt),
      reservationId: null,
      usage,
    });
  }
  if (limit === "organization_required") {
    return refusal({
      error: limit,
      status: 403,
      message: SYNC_TTS_MESSAGES.organizationRequired,
      reservationId: null,
      usage,
    });
  }
  if (limit === "organization_mismatch") {
    return refusal({
      error: limit,
      status: 403,
      message: SYNC_TTS_MESSAGES.organizationMismatch,
      reservationId: null,
      usage,
    });
  }
  if (limit === "utterance_too_long" || limit === "invalid_characters") {
    return refusal({
      error: "utterance_too_long",
      status: 400,
      message: SYNC_TTS_MESSAGES.utteranceTooLong,
      reservationId: null,
      usage,
    });
  }
  return unavailable();
}

function dailyQuotaMessage(resetsAt: string | null): string {
  return `This organization's daily speech character allowance is used up.${
    resetsAt ? ` It resets at ${resetsAt}.` : " It resets at midnight UTC."
  }`;
}

function rateLimitMessage(resetsAt: string | null): string {
  return `Speech requests from this user are temporarily limited.${
    resetsAt ? ` Try again after ${resetsAt}.` : " Try again in a minute."
  }`;
}

function refusal(input: {
  error: string;
  status: number;
  message: string;
  reservationId: number | null;
  usage: SyncTtsUsageSnapshot | null;
}): MeteredSyncTtsResult {
  return { ok: false, ...input };
}

function isRecorded(data: unknown): boolean {
  return asRecord(data)?.recorded === true;
}

async function releaseReservation(
  input: {
    rpc: SyncTtsRpc;
    organizationId: string;
    userId: string;
  },
  reservationId: number,
): Promise<void> {
  try {
    const released = await input.rpc("release_sync_tts_usage", {
      p_reservation_id: reservationId,
      p_organization_id: input.organizationId,
      p_user_id: input.userId,
    });
    if (released.error) {
      console.error(
        JSON.stringify({
          fn: "sync-tts",
          event: "usage_release_failed",
          reservation_id: reservationId,
        }),
      );
    }
  } catch {
    console.error(
      JSON.stringify({
        fn: "sync-tts",
        event: "usage_release_failed",
        reservation_id: reservationId,
      }),
    );
  }
}
