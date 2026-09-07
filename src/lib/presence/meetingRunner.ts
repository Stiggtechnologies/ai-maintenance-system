/**
 * Meet Sync Stage B — room turn-taking on the signed-in presence strip.
 *
 * Speak-first booth is the on-ramp. This runner decides whether Sync
 * should speak or keep listening. Answers still go through askBooth →
 * ReliabilityAgent. Not a parallel chat stack, not CopilotDock
 * sync_meeting_mode, not speaker diarization, not AGPL.
 * Recommend ≠ authorize. No plant execute. Silence is not consensus.
 */

import {
  shouldTreatHeardSpeechAsUserTurn,
} from "./boothListen";

export type RoomChannel = "typed" | "hold-to-talk" | "continuous";

export type RoomIntent =
  | "addressed"
  | "asked"
  | "invited"
  | "wrap"
  | "hold";

export type RoomAction = "speak" | "hold";

export interface RoomTurnDecision {
  action: RoomAction;
  intent: RoomIntent;
  reason: string;
}

export const ROOM_HOLD_COPY =
  "Listening — Sync did not interrupt. Speak to Sync or ask when you want a contribution.";

export const ROOM_FACILITATION = [
  "This is a multi-turn Meet Sync room, not a one-shot booth Q&A.",
  "Act as a facilitator and technical participant, never as the meeting's authority.",
  "Separate confirmed facts, hypotheses, proposals, decisions explicitly made by participants, unresolved disagreement, actions and owners, and missing evidence.",
  "Do not infer speaker identity from voice or text. Do not treat silence or lack of objection as consensus.",
  "If this turn is a recap, keep spoken sections short: Decisions explicitly made; Dissent / unresolved; Actions and owners; Evidence needed.",
].join(" ");

const ADDRESSED =
  /\b(?:hey |ok |okay |hi )?sync\b|\bsync[,:]|\bsync['’]s\b/i;
const INVITED =
  /\b(?:jump in|weigh in|your take|your view|what do you think|what would you (?:say|recommend)|can you (?:add|weigh|facilitate|help|recap)|please (?:add|facilitate|help)|facilitate)\b/i;
const WRAP =
  /\b(?:recap|wrap up|summarize|summary|action items?|what did we (?:decide|agree)|decisions so far|where we landed)\b/i;
const STUCK =
  /\b(?:what are we missing|we(?:'re| are) stuck|we don'?t have (?:the )?data|need (?:a )?recommendation|missing evidence)\b/i;
const ACK =
  /^(?:yeah|yep|yes|ok|okay|right|thanks|thank you|got it|agreed|agree|mm-?hmm|uh-huh|cool|sure|alright|all right)(?:[.!]|\s+(?:yeah|ok|okay|thanks|got it|right))*\s*$/i;
const QUESTION =
  /\?|^\s*(?:what|why|how|when|where|should|can|could|would|is|are|do|does|did|who)\b/i;
const SHORT_ASK =
  /^\s*(?:what|why|how|when|where|should|can|could|would|is|are|do|does|did|who)\b/i;
const DOMAIN =
  /\b(?:backlog|oee|mtbf|mttr|downtime|vibration|bearing|crusher|mill|asset|work order|emergency work|failure|reliability|maintenance|inspection|shutdown|outage|spare|wear|temperature|alarm|fault|kpi|decision case|evidence|root cause|rca|availability|trending)\b/i;
/**
 * 1:1 Meet Sync audio / presence checks. SpeechRecognition almost never
 * includes a `?`, so "Can you hear me" must not fall through as chatter.
 */
const SYNC_DIRECTED =
  /\b(?:can you hear|could you hear|are you (?:there|listening)|(?:i|we) can(?:no)?['’]?t hear(?: you)?|(?:i|we) cannot hear(?: you)?|hello(?: there)?|hi sync|you there)\b/i;

export function isSyncDirectedUtterance(text: string): boolean {
  return SYNC_DIRECTED.test(text.trim());
}

export function classifyRoomUtterance(text: string): RoomIntent {
  const trimmed = text.trim();
  if (!trimmed) return "hold";
  if (ADDRESSED.test(trimmed)) return "addressed";
  if (INVITED.test(trimmed)) return "invited";
  if (WRAP.test(trimmed)) return "wrap";
  if (STUCK.test(trimmed)) return "asked";
  if (isSyncDirectedUtterance(trimmed)) return "asked";
  if (ACK.test(trimmed) && trimmed.length < 40) return "hold";
  if (isRoomQuestion(trimmed)) return "asked";
  return "hold";
}

export function decideRoomTurn(input: {
  text: string;
  channel: RoomChannel;
  speaking?: boolean;
  settling?: boolean;
  outputGating?: boolean;
  lastSpokenText?: string | null;
}): RoomTurnDecision {
  if (
    !shouldTreatHeardSpeechAsUserTurn({
      speaking: input.speaking,
      settling: input.settling,
      outputGating: input.outputGating,
      transcript: input.text,
      lastSpokenText: input.lastSpokenText,
    })
  ) {
    return { action: "hold", intent: "hold", reason: "tts_or_echo" };
  }

  const text = input.text.trim();
  if (!text) {
    return { action: "hold", intent: "hold", reason: "empty" };
  }

  const intent = classifyRoomUtterance(text);
  if (input.channel === "typed" || input.channel === "hold-to-talk") {
    return {
      action: "speak",
      intent: intent === "hold" ? "asked" : intent,
      reason: "explicit_ask",
    };
  }

  if (intent === "hold") {
    return { action: "hold", intent, reason: "room_continues" };
  }
  return { action: "speak", intent, reason: `continuous_${intent}` };
}

export function shouldSpeakRoomTurn(decision: RoomTurnDecision): boolean {
  return decision.action === "speak";
}

export function roomSessionLineLimit(): number {
  return 8;
}

function isRoomQuestion(text: string): boolean {
  if (!QUESTION.test(text)) return false;
  if (DOMAIN.test(text)) return true;
  if (isSyncDirectedUtterance(text)) return true;
  if (text.includes("?") && text.length >= 18) return true;
  if (text.length >= 28) return true;
  // 1:1 booth: a short interrogative is for Sync. STT rarely adds `?`.
  const normalized = text.replace(/\s+/g, " ").trim();
  return SHORT_ASK.test(normalized) && normalized.length >= 12;
}
