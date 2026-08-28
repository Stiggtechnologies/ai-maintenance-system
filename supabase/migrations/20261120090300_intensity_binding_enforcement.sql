-- ============================================================================
-- Sync Develop Slice 3 — intensity-to-governance-requirements binding,
-- ENFORCED (D3.05, spec I.2). Not advisory UI text: a BEFORE-trigger on
-- stage_gate_reviews raising check_violation, in the enforce_authority_limit
-- style (20260808210000), plus the same demands as named jsonb refusals in
-- record_case_gate_review (re-created below) so callers get the refusal
-- with the missing things listed — RPC guard as the door, trigger as the
-- wall behind it (the promote_structural_contribution idiom).
--
-- WHAT IS ENFORCED (the strongest invariants the Slice-1 schema supports,
-- read from the ADOPTED binding row for the case's CURRENT determination):
--
--   * evidence_linked_deliverables_required — a gate outcome of proceed /
--     proceed_with_conditions is REFUSED while any MANDATORY criterion of
--     that gate carries no ACCEPTED deliverable for this case
--     (develop_deliverables.requirement_id -> stage_gate_criteria.id,
--     status='accepted'). Acceptance is itself the governed human act of
--     20261105090100 (owner cannot accept their own), so the chain is
--     determination -> adopted binding -> accepted evidence, every link
--     recorded. "Linked deliverable" is the criterion-scoped link the
--     schema has; case-scoped evidence_items support readiness display but
--     carry no criterion linkage, so they cannot substitute here.
--   * independent_assurance_required — at that intensity EVERY gate of the
--     case takes the sponsor/creator segregation rule, not only gates
--     individually flagged independent_assurance_required.
--
-- ABSENCE SEMANTICS (the enforce_authority_limit posture, deliberately): a
-- case with no CURRENT determination, or an organization with no ADOPTED
-- binding at OR BELOW the determined level, is not enforced against —
-- nothing is invented and nothing is blocked. Determination
-- (apply_case_governance) and adoption (adopt_intensity_binding) are the
-- recorded acts that arm this; drafts arm nothing. Resolution is MONOTONE
-- (resolve_case_intensity_binding, 20261120090200): absence at the exact
-- level falls back to the strongest adopted binding below it, so raising a
-- case's intensity can never DISARM enforcement.
--
-- ENFORCED AT THE ACTS, NOT ONLY AT THE REVIEW ROW: this trigger and
-- record_case_gate_review guard the instant a passing review is WRITTEN —
-- but a passing review recorded before the determination existed, or
-- before the binding was adopted, is a legitimate historical row this
-- trigger never saw. So advance_development_case_stage and
-- sanction_development_case (both re-created below with marked insertions)
-- re-validate the SAME predicate — case_binding_gate_demands
-- (20261120090200) — over the current stage's blocking gates at the act
-- itself. One predicate, four consumers (trigger, gate RPC, advance,
-- sanction): shared reuse, not the parallel-evaluator pattern ruling 1
-- forbids — the latest-review gate-pass test itself stays stated exactly
-- once per act, unduplicated. Sanction additionally refuses when the value
-- being sanctioned bands ABOVE the value level the current determination
-- was computed on (its own frozen thresholds): committing $300M under a
-- $2M determination is a stale regime, and staleness is a refusal, not a
-- silent under-governed pass.
--
-- UPDATE RE-LITIGATION covers every subject the predicate reads: outcome,
-- gate, CASE and REVIEWER. A service edit that transplants a passing
-- review onto another case, or swaps its reviewer, is a new pass for that
-- subject and is re-checked (and audited on the service path) — only
-- annotation edits pass through untouched.
--
-- CLIENT vs SERVICE at the trigger: client contexts (auth.uid() present)
-- are REFUSED as check_violation; a service write in violation is admitted
-- AND audited into security_events (20261005090300 §1's argument — refusing
-- the key buys nothing, an unaudited bypass is the thing to kill). The
-- trigger is SECURITY DEFINER so its reads see the whole truth regardless
-- of caller RLS; the client/service split keys on auth.uid(), which a
-- definer context preserves.
-- ============================================================================

create or replace function public.enforce_intensity_governance_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  c development_cases%rowtype;
  v_unlinked text[];
  v_violation text;
begin
  -- Only case-scoped PASSING outcomes are governed here; asset reviews and
  -- non-passing outcomes pass through untouched. On UPDATE, a change of any
  -- subject the predicate reads — outcome, gate, case or reviewer —
  -- re-litigates; an annotation edit on a historical row is not a new pass,
  -- but a review transplanted onto another case or re-attributed to another
  -- reviewer is.
  if new.development_case_id is null or new.gate_id is null
     or new.outcome not in ('proceed','proceed_with_conditions')
     or (tg_op = 'UPDATE'
         and new.outcome is not distinct from old.outcome
         and new.gate_id is not distinct from old.gate_id
         and new.development_case_id is not distinct from old.development_case_id
         and new.reviewed_by is not distinct from old.reviewed_by) then
    return new;
  end if;

  select * into v_gov from development_case_governance
  where development_case_id = new.development_case_id and status = 'current';
  if v_gov.id is null then
    return new;
  end if;
  v_bind := resolve_case_intensity_binding(v_gov.organization_id, v_gov.intensity_level);
  if v_bind.id is null then
    return new;
  end if;

  select * into c from development_cases where id = new.development_case_id;

  if v_bind.independent_assurance_required
     and new.reviewed_by is not null
     and (new.reviewed_by = c.sponsor_id or new.reviewed_by = c.created_by) then
    v_violation := format(
      'Intensity binding (%s): the adopted binding requires independent assurance, and this %s is recorded by the case sponsor or creator.',
      v_gov.intensity_level, new.outcome);
  end if;

  if v_violation is null and v_bind.evidence_linked_deliverables_required then
    -- The ONE predicate (case_binding_gate_demands), scoped to the gate
    -- being written. Only its evidence arm can bind here: the incoming
    -- row's reviewer was already checked above on NEW, and the stored-
    -- review independence arm concerns rows this write supersedes.
    v_unlinked := coalesce((
      select array_agg(x)
      from jsonb_array_elements_text(coalesce(
        case_binding_gate_demands(new.development_case_id, array[new.gate_id])
          ->'unlinked_mandatory', '[]'::jsonb)) x), '{}');
    if array_length(v_unlinked, 1) > 0 then
      v_violation := format(
        'Intensity binding (%s): %s mandatory criterion/criteria of this gate carry no ACCEPTED deliverable for this case (first: "%s").',
        v_gov.intensity_level, array_length(v_unlinked, 1), v_unlinked[1]);
    end if;
  end if;

  if v_violation is null then
    return new;
  end if;

  -- The audited service path (restore, backfill, correction).
  if not v_client then
    if exists (select 1 from organizations where id = v_gov.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_gov.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         format('Gate outcome "%s" written on case %s gate %s by a service caller in violation of the adopted intensity binding. %s',
                new.outcome, new.development_case_id, new.gate_id, v_violation));
    end if;
    return new;
  end if;

  raise exception
    'Governance intensity binding: this case is governed at % intensity and its adopted binding is not satisfied. % '
    'The binding is data (governance_intensity_bindings), the determination is recorded (apply_case_governance), '
    'and a gate outcome that does not meet them is refused at the persistence boundary, not advised against.',
    v_gov.intensity_level, v_violation
    using errcode = 'check_violation';
end
$$;

revoke all on function public.enforce_intensity_governance_binding() from public, anon, authenticated;

drop trigger if exists trg_intensity_governance_binding on public.stage_gate_reviews;
create trigger trg_intensity_governance_binding
  before insert or update on public.stage_gate_reviews
  for each row execute function public.enforce_intensity_governance_binding();

-- ---------------------------------------------------------------------------
-- record_case_gate_review, re-created from its 20261115090400 definition
-- with exactly two additions (both D3.05, marked in-line): the governance
-- determination/binding lookup with the intensity-wide segregation refusal,
-- and the accepted-deliverable demand after the mandatory block. Everything
-- else is byte-identical — assembled from the prior definition by exact
-- string insertion at authoring time.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_gate_review(
  p_case_id uuid,
  p_gate_id bigint,
  p_outcome text,
  p_note text,
  p_findings jsonb default '[]'::jsonb,
  p_conditions jsonb default '[]'::jsonb,
  p_evaluation_id uuid default null
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
  v_seen_criteria text[] := '{}';
  v_owner uuid;
  v_conditions_text text;
  v_design_order int;
  v_gate_order int;
  v_gov development_case_governance%rowtype;
  v_bind governance_intensity_bindings%rowtype;
  v_unlinked text[];
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

  -- D2.02: a review may LINK the value evaluation it was taken on. The link
  -- is validated here and never inferred — a trajectory point exists exactly
  -- where a review recorded one.
  if p_evaluation_id is not null and not exists (
    select 1 from lifecycle_evaluations e
    where e.id = p_evaluation_id and e.organization_id = v_org
      and e.development_case_id = c.id and e.evaluation_kind = 'case_value'
  ) then
    return jsonb_build_object('error',
      'that evaluation is not a value evaluation of this case — record one with record_case_value_evaluation and link it here');
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

  -- D3.05: the case's CURRENT governance determination and the ADOPTED
  -- binding for its intensity level. Absence enforces nothing (the
  -- enforce_authority_limit posture: nothing invented, nothing blocked);
  -- once both exist, the binding's demands hold at this RPC AND at the
  -- persistence boundary (trg_intensity_governance_binding — the wall
  -- behind this door).
  select * into v_gov from development_case_governance
  where development_case_id = c.id and status = 'current';
  if v_gov.id is not null then
    v_bind := resolve_case_intensity_binding(v_org, v_gov.intensity_level);
  end if;

  -- Intensity-wide segregation: at a level whose adopted binding requires
  -- independent assurance, EVERY gate of the case is recorded independently
  -- of its sponsor and creator — the per-gate flag above extends to the
  -- whole case.
  if v_bind.id is not null and v_bind.independent_assurance_required
     and p_outcome in ('proceed','proceed_with_conditions')
     and (auth.uid() = c.sponsor_id or auth.uid() = c.created_by) then
    return jsonb_build_object('error',
      format('this case is governed at %s intensity: the adopted intensity binding requires independent assurance, so the case sponsor or creator cannot record any of its gate decisions (segregation of duties)',
             v_gov.intensity_level));
  end if;

  -- D1.02 (spec I.3): success is established BEFORE design begins.
  -- Placed AFTER the segregation check deliberately: on an assurance gate a
  -- conflicted recorder is refused for the conflict first — who may record
  -- precedes what the record needs. A gate of
  -- a design-or-later stage cannot PASS while the case has no recorded
  -- success contract. Master stage order is the one stage vocabulary
  -- (ruling 2); 'design' anchors the boundary.
  if p_outcome in ('proceed','proceed_with_conditions') then
    select stage_order into v_design_order from lifecycle_stages where stage_key = 'design';
    select stage_order into v_gate_order from lifecycle_stages where stage_key = g.stage_key;
    if v_gate_order is not null and v_design_order is not null
       and v_gate_order >= v_design_order
       and not exists (
         select 1 from development_success_contracts sc
         where sc.development_case_id = c.id and sc.status = 'recorded'
       ) then
      return jsonb_build_object('error',
        'success is established before design begins (spec I.3): no recorded success contract exists on this case, so a design-or-later gate cannot pass — draft one (draft_success_contract), state its outcomes with owners and bases, and record it (record_success_contract)');
    end if;
  end if;

  -- Validate findings before anything is written.
  for f in select * from jsonb_array_elements(p_findings) loop
    if coalesce(btrim(f->>'criterion_text'), '') = '' then
      return jsonb_build_object('error', 'every finding names its criterion (criterion_text)');
    end if;
    if btrim(f->>'criterion_text') = any(v_seen_criteria) then
      return jsonb_build_object('error',
        format('duplicate finding for criterion "%s" — a review carries exactly one finding per criterion, because two findings on one criterion is a contradiction the gate would have to resolve silently', btrim(f->>'criterion_text')));
    end if;
    v_seen_criteria := v_seen_criteria || btrim(f->>'criterion_text');
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

    -- D3.05: at an intensity whose ADOPTED binding requires evidence-linked
    -- deliverables, a met finding alone is not enough — every mandatory
    -- criterion of this gate carries an ACCEPTED deliverable for THIS case,
    -- or the gate does not pass. Acceptance is itself a governed human act
    -- (accept_deliverable, owner-cannot-accept), so the demand chains
    -- determination -> binding -> accepted evidence, all recorded.
    if v_bind.id is not null and v_bind.evidence_linked_deliverables_required then
      v_unlinked := coalesce((
        select array_agg(x)
        from jsonb_array_elements_text(coalesce(
          case_binding_gate_demands(c.id, array[p_gate_id])
            ->'unlinked_mandatory', '[]'::jsonb)) x), '{}');
      if array_length(v_unlinked, 1) > 0 then
        return jsonb_build_object('error',
          format('cannot record %s at %s intensity: %s mandatory criterion/criteria carry no ACCEPTED deliverable for this case — the adopted intensity binding requires an accepted deliverable behind every mandatory gate requirement (create_case_deliverable, submit_deliverable, accept_deliverable, then re-record)',
                 p_outcome, v_gov.intensity_level, array_length(v_unlinked, 1)),
          'unlinked_mandatory', to_jsonb(v_unlinked));
      end if;
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
     conditions, reviewed_by, reviewed_at, note, evaluation_id)
  values
    (v_org, c.id, g.id, g.stage_key, p_outcome,
     v_conditions_text, auth.uid(), now(), btrim(p_note), p_evaluation_id)
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
      'findings', v_finding_count, 'conditions', v_cond_count,
      'evaluation_id', p_evaluation_id));

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


