-- Governed repeat-failure measurement (C6.20) and correction of C6.16.
--
-- A repeat is the next completed corrective event on the same asset with the
-- same HUMAN-CODED damage mechanism inside a caller-visible recurrence window.
-- Raw actual_failure_mode source labels are deliberately excluded: that field
-- mixes system groups, activities and delay reasons and cannot prove sameness.

-- The general work-order policy must not be able to forge governed coding
-- provenance. SECURITY DEFINER coding runs as the function owner; direct
-- authenticated updates fail here even if the broad row policy allows them.
create or replace function public.protect_failure_mechanism_provenance()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if current_user in ('postgres','service_role') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' then
    if new.failure_mechanism_id is not null or new.mechanism_coded_by is not null
       or new.mechanism_coded_at is not null or new.mechanism_note is not null then
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
  if (new.failure_mechanism_id,new.mechanism_coded_by,new.mechanism_coded_at,new.mechanism_note,
      new.asset_id,new.work_type,new.completed_at)
       is distinct from
     (old.failure_mechanism_id,old.mechanism_coded_by,old.mechanism_coded_at,old.mechanism_note,
      old.asset_id,old.work_type,old.completed_at)
     and (old.failure_mechanism_id is not null or new.failure_mechanism_id is not null) then
    raise exception 'governed failure history changes require the approved closeout or coding function';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_failure_mechanism_provenance on public.work_orders;
create trigger trg_protect_failure_mechanism_provenance
before insert or update or delete
on public.work_orders for each row
execute function public.protect_failure_mechanism_provenance();

revoke all on function public.protect_failure_mechanism_provenance() from public,anon,authenticated;

