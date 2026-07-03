/*
  # Add template catalog columns to deployment_templates

  1. Modified Tables
    - `deployment_templates`
      - `slug` (text, unique) - URL-safe identifier for template
      - `is_active` (boolean, default true) - whether template is available
      - `description` (text) - human-readable description
      - `master_family` (text) - industry family grouping (Heavy Industrial, Process, etc.)
      - `master_template_name` (text) - name of parent master template

  2. Notes
    - These columns support the template catalog UI
    - slug is used for URL routing in the deployment configurator
    - master_family enables industry-based filtering in the setup wizard
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_templates' AND column_name = 'slug'
  ) THEN
    ALTER TABLE deployment_templates ADD COLUMN slug TEXT UNIQUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_templates' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE deployment_templates ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_templates' AND column_name = 'description'
  ) THEN
    ALTER TABLE deployment_templates ADD COLUMN description TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_templates' AND column_name = 'master_family'
  ) THEN
    ALTER TABLE deployment_templates ADD COLUMN master_family TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_templates' AND column_name = 'master_template_name'
  ) THEN
    ALTER TABLE deployment_templates ADD COLUMN master_template_name TEXT;
  END IF;
END $$;