-- ============================================================================
-- Sync Develop Slice 5B — six-axis design scoring (D4.12, spec I.26).
--
-- I.26 verbatim: "Constructability and Operability scoring. Formalize: Design
-- Readiness, Constructability, Operability, Maintainability, Reliability,
-- Commissionability. A design can be technically correct and score poorly on
-- any of these."
--
-- WHAT EXISTED. Four of the six appear as `design_studies` KINDS
-- (maintainability_review, access_and_lifting, removal_route,
-- instrumentation_review) — i.e. as evidence that somebody looked, not as a
-- score. `allocateAvailability` (src/lib/design/index.ts:65) is the refusal
-- idiom this file follows: it REFUSES a target no allocation can reach rather
-- than presenting an average that hides the shortfall.
--
-- ── RULING 1 — THE COMPOSITE REFUSES; IT NEVER AVERAGES WHAT IT HAS ───────
--
-- A design scored 4/5 on five axes and never scored on commissionability does
-- NOT score 4.0. It scores NOTHING, and the answer names commissionability.
-- Averaging the five would produce a number that is higher than the truth
-- exactly when the unscored axis is the bad one — which is the usual case,
-- because the axis nobody scored is the axis nobody owns. This is
-- allocateAvailability's rule ("feasibility is UNKNOWN rather than met")
-- applied to a scorecard, and it is enforced server-side so a screen cannot
-- soften it.
--
-- ── RULING 2 — ONE COMPOSITE, COMPUTED SERVER-SIDE ───────────────────────
--
-- The mean and the refusal are computed HERE, once. The TypeScript side
-- (src/lib/design/index.ts) carries the axis vocabulary and a client-side
-- BACKSTOP that refuses to present a composite arriving alongside a non-empty
-- missing-axis list; it does not recompute the mean. Two implementations of
-- one predicate is how a screen and a lineage record end up disagreeing about
-- what a design scored — the rule 20261204090000 states for the
-- requirement→WBS question, applied to arithmetic. The migration test pins the
-- two vocabularies together so they cannot drift.
--
-- ── RULING 3 — THE SCALE, STATED BECAUSE THE SPEC DOES NOT ───────────────
--
-- I.26 names six axes and no scale. RULING: an integer 1–5, where 1 is "this
-- will not work as drawn" and 5 is "nothing further is needed", with a
-- MANDATORY basis on every score. A finer scale would imply a precision a
-- human judgement does not have; a scale with no basis attached would be a
-- number with nothing behind it, which is the thing this register's standing
-- constraint 3 forbids. The scale is named server-side
-- (sync_design_axis_scale) so the CHECK, the door, the read and the screen
-- cannot drift.
--
-- ── RULING 4 — APPEND-ONLY, LATEST WINS ─────────────────────────────────
--
-- A design is re-scored as it matures; that is the point of Design Readiness
-- as an axis. So scores are appended and the LATEST per axis is the current
-- one. Earlier scores stay visible: a constructability score that went 2 → 4
-- the week before a sanction gate is a fact somebody should be able to see,
-- and it is unrecoverable if the row is overwritten.
--
-- ── RULING 5 — §70, AND WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────
--
-- Scoring a design is a human judgement: the AI-operator identity is refused
-- at the door and at the wall (reusing 20261205090000's
-- enforce_frontline_judgement_is_human — one function, not a fifth copy).
--
-- AND: this file gives the scorecard NO gate consequence. Deciding that a
-- composite below some number blocks a gate would be inventing a governance
-- threshold the specification does not state, inside a slice whose job is to
-- make the score exist. Thresholds are the governance-intensity family's act
-- (D3.16 / composite authority rules, 20261121090400). The register row says
-- so rather than implying a refusal this code does not make.
--
-- Canonical reuse: development_cases, design_studies, calculation_runs +
-- record_calculation_run (D11.29 — every calculation records a run, including
-- a refusal), audit_events, enforce_frontline_judgement_is_human.
-- ============================================================================

