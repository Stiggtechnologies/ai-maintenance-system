import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
const schema = JSON.parse(
  readFileSync(
    new URL("./MicrosoftTeams.v1.25.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const check = ajv.compile(schema);
export function validateMicrosoftManifest(manifest) {
  const valid = check(manifest);
  const errors = [
    ...(check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`),
  ];
  if (manifest?.manifestVersion !== "1.25")
    errors.push("manifestVersion must match pinned official 1.25 schema");
  const custom = manifest?.copilotAgents?.customEngineAgents?.[0];
  if (
    custom &&
    !manifest?.bots?.some(
      (b) => b.botId === custom.id && b.scopes?.includes("personal"),
    )
  )
    errors.push("custom-engine identity must match personal-scope bot");
  return {
    valid: valid && errors.length === 0,
    errors,
    submissionReady: false,
  };
}
