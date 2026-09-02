-- ============================================================================
-- Sync Develop Slice 5D — the event bus and its five named events
--   D11.26  event bus with five named events (spec III.§71–78)
--
-- §71–78 names them exactly: GateRequirementChanged, RiskThresholdExceeded,
-- ScheduleUpdated, WorkPackageBlocked, CommissioningTestFailed.
--
-- ── RULING 5D-R1 — WHY THIS IS A THIRD STORE, AND WHAT IT IS NOT ──────────
--
-- The overlap map's audit ruling (index 16) is absolute: `audit_events` is the
-- ONE audit ledger and a parallel one is forbidden (AGENTS invariant 8).
-- `security_events` is the boundary ledger — admissions and violations. So a
-- third table needs an argument, and here it is, in three parts.
--
--   (a) THREE OF THE FIVE EVENTS HAVE NO ACTOR. `audit_events` is shaped
--       who/what/when/why/previous/new. RiskThresholdExceeded is a threshold
--       being crossed; WorkPackageBlocked is a row entering a state;
--       CommissioningTestFailed is a result. Writing them into the audit
--       ledger would fill the column named `actor` with the identity of
--       whoever happened to hold the session, and would make the ledger's own
--       row count a mixture of "what a person did" and "what became true".
--
--   (b) A BUS NEEDS A MUTABLE DELIVERY STATE. An event is worthless until
--       something CONSUMED it, and a consumer's outcome changes: raised →
--       answered. `audit_events` refuses UPDATE for every caller and must go
--       on refusing it. Putting delivery state on an audit row would mean
--       weakening that guard, which this repository refuses by name.
--
--   (c) SO THE SPLIT IS: an APPEND-ONLY event body (`develop_events`) plus a
--       MUTABLE delivery record (`develop_event_deliveries`). The event body
--       carries NO fact the source row does not already carry — it carries
--       the identity of the row that changed and the classification. It is
--       not a second account of what happened, and `emit_develop_event` still
--       writes the audit row, so the immutable ledger records that the bus
--       fired and against which previous/new state.
--
-- ── RULING 5D-R2 — EMITTED BY THE ACT, NEVER BY A POLLER ─────────────────
--
-- The register's own mechanism ruling: Postgres triggers, not Kafka. Every
-- one of the five is an AFTER trigger on the table whose change IS the event:
--
--   GateRequirementChanged    stage_gate_criteria   INSERT/UPDATE/DELETE
--   RiskThresholdExceeded     risk_indicator_observations  INSERT/UPDATE
--   ScheduleUpdated           shutdown_tasks        INSERT/UPDATE/DELETE
--   WorkPackageBlocked        work_orders           INSERT/UPDATE
--   CommissioningTestFailed   acceptance_tests      INSERT/UPDATE
--
-- UPDATE and DELETE coverage is not decoration. `risk_indicator_observations`
-- carries no append-only guard, so an observation EDITED into critical is a
-- crossing an INSERT-only emitter misses entirely; and deleting a scheduled
-- activity restates every forecast computed before it exactly as moving one
-- does. Both were missing from the first draft and both are now covered. The
-- two that stay INSERT/UPDATE are states, not acts: deleting a work order or
-- an acceptance test removes the subject rather than dodging the event, and
-- the emitted event is append-only and survives it.
--
-- A sweep that noticed these afterwards would date every event at the sweep
-- and would miss any state that opened and closed between two runs — which is
-- precisely the state a threshold crossing occupies.
--
-- ── RULING 5D-R3 — THE BUS IS CASE-SCOPED, AND THAT IS A BOUNDARY ────────
--
-- `development_case_id` is NOT NULL. Four of the five source tables are
-- platform-wide (a work order, an acceptance test, a schedule activity, a risk
-- indicator exist with or without a development case), and each one is
-- resolved to its cases through the CANONICAL join that already exists:
--
--   stage_gate_criteria → stage_gates.framework_id → development_cases.framework_id
--   risk_indicator_observations → risk_indicators.risk_id → risks.development_case_id
--   shutdown_tasks.wbs_element_id → project_wbs_elements.development_case_id
--   work_orders.asset_id → development_case_assets.development_case_id
--   acceptance_tests.project_id → development_cases.capital_project_id
--
-- An act touching no development case emits NOTHING, and that is a stated
-- scope boundary rather than a silent drop: this is Sync Develop's bus, an
-- operational work order that no capital project is watching is not its
-- business, and the smoke proves both directions of that boundary. An act
-- touching N cases emits N events — one per case, because the consumer's
-- answer is a case-level act.
--
-- ── RULING 5D-R4 — ONE EVENT PER ACT PER CASE PER TRANSACTION ────────────
--
-- `ingest_schedule_batch` writes many activities in one transaction. One
-- event per row would make "the schedule changed" arrive fifty times and get
-- cleared in bulk, which is how a receipt register dies (5C-R12's lesson,
-- one level up). So each event name declares its DEDUPE SCOPE in the rule
-- table — `case` for ScheduleUpdated (the schedule changed, once) and
-- `subject` for the other four (this criterion, this indicator, this work
-- order, this test) — and the collapse is enforced by a UNIQUE INDEX on
-- (case, dedupe key, transaction id) rather than by a check-then-insert that
-- two concurrent writers would both pass.
--
-- ── RULING 5D-R5 — AN EMITTER WITH NO SUBSCRIBER IS THEATRE ──────────────
--
-- The consumer is `dispatch_develop_event`, it runs SYNCHRONOUSLY inside the
-- emitting transaction, and it ACTS: it applies the deterministic rule set in
-- `sync_develop_event_rules()` and writes one delivery carrying the
-- consequence that rule assigns. The rule set is not a lookup — the
-- RiskThresholdExceeded rule reads the observed state out of the payload and
-- assigns `blocking` for `critical` and `attention` for `warning`.
--
-- And the delivery is not a notice: an UNANSWERED BLOCKING CONSEQUENCE IS A
-- GATE OBLIGATION, appended to `case_gate_outstanding_obligations` and
-- REFUSED OVER by `enforce_gate_review_outstanding_obligations` — the exact
-- machinery Slice 5B put an un-dispositioned frontline recommendation on. A
-- commissioning test that failed and that nobody has answered stops the gate
-- review at the persistence boundary, not on a screen.
--
-- ── RULING 5D-R6 — §70 ON THE ANSWER, AND §42 WHERE THERE IS AN ACTOR ────
--
-- No AI or system identity answers a consequence: `enforce_frontline_judgement_is_human`
-- is bound to `answered_by` on INSERT and UPDATE, so the refusal holds for
-- every writer including the service key. Slice 5B shipped a §70 trigger that
-- failed OPEN on a misnamed column argument; that wall now RAISES when its
-- argument names a column the table does not have, and the smoke asserts the
-- binding by name.
--
-- §42 applies where there IS an actor: the person whose act emitted a
-- BLOCKING event does not also record that it has been dealt with (5C-R14 at
-- the smallest scale it has). Where the act had no `auth.uid()` behind it —
-- an import, a service write — there is nobody to segregate from and the rule
-- is silent rather than inventing a conflict.
--
-- ── RULING 5D-R7 — AN EMPTY EVENT LIST IS A SENTENCE, NOT A ZERO ─────────
--
-- `get_case_develop_events` never says "0 events". The bus has an INSTALL
-- DATE; before it, nothing was emitted because nothing was listening, and an
-- empty list on a five-year-old case means only that. The read states which
-- of the two it is and carries the install instant so the reader can tell.
--
-- Canonical reuse: development_cases, stage_gate_criteria, stage_gates,
-- risk_indicators, risk_indicator_observations, risks, shutdown_tasks,
-- project_wbs_elements, work_orders, development_case_assets,
-- acceptance_tests, capital_projects, audit_events, security_events,
-- app_current_org(), enforce_frontline_judgement_is_human,
-- record_frontline_service_write, case_gate_outstanding_obligations,
-- enforce_gate_review_outstanding_obligations.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The vocabulary. Five names, verbatim from §71–78.
-- ---------------------------------------------------------------------------
create or replace function public.sync_develop_event_names()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'GateRequirementChanged',
    'RiskThresholdExceeded',
    'ScheduleUpdated',
    'WorkPackageBlocked',
    'CommissioningTestFailed'
  ]::text[];
