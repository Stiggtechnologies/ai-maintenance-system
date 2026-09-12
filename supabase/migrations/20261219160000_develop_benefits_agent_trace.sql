-- D12.16 — Benefits Agent traceability extension.
--
-- Canonical reuse only: value_metrics + the shipped benefits/leakage read.
-- This adds record identifiers to the existing response so an advisory agent
-- can cite the exact forecast and verified-actual checkpoints behind every
-- number. It creates no agent store, approval path, value calculation, or
-- alternate tenant read.

create or replace function public.get_case_benefits_screen(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v_org uuid:=app_current_org(); v_rows jsonb; v_leakage jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from development_cases where id=p_case_id and organization_id=v_org) then
    return jsonb_build_object('error','development case not found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'expected',b.value,
    'unit',b.unit,'expectedDate',b.expected_date,'ownerId',b.owner_id,
    'owner',coalesce(o.full_name,o.email),'basis',b.basis,
    'currentForecast',f.observed_value,'forecastStatus',case when f.id is null then 'missing' else f.status end,
    'forecastMetricId',f.id,
    'actual',a.observed_value,'actualHorizonDays',a.checkpoint_horizon_days,
    'actualMetricId',a.id,
    'variance',case when a.observed_value is null then null else a.observed_value-b.value end)
    order by b.expected_date,b.label),'[]'::jsonb) into v_rows
  from value_metrics b join user_profiles o on o.id=b.owner_id and o.organization_id=v_org
  left join lateral (select x.id,x.observed_value,x.status from value_metrics x
    where x.organization_id=v_org and x.development_case_id=p_case_id
      and x.parent_metric_id=b.id and x.observed_value is not null
    order by x.checkpoint_horizon_days desc,x.observed_at desc limit 1) f on true
  left join lateral (select x.id,x.observed_value,x.checkpoint_horizon_days from value_metrics x
    where x.organization_id=v_org and x.development_case_id=p_case_id
      and x.parent_metric_id=b.id and x.status='verified' and x.observed_value is not null
    order by x.checkpoint_horizon_days desc,x.verified_at desc limit 1) a on true
  where b.organization_id=v_org and b.development_case_id=p_case_id
    and b.metric_type='projected_annualized_value' and b.checkpoint_horizon_days is null;
  v_leakage:=get_case_value_leakage(p_case_id);
  return jsonb_build_object('caseId',p_case_id,'benefits',v_rows,'valueLeakage',v_leakage,
    'basis','Expected is the recorded benefit; forecast is the latest observed checkpoint; actual is the latest human-verified checkpoint. Every value carries its value_metrics record identifier. Missing remains missing.');
end $$;

revoke all on function public.get_case_benefits_screen(uuid) from public,anon;
grant execute on function public.get_case_benefits_screen(uuid) to authenticated,service_role;

comment on function public.get_case_benefits_screen(uuid) is
  'D13.12 + D12.16: per-benefit expected, observed forecast, human-verified actual and variance with exact value_metrics identifiers; composed with governed value leakage for advisory agent consumption.';
