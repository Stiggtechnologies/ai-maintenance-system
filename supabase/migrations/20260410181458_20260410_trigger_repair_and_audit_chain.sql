BEGIN;

-- =========================================================================
-- 6. Repair trigger function
-- =========================================================================

CREATE OR REPLACE FUNCTION create_approval_workflow()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE approver_user_id uuid;
BEGIN
  IF NEW.requires_approval = true AND NEW.status = 'pending' THEN
    SELECT ura.user_id INTO approver_user_id
    FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
    WHERE r.code IN ('maintenance_manager','plant_manager','operations_manager','reliability_engineer')
    AND ura.organization_id = NEW.tenant_id
    ORDER BY random() LIMIT 1;
    IF approver_user_id IS NOT NULL THEN
      INSERT INTO approval_workflows (decision_id, approver_id, approval_level, tenant_id, correlation_id)
      VALUES (NEW.id, approver_user_id, 1, NEW.tenant_id, NEW.correlation_id);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- =========================================================================
-- 7. Add 'failed' status + audit chain helper
-- =========================================================================

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name FROM pg_constraint con
  JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
  WHERE con.conrelid = 'autonomous_decisions'::regclass AND att.attname = 'status' AND con.contype = 'c';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE autonomous_decisions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE autonomous_decisions
  ADD CONSTRAINT autonomous_decisions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto_executed', 'expired', 'failed'));

CREATE OR REPLACE FUNCTION get_full_audit_chain(p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'correlation_id', p_correlation_id,
    'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', ad.id, 'tenant_id', ad.tenant_id, 'decision_type', ad.decision_type,
      'status', ad.status, 'confidence_score', ad.confidence_score,
      'requires_approval', ad.requires_approval, 'autonomy_level', ad.autonomy_level,
      'asset_id', ad.asset_id, 'work_order_id', ad.work_order_id,
      'approved_by', ad.approved_by, 'executed_at', ad.executed_at,
      'duration_ms', ad.duration_ms, 'created_at', ad.created_at
    ) ORDER BY ad.created_at) FROM autonomous_decisions ad WHERE ad.correlation_id = p_correlation_id), '[]'::jsonb),
    'approvals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', aw.id, 'decision_id', aw.decision_id, 'approver_id', aw.approver_id,
      'approval_level', aw.approval_level, 'status', aw.status,
      'comments', aw.comments, 'responded_at', aw.responded_at, 'created_at', aw.created_at
    ) ORDER BY aw.created_at) FROM approval_workflows aw WHERE aw.correlation_id = p_correlation_id), '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', aa.id, 'action_type', aa.action_type, 'target_id', aa.target_id,
      'triggered_by', aa.triggered_by, 'success', aa.success,
      'error_message', aa.error_message, 'executed_at', aa.executed_at
    ) ORDER BY aa.executed_at) FROM autonomous_actions aa WHERE aa.correlation_id = p_correlation_id), '[]'::jsonb),
    'intelligence_runs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', sor.id, 'tenant_id', sor.tenant_id, 'status', sor.status,
      'workflow_definition_code', sor.workflow_definition_code,
      'autonomy_level', sor.autonomy_level, 'confidence', sor.confidence,
      'requires_human_review', sor.requires_human_review,
      'output_schema_version', sor.output_schema_version, 'prompt_version', sor.prompt_version,
      'duration_ms', sor.duration_ms, 'started_at', sor.started_at, 'finished_at', sor.finished_at
    ) ORDER BY sor.started_at) FROM sir_orchestration_runs sor WHERE sor.correlation_id = p_correlation_id), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', ss.id, 'tenant_id', ss.tenant_id, 'status', ss.status, 'started_at', ss.started_at,
      'message_count', (SELECT count(*) FROM sir_messages sm WHERE sm.session_id = ss.id)
    ) ORDER BY ss.started_at) FROM sir_sessions ss WHERE ss.context->>'correlation_id' = p_correlation_id::text), '[]'::jsonb),
    'total_cost_usd', COALESCE((SELECT sum(sc.cost_usd) FROM sir_costs sc
      JOIN sir_sessions ss ON ss.id = sc.session_id WHERE ss.context->>'correlation_id' = p_correlation_id::text), 0)
  ) INTO result;
  RETURN result;
END; $$;

COMMIT;