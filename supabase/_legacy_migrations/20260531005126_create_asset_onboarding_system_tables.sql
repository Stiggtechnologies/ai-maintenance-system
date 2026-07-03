/*
  # Asset Onboarding System Tables

  1. New Tables
    - `industry_template_packs` - Industry-specific onboarding template configurations
      - `id` (uuid, PK)
      - `industry_code` (text, unique) - canonical code e.g. oil_sands, mining
      - `industry_name` (text) - human-readable name
      - `description` (text) - summary of industry focus
      - `primary_mission_objective` (text) - main operational goal
      - `common_asset_classes` (text[]) - asset classes typically found
      - `onboarding_questions` (text[]) - industry-specific onboarding questions
      - `criticality_model` (jsonb) - risk matrix, consequence categories, thresholds
      - `risk_drivers` (text[]) - key risk factors
      - `safeguards` (text[]) - required safety controls
      - `approval_gates` (text[]) - human approval requirements
      - `failure_mode_focus_areas` (text[]) - prioritized failure domains
      - `kpi_model` (jsonb) - primary/secondary KPIs and targets
      - `readiness_model` (jsonb) - readiness levels and thresholds
      - `regulatory_considerations` (text[]) - compliance frameworks
      - `data_sources_required` (text[]) - required data feeds
      - `integration_targets` (text[]) - target systems for output
      - `output_artifacts` (text[]) - deliverable documents
      - `confidence_rules` (text[]) - data validation rules
      - `blocked_automation_rules` (text[]) - what AI must not auto-approve
      - `template_version` (text) - semver version
      - `validation_status` (text) - draft, reviewed, customer_validated, deprecated
      - `created_at`, `updated_at` (timestamptz)

    - `asset_class_templates` - Asset-class-specific onboarding templates
      - `id` (uuid, PK)
      - `asset_class_code` (text, unique) - canonical code e.g. pump, turbine
      - `label` (text) - display name
      - `common_components` (text[]) - typical sub-components
      - `common_failure_modes` (text[]) - expected failure modes
      - `operating_context_questions` (text[]) - context questions
      - `condition_monitoring_methods` (text[]) - monitoring techniques
      - `pm_strategy_patterns` (text[]) - PM approach patterns
      - `critical_spares` (text[]) - essential spare parts
      - `data_required_for_reliability_baseline` (text[]) - data needs
      - `approval_gates` (text[]) - approval requirements
      - `automation_restrictions` (text[]) - blocked automation
      - `template_version` (text)
      - `validation_status` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `onboarding_template_versions` - Version history for template changes
      - `id` (uuid, PK)
      - `template_type` (text) - 'industry' or 'asset_class'
      - `template_code` (text) - industry_code or asset_class_code
      - `version` (text) - semver
      - `changes` (jsonb) - change description
      - `reviewed_by` (uuid) - user who reviewed
      - `validation_status` (text)
      - `created_at` (timestamptz)

    - `asset_onboarding_sessions` - Active onboarding sessions
      - `id` (uuid, PK)
      - `tenant_id` (uuid) - organization
      - `asset_id` (text) - asset tag
      - `asset_class` (text) - asset class code
      - `mode` (text) - quick, standard, deep, regulatory, fleet
      - `source` (text) - data source type
      - `lifecycle` (text) - lifecycle state
      - `industry` (text) - industry code
      - `status` (text) - active, completed, abandoned
      - `current_step` (text) - current onboarding step
      - `completion_score` (integer) - percentage
      - `reliability_readiness` (text) - low, medium, high, complete
      - `created_by` (uuid)
      - `created_at`, `updated_at`, `completed_at` (timestamptz)

    - `asset_onboarding_steps` - Individual step progress
      - `id` (uuid, PK)
      - `session_id` (uuid, FK to asset_onboarding_sessions)
      - `step_id` (text)
      - `step_name` (text)
      - `completion_status` (text)
      - `completion_score` (integer)
      - `confidence_score` (integer)
      - `source` (text)
      - `answer` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `asset_profiles_reliability` - Completed reliability profiles
      - `id` (uuid, PK)
      - `session_id` (uuid, FK)
      - `tenant_id` (uuid)
      - `asset_id` (text)
      - `profile_data` (jsonb) - full AssetOnboardingProfile
      - `criticality_class` (text)
      - `criticality_score` (integer)
      - `reliability_readiness` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `asset_failure_mode_libraries` - Per-asset failure mode libraries
      - `id` (uuid, PK)
      - `tenant_id` (uuid)
      - `asset_id` (text)
      - `asset_class` (text)
      - `failure_modes` (jsonb) - array of failure mode objects
      - `source` (text) - template, customer, oem, sme
      - `validation_status` (text)
      - `created_at`, `updated_at` (timestamptz)

    - `asset_maintenance_strategy_recommendations` - Generated strategy recommendations
      - `id` (uuid, PK)
      - `session_id` (uuid, FK)
      - `tenant_id` (uuid)
      - `asset_id` (text)
      - `recommendations` (jsonb)
      - `approval_status` (text) - pending, approved, rejected
      - `approved_by` (uuid)
      - `created_at`, `updated_at` (timestamptz)

    - `asset_onboarding_evidence_items` - Evidence and source documents
      - `id` (uuid, PK)
      - `session_id` (uuid, FK)
      - `step_id` (text)
      - `evidence_type` (text) - document, data_import, sme_input, oem_manual
      - `title` (text)
      - `content` (text)
      - `file_path` (text)
      - `confidence_impact` (text) - low, medium, high
      - `created_by` (uuid)
      - `created_at` (timestamptz)

    - `asset_onboarding_exports` - Generated export packages
      - `id` (uuid, PK)
      - `session_id` (uuid, FK)
      - `export_type` (text) - markdown, json, word, pdf, excel, cmms, powerbi, api
      - `content` (text)
      - `file_path` (text)
      - `created_by` (uuid)
      - `created_at` (timestamptz)

    - `recommendation_approval_workflows` - Approval tracking for recommendations
      - `id` (uuid, PK)
      - `recommendation_id` (uuid, FK to asset_maintenance_strategy_recommendations)
      - `tenant_id` (uuid)
      - `approval_type` (text) - reliability_engineer, site_engineering, safety, environmental
      - `status` (text) - pending, approved, rejected, escalated
      - `requested_by` (uuid)
      - `approved_by` (uuid)
      - `comments` (text)
      - `created_at`, `updated_at` (timestamptz)

  2. Security
    - RLS enabled on all tables
    - Authenticated users can read template packs (global reference data)
    - Session and profile data restricted to tenant membership
    - Approval workflows restricted to authorized roles

  3. Notes
    - Template packs and asset class templates are global reference data
    - Session data is tenant-isolated via organization membership
    - All tables support the offline-first architecture with sync capability
*/

