import type { DecisionCase } from "./decision-case";
import {
  evaluateIntakeSourceStanding,
  validateIntakeMappingReceipt,
  type CanonicalIntakeMapping,
  type IntakeSourceBinding,
} from "./decision-case-intake-contract";

/** Atomic server response boundary, paired with an independently authorized
 * canonical read. The customer intake availability gate remains disabled.
 * The caller adopts the returned case; it must not issue a second add_evidence.
 */
export function reconcileIntakeCaseReceipt(
  response: unknown,
  expected: Parameters<typeof validateIntakeMappingReceipt>[1],
  canonical: CanonicalIntakeMapping | null,
): DecisionCase {
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error("No atomic intake response was returned.");
  const { mapping, caseState } = response as {
    mapping: unknown;
    caseState: DecisionCase | undefined;
  };
  const result = validateIntakeMappingReceipt(mapping, expected, canonical);
  if (result.standing !== "current") throw new Error(result.reason);
  if (
    !caseState ||
    caseState.id !== expected.caseId ||
    caseState.revision !== canonical!.caseVersion ||
    caseState.stage !== "evidence" ||
    caseState.humanApproval ||
    caseState.humanDecision ||
    !Array.isArray(caseState.evidence)
  )
    throw new Error(
      "Intake did not return the new case revision requiring fresh human disposition.",
    );
  const attached = caseState.evidence.filter(
    (item) =>
      item.persistence === "governed_reference" &&
      item.durableReference === result.durableReference,
  );
  if (
    attached.length !== 1 ||
    !["high", "medium"].includes(attached[0].quality)
  )
    throw new Error(
      "The atomic case does not contain exactly one supplied canonical evidence mapping.",
    );
  const binding = (
    attached[0] as (typeof attached)[0] & {
      intakeBinding?: IntakeSourceBinding;
    }
  ).intakeBinding;
  if (
    !binding ||
    evaluateIntakeSourceStanding(binding, canonical).standing !== "current"
  )
    throw new Error(
      "The atomic case evidence does not retain the current source basis.",
    );
  // Detach the adopted state from the transport object; no local approval or
  // evidence rewrite is inferred. Existing historical audit stays server-owned.
  return structuredClone(caseState);
}
