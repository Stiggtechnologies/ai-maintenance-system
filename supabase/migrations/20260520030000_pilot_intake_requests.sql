CREATE TABLE IF NOT EXISTS public.pilot_intake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  industry TEXT,
  asset_scope TEXT NOT NULL,
  system_of_record TEXT,
  history_available TEXT,
  primary_pain TEXT NOT NULL,
  data_readiness TEXT NOT NULL,
  security_need TEXT NOT NULL,
  commercial_model TEXT NOT NULL DEFAULT '48-hour value proof first',
  notes TEXT,
  notification_status TEXT NOT NULL DEFAULT 'queued',
  notified_at TIMESTAMPTZ,
  source_path TEXT NOT NULL DEFAULT '/pilot/reliability'
);

ALTER TABLE public.pilot_intake_requests ENABLE ROW LEVEL SECURITY;

-- Drop guard so the chain can be replayed; 20260913090000 later
-- replaces this with an admin-only read.
DROP POLICY IF EXISTS "Authenticated users can read pilot intake requests" ON public.pilot_intake_requests;
CREATE POLICY "Authenticated users can read pilot intake requests"
  ON public.pilot_intake_requests
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_pilot_intake_requests_created_at
  ON public.pilot_intake_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_intake_requests_status
  ON public.pilot_intake_requests (status);

CREATE INDEX IF NOT EXISTS idx_pilot_intake_requests_notification_status
  ON public.pilot_intake_requests (notification_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pilot_onboarding_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_request_id UUID REFERENCES public.pilot_intake_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'generated',
  company TEXT NOT NULL,
  asset_scope TEXT NOT NULL,
  system_of_record TEXT,
  primary_pain TEXT NOT NULL,
  data_readiness TEXT NOT NULL,
  security_need TEXT NOT NULL,
  commercial_model TEXT NOT NULL,
  package_items TEXT[] NOT NULL DEFAULT '{}',
  source_path TEXT NOT NULL DEFAULT '/pilot/reliability'
);

ALTER TABLE public.pilot_onboarding_packages ENABLE ROW LEVEL SECURITY;

-- Drop guard so the chain can be replayed; 20260913090000 later
-- replaces this with an admin-only read.
DROP POLICY IF EXISTS "Authenticated users can read pilot onboarding packages" ON public.pilot_onboarding_packages;
CREATE POLICY "Authenticated users can read pilot onboarding packages"
  ON public.pilot_onboarding_packages
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_pilot_onboarding_packages_created_at
  ON public.pilot_onboarding_packages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_onboarding_packages_intake_request
  ON public.pilot_onboarding_packages (intake_request_id);

CREATE OR REPLACE FUNCTION public.submit_pilot_intake_request(request JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id UUID;
  clean_email TEXT := lower(trim(request->>'email'));
BEGIN
  IF length(trim(coalesce(request->>'name', ''))) < 2 THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF clean_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Valid work email is required';
  END IF;

  IF length(trim(coalesce(request->>'company', ''))) < 2 THEN
    RAISE EXCEPTION 'Company is required';
  END IF;

  IF length(trim(coalesce(request->>'asset_scope', ''))) < 2 THEN
    RAISE EXCEPTION 'Asset or system scope is required';
  END IF;

  IF length(trim(coalesce(request->>'primary_pain', ''))) < 2 THEN
    RAISE EXCEPTION 'Primary reliability pain is required';
  END IF;

  INSERT INTO public.pilot_intake_requests (
    name,
    email,
    company,
    role,
    industry,
    asset_scope,
    system_of_record,
    history_available,
    primary_pain,
    data_readiness,
    security_need,
    commercial_model,
    notes,
    notification_status,
    source_path
  )
  VALUES (
    left(trim(request->>'name'), 160),
    left(clean_email, 254),
    left(trim(request->>'company'), 180),
    left(trim(coalesce(request->>'role', '')), 120),
    left(trim(coalesce(request->>'industry', '')), 120),
    left(trim(request->>'asset_scope'), 240),
    left(trim(coalesce(request->>'system_of_record', '')), 140),
    left(trim(coalesce(request->>'history_available', '')), 180),
    left(trim(request->>'primary_pain'), 240),
    left(trim(coalesce(request->>'data_readiness', 'Sanitized export can be shared')), 160),
    left(trim(coalesce(request->>'security_need', 'NDA not required for first proof')), 160),
    left(trim(coalesce(request->>'commercial_model', '48-hour value proof first')), 160),
    left(trim(coalesce(request->>'notes', '')), 3000),
    'queued',
    left(trim(coalesce(request->>'source_path', '/pilot/reliability')), 240)
  )
  RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_pilot_onboarding_package(request JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  package_id UUID;
  maybe_intake_id UUID;
BEGIN
  IF nullif(request->>'intake_request_id', '') IS NOT NULL THEN
    maybe_intake_id := (request->>'intake_request_id')::UUID;
  END IF;

  IF length(trim(coalesce(request->>'company', ''))) < 2 THEN
    RAISE EXCEPTION 'Company is required';
  END IF;

  IF length(trim(coalesce(request->>'asset_scope', ''))) < 2 THEN
    RAISE EXCEPTION 'Asset or system scope is required';
  END IF;

  INSERT INTO public.pilot_onboarding_packages (
    intake_request_id,
    company,
    asset_scope,
    system_of_record,
    primary_pain,
    data_readiness,
    security_need,
    commercial_model,
    package_items,
    status,
    source_path
  )
  VALUES (
    maybe_intake_id,
    left(trim(request->>'company'), 180),
    left(trim(request->>'asset_scope'), 240),
    left(trim(coalesce(request->>'system_of_record', '')), 140),
    left(trim(coalesce(request->>'primary_pain', '')), 240),
    left(trim(coalesce(request->>'data_readiness', 'Sanitized export can be shared')), 160),
    left(trim(coalesce(request->>'security_need', 'NDA not required for first proof')), 160),
    left(trim(coalesce(request->>'commercial_model', '48-hour value proof first')), 160),
    ARRAY[
      'workspace_shell',
      'data_request_checklist',
      'role_invites',
      'governance_gates',
      'first_analysis_queue',
      'commercial_path'
    ],
    'generated',
    left(trim(coalesce(request->>'source_path', '/pilot/reliability')), 240)
  )
  RETURNING id INTO package_id;

  RETURN package_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pilot_intake_request(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_pilot_onboarding_package(JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_pilot_intake_request(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pilot_onboarding_package(JSONB) TO anon, authenticated;
