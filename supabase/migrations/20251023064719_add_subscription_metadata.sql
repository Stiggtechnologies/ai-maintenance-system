/*
  # Add Metadata Column to Subscriptions

  1. Changes
    - Add `metadata` JSONB column to `billing_subscriptions`
    - Stores Stripe subscription item IDs for metered billing
    - Includes: stripe_base_item_id, stripe_credits_item_id, plan_code

  2. Purpose
    - Enable Stripe metered usage reporting
    - Store subscription item IDs from webhook
    - Track additional subscription metadata
*/

-- Add metadata column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'billing_subscriptions' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE billing_subscriptions ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create index for faster metadata queries
CREATE INDEX IF NOT EXISTS idx_billing_subs_metadata ON billing_subscriptions USING GIN (metadata);
