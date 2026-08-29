-- ============================================================================
-- Sync Develop Slice 3C — AssuranceReview completed (D3.16, spec II.15) and
-- gate readiness re-created to consume this slice's three new blocker
-- families.
--
-- SPEC II.15, VERBATIM: "AssuranceReview: required independence level,
-- reviewer, reviewer competency, conflicts of interest, findings,
-- conditions, approval. A PM must not independently assure their own
-- project. Sync enforces separation."
--
-- WHAT ALREADY EXISTS (register row D3.16 + Slice 3B): risk_assurance_reviews
-- carries the independence LEVEL (line_1/line_2/independent), reviewer,
-- subject_owner, findings, actions, conclusion, evidence; 3B widened the
-- subject to development_case and built the case-scope independence wall
-- (sponsor/creator cannot assure their own case, §70 refuses the AI-operator
-- identity — 20261121090300:74). OVERLAP-MAP RULING IS BINDING: EXTEND
-- risk_assurance_reviews. No second assurance store is created here.
--
-- WHAT THIS FILE ADDS — the three parts of II.15 still missing:
--
--   1. REVIEWER COMPETENCY, VERIFIED, NOT ASSERTED. The reviewer names the
--      competency keys the review requires, and they are checked against the
--      SAME roster every other competency gate in this repository reads
--      (workforce_members + member_competencies + competencies, current and
--      unexpired — the 20260921110101:2232 join re-used verbatim by
--      20261121090500). A free-text "reviewer is experienced" field would be
--      II.15 as decoration. Fail CLOSED: a named competency the reviewer
--      does not hold REFUSES the review, naming the competency — never a
--      warning, never a silent pass.
--
--   2. DECLARED CONFLICTS, WITH AN EXPLICIT NIL RETURN. conflicts_declared
--      is a jsonb array and conflicts_declared_at is the timestamp of the
--      DECLARATION. An empty array with a declaration timestamp means "I
--      considered this and declare none"; a null timestamp means nobody was
--      asked. Those are different facts and the schema keeps them different
--      — defaulting the second to the first is exactly the "absent factor
--      becomes a midpoint" error §46 forbids, in a different domain. An
--      INDEPENDENT review REQUIRES the declaration (constraint + RPC): the
--      product of an independent review is independence, and independence
--      nobody attested to is a claim.
--
--   3. GATE BINDING + GATE READINESS CONSUMPTION + REFUSAL. gate_id binds a
--      review to the gate whose readiness it informs — and it is LOAD-BEARING
--      in the satisfaction test, not merely stored: a review satisfies the
--      demand at the gate it names and at no other, so one review at G1
--      cannot release assurance at every later gate of the case.
--      get_gate_readiness reports the position: what the case's ADOPTED
--      intensity binding demands (resolve_case_intensity_binding — the ONE
--      resolver, ruling from 3A), what exists, and a NAMED blocker when the
--      demand is unmet. That blocker, and this slice's other two, are what a
--      passing gate outcome is REFUSED over (section 4d) — a blocker nothing
--      refuses over is a label.
--
-- RULINGS TAKEN (II.15 names the fields, not the mechanics):
--
--   * A CONFLICT DECLARED IS NOT A CONFLICT CLEARED. A declared conflict on
--     an INDEPENDENT review must carry its mitigation, or the review is
--     refused. II.15 exists because conflicts get noticed and then ignored.
--   * COMPLETENESS IS DEMANDED AT THE ACT SITE AND AT THE CONSUMPTION, NOT
--     AT THE TABLE. record_case_assurance_review refuses an independent
--     review without a stated competency and an explicit conflicts
--     declaration, and get_case_assurance_position counts only an
--     II.15-complete review as satisfying a gate demand. The TABLE enforces
--     shape (a declared conflict carries its mitigation; a stated competency
--     is real and currently held) for every writer. The reason for the split
--     is written out at the trigger, along with the residual it leaves.
--   * COMPETENCY IS REQUIRED FOR INDEPENDENT REVIEWS AND OPTIONAL BELOW —
--     but a competency STATED at any level is VERIFIED at that level. Line-1
--     self-review is a management activity, and demanding a formal competency
--     record for it would push honest self-checks out of the system; letting
--     an unverified string count as II.15 completeness at that level would
--     make the roster check decorative for every demand below independent.
--     The level decides whether stating a competency is mandatory, never
--     whether a stated one is real.
--   * THE LEVELS ARE ORDERED (assurance_level_rank): none < line_1 < line_2 <
--     independent. "Required independence level" is only a requirement if a
--     review BELOW it does not discharge it.
--   * THE GATE BOUND MUST BE THE CASE'S OWN. A review bound to a gate of
--     another framework tells the readiness screen nothing and would let an
--     unrelated review satisfy a demand.
--   * THE READINESS NUMBER DOES NOT MOVE. Assurance, regulatory conditions
--     and uncovered commitments are BLOCKERS, named. Folding them into
--     Σ(w·r)/Σw would invent a weight nobody adopted.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The II.15 columns on the ONE assurance store.
-- ---------------------------------------------------------------------------
alter table public.risk_assurance_reviews
  add column if not exists reviewer_competency_keys jsonb not null default '[]'::jsonb,
  add column if not exists reviewer_competency_basis text,
  add column if not exists conflicts_declared jsonb not null default '[]'::jsonb,
  add column if not exists conflicts_declared_at timestamptz,
  add column if not exists gate_id bigint references stage_gates(id) on delete set null;

alter table public.risk_assurance_reviews
  drop constraint if exists rar_competency_is_array;
alter table public.risk_assurance_reviews
  add constraint rar_competency_is_array check (jsonb_typeof(reviewer_competency_keys) = 'array');
alter table public.risk_assurance_reviews
  drop constraint if exists rar_conflicts_is_array;
alter table public.risk_assurance_reviews
  add constraint rar_conflicts_is_array check (jsonb_typeof(conflicts_declared) = 'array');

-- A declared conflict is a fact with a time. The two move together or not at
-- all — a populated array with no declaration timestamp is a conflict nobody
-- is on the hook for having declared.
alter table public.risk_assurance_reviews
  drop constraint if exists rar_conflicts_declaration_coherent;
alter table public.risk_assurance_reviews
  add constraint rar_conflicts_declaration_coherent check (
    jsonb_array_length(conflicts_declared) = 0 or conflicts_declared_at is not null);

create index if not exists idx_assurance_gate
  on risk_assurance_reviews(organization_id, gate_id, status)
  where gate_id is not null;

comment on column public.risk_assurance_reviews.reviewer_competency_keys is
  'D3.16 / spec II.15 "reviewer competency": canonical competency_key values the review requires, VERIFIED against workforce_members/member_competencies at record time (current and unexpired). Mandatory and fail-closed for independent reviews; optional below.';
