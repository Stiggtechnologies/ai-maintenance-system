/**
 * Voice input for the composer and Meet Sync booth.
 *
 * This is browser-native speech recognition, not a SyncAI capability: the
 * transcription happens in the browser's own engine, nothing is uploaded by
 * this product, and it therefore holds the same promise as the rest of the
 * public workspace — what you say stays in the tab until you press send.
 *
 * It reports `supported: false` rather than rendering a button that does
 * nothing. Firefox has no SpeechRecognition implementation, and a microphone
 * icon that silently fails is worse than no microphone icon, particularly on a
 * page a prospective customer is using to judge whether the product works.
 *
 * Optional `restartOnEnd` is the continuous-listen wrapper for Meet Sync:
 * the browser's own end-of-speech still produces finals; this hook restarts
 * recognition so the booth can stay open. No AGPL / backtalk / barehands copy.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoothMicPermission } from "../lib/presence/boothListen";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

export interface UseDictationOptions {
  /** Keep the engine running after the browser ends a session. */
  restartOnEnd?: boolean;
  /** Emit non-final results through onInterim. Default false. */
  interimResults?: boolean;
  onInterim?: (text: string) => void;
  /** Fires on any speech result so the booth can barge in on TTS. */
  onSpeech?: () => void;
}

const MIC_BLOCKED_ERROR =
  "Microphone access was blocked. Allow it in your browser's site settings.";

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(
  onTranscript: (text: string) => void,
  options: UseDictationOptions = {},
) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<BoothMicPermission>(() =>
    getRecognitionCtor() ? "unknown" : "unsupported",
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const permissionRef = useRef<BoothMicPermission>(
    getRecognitionCtor() ? "unknown" : "unsupported",
  );
  const supported = getRecognitionCtor() !== null;

  const callbackRef = useRef(onTranscript);
  const optionsRef = useRef(options);
  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const setMicPermission = (next: BoothMicPermission) => {
    permissionRef.current = next;
    setPermission(next);
  };

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setMicPermission("unsupported");
      setError(
        "This browser has no speech recognition. Chrome, Edge and Safari do.",
      );
      return;
    }
    if (wantListeningRef.current && recognitionRef.current) return;
    wantListeningRef.current = true;
    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = Boolean(optionsRef.current.interimResults);
    recognition.lang = navigator.language || "en-CA";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      let heard = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (!piece) continue;
        heard = true;
        if (result.isFinal) finalText += piece;
        else interimText += piece;
      }
      if (heard) optionsRef.current.onSpeech?.();
      if (interimText.trim()) optionsRef.current.onInterim?.(interimText.trim());
      if (finalText.trim()) {
        setMicPermission("granted");
        callbackRef.current(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      // "no-speech" is someone pausing, not a failure worth shouting about.
      if (event.error === "no-speech") return;
      if (event.error === "aborted") return;
      if (event.error === "not-allowed") {
        wantListeningRef.current = false;
        setMicPermission("denied");
        setError(MIC_BLOCKED_ERROR);
        setListening(false);
        return;
      }
      setError("Dictation stopped unexpectedly.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (
        wantListeningRef.current &&
        optionsRef.current.restartOnEnd &&
        permissionRef.current !== "denied"
      ) {
        start();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      wantListeningRef.current = false;
      setListening(false);
      setError("Dictation stopped unexpectedly.");
    }
  }, []);

  const retryPermission = useCallback(async () => {
    setError(null);
    setMicPermission(getRecognitionCtor() ? "unknown" : "unsupported");
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setMicPermission("granted");
      } catch {
        setMicPermission("denied");
        setError(MIC_BLOCKED_ERROR);
        return;
      }
    }
    start();
  }, [start]);

  useEffect(() => () => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
  }, []);

  return {
    supported,
    listening,
    error,
    permission,
    start,
    stop,
    retryPermission,
    clearError: () => setError(null),
  };
}
