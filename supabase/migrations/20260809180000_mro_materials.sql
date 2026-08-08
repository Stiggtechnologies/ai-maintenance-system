-- ============================================================================
-- MRO materials, kitting and the materials event stream
-- (capability register C2.07, C2.17, C8.07 partial; unblocks C6.11 and C6.15).
--
-- Two work-management metrics have been reporting `available:false` with this
-- as the named blocker: waiting-on-material time (C6.15) could not be computed
-- at all, and ready backlog (C6.11) was approximated by a boolean flag that
-- nothing maintained. Neither is fixable by better arithmetic — the platform
-- had no materials model whatsoever.
--
-- The design decision that matters: the EVENT STREAM is the primary record,
-- not the status column. "Waiting on material" is the interval between a
-- request and its satisfaction; a status field can only ever tell you where
-- something is now, never how long it took to get there. work_order_materials
-- carries current state for the UI; material_events carries the history the
-- metric is computed from.
--
-- HONESTY ON SEEDED DATA. A template catalogue of generic consumable classes
-- is seeded so the machinery is exercisable, marked is_template with a stated
-- basis. NO STOCK QUANTITIES AND NO EVENTS ARE FABRICATED — invented on-hand
-- figures would silently corrupt readiness and shortage reporting, which is
-- exactly the kind of plausible-looking wrongness this platform refuses
-- elsewhere. Readiness reports "no stock records" until a real inventory
-- source exists, and says so.
--
-- Canonical reuse: work_orders, assets, sites, audit_events, app_current_org().
-- Additive.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Catalogue
-- ----------------------------------------------------------------------------
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  material_code text not null,
  description text not null,
  category text,
  unit_of_measure text not null default 'each',
  unit_cost_usd numeric,
  lead_time_days int,
  min_qty numeric,
  max_qty numeric,
  -- Repairable/rotable spares behave differently from consumables: they come
  -- back, get refurbished and re-enter stock (C2.07).
  repairable boolean not null default false,
  criticality text check (criticality in ('critical', 'essential', 'routine')),
  -- Template rows are a starting structure, not the operator's MRO catalogue.
  is_template boolean not null default false,
  basis text,
  source_system text,
  created_at timestamptz not null default now(),
  unique (organization_id, material_code)
);

alter table materials enable row level security;
drop policy if exists materials_org_read on materials;
create policy materials_org_read on materials
  for select to authenticated using (organization_id = app_current_org());

create table if not exists material_stock (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  qty_on_hand numeric not null default 0,
  qty_reserved numeric not null default 0,
  qty_on_order numeric not null default 0,
  expected_receipt_date date,
  last_counted_at timestamptz,
  source_system text,
  updated_at timestamptz not null default now(),
  unique (material_id, site_id)
);

alter table material_stock enable row level security;
drop policy if exists material_stock_org_read on material_stock;
create policy material_stock_org_read on material_stock
  for select to authenticated using (organization_id = app_current_org());

-- Bills of material: what an asset consumes (C2.07).
create table if not exists bom_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  asset_class text,
  material_id uuid not null references materials(id) on delete cascade,
  qty_per numeric not null default 1,
  position_note text,
  source_system text,
  created_at timestamptz not null default now(),
  -- A BOM line hangs off a specific asset or a whole class, never neither.
  check (asset_id is not null or asset_class is not null)
);

alter table bom_lines enable row level security;
drop policy if exists bom_lines_org_read on bom_lines;
create policy bom_lines_org_read on bom_lines
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Demand and its history
-- ----------------------------------------------------------------------------
create table if not exists work_order_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  qty_required numeric not null check (qty_required > 0),
  qty_reserved numeric not null default 0,
  qty_issued numeric not null default 0,
  status text not null default 'requested'
    check (status in ('requested', 'reserved', 'kitted', 'issued', 'short', 'cancelled')),
  needed_by date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_order_id, material_id)
);

create index if not exists idx_wo_materials_lookup
  on work_order_materials(organization_id, work_order_id, status);

alter table work_order_materials enable row level security;
drop policy if exists wo_materials_org_read on work_order_materials;
create policy wo_materials_org_read on work_order_materials
  for select to authenticated using (organization_id = app_current_org());

