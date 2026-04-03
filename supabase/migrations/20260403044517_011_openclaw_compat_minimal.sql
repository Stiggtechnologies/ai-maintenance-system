/*
  # OpenClaw Compatibility - Minimal

  1. User Profile Extensions
    - Add onboarding tracking columns

  2. Onboarding View
    - Track user progress

  3. Permissions
    - Grant view access
*/

-- Extend User Profiles for Onboarding
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_progress JSONB DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER DEFAULT 0;

-- Simple Onboarding Progress View
CREATE OR REPLACE VIEW onboarding_status AS
SELECT 
    up.id as user_id,
    up.onboarding_completed,
    up.onboarding_progress,
    up.onboarding_current_step,
    COUNT(DISTINCT a.id)::int as total_assets,
    COUNT(DISTINCT wo.id)::int as total_work_orders
FROM user_profiles up
LEFT JOIN assets a ON a.organization_id = up.organization_id
LEFT JOIN work_orders wo ON wo.organization_id = up.organization_id
GROUP BY up.id, up.onboarding_completed, up.onboarding_progress, up.onboarding_current_step;

-- Grant View Access
GRANT SELECT ON user_kpi_dashboard TO authenticated;
GRANT SELECT ON asset_criticality_summary TO authenticated;
GRANT SELECT ON work_order_summary TO authenticated;
GRANT SELECT ON onboarding_status TO authenticated;