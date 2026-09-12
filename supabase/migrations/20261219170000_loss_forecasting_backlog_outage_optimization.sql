-- ============================================================================
-- C9.05 — Stage 5: loss forecasting, risk-based backlog, outage optimization.
--
-- One governed planning run composes canonical evidence already in SyncAI:
-- operating_states + production_records for a transparent loss forecast,
-- work_orders + assets + risks for backlog priority, and outage_windows +
-- outage_work + material/approval constraints for opportunity scope options.
--
-- Forecasts are refused unless operating-state coverage, production evidence,
-- and repeat unplanned-down observations are sufficient. Mixed production
-- units are never added together. Outage candidates are options only: this RPC
-- cannot add work, freeze scope, release a schedule, approve work, or change an
-- operating limit. Human planning authority remains where it already lives.
-- ============================================================================

create table if not exists public.maintenance_optimization_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  history_days int not null check (history_days between 30 and 730),
  horizon_days int not null check (horizon_days between 7 and 365),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  status text not null default 'draft' check (status in ('draft','reviewed','superseded')),
  generated_by uuid not null references auth.users(id),
  generated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text
);

create index if not exists idx_maintenance_optimization_runs_org_time
  on public.maintenance_optimization_runs(organization_id, generated_at desc);

alter table public.maintenance_optimization_runs enable row level security;
drop policy if exists maintenance_optimization_runs_read
  on public.maintenance_optimization_runs;
create policy maintenance_optimization_runs_read
  on public.maintenance_optimization_runs for select to authenticated
  using (organization_id = public.app_current_org());

-- Recording a planning window is a human act. It creates no work, approval,
-- execution authority, or production commitment.
create or replace function public.create_outage_window(
  p_window_key text,
  p_title text,
  p_kind text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_scope text default null,
  p_site_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;

  select role into v_role from public.user_profiles where id = auth.uid();
  -- ai_admin is the platform's AI-operator identity, not a named human
  -- planner, and therefore cannot create the human-authored window record.
  if v_role not in ('planner','maintenance_manager','reliability_engineer','admin') then
    return jsonb_build_object('error','recording an outage window requires planning or maintenance authority');
  end if;
  if coalesce(length(btrim(p_window_key)),0) < 2 or coalesce(length(btrim(p_title)),0) < 3 then
    return jsonb_build_object('error','window key and title are required');
  end if;
  if p_kind not in ('shutdown','turnaround','opportunity','campaign') then
    return jsonb_build_object('error','invalid outage kind');
  end if;
  if p_ends_at <= p_starts_at then
    return jsonb_build_object('error','outage end must be after its start');
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and organization_id = v_org
  ) then
    return jsonb_build_object('error','site not found');
  end if;

  insert into public.outage_windows(
    organization_id,site_id,window_key,title,kind,starts_at,ends_at,scope,status
  ) values (
    v_org,p_site_id,btrim(p_window_key),btrim(p_title),p_kind,
    p_starts_at,p_ends_at,nullif(btrim(p_scope),''),'planned'
  ) returning id into v_id;

  return jsonb_build_object(
    'id',v_id,'window_key',btrim(p_window_key),'status','planned',
    'authority','human-recorded planning window; no work or scope was released'
  );
exception when unique_violation then
  return jsonb_build_object('error','an outage window with this key already exists');
end
$$;

revoke all on function public.create_outage_window(text,text,text,timestamptz,timestamptz,text,uuid)
  from public, anon;
grant execute on function public.create_outage_window(text,text,text,timestamptz,timestamptz,text,uuid)
  to authenticated;

