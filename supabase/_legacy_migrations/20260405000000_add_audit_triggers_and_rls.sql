-- Migration: Add audit triggers and RLS policies for billing, JAVIS, and OpenClaw tables
-- Created: 2026-04-05
-- Description: Creates audit event trigger function, attaches it to key tables,
--              and enables RLS with tenant-scoped policies on billing/JAVIS/OpenClaw tables.

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

-- Work orders audit
DROP TRIGGER IF EXISTS audit_work_orders ON work_orders;
CREATE TRIGGER audit_work_orders
  AFTER INSERT OR UPDATE OR DELETE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Assets audit
DROP TRIGGER IF EXISTS audit_assets ON assets;
CREATE TRIGGER audit_assets
  AFTER INSERT OR UPDATE OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Approvals audit
DROP TRIGGER IF EXISTS audit_approvals ON approvals;
CREATE TRIGGER audit_approvals
  AFTER INSERT OR UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Autonomous decisions audit
DROP TRIGGER IF EXISTS audit_autonomous_decisions ON autonomous_decisions;
CREATE TRIGGER audit_autonomous_decisions
  AFTER INSERT OR UPDATE OR DELETE ON autonomous_decisions
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- System alerts audit
DROP TRIGGER IF EXISTS audit_system_alerts ON system_alerts;
CREATE TRIGGER audit_system_alerts
  AFTER INSERT OR UPDATE OR DELETE ON system_alerts
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- Recommendations audit
DROP TRIGGER IF EXISTS audit_recommendations ON recommendations;
CREATE TRIGGER audit_recommendations
  AFTER INSERT OR UPDATE OR DELETE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

-- ============================================================================
-- C. Enable RLS and create tenant-scoped policies
-- ============================================================================

-- --------------------------------------------------------------------------
-- Billing tables
-- --------------------------------------------------------------------------

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

-- --------------------------------------------------------------------------
-- JAVIS tables
-- --------------------------------------------------------------------------

ALTER TABLE IF EXISTS javis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS javis_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "javis_conversations_user" ON javis_conversations
    FOR ALL USING (user_id = auth.uid() OR tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "javis_messages_user" ON javis_messages
    FOR ALL USING (session_id IN (SELECT id FROM javis_conversations WHERE user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --------------------------------------------------------------------------
-- OpenClaw tables
-- --------------------------------------------------------------------------

ALTER TABLE IF EXISTS openclaw_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS openclaw_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS openclaw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS openclaw_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS openclaw_costs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "openclaw_agents_tenant" ON openclaw_agents
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_sessions_tenant" ON openclaw_sessions
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_messages_session" ON openclaw_messages
    FOR ALL USING (session_id IN (SELECT id FROM openclaw_sessions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_memory_tenant" ON openclaw_memory
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_costs_tenant" ON openclaw_costs
    FOR ALL USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
