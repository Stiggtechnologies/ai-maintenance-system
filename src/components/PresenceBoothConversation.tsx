/**
 * Thin Meet Sync booth conversation on the signed-in presence strip.
 *
 * Voice: browser SpeechRecognition (useDictation) + speechSynthesis
 * (useSpeechOutput). Answers: askBoothConversation → ai-agent-processor
 * ReliabilityAgent. Session + Decision Case continuity via Sync stores.
 * Recommend ≠ authorize.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { useDictation } from "../hooks/useDictation";
import { askBoothConversation } from "../lib/presence/askBooth";
import {
  buildBoothAskQuery,
  shouldSpeakBoothReply,
  spokenBoothReply,
} from "../lib/presence/booth";
import {
  appendPresenceTurnToDecisionCase,
  nextPresenceSubject,
  readPresenceSessionMemory,
  resolvePresenceDecisionContext,
  writePresenceSessionMemory,
  type PresenceSessionTurn,
} from "../lib/presence/memory";
import {
  resolvePresencePhase,
  type PresenceFlags,
} from "../lib/presence/state";

export type PresenceBoothMessage = PresenceSessionTurn;

interface PresenceBoothConversationProps {
  userId: string;
  signedIn: boolean;
  muted: boolean;
  voiceOutputEnabled: boolean;
  speaking: boolean;
  givenName: string | null;
  briefLines: string[];
  speak: (text: string) => void;
  stopSpeech: () => void;
  onPresenceFlags?: (flags: PresenceFlags) => void;
}

export function PresenceBoothConversation({
  userId,
  signedIn,
  muted,
  voiceOutputEnabled,
  speaking,
  givenName,
  briefLines,
  speak,
  stopSpeech,
  onPresenceFlags,
}: PresenceBoothConversationProps) {
  const restored = useRef(
    typeof window === "undefined"
      ? { messages: [], subject: null, caseId: null }
      : readPresenceSessionMemory(window.sessionStorage, userId),
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<PresenceBoothMessage[]>(
    () => restored.current.messages,
  );
  const [subject, setSubject] = useState<string | null>(
    () => restored.current.subject,
  );
  const [caseId, setCaseId] = useState<string | null>(
    () => restored.current.caseId,
  );
  const [decisionLabel, setDecisionLabel] = useState<string>(
    "No Decision Case selected.",
  );
  const heldTranscript = useRef("");
  const holdingTalk = useRef(false);
  const clickArmed = useRef(false);

  const dictation = useDictation((text) => {
    heldTranscript.current = heldTranscript.current
      ? `${heldTranscript.current} ${text}`
      : text;
    setInput(heldTranscript.current);
  });

  const listening = dictation.listening;
  const flags: PresenceFlags = {
    listening,
    thinking: busy,
    speaking,
  };

  useEffect(() => {
    onPresenceFlags?.({ listening, thinking: busy, speaking });
  }, [listening, busy, speaking, onPresenceFlags]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const context = resolvePresenceDecisionContext(window.localStorage, caseId);
    setDecisionLabel(
      context.bound && context.caseNumber
        ? `${context.caseNumber} · ${context.asset}`
        : "No Decision Case selected.",
    );
    if (context.caseId && context.caseId !== caseId) {
      setCaseId(context.caseId);
    }
  }, [caseId, messages.length]);

  useEffect(() => {
    if (typeof window === "undefined" || !userId) return;
    writePresenceSessionMemory(window.sessionStorage, userId, {
      messages,
      subject,
      caseId,
    });
  }, [userId, messages, subject, caseId]);

  const persistAndAsk = async (raw: string) => {
    const question = raw.trim();
    if (!signedIn || !question || busy) return;
    setInput("");
    heldTranscript.current = "";
    const nextSubject = nextPresenceSubject(question, subject);
    setSubject(nextSubject);
    const userMessage: PresenceBoothMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: question,
    };
    const prior = [...messages, userMessage];
    setMessages(prior);
    setBusy(true);
    stopSpeech();
    try {
      const decision =
        typeof window === "undefined"
          ? resolvePresenceDecisionContext({ getItem: () => null }, caseId)
          : resolvePresenceDecisionContext(window.localStorage, caseId);
      if (decision.caseId) setCaseId(decision.caseId);
      const result = await askBoothConversation(
        buildBoothAskQuery({
          question,
          briefLines,
          givenName,
          namedSubject: nextSubject,
          sessionTurns: prior.slice(-4),
          decisionLines: decision.contextLines,
        }),
      );
      const reply: PresenceBoothMessage = {
        id: `sync-${Date.now()}`,
        role: "sync",
        text: result.response,
      };
      setMessages((current) => [...current, reply]);
      if (typeof window !== "undefined") {
        appendPresenceTurnToDecisionCase(window.localStorage, {
          caseId: decision.caseId,
          question,
          reply: result.response,
        });
      }
      if (shouldSpeakBoothReply({ signedIn, muted, voiceOutputEnabled })) {
        const spoken = spokenBoothReply(result.response);
        if (spoken) speak(spoken);
      }
    } finally {
      setBusy(false);
    }
  };

  const startTalk = () => {
    if (busy || !dictation.supported) return;
    holdingTalk.current = true;
    stopSpeech();
    heldTranscript.current = input.trim();
    dictation.start();
  };

  const endTalk = () => {
    dictation.stop();
    holdingTalk.current = false;
    clickArmed.current = false;
    const text = heldTranscript.current.trim() || input.trim();
    if (text) void persistAndAsk(text);
  };

  const onPointerDownTalk = () => {
    if (busy || !dictation.supported) return;
    if (clickArmed.current) {
      endTalk();
      return;
    }
    startTalk();
  };

  const onPointerUpTalk = () => {
    if (!holdingTalk.current) return;
    const text = heldTranscript.current.trim() || input.trim();
    if (text) {
      endTalk();
      return;
    }
    holdingTalk.current = false;
    clickArmed.current = true;
  };

  const phase = resolvePresencePhase(flags);

  return (
    <div
      data-testid="presence-booth"
      data-presence-phase={phase}
      className="mt-2 border-t border-white/5 pt-2"
    >
      <p className="text-[11px] text-slate-500">
        Meet Sync — Reliability Engineer booth. Grounded ask only. Recommend is
        not authorize. No plant execute.
      </p>
      <p
        data-testid="presence-continuity"
        className="mt-1 text-[11px] text-slate-400"
      >
        {subject
          ? `Continuing: ${subject}`
          : "Name a Decision Case or plant subject to continue."}{" "}
        {decisionLabel}
      </p>
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
      {dictation.error && (
        <p className="mt-1 text-[11px] text-amber-400/90">{dictation.error}</p>
      )}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void persistAndAsk(input);
        }}
      >
        <button
          type="button"
          aria-label={
            dictation.listening
              ? clickArmed.current
                ? "Click to send"
                : "Release to send"
              : "Click or hold to talk"
          }
          disabled={!dictation.supported || busy}
          onPointerDown={onPointerDownTalk}
          onPointerUp={onPointerUpTalk}
          onPointerLeave={() => {
            if (holdingTalk.current && dictation.listening) dictation.stop();
            holdingTalk.current = false;
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan disabled:opacity-40"
        >
          {dictation.listening ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            dictation.supported
              ? "Ask about a Decision Case or hold to talk"
              : "Ask about a Decision Case or plant subject"
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
