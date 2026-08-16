/**
 * Voice input for the composer.
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
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getRecognitionCtor() !== null;

  // The callback changes every render; hold it in a ref so the recognition
  // instance is not torn down and rebuilt mid-utterance.
  const callbackRef = useRef(onTranscript);
  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError(
        "This browser has no speech recognition. Chrome, Edge and Safari do.",
      );
      return;
    }
    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-CA";

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText.trim()) callbackRef.current(finalText.trim());
    };
    recognition.onerror = (event) => {
      // "no-speech" is someone pausing, not a failure worth shouting about.
      if (event.error === "no-speech") return;
      setError(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser's site settings."
          : "Dictation stopped unexpectedly.",
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return {
    supported,
    listening,
    error,
    start,
    stop,
    clearError: () => setError(null),
  };
}