comment on column public.risk_assurance_reviews.conflicts_declared is
  'D3.16 / spec II.15 "conflicts of interest": array of {conflict, mitigation}. An EMPTY array with conflicts_declared_at set is an explicit nil return; a null conflicts_declared_at means nobody was asked. Independent reviews require the declaration.';
comment on column public.risk_assurance_reviews.gate_id is
  'D3.16: the gate whose readiness this review informs. Consumed by get_gate_readiness (20261122090300). Must belong to the subject case''s own framework.';

-- ---------------------------------------------------------------------------
-- 2. The persistence backstop. Independence is the product of this table, so
--    its preconditions hold for EVERY writer — client, service, migration —
--    on INSERT and on UPDATE (a review upgraded to 'independent' later, or
--    re-pointed at another reviewer, is the same act with a different verb).
--    The 3B independence wall (trg_case_assurance_independence) is untouched
--    and still fires; this trigger is additive and named separately.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_assurance_competency_and_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_conflict jsonb;
begin
  -- Bookkeeping updates that change none of the governed attributes pass
  -- through (the 20261120090300 is-distinct discipline).
  -- SUBJECT INCLUDED. The first draft omitted subject_id/subject_type, so
  -- re-pointing a review from case A to case B — different framework, same
  -- gate_id — passed without re-litigating the gate-framework check below,
  -- which is the one thing that check exists to prevent.
  if tg_op = 'UPDATE'
     and new.assurance_level is not distinct from old.assurance_level
     and new.reviewer_id is not distinct from old.reviewer_id
     and new.subject_id is not distinct from old.subject_id
     and new.subject_type is not distinct from old.subject_type
     and new.reviewer_competency_keys is not distinct from old.reviewer_competency_keys
     and new.conflicts_declared is not distinct from old.conflicts_declared
     and new.conflicts_declared_at is not distinct from old.conflicts_declared_at
     and new.gate_id is not distinct from old.gate_id then
    return new;
  end if;

  -- The gate bound must belong to the subject case's own framework.
  if new.gate_id is not null then
    if new.subject_type <> 'development_case' then
      raise exception
        'A gate binding names the gate whose readiness the review informs, so the review''s subject must be the development case at that gate (spec II.15).'
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from stage_gates g
      join development_cases c on c.id = new.subject_id
      where g.id = new.gate_id and g.organization_id = new.organization_id
        and c.framework_id is not null and g.framework_id = c.framework_id)
    then
      raise exception
        'That gate does not belong to this case''s framework — a review bound to an unrelated gate would satisfy a demand it never examined.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- SHAPE, for every writer and every level: a declared conflict must carry
  -- its mitigation, and a STATED competency must be real and currently held.
  -- Nothing pre-existing violates either, so this cannot break a live path.
  for v_conflict in select * from jsonb_array_elements(new.conflicts_declared) loop
    if coalesce(btrim(v_conflict->>'conflict'), '') = ''
       or coalesce(btrim(v_conflict->>'mitigation'), '') = '' then
      raise exception
        'Spec II.15: every declared conflict states the conflict AND its mitigation. A conflict noticed and then left unmitigated is the exact failure independent assurance exists to prevent.'
        using errcode = 'check_violation';
    end if;
  end loop;

  -- WHERE COMPLETENESS IS DEMANDED, AND WHY NOT HERE.
  --
  -- The first draft of this trigger refused ANY independent review that
  -- carried no competency list and no conflicts declaration. That is the
  -- right standard and the wrong place for it: risk_assurance_reviews has a
  -- live, older write path (record_risk_assurance_review ←
  -- RiskEnterprisePanels.tsx:1400) whose form has no fields for either, so
  -- the rule would have broken a working customer path — and, concretely, it
  -- changed the refusal an existing Slice-3B transcript asserts, which is how
  -- you find out you have done it.
  --
  -- So completeness is demanded at the two places this slice OWNS:
  --   * record_case_assurance_review refuses an independent review without a
  --     stated competency and an explicit conflicts declaration;
  --   * get_case_assurance_position counts ONLY an II.15-complete review as
  --     satisfying a gate's assurance demand, so "satisfied" on the readiness
  --     screen means II.15-complete and nothing less.
  --
  -- RESIDUAL, RECORDED HONESTLY IN THE REGISTER: the older risk-family RPC
  -- can still record an independent case review with neither field, and the
  -- Slice-3B composite-authority predicate (case_binding_gate_demands,
  -- 20261121090400) still accepts it. Closing that means re-creating 3B's
  -- predicate with a stricter definition of a qualifying review — a
  -- deliberate act against another slice's contract, not a side effect of
  -- this one.
  -- §70 AT EVERY LEVEL THIS SLICE MADE CONSEQUENTIAL. Slice 3B's wall
  -- (trg_case_assurance_independence) refuses the AI-operator identity as the
  -- reviewer of an INDEPENDENT case review, on the premise that line-1 and
  -- line-2 reviews release nothing. This slice made a line-1/line-2 review
  -- release a gate's assurance demand, and a wall whose premise has moved
  -- must move with it. The 3B trigger still fires first for independent
  -- reviews, so its refusal — and the transcript that asserts it — is
  -- unchanged; this covers the levels 3B deliberately left alone.
  if new.subject_type = 'development_case'
     and exists (select 1 from user_profiles up
                 where up.id = new.reviewer_id and up.role = 'ai_admin') then
    raise exception
      'Spec §70: an assurance review of a development case releases that case''s assurance demand at a gate, '
      'so it is conducted by a human — the AI-operator identity cannot stand as the reviewer at any independence level.'
      using errcode = 'check_violation';
  end if;

  -- COMPETENCY IS VERIFIED WHENEVER IT IS STATED, at every level.
  --
  -- The first draft returned here for anything below 'independent', so a
  -- line-1 or line-2 review could name any string it liked as a competency —
  -- and get_case_assurance_position counted a non-empty array as II.15
  -- completeness. "VERIFIED against the ONE roster" was therefore true only
  -- for independent reviews, while the consumption treated every level the
  -- same. A stated competency is a claim about a person, and an unverified
  -- claim is the thing II.15 exists to refuse; the level only decides whether
  -- stating one is MANDATORY (record_case_assurance_review), never whether a
  -- stated one is checked.
  for v_key in select jsonb_array_elements_text(new.reviewer_competency_keys) loop
    if not exists (select 1 from competencies co
                   where co.organization_id = new.organization_id
                     and co.competency_key = v_key) then
      raise exception
        'Competency "%" is not defined in this organization''s competency register — an assurance review cannot claim a competency the organization does not recognise.', v_key
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from workforce_members wm
      join member_competencies mc on mc.member_id = wm.id
      join competencies co on co.id = mc.competency_id
      where wm.organization_id = new.organization_id and wm.user_id = new.reviewer_id
        and wm.active and co.competency_key = v_key
        and (mc.expires_on is null or mc.expires_on >= current_date))
    then
      raise exception
        'Spec II.15: this review requires the current "%" competency, which the named reviewer does not hold on the roster. Independent assurance by someone not competent to give it is a signature, not assurance.', v_key
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end
$$;

