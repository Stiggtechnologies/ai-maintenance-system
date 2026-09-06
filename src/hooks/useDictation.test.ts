import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDictation } from "./useDictation";

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(function (this: FakeRecognition) {
    this.onend?.();
  });

  emitFinal(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: text }, isFinal: true, length: 1 }],
    });
  }

  emitInterim(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: text }, isFinal: false, length: 1 }],
    });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

let lastRecognition: FakeRecognition | null = null;

describe("useDictation", () => {
  beforeEach(() => {
    lastRecognition = null;
    vi.stubGlobal(
      "SpeechRecognition",
      class {
        constructor() {
          lastRecognition = new FakeRecognition();
          return lastRecognition;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays compatible as a press-to-talk helper", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation(onTranscript));
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(lastRecognition?.continuous).toBe(true);
    expect(lastRecognition?.interimResults).toBe(false);
    act(() => lastRecognition?.emitFinal("backlog trend"));
    expect(onTranscript).toHaveBeenCalledWith("backlog trend");
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it("restarts on end when continuous listen is requested", () => {
    const { result } = renderHook(() =>
      useDictation(vi.fn(), { restartOnEnd: true, interimResults: true }),
    );
    act(() => result.current.start());
    const first = lastRecognition;
    expect(first?.interimResults).toBe(true);
    act(() => first?.onend?.());
    expect(lastRecognition).not.toBe(first);
    expect(lastRecognition?.start).toHaveBeenCalled();
    expect(result.current.listening).toBe(true);
  });

  it("does not restart after an intentional stop", () => {
    const { result } = renderHook(() =>
      useDictation(vi.fn(), { restartOnEnd: true }),
    );
    act(() => result.current.start());
    const first = lastRecognition;
    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
    expect(lastRecognition).toBe(first);
  });

  it("surfaces a blocked microphone as denied and does not keep listening", () => {
    const { result } = renderHook(() => useDictation(vi.fn()));
    act(() => result.current.start());
    act(() => lastRecognition?.emitError("not-allowed"));
    expect(result.current.permission).toBe("denied");
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toMatch(/microphone access was blocked/i);
  });

  it("notifies onSpeech for barge-in and onInterim for live text", () => {
    const onSpeech = vi.fn();
    const onInterim = vi.fn();
    const { result } = renderHook(() =>
      useDictation(vi.fn(), { interimResults: true, onSpeech, onInterim }),
    );
    act(() => result.current.start());
    act(() => lastRecognition?.emitInterim("how is"));
    expect(onSpeech).toHaveBeenCalled();
    expect(onInterim).toHaveBeenCalledWith("how is");
  });
});
