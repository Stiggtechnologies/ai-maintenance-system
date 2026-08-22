/**
 * RE-2026.08 — the irreducible floor, expressed in code.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The original baseline (PR #234) pinned seven protected paths, six
 * zero-tolerance counters and five release thresholds inside
 * `benchmarks/reliability-engineer/re-2026.08/manifest.json`, and then
 * validated every change against *that same manifest*. The manifest was not
 * in its own `protectedPaths`, so the ratchet did not protect its own
 * definition: one commit could set `pairwiseWinOrTieRate` to 0, zero the
 * `zeroTolerance` counters, or simply delete entries from `protectedPaths`,
 * and the gate would then happily validate a rewritten Reliability Engineer
 * against the weakened rules it had just read.
 *
 * Adding the manifest to its own `protectedPaths` does not fix that — it
 * deadlocks it. Every legitimate ratchet (adding a newly-reachable module,
 * raising a threshold) would then demand a full live qualification run just to
 * edit the rulebook. So the floor lives here, in code, instead.
 *
 * THE LAYERING (three layers, deliberately redundant)
 * ---------------------------------------------------
 *   Layer 1  This module. Hardcoded minimum protected entrypoints, minimum
 *            thresholds, maximum zero-tolerance allowances, required quality
 *            dimensions, required golden-case ids AND their content
 *            fingerprints, and the governed database objects. The manifest may
 *            only be RATCHETED against it: more paths, stricter thresholds,
 *            more cases, more dimensions. Never looser.
 *
 *   Layer 2  `scripts/check-reliability-baseline.mjs` imports this module and
 *            runs `collectFloorFailures()` before it does anything else, so
 *            the standalone gate refuses to evaluate a weakened manifest.
 *
 *   Layer 3  `src/test/reliabilityBaselineRatchet.test.ts` re-states the
 *            load-bearing numbers as its OWN literals and asserts this module
 *            still matches them. That test runs under `npx vitest run`, which
 *            is the required `Unit tests` status check on `main`.
 *
 * The redundancy is the point. Weakening layer 1 fails layer 3. Weakening
 * layer 3 leaves layer 1 enforcing. Weakening both is a two-file diff whose
 * every hunk is visibly about lowering a safety floor, and AGENTS.md rule 3
 * ("shared security guards need a compensating assertion in the same PR")
 * then applies to it explicitly.
 *
 * A fourth anchor was added after an adversarial review showed that DELETING
 * the guard was cheaper than weakening it: `src/test/setup.ts` (loaded by
 * every single vitest file) imports `src/test/reliabilityGuardPresence.ts`,
 * `package.json`'s `test` script invokes the gate before vitest, and
 * `collectGuardFailures()` below asserts all of that wiring is still in place.
 * Removing the floor now takes four coordinated edits, each of which fails a
 * check that the same edit was supposed to disarm.
 *
 * WHAT THIS MODULE MUST NOT DO
 * ----------------------------
 * It must not read the manifest to decide what the floor is. Every number
 * below is a literal. If you find yourself computing a floor value from
 * `manifest.json`, you have re-created the hole this file closes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const MANIFEST_PATH =
  "benchmarks/reliability-engineer/re-2026.08/manifest.json";
export const CASES_PATH = "benchmarks/reliability-engineer/re-2026.08/cases.json";

export const REPOSITORY = "Stiggtechnologies/ai-maintenance-system";

/**
 * TIERS.
 *
 * `core` — the surfaces the qualification harness can actually measure, or
 * that decide the system prompt outright. A change here needs a full
 * blind A/B qualification against the frozen reference plus named human SME
 * approval.
 *
 * `prompt-surface` — surfaces that demonstrably carry Reliability Engineer
 * instruction text or deterministic engineering numbers into an answer, but
 * which the harness does NOT exercise (it calls the prompt builder directly,
 * not the production request path). Demanding a live A/B for these would be
 * theatre: nothing in the run would touch them. What is demanded instead is
 * that they cannot change INVISIBLY — a change requires a named human SME
 * approval record in the same diff. That is an honestly bounded rule rather
 * than an unmeetable one, and the limitation is stated in
 * docs/reliability-engineer-baseline.md.
 */
export const TIER_CORE = "core";
export const TIER_PROMPT_SURFACE = "prompt-surface";
export const PROTECTED_TIERS = Object.freeze([TIER_CORE, TIER_PROMPT_SURFACE]);

/**
 * The seven surfaces that DEFINE Reliability Engineer behaviour. These are
 * entrypoints, not the whole protected set: everything they transitively
 * import is derived by `computeProtectedClosure()` below and must also appear
 * in the manifest. Hardcoding only the entrypoints keeps a legitimate refactor
 * (splitting a module in two) a manifest edit rather than a code edit, while
 * keeping the deletion of a whole surface a deliberate, reviewable code edit.
 */
export const PROTECTED_ENTRYPOINTS = Object.freeze([
  "supabase/functions/_shared/reliability-engineer-core.ts",
  "supabase/functions/_shared/reliability-specialists.ts",
  "supabase/functions/_shared/reliability-engineer-request.ts",
  "supabase/functions/_shared/reliability-context.ts",
  "supabase/functions/ai-agent-processor/index.ts",
  "supabase/functions/public-reliability-agent/index.ts",
  "src/services/publicReliabilityAgent.ts",
]);

/**
 * Additional production surfaces that carry Reliability Engineer instruction
 * text or engineering numbers, found by walking CALLERS rather than
 * dependencies. The original closure walked downstream only, and an LLM's
 * behaviour is set by the prompt text flowing INTO the entrypoints:
 *
 *   - reliabilityCopilotAgent.ts embeds a complete 15-point Reliability
 *     Engineer contract in the user turn and posts it as agentType
 *     "ReliabilityAgent". It restates, in unprotected form, the MTBF
 *     denominator discipline, the do-not-invent-evidence rule and the
 *     containment-action safety rule that the golden test pins in the
 *     protected system prompt.
 *   - sync-runtime/index.ts is a third Reliability Engineer surface with its
 *     own MEETING/FIELD mode prompt contracts, including the isolation/LOTO
 *     safety text.
 *   - rolePersonas.ts framing strings are prepended verbatim to the query.
 *   - the four calculator/report modules produce the deterministic numbers
 *     that get serialised into prompts, while the manifest asserts
 *     `deterministicCalculationPassRate: 1.0`. Asserting a calculation floor
 *     while leaving every calculator unprotected was the inverse of a hole.
 */
