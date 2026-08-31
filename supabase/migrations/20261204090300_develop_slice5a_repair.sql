-- ============================================================================
-- Sync Develop Slice 5A — REPAIR (D4.16, D4.17, D12.09).
--
-- Three adversarial reviews read 20261204090000/090100/090200 and found the
-- same shape of defect three times: a rule stated in the prose and enforced at
-- ONE door, with the wall behind the door missing. This file builds the walls
-- and closes the honesty gaps the reviews proved live.
--
-- ── RULING 7 — THE DOOR IS NOT THE WALL, AND THIS SLICE SAID SO ITSELF ─────
--
-- 20261204090000:363 wrote the rule for design_requirements: "Every FK proves
-- the target EXISTS. None of them proves the target belongs to this tenant."
-- 20261204090100 then added requirement_id, development_case_id and
-- evidence_id to verification_obligations and did NOT apply it. Proven live:
-- an org-1 obligation pointing at an org-2 requirement was accepted with no
-- objection, after which an ORDINARY org-1 planner moved an org-2
-- requirement to `verified` through the production RPC, and the only audit
-- row landed in org 1 — org 2 has no record that a stranger verified its
-- requirement. Section 1 is the missing wall; section 4 org-scopes the two
-- reads and the write that agreed with it.
--
-- ── RULING 8 — A LATER PASS DOES NOT UN-FAIL AN EARLIER FAILURE ────────────
--
-- record_verification_result mapped the LATEST result onto the requirement's
-- status. Proven live, through the production RPCs as an ordinary planner: a
-- 12-month TEST recorded `not_achieved` (status -> failed), then a desktop
-- ANALYSIS recorded `achieved` (status -> verified), and NOTHING anywhere
-- raised the contradiction — not the traceability report, not one of the
-- Requirements Agent's five families. The evidence survived on the obligation
-- table and every derived number read clean.
--
-- The status is now DERIVED from the whole obligation set rather than from
-- the last write, which is what 20261204090100's own ruling 5 claimed it was:
--
--     failed    if any completed not_achieved obligation stands UNSUPERSEDED
--     verified  else if any completed achieved obligation exists
--     unchanged otherwise
--
-- and a failure stops standing only when a human plans a NEW verification
-- that NAMES it (`supersedes_obligation_id`, section 3). Naming it is the
-- act: re-testing after a repair is ordinary engineering and must stay
-- possible, but it must be RECORDED as "this re-verifies the failure of
-- obligation X", never inferred from two rows arriving in a helpful order.
-- The superseded failure stays on the table, in the report and on screen.
--
-- ── RULING 9 — DELETION IS THE HOLE EVERY OTHER WALL IS BUILT AROUND ───────
--
-- verification_obligations got a provenance wall whose DELETE branch says
-- deleting a recorded failure would make it "indistinguishable from a
-- verification that was never owed" — and then returned `old` whenever the
-- parent requirement was already gone. design_requirements had NO provenance
-- trigger at all, so the wall was bypassed by deleting one row one table up.
-- Proven live: `delete from design_requirements where id = <parent>` removed
-- a parent, its child and the child's recorded not_achieved TEST in one
-- statement, with zero audit rows, and coverage IMPROVED because both rows
-- left the denominator. Section 5.
--
-- ── RULING 10 — THE AGENT MAY NOT CLEAR ITS OWN FINDINGS ──────────────────
--
-- 20261204090100:88 refused the AI-operator identity at
-- create_requirement_verification because "an identity that could state the
-- method could clear its own finding". The identical reasoning was not
-- applied to link_requirement_thread, which this slice created and which
-- writes owner, objective, acceptance criteria, KPI and parent — three of the
-- agent's five families. Proven live: as `ai_admin`, one call took a
-- requirement from 4 findings to 2, and record_case_requirement accepted a
-- `verification_method` from the same identity. Section 7 refuses both by
-- name, and the DB-level negative test in the Slice 3D idiom covers the
-- finding-clearing path rather than only the verification path.
--
-- ── WHAT IS NOT DONE HERE, AND WHY ────────────────────────────────────────
--
-- No table is created. No store is forked. Every function below is a
-- re-creation of one this slice already shipped, or a trigger it should have
-- shipped beside it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The tenancy wall on verification_obligations (ruling 7).
--
--    Five foreign keys, five tenants to agree with. INSERT and UPDATE, every
--    writer, no marker and no service escape: a cross-tenant subject is not a
--    provenance question, it is corrupt data — the same ruling the hierarchy
--    trigger makes about a cycle.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_subject_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requirement_id is not null
     and not exists (select 1 from design_requirements d
                      where d.id = new.requirement_id
                        and d.organization_id = new.organization_id) then
    raise exception
      'That requirement belongs to another organization. A verification obligation names a requirement inside its own tenant; anything else is a cross-tenant write dressed as assurance — the obligation would carry one organization''s name while moving another organization''s requirement to verified.'
      using errcode = 'check_violation';
  end if;
  if new.development_case_id is not null
     and not exists (select 1 from development_cases c
                      where c.id = new.development_case_id
                        and c.organization_id = new.organization_id) then
    raise exception
      'That development case belongs to another organization. The case scoping of a verification is inside the tenant or absent.'
      using errcode = 'check_violation';
  end if;
  if new.evidence_id is not null
     and not exists (select 1 from evidence_items e
                      where e.id = new.evidence_id
                        and e.organization_id = new.organization_id) then
    raise exception
      'That evidence item belongs to another organization. A verification cites evidence THIS organization can produce on request, or it cites none.'
      using errcode = 'check_violation';
  end if;
  if new.asset_id is not null
     and not exists (select 1 from assets a
                      where a.id = new.asset_id
                        and a.organization_id = new.organization_id) then
    raise exception
      'That asset belongs to another organization. The asset a verification is performed on is inside the tenant or absent.'
      using errcode = 'check_violation';
  end if;
  if new.recommendation_id is not null
     and not exists (select 1 from recommendations r
                      where r.id = new.recommendation_id
                        and r.organization_id = new.organization_id) then
    raise exception
      'That recommendation belongs to another organization. The obligation and the recommendation it discharges are one tenant''s, or the loop being closed is not the loop that was opened.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_verification_subject_tenancy()
  from public, anon, authenticated;

drop trigger if exists trg_verification_subject_tenancy on public.verification_obligations;
create trigger trg_verification_subject_tenancy
  before insert or update on public.verification_obligations
  for each row execute function public.enforce_verification_subject_tenancy();

comment on function public.enforce_verification_subject_tenancy() is
  'D4.17 ruling 7: every foreign key on verification_obligations proves the target EXISTS; this proves it belongs to the obligation''s tenant. INSERT and UPDATE, every writer, no marker.';

-- ---------------------------------------------------------------------------
-- 2. The provenance wall, widened to the columns that made the result mean
--    something.
--
--    The shipped UPDATE branch guarded result / verified_by / verified_at /
--    status / evidence_id. Proven live as a service writer with no marker, on
--    a COMPLETED obligation: the MEASUREMENT was rewritable ("REWRITTEN 99.9
--    percent, no evidence needed"), the METHOD was rewritable after the fact,
--    the SUBJECT was re-pointable at a different requirement and the TENANT
--    was movable. The RPC's own refusal says a result with no measurement is
--    an opinion; the measurement was the one field left mutable.
--
--    Two classes, deliberately different:
--      * subject and tenant are frozen ALWAYS. Re-pointing an obligation at
--        another requirement is not a correction, it is a recorded result
--        being moved onto a different claim.
--      * the measurement, the method and the criteria are frozen ONCE the
--        obligation stops being open. While it is open there is nothing to
--        launder, and there is no act in this product that edits an open one.
--
--    AND the referential-action hole is closed. `evidence_id` is declared
--    `on delete set null`, which performs an ordinary UPDATE and therefore
--    hit this wall: deleting an evidence item — an ordinary client act,
--    evidence_items is FOR ALL to authenticated — failed with a message about
--    recording verification results, for something the user did not do. The
--    RI path is admitted when the evidence row is genuinely gone AND nothing
--    else on the obligation moved, and it writes an audit row, because a
--    citation that disappears silently is the same defect this file's ruling 9
--    is about one table over.
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

  -- The referential-action path: evidence_items row deleted, its citation
  -- severed by the FK, and NOTHING else on this obligation moved.
  if new.evidence_id is null and old.evidence_id is not null
     and not exists (select 1 from evidence_items e where e.id = old.evidence_id)
     and new.result is not distinct from old.result
     and new.verified_by is not distinct from old.verified_by
     and new.verified_at is not distinct from old.verified_at
     and new.status is not distinct from old.status
     and new.measured_note is not distinct from old.measured_note
     and new.requirement_id is not distinct from old.requirement_id
     and new.recommendation_id is not distinct from old.recommendation_id
     and new.organization_id is not distinct from old.organization_id then
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (old.organization_id, 'verification_evidence_severed', 'system',
      jsonb_build_object('obligation_id', old.id,
        'requirement_id', old.requirement_id,
        'recommendation_id', old.recommendation_id,
        'evidence_id', old.evidence_id),
      jsonb_build_object('evidence_id', old.evidence_id),
      jsonb_build_object('evidence_id', null,
        'reason', 'the cited evidence item was deleted; the citation was severed by the foreign key, and the measurement and the result are unchanged'));
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

  -- The subject and the tenant, frozen always.
  if new.requirement_id is distinct from old.requirement_id
     or new.recommendation_id is distinct from old.recommendation_id
     or new.organization_id is distinct from old.organization_id then
    raise exception
      'The subject of a verification obligation and the organization it belongs to are fixed when it is created. Re-pointing a recorded verification at a different requirement, a different recommendation or a different tenant moves a measurement onto a claim it was never made about — plan a new verification instead.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The measurement, the method and the criteria, frozen once it is closed.
  if old.status <> 'open'
     and (new.measured_note is distinct from old.measured_note
          or new.method is distinct from old.method
          or new.method_code is distinct from old.method_code
          or new.acceptance_criteria is distinct from old.acceptance_criteria
          or new.procedure is distinct from old.procedure) then
    raise exception
      'What was measured, how, and against which criteria are frozen once a verification is no longer open. A result whose measurement can be rewritten afterwards is the opinion record_verification_result refuses to accept in the first place.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_verification_result_provenance()
  from public, anon, authenticated;

comment on function public.enforce_verification_result_provenance() is
  'D4.17 §70 backstop, widened (repair ruling 7): result / verifier / status / evidence move only under record_verification_result''s marker; the SUBJECT and the TENANT are frozen always; the MEASUREMENT, method and criteria are frozen once the obligation is closed. The evidence-item deletion path is admitted and AUDITED rather than failing an ordinary act with a message about verification results.';

-- ---------------------------------------------------------------------------
-- 3. Supersession, and the derived requirement status (ruling 8).
-- ---------------------------------------------------------------------------
alter table public.verification_obligations
  add column if not exists supersedes_obligation_id uuid
    references verification_obligations(id) on delete restrict;

create index if not exists idx_verification_supersedes
  on verification_obligations(supersedes_obligation_id)
  where supersedes_obligation_id is not null;

comment on column public.verification_obligations.supersedes_obligation_id is
  'D4.17 ruling 8: the recorded FAILURE this verification was planned to re-test. A failed verification stops standing only when a human names it here; it is never inferred from a later achieved result arriving on a different method.';

-- Whether a requirement carries a recorded failure that nothing has
-- superseded. ONE implementation, read by the status derivation, by the
-- traceability report and by the Requirements Agent, so the three cannot
-- disagree about whether a failure still stands.
create or replace function public.requirement_has_unretracted_failure(p_requirement_id bigint)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from verification_obligations f
     where f.requirement_id = p_requirement_id
       and f.status = 'completed'
       and f.result = 'not_achieved'
       and not exists (
         select 1 from verification_obligations s
          where s.supersedes_obligation_id = f.id
            and s.status = 'completed'
            and s.result = 'achieved'));