create or replace function public.sync_design_axes()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'design_readiness', 'constructability', 'operability',
    'maintainability', 'reliability', 'commissionability']::text[];
$$;

comment on function public.sync_design_axes() is
  'D4.12 / spec I.26: the six design axes, VERBATIM from the specification and in its order. Named once so the CHECK, the write path, the composite and the screen cannot drift apart.';

create or replace function public.sync_design_axis_scale()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'min', 1, 'max', 5,
    'anchors', jsonb_build_object(
      '1', 'will not work as drawn',
      '2', 'workable only with significant rework',
      '3', 'workable with known compromises',
      '4', 'sound, with minor issues named',
      '5', 'nothing further is needed'));
$$;

comment on function public.sync_design_axis_scale() is
  'D4.12 ruling 3: the 1–5 scale the specification does not state, named server-side with its anchors. A finer scale would imply a precision a human judgement does not have.';

revoke all on function public.sync_design_axes() from public, anon;
revoke all on function public.sync_design_axis_scale() from public, anon;
grant execute on function public.sync_design_axes() to authenticated, service_role;
grant execute on function public.sync_design_axis_scale() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The score object.
-- ---------------------------------------------------------------------------
create table if not exists public.design_axis_scores (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- The review this score came out of, where it came out of one. Nullable: a
  -- design authority scores readiness without holding a frontline review, and
  -- pretending otherwise would push people to invent a study row.
  study_id bigint references design_studies(id) on delete set null,
  axis text not null check (axis = any (sync_design_axes())),
  score_no int not null check (score_no > 0),
  score int not null check (score between 1 and 5),
  -- Ruling 3. A score with nothing behind it is a number, not a judgement.
  basis text not null check (length(btrim(basis)) >= 20),
  scored_by uuid not null references auth.users(id),
  scored_at timestamptz not null default now(),
  unique (development_case_id, axis, score_no)
);

create index if not exists idx_axis_score_case
  on design_axis_scores(organization_id, development_case_id, axis, score_no desc);

alter table public.design_axis_scores enable row level security;
drop policy if exists design_axis_scores_read on public.design_axis_scores;
create policy design_axis_scores_read on public.design_axis_scores
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: scores are recorded through the definer RPC only.

comment on table public.design_axis_scores is
  'D4.12 / spec I.26: a human score on one of the six design axes, on the 1–5 scale, with a mandatory basis. Append-only, latest per axis wins; the composite REFUSES while any axis is unscored rather than averaging the ones that are.';

drop trigger if exists trg_axis_scorer_is_human on public.design_axis_scores;
create trigger trg_axis_scorer_is_human
  before insert or update on public.design_axis_scores
  for each row execute function public.enforce_frontline_judgement_is_human(
    'scored_by', 'score a design');

