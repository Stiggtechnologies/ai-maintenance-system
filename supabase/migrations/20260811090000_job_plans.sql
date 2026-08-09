-- ============================================================================
-- Executable job plans (capability register C8.07; unblocks C6.14 planning
-- accuracy, feeds C4.05/C4.06 and the materials loop).
--
-- The spec is explicit about what makes a job plan EXECUTABLE rather than a
-- title: scope, sequence, labour, duration, materials, tools, permits,
-- isolations, quality checks and acceptance criteria. All ten are modelled.
--
-- Planning accuracy (C6.14) has been reporting available:false with "needs
-- planned versus actual labour hours on job plans" as its blocker since slice
-- 8. This is that.
--
-- TWO DESIGN DECISIONS WORTH DEFENDING.
--
--   1. A PLAN CANNOT BE ADOPTED WITHOUT AN ACCEPTANCE CRITERION. A plan whose
--      completion cannot be verified is not executable — it is a to-do list.
--      adopt_job_plan refuses without at least one step and at least one
--      quality check carrying a criterion.
--
--   2. PLANNING ACCURACY IS REPORTED AS ABSOLUTE ERROR AND BIAS SEPARATELY,
--      never as a single average. A job estimated at 4 h that took 8, and one
--      estimated at 8 h that took 4, average to a variance of zero — which
--      reads as perfect planning while both jobs wrecked the schedule. Mean
--      absolute percentage error says how wrong the estimates are; bias says
--      whether they lean optimistic. Both are needed and neither substitutes
--      for the other.
--
-- Canonical reuse: work_orders, work_order_tasks (extended, not replaced),
-- materials, request_wo_material from slice 12, damage_mechanisms,
-- app_current_org(). Additive.
-- ============================================================================

create table if not exists job_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_key text not null,
  title text not null,
  scope text not null,
  -- What the plan is for: an asset class, a system group, or a mechanism.
  applies_to_asset_class text,
  applies_to_system_group text,
  applies_to_mechanism_id uuid references damage_mechanisms(id) on delete set null,
  version int not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'superseded')),
  basis text,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references job_plans(id),
  register_ref text not null default 'C8.07',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, plan_key, version)
);

alter table job_plans enable row level security;
drop policy if exists job_plans_read on job_plans;
create policy job_plans_read on job_plans
  for select to authenticated using (organization_id = app_current_org());

create table if not exists job_plan_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  step_number int not null,
  description text not null,
  craft text,                       -- discipline that performs it
  crew_size int not null default 1,
  estimated_hours numeric not null check (estimated_hours > 0),
  unique (job_plan_id, step_number)
);

alter table job_plan_steps enable row level security;
drop policy if exists job_plan_steps_read on job_plan_steps;
create policy job_plan_steps_read on job_plan_steps
  for select to authenticated using (organization_id = app_current_org());

create table if not exists job_plan_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  qty numeric not null check (qty > 0),
  unique (job_plan_id, material_id)
);

alter table job_plan_materials enable row level security;
drop policy if exists job_plan_materials_read on job_plan_materials;
create policy job_plan_materials_read on job_plan_materials
  for select to authenticated using (organization_id = app_current_org());

create table if not exists job_plan_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  tool text not null,
  note text
);

alter table job_plan_tools enable row level security;
drop policy if exists job_plan_tools_read on job_plan_tools;
create policy job_plan_tools_read on job_plan_tools
  for select to authenticated using (organization_id = app_current_org());

create table if not exists job_plan_permits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  permit_type text not null,
  -- Isolation is not a permit; it is the physical state the permit authorises.
  isolation_required text,
  verification_note text
);

alter table job_plan_permits enable row level security;
drop policy if exists job_plan_permits_read on job_plan_permits;
create policy job_plan_permits_read on job_plan_permits
  for select to authenticated using (organization_id = app_current_org());

create table if not exists job_plan_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_plan_id uuid not null references job_plans(id) on delete cascade,
  check_description text not null,
  -- The measurable statement of "done". A check without one is an opinion.
  acceptance_criterion text not null,
  is_hold_point boolean not null default false
);

alter table job_plan_checks enable row level security;
drop policy if exists job_plan_checks_read on job_plan_checks;
create policy job_plan_checks_read on job_plan_checks
  for select to authenticated using (organization_id = app_current_org());

-- work_order_tasks predates this and has no tenant column of its own.
alter table work_order_tasks
  add column if not exists organization_id uuid references organizations(id) on delete cascade,
  add column if not exists job_plan_step_id uuid references job_plan_steps(id) on delete set null,
  add column if not exists craft text,
  add column if not exists crew_size int,
  add column if not exists actual_recorded_at timestamptz,
  add column if not exists actual_recorded_by uuid references auth.users(id);

