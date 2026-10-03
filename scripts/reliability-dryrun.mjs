#!/usr/bin/env node
/**
 * Exercise both RE-2026.08 harness modes without weakening the frozen floor.
 *
 * Candidate dry-run must always succeed. Capture dry-run has two legitimate
 * outcomes:
 *   1. unchanged protected surface: the stub reference is written to /tmp;
 *   2. changed protected surface: capture refuses with the exact fingerprint
 *      guard and writes nothing.
 *
 * Every other capture failure remains a failing dry run. This wrapper exists
 * because treating outcome (2) as a workflow failure made the guard itself
 * look broken on the pull requests it was designed to protect.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (!process.argv.includes("--dry-run")) {
  throw new Error("reliability-dryrun.mjs requires --dry-run");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = `/tmp/re-2026-08-dry-run-report-${process.pid}.json`;
const reference = `/tmp/re-2026-08-dry-run-reference-${process.pid}.json`;

for (const target of [report, reference]) {
  if (existsSync(target)) rmSync(target);
}

function runHarness(args) {
  return spawnSync(
    "npx",
    ["tsx", "scripts/run-reliability-qualification.ts", ...args],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

const candidate = runHarness(["--dry-run", `--output=${report}`]);
process.stdout.write(output(candidate));
if (candidate.status !== 0 || !existsSync(report)) {
  throw new Error(
    `candidate qualification dry-run failed with exit ${candidate.status ?? "unknown"}`,
  );
}
const candidateReport = JSON.parse(readFileSync(report, "utf8"));
if (candidateReport.dryRun !== true) {
  throw new Error("candidate dry-run output is not stamped dryRun=true");
}

const capture = runHarness([
  "--dry-run",
  "--capture-reference",
  `--output=${reference}`,
]);
const captureOutput = output(capture);
process.stdout.write(captureOutput);

if (capture.status === 0) {
  if (!existsSync(reference)) {
    throw new Error(
      "capture dry-run exited zero without writing its scratch reference",
    );
  }
  const captured = JSON.parse(readFileSync(reference, "utf8"));
  if (captured.dryRun !== true) {
    throw new Error("capture dry-run output is not stamped dryRun=true");
  }
  console.log("Capture dry-run passed on the unchanged protected surface.");
} else {
  const expected =
    /Cannot capture RE-2026\.08 reference after protected path changed: [^\r\n]+/;
  if (!expected.test(captureOutput)) {
    throw new Error(
      `capture dry-run failed for an unexpected reason (exit ${capture.status ?? "unknown"})`,
    );
  }
  if (existsSync(reference)) {
    throw new Error(
      "protected-surface capture refusal still wrote a scratch reference",
    );
  }
  console.log(
    "Capture dry-run correctly refused the changed protected surface; the frozen fingerprint guard remains enforced.",
  );
}
