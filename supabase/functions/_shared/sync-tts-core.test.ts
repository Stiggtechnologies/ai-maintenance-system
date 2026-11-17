import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_VOICE,
  FALLBACK_TTS_MODEL,
  OPENAI_SPEECH_URL,
  PREFERRED_TTS_MODEL,
  SYNC_TTS_MAX_CHARS,
  SYNC_TTS_MAX_UTTERANCE_CHARS,
  SYNC_TTS_MESSAGES,
  SYNC_TTS_QUOTA_CONFIG,
  isCloudTtsConfigured,
  resolveSyncTtsQuotaLimits,
  resolveTtsVoice,
  runMeteredSyncTts,
  shouldRetryWithFallbackModel,
  stripForSpeech,
  syncTtsRefusalBody,
  syncTtsRetryAfterSeconds,
  syncTtsUsageHeaders,
  synthesizeOpenAiSpeech,
  validateSyncTtsInput,
  type SyncTtsRpc,
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
  it("defaults an unknown voice to marin and never reads a secret", () => {
    expect(resolveTtsVoice(undefined)).toBe(DEFAULT_TTS_VOICE);
    expect(resolveTtsVoice("ONYX")).toBe("onyx");
    expect(resolveTtsVoice("MARIN")).toBe("marin");
    expect(resolveTtsVoice("not-a-voice")).toBe("marin");
    expect(resolveTtsVoice("sk-proj-secret")).toBe("marin");
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
    expect(shouldRetryWithFallbackModel(404, "missing", "tts-1", "tts-1")).toBe(
      false,
    );
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
      instructions: expect.stringMatching(/warm|engag|natural/i),
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
    expect(secondBody).not.toHaveProperty("instructions");
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

describe("sync-tts quota config", () => {
  it("sizes the daily ceiling from the utterance cap and the two-request turn split", () => {
    expect(SYNC_TTS_MAX_UTTERANCE_CHARS).toBe(SYNC_TTS_MAX_CHARS + 1);
    expect(SYNC_TTS_QUOTA_CONFIG.dailyCharactersPerTenant).toBe(
      20 * 2 * SYNC_TTS_MAX_UTTERANCE_CHARS,
    );
    expect(SYNC_TTS_QUOTA_CONFIG.userRequestsPerWindow).toBe(10);
    expect(SYNC_TTS_QUOTA_CONFIG.userWindowSeconds).toBe(60);
  });

  it("lets an override only tighten the caps", () => {
    expect(
      resolveSyncTtsQuotaLimits({
        SYNC_TTS_DAILY_CHAR_QUOTA: "100",
        SYNC_TTS_USER_RATE_LIMIT: "2",
        SYNC_TTS_USER_RATE_WINDOW_SECONDS: "1",
      }),
    ).toEqual({
      dailyCharactersPerTenant: 100,
      userRequestsPerWindow: 2,
      userWindowSeconds: 60,
    });
    expect(
      resolveSyncTtsQuotaLimits({
        SYNC_TTS_DAILY_CHAR_QUOTA: "999999",
        SYNC_TTS_USER_RATE_LIMIT: "0",
        SYNC_TTS_USER_RATE_WINDOW_SECONDS: "3600",
      }),
    ).toEqual({
      dailyCharactersPerTenant: SYNC_TTS_QUOTA_CONFIG.dailyCharactersPerTenant,
      userRequestsPerWindow: SYNC_TTS_QUOTA_CONFIG.userRequestsPerWindow,
      userWindowSeconds: 60,
    });
    expect(
      resolveSyncTtsQuotaLimits({
        SYNC_TTS_DAILY_CHAR_QUOTA: "nope",
        SYNC_TTS_USER_RATE_LIMIT: "-4",
      }).dailyCharactersPerTenant,
    ).toBe(SYNC_TTS_QUOTA_CONFIG.dailyCharactersPerTenant);
  });
});

describe("metered sync-tts", () => {
  const limits = resolveSyncTtsQuotaLimits();
  const reserved = {
    allowed: true,
    reservation_id: 7,
    characters_used: 12,
    max_characters: limits.dailyCharactersPerTenant,
    requests_in_window: 1,
    max_requests: limits.userRequestsPerWindow,
    window_seconds: 60,
    resets_at: "2026-10-16T00:00:00.000Z",
  };

  function rpcFor(
    reserve: { data: unknown; error: unknown } | (() => never),
    later: Record<string, { data: unknown; error: unknown }> = {},
  ): SyncTtsRpc {
    return vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "reserve_sync_tts_usage") {
        if (typeof reserve === "function") return reserve();
        expect(args.p_characters).toBe("Hello there.".length);
        expect(args.p_max_characters).toBe(limits.dailyCharactersPerTenant);
        expect(args.p_max_requests).toBe(limits.userRequestsPerWindow);
        expect(args.p_window_seconds).toBe(60);
        return reserve;
      }
      const step = later[name];
      if (!step) throw new Error(`unexpected rpc ${name}`);
      return step;
    }) as SyncTtsRpc;
  }

  it("reserves, speaks, and settles before returning audio", async () => {
    const calls: string[] = [];
    const rpc: SyncTtsRpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "reserve_sync_tts_usage") {
        return { data: reserved, error: null };
      }
      if (name === "settle_sync_tts_usage") {
        return { data: { recorded: true }, error: null };
      }
      throw new Error(`unexpected ${name}`);
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const synthesize = vi.fn().mockResolvedValue({
      ok: true,
      bytes,
      contentType: "audio/mpeg",
      model: PREFERRED_TTS_MODEL,
    });
    const result = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    expect(calls).toEqual(["reserve_sync_tts_usage", "settle_sync_tts_usage"]);
    expect(synthesize).toHaveBeenCalledWith("Hello there.");
    expect(result).toMatchObject({
      ok: true,
      model: PREFERRED_TTS_MODEL,
      reservationId: 7,
    });
    if (!result.ok) return;
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(syncTtsUsageHeaders(result.usage)).toMatchObject({
      "X-Sync-Tts-Characters": "12",
      "X-Sync-Tts-Characters-Used": "12",
      "X-Sync-Tts-Daily-Character-Limit": String(
        limits.dailyCharactersPerTenant,
      ),
    });
    const settleArgs = (rpc as ReturnType<typeof vi.fn>).mock.calls[1]?.[1];
    expect(settleArgs).toMatchObject({
      p_reservation_id: 7,
      p_model: PREFERRED_TTS_MODEL,
    });
  });

  it("does not call the provider when the daily character quota is exceeded", async () => {
    const synthesize = vi.fn();
    const rpc = rpcFor({
      data: {
        allowed: false,
        limit: "org_daily_character_quota_exceeded",
        characters_used: 16840,
        max_characters: 16840,
        resets_at: "2026-10-16T00:00:00.000Z",
      },
      error: null,
    });
    const result = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    expect(synthesize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: "org_daily_character_quota_exceeded",
      status: 429,
    });
    if (result.ok) return;
    expect(result.message).toMatch(/daily speech character allowance/i);
    expect(result.message).toContain("2026-10-16T00:00:00.000Z");
    expect(syncTtsRefusalBody(result).characters_used).toBe(16840);
  });

  it("does not call the provider when the user rate limit is exceeded", async () => {
    const synthesize = vi.fn();
    const result = await runMeteredSyncTts({
      rpc: rpcFor({
        data: {
          allowed: false,
          limit: "user_rate_limit_exceeded",
          requests_in_window: 10,
          max_requests: 10,
          window_seconds: 60,
          resets_at: "2026-10-15T12:01:00.000Z",
        },
        error: null,
      }),
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    expect(synthesize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: "user_rate_limit_exceeded",
      status: 429,
    });
    if (result.ok) return;
    expect(result.message).toMatch(/temporarily limited/i);
  });

  it("fails closed when usage cannot be reserved", async () => {
    const synthesize = vi.fn();
    const rpc = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const thrown = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    const erred = await runMeteredSyncTts({
      rpc: rpcFor({ data: null, error: { message: "permission denied" } }),
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    const unreserved = await runMeteredSyncTts({
      rpc: rpcFor({ data: { allowed: true }, error: null }),
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize,
    });
    for (const result of [thrown, erred, unreserved]) {
      expect(result).toMatchObject({
        ok: false,
        error: "tts_usage_unavailable",
        status: 503,
        message: SYNC_TTS_MESSAGES.usageUnavailable,
      });
    }
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider fails and does not return audio", async () => {
    const calls: string[] = [];
    const rpc: SyncTtsRpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "reserve_sync_tts_usage")
        return { data: reserved, error: null };
      if (name === "release_sync_tts_usage") {
        return { data: { released: true }, error: null };
      }
      throw new Error(`unexpected ${name}`);
    });
    const result = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        error: "invalid_api_key",
      }),
    });
    expect(calls).toEqual(["reserve_sync_tts_usage", "release_sync_tts_usage"]);
    expect(result).toMatchObject({
      ok: false,
      error: "cloud_tts_failed",
      status: 502,
    });
  });

  it("withholds audio and keeps the reservation when settlement fails", async () => {
    const calls: string[] = [];
    const rpc: SyncTtsRpc = vi.fn(async (name: string) => {
      calls.push(name);
      if (name === "reserve_sync_tts_usage")
        return { data: reserved, error: null };
      if (name === "settle_sync_tts_usage") {
        return { data: { recorded: false }, error: null };
      }
      throw new Error(`unexpected ${name}`);
    });
    const result = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "Hello there.",
      limits,
      synthesize: vi.fn().mockResolvedValue({
        ok: true,
        bytes: new Uint8Array([9]),
        contentType: "audio/mpeg",
        model: FALLBACK_TTS_MODEL,
      }),
    });
    expect(calls).toEqual(["reserve_sync_tts_usage", "settle_sync_tts_usage"]);
    expect(result).toMatchObject({
      ok: false,
      error: "tts_usage_record_failed",
      status: 503,
      message: SYNC_TTS_MESSAGES.usageRecordFailed,
      reservationId: 7,
    });
  });

  it("refuses an utterance above the character ceiling without reserving", async () => {
    const rpc = vi.fn();
    const result = await runMeteredSyncTts({
      rpc,
      organizationId: "org-1",
      userId: "user-1",
      text: "x".repeat(SYNC_TTS_MAX_UTTERANCE_CHARS + 1),
      limits,
      synthesize: vi.fn(),
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: "utterance_too_long",
      status: 400,
    });
  });

  it("turns a reset timestamp into a Retry-After delay", () => {
    expect(
      syncTtsRetryAfterSeconds(
        "2026-10-16T00:00:00.000Z",
        Date.parse("2026-10-15T23:59:30.000Z"),
      ),
    ).toBe(30);
    expect(syncTtsRetryAfterSeconds("not-a-date")).toBeNull();
  });
});
