-- =====================================================================
-- 015: Microsoft AppSource / Azure Marketplace fulfillment
-- =====================================================================
-- Adds the schema needed for SaaS Fulfillment API v2 webhook events.
-- Sits on top of the existing billing_subscriptions / billing_plans
-- schema so Marketplace-purchased orgs and Stripe-purchased orgs share
-- the same downstream entitlement / metering pipeline.
--
-- Microsoft SaaS Fulfillment v2 API reference:
--   https://learn.microsoft.com/azure/marketplace/partner-center-portal/pc-saas-fulfillment-api-v2
--
-- Lifecycle states (`marketplace_subscriptions.status`) mirror the
-- Microsoft enum exactly so the webhook handler can pass through:
--   PendingFulfillmentStart | Subscribed | Suspended | Unsubscribed
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS marketplace_offers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    marketplace TEXT NOT NULL CHECK (marketplace IN ('microsoft','aws','google','salesforce')),
    offer_id TEXT NOT NULL,                      -- Microsoft offerId, e.g. "syncai_industrial"
    publisher_id TEXT,                           -- Microsoft publisherId
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (marketplace, offer_id)
);

CREATE TABLE IF NOT EXISTS marketplace_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offer_id UUID NOT NULL REFERENCES marketplace_offers(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,                       -- Microsoft planId, e.g. "starter", "pro", "enterprise"
    billing_plan_id UUID REFERENCES billing_plans(id),  -- maps to internal plan
    name TEXT NOT NULL,
    description TEXT,
    is_per_seat BOOLEAN DEFAULT true,
    base_price_usd NUMERIC,                      -- displayed; actual billing is on Microsoft's side
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (offer_id, plan_id)
);

CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    billing_subscription_id UUID REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
    marketplace TEXT NOT NULL DEFAULT 'microsoft' CHECK (marketplace IN ('microsoft','aws','google','salesforce')),
    -- Microsoft fields (mapped from SaaS Fulfillment v2)
    marketplace_subscription_id TEXT NOT NULL UNIQUE,   -- Microsoft subscriptionId (UUID)
    offer_id TEXT NOT NULL,                              -- e.g. "syncai_industrial"
    plan_id TEXT NOT NULL,                               -- e.g. "pro"
    quantity INTEGER NOT NULL DEFAULT 1,                 -- seat count
    purchaser_email TEXT,
    purchaser_object_id TEXT,                            -- AAD object id
    purchaser_tenant_id TEXT,                            -- AAD tenant
    beneficiary_email TEXT,
    beneficiary_object_id TEXT,
    beneficiary_tenant_id TEXT,
    -- Microsoft lifecycle status — mirrors saasSubscriptionStatus enum
    status TEXT NOT NULL DEFAULT 'PendingFulfillmentStart'
        CHECK (status IN ('PendingFulfillmentStart','Subscribed','Suspended','Unsubscribed','NotStarted')),
    saas_session_id TEXT,                                -- token resolution session
    activation_landing_url TEXT,                         -- where buyer was redirected on activation
    last_event_id TEXT,
    last_event_action TEXT,
    raw_resolve_payload JSONB,                           -- last full resolve response from Marketplace
    metadata JSONB DEFAULT '{}',
    activated_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_subs_org ON marketplace_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_status ON marketplace_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_marketplace ON marketplace_subscriptions(marketplace);

