-- ============================================================================
-- Sync Develop Slice 5A — the Verification object (D4.17, spec III.§11).
--
-- §11 verbatim: "Verification: id, requirement_id, method, procedure,
-- acceptance_criteria, result, evidence_id, status, verified_by, verified_at.
-- Methods: ANALYSIS, INSPECTION, DEMONSTRATION, TEST, OPERATIONAL_VALIDATION."
--
-- ── WHAT PR #309 ALREADY DID, AND WHAT THIS FILE THEREFORE DOES NOT DO ─────
--
-- The register row D4.17 named three gaps: "the write path wiring,
-- OPERATIONAL_VALIDATION method, evidence_id on results". #309
-- ("Wire record_verification_result so LEARN can close") closed the FIRST of
-- the three and only the first:
--
--   * `recordVerificationResult` (src/services/operatingLoopService.ts) is a
--     real production caller of record_verification_result;
--   * the recorder form is mounted on /learning-loop through
--     VerificationLoop.tsx, with achieved / not_achieved / inconclusive, a
--     mandatory measured note and no default result;
--   * the reachability gate was changed to treat record_verification_result
--     as a LIVE caller and it was removed from the known-dead probe list
--     (src/test/capability-reachability.test.ts).
--
-- So the row's sentence "record_verification_result has ZERO callers, admitted
-- on-page (LearningLoop.tsx:32,193): the register's canonical dead-RPC
-- example" IS STALE, and this file does not rebuild any of it. The RPC keeps
-- its name and its three named arguments so that caller keeps working.
--
-- #309 did NOT touch the other two gaps, and left three more that the row did
-- not know about because nothing had looked:
--
--   4. NO REQUIREMENT LINK AT ALL. §11's Verification hangs off a
--      REQUIREMENT. verification_obligations (20260901140000) hangs off a
--      RECOMMENDATION — `recommendation_id uuid NOT NULL`, unique. There was
--      no way to record that a requirement had been verified, which is the
--      object §11 actually describes.
--   5. NO ROLE CHECK AND NO §70 WALL. record_verification_result gated on
--      nothing beyond RLS org scoping: any authenticated member of the
--      organization could close any obligation, and the AI-operator identity
--      could record a verification result — which §70 forbids in terms
--      ("no AI/system identity may verify a requirement, close an obligation,
--      or record a verification result"). Nothing on the table stopped a
--      service caller writing a result either.
--   6. NO AUDIT EVENT. The one act that closes a verification loop wrote no
--      audit_events row, so the previous and new state of the obligation were
--      not recoverable.
--
-- This file closes 2, 3, 4, 5 and 6. It adds NO new verification store: the
-- row's own ruling is "EXTEND — wire, do not add a third verification store",
-- and the three that exist stay three (ca_verifications at work-order level,
-- verification_obligations at recommendation level and now requirement level,
-- design_requirements.verification_status as the requirement's own summary).
--
-- ── RULING 1 — verification_obligations IS GENERALIZED, NOT FORKED ─────────
--
-- The same move 20261122090000 made on design_requirements (generalizing the
-- ONE requirement table from capital_projects to the development case):
-- recommendation_id becomes NULLABLE, requirement_id is added, and exactly one
-- of the two must be present. Postgres treats NULLs as distinct in a UNIQUE
-- constraint, so the existing `unique(recommendation_id)` — one obligation per
-- recommendation — is unchanged by rows that carry none.
--
-- There is deliberately NO unique constraint on requirement_id. §11 admits
-- several verifications of one requirement by different methods (an analysis
-- at design, a test at FAT, an operational validation after startup), and
-- forcing one would make the second one overwrite the first.
--
-- ── RULING 2 — THE LEARN POSTURE NUMBERS DO NOT MOVE ──────────────────────
--
-- get_verification_posture counts obligations against ACTIONED
-- RECOMMENDATIONS. Requirement-scoped obligations landing in that count would
-- inflate "openObligations" against a recommendation denominator that never
-- moves, and the C4.08 loop-closure figure on Mission Control would drift for
-- a reason that has nothing to do with the operating loop. The posture is
-- therefore scoped to `recommendation_id is not null`. Against today's data
-- that is a no-op — every existing row has one — which is exactly why it is
-- worth writing down now rather than after the first drift.
--
-- ── RULING 3 — WHY 'test' AND 'operational_validation' ARE ADDED AND
--               'review', 'factory_test', 'site_test' ARE KEPT ─────────────
--
-- design_requirements.verification_method shipped with six values, four of
-- which are §11 methods under the same name. The CHECK becomes the union: the
-- five §11 methods plus the three legacy ones. Mapping 'factory_test' onto
-- TEST would be defensible engineering and indefensible data handling — it
-- would rewrite what a past requirement said it would do. The same ruling
-- 20261204090000 makes for categories, for the same reason.
--
-- ── RULING 4 — WHO MAY RECORD A RESULT (§70, absolute) ────────────────────
--
-- Three doors, all closed to the AI-operator identity BY NAME, plus a
-- persistence wall that closes them for every writer including service:
--
--   * create_requirement_verification — refused. Creating the verification is
--     where the METHOD is stated, and D12.09's Requirements Agent exists to
--     report requirements with no verification method. An identity that could
--     state the method could clear its own finding.
--   * record_verification_result — refused, and the wall refuses a result
--     attributed to that identity for every writer.
--   * set_requirement_verification_status — refused; the status is only ever
--     moved by a recorded result anyway (see ruling 5).
-- ── RULING 5 — THE REQUIREMENT'S STATUS IS DERIVED, NEVER TYPED ───────────
--
-- design_requirements.verification_status is set by record_verification_result
-- as a CONSEQUENCE of a result being recorded against evidence. There is no
-- act in this product that types 'verified' onto a requirement directly. A
-- status a human can type is a status with nothing behind it, and the whole
-- point of §11 is that the status has a verification behind it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The requirement's stated method admits the five §11 methods (ruling 3).
-- ---------------------------------------------------------------------------
do $method$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.design_requirements'::regclass
     and conname = 'design_requirements_verification_method_check';

  if v_def is null then
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.design_requirements'::regclass
                     and conname = 'design_requirements_verification_method_spec11_union') then
      raise exception
        'design_requirements has neither the original verification_method CHECK nor the §11 union CHECK. Re-derive against the live constraint set before applying.'
        using errcode = 'check_violation';
    end if;
  else
    if position('factory_test' in v_def) = 0 then
      raise exception
        'design_requirements_verification_method_check is not the 20260818090000 constraint (%). Do not widen a constraint blind.',
        v_def
        using errcode = 'check_violation';
    end if;
    alter table public.design_requirements
      drop constraint design_requirements_verification_method_check;
    alter table public.design_requirements
      add constraint design_requirements_verification_method_spec11_union
      check (verification_method is null
             or verification_method = any (
                  sync_verification_methods()
                  || array['review','factory_test','site_test']::text[]));
  end if;
end
$method$;

-- ---------------------------------------------------------------------------
-- 2. verification_obligations generalized to the requirement (ruling 1) and
--    carrying the §11 fields it was missing.
-- ---------------------------------------------------------------------------
alter table public.verification_obligations
  alter column recommendation_id drop not null;

alter table public.verification_obligations
  add column if not exists requirement_id bigint
    references design_requirements(id) on delete cascade,
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  -- §11 `method`, as one of the five. The pre-existing `method` column stays
  -- what it always was: the free-text promise SNAPSHOTTED off the
  -- recommendation at approval. Overwriting that column with an enum would
  -- destroy the snapshot the 20260901140000 honesty rule exists to keep.
  add column if not exists method_code text,
  add column if not exists procedure text,
  add column if not exists acceptance_criteria text,
  add column if not exists evidence_id uuid
    references evidence_items(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id);

do $constraints$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.verification_obligations'::regclass
                   and conname = 'verification_obligation_subject_xor') then
    alter table public.verification_obligations
      add constraint verification_obligation_subject_xor
      check ((recommendation_id is not null) <> (requirement_id is not null));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.verification_obligations'::regclass
                   and conname = 'verification_obligation_method_code_spec11') then
    alter table public.verification_obligations
      add constraint verification_obligation_method_code_spec11
      check (method_code is null or method_code = any (sync_verification_methods()));
  end if;
  -- A requirement verification MUST name one of the five methods. The
  -- recommendation side keeps its free-text promise and is not retro-fitted
  -- with an enum it never had.
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.verification_obligations'::regclass
                   and conname = 'verification_obligation_requirement_needs_method') then
    alter table public.verification_obligations
      add constraint verification_obligation_requirement_needs_method
      check (requirement_id is null or method_code is not null);
  end if;
