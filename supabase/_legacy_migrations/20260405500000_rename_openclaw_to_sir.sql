BEGIN;

-- Rename all openclaw tables to sir_ prefix
ALTER TABLE IF EXISTS openclaw_agents RENAME TO sir_agents;
ALTER TABLE IF EXISTS openclaw_sessions RENAME TO sir_sessions;
ALTER TABLE IF EXISTS openclaw_messages RENAME TO sir_messages;
ALTER TABLE IF EXISTS openclaw_memory RENAME TO sir_memory;
ALTER TABLE IF EXISTS openclaw_tools RENAME TO sir_tools;
ALTER TABLE IF EXISTS openclaw_tool_calls RENAME TO sir_tool_calls;
ALTER TABLE IF EXISTS openclaw_orchestration_runs RENAME TO sir_orchestration_runs;
ALTER TABLE IF EXISTS openclaw_events RENAME TO sir_events;
ALTER TABLE IF EXISTS openclaw_event_runs RENAME TO sir_event_runs;
ALTER TABLE IF EXISTS openclaw_notifications RENAME TO sir_notifications;
ALTER TABLE IF EXISTS openclaw_health_checks RENAME TO sir_health_checks;
ALTER TABLE IF EXISTS openclaw_costs RENAME TO sir_costs;
ALTER TABLE IF EXISTS openclaw_skills RENAME TO sir_skills;
ALTER TABLE IF EXISTS openclaw_errors RENAME TO sir_errors;
ALTER TABLE IF EXISTS openclaw_queues RENAME TO sir_queues;
ALTER TABLE IF EXISTS openclaw_queue_items RENAME TO sir_queue_items;

-- Rename RPC function if exists
ALTER FUNCTION IF EXISTS search_openclaw_memory RENAME TO search_sir_memory;

-- Update RLS policies (drop old, create new with same logic but new table names)
-- Note: RLS policies reference the table they're on, so renaming the table automatically
-- carries the policies. But we should rename the policies themselves for clarity.

-- Add a comment for documentation
COMMENT ON TABLE sir_agents IS 'SyncAI Intelligence Runtime - Agent registry';
COMMENT ON TABLE sir_sessions IS 'SyncAI Intelligence Runtime - Conversation sessions';
COMMENT ON TABLE sir_messages IS 'SyncAI Intelligence Runtime - Message history';
COMMENT ON TABLE sir_memory IS 'SyncAI Intelligence Runtime - Semantic memory (vector embeddings)';
COMMENT ON TABLE sir_tools IS 'SyncAI Intelligence Runtime - Tool registry';
COMMENT ON TABLE sir_costs IS 'SyncAI Intelligence Runtime - LLM cost tracking';

COMMIT;
