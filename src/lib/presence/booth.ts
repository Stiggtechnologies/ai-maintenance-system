/**
 * Thin booth-conversation framing for the signed-in presence strip.
 *
 * Meet Sync speaks as Sync, Reliability Engineer. Answers go through the
 * existing ai-agent-processor ReliabilityAgent path. Session + Decision Case
 * continuity comes from Sync stores, not a vault. This is not OpenClaw,
 * SIR, JAVIS, a gateway, or a meeting runner. Recommend ≠ authorize.
 * No plant execute. Honest when no plant data is in the welcome brief.
 */

export const BOOTH_UNAVAILABLE_REPLY =
  "Live analysis is unavailable right now. This conversation does not invent plant state, and no plant action is taken. Recommend is not authorize.";

export const RECOMMEND_AUTHORIZE_SPOKEN = "Recommend is not authorize.";

export const BOOTH_FRAMING = [
  "You are Sync, Reliability Engineer, in a short Meet Sync conversation with a maintenance or reliability leader.",
  "Speak as industrial decision support only. Recommend is not authorize. Do not execute plant actions.",
  "Continue the named subject and Decision Case context below. Do not transfer facts from a demo or seed case. If the context says no sourced KPI values are available, or no decision case is selected, say that plainly and do not invent readings, OEE, downtime, or asset health.",
  "Keep the answer short enough to speak aloud (a few sentences). Name uncertainty. Do not claim autonomous control.",
  "End with the reminder that recommend is not authorize.",
].join(" ");

export function buildBoothAskQuery(input: {
  question: string;
  briefLines: string[];
  givenName: string | null;
  namedSubject?: string | null;
  sessionTurns?: Array<{ role: "user" | "sync"; text: string }>;
  decisionLines?: string[];
}): string {
  const question = input.question.trim().slice(0, 2400);
  const context =
    input.briefLines.length > 0
      ? input.briefLines.join("\n")
      : "No sourced KPI values are available yet.";
  const visitor = input.givenName
    ? `Visitor given name: ${input.givenName}.`
    : "Visitor given name is not known — do not invent one.";
  const subject = input.namedSubject?.trim()
    ? `Named subject (session): ${input.namedSubject.trim()}. Continue this subject unless the visitor names a different one.`
    : "No named subject is stored yet. If the visitor names an asset, site, or decision, treat it as the working subject.";
  const decision =
    input.decisionLines && input.decisionLines.length > 0
      ? input.decisionLines.join("\n")
      : "No decision case is selected.";
  const turns = (input.sessionTurns ?? [])
    .slice(-4)
    .map((turn) => `${turn.role === "user" ? "Visitor" : "Sync"}: ${turn.text}`)
    .join("\n");
  return [
    BOOTH_FRAMING,
    visitor,
    subject,
    "DECISION CASE:",
    decision,
    "LIVE CONTEXT:",
    context,
    turns ? `SESSION TURNS:\n${turns}` : "SESSION TURNS: none yet.",
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

export function withRecommendAuthorize(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return RECOMMEND_AUTHORIZE_SPOKEN;
  if (/recommend is not authorize/i.test(trimmed)) return trimmed;
  return `${trimmed} ${RECOMMEND_AUTHORIZE_SPOKEN}`;
}

export function spokenBoothReply(text: string, maxChars = 420): string {
  return stripForSpeech(withRecommendAuthorize(text), maxChars);
}
