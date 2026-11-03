-- C4.06 — audited weekly schedule freeze.
--
-- Canonical reuse: schedule_options remains the weekly option,
-- evaluate_schedule_feasibility remains the one feasibility door, and
-- release_schedule_option(uuid, boolean) remains the only freeze. The receipt
-- is an append-only audit_events row. No second schedule, audit, queue, or
-- outage store is introduced.
--
-- The previous green claim rested on this SECURITY DEFINER door while it still
-- admitted the AI-operator identity (#630). That identity stays refused by
-- name, before the planner / maintenance-manager / administrator check. This
-- migration does not widen the role list and does not replace generation.
--
-- A freeze now fails closed unless feasibility returns a decision, writes the
-- actor, role, week and exact feasibility digest in the same transaction, and
-- is the only statement allowed to mark a week released or discarded.
-- Reading the receipt grants no production-interruption approval, outage
-- release, work execution, or return to service.

create or replace function public.guard_schedule_option_freeze()
returns trigger
language plpgsql
set search_path = public
as $guard$
declare
  v_marker text := coalesce(current_setting('syncai.schedule_freeze', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'schedule_options cannot be truncated; a frozen week stays with its audit receipt'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'released' then
      raise exception 'a released weekly schedule cannot be deleted'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if new.organization_id is null then
    raise exception 'a schedule option requires a tenant'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and old.organization_id is distinct from new.organization_id then
    raise exception 'a schedule option cannot move between tenants'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' and old.status = 'released' then
    raise exception 'a released weekly schedule is frozen and cannot be rewritten'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status in ('released', 'discarded')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and v_marker is distinct from '1' then
    raise exception 'releasing or discarding a weekly schedule is only release_schedule_option'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$guard$;

revoke all on function public.guard_schedule_option_freeze()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_schedule_option_freeze on public.schedule_options;
create trigger trg_schedule_option_freeze
  before insert or update or delete on public.schedule_options
  for each row execute function public.guard_schedule_option_freeze();

drop trigger if exists trg_schedule_option_freeze_truncate on public.schedule_options;
create trigger trg_schedule_option_freeze_truncate
  before truncate on public.schedule_options
  for each statement execute function public.guard_schedule_option_freeze();

create or replace function public.release_schedule_option(
  p_id uuid,
  p_acknowledge_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $sched$
declare
  o public.schedule_options%rowtype;
  v_role text;
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  f jsonb;
  v_digest text;
  v_audit_id uuid;
  v_released uuid;
begin
  select role into v_role from public.user_profiles where id = v_uid;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'Releasing a weekly schedule is a §70 human act. The AI-operator identity may prepare a schedule option; it may not freeze the week or authorize a production interruption.');
  end if;
  if coalesce(v_role, '') not in ('planner', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error',
      'releasing a schedule requires planner or manager authority');
  end if;
  if v_uid is null or v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select * into o from public.schedule_options
  where id = p_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'option not found');
  end if;
  if o.organization_id is distinct from v_org then
    return jsonb_build_object('error', 'option not found');
  end if;
  if o.status <> 'draft' then
    return jsonb_build_object('error', 'only draft options can be released');
  end if;

  f := public.evaluate_schedule_feasibility(p_id);
  if f is null or f ? 'error'
     or (f->>'blocking_failures') is null
     or (f->>'warnings') is null then
    return jsonb_build_object('error',
      coalesce(f->>'error', 'schedule feasibility did not return a decision'),
      'feasibility', f);
  end if;

  if (f->>'blocking_failures')::int > 0 then
    return jsonb_build_object('error',
      'this schedule cannot be released: a hard constraint fails',
      'feasibility', f);
  end if;

  if (f->>'warnings')::int > 0
     and coalesce(p_acknowledge_warnings, false) is not true then
    return jsonb_build_object('error',
      format('%s constraint warning(s) — review and release with acknowledgement', f->>'warnings'),
      'feasibility', f);
  end if;

  v_digest := encode(
    extensions.digest(convert_to(f::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform set_config('syncai.schedule_freeze', '1', true);

  update public.schedule_options
  set status = 'released', released_by = v_uid, released_at = now()
  where id = o.id and organization_id = v_org and status = 'draft'
  returning id into v_released;
  if v_released is null then
    perform set_config('syncai.schedule_freeze', '', true);
    return jsonb_build_object('error', 'only draft options can be released');
  end if;

  update public.schedule_options
  set status = 'discarded'
  where organization_id = v_org and week_start = o.week_start
    and id <> o.id and status = 'draft';

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state
  ) values (
    v_org,
    'schedule_option',
    v_uid::text,
    jsonb_build_object(
      'action', 'schedule_frozen',
      'option_id', o.id,
      'week_start', o.week_start,
      'label', o.label,
      'strategy', o.strategy,
      'actor_id', v_uid,
      'actor_role', v_role,
      'warnings_acknowledged', (f->>'warnings')::int,
      'acknowledgement_supplied', coalesce(p_acknowledge_warnings, false),
      'blocking_failures', (f->>'blocking_failures')::int,
      'feasibility_sha256', v_digest,
      'feasibility', f,
      'boundary', 'Freezing the week records the feasibility enforced at release. It does not approve a production interruption, release outage scope, authorize work execution, or return equipment to service. The AI-operator identity cannot take this act.'
    ),
    to_jsonb(o),
    jsonb_build_object(
      'id', o.id,
      'organization_id', v_org,
      'status', 'released',
      'week_start', o.week_start,
      'label', o.label,
      'released_by', v_uid,
      'feasibility_sha256', v_digest
    )
  )
  returning id into v_audit_id;

  perform set_config('syncai.schedule_freeze', '', true);

  return jsonb_build_object(
    'released', o.id,
    'week_start', o.week_start,
    'audit_id', v_audit_id,
    'feasibility_sha256', v_digest,
    'warnings_acknowledged', (f->>'warnings')::int,
    'feasibility', f,
    'boundary', 'The week is frozen for this tenant only. The receipt is not approval to interrupt production, release an outage, or execute work.'
  );
end
$sched$;

revoke all on function public.release_schedule_option(uuid, boolean)
  from public, anon, service_role;
grant execute on function public.release_schedule_option(uuid, boolean)
  to authenticated;

comment on function public.release_schedule_option(uuid, boolean) is
  'C4.06 freeze. Hard constraints block; soft warnings require explicit human acknowledgement. ai_admin is refused by name before the planner, maintenance-manager and administrator check. The act appends an audit_events receipt of the exact feasibility digest and is the only writer that may mark a week released.';

create or replace function public.get_schedule_freeze_receipts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $read$
declare
  v_org uuid := public.app_current_org();
  v_count int;
  v_receipts jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select count(*)::int into v_count
  from public.audit_events a
  where a.organization_id = v_org
    and a.entity_type = 'schedule_option'
    and a.event_data->>'action' = 'schedule_frozen';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'audit_id', a.id,
      'event_time', a.event_time,
      'actor', a.actor,
      'option_id', a.event_data->>'option_id',
      'week_start', a.event_data->>'week_start',
      'label', a.event_data->>'label',
      'actor_role', a.event_data->>'actor_role',
      'warnings_acknowledged', a.event_data->'warnings_acknowledged',
      'acknowledgement_supplied', a.event_data->'acknowledgement_supplied',
      'feasibility_sha256', a.event_data->>'feasibility_sha256',
      'checks', coalesce(a.event_data->'feasibility'->'checks', '[]'::jsonb),
      'boundary', a.event_data->>'boundary'
    ) order by a.event_time desc
  ), '[]'::jsonb)
  into v_receipts
  from (
    select *
    from public.audit_events
    where organization_id = v_org
      and entity_type = 'schedule_option'
      and event_data->>'action' = 'schedule_frozen'
    order by event_time desc
    limit 104
  ) a;

  return jsonb_build_object(
    'organization_id', v_org,
    'receipt_count', v_count,
    'truncated', v_count > coalesce(jsonb_array_length(v_receipts), 0),
    'receipts', v_receipts,
    'boundary', 'These receipts record weekly freezes already taken. Reading them does not freeze a week, approve a production interruption, release outage scope, or authorize work.'
  );
end
$read$;

revoke all on function public.get_schedule_freeze_receipts()
  from public, anon, service_role;
grant execute on function public.get_schedule_freeze_receipts()
  to authenticated;

comment on function public.get_schedule_freeze_receipts() is
  'C4.06 read of this tenant''s weekly freeze receipts. It does not release a schedule.';

notify pgrst, 'reload schema';
