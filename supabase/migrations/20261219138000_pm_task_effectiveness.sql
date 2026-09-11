-- C6.25 / C8.07 — type-aware closeout and direct PM outcomes.

create table if not exists public.pm_task_outcomes(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade unique,
  target_mechanism_id uuid not null references public.damage_mechanisms(id),
  finding_outcome text not null check(finding_outcome in ('no_finding','degradation_found','defect_found')),
  finding_detail text not null check(length(btrim(finding_detail))>=10),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index if not exists idx_pm_task_outcomes_org_mechanism
  on public.pm_task_outcomes(organization_id,target_mechanism_id,recorded_at desc);
alter table public.pm_task_outcomes enable row level security;
drop policy if exists pm_task_outcomes_read on public.pm_task_outcomes;
create policy pm_task_outcomes_read on public.pm_task_outcomes
  for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.pm_task_outcomes from anon,authenticated;
grant select on public.pm_task_outcomes to authenticated;

-- The original closeout assumes every work order is a failure and can force a
-- technician to invent failure/cause/action data for preventive work. Keep it
-- as the internal corrective implementation but remove it from client access.
revoke all on function public.close_work_order(uuid,text,text,text,numeric,numeric,text,text,boolean)
  from public,anon,authenticated;

create or replace function public.close_work_order_v2(p_work_order_id uuid,p_closeout jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; w public.work_orders%rowtype;
  v_labour numeric; v_downtime numeric; v_note text; v_mechanism uuid; v_mechanism_key text; v_result jsonb;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role not in ('technician','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','work-order closeout requires a maintenance or engineering role');
  end if;
  select * into w from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  if w.status='completed' then return jsonb_build_object('error','already_closed'); end if;
  begin
    v_labour:=(p_closeout->>'laborHours')::numeric;
    v_downtime:=(p_closeout->>'downtimeHours')::numeric;
  exception when others then return jsonb_build_object('error','invalid_hours'); end;
  if v_labour is null or v_labour<0 or v_downtime is null or v_downtime<0 then
    return jsonb_build_object('error','invalid_hours');
  end if;
  v_note:=btrim(coalesce(p_closeout->>'technicianComments',''));

  if w.work_type='corrective' then
    v_result:=public.close_work_order(w.id,p_closeout->>'actualFailureMode',
      p_closeout->>'actualCause',p_closeout->>'correctiveAction',v_labour,v_downtime,
      nullif(btrim(p_closeout->>'partsUsed'),''),nullif(v_note,''),
      nullif(p_closeout->>'aiAlertUseful','')::boolean);
    if v_result ? 'error' then return v_result; end if;
    update public.work_orders set completed_at=coalesce(completed_at,now()),updated_at=now() where id=w.id;
    return v_result||jsonb_build_object('workOrder',w.title,'closeoutType','corrective');
  elsif w.work_type='preventive' then
    if coalesce(nullif(p_closeout->>'findingOutcome',''),'') not in ('no_finding','degradation_found','defect_found') then
      return jsonb_build_object('error','pm_finding_outcome_required');
    end if;
    if coalesce(length(btrim(p_closeout->>'findingDetail')),0)<10 then
      return jsonb_build_object('error','pm_finding_detail_required');
    end if;
    select dm.id,dm.mechanism_key into v_mechanism,v_mechanism_key
    from public.job_plans jp join public.damage_mechanisms dm
      on dm.id=jp.applies_to_mechanism_id and dm.organization_id=jp.organization_id
    where jp.id=w.job_plan_id and jp.organization_id=v_org and jp.status='adopted';
    if v_mechanism is null then
      return jsonb_build_object('error','pm_prospective_target_not_configured');
    end if;
    update public.work_orders set status='completed',actual_hours=v_labour,labor_hours=v_labour,
      downtime_hours=v_downtime,parts_used=nullif(btrim(p_closeout->>'partsUsed'),''),
      technician_comments=nullif(v_note,''),ai_alert_useful=nullif(p_closeout->>'aiAlertUseful','')::boolean,
      completed_at=now(),closed_at=now(),updated_at=now() where id=w.id;
    insert into public.pm_task_outcomes(organization_id,work_order_id,target_mechanism_id,
      finding_outcome,finding_detail,recorded_by)
    values(v_org,w.id,v_mechanism,p_closeout->>'findingOutcome',btrim(p_closeout->>'findingDetail'),auth.uid());
    insert into public.learning_events(organization_id,asset_id,recommendation_id,event_type,title,detail)
    values(v_org,w.asset_id,w.recommendation_id,'work_completed','PM outcome — '||w.title,
      format('Target mechanism %s; outcome %s; evidence: %s. Labour %s h; downtime %s h. Recorded by %s.',
        v_mechanism_key,p_closeout->>'findingOutcome',btrim(p_closeout->>'findingDetail'),
        v_labour,v_downtime,auth.uid()));
    return jsonb_build_object('closed',true,'workOrder',w.title,'closeoutType','preventive');
  else
    if length(v_note)<10 then return jsonb_build_object('error','completion_note_required'); end if;
    update public.work_orders set status='completed',actual_hours=v_labour,labor_hours=v_labour,
      downtime_hours=v_downtime,parts_used=nullif(btrim(p_closeout->>'partsUsed'),''),
      technician_comments=v_note,completed_at=now(),closed_at=now(),updated_at=now() where id=w.id;
    insert into public.learning_events(organization_id,asset_id,recommendation_id,event_type,title,detail)
    values(v_org,w.asset_id,w.recommendation_id,'work_completed','Completed — '||w.title,
      format('%s Labour %s h; downtime %s h. Recorded by %s.',v_note,v_labour,v_downtime,auth.uid()));
    return jsonb_build_object('closed',true,'workOrder',w.title,'closeoutType','general');
  end if;
end;
$$;
revoke all on function public.close_work_order_v2(uuid,jsonb) from public,anon;
grant execute on function public.close_work_order_v2(uuid,jsonb) to authenticated;

create or replace function public.get_pm_closeout_options(p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_target jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select jsonb_build_object('mechanismKey',dm.mechanism_key,'name',dm.name,'jobPlanId',jp.id,
    'jobPlanKey',jp.plan_key,'jobPlanVersion',jp.version)
  into v_target
  from public.work_orders w join public.job_plans jp
    on jp.id=w.job_plan_id and jp.organization_id=w.organization_id and jp.status='adopted'
  join public.damage_mechanisms dm
    on dm.id=jp.applies_to_mechanism_id and dm.organization_id=jp.organization_id
  where w.id=p_work_order_id and w.organization_id=v_org and w.work_type='preventive';
  return jsonb_build_object('targetMechanism',v_target,
    'basis','The PM target is fixed prospectively by the adopted job plan linked to this work order; it cannot be selected or changed at closeout.');
end;
$$;
revoke all on function public.get_pm_closeout_options(uuid) from public,anon;
grant execute on function public.get_pm_closeout_options(uuid) to authenticated;

create or replace function public.get_pm_task_effectiveness(p_observation_days int default 30)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_days int:=least(greatest(coalesce(p_observation_days,30),7),180); v jsonb;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  with outcomes as (
    select o.*,w.asset_id,w.completed_at,dm.mechanism_key,dm.name mechanism_name,
      exists(select 1 from public.work_orders f where f.organization_id=v_org
        and f.asset_id=w.asset_id and f.work_type='corrective'
        and f.failure_mechanism_id=o.target_mechanism_id
        and f.mechanism_coded_by is not null and f.mechanism_coded_at is not null
        and coalesce(length(btrim(f.mechanism_note)),0)>=10
        and f.created_at>w.completed_at
        and f.created_at<=w.completed_at+make_interval(days=>v_days)) as post_pm_failure
    from public.pm_task_outcomes o join public.work_orders w
      on w.id=o.work_order_id and w.organization_id=o.organization_id
    join public.damage_mechanisms dm on dm.id=o.target_mechanism_id and dm.organization_id=o.organization_id
    where o.organization_id=v_org and w.completed_at is not null
  ), measured as (
    select *,now()>=completed_at+make_interval(days=>v_days) or post_pm_failure as mature from outcomes
  ), totals as (
    select count(*)::int recorded,
      count(*) filter(where finding_outcome<>'no_finding')::int findings,
      count(*) filter(where mature)::int mature,
      count(*) filter(where mature and post_pm_failure)::int failures,
      count(*) filter(where mature and finding_outcome='no_finding')::int mature_no_findings,
      count(*) filter(where mature and finding_outcome='no_finding' and post_pm_failure)::int misses
    from measured
  ) select jsonb_build_object(
    'available',recorded>0,'observationDays',v_days,'recordedOutcomes',recorded,
    'matureOutcomes',mature,'findingRatePct',case when recorded>0 then round(100.0*findings/recorded,1) end,
    'postPmFailureRatePct',case when mature>0 then round(100.0*failures/mature,1) end,
    'falseReassuranceRatePct',case when mature_no_findings>0 then round(100.0*misses/mature_no_findings,1) end,
    'basis',format('Finding rate uses direct human PM outcomes. The recurrence signal is corrective work raised for the same human-coded mechanism on the same asset within %s days; work-order created_at is a detection/recording timestamp, not a claimed failure-occurrence timestamp. Open observation windows stay out of recurrence-rate denominators.',v_days)
  ) into v from totals;
  return v;
end;
$$;
revoke all on function public.get_pm_task_effectiveness(int) from public,anon;
grant execute on function public.get_pm_task_effectiveness(int) to authenticated;
notify pgrst,'reload schema';
