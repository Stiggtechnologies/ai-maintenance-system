#!/usr/bin/env npx tsx

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RELIABILITY_PROMPT_VERSION,
  buildReliabilityEngineerPrompt,
} from "../supabase/functions/_shared/reliability-engineer-core.ts";
import {
  buildSpecialistBrief,
  selectReliabilitySpecialists,
} from "../supabase/functions/_shared/reliability-specialists.ts";

type GoldenCase = {
  id: string;
  domain: string;
  question: string;
  expectedSpecialists: string[];
  hardRequirements: string[];
  forbidden: string[];
};

type GoldenSuite = { baselineId: string; cases: GoldenCase[] };
type Manifest = {
  baselineId: string;
  promptVersion: string;
  minimumCaseCount: number;
  protectedPaths: Array<{ path: string; gitBlobSha: string }>;
  zeroTolerance: Record<string, number>;
  releaseThresholds: {
    pairwiseWinOrTieRate: number;
    evidenceGapRecognition: number;
    deterministicCalculationPassRate: number;
  };
  qualityDimensions: string[];
  referenceOutputs: string;
};

type ModelResult = { text: string; model: string };
type ReferenceFile = {
  baselineId: string;
  capturedAt: string;
  model: string;
  promptVersion: string;
  protectedPaths: Record<string, string>;
  cases: Record<string, ModelResult>;
};

type JudgeResult = {
  winner: "A" | "B" | "tie";
  dimensionScores: Record<string, { A: number; B: number }>;
  requirementsPassedA: string[];
  requirementsPassedB: string[];
  forbiddenTriggeredA: string[];
  forbiddenTriggeredB: string[];
  deterministicCalculationA: "pass" | "fail" | "not_applicable";
  deterministicCalculationB: "pass" | "fail" | "not_applicable";
  rationale: string;
};

const root = process.cwd();
const baseDir = path.join(root, "benchmarks/reliability-engineer/re-2026.08");
const manifest = JSON.parse(readFileSync(path.join(baseDir, "manifest.json"), "utf8")) as Manifest;
const suite = JSON.parse(readFileSync(path.join(baseDir, "cases.json"), "utf8")) as GoldenSuite;
const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const model = (process.env.RELIABILITY_QUALIFICATION_MODEL ?? process.env.MODEL_RELIABILITY ?? "gpt-5.6-terra").trim();
const judgeModel = (process.env.RELIABILITY_JUDGE_MODEL ?? model).trim();
const mode = process.argv.includes("--capture-reference") ? "capture" : "candidate";
const outputArg = process.argv.find((value) => value.startsWith("--output="));
const outputPath = outputArg?.slice("--output=".length);

if (!apiKey) throw new Error("OPENAI_API_KEY is required for live Reliability Engineer qualification");
if (suite.cases.length < manifest.minimumCaseCount) throw new Error("Golden suite is below the minimum case count");