$$;

revoke all on function public.requirement_has_unretracted_failure(bigint) from public, anon;
grant execute on function public.requirement_has_unretracted_failure(bigint) to authenticated, service_role;

comment on function public.requirement_has_unretracted_failure(bigint) is
  'D4.17 ruling 8: TRUE when a completed not_achieved verification stands against this requirement and no completed achieved verification NAMES it as superseded. The one predicate behind the derived status, the traceability bucket and the agent finding.';

-- The derived status itself. `verified` is reachable only when nothing failed
-- and something passed; a single unretracted failure holds the requirement at
-- `failed` however many later passes arrive.
create or replace function public.derive_requirement_verification_status(
  p_requirement_id bigint,
  p_current text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- 'waived' is a governance decision about a requirement, not a reading of
    -- its verifications, and no verification result overwrites it.
    when p_current = 'waived' then 'waived'
    when requirement_has_unretracted_failure(p_requirement_id) then 'failed'
    when exists (select 1 from verification_obligations o
                  where o.requirement_id = p_requirement_id
                    and o.status = 'completed' and o.result = 'achieved')
      then 'verified'
    else p_current
  end;
$$;

revoke all on function public.derive_requirement_verification_status(bigint, text) from public, anon;
grant execute on function public.derive_requirement_verification_status(bigint, text) to authenticated, service_role;

comment on function public.derive_requirement_verification_status(bigint, text) is
  'D4.17 ruling 8: a requirement''s verification status DERIVED from every verification recorded against it, not from the last one written. An unretracted failure outranks any number of later passes.';

-- ---------------------------------------------------------------------------
-- 3b. create_requirement_verification — RE-CREATED carrying the supersession.
--
--     Every refusal of the shipped version is preserved verbatim. What is
--     added is `supersedes_obligation_id`: the failure this re-verification
--     answers, validated to be a COMPLETED not_achieved obligation against
--     the SAME requirement in the SAME tenant, not already answered.
--
--     And the door is now honest about the failure it is walking past: a
--     planner who plans a verification against a requirement carrying an
--     unretracted failure, and does NOT name it, is told so in the returned
--     note rather than discovering later that the requirement never left
--     `failed`.
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
  s verification_obligations%rowtype;
  v_method text := nullif(btrim(coalesce(p_verification->>'method_code','')), '');
  v_procedure text := nullif(btrim(coalesce(p_verification->>'procedure','')), '');
  v_criteria text := nullif(btrim(coalesce(p_verification->>'acceptance_criteria','')), '');
  v_outcome text := nullif(btrim(coalesce(p_verification->>'intended_outcome','')), '');
  v_due date := sync_text_as_date(p_verification->>'due_date');
  v_supersedes uuid := sync_text_as_uuid(p_verification->>'supersedes_obligation_id');
  v_assumed boolean := false;
  v_standing boolean;
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

  -- ── The supersession (ruling 8) ─────────────────────────────────────────
  if p_verification ? 'supersedes_obligation_id'
     and nullif(btrim(coalesce(p_verification->>'supersedes_obligation_id','')), '') is not null
     and v_supersedes is null then
    return jsonb_build_object('error', 'supersedes_obligation_id is not a valid identifier');
  end if;
  if v_supersedes is not null then
    select * into s from verification_obligations
     where id = v_supersedes and organization_id = v_org;
    if not found then
      return jsonb_build_object('error',
        'the verification being superseded is not in this organization');
    end if;
    if s.requirement_id is distinct from d.id then
      return jsonb_build_object('error',
        format('that verification was recorded against a different requirement. A re-verification supersedes a failure of the SAME requirement — %s cannot answer for a result recorded elsewhere.', d.requirement_ref));
    end if;
    if s.status <> 'completed' or coalesce(s.result, '') <> 'not_achieved' then
      return jsonb_build_object('error',
        'only a COMPLETED verification whose result was not_achieved can be superseded. An open verification is still owed and a passed one has nothing to answer for.');
    end if;
    if exists (select 1 from verification_obligations x
                where x.supersedes_obligation_id = s.id) then
      return jsonb_build_object('error',
        'that failure is already answered by another verification. Two re-verifications of one failure would make "was it re-tested" have two answers.');
    end if;
  end if;

  v_standing := requirement_has_unretracted_failure(d.id);

  insert into verification_obligations (
    organization_id, recommendation_id, requirement_id, development_case_id,
    asset_id, method, method_code, procedure, acceptance_criteria,
    intended_outcome, due_date, due_date_assumed, created_by,
    supersedes_obligation_id)
  values (
    v_org, null, d.id, d.development_case_id,
    d.satisfied_by_asset_id,
    v_method, v_method, v_procedure,
    coalesce(v_criteria, d.acceptance_criteria),
    v_outcome, v_due, v_assumed, auth.uid(), v_supersedes)
  returning id into v_id;

  update design_requirements
     set verification_method = case
           when coalesce(btrim(verification_method), '') = '' then v_method
           else verification_method end
   where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'requirement_verification', coalesce(v_role, 'unknown'),
    jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
      'obligation_id', v_id, 'method', v_method, 'case_id', d.development_case_id,
      'supersedes_obligation_id', v_supersedes),
    jsonb_build_object('verification_method', d.verification_method,
      'verification_status', d.verification_status),
    jsonb_build_object('verification_method',
        case when coalesce(btrim(d.verification_method), '') = '' then v_method
             else d.verification_method end,
      'verification_status', d.verification_status,
      'obligation_status', 'open', 'method_code', v_method,
      'due_date', v_due, 'due_date_assumed', v_assumed,
      'supersedes_obligation_id', v_supersedes));

  return jsonb_build_object(
    'obligation_id', v_id, 'requirement_id', d.id,
    'requirementRef', d.requirement_ref, 'methodCode', v_method,
    'dueDate', v_due, 'dueDateAssumed', v_assumed,
    'supersedesObligationId', v_supersedes,
    'note', case when v_assumed
      then 'No due date was stated, so one was ASSUMED at 30 days and is marked assumed. An obligation with no due date can never become overdue, and an open verification that can never be overdue is invisible.'
      else 'Due date recorded as stated.' end,
    'standingFailureNote', case
      when v_standing and v_supersedes is null then
        format('%s carries a recorded verification FAILURE that this verification does not name. It will stay FAILED whatever this one measures: a later pass by another method does not un-fail an earlier failure. If this verification re-tests that failure, plan it naming supersedes_obligation_id.', d.requirement_ref)
      when v_supersedes is not null then
        'This verification names the failure it re-tests. An achieved result will retract that failure and nothing else; the failed result stays on the record and stays visible.'
      else null end);
end
$$;

revoke all on function public.create_requirement_verification(bigint, jsonb) from public, anon;
grant execute on function public.create_requirement_verification(bigint, jsonb) to authenticated, service_role;

comment on function public.create_requirement_verification(bigint, jsonb) is
  'D4.17 / spec §11: plans a Verification against a requirement with one of the five methods, a procedure, acceptance criteria, a due date that is real or declared assumed, and OPTIONALLY the recorded failure it re-tests (ruling 8). §70: refused to the AI-operator identity BY NAME.';

-- ---------------------------------------------------------------------------
-- 4. record_verification_result — RE-CREATED. Same name, same four argument
--    names, same order: PR #309's caller (operatingLoopService
--    recordVerificationResult) resolves against this one unchanged.
--
--    THREE REPAIRS, and nothing else moves:
--      (a) the requirement branch is ORG-SCOPED. It read
--          `where id = o.requirement_id` with no org predicate and wrote a
--          status through it — proven live moving an org-2 requirement to
--          verified from an org-1 session (ruling 7).
--      (b) the status is DERIVED, not last-write-wins (ruling 8), and the
--          marker now spans the requirement write so section 5's wall can
--          refuse every other writer of that column.
--      (c) the returned detail SAYS what happened when a standing failure
--          held the requirement at failed. Recording the result must not
--          silently disagree with the status it produced.
-- ---------------------------------------------------------------------------
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
  v_held boolean := false;
begin
  select * into o from verification_obligations
  where id = p_obligation_id and organization_id = app_current_org();
  if not found then
    return query select 'error'::text, null::uuid, 'No such obligation in this organization.'::text;
    return;
  end if;

  select role into v_role from user_profiles
   where id = auth.uid() and organization_id = o.organization_id;
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

  -- ── The requirement branch, org-scoped and DERIVED ──────────────────────
  if o.requirement_id is not null then
    select * into d from design_requirements
     where id = o.requirement_id and organization_id = o.organization_id;
    if not found then
      perform set_config('app.verification_result_write', '', true);
      return query select 'error'::text, null::uuid,
        ('That obligation names a requirement in another organization. The result was not recorded: '
         || 'an obligation and the requirement it verifies belong to one tenant.')::text;
      return;
    end if;

    v_new_status := derive_requirement_verification_status(d.id, d.verification_status);
    v_held := (p_result = 'achieved' and v_new_status = 'failed');

    update design_requirements set
      verification_status = v_new_status,
      verified_at = case when v_new_status = 'verified' then now() else verified_at end
    where id = d.id and organization_id = o.organization_id;
    perform set_config('app.verification_result_write', '', true);

    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (o.organization_id, 'requirement_verification_result',
      coalesce(v_role, 'unknown'),
      jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
        'obligation_id', o.id, 'method_code', o.method_code,
        'result', p_result, 'evidence_id', p_evidence_id,
        'supersedes_obligation_id', o.supersedes_obligation_id,
        'held_by_standing_failure', v_held),
      jsonb_build_object('verification_status', d.verification_status,
        'obligation_status', o.status, 'result', o.result),
      jsonb_build_object('verification_status', v_new_status,
        'obligation_status', 'completed', 'result', p_result,
        'verified_by', auth.uid()));
  else
    perform set_config('app.verification_result_write', '', true);
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
    case
      when v_held then
        format('Result recorded as achieved — and %s STAYS FAILED. A recorded verification failure '
               || 'against it has not been superseded, and a later pass does not un-fail an earlier '
               || 'failure: the 12-month test that found the criterion unmet is still the strongest '
               || 'thing anybody knows about this requirement. To retract that failure, plan a '
               || 'verification that NAMES it (supersedes_obligation_id) and record its result.',
               d.requirement_ref)
      when p_result = 'achieved' then
        case when o.requirement_id is null
          then 'Outcome verified as achieved, with the measurement on record. This loop is closed.'
          else 'Requirement verified as achieved, with the measurement on record. The requirement''s status now rests on this result rather than on anybody''s assertion.'
        end
      when p_result = 'not_achieved' then
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
  'C4.08 + D4.17 / spec §11: records a verification result. §70 refuses the AI-operator identity at the door and at the wall. The requirement branch is ORG-SCOPED (repair ruling 7) and the requirement''s status is DERIVED from every verification against it (repair ruling 8) — an unretracted failure outranks any later pass, and the RPC says so.';

