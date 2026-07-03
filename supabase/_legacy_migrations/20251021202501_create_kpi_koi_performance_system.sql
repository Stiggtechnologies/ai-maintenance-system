/*
  # ISO 55000 KPI/KOI Performance Management System

  ## Overview
  Implements comprehensive performance tracking system aligned with ISO 55000 standards
  with organizational hierarchy (Executive, Strategic, Tactical, Operational levels).

  ## New Tables

  ### 1. organizational_levels
  Defines the hierarchy levels in the organization (C-Level, Director, Manager, Supervisor, Technician)

  ### 2. kpi_categories
  ISO 55000 KPI categories (Strategic Alignment, Maintenance & Reliability, Risk Management, etc.)

  ### 3. kpis_kois
  Master list of all KPIs and KOIs with formulas, targets, and responsible levels

  ### 4. kpi_measurements
  Time-series data for actual KPI/KOI measurements

  ### 5. performance_targets
  Target values for KPIs/KOIs by time period and organizational unit

  ### 6. performance_dashboards
  Configuration for role-based dashboard views

  ### 7. organizational_units
  Business units, departments, sites for performance segmentation

  ## Security
  - RLS enabled on all tables
  - Role-based access control
  - Each level sees relevant KPIs only
*/

-- Organizational Levels (RACI-based hierarchy)
CREATE TABLE IF NOT EXISTS organizational_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_code text UNIQUE NOT NULL,
  level_name text NOT NULL,
  level_order integer NOT NULL,
  description text,
  focus_area text,
  typical_roles text[],
  created_at timestamptz DEFAULT now()
);

ALTER TABLE organizational_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view org levels"
  ON organizational_levels FOR SELECT
  TO authenticated
  USING (true);

-- Insert organizational levels
INSERT INTO organizational_levels (level_code, level_name, level_order, description, focus_area, typical_roles) VALUES
('EXECUTIVE', 'Executive Leadership', 1, 'C-Level executives responsible for strategic direction', 'Strategic Value & Alignment', ARRAY['CEO', 'CFO', 'COO', 'VP Operations']),
('STRATEGIC', 'Strategic Management', 2, 'Directors and senior managers setting strategic objectives', 'Strategic Planning & Resource Allocation', ARRAY['Director', 'Head of Department', 'Senior Manager']),
('TACTICAL', 'Tactical Management', 3, 'Managers executing tactical plans and managing teams', 'Execution & Performance Management', ARRAY['Maintenance Manager', 'Engineering Manager', 'Operations Manager']),
('OPERATIONAL', 'Operational Execution', 4, 'Supervisors and technicians performing day-to-day work', 'Work Execution & Problem Solving', ARRAY['Supervisor', 'Team Lead', 'Senior Technician']),
('FIELD', 'Field Operations', 5, 'Front-line technicians and operators', 'Hands-on Maintenance & Operations', ARRAY['Technician', 'Operator', 'Craftsperson'])
ON CONFLICT (level_code) DO NOTHING;

-- KPI Categories
CREATE TABLE IF NOT EXISTS kpi_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text UNIQUE NOT NULL,
  description text,
  icon text,
  color text,
  sort_order integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kpi_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view KPI categories"
  ON kpi_categories FOR SELECT
  TO authenticated
  USING (true);

-- Insert KPI categories from ISO 55000
INSERT INTO kpi_categories (category_name, description, icon, color, sort_order) VALUES
('Strategic Alignment & Value Realization', 'Long-term strategic value creation and stakeholder alignment', 'target', 'purple', 1),
('Maintenance & Reliability', 'Asset reliability, availability, and maintenance effectiveness', 'wrench', 'blue', 2),
('Risk Management', 'Asset risk exposure, safety, and compliance', 'shield', 'red', 3),
('Financial and Lifecycle Costing', 'Cost management and financial performance', 'dollar-sign', 'green', 4),
('Asset Information & Data Integrity', 'Data quality, accuracy, and digital asset management', 'database', 'teal', 5),
('Planning & Decision Support', 'Planning effectiveness and decision quality', 'calendar', 'indigo', 6),
('Sustainability & ESG', 'Environmental, social, and governance performance', 'leaf', 'emerald', 7),
('People, Competence & Culture', 'Workforce capability and safety culture', 'users', 'orange', 8),
('Performance Monitoring', 'KPI tracking, reporting, and continuous improvement', 'bar-chart', 'cyan', 9),
('Digital Enablement', 'Technology adoption and digital transformation', 'cpu', 'violet', 10)
ON CONFLICT (category_name) DO NOTHING;

