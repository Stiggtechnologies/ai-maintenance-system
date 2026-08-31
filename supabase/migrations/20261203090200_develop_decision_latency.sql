-- ============================================================================
-- Sync Develop Slice 4D (3 of 4) — DECISION LATENCY, CRITICAL-PATH EXPOSURE
-- AND DECISION DEBT.
--
-- D3.12 (decision latency metric, per decision), D3.13 (decision-delay
-- critical-path exposure), D3.36 (Decision Latency calculation §54 including
-- critical-path impact) and D3.21 (decision debt).
--
-- SPEC §54: "DL = DecisionDate - DecisionRequiredDate; show critical-path
-- impact of delayed decisions." SPEC I.30: "Engineering decisions account for
-- 11.7 days of current critical-path exposure." SPEC II.17: "DecisionDebt =
-- FutureExpectedImpact x ProbabilityOfDelay. 'You currently have 14 unresolved
-- decisions capable of affecting the critical path.'"
--
-- D3.36's register row is explicit that it is "a duplicate spec reference of
-- the two I.30 rows above (metric + exposure) — one implementation, cited
-- twice", so latency and exposure are ONE calculation with one lineage key and
-- three rows citing it. Decision debt is a different question with different
-- inputs, so it is a second calculation with its own key.
--
-- ── THE THREE RULINGS THIS FILE TAKES, AND WHY ─────────────────────────────
--
-- RULING 1 — WHEN IS A DECISION CLOSED, GIVEN THAT `decisions` HAS NO
-- CLOSURE TIMESTAMP? The canonical table (overlap-map ruling 4) carries
-- `decision_required_date` and `selected_at`, and `approval_status`
-- (pending/approved/rejected/autonomous) with NO timestamp anywhere in the
-- schema. So:
--   * a decision is CLOSED when an option was selected, and the instant it
--     closed is `selected_at`;
--   * a decision that is `approved` or `rejected` with NO selection has no
--     recorded closing instant, and its latency is therefore UNKNOWABLE. It is
--     REFUSED BY NAME from the latency population and counted — never treated
--     as still open (which would inflate the overdue count) and never treated
--     as closed today (which would fabricate a latency).
-- Inventing a closure timestamp — stamping now() on rows that closed at some
-- unrecorded past instant — would have made every historical latency a
-- measurement of when this migration ran.
--
-- RULING 2 — THE CRITICAL PATH IS P6'S, NOT SYNC'S. Slice 4C settled this: a
-- second critical-path implementation beside the modelling kernel's is two
-- answers to one question, so Sync imports `total_float_hours` and never
-- recomputes the network (20261202090000). Decision-delay exposure follows the
-- SAME rule: an activity is on the critical path when its imported float is at
-- or below the published `criticalFloatHours`, and on a case where NO activity
-- carries a float the exposure REFUSES with 4C's own sentence. It does not
-- fall back to "the longest chain", and it does not report zero.
--
-- RULING 3 — DECISION DEBT NEEDS TWO NUMBERS NOBODY HAS WRITTEN DOWN.
-- §II.17's formula is FutureExpectedImpact x ProbabilityOfDelay. Neither is
-- derivable: `decisions.decision_value` is the value AT STAKE in the decision,
-- which is not the cost of NOT taking it, and no probability of delay exists
-- anywhere in the schema. Deriving one — "overdue implies p = 1" — would be a
-- number the product invented and then charged the customer for believing. So
-- both are STATED, on an append-only exposure record with a basis, and a
-- decision with no such record contributes NOTHING and is named. If NO open
-- decision has one, the whole calculation REFUSES: an empty set is not a
-- measurement, and "$0 of decision debt" is the most reassuring wrong answer
-- this file could give.
--
-- Canonical reuse: `decisions` (ruling 4 — no fourth decision store),
-- shutdown_tasks + its imported float (D5.13/4C), development_cases,
-- audit_events, security_events, record_calculation_run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE POLICY, PINNED. One place for every threshold this file applies.
-- ---------------------------------------------------------------------------
create or replace function public.sync_decision_latency_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    -- 4C's own definition of critical, read from 4C's own policy so the two
    -- can never disagree about which activities are critical.
    'criticalFloatHours', (sync_schedule_quality_policy()->>'criticalFloatHours')::numeric,
    -- A probability is a probability. Anything outside [0,1] is a refusal, not
    -- a clamp: clamping 4.0 to 1.0 turns a typo into a certainty.
    'probabilityFloor', 0.0,
    'probabilityCeiling', 1.0,
    -- Below this many CLOSED decisions the average latency is not published.
    -- One decision is an anecdote and an average of one is a number pretending
    -- to be a statistic. Individual latencies are still reported — the
    -- AGGREGATE is what the floor withholds.
    'averageFloor', 3);
$$;

revoke all on function public.sync_decision_latency_policy() from public, anon;
grant execute on function public.sync_decision_latency_policy() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. WHICH ACTIVITIES A DECISION HOLDS UP (D3.13).
--
--    A link table rather than a column on `decisions`, because one decision
--    routinely gates several activities and a single activity id would silently
--    pick one of them.
-- ---------------------------------------------------------------------------
create table if not exists public.decision_schedule_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  decision_id uuid not null references decisions(id) on delete cascade,
  -- shutdown_tasks.id is a bigint (the pre-Develop schedule table Slice 4A
  -- extended rather than replaced), so the link carries a bigint.
  shutdown_task_id bigint not null references shutdown_tasks(id) on delete cascade,
  -- Why this decision gates this activity. A link with no stated dependency is
  -- an assertion that a decision is on the critical path, made by nobody.
  basis text not null check (length(btrim(basis)) >= 10),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (decision_id, shutdown_task_id)
);

create index if not exists idx_decision_link_case
  on decision_schedule_links(organization_id, development_case_id);
create index if not exists idx_decision_link_task
  on decision_schedule_links(shutdown_task_id);

