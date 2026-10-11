import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncRealtimeVoice } from "./useSyncRealtimeVoice";

const request = vi.hoisted(() => vi.fn());
vi.mock("../lib/speech/syncRealtimeClient", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../lib/speech/syncRealtimeClient")
  >()),
  requestSyncRealtimeSession: request,
}));
class Channel extends EventTarget {
  readyState = "open";
  send = vi.fn();
  close = vi.fn();
  event(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}
class Connection extends EventTarget {
  static instances: Connection[] = [];
  channel = new Channel();
  iceGatheringState = "complete";
  localDescription = { sdp: "offer" };
  close = vi.fn();
  addTrack = vi.fn();
  addTransceiver = vi.fn();
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription() {}
  setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  constructor() {
    super();
    Connection.instances.push(this);
  }
}
const microphoneStop = vi.fn();
const microphone = {
  getAudioTracks: () => [{ enabled: true }],
  getTracks: () => [{ stop: microphoneStop }],
};
const getUserMedia = vi.fn();
const opts = {
  context: { route: "/assets" },
  onAskSync: vi.fn().mockResolvedValue({ ok: true, answer: "Scoped answer" }),
  onNavigate: vi.fn(),
};
beforeEach(() => {
  Connection.instances = [];
  request.mockReset().mockResolvedValue({
    session: { id: "test" },
    model: "canonical",
    transport: { sdp: "answer" },
  });
  getUserMedia.mockReset().mockResolvedValue(microphone);
  microphoneStop.mockReset();
  vi.stubGlobal("RTCPeerConnection", Connection);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared welcome/chat/meeting voice lifecycle", () => {
  it("plays a receive-only personalized welcome without requesting mic, once, and releases the session after audio playout", async () => {
    const { result } = renderHook(() => useSyncRealtimeVoice(opts));
    await act(() => result.current.start("Welcome Orville. I'm Sync."));
    const connection = Connection.instances[0];
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(connection.addTransceiver).toHaveBeenCalledWith("audio", {
      direction: "recvonly",
    });
    act(() => connection.channel.dispatchEvent(new Event("open")));
    expect(connection.channel.send).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(connection.channel.send.mock.calls[1][0]).response.tool_choice,
    ).toBe("none");
    expect(connection.channel.send.mock.calls[0][0]).toContain("Orville");
    await act(() => result.current.start("duplicate"));
    expect(request).toHaveBeenCalledTimes(1);
    act(() => connection.channel.event({ type: "response.done" }));
    expect(connection.close).not.toHaveBeenCalled();
    act(() =>
      connection.channel.event({ type: "output_audio_buffer.stopped" }),
    );
    expect(connection.close).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("idle");
  });
  it("interrupts welcome and starts chat/meeting through the same provider and current scoped context", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ mode }) =>
        useSyncRealtimeVoice({ ...opts, context: { route: "/assets", mode } }),
      { initialProps: { mode: "conversation" as "conversation" | "meeting" } },
    );
    await act(() => result.current.start("Welcome."));
    act(() => result.current.stopWelcome());
    rerender({ mode: "meeting" });
    await act(() => result.current.start());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(request.mock.calls[1][1]).toEqual({
      route: "/assets",
      mode: "meeting",
    });
    unmount();
    expect(microphoneStop).toHaveBeenCalledOnce();
    expect(
      Connection.instances.every(
        (connection) => connection.close.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
  it("handles denied microphone permission without negotiating a provider session", async () => {
    getUserMedia.mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    const { result } = renderHook(() => useSyncRealtimeVoice(opts));
    await act(() => result.current.start());
    expect(result.current.state).toBe("error");
    expect(request).not.toHaveBeenCalled();
    expect(Connection.instances[0].close).toHaveBeenCalledOnce();
  });
  it("stops a microphone granted after logout/unmount and never starts a stale session", async () => {
    let grant!: (value: typeof microphone) => void;
    getUserMedia.mockReturnValue(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useSyncRealtimeVoice(opts));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.start();
    });
    unmount();
    await act(async () => {
      grant(microphone);
      await pending;
    });
    expect(microphoneStop).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });
  it("discards negotiation returned after session cleanup", async () => {
    let respond!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    const { result } = renderHook(() => useSyncRealtimeVoice(opts));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.start("Welcome.");
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => result.current.stop());
    await act(async () => {
      respond({ model: "old", transport: { sdp: "answer" } });
      await pending;
    });
    expect(Connection.instances[0].setRemoteDescription).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });
  it("releases microphone immediately on End", async () => {
    const { result } = renderHook(() => useSyncRealtimeVoice(opts));
    await act(() => result.current.start());
    act(() => result.current.end());
    expect(microphoneStop).toHaveBeenCalledOnce();
    expect(Connection.instances[0].close).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("idle");
  });
  it("updates meeting and route context within a live session without a second assistant", async () => {
    const { result, rerender } = renderHook(
      ({ route, mode }) =>
        useSyncRealtimeVoice({ ...opts, context: { route, mode } }),
      {
        initialProps: {
          route: "/assets",
          mode: "conversation" as "conversation" | "meeting",
        },
      },
    );
    await act(() => result.current.start());
    const channel = Connection.instances[0].channel;
    act(() => channel.event({ type: "session.created" }));
    rerender({ route: "/work", mode: "meeting" });
    expect(request).toHaveBeenCalledOnce();
    expect(
      channel.send.mock.calls.some(
        ([value]) => value.includes("/work") && value.includes("meeting"),
      ),
    ).toBe(true);
  });
  it("does not inject a stale governed answer into a replacement voice session", async () => {
    let answer!: (value: unknown) => void;
    const ask = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useSyncRealtimeVoice({ ...opts, onAskSync: ask }),
    );
    await act(() => result.current.start());
    act(() =>
      Connection.instances[0].channel.event({
        type: "response.done",
        response: {
          output: [
            {
              type: "function_call",
              call_id: "old-call",
              name: "ask_sync",
              arguments: '{"question":"old scoped question"}',
            },
          ],
        },
      }),
    );
    expect(ask).toHaveBeenCalledOnce();
    act(() => result.current.stop());
    await act(() => result.current.start());
    await act(async () => {
      answer({ ok: true, answer: "old scoped answer" });
      await Promise.resolve();
    });
    expect(Connection.instances[1].channel.send).not.toHaveBeenCalled();
  });
  it("releases receive-only resources when browser autoplay is denied and offers replay", async () => {
    const { result } = renderHook(() => useSyncRealtimeVoice(opts));
    result.current.audioRef.current = {
      play: vi
        .fn()
        .mockRejectedValue(
          new DOMException("Autoplay denied", "NotAllowedError"),
        ),
      srcObject: null,
    } as unknown as HTMLAudioElement;
    await act(() => result.current.start("Welcome."));
    const trackEvent = new Event("track");
    Object.assign(trackEvent, { streams: [{}], track: {} });
    await act(async () => {
      Connection.instances[0].dispatchEvent(trackEvent);
      await Promise.resolve();
    });
    expect(Connection.instances[0].close).toHaveBeenCalledOnce();
    expect(result.current.status).toContain("Select Play");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
