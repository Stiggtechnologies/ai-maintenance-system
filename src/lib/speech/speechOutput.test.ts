import { describe, expect, it, vi } from "vitest";
import {
  createSpeechOutputController,
  playAudioBlob,
  splitSpeakableLead,
} from "./speechOutput";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("splitSpeakableLead", () => {
  it("isolates the first sentence so TTS can start before the rest is ready", () => {
    expect(
      splitSpeakableLead(
        "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
      ),
    ).toEqual({
      first: "No sourced backlog figure is in this snapshot.",
      rest: "I recommend, I do not authorize.",
    });
    expect(splitSpeakableLead("Yes. I can hear you.")).toEqual({
      first: "Yes.",
      rest: "I can hear you.",
    });
    expect(splitSpeakableLead("I'm here and listening.")).toEqual({
      first: "I'm here and listening.",
      rest: "",
    });
  });
});

describe("speech output adapter", () => {
  it("plays cloud audio when sync-tts succeeds", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const finished = deferred<void>();
    const requestCloud = vi.fn().mockResolvedValue(blob);
    const playCloud = vi.fn().mockImplementation(async () => {
      finished.resolve();
    });
    const speakBrowser = vi.fn();
    const stopBrowser = vi.fn();
    const onSpeakingChange = vi.fn();
    const onEngineChange = vi.fn();

    const controller = createSpeechOutputController({
      requestCloud,
      playCloud,
      speakBrowser,
      stopBrowser,
      onSpeakingChange,
      onEngineChange,
    });

    controller.speak("  Welcome Orville.  ");
    expect(stopBrowser).toHaveBeenCalled();
    expect(onSpeakingChange).toHaveBeenCalledWith(true);
    await finished.promise;
    await Promise.resolve();
    expect(requestCloud).toHaveBeenCalledWith(
      "Welcome Orville.",
      expect.any(AbortSignal),
    );
    expect(playCloud).toHaveBeenCalledWith(blob, expect.any(AbortSignal));
    expect(speakBrowser).not.toHaveBeenCalled();
    expect(onEngineChange).toHaveBeenCalledWith("cloud");
    expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
  });

  it("requests first-sentence audio before the remainder and keeps speaking true between them", async () => {
    const firstBlob = new Blob([new Uint8Array([1])], { type: "audio/mpeg" });
    const restBlob = new Blob([new Uint8Array([2, 3])], { type: "audio/mpeg" });
    const firstReady = deferred<Blob>();
    const restReady = deferred<Blob>();
    const firstPlay = deferred<void>();
    const restPlay = deferred<void>();
    const requestCloud = vi
      .fn()
      .mockImplementationOnce(() => firstReady.promise)
      .mockImplementationOnce(() => restReady.promise);
    const playCloud = vi
      .fn()
      .mockImplementationOnce(async () => firstPlay.promise)
      .mockImplementationOnce(async () => restPlay.promise);
    const onSpeakingChange = vi.fn();

    const controller = createSpeechOutputController({
      requestCloud,
      playCloud,
      speakBrowser: vi.fn(),
      stopBrowser: vi.fn(),
      onSpeakingChange,
    });

    controller.speak(
      "No sourced backlog figure is in this snapshot. I recommend, I do not authorize.",
    );
    expect(onSpeakingChange).toHaveBeenCalledWith(true);
    await Promise.resolve();
    expect(requestCloud).toHaveBeenCalledWith(
      "No sourced backlog figure is in this snapshot.",
      expect.any(AbortSignal),
    );
    expect(requestCloud).toHaveBeenCalledTimes(1);

    firstReady.resolve(firstBlob);
    await vi.waitFor(() => {
      expect(playCloud).toHaveBeenCalledWith(firstBlob, expect.any(AbortSignal));
    });
    expect(requestCloud).toHaveBeenCalledWith(
      "I recommend, I do not authorize.",
      expect.any(AbortSignal),
    );
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true);

    restReady.resolve(restBlob);
    firstPlay.resolve();
    await vi.waitFor(() => {
      expect(playCloud).toHaveBeenCalledWith(restBlob, expect.any(AbortSignal));
    });
    restPlay.resolve();
    await vi.waitFor(() => {
      expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("falls back to speechSynthesis when cloud TTS fails or is unconfigured", async () => {
    const speakBrowser = vi.fn();
    const controller = createSpeechOutputController({
      requestCloud: vi.fn().mockRejectedValue(new Error("cloud_tts_unconfigured")),
      playCloud: vi.fn(),
      speakBrowser,
      stopBrowser: vi.fn(),
      onEngineChange: vi.fn(),
    });

    controller.speak("Welcome.");
    await vi.waitFor(() => {
      expect(speakBrowser).toHaveBeenCalledWith("Welcome.");
    });
  });

  it("does not start browser speech after stop() barges in during fetch", async () => {
    const hold = deferred<Blob>();
    const speakBrowser = vi.fn();
    const playCloud = vi.fn();
    const controller = createSpeechOutputController({
      requestCloud: vi.fn().mockImplementation((_text, signal: AbortSignal) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          void hold.promise.then(resolve, reject);
        });
      }),
      playCloud,
      speakBrowser,
      stopBrowser: vi.fn(),
    });

    controller.speak("First utterance.");
    controller.stop();
    hold.resolve(new Blob(["x"], { type: "audio/mpeg" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(playCloud).not.toHaveBeenCalled();
    expect(speakBrowser).not.toHaveBeenCalled();
  });

  it("barge-in speak() cancels the previous cloud request", async () => {
    const first = deferred<Blob>();
    const requestCloud = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(
        new Blob([new Uint8Array([9])], { type: "audio/mpeg" }),
      );
    const playCloud = vi.fn().mockResolvedValue(undefined);
    const speakBrowser = vi.fn();

    const controller = createSpeechOutputController({
      requestCloud,
      playCloud,
      speakBrowser,
      stopBrowser: vi.fn(),
    });

    controller.speak("First.");
    controller.speak("Second.");
    first.resolve(new Blob(["stale"], { type: "audio/mpeg" }));
    await vi.waitFor(() => {
      expect(playCloud).toHaveBeenCalledTimes(1);
    });
    expect(playCloud.mock.calls[0]?.[0].size).toBe(1);
    expect(speakBrowser).not.toHaveBeenCalled();
  });
});

describe("playAudioBlob", () => {
  it("revokes the object URL and stops when aborted", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const load = vi.fn();
    const removeAttribute = vi.fn();
    function FakeAudio(this: Record<string, unknown>) {
      this.play = play;
      this.pause = pause;
      this.load = load;
      this.removeAttribute = removeAttribute;
      this.onended = null;
      this.onerror = null;
    }
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:sync-tts-test");
    const abort = new AbortController();
    const pending = playAudioBlob(
      new Blob(["abc"], { type: "audio/mpeg" }),
      abort.signal,
      FakeAudio as unknown as typeof Audio,
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:sync-tts-test");
    create.mockRestore();
    revoke.mockRestore();
  });
});
