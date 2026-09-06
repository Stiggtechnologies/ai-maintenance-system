-- ============================================================================
-- Sync Develop Slice 1 — the gate family generalized to development cases
-- (D3.24 / D3.06 / D3.37 / D11.24), under overlap-map ruling 1:
-- stage_gate_criteria / stage_gate_reviews / stage_gate_findings + assessGate
-- ARE the canonical gate implementation. This file extends that family's
-- SUBJECT (asset → development case), its OUTCOME VOCABULARY, and its
-- CONDITIONS; it creates no parallel evaluator and no second review store.
--
-- THE OUTCOME ENUM RECONCILIATION (D3.06 — documented here as the build-time
-- record the register row demands). The specification states the outcome set
-- twice and the two lists differ verbatim:
--
--   PART I.5:  PROCEED, PROCEED WITH CONDITIONS, PIVOT, REDESIGN, PAUSE,
--              RECYCLE, TERMINATE                    (7 — has REDESIGN, PAUSE;
--                                                     omits HOLD)
--   PART III §6: PROCEED, PROCEED_WITH_CONDITIONS, HOLD, RECYCLE, PIVOT,
--              TERMINATE                             (6 — has HOLD; omits
--                                                     REDESIGN, PAUSE)
--
-- Resolution: the UNION, eight values — proceed, proceed_with_conditions,
-- hold, recycle, pivot, redesign, pause, terminate — because each list's
-- extras answer a real, distinct question (HOLD: not decidable yet;
-- PAUSE: decidable, deliberately suspended; REDESIGN: concept survives,
-- design does not; RECYCLE: repeat the stage; PIVOT: problem survives,
-- concept does not) and dropping either side would leave a decision a gate
-- can genuinely take with no honest value to record it under.
--
-- The legacy asset-scoped vocabulary (pass / pass_with_conditions / hold)
-- REMAINS VALID for asset reviews: advance_lifecycle_stage still reads it,
-- and rewriting history into the new vocabulary would falsify records.
-- Case-scoped reviews use the eight-value vocabulary only — the record RPC
-- refuses 'pass' with a pointer to 'proceed'.
--
-- §70, DAY ONE: a gate outcome is recordable ONLY through the definer RPC
-- below. The provenance trigger refuses any client write to this table —
-- outcome rows cannot be inserted, edited, re-attributed, or deleted by
-- PostgREST — following the post-fix engineering-signature pattern
-- (20261005090300): SECURITY INVOKER, transaction-local marker, service path
-- admitted and AUDITED FOR EVERY OPERATION (insert, update, delete — an
-- unaudited service INSERT of one 'proceed' would mark a gate passed with no
-- trace, which is the "silently" the §70 posture exists to kill), never
-- silently overwritten.
--
-- LATEST-REVIEW SEMANTICS (the enforcement rule the blockers below share
-- with sanction_development_case, 20261101090500): a gate is satisfied by
-- its MOST RECENT review only. A historical proceed does not survive a later
-- terminate/hold/recycle/pivot/redesign/pause — spec I.5's question ("if
-- this project were proposed today using what we now know, would we still
-- fund it?") is asked at every review, so the latest determination is the
-- operative one, and it is also exactly what the workspace renders
-- (get_development_case returns latestReview). Enforced truth and displayed
-- truth are the same row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Subject generalization + outcome union on stage_gate_reviews.
-- ---------------------------------------------------------------------------
alter table public.stage_gate_reviews
  alter column asset_id drop not null;

alter table public.stage_gate_reviews
  add column if not exists development_case_id uuid references development_cases(id) on delete cascade,
  add column if not exists gate_id bigint references stage_gates(id) on delete set null;

create index if not exists idx_sgr_case
  on stage_gate_reviews(organization_id, development_case_id, gate_id, reviewed_at desc)
  where development_case_id is not null;

