-- ============================================================================
-- Real-time operating picture (ShipOS-class gap closure).
--
-- Benchmark: the U.S. Navy's ShipOS demo (Palantir AIPCon 9) — always-on
-- agents that work AHEAD of problems, real-time visibility, and measured
-- cycle-time compression. This migration closes the data-plane and
-- proactivity gaps:
--
--   1. Telemetry simulation: sensor values now MOVE (1-min pg_cron walk with
--      trend bias, noise, mean reversion and occasional excursions) so the
--      continuous loop reacts to live data. Simulation applies only to orgs
--      with no connected historian integration — a real connector switches
--      it off per-org automatically.
--   2. Proactive agent passes: schedule risk (overdue/blocked work), material
--      readiness (parts not staged ahead of scheduled work) and capacity
--      imbalance (workload reallocation) — each raising HITL PENDING
--      recommendations exactly like the condition-monitoring loop.
--   3. Cycle-time metrics: get_cycle_time_metrics() measures SyncAI's own
--      compression (recommendation→decision, decision→work order,
--      work-order open→close, onboarding autonomy).
--   4. Second demo site (Athabasca Upgrader) with assets that self-onboard
--      via the existing trigger — proves multi-site rollups + cross-site
--      capacity stories.
--   5. Realtime publication: core operating tables stream to the UI over
--      Supabase Realtime (RLS-enforced postgres_changes).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Telemetry simulation
-- ----------------------------------------------------------------------------
create or replace function public.simulate_telemetry_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_updated int := 0;
  v_new numeric;
  v_drift numeric;
  v_new_status text;
begin
  for s in
    select se.*
    from sensors se
    where se.last_value is not null
      -- A connected historian owns this org's telemetry — never simulate over it.
      and not exists (
        select 1 from integrations i
        where i.organization_id = se.organization_id
          and lower(coalesce(i.status, '')) in ('connected', 'healthy', 'active')
          and i.name ilike '%historian%'
      )
  loop
    -- Random walk: ±1.5% noise, mean-reversion toward 80% of threshold (a
    -- "healthy" operating point), rare excursions pushing toward alarm.
    v_drift := (random() - 0.5) * 0.03 * greatest(abs(s.last_value), 1);
    if s.threshold is not null then
      v_drift := v_drift + (s.threshold * 0.8 - s.last_value) * 0.02;
      if random() < 0.02 then
        v_drift := v_drift + s.threshold * 0.12; -- excursion event
      end if;
    end if;
    v_new := round((s.last_value + v_drift)::numeric, 2);
    if v_new < 0 then v_new := 0; end if;

    v_new_status := case
      when s.threshold is null then s.status
      when v_new >= s.threshold then 'alarm'
      when v_new >= s.threshold * 0.9 then 'warning'
      else 'normal' end;

    update sensors set
      last_value = v_new,
      status = v_new_status,
      trend = case
        when v_new > s.last_value * 1.005 then 'up'
        when v_new < s.last_value * 0.995 then 'down'
        else 'stable' end
    where id = s.id;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('sensors_updated', v_updated, 'ran_at', now());
end
$$;

revoke execute on function public.simulate_telemetry_tick() from public, anon, authenticated;
grant execute on function public.simulate_telemetry_tick() to service_role;

-- ----------------------------------------------------------------------------
-- 2. Proactive agent passes (schedule / material / capacity)
-- ----------------------------------------------------------------------------
create or replace function public.run_proactive_agent_passes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  w record;
  cap record;
  v_title text;
  v_schedule int := 0;
  v_material int := 0;
  v_capacity int := 0;