alter table public.decision_schedule_links enable row level security;
drop policy if exists decision_schedule_links_read on public.decision_schedule_links;
create policy decision_schedule_links_read on public.decision_schedule_links
  for select to authenticated using (organization_id = app_current_org());

comment on table public.decision_schedule_links is
  'D3.13 (spec I.30/§54): which schedule activities a decision gates. Whether those activities are CRITICAL is read from P6''s imported total float (20261202090000), never recomputed — Sync does not run a second critical-path analysis beside the modelling kernel''s.';

-- ---------------------------------------------------------------------------
-- 3. THE STATED EXPOSURE (D3.21). Append-only; the latest row wins, and the
--    superseded ones stay because a debt figure that changed should be able to
--    say what it used to be and who changed it.
-- ---------------------------------------------------------------------------
create table if not exists public.decision_delay_exposures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  decision_id uuid not null references decisions(id) on delete cascade,
  -- §II.17's FutureExpectedImpact: what NOT taking this decision is expected
  -- to cost. Deliberately NOT decisions.decision_value, which is the value at
  -- stake IN the decision — a different quantity that would silently double as
  -- this one.
  expected_impact numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- §II.17's ProbabilityOfDelay, stated rather than derived.
  probability_of_delay numeric not null,
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  constraint decision_exposure_impact_finite check (
    expected_impact >= 0
    and expected_impact <> 'NaN'::numeric
    and expected_impact <> 'Infinity'::numeric
    and expected_impact <> '-Infinity'::numeric),
  -- A probability outside [0,1] is refused, not clamped.
  constraint decision_exposure_probability check (
    probability_of_delay >= 0 and probability_of_delay <= 1
    and probability_of_delay <> 'NaN'::numeric)
);

create index if not exists idx_decision_exposure_decision
  on decision_delay_exposures(decision_id, recorded_at desc);
create index if not exists idx_decision_exposure_case
  on decision_delay_exposures(organization_id, development_case_id);

alter table public.decision_delay_exposures enable row level security;
drop policy if exists decision_delay_exposures_read on public.decision_delay_exposures;
create policy decision_delay_exposures_read on public.decision_delay_exposures
  for select to authenticated using (organization_id = app_current_org());

comment on table public.decision_delay_exposures is
  'D3.21 (spec II.17): the two numbers DecisionDebt = FutureExpectedImpact x ProbabilityOfDelay needs, STATED with a basis rather than derived. Append-only; the latest row per decision is the live one. A decision with no exposure row contributes nothing to decision debt and is named as unquantified — never counted as zero.';

-- ---------------------------------------------------------------------------
-- 4. THE WALLS. Both tables carry statements a person made; neither is edited.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_decision_exposure_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_role text;
  d decisions%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'decision_delay_exposures is the stated basis of every decision-debt figure this product publishes; truncating it makes every one of them unfalsifiable in a single statement.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  -- REVIEW REPAIR (4D-R23). THESE CHECKS COVER INSERT **AND** UPDATE.
  --
  -- They used to live inside `if tg_op = 'INSERT' then ... return new; end if;`,
  -- so an admitted service UPDATE walked straight past them: `update
  -- decision_delay_exposures set recorded_by = <the ai_admin identity>` was
  -- accepted, re-attributing a §70-reserved statement to the AI identity with
  -- only the generic warning in security_events. The sibling
  -- enforce_project_change_governance states exactly this reason for covering
  -- both, and the decision↔case coherence check its other sibling
  -- (enforce_decision_schedule_link) makes was missing here entirely — so an
  -- exposure could carry one organization's id while pointing at another
  -- organization's decision, and become readable under the org read policy.
  if tg_op in ('INSERT', 'UPDATE') then
    select * into d from decisions where id = new.decision_id;
    if not found or d.organization_id is distinct from new.organization_id then
      raise exception 'the decision this exposure is stated against must belong to this organization'
        using errcode = 'check_violation';
    end if;
    if d.development_case_id is distinct from new.development_case_id then
      raise exception
        'a decision-delay exposure must be filed under the development case its decision belongs to — an exposure on another case''s decision is not this case''s debt.'
        using errcode = 'check_violation';
    end if;

    select role into v_role from user_profiles
     where id = new.recorded_by and organization_id = new.organization_id;
    if v_role is null then
      raise exception 'a decision-delay exposure must be recorded by a member of this organization'
        using errcode = 'check_violation';
    end if;
    -- §70 on the row: an AI-stated expected impact and probability of delay
    -- IS a forecast of what a project will lose, presented as a fact.
    if v_role = 'ai_admin' then
      raise exception
        'this decision-delay exposure is attributed to the AI-operator identity. The expected impact and probability of delay are the whole content of a decision-debt figure; spec §70 forbids an AI or system identity from stating them as the basis of a governance number.'
        using errcode = 'check_violation';
    end if;
    if auth.uid() is not null and new.recorded_by is distinct from auth.uid() then
      raise exception 'a decision-delay exposure is recorded by the caller who states it'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- THE TWO NUMBERS ARE REFUSED FOR EVERY CALLER, THE SERVICE PATH INCLUDED —
  -- the same rule the contingency ledger applies to its money fields, for the
  -- same reason. `expected_impact` and `probability_of_delay` ARE the published
  -- decision-debt figure; an UPDATE that moved either would rewrite a
  -- governance number while every trigger appeared to fire, and the
  -- security_events row would describe the rewrite rather than prevent it.
  if tg_op = 'UPDATE'
     and (new.expected_impact is distinct from old.expected_impact
          or new.probability_of_delay is distinct from old.probability_of_delay
          or new.currency is distinct from old.currency
          or new.decision_id is distinct from old.decision_id
          or new.recorded_by is distinct from old.recorded_by
          or new.development_case_id is distinct from old.development_case_id
          or new.organization_id is distinct from old.organization_id) then
    -- NO security_events ROW ON A REFUSING PATH (4D-R33).
    --
    -- A BEFORE trigger that inserts an audit row and then RAISES loses the
    -- insert: the exception aborts the statement and the row goes with it.
    -- Proven live — a service UPDATE refused here left security_events
    -- unchanged. An audit call that cannot survive its own refusal is dead
    -- code that reads, in review and in the register, as an audit trail. The
    -- REFUSAL is the enforcement and it is total; the rows that do land are
    -- the ADMITTED service writes, which is where an audit trail is the only
    -- thing standing between the product and a silent change.
    raise exception
      'the expected impact and probability of delay on a decision-delay exposure cannot be rewritten by ANY caller, service paths included — they are the whole content of a published decision-debt figure. Record a NEW exposure; the superseded row stays so a changed figure can say what it used to be.'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_client then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values (v_org, null, 'service (' || current_user || ')',
        'admin_action', 'warning',
        'A decision-delay exposure was ' || lower(tg_op) || 'd by a service caller. It is '
          || 'the stated basis of a published decision-debt figure (D3.21).');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'a decision-delay exposure is a statement somebody made on a date; it is superseded by recording a new one, never edited. The superseded rows stay so a changed debt figure can say what it used to be.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.enforce_decision_exposure_immutable() from public, anon, authenticated;