$$;

revoke all on function public.sync_develop_event_names() from public, anon;
grant execute on function public.sync_develop_event_names() to authenticated, service_role;

comment on function public.sync_develop_event_names() is
  'D11.26 / spec III.§71-78: the five named events, verbatim. The CHECK on develop_events.event_name reads this array, so a sixth name cannot be emitted without changing the spec vocabulary in one place.';

-- The RULE SET the consumer applies. Data, not code — the D11.28
-- rules-as-data posture, so what the bus DOES with an event is readable
-- without reading a function body.
create or replace function public.sync_develop_event_rules()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'GateRequirementChanged', jsonb_build_object(
      'source', 'stage_gate_criteria',
      'dedupeScope', 'subject',
      'ruleKey', 'gate_requirement_changed_confirm_evidence',
      -- The rule reads the CASE's history, not a lookup table. A criterion
      -- added to a gate this case has never been reviewed at changes nothing
      -- that was decided — nobody assessed anything against the old wording,
      -- because there was no old wording and no assessment. A criterion that
      -- moves under a gate the case has ALREADY passed or been blocked at is
      -- the opposite: a decision now stands on a requirement that has changed.
      -- Blocking every criterion edit would put a gate blocker on every
      -- framework being authored, and a rule set that blocks on setup is a
      -- rule set people learn to clear in bulk.
      'consequence', 'by_prior_review',
      'obligation', 'A gate requirement on this case''s framework changed. The readiness evidence answering it was assessed against the previous wording, so somebody has to say whether it still answers the new one.'),
    'RiskThresholdExceeded', jsonb_build_object(
      'source', 'risk_indicator_observations',
      'dedupeScope', 'subject',
      -- Severity comes from the OBSERVED STATE in the payload, not from this
      -- table: a warning and a critical are not the same obligation, and a
      -- rule set that flattened them would either block on every warning or
      -- let a critical pass as an FYI.
      'ruleKey', 'risk_threshold_exceeded_reassess',
      'consequence', 'by_payload_state',
      'obligation', 'A risk indicator on this case crossed its threshold. ISO 31000 puts the reassessment on a person, and the indicator moving is not the reassessment.'),
    'ScheduleUpdated', jsonb_build_object(
      'source', 'shutdown_tasks',
      'dedupeScope', 'case',
      'ruleKey', 'schedule_updated_review_forecast',
      'consequence', 'attention',
      'obligation', 'The schedule under this case moved. Every forecast, float and P80 computed before it was computed over the previous dates.'),
    'WorkPackageBlocked', jsonb_build_object(
      'source', 'work_orders',
      'dedupeScope', 'subject',
      'ruleKey', 'work_package_blocked_remove_constraint',
      'consequence', 'attention',
      'obligation', 'Work on an asset in this case''s scope is blocked. Spec workflow 4: a schedule activity being due does not make work executable, and the constraint is removed by a person.'),
    'CommissioningTestFailed', jsonb_build_object(
      'source', 'acceptance_tests',
      'dedupeScope', 'subject',
      'ruleKey', 'commissioning_test_failed_disposition',
      'consequence', 'blocking',
      'obligation', 'A commissioning or acceptance test on this case''s project FAILED. Nothing downstream of it — readiness, handover, the operations acceptance — may be read as unaffected until somebody says what happened to it.')
  );
$$;

revoke all on function public.sync_develop_event_rules() from public, anon;
grant execute on function public.sync_develop_event_rules() to authenticated, service_role;

comment on function public.sync_develop_event_rules() is
  'D11.26 ruling 5D-R5: what the ONE consumer DOES with each of the five events — the dedupe scope, the rule key, the consequence class and the sentence stating the obligation. Rules as data (D11.28), so the bus''s behaviour is readable without reading a function body. `by_payload_state` on RiskThresholdExceeded means the rule reads the observed state (critical blocks, warning asks); `by_prior_review` on GateRequirementChanged means it reads whether this case has ALREADY been reviewed at that gate — a criterion added during framework authoring blocks nothing, one that moves under a recorded decision does.';

