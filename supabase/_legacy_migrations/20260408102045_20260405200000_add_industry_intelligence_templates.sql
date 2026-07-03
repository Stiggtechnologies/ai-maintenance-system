-- SyncAI Industry Intelligence Templates
-- Full template = KPI Pack + OEE Model + Asset Library + Criticality Model + Governance Defaults + Work Taxonomy + Failure Mode Library + Deployment Defaults

BEGIN;

-- ============================================
-- 1. KPI Packs — industry-specific KPI sets
-- ============================================
CREATE TABLE IF NOT EXISTS kpi_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_code TEXT NOT NULL UNIQUE,
  pack_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  kpi_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kpi_pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES kpi_packs(id) ON DELETE CASCADE,
  kpi_code TEXT NOT NULL,
  kpi_name TEXT NOT NULL,
  kpi_type TEXT NOT NULL CHECK (kpi_type IN ('KOI', 'KPI')),
  category TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('executive', 'strategic', 'tactical', 'operational')),
  unit TEXT NOT NULL DEFAULT '%',
  direction TEXT NOT NULL DEFAULT 'higher_better' CHECK (direction IN ('higher_better', 'lower_better', 'target_range')),
  formula_description TEXT,
  default_target NUMERIC,
  default_green_threshold NUMERIC,
  default_yellow_threshold NUMERIC,
  default_red_threshold NUMERIC,
  frequency TEXT DEFAULT 'monthly',
  is_oee_component BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(pack_id, kpi_code)
);

-- ============================================
-- 2. Asset Libraries — industry-specific asset class hierarchies
-- ============================================
CREATE TABLE IF NOT EXISTS industry_asset_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_code TEXT NOT NULL UNIQUE,
  library_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  asset_class_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS industry_asset_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES industry_asset_libraries(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL,
  class_name TEXT NOT NULL,
  parent_class_code TEXT,
  description TEXT,
  default_criticality TEXT DEFAULT 'medium' CHECK (default_criticality IN ('critical', 'high', 'medium', 'low')),
  typical_lifespan_years INTEGER,
  recommended_pm_frequency_days INTEGER,
  typical_sensors TEXT[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  UNIQUE(library_id, class_code)
);

-- ============================================
-- 3. Criticality Profiles — industry-specific scoring weights
-- ============================================
CREATE TABLE IF NOT EXISTS industry_criticality_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  -- Scoring weights (must sum to 100)
  safety_weight NUMERIC NOT NULL DEFAULT 25,
  environmental_weight NUMERIC NOT NULL DEFAULT 15,
  production_weight NUMERIC NOT NULL DEFAULT 25,
  quality_weight NUMERIC NOT NULL DEFAULT 10,
  cost_weight NUMERIC NOT NULL DEFAULT 10,
  regulatory_weight NUMERIC NOT NULL DEFAULT 10,
  reputation_weight NUMERIC NOT NULL DEFAULT 5,
  -- Band thresholds
  band_a_min NUMERIC NOT NULL DEFAULT 80,
  band_b_min NUMERIC NOT NULL DEFAULT 60,
  band_c_min NUMERIC NOT NULL DEFAULT 40,
  -- Band descriptions
  band_a_label TEXT DEFAULT 'Critical — Immediate attention required',
  band_b_label TEXT DEFAULT 'High — Scheduled priority maintenance',
  band_c_label TEXT DEFAULT 'Medium — Standard maintenance program',
  band_d_label TEXT DEFAULT 'Low — Run to failure acceptable',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. Governance Profiles — industry-specific governance defaults
-- ============================================
CREATE TABLE IF NOT EXISTS industry_governance_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  default_autonomy_mode TEXT NOT NULL DEFAULT 'conditional' CHECK (default_autonomy_mode IN ('advisory', 'conditional', 'controlled_autonomy')),
  -- Approval thresholds
  auto_approve_confidence_min NUMERIC DEFAULT 90,
  require_approval_cost_threshold_cad NUMERIC DEFAULT 10000,
  require_engineering_review_criticality TEXT DEFAULT 'critical',
  -- Audit
  audit_retention_years INTEGER DEFAULT 7,
  -- Compliance frameworks
  compliance_frameworks TEXT[] DEFAULT '{}',
  -- Emergency response
  emergency_response_time_minutes INTEGER DEFAULT 30,
  -- Escalation
  escalation_levels JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 5. Work Taxonomies — industry-specific work types and SLAs
-- ============================================
CREATE TABLE IF NOT EXISTS industry_work_taxonomies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_code TEXT NOT NULL UNIQUE,
  taxonomy_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  work_type_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS industry_work_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_id UUID NOT NULL REFERENCES industry_work_taxonomies(id) ON DELETE CASCADE,
  type_code TEXT NOT NULL,
  type_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('preventive', 'corrective', 'predictive', 'project', 'safety', 'regulatory', 'shutdown', 'inspection')),
  description TEXT,
  default_priority TEXT DEFAULT 'medium',
  default_sla_hours INTEGER,
  requires_permit BOOLEAN DEFAULT false,
  required_skills TEXT[] DEFAULT '{}',
  estimated_hours_typical NUMERIC,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(taxonomy_id, type_code)
);

