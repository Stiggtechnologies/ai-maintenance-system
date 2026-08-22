-- Recovery completion cannot ask a technician to prove quality if the product
-- does not expose the exact adopted job-plan checks. This read model returns
-- identifiers, acceptance criteria and hold-point status; it does not create a
-- second quality store.

create or replace function public.get_recovery_quality_checks(p_event_work_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
stable
as $$
declare
  v_org uuid:=public.app_current_org();
  v_plan uuid;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select w.job_plan_id into v_plan
  from restoration_event_work ew
  join work_orders w on w.id=ew.work_order_id and w.organization_id=v_org
  where ew.id=p_event_work_id and ew.organization_id=v_org;
  if not found then return jsonb_build_object('error','event work not found'); end if;
  return jsonb_build_object(
    'job_plan_id',v_plan,
    'checks',case when v_plan is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'check_description',c.check_description,
        'acceptance_criterion',c.acceptance_criterion,
        'is_hold_point',c.is_hold_point)
        order by c.is_hold_point desc,c.check_description)
      from job_plan_checks c
      where c.organization_id=v_org and c.job_plan_id=v_plan
    ),'[]'::jsonb) end,
    'note',case when v_plan is null
      then 'No adopted job plan is attached to this work order, so there are no governed job-plan acceptance checks to attest.'
      else 'Every returned check must be explicitly passed before Recovery can complete the work order.' end);
end $$;

revoke all on function public.get_recovery_quality_checks(uuid) from public,anon;
grant execute on function public.get_recovery_quality_checks(uuid) to authenticated;

notify pgrst,'reload schema';