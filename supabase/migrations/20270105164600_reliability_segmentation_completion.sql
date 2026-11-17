-- Complete C6.26 on the canonical reliability history.
--
-- A true failure-mechanism axis already exists, but the product did not expose
-- it.  Operating-regime segmentation additionally needs the time the failure
-- was observed; work-order completion time is not a defensible substitute.
-- This migration extends the governed human coding receipt with that timestamp
-- and joins it to the existing exact-time operating-state history.

alter table public.work_orders
  add column if not exists failure_observed_at timestamptz;

alter table public.failure_mechanism_coding_events
  add column if not exists failure_observed_at timestamptz;

-- Receipts are append-only through the governed definer. The service role is
-- not a second mutation path; database owners retain break-glass authority.
revoke insert,update,delete,truncate on public.failure_mechanism_coding_events
  from anon,authenticated,service_role;

comment on column public.work_orders.failure_observed_at is
  'Human-recorded time the coded failure was observed. It is not inferred from work-order creation, completion, or downtime.';

-- Preserve the established direct-write guard while adding the observed-time
-- fact to the protected provenance tuple.
create or replace function public.protect_failure_mechanism_provenance()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if current_user = 'postgres' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' then
    if new.failure_mechanism_id is not null or new.mechanism_coded_by is not null
       or new.mechanism_coded_at is not null or new.mechanism_note is not null
       or new.failure_observed_at is not null then
      raise exception 'failure mechanism provenance changes require code_failure_mechanism()';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.failure_mechanism_id is not null then
      raise exception 'governed coded failure history cannot be deleted directly';
    end if;
    return old;
  end if;
  if (new.failure_mechanism_id,new.mechanism_coded_by,new.mechanism_coded_at,
      new.mechanism_note,new.failure_observed_at,new.asset_id,new.work_type,new.completed_at)
       is distinct from
     (old.failure_mechanism_id,old.mechanism_coded_by,old.mechanism_coded_at,
      old.mechanism_note,old.failure_observed_at,old.asset_id,old.work_type,old.completed_at)
     and (old.failure_mechanism_id is not null or new.failure_mechanism_id is not null
       or old.failure_observed_at is not null or new.failure_observed_at is not null) then
    raise exception 'governed failure history changes require the approved closeout or coding function';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_failure_mechanism_provenance()
  from public,anon,authenticated,service_role;

