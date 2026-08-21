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
 * The script is invoked from four places and all four matter:
 *   - `npm run test`, which is what the required `Unit tests` CI job runs, so
 *     the gate runs even if every test file that spawns it is deleted;
 *   - an explicit step in the required `Unit tests` job;
 *   - the standalone `Reliability Engineer qualification` workflow;
 *   - `npm run reliability:baseline` locally.
 *
 * WHAT AN ADVERSARIAL REVIEW BROKE, AND WHAT CHANGED
 * --------------------------------------------------
 * Three independent reviewers each got past the first version of this gate in
 * the same way: not by weakening the rules, which held, but by hand-writing
 * the EVIDENCE the rules demand. `reference-outputs.json` with 31 answers each
 * the single character "x", and a qualification report with
 * `verdict: "qualified"` and an invented SME name, both authored in a text
 * editor, passed everything. Forging was strictly cheaper than the legitimate
 * route, because the legitimate route needs a repository secret that does not
 * exist.
 *
 * So evidence is no longer trusted on its face:
 *   - it must name the CI run that produced it, and this gate verifies that
 *     run against the GitHub API (mandatory inside Actions);
 *   - it must name the producing script and its digest, so you cannot qualify
 *     with one harness and ship another;
 *   - the machine report must be BYTE-UNTOUCHED (verdict stays
 *     `pending_human_review`), and human approval lives in a separate sidecar
 *     carrying the sha256 of that untouched report. Nobody is ever asked to
 *     open the evidence file in an editor again — that affordance was the
 *     forgery lesson the design was teaching.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  APPROVALS_DIRECTORY,
  APPROVAL_KINDS,
  APPROVAL_REQUIRED_FIELDS,
  EVIDENCE_PRODUCERS,
  MACHINE_REPORT_VERDICT,
  PROVENANCE_REQUIRED_FIELDS,
  PROTECTED_DATABASE_OBJECTS,
  QUALIFICATION_WORKFLOWS,
  REPOSITORY,
  TIER_CORE,
  TIER_PROMPT_SURFACE,
  CASES_PATH,
  collectApprovalShapeFailures,
  collectClosureFailures,
  collectMachineReportFailures,
  collectProvenanceFailures,
  collectFloorFailures,
  collectGuardFailures,
  computeDatabaseObjectDigests,
  computeTieredClosure,
  loadManifest,
  loadSuite,
  repositoryRoot,
  sha256File,
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

// Standing invariants, checked on EVERY run whether or not this diff touches a
// protected path, and reported together. A gate that surfaces one violation
// per run teaches people to weaken it one value per run.
//
//   1. Floor — the manifest may only be ratcheted against the hardcoded
//      minimum in scripts/reliability-baseline-floor.mjs. Never loosened.
//   2. Closure — a file list is not a boundary. A protected module that
//      imports an unprotected one exports the whole hole.
//   3. Guard wiring — the cheapest attack on the first version was not
//      weakening the guard but DELETING it: removing the ratchet test and the
//      ci.yml step took the suite from 1310 passing tests to 1285 passing
//      tests, and nothing anywhere noticed.
//   4. Governed SQL — the retrieval function and claim-permission tables that
//      decide what knowledge text is inlined into the system prompt are not
//      TypeScript, so a file-hash closure cannot see them.
const tiered = computeTieredClosure();
const standingFailures = [
  ...collectFloorFailures(manifest, suite),
  ...collectClosureFailures(manifest, tiered.all),
  ...collectGuardFailures(),
  ...collectDatabaseDriftFailures(),
];
if (standingFailures.length > 0) {
  failAll(
    "the RE-2026.08 ratchet has been weakened, disarmed, or has drifted. The manifest may only be ratcheted (more protected paths, stricter thresholds, more cases) and must cover everything the Reliability Engineer transitively imports.",
    standingFailures,
  );
}

function computedDatabaseDigests() {
  return computeDatabaseObjectDigests(PROTECTED_DATABASE_OBJECTS);
}

