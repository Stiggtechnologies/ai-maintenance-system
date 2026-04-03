/*
  # Fix handle_new_user function for user signup

  1. Changes
    - Recreates the handle_new_user() trigger function with proper search_path
    - Adds SET search_path = '' for security compliance
    - Uses fully qualified table names (public.user_profiles, public.organizations)
    - Makes the function more robust with better error handling

  2. Security
    - Function runs as SECURITY DEFINER with restricted search_path
    - Prevents search_path injection attacks
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  default_org_id UUID;
BEGIN
  -- Get the default organization ID
  SELECT id INTO default_org_id
  FROM public.organizations
  WHERE slug = 'default'
  LIMIT 1;

  -- If no default org exists, create one
  IF default_org_id IS NULL THEN
    INSERT INTO public.organizations (name, slug, status, created_at, updated_at)
    VALUES ('Default Organization', 'default', 'active', NOW(), NOW())
    RETURNING id INTO default_org_id;
  END IF;

  -- Insert the user profile
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    organization_id,
    status,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    default_org_id,
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't block user creation
    RAISE WARNING 'handle_new_user failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Also fix current_user_org_id function
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  org_id UUID;
BEGIN
  SELECT organization_id INTO org_id
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;

  RETURN org_id;
END;
$$;