-- Retire the older client-callable signature: a mechanism without an observed
-- time cannot support an operating-regime claim.
revoke all on function public.code_failure_mechanism(uuid,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.code_failure_mechanism(
  p_work_order_id uuid,
  p_mechanism_key text,
  p_note text,
  p_failure_observed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_mech uuid;
  w public.work_orders%rowtype;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role not in
    ('reliability_engineer','maintenance_manager','technician','admin') then
    return jsonb_build_object(
      'error','coding a failure mechanism requires a maintenance or engineering role');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object(
      'error','a coding evidence note of at least 10 characters is required');
  end if;
  if p_failure_observed_at is null then
    return jsonb_build_object(
      'error','record when the failure was observed; work-order timestamps are not substituted');
  end if;
  if p_failure_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('error','failure observed time cannot be in the future');
  end if;

  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.work_type<>'corrective' then
    return jsonb_build_object('error','a failure mechanism can be coded only on corrective work');
  end if;
  if w.completed_at is not null and p_failure_observed_at>w.completed_at then
    return jsonb_build_object(
      'error','failure observed time cannot be later than corrective-work completion');
  end if;
  select id into v_mech from public.damage_mechanisms
  where organization_id=v_org and mechanism_key=p_mechanism_key;
  if v_mech is null then return jsonb_build_object('error','unknown mechanism'); end if;
  if w.failure_mechanism_id=v_mech
     and w.failure_observed_at=p_failure_observed_at then
    return jsonb_build_object('error','this mechanism and observed time are already the governed coding');
  end if;
  if w.failure_mechanism_id is not null
     and v_role not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object(
      'error','correcting an existing coding requires engineering or manager authority');
  end if;

  update public.work_orders
  set failure_mechanism_id=v_mech,
      failure_observed_at=p_failure_observed_at,
      mechanism_coded_by=auth.uid(),
      mechanism_coded_at=now(),
      mechanism_note=btrim(p_note)
  where id=w.id;
  insert into public.failure_mechanism_coding_events(
    organization_id,work_order_id,prior_mechanism_id,mechanism_id,
    failure_observed_at,coding_note,coded_by)
  values(v_org,w.id,w.failure_mechanism_id,v_mech,p_failure_observed_at,
    btrim(p_note),auth.uid());
  return jsonb_build_object(
    'coded',w.id,
    'mechanism',p_mechanism_key,
    'failureObservedAt',p_failure_observed_at,
    'corrected',w.failure_mechanism_id is not null,
    'basis','The named human supplied both mechanism evidence and the observed failure time; no work-order timestamp was substituted.');
end;
$$;

revoke all on function public.code_failure_mechanism(uuid,text,text,timestamptz)
  from public,anon,service_role;
grant execute on function public.code_failure_mechanism(uuid,text,text,timestamptz)
  to authenticated;

create or replace function public.get_segmented_reliability(
  p_dimension text default 'criticality',
  p_window_days int default null,
  p_min_failures int default 3
)
returns jsonb
language plpgsql
security definer
set search_path=public
stable
as $$
declare
  v_org uuid:=public.app_current_org();
  v_min int:=greatest(coalesce(p_min_failures,3),1);
  v_from timestamptz;
  v_to timestamptz;
  v_window_days numeric;
  v_window_hours numeric;
  v_rows jsonb;
  v_missing_time int:=0;
  v_uncoded int:=0;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  if p_dimension is null or p_dimension not in (
    'asset_class','criticality','site','failure_mode','system_group',
    'mechanism','operating_regime') then
    return jsonb_build_object(
      'error',
      'dimension must be one of asset_class, criticality, site, failure_mode, system_group, mechanism, operating_regime');
  end if;

  select count(*) filter(where w.failure_observed_at is null),
         count(*) filter(where w.failure_mechanism_id is null)
  into v_missing_time,v_uncoded
  from public.work_orders w
  where w.organization_id=v_org and w.work_type='corrective'
    and w.completed_at is not null;

  if p_window_days is null then
    select min(case when p_dimension in ('mechanism','operating_regime')
                    then w.failure_observed_at else w.completed_at end),
           max(case when p_dimension in ('mechanism','operating_regime')
                    then w.failure_observed_at else w.completed_at end)
    into v_from,v_to
    from public.work_orders w
    where w.organization_id=v_org and w.work_type='corrective'
      and w.completed_at is not null
      and (p_dimension not in ('mechanism','operating_regime')
        or w.failure_observed_at is not null);
    if v_from is null then
      return jsonb_build_object(
        'dimension',case when p_dimension='failure_mode' then 'system_group' else p_dimension end,
        'requested_dimension',p_dimension,
        'segments','[]'::jsonb,
        'excludedMissingFailureTime',v_missing_time,
        'excludedUncodedMechanism',case when p_dimension='mechanism' then v_uncoded else 0 end,
        'basis',case when p_dimension in ('mechanism','operating_regime')
          then 'No completed corrective history has a human-recorded observed failure time; work-order timestamps are not substituted.'
          else 'No completed corrective work orders are recorded for this organization.' end);
    end if;
    v_window_days:=greatest(extract(epoch from (v_to-v_from))/86400.0,1);
  else
    v_window_days:=greatest(p_window_days,1);
    v_from:=now()-make_interval(days=>v_window_days::int);
    v_to:=now();
  end if;
  v_window_hours:=v_window_days*24.0;

  -- Disclose evidence gaps for the same reporting window. Completion time is
  -- used only to decide whether an untimed/uncoded event belongs in the gap
  -- count; it is never substituted into mechanism or regime segmentation.
  select count(*) filter(where w.failure_observed_at is null),
         count(*) filter(where w.failure_mechanism_id is null)
  into v_missing_time,v_uncoded
  from public.work_orders w
  where w.organization_id=v_org and w.work_type='corrective'
    and w.completed_at between v_from and v_to;

  with scoped as (
    select
      case p_dimension
        when 'asset_class' then coalesce(a.asset_class,'Unclassified')
        when 'criticality' then coalesce(a.criticality,'unrated')
        when 'site' then coalesce(s.name,'Unassigned site')
        when 'mechanism' then dm.name
        when 'operating_regime' then coalesce(duty.regime,'Unknown duty — no matching state')
        else coalesce(w.system_group,'Not an equipment group')
      end segment,
      a.id asset_id,
      coalesce(w.downtime_hours,0)::numeric downtime_hours
    from public.work_orders w
    join public.assets a on a.id=w.asset_id and a.organization_id=w.organization_id
    left join public.sites s on s.id=a.site_id and s.organization_id=w.organization_id
    left join public.damage_mechanisms dm
      on dm.id=w.failure_mechanism_id and dm.organization_id=w.organization_id
    left join lateral (
      select case
        when os.load_pct is null then 'Unknown duty — load not recorded'
        when os.load_pct>=80 then 'High duty'
        when os.load_pct>=40 then 'Moderate duty'
        else 'Low duty' end regime
      from public.operating_states os
      where os.organization_id=w.organization_id
        and os.asset_id=w.asset_id
        and w.failure_observed_at is not null
        and os.started_at<=w.failure_observed_at
        and (os.ended_at is null or os.ended_at>w.failure_observed_at)
      order by os.started_at desc
      limit 1
    ) duty on true
    where w.organization_id=v_org
      and w.work_type='corrective'
      and w.completed_at is not null
      and case when p_dimension in ('mechanism','operating_regime')
        then w.failure_observed_at between v_from and v_to
        else w.completed_at between v_from and v_to end
      and (p_dimension<>'mechanism' or w.failure_mechanism_id is not null)
  ), agg as (
    select segment,count(*)::int failures,count(distinct asset_id)::int assets_in_segment,
      round(sum(downtime_hours)::numeric,1) downtime_hours
    from scoped group by segment having count(*)>=v_min
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.downtime_hours desc),'[]'::jsonb)
  into v_rows
  from (
    select segment,failures,assets_in_segment,downtime_hours,
      round((v_window_hours*assets_in_segment)::numeric,0) window_hours,
      round(greatest(v_window_hours*assets_in_segment-downtime_hours,0)/failures,1) mtbf_hours,
      round(downtime_hours/failures,1) mttr_hours,
      round(100*greatest(v_window_hours*assets_in_segment-downtime_hours,0)
        /(v_window_hours*assets_in_segment),1) availability_pct
    from agg
  ) x;

  return jsonb_build_object(
    'dimension',case when p_dimension='failure_mode' then 'system_group' else p_dimension end,
    'requested_dimension',p_dimension,
    'window_days',round(v_window_days,1),
    'window_from',v_from,
    'window_to',v_to,
    'window_source',case when p_window_days is null
      then 'derived from the applicable evidence timestamps'
      else 'caller-specified trailing window' end,
    'min_failures',v_min,
    'excludedMissingFailureTime',case when p_dimension in ('mechanism','operating_regime')
      then v_missing_time else 0 end,
    'excludedUncodedMechanism',case when p_dimension='mechanism' then v_uncoded else 0 end,
    'basis',case
      when p_dimension='mechanism' then
        'Human-coded failure mechanisms with a human-recorded observed failure time only. Uncoded or untimed corrective work in the reporting window is disclosed and excluded. MTBF and availability are calendar-window event-cohort estimates for assets with qualifying events, not observed operating exposure.'
      when p_dimension='operating_regime' then
        'Exact-time match between the human-recorded observed failure time and canonical operating_states. Missing load remains Unknown duty; missing failure times in the reporting window are disclosed and excluded. Work-order timestamps are not substituted. MTBF and availability are calendar-window event-cohort estimates, not duty-normalized operating exposure.'
      when p_dimension in ('failure_mode','system_group') then
        'Segmented by SYSTEM GROUP, which is what the source downtime-coding vocabulary provides. This is not a failure-mechanism claim; use the governed mechanism axis. MTBF and availability are calendar-window event-cohort estimates for assets with qualifying events, not observed operating exposure.'
      else
        'Completed corrective work orders. Segments below the minimum-failure threshold are omitted rather than reported on thin evidence. MTBF and availability are calendar-window event-cohort estimates for assets with qualifying events, not observed operating exposure.' end,
    'segments',v_rows);
end;
$$;

revoke all on function public.get_segmented_reliability(text,int,int)
  from public,anon,service_role;
grant execute on function public.get_segmented_reliability(text,int,int)
  to authenticated;

notify pgrst,'reload schema';
