/**
 * Sync-branded presence face — idle / listening / thinking / speaking.
 *
 * Concentric telemetry rings, not a circuit-board clone. Driven only by
 * derivePresencePhase() from real conversation signals.
 */
import { presencePhaseLabel, type PresencePhase } from "../lib/presence/state";

interface PresenceFaceProps {
  phase: PresencePhase;
  size?: "sm" | "md";
}

export function PresenceFace({ phase, size = "sm" }: PresenceFaceProps) {
  const dimension = size === "md" ? "h-16 w-16" : "h-10 w-10";
  return (
    <div
      data-testid="presence-face"
      data-presence-phase={phase}
      role="img"
      aria-label={`Sync presence ${presencePhaseLabel(phase).toLowerCase()}`}
      className={`presence-face presence-face--${phase} ${dimension} relative shrink-0`}
    >
      <span className="presence-face__ring presence-face__ring--outer" />
      <span className="presence-face__ring presence-face__ring--mid" />
      <span className="presence-face__core" />
      <span className="presence-face__bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
