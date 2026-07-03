/*
  # Enable RLS on deployment_templates with catalog read access

  1. Security
    - Enable RLS on `deployment_templates`
    - Add policy for authenticated users to read all templates
    - Add policy for authenticated users to manage their org's templates

  2. Notes
    - Global catalog templates (organization_id IS NULL) are readable by all authenticated users
    - Org-specific templates are readable by members of that organization
*/

ALTER TABLE deployment_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read all templates"
  ON deployment_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Org members can insert templates"
  ON deployment_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND organization_id = (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Org members can update own templates"
  ON deployment_templates
  FOR UPDATE
  TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));