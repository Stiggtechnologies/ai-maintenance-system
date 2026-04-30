/*
  # Azure Marketplace SaaS Integration Migration

  This migration adds comprehensive support for Microsoft Azure Marketplace SaaS application integration.
  It includes:

  1. Marketplace subscription tracking columns in billing_subscriptions
  2. Marketplace event audit table for tracking all API calls and status changes
  3. Marketplace metering records for usage-based billing submissions
  4. Azure AD tenant mappings for customer multi-tenant scenarios
  5. Helper functions for marketplace operations
  6. Indexes optimized for marketplace queries
  7. RLS policies for secure multi-tenant access

  Compatibility: Works with existing billing, usage, and organization schemas.
*/

BEGIN;

-- ============================================
-- 1. EXTEND BILLING_SUBSCRIPTIONS TABLE
-- ============================================
-- Add marketplace-specific columns for tracking Azure Marketplace subscriptions

ALTER TABLE billing_subscriptions
ADD COLUMN IF NOT EXISTS marketplace_subscription_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS marketplace_plan_id TEXT,
ADD COLUMN IF NOT EXISTS marketplace_publisher_id TEXT,
ADD COLUMN IF NOT EXISTS marketplace_offer_id TEXT,
ADD COLUMN IF NOT EXISTS billing_source TEXT NOT NULL DEFAULT 'direct'
  CHECK (billing_source IN ('direct', 'azure_marketplace')),
ADD COLUMN IF NOT EXISTS marketplace_status TEXT
  CHECK (marketplace_status IN ('PendingFulfillmentStart', 'Subscribed', 'Suspended', 'Unsubscribed', NULL)),
ADD COLUMN IF NOT EXISTS marketplace_activated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS marketplace_quantity INTEGER;

-- Create indexes for marketplace lookups
CREATE INDEX IF NOT EXISTS idx_billing_subs_marketplace_id
  ON billing_subscriptions(marketplace_subscription_id);

CREATE INDEX IF NOT EXISTS idx_billing_subs_marketplace_status
  ON billing_subscriptions(marketplace_status)
  WHERE marketplace_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_subs_billing_source
  ON billing_subscriptions(billing_source);

-- ============================================
-- 2. CREATE MARKETPLACE_EVENTS AUDIT TABLE
-- ============================================
-- Tracks all interactions with Azure Marketplace API endpoints
-- Purpose: Audit trail, error recovery, request/response logging