create or replace function public.generate_maintenance_optimization_run(
  p_history_days int default 180,
  p_horizon_days int default 90,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_history int := least(greatest(coalesce(p_history_days,180),30),730);
  v_horizon int := least(greatest(coalesce(p_horizon_days,90),7),365);
  v_limit int := least(greatest(coalesce(p_limit,50),1),100);
  v_from timestamptz;
  v_right jsonb;
  v_forecast jsonb;
  v_backlog jsonb;
  v_windows jsonb;
  v_result jsonb;
  v_id uuid;
  v_source text;
begin
  if v_org is null or auth.uid() is null then
    return jsonb_build_object('error','forbidden');
  end if;

  v_right := public.check_decision_right('produce_schedule_options');
  if coalesce((v_right->>'allowed')::boolean,false) is not true then
    return jsonb_build_object(
      'error',coalesce(v_right->>'reason','planning options are not permitted'),
      'decision_right',v_right
    );
  end if;

  v_from := now() - make_interval(days => v_history);
  v_source := case when exists (
    select 1 from public.connectors
    where organization_id = v_org and connector_key = 'plant_historian' and enabled
  ) then 'connector_backed' else 'seed_sim_or_import' end;

  -- Expected unplanned hours are the observed unplanned share of covered state
  -- time projected onto the requested horizon. The rate is demonstrated output
  -- per running hour, never nameplate capacity.
  with state_history as (
    select s.asset_id,
      sum(extract(epoch from (least(coalesce(s.ended_at,now()),now())
        - greatest(s.started_at,v_from))) / 3600.0) as covered_hours,
      sum(case when s.state='running' then extract(epoch from
        (least(coalesce(s.ended_at,now()),now()) - greatest(s.started_at,v_from))) / 3600.0 else 0 end) as running_hours,
      sum(case when s.state='down_unplanned' then extract(epoch from
        (least(coalesce(s.ended_at,now()),now()) - greatest(s.started_at,v_from))) / 3600.0 else 0 end) as unplanned_hours,
      count(*) filter (where s.state='down_unplanned') as unplanned_events
    from public.operating_states s
    where s.organization_id=v_org and coalesce(s.ended_at,now())>v_from
      and s.started_at<now()
    group by s.asset_id
  ), production as (
    select p.asset_id,sum(p.units_produced) units,min(p.unit_of_measure) uom,
      count(*) records,count(distinct p.unit_of_measure) unit_count
    from public.production_records p
    where p.organization_id=v_org and p.asset_id is not null
      and p.period_end>v_from and p.period_start<now()
    group by p.asset_id
  ), assessed as (
    select a.id,a.tag,a.name,a.criticality,h.covered_hours,h.running_hours,
      h.unplanned_hours,h.unplanned_events,p.units,p.uom,p.records,p.unit_count,
      h.covered_hours / (v_history*24.0) as coverage,
      p.units / nullif(h.running_hours,0) as demonstrated_rate,
      (v_horizon*24.0) * h.unplanned_hours / nullif(h.covered_hours,0) as expected_down
    from public.assets a
    left join state_history h on h.asset_id=a.id
    left join production p on p.asset_id=a.id
    where a.organization_id=v_org
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_id',x.id,'tag',x.tag,'asset',x.name,'criticality',x.criticality,
    'status',case when x.covered_hours is null then 'not_assessable'
      when x.coverage<0.25 then 'not_assessable'
      when x.running_hours<=0 or coalesce(x.records,0)<2 or coalesce(x.unit_count,0)<>1 then 'not_assessable'
      when x.unplanned_events<2 then 'not_assessable' else 'forecast' end,
    'state_coverage_pct',round((coalesce(x.coverage,0)*100)::numeric,1),
    'history_unplanned_events',coalesce(x.unplanned_events,0),
    'history_unplanned_hours',round(coalesce(x.unplanned_hours,0)::numeric,1),
    'demonstrated_rate',case when x.demonstrated_rate is null then null else round(x.demonstrated_rate::numeric,3) end,
    'unit_of_measure',x.uom,
    'expected_unplanned_hours',case when x.coverage>=0.25 and x.running_hours>0 and coalesce(x.records,0)>=2
      and coalesce(x.unit_count,0)=1 and x.unplanned_events>=2 then round(x.expected_down::numeric,1) else null end,
    'expected_units_at_risk',case when x.coverage>=0.25 and x.running_hours>0 and coalesce(x.records,0)>=2
      and coalesce(x.unit_count,0)=1 and x.unplanned_events>=2 then round((x.expected_down*x.demonstrated_rate)::numeric,1) else null end,
    'refusal',case
      when x.covered_hours is null then 'No operating-state history is available.'
      when x.coverage<0.25 then 'Operating-state coverage is below 25%; extrapolation is refused.'
      when x.running_hours<=0 then 'No demonstrated running hours exist.'
      when coalesce(x.records,0)<2 then 'Fewer than two production records exist.'
      when coalesce(x.unit_count,0)<>1 then 'Production units conflict and cannot be combined.'
      when x.unplanned_events<2 then 'Fewer than two unplanned-down observations exist; a repeat rate is not established.'
      else null end,
    'basis','Observed unplanned share of covered state time × horizon; demonstrated production per running hour. Not nameplate.'
  ) order by x.expected_down*x.demonstrated_rate desc nulls last,x.name),'[]'::jsonb)
  into v_forecast from assessed x;

  -- No invented composite "risk score": linked ISO 31000 risk is shown where
  -- it exists; otherwise the ordering is explicitly a priority/criticality
  -- proxy with safety, due-date and age tie-breakers.
  select coalesce(jsonb_agg(jsonb_build_object(
    'work_order_id',q.id,'wo_number',q.wo_number,'title',q.title,
    'asset_id',q.asset_id,'asset',q.asset,'tag',q.tag,
    'priority',q.priority,'criticality',q.criticality,
    'current_risk_score',q.current_risk_score,
    'risk_basis',case when q.current_risk_score is not null then 'linked_iso31000_risk'
      when q.legacy_risk_score is not null then 'recorded_work_order_risk'
      else 'priority_criticality_proxy_not_a_risk_score' end,
    'safety_flag',q.safety_flag,'due_date',q.due_date,'age_days',q.age_days,
    'planned_hours',q.planned_hours,'sized',q.planned_hours is not null and q.planned_hours>0,
    'ranking_basis',jsonb_build_array(
      case when q.safety_flag then 'safety flagged' else 'not safety flagged' end,
      'priority '||q.priority,'asset criticality '||q.criticality,
      case when q.due_date<now() then 'overdue' else 'not overdue' end,
      q.age_days||' days open')
  ) order by q.current_risk_score desc nulls last,q.safety_flag desc,
    q.priority_weight desc,q.criticality_weight desc,
    (q.due_date<now()) desc,q.age_days desc),'[]'::jsonb)
  into v_backlog
  from (
    select w.id,w.wo_number,w.title,w.asset_id,a.name asset,a.tag,
      coalesce(w.priority,'medium') priority,coalesce(a.criticality,'unrated') criticality,
      r.current_risk_score,nullif(w.risk_score,0) legacy_risk_score,
      coalesce(w.safety_flag,false) safety_flag,w.due_date,
      greatest(0,extract(day from now()-w.created_at)::int) age_days,
      coalesce(nullif(w.planned_hours,0),nullif(w.estimated_hours,0)) planned_hours,
      case coalesce(w.priority,'medium') when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end priority_weight,
      case coalesce(a.criticality,'unrated') when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end criticality_weight
    from public.work_orders w
    left join public.assets a on a.id=w.asset_id and a.organization_id=v_org
    left join public.risks r on r.id=w.risk_id and r.organization_id=v_org
    where w.organization_id=v_org and w.completed_at is null
    order by r.current_risk_score desc nulls last,
      coalesce(w.safety_flag,false) desc,
      priority_weight desc,criticality_weight desc,
      (w.due_date<now()) desc,
      greatest(0,extract(day from now()-w.created_at)::int) desc
    limit v_limit
  ) q;

  -- Candidate work must be sized, fit the remaining elapsed window, have no
  -- known material shortfall, and carry no unresolved approval/safety gate.
  -- This is a constrained option list, not a released or "optimal" schedule.
  select coalesce(jsonb_agg(jsonb_build_object(
    'window_id',ow.id,'window_key',ow.window_key,'title',ow.title,'kind',ow.kind,
    'starts_at',ow.starts_at,'ends_at',ow.ends_at,'status',ow.status,
    'window_hours',round(ow.window_hours::numeric,1),
    'included_hours',round(ow.included_hours::numeric,1),
    'remaining_hours',round(greatest(ow.window_hours-ow.included_hours,0)::numeric,1),
    'included_work_orders',ow.included_count,'late_additions',ow.late_count,
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'work_order_id',c.id,'wo_number',c.wo_number,'title',c.title,
      'asset',c.asset,'priority',c.priority,'criticality',c.criticality,
      'planned_hours',c.hours,'current_risk_score',c.current_risk_score,
      'selection_basis','fits remaining elapsed window; no known material, approval, or safety-gate blocker'
    ) order by c.current_risk_score desc nulls last,c.priority_weight desc,c.criticality_weight desc,c.age_days desc)
      from (
        select w.id,w.wo_number,w.title,a.name asset,coalesce(w.priority,'medium') priority,
          coalesce(a.criticality,'unrated') criticality,r.current_risk_score,
          coalesce(nullif(w.planned_hours,0),nullif(w.estimated_hours,0)) hours,
          case coalesce(w.priority,'medium') when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end priority_weight,
          case coalesce(a.criticality,'unrated') when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end criticality_weight,
          greatest(0,extract(day from now()-w.created_at)::int) age_days
        from public.work_orders w
        left join public.assets a on a.id=w.asset_id and a.organization_id=v_org
        left join public.risks r on r.id=w.risk_id and r.organization_id=v_org
        where w.organization_id=v_org and w.completed_at is null
          and not exists (select 1 from public.outage_work x where x.outage_window_id=ow.id and x.work_order_id=w.id)
          and coalesce(nullif(w.planned_hours,0),nullif(w.estimated_hours,0))>0
          and coalesce(nullif(w.planned_hours,0),nullif(w.estimated_hours,0))<=greatest(ow.window_hours-ow.included_hours,0)
          and not exists (select 1 from public.work_order_materials m where m.work_order_id=w.id and m.status in ('short','requested'))
          and not exists (select 1 from public.approvals ap where ap.work_order_id=w.id and ap.status in ('required','pending'))
          and not exists (
            select 1 from public.recommendation_screenings rs
            join public.recommendations rec on rec.id=rs.recommendation_id
            where rec.id=w.recommendation_id and rs.requires_gatekeeper and rs.gatekeeper_attested_at is null
          )
        order by current_risk_score desc nulls last,priority_weight desc,criticality_weight desc,age_days desc
        limit 12
      ) c),'[]'::jsonb),
    'authority','recommendation only; adding work and releasing/finalizing outage scope remain human-controlled'
  ) order by ow.starts_at),'[]'::jsonb)
  into v_windows
  from (
    select w.*,
      extract(epoch from (w.ends_at-w.starts_at))/3600.0 window_hours,
      coalesce(sum(coalesce(nullif(wo.planned_hours,0),nullif(wo.estimated_hours,0),0)),0) included_hours,
      count(x.id) included_count,count(x.id) filter(where x.added_after_freeze) late_count
    from public.outage_windows w
    left join public.outage_work x on x.outage_window_id=w.id
    left join public.work_orders wo on wo.id=x.work_order_id
    where w.organization_id=v_org and w.status in ('planned','frozen') and w.ends_at>now()
    group by w.id
  ) ow;

  v_result := jsonb_build_object(
    'register_ref','C9.05','history_days',v_history,'horizon_days',v_horizon,
    'source_posture',v_source,'generated_at',now(),
    'loss_forecast',v_forecast,'risk_backlog',v_backlog,'outage_options',v_windows,
    'controls',jsonb_build_object(
      'forecast','requires >=25% state coverage, >=2 production records, one unit, and >=2 unplanned events',
      'backlog','linked risk first; priority/criticality proxy is labelled and never presented as a risk score',
      'outage','candidate options only; no scope release, approval, scheduling, or execution mutation',
      'mixed_units','never summed')
  );

  update public.maintenance_optimization_runs set status='superseded'
  where organization_id=v_org and status='draft';
  insert into public.maintenance_optimization_runs(
    organization_id,history_days,horizon_days,result,generated_by
  ) values (v_org,v_history,v_horizon,v_result,auth.uid()) returning id into v_id;

  return jsonb_build_object('run_id',v_id,'status','draft','result',v_result);
end
$$;

revoke all on function public.generate_maintenance_optimization_run(int,int,int)
  from public, anon;
grant execute on function public.generate_maintenance_optimization_run(int,int,int)
  to authenticated;

create or replace function public.get_latest_maintenance_optimization_run()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden')
    else coalesce((select jsonb_build_object(
      'run_id',r.id,'status',r.status,'history_days',r.history_days,
      'horizon_days',r.horizon_days,'generated_at',r.generated_at,
      'result',r.result
    ) from public.maintenance_optimization_runs r
      where r.organization_id=public.app_current_org()
      order by r.generated_at desc limit 1),
      jsonb_build_object('status','not_generated')) end
$$;

revoke all on function public.get_latest_maintenance_optimization_run()
  from public, anon;
grant execute on function public.get_latest_maintenance_optimization_run()
  to authenticated;

notify pgrst, 'reload schema';
