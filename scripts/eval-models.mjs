#!/usr/bin/env node
// ============================================================================
// eval-models.mjs — side-by-side model evaluation harness (gpt-5.6-terra vs
// Grok, or any OpenAI-compatible chat-completions provider).
//
// WHY. All SyncAI edge functions speak OpenAI-compatible chat completions via
// LLM_BASE_URL, and xAI's API is OpenAI-compatible (https://api.x.ai/v1), so
// a provider swap is a config change — IF the answer quality holds. This
// harness produces the evidence for that judgement: the same real prompt
// shapes the product actually sends, run against each configured provider,
// with tokens, latency, and computed CAD cost per response, plus a markdown
// report for human quality review.
//
// USAGE
//   OPENAI_API_KEY=… XAI_API_KEY=… node scripts/eval-models.mjs
//   EVAL_PROVIDERS='[{"name":"xai-grok","baseUrl":"https://api.x.ai","keyEnv":"XAI_API_KEY","model":"grok-4.6"}]' \
//     node scripts/eval-models.mjs
//
// A provider whose key env var is ABSENT is skipped cleanly — so CI, which
// has no model keys, never makes a live model call. There is no fallback key
// and no default that can spend money without an explicit key in the env.
//
// OUTPUT: artifacts/model-eval/<ISO-date>/results.json and report.md.
//
// RATES — CAD per 1M tokens, duplicated from private.llm_prices
// (20260916000000_llm_cost_guardrails.sql) so the script needs no database.
// Verified from the vendors' own pages (house rule: vendor pages, never a
// registry), retrieved 2026-08-19:
//   OpenAI  https://developers.openai.com/api/docs/pricing
//     gpt-5.6-terra USD 2.00 in / 12.00 out; gpt-5.6-luna USD 0.20 / 1.20;
//     gpt-4o-mini USD 0.15 / 0.60
//   xAI     https://docs.x.ai/docs/models
//     grok-4.6 USD 2.00 / 6.00 (<200k-token tier);
//     grok-4.3 USD 1.25 / 2.50 (<200k-token tier)
//   FX      USD/CAD 1.3889 — Bank of Canada daily average 2026-08-18,
//     https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json
// A model missing from this table gets cost_cad: null — never a guess.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const RATES_CAD_PER_MTOK = {
  "gpt-5.6-terra": { input: 2.7778, output: 16.6668 },
  "gpt-5.6-luna": { input: 0.27778, output: 1.66668 },
  "gpt-4o-mini": { input: 0.208335, output: 0.83334 },
  "grok-4.6": { input: 2.7778, output: 8.3334 },
  "grok-4.3": { input: 1.736125, output: 3.47225 },
};

// ----------------------------------------------------------------------------
// Providers
// ----------------------------------------------------------------------------
const DEFAULT_PROVIDERS = [
  {
    name: "openai-terra",
    baseUrl: "https://api.openai.com",
    keyEnv: "OPENAI_API_KEY",
    model: "gpt-5.6-terra",
  },
  {
    name: "xai-grok",
    baseUrl: "https://api.x.ai",
    keyEnv: "XAI_API_KEY",
    // Verified current flagship id at https://docs.x.ai/docs/models
    // (retrieved 2026-08-19).
    model: "grok-4.6",
  },
];

function loadProviders() {
  const raw = process.env.EVAL_PROVIDERS;
  if (!raw) return DEFAULT_PROVIDERS;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("EVAL_PROVIDERS must be a non-empty JSON array");
  }
  for (const p of parsed) {
    for (const field of ["name", "baseUrl", "keyEnv", "model"]) {
      if (typeof p[field] !== "string" || !p[field]) {
        throw new Error(`EVAL_PROVIDERS entry missing ${field}`);
      }
    }
  }
  return parsed;
}

// ----------------------------------------------------------------------------
// Benchmark set — REAL prompt shapes lifted from the product, with synthetic
// but realistic asset data. No customer data anywhere in this file.
//
// Sources:
//   ai-agent-processor buildLegacyPrompt()   — chat + deliverable modes
//   ai-agent-processor buildTypedPrompts()   — classify_failure_mode,
//                                              draft_reliability_assessment
//   agent-loop-enrich                         — enrichment JSON prompt
//   public-reliability-agent                  — public assessment instructions
// ----------------------------------------------------------------------------

const LEGACY_BASE = (purpose) =>
  `You are SyncAI's senior industrial AI specialist for ${purpose}.
Use only supplied facts and clearly label assumptions. Distinguish symptoms, mechanisms, causes and systemic causes. Quantify deviations where data permits. Recommend reversible field verification before permanent changes. Every material recommendation must name an owner role, time window, verification metric, consequence of being wrong, and whether qualified human approval is required. Never advise bypassing safety, regulatory, OEM, change-management or operational approvals. End with a concise bottom line.`;