-- ============================================
-- 6. Failure Mode Packs — industry-specific FMEA-lite libraries
-- ============================================
CREATE TABLE IF NOT EXISTS industry_failure_mode_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_code TEXT NOT NULL UNIQUE,
  pack_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  failure_mode_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS industry_failure_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES industry_failure_mode_packs(id) ON DELETE CASCADE,
  mode_code TEXT NOT NULL,
  mode_name TEXT NOT NULL,
  applicable_asset_classes TEXT[] DEFAULT '{}',
  category TEXT NOT NULL CHECK (category IN ('mechanical', 'electrical', 'instrumentation', 'process', 'structural', 'environmental', 'human')),
  -- FMEA scores (1-10)
  typical_severity INTEGER DEFAULT 5 CHECK (typical_severity BETWEEN 1 AND 10),
  typical_occurrence INTEGER DEFAULT 5 CHECK (typical_occurrence BETWEEN 1 AND 10),
  typical_detection INTEGER DEFAULT 5 CHECK (typical_detection BETWEEN 1 AND 10),
  -- Computed RPN
  typical_rpn INTEGER GENERATED ALWAYS AS (typical_severity * typical_occurrence * typical_detection) STORED,
  -- Patterns
  symptoms TEXT[] DEFAULT '{}',
  root_causes TEXT[] DEFAULT '{}',
  recommended_actions TEXT[] DEFAULT '{}',
  prevention_strategies TEXT[] DEFAULT '{}',
  -- Impact
  safety_impact TEXT DEFAULT 'none' CHECK (safety_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  environmental_impact TEXT DEFAULT 'none' CHECK (environmental_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  production_impact TEXT DEFAULT 'none' CHECK (production_impact IN ('none', 'low', 'medium', 'high', 'critical')),
  sort_order INTEGER DEFAULT 0,
  UNIQUE(pack_id, mode_code)
);

-- ============================================
-- 7. OEE Model Configurations — industry-specific OEE variations
-- ============================================
CREATE TABLE IF NOT EXISTS industry_oee_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_code TEXT NOT NULL UNIQUE,
  model_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  description TEXT,
  -- OEE weighting (for industry-adjusted OEE)
  availability_weight NUMERIC NOT NULL DEFAULT 33.33,
  performance_weight NUMERIC NOT NULL DEFAULT 33.33,
  quality_weight NUMERIC NOT NULL DEFAULT 33.34,
  -- Target baselines
  target_oee NUMERIC DEFAULT 85,
  target_availability NUMERIC DEFAULT 90,
  target_performance NUMERIC DEFAULT 95,
  target_quality NUMERIC DEFAULT 99,
  -- Industry context
  primary_loss_focus TEXT DEFAULT 'availability' CHECK (primary_loss_focus IN ('availability', 'performance', 'quality')),
  seasonal_adjustment BOOLEAN DEFAULT false,
  shift_based BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 8. Upgrade deployment_templates to link to all packs
-- ============================================
ALTER TABLE deployment_templates
  ADD COLUMN IF NOT EXISTS kpi_pack_id UUID REFERENCES kpi_packs(id),
  ADD COLUMN IF NOT EXISTS asset_library_id UUID REFERENCES industry_asset_libraries(id),
  ADD COLUMN IF NOT EXISTS criticality_profile_id UUID REFERENCES industry_criticality_profiles(id),
  ADD COLUMN IF NOT EXISTS governance_profile_id UUID REFERENCES industry_governance_profiles(id),
  ADD COLUMN IF NOT EXISTS work_taxonomy_id UUID REFERENCES industry_work_taxonomies(id),
  ADD COLUMN IF NOT EXISTS failure_mode_pack_id UUID REFERENCES industry_failure_mode_packs(id),
  ADD COLUMN IF NOT EXISTS oee_model_id UUID REFERENCES industry_oee_models(id);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_kpi_pack_items_pack ON kpi_pack_items(pack_id);
CREATE INDEX IF NOT EXISTS idx_industry_asset_classes_library ON industry_asset_classes(library_id);
CREATE INDEX IF NOT EXISTS idx_industry_work_types_taxonomy ON industry_work_types(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_industry_failure_modes_pack ON industry_failure_modes(pack_id);

-- ============================================
-- RLS (accessible to all authenticated users for reading, admin for writing)
-- ============================================
ALTER TABLE kpi_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_asset_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_asset_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_criticality_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_governance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_work_taxonomies ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_failure_mode_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_failure_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_oee_models ENABLE ROW LEVEL SECURITY;

-- Read access for all authenticated users
DO $$ BEGIN
  CREATE POLICY "kpi_packs_read" ON kpi_packs FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "kpi_pack_items_read" ON kpi_pack_items FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_asset_libraries_read" ON industry_asset_libraries FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_asset_classes_read" ON industry_asset_classes FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_criticality_profiles_read" ON industry_criticality_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_governance_profiles_read" ON industry_governance_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_work_taxonomies_read" ON industry_work_taxonomies FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_work_types_read" ON industry_work_types FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_failure_mode_packs_read" ON industry_failure_mode_packs FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_failure_modes_read" ON industry_failure_modes FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "industry_oee_models_read" ON industry_oee_models FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;