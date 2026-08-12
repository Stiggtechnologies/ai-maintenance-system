-- ============================================================================
-- Scheduler v1: weekly schedule OPTIONS with human release and frozen-schedule
-- control (capability register C1.05, C5.04; advances C4.06).
--
-- Spec §5 places "produce weekly schedule options" in the automatically
-- permitted tier and reserves release as a human act. This migration wires
-- that literally: generation CONSULTS check_decision_right() at runtime
-- (fail-closed if policy ever changes), produces candidate schedules
-- deterministically, and only an accountable human can release one — after
-- which it is frozen (no RPC can modify a released option).
--
-- Canonical reuse: work_orders (open backlog), assets (criticality),
-- decision_rights gate, app_current_org(). Additive only.
-- ============================================================================

create table if not exists schedule_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  week_start date not null,
  label text not null,                 -- Risk-first | Quick-wins | Balanced
  strategy text not null,
  items jsonb not null default '[]',   -- [{wo_id, wo_number, title, tag, priority, hours, day}]
  total_hours numeric not null default 0,
  capacity_hours numeric not null,     -- capacity per day used at generation
  status text not null default 'draft'
    check (status in ('draft', 'released', 'discarded')),
  generated_by uuid,
  released_by uuid,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_options_org_week
  on schedule_options(organization_id, week_start, status);

alter table schedule_options enable row level security;

drop policy if exists schedule_options_org on schedule_options;
create policy schedule_options_org on schedule_options
  for select to authenticated
  using (organization_id = app_current_org());
-- writes only through the governed RPCs

-- ----------------------------------------------------------------------------
-- Generate candidate weekly schedules. Auto-permitted per the decision-rights
-- matrix — and the matrix is consulted live, fail-closed.
-- ----------------------------------------------------------------------------
create or replace function public.generate_schedule_options(
  p_week_start date default null,
  p_capacity_hours_per_day numeric default 24
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_right jsonb;
  v_week date;
  v_org uuid := app_current_org();
  v_cap numeric := least(greatest(coalesce(p_capacity_hours_per_day, 24), 1), 240);
  strat record;
  wo record;
  v_items jsonb;
  v_day int;
  v_day_used numeric[];
  v_total numeric;
  n_opts int := 0;
begin
  -- consult the governed decision-rights matrix (fail-closed on unknown)
  v_right := public.check_decision_right('produce_schedule_options');
  if coalesce((v_right->>'allowed')::boolean, false) is not true then
    return jsonb_build_object('error',
      coalesce(v_right->>'reason', 'schedule generation is not permitted'),
      'decision_right', v_right);
  end if;

  v_week := coalesce(p_week_start,
    (current_date + ((8 - extract(isodow from current_date)::int) % 7 + 7) % 7 + 1));
  -- default: next Monday (or today+1 pattern); normalize to Monday of that week
  v_week := v_week - ((extract(isodow from v_week)::int) - 1);

  if exists (select 1 from schedule_options
             where organization_id = v_org and week_start = v_week
               and status = 'released') then
    return jsonb_build_object('error',
      'a released (frozen) schedule already exists for this week');
  end if;

  -- regenerating replaces prior drafts, never released schedules
  delete from schedule_options
  where organization_id = v_org and week_start = v_week and status = 'draft';

  for strat in
    select * from (values
      ('Risk-first', 'Highest priority and criticality scheduled earliest',
       'priority_weight desc, criticality_weight desc, age_days desc'),
      ('Quick-wins', 'Shortest jobs first to maximize completions',
       'hours asc, priority_weight desc'),
      ('Balanced', 'Priority per labor-hour ratio',
       'ratio desc, age_days desc')
    ) as s(label, description, ord)
  loop
    v_items := '[]'::jsonb;
    v_total := 0;
    v_day_used := array[0,0,0,0,0]::numeric[];

    for wo in execute format($q$
      select w.id, w.wo_number, w.title, a.tag,
             coalesce(w.priority, 'medium') as priority,
             least(greatest(coalesce(w.estimated_hours, 4), 0.5), 120) as hours,
             case coalesce(w.priority, 'medium')
               when 'critical' then 4 when 'high' then 3
               when 'medium' then 2 else 1 end as priority_weight,
             case coalesce(a.criticality, 'medium')
               when 'critical' then 3 when 'high' then 2 else 1 end as criticality_weight,
             extract(day from now() - w.created_at)::int as age_days,
             (case coalesce(w.priority, 'medium')
               when 'critical' then 4 when 'high' then 3
               when 'medium' then 2 else 1 end)::numeric
               / least(greatest(coalesce(w.estimated_hours, 4), 0.5), 120) as ratio
      from work_orders w
      left join assets a on a.id = w.asset_id
      where w.organization_id = %L and w.completed_at is null
      order by %s
      limit 60
    $q$, v_org, strat.ord)
    loop
      -- greedy level onto the first weekday with remaining capacity
      v_day := null;
      for d in 1..5 loop
        if v_day_used[d] + wo.hours <= v_cap then
          v_day := d;
          exit;
        end if;
      end loop;
      if v_day is null then
        continue; -- does not fit this week under the stated capacity
      end if;
      v_day_used[v_day] := v_day_used[v_day] + wo.hours;
      v_total := v_total + wo.hours;
      v_items := v_items || jsonb_build_object(
        'wo_id', wo.id, 'wo_number', wo.wo_number, 'title', wo.title,
        'tag', wo.tag, 'priority', wo.priority, 'hours', wo.hours, 'day', v_day);
    end loop;

    insert into schedule_options (organization_id, week_start, label, strategy,
      items, total_hours, capacity_hours, status, generated_by)
    values (v_org, v_week, strat.label, strat.description,
      v_items, v_total, v_cap, 'draft', auth.uid());
    n_opts := n_opts + 1;
  end loop;

  return jsonb_build_object('ok', true, 'week_start', v_week,
    'options', n_opts, 'decision_right', v_right->>'register_ref');
end
$$;

grant execute on function public.generate_schedule_options(date, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Release: the human act that freezes the weekly schedule. Role-gated;
-- sibling drafts are discarded; released options are never modified again.
-- ----------------------------------------------------------------------------
create or replace function public.release_schedule_option(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o schedule_options%rowtype;
  v_role text;
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

  update schedule_options
  set status = 'released', released_by = auth.uid(), released_at = now()
  where id = o.id;

  update schedule_options
  set status = 'discarded'
  where organization_id = o.organization_id and week_start = o.week_start
    and status = 'draft' and id <> o.id;

  return jsonb_build_object('ok', true, 'released', o.label,
    'week_start', o.week_start);
end
$$;

grant execute on function public.release_schedule_option(uuid) to authenticated;