const DELIVERABLE_SUFFIX = `
The user requested a complete work product. Produce the artifact now rather than a methodology outline. For an FMEA, include at least 20 scored failure-mode rows plus scoring scales, assumptions, a prioritized action plan, regulatory applicability, method references and a bottom line. For RCA, FRACAS, RCM, risk or planning requests, provide the corresponding complete professional artifact.`;

// Synthetic asset context in the exact shape buildTypedPrompts() assembles.
const TYPED_CONTEXT = `Work order: Investigate recurring high vibration on conveyor drive
Description: Drive-end vibration trending up over 3 weeks; two temporary resets
Priority: high
Status: open
Type: corrective

Asset: CV-310 overland conveyor drive
Tag: CV-310-DR1
Criticality: high
Status: running
Manufacturer/model: FLSmidth KOCH-2400
Trigger: vibration_alarm_repeat`;

const PROMPTS = [
  {
    id: "reliability-chat",
    source: "ai-agent-processor handleLegacy (chat depth)",
    maxTokens: 1500,
    system: LEGACY_BASE(
      "reliability engineering, failure analysis, FRACAS, RCM and lifecycle risk",
    ),
    user: "Our slurry pump P-2205 has had five mechanical seal failures in nine months, each within weeks of a restart after planned maintenance. Flush plan is API Plan 32. What should we verify first?",
  },
  {
    id: "fmea-deliverable",
    source: "ai-agent-processor handleLegacy (deliverable depth)",
    maxTokens: 12000,
    system:
      LEGACY_BASE(
        "reliability engineering, failure analysis, FRACAS, RCM and lifecycle risk",
      ) + DELIVERABLE_SUFFIX,
    user: "Produce a complete FMEA for a 2400 kW overland conveyor drive train (motor, fluid coupling, gearbox, drive pulley, holdback) in an open-pit mining application, 6,800 operating hours/year, high dust, -35C to +30C ambient.",
  },
  {
    id: "rca-deliverable",
    source: "ai-agent-processor handleLegacy (deliverable depth)",
    maxTokens: 12000,
    system:
      LEGACY_BASE(
        "evidence-led root cause analysis and corrective-action verification",
      ) + DELIVERABLE_SUFFIX,
    user: "Complete RCA for a ball mill trunnion bearing wipe: lube supply temperature climbed 8C over 4 hours before trip, last oil analysis 6 weeks ago showed rising Fe and Cu, cooler fans confirmed running, standby pump did not auto-start on low pressure.",
  },
  {
    id: "classify-failure-mode",
    source: "ai-agent-processor buildTypedPrompts(classify_failure_mode)",
    maxTokens: 1800,
    jsonMode: true,
    system: `You are a reliability engineer. Return strict JSON with failure_mode, failure_mode_family, likely_cause_family, recommended_next_diagnostic_step, risk_level, evidence, summary, confidence (0-1), and requires_human_review. Never invent evidence or bypass human approval.`,
    user: `Classify the likely failure mode:\n\n${TYPED_CONTEXT}`,
  },
  {
    id: "draft-reliability-assessment",
    source:
      "ai-agent-processor buildTypedPrompts(draft_reliability_assessment)",
    maxTokens: 1800,
    jsonMode: true,
    system: `You are a reliability engineer. Return strict JSON with likely_causes, recommended_actions, risk_level, evidence, summary, confidence (0-1), and requires_human_review. Recommendations are advisory and must preserve qualified human approval.`,
    user: `Draft a reliability assessment:\n\n${TYPED_CONTEXT}`,
  },
  {
    id: "loop-enrichment",
    source: "agent-loop-enrich",
    maxTokens: 1500,
    jsonMode: true,
    system:
      "You are a senior reliability engineer for asset-intensive industry. " +
      "Given a condition-monitoring finding, return strict JSON: " +
      '{"analysis": "2-3 sentence engineering assessment of likely failure mechanism and consequence", ' +
      '"recommended_window_hours": <number>, "confidence": <0-100 integer>}. ' +
      "Be specific and conservative; never advise bypassing approvals.",
    user: "Finding: Investigate DE bearing temp on Compressor C-330\nSensor detail: Drive-end bearing RTD at 92C against 85C threshold, trend up\nCurrent proposed action: Schedule inspection within 48h\nUrgency: action",
  },
  {
    id: "planning-chat",
    source: "ai-agent-processor handleLegacy (chat depth)",
    maxTokens: 1500,
    system: LEGACY_BASE(
      "maintenance planning, scheduling, readiness and resource deconfliction",
    ),
    user: "Next week's shutdown window is 36 hours. We have 41 approved work orders totalling an estimated 62 crew-hours of critical-path work plus 3 permits still pending. How should we deconflict and what gets deferred?",
  },
  {
    id: "public-assessment",
    source: "public-reliability-agent (assessment instructions)",
    maxTokens: 2600,
    system: `You are SyncAI's senior Reliability Engineer. Produce a concise, board-ready but field-usable assessment. Treat statements in the user's question as unverified user context unless they also appear in the trusted reference facts. Separate observations, user assertions, hypotheses, and verified facts. Do not claim a root cause. Never invent standards, citations, operating limits, costs, measurements, or evidence. If structured exposure and repair inputs are absent, do not calculate or imply MTBF, MTTR, availability, Weibull parameters, or financial impact. Recommend reversible verification before permanent changes. Every action needs an owner, time window, effectiveness check, and approval boundary. Safety, OEM, MOC, site procedures, and qualified human approval always prevail.`,
    user: "Assessment context: P-101 process pump\nUser question and unverified context: Why does P-101 keep leaking after seal replacement?\nTrusted reference-case facts:\n- P-101 has six coded events in the approved reference-case history: five seal leaks and one bearing-temperature event.\n- The five seal events total 89 downtime hours and CAD 21,300 captured maintenance cost.\n- Seal leakage recurred after replacement and around restart/change in operating conditions.",
  },
];

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------

