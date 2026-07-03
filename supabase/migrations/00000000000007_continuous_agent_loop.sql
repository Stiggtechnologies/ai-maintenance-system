-- ============================================================================
-- Continuous agent loop — makes "operating in real time" literally true.
--
-- run_agent_loop() scans live sensor state and, for any alarm/warning without
-- a recent recommendation, raises a PENDING recommendation from the Condition
-- Monitoring agent (human-in-the-loop preserved: the loop never approves or
-- executes anything). It also heartbeats agent activity so AI Workforce shows
-- live status, logs agent_runs, and self-prunes run history.
--
-- Scheduled every 5 minutes via pg_cron. Deterministic titles make the loop
-- idempotent: an asset/sensor pair is raised at most once per 24h window.
-- Callable only by service_role (and the cron scheduler) — never by app users.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function public.run_agent_loop()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_recs_total int := 0;
  v_recs_org int;
  v_flagged int := 0;
  s record;
  v_urgency text;
  v_title text;
begin
  for v_org in select id from organizations loop
    v_recs_org := 0;

    -- Condition Monitoring: raise recommendations from live sensor state.
    for s in
      select se.id as sensor_id, se.name, se.status, se.trend, se.last_value,
             se.unit, se.threshold, a.id as aid, a.name as asset_name, a.criticality
      from sensors se
      join assets a on a.id = se.asset_id
      where se.organization_id = v_org
        and se.status in ('alarm', 'warning')
    loop
      v_flagged := v_flagged + 1;
      v_title := 'Investigate ' || s.name || ' on ' || s.asset_name;

      if not exists (
        select 1 from recommendations r
        where r.asset_id = s.aid
          and r.title = v_title
          and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
      ) then
        v_urgency := case
          when s.status = 'alarm' and s.criticality in ('critical', 'high') then 'critical'
          when s.status = 'alarm' then 'action'
          else 'advisory'
        end;

        insert into recommendations (
          organization_id, asset_id, agent_id, title, issue, action, impact,
          confidence, urgency, status, approval_required, accountable,
          responsible, consulted, informed, risk_impact, rationale
        )
        select
          v_org, s.aid, ag.id, v_title,
          s.name || ' at ' || s.last_value || ' ' || coalesce(s.unit, '')
            || ' vs threshold ' || s.threshold || ' — ' || s.status
            || ', trend ' || s.trend,
          case when s.status = 'alarm'
            then 'Schedule inspection within 48 hours'
            else 'Increase monitoring frequency and review trend' end,
          'Early intervention prevents unplanned downtime',
          case when s.status = 'alarm' then 84 else 76 end,
          v_urgency,
          'pending',
          case when v_urgency = 'critical' then 'Maintenance Manager' else 'Reliability Engineer' end,
          'Maintenance Manager', 'Planner', 'Operations', 'Reliability Engineer',
          case when v_urgency = 'critical' then 'High' else 'Medium' end,
          'Raised by the continuous condition-monitoring loop from live sensor state. Human approval required before any action.'
        from ai_agents ag
        where ag.organization_id = v_org and ag.key = 'condition_monitoring'
        limit 1;

        v_recs_org := v_recs_org + 1;
      end if;
    end loop;

    -- Heartbeat: monitoring freshness + agent liveness for the UI.
    update asset_health_monitoring set monitored_at = now()
      where organization_id = v_org;

    update ai_agents ag set
      last_action_at = now(),
      current_task = case when v_recs_org > 0
        then 'Raised ' || v_recs_org || ' condition recommendation(s)'
        else 'Monitoring sensor streams' end,
      last_action = case when v_recs_org > 0
        then 'Created ' || v_recs_org || ' recommendation(s) from live sensor state'
        else ag.last_action end,
      recommendations_generated = ag.recommendations_generated + v_recs_org
    where ag.organization_id = v_org and ag.key = 'condition_monitoring';

    if v_recs_org > 0 then
      insert into agent_runs (organization_id, agent_id, status, summary, confidence, started_at, completed_at)
      select v_org, ag.id, 'completed',
             'Continuous loop: ' || v_recs_org || ' recommendation(s) raised from sensor state',
             85, now(), now()
      from ai_agents ag
      where ag.organization_id = v_org and ag.key = 'condition_monitoring'
      limit 1;
    end if;

    v_recs_total := v_recs_total + v_recs_org;
  end loop;

  -- Self-maintenance: keep run history bounded.
  delete from agent_runs where created_at < now() - interval '7 days';

  return jsonb_build_object(
    'sensors_flagged', v_flagged,
    'recommendations_created', v_recs_total,
    'ran_at', now()
  );
end
$$;

-- Only the platform may run the loop — never app users.
revoke execute on function public.run_agent_loop() from public, anon, authenticated;
grant execute on function public.run_agent_loop() to service_role;

-- Schedule every 5 minutes (idempotent re-schedule).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-agent-loop';
    perform cron.schedule('syncai-agent-loop', '*/5 * * * *', 'select public.run_agent_loop()');
  end if;
end
$$;