end
$constraints$;

create index if not exists idx_vobl_requirement
  on verification_obligations(organization_id, requirement_id)
  where requirement_id is not null;
create index if not exists idx_vobl_case_open
  on verification_obligations(organization_id, development_case_id, due_date)
  where requirement_id is not null and status = 'open';

comment on column public.verification_obligations.requirement_id is
  'D4.17 / spec §11: the Verification object hangs off a REQUIREMENT. Ruling 1 — verification_obligations is generalized from recommendation-only to carry both subjects, never forked into a third verification store. Exactly one of recommendation_id / requirement_id is present.';
comment on column public.verification_obligations.method_code is
  'D4.17 / §11: one of the five methods (sync_verification_methods). Distinct from `method`, which is the free-text promise snapshotted off a recommendation at approval and must not be overwritten by an enum.';
comment on column public.verification_obligations.evidence_id is
  'D4.17: the evidence the result rests on, on evidence_items (the ONE evidence model). Named in §11 and absent until this migration — a result with no evidence pointer is a claim.';

-- ---------------------------------------------------------------------------
-- 3. §70 — a verification cannot be attributed to a machine. EVERY writer,
--    service included, marker or no marker. This is the wall, not the door.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_recorder_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.verified_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.verified_by is not distinct from old.verified_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.verified_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A verification cannot be attributed to the AI-operator identity (spec §70: no AI or system identity verifies a requirement, closes an obligation or records a verification result). AI prepares and detects; a named human looks and is accountable for what they saw.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_verification_recorder_is_human()
  from public, anon, authenticated;