create or replace function public.enforce_axis_score_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
  s design_studies%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'design_axis_scores records what this design scored and who said so. Truncating it erases every judgement in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    raise exception
      'A design score is not deleted. A judgement that has been overtaken is SUPERSEDED by a later score on the same axis, which is recorded beside it — deleting one makes a design that scored 2 and was re-scored indistinguishable from a design that always scored 4.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if new.axis is distinct from old.axis
       or new.score is distinct from old.score
       or new.basis is distinct from old.basis
       or new.score_no is distinct from old.score_no
       or new.scored_by is distinct from old.scored_by
       or new.development_case_id is distinct from old.development_case_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'A recorded design score cannot be rewritten by ANY caller, service paths included. Record a NEW score on the same axis; the earlier one stays visible beside it.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- INSERT. Tenancy the FKs cannot police.
  select * into c from development_cases where id = new.development_case_id;
  if not found or c.organization_id <> new.organization_id then
    raise exception
      'That development case belongs to another organization. A design is scored inside its own tenant.'
      using errcode = 'check_violation';
  end if;
  -- 5B-R4. The SCORER is a member of this tenant. Without this the §70 wall is
  -- string equality against a `user_profiles` row that need not exist, so an
  -- identity with no profile at all — the shape of an unprovisioned system
  -- account — scored a design, and a member of another tenant scored one and
  -- was then rendered onto this tenant's scorecard by the read's name join.
  if not exists (select 1 from user_profiles u
                  where u.id = new.scored_by
                    and u.organization_id = new.organization_id) then
    raise exception
      'Whoever scores a design must be a member of this organization. A score is a named human judgement (spec I.26); an identity this tenant has no profile for is not a name it can ask.'
      using errcode = 'check_violation';
  end if;
  if new.study_id is not null then
    select * into s from design_studies where id = new.study_id;
    if not found or s.organization_id <> new.organization_id
       or s.development_case_id is distinct from new.development_case_id then
      raise exception
        'That design study belongs to another organization or another development case. A score cites the review it came out of, or none at all.'
        using errcode = 'check_violation';
    end if;
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Design axis score (%s = %s on case %s, scored_by %s)',
             new.axis, new.score, new.development_case_id, new.scored_by),
      tg_op,
      'A score written outside score_design_axis supplies the sixth axis the composite refuses without, so it can turn a REFUSED scorecard into a number nobody judged.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_axis_score_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_axis_score_integrity on public.design_axis_scores;
create trigger trg_axis_score_integrity
  before insert or update or delete on public.design_axis_scores
  for each row execute function public.enforce_axis_score_integrity();

drop trigger if exists trg_axis_score_no_truncate on public.design_axis_scores;
create trigger trg_axis_score_no_truncate
  before truncate on public.design_axis_scores
  for each statement execute function public.enforce_axis_score_integrity();

