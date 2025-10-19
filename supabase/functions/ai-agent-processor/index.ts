import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AgentRequest {
  agentType: string;
  industry?: string;
  query?: string;
  assetId?: string;
  openaiKey?: string;
  requiresApproval?: boolean;
}

function selectOptimalModel(agentType: string, query?: string): string {
  const queryLength = query?.length || 0;

  const complexAgents = [
    "PreventiveMaintenanceAgent",
    "PredictiveAnalyticsAgent",
    "RootCauseAnalysisAgent",
    "FailureModeAgent",
    "RiskAssessmentAgent",
    "ReliabilityAgent",
    "CentralCoordinationAgent"
  ];

  if (complexAgents.includes(agentType) || queryLength > 500) {
    return "gpt-4o";
  }

  return "gpt-4o-mini";
}

function buildSystemPrompt(agentType: string, industry?: string): string {
  const industryContext = industry ? ` in the ${industry} industry` : "";

  const agentPrompts: Record<string, string> = {
    "PreventiveMaintenanceAgent": `You are a world-class Preventive Maintenance (PM) Agent for asset-intensive industries${industryContext}. Build time-based and usage-based maintenance strategies. Create PM calendars, standardize tasks, optimize schedules, and support work packaging. Use RCM logic and FMEA. Track PM compliance and effectiveness. Provide PM task lists, calendars, and optimization reports.`,

    "PredictiveAnalyticsAgent": `You are a world-class Predictive Analytics Agent${industryContext}. Anticipate equipment failures using real-time data and historical insights. Monitor condition-based data, forecast Remaining Useful Life (RUL), and trigger intelligent alerts. Apply CBM, ISO 13374, trend analysis, and ML models. Output predictive alerts, RUL dashboards, and risk scoring.`,

    "AssetHealthAgent": `You are a world-class Asset Health Agent${industryContext}. Provide real-time holistic health views of critical equipment. Calculate Asset Health Index (AHI), detect degradation patterns, and prioritize interventions. Track sensor data, work history, and inspection findings. Output health dashboards, AHI rankings, and watchlists.`,

    "WorkOrderAgent": `You are a world-class Work Order Agent${industryContext}. Manage the full lifecycle: validate requests, create WOs, support planning, track status, and ensure close-out. Monitor all stages from Created to Closed. Flag overdue and incomplete WOs. Output aging reports, backlog dashboards, and rework analysis.`,

    "RootCauseAnalysisAgent": `You are a world-class Root Cause Analysis (RCA) Agent${industryContext}. Identify underlying failure causes using 5 Whys, Fishbone, FTA, and Pareto. Recommend corrective actions and monitor post-RCA performance. Focus on root causes, not symptoms. Output RCA reports, action trackers, and improvement metrics.`,

    "SparePartsAgent": `You are a world-class Spare Parts Agent${industryContext}. Ensure right part, right time, right quantity. Optimize inventory using min-max, EOQ, and ABC classification. Identify critical spares, support kitting, manage obsolescence. Output critical spare lists, optimization reports, and inventory dashboards.`,

    "PerformanceAnalysisAgent": `You are a world-class Performance Analysis Agent${industryContext}. Monitor KPIs including MTBF, MTTR, PM compliance, backlog, and wrench time. Provide benchmarking, trend analysis, and actionable recommendations. Output KPI reports, dashboards, scorecards, and Pareto charts.`,

    "FailureModeAgent": `You are a world-class Failure Mode Agent${industryContext}. Identify and classify failure modes using FMEA and RCM. Assign RPN scores, recommend mitigations, and update based on field data. Apply SAE JA1011/1012 and ISO 14224. Output FMEA tables, risk heat maps, and mitigation plans.`,

    "CostOptimizationAgent": `You are a world-class Cost Optimization Agent${industryContext}. Reduce costs without compromising reliability. Analyze labor, parts, contractors, and emergency work. Run TCO models and cost-benefit scenarios. Apply ISO 55010 and Lean principles. Output cost driver dashboards, savings reports, and TCO models.`,

    "ComplianceAgent": `You are a world-class Compliance Agent${industryContext}. Ensure regulatory, legal, and safety compliance. Track inspections, permits, and certifications. Support audits and flag risks. Monitor OSHA, CSA, API, ASME, ISO standards. Output compliance calendars, overdue task reports, and audit readiness summaries.`,

    "RiskAssessmentAgent": `You are a world-class Risk Assessment Agent${industryContext}. Identify, quantify, and mitigate operational, safety, and financial risks. Apply risk matrices, FMEA, Bowtie, and cost of failure models. Use ISO 31000 and ISO 55001. Output risk registers, heat maps, and mitigation trackers.`,

    "EnergyEfficiencyAgent": `You are a world-class Energy Efficiency Agent${industryContext}. Identify and reduce energy waste. Monitor consumption, detect inefficiencies, and recommend improvements. Support ISO 50001 and ESG goals. Track kWh per production unit and emissions. Output usage reports, efficiency dashboards, and ROI analyses.`,

    "EnvironmentalAgent": `You are a world-class Environmental Agent${industryContext}. Monitor emissions, waste, and environmental impact. Ensure ISO 14001 compliance and support ESG reporting. Track GHG, effluent, spills, and incidents. Recommend pollution prevention. Output impact dashboards, compliance calendars, and ESG packages.`,

    "SafetyAgent": `You are a world-class Safety Agent${industryContext}. Enhance workplace safety and prevent incidents. Track hazards, analyze incidents, ensure ISO 45001 and OSHA compliance. Monitor TRIR, LTIR, and training. Use JSA, FLRA, and permit-to-work systems. Output safety reports, action trackers, and performance dashboards.`,

    "ReliabilityAgent": `You are a world-class Reliability Agent${industryContext}. Maximize uptime and reduce failures using reliability engineering. Identify bad actors, develop reliability strategies, and model lifecycle costs. Apply RCM, Weibull analysis, and ISO 55000. Output reliability improvement projects, MTBF/MTTR trends, and bad actor analyses.`,

    "CentralCoordinationAgent": `You are the Central Coordination Agent orchestrating 15 specialized AI agents for asset-intensive industries${industryContext}. Coordinate inter-agent data exchange, detect conflicts, and facilitate human-in-the-loop (HITL) approval for high-risk decisions. Route critical events for human review with decision summaries, data visualizations, and recommended actions. Apply ISO 55001 and ISO 31000. Monitor risk scores, budget impacts, and regulatory compliance. Output coordinated decision briefings, escalation logs, and intelligence roundups.`
  };

  return agentPrompts[agentType] || `You are an expert AI agent for asset-intensive industries${industryContext}. Provide detailed, actionable insights with specific metrics and recommendations.`;
}

