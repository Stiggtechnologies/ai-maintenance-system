/**
 * Meet Sync presence phase — driven by real listen / ask / speech flags.
 *
 * This is a resolver over live UI state, not a decorative animation clock.
 * Recommend ≠ authorize. No plant execute. Not OpenClaw / JAVIS / SIR.
 */

export const PRESENCE_PHASES = [
  "idle",
  "listening",
  "thinking",
  "speaking",
] as const;

export type PresencePhase = (typeof PRESENCE_PHASES)[number];

export type PresenceEvent =
  | { type: "listen_start" }
  | { type: "listen_cancel" }
  | { type: "ask_start" }
  | { type: "reply_ready"; speak: boolean }
  | { type: "speech_end" }
  | { type: "reset" };

export interface PresenceFlags {
  listening: boolean;
  thinking: boolean;
  speaking: boolean;
}

/**
 * Priority: listening barges in, then thinking, then speaking, else idle.
 * A mute / voice-off reply is idle once thinking clears — no fake speaking.
 */
export function resolvePresencePhase(flags: PresenceFlags): PresencePhase {
  if (flags.listening) return "listening";
  if (flags.thinking) return "thinking";
  if (flags.speaking) return "speaking";
  return "idle";
}

export function reducePresencePhase(
  phase: PresencePhase,
  event: PresenceEvent,
): PresencePhase {
  switch (event.type) {
    case "listen_start":
      return "listening";
    case "listen_cancel":
      return phase === "listening" ? "idle" : phase;
    case "ask_start":
      return "thinking";
    case "reply_ready":
      return event.speak ? "speaking" : "idle";
    case "speech_end":
      return phase === "speaking" ? "idle" : phase;
    case "reset":
      return "idle";
    default:
      return phase;
  }
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
      return "Ready";
  }
}