revoke truncate on table public.design_axis_scores from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The write path.
-- ---------------------------------------------------------------------------
create or replace function public.score_design_axis(
  p_case_id uuid,
  p_score jsonb
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
  v_axis text := nullif(btrim(coalesce(p_score->>'axis','')), '');
  v_value int := sync_text_as_int(p_score->>'score');
  v_basis text := btrim(coalesce(p_score->>'basis',''));
  v_study bigint := sync_text_as_int(p_score->>'study_id');
  v_prev jsonb;
  v_no int;
  v_id bigint;
  v_missing text[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'scoring a design is a §70 human judgement, refused to the AI-operator identity by name. A machine-scored design would let the model certify the thing it helped produce.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'scoring a design axis requires an operating, planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_axis is null or not (v_axis = any (sync_design_axes())) then
    return jsonb_build_object('error',
      format('axis must be one of the six spec I.26 axes: %s',
        array_to_string(sync_design_axes(), ', ')));
  end if;
  if v_value is null or v_value < 1 or v_value > 5 then
    return jsonb_build_object('error',
      'score is an integer from 1 (will not work as drawn) to 5 (nothing further is needed)');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state the basis for this score (20 characters minimum) — a number with nothing behind it is not a judgement, and this platform refuses to record one');
  end if;
  if p_score ? 'study_id'
     and nullif(btrim(coalesce(p_score->>'study_id','')), '') is not null
     and v_study is null then
    return jsonb_build_object('error', 'study_id is not a valid identifier');
  end if;
  if v_study is not null
     and not exists (select 1 from design_studies s
                      where s.id = v_study and s.organization_id = v_org
                        and s.development_case_id = c.id) then
    return jsonb_build_object('error',
      'that design study is not on this case — a score cites a review of this design or none at all');
  end if;

  select jsonb_build_object('score', a.score, 'basis', a.basis,
           'scored_by', a.scored_by, 'score_no', a.score_no, 'scored_at', a.scored_at)
    into v_prev
    from design_axis_scores a
   where a.development_case_id = c.id and a.axis = v_axis
   order by a.score_no desc limit 1;

  select coalesce(max(score_no), 0) + 1 into v_no
    from design_axis_scores where development_case_id = c.id and axis = v_axis;

  insert into design_axis_scores (organization_id, development_case_id, study_id,
    axis, score_no, score, basis, scored_by)
  values (v_org, c.id, v_study, v_axis, v_no, v_value, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_axis_score', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'axis', v_axis, 'score_id', v_id,
      'score_no', v_no),
    v_prev,
    jsonb_build_object('score', v_value, 'basis', v_basis, 'score_no', v_no,
      'scored_by', auth.uid(), 'study_id', v_study));

  select array_agg(a order by a) into v_missing
    from unnest(sync_design_axes()) a
   where not exists (select 1 from design_axis_scores d
                      where d.development_case_id = c.id and d.axis = a);

  return jsonb_build_object('score_id', v_id, 'case_id', c.id, 'axis', v_axis,
    'score', v_value, 'scoreNo', v_no, 'supersedes', v_prev,
    'missingAxes', to_jsonb(coalesce(v_missing, array[]::text[])),
    'note', case when v_missing is null
      then 'All six axes are now scored, so the composite can be computed.'
      else format('%s of the six axes are still unscored (%s). The composite REFUSES until they are — averaging the ones that exist would read highest exactly when the unscored axis is the bad one.',
             array_length(v_missing, 1), array_to_string(v_missing, ', ')) end);
end
$$;

revoke all on function public.score_design_axis(uuid, jsonb) from public, anon;
grant execute on function public.score_design_axis(uuid, jsonb) to authenticated, service_role;

comment on function public.score_design_axis(uuid, jsonb) is
  'D4.12 / spec I.26: records one human score on one of the six axes with a mandatory basis. Append-only; §70-refused to the AI-operator identity at the door and at the wall.';

-- ---------------------------------------------------------------------------
-- 3. The composite (ruling 1 and 2) — computed once, here.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_design_scorecard(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_axes jsonb;
  v_scored int;
  v_missing text[];
  v_composite numeric;
  v_weakest jsonb;
  v_refused boolean;
  v_refusal text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'axis', a.axis,
           'score', latest.score,
           'basis', latest.basis,
           'scoredBy', latest.name,
           'scoredAt', latest.scored_at,
           'scoreNo', latest.score_no,
           'history', coalesce(latest.history, '[]'::jsonb),
           'scored', latest.score is not null) order by a.ord), '[]'::jsonb)
    into v_axes
  from unnest(sync_design_axes()) with ordinality as a(axis, ord)
  left join lateral (
    select d.score, d.basis, d.score_no, d.scored_at,
           coalesce(u.full_name, u.email, d.scored_by::text) name,
           (select jsonb_agg(jsonb_build_object('score', h.score, 'no', h.score_no,
                     'at', h.scored_at, 'basis', h.basis) order by h.score_no desc)
              from design_axis_scores h
             where h.development_case_id = c.id and h.axis = a.axis) history
      from design_axis_scores d
      left join user_profiles u on u.id = d.scored_by and u.organization_id = v_org
     where d.development_case_id = c.id and d.axis = a.axis
     order by d.score_no desc limit 1) latest on true;

  select array_agg(x order by x) into v_missing
    from unnest(sync_design_axes()) x
   where not exists (select 1 from design_axis_scores d
                      where d.development_case_id = c.id and d.axis = x);
  v_scored := array_length(sync_design_axes(), 1) - coalesce(array_length(v_missing, 1), 0);
  v_refused := v_missing is not null;

  if not v_refused then
    -- ONE composite: the arithmetic mean of the six current scores. Rounded to
    -- two places for presentation only; the axis scores themselves are the
    -- record.
    select round(avg(latest.score)::numeric, 2) into v_composite
      from unnest(sync_design_axes()) x
      join lateral (select d.score from design_axis_scores d
                     where d.development_case_id = c.id and d.axis = x
                     order by d.score_no desc limit 1) latest on true;

    select jsonb_build_object('axis', x, 'score', latest.score) into v_weakest
      from unnest(sync_design_axes()) x
      join lateral (select d.score from design_axis_scores d
                     where d.development_case_id = c.id and d.axis = x
                     order by d.score_no desc limit 1) latest on true
     order by latest.score, x limit 1;

    v_refusal := null;
  else
    v_refusal := format(
      'This design has %s of six axes scored and no composite. The unscored axis/axes are: %s. The mean of the axes that DO have scores is deliberately not reported: it would read highest exactly when the missing axis is the bad one, because the axis nobody scored is usually the axis nobody owns. Spec I.26 — a design can be technically correct and score poorly on any of these.',
      v_scored, array_to_string(v_missing, ', '));
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', v_refused,
    'refusal', v_refusal,
    'axes', v_axes,
    'axisOrder', to_jsonb(sync_design_axes()),
    'scale', sync_design_axis_scale(),
    'scoredAxisCount', v_scored,
    'axisCount', array_length(sync_design_axes(), 1),
    'missingAxes', to_jsonb(coalesce(v_missing, array[]::text[])),
    'composite', v_composite,
    'weakestAxis', v_weakest,
    'note', case when v_refused then null
      else 'The composite is the arithmetic mean of the six current axis scores. It is reported beside the weakest axis on purpose: a design averaging 4.0 with a 2 on constructability is a design that will be built badly, and the average is the part that hides it.' end);
