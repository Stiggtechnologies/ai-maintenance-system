/*
  # Add deployment configurator columns to deployment_instances

  1. Modified Tables
    - `deployment_instances`
      - `site_id` (uuid, nullable) - reference to the site being deployed to
      - `site_name` (text, nullable) - site name for display or new sites
      - `operating_region` (text, nullable) - geographic operating region
      - `timezone` (text, default 'UTC') - site timezone
      - `asset_range` (text, nullable) - approximate asset count range
      - `site_count` (integer, default 1) - number of sites in deployment
      - `operating_model` (text, nullable) - shift pattern (24/7, day, mixed)
      - `primary_cmms` (text, nullable) - connected CMMS system
      - `autonomy_mode` (text, nullable) - AI autonomy level
      - `approval_strictness` (text, nullable) - governance approval tier
      - `audit_retention` (text, nullable) - data retention period
      - `industry_code` (text, nullable) - industry from setup wizard
      - `use_case` (text, nullable) - primary operational objective
      - `created_by` (uuid, nullable) - user who created the deployment

  2. Notes
    - All columns are nullable to avoid breaking existing rows
    - These columns support the Setup Wizard -> Template -> Deploy flow
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN site_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'site_name'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN site_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'operating_region'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN operating_region TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'timezone'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN timezone TEXT DEFAULT 'UTC';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'asset_range'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN asset_range TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'site_count'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN site_count INTEGER DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'operating_model'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN operating_model TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'primary_cmms'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN primary_cmms TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'autonomy_mode'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN autonomy_mode TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'approval_strictness'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN approval_strictness TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'audit_retention'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN audit_retention TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'industry_code'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN industry_code TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'use_case'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN use_case TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployment_instances' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE deployment_instances ADD COLUMN created_by UUID;
  END IF;
END $$;