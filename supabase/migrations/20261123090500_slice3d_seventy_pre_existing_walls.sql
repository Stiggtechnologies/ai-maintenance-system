-- ============================================================================
-- Sync Develop Slice 3D — REPAIR: the §70 walls behind doors that were already
-- shipped, and TRUNCATE.
--
-- Everything in this file touches an object that existed BEFORE Slice 3D. The
-- defects inside 3D's own migrations are fixed in those files, which have
-- never been applied outside a local reset; this one exists because rewriting
-- a shipped migration retroactively is not a thing this repository does.
--
-- WHAT THIS FILE FIXES, AND WHY EACH ONE IS A WALL AND NOT A DOOR.
--
-- 20261123090000 closed the framework-adoption hole at the RPC and its header
-- called that one of "four doors enforced at the database". It was not: three
-- of the four carry an unconditional persistence trigger and framework
-- adoption carried none. enforce_framework_immutability has an explicitly
-- AUDITED SERVICE PATH (20261101090100:493) that returns `new` after writing a
-- security_events warning, and it never looks at adopted_by — so any holder of
-- the service key (three edge functions in this slice hold one) could write
-- `status='adopted', adopted_by=<the AI-operator identity>`, and the framework
-- that decides which gates exist and what each demands would then be immutable
-- and machine-adopted with a warning nobody reads as its only trace. Proven
-- live before this fix: `update project_frameworks set status='adopted',
-- adopted_by='<ai_admin>'` as service_role → UPDATE 1.
--
-- The same shape was open on three further acts §70 names or implies:
--   * development_cases.sanctioned_by — "the LLM never determines … project
--     sanctioned" is the spec's own words. sanction_development_case refuses
--     the identity; nothing behind it did.
--   * gate_conditions.closed_by — closing the condition a gate decision was
--     made conditional on is the unfinished half of that decision.
--     enforce_gate_condition_provenance demands closure evidence, a closer and
--     a time, and never asks who.
--   * lifecycle_evaluations.decided_by — decide_lifecycle_evaluation was the
--     ONE rpc in this codebase listing 'ai_admin' on the PERMISSIVE side of a
--     decision: accepting a HIGH-UNCERTAINTY recommendation
--     (20260811170000:259). Re-created below refusing it, with a wall behind it.
--
-- THE POSTURE, stated once and copied four times: unconditional, service path
-- included, no marker escape. enforce_gate_review_recorder_is_human
-- (20261123090000) is the model. A governance act attributed to the
-- AI-operator identity is corrupt data however it arrived, and a restore that
-- re-inserts one is re-asserting it. Each covers INSERT and UPDATE —
-- re-pointing an attribution is the same claim made with a different verb —
-- and each returns early when the attribution column is unchanged, so no
-- existing write path changes shape and no unrelated update pays for it.
--
-- TRIGGER NAMES ARE LOAD-BEARING. Same-timing row triggers fire
-- alphabetically. Every name below sorts AFTER the provenance trigger already
-- on its table (trg_framework_immutability, trg_development_sanction_
-- provenance, trg_gate_condition_provenance), so every transcript asserting
-- those refusals still gets the same sentence in the same order.
--
-- ALSO HERE, and not §70:
--
--   * THE TIER CAP ON set_gate_requirement. The methodology agent's migration
--     claims "a proposed requirement can never quietly arrive wearing
--     REGULATION" (20261123090100:158-162). That was true of
--     propose_framework_from_document and false of the product: set_gate_
--     requirement admits 'ai_admin' (20261110090100:161) and accepts any of
--     the eight tiers behind a 20-character guidance string. Proven live over
--     PostgREST as an ai_admin user against a HUMAN-authored draft framework:
--     a MANDATORY requirement at the REGULATION tier, minted from scratch —
--     which is also how promote_requirement_authority's admin/executive-only
--     tier RAISE is defeated, because nothing needs raising if it starts at
--     the top. Capped below.
--
--   * TRUNCATE. Six 3D tables carry `before insert or update or delete … for
--     each row` triggers, which TRUNCATE does not fire, and granted TRUNCATE
--     to authenticated/anon/service_role. 20261123090100's own header says a
--     proposal deleted after adoption "would erase the fact that a machine
--     drafted what now governs the tenant's gates, which is the single most
--     important thing the row records" — TRUNCATE did precisely that, in one
--     statement, for every row at once. audit_events is the shipped precedent
--     (20261121090000): privilege revoked AND a statement-level
--     before-truncate trigger, because a revoke alone is undone by any future
--     `grant all`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. §70 — FRAMEWORK ADOPTION, AT THE PERSISTENCE BOUNDARY.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_framework_adopter_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.adopted_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.adopted_by is not distinct from old.adopted_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.adopted_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A project framework cannot be adopted by the AI-operator identity (spec §70). Adopting one '
      'decides which gates exist, what every one of them demands, and which require independent '
      'assurance — determining every gate the product will ever evaluate. The methodology agent '
      'proposes (propose_framework_from_document); a human executive or administrator adopts.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_framework_adopter_is_human() from public, anon, authenticated;

