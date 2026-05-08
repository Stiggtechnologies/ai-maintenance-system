/*
  # AWS Marketplace + Salesforce AppExchange Integration

  Mirrors the structure of `20260430120000_azure_marketplace_integration.sql`:
   - Extends billing_subscriptions with vendor-specific columns (additive, idempotent)
   - Widens the billing_source CHECK to include the two new vendors
   - Adds dedicated audit tables per marketplace (mirrors `marketplace_events`)
   - RLS scoped via user_profiles.organization_id, same as Azure

  Compatibility: builds cleanly on top of the existing Azure migration. Both
  AWS and Azure subscriptions can coexist on the same billing_subscriptions row
  if a customer purchases through more than one channel (rare, but supported).
*/

BEGIN;

-- ============================================
-- 1. WIDEN billing_source ENUM TO COVER ALL 4 CHANNELS
-- ============================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname LIKE 'billing_subscriptions_billing_source%'
      AND conrelid = 'billing_subscriptions'::regclass
  ) THEN
    -- Drop any existing CHECK on billing_source so we can replace it
    EXECUTE (
      SELECT 'ALTER TABLE billing_subscriptions DROP CONSTRAINT ' || conname
      FROM pg_constraint
      WHERE conname LIKE 'billing_subscriptions_billing_source%'
        AND conrelid = 'billing_subscriptions'::regclass
      LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_billing_source_check
  CHECK (billing_source IN ('direct', 'azure_marketplace', 'aws_marketplace', 'salesforce_appexchange'));

-- ============================================
-- 2. AWS MARKETPLACE COLUMNS ON billing_subscriptions
-- ============================================

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS aws_customer_identifier TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS aws_customer_aws_account_id TEXT,
  ADD COLUMN IF NOT EXISTS aws_product_code TEXT,
  ADD COLUMN IF NOT EXISTS aws_offer_identifier TEXT,
  ADD COLUMN IF NOT EXISTS aws_dimension TEXT,
  ADD COLUMN IF NOT EXISTS aws_status TEXT
    CHECK (aws_status IS NULL OR aws_status IN (
      'aws_pending_subscription', 'aws_subscribed',
      'aws_unsubscribe_pending', 'aws_unsubscribed', 'aws_expired'
    ));

CREATE INDEX IF NOT EXISTS idx_billing_subs_aws_customer_id
  ON billing_subscriptions(aws_customer_identifier)
  WHERE aws_customer_identifier IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_subs_aws_status
  ON billing_subscriptions(aws_status)
  WHERE aws_status IS NOT NULL;

-- ============================================
-- 3. SALESFORCE APPEXCHANGE COLUMNS ON billing_subscriptions
-- ============================================

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS sf_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS sf_package_version_id TEXT,
  ADD COLUMN IF NOT EXISTS sf_license_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS sf_seats INTEGER,
  ADD COLUMN IF NOT EXISTS sf_status TEXT
    CHECK (sf_status IS NULL OR sf_status IN (
      'sf_active', 'sf_trial', 'sf_suspended', 'sf_uninstalled', 'sf_expired'
    )),
  ADD COLUMN IF NOT EXISTS sf_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_subs_sf_org
  ON billing_subscriptions(sf_organization_id)
  WHERE sf_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_subs_sf_license
  ON billing_subscriptions(sf_license_id)
  WHERE sf_license_id IS NOT NULL;

-- ============================================
-- 4. AWS_MARKETPLACE_EVENTS AUDIT TABLE
-- ============================================
-- Mirrors marketplace_events for AWS-specific lifecycle events relayed via
-- SNS → SQS → relay Lambda → POST to marketplace-aws-webhook Edge Function.

CREATE TABLE IF NOT EXISTS aws_marketplace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aws_customer_identifier TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,    -- SQS message id; idempotency key
  action TEXT NOT NULL
    CHECK (action IN (
      'subscribe-success', 'unsubscribe-pending',
      'unsubscribe-success', 'subscribe-fail',
      'resolve'
    )),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'success', 'failure')),
  request_payload JSONB,
  response_payload JSONB,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aws_events_customer_id
  ON aws_marketplace_events(aws_customer_identifier);
CREATE INDEX IF NOT EXISTS idx_aws_events_action_time
  ON aws_marketplace_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aws_events_created
  ON aws_marketplace_events(created_at DESC);