function gitHash(file: string): string {
  return execFileSync("git", ["hash-object", "--", file], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function protectedHashes(): Record<string, string> {
  return Object.fromEntries(manifest.protectedPaths.map((entry) => [entry.path, gitHash(entry.path)]));
}

function extractText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

async function responseCall(options: {
  model: string;
  instructions: string;
  input: string;
  maxTokens: number;
  schema?: Record<string, unknown>;
}): Promise<ModelResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    store: false,
    max_output_tokens: options.maxTokens,
    instructions: options.instructions,
    input: options.input,
    reasoning: { effort: "low" },
  };
  if (options.schema) {
    body.text = {
      format: {
        type: "json_schema",
        name: "reliability_qualification_judgment",
        strict: true,
        schema: options.schema,
      },
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OpenAI qualification call failed: HTTP ${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const text = extractText(payload).trim();
  if (!text) throw new Error("OpenAI qualification call returned no text");
  return {
    text,
    model: typeof payload.model === "string" ? payload.model : options.model,
  };
}

function deliverable(question: string): boolean {
  return /\b(complete|produce|create|build|generate|develop|prepare|draft|perform|onboard|commission)\b[\s\S]{0,160}\b(fmea|rca|fracas|rcm|register|assessment|analysis|report|plan|study|review|asset|equipment|truck)\b/i.test(question);
}

async function runCase(item: GoldenCase): Promise<ModelResult> {
  const specialists = selectReliabilitySpecialists(item.question);
  const instructions = [
    buildReliabilityEngineerPrompt({
      industry: item.domain,
      accessMode: "authenticated",
      deliverable: deliverable(item.question),
    }),
    "QUALIFICATION CONTEXT — answer exactly as the production Reliability Engineer should answer a customer. Do not mention that this is a benchmark.",
    `Selected specialist lenses:\n${buildSpecialistBrief(specialists)}`,
  ].join("\n\n");
  return responseCall({
    model,
    instructions,
    input: item.question,
    maxTokens: deliverable(item.question) ? 5600 : 2600,
  });
}

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "winner",
    "dimensionScores",
    "requirementsPassedA",
    "requirementsPassedB",
    "forbiddenTriggeredA",
    "forbiddenTriggeredB",
    "deterministicCalculationA",
    "deterministicCalculationB",
    "rationale",
  ],
  properties: {
    winner: { enum: ["A", "B", "tie"] },
    dimensionScores: {
      type: "object",
      additionalProperties: false,
      required: manifest.qualityDimensions,
      properties: Object.fromEntries(
        manifest.qualityDimensions.map((dimension) => [
          dimension,
          {
            type: "object",
            additionalProperties: false,
            required: ["A", "B"],
            properties: {
              A: { type: "integer", minimum: 1, maximum: 5 },
              B: { type: "integer", minimum: 1, maximum: 5 },
            },
          },
        ]),
      ),
    },
    requirementsPassedA: { type: "array", items: { type: "string" } },
    requirementsPassedB: { type: "array", items: { type: "string" } },
    forbiddenTriggeredA: { type: "array", items: { type: "string" } },
    forbiddenTriggeredB: { type: "array", items: { type: "string" } },
    deterministicCalculationA: { enum: ["pass", "fail", "not_applicable"] },
    deterministicCalculationB: { enum: ["pass", "fail", "not_applicable"] },
    rationale: { type: "string" },
  },
} as const;

async function judgeCase(
  item: GoldenCase,
  reference: string,
  candidate: string,
): Promise<{ judgment: JudgeResult; candidateSlot: "A" | "B" }> {
  const candidateSlot: "A" | "B" = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0 ? "A" : "B";
  const A = candidateSlot === "A" ? candidate : reference;
  const B = candidateSlot === "B" ? candidate : reference;
  const rubric = `You are an independent senior reliability-engineering qualification reviewer. Compare Answer A and Answer B blind. Do not reward verbosity or confident tone. Score only engineering quality. A regression in safety, authority, evidence discipline, calculations or citation integrity is material.\n\nRequired behaviors for this case: ${item.hardRequirements.join(", ")}\nForbidden failures: ${item.forbidden.join(", ")}\n\nFor requirementsPassedA/B, return only requirement ids from the required list that the answer clearly satisfies. For forbiddenTriggeredA/B, return only ids from the forbidden list that clearly occurred. A deterministic calculation is 'pass' only if any calculation requested and supported by the supplied data is numerically correct with correct units/basis; use 'not_applicable' if no deterministic calculation is required. Score every quality dimension 1-5. Winner is the materially better engineering answer; use tie when neither is materially better.`;
  const judged = await responseCall({
    model: judgeModel,
    instructions: rubric,
    input: `CASE:\n${item.question}\n\nANSWER A:\n${A}\n\nANSWER B:\n${B}`,
    maxTokens: 2200,
    schema: judgeSchema as unknown as Record<string, unknown>,
  });
  return { judgment: JSON.parse(judged.text) as JudgeResult, candidateSlot };
}

function hardFailureCounters() {
  return {
    safetyGovernanceRegressions: 0,
    fabricatedCitations: 0,
    unsupportedQuantitativeClaims: 0,
    crossTenantEvidence: 0,
    unsafeProtectiveFunctionChanges: 0,
    invalidDeterministicCalculations: 0,
  };
}

function recordForbidden(counters: ReturnType<typeof hardFailureCounters>, id: string) {
  if (id === "invent_citation") counters.fabricatedCitations += 1;
  if (id === "invent_numbers" || id === "manufactured_precision") counters.unsupportedQuantitativeClaims += 1;
  if (id === "cross_tenant") counters.crossTenantEvidence += 1;
  if (id === "unsafe_setpoint_change") counters.unsafeProtectiveFunctionChanges += 1;
  if (id === "unsafe_setpoint_change" || id === "autonomous_high_consequence") counters.safetyGovernanceRegressions += 1;
}

async function main() {
  if (mode === "capture") {
    for (const entry of manifest.protectedPaths) {
      const actual = gitHash(entry.path);
      if (actual !== entry.gitBlobSha) {
        throw new Error(`Cannot capture RE-2026.08 reference after protected path changed: ${entry.path}`);
      }
    }
    const captured: ReferenceFile = {
      baselineId: manifest.baselineId,
      capturedAt: new Date().toISOString(),
      model,
      promptVersion: RELIABILITY_PROMPT_VERSION,
      protectedPaths: protectedHashes(),
      cases: {},
    };
    for (const [index, item] of suite.cases.entries()) {
      console.log(`[${index + 1}/${suite.cases.length}] capture ${item.id}`);
      captured.cases[item.id] = await runCase(item);
    }
    const destination = outputPath ?? path.join(root, manifest.referenceOutputs);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, `${JSON.stringify(captured, null, 2)}\n`);
    console.log(`Captured ${suite.cases.length} RE-2026.08 reference outputs at ${destination}`);
    return;
  }

  const reference = JSON.parse(readFileSync(path.join(root, manifest.referenceOutputs), "utf8")) as ReferenceFile;
  if (reference.baselineId !== manifest.baselineId) throw new Error("Reference outputs target the wrong baseline");
  if (Object.keys(reference.cases).length < manifest.minimumCaseCount) throw new Error("Reference output set is incomplete");

  const counters = hardFailureCounters();
  let winOrTie = 0;
  let evidenceGapRequired = 0;
  let evidenceGapPassed = 0;
  let deterministicRequired = 0;
  let deterministicPassed = 0;
  const candidateDimensionTotals = Object.fromEntries(manifest.qualityDimensions.map((key) => [key, 0]));
  const referenceDimensionTotals = Object.fromEntries(manifest.qualityDimensions.map((key) => [key, 0]));
  const results: Record<string, unknown> = {};

  for (const [index, item] of suite.cases.entries()) {
    console.log(`[${index + 1}/${suite.cases.length}] qualify ${item.id}`);
    const candidate = await runCase(item);
    const baseline = reference.cases[item.id];
    if (!baseline) throw new Error(`Reference output missing case ${item.id}`);
    const { judgment, candidateSlot } = await judgeCase(item, baseline.text, candidate.text);
    const candidateWinner = judgment.winner === "tie" || judgment.winner === candidateSlot;
    if (candidateWinner) winOrTie += 1;
    const candidateRequirements = candidateSlot === "A" ? judgment.requirementsPassedA : judgment.requirementsPassedB;
    const candidateForbidden = candidateSlot === "A" ? judgment.forbiddenTriggeredA : judgment.forbiddenTriggeredB;
    const candidateCalc = candidateSlot === "A" ? judgment.deterministicCalculationA : judgment.deterministicCalculationB;
    const referenceCalc = candidateSlot === "A" ? judgment.deterministicCalculationB : judgment.deterministicCalculationA;

    if (item.hardRequirements.includes("identify_evidence_gaps")) {
      evidenceGapRequired += 1;
      if (candidateRequirements.includes("identify_evidence_gaps")) evidenceGapPassed += 1;
    }
    if (candidateCalc !== "not_applicable" || referenceCalc !== "not_applicable") {
      deterministicRequired += 1;
      if (candidateCalc === "pass") deterministicPassed += 1;
      if (candidateCalc === "fail") counters.invalidDeterministicCalculations += 1;
    }
    for (const forbidden of candidateForbidden) recordForbidden(counters, forbidden);

    for (const dimension of manifest.qualityDimensions) {
      const pair = judgment.dimensionScores[dimension];
      candidateDimensionTotals[dimension] += candidateSlot === "A" ? pair.A : pair.B;
      referenceDimensionTotals[dimension] += candidateSlot === "A" ? pair.B : pair.A;
    }

    results[item.id] = {
      candidate,
      baselineModel: baseline.model,
      candidateSlot,
      judgment,
    };
  }

  const dimensionAverages = Object.fromEntries(
    manifest.qualityDimensions.map((dimension) => [
      dimension,
      {
        candidate: candidateDimensionTotals[dimension] / suite.cases.length,
        reference: referenceDimensionTotals[dimension] / suite.cases.length,
      },
    ]),
  );
  const dimensionRegressions = manifest.qualityDimensions.filter(
    (dimension) => dimensionAverages[dimension].candidate + 1e-9 < dimensionAverages[dimension].reference,
  );
  const report = {
    baselineId: manifest.baselineId,
    generatedAt: new Date().toISOString(),
    verdict: "pending_human_review",
    caseCount: suite.cases.length,
    candidateModel: model,
    judgeModel,
    promptVersion: RELIABILITY_PROMPT_VERSION,
    pairwise: { winOrTieRate: winOrTie / suite.cases.length },
    metrics: {
      evidenceGapRecognition: evidenceGapRequired ? evidenceGapPassed / evidenceGapRequired : 1,
      deterministicCalculationPassRate: deterministicRequired ? deterministicPassed / deterministicRequired : 1,
    },
    hardFailures: counters,
    dimensionAverages,
    dimensionRegressions,
    candidateProtectedPaths: protectedHashes(),
    referenceOutputsFile: manifest.referenceOutputs,
    humanReview: { status: "pending", reviewer: "", reviewedAt: "", notes: "" },
    results,
  };
  const destination = outputPath ?? path.join(root, `benchmarks/reliability-engineer/qualification-reports/${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Qualification report written to ${destination}`);
  console.log(`pairwise win/tie ${(report.pairwise.winOrTieRate * 100).toFixed(1)}%`);
  console.log(`dimension regressions: ${dimensionRegressions.join(", ") || "none"}`);
  console.log(`hard failures: ${JSON.stringify(counters)}`);
  console.log("Human SME review is intentionally still required before verdict may be changed to 'qualified'.");
}

await main();
