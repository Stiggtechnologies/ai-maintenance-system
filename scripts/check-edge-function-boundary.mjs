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

// Standalone before npm ci: deliberately validate a restricted installer
// template, not general YAML. The accepted deployment shape has plain mapping
// keys, no aliases/anchors/merge/flow maps or multiline quoted scalars, and one
// literal inline uses step directly in jobs.push-migrations.steps. That step
// contains only a contiguous `with` / literal `version` block. Shell block
// scalars are opaque, never alternative sources of installer configuration.
// Ambiguous/unsupported representations fail closed and require source review.
// Reviewed v3.0.1 action.yml supports only `version`; github-token was removed.
const reviewedSetupCli = "45a513f8c64c0bc8e0e3dfe572b5c95be85f6359";
const structuralLines = [];
let scalarIndent = null;
let unsupportedShape = false;
for (const line of workflow.split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  const indent = line.length - line.trimStart().length;
  if (scalarIndent !== null) {
    if (indent > scalarIndent) continue;
    scalarIndent = null;
  }
  // Only single-line quoted strings are supported outside literal/folded blocks.
  let quote = null;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote === '"' && character === "\\") {
      index++;
      continue;
    }
    if (quote === "'" && character === "'" && line[index + 1] === "'") {
      index++;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1])))
      break;
    else if (character === '"' || character === "'") quote = character;
  }
  if (
    quote !== null ||
    /\t/.test(line.slice(0, indent)) ||
    /^[ ]*(?:-[ ]*)?(?:["'][^"']+["'][ ]*:|\?[ ]|<<:)/.test(line) ||
    /:[ ]*(?:[&*][\w-]+|![^ ]+|\{)/.test(line) ||
    /^[ ]*-[ ]*(?:[&*][\w-]+|[\[{])/.test(line) ||
    /^[ ]*(?:-[ ]*)?uses:[ ]*["']/.test(line)
  )
    unsupportedShape = true;
  structuralLines.push({ line, indent });
  if (
    /:[ ]*(?:&[\w-]+[ ]+)?[|>](?:[1-9][+-]?|[+-][1-9]?)?[ ]*(?:#.*)?$/.test(
      line,
    )
  )
    scalarIndent = indent;
}
if (unsupportedShape)
  failures.push(
    "installer configuration must use the reviewed plain-mapping template; ambiguous YAML shapes are unsupported",
  );

const jobs = structuralLines
  .map(({ line }, index) => (line === "jobs:" ? index : -1))
  .filter((index) => index !== -1);
const deployJobs = structuralLines
  .map(({ line }, index) => (line === "  push-migrations:" ? index : -1))
  .filter((index) => index !== -1);
const jobsEnd = structuralLines.findIndex(
  ({ indent }, index) => index > (jobs[0] ?? -1) && indent === 0,
);
const jobStart = deployJobs[0] ?? -1;
const jobEnd = structuralLines.findIndex(
  ({ indent }, index) => index > jobStart && indent <= 2,
);
const deploymentLines = structuralLines.slice(
  jobStart + 1,
  jobEnd === -1 ? undefined : jobEnd,
);
const steps = deploymentLines
  .map(({ line }, index) => (line === "    steps:" ? index : -1))
  .filter((index) => index !== -1);
if (
  jobs.length !== 1 ||
  deployJobs.length !== 1 ||
  jobs[0] >= jobStart ||
  (jobsEnd !== -1 && jobStart >= jobsEnd) ||
  steps.length !== 1
)
  failures.push(
    "installer must belong to the unique plain jobs.push-migrations.steps mapping",
  );
const stepsStart = steps[0] ?? -1;
const stepsEnd = deploymentLines.findIndex(
  ({ indent }, index) => index > stepsStart && indent <= 4,
);
const deploymentSteps = deploymentLines.slice(
  stepsStart + 1,
  stepsEnd === -1 ? undefined : stepsEnd,
);
const setupCliSteps = deploymentSteps
  .map(({ line }, index) => ({
    index,
    match: line.match(
      /^      - uses:[ ]*supabase\/setup-cli@([^\s#]+)([^\r\n]*)$/,
    ),
  }))
  .filter((step) => step.match !== null);
// Count literal references everywhere too; quoted/flow/comment/scalar decoys
// are not permitted to smuggle in a second reference outside the template.
const setupCliReferences = [...workflow.matchAll(/supabase\/setup-cli/g)]
  .length;
if (setupCliSteps.length !== 1 || setupCliReferences !== 1) {
  failures.push(
    "deployment workflow must contain exactly one reviewed setup-cli step",
  );
}
for (const step of setupCliSteps) {
  if (
    step.match[1] !== reviewedSetupCli ||
    !/^[ ]+#[ ]+v3\.0\.1[ ]*$/.test(step.match[2])
  ) {
    failures.push(
      "deployment workflow must use the reviewed immutable supabase/setup-cli v3.0.1 SHA",
    );
  }
  const withLine = deploymentSteps[step.index + 1]?.line;
  const versionLine = deploymentSteps[step.index + 2]?.line;
  const following = deploymentSteps[step.index + 3];
  if (
    withLine !== "        with:" ||
    !/^          version:[ ]+\S+$/.test(versionLine ?? "") ||
    (following && !/^      - /.test(following.line))
  ) {
    failures.push(
      "setup-cli v3.0.1 must receive only the supported version input",
    );
  }
  if (versionLine !== `          version: ${boundary.supabaseCliVersion}`) {
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
