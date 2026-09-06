/**
 * Speech-output controller: cloud TTS first, browser speechSynthesis fallback.
 *
 * stop() is synchronous from the UI's perspective so dictation / mute can
 * barge in and silence both an in-flight sync-tts request and any playing
 * Audio element or utterance.
 */
import { stripForSpeech } from "../../../supabase/functions/_shared/sync-tts-core";

export type SpeechEngine = "unknown" | "cloud" | "browser";

export interface SpeechOutputController {
  speak: (text: string) => void;
  stop: () => void;
}

export interface SpeechOutputDependencies {
  requestCloud: (text: string, signal: AbortSignal) => Promise<Blob>;
  playCloud: (
    blob: Blob,
    signal: AbortSignal,
  ) => Promise<void>;
  speakBrowser: (text: string) => void;
  stopBrowser: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onEngineChange?: (engine: Exclude<SpeechEngine, "unknown">) => void;
}

export function createSpeechOutputController(
  deps: SpeechOutputDependencies,
): SpeechOutputController {
  let generation = 0;
  let abort: AbortController | null = null;

  const stop = () => {
    generation += 1;
    abort?.abort();
    abort = null;
    deps.stopBrowser();
    deps.onSpeakingChange?.(false);
  };

  const speak = (text: string) => {
    const spoken = stripForSpeech(text);
    if (!spoken) return;
    stop();
    const mine = generation;
    const controller = new AbortController();
    abort = controller;
    deps.onSpeakingChange?.(true);

    void (async () => {
      try {
        const blob = await deps.requestCloud(spoken, controller.signal);
        if (mine !== generation) return;
        await deps.playCloud(blob, controller.signal);
        if (mine !== generation) return;
        deps.onEngineChange?.("cloud");
        deps.onSpeakingChange?.(false);
      } catch {
        if (mine !== generation || controller.signal.aborted) return;
        deps.onEngineChange?.("browser");
        deps.speakBrowser(spoken);
      }
    })();
  };

  return { speak, stop };
}

export function playAudioBlob(
  blob: Blob,
  signal: AbortSignal,
  audioCtor: typeof Audio = Audio,
): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);
  const element = new audioCtor(objectUrl);

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(objectUrl);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    element.onended = () => {
      cleanup();
      resolve();
    };
    element.onerror = () => {
      cleanup();
      reject(new Error("audio_playback_failed"));
    };
    void element.play().catch((error) => {
      cleanup();
      reject(error);
    });
  });
}
