/**
 * Thin signed-in presence welcome — capability test, not a meeting runner.
 *
 * Speaks a Reliability Engineer / Decision Case greeting via the browser
 * Web Speech adapter when sync_voice_output is enabled (same contract as
 * CopilotDock). Optionally shows 1–3 live KPI lines from the existing
 * get_kpi_dashboard contract. This is not OpenClaw, SIR, JAVIS, a gateway,
 * or a parallel orchestrator. It does not execute plant actions.
 * Recommend ≠ authorize.
 */
import { formatKpiValue, type KpiRow } from "../../services/kpiService";

export const PRESENCE_MUTE_STORAGE_KEY = "syncai.presence.muted";
export const PRESENCE_SESSION_KEY_PREFIX = "syncai.presence.welcomed:";

export const UNNAMED_SPOKEN_WELCOME =
  "Welcome. I'm Sync, Reliability Engineer. What Decision Case or plant subject should we work on? I recommend; I do not authorize.";

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

export function buildSpokenWelcome(givenName: string | null): string {
  if (!givenName) return UNNAMED_SPOKEN_WELCOME;
  return `Welcome ${givenName}. I'm Sync, Reliability Engineer. What Decision Case or plant subject should we work on? I recommend; I do not authorize.`;
}

export function shouldSpeakWelcome(input: {
  signedIn: boolean;
  muted: boolean;
  alreadyWelcomedThisSession: boolean;
  voiceOutputEnabled: boolean;
}): boolean {
  return (
    input.signedIn &&
    !input.muted &&
    !input.alreadyWelcomedThisSession &&
    input.voiceOutputEnabled
  );
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
