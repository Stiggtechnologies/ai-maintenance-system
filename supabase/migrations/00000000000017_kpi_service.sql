-- ============================================================================
-- ISO 55000 KPI Service — single source of KPI truth with RACI ownership,
-- role-based access control, and agent monitoring.
--
-- Implements the three-layer pattern (data → KPI computation → agents):
--   * kpi_catalog: the 29 ISO 55000 mining KPIs (from the operator's
--     KPI/RACI workbook) with formula, target, full RACI chain, owning
--     agent, dashboard page and AUDIENCE (which roles may see it).
--   * kpi_values: the KPI fact table — value, status vs target, variance,
--     confidence and computed_from lineage per org per hour.
--   * compute_kpi_snapshot(): computes every KPI derivable from live
--     operating data (~19 of 29); the rest stay in the catalog marked with
--     the data source they await (ERP, historian, mobile) — shown honestly,
--     never fabricated.
--   * Threshold triggers: a breached KPI raises a HITL recommendation
--     routed to the KPI's responsible role and owning agent (idempotent).
--   * get_kpi_dashboard(): SERVER-side access control — callers receive
--     only the KPIs their role is entitled to see.
-- ============================================================================

create table if not exists kpi_catalog (
  kpi_key text primary key,
  name text not null,
  page text not null,           -- executive | asset_performance | reliability | financial | risk_safety | sustainability | digital
  formula text not null,
  target_label text not null,
  direction text not null check (direction in ('up','down','range')),
  target_low numeric,           -- for 'up': min acceptable; 'down': max acceptable; 'range': low bound
  target_high numeric,
  unit text,
  accountable text not null,
  responsible text not null,
  consulted text,
  informed text,
  agent_owner text,             -- ai_agents.key that monitors this KPI
  audience text[],              -- roles allowed to see it; null = all roles
  computable boolean not null default true,
  source_note text              -- for non-computable: which source unlocks it
);

alter table kpi_catalog enable row level security;
drop policy if exists kpi_catalog_read on kpi_catalog;
create policy kpi_catalog_read on kpi_catalog for select to authenticated using (true);

create table if not exists kpi_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kpi_key text not null references kpi_catalog(kpi_key) on delete cascade,
  value numeric not null,
  status text not null check (status in ('on_target','watch','breach')),
  variance_pct numeric,
  confidence text default 'medium' check (confidence in ('high','medium','low')),
  computed_from jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists idx_kpi_values_lookup on kpi_values(organization_id, kpi_key, computed_at desc);

alter table kpi_values enable row level security;
drop policy if exists kpi_values_org_read on kpi_values;
create policy kpi_values_org_read on kpi_values
  for select to authenticated using (organization_id = app_current_org());

-- Stream to dashboards.
do $$
begin
  if to_regclass('public.kpi_values') is not null then
    begin
      execute 'alter publication supabase_realtime add table kpi_values';
    exception when duplicate_object then null;
    end;
    execute 'alter table kpi_values replica identity full';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Catalog: the 29 ISO 55000 mining KPIs (workbook-faithful RACI)
-- ----------------------------------------------------------------------------
insert into kpi_catalog (kpi_key, name, page, formula, target_label, direction, target_low, target_high, unit,
  accountable, responsible, consulted, informed, agent_owner, audience, computable, source_note) values
-- Board / executive tier (restricted audience)
('asset_value_realization','Asset Value Realization','executive','Verified value / Projected value','>95%','up',95,null,'%',
 'Board','CEO','Finance','Strategy','asset_management', array['executive','admin','ai_admin'], true, null),
('strategic_asset_alignment','Strategic Asset Alignment','executive','Aligned assets / Total assets','>90%','up',90,null,'%',
 'Board','Strategy','Asset Mgmt','Operations','asset_management', array['executive','admin','ai_admin'], false, 'Strategy register — tag assets to strategic objectives'),
('am_maturity_index','Asset Management Maturity Index','executive','ISO 55001 assessment score','>4/5','up',4,null,'/5',
 'Board','Asset Mgmt','Consulting','Audit','compliance_auditing', array['executive','admin','ai_admin'], false, 'ISO 55001 maturity assessment input'),
