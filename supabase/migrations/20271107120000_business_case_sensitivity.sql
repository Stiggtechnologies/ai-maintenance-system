-- E9.11 — pin the business-case sensitivity calculation on the one ledger.
--
-- The authenticated calculation-service reads the tenant's business case and
-- options, runs the shared break-even kernel, and records the attempt with
-- record_calculation_run. That recorder already appends calculation_runs and
-- audit_events and already refuses a cross-tenant actor. This migration adds
-- the code-version pin that recorder requires. It creates no table, queue,
-- approval, or SAP call, and it grants no spending authority.

alter function public.sync_calculation_code_version(text)
  rename to sync_calculation_code_version_before_value_sensitivity;

create function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_key = 'business_case_sensitivity' then 'value-sensitivity/1/2026-11-03'
    else public.sync_calculation_code_version_before_value_sensitivity(p_key)
  end;
$fn$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

revoke all on function public.sync_calculation_code_version_before_value_sensitivity(text)
  from public, anon, authenticated;
grant execute on function public.sync_calculation_code_version_before_value_sensitivity(text)
  to service_role;

comment on function public.sync_calculation_code_version(text) is
  'E9.11 pins business_case_sensitivity and delegates every earlier calculation key. Advisory lineage only; no spending or approval authority.';
