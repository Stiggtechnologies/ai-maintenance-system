/**
 * Sync-branded Meet Sync face. Phases are driven by real listen / think /
 * speak state — not a decorative loop and not third-party visualizer assets.
 */
import { presencePhaseLabel, type PresencePhase } from "../lib/presence/state";
import "./PresenceFace.css";

export function PresenceFace({ phase }: { phase: PresencePhase }) {
  return (
    <div
      data-testid="presence-face"
      data-presence-phase={phase}
      role="img"
      aria-label={`Sync presence: ${presencePhaseLabel(phase)}`}
      className="presence-face"
    >
      <span className="presence-face__ring" />
      <span className="presence-face__orbit" />
      <span className="presence-face__core" />
    </div>
  );
}
