-- ============================================================================
-- Sync Develop Slice 4C — SCHEDULE QUALITY ASSURANCE.
--
--   D5.13  the nine defect classes (spec II.6)
--   D5.31  the Schedule Quality Score (spec §50)
--   D5.14  the Schedule Confidence Score (spec II.6) — distinct from quality
--
-- THE SPEC'S OWN SENTENCES:
--
--   II.6 "Detect: missing logic, open ends, excessive constraints,
--         long-duration activities, negative float, unrealistic lags, broken
--         critical paths, excessive concurrency, unrealistic calendars.
--         Schedule Confidence Score. Monte Carlo on poor logic is not useful."
--   §50  "Schedule Quality Score: logic completeness, open ends, constraints,
--         duration quality, critical-path continuity, calendar consistency.
--         No Monte Carlo on a poor schedule without warning."
--
-- ── WHY THE DIAGNOSIS IS IN SQL AND THE SIMULATION IS NOT ──────────────────
-- The Monte Carlo kernel lives in `src/lib/modelling` and stays there: one
-- simulator, never two (overlap-map ruling on D5.09/D5.32). But the kernel
-- runs on the CLIENT, and a gate that only exists on the client is a gate the
-- client can decline to apply. So the DIAGNOSIS — which is set logic over
-- stored rows, not sampling — is computed here, where it owns the data, and
-- 20261202090200's recording door re-runs it server-side before it will
-- record any simulation at all. Nothing here samples anything; the slice test
-- asserts no sampling machinery exists in SQL.
--
-- ── RULINGS THE SPEC LEAVES OPEN, DECIDED HERE ─────────────────────────────
--
-- R1. MISSING LOGIC vs OPEN ENDS. The spec lists both and they overlap in
--     common usage. Ruling: MISSING LOGIC is an activity with NEITHER a
--     predecessor NOR a successor — it floats free of the network and its
--     dates are assertions. OPEN ENDS is an activity missing exactly ONE
--     side, minus the one legitimate project start and the one legitimate
--     project finish, which every schedule must have. Two classes, disjoint
--     populations, so no activity is counted twice into the score.
--
-- R2. DURATIONS ARE ELAPSED HOURS. The import (20261112090000) takes
--     `original_duration_hours` and refuses to convert P6 duration units
--     because that needs a calendar it will not guess; the CPM adds those
--     hours to elapsed time. So the long-duration threshold is stated in
--     ELAPSED hours: 1056 h = 44 calendar days, the DCMA-14 long-duration
--     limit expressed in the unit this schema actually stores. A threshold
--     stated in working days over a column of elapsed hours would flag
--     nothing and read as a clean schedule.
--
-- R3. A CALENDAR CANNOT BE ASSESSED FROM ITS NAME. `calendar_name` is a
--     string P6 exported; "5x8" tells this database nothing it can check.
--     What IS checkable is the arithmetic the calendar implies: (a) an
--     activity whose stated duration EXCEEDS its own planned window is
--     impossible under any calendar; (b) an activity whose duration exactly
--     fills a window longer than seven days asserts a 24x7 calendar with no
--     non-working time at all across more than a week. Both are computed
--     from stored dates. Naming-based calendar checks are refused, not faked.
--
-- R4. FLOAT AND CONSTRAINTS ARE P6-OWNED. Negative float and critical-path
--     continuity are properties of a computed network. Recomputing the
--     network here would be a second critical-path implementation beside the
--     kernel's, so instead P6's OWN answers are imported: `total_float_hours`
--     and `constraint_type`/`constraint_date` join the P6-owned field wall
--     (20261130090100) exactly like `duration_hours` did. P6 stays the system
--     of record for what P6 computed (spec §22, §77). Where the source never
--     exported them, the classes that need them report NOT DIAGNOSABLE by
--     name — they never report "clean".
--
-- R5. LAGS LIVE ON THE RELATIONSHIP. `shutdown_task_dependencies` carried
--     only (task, predecessor); the original import comment says outright
--     "relationship type and lag notation is not carried". It is carried now:
--     `link_type` (FS/SS/FF/SF) and `lag_hours`. NEGATIVE lag is the finding
--     that matters most — a successor pulled back inside its predecessor is
--     logic no planner can defend in a review — and excessive positive lag
--     (> 120 h = 5 days) is a duration hiding inside a relationship where no
--     resource is assigned to it.
--
-- R6. NOT-DIAGNOSABLE IS NOT A PASS. The §50 score is computed over the
--     components that could be diagnosed and PUBLISHES its own coverage. When
--     fewer than four of the six §50 components are diagnosable the score is
--     REFUSED outright, because a "schedule quality score" resting on two
--     components is a number whose name overstates it by three.
--
-- R8. SIX COMPONENTS SCORE, NINE CLASSES GATE. §50 enumerates its own
--     composition and it names six things; inventing three more weighted
--     terms would make the published number stop being the spec's number. So
--     the SCORE is §50's six. The other three classes — negative float,
--     unrealistic lags, excessive concurrency — are diagnosed, reported, and
--     BLOCK THE GATE in their own right when they exceed their published
--     threshold. Without that second arm a schedule with catastrophic
--     negative float would score in the nineties and simulate happily, which
--     is precisely the outcome II.6 exists to prevent.
--
-- R7. TOO SPARSE TO DIAGNOSE. Four of the six §50 components are statements
--     about a NETWORK. A network needs a start, a middle, an end and the
--     relationships joining them, so the floor is 5 activities AND 2
--     relationships. Below it the score is REFUSED. Scoring an empty schedule
--     100 — no missing logic, no open ends, no long durations, all true and
--     all vacuous — is the single most dangerous number this file could
--     produce, because it would gate a Monte Carlo OPEN on a schedule that
--     does not exist. The floor is not configurable: a threshold a tenant can
--     lower is a gate a tenant can widen.
--
-- ── SCHEDULE CONFIDENCE IS NOT SCHEDULE QUALITY (D5.14) ────────────────────
-- Quality asks "is this schedule built correctly?". Confidence asks "how much
-- weight will this schedule bear?" — and a structurally perfect schedule
-- imported once, never updated, carrying no duration ranges and connected to
-- no authorized scope justifies very little. So confidence composes four
-- distinct things with published weights: structure (the §50 score),
-- uncertainty expression (what share of activities carry an optimistic and
-- pessimistic duration at all), history (how many times this schedule has
-- been re-imported — a schedule with one load has no track record), and scope
-- anchoring (what share of activities resolve to a WBS element). It REFUSES
-- whenever quality refuses: a confidence built on an unscored schedule is a
-- second number with a first number's problem.
--
-- §70: nothing here approves, accepts or passes anything. The score is
-- derived; there is no act in this file for any identity, human or otherwise,
-- that records a quality JUDGEMENT — and there is deliberately no waiver act
-- that would let anybody sign off a failing class and open the gate.
--
-- Canonical reuse: shutdown_tasks / shutdown_task_dependencies through the
-- D5.28 door, shutdown_events, development_cases, project_wbs_elements,
-- connector_runs / ingest_staging (the import history), record_calculation_run
-- (D11.29). No new schedule store, no second critical path, no sampler.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. THE CODE VERSIONS FOR THIS SLICE (D11.29).
--
--    Pinned in the FIRST file of the slice, ahead of the compute functions,
--    because record_calculation_run RAISES on an unpinned key by design. The
--    4A and 4B keys keep their own versions: their code did not change, and
--    bumping a version on unchanged code makes the version stop meaning
--    anything.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  -- ONLY KEYS A COMPUTE FUNCTION RECORDS. The slice tests assert that every
  -- key pinned here appears in a record_calculation_run call, so a pin can
  -- never read as coverage that does not exist.
  select v from (values
    ('case_scope_growth',            'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',     'develop-controls/4A/2026-11-24'),
    ('case_earned_value',            'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',       'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',      'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',     'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',     'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',        'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',     'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics', 'develop-schedule/4C/2026-12-02')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. THE P6-OWNED ANALYSIS FIELDS (R4, R5).
--
--    These are values P6 COMPUTED and exported. Sync reads them and never
--    writes them back (spec §77); the field wall below refuses a client edit
--    on an imported row exactly as it already does for duration and dates.
-- ---------------------------------------------------------------------------
alter table public.shutdown_tasks
  add column if not exists total_float_hours numeric,
  add column if not exists constraint_type text,
  add column if not exists constraint_date timestamptz;

alter table public.shutdown_tasks drop constraint if exists shutdown_tasks_constraint_kind;
alter table public.shutdown_tasks add constraint shutdown_tasks_constraint_kind
  check (constraint_type is null or constraint_type in
    -- The P6 constraint vocabulary, split into the HARD set (a date the
    -- network cannot move past) and the SOFT set (a preference the network
    -- may violate). Only the hard set counts against §50's constraint
    -- component: flagging "start on or after" as a defect would flood the
    -- finding with the ordinary way a planner records a known availability.
    ('mandatory_start','mandatory_finish','start_on','finish_on',
     'start_on_or_after','start_on_or_before','finish_on_or_after','finish_on_or_before',
     'as_late_as_possible'));

-- A finite float. 'NaN'/'Infinity' are valid numerics in Postgres and would
-- pass every inequality below vacuously, so they are refused at the column.
alter table public.shutdown_tasks drop constraint if exists shutdown_tasks_float_finite;
alter table public.shutdown_tasks add constraint shutdown_tasks_float_finite
  check (total_float_hours is null
         or (total_float_hours <> 'NaN'::numeric
             and total_float_hours <> 'Infinity'::numeric
             and total_float_hours <> '-Infinity'::numeric));

alter table public.shutdown_tasks drop constraint if exists shutdown_tasks_constraint_pair;
alter table public.shutdown_tasks add constraint shutdown_tasks_constraint_pair
  check (constraint_type is null
         or constraint_type = 'as_late_as_possible'
         or constraint_date is not null);

comment on column public.shutdown_tasks.total_float_hours is
  'D5.13 (spec II.6): P6''s OWN total float for this activity, imported verbatim. Sync does not recompute the network — recomputing it would be a second critical-path implementation beside the modelling kernel''s. Null means the source never exported it, and the negative-float and critical-path-continuity classes then report NOT DIAGNOSABLE rather than clean.';
comment on column public.shutdown_tasks.constraint_type is
  'D5.13 (spec II.6 "excessive constraints"): the P6 date constraint on this activity. The hard set (mandatory_start/mandatory_finish/start_on/finish_on) is what §50 counts; the soft set is recorded and excluded, because an "on or after" is how a planner records a known availability rather than a defect.';

-- Relationship properties (R5).
alter table public.shutdown_task_dependencies
  add column if not exists link_type text,
  add column if not exists lag_hours numeric;

alter table public.shutdown_task_dependencies drop constraint if exists std_link_type_allowed;
alter table public.shutdown_task_dependencies add constraint std_link_type_allowed
  check (link_type is null or link_type in ('FS','SS','FF','SF'));

alter table public.shutdown_task_dependencies drop constraint if exists std_lag_finite;
alter table public.shutdown_task_dependencies add constraint std_lag_finite
  check (lag_hours is null
         or (lag_hours <> 'NaN'::numeric
             and lag_hours <> 'Infinity'::numeric
             and lag_hours <> '-Infinity'::numeric));

comment on column public.shutdown_task_dependencies.lag_hours is
  'D5.13 (spec II.6 "unrealistic lags"): the lag on this relationship in hours, as P6 exported it. NEGATIVE lag pulls a successor back inside its predecessor and is the finding that matters most; excessive positive lag is a duration hiding in a relationship nobody resourced. Null means the source never exported it and the class reports NOT DIAGNOSABLE.';

-- ---------------------------------------------------------------------------
-- 2. THE FIELD WALL GROWS (20261130090100).
--
--    Spliced from that file with exactly one edit — three more columns in
--    the P6-owned changed-set — so every refusal, audit arm and TRUNCATE
--    guard of the original is carried unchanged. INSERT, UPDATE and DELETE
--    coverage is preserved: an imported activity's float can no more be
--    rewritten by a client than its duration can, and deleting it is still
--    how a schedule is shortened without changing a number.
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
    raise exception
      'shutdown_tasks holds every imported P6 activity behind the system-of-record wall; truncating it erases them all in one statement, which no row-level guard can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if v_marker <> 'granted' and v_client then
      raise exception
        'a schedule activity is created by the P6 import door or by '
        'record_local_schedule_activity — a direct insert would produce an '
        'activity with no stated provenance.'
        using errcode = 'insufficient_privilege';
    end if;
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
    -- SLICE 4C. P6 computed the float and recorded the constraint; the whole
    -- point of importing them rather than recomputing is that they are P6's
    -- answers. A client that could edit total_float_hours could clear a
    -- negative-float finding and open the Monte Carlo gate by typing.
    if new.total_float_hours is distinct from old.total_float_hours then v_changed := v_changed || 'total_float_hours'::text; end if;
    if new.constraint_type is distinct from old.constraint_type then v_changed := v_changed || 'constraint_type'::text; end if;
    if new.constraint_date is distinct from old.constraint_date then v_changed := v_changed || 'constraint_date'::text; end if;

    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return new;
    end if;
  end if;

  select e.organization_id into v_org from shutdown_events e
   where e.id = (case when tg_op = 'DELETE' then old.event_id else new.event_id end);

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

-- ---------------------------------------------------------------------------
-- 3. THE IMPORT DOOR CARRIES THE NEW FIELDS.
--
--    Spliced from 20261130090100 with the float / constraint / relationship
--    fields added to Phase A validation and Phase C writes. Every existing
--    refusal, phase, fixpoint and counter is carried unchanged — an import
--    that silently accepted a non-finite float would put 'NaN' behind a
--    negative-float finding that can never be true or false.
--
--    The relationship fields ride the predecessor token: `predecessors` stays
--    a plain comma list of activity ids (unchanged), and `relationships` is
--    an optional array of {predecessor, link_type, lag_hours} objects that
--    ANNOTATES those tokens. A relationship naming a predecessor the row does
--    not declare is REFUSED rather than silently ignored — a lag attached to
--    a relationship that does not exist is a lag nobody applied.
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
  a_float numeric[] := '{}';
  a_ctype text[] := '{}';
  a_cdate timestamptz[] := '{}';
  a_rels jsonb[] := '{}';
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
  v_float numeric;
  v_ctype text;
  v_cdate timestamptz;
  v_rels jsonb;
  rel jsonb;
  v_lag numeric;
  v_link text;
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
    v_float := null; v_ctype := null; v_cdate := null; v_rels := '[]'::jsonb;
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
        v_float := (nullif(btrim(row_in->>'total_float_hours'), ''))::numeric;
        v_cdate := (nullif(btrim(row_in->>'constraint_date'), ''))::timestamptz;
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
      -- SLICE 4C: the analysis fields. Non-finite float would sit behind a
      -- negative-float finding that can never be true or false.
      elsif v_float is not null
            and (v_float = 'NaN'::numeric or v_float = 'Infinity'::numeric
                 or v_float = '-Infinity'::numeric) then
        v_reason := format('total_float_hours is %s; a float must be a finite number of hours (negative float is a legitimate, and important, value)', v_float);
      elsif v_cdate is not null and not isfinite(v_cdate) then
        v_reason := format('constraint_date is %s; a constraint date must be a finite calendar date', v_cdate);
      end if;
    end if;

    if v_reason is null then
      v_ctype := lower(nullif(btrim(coalesce(row_in->>'constraint_type', '')), ''));
      if v_ctype is not null and v_ctype not in
         ('mandatory_start','mandatory_finish','start_on','finish_on',
          'start_on_or_after','start_on_or_before','finish_on_or_after','finish_on_or_before',
          'as_late_as_possible') then
        v_reason := format('constraint_type "%s" is not a P6 constraint this import recognises: mandatory_start, mandatory_finish, start_on, finish_on, start_on_or_after, start_on_or_before, finish_on_or_after, finish_on_or_before, as_late_as_possible', v_ctype);
      elsif v_ctype is not null and v_ctype <> 'as_late_as_possible' and v_cdate is null then
        v_reason := format('constraint_type "%s" names a date constraint with no constraint_date — a constraint with no date constrains nothing and would be counted as one that does', v_ctype);
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

    -- SLICE 4C: relationship annotations. Optional; validated strictly.
    if v_reason is null and jsonb_typeof(row_in->'relationships') = 'array' then
      for j in 1 .. jsonb_array_length(row_in->'relationships') loop
        rel := row_in->'relationships'->(j - 1);
        v_tok := nullif(btrim(coalesce(rel->>'predecessor', '')), '');
        v_link := upper(nullif(btrim(coalesce(rel->>'link_type', '')), ''));
        v_lag := null;
        begin
          v_lag := (nullif(btrim(coalesce(rel->>'lag_hours', '')), ''))::numeric;
        exception when others then
          v_reason := format('relationship lag_hours "%s" is not a number', rel->>'lag_hours');
        end;
        if v_reason is not null then
          exit;
        elsif v_tok is null then
          v_reason := 'a relationship names the predecessor it annotates';
          exit;
        elsif not (v_tok = any (v_tokens)) then
          v_reason := format('relationship names predecessor "%s", which this row does not declare in `predecessors` — a lag attached to a relationship that does not exist is a lag nobody applied', v_tok);
          exit;
        elsif v_link is not null and v_link not in ('FS','SS','FF','SF') then
          v_reason := format('link_type "%s" is not one of FS, SS, FF, SF', v_link);
          exit;
        elsif v_lag is not null
              and (v_lag = 'NaN'::numeric or v_lag = 'Infinity'::numeric
                   or v_lag = '-Infinity'::numeric) then
          v_reason := format('lag_hours is %s; a lag must be a finite number of hours', v_lag);
          exit;
        else
          v_rels := v_rels || jsonb_build_object(
            'predecessor', v_tok, 'link_type', v_link, 'lag_hours', v_lag);
        end if;
      end loop;
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
    a_float := a_float || v_float;
    a_ctype := a_ctype || v_ctype;
    a_cdate := a_cdate || v_cdate;
    a_rels := a_rels || v_rels;

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
              a_reason[i] := format('unknown predecessor "%s": not already in this schedule and not a valid row of this upload. Predecessors are plain activity ids; relationship type and lag ride the optional `relationships` array.', v_tok);
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
          source_system, external_id, origin,
          total_float_hours, constraint_type, constraint_date)
        values (v_event, a_ext[i], a_descr[i], a_dur[i],
          a_wbs[i], a_start[i], a_finish[i], a_cal[i],
          v_source, a_ext[i], 'imported',
          a_float[i], a_ctype[i], a_cdate[i]);
        perform set_config('app.schedule_activity_write', '', true);

        if a_preds[i] <> '' then
          foreach v_tok in array string_to_array(a_preds[i], ',') loop
            insert into shutdown_task_dependencies
              (event_id, task_key, predecessor_key, link_type, lag_hours)
            values (v_event, a_ext[i], v_tok,
              (select nullif(btrim(coalesce(x->>'link_type','')),'')
                 from jsonb_array_elements(a_rels[i]) x
                where x->>'predecessor' = v_tok limit 1),
              (select (nullif(btrim(coalesce(x->>'lag_hours','')),''))::numeric
                 from jsonb_array_elements(a_rels[i]) x
                where x->>'predecessor' = v_tok limit 1))
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
-- 4. THE RELATIONSHIP ANNOTATION ACT, for Sync-authored logic.
--
--    An imported relationship's lag is P6's; a LOCAL schedule's logic is
--    Sync's, so it needs a door. The act refuses to touch a relationship on
--    an imported activity, which is the same wall the field trigger applies
--    to the activity row itself.
-- ---------------------------------------------------------------------------
create or replace function public.record_local_schedule_relationship(
  p_case_id uuid,
  p_relationship jsonb
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
  v_key text := nullif(btrim(coalesce(p_relationship->>'activity_id','')), '');
  v_pred text := nullif(btrim(coalesce(p_relationship->>'predecessor','')), '');
  v_link text := upper(nullif(btrim(coalesce(p_relationship->>'link_type','')), ''));
  v_lag_raw text := nullif(btrim(coalesce(p_relationship->>'lag_hours','')), '');
  v_lag numeric;
  v_event uuid;
  t shutdown_tasks%rowtype;
  p shutdown_tasks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'authoring schedule logic requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_key is null or v_pred is null then
    return jsonb_build_object('error',
      'a relationship names both ends: activity_id and predecessor');
  end if;
  if v_key = v_pred then
    return jsonb_build_object('error',
      'an activity cannot depend on itself');
  end if;

  select id into v_event from shutdown_events
   where organization_id = v_org and event_key = 'develop:' || c.id::text || ':sync-local';
  if v_event is null then
    return jsonb_build_object('error',
      'this case has no Sync-authored schedule yet — author the activities first (record_local_schedule_activity)');
  end if;
  select * into t from shutdown_tasks where event_id = v_event and task_key = v_key;
  if not found then
    return jsonb_build_object('error',
      format('activity "%s" is not in this case''s Sync-authored schedule. Logic on an IMPORTED activity belongs to P6 and is imported with it (spec §22, §77).', v_key));
  end if;
  select * into p from shutdown_tasks where event_id = v_event and task_key = v_pred;
  if not found then
    return jsonb_build_object('error',
      format('predecessor "%s" is not in this case''s Sync-authored schedule', v_pred));
  end if;

  if v_link is not null and v_link not in ('FS','SS','FF','SF') then
    return jsonb_build_object('error',
      format('link_type "%s" is not one of FS, SS, FF, SF', v_link));
  end if;
  if v_lag_raw is not null then
    v_lag := sync_text_as_numeric(v_lag_raw);
    if v_lag is null then
      return jsonb_build_object('error', format('lag_hours "%s" is not a number', v_lag_raw));
    end if;
    if v_lag = 'NaN'::numeric or v_lag = 'Infinity'::numeric or v_lag = '-Infinity'::numeric then
      return jsonb_build_object('error',
        format('lag_hours is %s; a lag must be a finite number of hours', v_lag));
    end if;
  end if;

  insert into shutdown_task_dependencies (event_id, task_key, predecessor_key, link_type, lag_hours)
  values (v_event, v_key, v_pred, v_link, v_lag)
  on conflict (event_id, task_key, predecessor_key) do update
    set link_type = excluded.link_type, lag_hours = excluded.lag_hours;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'schedule_activity', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'activity_key', v_key, 'action', 'logic_authored'),
    null,
    jsonb_build_object('predecessor', v_pred, 'link_type', v_link, 'lag_hours', v_lag));

  return jsonb_build_object('case_id', c.id, 'activity_key', v_key,
    'predecessor', v_pred, 'link_type', v_link, 'lag_hours', v_lag);