drop trigger if exists trg_verification_recorder_is_human on public.verification_obligations;
create trigger trg_verification_recorder_is_human
  before insert or update on public.verification_obligations
  for each row execute function public.enforce_verification_recorder_is_human();

-- ---------------------------------------------------------------------------
-- 4. The provenance backstop. A RESULT is written by record_verification_result
--    or not at all.
--
--    The scope is deliberately narrow: the trigger admits an insert that
--    carries NO result and NO verifier (which is exactly what the shipped
--    create_verification_obligation trigger writes when a recommendation is
--    approved, and what create_requirement_verification writes when a
--    verification is planned), and refuses any writer setting `result`,
--    `verified_by` or `verified_at` without the marker. A wall that refused
--    every insert would have broken the approval trigger; a wall that
--    refused nothing would have let a service key close every loop in the
--    database with one UPDATE.
--
--    DELETE is covered too, because a verification that can be deleted is a
--    failed verification that can be made to have never happened — which is
--    the one outcome the whole family exists to preserve.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_result_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.verification_result_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'verification_obligations records what was promised and whether anyone looked. Truncating it erases every open loop and every recorded failure in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone (the
    -- enforce_gate_agent_report_provenance idiom, 20261123090200). Without
    -- this the `on delete cascade` on requirement_id / recommendation_id
    -- promised a cleanup this branch forbade.
    if not exists (select 1 from organizations where id = old.organization_id)
       or (old.recommendation_id is not null
           and not exists (select 1 from recommendations where id = old.recommendation_id))
       or (old.requirement_id is not null
           and not exists (select 1 from design_requirements where id = old.requirement_id)) then
      return old;
    end if;
    raise exception
      'A verification obligation is not deleted. An obligation that turned out to be unnecessary is WAIVED with a stated reason, and one that failed stays failed — deleting it would make a recorded failure indistinguishable from a verification that was never owed.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if (new.result is not null or new.verified_by is not null or new.verified_at is not null)
       and v_marker <> 'granted' then
      raise exception
        'A verification obligation cannot be created already carrying its own result. Create the obligation, then record the result through record_verification_result — an obligation born verified is a loop that was never open.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE.
  if v_marker = 'granted' then
    return new;
  end if;
  if new.result is distinct from old.result
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at
     or new.status is distinct from old.status
     or new.evidence_id is distinct from old.evidence_id then
    raise exception
      'A verification result is recorded through record_verification_result, which demands a measurement, checks the evidence is this organization''s and refuses the AI-operator identity. It is not written directly.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_verification_result_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_verification_result_provenance on public.verification_obligations;
create trigger trg_verification_result_provenance
  before insert or update or delete on public.verification_obligations
  for each row execute function public.enforce_verification_result_provenance();

drop trigger if exists trg_verification_no_truncate on public.verification_obligations;
create trigger trg_verification_no_truncate
  before truncate on public.verification_obligations
  for each statement execute function public.enforce_verification_result_provenance();

