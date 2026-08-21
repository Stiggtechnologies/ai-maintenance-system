/**
 * RE-2026.08 enforcement chain — presence anchor.
 *
 * WHY THIS FILE IS IMPORTED BY `src/test/setup.ts`
 * ------------------------------------------------
 * The floor was built with three redundant layers so that WEAKENING it takes
 * coordinated edits to a script and a test. An adversarial review then showed
 * the layering did not defend against the cheaper attack: DELETING it.
 * Removing `src/test/reliabilityBaselineRatchet.test.ts` and the five-line
 * gate step from `.github/workflows/ci.yml` was a two-file diff after which
 * `npx vitest run` reported 1285 tests passing instead of 1310, every required
 * status check went green, and the gate script — now reachable only from a
 * workflow that is not a required check — never ran again. Nothing asserts a
 * test count, and `npm run test` cannot notice a file that is not there.
 *
 * vitest loads `setup.ts` before every single test file. Importing this module
 * from there means deleting any link in the enforcement chain fails the entire
 * suite immediately and unmissably, rather than quietly shrinking it.
 *
 * The list below is deliberately RE-STATED here rather than imported from
 * `scripts/reliability-baseline-floor.mjs`. Importing it would mean one edit
 * disarms both, which is the whole failure mode this file exists to prevent.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Independent literals. Do not replace with an import — see the header. */
const ENFORCEMENT_CHAIN = [
  "scripts/reliability-baseline-floor.mjs",
  "scripts/check-reliability-baseline.mjs",
  "scripts/run-reliability-qualification.ts",
  "src/test/reliabilityBaselineRatchet.test.ts",
  "src/test/reliabilityEngineerGoldenBaseline.test.ts",
  "benchmarks/reliability-engineer/re-2026.08/manifest.json",
  "benchmarks/reliability-engineer/re-2026.08/cases.json",
] as const;

/**
 * `npm run test` is the command the required `Unit tests` job runs. If the
 * gate is no longer invoked from there, deleting every test that spawns it
 * would be enough to disarm the floor.
 */
const REQUIRED_TEST_WIRING = "check-reliability-baseline.mjs";

const missing = ENFORCEMENT_CHAIN.filter(
  (relative) => !existsSync(path.join(repositoryRoot, relative)),
);

if (missing.length > 0) {
  throw new Error(
    [
      "RE-2026.08 enforcement chain is broken — the following files are missing:",
      ...missing.map((item) => `  - ${item}`),
      "",
      "These are the permanent Reliability Engineer quality floor. Deleting one",
      "disarms the floor rather than changing it. If a file genuinely moved,",
      "update src/test/reliabilityGuardPresence.ts and",
      "scripts/reliability-baseline-floor.mjs in the same commit and say so in",
      "the pull-request body (AGENTS.md, parallel-work rule 3).",
    ].join("\n"),
  );
}

const packageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

if (!(packageJson.scripts?.test ?? "").includes(REQUIRED_TEST_WIRING)) {
  throw new Error(
    [
      `RE-2026.08: package.json "test" no longer runs ${REQUIRED_TEST_WIRING}.`,
      "",
      "The required `Unit tests` CI job runs `npm run test`. The release gate is",
      "invoked from there on purpose, so that deleting the tests that spawn it",
      "does not silently disarm it.",
    ].join("\n"),
  );
}

export const RELIABILITY_ENFORCEMENT_CHAIN = ENFORCEMENT_CHAIN;
