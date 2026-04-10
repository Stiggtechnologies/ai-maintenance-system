/**
 * Deterministic LLM mock server for golden-path E2E tests.
 *
 * Responds to POST /v1/chat/completions with a canned
 * DraftReliabilityAssessmentOutput-shaped response.
 *
 * Set LLM_MOCK_FAIL=1 to return HTTP 500 for the failure-path test.
 *
 * Usage:
 *   npx tsx tests/e2e/fixtures/llm-mock-server.ts
 *   # Listens on http://localhost:54400
 *
 * The ai-agent-processor Edge Function reads LLM_BASE_URL, which
 * should be set to http://localhost:54400 in the test environment.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";

const PORT = Number(process.env.LLM_MOCK_PORT || 54400);
const SHOULD_FAIL = process.env.LLM_MOCK_FAIL === "1";

const MOCK_RELIABILITY_RESPONSE = {
  summary:
    "Pump seal shows early degradation indicators. Recommend inspection within 48 hours based on vibration trend and prior failure history.",
  likely_causes: [
    "Mechanical seal wear from normal operation",
    "Vibration-induced micro-cracking",
    "Alignment drift since last maintenance",
  ],
  recommended_actions: [
    "Schedule seal inspection within 48 hours",
    "Check shaft alignment measurements",
    "Review vibration trend data for the last 30 days",
    "Prepare replacement seal kit as precaution",
  ],
  risk_level: "medium",
  confidence: 0.78,
  requires_human_review: true,
  evidence: [
    {
      source_type: "work_order_history",
      note: "Previous seal replacement was 14 months ago, approaching typical MTBF for this pump class",
    },
    {
      source_type: "condition_data",
      note: "Vibration readings elevated but below alarm threshold",
    },
    {
      source_type: "inference",
      note: "Similar pumps in this asset class show 60% probability of seal failure within 90 days at current vibration levels",
    },
  ],
};

const MOCK_FAILURE_MODE_RESPONSE = {
  summary:
    "Failure mode classified as mechanical seal degradation, likely caused by normal wear. Recommend vibration analysis to confirm before updating FRACAS records.",
  failure_mode: "Mechanical seal degradation",
  failure_mode_family: "mechanical",
  likely_cause_family: "wear",
  recommended_next_diagnostic_step:
    "Perform vibration spectrum analysis on pump bearing housing to confirm seal degradation pattern vs. alignment issue",
  risk_level: "medium",
  confidence: 0.82,
  requires_human_review: false,
  evidence: [
    {
      source_type: "work_order_history",
      note: "Seal replacement history indicates 14-month intervals, consistent with wear-driven failure",
    },
    {
      source_type: "asset_record",
      note: "Flowserve HPX-2000 pumps have a documented seal MTBF of 12-18 months in similar service",
    },
    {
      source_type: "inference",
      note: "Work order description mentions 'inspection' — consistent with early-stage degradation, not catastrophic failure",
    },
  ],
};

function selectMockResponse(requestBody: string): object {
  // Dispatch based on system prompt content to return the right mock
  if (requestBody.includes("failure mode")) {
    return MOCK_FAILURE_MODE_RESPONSE;
  }
  return MOCK_RELIABILITY_RESPONSE;
}

function handleRequest(_req: IncomingMessage, res: ServerResponse) {
  // CORS preflight
  if (_req.method === "OPTIONS") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }

  if (_req.method !== "POST" || !_req.url?.includes("/v1/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  // Collect request body to dispatch the right mock response
  const chunks: Buffer[] = [];
  _req.on("data", (chunk) => chunks.push(chunk));
  _req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf-8");

    if (SHOULD_FAIL) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Mock LLM server: simulated failure",
            type: "server_error",
            code: "mock_failure",
          },
        }),
      );
      console.log("[mock-llm] Returned 500 (LLM_MOCK_FAIL=1)");
      return;
    }

    const openaiResponse = {
      id: "mock-chatcmpl-001",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(selectMockResponse(body)),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 450,
        completion_tokens: 280,
        total_tokens: 730,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(openaiResponse));
    const taskType = body.includes("failure mode") ? "failure_mode" : "reliability";
    console.log(`[mock-llm] Returned 200 with canned ${taskType} response`);
  });
}

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(
    `[mock-llm] Listening on http://localhost:${PORT} (fail=${SHOULD_FAIL})`,
  );
});

// Graceful shutdown
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
