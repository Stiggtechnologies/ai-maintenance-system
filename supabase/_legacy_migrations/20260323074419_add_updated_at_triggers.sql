/*
  # Add Automatic updated_at Triggers

  1. Purpose
    - Automatically update updated_at timestamps on row modifications
    - Ensures data consistency without manual updates
    - Applies to all tables with updated_at column

  2. Implementation
    - Create reusable trigger function
    - Apply to all relevant tables

  3. Tables Affected
    - All tables with updated_at column (30+ tables)
*/

-- Create trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at column
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
      AND table_name NOT LIKE 'pg_%'
      AND table_name NOT LIKE '_pg_%'
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS set_updated_at ON %I;
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION public.handle_updated_at();
    ', t, t);
  END LOOP;
END $$;