-- ---------------------------------------------------------------------------
-- 5. The provenance wall design_requirements never had (ruling 9).
--
--    Four branches, and the DELETE one is the reason the file exists:
--
--    INSERT  a requirement is not born verified, failed or waived. Every
--            shipped write path inserts at 'open' (record_case_requirement
--            takes the column default; the regulatory propagation states
--            'open' explicitly), so this refuses nothing that exists and
--            refuses the row that would arrive already claiming a result.
--    UPDATE  verification_status and verified_at move only under
--            record_verification_result's marker. The prose already claimed
--            "no act in this product types a status onto a requirement";
--            proven live as a service writer, `update design_requirements set
--            verification_status='verified'` was ALLOWED, with no exception,
--            no audit row and no security event. Detection existed (the
--            agent's verified_without_a_result finding fires) — a report is
--            not a wall.
--    DELETE  refused, except mid-cascade from a parent that is genuinely
--            already gone: the organization, the development case, the
--            capital project, or (for the self-FK) the parent requirement.
--            Proven live: one DELETE removed a parent, its child and the
--            child's recorded not_achieved TEST, and coverage IMPROVED
--            because both rows left the denominator.
--    TRUNCATE  refused for every caller, and the privilege is revoked. The
--            sibling table got both in the same slice; the table D4.16 has
--            just made the digital-thread spine got neither.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_provenance()
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
      'design_requirements is what the project said it had to be true, and whether anyone proved it. Truncating it erases every requirement and every recorded verification failure in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or (old.development_case_id is not null
           and not exists (select 1 from development_cases where id = old.development_case_id))
       or (old.project_id is not null
           and not exists (select 1 from capital_projects where id = old.project_id))
       or (old.parent_requirement_id is not null
           and not exists (select 1 from design_requirements where id = old.parent_requirement_id)) then
      return old;
    end if;
    raise exception
      'A requirement is not deleted. A requirement that turned out to be unnecessary is WAIVED with a stated reason and stays on the record; deleting it removes it from the numerator AND the denominator, so coverage IMPROVES and every verification recorded against it — including a failure — disappears with it.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.verification_status, 'open') <> 'open' and v_marker <> 'granted' then
      raise exception
        'A requirement cannot be created already carrying a verification status. Record the requirement, plan a verification against it, then record that verification''s result — a requirement born verified is a claim with nothing behind it.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE.
  if v_marker = 'granted' then
    return new;
  end if;
  if new.verification_status is distinct from old.verification_status
     or new.verified_at is distinct from old.verified_at then
    raise exception
      'A requirement''s verification status is DERIVED from the verifications recorded against it (record_verification_result), never typed onto it. Writing "verified" here would be an assertion with no measurement, no method, no named person and no date behind it.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_requirement_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_provenance on public.design_requirements;
create trigger trg_requirement_provenance
  before insert or update or delete on public.design_requirements
  for each row execute function public.enforce_requirement_provenance();

drop trigger if exists trg_requirement_no_truncate on public.design_requirements;
create trigger trg_requirement_no_truncate
  before truncate on public.design_requirements
  for each statement execute function public.enforce_requirement_provenance();

revoke truncate on table public.design_requirements from anon, authenticated, service_role;

comment on function public.enforce_requirement_provenance() is
  'D4.16 repair ruling 9: design_requirements gets the provenance wall its sibling verification_obligations already had. verification_status/verified_at move only under record_verification_result''s marker; DELETE is refused except mid-cascade; TRUNCATE is refused and revoked.';

-- ---------------------------------------------------------------------------
-- 5b. A thread link that DISAPPEARS is recorded.
--
--     link_requirement_thread refuses to clear a link by name — "a hop that
--     disappears is indistinguishable from one that never existed". Four of
--     the thread columns are `on delete set null`, and `assets` is fully
--     client-writable, so deleting an asset silently cleared
--     satisfied_by_asset_id on every requirement it satisfied: the
--     requirement rejoined the gap list, threadCoveragePct fell, and nothing
--     recorded that the link had ever existed. Proven live as an ordinary
--     planner, one DELETE, zero audit rows.
--
--     The referential action is KEPT — an asset that no longer exists cannot
--     go on being the answer to "what did this requirement become" — and the
--     severance is made VISIBLE instead. AFTER UPDATE, so it fires on the
--     FK's own write as readily as on anybody else's.
-- ---------------------------------------------------------------------------
create or replace function public.audit_requirement_thread_severance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lost text[] := array[]::text[];
begin
  if old.objective_id is not null and new.objective_id is null then
    v_lost := array_append(v_lost, 'objective_id');
  end if;
  if old.satisfied_by_asset_id is not null and new.satisfied_by_asset_id is null then
    v_lost := array_append(v_lost, 'satisfied_by_asset_id');
  end if;
  if old.commissioning_test_id is not null and new.commissioning_test_id is null then
    v_lost := array_append(v_lost, 'commissioning_test_id');
  end if;
  if old.operating_kpi_key is not null and new.operating_kpi_key is null then
    v_lost := array_append(v_lost, 'operating_kpi_key');
  end if;
  if old.scope_need_id is not null and new.scope_need_id is null then
    v_lost := array_append(v_lost, 'scope_need_id');
  end if;
  if array_length(v_lost, 1) is null then
    return null;
  end if;
  if not exists (select 1 from organizations where id = new.organization_id) then
    return null;
  end if;
  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (new.organization_id, 'requirement_thread_severed',
    coalesce((select role from user_profiles where id = auth.uid()), 'system'),
    jsonb_build_object('requirement_id', new.id,
      'requirement_ref', new.requirement_ref,
      'case_id', new.development_case_id,
      'links_lost', to_jsonb(v_lost)),
    jsonb_build_object('objective_id', old.objective_id,
      'satisfied_by_asset_id', old.satisfied_by_asset_id,
      'commissioning_test_id', old.commissioning_test_id,
      'operating_kpi_key', old.operating_kpi_key,
      'scope_need_id', old.scope_need_id),
    jsonb_build_object('objective_id', new.objective_id,
      'satisfied_by_asset_id', new.satisfied_by_asset_id,
      'commissioning_test_id', new.commissioning_test_id,
      'operating_kpi_key', new.operating_kpi_key,
      'scope_need_id', new.scope_need_id,
      'reason', 'the linked row was deleted; the digital-thread hop was severed by the foreign key rather than by an act of link_requirement_thread, which refuses to clear a link by name'));
  return null;
end
$$;

revoke all on function public.audit_requirement_thread_severance()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_thread_severance on public.design_requirements;
create trigger trg_requirement_thread_severance
  after update on public.design_requirements
  for each row execute function public.audit_requirement_thread_severance();

comment on function public.audit_requirement_thread_severance() is
  'D4.16 repair: a digital-thread hop severed by a foreign key''s ON DELETE SET NULL is recorded with previous_state and new_state. link_requirement_thread refuses to clear a link by name; without this, deleting the target did it silently and coverage moved for a reason nobody could find.';

-- ---------------------------------------------------------------------------
-- 6. The hierarchy wall, looking DOWN as well as up.
--
--    The shipped trigger validated a row's own parent and returned early when
--    it had none — so moving a ROOT to another case (or another org) left its
--    children behind. Proven live: parent moved to case B, child left on case
--    A, and case A's recursive tree could no longer reach a row it still
--    counted as a child. Not client-reachable (the case column is blocked for
--    authenticated writers) but the register row claims this trigger refuses a
--    cross-case hierarchy "for EVERY writer — no marker, no service escape",
--    and that claim now matches the code.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_hierarchy_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p design_requirements%rowtype;
  v_walk bigint;
  v_hops int := 0;
  v_stranded text;
begin
  -- Looking DOWN first: this row's own children have to stay in the same case
  -- and the same tenant as the row they hang off, whatever happens to its own
  -- parent link.
  if tg_op = 'UPDATE'
     and (new.development_case_id is distinct from old.development_case_id
          or new.organization_id is distinct from old.organization_id) then
    select ch.requirement_ref into v_stranded
      from design_requirements ch
     where ch.parent_requirement_id = new.id
       and (ch.development_case_id is distinct from new.development_case_id
            or ch.organization_id is distinct from new.organization_id)
     limit 1;
    if v_stranded is not null then
      raise exception
        'Moving this requirement would strand its child %, which stays on the case and organization this row is leaving. Decomposition happens inside one case: re-point or move the children first, or the case it leaves keeps counting a child whose parent it can no longer reach.',
        v_stranded
        using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_requirement_id is null then
    return new;
  end if;
  if new.parent_requirement_id = new.id then
    raise exception
      'A requirement cannot be its own parent. Decomposition means a requirement is broken into DIFFERENT requirements; a self-parent records a loop, not a breakdown.'
      using errcode = 'check_violation';
  end if;

  select * into p from design_requirements where id = new.parent_requirement_id;
  if not found then
    raise exception
      'Parent requirement % does not exist. A hierarchy that points at nothing is worse than a flat list, because it reads as decomposed.',
      new.parent_requirement_id
      using errcode = 'foreign_key_violation';
  end if;
  if p.organization_id <> new.organization_id then
    raise exception
      'A requirement cannot be nested under another organization''s requirement. The hierarchy is a tenant structure, and a parent outside the tenant is a tenancy hole wearing an org chart.'
      using errcode = 'check_violation';
  end if;
  if new.development_case_id is not null
     and p.development_case_id is distinct from new.development_case_id then
    raise exception
      'The parent requirement belongs to a different development case. Decomposition happens inside one case; a cross-case parent makes both cases'' traceability reports wrong in opposite directions.'
      using errcode = 'check_violation';
  end if;

  v_walk := p.parent_requirement_id;
  while v_walk is not null loop
    v_hops := v_hops + 1;
    if v_walk = new.id then
      raise exception
        'That parent is already a descendant of this requirement — the link would close a cycle. A requirement hierarchy is a tree; a cycle in it makes "what does this requirement decompose into" unanswerable.'
        using errcode = 'check_violation';
    end if;
    if v_hops > 64 then
      raise exception
        'The requirement hierarchy above % is deeper than 64 levels, or already contains a cycle. Refusing rather than walking forever.',
        new.parent_requirement_id
        using errcode = 'check_violation';
    end if;
    select parent_requirement_id into v_walk
      from design_requirements where id = v_walk;
  end loop;

  return new;
end
$$;

revoke all on function public.enforce_requirement_hierarchy_integrity()
  from public, anon, authenticated;

comment on function public.enforce_requirement_hierarchy_integrity() is
  'D4.16: self-parent, cycle, cross-org parent, cross-case parent and (repair) a move that would STRAND this row''s children on the case it is leaving. INSERT and UPDATE, every writer, no marker and no service escape.';