-- ── RULING 5D-R19 — THE COLLAPSE MAY NEVER SWALLOW AN ESCALATION ─────────
--
-- 5D-R4 collapses repeated acts inside one transaction so a fifty-activity
-- batch is one "the schedule changed". The FIRST DRAFT OF THAT COLLAPSE KEYED
-- ON (case, dedupe_key, txid) ALONE, and two of the five rules assign a
-- consequence that depends on state which can change INSIDE the transaction:
--
--   `by_payload_state`  normal → warning → critical on one indicator in one
--                       batch: the warning arrived first, took the key, and
--                       the CRITICAL was discarded by `do nothing`. The
--                       indicator was critical; the bus said warning; the
--                       consequence was `attention`; no gate was blocked; and
--                       because the audit insert sits after the collapse,
--                       audit_events had no record of the critical either.
--
--   `by_prior_review`   a criterion authored, a review recorded and the
--                       criterion reworded in one transaction: the authoring
--                       (attention, nobody had reviewed anything yet) took the
--                       key and the reclassification was swallowed.
--
-- So the collapse key carries the CONSEQUENCE CLASS. A fifty-activity batch is
-- still ONE ScheduleUpdated because every one of them classifies `attention`;
-- a run of criticals is still one event; but an ESCALATION inside a
-- transaction is a different class and therefore a different event, with its
-- own delivery and its own gate blocker.
--
-- And the class is computed ONCE, by the ONE classifier below, which both the
-- emitter (for the key) and the consumer (for the delivery) read. A second
-- implementation of "what does this event mean" is how the key and the
-- delivery come to disagree, so `dispatch_develop_event` RAISES rather than
-- proceeds if the two ever differ.
create or replace function public.sync_develop_event_consequence(
  p_event_name text,
  p_case_id uuid,
  p_payload jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule jsonb := sync_develop_event_rules() -> p_event_name;
  v_consequence text;
  v_gate text;
begin
  if v_rule is null then
    return null;
  end if;
  v_consequence := v_rule ->> 'consequence';
  if v_consequence = 'by_payload_state' then
    -- The rule reading the observation, not a lookup table flattening two
    -- different obligations into one.
    return case when coalesce(p_payload ->> 'state', '') = 'critical'
      then 'blocking' else 'attention' end;
  elsif v_consequence = 'by_prior_review' then
    -- The rule reading the case's OWN history: a requirement that moved under
    -- a gate this case has already been reviewed at is a decision standing on
    -- changed ground; one added to a gate nobody has reviewed is not.
    --
    -- The cast is GUARDED. A payload whose gateId is not an integer must not
    -- turn a classification into a hard error that no later caller can clear:
    -- the event is append-only, so an uncastable value would poison every read
    -- of this case permanently.
    v_gate := p_payload ->> 'gateId';
    if v_gate is null or v_gate !~ '^-?[0-9]+$' then
      return 'attention';
    end if;
    return case when exists (
      select 1 from stage_gate_reviews r
       where r.development_case_id = p_case_id
         and r.gate_id = v_gate::bigint)
      then 'blocking' else 'attention' end;
  end if;
  return v_consequence;
end
$$;

revoke all on function public.sync_develop_event_consequence(text, uuid, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.sync_develop_event_consequence(text, uuid, jsonb) is
  'D11.26 ruling 5D-R19: THE ONE classifier. Applies sync_develop_event_rules() to one event and returns `blocking` or `attention`. The emitter reads it for the collapse key and the consumer reads it for the delivery, so the two cannot disagree — and dispatch_develop_event raises if they ever do. Not granted to any client role: an event is classified by the act, never by a caller.';

-- ---------------------------------------------------------------------------
-- 2. The event body. APPEND-ONLY.
-- ---------------------------------------------------------------------------
create table if not exists public.develop_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Ruling 5D-R3. NOT NULL: an event with no case is not this bus's business.
  development_case_id uuid not null references development_cases(id) on delete cascade,
  event_name text not null check (event_name = any (sync_develop_event_names())),
  -- WHICH ROW CHANGED — a pointer, never a copy of the decision (5D-R1c).
  source_table text not null check (btrim(source_table) <> ''),
  source_ref text not null check (btrim(source_ref) <> ''),
  -- What a human should see in a list, resolved at emission because the source
  -- row can move on. Snapshotted for legibility, not for authority.
  subject_label text not null check (btrim(subject_label) <> ''),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- The actor when the act had one. NULL is a real answer: an import, a
  -- service write, a cascade. §42 is silent where this is null (5D-R6).
  emitted_by uuid references auth.users(id),
  -- Ruling 5D-R4: the collapse key, enforced by an index rather than by a
  -- check-then-insert two writers would both pass.
  dedupe_key text not null check (btrim(dedupe_key) <> ''),
  -- Ruling 5D-R19: the class sync_develop_event_consequence() assigned, part
  -- of the collapse key so an escalation inside a transaction is never
  -- swallowed by the first act that took the key.
  consequence_class text not null check (consequence_class in ('blocking', 'attention')),
  emitted_tx bigint not null,
  emitted_at timestamptz not null default now(),
  unique (development_case_id, dedupe_key, consequence_class, emitted_tx)
  -- RULING 5D-R20 — the (organization_id, development_case_id) pair must
  -- AGREE, and that agreement is enforced in enforce_develop_event_append_only
  -- rather than here: a CHECK cannot hold a subquery. Both readers filter on
  -- organization_id alone, so a mismatched pair is a row one tenant files
  -- against another tenant's case and then reads, answers and clears as its
  -- own. Proven reachable before it was closed.
);

create index if not exists idx_develop_events_case
  on develop_events(organization_id, development_case_id, emitted_at desc);
create index if not exists idx_develop_events_name
  on develop_events(organization_id, event_name, emitted_at desc);

alter table public.develop_events enable row level security;
drop policy if exists develop_events_read on public.develop_events;
create policy develop_events_read on public.develop_events
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: the only insert site is emit_develop_event.

comment on table public.develop_events is
  'D11.26 / spec III.§71-78: the event bus body, append-only. Ruling 5D-R1 — this is NOT a third audit ledger: it carries the identity of the row that changed and the classification, never a second account of the decision, and emit_develop_event still writes the audit_events row.';
comment on column public.develop_events.development_case_id is
  'Ruling 5D-R3: the bus is case-scoped and this is NOT NULL. An act touching no development case emits nothing, which is a declared boundary — the smoke proves both directions.';
comment on column public.develop_events.emitted_tx is
  'Ruling 5D-R4: txid_current() at emission. One event per act per case per CONSEQUENCE CLASS per transaction, enforced by the unique index rather than by a check-then-insert. The class is in the key by ruling 5D-R19: without it, a warning that arrived first in a batch discarded the critical that followed it on the same indicator.';
comment on column public.develop_events.consequence_class is
  'Ruling 5D-R19: what sync_develop_event_consequence() — the ONE classifier — made of this event, recorded on the event so the collapse key can carry it and so the delivery cannot silently disagree with it.';

-- ---------------------------------------------------------------------------
-- 3. The delivery. THE MUTABLE HALF (5D-R1b) — and the consumer's act.
-- ---------------------------------------------------------------------------
create table if not exists public.develop_event_deliveries (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  event_id bigint not null references develop_events(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- WHO consumed it. One subscription ships; the column exists so a second
  -- consumer is an insert rather than a schema change.
  subscription_key text not null check (btrim(subscription_key) <> ''),
  rule_key text not null check (btrim(rule_key) <> ''),
  consequence text not null check (consequence in ('blocking', 'attention')),
  obligation text not null check (length(btrim(obligation)) >= 20),
  -- THE ANSWER. Three columns that move together or not at all.
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  answer_note text,
  delivered_at timestamptz not null default now(),
  -- At most once per subscription. A second delivery of the same event is a
  -- second thing to clear.
  unique (event_id, subscription_key),
  -- TWO EQUALITIES, NOT ONE (the 5C thread_change_receipts lesson, verbatim).
  -- Folding these into a single equality against a conjunction lets
  -- `answered_at = now(), answered_by = null` through, and `answered_by` is
  -- exactly what the §70 wall reads — a NULL actor is an early return in it.
  constraint develop_event_delivery_answer_actor
    check ((answered_at is null) = (answered_by is null)),
  constraint develop_event_delivery_answer_note
    check ((answered_at is null) = (answer_note is null)),
  constraint develop_event_delivery_answer_said_something
    check (answer_note is null or length(btrim(answer_note)) >= 20)
);

create index if not exists idx_develop_event_deliveries_open
  on develop_event_deliveries(organization_id, development_case_id, consequence)
  where answered_at is null;
create index if not exists idx_develop_event_deliveries_event
  on develop_event_deliveries(event_id);

alter table public.develop_event_deliveries enable row level security;
drop policy if exists develop_event_deliveries_read on public.develop_event_deliveries;
create policy develop_event_deliveries_read on public.develop_event_deliveries
  for select to authenticated using (organization_id = app_current_org());

comment on table public.develop_event_deliveries is
  'D11.26 ruling 5D-R5: what the ONE consumer DID with an event. An unanswered `blocking` row is a gate obligation — appended to case_gate_outstanding_obligations and refused over by enforce_gate_review_outstanding_obligations, the same machinery a breached permit condition and an un-dispositioned frontline recommendation ride.';

-- §70, bound to the answer (5D-R6). The wall raises on a mis-binding rather
-- than returning NULL, so a later rename cannot switch it off silently.
drop trigger if exists trg_develop_event_answerer_is_human on public.develop_event_deliveries;
create trigger trg_develop_event_answerer_is_human
  before insert or update on public.develop_event_deliveries
  for each row execute function public.enforce_frontline_judgement_is_human(
    'answered_by', 'answer an event consequence on a development case');

-- ---------------------------------------------------------------------------
-- 4. The guards. Append-only body; delivery answerable once, through one door.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_develop_event_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'develop_events is the record of every threshold crossing, failed test and blocked package this product noticed. Truncating it erases all of them in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'An emitted event is not editable. What was emitted, over which row and when is the fact a later reader has — a correction is a NEW event, never a rewrite of the old one.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    -- Mid-cascade: the declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    raise exception
      'An emitted event is not deleted. Deleting it makes an event nobody answered indistinguishable from one that never happened.'
      using errcode = 'insufficient_privilege';
  end if;
  -- INSERT. One door.
  if coalesce(current_setting('app.develop_event_write', true), '') <> 'granted' then
    raise exception
      'An event is emitted through emit_develop_event, which the five source triggers share as their ONE insert site. A row inserted directly claims something happened that no act caused, and the append-only guard then makes that claim permanent — so it is refused here rather than regretted later.'
      using errcode = 'insufficient_privilege';
  end if;
  -- RULING 5D-R20. The org and the case must AGREE, checked at the wall so it
  -- holds for every writer including the emitter itself. Both readers filter
  -- on organization_id alone: a row filed under tenant B against tenant A's
  -- case is read, answered and cleared by tenant B while it blocks tenant A's
  -- gate. Proven reachable through the emitter before this check existed.
  if not exists (select 1 from development_cases c
                  where c.id = new.development_case_id
                    and c.organization_id = new.organization_id) then
    raise exception
      'This event names organization % and development case %, and that case does not belong to that organization. An event is filed against the tenant whose case it concerns — the readers scope on the organization alone, so a mismatched pair is a permanent, undeletable gate blocker on one tenant that another tenant reads and answers.',
      new.organization_id, new.development_case_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_develop_event_append_only()
  from public, anon, authenticated;

drop trigger if exists trg_develop_event_append_only on public.develop_events;
create trigger trg_develop_event_append_only
  before insert or update or delete on public.develop_events
  for each row execute function public.enforce_develop_event_append_only();

drop trigger if exists trg_develop_event_no_truncate on public.develop_events;
create trigger trg_develop_event_no_truncate
  before truncate on public.develop_events
  for each statement execute function public.enforce_develop_event_append_only();

revoke truncate on table public.develop_events from anon, authenticated, service_role;

create or replace function public.enforce_develop_event_delivery_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.develop_event_delivery_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'develop_event_deliveries holds every unanswered consequence this product is blocking a gate on. Truncating it clears all of them in one statement — the exact bulk-clear a consequence register dies of. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    raise exception
      'A delivered consequence is answered, never deleted. Deleting it removes a gate blocker without anybody having said anything about it.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if v_marker <> 'granted' then
      raise exception
        'A consequence is delivered by dispatch_develop_event, the ONE consumer. A row inserted directly is a gate blocker nobody''s act produced.'
        using errcode = 'insufficient_privilege';
    end if;
    -- A delivery is BORN unanswered. Inserting one pre-answered would let a
    -- writer create and discharge a blocker in the same statement.
    if new.answered_at is not null or new.answered_by is not null then
      raise exception
        'A consequence is delivered UNANSWERED and answered afterwards by a named person. A row that arrives already answered records an answer nobody gave.'
        using errcode = 'check_violation';
    end if;
    if auth.uid() is null then
      perform record_frontline_service_write(new.organization_id,
        format('Event consequence (%s) on case %s', new.rule_key, new.development_case_id),
        tg_op,
        'A consequence delivered with no auth.uid() behind it was produced outside a signed-in act. The delivery row is undeletable, so this security event is the only place the circumstances of the write survive.');
    end if;
    return new;
  end if;

  -- UPDATE. The ONLY permitted transition is unanswered → answered, through
  -- answer_develop_event_consequence.
  if v_marker <> 'granted' then
    raise exception
      'A delivered consequence is answered through answer_develop_event_consequence, which checks the role, refuses the AI-operator identity by name and records the answer to the audit ledger. A direct UPDATE clears a gate blocker with none of that.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.answered_at is not null then
    raise exception
      'This consequence was already answered on %. A consequence is answered once; a new act on the same subject emits a new event.',
      old.answered_at
      using errcode = 'check_violation';
  end if;
  if new.event_id is distinct from old.event_id
     or new.consequence is distinct from old.consequence
     or new.rule_key is distinct from old.rule_key
     or new.development_case_id is distinct from old.development_case_id
     or new.organization_id is distinct from old.organization_id then
    raise exception
      'Answering a consequence does not re-point it, re-classify it or move it to another case. Downgrading `blocking` to `attention` is how a gate blocker disappears without being answered.'
      using errcode = 'check_violation';
  end if;
  if new.answered_by is not null
     and not exists (select 1 from user_profiles p
                      where p.id = new.answered_by
                        and p.organization_id = new.organization_id) then
    raise exception
      'The person answering a consequence belongs to the organization whose gate it blocks. A name from another tenant is a name this one cannot ask about.'
      using errcode = 'check_violation';
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Event consequence (%s) on case %s', new.rule_key, new.development_case_id),
      tg_op,
      'A gate-blocking consequence was answered with no auth.uid() behind it.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_develop_event_delivery_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_develop_event_delivery_integrity on public.develop_event_deliveries;
create trigger trg_develop_event_delivery_integrity
  before insert or update or delete on public.develop_event_deliveries
  for each row execute function public.enforce_develop_event_delivery_integrity();

drop trigger if exists trg_develop_event_delivery_no_truncate on public.develop_event_deliveries;
create trigger trg_develop_event_delivery_no_truncate
  before truncate on public.develop_event_deliveries
  for each statement execute function public.enforce_develop_event_delivery_integrity();

revoke truncate on table public.develop_event_deliveries from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. THE CONSUMER (ruling 5D-R5). Synchronous, inside the emitting
--    transaction. It applies the rule set and writes what it decided.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_develop_event(p_event_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  e develop_events%rowtype;
  v_rule jsonb;
  v_consequence text;
  v_obligation text;
  v_state text;
  v_id bigint;
begin
  select * into e from develop_events where id = p_event_id;
  if not found then
    return null;
  end if;
  v_rule := sync_develop_event_rules() -> e.event_name;
  if v_rule is null then
    -- A named event with no rule would be an emitter with no subscriber, and
    -- that is the thing this slice refuses to ship. Loud, not silent.
    raise exception
      'event % has no consumer rule in sync_develop_event_rules(). An emitted event nothing consumes is theatre; add the rule or do not emit the event.',
      e.event_name
      using errcode = 'check_violation';
  end if;

  -- RULING 5D-R19. THE ONE CLASSIFIER, applied here to produce the delivery
  -- and applied by the emitter to produce the collapse key. Two
  -- implementations of "what does this event mean" is how the key and the
  -- delivery come to disagree, so there is one — and if the answer it gives
  -- here is not the answer recorded on the event, that is a real divergence
  -- and this RAISES rather than picking one of them.
  v_consequence := sync_develop_event_consequence(e.event_name, e.development_case_id, e.payload);
  if v_consequence is null or v_consequence is distinct from e.consequence_class then
    raise exception
      'event % classified as % at emission and as % at delivery. The collapse key carries the class, so a disagreement means the two would file different rows for the same act — refused rather than resolved by preferring one of them.',
      e.id, e.consequence_class, coalesce(v_consequence, '(no rule)')
      using errcode = 'check_violation';
  end if;

  v_obligation := format('%s (%s)', v_rule ->> 'obligation', e.subject_label);

  insert into develop_event_deliveries
    (organization_id, event_id, development_case_id, subscription_key,
     rule_key, consequence, obligation)
  values
    (e.organization_id, e.id, e.development_case_id,
     'sync-develop-case-consequences',
     v_rule ->> 'ruleKey', v_consequence, v_obligation)
  on conflict (event_id, subscription_key) do nothing
  returning id into v_id;

  return v_id;
end
$$;

-- service_role IS REVOKED TOO, and that is the point of this line. Supabase's
-- ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function to anon,
-- authenticated AND service_role, so revoking three of four leaves the door
-- open to every edge function in this repository — all of which hold the
-- service key. The five source triggers are SECURITY DEFINER owned by
-- postgres and need no grant to call this, so nothing legitimate loses a path.
revoke all on function public.dispatch_develop_event(bigint)
  from public, anon, authenticated, service_role;

comment on function public.dispatch_develop_event(bigint) is
  'D11.26 ruling 5D-R5: the ONE consumer. Runs synchronously inside the emitting transaction, applies the ONE classifier (sync_develop_event_consequence) and writes the delivery whose unanswered `blocking` rows become gate obligations. Raises on an event with no rule, and raises if its classification disagrees with the class recorded on the event at emission: an emitter with no subscriber, and a consumer that quietly reclassifies, are both failures this slice exists to avoid. Executable by no client role, service_role included.';

-- ---------------------------------------------------------------------------
-- 6. THE ONE EMITTER (ruling 5D-R2). Every source trigger goes through here.
-- ---------------------------------------------------------------------------
create or replace function public.emit_develop_event(
  p_org uuid,
  p_case_id uuid,
  p_event_name text,
  p_source_ref text,
  p_subject_label text,
  p_payload jsonb,
  p_previous_state jsonb,
  p_new_state jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule jsonb := sync_develop_event_rules() -> p_event_name;
  v_dedupe text;
  v_class text;
  v_id bigint;
  v_delivery bigint;
begin
  if p_org is null or p_case_id is null or v_rule is null then
    return null;
  end if;
  -- Ruling 5D-R4. `case` collapses every activity in one batch into ONE
  -- "the schedule changed"; `subject` keeps this criterion apart from that one.
  v_dedupe := case when (v_rule ->> 'dedupeScope') = 'case'
    then p_event_name
    else p_event_name || ':' || p_source_ref end;

  -- RULING 5D-R19. The class is computed ONCE, here, by the ONE classifier,
  -- and it is part of the collapse key: a warning and a critical on the same
  -- indicator in the same transaction are not the same obligation, and the
  -- first one through must not take the key from the second.
  v_class := sync_develop_event_consequence(p_event_name, p_case_id, coalesce(p_payload, '{}'::jsonb));
  if v_class is null then
    return null;
  end if;

  perform set_config('app.develop_event_write', 'granted', true);
  insert into develop_events
    (organization_id, development_case_id, event_name, source_table, source_ref,
     subject_label, payload, emitted_by, dedupe_key, consequence_class, emitted_tx)
  values
    (p_org, p_case_id, p_event_name, v_rule ->> 'source', p_source_ref,
     left(coalesce(nullif(btrim(p_subject_label), ''), p_source_ref), 300),
     coalesce(p_payload, '{}'::jsonb), auth.uid(), v_dedupe, v_class, txid_current())
  on conflict (development_case_id, dedupe_key, consequence_class, emitted_tx) do nothing
  returning id into v_id;
  perform set_config('app.develop_event_write', '', true);

  -- Collapsed by 5D-R4. The first emission of THIS CLASS in this transaction
  -- already carries the act; a second delivery would be a second thing to
  -- clear. An escalation is a different class and lands as its own event.
  if v_id is null then
    return null;
  end if;

  -- THE AUDIT ROW (5D-R1c). The immutable ledger records that the bus fired,
  -- over which previous and new state — so the bus is never the only account
  -- of anything.
  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (p_org, 'develop_event',
    coalesce((select role from user_profiles where id = auth.uid()), 'system'),
    jsonb_build_object('event_id', v_id, 'event_name', p_event_name,
      'case_id', p_case_id, 'source_table', v_rule ->> 'source',
      'source_ref', p_source_ref, 'subject', p_subject_label),
    p_previous_state, p_new_state);

  perform set_config('app.develop_event_delivery_write', 'granted', true);
  v_delivery := dispatch_develop_event(v_id);
  perform set_config('app.develop_event_delivery_write', '', true);

  return v_id;
end
$$;

-- service_role IS REVOKED TOO (ruling 5D-R20). This function is the only way
-- a non-superuser can put a row in develop_events — the append-only guard
-- demands the GUC that only this function sets — so the grant is load-bearing,
-- and Supabase's default privileges hand EXECUTE to service_role on every new
-- function. Left open, every edge function in this repository could
-- manufacture a permanent, undeletable, gate-blocking consequence naming a
-- source row that does not exist, on any case in any organization. Proven
-- reachable over PostgREST before this line existed. The five source triggers
-- are SECURITY DEFINER owned by postgres and need no grant.
revoke all on function public.emit_develop_event(uuid, uuid, text, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.emit_develop_event(uuid, uuid, text, text, text, jsonb, jsonb, jsonb) is
  'D11.26 ruling 5D-R2/R4/R19/R20: the ONE insert site for develop_events. Classifies the event once through sync_develop_event_consequence, collapses to one event per act per case per CONSEQUENCE CLASS per transaction through the unique index, writes the audit_events row carrying previous_state/new_state, and dispatches to the consumer synchronously. Executable by no client role, service_role included: the append-only guard makes this the only door into the ledger, so the grant is the door.';

-- ---------------------------------------------------------------------------
-- 7. THE FIVE EMITTERS, on the acts that cause them.
-- ---------------------------------------------------------------------------

-- (1) GateRequirementChanged — spec §7's GateRequirement is a row of
--     stage_gate_criteria (overlap ruling: no parallel requirement table).
--     Only GATE-SCOPED criteria emit: a stage-scoped catalogue row belongs to
--     no framework and therefore to no case, and org provisioning clones
--     hundreds of them.
create or replace function public.emit_gate_requirement_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_row stage_gate_criteria%rowtype;
  v_prev jsonb;
  v_new jsonb;
  v_verb text;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if v_row.gate_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and new.criterion is not distinct from old.criterion
     and new.is_mandatory is not distinct from old.is_mandatory
     and new.category is not distinct from old.category
     and new.evidence_type is not distinct from old.evidence_type
     and new.minimum_confidence is not distinct from old.minimum_confidence
     and new.source_authority is not distinct from old.source_authority then
    -- A sort-order nudge is not a requirement change. Emitting on it would
    -- put a gate blocker on the case for a cosmetic edit.
    return new;
  end if;
  v_verb := lower(tg_op);
  v_prev := case when tg_op = 'INSERT' then null
    else jsonb_build_object('criterion', old.criterion, 'mandatory', old.is_mandatory,
      'sourceAuthority', old.source_authority) end;
  v_new := case when tg_op = 'DELETE' then null
    else jsonb_build_object('criterion', new.criterion, 'mandatory', new.is_mandatory,
      'sourceAuthority', new.source_authority) end;

  for r in
    select c.id case_id, c.organization_id, g.name gate_name
      from stage_gates g
      join development_cases c on c.framework_id = g.framework_id
     where g.id = v_row.gate_id
       and c.organization_id = v_row.organization_id
       and c.status in ('active', 'on_hold', 'sanctioned')
  loop
    perform emit_develop_event(
      r.organization_id, r.case_id, 'GateRequirementChanged',
      v_row.id::text,
      format('%s on gate %s was %sd', left(v_row.criterion, 120), r.gate_name, v_verb),
      jsonb_build_object('operation', v_verb, 'gateId', v_row.gate_id,
        'gateName', r.gate_name, 'mandatory', v_row.is_mandatory,
        'criterion', v_row.criterion),
      v_prev, v_new);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.emit_gate_requirement_changed() from public, anon, authenticated;

drop trigger if exists trg_emit_gate_requirement_changed on public.stage_gate_criteria;
create trigger trg_emit_gate_requirement_changed
  after insert or update or delete on public.stage_gate_criteria
  for each row execute function public.emit_gate_requirement_changed();

-- (2) RiskThresholdExceeded — a CROSSING, not a level. The observation is
--     compared with the previous observation on the same indicator, so a
--     string of criticals emits once and a recovery followed by a relapse
--     emits again. Reading `risk_indicators.current_state` instead would make
--     the event depend on whether the indicator row was updated before or
--     after the observation landed.
create or replace function public.emit_risk_threshold_exceeded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  i risk_indicators%rowtype;
  rk risks%rowtype;
  v_prev_state text;
  v_rank int;
  v_prev_rank int;
begin
  if new.state not in ('warning', 'critical') then
    return new;
  end if;
  select * into i from risk_indicators where id = new.indicator_id;
  if not found or i.risk_id is null then
    return new;
  end if;
  select * into rk from risks where id = i.risk_id;
  if not found or rk.development_case_id is null then
    return new;
  end if;

  select o.state into v_prev_state
    from risk_indicator_observations o
   where o.indicator_id = new.indicator_id and o.id <> new.id
   order by o.observed_at desc, o.recorded_at desc, o.id desc
   limit 1;

  v_rank := case new.state when 'critical' then 2 when 'warning' then 1 else 0 end;
  v_prev_rank := case coalesce(v_prev_state, 'normal')
    when 'critical' then 2 when 'warning' then 1 else 0 end;
  -- ON UPDATE the row's OWN previous state is also a prior reading, and the
  -- higher of the two is what this observation has to beat to be a crossing.
  -- This emitter was INSERT-only in the first draft while the observation
  -- ledger carries no append-only guard, so an observation edited from warning
  -- to critical moved the indicator and emitted nothing — the one emitter of
  -- the five that did not cover UPDATE, on the one table where the edit is not
  -- refused.
  if tg_op = 'UPDATE' then
    if new.state is not distinct from old.state
       and new.value is not distinct from old.value then
      return new;
    end if;
    if (case coalesce(old.state, 'normal')
          when 'critical' then 2 when 'warning' then 1 else 0 end) > v_prev_rank then
      v_prev_rank := case coalesce(old.state, 'normal')
        when 'critical' then 2 when 'warning' then 1 else 0 end;
      v_prev_state := old.state;
    end if;
  end if;
  if v_rank <= v_prev_rank then
    return new;
  end if;

  perform emit_develop_event(
    rk.organization_id, rk.development_case_id, 'RiskThresholdExceeded',
    i.id::text,
    format('%s moved %s → %s at %s', left(i.name, 120),
      coalesce(v_prev_state, 'no prior observation'), new.state, new.value),
    jsonb_build_object('state', new.state, 'previousState', v_prev_state,
      'value', new.value, 'unit', i.unit, 'indicatorId', i.id,
      'riskId', rk.id, 'dataQuality', new.data_quality),
    jsonb_build_object('state', coalesce(v_prev_state, 'unobserved')),
    jsonb_build_object('state', new.state, 'value', new.value));
  return new;
end
$$;

revoke all on function public.emit_risk_threshold_exceeded() from public, anon, authenticated;

drop trigger if exists trg_emit_risk_threshold_exceeded on public.risk_indicator_observations;
create trigger trg_emit_risk_threshold_exceeded
  after insert or update on public.risk_indicator_observations
  for each row execute function public.emit_risk_threshold_exceeded();

-- (3) ScheduleUpdated — the ScheduleActivity object is `shutdown_tasks`
--     (D5.28 ruling). Case scope arrives through the WBS element a human
--     resolved (set_schedule_activity_wbs); an activity with no authorized
--     scope belongs to no case and emits nothing, which is what D5.02 already
--     reports about it.
create or replace function public.emit_schedule_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w project_wbs_elements%rowtype;
  v_row shutdown_tasks%rowtype;
  v_wbs uuid;
begin
  -- DELETE IS A SCHEDULE CHANGE. Removing a scheduled activity restates every
  -- forecast, float and P80 computed before it just as surely as moving one
  -- does — that is the obligation sentence this rule carries, verbatim — and
  -- an emitter that covers INSERT and UPDATE but not DELETE lets the act be
  -- dodged by deletion, which is the repository's stated coverage rule.
  v_row := case when tg_op = 'DELETE' then old else new end;
  v_wbs := coalesce(v_row.wbs_element_id,
                    case when tg_op = 'UPDATE' then old.wbs_element_id end);
  if v_wbs is null then
    return v_row;
  end if;
  if tg_op = 'UPDATE'
     and new.duration_hours is not distinct from old.duration_hours
     and new.planned_start is not distinct from old.planned_start
     and new.planned_finish is not distinct from old.planned_finish
     and new.total_float_hours is not distinct from old.total_float_hours
     and new.wbs_element_id is not distinct from old.wbs_element_id then
    return new;
  end if;
  select * into w from project_wbs_elements where id = v_wbs;
  if not found then
    return v_row;
  end if;
  perform emit_develop_event(
    w.organization_id, w.development_case_id, 'ScheduleUpdated',
    v_row.id::text,
    format('activity %s under WBS %s%s',
      left(coalesce(v_row.label, v_row.task_key), 100), w.wbs_code,
      case when tg_op = 'DELETE' then ' was REMOVED from the schedule' else '' end),
    jsonb_build_object('activityId', v_row.id, 'taskKey', v_row.task_key,
      'wbsCode', w.wbs_code, 'origin', v_row.origin,
      'operation', lower(tg_op),
      'plannedStart', v_row.planned_start, 'plannedFinish', v_row.planned_finish,
      'durationHours', v_row.duration_hours),
    case when tg_op in ('UPDATE', 'DELETE') then jsonb_build_object(
      'plannedStart', old.planned_start, 'plannedFinish', old.planned_finish,
      'durationHours', old.duration_hours, 'totalFloatHours', old.total_float_hours) end,
    case when tg_op = 'DELETE' then null else jsonb_build_object(
      'plannedStart', new.planned_start,
      'plannedFinish', new.planned_finish, 'durationHours', new.duration_hours,
      'totalFloatHours', new.total_float_hours) end);
  return v_row;
end
$$;

revoke all on function public.emit_schedule_updated() from public, anon, authenticated;

drop trigger if exists trg_emit_schedule_updated on public.shutdown_tasks;
create trigger trg_emit_schedule_updated
  after insert or update or delete on public.shutdown_tasks
  for each row execute function public.emit_schedule_updated();

-- (4) WorkPackageBlocked — `work_orders` remains the work identity (overlap
--     ruling 8), and its `blocked` status is the state §27's WorkPackage
--     would carry if it existed. Case scope through development_case_assets:
--     the asset is on this case's scope, so work on it stalling is this
--     case's problem. A blocked work order on an asset no case is watching
--     emits nothing (5D-R3).
create or replace function public.emit_work_package_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(new.status, '') <> 'blocked' then
    return new;
  end if;
  if new.asset_id is null then
    return new;
  end if;
  -- "Already blocked, do not re-emit" — but ONLY when the previous row would
  -- actually have emitted. The first draft tested `old.status = 'blocked'`
  -- alone, and suppressed on a row whose first pass emitted NOTHING because
  -- its scope was unresolvable: a work order created already blocked with no
  -- asset, then linked to an asset, never emitted at all. Create-then-link is
  -- an ordinary sequence, and one of the five named events was silently
  -- missing from it with nothing anywhere recording the miss.
  if tg_op = 'UPDATE'
     and coalesce(old.status, '') = 'blocked'
     and old.asset_id is not null
     and old.asset_id is not distinct from new.asset_id then
    return new;
  end if;
  for r in
    select d.development_case_id case_id, d.organization_id, a.name asset_name
      from development_case_assets d
      join assets a on a.id = d.asset_id
      join development_cases c on c.id = d.development_case_id
     where d.asset_id = new.asset_id
       and d.organization_id = new.organization_id
       and c.status in ('active', 'on_hold', 'sanctioned')
  loop
    perform emit_develop_event(
      r.organization_id, r.case_id, 'WorkPackageBlocked',
      new.id::text,
      format('%s on %s', left(new.title, 120), r.asset_name),
      jsonb_build_object('workOrderId', new.id, 'woNumber', new.wo_number,
        'assetId', new.asset_id, 'priority', new.priority,
        'safetyFlag', new.safety_flag),
      case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
      jsonb_build_object('status', new.status));
  end loop;
  return new;
end
$$;

revoke all on function public.emit_work_package_blocked() from public, anon, authenticated;

drop trigger if exists trg_emit_work_package_blocked on public.work_orders;
create trigger trg_emit_work_package_blocked
  after insert or update on public.work_orders
  for each row execute function public.emit_work_package_blocked();

-- (5) CommissioningTestFailed — `acceptance_tests` is the commissioning
--     result store (D8.06 ruling: decomposition ABOVE it, never beside it).
--     Case scope through development_cases.capital_project_id, the reference
--     D1.04 built rather than duplicating the project record.
create or replace function public.emit_commissioning_test_failed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(new.outcome, '') <> 'fail' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.outcome, '') = 'fail' then
    return new;
  end if;
  for r in
    select c.id case_id, c.organization_id, c.title
      from development_cases c
     where c.capital_project_id = new.project_id
       and c.organization_id = new.organization_id
       and c.status in ('active', 'on_hold', 'sanctioned')
  loop
    perform emit_develop_event(
      r.organization_id, r.case_id, 'CommissioningTestFailed',
      new.id::text,
      format('%s (%s) FAILED', new.test_ref, replace(new.test_stage, '_', ' ')),
      jsonb_build_object('testId', new.id, 'testRef', new.test_ref,
        'testStage', new.test_stage, 'punchItemsOpen', new.punch_items_open,
        'witnessedByOwner', new.witnessed_by_owner),
      case when tg_op = 'UPDATE' then jsonb_build_object('outcome', old.outcome) end,
      jsonb_build_object('outcome', new.outcome,
        'punchItemsOpen', new.punch_items_open));
  end loop;
  return new;
end
$$;

revoke all on function public.emit_commissioning_test_failed() from public, anon, authenticated;

drop trigger if exists trg_emit_commissioning_test_failed on public.acceptance_tests;
create trigger trg_emit_commissioning_test_failed
  after insert or update on public.acceptance_tests
  for each row execute function public.emit_commissioning_test_failed();

-- ---------------------------------------------------------------------------
-- 8. Answering a consequence. The ONE door (§70 + §42, ruling 5D-R6).
-- ---------------------------------------------------------------------------
create or replace function public.answer_develop_event_consequence(
  p_delivery_id bigint,
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
  d develop_event_deliveries%rowtype;
  e develop_events%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_open int;
  v_blocking int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 FIRST, so the specific refusal is reachable rather than shadowed by
  -- the role list.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot answer an event consequence (spec §70). "We have looked at the failed commissioning test and here is what it means" is a determination about the physical world, and an unanswered blocking consequence stops a gate — so answering one is deciding a gate is passable.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'answering an event consequence requires a role on this project');
  end if;
  select * into d from develop_event_deliveries where id = p_delivery_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'event consequence not found');
  end if;
  if d.answered_at is not null then
    return jsonb_build_object('error',
      format('this consequence was already answered on %s — a consequence is answered once, and a new act on the same subject emits a new event', d.answered_at));
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error',
      'say what you did about it (20 characters minimum). A consequence cleared with no note records that somebody clicked, which is not the same as the thing having been dealt with.');
  end if;

  select * into e from develop_events where id = d.event_id;
  -- §42 WHERE THERE IS AN ACTOR (5D-R6). Silent where the act had none.
  if d.consequence = 'blocking' and e.emitted_by is not null and e.emitted_by = auth.uid() then
    return jsonb_build_object('error',
      'your act emitted this event, so you do not also record that its consequence has been dealt with (spec §42). Ask the person who owns the downstream decision.');
  end if;

  perform set_config('app.develop_event_delivery_write', 'granted', true);
  update develop_event_deliveries
     set answered_by = auth.uid(),
         answered_at = now(),
         answer_note = v_note
   where id = d.id;
  perform set_config('app.develop_event_delivery_write', '', true);

  select count(*)::int,
         count(*) filter (where consequence = 'blocking')::int
    into v_open, v_blocking
    from develop_event_deliveries
   where organization_id = v_org
     and development_case_id = d.development_case_id
     and answered_at is null;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'develop_event_consequence', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', d.development_case_id, 'delivery_id', d.id,
      'event_id', d.event_id, 'event_name', e.event_name,
      'rule_key', d.rule_key, 'consequence', d.consequence,
      'subject', e.subject_label),
    jsonb_build_object('answered', false),
    jsonb_build_object('answered', true, 'answered_by', auth.uid(), 'note', v_note));

  return jsonb_build_object(
    'delivery_id', d.id,
    'eventName', e.event_name,
    'consequence', d.consequence,
    'openOnCase', v_open,
    'blockingOnCase', v_blocking,
    'note', case when d.consequence = 'blocking'
      then 'Answered. This consequence no longer blocks a gate review on this case — the gate wall reads the same rows this screen does.'
      else 'Answered. This one never blocked a gate; it asked somebody to look, and now there is a name and a sentence saying they did.' end);
