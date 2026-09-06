/**
 * Signed-in presence strip for the main AppShell.
 *
 * Audio path: useSpeechOutput — signed-in `sync-tts` (OpenAI Speech) when
 * configured, browser speechSynthesis only as fallback. Meet Sync speaks a
 * Reliability Engineer greeting once per tab session when not muted. Tenant
 * sync_voice_output still gates CopilotDock and is named in the honesty
 * line. KPI brief is text-only from get_kpi_dashboard.
 * Mute is remembered in localStorage. Recommend is not authorize.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Volume2, VolumeX } from "lucide-react";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useSpeechOutput } from "../hooks/useSpeechOutput";
import {
  loadStoredPresenceCases,
  readPresenceMemory,
  resolvePresenceWorkingSubject,
} from "../lib/presence/memory";
import { derivePresencePhase } from "../lib/presence/state";
import {
  buildSpokenWelcome,
  describePresenceVoiceHonesty,
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
import { PresenceFace } from "./PresenceFace";
import { useAuth } from "./AuthProvider";

function metadataFullName(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const MEET_SYNC_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-signal-cyan/40 bg-signal-cyan/10 px-2 py-1 text-xs text-signal-cyan hover:border-signal-cyan/60 hover:bg-signal-cyan/15";

const SECONDARY_BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/20 hover:text-slate-100";

export function PresenceWelcome() {
  const { user, profile, loading } = useAuth();
  const { speak, stop, speaking, engine } = useSpeechOutput();
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
  const [boothListening, setBoothListening] = useState(false);
  const [boothThinking, setBoothThinking] = useState(false);
  const [workingSubject, setWorkingSubject] = useState(() =>
    resolvePresenceWorkingSubject([]),
  );

  const givenName = resolveWelcomeGivenName({
    fullName: profile?.full_name,
    metadataName: metadataFullName(user?.user_metadata?.full_name),
  });

  const userId = user?.id ?? "";
  const refreshWorkingSubject = useCallback(() => {
    if (typeof window === "undefined" || !userId) {
      setWorkingSubject(resolvePresenceWorkingSubject([]));
      return;
    }
    const memory = readPresenceMemory(window.sessionStorage, userId);
    setWorkingSubject(
      resolvePresenceWorkingSubject(
        loadStoredPresenceCases(window.localStorage),
        memory.lastSubject,
      ),
    );
  }, [userId]);

  useEffect(() => {
    refreshWorkingSubject();
  }, [refreshWorkingSubject]);

  const spokenWelcome = buildSpokenWelcome(givenName, workingSubject);
  const presencePhase = derivePresencePhase({
    listening: boothListening,
    thinking: boothThinking,
    speaking,
  });

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
    if (loading) return;
    const userId = user?.id ?? "";
    const already = userId
      ? hasSessionWelcome(window.sessionStorage, userId)
      : false;
    if (
      !shouldSpeakWelcome({
        signedIn: Boolean(userId),
        muted,
        alreadyWelcomedThisSession: already,
      })
    ) {
      return;
    }
    markSessionWelcome(window.sessionStorage, userId);
    speak(spokenWelcome);
  }, [loading, user, muted, spokenWelcome, speak]);

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
      if (open) {
        setBoothListening(false);
        setBoothThinking(false);
      }
      return !open;
    });
  };

  const booth = boothOpen ? (
    <PresenceBoothConversation
      signedIn={Boolean(user)}
      userId={user?.id ?? ""}
      muted={muted}
      voiceOutputEnabled={voiceOutputEnabled}
      givenName={givenName}
      briefLines={briefLines}
      caseContextLines={workingSubject.contextLines}
      caseBound={workingSubject.bound}
      speak={speak}
      stopSpeech={stop}
      speaking={speaking}
      onPresenceSignals={({ listening, thinking }) => {
        setBoothListening(listening);
        setBoothThinking(thinking);
      }}
      onMemoryChange={refreshWorkingSubject}
    />
  ) : null;

  if (loading || !user) return null;

  const honesty = describePresenceVoiceHonesty({
    voiceOutputReady,
    voiceOutputEnabled,
    speechEngine: engine,
  });

  const strip = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <PresenceFace phase={presencePhase} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">{spokenWelcome}</p>
          <p
            data-testid="presence-honesty"
            className="mt-1 text-[11px] text-slate-500"
          >
            {honesty}
          </p>
          {!boothOpen && briefLines.length > 0 ? (
            <ul data-testid="presence-brief" className="mt-1.5 space-y-0.5">
              {briefLines.map((line) => (
                <li key={line} className="text-xs text-slate-400">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!muted ? (
          <button
            type="button"
            onClick={() => speak(spokenWelcome)}
            className={SECONDARY_BUTTON_CLASS}
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
          className={MEET_SYNC_BUTTON_CLASS}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Meet Sync
        </button>
        {muted ? (
          <button
            type="button"
            onClick={handleUnmute}
            className={SECONDARY_BUTTON_CLASS}
          >
            <Volume2 className="h-3.5 w-3.5" />
            Unmute welcome
          </button>
        ) : (
          <button
            type="button"
            onClick={handleMute}
            className={SECONDARY_BUTTON_CLASS}
            aria-label="Mute welcome"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Mute
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-testid="presence-welcome"
      data-presence-muted={muted ? "true" : "false"}
      data-presence-voice={
        !voiceOutputReady ? "loading" : voiceOutputEnabled ? "on" : "off"
      }
      data-presence-phase={presencePhase}
      className={
        muted
          ? "shrink-0 border-b border-white/5 bg-white/[0.02] px-4 py-2"
          : "shrink-0 border-b border-white/5 bg-white/[0.02] px-4 py-2.5"
      }
    >
      {muted ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PresenceFace phase={presencePhase} />
            <p className="text-xs text-slate-500">
              Presence audio muted. Welcome will not speak in this browser.
              Tenant Voice output (`sync_voice_output`) still gates CopilotDock.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBooth}
              aria-label={boothOpen ? "Close Meet Sync" : "Meet Sync"}
              className={MEET_SYNC_BUTTON_CLASS}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Meet Sync
            </button>
            <button
              type="button"
              onClick={handleUnmute}
              className={SECONDARY_BUTTON_CLASS}
            >
              <Volume2 className="h-3.5 w-3.5" />
              Unmute welcome
            </button>
          </div>
        </div>
      ) : (
        strip
      )}
      {booth}
    </div>
  );
}