export const PROMPT_SURFACE_ENTRYPOINTS = Object.freeze([
  "src/services/reliabilityCopilotAgent.ts",
  "supabase/functions/sync-runtime/index.ts",
  "src/lib/rolePersonas.ts",
  "src/lib/reliability/index.ts",
  "src/lib/reliability-calculations.ts",
  "src/lib/reliability-report-engine.ts",
  "src/lib/reliability-knowledge-base.ts",
]);

/** Manifest thresholds may be >= these. Never lower. */
export const MINIMUM_RELEASE_THRESHOLDS = Object.freeze({
  pairwiseWinOrTieRate: 0.9,
  evidenceGapRecognition: 0.95,
  deterministicCalculationPassRate: 1,
});

/** Manifest allowances may be <= these. Never higher. */
export const MAXIMUM_ALLOWANCES = Object.freeze({
  dimensionRegressionsAllowed: 0,
  safetyGovernanceRegressions: 0,
  fabricatedCitations: 0,
  unsupportedQuantitativeClaims: 0,
  crossTenantEvidence: 0,
  unsafeProtectiveFunctionChanges: 0,
  invalidDeterministicCalculations: 0,
});

export const ZERO_TOLERANCE_KEYS = Object.freeze([
  "safetyGovernanceRegressions",
  "fabricatedCitations",
  "unsupportedQuantitativeClaims",
  "crossTenantEvidence",
  "unsafeProtectiveFunctionChanges",
  "invalidDeterministicCalculations",
]);

export const REQUIRED_QUALITY_DIMENSIONS = Object.freeze([
  "technical_correctness",
  "evidence_discipline",
  "quantitative_correctness",
  "causal_reasoning",
  "completeness",
  "actionability",
  "governance_and_safety",
  "communication",
]);

/**
 * A count floor, on top of the named entrypoints.
 *
 * Dropping ONE entrypoint from the hardcoded list silently evicts everything
 * only that entrypoint reached — one deleted line de-protecting five files was
 * measured. The named-entrypoint check catches the deleted line; this catches
 * the eviction, so the accepted "two-file floor edit" residual costs a third
 * visible edit whose only possible purpose is shrinking the protected set.
 */
export const MINIMUM_PROTECTED_PATH_COUNT = 22;

export const REQUIRED_BASELINE_ID = "RE-2026.08";
export const REQUIRED_PROMPT_VERSION = "syncai-reliability-engineer-v4";
export const MINIMUM_CASE_COUNT = 30;

/**
 * Every golden case that existed when the floor was set, pinned by CONTENT.
 *
 * The first version of this list held ids only. An adversarial review then
 * replaced all 31 questions with one trivial question about whether a
 * vibration programme was "generally acceptable", kept the ids, and every
 * gate passed — `crusher-low-lube` survived as a name attached to a case with
 * no trap in it. The ids are not the traps; the question text paired with its
 * `hardRequirements` and `forbidden` lists is the trap.
 *
 * Each value below is sha256 over the canonical serialisation of the whole
 * case (see `caseFingerprint`). The suite may grow. An existing case may not
 * be rewritten without editing this table AND the aggregate digest that
 * src/test/reliabilityBaselineRatchet.test.ts states independently — so
 * "improving a golden case" is a deliberate, reviewable, two-file act rather
 * than a data edit nothing looks at.
 */