revoke truncate on table public.verification_obligations from anon, authenticated, service_role;

-- The shipped approval trigger writes the recommendation-side obligation. It
-- carries no result and no verifier, so the backstop above admits it without
-- a marker — asserted here rather than assumed, because an approval path that
-- silently stopped creating obligations would present as "no open loops".
comment on function public.enforce_verification_result_provenance() is
  'D4.17 §70 backstop: an obligation may be CREATED with no result (the approval trigger and the requirement-verification planner both do), but result / verified_by / verified_at / status / evidence_id move only under record_verification_result''s marker. Deletion and TRUNCATE are refused for every caller.';

-- ---------------------------------------------------------------------------
-- 5. create_requirement_verification — §11's Verification, planned.
--
--    The METHOD is stated here, and stating a method is what D12.09's agent
--    reports the absence of, so the AI-operator identity is refused BY NAME
--    (ruling 4). A due date is required to be real or declared assumed, the
--    same honesty rule 20260901140000 wrote for the recommendation side.
-- ---------------------------------------------------------------------------
create or replace function public.create_requirement_verification(
  p_requirement_id bigint,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d design_requirements%rowtype;
  v_method text := nullif(btrim(coalesce(p_verification->>'method_code','')), '');
  v_procedure text := nullif(btrim(coalesce(p_verification->>'procedure','')), '');
  v_criteria text := nullif(btrim(coalesce(p_verification->>'acceptance_criteria','')), '');
  v_outcome text := nullif(btrim(coalesce(p_verification->>'intended_outcome','')), '');
  v_due date := sync_text_as_date(p_verification->>'due_date');
  v_assumed boolean := false;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'stating how a requirement will be verified is a §70 human act — the AI-operator identity reports requirements with no verification method, it does not supply one. An identity that could state the method could clear its own finding.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'planning a verification requires a planning, engineering or governance role');
  end if;
  select * into d from design_requirements
   where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;
  if v_method is null or not (v_method = any (sync_verification_methods())) then
    return jsonb_build_object('error',
      format('method_code must be one of the five §11 methods: %s',
        array_to_string(sync_verification_methods(), ', ')));
  end if;
  if v_criteria is null and coalesce(btrim(d.acceptance_criteria), '') = '' then
    return jsonb_build_object('error',
      'state the acceptance criteria — what result counts as met. A TEST with nothing to test against produces a number nobody can call a pass or a fail, and the requirement carries no criteria either.');
  end if;
  if p_verification ? 'due_date'
     and nullif(btrim(coalesce(p_verification->>'due_date','')), '') is not null
     and v_due is null then
    return jsonb_build_object('error', 'due_date is not a valid date');
  end if;
  if v_due is null then
    -- The 20260901140000 rule, restated: an obligation with no due date can
    -- never become overdue, and invisible is the one thing an open
    -- verification must not be. So a date is assumed AND says it is assumed.
    v_due := current_date + 30;
    v_assumed := true;
  end if;
  if exists (select 1 from verification_obligations o
              where o.requirement_id = d.id and o.method_code = v_method
                and o.status = 'open') then
    return jsonb_build_object('error',
      format('an OPEN %s verification already stands against %s. Record its result before planning another of the same method, or the two will disagree about whether the requirement is verified.',
        v_method, d.requirement_ref));
  end if;

  insert into verification_obligations (
    organization_id, recommendation_id, requirement_id, development_case_id,
    asset_id, method, method_code, procedure, acceptance_criteria,
    intended_outcome, due_date, due_date_assumed, created_by)
  values (
    v_org, null, d.id, d.development_case_id,
    d.satisfied_by_asset_id,
    -- `method` is NOT NULL on the table and is the human-readable statement.
    -- For a requirement it is the §11 method spelled out, so the two columns
    -- can never disagree about what was promised.
    v_method, v_method, v_procedure,
    coalesce(v_criteria, d.acceptance_criteria),
    v_outcome, v_due, v_assumed, auth.uid())
  returning id into v_id;

  -- The requirement's own stated method follows the verification that was
  -- planned. It is the summary of the verifications against it, never an
  -- independent claim (ruling 5).
  update design_requirements
     set verification_method = case
           when coalesce(btrim(verification_method), '') = '' then v_method
           else verification_method end
   where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'requirement_verification', coalesce(v_role, 'unknown'),
    jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
      'obligation_id', v_id, 'method', v_method, 'case_id', d.development_case_id),
    jsonb_build_object('verification_method', d.verification_method,
      'verification_status', d.verification_status),
    jsonb_build_object('verification_method',
        case when coalesce(btrim(d.verification_method), '') = '' then v_method
             else d.verification_method end,
      'verification_status', d.verification_status,
      'obligation_status', 'open', 'method_code', v_method,
      'due_date', v_due, 'due_date_assumed', v_assumed));

  return jsonb_build_object(
    'obligation_id', v_id, 'requirement_id', d.id,
    'requirementRef', d.requirement_ref, 'methodCode', v_method,
    'dueDate', v_due, 'dueDateAssumed', v_assumed,
    'note', case when v_assumed
      then 'No due date was stated, so one was ASSUMED at 30 days and is marked assumed. An obligation with no due date can never become overdue, and an open verification that can never be overdue is invisible.'
      else 'Due date recorded as stated.' end);