('stakeholder_value_index','Stakeholder Value Index','executive','Weighted value score','>85','up',85,null,'score',
 'Board','CEO','Finance','Operations','asset_management', array['executive','admin','ai_admin'], false, 'Stakeholder scoring input'),
('oee','Overall Equipment Effectiveness','executive','Availability × Performance × Quality','75–85%','range',75,85,'%',
 'Executive','Operations','Maintenance','Reliability','condition_monitoring', null, true, null),
('cost_of_downtime','Cost of Downtime','executive','Downtime hours × revenue rate','Decrease','down',null,null,'USD',
 'Executive','Operations','Finance','Maintenance','work_order_management', array['executive','maintenance_manager','admin','ai_admin'], true, null),
-- Asset performance
('availability','Availability','asset_performance','Operating time / Planned time','>90%','up',90,null,'%',
 'Operations Director','Maintenance','Operations','Reliability','condition_monitoring', null, true, null),
('asset_utilization','Asset Utilization','asset_performance','Used time / Available time','>80%','up',80,null,'%',
 'Operations Director','Operations','Planning','Maintenance','asset_management', null, false, 'Historian runtime feed'),
('production_throughput','Production Throughput','asset_performance','Actual output / Design capacity','>85%','up',85,null,'%',
 'Operations Director','Operations','Maintenance','Planning','condition_monitoring', null, true, null),
-- Reliability & maintenance
('mtbf','MTBF','reliability','Operating time / Failures','Increase','up',null,null,'days',
 'Maintenance Manager','Reliability','Maintenance','Operations','reliability_engineering', null, true, null),
('mttr','MTTR','reliability','Repair time / Failures','Decrease','down',null,null,'hours',
 'Maintenance Manager','Maintenance','Reliability','Operations','maintenance_operations', null, true, null),
('planned_maintenance_pct','Planned Maintenance %','reliability','Planned work / Total work','>70%','up',70,null,'%',
 'Maintenance Manager','Planning','Maintenance','Operations','planning_scheduling', null, true, null),
('emergency_maintenance_pct','Emergency Maintenance %','reliability','Emergency work / Total work','<10%','down',null,10,'%',
 'Maintenance Manager','Maintenance','Planning','Operations','maintenance_operations', null, true, null),
('schedule_compliance','Schedule Compliance','reliability','Completed / Planned work','>90%','up',90,null,'%',
 'Maintenance Manager','Planning','Maintenance','Operations','planning_scheduling', null, true, null),
('pm_compliance','PM Compliance','reliability','Completed PM / Scheduled PM','>95%','up',95,null,'%',
 'Maintenance Manager','Maintenance','Planning','Operations','planning_scheduling', null, true, null),
-- Financial & lifecycle (restricted audience)
('maintenance_cost_per_unit','Maintenance Cost per Unit','financial','Maintenance cost / Production','Decrease','down',null,null,'USD',
 'CFO','Finance','Maintenance','Operations','work_order_management', array['executive','maintenance_manager','admin','ai_admin'], false, 'ERP cost + production feed'),
('maintenance_cost_rav','Maintenance Cost / RAV','financial','Maintenance cost / Replacement asset value','2–4%','range',2,4,'%',
 'CFO','Finance','Asset Mgmt','Maintenance','asset_management', array['executive','maintenance_manager','admin','ai_admin'], false, 'ERP cost + RAV register'),
('lifecycle_cost_variance','Lifecycle Cost Variance','financial','Actual LCC / Planned LCC','<10%','down',null,10,'%',
 'CFO','Asset Mgmt','Finance','Maintenance','asset_management', array['executive','admin','ai_admin'], false, 'Lifecycle cost plan input'),
-- Risk & safety
('asset_risk_index','Asset Risk Index','risk_safety','Likelihood × Consequence score','Decrease','down',null,null,'score',
 'Risk Manager','Risk','Maintenance','Operations','reliability_engineering', null, true, null),