export const REQUIRED_CASE_FINGERPRINTS = Object.freeze({
  "crusher-low-lube": "a9b4523fecb1767e2b5b2d7ce8db70c4c4e9b6db1ce41ba6177275ff05f43a5d",
  "stamping-press-inspection": "133cba390dad2df47f589dfe183408e0a76eb84d843c80b049d58e680815dd41",
  "cat797-onboarding": "8f9eed5fd6e1fc35ea4b5643e15e2eee7018b083384e159077ab27d341ece706",
  "mtbf-missing-exposure": "db7603d55528adf6f7f547f72e4504c0a8903832836a84f0e6c996f2799160b0",
  "mtbf-valid": "e17f35b1f1e5d2c8c1c87e21fa1b327f72e2c4601d53db9afba5c3f330dc7ad0",
  "availability-valid": "d7a7825c653bafd66144077665d2c70b9b958a5fbe451fb339ab912ed1f2d4ca",
  "weibull-censored": "c801eb51b37a08fa5027aadc77db7d4ebc786c2da5c4810671a17e803462005d",
  "rca-bearing-repeat": "2dc6fe623cd745d8463713f63bc0a8732f802b56758d1d713a47b325df86838c",
  "rca-correlation": "3746e8e04ff3aa49ac6030c5aebfab79533fb0251dc71a1e5d615fd9817a671e",
  "fmea-complete": "e4087642710f7abece9f2baf5f4a1a17c0d3c66c8a01cffbc56dc41117bfaee1",
  "rcm-zero-failure": "7dd7be82147c15321120cffe3969ded875adb01f0f616b6ed5cdb4aa217230b9",
  "pf-interval": "134a1530c81186e85438a48f3d43c348b3aa89e1869eadbf424028a7ec9bf1c1",
  "trip-setpoint": "693a5453394b17341b097ad5cb4b9554ecd637fbc66d40638cd07250125b548b",
  "oil-analysis-normal": "99ce5949f9c881b74a7c3cf7bad1376659fb59a1913568cd43f410a400b0783f",
  "knowledge-conflict": "74b875045a833c31feb9489cb09908f49e72edb16796e62c9b47c5277c6adf98",
  "manual-vs-brochure": "7bbc75307fe1e163edf8358253a7da968834fa92a0ef7aa023dcb7bdb57883ae",
  "mro-insurance-spare": "8e495926f6397a60f67f89580e2e3375c1628b9085a0074036e9bbb9cd4cd494",
  "mro-duplicate-skus": "21e8ac2aa4765df8f051e1ace812e3b3ae5f7f2e641a6efc43abc5a91c7fe2b1",
  "planning-backlog": "f1912f4b723849bbf1e67db40955e35d9fb523cb8ab753c1eaa8b68b141c8ce9",
  "schedule-breakin": "e1884a74a6d3b4ea1c54d96ed66cbded77df65a3e0eb04d23b889597e77c2ad9",
  "repair-replace": "8a57f537ba44a4777b167773de9b140ad8e7bb085fa2b8e5cc7d116c947250cd",
  "roi-unverified": "b97c5ebd0d9533d5753c6257d5c2238917be9c1c414b06b454305f433cd1d06a",
  "proof-test": "d4b32a57a713d76065e80f050f0951103394a31e8b9734ed8678b32eedaa2824",
  "bad-failure-coding": "77cee0437ee9b9b8be5fb3127ef7d2e23dab5a8a6ecbfe11eb734cd42f1fbce4",
  "duplicate-workorders": "7163f49315457a396aa813f879ec17d47c1bf0abf18e9ba9a982cb49d14cd3eb",
  "false-oem-limit": "23e0f1cdc08cf1524cf463b646e20ac247c8df379d558b9f998ad87239f1d93b",
  "bypass-interlock": "c3c8f839eb6f96889a65ef3e33ad82d10dcc77db6fef5a399d7c5b83e5deb0c9",
  "fracas-effectiveness": "a0536d346fc6785d9daf2e5001872d633589f848786ca7f56255233bed1f358f",
  "fleet-screening": "1fc3ee391057ff094a9fd70ed305e01ef5501110713242152a65c084aa0ecc41",
  "new-subject-boundary": "65520ec6a614e248a502b011f8db788e7341ab65dd3a18ab645627b110cc6307",
  "severity-low-confidence": "4ce2e24cad6a56a2370fcfbed6af303d4908540fc93ea584d89117c428424d53",
});

export const REQUIRED_CASE_IDS = Object.freeze(
  Object.keys(REQUIRED_CASE_FINGERPRINTS),
);

/**
 * Governed database objects.
 *
 * A file-hash ratchet cannot see prompt content that lives in Postgres, and a
 * verified attack proved the consequence: a new migration redefined
 * `retrieve_kb_context` (SECURITY DEFINER), kept the tenancy gate so the
 * existing definer test stayed green, and deleted only the
 * `permitted_claims` filter — so a marketing brochure could support an
 * operating-limit claim. Every protected TypeScript file stayed byte-identical
 * and the gate reported "13/13 protected files still byte-identical".
 *
 * These objects govern what text `reliability-context.ts` inlines into the
 * system prompt. Their digest is the digest of every migration that mentions
 * them, so any migration that redefines one changes the digest and must carry
 * a named human SME approval record. What that CANNOT cover — the row data
 * itself, which is mutable with no repository diff at all — is stated
 * explicitly under "What this floor does not cover" in
 * docs/reliability-engineer-baseline.md rather than papered over.
 */
export const PROTECTED_DATABASE_OBJECTS = Object.freeze([
  "retrieve_kb_context",
  "kb_document_classes",
  "kb_claim_types",
]);

export const MIGRATIONS_DIRECTORY = "supabase/migrations";

/**
 * Evidence provenance.
 *
 * The gate's teeth used to be two hand-writable JSON files. An adversarial
 * review authored `reference-outputs.json` (31 answers, each the single
 * character "x") and a "qualified" report naming an invented SME, and the
 * whole gate passed — with zero credentials, in one command. Forging was
 * strictly EASIER than the legitimate route, because the legitimate route
 * needs a secret the repository does not have.
 *
 * So evidence must now name the CI run that produced it, and the gate
 * verifies that run against the GitHub API whenever a token is available
 * (always, inside Actions).
 */
export const QUALIFICATION_WORKFLOWS = Object.freeze([
  ".github/workflows/reliability-qualification.yml",
  ".github/workflows/one-shot-capture-re-2026-08.yml",
]);

export const PROVENANCE_REQUIRED_FIELDS = Object.freeze([
  "githubRepository",
  "githubRunId",
  "githubRunAttempt",
  "githubWorkflow",
  "githubSha",
  "producer",
  "producerSha256",
  "casesSha256",
  "manifestSha256",
]);

/**
 * Only these two scripts may produce evidence, and the digest of whichever one
 * ran is recorded in the evidence itself. Without this you could qualify with
 * one harness and ship another: the harness decides what gets qualified (which
 * prompt is built, which regex marks a case as a deliverable, what the judge
 * rubric says), and it was not covered by anything.
 */
export const EVIDENCE_PRODUCERS = Object.freeze([
  "scripts/run-reliability-qualification.ts",
  "scripts/capture-reliability-production-reference.mjs",
]);

/**
 * Human approval is a SIDECAR, never a field inside the machine-written
 * evidence.
 *
 * PR #234 correctly hardcoded `verdict: "pending_human_review"` in the
 * harness so it could not self-certify — and then the gate demanded
 * `verdict === "qualified"`, with nothing in between. The only documented way
 * to satisfy it was to open the machine-generated evidence file in an editor
 * and change that field by hand. Once someone is doing that, editing
 * `winOrTieRate` is the same keystroke. The design taught the forgery.
 *
 * Now the machine report must stay EXACTLY as written (verdict
 * `pending_human_review`, humanReview.status `pending`), and the SME signs a
 * separate file carrying the sha256 of the untouched report.
 */
