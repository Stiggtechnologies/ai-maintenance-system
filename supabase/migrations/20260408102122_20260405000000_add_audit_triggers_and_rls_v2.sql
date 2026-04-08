-- Migration: Add audit triggers and RLS policies for billing tables
-- Created: 2026-04-05
-- Description: Creates audit event trigger function and enables RLS for billing tables

BEGIN;

-- ============================================================================
-- A. Create audit trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS TRIGGER
SET search_path = public
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.audit_events (
    organization_id,
    entity_type,
    entity_id,
    event_type,
    actor_type,
    actor_id,
    event_time,
    details
  ) VALUES (
    COALESCE(NEW.organization_id, OLD.organization_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    'user',
    auth.uid(),
    NOW(),
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'new', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
      'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================================
-- B. Attach audit triggers to key tables
-- ============================================================================

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_work_orders ON work_orders;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_work_orders
    AFTER INSERT OR UPDATE OR DELETE ON work_orders
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_assets ON assets;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_assets
    AFTER INSERT OR UPDATE OR DELETE ON assets
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_approvals ON approvals;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_approvals
    AFTER INSERT OR UPDATE OR DELETE ON approvals
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_autonomous_decisions ON autonomous_decisions;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_autonomous_decisions
    AFTER INSERT OR UPDATE OR DELETE ON autonomous_decisions
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_system_alerts ON system_alerts;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_system_alerts
    AFTER INSERT OR UPDATE OR DELETE ON system_alerts
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS audit_recommendations ON recommendations;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_recommendations
    AFTER INSERT OR UPDATE OR DELETE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION log_audit_event();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================================================
-- C. Enable RLS on billing tables
-- ============================================================================

ALTER TABLE IF EXISTS billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscription_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "billing_subscriptions_tenant" ON billing_subscriptions
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "billing_invoices_tenant" ON billing_invoices
    FOR ALL USING (subscription_id IN (SELECT id FROM billing_subscriptions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "usage_events_tenant" ON usage_events
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;