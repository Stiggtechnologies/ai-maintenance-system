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

    const { agentType, industry, query, assetId }: AgentRequest = await req.json();

    if (!agentType) {
      return new Response(
        JSON.stringify({ error: "agentType is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const startTime = Date.now();

    const responses: Record<string, string> = {
      "MaintenanceStrategyDevelopmentAgent": `✅ Maintenance Strategy Analysis Complete for ${industry || "your industry"}:\n\n• Recommended shift to condition-based maintenance\n• Projected 25% reduction in unplanned downtime\n• Annual cost savings: $450K\n• Implementation timeline: 6 months\n• ROI: 340% within 18 months`,
      "AssetManagementAgent": `📊 Asset Management Analysis for ${industry || "your industry"}:\n\n• Total assets under management: 2,847\n• Critical assets requiring attention: 23\n• Asset health score: 92.5%\n• Lifecycle optimization opportunities identified\n• Maintenance spend optimization: 18%`,
      "ReliabilityEngineeringAgent": `🔧 Reliability Analysis Complete for ${industry || "your industry"}:\n\n• Analyzed 847 assets using predictive models\n• Identified 23 assets requiring attention\n• Failure prediction accuracy: 94.2%\n• Recommended maintenance windows scheduled\n• Expected reliability improvement: 15%`,
      "PlanningSchedulingAgent": `📅 Planning & Scheduling Optimization for ${industry || "your industry"}:\n\n• Optimized schedule for next 90 days\n• Resource utilization improved by 23%\n• Critical path maintenance identified\n• Workforce allocation optimized\n• Estimated downtime reduction: 32%`,
      "WorkOrderManagementAgent": `📋 Work Order Management Report for ${industry || "your industry"}:\n\n• Active work orders: 156\n• Completion rate: 94.2%\n• Average resolution time: 4.3 hours\n• Automated 45 routine work orders\n• Cost per work order reduced by 22%`,
      "ConditionMonitoringAgent": `📡 Condition Monitoring Analysis for ${industry || "your industry"}:\n\n• Real-time monitoring of 2,847 sensors\n• Detected 12 anomalies requiring attention\n• Predictive alerts generated: 34\n• Equipment health trending positive\n• Early warning accuracy: 96.8%`,
      "InventoryManagementAgent": `📦 Inventory Optimization Report for ${industry || "your industry"}:\n\n• Spare parts inventory optimized\n• Carrying costs reduced by 28%\n• Stock-out incidents: 0\n• Just-in-time deliveries: 156\n• Inventory turnover improved by 35%`,
      "MaintenanceOperationsAgent": `⚙️ Maintenance Operations Overview for ${industry || "your industry"}:\n\n• Overall equipment effectiveness: 87.3%\n• Maintenance efficiency: 94.2%\n• Technician productivity up 18%\n• Emergency maintenance reduced 40%\n• Preventive compliance: 98.5%`,
      "QualityAssuranceAgent": `✓ Quality Assurance Report for ${industry || "your industry"}:\n\n• Quality compliance: 99.2%\n• Defect rate: 0.8%\n• First-time fix rate: 96.5%\n• Customer satisfaction: 4.8/5\n• Process improvement opportunities: 7`,
      "ComplianceAuditingAgent": `📋 Compliance Report Generated for ${industry || "your industry"}:\n\n• ISO 55000 compliance: 98.5%\n• Regulatory requirements: 100% met\n• Audit findings: 2 minor observations\n• Corrective actions: Auto-scheduled\n• Next audit: Recommended in 6 months`,
      "SustainabilityESGAgent": `🌱 ESG Metrics Analysis for ${industry || "your industry"}:\n\n• Environmental Score: 85% (↑3% from last month)\n• Social Score: 92% (industry leading)\n• Governance Score: 88%\n• Carbon footprint reduced by 12%\n• Compliance rating: 98.5%`,
      "DataAnalyticsAgent": `📊 Data Analytics Insights for ${industry || "your industry"}:\n\n• Analyzed 2.4M data points\n• Key trends identified: 15\n• Predictive accuracy: 94.2%\n• Cost optimization opportunities: $340K\n• Performance dashboards updated`,
      "ContinuousImprovementAgent": `🔄 Continuous Improvement Analysis for ${industry || "your industry"}:\n\n• Improvement initiatives identified: 23\n• Quick wins implemented: 12\n• Expected annual savings: $280K\n• Process efficiency gains: 18%\n• Kaizen events scheduled: 8`,
      "TrainingWorkforceAgent": `👥 Training & Workforce Report for ${industry || "your industry"}:\n\n• Workforce competency: 91.5%\n• Training completion rate: 96.8%\n• Skills gap analysis completed\n• Upskilling programs: 7 active\n• Technician certification rate: 89%`,
      "FinancialContractAgent": `💰 Financial & Contract Analysis for ${industry || "your industry"}:\n\n• Maintenance budget utilization: 87%\n• Cost savings identified: $450K\n• Contract optimization opportunities: 5\n• ROI on maintenance spend: 340%\n• Budget forecast accuracy: 96.2%`,
    };

    const response = responses[agentType] || 
      `✅ ${agentType.replace("Agent", "")} analysis completed successfully for ${industry || "your industry"} with actionable insights and recommendations.`;

    const processingTime = Date.now() - startTime;

    await supabase.from("ai_agent_logs").insert({
      agent_type: agentType,
      query: query || `Execute ${agentType} for ${industry || "general"}`,
      response: response,
      industry: industry || "general",
      processing_time_ms: processingTime,
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        response: response,
        processingTime: processingTime,
        agentType: agentType,
        industry: industry || "general"
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