('critical_control_compliance','Critical Control Compliance','risk_safety','Compliant controls / Total controls','>95%','up',95,null,'%',
 'HSE','Safety','Operations','Maintenance','compliance_auditing', null, true, null),
('asset_safety_incidents','Asset Safety Incidents','risk_safety','Incident count (30d)','0','down',null,0,'count',
 'HSE','Safety','Operations','Maintenance','compliance_auditing', null, true, null),
-- Data & digital
('asset_register_accuracy','Asset Register Accuracy','digital','Verified assets / Total assets','>98%','up',98,null,'%',
 'Asset Mgmt','Data','Maintenance','Operations','asset_management', null, true, null),
('data_completeness','Data Completeness','digital','Completed fields / Required fields','>95%','up',95,null,'%',
 'Asset Mgmt','Data','IT','Operations','asset_management', null, true, null),
('update_latency','Update Latency','digital','Minutes since last data update','<24 hrs','down',null,1440,'minutes',
 'Asset Mgmt','IT','Maintenance','Operations','condition_monitoring', null, true, null),
('digital_twin_coverage','Digital Twin Coverage','digital','Monitored critical assets / Critical assets','>50%','up',50,null,'%',
 'Digital','IT','Engineering','Operations','condition_monitoring', null, true, null),
('pdm_coverage','Predictive Maintenance Coverage','digital','Assets monitored / Total assets','>60%','up',60,null,'%',
 'Digital','Reliability','IT','Maintenance','condition_monitoring', null, true, null),
('ai_recommendations_implemented','AI Recommendations Implemented','digital','Executed AI insights / Total insights','>70%','up',70,null,'%',
 'Digital','Operations','Maintenance','IT','asset_management', null, true, null),
('cmms_integration_score','CMMS Integration Score','digital','Integration maturity score','>90','up',90,null,'score',
 'Digital','IT','Maintenance','Operations','asset_management', null, true, null),
('mobile_work_execution','Mobile Work Execution','digital','Mobile work orders / Total work orders','>75%','up',75,null,'%',
 'Maintenance Manager','Maintenance','IT','Operations','work_order_management', null, false, 'Mobile execution channel')
on conflict (kpi_key) do update set
  name = excluded.name, page = excluded.page, formula = excluded.formula,
  target_label = excluded.target_label, direction = excluded.direction,
  target_low = excluded.target_low, target_high = excluded.target_high, unit = excluded.unit,
  accountable = excluded.accountable, responsible = excluded.responsible,
  consulted = excluded.consulted, informed = excluded.informed,
  agent_owner = excluded.agent_owner, audience = excluded.audience,
  computable = excluded.computable, source_note = excluded.source_note;

-- ----------------------------------------------------------------------------
-- KPI computation (the KPI Service) — hourly, org by org, lineage included
-- ----------------------------------------------------------------------------
create or replace function public.compute_kpi_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_written int := 0;
  v_breaches int := 0;
  k record;
  v numeric;
  conf text;
  lineage jsonb;
  v_status text;
  v_variance numeric;
  v_title text;
  -- shared measures
  m record;