ALTER TABLE aws_marketplace_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access to AWS events"
  ON aws_marketplace_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users view own org AWS events"
  ON aws_marketplace_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON bs.tenant_id = up.organization_id
      WHERE up.id = auth.uid()
        AND bs.aws_customer_identifier = aws_marketplace_events.aws_customer_identifier
    )
  );

-- ============================================
-- 5. SALESFORCE_LICENSE_EVENTS AUDIT TABLE
-- ============================================
-- Salesforce LMA license lifecycle events posted by the customer's SF Flow.

CREATE TABLE IF NOT EXISTS salesforce_license_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sf_license_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,        -- license_id + timestamp; idempotency
  sf_organization_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN (
      'license_active', 'license_trial', 'license_suspended',
      'license_uninstalled', 'license_expired'
    )),
  seats INTEGER,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'success', 'failure')),
  payload JSONB,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf_events_license_id
  ON salesforce_license_events(sf_license_id);
CREATE INDEX IF NOT EXISTS idx_sf_events_org_id
  ON salesforce_license_events(sf_organization_id);
CREATE INDEX IF NOT EXISTS idx_sf_events_action_time
  ON salesforce_license_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sf_events_created
  ON salesforce_license_events(created_at DESC);

ALTER TABLE salesforce_license_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access to Salesforce events"
  ON salesforce_license_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users view own org Salesforce events"
  ON salesforce_license_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON bs.tenant_id = up.organization_id
      WHERE up.id = auth.uid()
        AND bs.sf_license_id = salesforce_license_events.sf_license_id
    )
  );

-- ============================================
-- 6. HELPER FUNCTIONS (mirror Azure pattern)
-- ============================================

-- AWS: idempotent upsert from ResolveCustomer response
CREATE OR REPLACE FUNCTION upsert_aws_marketplace_subscription(
  p_customer_identifier TEXT,
  p_aws_account_id TEXT,
  p_product_code TEXT,
  p_offer_identifier TEXT,
  p_status TEXT,
  p_resolve_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO billing_subscriptions (
    tenant_id,
    billing_source,
    aws_customer_identifier,
    aws_customer_aws_account_id,
    aws_product_code,
    aws_offer_identifier,
    aws_status,
    status,
    metadata
  ) VALUES (
    NULL,                       -- linked to org during signup flow
    'aws_marketplace',
    p_customer_identifier,
    p_aws_account_id,
    p_product_code,
    p_offer_identifier,
    p_status,
    'pending',
    jsonb_build_object('aws_resolve_payload', p_resolve_payload)
  )
  ON CONFLICT (aws_customer_identifier) DO UPDATE SET
    aws_customer_aws_account_id = EXCLUDED.aws_customer_aws_account_id,
    aws_product_code = EXCLUDED.aws_product_code,
    aws_offer_identifier = EXCLUDED.aws_offer_identifier,
    aws_status = EXCLUDED.aws_status,
    metadata = billing_subscriptions.metadata || jsonb_build_object('aws_resolve_payload', p_resolve_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Salesforce: idempotent upsert from LMA license event
CREATE OR REPLACE FUNCTION upsert_salesforce_license_subscription(
  p_sf_license_id TEXT,
  p_sf_organization_id TEXT,
  p_sf_package_version_id TEXT,
  p_seats INTEGER,
  p_sf_status TEXT,
  p_expires_at TIMESTAMPTZ,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO billing_subscriptions (
    tenant_id,
    billing_source,
    sf_license_id,
    sf_organization_id,
    sf_package_version_id,
    sf_seats,
    sf_status,
    sf_expires_at,
    status,
    metadata
  ) VALUES (
    NULL,
    'salesforce_appexchange',
    p_sf_license_id,
    p_sf_organization_id,
    p_sf_package_version_id,
    p_seats,
    p_sf_status,
    p_expires_at,
    'pending',
    jsonb_build_object('sf_payload', p_payload)
  )
  ON CONFLICT (sf_license_id) DO UPDATE SET
    sf_organization_id = EXCLUDED.sf_organization_id,
    sf_package_version_id = EXCLUDED.sf_package_version_id,
    sf_seats = EXCLUDED.sf_seats,
    sf_status = EXCLUDED.sf_status,
    sf_expires_at = EXCLUDED.sf_expires_at,
    metadata = billing_subscriptions.metadata || jsonb_build_object('sf_payload', p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION upsert_aws_marketplace_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_salesforce_license_subscription(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_aws_marketplace_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION upsert_salesforce_license_subscription(TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) TO service_role;

COMMIT;

SELECT 'AWS + Salesforce marketplace integration columns + audit tables ready' AS status;
