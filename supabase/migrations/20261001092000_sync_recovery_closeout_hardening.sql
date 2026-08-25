-- ============================================================================
-- Sync Recovery full close-out hardening
-- ============================================================================

-- Production-priority payloads are machine-consumed by the fleet allocator.
-- Refuse malformed weights at the evidence boundary rather than failing later.
alter table operational_constraint_signals
  add constraint operational_constraint_signals_priority_weight_valid
  check (
    signal_kind <> 'production'
    or not (payload ? 'priority_weight')
    or ((payload->>'priority_weight') ~ '^[0-9]+([.][0-9]+)?$')
  );

-- A safe energy state is temporary physical evidence. Isolation/zero-energy
-- verification with no expiry would silently authorize work days or weeks later.
create or replace function public.record_asset_energy_state(
  p_asset_id uuid,p_energy_type text,p_state text,p_basis text,p_isolation_ref text default null,
  p_valid_until timestamptz default null,p_source_system text default 'manual')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_id uuid;
begin
  if not public.recovery_role_allowed(array['technician','supervisor','maintenance_manager','operator','admin','ai_admin']) then
    return jsonb_build_object('error','energy-state authority denied');
  end if;
  if not exists(select 1 from assets where id=p_asset_id and organization_id=v_org) then
    return jsonb_build_object('error','asset not found');
  end if;
  if p_energy_type not in ('electrical','hydraulic','pneumatic','mechanical','thermal','gravity','chemical','process','other')
     or p_state not in ('energized','isolated','dissipated','verified_zero','unknown') then
    return jsonb_build_object('error','invalid energy state');
  end if;
  if coalesce(length(trim(p_basis)),0)<10 then
    return jsonb_build_object('error','verification basis required');
  end if;
  if p_state in ('isolated','dissipated','verified_zero')
     and (p_valid_until is null or p_valid_until<=now()) then
    return jsonb_build_object('error','safe energy-state evidence requires a future valid_until; indefinite isolation evidence is refused');
  end if;
  insert into asset_energy_states(
    organization_id,asset_id,energy_type,state,isolation_ref,basis,verified_by,valid_until,source_system)
  values(
    v_org,p_asset_id,p_energy_type,p_state,p_isolation_ref,trim(p_basis),auth.uid(),p_valid_until,
    coalesce(nullif(trim(p_source_system),''),'manual'))
  returning id into v_id;
  return jsonb_build_object('ok',true,'energy_state_id',v_id,'state',p_state,'valid_until',p_valid_until);
end $$;

create or replace function public.enforce_recovery_energy_state()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_job_plan uuid; v_asset uuid; r record; v_state text;
begin
  if new.execution_status='in_progress' and old.execution_status is distinct from 'in_progress' then
    select w.job_plan_id,w.asset_id into v_job_plan,v_asset
    from work_orders w where w.id=new.work_order_id;

    for r in
      select * from job_plan_energy_requirements where job_plan_id=v_job_plan
    loop
      select e.state into v_state
      from asset_energy_states e
      where e.organization_id=new.organization_id
        and e.asset_id=v_asset
        and e.energy_type=r.energy_type
        and e.observed_at<=now()
        -- Only fresh, explicitly bounded safe-state evidence may authorize work.
        and e.valid_until is not null
        and e.valid_until>=now()
      order by e.observed_at desc
      limit 1;

      if v_state is null
         or public.recovery_energy_rank(v_state)<public.recovery_energy_rank(r.required_state) then
        raise exception 'Recovery energy gate: % must be % or safer before work starts (current: %)',
          r.energy_type,r.required_state,coalesce(v_state,'unknown')
          using errcode='check_violation';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- Scenario inputs are hypothetical, but still must be physically meaningful.
