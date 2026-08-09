-- ============================================================================
-- Constrained scheduling and outage windows
-- (capability register C8.08, C1.09; strengthens C4.06, C5.04).
--
-- Slice 5 shipped a Scheduler that produced weekly options and let a human
-- release one. It checked nothing before freezing. That was honest at the time
-- — there was nothing to check against. Since then four constraint sources
-- have arrived, and this slice makes the release consult all of them:
--
--     labour     job plans give craft, crew size and duration      (slice 17)
--     materials  reservation status per work order                  (slice 12)
--     safety     un-cleared consequence gates                       (slice 6)
--     authority  approvals still outstanding                        (slice 9)
--
-- THE DESIGN DECISION: HARD CONSTRAINTS BLOCK, SOFT CONSTRAINTS WARN, AND THE
-- DIFFERENCE IS NOT NEGOTIABLE AT RUNTIME.
--
-- A safety gate that has not been cleared is a hard constraint: releasing a
-- schedule containing that work is refused, full stop. A material shortage is
-- a soft constraint: it is surfaced loudly and the planner may still release,
-- because deciding to start a job while a part is in transit is a legitimate
-- planning judgement and pretending otherwise would just teach people to work
-- around the system.
--
-- Systems that block on everything get bypassed. Systems that block on nothing
-- are decoration. Which constraints are which is the whole design.
--
-- CAPACITY IS NOT INVENTED. craft_capacity starts empty. Without it the labour
-- constraint reports "not assessable" rather than assuming a crew size — a
-- fabricated capacity would silently authorise an unachievable week.
--
-- Canonical reuse: schedule_options, work_orders, work_order_tasks,
-- work_order_materials, recommendation_screenings, job_plans, sites,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists craft_capacity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  craft text not null,
  -- Hours the craft can actually deliver in a week, after leave, training and
  -- indirect time. The operator's number, never a headcount guess.
  weekly_hours numeric not null check (weekly_hours > 0),
  basis text not null,
  effective_from date not null default current_date,
  register_ref text not null default 'C8.08',
  created_at timestamptz not null default now(),
  unique (organization_id, site_id, craft, effective_from)
);

alter table craft_capacity enable row level security;
drop policy if exists craft_capacity_read on craft_capacity;
create policy craft_capacity_read on craft_capacity
  for select to authenticated using (organization_id = app_current_org());

create table if not exists outage_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  site_id uuid references sites(id) on delete cascade,
  window_key text not null,
  title text not null,
  kind text not null default 'shutdown'
    check (kind in ('shutdown', 'turnaround', 'opportunity', 'campaign')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  scope text,
  -- Frozen means the work list is closed; late additions become break-in work
  -- against the outage rather than quietly enlarging it.
  status text not null default 'planned'
    check (status in ('planned', 'frozen', 'executing', 'closed', 'cancelled')),
  frozen_by uuid references auth.users(id),
  frozen_at timestamptz,
  register_ref text not null default 'C1.09',
  created_at timestamptz not null default now(),
  unique (organization_id, window_key),
  check (ends_at > starts_at)
);

alter table outage_windows enable row level security;
drop policy if exists outage_windows_read on outage_windows;
create policy outage_windows_read on outage_windows
  for select to authenticated using (organization_id = app_current_org());

create table if not exists outage_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  outage_window_id uuid not null references outage_windows(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  -- Recorded rather than hidden: work added after the freeze is the single
  -- most reliable predictor of an outage overrunning.
  added_after_freeze boolean not null default false,
  justification text,
  unique (outage_window_id, work_order_id)
);

alter table outage_work enable row level security;
drop policy if exists outage_work_read on outage_work;
create policy outage_work_read on outage_work
  for select to authenticated using (organization_id = app_current_org());