-- Webhook event audit log
CREATE TABLE IF NOT EXISTS marketplace_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    marketplace TEXT NOT NULL DEFAULT 'microsoft',
    event_id TEXT NOT NULL,                              -- Microsoft event id (UUID)
    subscription_id TEXT NOT NULL,                       -- Microsoft subscriptionId
    action TEXT NOT NULL,                                -- ChangeQuantity | ChangePlan | Suspend | Reinstate | Unsubscribe | Renew
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','processed','failed','ignored')),
    payload JSONB NOT NULL,
    error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (marketplace, event_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_events_sub ON marketplace_webhook_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_events_status ON marketplace_webhook_events(status);

-- =====================================================================
-- RPCs
-- =====================================================================

-- Idempotent upsert called by integration-fulfillment-webhook
CREATE OR REPLACE FUNCTION marketplace_upsert_subscription_from_resolve(
    p_marketplace TEXT,
    p_subscription_id TEXT,
    p_offer_id TEXT,
    p_plan_id TEXT,
    p_quantity INTEGER,
    p_purchaser_email TEXT,
    p_purchaser_object_id TEXT,
    p_purchaser_tenant_id TEXT,
    p_beneficiary_email TEXT,
    p_beneficiary_object_id TEXT,
    p_beneficiary_tenant_id TEXT,
    p_status TEXT,
    p_session_id TEXT,
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
    INSERT INTO marketplace_subscriptions (
        marketplace, marketplace_subscription_id, offer_id, plan_id, quantity,
        purchaser_email, purchaser_object_id, purchaser_tenant_id,
        beneficiary_email, beneficiary_object_id, beneficiary_tenant_id,
        status, saas_session_id, raw_resolve_payload
    ) VALUES (
        p_marketplace, p_subscription_id, p_offer_id, p_plan_id, p_quantity,
        p_purchaser_email, p_purchaser_object_id, p_purchaser_tenant_id,
        p_beneficiary_email, p_beneficiary_object_id, p_beneficiary_tenant_id,
        p_status, p_session_id, p_raw_payload
    )
    ON CONFLICT (marketplace_subscription_id) DO UPDATE SET
        offer_id = EXCLUDED.offer_id,
        plan_id = EXCLUDED.plan_id,
        quantity = EXCLUDED.quantity,
        purchaser_email = EXCLUDED.purchaser_email,
        purchaser_object_id = EXCLUDED.purchaser_object_id,
        purchaser_tenant_id = EXCLUDED.purchaser_tenant_id,
        beneficiary_email = EXCLUDED.beneficiary_email,
        beneficiary_object_id = EXCLUDED.beneficiary_object_id,
        beneficiary_tenant_id = EXCLUDED.beneficiary_tenant_id,
        status = EXCLUDED.status,
        saas_session_id = EXCLUDED.saas_session_id,
        raw_resolve_payload = EXCLUDED.raw_resolve_payload,
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION marketplace_apply_webhook_event(
    p_event_id TEXT,
    p_subscription_id TEXT,
    p_action TEXT,
    p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_event_uuid UUID;
    v_new_status TEXT;
    v_new_quantity INTEGER;
    v_new_plan TEXT;
BEGIN
    -- Idempotency: if event_id already processed, return its row
    INSERT INTO marketplace_webhook_events (event_id, subscription_id, action, payload, status)
    VALUES (p_event_id, p_subscription_id, p_action, p_payload, 'received')
    ON CONFLICT (marketplace, event_id) DO UPDATE SET status = marketplace_webhook_events.status
    RETURNING id INTO v_event_uuid;

    -- If we've already processed this event, return early
    IF EXISTS (SELECT 1 FROM marketplace_webhook_events WHERE id = v_event_uuid AND status IN ('processed','ignored')) THEN
        RETURN v_event_uuid;
    END IF;

    -- Apply the action
    v_new_status := CASE p_action
        WHEN 'Suspend'      THEN 'Suspended'
        WHEN 'Reinstate'    THEN 'Subscribed'
        WHEN 'Unsubscribe'  THEN 'Unsubscribed'
        ELSE NULL
    END;

    v_new_quantity := CASE WHEN p_action = 'ChangeQuantity'
        THEN COALESCE((p_payload->>'quantity')::int, NULL) ELSE NULL END;

    v_new_plan := CASE WHEN p_action = 'ChangePlan'
        THEN p_payload->>'planId' ELSE NULL END;

    UPDATE marketplace_subscriptions SET
        status = COALESCE(v_new_status, status),
        quantity = COALESCE(v_new_quantity, quantity),
        plan_id = COALESCE(v_new_plan, plan_id),
        last_event_id = p_event_id,
        last_event_action = p_action,
        canceled_at = CASE WHEN p_action = 'Unsubscribe' THEN NOW() ELSE canceled_at END,
        updated_at = NOW()
    WHERE marketplace_subscription_id = p_subscription_id;

    UPDATE marketplace_webhook_events
    SET status = 'processed', processed_at = NOW()
    WHERE id = v_event_uuid;

    RETURN v_event_uuid;
END;
$$;

REVOKE ALL ON FUNCTION marketplace_upsert_subscription_from_resolve(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace_apply_webhook_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marketplace_upsert_subscription_from_resolve(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION marketplace_apply_webhook_event(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- =====================================================================
-- RLS
-- =====================================================================

ALTER TABLE marketplace_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_webhook_events ENABLE ROW LEVEL SECURITY;

-- Catalog (offers + plans) is public read
DROP POLICY IF EXISTS "marketplace_offers_select" ON marketplace_offers;
CREATE POLICY "marketplace_offers_select" ON marketplace_offers FOR SELECT USING (true);

DROP POLICY IF EXISTS "marketplace_plans_select" ON marketplace_plans;
CREATE POLICY "marketplace_plans_select" ON marketplace_plans FOR SELECT USING (true);

-- Subscriptions: org-scoped (when linked) + service_role bypass for webhooks
DROP POLICY IF EXISTS "marketplace_subs_select" ON marketplace_subscriptions;
CREATE POLICY "marketplace_subs_select" ON marketplace_subscriptions FOR SELECT
  USING (organization_id = current_user_org_id());

-- Events: only service_role (no public select policy means RLS denies)

-- =====================================================================
-- SEED: Microsoft offer + 3 plans aligned with billing_plans
-- =====================================================================

INSERT INTO marketplace_offers (marketplace, offer_id, publisher_id, name, description) VALUES
  ('microsoft', 'syncai_industrial', 'stiggtechnologies', 'SyncAI — Industrial AI Infrastructure',
   'Autonomous AI agents for asset-intensive industries. 15 specialized agents, 13 industry templates, real-time integrations with SAP/Maximo/PI/Anthropic.')
ON CONFLICT (marketplace, offer_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'starter', 'Starter',
       'For pilots and small operations. Up to 10 users, 5 agents, basic integrations.',
       true, 99, true
FROM marketplace_offers WHERE marketplace = 'microsoft' AND offer_id = 'syncai_industrial'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'pro', 'Professional',
       'For mid-size deployments. Unlimited users, all 15 agents, full integrations roster, SOC 2 reports.',
       true, 199, true
FROM marketplace_offers WHERE marketplace = 'microsoft' AND offer_id = 'syncai_industrial'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

INSERT INTO marketplace_plans (offer_id, plan_id, name, description, is_per_seat, base_price_usd, is_active)
SELECT id, 'enterprise', 'Enterprise',
       'Multi-site, autonomous governance, dedicated support, custom agent prompts, on-prem deployment option.',
       true, 349, true
FROM marketplace_offers WHERE marketplace = 'microsoft' AND offer_id = 'syncai_industrial'
ON CONFLICT (offer_id, plan_id) DO NOTHING;

SELECT '015: Microsoft Marketplace fulfillment ready — 1 offer, 3 plans seeded' AS status;
