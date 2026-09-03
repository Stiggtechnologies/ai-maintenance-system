-- ============================================================================
-- Sync Develop — Slice 7B (part 2): the assessment, the itemization and the
-- Execution Readiness board.
--   D7.05  release readiness checklist — the DERIVED half, generalized
--   D7.11  per-package itemized constraint-free readiness (which items block)
--   D7.12  field-ready package definition, recorded
--   D7.19  Workflow 4: execution readiness verdict, on the one engine
--   D13.09 Execution Readiness screen (work-package board)
--
-- ── RULING 22 CONTINUED: HOW FIELD READINESS REACHES THE RELEASE DOOR ───────
--
-- Through the ONE channel that already exists — recorded constraints — and
-- through no other.
--
-- There is still exactly ONE release verdict, and this file does not state a
-- readiness rule of its own. What it adds is EVIDENCE: an assessment that
-- turns the ten field-ready elements into constraint rows the one predicate
-- already counts, names and refuses on. Slice 7A had to DELETE a second,
-- weaker verdict from its own read path, and nothing here reintroduces one:
-- `assess_package_field_readiness`, `get_package_field_readiness` and
-- `get_execution_readiness_board` all render `sync_work_package_release_verdict`'s
-- `verdict`, `reason` and `canRelease` verbatim.
--
-- THAT PREDICATE IS REDEFINED ONCE, in 20261211090200, and the reason is
-- written in that file's header: the recorded evidence this file produces is a
-- SNAPSHOT, and every surface was presenting it as a current position. The one
-- predicate gained a seventh REFUSING state (`stale`) rather than a second
-- verdict or a screen-side check the door would contradict — a distinction the
-- 7A parity proof depends on, since a read-side-only check would have made the
-- SCREEN refuse while the DOOR released.
--
-- ── WHAT THE ASSESSOR MAY WRITE, AND WHY IT MAY NEVER WRITE `satisfied` ────
--
-- §70, at the database. `restoration_constraints` has carried
-- `state <> 'satisfied' or verified` since 2026-09-21, and Slice 7A put a
-- §70 wall on `verified_by` for PACKAGE-anchored rows. So on this anchor a
-- machine cannot mark an element satisfied even if every canonical store
-- agrees it is — the verifier would have to be the caller, and the caller may
-- be `ai_admin`.
--
-- That is not an obstacle to work around. It is the design:
--
--   * an element the stores show as NOT established becomes a `blocked` hard
--     constraint — no verifier needed, and the release door already refuses
--     on it and NAMES it;
--   * an element with NO canonical store becomes an `unknown` hard constraint
--     — the machine raises the question and a person answers it;
--   * an element the stores show as ESTABLISHED gets NO ROW AT ALL. There is
--     nothing to discharge, so nothing is recorded, and the machine has
--     declared nothing. `clear_package_constraint` — human-only, §70-walled —
--     stays the only way a package's constraint reaches `satisfied`.
--
-- ── THE §70 SCOPE, AND THE 7A LESSON THAT SHAPED IT ────────────────────────
--
-- Slice 7A's §70 wall was OVER-BROAD in its first draft and broke two
-- Recovery RPCs that legitimately admit `ai_admin`. A guard that refuses the
-- right thing must not also refuse the wrong one, so this file scopes by ACT
-- rather than by role list:
--
--   `assess_package_field_readiness` ADMITS ai_admin. Gathering evidence and
--   saying what is still open is exactly what spec §70 leaves to the machine
--   — `enforce_awp_act_is_human` says so in its own refusal text ("The AI may
--   assemble the package, gather the constraint evidence and say what is
--   still open"). The assessor stamps no `verified_by`, sets no state to
--   `satisfied`, and touches neither `released_by` nor `released_at`.
--
--   `clear_package_constraint` and `release_work_package` still REFUSE it, at
--   the role gate and at the §70 wall, unchanged. The smoke proves BOTH
--   directions on the same identity in the same run: the AI assesses and is
--   admitted; the AI clears and releases and is refused, twice each.
--
-- ── RE-ASSESSMENT: EVIDENCE OVERWRITES, JUDGEMENT DOES NOT ─────────────────
--
-- `refresh_restoration_readiness` deletes its derived rows and re-derives
-- them, which is right for an element a canonical store answers: the store is
-- authoritative and a stale clearance must not survive it. It is WRONG for an
-- element no store answers. So this assessor splits:
--
--   DERIVED rows   deleted and re-derived on every run. The stores win.
--   DECLARED rows  inserted ONCE and never touched again. The machine has no
--                  evidence about crew, access or predecessors, so it may
--                  raise the question and may never erase a person's answer
--                  to it.
--
-- ── WHAT "ALREADY ANSWERED" MEANS, CORRECTED ON REVIEW ─────────────────────
--
-- The first draft of this file declined to raise a DECLARED question wherever
-- a hand-recorded constraint of the mapped kind existed on the package with
-- `work_order_id is null or = this work order`. The `is null` arm was wrong in
-- three compounding ways, and all three were proven live:
--
--   * ONE package-level `access` row silenced the access question for EVERY
--     work order in the package — three clearances instead of one hundred and
--     twenty on a forty-job IWP;
--   * it silenced them for work orders ADDED LATER, which nobody had
--     considered access for at all;
--   * the state was never tested, so a SATISFIED row about a different work
--     face silenced the question as strongly as an open one, and the read then
--     rendered that unrelated clearance beside the element.
--
-- The file already refused exactly this reasoning for DERIVED elements one
-- screen below ("a person's `material` constraint about a different thing is
-- not evidence about THIS element"), and then applied the opposite rule to the
-- three elements where there is no store to fall back on — where it is
-- strictly worse. So the skip is now scoped to a constraint that NAMES THIS
-- WORK ORDER. A person who answers access for job W3 has answered it for job
-- W3; a package-wide note about the north bay is not an answer to a per-job
-- question, and the assessment keeps asking it.
--
-- Canonical reuse: restoration_constraints, work_packages, work_package_work,
-- work_orders, calculation_runs + record_calculation_run,
-- sync_field_readiness_elements, sync_work_package_release_verdict,
-- app_current_org. No new table.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CODE VERSION (D11.29). Every existing key keeps its own version —
--    their code did not change, and bumping a version on unchanged code makes
--    the version stop meaning anything.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
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
    ('case_design_scorecard',          'develop-design/5B/2026-12-05'),
    ('case_ram_profile',               'develop-ram/5D/2026-12-07'),
    ('case_procurement_position',      'develop-procurement/6A/2026-12-08'),
    ('package_constraint_burndown',    'develop-awp/7A/2026-12-10'),
    ('package_field_readiness',        'develop-awp/7B/2026-12-11')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE ELEMENT → §28 CONSTRAINT KIND MAP.
--
--    Mapped onto the canonical vocabulary RULING 20 settled — no new kind is
--    added here, because the twenty already say all ten of these things.
-- ---------------------------------------------------------------------------
create or replace function public.sync_field_readiness_constraint_kind(p_element_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_element_key
    -- The engineering deliverable the crew executes from. §28's DRAWING is
    -- the issued-engineering constraint and a job plan is this repository's
    -- issued engineering for maintenance work.
    when 'scope'       then 'drawing'
    when 'procedure'   then 'drawing'
    when 'materials'   then 'material'
    when 'tools'       then 'tooling'
    when 'permits'     then 'permit'
    when 'isolation'   then 'isolation'
    when 'quality'     then 'quality_hold'
    when 'crew'        then 'labour'
    when 'access'      then 'access'
    when 'predecessor' then 'precedence'
  end;
$$;

revoke all on function public.sync_field_readiness_constraint_kind(text) from public, anon;
grant execute on function public.sync_field_readiness_constraint_kind(text) to authenticated, service_role;

comment on function public.sync_field_readiness_constraint_kind(text) is
  'D7.12 × D7.18: the ten field-ready elements mapped onto the canonical restoration_constraints vocabulary (RULING 20). No kind is added — the twenty already name all ten. NULL for anything else, which every caller treats as a refusal.';

create or replace function public.sync_field_readiness_owner_role(p_element_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_element_key
    when 'isolation' then 'operator'
    when 'quality'   then 'reliability_engineer'
    when 'crew'      then 'supervisor'
    when 'access'    then 'supervisor'
    else 'planner'
  end;
$$;

revoke all on function public.sync_field_readiness_owner_role(text) from public, anon;
grant execute on function public.sync_field_readiness_owner_role(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2c. A REFUSAL IS A RESULT, AND IT GOES IN THE LEDGER (D11.29).
--
--     `record_calculation_run` already mints `status = 'refused'` for a null
--     outputs payload, and Slice 7A's burn-down uses it. This wrapper is here
--     so the assessment's refusals over a package it COULD resolve reach the
--     same ledger the answers do, in one place rather than three.
-- ---------------------------------------------------------------------------
create or replace function public.sync_record_field_readiness_refusal(
  p work_packages,
  p_role text,
  p_method text,
  p_refusal text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run uuid;
begin
  v_run := record_calculation_run(p.development_case_id, 'package_field_readiness',
    p_method,
    jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code),
    jsonb_build_array(jsonb_build_object('table', 'work_packages',
      'scope', 'work_package_id = ' || p.id::text)),
    null,
    jsonb_build_array(jsonb_build_object('reason', p_refusal)));

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (p.organization_id, 'work_package_field_readiness',
    coalesce(p_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'action', 'refused',
      'calculation_run_id', v_run),
    null,
    jsonb_build_object('refusal', p_refusal, 'assessed_by', auth.uid()));

  return jsonb_build_object('answered', false, 'packageCode', p.package_code,
    'refusal', p_refusal, 'calculationRunId', v_run);
end
$$;

revoke all on function public.sync_record_field_readiness_refusal(work_packages, text, text, text)
  from public, anon, authenticated, service_role;

comment on function public.sync_record_field_readiness_refusal(work_packages, text, text, text) is
  'D7.05 × D11.29: records a field-readiness REFUSAL over a resolved work package as a refused calculation_runs row and an audit event, and returns the refusal the caller hands back. Revoked from every client role — it is only ever called from inside assess_package_field_readiness, which has already established the tenant and the authority.';

-- ---------------------------------------------------------------------------
-- 3. THE ASSESSMENT (D7.05, D7.12).
--
--    This is `refresh_restoration_readiness`'s DERIVED half, generalized to
--    the second anchor — the thing D7.05 has been 🟡 on since Slice 7A closed
--    the CONSTRAINT half. It derives, it records, and it declares nothing.
-- ---------------------------------------------------------------------------
create or replace function public.assess_package_field_readiness(p_package_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p work_packages%rowtype;
  m record;
  el record;
  v_ready jsonb;
  v_kind text;
  v_desc text;
  v_label text;
  v_work int := 0;
  v_written int := 0;
  v_cleared int := 0;
  v_declared int := 0;
  v_items jsonb := '[]'::jsonb;
  v_blocked int := 0;
  v_unverifiable int := 0;
  v_unreadable int := 0;
  v_elem_count int;
  v_replaced jsonb := '[]'::jsonb;
  v_payloads jsonb := '{}'::jsonb;
  v_unanswerable int := 0;
  v_source text;
  v_run uuid;
  v_verdict jsonb;
  v_method text :=
    'The ten §27 field-ready elements read for every work order the package contains, from the canonical stores that hold them (job_plans and its step/tool/permit/check children, work_order_materials, equipment_releases). Seven are derived; three have no canonical store and are recorded as UNKNOWN for a person to answer. Nothing is marked satisfied here: spec §70 reserves that for a named person, so an element the stores show as established is recorded as nothing at all.';
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- ai_admin IS ADMITTED, and the header says why: assessing is gathering
  -- evidence, which §70 leaves to the machine. Clearing and releasing are
  -- refused elsewhere, at the role gate AND at the §70 wall, unchanged.
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'assessing field readiness requires a planning, engineering, supervisory or governance role');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;
  -- A REFUSAL OVER A PACKAGE THIS FUNCTION COULD RESOLVE IS A LINEAGE EVENT.
  -- `record_calculation_run` mints `status = 'refused'` when it is handed null
  -- outputs (20261130090600:218), and the first draft of this file never used
  -- it: every refusal returned before the ledger write while D7.05 claimed
  -- "refusals included". The three refusals below have a development case to
  -- write against and are recorded. The three ABOVE do not — a caller with no
  -- organization, without the role, or naming a package that does not exist
  -- gives this function no case id to record a run for, and minting one would
  -- also hand an unauthorised caller a write. That distinction is now what
  -- D7.05 says, rather than "refusals included".
  if p.status = 'cancelled' then
    return sync_record_field_readiness_refusal(p, v_role, v_method,
      format('Work package %s was cancelled. Assessing a withdrawn package produces a readiness position for work nobody intends to do.', p.package_code));
  end if;
  if p.released_at is not null then
    return sync_record_field_readiness_refusal(p, v_role, v_method,
      format('Work package %s was released on %s against its constraint set. That set is what the release was checked against and does not grow afterwards.',
        p.package_code, p.released_at::date));
  end if;

  select count(*) into v_work from work_package_work where work_package_id = p.id;
  if v_work = 0 then
    return sync_record_field_readiness_refusal(p, v_role, v_method,
      format('Work package %s contains no work orders. A field-readiness assessment over no work is an assessment of nothing, and reporting it as "no blockers found" is the reading spec §27 exists to prevent.', p.package_code));
  end if;

  -- ── READ EVERYTHING FIRST, WRITE NOTHING YET. A work order the predicate
  --    cannot answer for stops the assessment BEFORE the delete below, so the
  --    package keeps the constraint set it had rather than losing its derived
  --    rows to a run that then reported nothing. The loop that follows would
  --    otherwise iterate an empty element array, record nothing and count
  --    nothing — reporting "0 derived blockers" over work nobody could look
  --    at, which is the empty-checklist-passes inversion §27 exists to refuse.
  for m in
    select w.* from work_package_work k join work_orders w on w.id = k.work_order_id
     where k.work_package_id = p.id
     order by w.wo_number nulls last, w.id
  loop
    v_ready := sync_field_readiness_elements(m.id, null);
    v_label := coalesce(m.wo_number, m.id::text);
    if not coalesce((v_ready->>'answered')::boolean, false) then
      v_unreadable := v_unreadable + 1;
      return sync_record_field_readiness_refusal(p, v_role, v_method,
        format('Work package %s cannot be assessed: %s An assessment that skipped that work order would report "no blockers found" over work nobody could read.',
          p.package_code, coalesce(v_ready->>'refusal', 'a work order could not be read.')));
    end if;
    if v_elem_count is null then
      v_elem_count := jsonb_array_length(v_ready->'elements');
    elsif jsonb_array_length(v_ready->'elements') <> v_elem_count then
      return sync_record_field_readiness_refusal(p, v_role, v_method,
        format('The field-readiness predicate returned %s elements for work order %s and %s for another in work package %s. A run whose lineage row states a fixed element count per work order must have one.',
          jsonb_array_length(v_ready->'elements'), v_label, v_elem_count, p.package_code));
    end if;
    v_payloads := v_payloads || jsonb_build_object(m.id::text, v_ready);
  end loop;

  perform set_config('app.package_constraint_write', 'granted', true);

  -- DERIVED rows only. The stores are authoritative for these seven, so a
  -- previous run's finding is replaced rather than accumulated.
  -- WHICH rows were replaced, not how many. A count in an audit row does not
  -- say what a re-assessment destroyed, and a person's clearance on a derived
  -- element is exactly the thing worth being able to name afterwards.
  with gone as (
    delete from restoration_constraints
     where organization_id = v_org
       and work_package_id = p.id
       and source_kind = 'derived'
       and source_ref like 'awp-field-ready:derived:%'
     returning id, source_ref, state, verified_by)
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'constraintId', id, 'sourceRef', source_ref, 'state', state,
           'verifiedBy', verified_by) order by source_ref), '[]'::jsonb)
    into v_cleared, v_replaced
    from gone;

  for m in
    select w.* from work_package_work k join work_orders w on w.id = k.work_order_id
     where k.work_package_id = p.id
     order by w.wo_number nulls last, w.id
  loop
    v_ready := v_payloads->(m.id::text);
    v_label := coalesce(m.wo_number, m.id::text);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'workOrderId', m.id, 'woNumber', m.wo_number, 'title', m.title,
      'elements', v_ready->'elements'));

    for el in
      select e->>'key' as elem_key, e->>'label' as elem_label,
             e->>'basisKind' as elem_basis, e->>'state' as elem_state,
             e->>'detail' as elem_detail
        from jsonb_array_elements(v_ready->'elements') e
    loop
      v_kind := sync_field_readiness_constraint_kind(el.elem_key);
      if v_kind is null then
        continue;
      end if;

      if el.elem_basis = 'derived' and el.elem_state in ('blocked', 'unverifiable') then
        -- A DERIVED element the store could not answer is a QUESTION, not a
        -- silence. `isolation` on a work order with no job plan is the live
        -- case: nothing identifies whether a permit is required, so nothing
        -- can say the isolation is not required either. It is recorded as
        -- UNKNOWN — the same shape as a declared question — and it is a
        -- DERIVED row, so a later run over a readable plan replaces it.
        v_desc := format('Field-ready: %s — work order %s', el.elem_label, v_label);
        v_source := format('awp-field-ready:derived:%s:%s', el.elem_key, m.id);
        insert into restoration_constraints (organization_id, event_id, work_package_id,
          work_order_id, constraint_kind, phase, is_hard, state, description, basis,
          source_kind, source_ref, owner_role, created_by)
        values (v_org, null, p.id, m.id, v_kind, 'execution', true,
          case el.elem_state when 'blocked' then 'blocked' else 'unknown' end,
          v_desc, el.elem_detail, 'derived', v_source,
          sync_field_readiness_owner_role(el.elem_key), auth.uid());
        v_written := v_written + 1;
        if el.elem_state = 'blocked' then
          v_blocked := v_blocked + 1;
        else
          v_unanswerable := v_unanswerable + 1;
        end if;

      elsif el.elem_basis = 'declared' then
        v_unverifiable := v_unverifiable + 1;
        v_source := format('awp-field-ready:declared:%s:%s', el.elem_key, m.id);
        -- ONCE, and never again. A person's answer to a question the machine
        -- cannot answer is not overwritten by the machine re-asking it.
        if not exists (
          select 1 from restoration_constraints x
           where x.organization_id = v_org and x.work_package_id = p.id
             and x.source_ref = v_source)
           -- Nor is the question raised where a person has already recorded
           -- that same class of constraint by hand AGAINST THIS WORK ORDER.
           -- A package-wide row is NOT an answer here — see the header: one
           -- such row silenced the question for every job in the package and
           -- for every job added afterwards, whatever state it was left in.
           and not exists (
          select 1 from restoration_constraints y
           where y.organization_id = v_org and y.work_package_id = p.id
             and y.constraint_kind = v_kind
             and coalesce(y.source_kind, '') <> 'derived'
             and y.work_order_id = m.id)
        then
          v_desc := format('Field-ready: %s — work order %s', el.elem_label, v_label);
          insert into restoration_constraints (organization_id, event_id, work_package_id,
            work_order_id, constraint_kind, phase, is_hard, state, description, basis,
            source_kind, source_ref, owner_role, created_by)
          values (v_org, null, p.id, m.id, v_kind, 'execution', true, 'unknown',
            v_desc, el.elem_detail, 'derived', v_source,
            sync_field_readiness_owner_role(el.elem_key), auth.uid());
          v_written := v_written + 1;
          v_declared := v_declared + 1;
        end if;
      end if;
    end loop;
  end loop;

  perform set_config('app.package_constraint_write', '', true);

  -- THE VERDICT IS READ, NOT RESTATED. Whatever the assessment just recorded,
  -- the sentence a person acts on comes from the ONE predicate.
  v_verdict := sync_work_package_release_verdict(p.id);

  v_run := record_calculation_run(p.development_case_id, 'package_field_readiness',
    v_method,
    jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code,
      'workOrders', v_work),
    jsonb_build_array(
      jsonb_build_object('table', 'work_package_work',
        'scope', 'work_package_id = ' || p.id::text),
      jsonb_build_object('table', 'job_plans', 'scope', 'via work_orders.job_plan_id'),
      jsonb_build_object('table', 'work_order_materials', 'scope', 'via work_package_work'),
      jsonb_build_object('table', 'equipment_releases', 'scope', 'via work_orders.asset_id')),
    jsonb_build_object(
      'workOrders', v_work,
      -- DERIVED FROM THE PAYLOAD, never typed beside it. A lineage row that
      -- states "ten elements per work order" while the predicate returned nine
      -- records a claim about code that no longer exists.
      'elementsPerWorkOrder', v_elem_count,
      'derivedBlockersRecorded', v_blocked,
      'derivedQuestionsRaised', v_unanswerable,
      'declaredQuestionsRaised', v_declared,
      'unverifiableElements', v_unverifiable,
      'previousDerivedRowsReplaced', v_cleared,
      'constraintsWritten', v_written,
      'items', v_items,
      'verdict', v_verdict->>'verdict',
      'readiness', v_verdict->>'reason'),
    '[]'::jsonb);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package_field_readiness', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'action', 'assessed',
      'calculation_run_id', v_run),
    -- WHICH rows this run destroyed, with the state and the verifier each
    -- carried. `actor` is a ROLE by house convention, so the identity goes in
    -- new_state beside it — a run that writes no constraint row otherwise
    -- leaves no record of who ran it.
    jsonb_build_object('derivedRowsReplaced', v_cleared,
      'replacedRows', v_replaced),
    jsonb_build_object('constraintsWritten', v_written,
      'derivedBlockersRecorded', v_blocked, 'declaredQuestionsRaised', v_declared,
      'derivedQuestionsRaised', v_unanswerable,
      'assessed_by', auth.uid(),
      'verdict', v_verdict->>'verdict'));

  return jsonb_build_object('answered', true,
    'packageId', p.id, 'packageCode', p.package_code, 'workOrders', v_work,
    'elementsPerWorkOrder', v_elem_count,
    'derivedBlockersRecorded', v_blocked,
    'derivedQuestionsRaised', v_unanswerable,
    'declaredQuestionsRaised', v_declared,
    'unverifiableElements', v_unverifiable,
    'previousDerivedRowsReplaced', v_cleared,
    'constraintsWritten', v_written,
    'items', v_items,
    'calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('package_field_readiness'),
    -- VERBATIM. The assessment does not decide readiness; it produces the
    -- evidence the one predicate decides on.
    'verdict', v_verdict->>'verdict',
    'readiness', v_verdict->>'reason',
    'canRelease', (v_verdict->>'canRelease')::boolean,
    'note', 'Nothing here was marked satisfied. An element the canonical stores show as established is recorded as no constraint at all; an element they show as missing is recorded as BLOCKED; an element no store can answer is recorded as UNKNOWN for a named person. Spec §70 reserves "ready" for a person, so this assessment can only ever narrow the question.');