CREATE TABLE IF NOT EXISTS marketplace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_subscription_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN (
      'resolve',            -- Resolve subscription (activation)
      'activate',           -- Activate subscription
      'change_plan',        -- Plan change request
      'change_quantity',    -- Quantity change
      'suspend',            -- Suspend subscription
      'reinstate',          -- Reinstate suspended subscription
      'unsubscribe',        -- Process unsubscribe
      'renew'               -- Renewal notification
    )),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'success', 'failure')),
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT fk_marketplace_events_billing
    FOREIGN KEY (marketplace_subscription_id)
    REFERENCES billing_subscriptions(marketplace_subscription_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_sub_id
  ON marketplace_events(marketplace_subscription_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_action
  ON marketplace_events(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_status
  ON marketplace_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_created
  ON marketplace_events(created_at DESC);

-- Enable RLS on marketplace_events
ALTER TABLE marketplace_events ENABLE ROW LEVEL SECURITY;

-- Policy: Service role and system functions can access all events
CREATE POLICY "Service role access to marketplace events"
  ON marketplace_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view events for their organization's subscriptions
CREATE POLICY "Users can view own org marketplace events"
  ON marketplace_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON bs.tenant_id = up.organization_id
      WHERE up.id = auth.uid()
      AND bs.marketplace_subscription_id = marketplace_events.marketplace_subscription_id
    )
  );

-- ============================================
-- 3. CREATE MARKETPLACE_METERING_RECORDS TABLE
-- ============================================
-- Tracks usage-based billing submissions to Azure Marketplace Metering API
-- Purpose: Record every dimension submission with status and Azure response

CREATE TABLE IF NOT EXISTS marketplace_metering_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_subscription_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  effective_start_time TIMESTAMPTZ NOT NULL,
  plan_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'accepted', 'rejected', 'duplicate')),
  usage_event_id UUID,
  error_message TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT fk_metering_records_billing
    FOREIGN KEY (marketplace_subscription_id)
    REFERENCES billing_subscriptions(marketplace_subscription_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_metering_usage_event
    FOREIGN KEY (usage_event_id)
    REFERENCES usage_events(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_metering_sub_status_created
  ON marketplace_metering_records(marketplace_subscription_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metering_dimension_time
  ON marketplace_metering_records(dimension, effective_start_time DESC);

CREATE INDEX IF NOT EXISTS idx_metering_status
  ON marketplace_metering_records(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metering_usage_event
  ON marketplace_metering_records(usage_event_id);

-- Enable RLS on marketplace_metering_records
ALTER TABLE marketplace_metering_records ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can access all metering records
CREATE POLICY "Service role access to metering records"
  ON marketplace_metering_records FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Users can view metering records for their organization
CREATE POLICY "Users can view own org metering records"
  ON marketplace_metering_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON bs.tenant_id = up.organization_id
      WHERE up.id = auth.uid()
      AND bs.marketplace_subscription_id = marketplace_metering_records.marketplace_subscription_id
    )
  );

-- ============================================
-- 4. CREATE AZURE_AD_TENANTS TABLE
-- ============================================
-- Maps Azure AD tenants (customer organizations) to our system organizations
-- Purpose: Multi-tenant Azure AD support, group-based provisioning

CREATE TABLE IF NOT EXISTS azure_ad_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  azure_tenant_id TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  azure_tenant_name TEXT,
  domain TEXT,
  provisioned_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',

  CONSTRAINT uk_azure_tenant_org UNIQUE(azure_tenant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_azure_tenants_organization
  ON azure_ad_tenants(organization_id);

CREATE INDEX IF NOT EXISTS idx_azure_tenants_azure_id
  ON azure_ad_tenants(azure_tenant_id);

CREATE INDEX IF NOT EXISTS idx_azure_tenants_active
  ON azure_ad_tenants(is_active)
  WHERE is_active = true;

-- Enable RLS on azure_ad_tenants
ALTER TABLE azure_ad_tenants ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view Azure AD mappings for their organization
CREATE POLICY "Users can view own org azure ad tenants"
  ON azure_ad_tenants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.organization_id = azure_ad_tenants.organization_id
    )
  );

-- Policy: Service role can manage Azure AD tenants
CREATE POLICY "Service role manages azure ad tenants"
  ON azure_ad_tenants FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 5. HELPER FUNCTION: get_marketplace_subscription
-- ============================================
-- Returns enriched subscription data for a marketplace subscription ID
-- Purpose: Simplify marketplace lookups with joined plan and org data

CREATE OR REPLACE FUNCTION get_marketplace_subscription(
  p_marketplace_sub_id TEXT
)
RETURNS TABLE (
  subscription_id UUID,
  marketplace_subscription_id TEXT,
  tenant_id UUID,
  organization_name TEXT,
  plan_code TEXT,
  plan_name TEXT,
  base_price_cad NUMERIC,
  status TEXT,
  marketplace_status TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
SELECT
  bs.id,
  bs.marketplace_subscription_id,
  bs.tenant_id,
  o.name,
  bp.code,
  bp.name,
  bp.base_price_cad,
  bs.status,
  bs.marketplace_status,
  bs.current_period_start,
  bs.current_period_end,
  bs.marketplace_activated_at,
  bs.created_at
FROM billing_subscriptions bs
LEFT JOIN organizations o ON bs.tenant_id = o.id
LEFT JOIN billing_plans bp ON bs.plan_id = bp.id
WHERE bs.marketplace_subscription_id = p_marketplace_sub_id;
$$ LANGUAGE SQL STABLE;

-- ============================================
-- 6. HELPER FUNCTION: provision_marketplace_tenant
-- ============================================
-- Creates a complete tenant setup for a new marketplace customer
-- Purpose: Idempotent provisioning of org, user, subscription, and limits
-- Returns: organization_id of the newly created tenant

CREATE OR REPLACE FUNCTION provision_marketplace_tenant(
  p_azure_tenant_id TEXT,
  p_tenant_name TEXT,
  p_admin_email TEXT,
  p_admin_name TEXT,
  p_plan_code TEXT,
  p_marketplace_sub_id TEXT,
  p_marketplace_plan_id TEXT DEFAULT NULL,
  p_marketplace_publisher_id TEXT DEFAULT NULL,
  p_marketplace_offer_id TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT 1
)
RETURNS TABLE (
  organization_id UUID,
  user_id UUID,
  subscription_id UUID,
  status TEXT,
  error_message TEXT
) AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_sub_id UUID;
  v_plan_id UUID;
  v_error TEXT := NULL;
  v_status TEXT := 'success';
BEGIN
  -- 1. Create organization (or get existing)
  BEGIN
    INSERT INTO organizations (name, slug, status, created_at, updated_at)
    VALUES (
      p_tenant_name,
      LOWER(REGEXP_REPLACE(p_tenant_name || '-' || SUBSTRING(p_azure_tenant_id, 1, 8), '[^a-z0-9-]', '-', 'g')),
      'active',
      now(),
      now()
    )
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to create organization: ' || SQLERRM;
    v_status := 'error';
    RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
    RETURN;
  END;

  -- 2. Get or create auth user and link user_profile
  -- NOTE: This assumes the auth user already exists. In production, you may need
  -- to create the auth user via an external service (Supabase Admin API)
  BEGIN
    SELECT id INTO v_user_id
    FROM user_profiles
    WHERE email = p_admin_email AND organization_id = v_org_id;

    IF v_user_id IS NULL THEN
      -- Try to find user by email in user_profiles across any org (link to existing auth user)
      SELECT id INTO v_user_id
      FROM user_profiles
      WHERE email = p_admin_email
      LIMIT 1;

      IF v_user_id IS NOT NULL THEN
        -- User exists in other org, create a profile for this org
        INSERT INTO user_profiles (id, organization_id, full_name, email, status, created_at, updated_at)
        VALUES (v_user_id, v_org_id, p_admin_name, p_admin_email, 'active', now(), now())
        ON CONFLICT (id) DO NOTHING;
      ELSE
        -- Create new user profile (auth.users must exist via Supabase Auth)
        -- Generate a temporary UUID as placeholder
        v_user_id := gen_random_uuid();
        INSERT INTO user_profiles (id, organization_id, full_name, email, status, created_at, updated_at)
        VALUES (v_user_id, v_org_id, p_admin_name, p_admin_email, 'active', now(), now());
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to create user profile: ' || SQLERRM;
    v_status := 'error';
    RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
    RETURN;
  END;

  -- 3. Map Azure AD tenant
  BEGIN
    INSERT INTO azure_ad_tenants (
      azure_tenant_id,
      organization_id,
      azure_tenant_name,
      is_active,
      provisioned_at,
      metadata
    )
    VALUES (
      p_azure_tenant_id,
      v_org_id,
      p_tenant_name,
      true,
      now(),
      '{"provisioned_via": "marketplace_sdk"}'
    )
    ON CONFLICT (azure_tenant_id) DO UPDATE
    SET is_active = true, organization_id = v_org_id
    WHERE azure_ad_tenants.organization_id = v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to create Azure AD mapping: ' || SQLERRM;
    v_status := 'warning';
    -- Don't fail provisioning for this
  END;

  -- 4. Get billing plan
  BEGIN
    SELECT id INTO v_plan_id
    FROM billing_plans
    WHERE code = p_plan_code AND is_active = true;

    IF v_plan_id IS NULL THEN
      v_error := 'Plan not found: ' || p_plan_code;
      v_status := 'error';
      RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
      RETURN;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to lookup plan: ' || SQLERRM;
    v_status := 'error';
    RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
    RETURN;
  END;

  -- 5. Create billing subscription
  BEGIN
    INSERT INTO billing_subscriptions (
      tenant_id,
      plan_id,
      status,
      billing_source,
      marketplace_subscription_id,
      marketplace_plan_id,
      marketplace_publisher_id,
      marketplace_offer_id,
      marketplace_status,
      marketplace_quantity,
      current_period_start,
      current_period_end,
      currency,
      created_at,
      updated_at
    )
    VALUES (
      v_org_id,
      v_plan_id,
      'active',
      'azure_marketplace',
      p_marketplace_sub_id,
      p_marketplace_plan_id,
      p_marketplace_publisher_id,
      p_marketplace_offer_id,
      'PendingFulfillmentStart',
      p_quantity,
      now(),
      now() + INTERVAL '1 month',
      'CAD',
      now(),
      now()
    )
    RETURNING id INTO v_sub_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to create subscription: ' || SQLERRM;
    v_status := 'error';
    RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
    RETURN;
  END;

  -- 6. Create subscription limits
  BEGIN
    INSERT INTO subscription_limits (
      subscription_id,
      included_assets,
      included_credits,
      remaining_credits,
      last_reset_at,
      created_at,
      updated_at
    )
    SELECT
      v_sub_id,
      bp.included_assets,
      bp.included_credits,
      bp.included_credits,
      now(),
      now(),
      now()
    FROM billing_plans bp
    WHERE bp.id = v_plan_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to create subscription limits: ' || SQLERRM;
    v_status := 'error';
    RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
    RETURN;
  END;

  -- 7. Record the resolve/activation event
  BEGIN
    INSERT INTO marketplace_events (
      marketplace_subscription_id,
      action,
      status,
      request_payload,
      response_payload,
      created_at
    )
    VALUES (
      p_marketplace_sub_id,
      'resolve',
      'success',
      JSONB_BUILD_OBJECT(
        'action', 'resolve',
        'marketplace_subscription_id', p_marketplace_sub_id,
        'plan_id', p_marketplace_plan_id
      ),
      JSONB_BUILD_OBJECT(
        'provisioned_subscription_id', v_sub_id,
        'provisioned_organization_id', v_org_id
      ),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Don't fail provisioning for event tracking
    NULL;
  END;

  RETURN QUERY SELECT v_org_id, v_user_id, v_sub_id, v_status, v_error;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. HELPER FUNCTION: record_marketplace_event
-- ============================================
-- Safely records marketplace API events with error handling
-- Purpose: Consistent audit trail for all marketplace interactions

CREATE OR REPLACE FUNCTION record_marketplace_event(
  p_marketplace_sub_id TEXT,
  p_action TEXT,
  p_status TEXT,
  p_request_payload JSONB DEFAULT NULL,
  p_response_payload JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO marketplace_events (
    marketplace_subscription_id,
    action,
    status,
    request_payload,
    response_payload,
    error_message,
    processed_at,
    created_at
  )
  VALUES (
    p_marketplace_sub_id,
    p_action,
    p_status,
    p_request_payload,
    p_response_payload,
    p_error_message,
    CASE WHEN p_status = 'success' THEN now() ELSE NULL END,
    now()
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. HELPER FUNCTION: submit_marketplace_metering
-- ============================================
-- Records usage submission to marketplace metering API
-- Purpose: Batch and track all metering submissions

CREATE OR REPLACE FUNCTION submit_marketplace_metering(
  p_marketplace_sub_id TEXT,
  p_dimension TEXT,
  p_quantity NUMERIC,
  p_effective_start_time TIMESTAMPTZ,
  p_plan_id TEXT DEFAULT NULL,
  p_usage_event_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_record_id UUID;
BEGIN
  INSERT INTO marketplace_metering_records (
    marketplace_subscription_id,
    dimension,
    quantity,
    effective_start_time,
    plan_id,
    usage_event_id,
    status,
    created_at
  )
  VALUES (
    p_marketplace_sub_id,
    p_dimension,
    p_quantity,
    p_effective_start_time,
    p_plan_id,
    p_usage_event_id,
    'pending',
    now()
  )
  RETURNING id INTO v_record_id;

  RETURN v_record_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. HELPER FUNCTION: update_marketplace_subscription_status
-- ============================================
-- Safely updates marketplace subscription status with validation
-- Purpose: Single source of truth for subscription state changes

CREATE OR REPLACE FUNCTION update_marketplace_subscription_status(
  p_marketplace_sub_id TEXT,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  subscription_id UUID,
  old_status TEXT,
  new_status TEXT,
  success BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_sub_id UUID;
  v_old_status TEXT;
  v_success BOOLEAN := false;
  v_error TEXT := NULL;
BEGIN
  -- Validate status
  IF p_new_status NOT IN ('PendingFulfillmentStart', 'Subscribed', 'Suspended', 'Unsubscribed') THEN
    RETURN QUERY SELECT NULL::UUID, NULL, p_new_status, false, 'Invalid marketplace status: ' || p_new_status;
    RETURN;
  END IF;

  -- Get current subscription
  SELECT id, marketplace_status INTO v_sub_id, v_old_status
  FROM billing_subscriptions
  WHERE marketplace_subscription_id = p_marketplace_sub_id
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL, NULL, false, 'Subscription not found: ' || p_marketplace_sub_id;
    RETURN;
  END IF;

  -- Update subscription
  BEGIN
    UPDATE billing_subscriptions
    SET
      marketplace_status = p_new_status,
      marketplace_activated_at = CASE
        WHEN p_new_status = 'Subscribed' AND marketplace_activated_at IS NULL
        THEN now()
        ELSE marketplace_activated_at
      END,
      updated_at = now()
    WHERE id = v_sub_id;

    v_success := true;
  EXCEPTION WHEN OTHERS THEN
    v_error := 'Failed to update subscription: ' || SQLERRM;
    v_success := false;
  END;

  -- Record the status change event
  IF v_success THEN
    PERFORM record_marketplace_event(
      p_marketplace_sub_id,
      CASE
        WHEN p_new_status = 'Subscribed' THEN 'activate'
        WHEN p_new_status = 'Suspended' THEN 'suspend'
        WHEN p_new_status = 'Unsubscribed' THEN 'unsubscribe'
        ELSE 'change_plan'
      END,
      'success',
      JSONB_BUILD_OBJECT('previous_status', v_old_status, 'new_status', p_new_status, 'reason', p_reason),
      NULL,
      NULL
    );
  END IF;

  RETURN QUERY SELECT v_sub_id, v_old_status, p_new_status, v_success, v_error;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 10. INDEXES FOR OPTIMIZATION
-- ============================================
-- Additional indexes for common marketplace queries

CREATE INDEX IF NOT EXISTS idx_billing_subs_tenant_marketplace
  ON billing_subscriptions(tenant_id, billing_source)
  WHERE billing_source = 'azure_marketplace';

CREATE INDEX IF NOT EXISTS idx_marketplace_events_processed
  ON marketplace_events(processed_at DESC)
  WHERE processed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metering_sub_dimension
  ON marketplace_metering_records(marketplace_subscription_id, dimension);

-- ============================================
-- 11. GRANT PERMISSIONS FOR SERVICE ROLE
-- ============================================
-- Ensure service role can manage marketplace operations

GRANT ALL PRIVILEGES ON marketplace_events TO service_role;
GRANT ALL PRIVILEGES ON marketplace_metering_records TO service_role;
GRANT ALL PRIVILEGES ON azure_ad_tenants TO service_role;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION get_marketplace_subscription(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION provision_marketplace_tenant(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION record_marketplace_event(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION submit_marketplace_metering(TEXT, TEXT, NUMERIC, TIMESTAMPTZ, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_marketplace_subscription_status(TEXT, TEXT, TEXT) TO service_role;

-- Allow authenticated users to call read-only functions
GRANT EXECUTE ON FUNCTION get_marketplace_subscription(TEXT) TO authenticated;

COMMIT;
