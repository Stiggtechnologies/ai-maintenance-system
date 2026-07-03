-- SyncAI Intelligence Runtime — Base Agents
INSERT INTO sir_agents (id, tenant_id, name, agent_type, persona, config, status) VALUES
('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'JAVIS Assistant', 'javis', '{"role":"AI maintenance assistant","focus":"role-aware maintenance intelligence"}', '{"model":"gpt-4o-mini","max_tokens":2000}', 'active'),
('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Preventive Maintenance Agent', 'PreventiveMaintenanceAgent', '{"role":"PM specialist","focus":"RCM, FMEA, PM calendars"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Asset Health Agent', 'AssetHealthAgent', '{"role":"health monitoring specialist","focus":"AHI, degradation patterns, sensor analysis"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Work Order Agent', 'WorkOrderAgent', '{"role":"work management specialist","focus":"WO lifecycle, backlog, scheduling"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Root Cause Analysis Agent', 'RootCauseAnalysisAgent', '{"role":"RCA specialist","focus":"5 Whys, Fishbone, FTA"}', '{"model":"gpt-4o"}', 'active'),
('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Performance Analysis Agent', 'PerformanceAnalysisAgent', '{"role":"KPI analyst","focus":"benchmarking, trend analysis, OEE"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Reliability Agent', 'ReliabilityAgent', '{"role":"reliability engineer","focus":"RCM, Weibull, bad actors"}', '{"model":"gpt-4o"}', 'active'),
('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Central Coordination Agent', 'CentralCoordinationAgent', '{"role":"coordinator","focus":"multi-agent routing, query classification"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'Compliance Agent', 'ComplianceAgent', '{"role":"compliance specialist","focus":"OSHA, CSA, API, ISO standards"}', '{"model":"gpt-4o-mini"}', 'active'),
('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Risk Assessment Agent', 'RiskAssessmentAgent', '{"role":"risk analyst","focus":"risk matrices, ISO 31000"}', '{"model":"gpt-4o-mini"}', 'active')
ON CONFLICT DO NOTHING;

-- SIR Tools (registered tools that agents can use)
INSERT INTO sir_tools (id, name, description, schema, handler, is_active) VALUES
('t0000000-0000-0000-0000-000000000001', 'query_asset_health', 'Query current health data for an asset', '{"type":"object","properties":{"asset_id":{"type":"string"}}}', 'supabase:asset_health_monitoring', true),
('t0000000-0000-0000-0000-000000000002', 'create_work_order', 'Create a new work order', '{"type":"object","properties":{"title":{"type":"string"},"asset_id":{"type":"string"},"priority":{"type":"string"}}}', 'supabase:work_orders', true),
('t0000000-0000-0000-0000-000000000003', 'search_knowledge_base', 'Search the RAG knowledge base', '{"type":"object","properties":{"query":{"type":"string"},"tenant_id":{"type":"string"}}}', 'edge:rag-semantic-search', true),
('t0000000-0000-0000-0000-000000000004', 'get_kpi_values', 'Get latest KPI values for an organization', '{"type":"object","properties":{"org_id":{"type":"string"},"kpi_codes":{"type":"array","items":{"type":"string"}}}}', 'rpc:get_latest_kpi_values', true),
('t0000000-0000-0000-0000-000000000005', 'get_work_orders', 'Query work orders with filters', '{"type":"object","properties":{"org_id":{"type":"string"},"status":{"type":"string"},"priority":{"type":"string"}}}', 'supabase:work_orders', true),
('t0000000-0000-0000-0000-000000000006', 'acknowledge_alert', 'Acknowledge a system alert', '{"type":"object","properties":{"alert_id":{"type":"string"}}}', 'supabase:system_alerts', true),
('t0000000-0000-0000-0000-000000000007', 'calculate_oee', 'Calculate OEE for a site', '{"type":"object","properties":{"site_id":{"type":"string"}}}', 'rpc:calculate_site_oee', true),
('t0000000-0000-0000-0000-000000000008', 'approve_recommendation', 'Approve an AI recommendation', '{"type":"object","properties":{"recommendation_id":{"type":"string"},"comments":{"type":"string"}}}', 'rpc:approve_recommendation', true)
ON CONFLICT DO NOTHING;
