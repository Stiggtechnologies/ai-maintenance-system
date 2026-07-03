BEGIN;

CREATE TABLE IF NOT EXISTS template_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  site_id UUID,
  template_code TEXT NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN (
    'kpi_pack', 'asset_library', 'criticality_profile', 'governance_profile',
    'work_taxonomy', 'failure_mode_pack', 'oee_model', 'deployment_defaults'
  )),
  override_payload JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_overrides_org ON template_overrides(organization_id);
CREATE INDEX IF NOT EXISTS idx_template_overrides_template ON template_overrides(template_code);

ALTER TABLE template_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "template_overrides_org" ON template_overrides
    FOR ALL USING (organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;