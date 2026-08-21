#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PRODUCER = "scripts/capture-reliability-production-reference.mjs";

const root = process.cwd();
const projectRef = (process.env.SUPABASE_PROJECT_ID ?? "pjvoswbwomesuwhygpby").trim();
const managementToken = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputPath = outputArg?.slice("--output=".length) ??
  path.join(root, "benchmarks/reliability-engineer/re-2026.08/reference-outputs.json");

if (!managementToken) {
  throw new Error("SUPABASE_ACCESS_TOKEN is required for production Reliability Engineer reference capture");
}

const manifest = JSON.parse(
  readFileSync(
    path.join(root, "benchmarks/reliability-engineer/re-2026.08/manifest.json"),
    "utf8",
  ),
);
const suite = JSON.parse(
  readFileSync(
    path.join(root, "benchmarks/reliability-engineer/re-2026.08/cases.json"),
    "utf8",
  ),
);

function gitHash(file) {
  return execFileSync("git", ["hash-object", "--", file], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

for (const entry of manifest.protectedPaths) {
  const actual = gitHash(entry.path);
  if (actual !== entry.gitBlobSha) {
    throw new Error(
      `Cannot capture RE-2026.08 after protected implementation changed: ${entry.path}`,
    );
  }
}

/**
 * KEY SELECTION — the recorded operational fact this used to ignore.
 *
 * This function originally selected the LEGACY `service_role` JWT. This
 * project's edge functions reject that key: production authenticates with the
 * newer `sb_secret_...` publishable/secret key, and the legacy JWT comes back
 * unauthorized. Since this capture route has never actually been executed, the
 * first person to try it would have hit a 401 with no explanation.
 *
 * So prefer a revealed `sb_secret_` key, fall back to the legacy JWT with a
 * loud warning, and say which one was used in the error if the call fails.
 */
async function getServiceKey() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${managementToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase Management API key lookup failed: HTTP ${response.status}`);
  }
  const keys = await response.json();
  if (!Array.isArray(keys)) throw new Error("Supabase Management API returned an invalid API-key payload");

  const secret = keys.find(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.api_key === "string" &&
      item.api_key.startsWith("sb_secret_"),
  );
  if (secret?.api_key) return { key: secret.api_key, kind: "sb_secret" };

  const legacy = keys.find((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item;
    return (
      record.type === "legacy" &&
      typeof record.api_key === "string" &&
      record.api_key.length > 20 &&
      (record.name === "service_role" || record.secret_jwt_template?.role === "service_role")
    );
  });
  if (!legacy?.api_key) {
    throw new Error(
      "No revealed sb_secret_ key and no legacy service_role key are available for the production project",
    );
  }
  console.warn(
    "WARNING: no sb_secret_ key was revealed; falling back to the legacy service_role JWT. This project's edge functions have been observed to reject the legacy JWT with 'unauthorized'. If every case fails with HTTP 401, that is the cause.",
  );
  return { key: legacy.api_key, kind: "legacy_service_role" };
}

function deliverable(question) {
  return /\b(complete|produce|create|build|generate|develop|prepare|draft|perform|onboard|commission)\b[\s\S]{0,160}\b(fmea|rca|fracas|rcm|register|assessment|analysis|report|plan|study|review|asset|equipment|truck)\b/i.test(question);
}

async function runProductionCase(serviceRoleKey, item) {
  const response = await fetch(
    `https://${projectRef}.supabase.co/functions/v1/ai-agent-processor`,
    {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentType: "ReliabilityAgent",
        industry: item.domain,
        query: item.question,
        requiresApproval: true,
        depth: deliverable(item.question) ? "deliverable" : "standard",
        publicOnly: true,
        maxOutputTokens: deliverable(item.question) ? 5600 : 2600,
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true || typeof payload?.response !== "string") {
    const safeError = typeof payload?.error === "string" ? payload.error : "invalid_response";
    throw new Error(`Production Reliability Engineer failed case ${item.id}: HTTP ${response.status} ${safeError}`);
  }
  if (payload.promptVersion !== manifest.promptVersion) {
    throw new Error(
      `Production prompt drift on ${item.id}: expected ${manifest.promptVersion}, got ${String(payload.promptVersion)}`,
    );
  }

  return {
    text: payload.response,
    model: String(payload.modelUsed ?? payload.requestedModel ?? "unknown"),
    requestedModel: String(payload.requestedModel ?? "unknown"),
    promptVersion: String(payload.promptVersion),
    knowledgeBaseUsed: payload.knowledgeBaseUsed === true,
    citations: Array.isArray(payload.citations) ? payload.citations : [],
  };
}

function sha256File(relative) {
  return createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
}

/**
 * Provenance, in exactly the shape scripts/check-reliability-baseline.mjs
 * verifies. Reference outputs that do not name a real, successful Actions run
 * are refused — hand-writing this file was the cheapest way found to defeat
 * the whole floor.
 */
function buildProvenance() {
  const env = (name) => (process.env[name] ?? "").trim();
  return {
    producer: PRODUCER,
    producerSha256: sha256File(PRODUCER),
    casesSha256: sha256File("benchmarks/reliability-engineer/re-2026.08/cases.json"),
    manifestSha256: sha256File("benchmarks/reliability-engineer/re-2026.08/manifest.json"),
    githubRepository: env("GITHUB_REPOSITORY"),
    githubRunId: env("GITHUB_RUN_ID"),
    githubRunAttempt: env("GITHUB_RUN_ATTEMPT"),
    githubWorkflow: env("GITHUB_WORKFLOW_REF") || env("GITHUB_WORKFLOW"),
    githubSha: env("GITHUB_SHA"),
    githubRefName: env("GITHUB_REF_NAME"),
    githubActor: env("GITHUB_ACTOR"),
    runnerEnvironment: env("GITHUB_ACTIONS") === "true" ? "github-actions" : "local",
    capturedAt: new Date().toISOString(),
  };
}

const { key: serviceRoleKey, kind: serviceKeyKind } = await getServiceKey();
console.log(`Using ${serviceKeyKind} key for the production capture.`);
const captured = {
  baselineId: manifest.baselineId,
  capturedAt: new Date().toISOString(),
  captureSurface: "production-ai-agent-processor-publicOnly",
  captureCaveat:
    "Captured from production AS DEPLOYED, not from this checkout, and via publicOnly:true — which ai-agent-processor routes to a hardcoded https://api.openai.com/v1/responses call that ignores LLM_BASE_URL and therefore does not traverse the Stigg AI Gateway.",
  serviceKeyKind,
  projectRef,
  promptVersion: manifest.promptVersion,
  provenance: buildProvenance(),
  protectedPaths: Object.fromEntries(
    manifest.protectedPaths.map((entry) => [entry.path, gitHash(entry.path)]),
  ),
  cases: {},
};

for (const [index, item] of suite.cases.entries()) {
  console.log(`[${index + 1}/${suite.cases.length}] capture ${item.id}`);
  captured.cases[item.id] = await runProductionCase(serviceRoleKey, item);
}

const models = [...new Set(Object.values(captured.cases).map((item) => item.model))];
captured.model = models.length === 1 ? models[0] : models;

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(captured, null, 2)}\n`);
console.log(
  `Captured ${suite.cases.length} production RE-2026.08 outputs with ${models.length} observed answering model(s).`,
);
