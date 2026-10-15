/**
 * Optional step narration for the self-serve Get started path.
 * Talk me through it and Mute stay visible. The speech hook mounts only when
 * tenant Voice output is enabled and this browser is not muted, so no cloud
 * TTS request is made while voice is unavailable or muted.
 */
import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useSpeechOutput } from "../../hooks/useSpeechOutput";
import {
  readMutePreference,
  writeMutePreference,
} from "../../lib/presence/welcome";
import { stripForSpeech } from "../../../supabase/functions/_shared/sync-tts-core";

const controlClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-[#0D1520] px-3 py-2 text-base font-semibold text-slate-100 disabled:cursor-not-allowed disabled:text-slate-200";

function browserVoiceMuted(): boolean {
  try {
    return readMutePreference(window.localStorage);
  } catch {
    return true;
  }
}

function persistBrowserMute(muted: boolean) {
  try {
    writeMutePreference(window.localStorage, muted);
  } catch {
    /* This view still honors the in-memory choice. */
  }
}

function NarrationControls({
  script,
  onMute,
}: {
  script: string;
  onMute: () => void;
}) {
  const { speak, stop, speaking } = useSpeechOutput();
  const [enabled, setEnabled] = useState(false);
  const spoken = stripForSpeech(script);

  useEffect(() => {
    if (!enabled || !spoken) return;
    speak(spoken);
    return () => {
      stop();
    };
  }, [enabled, spoken, speak, stop]);

  const mute = () => {
    stop();
    setEnabled(false);
    onMute();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="self-serve-narration-toggle"
        aria-pressed={enabled}
        className={controlClass}
        onClick={() => {
          if (enabled) {
            mute();
            return;
          }
          setEnabled(true);
        }}
      >
        <Volume2 className="h-4 w-4" aria-hidden />
        Talk me through it
      </button>
      <button
        type="button"
        data-testid="self-serve-narration-stop"
        aria-label="Mute"
        disabled={!enabled && !speaking}
        className={controlClass}
        onClick={mute}
      >
        <VolumeX className="h-4 w-4" aria-hidden />
        Mute
      </button>
    </div>
  );
}

export function SelfServeNarration({ script }: { script: string }) {
  const voice = useFeatureFlag("sync_voice_output");
  const [muted, setMuted] = useState(browserVoiceMuted);
  const workspaceVoice = voice.enabled && !voice.loading;
  const allowed = workspaceVoice && !muted;
  const setMute = (next: boolean) => {
    persistBrowserMute(next);
    setMuted(next);
  };
  const unavailable = voice.loading
    ? "Checking whether this workspace can speak. No speech request is made until voice is available."
    : !workspaceVoice
      ? "Voice is unavailable for this workspace. Talk me through it stays off, and no speech request is made."
      : "Narration is muted in this browser. Unmute to turn Talk me through it on when this workspace allows voice. No speech request is made while muted.";

  return (
    <div
      className="max-w-sm"
      data-testid="self-serve-narration"
      data-voice-allowed={allowed ? "true" : "false"}
    >
      {allowed ? (
        <NarrationControls script={script} onMute={() => setMute(true)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            aria-pressed="false"
            aria-describedby="self-serve-narration-off"
            data-testid="self-serve-narration-toggle"
            className={controlClass}
          >
            <Volume2 className="h-4 w-4" aria-hidden />
            Talk me through it
          </button>
          <button
            type="button"
            data-testid="self-serve-narration-stop"
            aria-pressed={muted}
            className={controlClass}
            onClick={() => setMute(!muted)}
          >
            <VolumeX className="h-4 w-4" aria-hidden />
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      )}
      {allowed ? null : (
        <p
          id="self-serve-narration-off"
          data-testid="self-serve-narration-off"
          className="mt-1 text-sm leading-relaxed text-slate-200"
        >
          {unavailable}
        </p>
      )}
    </div>
  );
}