-- ----------------------------------------------------------------------------
-- Feasibility: every constraint, each saying whether it blocks or warns
-- ----------------------------------------------------------------------------
create or replace function public.evaluate_schedule_feasibility(p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  o schedule_options%rowtype;
  v_ids uuid[];
  v_safety int;
  v_authority int;
  v_short int;
  v_unassessed int;
  v_cap_rows int;
  v_labour jsonb;
  v_blocking int := 0;
  v_warning int := 0;
  v_checks jsonb := '[]'::jsonb;
begin
  select * into o from schedule_options where id = p_option_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'schedule option not found');
  end if;

  select array_agg((it->>'wo_id')::uuid)
  into v_ids
  from jsonb_array_elements(o.items) it
  where it->>'wo_id' is not null;

  if v_ids is null then v_ids := '{}'; end if;

  -- HARD: safety gates
  select count(*) into v_safety
  from recommendation_screenings s
  join recommendations r on r.id = s.recommendation_id
  join work_orders w on w.recommendation_id = r.id
  where w.id = any(v_ids) and s.requires_gatekeeper and s.gatekeeper_attested_at is null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Safety consequence clearance', 'severity', 'blocking',
    'register_ref', 'C1.11',
    'passed', v_safety = 0, 'count', v_safety,
    'detail', case when v_safety = 0
      then 'No scheduled work is awaiting gatekeeper clearance.'
      else format('%s scheduled work order(s) carry an un-cleared safety gate. A schedule cannot be frozen around work that is not yet permitted to proceed.', v_safety) end);
  if v_safety > 0 then v_blocking := v_blocking + 1; end if;

  -- HARD: approval authority
  select count(*) into v_authority
  from work_orders w
  join recommendations r on r.id = w.recommendation_id
  where w.id = any(v_ids) and r.status = 'pending' and r.approval_required is not null;

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Approval authority', 'severity', 'blocking',
    'register_ref', 'E4.03',
    'passed', v_authority = 0, 'count', v_authority,
    'detail', case when v_authority = 0
      then 'No scheduled work is waiting on an approval.'
      else format('%s scheduled work order(s) still require approval.', v_authority) end);
  if v_authority > 0 then v_blocking := v_blocking + 1; end if;

  -- SOFT: materials
  select count(distinct work_order_id) into v_short
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'short';

  select count(distinct work_order_id) into v_unassessed
  from work_order_materials
  where work_order_id = any(v_ids) and status = 'requested';

  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Material readiness', 'severity', 'warning',
    'register_ref', 'C6.11',
    'passed', v_short = 0 and v_unassessed = 0,
    'count', v_short + v_unassessed,
    'detail', case
      when v_short = 0 and v_unassessed = 0 then 'Every scheduled job with recorded demand is materially ready.'
      else format('%s job(s) short of material, %s with demand that cannot be assessed. Warned rather than blocked: starting a job while a part is in transit is a legitimate planning judgement.', v_short, v_unassessed) end);
  if v_short + v_unassessed > 0 then v_warning := v_warning + 1; end if;

  -- SOFT or NOT ASSESSABLE: labour against craft capacity
  select count(*) into v_cap_rows from craft_capacity where organization_id = v_org;

  if v_cap_rows = 0 then
    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08', 'passed', null, 'count', 0,
      'detail', 'Not assessable: no craft capacity is recorded. Capacity is deliberately not inferred from headcount — a fabricated figure would silently authorise an unachievable week.');
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'craft', x.craft, 'required_hours', x.req, 'available_hours', x.cap,
      'utilisation_pct', round(100.0 * x.req / x.cap, 1)) order by x.req desc), '[]'::jsonb)
    into v_labour
    from (
      select coalesce(t.craft, 'Unassigned') as craft,
             round(sum(t.estimated_hours)::numeric, 1) as req,
             coalesce((select sum(weekly_hours) from craft_capacity c
                       where c.organization_id = v_org and c.craft = t.craft), 0) as cap
      from work_order_tasks t
      where t.work_order_id = any(v_ids)
      group by coalesce(t.craft, 'Unassigned')) x
    where x.cap > 0;

    v_checks := v_checks || jsonb_build_object(
      'constraint', 'Labour capacity', 'severity', 'warning',
      'register_ref', 'C8.08',
      'passed', not exists (
        select 1 from jsonb_array_elements(coalesce(v_labour, '[]'::jsonb)) l
        where (l->>'utilisation_pct')::numeric > 100),
      'by_craft', v_labour,
      'detail', 'Required hours from applied job plans against recorded craft capacity. Over-commitment warns rather than blocks — overtime and contractors are real options a planner may take.');
    if exists (select 1 from jsonb_array_elements(coalesce(v_labour, '[]'::jsonb)) l
               where (l->>'utilisation_pct')::numeric > 100) then
      v_warning := v_warning + 1;
    end if;
  end if;

  -- NOT ASSESSABLE: production/operating context
  v_checks := v_checks || jsonb_build_object(
    'constraint', 'Production window', 'severity', 'warning',
    'register_ref', 'C2.04', 'passed', null, 'count', 0,
    'detail', 'Not assessable: operating context and production plans are not ingested. Equipment availability windows cannot be checked against a plan the platform cannot see.');

  return jsonb_build_object(
    'option_id', p_option_id, 'week_start', o.week_start,
    'work_orders', coalesce(array_length(v_ids, 1), 0),
    'blocking_failures', v_blocking, 'warnings', v_warning,
    'releasable', v_blocking = 0,
    'checks', v_checks,
    'policy', 'Hard constraints block a release; soft constraints warn and leave the judgement with the planner. Systems that block on everything get bypassed; systems that block on nothing are decoration.');
