-- D7.15 / spec II.11 — Site Change Load Index and absorption forecast.
--
-- Pure calculation over canonical stores. The index is deliberately an
-- unweighted inventory count: each concurrent record is visible and no
-- unsupported severity weight is invented. The separate hours forecast uses
-- only work orders with declared estimates and site-specific net capacity.
-- If either side is incomplete, the forecast refuses while the inventory
-- remains useful. craft_capacity is already net of capacity_deductions, so
-- deductions are shown as provenance and never subtracted a second time.

-- The original outage and training tables were select-only/schema-only. A
-- green site-load reading over inputs no customer can populate would be a
-- demo. These two narrow human-only writers activate those canonical stores;
-- they do not create a new planning or approval model.
create or replace function public.record_site_outage_window(
  p_site_id uuid,p_window_key text,p_title text,p_kind text,
  p_starts_at timestamptz,p_ends_at timestamptz,p_scope text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id uuid;
begin
  select role into v_role from public.user_profiles
    where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('error','recording an outage window requires a human planning, supervisory or governance role');
  end if;
  if not exists(select 1 from public.sites where id=p_site_id and organization_id=v_org) then
    return jsonb_build_object('error','site not found');
  end if;
  if coalesce(length(btrim(p_window_key)),0)<2 or coalesce(length(btrim(p_title)),0)<3 then
    return jsonb_build_object('error','an outage window needs a key and title');
  end if;
  if p_kind not in ('shutdown','turnaround','opportunity','campaign') then
    return jsonb_build_object('error','outage kind must be shutdown, turnaround, opportunity or campaign');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then
    return jsonb_build_object('error','outage end must be after its start');
  end if;
  insert into public.outage_windows(organization_id,site_id,window_key,title,kind,
    starts_at,ends_at,scope,status)
  values(v_org,p_site_id,upper(btrim(p_window_key)),btrim(p_title),p_kind,
    p_starts_at,p_ends_at,nullif(btrim(p_scope),''),'planned') returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'outage_window',v_role,jsonb_build_object('outageWindowId',v_id,
    'siteId',p_site_id,'action','planned','startsAt',p_starts_at,'endsAt',p_ends_at,
    'humanRecorded',true));
  return jsonb_build_object('outageWindowId',v_id,'status','planned');
exception when unique_violation then
  return jsonb_build_object('error','that outage-window key already exists in this organization');
end;
$$;
revoke all on function public.record_site_outage_window(uuid,text,text,text,timestamptz,timestamptz,text)
  from public,anon;
grant execute on function public.record_site_outage_window(uuid,text,text,text,timestamptz,timestamptz,text)
  to authenticated;

create or replace function public.record_site_training_plan(
  p_site_id uuid,p_member_id bigint,p_competency_id bigint,p_plan_kind text,
  p_target_date date,p_driver text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text; v_id bigint;
begin
  select role into v_role from public.user_profiles
    where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','planner','supervisor') then
    return jsonb_build_object('error','recording a training plan requires a human planning, supervisory or governance role');
  end if;
  if not exists(select 1 from public.sites where id=p_site_id and organization_id=v_org) then
    return jsonb_build_object('error','site not found');
  end if;
  if not exists(select 1 from public.workforce_members where id=p_member_id
    and organization_id=v_org and site_id=p_site_id and active) then
    return jsonb_build_object('error','active workforce member not found at this site');
  end if;
  if not exists(select 1 from public.competencies where id=p_competency_id
    and organization_id=v_org) then
    return jsonb_build_object('error','competency not found');
  end if;
  if p_plan_kind not in ('apprenticeship','requalification','cross_training','succession') then
    return jsonb_build_object('error','training kind must be apprenticeship, requalification, cross training or succession');
  end if;
  if p_target_date is null or p_target_date<current_date then
    return jsonb_build_object('error','training target date must be today or later');
  end if;
  if coalesce(length(btrim(p_driver)),0)<10 then
    return jsonb_build_object('error','record at least 10 characters explaining the training driver');
  end if;
  insert into public.training_plans(organization_id,member_id,competency_id,plan_kind,
    target_date,status,driver)
  values(v_org,p_member_id,p_competency_id,p_plan_kind,p_target_date,'planned',btrim(p_driver))
  returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'training_plan',v_role,jsonb_build_object('trainingPlanId',v_id,
    'siteId',p_site_id,'memberId',p_member_id,'competencyId',p_competency_id,
    'action','planned','humanRecorded',true));
  return jsonb_build_object('trainingPlanId',v_id,'status','planned');