function collectDatabaseDriftFailures() {
  const computed = computedDatabaseDigests();
  const declared = new Map(
    (manifest.protectedDatabaseObjects ?? []).map((entry) => [
      entry.object,
      entry.definitionDigest,
    ]),
  );
  const failures = [];
  for (const [object, digest] of Object.entries(computed)) {
    if (!declared.has(object)) continue; // reported by the floor check
    if (declared.get(object) !== digest) {
      failures.push(
        `governed database object ${object} has drifted from its pinned definition (manifest ${declared.get(object)}, migrations now ${digest}). A migration that redefines it changes what knowledge text the Reliability Engineer inlines into its system prompt, with every protected TypeScript file still byte-identical. Update manifest.protectedDatabaseObjects to ${digest} and add a governed-sql approval record under ${APPROVALS_DIRECTORY}/.`,
      );
    }
  }
  return failures;
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

// ---------------------------------------------------------------------------
// Evidence provenance
// ---------------------------------------------------------------------------

const inActions = String(process.env.GITHUB_ACTIONS ?? "").trim() === "true";
const apiToken = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();

function checkProvenanceShape(label, artefact) {
  const failures = collectProvenanceFailures(label, artefact);
  if (failures.length > 0) {
    failAll(
      `${label} is not verifiable evidence. Regenerate it with \`npm run reliability:requalify\` (or \`gh workflow run reliability-qualification.yml\`) — the workflow commits its own output, so nobody has to hand-assemble evidence.`,
      failures,
    );
  }
  return artefact.provenance;
}

async function verifyRunExists(label, provenance) {
  if (!apiToken) {
    if (inActions) {
      fail(
        `${label} provenance cannot be verified: no GITHUB_TOKEN is available to this step. Add \`GITHUB_TOKEN: \${{ github.token }}\` to the gate step. Inside Actions this verification is mandatory — it is the only thing standing between the floor and a hand-written report.`,
      );
    }
    console.warn(
      `RE-2026.08: skipping GitHub run verification for ${label} (no GITHUB_TOKEN locally). CI verifies it; a local pass is not the merge decision.`,
    );
    return;
  }
  const url = `https://api.github.com/repos/${REPOSITORY}/actions/runs/${provenance.githubRunId}`;
  let payload;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      fail(
        `${label} names Actions run ${provenance.githubRunId}, which the GitHub API returned HTTP ${response.status} for. Evidence must name a run that actually happened.`,
      );
    }
    payload = await response.json();
  } catch (error) {
    if (error?.message?.startsWith?.("RELIABILITY")) throw error;
    fail(
      `${label} provenance could not be verified against the GitHub API (${String(error)}). Failing closed: unverifiable evidence is not evidence.`,
    );
  }
  if (payload.conclusion !== "success") {
    fail(
      `${label} names Actions run ${provenance.githubRunId}, whose conclusion is ${JSON.stringify(payload.conclusion)}. A run that did not succeed did not produce this file.`,
    );
  }
  if (!QUALIFICATION_WORKFLOWS.includes(payload.path)) {
    fail(
      `${label} names Actions run ${provenance.githubRunId}, which executed ${payload.path}. Evidence may only come from ${QUALIFICATION_WORKFLOWS.join(" or ")}.`,
    );
  }
  if (payload.head_sha !== provenance.githubSha) {
    fail(
      `${label} records head sha ${provenance.githubSha}, but run ${provenance.githubRunId} ran against ${payload.head_sha}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Human approval sidecars
// ---------------------------------------------------------------------------

function loadApprovals(changedPaths) {
  const prefix = `${APPROVALS_DIRECTORY}/`;
  const inDiff = changedPaths.filter(
    (item) => item.startsWith(prefix) && item.endsWith(".json"),
  );
  const approvals = [];
  for (const relative of inDiff) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) continue; // deleted in this diff
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      fail(`approval record ${relative} is not valid JSON`);
    }
    const shapeFailures = collectApprovalShapeFailures(parsed, manifest.baselineId);
    if (shapeFailures.length > 0) {
      failAll(`approval record ${relative} is not usable`, shapeFailures);
    }
    approvals.push({ file: relative, record: parsed });
  }
  return approvals;
}

// Approvals must appear IN THIS DIFF. An approval that merged last month is a
// statement about last month's code, and reusing it is the oldest trick there
// is.
function requireApproval(approvals, kind, describe, validate) {
  const candidates = approvals.filter((item) => item.record.kind === kind);
  if (candidates.length === 0) {
    fail(
      `${describe}\n\nRequired: a ${kind} approval record added or updated in this same pull request, under ${APPROVALS_DIRECTORY}/, with fields ${APPROVAL_REQUIRED_FIELDS.join(", ")}. See docs/reliability-engineer-baseline.md.`,
    );
  }
  const problems = [];
  for (const candidate of candidates) {
    const result = validate(candidate.record);
    if (result === true) return candidate;
    problems.push(`${candidate.file}: ${result}`);
  }
  failAll(`no valid ${kind} approval record covers this change`, problems);
}

// ---------------------------------------------------------------------------
// Frozen reference outputs
// ---------------------------------------------------------------------------

async function validateReferenceOutputs({ required }) {
  const referencePath = path.join(root, manifest.referenceOutputs);
  if (!existsSync(referencePath)) {
    if (!required) return null;
    // Be specific about the blocker. The generic version of this message sent
    // the previous reader looking for a bug; the real cause is a missing
    // repository secret, and the fix is an owner action, not a code change.
    fail(
      [
        `baseline reference outputs are not captured at ${manifest.referenceOutputs}.`,
        "",
        "The RE-2026.08 floor is frozen until they exist, and this gate will keep refusing every core protected change. Capture them ONCE, while the protected blobs still match the manifest:",
        "",
        "  Required repository secret: OPENAI_API_KEY  (repo currently has only SUPABASE_ACCESS_TOKEN)",
        "  Workflow to dispatch:      .github/workflows/reliability-qualification.yml",
        "  Mode:                      capture-reference",
        "  Command:                   gh workflow run reliability-qualification.yml \\",
        "                               -f mode=capture-reference \\",
        "                               -f model=<candidate> -f judge_model=<independent>",
        "  The workflow commits the captured file to the dispatched branch itself.",
        "",
        "Alternative capture route (no OPENAI_API_KEY; uses SUPABASE_ACCESS_TOKEN and the deployed",
        "production processor). READ THE CAVEATS FIRST — this route has never been executed:",
        "  Workflow: .github/workflows/one-shot-capture-re-2026-08.yml  (gh workflow run one-shot-capture-re-2026-08.yml)",
        "  - it snapshots production-as-deployed, not this checkout;",
        "  - it sends publicOnly:true, which ai-agent-processor routes to a hardcoded",
        "    https://api.openai.com/v1/responses call that ignores LLM_BASE_URL, so it does not",
        "    reach the Stigg AI Gateway and depends on OPENAI_API_KEY being set on the deployed function;",
        "  - it produces the REFERENCE only. Qualifying a candidate still needs OPENAI_API_KEY here.",
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
  // Validated on EVERY run, not only when a protected path changed. The first
  // version returned early at "no protected path changed" and never looked at
  // the reference at all, so a data-only pull request could rewrite all 31
  // frozen answers and every future candidate would then be judged against a
  // floor somebody quietly lowered.
  const provenance = checkProvenanceShape("reference outputs", reference);
  await verifyRunExists("reference outputs", provenance);
  return reference;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const diffBase = resolveDiffBase();
const changedPaths = diffBase
  ? git("diff", "--name-only", `${diffBase}...HEAD`)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
  : [];
const tierByPath = new Map(
  manifest.protectedPaths.map((entry) => [entry.path, entry.tier]),
);
const protectedChanged = changedPaths.filter((item) => tierByPath.has(item));
const coreChanged = protectedChanged.filter(
  (item) => tierByPath.get(item) === TIER_CORE,
);
const promptSurfaceChanged = protectedChanged.filter(
  (item) => tierByPath.get(item) === TIER_PROMPT_SURFACE,
);
const governedSqlChanged = changedPaths.filter(
  (item) =>
    item.startsWith("supabase/migrations/") &&
    item.endsWith(".sql") &&
    existsSync(path.join(root, item)) &&
    PROTECTED_DATABASE_OBJECTS.some((object) =>
      new RegExp(`\\b${object}\\b`).test(readFileSync(path.join(root, item), "utf8")),
    ),
);

const approvals = loadApprovals(changedPaths);

// Always. The reference file is evidence whether or not this diff touches code.
await validateReferenceOutputs({ required: coreChanged.length > 0 });

if (governedSqlChanged.length > 0) {
  const computed = computedDatabaseDigests();
  requireApproval(
    approvals,
    "governed-sql",
    `migrations touching a governed Reliability Engineer database object changed (${governedSqlChanged.join(", ")}). The qualification harness never executes the retrieval path, so a live A/B would not measure this — named human review is the honest requirement, and it is stated as such in docs/reliability-engineer-baseline.md.`,
    (record) => {
      const declared = record.databaseObjects ?? {};
      for (const [object, digest] of Object.entries(computed)) {
        if (declared[object] !== digest) {
          return `databaseObjects.${object} must be ${digest}; found ${JSON.stringify(declared[object])}`;
        }
      }
      return true;
    },
  );
}

if (promptSurfaceChanged.length > 0) {
  requireApproval(
    approvals,
    "prompt-surface",
    `prompt-surface Reliability Engineer files changed (${promptSurfaceChanged.join(", ")}). These carry Reliability Engineer instruction text or deterministic engineering numbers into an answer but are NOT exercised by the qualification harness, so what is required is a named human SME sign-off, not a model run.`,
    (record) => {
      const declared = record.paths ?? {};
      for (const changed of promptSurfaceChanged) {
        if (declared[changed] !== currentHashes[changed]) {
          return `paths["${changed}"] must be ${currentHashes[changed]}; found ${JSON.stringify(declared[changed])}`;
        }
      }
      return true;
    },
  );
}

if (coreChanged.length === 0) {
  const stillAtBaseline = manifest.protectedPaths.filter(
    (entry) => currentHashes[entry.path] === entry.gitBlobSha,
  ).length;
  console.log(
    `RE-2026.08 gate passed: no core Reliability Engineer surface changed in this diff (${stillAtBaseline}/${manifest.protectedPaths.length} protected files still byte-identical to the original floor${promptSurfaceChanged.length ? `; ${promptSurfaceChanged.length} prompt-surface file(s) changed with SME approval` : ""}${governedSqlChanged.length ? `; ${governedSqlChanged.length} governed-SQL migration(s) changed with SME approval` : ""}).`,
  );
  process.exit(0);
}

const reportPrefix = `${manifest.qualificationReportsDirectory}/`;
const reportPaths = changedPaths.filter(
  (item) => item.startsWith(reportPrefix) && item.endsWith(".json"),
);
if (reportPaths.length === 0) {
  fail(
    `core Reliability Engineer paths changed (${coreChanged.join(", ")}) without a qualification report in ${manifest.qualificationReportsDirectory}`,
  );
}

const reportPath = reportPaths.sort().at(-1);
const reportAbsolute = path.join(root, reportPath);
const report = JSON.parse(readFileSync(reportAbsolute, "utf8"));

if (report.dryRun === true) {
  fail(
    "qualification report is a `--dry-run` plumbing check, not evidence about the model; a real run needs OPENAI_API_KEY and an independent RELIABILITY_JUDGE_MODEL",
  );
}
if (report.baselineId !== manifest.baselineId) fail("qualification report targets the wrong baseline");

// The machine report must be EXACTLY as the harness wrote it. PR #234 made the
// harness unable to self-certify by hardcoding a pending verdict — and then
// the gate demanded "qualified", so the only documented path was to hand-edit
// the evidence. Approval now lives in a sidecar that signs this file's digest.
const machineFailures = collectMachineReportFailures(report);
if (machineFailures.length > 0) {
  failAll("the qualification report is not the machine's untouched statement", machineFailures);
}
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
// report produced that way, because a report is a file and files get edited.
const candidateModel = String(report.candidateModel ?? "").trim();
const judgeModel = String(report.judgeModel ?? "").trim();
if (!candidateModel) fail("qualification report must record candidateModel");
if (!judgeModel) fail("qualification report must record judgeModel");
if (manifest.judgeIndependenceRequired === true && candidateModel === judgeModel) {
  fail(
    `qualification judge must differ from the candidate; both are '${candidateModel}'. Set RELIABILITY_JUDGE_MODEL to an approved independent model.`,
  );
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

const reportProvenance = checkProvenanceShape(`qualification report ${reportPath}`, report);
await verifyRunExists(`qualification report ${reportPath}`, reportProvenance);

const reportDigest = sha256File(reportPath);
requireApproval(
  approvals,
  "qualification",
  `core Reliability Engineer paths changed (${coreChanged.join(", ")}) with a machine qualification report but no human SME approval of it.`,
  (record) => {
    if (record.reportFile !== reportPath) {
      return `reportFile must be ${reportPath}; found ${JSON.stringify(record.reportFile)}`;
    }
    if (record.reportSha256 !== reportDigest) {
      return `reportSha256 must be ${reportDigest} (the sha256 of the untouched machine report); found ${JSON.stringify(record.reportSha256)}`;
    }
    if (record.decision !== "qualified") {
      return `decision must be "qualified"; found ${JSON.stringify(record.decision)}`;
    }
    return true;
  },
);

console.log(
  `RE-2026.08 gate passed: ${coreChanged.length} core path(s) changed with a provenance-verified ${report.caseCount}-case report (run ${reportProvenance.githubRunId}), zero hard failures, no dimension regressions, and a named human SME approval signing that report's digest.`,
);
