#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

async function getLegacyServiceRoleKey() {
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
    throw new Error("No revealed legacy service_role key is available for the production project");
  }
  return legacy.api_key;
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

const serviceRoleKey = await getLegacyServiceRoleKey();
const captured = {
  baselineId: manifest.baselineId,
  capturedAt: new Date().toISOString(),
  captureSurface: "production-ai-agent-processor-publicOnly",
  projectRef,
  promptVersion: manifest.promptVersion,
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
