/**
 * Signed-in Meet Sync presence welcome.
 *
 * Speaks a Reliability Engineer greeting via useSpeechOutput (cloud
 * `sync-tts` when configured, browser speechSynthesis otherwise) when the
 * user is not muted. Tenant `sync_voice_output` still gates CopilotDock;
 * Meet Sync does not wait on that flag so the booth can be used. Mute is
 * the presence off-switch. KPI lines stay text-only and never invent plant
 * readings. Recommend ≠ authorize. No plant execute.
 */
import { formatKpiValue, type KpiRow } from "../../services/kpiService";
import { describePresenceWork, type PresenceWorkingSubject } from "./memory";

export const PRESENCE_MUTE_STORAGE_KEY = "syncai.presence.muted";
export const PRESENCE_SESSION_KEY_PREFIX = "syncai.presence.welcomed:";

export const UNNAMED_SPOKEN_WELCOME = buildSpokenWelcome(null);

export const HONEST_EMPTY_BRIEF = [
  "No sourced KPI values are available yet.",
  "This welcome does not report plant state.",
  "Recommend is not authorize — no plant action is taken.",
] as const;

export function resolveWelcomeGivenName(input: {
  fullName?: string | null;
  metadataName?: string | null;
}): string | null {
  const raw =
    firstUsableName(input.fullName) ?? firstUsableName(input.metadataName);
  if (!raw) return null;
  const given = raw.trim().split(/\s+/)[0];
  if (!given || given.length < 2) return null;
  return given;
}

export function buildSpokenWelcome(
  givenName: string | null,
  subject: PresenceWorkingSubject | null = null,
): string {
  const nameBit = givenName ? `Welcome ${givenName}.` : "Welcome.";
  return `${nameBit} I'm Sync, your Reliability Engineer. ${describePresenceWork(subject)} I recommend, I do not authorize.`;
}

export function shouldSpeakWelcome(input: {
  signedIn: boolean;
  muted: boolean;
  alreadyWelcomedThisSession: boolean;
  /** Documented CopilotDock gate. Meet Sync speaks when unmuted. */
  voiceOutputEnabled?: boolean;
}): boolean {
  return input.signedIn && !input.muted && !input.alreadyWelcomedThisSession;
}

/**
 * Honesty for the presence strip. Cloud voice is named only when the
 * signed-in `sync-tts` probe reported a configured key. Otherwise the
 * copy stays on browser speech and never claims premium quality.
 */
export function describePresenceVoiceHonesty(input: {
  voiceOutputReady: boolean;
  voiceOutputEnabled: boolean;
  speechEngine: "unknown" | "cloud" | "browser";
}): string {
  const cloud = input.speechEngine === "cloud";
  const voice = cloud
    ? "Meet Sync uses a configured cloud voice when unmuted."
    : "Meet Sync uses browser speech when unmuted.";
  if (!input.voiceOutputReady) {
    return `${voice} Not autonomous control. Recommend is not authorize.`;
  }
  if (input.voiceOutputEnabled) {
    return cloud
      ? `${voice} Tenant Voice output (\`sync_voice_output\`) is also on for CopilotDock. Recommend is not authorize.`
      : "Meet Sync browser TTS. Tenant Voice output (`sync_voice_output`) is also on for CopilotDock. Recommend is not authorize.";
  }
  return `${voice} Tenant Voice output (\`sync_voice_output\`) still gates CopilotDock — enable it in Settings → Sync. Recommend is not authorize.`;
}

export function selectPresenceBriefLines(
  kpis: KpiRow[] | null | undefined,
  options?: { unavailable?: boolean },
): string[] {
  if (options?.unavailable || kpis == null) {
    return [...HONEST_EMPTY_BRIEF];
  }

  const live = kpis.filter((row) => row.value != null).slice(0, 3);
  if (live.length === 0) {
    return [...HONEST_EMPTY_BRIEF];
  }

  return live.map((row) => {
    const value = formatKpiValue(row);
    return row.source_note
      ? `${row.name}: ${value} (${row.source_note})`
      : `${row.name}: ${value}`;
  });
}

export function presenceSessionStorageKey(userId: string): string {
  return `${PRESENCE_SESSION_KEY_PREFIX}${userId}`;
}

export function readMutePreference(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(PRESENCE_MUTE_STORAGE_KEY) === "1";
}

export function writeMutePreference(
  storage: Pick<Storage, "setItem">,
  muted: boolean,
): void {
  storage.setItem(PRESENCE_MUTE_STORAGE_KEY, muted ? "1" : "0");
}

export function hasSessionWelcome(
  storage: Pick<Storage, "getItem">,
  userId: string,
): boolean {
  if (!userId) return false;
  return storage.getItem(presenceSessionStorageKey(userId)) === "1";
}

export function markSessionWelcome(
  storage: Pick<Storage, "setItem">,
  userId: string,
): void {
  storage.setItem(presenceSessionStorageKey(userId), "1");
}

function firstUsableName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Email local-parts are not a reliable given name. Do not guess.
  if (trimmed.includes("@")) return null;
  return trimmed;
}
