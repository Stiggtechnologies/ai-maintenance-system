-- ============================================================================
-- Sync Develop Slice 5D — the Change Impact Agent (D12.10, spec III.§60).
--
-- §60: "Change Impact Agent (graph traversal: changing pump P-102 affects
-- power study, foundation, P&ID, HAZOP, BOM, PM, spares, commissioning)."
--
-- ── RULING 5D-R8 — ONE GRAPH, ONE PREDICATE, AND THIS FILE ADDS NEITHER ──
--
-- Slice 5C built the traversal: `get_case_thread_impact` walks live hops
-- downstream over `thread_links`, and REFUSES (5C-R15) when the region it
-- walked has a chain skip, an object with no authoritative revision, a severed
-- hop out of the region, a retired object in the path, a backward hop or the
-- depth cap. There is no second traversal in this file, no second graph and no
-- second refusal predicate. `record_change_impact_report` CALLS 5C's function
-- and stores what it returned, verbatim.
--
-- The register has found a second implementation of a shared predicate in
-- nearly every chunk of this program, and each time the two answers diverged
-- in the direction that read better. So the shape here is the one Slice 3D
-- fixed for the Gate Agent and 5A repeated for the Requirements Agent: THE
-- RECORDING RPC RE-READS THE DETERMINISTIC ANSWER ITSELF. The caller supplies
-- narrative and candidate consequences; it cannot supply a count, an affected
-- object or a refusal, because none of those is a parameter.
--
-- ── RULING 5D-R9 — A REFUSAL IS AN ANSWER AND IT GETS A DATED RECORD ─────
--
-- The obvious design refuses to record a report when the traversal refuses.
-- That is wrong in the direction this whole program corrects: the case where
-- somebody asked "what does this change touch" and the product could not say
-- is EXACTLY the case that needs a dated record, because it is the one that
-- gets asked again in three weeks with everybody remembering it differently.
-- So a refused traversal produces a report whose `refused` is true, whose
-- `downstream_count` is NULL (never the reachable count — 5C's rule, carried
-- through), and whose gaps are stored verbatim.
--
-- And the MODEL IS NOT ASKED on a refusal. There is nothing to narrate except
-- a set the product has just said is a floor, and a narrative over a floor is
-- how "0 downstream impacts" gets written by another route.
--
-- ── RULING 5D-R10 — THE AGENT PROPOSES; IT HAS NO PATH TO ANY DISPOSITION ─
--
-- Not a promise — an absence plus five refusals it composes with:
--
--   * change_impact_reports has NO column that can hold an acknowledgement, a
--     status, an approval or a disposition. `advisory` is pinned true by a
--     CHECK so a later migration adding one has to argue with this constraint
--     first (the gate_agent_reports / requirement_agent_reports idiom).
--   * acknowledge_thread_receipt refuses 'ai_admin' BY NAME (20261206090300)
--     — the agent cannot record that a downstream package received a change.
--   * declare_thread_version_authoritative, sever_thread_link,
--     retire_thread_object and reanchor_thread_object all refuse that identity
--     at their door AND at a wall bound to the object's actor column, for
--     every writer including the service key (20261206090100/090200).
--   * answer_develop_event_consequence refuses it by name (20261207090000) —
--     the agent cannot clear the gate blocker its own reading might justify.
--   * The AI-generated half of a report is stored with `source` written as
--     'ai_suggestion' from a SQL literal and `severity` fixed at 'attention',
--     so a model cannot label its own guess deterministic or make it blocking.
--
-- ── RULING 5D-R11 — A CONSEQUENCE MUST NAME AN OBJECT THE WALK REACHED ──
--
-- A model consequence citing an object outside the traversal's affected set is
-- DROPPED and REPORTED, never mapped onto the nearest match. Mapping
-- 'S5D-DR1' onto 'S5D-DR10' inside a change-impact record is a silent guess
-- about which drawing is affected, and this repository already refuses that
-- shape for framework proposals and requirement inconsistencies.
--
-- Canonical reuse: get_case_thread_impact (THE traversal), thread_objects,
-- development_cases, audit_events, security_events, app_current_org().
-- ============================================================================

