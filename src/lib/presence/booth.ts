/**
 * Thin booth-conversation framing for the signed-in presence strip.
 *
 * Meet Sync speaks as Sync, the Reliability Engineer. Answers go through
 * the existing ai-agent-processor ReliabilityAgent path. Decision Case
 * context and Meet Sync session memory are appended when present.
 * This is not OpenClaw, SIR, JAVIS, a gateway, or a meeting runner.
 * Recommend ≠ authorize. No plant execute.
 */

export const BOOTH_UNAVAILABLE_REPLY =
  "Live analysis is unavailable right now. This conversation does not invent plant state, and no plant action is taken.";

export const BOOTH_FRAMING = [
  "You are Sync, the Reliability Engineer, in a short Meet Sync booth conversation.",
  "Speak as decision support only. Recommend is not authorize. Do not execute plant actions.",
  "Stay in maintenance, reliability, and industrial Decision Case work. Do not become a generic desktop assistant.",
  "Use only the LIVE CONTEXT, DECISION CASE, and SESSION MEMORY below plus the visitor's question.",
  "If no Decision Case is bound, treat named subjects as provisional and do not invent a demo or reference case.",
  "If the context says no sourced KPI values are available, say that plainly and do not invent readings, OEE, downtime, or asset health.",
  "Keep the answer short enough to speak aloud (a few sentences). Name uncertainty. Do not claim autonomous control.",
  "Speak as a professional meeting moderator: contribute when asked or when a short clarification helps. Do not be cheeky or performative.",
].join(" ");

export function buildBoothAskQuery(input: {
  question: string;
  briefLines: string[];
  givenName: string | null;
  caseContextLines?: string[];
  sessionLines?: string[];
}): string {
  const question = input.question.trim().slice(0, 2400);
  const context =
    input.briefLines.length > 0
      ? input.briefLines.join("\n")
      : "No sourced KPI values are available yet.";
  const visitor = input.givenName
    ? `Visitor given name: ${input.givenName}.`
    : "Visitor given name is not known — do not invent one.";
  const caseBlock =
    input.caseContextLines && input.caseContextLines.length > 0
      ? input.caseContextLines.join("\n")
      : "No decision case is selected.";
  const sessionBlock =
    input.sessionLines && input.sessionLines.length > 0
      ? input.sessionLines.join("\n")
      : "No prior Meet Sync turns in this session.";
  return [
    BOOTH_FRAMING,
    visitor,
    "LIVE CONTEXT:",
    context,
    "DECISION CASE:",
    caseBlock,
    "SESSION MEMORY (signed-in Meet Sync notes when available; tab cache otherwise. Not authorization.):",
    sessionBlock,
    `QUESTION: ${question}`,
  ].join("\n");
}

export function shouldSpeakBoothReply(input: {
  signedIn: boolean;
  muted: boolean;
  /** Documented CopilotDock gate. Meet Sync speaks when unmuted. */
  voiceOutputEnabled?: boolean;
}): boolean {
  return input.signedIn && !input.muted;
}

export {
  SYNC_TTS_MAX_CHARS,
  stripForSpeech,
} from "../../../supabase/functions/_shared/sync-tts-core";