end
$$;

revoke all on function public.record_local_schedule_relationship(uuid, jsonb) from public, anon;
grant execute on function public.record_local_schedule_relationship(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. THE PUBLISHED THRESHOLDS AND WEIGHTS.
--
--    One place, server-side, immutable. The TypeScript side mirrors them and
--    the slice test pins the two together, so a threshold cannot be widened
--    on one side only. Nothing here is tenant-configurable: §46 says
--    configurable weights for EVIDENCE confidence and says so because the
--    inputs there are heterogeneous. A schedule-quality threshold a tenant
--    can lower is a Monte Carlo gate a tenant can open.
-- ---------------------------------------------------------------------------
create or replace function public.sync_schedule_quality_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    -- R7. The sparsity floor.
    'minimumActivities', 5,
    'minimumRelationships', 2,
    -- R6. How many of §50's six components must be diagnosable for a score.
    'minimumDiagnosableComponents', 4,
    -- The gate (D5.15). Both conditions must hold to simulate.
    'minimumScoreToSimulate', 60,
    -- Per-class thresholds: the SHARE of the denominator at which a class
    -- stops being a warning and becomes a failure.
    'thresholds', jsonb_build_object(
      'missing_logic',        jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'open_ends',            jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'excessive_constraints',jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'long_durations',       jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'negative_float',       jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'unrealistic_lags',     jsonb_build_object('warn', 0.00, 'fail', 0.05),
      'broken_critical_path', jsonb_build_object('warn', 0.00, 'fail', 0.00),
      'excessive_concurrency',jsonb_build_object('warn', 0.30, 'fail', 0.40),
      'unrealistic_calendars',jsonb_build_object('warn', 0.00, 'fail', 0.05)),
    -- R2 / R5: the absolute limits behind two of the classes.
    'longDurationHours', 1056,
    'excessiveLagHours', 120,
    -- The float at or below which an activity counts as critical for the
    -- continuity check. Zero: "near-critical" is a different question.
    'criticalFloatHours', 0,
    -- §50's six components and their weights. They sum to 100 and the read
    -- asserts it, because a weight vector that does not sum to its own total
    -- makes every score it produces mean something different.
    'scoreWeights', jsonb_build_object(
      'logic_completeness',     20,
      'open_ends',              20,
      'constraints',            15,
      'duration_quality',       15,
      'critical_path_continuity',20,
      'calendar_consistency',   10),
    -- D5.14's four components. Also sum to 100.
    'confidenceWeights', jsonb_build_object(
      'structure',    40,
      'uncertainty_expressed', 25,
      'import_history', 15,
      'scope_anchoring', 20));