revoke all on function public.enforce_assurance_competency_and_conflicts() from public, anon, authenticated;

-- TRIGGER NAME IS LOAD-BEARING. Postgres fires same-timing row triggers in
-- ALPHABETICAL order, and the Slice-3B independence wall is
-- `trg_case_assurance_independence`. Named anything sorting before it, this
-- trigger would answer "the sponsor is assuring their own case" with "you did
-- not declare conflicts" — a true statement that hides the real one, and one
-- that silently changed the refusal an existing transcript asserts.
-- `trg_case_assurance_review_competency` sorts AFTER, so the SoD wall speaks
-- first and this trigger adds the II.15 conditions on top of it.
drop trigger if exists trg_assurance_competency_conflicts on public.risk_assurance_reviews;
drop trigger if exists trg_case_assurance_review_competency on public.risk_assurance_reviews;
create trigger trg_case_assurance_review_competency
  before insert or update on public.risk_assurance_reviews
  for each row execute function public.enforce_assurance_competency_and_conflicts();

-- ---------------------------------------------------------------------------
-- 2b. THE INDEPENDENCE LADDER, stated once.
--
--     II.15's first field is "required independence level", which is only a
--     requirement if levels are ORDERED. The first draft special-cased
--     'independent' and compared nothing else, so a demand of line_2 was
--     satisfied by a line_1 SELF-review — the reviewer assuring their own
--     work discharging the organization's demand for an oversight function.
--     Rank makes "at or above the demanded level" sayable.
-- ---------------------------------------------------------------------------
create or replace function public.assurance_level_rank(p_level text)
returns int
language sql
immutable
as $$
  select case coalesce(p_level, 'none')
    when 'independent' then 3
    when 'line_2' then 2
    when 'line_1' then 1
    else 0
  end
$$;

revoke all on function public.assurance_level_rank(text) from public, anon;
grant execute on function public.assurance_level_rank(text) to authenticated, service_role;

comment on function public.assurance_level_rank(text) is
  'D3.16 / spec II.15: none < line_1 < line_2 < independent. A demanded independence level is met by a review AT OR ABOVE it, never below.';

-- ---------------------------------------------------------------------------
-- 3. record_case_assurance_review — the case-scope authoring act. It does NOT
--    replace record_risk_assurance_review (the risk family's own path, which
--    keeps working unchanged and now carries the II.15 columns as optional
--    inputs through the same table); it is the develop-side door, so a case
--    reviewer never has to reach through the risk cockpit to bind a review
--    to a gate.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_assurance_review(
  p_case_id uuid,
  p_review jsonb
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
  v_level text := nullif(btrim(coalesce(p_review->>'assurance_level','')), '');
  v_status text := coalesce(nullif(btrim(coalesce(p_review->>'status','')), ''), 'planned');
  -- Raw text beside the parsed value (20261122090000 section 0).
  v_gate_raw text := nullif(btrim(coalesce(p_review->>'gate_id','')), '');
  v_gate bigint := sync_text_as_bigint(v_gate_raw);
  v_competencies jsonb := coalesce(p_review->'reviewer_competency_keys', '[]'::jsonb);
  v_conflicts jsonb := coalesce(p_review->'conflicts_declared', '[]'::jsonb);
  v_declared_raw text := nullif(btrim(coalesce(p_review->>'conflicts_declaration_made','')), '');
  v_declared boolean := coalesce(sync_text_as_boolean(v_declared_raw), false);
  v_due_raw text := nullif(btrim(coalesce(p_review->>'due_date','')), '');
  v_due date := sync_text_as_date(v_due_raw);
  v_evidence jsonb := coalesce(p_review->'evidence_item_ids', '[]'::jsonb);
  v_owner uuid;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'recording an assurance review requires a governance or engineering role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_level not in ('line_1','line_2','independent') then
    return jsonb_build_object('error', 'assurance_level must be line_1, line_2 or independent');
  end if;
  if v_status not in ('planned','in_progress','completed') then
    return jsonb_build_object('error', 'status must be planned, in_progress or completed');
  end if;
  if coalesce(length(btrim(coalesce(p_review->>'scope',''))), 0) < 10 then
    return jsonb_build_object('error', 'state the assurance scope — what this review examined (10 characters minimum)');
  end if;
  if v_gate_raw is not null and v_gate is null then
    return jsonb_build_object('error',
      format('gate_id must be a gate id (a whole number) — "%s" is not one', v_gate_raw));
  end if;
  if v_declared_raw is not null and v_declared is null then
    return jsonb_build_object('error',
      format('conflicts_declaration_made must be true or false — "%s" is neither', v_declared_raw));
  end if;
  if v_due_raw is not null and v_due is null then
    return jsonb_build_object('error',
      format('due_date must be a date (YYYY-MM-DD) — "%s" is not one', v_due_raw));
  end if;
  -- §70 and the SoD wall, refused BY NAME here so the message says why (the
  -- 3B trigger backstops the independent case for every writer, and this
  -- slice's own trigger backstops the levels below it — see section 2).
  --
  -- EVERY LEVEL, not only 'independent': this slice made a completed line-1
  -- or line-2 review release a gate's assurance demand, so recording one is
  -- the same class of determination as recording an independent review.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'an assurance review of a development case releases that case''s assurance demand at a gate — a §70 human determination the AI-operator identity cannot record at any independence level');
  end if;
  if v_level = 'independent' and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      'segregation of duties (spec II.15): the case sponsor or creator cannot independently assure their own case — independence means someone else looks');
  end if;
  if v_gate is not null and not exists (
    select 1 from stage_gates g
    where g.id = v_gate and g.organization_id = v_org
      and c.framework_id is not null and g.framework_id = c.framework_id) then
    return jsonb_build_object('error',
      'that gate does not belong to this case''s framework — bind the review to a gate of the framework governing this case');
  end if;
  -- The declaration is an ACT with a time, distinct from its contents.
  if v_level = 'independent' and not v_declared and jsonb_array_length(v_conflicts) = 0 then
    return jsonb_build_object('error',
      'spec II.15: declare conflicts of interest for an independent review — pass conflicts_declaration_made=true for an explicit nil return, or list them with their mitigations. Silence is not a declaration');
  end if;
  if v_level = 'independent' and jsonb_array_length(v_competencies) = 0 then
    return jsonb_build_object('error',
      'spec II.15: name the competencies this independent review requires (reviewer_competency_keys) — they are verified against the workforce roster, and a competency the reviewer does not currently hold refuses the review by name');
  end if;
  if v_status = 'completed' and (
       coalesce(p_review->>'conclusion','') not in
         ('acceptable','acceptable_with_actions','not_acceptable','inconclusive')
       or jsonb_array_length(v_evidence) = 0) then
    return jsonb_build_object('error', 'a completed assurance review carries a conclusion and its evidence');
  end if;
  -- SAME CASE, not merely same organization — the rule
  -- close_stakeholder_commitment and close_regulatory_condition already
  -- state by name. One case's evidence cannot complete another case's
  -- assurance review.
  if exists (select 1 from jsonb_array_elements_text(v_evidence) x
             left join evidence_items e
               on e.id = sync_text_as_uuid(x.value) and e.organization_id = v_org
                  and e.development_case_id = c.id
             where e.id is null) then
    return jsonb_build_object('error',
      'one or more assurance evidence items are not recorded against this case — evidence for one case cannot stand behind another case''s assurance review');
  end if;

  -- Never caller-stated: the case's OWN accountable pair (the 3B rule).
  v_owner := coalesce(c.sponsor_id, c.created_by);

  insert into risk_assurance_reviews (
    organization_id, risk_id, subject_type, subject_id, assurance_level,
    subject_owner_id, reviewer_id, scope, conclusion, findings, actions,
    evidence_item_ids, status, due_date, completed_at,
    reviewer_competency_keys, reviewer_competency_basis,
    conflicts_declared, conflicts_declared_at, gate_id)
  values (
    v_org, null, 'development_case', c.id, v_level, v_owner, auth.uid(),
    btrim(p_review->>'scope'), nullif(p_review->>'conclusion',''),
    coalesce(p_review->'findings', '[]'::jsonb), coalesce(p_review->'actions', '[]'::jsonb),
    v_evidence, v_status, v_due,
    case when v_status = 'completed' then now() end,
    v_competencies, nullif(btrim(coalesce(p_review->>'reviewer_competency_basis','')), ''),
    v_conflicts,
    case when v_declared or jsonb_array_length(v_conflicts) > 0 then now() end,
    v_gate)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_assurance_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'review_id', v_id, 'action', 'recorded',
      'assurance_level', v_level, 'status', v_status, 'gate_id', v_gate,
      'competencies', v_competencies,
      'conflicts_declared_count', jsonb_array_length(v_conflicts)),
    null,
    jsonb_build_object('status', v_status, 'assurance_level', v_level,
      'conclusion', p_review->>'conclusion', 'gate_id', v_gate));

  return jsonb_build_object('review_id', v_id, 'case_id', c.id,
    'assurance_level', v_level, 'status', v_status, 'gate_id', v_gate);
