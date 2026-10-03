import { buildProjectControlsAgent } from "../lib/develop/projectControlsAgent";
import { getCasePerformance, listDevelopmentCases } from "./developService";
import { getScopeCreepDetection } from "./scopeCreepDetectionService";

export async function getProjectControlsAgent() {
  const [allCases, scopeCreep] = await Promise.all([
    listDevelopmentCases(),
    getScopeCreepDetection(),
  ]);
  const active = allCases.filter(
    (item) => !["completed", "cancelled", "terminated"].includes(item.status),
  );
  const scopeByCase = new Map(scopeCreep.cases.map((item) => [item.caseId, item]));
  const inputs = await Promise.all(
    active.map(async (item) => ({
      caseId: item.id,
      caseTitle: item.title,
      status: item.status,
      performance: await getCasePerformance(item.id),
      scopeCreep: scopeByCase.get(item.id),
    })),
  );
  return buildProjectControlsAgent(inputs);
}
