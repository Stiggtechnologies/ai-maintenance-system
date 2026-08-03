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
    failures.push(`${name} cannot bypass platform JWT outside the active boundary`);
  }
}

if (/supabase\s+functions\s+deploy\s+--all\b/.test(workflow)) {
  failures.push("deploy --all is prohibited; functions must be explicitly allowlisted");
}

const deploys = [];
const noVerifyDeploys = [];
const deployPattern =
  /supabase\s+functions\s+deploy\s+([a-z0-9-]+)([^\n]*)/g;
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
  if (deploys.includes(name)) failures.push(`blocked legacy function ${name} is deployed`);
  if (workflow.includes(`supabase/functions/${name}/**`)) {
    failures.push(`blocked legacy function ${name} is in deployment triggers`);
  }
}

if (!workflow.includes("uses: supabase/setup-cli@v2")) {
  failures.push("deployment workflow must use supported supabase/setup-cli@v2");
}
if (!workflow.includes(`version: ${boundary.supabaseCliVersion}`)) {
  failures.push(
    `deployment workflow must pin Supabase CLI ${boundary.supabaseCliVersion}`,
  );
}
if (!workflow.includes("github-token: ${{ github.token }}")) {
  failures.push("deployment workflow must pass github-token to setup-cli");
}

if (failures.length > 0) {
  console.error("Edge-function deployment boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Edge-function boundary verified: ${active.join(", ")} (blocked legacy runtimes: ${blocked.length}).`,
);
