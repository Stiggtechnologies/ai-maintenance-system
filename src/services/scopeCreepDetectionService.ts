import { buildScopeCreepDetection } from "../lib/develop/scopeCreepDetection";
import { getCaseControls, listDevelopmentCases } from "./developService";

export async function getScopeCreepDetection() {
  const cases = (await listDevelopmentCases()).filter(
    (item) => !["completed", "cancelled", "terminated"].includes(item.status),
  );
  const controls = await Promise.all(
    cases.map(async (item) => ({
      caseId: item.id,
      caseTitle: item.title,
      status: item.status,
      controls: await getCaseControls(item.id),
    })),
  );
  return buildScopeCreepDetection(controls);
}