create table if not exists public.change_impact_reports (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  thread_object_id bigint not null references thread_objects(id) on delete cascade,
  -- Snapshotted so the report still states its own subject after the object
  -- has moved on. Legibility, not authority.
  object_ref text not null check (btrim(object_ref) <> ''),
  object_kind text not null check (btrim(object_kind) <> ''),
  -- 5C's answer, WHOLE. The narrative can be audited against exactly what it
  -- was written over.
  impact jsonb not null check (jsonb_typeof(impact) = 'object'),
  refused boolean not null,
  -- NULL whenever the traversal refused (5C-R15, carried through). A count
  -- printed beside a refusal is how a refusal gets read as an answer with a
  -- caveat.
  downstream_count int check (downstream_count is null or downstream_count >= 0),
  reached_count int not null default 0 check (reached_count >= 0),
  gap_count int not null default 0 check (gap_count >= 0),
  narrative text check (narrative is null or length(narrative) <= 6000),
  -- BOUNDED like the narrative beside it (the sibling requirement-agent table
  -- has `..._model_bounded` and this one dropped it). Rendered on screen,
  -- immutable, org-readable, undeletable.
  model text check (model is null or length(model) <= 200),
  -- Model-sourced candidate consequences. Every element carries
  -- source='ai_suggestion' and severity='attention', both SQL literals.
  ai_consequences jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ai_consequences) = 'array'),
  agent_key text not null default 'sync-develop-change-impact'
    check (btrim(agent_key) <> ''),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- THE COLUMNS THAT ARE NOT HERE. No acknowledgement, no status, no
  -- disposition, no approval.
  advisory boolean not null default true,
  constraint change_impact_report_is_advisory check (advisory),
  -- A refusal has no count; an answer has one. Neither half-recorded.
  constraint change_impact_report_refusal_has_no_count
    check ((downstream_count is null) = refused)
);

-- Idempotent for a database where the table already exists from an earlier
-- run (`create table if not exists` skips column CHECKs).
do $bounded$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.change_impact_reports'::regclass
                   and conname = 'change_impact_report_narrative_bounded') then
    alter table public.change_impact_reports
      add constraint change_impact_report_narrative_bounded
      check (narrative is null or length(narrative) <= 6000);
  end if;
end
$bounded$;

create index if not exists idx_change_impact_reports_case
  on change_impact_reports(organization_id, development_case_id, created_at desc);

alter table public.change_impact_reports enable row level security;
drop policy if exists change_impact_reports_read on public.change_impact_reports;
create policy change_impact_reports_read on public.change_impact_reports
  for select to authenticated using (organization_id = app_current_org());

comment on table public.change_impact_reports is
  'D12.10 / spec III.§60: a dated reading of what a change to one thread object touches. The impact column is get_case_thread_impact''s answer VERBATIM — this table stores 5C''s traversal, it does not compute one (ruling 5D-R8). No column here can hold a disposition.';

-- ---------------------------------------------------------------------------
-- Provenance backstop — INSERT / UPDATE / DELETE / TRUNCATE.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_change_impact_report_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.change_impact_report_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'change_impact_reports is the dated record of what the agent said a change would touch, and of every time it refused to say. Truncating it erases all of them in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A change-impact report is a dated reading of the traversal. It is not deleted — a reading that refused is exactly the one somebody will want to find.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'A change-impact report is immutable. Run the agent again — a second reading dated now is honest; an edited one dated then is not.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'A change-impact report cannot be written directly: record_change_impact_report is the path, and it takes the affected set, the count and the refusal from get_case_thread_impact rather than from its caller.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_change_impact_report_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_change_impact_report_provenance on public.change_impact_reports;
create trigger trg_change_impact_report_provenance
  before insert or update or delete on public.change_impact_reports
  for each row execute function public.enforce_change_impact_report_provenance();

drop trigger if exists trg_change_impact_report_no_truncate on public.change_impact_reports;
create trigger trg_change_impact_report_no_truncate
  before truncate on public.change_impact_reports
  for each statement execute function public.enforce_change_impact_report_provenance();

