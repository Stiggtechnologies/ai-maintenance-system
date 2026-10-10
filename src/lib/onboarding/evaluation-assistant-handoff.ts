import {
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
  writeDecisionCases,
  type DecisionCase,
} from "../decision-case";
import { readStoredDecisionDrafts } from "../decision-case-drafts";
/** Explicit transfer into the existing session draft surface, not promotion. */
export function stageEvaluationAssistantHandoff(
  decisionCase: DecisionCase,
  search: string,
  storage: Storage,
): string {
  const key = getPublicDecisionCaseStorageKey(
    normalizeDecisionIndustry(decisionCase.industry),
  );
  const drafts = readStoredDecisionDrafts(storage, key);
  writeDecisionCases(
    storage,
    [decisionCase, ...drafts.filter((d) => d.id !== decisionCase.id)],
    key,
  );
  const source = new URLSearchParams(search);
  const params = new URLSearchParams({ origin: "evaluation" });
  for (const name of ["entry", "source", "campaign", "variant"]) {
    const value = source.get(name)?.trim().slice(0, 120);
    if (value) params.set(name, value);
  }
  return `/workspace/cases/${encodeURIComponent(decisionCase.id)}?${params.toString()}`;
}
