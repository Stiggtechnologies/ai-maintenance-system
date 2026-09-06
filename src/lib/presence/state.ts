/**
 * Meet Sync presence phases — driven by real conversation signals.
 *
 * This is a Sync-branded face contract, not a vendored visualizer.
 * Recommend ≠ authorize. No plant execute.
 */

export const PRESENCE_PHASES = [
  "idle",
  "listening",
  "thinking",
  "speaking",
] as const;

export type PresencePhase = (typeof PRESENCE_PHASES)[number];

export interface PresenceSignals {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
}

/**
 * Listening wins so hold-to-talk can barge in on TTS.
 * Thinking wins over speaking so the face does not stay on a finished line
 * while the Reliability Engineer ask is still in flight.
 */
export function derivePresencePhase(signals: PresenceSignals): PresencePhase {
  if (signals.listening) return "listening";
  if (signals.thinking) return "thinking";
  if (signals.speaking) return "speaking";
  return "idle";
}

export function presencePhaseLabel(phase: PresencePhase): string {
  switch (phase) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    default:
      return "Idle";
  }
}
