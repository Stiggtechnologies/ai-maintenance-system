-- ============================================================================
-- Sync Develop Slice 3B — gate conditions as governed instruments with a
-- lifecycle (D3.18, spec II.16) and the zero-based funding question recorded
-- on every gate decision (D3.07, spec I.5).
--
-- WHAT EXISTS (register row D3.18, verified): gate_conditions rows are BORN
-- complete — owner, due date, evidence requirement, consequence-if-missed,
-- all NOT NULL (20261101090300:126) — and created only inside
-- record_case_gate_review on a proceed_with_conditions. What was missing is
-- the other half of II.16's contract: what happens AFTER the decision.
--
--   1. CLOSURE REQUIRES LINKED EVIDENCE. close_gate_condition demands an
--      evidence_items row (the ONE evidence model, ruling 3) recorded
--      against the SAME case; "the owner says it is done" is not evidence.
--      The transition trigger enforces the same at the persistence boundary
--      so a service write cannot mint an evidence-free closure silently
--      (admit-and-audit posture for service, refusal for clients — the
--      20261101090300 child idiom, now with a lifecycle marker of its own).
--   2. OVERDUE CONDITIONS ESCALATE — the expire_governance_instruments
--      pattern, EXTENDED (register: "escalation via the
--      expire_governance_instruments pattern", overlap-map ruling 15: extend
--      the sweep, no second sweep). The hourly job marks open conditions
--      past their due date 'missed', stamps breached_at, and raises a
--      security_events escalation NAMING the owner, the consequence the
--      review recorded, and the case — a consequence written at decision
--      time and never read at breach time would be theatre.
--   3. A MISSED CONDITION CAN STILL BE CLOSED (late, with evidence) — the
--      breach stays on the record (breached_at survives closure).
--
-- D3.07 — THE ZERO-BASED FUNDING QUESTION (spec I.5: "Every gate asks: if
-- this project were proposed today using what we now know, would we still
-- fund it?"):
--
--   * stage_gate_reviews gains funding_continuation_answer, non-empty when
--     present (the conditions-text idiom, 20260816090000:221-227).
--   * WHERE IT HARD-BLOCKS — the "sanction-type gates" ruling. stage_gates
--     carries decision_type gate|checkpoint and no sanction marker; the ONE
--     stage vocabulary (ruling 2) does carry the master 'sanction' stage
--     (20261101090000:40, stage_order 46). RULING: a sanction-type gate is
--     a decision_type='gate' row whose stage sits AT OR AFTER the master
--     sanction stage — the commitment decision and every funding-
--     continuation review after it. There, a passing outcome without the
--     answer is REFUSED at the RPC (re-created in 20261121090400 with the
--     rest of the act-site family). Earlier gates ask the question too
--     (spec I.5 says every gate) — the panel surfaces it and records any
--     answer given; unanswered it blocks READINESS display, not the record
--     of a legitimately-taken early decision. Checkpoints (lighter rows,
--     D3.37) never hard-block on it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Condition lifecycle columns.
-- ---------------------------------------------------------------------------
alter table public.gate_conditions
  add column if not exists closed_by uuid references auth.users(id),
  add column if not exists closed_at timestamptz,
  add column if not exists closure_evidence_id uuid references evidence_items(id) on delete set null,
  add column if not exists closure_note text,
  add column if not exists breached_at timestamptz;

create index if not exists idx_gate_conditions_case_open
  on gate_conditions(organization_id, status, due_date)
  where status in ('open','missed');

-- D3.07: the funding-continuation answer on the review row itself.
alter table public.stage_gate_reviews
  add column if not exists funding_continuation_answer text;
alter table public.stage_gate_reviews
  drop constraint if exists sgr_funding_answer_nonempty;
alter table public.stage_gate_reviews
  add constraint sgr_funding_answer_nonempty check
    (funding_continuation_answer is null or btrim(funding_continuation_answer) <> '');

comment on column public.stage_gate_reviews.funding_continuation_answer is
  'D3.07 / spec I.5: the recorded answer to "if this project were proposed today using what we now know, would we still fund it?". Required for passing outcomes at sanction-type gates (decision_type=gate, stage at-or-after the master sanction stage); recorded when given everywhere else.';

-- ---------------------------------------------------------------------------
-- 2. Condition provenance, reworked for the lifecycle. Conditions are BORN
--    with their review (app.gate_review_write) and thereafter change only
--    through the lifecycle acts below (app.gate_condition_lifecycle):
--    clients outside both markers are refused; the service path is admitted
--    AND audited (the 20261101090300 child idiom, unchanged in posture).
--    stage_gate_findings keep the original shared function untouched.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_gate_condition_provenance()
returns trigger
language plpgsql
as $$
declare
  v_birth text := coalesce(current_setting('app.gate_review_write', true), '');
  v_life text := coalesce(current_setting('app.gate_condition_lifecycle', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_id text := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
begin
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_birth <> 'granted' and v_life <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Gate condition ' || v_id || ' written by a service caller (' || lower(tg_op)
           || '), bypassing record_case_gate_review() and the condition lifecycle '
           || '(close_gate_condition / the escalation sweep).');
    end if;
    -- Transition integrity holds for EVERY writer, the audited service path
    -- included: a satisfied condition without linked evidence is not a
    -- closed condition, whoever writes it.
    if tg_op in ('INSERT','UPDATE') and new.status = 'satisfied'
       and (new.closure_evidence_id is null or new.closed_by is null or new.closed_at is null) then
      raise exception
        'A gate condition is closed by linked evidence (closure_evidence_id), a closer and a time — '
        'spec II.16: every condition has evidence, and a closure without it is an assertion.'
        using errcode = 'check_violation';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if (v_birth <> 'granted' and v_life <> 'granted')
     or current_user in ('authenticated', 'anon') then
    raise exception
      'Gate conditions are recorded with the review that carries them '
      '(record_case_gate_review) and closed or escalated only through the '
      'condition lifecycle (close_gate_condition, the overdue sweep). A condition '
      'that can be edited freely after the decision is not a condition.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op in ('INSERT','UPDATE') and new.status = 'satisfied'
     and (new.closure_evidence_id is null or new.closed_by is null or new.closed_at is null) then
    raise exception
      'A gate condition is closed by linked evidence (closure_evidence_id), a closer and a time — '
      'spec II.16: every condition has evidence, and a closure without it is an assertion.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_gate_condition_provenance on public.gate_conditions;
create trigger trg_gate_condition_provenance
  before insert or update or delete on public.gate_conditions
  for each row execute function public.enforce_gate_condition_provenance();

-- ---------------------------------------------------------------------------
-- 2b. BORN COMPLETE binds every writer, not only the RPC. A case-scoped
--     proceed_with_conditions review with zero first-class gate_conditions
--     rows is a conditional decision whose conditions exist only as prose —
--     record_case_gate_review already refuses it, and this DEFERRED
--     constraint trigger refuses the same shape at commit for the raw and
--     service paths too (deferred, because the review row is inserted
--     before its condition children inside the one governed transaction).
--     Scoped to the reconciled case vocabulary: legacy asset-side reviews
--     (development_case_id null, 'pass_with_conditions') predate first-class
--     conditions and keep their text-only contract
--     (sgr_conditions_required_on_conditional, 20261101090300:91).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_conditional_review_has_conditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.development_case_id is not null
     and new.outcome = 'proceed_with_conditions'
     and not exists (select 1 from gate_conditions gc where gc.review_id = new.id) then
    raise exception
      'A proceed_with_conditions review carries at least one first-class gate condition '
      '(owner, due date, evidence requirement, consequence-if-missed — spec II.16). '
      'Conditions that exist only as prose have no owner, no deadline and no escalation; '
      'record the review through record_case_gate_review with its conditions.'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function public.enforce_conditional_review_has_conditions() from public, anon, authenticated;

drop trigger if exists trg_conditional_review_has_conditions on public.stage_gate_reviews;
create constraint trigger trg_conditional_review_has_conditions
  after insert or update on public.stage_gate_reviews
  deferrable initially deferred
  for each row execute function public.enforce_conditional_review_has_conditions();

-- ---------------------------------------------------------------------------
-- 3. Closing a condition: the governed act. Evidence from the ONE evidence
--    model, recorded against the SAME case; late closure is closure with the
--    breach preserved. The ai_admin identity is refused by name — releasing
--    a condition releases part of a gate decision (§70-adjacent).
-- ---------------------------------------------------------------------------
create or replace function public.close_gate_condition(
  p_condition_id bigint,
  p_evidence_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  gc gate_conditions%rowtype;
  rv stage_gate_reviews%rowtype;
  ev evidence_items%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'closing a gate condition releases part of a gate decision — a human act the AI-operator identity cannot record');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'closing a gate condition requires a governance or engineering role');
  end if;
  select * into gc from gate_conditions
  where id = p_condition_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate condition not found');
  end if;
  if gc.status = 'satisfied' then
    return jsonb_build_object('error', 'this condition is already satisfied — a closure is not overwritable');
  end if;
  select * into rv from stage_gate_reviews where id = gc.review_id;
  if p_evidence_id is null then
    return jsonb_build_object('error',
      format('closing a condition requires the evidence the review demanded ("%s") — record it (record_case_evidence) and link it here', gc.evidence_requirement));
  end if;
  select * into ev from evidence_items
  where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found in this organization');
  end if;
  if rv.development_case_id is not null
     and ev.development_case_id is distinct from rv.development_case_id then
    return jsonb_build_object('error',
      'that evidence item is not recorded against this condition''s case — evidence for a condition of one case cannot be borrowed from another');
  end if;

  perform set_config('app.gate_condition_lifecycle', 'granted', true);
  update gate_conditions
  set status = 'satisfied',
      closed_by = auth.uid(),
      closed_at = now(),
      closure_evidence_id = ev.id,
      closure_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = gc.id;
  perform set_config('app.gate_condition_lifecycle', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'gate_condition', coalesce(v_role, 'unknown'),
    jsonb_build_object('condition_id', gc.id, 'action', 'satisfied',
      'review_id', gc.review_id, 'case_id', rv.development_case_id,
      'evidence_id', ev.id, 'was_breached', gc.breached_at is not null),
    jsonb_build_object('status', gc.status, 'closed_by', gc.closed_by,
      'closed_at', gc.closed_at, 'closure_evidence_id', gc.closure_evidence_id,
      'breached_at', gc.breached_at),
    jsonb_build_object('status', 'satisfied', 'closed_by', auth.uid(),
      'closed_at', now(), 'closure_evidence_id', ev.id,
      'breached_at', gc.breached_at));

  return jsonb_build_object('condition_id', gc.id, 'status', 'satisfied',
    'evidence_id', ev.id,
    'closed_late', gc.breached_at is not null);
end
$$;

revoke all on function public.close_gate_condition(bigint, uuid, text) from public, anon;
grant execute on function public.close_gate_condition(bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The sweep, EXTENDED (ruling 15: one sweep). Re-created from its
--    20260809140000 definition with two additions, both marked:
--      (a) overdue OPEN gate conditions -> 'missed' + breached_at + an
--          escalation security_events row naming owner, consequence, case;
--      (b) gate-requirement waivers expiring leave a security_events row
--          stating that ENFORCEMENT REVERTED (D3.20's no-silent-permanence:
--          expiry is not bookkeeping, it re-arms a rule, and the record
--          says so).
--    Both write audit_events with previous/new state (D11.31). Everything
--    pre-existing is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.expire_governance_instruments()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var int;
  v_risk int;
  -- D3.18/D3.20 (20261121090200, marked insertion): escalation counters.
  v_cond int;
  rec record;
begin
  with x as (
    update standard_site_variances set status = 'expired'
    where status = 'approved' and expires_at is not null and expires_at <= now()
    returning id, organization_id, subject_type, requirement_id, development_case_id, expires_at)
  select count(*) into v_var from x;

  with y as (
    update risk_acceptances set status = 'expired'
    where status = 'active' and expires_at <= now()
    returning 1)
  select count(*) into v_risk from y;

  -- D3.20 (20261121090200, marked insertion): an expired gate-requirement
  -- waiver stops satisfying what it waived THE MOMENT the predicate family
  -- reads it (case_binding_gate_demands / record_case_gate_review consult
  -- status+expiry live); this pass makes the reversion a RECORD, not only a
  -- predicate outcome. Rows already flipped above are found by timestamp.
  for rec in
    select w.id, w.organization_id, w.development_case_id, w.requirement_id,
           w.expires_at, sc.criterion
    from standard_site_variances w
    left join stage_gate_criteria sc on sc.id = w.requirement_id
    where w.subject_type = 'gate_requirement' and w.status = 'expired'
      and w.expires_at <= now()
      and not exists (
        select 1 from audit_events a
        where a.organization_id = w.organization_id
          and a.entity_type = 'gate_requirement_waiver'
          and a.event_data->>'action' = 'expired'
          and a.event_data->>'waiver_id' = w.id::text)
  loop
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'gate_requirement_waiver', 'system:expiry_sweep',
      jsonb_build_object('waiver_id', rec.id, 'action', 'expired',
        'case_id', rec.development_case_id, 'requirement_id', rec.requirement_id,
        'expired_at', rec.expires_at),
      jsonb_build_object('status', 'approved'),
      jsonb_build_object('status', 'expired'));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('Gate-requirement waiver expired for case %s, requirement "%s" — ENFORCEMENT REVERTED: the requirement binds again at every gate, advance and sanction from this moment. A temporary exception does not become a design decision by lapse of attention (spec II.16).',
              rec.development_case_id, coalesce(rec.criterion, rec.requirement_id::text)));
  end loop;

  -- D3.18 (20261121090200, marked insertion): overdue conditions escalate.
  v_cond := 0;
  perform set_config('app.gate_condition_lifecycle', 'granted', true);
  for rec in
    with escalated as (
      update gate_conditions gc
      set status = 'missed', breached_at = now()
      where gc.status = 'open' and gc.due_date < current_date
      returning gc.id, gc.organization_id, gc.review_id, gc.description,
                gc.owner_id, gc.due_date, gc.consequence_if_missed)
    select * from escalated
  loop
    v_cond := v_cond + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (rec.organization_id, 'gate_condition', 'system:expiry_sweep',
      jsonb_build_object('condition_id', rec.id, 'action', 'escalated_overdue',
        'review_id', rec.review_id, 'due_date', rec.due_date,
        'owner_id', rec.owner_id),
      jsonb_build_object('status', 'open', 'breached_at', null),
      jsonb_build_object('status', 'missed', 'breached_at', now()));
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (rec.organization_id, null, 'system (expiry sweep)',
       'admin_action', 'warning',
       format('Gate condition OVERDUE and escalated: "%s" (owner %s, due %s) on review %s. Recorded consequence if missed: %s. The condition was part of the gate decision — it is now breached, not forgotten.',
              rec.description,
              coalesce((select coalesce(p.full_name, p.email) from user_profiles p where p.id = rec.owner_id), rec.owner_id::text),
              rec.due_date, rec.review_id, rec.consequence_if_missed));
  end loop;
  perform set_config('app.gate_condition_lifecycle', '', true);

  return jsonb_build_object('variances_expired', v_var, 'risk_acceptances_expired', v_risk,
    'gate_conditions_escalated', v_cond);
end
$$;

revoke all on function public.expire_governance_instruments() from public, anon;
grant execute on function public.expire_governance_instruments() to service_role;

-- Same job, same slot (the 20260809140000 schedule, unchanged): re-schedule
-- so a fresh chain and an upgraded one carry the extended definition alike.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-governance-instruments')
    where exists (select 1 from cron.job where jobname = 'expire-governance-instruments');
    perform cron.schedule('expire-governance-instruments', '7 * * * *',
      $cron$select public.expire_governance_instruments();$cron$);
  end if;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