begin
  for v_org in select id from organizations loop

    -- ---- Schedule agent: overdue or blocked work is a delivery risk --------
    for w in
      select wo.id, wo.title, wo.status, wo.scheduled_date, wo.priority,
             a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and (
          (wo.status in ('pending','approval','scheduled')
             and wo.scheduled_date is not null
             and wo.scheduled_date ~ '^\d{4}-\d{2}-\d{2}'
             and wo.scheduled_date::date < current_date)
          or wo.status = 'blocked'
        )
    loop
      v_title := 'Schedule risk: ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, approval_required, accountable, responsible,
          consulted, informed, risk_impact, rationale)
        select v_org, w.aid, ag.id, v_title,
          case when w.status = 'blocked'
            then w.title || ' is blocked — every blocked day extends asset exposure'
            else w.title || ' is past its scheduled date (' || w.scheduled_date || ')' end,
          case when w.status = 'blocked'
            then 'Resolve the blocker or re-plan the work window'
            else 'Reschedule into the next available window and confirm resources' end,
          'Protects schedule adherence before the backlog compounds',
          78, case when w.priority in ('critical','high') then 'action' else 'advisory' end,
          'pending', null, 'Maintenance Manager', 'Planner', 'Operations', 'Reliability Engineer',
          'Medium',
          'Raised by the proactive schedule pass — surfacing schedule risk before it becomes a delivery gap. Human approval required.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'planning_scheduling'
        limit 1;
        v_schedule := v_schedule + 1;
      end if;
    end loop;

    -- ---- Material agent: parts not staged ahead of scheduled work ----------
    for w in
      select wo.id, wo.title, wo.scheduled_date, a.name as asset_name, a.id as aid
      from work_orders wo
      left join assets a on a.id = wo.asset_id
      where wo.organization_id = v_org
        and wo.status in ('pending','approval','scheduled')
        and wo.parts_ready = false
        and wo.scheduled_date is not null
        and wo.scheduled_date ~ '^\d{4}-\d{2}-\d{2}'
        and wo.scheduled_date::date between current_date and current_date + 7
    loop
      v_title := 'Material risk: parts not staged for ' || w.title;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, asset_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale)
        select v_org, w.aid, ag.id, v_title,
          'Work is scheduled for ' || w.scheduled_date || ' but required parts are not staged',
          'Expedite parts or pull forward procurement; confirm kit completeness before the window',
          'Prevents a schedule slip caused by material readiness',
          80, 'action', 'pending', 'Maintenance Manager', 'Planner', 'Inventory', 'Operations',
          'Medium',
          'Raised by the proactive material pass — flagging material risk before it becomes a gap. Human approval required.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'inventory_management'
        limit 1;
        v_material := v_material + 1;
      end if;
    end loop;

    -- ---- Capacity agent: workload imbalance across assignees ----------------
    for cap in
      select hi.assignee as loaded, hi.n as loaded_n
      from (
        select assignee, count(*) as n
        from work_orders
        where organization_id = v_org
          and status in ('pending','approval','scheduled','in_progress')
          and assignee is not null
        group by assignee
      ) hi
      where hi.n >= 3
    loop
      v_title := 'Capacity: rebalance workload from ' || cap.loaded;
      if not exists (
        select 1 from recommendations r
        where r.organization_id = v_org and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        insert into recommendations (organization_id, agent_id, title, issue, action,
          impact, confidence, urgency, status, accountable, responsible, consulted, informed,
          risk_impact, rationale)
        select v_org, ag.id, v_title,
          cap.loaded || ' carries ' || cap.loaded_n || ' open work orders while other capacity is available',
          'Reallocate lower-priority work to available technicians or the next shift',
          'Frees constrained capacity before it becomes a schedule gap',
          75, 'advisory', 'pending', 'Maintenance Manager', 'Maintenance Supervisor',
          'Planner', 'Operations', 'Low',
          'Raised by the proactive capacity pass — identifying capacity that can be reallocated before it becomes a gap. Human approval required.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'maintenance_operations'
        limit 1;
        v_capacity := v_capacity + 1;
      end if;
    end loop;

    -- Heartbeats for the agents that did work this pass.
    update ai_agents ag set last_action_at = now(),
      current_task = 'Scanning schedule adherence and backlog risk'
    where ag.organization_id = v_org and ag.key = 'planning_scheduling';
    update ai_agents ag set last_action_at = now(),
      current_task = 'Checking material readiness for upcoming work'
    where ag.organization_id = v_org and ag.key = 'inventory_management';
    update ai_agents ag set last_action_at = now(),
      current_task = 'Balancing crew capacity across open work'
    where ag.organization_id = v_org and ag.key = 'maintenance_operations';
  end loop;

  return jsonb_build_object(
    'schedule_risks', v_schedule,
    'material_risks', v_material,
    'capacity_recommendations', v_capacity,
    'ran_at', now()
  );
end
$$;

revoke execute on function public.run_proactive_agent_passes() from public, anon, authenticated;
grant execute on function public.run_proactive_agent_passes() to service_role;

-- Umbrella loop: condition monitoring + proactive passes on one schedule.
create or replace function public.run_operating_loop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return run_agent_loop() || run_proactive_agent_passes();
end
$$;

revoke execute on function public.run_operating_loop() from public, anon, authenticated;
grant execute on function public.run_operating_loop() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-agent-loop';
    perform cron.schedule('syncai-agent-loop', '*/5 * * * *', 'select public.run_operating_loop()');
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-telemetry-sim';
    perform cron.schedule('syncai-telemetry-sim', '* * * * *', 'select public.simulate_telemetry_tick()');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Cycle-time metrics (SyncAI's own compression numbers)
-- ----------------------------------------------------------------------------
create or replace function public.get_cycle_time_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_rec_to_decision numeric;
  v_decided int;
  v_wo_open_to_close numeric;
  v_wo_closed int;
  v_onb record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select round(avg(extract(epoch from (d.created_at - r.created_at)) / 3600)::numeric, 1), count(*)
    into v_rec_to_decision, v_decided
  from decisions d
  join recommendations r on r.id = d.recommendation_id
  where d.organization_id = v_org;

  select round(avg(extract(epoch from (wo.closed_at - wo.created_at)) / 3600)::numeric, 1), count(*)
    into v_wo_open_to_close, v_wo_closed
  from work_orders wo
  where wo.organization_id = v_org and wo.closed_at is not null;

  select count(*) as assets,
         round(avg(s.completion_pct), 0) as avg_completion,
         sum(r2.items_auto_filled + r2.items_deduced) as items_autonomous
    into v_onb
  from asset_onboarding_state s
  left join lateral (
    select coalesce(sum(items_auto_filled), 0) as items_auto_filled,
           coalesce(sum(items_deduced), 0) as items_deduced
    from asset_onboarding_runs r
    where r.asset_id = s.asset_id
  ) r2 on true
  where s.organization_id = v_org;

  return jsonb_build_object(
    'recommendation_to_decision_hours', v_rec_to_decision,
    'decisions_measured', v_decided,
    'workorder_open_to_close_hours', v_wo_open_to_close,
    'workorders_closed', v_wo_closed,
    'onboarding_assets', v_onb.assets,
    'onboarding_avg_completion_pct', v_onb.avg_completion,
    'onboarding_items_filled_autonomously', v_onb.items_autonomous,
    'loop_scan_interval_minutes', 5,
    'telemetry_interval_minutes', 1
  );
end
$$;

grant execute on function public.get_cycle_time_metrics() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Second demo site — assets self-onboard via the migration-11 trigger
-- ----------------------------------------------------------------------------
insert into sites (id, organization_id, name, code)
values ('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111',
        'Athabasca Upgrader — Site B', 'ATH-B')
on conflict (id) do nothing;

insert into assets (id, organization_id, site_id, tag, name, asset_class, criticality, status,
  health_score, risk_score, area, system, manufacturer, model, serial_number, installed_date)
values
  ('aaaaaaaa-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222223','P-201','Pump P-201','Centrifugal Pump','high','healthy',
   88, 38,'Upgrader Cooling','Utilities','Sulzer','ZPP-41','SU-2022-ZPP-1188','2022-08-14'),
  ('aaaaaaaa-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222223','K-201','Compressor K-201','Centrifugal Compressor','critical','watch',
   82, 51,'Gas Recovery','Process Gas','Siemens Energy','STC-SV','SE-2021-STC-0412','2021-05-30')
on conflict (id) do nothing;

insert into sensors (organization_id, asset_id, name, signal_type, unit, last_value, threshold, status, trend) values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000007','Discharge Pressure — P-201','pressure','bar',5.6,7.0,'normal','stable'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000007','Vibration — P-201 DE','vibration','mm/s',3.1,8.0,'normal','stable'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000008','Discharge Temp — K-201','temperature','degC',96,120,'normal','up'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000008','Vibration — K-201','vibration','mm/s',6.9,9.0,'normal','up')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 5. Stream the operating tables to the UI (RLS-enforced realtime)
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sensors','recommendations','work_orders','decisions','value_metrics',
    'learning_events','notifications','asset_onboarding_items','asset_onboarding_state'
  ] loop
    if to_regclass('public.' || t) is not null then
      begin
        execute format('alter publication supabase_realtime add table %I', t);
      exception when duplicate_object then
        null; -- already in the publication
      end;
      -- RLS-checked UPDATE/DELETE events need the full old row in WAL.
      execute format('alter table %I replica identity full', t);
    end if;
  end loop;
end
$$;