end
$$;

revoke all on function public.answer_develop_event_consequence(bigint, text) from public, anon;
grant execute on function public.answer_develop_event_consequence(bigint, text)
  to authenticated, service_role;

comment on function public.answer_develop_event_consequence(bigint, text) is
  'D11.26 ruling 5D-R6: the ONE door that answers a delivered consequence. Refuses the AI-operator identity by name (§70), refuses the person whose act emitted a BLOCKING event (§42), demands a note, and records previous/new state to the audit ledger.';

-- ---------------------------------------------------------------------------
-- 9. The reads.
-- ---------------------------------------------------------------------------
create or replace function public.sync_develop_event_bus_installed_at()
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select timestamptz '2026-12-07 09:00:00+00';
$$;

revoke all on function public.sync_develop_event_bus_installed_at() from public, anon;
grant execute on function public.sync_develop_event_bus_installed_at() to authenticated, service_role;

comment on function public.sync_develop_event_bus_installed_at() is
  'D11.26 ruling 5D-R7: the instant the bus started listening. An empty event list on a case older than this means nothing was listening, not that nothing happened — and the read says which.';

create or replace function public.get_case_develop_events(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_events jsonb;
  v_total int;
  v_open int;
  v_blocking int;
  v_names jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'eventId', e.id,
      'eventName', e.event_name,
      'sourceTable', e.source_table,
      'sourceRef', e.source_ref,
      'subject', e.subject_label,
      'payload', e.payload,
      'emittedAt', e.emitted_at,
      'emittedBy', e.emitted_by,
      'deliveryId', d.id,
      'ruleKey', d.rule_key,
      'consequence', d.consequence,
      'obligation', d.obligation,
      'answeredAt', d.answered_at,
      'answeredBy', d.answered_by,
      'answerNote', d.answer_note,
      'answeredByName', u.full_name)
      order by e.emitted_at desc, e.id desc), '[]'::jsonb)
    into v_events
    from develop_events e
    left join develop_event_deliveries d
      on d.event_id = e.id and d.subscription_key = 'sync-develop-case-consequences'
    left join user_profiles u on u.id = d.answered_by
   where e.organization_id = v_org and e.development_case_id = c.id;

  v_total := jsonb_array_length(v_events);
  select count(*)::int, count(*) filter (where consequence = 'blocking')::int
    into v_open, v_blocking
    from develop_event_deliveries
   where organization_id = v_org and development_case_id = c.id and answered_at is null;

  v_names := to_jsonb(sync_develop_event_names());

  return jsonb_build_object(
    'caseId', c.id,
    'busInstalledAt', sync_develop_event_bus_installed_at(),
    'eventNames', v_names,
    'events', v_events,
    'eventCount', v_total,
    'openCount', v_open,
    'blockingOpenCount', v_blocking,
    -- RULING 5D-R7. Never "0 events".
    -- ONE branch, not two, and both of its clauses are always reachable. An
    -- earlier draft split on whether the case predates the install instant,
    -- which made the other half unreachable on any clock sitting before that
    -- date — an unreachable sentence in the read whose whole job is to say
    -- WHICH empty this is.
    'headline', case
      when v_total = 0 then
        format('None of the FIVE acts this bus watches has happened on this case since the bus started listening (%s): no gate requirement changed, no risk indicator crossed a threshold, no schedule activity moved, no work order was blocked and no commissioning test failed. That is a statement about five specific acts over a bounded window — %s — and never a clean bill of health.',
          to_char(sync_develop_event_bus_installed_at(), 'YYYY-MM-DD'),
          case when c.created_at < sync_develop_event_bus_installed_at()
            then 'this case existed BEFORE that window opened, so nothing here says anything about what happened to it earlier'
            else 'a window that opened before this case did' end)
      when v_blocking > 0 then
        format('%s event(s) on this case; %s consequence(s) unanswered, %s of them BLOCKING a gate review until somebody speaks to them.',
          v_total, v_open, v_blocking)
      when v_open > 0 then
        format('%s event(s) on this case; %s consequence(s) unanswered. None of them blocks a gate.', v_total, v_open)
      else
        format('%s event(s) on this case, every consequence answered by a named person with a sentence.', v_total) end);
