-- ============================================================================
-- Operations–maintenance coordination: equipment release, opportunity work,
-- production-loss attribution
-- (capability register E3.05, E3.06, E3.08; strengthens C6.04).
--
-- Operating context (slice 20) made three things computable that were not.
--
--   E3.05/E3.06 EQUIPMENT RELEASE. The handover between operations and
--   maintenance is where people get hurt. It is a two-sided transaction —
--   operations releases the equipment and later ACCEPTS it back — and the
--   platform had no record of either side. Job plans already know which work
--   demands a permit and an isolation (slice 17); this connects that
--   requirement to the physical handover, and refuses to complete permitted
--   work that was never released.
--
--   E3.08 OPPORTUNITY MAINTENANCE. When an asset goes down unplanned, the
--   window is already paid for. The question "what else could we do while it
--   is open?" is answerable now that down states are recorded: pending work on
--   that asset, sized by its job plan, filtered by material readiness, ranked
--   by what actually fits. Work that does NOT fit is listed too, because
--   knowing a two-hour window cannot absorb an eight-hour job is the point.
--
--   C6.04 PRODUCTION-LOSS ATTRIBUTION. Loss is measured against a rate DERIVED
--   FROM THIS ASSET'S OWN RUNNING PERIODS, never a nameplate figure. Nameplate
--   overstates loss systematically, and overstating loss is how maintenance
--   spending gets justified with numbers that do not survive scrutiny.
--
-- Canonical reuse: operating_states, production_records, work_orders,
-- job_plans, work_order_materials, app_current_org(). Additive.
-- ============================================================================

create table if not exists equipment_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  work_order_id uuid references work_orders(id) on delete set null,
  -- Operations hands the equipment over.
  released_by uuid not null references auth.users(id),
  released_at timestamptz not null default now(),
  isolation_confirmed boolean not null default false,
  isolation_note text,
  -- Maintenance hands it back.
  returned_by uuid references auth.users(id),
  returned_at timestamptz,
  return_note text,
  -- And operations accepts it. A return nobody accepted is not a return: the
  -- equipment is in limbo and everyone assumes the other party owns it.
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  acceptance_note text,
  status text not null default 'released'
    check (status in ('released', 'returned', 'accepted', 'cancelled')),
  register_ref text not null default 'E3.05',
  check (returned_at is null or returned_at >= released_at),
  check (accepted_at is null or returned_at is not null)
);

create index if not exists idx_equipment_releases_open
  on equipment_releases(organization_id, asset_id, status);

alter table equipment_releases enable row level security;
drop policy if exists equipment_releases_read on equipment_releases;
create policy equipment_releases_read on equipment_releases
  for select to authenticated using (organization_id = app_current_org());