-- The primary record. Status tells you where a line is; only the event stream
-- tells you how long it waited, and the metric is about the waiting.
create table if not exists material_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  work_order_material_id uuid references work_order_materials(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  event_type text not null check (event_type in
    ('requested', 'reserved', 'ordered', 'received', 'kitted', 'issued',
     'returned', 'shortage_declared', 'cancelled')),
  qty numeric,
  note text,
  actor uuid references auth.users(id),
  source_system text,
  occurred_at timestamptz not null default now(),
  register_ref text not null default 'C2.17'
);

create index if not exists idx_material_events_stream
  on material_events(organization_id, work_order_material_id, occurred_at);

alter table material_events enable row level security;
drop policy if exists material_events_org_read on material_events;
create policy material_events_org_read on material_events
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Template catalogue. Structure, not the operator's data.
-- ----------------------------------------------------------------------------
insert into materials (organization_id, material_code, description, category,
  unit_of_measure, lead_time_days, repairable, criticality, is_template, basis)
select o.id, v.code, v.descr, v.cat, v.uom, v.lead, v.rep, v.crit, true, v.basis
from organizations o
cross join (values
  ('TMPL-HYD-FILTER', 'Hydraulic return filter element', 'Filtration', 'each', 14, false, 'essential',
   'Template class, not a catalogued part. Replace with the operator''s MRO catalogue; lead time is a placeholder pending supplier terms.'),
  ('TMPL-ENG-FILTER', 'Engine oil filter element', 'Filtration', 'each', 14, false, 'routine',
   'Template class. Lead time is a placeholder pending supplier terms.'),
  ('TMPL-SUSP-SEAL', 'Suspension cylinder seal kit', 'Seals and packing', 'kit', 45, false, 'critical',
   'Template class. Long-lead seal kits are a common shortage driver; confirm the real lead time before planning against it.'),
  ('TMPL-BRAKE-PACK', 'Wet-disc brake friction pack', 'Braking', 'set', 60, false, 'critical',
   'Template class. Safety-critical; the operator''s own part and lead time must replace this before it informs any schedule.'),
  ('TMPL-GET-TOOTH', 'Ground-engaging tooth', 'Ground engaging tools', 'each', 21, false, 'routine',
   'Template class. High-turnover consumable; min/max should come from real consumption history.'),
  ('TMPL-FINAL-DRIVE', 'Final drive assembly (rotable)', 'Powertrain', 'each', 120, true, 'critical',
   'Template class, flagged repairable: rotables return, are refurbished and re-enter stock, and their history follows the component rather than the asset (C2.07).')
) as v(code, descr, cat, uom, lead, rep, crit, basis)
where not exists (
  select 1 from materials m where m.organization_id = o.id and m.material_code = v.code
);