-- Replace the two inline outcome checks with named constraints carrying the
-- union vocabulary. The originals carry PostgreSQL's deterministic auto-names
-- from 20260816090000's CREATE TABLE (column check → <table>_<column>_check,
-- table check → <table>_check); every drop is IF EXISTS so a replay — or a
-- chain where they were already replaced — is a no-op. Plain SQL rather than
-- a catalog-driven loop, because tenancyIsolation's parser (by design)
-- refuses dynamic DDL it cannot resolve statically.
alter table public.stage_gate_reviews
  drop constraint if exists stage_gate_reviews_outcome_check,
  drop constraint if exists stage_gate_reviews_check,
  drop constraint if exists stage_gate_reviews_check1,
  drop constraint if exists sgr_outcome_allowed,
  drop constraint if exists sgr_conditions_required_on_conditional,
  drop constraint if exists sgr_subject_present;

alter table public.stage_gate_reviews
  add constraint sgr_outcome_allowed check (outcome in
    ('pass','pass_with_conditions','hold',
     'proceed','proceed_with_conditions','recycle','pivot','redesign','pause','terminate'));

-- Conditions are the whole point of a conditional pass — both vocabularies.
alter table public.stage_gate_reviews
  add constraint sgr_conditions_required_on_conditional check
    (outcome not in ('pass_with_conditions','proceed_with_conditions')
     or (conditions is not null and btrim(conditions) <> ''));

-- A review needs a subject: an asset (legacy scope) or a case.
alter table public.stage_gate_reviews
  add constraint sgr_subject_present check
    (asset_id is not null or development_case_id is not null);

-- ---------------------------------------------------------------------------
-- 2. Criteria gain gate scope (the SAME table — no parallel requirement
--    store). The old org+stage+criterion uniqueness held when criteria only
--    attached to stages; per-gate criteria in different frameworks may
--    legitimately share text on the same stage_key, so the invariant splits:
--    unchanged for stage-scoped rows, per-gate for gate-scoped rows.
-- ---------------------------------------------------------------------------
alter table public.stage_gate_criteria
  add column if not exists gate_id bigint references stage_gates(id) on delete cascade;

drop index if exists idx_sgc_unique;
create unique index if not exists idx_sgc_unique_stage
  on stage_gate_criteria(organization_id, stage_key, criterion)
  where gate_id is null;
create unique index if not exists idx_sgc_unique_gate
  on stage_gate_criteria(gate_id, criterion)
  where gate_id is not null;