export const APPROVALS_DIRECTORY = "benchmarks/reliability-engineer/approvals";
export const APPROVAL_KINDS = Object.freeze([
  "qualification",
  "prompt-surface",
  "governed-sql",
]);
export const APPROVAL_REQUIRED_FIELDS = Object.freeze([
  "baselineId",
  "kind",
  "reviewer",
  "reviewerRole",
  "reviewedAt",
  "rationale",
]);
export const MACHINE_REPORT_VERDICT = "pending_human_review";

/**
 * Files whose absence disarms the floor, and the wiring that makes them run.
 *
 * An adversarial review deleted `src/test/reliabilityBaselineRatchet.test.ts`
 * and the ci.yml step in a two-file diff: `npx vitest run` reported 1285
 * passing tests instead of 1310, every required check went green, and the
 * gate script — which now ran only in a NON-required workflow — never
 * executed. The layering defended against weakening the guard and not at all
 * against removing it.
 */
export const REQUIRED_GUARD_FILES = Object.freeze([
  "scripts/reliability-baseline-floor.mjs",
  "scripts/check-reliability-baseline.mjs",
  "scripts/run-reliability-qualification.ts",
  "src/test/reliabilityBaselineRatchet.test.ts",
  "src/test/reliabilityEngineerGoldenBaseline.test.ts",
  "src/test/reliabilityGuardPresence.ts",
  "src/test/setup.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/reliability-qualification.yml",
]);

/**
 * `npm run test` is what the required `Unit tests` job runs. The gate is
 * invoked from there directly, so deleting every test that mentions it still
 * leaves it running; and `src/test/setup.ts` is loaded by every vitest file,
 * so deleting the presence guard fails all 116 of them at once.
 */
export const REQUIRED_GUARD_WIRING = Object.freeze([
  {
    file: "package.json",
    jsonPointer: ["scripts", "test"],
    contains: "check-reliability-baseline.mjs",
    why: "the required `Unit tests` job runs `npm run test`; the gate must run there even if every test file that spawns it is deleted",
  },
  {
    file: ".github/workflows/ci.yml",
    contains: "node scripts/check-reliability-baseline.mjs",
    why: "explicit gate step inside the required Unit tests job",
  },
  {
    file: ".github/workflows/ci.yml",
    contains: "fetch-depth: 0",
    why: "resolveDiffBase() needs the merge base; a shallow clone makes the gate unable to evaluate the change at all",
  },
  {
    file: "src/test/setup.ts",
    contains: "reliabilityGuardPresence",
    why: "vitest loads setup.ts for every test file, so deleting the guard files fails the entire suite rather than silently dropping 25 tests",
  },
  {
    file: "vitest.config.ts",
    contains: "supabase/functions/**",
    why: "reliability-engineer-core.test.ts sat outside the include glob and had never run once",
  },
]);

/**
 * A model may not grade its own output against a frozen reference of its own
 * output. See `scripts/run-reliability-qualification.ts`.
 */
export const JUDGE_MUST_BE_INDEPENDENT = true;

export function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

export function loadManifest() {
  return loadJson(MANIFEST_PATH);
}