end
$$;

grant execute on function public.evaluate_schedule_feasibility(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Release now consults feasibility
-- ----------------------------------------------------------------------------
create or replace function public.release_schedule_option(
  p_id uuid,
  p_acknowledge_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o schedule_options%rowtype;
  v_role text;
  f jsonb;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('planner', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error',
      'releasing a schedule requires planner or manager authority');
  end if;

  select * into o from schedule_options
  where id = p_id and organization_id = app_current_org();
  if not found then
    return jsonb_build_object('error', 'option not found');
  end if;
  if o.status <> 'draft' then
    return jsonb_build_object('error', 'only draft options can be released');
  end if;

  f := evaluate_schedule_feasibility(p_id);

  -- Hard constraints are not overridable here. A safety gate is cleared by
  -- clearing it, not by acknowledging a warning about it.
  if (f->>'blocking_failures')::int > 0 then
    return jsonb_build_object('error',
      'this schedule cannot be released: a hard constraint fails',
      'feasibility', f);
  end if;

  -- Soft constraints require the planner to say, on the record, that they saw
  -- them. Silent release over a known shortage is how a schedule loses its
  -- meaning.
  if (f->>'warnings')::int > 0 and not p_acknowledge_warnings then
    return jsonb_build_object('error',
      format('%s constraint warning(s) — review and release with acknowledgement', f->>'warnings'),
      'feasibility', f);
  end if;

  update schedule_options
  set status = 'released', released_by = auth.uid(), released_at = now()
  where id = o.id;

  update schedule_options
  set status = 'discarded'
  where organization_id = o.organization_id and week_start = o.week_start
    and id <> o.id and status = 'draft';

  return jsonb_build_object('released', o.id, 'week_start', o.week_start,
    'warnings_acknowledged', (f->>'warnings')::int, 'feasibility', f);
end
$$;

grant execute on function public.release_schedule_option(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Outage windows (C1.09)
-- ----------------------------------------------------------------------------
create or replace function public.add_work_to_outage(
  p_window_key text,
  p_work_order_id uuid,
  p_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  w outage_windows%rowtype;
begin
  select * into w from outage_windows
  where organization_id = v_org and window_key = p_window_key;
  if not found then
    return jsonb_build_object('error', 'outage window not found');
  end if;
  if w.status in ('closed', 'cancelled') then
    return jsonb_build_object('error', 'this outage is ' || w.status);
  end if;
  if w.status <> 'planned' and coalesce(length(trim(p_justification)), 0) < 10 then
    return jsonb_build_object('error',
      'this outage work list is frozen — adding work requires a justification, and it will be recorded as a late addition');
  end if;

  insert into outage_work (organization_id, outage_window_id, work_order_id,
    added_by, added_after_freeze, justification)
  values (v_org, w.id, p_work_order_id, auth.uid(),
    w.status <> 'planned', nullif(trim(p_justification), ''))
  on conflict (outage_window_id, work_order_id) do nothing;

  return jsonb_build_object('outage', p_window_key, 'work_order_id', p_work_order_id,
    'late_addition', w.status <> 'planned');
end
$$;

grant execute on function public.add_work_to_outage(text, uuid, text) to authenticated;

create or replace function public.get_outage_position()
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
    'windows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'window_key', w.window_key, 'title', w.title, 'kind', w.kind,
        'starts_at', w.starts_at, 'ends_at', w.ends_at, 'status', w.status,
        'duration_hours', round(extract(epoch from (w.ends_at - w.starts_at)) / 3600.0, 1),
        'work_orders', (select count(*) from outage_work ow where ow.outage_window_id = w.id),
        'late_additions', (select count(*) from outage_work ow
                           where ow.outage_window_id = w.id and ow.added_after_freeze),
        'planned_hours', (select coalesce(sum(wo.planned_hours), 0)
                          from outage_work ow join work_orders wo on wo.id = ow.work_order_id
                          where ow.outage_window_id = w.id),
        'hours_unplanned', (select count(*)
                            from outage_work ow join work_orders wo on wo.id = ow.work_order_id
                            where ow.outage_window_id = w.id and wo.planned_hours is null)
      ) order by w.starts_at), '[]'::jsonb)
      from outage_windows w
      where w.organization_id = v_org and w.status <> 'cancelled'),
    'craft_capacity_recorded', (select count(*) from craft_capacity where organization_id = v_org),
    'note', 'Work added after an outage is frozen is recorded as a late addition rather than absorbed. Late additions are the single most reliable predictor of an outage overrunning, and a scope that grows invisibly cannot be defended afterwards.');
end
$$;

grant execute on function public.get_outage_position() to authenticated;

notify pgrst, 'reload schema';
