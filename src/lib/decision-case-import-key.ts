import type { DecisionCase } from "./decision-case";

/**
 * Workspace dedupe UUID for a browser draft.
 *
 * This is not part of `DecisionCase`. That interface is a protected
 * Reliability Engineer evidence shape (RE-2026.08). The import key is a
 * client identity for `cowork_workspaces.case_number`. It is not an OEM
 * limit, an engineering threshold, or a field the public Reliability
 * Engineer copies into a prompt.
 */
export type DecisionCaseWithImportKey = DecisionCase & {
  importKey?: string;
};

const IMPORT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readDraftImportKey(
  decisionCase: DecisionCase,
): string | undefined {
  const value = (decisionCase as DecisionCaseWithImportKey).importKey?.trim();
  return value && IMPORT_KEY_PATTERN.test(value) ? value : undefined;
}

/** Keep a valid import UUID, or assign a new one. Does not use `DRAFT-`. */
export function withDraftImportKey(
  decisionCase: DecisionCase,
  importKey = crypto.randomUUID(),
): DecisionCaseWithImportKey {
  const existing = readDraftImportKey(decisionCase);
  return { ...decisionCase, importKey: existing ?? importKey };
}
