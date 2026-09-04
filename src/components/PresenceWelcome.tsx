/**
 * Signed-in presence strip for the main AppShell.
 *
 * Audio path: browser Web Speech API via useSpeechOutput (speechSynthesis).
 * Speaks the greeting once per tab session when not muted and
 * sync_voice_output is enabled (same fail-closed contract as CopilotDock).
 * The optional
 * brief is text-only and uses get_kpi_dashboard — never fabricated plant
 * readings. Mute is remembered in localStorage. This is a welcome, not
 * autonomous control, and it does not authorize plant execute.
 */
import { useEffect, useState } from "react";
import { MessageCircle, Volume2, VolumeX } from "lucide-react";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useSpeechOutput } from "../hooks/useSpeechOutput";
import {
  buildSpokenWelcome,
  hasSessionWelcome,
  markSessionWelcome,
  readMutePreference,
  resolveWelcomeGivenName,
  selectPresenceBriefLines,
  shouldSpeakWelcome,
  writeMutePreference,
} from "../lib/presence/welcome";
import { getKpiDashboard } from "../services/kpiService";
import { PresenceBoothConversation } from "./PresenceBoothConversation";
import { useAuth } from "./AuthProvider";

function metadataFullName(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function PresenceWelcome() {
  const { user, profile, loading } = useAuth();
  const { speak, stop } = useSpeechOutput();
  const voiceOutput = useFeatureFlag("sync_voice_output");
  const voiceOutputEnabled = voiceOutput.enabled;
  const voiceOutputReady = !voiceOutput.loading;
  const [muted, setMuted] = useState(() =>
    typeof window === "undefined"
      ? false
      : readMutePreference(window.localStorage),
  );
  const [briefLines, setBriefLines] = useState<string[]>([]);
  const [boothOpen, setBoothOpen] = useState(false);

  const givenName = resolveWelcomeGivenName({
    fullName: profile?.full_name,
    metadataName: metadataFullName(user?.user_metadata?.full_name),
  });
  const spokenWelcome = buildSpokenWelcome(givenName);

  useEffect(() => {
    if (loading || !user) {
      setBriefLines([]);
      return;
    }
    let cancelled = false;
    getKpiDashboard()
      .then((dashboard) => {
        if (!cancelled) setBriefLines(selectPresenceBriefLines(dashboard.kpis));
      })
      .catch(() => {
        if (!cancelled) {
          setBriefLines(selectPresenceBriefLines(null, { unavailable: true }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  useEffect(() => {
    if (loading || voiceOutput.loading) return;
    const userId = user?.id ?? "";
    const already = userId
      ? hasSessionWelcome(window.sessionStorage, userId)
      : false;
    if (
      !shouldSpeakWelcome({
        signedIn: Boolean(userId),
        muted,
        alreadyWelcomedThisSession: already,
        voiceOutputEnabled,
      })
    ) {
      return;
    }
    markSessionWelcome(window.sessionStorage, userId);
    speak(spokenWelcome);
  }, [
    loading,
    voiceOutput.loading,
    user,
    muted,
    spokenWelcome,
    speak,
    voiceOutputEnabled,
  ]);

  useEffect(() => {
    if (!voiceOutputEnabled) stop();
  }, [voiceOutputEnabled, stop]);

  const handleMute = () => {
    writeMutePreference(window.localStorage, true);
    setMuted(true);
    stop();
  };

  const handleUnmute = () => {
    writeMutePreference(window.localStorage, false);
    setMuted(false);
  };

  const toggleBooth = () => {
    setBoothOpen((open) => {
      if (!open) stop();
      return !open;
    });
  };

  const booth = boothOpen ? (
    <PresenceBoothConversation
      signedIn={Boolean(user)}
      muted={muted}
      voiceOutputEnabled={voiceOutputEnabled}
      givenName={givenName}
      briefLines={briefLines}
      speak={speak}
      stopSpeech={stop}
    />
  ) : null;

  if (loading || !user) return null;

  if (muted) {
    return (
      <div
        data-testid="presence-welcome"
        data-presence-muted="true"
        data-presence-voice={
          !voiceOutputReady ? "loading" : voiceOutputEnabled ? "on" : "off"
        }
        className="shrink-0 border-b border-white/5 bg-white/[0.02] px-4 py-2"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Presence audio muted. Welcome will not speak in this browser.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBooth}
              aria-label={boothOpen ? "Close Meet Sync" : "Meet Sync"}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Meet Sync
            </button>
            <button
              type="button"
              onClick={handleUnmute}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Unmute welcome
            </button>
          </div>
        </div>
        {booth}
      </div>
    );
  }

  return (
    <div
      data-testid="presence-welcome"
      data-presence-muted="false"
      data-presence-voice={
        !voiceOutputReady ? "loading" : voiceOutputEnabled ? "on" : "off"
      }
      className="shrink-0 border-b border-white/5 bg-white/[0.02] px-4 py-2.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{spokenWelcome}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {!voiceOutputReady
              ? "Not autonomous control. Recommend is not authorize."
              : voiceOutputEnabled
                ? "Browser TTS welcome only. Not autonomous control. Recommend is not authorize."
                : "Voice output is off for this tenant. Text welcome and Meet Sync still work. Not autonomous control. Recommend is not authorize."}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {briefLines.map((line) => (
              <li key={line} className="text-xs text-slate-400">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {voiceOutputEnabled ? (
            <button
              type="button"
              onClick={() => speak(spokenWelcome)}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan"
              aria-label="Play welcome"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Play
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleBooth}
            aria-label={boothOpen ? "Close Meet Sync" : "Meet Sync"}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Meet Sync
          </button>
          <button
            type="button"
            onClick={handleMute}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/20 hover:text-slate-100"
            aria-label="Mute welcome"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Mute
          </button>
        </div>
      </div>
      {booth}
    </div>
  );
}