-- Industry Template Packs (global reference data)
CREATE TABLE IF NOT EXISTS industry_template_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_code TEXT UNIQUE NOT NULL,
  industry_name TEXT NOT NULL,
  description TEXT,
  primary_mission_objective TEXT,
  common_asset_classes TEXT[] DEFAULT '{}',
  onboarding_questions TEXT[] DEFAULT '{}',
  criticality_model JSONB DEFAULT '{}',
  risk_drivers TEXT[] DEFAULT '{}',
  safeguards TEXT[] DEFAULT '{}',
  approval_gates TEXT[] DEFAULT '{}',
  failure_mode_focus_areas TEXT[] DEFAULT '{}',
  kpi_model JSONB DEFAULT '{}',
  readiness_model JSONB DEFAULT '{}',
  regulatory_considerations TEXT[] DEFAULT '{}',
  data_sources_required TEXT[] DEFAULT '{}',
  integration_targets TEXT[] DEFAULT '{}',
  output_artifacts TEXT[] DEFAULT '{}',
  confidence_rules TEXT[] DEFAULT '{}',
  blocked_automation_rules TEXT[] DEFAULT '{}',
  template_version TEXT DEFAULT '1.0.0',
  validation_status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE industry_template_packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read industry template packs"
  ON industry_template_packs FOR SELECT
  TO authenticated
  USING (true);

-- Asset Class Templates (global reference data)
CREATE TABLE IF NOT EXISTS asset_class_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class_code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  common_components TEXT[] DEFAULT '{}',
  common_failure_modes TEXT[] DEFAULT '{}',
  operating_context_questions TEXT[] DEFAULT '{}',
  condition_monitoring_methods TEXT[] DEFAULT '{}',
  pm_strategy_patterns TEXT[] DEFAULT '{}',
  critical_spares TEXT[] DEFAULT '{}',
  data_required_for_reliability_baseline TEXT[] DEFAULT '{}',
  approval_gates TEXT[] DEFAULT '{}',
  automation_restrictions TEXT[] DEFAULT '{}',
  template_version TEXT DEFAULT '1.0.0',
  validation_status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_class_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read asset class templates"
  ON asset_class_templates FOR SELECT
  TO authenticated
  USING (true);

-- Template Version History
CREATE TABLE IF NOT EXISTS onboarding_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT NOT NULL,
  template_code TEXT NOT NULL,
  version TEXT NOT NULL,
  changes JSONB DEFAULT '{}',
  reviewed_by UUID,
  validation_status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE onboarding_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read template versions"
  ON onboarding_template_versions FOR SELECT
  TO authenticated
  USING (true);

