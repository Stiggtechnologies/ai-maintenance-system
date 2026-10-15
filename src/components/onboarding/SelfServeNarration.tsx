/**
 * Optional step narration for the self-serve Get started path.
 * Off until the visitor turns it on, and only when tenant Voice output is
 * enabled and this browser is not muted. Otherwise the speech hook is not
 * mounted, so no cloud TTS request is made.
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
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="self-serve-narration"
      data-voice-allowed="true"
    >
      <button
        type="button"
        data-testid="self-serve-narration-toggle"
        aria-pressed={enabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100"
        onClick={() => {
          if (enabled) {
            mute();
            return;
          }
          setEnabled(true);
        }}
      >
        <Volume2 className="h-3.5 w-3.5" aria-hidden />
        Talk me through it
      </button>
      <button
        type="button"
        data-testid="self-serve-narration-stop"
        aria-label="Stop narration"
        disabled={!enabled && !speaking}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
        onClick={mute}
      >
        <VolumeX className="h-3.5 w-3.5" aria-hidden />
        Mute
      </button>
    </div>
  );
}

export function SelfServeNarration({ script }: { script: string }) {
  const voice = useFeatureFlag("sync_voice_output");
  const [muted, setMuted] = useState(browserVoiceMuted);
  const allowed = voice.enabled && !voice.loading && !muted;
  const mute = () => {
    persistBrowserMute(true);
    setMuted(true);
  };

  if (!allowed) {
    return (
      <div
        className="max-w-xs"
        data-testid="self-serve-narration"
        data-voice-allowed="false"
      >
        <button
          type="button"
          disabled
          aria-pressed="false"
          aria-describedby="self-serve-narration-off"
          data-testid="self-serve-narration-toggle"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
        >
          <Volume2 className="h-3.5 w-3.5" aria-hidden />
          Talk me through it
        </button>
        <p
          id="self-serve-narration-off"
          data-testid="self-serve-narration-off"
          className="mt-1 text-xs leading-relaxed text-slate-400"
        >
          Spoken walkthrough is off. Voice output is disabled for this workspace
          or muted in this browser, so no speech request is made.
        </p>
      </div>
    );
  }

  return <NarrationControls script={script} onMute={mute} />;
}
