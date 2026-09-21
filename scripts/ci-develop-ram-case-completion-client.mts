import { computeCaseRamProfile, RAM_KERNEL_VERSION } from "../src/lib/develop/ram";

const [apiUrl, anonKey, token, caseId] = process.argv.slice(2);
if (!apiUrl || !anonKey || !token || !caseId) {
  throw new Error("usage: client <api-url> <anon-key> <token> <case-id>");
}

async function rpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok || body?.error) {
    throw new Error(`${name} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const scope = await rpc<import("../src/lib/develop/ram").RamScopePayload>(
  "get_case_ram_scope",
  { p_case_id: caseId },
);
const profile = computeCaseRamProfile(scope);

if (profile.refused) throw new Error(`unexpected fatal refusal: ${profile.headline}`);
if (!profile.rbd?.result.computable) {
  throw new Error(`RBD not computable: ${profile.rbd?.result.reason ?? "absent"}`);
}
if (profile.rbd.edgeIds.length !== 2) throw new Error("expected two RBD edges");
if (profile.rbd.result.groupsWithUnquantifiedCommonCause.length !== 1) {
  throw new Error("recorded common cause without beta was not surfaced");
}
if (!profile.rbd.result.reason.toLowerCase().includes("upper bound")) {
  throw new Error("unquantified common cause did not qualify the result as an upper bound");
}
if (profile.assets.some((asset) => !asset.availability || !asset.growth)) {
  throw new Error("every fixture asset should have availability and Crow-AMSAA output");
}
if (profile.fmea.length !== 2 || profile.pmStrategies.length !== 2) {
  throw new Error("case-scoped FMEA or PM strategy rows are missing");
}
const fmeaModes = new Set(profile.fmea.map((row) => row.failureMode));
if (
  profile.fmea.some((row) => row.source !== "human_reviewed_library") ||
  !fmeaModes.has("Seal leakage") ||
  !fmeaModes.has("Bearing overheating")
) {
  throw new Error("case-scoped FMEA must be the seeded human-reviewed rows");
}
if (!profile.decisionBoundary.toLowerCase().includes("human")) {
  throw new Error("human decision boundary missing");
}

const recorded = await rpc<{
  report_id: number;
  run_id: string;
  refused: boolean;
  advisory: boolean;
}>("record_ram_agent_report", {
  p_case_id: caseId,
  p_kernel_version: RAM_KERNEL_VERSION,
  p_profile: profile,
  p_refusals: profile.refusals,
  p_narrative: "CI exercised the pinned deterministic RAM kernel across all case families.",
  p_model: null,
});
if (!recorded.report_id || !recorded.run_id || recorded.refused || !recorded.advisory) {
  throw new Error(`unexpected recorded result: ${JSON.stringify(recorded)}`);
}

const forged = structuredClone(profile);
if (!forged.rbd) throw new Error("fixture unexpectedly has no RBD");
forged.rbd.edgeIds = [999999];
const response = await fetch(`${apiUrl}/rest/v1/rpc/record_ram_agent_report`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    p_case_id: caseId,
    p_kernel_version: RAM_KERNEL_VERSION,
    p_profile: forged,
    p_refusals: [],
    p_narrative: "forged edge identity",
    p_model: null,
  }),
});
const forgedBody = (await response.json()) as { error?: string };
if (!forgedBody.error?.toLowerCase().includes("rbd edge set does not match")) {
  throw new Error(`forged RBD identity was not refused: ${JSON.stringify(forgedBody)}`);
}

process.stdout.write(
  JSON.stringify({
    reportId: recorded.report_id,
    runId: recorded.run_id,
    systemAvailability: profile.rbd.result.systemReliability,
    upperBound: true,
    assetCount: profile.assets.length,
    fmeaCount: profile.fmea.length,
    pmStrategyCount: profile.pmStrategies.length,
  }),
);
