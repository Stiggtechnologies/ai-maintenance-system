-- ============================================================================
-- E4.08 — Records retention becomes a named-human determination.
--
-- The catalogue in 20260809090000 already states five record classes and
-- get_retention_position() already counts records, records beyond the stated
-- period, the oldest record and legal hold. Those policies are seeded as
-- drafts because a retention period is the operator's legal determination.
-- Nothing could adopt one, place a hold, or record the review the position
-- report already says is required.
--
-- This migration extends that one table and the existing audit ledger. It
-- does not add a second retention store, and it does not delete operating
-- records. Counting uses the five canonical tables already named by the
-- catalogue. No external system, including SAP, is consulted.
--
-- A draft remains a proposal. Adoption replaces the live period and basis
-- with the words and number a named administrator or executive submits.
-- The prior proposal is preserved on the audit row, not overwritten in
-- silence. A later submission revises the live period the same way.
-- Legal hold is a separate act: the human who placed it cannot release it.
-- A review records that a human looked at records beyond policy. The rows
-- stay where they are.
-- ============================================================================

alter table public.retention_policies
  add column if not exists legal_hold_by uuid references auth.users(id) on delete set null,
  add column if not exists legal_hold_at timestamptz,
  add column if not exists last_review_by uuid references auth.users(id) on delete set null,
  add column if not exists last_review_at timestamptz,
  add column if not exists last_review_note text;

alter table public.retention_policies
  drop constraint if exists retention_policies_retain_years_finite;
alter table public.retention_policies
  add constraint retention_policies_retain_years_finite
  check (
    retain_years > 0
    and retain_years <= 10000
    and retain_years <> 'NaN'::numeric
  );

alter table public.retention_policies
  drop constraint if exists retention_policies_hold_names_its_author;
alter table public.retention_policies
  add constraint retention_policies_hold_names_its_author
  check (
    not legal_hold
    or (
      legal_hold_by is not null
      and legal_hold_reason is not null
      and length(btrim(legal_hold_reason)) between 20 and 4000
    )
  );

alter table public.retention_policies
  drop constraint if exists retention_policies_review_note_shape;
alter table public.retention_policies
  add constraint retention_policies_review_note_shape
  check (
    last_review_note is null
    or length(btrim(last_review_note)) between 20 and 4000
  );

comment on column public.retention_policies.legal_hold_by is
  'E4.08: named human who placed the current legal hold. That same human cannot release it.';
comment on column public.retention_policies.last_review_note is
  'E4.08: latest human review of the retention position. A review does not destroy records.';