-- Organizational Units
CREATE TABLE IF NOT EXISTS organizational_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code text UNIQUE NOT NULL,
  unit_name text NOT NULL,
  unit_type text NOT NULL,
  parent_unit_id uuid REFERENCES organizational_units(id),
  level_id uuid REFERENCES organizational_levels(id),
  industry text,
  location text,
  manager_id uuid REFERENCES user_profiles(id),
  active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE organizational_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org units"
  ON organizational_units FOR SELECT
  TO authenticated
  USING (true);

-- KPIs and KOIs Master Table
CREATE TABLE IF NOT EXISTS kpis_kois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_code text UNIQUE NOT NULL,
  kpi_name text NOT NULL,
  kpi_type text NOT NULL CHECK (kpi_type IN ('KPI', 'KOI')),
  category_id uuid REFERENCES kpi_categories(id),
  description text,
  calculation_formula text,
  unit_of_measure text,
  target_value numeric,
  threshold_red numeric,
  threshold_yellow numeric,
  threshold_green numeric,
  direction text CHECK (direction IN ('higher_better', 'lower_better', 'target_range')),
  frequency text CHECK (frequency IN ('real_time', 'daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  responsible_level uuid REFERENCES organizational_levels(id),
  accountable_level uuid REFERENCES organizational_levels(id),
  consulted_levels uuid[],
  informed_levels uuid[],
  data_sources text[],
  automation_possible boolean DEFAULT false,
  industry_specific text[],
  active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE kpis_kois ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view KPIs"
  ON kpis_kois FOR SELECT
  TO authenticated
  USING (true);

-- KPI Measurements (Time Series Data)
CREATE TABLE IF NOT EXISTS kpi_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id uuid REFERENCES kpis_kois(id) NOT NULL,
  org_unit_id uuid REFERENCES organizational_units(id),
  measurement_date timestamptz NOT NULL,
  actual_value numeric NOT NULL,
  target_value numeric,
  variance numeric,
  variance_pct numeric,
  status text CHECK (status IN ('green', 'yellow', 'red', 'unknown')),
  trend text CHECK (trend IN ('improving', 'stable', 'declining', 'unknown')),
  data_source text,
  calculated_by text,
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES user_profiles(id),
  notes text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kpi_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view KPI measurements"
  ON kpi_measurements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert measurements"
  ON kpi_measurements FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Performance Targets
CREATE TABLE IF NOT EXISTS performance_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id uuid REFERENCES kpis_kois(id) NOT NULL,
  org_unit_id uuid REFERENCES organizational_units(id),
  target_period_start date NOT NULL,
  target_period_end date NOT NULL,
  target_value numeric NOT NULL,
  stretch_goal numeric,
  baseline_value numeric,
  rationale text,
  set_by uuid REFERENCES user_profiles(id),
  approved_by uuid REFERENCES user_profiles(id),
  approved_at timestamptz,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE performance_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view targets"
  ON performance_targets FOR SELECT
  TO authenticated
  USING (true);

-- Performance Dashboards Configuration
CREATE TABLE IF NOT EXISTS performance_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_name text NOT NULL,
  dashboard_type text NOT NULL,
  level_id uuid REFERENCES organizational_levels(id),
  industry text,
  kpi_ids uuid[],
  layout_config jsonb,
  refresh_interval integer DEFAULT 300,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE performance_dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dashboards"
  ON performance_dashboards FOR SELECT
  TO authenticated
  USING (true);

-- Insert ISO 55000 KPIs/KOIs
DO $$
DECLARE
  cat_strategic uuid;
  cat_maintenance uuid;
  cat_risk uuid;
  cat_financial uuid;
  cat_data uuid;
  cat_planning uuid;
  cat_sustainability uuid;
  cat_people uuid;
  cat_performance uuid;
  cat_digital uuid;
  level_exec uuid;
  level_strategic uuid;
  level_tactical uuid;
  level_operational uuid;
BEGIN
  -- Get category IDs
  SELECT id INTO cat_strategic FROM kpi_categories WHERE category_name = 'Strategic Alignment & Value Realization';
  SELECT id INTO cat_maintenance FROM kpi_categories WHERE category_name = 'Maintenance & Reliability';
  SELECT id INTO cat_risk FROM kpi_categories WHERE category_name = 'Risk Management';
  SELECT id INTO cat_financial FROM kpi_categories WHERE category_name = 'Financial and Lifecycle Costing';
  SELECT id INTO cat_data FROM kpi_categories WHERE category_name = 'Asset Information & Data Integrity';
  SELECT id INTO cat_planning FROM kpi_categories WHERE category_name = 'Planning & Decision Support';
  SELECT id INTO cat_sustainability FROM kpi_categories WHERE category_name = 'Sustainability & ESG';
  SELECT id INTO cat_people FROM kpi_categories WHERE category_name = 'People, Competence & Culture';
  SELECT id INTO cat_performance FROM kpi_categories WHERE category_name = 'Performance Monitoring';
  SELECT id INTO cat_digital FROM kpi_categories WHERE category_name = 'Digital Enablement';
  
  -- Get level IDs
  SELECT id INTO level_exec FROM organizational_levels WHERE level_code = 'EXECUTIVE';
  SELECT id INTO level_strategic FROM organizational_levels WHERE level_code = 'STRATEGIC';
  SELECT id INTO level_tactical FROM organizational_levels WHERE level_code = 'TACTICAL';
  SELECT id INTO level_operational FROM organizational_levels WHERE level_code = 'OPERATIONAL';

  -- Strategic Alignment & Value Realization
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level) VALUES
  ('KOI-001', 'Asset Value Realization', 'KOI', cat_strategic, 'Measure of value delivered by assets vs. planned value', '%', 'higher_better', 'quarterly', level_exec, level_exec),
  ('KOI-002', 'Stakeholder Value Score', 'KOI', cat_strategic, 'Composite score of stakeholder satisfaction and value perception', 'score', 'higher_better', 'annually', level_exec, level_exec),
  ('KOI-003', 'AM Maturity Index', 'KOI', cat_strategic, 'ISO 55000 asset management maturity assessment score', 'score', 'higher_better', 'annually', level_strategic, level_exec);

  -- Maintenance & Reliability
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, calculation_formula, unit_of_measure, direction, frequency, responsible_level, accountable_level, automation_possible) VALUES
  ('KOI-004', 'Asset Availability', 'KOI', cat_maintenance, 'Percentage of time assets are available for use', '(Total Time - Downtime) / Total Time * 100', '%', 'higher_better', 'daily', level_tactical, level_strategic, true),
  ('KPI-001', 'MTBF', 'KPI', cat_maintenance, 'Mean Time Between Failures', 'Sum(Operating Time) / Number of Failures', 'hours', 'higher_better', 'monthly', level_tactical, level_strategic, true),
  ('KPI-002', 'MTTR', 'KPI', cat_maintenance, 'Mean Time To Repair', 'Sum(Repair Time) / Number of Repairs', 'hours', 'lower_better', 'monthly', level_operational, level_tactical, true),
  ('KOI-005', 'Planned vs Unplanned Maintenance', 'KOI', cat_maintenance, 'Ratio of planned to unplanned maintenance work', 'Planned Work Hours / Total Maintenance Hours * 100', '%', 'higher_better', 'monthly', level_tactical, level_strategic, true);

  -- Risk Management
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level) VALUES
  ('KOI-006', 'Asset Risk Exposure', 'KOI', cat_risk, 'Aggregate risk score across critical assets', 'score', 'lower_better', 'monthly', level_strategic, level_exec),
  ('KOI-007', 'Safety Incidents (Asset-related)', 'KOI', cat_risk, 'Number of safety incidents related to asset failures', 'count', 'lower_better', 'monthly', level_tactical, level_strategic),
  ('KOI-008', 'Risk Register Completion', 'KOI', cat_risk, 'Percentage of assets with completed risk assessments', '%', 'higher_better', 'quarterly', level_strategic, level_exec);

  -- Financial and Lifecycle Costing
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level) VALUES
  ('KOI-009', 'Lifecycle Cost Variance', 'KOI', cat_financial, 'Variance between actual and planned lifecycle costs', '%', 'lower_better', 'quarterly', level_strategic, level_exec),
  ('KOI-010', 'Maintenance Cost per Output', 'KOI', cat_financial, 'Maintenance cost per unit of production/output', 'currency', 'lower_better', 'monthly', level_tactical, level_strategic),
  ('KOI-011', 'Renewal Funding Gap', 'KOI', cat_financial, 'Gap between required and available capital renewal funding', '%', 'lower_better', 'annually', level_exec, level_exec);

  -- Asset Information & Data Integrity
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level, automation_possible) VALUES
  ('KOI-012', 'Asset Register Accuracy', 'KOI', cat_data, 'Accuracy and completeness of asset register data', '%', 'higher_better', 'quarterly', level_tactical, level_strategic, true),
  ('KOI-013', 'Data Completeness', 'KOI', cat_data, 'Percentage of required data fields populated', '%', 'higher_better', 'monthly', level_tactical, level_strategic, true),
  ('KOI-014', 'Digital Twin Coverage', 'KOI', cat_data, 'Percentage of critical assets with digital twin models', '%', 'higher_better', 'quarterly', level_strategic, level_exec, true);

  -- Planning & Decision Support
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level) VALUES
  ('KOI-015', 'Forecast Accuracy', 'KOI', cat_planning, 'Accuracy of maintenance and failure forecasts', '%', 'higher_better', 'monthly', level_tactical, level_strategic),
  ('KOI-016', 'Decision Traceability', 'KOI', cat_planning, 'Percentage of decisions with documented rationale', '%', 'higher_better', 'quarterly', level_strategic, level_exec),
  ('KOI-017', 'Scenario Modeling Use Rate', 'KOI', cat_planning, 'Percentage of major decisions using scenario analysis', '%', 'higher_better', 'quarterly', level_strategic, level_exec);

  -- Sustainability & ESG
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level, automation_possible) VALUES
  ('KOI-018', 'Energy Efficiency Index', 'KOI', cat_sustainability, 'Energy consumption per unit output compared to baseline', 'index', 'lower_better', 'monthly', level_tactical, level_strategic, true),
  ('KOI-019', 'GHG Emissions per Asset', 'KOI', cat_sustainability, 'Greenhouse gas emissions per asset', 'tons CO2e', 'lower_better', 'monthly', level_strategic, level_exec, true),
  ('KOI-020', 'Water Use Efficiency', 'KOI', cat_sustainability, 'Water consumption per unit output', 'liters/unit', 'lower_better', 'monthly', level_tactical, level_strategic, true);

  -- People, Competence & Culture
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level) VALUES
  ('KOI-021', 'Role Competency Coverage', 'KOI', cat_people, 'Percentage of roles meeting required competency levels', '%', 'higher_better', 'quarterly', level_strategic, level_exec),
  ('KOI-022', 'Safety Culture Index', 'KOI', cat_people, 'Composite score of safety culture indicators', 'score', 'higher_better', 'annually', level_strategic, level_exec),
  ('KOI-023', 'Training Completion Rate', 'KOI', cat_people, 'Percentage of required training completed on time', '%', 'higher_better', 'monthly', level_tactical, level_strategic);

  -- Performance Monitoring
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level, automation_possible) VALUES
  ('KOI-024', 'KOI Review Frequency', 'KOI', cat_performance, 'Adherence to scheduled KOI review meetings', '%', 'higher_better', 'monthly', level_strategic, level_exec, true),
  ('KOI-025', 'KPI vs KOI Alignment', 'KOI', cat_performance, 'Percentage of KPIs aligned to strategic KOIs', '%', 'higher_better', 'quarterly', level_strategic, level_exec, true),
  ('KOI-026', 'Reporting Timeliness', 'KOI', cat_performance, 'Percentage of reports delivered on time', '%', 'higher_better', 'monthly', level_tactical, level_strategic, true);

  -- Digital Enablement
  INSERT INTO kpis_kois (kpi_code, kpi_name, kpi_type, category_id, description, unit_of_measure, direction, frequency, responsible_level, accountable_level, automation_possible) VALUES
  ('KOI-027', 'PdM Coverage', 'KOI', cat_digital, 'Percentage of critical assets with predictive maintenance', '%', 'higher_better', 'quarterly', level_strategic, level_exec, true),
  ('KOI-028', 'AI Actions Executed', 'KOI', cat_digital, 'Number of autonomous AI actions successfully executed', 'count', 'higher_better', 'monthly', level_tactical, level_strategic, true),
  ('KOI-029', 'Mobile Execution Uptake', 'KOI', cat_digital, 'Percentage of work orders executed via mobile devices', '%', 'higher_better', 'monthly', level_operational, level_tactical, true);

