-- Master Template → Derived Template System
-- Enables template inheritance: master templates + industry overlays

BEGIN;

-- Extend deployment_templates with inheritance support
ALTER TABLE deployment_templates
  ADD COLUMN IF NOT EXISTS parent_template_code TEXT,
  ADD COLUMN IF NOT EXISTS template_type TEXT DEFAULT 'derived' CHECK (template_type IN ('master', 'derived')),
  ADD COLUMN IF NOT EXISTS overlay_config JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inherits_from_master BOOLEAN DEFAULT false;

COMMIT;