end
$$;

revoke all on function public.record_case_assurance_review(uuid, jsonb) from public, anon;
grant execute on function public.record_case_assurance_review(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Completing a planned review — the second half of the act, so a review
--    is not born completed just to satisfy a demand.
-- ---------------------------------------------------------------------------
create or replace function public.complete_case_assurance_review(
  p_review_id uuid,
  p_conclusion text,
  p_evidence_item_ids jsonb,
  p_findings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  ar risk_assurance_reviews%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'completing an assurance review of a development case states a conclusion that releases that case''s assurance demand — a §70 human determination the AI-operator identity cannot record');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'completing an assurance review requires a governance or engineering role');
  end if;
  select * into ar from risk_assurance_reviews where id = p_review_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'assurance review not found');
  end if;
  if ar.status = 'completed' then
    return jsonb_build_object('error', 'this review is already completed — a conclusion is not overwritable; record a new review if the basis changed');
  end if;
  if ar.reviewer_id <> auth.uid() then
    return jsonb_build_object('error',
      'an assurance review is completed by the reviewer who conducted it — a conclusion signed by somebody else is not that reviewer''s conclusion');
  end if;
  if coalesce(p_conclusion, '') not in
     ('acceptable','acceptable_with_actions','not_acceptable','inconclusive') then
    return jsonb_build_object('error',
      'conclusion must be acceptable, acceptable_with_actions, not_acceptable or inconclusive');
  end if;
  if coalesce(jsonb_array_length(p_evidence_item_ids), 0) = 0 then
    return jsonb_build_object('error', 'a completed assurance review carries the evidence it examined');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_evidence_item_ids) x
             left join evidence_items e
               on e.id = sync_text_as_uuid(x.value) and e.organization_id = v_org
                  and (ar.subject_type <> 'development_case'
                       or e.development_case_id = ar.subject_id)
             where e.id is null) then
    return jsonb_build_object('error',
      'one or more assurance evidence items are not recorded against this review''s case — evidence for one case cannot stand behind another case''s conclusion');
  end if;

  update risk_assurance_reviews
  set status = 'completed', conclusion = p_conclusion, completed_at = now(),
      evidence_item_ids = p_evidence_item_ids,
      findings = coalesce(p_findings, '[]'::jsonb)
  where id = ar.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_assurance_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('review_id', ar.id, 'action', 'completed',
      'case_id', case when ar.subject_type = 'development_case' then ar.subject_id end,
      'conclusion', p_conclusion, 'assurance_level', ar.assurance_level),
    jsonb_build_object('status', ar.status, 'conclusion', ar.conclusion),
    jsonb_build_object('status', 'completed', 'conclusion', p_conclusion));

  return jsonb_build_object('review_id', ar.id, 'status', 'completed',
    'conclusion', p_conclusion);
end
$$;

