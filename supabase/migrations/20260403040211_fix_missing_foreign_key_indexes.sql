/*
  # Fix Missing Foreign Key Indexes

  This migration addresses performance issues by adding indexes to foreign key columns
  that currently lack covering indexes. These indexes significantly improve JOIN performance
  and referential integrity checks.

  ## Changes

  1. **Agent & Feedback Tables**
     - Add index on `agent_feedback.conversation_id`

  2. **Approval & Escalation Tables**
     - Add index on `approval_escalation_history.escalated_by`
     - Add index on `approval_escalation_history.escalation_chain_id`

  3. **Billing Tables**
     - Add index on `billing_invoices.subscription_id`
     - Add index on `subscription_limits.subscription_id`
     - Add index on `usage_events.subscription_id`

  4. **Edge Node Tables**
     - Add index on `edge_deployments.deployed_by`
     - Add index on `edge_deployments.org_unit_id`
     - Add index on `edge_nodes.registered_by`

  5. **Evidence & Knowledge Tables**
     - Add index on `evidence_repository.collected_by`
     - Add index on `knowledge_base_chunks.document_id`

  6. **Job & KPI Tables**
     - Add index on `job_queue.created_by`
     - Add index on `kpi_measurements.org_unit_id`
     - Add index on `kpis_kois.category_id`
     - Add index on `kpis_kois.responsible_level`

  7. **Realtime & Runbook Tables**
     - Add index on `realtime_messages.sender_id`
     - Add index on `runbook_step_results.step_id`

  8. **Trace Tables**
     - Add index on `trace_snapshots.created_by`

  ## Performance Impact

  These indexes will improve:
  - JOIN query performance
  - Foreign key constraint checking
  - Referential integrity operations
  - Overall database query performance
*/

-- Agent feedback indexes
CREATE INDEX IF NOT EXISTS idx_agent_feedback_conversation_id 
ON agent_feedback(conversation_id);

-- Approval escalation indexes
CREATE INDEX IF NOT EXISTS idx_approval_escalation_history_escalated_by 
ON approval_escalation_history(escalated_by);

CREATE INDEX IF NOT EXISTS idx_approval_escalation_history_escalation_chain_id 
ON approval_escalation_history(escalation_chain_id);

-- Billing indexes
CREATE INDEX IF NOT EXISTS idx_billing_invoices_subscription_id 
ON billing_invoices(subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_limits_subscription_id_fkey 
ON subscription_limits(subscription_id);

CREATE INDEX IF NOT EXISTS idx_usage_events_subscription_id_fkey 
ON usage_events(subscription_id);

-- Edge node indexes
CREATE INDEX IF NOT EXISTS idx_edge_deployments_deployed_by 
ON edge_deployments(deployed_by);

CREATE INDEX IF NOT EXISTS idx_edge_deployments_org_unit_id_fkey 
ON edge_deployments(org_unit_id);

CREATE INDEX IF NOT EXISTS idx_edge_nodes_registered_by 
ON edge_nodes(registered_by);

-- Evidence indexes
CREATE INDEX IF NOT EXISTS idx_evidence_repository_collected_by 
ON evidence_repository(collected_by);

-- Knowledge base indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_base_chunks_document_id_fkey 
ON knowledge_base_chunks(document_id);

-- Job queue indexes
CREATE INDEX IF NOT EXISTS idx_job_queue_created_by 
ON job_queue(created_by);

-- KPI indexes
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_org_unit_id_fkey 
ON kpi_measurements(org_unit_id);

CREATE INDEX IF NOT EXISTS idx_kpis_kois_category_id_fkey 
ON kpis_kois(category_id);

CREATE INDEX IF NOT EXISTS idx_kpis_kois_responsible_level_fkey 
ON kpis_kois(responsible_level);

-- Realtime indexes
CREATE INDEX IF NOT EXISTS idx_realtime_messages_sender_id 
ON realtime_messages(sender_id);

-- Runbook indexes
CREATE INDEX IF NOT EXISTS idx_runbook_step_results_step_id_fkey 
ON runbook_step_results(step_id);

-- Trace indexes
CREATE INDEX IF NOT EXISTS idx_trace_snapshots_created_by 
ON trace_snapshots(created_by);
