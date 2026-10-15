import {
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
  writeDecisionCases,
  type DecisionCase,
} from "../decision-case";
import { readStoredDecisionDrafts } from "../decision-case-drafts";
import { publicJourneyParameters } from "../public-journey-context";
function parameters(decisionCase: DecisionCase, search: string) {
  const params = publicJourneyParameters(search, decisionCase.industry);
  params.set("origin", "evaluation");
  return params;
}
export function evaluationAssistantDestination(
  decisionCase: DecisionCase,
  search: string,
): string {
  return `/workspace/cases/${encodeURIComponent(decisionCase.id)}?${parameters(decisionCase, search).toString()}`;
}
export function rememberEvaluationDraft(
  decisionCase: DecisionCase,
  search: string,
  storage: Storage,
  view: "ask" | "evaluation" = "evaluation",
): string {
  const key = getPublicDecisionCaseStorageKey(
    normalizeDecisionIndustry(decisionCase.industry),
  );
  writeDecisionCases(
    storage,
    [
      decisionCase,
      ...readStoredDecisionDrafts(storage, key).filter(
        (d) => d.id !== decisionCase.id,
      ),
    ],
    key,
  );
  const params = parameters(decisionCase, search);
  params.set("case", decisionCase.id);
  params.set("view", view);
  return `/get-started?${params.toString()}`;
}
export function readEvaluationDraftLocation(
  search: string,
  storage: Storage,
): { decisionCase: DecisionCase; view: "ask" | "evaluation" } | null {
  const params = new URLSearchParams(search);
  const id = params.get("case");
  if (!id) return null;
  const found = readStoredDecisionDrafts(
    storage,
    getPublicDecisionCaseStorageKey(
      normalizeDecisionIndustry(params.get("industry")),
    ),
  ).find(
    (d) =>
      d?.id === id &&
      typeof d.objective === "string" &&
      d.objective.trim().length >= 12,
  );
  return found
    ? {
        decisionCase: found,
        view: params.get("view") === "ask" ? "ask" : "evaluation",
      }
    : null;
}
/** Explicit transfer into the existing session draft surface, not promotion. */
export function stageEvaluationAssistantHandoff(
  decisionCase: DecisionCase,
  search: string,
  storage: Storage,
): string {
  rememberEvaluationDraft(decisionCase, search, storage);
  return evaluationAssistantDestination(decisionCase, search);
}