drop trigger if exists trg_decision_exposure_immutable on public.decision_delay_exposures;
create trigger trg_decision_exposure_immutable
  before insert or update or delete on public.decision_delay_exposures
  for each row execute function public.enforce_decision_exposure_immutable();

drop trigger if exists trg_decision_exposure_no_truncate on public.decision_delay_exposures;
create trigger trg_decision_exposure_no_truncate
  before truncate on public.decision_delay_exposures
  for each statement execute function public.enforce_decision_exposure_immutable();

revoke truncate on table public.decision_delay_exposures from anon, authenticated, service_role;
revoke truncate on table public.decision_schedule_links from anon, authenticated, service_role;

create or replace function public.enforce_decision_schedule_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_role text;
  d decisions%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'decision_schedule_links is what makes a decision COUNT as critical-path exposure; truncating it silently drops every such link and the exposure figure falls to zero.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if tg_op = 'DELETE' then
    if not v_client then
      if exists (select 1 from organizations where id = v_org) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values (v_org, null, 'service (' || current_user || ')',
          'admin_action', 'warning',
          'A decision-to-activity link was deleted by a service caller. Deleting a link '
            || 'removes a decision from the critical-path exposure figure (D3.13).');
      end if;
      return old;
    end if;
    return old;   -- a client delete is refused by the absence of a write policy
  end if;

  select * into d from decisions where id = new.decision_id;
  if not found or d.organization_id is distinct from new.organization_id then
    raise exception 'the linked decision must belong to this organization'
      using errcode = 'check_violation';
  end if;
  if d.development_case_id is distinct from new.development_case_id then
    raise exception
      'the linked decision must belong to the development case this link is filed under — a decision on another case does not gate this case''s schedule.'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where t.id = new.shutdown_task_id
      and e.organization_id = new.organization_id
      and e.development_case_id = new.development_case_id) then
    raise exception
      'the linked activity must belong to this development case''s schedule'
      using errcode = 'check_violation';
  end if;
  select role into v_role from user_profiles
   where id = new.recorded_by and organization_id = new.organization_id;
  if v_role is null then
    raise exception 'a decision-to-activity link must be recorded by a member of this organization'
      using errcode = 'check_violation';
  end if;
  if v_role = 'ai_admin' then
    raise exception
      'this decision-to-activity link is attributed to the AI-operator identity. A link decides whether a pending decision counts as critical-path exposure, which is the number §54 puts in front of an executive; spec §70 reserves it to a human.'
      using errcode = 'check_violation';
  end if;
  if auth.uid() is not null and new.recorded_by is distinct from auth.uid() then
    raise exception 'a decision-to-activity link is recorded by the caller who states it'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_decision_schedule_link() from public, anon, authenticated;

drop trigger if exists trg_decision_schedule_link on public.decision_schedule_links;
create trigger trg_decision_schedule_link
  before insert or update or delete on public.decision_schedule_links
  for each row execute function public.enforce_decision_schedule_link();

drop trigger if exists trg_decision_schedule_link_no_truncate on public.decision_schedule_links;
create trigger trg_decision_schedule_link_no_truncate
  before truncate on public.decision_schedule_links
  for each statement execute function public.enforce_decision_schedule_link();

-- ---------------------------------------------------------------------------
-- 5. THE TWO AUTHORING ACTS.
-- ---------------------------------------------------------------------------
create or replace function public.link_decision_to_activity(
  p_decision_id uuid,
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
  d decisions%rowtype;
  t bigint;
  v_id uuid;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'linking a decision to a schedule activity decides whether it counts as critical-path exposure. Spec §70 reserves that to a human; the AI may propose the link.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking a decision to the schedule requires a planning, engineering or governance role');
  end if;
  select * into d from decisions where id = p_decision_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'decision not found'); end if;
  if d.development_case_id is null then
    return jsonb_build_object('error',
      'this decision is not attached to a development case, so it has no case schedule to gate');
  end if;
  t := nullif(btrim(coalesce(p_link->>'activity_id', '')), '')::bigint;
  if t is null then
    -- Accept the planner-facing activity KEY as well as the row id: the key is
    -- what a person reads off a schedule.
    select st.id into t from shutdown_tasks st
     join shutdown_events e on e.id = st.event_id
     where e.organization_id = v_org and e.development_case_id = d.development_case_id
       and st.task_key = btrim(coalesce(p_link->>'activity_key', ''))
     limit 1;
  end if;
  if t is null then
    return jsonb_build_object('error',
      'name the schedule activity this decision gates, by activity_id or activity_key');
  end if;
  if length(btrim(coalesce(p_link->>'basis', ''))) < 10 then
    return jsonb_build_object('error',
      'state why this decision gates that activity (10 characters minimum)');
  end if;
  if exists (select 1 from decision_schedule_links
              where decision_id = d.id and shutdown_task_id = t) then
    return jsonb_build_object('error', 'this decision is already linked to that activity');
  end if;

  begin
    insert into decision_schedule_links
      (organization_id, development_case_id, decision_id, shutdown_task_id, basis, recorded_by)
    values (v_org, d.development_case_id, d.id, t, btrim(p_link->>'basis'), auth.uid())
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('error', sqlerrm);
  end;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'decision_schedule_link', coalesce(v_role, 'system'),
    jsonb_build_object('decision_id', d.id, 'activity_id', t, 'link_id', v_id),
    null, jsonb_build_object('recorded_by', auth.uid()));

  return jsonb_build_object('link_id', v_id, 'decision_id', d.id, 'activity_id', t);
