function isLightweightConversation(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  return (
    /^(hi|hello|hey|good morning|good afternoon|good evening)[!.?]*$/.test(
      normalized,
    ) ||
    /^(thanks|thank you)[!.?]*$/.test(normalized) ||
    /^(help|what can you do|what can you do for me|how can you help|how can you help me)[!.?]*$/.test(
      normalized,
    )
  );
}

export function syncResponseGuidance(
  question: string,
  deliverable: boolean,
): string {
  if (deliverable) {
    return `RESPONSE MODE — COMPLETE WORK PRODUCT:
Produce the complete requested deliverable now. Preserve the governed Reliability Engineer discipline: distinguish facts, hypotheses and missing evidence; make approval boundaries explicit; and define verification where relevant. Use headings, lists and tables only when they improve the work product.`;
  }

  if (isLightweightConversation(question)) {
    return `RESPONSE MODE — CONVERSATIONAL:
Respond naturally and briefly. Do not launch an unsolicited KPI review, operational assessment or formal report. Answer the user's immediate conversational intent first and offer one useful next direction only if it helps.`;
  }

  return `RESPONSE MODE — ENGINEERING CONVERSATION:
Answer the user's question in the first one or two sentences. Then include only the decision-relevant evidence, uncertainty and next action needed to support that answer. Prefer three to five concise bullets over a report-shaped response. Do not repeat facts already established in this conversation unless they changed or directly support the current decision. Use headings only when they improve scanning and use a table only for a true comparison. Preserve engineering rigor and governance boundaries; offer deeper detail rather than expanding automatically into a formal report.`;
}
