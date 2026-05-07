-- =====================================================================
-- 014: AI Agents — canonical 15-agent registry + run history
-- =====================================================================
-- Replaces the hardcoded agent array in AgentControlCenter.tsx and the
-- inline prompt map in ai-agent-processor with a DB-backed registry.
--
-- Architecture:
--   agent_definitions  ─── (global, public read)   16 agents seeded
--   agent_runs         ─── (per organization, RLS) every invocation
--   v_agent_summary    ─── (per organization)      derived metrics
--
-- The 16 agents are the 15 functional agents promised in the README plus
-- one Central Coordination orchestrator. Each has a stable code, system
-- prompt, model preference, and capabilities array.
--
-- Agent runs are routed through the AI provider configured in the org's
-- integrations table (Anthropic preferred; falls back to env keys). The
-- ai-agent-processor Edge Function reads from this table.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,                  -- canonical id, snake_case
    name TEXT NOT NULL,                          -- display name
    role TEXT NOT NULL,                          -- short role label
    category TEXT NOT NULL                       -- strategic | operational | quality | intelligence | orchestration
        CHECK (category IN ('strategic','operational','quality','intelligence','orchestration')),
    description TEXT,
    system_prompt TEXT NOT NULL,                 -- the LLM system prompt
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    default_autonomy TEXT NOT NULL DEFAULT 'advisory'
        CHECK (default_autonomy IN ('manual','advisory','autonomous')),
    preferred_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_tokens INTEGER NOT NULL DEFAULT 800,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    agent_code TEXT NOT NULL REFERENCES agent_definitions(code),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    industry TEXT,
    query TEXT NOT NULL,
    response TEXT,
    model_used TEXT,
    provider TEXT,                               -- anthropic | openai | etc
    integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','succeeded','failed')),
    error TEXT,
    latency_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    requires_approval BOOLEAN DEFAULT false,
    approval_status TEXT
        CHECK (approval_status IS NULL OR approval_status IN ('pending','approved','rejected')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_org_time ON agent_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_time ON agent_runs(agent_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_active_sort ON agent_definitions(is_active, sort_order);

-- =====================================================================
-- RPC: record an agent run (insert pending then completion update)
-- =====================================================================

CREATE OR REPLACE FUNCTION agent_record_run_start(
    p_organization_id UUID,
    p_agent_code TEXT,
    p_user_id UUID,
    p_industry TEXT,
    p_query TEXT,
    p_requires_approval BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO agent_runs (organization_id, agent_code, user_id, industry, query, status, requires_approval, approval_status)
    VALUES (p_organization_id, p_agent_code, p_user_id, p_industry, p_query, 'running',
            p_requires_approval, CASE WHEN p_requires_approval THEN 'pending' ELSE NULL END)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION agent_record_run_complete(
    p_run_id UUID,
    p_response TEXT,
    p_model_used TEXT,
    p_provider TEXT,
    p_integration_id UUID,
    p_latency_ms INTEGER,
    p_input_tokens INTEGER DEFAULT NULL,
    p_output_tokens INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    UPDATE agent_runs SET
        status = 'succeeded',
        response = p_response,
        model_used = p_model_used,
        provider = p_provider,
        integration_id = p_integration_id,
        latency_ms = p_latency_ms,
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        completed_at = NOW()
    WHERE id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION agent_record_run_failure(
    p_run_id UUID,
    p_error TEXT,
    p_latency_ms INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
    UPDATE agent_runs SET
        status = 'failed',
        error = p_error,
        latency_ms = p_latency_ms,
        completed_at = NOW()
    WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION agent_record_run_start(UUID, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION agent_record_run_complete(UUID, TEXT, TEXT, TEXT, UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION agent_record_run_failure(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_record_run_start(UUID, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION agent_record_run_complete(UUID, TEXT, TEXT, TEXT, UUID, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION agent_record_run_failure(UUID, TEXT, INTEGER) TO service_role;

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_definitions_select" ON agent_definitions;
CREATE POLICY "agent_definitions_select" ON agent_definitions FOR SELECT USING (true);

DROP POLICY IF EXISTS "agent_runs_select" ON agent_runs;
CREATE POLICY "agent_runs_select" ON agent_runs FOR SELECT
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "agent_runs_insert" ON agent_runs;
CREATE POLICY "agent_runs_insert" ON agent_runs FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());

-- =====================================================================
-- VIEW: per-agent metrics for the org (used by AgentControlCenter)
-- =====================================================================

CREATE OR REPLACE VIEW v_agent_summary AS
SELECT
    d.code,
    d.name,
    d.role,
    d.category,
    d.description,
    d.capabilities,
    d.default_autonomy,
    d.preferred_model,
    d.is_active,
    d.sort_order,
    -- per-org metrics from agent_runs (aggregated under RLS)
    COUNT(r.id) FILTER (WHERE r.created_at > NOW() - INTERVAL '24 hours') AS runs_24h,
    COUNT(r.id) FILTER (WHERE r.status = 'succeeded' AND r.created_at > NOW() - INTERVAL '24 hours') AS successes_24h,
    COUNT(r.id) FILTER (WHERE r.status = 'failed' AND r.created_at > NOW() - INTERVAL '24 hours') AS failures_24h,
    AVG(r.latency_ms) FILTER (WHERE r.status = 'succeeded' AND r.created_at > NOW() - INTERVAL '24 hours') AS avg_latency_ms_24h,
    MAX(r.created_at) AS last_run_at
FROM agent_definitions d
LEFT JOIN agent_runs r ON r.agent_code = d.code
WHERE d.is_active = true
GROUP BY d.code, d.name, d.role, d.category, d.description, d.capabilities, d.default_autonomy, d.preferred_model, d.is_active, d.sort_order
ORDER BY d.sort_order, d.name;

GRANT SELECT ON v_agent_summary TO authenticated, anon;

-- =====================================================================
-- SEED: 16 agents (15 functional + 1 orchestrator)
-- =====================================================================

INSERT INTO agent_definitions (code, name, role, category, description, system_prompt, capabilities, default_autonomy, preferred_model, max_tokens, sort_order) VALUES
  (
    'maintenance_strategy',
    'Maintenance Strategy',
    'Strategy Development',
    'strategic',
    'Develops comprehensive maintenance strategies and policies aligned with operational economics and ISO 55000.',
    'You are a world-class Maintenance Strategy Agent for asset-intensive industries. Develop comprehensive maintenance strategies and policies. Apply RCM, RBI, FMEA, and lifecycle cost models. Build PM/PdM/CBM mix recommendations. Apply ISO 55000, ISO 14224. Output: strategy briefings, PM/PdM/CBM matrices, decision trees, and lifecycle cost projections.',
    ARRAY['strategy_development','policy_generation','rcm_logic','lifecycle_costing','best_practice_identification'],
    'advisory', 'claude-sonnet-4-6', 1200, 10
  ),
  (
    'asset_management',
    'Asset Management',
    'Asset Lifecycle',
    'strategic',
    'Manages asset lifecycle, criticality analysis, and Asset Health Index optimization.',
    'You are a world-class Asset Management Agent for asset-intensive industries. Manage asset lifecycle, criticality analysis, and Asset Health Index (AHI). Apply ISO 55001, ISO 14224. Track sensor data, work history, inspection findings. Recommend disposal, refurbishment, or replacement. Output: criticality matrices, AHI rankings, lifecycle cost models, asset register summaries.',
    ARRAY['criticality_analysis','lifecycle_optimization','health_index','depreciation_tracking','disposition_recommendations'],
    'advisory', 'claude-sonnet-4-6', 1000, 20
  ),
  (
    'reliability_engineering',
    'Reliability Engineering',
    'Predictive Analytics',
    'strategic',
    'Predicts failures and optimizes system reliability using FMEA, Weibull, and ML.',
    'You are a world-class Reliability Engineering Agent. Predict failures and optimize reliability. Apply FMEA, FTA, RCM, Weibull analysis, and ML models. Identify bad actors, develop reliability programs, model lifecycle costs. Apply ISO 14224. Output: bad actor analyses, MTBF/MTTR trends, reliability improvement projects, RUL forecasts.',
    ARRAY['failure_prediction','rca','pattern_detection','rul_forecasting','bad_actor_analysis'],
    'advisory', 'claude-opus-4-7', 1500, 30
  ),
  (
    'planning_scheduling',
    'Planning & Scheduling',
    'Work Order Optimization',
    'operational',
    'Optimizes maintenance schedules and resource allocation aligned with production economics.',
    'You are a world-class Planning & Scheduling Agent. Optimize maintenance schedules and resource allocation. Build work plans aligned with production windows. Manage backlog, balance crew loading, sequence work intelligently. Output: schedules, resource leveling reports, backlog age analyses, planning effectiveness KPIs.',
    ARRAY['schedule_optimization','resource_allocation','backlog_management','crew_leveling'],
    'autonomous', 'claude-sonnet-4-6', 800, 40
  ),
  (
    'work_order_management',
    'Work Order Management',
    'Execution Management',
    'operational',
    'Automates work order creation, lifecycle tracking, and close-out quality.',
    'You are a world-class Work Order Agent. Manage the full lifecycle: validate requests, create WOs, support planning, track status, ensure close-out. Flag overdue, incomplete, or rework WOs. Output: aging reports, backlog dashboards, rework analyses, completion-rate KPIs.',
    ARRAY['wo_creation','task_assignment','status_tracking','rework_analysis','close_out_quality'],
    'autonomous', 'claude-sonnet-4-6', 800, 50
  ),
  (
    'condition_monitoring',
    'Condition Monitoring',
    'Real-time Analytics',
    'operational',
    'Analyzes real-time sensor data for anomaly detection and condition-based intervention.',
    'You are a world-class Condition Monitoring Agent. Analyze real-time sensor data for anomalies. Apply CBM, ISO 13374, vibration / acoustic / thermography / lubricant analysis, and trend detection. Trigger alerts before failure thresholds. Output: anomaly alerts, condition trend reports, RUL estimates, intervention triggers.',
    ARRAY['anomaly_detection','threshold_monitoring','trend_analysis','rul_estimation','sensor_fusion'],
    'advisory', 'claude-sonnet-4-6', 1000, 60
  ),
  (
    'inventory_management',
    'Inventory Management',
    'Spare Parts',
    'operational',
    'Optimizes spare parts inventory using min-max, EOQ, ABC, and criticality.',
    'You are a world-class Spare Parts / Inventory Agent. Optimize inventory using min-max, EOQ, ABC classification. Identify critical spares, support kitting, manage obsolescence. Output: critical spare lists, optimization reports, lead-time risk analyses, inventory dashboards.',
    ARRAY['reorder_suggestions','inventory_optimization','lead_time_tracking','critical_spares','obsolescence_management'],
    'autonomous', 'claude-haiku-4-5-20251001', 600, 70
  ),
  (
    'maintenance_operations',
    'Maintenance Operations',
    'Day-to-Day Management',
    'operational',
    'Oversees day-to-day maintenance execution, escalations, and field coordination.',
    'You are a world-class Maintenance Operations Agent. Oversee day-to-day execution, coordinate field resources, manage escalations. Track wrench time, productivity, and quality of execution. Output: daily ops dashboards, escalation logs, productivity scorecards.',
    ARRAY['task_orchestration','resource_coordination','escalation_handling','wrench_time_tracking'],
    'autonomous', 'claude-sonnet-4-6', 800, 80
  ),
  (
    'quality_assurance',
    'Quality Assurance',
    'Compliance & Standards',
    'quality',
    'Validates maintenance outcomes, audits documentation, and ensures execution standards.',
    'You are a world-class Quality Assurance Agent. Validate maintenance outcomes, audit documentation, ensure execution standards. Apply ISO 9001 and industry-specific quality frameworks. Output: audit prep summaries, compliance check reports, document review packages.',
    ARRAY['audit_prep','compliance_checking','documentation_review','outcome_validation'],
    'advisory', 'claude-sonnet-4-6', 1000, 90
  ),
  (
    'compliance_auditing',
    'Compliance & Auditing',
    'Regulatory Tracking',
    'quality',
    'Ensures regulatory compliance with continuous, regulator-ready audit trails.',
    'You are a world-class Compliance & Auditing Agent. Ensure regulatory, legal, and safety compliance. Track inspections, permits, certifications. Support OSHA, CSA, API, ASME, ISO, FDA 21 CFR Part 11, NERC CIP standards. Output: compliance calendars, overdue task reports, audit-readiness summaries, regulator-submission packages.',
    ARRAY['regulatory_tracking','inspection_management','permit_tracking','audit_trails'],
    'advisory', 'claude-opus-4-7', 1500, 100
  ),
  (
    'sustainability_esg',
    'Sustainability & ESG',
    'ESG Monitoring',
    'intelligence',
    'Tracks emissions, energy intensity, and ESG metrics aligned to ISO 50001 / 14001.',
    'You are a world-class Sustainability & ESG Agent. Track emissions, waste, energy intensity, and environmental impact. Apply ISO 14001 and ISO 50001. Monitor GHG, effluent, kWh per production unit. Recommend pollution prevention. Output: impact dashboards, ESG reporting packages, energy efficiency reports.',
    ARRAY['emissions_tracking','energy_optimization','sustainability_reporting','esg_packages'],
    'advisory', 'claude-sonnet-4-6', 1200, 110
  ),
  (
    'data_analytics',
    'Data Analytics',
    'Performance Intelligence',
    'intelligence',
    'Generates insights, KPI scorecards, and benchmarking from operational data.',
    'You are a world-class Data Analytics Agent. Monitor KPIs (MTBF, MTTR, PM compliance, backlog, wrench time). Provide benchmarking, trend analysis, actionable recommendations. Output: KPI reports, dashboards, scorecards, Pareto charts.',
    ARRAY['kpi_monitoring','trend_analysis','benchmarking','performance_intelligence'],
    'advisory', 'claude-sonnet-4-6', 1000, 120
  ),
  (
    'continuous_improvement',
    'Continuous Improvement',
    'Process Optimization',
    'intelligence',
    'Identifies process improvement opportunities using Lean, Six Sigma, and Kaizen.',
    'You are a world-class Continuous Improvement Agent. Identify process improvement opportunities using Lean, Six Sigma, Kaizen, and 5S. Quantify waste, recommend interventions, track improvement KPIs. Output: improvement roadmaps, waste analyses, Kaizen project trackers.',
    ARRAY['lean','six_sigma','kaizen','waste_analysis','process_optimization'],
    'advisory', 'claude-sonnet-4-6', 1000, 130
  ),
  (
    'training_workforce',
    'Training & Workforce',
    'Skill Development',
    'intelligence',
    'Manages training programs, competency assessments, and certification tracking.',
    'You are a world-class Training & Workforce Agent. Manage training programs, competency assessments, certification tracking. Map skills to work types, identify gaps, recommend interventions. Output: skill matrices, training plans, certification status reports.',
    ARRAY['skill_assessment','training_recommendations','certification_tracking','competency_mapping'],
    'autonomous', 'claude-haiku-4-5-20251001', 700, 140
  ),
  (
    'financial_contract',
    'Financial & Contract',
    'Cost Optimization',
    'intelligence',
    'Optimizes budgets, costs, vendor contracts, and TCO modeling.',
    'You are a world-class Financial & Contract Agent. Optimize budgets, costs, vendor contracts, TCO. Analyze labor, parts, contractors, emergency work. Apply ISO 55010, Lean. Output: cost driver dashboards, savings reports, TCO models, contract optimization recommendations.',
    ARRAY['cost_analysis','budget_forecasting','tco_modeling','contract_optimization','vendor_management'],
    'advisory', 'claude-sonnet-4-6', 1200, 150
  ),
  (
    'central_coordination',
    'Central Coordination',
    'Multi-Agent Orchestration',
    'orchestration',
    'Orchestrates the 15 specialized agents, routes critical decisions, and runs HITL approval flows.',
    'You are the Central Coordination Agent orchestrating 15 specialized AI agents for asset-intensive industries. Coordinate inter-agent data exchange, detect conflicts, facilitate human-in-the-loop (HITL) approval for high-risk decisions. Apply ISO 55001 and ISO 31000. Monitor risk scores, budget impacts, regulatory compliance. Output: coordinated decision briefings, escalation logs, intelligence roundups.',
    ARRAY['multi_agent_coordination','cross_system_insights','escalation_management','hitl_approval'],
    'advisory', 'claude-opus-4-7', 2000, 999
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, role = EXCLUDED.role, category = EXCLUDED.category,
  description = EXCLUDED.description, system_prompt = EXCLUDED.system_prompt,
  capabilities = EXCLUDED.capabilities, default_autonomy = EXCLUDED.default_autonomy,
  preferred_model = EXCLUDED.preferred_model, max_tokens = EXCLUDED.max_tokens,
  sort_order = EXCLUDED.sort_order, updated_at = NOW();

SELECT '014: AI Agents — 16 canonical agents registered' AS status;