-- ---------------------------------------------------------------------------
-- 7. §70 at the doors this slice opened (ruling 10).
--
--    link_requirement_thread writes owner, objective, acceptance criteria,
--    operating KPI and parent — the fields behind three of the Requirements
--    Agent's five deterministic families. It admitted `ai_admin`. Proven live
--    over the product API with a real AI-operator token: one call took a
--    requirement from 4 findings to 2 and the audit row records
--    actor = 'ai_admin'.
--
--    The refusal is BY NAME and it is the same sentence
--    create_requirement_verification already uses, because it is the same
--    rule: an identity that can clear its own finding is not reporting.
-- ---------------------------------------------------------------------------
create or replace function public.link_requirement_thread(
  p_requirement_id bigint,
  p_link jsonb
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
  v_before jsonb;
  v_after jsonb;
  v_objective uuid;
  v_asset uuid;
  v_test bigint;
  v_kpi text;
  v_parent bigint;
  v_owner uuid;
  v_criteria text;
  v_touched int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'attaching the digital thread is a §70 human act — the AI-operator identity REPORTS a requirement with no owner, no objective and no acceptance criteria; it does not supply them. An identity that could write those fields could clear its own finding, and a report nobody can trust to be independent of the fix is not a report.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking the requirement thread requires a planning, engineering or governance role');
  end if;
  select * into d from design_requirements
   where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;

  v_before := jsonb_build_object(
    'objective_id', d.objective_id, 'satisfied_by_asset_id', d.satisfied_by_asset_id,
    'commissioning_test_id', d.commissioning_test_id,
    'operating_kpi_key', d.operating_kpi_key,
    'parent_requirement_id', d.parent_requirement_id,
    'owner_id', d.owner_id, 'acceptance_criteria', d.acceptance_criteria);

  v_objective := d.objective_id;
  v_asset := d.satisfied_by_asset_id;
  v_test := d.commissioning_test_id;
  v_kpi := d.operating_kpi_key;
  v_parent := d.parent_requirement_id;
  v_owner := d.owner_id;
  v_criteria := d.acceptance_criteria;

  if p_link ? 'objective_id' then
    if nullif(btrim(coalesce(p_link->>'objective_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the objective link is refused — a requirement that stops tracing to an objective has not lost its objective, it has lost the record of it. Re-point it at the objective it now serves.');
    end if;
    v_objective := sync_text_as_uuid(p_link->>'objective_id');
    if v_objective is null then
      return jsonb_build_object('error', 'objective_id is not a valid identifier');
    end if;
    if not exists (select 1 from risk_objectives o
                    where o.id = v_objective and o.organization_id = v_org) then
      return jsonb_build_object('error', 'that objective is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'satisfied_by_asset_id' then
    if nullif(btrim(coalesce(p_link->>'satisfied_by_asset_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the installed-asset link is refused — re-point it at the asset that now carries the requirement.');
    end if;
    v_asset := sync_text_as_uuid(p_link->>'satisfied_by_asset_id');
    if v_asset is null then
      return jsonb_build_object('error', 'satisfied_by_asset_id is not a valid identifier');
    end if;
    if not exists (select 1 from assets a
                    where a.id = v_asset and a.organization_id = v_org) then
      return jsonb_build_object('error', 'that asset is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'commissioning_test_id' then
    if nullif(btrim(coalesce(p_link->>'commissioning_test_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the commissioning-test link is refused — re-point it at the test that now proves the requirement.');
    end if;
    v_test := sync_text_as_int(p_link->>'commissioning_test_id');
    if v_test is null then
      return jsonb_build_object('error', 'commissioning_test_id is not a valid identifier');
    end if;
    if not exists (select 1 from acceptance_tests t
                    where t.id = v_test and t.organization_id = v_org) then
      return jsonb_build_object('error', 'that acceptance test is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'operating_kpi_key' then
    if nullif(btrim(coalesce(p_link->>'operating_kpi_key','')), '') is null then
      return jsonb_build_object('error',
        'clearing the operating-KPI link is refused — a requirement that stops being measured in operation is the thread going dark at exactly the point it was built to reach.');
    end if;
    v_kpi := btrim(p_link->>'operating_kpi_key');
    if not exists (select 1 from kpi_catalog k where k.kpi_key = v_kpi) then
      return jsonb_build_object('error',
        format('"%s" is not an operating KPI in the catalogue. If this requirement is measured by several KPIs it has not been decomposed — record child requirements under it and give each one its KPI (ruling 4).', v_kpi));
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'parent_requirement_id' then
    if nullif(btrim(coalesce(p_link->>'parent_requirement_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the parent link is refused — a requirement promoted to a root is a restructuring, and a restructuring is recorded by re-pointing, not by erasure.');
    end if;
    v_parent := sync_text_as_int(p_link->>'parent_requirement_id');
    if v_parent is null then
      return jsonb_build_object('error', 'parent_requirement_id is not a valid identifier');
    end if;
    if not exists (select 1 from design_requirements x
                    where x.id = v_parent and x.organization_id = v_org
                      and x.development_case_id is not distinct from d.development_case_id) then
      return jsonb_build_object('error',
        'the parent requirement must be a requirement on this same case');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'owner_id' then
    if nullif(btrim(coalesce(p_link->>'owner_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the owner is refused — a requirement that had an accountable person and now has none is a handover nobody recorded. Name the person it moved to.');
    end if;
    v_owner := sync_text_as_uuid(p_link->>'owner_id');
    if v_owner is null then
      return jsonb_build_object('error', 'owner_id is not a valid identifier');
    end if;
    if not exists (select 1 from user_profiles u
                    where u.id = v_owner and u.organization_id = v_org) then
      return jsonb_build_object('error',
        'the requirement owner must be a member of this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'acceptance_criteria' then
    v_criteria := nullif(btrim(coalesce(p_link->>'acceptance_criteria','')), '');
    if v_criteria is null then
      return jsonb_build_object('error',
        'acceptance criteria cannot be blanked — state what "met" means, measurably, or leave the previous statement standing.');
    end if;
    v_touched := v_touched + 1;
  end if;

  if v_touched = 0 then
    return jsonb_build_object('error',
      'nothing to link — supply at least one of objective_id, satisfied_by_asset_id, commissioning_test_id, operating_kpi_key, parent_requirement_id, owner_id or acceptance_criteria');
  end if;

  update design_requirements set
    objective_id = v_objective,
    satisfied_by_asset_id = v_asset,
    commissioning_test_id = v_test,
    operating_kpi_key = v_kpi,
    parent_requirement_id = v_parent,
    owner_id = v_owner,
    acceptance_criteria = v_criteria
  where id = d.id;

  v_after := jsonb_build_object(
    'objective_id', v_objective, 'satisfied_by_asset_id', v_asset,
    'commissioning_test_id', v_test, 'operating_kpi_key', v_kpi,
    'parent_requirement_id', v_parent, 'owner_id', v_owner,
    'acceptance_criteria', v_criteria);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'requirement_thread', coalesce(v_role, 'unknown'),
    jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
      'case_id', d.development_case_id, 'links_touched', v_touched),
    v_before, v_after);

  return jsonb_build_object('requirement_id', d.id,
    'requirement_ref', d.requirement_ref, 'linksTouched', v_touched,
    'thread', v_after);
end
$$;

revoke all on function public.link_requirement_thread(bigint, jsonb) from public, anon;
grant execute on function public.link_requirement_thread(bigint, jsonb) to authenticated, service_role;

comment on function public.link_requirement_thread(bigint, jsonb) is
  'D4.16 / spec II.2 + §10 + §70: attaches the digital-thread links. Re-pointing is allowed; CLEARING any link is refused by name; the AI-operator identity is refused BY NAME (repair ruling 10) — owner, objective and acceptance criteria are three of the five families the Requirements Agent reports.';

-- ---------------------------------------------------------------------------
-- 7b. record_case_requirement — the same §70 rule at the OTHER door.
--
--     This slice hung `verification_method` on a write path that admitted
--     ai_admin (pre-existing, 20261122090000). Ruling 4 of 20261204090100
--     says an identity that can state the method can clear its own finding —
--     so the identity may still record a requirement (that ADDS findings, it
--     does not clear them) and may not state its verification method.
--     Everything else in this function is byte-for-byte the shipped version.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_requirement(
  p_case_id uuid,
  p_requirement jsonb
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
  v_ref text := nullif(btrim(coalesce(p_requirement->>'requirement_ref','')), '');
  v_category text := nullif(btrim(coalesce(p_requirement->>'category','')), '');
  v_source text := coalesce(nullif(btrim(coalesce(p_requirement->>'source','')), ''), 'engineering');
  v_method text := nullif(btrim(coalesce(p_requirement->>'verification_method','')), '');
  v_criteria text := nullif(btrim(coalesce(p_requirement->>'acceptance_criteria','')), '');
  v_owner uuid := sync_text_as_uuid(p_requirement->>'owner_id');
  v_objective uuid := sync_text_as_uuid(p_requirement->>'objective_id');
  v_parent bigint := sync_text_as_int(p_requirement->>'parent_requirement_id');
  v_kpi text := nullif(btrim(coalesce(p_requirement->>'operating_kpi_key','')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a project requirement requires a planning, engineering or governance role');
  end if;
  -- §70 / repair ruling 10. The AI-operator identity may record that a
  -- requirement exists; it may not state HOW that requirement will be
  -- verified. Stating the method is exactly the finding
  -- get_case_requirement_findings raises as `missing_verification_method`,
  -- and create_requirement_verification already refuses this identity for the
  -- same reason. Proven live before this guard: as ai_admin,
  -- record_case_requirement accepted {"verification_method":"test"}.
  if coalesce(v_role, '') = 'ai_admin' and v_method is not null then
    return jsonb_build_object('error',
      'stating how a requirement will be verified is a §70 human act — the AI-operator identity reports requirements with no verification method, it does not supply one. Record the requirement without a method; a human plans the verification.');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a requirement carries a reference the rest of the project can cite (requirement_ref)');
  end if;
  if v_category is null or not (v_category = any (
       sync_spec10_requirement_categories()
       || sync_reliability_by_design_requirement_categories())) then
    return jsonb_build_object('error',
      format('category must be one of the eleven §10 categories (%s) or one of the reliability-by-design categories this table predates §10 with (%s)',
        array_to_string(sync_spec10_requirement_categories(), ', '),
        array_to_string(sync_reliability_by_design_requirement_categories(), ', ')));
  end if;
  if v_source not in ('engineering','operations','maintenance','incident','regulatory','operational_lesson') then
    return jsonb_build_object('error',
      'source must be one of: engineering, operations, maintenance, incident, regulatory, operational_lesson');
  end if;
  if coalesce(length(btrim(coalesce(p_requirement->>'requirement',''))), 0) < 10 then
    return jsonb_build_object('error',
      'state the requirement — what must be true (10 characters minimum)');
  end if;
  if v_method is not null and not (v_method = any (sync_verification_methods())) then
    return jsonb_build_object('error',
      format('verification_method must be one of: %s',
        array_to_string(sync_verification_methods(), ', ')));
  end if;
  if p_requirement ? 'owner_id'
     and nullif(btrim(coalesce(p_requirement->>'owner_id','')), '') is not null
     and v_owner is null then
    return jsonb_build_object('error', 'owner_id is not a valid identifier');
  end if;
  if v_owner is not null
     and not exists (select 1 from user_profiles u
                      where u.id = v_owner and u.organization_id = v_org) then
    return jsonb_build_object('error',
      'the requirement owner must be a member of this organization — accountability that points outside the tenant is not accountability');
  end if;
  if p_requirement ? 'parent_requirement_id'
     and nullif(btrim(coalesce(p_requirement->>'parent_requirement_id','')), '') is not null
     and v_parent is null then
    return jsonb_build_object('error', 'parent_requirement_id is not a valid identifier');
  end if;
  if v_parent is not null
     and not exists (select 1 from design_requirements d
                      where d.id = v_parent and d.organization_id = v_org
                        and d.development_case_id = c.id) then
    return jsonb_build_object('error',
      'the parent requirement must be a requirement on this same case');
  end if;
  if v_objective is not null
     and not exists (select 1 from risk_objectives o
                      where o.id = v_objective and o.organization_id = v_org) then
    return jsonb_build_object('error', 'that objective is not in this organization');
  end if;
  if v_kpi is not null
     and not exists (select 1 from kpi_catalog k where k.kpi_key = v_kpi) then
    return jsonb_build_object('error',
      format('"%s" is not an operating KPI in the catalogue — the thread terminates on a KPI that exists or on none at all', v_kpi));
  end if;
  if exists (select 1 from design_requirements d
             where d.organization_id = v_org and d.requirement_ref = v_ref) then
    return jsonb_build_object('error',
      format('requirement reference "%s" already exists in this organization — a reference identifies one requirement, so pick another rather than overwriting it', v_ref));
  end if;

  insert into design_requirements (
    organization_id, project_id, development_case_id, requirement_ref,
    category, requirement, source, verification_method, created_by,
    parent_requirement_id, owner_id, acceptance_criteria, objective_id,
    operating_kpi_key)
  values (
    v_org, c.capital_project_id, c.id, v_ref, v_category,
    btrim(p_requirement->>'requirement'), v_source, v_method, auth.uid(),
    v_parent, v_owner, v_criteria, v_objective, v_kpi)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_requirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'requirement_id', v_id,
      'requirement_ref', v_ref, 'category', v_category, 'source', v_source,
      'spec10_category', is_spec10_requirement_category(v_category)),
    null,
    jsonb_build_object('requirement_ref', v_ref, 'category', v_category,
      'source', v_source, 'verification_status', 'open',
      'parent_requirement_id', v_parent, 'owner_id', v_owner,
      'objective_id', v_objective, 'operating_kpi_key', v_kpi,
      'acceptance_criteria', v_criteria));

  return jsonb_build_object('requirement_id', v_id, 'case_id', c.id,
    'requirement_ref', v_ref,
    'spec10Category', is_spec10_requirement_category(v_category));
end
$$;

revoke all on function public.record_case_requirement(uuid, jsonb) from public, anon;
grant execute on function public.record_case_requirement(uuid, jsonb) to authenticated, service_role;

comment on function public.record_case_requirement(uuid, jsonb) is
  'D3.08/D4.16: the ONE customer write path for a project requirement, carrying the §10 fields. §70 (repair ruling 10): the AI-operator identity may record a requirement and may NOT state its verification method.';

-- ---------------------------------------------------------------------------
-- 8. get_case_requirement_traceability — RE-CREATED, three honesty repairs.
--
--    (a) a requirement that was VERIFIED AND FAILED now has a bucket. It had
--        none: verifiedPct counted only 'verified' and gaps.unverified was
--        filtered to 'open', so the one row on the case somebody had actually
--        looked at and rejected appeared nowhere and the on-screen headline
--        did not add up.
--    (b) gaps.unverified is RENAMED gaps.awaitingVerification. The
--        Requirements Agent uses "unverified" for open-or-failed-minus-
--        missing-method; two different numbers were rendered one above the
--        other under the same word with nothing on the page reconciling them.
--    (c) scopeChain.answered says whether the delegated WBS question was
--        answered at all, so an empty list after a refusal can never be read
--        as "0 requirements are missing from the WBS".
-- ---------------------------------------------------------------------------
create or replace function public.get_case_requirement_traceability(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_org uuid;
  v_total int;
  v_scope jsonb;
  v_reqs_no_wbs jsonb := '[]'::jsonb;
  v_reqs_no_need jsonb := '[]'::jsonb;
  v_no_objective jsonb;
  v_no_method jsonb;
  v_awaiting jsonb;
  v_failed jsonb;
  v_wbs_answered boolean := false;
  v_no_owner jsonb;
  v_no_criteria jsonb;
  v_outside_spec10 jsonb;
  v_no_asset int;
  v_no_test int;
  v_no_kpi int;
  v_roots int;
  v_children int;
  v_max_depth int;
  v_threaded int;
  v_refusals jsonb := '[]'::jsonb;
  v_thread_pct numeric;
  v_verified_pct numeric;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select count(*) into v_total
    from design_requirements d where d.development_case_id = c.id;

  -- ── THE EMPTY-SET REFUSAL ────────────────────────────────────────────────
  if v_total = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'refused', true,
      'requirementCount', 0,
      'refusal',
        'No requirement has been recorded on this case, so there is no traceability to report. This is a REFUSAL, not a clean bill: a report saying "0 orphans, 0 unverified, 0 missing verification methods" over an empty requirement set is indistinguishable from a fully traced project, and it would be read as one. Record the requirements first (§10), then ask this question.',
      'threadCoveragePct', null,
      'verifiedPct', null,
      'chain', '[]'::jsonb,
      'gaps', '{}'::jsonb);
  end if;

  -- ── The WBS answer, delegated to the ONE predicate (ruling 1) ────────────
  v_scope := get_case_scope_traceability(c.id);
  if v_scope ? 'error' then
    v_refusals := v_refusals || to_jsonb(format(
      'The scope chain could not be read (%s), so "which requirements are absent from the WBS" is not answered here. It is NOT reported as zero.',
      v_scope->>'error'));
  else
    v_reqs_no_wbs := coalesce(v_scope->'forwardGaps'->'requirementsWithoutWbs', '[]'::jsonb);
    v_reqs_no_need := coalesce(v_scope->'orphans'->'requirementsWithoutNeed', '[]'::jsonb);
    v_wbs_answered := true;
  end if;

  -- ── Objective head of the thread ────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_objective
  from design_requirements d
  where d.development_case_id = c.id and d.objective_id is null;

  -- ── Verification method / status ────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement,
    'owner', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = d.owner_id))
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_method
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.verification_method), '') = '';

  -- OPEN and FAILED are two buckets, not one.
  --
  -- The shipped read had a single `unverified` list filtered to status
  -- 'open', so a requirement somebody LOOKED at and found wanting appeared in
  -- no bucket at all: not in verifiedPct's numerator, not in any gap list.
  -- On a 14-requirement case with 12 open, 1 verified and 1 failed, the
  -- headline accounted for 13 of 14 and the missing one was the most
  -- consequential row on the case. The buckets now partition the denominator.
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'verificationMethod', d.verification_method,
    'verificationStatus', d.verification_status)
    order by d.requirement_ref), '[]'::jsonb)
  into v_awaiting
  from design_requirements d
  where d.development_case_id = c.id and d.verification_status = 'open';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'verificationMethod', d.verification_method,
    'verificationStatus', d.verification_status,
    'failureStandsUnretracted', requirement_has_unretracted_failure(d.id),
    'measured', (select o.measured_note from verification_obligations o
                  where o.requirement_id = d.id and o.status = 'completed'
                    and o.result = 'not_achieved'
                  order by o.verified_at desc nulls last limit 1))
    order by d.requirement_ref), '[]'::jsonb)
  into v_failed
  from design_requirements d
  where d.development_case_id = c.id and d.verification_status = 'failed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_owner
  from design_requirements d
  where d.development_case_id = c.id and d.owner_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'verificationMethod', d.verification_method)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_criteria
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.acceptance_criteria), '') = '';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category)
    order by d.requirement_ref), '[]'::jsonb)
  into v_outside_spec10
  from design_requirements d
  where d.development_case_id = c.id
    and not is_spec10_requirement_category(d.category);

  select
    count(*) filter (where d.satisfied_by_asset_id is null),
    count(*) filter (where d.commissioning_test_id is null),
    count(*) filter (where d.operating_kpi_key is null),
    count(*) filter (where d.parent_requirement_id is null),
    count(*) filter (where d.parent_requirement_id is not null),
    count(*) filter (where d.objective_id is not null
                       and d.satisfied_by_asset_id is not null
                       and d.commissioning_test_id is not null
                       and d.operating_kpi_key is not null)
  into v_no_asset, v_no_test, v_no_kpi, v_roots, v_children, v_threaded
  from design_requirements d
  where d.development_case_id = c.id;

  with recursive tree(id, depth) as (
    select d.id, 1
      from design_requirements d
     where d.development_case_id = c.id and d.parent_requirement_id is null
    union all
    select d.id, t.depth + 1
      from design_requirements d
      join tree t on d.parent_requirement_id = t.id
     where d.development_case_id = c.id and t.depth < 64
  )
  select coalesce(max(depth), 0) into v_max_depth from tree;

  -- ── The two percentages, with their denominators ────────────────────────
  --  v_total is > 0 here (the empty case returned above), so the division is
  --  defined. The guard is kept anyway and the refusal is explicit: a
  --  coverage percentage with no denominator is refused, never printed.
  if v_total > 0 then
    v_thread_pct := round((v_threaded::numeric / v_total::numeric) * 100, 1);
    v_verified_pct := round((
      (select count(*) from design_requirements d
        where d.development_case_id = c.id and d.verification_status = 'verified')::numeric
      / v_total::numeric) * 100, 1);
  else
    v_refusals := v_refusals || to_jsonb(
      'Coverage percentages are refused: the denominator is zero. A percentage over no requirements is not 0% and not 100% — it is undefined, and printing either would be a claim about a set that does not exist.'::text);
  end if;
  -- ── A COVERAGE FIGURE THAT CANNOT REACH 100% SAYS SO ────────────────────
  --
  -- threadCoveragePct counts a requirement threaded only when objective AND
  -- installed asset AND commissioning test AND operating KPI are all set. Two
  -- of those hang off stores this organization may have no rows in at all —
  -- acceptance_tests is SELECT-only for clients (D4.05 owns that gap) and
  -- kpi_catalog is a seeded platform vocabulary. When the store is EMPTY the
  -- hop is not merely unmade, it is unmakeable, and the percentage is
  -- structurally capped below 100 while rendering as a measurement. Stated,
  -- not silently absorbed into the number.
  if not exists (select 1 from acceptance_tests t where t.organization_id = v_org) then
    v_refusals := v_refusals || to_jsonb(
      'This organization has no acceptance test recorded, so the commissioning-test hop cannot be completed for ANY requirement and thread coverage is capped below 100% for a reason that is not about these requirements. Acceptance tests have no customer authoring path yet (D4.05).'::text);
  end if;
  if not exists (select 1 from kpi_catalog) then
    v_refusals := v_refusals || to_jsonb(
      'The operating KPI catalogue is empty, so the thread cannot terminate on a KPI for ANY requirement and thread coverage is capped below 100% for a reason that is not about these requirements.'::text);
  end if;

  -- Postgres treats 'NaN'::numeric = 'NaN'::numeric as TRUE, so a non-finite
  -- percentage would compare equal to itself and pass an ordinary sanity
  -- check. Tested by name.
  if v_thread_pct is not null and v_thread_pct = 'NaN'::numeric then
    v_thread_pct := null;
    v_refusals := v_refusals || to_jsonb(
      'The thread coverage percentage was non-finite and has been refused rather than displayed.'::text);
  end if;
  if v_verified_pct is not null and v_verified_pct = 'NaN'::numeric then
    v_verified_pct := null;
    v_refusals := v_refusals || to_jsonb(
      'The verified percentage was non-finite and has been refused rather than displayed.'::text);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', false,
    'requirementCount', v_total,
    'spec10Categories', to_jsonb(sync_spec10_requirement_categories()),
    'hierarchy', jsonb_build_object(
      'roots', v_roots, 'children', v_children, 'maxDepth', v_max_depth),
    'threadCoveragePct', v_thread_pct,
    'verifiedPct', v_verified_pct,
    -- The §10 chain, every link stated — built or deferred. A deferred link
    -- is RENDERED, never dropped: a link absent from the list reads as a link
    -- that does not exist rather than one that is not built yet.
    'chain', jsonb_build_array(
      jsonb_build_object('link', 'objective', 'home', 'risk_objectives', 'built', true,
        'count', v_total - jsonb_array_length(v_no_objective)),
      jsonb_build_object('link', 'requirement', 'home', 'design_requirements', 'built', true,
        'count', v_total),
      jsonb_build_object('link', 'design object', 'home', 'none — no canonical store', 'built', false,
        'count', null,
        'deferral', 'No design-object store exists (ruling 3). design_studies is analysis and project_wbs_elements is a deliverable decomposition; neither is the designed object. The nearest built downstream is the WBS element, reached through project_requirement_wbs, and this report does NOT let that stand in for the design object.'),
      jsonb_build_object('link', 'procurement specification', 'home', 'contract_packages (D6.05/D6.08)', 'built', false,
        'count', null,
        'deferral', 'Procurement specification lands in Slice 6, the same deferral the I.6 scope chain already records for its contract link. No specification link is asserted here and none is implied by the links either side of it.'),
      jsonb_build_object('link', 'installed asset', 'home', 'assets', 'built', true,
        'count', v_total - v_no_asset),
      jsonb_build_object('link', 'commissioning test', 'home', 'acceptance_tests', 'built', true,
        'count', v_total - v_no_test),
      jsonb_build_object('link', 'operating KPI', 'home', 'kpi_catalog', 'built', true,
        'count', v_total - v_no_kpi)),
    -- The scope chain is NOT restated here. It is named, with its owner, so a
    -- reader knows where the other half of the requirement's traceability
    -- lives and that it is one predicate, not two.
    'scopeChain', jsonb_build_object(
      'owner', 'get_case_scope_traceability (D5.02)',
      -- The delegate either answered or it did not, and the CALLER has to be
      -- able to tell. Without this flag a refused delegate left an empty
      -- array that every reader rendered as "0 requirements do not appear in
      -- the WBS" — an unanswered question printed as a clean answer.
      'answered', v_wbs_answered,
      'requirementsWithoutWbs', v_reqs_no_wbs,
      'requirementsWithoutNeed', v_reqs_no_need,
      'note', 'The requirement → WBS question and the requirement → business-need question each have ONE implementation and this report delegates to it. Two implementations of one predicate is how a chain reports itself complete from one end and broken from the other.'),
    'gaps', jsonb_build_object(
      'withoutObjective', v_no_objective,
      'withoutVerificationMethod', v_no_method,
      -- RENAMED from `unverified`. get_case_requirement_findings uses that
      -- word for a wider set (open OR failed, minus the missing-method rows),
      -- and the two numbers rendered under one label on one screen with
      -- nothing reconciling them. One predicate, one name.
      'awaitingVerification', v_awaiting,
      'verificationFailed', v_failed,
      'withoutOwner', v_no_owner,
      'withoutAcceptanceCriteria', v_no_criteria,
      'outsideSpec10Taxonomy', v_outside_spec10,
      'withoutInstalledAsset', v_no_asset,
      'withoutCommissioningTest', v_no_test,
      'withoutOperatingKpi', v_no_kpi),
    'refusals', v_refusals);