end
$$;

revoke all on function public.assess_package_field_readiness(bigint) from public, anon;
grant execute on function public.assess_package_field_readiness(bigint) to authenticated;

comment on function public.assess_package_field_readiness(bigint) is
  'D7.05/D7.12 (RULING 22): the DERIVED half of the readiness checklist, generalized from restoration events to §27 work packages. Reads the ten field-ready elements for every work order in the package through sync_field_readiness_elements — the same predicate start_restoration_work refuses through — and records what is NOT established as constraint rows the ONE release verdict already counts and names. It never writes `satisfied`: §70 reserves that for a person and the §70 wall on verified_by enforces it. ADMITS ai_admin, deliberately and narrowly — gathering evidence is not declaring readiness, and clear_package_constraint and release_work_package still refuse it.';

-- ---------------------------------------------------------------------------
-- 4. THE ITEMIZED READ (D7.11, D7.12).
--
--    WHICH element is not ready, per work order, beside the recorded
--    constraint that holds it — and the release verdict VERBATIM from the ONE
--    predicate. This surface states no readiness rule of its own: it reports
--    element states from sync_field_readiness_elements, constraint states
--    from the store, and the verdict from sync_work_package_release_verdict.
-- ---------------------------------------------------------------------------
create or replace function public.get_package_field_readiness(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p work_packages%rowtype;
  m record;
  v_items jsonb := '[]'::jsonb;
  v_elements jsonb;
  v_ready jsonb;
  v_verdict jsonb;
  v_run record;
  v_work int;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;
  select count(*) into v_work from work_package_work where work_package_id = p.id;
  if v_work = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'refusal', format('Work package %s contains no work orders, so there is no work whose field readiness could be reported.', p.package_code));
  end if;

  for m in
    select w.* from work_package_work k join work_orders w on w.id = k.work_order_id
     where k.work_package_id = p.id
     order by w.wo_number nulls last, w.id
  loop
    v_ready := sync_field_readiness_elements(m.id, null);
    -- The read refuses where the predicate refuses. A screen that dropped an
    -- unreadable work order would show a package of two jobs as a package of
    -- one, with every element on the missing job rendered as nothing at all.
    if not coalesce((v_ready->>'answered')::boolean, false) then
      return jsonb_build_object('answered', false, 'packageCode', p.package_code,
        'refusal', format('Work package %s cannot be reported: %s',
          p.package_code, coalesce(v_ready->>'refusal', 'a work order could not be read.')));
    end if;
    -- Each element beside the constraint (if any) that currently holds it.
    --
    -- MATCHED THE SAME WAY THE ASSESSOR DECIDES, so the read and the write
    -- agree. A DERIVED element is matched on the assessment's own source_ref
    -- and on nothing else: a person's `material` constraint about a different
    -- thing is not evidence about THIS element, and showing it here would
    -- attach an unrelated clearance to a store-derived position.
    --
    -- A DECLARED element also falls back to a MANUAL constraint of its mapped
    -- kind NAMING THIS WORK ORDER — the exact condition under which
    -- `assess_package_field_readiness` declines to raise the question at all.
    -- Without this the read was strictly weaker than the store: a planner
    -- records the access constraint by hand against the job, the assessor
    -- correctly does not ask again, and the access element then rendered with
    -- NO constraint beside it, reading as though nobody had addressed it.
    --
    -- IT MIRRORS THE ASSESSOR EXACTLY, including the correction the assessor
    -- took: a package-wide row is not matched here either. It answers no
    -- per-job question, and attaching it to one rendered "Held by an access
    -- constraint — satisfied" against a work face nobody had considered.
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_elements
      from (
        select e || jsonb_build_object(
                 'constraintKind', sync_field_readiness_constraint_kind(e->>'key'),
                 'constraint', (
                   select jsonb_build_object('constraintId', c.id, 'state', c.state,
                            'isHard', c.is_hard, 'sourceKind', c.source_kind,
                            'basis', c.basis, 'ownerRole', c.owner_role,
                            'requiredBy', c.required_by,
                            'expectedClearDate', c.expected_clear_date,
                            'verifiedAt', c.verified_at)
                     from restoration_constraints c
                    where c.organization_id = v_org
                      and c.work_package_id = p.id
                      and (
                        c.source_ref in (
                              format('awp-field-ready:derived:%s:%s', e->>'key', m.id),
                              format('awp-field-ready:declared:%s:%s', e->>'key', m.id))
                        or (e->>'basisKind' = 'declared'
                            and coalesce(c.source_kind, '') <> 'derived'
                            and c.constraint_kind = sync_field_readiness_constraint_kind(e->>'key')
                            and c.work_order_id = m.id))
                    -- The assessment's own row wins where both exist, so a
                    -- re-run cannot make the element flip between two answers.
                    order by (c.source_ref is not null) desc, c.created_at
                    limit 1)) as x, ord
          from jsonb_array_elements(v_ready->'elements') with ordinality as t(e, ord)) s;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'workOrderId', m.id, 'woNumber', m.wo_number, 'title', m.title,
      'executionStatus', m.status,
      'elements', v_elements,
      'ready', v_ready->'ready',
      'blocked', v_ready->'blocked',
      'notApplicable', v_ready->'notApplicable',
      'unverifiable', v_ready->'unverifiable'));
  end loop;

  -- COMPUTED RUNS ONLY. A REFUSED run is a record that the assessment did not
  -- happen; reading it back as "assessed" would turn the refusal into the
  -- reassurance it exists to withhold.
  select r.id, r.computed_at, r.code_version, r.status, r.outputs
    into v_run
    from calculation_runs r
   where r.organization_id = v_org
     and r.calculation_key = 'package_field_readiness'
     and r.status = 'computed'
     and (r.inputs->>'workPackageId') = p.id::text
   order by r.computed_at desc
   limit 1;

  v_verdict := sync_work_package_release_verdict(p.id);

  return jsonb_build_object('answered', true,
    'packageId', p.id, 'packageCode', p.package_code, 'packageType', p.package_type,
    'status', p.status, 'workOrders', v_work,
    'items', v_items,
    -- ASSESSED IS A FACT, NOT A DEFAULT. A package nobody has assessed says so
    -- in a sentence, rather than rendering ten elements with no history behind
    -- them as though somebody had looked.
    'assessed', v_run.id is not null,
    'assessedAt', v_run.computed_at,
    'assessmentRunId', v_run.id,
    'assessmentCodeVersion', v_run.code_version,
    'assessmentNote', case when v_run.id is null
      then format('No field-readiness assessment has been recorded for work package %s. The elements below are read live from the canonical stores; nobody has yet walked them and turned what is missing into constraints this package must clear.', p.package_code)
      else format('Last assessed %s. What was missing then is recorded as constraints on this package.', v_run.computed_at::date) end,
    -- THE ONE VERDICT, VERBATIM. This surface adds no readiness rule.
    'readiness', v_verdict->>'reason',
    'readinessVerdict', v_verdict->>'verdict',
    'canRelease', (v_verdict->>'canRelease')::boolean,
    'openConstraints', coalesce(v_verdict->'openConstraints', '[]'::jsonb),
    -- WHERE THE RECORDED ASSESSMENT NO LONGER DESCRIBES THE WORK, itemized by
    -- the ONE verdict rather than recomputed here (20261211090200). Empty
    -- unless the verdict is `stale`.
    'fieldReadinessGaps', coalesce(v_verdict->'fieldReadinessGaps', '[]'::jsonb),
    'basis', 'The ten §27 field-ready elements per work order, each beside the constraint that holds it, with the release verdict taken verbatim from sync_work_package_release_verdict — the same function release_work_package refuses through.');
