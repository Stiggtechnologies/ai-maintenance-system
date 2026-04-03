/*
  # Fix Function Search Paths - Correct Signatures

  This migration fixes PostgreSQL functions that have role-mutable search paths
  by altering them to use a fixed search_path.

  ## Security Impact

  Setting a fixed search_path prevents potential SQL injection attacks.

  ## Changes

  All 31 affected functions are altered to include:
  SET search_path = public, pg_temp
*/

-- Alter all functions with their correct signatures
ALTER FUNCTION auto_approve_decisions() SET search_path = public, pg_temp;

ALTER FUNCTION broadcast_to_channel(text, text, jsonb, uuid, text) SET search_path = public, pg_temp;

ALTER FUNCTION calculate_kpi_status(numeric, numeric, numeric, numeric, text) SET search_path = public, pg_temp;

ALTER FUNCTION check_rate_limit(uuid, text, text, uuid) SET search_path = public, pg_temp;

ALTER FUNCTION cleanup_rate_limit_buckets() SET search_path = public, pg_temp;

ALTER FUNCTION complete_job(uuid, text, jsonb, text) SET search_path = public, pg_temp;

ALTER FUNCTION create_approval_workflow() SET search_path = public, pg_temp;

ALTER FUNCTION create_trace_snapshot(uuid, uuid) SET search_path = public, pg_temp;

ALTER FUNCTION detect_stale_edge_nodes() SET search_path = public, pg_temp;

ALTER FUNCTION enqueue_job(text, jsonb, integer, timestamp with time zone, uuid) SET search_path = public, pg_temp;

ALTER FUNCTION escalate_approval(uuid, text) SET search_path = public, pg_temp;

ALTER FUNCTION get_fine_tuning_pairs(integer, integer) SET search_path = public, pg_temp;

ALTER FUNCTION get_kpis_for_level(text) SET search_path = public, pg_temp;

ALTER FUNCTION get_next_job() SET search_path = public, pg_temp;

ALTER FUNCTION get_pending_messages_for_user(uuid, integer) SET search_path = public, pg_temp;

ALTER FUNCTION get_table_stats() SET search_path = public, pg_temp;

ALTER FUNCTION get_user_accessible_kpis(uuid) SET search_path = public, pg_temp;

ALTER FUNCTION handle_updated_at() SET search_path = public, pg_temp;

ALTER FUNCTION hybrid_search(text, vector, uuid, integer) SET search_path = public, pg_temp;

ALTER FUNCTION increment_rate_limit(uuid, text, text, uuid, numeric) SET search_path = public, pg_temp;

ALTER FUNCTION link_evidence_to_decision(uuid, uuid, text) SET search_path = public, pg_temp;

ALTER FUNCTION mark_stale_nodes_offline() SET search_path = public, pg_temp;

ALTER FUNCTION search_knowledge_base(vector, text, double precision, integer, uuid) SET search_path = public, pg_temp;

ALTER FUNCTION select_model_for_task(uuid, text, text, numeric) SET search_path = public, pg_temp;

ALTER FUNCTION subscribe_to_channel(uuid, text, text) SET search_path = public, pg_temp;

ALTER FUNCTION trigger_alarm_escalation() SET search_path = public, pg_temp;

ALTER FUNCTION trigger_document_processing() SET search_path = public, pg_temp;

ALTER FUNCTION trigger_runbook_on_asset_failure() SET search_path = public, pg_temp;

ALTER FUNCTION update_chunk_retrieval_stats(uuid, double precision) SET search_path = public, pg_temp;

ALTER FUNCTION update_edge_node_status() SET search_path = public, pg_temp;

ALTER FUNCTION update_updated_at_column() SET search_path = public, pg_temp;