create or replace function public.release_equipment(
  p_asset_id uuid,
  p_work_order_id uuid,
  p_isolation_confirmed boolean,
  p_isolation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_permits int := 0;
begin
  select role into v_role from user_profiles where id = auth.uid();
  -- Releasing equipment is an OPERATIONS act. Maintenance releasing equipment
  -- to itself is the failure this record exists to prevent.
  if v_role not in ('operator', 'executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'releasing equipment is an operations act — maintenance cannot release equipment to itself');
  end if;

  if exists (select 1 from equipment_releases
             where organization_id = v_org and asset_id = p_asset_id
               and status in ('released', 'returned')) then
    return jsonb_build_object('error',
      'this asset is already released and not yet accepted back');
  end if;

  if p_work_order_id is not null then
    select count(*) into v_permits
    from work_orders w
    join job_plan_permits p on p.job_plan_id = w.job_plan_id
    where w.id = p_work_order_id and w.organization_id = v_org;
  end if;

  if v_permits > 0 and not p_isolation_confirmed then
    return jsonb_build_object('error',
      format('the job plan for this work requires %s permit/isolation(s); release cannot be recorded without confirming isolation', v_permits));
  end if;

  insert into equipment_releases (organization_id, asset_id, work_order_id,
    released_by, isolation_confirmed, isolation_note)
  values (v_org, p_asset_id, p_work_order_id, auth.uid(),
    p_isolation_confirmed, p_isolation_note);

  return jsonb_build_object('released', p_asset_id, 'permits_required', v_permits);
end
$$;

grant execute on function public.release_equipment(uuid, uuid, boolean, text) to authenticated;

create or replace function public.return_equipment(
  p_asset_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r equipment_releases%rowtype;
begin
  select * into r from equipment_releases
  where organization_id = v_org and asset_id = p_asset_id and status = 'released'
  order by released_at desc limit 1;
  if not found then
    return jsonb_build_object('error', 'this asset is not currently released to maintenance');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'state the condition the equipment is being returned in');
  end if;

  update equipment_releases
  set status = 'returned', returned_by = auth.uid(), returned_at = now(),
      return_note = trim(p_note)
  where id = r.id;

  return jsonb_build_object('returned', p_asset_id,
    'note', 'Awaiting operations acceptance. Until accepted the equipment is in neither party''s hands, which is exactly the state worth making visible.');
end
$$;

grant execute on function public.return_equipment(uuid, text) to authenticated;

create or replace function public.accept_equipment(
  p_asset_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  r equipment_releases%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('operator', 'executive', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'accepting equipment back is an operations act');
  end if;

  select * into r from equipment_releases
  where organization_id = v_org and asset_id = p_asset_id and status = 'returned'
  order by returned_at desc limit 1;
  if not found then
    return jsonb_build_object('error', 'no returned release is awaiting acceptance for this asset');
  end if;
  -- The same person cannot hand over and accept back.
  if r.returned_by = auth.uid() then
    return jsonb_build_object('error',
      'segregation of duties: the person who returned the equipment cannot also accept it');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record what was checked before accepting');
  end if;

  update equipment_releases
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(),
      acceptance_note = trim(p_note)
  where id = r.id;

  return jsonb_build_object('accepted', p_asset_id,
    'out_of_service_hours', round(extract(epoch from (now() - r.released_at)) / 3600.0, 1));
end
$$;

grant execute on function public.accept_equipment(uuid, text) to authenticated;

-- Permitted work cannot be completed on equipment that was never released.
create or replace function public.enforce_release_before_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permits int;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  if new.job_plan_id is null then
    return new;
  end if;

  select count(*) into v_permits
  from job_plan_permits where job_plan_id = new.job_plan_id;
  if v_permits = 0 then
    return new;
  end if;

  if not exists (
    select 1 from equipment_releases
    where organization_id = new.organization_id and asset_id = new.asset_id
      and (work_order_id = new.id or work_order_id is null)
      and released_at <= coalesce(new.completed_at, now())) then
    raise exception
      'Equipment release: this work carries % permit/isolation requirement(s) and no release was recorded for the asset. Work requiring isolation cannot be closed as if the equipment were simply available.',
      v_permits using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists trg_enforce_release_before_completion on work_orders;
create trigger trg_enforce_release_before_completion
  before update of completed_at on work_orders
  for each row execute function public.enforce_release_before_completion();

-- ----------------------------------------------------------------------------
-- E3.08 — opportunity maintenance
-- ----------------------------------------------------------------------------
create or replace function public.find_opportunity_work(
  p_asset_id uuid,
  p_window_hours numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_fits jsonb;
  v_too_big jsonb;
  v_unsized int;
begin
  if p_window_hours is null or p_window_hours <= 0 then
    return jsonb_build_object('error', 'the window must be greater than zero hours');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'wo_number', w.wo_number, 'title', w.title, 'priority', w.priority,
    'planned_hours', w.planned_hours,
    'materials_ready', not exists (
      select 1 from work_order_materials m
      where m.work_order_id = w.id
        and m.status not in ('reserved', 'kitted', 'issued', 'cancelled')))
    order by
      case w.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
      w.planned_hours), '[]'::jsonb)
  into v_fits
  from work_orders w
  where w.organization_id = v_org and w.asset_id = p_asset_id
    and w.completed_at is null
    and w.planned_hours is not null and w.planned_hours <= p_window_hours;

  -- Listed rather than hidden: knowing a two-hour window cannot absorb an
  -- eight-hour job is the useful half of the answer.
  select coalesce(jsonb_agg(jsonb_build_object(
    'wo_number', w.wo_number, 'title', w.title,
    'planned_hours', w.planned_hours,
    'shortfall_hours', round(w.planned_hours - p_window_hours, 1))
    order by w.planned_hours), '[]'::jsonb)
  into v_too_big
  from work_orders w
  where w.organization_id = v_org and w.asset_id = p_asset_id
    and w.completed_at is null
    and w.planned_hours is not null and w.planned_hours > p_window_hours;

  select count(*) into v_unsized
  from work_orders w
  where w.organization_id = v_org and w.asset_id = p_asset_id
    and w.completed_at is null and w.planned_hours is null;

  return jsonb_build_object(
    'window_hours', p_window_hours,
    'fits', v_fits,
    'does_not_fit', v_too_big,
    'unsized_work_orders', v_unsized,
    'note', case when v_unsized > 0
      then format('%s open work order(s) on this asset carry no job plan, so they cannot be sized against the window and are excluded rather than guessed at (C8.07).', v_unsized)
      else 'Every open work order on this asset is sized by a job plan.' end);
end
$$;

grant execute on function public.find_opportunity_work(uuid, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- C6.04 — production loss attributable to equipment
-- ----------------------------------------------------------------------------
create or replace function public.get_production_loss(
  p_window_days int default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_from timestamptz := now() - make_interval(days => greatest(p_window_days, 1));
  v_rows jsonb;
  v_assets int;
begin
  -- The demonstrated rate: units per running hour, from THIS asset's own
  -- history. Nameplate would overstate loss systematically, and overstating
  -- loss is how maintenance spending gets justified with numbers that do not
  -- survive scrutiny.
  with running as (
    select asset_id,
           sum(extract(epoch from (least(coalesce(ended_at, now()), now())
                                   - greatest(started_at, v_from))) / 3600.0) as hours
    from operating_states
    where organization_id = v_org and state = 'running'
      and coalesce(ended_at, now()) > v_from
    group by asset_id
  ), produced as (
    select asset_id, sum(units_produced) as units, min(unit_of_measure) as uom
    from production_records
    where organization_id = v_org and asset_id is not null and period_start >= v_from
    group by asset_id
  ), rate as (
    select r.asset_id, p.units / nullif(r.hours, 0) as units_per_hour, p.uom
    from running r join produced p on p.asset_id = r.asset_id
    where r.hours > 0
  ), lost as (
    select asset_id,
           sum(extract(epoch from (least(coalesce(ended_at, now()), now())
                                   - greatest(started_at, v_from))) / 3600.0) as down_hours
    from operating_states
    where organization_id = v_org and state in ('down_unplanned', 'down_planned')
      and coalesce(ended_at, now()) > v_from
    group by asset_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'asset', a.name,
    'down_hours', round(l.down_hours::numeric, 1),
    'demonstrated_rate', round(rt.units_per_hour::numeric, 3),
    'unit_of_measure', rt.uom,
    'units_lost', round((l.down_hours * rt.units_per_hour)::numeric, 1))
    order by (l.down_hours * rt.units_per_hour) desc), '[]'::jsonb)
  into v_rows
  from lost l
  join rate rt on rt.asset_id = l.asset_id
  join assets a on a.id = l.asset_id;

  select count(*) into v_assets from assets where organization_id = v_org;

  return jsonb_build_object(
    'window_days', greatest(p_window_days, 1),
    'by_asset', v_rows,
    'assets_measurable', jsonb_array_length(v_rows),
    'assets', v_assets,
    'basis', case when jsonb_array_length(v_rows) = 0
      then 'No asset has both running-state history and recorded production, so no demonstrated rate exists. Loss is not estimated from nameplate capacity — nameplate overstates it systematically, and an overstated loss is a number that will not survive scrutiny in the meeting where it matters.'
      else 'Downtime hours multiplied by the rate each asset actually demonstrated while running in this window.' end);
end
$$;

grant execute on function public.get_production_loss(int) to authenticated;

create or replace function public.get_ops_coordination()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object(
    'open_releases', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'asset', a.name, 'status', r.status,
        'released_at', r.released_at, 'returned_at', r.returned_at,
        'isolation_confirmed', r.isolation_confirmed,
        'hours_out_of_service', round(extract(epoch from
          (coalesce(r.returned_at, now()) - r.released_at)) / 3600.0, 1),
        'awaiting_acceptance', r.status = 'returned')
        order by r.released_at), '[]'::jsonb)
      from equipment_releases r
      join assets a on a.id = r.asset_id
      where r.organization_id = v_org and r.status in ('released', 'returned')),
    'production_loss', get_production_loss(90),
    'note', 'A return nobody accepted is not a return — the equipment sits in neither party''s hands, and that state is made visible rather than closed out silently.');
end
$$;

grant execute on function public.get_ops_coordination() to authenticated;

notify pgrst, 'reload schema';