$$;

revoke all on function public.sync_schedule_quality_policy() from public, anon;
grant execute on function public.sync_schedule_quality_policy() to authenticated, service_role;

comment on function public.sync_schedule_quality_policy() is
  'D5.31/D5.13: the published §50 weights, per-class thresholds and the sparsity floor. Server-side and immutable — src/lib/develop/schedule.ts mirrors it and the slice test pins the two together so a threshold cannot be widened on one side only.';

-- ---------------------------------------------------------------------------
-- The per-class row builder. One place decides what "pass", "warn", "fail"
-- and "not_diagnosable" mean, so nine classes cannot drift into nine
-- different definitions of a defect.
--
-- componentScore is the 0-100 contribution a DIAGNOSABLE class makes to §50:
-- a linear penalty from clean (100) down to the fail threshold (0). It is
-- null when the class could not be diagnosed, and a null never averages in.
-- ---------------------------------------------------------------------------
create or replace function public.sync_schedule_defect_class(
  p_key text,
  p_label text,
  p_definition text,
  p_count int,
  p_denominator int,
  p_diagnosable boolean,
  p_blind_reason text,
  p_policy jsonb
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'key', p_key,
    'label', p_label,
    'definition', p_definition,
    'diagnosable', coalesce(p_diagnosable, false),
    'count', case when coalesce(p_diagnosable, false) then p_count end,
    'denominator', case when coalesce(p_diagnosable, false) then p_denominator end,
    'share', case when coalesce(p_diagnosable, false) and p_denominator > 0
                  then round(p_count::numeric / p_denominator, 4) end,
    'failThreshold', (p_policy->'thresholds'->p_key->>'fail')::numeric,
    'warnThreshold', (p_policy->'thresholds'->p_key->>'warn')::numeric,
    'severity', case
      when not coalesce(p_diagnosable, false) then 'not_diagnosable'
      when p_denominator <= 0 then 'not_diagnosable'
      when p_count::numeric / p_denominator > (p_policy->'thresholds'->p_key->>'fail')::numeric then 'fail'
      when p_count::numeric / p_denominator > (p_policy->'thresholds'->p_key->>'warn')::numeric then 'warn'
      else 'pass' end,
    'componentScore', case
      when not coalesce(p_diagnosable, false) or p_denominator <= 0 then null
      when (p_policy->'thresholds'->p_key->>'fail')::numeric <= 0 then
        case when p_count = 0 then 100 else 0 end
      else greatest(0, round(100 * (1 - (p_count::numeric / p_denominator)
             / (p_policy->'thresholds'->p_key->>'fail')::numeric), 1)) end,
    'notDiagnosableReason', case when coalesce(p_diagnosable, false) then null
                                 else p_blind_reason end);