end
$$;

revoke all on function public.get_case_develop_events(uuid) from public, anon;
grant execute on function public.get_case_develop_events(uuid) to authenticated, service_role;

comment on function public.get_case_develop_events(uuid) is
  'D11.26 / spec III.§71-78: the five named events on one case with what the consumer did about each. Ruling 5D-R7 — an empty list is a SENTENCE naming which empty it is (nothing listening before the install date, or none of the five acts having happened), never "0 events".';

-- ---------------------------------------------------------------------------
-- 10. THE CONSEQUENCE (ruling 5D-R5): an unanswered BLOCKING delivery is a
--     gate obligation, on the same predicate a permit condition rides.
-- ---------------------------------------------------------------------------
-- ── RULING 5D-R18 — A GATE-LEVEL CONSEQUENCE BLOCKS ITS OWN GATE ─────────
--
-- Found by running the sibling transcripts: the first draft returned every
-- unanswered blocking consequence for the case regardless of which gate it
-- concerned, so a criterion edited on G1 blocked a review at G4. Four of the
-- five events ARE case-level — a failed commissioning test, a risk gone
-- critical, a blocked work package, a moved schedule reach the whole case, and
-- the existing obligation families (a breached permit condition, an uncarried
-- commitment) are case-level for exactly that reason. GateRequirementChanged
-- is not: it is a statement about ONE gate's requirements, and blocking a
-- different gate with it is the over-broad guard that gets an obligation
-- family disabled.
--
-- So the predicate takes the gate. With a gate, a GateRequirementChanged
-- consequence about ANOTHER gate is excluded; without one (the case-level
-- read the panel uses) every blocking consequence is returned, which is the
-- honest answer to "what is outstanding on this case".
drop function if exists public.case_event_consequence_obligations(uuid);

