import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const boundaryPath = path.join(
  repositoryRoot,
  "config/edge-function-boundary.json",
);
const workflowPath = path.join(
  repositoryRoot,
  ".github/workflows/deploy-migrations.yml",
);

const boundary = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
const workflow = fs.readFileSync(workflowPath, "utf8");
const failures = [];

const uniqueSorted = (values) => [...new Set(values)].sort();
const sameSet = (left, right) =>
  JSON.stringify(uniqueSorted(left)) === JSON.stringify(uniqueSorted(right));

if (!Number.isInteger(boundary.schemaVersion) || boundary.schemaVersion < 1) {
  failures.push("boundary schemaVersion must be a positive integer");
}
if (!/^\d+\.\d+\.\d+$/.test(boundary.supabaseCliVersion ?? "")) {
  failures.push("supabaseCliVersion must be an explicit semantic version");
}

const active = uniqueSorted(boundary.activeFunctions ?? []);
const blocked = uniqueSorted(boundary.blockedLegacyFunctions ?? []);
const allowedNoVerify = uniqueSorted(boundary.allowedNoVerifyJwt ?? []);

if (active.length === 0) failures.push("activeFunctions must not be empty");
for (const name of active) {
  if (blocked.includes(name)) {
    failures.push(`${name} cannot be both active and blocked`);
  }
}
for (const name of allowedNoVerify) {
  if (!active.includes(name)) {
    failures.push(
      `${name} cannot bypass platform JWT outside the active boundary`,
    );
  }
}

if (/supabase\s+functions\s+deploy\s+--all\b/.test(workflow)) {
  failures.push(
    "deploy --all is prohibited; functions must be explicitly allowlisted",
  );
}

const deploys = [];
const noVerifyDeploys = [];
const deployPattern = /supabase\s+functions\s+deploy\s+([a-z0-9-]+)([^\n]*)/g;
for (const match of workflow.matchAll(deployPattern)) {
  deploys.push(match[1]);
  if (/--no-verify-jwt\b/.test(match[2])) noVerifyDeploys.push(match[1]);
}

if (!sameSet(deploys, active)) {
  failures.push(
    `deployment workflow functions [${uniqueSorted(deploys).join(", ")}] do not match active boundary [${active.join(", ")}]`,
  );
}
if (!sameSet(noVerifyDeploys, allowedNoVerify)) {
  failures.push(
    `--no-verify-jwt functions [${uniqueSorted(noVerifyDeploys).join(", ")}] do not match the reviewed exception set [${allowedNoVerify.join(", ")}]`,
  );
}

for (const name of active) {
  const expectedPath = `supabase/functions/${name}/**`;
  if (!workflow.includes(expectedPath)) {
    failures.push(`deployment trigger is missing ${expectedPath}`);
  }
}
for (const name of blocked) {
  if (deploys.includes(name))
    failures.push(`blocked legacy function ${name} is deployed`);
  if (workflow.includes(`supabase/functions/${name}/**`)) {
    failures.push(`blocked legacy function ${name} is in deployment triggers`);
  }
}

// Reviewed v3.0.1 action.yml supports only `version`; github-token was removed.
// Pin the exact reviewed action, not any 40-character SHA labelled "v3".
const reviewedSetupCli = "45a513f8c64c0bc8e0e3dfe572b5c95be85f6359";
const setupCliSteps = [
  ...workflow.matchAll(
    /^([ \t]*)-\s+uses:[ \t]*supabase\/setup-cli@([^\s#]+)([^\r\n]*)$/gm,
  ),
];
const setupCliInvocationCount = [
  ...workflow.matchAll(/^[ \t]*(?:-[ \t]+)?uses:[ \t]*supabase\/setup-cli@/gm),
].length;
if (setupCliSteps.length !== 1 || setupCliInvocationCount !== 1) {
  failures.push(
    "deployment workflow must contain exactly one reviewed setup-cli step",
  );
}
for (const step of setupCliSteps) {
  if (
    step[2] !== reviewedSetupCli ||
    !/^[ \t]+#[ \t]+v3\.0\.1[ \t]*$/.test(step[3])
  ) {
    failures.push(
      "deployment workflow must use the reviewed immutable supabase/setup-cli v3.0.1 SHA",
    );
  }
  // Scope inputs to this step: a version in another step or comment is not a pin.
  const indent = step[1].length;
  const lines = [];
  for (const line of workflow
    .slice(step.index + step[0].length)
    .split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.length - line.trimStart().length <= indent) break;
    lines.push(line);
  }
  const withIndex = lines.findIndex((line) => line.trim() === "with:");
  const inputs = [];
  if (withIndex !== -1) {
    const withIndent =
      lines[withIndex].length - lines[withIndex].trimStart().length;
    for (const line of lines.slice(withIndex + 1)) {
      if (line.length - line.trimStart().length <= withIndent) break;
      inputs.push(line.trim());
    }
  }
  if (inputs.length !== 1 || !/^version:[ \t]+\S+$/.test(inputs[0] ?? "")) {
    failures.push(
      "setup-cli v3.0.1 must receive only the supported version input",
    );
  }
  if (inputs[0] !== `version: ${boundary.supabaseCliVersion}`) {
    failures.push(
      `deployment workflow must pin Supabase CLI ${boundary.supabaseCliVersion} in setup-cli with.version`,
    );
  }
}

if (failures.length > 0) {
  console.error("Edge-function deployment boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Edge-function boundary verified: ${active.join(", ")} (blocked legacy runtimes: ${blocked.length}).`,
);