end
$$;

revoke all on function public.get_package_field_readiness(bigint) from public, anon;
grant execute on function public.get_package_field_readiness(bigint) to authenticated;

comment on function public.get_package_field_readiness(bigint) is
  'D7.11/D7.12: WHICH element is not ready, per work order, beside the constraint that holds it — plus whether a field-readiness assessment was ever recorded, and the release verdict verbatim from the ONE predicate. States no readiness rule of its own.';

-- ---------------------------------------------------------------------------
-- 5. THE EXECUTION READINESS BOARD (D13.09, D7.19 workflow 4).
--
--    COMPOSES RECORDED VERDICTS. Per package it returns the verdict from the
--    one predicate, the open hard constraints WITH THEIR OWNERS, and the last
--    recorded field-readiness assessment read back from calculation_runs. It
--    computes no readiness of its own and re-derives no element: a board that
--    recomputed would be the eighth copy of this programme's signature
--    defect, and the one on the surface a supervisor acts on.
--
--    REFUSAL-FIRST: an organization with no work packages refuses by name
--    rather than rendering an empty board, which reads as "nothing to do".
-- ---------------------------------------------------------------------------
create or replace function public.get_execution_readiness_board(
  p_case_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_total int;
  v_open int;
  v_rows jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  if p_case_id is not null then
    select * into c from development_cases where id = p_case_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('answered', false, 'refusal', 'development case not found');
    end if;
  end if;

  select count(*) into v_total
    from work_packages p
   where p.organization_id = v_org
     and (p_case_id is null or p.development_case_id = p_case_id);
  if v_total = 0 then
    return jsonb_build_object('answered', false, 'refusal',
      case when p_case_id is null
        then 'No work package has been recorded in this organization. An empty execution-readiness board reads as "nothing is waiting on anybody", which is a different fact from "nobody has packaged the work yet".'
        else 'No work package has been recorded on this case. An empty execution-readiness board reads as "nothing is waiting on anybody", which is a different fact from "nobody has packaged the work yet".' end,
      'packageCount', 0);
  end if;

  select count(*) into v_open
    from work_packages p
   where p.organization_id = v_org
     and (p_case_id is null or p.development_case_id = p_case_id)
     and p.status = 'draft';

  select coalesce(jsonb_agg(x order by x->>'sortKey', x->>'packageCode'), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'packageId', p.id,
        'packageCode', p.package_code,
        'title', p.title,
        'packageType', p.package_type,
        'level', sync_awp_level(p.package_type),
        'caseId', p.development_case_id,
        'caseTitle', dc.title,
        'area', p.area,
        'requiredBy', p.required_by,
        'status', p.status,
        -- Undated packages sort last rather than first: a null required-by is
        -- "nobody said when", and putting it at the top of a board a
        -- supervisor works down would make the unscheduled look most urgent.
        'sortKey', coalesce(p.required_by::text, '9999-12-31'),
        -- THE ONE VERDICT, VERBATIM.
        'readiness', v.verdict->>'reason',
        'readinessVerdict', v.verdict->>'verdict',
        'canRelease', (v.verdict->>'canRelease')::boolean,
        'constraintsRecorded', (v.verdict->>'constraintsRecorded')::int,
        'openHard', (v.verdict->>'openHard')::int,
        'workOrders', (v.verdict->>'workOrders')::int,
        -- Composed from the verdict, never recomputed: empty unless it is
        -- `stale`, in which case it names which element on which job.
        'fieldReadinessGaps', coalesce(v.verdict->'fieldReadinessGaps', '[]'::jsonb),
        -- WHICH ITEMS BLOCK, AND WHOSE THEY ARE (D7.11, D13.09).
        'blockingItems', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'constraintId', x.id, 'kind', x.constraint_kind, 'state', x.state,
                   'description', x.description, 'basis', x.basis,
                   'sourceKind', x.source_kind,
                   'ownerRole', x.owner_role,
                   'ownerEmail', own.email,
                   'requiredBy', x.required_by,
                   'expectedClearDate', x.expected_clear_date)
                   order by x.state, x.constraint_kind, x.id)
            from restoration_constraints x
            left join user_profiles own on own.id = x.owner_id
           where x.organization_id = v_org
             and x.work_package_id = p.id
             and x.is_hard and x.state in ('unknown', 'blocked')), '[]'::jsonb),
        -- THE RECORDED ASSESSMENT, read back rather than recomputed.
        'fieldReadinessAssessed', run.id is not null,
        'fieldReadinessAssessedAt', run.computed_at,
        'fieldReadinessRunId', run.id,
        'fieldReadinessOutputs', run.outputs,
        'fieldReadinessNote', case when run.id is null
          then 'Not assessed. The ten field-ready elements have not been walked for this package.'
          else format('Assessed %s: %s derived blocker(s) recorded, %s question(s) raised that no store can answer.',
            run.computed_at::date,
            coalesce(run.outputs->>'derivedBlockersRecorded', '0'),
            coalesce(run.outputs->>'declaredQuestionsRaised', '0')) end) as x
        from work_packages p
        left join development_cases dc on dc.id = p.development_case_id
        cross join lateral (select sync_work_package_release_verdict(p.id) as verdict) v
        left join lateral (
          select r.id, r.computed_at, r.outputs
            from calculation_runs r
           where r.organization_id = v_org
             and r.calculation_key = 'package_field_readiness'
             -- COMPUTED RUNS ONLY: a refused run says the assessment did not
             -- happen, and a board that read it back as "assessed" would print
             -- the reassurance the refusal exists to withhold.
             and r.status = 'computed'
             and (r.inputs->>'workPackageId') = p.id::text
           order by r.computed_at desc
           limit 1) run on true
       where p.organization_id = v_org
         and (p_case_id is null or p.development_case_id = p_case_id)
         and p.status = 'draft') s;

  return jsonb_build_object('answered', true,
    'caseId', p_case_id,
    'packageCount', v_total,
    'awaitingRelease', v_open,
    'packages', v_rows,
    'basis', 'Every unreleased work package, with the release verdict taken verbatim from sync_work_package_release_verdict — the ONE predicate release_work_package refuses through — the hard constraints still open against it and their owners, and the last field-readiness assessment read back from calculation_runs. Nothing on this board is recomputed.',
    'note', case when v_open = 0
      then format('All %s work package(s) here are released or cancelled; none is awaiting a release decision.', v_total)
      else format('%s of %s work package(s) are awaiting a release decision.', v_open, v_total) end);
end
$$;

revoke all on function public.get_execution_readiness_board(uuid) from public, anon;
grant execute on function public.get_execution_readiness_board(uuid) to authenticated;

comment on function public.get_execution_readiness_board(uuid) is
  'D13.09 / D7.19 workflow 4: the Execution Readiness board — every unreleased work package × the ONE release verdict × the hard constraints still open × their owners × the last recorded field-readiness assessment. Composes recorded verdicts and recomputes none of them. Refuses an empty board by name rather than rendering "nothing to do".';
