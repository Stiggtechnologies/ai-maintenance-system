-- ============================================================================
-- P6 schedule import through the one door (D5.28 start, D11.33; build-plan
-- Slice 1 connector row; overlap-map ruling 6: EXTEND the shutdown/outage
-- schedule family, never fork it).
--
-- WHAT THIS IS. The IMPORT half of the Primavera P6 connector: a
-- schedule_activity entity type carried by the existing manual-import door
-- (20260907090000 → 20261004090000) into the schedule model this repository
-- already ships — shutdown_events / shutdown_tasks /
-- shutdown_task_dependencies (20260824090000) — keyed to a development_case.
-- P6 REMAINS SYSTEM-OF-RECORD (spec §22/§77): Sync analyzes schedules and
-- never writes back. The manual door builds read_only connectors by
-- construction and no write-back path exists in this migration or anywhere
-- else. Analysis beyond listing — critical path, schedule confidence, Monte
-- Carlo over imported activities — is Slice 4 (D5.13–D5.15, D5.28
-- completion) and is deliberately NOT claimed here.
--
-- WHAT THIS IS NOT. Not a new door (begin_manual_import is untouched; the
-- route table simply gains a row), not a new connector type (the run is the
-- same manual_upload connector the door builds for every entity type), not a
-- second schedule store (zero new tables), and not an XER parser — the P6
-- CSV export layout is the accepted format this slice; XER text format is
-- DEFERRED and the register row says so.
--
-- THE DISCIPLINES ARE INHERITED, NOT RE-LEARNED. Everything #272-era work
-- taught the door applies in full here because the door itself applies it:
--   * rejects are RETAINED with reasons (ingest_staging, this validator);
--   * idempotent on (source_system, external_id) — scoped per schedule
--     event, argued below;
--   * the watermark advances only on a clean run (finish_connector_run
--     consults records_rejected — 20261004090000 — nothing here re-decides);
--   * every per-row write sits in a subtransaction, so a cell the validator
--     cannot see comes back as a retained reject carrying the database's own
--     words instead of destroying the batch (20261004090200's lesson);
--   * blank-but-not-null cells are nullif(btrim(...))'d; ambiguous name
--     resolution is a refusal naming the count, never a `limit 1` guess;
--   * the same external_id twice in one file is a copy-paste error named as
--     one, not a "duplicate" that quietly discards a different fact.
--
-- WHY THE DEDUPE KEY IS PER-EVENT, NOT PER-ORG. work_orders deduplicate on
-- (organization_id, source_system, external_id) because one SAP holds one
-- WO-88120. A P6 Activity ID is unique within a PROJECT: two development
-- cases can both legitimately carry A1000. An org-wide unique index would
-- make the second case's schedule un-importable, so uniqueness is
-- (event_id, source_system, external_id) — and the event key embeds the
-- development case id, so a re-upload of the same file lands on the same
-- event and deduplicates exactly as the contract promises.
--
-- PREDECESSORS RESOLVE OR THE ROW IS REFUSED, BY NAME. A dependency row in
-- this model is (event_id, task_key, predecessor_key) — text keys, no FK —
-- so nothing structural stops an import from writing an edge to an activity
-- that never landed. This validator refuses that instead: every predecessor
-- token must resolve to an activity in the same schedule — already imported,
-- or valid in this same upload — and the refusal names the missing token.
-- The resolution is a fixpoint: a row whose predecessor was itself refused
-- (bad date, missing duration) is refused too, naming which predecessor fell
-- and why, so the persisted dependency set never dangles. Cycles BETWEEN
-- distinct activities are stored, not refused — the model's own posture
-- (no_self_dependency is "the one cycle cheap enough to reject at write
-- time"); the schedule-risk analyzer refuses cycles at analysis time.
--
-- WHY THE WATERMARK POSITION IS now(). A schedule is a snapshot, not a
-- time-series: planned dates are legitimately in the FUTURE, and ratcheting
-- last_position to a 2029 planned finish would be the exact future-date
-- ratchet 20261004090200 closed for operating states. material_stock — the
-- other snapshot entity — already uses now(); this follows it.
--
-- Canonical reuse: shutdown_events/shutdown_tasks/shutdown_task_dependencies
-- (EXTENDED with columns), development_cases (referenced), connectors/
-- connector_runs/ingest_staging/ingest_watermarks (the contract), the route
-- table (one new row), ingest_rows (one new dispatch arm),
-- get_development_case (one new section). Additive; no data rewritten.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The schedule model learns where a schedule comes from and which case it
-- serves. Columns only — the tables, their RLS (SELECT-only to the tenant,
-- 20260824090000) and their constraints stand.
-- ---------------------------------------------------------------------------
alter table shutdown_events
  add column if not exists development_case_id uuid
    references development_cases(id) on delete set null;

comment on column shutdown_events.development_case_id is
  'The development case this schedule serves (D5.28). Set by the P6 import; null for operational shutdown/turnaround events that predate Sync Develop.';

create index if not exists idx_shutdown_events_case
  on shutdown_events(development_case_id) where development_case_id is not null;

alter table shutdown_tasks
  add column if not exists wbs_path text,
  add column if not exists planned_start timestamptz,
  add column if not exists planned_finish timestamptz,
  add column if not exists calendar_name text,
  add column if not exists source_system text,
  add column if not exists external_id text;

comment on column shutdown_tasks.calendar_name is
  'The P6 calendar name, RECORDED verbatim and never interpreted: converting working-day durations to hours needs the calendar''s hours-per-day, which this import refuses to guess — durations arrive explicitly in hours.';
comment on column shutdown_tasks.external_id is
  'The source activity id. Idempotency key with source_system, scoped to the event: a P6 Activity ID is unique within a project, not within an organization.';

-- An activity cannot finish before it begins. Milestones (zero duration,
-- start = finish) are legal, so >= not >.
alter table shutdown_tasks drop constraint if exists planned_window_ordered;
alter table shutdown_tasks add constraint planned_window_ordered
  check (planned_start is null or planned_finish is null
         or planned_finish >= planned_start);

create unique index if not exists idx_shutdown_tasks_external
  on shutdown_tasks(event_id, source_system, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- The route table gains its row. Same VALUES shape 20261004090000 defined —
-- the door (begin_manual_import) and the router (ingest_rows) both read THIS,
-- so "the door said yes" and "a validator will accept it" still cannot
-- diverge, and the door's refusal message derives the new type automatically.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_entity_routes()
returns table (entity_type text, handler text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('condition_reading',        'ingest_batch'),
    ('material_stock',           'ingest_batch'),
    ('maintenance_notification', 'ingest_batch'),
    ('maintenance_plan',         'ingest_batch'),
    ('work_order',               'ingest_batch'),
    ('operating_state',          'ingest_context_batch'),
    ('production_record',        'ingest_context_batch'),
    ('schedule_activity',        'ingest_schedule_batch')
  ) as routes(entity_type, handler);
$$;

revoke all on function public.ingest_entity_routes() from public, anon;
grant execute on function public.ingest_entity_routes() to authenticated;
-- ---------------------------------------------------------------------------
-- The validator. A peer of ingest_batch and ingest_context_batch: SECURITY
-- DEFINER, reachable ONLY through ingest_rows (revoked from authenticated
-- below, exactly as 20261004090000 closed the other two), tenant named from
-- the session, every write subtransaction-wrapped.
--
-- It runs in three phases over the batch because predecessor resolution is a
-- property of the WHOLE file, not of one row:
--   A. per-row field validation — identity, case, schedule, dates, duration,
--      in-file duplicate ids, already-loaded duplicates;
--   B. predecessor fixpoint — every token must resolve to an activity already
--      in the same schedule or valid in this upload; a row whose predecessor
--      fell in phase A (or in an earlier pass of B) is refused too, naming
--      the token, until nothing changes;
--   C. writes — find-or-create the case's schedule event, insert the task and
--      its dependency rows, each row in its own subtransaction; staging rows
--      and counters land for every row, whatever its fate.
-- ---------------------------------------------------------------------------
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
  -- Parallel per-row state. Every array receives exactly one element per row
  -- in phase A, so index i always means "row i of the file".
  a_ext text[] := '{}';
  a_status text[] := '{}';        -- pending | duplicate | rejected
  a_reason text[] := '{}';
  a_case uuid[] := '{}';
  a_event_key text[] := '{}';
  a_event_title text[] := '{}';
  a_event uuid[] := '{}';         -- pre-existing event id, if any
  a_wbs text[] := '{}';
  a_descr text[] := '{}';
  a_dur numeric[] := '{}';
  a_start timestamptz[] := '{}';
  a_finish timestamptz[] := '{}';
  a_cal text[] := '{}';
  a_preds text[] := '{}';         -- normalised tokens, comma-joined ('' = none)
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
      -- The same id twice in ONE file is a copy-pasted identifier, not a
      -- replay (20261004090200's rule, unchanged).
      v_reason := format(
        'activity_id "%s" appears more than once in this upload — only the first '
        || 'line was loaded. Give each activity its own identifier.', v_ext);
    else
      v_seen := v_seen || v_ext;
    end if;

    -- The development case the schedule serves. Ambiguity is a refusal with
    -- the count in it, never a scan-order guess.
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

    -- The schedule event this activity belongs to. The key embeds the case
    -- id, so a re-upload lands on the same event (which is what makes the
    -- per-event dedupe behave as the contract promises) and cannot collide
    -- with an operational shutdown event's own key.
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
        -- P6 exports "Original Duration" in the user's units, and converting
        -- working DAYS to hours needs the calendar's hours-per-day. Guessing
        -- 8 or 24 silently triples a shutdown estimate, so the unit is part
        -- of the contract instead: hours, explicitly.
        v_reason := 'missing original_duration_hours — durations arrive in hours explicitly, because converting P6 duration units needs the calendar this import refuses to guess';
      elsif v_dur < 0 then
        v_reason := format('original_duration_hours is %s; a duration cannot be negative', v_dur);
      elsif v_start is null then
        v_reason := 'missing or unparseable planned_start';
      elsif v_finish is null then
        v_reason := 'missing or unparseable planned_finish';
      elsif v_finish < v_start then
        v_reason := 'planned_finish is before planned_start — an activity cannot finish before it begins';
      end if;
    end if;

    -- Predecessor tokens, normalised. Resolution happens in phase B, over the
    -- whole file; only the one cycle that is cheap at write time — an
    -- activity naming itself — is refused here, mirroring no_self_dependency.
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
  -- A token resolves against (a) tasks already in the same schedule event,
  -- or (b) a row of this upload with the same event key that is still going
  -- to land (pending) or already landed once (duplicate). When a row falls,
  -- rows depending on it fall on the next pass, each naming its token — so
  -- the persisted dependency set can never reference an activity that is not
  -- there. Bounded: every pass that changes anything rejects at least one
  -- row, so at most v_n passes run.
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
          -- Find-or-create survives a concurrent run creating the same event:
          -- the ON CONFLICT arm turns the race into the existing row's id.
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

        insert into shutdown_tasks (event_id, task_key, label, duration_hours,
          wbs_path, planned_start, planned_finish, calendar_name,
          source_system, external_id)
        values (v_event, a_ext[i], a_descr[i], a_dur[i],
          a_wbs[i], a_start[i], a_finish[i], a_cal[i],
          v_source, a_ext[i]);

        if a_preds[i] <> '' then
          foreach v_tok in array string_to_array(a_preds[i], ',') loop
            insert into shutdown_task_dependencies (event_id, task_key, predecessor_key)
            values (v_event, a_ext[i], v_tok)
            on conflict (event_id, task_key, predecessor_key) do nothing;
          end loop;
        end if;

        -- A schedule is a snapshot whose dates are legitimately in the
        -- future; the position that advances is "loaded now", exactly as
        -- material_stock records it.
        v_max_ts := greatest(coalesce(v_max_ts, now()), now());
        a_status[i] := 'accepted';
      exception
        when unique_violation then
          -- The dedupe index is the real guarantee; the phase-A `exists` is
          -- an optimisation a concurrent run can slip between.
          v_reason := 'already loaded — another run wrote this external_id while this one was in flight';
          a_status[i] := 'rejected';
        when others then
          v_reason := format('the database refused this row: %s', sqlerrm);
          a_status[i] := 'rejected';
      end;
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
      -- The rejected row is KEPT, with its reason — outside any
      -- subtransaction, so no rollback can take the explanation with it.
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

-- One door, not two: reachable through ingest_rows only, like its two peers
-- (20261004090000's argument, applied on day one rather than retrofitted).
-- service_role keeps it for the vendor adapter the contract reserves it for.
revoke all on function public.ingest_schedule_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_schedule_batch(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The router learns the third branch. Body SPLICED from 20261004090000 with
-- exactly one edit — the ingest_schedule_batch dispatch arm — asserted to
-- land exactly once at generation time. Everything the door's tests hold the
-- router to (org filter, five-role gate, manual_upload-run check, fail-fast
-- on an unroutable type, explicit dispatch) is carried unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_rows(
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
  v_role text;
  v_entity text;
  v_handler text;
begin
  -- SECURITY DEFINER because ingest_batch and ingest_context_batch are no
  -- longer executable by `authenticated`; this function is the only caller
  -- they have. It therefore re-states the tenant filter itself rather than
  -- leaning on the connector_runs policy, which RLS does not apply here.
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  -- The SAME gate the door applies, restated on the write. A run id is not a
  -- capability: connector_runs' policy is org-wide, so any member of the tenant
  -- can read the id of a run the door opened for a planner. Without this a
  -- technician the door had just refused could push condition readings through
  -- that run and clear a live alarm — measured, not supposed.
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'importing master data requires a planning, engineering or administrator role');
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('error', 'rows must be a JSON array');
  end if;

  -- The run must be one this door opened. Rows are stamped with the run's
  -- connector_key as source_system, so accepting any run in the tenant let a
  -- caller write work orders that read as SAP history; and a connector with a
  -- NULL key defeats the dedupe predicate entirely, so the same file loaded
  -- three times landed three rows.
  select cr.entity_type into v_entity
    from connector_runs cr
    join connectors c on c.id = cr.connector_id
   where cr.id = p_run_id
     and cr.organization_id = v_org
     and c.connector_type = 'manual_upload'
     and c.connector_key is not null;
  if not found then
    return jsonb_build_object('error', 'run not found');
  end if;

  v_handler := public.ingest_handler_for(v_entity);
  if v_handler is null then
    -- Fail fast on the whole call. A run whose type no validator owns is a
    -- configuration fault, and refusing every row one at a time would report it
    -- as a data fault — the distinction 20260907090000 exists to preserve.
    return jsonb_build_object('error',
      format('no ingest handler for entity type "%s" — supported: %s',
             v_entity, public.ingest_supported_entity_types()));
  end if;

  -- Dispatch is an explicit branch rather than a dynamically built call. The
  -- route table is trusted today; a dynamic call site would still be there the
  -- day it is not.
  if v_handler = 'ingest_batch' then
    return public.ingest_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_context_batch' then
    return public.ingest_context_batch(p_run_id, p_rows);
  elsif v_handler = 'ingest_schedule_batch' then
    return public.ingest_schedule_batch(p_run_id, p_rows);
  end if;

  return jsonb_build_object('error',
    format('the route table names handler "%s", which this router cannot call', v_handler));
end $$;

-- The replace preserves the ACL, but a grant that exists only as a leftover
-- is a grant nobody can read in this file (20261004090000's own argument) —
-- so who may call the router is restated.
revoke all on function public.ingest_rows(uuid, jsonb) from public, anon;
grant execute on function public.ingest_rows(uuid, jsonb) to authenticated;
grant execute on function public.ingest_rows(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The Case Workspace read, v4. Body SPLICED from 20261110090300 with exactly
-- one edit: a 'schedule' key after 'baselines' — every imported schedule for
-- the case with its activities and resolved predecessor lists. SECURITY
-- INVOKER as before, so the shutdown_* SELECT policies (20260824090000)
-- govern the aggregate: org-scoped rows only.
-- ---------------------------------------------------------------------------
create or replace function public.get_development_case(p_case_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'status', c.status,
    'lifecycleType', c.lifecycle_type,
    'problemStatement', c.problem_statement,
    'opportunityStatement', c.opportunity_statement,
    'businessUnit', c.business_unit,
    'estimatedCapex', c.estimated_capex,
    'expectedValue', c.expected_value,
    'currentStageKey', c.current_stage_key,
    'createdAt', c.created_at,
    'sponsor', (select coalesce(p.full_name, p.email) from user_profiles p
                 where p.id = c.sponsor_id),
    'sanction', case when c.sanctioned_at is null then null else jsonb_build_object(
      'sanctionedAt', c.sanctioned_at,
      'sanctionedValue', c.sanctioned_value,
      'note', c.sanction_note,
      'by', (select coalesce(p.full_name, p.email) from user_profiles p
              where p.id = c.sanctioned_by)) end,
    'framework', case when c.framework_id is null then null else (
      select jsonb_build_object('id', f.id, 'name', f.name, 'version', f.version,
        'source', f.source, 'sourceAuthority', f.source_authority, 'status', f.status)
      from project_frameworks f where f.id = c.framework_id) end,
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stageKey', s.stage_key,
        'displayName', s.display_name,
        'sequence', s.sequence,
        'purpose', s.purpose,
        'isCurrent', s.stage_key = c.current_stage_key,
        'gates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'sequence', g.sequence,
            'decisionType', g.decision_type,
            'independentAssuranceRequired', g.independent_assurance_required,
            'readinessThreshold', g.readiness_threshold,
            'criteria', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sc.id, 'criterion', sc.criterion,
                'isMandatory', sc.is_mandatory, 'guidance', sc.guidance,
                'category', sc.category, 'evidenceType', sc.evidence_type,
                'minimumConfidence', sc.minimum_confidence,
                'weight', sc.weight,
                'sourceAuthority', sc.source_authority)
                order by sc.sort_order, sc.criterion)
              from stage_gate_criteria sc where sc.gate_id = g.id
            ), '[]'::jsonb),
            'latestReview', (
              select jsonb_build_object(
                'id', r.id, 'outcome', r.outcome, 'reviewedAt', r.reviewed_at,
                'note', r.note,
                'findings', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'criterion', fi.criterion_text, 'status', fi.status,
                    'evidence', fi.evidence)
                    order by fi.id)
                  from stage_gate_findings fi where fi.review_id = r.id
                ), '[]'::jsonb),
                'conditions', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', gc.id, 'description', gc.description,
                    'dueDate', gc.due_date, 'status', gc.status,
                    'evidenceRequirement', gc.evidence_requirement,
                    'consequenceIfMissed', gc.consequence_if_missed,
                    'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                               where p.id = gc.owner_id))
                    order by gc.due_date)
                  from gate_conditions gc where gc.review_id = r.id
                ), '[]'::jsonb))
              from stage_gate_reviews r
              where r.development_case_id = c.id and r.gate_id = g.id
              -- The same ordering the gate blockers enforce against: the
              -- row shown IS the row that decides (latest-review semantics).
              order by r.reviewed_at desc, r.id desc limit 1))
            order by g.sequence, g.name)
          from stage_gates g
          where g.framework_id = c.framework_id and g.stage_key = s.stage_key
        ), '[]'::jsonb))
        order by s.sequence)
      from project_framework_stages s
      where s.framework_id = c.framework_id
    ), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'type', d.type,
        'status', d.status,
        'revision', d.revision,
        'requiredDate', d.required_date,
        'sourceSystem', d.source_system,
        'requirementId', d.requirement_id,
        'requirement', case when d.requirement_id is null then null else (
          select jsonb_build_object('criterion', sc.criterion, 'gateId', sc.gate_id,
            'isMandatory', sc.is_mandatory)
          from stage_gate_criteria sc where sc.id = d.requirement_id) end,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = d.owner_id),
        'ownerId', d.owner_id,
        'document', case when d.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title,
            'documentClass', k.document_class, 'chunkCount', k.chunk_count)
          from kb_intake_documents k where k.id = d.document_id) end,
        'acceptance', case when d.accepted_at is null then null else jsonb_build_object(
          'acceptedAt', d.accepted_at,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = d.accepted_by)) end,
        'reviewNote', d.review_note)
        order by d.created_at desc)
      from develop_deliverables d
      where d.development_case_id = c.id and d.organization_id = c.organization_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'evidenceClass', e.evidence_class,
        'description', e.description,
        'sourceSystem', e.source_system,
        'sourceReference', e.source_reference,
        'dataQuality', e.data_quality,
        'revision', e.revision,
        'applicability', e.applicability,
        'observedAt', e.ts,
        'verificationStatus', e.verification_status,
        'verification', case when e.verified_at is null then null else jsonb_build_object(
          'verifiedAt', e.verified_at,
          'method', e.verification_method,
          'note', e.verification_note,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = e.verified_by)) end,
        'document', case when e.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title)
          from kb_intake_documents k where k.id = e.document_id) end)
        order by e.ts desc, e.created_at desc)
      from evidence_items e
      where e.development_case_id = c.id and e.organization_id = c.organization_id
    ), '[]'::jsonb),
    'risks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'status', r.status,
        'currentRiskLevel', r.current_risk_level,
        'residualRiskLevel', r.residual_risk_level,
        'decisionAction', r.decision_action,
        'reviewDate', r.review_date,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = r.risk_owner_id))
        order by case coalesce(r.current_risk_level, '')
                   when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2
                   when 'Low' then 3 when 'Very Low' then 4 else 5 end,
                 r.title)
      from risks r
      where r.development_case_id = c.id and r.organization_id = c.organization_id
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dc.id,
        'question', dc.decision_question,
        'requiredDate', dc.decision_required_date,
        'approvalLevel', dc.approval_level,
        'createdAt', dc.created_at,
        'owner', (select coalesce(p.full_name, p.email) from user_profiles p
                   where p.id = dc.owner_id),
        'objective', case when dc.objective_id is null then null else (
          select o.description from risk_objectives o where o.id = dc.objective_id) end,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', sc2.id, 'key', sc2.key, 'label', sc2.label,
            'description', sc2.description,
            'capex', sc2.capex, 'opex', sc2.opex,
            'lifecycleCost', sc2.lifecycle_cost,
            'scheduleEffect', sc2.schedule_effect,
            'riskEffect', sc2.risk_effect,
            'reliabilityEffect', sc2.reliability_effect,
            'environmentalEffect', sc2.environmental_effect,
            'expectedValue', sc2.expected_value,
            'isSelected', sc2.id = dc.selected_option_id)
            order by sc2.sequence_no nulls last, sc2.created_at)
          from scenarios sc2 where sc2.decision_id = dc.id
        ), '[]'::jsonb),
        'selection', case when dc.selected_at is null then null else jsonb_build_object(
          'optionId', dc.selected_option_id,
          'selectedAt', dc.selected_at,
          'rationale', dc.selection_rationale,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = dc.selected_by)) end,
        'evidenceItemIds', dc.evidence_item_ids,
        'assumptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'statement', a.statement, 'status', a.status,
            'confidence', a.confidence))
          from risk_assumption_dependencies ad
          join risk_assumptions a on a.id = ad.assumption_id
          where ad.subject_type = 'decision' and ad.subject_id = dc.id
            and ad.organization_id = c.organization_id
        ), '[]'::jsonb))
        order by dc.created_at desc)
      from decisions dc
      where dc.development_case_id = c.id and dc.organization_id = c.organization_id
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rec.id,
        'title', rec.title,
        'action', rec.action,
        'status', rec.status,
        'urgency', rec.urgency,
        'binding', case when rec.development_case_id = c.id then 'direct' else 'via_risk' end,
        'riskTitle', case when rec.development_case_id = c.id then null else (
          select r2.title from risks r2 where r2.id = rec.risk_id) end,
        'createdAt', rec.created_at,
        'verification', (
          select jsonb_build_object(
            'status', vo.status, 'dueDate', vo.due_date,
            'dueDateAssumed', vo.due_date_assumed, 'result', vo.result)
          from verification_obligations vo
          where vo.recommendation_id = rec.id))
        order by rec.created_at desc)
      from recommendations rec
      where rec.organization_id = c.organization_id
        and (rec.development_case_id = c.id
             or rec.risk_id in (select r3.id from risks r3
                                where r3.development_case_id = c.id
                                  and r3.organization_id = c.organization_id))
    ), '[]'::jsonb),
    'baselines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'baselineType', b.baseline_type,
        'version', b.version,
        'status', b.status,
        'description', b.description,
        'content', b.content,
        'document', case when b.document_id is null then null else (
          select jsonb_build_object('id', k.id, 'title', k.title)
          from kb_intake_documents k where k.id = b.document_id) end,
        'approval', case when b.approved_at is null then null else jsonb_build_object(
          'approvedAt', b.approved_at,
          'note', b.approval_note,
          'by', (select coalesce(p.full_name, p.email) from user_profiles p
                  where p.id = b.approved_by)) end,
        'supersededAt', b.superseded_at,
        'createdAt', b.created_at)
        order by b.baseline_type, b.version desc)
      from development_baselines b
      where b.development_case_id = c.id and b.organization_id = c.organization_id
    ), '[]'::jsonb),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'eventKey', e.event_key,
        'title', e.title,
        'status', e.status,
        'activities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'activityId', t.task_key,
            'description', t.label,
            'wbsPath', t.wbs_path,
            'durationHours', t.duration_hours,
            'plannedStart', t.planned_start,
            'plannedFinish', t.planned_finish,
            'calendar', t.calendar_name,
            'sourceSystem', t.source_system,
            'predecessors', coalesce((
              select jsonb_agg(d.predecessor_key order by d.predecessor_key)
              from shutdown_task_dependencies d
              where d.event_id = e.id and d.task_key = t.task_key), '[]'::jsonb))
            order by t.planned_start, t.task_key)
          from shutdown_tasks t where t.event_id = e.id), '[]'::jsonb))
        order by e.created_at)
      from shutdown_events e
      where e.development_case_id = c.id and e.organization_id = c.organization_id
    ), '[]'::jsonb)
  )
  from development_cases c
  where c.id = p_case_id and c.organization_id = app_current_org();
$$;

revoke all on function public.get_development_case(uuid) from public, anon;
grant execute on function public.get_development_case(uuid) to authenticated;

notify pgrst, 'reload schema';
