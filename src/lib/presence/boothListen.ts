/**
 * Meet Sync booth listen policy.
 *
 * Default is continuous listen (browser speech + end-of-utterance), not
 * hold-to-talk. Hold-to-talk is an optional booth toggle. Recognition is
 * paused while Sync is speaking (cloud or browser TTS) plus a short settle
 * so the booth does not treat its own voice as a user turn. Mic blocked is
 * honest: typed Ask remains. Recommend ≠ authorize. No plant execute.
 */

export const PRESENCE_HOLD_TO_TALK_KEY = "syncai.presence.holdToTalk";

/** Silence after the last speech result before a continuous utterance is sent. */
export const BOOTH_UTTERANCE_SILENCE_MS = 800;

/**
 * Recognition stay-down after TTS ends so room echo / late SpeechRecognition
 * finals are not treated as a user turn. Continuous listen stays the default;
 * only the engine is paused.
 */
export const BOOTH_TTS_SETTLE_MS = 450;

/** Keep last spoken text briefly so late STT finals of TTS are still dropped. */
export const BOOTH_ECHO_MEMORY_MS = 2000;

const MIN_ECHO_CHARS = 10;

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

export function isBoothTtsActive(input: {
  speaking?: boolean;
  settling?: boolean;
  outputGating?: boolean;
}): boolean {
  return Boolean(input.speaking || input.settling || input.outputGating);
}

export function normalizeBoothHeardText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when recognition likely heard Sync's own TTS rather than a new turn.
 * Exact and near-substring matches first; token overlap covers noisy STT.
 */
export function isSelfEchoTranscript(
  heard: string,
  lastSpoken: string | null | undefined,
): boolean {
  const a = normalizeBoothHeardText(heard);
  const b = normalizeBoothHeardText(lastSpoken ?? "");
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= MIN_ECHO_CHARS && b.includes(a)) return true;
  if (b.length >= MIN_ECHO_CHARS && a.includes(b)) return true;

  const heardTokens = a.split(" ").filter((token) => token.length > 2);
  const spokenTokens = new Set(
    b.split(" ").filter((token) => token.length > 2),
  );
  if (heardTokens.length < 3 || spokenTokens.size < 3) return false;
  const overlap = heardTokens.filter((token) => spokenTokens.has(token)).length;
  return overlap >= 3 && overlap / heardTokens.length >= 0.72;
}

/**
 * Continuous listen must not create a user turn while Sync is speaking,
 * during the post-TTS settle, or when the transcript matches the last line.
 */
export function shouldTreatHeardSpeechAsUserTurn(input: {
  speaking?: boolean;
  settling?: boolean;
  outputGating?: boolean;
  transcript?: string;
  lastSpokenText?: string | null;
}): boolean {
  if (isBoothTtsActive(input)) return false;
  if (
    input.transcript &&
    isSelfEchoTranscript(input.transcript, input.lastSpokenText)
  ) {
    return false;
  }
  return true;
}

export function shouldAutoListen(input: {
  muted: boolean;
  holdToTalk: boolean;
  supported: boolean;
  busy: boolean;
  micPermission: BoothMicPermission;
  speaking?: boolean;
  settling?: boolean;
  outputGating?: boolean;
}): boolean {
  return (
    !input.muted &&
    !input.holdToTalk &&
    input.supported &&
    !input.busy &&
    !isBoothTtsActive(input) &&
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
  settling?: boolean;
  outputGating?: boolean;
  lastSpokenText?: string | null;
}): boolean {
  return (
    !input.holdToTalk &&
    !input.busy &&
    shouldTreatHeardSpeechAsUserTurn(input) &&
    input.transcript.trim().length > 0 &&
    input.silenceMs >= BOOTH_UTTERANCE_SILENCE_MS
  );
}

export function isMicBlockedError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /microphone access (was |is )?blocked/i.test(error);
}
