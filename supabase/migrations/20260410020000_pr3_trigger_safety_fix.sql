/*
  # PR 3 — Trigger safety fix

  Addresses adjustment #2 from PR 2.5 review: the create_approval_workflow
  trigger had a NULL tenant_id clause that could match across tenants.

  Before: AND (NEW.tenant_id IS NULL OR ura.organization_id = NEW.tenant_id)
  After:  AND ura.organization_id = NEW.tenant_id

  When tenant_id is NULL, the equality (NULL = anything) returns false in
  Postgres, so no approver is found and no workflow row is created. The
  decision stays in 'pending' — safe fail, no cross-tenant leakage.
*/

CREATE OR REPLACE FUNCTION create_approval_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  approver_user_id uuid;
BEGIN
  IF NEW.requires_approval = true AND NEW.status = 'pending' THEN
    -- Find an approver via the real RBAC model, strictly scoped to the
    -- decision's tenant. If tenant_id is NULL, the equality fails safely
    -- (no cross-tenant leakage) and no approval_workflow is created.
    SELECT ura.user_id INTO approver_user_id
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE r.code IN (
      'maintenance_manager',
      'plant_manager',
      'operations_manager',
      'reliability_engineer'
    )
    AND ura.organization_id = NEW.tenant_id
    ORDER BY random()
    LIMIT 1;

    IF approver_user_id IS NOT NULL THEN
      INSERT INTO approval_workflows (
        decision_id,
        approver_id,
        approval_level,
        tenant_id,
        correlation_id
      )
      VALUES (
        NEW.id,
        approver_user_id,
        1,
        NEW.tenant_id,
        NEW.correlation_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
