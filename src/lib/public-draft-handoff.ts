import {
  clearDecisionCaseHandoff,
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
  writeDecisionCases,
  type DecisionCase,
} from "./decision-case";
import { readStoredDecisionDrafts } from "./decision-case-drafts";
/** Copies the full browser draft only; never creates a governed decision. */
export function completePublicDraftHandoff(
  decisionCase: DecisionCase,
  returnTo: string,
  local: Storage,
  session: Storage,
): string {
  const upsert = (storage: Storage, key?: string) => {
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
    if (
      JSON.stringify(
        readStoredDecisionDrafts(storage, key).find(
          (d) => d.id === decisionCase.id,
        ),
      ) !== JSON.stringify(decisionCase)
    )
      throw Error("Browser draft handoff was not retained");
  };
  upsert(local);
  const industry = normalizeDecisionIndustry(decisionCase.industry);
  upsert(session, getPublicDecisionCaseStorageKey(industry));
  const destination = new URL(
    returnTo === "/"
      ? `/workspace/cases/${encodeURIComponent(decisionCase.id)}?origin=public-draft`
      : returnTo,
    "https://local.invalid",
  );
  if (
    destination.pathname === "/workspace" ||
    destination.pathname.startsWith("/workspace/") ||
    destination.pathname.startsWith("/capabilities/")
  )
    destination.searchParams.set("industry", industry);
  // Only after both complete copies are read back. On failure the staged case remains.
  clearDecisionCaseHandoff(session);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