end
$$;

revoke all on function public.link_decision_to_activity(uuid, jsonb) from public, anon, service_role;
grant execute on function public.link_decision_to_activity(uuid, jsonb) to authenticated;

create or replace function public.record_decision_delay_exposure(
  p_decision_id uuid,
  p_exposure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d decisions%rowtype;
  v_impact numeric;
  v_prob numeric;
  v_currency text := upper(btrim(coalesce(p_exposure->>'currency', 'CAD')));
  v_id uuid;
  v_prev decision_delay_exposures%rowtype;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the expected impact and probability of delay ARE the decision-debt figure. Spec §70 forbids an AI or system identity from stating them as the basis of a governance number; the AI may propose them for a human to record.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'stating a decision-delay exposure requires a planning, engineering or governance role');
  end if;
  select * into d from decisions where id = p_decision_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'decision not found'); end if;
  if d.development_case_id is null then
    return jsonb_build_object('error',
      'this decision is not attached to a development case; decision debt is reported per case');
  end if;
  if d.selected_at is not null then
    return jsonb_build_object('error',
      'this decision has already been made. Decision DEBT is the accumulated cost of decisions NOT yet taken (spec II.17); a made decision carries no delay exposure.');
  end if;

  v_impact := sync_finite_money(p_exposure->>'expected_impact');
  if v_impact is null or v_impact < 0 then
    return jsonb_build_object('error', format(
      'the expected impact is %s; state it as a finite amount of at least zero — what NOT taking this decision is expected to cost. This is deliberately not the value at stake in the decision, which is a different quantity.',
      coalesce(nullif(btrim(coalesce(p_exposure->>'expected_impact', '')), ''), 'absent')));
  end if;
  v_prob := sync_finite_money(p_exposure->>'probability_of_delay');
  if v_prob is null then
    return jsonb_build_object('error',
      'state the probability that this decision slips further, as a number between 0 and 1. It is not derived: "overdue therefore certain" is a rule this product would have invented and then charged you for believing.');
  end if;
  if v_prob < 0 or v_prob > 1 then
    return jsonb_build_object('error', format(
      'the probability of delay is %s; a probability lies between 0 and 1. It is refused rather than clamped — clamping 4.0 to 1.0 turns a typo into a certainty.',
      v_prob));
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error', 'state the currency as a three-letter code');
  end if;
  if length(btrim(coalesce(p_exposure->>'basis', ''))) < 20 then
    return jsonb_build_object('error',
      'record the basis for this exposure (20 characters minimum) — what the impact and the probability were estimated from');
  end if;

  select * into v_prev from decision_delay_exposures
   where decision_id = d.id order by recorded_at desc limit 1;

  insert into decision_delay_exposures
    (organization_id, development_case_id, decision_id, expected_impact, currency,
     probability_of_delay, basis, recorded_by)
  values (v_org, d.development_case_id, d.id, v_impact, v_currency, v_prob,
     btrim(p_exposure->>'basis'), auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'decision_delay_exposure', coalesce(v_role, 'system'),
    jsonb_build_object('decision_id', d.id, 'exposure_id', v_id,
      'case_id', d.development_case_id),
    case when v_prev.id is null then null else jsonb_build_object(
      'expected_impact', v_prev.expected_impact,
      'probability_of_delay', v_prev.probability_of_delay) end,
    jsonb_build_object('expected_impact', v_impact, 'probability_of_delay', v_prob,
      'currency', v_currency, 'debt', round(v_impact * v_prob, 2)));

  return jsonb_build_object('exposure_id', v_id, 'decision_id', d.id,
    'expected_impact', v_impact, 'probability_of_delay', v_prob,
    'currency', v_currency, 'debt', round(v_impact * v_prob, 2));
end
$$;