end
$$;

revoke all on function public.get_case_requirement_traceability(uuid) from public, anon;
grant execute on function public.get_case_requirement_traceability(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_traceability(uuid) is
  'D4.16 / spec III.§10 + II.2: the digital thread over one case''s requirements. REFUSES over an empty requirement set, refuses a percentage with a zero denominator, DELEGATES the requirement→WBS question to get_case_scope_traceability and says whether that delegate ANSWERED. A verified-and-failed requirement has its own bucket, so the gap lists partition the requirement count.';

-- ---------------------------------------------------------------------------
-- 9. compute_case_requirement_traceability — the role check every sibling has.
--
--    compute_case_scope_growth, compute_case_earned_value,
--    compute_case_schedule_quality and compute_case_change_control all gate
--    on the planning/engineering/governance list. This one gated on the
--    organization only. Proven live in one transaction: a `technician` was
--    refused by the 4A sibling and MINTED a calculation_runs row through this
--    one — and calculation_runs is append-only with TRUNCATE revoked, so
--    those rows are permanent.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_requirement_traceability(p_case_id uuid)
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
      'computing requirement traceability requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_result := get_case_requirement_traceability(c.id);
  if v_result ? 'error' then
    return v_result;
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_requirement_traceability',
    'deterministic count and ratio over design_requirements, delegating requirement→WBS to get_case_scope_traceability',
    jsonb_build_object(
      'requirementCount', v_result->'requirementCount',
      'spec10CategoryCount', array_length(sync_spec10_requirement_categories(), 1),
      'wbsDelegateAnswered', coalesce(v_result->'scopeChain'->'answered', 'false'::jsonb)),
    jsonb_build_array(
      jsonb_build_object('table', 'design_requirements', 'scope', 'development_case_id = ' || c.id::text),
      jsonb_build_object('function', 'get_case_scope_traceability', 'scope', c.id::text)),
    case when coalesce((v_result->>'refused')::boolean, false)
      then null
      else jsonb_build_object(
        'threadCoveragePct', v_result->'threadCoveragePct',
        'verifiedPct', v_result->'verifiedPct',
        'hierarchy', v_result->'hierarchy',
        'gapCounts', jsonb_build_object(
          'withoutObjective', jsonb_array_length(v_result->'gaps'->'withoutObjective'),
          'withoutVerificationMethod', jsonb_array_length(v_result->'gaps'->'withoutVerificationMethod'),
          'awaitingVerification', jsonb_array_length(v_result->'gaps'->'awaitingVerification'),
          'verificationFailed', jsonb_array_length(v_result->'gaps'->'verificationFailed'),
          'withoutOwner', jsonb_array_length(v_result->'gaps'->'withoutOwner'),
          'outsideSpec10Taxonomy', jsonb_array_length(v_result->'gaps'->'outsideSpec10Taxonomy')))
      end,
    case when coalesce((v_result->>'refused')::boolean, false)
      then jsonb_build_array(v_result->>'refusal')
      else coalesce(v_result->'refusals', '[]'::jsonb) end);

  return v_result || jsonb_build_object('calculationRunId', v_run);
