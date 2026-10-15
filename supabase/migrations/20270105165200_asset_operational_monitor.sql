-- C8.03 — exact-asset operational monitoring across the four canonical
-- evidence streams named by the capability register.
--
-- This migration deliberately creates no monitoring state. It reads condition
-- evidence, work history, operating/production evidence and risk signals from
-- their existing systems of record. Absence stays visible, demonstrated
-- production is never replaced with nameplate capacity, and risk sensitivity
-- is enforced through can_read_risk.

create index if not exists idx_condition_readings_asset_taken
  on public.condition_readings(organization_id, asset_id, taken_at desc)
  where asset_id is not null;

create index if not exists idx_work_orders_asset_history
  on public.work_orders(organization_id, asset_id, created_at desc)
  where asset_id is not null;

create index if not exists idx_production_records_asset_period
  on public.production_records(organization_id, asset_id, period_start desc)
  where asset_id is not null;

create or replace function public.get_asset_operational_monitor(
  p_asset_id uuid,
  p_window_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.app_current_org();
  v_days integer:=least(greatest(coalesce(p_window_days,90),1),730);
  v_from timestamptz;
  v_asset jsonb;
  v_condition jsonb;
  v_work jsonb;
  v_production jsonb;
  v_risk jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select jsonb_build_object(
    'id',a.id,
    'tag',coalesce(nullif(a.asset_tag,''),a.tag),
    'name',a.name,
    'criticality',a.criticality,
    'status',a.status
  ) into v_asset
  from public.assets a
  where a.id=p_asset_id and a.organization_id=v_org;

  if v_asset is null then
    return jsonb_build_object('error','asset not found');
  end if;

  v_from:=now()-make_interval(days=>v_days);

  with reading_population as (
    select cr.*,s.name sensor_name,s.signal_type,s.unit
    from public.condition_readings cr
    join public.sensors s on s.id=cr.sensor_id
      and s.organization_id=cr.organization_id
    where cr.organization_id=v_org and cr.asset_id=p_asset_id
      and cr.taken_at>=v_from and cr.taken_at<=now()
  ), alert_population as (
    select ca.*,s.name sensor_name,s.signal_type,s.unit
    from public.condition_alerts ca
    join public.sensors s on s.id=ca.sensor_id
      and s.organization_id=ca.organization_id
    where ca.organization_id=v_org and ca.asset_id=p_asset_id
      and ca.triggered_at>=v_from and ca.triggered_at<=now()
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'readings',(select count(*) from reading_population),
      'sensors',(select count(distinct sensor_id) from reading_population),
      'goodReadings',(select count(*) from reading_population where quality='good'),
      'suspectOrBadReadings',(select count(*) from reading_population where quality in ('suspect','bad','substituted')),
      'openAlerts',(select count(*) from alert_population where cleared_at is null),
      'alarmAlerts',(select count(*) from alert_population where severity='alarm' and cleared_at is null),
      'latestReadingAt',(select max(taken_at) from reading_population)
    ),
    'readings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'sensorId',r.sensor_id,'sensor',r.sensor_name,
      'signalType',r.signal_type,'value',r.value,'unit',r.unit,
      'quality',r.quality,'takenAt',r.taken_at,
      'sourceSystem',r.source_system
    ) order by r.taken_at desc,r.id desc)
      from (select * from reading_population order by taken_at desc,id desc limit 40) r),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'sensorId',a.sensor_id,'sensor',a.sensor_name,
      'signalType',a.signal_type,'severity',a.severity,
      'triggeredValue',a.triggered_value,'limitValue',a.limit_value,
      'unit',a.unit,'triggeredAt',a.triggered_at,'clearedAt',a.cleared_at,
      'acknowledgedAt',a.acknowledged_at,'workOrderId',a.work_order_id
    ) order by a.triggered_at desc,a.id desc)
      from (select * from alert_population order by triggered_at desc,id desc limit 30) a),'[]'::jsonb),
    'basis','Canonical sensor readings and threshold-crossing alerts in the selected window. Quality and missing evidence remain explicit; no composite health score is inferred.'
  ) into v_condition;

  with work_population as (
    select w.*
    from public.work_orders w
    where w.organization_id=v_org and w.asset_id=p_asset_id
      and coalesce(w.completed_at,w.created_at)>=v_from
      and w.created_at<=now()
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'orders',(select count(*) from work_population),
      'openOrders',(select count(*) from work_population where completed_at is null),
      'completedOrders',(select count(*) from work_population where completed_at is not null),
      'correctiveOrders',(select count(*) from work_population where work_type='corrective'),
      'safetyFlagged',(select count(*) from work_population where safety_flag),
      'latestActivityAt',(select max(coalesce(completed_at,updated_at,created_at)) from work_population)
    ),
    'orders',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'number',w.wo_number,'title',w.title,'status',w.status,
      'priority',w.priority,'workType',w.work_type,'safetyFlag',w.safety_flag,
      'productionImpact',w.production_impact,'createdAt',w.created_at,
      'completedAt',w.completed_at
    ) order by coalesce(w.completed_at,w.created_at) desc,w.id desc)
      from (select * from work_population order by coalesce(completed_at,created_at) desc,id desc limit 30) w),'[]'::jsonb),
    'basis','Canonical work-order history for the exact asset. Open and completed work are reported as recorded; the monitor does not create, change or close work.'
  ) into v_work;

  with state_population as (
    select s.*,
      greatest(s.started_at,v_from) clipped_start,
      least(coalesce(s.ended_at,now()),now()) clipped_end
    from public.operating_states s
    where s.organization_id=v_org and s.asset_id=p_asset_id
      and s.started_at<now() and coalesce(s.ended_at,now())>v_from
  ), state_totals as (
    select
      coalesce(sum(extract(epoch from (clipped_end-clipped_start))/3600.0)
        filter(where state='running'),0) running_hours,
      coalesce(sum(extract(epoch from (clipped_end-clipped_start))/3600.0)
        filter(where state in ('down_planned','down_unplanned','offline')),0) down_hours,
      count(*) state_rows,
      max(started_at) latest_state_at
    from state_population
  ), production_population as (
    select p.* from public.production_records p
    where p.organization_id=v_org and p.asset_id=p_asset_id
      and p.period_start>=v_from and p.period_end<=now()
  ), production_totals as (
    select coalesce(sum(units_produced),0) units,
      min(unit_of_measure) uom,count(distinct unit_of_measure) unit_count,
      count(*) record_count,max(period_end) latest_production_at
    from production_population
  ), measured as (
    select st.*,pt.*,
      case when st.running_hours>0 and pt.record_count>0 and pt.unit_count=1
        then pt.units/st.running_hours else null end demonstrated_rate
    from state_totals st cross join production_totals pt
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'runningHours',round(m.running_hours::numeric,1),
      'downHours',round(m.down_hours::numeric,1),
      'stateRows',m.state_rows,'productionRecords',m.record_count,
      'productionUnits',case when m.record_count>0 and m.unit_count=1 then m.units else null end,
      'unitOfMeasure',case when m.unit_count=1 then m.uom else null end,
      'demonstratedRate',case when m.demonstrated_rate is null then null else round(m.demonstrated_rate::numeric,3) end,
      'estimatedUnitsLost',case when m.demonstrated_rate is null then null else round((m.down_hours*m.demonstrated_rate)::numeric,1) end,
      'measurementState',case when m.demonstrated_rate is not null then 'demonstrated_rate' else 'not_measurable' end,
      'measurementRefusal',case
        when m.state_rows=0 then 'No operating-state history is recorded in the selected window.'
        when m.running_hours<=0 then 'No running-state hours are recorded in the selected window.'
        when m.record_count=0 then 'No completed production records are recorded in the selected window.'
        when m.unit_count<>1 then 'Production records use multiple units and cannot be combined.'
        else null end,
      'latestStateAt',m.latest_state_at,'latestProductionAt',m.latest_production_at
    ),
    'states',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'state',s.state,'loadPct',s.load_pct,
      'startedAt',s.started_at,'endedAt',s.ended_at,
      'reasonCode',s.reason_code,'sourceSystem',s.source_system
    ) order by s.started_at desc,s.id desc)
      from (select * from state_population order by started_at desc,id desc limit 30) s),'[]'::jsonb),
    'basis','Production impact is downtime multiplied by this asset''s demonstrated production per running hour in the same window. Nameplate capacity is never substituted.',
    'authority','Evidence only; this monitor cannot change production state or operating limits.'
  ) into v_production
  from measured m;

  with visible_risks as (
    select r.*
    from public.risks r
    where r.organization_id=v_org and r.asset_id=p_asset_id
      and r.status not in ('closed','archived')
      and public.can_read_risk(r.id)
      and (
        coalesce(r.risk_velocity,0)>0
        or exists(select 1 from public.risk_indicators i
          where i.organization_id=v_org and i.risk_id=r.id and i.active
            and i.current_state in ('warning','critical'))
        or exists(select 1 from public.learning_events le
          where le.organization_id=v_org and le.risk_id=r.id
            and le.event_type='emerging_risk_detected' and le.created_at>=v_from)
      )
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'emergingRisks',(select count(*) from visible_risks),
      'warningIndicators',(select count(*) from public.risk_indicators i
        join visible_risks r on r.id=i.risk_id
        where i.organization_id=v_org and i.active and i.current_state='warning'),
      'criticalIndicators',(select count(*) from public.risk_indicators i
        join visible_risks r on r.id=i.risk_id
        where i.organization_id=v_org and i.active and i.current_state='critical'),
      'latestSignalAt',(select max(i.observed_at) from public.risk_indicators i
        join visible_risks r on r.id=i.risk_id where i.organization_id=v_org and i.active)
    ),
    'risks',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'title',r.title,'objectiveAtRisk',r.objective_at_risk,
      'status',r.status,'level',r.current_risk_level,'score',r.current_risk_score,
      'velocity',r.risk_velocity,'decisionAction',r.decision_action,
      'reviewDate',r.review_date,'updatedAt',r.updated_at,
      'indicators',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'name',i.name,'state',i.current_state,'value',i.current_value,
        'unit',i.unit,'observedAt',i.observed_at,'sourceSystem',i.source_system
      ) order by i.observed_at desc nulls last,i.id)
        from public.risk_indicators i
        where i.organization_id=v_org and i.risk_id=r.id and i.active
          and i.current_state in ('warning','critical')),'[]'::jsonb)
    ) order by r.risk_velocity desc nulls last,r.current_risk_score desc nulls last,r.id)
      from visible_risks r),'[]'::jsonb),
    'basis','Only sensitivity-authorized risks for the exact asset are shown. Emerging means positive velocity, a warning/critical indicator, or a retained emerging-risk event in the selected window; it is not an approval or risk acceptance.'
  ) into v_risk;

  return jsonb_build_object(
    'asset',v_asset,'windowDays',v_days,'windowStart',v_from,
    'condition',v_condition,'work',v_work,'production',v_production,'risk',v_risk,
    'sources',jsonb_build_object(
      'condition',jsonb_build_array('sensors','condition_readings','condition_alerts'),
      'work',jsonb_build_array('work_orders'),
      'production',jsonb_build_array('operating_states','production_records'),
      'risk',jsonb_build_array('risks','risk_indicators','learning_events')
    ),
    'authority',jsonb_build_object(
      'readOnly',true,'mayCreateWork',false,'mayChangeWork',false,
      'mayApprove',false,'mayAcceptRisk',false,'mayCommitSpend',false,
      'mayChangeOperatingLimits',false,'mayReturnToService',false
    )
  );
end $$;

revoke all on function public.get_asset_operational_monitor(uuid,integer)
  from public,anon,service_role;
grant execute on function public.get_asset_operational_monitor(uuid,integer)
  to authenticated;

comment on function public.get_asset_operational_monitor(uuid,integer) is
  'C8.03 read-only exact-asset reconciliation of canonical condition, work, production-impact and sensitivity-filtered emerging-risk evidence.';

notify pgrst,'reload schema';
