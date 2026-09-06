-- ============================================================================
-- Sync Develop Slice 4B — RULES OF CREDIT, REPORTING PERIODS AND PROGRESS
-- CLAIMS (D5.06, spec I.8; and the eleventh I.8 structure D5.04 was missing).
--
-- THE SENTENCE THIS FILE EXISTS FOR. Spec I.8 asks for "progress" as one of
-- eleven controls structures, and for "rules of credit" as one of the metrics.
-- Slice 4A shipped ten structures and refused the eleventh BY NAME:
--
--   'Progress has no home in this repository yet: rules of credit, physical
--    percent complete and the IFC-accepted-versus-reported check are
--    D5.19/D5.20 ... Reporting a progress baseline of zero would read as
--    "this project was baselined at 0% complete", which is a measurement
--    nobody took.'
--
-- This is that home.
--
-- ── THE CENTRAL RULE OF THIS SLICE ─────────────────────────────────────────
-- An earned-value number with no basis is worse than no number. Everything
-- downstream (EV, CPI, SPI, ES, EAC, VAC) is a function of PERCENT COMPLETE,
-- and percent complete is the single easiest number in project controls to
-- invent. So this file makes it impossible to state one directly:
--
--   * A CLAIM NAMES A STEP, NOT A PERCENT. `record_progress_claim` takes a
--     rule of credit and a step index; the percent is DERIVED server-side
--     from the rule's cumulative weights. There is no parameter through
--     which a caller can say "we are 92% done" — a claimed percent that did
--     not come from a recorded convention is exactly the fabricated number
--     this slice must not ship.
--   * THE WORK TYPE IS AN ATTRIBUTE OF THE ELEMENT, NOT OF THE CLAIM. The
--     percent is derived from the rule; the rule is resolved from the work
--     type; so if a claim could NAME its work type, the claimant would pick
--     the convention and picking the convention is picking the percent — the
--     derivation would be honest and its input a free parameter. The work
--     type is recorded on project_wbs_elements by its own §70-walled act and
--     is immutable once the element carries a claim.
--   * PROGRESS WITH NO APPLICABLE RULE IS REFUSED. Not defaulted to zero,
--     not defaulted to full credit. An element whose work type has no
--     recorded rule of credit cannot be claimed against at all, and an
--     element with no recorded WORK TYPE cannot be claimed against either;
--     both refusals name the act that fixes them.
--   * AN EMPTY CLAIM SET IS NOT ZERO PERCENT. Every read distinguishes
--     "nothing was claimed" from "nothing was earned", because those two
--     sentences justify opposite decisions.
--
-- ── TRENDING IS OVER RECORDED PERIODS, NOT RECOMPUTED HISTORY ──────────────
-- A performance trend recomputed from today's rows is not a trend: it is
-- today's answer painted along a time axis, and it moves when a past period's
-- inputs are corrected. So progress is claimed INTO A PERIOD, a period CLOSES,
-- and the trend (20261201090200) reads the calculation runs recorded while
-- each period was current. A period with no recorded run appears in the trend
-- as a gap that says so.
--
-- ── §70 ────────────────────────────────────────────────────────────────────
-- Two walls, both naming the AI-operator identity:
--
--   1. A PROGRESS CLAIM IS A PROGRESS JUDGEMENT. "This work package reached
--      the erection-complete milestone" is a statement about the physical
--      world that a person is accountable for. ai_admin is refused by name.
--   2. AUTHORING A RULE OF CREDIT IS A PROGRESS JUDGEMENT ONE LEVEL UP. A
--      rule that grants 90% credit at drawing issue determines the answer
--      before any claim is made; letting the AI identity write the convention
--      would let it set progress while never touching a claim. Refused by
--      name, for that stated reason.
--   3. SETTING THE PLANNED CURVE IS SETTING A BASELINE. Planned percent
--      complete per period IS the time-phased cost baseline that planned
--      value is read off. Governance/engineering roles only; ai_admin refused
--      by name, in the same words 20261110090000 uses for baseline approval.
--   4. OPENING AND CLOSING A PERIOD ARE THE SAME AUTHORITY. Closing fixes
--      the position the period is reported at; OPENING THE NEXT ONE MOVES
--      THE DATA DATE every metric is computed at, which un-fixes it. An
--      identity walled out of one and not the other could not fabricate a
--      position but could unilaterally erase the one a human recorded —
--      every figure on the case falls behind "no progress has been claimed
--      in period X" the instant the next period opens. Both refused by name.
--   5. NAMING AN ELEMENT'S WORK TYPE DECIDES WHICH RULE GOVERNS IT, which is
--      wall 2 one level along: the work type selects the convention, and the
--      convention decides the percent. Refused by name, immutable once the
--      element carries a claim.
--
-- ── AMBIGUITIES RESOLVED (rulings, so a later reader knows they were made) ──
--
--   RULING 1 — WHAT "PROGRESS" MEANS AS A BASELINED STRUCTURE. Spec I.8 lists
--   progress beside cost baseline, actuals and forecast, so it could mean
--   either the measurement CONVENTION or the claimed positions. A baseline
--   fixes what was agreed at approval, and what is agreed at approval is the
--   convention plus the planned curve — claims are actuals, and baselining
--   an actual is a category error. So `controls_structure_state('progress')`
--   reports rules of credit + periods carrying a planned percent, and a case
--   with claims but no rule of credit still REFUSES, because a progress
--   baseline that fixes no measurement convention fixes nothing.
--
--   RULING 2 — ONE CLAIM PER ELEMENT PER PERIOD. A period holds one position
--   per element (unique below). A second claim in the same period is refused
--   by name rather than silently superseding, because "we revised it" and
--   "we claimed twice" are different facts and the ledger must be able to
--   tell them apart. Correcting a claim means claiming again in the next
--   period, which is what a period is for.
--
--   RULING 3 — CREDIT MAY GO BACKWARDS. Rework happens; a step index lower
--   than the previous period's is ALLOWED and reported as a regression by the
--   trend rather than refused. Refusing it would push the correction into an
--   unrecorded place, which is worse than seeing it.
--
-- Canonical reuse: development_cases, project_wbs_elements (D5.01),
-- development_baselines (D5.26), audit_events, security_events. No second
-- WBS, no second baseline, no second percent-complete column anywhere.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. THE CODE VERSIONS FOR THIS SLICE'S CALCULATIONS (D11.29).
--
--    The pins land in the FIRST file of the slice, ahead of the compute
--    functions that use them, because record_calculation_run RAISES on an
--    unpinned key by design (20261130090600) — "a lineage record that cannot
--    name the code that produced it records nothing". Pinning last would
--    leave every intermediate state of this chain with a compute function
--    defined and unable to record.
--
--    The 4A keys keep the 4A version: their code did not change, and bumping
--    a version on unchanged code makes the version stop meaning anything.
--    Slice 4B's five keys carry their own.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  -- ONLY KEYS A COMPUTE FUNCTION RECORDS. The slice tests assert that every
  -- key pinned here appears in a record_calculation_run call, so a pin can
  -- never read as coverage that does not exist.
  select v from (values
    ('case_scope_growth',         'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',  'develop-controls/4A/2026-11-24'),
    ('case_earned_value',         'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',    'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',   'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',  'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',  'develop-performance/4B/2026-12-01')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. RULES OF CREDIT — how progress is earned, per work type.
-- ---------------------------------------------------------------------------
create table if not exists public.project_rules_of_credit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  rule_ref text not null check (btrim(rule_ref) <> ''),
  title text not null check (length(btrim(title)) >= 3),
  -- The work type this rule governs. A claim resolves its rule through this
  -- value, so an element whose work type has no rule cannot be claimed.
  applies_to text not null check (applies_to in
    ('engineering_deliverable','procurement_package','construction_work_package',
     'commissioning_system','fabrication_lot','owner_activity')),
  -- Only one method today, and it is NAMED rather than implied: a second
  -- method (units-installed, level of effort) must declare itself here so
  -- the credit derivation cannot silently change meaning under a claim.
  method text not null default 'milestone_weights'
    check (method in ('milestone_weights')),
  -- [{"step": "...", "weight": n}, ...] in earning order. Validated by
  -- trg_rule_of_credit for every writer: weights finite, positive, summing
  -- to exactly 100. A rule whose weights sum to 90 quietly caps every
  -- element it governs at 90% and nothing would ever say why.
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) >= 1),
  basis text not null check (length(btrim(basis)) >= 10),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, rule_ref),
  -- One rule per work type per case: two rules governing the same work type
  -- would make "which rule applies" a choice, and a choice made at claim
  -- time is a percent chosen at claim time.
  unique (development_case_id, applies_to)
);