end
$$;

revoke all on function public.compute_case_requirement_traceability(uuid) from public, anon;
grant execute on function public.compute_case_requirement_traceability(uuid) to authenticated, service_role;

comment on function public.compute_case_requirement_traceability(uuid) is
  'D4.16 + D11.29: the traceability read with a calculation_runs row behind it, gated on the same planning/engineering/governance roles as every sibling compute_case_* (repair). A REFUSED report records a run too.';

-- ---------------------------------------------------------------------------
-- 10. The two verification reads, org-scoped on the JOIN as well as the row.
--
--     Both left-joined design_requirements filtering only o.organization_id.
--     Proven live: an org-1 planner's open-verification list rendered an
--     org-2 requirement's ref and its full statement. The obligation row was
--     the tenant's; the requirement text hanging off it was not.
-- ---------------------------------------------------------------------------
create or replace function get_open_verifications(p_limit int default 25)
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
  left join recommendations r
    on r.id = o.recommendation_id and r.organization_id = o.organization_id
  left join design_requirements d
    on d.id = o.requirement_id and d.organization_id = o.organization_id
  left join assets a on a.id = o.asset_id and a.organization_id = o.organization_id
  where o.organization_id = app_current_org() and o.status = 'open'
  order by o.due_date, coalesce(r.title, d.requirement_ref)
  limit greatest(1, p_limit);
$$;

revoke all on function get_open_verifications(int) from public, anon;
grant execute on function get_open_verifications(int) to authenticated;

comment on function get_open_verifications(int) is
  'C4.08 + D4.17: the ONE live open-verification list, LEFT-joined so a requirement obligation is visible beside a recommendation one, and org-scoped ON THE JOIN (repair ruling 7) so no row can render another tenant''s requirement text.';

-- ---------------------------------------------------------------------------
-- 10b. get_case_requirement_verifications — org-scoped on the JOIN, and
--      carrying the supersession chain so a superseded failure stays on
--      screen rather than being quietly replaced by the pass that answered it.
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
  v_standing int;
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

  select count(*) into v_standing from design_requirements d
   where d.development_case_id = c.id
     and requirement_has_unretracted_failure(d.id);

  return jsonb_build_object(
    'caseId', c.id, 'refused', false,
    'requirementCount', v_reqs,
    'requirementsWithAStandingFailure', coalesce(v_standing, 0),
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
        'supersedesObligationId', o.supersedes_obligation_id,
        'supersededByObligationId', (select x.id from verification_obligations x
                                      where x.supersedes_obligation_id = o.id
                                        and x.status = 'completed' and x.result = 'achieved'
                                      limit 1),
        'verifiedAt', o.verified_at,
        'verifiedBy', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = o.verified_by))
        order by o.due_date, d.requirement_ref)
      from verification_obligations o
      join design_requirements d
        on d.id = o.requirement_id and d.organization_id = o.organization_id
      where o.organization_id = c.organization_id
        and o.development_case_id = c.id
        and o.requirement_id is not null), '[]'::jsonb),
    'refusals', v_refusals);
end
$$;

