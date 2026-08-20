/**
 * Browser speech-output adapter for Sync.
 *
 * This is deliberately an adapter, not a promise that every browser has the
 * same voice stack. The caller feature-gates it with sync_voice_output. stop()
 * is synchronous from the UI's perspective so starting dictation can barge in
 * and silence output before the microphone is opened.
 */
import { useCallback, useEffect, useState } from "react";

export function useSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || "en-CA";
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  useEffect(() => stop, [stop]);

  return { supported, speaking, speak, stop };
}
