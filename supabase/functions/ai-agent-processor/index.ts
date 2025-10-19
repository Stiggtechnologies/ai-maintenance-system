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
}

function selectOptimalModel(agentType: string, query?: string): string {
  const queryLength = query?.length || 0;
  const complexAgents = [
    "MaintenanceStrategyDevelopmentAgent",
    "ReliabilityEngineeringAgent",
    "DataAnalyticsAgent",
    "SustainabilityESGAgent",
    "FinancialContractAgent"
  ];

  if (complexAgents.includes(agentType) || queryLength > 500) {
    return "gpt-4o";
  }

  if (queryLength > 200) {
    return "gpt-4o-mini";
  }

  return "gpt-4o-mini";
}

function buildSystemPrompt(agentType: string, industry?: string): string {
  const agentName = agentType.replace("Agent", "");
  const industryContext = industry ? ` in the ${industry} industry` : "";

  const agentPrompts: Record<string, string> = {
    "MaintenanceStrategyDevelopmentAgent": `You are an expert Maintenance Strategy Development Agent${industryContext}. Analyze maintenance approaches, recommend optimization strategies, calculate ROI projections, and provide actionable implementation timelines. Focus on condition-based maintenance, predictive strategies, and cost reduction.`,

    "AssetManagementAgent": `You are an expert Asset Management Agent${industryContext}. Provide comprehensive asset portfolio analysis, health scores, lifecycle optimization, and maintenance spend recommendations. Include specific metrics and actionable insights.`,

    "ReliabilityEngineeringAgent": `You are an expert Reliability Engineering Agent${industryContext}. Analyze asset reliability using predictive models, identify at-risk equipment, calculate failure probabilities, and recommend maintenance windows. Provide accuracy metrics and improvement projections.`,

    "PlanningSchedulingAgent": `You are an expert Planning & Scheduling Agent${industryContext}. Optimize maintenance schedules, resource allocation, workforce utilization, and critical path planning. Provide specific timelines and efficiency improvements.`,

    "WorkOrderManagementAgent": `You are an expert Work Order Management Agent${industryContext}. Analyze active work orders, completion rates, resolution times, automation opportunities, and cost optimization. Provide metrics and actionable recommendations.`,

    "ConditionMonitoringAgent": `You are an expert Condition Monitoring Agent${industryContext}. Analyze real-time sensor data, detect anomalies, generate predictive alerts, and assess equipment health trends. Include accuracy metrics and early warning capabilities.`,

    "InventoryManagementAgent": `You are an expert Inventory Management Agent${industryContext}. Optimize spare parts inventory, reduce carrying costs, prevent stock-outs, manage just-in-time deliveries, and improve turnover rates. Provide specific metrics.`,

    "MaintenanceOperationsAgent": `You are an expert Maintenance Operations Agent${industryContext}. Analyze overall equipment effectiveness, maintenance efficiency, technician productivity, emergency maintenance reduction, and preventive compliance. Provide operational metrics.`,

    "QualityAssuranceAgent": `You are an expert Quality Assurance Agent${industryContext}. Assess quality compliance, defect rates, first-time fix rates, customer satisfaction, and process improvement opportunities. Include specific quality metrics.`,

    "ComplianceAuditingAgent": `You are an expert Compliance & Auditing Agent${industryContext}. Generate compliance reports for ISO 55000, regulatory requirements, audit findings, corrective actions, and audit scheduling. Provide compliance percentages.`,

    "SustainabilityESGAgent": `You are an expert Sustainability & ESG Agent${industryContext}. Analyze Environmental, Social, and Governance metrics, carbon footprint reduction, compliance ratings, and sustainability improvements. Provide ESG scores and trends.`,

    "DataAnalyticsAgent": `You are an expert Data Analytics Agent${industryContext}. Analyze large datasets, identify key trends, provide predictive insights, calculate cost optimization opportunities, and deliver performance dashboards. Include accuracy metrics.`,

    "ContinuousImprovementAgent": `You are an expert Continuous Improvement Agent${industryContext}. Identify improvement initiatives, implement quick wins, calculate savings potential, measure efficiency gains, and schedule Kaizen events. Provide improvement metrics.`,

    "TrainingWorkforceAgent": `You are an expert Training & Workforce Development Agent${industryContext}. Assess workforce competency, training completion rates, skills gap analysis, upskilling programs, and certification rates. Provide development metrics.`,

    "FinancialContractAgent": `You are an expert Financial & Contract Management Agent${industryContext}. Analyze maintenance budget utilization, identify cost savings, optimize contracts, calculate ROI, and forecast budget accuracy. Provide financial metrics.`
  };

  return agentPrompts[agentType] || `You are an expert ${agentName}${industryContext}. Provide detailed analysis with actionable insights and specific metrics.`;
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
      max_completion_tokens: 1000
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

    const { agentType, industry, query, assetId, openaiKey }: AgentRequest = await req.json();

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
        JSON.stringify({ error: "OpenAI API key not configured. Please provide openaiKey in request or configure OPENAI_API_KEY environment variable." }),
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

    if (!userQuery) {
      userQuery = `Provide a comprehensive analysis and actionable recommendations for ${agentType.replace("Agent", "")} in ${industry || "the industrial sector"}. Include specific metrics, insights, and next steps.`;
    } else if (userQuery.length < 50) {
      userQuery = `${userQuery}\n\nPlease provide a brief, helpful response. If this is a greeting or simple question, respond conversationally and then offer relevant ${agentType.replace("Agent", "")} insights for ${industry || "the industrial sector"}.`;
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
        modelUsed: selectedModel
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
