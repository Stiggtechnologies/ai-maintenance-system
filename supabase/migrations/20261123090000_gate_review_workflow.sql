-- ============================================================================
-- Sync Develop Slice 3D — Workflow 2: the gate review (D3.31, spec III.§36),
-- and the §70 hole in framework adoption.
--
-- WHAT WAS ALREADY TRUE, AND IS NOT REBUILT HERE. The deterministic core of
-- the gate is DB-enforced and has been since Slice 1: advance_lifecycle_stage
-- refuses a stage move without a passing human review (20260816090000:431),
-- record_case_gate_review blocks on unmet mandatory criteria AND on silence,
-- trg_gate_review_provenance refuses a client writing an outcome directly,
-- trg_intensity_governance_binding and trg_outstanding_obligations_gate wall
-- the persistence boundary, and get_gate_readiness names every blocker. None
-- of that is touched. THIS FILE ADDS THE REVIEW EXPERIENCE the register row
-- says is missing: evidence pre-assembly, the blocker list read from the
-- predicates that already exist, an SoD-checked recorder, and a session
-- object a real screen can open, work through and close.
--
-- THE ONE RULE THAT SHAPES THE FILE: no fourth evaluator. Every number and
-- every blocker on the review pack is READ FROM THE SHIPPED PREDICATE —
-- get_gate_readiness (which itself composes assessGate's discipline,
-- case_gate_outstanding_obligations and get_case_assurance_position). A pack
-- that recomputed readiness would be a second opinion, and the moment the two
-- disagreed the screen would be the one people believe.
--
-- SPEC AMBIGUITY RESOLVED (§36 lists ten workflow steps; the spec does not
-- say whether they are a state machine). RULING: they are NOT. A gate review
-- is one human act with a prepared brief, so the session carries a snapshot
-- of what the reviewer was shown and the ten steps are rendered as the pack's
-- sections. Modelling ten persisted sub-states would invent a workflow engine
-- the product does not have and would let a "step 7 complete" row assert
-- readiness nothing computed.
--
-- SPEC AMBIGUITY RESOLVED (§42 does not name a pair for "who may record a
-- gate decision" beyond REQUESTER ≠ FINAL APPROVER). RULING: the SoD position
-- reported here states EXACTLY the rules record_case_gate_review already
-- enforces and invents none. gate_review_sod_position is a MIRROR, not a
-- policy: if it ever says "you may record" where the act site refuses, the
-- screen has lied, so the two are written from the same four conditions and
-- the smoke asserts they agree. Widening SoD is a policy act for the
-- authority family (D3.34), not something a review screen decides.
--
-- SPEC §70, THE POINT OF THIS SLICE: "the LLM never determines: gate passed
-- … project sanctioned". adopt_project_framework admitted 'ai_admin' among
-- its adopting roles — the AI-operator identity could adopt the framework
-- that decides which gates exist and what they demand, which is determining
-- the gate one level up. Re-created below with that role REFUSED BY NAME.
-- Authoring (create/add stage/add gate/set requirement) still admits it:
-- agents PROPOSE. Adoption is where the human disposes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ONE SoD PREDICATE.
--
--    Stated once, consumed three times:
--      * get_gate_review_pack renders it (what the screen says BEFORE the
--        reviewer fills a form);
--      * record_gate_review_outcome refuses over it by name (the act site);
--      * enforce_gate_review_session_integrity backstops it for every writer
--        of a session moving to 'decided', INSERT and UPDATE.
--
--    SECURITY DEFINER with the organization taken from the CASE, and the
--    actor passed in: the backstop runs with no JWT (the
--    case_gate_outstanding_obligations rule, same reason).
--
--    THE ORGANIZATION GUARD USES session_user, NOT current_user, AND THAT IS
--    THE WHOLE POINT. Inside a SECURITY DEFINER function current_user is the
--    function OWNER — 'postgres' — for every caller without exception, so
--    `current_user in ('authenticated','anon')` is a test that can never be
--    true and a guard written on it never fires. Verified on this database:
--    a definer function called over PostgREST reports
--    `current_user=postgres session_user=authenticator` for anon, for
--    authenticated and for the service key alike. session_user IS the
--    discriminator: 'authenticator' means the call arrived over the API, which
--    is exactly when "no organization claim" must fail closed. The one caller
--    that legitimately has no claim is the persistence backstop below, which
--    runs in-database as the migration owner.
-- ---------------------------------------------------------------------------
create or replace function public.gate_review_sod_position(
  p_case_id uuid,
  p_gate_id bigint,
  p_actor uuid
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
  v_role text;
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  v_pairs jsonb := '[]'::jsonb;
  -- array_append, not `|| 'literal'`: with an untyped string literal Postgres
  -- resolves `anyarray || anyanything` to the array-concat operator and tries
  -- to parse the literal AS an array, which fails at runtime with
  -- `malformed array literal` — a 22P02 reaching the user, which house law
  -- forbids. Every append below is explicit for that reason.
  v_blocked text[] := '{}';
  v_is_accountable boolean;
begin
  if v_caller_org is null and session_user = 'authenticator' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  select role into v_role from user_profiles where id = p_actor and organization_id = v_org;
  v_is_accountable := p_actor is not null
                      and (p_actor = c.sponsor_id or p_actor = c.created_by);

  -- PAIR 0 — §70. Not a segregation pair at all: a determination reserved to
  -- humans. Reported alongside the pairs because the screen has one question
  -- ("may I record this?") and one place to answer it.
  if coalesce(v_role, '') = 'ai_admin' then
    v_blocked := array_append(v_blocked, 'ai_operator_identity');
  end if;
  v_pairs := v_pairs || jsonb_build_array(jsonb_build_object(
    'pair', 'ai_operator_identity',
    'label', 'A gate decision is a §70 human determination',
    'applies', true,
    'clear', coalesce(v_role, '') <> 'ai_admin',
    'reason', case when coalesce(v_role, '') = 'ai_admin'
      then 'the AI-operator identity cannot record a gate decision (spec §70)'
      else 'the recorder is a human identity' end));

  -- PAIR 1 — authority. record_case_gate_review's own role gate, mirrored.
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    v_blocked := array_append(v_blocked, 'recorder_authority');
  end if;
  v_pairs := v_pairs || jsonb_build_array(jsonb_build_object(
    'pair', 'recorder_authority',
    'label', 'Recording a gate decision requires a governance or engineering role',
    'applies', true,
    'clear', coalesce(v_role, '') in ('admin','executive','maintenance_manager','reliability_engineer'),
    'reason', case when coalesce(v_role, '') in ('admin','executive','maintenance_manager','reliability_engineer')
      then format('role %s may record gate decisions', v_role)
      else format('role %s may not record gate decisions', coalesce(v_role, 'none')) end));

  -- PAIR 2 — §42 REQUESTER ≠ FINAL APPROVER, at the per-gate flag. The
  -- accountable pair is (sponsor, creator), the same pair every independence
  -- rule in this family uses.
  if g.independent_assurance_required and v_is_accountable then
    v_blocked := array_append(v_blocked, 'gate_independence');
  end if;
  v_pairs := v_pairs || jsonb_build_array(jsonb_build_object(
    'pair', 'gate_independence',
    'label', 'This gate requires independent assurance: not the sponsor, not the creator',
    'applies', g.independent_assurance_required,
    'clear', not (g.independent_assurance_required and v_is_accountable),
    'reason', case
      when not g.independent_assurance_required then 'this gate does not require independent assurance'
      when v_is_accountable then 'you are the case sponsor or creator and this gate requires independent assurance'
      else 'you are neither the case sponsor nor its creator' end));

  -- PAIR 3 — the same independence, demanded case-wide by the ADOPTED
  -- intensity binding. Absence enforces nothing (the enforce_authority_limit
  -- posture): with no determination and no adopted binding the pair does not
  -- apply, and this function says so rather than inventing a demand.
  select * into v_gov from development_case_governance
  where development_case_id = c.id and status = 'current';
  if v_gov.id is not null then
    v_bind := resolve_case_intensity_binding(v_org, v_gov.intensity_level);
  end if;
  if v_bind.id is not null and v_bind.independent_assurance_required and v_is_accountable then
    v_blocked := array_append(v_blocked, 'intensity_independence');
  end if;
  v_pairs := v_pairs || jsonb_build_array(jsonb_build_object(
    'pair', 'intensity_independence',
    'label', 'The adopted governance intensity demands independent assurance case-wide',
    'applies', coalesce(v_bind.independent_assurance_required, false),
    'clear', not (coalesce(v_bind.independent_assurance_required, false) and v_is_accountable),
    'intensityLevel', v_gov.intensity_level,
    'reason', case
      when v_gov.id is null then 'no governance determination is recorded for this case, so no intensity demand applies'
      when v_bind.id is null then format('intensity %s has no adopted binding, so it demands nothing yet', v_gov.intensity_level)
      when not v_bind.independent_assurance_required then format('the adopted %s binding does not require independent assurance', v_gov.intensity_level)
      when v_is_accountable then format('this case is governed at %s intensity, whose adopted binding requires independent assurance, and you are its sponsor or creator', v_gov.intensity_level)
      else format('the adopted %s binding requires independent assurance and you are independent of the case', v_gov.intensity_level) end));

  return jsonb_build_object(
    'actorId', p_actor,
    'actorRole', v_role,
    'isSponsorOrCreator', v_is_accountable,
    'mayRecord', array_length(v_blocked, 1) is null,
    'blockedBy', to_jsonb(v_blocked),
    'pairs', v_pairs);
end
$$;

revoke all on function public.gate_review_sod_position(uuid, bigint, uuid) from public, anon;
grant execute on function public.gate_review_sod_position(uuid, bigint, uuid) to authenticated, service_role;

comment on function public.gate_review_sod_position(uuid, bigint, uuid) is
  'D3.31 / spec §42+§70: whether this actor may record THIS gate''s decision, and which condition stops them. A MIRROR of record_case_gate_review''s four refusals, never a wider policy — rendered by get_gate_review_pack, refused over by record_gate_review_outcome, backstopped by enforce_gate_review_session_integrity.';

-- ---------------------------------------------------------------------------
-- 2. EVIDENCE PRE-ASSEMBLY.
--
--    WHAT "PRE-ASSEMBLED" MEANS HERE, AND WHAT IT REFUSES TO MEAN. Evidence
--    is attached to a requirement by a RECORDED LINK or it is not attached at
--    all. Two links exist and both are real:
--      * a deliverable carries requirement_id (a human bound it there), and
--        the document it was produced from carries evidence;
--      * an evidence item carries source_reference 'criterion:<id>' — the
--        convention record_case_evidence already persists and the evidence
--        agent already writes.
--    Term-overlap matching is deliberately NOT used to assemble the pack. The
--    evidence agent may score similarity as ADVICE; a review brief that
--    silently promoted a keyword hit to "supporting evidence" would put the
--    reviewer's name on a link nobody made.
--
--    "No evidence is linked to this requirement" is therefore a first-class,
--    frequent, correct answer — and it is exactly the sentence a reviewer
--    needs before ticking `met`.
-- ---------------------------------------------------------------------------
create or replace function public.gate_requirement_evidence(
  p_case_id uuid,
  p_criterion_id bigint
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
  v_org uuid;
  v_deliverables jsonb;
  v_evidence jsonb;
  v_ids uuid[];
  v_withheld int := 0;
begin
  -- session_user, not current_user: see gate_review_sod_position's header. A
  -- definer function sees current_user='postgres' for every caller, so the old
  -- test never fired and a service-key call with no organization claim read
  -- ANY tenant's deliverables and evidence by case id.
  if v_caller_org is null and session_user = 'authenticator' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'title', d.title, 'type', d.type, 'status', d.status,
      'revision', d.revision, 'requiredDate', d.required_date,
      'documentId', d.document_id,
      'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = d.owner_id),
      'acceptedAt', d.accepted_at,
      'acceptedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = d.accepted_by))
      order by d.status, d.title), '[]'::jsonb)
  into v_deliverables
  from develop_deliverables d
  where d.organization_id = v_org and d.development_case_id = c.id
    and d.requirement_id = p_criterion_id;

  -- The linked evidence set: bound through an accepted-or-submitted
  -- deliverable's document, or self-declared against this criterion.
  --
  -- THE RISK-SENSITIVITY LADDER IS APPLIED BY HAND HERE, and it has to be.
  -- evidence_items carries risk_id and the policy evidence_items_risk_sensitive
  -- (`risk_id is null or can_read_risk(risk_id)`), but this function is
  -- SECURITY DEFINER so that policy does not run. can_read_risk resolves
  -- against auth.uid()/app_current_org() — JWT claims, not the executing role —
  -- so it still answers for the REQUESTER inside a definer, which is exactly
  -- what makes the hand-applied filter correct rather than decorative. The
  -- withheld count is reported: a reviewer who is one item short should be told
  -- so, not shown a shorter list that looks complete.
  select coalesce(array_agg(distinct e.id) filter (
           where e.risk_id is null or can_read_risk(e.risk_id)), '{}'),
         count(distinct e.id) filter (
           where e.risk_id is not null and not can_read_risk(e.risk_id))
  into v_ids, v_withheld
  from evidence_items e
  where e.organization_id = v_org and e.development_case_id = c.id
    and (
      e.source_reference = 'criterion:' || p_criterion_id::text
      or (e.document_id is not null and e.document_id in (
        select d.document_id from develop_deliverables d
        where d.organization_id = v_org and d.development_case_id = c.id
          and d.requirement_id = p_criterion_id and d.document_id is not null))
    );

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'evidenceClass', e.evidence_class,
      'verificationStatus', e.verification_status,
      'description', e.description,
      'sourceSystem', e.source_system,
      'sourceReference', e.source_reference,
      'revision', e.revision,
      'applicability', e.applicability,
      'observedAt', e.ts,
      'verifiedAt', e.verified_at,
      'verifiedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = e.verified_by),
      'link', case when e.source_reference = 'criterion:' || p_criterion_id::text
        then 'recorded against this requirement'
        else 'carried by a deliverable bound to this requirement' end,
      -- The §46 composite, per item, computed or REFUSED by name — the D11.22
      -- function, not a second arithmetic.
      'confidence', compute_evidence_confidence(e.id))
      order by e.ts desc), '[]'::jsonb)
  into v_evidence
  from evidence_items e
  where e.id = any(v_ids);

  return jsonb_build_object(
    'criterionId', p_criterion_id,
    'deliverables', v_deliverables,
    'evidence', v_evidence,
    'evidenceCount', jsonb_array_length(v_evidence),
    'withheldCount', v_withheld,
    'verifiedCount', (
      select count(*) from jsonb_array_elements(v_evidence) x
      where x->>'verificationStatus' = 'verified'),
    'statement', case
      when jsonb_array_length(v_evidence) = 0 and jsonb_array_length(v_deliverables) = 0
        then 'No deliverable and no evidence is linked to this requirement. Nothing has been assembled for it — a met finding here rests on the reviewer''s own knowledge, not on a record.'
        || case when v_withheld > 0 then format(' %s further item(s) are linked but bound to a risk you may not read.', v_withheld) else '' end
      when jsonb_array_length(v_evidence) = 0
        then format('%s deliverable(s) are bound to this requirement, but no evidence item is linked to any of them.', jsonb_array_length(v_deliverables))
        || case when v_withheld > 0 then format(' %s item(s) are linked but bound to a risk you may not read.', v_withheld) else '' end
      else format('%s evidence item(s) linked, %s verified.',
        jsonb_array_length(v_evidence),
        (select count(*) from jsonb_array_elements(v_evidence) x where x->>'verificationStatus' = 'verified'))
        || case when v_withheld > 0 then format(' A further %s item(s) are linked but bound to a risk you may not read.', v_withheld) else '' end
      end);
