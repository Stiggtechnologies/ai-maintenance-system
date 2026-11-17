import { portfolio } from "./portfolio.mjs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function validatePackage(record, manifest, evidence = {}) {
  const errors = [];
  if (!portfolio.some((p) => p.id === record?.id))
    errors.push("unknown requested identity");
  if (!record?.distinctWorkflowVerified || !evidence.distinctWorkflowWitness)
    errors.push("distinct workflow unproven");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(manifest?.id ?? "") ||
    !evidence.registeredAppIds?.includes(manifest.id)
  )
    errors.push("app registration unverified");
  const agents = manifest?.copilotAgents;
  const declarative = agents?.declarativeAgents,
    custom = agents?.customEngineAgents;
  if (!!declarative === !!custom || (declarative ?? custom)?.length !== 1)
    errors.push("exactly one supported agent per package required");
  for (const key of [
    "install",
    "uninstall",
    "entraIdentity",
    "tenantIsolation",
    "entitlement",
    "humanApproval",
    "schemaValidation",
    "capabilityTruth",
  ]) {
    if (!evidence.witnesses?.[key]) errors.push(`${key} witness missing`);
  }
  if (!evidence.schemaVersionVerified)
    errors.push("current schema version unverified");
  if (record?.sourceStatus === "unverified")
    errors.push("source capability unverified");
  return {
    preflightPassed: errors.length === 0,
    submissionReady: false,
    errors,
    limitations: [
      "Local evidence preflight only; Microsoft schema/certification and external witnesses require independent review.",
    ],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const result = validatePackage(
      input.record,
      input.manifest,
      input.evidence,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.preflightPassed ? 0 : 1;
  } catch {
    console.error("Usage: node validate.mjs <reviewed-package-evidence.json>");
    process.exitCode = 2;
  }
}
