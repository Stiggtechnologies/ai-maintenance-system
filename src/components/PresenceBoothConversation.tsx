/**
 * Thin Meet Sync booth conversation on the signed-in presence strip.
 *
 * Voice: browser SpeechRecognition (useDictation) + useSpeechOutput
 * (cloud sync-tts when configured, speechSynthesis fallback). Default
 * listen is continuous with end-of-utterance; hold-to-talk is optional.
 * Recognition is paused while TTS plays (plus a short settle) so Sync
 * does not treat its own spoken words as a user turn.
 * Answers: askBoothConversation → ai-agent-processor ReliabilityAgent.
 * Tab transcript in sessionStorage; signed-in notes in the Sync-native
 * meeting vault. Decision Case continuity from the existing draft store
 * + honesty helpers. Recommend ≠ authorize.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { useDictation } from "../hooks/useDictation";
import { askBoothConversation } from "../lib/presence/askBooth";
import {
  BOOTH_UNAVAILABLE_REPLY,
  buildBoothAskQuery,
  shouldSpeakBoothReply,
  stripForSpeech,
} from "../lib/presence/booth";
import {
  BOOTH_ECHO_MEMORY_MS,
  BOOTH_TTS_SETTLE_MS,
  BOOTH_UTTERANCE_SILENCE_MS,
  MIC_BLOCKED_COPY,
  MIC_UNSUPPORTED_COPY,
  boothVoiceMode,
  isMicBlockedError,
  readHoldToTalkPreference,
  shouldAutoListen,
  shouldCommitContinuousUtterance,
  shouldTreatHeardSpeechAsUserTurn,
  writeHoldToTalkPreference,
} from "../lib/presence/boothListen";
import {
  readPresenceMemory,
  rememberNamedSubject,
  sessionMemoryLines,
  writePresenceMemory,
  type PresenceBoothMessage,
} from "../lib/presence/memory";
import { shouldHydrateFromVault } from "../lib/presence/vault";
import {
  loadPresenceVaultSession,
  persistPresenceVault,
} from "../lib/presence/vaultClient";
import {
  formatUnboundLiveQuestion,
  promptNamesConcreteSubject,
} from "../lib/decision-case-honesty";

interface PresenceBoothConversationProps {
  signedIn: boolean;
  userId: string;
  muted: boolean;
  voiceOutputEnabled: boolean;
  givenName: string | null;
  briefLines: string[];
  caseContextLines: string[];
  caseBound: boolean;
  organizationId?: string;
  caseId?: string | null;
  caseNumber?: string | null;
  asset?: string | null;
  speak: (text: string) => void;
  stopSpeech: () => void;
  speaking?: boolean;
  onPresenceSignals?: (signals: {
    listening: boolean;
    thinking: boolean;
  }) => void;
  onMemoryChange?: () => void;
}

export function PresenceBoothConversation({
  signedIn,
  userId,
  muted,
  voiceOutputEnabled,
  givenName,
  briefLines,
  caseContextLines,
  caseBound,
  organizationId = "",
  caseId = null,
  caseNumber = null,
  asset = null,
  speak,
  stopSpeech,
  speaking = false,
  onPresenceSignals,
  onMemoryChange,
}: PresenceBoothConversationProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [holdToTalk, setHoldToTalk] = useState(() =>
    typeof window === "undefined"
      ? false
      : readHoldToTalkPreference(window.localStorage),
  );
  const [listenPaused, setListenPaused] = useState(false);
  const [messages, setMessages] = useState<PresenceBoothMessage[]>(() =>
    userId && typeof window !== "undefined"
      ? readPresenceMemory(window.sessionStorage, userId).messages
      : [],
  );
  const lastSubjectRef = useRef(
    userId && typeof window !== "undefined"
      ? readPresenceMemory(window.sessionStorage, userId).lastSubject
      : null,
  );
  const heldTranscript = useRef("");
  const holdingTalk = useRef(false);
  const utteranceRef = useRef("");
  const silenceTimerRef = useRef<number | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const ttsGateRef = useRef(false);
  const wasSpeakingRef = useRef(speaking);
  const [ttsGating, setTtsGating] = useState(false);
  const [ttsSettling, setTtsSettling] = useState(false);
  const holdToTalkRef = useRef(holdToTalk);
  const speakingRef = useRef(speaking);
  const busyRef = useRef(busy);
  const ttsSettlingRef = useRef(ttsSettling);
  const sendRef = useRef<(raw: string) => Promise<void>>(async () => undefined);
  const signalsRef = useRef(onPresenceSignals);
  holdToTalkRef.current = holdToTalk;
  speakingRef.current = speaking;
  busyRef.current = busy;
  ttsSettlingRef.current = ttsSettling;
  signalsRef.current = onPresenceSignals;

  const heardIsUserTurn = (transcript?: string) =>
    shouldTreatHeardSpeechAsUserTurn({
      speaking: speakingRef.current,
      settling: ttsSettlingRef.current,
      outputGating: ttsGateRef.current,
      transcript,
      lastSpokenText: lastSpokenRef.current,
    });

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const scheduleContinuousCommit = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      const transcript = utteranceRef.current.trim();
      if (
        !shouldCommitContinuousUtterance({
          transcript,
          silenceMs: BOOTH_UTTERANCE_SILENCE_MS,
          speaking: speakingRef.current,
          busy: busyRef.current,
          holdToTalk: holdToTalkRef.current,
          settling: ttsSettlingRef.current,
          outputGating: ttsGateRef.current,
          lastSpokenText: lastSpokenRef.current,
        })
      ) {
        return;
      }
      utteranceRef.current = "";
      setInput("");
      void sendRef.current(transcript);
    }, BOOTH_UTTERANCE_SILENCE_MS);
  };

  const dictation = useDictation(
    (text) => {
      if (holdToTalkRef.current) {
        heldTranscript.current = heldTranscript.current
          ? `${heldTranscript.current} ${text}`
          : text;
        setInput(heldTranscript.current);
        return;
      }
      if (!heardIsUserTurn(text)) return;
      utteranceRef.current = utteranceRef.current
        ? `${utteranceRef.current} ${text}`
        : text;
      setInput(utteranceRef.current);
      scheduleContinuousCommit();
    },
    {
      restartOnEnd: !holdToTalk,
      interimResults: !holdToTalk,
      ignoreResults:
        speaking || ttsSettling || ttsGating || ttsGateRef.current,
      onInterim: (text) => {
        if (holdToTalkRef.current) return;
        if (!heardIsUserTurn(text)) return;
        setInput(
          utteranceRef.current ? `${utteranceRef.current} ${text}` : text,
        );
        scheduleContinuousCommit();
      },
      onSpeech: () => {
        if (holdToTalkRef.current) return;
        if (!heardIsUserTurn()) return;
        stopSpeech();
      },
    },
  );
  const {
    supported: dictationSupported,
    listening: dictationListening,
    error: dictationError,
    permission: dictationPermission,
    start: startDictation,
    stop: stopDictation,
    retryPermission,
  } = dictation;

  useEffect(() => {
    signalsRef.current?.({ listening: dictationListening, thinking: busy });
  }, [busy, dictationListening]);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      signalsRef.current?.({ listening: false, thinking: false });
    };
  }, []);

  useEffect(() => {
    if (speaking) {
      ttsGateRef.current = true;
      wasSpeakingRef.current = true;
      utteranceRef.current = "";
      clearSilenceTimer();
      setTtsGating(true);
      setTtsSettling(false);
      return;
    }
    if (!wasSpeakingRef.current) return;
    wasSpeakingRef.current = false;
    setTtsSettling(true);
    const settleId = window.setTimeout(() => {
      ttsGateRef.current = false;
      setTtsGating(false);
      setTtsSettling(false);
    }, BOOTH_TTS_SETTLE_MS);
    const echoId = window.setTimeout(() => {
      lastSpokenRef.current = null;
    }, BOOTH_TTS_SETTLE_MS + BOOTH_ECHO_MEMORY_MS);
    return () => {
      window.clearTimeout(settleId);
      window.clearTimeout(echoId);
    };
  }, [speaking]);

  useEffect(() => {
    const auto = shouldAutoListen({
      muted,
      holdToTalk,
      supported: dictationSupported,
      busy,
      micPermission: dictationPermission,
      speaking,
      settling: ttsSettling,
      outputGating: ttsGating,
    });
    if (auto && !listenPaused) {
      startDictation();
      return;
    }
    if (holdToTalk && holdingTalk.current) return;
    stopDictation();
  }, [
    muted,
    holdToTalk,
    listenPaused,
    busy,
    speaking,
    ttsSettling,
    ttsGating,
    dictationSupported,
    dictationPermission,
    startDictation,
    stopDictation,
  ]);

  useEffect(() => {
    if (!signedIn || !userId || !organizationId) return;
    let cancelled = false;
    void loadPresenceVaultSession({ userId, organizationId }).then((vault) => {
      if (cancelled || !vault) return;
      const tab = readPresenceMemory(window.sessionStorage, userId);
      if (!shouldHydrateFromVault(tab, vault)) return;
      setMessages(vault.messages);
      lastSubjectRef.current = vault.lastSubject;
      try {
        writePresenceMemory(window.sessionStorage, userId, vault);
      } catch {
        // Tab cache is best-effort.
      }
      try {
        onMemoryChange?.();
      } catch {
        // Parent subject refresh is best-effort.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, userId, organizationId, onMemoryChange]);

  const persist = (
    nextMessages: PresenceBoothMessage[],
    lastSubject: string | null,
  ) => {
    if (!userId) return;
    const nextMemory = { messages: nextMessages, lastSubject };
    try {
      writePresenceMemory(window.sessionStorage, userId, nextMemory);
    } catch {
      // Tab memory is best-effort. A blocked or full sessionStorage must not
      // abort a booth turn.
    }
    if (signedIn && organizationId) {
      void persistPresenceVault({
        userId,
        organizationId,
        memory: nextMemory,
        caseId,
        caseNumber,
        asset,
      });
    }
    try {
      onMemoryChange?.();
    } catch {
      // Parent subject refresh is best-effort.
    }
  };

  const appendSyncReply = (
    withUser: PresenceBoothMessage[],
    lastSubject: string | null,
    text: string,
  ) => {
    const reply: PresenceBoothMessage = {
      id: `sync-${Date.now()}`,
      role: "sync",
      text,
    };
    const withReply = [...withUser, reply];
    setMessages(withReply);
    persist(withReply, lastSubject);
    if (!shouldSpeakBoothReply({ signedIn, muted, voiceOutputEnabled })) {
      return;
    }
    try {
      const spoken = stripForSpeech(text);
      if (!spoken) return;
      lastSpokenRef.current = spoken;
      ttsGateRef.current = true;
      utteranceRef.current = "";
      clearSilenceTimer();
      setTtsGating(true);
      setTtsSettling(false);
      stopDictation();
      speak(spoken);
    } catch {
      // Browser TTS failure must not hide the on-screen Sync reply.
    }
  };

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!signedIn || !question || busyRef.current) return;
    setInput("");
    heldTranscript.current = "";
    utteranceRef.current = "";
    const userMessage: PresenceBoothMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: question,
    };
    const nextSubject = rememberNamedSubject(question, lastSubjectRef.current);
    lastSubjectRef.current = nextSubject;
    const withUser = [...messages, userMessage];
    setMessages(withUser);
    setBusy(true);
    try {
      persist(withUser, nextSubject);
      stopSpeech();
      const askQuestion =
        !caseBound && promptNamesConcreteSubject(question)
          ? formatUnboundLiveQuestion(question)
          : question;
      const result = await askBoothConversation(
        buildBoothAskQuery({
          question: askQuestion,
          briefLines,
          givenName,
          caseContextLines,
          sessionLines: sessionMemoryLines({
            messages: withUser,
            lastSubject: nextSubject,
          }),
        }),
      );
      appendSyncReply(withUser, nextSubject, result.response);
    } catch {
      appendSyncReply(withUser, nextSubject, BOOTH_UNAVAILABLE_REPLY);
    } finally {
      setBusy(false);
    }
  };
  sendRef.current = send;

  const startTalk = () => {
    if (!holdToTalk || busy || !dictationSupported) return;
    holdingTalk.current = true;
    stopSpeech();
    heldTranscript.current = input.trim();
    startDictation();
  };

  const endTalk = () => {
    if (!holdToTalk || !holdingTalk.current) return;
    holdingTalk.current = false;
    stopDictation();
    const text = heldTranscript.current.trim() || input.trim();
    if (text) void send(text);
  };

  const toggleHoldToTalk = (next: boolean) => {
    setHoldToTalk(next);
    writeHoldToTalkPreference(window.localStorage, next);
    holdingTalk.current = false;
    clearSilenceTimer();
    utteranceRef.current = "";
    if (next) setListenPaused(false);
  };

  const micBlocked =
    dictationPermission === "denied" || isMicBlockedError(dictationError);
  const voiceMode = boothVoiceMode(holdToTalk);
  const micLabel = holdToTalk
    ? dictationListening
      ? "Release to send"
      : "Hold to talk"
    : dictationListening
      ? "Pause listening"
      : "Start listening";

  return (
    <div
      data-testid="presence-booth"
      data-booth-voice-mode={voiceMode}
      className="mt-2 border-t border-white/5 pt-2"
    >
      <p className="text-[11px] text-slate-500">
        Meet Sync — Reliability Engineer booth. Grounded ask only. Recommend is
        not authorize. No plant execute.
        {organizationId
          ? " Signed-in notes persist beyond this tab."
          : " Notes stay in this tab until you sign in."}
        {caseBound
          ? " Active Decision Case is in context."
          : " No Decision Case is bound — named subjects stay provisional."}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={holdToTalk}
            onChange={(event) => toggleHoldToTalk(event.target.checked)}
            aria-label="Hold to talk"
            className="rounded border-white/20 bg-transparent"
          />
          Hold to talk
        </label>
        <span className="text-[11px] text-slate-500">
          {holdToTalk
            ? "Optional press-and-hold. Default is continuous listen."
            : muted
              ? "Muted — continuous listen is paused. Type a question or unmute."
              : dictationListening
                ? "Listening — speak when you want Sync."
                : listenPaused
                  ? "Listening paused."
                  : "Continuous listen when the microphone is allowed."}
        </span>
      </div>
      {messages.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1.5 overflow-auto">
          {messages.map((message) => (
            <li key={message.id} className="text-xs">
              <span className="font-medium text-slate-300">
                {message.role === "user" ? "You" : "Sync"}
              </span>
              <span className="ml-1.5 text-slate-400">{message.text}</span>
            </li>
          ))}
        </ul>
      )}
      {micBlocked ? (
        <div className="mt-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1.5">
          <p className="text-[11px] text-amber-400/90">{MIC_BLOCKED_COPY}</p>
          <button
            type="button"
            onClick={() => {
              void retryPermission();
            }}
            className="mt-1 text-[11px] text-signal-cyan hover:underline"
          >
            Enable microphone
          </button>
        </div>
      ) : dictationError ? (
        <p className="mt-1 text-[11px] text-amber-400/90">{dictationError}</p>
      ) : !dictationSupported ? (
        <p className="mt-1 text-[11px] text-slate-500">
          {MIC_UNSUPPORTED_COPY}
        </p>
      ) : null}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <button
          type="button"
          aria-label={micLabel}
          disabled={!dictationSupported || busy || micBlocked}
          onPointerDown={holdToTalk ? startTalk : undefined}
          onPointerUp={holdToTalk ? endTalk : undefined}
          onPointerLeave={holdToTalk ? endTalk : undefined}
          onClick={
            holdToTalk
              ? undefined
              : () => {
                  if (dictationListening) {
                    setListenPaused(true);
                    stopDictation();
                    return;
                  }
                  setListenPaused(false);
                  startDictation();
                }
          }
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan disabled:opacity-40"
        >
          {dictationListening ? (
            <Mic className="h-3.5 w-3.5 text-signal-cyan" />
          ) : (
            <MicOff className="h-3.5 w-3.5" />
          )}
        </button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            dictationSupported
              ? holdToTalk
                ? "Ask about maintenance or hold to talk"
                : "Ask about maintenance or just speak"
              : "Ask about maintenance or operations"
          }
          disabled={busy}
          className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-signal-cyan/40 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send question"
          disabled={busy || !input.trim()}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send
        </button>
      </form>
    </div>
  );
}
