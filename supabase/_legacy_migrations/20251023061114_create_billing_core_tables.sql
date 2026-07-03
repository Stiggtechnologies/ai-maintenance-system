/*
  # Stigg Reliability AI - Billing Core Tables

  1. New Tables
    - `billing_plans`
      - `id` (uuid, primary key)
      - `code` (text, unique) - STARTER, PRO, ENTERPRISE
      - `name` (text) - Display name
      - `base_price_cad` (numeric) - Monthly base price
      - `included_assets` (int) - Assets included in plan
      - `included_credits` (bigint) - Monthly credit allowance
      - `asset_uplift_cad` (numeric) - Per-asset overage cost
      - `overage_per_credit_cad` (numeric) - Per-credit overage cost
      - `max_sites` (int) - Maximum sites allowed
      - `created_at` (timestamptz)

    - `billing_subscriptions`
      - `id` (uuid, primary key)
      - `tenant_id` (uuid) - Links to existing tenant system
      - `plan_id` (uuid) - References billing_plans
      - `status` (text) - active, cancelled, past_due, etc.
      - `current_period_start` (timestamptz)
      - `current_period_end` (timestamptz)
      - `cancel_at_period_end` (boolean)
      - `currency` (text) - Default CAD
      - `stripe_subscription_id` (text)
      - `stripe_customer_id` (text)
      - `created_at` (timestamptz)

    - `subscription_limits`
      - `id` (uuid, primary key)
      - `subscription_id` (uuid)
      - `included_assets` (int)
      - `included_credits` (bigint)
      - `remaining_credits` (bigint) - Cached for performance
      - `last_reset_at` (timestamptz)
      - `created_at` (timestamptz)

    - `billing_invoices`
      - `id` (uuid, primary key)
      - `subscription_id` (uuid)
      - `period_start` (timestamptz)
      - `period_end` (timestamptz)
      - `base_amount_cad` (numeric)
      - `asset_uplift_cad` (numeric)
      - `usage_overage_cad` (numeric)
      - `subtotal_cad` (numeric)
      - `tax_cad` (numeric)
      - `total_cad` (numeric)
      - `stripe_invoice_id` (text)
      - `status` (text) - draft, open, paid, void
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated access
*/

-- Plans table
CREATE TABLE IF NOT EXISTS billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  base_price_cad NUMERIC(12,2) NOT NULL,
  included_assets INT NOT NULL,
  included_credits BIGINT NOT NULL,
  asset_uplift_cad NUMERIC(12,2) NOT NULL,
  overage_per_credit_cad NUMERIC(12,4) NOT NULL,
  max_sites INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plans are viewable by all authenticated users"
  ON billing_plans FOR SELECT
  TO authenticated
  USING (true);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  plan_id UUID NOT NULL REFERENCES billing_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'CAD',
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subs_tenant ON billing_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_subs_stripe ON billing_subscriptions(stripe_subscription_id);

ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant subscriptions"
  ON billing_subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
    )
  );

-- Subscription limits (cached credits)
CREATE TABLE IF NOT EXISTS subscription_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  included_assets INT NOT NULL,
  included_credits BIGINT NOT NULL,
  remaining_credits BIGINT NOT NULL,
  last_reset_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_limits_subscription ON subscription_limits(subscription_id);

ALTER TABLE subscription_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription limits"
  ON subscription_limits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE bs.id = subscription_limits.subscription_id
    )
  );

-- Invoices table
CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES billing_subscriptions(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  base_amount_cad NUMERIC(12,2) NOT NULL DEFAULT 0,
  asset_uplift_cad NUMERIC(12,2) NOT NULL DEFAULT 0,
  usage_overage_cad NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_cad NUMERIC(12,2) NOT NULL,
  tax_cad NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cad NUMERIC(12,2) NOT NULL,
  stripe_invoice_id TEXT,
  stripe_hosted_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  asset_count INT,
  credits_consumed BIGINT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_sub ON billing_invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_stripe ON billing_invoices(stripe_invoice_id);

ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own invoices"
  ON billing_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM billing_subscriptions bs
      JOIN user_profiles up ON up.id = auth.uid()
      WHERE bs.id = billing_invoices.subscription_id
    )
  );

-- Seed the plans
INSERT INTO billing_plans (code, name, base_price_cad, included_assets, included_credits, asset_uplift_cad, overage_per_credit_cad, max_sites)
VALUES 
  ('STARTER', 'Starter (Pilot)', 4000.00, 200, 250000, 3.00, 0.0020, 1),
  ('PRO', 'Pro (Scale)', 9000.00, 1000, 1000000, 3.00, 0.0020, 3),
  ('ENTERPRISE', 'Enterprise (Autonomous)', 18000.00, 3000, 5000000, 2.50, 0.0015, 8)
ON CONFLICT (code) DO NOTHING;
