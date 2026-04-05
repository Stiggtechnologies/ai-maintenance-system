import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Research Orchestrator — autoresearch-inspired loop for SyncAI
// propose variant -> run experiment -> score -> keep/discard -> log
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// OpenAI helpers
// ---------------------------------------------------------------------------

async function callOpenAI(
  messages: { role: string; content: string }[],
  options: { model?: string; temperature?: number; max_tokens?: number } = {},
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || "gpt-4o",
      messages,
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.max_tokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOpenAIJSON(
  messages: { role: string; content: string }[],
  options: { model?: string; temperature?: number; max_tokens?: number } = {},
): Promise<any> {
  const raw = await callOpenAI(messages, options);
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Step logger
// ---------------------------------------------------------------------------

async function logStep(
  supabase: any,
  runId: string,
  stepNumber: number,
  stepType: string,
  stepData: unknown,
  startTime: number,
) {
  const durationMs = Date.now() - startTime;
  await supabase.from("research_run_log").insert({
    run_id: runId,
    step_number: stepNumber,
    step_type: stepType,
    step_data: stepData,
    duration_ms: durationMs,
  });
}

// ---------------------------------------------------------------------------
// Scoring functions (per domain)
// ---------------------------------------------------------------------------

async function scoreRecommendationQuality(
  variant: any,
  benchmark: any,
  program: any,
): Promise<{
  scores: Record<string, number>;
  details: any;
}> {
  const scenarios = benchmark.dataset?.scenarios || benchmark.dataset || [];
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Benchmark dataset has no scenarios to evaluate");
  }

  const variantPrompt =
    variant.change_payload?.prompt || variant.change_payload?.value || "";
  const allScenarioResults: any[] = [];

  for (const scenario of scenarios) {
    // 1. Apply the variant's prompt to generate a recommendation
    const recommendation = await callOpenAI([
      {
        role: "system",
        content: variantPrompt || program.program_instructions,
      },
      {
        role: "user",
        content: `Generate a maintenance recommendation for the following scenario:\n\n${JSON.stringify(scenario, null, 2)}`,
      },
    ]);

    // 2. Use OpenAI as a judge to score the recommendation
    const judgeResult = await callOpenAIJSON(
      [
        {
          role: "system",
          content: `You are an expert evaluator of industrial maintenance recommendations.
Score the following recommendation on a 0-100 scale for each dimension.
Respond ONLY with valid JSON matching this schema:
{
  "clarity": <number 0-100>,
  "actionability": <number 0-100>,
  "specificity": <number 0-100>,
  "business_impact": <number 0-100>,
  "reasoning": "<brief explanation>"
}`,
        },
        {
          role: "user",
          content: `Scenario:\n${JSON.stringify(scenario, null, 2)}\n\nRecommendation:\n${recommendation}\n\nScore this recommendation.`,
        },
      ],
      { temperature: 0.2 },
    );

    allScenarioResults.push({
      scenario_id: scenario.id || scenario.name || "unknown",
      recommendation_excerpt: recommendation.slice(0, 300),
      scores: judgeResult,
    });
  }

  // 3. Average scores across all scenarios
  const dimensions = [
    "clarity",
    "actionability",
    "specificity",
    "business_impact",
  ];
  const avgScores: Record<string, number> = {};
  for (const dim of dimensions) {
    const values = allScenarioResults.map((r) => r.scores[dim] || 0);
    avgScores[dim] = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  }

  // Composite score
  avgScores.approval_rate =
    (avgScores.clarity + avgScores.actionability) / 2;
  avgScores.override_rate = Math.max(
    0,
    100 - (avgScores.specificity + avgScores.business_impact) / 2,
  );
  avgScores.clarity_score = avgScores.clarity;

  return { scores: avgScores, details: { scenario_results: allScenarioResults } };
}

async function scoreOEEDiagnosis(
  variant: any,
  benchmark: any,
  _program: any,
): Promise<{
  scores: Record<string, number>;
  details: any;
}> {
  const cases = benchmark.dataset?.cases || benchmark.dataset || [];
  const variantPrompt =
    variant.change_payload?.prompt || variant.change_payload?.value || "";

  let correctCount = 0;
  let totalConfidence = 0;
  const caseResults: any[] = [];

  for (const testCase of Array.isArray(cases) ? cases : []) {
    const diagnosis = await callOpenAIJSON(
      [
        {
          role: "system",
          content:
            variantPrompt ||
            "You are an OEE diagnosis engine. Given sensor and production data, identify the root cause of OEE loss. Respond with JSON: { root_cause: string, confidence: number 0-100, explanation: string }",
        },
        {
          role: "user",
          content: `Diagnose the following OEE data:\n${JSON.stringify(testCase.input || testCase, null, 2)}`,
        },
      ],
      { temperature: 0.2 },
    );

    const expectedCause = (testCase.expected_root_cause || "").toLowerCase();
    const predictedCause = (diagnosis.root_cause || "").toLowerCase();
    const correct =
      predictedCause.includes(expectedCause) ||
      expectedCause.includes(predictedCause);
    if (correct) correctCount++;
    totalConfidence += diagnosis.confidence || 0;

    caseResults.push({
      case_id: testCase.id || "unknown",
      expected: testCase.expected_root_cause,
      predicted: diagnosis.root_cause,
      correct,
      confidence: diagnosis.confidence,
    });
  }

  const total = Math.max(caseResults.length, 1);
  return {
    scores: {
      diagnosis_accuracy: (correctCount / total) * 100,
      avg_confidence: totalConfidence / total,
    },
    details: { case_results: caseResults },
  };
}

async function scoreKPIThresholds(
  variant: any,
  benchmark: any,
  _program: any,
): Promise<{
  scores: Record<string, number>;
  details: any;
}> {
  const events = benchmark.dataset?.events || benchmark.dataset || [];
  const thresholds = variant.change_payload?.thresholds || variant.change_payload || {};

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const eventResults: any[] = [];

  for (const event of Array.isArray(events) ? events : []) {
    const predicted = await callOpenAIJSON(
      [
        {
          role: "system",
          content: `You are a KPI alert evaluator. Given the KPI data and threshold configuration, decide if an alert should fire.
Thresholds config: ${JSON.stringify(thresholds)}
Respond with JSON: { should_alert: boolean, reasoning: string }`,
        },
        {
          role: "user",
          content: `Evaluate this KPI event:\n${JSON.stringify(event.input || event, null, 2)}`,
        },
      ],
      { temperature: 0.1 },
    );

    const actualAlert = event.actual_alert ?? event.should_alert ?? false;
    const predictedAlert = predicted.should_alert ?? false;

    if (predictedAlert && actualAlert) truePositives++;
    if (predictedAlert && !actualAlert) falsePositives++;
    if (!predictedAlert && actualAlert) falseNegatives++;

    eventResults.push({
      event_id: event.id || "unknown",
      predicted: predictedAlert,
      actual: actualAlert,
    });
  }

  const precision =
    truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;
  const recall =
    truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  return {
    scores: {
      precision: precision * 100,
      recall: recall * 100,
      f1_score: f1 * 100,
    },
    details: {
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      event_results: eventResults,
    },
  };
}

async function scoreGeneric(
  variant: any,
  benchmark: any,
  program: any,
): Promise<{
  scores: Record<string, number>;
  details: any;
}> {
  const dataset = benchmark.dataset?.items || benchmark.dataset || [];
  const variantPayload = JSON.stringify(variant.change_payload, null, 2);

  const result = await callOpenAIJSON(
    [
      {
        role: "system",
        content: `You are an expert evaluator for the "${program.domain}" domain.
Evaluate the following variant change against the benchmark dataset.
Rate the variant on relevance (0-100), quality (0-100), and completeness (0-100).
Respond ONLY with valid JSON: { "relevance": <number>, "quality": <number>, "completeness": <number>, "reasoning": "<string>" }`,
      },
      {
        role: "user",
        content: `Program: ${program.program_name}\nInstructions: ${(program.program_instructions || "").slice(0, 1000)}\n\nVariant change:\n${variantPayload}\n\nBenchmark dataset (sample):\n${JSON.stringify(Array.isArray(dataset) ? dataset.slice(0, 5) : dataset, null, 2)}`,
      },
    ],
    { temperature: 0.3 },
  );

  return {
    scores: {
      relevance: result.relevance || 0,
      quality: result.quality || 0,
      completeness: result.completeness || 0,
    },
    details: { reasoning: result.reasoning },
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function proposeVariant(supabase: any, data: any) {
  const { program_id, description } = data || {};
  if (!program_id) throw new Error("program_id is required");

  // Load program
  const { data: program, error: progErr } = await supabase
    .from("research_programs")
    .select("*")
    .eq("id", program_id)
    .single();
  if (progErr || !program) throw new Error("Program not found");

  // Count existing variants for unique code
  const { count } = await supabase
    .from("research_variants")
    .select("id", { count: "exact", head: true })
    .eq("program_id", program_id);

  const variantNumber = (count || 0) + 1;
  const variantCode = `${program.program_code}-v${variantNumber}`;

  // Ask OpenAI to propose a change
  const proposal = await callOpenAIJSON(
    [
      {
        role: "system",
        content: `You are a research assistant for SyncAI, an industrial maintenance AI platform.
Your job is to propose a single improvement variant for a research program.

You MUST respond with valid JSON matching this schema:
{
  "variant_type": "prompt_change" | "config_change" | "threshold_change" | "weight_change" | "template_change" | "ranking_change" | "formula_change" | "sequence_change",
  "change_payload": { ... the actual change ... },
  "diff_summary": "human-readable summary of what changed",
  "description": "why this change might improve performance"
}

The change_payload for prompt-type changes should include a "prompt" key with the full new prompt text.
For threshold changes, include a "thresholds" key with the new values.
For config changes, include relevant configuration keys.`,
      },
      {
        role: "user",
        content: `Program: ${program.program_name}
Domain: ${program.domain}
Current instructions:\n${(program.program_instructions || "").slice(0, 3000)}

Mutable surfaces: ${JSON.stringify(program.mutable_surfaces)}
Success metrics: ${JSON.stringify(program.success_metrics)}

${description ? `User guidance: ${description}` : "Propose an improvement that could boost the success metrics."}

Propose a single variant.`,
      },
    ],
    { temperature: 0.8 },
  );

  // Insert variant
  const { data: variant, error: insertErr } = await supabase
    .from("research_variants")
    .insert({
      program_id,
      variant_code: variantCode,
      description: proposal.description || description || "AI-proposed variant",
      variant_type: proposal.variant_type || "prompt_change",
      change_payload: proposal.change_payload || {},
      diff_summary: proposal.diff_summary || "",
      origin: "ai_proposed",
      status: "proposed",
    })
    .select()
    .single();

  if (insertErr) throw new Error(`Failed to insert variant: ${insertErr.message}`);

  return jsonResponse({
    variant_id: variant.id,
    variant_code: variant.variant_code,
    change_payload: variant.change_payload,
  });
}

async function runExperiment(supabase: any, data: any) {
  const { variant_id, benchmark_id } = data || {};
  if (!variant_id || !benchmark_id)
    throw new Error("variant_id and benchmark_id are required");

  // Load variant, benchmark, and program
  const { data: variant, error: vErr } = await supabase
    .from("research_variants")
    .select("*")
    .eq("id", variant_id)
    .single();
  if (vErr || !variant) throw new Error("Variant not found");

  const { data: benchmark, error: bErr } = await supabase
    .from("research_benchmarks")
    .select("*")
    .eq("id", benchmark_id)
    .single();
  if (bErr || !benchmark) throw new Error("Benchmark not found");

  const { data: program, error: pErr } = await supabase
    .from("research_programs")
    .select("*")
    .eq("id", variant.program_id)
    .single();
  if (pErr || !program) throw new Error("Program not found");

  // Determine run number
  const { count: runCount } = await supabase
    .from("research_runs")
    .select("id", { count: "exact", head: true })
    .eq("program_id", variant.program_id);

  const runNumber = (runCount || 0) + 1;
  const budgetMinutes = program.max_experiment_duration_minutes || 10;

  // Insert run record
  const { data: run, error: runErr } = await supabase
    .from("research_runs")
    .insert({
      program_id: variant.program_id,
      variant_id,
      benchmark_id,
      run_number: runNumber,
      status: "running",
      budget_minutes: budgetMinutes,
      config_snapshot: {
        variant_payload: variant.change_payload,
        benchmark_code: benchmark.benchmark_code,
        program_domain: program.domain,
      },
    })
    .select()
    .single();

  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);

  const runId = run.id;
  const experimentStart = Date.now();
  const deadlineMs = budgetMinutes * 60 * 1000;
  let stepNum = 0;

  try {
    // Mark variant as testing
    await supabase
      .from("research_variants")
      .update({ status: "testing" })
      .eq("id", variant_id);

    // Step 1: load_benchmark
    stepNum++;
    const stepStart1 = Date.now();
    await logStep(supabase, runId, stepNum, "load_benchmark", {
      benchmark_id: benchmark.id,
      benchmark_code: benchmark.benchmark_code,
      record_count: benchmark.record_count,
      dataset_type: benchmark.dataset_type,
    }, stepStart1);

    // Step 2: apply_variant
    stepNum++;
    const stepStart2 = Date.now();
    await logStep(supabase, runId, stepNum, "apply_variant", {
      variant_id: variant.id,
      variant_code: variant.variant_code,
      variant_type: variant.variant_type,
      change_summary: variant.diff_summary,
    }, stepStart2);

    // Budget check
    if (Date.now() - experimentStart > deadlineMs) {
      await supabase
        .from("research_runs")
        .update({
          status: "timed_out",
          budget_exceeded: true,
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - experimentStart,
        })
        .eq("id", runId);
      return jsonResponse(
        { run_id: runId, status: "timed_out", results: null, decision: "discard" },
        408,
      );
    }

    // Step 3-5: Score based on domain
    let scoringResult: { scores: Record<string, number>; details: any };

    switch (program.domain) {
      case "recommendation_quality":
        scoringResult = await scoreRecommendationQuality(variant, benchmark, program);
        break;
      case "oee_diagnosis":
        scoringResult = await scoreOEEDiagnosis(variant, benchmark, program);
        break;
      case "kpi_thresholds":
        scoringResult = await scoreKPIThresholds(variant, benchmark, program);
        break;
      default:
        scoringResult = await scoreGeneric(variant, benchmark, program);
        break;
    }

    // Step 6: score_results
    stepNum++;
    const stepStart3 = Date.now();
    await logStep(supabase, runId, stepNum, "score_results", {
      scores: scoringResult.scores,
      domain: program.domain,
    }, stepStart3);

    // Step 7: Insert results
    const baselineScores = benchmark.baseline_scores || {};
    const resultInserts: any[] = [];

    for (const [metricName, metricValue] of Object.entries(scoringResult.scores)) {
      const baselineValue = baselineScores[metricName] ?? null;
      const improvementPct =
        baselineValue != null && baselineValue !== 0
          ? (((metricValue as number) - baselineValue) / Math.abs(baselineValue)) * 100
          : null;
      const improved =
        metricName === "override_rate"
          ? (metricValue as number) < (baselineValue ?? Infinity) // lower is better for override_rate
          : (metricValue as number) > (baselineValue ?? -Infinity);

      resultInserts.push({
        run_id: runId,
        metric_name: metricName,
        metric_value: metricValue,
        baseline_value: baselineValue,
        improvement_pct: improvementPct,
        improved,
        details: scoringResult.details,
      });
    }

    const { error: resErr } = await supabase
      .from("research_results")
      .insert(resultInserts);
    if (resErr)
      console.error("Failed to insert some results:", resErr.message);

    // Step 8: compare_baseline
    stepNum++;
    const stepStart4 = Date.now();
    const improvedMetrics = resultInserts.filter((r: any) => r.improved).length;
    const totalMetrics = resultInserts.length;
    const overallImproved = improvedMetrics > totalMetrics / 2;

    await logStep(supabase, runId, stepNum, "compare_baseline", {
      baseline_scores: baselineScores,
      variant_scores: scoringResult.scores,
      improved_metrics: improvedMetrics,
      total_metrics: totalMetrics,
      overall_improved: overallImproved,
    }, stepStart4);

    // Step 9: decision
    stepNum++;
    const stepStart5 = Date.now();
    const decision = overallImproved ? "keep" : "discard";

    await logStep(supabase, runId, stepNum, "decision", {
      decision,
      reason: overallImproved
        ? `${improvedMetrics}/${totalMetrics} metrics improved`
        : `Only ${improvedMetrics}/${totalMetrics} metrics improved — below majority threshold`,
    }, stepStart5);

    // Step 10: Update variant status and run status
    const variantStatus = decision === "keep" ? "tested" : "discarded";
    await supabase
      .from("research_variants")
      .update({ status: variantStatus })
      .eq("id", variant_id);

    const completedAt = new Date().toISOString();
    await supabase
      .from("research_runs")
      .update({
        status: "completed",
        completed_at: completedAt,
        duration_ms: Date.now() - experimentStart,
      })
      .eq("id", runId);

    // Step 11: log_outcome
    stepNum++;
    const stepStart6 = Date.now();
    await logStep(supabase, runId, stepNum, "log_outcome", {
      variant_id,
      variant_code: variant.variant_code,
      decision,
      variant_status: variantStatus,
      scores: scoringResult.scores,
      duration_ms: Date.now() - experimentStart,
    }, stepStart6);

    // Step 12: If improved, create promotion candidate
    if (overallImproved) {
      const bestImprovement = Math.max(
        ...resultInserts
          .map((r: any) => r.improvement_pct)
          .filter((v: any) => v != null),
        0,
      );

      await supabase.from("promotion_candidates").insert({
        variant_id,
        program_id: variant.program_id,
        aggregate_scores: scoringResult.scores,
        benchmarks_passed: 1,
        benchmarks_total: 1,
        net_improvement_pct: bestImprovement,
        review_status: "pending",
        target_environment: "staging",
      });
    }

    return jsonResponse({
      run_id: runId,
      status: "completed",
      results: scoringResult.scores,
      decision,
    });
  } catch (error) {
    // Mark run as failed
    await supabase
      .from("research_runs")
      .update({
        status: "failed",
        error_message: error.message,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - experimentStart,
      })
      .eq("id", runId);

    // Revert variant status
    await supabase
      .from("research_variants")
      .update({ status: "proposed" })
      .eq("id", variant_id);

    throw error;
  }
}

async function runLoop(supabase: any, data: any) {
  const {
    program_id,
    benchmark_id,
    iterations = 5,
    max_duration_minutes = 30,
  } = data || {};
  if (!program_id || !benchmark_id)
    throw new Error("program_id and benchmark_id are required");

  const loopStart = Date.now();
  const deadlineMs = max_duration_minutes * 60 * 1000;
  const results: any[] = [];
  let bestVariantId: string | null = null;
  let bestImprovementPct = -Infinity;
  let iterationsCompleted = 0;

  for (let i = 0; i < iterations; i++) {
    // Budget check
    if (Date.now() - loopStart > deadlineMs) {
      console.log(
        `Loop budget exceeded at iteration ${i + 1}/${iterations}`,
      );
      break;
    }

    try {
      // 1. Propose variant
      const proposeRes = await proposeVariant(supabase, {
        program_id,
        description: `Iteration ${i + 1} of ${iterations} — improve on previous results`,
      });
      const proposeBody = await proposeRes.json();

      if (!proposeBody.variant_id) {
        results.push({
          iteration: i + 1,
          status: "failed",
          error: "Failed to propose variant",
        });
        continue;
      }

      // 2. Run experiment
      const expRes = await runExperiment(supabase, {
        variant_id: proposeBody.variant_id,
        benchmark_id,
      });
      const expBody = await expRes.json();

      // Track best
      if (expBody.decision === "keep" && expBody.results) {
        const improvements = Object.values(expBody.results).filter(
          (v): v is number => typeof v === "number",
        );
        const avgScore =
          improvements.length > 0
            ? improvements.reduce((a, b) => a + b, 0) / improvements.length
            : 0;

        if (avgScore > bestImprovementPct) {
          bestImprovementPct = avgScore;
          bestVariantId = proposeBody.variant_id;
        }
      }

      results.push({
        iteration: i + 1,
        variant_id: proposeBody.variant_id,
        variant_code: proposeBody.variant_code,
        run_id: expBody.run_id,
        status: expBody.status,
        decision: expBody.decision,
        scores: expBody.results,
      });

      iterationsCompleted++;
    } catch (error) {
      results.push({
        iteration: i + 1,
        status: "error",
        error: error.message,
      });
      iterationsCompleted++;
    }
  }

  return jsonResponse({
    iterations_completed: iterationsCompleted,
    best_variant_id: bestVariantId,
    best_improvement_pct:
      bestImprovementPct === -Infinity ? null : bestImprovementPct,
    results,
  });
}

async function getResults(supabase: any, data: any) {
  const { program_id, limit = 20 } = data || {};
  if (!program_id) throw new Error("program_id is required");

  const { data: runs, error } = await supabase
    .from("research_runs")
    .select(
      `
      *,
      research_results (*),
      research_variants!inner (
        id, variant_code, variant_type, description, status, change_payload, diff_summary
      )
    `,
    )
    .eq("program_id", program_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch results: ${error.message}`);

  return jsonResponse({ runs });
}

async function promoteVariant(supabase: any, data: any) {
  const { variant_id, target_environment, comments } = data || {};
  if (!variant_id) throw new Error("variant_id is required");

  // Find existing promotion candidate
  const { data: existing, error: findErr } = await supabase
    .from("promotion_candidates")
    .select("*")
    .eq("variant_id", variant_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(`Lookup failed: ${findErr.message}`);

  if (existing) {
    // Update existing candidate
    const { data: updated, error: updErr } = await supabase
      .from("promotion_candidates")
      .update({
        review_status: "under_review",
        target_environment: target_environment || existing.target_environment,
        review_comments: comments || existing.review_comments,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updErr)
      throw new Error(`Failed to update promotion: ${updErr.message}`);

    return jsonResponse({
      promotion_id: updated.id,
      status: updated.review_status,
    });
  }

  // No existing candidate — create one
  const { data: variant, error: vErr } = await supabase
    .from("research_variants")
    .select("*")
    .eq("id", variant_id)
    .single();
  if (vErr || !variant) throw new Error("Variant not found");

  const { data: created, error: cErr } = await supabase
    .from("promotion_candidates")
    .insert({
      variant_id,
      program_id: variant.program_id,
      aggregate_scores: {},
      benchmarks_passed: 0,
      benchmarks_total: 0,
      review_status: "under_review",
      target_environment: target_environment || "staging",
      review_comments: comments || null,
    })
    .select()
    .single();

  if (cErr)
    throw new Error(`Failed to create promotion candidate: ${cErr.message}`);

  return jsonResponse({
    promotion_id: created.id,
    status: created.review_status,
  });
}

async function listPrograms(supabase: any) {
  const { data: programs, error } = await supabase
    .from("research_programs")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list programs: ${error.message}`);

  return jsonResponse({ programs });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, data } = await req.json();

    switch (action) {
      case "propose_variant":
        return await proposeVariant(supabase, data);

      case "run_experiment":
        return await runExperiment(supabase, data);

      case "run_loop":
        return await runLoop(supabase, data);

      case "get_results":
        return await getResults(supabase, data);

      case "promote_variant":
        return await promoteVariant(supabase, data);

      case "list_programs":
        return await listPrograms(supabase);

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error("Research orchestrator error:", error);
    return jsonResponse(
      { error: error.message || "Internal server error" },
      500,
    );
  }
});