create or replace function public.code_failure_mechanism(
  p_work_order_id uuid,p_mechanism_key text,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text; v_mech uuid;
  w public.work_orders%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role not in ('reliability_engineer','maintenance_manager','technician','admin','ai_admin') then
    return jsonb_build_object('error','coding a failure mechanism requires a maintenance or engineering role');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','a coding evidence note of at least 10 characters is required');
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.work_type<>'corrective' then
    return jsonb_build_object('error','a failure mechanism can be coded only on corrective work');
  end if;
  select id into v_mech from public.damage_mechanisms
  where organization_id=v_org and mechanism_key=p_mechanism_key;
  if v_mech is null then return jsonb_build_object('error','unknown mechanism'); end if;
  if w.failure_mechanism_id=v_mech then
    return jsonb_build_object('error','this mechanism is already the governed coding');
  end if;
  if w.failure_mechanism_id is not null
     and v_role not in ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error','correcting an existing coding requires engineering or manager authority');
  end if;
  update public.work_orders set failure_mechanism_id=v_mech,
    mechanism_coded_by=auth.uid(),mechanism_coded_at=now(),mechanism_note=btrim(p_note)
  where id=w.id;
  return jsonb_build_object('coded',w.id,'mechanism',p_mechanism_key,
    'corrected',w.failure_mechanism_id is not null);
end $$;
revoke all on function public.code_failure_mechanism(uuid,text,text) from public,anon;
grant execute on function public.code_failure_mechanism(uuid,text,text) to authenticated;

create or replace function public.get_repeat_failure_metrics(
  p_recurrence_days int default 90,
  p_reporting_days int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_recurrence_days int := least(greatest(coalesce(p_recurrence_days, 90), 7), 730);
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_reporting_days is null then
    select min(completed_at), max(completed_at)
      into v_from, v_to
    from public.work_orders
    where organization_id = v_org
      and work_type = 'corrective'
      and completed_at is not null
      and failure_mechanism_id is not null
      and mechanism_coded_by is not null
      and mechanism_coded_at is not null
      and coalesce(length(btrim(mechanism_note)),0)>=10;
  else
    v_to := now();
    v_from := v_to - make_interval(days => greatest(p_reporting_days, 1));
  end if;

  if v_from is null then
    return jsonb_build_object(
      'available', false,
      'recurrenceDays', v_recurrence_days,
      'reportingWindowSource', case when p_reporting_days is null
        then 'derived from coded event history' else 'caller-specified trailing window' end,
      'codedEvents', 0,
      'uncodedEventsExcluded', (
        select count(*) from public.work_orders
        where organization_id = v_org
          and work_type = 'corrective'
          and completed_at is not null
          and failure_mechanism_id is null
      ),
      'incompleteCodingProvenanceExcluded', (
        select count(*) from public.work_orders
        where organization_id = v_org
          and work_type = 'corrective'
          and completed_at is not null
          and failure_mechanism_id is not null
          and (mechanism_coded_by is null or mechanism_coded_at is null
            or coalesce(length(btrim(mechanism_note)),0)<10)
      ),
      'repeatEvents', 0,
      'repeatRatePct', null,
      'repeatAssetMechanismPairs', 0,
      'basis', 'No completed corrective event has a human-coded failure mechanism. Raw source labels are excluded because they do not establish a failure mechanism.',
      'events', '[]'::jsonb
    );
  end if;

  with sequenced as (
    select
      w.id,
      w.wo_number,
      w.asset_id,
      a.tag as asset_tag,
      w.failure_mechanism_id,
      dm.mechanism_key,
      dm.name as mechanism_name,
      w.completed_at,
      lag(w.id) over sequence as previous_work_order_id,
      lag(w.wo_number) over sequence as previous_work_order_number,
      lag(w.completed_at) over sequence as previous_completed_at
    from public.work_orders w
    join public.assets a
      on a.id = w.asset_id and a.organization_id = w.organization_id
    join public.damage_mechanisms dm
      on dm.id = w.failure_mechanism_id and dm.organization_id = w.organization_id
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.completed_at is not null
      and w.mechanism_coded_by is not null
      and w.mechanism_coded_at is not null
      and coalesce(length(btrim(w.mechanism_note)),0)>=10
    window sequence as (
      partition by w.asset_id, w.failure_mechanism_id
      order by w.completed_at, w.id
    )
  ), scoped as (
    select
      s.*,
      round((extract(epoch from (s.completed_at - s.previous_completed_at)) / 86400.0)::numeric, 1) as gap_days,
      s.previous_completed_at is not null
        and s.completed_at <= s.previous_completed_at + make_interval(days => v_recurrence_days)
        as is_repeat
    from sequenced s
    where s.completed_at between v_from and v_to
  ), totals as (
    select
      count(*)::int as coded_events,
      count(*) filter (where is_repeat)::int as repeat_events,
      count(distinct (asset_id, failure_mechanism_id)) filter (where is_repeat)::int
        as repeat_pairs
    from scoped
  ), excluded as (
    select count(*) filter(where w.failure_mechanism_id is null)::int as uncoded,
      count(*) filter(where w.failure_mechanism_id is not null and
        (w.mechanism_coded_by is null or w.mechanism_coded_at is null
          or coalesce(length(btrim(w.mechanism_note)),0)<10))::int as incomplete
    from public.work_orders w
    where w.organization_id = v_org
      and w.work_type = 'corrective'
      and w.completed_at between v_from and v_to
  )
  select jsonb_build_object(
    'available', totals.coded_events > 0,
    'recurrenceDays', v_recurrence_days,
    'windowFrom', v_from,
    'windowTo', v_to,
    'reportingWindowSource', case when p_reporting_days is null
      then 'derived from coded event history' else 'caller-specified trailing window' end,
    'codedEvents', totals.coded_events,
    'uncodedEventsExcluded', excluded.uncoded,
    'incompleteCodingProvenanceExcluded', excluded.incomplete,
    'repeatEvents', totals.repeat_events,
    'eventsReturned', least(totals.repeat_events, 100),
    'repeatRatePct', case when totals.coded_events > 0
      then round(100.0 * totals.repeat_events / totals.coded_events, 1) else null end,
    'repeatAssetMechanismPairs', totals.repeat_pairs,
    'basis', format(
      'A repeat is a completed corrective event following the same governed human coding (mechanism, actor, time, and evidence note) on the same asset within %s days. Rate denominator is all provenance-complete coded corrective events in the reporting window; first events remain in the denominator. Uncoded and incomplete-provenance events are disclosed and excluded.',
      v_recurrence_days
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workOrderId', s.id,
        'workOrderNumber', s.wo_number,
        'previousWorkOrderId', s.previous_work_order_id,
        'previousWorkOrderNumber', s.previous_work_order_number,
        'assetId', s.asset_id,
        'assetTag', s.asset_tag,
        'mechanismKey', s.mechanism_key,
        'mechanismName', s.mechanism_name,
        'completedAt', s.completed_at,
        'previousCompletedAt', s.previous_completed_at,
        'gapDays', s.gap_days
      ) order by s.completed_at desc)
      from (
        select *
        from scoped
        where is_repeat
        order by completed_at desc, id desc
        limit 100
      ) s
    ), '[]'::jsonb)
  ) into v_result
  from totals cross join excluded;

  return v_result;