create index if not exists idx_roc_case
  on project_rules_of_credit(organization_id, development_case_id, applies_to);

alter table public.project_rules_of_credit enable row level security;
drop policy if exists project_rules_of_credit_read on public.project_rules_of_credit;
create policy project_rules_of_credit_read on public.project_rules_of_credit
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_rules_of_credit is
  'D5.06 (spec I.8): how progress is EARNED, per work type — ordered milestone steps with weights summing to 100. A progress claim names a step; the percent is derived from this row and can never be supplied by a caller.';

-- ---------------------------------------------------------------------------
-- 1b. THE WORK TYPE LIVES ON THE ELEMENT, NOT IN THE CLAIM.
--
-- THE HOLE THIS CLOSES. A claim names a step and the percent is derived from
-- the rule — but if the CLAIM states which work type it is, then the claimer
-- picks the rule, and picking the rule picks the percent. A claimant with a
-- single-step `owner_activity` rule on the case could put a mechanical
-- design package at 100% by selecting that work type from a dropdown, and
-- nothing on the surface or on the run would say the credit came from a
-- convention written for something else. Worse, an element could be claimed
-- under one rule in March and another in April, and forty points of credit
-- would appear with the ledger reporting `regression: false`.
--
-- So the work type is an attribute OF THE WBS ELEMENT — recorded once, by
-- its own act, before any claim — and `record_progress_claim` resolves the
-- rule FROM THE ELEMENT. The header's promise ("an element whose work type
-- has no recorded rule of credit cannot be claimed against at all") is only
-- true once the element HAS a work type; until then a claim is refused by
-- name rather than credited under whichever rule the caller nominated.
--
-- EXTENDED, NOT FORKED: this is one nullable column on the canonical D5.01
-- element (20261130090000), not a second element table and not a second
-- place to say what a package is.
-- ---------------------------------------------------------------------------
alter table public.project_wbs_elements
  add column if not exists work_type text;
alter table public.project_wbs_elements
  add column if not exists work_type_basis text;
alter table public.project_wbs_elements
  add column if not exists work_type_set_by uuid references auth.users(id);
alter table public.project_wbs_elements
  add column if not exists work_type_set_at timestamptz;

alter table public.project_wbs_elements
  drop constraint if exists wbs_element_work_type_valid;
alter table public.project_wbs_elements
  add constraint wbs_element_work_type_valid check (
    work_type is null or work_type in
      ('engineering_deliverable','procurement_package','construction_work_package',
       'commissioning_system','fabrication_lot','owner_activity'));
-- A work type with no basis is a credit convention somebody preferred.
alter table public.project_wbs_elements
  drop constraint if exists wbs_element_work_type_basis;
alter table public.project_wbs_elements
  add constraint wbs_element_work_type_basis check (
    work_type is null or coalesce(length(btrim(work_type_basis)), 0) >= 10);

comment on column public.project_wbs_elements.work_type is
  'D5.06: which rule of credit governs this element. Recorded on the ELEMENT and never stated in a claim — a work type chosen at claim time is a percent chosen at claim time.';

-- ---------------------------------------------------------------------------
-- 2. REPORTING PERIODS — the time axis progress is claimed into, and the
--    planned curve planned value is read off.
-- ---------------------------------------------------------------------------
create table if not exists public.project_progress_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  period_ref text not null check (btrim(period_ref) <> ''),
  period_end date not null,
  -- THE TIME-PHASED BASELINE. Cumulative planned percent complete at this
  -- period end. NULLABLE on purpose: a period may be opened before the
  -- curve is agreed, and planned value then REFUSES BY NAME rather than
  -- reading a zero nobody planned.
  planned_percent_complete numeric,
  planned_basis text,
  planned_set_by uuid references auth.users(id),
  planned_set_at timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, period_ref),
  -- Two periods ending on the same day make "the latest period" ambiguous,
  -- and every metric in this slice is computed at the latest period.
  unique (development_case_id, period_end),
  -- FINITE OR ABSENT. `'NaN'::numeric = 'NaN'::numeric` is TRUE in Postgres
  -- and every ordinary comparison against NaN is false, so the finite test
  -- is written as an explicit two-sided bound exactly as 20261130090200 does.
  constraint period_planned_percent_finite check (
    planned_percent_complete is null
    or (planned_percent_complete > '-Infinity'::numeric
        and planned_percent_complete < 'Infinity'::numeric
        and planned_percent_complete >= 0
        and planned_percent_complete <= 100)
  ),
  -- A planned percent with no basis is a curve somebody liked.
  constraint period_planned_basis check (
    planned_percent_complete is null or coalesce(length(btrim(planned_basis)), 0) >= 10
  ),
  constraint period_closed_pair check (
    (status = 'closed') = (closed_at is not null)
  )
);

create index if not exists idx_progress_period_case
  on project_progress_periods(organization_id, development_case_id, period_end desc);

alter table public.project_progress_periods enable row level security;
drop policy if exists project_progress_periods_read on public.project_progress_periods;
create policy project_progress_periods_read on public.project_progress_periods
  for select to authenticated using (organization_id = app_current_org());

comment on table public.project_progress_periods is
  'D5.06 (spec I.8): the reporting period. Progress is claimed INTO a period and a performance run is recorded while the period is current, so trending reads recorded history rather than recomputing it. planned_percent_complete is the time-phased baseline planned value is read off.';

-- ---------------------------------------------------------------------------
-- 3. PROGRESS CLAIMS — a position, per element, per period, under a rule.
-- ---------------------------------------------------------------------------
create table if not exists public.project_progress_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  period_id uuid not null references project_progress_periods(id) on delete restrict,
  wbs_element_id uuid not null references project_wbs_elements(id) on delete restrict,
  rule_id uuid not null references project_rules_of_credit(id) on delete restrict,
  -- 1-based index into the rule's steps. The claim NAMES A STEP.
  step_index int not null check (step_index >= 1),
  step_label text not null check (btrim(step_label) <> ''),
  -- DERIVED from the rule's cumulative weights by record_progress_claim and
  -- re-derived by trg_progress_claim for every other writer. There is no
  -- path by which this column takes a caller's number.
  claimed_percent numeric not null,
  basis text not null check (length(btrim(basis)) >= 10),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz not null default now(),
  -- RULING 2: one position per element per period.
  unique (period_id, wbs_element_id),
  constraint claim_percent_finite check (
    claimed_percent > '-Infinity'::numeric and claimed_percent < 'Infinity'::numeric
    and claimed_percent >= 0 and claimed_percent <= 100
  )
);

create index if not exists idx_progress_claim_case
  on project_progress_claims(organization_id, development_case_id, period_id);
create index if not exists idx_progress_claim_element
  on project_progress_claims(wbs_element_id);

alter table public.project_progress_claims enable row level security;
drop policy if exists project_progress_claims_read on public.project_progress_claims;
create policy project_progress_claims_read on public.project_progress_claims
  for select to authenticated using (organization_id = app_current_org());

comment on table public.project_progress_claims is
  'D5.06 (spec I.8): the claimed progress position for one WBS element in one period. claimed_percent is DERIVED from the cited rule of credit — a caller cannot state a percent — and a claim with no applicable rule is refused rather than credited.';