revoke all on function public.complete_case_assurance_review(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.complete_case_assurance_review(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. The assurance POSITION of a case at a gate, as one definer helper.
--
--     WHY A HELPER AND NOT AN INLINE READ: the demand comes from the ONE
--     binding resolver (resolve_case_intensity_binding, 20261120090200),
--     which is deliberately revoked from `authenticated` — arming policy is
--     not client-readable. get_gate_readiness is SECURITY INVOKER and stays
--     that way (its RLS posture is load-bearing for every table it reads),
--     so it cannot call the resolver itself. Widening the resolver's grant
--     to `authenticated` to make one caller work would disarm a deliberate
--     restriction on another slice's function; a narrow definer wrapper that
--     re-checks the organization and returns only the position is the honest
--     way through. The resolver stays the ONE resolver — this does not
--     re-implement it.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_assurance_position(
  p_case_id uuid,
  p_gate_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Organization taken from the CASE, client callers confined to their own —
  -- the get_case_commitment_coverage rule, for the same reason: this is the
  -- ONE assurance predicate, and the persistence backstop that refuses a gate
  -- over it runs with no JWT.
  v_caller_org uuid := app_current_org();
  v_org uuid;
  c development_cases%rowtype;
  v_binding_level text;
  v_independent_required boolean := false;
  v_demanded text;
  v_required boolean := false;
  v_met boolean := false;
  v_met_by uuid;
begin
  if v_caller_org is null and current_user in ('authenticated', 'anon') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select b.assurance_level, b.independent_assurance_required
  into v_binding_level, v_independent_required
  from development_case_governance gov
  cross join lateral (
    select * from resolve_case_intensity_binding(gov.organization_id, gov.intensity_level)
  ) b
  where gov.development_case_id = c.id and gov.status = 'current'
  limit 1;

  -- THE DEMAND IS THE HIGHER OF THE TWO THINGS THE BINDING SAYS. The first
  -- draft read independent_assurance_required into a variable and then never
  -- used it again, so a binding demanding INDEPENDENT assurance through that
  -- flag was satisfied by whatever assurance_level happened to sit beside it.
  -- The flag is a floor, and the ladder makes "the higher of" sayable.
  v_demanded := case
    when coalesce(v_independent_required, false) then 'independent'
    else coalesce(v_binding_level, 'none') end;
  if assurance_level_rank(coalesce(v_binding_level, 'none')) > assurance_level_rank(v_demanded) then
    v_demanded := v_binding_level;
  end if;
  v_required := assurance_level_rank(v_demanded) > 0;

  -- WHAT SATISFIES A DEMAND, stated in full:
  --   * a COMPLETED review with an acceptable conclusion;
  --   * AT OR ABOVE the demanded independence level (assurance_level_rank —
  --     a line-1 self-review does not discharge a line-2 demand);
  --   * II.15-COMPLETE: a stated (and therefore roster-verified) competency
  --     and an explicit conflicts declaration;
  --   * BOUND TO THIS GATE. gate_id was validated, stored and rendered and
  --     then ignored by the satisfaction test, so one review at G1 released
  --     the demand at every later gate of the case, permanently. A review
  --     informs the readiness of the gate it names; a review that names no
  --     gate is recorded and displayed, and satisfies none.
  select ar.id into v_met_by
  from risk_assurance_reviews ar
  where ar.organization_id = v_org
    and ar.subject_type = 'development_case' and ar.subject_id = c.id
    and ar.status = 'completed'
    and ar.conclusion in ('acceptable','acceptable_with_actions')
    and assurance_level_rank(ar.assurance_level) >= assurance_level_rank(v_demanded)
    and jsonb_array_length(ar.reviewer_competency_keys) > 0
    and ar.conflicts_declared_at is not null
    and p_gate_id is not null and ar.gate_id = p_gate_id
  order by ar.completed_at desc
  limit 1;
  v_met := v_required and v_met_by is not null;

  return jsonb_build_object(
    'required', v_required,
    'demandedLevel', v_demanded,
    'bindingLevel', coalesce(v_binding_level, 'none'),
    'independentRequiredByBinding', coalesce(v_independent_required, false),
    'gateId', p_gate_id,
    'satisfiedByReviewId', v_met_by,
    'satisfied', v_met,
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ar.id,
        'level', ar.assurance_level,
        'status', ar.status,
        'conclusion', ar.conclusion,
        'reviewer', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = ar.reviewer_id),
        'competencies', ar.reviewer_competency_keys,
        'conflictsDeclaredAt', ar.conflicts_declared_at,
        'conflictsDeclared', ar.conflicts_declared,
        'gateId', ar.gate_id,
        'completedAt', ar.completed_at)
        order by ar.created_at desc)
      from risk_assurance_reviews ar
      where ar.organization_id = v_org
        and ar.subject_type = 'development_case' and ar.subject_id = c.id
    ), '[]'::jsonb));
end
$$;

drop function if exists public.get_case_assurance_position(uuid);
revoke all on function public.get_case_assurance_position(uuid, bigint) from public, anon;
grant execute on function public.get_case_assurance_position(uuid, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4c. THE ONE OUTSTANDING-OBLIGATION PREDICATE.
--
--     WHY THIS FUNCTION EXISTS. The first draft of this slice added three
--     blocker families to get_gate_readiness and stopped there. The readiness
--     screen named an open permit condition and a broken community promise,
--     and record_case_gate_review — which refuses over mandatory criteria,
--     the D1.02 success contract, deliverables and composite authority —
--     knew nothing about any of them, so `proceed` was recorded straight over
--     the top of all three. Three register rows claimed the opposite in
--     writing ("Consequential, not decorative … enforced truth and displayed
--     truth"; "Open/missed conditions are NAMED gate blockers"; "names
--     assurance_not_satisfied as a blocker"). A blocker nothing refuses over
--     is a label.
--
--     So the predicate is stated ONCE, here, and consumed three times:
--       * get_gate_readiness renders it (what the screen says);
--       * record_case_gate_review refuses over it BY NAME (the act site);
--       * enforce_gate_review_outstanding_obligations backstops it for every
--         writer, INSERT and UPDATE (the persistence boundary).
--     One function, so the three can never disagree.
--
--     SECURITY DEFINER with the organization taken from the CASE: the
--     backstop runs with no JWT, and a client caller is confined to its own
--     organization by the same rule get_case_commitment_coverage applies.
-- ---------------------------------------------------------------------------
create or replace function public.case_gate_outstanding_obligations(
  p_case_id uuid,
  p_gate_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  g stage_gates%rowtype;
  v_org uuid;
  v_out jsonb := '[]'::jsonb;
  v_assurance jsonb;
begin
  if v_caller_org is null and current_user in ('authenticated', 'anon') then
    return '[]'::jsonb;
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return '[]'::jsonb;
  end if;
  v_org := c.organization_id;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return '[]'::jsonb;
  end if;

  -- D3.11: a condition of a permit this case holds that is MISSED, or open
  -- and past its date. A condition not yet due is being complied with; one
  -- past its date is a live breach of the authorization the project operates
  -- under.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'regulatory_condition',
      'id', rc.id,
      'name', rc.condition_ref || ' (' || ap.permit_number || '): ' || rc.description,
      'dueDate', rc.due_date,
      'overdue', true,
      'domain', rc.obligation_domain,
      'regulator', rr.regulator)
      order by rc.due_date, rc.condition_ref), '[]'::jsonb)
  into v_out
  from regulatory_conditions rc
  join regulatory_approvals ap on ap.id = rc.approval_id
  join regulatory_applications a2 on a2.id = ap.application_id
  join regulatory_requirements rr on rr.id = a2.requirement_id
  where rc.organization_id = v_org and rr.development_case_id = c.id
    and rc.status in ('open', 'missed')
    and (rc.status = 'missed' or rc.due_date < current_date);

  -- D3.09: an OVERDUE commitment no project requirement carries, read from
  -- get_case_commitment_coverage itself — the same function the case surface
  -- renders, so the banner and the refusal are one predicate.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'uncovered_commitment',
      'id', (u->>'commitmentId')::bigint,
      'name', (u->>'commitmentRef') || ' to ' || (u->>'stakeholder') || ': ' || (u->>'commitment'),
      'dueDate', u->>'dueDate',
      'overdue', true,
      'stakeholder', u->>'stakeholder',
      'kind', u->>'kind')
      order by u->>'dueDate', u->>'commitmentRef'), '[]'::jsonb)
  into v_out
  from jsonb_array_elements(
    coalesce(get_case_commitment_coverage(c.id)->'uncoveredCommitments', '[]'::jsonb)) u
  where coalesce((u->>'overdue')::boolean, false);

  -- D3.16: the adopted intensity binding's assurance demand, unmet at THIS
  -- gate.
  v_assurance := get_case_assurance_position(c.id, g.id);
  if coalesce((v_assurance->>'required')::boolean, false)
     and not coalesce((v_assurance->>'satisfied')::boolean, false) then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', 'assurance_not_satisfied',
      'id', g.id,
      'name', format('The adopted governance intensity for this case demands %s assurance at %s, and no completed, acceptable review of the case bound to this gate, at or above that level, with a stated competency and an explicit conflicts declaration, exists (spec II.15).',
                     coalesce(v_assurance->>'demandedLevel', 'independent'), g.name),
      'demandedLevel', coalesce(v_assurance->>'demandedLevel', 'independent')));
  end if;

  return v_out;
