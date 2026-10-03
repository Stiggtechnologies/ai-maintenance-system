-- D5.28 — a changed P6 re-export becomes a governed revision, not a silent
-- duplicate and not a client overwrite.
--
-- The existing import door intentionally deduplicates an activity identity.
-- This migration keeps that safe first step, then compares the retained
-- duplicate payload with the canonical imported activity. Changed rows become
-- an immutable proposal. A named human must accept or reject the proposal;
-- only acceptance re-enters the existing P6 provenance markers and updates
-- the canonical activity/relationship rows. Nothing writes back to P6.

create table if not exists public.schedule_import_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_run_id uuid not null references public.connector_runs(id) on delete restrict,
  source_name text not null,
  change_set jsonb not null,
  before_digest text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid references auth.users(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  constraint schedule_import_revision_changes_array
    check (jsonb_typeof(change_set) = 'array' and jsonb_array_length(change_set) > 0),
  constraint schedule_import_revision_decision_actor
    check ((decided_at is null) = (decided_by is null)),
  constraint schedule_import_revision_decision_note
    check ((decided_at is null) = (decision_note is null)),
  constraint schedule_import_revision_decision_said_something
    check (decision_note is null or length(btrim(decision_note)) >= 20),
  constraint schedule_import_revision_status_decision
    check ((status = 'pending') = (decided_at is null))
);

create unique index if not exists uq_schedule_import_revision_run
  on public.schedule_import_revisions(organization_id, connector_run_id);
create index if not exists idx_schedule_import_revision_status
  on public.schedule_import_revisions(organization_id, status, proposed_at desc);

alter table public.schedule_import_revisions enable row level security;
drop policy if exists schedule_import_revision_read
  on public.schedule_import_revisions;
create policy schedule_import_revision_read
  on public.schedule_import_revisions
  for select to authenticated
  using (organization_id = app_current_org());

revoke insert, update, delete, truncate
  on table public.schedule_import_revisions
  from public, anon, authenticated, service_role;
grant select on table public.schedule_import_revisions to authenticated;

comment on table public.schedule_import_revisions is
  'D5.28 (spec III.§22/§77): immutable human-reviewed changes detected in retained duplicate rows from a P6 re-export. Approval updates SyncAI''s imported analysis copy through the existing P6 provenance markers; no path writes to P6.';