-- ---------------------------------------------------------------------------
-- 4. THE RULE-OF-CREDIT WALL. Every writer, INSERT and UPDATE. Weights that
--    do not sum to 100 silently cap or inflate every element the rule
--    governs, and a step with no label cannot be claimed against by name.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_rule_of_credit()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.rules_of_credit_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_case_org uuid;
  v_sum numeric := 0;
  v_step jsonb;
  v_weight numeric;
  v_i int := 0;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_rules_of_credit is the convention every percent complete on this project was derived from; truncating it detaches every recorded claim from the rule that produced it, which no row-level wall can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  -- DELETE. The missing arm: a rule deleted takes the RPC's own immutability
  -- refusal with it, so the convention can be swapped for a differently
  -- weighted one under the same work type with nothing recording that it
  -- happened. Refused for a client, admitted AND AUDITED for the service
  -- path — the same posture the period and claim walls carry.
  if tg_op = 'DELETE' then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = old.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (old.organization_id, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'Rule of credit ' || old.rule_ref || ' (' || old.applies_to ||
             ') was DELETED by a service caller. A rule of credit is the '
             || 'convention every percent complete on the work it governs was '
             || 'derived from (D5.06); deleting it re-opens the "a rule is '
             || 'immutable once recorded" refusal and lets a differently '
             || 'weighted rule take its place with nothing recording the swap.');
      end if;
      return old;
    end if;
    raise exception
      'a rule of credit is not deletable — it is the convention every percent complete claimed under it was derived from, and a claim that cannot be reconstructed from its rule is a percent nobody can defend.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The §70 backstop, ahead of the fast path: RLS already denies a client
  -- any write, so this arm is what makes an RLS-BYPASSING write visible.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Rule of credit ' || new.rule_ref || ' written (' || lower(tg_op) ||
           ') by a service caller outside record_rule_of_credit. A rule of credit '
           'determines every percent complete on the work it governs (D5.06), so a '
           'rule nobody recorded moves every earned-value figure downstream of it.');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'a rule of credit is written through record_rule_of_credit — a direct write would set how progress is earned with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this rule of credit is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;
  if new.created_by is not null
     and not exists (select 1 from user_profiles up
                      where up.id = new.created_by and up.organization_id = new.organization_id) then
    raise exception
      'this rule of credit names an author who does not belong to the organization that owns it — get_case_progress resolves that id to an email address inside an RLS-bypassing read'
      using errcode = 'check_violation';
  end if;

  -- IMMUTABLE ONCE CLAIMED, FOR EVERY WRITER. record_rule_of_credit refuses
  -- a duplicate rule_ref with "a rule is immutable once recorded — claims
  -- made under it cite it", but the trigger admitted an UPDATE that rewrote
  -- `steps` under claims that already cited them: the recorded claims kept
  -- their old percents while the rule they name says something else, so a
  -- closed period's claims can no longer be reconstructed from the
  -- convention that produced them. There is no rule version and no effective
  -- date in this model, so the guarantee has to be that the row does not
  -- move. This arm refuses the SERVICE path too — it is not a "write nobody
  -- recorded", it is a rewrite of history that has already been cited.
  if tg_op = 'UPDATE'
     and (new.steps is distinct from old.steps
          or new.applies_to is distinct from old.applies_to
          or new.method is distinct from old.method)
     and exists (select 1 from project_progress_claims cl where cl.rule_id = old.id) then
    raise exception
      'rule of credit "%" has % recorded claim(s) citing it, and its steps, work type and method cannot be changed afterwards: the claims kept the percent the old weights produced, so a rewritten rule makes every one of them impossible to reconstruct from the convention it names. Record a new rule reference for the new convention.',
      old.rule_ref, (select count(*) from project_progress_claims cl where cl.rule_id = old.id)
      using errcode = 'check_violation';
  end if;

  for v_step in select jsonb_array_elements(new.steps) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_step) <> 'object'
       or coalesce(length(btrim(coalesce(v_step->>'step', ''))), 0) < 3 then
      raise exception
        'step % of rule of credit "%" has no label — a claim names a step, and an unnamed step cannot be named',
        v_i, new.rule_ref
        using errcode = 'check_violation';
    end if;
    v_weight := sync_text_as_numeric(v_step->>'weight');
    if v_weight is null then
      raise exception
        'step "%" of rule of credit "%" has no numeric weight',
        v_step->>'step', new.rule_ref
        using errcode = 'check_violation';
    end if;
    -- Explicit literal comparison: NaN is equal to NaN in Postgres and
    -- unordered against everything else, so `v_weight <= 0` is FALSE for it.
    if v_weight = 'NaN'::numeric or v_weight = 'Infinity'::numeric
       or v_weight = '-Infinity'::numeric then
      raise exception
        'step "%" of rule of credit "%" carries a weight of %, which is not a finite number',
        v_step->>'step', new.rule_ref, v_weight
        using errcode = 'check_violation';
    end if;
    if v_weight <= 0 or v_weight > 100 then
      raise exception
        'step "%" of rule of credit "%" carries a weight of %; a step earns more than nothing and no more than the whole',
        v_step->>'step', new.rule_ref, v_weight
        using errcode = 'check_violation';
    end if;
    v_sum := v_sum + v_weight;
  end loop;

  if v_sum <> 100 then
    raise exception
      'the steps of rule of credit "%" carry % percent of credit between them, not 100. A rule that does not add to the whole caps or inflates every element it governs, and nothing downstream would say why.',
      new.rule_ref, v_sum
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_rule_of_credit() from public, anon, authenticated;

drop trigger if exists trg_rule_of_credit on public.project_rules_of_credit;
create trigger trg_rule_of_credit
  before insert or update or delete on public.project_rules_of_credit
  for each row execute function public.enforce_rule_of_credit();

drop trigger if exists trg_rule_of_credit_no_truncate on public.project_rules_of_credit;
create trigger trg_rule_of_credit_no_truncate
  before truncate on public.project_rules_of_credit
  for each statement execute function public.enforce_rule_of_credit();

revoke truncate on table public.project_rules_of_credit from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. THE PERIOD WALL. INSERT and UPDATE — a period whose planned percent is
--    edited after the fact re-writes the planned value every past run was
--    measured against, and DELETE, because a period deleted takes its claims'
--    only time anchor with it.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_progress_period()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.progress_period_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_case_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_progress_periods is the time axis every recorded performance run is anchored to; truncating it strands every trend and every claim, which no row-level wall can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = old.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (old.organization_id, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'Reporting period ' || old.period_ref || ' was deleted by a service caller. '
             || 'Deleting a period removes the time anchor of every claim and every '
             || 'recorded performance run in it (D5.06).');
      end if;
      return old;
    end if;
    raise exception
      'a reporting period is not deletable — the claims and the recorded performance runs inside it are anchored to it, and a trend whose periods can disappear is not a trend.'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Reporting period ' || new.period_ref || ' written (' || lower(tg_op) ||
           ') by a service caller outside the period acts. planned_percent_complete '
           'is the time-phased baseline planned value is read off (D5.06), so a '
           'write nobody recorded changes what every past run was measured against.');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'a reporting period is written through open_progress_period, set_period_planned_progress or close_progress_period — a direct write would move the planned curve with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this reporting period is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;
  -- THE ACTOR COLUMNS ARE ORG-CHECKED TOO. The reads dereference them to
  -- user_profiles.email inside a SECURITY DEFINER, so a foreign user id
  -- stamped here by the (admitted, audited) service path would surface that
  -- person's email address to every reader of this case.
  if exists (select 1 from unnest(array[new.created_by, new.planned_set_by, new.closed_by]) a(id)
              where a.id is not null
                and not exists (select 1 from user_profiles up
                                 where up.id = a.id
                                   and up.organization_id = new.organization_id)) then
    raise exception
      'this reporting period names an actor who does not belong to the organization that owns it — the progress read resolves those ids to email addresses inside an RLS-bypassing read'
      using errcode = 'check_violation';
  end if;

  -- A CLOSED PERIOD IS HISTORY. Its planned percent is what the runs
  -- recorded in it were measured against; re-opening it or editing the curve
  -- underneath them would make recomputed history indistinguishable from
  -- recorded history, which is the property the trend depends on.
  if tg_op = 'UPDATE' and old.status = 'closed' then
    if new.status <> 'closed' then
      raise exception
        'reporting period % is closed. Re-opening it would put new claims behind performance runs already recorded against it — open the next period instead.',
        old.period_ref
        using errcode = 'check_violation';
    end if;
    if new.planned_percent_complete is distinct from old.planned_percent_complete
       or new.period_end is distinct from old.period_end then
      raise exception
        'reporting period % is closed; its planned percent and its end date are what the performance runs recorded in it were measured against and cannot be edited afterwards.',
        old.period_ref
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_progress_period() from public, anon, authenticated;

drop trigger if exists trg_progress_period on public.project_progress_periods;
create trigger trg_progress_period
  before insert or update or delete on public.project_progress_periods
  for each row execute function public.enforce_progress_period();

