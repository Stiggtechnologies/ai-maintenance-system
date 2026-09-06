-- ============================================================================
-- Sync Develop Slice 4A — ScheduleActivity as a first-class object, with P6
-- still the system of record (D5.28 completion; spec §22, §77).
--
-- WHAT SLICE 1 LEFT. 20261112090000 landed the IMPORT half: schedule_activity
-- rides the ONE governed door, lands on shutdown_events/shutdown_tasks keyed
-- to a development case, deduplicates on (event, source_system, external_id),
-- retains rejects, refuses non-finite durations and dates by name. Its own
-- register row named what was missing: the activity is not yet an object the
-- product can reason about — no WBS resolution, no way to author an activity
-- Sync itself needs, and nothing stopping a later writer from quietly
-- overwriting a P6-owned field.
--
-- THE THREE THINGS THIS FILE ADDS, and the rule each one keeps:
--
--   1. wbs_element_id — the RESOLVED chain link. P6 exports a wbs_path
--      STRING; the import records it verbatim and interprets nothing
--      (20261112090000's own rule). Resolving that string to a WBS element
--      is a SYNC-SIDE ANNOTATION, an act a human takes here, not a guess the
--      importer makes. That distinction is the whole design: Sync ANNOTATES
--      P6 rows and never REWRITES them.
--
--   2. origin — 'imported' or 'local', NOT NULL, and IMMUTABLE for every
--      writer including service. A locally-authored activity must stay
--      distinguishable from an imported one forever: the moment an operator
--      can relabel a Sync-authored activity as P6 output, "P6 is the system
--      of record" becomes unfalsifiable. The flip is refused in the trigger
--      with no service branch, exactly as the org tree refuses a cycle.
--
--   3. The P6-OWNED FIELD WALL. task_key, label, duration_hours,
--      planned_start, planned_finish, calendar_name, wbs_path, source_system
--      and external_id are P6's on an imported row. A client UPDATE of any
--      of them is REFUSED; a service UPDATE is admitted AND AUDITED into
--      security_events (the development_baselines backstop posture,
--      20261110090000:110) because a platform correction is legitimate and a
--      silent one is not. DELETE of an imported row is guarded the same way:
--      dropping an activity is how you make a schedule look shorter without
--      changing a single duration, which is why the trigger covers INSERT,
--      UPDATE and DELETE rather than the two the write path happens to use.
--
-- WHY THE GUARD IS NOT ON THE IMPORT DOOR. The door is one writer.
-- ingest_schedule_batch INSERTs (never updates), so the wall costs it
-- nothing; but the service role, a future adapter and a migration are all
-- writers too, and the property "Sync never overwrites P6" has to hold for
-- them. It is therefore a table-level trigger, not an RPC-level check.
--
-- REFUSALS, NOT DEFAULTS. record_local_schedule_activity refuses a
-- non-finite or negative duration BY NAME (Postgres parses 'NaN' and
-- '±Infinity' as valid numeric and NaN sorts above every number, so the
-- comparison is explicit and literal), refuses an unordered or infinite
-- planned window, refuses a duplicate activity id in the same schedule, and
-- refuses a wbs_code that does not resolve. It does NOT require a WBS: an
-- activity with no authorized scope is exactly what D5.02 exists to DETECT
-- ("14 schedule activities have no authorized scope"), so forcing one here
-- would make the detector structurally unable to fire.
--
-- Canonical reuse: shutdown_events / shutdown_tasks (EXTENDED, no new
-- schedule store), development_cases, project_wbs_elements, audit_events,
-- security_events. Sync still never writes back to P6 (§77): no write-back
-- path exists in this file or anywhere else.
-- ============================================================================

-- The 3C parse-or-NULL family (20261122090000) gains its timestamp member.
-- Same argument, same shape: a cast in a DECLARE initializer runs BEFORE the
-- first guard, so `"planned_start": "next tuesday"` would raise a raw 22P02
-- naming a Postgres type instead of the field the caller got wrong.
create or replace function public.sync_text_as_timestamptz(p_text text)
returns timestamptz language plpgsql immutable as $$
begin
  return p_text::timestamptz;
exception when invalid_text_representation or invalid_datetime_format
          or datetime_field_overflow then
  return null;
end $$;

revoke all on function public.sync_text_as_timestamptz(text) from public, anon;
grant execute on function public.sync_text_as_timestamptz(text) to authenticated, service_role;

comment on function public.sync_text_as_timestamptz(text) is
  'Slice 4A: parse-or-NULL for caller JSON timestamps, so an act refuses a malformed instant BY NAME instead of raising a raw 22P02 from its DECLARE block (the 20261122090000 family).';

alter table public.shutdown_tasks
  add column if not exists wbs_element_id uuid
    references project_wbs_elements(id) on delete set null,
  add column if not exists origin text,
  add column if not exists authored_by uuid references auth.users(id);

-- BACKFILL FROM THE EVIDENCE ON THE ROW, NOT FROM AN ASSUMPTION.
--
-- "Existing rows all arrived through the import door" is false: the demo
-- fixture (20260824093000) seeds eight operational shutdown tasks
-- (SD-2026-CRUSH: ISOLATE, SCAFFOLD, STRIP, …) with no source_system and no
-- external_id. Defaulting them to 'imported' would brand eight plans P6 has
-- never seen as P6 output, PERMANENTLY — origin never flips, so the label
-- would be unrepairable; the P6 wall below would then refuse every
-- legitimate correction to them with "correct it in P6 and re-import", an
-- instruction nobody can follow, and emit a false security_events warning
-- each time. The only honest label is the one the row's own evidence
-- carries: a source pair means imported, its absence means locally
-- authored.
update public.shutdown_tasks
   set origin = case
                  when source_system is not null and external_id is not null then 'imported'
                  else 'local'
                end
 where origin is null;

-- ...and the DEFAULT is 'local', not 'imported'. A writer that forgets to
-- state an origin must not thereby mint a P6-branded, permanently locked
-- row: the safe direction is the one that claims nothing about another
-- system of record.
alter table public.shutdown_tasks alter column origin set default 'local';
alter table public.shutdown_tasks alter column origin set not null;

alter table public.shutdown_tasks drop constraint if exists shutdown_tasks_origin_check;
alter table public.shutdown_tasks add constraint shutdown_tasks_origin_check
  check (origin in ('imported','local'));

-- The provenance pair, stated as a SCHEMA invariant so it holds for every
-- writer without consulting the trigger: an imported row carries its source
-- AND its source id (an 'imported' row with neither is exactly the
-- unfalsifiable system-of-record claim this file exists to prevent); a local
-- row carries neither and is never attributed to an external system.
alter table public.shutdown_tasks drop constraint if exists shutdown_tasks_origin_provenance;
alter table public.shutdown_tasks add constraint shutdown_tasks_origin_provenance
  check (
    (origin = 'imported' and source_system is not null and external_id is not null
      and authored_by is null)
    or (origin = 'local' and source_system is null and external_id is null)
  );

create index if not exists idx_shutdown_tasks_wbs
  on shutdown_tasks(wbs_element_id) where wbs_element_id is not null;

comment on column public.shutdown_tasks.wbs_element_id is
  'D5.28/D5.01: the WBS element this activity delivers, RESOLVED by a human act (set_schedule_activity_wbs) from the verbatim P6 wbs_path. Null is a real answer — an activity with no authorized scope is what D5.02 reports.';
comment on column public.shutdown_tasks.origin is
  'D5.28: ''imported'' (P6 through the governed door, P6-owned fields immutable to Sync) or ''local'' (authored in Sync). Immutable for every writer — the distinction is what makes "P6 is the system of record" falsifiable.';

-- ---------------------------------------------------------------------------
-- The P6-owned field wall. INSERT, UPDATE and DELETE.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_schedule_activity_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.schedule_activity_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_changed text[] := '{}';
begin
  if tg_op = 'TRUNCATE' then
    -- No row-level trigger fires for TRUNCATE and RLS does not gate it, so
    -- every wall below is dodgeable in one statement by any role holding the
    -- verb. Slice 4A is the slice that makes shutdown_tasks load-bearing for
    -- the P6 system-of-record claim, so the verb is refused here and revoked
    -- below.
    raise exception
      'shutdown_tasks holds every imported P6 activity behind the system-of-record wall; truncating it erases them all in one statement, which no row-level guard can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    -- A local activity may only be born through the governed act; an
    -- imported one only through the import door. Both set the marker.
    if v_marker <> 'granted' and v_client then
      raise exception
        'a schedule activity is created by the P6 import door or by '
        'record_local_schedule_activity — a direct insert would produce an '
        'activity with no stated provenance.'
        using errcode = 'insufficient_privilege';
    end if;
    -- ...and a SERVICE insert outside the door is admitted AND AUDITED. This
    -- arm was missing, so a service caller could mint a row labelled
    -- origin='imported', source_system='Primavera P6' with nothing recorded
    -- anywhere — an unaudited creation of a P6-looking activity, which is
    -- the exact claim this file exists to keep falsifiable.
    if v_marker <> 'granted' and not v_client
       and current_user not in ('authenticated', 'anon') then
      select e.organization_id into v_org from shutdown_events e where e.id = new.event_id;
      if v_org is not null and exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (v_org, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'Schedule activity ' || new.task_key || ' (origin ' || new.origin ||
             coalesce(', source ' || new.source_system, '') ||
             ') was created by a service caller outside the import door and '
             'outside record_local_schedule_activity. An activity minted here '
             'carries a provenance claim nobody made (D5.28, spec §22/§77).');
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.origin <> 'imported' then
      return old;
    end if;
    v_changed := array['row deleted']::text[];
  else
    -- ORIGIN NEVER FLIPS. No marker, no service branch: an imported row that
    -- can be relabelled local (or the reverse) makes the system-of-record
    -- claim unfalsifiable, which is corrupt data whoever writes it.
    if new.origin is distinct from old.origin then
      raise exception
        'a schedule activity''s origin is fixed at creation — an imported '
        'activity cannot become locally authored, nor the reverse. P6 stays '
        'the system of record for what it exported (spec §22, §77).'
        using errcode = 'check_violation';
    end if;

    if old.origin <> 'imported' then
      return new;
    end if;

    -- The P6-owned set. Sync-owned columns (wbs_element_id, asset_id,
    -- optimistic/pessimistic ranges) are deliberately absent: annotating is
    -- the point, overwriting is what is refused.
    if new.task_key is distinct from old.task_key then v_changed := v_changed || 'task_key'::text; end if;
    if new.label is distinct from old.label then v_changed := v_changed || 'label'::text; end if;
    if new.duration_hours is distinct from old.duration_hours then v_changed := v_changed || 'duration_hours'::text; end if;
    if new.planned_start is distinct from old.planned_start then v_changed := v_changed || 'planned_start'::text; end if;
    if new.planned_finish is distinct from old.planned_finish then v_changed := v_changed || 'planned_finish'::text; end if;
    if new.calendar_name is distinct from old.calendar_name then v_changed := v_changed || 'calendar_name'::text; end if;
    if new.wbs_path is distinct from old.wbs_path then v_changed := v_changed || 'wbs_path'::text; end if;
    if new.source_system is distinct from old.source_system then v_changed := v_changed || 'source_system'::text; end if;
    if new.external_id is distinct from old.external_id then v_changed := v_changed || 'external_id'::text; end if;

    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return new;
    end if;
  end if;

  select e.organization_id into v_org from shutdown_events e
   where e.id = (case when tg_op = 'DELETE' then old.event_id else new.event_id end);

  -- Audited service path (a correction, a re-import repair, a teardown).
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted' and v_org is not null
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'P6-owned schedule fields (' || array_to_string(v_changed, ', ')
           || ') changed on imported activity '
           || (case when tg_op = 'DELETE' then old.task_key else new.task_key end)
           || ' by a service caller outside the import door. Sync analyzes P6 '
           || 'schedules and does not write them back (spec §77); a service '
           || 'rewrite of an imported activity is recorded here because it '
           || 'changes what the schedule analysis is reading.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'that activity was imported from P6, and P6 is its system of record '
      '(spec §22, §77): %. Sync annotates an imported activity — its WBS '
      'element, its asset, its duration range — and never overwrites what P6 '
      'exported. Correct it in P6 and re-import.',
      array_to_string(v_changed, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_schedule_activity_provenance() from public, anon, authenticated;

drop trigger if exists trg_schedule_activity_provenance on public.shutdown_tasks;
create trigger trg_schedule_activity_provenance
  before insert or update or delete on public.shutdown_tasks
  for each row execute function public.enforce_schedule_activity_provenance();

drop trigger if exists trg_schedule_activity_no_truncate on public.shutdown_tasks;
create trigger trg_schedule_activity_no_truncate
  before truncate on public.shutdown_tasks
  for each statement execute function public.enforce_schedule_activity_provenance();

revoke truncate on table public.shutdown_tasks from anon, authenticated, service_role;

-- The import door is a governed writer: it names itself with the marker so
-- the INSERT arm admits it. Spliced from 20261112090000 with exactly one
-- edit — the set_config line before the task insert — so every refusal,
-- phase and counter of the original validator is carried unchanged.
create or replace function public.ingest_schedule_batch(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  r connector_runs%rowtype;
  v_source text;
  v_conn_type text;
  v_n int;
  i int;
  j int;
  row_in jsonb;
  a_ext text[] := '{}';
  a_status text[] := '{}';
  a_reason text[] := '{}';
  a_case uuid[] := '{}';
  a_event_key text[] := '{}';
  a_event_title text[] := '{}';
  a_event uuid[] := '{}';
  a_wbs text[] := '{}';
  a_descr text[] := '{}';
  a_dur numeric[] := '{}';
  a_start timestamptz[] := '{}';
  a_finish timestamptz[] := '{}';
  a_cal text[] := '{}';
  a_preds text[] := '{}';
  v_seen text[] := '{}';
  v_ext text;
  v_reason text;
  v_case uuid;
  v_case_title text;
  v_case_ids uuid[];
  v_sched text;
  v_event_key text;
  v_event_title text;
  v_event uuid;
  v_descr text;
  v_dur numeric;
  v_start timestamptz;
  v_finish timestamptz;
  v_tokens text[];
  v_tok text;
  v_changed boolean;
  v_resolved boolean;
  v_infile boolean;
  v_pass int := 0;
  v_read int := 0;
  v_ok int := 0;
  v_dup int := 0;
  v_rej int := 0;
  v_max_ts timestamptz;
begin
  select * into r from connector_runs where id = p_run_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;
  if r.status <> 'running' then
    return jsonb_build_object('error', 'this run is already ' || r.status);
  end if;
  if not (r.entity_type = 'schedule_activity') then
    return jsonb_build_object('error',
      format('ingest_schedule_batch handles schedule_activity; this run is %s', r.entity_type));
  end if;

  select connector_key, connector_type into v_source, v_conn_type
    from connectors where id = r.connector_id;

  v_n := jsonb_array_length(p_rows);

  -- ── Phase A: per-row field validation, no writes ─────────────────────────
  for i in 1 .. v_n loop
    row_in := p_rows->(i - 1);
    v_read := v_read + 1;
    v_reason := null;
    v_case := null; v_case_title := null; v_event_key := null;
    v_event_title := null; v_event := null;
    v_descr := null; v_dur := null; v_start := null; v_finish := null;
    v_tokens := '{}';

    v_ext := nullif(btrim(coalesce(row_in->>'external_id', row_in->>'activity_id')), '');

    if v_ext is null then
      v_reason := 'missing activity_id: a source row without a stable identifier cannot be replayed safely';
    elsif v_ext = any (v_seen) then
      v_reason := format(
        'activity_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each activity its own identifier.', v_ext);
    else
      v_seen := v_seen || v_ext;
    end if;

    if v_reason is null then
      if nullif(btrim(row_in->>'development_case_id'), '') is not null then
        begin
          v_case := (btrim(row_in->>'development_case_id'))::uuid;
        exception when others then
          v_reason := format('development_case_id "%s" is not a uuid — give case_title instead if you do not have the id',
            btrim(row_in->>'development_case_id'));
        end;
        if v_reason is null then
          select title into v_case_title from development_cases
           where organization_id = v_org and id = v_case;
          if v_case_title is null then
            v_reason := format('unknown development case "%s"', v_case);
            v_case := null;
          end if;
        end if;
      elsif nullif(btrim(row_in->>'case_title'), '') is not null then
        select array_agg(id) into v_case_ids from development_cases
         where organization_id = v_org and title = btrim(row_in->>'case_title');
        if coalesce(array_length(v_case_ids, 1), 0) = 0 then
          v_reason := format('unknown development case "%s"', btrim(row_in->>'case_title'));
        elsif array_length(v_case_ids, 1) > 1 then
          v_reason := format('development case "%s" matches %s cases — give development_case_id instead of case_title',
            btrim(row_in->>'case_title'), array_length(v_case_ids, 1));
        else
          v_case := v_case_ids[1];
          v_case_title := btrim(row_in->>'case_title');
        end if;
      else
        v_reason := 'a schedule activity must name its development case: give case_title or development_case_id';
      end if;
    end if;

    if v_reason is null then
      v_sched := coalesce(nullif(btrim(row_in->>'schedule_name'), ''), 'P6 import');
      v_event_key := 'develop:' || v_case::text || ':' || lower(v_sched);
      v_event_title := v_sched || ' — ' || v_case_title;
      select id into v_event from shutdown_events
       where organization_id = v_org and event_key = v_event_key;
    end if;

    if v_reason is null then
      v_descr := nullif(btrim(row_in->>'description'), '');
      begin
        v_dur := (nullif(btrim(row_in->>'original_duration_hours'), ''))::numeric;
        v_start := (nullif(btrim(row_in->>'planned_start'), ''))::timestamptz;
        v_finish := (nullif(btrim(row_in->>'planned_finish'), ''))::timestamptz;
      exception when others then
        v_reason := format('the database could not read this row''s numbers or dates: %s', sqlerrm);
      end;
      if v_reason is not null then
        null;
      elsif v_descr is null then
        v_reason := 'missing description';
      elsif v_dur is null then
        v_reason := 'missing original_duration_hours — durations arrive in hours explicitly, because converting P6 duration units needs the calendar this import refuses to guess';
      elsif v_dur = 'NaN'::numeric or v_dur = 'Infinity'::numeric
            or v_dur = '-Infinity'::numeric then
        v_reason := format('original_duration_hours is %s; a duration must be a finite number of hours', v_dur);
      elsif v_dur < 0 then
        v_reason := format('original_duration_hours is %s; a duration cannot be negative', v_dur);
      elsif v_start is null then
        v_reason := 'missing or unparseable planned_start';
      elsif v_finish is null then
        v_reason := 'missing or unparseable planned_finish';
      elsif not isfinite(v_start) then
        v_reason := format('planned_start is %s; a planned date must be a finite calendar date', v_start);
      elsif not isfinite(v_finish) then
        v_reason := format('planned_finish is %s; a planned date must be a finite calendar date', v_finish);
      elsif v_finish < v_start then
        v_reason := 'planned_finish is before planned_start — an activity cannot finish before it begins';
      end if;
    end if;

    if v_reason is null and nullif(btrim(coalesce(row_in->>'predecessors', '')), '') is not null then
      select coalesce(array_agg(distinct t), '{}') into v_tokens
        from (select nullif(btrim(x), '') as t
                from unnest(regexp_split_to_array(row_in->>'predecessors', '[,;]')) as x) s
       where t is not null;
      if v_ext = any (v_tokens) then
        v_reason := format('activity "%s" names itself as a predecessor — an activity cannot depend on itself', v_ext);
      end if;
    end if;

    a_ext := a_ext || v_ext;
    a_reason := a_reason || v_reason;
    a_case := a_case || v_case;
    a_event_key := a_event_key || v_event_key;
    a_event_title := a_event_title || v_event_title;
    a_event := a_event || v_event;
    a_wbs := a_wbs || nullif(btrim(coalesce(row_in->>'wbs_path', '')), '');
    a_descr := a_descr || v_descr;
    a_dur := a_dur || v_dur;
    a_start := a_start || v_start;
    a_finish := a_finish || v_finish;
    a_cal := a_cal || nullif(btrim(coalesce(row_in->>'calendar', '')), '');
    a_preds := a_preds || coalesce(array_to_string(v_tokens, ','), '');

    if v_reason is not null then
      a_status := a_status || 'rejected'::text;
    elsif v_event is not null
      and exists (select 1 from shutdown_tasks t
                   where t.event_id = v_event and t.source_system = v_source
                     and t.external_id = v_ext) then
      a_status := a_status || 'duplicate'::text;
    else
      a_status := a_status || 'pending'::text;
    end if;
  end loop;

  -- ── Phase B: predecessor fixpoint ────────────────────────────────────────
  loop
    v_changed := false;
    v_pass := v_pass + 1;
    for i in 1 .. v_n loop
      if a_status[i] = 'pending' and a_preds[i] <> '' then
        foreach v_tok in array string_to_array(a_preds[i], ',') loop
          v_resolved := false;
          if a_event[i] is not null
             and exists (select 1 from shutdown_tasks t
                          where t.event_id = a_event[i] and t.task_key = v_tok) then
            v_resolved := true;
          else
            for j in 1 .. v_n loop
              if j <> i and a_status[j] in ('pending', 'duplicate')
                 and a_ext[j] = v_tok and a_event_key[j] = a_event_key[i] then
                v_resolved := true;
                exit;
              end if;
            end loop;
          end if;
          if not v_resolved then
            v_infile := false;
            for j in 1 .. v_n loop
              if j <> i and a_ext[j] = v_tok
                 and a_event_key[j] is not distinct from a_event_key[i] then
                v_infile := true;
                exit;
              end if;
            end loop;
            if v_infile then
              a_reason[i] := format('predecessor "%s" was refused in this upload; an activity cannot depend on a row that did not land. Fix that row and upload the file again.', v_tok);
            else
              a_reason[i] := format('unknown predecessor "%s": not already in this schedule and not a valid row of this upload. Predecessors must be plain activity ids — relationship type and lag notation is not carried.', v_tok);
            end if;
            a_status[i] := 'rejected';
            v_changed := true;
            exit;
          end if;
        end loop;
      end if;
    end loop;
    exit when not v_changed or v_pass > v_n;
  end loop;

  -- ── Phase C: writes, per-row subtransactions, staging for every row ──────
  for i in 1 .. v_n loop
    v_reason := a_reason[i];

    if a_status[i] = 'pending' then
      begin
        v_event := a_event[i];
        if v_event is null then
          select id into v_event from shutdown_events
           where organization_id = v_org and event_key = a_event_key[i];
          if v_event is null then
            insert into shutdown_events (organization_id, event_key, title, status, development_case_id)
            values (v_org, a_event_key[i], a_event_title[i], 'planning', a_case[i])
            on conflict (organization_id, event_key) do update
              set development_case_id = excluded.development_case_id
            returning id into v_event;
          end if;
        end if;

        -- The door names itself to the provenance wall (20261130090100).
        perform set_config('app.schedule_activity_write', 'granted', true);
        insert into shutdown_tasks (event_id, task_key, label, duration_hours,
          wbs_path, planned_start, planned_finish, calendar_name,
          source_system, external_id, origin)
        values (v_event, a_ext[i], a_descr[i], a_dur[i],
          a_wbs[i], a_start[i], a_finish[i], a_cal[i],
          v_source, a_ext[i], 'imported');
        perform set_config('app.schedule_activity_write', '', true);

        if a_preds[i] <> '' then
          foreach v_tok in array string_to_array(a_preds[i], ',') loop
            insert into shutdown_task_dependencies (event_id, task_key, predecessor_key)
            values (v_event, a_ext[i], v_tok)
            on conflict (event_id, task_key, predecessor_key) do nothing;
          end loop;
        end if;

        v_max_ts := greatest(coalesce(v_max_ts, now()), now());
        a_status[i] := 'accepted';
      exception
        when unique_violation then
          v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
          a_status[i] := 'rejected';
        when others then
          v_reason := format('the database refused this row: %s', sqlerrm);
          a_status[i] := 'rejected';
      end;
      -- The subtransaction may have rolled the marker back with the row;
      -- clear it explicitly so a refused row never leaves the door open.
      perform set_config('app.schedule_activity_write', '', true);
    end if;

    if a_status[i] = 'accepted' then
      v_ok := v_ok + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'accepted');
    elsif a_status[i] = 'duplicate' then
      v_dup := v_dup + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'duplicate');
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, connector_id, run_id, entity_type, external_id, payload, status, reject_reason)
      values (v_org, r.connector_id, p_run_id, r.entity_type, a_ext[i], p_rows->(i - 1), 'rejected', v_reason);
    end if;
  end loop;

  update connector_runs
  set records_read = records_read + v_read,
      records_accepted = records_accepted + v_ok,
      records_rejected = records_rejected + v_rej,
      records_duplicate = records_duplicate + v_dup,
      watermark_to = greatest(coalesce(watermark_to, v_max_ts), v_max_ts)
  where id = p_run_id;

  return jsonb_build_object('read', v_read, 'accepted', v_ok,
    'duplicate', v_dup, 'rejected', v_rej);