-- A digest over exactly the canonical task rows and dependency rows named by
-- a proposal. Approval re-computes it so a stale proposal cannot overwrite a
-- newer import or a governed annotation made after review began.
create or replace function public.sync_schedule_revision_digest(p_changes jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with named as (
    select distinct (item->>'taskId')::bigint as task_id
    from jsonb_array_elements(p_changes) item
  ), tasks as (
    select string_agg(
      concat_ws('¦',
        t.id::text, t.event_id::text, t.task_key, t.label,
        t.duration_hours::text, coalesce(t.planned_start::text, '∅'),
        coalesce(t.planned_finish::text, '∅'),
        coalesce(t.calendar_name, '∅'), coalesce(t.wbs_path, '∅'),
        coalesce(t.total_float_hours::text, '∅'),
        coalesce(t.constraint_type, '∅'),
        coalesce(t.constraint_date::text, '∅')),
      '|' order by t.id
    ) as body
    from public.shutdown_tasks t
    join named n on n.task_id = t.id
  ), logic as (
    select string_agg(
      concat_ws('¦', d.event_id::text, d.task_key, d.predecessor_key,
        coalesce(d.link_type, '∅'), coalesce(d.lag_hours::text, '∅')),
      '|' order by d.event_id, d.task_key, d.predecessor_key
    ) as body
    from public.shutdown_task_dependencies d
    join public.shutdown_tasks t
      on t.event_id = d.event_id and t.task_key = d.task_key
    join named n on n.task_id = t.id
  )
  select md5(coalesce(tasks.body, '') || '#' || coalesce(logic.body, ''))
  from tasks cross join logic;
$$;

revoke all on function public.sync_schedule_revision_digest(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_schedule_import_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.schedule_revision_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'schedule_import_revisions is the decision record for changed P6 re-exports and cannot be truncated.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'schedule import revisions are created and decided only through their governed RPCs.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'pending' then
    raise exception
      'schedule import revision % was already % and is immutable.', old.id, old.status
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    raise exception
      'schedule import revision % is retained as the evidence of what a P6 re-export proposed and how it was decided.', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_schedule_import_revision()
  from public, anon, authenticated;

drop trigger if exists trg_schedule_import_revision_integrity
  on public.schedule_import_revisions;
create trigger trg_schedule_import_revision_integrity
  before insert or update or delete on public.schedule_import_revisions
  for each row execute function public.enforce_schedule_import_revision();

drop trigger if exists trg_schedule_import_revision_no_truncate
  on public.schedule_import_revisions;
create trigger trg_schedule_import_revision_no_truncate
  before truncate on public.schedule_import_revisions
  for each statement execute function public.enforce_schedule_import_revision();

drop trigger if exists trg_schedule_import_revision_human
  on public.schedule_import_revisions;
create trigger trg_schedule_import_revision_human
  before insert or update on public.schedule_import_revisions
  for each row execute function public.enforce_awp_act_is_human(
    'decided_by', 'accept or reject a changed P6 schedule re-export');

create or replace function public.propose_schedule_import_revision(p_run_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_source text;
  v_source_name text;
  v_run_status text;
  v_existing public.schedule_import_revisions%rowtype;
  s record;
  t public.shutdown_tasks%rowtype;
  v_case uuid;
  v_case_ids uuid[];
  v_schedule text;
  v_event uuid;
  v_fields jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_new_relationships jsonb;
  v_old_relationships jsonb;
  v_label text;
  v_wbs text;
  v_duration numeric;
  v_start timestamptz;
  v_finish timestamptz;
  v_calendar text;
  v_float numeric;
  v_constraint text;
  v_constraint_date timestamptz;
  v_revision uuid;
  v_digest text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'maintenance_manager', 'reliability_engineer', 'planner', 'ai_admin') then
    return jsonb_build_object('error',
      'reviewing imported schedule evidence requires a planning, engineering or governance role');
  end if;

  select cr.status, c.connector_key, c.name
    into v_run_status, v_source, v_source_name
  from public.connector_runs cr
  join public.connectors c on c.id = cr.connector_id
  where cr.id = p_run_id
    and cr.organization_id = v_org
    and cr.entity_type = 'schedule_activity'
    and c.connector_type = 'manual_upload';
  if not found then
    return jsonb_build_object('error', 'completed schedule import run not found');
  end if;
  if v_run_status <> 'success' then
    return jsonb_build_object('error',
      format('schedule import run is %s; a changed schedule is reviewable only after every row passes. Fix refused rows and re-import before proposing a revision.', v_run_status));
  end if;

  select * into v_existing
  from public.schedule_import_revisions r
  where r.organization_id = v_org and r.connector_run_id = p_run_id;
  if found then
    return jsonb_build_object(
      'answered', true,
      'revisionId', v_existing.id,
      'status', v_existing.status,
      'changeCount', jsonb_array_length(v_existing.change_set),
      'changes', v_existing.change_set,
      'note', 'This import run already has a revision record; it is returned rather than duplicated.'
    );
  end if;

  for s in
    select st.id, st.external_id, st.payload
    from public.ingest_staging st
    where st.organization_id = v_org
      and st.run_id = p_run_id
      and st.entity_type = 'schedule_activity'
      and st.status = 'duplicate'
    order by st.id
  loop
    v_case := null;
    if nullif(btrim(s.payload->>'development_case_id'), '') is not null then
      begin
        v_case := (btrim(s.payload->>'development_case_id'))::uuid;
      exception when others then
        v_case := null;
      end;
    else
      select array_agg(c.id) into v_case_ids
      from public.development_cases c
      where c.organization_id = v_org
        and c.title = btrim(s.payload->>'case_title');
      if coalesce(array_length(v_case_ids, 1), 0) = 1 then
        v_case := v_case_ids[1];
      else
        v_case := null;
      end if;
    end if;
    if v_case is null then continue; end if;

    v_schedule := coalesce(nullif(btrim(s.payload->>'schedule_name'), ''), 'P6 import');
    select e.id into v_event
    from public.shutdown_events e
    where e.organization_id = v_org
      and e.development_case_id = v_case
      and e.event_key = 'develop:' || v_case::text || ':' || lower(v_schedule);
    if v_event is null then continue; end if;

    select * into t from public.shutdown_tasks x
    where x.event_id = v_event
      and x.source_system = v_source
      and x.external_id = s.external_id;
    if not found or t.origin <> 'imported' then continue; end if;

    begin
      v_label := nullif(btrim(s.payload->>'description'), '');
      v_wbs := nullif(btrim(s.payload->>'wbs_path'), '');
      v_duration := nullif(btrim(s.payload->>'original_duration_hours'), '')::numeric;
      v_start := nullif(btrim(s.payload->>'planned_start'), '')::timestamptz;
      v_finish := nullif(btrim(s.payload->>'planned_finish'), '')::timestamptz;
      v_calendar := nullif(btrim(s.payload->>'calendar'), '');
      v_float := nullif(btrim(s.payload->>'total_float_hours'), '')::numeric;
      v_constraint := nullif(btrim(s.payload->>'constraint_type'), '');
      v_constraint_date := nullif(btrim(s.payload->>'constraint_date'), '')::timestamptz;
    exception when others then
      continue;
    end;

    if jsonb_typeof(s.payload->'relationships') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'predecessor', r->>'predecessor',
        'link_type', nullif(upper(btrim(r->>'link_type')), ''),
        'lag_hours', nullif(btrim(r->>'lag_hours'), '')::numeric
      ) order by r->>'predecessor'), '[]'::jsonb)
      into v_new_relationships
      from jsonb_array_elements(s.payload->'relationships') r;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
        'predecessor', token, 'link_type', null, 'lag_hours', null
      ) order by token), '[]'::jsonb)
      into v_new_relationships
      from (
        select distinct nullif(btrim(value), '') as token
        from regexp_split_to_table(coalesce(s.payload->>'predecessors', ''), '[,;]') value
      ) q where token is not null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'predecessor', d.predecessor_key,
      'link_type', d.link_type,
      'lag_hours', d.lag_hours
    ) order by d.predecessor_key), '[]'::jsonb)
    into v_old_relationships
    from public.shutdown_task_dependencies d
    where d.event_id = t.event_id and d.task_key = t.task_key;

    v_fields := '{}'::jsonb;
    if v_label is distinct from t.label then
      v_fields := v_fields || jsonb_build_object('label', jsonb_build_object('from', t.label, 'to', v_label));
    end if;
    if v_duration is distinct from t.duration_hours then
      v_fields := v_fields || jsonb_build_object('durationHours', jsonb_build_object('from', t.duration_hours, 'to', v_duration));
    end if;
    if v_start is distinct from t.planned_start then
      v_fields := v_fields || jsonb_build_object('plannedStart', jsonb_build_object('from', t.planned_start, 'to', v_start));
    end if;
    if v_finish is distinct from t.planned_finish then
      v_fields := v_fields || jsonb_build_object('plannedFinish', jsonb_build_object('from', t.planned_finish, 'to', v_finish));
    end if;
    if v_calendar is distinct from t.calendar_name then
      v_fields := v_fields || jsonb_build_object('calendarName', jsonb_build_object('from', t.calendar_name, 'to', v_calendar));
    end if;
    if v_wbs is distinct from t.wbs_path then
      v_fields := v_fields || jsonb_build_object('wbsPath', jsonb_build_object('from', t.wbs_path, 'to', v_wbs));
    end if;
    if v_float is distinct from t.total_float_hours then
      v_fields := v_fields || jsonb_build_object('totalFloatHours', jsonb_build_object('from', t.total_float_hours, 'to', v_float));
    end if;
    if v_constraint is distinct from t.constraint_type then
      v_fields := v_fields || jsonb_build_object('constraintType', jsonb_build_object('from', t.constraint_type, 'to', v_constraint));
    end if;
    if v_constraint_date is distinct from t.constraint_date then
      v_fields := v_fields || jsonb_build_object('constraintDate', jsonb_build_object('from', t.constraint_date, 'to', v_constraint_date));
    end if;
    if v_new_relationships is distinct from v_old_relationships then
      v_fields := v_fields || jsonb_build_object('relationships', jsonb_build_object('from', v_old_relationships, 'to', v_new_relationships));
    end if;

    if v_fields <> '{}'::jsonb then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'taskId', t.id,
        'eventId', t.event_id,
        'caseId', v_case,
        'activityKey', t.task_key,
        'fields', v_fields,
        'stagingRowId', s.id
      ));
    end if;
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    return jsonb_build_object(
      'answered', false,
      'refusal', 'No changed duplicate activity was found in this run. Identical replays remain ordinary duplicates and do not create revision noise.'
    );
  end if;

  v_digest := public.sync_schedule_revision_digest(v_changes);
  v_revision := gen_random_uuid();
  perform set_config('app.schedule_revision_write', 'granted', true);
  insert into public.schedule_import_revisions
    (id, organization_id, connector_run_id, source_name, change_set,
     before_digest, proposed_by)
  values
    (v_revision, v_org, p_run_id, v_source_name, v_changes,
     v_digest, auth.uid());
  perform set_config('app.schedule_revision_write', '', true);

  insert into public.audit_events
    (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values
    (v_org, 'schedule_import_revision', coalesce(v_role, 'system'),
     jsonb_build_object('revisionId', v_revision, 'runId', p_run_id, 'act', 'propose'),
     null,
     jsonb_build_object('status', 'pending', 'changeCount', jsonb_array_length(v_changes),
       'beforeDigest', v_digest));

  return jsonb_build_object(
    'answered', true,
    'revisionId', v_revision,
    'status', 'pending',
    'changeCount', jsonb_array_length(v_changes),
    'changes', v_changes,
    'note', 'Changed P6 rows were retained as a pending revision. Nothing has overwritten the canonical schedule; a named human must accept or reject the change set.'
  );
end
$$;

revoke all on function public.propose_schedule_import_revision(uuid)
  from public, anon, service_role;
grant execute on function public.propose_schedule_import_revision(uuid)
  to authenticated;

create or replace function public.decide_schedule_import_revision(
  p_revision_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note text := btrim(coalesce(p_note, ''));
  r public.schedule_import_revisions%rowtype;
  item jsonb;
  fields jsonb;
  rel jsonb;
  t public.shutdown_tasks%rowtype;
  v_digest text;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from public.user_profiles
  where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'maintenance_manager', 'reliability_engineer', 'planner') then
    return jsonb_build_object('error',
      'accepting or rejecting a changed P6 schedule requires a named human planning, engineering or governance role');
  end if;
  if v_decision not in ('approved', 'rejected') then
    return jsonb_build_object('error', 'decision must be approved or rejected');
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error',
      'the revision decision needs at least 20 characters stating why the changed P6 schedule is accepted or rejected');
  end if;

  select * into r from public.schedule_import_revisions x
  where x.id = p_revision_id and x.organization_id = v_org
  for update;
  if not found then return jsonb_build_object('error', 'schedule revision not found'); end if;
  if r.status <> 'pending' then
    return jsonb_build_object('error', format('schedule revision is already %s', r.status));
  end if;

  v_digest := public.sync_schedule_revision_digest(r.change_set);
  if v_digest is distinct from r.before_digest then
    return jsonb_build_object('error',
      'the canonical schedule changed after this revision was proposed. Re-import and review a new change set; a stale proposal cannot overwrite newer evidence.');
  end if;

  if v_decision = 'approved' then
    for item in select value from jsonb_array_elements(r.change_set)
    loop
      fields := item->'fields';
      select x.* into t from public.shutdown_tasks x
      join public.shutdown_events e on e.id = x.event_id
      where x.id = (item->>'taskId')::bigint
        and e.organization_id = v_org
        and x.origin = 'imported';
      if not found then
        raise exception 'revision activity % is no longer an imported activity in this tenant', item->>'activityKey';
      end if;

      perform set_config('app.schedule_activity_write', 'granted', true);
      update public.shutdown_tasks x set
        label = case when fields ? 'label' then fields->'label'->>'to' else x.label end,
        duration_hours = case when fields ? 'durationHours' then (fields->'durationHours'->>'to')::numeric else x.duration_hours end,
        planned_start = case when fields ? 'plannedStart' then (fields->'plannedStart'->>'to')::timestamptz else x.planned_start end,
        planned_finish = case when fields ? 'plannedFinish' then (fields->'plannedFinish'->>'to')::timestamptz else x.planned_finish end,
        calendar_name = case when fields ? 'calendarName' then nullif(fields->'calendarName'->>'to', '') else x.calendar_name end,
        wbs_path = case when fields ? 'wbsPath' then nullif(fields->'wbsPath'->>'to', '') else x.wbs_path end,
        total_float_hours = case when fields ? 'totalFloatHours' then (fields->'totalFloatHours'->>'to')::numeric else x.total_float_hours end,
        constraint_type = case when fields ? 'constraintType' then nullif(fields->'constraintType'->>'to', '') else x.constraint_type end,
        constraint_date = case when fields ? 'constraintDate' then (fields->'constraintDate'->>'to')::timestamptz else x.constraint_date end
      where x.id = t.id;
      perform set_config('app.schedule_activity_write', '', true);

      if fields ? 'relationships' then
        perform set_config('app.schedule_logic_write', 'import', true);
        delete from public.shutdown_task_dependencies d
        where d.event_id = t.event_id and d.task_key = t.task_key;
        for rel in select value from jsonb_array_elements(fields->'relationships'->'to')
        loop
          if nullif(btrim(rel->>'predecessor'), '') is null
             or rel->>'predecessor' = t.task_key
             or not exists (
               select 1 from public.shutdown_tasks predecessor
               where predecessor.event_id = t.event_id
                 and predecessor.task_key = rel->>'predecessor'
             ) then
            raise exception
              'changed P6 relationship for activity % names missing or self predecessor %. Re-import a complete, internally consistent schedule before deciding it.',
              t.task_key, coalesce(rel->>'predecessor', '(blank)')
              using errcode = 'check_violation';
          end if;
          insert into public.shutdown_task_dependencies
            (event_id, task_key, predecessor_key, link_type, lag_hours)
          values
            (t.event_id, t.task_key, rel->>'predecessor',
             nullif(rel->>'link_type', ''),
             nullif(rel->>'lag_hours', '')::numeric);
        end loop;
        perform set_config('app.schedule_logic_write', '', true);
      end if;
    end loop;
  end if;

  perform set_config('app.schedule_revision_write', 'granted', true);
  update public.schedule_import_revisions
  set status = v_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = v_note
  where id = r.id;
  perform set_config('app.schedule_revision_write', '', true);

  insert into public.audit_events
    (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values
    (v_org, 'schedule_import_revision', coalesce(v_role, 'system'),
     jsonb_build_object('revisionId', r.id, 'runId', r.connector_run_id, 'act', v_decision),
     jsonb_build_object('status', 'pending', 'beforeDigest', r.before_digest),
     jsonb_build_object('status', v_decision, 'decisionNote', v_note,
       'changeCount', jsonb_array_length(r.change_set)));

  return jsonb_build_object(
    'answered', true,
    'revisionId', r.id,
    'status', v_decision,
    'applied', v_decision = 'approved',
    'note', case when v_decision = 'approved'
      then 'The reviewed P6 re-export is now the canonical analysis copy. P6 remains system of record; SyncAI did not write back.'
      else 'The changed re-export was rejected and retained. The canonical schedule was not changed.' end
  );
end
$$;

revoke all on function public.decide_schedule_import_revision(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.decide_schedule_import_revision(uuid, text, text)
  to authenticated;

comment on function public.propose_schedule_import_revision(uuid) is
  'D5.28: compares retained duplicate rows from one completed schedule import with the canonical imported activities and records only actual field/logic changes as an immutable pending revision. Evidence assembly; ai_admin admitted.';
comment on function public.decide_schedule_import_revision(uuid, text, text) is
  'D5.28/§70: a named human accepts or rejects a pending P6 re-export revision. Acceptance applies the reviewed fields through the existing P6 provenance markers after a stale-digest check; rejection changes no schedule data.';

notify pgrst, 'reload schema';
