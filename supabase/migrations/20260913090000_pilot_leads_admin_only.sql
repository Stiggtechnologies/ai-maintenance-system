-- ============================================================================
-- Pilot leads — admin-only visibility (sell-readiness fix).
--
-- 20260520030000_pilot_intake_requests.sql shipped both lead tables with a
-- SELECT policy of `for select to authenticated using (true)` — so EVERY
-- authenticated user (any customer/tenant login, any role) could read every
-- sales lead's name, work email, and company. That is lead PII exposed far
-- beyond the people who handle it. The audit framed this as "invisible even to
-- admins"; the deployed reality is the opposite and worse — visible to all.
--
-- Postgres combines permissive policies with OR, so simply ADDING an admin
-- policy would leave the `using (true)` policy in force and change nothing.
-- The fix therefore DROPS the permissive read and REPLACES it with the same
-- admin/ai_admin role test used by security_events_admin_read
-- (00000000000018_security_events.sql). These lead tables carry no
-- organization_id — leads arrive from anonymous website visitors and are not
-- tenant-scoped — so the org predicate from that policy does not apply; the
-- portable, canonical part is the role membership check.
--
-- The anon INSERT path is untouched: submit_pilot_intake_request /
-- create_pilot_onboarding_package remain SECURITY DEFINER with their
-- anon+authenticated EXECUTE grants, so the public pilot form keeps working.
-- Nothing here weakens that path or exposes leads to any non-admin role.
-- ============================================================================

-- --- pilot_intake_requests -------------------------------------------------
-- Remove the permissive read shipped by the original migration.
drop policy if exists "Authenticated users can read pilot intake requests"
  on public.pilot_intake_requests;

-- Admins (and ai_admin) may read leads; every other authenticated role sees
-- zero rows. Same role test as security_events_admin_read, minus the
-- organization scope these global lead rows do not have.
drop policy if exists pilot_intake_requests_admin_read
  on public.pilot_intake_requests;
create policy pilot_intake_requests_admin_read on public.pilot_intake_requests
  for select to authenticated
  using (
    exists (
      select 1 from user_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'ai_admin')
    )
  );

-- --- pilot_onboarding_packages ---------------------------------------------
-- Same lead data (company, asset scope, primary pain derived from the intake)
-- and the same over-broad read — give it the same admin-only treatment.
drop policy if exists "Authenticated users can read pilot onboarding packages"
  on public.pilot_onboarding_packages;

drop policy if exists pilot_onboarding_packages_admin_read
  on public.pilot_onboarding_packages;
create policy pilot_onboarding_packages_admin_read on public.pilot_onboarding_packages
  for select to authenticated
  using (
    exists (
      select 1 from user_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'ai_admin')
    )
  );