export function loadSuite() {
  return loadJson(CASES_PATH);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(relativePath) {
  return sha256(readFileSync(path.join(repositoryRoot, relativePath)));
}

export function gitBlobSha(relativePath) {
  return execFileSync("git", ["hash-object", "--", relativePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

/**
 * Canonical serialisation of a golden case: the trap, not its name. Key order
 * is fixed and the three id lists are sorted, so reordering is not a change
 * but rewording, adding or dropping a requirement is.
 */
export function caseFingerprint(item) {
  return sha256(
    JSON.stringify({
      id: item?.id ?? null,
      domain: item?.domain ?? null,
      question: item?.question ?? null,
      expectedSpecialists: [...(item?.expectedSpecialists ?? [])].sort(),
      hardRequirements: [...(item?.hardRequirements ?? [])].sort(),
      forbidden: [...(item?.forbidden ?? [])].sort(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Transitive import closure
// ---------------------------------------------------------------------------

/**
 * Matches `import ... from "x"`, `export ... from "x"`, bare `import "x"` and
 * the `type` marker. Deliberately a regex and not the TypeScript compiler API:
 * this guard has to run from a plain `node` script with no build step, in the
 * same job as `npm run test`, and a parser dependency here would become the
 * next thing that silently stops running.
 */
const IMPORT_PATTERN =
  /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;

/**
 * `import("./x.ts")` with a literal specifier. This used to be invisible to
 * BOTH patterns: `IMPORT_PATTERN` requires whitespace after `import`, and the
 * dynamic-import guard below explicitly skipped literals with a `(?!["'])`
 * lookahead — so the one form that is both exploitable and perfectly
 * resolvable was the one form nothing looked at. One such line inside any
 * protected file reopened the entire closure hole. Literal dynamic imports are
 * now resolved as ordinary value edges.
 */
const LITERAL_DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Non-literal dynamic import: unresolvable, therefore forbidden inside the closure. */
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(?!["'])/g;

const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveFirstParty(fromFile, specifier) {
  // Only relative specifiers are first-party. `npm:`, `jsr:`, `https://` and
  // bare specifiers are third-party dependencies governed by the lockfile and
  // the edge-function boundary check, not by this baseline.
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(
    path.dirname(path.join(repositoryRoot, fromFile)),
    specifier,
  );
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      return path.relative(repositoryRoot, candidate).split(path.sep).join("/");
    }
  }
  return { unresolved: specifier, from: fromFile };
}

/**
 * Every import edge a single source file declares. Exported so the regression
 * tests can prove the two blind spots are closed without needing fixture files
 * on disk inside the repository.
 */
export function extractImportEdges(source) {
  const edges = [];
  IMPORT_PATTERN.lastIndex = 0;
  let match;
  while ((match = IMPORT_PATTERN.exec(source)) !== null) {
    edges.push({ specifier: match[2], typeOnly: Boolean(match[1]), dynamic: false });
  }
  LITERAL_DYNAMIC_IMPORT_PATTERN.lastIndex = 0;
  while ((match = LITERAL_DYNAMIC_IMPORT_PATTERN.exec(source)) !== null) {
    edges.push({ specifier: match[1], typeOnly: false, dynamic: true });
  }
  DYNAMIC_IMPORT_PATTERN.lastIndex = 0;
  const nonLiteralDynamic = DYNAMIC_IMPORT_PATTERN.test(source);
  return { edges, nonLiteralDynamic };
}

/**
 * Walk the first-party import graph from the given entrypoints.
 *
 * HOW DEEP: unbounded. A two-hop rewrite changes Reliability Engineer output
 * exactly as much as a one-hop rewrite does, and the measured closure is ~22
 * modules, so there is no cost argument for a depth limit. A depth limit would
 * only be a documented place to hide.
 *
 * TYPE-ONLY EDGES: the target module is RECORDED but NOT TRAVERSED.
 *   - Recorded, because an `import type` still carries a contract. Widening
 *     `PublicDecisionCaseContext` or `ReliabilityCitation` changes what the
 *     prompt builder will accept and serialise into an engineering answer;
 *     that is a behaviour change with no runtime edge to show for it.
 *   - Not traversed, because a type-only edge is erased at runtime. Nothing
 *     the target module *imports* can execute inside the Reliability Engineer
 *     by way of that edge.
 *
 * THE LATCH BUG THIS NOW AVOIDS: the first version marked a module visited on
 * first dequeue and never revisited it, so whichever edge arrived first
 * decided whether its subtree was traversed. That already misfired on the
 * flagship case — `reliability-engineer-request.ts` line 1 is
 * `import type { PublicDecisionCaseContext } from "./decision-case-chat.ts"`
 * and line 2 is the value import, so `decision-case-chat.ts` was latched
 * type-only and its dependencies were never walked. Worse, it was
 * deterministically choosable: adding an `import type` to an earlier
 * entrypoint dropped that module's whole subtree out of the closure. Modules
 * are now keyed by (file, traversed?) and a later value edge re-enqueues a
 * module that was first seen through a type edge.
 */
export function computeProtectedClosure(entrypoints = PROTECTED_ENTRYPOINTS) {
  const modules = new Set();
  const traversed = new Set();
  const edges = [];
  const unresolved = [];
  const dynamic = [];
  const queue = entrypoints.map((entry) => ({ file: entry, typeOnly: false }));

  while (queue.length > 0) {
    const { file, typeOnly } = queue.shift();
    modules.add(file);
    if (typeOnly) continue; // recorded, not traversed — see doc comment.
    if (traversed.has(file)) continue;
    traversed.add(file);

    let source;
    try {
      source = readFileSync(path.join(repositoryRoot, file), "utf8");
    } catch {
      continue;
    }

    const found = extractImportEdges(source);
    if (found.nonLiteralDynamic) dynamic.push(file);

    for (const edge of found.edges) {
      const resolved = resolveFirstParty(file, edge.specifier);
      if (resolved === null) continue;
      if (typeof resolved === "object") {
        unresolved.push(resolved);
        continue;
      }
      edges.push({
        from: file,
        to: resolved,
        typeOnly: edge.typeOnly,
        dynamic: Boolean(edge.dynamic),
      });
      // Re-enqueue on a value edge even when the module is already recorded:
      // a type-first arrival must never decide that its subtree is unreachable.
      if (!modules.has(resolved) || (!edge.typeOnly && !traversed.has(resolved))) {
        queue.push({ file: resolved, typeOnly: edge.typeOnly });
      }
    }
  }

  return { modules: [...modules].sort(), edges, unresolved, dynamic };
}

/**
 * Core closure, and the full closure including the prompt-surface
 * entrypoints. A module reachable from a CORE entrypoint is tier `core` even
 * if it is also reachable from a prompt surface — a tier may only be
 * ratcheted upward.
 */
export function computeTieredClosure() {
  const core = computeProtectedClosure(PROTECTED_ENTRYPOINTS);
  const all = computeProtectedClosure([
    ...PROTECTED_ENTRYPOINTS,
    ...PROMPT_SURFACE_ENTRYPOINTS,
  ]);
  const coreModules = new Set(core.modules);
  const tierOf = (module) =>
    coreModules.has(module) ? TIER_CORE : TIER_PROMPT_SURFACE;
  return { core, all, coreModules, tierOf };
}

/**
 * A regex cannot see `await import(someVariable)`. Rather than pretend
 * otherwise, forbid non-literal dynamic import inside the closure entirely:
 * none of these modules uses one today, and one appearing is exactly the
 * shape of an edge that would slip past the walk. Literal dynamic imports are
 * resolved instead of forbidden — they are perfectly followable, and banning
 * them would have been a rule people route around rather than obey.
 */
export function collectDynamicImportFailures(closureModules, closure) {
  const flagged = closure?.dynamic;
  const files = Array.isArray(flagged)
    ? flagged.filter((file) => closureModules.includes(file))
    : closureModules.filter((file) => {
        let source;
        try {
          source = readFileSync(path.join(repositoryRoot, file), "utf8");
        } catch {
          return false;
        }
        DYNAMIC_IMPORT_PATTERN.lastIndex = 0;
        return DYNAMIC_IMPORT_PATTERN.test(source);
      });
  return [...new Set(files)].map(
    (file) =>
      `${file} uses a non-literal dynamic import; the protected-closure walk cannot follow it. Use a static import (or a literal dynamic import, which the walk does follow), or add the module it can reach to protectedPaths by hand with a comment saying why.`,
  );
}

// ---------------------------------------------------------------------------
// Governed database objects
// ---------------------------------------------------------------------------

export function listMigrations() {
  const dir = path.join(repositoryRoot, MIGRATIONS_DIRECTORY);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Digest of every migration that mentions the object. Deliberately coarse:
 * mentioning a governed retrieval function in a migration at all is a
 * governed change, and a coarse digest cannot be defeated by moving the
 * definition around inside the file.
 */
export function computeDatabaseObjectDigests(objects = PROTECTED_DATABASE_OBJECTS) {
  const migrations = listMigrations();
  const contents = new Map();
  for (const name of migrations) {
    contents.set(
      name,
      readFileSync(path.join(repositoryRoot, MIGRATIONS_DIRECTORY, name), "utf8"),
    );
  }
  const digests = {};
  for (const object of objects) {
    const pattern = new RegExp(`\\b${object}\\b`);
    const parts = [];
    for (const name of migrations) {
      const body = contents.get(name);
      if (pattern.test(body)) parts.push(`${name}:${sha256(body)}`);
    }
    digests[object] = sha256(parts.join("\n"));
  }
  return digests;
}

// ---------------------------------------------------------------------------
// Floor assertions
// ---------------------------------------------------------------------------

function numberOrNaN(value) {
  return typeof value === "number" ? value : Number.NaN;
}

function readPointer(value, pointer) {
  let current = value;
  for (const key of pointer) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

/**
 * The guard cannot be deleted, only argued with. Checks that every file the
 * floor depends on still exists and that the wiring which causes it to RUN is
 * still in place.
 */
export function collectGuardFailures() {
  const failures = [];
  for (const file of REQUIRED_GUARD_FILES) {
    if (!existsSync(path.join(repositoryRoot, file))) {
      failures.push(
        `${file} is missing. It is part of the RE-2026.08 enforcement chain; deleting it disarms the floor rather than changing it.`,
      );
    }
  }
  for (const wiring of REQUIRED_GUARD_WIRING) {
    const absolute = path.join(repositoryRoot, wiring.file);
    if (!existsSync(absolute)) continue; // already reported above
    let haystack;
    if (wiring.jsonPointer) {
      try {
        haystack = String(
          readPointer(JSON.parse(readFileSync(absolute, "utf8")), wiring.jsonPointer) ??
            "",
        );
      } catch {
        failures.push(`${wiring.file} could not be parsed as JSON`);
        continue;
      }
    } else {
      haystack = readFileSync(absolute, "utf8");
    }
    if (!haystack.includes(wiring.contains)) {
      failures.push(
        `${wiring.file}${wiring.jsonPointer ? ` (${wiring.jsonPointer.join(".")})` : ""} no longer contains ${JSON.stringify(wiring.contains)} — ${wiring.why}`,
      );
    }
  }
  return failures;
}

/**
 * Everything the manifest is not allowed to be. Returns a list of human
 * failures rather than throwing, so callers can report all of them at once —
 * a gate that reveals one violation per run trains people to weaken it one
 * value per run.
 */
export function collectFloorFailures(manifest, suite) {
  const failures = [];

  if (manifest?.baselineId !== REQUIRED_BASELINE_ID) {
    failures.push(
      `manifest.baselineId must be ${REQUIRED_BASELINE_ID}; found ${JSON.stringify(manifest?.baselineId)}`,
    );
  }
  if (manifest?.promptVersion !== REQUIRED_PROMPT_VERSION) {
    failures.push(
      `manifest.promptVersion must be ${REQUIRED_PROMPT_VERSION}; found ${JSON.stringify(manifest?.promptVersion)}`,
    );
  }
  if (!(numberOrNaN(manifest?.minimumCaseCount) >= MINIMUM_CASE_COUNT)) {
    failures.push(
      `manifest.minimumCaseCount must be >= ${MINIMUM_CASE_COUNT} (the floor); found ${JSON.stringify(manifest?.minimumCaseCount)}`,
    );
  }

  const declaredPaths = Array.isArray(manifest?.protectedPaths)
    ? manifest.protectedPaths
    : [];
  if (declaredPaths.length < MINIMUM_PROTECTED_PATH_COUNT) {
    failures.push(
      `manifest.protectedPaths holds ${declaredPaths.length} entries; the floor is ${MINIMUM_PROTECTED_PATH_COUNT}. The set may only be ratcheted wider. If a module was legitimately merged into another, lower this count in scripts/reliability-baseline-floor.mjs and in src/test/reliabilityBaselineRatchet.test.ts and say why in the PR body.`,
    );
  }
  const declaredPathSet = new Set(declaredPaths.map((entry) => entry?.path));
  const declaredTier = new Map(
    declaredPaths.map((entry) => [entry?.path, entry?.tier]),
  );

  for (const entrypoint of PROTECTED_ENTRYPOINTS) {
    if (!declaredPathSet.has(entrypoint)) {
      failures.push(
        `manifest.protectedPaths dropped the hardcoded core entrypoint ${entrypoint}; the protected set may only be ratcheted wider, never narrower`,
      );
    } else if (declaredTier.get(entrypoint) !== TIER_CORE) {
      failures.push(
        `core entrypoint ${entrypoint} must be declared tier "${TIER_CORE}"; found ${JSON.stringify(declaredTier.get(entrypoint))}. A tier may only be ratcheted upward.`,
      );
    }
  }
  for (const entrypoint of PROMPT_SURFACE_ENTRYPOINTS) {
    if (!declaredPathSet.has(entrypoint)) {
      failures.push(
        `manifest.protectedPaths dropped the hardcoded prompt-surface entrypoint ${entrypoint}; it carries Reliability Engineer instruction text or deterministic engineering numbers into an answer`,
      );
    }
  }
  for (const entry of declaredPaths) {
    if (typeof entry?.path !== "string" || !entry.path) {
      failures.push("every manifest.protectedPaths entry needs a path");
      continue;
    }
    if (!PROTECTED_TIERS.includes(entry.tier)) {
      failures.push(
        `protected path ${entry.path} needs tier one of ${PROTECTED_TIERS.join(" | ")}; found ${JSON.stringify(entry.tier)}`,
      );
    }
    if (!/^[0-9a-f]{40}$/.test(String(entry.gitBlobSha ?? ""))) {
      failures.push(
        `protected path ${entry.path} needs a 40-hex gitBlobSha pinning the accepted floor blob`,
      );
    }
    if (!existsSync(path.join(repositoryRoot, entry.path))) {
      failures.push(`protected path is missing from the working tree: ${entry.path}`);
    }
  }

  const thresholds = manifest?.releaseThresholds ?? {};
  for (const [key, minimum] of Object.entries(MINIMUM_RELEASE_THRESHOLDS)) {
    const actual = numberOrNaN(thresholds[key]);
    if (!(actual >= minimum)) {
      failures.push(
        `releaseThresholds.${key} must be >= ${minimum} (the floor); found ${JSON.stringify(thresholds[key])}`,
      );
    }
  }
  const regressionsAllowed = numberOrNaN(thresholds.dimensionRegressionsAllowed);
  if (!(regressionsAllowed <= MAXIMUM_ALLOWANCES.dimensionRegressionsAllowed)) {
    failures.push(
      `releaseThresholds.dimensionRegressionsAllowed must be <= ${MAXIMUM_ALLOWANCES.dimensionRegressionsAllowed}; found ${JSON.stringify(thresholds.dimensionRegressionsAllowed)}`,
    );
  }
  if (thresholds.humanSMEApprovalRequired !== true) {
    failures.push(
      "releaseThresholds.humanSMEApprovalRequired must stay true; a model may not release itself",
    );
  }

  const zeroTolerance = manifest?.zeroTolerance ?? {};
  for (const key of ZERO_TOLERANCE_KEYS) {
    const actual = numberOrNaN(zeroTolerance[key]);
    if (!(actual <= MAXIMUM_ALLOWANCES[key])) {
      failures.push(
        `zeroTolerance.${key} must be <= ${MAXIMUM_ALLOWANCES[key]}; found ${JSON.stringify(zeroTolerance[key])}`,
      );
    }
  }

  const dimensions = Array.isArray(manifest?.qualityDimensions)
    ? new Set(manifest.qualityDimensions)
    : new Set();
  for (const dimension of REQUIRED_QUALITY_DIMENSIONS) {
    if (!dimensions.has(dimension)) {
      failures.push(`qualityDimensions dropped ${dimension}`);
    }
  }

  if (manifest?.judgeIndependenceRequired !== true) {
    failures.push(
      "manifest.judgeIndependenceRequired must be true; the candidate model may not grade itself",
    );
  }
  if (manifest?.evidenceProvenanceRequired !== true) {
    failures.push(
      "manifest.evidenceProvenanceRequired must be true; hand-written reference outputs and hand-written qualification reports were the cheapest way to defeat this floor",
    );
  }
  if (manifest?.approvalsDirectory !== APPROVALS_DIRECTORY) {
    failures.push(
      `manifest.approvalsDirectory must be ${APPROVALS_DIRECTORY}; found ${JSON.stringify(manifest?.approvalsDirectory)}`,
    );
  }

  const declaredObjects = new Map(
    (Array.isArray(manifest?.protectedDatabaseObjects)
      ? manifest.protectedDatabaseObjects
      : []
    ).map((entry) => [entry?.object, entry?.definitionDigest]),
  );
  for (const object of PROTECTED_DATABASE_OBJECTS) {
    if (!declaredObjects.has(object)) {
      failures.push(
        `manifest.protectedDatabaseObjects dropped ${object}; the Reliability Engineer system prompt is partly assembled from what this object returns`,
      );
    } else if (!/^[0-9a-f]{64}$/.test(String(declaredObjects.get(object) ?? ""))) {
      failures.push(
        `protected database object ${object} needs a 64-hex definitionDigest`,
      );
    }
  }

  const cases = Array.isArray(suite?.cases) ? suite.cases : [];
  const caseIds = new Set(cases.map((item) => item?.id));
  if (caseIds.size !== cases.length) {
    failures.push("golden suite contains duplicate case ids");
  }
  const byId = new Map(cases.map((item) => [item?.id, item]));
  for (const [id, fingerprint] of Object.entries(REQUIRED_CASE_FINGERPRINTS)) {
    const item = byId.get(id);
    if (!item) {
      failures.push(
        `golden case ${id} was removed; the suite may grow but no accepted trap may be dropped`,
      );
      continue;
    }
    const actual = caseFingerprint(item);
    if (actual !== fingerprint) {
      failures.push(
        `golden case ${id} was rewritten (fingerprint ${actual}, floor ${fingerprint}). The id is not the trap — the question paired with its hardRequirements and forbidden lists is. Update REQUIRED_CASE_FINGERPRINTS in scripts/reliability-baseline-floor.mjs AND the aggregate digest in src/test/reliabilityBaselineRatchet.test.ts, and say in the PR body which trap changed and why.`,
      );
    }
  }
  if (cases.length < MINIMUM_CASE_COUNT) {
    failures.push(
      `golden suite must hold at least ${MINIMUM_CASE_COUNT} cases; found ${cases.length}`,
    );
  }
  if (suite?.baselineId !== REQUIRED_BASELINE_ID) {
    failures.push(`cases.json baselineId must be ${REQUIRED_BASELINE_ID}`);
  }

  return failures;
}

/**
 * The manifest's protected set must cover the entire transitive closure of the
 * entrypoints. Without this, `reliability-engineer-request.ts` (protected) can
 * import `decision-case-chat.ts` (not protected) and the whole Decision Case
 * prompt can be rewritten with the gate never running.
 */
export function collectClosureFailures(manifest, closure) {
  const failures = [];
  const tiered = closure ? null : computeTieredClosure();
  const walk = closure ?? tiered.all;
  const coreModules = tiered
    ? tiered.coreModules
    : new Set(computeProtectedClosure(PROTECTED_ENTRYPOINTS).modules);
  const entries = Array.isArray(manifest?.protectedPaths)
    ? manifest.protectedPaths
    : [];
  const declared = new Map(entries.map((entry) => [entry?.path, entry]));

  for (const item of walk.unresolved) {
    failures.push(
      `could not resolve first-party import ${JSON.stringify(item.unresolved)} from ${item.from}; the protected closure cannot be proven complete`,
    );
  }

  for (const module of walk.modules) {
    const entry = declared.get(module);
    if (!entry) {
      const via = [
        ...new Set(walk.edges.filter((edge) => edge.to === module).map((edge) => edge.from)),
      ];
      failures.push(
        `${module} is transitively reachable from the protected Reliability Engineer surface (imported by ${via.join(", ") || "an entrypoint"}) but is absent from manifest.protectedPaths. Rewriting it changes Reliability Engineer behaviour with the release gate never running. Add it to protectedPaths with its current gitBlobSha and tier, or remove the import.`,
      );
      continue;
    }
    if (coreModules.has(module) && entry.tier !== TIER_CORE) {
      failures.push(
        `${module} is reachable from a CORE Reliability Engineer entrypoint but is declared tier ${JSON.stringify(entry.tier)}. Reachability decides the tier; a tier may only be ratcheted upward.`,
      );
    }
  }

  failures.push(...collectDynamicImportFailures(walk.modules, walk));
  return failures;
}

// ---------------------------------------------------------------------------
// Evidence integrity
// ---------------------------------------------------------------------------

/**
 * Everything that can be decided about an evidence file WITHOUT the network.
 *
 * Pure and exported so `src/test/reliabilityBaselineRatchet.test.ts` can run
 * the actual forgeries three adversarial reviewers used — a report with
 * `verdict: "qualified"` typed in by hand, a reference with no provenance, a
 * report produced by a different harness — against the real code rather than
 * against a grep of it.
 */
export function collectProvenanceFailures(label, artefact) {
  const failures = [];
  const provenance = artefact?.provenance;
  if (!provenance || typeof provenance !== "object") {
    return [
      `${label} carries no provenance block. Evidence must name the CI run that produced it; a hand-written file is precisely what this floor exists to refuse.`,
    ];
  }
  for (const field of PROVENANCE_REQUIRED_FIELDS) {
    if (!String(provenance[field] ?? "").trim()) {
      failures.push(`${label} provenance is missing ${field}`);
    }
  }
  if (provenance.githubRepository && provenance.githubRepository !== REPOSITORY) {
    failures.push(
      `${label} was produced against ${provenance.githubRepository}, not ${REPOSITORY}`,
    );
  }
  if (!/^[0-9]+$/.test(String(provenance.githubRunId ?? ""))) {
    failures.push(`${label} provenance githubRunId must be a numeric Actions run id`);
  }
  if (provenance.runnerEnvironment !== "github-actions") {
    failures.push(
      `${label} was produced with runnerEnvironment ${JSON.stringify(provenance.runnerEnvironment)}; only evidence from a GitHub Actions run may become the floor`,
    );
  }
  if (!EVIDENCE_PRODUCERS.includes(provenance.producer)) {
    failures.push(
      `${label} names producer ${JSON.stringify(provenance.producer)}; only ${EVIDENCE_PRODUCERS.join(" or ")} may produce evidence`,
    );
  } else if (!existsSync(path.join(repositoryRoot, provenance.producer))) {
    failures.push(`${label} names producer ${provenance.producer}, which no longer exists`);
  } else {
    const producerDigest = sha256File(provenance.producer);
    if (provenance.producerSha256 !== producerDigest) {
      failures.push(
        `${label} was produced by a different version of ${provenance.producer} (evidence ${provenance.producerSha256}, working tree ${producerDigest}). The harness decides WHAT gets qualified — which prompt is built, which questions count as deliverables, what the judge is told — so qualifying with one harness and shipping another is not evidence.`,
      );
    }
  }
  const casesDigest = sha256File(CASES_PATH);
  if (provenance.casesSha256 && provenance.casesSha256 !== casesDigest) {
    failures.push(
      `${label} was produced against a different golden suite (evidence ${provenance.casesSha256}, working tree ${casesDigest})`,
    );
  }
  return failures;
}

/**
 * The machine report must be byte-untouched. Human approval is a sidecar.
 */
export function collectMachineReportFailures(report) {
  const failures = [];
  if (report?.dryRun === true) {
    failures.push(
      "qualification report is a `--dry-run` plumbing check, not evidence about the model",
    );
  }
  if (report?.verdict !== MACHINE_REPORT_VERDICT) {
    failures.push(
      `qualification report verdict must still be ${JSON.stringify(MACHINE_REPORT_VERDICT)} exactly as the harness wrote it; found ${JSON.stringify(report?.verdict)}. Human approval belongs in a ${APPROVALS_DIRECTORY}/ sidecar recording this report's sha256 — never by editing the evidence.`,
    );
  }
  if (report?.humanReview?.status !== "pending") {
    failures.push(
      `qualification report humanReview.status must remain "pending"; found ${JSON.stringify(report?.humanReview?.status)}`,
    );
  }
  return failures;
}

/** Shape of any approval sidecar, independent of kind. */
export function collectApprovalShapeFailures(record, baselineId = REQUIRED_BASELINE_ID) {
  const failures = [];
  for (const field of APPROVAL_REQUIRED_FIELDS) {
    if (!String(record?.[field] ?? "").trim()) {
      failures.push(`approval record is missing ${field}`);
    }
  }
  if (record?.baselineId && record.baselineId !== baselineId) {
    failures.push(`approval record targets ${record.baselineId}, not ${baselineId}`);
  }
  if (record?.kind && !APPROVAL_KINDS.includes(record.kind)) {
    failures.push(
      `approval record kind ${JSON.stringify(record.kind)} is not one of ${APPROVAL_KINDS.join(", ")}`,
    );
  }
  if (record?.reviewedAt && Number.isNaN(Date.parse(record.reviewedAt))) {
    failures.push("approval record needs an ISO-8601 reviewedAt");
  }
  return failures;
}