end
$$;

revoke all on function public.create_requirement_verification(bigint, jsonb) from public, anon;
grant execute on function public.create_requirement_verification(bigint, jsonb) to authenticated, service_role;

comment on function public.create_requirement_verification(bigint, jsonb) is
  'D4.17 / spec §11: plans a Verification against a requirement with one of the five methods, a procedure, acceptance criteria and a due date that is real or declared assumed. §70: refused to the AI-operator identity BY NAME — stating the method is the finding the Requirements Agent exists to raise.';

-- ---------------------------------------------------------------------------
-- 6. record_verification_result — RE-CREATED, not replaced.
--
--    WHAT IS PRESERVED, deliberately and exactly: the function name, the
--    three argument NAMES and their order, every existing refusal sentence,
--    the learning_events insert on not_achieved, and the three return
--    columns. `recordVerificationResult` in operatingLoopService passes
--    p_obligation_id / p_result / p_measured_note by name and keeps working
--    unchanged — this is the caller PR #309 added and it is not being broken
--    to add a fourth parameter.
--
--    WHAT IS ADDED:
--      * p_evidence_id (§11's evidence_id), defaulted so the shipped caller
--        still resolves. The 3-argument signature is dropped first, because
--        leaving it beside a 4-argument version with a default makes every
--        3-named-argument call ambiguous.
--      * a role check — there was none;
--      * the §70 refusal by name;
--      * the requirement branch: a result against a requirement moves that
--        requirement's verification_status, which is the "what verifies this
--        requirement" half of D4.16's traceability chain actually closing;
--      * an audit_events row carrying previous_state and new_state.
-- ---------------------------------------------------------------------------
drop function if exists record_verification_result(uuid, text, text);
create or replace function public.record_verification_result(
  p_obligation_id uuid,
  p_result text,
  p_measured_note text,
  p_evidence_id uuid default null
)
returns table (outcome text, "learningEventId" uuid, detail text)
language plpgsql security definer set search_path = public as $$
declare
  o verification_obligations%rowtype;
  r recommendations%rowtype;
  d design_requirements%rowtype;
  v_role text;
  v_le uuid;
  v_new_status text;
begin
  select * into o from verification_obligations
  where id = p_obligation_id and organization_id = app_current_org();
  if not found then
    return query select 'error'::text, null::uuid, 'No such obligation in this organization.'::text;
    return;
  end if;

  select role into v_role from user_profiles
   where id = auth.uid() and organization_id = o.organization_id;
  -- §70, at the door. The wall behind it (trg_verification_recorder_is_human)
  -- refuses the same attribution for every writer, service included.
  if coalesce(v_role, '') = 'ai_admin' then
    return query select 'refused'::text, null::uuid,
      ('Recording a verification result is a §70 human act. The AI-operator identity may report that an '
       || 'obligation is open, overdue or unverified; it may not say whether the outcome was achieved. '
       || 'A machine that can close its own verification loop has no loop.')::text;
    return;
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner','technician') then
    return query select 'refused'::text, null::uuid,
      ('Recording a verification result requires a role that can be held accountable for having looked. '
       || 'Verification is a named act by a named person.')::text;
    return;
  end if;

  if o.status <> 'open' then
    return query select 'refused'::text, null::uuid,
      format('Obligation is already %s. A verification is recorded once; a second '
             || 'opinion belongs in a new observation, not an overwrite.', o.status);
    return;
  end if;
  if p_result not in ('achieved','not_achieved','inconclusive') then
    return query select 'error'::text, null::uuid,
      'Result must be achieved, not_achieved or inconclusive.'::text;
    return;
  end if;
  if coalesce(btrim(p_measured_note),'') = '' then
    return query select 'refused'::text, null::uuid,
      ('A result with no measurement is an opinion. Record what was measured, '
       || 'against what, and when.')::text;
    return;
  end if;
  if p_evidence_id is not null
     and not exists (select 1 from evidence_items e
                      where e.id = p_evidence_id
                        and e.organization_id = o.organization_id) then
    return query select 'refused'::text, null::uuid,
      ('That evidence item is not in this organization. A verification result cites evidence the '
       || 'organization can produce on request, or it cites none.')::text;
    return;
  end if;

  select * into r from recommendations where id = o.recommendation_id;

  if p_result = 'not_achieved' and o.recommendation_id is not null then
    insert into learning_events (
      organization_id, recommendation_id, asset_id, event_type, title, detail
    ) values (
      o.organization_id, o.recommendation_id, o.asset_id,
      'verification_failed',
      format('Verification failed: %s', coalesce(r.title, 'recommendation')),
      format('The approved action did not produce the intended outcome. Method: %s. '
             || 'Measured: %s. The action was taken and the problem remains — the '
             || 'strategy that produced this recommendation needs re-examination, '
             || 'not a repeat of the same action.',
             o.method, p_measured_note)
    ) returning id into v_le;
  end if;

  perform set_config('app.verification_result_write', 'granted', true);
  update verification_obligations set
    status = 'completed',
    result = p_result,
    measured_note = p_measured_note,
    evidence_id = coalesce(p_evidence_id, evidence_id),
    verified_by = auth.uid(),
    verified_at = now(),
    learning_event_id = v_le
  where id = p_obligation_id;
  perform set_config('app.verification_result_write', '', true);

  -- ── The requirement branch (ruling 5) ────────────────────────────────────
  if o.requirement_id is not null then
    select * into d from design_requirements where id = o.requirement_id;
    v_new_status := case p_result
      when 'achieved' then 'verified'
      when 'not_achieved' then 'failed'
      -- Inconclusive leaves the requirement OPEN. A verification that could
      -- not decide has not verified anything, and moving the status would
      -- record a determination that was explicitly not made.
      else d.verification_status end;
    update design_requirements set
      verification_status = v_new_status,
      verified_at = case when p_result = 'achieved' then now() else verified_at end
    where id = d.id;

    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (o.organization_id, 'requirement_verification_result',
      coalesce(v_role, 'unknown'),
      jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
        'obligation_id', o.id, 'method_code', o.method_code,
        'result', p_result, 'evidence_id', p_evidence_id),
      jsonb_build_object('verification_status', d.verification_status,
        'obligation_status', o.status, 'result', o.result),
      jsonb_build_object('verification_status', v_new_status,
        'obligation_status', 'completed', 'result', p_result,
        'verified_by', auth.uid()));
  else
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (o.organization_id, 'verification_result', coalesce(v_role, 'unknown'),
      jsonb_build_object('obligation_id', o.id,
        'recommendation_id', o.recommendation_id, 'result', p_result,
        'learning_event_id', v_le, 'evidence_id', p_evidence_id),
      jsonb_build_object('obligation_status', o.status, 'result', o.result),
      jsonb_build_object('obligation_status', 'completed', 'result', p_result,
        'verified_by', auth.uid()));
  end if;

  return query select 'recorded'::text, v_le,
    case p_result
      when 'achieved' then
        case when o.requirement_id is null
          then 'Outcome verified as achieved, with the measurement on record. This loop is closed.'
          else 'Requirement verified as achieved, with the measurement on record. The requirement''s status now rests on this result rather than on anybody''s assertion.'
        end
      when 'not_achieved' then
        case when v_le is not null then
          format('Outcome NOT achieved — recorded honestly, and a learning event (%s) now '
                 || 'carries it into strategy re-examination. A failed verification recorded '
                 || 'is worth more than a passed one assumed.', v_le)
        else
          'Requirement NOT verified — recorded honestly. The requirement is now FAILED rather than '
          || 'open, because "we looked and it did not meet the criteria" is a different state from '
          || '"nobody has looked yet", and a gate that cannot tell them apart is not a gate.'
        end
      else
        'Inconclusive, with the measurement on record. Inconclusive is a real result — '
        || 'it usually means the method was not measurable as written, which is itself '
        || 'feedback for the next recommendation. The subject stays OPEN: a verification '
        || 'that could not decide has not decided.'
    end;