drop trigger if exists trg_progress_period_no_truncate on public.project_progress_periods;
create trigger trg_progress_period_no_truncate
  before truncate on public.project_progress_periods
  for each statement execute function public.enforce_progress_period();

revoke truncate on table public.project_progress_periods from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. THE CLAIM WALL — the one that matters most.
--
--    claimed_percent is RE-DERIVED here from the cited rule, for every
--    writer, on INSERT and UPDATE. A service caller that writes a claim
--    directly cannot choose the percent either: the number is a function of
--    the rule and the step, and this trigger is where that becomes true of
--    the database rather than of one RPC.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_progress_claim()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.progress_claim_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_case_org uuid;
  r project_rules_of_credit%rowtype;
  p project_progress_periods%rowtype;
  w project_wbs_elements%rowtype;
  v_cumulative numeric := 0;
  v_step jsonb;
  v_i int := 0;
  v_label text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_progress_claims is the recorded progress every earned-value figure was derived from; truncating it erases the basis of every CPI and SPI on the project in one statement.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not v_client and current_user not in ('authenticated', 'anon') then
      if exists (select 1 from organizations where id = old.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (old.organization_id, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'A progress claim was deleted by a service caller. A claim is the '
             || 'recorded basis of an earned-value figure (D5.06); progress that '
             || 'can be erased is progress that cannot be audited.');
      end if;
      return old;
    end if;
    raise exception
      'a progress claim is not deletable — it is the recorded basis of every earned-value figure computed while it stood. Claim again in the next period.'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A progress claim was written (' || lower(tg_op) || ') by a service caller '
           'outside record_progress_claim. Percent complete drives every earned-value '
           'figure on the case (D5.06), so a claim nobody recorded moves numbers '
           'people act on.');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'a progress claim is written through record_progress_claim — a direct write would state a percent complete with no recorded act and no rule of credit behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this progress claim is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;

  select * into p from project_progress_periods where id = new.period_id;
  if not found or p.development_case_id <> new.development_case_id then
    raise exception
      'a progress claim does not jump between cases: its period belongs to another development case'
      using errcode = 'check_violation';
  end if;
  if p.status = 'closed' then
    raise exception
      'reporting period % is closed; progress claimed into a closed period would change what the performance runs recorded in it were computed from.',
      p.period_ref
      using errcode = 'check_violation';
  end if;

  select * into w from project_wbs_elements where id = new.wbs_element_id;
  if w.id is null or w.development_case_id <> new.development_case_id then
    raise exception
      'a progress claim does not jump between cases: its WBS element belongs to another development case'
      using errcode = 'check_violation';
  end if;
  if new.claimed_by is not null
     and not exists (select 1 from user_profiles up
                      where up.id = new.claimed_by and up.organization_id = new.organization_id) then
    raise exception
      'this progress claim names a claimant who does not belong to the organization that owns it — get_case_progress resolves that id to an email address inside an RLS-bypassing read'
      using errcode = 'check_violation';
  end if;

  select * into r from project_rules_of_credit where id = new.rule_id;
  if not found or r.development_case_id <> new.development_case_id then
    raise exception
      'a progress claim does not jump between cases: its rule of credit belongs to another development case'
      using errcode = 'check_violation';
  end if;

  -- THE RULE IS RESOLVED FROM THE ELEMENT, FOR EVERY WRITER. This is the arm
  -- that makes "a caller cannot choose the percent" true of the database
  -- rather than of one RPC: without it, the derivation is honest and the
  -- INPUT to the derivation is a free parameter, which lands in the same
  -- place.
  if w.work_type is null then
    raise exception
      'WBS element % carries no recorded work type, so there is no way to say which rule of credit governs it. Record the work type on the element first (set_wbs_element_work_type) — resolving the rule from a work type supplied with the claim would let the claimant pick the convention, and picking the convention is picking the percent.',
      w.wbs_code
      using errcode = 'check_violation';
  end if;
  if r.applies_to <> w.work_type then
    raise exception
      'WBS element % is recorded as %, and rule of credit "%" governs %. A claim earns credit under the convention recorded for the element it is against, not under one nominated at claim time.',
      w.wbs_code, w.work_type, r.rule_ref, r.applies_to
      using errcode = 'check_violation';
  end if;

  if new.step_index > jsonb_array_length(r.steps) then
    raise exception
      'rule of credit "%" has % step(s); step % does not exist in it',
      r.rule_ref, jsonb_array_length(r.steps), new.step_index
      using errcode = 'check_violation';
  end if;

  -- THE DERIVATION. Cumulative weight up to and including the claimed step.
  for v_step in select jsonb_array_elements(r.steps) loop
    v_i := v_i + 1;
    exit when v_i > new.step_index;
    v_cumulative := v_cumulative + sync_text_as_numeric(v_step->>'weight');
    v_label := v_step->>'step';
  end loop;

  new.claimed_percent := v_cumulative;
  new.step_label := v_label;
  return new;
end
$$;

revoke all on function public.enforce_progress_claim() from public, anon, authenticated;

drop trigger if exists trg_progress_claim on public.project_progress_claims;
create trigger trg_progress_claim
  before insert or update or delete on public.project_progress_claims
  for each row execute function public.enforce_progress_claim();

drop trigger if exists trg_progress_claim_no_truncate on public.project_progress_claims;
create trigger trg_progress_claim_no_truncate
  before truncate on public.project_progress_claims
  for each statement execute function public.enforce_progress_claim();

revoke truncate on table public.project_progress_claims from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. THE ACTS.
-- ---------------------------------------------------------------------------
create or replace function public.record_rule_of_credit(
  p_case_id uuid,
  p_rule jsonb
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
  v_ref text := nullif(btrim(coalesce(p_rule->>'rule_ref','')), '');
  v_title text := nullif(btrim(coalesce(p_rule->>'title','')), '');
  v_applies text := nullif(btrim(coalesce(p_rule->>'applies_to','')), '');
  v_basis text := nullif(btrim(coalesce(p_rule->>'basis','')), '');
  v_steps jsonb := p_rule->'steps';
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 WALL 2: the convention determines the answer before any claim is
  -- made, so authoring it is a progress judgement one level up.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'a rule of credit decides how much progress every claim under it earns — recording one is a progress judgement, and the AI-operator identity cannot make one (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a rule of credit requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a rule of credit carries a reference a claim can cite (rule_ref)');
  end if;
  if v_title is null or length(v_title) < 3 then
    return jsonb_build_object('error', 'name the rule of credit');
  end if;
  if v_applies is null then
    return jsonb_build_object('error',
      'state the work type this rule governs (applies_to): engineering_deliverable, procurement_package, construction_work_package, commissioning_system, fabrication_lot or owner_activity');
  end if;
  if v_applies not in ('engineering_deliverable','procurement_package','construction_work_package',
                       'commissioning_system','fabrication_lot','owner_activity') then
    return jsonb_build_object('error',
      format('"%s" is not one of the recorded work types: engineering_deliverable, procurement_package, construction_work_package, commissioning_system, fabrication_lot, owner_activity', v_applies));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state the basis for this rule of credit — where the step weights come from (10 characters minimum). A weighting nobody can source is a percent complete nobody can defend.');
  end if;
  if v_steps is null or jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) = 0 then
    return jsonb_build_object('error',
      'a rule of credit is a list of earning steps — supply steps as [{"step":"...","weight":n}, ...]');
  end if;
  if exists (select 1 from project_rules_of_credit
             where development_case_id = c.id and rule_ref = v_ref) then
    return jsonb_build_object('error',
      format('rule of credit "%s" already exists on this case, and a rule is immutable once recorded — claims made under it cite it. Record a new rule reference.', v_ref));
  end if;
  if exists (select 1 from project_rules_of_credit
             where development_case_id = c.id and applies_to = v_applies) then
    return jsonb_build_object('error',
      format('a rule of credit for %s already exists on this case. Two rules governing one work type would make "which rule applies" a choice made at claim time, which is a percent chosen at claim time.', v_applies));
  end if;

  perform set_config('app.rules_of_credit_write', 'granted', true);
  insert into project_rules_of_credit
    (organization_id, development_case_id, rule_ref, title, applies_to, steps, basis, created_by)
  values (v_org, c.id, v_ref, v_title, v_applies, v_steps, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_rule_of_credit', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'rule_id', v_id, 'rule_ref', v_ref, 'action', 'recorded'),
    null,
    jsonb_build_object('rule_ref', v_ref, 'title', v_title, 'applies_to', v_applies,
      'stepCount', jsonb_array_length(v_steps), 'basis', v_basis));

  return jsonb_build_object('rule_id', v_id, 'rule_ref', v_ref, 'applies_to', v_applies,
    'step_count', jsonb_array_length(v_steps));
