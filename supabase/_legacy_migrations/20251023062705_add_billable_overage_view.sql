/*
  # Add Billable Overage View

  1. New View
    - `v_billable_overage` - Monthly overage calculation per subscription
    - Calculates: SUM(credits) - included_credits for each month
    - Useful for invoice generation and reporting

  2. Purpose
    - Simplifies invoice generation queries
    - Provides historical overage tracking
    - Used in billing dashboards
*/

-- Billable overage view (monthly)
CREATE OR REPLACE VIEW v_billable_overage AS
SELECT
  bs.id AS subscription_id,
  bs.tenant_id,
  date_trunc('month', ue.occurred_at) AS month,
  sl.included_credits,
  SUM(ue.credits_consumed) AS total_credits_used,
  GREATEST(0, SUM(ue.credits_consumed) - sl.included_credits) AS overage_credits,
  bp.overage_per_credit_cad,
  GREATEST(0, SUM(ue.credits_consumed) - sl.included_credits) * bp.overage_per_credit_cad AS overage_amount_cad
FROM billing_subscriptions bs
JOIN subscription_limits sl ON sl.subscription_id = bs.id
JOIN billing_plans bp ON bp.id = bs.plan_id
LEFT JOIN usage_events ue ON ue.subscription_id = bs.id
GROUP BY bs.id, bs.tenant_id, date_trunc('month', ue.occurred_at), sl.included_credits, bp.overage_per_credit_cad;

-- Monthly usage summary with overage flag
CREATE OR REPLACE VIEW v_monthly_usage_summary AS
SELECT
  bs.id AS subscription_id,
  bs.tenant_id,
  date_trunc('month', ue.occurred_at) AS month,
  COUNT(*) AS event_count,
  SUM(ue.credits_consumed) AS credits_used,
  sl.included_credits,
  sl.remaining_credits,
  CASE 
    WHEN SUM(ue.credits_consumed) > sl.included_credits THEN true
    ELSE false
  END AS has_overage,
  GREATEST(0, SUM(ue.credits_consumed) - sl.included_credits) AS overage_credits
FROM billing_subscriptions bs
JOIN subscription_limits sl ON sl.subscription_id = bs.id
LEFT JOIN usage_events ue ON ue.subscription_id = bs.id
GROUP BY bs.id, bs.tenant_id, date_trunc('month', ue.occurred_at), sl.included_credits, sl.remaining_credits;

-- Current period overage (real-time)
CREATE OR REPLACE VIEW v_current_period_usage AS
SELECT
  bs.id AS subscription_id,
  bs.tenant_id,
  bs.current_period_start,
  bs.current_period_end,
  sl.included_credits,
  sl.remaining_credits,
  sl.included_credits - sl.remaining_credits AS credits_used,
  CASE 
    WHEN sl.remaining_credits < 0 THEN ABS(sl.remaining_credits)
    ELSE 0
  END AS overage_credits,
  CASE
    WHEN sl.remaining_credits < 0 THEN 'overage'
    WHEN sl.remaining_credits < (sl.included_credits * 0.1) THEN 'warning'
    ELSE 'ok'
  END AS status
FROM billing_subscriptions bs
JOIN subscription_limits sl ON sl.subscription_id = bs.id
WHERE bs.status = 'active';