update work_order_tasks t
set organization_id = w.organization_id
from work_orders w
where t.work_order_id = w.id and t.organization_id is null;

alter table work_orders
  add column if not exists job_plan_id uuid references job_plans(id) on delete set null,
  add column if not exists planned_hours numeric;

create index if not exists idx_wo_tasks_org on work_order_tasks(organization_id, work_order_id);

-- ----------------------------------------------------------------------------
-- Authoring: the whole plan in one call
-- ----------------------------------------------------------------------------
create or replace function public.upsert_job_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
  v_key text := p_plan->>'plan_key';
  it jsonb;
  v_mat uuid;
  v_n int := 0;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'authoring a job plan requires a planning or engineering role');
  end if;
  if v_key is null or p_plan->>'title' is null or p_plan->>'scope' is null then
    return jsonb_build_object('error', 'plan_key, title and scope are required');
  end if;

  insert into job_plans (organization_id, plan_key, title, scope,
    applies_to_asset_class, applies_to_system_group, basis, created_by)
  values (v_org, v_key, p_plan->>'title', p_plan->>'scope',
    p_plan->>'applies_to_asset_class', p_plan->>'applies_to_system_group',
    p_plan->>'basis', auth.uid())
  on conflict (organization_id, plan_key, version) do update
    set title = excluded.title, scope = excluded.scope,
        applies_to_asset_class = excluded.applies_to_asset_class,
        applies_to_system_group = excluded.applies_to_system_group,
        basis = excluded.basis
  returning id into v_id;

  if (select status from job_plans where id = v_id) <> 'draft' then
    return jsonb_build_object('error',
      'this plan is adopted — revise it as a new version rather than editing an adopted plan');
  end if;

  delete from job_plan_steps where job_plan_id = v_id;
  delete from job_plan_materials where job_plan_id = v_id;
  delete from job_plan_tools where job_plan_id = v_id;
  delete from job_plan_permits where job_plan_id = v_id;
  delete from job_plan_checks where job_plan_id = v_id;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'steps', '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into job_plan_steps (organization_id, job_plan_id, step_number,
      description, craft, crew_size, estimated_hours)
    values (v_org, v_id, coalesce((it->>'step_number')::int, v_n),
      it->>'description', it->>'craft',
      coalesce((it->>'crew_size')::int, 1), (it->>'estimated_hours')::numeric);
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'materials', '[]'::jsonb)) loop
    select id into v_mat from materials
    where organization_id = v_org and material_code = it->>'material_code';
    if v_mat is not null then
      insert into job_plan_materials (organization_id, job_plan_id, material_id, qty)
      values (v_org, v_id, v_mat, coalesce((it->>'qty')::numeric, 1))
      on conflict (job_plan_id, material_id) do update set qty = excluded.qty;
    end if;
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'tools', '[]'::jsonb)) loop
    insert into job_plan_tools (organization_id, job_plan_id, tool, note)
    values (v_org, v_id, it->>'tool', it->>'note');
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'permits', '[]'::jsonb)) loop
    insert into job_plan_permits (organization_id, job_plan_id, permit_type,
      isolation_required, verification_note)
    values (v_org, v_id, it->>'permit_type', it->>'isolation_required', it->>'verification_note');
  end loop;

  for it in select * from jsonb_array_elements(coalesce(p_plan->'checks', '[]'::jsonb)) loop
    insert into job_plan_checks (organization_id, job_plan_id, check_description,
      acceptance_criterion, is_hold_point)
    values (v_org, v_id, it->>'check_description', it->>'acceptance_criterion',
      coalesce((it->>'is_hold_point')::boolean, false));
  end loop;

  return jsonb_build_object('job_plan_id', v_id, 'plan_key', v_key,
    'steps', (select count(*) from job_plan_steps where job_plan_id = v_id),
    'status', 'draft');
end
$$;

grant execute on function public.upsert_job_plan(jsonb) to authenticated;