revoke all on function public.get_case_requirement_verifications(uuid) from public, anon;
grant execute on function public.get_case_requirement_verifications(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_verifications(uuid) is
  'D4.17 / §11: every Verification planned and recorded against this case''s requirements. REFUSES over an empty requirement set; org-scoped on the requirement join (repair ruling 7); reports how many requirements carry a failure nothing has superseded (repair ruling 8).';

-- ---------------------------------------------------------------------------
-- 11. get_case_requirement_findings — the two classes that were missing.
--
--     (a) A recorded FAILURE superseded by a later pass raised NOTHING. Proven
--         live: a 12-month TEST recorded not_achieved, a desktop ANALYSIS
--         recorded achieved, the requirement read `verified`, and the agent
--         produced three findings for it — none of them about the
--         contradiction. Two new deterministic classes, both blocking.
--     (b) NOTHING reported a requirement outside the §10 taxonomy, although
--         ruling 2's entire justification for keeping the five legacy
--         categories is that such a requirement is "REPORTED as outside the
--         taxonomy ... not silently counted as compliant", and the register
--         row claimed two reporters. There were zero. `grep -n taxonomy` over
--         the agent migration and the edge function returned nothing.
--
--     The word "unverified" in the headline now says which set it means, so
--     it cannot be read against the traceability panel's different one.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_requirement_findings(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_total int;
  v_findings jsonb := '[]'::jsonb;
  v_missing jsonb;
  v_unverified jsonb;
  v_orphan jsonb;
  v_inconsistent jsonb;
  v_unowned jsonb;
  v_taxonomy jsonb;
  v_trace jsonb;
  v_no_wbs jsonb := '[]'::jsonb;
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

  select count(*) into v_total from design_requirements d
   where d.development_case_id = c.id;

  -- ── RULING 4: the empty-set refusal ─────────────────────────────────────
  if v_total = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'requirementCount', 0,
      'findings', '[]'::jsonb, 'findingCount', null,
      'refusal',
        'This case has no requirements, so the Requirements Agent has nothing to check. It reports a REFUSAL rather than "0 findings", because 0 findings over an empty requirement set is indistinguishable from a fully traced, fully verified project — and it renders the same colour. Record the requirements (§10) and ask again.');
  end if;

  -- ── FAMILY 1: missing verification method (the spec's own example) ───────
  select coalesce(jsonb_agg(jsonb_build_object(
    'family', 'missing_verification_method',
    'severity', 'blocking',
    'source', 'deterministic',
    'requirementId', d.id,
    'requirementRef', d.requirement_ref,
    'category', d.category,
    'detail', format('%s has no verification method. Nobody has said how anyone would know it was met, so it cannot be verified, cannot be closed at a gate, and will be carried to handover as an open question wearing the word "requirement".', d.requirement_ref))
    order by d.requirement_ref), '[]'::jsonb)
  into v_missing
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.verification_method), '') = ''
    and not exists (select 1 from verification_obligations o
                     where o.requirement_id = d.id);

  -- ── FAMILY 2: unverified ────────────────────────────────────────────────
  --  Split three ways, because "nobody has looked yet", "somebody was
  --  supposed to look and the date has passed" and "somebody looked and it
  --  failed" are three different states that a single 'unverified' count
  --  would flatten into one comfortable number.
  select coalesce(jsonb_agg(f order by f->>'requirementRef'), '[]'::jsonb)
  into v_unverified
  from (
    select jsonb_build_object(
      'family', 'unverified',
      'subFamily', case
        when d.verification_status = 'failed' then 'verification_failed'
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open'
                        and o.due_date < current_date) then 'verification_overdue'
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open')
          then 'verification_pending'
        else 'no_verification_planned' end,
      'severity', case when d.verification_status = 'failed' then 'blocking'
                       else 'attention' end,
      'source', 'deterministic',
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'category', d.category,
      'verificationStatus', d.verification_status,
      'detail', case
        when d.verification_status = 'failed'
          then format('%s was verified and FAILED. This is not an open item; it is a known negative result, and carrying it as "in progress" would lose the one piece of information the verification produced.', d.requirement_ref)
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open'
                        and o.due_date < current_date)
          then format('%s has a verification that is past its due date. A verification that never happens looks identical to one that passed.', d.requirement_ref)
        when exists (select 1 from verification_obligations o
                      where o.requirement_id = d.id and o.status = 'open')
          then format('%s has a verification planned and open, in date. Listed for completeness, not as a problem.', d.requirement_ref)
        else format('%s states a verification method but no verification has been planned against it. The method is a sentence until an obligation exists with a date on it.', d.requirement_ref)
      end) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_status in ('open','failed')
      and not (coalesce(btrim(d.verification_method), '') = ''
               and not exists (select 1 from verification_obligations o
                                where o.requirement_id = d.id))
  ) s;

  -- ── FAMILY 3: orphan ────────────────────────────────────────────────────
  --  Upstream orphan: no objective (§10's chain head). Downstream orphan: not
  --  in the WBS — DELEGATED to get_case_scope_traceability, the ONE
  --  implementation of that question (D5.02). If the delegate cannot answer,
  --  the downstream half is REFUSED rather than reported as zero.
  v_trace := get_case_scope_traceability(c.id);
  if v_trace ? 'error' then
    v_refusals := v_refusals || to_jsonb(format(
      'The downstream orphan check (requirement absent from the WBS) could not run: %s. It is NOT reported as zero orphans.',
      v_trace->>'error'));
  else
    v_no_wbs := coalesce(v_trace->'forwardGaps'->'requirementsWithoutWbs', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(f order by f->>'requirementRef'), '[]'::jsonb)
  into v_orphan
  from (
    select jsonb_build_object(
      'family', 'orphan',
      'subFamily', 'no_objective',
      'severity', 'attention',
      'source', 'deterministic',
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'category', d.category,
      'detail', format('%s traces to no objective. A requirement nobody can connect to an objective is a requirement nobody can defend deleting either — it survives every scope challenge by being unattached.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id and d.objective_id is null
    union all
    select jsonb_build_object(
      'family', 'orphan',
      'subFamily', 'absent_from_wbs',
      'severity', 'blocking',
      'source', 'deterministic',
      'requirementId', (x->>'requirementId')::bigint,
      'requirementRef', x->>'requirementRef',
      'category', x->>'category',
      'detail', format('%s does not appear in the WBS — the spec''s own example of a broken scope chain (I.6: "Requirement R-184 does not appear in the WBS"). Nothing is scheduled or costed to deliver it. Reported by get_case_scope_traceability, not recomputed here.', x->>'requirementRef')) as f
    from jsonb_array_elements(v_no_wbs) x
  ) s;

  -- ── FAMILY 4: inconsistent (deterministic classes only) ─────────────────
  select coalesce(jsonb_agg(f order by f->>'requirementRef', f->>'subFamily'), '[]'::jsonb)
  into v_inconsistent
  from (
    -- 4a. Status asserted with no verification behind it. The only way this
    --     can happen today is a row written before 20261204090100 or by a
    --     migration; it is still checked, because "verified" with nothing
    --     behind it is the single most expensive lie this table can tell.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'verified_without_a_result',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s is marked VERIFIED but no completed verification with an achieved result stands behind it. The status is an assertion, not a finding.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_status = 'verified'
      and not exists (select 1 from verification_obligations o
                       where o.requirement_id = d.id and o.status = 'completed'
                         and o.result = 'achieved')
    union all
    -- 4b. A parent verified while a child is not. Decomposition means the
    --     parent is met BY its children; a verified parent over an unverified
    --     child is the hierarchy contradicting itself.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'parent_verified_before_child',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', p.id, 'requirementRef', p.requirement_ref,
      'relatedRequirementId', ch.id, 'relatedRequirementRef', ch.requirement_ref,
      'detail', format('%s is VERIFIED but its child %s is %s. A parent requirement is met BY its children; a verified parent above an unverified child means one of the two statuses is wrong.',
        p.requirement_ref, ch.requirement_ref, ch.verification_status)) as f
    from design_requirements p
    join design_requirements ch on ch.parent_requirement_id = p.id
    where p.development_case_id = c.id
      and p.verification_status = 'verified'
      and ch.verification_status <> 'verified'
    union all
    -- 4c. Testable with nothing to test against.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'testable_without_acceptance_criteria',
      'severity', 'attention', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s will be verified by %s but states no acceptance criteria. A test with nothing to test against produces a number nobody can call a pass or a fail.',
        d.requirement_ref, d.verification_method)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_method in ('test','operational_validation','factory_test','site_test')
      and coalesce(btrim(d.acceptance_criteria), '') = ''
    union all
    -- 4d. Two requirements measured by one KPI (20261204090000 ruling 4).
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'shared_operating_kpi',
      'severity', 'attention', 'source', 'deterministic',
      'requirementId', a.id, 'requirementRef', a.requirement_ref,
      'relatedRequirementId', b.id, 'relatedRequirementRef', b.requirement_ref,
      'detail', format('%s and %s are both measured in operation by "%s". One KPI cannot report which of the two is being met, so in service the pair is unfalsifiable — decompose, or measure them differently.',
        a.requirement_ref, b.requirement_ref, a.operating_kpi_key)) as f
    from design_requirements a
    join design_requirements b
      on b.development_case_id = a.development_case_id
     and b.operating_kpi_key = a.operating_kpi_key
     and b.id > a.id
    where a.development_case_id = c.id and a.operating_kpi_key is not null
    union all
    -- 4e. VERIFIED while a recorded failure against it still stands. The
    --     derived status (20261204090300 ruling 8) makes this unreachable
    --     through the RPCs, and the provenance wall refuses the direct write
    --     — this is the DETECTION behind both, for a row written before them
    --     or by a caller that got past them. It is the most expensive lie
    --     this table can tell, so it is checked rather than assumed absent.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'verified_over_an_unretracted_failure',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s is marked VERIFIED while a completed verification recorded NOT ACHIEVED against it and nothing has superseded that failure. A later pass does not un-fail an earlier failure; one of the two records is wrong and the status is the one with nothing behind it.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and d.verification_status = 'verified'
      and requirement_has_unretracted_failure(d.id)
    union all
    -- 4f. A PASS was recorded that does not answer the failure. Reachable and
    --     expected: a planner records an achieved result by another method
    --     without naming the failure it re-tests. The requirement correctly
    --     stays FAILED — and the obligation list beside it now shows a pass,
    --     so the contradiction has to be stated or the list reads as closure.
    select jsonb_build_object(
      'family', 'inconsistent', 'subFamily', 'passed_without_superseding_the_failure',
      'severity', 'blocking', 'source', 'deterministic',
      'requirementId', d.id, 'requirementRef', d.requirement_ref,
      'detail', format('%s carries a completed ACHIEVED verification AND a recorded failure that nothing has superseded. The requirement is correctly still FAILED, but the pass sitting beside the failure reads as closure to anyone scanning the list. If that pass re-tested the failure, plan it naming the failure it supersedes; if it tested something else, the failure is still owed an answer.', d.requirement_ref)) as f
    from design_requirements d
    where d.development_case_id = c.id
      and requirement_has_unretracted_failure(d.id)
      and exists (select 1 from verification_obligations o
                   where o.requirement_id = d.id and o.status = 'completed'
                     and o.result = 'achieved')
  ) s;

  -- ── FAMILY 5: unowned (20261204090000 ruling 5) ─────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'family', 'unowned', 'severity', 'attention', 'source', 'deterministic',
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category,
    'detail', format('%s has no owner. §10 gives a requirement an owner_id; a requirement with nobody accountable is a wish that survives to handover.', d.requirement_ref))
    order by d.requirement_ref), '[]'::jsonb)
  into v_unowned
  from design_requirements d
  where d.development_case_id = c.id and d.owner_id is null;

  -- ── FAMILY 6: outside the §10 taxonomy (20261204090000 ruling 2) ────────
  --  Ruling 2 keeps the five reliability-by-design categories rather than
  --  guessing a §10 mapping for them, and its whole justification is that a
  --  requirement outside the eleven is REPORTED as outside the taxonomy
  --  "not silently counted as compliant". The traceability read computed the
  --  list; the agent had no family for it, so nothing reported it. Advisory
  --  by construction: `informational`, because a category this table predates
  --  §10 with is a fact about the schema's history, not a defect in the
  --  requirement.
  select coalesce(jsonb_agg(jsonb_build_object(
    'family', 'outside_spec10_taxonomy', 'severity', 'informational',
    'source', 'deterministic',
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category,
    'detail', format('%s is categorised "%s", which is a reliability-by-design category this table predates §10 with and NOT one of the eleven §10 categories. It is reported rather than remapped: guessing which of the eleven it belongs to inside a governance model would be a silent rewrite of what somebody wrote down.', d.requirement_ref, d.category))
    order by d.requirement_ref), '[]'::jsonb)
  into v_taxonomy
  from design_requirements d
  where d.development_case_id = c.id
    and not is_spec10_requirement_category(d.category);

  v_findings := v_missing || v_unverified || v_orphan || v_inconsistent
                || v_unowned || v_taxonomy;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', false,
    'requirementCount', v_total,
    'findingCount', jsonb_array_length(v_findings),
    'byFamily', jsonb_build_object(
      'missingVerificationMethod', jsonb_array_length(v_missing),
      'unverified', jsonb_array_length(v_unverified),
      'orphan', jsonb_array_length(v_orphan),
      'inconsistent', jsonb_array_length(v_inconsistent),
      'unowned', jsonb_array_length(v_unowned),
      'outsideSpec10Taxonomy', jsonb_array_length(v_taxonomy)),
    -- The §59 headline, formed the way the spec forms it.
    'headline', format('%s requirement(s) have no verification method; %s are unverified (open or failed); %s are orphaned; %s are internally inconsistent; %s have no owner; %s sit outside the §10 taxonomy.',
      jsonb_array_length(v_missing), jsonb_array_length(v_unverified),
      jsonb_array_length(v_orphan), jsonb_array_length(v_inconsistent),
      jsonb_array_length(v_unowned), jsonb_array_length(v_taxonomy)),
    'findings', v_findings,
    'refusals', v_refusals,
    'advisory', true,
    'disclaimer', 'Findings, not dispositions. Nothing here changes a verification status, closes an obligation or marks a requirement verified — those are §70 human acts and the database refuses this path to all three.');
end
$$;