end
$$;

revoke all on function public.gate_requirement_evidence(uuid, bigint) from public, anon;
grant execute on function public.gate_requirement_evidence(uuid, bigint) to authenticated, service_role;

comment on function public.gate_requirement_evidence(uuid, bigint) is
  'D3.31 / spec §36 step 3-4: the RECORDED evidence behind one gate requirement — deliverables bound by requirement_id, evidence linked by source_reference or by a bound deliverable''s document, each carrying its §46 confidence or the named refusal. Term matching is deliberately absent: an unlinked item is reported as unlinked.';

-- ---------------------------------------------------------------------------
-- 3. THE REVIEW PACK — §36 steps 1..9, assembled, with step 10 left to the
--    human. Every section is a shipped predicate's own output.
-- ---------------------------------------------------------------------------
--    SECURITY INVOKER, and that is load-bearing. get_gate_readiness is
--    INVOKER on purpose so the risk-sensitivity ladder applies to the risk
--    blockers it names. A SECURITY INVOKER function called from inside a
--    SECURITY DEFINER one runs as the DEFINER, so wrapping it in a definer
--    pack would silently show every reviewer every confidential risk. The
--    pack therefore runs as the caller and reaches its sub-answers through
--    definer helpers that were designed to be called that way — exactly the
--    shape get_gate_readiness itself uses for case_gate_outstanding_obligations.
create or replace function public.get_gate_review_pack(
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
  v_readiness jsonb;
  v_requirements jsonb := '[]'::jsonb;
  rec record;
  v_waivers jsonb;
  v_session jsonb;
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

  -- THE READINESS AND THE BLOCKERS ARE NOT RECOMPUTED — this is the shipped
  -- payload, under the caller's own rights (see the header note on INVOKER).
  v_readiness := get_gate_readiness(c.id, g.id);
  if v_readiness ? 'error' then
    return v_readiness;
  end if;

  -- Per requirement: the shipped readiness row, plus what has been assembled
  -- for it, plus the standing waiver if one is active.
  for rec in
    select (x->>'id')::bigint as criterion_id, x as row_obj
    from jsonb_array_elements(coalesce(v_readiness->'criteria', '[]'::jsonb)) x
  loop
    v_requirements := v_requirements || jsonb_build_array(
      rec.row_obj || jsonb_build_object(
        'assembled', gate_requirement_evidence(c.id, rec.criterion_id),
        'activeWaiver', (
          select jsonb_build_object(
            'id', w.id, 'status', w.status, 'expiresAt', w.expires_at,
            'justification', w.justification)
          from standard_site_variances w
          where w.subject_type = 'gate_requirement'
            and w.development_case_id = c.id and w.requirement_id = rec.criterion_id
            and w.status = 'approved' and w.expires_at > now()
          limit 1)));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'requirementId', w.requirement_id, 'status', w.status,
      'justification', w.justification, 'expiresAt', w.expires_at,
      'riskId', w.risk_id)
      order by w.requested_at desc), '[]'::jsonb)
  into v_waivers
  from standard_site_variances w
  where w.organization_id = v_org and w.subject_type = 'gate_requirement'
    and w.development_case_id = c.id;

  select jsonb_build_object(
    'id', s.id, 'status', s.status, 'openedAt', s.opened_at,
    'openedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = s.opened_by),
    'openedById', s.opened_by,
    'reviewId', s.review_id, 'decidedAt', s.decided_at)
  into v_session
  from gate_review_sessions s
  where s.organization_id = v_org and s.development_case_id = c.id
    and s.gate_id = g.id and s.status = 'open'
  order by s.opened_at desc
  limit 1;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'gateId', g.id,
    'gateName', g.name,
    'decisionType', g.decision_type,
    'independentAssuranceRequired', g.independent_assurance_required,
    -- §36 steps 1-2 and 5-7: requirements, readiness, risks, approvals and
    -- cost/schedule confidence all ride the ONE readiness payload.
    'readiness', v_readiness,
    -- §36 steps 3-4: evidence retrieved and its quality stated.
    'requirements', v_requirements,
    'waivers', v_waivers,
    -- §36 steps 8-9: the assurance brief and the independent review.
    'assurance', v_readiness->'assurance',
    'evidenceConfidence', get_case_evidence_confidence(c.id),
    -- §36 step 10 is the human's. This says whether THIS human may take it.
    'sod', gate_review_sod_position(c.id, g.id, auth.uid()),
    'openSession', v_session);
