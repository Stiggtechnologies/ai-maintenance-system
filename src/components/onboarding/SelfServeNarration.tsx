/**
 * Optional step narration for the self-serve Get started path.
 * Off until the visitor turns it on. Mute stops cloud or browser speech.
 * Reuses useSpeechOutput (sync-tts when signed in) and stripForSpeech.
 */
import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useSpeechOutput } from "../../hooks/useSpeechOutput";
import { stripForSpeech } from "../../../supabase/functions/_shared/sync-tts-core";

export function SelfServeNarration({ script }: { script: string }) {
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
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="self-serve-narration"
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