end;
$$;

revoke all on function public.record_verification_result(uuid, text, text, uuid) from public, anon;
grant execute on function public.record_verification_result(uuid, text, text, uuid) to authenticated, service_role;

comment on function public.record_verification_result(uuid, text, text, uuid) is
  'C4.08 + D4.17 / spec §11: records a verification result against a recommendation-scoped or requirement-scoped obligation, with §11''s evidence_id. §70: refuses the AI-operator identity BY NAME at the door and at the persistence wall. A requirement result MOVES that requirement''s verification_status — the status is never typed directly.';

-- ---------------------------------------------------------------------------
-- 7. The LEARN posture stays exactly the number it was (ruling 2).
-- ---------------------------------------------------------------------------
drop function if exists get_verification_posture();
create or replace function get_verification_posture()
returns table (
  "actionedRecommendations" int,
  "withObligation" int,
  "openObligations" int,
  overdue int,
  achieved int,
  "notAchieved" int,
  inconclusive int,
  waived int,
  "actionedWithoutObligation" int,
  basis text
)
language sql stable security definer set search_path = public as $$
  with r as (
    select * from recommendations
    where organization_id = app_current_org()
      and status in ('approved','released','scheduled','completed')
  ),
  o as (
    -- RULING 2. Requirement-scoped obligations are counted by the develop
    -- read, not here: this posture measures the OPERATING loop against a
    -- recommendation denominator, and mixing the two would drift the C4.08
    -- loop-closure figure for a reason that has nothing to do with it.
    select * from verification_obligations
    where organization_id = app_current_org() and recommendation_id is not null
  )
  select
    (select count(*)::int from r),
    (select count(*)::int from r where exists (select 1 from o where o.recommendation_id = r.id)),
    (select count(*)::int from o where status = 'open'),
    (select count(*)::int from o where status = 'open' and due_date < current_date),
    (select count(*)::int from o where result = 'achieved'),
    (select count(*)::int from o where result = 'not_achieved'),
    (select count(*)::int from o where result = 'inconclusive'),
    (select count(*)::int from o where status = 'waived'),
    (select count(*)::int from r where not exists (select 1 from o where o.recommendation_id = r.id)),
    format(
      'Of %s actioned recommendation(s), %s carry a verification obligation and %s do not '
      || '— those predate the obligation trigger, and their loops are open with nothing '
      || 'watching. %s obligation(s) are open, %s of them past due. Results so far: '
      || '%s achieved, %s not achieved, %s inconclusive. A verification that never '
      || 'happens looks identical to one that passed, which is why the overdue count '
      || 'is the number to watch.',
      (select count(*) from r),
      (select count(*) from r where exists (select 1 from o where o.recommendation_id = r.id)),
      (select count(*) from r where not exists (select 1 from o where o.recommendation_id = r.id)),
      (select count(*) from o where status = 'open'),
      (select count(*) from o where status = 'open' and due_date < current_date),
      (select count(*) from o where result = 'achieved'),
      (select count(*) from o where result = 'not_achieved'),
      (select count(*) from o where result = 'inconclusive'));
