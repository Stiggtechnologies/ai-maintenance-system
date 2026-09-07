/**
 * Meet Sync / Sync speech-output contract.
 *
 * Server-side TTS is a short-utterance adapter for signed-in presence (and
 * any other caller of useSpeechOutput). It is not a plant-execute path, not
 * an orchestrator, and not a license to invent OEM limits.
 *
 * Primary provider: OpenAI Speech (`OPENAI_API_KEY`, already an edge secret).
 * Prefer `gpt-4o-mini-tts`, fall back to `tts-1`. Optional `SYNC_TTS_VOICE`
 * (default `onyx`). ElevenLabs (`ELEVENLABS_API_KEY`) is a later overlay and
 * must not block this path.
 *
 * Deno-free so vitest can pin validation without the edge runtime.
 */

export const SYNC_TTS_MAX_CHARS = 420;
export const PREFERRED_TTS_MODEL = "gpt-4o-mini-tts";
export const FALLBACK_TTS_MODEL = "tts-1";
export const DEFAULT_TTS_VOICE = "onyx";
export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

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
] as const;

export type AllowedTtsVoice = (typeof ALLOWED_TTS_VOICES)[number];

export type SyncTtsValidation =
  | { ok: true; text: string }
  | { ok: false; error: string; status: number };

export type OpenAiSpeechResult =
  | { ok: true; bytes: Uint8Array; contentType: string; model: string }
  | { ok: false; error: string; status: number };

/**
 * Same cap already used by Meet Sync booth replies. Shared so the edge
 * function cannot speak a longer payload than the client already strips.
 */
export function stripForSpeech(text: string, maxChars = SYNC_TTS_MAX_CHARS): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
}

export function resolveTtsVoice(raw: string | undefined | null): AllowedTtsVoice {
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

export function isCloudTtsConfigured(apiKey: string | undefined | null): boolean {
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
  model: string;
}): Promise<OpenAiSpeechResult> {
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
