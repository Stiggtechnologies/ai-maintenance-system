#!/usr/bin/env node

/**
 * One command for the honest path.
 *
 * An adversarial review walked the legitimate route end to end and counted it:
 * one owner action the engineer cannot perform, ~12 manual steps, two workflow
 * dispatches, two artifact downloads, 93 model calls, a mandatory hand-edit of
 * the machine-generated evidence, and a full re-run per review cycle. Against
 * that, forging the two JSON files took one command and no credentials. A
 * floor that is harder to satisfy honestly than dishonestly does not get
 * respected; it gets forged, and the forger feels reasonable doing it.
 *
 * The hand-edit is gone (approval is a sidecar now) and the workflow commits
 * its own output, so the remaining steps are: dispatch, wait, pull. This
 * script is those three.
 *
 * Usage:
 *   npm run reliability:requalify -- --mode=candidate \
 *     --model=<candidate> --judge=<independent-judge> [--ref=<branch>]
 *   npm run reliability:requalify -- --mode=capture-reference ...
 */

import { execFileSync, spawnSync } from "node:child_process";

const WORKFLOW = "reliability-qualification.yml";

function arg(name, fallback = "") {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

const mode = arg("mode", "candidate");
const model = arg("model");
const judge = arg("judge");
const ref = arg("ref") || capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);

if (!["candidate", "capture-reference"].includes(mode)) {
  console.error(`--mode must be candidate or capture-reference; got ${JSON.stringify(mode)}`);
  process.exit(1);
}
if (!model || !judge) {
  console.error(
    [
      "Both --model and --judge are required, and they must differ.",
      "",
      "A model grading a frozen reference of its own output is not an independent",
      "comparison, so there is no default judge and never will be.",
    ].join("\n"),
  );
  process.exit(1);
}
if (model === judge) {
  console.error(`--judge must differ from --model; both are '${model}'.`);
  process.exit(1);
}

console.log(`Dispatching ${WORKFLOW} (mode=${mode}, ref=${ref})`);
console.log(
  "If this fails with a missing secret, the blocker is XAI_API_KEY, which is an owner action:\n" +
    "  gh secret set XAI_API_KEY --repo Stiggtechnologies/ai-maintenance-system\n",
);

run("gh", [
  "workflow",
  "run",
  WORKFLOW,
  "--ref",
  ref,
  "-f",
  `mode=${mode}`,
  "-f",
  `model=${model}`,
  "-f",
  `judge_model=${judge}`,
]);

// gh does not return the dispatched run id, so find the newest run of this
// workflow on this ref and follow it.
const runId = capture("gh", [
  "run",
  "list",
  "--workflow",
  WORKFLOW,
  "--branch",
  ref,
  "--limit",
  "1",
  "--json",
  "databaseId",
  "--jq",
  ".[0].databaseId",
]);
console.log(`Watching run ${runId}`);
run("gh", ["run", "watch", runId, "--exit-status"]);

console.log(
  [
    "",
    "The workflow commits its own evidence to the branch. Pull it, then record",
    "the human decision in a sidecar (never by editing the evidence):",
    "",
    `  git pull --ff-only origin ${ref}`,
    "  # then add benchmarks/reliability-engineer/approvals/<name>.json with",
    '  #   kind "qualification", decision "qualified", reportFile, reportSha256,',
    "  #   reviewer, reviewerRole, reviewedAt, rationale",
    "  node scripts/check-reliability-baseline.mjs",
  ].join("\n"),
);