create or replace function public.case_event_consequence_obligations(
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
  -- THE TENANCY GATE, in the idiom of the predicate this one is appended to.
  -- It was MISSING from the first draft: this function is SECURITY DEFINER,
  -- granted to `authenticated`, takes a caller-supplied case uuid and filtered
  -- on the case alone, so any signed-in user of any tenant could read any
  -- other tenant's unanswered blocking obligations — the verbatim gate
  -- criterion text, the source table and row id, the timestamps — by uuid.
  -- Proven live before this block existed.
  --
  -- The shape is copied from case_gate_outstanding_obligations rather than
  -- invented: a NULL caller org with NO auth.uid() is the trigger/service path
  -- and must NOT be refused, because refusing it would switch the persistence
  -- wall off for exactly the writers the wall exists to catch.
  v_caller_org uuid := app_current_org();
  v_case_org uuid;
  v_out jsonb;
begin
  if auth.uid() is not null and v_caller_org is null then
    return '[]'::jsonb;
  end if;
  select organization_id into v_case_org from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and v_case_org <> v_caller_org) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'type', 'event_consequence_unanswered',
      'id', d.id,
      'name', format('%s: %s', e.event_name, d.obligation),
      'eventId', e.id,
      'eventName', e.event_name,
      'ruleKey', d.rule_key,
      'sourceTable', e.source_table,
      'sourceRef', e.source_ref,
      -- GUARDED CAST. A payload whose gateId is not an integer must not turn
      -- every gate read on this case into a hard error: the event body is
      -- append-only, so an uncastable value would be permanent and would take
      -- enforce_gate_review_outstanding_obligations down with it. A gateId
      -- that is not a gate id is reported as absent, which is what it is.
      'gateId', case when (e.payload ->> 'gateId') ~ '^-?[0-9]+$'
                     then (e.payload ->> 'gateId')::bigint end,
      -- The gate this consequence is ABOUT, so a surface can say "blocks G3"
      -- instead of implying it blocks every gate (ruling 5D-R18 is enforced
      -- here and has to be legible on the screen too).
      'gateName', e.payload ->> 'gateName',
      'emittedAt', e.emitted_at)
      order by e.emitted_at, d.id), '[]'::jsonb)
    into v_out
    from develop_event_deliveries d
    join develop_events e on e.id = d.event_id
   where d.development_case_id = p_case_id
     and d.answered_at is null
     -- ONLY `blocking`. An `attention` consequence is shown and counted and
     -- never silently promoted into a gate blocker: a rule set where every
     -- class blocks is a rule set nobody reads.
     and d.consequence = 'blocking'
     -- RULING 5D-R18.
     and (p_gate_id is null
          or e.event_name <> 'GateRequirementChanged'
          or ((e.payload ->> 'gateId') ~ '^-?[0-9]+$'
              and (e.payload ->> 'gateId')::bigint = p_gate_id));
  return v_out;