revoke truncate on table public.change_impact_reports from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_change_impact_report — the agent's ONLY write.
-- ---------------------------------------------------------------------------
create or replace function public.record_change_impact_report(
  p_case_id uuid,
  p_object_id bigint,
  p_narrative text default null,
  p_model text default null,
  p_ai_consequences jsonb default '[]'::jsonb
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
  o thread_objects%rowtype;
  v_impact jsonb;
  v_refused boolean;
  v_known text[];
  v_clean jsonb := '[]'::jsonb;
  v_dropped jsonb := '[]'::jsonb;
  v_row jsonb;
  v_ref text;
  v_concern text;
  v_narrative text;
  v_model text;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- The AI-operator identity is ADMITTED here. This is the act §60 describes,
  -- and it is the only door in this slice that admits it.
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician','ai_admin') then
    return jsonb_build_object('error', 'recording a change-impact report requires a role on this project');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into o from thread_objects
   where id = p_object_id and organization_id = v_org and development_case_id = c.id;
  if not found then
    return jsonb_build_object('error', 'that thread object is not on this case');
  end if;
  if p_narrative is not null and length(p_narrative) > 6000 then
    return jsonb_build_object('error',
      'the narrative is longer than 6000 characters; the row is immutable and org-readable, so it is refused rather than silently truncated');
  end if;
  if p_model is not null and length(btrim(p_model)) > 200 then
    return jsonb_build_object('error',
      'the model identifier is longer than 200 characters. It is rendered beside the reading as the thing that produced it, and the row is immutable and undeletable — so an unbounded string is refused here rather than made permanent.');
  end if;

  v_narrative := nullif(btrim(coalesce(p_narrative, '')), '');
  v_model := nullif(btrim(coalesce(p_model, '')), '');

  -- RULING 5D-R8. THE ONE TRAVERSAL. Not a parameter, not recomputed here.
  v_impact := get_case_thread_impact(c.id, o.id);
  if v_impact ? 'error' then
    return jsonb_build_object('error', v_impact ->> 'error');
  end if;
  v_refused := coalesce((v_impact ->> 'refused')::boolean, true);

  -- RULING 5D-R11. Only objects the walk actually reached.
  select coalesce(array_agg(a ->> 'objectRef'), '{}'::text[]) into v_known
    from jsonb_array_elements(coalesce(v_impact -> 'affected', '[]'::jsonb)) a;

  for v_row in select * from jsonb_array_elements(coalesce(p_ai_consequences, '[]'::jsonb))
  loop
    v_ref := v_row ->> 'objectRef';
    v_concern := v_row ->> 'consequence';
    if v_ref is null or not (v_ref = any (v_known)) then
      v_dropped := v_dropped || to_jsonb(format(
        '"%s" — not an object this traversal reached; dropped rather than matched to the nearest reference',
        coalesce(v_ref, '(none)')));
    elsif v_concern is null or length(btrim(v_concern)) < 20 then
      v_dropped := v_dropped || to_jsonb(format(
        '"%s" — the stated consequence is under 20 characters; a consequence that does not say what happens is not a consequence', v_ref));
    else
      v_clean := v_clean || jsonb_build_object(
        'objectRef', v_ref,
        'consequence', left(btrim(v_concern), 1000),
        -- SQL LITERALS. The payload's own source and severity, if it carries
        -- them, are never read: a model does not label its own output
        -- deterministic and does not mark its own guess blocking.
        'source', 'ai_suggestion',
        'severity', 'attention');
    end if;
  end loop;

  -- A REFUSED TRAVERSAL CARRIES NO MODEL OUTPUT AT ALL (ruling 5D-R9). The
  -- affected set is a floor, so a consequence attached to a member of it is a
  -- statement about a set the product has just declined to state.
  if v_refused and jsonb_array_length(v_clean) > 0 then
    v_dropped := v_dropped || to_jsonb(
      'every model consequence was dropped: this traversal REFUSED, so the objects it reached are a floor and not the affected set — attaching consequences to them would present the floor as the answer'::text);
    v_clean := '[]'::jsonb;
  end if;
  -- AND NOR DOES IT CARRY A NARRATIVE. The consequence path was guarded and
  -- the prose beside it was not: the edge function does not ask a model over a
  -- refused walk, but the RPC accepted `p_narrative` and `p_model`
  -- unconditionally, so a direct caller holding the ai_admin role this door
  -- admits could record `refused = true` alongside a paragraph describing the
  -- floor as the answer — in an immutable, org-readable row. Narrating a
  -- refusal is how "0 downstream impacts" arrives by another route, which is
  -- the one thing 5D-R9 exists to stop.
  if v_refused and (v_narrative is not null or v_model is not null) then
    v_dropped := v_dropped || to_jsonb(
      'the narrative and the model label were dropped: this traversal REFUSED, and prose recorded beside a refusal is read as the answer the refusal declined to give'::text);
    v_narrative := null;
    v_model := null;
  end if;

  perform set_config('app.change_impact_report_write', 'granted', true);
  insert into change_impact_reports
    (organization_id, development_case_id, thread_object_id, object_ref, object_kind,
     impact, refused, downstream_count, reached_count, gap_count,
     narrative, model, ai_consequences, requested_by)
  values
    (v_org, c.id, o.id, o.object_ref, o.object_kind,
     v_impact, v_refused,
     case when v_refused then null else (v_impact ->> 'downstreamCount')::int end,
     coalesce((v_impact ->> 'reachedCount')::int, 0),
     jsonb_array_length(coalesce(v_impact -> 'gaps', '[]'::jsonb)),
     v_narrative, v_model,
     v_clean, auth.uid())
  returning id into v_id;
  perform set_config('app.change_impact_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'change_impact_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'report_id', v_id,
      'object_id', o.id, 'object_ref', o.object_ref,
      'refused', v_refused, 'model', v_model),
    null,
    jsonb_build_object('refused', v_refused,
      'downstreamCount', case when v_refused then null else (v_impact ->> 'downstreamCount')::int end,
      'gapCount', jsonb_array_length(coalesce(v_impact -> 'gaps', '[]'::jsonb)),
      'aiConsequences', jsonb_array_length(v_clean)));

  return jsonb_build_object(
    'report_id', v_id,
    'objectRef', o.object_ref,
    'refused', v_refused,
    'downstreamCount', case when v_refused then null else (v_impact ->> 'downstreamCount')::int end,
    'reachedCount', coalesce((v_impact ->> 'reachedCount')::int, 0),
    'gapCount', jsonb_array_length(coalesce(v_impact -> 'gaps', '[]'::jsonb)),
    'aiConsequences', v_clean,
    'dropped', v_dropped,
    'advisory', true,
    'note', case when v_refused
      then 'Recorded as a REFUSAL with the gaps named. The count is null on purpose: the objects the walk reached are a floor, and this report says so rather than printing the floor as an answer.'
      else 'Recorded. This agent changed nothing: it cannot acknowledge a receipt, declare a revision, sever a hop, retire an object or answer an event consequence — every one of those refuses this identity by name and at a wall.' end);
