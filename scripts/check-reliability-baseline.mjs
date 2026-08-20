#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(
  root,
  "benchmarks/reliability-engineer/re-2026.08/manifest.json",
);
const casesPath = path.join(
  root,
  "benchmarks/reliability-engineer/re-2026.08/cases.json",
);

function fail(message) {
  console.error(`RELIABILITY QUALIFICATION GATE FAILED: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const suite = JSON.parse(readFileSync(casesPath, "utf8"));

if (manifest.baselineId !== "RE-2026.08") fail("baseline id changed unexpectedly");
if (manifest.promptVersion !== "syncai-reliability-engineer-v4") {
  fail("baseline prompt version changed unexpectedly");
}
if (!Array.isArray(suite.cases) || suite.cases.length < manifest.minimumCaseCount) {
  fail(`golden suite must contain at least ${manifest.minimumCaseCount} cases`);
}
if (new Set(suite.cases.map((item) => item.id)).size !== suite.cases.length) {
  fail("golden suite contains duplicate case ids");
}

const currentHashes = Object.fromEntries(
  manifest.protectedPaths.map((entry) => {
    if (!existsSync(path.join(root, entry.path))) fail(`protected path missing: ${entry.path}`);
    return [entry.path, git("hash-object", "--", entry.path)];
  }),
);

function resolveDiffBase() {
  const eventBefore = (process.env.GITHUB_EVENT_BEFORE ?? "").trim();
  if (eventBefore && !/^0+$/.test(eventBefore)) return eventBefore;

  const baseRef = (process.env.GITHUB_BASE_REF ?? "").trim();
  if (baseRef) {
    for (const candidate of [`origin/${baseRef}`, baseRef]) {
      try {
        return git("merge-base", "HEAD", candidate);
      } catch {
        // Continue to the next candidate.
      }
    }
  }

  try {
    return git("rev-parse", "HEAD^");
  } catch {
    return null;
  }
}

function validateReferenceOutputs() {
  const referencePath = path.join(root, manifest.referenceOutputs);
  if (!existsSync(referencePath)) {
    fail(
      `baseline reference outputs are not captured at ${manifest.referenceOutputs}; run the live qualification harness against unchanged RE-2026.08 before changing protected surfaces`,
    );
  }
  const reference = JSON.parse(readFileSync(referencePath, "utf8"));
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
  ? git("diff", "--name-only", `${diffBase}...HEAD")
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