end
$$;

revoke all on function public.get_case_design_scorecard(uuid) from public, anon;
grant execute on function public.get_case_design_scorecard(uuid) to authenticated, service_role;

comment on function public.get_case_design_scorecard(uuid) is
  'D4.12 / spec I.26: the six-axis scorecard. The composite REFUSES while any axis is unscored and NAMES the axis — it never averages the axes it has (allocateAvailability''s idiom, applied to a scorecard).';

-- ---------------------------------------------------------------------------
-- 4. The lineage record (D11.29). A REFUSED scorecard records a run too — a
--    refusal with no lineage is a refusal nobody can later prove happened.
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
    ('case_scope_growth',              'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',       'develop-controls/4A/2026-11-24'),
    ('case_earned_value',              'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',         'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',        'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',          'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',       'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',   'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',   'develop-change/4D/2026-12-03'),
    ('case_change_control',            'develop-change/4D/2026-12-03'),
    ('case_decision_latency',          'develop-change/4D/2026-12-03'),
    ('case_decision_debt',             'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',          'develop-design/5B/2026-12-05')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

create or replace function public.compute_case_design_scorecard(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_result jsonb;
  v_run uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a design scorecard run requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_result := get_case_design_scorecard(c.id);
  if v_result ? 'error' then
    return v_result;
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_design_scorecard',
    'arithmetic mean of the latest human score on each of the six spec I.26 axes; refuses outright while any axis is unscored',
    jsonb_build_object(
      'axisCount', v_result->'axisCount',
      'scoredAxisCount', v_result->'scoredAxisCount',
      'scale', v_result->'scale'),
    jsonb_build_array(
      jsonb_build_object('table', 'design_axis_scores',
        'scope', 'development_case_id = ' || c.id::text)),
    case when coalesce((v_result->>'refused')::boolean, false)
      then null
      else jsonb_build_object(
        'composite', v_result->'composite',
        'weakestAxis', v_result->'weakestAxis',
        'axes', v_result->'axes')
      end,
    case when coalesce((v_result->>'refused')::boolean, false)
      then jsonb_build_array(v_result->>'refusal')
      else '[]'::jsonb end);

  return v_result || jsonb_build_object('calculationRunId', v_run);
end
$$;

revoke all on function public.compute_case_design_scorecard(uuid) from public, anon;
grant execute on function public.compute_case_design_scorecard(uuid) to authenticated, service_role;

comment on function public.compute_case_design_scorecard(uuid) is
  'D4.12 + D11.29: the six-axis scorecard with a calculation_runs row behind it. A REFUSED scorecard records a run whose outputs are NULL and whose refusals name the unscored axes.';

notify pgrst, 'reload schema';
