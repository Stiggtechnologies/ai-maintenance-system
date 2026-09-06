import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.fn();
const requestAudio = vi.fn();

vi.mock("../lib/speech/syncTtsClient", () => ({
  probeSyncTtsConfigured: (...args: unknown[]) => probe(...args),
  requestSyncTtsAudio: (...args: unknown[]) => requestAudio(...args),
}));

import { useSpeechOutput } from "./useSpeechOutput";

function installSpeechSynthesis() {
  const speak = vi.fn();
  const cancel = vi.fn();
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { speak, cancel, pending: false, speaking: false, paused: false },
  });
  return { speak, cancel };
}

beforeEach(() => {
  probe.mockReset();
  requestAudio.mockReset();
  probe.mockResolvedValue(false);
  requestAudio.mockRejectedValue(new Error("cloud_tts_unconfigured"));
  installSpeechSynthesis();
});

describe("useSpeechOutput", () => {
  it("falls back to speechSynthesis when sync-tts is unconfigured", async () => {
    const speakSpy = vi.spyOn(window.speechSynthesis, "speak");
    const { result } = renderHook(() => useSpeechOutput());

    await waitFor(() => {
      expect(result.current.engine).toBe("browser");
    });

    act(() => {
      result.current.speak("Welcome Orville.");
    });

    await waitFor(() => {
      expect(speakSpy).toHaveBeenCalled();
    });
    const utterance = speakSpy.mock.calls[0]?.[0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("Welcome Orville.");
    speakSpy.mockRestore();
  });

  it("stop() cancels browser speech so dictation can barge in", async () => {
    const cancel = vi.spyOn(window.speechSynthesis, "cancel");
    const { result } = renderHook(() => useSpeechOutput());
    act(() => {
      result.current.speak("Welcome.");
    });
    act(() => {
      result.current.stop();
    });
    expect(cancel).toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
    cancel.mockRestore();
  });
});