$$;

-- Re-created here, so the tenancy gate scopes it to THIS file — and it found
-- that the shipped definition (20260901140000) never revoked PUBLIC, leaving
-- an org-scoped posture executable by anon. Tightened, not carried forward.
revoke all on function get_verification_posture() from public, anon;
grant execute on function get_verification_posture() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. get_open_verifications — requirement obligations become VISIBLE.
--
--    THE BUG THIS FIXES BEFORE IT SHIPS: the shipped body INNER JOINs
--    recommendations. A requirement-scoped obligation has no recommendation,
--    so every one of them would have been silently dropped from the only live
--    open-verification surface in the product — created, overdue and
--    invisible, which is the exact failure mode 20260901140000's own header
--    names. The join is now LEFT and the subject is labelled.
--
--    The three existing columns keep their names and meanings so
--    VerificationLoop.tsx keeps rendering.
-- ---------------------------------------------------------------------------
drop function if exists get_open_verifications(int);
create or replace function get_open_verifications(p_limit int default 50)
returns table (
  "obligationId" uuid,
  "recommendationTitle" text,
  "assetName" text,
  method text,
  "dueDate" date,
  "dueDateAssumed" boolean,
  "daysOverdue" int,
  "intendedOutcome" text,
  "subjectKind" text,
  "requirementRef" text,
  "methodCode" text
)
language sql stable security definer set search_path = public as $$
  select o.id,
         coalesce(r.title, d.requirement, 'requirement verification'),
         a.name, o.method, o.due_date, o.due_date_assumed,
         greatest(0, (current_date - o.due_date))::int,
         o.intended_outcome,
         case when o.requirement_id is not null then 'requirement' else 'recommendation' end,
         d.requirement_ref,
         o.method_code
  from verification_obligations o
  left join recommendations r on r.id = o.recommendation_id
  left join design_requirements d on d.id = o.requirement_id
  left join assets a on a.id = o.asset_id
  where o.organization_id = app_current_org() and o.status = 'open'
  order by o.due_date, coalesce(r.title, d.requirement_ref)
  limit greatest(1, p_limit);