end
$$;

revoke all on function public.get_gate_review_pack(uuid, bigint) from public, anon;
grant execute on function public.get_gate_review_pack(uuid, bigint) to authenticated;

comment on function public.get_gate_review_pack(uuid, bigint) is
  'D3.31 / spec III.§36: the pre-assembled gate review brief. Readiness, blockers and the assurance position are get_gate_readiness'' own output — never recomputed — plus per-requirement evidence assembly and the SoD position of the caller.';

-- ---------------------------------------------------------------------------
-- 4. THE SESSION. A gate review is an act with a beginning: someone opened
--    the brief, at a time, and this is what it said then. Without that record
--    "the reviewer saw the blockers" is an assumption.
-- ---------------------------------------------------------------------------
create table if not exists public.gate_review_sessions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  gate_id bigint not null references stage_gates(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open','decided','abandoned')),
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  -- WHAT THE SNAPSHOT HOLDS, AND THE ONE THING IT DELIBERATELY DOES NOT.
  -- Evidence of the information position at opening: the SoD determination
  -- and the outstanding obligations, both taken from DEFINER predicates
  -- designed to be called with no JWT. The READINESS FIGURES ARE NOT COPIED
  -- HERE. get_gate_readiness is SECURITY INVOKER so the risk-sensitivity
  -- ladder applies to the risks it names; snapshotting it from this DEFINER
  -- RPC would write confidential risk titles into a row every member of the
  -- organization can read. The reviewer sees those numbers on the pack, under
  -- their own rights, which is where they belong.
  pack_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(pack_snapshot) = 'object'),
  sod_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sod_snapshot) = 'object'),
  -- Outstanding obligations (D3.09/D3.11/D3.16) standing at the moment the
  -- brief was opened. Not "blockers": the mandatory-criterion and risk
  -- families are counted on the pack, not here, for the reason above.
  outstanding_obligations int not null default 0 check (outstanding_obligations >= 0),
  review_id bigint references stage_gate_reviews(id) on delete set null,
  decided_at timestamptz,
  abandoned_reason text,
  created_at timestamptz not null default now(),
  -- A decided session names the review it produced; an abandoned one names
  -- why. Neither state is reachable without its own record.
  constraint gate_review_session_terminal check (
    (status <> 'decided' or (review_id is not null and decided_at is not null))
    and (status <> 'abandoned' or btrim(coalesce(abandoned_reason, '')) <> '')
  )
);

