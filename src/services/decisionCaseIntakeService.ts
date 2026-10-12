import type { DecisionCase } from "../lib/decision-case";
import type { CanonicalIntakeMapping } from "../lib/decision-case-intake-contract";
import { reconcileIntakeCaseReceipt } from "../lib/decision-case-intake-reconciliation";
import { supabase } from "../lib/supabase";

export class DecisionCaseIntakeReconciliationRequired extends Error {
  readonly requiresReload = true;
}
/** Server attaches source + case revision atomically. Never follow this with a
 * browser add_evidence save. A lost acknowledgement requires canonical reload,
 * not automatic retry. The customer intake gate remains disabled separately.
 */
export async function attachCanonicalIntakeSource(input: {
  organizationId: string;
  caseId: string;
  expectedCaseVersion: number;
  sourceId: string;
}): Promise<DecisionCase> {
  try {
    const response = await supabase.rpc("attach_decision_case_kb_source", {
      p_workspace_id: input.caseId,
      p_expected_version: input.expectedCaseVersion,
      p_source_id: input.sourceId,
    });
    if (response.error) throw new Error(response.error.message);
    const evidenceId = (
      response.data as { mapping?: { evidenceItemId?: unknown } } | null
    )?.mapping?.evidenceItemId;
    if (
      typeof evidenceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        evidenceId,
      )
    )
      throw new Error("Intake returned no canonical evidence identity.");
    // This is an independent authorized read, never the upload response reused
    // as its own authority. Source/case drift between the calls fails closed.
    const canonical = await supabase.rpc("get_decision_case_intake_mapping", {
      p_workspace_id: input.caseId,
      p_evidence_id: evidenceId,
    });
    if (canonical.error) throw new Error(canonical.error.message);
    return reconcileIntakeCaseReceipt(
      response.data,
      input,
      canonical.data as CanonicalIntakeMapping | null,
    );
  } catch (error) {
    throw new DecisionCaseIntakeReconciliationRequired(
      `${error instanceof Error ? error.message : "Intake acknowledgement is unavailable."} Reload saved work before retrying; an atomic attachment may already exist.`,
    );
  }
}