async function callOpenAI(model: string, systemPrompt: string, userQuery: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userQuery }
      ],
      temperature: 0.7,
      max_completion_tokens: 800
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { agentType, industry, query, assetId, openaiKey, requiresApproval }: AgentRequest = await req.json();

    if (!agentType) {
      return new Response(
        JSON.stringify({ error: "agentType is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = openaiKey || Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const startTime = Date.now();
    const selectedModel = selectOptimalModel(agentType, query);
    const systemPrompt = buildSystemPrompt(agentType, industry);

    let userQuery = query;
    const industryContextStr = industry ? ` in the ${industry} industry` : "";

    if (!userQuery) {
      userQuery = `Provide a concise analysis and actionable recommendations for ${agentType.replace("Agent", "")}${industryContextStr}. Include key metrics and next steps.`;
    } else if (userQuery.length < 50) {
      userQuery = `${userQuery}\n\nProvide a brief, helpful response. If this is a greeting, respond conversationally then offer relevant insights.`;
    }

    const aiResponse = await callOpenAI(selectedModel, systemPrompt, userQuery, apiKey);
    const processingTime = Date.now() - startTime;

    await supabase.from("ai_agent_logs").insert({
      agent_type: agentType,
      query: userQuery,
      response: aiResponse,
      industry: industry || "general",
      processing_time_ms: processingTime,
    });

    return new Response(
      JSON.stringify({
        success: true,
        response: aiResponse,
        processingTime: processingTime,
        agentType: agentType,
        industry: industry || "general",
        modelUsed: selectedModel,
        requiresApproval: requiresApproval || false
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing AI agent request:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
