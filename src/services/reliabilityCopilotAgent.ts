import type { CopilotMode, ReliabilityReport } from "../lib/reliability-report-engine";

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

export function buildLiveAgentQuery({
  mode,
  prompt,
  csvText,
  report,
}: LiveReliabilityAgentInput): string {
  const topBadActor = report.badActors[0];
  const averageDowntime =
    topBadActor && topBadActor.failures > 0
      ? topBadActor.downtimeHours / topBadActor.failures
      : undefined;
  const sourceGrounding = report.sources.length
    ? report.sources
      .map(
        (source) =>
          `- ${source.title} (${source.source}, ${source.pageRange}, confidence ${source.confidence}): ${source.summary} Supports: ${source.supports.join("; ")}`,
      )
      .join("\n")
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
    `- Top bad actor: ${
      topBadActor
        ? `${topBadActor.assetId}, ${topBadActor.failures} failures, ${topBadActor.downtimeHours} downtime hours`
        : "None"
    }`,
    `- Average downtime per event for top bad actor: ${
      averageDowntime === undefined
        ? "Not available"
        : `${averageDowntime.toFixed(2)} hours/failure`
    }`,
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
    "3. Show deterministic calculations and calculation limits. If operating hours are missing, explicitly say MTBF cannot be calculated. Do not convert calendar time to operating time unless the user explicitly states continuous operation. Never label calendar recurrence interval as MTBF. If repair events are missing, explicitly say MTTR cannot be calculated.",
    "4. Classify the case as RCA, FRACAS, FMEA/RCM, RAM, PM optimization, criticality, spares, lifecycle, or executive reporting as applicable.",
    "5. Rank likely failure modes with confidence and explain the evidence behind each ranking.",
    "6. Build an RCA/FRACAS starter pack when failures or chronic defects are present: problem statement, cause map, evidence table, containment actions, corrective actions, preventive actions, owners, due dates, verification method, and recurrence check.",
    "7. Identify evidence gaps by category: operating context, process conditions, maintenance history, component teardown, mechanical condition, CMMS data quality, OEM limits, and safety/regulatory constraints.",
    "8. Separate facts, assumptions, engineering judgement, recommendations, risks, and approval gates.",
    "9. Include confidence, consequence of being wrong, required validation, owner role, and human approval requirement for each material recommendation.",
    "10. Do not invent missing evidence, standards, OEM limits, failure history, operating hours, or regulatory requirements.",
    "11. Treat supplied failure investigation reports as report-format and investigation-discipline examples unless the user explicitly asks about that report. Do not transfer report-specific facts into unrelated customer asset analysis.",
    "12. Keep the answer practical enough for a reliability engineer to use in a failure review board or maintenance strategy review.",
    "13. Use a professional engineering tone. Do not use emojis or decorative symbols.",
    "14. For interactive chat, keep the answer under 1,100 words unless the user explicitly asks for a full report/export/deep analysis. Prefer the highest-value table only.",
    "15. Immediate containment actions should be reversible checks, inspections, isolation, documentation, and operating controls. Do not recommend design changes, seal upgrades, or flush-plan changes as immediate actions until evidence confirms the mechanism and the right approvers are named.",
  ].join("\n");
}

export async function runLiveReliabilityAgent(
  input: LiveReliabilityAgentInput,
): Promise<LiveReliabilityAgentResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      status: "disabled",
      response:
        "Live AI endpoint is not configured in this environment. The deterministic reliability workflow remains active.",
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ai-agent-processor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        agentType: "ReliabilityAgent",
        industry: "asset-intensive reliability engineering",
        query: buildLiveAgentQuery(input),
        requiresApproval: true,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.success) {
      return {
        status: "error",
        response:
          "The deterministic reliability workflow completed, but the live AI endpoint did not return a usable response.",
        error: payload.error || `HTTP ${response.status}`,
      };
    }

    return {
      status: "success",
      response: payload.response,
      provider: payload.provider,
      modelUsed: payload.modelUsed,
      processingTime: payload.processingTime,
    };
  } catch (error) {
    return {
      status: "error",
      response:
        "The deterministic reliability workflow completed, but the live AI endpoint could not be reached.",
      error: error instanceof Error ? error.message : "Unknown live AI error.",
    };
  }
}
