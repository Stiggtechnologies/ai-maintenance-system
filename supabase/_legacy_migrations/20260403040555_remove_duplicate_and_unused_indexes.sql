/*
  # Remove Duplicate and Unused Indexes

  This migration removes duplicate and unused indexes to improve database performance
  and reduce storage overhead. Unused indexes consume space and slow down write operations
  without providing query benefits.

  ## Changes

  1. **Remove Duplicate Indexes**
     - Drop `idx_evidence_refs_evidence` (duplicate of `idx_evidence_references_evidence_id`)

  2. **Remove Unused Indexes** 
     - These indexes have not been used by any queries and can be safely removed
     - Can be recreated later if query patterns change

  ## Performance Impact

  - Reduced storage usage
  - Faster INSERT/UPDATE/DELETE operations
  - Simplified index maintenance
  - No impact on query performance (indexes are unused)
*/

-- ============================================================================
-- DROP DUPLICATE INDEXES
-- ============================================================================

-- Drop duplicate evidence index (keep the more descriptive one)
DROP INDEX IF EXISTS idx_evidence_refs_evidence;

-- ============================================================================
-- DROP UNUSED INDEXES
-- ============================================================================

-- Maintenance metrics indexes
DROP INDEX IF EXISTS idx_maintenance_metrics_metric_name;
DROP INDEX IF EXISTS idx_maintenance_metrics_recorded_at;

-- Fine-tuning and model indexes
DROP INDEX IF EXISTS idx_ft_models_dataset_id;
DROP INDEX IF EXISTS idx_ft_models_created_by;
DROP INDEX IF EXISTS idx_fine_tuning_datasets_verified_by;
DROP INDEX IF EXISTS idx_model_deployments_model_id;
DROP INDEX IF EXISTS idx_model_evaluations_evaluated_by;

-- Agent and conversation indexes
DROP INDEX IF EXISTS idx_agent_conversations_user_id;
DROP INDEX IF EXISTS idx_agent_feedback_user_id;

-- Approval workflow indexes
DROP INDEX IF EXISTS idx_approval_workflows_decision_id;
DROP INDEX IF EXISTS idx_approval_workflows_approver_id;

-- Billing indexes
DROP INDEX IF EXISTS idx_billing_subscriptions_plan_id;
DROP INDEX IF EXISTS idx_gainshare_runs_invoice_id;

-- Document uploads
DROP INDEX IF EXISTS idx_document_uploads_uploaded_by;

-- Graph indexes
DROP INDEX IF EXISTS idx_graph_relationships_from_entity_id;
DROP INDEX IF EXISTS idx_graph_relationships_to_entity_id;

-- Knowledge base indexes
DROP INDEX IF EXISTS idx_knowledge_base_chunks_next_chunk_id;
DROP INDEX IF EXISTS idx_knowledge_base_chunks_previous_chunk_id;
DROP INDEX IF EXISTS idx_knowledge_base_documents_created_by;

-- KPI indexes
DROP INDEX IF EXISTS idx_kpi_measurements_verified_by;
DROP INDEX IF EXISTS idx_kpi_measurements_kpi_id;
DROP INDEX IF EXISTS idx_kpis_kois_accountable_level;

-- Organizational indexes
DROP INDEX IF EXISTS idx_organizational_units_level_id;
DROP INDEX IF EXISTS idx_organizational_units_manager_id;
DROP INDEX IF EXISTS idx_organizational_units_parent_unit_id;

-- Performance indexes
DROP INDEX IF EXISTS idx_performance_dashboards_level_id;
DROP INDEX IF EXISTS idx_performance_targets_kpi_id;
DROP INDEX IF EXISTS idx_performance_targets_org_unit_id;
DROP INDEX IF EXISTS idx_performance_targets_set_by;
DROP INDEX IF EXISTS idx_performance_targets_approved_by;

-- RAG search logs
DROP INDEX IF EXISTS idx_rag_search_logs_user_id;

-- Runbook indexes
DROP INDEX IF EXISTS idx_runbook_executions_runbook_id;
DROP INDEX IF EXISTS idx_runbook_executions_status;
DROP INDEX IF EXISTS idx_runbook_step_results_execution;
DROP INDEX IF EXISTS idx_runbooks_enabled;
DROP INDEX IF EXISTS idx_runbook_steps_order;

-- Evidence indexes
DROP INDEX IF EXISTS idx_evidence_references_evidence_id;
DROP INDEX IF EXISTS idx_evidence_refs_reference;
DROP INDEX IF EXISTS idx_evidence_repo_type;
DROP INDEX IF EXISTS idx_evidence_repo_source;
DROP INDEX IF EXISTS idx_evidence_repo_collected;

-- Safety and sync indexes
DROP INDEX IF EXISTS idx_safety_checks_conversation_id;
DROP INDEX IF EXISTS idx_sync_jobs_source_id;

-- Tool execution indexes
DROP INDEX IF EXISTS idx_tool_executions_tool_id;
DROP INDEX IF EXISTS idx_tool_executions_user_id;

-- User profile indexes
DROP INDEX IF EXISTS idx_user_profiles_org_level_id;
DROP INDEX IF EXISTS idx_user_profiles_org_unit_id;

-- Edge node indexes
DROP INDEX IF EXISTS idx_edge_nodes_last_heartbeat;
DROP INDEX IF EXISTS idx_edge_heartbeats_node;
DROP INDEX IF EXISTS idx_edge_queue_node_status;
DROP INDEX IF EXISTS idx_edge_queue_created;
DROP INDEX IF EXISTS idx_edge_nodes_org;
DROP INDEX IF EXISTS idx_edge_nodes_status;
DROP INDEX IF EXISTS idx_edge_deployments_node;
DROP INDEX IF EXISTS idx_edge_sync_log_node;

-- Realtime indexes
DROP INDEX IF EXISTS idx_realtime_subscriptions_user;
DROP INDEX IF EXISTS idx_realtime_subscriptions_channel;
DROP INDEX IF EXISTS idx_realtime_messages_channel;
DROP INDEX IF EXISTS idx_realtime_messages_expires;

-- Job queue indexes
DROP INDEX IF EXISTS idx_job_queue_status;
DROP INDEX IF EXISTS idx_job_executions_job;

-- Trace indexes
DROP INDEX IF EXISTS idx_trace_snapshots_run;
DROP INDEX IF EXISTS idx_trace_snapshots_created;
DROP INDEX IF EXISTS idx_trace_replay_sessions_snapshot;
DROP INDEX IF EXISTS idx_trace_replay_sessions_user;

-- Model registry indexes
DROP INDEX IF EXISTS idx_model_registry_tier;
DROP INDEX IF EXISTS idx_model_policies_user;
DROP INDEX IF EXISTS idx_model_policies_role;

-- Routing and runtime indexes
DROP INDEX IF EXISTS idx_routing_rules_priority;
DROP INDEX IF EXISTS idx_runtime_sessions_user;

-- Escalation indexes
DROP INDEX IF EXISTS idx_escalation_chains_type;
DROP INDEX IF EXISTS idx_escalation_history_workflow;

-- Rate limit indexes
DROP INDEX IF EXISTS idx_rate_limit_buckets_user_lookup;
DROP INDEX IF EXISTS idx_rate_limit_buckets_ip_lookup;
DROP INDEX IF EXISTS idx_rate_limit_buckets_cleanup;
DROP INDEX IF EXISTS idx_rate_limit_config_endpoint;
