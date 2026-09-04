/**
 * Thin booth-conversation framing for the signed-in presence strip.
 *
 * Trade-show "Meet Sync" with a VP of Maintenance. Answers go through the
 * existing ai-agent-processor ReliabilityAgent path. This is not OpenClaw,
 * SIR, JAVIS, a gateway, or a meeting runner. Recommend ≠ authorize.
 * No plant execute. Honest when no plant data is in the welcome brief.
 */

export const BOOTH_UNAVAILABLE_REPLY =
  "Live analysis is unavailable right now. This conversation does not invent plant state, and no plant action is taken.";

export const BOOTH_FRAMING = [
  "You are Sync in a short trade-show booth conversation with a VP of Maintenance (Meet Sync).",
  "Speak as decision support only. Recommend is not authorize. Do not execute plant actions.",
  "Use only the LIVE CONTEXT below plus the visitor's question. If the context says no sourced KPI values are available, say that plainly and do not invent readings, OEE, downtime, or asset health.",
  "Keep the answer short enough to speak aloud (a few sentences). Name uncertainty. Do not claim autonomous control.",
].join(" ");

export function buildBoothAskQuery(input: {
  question: string;
  briefLines: string[];
  givenName: string | null;
}): string {
  const question = input.question.trim().slice(0, 2400);
  const context =
    input.briefLines.length > 0
      ? input.briefLines.join("\n")
      : "No sourced KPI values are available yet.";
  const visitor = input.givenName
    ? `Visitor given name: ${input.givenName}.`
    : "Visitor given name is not known — do not invent one.";
  return [
    BOOTH_FRAMING,
    visitor,
    "LIVE CONTEXT:",
    context,
    `QUESTION: ${question}`,
  ].join("\n");
}

export function shouldSpeakBoothReply(input: {
  signedIn: boolean;
  muted: boolean;
  voiceOutputEnabled: boolean;
}): boolean {
  return input.signedIn && !input.muted && input.voiceOutputEnabled;
}

export function stripForSpeech(text: string, maxChars = 420): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
}