-- Asset Onboarding Sessions
CREATE TABLE IF NOT EXISTS asset_onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  asset_id TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard',
  source TEXT NOT NULL DEFAULT 'manual',
  lifecycle TEXT NOT NULL DEFAULT 'in_service',
  industry TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  current_step TEXT DEFAULT 'asset_identity',
  completion_score INTEGER DEFAULT 0,
  reliability_readiness TEXT DEFAULT 'low',
  readiness_message TEXT,
  missing_fields TEXT[] DEFAULT '{}',
  assumptions TEXT[] DEFAULT '{}',
  recommendations TEXT[] DEFAULT '{}',
  approval_required TEXT[] DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE asset_onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant onboarding sessions"
  ON asset_onboarding_sessions FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert onboarding sessions for own tenant"
  ON asset_onboarding_sessions FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant onboarding sessions"
  ON asset_onboarding_sessions FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Onboarding Steps
CREATE TABLE IF NOT EXISTS asset_onboarding_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES asset_onboarding_sessions(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  completion_status TEXT DEFAULT 'not_started',
  completion_score INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0,
  source TEXT DEFAULT 'generated',
  answer TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_onboarding_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read onboarding steps via session"
  ON asset_onboarding_steps FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_steps.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Users can insert onboarding steps via session"
  ON asset_onboarding_steps FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_steps.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Users can update onboarding steps via session"
  ON asset_onboarding_steps FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_steps.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_steps.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

-- Asset Reliability Profiles
CREATE TABLE IF NOT EXISTS asset_profiles_reliability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES asset_onboarding_sessions(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL,
  asset_id TEXT NOT NULL,
  asset_class TEXT,
  industry TEXT,
  profile_data JSONB DEFAULT '{}',
  criticality_class TEXT,
  criticality_score INTEGER,
  reliability_readiness TEXT DEFAULT 'low',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_profiles_reliability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant reliability profiles"
  ON asset_profiles_reliability FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert reliability profiles for own tenant"
  ON asset_profiles_reliability FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant reliability profiles"
  ON asset_profiles_reliability FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Asset Failure Mode Libraries
CREATE TABLE IF NOT EXISTS asset_failure_mode_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  asset_id TEXT NOT NULL,
  asset_class TEXT,
  failure_modes JSONB DEFAULT '[]',
  source TEXT DEFAULT 'template',
  validation_status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_failure_mode_libraries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant failure mode libraries"
  ON asset_failure_mode_libraries FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert failure mode libraries for own tenant"
  ON asset_failure_mode_libraries FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant failure mode libraries"
  ON asset_failure_mode_libraries FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Asset Maintenance Strategy Recommendations
CREATE TABLE IF NOT EXISTS asset_maintenance_strategy_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES asset_onboarding_sessions(id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL,
  asset_id TEXT NOT NULL,
  recommendations JSONB DEFAULT '[]',
  approval_status TEXT DEFAULT 'pending',
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_maintenance_strategy_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant strategy recommendations"
  ON asset_maintenance_strategy_recommendations FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert strategy recommendations for own tenant"
  ON asset_maintenance_strategy_recommendations FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant strategy recommendations"
  ON asset_maintenance_strategy_recommendations FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Asset Onboarding Evidence Items
CREATE TABLE IF NOT EXISTS asset_onboarding_evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES asset_onboarding_sessions(id) ON DELETE CASCADE,
  step_id TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'document',
  title TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  confidence_impact TEXT DEFAULT 'medium',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_onboarding_evidence_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read evidence via session"
  ON asset_onboarding_evidence_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_evidence_items.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Users can insert evidence via session"
  ON asset_onboarding_evidence_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_evidence_items.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

-- Asset Onboarding Exports
CREATE TABLE IF NOT EXISTS asset_onboarding_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES asset_onboarding_sessions(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE asset_onboarding_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read exports via session"
  ON asset_onboarding_exports FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_exports.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Users can insert exports via session"
  ON asset_onboarding_exports FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM asset_onboarding_sessions s
    WHERE s.id = asset_onboarding_exports.session_id
    AND s.tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  ));

-- Recommendation Approval Workflows
CREATE TABLE IF NOT EXISTS recommendation_approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES asset_maintenance_strategy_recommendations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  approval_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by UUID,
  approved_by UUID,
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recommendation_approval_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant approval workflows"
  ON recommendation_approval_workflows FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert approval workflows for own tenant"
  ON recommendation_approval_workflows FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant approval workflows"
  ON recommendation_approval_workflows FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_tenant ON asset_onboarding_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_asset ON asset_onboarding_sessions(asset_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status ON asset_onboarding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_session ON asset_onboarding_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_reliability_tenant ON asset_profiles_reliability(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_reliability_asset ON asset_profiles_reliability(asset_id);
CREATE INDEX IF NOT EXISTS idx_failure_mode_libs_tenant ON asset_failure_mode_libraries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_strategy_recs_tenant ON asset_maintenance_strategy_recommendations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_session ON asset_onboarding_evidence_items(session_id);
CREATE INDEX IF NOT EXISTS idx_exports_session ON asset_onboarding_exports(session_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_rec ON recommendation_approval_workflows(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_tenant ON recommendation_approval_workflows(tenant_id);