$$;

revoke all on function public.sync_schedule_defect_class(text, text, text, int, int, boolean, text, jsonb)
  from public, anon;
grant execute on function public.sync_schedule_defect_class(text, text, text, int, int, boolean, text, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. THE DIAGNOSIS (D5.13), THE SCORE (D5.31) AND THE CONFIDENCE (D5.14).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_schedule_quality(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_policy jsonb := sync_schedule_quality_policy();
  v_n int := 0;                 -- activities on this case
  v_imported int := 0;
  v_local int := 0;
  v_rel int := 0;               -- relationships among them
  v_dated int := 0;             -- activities with BOTH planned dates
  v_ranged int := 0;            -- activities with a real duration range
  v_wbs int := 0;               -- activities resolved to a WBS element
  v_imports int := 0;           -- distinct completed import runs
  -- class counters
  v_missing int := 0;
  v_open int := 0;
  v_hard int := 0;
  v_ctype_present int := 0;
  v_long int := 0;
  v_negfloat int := 0;
  v_float_present int := 0;
  v_neglag int := 0;
  v_biglag int := 0;
  v_lag_present int := 0;
  v_peak int := 0;
  v_calendar int := 0;
  v_continuous boolean;
  v_critical int := 0;
  v_classes jsonb := '[]'::jsonb;
  v_score numeric;
  v_confidence numeric;
  v_components jsonb := '{}'::jsonb;
  v_diagnosable int := 0;
  v_weight_used numeric := 0;
  v_weighted numeric := 0;
  v_refusal text;
  v_gate_fail text[] := '{}';
  v_gate_blind text[] := '{}';
  v_range_share numeric;
  v_wbs_share numeric;
  v_history numeric;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- ── the population ───────────────────────────────────────────────────────
  select count(*),
         count(*) filter (where t.origin = 'imported'),
         count(*) filter (where t.origin = 'local'),
         count(*) filter (where t.planned_start is not null and t.planned_finish is not null),
         count(*) filter (where t.optimistic_hours is not null
                            and t.pessimistic_hours is not null
                            and t.pessimistic_hours > t.optimistic_hours),
         count(*) filter (where t.wbs_element_id is not null),
         count(*) filter (where t.total_float_hours is not null),
         count(*) filter (where t.constraint_type is not null)
    into v_n, v_imported, v_local, v_dated, v_ranged, v_wbs, v_float_present, v_ctype_present
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  select count(*), count(*) filter (where d.lag_hours is not null)
    into v_rel, v_lag_present
  from shutdown_task_dependencies d
  join shutdown_events e on e.id = d.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.task_key)
    and exists (select 1 from shutdown_tasks t
                 where t.event_id = d.event_id and t.task_key = d.predecessor_key);

  -- The import history: how many DISTINCT completed schedule-activity runs
  -- have landed rows on this case. One load is a snapshot; a schedule nobody
  -- has updated has no track record, which is a confidence fact, not a
  -- quality one.
  select count(distinct s.run_id) into v_imports
  from ingest_staging s
  join connector_runs cr on cr.id = s.run_id
  where s.organization_id = c.organization_id
    and s.entity_type = 'schedule_activity'
    and s.status = 'accepted'
    and exists (select 1 from shutdown_tasks t
                join shutdown_events e on e.id = t.event_id
               where e.development_case_id = c.id
                 and t.external_id = s.external_id);

  -- ── R7: too sparse to diagnose ───────────────────────────────────────────
  if v_n = 0 then
    v_refusal :=
      'This case has no schedule activities at all, so there is nothing to diagnose and nothing to score. An empty schedule passes every defect test — no missing logic, no open ends, no long durations — and scoring it 100 would be the most dangerous number this calculation could produce, because a quality score is what gates the Monte Carlo (spec II.6: "Monte Carlo on poor logic is not useful").';
  elsif v_n < (v_policy->>'minimumActivities')::int
        or v_rel < (v_policy->>'minimumRelationships')::int then
    v_refusal := format(
      'This case carries %s schedule activity(ies) and %s relationship(s). Four of §50''s six components — logic completeness, open ends, critical-path continuity and, through the dates it needs, calendar consistency — are statements about a NETWORK, and a network needs a start, a middle, an end and the links joining them. The published floor is %s activities and %s relationships, and it is not configurable: a floor a tenant can lower is a Monte Carlo gate a tenant can open. The individual defect classes below are still reported for what they are worth; the SCORE is refused.',
      v_n, v_rel,
      v_policy->>'minimumActivities', v_policy->>'minimumRelationships');
  end if;

  -- ── the nine classes ─────────────────────────────────────────────────────
  -- 1. missing logic (R1): neither a predecessor nor a successor.
  select count(*) into v_missing
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and not exists (select 1 from shutdown_task_dependencies d
                     where d.event_id = t.event_id and d.task_key = t.task_key)
    and not exists (select 1 from shutdown_task_dependencies d
                     where d.event_id = t.event_id and d.predecessor_key = t.task_key);

  -- 2. open ends (R1): exactly one side missing, minus one legitimate start
  --    and one legitimate finish per schedule (shutdown_event).
  select count(*) into v_open
  from (
    select t.event_id,
           (not exists (select 1 from shutdown_task_dependencies d
                         where d.event_id = t.event_id and d.task_key = t.task_key)) as no_pred,
           (not exists (select 1 from shutdown_task_dependencies d
                         where d.event_id = t.event_id and d.predecessor_key = t.task_key)) as no_succ
      from shutdown_tasks t
      join shutdown_events e on e.id = t.event_id
     where e.organization_id = c.organization_id and e.development_case_id = c.id) s
  where (s.no_pred or s.no_succ) and not (s.no_pred and s.no_succ);
  -- one dangling start and one dangling finish are what every schedule has.
  v_open := greatest(0, v_open - 2 * greatest(1, (
    select count(distinct t.event_id) from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id)));

  -- 3. excessive constraints: the HARD set only.
  select count(*) into v_hard
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.constraint_type in ('mandatory_start','mandatory_finish','start_on','finish_on');

  -- 4. long durations (R2).
  select count(*) into v_long
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.duration_hours > (v_policy->>'longDurationHours')::numeric;

  -- 5. negative float.
  select count(*) into v_negfloat
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.total_float_hours < 0;

  -- 6. unrealistic lags (R5): negative, or beyond the published limit.
  select count(*) filter (where d.lag_hours < 0),
         count(*) filter (where d.lag_hours > (v_policy->>'excessiveLagHours')::numeric)
    into v_neglag, v_biglag
  from shutdown_task_dependencies d
  join shutdown_events e on e.id = d.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id;

  -- 7. critical-path continuity: is there an unbroken chain of critical
  --    activities from a schedule start to a schedule finish? Walked over
  --    the STORED relationships and P6's OWN float — no network is recomputed
  --    here (R4).
  select count(*) into v_critical
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric;

  -- CONTINUITY, DEFINED SO THAT IT CAN FAIL. "Is there a chain of critical
  -- activities?" is answered yes by any single critical activity, which is not
  -- a question worth asking. The chain must run END TO END: from a critical
  -- activity that has NO predecessor at all (a schedule start) to one that has
  -- NO successor at all (a schedule finish). A path that stops short is a date
  -- being driven by something the logic does not connect — the finding.
  --
  -- STATED LIMITATION: the float-carrying activities are walked as ONE
  -- network. A case holding two schedules (a P6 import and Sync's own
  -- activities, which are separate events by design) is continuous if the
  -- chain runs end to end anywhere in that union. Assessing each schedule
  -- separately would need a per-schedule score this row does not define, and
  -- inventing one here would put a number beside §50's name that §50 does not
  -- describe.
  if v_float_present = 0 then
    v_continuous := null;
  else
    with recursive crit as (
      select t.event_id, t.task_key
        from shutdown_tasks t
        join shutdown_events e on e.id = t.event_id
       where e.organization_id = c.organization_id and e.development_case_id = c.id
         and t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric
         and not exists (select 1 from shutdown_task_dependencies d
                          where d.event_id = t.event_id and d.task_key = t.task_key)
      union
      select t.event_id, t.task_key
        from crit
        join shutdown_task_dependencies d
          on d.event_id = crit.event_id and d.predecessor_key = crit.task_key
        join shutdown_tasks t on t.event_id = d.event_id and t.task_key = d.task_key
       where t.total_float_hours <= (v_policy->>'criticalFloatHours')::numeric)
    select exists (
      select 1 from crit
      where not exists (select 1 from shutdown_task_dependencies d
                        where d.event_id = crit.event_id
                          and d.predecessor_key = crit.task_key))
    into v_continuous;
  end if;

  -- 8. excessive concurrency: the largest number of activities in flight at
  --    once, as a share of all of them. Every planned start is a candidate
  --    instant; the peak is always at one of them.
  if v_dated > 0 then
    select coalesce(max(inflight), 0) into v_peak from (
      select (select count(*) from shutdown_tasks t2
              join shutdown_events e2 on e2.id = t2.event_id
              where e2.organization_id = c.organization_id
                and e2.development_case_id = c.id
                and t2.planned_start is not null and t2.planned_finish is not null
                and t2.planned_start <= t.planned_start
                and t2.planned_finish > t.planned_start) as inflight
        from shutdown_tasks t
        join shutdown_events e on e.id = t.event_id
       where e.organization_id = c.organization_id and e.development_case_id = c.id
         and t.planned_start is not null and t.planned_finish is not null) s;
  end if;

  -- 9. unrealistic calendars (R3): duration exceeding its own window, or a
  --    duration exactly filling a window longer than a week (24x7, forever).
  select count(*) into v_calendar
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = c.organization_id and e.development_case_id = c.id
    and t.planned_start is not null and t.planned_finish is not null
    and (
      t.duration_hours > extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0 + 1e-6
      or (extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0 > 168
          and abs(t.duration_hours
                  - extract(epoch from (t.planned_finish - t.planned_start)) / 3600.0) < 1e-6));

  -- ── assemble the classes ─────────────────────────────────────────────────
  -- Each row: what was counted, out of what, against which threshold, and —
  -- when it could not be counted at all — WHY, by name. A class that cannot
  -- be diagnosed never reports "pass".
  v_classes := jsonb_build_array(
    sync_schedule_defect_class('missing_logic', 'Missing logic',
      'Activities with neither a predecessor nor a successor. They float free of the network, so their dates are assertions and no delay anywhere else can reach them.',
      v_missing, v_n, v_n > 0, null, v_policy),
    sync_schedule_defect_class('open_ends', 'Open ends',
      'Activities missing exactly one side of their logic, beyond the one legitimate start and one legitimate finish every schedule has. An activity with no successor cannot push the finish date; one with no predecessor is held by nothing.',
      v_open, v_n, v_rel > 0, case when v_rel = 0 then
        'No relationships are recorded on this case at all, so every activity is an orphan rather than an open end — that is the missing-logic finding above, and reporting it twice would double-count it.' end,
      v_policy),
    sync_schedule_defect_class('excessive_constraints', 'Excessive constraints',
      'Activities carrying a HARD date constraint (mandatory start/finish, start on, finish on). A hard constraint overrides the logic: the network stops explaining the date and starts obeying it.',
      v_hard, v_n, (v_ctype_present > 0 or v_imported = 0),
      case when v_ctype_present = 0 and v_imported > 0 then
        format('None of the %s imported activity(ies) carries a constraint type, and this import cannot tell "this schedule has no constraints" from "the export did not include the constraint column". Re-export with constraint_type and this class becomes answerable.', v_imported) end,
      v_policy),
    sync_schedule_defect_class('long_durations', 'Long-duration activities',
      format('Activities longer than %s elapsed hours (44 calendar days). A duration that long is a summary of work nobody has planned, and it cannot be progressed or resourced honestly.',
             v_policy->>'longDurationHours'),
      v_long, v_n, v_n > 0, null, v_policy),
    sync_schedule_defect_class('negative_float', 'Negative float',
      'Activities P6 computed as already late against their own constraints. Negative float is not a warning about the future; it is a statement that the plan is arithmetically impossible as written.',
      v_negfloat, v_n, v_float_present > 0,
      case when v_float_present = 0 then
        'No activity on this case carries a total float. Float is P6''s own computation and Sync imports it rather than recomputing the network (a second critical path beside the modelling kernel''s would be two answers to one question). Re-export with total_float_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('unrealistic_lags', 'Unrealistic lags',
      format('Relationships with a negative lag (a successor pulled back inside its predecessor) or a lag beyond %s hours (a duration hiding in a relationship nobody resourced).',
             v_policy->>'excessiveLagHours'),
      v_neglag + v_biglag, greatest(v_rel, 1), (v_lag_present > 0 or (v_rel > 0 and v_imported = 0)),
      case when v_rel = 0 then 'No relationships are recorded, so there are no lags to assess.'
           when v_lag_present = 0 and v_imported > 0 then
        'No relationship on this case carries a lag, and this import cannot tell "every link is zero-lag" from "the export did not include the lag column". Re-export the relationships with lag_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('broken_critical_path', 'Broken critical path',
      'Whether an unbroken chain of critical activities runs from a schedule start to a schedule finish. A critical path with a hole in it means the date is being driven by something the logic does not connect.',
      case when v_continuous is null then 0 when v_continuous then 0 else 1 end,
      1, v_continuous is not null,
      case when v_float_present = 0 then
        'Continuity is walked over P6''s own float, and no activity on this case carries one. Re-export with total_float_hours and this class becomes answerable.' end,
      v_policy),
    sync_schedule_defect_class('excessive_concurrency', 'Excessive concurrency',
      'The largest number of activities planned to be in flight at the same instant, as a share of the schedule. A plan where a third of the work happens at once is a plan nobody has resourced.',
      v_peak, greatest(v_n, 1), v_dated > 0,
      case when v_dated = 0 then
        'No activity on this case carries both a planned start and a planned finish, so nothing can be said about what overlaps what.' end,
      v_policy),
    sync_schedule_defect_class('unrealistic_calendars', 'Unrealistic calendars',
      'Activities whose duration exceeds their own planned window (impossible under any calendar) or exactly fills a window longer than a week (a 24x7 calendar asserted across more than seven days). A calendar cannot be judged from its NAME, so it is judged from the arithmetic it implies.',
      v_calendar, greatest(v_dated, 1), v_dated > 0,
      case when v_dated = 0 then
        'No activity on this case carries both a planned start and a planned finish, so the arithmetic a calendar implies cannot be checked. The calendar NAME is recorded and is not evidence — "5x8" tells this database nothing it can verify.' end,
      v_policy));

  -- ── §50: the score over the six named components ─────────────────────────
  for rec in
    select value->>'key' as key,
           (value->>'diagnosable')::boolean as diagnosable,
           (value->>'componentScore')::numeric as component_score
      from jsonb_array_elements(v_classes)
  loop
    if rec.key in ('missing_logic','open_ends','excessive_constraints',
                   'long_durations','broken_critical_path','unrealistic_calendars') then
      if rec.diagnosable then
        v_diagnosable := v_diagnosable + 1;
        v_weight_used := v_weight_used + (v_policy->'scoreWeights'->>(
          case rec.key
            when 'missing_logic' then 'logic_completeness'
            when 'open_ends' then 'open_ends'
            when 'excessive_constraints' then 'constraints'
            when 'long_durations' then 'duration_quality'
            when 'broken_critical_path' then 'critical_path_continuity'
            else 'calendar_consistency' end))::numeric;
        v_weighted := v_weighted + rec.component_score * (v_policy->'scoreWeights'->>(
          case rec.key
            when 'missing_logic' then 'logic_completeness'
            when 'open_ends' then 'open_ends'
            when 'excessive_constraints' then 'constraints'
            when 'long_durations' then 'duration_quality'
            when 'broken_critical_path' then 'critical_path_continuity'
            else 'calendar_consistency' end))::numeric;
      else
        v_gate_blind := v_gate_blind || rec.key;
      end if;
    elsif not rec.diagnosable then
      v_gate_blind := v_gate_blind || rec.key;
    end if;
  end loop;

  if v_refusal is null and v_diagnosable < (v_policy->>'minimumDiagnosableComponents')::int then
    v_refusal := format(
      'Only %s of §50''s six components could be diagnosed on this schedule (%s). The published minimum is %s. A number computed over two components and called a "Schedule Quality Score" overstates itself by four, and it is the number that decides whether a Monte Carlo may run — so it is refused rather than scaled up from what happens to be available.',
      v_diagnosable,
      array_to_string(v_gate_blind, ', '),
      v_policy->>'minimumDiagnosableComponents');
  end if;

  if v_refusal is null and v_weight_used > 0 then
    v_score := round(v_weighted / v_weight_used, 1);
  end if;

  -- ── D5.14: confidence, which is a different question ─────────────────────
  v_range_share := case when v_n > 0 then v_ranged::numeric / v_n else 0 end;
  v_wbs_share := case when v_n > 0 then v_wbs::numeric / v_n else 0 end;
  -- One accepted load is a snapshot with no track record; the credit is
  -- capped at three loads, past which "it has been maintained" is established
  -- and more loads say nothing further.
  v_history := least(1.0, greatest(0, v_imports - 1)::numeric / 2.0);

  v_components := jsonb_build_object(
    'structure', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'structure')::numeric,
      'value', v_score,
      'basis', 'The §50 Schedule Quality Score. A schedule that is not built correctly cannot be relied on however much history it has.'),
    'uncertaintyExpressed', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'uncertainty_expressed')::numeric,
      'value', round(v_range_share * 100, 1),
      'basis', format('%s of %s activity(ies) carry an optimistic AND pessimistic duration. A single-point duration expresses a certainty the estimate does not have, and a schedule made entirely of them cannot state its own uncertainty at all.', v_ranged, v_n)),
    'importHistory', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'import_history')::numeric,
      'value', round(v_history * 100, 1),
      'basis', format('%s accepted import run(s) have landed activities on this case. One load is a snapshot; a schedule nobody has re-issued has no track record of being maintained.', v_imports)),
    'scopeAnchoring', jsonb_build_object(
      'weight', (v_policy->'confidenceWeights'->>'scope_anchoring')::numeric,
      'value', round(v_wbs_share * 100, 1),
      'basis', format('%s of %s activity(ies) resolve to a WBS element. An activity coded to no authorized scope is work the schedule believes in and the scope baseline has never heard of.', v_wbs, v_n)));

  if v_score is not null then
    v_confidence := round(
      (v_score * (v_policy->'confidenceWeights'->>'structure')::numeric
       + v_range_share * 100 * (v_policy->'confidenceWeights'->>'uncertainty_expressed')::numeric
       + v_history * 100 * (v_policy->'confidenceWeights'->>'import_history')::numeric
       + v_wbs_share * 100 * (v_policy->'confidenceWeights'->>'scope_anchoring')::numeric)
      / 100.0, 1);
  end if;

  -- ── the gate verdict (consumed by D5.15) ─────────────────────────────────
  select coalesce(array_agg(value->>'key' order by value->>'key'), '{}'::text[])
    into v_gate_fail
    from jsonb_array_elements(v_classes)
   where value->>'severity' = 'fail';

  return jsonb_build_object(
    'caseId', c.id,
    'activityCount', v_n,
    'importedCount', v_imported,
    'localCount', v_local,
    'relationshipCount', v_rel,
    'activitiesWithPlannedDates', v_dated,
    'activitiesWithDurationRange', v_ranged,
    'activitiesWithWbs', v_wbs,
    'activitiesWithFloat', v_float_present,
    'criticalActivityCount', v_critical,
    'acceptedImportRuns', v_imports,
    'classes', v_classes,
    'score', v_score,
    'scoreRefusal', v_refusal,
    'diagnosableComponents', v_diagnosable,
    'notDiagnosable', to_jsonb(v_gate_blind),
    'confidence', v_confidence,
    'confidenceComponents', v_components,
    'confidenceRefusal', case when v_score is null then
      'Schedule confidence is refused because the §50 quality score is refused, and structure is the largest of its four components. A confidence rating built on an unscored schedule would be a second number carrying the first number''s problem while looking like an independent opinion.' end,
    'policy', v_policy,
    'gate', jsonb_build_object(
      'permitted', (v_score is not null
                    and v_score >= (v_policy->>'minimumScoreToSimulate')::numeric
                    and coalesce(array_length(v_gate_fail, 1), 0) = 0),
      'failingClasses', to_jsonb(v_gate_fail),
      'notDiagnosableClasses', to_jsonb(v_gate_blind),
      'minimumScore', (v_policy->>'minimumScoreToSimulate')::numeric,
      'refusal', case
        when v_score is null then v_refusal
        when coalesce(array_length(v_gate_fail, 1), 0) > 0 then format(
          'A Monte Carlo will not run on this schedule. %s defect class(es) are over their published threshold: %s. Spec II.6 is explicit that "Monte Carlo on poor logic is not useful" — a simulation over a network with these defects would produce a distribution with the authority of arithmetic and the content of the defects, and the P80 it printed would be read as a forecast.',
          array_length(v_gate_fail, 1), array_to_string(v_gate_fail, ', '))
        when v_score < (v_policy->>'minimumScoreToSimulate')::numeric then format(
          'A Monte Carlo will not run on this schedule. The §50 Schedule Quality Score is %s against a published minimum of %s. No individual class is over its own threshold; the schedule fails on the composite, which is what the composite is for.',
          v_score, v_policy->>'minimumScoreToSimulate')
        end),
    'evaluable', v_n > 0);