-- Sorts after trg_framework_immutability, so the immutability refusal is
-- still the first thing a direct client write hears.
drop trigger if exists trg_framework_recorded_adopter on public.project_frameworks;
create trigger trg_framework_recorded_adopter
  before insert or update on public.project_frameworks
  for each row execute function public.enforce_framework_adopter_is_human();

-- ---------------------------------------------------------------------------
-- 2. §70 — PROJECT SANCTION, AT THE PERSISTENCE BOUNDARY.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_case_sanctioner_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.sanctioned_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.sanctioned_by is not distinct from old.sanctioned_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.sanctioned_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A development case cannot be sanctioned by the AI-operator identity (spec §70 names project '
      'sanction as a determination the LLM never makes). AI explains, detects and prepares; an '
      'authorized human commits the organization and is named.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_case_sanctioner_is_human() from public, anon, authenticated;

drop trigger if exists trg_development_sanctioner_is_human on public.development_cases;
create trigger trg_development_sanctioner_is_human
  before insert or update on public.development_cases
  for each row execute function public.enforce_case_sanctioner_is_human();

-- ---------------------------------------------------------------------------
-- 3. §70 — GATE CONDITION CLOSURE, AT THE PERSISTENCE BOUNDARY.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_condition_closer_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.closed_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.closed_by is not distinct from old.closed_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.closed_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A gate condition cannot be closed by the AI-operator identity (spec §70). The condition is the '
      'unfinished half of a gate decision; closing it asserts the gate''s terms were met, which is the '
      'determination a human makes and is named for.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_gate_condition_closer_is_human() from public, anon, authenticated;

-- Sorts after trg_gate_condition_provenance (prefix ordering).
drop trigger if exists trg_gate_condition_provenance_human_closer on public.gate_conditions;
create trigger trg_gate_condition_provenance_human_closer
  before insert or update on public.gate_conditions
  for each row execute function public.enforce_gate_condition_closer_is_human();

-- ---------------------------------------------------------------------------
-- 4. §70 — THE LIFECYCLE DECISION. The door AND the wall.
--
--    decide_lifecycle_evaluation re-created from its 20260811170000:225
--    definition with TWO marked changes and nothing else: the organization
--    guard it lacked, and 'ai_admin' refused by name. A lifecycle evaluation
--    decision retires, replaces or keeps running an asset; a role list that
--    graded the §70 refusal by uncertainty level would put the grade, not the
--    human, in charge of §70 — the same reading §62 gets in this slice ("never
--    accepts high-consequence risk" is read strictly: no exception is carved
--    for low ones).
-- ---------------------------------------------------------------------------
create or replace function public.decide_lifecycle_evaluation(
  p_id uuid,
  p_decision text,
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
  e lifecycle_evaluations%rowtype;
begin
  -- Marked change 1 (20261123090500): the organization guard. Without it a
  -- caller with no organization claim reached the not-found refusal by luck
  -- rather than by rule.
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  -- Marked change 2 (20261123090500), §70: named before everything else so the
  -- refusal says what it is rather than "you need a different role".
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'deciding a lifecycle evaluation is a §70 human determination — the AI-operator identity records the evaluation and states its uncertainty; a human decides what the organization does about the asset');
  end if;
  select * into e from lifecycle_evaluations where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evaluation not found');
  end if;
  if e.decision is not null then
    return jsonb_build_object('error', 'this evaluation was already ' || e.decision);
  end if;
  if p_decision not in ('accepted', 'rejected', 'deferred_decision') then
    return jsonb_build_object('error', 'decision must be accepted, rejected or deferred_decision');
  end if;
  if coalesce(length(trim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the reasoning for this decision');
  end if;

  -- Accepting a high-uncertainty recommendation is permitted, and is recorded
  -- as exactly that. The point is not to prevent the judgement but to make it
  -- visible when the outcome is reviewed. ('ai_admin' removed from this set by
  -- marked change 2; it is refused above, for every decision.)
  if e.uncertainty_level = 'high' and p_decision = 'accepted'
     and v_role not in ('reliability_engineer', 'executive', 'admin') then
    return jsonb_build_object('error',
      'this evaluation is high-uncertainty; accepting it requires engineering or executive authority');
  end if;

  update lifecycle_evaluations
  set decision = p_decision, decided_by = auth.uid(), decided_at = now(),
      decision_note = trim(p_note)
  where id = p_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'lifecycle_decision', coalesce(v_role, 'unknown'),
    jsonb_build_object('evaluation_id', p_id, 'decision', p_decision,
      'recommended', e.recommended, 'uncertainty', e.uncertainty_level));

  return jsonb_build_object('evaluation_id', p_id, 'decision', p_decision);
end
$$;

revoke all on function public.decide_lifecycle_evaluation(uuid, text, text) from public, anon;
grant execute on function public.decide_lifecycle_evaluation(uuid, text, text) to authenticated;

create or replace function public.enforce_lifecycle_decider_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.decided_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.decided_by is not distinct from old.decided_by then
    return new;
  end if;
  select role into v_role from user_profiles where id = new.decided_by;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'A lifecycle evaluation cannot be decided by the AI-operator identity (spec §70). The evaluation '
      'and its stated uncertainty are the machine''s work; what the organization does about the asset '
      'is a human determination with a name against it.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_lifecycle_decider_is_human() from public, anon, authenticated;

drop trigger if exists trg_lifecycle_decider_is_human on public.lifecycle_evaluations;
create trigger trg_lifecycle_decider_is_human
  before insert or update on public.lifecycle_evaluations
  for each row execute function public.enforce_lifecycle_decider_is_human();

-- ---------------------------------------------------------------------------
-- 5. THE TIER CAP.
--
--    set_gate_requirement re-created from its 20261110090100:131 definition
--    with ONE marked insertion and nothing else. The AI-operator identity
--    keeps its authoring seat — §56 says the methodology agent proposes
--    requirements, and it writes them through this function — but it states
--    them at AI_SUGGESTION, the lowest of the eight D3.14 tiers, and nowhere
--    else. Raising a tier is already a recorded human act
--    (promote_requirement_authority, admin/executive only); minting at the top
--    tier was the way around it.
-- ---------------------------------------------------------------------------
create or replace function public.set_gate_requirement(
  p_gate_id bigint,
  p_criterion text,
  p_is_mandatory boolean,
  p_source_authority text,
  p_category text default null,
  p_evidence_type text default null,
  p_minimum_confidence numeric default null,
  p_guidance text default null,
  p_sort_order int default 100,
  p_weight numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  g stage_gates%rowtype;
  f project_frameworks%rowtype;
  v_existing stage_gate_criteria%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring gate requirements requires a governance or engineering role');
  end if;
  -- MARKED INSERTION (20261123090500) — §70/D3.14. The provenance tier is the
  -- claim a requirement makes about where its authority comes from. An
  -- identity that could write 'REGULATION' would be asserting that a regulator
  -- demands this, which is a determination, not a suggestion.
  if coalesce(v_role, '') = 'ai_admin' and coalesce(p_source_authority, '') <> 'AI_SUGGESTION' then
    return jsonb_build_object('error',
      format('the AI-operator identity states gate requirements at the AI_SUGGESTION tier only, not %s — the provenance tier asserts where a requirement''s authority comes from, and asserting an instrument is a human act (promote_requirement_authority raises a tier, and requires an executive or administrator)',
             coalesce(nullif(btrim(p_source_authority), ''), '(none)')));
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  select * into f from project_frameworks where id = g.framework_id;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      'an adopted framework version is immutable — create a new version to change its requirements');
  end if;
  if coalesce(length(btrim(p_criterion)), 0) < 5 then
    return jsonb_build_object('error', 'a requirement states what must be established (5 characters minimum)');
  end if;
  if source_authority_rank(p_source_authority) = 0 then
    return jsonb_build_object('error', 'source_authority must be one of the eight provenance tiers');
  end if;
  if p_source_authority in ('LAW','REGULATION','CORPORATE_STANDARD','CONTRACT')
     and coalesce(length(btrim(p_guidance)), 0) < 20 then
    return jsonb_build_object('error',
      'a requirement at the ' || p_source_authority || ' tier names the instrument it comes from in guidance (20 characters minimum)');
  end if;
  if p_minimum_confidence is not null and (p_minimum_confidence < 0 or p_minimum_confidence > 1) then
    return jsonb_build_object('error', 'minimum_confidence is a fraction between 0 and 1');
  end if;
  if p_weight is null or p_weight <= 0 then
    return jsonb_build_object('error',
      'weight must be a positive number — a zero-weight requirement would vanish from the readiness percentage while still rendering as a requirement');
  end if;

  select * into v_existing from stage_gate_criteria
  where organization_id = v_org and gate_id = g.id and criterion = btrim(p_criterion);

  if found and source_authority_rank(p_source_authority) > source_authority_rank(v_existing.source_authority) then
    return jsonb_build_object('error',
      format('raising this requirement''s provenance (%s to %s) is a recorded human act — use promote_requirement_authority',
             v_existing.source_authority, p_source_authority));
  end if;

  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, minimum_confidence, source_authority, weight)
  values
    (v_org, g.stage_key, g.id, btrim(p_criterion), coalesce(p_is_mandatory, true),
     p_guidance, coalesce(p_sort_order, 100), nullif(btrim(coalesce(p_category,'')), ''),
     nullif(btrim(coalesce(p_evidence_type,'')), ''), p_minimum_confidence, p_source_authority,
     coalesce(p_weight, 1.0))
  on conflict (gate_id, criterion) where gate_id is not null do update set
    is_mandatory = excluded.is_mandatory,
    guidance = excluded.guidance,
    sort_order = excluded.sort_order,
    category = excluded.category,
    evidence_type = excluded.evidence_type,
    minimum_confidence = excluded.minimum_confidence,
    source_authority = excluded.source_authority,
    weight = excluded.weight
  returning id into v_id;

  return jsonb_build_object('criterion_id', v_id, 'gate_id', g.id,
    'source_authority', p_source_authority, 'weight', coalesce(p_weight, 1.0));
end
$$;

revoke all on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int, numeric) from public, anon;
grant execute on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int, numeric) to authenticated, service_role;

