BEGIN;

-- Rename all openclaw tables to sir_ prefix (safely)
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

-- Rename function if it exists
DO $$ BEGIN
  ALTER FUNCTION search_openclaw_memory RENAME TO search_sir_memory;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

COMMIT;