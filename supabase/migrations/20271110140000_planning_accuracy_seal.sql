-- C6.14 planning accuracy.
--
-- get_planning_accuracy used to average any completed work order that happened
-- to carry planned_hours and actual_hours. Closeout labour, a client status
-- change, and a named-human task actual could all look like the same sample.
-- This seal freezes one comparison: the labour hours of the job plan that was
-- applied, against task actuals recorded by a named person in the same tenant,
-- and only after governed closeout has set closed_at.
--
-- The within-10% band and the bias sentences are the existing planning band
-- from 20260811090000. They are not a new engineering or OEM limit.
--
-- Sealing does not complete the work order, release equipment, or return it
-- to service. Those remain the existing closeout and custody acts.

create table if not exists public.planning_accuracy_receipts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  job_plan_id uuid not null references public.job_plans(id),
  planned_hours numeric not null,
  actual_hours numeric not null,
  task_count integer not null,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  constraint planning_accuracy_receipts_work_order_unique unique (work_order_id),
  constraint planning_accuracy_receipts_hours_finite check (
    planned_hours > 0
    and planned_hours < 'Infinity'::numeric
    and planned_hours <> 'NaN'::numeric
    and actual_hours > 0
    and actual_hours < 'Infinity'::numeric
    and actual_hours <> 'NaN'::numeric
    and task_count > 0
  )
);

create index if not exists idx_planning_accuracy_receipts_org
  on public.planning_accuracy_receipts (organization_id, recorded_at desc);

alter table public.planning_accuracy_receipts enable row level security;

drop policy if exists planning_accuracy_receipts_read on public.planning_accuracy_receipts;
create policy planning_accuracy_receipts_read
  on public.planning_accuracy_receipts
  for select to authenticated
  using (organization_id = public.app_current_org());

revoke insert, update, delete, truncate
  on public.planning_accuracy_receipts
  from public, anon, authenticated;
grant select on public.planning_accuracy_receipts to authenticated;

create or replace function public.protect_planning_accuracy_receipt()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'planning accuracy receipts are append-only';
  end if;
  if not exists (
    select 1 from public.work_orders w
    where w.id = new.work_order_id and w.organization_id = new.organization_id
  ) then
    raise exception 'planning accuracy receipt work order must belong to the receipt organization';
  end if;
  if not exists (
    select 1 from public.job_plans p
    where p.id = new.job_plan_id and p.organization_id = new.organization_id
  ) then
    raise exception 'planning accuracy receipt job plan must belong to the receipt organization';
  end if;
  if not exists (
    select 1 from public.user_profiles up
    where up.id = new.recorded_by and up.organization_id = new.organization_id
  ) then
    raise exception 'planning accuracy recorder must belong to the receipt organization';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_planning_accuracy_receipt
  on public.planning_accuracy_receipts;
create trigger trg_protect_planning_accuracy_receipt
  before insert or update or delete on public.planning_accuracy_receipts
  for each row execute function public.protect_planning_accuracy_receipt();

revoke all on function public.protect_planning_accuracy_receipt()
  from public, anon, authenticated;

-- Clients may still update a task description or status. They may not mint the
-- actual that planning accuracy trusts. record_task_actual runs as the
-- function owner, so this guard sees authenticated or anon only for a direct
-- write. Execute stays granted to authenticated because the trigger fires on
-- ordinary task updates.
create or replace function public.protect_task_actual_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.actual_recorded_by is not null
         or new.actual_recorded_at is not null
         or coalesce(new.actual_hours, 0) <> 0 then
        raise exception 'task actuals are recorded only through record_task_actual';
      end if;
    elsif tg_op = 'UPDATE' then
      if new.actual_hours is distinct from old.actual_hours
         or new.actual_recorded_by is distinct from old.actual_recorded_by
         or new.actual_recorded_at is distinct from old.actual_recorded_at then
        raise exception 'task actuals are recorded only through record_task_actual';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_task_actual_provenance on public.work_order_tasks;
