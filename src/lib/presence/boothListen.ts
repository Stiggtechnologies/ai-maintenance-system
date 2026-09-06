/**
 * Meet Sync booth listen policy.
 *
 * Default is continuous listen (browser speech + end-of-utterance), not
 * hold-to-talk. Hold-to-talk is an optional booth toggle. Mic blocked is
 * honest: typed Ask remains. Recommend ≠ authorize. No plant execute.
 */

export const PRESENCE_HOLD_TO_TALK_KEY = "syncai.presence.holdToTalk";

/** Silence after the last speech result before a continuous utterance is sent. */
export const BOOTH_UTTERANCE_SILENCE_MS = 800;

/** Delay before restarting SpeechRecognition after the browser ends a session. */
export const BOOTH_LISTEN_RESTART_MS = 150;

export const MIC_BLOCKED_COPY =
  "Microphone access is blocked. Enable the microphone in your browser site settings to talk with Sync, or type your question below.";

export const MIC_UNSUPPORTED_COPY =
  "This browser has no speech recognition. Type your question, or use Chrome, Edge, or Safari.";

export type BoothVoiceMode = "continuous" | "hold-to-talk";

export type BoothMicPermission =
  "unknown" | "granted" | "denied" | "unsupported";

export function defaultBoothVoiceMode(): BoothVoiceMode {
  return "continuous";
}

export function readHoldToTalkPreference(storage: Storage): boolean {
  return storage.getItem(PRESENCE_HOLD_TO_TALK_KEY) === "1";
}

export function writeHoldToTalkPreference(
  storage: Storage,
  holdToTalk: boolean,
): void {
  if (holdToTalk) storage.setItem(PRESENCE_HOLD_TO_TALK_KEY, "1");
  else storage.removeItem(PRESENCE_HOLD_TO_TALK_KEY);
}

export function boothVoiceMode(holdToTalk: boolean): BoothVoiceMode {
  return holdToTalk ? "hold-to-talk" : "continuous";
}

export function shouldAutoListen(input: {
  muted: boolean;
  holdToTalk: boolean;
  supported: boolean;
  busy: boolean;
  micPermission: BoothMicPermission;
}): boolean {
  return (
    !input.muted &&
    !input.holdToTalk &&
    input.supported &&
    !input.busy &&
    input.micPermission !== "denied" &&
    input.micPermission !== "unsupported"
  );
}

export function shouldCommitContinuousUtterance(input: {
  transcript: string;
  silenceMs: number;
  speaking: boolean;
  busy: boolean;
  holdToTalk: boolean;
}): boolean {
  return (
    !input.holdToTalk &&
    !input.busy &&
    !input.speaking &&
    input.transcript.trim().length > 0 &&
    input.silenceMs >= BOOTH_UTTERANCE_SILENCE_MS
  );
}

export function isMicBlockedError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /microphone access (was |is )?blocked/i.test(error);
}
