import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}));

vi.mock("../supabase-config", () => ({
  supabaseUrl: "https://example.supabase.co",
  supabasePublicKey: "public-anon-key",
}));

import {
  SYNC_TTS_FUNCTION,
  SyncTtsError,
  probeSyncTtsConfigured,
  requestSyncTtsAudio,
} from "./syncTtsClient";

beforeEach(() => {
  getSession.mockReset();
  vi.unstubAllGlobals();
});

describe("sync-tts client", () => {
  it("POSTs stripped text with the signed-in JWT and returns mp3", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-user" } },
      error: null,
    });
    const blob = new Blob([new Uint8Array([1, 2])], { type: "audio/mpeg" });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "Content-Type": "audio/mpeg" }),
      blob: async () => blob,
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await requestSyncTtsAudio("  Hello from Meet Sync.  ");
    expect(result).toBe(blob);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://example.supabase.co/functions/v1/${SYNC_TTS_FUNCTION}`,
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jwt-user",
      apikey: "public-anon-key",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Hello from Meet Sync.",
    });
  });

  it("fails closed without a session so the adapter can fall back", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(requestSyncTtsAudio("Welcome.")).rejects.toBeInstanceOf(
      SyncTtsError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a missing-key 503 to cloud_tts_unconfigured", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-user" } },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ "Content-Type": "application/json" }),
      }),
    );
    await expect(requestSyncTtsAudio("Welcome.")).rejects.toMatchObject({
      code: "cloud_tts_unconfigured",
      status: 503,
    });
  });

  it("probes configuration without claiming a secret value", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-user" } },
      error: null,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, engine: "openai" }),
    });
    vi.stubGlobal("fetch", fetchImpl);
    await expect(probeSyncTtsConfigured()).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/functions/v1/sync-tts");
    expect(init.method).toBe("GET");
    expect(JSON.stringify(init)).not.toMatch(/sk-|OPENAI_API_KEY/);
  });

  it("treats a failed probe as unconfigured", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(probeSyncTtsConfigured()).resolves.toBe(false);
  });
});