$$;

revoke all on function get_open_verifications(int) from public, anon;
grant execute on function get_open_verifications(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. get_case_requirement_verifications — the develop-side read.
--
--    Refusal-first: over a case with no requirements it REFUSES rather than
--    reporting a comfortable "0 open, 0 overdue", for the reason
--    get_case_requirement_traceability gives at length. A coverage percentage
--    with a zero denominator is null with a stated reason.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_requirement_verifications(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_reqs int;
  v_with int;
  v_open int;
  v_overdue int;
  v_pct numeric;
  v_refusals jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*) into v_reqs from design_requirements d
   where d.development_case_id = c.id;

  if v_reqs = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'requirementCount', 0,
      'verificationCoveragePct', null,
      'refusal',
        'No requirement has been recorded on this case, so there is nothing to verify and nothing to report. "0 open verifications, 0 overdue" over an empty requirement set reads as a case in good standing and is not one.',
      'methods', to_jsonb(sync_verification_methods()),
      'verifications', '[]'::jsonb);
  end if;

  select
    count(distinct o.requirement_id),
    count(*) filter (where o.status = 'open'),
    count(*) filter (where o.status = 'open' and o.due_date < current_date)
  into v_with, v_open, v_overdue
  from verification_obligations o
  where o.organization_id = c.organization_id
    and o.requirement_id is not null
    and o.development_case_id = c.id;

  if v_reqs > 0 then
    v_pct := round((coalesce(v_with,0)::numeric / v_reqs::numeric) * 100, 1);
    if v_pct = 'NaN'::numeric then
      v_pct := null;
      v_refusals := v_refusals || to_jsonb(
        'The verification coverage percentage was non-finite and has been refused rather than displayed.'::text);
    end if;
  end if;

  return jsonb_build_object(
    'caseId', c.id, 'refused', false,
    'requirementCount', v_reqs,
    'requirementsWithAVerification', coalesce(v_with, 0),
    'openVerifications', coalesce(v_open, 0),
    'overdue', coalesce(v_overdue, 0),
    'verificationCoveragePct', v_pct,
    'methods', to_jsonb(sync_verification_methods()),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'obligationId', o.id,
        'requirementId', o.requirement_id,
        'requirementRef', d.requirement_ref,
        'requirement', d.requirement,
        'methodCode', o.method_code,
        'procedure', o.procedure,
        'acceptanceCriteria', o.acceptance_criteria,
        'status', o.status,
        'result', o.result,
        'measuredNote', o.measured_note,
        'dueDate', o.due_date,
        'dueDateAssumed', o.due_date_assumed,
        'daysOverdue', case when o.status = 'open'
          then greatest(0, (current_date - o.due_date))::int else 0 end,
        'evidenceId', o.evidence_id,
        'verifiedAt', o.verified_at,
        'verifiedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = o.verified_by))
        order by o.due_date, d.requirement_ref)
      from verification_obligations o
      join design_requirements d on d.id = o.requirement_id
      where o.organization_id = c.organization_id
        and o.development_case_id = c.id
        and o.requirement_id is not null), '[]'::jsonb),
    'refusals', v_refusals);
end
$$;

revoke all on function public.get_case_requirement_verifications(uuid) from public, anon;
grant execute on function public.get_case_requirement_verifications(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_verifications(uuid) is
  'D4.17 / §11: every Verification planned and recorded against this case''s requirements, with the five methods. REFUSES over an empty requirement set rather than reporting zero open and zero overdue.';

notify pgrst, 'reload schema';