create index if not exists idx_sgc_gate on stage_gate_criteria(gate_id) where gate_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Gate conditions as first-class rows (D3.06 / spec II.16): owner, due
--    date, evidence requirement, consequence-if-missed — every field the
--    "GO WITH CONDITIONS" contract names, none of them optional. Waiver
--    machinery is a later slice; the SHAPE ships now so no condition is ever
--    recorded without an owner and a consequence.
-- ---------------------------------------------------------------------------
create table if not exists public.gate_conditions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  review_id bigint not null references stage_gate_reviews(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  owner_id uuid not null references auth.users(id),
  due_date date not null,
  evidence_requirement text not null check (btrim(evidence_requirement) <> ''),
  consequence_if_missed text not null check (btrim(consequence_if_missed) <> ''),
  status text not null default 'open' check (status in ('open','satisfied','missed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_gate_conditions_review on gate_conditions(review_id);
create index if not exists idx_gate_conditions_open
  on gate_conditions(organization_id, due_date) where status = 'open';

alter table public.gate_conditions enable row level security;
drop policy if exists gate_conditions_read on public.gate_conditions;
create policy gate_conditions_read on public.gate_conditions
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 4. The §70 provenance trigger. Every row in stage_gate_reviews IS a gate
--    outcome, so every client write goes through the sanctioned path.
--    SECURITY INVOKER on purpose (see 20261005090100's argument).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_review_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.gate_review_write', true), '');
  v_client boolean := auth.uid() is not null;
  r_row stage_gate_reviews%rowtype;
begin
  r_row := case when tg_op = 'DELETE' then old else new end;

  -- Audited service path: admitted for EVERY operation, and audited for
  -- every operation. An INSERT creates a gate outcome, an UPDATE moves one,
  -- a DELETE erases one — each is a §70-relevant act when it bypasses the
  -- record RPC, so each leaves a security_events row. (A restore that runs
  -- with triggers disabled — session_replication_role = replica — is
  -- unaffected.) The org-exists guard keeps a cascaded delete during
  -- organization teardown from inserting an audit row that references the
  -- organization being removed.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = r_row.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (r_row.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         case tg_op
           when 'INSERT' then
             'Gate review ' || r_row.id::text || ' inserted by a service caller, bypassing '
               || 'record_case_gate_review(). Outcome recorded as '
               || coalesce(r_row.outcome, 'none') || '.'
           when 'DELETE' then
             'Gate review ' || r_row.id::text || ' deleted by a service caller, bypassing '
               || 'record_case_gate_review(). Outcome was '
               || coalesce(r_row.outcome, 'none') || '.'
           else
             'Gate review ' || r_row.id::text || ' modified by a service caller, bypassing '
               || 'record_case_gate_review(). Outcome was ' || coalesce(old.outcome, 'none')
               || ', now ' || coalesce(new.outcome, 'none') || '.'
         end);
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'A gate outcome is a deterministic human determination (spec §70). It cannot '
      'be written directly: call record_case_gate_review(...), which verifies the '
      'recorder''s role, blocks on unmet mandatory criteria, and records findings '
      'and conditions with the decision. A gate outcome asserted by an unchecked '
      'write is not a gate decision.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_gate_review_provenance on public.stage_gate_reviews;
create trigger trg_gate_review_provenance
  before insert or update or delete on public.stage_gate_reviews
  for each row execute function public.enforce_gate_review_provenance();

-- Findings and conditions are children of a review; they carry the outcome's
-- evidence, so they get the same boundary (one marker family, set only by
-- the record RPC while it is inserting the whole review atomically).
create or replace function public.enforce_gate_review_child_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.gate_review_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_id text := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
begin
  -- Service path: admitted AND audited, one row per child row touched. A
  -- BEFORE DELETE trigger must return OLD for the delete to proceed —
  -- returning NEW (null on delete) silently cancels the row, which both
  -- no-ops a deliberate service delete and breaks every cascade that
  -- passes through these tables. The org-exists guard keeps organization
  -- teardown from referencing the organization being removed.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Gate review child row ' || v_id || ' on ' || tg_table_name
           || ' written by a service caller (' || lower(tg_op)
           || '), bypassing record_case_gate_review().');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Gate findings and conditions are recorded with the review that carries them, '
      'through record_case_gate_review(...). They cannot be edited independently — '
      'evidence that can be rewritten after the decision is not evidence.'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_gate_finding_provenance on public.stage_gate_findings;
create trigger trg_gate_finding_provenance
  before insert or update or delete on public.stage_gate_findings
  for each row execute function public.enforce_gate_review_child_provenance();

drop trigger if exists trg_gate_condition_provenance on public.gate_conditions;
create trigger trg_gate_condition_provenance
  before insert or update or delete on public.gate_conditions
  for each row execute function public.enforce_gate_review_child_provenance();

-- ---------------------------------------------------------------------------
-- 5. The sanctioned path: record a case gate decision.
--
-- The DB repeats assessGate's discipline rather than trusting the caller:
-- a PROCEED (plain or conditional) is refused unless EVERY mandatory
-- criterion of the gate carries an explicit 'met' finding in THIS review —
-- silence blocks, not-assessed blocks, and a gate with no criteria at all
-- blocks because it would otherwise be control-shaped without being control.
--
-- Role boundary: admin, executive, maintenance_manager, reliability_engineer.
-- 'ai_admin' is deliberately EXCLUDED — recording a gate decision is a §70
-- human determination, and the AI-operator identity does not hold it. (A
-- human administrator does; this is not a lockout, it is the boundary.)
--
-- Independent-assurance gates (independent_assurance_required = true) carry
-- the slice-1 segregation minimum: the recorder may be neither the case
-- sponsor nor the case creator. Full assurance-review binding (competency,
-- declared conflicts, risk_assurance_reviews linkage) is D3.16, Slice 3.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_gate_review(
  p_case_id uuid,
  p_gate_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_conditions jsonb default '[]'::jsonb
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
  v_review_id bigint;
  v_mandatory_total int;
  v_criteria_total int;
  v_unmet text[];
  f jsonb;
  cond jsonb;
  v_cond_count int := 0;
  v_finding_count int := 0;
  v_owner uuid;
  v_conditions_text text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'a gate decision is a §70 human determination — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'recording a gate decision requires a governance or engineering role');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'gates are not recordable on a ' || c.status || ' case');
  end if;

  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  if c.framework_id is null or g.framework_id <> c.framework_id then
    return jsonb_build_object('error', 'that gate does not belong to this case''s framework');
  end if;

  if p_outcome in ('pass','pass_with_conditions') then
    return jsonb_build_object('error',
      'case gate reviews use the reconciled vocabulary — record ''proceed'' or ''proceed_with_conditions''');
  end if;
  if p_outcome not in ('proceed','proceed_with_conditions','hold','recycle','pivot','redesign','pause','terminate') then
    return jsonb_build_object('error',
      'outcome must be one of proceed, proceed_with_conditions, hold, recycle, pivot, redesign, pause, terminate');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for this gate decision (20 characters minimum)');
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' then
    return jsonb_build_object('error', 'findings must be a json array');
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    return jsonb_build_object('error', 'conditions must be a json array');
  end if;

  -- Slice-1 segregation minimum on independent-assurance gates.
  if g.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      'this gate requires independent assurance: the case sponsor or creator cannot record its decision (segregation of duties)');
  end if;

  -- Validate findings before anything is written.
  for f in select * from jsonb_array_elements(p_findings) loop
    if coalesce(btrim(f->>'criterion_text'), '') = '' then
      return jsonb_build_object('error', 'every finding names its criterion (criterion_text)');
    end if;
    if coalesce(f->>'status', '') not in ('met','not_met','not_assessed') then
      return jsonb_build_object('error', 'finding status must be met, not_met or not_assessed');
    end if;
    if f ? 'criterion_id' and nullif(f->>'criterion_id','') is not null and not exists (
      select 1 from stage_gate_criteria sc
      where sc.id = (f->>'criterion_id')::bigint
        and sc.organization_id = v_org and sc.gate_id = p_gate_id
    ) then
      return jsonb_build_object('error', 'finding references a criterion that does not belong to this gate');
    end if;
    v_finding_count := v_finding_count + 1;
  end loop;

  -- THE MANDATORY BLOCK (assessGate's discipline, repeated at the DB).
  select count(*), count(*) filter (where is_mandatory)
    into v_criteria_total, v_mandatory_total
  from stage_gate_criteria
  where organization_id = v_org and gate_id = p_gate_id;

  if p_outcome in ('proceed','proceed_with_conditions') then
    if v_criteria_total = 0 then
      return jsonb_build_object('error',
        'this gate defines no criteria, so it can block nothing — define what it requires before recording a proceed through it');
    end if;
    select coalesce(array_agg(sc.criterion), '{}') into v_unmet
    from stage_gate_criteria sc
    where sc.organization_id = v_org and sc.gate_id = p_gate_id and sc.is_mandatory
      and not exists (
        select 1 from jsonb_array_elements(p_findings) pf
        where btrim(pf->>'criterion_text') = btrim(sc.criterion)
          and pf->>'status' = 'met'
      );
    if array_length(v_unmet, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot record %s: %s mandatory criterion/criteria are not explicitly met in this review — silence and not-assessed block for the same reason a failure does', p_outcome, array_length(v_unmet, 1)),
        'unmet_mandatory', to_jsonb(v_unmet));
    end if;
  end if;

  -- Conditions: exactly with a conditional proceed, never otherwise.
  if p_outcome = 'proceed_with_conditions' then
    if jsonb_array_length(p_conditions) = 0 then
      return jsonb_build_object('error',
        'proceed_with_conditions requires at least one condition, each with owner, due date, evidence requirement and consequence-if-missed (spec II.16)');
    end if;
    for cond in select * from jsonb_array_elements(p_conditions) loop
      if coalesce(length(btrim(cond->>'description')), 0) < 10 then
        return jsonb_build_object('error', 'each condition states what must be done (10 characters minimum)');
      end if;
      v_owner := nullif(cond->>'owner_id','')::uuid;
      if v_owner is null or not exists (
        select 1 from user_profiles up where up.id = v_owner and up.organization_id = v_org
      ) then
        return jsonb_build_object('error', 'each condition names an owner who is a member of this organization');
      end if;
      if nullif(cond->>'due_date','') is null then
        return jsonb_build_object('error', 'each condition carries a due date');
      end if;
      if (cond->>'due_date')::date < current_date then
        return jsonb_build_object('error', 'a condition cannot be born overdue — its due date is today or later');
      end if;
      if coalesce(length(btrim(cond->>'evidence_requirement')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the evidence that will close it');
      end if;
      if coalesce(length(btrim(cond->>'consequence_if_missed')), 0) < 5 then
        return jsonb_build_object('error', 'each condition states the consequence if it is missed');
      end if;
      v_cond_count := v_cond_count + 1;
    end loop;
  elsif jsonb_array_length(p_conditions) > 0 then
    return jsonb_build_object('error', 'conditions attach to a proceed_with_conditions outcome only');
  end if;

  if p_outcome = 'proceed_with_conditions' then
    select string_agg(btrim(x->>'description'), '; ') into v_conditions_text
    from jsonb_array_elements(p_conditions) x;
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.gate_review_write', 'granted', true);

  insert into stage_gate_reviews
    (organization_id, development_case_id, gate_id, stage_key, outcome,
     conditions, reviewed_by, reviewed_at, note)
  values
    (v_org, c.id, g.id, g.stage_key, p_outcome,
     v_conditions_text, auth.uid(), now(), btrim(p_note))
  returning id into v_review_id;

  insert into stage_gate_findings
    (organization_id, review_id, criterion_id, criterion_text, status, evidence)
  select v_org, v_review_id,
         nullif(x->>'criterion_id','')::bigint,
         btrim(x->>'criterion_text'),
         x->>'status',
         nullif(btrim(coalesce(x->>'evidence','')), '')
  from jsonb_array_elements(p_findings) x;

  insert into gate_conditions
    (organization_id, review_id, description, owner_id, due_date,
     evidence_requirement, consequence_if_missed)
  select v_org, v_review_id,
         btrim(x->>'description'),
         (x->>'owner_id')::uuid,
         (x->>'due_date')::date,
         btrim(x->>'evidence_requirement'),
         btrim(x->>'consequence_if_missed')
  from jsonb_array_elements(p_conditions) x;

  perform set_config('app.gate_review_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_gate_review', coalesce(v_role, 'unknown'),
    jsonb_build_object('review_id', v_review_id, 'case_id', c.id, 'gate_id', g.id,
      'gate', g.name, 'decision_type', g.decision_type, 'outcome', p_outcome,
      'findings', v_finding_count, 'conditions', v_cond_count));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Gate decision "%s" recorded on %s (%s) for case %s as role %s.',
            p_outcome, g.name, g.decision_type, c.title, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'review_id', v_review_id, 'outcome', p_outcome,
    'gate', g.name, 'decision_type', g.decision_type,
    'findings_recorded', v_finding_count, 'conditions_recorded', v_cond_count);
end
$$;

revoke all on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Moving a case between framework stages. Mirrors advance_lifecycle_stage:
--    the gate has teeth at the DB, not in the UI. Forward movement is to the
--    NEXT framework stage only (skipping a stage would skip its gates);
--    every 'gate'-or-'checkpoint' row of the CURRENT stage that carries
--    mandatory criteria must hold a passing LATEST review (proceed /
--    proceed_with_conditions) for THIS case — latest, not any: a historical
--    proceed does not survive a later terminate/hold/recycle/pivot/redesign/
--    pause on the same gate (see the header's latest-review-semantics note).
--    Checkpoints without mandatory criteria are advisory by design (D3.37)
--    and do not block. Backward movement (recycle) is free with a reason.
-- ---------------------------------------------------------------------------
create or replace function public.advance_development_case_stage(
  p_case_id uuid,
  p_to_stage_key text,
  p_reason text default null
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
  v_from_seq int;
  v_to_seq int;
  v_blockers text[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'moving a case between stages requires a governance or engineering role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'a ' || c.status || ' case does not move between stages');
  end if;
  if c.framework_id is null then
    return jsonb_build_object('error', 'this case has no framework — assign one before moving it through stages');
  end if;

  select sequence into v_from_seq from project_framework_stages
  where framework_id = c.framework_id and stage_key = c.current_stage_key;
  select sequence into v_to_seq from project_framework_stages
  where framework_id = c.framework_id and stage_key = p_to_stage_key;
  if v_to_seq is null then
    return jsonb_build_object('error',
      '"' || coalesce(p_to_stage_key,'') || '" is not a stage of this case''s framework');
  end if;
  if v_from_seq is null then
    -- The case sits outside its framework's members (a state no Slice-1
    -- path can produce: creation seats the case on a member stage and no
    -- framework-reassignment RPC exists yet). FAIL CLOSED rather than
    -- permit a jump that would bypass every gate — when framework
    -- reassignment arrives (later slice), it re-seats the case as part of
    -- the governed act, and this branch stays a refusal.
    return jsonb_build_object('error',
      format('this case''s current stage "%s" is not a member of its framework — its position must be re-established by a governed framework assignment, not by a stage move that would bypass every gate',
             coalesce(c.current_stage_key, 'none')));
  elsif v_to_seq = v_from_seq then
    return jsonb_build_object('error', 'the case is already in that stage');
  elsif v_to_seq > v_from_seq then
    if v_to_seq <> v_from_seq + 1 then
      return jsonb_build_object('error',
        'forward movement is one stage at a time — skipping a stage would skip its gates');
    end if;
    -- Every blocking gate of the CURRENT stage must hold a passing LATEST
    -- review. Latest, not any-ever: a gate whose most recent decision is
    -- terminate/hold/recycle/pivot/redesign/pause blocks regardless of an
    -- earlier proceed, and the row consulted here is the same row the
    -- workspace renders as latestReview (reviewed_at desc, id desc).
    select coalesce(array_agg(g.name), '{}') into v_blockers
    from stage_gates g
    where g.framework_id = c.framework_id
      and g.stage_key = c.current_stage_key
      and exists (select 1 from stage_gate_criteria sc
                  where sc.gate_id = g.id and sc.is_mandatory)
      and coalesce((
        select r.outcome from stage_gate_reviews r
        where r.organization_id = v_org
          and r.development_case_id = c.id
          and r.gate_id = g.id
        order by r.reviewed_at desc, r.id desc
        limit 1
      ), 'none') not in ('proceed','proceed_with_conditions');
    if array_length(v_blockers, 1) > 0 then
      return jsonb_build_object('error',
        format('cannot leave %s: %s gate(s) with mandatory criteria hold no passing latest review for this case — the gate is where someone takes responsibility for the decision, and its most recent decision is the operative one',
               c.current_stage_key, array_length(v_blockers, 1)),
        'blocking_gates', to_jsonb(v_blockers));
    end if;
  else
    if coalesce(length(btrim(p_reason)), 0) < 10 then
      return jsonb_build_object('error',
        'moving a case backward (recycle) records why (10 characters minimum)');
    end if;
  end if;

  update development_cases
  set current_stage_key = p_to_stage_key, updated_at = now()
  where id = c.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'action', 'stage_moved',
      'from', c.current_stage_key, 'to', p_to_stage_key,
      'reason', nullif(btrim(coalesce(p_reason,'')), '')));

  return jsonb_build_object('case_id', c.id, 'current_stage_key', p_to_stage_key);
end
$$;

revoke all on function public.advance_development_case_stage(uuid, text, text) from public, anon;
grant execute on function public.advance_development_case_stage(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