end
$$;

revoke all on function public.case_event_consequence_obligations(uuid, bigint) from public, anon;
grant execute on function public.case_event_consequence_obligations(uuid, bigint) to authenticated, service_role;

comment on function public.case_event_consequence_obligations(uuid, bigint) is
  'D11.26 rulings 5D-R5/R18: the unanswered BLOCKING event consequences on a case, in the case_gate_outstanding_obligations shape. ORG-GATED in that predicate''s own idiom — a signed-in caller of another tenant gets an empty list, while a caller with no auth.uid() (the trigger and service path the wall runs on) is admitted, because refusing that one would switch the wall off. Appended by that predicate, refused over by enforce_gate_review_outstanding_obligations, rendered by get_gate_readiness — one predicate, three consumers, so the enforced truth and the displayed truth are the same rows. With a gate, a GateRequirementChanged consequence about ANOTHER gate is excluded: that event is a statement about one gate''s requirements, and blocking a different gate with it is the over-broad guard that gets an obligation family disabled.';

-- ---------------------------------------------------------------------------
-- 11. WIRING, BY TRANSFORMATION (the 5B idiom). Both functions below are
--     edited IN PLACE from their LIVE definitions and RAISE if the anchor is
--     absent — re-typing a body here is how a slice silently reverts a fix
--     made between then and now.
-- ---------------------------------------------------------------------------
do $wire$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'case_gate_outstanding_obligations';
  if v_def is null then
    raise exception
      'case_gate_outstanding_obligations does not exist — the Slice 3C predicate this slice extends is missing, and building a second blocker evaluator instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('case_event_consequence_obligations' in v_def) > 0 then
    null;  -- already extended by a previous run of this migration
  else
    v_new := replace(v_def,
      E'\n  return v_out;\nend',
      E'\n  -- D11.26 (20261207090000, marked insertion): the unanswered BLOCKING\n  -- event consequences, read from the ONE predicate this slice adds. Appended\n  -- here rather than queried again by the readiness screen, so the screen and\n  -- the persistence wall speak from the same rows.\n  v_out := v_out || case_event_consequence_obligations(c.id, g.id);\n\n  return v_out;\nend');
    if v_new = v_def then
      raise exception
        'the `return v_out;` tail of case_gate_outstanding_obligations was not found — do not append blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$wire$;

