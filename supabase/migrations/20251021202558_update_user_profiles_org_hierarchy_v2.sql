/*
  # Update User Profiles for Organizational Hierarchy - V2

  ## Changes
  1. Drop policies that depend on role column
  2. Add organizational level assignment to user profiles
  3. Add organizational unit assignment
  4. Recreate policies with new role structure
  
  ## Security
  - Temporarily drop role-dependent policies
  - Add back with text-based role check
*/

-- Drop policies that depend on role column
DROP POLICY IF EXISTS "Managers can approve decisions" ON autonomous_decisions;
DROP POLICY IF EXISTS "Managers can update workflows" ON approval_workflows;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

-- Add new columns for organizational hierarchy
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS org_level_id uuid REFERENCES organizational_levels(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES organizational_units(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS competency_level text CHECK (competency_level IN ('novice', 'competent', 'proficient', 'expert', 'master'));
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS certifications text[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS kpi_access_level text DEFAULT 'standard' CHECK (kpi_access_level IN ('limited', 'standard', 'full', 'admin'));

-- Update existing users with default org levels based on role
UPDATE user_profiles up
SET org_level_id = ol.id
FROM organizational_levels ol
WHERE up.org_level_id IS NULL
AND (
  (up.role IN ('admin') AND ol.level_code = 'EXECUTIVE') OR
  (up.role IN ('manager') AND ol.level_code = 'TACTICAL') OR
  (up.role IN ('operator') AND ol.level_code = 'OPERATIONAL') OR
  (up.role IN ('viewer') AND ol.level_code = 'FIELD')
);

-- Recreate user_profiles policies
CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Recreate autonomous_decisions policies with text-based role
CREATE POLICY "Managers can approve decisions"
  ON autonomous_decisions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Recreate approval_workflows policies
CREATE POLICY "Managers can update workflows"
  ON approval_workflows FOR UPDATE
  TO authenticated
  USING (
    approver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    approver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
    )
  );

-- Function to get user's accessible KPIs based on org level
CREATE OR REPLACE FUNCTION get_user_accessible_kpis(user_id_param uuid)
RETURNS TABLE (
  kpi_id uuid,
  kpi_code text,
  kpi_name text,
  category_name text,
  access_type text
) AS $$
DECLARE
  user_level_code text;
  user_level_order int;
BEGIN
  SELECT ol.level_code, ol.level_order 
  INTO user_level_code, user_level_order
  FROM user_profiles up
  JOIN organizational_levels ol ON up.org_level_id = ol.id
  WHERE up.id = user_id_param;

  RETURN QUERY
  SELECT DISTINCT
    k.id,
    k.kpi_code,
    k.kpi_name,
    cat.category_name,
    CASE
      WHEN k.responsible_level IN (
        SELECT id FROM organizational_levels WHERE level_order >= user_level_order
      ) THEN 'responsible'
      WHEN k.accountable_level IN (
        SELECT id FROM organizational_levels WHERE level_order >= user_level_order  
      ) THEN 'accountable'
      ELSE 'view'
    END as access_type
  FROM kpis_kois k
  JOIN kpi_categories cat ON k.category_id = cat.id
  WHERE k.active = true
  AND (
    k.responsible_level IN (SELECT id FROM organizational_levels WHERE level_order >= user_level_order)
    OR k.accountable_level IN (SELECT id FROM organizational_levels WHERE level_order >= user_level_order)
    OR user_level_order <= 2
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for user dashboard access
CREATE OR REPLACE VIEW user_kpi_dashboard AS
SELECT 
  up.id as user_id,
  up.email,
  up.full_name,
  up.role,
  ol.level_name as org_level,
  ol.level_code,
  ou.unit_name as org_unit,
  k.id as kpi_id,
  k.kpi_code,
  k.kpi_name,
  k.kpi_type,
  cat.category_name,
  m.actual_value as latest_value,
  m.target_value,
  m.status,
  m.trend,
  m.measurement_date as last_updated
FROM user_profiles up
JOIN organizational_levels ol ON up.org_level_id = ol.id
LEFT JOIN organizational_units ou ON up.org_unit_id = ou.id
CROSS JOIN kpis_kois k
JOIN kpi_categories cat ON k.category_id = cat.id
LEFT JOIN LATERAL (
  SELECT actual_value, target_value, status, trend, measurement_date
  FROM kpi_measurements
  WHERE kpi_id = k.id
  AND (org_unit_id = up.org_unit_id OR org_unit_id IS NULL)
  ORDER BY measurement_date DESC
  LIMIT 1
) m ON true
WHERE k.active = true
AND (
  k.responsible_level = up.org_level_id
  OR k.accountable_level = up.org_level_id
  OR ol.level_order <= 2
);

GRANT SELECT ON user_kpi_dashboard TO authenticated;
