import { AudioLines, Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { useSyncRealtimeVoice } from "../hooks/useSyncRealtimeVoice";
import type {
  SyncRealtimeContext,
  SyncVoiceQueryResult,
} from "../lib/speech/syncRealtimeClient";

interface SyncRealtimeVoicePanelProps {
  context: SyncRealtimeContext;
  disabled?: boolean;
  onAskSync: (question: string) => Promise<SyncVoiceQueryResult>;
  onNavigate: (path: string) => void;
  onActiveChange?: (active: boolean) => void;
}

export function SyncRealtimeVoicePanel({
  context,
  disabled,
  onAskSync,
  onNavigate,
  onActiveChange,
}: SyncRealtimeVoicePanelProps) {
  const voice = useSyncRealtimeVoice({
    context,
    disabled,
    onAskSync,
    onNavigate,
    onActiveChange,
  });
  const active =
    voice.state === "connecting" ||
    voice.state === "live" ||
    voice.state === "ending";

  return (
    <section
      className="border-b border-teal-500/15 bg-teal-500/4 px-4 py-3 sm:px-5"
      aria-label="Live voice conversation"
      data-testid="sync-realtime-voice"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${voice.state === "live" ? "border-teal-300/70 bg-teal-400/15 text-teal-200" : "border-white/10 bg-white/3 text-slate-400"}`}
          >
            {voice.state === "live" ? (
              <span className="absolute inset-0 animate-ping rounded-full border border-teal-300/25" />
            ) : null}
            <AudioLines className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-teal-200">
              Live voice
              <span className="font-normal text-slate-500">
                {voice.model || "OpenAI Realtime"} · Marin
              </span>
            </div>
            <p
              className="mt-0.5 text-[11px] leading-4 text-slate-400"
              aria-live="polite"
            >
              {voice.status}
            </p>
            {voice.lastEvent && active ? (
              <p className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-600">
                {voice.lastEvent}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {!active ? (
            <button
              type="button"
              onClick={() => void voice.start()}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-400 px-3 py-2 text-[11px] font-semibold text-slate-950 hover:bg-teal-300 disabled:opacity-40"
            >
              <Mic className="h-3.5 w-3.5" aria-hidden />
              {voice.state === "error" ? "Try again" : "Start conversation"}
            </button>
          ) : null}
          {voice.state === "connecting" ? (
            <span className="inline-flex items-center gap-1.5 px-2 text-[11px] text-slate-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Connecting
            </span>
          ) : null}
          {voice.state === "live" && !voice.pushToTalk ? (
            <button
              type="button"
              onClick={voice.toggleMute}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-300 hover:text-white"
            >
              {voice.muted ? (
                <Mic className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <MicOff className="h-3.5 w-3.5" aria-hidden />
              )}
              {voice.muted ? "Unmute" : "Mute"}
            </button>
          ) : null}
          {voice.state === "live" ? (
            <button
              type="button"
              onClick={voice.togglePushToTalk}
              className={`rounded-lg border px-2.5 py-2 text-[11px] ${voice.pressingToTalk ? "border-teal-300/60 bg-teal-400/10 text-teal-200" : "border-white/10 text-slate-400 hover:text-white"}`}
            >
              {voice.pushToTalk ? "Use open mic" : "Use push to talk"}
            </button>
          ) : null}
          {active && voice.state !== "connecting" ? (
            <button
              type="button"
              onClick={voice.end}
              disabled={voice.state === "ending"}
              className="inline-flex items-center gap-1 rounded-lg border border-red-400/25 px-2.5 py-2 text-[11px] text-red-300 hover:bg-red-500/8 disabled:opacity-40"
            >
              <PhoneOff className="h-3.5 w-3.5" aria-hidden />
              {voice.state === "ending" ? "Ending" : "End"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-[9px] leading-4 text-slate-600">
        When started, microphone audio, this screen’s bounded context, and Sync
        answers needed for the conversation are processed by OpenAI. Sync facts
        are retrieved through tenant-scoped evidence; recommendations and
        actions still require visible human confirmation.
      </p>
      <audio ref={voice.audioRef} autoPlay className="hidden" />
    </section>
  );
}