do $wall$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_gate_review_outstanding_obligations';
  if v_def is null then
    raise exception
      'enforce_gate_review_outstanding_obligations does not exist — the Slice 3C persistence wall this slice extends is missing.'
      using errcode = 'check_violation';
  end if;
  if position('event_consequence_unanswered' in v_def) > 0 then
    null;
  else
    -- SHORT, EXACT ANCHOR. The 5B insertion re-wrapped the type list across
    -- lines, so matching the whole list would depend on its indentation
    -- surviving; the last element plus its closing paren does not.
    v_new := replace(v_def,
      $old$'frontline_review_unattended');$old$,
      $new$'frontline_review_unattended', 'event_consequence_unanswered');$new$);
    if v_new = v_def then
      raise exception
        'the refused-type list of enforce_gate_review_outstanding_obligations was not found in the shape Slice 5B left it — do not widen a wall blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    -- THE REFUSAL MUST DESCRIBE WHAT IT ACTUALLY CHECKED (4C ruling R10). A
    -- gate refused purely over a failed commissioning test must not tell the
    -- reader it refused over a permit condition.
    v_new := replace(v_new,
      $old$'or a design review the frontline never attended (spec I.18, I.19, I.25). '$old$,
      $new$'a design review the frontline never attended, '
    'or a blocking event consequence nobody has answered — a failed commissioning test, a changed gate '
    'requirement, a risk indicator gone critical (spec I.18, I.19, I.25, III.§71-78). '$new$);
    v_new := replace(v_new,
      $old$add_design_study_participant), or record an outcome $old$,
      $new$add_design_study_participant / answer_develop_event_consequence), or record an outcome $new$);
    if position('III.§71-78' in v_new) = 0
       or position('answer_develop_event_consequence' in v_new) = 0 then
      raise exception
        'the refusal message of enforce_gate_review_outstanding_obligations was not found in the shape this migration expected — a wall whose message no longer describes what it checks is worse than no message, so this fails rather than widening the type list alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$wall$;