end
$$;

revoke all on function public.get_case_schedule_quality(uuid) from public, anon, service_role;
grant execute on function public.get_case_schedule_quality(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. THE RECORDING ACT (D11.29). Same predicate as the read, plus the run.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_schedule_quality(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_q jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'diagnosing a schedule requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_q := get_case_schedule_quality(c.id);
  if v_q ? 'error' then
    return v_q;
  end if;

  -- Every blind class and every failing class is a refusal ON THE RECORD, so
  -- a score computed over four components is distinguishable in the ledger
  -- from one computed over six.
  for rec in select value as cls from jsonb_array_elements(v_q->'classes') loop
    if (rec.cls->>'diagnosable')::boolean is not true then
      v_refusals := v_refusals || to_jsonb(format('%s: %s',
        rec.cls->>'label', coalesce(rec.cls->>'notDiagnosableReason', 'not diagnosable'))::text);
    elsif rec.cls->>'severity' = 'fail' then
      v_refusals := v_refusals || to_jsonb(format('%s is over its published threshold (%s of %s, threshold %s).',
        rec.cls->>'label', rec.cls->>'count', rec.cls->>'denominator', rec.cls->>'failThreshold')::text);
    end if;
  end loop;

  if v_q->>'scoreRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_q->>'scoreRefusal');
  end if;
  if v_q->>'confidenceRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_q->>'confidenceRefusal');
  end if;

  if v_q->'score' is null or v_q->>'score' is null then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'score', v_q->'score',
      'confidence', v_q->'confidence',
      'diagnosableComponents', v_q->'diagnosableComponents',
      'activityCount', v_q->'activityCount',
      'relationshipCount', v_q->'relationshipCount',
      'gatePermitted', v_q->'gate'->'permitted',
      'failingClasses', v_q->'gate'->'failingClasses',
      'classSeverities', (select jsonb_object_agg(value->>'key', value->>'severity')
                            from jsonb_array_elements(v_q->'classes')));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_schedule_quality',
    'The nine II.6 schedule defect classes diagnosed over this case''s schedule activities and their relationships, and the §50 Schedule Quality Score composed from the six components §50 names, with published weights. Classes that could not be diagnosed from the imported data are recorded as refusals and contribute no weight; the score is refused outright below the published sparsity floor or below four diagnosable components. The Schedule Confidence Score composes structure, expressed uncertainty, import history and scope anchoring, and is refused whenever the quality score is.',
    jsonb_build_object(
      'activityCount', v_q->'activityCount',
      'relationshipCount', v_q->'relationshipCount',
      'activitiesWithFloat', v_q->'activitiesWithFloat',
      'activitiesWithPlannedDates', v_q->'activitiesWithPlannedDates',
      'activitiesWithDurationRange', v_q->'activitiesWithDurationRange',
      'activitiesWithWbs', v_q->'activitiesWithWbs',
      'acceptedImportRuns', v_q->'acceptedImportRuns',
      'policyDigest', md5(sync_schedule_quality_policy()::text)),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'shutdown_tasks', 'id', t.id))
                from shutdown_tasks t
                join shutdown_events e on e.id = t.event_id
               where e.organization_id = c.organization_id
                 and e.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_q || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_schedule_quality'));
end
$$;

revoke all on function public.compute_case_schedule_quality(uuid) from public, anon, service_role;
grant execute on function public.compute_case_schedule_quality(uuid) to authenticated;

notify pgrst, 'reload schema';