-- ----------------------------------------------------------------------------
-- Operations
-- ----------------------------------------------------------------------------
create or replace function public.request_wo_material(
  p_work_order_id uuid,
  p_material_id uuid,
  p_qty numeric,
  p_needed_by date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('error', 'quantity must be greater than zero');
  end if;
  if not exists (select 1 from work_orders
                 where id = p_work_order_id and organization_id = v_org) then
    return jsonb_build_object('error', 'work order not found');
  end if;
  if not exists (select 1 from materials
                 where id = p_material_id and organization_id = v_org) then
    return jsonb_build_object('error', 'material not found');
  end if;

  insert into work_order_materials (organization_id, work_order_id, material_id,
    qty_required, needed_by)
  values (v_org, p_work_order_id, p_material_id, p_qty, p_needed_by)
  on conflict (work_order_id, material_id) do update
    set qty_required = excluded.qty_required,
        needed_by = coalesce(excluded.needed_by, work_order_materials.needed_by),
        updated_at = now()
  returning id into v_id;

  insert into material_events (organization_id, work_order_material_id,
    material_id, event_type, qty, actor)
  values (v_org, v_id, p_material_id, 'requested', p_qty, auth.uid());

  return jsonb_build_object('work_order_material_id', v_id, 'status', 'requested');
end
$$;

grant execute on function public.request_wo_material(uuid, uuid, numeric, date) to authenticated;

-- Reserve what is available; declare a shortage for what is not. Both are
-- recorded as events, because a shortage that is never recorded is a delay
-- nobody can explain afterwards.
create or replace function public.reserve_wo_materials(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_site uuid;
  l record;
  v_avail numeric;
  v_take numeric;
  v_reserved int := 0;
  v_short int := 0;
  v_nostock int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select a.site_id into v_site
  from work_orders w left join assets a on a.id = w.asset_id
  where w.id = p_work_order_id and w.organization_id = v_org;

  for l in
    select * from work_order_materials
    where work_order_id = p_work_order_id and organization_id = v_org
      and status in ('requested', 'short')
  loop
    select greatest(qty_on_hand - qty_reserved, 0) into v_avail
    from material_stock
    where material_id = l.material_id
      and (site_id = v_site or (v_site is null and site_id is null))
    limit 1;

    if v_avail is null then
      -- No stock record at all. NOT the same as zero on hand, and reporting it
      -- as a shortage would invent a fact about inventory we do not have.
      v_nostock := v_nostock + 1;
      continue;
    end if;

    v_take := least(v_avail, l.qty_required - l.qty_reserved);

    if v_take > 0 then
      update material_stock set qty_reserved = qty_reserved + v_take, updated_at = now()
      where material_id = l.material_id
        and (site_id = v_site or (v_site is null and site_id is null));

      update work_order_materials
      set qty_reserved = qty_reserved + v_take,
          status = case when qty_reserved + v_take >= qty_required then 'reserved' else 'short' end,
          updated_at = now()
      where id = l.id;

      insert into material_events (organization_id, work_order_material_id,
        material_id, event_type, qty, actor)
      values (v_org, l.id, l.material_id, 'reserved', v_take, auth.uid());
      v_reserved := v_reserved + 1;
    end if;

    if l.qty_reserved + coalesce(v_take, 0) < l.qty_required then
      update work_order_materials set status = 'short', updated_at = now() where id = l.id;
      insert into material_events (organization_id, work_order_material_id,
        material_id, event_type, qty, note, actor)
      values (v_org, l.id, l.material_id, 'shortage_declared',
        l.qty_required - l.qty_reserved - coalesce(v_take, 0),
        'Insufficient available stock at the work order''s site', auth.uid());
      v_short := v_short + 1;
    end if;
  end loop;

  -- Keep the legacy readiness flag consistent with reality rather than letting
  -- two sources of truth drift.
  update work_orders w
  set parts_ready = not exists (
    select 1 from work_order_materials m
    where m.work_order_id = w.id and m.status not in ('reserved', 'kitted', 'issued', 'cancelled'))
  where w.id = p_work_order_id;

  return jsonb_build_object('reserved_lines', v_reserved, 'short_lines', v_short,
    'lines_without_stock_records', v_nostock);
end
$$;

grant execute on function public.reserve_wo_materials(uuid) to authenticated;

create or replace function public.record_material_event(
  p_work_order_material_id uuid,
  p_event_type text,
  p_qty numeric default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  l work_order_materials%rowtype;
begin
  select * into l from work_order_materials
  where id = p_work_order_material_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work-order material line not found');
  end if;

  insert into material_events (organization_id, work_order_material_id,
    material_id, event_type, qty, note, actor)
  values (v_org, l.id, l.material_id, p_event_type, p_qty, p_note, auth.uid());

  if p_event_type = 'kitted' then
    update work_order_materials set status = 'kitted', updated_at = now() where id = l.id;
  elsif p_event_type = 'issued' then
    update work_order_materials
    set status = 'issued', qty_issued = coalesce(p_qty, qty_required), updated_at = now()
    where id = l.id;
  elsif p_event_type = 'cancelled' then
    update work_order_materials set status = 'cancelled', updated_at = now() where id = l.id;
  end if;

  update work_orders w
  set parts_ready = not exists (
    select 1 from work_order_materials m
    where m.work_order_id = w.id and m.status not in ('reserved', 'kitted', 'issued', 'cancelled'))
  where w.id = l.work_order_id;

  return jsonb_build_object('recorded', p_event_type, 'line', l.id);
end
$$;

grant execute on function public.record_material_event(uuid, text, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Reporting
-- ----------------------------------------------------------------------------
create or replace function public.get_material_position()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_stock_rows int;
  v_lines int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*) into v_stock_rows from material_stock where organization_id = v_org;
  select count(*) into v_lines from work_order_materials where organization_id = v_org;

  return jsonb_build_object(
    'catalogue_size', (select count(*) from materials where organization_id = v_org),
    'template_rows', (select count(*) from materials where organization_id = v_org and is_template),
    'stock_records', v_stock_rows,
    'demand_lines', v_lines,
    -- Said plainly rather than shown as a healthy-looking zero.
    'stock_note', case when v_stock_rows = 0
      then 'No stock records. On-hand quantities have not been fabricated — connect an inventory source (C2.17) before readiness or shortage figures mean anything.'
      else 'Stock positions present.' end,
    'below_minimum', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'material_code', m.material_code, 'description', m.description,
        'on_hand', s.qty_on_hand, 'min_qty', m.min_qty,
        'lead_time_days', m.lead_time_days, 'criticality', m.criticality)
        order by m.criticality, m.material_code), '[]'::jsonb)
      from material_stock s join materials m on m.id = s.material_id
      where s.organization_id = v_org and m.min_qty is not null
        and s.qty_on_hand < m.min_qty),
    'open_shortages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'work_order', w.wo_number, 'material_code', m.material_code,
        'description', m.description,
        'short_qty', l.qty_required - l.qty_reserved,
        'lead_time_days', m.lead_time_days, 'needed_by', l.needed_by,
        -- The number a planner actually needs: can it arrive in time?
        'at_risk', l.needed_by is not null and m.lead_time_days is not null
                   and l.needed_by < (current_date + m.lead_time_days))
        order by l.needed_by nulls last), '[]'::jsonb)
      from work_order_materials l
      join materials m on m.id = l.material_id
      join work_orders w on w.id = l.work_order_id
      where l.organization_id = v_org and l.status = 'short'),
    -- Demand we cannot assess at all: there is no stock record for the
    -- material, so it is neither reservable nor honestly a shortage. Left
    -- invisible it would read as "nothing outstanding", which on a fresh
    -- deployment is every line.
    'unassessable_demand', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'work_order', w.wo_number, 'material_code', m.material_code,
        'description', m.description, 'qty_required', l.qty_required,
        'needed_by', l.needed_by, 'lead_time_days', m.lead_time_days,
        'reason', 'No stock record for this material at the work order''s site — connect an inventory source (C2.17)')
        order by l.needed_by nulls last), '[]'::jsonb)
      from work_order_materials l
      join materials m on m.id = l.material_id
      join work_orders w on w.id = l.work_order_id
      where l.organization_id = v_org and l.status = 'requested'
        and not exists (
          select 1 from material_stock s
          where s.material_id = l.material_id and s.organization_id = v_org)),
    'repairables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'material_code', material_code, 'description', description,
        'lead_time_days', lead_time_days) order by material_code), '[]'::jsonb)
      from materials where organization_id = v_org and repairable));