create or replace function public.adopt_job_plan(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p job_plans%rowtype;
  v_steps int;
  v_checks int;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('planner', 'reliability_engineer', 'maintenance_manager', 'admin', 'ai_admin') then
    return jsonb_build_object('error', 'adopting a job plan requires a planning or engineering role');
  end if;

  select * into p from job_plans where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'job plan not found');
  end if;
  if p.status <> 'draft' then
    return jsonb_build_object('error', 'this plan is already ' || p.status);
  end if;

  select count(*) into v_steps from job_plan_steps where job_plan_id = p_id;
  select count(*) into v_checks from job_plan_checks where job_plan_id = p_id;

  if v_steps = 0 then
    return jsonb_build_object('error', 'a job plan with no steps is a title, not a plan');
  end if;
  -- The gate that makes a plan EXECUTABLE rather than aspirational.
  if v_checks = 0 then
    return jsonb_build_object('error',
      'a plan whose completion cannot be verified is not executable — add at least one quality check with an acceptance criterion');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the basis for adopting this plan');
  end if;

  update job_plans set status = 'superseded', superseded_by = p_id
  where organization_id = v_org and plan_key = p.plan_key and status = 'adopted';

  update job_plans
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      basis = coalesce(basis || ' | ', '') || 'Adopted: ' || trim(p_note)
  where id = p_id;

  return jsonb_build_object('adopted', p_id, 'steps', v_steps, 'checks', v_checks);
end
$$;

grant execute on function public.adopt_job_plan(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Applying a plan to real work
-- ----------------------------------------------------------------------------
create or replace function public.apply_job_plan(
  p_work_order_id uuid,
  p_plan_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p job_plans%rowtype;
  s record;
  m record;
  v_hours numeric := 0;
  v_tasks int := 0;
  v_mats int := 0;
  v_permits int;
begin
  select * into p from job_plans
  where organization_id = v_org and plan_key = p_plan_key and status = 'adopted'
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',
      format('no ADOPTED plan "%s". A draft plan may not be applied to real work.', p_plan_key));
  end if;
  if not exists (select 1 from work_orders where id = p_work_order_id and organization_id = v_org) then
    return jsonb_build_object('error', 'work order not found');
  end if;

  for s in select * from job_plan_steps where job_plan_id = p.id order by step_number loop
    insert into work_order_tasks (organization_id, work_order_id, job_plan_step_id,
      task_sequence, description, craft, crew_size, estimated_hours, status)
    values (v_org, p_work_order_id, s.id, s.step_number, s.description,
      s.craft, s.crew_size, s.estimated_hours * s.crew_size, 'pending');
    v_hours := v_hours + s.estimated_hours * s.crew_size;
    v_tasks := v_tasks + 1;
  end loop;

  -- Material demand flows straight into the slice-12 loop rather than being
  -- modelled a second time here.
  for m in select * from job_plan_materials where job_plan_id = p.id loop
    perform request_wo_material(p_work_order_id, m.material_id, m.qty);
    v_mats := v_mats + 1;
  end loop;

  select count(*) into v_permits from job_plan_permits where job_plan_id = p.id;

  update work_orders
  set job_plan_id = p.id,
      planned_hours = v_hours,
      estimated_hours = v_hours,
      -- A plan that demands a permit or an isolation is safety-relevant work,
      -- and the flag the safety screening reads should say so.
      safety_flag = case when v_permits > 0 then true else safety_flag end
  where id = p_work_order_id;

  return jsonb_build_object('work_order_id', p_work_order_id, 'plan', p_plan_key,
    'tasks_created', v_tasks, 'planned_hours', v_hours,
    'materials_requested', v_mats, 'permits_required', v_permits,
    'safety_flagged', v_permits > 0);
end
$$;

grant execute on function public.apply_job_plan(uuid, text) to authenticated;

create or replace function public.record_task_actual(
  p_task_id uuid,
  p_actual_hours numeric,
  p_status text default 'complete'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_wo uuid;
begin
  if p_actual_hours is null or p_actual_hours < 0 then
    return jsonb_build_object('error', 'actual hours must be zero or greater');
  end if;

  update work_order_tasks
  set actual_hours = p_actual_hours, status = p_status,
      actual_recorded_at = now(), actual_recorded_by = auth.uid()
  where id = p_task_id and organization_id = v_org
  returning work_order_id into v_wo;

  if v_wo is null then
    return jsonb_build_object('error', 'task not found');
  end if;

  update work_orders w
  set actual_hours = (select coalesce(sum(actual_hours), 0)
                      from work_order_tasks where work_order_id = v_wo)
  where w.id = v_wo;

  return jsonb_build_object('task_id', p_task_id, 'actual_hours', p_actual_hours);
end
$$;

grant execute on function public.record_task_actual(uuid, numeric, text) to authenticated;

create or replace function public.get_job_plans()
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
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'plan_key', p.plan_key, 'title', p.title, 'scope', p.scope,
        'applies_to', coalesce(p.applies_to_system_group, p.applies_to_asset_class, 'Any'),
        'status', p.status, 'version', p.version,
        'steps', (select count(*) from job_plan_steps where job_plan_id = p.id),
        'estimated_hours', (select coalesce(sum(estimated_hours * crew_size), 0)
                            from job_plan_steps where job_plan_id = p.id),
        'materials', (select count(*) from job_plan_materials where job_plan_id = p.id),
        'tools', (select count(*) from job_plan_tools where job_plan_id = p.id),
        'permits', (select count(*) from job_plan_permits where job_plan_id = p.id),
        'checks', (select count(*) from job_plan_checks where job_plan_id = p.id),
        'applied_to_work_orders', (select count(*) from work_orders where job_plan_id = p.id)
      ) order by p.status, p.title), '[]'::jsonb)
      from job_plans p
      where p.organization_id = v_org and p.status in ('draft', 'adopted')),
    'note', 'A plan cannot be adopted without at least one step and at least one acceptance criterion, and only an ADOPTED plan may be applied to real work.');
