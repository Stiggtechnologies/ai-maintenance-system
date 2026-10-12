/**
 * Proposed receipt contract, deliberately not wired to production intake.
 * A pure comparison cannot authenticate a receipt. `canonical` must come from
 * an authorized server read of the existing KB/evidence/case records, never
 * from the upload response itself. No persistence or approval is changed here.
 */
export interface IntakeSourceBinding {
  organizationId: string;
  documentId: string;
  evidenceItemId: string;
  sourceId: string;
  sourceRevision: number;
  securityRevision: number;
  contentSha256: string;
}
export interface CanonicalIntakeMapping extends IntakeSourceBinding {
  caseId: string;
  caseVersion: number;
  documentStatus: "indexed" | "pending" | "chunking" | "failed";
  securityStatus: "cleared" | "released" | "quarantined" | "rejected";
  chunkCount: number;
}
export type IntakeContractResult =
  | { standing: "current"; durableReference: string }
  | { standing: "invalidated"; reason: string };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positiveInteger = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) > 0;
const refuse = (reason: string): IntakeContractResult => ({
  standing: "invalidated",
  reason,
});
function validBinding(value: IntakeSourceBinding): boolean {
  return (
    uuid.test(value.organizationId) &&
    uuid.test(value.documentId) &&
    uuid.test(value.evidenceItemId) &&
    typeof value.sourceId === "string" &&
    value.sourceId.trim().length > 0 &&
    value.sourceId.length <= 160 &&
    positiveInteger(value.sourceRevision) &&
    positiveInteger(value.securityRevision) &&
    typeof value.contentSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.contentSha256)
  );
}
/** Content or security re-review invalidates the retained basis, including a
 * later release of the same bytes. This does not erase the historical approval.
 */
export function evaluateIntakeSourceStanding(
  bound: IntakeSourceBinding,
  canonical: CanonicalIntakeMapping | null,
): IntakeContractResult {
  if (
    !canonical ||
    !validBinding(bound) ||
    !validBinding(canonical) ||
    !uuid.test(canonical.evidenceItemId)
  )
    return refuse("Canonical source and evidence mapping are required.");
  if (
    canonical.documentStatus !== "indexed" ||
    !positiveInteger(canonical.chunkCount) ||
    !["cleared", "released"].includes(canonical.securityStatus)
  )
    return refuse("Source is unavailable for governed attachment or approval.");
  for (const key of [
    "organizationId",
    "documentId",
    "evidenceItemId",
    "sourceId",
    "sourceRevision",
    "securityRevision",
    "contentSha256",
  ] as const) {
    if (bound[key] !== canonical[key])
      return refuse(
        `Source basis changed: ${key}. Fresh human review is required.`,
      );
  }
  return { standing: "current", durableReference: canonical.evidenceItemId };
}
/** Match the command receipt to independently resolved canonical records.
 * Passing means a matching mapping only, never engineering or human approval.
 */
export function validateIntakeMappingReceipt(
  receipt: unknown,
  expected: {
    organizationId: string;
    caseId: string;
    expectedCaseVersion: number;
    sourceId: string;
  },
  canonical: CanonicalIntakeMapping | null,
): IntakeContractResult {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    !canonical
  )
    return refuse("No authoritative canonical mapping was supplied.");
  const candidate = receipt as CanonicalIntakeMapping;
  if (
    !uuid.test(expected.organizationId) ||
    !uuid.test(expected.caseId) ||
    !positiveInteger(expected.expectedCaseVersion) ||
    candidate.organizationId !== expected.organizationId ||
    candidate.caseId !== expected.caseId ||
    candidate.sourceId !== expected.sourceId ||
    candidate.caseVersion !== expected.expectedCaseVersion + 1 ||
    canonical.caseId !== expected.caseId ||
    canonical.caseVersion !== candidate.caseVersion ||
    candidate.evidenceItemId !== canonical.evidenceItemId ||
    candidate.documentStatus !== canonical.documentStatus ||
    candidate.securityStatus !== canonical.securityStatus ||
    candidate.chunkCount !== canonical.chunkCount
  )
    return refuse(
      "Receipt does not match the tenant, case revision or canonical evidence mapping.",
    );
  return evaluateIntakeSourceStanding(candidate, canonical);
}
