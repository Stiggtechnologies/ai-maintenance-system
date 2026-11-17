/**
 * Binds a leftover browser DecisionCase draft to one canonical decision.
 *
 * The draft itself stays in localStorage: evidence, calculations and discussion
 * are not copied by import and must not be discarded here. What this module
 * records is only the import intent — a stable idempotency key written before
 * the RPC, then the decision id once the acknowledgement arrives. A repeated
 * import, including one that retries after a lost acknowledgement, reuses that
 * identity instead of framing another decision.
 */
const DRAFT_IMPORT_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

export const DRAFT_IMPORT_BINDING_KEY =
  "syncai.browser-draft-import-bindings.v1";

export interface DraftImportBinding {
  draftId: string;
  caseId: string;
  idempotencyKey: string;
  decisionId: string | null;
  question: string;
}

export interface DraftImportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 UUID v5. Same draft and case always yield the same import identity. */
export async function draftImportIdempotencyKey(
  draftId: string,
  caseId: string,
): Promise<string> {
  const namespace = uuidToBytes(DRAFT_IMPORT_NAMESPACE);
  const name = new TextEncoder().encode(
    `syncai-browser-draft-import\n${draftId}\n${caseId}`,
  );
  const material = new Uint8Array(namespace.length + name.length);
  material.set(namespace, 0);
  material.set(name, namespace.length);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", material),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function isBinding(value: unknown): value is DraftImportBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<DraftImportBinding>;
  return (
    typeof binding.draftId === "string" &&
    typeof binding.caseId === "string" &&
    typeof binding.idempotencyKey === "string" &&
    (binding.decisionId === null || typeof binding.decisionId === "string") &&
    typeof binding.question === "string"
  );
}

function readBindings(storage: DraftImportStorage): DraftImportBinding[] {
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_IMPORT_BINDING_KEY) ?? "null");
    return Array.isArray(parsed) ? parsed.filter(isBinding) : [];
  } catch {
    return [];
  }
}

function writeBindings(
  storage: DraftImportStorage,
  bindings: DraftImportBinding[],
) {
  storage.setItem(DRAFT_IMPORT_BINDING_KEY, JSON.stringify(bindings));
}

/**
 * Persist the import intent before any RPC. A later lost acknowledgement can
 * retry this same key; it must not mint a new one.
 */
export async function beginDraftImport(
  storage: DraftImportStorage,
  input: { draftId: string; caseId: string; question: string },
): Promise<DraftImportBinding> {
  const bindings = readBindings(storage);
  const existing = bindings.find(
    (binding) =>
      binding.draftId === input.draftId && binding.caseId === input.caseId,
  );
  if (existing) return existing;
  const created: DraftImportBinding = {
    draftId: input.draftId,
    caseId: input.caseId,
    idempotencyKey: await draftImportIdempotencyKey(input.draftId, input.caseId),
    decisionId: null,
    question: input.question,
  };
  writeBindings(storage, [...bindings, created]);
  return created;
}

export function rememberDraftImportDecision(
  storage: DraftImportStorage,
  input: { draftId: string; caseId: string; decisionId: string },
): void {
  const bindings = readBindings(storage).map((binding) =>
    binding.draftId === input.draftId && binding.caseId === input.caseId
      ? { ...binding, decisionId: input.decisionId }
      : binding,
  );
  writeBindings(storage, bindings);
}

export async function importBrowserDraft(input: {
  storage: DraftImportStorage;
  draftId: string;
  caseId: string;
  question: string;
  approvalLevel: string | null;
  createDecision: (request: {
    caseId: string;
    question: string;
    approvalLevel: string | null;
    idempotencyKey: string;
  }) => Promise<{ decision_id: string; replay?: boolean }>;
}): Promise<{ decisionId: string; replay: boolean }> {
  const binding = await beginDraftImport(input.storage, {
    draftId: input.draftId,
    caseId: input.caseId,
    question: input.question,
  });
  if (binding.decisionId) {
    return { decisionId: binding.decisionId, replay: true };
  }
  const result = await input.createDecision({
    caseId: input.caseId,
    question: input.question,
    approvalLevel: input.approvalLevel,
    idempotencyKey: binding.idempotencyKey,
  });
  rememberDraftImportDecision(input.storage, {
    draftId: input.draftId,
    caseId: input.caseId,
    decisionId: result.decision_id,
  });
  return { decisionId: result.decision_id, replay: result.replay === true };
}
