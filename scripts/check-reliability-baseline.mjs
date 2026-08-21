#!/usr/bin/env node

/**
 * RE-2026.08 release gate.
 *
 * Layer 2 of the floor (see scripts/reliability-baseline-floor.mjs for the
 * full layering). This script never decides what the floor IS — it imports
 * the hardcoded floor and refuses to evaluate a manifest that sits below it.
 * Before this change the gate read its own rules out of `manifest.json`, so
 * a PR could zero the thresholds and then rewrite the Reliability Engineer
 * against the rules it had just weakened.
 *
 * The script is invoked from three places and all three matter:
 *   - the required `Unit tests` CI job (branch protection requires it);
 *   - the standalone `Reliability Engineer qualification` workflow;
 *   - `npm run reliability:baseline` locally.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  collectClosureFailures,
  collectFloorFailures,
  computeProtectedClosure,
  loadManifest,
  loadSuite,
  repositoryRoot,
} from "./reliability-baseline-floor.mjs";

// Resolved from this file, not from cwd: the gate has to behave identically
// whether it is run by npm, by CI from the repo root, or from a worktree.
const root = repositoryRoot;

function fail(message) {
  console.error(`RELIABILITY QUALIFICATION GATE FAILED: ${message}`);
  process.exit(1);
}

function failAll(headline, failures) {
  console.error(`RELIABILITY QUALIFICATION GATE FAILED: ${headline}`);
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const manifest = loadManifest();
const suite = loadSuite();

// Two standing invariants, checked on EVERY run whether or not this diff
// touches a protected path, and reported together. A gate that surfaces one
// violation per run teaches people to weaken it one value per run.
//
//   1. Floor — the manifest may only be ratcheted against the hardcoded
//      minimum in scripts/reliability-baseline-floor.mjs. Never loosened.
//   2. Closure — a file list is not a boundary. A protected module that
//      imports an unprotected one exports the whole hole.
const closure = computeProtectedClosure();
const standingFailures = [
  ...collectFloorFailures(manifest, suite),
  ...collectClosureFailures(manifest, closure),
];
if (standingFailures.length > 0) {
  failAll(
    "the RE-2026.08 ratchet has been weakened. The manifest may only be ratcheted (more protected paths, stricter thresholds, more cases) and must cover everything the Reliability Engineer transitively imports.",
    standingFailures,
  );
}

if (!Array.isArray(suite.cases) || suite.cases.length < manifest.minimumCaseCount) {
  fail(`golden suite must contain at least ${manifest.minimumCaseCount} cases`);
}

const currentHashes = Object.fromEntries(
  manifest.protectedPaths.map((entry) => {
    if (!existsSync(path.join(root, entry.path))) fail(`protected path missing: ${entry.path}`);
    return [entry.path, git("hash-object", "--", entry.path)];
  }),
);

function resolveDiffBase() {
  // PRs must always evaluate the entire proposed change against their base.
  // Looking only at github.event.before would let an earlier protected change
  // disappear from the gate after a later unrelated push.
  const baseRef = (process.env.GITHUB_BASE_REF ?? "").trim();
  if (baseRef) {
    for (const candidate of [`origin/${baseRef}`, baseRef]) {
      try {
        return git("merge-base", "HEAD", candidate);
      } catch {
        // Continue to the next candidate.
      }
    }
    fail(`could not resolve pull-request merge base for ${baseRef}`);
  }

  // On a push to main, compare the whole push range.
  const eventBefore = (process.env.GITHUB_EVENT_BEFORE ?? "").trim();
  if (eventBefore && !/^0+$/.test(eventBefore)) return eventBefore;

  try {
    return git("rev-parse", "HEAD^");
  } catch {
    return null;
  }
}

function validateReferenceOutputs() {
  const referencePath = path.join(root, manifest.referenceOutputs);
  if (!existsSync(referencePath)) {
    // Be specific about the blocker. The generic version of this message sent
    // the previous reader looking for a bug; the real cause is a missing
    // repository secret, and the fix is an owner action, not a code change.
    fail(
      [
        `baseline reference outputs are not captured at ${manifest.referenceOutputs}.`,
        "",
        "The RE-2026.08 floor is frozen until they exist, and this gate will keep refusing every protected change. Capture them ONCE, while the protected blobs still match the manifest:",
        "",
        "  Required repository secret: OPENAI_API_KEY  (repo currently has only SUPABASE_ACCESS_TOKEN)",
        "  Workflow to dispatch:      .github/workflows/reliability-qualification.yml",
        "  Mode:                      capture-reference",
        "  Command:                   gh workflow run reliability-qualification.yml -f mode=capture-reference",
        "",
        "Alternative capture route (no OPENAI_API_KEY needed, uses the already-present SUPABASE_ACCESS_TOKEN and the deployed production processor):",
        "  Workflow: .github/workflows/one-shot-capture-re-2026-08.yml",
        "",
        "To prove the harness end to end WITHOUT any model credential:",
        "  npm run reliability:dryrun",
        "",
        "Do not work around this by weakening the manifest — scripts/reliability-baseline-floor.mjs and the required Unit tests check both refuse a weakened manifest.",
      ].join("\n"),
    );
  }
  const reference = JSON.parse(readFileSync(referencePath, "utf8"));
  if (reference.dryRun === true) {
    fail(
      "reference outputs are stub output from `--dry-run`; the frozen RE-2026.08 floor must be captured from the real Reliability Engineer, not from the plumbing test",
    );
  }
  if (reference.baselineId !== manifest.baselineId) fail("reference outputs target the wrong baseline");
  if (reference.promptVersion !== manifest.promptVersion) fail("reference outputs use the wrong prompt version");
  if (!reference.cases || Object.keys(reference.cases).length < manifest.minimumCaseCount) {
    fail(`reference outputs must contain at least ${manifest.minimumCaseCount} cases`);
  }
  for (const item of suite.cases) {
    const recorded = reference.cases[item.id];
    if (!recorded || !String(recorded.text ?? "").trim()) {
      fail(`reference outputs are missing a usable answer for ${item.id}`);
    }
  }
  for (const entry of manifest.protectedPaths) {
    if (reference.protectedPaths?.[entry.path] !== entry.gitBlobSha) {
      fail(`reference outputs were not captured from the original protected blob for ${entry.path}`);
    }
  }
  return reference;
}

const diffBase = resolveDiffBase();
const changedPaths = diffBase
  ? git("diff", "--name-only", `${diffBase}...HEAD`)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
  : [];
const protectedSet = new Set(manifest.protectedPaths.map((entry) => entry.path));
const protectedChanged = changedPaths.filter((item) => protectedSet.has(item));

if (protectedChanged.length === 0) {
  const stillAtBaseline = manifest.protectedPaths.filter(
    (entry) => currentHashes[entry.path] === entry.gitBlobSha,
  ).length;
  console.log(
    `RE-2026.08 gate passed: no protected Reliability Engineer surface changed in this diff (${stillAtBaseline}/${manifest.protectedPaths.length} protected files still byte-identical to the original floor).`,
  );
  process.exit(0);
}

validateReferenceOutputs();

const reportPrefix = `${manifest.qualificationReportsDirectory}/`;
const reportPaths = changedPaths.filter(
  (item) => item.startsWith(reportPrefix) && item.endsWith(".json"),
);
if (reportPaths.length === 0) {
  fail(
    `protected Reliability Engineer paths changed (${protectedChanged.join(", ")}) without a qualification report in ${manifest.qualificationReportsDirectory}`,
  );
}

const reportPath = reportPaths.sort().at(-1);
const report = JSON.parse(readFileSync(path.join(root, reportPath), "utf8"));

if (report.dryRun === true) {
  fail(
    "qualification report is a `--dry-run` plumbing check, not evidence about the model; a real run needs OPENAI_API_KEY and an independent RELIABILITY_JUDGE_MODEL",
  );
}
if (report.baselineId !== manifest.baselineId) fail("qualification report targets the wrong baseline");
if (report.verdict !== "qualified") fail("qualification report verdict must be 'qualified'");
if (!Number.isFinite(report.caseCount) || report.caseCount < manifest.minimumCaseCount) {
  fail(`qualification report must cover at least ${manifest.minimumCaseCount} cases`);
}
if (
  !report.pairwise ||
  Number(report.pairwise.winOrTieRate) < manifest.releaseThresholds.pairwiseWinOrTieRate
) {
  fail(
    `pairwise win/tie rate must be >= ${manifest.releaseThresholds.pairwiseWinOrTieRate}`,
  );
}
if (
  !report.metrics ||
  Number(report.metrics.evidenceGapRecognition) <
    manifest.releaseThresholds.evidenceGapRecognition
) {
  fail(
    `evidence-gap recognition must be >= ${manifest.releaseThresholds.evidenceGapRecognition}`,
  );
}
if (
  Number(report.metrics?.deterministicCalculationPassRate) <
  manifest.releaseThresholds.deterministicCalculationPassRate
) {
  fail("deterministic calculation pass rate must remain 100%");
}
if (!Array.isArray(report.dimensionRegressions) || report.dimensionRegressions.length !== 0) {
  fail("qualification report contains a quality-dimension regression");
}
// H4 — a model grading a frozen reference of its own output is not an
// independent comparison; it is the same distribution scoring itself. The
// harness now refuses to run that way, and the gate refuses to accept a
// report produced that way, because a report can be hand-edited.
const candidateModel = String(report.candidateModel ?? "").trim();
const judgeModel = String(report.judgeModel ?? "").trim();
if (!candidateModel) fail("qualification report must record candidateModel");
if (!judgeModel) fail("qualification report must record judgeModel");
if (manifest.judgeIndependenceRequired === true && candidateModel === judgeModel) {
  fail(
    `qualification judge must differ from the candidate; both are '${candidateModel}'. Set RELIABILITY_JUDGE_MODEL to an approved independent model.`,
  );
}

if (report.humanReview?.status !== "approved" || !String(report.humanReview?.reviewer ?? "").trim()) {
  fail("qualified Reliability Engineer changes require named human SME approval");
}
if (!String(report.humanReview?.reviewedAt ?? "").trim()) {
  fail("human SME approval requires a review timestamp");
}

for (const [key, allowed] of Object.entries(manifest.zeroTolerance)) {
  const actual = Number(report.hardFailures?.[key]);
  if (!Number.isFinite(actual) || actual > Number(allowed)) {
    fail(`zero-tolerance metric ${key} is ${actual}; allowed=${allowed}`);
  }
}

for (const entry of manifest.protectedPaths) {
  const reported = report.candidateProtectedPaths?.[entry.path];
  if (reported !== currentHashes[entry.path]) {
    fail(`qualification report hash mismatch for ${entry.path}`);
  }
}

console.log(
  `RE-2026.08 gate passed: ${protectedChanged.length} protected path(s) changed with a qualified ${report.caseCount}-case report, zero hard failures, no dimension regressions, and human SME approval.`,
);
