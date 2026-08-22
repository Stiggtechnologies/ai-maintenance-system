#!/usr/bin/env node
/**
 * The model behind the Reliability Engineer must be one that has been qualified.
 *
 * RE-2026.08 pins protected FILES by blob sha. It cannot see the model, because
 * the model is chosen by deployed environment variables — `LLM_BASE_URL`,
 * `LLM_API_KEY`, `TIER_DELIVERABLE`, `MODEL_RELIABILITY`. So today the reasoning
 * model answering a safety-critical question can be changed from a dashboard with
 * no repo diff, no pull request and no review, and every hash gate still passes.
 *
 * The transport is deliberately NOT pinned. `buildProviderChain` accepting any
 * OpenAI-compatible gateway is a correct abstraction, and switching xAI ->
 * gateway -> anything else should stay a config change. What must not be free is
 * changing WHICH MODEL reasons about a protective function.
 *
 * Advisory until `reference-outputs.json` exists, blocking after. A gate that
 * refuses every model before any model can be qualified would just be deleted by
 * whoever needs to deploy.
 *
 * Usage:
 *   node scripts/check-deployed-model.mjs                 # reads process.env
 *   node scripts/check-deployed-model.mjs --config=x.json # a dumped env map
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(
    path.join(root, "benchmarks/reliability-engineer/re-2026.08/manifest.json"),
    "utf8",
  ),
);
const gov = manifest.modelGovernance ?? {};
const qualified = new Set(gov.qualifiedModels ?? []);
const referenceCaptured = existsSync(path.join(root, manifest.referenceOutputs));

const configArg = process.argv.find((a) => a.startsWith("--config="));
const env = configArg
  ? JSON.parse(readFileSync(configArg.slice("--config=".length), "utf8"))
  : process.env;

// Every variable that can decide which model answers a reliability question.
const MODEL_VARS = [
  "MODEL_RELIABILITY",
  "MODEL_DELIVERABLE",
  "MODEL_PUBLIC_FRONTIER",
  "TIER_DELIVERABLE",
  "RELIABILITY_QUALIFICATION_MODEL",
];

const declared = MODEL_VARS.map((name) => [name, (env[name] ?? "").trim()]).filter(
  ([, value]) => value,
);

if (declared.length === 0) {
  console.log(
    "RE model gate: no reliability model variable is set in this environment; nothing to check.",
  );
  process.exit(0);
}

const unqualified = declared.filter(([, value]) => !qualified.has(value));

if (unqualified.length === 0) {
  console.log(
    `RE model gate passed: ${declared.length} variable(s) all name a qualified model.`,
  );
  process.exit(0);
}

const detail = unqualified.map(([n, v]) => `  ${n}=${v}`).join("\n");

if (!referenceCaptured) {
  console.warn(
    [
      "RE model gate ADVISORY (not yet blocking).",
      `${manifest.referenceOutputs} does not exist, so no model can have been qualified yet`,
      "and refusing every deployment would be theatre. These are unqualified:",
      detail,
      "",
      "To make this gate real: add XAI_API_KEY as a repository secret, dispatch",
      "one-shot-capture-re-2026-08, then add the captured model to",
      "manifest.modelGovernance.qualifiedModels.",
    ].join("\n"),
  );
  process.exit(0);
}

console.error(
  [
    "RE MODEL GATE FAILED: the Reliability Engineer would answer on a model that has",
    "never been qualified against RE-2026.08.",
    detail,
    "",
    `Qualified: ${[...qualified].join(", ") || "(none)"}`,
    "",
    "Qualify it, or set the variable to a qualified model. Changing the TRANSPORT",
    "(LLM_BASE_URL / LLM_API_KEY) is free and deliberately not checked here.",
  ].join("\n"),
);
process.exit(1);