function costCad(model, promptTokens, completionTokens) {
  const rate = RATES_CAD_PER_MTOK[model];
  if (!rate) return null;
  return (
    (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000
  );
}

async function callProvider(provider, key, prompt) {
  const url = new URL("/v1/chat/completions", provider.baseUrl);
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_completion_tokens: prompt.maxTokens,
      ...(prompt.jsonMode
        ? { response_format: { type: "json_object" } }
        : {}),
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: res.status, detail, latencyMs };
  }
  const data = await res.json();
  const usage = data.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const answeredBy = typeof data.model === "string" ? data.model : provider.model;
  return {
    ok: true,
    latencyMs,
    model: answeredBy,
    promptTokens,
    completionTokens,
    // Cost is computed against the REQUESTED model's verified rate; a
    // provider-side alias (e.g. a dated snapshot id) still bills at it.
    costCad: costCad(provider.model, promptTokens, completionTokens),
    content: data.choices?.[0]?.message?.content ?? "",
  };
}

function markdownReport(runs, date) {
  const lines = [
    `# Model evaluation — ${date}`,
    "",
    "Same product prompt shapes, one row per provider. Costs in CAD from the",
    "verified rates in the script header (vendor pages + Bank of Canada FX).",
    "Quality judgement is HUMAN work — this report only lines the answers up.",
    "",
  ];
  for (const prompt of PROMPTS) {
    lines.push(`## ${prompt.id}`, "", `_Source: ${prompt.source}_`, "");
    lines.push("| provider | model | tokens in/out | latency | cost (CAD) |");
    lines.push("|---|---|---|---|---|");
    for (const run of runs.filter((r) => r.promptId === prompt.id)) {
      if (!run.ok) {
        lines.push(
          `| ${run.provider} | — | — | ${run.latencyMs} ms | FAILED (${run.status ?? "error"}) |`,
        );
        continue;
      }
      lines.push(
        `| ${run.provider} | ${run.model} | ${run.promptTokens}/${run.completionTokens} | ${run.latencyMs} ms | ${
          run.costCad == null ? "no verified rate" : `$${run.costCad.toFixed(4)}`
        } |`,
      );
    }
    lines.push("");
    for (const run of runs.filter((r) => r.promptId === prompt.id && r.ok)) {
      lines.push(`### ${run.provider} — ${prompt.id}`, "");
      lines.push("```", run.content.slice(0, 12_000), "```", "");
    }
  }
  return lines.join("\n");
}

async function main() {
  const providers = loadProviders();
  const active = [];
  for (const provider of providers) {
    const key = process.env[provider.keyEnv];
    if (!key) {
      // Clean skip, not an error: CI has no keys and must never spend.
      console.log(
        `skip ${provider.name}: ${provider.keyEnv} not set (no live call made)`,
      );
      continue;
    }
    active.push({ provider, key });
  }
  if (active.length === 0) {
    console.log("No providers configured with keys — nothing to run.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join("artifacts", "model-eval", date);
  fs.mkdirSync(outDir, { recursive: true });

  const runs = [];
  for (const { provider, key } of active) {
    for (const prompt of PROMPTS) {
      process.stdout.write(`${provider.name} × ${prompt.id} … `);
      try {
        const result = await callProvider(provider, key, prompt);
        runs.push({ provider: provider.name, promptId: prompt.id, ...result });
        console.log(
          result.ok
            ? `${result.latencyMs} ms, ${result.completionTokens} out tokens`
            : `FAILED ${result.status}`,
        );
      } catch (error) {
        runs.push({
          provider: provider.name,
          promptId: prompt.id,
          ok: false,
          status: "exception",
          detail: error instanceof Error ? error.message : String(error),
          latencyMs: null,
        });
        console.log("FAILED (exception)");
      }
    }
  }

  fs.writeFileSync(
    path.join(outDir, "results.json"),
    JSON.stringify({ date, providers: active.map((a) => a.provider), runs }, null, 2),
  );
  fs.writeFileSync(path.join(outDir, "report.md"), markdownReport(runs, date));
  console.log(`\nWrote ${outDir}/results.json and ${outDir}/report.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