end
$$;

revoke all on function public.record_rule_of_credit(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_rule_of_credit(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.open_progress_period(
  p_case_id uuid,
  p_period jsonb
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
  v_ref text := nullif(btrim(coalesce(p_period->>'period_ref','')), '');
  v_end date := sync_text_as_date(nullif(btrim(coalesce(p_period->>'period_end','')), ''));
  v_open_ref text;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 WALL 4: OPENING THE NEXT PERIOD MOVES THE DATA DATE. Every metric in
  -- this slice is computed at the latest period, so opening one is the exact
  -- inverse of closing one — it un-fixes the progress position a human just
  -- fixed. An AI identity that could do it could not fabricate a position,
  -- but it could unilaterally erase the one a person recorded: every figure
  -- on the case falls behind "no progress has been claimed in period X"
  -- until somebody claims again. Refused in close_progress_period's own
  -- words, for the symmetric reason.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'opening a reporting period moves the data date every earned-value figure on this case is computed at, which un-fixes the progress position closing the last period fixed — a progress judgement the AI-operator identity cannot make (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'opening a reporting period requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'a reporting period carries a reference (period_ref)');
  end if;
  if v_end is null then
    return jsonb_build_object('error',
      'a reporting period ends on a date (period_end, YYYY-MM-DD) — a period with no end is not a period');
  end if;
  if exists (select 1 from project_progress_periods
             where development_case_id = c.id and period_ref = v_ref) then
    return jsonb_build_object('error',
      format('reporting period "%s" already exists on this case', v_ref));
  end if;
  if exists (select 1 from project_progress_periods
             where development_case_id = c.id and period_end = v_end) then
    return jsonb_build_object('error',
      format('a reporting period on this case already ends on %s. Two periods ending on the same day make "the latest period" ambiguous, and every metric in this slice is computed at the latest period.', v_end));
  end if;
  -- ONE OPEN PERIOD AT A TIME. Two open periods make "where does this claim
  -- go" a choice, and the earned-value suite computes at the latest period —
  -- so claims could be split across two current periods and each would
  -- report a different, defensible-looking answer.
  select period_ref into v_open_ref from project_progress_periods
   where development_case_id = c.id and status = 'open' limit 1;
  if v_open_ref is not null then
    return jsonb_build_object('error',
      format('reporting period "%s" is still open on this case. Close it before opening another — two open periods split the claims and each produces its own defensible-looking answer.', v_open_ref));
  end if;
  if exists (select 1 from project_progress_periods
             where development_case_id = c.id and period_end >= v_end) then
    return jsonb_build_object('error',
      format('this case already has a reporting period ending on or after %s. Periods run forwards: a new period behind the recorded ones would silently become "the latest".', v_end));
  end if;

  perform set_config('app.progress_period_write', 'granted', true);
  insert into project_progress_periods
    (organization_id, development_case_id, period_ref, period_end, created_by)
  values (v_org, c.id, v_ref, v_end, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_progress_period', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'period_id', v_id, 'period_ref', v_ref, 'action', 'opened'),
    null,
    jsonb_build_object('period_ref', v_ref, 'period_end', v_end, 'status', 'open',
      'planned_percent_complete', null));

  return jsonb_build_object('period_id', v_id, 'period_ref', v_ref, 'period_end', v_end,
    'status', 'open',
    'note', 'Planned value refuses on this period until its planned percent complete is set — a planned curve nobody recorded is not a zero.');
end
$$;

revoke all on function public.open_progress_period(uuid, jsonb) from public, anon, service_role;
grant execute on function public.open_progress_period(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- §70 WALL 3: the planned curve IS the time-phased cost baseline.
-- ---------------------------------------------------------------------------
create or replace function public.set_period_planned_progress(
  p_period_id uuid,
  p_percent text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p project_progress_periods%rowtype;
  v_val numeric := sync_text_as_numeric(nullif(btrim(coalesce(p_percent, '')), ''));
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_prev numeric;
  v_prev_ref text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the planned progress curve is the time-phased cost baseline planned value is read off — setting it is SETTING A BASELINE, a human accountability act the AI-operator identity cannot perform (spec §70)');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error',
      'setting the planned progress curve requires a governance or engineering role — it is the baseline every schedule performance index is measured against');
  end if;
  select * into p from project_progress_periods where id = p_period_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'reporting period not found');
  end if;
  if p.status = 'closed' then
    return jsonb_build_object('error',
      format('reporting period %s is closed; its planned percent is what the performance runs recorded in it were measured against and cannot be edited afterwards.', p.period_ref));
  end if;
  if v_val is null then
    return jsonb_build_object('error', format('"%s" is not a number', coalesce(p_percent, '')));
  end if;
  if v_val = 'NaN'::numeric or v_val = 'Infinity'::numeric or v_val = '-Infinity'::numeric then
    return jsonb_build_object('error',
      format('planned percent complete is %s; a planned value must be a finite number', v_val));
  end if;
  if v_val < 0 or v_val > 100 then
    return jsonb_build_object('error',
      format('planned percent complete is %s; a cumulative planned percent lies between 0 and 100', v_val));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state the basis for this planned percent (10 characters minimum) — a planned curve nobody can source is a schedule performance index measured against a guess');
  end if;
  -- A CUMULATIVE CURVE DOES NOT GO DOWN. Earned schedule interpolates
  -- between planned points; a curve that decreases makes the interpolation
  -- ambiguous and the resulting date meaningless.
  select planned_percent_complete, period_ref into v_prev, v_prev_ref
    from project_progress_periods
   where development_case_id = p.development_case_id
     and period_end < p.period_end
     and planned_percent_complete is not null
   order by period_end desc limit 1;
  if v_prev is not null and v_val < v_prev then
    return jsonb_build_object('error',
      format('period %s already plans %s percent complete, and this period ends later at %s percent. A cumulative planned curve does not go down — earned schedule interpolates between planned points and cannot read a curve that reverses.',
             v_prev_ref, v_prev, v_val));
  end if;

  perform set_config('app.progress_period_write', 'granted', true);
  update project_progress_periods
     set planned_percent_complete = v_val,
         planned_basis = v_basis,
         planned_set_by = auth.uid(),
         planned_set_at = now()
   where id = p.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_progress_period', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'period_id', p.id,
      'period_ref', p.period_ref, 'action', 'planned_progress_set'),
    jsonb_build_object('planned_percent_complete', p.planned_percent_complete,
      'planned_basis', p.planned_basis),
    jsonb_build_object('planned_percent_complete', v_val, 'planned_basis', v_basis));

  return jsonb_build_object('period_id', p.id, 'period_ref', p.period_ref,
    'planned_percent_complete', v_val);
end
$$;

revoke all on function public.set_period_planned_progress(uuid, text, text) from public, anon, service_role;
grant execute on function public.set_period_planned_progress(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.close_progress_period(
  p_period_id uuid,
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
  p project_progress_periods%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_runs int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'closing a reporting period fixes the progress position the period is reported at — a progress judgement the AI-operator identity cannot make (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'closing a reporting period requires a planning, engineering or governance role');
  end if;
  select * into p from project_progress_periods where id = p_period_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'reporting period not found');
  end if;
  if p.status = 'closed' then
    return jsonb_build_object('error',
      format('reporting period %s is already closed', p.period_ref));
  end if;
  if v_note is null or length(v_note) < 10 then
    return jsonb_build_object('error',
      'state what this period is closed on (10 characters minimum) — closing fixes the position everything downstream is trended from');
  end if;

  -- TRENDING IS OVER RECORDED PERIODS. A period closed with no performance
  -- run recorded in it leaves a hole in the trend for ever, because the
  -- inputs it would have been computed from are now frozen behind it. That
  -- is allowed — a period may legitimately have nothing to compute — but it
  -- is said out loud in the return, not discovered later as a gap.
  select count(*) into v_runs from calculation_runs
   where development_case_id = p.development_case_id
     and calculation_key = 'case_earned_value'
     and computed_at >= p.created_at;

  perform set_config('app.progress_period_write', 'granted', true);
  update project_progress_periods
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where id = p.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_progress_period', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'period_id', p.id,
      'period_ref', p.period_ref, 'action', 'closed', 'note', v_note),
    jsonb_build_object('status', p.status),
    jsonb_build_object('status', 'closed', 'recordedRunsInPeriod', v_runs));

  return jsonb_build_object('period_id', p.id, 'period_ref', p.period_ref, 'status', 'closed',
    'recorded_runs_in_period', v_runs,
    'note', case when v_runs = 0
      then 'No earned-value run was recorded while this period was current, so the trend will show this period as a gap rather than interpolating across it.'
      else 'The performance runs recorded while this period was current are now this period''s history and are not recomputed.' end);
