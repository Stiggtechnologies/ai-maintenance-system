import { PresenceFace } from "./PresenceFace";
import { derivePresencePhase } from "../lib/presence/state";
import { useState } from "react";
import type { useSyncRealtimeVoice } from "../hooks/useSyncRealtimeVoice";
import { resolveWelcomeGivenName } from "../lib/presence/welcome";

interface Props {
  userId: string;
  organizationId: string;
  fullName?: string | null;
  enabled: boolean;
  voice: ReturnType<typeof useSyncRealtimeVoice>;
  onOpen: () => void;
}

/** Welcome is presentation on the canonical copilot, never a second assistant.
 * Only the authenticated profile's name is used. Legacy tab/plant memory is
 * deliberately excluded; facts and actions must go through ask_sync.
 */
export function SyncAssistantWelcome({
  userId,
  organizationId,
  fullName,
  enabled,
  voice,
  onOpen,
}: Props) {
  const scope = JSON.stringify([organizationId, userId]);
  const muteKey = `syncai.assistant.welcome.muted:${scope}`;
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(muteKey) === "1";
    } catch {
      return false;
    }
  });
  const givenName = resolveWelcomeGivenName({ fullName })?.slice(0, 60);
  const welcome = `${givenName ? `Welcome ${givenName}.` : "Welcome."} I'm Sync. I can help you think, plan, and work through questions. You can talk with me here, in chat, or in meetings. What would you like to work on?`;
  const start = voice.start;
  // Login and rerender never create a paid Realtime session. Voice starts
  // only through the existing explicit Play / Start conversation controls.

  if (!userId || !organizationId) return null;
  const active =
    voice.state === "connecting" ||
    voice.state === "live" ||
    voice.state === "ending";
  return (
    <section
      className="border-b border-white/5 bg-white/[0.02] px-4 py-2.5"
      data-testid="sync-assistant-welcome"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <PresenceFace
            phase={derivePresencePhase({
              listening: voice.state === "live" && !voice.welcomeOnly,
              thinking: voice.state === "connecting",
              speaking: voice.state === "live" && voice.welcomeOnly,
            })}
          />
          <p className="text-sm text-slate-100">{welcome}</p>
        </div>
        <div className="flex gap-2 text-xs text-slate-300">
          <button
            type="button"
            disabled={!enabled || muted || active}
            onClick={() => void start(welcome)}
            aria-label="Play welcome"
          >
            Play
          </button>
          <button
            type="button"
            onClick={() => {
              voice.stopWelcome();
              onOpen();
            }}
          >
            Talk with Sync
          </button>
          <button
            type="button"
            onClick={() => {
              voice.stopWelcome();
              try {
                localStorage.setItem(muteKey, muted ? "0" : "1");
              } catch {
                /* best effort */
              }
              setMuted(!muted);
            }}
          >
            {muted ? "Unmute welcome" : "Mute welcome"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500" aria-live="polite">
        {enabled
          ? voice.status
          : "Live voice is unavailable for this organization. You can still open chat."}{" "}
        {voice.welcomeOnly
          ? "Welcome playback uses OpenAI without microphone access."
          : active
            ? "Live voice uses your microphone when unmuted. Use Mute or End in the voice panel."
            : "Play welcome uses OpenAI without microphone access. Start conversation requests your microphone separately."}
      </p>
    </section>
  );
}