create trigger trg_protect_task_actual_provenance
  before insert or update on public.work_order_tasks
  for each row execute function public.protect_task_actual_provenance();

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
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_wo uuid;
  v_closed timestamptz;
  v_status text;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if v_role is null
     or v_role not in (
       'technician', 'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
     ) then
    return jsonb_build_object(
      'error',
      'recording task actuals requires a named maintenance or planning role'
    );
  end if;
  if p_actual_hours is null
     or p_actual_hours <> p_actual_hours
     or p_actual_hours >= 'Infinity'::numeric
     or p_actual_hours <= '-Infinity'::numeric
     or p_actual_hours < 0 then
    return jsonb_build_object('error', 'actual hours must be zero or greater');
  end if;
  if coalesce(p_status, '') not in ('complete', 'completed') then
    return jsonb_build_object('error', 'task status must be complete');
  end if;

  select w.id, w.closed_at, w.status
    into v_wo, v_closed, v_status
  from public.work_order_tasks t
  join public.work_orders w
    on w.id = t.work_order_id and w.organization_id = t.organization_id
  where t.id = p_task_id and t.organization_id = v_org
  for update of w;

  if v_wo is null then
    return jsonb_build_object('error', 'task not found');
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('error', 'cancelled work is excluded from planning accuracy');
  end if;
  if exists (
    select 1 from public.planning_accuracy_receipts r
    where r.work_order_id = v_wo and r.organization_id = v_org
  ) then
    return jsonb_build_object(
      'error',
      'planning accuracy is already sealed for this work order'
    );
  end if;

  update public.work_order_tasks
  set actual_hours = p_actual_hours,
      status = p_status,
      actual_recorded_at = now(),
      actual_recorded_by = v_actor
  where id = p_task_id and organization_id = v_org;

  if v_closed is null then
    update public.work_orders w
    set actual_hours = (
      select coalesce(sum(actual_hours), 0)
      from public.work_order_tasks
      where work_order_id = v_wo and organization_id = v_org
    )
    where w.id = v_wo and w.organization_id = v_org;
  end if;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'planning_accuracy',
    v_role,
    jsonb_build_object(
      'action', 'task_actual_recorded',
      'task_id', p_task_id,
      'work_order_id', v_wo,
      'actual_hours', p_actual_hours,
      'recorded_by', v_actor
    )
  );

  return jsonb_build_object(
    'task_id', p_task_id,
    'work_order_id', v_wo,
    'actual_hours', p_actual_hours
  );
end;
$$;

revoke all on function public.record_task_actual(uuid, numeric, text)
  from public, anon;
grant execute on function public.record_task_actual(uuid, numeric, text)
  to authenticated;