end
$$;

grant execute on function public.get_material_position() to authenticated;

-- ----------------------------------------------------------------------------
-- The two work-health metrics this slice unblocks
-- ----------------------------------------------------------------------------
create or replace function public.get_work_management_health(
  p_window_days int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_from timestamptz;
  v_to timestamptz;
  v_total int;
  v_planned int;
  v_emergency int;
  v_pm_due int;
  v_pm_done int;
  v_open int;
  v_open_ready int;
  v_backlog_age numeric;
  v_backlog_risk int;
  v_repeat int;
  v_sched_total int;
  v_sched_done int;
  v_breakin int;
  v_wait_hours numeric;
  v_wait_n int;
  v_ready_lines int;
  v_open_with_demand int;
  v_metrics jsonb := '[]'::jsonb;
begin
  if p_window_days is null then
    select min(completed_at), max(completed_at) into v_from, v_to
    from work_orders
    where organization_id = v_org and completed_at is not null;
    if v_from is null then
      v_from := now() - interval '90 days';
      v_to := now();
    end if;
  else
    v_from := now() - make_interval(days => greatest(p_window_days, 1));
    v_to := now();
  end if;

  select
    count(*),
    count(*) filter (where work_type = 'preventive'),
    count(*) filter (where priority = 'critical' or status = 'critical'),
    count(*) filter (where work_type = 'preventive'),
    count(*) filter (where work_type = 'preventive' and completed_at is not null)
  into v_total, v_planned, v_emergency, v_pm_due, v_pm_done
  from work_orders
  where organization_id = v_org
    and coalesce(completed_at, created_at) between v_from and v_to;

  select
    count(*),
    count(*) filter (where coalesce(parts_ready, false)),
    round(avg(extract(epoch from (now() - created_at)) / 86400.0)::numeric, 1),
    count(*) filter (where priority in ('critical', 'high'))
  into v_open, v_open_ready, v_backlog_age, v_backlog_risk
  from work_orders
  where organization_id = v_org and completed_at is null;

  select count(*) into v_repeat from (
    select asset_id, actual_failure_mode
    from work_orders
    where organization_id = v_org
      and work_type = 'corrective'
      and completed_at between v_from and v_to
      and actual_failure_mode is not null
    group by asset_id, actual_failure_mode
    having count(*) > 1
  ) t;

  select
    coalesce(sum(jsonb_array_length(o.items)), 0),
    coalesce(sum((
      select count(*) from jsonb_array_elements(o.items) it
      join work_orders w on w.id = (it->>'wo_id')::uuid
      where w.completed_at is not null
    )), 0)
  into v_sched_total, v_sched_done
  from schedule_options o
  where o.organization_id = v_org and o.status = 'released';

  select count(*) into v_breakin
  from work_orders w
  where w.organization_id = v_org
    and w.completed_at is not null
    and exists (
      select 1 from schedule_options o
      where o.organization_id = v_org and o.status = 'released'
        and w.completed_at::date between o.week_start and o.week_start + 6
    )
    and not exists (
      select 1 from schedule_options o2,
        lateral jsonb_array_elements(o2.items) it
      where o2.organization_id = v_org and o2.status = 'released'
        and (it->>'wo_id')::uuid = w.id
    );

  -- C6.15 — measured from the event stream: request to satisfaction.
  select round(avg(extract(epoch from (sat.at - req.at)) / 3600.0)::numeric, 1),
         count(*)
  into v_wait_hours, v_wait_n
  from (
    select work_order_material_id, min(occurred_at) as at
    from material_events
    where organization_id = v_org and event_type = 'requested'
    group by work_order_material_id) req
  join (
    select work_order_material_id, min(occurred_at) as at
    from material_events
    where organization_id = v_org and event_type in ('reserved', 'kitted', 'issued')
    group by work_order_material_id) sat
    on sat.work_order_material_id = req.work_order_material_id
  where sat.at >= req.at;

  -- C6.11 — ready backlog from actual line status, where demand is recorded.
  select
    count(distinct l.work_order_id) filter (where nl.unready = 0),
    count(distinct l.work_order_id)
  into v_ready_lines, v_open_with_demand
  from work_order_materials l
  join work_orders w on w.id = l.work_order_id and w.completed_at is null
  join lateral (
    select count(*) as unready from work_order_materials m
    where m.work_order_id = l.work_order_id
      and m.status not in ('reserved', 'kitted', 'issued', 'cancelled')) nl on true
  where l.organization_id = v_org;

  v_metrics := jsonb_build_array(
    jsonb_build_object('key','planned_work_pct','label','Planned-work percentage',
      'register_ref','C6.07','available', v_total > 0,
      'value', case when v_total > 0 then round(100.0 * v_planned / v_total, 1) end,
      'unit','%','basis','Preventive work orders as a share of all work in the window.'),
    jsonb_build_object('key','emergency_work_pct','label','Emergency-work percentage',
      'register_ref','C6.08','available', v_total > 0,
      'value', case when v_total > 0 then round(100.0 * v_emergency / v_total, 1) end,
      'unit','%','basis','Critical-priority work as a share of all work. Emergency is defined by the adopted taxonomy definition (C3.07); this proxies it with critical priority until dispatch-level urgency is ingested.'),
    jsonb_build_object('key','schedule_compliance','label','Schedule compliance',
      'register_ref','C6.09','available', v_sched_total > 0,
      'value', case when v_sched_total > 0 then round(100.0 * v_sched_done / v_sched_total, 1) end,
      'unit','%','basis', case when v_sched_total > 0
        then 'Completed items as a share of items on released (frozen) weekly schedules.'
        else 'No released schedule yet — release a weekly schedule to make this measurable.' end),
    jsonb_build_object('key','pm_compliance','label','PM compliance',
      'register_ref','C6.10','available', v_pm_due > 0,
      'value', case when v_pm_due > 0 then round(100.0 * v_pm_done / v_pm_due, 1) end,
      'unit','%','basis','Completed preventive work as a share of preventive work raised. A true PM-due denominator requires maintenance plans (C2.02).'),
    jsonb_build_object('key','ready_backlog','label','Ready backlog',
      'register_ref','C6.11', 'available', v_open > 0,
      'value', case
        when v_open_with_demand > 0 then round(100.0 * v_ready_lines / v_open_with_demand, 1)
        when v_open > 0 then round(100.0 * v_open_ready / v_open, 1) end,
      'unit','%','basis', case when v_open_with_demand > 0
        then format('Open work with every material line reserved, kitted or issued (%s of %s work orders carrying recorded material demand).', v_ready_lines, v_open_with_demand)
        else 'No work order carries recorded material demand yet, so this falls back to the parts-ready flag. Record material requirements to measure true kitting status (C2.07).' end),
    jsonb_build_object('key','backlog_age','label','Backlog age',
      'register_ref','C6.12','available', v_open > 0,
      'value', v_backlog_age,'unit','days',
      'basis','Mean age of open work orders.'),
    jsonb_build_object('key','backlog_risk','label','Backlog at risk',
      'register_ref','C6.12','available', v_open > 0,
      'value', v_backlog_risk,'unit','WOs',
      'basis','Open work at critical or high priority.'),
    jsonb_build_object('key','break_in_work','label','Break-in work',
      'register_ref','C6.13','available', v_sched_total > 0,
      'value', case when v_sched_total > 0 then v_breakin end,'unit','WOs',
      'basis', case when v_sched_total > 0
        then 'Work completed inside a released week that was not on the frozen schedule.'
        else 'Requires a released weekly schedule to measure against.' end),
    jsonb_build_object('key','planning_accuracy','label','Planning accuracy',
      'register_ref','C6.14','available', false,'value', null,'unit','%',
      'basis','Requires planned versus actual labour hours on job plans. Job plans are not yet modelled (C8.07).'),
    jsonb_build_object('key','waiting_on_material','label','Waiting-on-material time',
      'register_ref','C6.15','available', coalesce(v_wait_n, 0) > 0,
      'value', v_wait_hours,'unit','hours',
      'basis', case when coalesce(v_wait_n, 0) > 0
        then format('Mean hours from material request to reservation, kitting or issue, over %s satisfied material lines.', v_wait_n)
        else 'Materials are now modelled and the event stream exists, but no material line has been requested and satisfied yet. The metric becomes measurable with the first completed request (C2.17).' end),
    jsonb_build_object('key','rework_repeat','label','Rework and repeat work',
      'register_ref','C6.16','available', true,'value', v_repeat,'unit','asset-mode pairs',
      'basis','Asset and coded failure-mode pairs with more than one corrective completion in the window.')
  );

  return jsonb_build_object(
    'window_from', v_from, 'window_to', v_to,
    'window_source', case when p_window_days is null then 'derived from data span' else 'caller-specified trailing window' end,
    'work_orders_in_window', v_total,
    'open_work_orders', v_open,
    'metrics', v_metrics);
end
$$;

grant execute on function public.get_work_management_health(int) to authenticated;

notify pgrst, 'reload schema';