revoke all on function public.record_decision_delay_exposure(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_decision_delay_exposure(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE READ (D3.12 + D3.13 + D3.36). Per decision, then the aggregate.
--
--     REFUSAL-FIRST, three times over:
--       * no decision record at all -> the whole read refuses. "0 days of
--         latency" on a case with no decisions is the most flattering wrong
--         answer available.
--       * a decision with no required date -> excluded and NAMED. Latency is
--         measured from a date; without one there is nothing to measure from.
--       * a closed decision with no selection instant (ruling 1) -> excluded
--         and NAMED, never treated as open and never dated today.
--     ...and the critical-path half refuses separately, because a case can
--     have decisions and no float (ruling 2).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_decision_latency(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_policy jsonb := sync_decision_latency_policy();
  v_rows jsonb := '[]'::jsonb;
  v_total int;
  v_closed int;
  v_open int;
  v_undated int;
  v_unknown_close int;
  v_avg numeric;
  v_max numeric;
  v_refusal text;
  v_avg_refusal text;
  v_cp_refusal text;
  v_cp_days numeric;
  v_cp_count int;
  v_activities int;
  v_with_float int;
  v_crit numeric := (v_policy->>'criticalFloatHours')::numeric;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  select count(*), count(*) filter (where t.total_float_hours is not null)
    into v_activities, v_with_float
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org and e.development_case_id = c.id;

  with d as (
    select dec.*,
      -- RULING 1, in one place.
      --
      -- REVIEW REPAIR (4D-R21). `is_open` was `selected_at is null`, which is
      -- TRUE for exactly the same rows as `closed_without_instant` — so a
      -- decision recorded as approved/rejected with no selection was counted in
      -- `openCount`, given a running latency clocked from now(), and summed into
      -- the §54 critical-path exposure headline, while its own
      -- `latencyRefusal` said "It is excluded rather than dated today or left
      -- counting as open." The sentence was false about its own row, the
      -- headline was inflated by decisions that had actually been taken, and
      -- the figure grew every day for ever. `get_case_decision_debt` already
      -- used the correct predicate, so the two calculations disagreed about
      -- what "open" means. Open now means what the debt kernel means by it.
      dec.selected_at as closed_at,
      (dec.selected_at is null and coalesce(dec.approval_status, 'pending') = 'pending')
        as is_open,
      (dec.selected_at is null and dec.approval_status in ('approved','rejected','autonomous'))
        as closed_without_instant,
      -- The links, and whether any of them is critical BY P6'S OWN FLOAT.
      (select count(*) from decision_schedule_links l where l.decision_id = dec.id) as link_count,
      (select count(*) from decision_schedule_links l
        join shutdown_tasks t on t.id = l.shutdown_task_id
        where l.decision_id = dec.id
          and t.total_float_hours is not null
          and t.total_float_hours <= v_crit) as critical_links,
      (select count(*) from decision_schedule_links l
        join shutdown_tasks t on t.id = l.shutdown_task_id
        where l.decision_id = dec.id and t.total_float_hours is null) as unfloated_links
    from decisions dec
    where dec.organization_id = v_org and dec.development_case_id = c.id
      -- REVIEW REPAIR (4D-R22). RISK VISIBILITY, THE SAME PREDICATE
      -- get_my_decisions APPLIES. `can_read_risk` is the codebase's canonical
      -- decision-visibility rule (can_read_risk_subject('decision', ...)), and
      -- dropping it here meant a `planner` read the question, the owner, the
      -- restricted risk id, the value at stake and the delay-exposure money of
      -- a decision hung off a `restricted` risk they are not permitted to
      -- see — and compute_case_decision_latency then persisted those figures
      -- into calculation_runs and composed them onto Integrated Controls.
      and (dec.risk_id is null or can_read_risk(dec.risk_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'decisionId', d.id,
      'question', coalesce(d.decision_question, d.action_taken, d.decision_type),
      'decisionType', d.decision_type,
      'owner', (select email from user_profiles up where up.id = d.owner_id),
      'requiredDate', d.decision_required_date,
      'closedAt', d.closed_at,
      'isOpen', d.is_open,
      'approvalStatus', d.approval_status,
      'reassessmentRequired', d.reassessment_required,
      'valueAtStake', d.decision_value,
      'currency', d.decision_currency,
      'confidence', d.confidence_score,
      'riskId', d.risk_id,
      -- §54: DL = DecisionDate - DecisionRequiredDate, in days. Positive is
      -- late; NEGATIVE IS EARLY AND IS KEPT AS A NEGATIVE, because a portfolio
      -- whose early decisions were floored at zero would report a latency it
      -- does not have.
      -- A decision with an UNKNOWABLE closing instant carries NO latency at
      -- all. It is neither running (it is not open) nor closed (the instant is
      -- unknown), and dating it from now() would report the age of the
      -- migration as the age of the decision.
      'latencyDays', case
        when d.decision_required_date is null then null
        when d.closed_without_instant then null
        when d.closed_at is not null then
          round(extract(epoch from (d.closed_at - d.decision_required_date::timestamptz)) / 86400.0, 1)
        when d.is_open then
          round(extract(epoch from (now() - d.decision_required_date::timestamptz)) / 86400.0, 1)
        else null end,
      'latencyKind', case
        when d.decision_required_date is null then 'unmeasurable'
        when d.closed_without_instant then 'unmeasurable'
        when d.closed_at is not null then 'closed'
        else 'running' end,
      'latencyRefusal', case
        when d.decision_required_date is null then
          'This decision carries no required date, so there is nothing to measure latency FROM (spec §54: DL = DecisionDate - DecisionRequiredDate). It is excluded from every latency figure rather than counted as on time.'
        when d.closed_without_instant then
          format('This decision is recorded as %s but no option was selected, and approval carries no timestamp anywhere in the schema — so the instant it closed is unknown and its latency is unmeasurable. It is excluded rather than dated today or left counting as open.', d.approval_status)
        end,
      'linkedActivities', d.link_count,
      'criticalLinks', d.critical_links,
      'onCriticalPath', case when d.link_count = 0 then null
                        when v_with_float = 0 then null
                        else d.critical_links > 0 end,
      'criticalPathRefusal', case
        when d.link_count = 0 then
          'No schedule activity is linked to this decision, so whether it sits on the critical path is unknown — not "no".'
        when v_with_float = 0 then
          'No activity on this case carries a total float. Float is P6''s own computation and Sync imports it rather than recomputing the network (a second critical path beside the modelling kernel''s would be two answers to one question). Re-export with total_float_hours and this decision''s critical-path exposure becomes answerable.'
        when d.unfloated_links > 0 and d.critical_links = 0 then
          format('%s of the activities linked to this decision carry no imported float, so their criticality is unknown; the answer below is over the ones that do.', d.unfloated_links)
        end)
      order by d.decision_required_date nulls last, d.created_at), '[]'::jsonb)
    into v_rows
  from d;

  select count(*),
         count(*) filter (where (value->>'latencyKind') = 'closed'),
         count(*) filter (where (value->>'isOpen')::boolean),
         count(*) filter (where value->>'requiredDate' is null),
         count(*) filter (where (value->>'latencyKind') = 'unmeasurable'
                            and value->>'requiredDate' is not null)
    into v_total, v_closed, v_open, v_undated, v_unknown_close
  from jsonb_array_elements(v_rows);

  -- The aggregate latency, over CLOSED decisions only: mixing a running clock
  -- into an average of completed ones produces a figure that goes down when a
  -- decision is finally taken.
  select round(avg((value->>'latencyDays')::numeric), 1),
         max((value->>'latencyDays')::numeric)
    into v_avg, v_max
  from jsonb_array_elements(v_rows)
  where (value->>'latencyKind') = 'closed' and value->>'latencyDays' is not null;

  if v_total = 0 then
    v_refusal :=
      'No decision is recorded against this case, so decision latency cannot be measured. This is a refusal, not a score of zero: "0 days of latency" would read as a project deciding instantly, when in fact nothing has been recorded as a decision at all.';
  elsif v_closed = 0 then
    v_avg_refusal := format(
      'No decision on this case has a recorded closing instant, so no average latency can be published. %s decision(s) are still open and their running latency is shown per row.',
      v_open);
  elsif v_closed < (v_policy->>'averageFloor')::int then
    v_avg_refusal := format(
      'Only %s decision(s) have closed with a measurable latency; the published floor is %s. The individual latencies are shown; the AVERAGE is withheld, because an average of one or two is a number pretending to be a statistic.',
      v_closed, v_policy->>'averageFloor');
    v_avg := null;
  end if;

  -- §54's headline: "engineering decisions account for N days of current
  -- critical-path exposure". Summed over OPEN, OVERDUE decisions that gate at
  -- least one critical activity.
  if v_activities = 0 then
    v_cp_refusal :=
      'This case has no schedule activities, so no decision can be shown to sit on its critical path. Import or author the schedule first (D5.12/D5.13).';
  elsif v_with_float = 0 then
    v_cp_refusal :=
      'No activity on this case carries a total float. Critical-path exposure is walked over P6''s OWN float, imported verbatim — Sync does not recompute the network, because a second critical path beside the modelling kernel''s would be two answers to one question. Re-export with total_float_hours and this figure becomes answerable.';
  else
    select coalesce(sum((value->>'latencyDays')::numeric), 0), count(*)
      into v_cp_days, v_cp_count
    from jsonb_array_elements(v_rows)
    where (value->>'isOpen')::boolean
      -- Only a RUNNING clock is current exposure. `latencyKind` is the one
      -- place that distinguishes running from unmeasurable, and filtering on
      -- `isOpen` alone was what let a decided decision into the headline.
      and (value->>'latencyKind') = 'running'
      and (value->>'onCriticalPath')::boolean is true
      and value->>'latencyDays' is not null
      and (value->>'latencyDays')::numeric > 0;
    if v_cp_count = 0 then
      v_cp_refusal :=
        'No OPEN decision on this case is both overdue and linked to an activity P6 reports as critical. That is a measured zero — the float exists, the links were checked — and it is stated as such rather than as an absence.';
    end if;
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'decisions', v_rows,
    'decisionCount', v_total,
    'closedCount', v_closed,
    'openCount', v_open,
    'undatedCount', v_undated,
    'unmeasurableCloseCount', v_unknown_close,
    'averageLatencyDays', v_avg,
    'maxLatencyDays', v_max,
    'averageRefusal', v_avg_refusal,
    'refusal', v_refusal,
    'criticalPathExposureDays', case when v_cp_refusal is null then v_cp_days end,
    'criticalPathDecisionCount', case when v_cp_refusal is null then v_cp_count end,
    'criticalPathRefusal', v_cp_refusal,
    'scheduleActivityCount', v_activities,
    'activitiesWithFloat', v_with_float,
    'policy', v_policy);
end
$$;

revoke all on function public.get_case_decision_latency(uuid) from public, anon, service_role;
grant execute on function public.get_case_decision_latency(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. DECISION DEBT (D3.21, spec II.17). DecisionDebt = FutureExpectedImpact x
--     ProbabilityOfDelay, over OPEN decisions, from STATED exposures.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_decision_debt(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_open int;
  v_quantified int;
  v_debt numeric;
  v_refusal text;
  v_currencies int;
  v_currency text;
  v_crit numeric := (sync_decision_latency_policy()->>'criticalFloatHours')::numeric;
  v_cp_capable int;
  v_with_float int;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  select count(*) filter (where t.total_float_hours is not null) into v_with_float
  from shutdown_tasks t join shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org and e.development_case_id = c.id;

  with open_d as (
    select dec.id, dec.decision_question, dec.action_taken, dec.decision_type,
           dec.decision_required_date, dec.owner_id, dec.reassessment_required,
           (select count(*) from decision_schedule_links l
             join shutdown_tasks t on t.id = l.shutdown_task_id
             where l.decision_id = dec.id and t.total_float_hours is not null
               and t.total_float_hours <= v_crit) as critical_links
    from decisions dec
    where dec.organization_id = v_org and dec.development_case_id = c.id
      and dec.selected_at is null
      and coalesce(dec.approval_status, 'pending') = 'pending'
      -- 4D-R22, the same visibility predicate as the latency kernel and
      -- get_my_decisions: a restricted risk's decision carries its expected
      -- impact and its probability of delay, which is the whole of the
      -- published debt figure.
      and (dec.risk_id is null or can_read_risk(dec.risk_id))
  ), latest as (
    select distinct on (e.decision_id) e.*
    from decision_delay_exposures e
    join open_d o on o.id = e.decision_id
    order by e.decision_id, e.recorded_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'decisionId', o.id,
      'question', coalesce(o.decision_question, o.action_taken, o.decision_type),
      'owner', (select email from user_profiles up where up.id = o.owner_id),
      'requiredDate', o.decision_required_date,
      'overdueDays', case when o.decision_required_date is null then null
        else round(extract(epoch from (now() - o.decision_required_date::timestamptz)) / 86400.0, 1) end,
      'reassessmentRequired', o.reassessment_required,
      'criticalLinks', o.critical_links,
      'affectsCriticalPath', case when v_with_float = 0 then null else o.critical_links > 0 end,
      'expectedImpact', l.expected_impact,
      'probabilityOfDelay', l.probability_of_delay,
      'currency', l.currency,
      'debt', case when l.id is null then null
              else round(l.expected_impact * l.probability_of_delay, 2) end,
      'basis', l.basis,
      'statedBy', (select email from user_profiles up where up.id = l.recorded_by),
      'statedAt', l.recorded_at,
      'debtRefusal', case when l.id is null then
        'No delay exposure has been stated for this decision, so its contribution to decision debt is UNQUANTIFIED. Spec II.17 is DecisionDebt = FutureExpectedImpact x ProbabilityOfDelay, and neither number is derivable from anything the schema holds — deriving one would be a figure this product invented. It is named here and excluded from the total, never counted as zero.'
        end)
      order by (l.expected_impact * l.probability_of_delay) desc nulls last,
               o.decision_required_date nulls last), '[]'::jsonb)
    into v_rows
  from open_d o
  left join latest l on l.decision_id = o.id;

  select count(*), count(*) filter (where value->>'debt' is not null),
         coalesce(sum((value->>'debt')::numeric), 0),
         count(distinct value->>'currency') filter (where value->>'currency' is not null),
         count(*) filter (where (value->>'affectsCriticalPath')::boolean is true)
    into v_open, v_quantified, v_debt, v_currencies, v_cp_capable
  from jsonb_array_elements(v_rows);

  select max(value->>'currency') into v_currency from jsonb_array_elements(v_rows);

  -- REFUSAL-FIRST. Nothing outstanding is not "$0 of debt".
  if v_open = 0 then
    v_refusal :=
      'No decision on this case is outstanding, so there is no decision debt to accumulate. This is a refusal rather than a figure of zero: a case with nothing recorded as a pending decision and a case that genuinely owes nothing are the same number and different facts, and only one of them is worth acting on.';
  elsif v_quantified = 0 then
    v_refusal := format(
      '%s decision(s) are outstanding and NONE of them carries a stated delay exposure, so decision debt cannot be computed. Spec II.17 needs an expected impact and a probability of delay; both are statements a person makes, and this product will not manufacture either. Record them (record_decision_delay_exposure) and the figure becomes real.',
      v_open);
  elsif v_currencies > 1 then
    v_refusal := format(
      'The stated exposures on this case use %s different currencies. They are NOT summed: adding CAD to USD produces a number in no currency at all. The per-decision figures are shown; state them in one currency for a total.',
      v_currencies);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'decisions', v_rows,
    'outstandingCount', v_open,
    'quantifiedCount', v_quantified,
    'unquantifiedCount', v_open - v_quantified,
    'totalDebt', case when v_refusal is null then v_debt end,
    'currency', v_currency,
    'criticalPathCapableCount', case when v_with_float = 0 then null else v_cp_capable end,
    'criticalPathCapableRefusal', case when v_with_float = 0 then
      'No activity on this case carries an imported total float, so "decisions capable of affecting the critical path" (spec II.17) cannot be counted. Sync reads P6''s float and does not recompute the network.' end,
    'refusal', v_refusal);
end
$$;

revoke all on function public.get_case_decision_debt(uuid) from public, anon, service_role;
grant execute on function public.get_case_decision_debt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. THE TWO CALCULATIONS (D11.29). Every figure above becomes a recorded run,
--     refusals included — a latency computed over a population with four
--     unmeasurable decisions in it must be distinguishable in the ledger from
--     one computed over a clean set.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_decision_latency(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_read jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70. A recorded latency figure is a governance judgement about how long
  -- this organization's decisions take; the AI may read, not record.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording decision latency publishes a judgement about how long this organization takes to decide and what that has cost the critical path. Spec §70 forbids an AI or system identity from making it. The AI may read get_case_decision_latency, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording decision latency requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  v_read := get_case_decision_latency(c.id);
  if v_read ? 'error' then return v_read; end if;

  if v_read->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'refusal');
  end if;
  if v_read->>'averageRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'averageRefusal');
  end if;
  if v_read->>'criticalPathRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'criticalPathRefusal');
  end if;
  -- Every excluded decision, by name. A population that shrank silently is how
  -- an average improves without anything improving.
  for rec in select value as d from jsonb_array_elements(v_read->'decisions')
              where value->>'latencyRefusal' is not null loop
    v_refusals := v_refusals || to_jsonb(format('%s: %s',
      coalesce(rec.d->>'question', rec.d->>'decisionId'), rec.d->>'latencyRefusal')::text);
  end loop;

  if (v_read->>'decisionCount')::int = 0 then
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'decisionCount', v_read->'decisionCount',
      'closedCount', v_read->'closedCount',
      'openCount', v_read->'openCount',
      'undatedCount', v_read->'undatedCount',
      'unmeasurableCloseCount', v_read->'unmeasurableCloseCount',
      'averageLatencyDays', v_read->'averageLatencyDays',
      'maxLatencyDays', v_read->'maxLatencyDays',
      'criticalPathExposureDays', v_read->'criticalPathExposureDays',
      'criticalPathDecisionCount', v_read->'criticalPathDecisionCount',
      'measuredPopulation', (v_read->>'decisionCount')::int
                            - (v_read->>'undatedCount')::int
                            - (v_read->>'unmeasurableCloseCount')::int);
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_decision_latency',
    'Decision latency (spec §54: DL = DecisionDate - DecisionRequiredDate) per decision on this case, plus the critical-path exposure of the overdue ones (spec I.30). A decision is CLOSED at the instant an option was selected; one recorded approved or rejected with no selection has no recorded closing instant anywhere in the schema and is EXCLUDED and named rather than dated today. Decisions with no required date are excluded and named. Criticality is read from P6''s imported total float at or below the published threshold — Sync does not recompute the network. The average is withheld below the published floor of closed decisions, and an empty decision register refuses outright rather than reporting zero days.',
    jsonb_build_object(
      'decisionCount', v_read->'decisionCount',
      'closedCount', v_read->'closedCount',
      'openCount', v_read->'openCount',
      'scheduleActivityCount', v_read->'scheduleActivityCount',
      'activitiesWithFloat', v_read->'activitiesWithFloat',
      'policyDigest', md5(sync_decision_latency_policy()::text),
      -- Counts cannot see a decision that was DECIDED or re-dated. The digest
      -- is the content of every decision the figure was computed over, so a
      -- published latency goes stale the moment one of them moves.
      'decisionDigest', coalesce((
        select md5(string_agg(dec.id::text
                              || '~' || coalesce(dec.decision_required_date::text, '-')
                              || '~' || coalesce(dec.selected_at::text, '-')
                              || '~' || coalesce(dec.approval_status, '-'),
                              '|' order by dec.created_at, dec.id))
          from decisions dec
         where dec.organization_id = c.organization_id
           and dec.development_case_id = c.id), 'empty'),
      'linkDigest', coalesce((
        select md5(string_agg(l.decision_id::text || '~' || l.shutdown_task_id::text
                              || '~' || coalesce(t.total_float_hours::text, '-'),
                              '|' order by l.decision_id, l.shutdown_task_id))
          from decision_schedule_links l
          join shutdown_tasks t on t.id = l.shutdown_task_id
         where l.development_case_id = c.id), 'empty')),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'decisions', 'id', dec.id))
                from decisions dec
               where dec.organization_id = c.organization_id
                 and dec.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_read || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_decision_latency'));