end
$$;

revoke all on function public.close_progress_period(uuid, text) from public, anon, service_role;
grant execute on function public.close_progress_period(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- THE WORK-TYPE ACT. §70 WALL 5.
--
-- Naming an element's work type decides which rule of credit governs every
-- percent complete it will ever report — the same authority as authoring the
-- rule, one level along. So it carries the same wall, in the same words, and
-- it is IMMUTABLE once a claim has been made against the element: changing it
-- afterwards would re-point recorded claims at a different convention and
-- make the percents they hold impossible to reconstruct.
-- ---------------------------------------------------------------------------
create or replace function public.set_wbs_element_work_type(
  p_case_id uuid,
  p_element jsonb
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
  w project_wbs_elements%rowtype;
  v_code text := nullif(btrim(coalesce(p_element->>'wbs_code','')), '');
  v_type text := nullif(btrim(coalesce(p_element->>'work_type','')), '');
  v_basis text := nullif(btrim(coalesce(p_element->>'basis','')), '');
  v_claims int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the work type recorded on a WBS element decides which rule of credit every percent complete on it is derived from — recording one is a progress judgement one level up, and the AI-operator identity cannot make one (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a WBS element''s work type requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_code is null then
    return jsonb_build_object('error', 'name the WBS element (wbs_code)');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = c.id and wbs_code = v_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not resolve on this case — record the element first', v_code));
  end if;
  if v_type is null then
    return jsonb_build_object('error',
      'state the work type (work_type): engineering_deliverable, procurement_package, construction_work_package, commissioning_system, fabrication_lot or owner_activity');
  end if;
  if v_type not in ('engineering_deliverable','procurement_package','construction_work_package',
                    'commissioning_system','fabrication_lot','owner_activity') then
    return jsonb_build_object('error',
      format('"%s" is not one of the recorded work types: engineering_deliverable, procurement_package, construction_work_package, commissioning_system, fabrication_lot, owner_activity', v_type));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state why this element is that kind of work (basis, 10 characters minimum) — the work type selects the credit convention, and a convention nobody can source is a percent complete nobody can defend');
  end if;

  select count(*) into v_claims from project_progress_claims cl
   where cl.wbs_element_id = w.id;
  if v_claims > 0 and w.work_type is distinct from v_type then
    return jsonb_build_object('error',
      format('%s already carries %s recorded claim(s) under the %s convention. Changing the work type now would re-point those claims at a different rule of credit and make the percents they hold impossible to reconstruct.',
             v_code, v_claims, coalesce(w.work_type, 'recorded')));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  update project_wbs_elements
     set work_type = v_type, work_type_basis = v_basis,
         work_type_set_by = auth.uid(), work_type_set_at = now()
   where id = w.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_wbs_element', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'wbs_element_id', w.id, 'wbs_code', v_code,
      'action', 'work_type_set'),
    jsonb_build_object('work_type', w.work_type, 'work_type_basis', w.work_type_basis),
    jsonb_build_object('work_type', v_type, 'work_type_basis', v_basis));

  return jsonb_build_object('wbs_code', v_code, 'work_type', v_type,
    'rule_of_credit', (select r.rule_ref from project_rules_of_credit r
                        where r.development_case_id = c.id and r.applies_to = v_type),
    'note', case when exists (select 1 from project_rules_of_credit r
                               where r.development_case_id = c.id and r.applies_to = v_type)
      then 'Claims against this element will earn credit under the rule of credit recorded for this work type.'
      else format('No rule of credit is recorded for %s on this case yet, so a claim against this element will be refused by name until one is.', v_type) end);
end
$$;

revoke all on function public.set_wbs_element_work_type(uuid, jsonb) from public, anon, service_role;
grant execute on function public.set_wbs_element_work_type(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- THE CLAIM ACT. §70 WALL 1.
-- ---------------------------------------------------------------------------
create or replace function public.record_progress_claim(
  p_period_id uuid,
  p_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p project_progress_periods%rowtype;
  w project_wbs_elements%rowtype;
  r project_rules_of_credit%rowtype;
  v_wbs_code text := nullif(btrim(coalesce(p_claim->>'wbs_code','')), '');
  v_applies text := nullif(btrim(coalesce(p_claim->>'applies_to','')), '');
  v_step int;
  v_step_raw text := nullif(btrim(coalesce(p_claim->>'step_index','')), '');
  v_basis text := nullif(btrim(coalesce(p_claim->>'basis','')), '');
  v_id uuid;
  v_percent numeric;
  v_prev numeric;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 WALL 1.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'claiming progress is a statement about the physical world that a person is accountable for — the AI-operator identity cannot record a progress judgement (spec §70)');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'claiming progress requires a planning, engineering or governance role');
  end if;
  select * into p from project_progress_periods where id = p_period_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'reporting period not found');
  end if;
  if p.status = 'closed' then
    return jsonb_build_object('error',
      format('reporting period %s is closed. Progress claimed into a closed period would change what the performance runs recorded in it were computed from — open the next period.', p.period_ref));
  end if;
  if v_wbs_code is null then
    return jsonb_build_object('error',
      'name the WBS element this progress is claimed against (wbs_code) — progress with no scope behind it is a percentage of nothing');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = p.development_case_id and wbs_code = v_wbs_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not resolve on this case — record the element first', v_wbs_code));
  end if;
  -- THE WORK TYPE COMES FROM THE ELEMENT, NEVER FROM THE CLAIM. A caller
  -- that could nominate the work type could nominate the rule, and a rule
  -- nominated at claim time is a percent chosen at claim time — the exact
  -- fabrication the derivation below exists to make impossible.
  if w.work_type is null then
    return jsonb_build_object('error',
      format('WBS element %s carries no recorded work type, so there is no convention under which its progress could be earned. Record the work type on the element first (set_wbs_element_work_type) — resolving the rule from a work type supplied with the claim would let the claimant pick the convention, and picking the convention is picking the percent.', v_wbs_code));
  end if;
  if v_applies is not null and v_applies <> w.work_type then
    return jsonb_build_object('error',
      format('%s is recorded as %s, not %s. The rule of credit is resolved from the work type recorded on the element; a claim does not nominate one.',
             v_wbs_code, w.work_type, v_applies));
  end if;
  v_applies := w.work_type;

  -- THE REFUSAL THIS ROW EXISTS FOR. No applicable rule of credit → no
  -- claim. Not zero, not full credit, not a caller-supplied percent.
  select * into r from project_rules_of_credit
   where development_case_id = p.development_case_id and applies_to = v_applies;
  if not found then
    return jsonb_build_object('error',
      format('no rule of credit is recorded for %s on this case, so there is no convention under which this progress could be earned. Record the rule of credit first — a percent complete claimed without an applicable rule of credit is a number chosen, not a number earned.', v_applies));
  end if;

  if v_step_raw is null then
    return jsonb_build_object('error',
      format('name the step reached under rule of credit "%s" (step_index, 1 to %s) — a claim names a step, and the percent is derived from the rule',
             r.rule_ref, jsonb_array_length(r.steps)));
  end if;
  begin
    v_step := v_step_raw::int;
  exception when others then
    return jsonb_build_object('error', format('step_index "%s" is not a whole number', v_step_raw));
  end;
  if v_step < 1 or v_step > jsonb_array_length(r.steps) then
    return jsonb_build_object('error',
      format('rule of credit "%s" has %s step(s); step %s does not exist in it',
             r.rule_ref, jsonb_array_length(r.steps), v_step));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state the basis for this claim (10 characters minimum) — what was observed, inspected or accepted that puts this element at this step');
  end if;
  -- RULING 2.
  if exists (select 1 from project_progress_claims
             where period_id = p.id and wbs_element_id = w.id) then
    return jsonb_build_object('error',
      format('%s already carries a claimed position in period %s, and a period holds one position per element. Close this period and claim again in the next — "we revised it" and "we claimed twice" are different facts and the ledger must be able to tell them apart.',
             v_wbs_code, p.period_ref));
  end if;

  perform set_config('app.progress_claim_write', 'granted', true);
  insert into project_progress_claims
    (organization_id, development_case_id, period_id, wbs_element_id, rule_id,
     step_index, step_label, claimed_percent, basis, claimed_by)
  -- step_label and claimed_percent are placeholders: trg_progress_claim
  -- re-derives BOTH from the rule for every writer, so what is passed here
  -- is never what is stored.
  values (v_org, p.development_case_id, p.id, w.id, r.id, v_step, 'derived', 0, v_basis, auth.uid())
  returning id, claimed_percent into v_id, v_percent;

  -- RULING 3: a lower position than last period is recorded and reported,
  -- not refused. Rework is real and refusing it hides it.
  select c.claimed_percent into v_prev
    from project_progress_claims c
    join project_progress_periods pp on pp.id = c.period_id
   where c.wbs_element_id = w.id and pp.period_end < p.period_end
   order by pp.period_end desc limit 1;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_progress_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'claim_id', v_id,
      'period_ref', p.period_ref, 'wbs_code', v_wbs_code, 'rule_ref', r.rule_ref,
      'action', 'claimed'),
    case when v_prev is null then null
         else jsonb_build_object('claimed_percent', v_prev) end,
    jsonb_build_object('wbs_code', v_wbs_code, 'rule_ref', r.rule_ref,
      'step_index', v_step, 'claimed_percent', v_percent, 'basis', v_basis));

  return jsonb_build_object('claim_id', v_id, 'wbs_code', v_wbs_code,
    'work_type', w.work_type,
    'rule_ref', r.rule_ref, 'step_index', v_step, 'claimed_percent', v_percent,
    'previous_percent', v_prev,
    'regression', case when v_prev is not null and v_percent < v_prev then true else false end);
