/**
 * Meet Sync spoken-turn fast path.
 *
 * Presence checks, greetings, and short social turns must not wait on
 * Decision Case packing, vault I/O, or ai-agent-processor. Real
 * reliability questions stay on askBooth → ReliabilityAgent.
 * Local replies never invent plant state. Recommend ≠ authorize.
 */

import { isGreetingPrompt } from "../decision-case-honesty";
import { isSyncDirectedUtterance } from "./meetingRunner";

/** Silence after a complete short presence/greeting before auto-send. */
export const BOOTH_SHORT_UTTERANCE_SILENCE_MS = 400;

export type BoothFastPathKind = "presence" | "greeting" | "social";

export interface BoothFastPath {
  kind: BoothFastPathKind;
  reply: string;
  persistDurable: false;
}

const AUDIO_CHECK =
  /\b(?:can you hear|could you hear|are you (?:there|listening)|(?:i|we) can(?:no)?['’]?t hear(?: you)?|(?:i|we) cannot hear(?: you)?|you there)\b/i;

const BARE_GREETING =
  /^(?:(?:hey|hi|hello|good (?:morning|afternoon|evening))(?:\s+there)?(?:\s+sync)?|sync(?:[,.]|\s+there)?)\s*[.!]?\s*$/i;

const SHORT_SOCIAL =
  /^(?:yeah|yep|yes|ok|okay|right|thanks|thank you|got it|agreed|agree|mm-?hmm|uh-huh|cool|sure|alright|all right)(?:[.!]| i agree|\s+(?:yeah|ok|okay|thanks|got it|right|sync|i agree|i got it))*\s*$/i;

const RELIABILITY_PAYLOAD =
  /\b(?:backlog|oee|mtbf|mttr|downtime|vibration|bearing|crusher|mill|asset|work order|emergency work|failure|reliability|maintenance|inspection|shutdown|outage|spare|wear|temperature|alarm|fault|kpi|decision case|evidence|root cause|rca|availability|trending|recap|wrap up|summarize|action items?|weigh in|jump in|what do you think)\b/i;

export const FAST_PRESENCE_HEAR_REPLY = "Yes. I can hear you.";
export const FAST_PRESENCE_CANT_HEAR_REPLY =
  "I can hear you. If my voice is quiet, check your speaker volume or unmute.";
export const FAST_PRESENCE_HERE_REPLY = "I'm here and listening.";
export const FAST_GREETING_REPLY = "Hello. I'm listening.";
export const FAST_THANKS_REPLY = "You're welcome.";
export const FAST_SOCIAL_REPLY = "Understood. I'm listening.";

export function utteranceHasReliabilityPayload(text: string): boolean {
  return RELIABILITY_PAYLOAD.test(text);
}

export function isPresenceAudioCheck(text: string): boolean {
  return AUDIO_CHECK.test(text.trim());
}

export function isBarePresenceGreeting(text: string): boolean {
  const trimmed = text.trim();
  return isGreetingPrompt(trimmed) || BARE_GREETING.test(trimmed);
}

export function isShortSocialTurn(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < 40 && SHORT_SOCIAL.test(trimmed);
}

/**
 * True when the transcript is already a complete trivial turn, so the
 * booth can commit after a shorter silence without clipping a longer ask.
 */
export function isCompleteTrivialPresenceTurn(text: string): boolean {
  return resolveBoothFastPath(text) !== null;
}

export function boothCommitSilenceMs(
  transcript: string,
  defaultSilenceMs: number,
  shortSilenceMs = BOOTH_SHORT_UTTERANCE_SILENCE_MS,
): number {
  return isCompleteTrivialPresenceTurn(transcript)
    ? shortSilenceMs
    : defaultSilenceMs;
}

export function resolveBoothFastPath(
  text: string,
  givenName: string | null = null,
): BoothFastPath | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (utteranceHasReliabilityPayload(trimmed)) return null;

  if (isPresenceAudioCheck(trimmed)) {
    return {
      kind: "presence",
      reply: presenceReply(trimmed),
      persistDurable: false,
    };
  }

  if (isBarePresenceGreeting(trimmed) || greetingOnlyDirected(trimmed)) {
    return {
      kind: "greeting",
      reply: greetingReply(givenName),
      persistDurable: false,
    };
  }

  if (isShortSocialTurn(trimmed)) {
    return {
      kind: "social",
      reply: socialReply(trimmed),
      persistDurable: false,
    };
  }

  return null;
}

function greetingOnlyDirected(text: string): boolean {
  if (!isSyncDirectedUtterance(text)) return false;
  if (isPresenceAudioCheck(text)) return false;
  return !utteranceHasReliabilityPayload(text);
}

function presenceReply(text: string): string {
  const lower = text.toLowerCase();
  if (/can(?:no)?['’]?t hear|cannot hear/.test(lower)) {
    return FAST_PRESENCE_CANT_HEAR_REPLY;
  }
  if (/can you hear|could you hear/.test(lower)) {
    return FAST_PRESENCE_HEAR_REPLY;
  }
  return FAST_PRESENCE_HERE_REPLY;
}

function greetingReply(givenName: string | null): string {
  const name = givenName?.trim();
  if (name && name.length >= 2) {
    return `Hello ${name}. I'm listening.`;
  }
  return FAST_GREETING_REPLY;
}

function socialReply(text: string): string {
  return /thanks|thank you/i.test(text) ? FAST_THANKS_REPLY : FAST_SOCIAL_REPLY;
}