create or replace function public.seal_planning_accuracy(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  w public.work_orders%rowtype;
  p public.job_plans%rowtype;
  v_planned numeric;
  v_actual numeric;
  v_steps integer;
  v_tasks integer;
  v_existing public.planning_accuracy_receipts%rowtype;
begin
  if v_org is null or v_actor is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;
  if v_role is null
     or v_role not in (
       'technician', 'planner', 'reliability_engineer', 'maintenance_manager', 'admin'
     ) then
    return jsonb_build_object(
      'error',
      'sealing planning accuracy requires a named maintenance or planning role'
    );
  end if;

  select * into v_existing
  from public.planning_accuracy_receipts
  where work_order_id = p_work_order_id and organization_id = v_org;
  if found then
    return jsonb_build_object(
      'sealed', true,
      'already_sealed', true,
      'work_order_id', v_existing.work_order_id,
      'planned_hours', v_existing.planned_hours,
      'actual_hours', v_existing.actual_hours,
      'task_count', v_existing.task_count
    );
  end if;

  select * into w
  from public.work_orders
  where id = p_work_order_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if w.status = 'cancelled' then
    return jsonb_build_object('error', 'cancelled work is excluded from planning accuracy');
  end if;
  if w.closed_at is null or w.completed_at is null or w.status <> 'completed' then
    return jsonb_build_object(
      'error',
      'governed closeout must complete this work order before planning accuracy can be sealed'
    );
  end if;
  if w.job_plan_id is null then
    return jsonb_build_object(
      'error',
      'planning accuracy needs the adopted job plan that was applied to this work order'
    );
  end if;

  select * into p
  from public.job_plans
  where id = w.job_plan_id and organization_id = v_org;
  if not found or p.status not in ('adopted', 'superseded') then
    return jsonb_build_object(
      'error',
      'planning accuracy uses the adopted plan that was applied, including a later superseded version'
    );
  end if;

  select coalesce(sum(estimated_hours * crew_size), 0)
    into v_planned
  from public.job_plan_steps
  where job_plan_id = p.id and organization_id = v_org;
  if v_planned is null
     or v_planned <> v_planned
     or v_planned >= 'Infinity'::numeric
     or v_planned <= 0 then
    return jsonb_build_object(
      'error',
      'the applied job plan has no positive labour hours to compare'
    );
  end if;
  if w.planned_hours is distinct from v_planned then
    return jsonb_build_object(
      'error',
      'planned hours on the work order no longer match the applied job plan'
    );
  end if;

  select count(*) into v_steps
  from public.job_plan_steps
  where job_plan_id = p.id and organization_id = v_org;
  select count(*) into v_tasks
  from public.work_order_tasks
  where work_order_id = w.id and organization_id = v_org;
  if v_steps = 0 or v_tasks <> v_steps then
    return jsonb_build_object(
      'error',
      'the work order tasks no longer match the applied job plan'
    );
  end if;
  if exists (
    select 1
    from public.work_order_tasks t
    where t.work_order_id = w.id
      and t.organization_id = v_org
      and not exists (
        select 1 from public.job_plan_steps s
        where s.id = t.job_plan_step_id
          and s.job_plan_id = p.id
          and s.organization_id = v_org
      )
  ) then
    return jsonb_build_object(
      'error',
      'the work order tasks no longer match the applied job plan'
    );
  end if;
  if exists (
    select 1
    from public.work_order_tasks t
    where t.work_order_id = w.id
      and t.organization_id = v_org
      and (
        t.actual_recorded_by is null
        or t.actual_recorded_at is null
        or t.actual_hours is null
        or t.actual_hours <> t.actual_hours
        or t.actual_hours >= 'Infinity'::numeric
        or t.actual_hours < 0
        or not exists (
          select 1 from public.user_profiles up
          where up.id = t.actual_recorded_by and up.organization_id = v_org
        )
      )
  ) then
    return jsonb_build_object(
      'error',
      'every task needs a same-tenant named-human actual before planning accuracy can be sealed'
    );
  end if;

  select coalesce(sum(actual_hours), 0) into v_actual
  from public.work_order_tasks
  where work_order_id = w.id and organization_id = v_org;
  if v_actual is null
     or v_actual <> v_actual
     or v_actual >= 'Infinity'::numeric
     or v_actual <= 0 then
    return jsonb_build_object('error', 'recorded actual hours must be greater than zero');
  end if;

  begin
    insert into public.planning_accuracy_receipts (
      organization_id, work_order_id, job_plan_id,
      planned_hours, actual_hours, task_count, recorded_by
    ) values (
      v_org, w.id, p.id, v_planned, v_actual, v_tasks, v_actor
    );
  exception when unique_violation then
    select * into v_existing
    from public.planning_accuracy_receipts
    where work_order_id = w.id and organization_id = v_org;
    return jsonb_build_object(
      'sealed', true,
      'already_sealed', true,
      'work_order_id', v_existing.work_order_id,
      'planned_hours', v_existing.planned_hours,
      'actual_hours', v_existing.actual_hours,
      'task_count', v_existing.task_count
    );
  end;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (
    v_org,
    'planning_accuracy',
    v_role,
    jsonb_build_object(
      'action', 'sealed',
      'work_order_id', w.id,
      'job_plan_id', p.id,
      'planned_hours', v_planned,
      'actual_hours', v_actual,
      'task_count', v_tasks,
      'recorded_by', v_actor
    )
  );

  return jsonb_build_object(
    'sealed', true,
    'already_sealed', false,
    'work_order_id', w.id,
    'planned_hours', v_planned,
    'actual_hours', v_actual,
    'task_count', v_tasks
  );
end;
$$;

revoke all on function public.seal_planning_accuracy(uuid) from public, anon;
grant execute on function public.seal_planning_accuracy(uuid) to authenticated;

create or replace function public.get_planning_accuracy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_n integer;
  v_mape numeric;
  v_bias numeric;
  v_within numeric;
  v_open integer;
  v_unsealed integer;
  v_client integer;
  v_unplanned integer;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select count(*),
         round(avg(abs(actual_hours - planned_hours) / planned_hours * 100)::numeric, 1),
         round(avg((actual_hours - planned_hours) / planned_hours * 100)::numeric, 1),
         round(100.0 * count(*) filter (
           where abs(actual_hours - planned_hours) / planned_hours <= 0.10
         ) / nullif(count(*), 0), 1)
    into v_n, v_mape, v_bias, v_within
  from public.planning_accuracy_receipts
  where organization_id = v_org;

  select count(*) into v_open
  from public.work_orders w
  where w.organization_id = v_org
    and w.job_plan_id is not null
    and w.status not in ('completed', 'cancelled')
    and not exists (
      select 1 from public.planning_accuracy_receipts r
      where r.work_order_id = w.id and r.organization_id = v_org
    );

  select count(*) into v_unsealed
  from public.work_orders w
  where w.organization_id = v_org
    and w.job_plan_id is not null
    and w.closed_at is not null
    and not exists (
      select 1 from public.planning_accuracy_receipts r
      where r.work_order_id = w.id and r.organization_id = v_org
    );

  select count(*) into v_client
  from public.work_orders w
  where w.organization_id = v_org
    and w.job_plan_id is not null
    and w.completed_at is not null
    and w.closed_at is null;

  select count(*) into v_unplanned
  from public.work_orders w
  where w.organization_id = v_org
    and w.job_plan_id is null
    and w.closed_at is not null;

  return jsonb_build_object(
    'available', coalesce(v_n, 0) > 0,
    'sample', coalesce(v_n, 0),
    'mean_absolute_error_pct', v_mape,
    'bias_pct', v_bias,
    'within_10_pct', v_within,
    'excluded_open_with_plan', coalesce(v_open, 0),
    'excluded_closed_unsealed', coalesce(v_unsealed, 0),
    'excluded_client_completed', coalesce(v_client, 0),
    'excluded_closed_without_plan', coalesce(v_unplanned, 0),
    'bias_reading', case
      when v_n is null or v_n = 0 then null
      when v_bias > 10 then 'Estimates run optimistic: jobs take longer than planned.'
      when v_bias < -10 then 'Estimates run conservative: jobs finish inside the plan.'
      else 'No systematic lean in the estimates.' end,
    'basis', case when coalesce(v_n, 0) > 0
      then format(
        'Mean absolute percentage error and signed bias of named-human task actuals against the applied job plan, over %s sealed completed work orders in this tenant. Excluded from the percentage: %s open with a plan, %s closed without a seal, %s completed without governed closeout, %s closed without a plan. The within-10%% figure is the existing planning band, not an engineering limit.',
        v_n, v_open, v_unsealed, v_client, v_unplanned)
      else format(
        'No sealed completed work order yet carries both adopted-plan hours and named-human task actuals. Apply an adopted plan, record every task actual, complete the work order through governed closeout, then seal the measurement. Excluded so far: %s open with a plan, %s closed without a seal, %s completed without governed closeout, %s closed without a plan.',
        coalesce(v_open, 0), coalesce(v_unsealed, 0), coalesce(v_client, 0), coalesce(v_unplanned, 0))
      end
  );
end;
$$;

revoke all on function public.get_planning_accuracy() from public, anon;
grant execute on function public.get_planning_accuracy() to authenticated;

comment on function public.seal_planning_accuracy(uuid) is
  'C6.14: tenant-scoped named-human seal of adopted-plan hours against recorded task actuals after governed closeout. Does not complete work or return equipment to service.';

notify pgrst, 'reload schema';