-- jsonb_array_elements_text accepts both [1] and ["1"] for sequence selectors.
create or replace function public.simulate_recovery_what_if(
  p_plan_id uuid,p_changes jsonb,p_basis text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  p restoration_plan_versions%rowtype;
  v_hours numeric;
  v_hyp_parallel int;
  v_delay_text text:=p_changes->>'additional_delay_hours';
begin
  if coalesce(length(trim(p_basis)),0)<15 then
    return jsonb_build_object('error','scenario assumption basis required');
  end if;
  select * into p from restoration_plan_versions
  where id=p_plan_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','plan not found'); end if;

  if exists(
    select 1 from jsonb_each_text(coalesce(p_changes->'duration_multipliers','{}'::jsonb)) x
    where x.value !~ '^[0-9]+([.][0-9]+)?$' or x.value::numeric<=0
  ) then
    return jsonb_build_object('error','duration multipliers must be positive numbers');
  end if;
  if v_delay_text is not null
     and (v_delay_text !~ '^[0-9]+([.][0-9]+)?$' or v_delay_text::numeric<0) then
    return jsonb_build_object('error','additional_delay_hours must be non-negative');
  end if;

  with tasks as (
    select (s->>'sequence')::int seq,s->>'mode' mode,
      t->>'event_work_id' event_work_id,(t->>'hours')::numeric hours
    from jsonb_array_elements(p.schedule) s
    cross join lateral jsonb_array_elements(s->'tasks') t
  ), adjusted as (
    select *,hours*coalesce(nullif(p_changes->'duration_multipliers'->>event_work_id,'')::numeric,1) adj_hours
    from tasks
    where not exists(
      select 1 from jsonb_array_elements_text(coalesce(p_changes->'exclude_event_work_ids','[]'::jsonb)) x
      where x=event_work_id
    )
  ), stages as (
    select seq,
      case when bool_and(mode='parallel') or exists(
        select 1 from jsonb_array_elements_text(coalesce(p_changes->'parallel_sequences','[]'::jsonb)) x
        where x=seq::text
      ) then max(adj_hours) else sum(adj_hours) end stage_hours
    from adjusted
    group by seq
  )
  select coalesce(sum(stage_hours),0)+coalesce(v_delay_text::numeric,0)
  into v_hours from stages;

  select count(*) into v_hyp_parallel
  from jsonb_array_elements_text(coalesce(p_changes->'parallel_sequences','[]'::jsonb)) x
  where not exists(
    select 1 from jsonb_array_elements(p.schedule) s
    where s->>'sequence'=x and s->>'mode'='parallel'
  );

  return jsonb_build_object(
    'plan_id',p.id,
    'scenario_critical_path_hours',round(v_hours,2),
    'base_critical_path_hours',p.critical_path_hours,
    'delta_hours',round(v_hours-coalesce(p.critical_path_hours,0),2),
    'basis',trim(p_basis),
    'changes',p_changes,
    'releasable',false,
    'hypothetical_parallel_sequences',v_hyp_parallel,
    'warning','Scenario output never mutates or releases a plan. Hypothetical parallelism still requires the normal physical/safety/resource verification and independent approval gates.');
end $$;

-- Cadence snapshots are auditable operating records, not arbitrary user writes.
create or replace function public.publish_recovery_cadence_snapshot(
  p_cadence text,p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_snapshot jsonb; v_id uuid;
begin
  if not public.recovery_role_allowed(array['planner','supervisor','maintenance_manager','reliability_engineer','operator','admin','ai_admin']) then
    return jsonb_build_object('error','cadence publication authority denied');
  end if;
  if p_cadence not in ('shift','daily','weekly') then
    return jsonb_build_object('error','invalid cadence');
  end if;
  if p_event_id is not null then
    if not exists(select 1 from restoration_events where id=p_event_id and organization_id=v_org) then
      return jsonb_build_object('error','event not found');
    end if;
    v_snapshot:=public.get_recovery_handoff(p_event_id);
  else
    v_snapshot:=jsonb_build_object(
      'board',public.get_recovery_board(),
      'decision_queue',public.get_recovery_decision_queue(),
      'ftr',public.get_recovery_ftr_metrics(case when p_cadence='weekly' then 90 else 30 end),
      'generated_at',now());
  end if;
  insert into recovery_cadence_snapshots(organization_id,event_id,cadence,snapshot,generated_by)
  values(v_org,p_event_id,p_cadence,v_snapshot,auth.uid()) returning id into v_id;
  return jsonb_build_object('ok',true,'snapshot_id',v_id,'snapshot',v_snapshot);
end $$;

-- Candidate recurrence writes affect the learning record; restrict their authoring.
create or replace function public.refresh_recovery_recurrence_candidates(
  p_event_id uuid,p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); e restoration_events%rowtype; v_n int:=0;
begin
  if not public.recovery_role_allowed(array['supervisor','maintenance_manager','reliability_engineer','admin','ai_admin']) then
    return jsonb_build_object('error','recurrence learning authority denied');
  end if;
  select * into e from restoration_events
  where id=p_event_id and organization_id=v_org;
  if not found or e.actual_return_at is null then
    return jsonb_build_object('error','closed event with actual return required');
  end if;
  insert into recovery_recurrence_links(organization_id,event_id,notification_id)
  select v_org,e.id,n.id
  from maintenance_notifications n
  where n.organization_id=v_org
    and n.asset_id=e.asset_id
    and n.notification_type in ('fault','safety')
    and n.reported_at>e.actual_return_at
    and n.reported_at<=e.actual_return_at+make_interval(days=>greatest(p_window_days,1))
  on conflict(event_id,notification_id) do nothing;
  get diagnostics v_n=row_count;
  return jsonb_build_object('ok',true,'candidates_added',v_n,'window_days',greatest(p_window_days,1));
end $$;

-- Preserve grants after function replacement.
revoke all on function public.record_asset_energy_state(uuid,text,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.record_asset_energy_state(uuid,text,text,text,text,timestamptz,text) to authenticated;
revoke all on function public.simulate_recovery_what_if(uuid,jsonb,text) from public,anon;
grant execute on function public.simulate_recovery_what_if(uuid,jsonb,text) to authenticated;
revoke all on function public.publish_recovery_cadence_snapshot(text,uuid) from public,anon;
grant execute on function public.publish_recovery_cadence_snapshot(text,uuid) to authenticated;
revoke all on function public.refresh_recovery_recurrence_candidates(uuid,int) from public,anon;
grant execute on function public.refresh_recovery_recurrence_candidates(uuid,int) to authenticated;

notify pgrst,'reload schema';