revoke all on function public.get_case_requirement_findings(uuid) from public, anon;
grant execute on function public.get_case_requirement_findings(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_findings(uuid) is
  'D12.09 / spec §59: the deterministic half of the Requirements Agent — missing verification method, unverified, orphan, inconsistent (six classes, including a pass recorded over an unsuperseded failure), unowned, and outside the §10 taxonomy. Refuses over an empty requirement set. The WBS orphan class is DELEGATED, never recomputed.';

-- ---------------------------------------------------------------------------
-- 12. record_requirements_agent_report — bounded on every caller-controlled
--     field, and returning the family breakdown it actually stored.
-- ---------------------------------------------------------------------------
create or replace function public.record_requirements_agent_report(
  p_case_id uuid,
  p_narrative text default null,
  p_model text default null,
  p_ai_findings jsonb default '[]'::jsonb
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
  v_findings jsonb;
  v_ai jsonb := '[]'::jsonb;
  v_dropped jsonb := '[]'::jsonb;
  v_all jsonb;
  x jsonb;
  v_ref_a text;
  v_ref_b text;
  v_concern text;
  v_id_a bigint;
  v_id_b bigint;
  v_id bigint;
  v_over int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a requirements agent reading requires a governance, engineering, planning or AI-operator role — a report row carries an agent key, a model and a narrative, and is rendered as the agent''s reading of the requirement set');
  end if;
  -- The row is immutable, undeletable and readable by the whole organization,
  -- which is exactly the reason `narrative` is capped — and `model` and the
  -- caller-supplied findings array were not. One planner call through
  -- PostgREST stored a 200,000-character `model` and 5,054 findings.
  if coalesce(length(p_model), 0) > 200 then
    return jsonb_build_object('error',
      format('the model identifier is %s characters; it names a model, and a model name is capped at 200 because this row is immutable, undeletable and readable by the whole organization', length(p_model)));
  end if;
  if coalesce(length(p_narrative), 0) > 6000 then
    return jsonb_build_object('error',
      format('the narrative is %s characters; a requirements reading is capped at 6000 because the row is immutable, undeletable and readable by the whole organization', length(p_narrative)));
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- THE DETERMINISTIC ENGINE, read here rather than accepted from the caller.
  v_findings := get_case_requirement_findings(c.id);
  if v_findings ? 'error' then
    return v_findings;
  end if;
  if coalesce((v_findings->>'refused')::boolean, false) then
    -- RULING 4. A report over an empty requirement set is not recorded at
    -- all: a dated row saying "0 findings" would outlive the refusal that
    -- produced it and be cited as a clean reading.
    return jsonb_build_object('error', v_findings->>'refusal');
  end if;

  if p_ai_findings is not null and jsonb_typeof(p_ai_findings) = 'array' then
    -- Bounded, and the excess is DROPPED AND REPORTED rather than truncated
    -- silently — the same rule the unresolvable-reference branch below
    -- follows. 50 semantic candidates over one case is already more pairs
    -- than a human will read; a model returning more than that has stopped
    -- discriminating.
    v_over := greatest(0, jsonb_array_length(p_ai_findings) - 50);
    if v_over > 0 then
      v_dropped := v_dropped || jsonb_build_object(
        'requirementRef', null, 'relatedRequirementRef', null,
        'reason', format('%s semantic candidate(s) beyond the 50 this reading accepts were DROPPED. A model returning more pairs than that has stopped discriminating between them, and the row this writes is immutable, undeletable and readable by the whole organization.', v_over));
    end if;
    for x in select value from jsonb_array_elements(p_ai_findings) with ordinality t(value, n)
              where t.n <= 50 loop
      v_ref_a := nullif(btrim(coalesce(x->>'requirement_ref','')), '');
      v_ref_b := nullif(btrim(coalesce(x->>'related_requirement_ref','')), '');
      v_concern := nullif(btrim(coalesce(x->>'concern','')), '');
      v_id_a := null;
      v_id_b := null;
      if v_ref_a is not null then
        select d.id into v_id_a from design_requirements d
         where d.development_case_id = c.id and d.requirement_ref = v_ref_a;
      end if;
      if v_ref_b is not null then
        select d.id into v_id_b from design_requirements d
         where d.development_case_id = c.id and d.requirement_ref = v_ref_b;
      end if;
      if v_concern is null or v_id_a is null then
        v_dropped := v_dropped || jsonb_build_object(
          'requirementRef', v_ref_a, 'relatedRequirementRef', v_ref_b,
          'reason', case when v_concern is null
            then 'no concern was stated — a finding with no statement of what is wrong is not a finding'
            else format('requirement reference "%s" does not resolve on this case; it was DROPPED rather than matched to the nearest reference', coalesce(v_ref_a, '(none)')) end);
      else
        v_ai := v_ai || jsonb_build_object(
          'family', 'inconsistent',
          'subFamily', 'semantic_inconsistency',
          -- FIXED IN SQL. The payload's own source and severity are never
          -- read: a model does not label its own output deterministic, and it
          -- does not mark its own guess blocking.
          'source', 'ai_suggestion',
          'severity', 'attention',
          'aiGenerated', true,
          'requirementId', v_id_a,
          'requirementRef', v_ref_a,
          'relatedRequirementId', v_id_b,
          'relatedRequirementRef', v_ref_b,
          'detail', left(v_concern, 1000));
      end if;
    end loop;
  end if;

  v_all := coalesce(v_findings->'findings', '[]'::jsonb) || v_ai;

  perform set_config('app.requirement_agent_report_write', 'granted', true);
  insert into requirement_agent_reports
    (organization_id, development_case_id, findings, finding_count,
     requirement_count, by_family, narrative, model, requested_by)
  values
    (v_org, c.id, v_all, jsonb_array_length(v_all),
     coalesce((v_findings->>'requirementCount')::int, 0),
     coalesce(v_findings->'byFamily', '{}'::jsonb)
       || jsonb_build_object('semanticInconsistencyAiSuggested', jsonb_array_length(v_ai)),
     nullif(btrim(coalesce(p_narrative, '')), ''),
     nullif(btrim(coalesce(p_model, '')), ''),
     auth.uid())
  returning id into v_id;
  perform set_config('app.requirement_agent_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'requirement_agent_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('report_id', v_id, 'case_id', c.id,
      'requirement_count', v_findings->'requirementCount',
      'finding_count', jsonb_array_length(v_all),
      'ai_suggested', jsonb_array_length(v_ai),
      'ai_dropped', jsonb_array_length(v_dropped),
      'advisory', true, 'may_verify', false),
    jsonb_build_object('advisory', true));

  return jsonb_build_object(
    'report_id', v_id,
    'caseId', c.id,
    'requirementCount', v_findings->'requirementCount',
    'findingCount', jsonb_array_length(v_all),
    -- The byFamily that was STORED, including the AI count, so a caller
    -- rendering families beside findingCount does not see a set that fails to
    -- add up to it.
    'byFamily', coalesce(v_findings->'byFamily', '{}'::jsonb)
      || jsonb_build_object('semanticInconsistencyAiSuggested', jsonb_array_length(v_ai)),
    'headline', v_findings->>'headline',
    'aiSuggestedCount', jsonb_array_length(v_ai),
    'aiDropped', v_dropped,
    'refusals', coalesce(v_findings->'refusals', '[]'::jsonb),
    'advisory', true,
    'disclaimer', 'A reading of the requirement set, not a disposition on it. The AI cannot verify a requirement, close an obligation or record a verification result (spec §70): create_requirement_verification and record_verification_result both refuse this identity by name, and the persistence wall refuses a verification attributed to it for every writer.');
end
$$;

revoke all on function public.record_requirements_agent_report(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_requirements_agent_report(uuid, text, text, jsonb) to authenticated, service_role;

comment on function public.record_requirements_agent_report(uuid, text, text, jsonb) is
  'D12.09 / spec §59: the Requirements Agent''s ONLY write. Every deterministic finding and count is read inside this function; caller-supplied semantic findings are labelled ai_suggestion from a SQL literal, capped at severity attention, capped at 50 with the excess DROPPED AND REPORTED, and dropped-and-reported when their reference does not resolve. `model` is bounded at 200 characters. No column can hold a verification status.';

do $model_cap$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.requirement_agent_reports'::regclass
                   and conname = 'requirement_agent_report_model_bounded') then
    alter table public.requirement_agent_reports
      add constraint requirement_agent_report_model_bounded
      check (model is null or length(model) <= 200);
  end if;
end
$model_cap$;

-- ---------------------------------------------------------------------------
-- 13. get_project_posture — /design counts the PROJECT side of the one table.
--
--     D4.17's ruling 2 scoped get_verification_posture to the recommendation
--     side "before the first drift" and did not apply the same reasoning to
--     /design, the other live surface over design_requirements. Live against
--     org 1: get_project_posture reported 24 requirements where 19 were case-
--     scoped and 5 were project-scoped. That was already wrong; Slice 5A makes
--     it MOVE, because case requirements now transition to verified and
--     failed, so /design's "unverified" count would fall for reasons that
--     have nothing to do with reliability by design.
--
--     The case figure is not dropped — it is stated as its own clause, so the
--     sentence accounts for every row of the table it reads.
--
--     The 20260818090000 file is NOT edited (house convention, and it is the
--     Reliability-by-design surface); the function is re-created here.
-- ---------------------------------------------------------------------------
create or replace function get_project_posture()
returns table (
  projects_total bigint,
  requirements_total bigint,
  requirements_open bigint,
  requirements_waived bigint,
  requirements_from_operations bigint,
  requirements_traced_to_failure_mode bigint,
  ram_targets_set bigint,
  studies_total bigint,
  studies_without_maintainer bigint,
  open_punch_items bigint,
  early_life_failures_total bigint,
  early_life_fed_back bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  p as (select count(*)::bigint n from capital_projects where organization_id = (select id from org)),
  r as (
    -- REPAIR (D4.17 ruling 2, applied to the OTHER live surface over this
    -- table). /design reports "design requirements"; since 20261122090000 the
    -- table also carries development-case requirements, and Slice 5A makes
    -- those MOVE — a case requirement recorded as verified or failed would
    -- change /design's open count, and dilute
    -- requirements_traced_to_failure_mode, for reasons that have nothing to do
    -- with reliability by design. Scoped before the first drift, the same way
    -- get_verification_posture was scoped to the recommendation side.
    select count(*)::bigint n,
           count(*) filter (where verification_status = 'open')::bigint open_n,
           count(*) filter (where verification_status = 'waived')::bigint waived,
           count(*) filter (where source in ('operations','maintenance','operational_lesson'))::bigint from_ops,
           -- The sharper number. Sourced from maintenance is input; traced to a
           -- specific failure mode learned in service is the loop actually closing.
           count(*) filter (where derived_from_failure_mode is not null)::bigint traced
    from design_requirements
     where organization_id = (select id from org)
       and development_case_id is null
  ),
  rc as (
    select count(*)::bigint n
    from design_requirements
     where organization_id = (select id from org)
       and development_case_id is not null
  ),
  t as (select count(*)::bigint n from ram_targets where organization_id = (select id from org)),
  s as (
    select count(*)::bigint n,
           count(*) filter (where not maintainer_participated)::bigint no_maintainer
    from design_studies where organization_id = (select id from org)
  ),
  a as (select coalesce(sum(punch_items_open), 0)::bigint n from acceptance_tests
         where organization_id = (select id from org)),
  e as (
    select count(*)::bigint n, count(*) filter (where fed_back_to_design)::bigint fed
    from early_life_failures where organization_id = (select id from org)
  )
  select p.n, r.n, r.open_n, r.waived, r.from_ops, r.traced, t.n, s.n, s.no_maintainer,
         a.n, e.n, e.fed,
    case
      when p.n = 0 then
        'No capital projects are recorded. Reliability by design is a stage of work this platform '
        || 'has never seen — which matches the whole-life coverage finding, and means the design '
        || 'decisions setting the next twenty years of maintenance cost are being made somewhere else.'
      else
        p.n || ' project(s), ' || r.n || ' design requirement(s) on the project side'
        || case when rc.n > 0 then ' (a further ' || rc.n
             || ' requirement(s) belong to development cases and are counted on the case, not here)'
           else '' end
        || case when r.open_n > 0 then ', ' || r.open_n || ' unverified' else '' end
        || case when r.waived > 0 then ', ' || r.waived || ' waived' else '' end || '. '
        || case when r.n = 0 then ''
                when r.traced = 0 then
                  r.from_ops || ' came from operations or maintenance, but NONE traces to a specific '
                  || 'failure mode learned in service. That is the loop that is almost never closed: '
                  || 'the plant knows what breaks and the next project does not.'
                else r.from_ops || ' came from operations or maintenance, and ' || r.traced
                  || ' trace to a specific failure mode learned in service.' end
    end
    || case when s.no_maintainer > 0 then ' ' || s.no_maintainer
            || ' design study/studies ran without anyone who will maintain the asset in the room.'
            else '' end
    || case when a.n > 0 then ' ' || a.n
            || ' punch item(s) remain open and follow the asset into service.' else '' end
  from p, r, rc, t, s, a, e;
$$;

comment on function get_project_posture() is
  'E8 / D4.16 repair: the reliability-by-design posture over the PROJECT-scoped rows of design_requirements. Development-case requirements are counted on the case (get_case_requirement_traceability) and named in the basis rather than folded into this project figure.';

notify pgrst, 'reload schema';
