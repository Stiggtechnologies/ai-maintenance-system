-- ============================================================================
-- Approval authority contract.
--
-- Establishes one database-owned role predicate for approval and bounded
-- execution workflows. This migration does not yet change existing table
-- policies; it creates the authoritative contract and test surface used by the
-- canonical orchestrator and subsequent RLS hardening.
-- ============================================================================

create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(role, ''))
  from public.user_profiles
  where id = auth.uid()
$$;

create or replace function public.app_role_has_approval_authority(p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_role, '')) = any(array[
    'admin',
    'manager',
    'maintenance_manager',
    'plant_manager',
    'operations_manager',
    'reliability_engineer'
  ]::text[])
$$;

create or replace function public.app_has_approval_authority()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role_has_approval_authority(public.app_current_role())
$$;

-- Internal services may resolve authority for the already authenticated actor.
-- This is deliberately not exposed to ordinary authenticated clients because
-- they must not supply another user's identity to an authorization decision.
create or replace function public.app_user_has_approval_authority(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role_has_approval_authority(
    (select role from public.user_profiles where id = p_user_id)
  )
$$;

revoke all on function public.app_current_role() from public, anon;
revoke all on function public.app_role_has_approval_authority(text) from public, anon;
revoke all on function public.app_has_approval_authority() from public, anon;
revoke all on function public.app_user_has_approval_authority(uuid) from public, anon, authenticated;

grant execute on function public.app_current_role() to authenticated;
grant execute on function public.app_role_has_approval_authority(text) to authenticated, service_role;
grant execute on function public.app_has_approval_authority() to authenticated;
grant execute on function public.app_user_has_approval_authority(uuid) to service_role;