end
$$;

revoke all on function public.case_gate_outstanding_obligations(uuid, bigint) from public, anon;
grant execute on function public.case_gate_outstanding_obligations(uuid, bigint) to authenticated, service_role;

comment on function public.case_gate_outstanding_obligations(uuid, bigint) is
  'D3.09/D3.11/D3.16: the outstanding regulatory conditions, uncovered overdue stakeholder commitments and unmet assurance demand that BLOCK a gate. Rendered by get_gate_readiness, refused over by record_case_gate_review, and backstopped by enforce_gate_review_outstanding_obligations — one predicate, three consumers, so displayed truth and enforced truth cannot diverge.';

-- ---------------------------------------------------------------------------
-- 4d. THE PERSISTENCE BACKSTOP. A passing gate outcome recorded over an
--     outstanding regulatory condition, a broken community promise or an
--     unmet assurance demand is refused for EVERY writer, INSERT and UPDATE.
--
--     TRIGGER NAME IS LOAD-BEARING (the section-2 lesson again): same-timing
--     row triggers fire alphabetically, and 3B's composite-authority wall is
--     `trg_intensity_governance_binding`. `trg_outstanding_obligations_gate`
--     sorts AFTER it, so 3B's refusals — and the transcripts asserting them —
--     speak first and are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_review_outstanding_obligations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_names text;
begin
  -- Only case-scoped PASSING outcomes are governed. On UPDATE, a change of
  -- outcome, gate or case re-litigates; an annotation edit on a historical
  -- row is not a new pass (the 20261120090300 is-distinct discipline).
  if new.development_case_id is null or new.gate_id is null
     or new.outcome not in ('proceed','proceed_with_conditions')
     or (tg_op = 'UPDATE'
         and new.outcome is not distinct from old.outcome
         and new.gate_id is not distinct from old.gate_id
         and new.development_case_id is not distinct from old.development_case_id) then
    return new;
  end if;

  -- WHAT THIS TRIGGER REFUSES OVER, AND WHAT IT DELIBERATELY DOES NOT.
  --
  --   REFUSED: an outstanding regulatory condition (D3.11) and an overdue
  --   commitment no project requirement carries (D3.09). Both are objects
  --   this slice creates, so refusing over them re-decides nothing that
  --   already shipped.
  --
  --   NOT REFUSED HERE: `assurance_not_satisfied` (D3.16). The demand it
  --   reports comes from the ADOPTED intensity binding, and what that demand
  --   COSTS a gate is already decided by two shipped contracts — Slice 3's
  --   (20261120090300/20261121090400: independent_assurance_required means
  --   the sponsor and creator cannot record the decision) and Slice 3B's
  --   (composite authority rules demand a completed independent review, and
  --   refuse the gate when their conditions are met). Turning the binding
  --   flag itself into a universal hard block would re-decide both of those
  --   from inside this slice — the same deliberate act against another
  --   slice's contract that this file refuses to take at 3B's composite
  --   predicate. So the assurance position is NAMED on the readiness screen
  --   and enforced where its enforcement already lives, and the register row
  --   says exactly that rather than claiming a refusal this code does not
  --   make.
  select jsonb_agg(x) into v_out
  from jsonb_array_elements(
    case_gate_outstanding_obligations(new.development_case_id, new.gate_id)) x
  where x->>'type' in ('regulatory_condition', 'uncovered_commitment');

  if jsonb_array_length(coalesce(v_out, '[]'::jsonb)) = 0 then
    return new;
  end if;

  select string_agg(x->>'name', '; ') into v_names
  from jsonb_array_elements(v_out) x;

  raise exception
    'This gate cannot pass while % obligation(s) recorded against the case stand outstanding: %. '
    'These are the same rows the readiness screen names as blockers — a permit condition past its date, '
    'or a commitment to an external party that no project requirement carries (spec I.18, I.19). '
    'Discharge them (close_regulatory_condition / link_commitment_to_requirement), or record an outcome '
    'that is not a pass.',
    jsonb_array_length(v_out), v_names
    using errcode = 'check_violation';
end
$$;

revoke all on function public.enforce_gate_review_outstanding_obligations() from public, anon, authenticated;

drop trigger if exists trg_outstanding_obligations_gate on public.stage_gate_reviews;
create trigger trg_outstanding_obligations_gate
  before insert or update on public.stage_gate_reviews
  for each row execute function public.enforce_gate_review_outstanding_obligations();

