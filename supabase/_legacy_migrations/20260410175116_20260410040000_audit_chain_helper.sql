/*
  # Audit chain helper + duration tracking

  1. get_full_audit_chain(correlation_id)
     Returns a single JSON object reconstructing the full cross-plane
     audit trail for one governed workflow invocation. Joins:
       - Autonomous: autonomous_decisions, approval_workflows, autonomous_actions
       - OpenClaw:    sir_orchestration_runs
       - SIR:         sir_sessions, sir_messages, sir_costs
     All linked by correlation_id (soft cross-plane link, no FKs).

  2. Duration columns
     Adds duration_ms to sir_orchestration_runs and autonomous_decisions
     so failures can be correlated with slow model/tool calls.
*/

-- =========================================================================
-- 1. Duration tracking
-- =========================================================================

ALTER TABLE sir_orchestration_runs
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN sir_orchestration_runs.duration_ms IS
  'Wall-clock duration of the intelligence task in milliseconds. '
  'Set by ai-agent-processor on completion or failure.';

COMMENT ON COLUMN autonomous_decisions.duration_ms IS
  'Wall-clock duration from workflow initiation to decision creation, '
  'including intelligence task time. Set by autonomous-orchestrator.';

-- =========================================================================
-- 2. get_full_audit_chain(correlation_id)
-- =========================================================================

CREATE OR REPLACE FUNCTION get_full_audit_chain(p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'correlation_id', p_correlation_id,

    -- Autonomous (Control/Governance Plane) — canonical audit truth
    'decisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ad.id,
        'tenant_id', ad.tenant_id,
        'decision_type', ad.decision_type,
        'status', ad.status,
        'confidence_score', ad.confidence_score,
        'requires_approval', ad.requires_approval,
        'autonomy_level', ad.autonomy_level,
        'asset_id', ad.asset_id,
        'work_order_id', ad.work_order_id,
        'approved_by', ad.approved_by,
        'executed_at', ad.executed_at,
        'duration_ms', ad.duration_ms,
        'created_at', ad.created_at
      ) ORDER BY ad.created_at)
      FROM autonomous_decisions ad
      WHERE ad.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    'approvals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', aw.id,
        'decision_id', aw.decision_id,
        'approver_id', aw.approver_id,
        'approval_level', aw.approval_level,
        'status', aw.status,
        'comments', aw.comments,
        'responded_at', aw.responded_at,
        'created_at', aw.created_at
      ) ORDER BY aw.created_at)
      FROM approval_workflows aw
      WHERE aw.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', aa.id,
        'action_type', aa.action_type,
        'target_id', aa.target_id,
        'triggered_by', aa.triggered_by,
        'success', aa.success,
        'error_message', aa.error_message,
        'executed_at', aa.executed_at
      ) ORDER BY aa.executed_at)
      FROM autonomous_actions aa
      WHERE aa.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    -- OpenClaw (Intelligence Plane) — runtime traces (observational)
    'intelligence_runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sor.id,
        'tenant_id', sor.tenant_id,
        'status', sor.status,
        'workflow_definition_code', sor.workflow_definition_code,
        'autonomy_level', sor.autonomy_level,
        'confidence', sor.confidence,
        'requires_human_review', sor.requires_human_review,
        'output_schema_version', sor.output_schema_version,
        'prompt_version', sor.prompt_version,
        'duration_ms', sor.duration_ms,
        'started_at', sor.started_at,
        'finished_at', sor.finished_at
      ) ORDER BY sor.started_at)
      FROM sir_orchestration_runs sor
      WHERE sor.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    -- SIR (Interaction/Logging) — session metadata (observational)
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ss.id,
        'tenant_id', ss.tenant_id,
        'status', ss.status,
        'started_at', ss.started_at,
        'message_count', (
          SELECT count(*) FROM sir_messages sm WHERE sm.session_id = ss.id
        )
      ) ORDER BY ss.started_at)
      FROM sir_sessions ss
      WHERE ss.context->>'correlation_id' = p_correlation_id::text
    ), '[]'::jsonb),

    -- Cost summary (observational)
    'total_cost_usd', COALESCE((
      SELECT sum(sc.cost_usd)
      FROM sir_costs sc
      JOIN sir_sessions ss ON ss.id = sc.session_id
      WHERE ss.context->>'correlation_id' = p_correlation_id::text
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_full_audit_chain(uuid) IS
  'Reconstructs the full cross-plane audit trail for a governed workflow. '
  'Returns one JSON object joining Autonomous decisions/approvals/actions '
  '(canonical audit truth), OpenClaw intelligence runs (observational), '
  'and SIR sessions/costs (observational). All linked by correlation_id.';