-- One open session per gate per case: two reviewers each holding "the" open
-- brief is two answers to one question.
create unique index if not exists idx_gate_review_one_open
  on gate_review_sessions(development_case_id, gate_id)
  where status = 'open';
create index if not exists idx_gate_review_sessions_case
  on gate_review_sessions(organization_id, development_case_id, gate_id, status);

alter table public.gate_review_sessions enable row level security;
drop policy if exists gate_review_sessions_read on public.gate_review_sessions;
create policy gate_review_sessions_read on public.gate_review_sessions
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 4b. THE PERSISTENCE BACKSTOP, INSERT AND UPDATE AND DELETE.
--
--     Three things it refuses, for every writer:
--       * a session OPENED by the AI-operator identity (§70), read from the
--         ONE SoD predicate so the screen, the RPC and this trigger cannot
--         disagree;
--       * a session moved to 'decided' when THE IDENTITY THAT ACTUALLY DECIDED
--         may not record this gate's decision;
--       * a decided session pointing at a review of a different case or gate.
--     A write without the transaction-local marker is refused outright:
--     sessions are born in open_gate_review and move in the two RPCs below.
--
--     WHOSE SoD IS CHECKED ON THE 'decided' TRANSITION, AND WHY IT IS NOT THE
--     OPENER'S. The first version of this trigger evaluated the SoD position of
--     new.opened_by and refused the transition over it. That is the wrong
--     person: open_gate_review admits 'planner' and the recorder_authority pair
--     does not, so every session a planner opened was born undecidable — the
--     manager's decision was written by record_case_gate_review and then rolled
--     back by this trigger, with a message naming the planner's role and
--     escaping the RPC's {error:...} contract as a thrown PostgREST error. The
--     intended §42 workflow has the same shape: the sponsor opens the brief on
--     an independence-required gate and an independent reviewer records it.
--     The deciding identity is not derivable from a GUC here, and it does not
--     need to be — a decided session names the review it produced, and
--     stage_gate_reviews.reviewed_by IS the identity that decided (itself
--     walled to humans by trg_review_recorder_is_human). The review is loaded
--     first and its recorder is the actor this check is about. The opener's
--     §70 position is still checked, because an AI-opened brief is corrupt
--     whoever later decides it.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_review_session_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.gate_review_session_write', true), '');
  v_sod jsonb;
  v_decider_sod jsonb;
  r stage_gate_reviews%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Mid-cascade: the case, the gate or the organization this session hangs
    -- off is already gone, so the FK's own `on delete cascade` is collecting
    -- it. The refusal below is for a delete aimed at the session itself, which
    -- is the act it exists to stop. Without this the cascade the FK promised
    -- could never run and the parent case was undeletable — the FK declaring a
    -- cleanup the trigger forbade (the enforce_framework_immutability idiom,
    -- 20261101090100: "a parent row that no longer exists means the member row
    -- is mid-cascade; the cascade proceeds").
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id)
       or not exists (select 1 from stage_gates where id = old.gate_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A gate review session is the record that a brief was opened and read. It is not deleted — '
        'abandon it with a stated reason (abandon_gate_review) so the record of the attempt survives.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- One condition, stated once. The earlier form was
  -- `if v_marker <> 'granted' or current_user in (...) then if v_marker <>
  -- 'granted' then raise` — whose second disjunct could never change the
  -- outcome, and could never be true anyway: inside a SECURITY DEFINER function
  -- current_user is the owner ('postgres') for every caller. It read as a wall
  -- it did not build, so it is gone rather than dressed up.
  if v_marker <> 'granted' then
    raise exception
      'A gate review session cannot be written directly: open_gate_review, record_gate_review_outcome '
      'and abandon_gate_review are the paths, and each records who acted and what the brief said.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §70 on the OPENER. Unconditional: a brief held by an identity that may not
  -- record the decision is corrupt governance data whoever writes it (the
  -- enforce_case_assurance_independence posture, 20261121090300).
  v_sod := gate_review_sod_position(new.development_case_id, new.gate_id, new.opened_by);
  if coalesce(v_sod->>'actorRole', '') = 'ai_admin' then
    raise exception
      'A gate review is a §70 human determination: the AI-operator identity cannot open or hold one. '
      'The gate agent reports readiness; it does not review.'
      using errcode = 'check_violation';
  end if;

  if new.status = 'decided'
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    -- The review first: it names the identity whose SoD position this is about.
    select * into r from stage_gate_reviews where id = new.review_id;
    if not found
       or r.development_case_id is distinct from new.development_case_id
       or r.gate_id is distinct from new.gate_id then
      raise exception
        'A decided gate review session names the review it produced, on the same case and the same gate. '
        'This one names review % — a different subject.', new.review_id
        using errcode = 'check_violation';
    end if;
    v_decider_sod := gate_review_sod_position(
      new.development_case_id, new.gate_id, r.reviewed_by);
    if not coalesce((v_decider_sod->>'mayRecord')::boolean, false) then
      raise exception
        'This session cannot be closed as decided: the review it names was recorded by an identity that '
        'may not record this gate''s decision — %. The same conditions refuse the decision at '
        'record_case_gate_review; a session cannot record what the act site would not accept.',
        coalesce((select string_agg(x->>'reason', '; ')
                  from jsonb_array_elements(v_decider_sod->'pairs') x
                  where not coalesce((x->>'clear')::boolean, true)), 'segregation of duties')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_gate_review_session_integrity() from public, anon, authenticated;

drop trigger if exists trg_gate_review_session_integrity on public.gate_review_sessions;
create trigger trg_gate_review_session_integrity
  before insert or update or delete on public.gate_review_sessions
  for each row execute function public.enforce_gate_review_session_integrity();

-- ---------------------------------------------------------------------------
-- 4c. THE §70 RECORDER WALL ON THE REVIEW ITSELF.
--
--     record_case_gate_review already refuses 'ai_admin' by name. That is a
--     door; this is the wall behind it. UNCONDITIONAL — service path included
--     — because a gate decision attributed to the AI-operator identity is
--     corrupt data however it arrived, and a restore that re-inserts one is
--     re-asserting it. Covers INSERT and UPDATE: re-pointing reviewed_by is
--     the same claim made with a different verb.
--
--     TRIGGER NAME IS LOAD-BEARING. Same-timing row triggers fire
--     alphabetically; the shipped BEFORE triggers are
--     trg_gate_review_provenance, trg_intensity_governance_binding and
--     trg_outstanding_obligations_gate. trg_review_recorder_is_human sorts
--     after all three, so every transcript asserting those refusals is
--     unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_review_recorder_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.reviewed_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.reviewed_by is not distinct from old.reviewed_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.reviewed_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A gate outcome cannot be attributed to the AI-operator identity (spec §70: the LLM never determines '
      'that a gate passed). AI explains, detects and prepares; an authorized human decides and is named.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_gate_review_recorder_is_human() from public, anon, authenticated;

drop trigger if exists trg_review_recorder_is_human on public.stage_gate_reviews;
create trigger trg_review_recorder_is_human
  before insert or update on public.stage_gate_reviews
  for each row execute function public.enforce_gate_review_recorder_is_human();

-- ---------------------------------------------------------------------------
-- 5. OPEN. Snapshots the brief, records who opened it and how many blockers
--    stood at that moment.
-- ---------------------------------------------------------------------------
create or replace function public.open_gate_review(
  p_case_id uuid,
  p_gate_id bigint
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
  g stage_gates%rowtype;
  v_sod jsonb;
  v_obligations jsonb;
  v_assurance jsonb;
  v_id bigint;
  v_existing gate_review_sessions%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'opening a gate review is a §70 human act — the AI-operator identity prepares readiness reports, it does not review gates');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'opening a gate review requires a governance, engineering or planning role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'gate reviews are not openable on a ' || c.status || ' case');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  select * into v_existing from gate_review_sessions
  where development_case_id = c.id and gate_id = g.id and status = 'open';
  if found then
    return jsonb_build_object('error',
      format('a gate review of %s is already open (opened %s by %s) — continue it, or abandon it with a reason before opening another',
             g.name, to_char(v_existing.opened_at, 'YYYY-MM-DD HH24:MI'),
             coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = v_existing.opened_by), 'another member')),
      'session_id', v_existing.id);
  end if;

  v_sod := gate_review_sod_position(c.id, g.id, auth.uid());
  v_obligations := case_gate_outstanding_obligations(c.id, g.id);
  v_assurance := get_case_assurance_position(c.id, g.id);

  perform set_config('app.gate_review_session_write', 'granted', true);
  insert into gate_review_sessions
    (organization_id, development_case_id, gate_id, opened_by, pack_snapshot,
     sod_snapshot, outstanding_obligations)
  values
    (v_org, c.id, g.id, auth.uid(),
     jsonb_build_object(
       'gate', g.name,
       'decisionType', g.decision_type,
       'independentAssuranceRequired', g.independent_assurance_required,
       'outstandingObligations', v_obligations,
       'assurance', v_assurance,
       'readinessNote', 'Readiness percentages and risk blockers are not copied into this session: they are read under the reviewer''s own rights on the review pack, where the risk-sensitivity ladder applies.'),
     v_sod, jsonb_array_length(coalesce(v_obligations, '[]'::jsonb)))
  returning id into v_id;
  perform set_config('app.gate_review_session_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data, new_state)
  values (v_org, 'gate_review_session', coalesce(v_role, 'unknown'),
    jsonb_build_object('session_id', v_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name,
      'outstanding_obligations', jsonb_array_length(coalesce(v_obligations, '[]'::jsonb)),
      'assurance_required', v_assurance->'required',
      'assurance_satisfied', v_assurance->'satisfied',
      'may_record', v_sod->'mayRecord'),
    jsonb_build_object('status', 'open', 'opened_by', auth.uid()));

  return jsonb_build_object(
    'session_id', v_id,
    'gate', g.name,
    'outstanding_obligations', jsonb_array_length(coalesce(v_obligations, '[]'::jsonb)),
    'may_record', v_sod->'mayRecord',
    'sod', v_sod);
end
$$;

revoke all on function public.open_gate_review(uuid, bigint) from public, anon;
grant execute on function public.open_gate_review(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RECORD. The SoD check by name, then THE SHIPPED ACT SITE.
--
--    This function does not re-implement one line of the gate decision. It
--    calls record_case_gate_review, which keeps every refusal it already
--    makes — mandatory block, waiver stand-in, success contract, composite
--    authority, funding question, the outstanding-obligation predicate — and
--    returns its answer VERBATIM, error and all. The only thing added is the
--    SoD position stated before the act and the session linked after it.
--    auth.uid() is a JWT claim, so it is unchanged across this nested
--    SECURITY DEFINER call and the act site still sees the real actor.
-- ---------------------------------------------------------------------------
create or replace function public.record_gate_review_outcome(
  p_session_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_conditions jsonb default '[]'::jsonb,
  p_evaluation_id uuid default null,
  p_funding_answer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  s gate_review_sessions%rowtype;
  v_sod jsonb;
  v_result jsonb;
  v_review_id bigint;
  v_blocked text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  select * into s from gate_review_sessions
  where id = p_session_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate review session not found');
  end if;
  if s.status <> 'open' then
    return jsonb_build_object('error',
      format('this gate review is already %s — open a new one to record another decision', s.status));
  end if;

  -- Re-evaluated NOW, not read from the snapshot: independence can change
  -- between opening a brief and deciding on it, and the snapshot is evidence
  -- of what was shown, never an authority.
  v_sod := gate_review_sod_position(s.development_case_id, s.gate_id, auth.uid());
  if not coalesce((v_sod->>'mayRecord')::boolean, false) then
    select string_agg(x->>'reason', '; ') into v_blocked
    from jsonb_array_elements(v_sod->'pairs') x
    where not coalesce((x->>'clear')::boolean, true);
    return jsonb_build_object('error',
      format('you cannot record this gate decision: %s', coalesce(v_blocked, 'segregation of duties')),
      'sod', v_sod);
  end if;

  -- THE ONE ACT SITE. Every refusal below this line is the shipped
  -- function's, rendered as it wrote it.
  v_result := record_case_gate_review(
    s.development_case_id, s.gate_id, p_outcome, p_note,
    coalesce(p_findings, '[]'::jsonb), coalesce(p_conditions, '[]'::jsonb),
    p_evaluation_id, p_funding_answer);
  if v_result ? 'error' then
    return v_result;
  end if;
  v_review_id := (v_result->>'review_id')::bigint;

  perform set_config('app.gate_review_session_write', 'granted', true);
  update gate_review_sessions
  set status = 'decided', review_id = v_review_id, decided_at = now()
  where id = s.id;
  perform set_config('app.gate_review_session_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'gate_review_session', coalesce(v_role, 'unknown'),
    jsonb_build_object('session_id', s.id, 'case_id', s.development_case_id,
      'gate_id', s.gate_id, 'review_id', v_review_id, 'outcome', p_outcome,
      'obligations_at_open', s.outstanding_obligations),
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'decided', 'review_id', v_review_id,
      'decided_by', auth.uid()));

  return v_result || jsonb_build_object('session_id', s.id, 'session_status', 'decided');
end
$$;

revoke all on function public.record_gate_review_outcome(bigint, text, text, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.record_gate_review_outcome(bigint, text, text, jsonb, jsonb, uuid, text) to authenticated;

comment on function public.record_gate_review_outcome(bigint, text, text, jsonb, jsonb, uuid, text) is
  'D3.31: the SoD-checked recorder. States the segregation position by name, then delegates to record_case_gate_review — the ONE act site — and returns its result, refusals verbatim. It re-implements no part of the gate decision.';

-- ---------------------------------------------------------------------------
-- 7. ABANDON. A review opened and not taken is itself a fact worth keeping:
--    "we looked at G3 in March and walked away" is governance history.
-- ---------------------------------------------------------------------------
create or replace function public.abandon_gate_review(
  p_session_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  s gate_review_sessions%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  select * into s from gate_review_sessions
  where id = p_session_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate review session not found');
  end if;
  if s.status <> 'open' then
    return jsonb_build_object('error', 'this gate review is already ' || s.status);
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    return jsonb_build_object('error',
      'state why this review is being abandoned (10 characters minimum) — an abandoned review with no reason is an unexplained gap in the gate''s history');
  end if;
  if auth.uid() <> s.opened_by
     and coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error',
      'only the member who opened this review, or an executive or administrator, may abandon it');
  end if;

  perform set_config('app.gate_review_session_write', 'granted', true);
  update gate_review_sessions
  set status = 'abandoned', abandoned_reason = btrim(p_reason)
  where id = s.id;
  perform set_config('app.gate_review_session_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'gate_review_session', coalesce(v_role, 'unknown'),
    jsonb_build_object('session_id', s.id, 'case_id', s.development_case_id,
      'gate_id', s.gate_id, 'reason', btrim(p_reason)),
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'abandoned', 'abandoned_by', auth.uid()));

  return jsonb_build_object('session_id', s.id, 'status', 'abandoned');
end
$$;

revoke all on function public.abandon_gate_review(bigint, text) from public, anon;
grant execute on function public.abandon_gate_review(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. §70 — ADOPTION IS NOT AN AI ACT.
--
--    Re-created from its 20261101090100 definition with ONE marked
--    insertion: 'ai_admin' leaves the adopting role set and is refused by
--    name. Everything else is byte-identical, diffed at authoring time.
--
--    WHY THIS IS THE SAME RULE, NOT A NEW ONE. The framework decides which
--    gates exist, what each demands, and which of them require independent
--    assurance. An identity that can adopt one has determined every gate the
--    product will ever evaluate — §70's "gate passed" prohibition read one
--    level up. The methodology agent (D12.06, next migration) exists
--    precisely to PROPOSE frameworks; this is the line it cannot cross.
-- ---------------------------------------------------------------------------
create or replace function public.adopt_project_framework(
  p_framework_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f project_frameworks%rowtype;
  v_stages int;
  v_gates int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  -- §70 (20261123090000, marked insertion): named before the role set so the
  -- refusal says what it is rather than "you need a different role".
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'adopting a project framework decides which gates exist and what every one of them demands — a §70 human determination the AI-operator identity cannot record. Propose it (propose_framework_from_document); a human adopts it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'adopting a project framework requires an executive or administrator');
  end if;
  select * into f from project_frameworks where id = p_framework_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'framework not found');
  end if;
  if f.status <> 'draft' then
    return jsonb_build_object('error', 'only draft frameworks can be adopted');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the authority and basis for adoption (20 characters minimum)');
  end if;
  select count(*) into v_stages from project_framework_stages where framework_id = f.id;
  select count(*) into v_gates from stage_gates where framework_id = f.id;
  if v_stages = 0 or v_gates = 0 then
    return jsonb_build_object('error',
      'this framework is not executable: it needs at least one stage and one gate before it can govern anything');
  end if;

  perform set_config('app.framework_write', 'granted', true);

  update project_frameworks set status = 'superseded', superseded_by = f.id
  where organization_id = v_org and name = f.name and status = 'adopted';

  update project_frameworks
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      effective_date = coalesce(effective_date, current_date),
      basis = basis || ' | Adoption: ' || btrim(p_note)
  where id = f.id;

  perform set_config('app.framework_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('framework_id', f.id, 'action', 'adopted', 'name', f.name,
      'version', f.version, 'note', btrim(p_note)));

  return jsonb_build_object('framework_id', f.id, 'status', 'adopted',
    'name', f.name, 'version', f.version);
end
$$;

revoke all on function public.adopt_project_framework(uuid, text) from public, anon;
grant execute on function public.adopt_project_framework(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
