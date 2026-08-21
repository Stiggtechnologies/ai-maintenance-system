export type SyncResponseMode = "conversation" | "engineering" | "deliverable";

const DELIVERABLE_RE =
  /\b(complete|produce|create|build|generate|develop|prepare|draft|perform|write)\b[\s\S]{0,140}\b(fmea|fmeca|rca|fracas|rcm|register|assessment|analysis|packet|report|plan|study|review|procedure|strategy)\b/i;

function isLightweightConversation(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  return (
    /^(hi|hello|hey|good morning|good afternoon|good evening)[!.?]*$/.test(normalized) ||
    /^(thanks|thank you|thank you very much)[!.?]*$/.test(normalized) ||
    /^(help|what can you do|what can you do for me|how can you help|how can you help me)[!.?]*$/.test(normalized)
  );
}

export function classifySyncResponseMode(question: string): SyncResponseMode {
  if (DELIVERABLE_RE.test(question)) return "deliverable";
  if (isLightweightConversation(question)) return "conversation";
  return "engineering";
}

export function buildSyncResponsePolicy(question: string): {
  mode: SyncResponseMode;
  directive: string;
  maxTokens: number;
} {
  const mode = classifySyncResponseMode(question);
  if (mode === "conversation") {
    return {
      mode,
      maxTokens: 700,
      directive: `RESPONSE MODE — CONVERSATIONAL (SERVER POLICY):
Respond naturally and briefly to the user's immediate intent. Do not launch an unsolicited KPI review, operational assessment, formal report, or long capability list. Offer one useful next direction only when it helps.`,
    };
  }
  if (mode === "deliverable") {
    return {
      mode,
      maxTokens: 12_000,
      directive: `RESPONSE MODE — COMPLETE WORK PRODUCT (SERVER POLICY):
Produce the complete requested deliverable now. Preserve governed Reliability Engineer discipline: separate facts, hypotheses and missing evidence; make assumptions and approval boundaries explicit; cite supplied evidence labels for material claims; define owners and verification where relevant. Use headings, lists and tables only when they improve the work product.`,
    };
  }
  return {
    mode,
    maxTokens: 2_200,
    directive: `RESPONSE MODE — ENGINEERING CONVERSATION (SERVER POLICY):
Answer the user's decision or conclusion in the first one or two sentences. Then include only decision-relevant facts, uncertainty, evidence and the next action needed to support it. Prefer three to five concise bullets over a report-shaped response. Do not repeat facts already established unless they changed or directly support the current decision. Cite supplied evidence labels next to material claims. Offer deeper analysis instead of expanding automatically into a formal report.`,
  };
}
