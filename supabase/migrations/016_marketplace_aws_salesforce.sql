-- =====================================================================
-- 016: AWS Marketplace + Salesforce AppExchange offers
-- =====================================================================
-- Extends migration 015's multi-marketplace schema with AWS Marketplace
-- (SaaS Listing — ResolveCustomer / GetEntitlements / SQS events) and
-- Salesforce AppExchange (managed package + LMA license tracking).
--
-- Both reuse marketplace_offers / marketplace_plans / marketplace_subscriptions
-- / marketplace_webhook_events from 015; the marketplace column already
-- accepts 'aws' and 'salesforce'. This migration just seeds the offers,
-- adds AWS-specific extensions, and tunes lifecycle status to span all
-- three marketplaces.
--
-- AWS Marketplace SaaS reference:
--   https://docs.aws.amazon.com/marketplace/latest/userguide/saas-product.html
-- Salesforce AppExchange + LMA reference:
--   https://developer.salesforce.com/docs/atlas.en-us.licensemanagementapp.meta/licensemanagementapp/
-- =====================================================================

-- =====================================================================
-- AWS-specific extensions to marketplace_subscriptions
-- =====================================================================

ALTER TABLE marketplace_subscriptions
    ADD COLUMN IF NOT EXISTS aws_customer_identifier TEXT,
    ADD COLUMN IF NOT EXISTS aws_customer_aws_account_id TEXT,
    ADD COLUMN IF NOT EXISTS aws_product_code TEXT,
    ADD COLUMN IF NOT EXISTS aws_dimension TEXT,
    ADD COLUMN IF NOT EXISTS sf_organization_id TEXT,
    ADD COLUMN IF NOT EXISTS sf_package_version_id TEXT,
    ADD COLUMN IF NOT EXISTS sf_license_id TEXT,
    ADD COLUMN IF NOT EXISTS sf_seats INTEGER,
    ADD COLUMN IF NOT EXISTS sf_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_marketplace_subs_aws_customer ON marketplace_subscriptions(aws_customer_identifier);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_sf_org ON marketplace_subscriptions(sf_organization_id);

-- Loosen the lifecycle status check to cover AWS + Salesforce statuses
-- in addition to Microsoft's. Drop the original constraint and replace.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'marketplace_subscriptions_status_check'
          AND conrelid = 'marketplace_subscriptions'::regclass
    ) THEN
        ALTER TABLE marketplace_subscriptions DROP CONSTRAINT marketplace_subscriptions_status_check;
    END IF;
END $$;

ALTER TABLE marketplace_subscriptions
    ADD CONSTRAINT marketplace_subscriptions_status_check
    CHECK (status IN (
        -- Microsoft
        'PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed','NotStarted',
        -- AWS (mapped from SubscribeSuccess / UnsubscribePending / UnsubscribeSuccess / Expired)
        'aws_pending_subscription','aws_subscribed','aws_unsubscribe_pending','aws_unsubscribed','aws_expired',
        -- Salesforce LMA
        'sf_active','sf_trial','sf_suspended','sf_uninstalled','sf_expired'
    ));

-- =====================================================================
-- AWS Marketplace events catalog
-- =====================================================================

-- AWS sends events via SNS → SQS → your endpoint. We log the raw event
-- and apply lifecycle actions idempotently.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'marketplace_webhook_events_action_check'
          AND conrelid = 'marketplace_webhook_events'::regclass
    ) THEN
        ALTER TABLE marketplace_webhook_events DROP CONSTRAINT marketplace_webhook_events_action_check;
    END IF;
END $$;
-- We don't add a new check constraint — actions vary per marketplace,
-- and the application layer validates them per-marketplace handler.

-- =====================================================================
-- AWS-specific RPC: upsert subscription from ResolveCustomer
-- =====================================================================

