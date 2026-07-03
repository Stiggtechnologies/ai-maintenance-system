/*
  # Allow system-level deployment templates without organization

  1. Modified Tables
    - `deployment_templates`
      - Make `organization_id` nullable to support global catalog templates
      - Global templates (organization_id IS NULL) are visible to all organizations

  2. Notes
    - Existing org-specific templates remain tied to their organization
    - System/catalog templates have NULL organization_id
*/

ALTER TABLE deployment_templates ALTER COLUMN organization_id DROP NOT NULL;