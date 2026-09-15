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
  SYNC_REALTIME_FUNCTION,
  SyncRealtimeError,
  collectUnhandledFunctionCalls,
  normalizeSyncNavigationPath,
  requestSyncRealtimeSession,
} from "./syncRealtimeClient";

beforeEach(() => {
  getSession.mockReset();
  vi.unstubAllGlobals();
});

describe("Sync Realtime client", () => {
  it("negotiates WebRTC through the signed-in edge function without exposing the OpenAI key", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-user" } },
      error: null,
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        session: { id: "sess_123" },
        model: "gpt-realtime-2.1",
        transport: { type: "webrtc", sdp: "answer-sdp" },
      }),
    });
    vi.stubGlobal("fetch", fetchImpl);

    const result = await requestSyncRealtimeSession("offer-sdp", {
      route: "/assets/twins",
      pageTitle: "SyncAI",
      mode: "conversation",
    });

    expect(result.transport.sdp).toBe("answer-sdp");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://example.supabase.co/functions/v1/${SYNC_REALTIME_FUNCTION}`,
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer jwt-user",
      apikey: "public-anon-key",
    });
    expect(JSON.stringify(init)).not.toMatch(/sk-|OPENAI_API_KEY/);
  });

  it("fails closed when no signed-in session exists", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(
      requestSyncRealtimeSession("offer", { route: "/work" }),
    ).rejects.toBeInstanceOf(SyncRealtimeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("permits only same-app navigation paths", () => {
    expect(normalizeSyncNavigationPath(" /work ")).toBe("/work");
    expect(normalizeSyncNavigationPath("/assets/asset-123")).toBe(
      "/assets/asset-123",
    );
    expect(normalizeSyncNavigationPath("https://example.com")).toBeNull();
    expect(normalizeSyncNavigationPath("//example.com/work")).toBeNull();
    expect(normalizeSyncNavigationPath("/work?approve=true")).toBeNull();
    expect(normalizeSyncNavigationPath("../approvals")).toBeNull();
  });

  it("executes each provider tool call at most once", () => {
    const handled = new Set<string>(["call-old"]);
    const event = {
      type: "response.done",
      response: {
        output: [
          {
            type: "function_call",
            call_id: "call-old",
            name: "ask_sync",
            arguments: '{"question":"old"}',
          },
          {
            type: "function_call",
            call_id: "call-new",
            name: "ask_sync",
            arguments: '{"question":"new"}',
          },
        ],
      },
    };

    expect(collectUnhandledFunctionCalls(event, handled)).toEqual([
      expect.objectContaining({ call_id: "call-new", name: "ask_sync" }),
    ]);
    expect(handled.has("call-new")).toBe(true);
  });
});
