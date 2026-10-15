/**
 * Carries a browser Decision Case through signup and sign-in, then persists
 * it on the canonical cowork workspace. Does not approve a recommendation
 * or create a second case store.
 */
import { readDecisionCaseHandoff, type DecisionCase } from "../decision-case";
import { isSeedDecisionCaseId } from "../decision-case-honesty";
import { isExamplePrompt } from "./inverted-opening";
import {
  evaluationRestoreDestination,
  readEvaluationDraftLocation,
} from "./evaluation-assistant-handoff";
import { isPersistedDecisionCase } from "../../services/decisionCaseService";

export type FirstDecisionPersistDeps = {
  isPersisted: (id: string) => boolean;
  create: (seed: DecisionCase) => Promise<DecisionCase>;
  save: (decisionCase: DecisionCase) => Promise<void>;
};

function queryFrom(pathOrSearch: string): string {
  const queryAt = pathOrSearch.indexOf("?");
  return queryAt >= 0 ? pathOrSearch.slice(queryAt) : "";
}

/** Pending handoff first, then the draft named by returnTo or the page search. */
export function readFirstDecisionDraft(
  session: Storage,
  searchOrReturn: string,
): DecisionCase | null {
  const handoff = readDecisionCaseHandoff(session)?.decisionCase;
  if (handoff?.id && handoff.objective?.trim()) return handoff;
  const params = new URLSearchParams(
    queryFrom(searchOrReturn).replace(/^\?/, ""),
  );
  const nested = params.get("returnTo");
  const query = nested ? queryFrom(nested) : queryFrom(searchOrReturn);
  return readEvaluationDraftLocation(query, session)?.decisionCase ?? null;
}

/**
 * Where to send the visitor after auth. An unsaved `/workspace/cases/<draft>`
 * id is rewritten to the Get started restore URL for the case we actually have.
 */
export function returnToSavedDecisionCase(
  decisionCase: DecisionCase,
  requestedReturnTo: string,
  search: string,
): string {
  const restore = evaluationRestoreDestination(decisionCase, search);
  if (!requestedReturnTo || requestedReturnTo === "/") return restore;
  let url: URL;
  try {
    url = new URL(requestedReturnTo, "https://local.invalid");
  } catch {
    return restore;
  }
  const match = url.pathname.match(/^\/workspace\/cases\/([^/]+)$/);
  const targetId = match ? decodeURIComponent(match[1]) : null;
  if (targetId && !isPersistedDecisionCase(targetId)) return restore;
  if (url.pathname === "/get-started" || url.pathname === "/start") {
    return restore;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function persistFirstDecisionHandoff(
  decisionCase: DecisionCase,
  search: string,
  requestedReturnTo: string,
  deps: FirstDecisionPersistDeps,
): Promise<{
  decisionCase: DecisionCase;
  returnTo: string;
  persisted: boolean;
}> {
  const blocked =
    isExamplePrompt(decisionCase.objective) ||
    isSeedDecisionCaseId(decisionCase.id);
  if (blocked) {
    return {
      decisionCase,
      returnTo: returnToSavedDecisionCase(
        decisionCase,
        requestedReturnTo,
        search,
      ),
      persisted: false,
    };
  }
  if (deps.isPersisted(decisionCase.id)) {
    try {
      await deps.save(decisionCase);
      return {
        decisionCase,
        returnTo: returnToSavedDecisionCase(
          decisionCase,
          requestedReturnTo,
          search,
        ),
        persisted: true,
      };
    } catch {
      return {
        decisionCase,
        returnTo: evaluationRestoreDestination(decisionCase, search),
        persisted: false,
      };
    }
  }
  try {
    const created = await deps.create(decisionCase);
    if (!deps.isPersisted(created.id)) {
      throw new Error("Workspace save did not return a persisted case.");
    }
    const saved: DecisionCase = {
      ...created,
      id: created.id,
      objective: decisionCase.objective,
      evidence: decisionCase.evidence,
      messages: decisionCase.messages,
      updatedAt: created.updatedAt,
    };
    try {
      await deps.save(saved);
    } catch {
      // create already wrote this case. Keep that id instead of a second draft.
    }
    return {
      decisionCase: saved,
      returnTo: evaluationRestoreDestination(saved, search),
      persisted: true,
    };
  } catch {
    return {
      decisionCase,
      returnTo: evaluationRestoreDestination(decisionCase, search),
      persisted: false,
    };
  }
}