end
$$;

revoke all on function public.record_progress_claim(uuid, jsonb) from public, anon, service_role;
grant execute on function public.record_progress_claim(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. THE PROGRESS READ. Rows and positions only — no money, because every
--    money figure in this slice is computed by a compute_* function that
--    records a lineage run (D11.29), and a read that produced one would be
--    a number with no run behind it.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_progress(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_rules jsonb;
  v_periods jsonb;
  v_latest project_progress_periods%rowtype;
  v_claims jsonb;
  v_unruled jsonb;
  v_elements jsonb;
  v_untyped int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'ruleRef', r.rule_ref, 'title', r.title,
           'appliesTo', r.applies_to, 'method', r.method, 'steps', r.steps,
           'basis', r.basis, 'recordedBy', u.email, 'recordedAt', r.created_at,
           'claimCount', (select count(*) from project_progress_claims cl where cl.rule_id = r.id)
         ) order by r.applies_to), '[]'::jsonb)
    into v_rules
  from project_rules_of_credit r
  left join user_profiles u on u.id = r.created_by
  where r.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'periodRef', p.period_ref, 'periodEnd', p.period_end,
           'plannedPercentComplete', p.planned_percent_complete,
           'plannedBasis', p.planned_basis,
           'status', p.status, 'closedAt', p.closed_at,
           'claimCount', (select count(*) from project_progress_claims cl where cl.period_id = p.id)
         ) order by p.period_end), '[]'::jsonb)
    into v_periods
  from project_progress_periods p
  where p.development_case_id = c.id;

  select * into v_latest from project_progress_periods
   where development_case_id = c.id order by period_end desc limit 1;

  if v_latest.id is null then
    v_claims := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', cl.id, 'wbsElementId', cl.wbs_element_id, 'wbsCode', w.wbs_code,
             'wbsTitle', w.title, 'ruleRef', r.rule_ref, 'appliesTo', r.applies_to,
             'stepIndex', cl.step_index, 'stepLabel', cl.step_label,
             'claimedPercent', cl.claimed_percent, 'basis', cl.basis,
             'claimedBy', u.email, 'claimedAt', cl.claimed_at
           ) order by w.wbs_code), '[]'::jsonb)
      into v_claims
    from project_progress_claims cl
    join project_wbs_elements w on w.id = cl.wbs_element_id
    join project_rules_of_credit r on r.id = cl.rule_id
    left join user_profiles u on u.id = cl.claimed_by
    where cl.period_id = v_latest.id;
  end if;

  -- The work types this case can NOT claim against yet. Named, so the
  -- refusal a claim would hit is visible before anyone hits it.
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_unruled
  from unnest(array['engineering_deliverable','procurement_package','construction_work_package',
                    'commissioning_system','fabrication_lot','owner_activity']) as t
  where not exists (select 1 from project_rules_of_credit r
                     where r.development_case_id = c.id and r.applies_to = t);

  -- Every element and the work type recorded on it — including the ones with
  -- none, which is the refusal a claim would hit, shown before anyone hits
  -- it. The surface renders the work type; it never offers a choice of one.
  select coalesce(jsonb_agg(jsonb_build_object(
           'wbsCode', w.wbs_code, 'title', w.title,
           'workType', w.work_type, 'workTypeBasis', w.work_type_basis,
           'ruleRef', (select r.rule_ref from project_rules_of_credit r
                        where r.development_case_id = c.id and r.applies_to = w.work_type),
           'claimCount', (select count(*) from project_progress_claims cl
                           where cl.wbs_element_id = w.id)
         ) order by w.wbs_code), '[]'::jsonb)
    into v_elements
  from project_wbs_elements w where w.development_case_id = c.id;

  select count(*) into v_untyped
    from project_wbs_elements w
   where w.development_case_id = c.id and w.work_type is null;

  return jsonb_build_object(
    'caseId', c.id,
    'rules', v_rules,
    'periods', v_periods,
    'elements', v_elements,
    'elementsWithoutAWorkType', v_untyped,
    'latestPeriod', case when v_latest.id is null then null else jsonb_build_object(
      'id', v_latest.id, 'periodRef', v_latest.period_ref, 'periodEnd', v_latest.period_end,
      'status', v_latest.status,
      'plannedPercentComplete', v_latest.planned_percent_complete) end,
    'latestPeriodClaims', v_claims,
    'workTypesWithoutARule', v_unruled,
    -- NOTHING RECORDED IS NOT NOTHING WRONG. Both sentences exist so a
    -- caller cannot render the empty case as a complete one.
    'refusal', case
      when jsonb_array_length(v_rules) = 0 then
        'No rule of credit is recorded on this case, so no progress can be claimed at all: every claim resolves its percent from a rule, and there is none to resolve. This is not zero percent complete — it is no measurement convention.'
      when v_latest.id is null then
        'No reporting period is open on this case, so there is nowhere to claim progress into and no time axis to trend along.'
      when jsonb_array_length(v_claims) = 0 then
        format('No progress has been claimed in period %s. That is an empty claim set, not a measured zero — earned value refuses rather than reporting nothing earned.', v_latest.period_ref)
      else null end);
end
$$;