end
$$;

revoke all on function public.record_change_impact_report(uuid, bigint, text, text, jsonb) from public, anon;
grant execute on function public.record_change_impact_report(uuid, bigint, text, text, jsonb)
  to authenticated, service_role;

comment on function public.record_change_impact_report(uuid, bigint, text, text, jsonb) is
  'D12.10 / spec III.§60 ruling 5D-R8: records a change-impact reading by CALLING get_case_thread_impact — Slice 5C''s ONE traversal — and storing its answer verbatim. The caller supplies narrative and candidate consequences only; the count, the affected set and the refusal are not parameters. Model consequences are dropped unless they name an object the walk reached, carry source=''ai_suggestion'' and severity=''attention'' as SQL literals, and are dropped entirely when the traversal refused (5D-R9/R11).';

-- ---------------------------------------------------------------------------
-- The reports, per case.
-- ---------------------------------------------------------------------------
create or replace function public.get_change_impact_reports(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_reports jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'asAt', r.created_at,
      'objectId', r.thread_object_id,
      'objectRef', r.object_ref,
      'objectKind', r.object_kind,
      'refused', r.refused,
      'downstreamCount', r.downstream_count,
      'reachedCount', r.reached_count,
      'gapCount', r.gap_count,
      'impact', r.impact,
      'narrative', r.narrative,
      'model', r.model,
      'aiConsequences', r.ai_consequences,
      'agentKey', r.agent_key,
      'advisory', r.advisory,
      'requestedBy', u.full_name)
      order by r.created_at desc, r.id desc), '[]'::jsonb)
    into v_reports
    from change_impact_reports r
    left join user_profiles u on u.id = r.requested_by
   where r.organization_id = v_org and r.development_case_id = c.id;
  return jsonb_build_object('caseId', c.id, 'reports', v_reports);
end
$$;

revoke all on function public.get_change_impact_reports(uuid) from public, anon;
grant execute on function public.get_change_impact_reports(uuid) to authenticated, service_role;

comment on function public.get_change_impact_reports(uuid) is
  'D12.10: the dated change-impact readings on a case, refusals included — a reading that refused is the one somebody will want to find again.';
