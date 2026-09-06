import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_VOICE,
  FALLBACK_TTS_MODEL,
  OPENAI_SPEECH_URL,
  PREFERRED_TTS_MODEL,
  SYNC_TTS_MAX_CHARS,
  isCloudTtsConfigured,
  resolveTtsVoice,
  shouldRetryWithFallbackModel,
  stripForSpeech,
  synthesizeOpenAiSpeech,
  validateSyncTtsInput,
} from "./sync-tts-core";

describe("sync-tts input validation", () => {
  it("rejects missing or non-string text", () => {
    expect(validateSyncTtsInput(null)).toEqual({
      ok: false,
      error: "invalid_json",
      status: 400,
    });
    expect(validateSyncTtsInput({ text: 12 })).toEqual({
      ok: false,
      error: "text_required",
      status: 400,
    });
    expect(validateSyncTtsInput({ text: "   " })).toEqual({
      ok: false,
      error: "text_required",
      status: 400,
    });
  });

  it("accepts a short utterance and reuses stripForSpeech", () => {
    const result = validateSyncTtsInput({
      text: "  Welcome Orville. I recommend, I do not authorize.  ",
    });
    expect(result).toEqual({
      ok: true,
      text: "Welcome Orville. I recommend, I do not authorize.",
    });
  });

  it("caps long text at the Meet Sync stripForSpeech budget", () => {
    const long = `${"Sentence. ".repeat(80)}Plant is healthy.`;
    const result = validateSyncTtsInput({ text: long });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeLessThanOrEqual(SYNC_TTS_MAX_CHARS + 1);
    expect(result.text).toBe(stripForSpeech(long));
    expect(result.text).not.toMatch(/autonomous control/i);
  });
});

describe("sync-tts voice and configuration", () => {
  it("defaults an unknown voice to onyx and never reads a secret", () => {
    expect(resolveTtsVoice(undefined)).toBe(DEFAULT_TTS_VOICE);
    expect(resolveTtsVoice("ONYX")).toBe("onyx");
    expect(resolveTtsVoice("not-a-voice")).toBe("onyx");
    expect(resolveTtsVoice("sk-proj-secret")).toBe("onyx");
  });

  it("treats a missing OpenAI key as unconfigured — browser fallback, not premium", () => {
    expect(isCloudTtsConfigured(undefined)).toBe(false);
    expect(isCloudTtsConfigured("")).toBe(false);
    expect(isCloudTtsConfigured("  ")).toBe(false);
    expect(isCloudTtsConfigured("sk-test")).toBe(true);
  });
});

describe("OpenAI model fallback", () => {
  it("retries gpt-4o-mini-tts unavailability onto tts-1", () => {
    expect(
      shouldRetryWithFallbackModel(
        404,
        "model_not_found",
        PREFERRED_TTS_MODEL,
        FALLBACK_TTS_MODEL,
      ),
    ).toBe(true);
    expect(
      shouldRetryWithFallbackModel(
        400,
        '{"error":{"message":"The model `gpt-4o-mini-tts` does not exist"}}',
        PREFERRED_TTS_MODEL,
        FALLBACK_TTS_MODEL,
      ),
    ).toBe(true);
    expect(
      shouldRetryWithFallbackModel(
        401,
        "invalid_api_key",
        PREFERRED_TTS_MODEL,
        FALLBACK_TTS_MODEL,
      ),
    ).toBe(false);
    expect(
      shouldRetryWithFallbackModel(404, "missing", "tts-1", "tts-1"),
    ).toBe(false);
  });

  it("synthesizes mp3 via the preferred model when it succeeds", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
      headers: new Headers({ "Content-Type": "audio/mpeg" }),
    });
    const result = await synthesizeOpenAiSpeech({
      apiKey: "sk-test",
      text: "Welcome.",
      voice: "onyx",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({
      ok: true,
      contentType: "audio/mpeg",
      model: PREFERRED_TTS_MODEL,
    });
    if (!result.ok) return;
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENAI_SPEECH_URL);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: PREFERRED_TTS_MODEL,
      voice: "onyx",
      input: "Welcome.",
      response_format: "mp3",
    });
  });

  it("falls back to tts-1 when the preferred model is unavailable", async () => {
    const bytes = new Uint8Array([9, 8]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "The model does not exist",
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => bytes.buffer,
        headers: new Headers({ "Content-Type": "audio/mpeg" }),
      });
    const result = await synthesizeOpenAiSpeech({
      apiKey: "sk-test",
      text: "Welcome.",
      voice: "onyx",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: true, model: FALLBACK_TTS_MODEL });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body),
    );
    expect(secondBody.model).toBe(FALLBACK_TTS_MODEL);
  });

  it("does not leak the API key in a failed result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "incorrect api key provided: sk-test",
    });
    const result = await synthesizeOpenAiSpeech({
      apiKey: "sk-test",
      text: "Welcome.",
      voice: "onyx",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(JSON.stringify(result)).not.toContain("Authorization");
  });
});
