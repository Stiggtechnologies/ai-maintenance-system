/**
 * Speech-output adapter for Sync and Meet Sync.
 *
 * Prefers the signed-in `sync-tts` edge function (OpenAI Speech, server-side
 * key) and plays the returned mp3 through an Audio element. Browser
 * `speechSynthesis` is fallback only — missing key, unsigned-in, network
 * failure, or playback error. stop() cancels in-flight synthesize, Audio,
 * and speechSynthesis so dictation can barge in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSpeechOutputController,
  playAudioBlob,
  type SpeechEngine,
} from "../lib/speech/speechOutput";
import {
  probeSyncTtsConfigured,
  requestSyncTtsAudio,
} from "../lib/speech/syncTtsClient";

export type { SpeechEngine };

export function useSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const [engine, setEngine] = useState<SpeechEngine>("unknown");
  const browserSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const stopBrowser = useCallback(() => {
    if (browserSupported) window.speechSynthesis.cancel();
  }, [browserSupported]);

  const speakBrowser = useCallback(
    (text: string) => {
      if (!browserSupported || !text.trim()) {
        setSpeaking(false);
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || "en-CA";
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [browserSupported],
  );

  const controller = useMemo(
    () =>
      createSpeechOutputController({
        requestCloud: requestSyncTtsAudio,
        playCloud: (blob, signal) => playAudioBlob(blob, signal),
        speakBrowser,
        stopBrowser,
        onSpeakingChange: setSpeaking,
        onEngineChange: setEngine,
      }),
    [speakBrowser, stopBrowser],
  );

  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const stop = useCallback(() => {
    controllerRef.current.stop();
  }, []);

  const speak = useCallback((text: string) => {
    controllerRef.current.speak(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void probeSyncTtsConfigured()
      .then((configured) => {
        if (!cancelled) setEngine(configured ? "cloud" : "browser");
      })
      .catch(() => {
        if (!cancelled) setEngine("browser");
      });
    return () => {
      cancelled = true;
      controllerRef.current.stop();
    };
  }, []);

  const supported =
    browserSupported || engine === "cloud" || engine === "unknown";

  return { supported, speaking, engine, speak, stop };
}