comment on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int, numeric) is
  'D3.14/D3.35: the one requirement-authoring act. The eight-tier provenance is validated here and the AI-operator identity is capped at AI_SUGGESTION (20261123090500) — minting at a high tier was the way around promote_requirement_authority''s human-only tier raise.';

-- ---------------------------------------------------------------------------
-- 6. TRUNCATE, on the six tables Slice 3D added.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_governance_record_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Table % holds governance records this database refuses to delete row by row: a gate review that '
    'was opened, a governance model a machine drafted, a dated readiness reading, a recommendation, a '
    'claim, or the evidence behind one. TRUNCATE would erase every one of them in a single statement '
    'without firing the row triggers that refuse it. It is not permitted on this table.', tg_table_name
    using errcode = 'insufficient_privilege';
end
$$;

do $truncate$
declare
  t text;
begin
  foreach t in array array[
    'gate_review_sessions', 'framework_proposals', 'gate_agent_reports',
    'risk_treatment_advice', 'assurance_case_claims', 'assurance_claim_evidence'
  ] loop
    execute format('revoke truncate on table public.%I from authenticated, anon, service_role', t);
    execute format('drop trigger if exists trg_%s_no_truncate on public.%I', t, t);
    execute format(
      'create trigger trg_%s_no_truncate before truncate on public.%I '
      'for each statement execute function public.refuse_governance_record_truncate()', t, t);
  end loop;
end
$truncate$;

notify pgrst, 'reload schema';