end
$$;

revoke all on function public.compute_case_decision_latency(uuid) from public, anon, service_role;
grant execute on function public.compute_case_decision_latency(uuid) to authenticated;

create or replace function public.compute_case_decision_debt(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_read jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  rec record;
begin
  if v_org is null then return jsonb_build_object('error', 'forbidden'); end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording decision debt publishes what this project is expected to lose to decisions nobody has taken. Spec §70 forbids an AI or system identity from making that determination. The AI may read get_case_decision_debt, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording decision debt requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'development case not found'); end if;

  v_read := get_case_decision_debt(c.id);
  if v_read ? 'error' then return v_read; end if;

  if v_read->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'refusal');
  end if;
  if v_read->>'criticalPathCapableRefusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'criticalPathCapableRefusal');
  end if;
  for rec in select value as d from jsonb_array_elements(v_read->'decisions')
              where value->>'debtRefusal' is not null loop
    v_refusals := v_refusals || to_jsonb(format('%s: unquantified — no delay exposure stated.',
      coalesce(rec.d->>'question', rec.d->>'decisionId'))::text);
  end loop;

  if v_read->>'totalDebt' is null then
    -- REFUSAL-FIRST. Nothing outstanding, nothing quantified, or mixed
    -- currencies: none of these is a debt of zero.
    v_outputs := null;
  else
    v_outputs := jsonb_build_object(
      'totalDebt', v_read->'totalDebt',
      'currency', v_read->'currency',
      'outstandingCount', v_read->'outstandingCount',
      'quantifiedCount', v_read->'quantifiedCount',
      'unquantifiedCount', v_read->'unquantifiedCount',
      'criticalPathCapableCount', v_read->'criticalPathCapableCount',
      'coveragePercent', round(((v_read->>'quantifiedCount')::numeric
                                / nullif((v_read->>'outstandingCount')::numeric, 0)) * 100, 1));
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_decision_debt',
    'Decision debt (spec II.17: DecisionDebt = FutureExpectedImpact x ProbabilityOfDelay) over the decisions still outstanding on this case. Both factors are STATED on a per-decision exposure record with a basis, never derived: no probability of delay exists anywhere in the schema, and decisions.decision_value is the value at stake IN the decision rather than the cost of not taking it. An outstanding decision with no stated exposure is named as unquantified and excluded from the total. A case with nothing outstanding, a case where nothing has been quantified, and a case whose exposures are stated in more than one currency all REFUSE rather than reporting a debt of zero.',
    jsonb_build_object(
      'outstandingCount', v_read->'outstandingCount',
      'quantifiedCount', v_read->'quantifiedCount',
      'criticalPathCapableCount', v_read->'criticalPathCapableCount',
      'exposureDigest', coalesce((
        select md5(string_agg(x.decision_id::text || '~' || x.expected_impact::text
                              || '~' || x.probability_of_delay::text || '~' || x.currency,
                              '|' order by x.decision_id))
          from (select distinct on (e.decision_id) e.*
                  from decision_delay_exposures e
                 where e.development_case_id = c.id
                 order by e.decision_id, e.recorded_at desc) x), 'empty'),
      'openDecisionDigest', coalesce((
        select md5(string_agg(dec.id::text || '~' || coalesce(dec.decision_required_date::text, '-'),
                              '|' order by dec.id))
          from decisions dec
         where dec.organization_id = c.organization_id
           and dec.development_case_id = c.id
           and dec.selected_at is null
           and coalesce(dec.approval_status, 'pending') = 'pending'), 'empty')),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'decision_delay_exposures', 'id', e.id))
                from decision_delay_exposures e
               where e.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_read || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_decision_debt'));
end
$$;

revoke all on function public.compute_case_decision_debt(uuid) from public, anon, service_role;
grant execute on function public.compute_case_decision_debt(uuid) to authenticated;