revoke all on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.record_case_gate_review(uuid, bigint, text, text, jsonb, jsonb, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- advance_development_case_stage, re-created from its 20261101090300
-- definition with exactly TWO additions (both D3.05, marked in-line): the
-- v_demands declaration and the act-time binding re-validation after the
-- latest-review blocker check. Everything else is byte-identical —
-- assembled from the prior definition by exact string insertion at
-- authoring time. Rationale in this file's header: a passing review that
-- predates the determination or the binding's adoption is invisible to the
-- review-time trigger, so the act itself re-validates the one shared
-- predicate.
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
  -- D3.05 (20261120090300, marked insertion): the binding re-validation's
  -- named demands.
  v_demands jsonb;
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
    -- D3.05 (20261120090300, marked insertion): the adopted intensity
    -- binding is re-validated AT THE ACT over the same gates — a passing
    -- review recorded before the determination existed, or before the
    -- binding was adopted, cannot carry the case out of the stage. One
    -- shared predicate (case_binding_gate_demands) serves the review
    -- trigger, this act and sanction: reuse, not a parallel evaluator —
    -- the latest-review gate-pass test above stays stated exactly once.
    v_demands := case_binding_gate_demands(c.id, null);
    if v_demands is not null then
      return jsonb_build_object('error',
        format('cannot leave %s: this case is governed at %s intensity and the adopted %s binding is not met by the current stage''s gates — %s mandatory criterion/criteria carry no ACCEPTED deliverable, %s gate(s) hold a passing latest review recorded by the case sponsor/creator where independent assurance is required. Accept the deliverables / re-record independently (create_case_deliverable, submit_deliverable, accept_deliverable, record_case_gate_review), or re-apply the determination if the classification is wrong.',
               c.current_stage_key, v_demands->>'intensity_level', v_demands->>'binding_level',
               jsonb_array_length(v_demands->'unlinked_mandatory'),
               jsonb_array_length(v_demands->'non_independent_gates')),
        'binding_demands', v_demands);
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

-- ---------------------------------------------------------------------------
-- sanction_development_case, re-created from its 20261101090500 definition
-- with exactly THREE additions (all D3.05, marked in-line): the
-- declarations, the finite-value refusal beside the negative-value guard,
-- and the binding re-validation + value-band staleness refusal after the
-- latest-review gate check. Everything else is byte-identical — assembled
-- from the prior definition by exact string insertion at authoring time.
-- ---------------------------------------------------------------------------
create or replace function public.sanction_development_case(
  p_case_id uuid,
  p_note text,
  p_sanctioned_value numeric default null
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
  l authority_limits%rowtype;
  v_value numeric;
  v_blockers text[];
  -- D3.05 (20261120090300, marked insertion): binding demands + the current
  -- determination for the value-band staleness refusal.
  v_demands jsonb;
  v_gov development_case_governance%rowtype;
  v_band int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'project sanction is a §70 human determination — the AI-operator identity cannot sanction a case');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status = 'sanctioned' then
    return jsonb_build_object('error',
      format('already sanctioned on %s. A sanction is not overwritable — the record of the act stands.',
             to_char(c.sanctioned_at, 'YYYY-MM-DD')));
  end if;
  if c.status not in ('active','on_hold') then
    return jsonb_build_object('error', 'a ' || c.status || ' case cannot be sanctioned');
  end if;
  -- No framework, no gates; no gates, no sanction. A sanction that skipped
  -- every gate because none were configured is not gate discipline — assign
  -- an adopted framework (at intake this slice) so its gates can hold the
  -- decision to account.
  if c.framework_id is null then
    return jsonb_build_object('error',
      'this case has no governing framework, so no gate has ever held it to account — a sanction cannot rest on zero gates. Assign an adopted framework first.');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for the sanction decision (20 characters minimum)');
  end if;

  v_value := coalesce(p_sanctioned_value, c.estimated_capex);
  if v_value is null then
    return jsonb_build_object('error',
      'sanction states the value being committed — without one the delegation-of-authority ceiling cannot be verified');
  end if;
  if v_value < 0 then
    return jsonb_build_object('error', 'a sanctioned value cannot be negative');
  end if;
  -- D3.05 (20261120090300, marked insertion): numeric NaN/Infinity compare
  -- ABOVE every ceiling and band in Postgres — a non-finite commitment is
  -- refused, not banded.
  if v_value = 'NaN'::numeric or v_value = 'Infinity'::numeric or v_value = '-Infinity'::numeric then
    return jsonb_build_object('error', 'a sanctioned value must be a finite amount');
  end if;

  -- FAIL-CLOSED authority. "No delegation recorded" refuses the act — the
  -- opposite default from the recommendation ceiling, deliberately: spending
  -- limits ratchet DOWN onto an org that adopts them; the RIGHT to sanction
  -- exists only where the org has delegated it.
  select * into l from authority_limits
  where organization_id = v_org and role_key = coalesce(v_role, '')
    and action_type = 'sanction' and status = 'adopted'
  order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',
      format('no ADOPTED sanction authority exists for the %s role in this organization. Sanction is exercised under the delegation-of-authority ladder: adopt the sanction limit (adopt_authority_limit) from your delegation instrument first.',
             coalesce(v_role, 'none')));
  end if;
  if l.max_commitment_usd is not null and v_value > l.max_commitment_usd then
    return jsonb_build_object('error',
      format('$%s exceeds the %s sanction ceiling of $%s for %s. Escalate to %s.',
             v_value, l.tier_label, l.max_commitment_usd, coalesce(v_role, 'none'),
             coalesce(l.escalates_to_role, 'the board')));
  end if;

  -- The sanction decision does not skip the gates: every gate of the case's
  -- CURRENT stage that carries mandatory criteria must hold a passing LATEST
  -- review — latest, not any-ever (20261101090300's latest-review-semantics
  -- note): a gate whose most recent decision is terminate/hold/recycle/
  -- pivot/redesign/pause blocks the sanction regardless of an earlier
  -- proceed, and the row consulted here is the same row the workspace
  -- renders as latestReview (reviewed_at desc, id desc).
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
      format('cannot sanction: %s gate(s) of the current stage with mandatory criteria hold no passing latest review for this case',
             array_length(v_blockers, 1)),
      'blocking_gates', to_jsonb(v_blockers));
  end if;

  -- D3.05 (20261120090300, marked insertion): the adopted intensity binding
  -- is re-validated at the highest-stakes act itself — a passing review
  -- recorded before the determination existed, or before the binding was
  -- adopted, cannot carry a sanction. Same shared predicate as the review
  -- trigger and advance (case_binding_gate_demands): reuse, not a parallel
  -- evaluator — the latest-review gate-pass test above stays stated once.
  v_demands := case_binding_gate_demands(c.id, null);
  if v_demands is not null then
    return jsonb_build_object('error',
      format('cannot sanction: this case is governed at %s intensity and the adopted %s binding is not met by the current stage''s gates — %s mandatory criterion/criteria carry no ACCEPTED deliverable, %s gate(s) hold a passing latest review recorded by the case sponsor/creator where independent assurance is required',
             v_demands->>'intensity_level', v_demands->>'binding_level',
             jsonb_array_length(v_demands->'unlinked_mandatory'),
             jsonb_array_length(v_demands->'non_independent_gates')),
      'binding_demands', v_demands);
  end if;

  -- D3.05 (20261120090300, marked insertion): the determination cannot be
  -- stale relative to the value actually being committed. The comparison
  -- runs against the determination's OWN frozen thresholds — if the
  -- sanction value bands above the value level the regime was computed on,
  -- the regime is re-applied first, never silently outgrown.
  select * into v_gov from development_case_governance
  where development_case_id = c.id and status = 'current';
  if v_gov.id is not null
     and (v_gov.factor_inputs->'value_thresholds') ? 'standard_from_usd'
     and (v_gov.factor_inputs->'value_thresholds') ? 'elevated_from_usd'
     and (v_gov.factor_inputs->'value_thresholds') ? 'full_from_usd' then
    v_band := case
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'full_from_usd')::numeric then 4
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'elevated_from_usd')::numeric then 3
      when v_value >= ((v_gov.factor_inputs->'value_thresholds')->>'standard_from_usd')::numeric then 2
      else 1
    end;
    if v_band > coalesce((v_gov.factor_levels->>'value')::int, 4) then
      return jsonb_build_object('error',
        format('cannot sanction $%s: it bands above the value level the current governance determination was computed on (banded %s/4 against the determination''s own thresholds, determined at %s/4) — re-apply the determination (apply_case_governance) so the governance regime reflects the value actually being committed',
               v_value, v_band, v_gov.factor_levels->>'value'));
    end if;
  end if;

  perform set_config('app.development_sanction_write', 'granted', true);

  update development_cases
  set status = 'sanctioned',
      sanctioned_by = auth.uid(),
      sanctioned_at = now(),
      sanctioned_value = v_value,
      sanction_note = btrim(p_note),
      updated_at = now()
  where id = c.id;

  perform set_config('app.development_sanction_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'action', 'sanctioned',
      'sanctioned_value', v_value, 'ceiling', l.max_commitment_usd,
      'tier', l.tier_label));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Development case "%s" sanctioned at $%s by role %s under the %s sanction delegation.',
            c.title, v_value, coalesce(v_role, 'none'), l.tier_label));

  return jsonb_build_object('case_id', c.id, 'status', 'sanctioned',
    'sanctioned_value', v_value, 'tier', l.tier_label);
end
$$;

revoke all on function public.sanction_development_case(uuid, text, numeric) from public, anon;
grant execute on function public.sanction_development_case(uuid, text, numeric) to authenticated;

notify pgrst, 'reload schema';
