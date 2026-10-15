/**
 * Carries a browser Decision Case through signup and sign-in, then persists
 * it on the canonical cowork workspace. Does not approve a recommendation
 * or create a second case store.
 */
import {
  readDecisionCaseHandoff,
  stageDecisionCaseHandoff,
  type DecisionCase,
} from "../decision-case";
import { isSeedDecisionCaseId } from "../decision-case-honesty";
import { isExamplePrompt } from "./inverted-opening";
import {
  evaluationRestoreDestination,
  readEvaluationDraftLocation,
} from "./evaluation-assistant-handoff";
import { isPersistedDecisionCase } from "../../services/decisionCaseService";
import {
  readDraftImportKey,
  withDraftImportKey,
  type DecisionCaseWithImportKey,
} from "../decision-case-import-key";

/**
 * Persisted workspace id for a browser draft, written before the handoff clears.
 * Keyed by the draft's import UUID, not by `draft-xxxxx` or `DRAFT-xxxxx`.
 */
export const FIRST_DECISION_IMPORT_KEY =
  "syncai.firstDecisionWorkspaceImport.v1";

type DraftImportStorage = Pick<Storage, "getItem" | "setItem">;

export type FirstDecisionPersistDeps = {
  isPersisted: (id: string) => boolean;
  create: (seed: DecisionCase) => Promise<DecisionCase>;
  save: (decisionCase: DecisionCase) => Promise<void>;
  /** Same-tab replay reads the workspace id written on the first successful create. */
  storage?: DraftImportStorage;
};

function readImportMap(storage: DraftImportStorage): Record<string, string> {
  try {
    const parsed = JSON.parse(
      storage.getItem(FIRST_DECISION_IMPORT_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** A random import key. The display number `DRAFT-xxxxx` is not one. */
export function isDraftImportKey(value: string | undefined): value is string {
  return Boolean(value && isPersistedDecisionCase(value));
}

/**
 * Keep an existing import UUID. A draft that has none gets a new one so two
 * drafts that share a `DRAFT-` suffix do not dedupe onto the same workspace.
 */
export function ensureDraftImportKey(
  decisionCase: DecisionCase,
): DecisionCaseWithImportKey {
  return withDraftImportKey(decisionCase);
}

export function readFirstDecisionImportId(
  storage: DraftImportStorage,
  importKey: string,
): string | null {
  if (!isDraftImportKey(importKey)) return null;
  const id = readImportMap(storage)[importKey];
  return id && isPersistedDecisionCase(id) ? id : null;
}

/** Record the workspace id before any later step clears the staged draft. */
export function rememberFirstDecisionImportId(
  storage: DraftImportStorage,
  importKey: string,
  workspaceId: string,
): void {
  if (!isDraftImportKey(importKey) || !isPersistedDecisionCase(workspaceId)) {
    return;
  }
  const imports = readImportMap(storage);
  imports[importKey] = workspaceId;
  storage.setItem(FIRST_DECISION_IMPORT_KEY, JSON.stringify(imports));
}

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
  const draft = ensureDraftImportKey(decisionCase);
  const importKey = readDraftImportKey(draft) ?? "";
  if (draft !== decisionCase && deps.storage) {
    try {
      stageDecisionCaseHandoff(deps.storage, draft);
    } catch {
      // The in-memory key still dedupes this attempt. A later read of the
      // staged handoff is what keeps the same key across a reload.
    }
  }
  const importedId = deps.storage
    ? readFirstDecisionImportId(deps.storage, importKey)
    : null;
  const alreadyPersisted = deps.isPersisted(decisionCase.id)
    ? decisionCase.id
    : importedId;
  if (alreadyPersisted) {
    const reused: DecisionCase = {
      ...draft,
      id: alreadyPersisted,
    };
    try {
      await deps.save(reused);
      return {
        decisionCase: reused,
        returnTo: returnToSavedDecisionCase(reused, requestedReturnTo, search),
        persisted: true,
      };
    } catch {
      return {
        decisionCase: reused,
        returnTo: evaluationRestoreDestination(reused, search),
        persisted: deps.isPersisted(reused.id),
      };
    }
  }
  try {
    const created = await deps.create(draft);
    if (!deps.isPersisted(created.id)) {
      throw new Error("Workspace save did not return a persisted case.");
    }
    if (deps.storage) {
      rememberFirstDecisionImportId(deps.storage, importKey, created.id);
    }
    const saved = {
      ...created,
      id: created.id,
      objective: decisionCase.objective,
      evidence: decisionCase.evidence,
      messages: decisionCase.messages,
      updatedAt: created.updatedAt,
    };
    Object.assign(saved, { importKey });
    try {
      await deps.save(saved);
    } catch {
      // The workspace id is already in this tab. A replay reuses it.
    }
    return {
      decisionCase: saved,
      returnTo: evaluationRestoreDestination(saved, search),
      persisted: true,
    };
  } catch {
    return {
      decisionCase: draft,
      returnTo: evaluationRestoreDestination(draft, search),
      persisted: false,
    };
  }
}