end
$$;

revoke all on function public.get_repeat_failure_metrics(int, int) from public, anon;
grant execute on function public.get_repeat_failure_metrics(int, int) to authenticated;

-- Repair the work-health family in place. Its legacy implementation groups
-- raw actual_failure_mode labels while describing them as coded modes.
do $$
begin
  if to_regprocedure('public.get_work_management_health_base3(int)') is null then
    alter function public.get_work_management_health(int)
      rename to get_work_management_health_base3;
  end if;
end $$;

create or replace function public.get_work_management_health(
  p_window_days int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base jsonb := public.get_work_management_health_base3(p_window_days);
  v_repeat jsonb := public.get_repeat_failure_metrics(90, p_window_days);
  v_metrics jsonb := '[]'::jsonb;
  m jsonb;
  v_org uuid := public.app_current_org();
  v_from timestamptz;
  v_to timestamptz;
  v_inspected numeric;
  v_reworked numeric;
begin
  if v_repeat ? 'error' then
    return v_base;
  end if;

  v_from := (v_base->>'window_from')::timestamptz;
  v_to := (v_base->>'window_to')::timestamptz;
  select coalesce(sum(q.inspected_quantity), 0),
         coalesce(sum(q.reworked_quantity), 0)
    into v_inspected, v_reworked
  from public.quality_defects q
  where q.organization_id = v_org
    and q.detected_at between v_from and v_to;

  for m in select * from jsonb_array_elements(v_base->'metrics') loop
    if m->>'key' = 'rework_repeat' then
      v_metrics := v_metrics || jsonb_build_array(
        jsonb_build_object(
          'key', 'rework_rate',
          'label', 'Rework rate',
          'register_ref', 'C6.16',
          'available', v_inspected > 0,
          'value', case when v_inspected > 0
            then round(100.0 * v_reworked / v_inspected, 2) end,
          'unit', '%',
          'basis', case when v_inspected > 0 then format(
            'Human-recorded reworked quantity (%s) divided by inspected quantity (%s) from the canonical quality defect register.',
            v_reworked, v_inspected
          ) else
            'No inspected quantity is recorded in the quality defect register for this window, so rework rate is not measurable.'
          end
        ),
        jsonb_build_object(
          'key', 'repeat_work',
          'label', 'Repeat failures',
          'register_ref', 'C6.16',
          'available', v_repeat->'available',
          'value', v_repeat->'repeatAssetMechanismPairs',
          'unit', 'asset–mechanism pairs',
          'basis', concat(
            v_repeat->>'basis', ' ', v_repeat->>'uncodedEventsExcluded',
            ' uncoded corrective event(s) were excluded.'
          )
        )
      );
    else
      v_metrics := v_metrics || m;
    end if;
  end loop;

  return jsonb_set(v_base, '{metrics}', v_metrics);
end
$$;

revoke all on function public.get_work_management_health(int) from public, anon;
grant execute on function public.get_work_management_health(int) to authenticated;
revoke all on function public.get_work_management_health_base3(int) from public,anon,authenticated;

notify pgrst, 'reload schema';
