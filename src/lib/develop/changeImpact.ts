/**
 * The Change Impact Agent's reading (D12.10, spec III.§60).
 *
 * THIS MODULE TRAVERSES NOTHING. Slice 5C's `get_case_thread_impact` is the
 * ONE traversal and the ONE refusal predicate; `readThreadImpact` in
 * `./thread.ts` already reads its payload for the thread panel. What is here
 * is the AGENT's reading — the same deterministic answer plus the model's
 * labelled half — and it deliberately re-derives none of it.
 */

import type { ThreadImpactPayload } from "./thread";

export interface ChangeImpactAiConsequence {
  objectRef: string;
  consequence: string;
  /** Always 'ai_suggestion' — written as a SQL literal by the RPC. */
  source: string;
  /** Always 'attention' — a model does not mark its own guess blocking. */
  severity: string;
}

export interface ChangeImpactReport {
  id: number;
  asAt: string;
  objectId: number;
  objectRef: string;
  objectKind: string;
  refused: boolean;
  /** Null whenever the traversal refused. Never the reachable count. */
  downstreamCount: number | null;
  reachedCount: number;
  gapCount: number;
  impact: ThreadImpactPayload;
  narrative: string | null;
  model: string | null;
  aiConsequences: ChangeImpactAiConsequence[];
  agentKey: string;
  advisory: boolean;
  requestedBy: string | null;
}

export interface ChangeImpactReportsPayload {
  caseId: string;
  reports: ChangeImpactReport[];
}

export interface ChangeImpactReportReading {
  headline: string;
  /** The refusals among the reports — the ones somebody will look for. */
  refusedCount: number;
  latest: ChangeImpactReport | null;
  reports: ChangeImpactReport[];
}

export function readChangeImpactReports(
  payload: ChangeImpactReportsPayload | null | undefined,
): ChangeImpactReportReading {
  const reports = payload?.reports ?? [];
  const refused = reports.filter((r) => r.refused);
  const latest = reports[0] ?? null;
  let headline: string;
  if (reports.length === 0) {
    headline =
      "No change-impact reading has been recorded on this case. That is a statement about this register, not about the thread — run the agent against an object to produce one.";
  } else if (latest && latest.refused) {
    headline = `The most recent reading (${latest.objectRef}) REFUSED: the thread has ${latest.gapCount} gap(s) inside the region it walked, so the ${latest.reachedCount} object(s) it reached are a floor and not the affected set.`;
  } else if (latest && latest.downstreamCount === null) {
    // A null count on a report that did not refuse is a contradiction the
    // table's own CHECK makes unrepresentable — but it is rendered as a
    // REFUSAL rather than interpolated, because "touches null downstream
    // object(s)" and "touches 0" are the two ways this sentence goes wrong.
    headline = `The most recent reading (${latest.objectRef}) carries NO downstream count. A missing count is not a count of zero, and nothing is stated about what a change here touches.`;
  } else if (latest) {
    headline = `The most recent reading says a change to ${latest.objectRef} touches ${latest.downstreamCount} downstream object(s), with no gap on the way.`;
  } else {
    headline = "No reading.";
  }
  return {
    headline,
    refusedCount: refused.length,
    latest,
    reports,
  };
}

/**
 * The line a surface must print beside model output.
 *
 * Not decoration. The report row is immutable, org-readable and permanent, and
 * its model half is a reading of prose — so it is labelled where it is shown,
 * every time, with the model named.
 */
export function aiConsequenceDisclaimer(model: string | null): string {
  return (
    `AI-GENERATED (${model ?? "model"}) — a reading of what the affected objects are, ` +
    "not a finding of this system. Nothing below was computed by the traversal, nothing below " +
    "can block a gate, and this agent cannot acknowledge a receipt, declare a revision, sever a " +
    "hop or clear a consequence."
  );
}