end
$$;

revoke all on function public.ingest_schedule_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_schedule_batch(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Authoring an activity Sync owns. The local schedule is a SEPARATE event
-- from any P6 import (event_key '…:sync-local'), so no roll-up ever mixes a
-- Sync-authored duration into a P6 schedule's totals without saying so.
-- ---------------------------------------------------------------------------
create or replace function public.record_local_schedule_activity(
  p_case_id uuid,
  p_activity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_key text := nullif(btrim(coalesce(p_activity->>'activity_id','')), '');
  v_label text := nullif(btrim(coalesce(p_activity->>'description','')), '');
  v_dur_raw text := nullif(btrim(coalesce(p_activity->>'duration_hours','')), '');
  v_dur numeric := sync_text_as_numeric(v_dur_raw);
  v_start_raw text := nullif(btrim(coalesce(p_activity->>'planned_start','')), '');
  v_finish_raw text := nullif(btrim(coalesce(p_activity->>'planned_finish','')), '');
  v_start timestamptz;
  v_finish timestamptz;
  v_wbs_code text := nullif(btrim(coalesce(p_activity->>'wbs_code','')), '');
  v_wbs uuid;
  v_event_key text;
  v_event uuid;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'authoring a schedule activity requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_key is null then
    return jsonb_build_object('error',
      'an activity carries an identifier the rest of the schedule can cite (activity_id)');
  end if;
  if v_label is null or length(v_label) < 3 then
    return jsonb_build_object('error', 'describe the activity (description, 3 characters minimum)');
  end if;
  if v_dur_raw is null then
    return jsonb_build_object('error',
      'state the duration in hours (duration_hours) — this schedule records hours explicitly, exactly as the P6 import does, because converting duration units needs a calendar Sync refuses to guess');
  end if;
  if v_dur is null then
    return jsonb_build_object('error',
      format('duration_hours "%s" is not a number', v_dur_raw));
  end if;
  -- 'NaN' and '±Infinity' are VALID numerics in Postgres and NaN sorts above
  -- every number, so `v_dur < 0` is vacuously false for both. Literal
  -- comparison is the detector (NaN = NaN is TRUE for numeric).
  if v_dur = 'NaN'::numeric or v_dur = 'Infinity'::numeric or v_dur = '-Infinity'::numeric then
    return jsonb_build_object('error',
      format('duration_hours is %s; a duration must be a finite number of hours', v_dur));
  end if;
  if v_dur < 0 then
    return jsonb_build_object('error',
      format('duration_hours is %s; a duration cannot be negative', v_dur));
  end if;
  if v_start_raw is not null then
    v_start := sync_text_as_timestamptz(v_start_raw);
    if v_start is null then
      return jsonb_build_object('error', format('planned_start "%s" is not a date', v_start_raw));
    end if;
    if not isfinite(v_start) then
      return jsonb_build_object('error',
        format('planned_start is %s; a planned date must be a finite calendar date', v_start));
    end if;
  end if;
  if v_finish_raw is not null then
    v_finish := sync_text_as_timestamptz(v_finish_raw);
    if v_finish is null then
      return jsonb_build_object('error', format('planned_finish "%s" is not a date', v_finish_raw));
    end if;
    if not isfinite(v_finish) then
      return jsonb_build_object('error',
        format('planned_finish is %s; a planned date must be a finite calendar date', v_finish));
    end if;
  end if;
  if v_start is not null and v_finish is not null and v_finish < v_start then
    return jsonb_build_object('error',
      'planned_finish is before planned_start — an activity cannot finish before it begins');
  end if;
  if v_wbs_code is not null then
    select id into v_wbs from project_wbs_elements
     where development_case_id = c.id and wbs_code = v_wbs_code;
    if v_wbs is null then
      return jsonb_build_object('error',
        format('WBS code "%s" does not exist on this case — record the WBS element first, or leave wbs_code empty and the activity is reported as unauthorized scope until it is coded', v_wbs_code));
    end if;
  end if;

  v_event_key := 'develop:' || c.id::text || ':sync-local';
  select id into v_event from shutdown_events
   where organization_id = v_org and event_key = v_event_key;
  if v_event is null then
    insert into shutdown_events (organization_id, event_key, title, status, development_case_id)
    values (v_org, v_event_key, 'Sync-authored activities — ' || c.title, 'planning', c.id)
    on conflict (organization_id, event_key) do update
      set development_case_id = excluded.development_case_id
    returning id into v_event;
  end if;

  if exists (select 1 from shutdown_tasks where event_id = v_event and task_key = v_key) then
    return jsonb_build_object('error',
      format('activity "%s" already exists in this case''s Sync-authored schedule', v_key));
  end if;

  perform set_config('app.schedule_activity_write', 'granted', true);
  insert into shutdown_tasks
    (event_id, task_key, label, duration_hours, planned_start, planned_finish,
     wbs_element_id, origin, authored_by)
  values (v_event, v_key, v_label, v_dur, v_start, v_finish, v_wbs, 'local', auth.uid())
  returning id into v_id;
  perform set_config('app.schedule_activity_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'activity_id', v_id, 'activity_key', v_key,
      'action', 'authored_locally'),
    null,
    jsonb_build_object('activity_key', v_key, 'label', v_label, 'duration_hours', v_dur,
      'origin', 'local', 'wbs_code', v_wbs_code));

  return jsonb_build_object('activity_id', v_id, 'activity_key', v_key,
    'origin', 'local', 'wbs_code', v_wbs_code, 'case_id', c.id);
end
$$;

revoke all on function public.record_local_schedule_activity(uuid, jsonb) from public, anon;
grant execute on function public.record_local_schedule_activity(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Resolving an imported activity's scope. THE annotation act: allowed on an
-- imported row precisely because wbs_element_id is Sync's column, not P6's.
-- ---------------------------------------------------------------------------
create or replace function public.set_schedule_activity_wbs(
  p_activity_id bigint,
  p_wbs_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  t shutdown_tasks%rowtype;
  e shutdown_events%rowtype;
  v_code text := nullif(btrim(coalesce(p_wbs_code, '')), '');
  w project_wbs_elements%rowtype;
  v_prev text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'coding a schedule activity to the WBS requires a planning, engineering or governance role');
  end if;
  select * into t from shutdown_tasks where id = p_activity_id;
  if not found then
    return jsonb_build_object('error', 'schedule activity not found');
  end if;
  select * into e from shutdown_events where id = t.event_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'schedule activity not found');
  end if;
  if e.development_case_id is null then
    return jsonb_build_object('error',
      'that schedule is not bound to a development case, so it has no WBS to code against');
  end if;

  select wbs_code into v_prev from project_wbs_elements where id = t.wbs_element_id;

  if v_code is null then
    -- Clearing is an act too, and it is recorded: an activity going back to
    -- "no authorized scope" is a fact the traceability report must show.
    update shutdown_tasks set wbs_element_id = null where id = t.id;
  else
    select * into w from project_wbs_elements
     where development_case_id = e.development_case_id and wbs_code = v_code;
    if not found then
      return jsonb_build_object('error',
        format('WBS code "%s" does not exist on this case — an activity is coded to a real element or to none, never to a string nobody can resolve', v_code));
    end if;
    update shutdown_tasks set wbs_element_id = w.id where id = t.id;
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', e.development_case_id, 'activity_id', t.id,
      'activity_key', t.task_key, 'action', 'wbs_resolved', 'origin', t.origin),
    jsonb_build_object('wbs_code', v_prev),
    jsonb_build_object('wbs_code', v_code));

  return jsonb_build_object('activity_id', t.id, 'activity_key', t.task_key,
    'origin', t.origin, 'wbs_code', v_code, 'previous_wbs_code', v_prev);
end
$$;

revoke all on function public.set_schedule_activity_wbs(bigint, text) from public, anon;
grant execute on function public.set_schedule_activity_wbs(bigint, text) to authenticated, service_role;

notify pgrst, 'reload schema';
