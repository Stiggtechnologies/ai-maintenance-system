-- 20270105161400 replaced sync_calculation_code_version with the modelling-studio
-- map. That replacement removed the component_covariate_survival pin installed
-- by 20270104090900. record_calculation_run then refuses the governed survival
-- fit because no code version is pinned. Restore the pin and keep the
-- modelling-studio map underneath it.

alter function public.sync_calculation_code_version(text)
  rename to sync_calculation_code_version_before_survival_pin;

create function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_key = 'component_covariate_survival' then 'cox-efron/1/draft'
    else public.sync_calculation_code_version_before_survival_pin(p_key)
  end;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

revoke all on function public.sync_calculation_code_version_before_survival_pin(text)
  from public, anon, authenticated;
grant execute on function public.sync_calculation_code_version_before_survival_pin(text)
  to service_role;