CREATE OR REPLACE FUNCTION marketplace_aws_upsert_from_resolve(
    p_customer_identifier TEXT,
    p_customer_aws_account_id TEXT,
    p_product_code TEXT,
    p_offer_code TEXT,           -- maps to marketplace_offers.offer_id
    p_plan_code TEXT,             -- maps to marketplace_plans.plan_id
    p_status TEXT,
    p_raw_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- AWS subscription "id" for our schema is the customer identifier
    -- (AWS doesn't issue a separate subscription id like Microsoft does).
    INSERT INTO marketplace_subscriptions (
        marketplace, marketplace_subscription_id, offer_id, plan_id,
        aws_customer_identifier, aws_customer_aws_account_id, aws_product_code,
        status, raw_resolve_payload
    ) VALUES (
        'aws', p_customer_identifier, p_offer_code, p_plan_code,
        p_customer_identifier, p_customer_aws_account_id, p_product_code,
        p_status, p_raw_payload
    )
    ON CONFLICT (marketplace_subscription_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        aws_customer_aws_account_id = EXCLUDED.aws_customer_aws_account_id,
        aws_product_code = EXCLUDED.aws_product_code,
        status = EXCLUDED.status,
        raw_resolve_payload = EXCLUDED.raw_resolve_payload,
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- =====================================================================
-- Salesforce-specific RPC: upsert from LMA license event
-- =====================================================================

CREATE OR REPLACE FUNCTION marketplace_sf_upsert_from_license(
    p_sf_organization_id TEXT,
    p_sf_package_version_id TEXT,
    p_sf_license_id TEXT,
    p_offer_code TEXT,
    p_plan_code TEXT,
    p_seats INTEGER,
    p_status TEXT,
    p_expires_at TIMESTAMPTZ,
    p_raw_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Salesforce: license_id is the unique subscription identifier
    INSERT INTO marketplace_subscriptions (
        marketplace, marketplace_subscription_id, offer_id, plan_id,
        sf_organization_id, sf_package_version_id, sf_license_id,
        sf_seats, sf_expires_at, quantity, status, raw_resolve_payload
    ) VALUES (
        'salesforce', p_sf_license_id, p_offer_code, p_plan_code,
        p_sf_organization_id, p_sf_package_version_id, p_sf_license_id,
        p_seats, p_expires_at, p_seats, p_status, p_raw_payload
    )
    ON CONFLICT (marketplace_subscription_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        sf_organization_id = EXCLUDED.sf_organization_id,
        sf_package_version_id = EXCLUDED.sf_package_version_id,
        sf_seats = EXCLUDED.sf_seats,
        sf_expires_at = EXCLUDED.sf_expires_at,
        quantity = EXCLUDED.quantity,
        status = EXCLUDED.status,
        raw_resolve_payload = EXCLUDED.raw_resolve_payload,
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION marketplace_aws_upsert_from_resolve(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_sf_upsert_from_license(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_aws_upsert_from_resolve(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION marketplace_sf_upsert_from_license(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ, JSONB) TO service_role;

-- =====================================================================
-- SEED: AWS + Salesforce offers (matching Microsoft's plan structure)
-- =====================================================================

INSERT INTO marketplace_offers (marketplace, offer_id, publisher_id, name, description) VALUES
  ('aws', 'syncai_industrial_aws', 'stigg-technologies',
   'SyncAI — Industrial AI Infrastructure (AWS)',
   'Same SyncAI platform, billed through your AWS Enterprise Discount Program. Buy via AWS Marketplace, pay against your AWS commit.')
ON CONFLICT (marketplace, offer_id) DO NOTHING;

INSERT INTO marketplace_offers (marketplace, offer_id, publisher_id, name, description) VALUES
  ('salesforce', 'syncai_industrial_sf', 'StiggTechnologies',
   'SyncAI — Industrial AI Infrastructure (Salesforce)',
   'Embed SyncAI in your Salesforce org. Asset and work order data syncs bi-directionally; agents run from your existing CRM.')
ON CONFLICT (marketplace, offer_id) DO NOTHING;

-- AWS plans
INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'starter', 'Starter',
       'Up to 10 users, 5 agents, basic integrations. Billed monthly via AWS.',
       true, 99, true
FROM marketplace_offers WHERE marketplace = 'aws' AND offer_id = 'syncai_industrial_aws'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'pro', 'Professional',
       'All 15 agents, full integrations roster, SOC 2. Billed monthly via AWS.',
       true, 199, true
FROM marketplace_offers WHERE marketplace = 'aws' AND offer_id = 'syncai_industrial_aws'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'enterprise', 'Enterprise',
       'Multi-site, autonomous governance, custom prompts. Billed via AWS Private Offer.',
       true, 349, true
FROM marketplace_offers WHERE marketplace = 'aws' AND offer_id = 'syncai_industrial_aws'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

-- Salesforce plans
INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'starter', 'Starter',
       'Up to 10 SF users, basic agents, work order + asset sync.',
       true, 99, true
FROM marketplace_offers WHERE marketplace = 'salesforce' AND offer_id = 'syncai_industrial_sf'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'pro', 'Professional',
       'All 15 agents, bi-directional sync, custom Salesforce flows.',
       true, 199, true
FROM marketplace_offers WHERE marketplace = 'salesforce' AND offer_id = 'syncai_industrial_sf'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'enterprise', 'Enterprise',
       'Multi-org, custom Apex extensions, dedicated CSM.',
       true, 349, true
FROM marketplace_offers WHERE marketplace = 'salesforce' AND offer_id = 'syncai_industrial_sf'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

SELECT '016: AWS + Salesforce offers seeded — 3 plans each' AS status;
