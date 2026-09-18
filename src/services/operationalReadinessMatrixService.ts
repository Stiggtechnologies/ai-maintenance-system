import { buildOperationalReadinessMatrix } from "../lib/develop/operationalReadinessMatrix";
import { getCaseSystemOperationalReadiness } from "./developService";

/** Tenant scope is enforced by the existing canonical RPC and its RLS chain. */
export async function getOperationalReadinessMatrix(caseId: string) {
  const source = await getCaseSystemOperationalReadiness(caseId);
  return buildOperationalReadinessMatrix(source);
}