end
$$;

grant execute on function public.get_job_plans() to authenticated;

-- ----------------------------------------------------------------------------
-- C6.14 planning accuracy — the metric this slice unblocks
-- ----------------------------------------------------------------------------
create or replace function public.get_planning_accuracy()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := app_current_org();
  v_n int;
  v_mape numeric;
  v_bias numeric;
  v_within numeric;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*),
         round(avg(abs(actual_hours - planned_hours) / planned_hours * 100)::numeric, 1),
         round(avg((actual_hours - planned_hours) / planned_hours * 100)::numeric, 1),
         -- nullif guards the empty case: with no qualifying work orders this is
         -- 0/0, and an aggregate over zero rows must return "unknown", not raise.
         round(100.0 * count(*) filter (
           where abs(actual_hours - planned_hours) / planned_hours <= 0.10)
           / nullif(count(*), 0), 1)
  into v_n, v_mape, v_bias, v_within
  from work_orders
  where organization_id = v_org
    and planned_hours is not null and planned_hours > 0
    and actual_hours is not null and actual_hours > 0
    and completed_at is not null;

  return jsonb_build_object(
    'available', coalesce(v_n, 0) > 0,
    'sample', v_n,
    -- Absolute error and bias are reported SEPARATELY and deliberately. A job
    -- estimated at 4 h that took 8, and one estimated at 8 h that took 4,
    -- average to a variance of zero — which reads as perfect planning while
    -- both jobs wrecked the schedule.
    'mean_absolute_error_pct', v_mape,
    'bias_pct', v_bias,
    'within_10_pct', v_within,
    'bias_reading', case
      when v_n is null or v_n = 0 then null
      when v_bias > 10 then 'Estimates run optimistic: jobs take longer than planned.'
      when v_bias < -10 then 'Estimates run conservative: jobs finish inside the plan.'
      else 'No systematic lean in the estimates.' end,
    'basis', case when coalesce(v_n, 0) > 0
      then format('Planned versus actual labour hours over %s completed work orders carrying a job plan.', v_n)
      else 'No completed work order yet carries both planned hours from a job plan and recorded actuals. Apply an adopted plan and record task actuals to make this measurable (C8.07).' end);
end
$$;

grant execute on function public.get_planning_accuracy() to authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Close the loop: the work-health family has named job plans as the blocker
-- for planning accuracy since slice 8. Replace the placeholder metric.
-- ----------------------------------------------------------------------------
-- Rename the slice-12 implementation out of the way, once and idempotently.
do $$
begin
  if to_regprocedure('public.get_work_management_health_base(int)') is null then
    alter function public.get_work_management_health(int)
      rename to get_work_management_health_base;
  end if;
end $$;

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
  v_base jsonb;
  v_acc jsonb;
  v_metrics jsonb := '[]'::jsonb;
  m jsonb;
begin
  -- Rebuild on top of the existing implementation rather than duplicating five
  -- hundred lines of arithmetic: only the planning-accuracy entry changes.
  v_base := get_work_management_health_base(p_window_days);
  v_acc := get_planning_accuracy();

  for m in select * from jsonb_array_elements(v_base->'metrics') loop
    if m->>'key' = 'planning_accuracy' then
      v_metrics := v_metrics || jsonb_build_object(
        'key', 'planning_accuracy', 'label', 'Planning accuracy',
        'register_ref', 'C6.14',
        'available', v_acc->'available',
        'value', v_acc->'mean_absolute_error_pct',
        'unit', '% mean absolute error',
        'basis', concat(v_acc->>'basis',
          case when (v_acc->>'available')::boolean
            then format(' Bias %s%%: %s', v_acc->>'bias_pct', v_acc->>'bias_reading')
            else '' end));
    else
      v_metrics := v_metrics || m;
    end if;
  end loop;

  return jsonb_set(v_base, '{metrics}', v_metrics);
end
$$;

grant execute on function public.get_work_management_health(int) to authenticated;

notify pgrst, 'reload schema';
