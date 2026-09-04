/**
 * Thin Meet Sync booth conversation on the signed-in presence strip.
 *
 * Voice: browser SpeechRecognition (useDictation) + speechSynthesis
 * (useSpeechOutput). Answers: askBoothConversation → ai-agent-processor
 * ReliabilityAgent. Session-only transcript. Recommend ≠ authorize.
 */
import { useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { useDictation } from "../hooks/useDictation";
import { askBoothConversation } from "../lib/presence/askBooth";
import {
  buildBoothAskQuery,
  shouldSpeakBoothReply,
  stripForSpeech,
} from "../lib/presence/booth";

export interface PresenceBoothMessage {
  id: string;
  role: "user" | "sync";
  text: string;
}

interface PresenceBoothConversationProps {
  signedIn: boolean;
  muted: boolean;
  givenName: string | null;
  briefLines: string[];
  speak: (text: string) => void;
  stopSpeech: () => void;
}

export function PresenceBoothConversation({
  signedIn,
  muted,
  givenName,
  briefLines,
  speak,
  stopSpeech,
}: PresenceBoothConversationProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<PresenceBoothMessage[]>([]);
  const heldTranscript = useRef("");
  const holdingTalk = useRef(false);

  const dictation = useDictation((text) => {
    heldTranscript.current = heldTranscript.current
      ? `${heldTranscript.current} ${text}`
      : text;
    setInput(heldTranscript.current);
  });

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!signedIn || !question || busy) return;
    setInput("");
    heldTranscript.current = "";
    const userMessage: PresenceBoothMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: question,
    };
    setMessages((current) => [...current, userMessage]);
    setBusy(true);
    stopSpeech();
    try {
      const result = await askBoothConversation(
        buildBoothAskQuery({ question, briefLines, givenName }),
      );
      const reply: PresenceBoothMessage = {
        id: `sync-${Date.now()}`,
        role: "sync",
        text: result.response,
      };
      setMessages((current) => [...current, reply]);
      if (shouldSpeakBoothReply({ signedIn, muted })) {
        const spoken = stripForSpeech(result.response);
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
    if (!holdingTalk.current) return;
    holdingTalk.current = false;
    dictation.stop();
    const text = heldTranscript.current.trim() || input.trim();
    if (text) void send(text);
  };

  return (
    <div
      data-testid="presence-booth"
      className="mt-2 border-t border-white/5 pt-2"
    >
      <p className="text-[11px] text-slate-500">
        Meet Sync — booth conversation. Grounded ask only. Recommend is not
        authorize. No plant execute.
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
          void send(input);
        }}
      >
        <button
          type="button"
          aria-label={dictation.listening ? "Release to send" : "Hold to talk"}
          disabled={!dictation.supported || busy}
          onPointerDown={startTalk}
          onPointerUp={endTalk}
          onPointerLeave={() => {
            if (dictation.listening) dictation.stop();
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
              ? "Ask about maintenance or hold to talk"
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
