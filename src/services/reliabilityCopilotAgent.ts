import type { CopilotMode, ReliabilityReport } from "../lib/reliability-report-engine";
import { supabase } from "../lib/supabase";

export interface LiveReliabilityAgentResult {
  status: "disabled" | "success" | "error";
  response: string;
  provider?: string;
  modelUsed?: string;
  processingTime?: number;
  error?: string;
}

export interface LiveReliabilityAgentInput {
  mode: CopilotMode;
  prompt: string;
  csvText: string;
  report: ReliabilityReport;
}

export function buildLiveAgentQuery({ mode, prompt, csvText, report }: LiveReliabilityAgentInput): string {
  const topBadActor = report.badActors[0];
  const averageDowntime = topBadActor && topBadActor.failures > 0
    ? topBadActor.downtimeHours / topBadActor.failures
    : undefined;
  const sourceGrounding = report.sources.length
    ? report.sources.map((source) =>
      `- ${source.title} (${source.source}, ${source.pageRange}, confidence ${source.confidence}): ${source.summary} Supports: ${source.supports.join("; ")}`
    ).join("\n")
    : "- No retrieved reliability knowledge sources were matched for this request.";

  return [
    `Reliability method: ${mode}`,
    `User request: ${prompt}`,
    "",
    "Deterministic calculation and report context:",
    `- Risk level: ${report.riskLevel}`,
    `- Confidence: ${report.confidence}`,
    `- Records analyzed: ${report.dataSummary.recordCount}`,
    `- Top recommendation: ${report.recommendations[0] || "None generated"}`,
    `- Top action: ${report.actions[0] || "None generated"}`,
    `- Top bad actor: ${topBadActor ? `${topBadActor.assetId}, ${topBadActor.failures} failures, ${topBadActor.downtimeHours} downtime hours` : "None"}`,
    `- Average downtime per event for top bad actor: ${averageDowntime === undefined ? "Not available" : `${averageDowntime.toFixed(2)} hours/failure`}`,
    "",
    "Failure history sample:",
    csvText.slice(0, 6000),
    "",
    "Retrieved reliability knowledge grounding:",
    sourceGrounding,
    "",
    "Use the SyncAI governed reliability response contract:",
    "1. Start with the decision or recommendation.",
    "2. List known facts from the supplied data only.",
    "3. Show deterministic calculations and calculation limits. If operating hours are missing, state that MTBF cannot be calculated; do not relabel calendar recurrence as MTBF.",
    "4. Classify the case as RCA, FRACAS, FMEA/RCM, RAM, PM optimization, criticality, spares, lifecycle, or executive reporting as applicable.",
    "5. Rank likely failure modes with confidence and explain the evidence.",
    "6. When chronic failures exist, build a practical RCA/FRACAS starter pack with containment, corrective action, owners, due dates and effectiveness verification.",
    "7. Identify missing operating, maintenance, teardown, OEM and safety evidence.",
    "8. Separate facts, assumptions, engineering judgment, recommendations, risks and approval gates.",
    "9. Include consequence of being wrong, required validation and qualified human approval for each material recommendation.",
    "10. Do not invent evidence, standards, limits, failure history, operating hours or regulatory requirements.",
  ].join("\n");
}

export async function runLiveReliabilityAgent(input: LiveReliabilityAgentInput): Promise<LiveReliabilityAgentResult> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-agent-processor", {
      body: {
        agentType: "ReliabilityAgent",
        industry: "asset-intensive reliability engineering",
        query: buildLiveAgentQuery(input),
        requiresApproval: true,
      },
    });
    if (error || !data?.success) {
      return {
        status: "error",
        response: "The deterministic reliability workflow completed, but the live AI endpoint did not return a usable response.",
        error: error?.message || data?.error || "Live AI request failed.",
      };
    }
    return {
      status: "success",
      response: data.response,
      provider: data.provider,
      modelUsed: data.modelUsed,
      processingTime: data.processingTime,
    };
  } catch (error) {
    return {
      status: "error",
      response: "The deterministic reliability workflow completed, but the live AI endpoint could not be reached.",
      error: error instanceof Error ? error.message : "Unknown live AI error.",
    };
  }
}