end;
$$;
revoke all on function public.record_site_training_plan(uuid,bigint,bigint,text,date,text)
  from public,anon;
grant execute on function public.record_site_training_plan(uuid,bigint,bigint,text,date,text)
  to authenticated;

create or replace function public.get_site_change_load(
  p_site_id uuid,
  p_horizon_weeks integer default 13,
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_as_of timestamptz:=coalesce(p_as_of,now());
  v_weeks integer:=least(greatest(coalesce(p_horizon_weeks,13),1),104);
  v_end timestamptz;
  v_result jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if not exists(select 1 from public.sites where id=p_site_id and organization_id=v_org) then
    return jsonb_build_object('error','site not found');
  end if;
  if v_as_of>now()+interval '1 minute' then
    return jsonb_build_object('error','as-of time cannot be in the future');
  end if;
  v_end:=v_as_of+make_interval(weeks=>v_weeks);

  with
  projects as (
    select count(*)::int n from public.development_cases
    where organization_id=v_org and site_id=p_site_id
      and status in ('active','on_hold','sanctioned')
      and created_at<=v_end
  ), outages as (
    select count(*)::int n from public.outage_windows
    where organization_id=v_org and site_id=p_site_id
      and status not in ('closed','cancelled')
      and starts_at<v_end and ends_at>v_as_of
  ), modifications as (
    select count(*)::int n,
      count(*) filter(where t.work_order_id is null)::int unlinked
    from public.temporary_modifications t join public.assets a
      on a.id=t.asset_id and a.organization_id=t.organization_id
    where t.organization_id=v_org and a.site_id=p_site_id
      and t.installed_at<=v_end
      and (t.removed_at is null or t.removed_at>v_as_of)
  ), training as (
    select count(*)::int n from public.training_plans t
    join public.workforce_members m on m.id=t.member_id and m.organization_id=t.organization_id
    where t.organization_id=v_org and m.site_id=p_site_id
      and t.status in ('planned','in_progress')
      and t.created_at<=v_end
      and (t.target_date is null or t.target_date<=v_end::date)
  ), released_schedules as (
    select count(distinct s.id)::int n
    from public.schedule_options s
    where s.organization_id=v_org and s.status='released'
      and s.week_start between date_trunc('week',v_as_of)::date and v_end::date
      and exists (
        select 1 from jsonb_array_elements(s.items) item
        join public.work_orders w on w.id::text=item->>'wo_id'
        where w.organization_id=v_org and w.site_id=p_site_id
      )
  ), backlog as (
    select count(*)::int n,
      count(*) filter(where estimated_hours is null or estimated_hours<=0
        or not public.sync_is_finite_numeric(estimated_hours))::int missing_estimates,
      coalesce(sum(estimated_hours) filter(where estimated_hours>0
        and public.sync_is_finite_numeric(estimated_hours)),0)::numeric load_hours
    from public.work_orders
    where organization_id=v_org and site_id=p_site_id
      and status not in ('completed','cancelled') and created_at<=v_as_of
  ), capacity_ranked as (
    select distinct on (resource_category,craft)
      resource_category,craft,weekly_hours,basis,effective_from,effective_to
    from public.craft_capacity
    where organization_id=v_org and site_id=p_site_id
      and effective_from<=v_as_of::date
      and (effective_to is null or effective_to>v_as_of::date)
    order by resource_category,craft,effective_from desc,created_at desc
  ), capacity as (
    select count(*)::int rows,
      coalesce(sum(weekly_hours),0)::numeric weekly_hours,
      coalesce(jsonb_agg(jsonb_build_object('category',resource_category,
        'pool',craft,'weeklyHours',weekly_hours,'basis',basis,
        'effectiveFrom',effective_from,'effectiveTo',effective_to)
        order by resource_category,craft),'[]'::jsonb) detail
    from capacity_ranked
  ), deductions as (
    select count(*)::int n,coalesce(sum(weekly_hours),0)::numeric hours
    from public.capacity_deductions
    where organization_id=v_org and site_id=p_site_id
      and effective_from<=v_end::date
      and (effective_to is null or effective_to>v_as_of::date)
  ), facts as (
    select p.n projects,o.n outages,m.n modifications,m.unlinked unlinked_modifications,
      t.n training_plans,s.n released_schedules,b.n backlog_work_orders,
      b.missing_estimates,b.load_hours,c.rows capacity_rows,c.weekly_hours,
      c.detail capacity_detail,d.n deduction_rows,d.hours deduction_hours,
      (p.n+o.n+m.n+t.n+s.n+b.n+d.n)::int change_load_index
    from projects p,outages o,modifications m,training t,released_schedules s,
      backlog b,capacity c,deductions d
  )
  select jsonb_build_object(
    'siteId',p_site_id,'asOf',v_as_of,'horizonWeeks',v_weeks,'horizonEnd',v_end,
    'changeLoadIndex',f.change_load_index,
    'indexKind','unweighted_concurrent_record_count',
    'dimensions',jsonb_build_object(
      'activeProjects',f.projects,'outageWindows',f.outages,
      'temporaryModifications',f.modifications,'activeTrainingPlans',f.training_plans,
      'releasedScheduleOptions',f.released_schedules,
      'maintenanceBacklog',f.backlog_work_orders,'capacityDeductions',f.deduction_rows),
    'forecastComputable',f.capacity_rows>0 and f.missing_estimates=0,
    'forecastState',case
      when f.capacity_rows=0 then 'not_computable_no_site_capacity'
      when f.missing_estimates>0 then 'not_computable_missing_work_estimates'
      when f.load_hours>f.weekly_hours*v_weeks then 'quantified_work_exceeds_horizon_capacity'
      else 'quantified_work_within_horizon_capacity' end,
    'quantifiedLoadHours',round(f.load_hours,2),
    'netWeeklyCapacityHours',round(f.weekly_hours,2),
    'horizonCapacityHours',round(f.weekly_hours*v_weeks,2),
    'horizonUtilizationPct',case when f.capacity_rows>0 and f.missing_estimates=0
      then round((100*f.load_hours/(f.weekly_hours*v_weeks))::numeric,2) else null end,
    'weeksToAbsorb',case when f.capacity_rows>0 and f.missing_estimates=0
      then round((f.load_hours/f.weekly_hours)::numeric,2) else null end,
    'evidenceGaps',jsonb_strip_nulls(jsonb_build_object(
      'workOrdersWithoutPositiveEstimate',case when f.missing_estimates>0 then f.missing_estimates end,
      'temporaryModificationsWithoutWorkOrder',case when f.unlinked_modifications>0 then f.unlinked_modifications end,
      'siteCapacityMissing',case when f.capacity_rows=0 then true end)),
    'capacity',f.capacity_detail,
    'capacityDeductionContext',jsonb_build_object('rows',f.deduction_rows,
      'weeklyHoursRecorded',round(f.deduction_hours,2),
      'treatment','context only; craft_capacity is already net and deductions are not subtracted twice'),
    'basis','Unweighted concurrent records across canonical project, outage, modification, training, schedule, maintenance and capacity-deduction stores. The absorption forecast compares only declared backlog hours with site-specific net capacity; it refuses over missing inputs.',
    'decisionBoundary','Decision support only. The index does not authorize work, approve change, rank individuals, or assert that unlike records have equal severity.'
  ) into v_result from facts f;
  return v_result;
end;
$$;

revoke all on function public.get_site_change_load(uuid,integer,timestamptz)
  from public,anon;
grant execute on function public.get_site_change_load(uuid,integer,timestamptz)
  to authenticated;

comment on function public.get_site_change_load(uuid,integer,timestamptz) is
  'D7.15: tenant-scoped site change-load inventory and evidence-gated absorption forecast over canonical stores; no load persistence.';