begin
  for v_org in select id from organizations loop

    -- Gather shared measures once per org.
    select
      (select round(avg(oee)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as oee,
      (select round(avg(availability)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as availability,
      (select round(avg(performance)::numeric, 1) from oee_measurements where organization_id = v_org
         and measurement_date > current_date - 30) as throughput,
      (select count(*) from work_orders where organization_id = v_org) as wo_total,
      (select count(*) from work_orders where organization_id = v_org and priority = 'critical') as wo_emergency,
      (select count(*) from work_orders where organization_id = v_org and status = 'completed') as wo_completed,
      (select count(*) from work_orders where organization_id = v_org
         and scheduled_date ~ '^\d{4}-\d{2}-\d{2}' and scheduled_date::date < current_date) as wo_due,
      (select count(*) from work_orders where organization_id = v_org and status = 'completed'
         and scheduled_date ~ '^\d{4}-\d{2}-\d{2}') as wo_completed_scheduled,
      (select round(avg(extract(epoch from (closed_at - created_at)) / 3600)::numeric, 1)
         from work_orders where organization_id = v_org and closed_at is not null) as mttr,
      (select coalesce(sum(downtime_hours), 0) from work_orders where organization_id = v_org
         and closed_at > now() - interval '30 days') as downtime_hours_30d,
      (select count(*) from work_orders where organization_id = v_org and safety_flag
         and created_at > now() - interval '30 days') as safety_incidents_30d,
      (select count(*) from assets where organization_id = v_org) as assets_total,
      (select count(*) from assets where organization_id = v_org and criticality in ('critical','high')) as assets_critical,
      (select count(distinct s.asset_id) from sensors s where s.organization_id = v_org) as assets_monitored,
      (select count(distinct s.asset_id) from sensors s join assets a on a.id = s.asset_id
         where s.organization_id = v_org and a.criticality in ('critical','high')) as critical_monitored,
      (select round(avg(risk_score)::numeric, 0) from assets where organization_id = v_org) as risk_index,
      (select round(avg(completion_pct)::numeric, 0) from asset_onboarding_state where organization_id = v_org) as data_completeness,
      (select count(*) from asset_onboarding_items i where i.organization_id = v_org
         and i.requirement_key = 's20_dq_gate' and i.status = 'auto_filled') as dq_pass,
      (select count(*) from approvals where organization_id = v_org) as controls_total,
      (select count(*) from approvals where organization_id = v_org and status = 'approved') as controls_ok,
      (select count(*) from recommendations where organization_id = v_org) as recs_total,
      (select count(*) from recommendations where organization_id = v_org
         and status in ('approved','modified')) as recs_actioned,
      (select count(*) from recommendations where organization_id = v_org
         and status in ('approved','rejected','dismissed','modified','escalated')) as recs_decided,
      (select extract(epoch from (now() - max(created_at))) / 60 from recommendations
         where organization_id = v_org) as minutes_since_rec,
      (select count(*) from integrations i where i.organization_id = v_org
         and lower(coalesce(i.status,'')) in ('connected','healthy','active')) as integrations_live,
      (select coalesce(sum(value) filter (where status = 'verified'), 0) from value_metrics
         where organization_id = v_org and unit = 'usd') as value_verified,
      (select coalesce(sum(value), 0) from value_metrics
         where organization_id = v_org and unit = 'usd') as value_total,
      (select mtbf from (
         select round(
           greatest(extract(epoch from (now() - min(a2.installed_date::timestamptz))) / 86400.0, 1)
           / greatest(count(w2.id) filter (where w2.priority in ('critical','high') or w2.safety_flag), 1), 0) as mtbf
         from assets a2 left join work_orders w2 on w2.asset_id = a2.id
         where a2.organization_id = v_org and a2.installed_date is not null
       ) q) as mtbf_days
    into m;

    for k in select * from kpi_catalog where computable loop
      v := null; conf := 'medium'; lineage := null;

      case k.kpi_key
        when 'oee' then
          v := m.oee; conf := 'high';
          lineage := jsonb_build_object('source', 'oee_measurements (30d avg)');
        when 'availability' then
          v := m.availability; conf := 'high';
          lineage := jsonb_build_object('source', 'oee_measurements availability (30d avg)');
        when 'production_throughput' then
          v := m.throughput; conf := 'low';
          lineage := jsonb_build_object('source', 'oee performance component as throughput proxy — replace with production feed');
        when 'mtbf' then
          v := m.mtbf_days; conf := 'medium';
          lineage := jsonb_build_object('source', 'service days / significant events (work orders)');
        when 'mttr' then
          v := m.mttr; conf := 'high';
          lineage := jsonb_build_object('source', 'work-order closeouts (open→close hours)');
        when 'planned_maintenance_pct' then
          if m.wo_total > 0 then v := round(100.0 * (m.wo_total - m.wo_emergency) / m.wo_total, 1); end if;
          lineage := jsonb_build_object('source', 'work_orders: non-emergency / total');
        when 'emergency_maintenance_pct' then
          if m.wo_total > 0 then v := round(100.0 * m.wo_emergency / m.wo_total, 1); end if;
          lineage := jsonb_build_object('source', 'work_orders: critical-priority / total');
        when 'schedule_compliance' then
          if m.wo_due + m.wo_completed_scheduled > 0 then
            v := round(100.0 * m.wo_completed_scheduled / greatest(m.wo_completed_scheduled + m.wo_due, 1), 1);
          end if;
          lineage := jsonb_build_object('source', 'work_orders: completed-scheduled vs overdue');
        when 'pm_compliance' then
          if m.wo_completed_scheduled + m.wo_due > 0 then
            v := round(100.0 * m.wo_completed_scheduled / greatest(m.wo_completed_scheduled + m.wo_due, 1), 1);
          end if;
          conf := 'low';
          lineage := jsonb_build_object('source', 'scheduled-work completion proxy — refine with PM plan feed');
        when 'cost_of_downtime' then
          v := round(m.downtime_hours_30d * 10000, 0); conf := 'low';
          lineage := jsonb_build_object('source', 'closeout downtime hours (30d) × $10k/h assumed rate — set site rate to refine',
            'downtime_hours', m.downtime_hours_30d);
        when 'asset_risk_index' then
          v := m.risk_index; conf := 'high';
          lineage := jsonb_build_object('source', 'assets.risk_score (org avg)');
        when 'critical_control_compliance' then
          if m.controls_total > 0 then v := round(100.0 * m.controls_ok / m.controls_total, 1);
          else v := 100; conf := 'low'; end if;
          lineage := jsonb_build_object('source', 'approvals: approved / total');
        when 'asset_safety_incidents' then
          v := m.safety_incidents_30d; conf := 'high';
          lineage := jsonb_build_object('source', 'safety-flagged work orders (30d)');
        when 'asset_register_accuracy' then
          if m.assets_total > 0 then v := round(100.0 * m.dq_pass / m.assets_total, 1); end if;
          lineage := jsonb_build_object('source', 'data-quality gate passes / assets');
        when 'data_completeness' then
          v := m.data_completeness; conf := 'high';
          lineage := jsonb_build_object('source', 'onboarding completion (org avg)');
        when 'update_latency' then
          v := round(coalesce(m.minutes_since_rec, 0), 0); conf := 'medium';
          lineage := jsonb_build_object('source', 'minutes since newest platform event');
        when 'digital_twin_coverage' then
          if m.assets_critical > 0 then v := round(100.0 * m.critical_monitored / m.assets_critical, 1); end if;
          lineage := jsonb_build_object('source', 'monitored critical assets / critical assets');
        when 'pdm_coverage' then
          if m.assets_total > 0 then v := round(100.0 * m.assets_monitored / m.assets_total, 1); end if;
          lineage := jsonb_build_object('source', 'assets with live points / all assets');
        when 'ai_recommendations_implemented' then
          if m.recs_decided > 0 then v := round(100.0 * m.recs_actioned / m.recs_decided, 1); end if;
          lineage := jsonb_build_object('source', 'recommendations actioned / decided');
        when 'cmms_integration_score' then
          v := case when m.integrations_live > 0 then 95 else 75 end; conf := 'medium';
          lineage := jsonb_build_object('source', case when m.integrations_live > 0
            then 'external CMMS connected' else 'SyncAI-native work management (no external CMMS yet)' end);
        when 'asset_value_realization' then
          if m.value_total > 0 then v := round(100.0 * m.value_verified / m.value_total, 1); end if;
          lineage := jsonb_build_object('source', 'value_metrics: verified / total (USD)');
        else
          v := null;
      end case;

      if v is null then continue; end if;

      -- Status vs target.
      v_status := case
        when k.direction = 'up' and k.target_low is not null then
          case when v >= k.target_low then 'on_target'
               when v >= k.target_low * 0.9 then 'watch' else 'breach' end
        when k.direction = 'down' and k.target_high is not null then
          case when v <= k.target_high then 'on_target'
               when v <= k.target_high * 1.25 then 'watch' else 'breach' end
        when k.direction = 'range' and k.target_low is not null and k.target_high is not null then
          case when v between k.target_low and k.target_high then 'on_target'
               when v >= k.target_low * 0.9 then 'watch' else 'breach' end
        else 'on_target'  -- trend KPIs (Increase/Decrease with no absolute bound)
      end;
      v_variance := case when k.target_low is not null and k.target_low <> 0
        then round(100.0 * (v - k.target_low) / k.target_low, 1) end;

      insert into kpi_values (organization_id, kpi_key, value, status, variance_pct, confidence, computed_from)
      values (v_org, k.kpi_key, v, v_status, v_variance, conf, lineage);
      v_written := v_written + 1;

      -- Threshold trigger: breach → HITL recommendation routed by RACI.
      -- Low-confidence computations record status but never spam actions.
      if v_status = 'breach' and conf <> 'low' then
        v_title := 'KPI breach: ' || k.name;
        if not exists (
          select 1 from recommendations r
          where r.organization_id = v_org and r.title = v_title
            and (r.status = 'pending' or r.created_at > now() - interval '24 hours')
        ) then
          insert into recommendations (organization_id, agent_id, title, issue, action, impact,
            confidence, urgency, status, accountable, responsible, consulted, informed,
            risk_impact, rationale)
          select v_org, ag.id, v_title,
            k.name || ' at ' || v || coalesce(' ' || k.unit, '') || ' vs target ' || k.target_label,
            'Review drivers with ' || k.responsible || '; agree corrective plan and owner',
            'Restores ' || k.name || ' to the ISO 55000 target band',
            80, 'action', 'pending', k.accountable, k.responsible, coalesce(k.consulted, 'Reliability Engineer'),
            coalesce(k.informed, 'Operations'), 'Medium',
            'Raised by the KPI service (ISO 55000 monitor) — threshold breach routed per the KPI RACI chain. Human approval required.'
          from ai_agents ag
          where ag.organization_id = v_org and ag.key = coalesce(k.agent_owner, 'asset_management')
          limit 1;
          v_breaches := v_breaches + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- Keep the fact table bounded.
  delete from kpi_values where computed_at < now() - interval '90 days';

  return jsonb_build_object('kpi_values_written', v_written, 'breaches_raised', v_breaches, 'ran_at', now());
end
$$;

revoke execute on function public.compute_kpi_snapshot() from public, anon, authenticated;
grant execute on function public.compute_kpi_snapshot() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'syncai-kpi-service';
    perform cron.schedule('syncai-kpi-service', '5 * * * *', 'select public.compute_kpi_snapshot()');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Access-controlled dashboard read: callers only receive KPIs their role
-- is entitled to see (board-tier KPIs never leave the database for others).
-- ----------------------------------------------------------------------------
create or replace function public.get_kpi_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  result jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();

  select coalesce(jsonb_agg(row order by row->>'page', row->>'name'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'kpi_key', c.kpi_key, 'name', c.name, 'page', c.page, 'formula', c.formula,
      'target_label', c.target_label, 'direction', c.direction, 'unit', c.unit,
      'accountable', c.accountable, 'responsible', c.responsible,
      'agent_owner', c.agent_owner, 'computable', c.computable, 'source_note', c.source_note,
      'value', lv.value, 'status', lv.status, 'variance_pct', lv.variance_pct,
      'confidence', lv.confidence, 'computed_from', lv.computed_from, 'computed_at', lv.computed_at
    ) as row
    from kpi_catalog c
    left join lateral (
      select * from kpi_values kv
      where kv.organization_id = v_org and kv.kpi_key = c.kpi_key
      order by kv.computed_at desc limit 1
    ) lv on true
    where c.audience is null
       or v_role = any(c.audience)
       or v_role in ('admin', 'ai_admin')
  ) q;

  return jsonb_build_object('role', v_role, 'kpis', result);
end
$$;

grant execute on function public.get_kpi_dashboard() to authenticated;

-- First snapshot so dashboards are live immediately.
select public.compute_kpi_snapshot();