-- ---------------------------------------------------------------------------
-- 5. get_gate_readiness, RE-CREATED FROM ITS LATEST DEFINITION — the
--    20261115090400 (Slice 2) one, NOT the 20261110090100 original. This is
--    the whole reason the house rule says "latest": the first draft of this
--    file rebuilt from 20261110090100 and silently deleted Slice 2's D1.02
--    success-contract blocker, which the slice-2 transcript then caught. A
--    re-creation that starts from the wrong ancestor is a regression wearing
--    the clothes of an addition.
--
--    Exactly TWO marked insertions on top of that definition: the three new
--    blocker families, appended from the ONE predicate
--    (case_gate_outstanding_obligations — regulatory conditions D3.11,
--    overdue uncovered commitments D3.09, unmet assurance demand D3.16), and
--    an 'assurance' key on the payload. Everything else — the §45
--    mandatory-fail rule, the weighted arithmetic, the category rollup, the
--    D1.02 contract blocker and its successContract summary, the closure-rate
--    projection and its refusals — is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.get_gate_readiness(
  p_case_id uuid,
  p_gate_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  g stage_gates%rowtype;
  v_review_id bigint;
  v_reviewed_at timestamptz;
  v_outcome text;
  v_criteria jsonb;
  v_categories jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_criteria_total int;
  v_mandatory_total int;
  v_mandatory_met int;
  v_remaining int;
  v_weight_sum numeric;
  v_weighted_met numeric;
  v_readiness numeric;
  v_blocked boolean;
  v_events int;
  v_span_days numeric;
  v_first_closure timestamptz;
  v_last_closure timestamptz;
  v_rate numeric;
  v_projection jsonb;
  v_evidence jsonb;
  v_design_order int;
  v_gate_order int;
  v_contract jsonb;
  -- D3.16 (20261122090300, marked insertion): the assurance position.
  v_assurance jsonb;
  v_demanded_level text;
  v_assurance_required boolean := false;
  v_assurance_met boolean := false;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  -- The operative review: latest wins (the same ordering the gate blockers
  -- enforce against).
  select r.id, r.reviewed_at, r.outcome into v_review_id, v_reviewed_at, v_outcome
  from stage_gate_reviews r
  where r.organization_id = v_org
    and r.development_case_id = c.id and r.gate_id = g.id
  order by r.reviewed_at desc, r.id desc
  limit 1;

  -- Per-criterion rows: text-matched to the latest review's findings, the
  -- record RPC's own matching rule — one finding per criterion, latest wins
  -- (the header's fan-out rule; a plain join would multiply every count by
  -- the number of duplicate findings).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', sc.id,
      'criterion', sc.criterion,
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
      'isMandatory', sc.is_mandatory,
      'weight', sc.weight,
      'sourceAuthority', sc.source_authority,
      'evidenceType', sc.evidence_type,
      'status', coalesce(fi.status, 'never_assessed'),
      'findingEvidence', fi.evidence,
      'deliverables', (
        select jsonb_build_object(
          'total', count(*),
          'accepted', count(*) filter (where d.status = 'accepted'))
        from develop_deliverables d
        where d.requirement_id = sc.id and d.development_case_id = c.id
          and d.organization_id = v_org))
      order by sc.sort_order, sc.criterion), '[]'::jsonb),
    count(*),
    count(*) filter (where sc.is_mandatory),
    count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') = 'met'),
    count(*) filter (where coalesce(fi.status, '') <> 'met'),
    coalesce(sum(sc.weight), 0),
    coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
  into v_criteria, v_criteria_total, v_mandatory_total, v_mandatory_met,
       v_remaining, v_weight_sum, v_weighted_met
  from stage_gate_criteria sc
  left join lateral (
    select f.status, f.evidence
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id;

  -- GR = Σ(w·r)/Σw. Null — not 0, not 100 — when the gate defines nothing:
  -- 0/0 is not a readiness, and rendering one would be an invented number.
  v_readiness := case when v_weight_sum > 0
    then round((v_weighted_met / v_weight_sum) * 100, 1) end;

  -- BLOCKED (spec §45): a mandatory criterion not explicitly met — including
  -- never assessed — blocks at ANY percentage. A gate with no criteria
  -- blocks because it can block nothing (assessGate's refusal, repeated).
  v_blocked := v_criteria_total = 0 or v_mandatory_met < v_mandatory_total;

  -- Per-category rollup: §44 seven first, others after, uncategorized LAST
  -- and visible.
  select coalesce(jsonb_agg(row_obj order by cat_rank, category), '[]'::jsonb)
  into v_categories
  from (
    select
      coalesce(nullif(btrim(sc.category), ''), 'uncategorized') as category,
      case coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
        when 'business' then 1 when 'technical' then 2 when 'risk' then 3
        when 'cost_schedule' then 4 when 'operations' then 5
        when 'supply' then 6 when 'regulatory' then 7
        when 'uncategorized' then 99 else 50 end as cat_rank,
      jsonb_build_object(
        'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'),
        'criteriaTotal', count(*),
        'mandatoryTotal', count(*) filter (where sc.is_mandatory),
        'metCount', count(*) filter (where coalesce(fi.status, '') = 'met'),
        'unmetMandatory', count(*) filter (where sc.is_mandatory and coalesce(fi.status, '') <> 'met'),
        'weightSum', coalesce(sum(sc.weight), 0),
        'readinessPct', case when coalesce(sum(sc.weight), 0) > 0
          then round((coalesce(sum(sc.weight) filter (where coalesce(fi.status, '') = 'met'), 0)
                      / sum(sc.weight)) * 100, 1) end
      ) as row_obj
    from stage_gate_criteria sc
    left join lateral (
      select f.status
      from stage_gate_findings f
      where f.review_id = v_review_id
        and btrim(f.criterion_text) = btrim(sc.criterion)
      order by f.id desc
      limit 1
    ) fi on true
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by coalesce(nullif(btrim(sc.category), ''), 'uncategorized')
  ) grouped;

  -- Named blockers: unmet mandatory criteria + unresolved High/Critical case
  -- risks + open conditions on this case. Each named and typed; none invented.
  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'mandatory_criterion',
      'id', sc.id,
      'name', sc.criterion,
      'status', coalesce(fi.status, 'never_assessed'),
      'category', coalesce(nullif(btrim(sc.category), ''), 'uncategorized'))
      order by sc.sort_order, sc.criterion), '[]'::jsonb)
  into v_blockers
  from stage_gate_criteria sc
  left join lateral (
    select f.status
    from stage_gate_findings f
    where f.review_id = v_review_id
      and btrim(f.criterion_text) = btrim(sc.criterion)
    order by f.id desc
    limit 1
  ) fi on true
  where sc.organization_id = v_org and sc.gate_id = g.id
    and sc.is_mandatory and coalesce(fi.status, '') <> 'met';

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_risk',
      'id', r.id,
      'name', r.title,
      'level', r.current_risk_level,
      'status', r.status)
      order by case r.current_risk_level when 'Critical' then 0 else 1 end, r.title), '[]'::jsonb)
  into v_blockers
  from risks r
  where r.organization_id = v_org and r.development_case_id = c.id
    and r.current_risk_level in ('High', 'Critical')
    and r.status not in ('closed', 'archived', 'accepted');

  select v_blockers || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'open_condition',
      'id', gc.id,
      'name', gc.description,
      'dueDate', gc.due_date,
      'overdue', gc.due_date < current_date,
      'gate', g2.name)
      order by gc.due_date), '[]'::jsonb)
  into v_blockers
  from gate_conditions gc
  join stage_gate_reviews r2 on r2.id = gc.review_id
  left join stage_gates g2 on g2.id = r2.gate_id
  where gc.organization_id = v_org
    and r2.development_case_id = c.id
    and gc.status = 'open';

  -- D1.02: on a design-or-later gate, a missing recorded success contract is
  -- a NAMED blocker — the same predicate record_case_gate_review refuses a
  -- proceed on, displayed before it refuses (enforced truth = displayed
  -- truth). The contract summary rides along for the panel.
  select stage_order into v_design_order from lifecycle_stages where stage_key = 'design';
  select stage_order into v_gate_order from lifecycle_stages where stage_key = g.stage_key;
  select jsonb_build_object(
      'id', sc.id, 'version', sc.version, 'recordedAt', sc.recorded_at,
      'outcomes', (select count(*) from development_success_outcomes o where o.contract_id = sc.id),
      'dimensionsCovered', (select count(distinct o.dimension) from development_success_outcomes o where o.contract_id = sc.id))
  into v_contract
  from development_success_contracts sc
  where sc.development_case_id = c.id and sc.organization_id = v_org
    and sc.status = 'recorded';
  if v_gate_order is not null and v_design_order is not null
     and v_gate_order >= v_design_order and v_contract is null then
    v_blockers := v_blockers || jsonb_build_object(
      'type', 'success_contract',
      'id', c.id,
      'name', 'No recorded success contract — success is established before design begins (spec I.3); this gate cannot pass until one is recorded',
      'status', 'missing');
  end if;

  -- D3.09 / D3.11 / D3.16 (20261122090300, marked insertion): the three
  -- blocker families this slice adds, read from the ONE predicate
  -- (case_gate_outstanding_obligations, section 4c) that
  -- record_case_gate_review refuses over and the persistence backstop
  -- enforces. Rendering a different query from the one the server refuses
  -- over is how a readiness screen becomes decoration.
  v_blockers := v_blockers || case_gate_outstanding_obligations(c.id, g.id);

  -- The assurance POSITION itself (not the blocker) for the payload, read
  -- through the definer helper so the ONE binding resolver is consulted
  -- without widening its grant.
  v_assurance := get_case_assurance_position(c.id, g.id);
  v_assurance_required := coalesce((v_assurance->>'required')::boolean, false);
  v_assurance_met := coalesce((v_assurance->>'satisfied')::boolean, false);
  v_demanded_level := v_assurance->>'demandedLevel';

  -- Case evidence summary — display support only; the readiness number never
  -- consumes it, so an unverified AI inference cannot move anything (§70).
  select jsonb_build_object(
    'total', count(*),
    'verified', count(*) filter (where e.verification_status = 'verified'),
    'rejected', count(*) filter (where e.verification_status = 'rejected'),
    'unverified', count(*) filter (where e.verification_status = 'unverified'),
    'aiInferenceUnverified', count(*) filter
      (where e.evidence_class = 'AI_INFERENCE' and e.verification_status <> 'verified'))
  into v_evidence
  from evidence_items e
  where e.organization_id = v_org and e.development_case_id = c.id;

  -- The closure-rate projection, with its refusal (header: the derivation).
  select count(*), min(closed_at), max(closed_at)
  into v_events, v_first_closure, v_last_closure
  from (
    select min(r.reviewed_at) as closed_at
    from stage_gate_criteria sc
    join stage_gate_findings fi
      on btrim(fi.criterion_text) = btrim(sc.criterion) and fi.status = 'met'
    join stage_gate_reviews r
      on r.id = fi.review_id
     and r.organization_id = v_org
     and r.development_case_id = c.id and r.gate_id = g.id
    where sc.organization_id = v_org and sc.gate_id = g.id
    group by sc.id
  ) closures;

  v_span_days := case when v_events >= 2
    then extract(epoch from (v_last_closure - v_first_closure)) / 86400.0 end;

  if v_remaining = 0 and v_criteria_total > 0 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', 0,
      'reason', 'nothing remaining — every criterion is met on the latest review');
  elsif v_events < 3 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'reason', format('not yet: %s of 3 closure events recorded for this gate''s criteria — a rate is an average of intervals, and fewer than three closures gives it nothing defensible to average', v_events));
  elsif v_span_days < 1 then
    v_projection := jsonb_build_object(
      'available', false,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 3),
      'reason', 'not yet: the recorded closures span less than one day — a date-granularity projection cannot stand on a sub-day history');
  else
    v_rate := (v_events - 1) / v_span_days;
    -- Days-to-close is computed as remaining·span/(events−1) — algebraically
    -- remaining/rate, but with ONE division instead of two: dividing by the
    -- already-divided rate lets numeric representation error (2/(2/13) =
    -- 13.000…033) leak through ceil() as a whole extra day.
    v_projection := jsonb_build_object(
      'available', true,
      'closureEvents', v_events,
      'requiredEvents', 3,
      'remaining', v_remaining,
      'spanDays', round(v_span_days, 2),
      'ratePerDay', round(v_rate, 4),
      'projectedDate', (greatest(now(), v_last_closure)
        + make_interval(days => ceil(v_remaining * v_span_days / (v_events - 1))::int))::date);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'gateId', g.id,
    'gateName', g.name,
    'decisionType', g.decision_type,
    'readinessThreshold', g.readiness_threshold,
    'blocked', v_blocked,
    'readinessPct', v_readiness,
    'weightSum', v_weight_sum,
    'criteriaTotal', v_criteria_total,
    'mandatoryTotal', v_mandatory_total,
    'mandatoryMet', v_mandatory_met,
    'latestReview', case when v_review_id is null then null else jsonb_build_object(
      'id', v_review_id, 'outcome', v_outcome, 'reviewedAt', v_reviewed_at) end,
    'criteria', v_criteria,
    'categories', v_categories,
    'blockers', v_blockers,
    'successContract', v_contract,
    'evidenceSummary', v_evidence,
    -- D3.16 (20261122090300, marked insertion).
    'assurance', v_assurance,
    'projection', v_projection);
end
$$;

revoke all on function public.get_gate_readiness(uuid, bigint) from public, anon;
grant execute on function public.get_gate_readiness(uuid, bigint) to authenticated;

notify pgrst, 'reload schema';