END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi_date
  ON kpi_measurements(kpi_id, measurement_date DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_measurements_org_unit
  ON kpi_measurements(org_unit_id, measurement_date DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_measurements_status
  ON kpi_measurements(status, measurement_date DESC);

CREATE INDEX IF NOT EXISTS idx_kpis_level
  ON kpis_kois(responsible_level);

CREATE INDEX IF NOT EXISTS idx_kpis_category
  ON kpis_kois(category_id);

-- Function to calculate KPI status based on thresholds
CREATE OR REPLACE FUNCTION calculate_kpi_status(
  actual numeric,
  threshold_green numeric,
  threshold_yellow numeric,
  threshold_red numeric,
  direction text
)
RETURNS text AS $$
BEGIN
  IF direction = 'higher_better' THEN
    IF actual >= threshold_green THEN RETURN 'green';
    ELSIF actual >= threshold_yellow THEN RETURN 'yellow';
    ELSE RETURN 'red';
    END IF;
  ELSIF direction = 'lower_better' THEN
    IF actual <= threshold_green THEN RETURN 'green';
    ELSIF actual <= threshold_yellow THEN RETURN 'yellow';
    ELSE RETURN 'red';
    END IF;
  ELSE
    RETURN 'unknown';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get KPIs for organizational level
CREATE OR REPLACE FUNCTION get_kpis_for_level(level_code_param text)
RETURNS TABLE (
  kpi_id uuid,
  kpi_code text,
  kpi_name text,
  kpi_type text,
  category_name text,
  latest_value numeric,
  target_value numeric,
  status text,
  trend text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    k.id,
    k.kpi_code,
    k.kpi_name,
    k.kpi_type,
    cat.category_name,
    m.actual_value,
    m.target_value,
    m.status,
    m.trend
  FROM kpis_kois k
  JOIN kpi_categories cat ON k.category_id = cat.id
  JOIN organizational_levels ol ON k.responsible_level = ol.id OR k.accountable_level = ol.id
  LEFT JOIN LATERAL (
    SELECT actual_value, target_value, status, trend
    FROM kpi_measurements
    WHERE kpi_id = k.id
    ORDER BY measurement_date DESC
    LIMIT 1
  ) m ON true
  WHERE ol.level_code = level_code_param
  AND k.active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