revoke all on function public.get_case_progress(uuid) from public, anon, service_role;
grant execute on function public.get_case_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. D5.04's ELEVENTH STRUCTURE. controls_structure_state is the ONE
--    predicate the capture act, the drift report and the read all consume
--    (20261130090500), so progress gets its home by REPLACING that function
--    with the progress arm filled in — not by a second predicate.
--
--    RULING 1 above decides what is captured: the CONVENTION (rules of
--    credit) plus the PLANNED CURVE (periods carrying a planned percent).
--    Claims are actuals and are deliberately outside the digest, so a
--    baselined progress structure does not drift every time somebody reports
--    a week's work.
-- ---------------------------------------------------------------------------
create or replace function public.controls_structure_state(
  p_case_id uuid,
  p_structure text
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
  v_home text;
  v_count int := 0;
  v_digest text;
  v_changed_at timestamptz;
  v_refusal text;
  v_rule_count int;
  v_planned_count int;
begin
  -- The dual-caller tenant gate (20261130090500's repair), unchanged.
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  if p_structure = 'wbs' then
    v_home := 'project_wbs_elements';
    select count(*), md5(coalesce(string_agg(
             w.wbs_code || '~' || w.title || '~' || coalesce(p.wbs_code, '-'), '|'
             order by w.wbs_code), ''))
      into v_count, v_digest
    from project_wbs_elements w
    left join project_wbs_elements p on p.id = w.parent_id
    where w.development_case_id = c.id;
    select max(w.created_at) into v_changed_at
    from project_wbs_elements w where w.development_case_id = c.id;

  elsif p_structure = 'cbs' then
    v_home := 'project_cbs_codes';
    select count(*), md5(coalesce(string_agg(
             b.cbs_code || '~' || b.cost_type, '|' order by b.cbs_code), ''))
      into v_count, v_digest
    from project_cbs_codes b where b.development_case_id = c.id;
    select max(b.created_at) into v_changed_at
    from project_cbs_codes b where b.development_case_id = c.id;

  elsif p_structure = 'obs' then
    v_home := 'project_control_accounts x organizations';
    select count(*), md5(coalesce(string_agg(
             ca.control_account_ref || '~' || ca.accountable_owner_id::text
               || '~' || coalesce(ca.org_node_id::text, '-'), '|'
             order by ca.control_account_ref), ''))
      into v_count, v_digest
    from project_control_accounts ca where ca.development_case_id = c.id;
    select max(ca.created_at) into v_changed_at
    from project_control_accounts ca where ca.development_case_id = c.id;

  elsif p_structure = 'schedule' then
    v_home := 'shutdown_tasks (P6 import door)';
    select count(*), md5(coalesce(string_agg(
             t.task_key || '~' || t.duration_hours::text || '~'
               || coalesce(t.planned_start::text, '-') || '~'
               || coalesce(t.planned_finish::text, '-') || '~' || t.origin, '|'
             order by e.event_key, t.task_key), ''))
      into v_count, v_digest
    from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id;
    select max(t.created_at) into v_changed_at
    from shutdown_tasks t
    join shutdown_events e on e.id = t.event_id
    where e.organization_id = c.organization_id and e.development_case_id = c.id;

  elsif p_structure in ('cost_baseline','commitments','actuals','forecast','contingency') then
    v_home := 'project_cost_items.' ||
      (case p_structure when 'cost_baseline' then 'baseline_cost' else p_structure end);
    select count(*), md5(coalesce(string_agg(
             ci.cost_item_ref || '~' || (case p_structure
               when 'cost_baseline' then ci.baseline_cost
               when 'commitments' then ci.commitment
               when 'actuals' then ci.actual
               when 'forecast' then ci.forecast
               else ci.contingency end)::text, '|' order by ci.cost_item_ref), ''))
      into v_count, v_digest
    from project_cost_items ci
    where ci.development_case_id = c.id
      and (case p_structure
             when 'cost_baseline' then ci.baseline_cost
             when 'commitments' then ci.commitment
             when 'actuals' then ci.actual
             when 'forecast' then ci.forecast
             else ci.contingency end) is not null;
    select max(ci.updated_at) into v_changed_at
    from project_cost_items ci where ci.development_case_id = c.id;

  elsif p_structure = 'changes' then
    v_home := 'project_scope_changes';
    select count(*), md5(coalesce(string_agg(
             sc.change_ref || '~' || sc.origin || '~' || coalesce(sc.cost_effect::text, '-'),
             '|' order by sc.change_ref), ''))
      into v_count, v_digest
    from project_scope_changes sc where sc.development_case_id = c.id;
    select max(sc.created_at) into v_changed_at
    from project_scope_changes sc where sc.development_case_id = c.id;

  elsif p_structure = 'progress' then
    -- THE ELEVENTH STRUCTURE (D5.04), home at last. What a progress baseline
    -- FIXES is the measurement convention plus the planned curve; the claims
    -- made under it are actuals and are not part of the digest.
    v_home := 'project_rules_of_credit + project_progress_periods.planned_percent_complete';
    select count(*) into v_rule_count
      from project_rules_of_credit r where r.development_case_id = c.id;
    select count(*) into v_planned_count
      from project_progress_periods p
     where p.development_case_id = c.id and p.planned_percent_complete is not null;
    if v_rule_count = 0 then
      -- Not a zero. A progress baseline that fixes no measurement convention
      -- fixes nothing, and "baselined at 0% complete" is a measurement
      -- nobody took.
      v_refusal :=
        'No rule of credit is recorded on this case, so there is no measurement convention to baseline. Capturing progress now would fix nothing: every percent complete this project ever reports is derived from a rule of credit (D5.06), and with none recorded a progress baseline would read as "baselined at 0% complete", which is a measurement nobody took.';
    elsif v_planned_count = 0 then
      -- BOTH HALVES, OR NEITHER. RULING 1 says a progress baseline fixes the
      -- convention PLUS the planned curve. A structure that reported itself
      -- complete with only the convention fixed half of what it claimed to
      -- fix, while every planned value and every SPI measured against it
      -- refused — a baseline that reads captured and measures nothing.
      v_refusal := format(
        '%s rule(s) of credit are recorded on this case and no reporting period carries a planned percent complete, so there is no planned curve to baseline. A progress baseline fixes the measurement convention AND the time-phased curve planned value is read off (D5.06); capturing only the convention would report a complete progress baseline while every planned value and every schedule performance index measured against it refuses for want of the other half.',
        v_rule_count);
    else
      -- ONE KIND OF THING. elementCount used to add rules to periods, so "5"
      -- could not tell a reader which half was present and the drift report
      -- compared it against an equally meaningless captured number. The count
      -- is the CONVENTIONS; the curve is reported beside it.
      v_count := v_rule_count;
      select md5(
        coalesce((select string_agg(r.rule_ref || '~' || r.applies_to || '~' || r.steps::text,
                                    '|' order by r.rule_ref)
                    from project_rules_of_credit r where r.development_case_id = c.id), '')
        || '#' ||
        coalesce((select string_agg(p.period_ref || '~' || p.planned_percent_complete::text,
                                    '|' order by p.period_end)
                    from project_progress_periods p
                   where p.development_case_id = c.id
                     and p.planned_percent_complete is not null), ''))
        into v_digest;
      select greatest(
               coalesce((select max(r.created_at) from project_rules_of_credit r
                          where r.development_case_id = c.id), '-infinity'::timestamptz),
               coalesce((select max(p.planned_set_at) from project_progress_periods p
                          where p.development_case_id = c.id
                            and p.planned_percent_complete is not null), '-infinity'::timestamptz))
        into v_changed_at;
      if v_changed_at = '-infinity'::timestamptz then
        v_changed_at := null;
      end if;
    end if;

  else
    return jsonb_build_object('error',
      format('"%s" is not one of the eleven controls structures (spec I.8): wbs, cbs, obs, schedule, cost_baseline, progress, commitments, actuals, forecast, changes, contingency', p_structure));
  end if;

  if v_refusal is null and v_count = 0 then
    v_refusal := format(
      'Nothing is recorded in %s for this case, so there is nothing to baseline. Capturing an empty structure would later read as "baselined with none", which cannot be told apart from "everything was deleted after baselining".',
      v_home);
  end if;

  return jsonb_build_object(
    'structure', p_structure,
    'home', v_home,
    'elementCount', case when v_refusal is null then v_count else null end,
    -- The progress structure is made of two different kinds of row, so the
    -- breakdown travels with the count rather than being summed into it.
    'componentCounts', case when p_structure <> 'progress' or v_refusal is not null then null
      else jsonb_build_object('rulesOfCredit', v_rule_count,
                              'periodsWithAPlannedPercent', v_planned_count) end,
    'digest', case when v_refusal is null then v_digest else null end,
    'latestChangeAt', case when v_refusal is null then v_changed_at else null end,
    'refusal', v_refusal);
end
$$;

-- Unchanged posture: no EXECUTE for anyone. Its only callers are the two
-- SECURITY DEFINER functions in 20261130090500, which run as the owner.
revoke all on function public.controls_structure_state(uuid, text)
  from public, anon, authenticated, service_role;