-- The five classes seeded in 20260809090000. A row that names anything else
-- is reported and refused, never counted, so a poisoned catalogue entry
-- cannot become a dynamic query.
create or replace function public.retention_catalogue_pair(p_table text, p_column text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select (p_table, p_column) in (
    ('work_orders', 'created_at'),
    ('recommendations', 'created_at'),
    ('recommendation_screenings', 'screened_at'),
    ('board_packs', 'prepared_at'),
    ('audit_events', 'event_time')
  );
$fn$;

revoke all on function public.retention_catalogue_pair(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.retention_named_governor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_name text;
  v_profile_org uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object(
      'error', 'a named human in this organization must make this determination');
  end if;

  select role, full_name, organization_id
    into v_role, v_name, v_profile_org
  from public.user_profiles
  where id = auth.uid();

  if not found
     or v_profile_org is distinct from v_org
     or nullif(btrim(v_name), '') is null then
    return jsonb_build_object(
      'error', 'a named human in this organization must make this determination');
  end if;

  if v_role = 'ai_admin' then
    return jsonb_build_object(
      'error', 'an ai or system identity may not determine records retention');
  end if;

  if v_role not in ('admin', 'executive') then
    return jsonb_build_object(
      'error', 'records retention is a legal determination and requires an administrator or executive');
  end if;

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_org,
    'role', v_role,
    'actor_id', auth.uid(),
    'actor_name', btrim(v_name));
end
$fn$;

revoke all on function public.retention_named_governor()
  from public, anon, authenticated, service_role;

create or replace function public.retention_policies_governed_write()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception
      'retention policies are not deleted. Supersede a period by recording a new determination; operating records are never destroyed from this catalogue.'
      using errcode = 'insufficient_privilege';
  end if;
  if current_setting('syncai.retention_policy_write', true) is distinct from 'on' then
    raise exception
      'retention policies are written only through adopt_retention_policy, set_retention_legal_hold and record_retention_review'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$fn$;

revoke all on function public.retention_policies_governed_write()
  from public, anon, authenticated, service_role;

create or replace function public.retention_policies_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception
    'retention policies are not truncated. The retention position is a report, and operating records are not destroyed from this catalogue.'
    using errcode = 'insufficient_privilege';
end
$fn$;

revoke all on function public.retention_policies_no_truncate()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_retention_policies_governed_write on public.retention_policies;
create trigger trg_retention_policies_governed_write
  before update or delete on public.retention_policies
  for each row execute function public.retention_policies_governed_write();

drop trigger if exists trg_retention_policies_no_truncate on public.retention_policies;
create trigger trg_retention_policies_no_truncate
  before truncate on public.retention_policies
  for each statement execute function public.retention_policies_no_truncate();

revoke truncate on table public.retention_policies
  from public, anon, authenticated, service_role;

create or replace function public.retention_policy_snapshot(p public.retention_policies)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object(
    'id', p.id,
    'record_class', p.record_class,
    'table_name', p.table_name,
    'timestamp_column', p.timestamp_column,
    'retain_years', p.retain_years,
    'basis', p.basis,
    'status', p.status,
    'legal_hold', p.legal_hold,
    'legal_hold_reason', p.legal_hold_reason,
    'legal_hold_by', p.legal_hold_by,
    'legal_hold_at', p.legal_hold_at,
    'adopted_by', p.adopted_by,
    'adopted_at', p.adopted_at,
    'last_review_by', p.last_review_by,
    'last_review_at', p.last_review_at,
    'last_review_note', p.last_review_note);
$fn$;

revoke all on function public.retention_policy_snapshot(public.retention_policies)
  from public, anon, authenticated, service_role;

create or replace function public.adopt_retention_policy(
  p_policy_id uuid,
  p_retain_years numeric,
  p_basis text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb := public.retention_named_governor();
  v_org uuid;
  v_row public.retention_policies%rowtype;
  v_prior public.audit_events%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_result jsonb;
begin
  if v_gate ? 'error' then
    return v_gate;
  end if;
  v_org := (v_gate->>'organization_id')::uuid;

  if p_policy_id is null or p_command_id is null then
    return jsonb_build_object('error', 'a retention determination needs a policy and a command id');
  end if;
  if p_retain_years is null
     or p_retain_years <= 0
     or p_retain_years > 10000
     or p_retain_years = 'NaN'::numeric then
    return jsonb_build_object(
      'error',
      'state a finite retention period in years greater than zero and at most 10000, the largest period this catalogue stores');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20
     or length(btrim(p_basis)) > 4000 then
    return jsonb_build_object(
      'error',
      'state the organization''s legal or corporate basis for this period (20 to 4000 characters)');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':retention:' || p_command_id::text, 0));

  select * into v_prior
  from public.audit_events
  where organization_id = v_org
    and entity_type = 'retention_policy'
    and event_data->>'command_id' = p_command_id::text
  order by event_time desc, id desc
  limit 1;
  if found then
    if v_prior.actor is distinct from auth.uid()::text then
      return jsonb_build_object('error', 'command id already used');
    end if;
    return coalesce(v_prior.event_data->'result', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  end if;

  select * into v_row
  from public.retention_policies
  where id = p_policy_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  if v_row.status not in ('draft', 'adopted') then
    return jsonb_build_object('error', 'only a draft or adopted retention policy can be determined');
  end if;
  if not public.retention_catalogue_pair(v_row.table_name, v_row.timestamp_column) then
    return jsonb_build_object('error', 'this record class is outside the governed retention catalogue');
  end if;

  v_previous := public.retention_policy_snapshot(v_row);
  perform set_config('syncai.retention_policy_write', 'on', true);
  update public.retention_policies
  set status = 'adopted',
      retain_years = p_retain_years,
      basis = btrim(p_basis),
      adopted_by = auth.uid(),
      adopted_at = now()
  where id = v_row.id and organization_id = v_org
  returning * into v_row;
  if not found then
    perform set_config('syncai.retention_policy_write', '', true);
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  perform set_config('syncai.retention_policy_write', '', true);

  v_new := public.retention_policy_snapshot(v_row);
  v_result := jsonb_build_object(
    'outcome', case when v_previous->>'status' = 'draft' then 'adopted' else 'revised' end,
    'policy_id', v_row.id,
    'record_class', v_row.record_class,
    'retain_years', v_row.retain_years,
    'status', v_row.status);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (
    v_org,
    'retention_policy',
    auth.uid()::text,
    jsonb_build_object(
      'command_id', p_command_id,
      'action', 'adopt',
      'policy_id', v_row.id,
      'record_class', v_row.record_class,
      'actor_name', v_gate->>'actor_name',
      'result', v_result),
    v_previous,
    v_new);

  return v_result;
end
$fn$;

revoke all on function public.adopt_retention_policy(uuid, numeric, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.adopt_retention_policy(uuid, numeric, text, uuid)
  to authenticated;

create or replace function public.set_retention_legal_hold(
  p_policy_id uuid,
  p_hold boolean,
  p_reason text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb := public.retention_named_governor();
  v_org uuid;
  v_row public.retention_policies%rowtype;
  v_prior public.audit_events%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_result jsonb;
begin
  if v_gate ? 'error' then
    return v_gate;
  end if;
  v_org := (v_gate->>'organization_id')::uuid;

  if p_policy_id is null or p_command_id is null or p_hold is null then
    return jsonb_build_object('error', 'a legal hold needs a policy, a command id and a hold decision');
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 20 or length(btrim(p_reason)) > 4000 then
    return jsonb_build_object(
      'error', 'state why the legal hold is placed or released (20 to 4000 characters)');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':retention:' || p_command_id::text, 0));

  select * into v_prior
  from public.audit_events
  where organization_id = v_org
    and entity_type = 'retention_policy'
    and event_data->>'command_id' = p_command_id::text
  order by event_time desc, id desc
  limit 1;
  if found then
    if v_prior.actor is distinct from auth.uid()::text then
      return jsonb_build_object('error', 'command id already used');
    end if;
    return coalesce(v_prior.event_data->'result', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  end if;

  select * into v_row
  from public.retention_policies
  where id = p_policy_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  if v_row.status not in ('draft', 'adopted') then
    return jsonb_build_object('error', 'a legal hold applies to a draft or adopted retention policy');
  end if;
  if not public.retention_catalogue_pair(v_row.table_name, v_row.timestamp_column) then
    return jsonb_build_object('error', 'this record class is outside the governed retention catalogue');
  end if;
  if p_hold and v_row.legal_hold then
    return jsonb_build_object('error', 'this record class is already under legal hold');
  end if;
  if not p_hold and not v_row.legal_hold then
    return jsonb_build_object('error', 'this record class is not under legal hold');
  end if;
  if not p_hold
     and v_row.legal_hold_by is not null
     and v_row.legal_hold_by = auth.uid() then
    return jsonb_build_object(
      'error', 'the human who placed the legal hold cannot release it');
  end if;

  v_previous := public.retention_policy_snapshot(v_row);
  perform set_config('syncai.retention_policy_write', 'on', true);
  update public.retention_policies
  set legal_hold = p_hold,
      legal_hold_reason = case when p_hold then btrim(p_reason) else null end,
      legal_hold_by = case when p_hold then auth.uid() else null end,
      legal_hold_at = case when p_hold then now() else null end
  where id = v_row.id and organization_id = v_org
  returning * into v_row;
  if not found then
    perform set_config('syncai.retention_policy_write', '', true);
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  perform set_config('syncai.retention_policy_write', '', true);

  v_new := public.retention_policy_snapshot(v_row);
  v_result := jsonb_build_object(
    'outcome', case when p_hold then 'hold_placed' else 'hold_released' end,
    'policy_id', v_row.id,
    'record_class', v_row.record_class,
    'legal_hold', v_row.legal_hold);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (
    v_org,
    'retention_policy',
    auth.uid()::text,
    jsonb_build_object(
      'command_id', p_command_id,
      'action', case when p_hold then 'place_legal_hold' else 'release_legal_hold' end,
      'policy_id', v_row.id,
      'record_class', v_row.record_class,
      'actor_name', v_gate->>'actor_name',
      'reason', btrim(p_reason),
      'result', v_result),
    v_previous,
    v_new);

  return v_result;
end
$fn$;

revoke all on function public.set_retention_legal_hold(uuid, boolean, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_retention_legal_hold(uuid, boolean, text, uuid)
  to authenticated;

create or replace function public.record_retention_review(
  p_policy_id uuid,
  p_note text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_gate jsonb := public.retention_named_governor();
  v_org uuid;
  v_row public.retention_policies%rowtype;
  v_prior public.audit_events%rowtype;
  v_previous jsonb;
  v_new jsonb;
  v_result jsonb;
begin
  if v_gate ? 'error' then
    return v_gate;
  end if;
  v_org := (v_gate->>'organization_id')::uuid;

  if p_policy_id is null or p_command_id is null then
    return jsonb_build_object('error', 'a retention review needs a policy and a command id');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 or length(btrim(p_note)) > 4000 then
    return jsonb_build_object(
      'error', 'state what the review decided (20 to 4000 characters). A review does not destroy records');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':retention:' || p_command_id::text, 0));

  select * into v_prior
  from public.audit_events
  where organization_id = v_org
    and entity_type = 'retention_policy'
    and event_data->>'command_id' = p_command_id::text
  order by event_time desc, id desc
  limit 1;
  if found then
    if v_prior.actor is distinct from auth.uid()::text then
      return jsonb_build_object('error', 'command id already used');
    end if;
    return coalesce(v_prior.event_data->'result', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  end if;

  select * into v_row
  from public.retention_policies
  where id = p_policy_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  if v_row.status <> 'adopted' then
    return jsonb_build_object(
      'error', 'adopt a retention period before recording a review');
  end if;
  if not public.retention_catalogue_pair(v_row.table_name, v_row.timestamp_column) then
    return jsonb_build_object('error', 'this record class is outside the governed retention catalogue');
  end if;

  v_previous := public.retention_policy_snapshot(v_row);
  perform set_config('syncai.retention_policy_write', 'on', true);
  update public.retention_policies
  set last_review_by = auth.uid(),
      last_review_at = now(),
      last_review_note = btrim(p_note)
  where id = v_row.id and organization_id = v_org
  returning * into v_row;
  if not found then
    perform set_config('syncai.retention_policy_write', '', true);
    return jsonb_build_object('error', 'retention policy not found');
  end if;
  perform set_config('syncai.retention_policy_write', '', true);

  v_new := public.retention_policy_snapshot(v_row);
  v_result := jsonb_build_object(
    'outcome', 'reviewed',
    'policy_id', v_row.id,
    'record_class', v_row.record_class,
    'last_review_at', v_row.last_review_at);

  insert into public.audit_events (
    organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (
    v_org,
    'retention_policy',
    auth.uid()::text,
    jsonb_build_object(
      'command_id', p_command_id,
      'action', 'review',
      'policy_id', v_row.id,
      'record_class', v_row.record_class,
      'actor_name', v_gate->>'actor_name',
      'result', v_result),
    v_previous,
    v_new);

  return v_result;
end
$fn$;

revoke all on function public.record_retention_review(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_retention_review(uuid, text, uuid)
  to authenticated;

create or replace function public.get_retention_position()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := app_current_org();
  r public.retention_policies%rowtype;
  v_total bigint;
  v_beyond bigint;
  v_oldest timestamptz;
  v_cutoff timestamptz;
  v_rows jsonb := '[]'::jsonb;
  v_counted boolean;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  for r in
    select * from public.retention_policies
    where organization_id = v_org and status in ('draft', 'adopted')
    order by record_class
  loop
    v_total := null;
    v_beyond := null;
    v_oldest := null;
    v_counted := false;

    if public.retention_catalogue_pair(r.table_name, r.timestamp_column)
       and r.retain_years > 0
       and r.retain_years <= 10000
       and r.retain_years <> 'NaN'::numeric then
      v_cutoff := now() - (r.retain_years * interval '1 year');
      if r.table_name = 'work_orders' and r.timestamp_column = 'created_at' then
        select count(*),
               count(*) filter (where created_at < v_cutoff),
               min(created_at)
          into v_total, v_beyond, v_oldest
        from work_orders
        where organization_id = v_org;
        v_counted := true;
      elsif r.table_name = 'recommendations' and r.timestamp_column = 'created_at' then
        select count(*),
               count(*) filter (where created_at < v_cutoff),
               min(created_at)
          into v_total, v_beyond, v_oldest
        from recommendations
        where organization_id = v_org;
        v_counted := true;
      elsif r.table_name = 'recommendation_screenings' and r.timestamp_column = 'screened_at' then
        select count(*),
               count(*) filter (where screened_at < v_cutoff),
               min(screened_at)
          into v_total, v_beyond, v_oldest
        from recommendation_screenings
        where organization_id = v_org;
        v_counted := true;
      elsif r.table_name = 'board_packs' and r.timestamp_column = 'prepared_at' then
        select count(*),
               count(*) filter (where prepared_at < v_cutoff),
               min(prepared_at)
          into v_total, v_beyond, v_oldest
        from board_packs
        where organization_id = v_org;
        v_counted := true;
      elsif r.table_name = 'audit_events' and r.timestamp_column = 'event_time' then
        select count(*),
               count(*) filter (where event_time < v_cutoff),
               min(event_time)
          into v_total, v_beyond, v_oldest
        from audit_events
        where organization_id = v_org;
        v_counted := true;
      end if;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'id', r.id,
      'record_class', r.record_class,
      'table_name', r.table_name,
      'retain_years', r.retain_years,
      'status', r.status,
      'legal_hold', r.legal_hold,
      'legal_hold_reason', r.legal_hold_reason,
      'legal_hold_at', r.legal_hold_at,
      'records', coalesce(v_total, 0),
      'beyond_policy', coalesce(v_beyond, 0),
      'oldest_record', v_oldest,
      'basis', r.basis,
      'last_review_at', r.last_review_at,
      'last_review_note', r.last_review_note,
      'counted', v_counted,
      'disposition', case
        when not v_counted then 'Record class is outside the governed catalogue and was not counted'
        when r.legal_hold then 'Under legal hold — nothing may be destroyed'
        when r.status = 'draft' then 'Policy is a draft — no disposition until a named human adopts a period'
        when v_beyond > 0 and r.last_review_at is null then 'Eligible for review; a review records the human decision and does not destroy records'
        when v_beyond > 0 then 'Reviewed. Records remain in place'
        else 'Within policy' end);
  end loop;

  return jsonb_build_object(
    'policies', v_rows,
    'note', 'This report counts records against the live policy. It never deletes. A draft period is a proposal until a named administrator or executive adopts it. A legal hold and a review are human acts; neither destroys operating records.');
end
$fn$;

revoke all on function public.get_retention_position()
  from public, anon, authenticated, service_role;
grant execute on function public.get_retention_position() to authenticated;

create or replace function public.get_control_assurance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles where id = auth.uid();

  return jsonb_build_object(
    'role', v_role,
    'can_run', v_role in ('admin', 'ai_admin', 'executive'),
    'can_govern_retention', v_role in ('admin', 'executive'),
    'latest_run', (
      select jsonb_build_object(
        'run_at', run_at,
        'tests_run', tests_run,
        'tests_passed', tests_passed,
        'results', results)
      from public.control_audit_runs
      where organization_id = v_org
      order by run_at desc
      limit 1),
    'retention', public.get_retention_position());
end
$fn$;

revoke all on function public.get_control_assurance()
  from public, anon, authenticated, service_role;
grant execute on function public.get_control_assurance() to authenticated;

comment on function public.adopt_retention_policy(uuid, numeric, text, uuid) is
  'E4.08: a named administrator or executive states the live retention period and basis. Does not delete operating records.';
comment on function public.set_retention_legal_hold(uuid, boolean, text, uuid) is
  'E4.08: places or releases a legal hold. The human who placed the hold cannot release it. Does not delete operating records.';
comment on function public.record_retention_review(uuid, text, uuid) is
  'E4.08: records a human review of an adopted retention position. Does not delete operating records.';

notify pgrst, 'reload schema';
