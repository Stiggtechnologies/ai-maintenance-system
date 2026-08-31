-- ============================================================================
-- Sync Develop Slice 4D (1 of 4) — CONTINGENCY AS A LEDGER.
--
-- D5.18 (contingency ledger with authority-gated drawdown, spec II.8) and
-- D5.19 (consumption attribution by cause).
--
-- THE SPEC'S SENTENCE, II.8: "Not an invisible slush fund. Contingency:
-- original amount, basis, risk event, drawdown, approving authority,
-- remaining. '$18M consumed: $7M scope maturation, $4M market escalation,
-- $3M construction productivity, $4M realized risk.'"
--
-- THIS IS THE FIRST FEATURE IN SYNC DEVELOP THAT SPENDS A BUDGET. Everything
-- before it recorded, diagnosed or forecast; a drawdown MOVES MONEY. So the
-- posture is harder than anywhere else in the slice family, and each hardening
-- is written here as the rule it enforces:
--
--   R1. ABSENCE OF DELEGATION REFUSES, IT DOES NOT PASS.
--       `enforce_authority_limit` returns NEW when an organization has adopted
--       no ladder for the approver's role — "the organization has not
--       delegated in amounts yet" — and that is the RIGHT posture for
--       approving a maintenance recommendation, where the alternative is
--       blocking every customer who has not yet configured a delegation
--       instrument. It is the WRONG posture for spending a contingency fund:
--       "nobody has said how much you may spend" cannot mean "spend what you
--       like". Here, no adopted `contingency_drawdown` ladder for the
--       approver's role REFUSES BY NAME. Same store, same selection rule,
--       opposite default, stated rather than inherited.
--
--   R2. A NULL CEILING IS NOT AN INFINITE ONE. `authority_limits.max_commitment_usd`
--       is nullable and its documented meaning is "this dimension is not
--       limited for this role". Read literally against a fund, that turns an
--       unfinished delegation row into unlimited spending authority. A
--       contingency ladder whose money ceiling is null therefore refuses:
--       authority to spend cannot be VERIFIED, which is a different fact from
--       authority being unlimited.
--
--   R3. THE BALANCE CANNOT GO NEGATIVE, AND THE REFUSAL IS THE POINT. A
--       drawdown larger than what remains is refused naming the remainder. The
--       ledger column is `check (balance_after >= 0)` as well, so even a
--       service caller writing the ledger directly cannot record an overdrawn
--       fund.
--
--   R4. NON-FINITE AND NON-POSITIVE AMOUNTS ARE REFUSED AT EVERY DOOR.
--       'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres and NaN passes
--       every inequality vacuously, so `amount > 0` alone admits it. Refused
--       at the column, and again in the RPC before any balance arithmetic.
--
--   R5. §70 ON THE LEDGER, NOT ONLY IN THE DOOR (the 4C repair's R7a lesson).
--       No AI or system identity may draw down contingency. The RPC refuses
--       `ai_admin` by name AND the row-level provenance trigger refuses a row
--       whose approver is an AI identity, so a service caller writing the
--       ledger directly cannot mint an AI-approved spend either.
--
--   R6. IMMUTABLE. A drawdown is a spend that happened. Clients cannot UPDATE
--       or DELETE; a service caller is admitted AND AUDITED into
--       security_events; TRUNCATE is refused at statement level and the verb
--       revoked, because a row-level trigger never fires for TRUNCATE
--       (20261121090000's lesson) and one statement would erase the record of
--       every dollar this fund ever spent.
--
-- ANCHORING (D5.30's baseline discipline, reused not re-invented). A pool is
-- established against ONE APPROVED COST BASELINE. Re-baselining does not
-- rewrite the pool: a new baseline gets a NEW pool, and the read reports prior
-- pools BESIDE the current one rather than dropping them — the exact rule
-- 20261130090400 set for post-baseline scope attribution, applied to money.
--
-- CAUSE (D5.19). The taxonomy is the SPEC'S OWN four (scope maturation,
-- market escalation, productivity, realized risk) plus estimate error and
-- approved change, and the two classes that name a subject are LINKED to the
-- canonical stores rather than to a parallel one: `realized_risk` cites a row
-- in `risks`, `approved_change` cites a row in `project_changes` (wired in
-- 20261203090100, which is where that table is born). No parallel cause
-- taxonomy is invented, and no parallel risk or change store is created.
--
-- `unattributed` IS IN THE VOCABULARY AND THE DOOR REFUSES IT. That is not a
-- contradiction: the door refuses to MINT an unattributed spend, and the
-- report always carries an `unattributed` bucket so that if one ever exists —
-- a service-path insert, an import, a repair — it is SHOWN as unattributed
-- rather than dropped from the total. A bucket that disappears when empty is
-- how an unattributed spend becomes invisible.
--
-- Canonical reuse: authority_limits + its org-node scope rule (20261121090100
-- §3, repeated verbatim), development_baselines, project_cost_items
-- (.contingency — the §23 field, cross-checked against the pool rather than
-- replaced by it), risks, audit_events, security_events,
-- record_calculation_run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. THE CODE VERSIONS FOR THIS SLICE (D11.29).
--
--    Pinned in the FIRST file of the slice, ahead of every compute function,
--    because record_calculation_run RAISES on an unpinned key by design. The
--    4A/4B/4C keys keep their own versions: their code did not change, and
--    bumping a version on unchanged code makes the version stop meaning
--    anything.
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
    ('case_scope_growth',              'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',       'develop-controls/4A/2026-11-24'),
    ('case_earned_value',              'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',         'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',        'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',          'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',       'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',   'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',   'develop-change/4D/2026-12-03'),
    ('case_change_control',            'develop-change/4D/2026-12-03'),
    ('case_decision_latency',          'develop-change/4D/2026-12-03'),
    ('case_decision_debt',             'develop-change/4D/2026-12-03')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. THE ONE AUTHORITY STORE gains the contingency delegation (overlap-map
--    ruling 14; the 20261101090500 / 20261121090100 action_type precedent,
--    extended not twinned). A second authority store for money would be the
--    named anti-pattern, and money is exactly where it would hurt most.
-- ---------------------------------------------------------------------------
alter table public.authority_limits
  drop constraint if exists authority_limits_action_type_check;
alter table public.authority_limits
  add constraint authority_limits_action_type_check
    check (action_type in ('general','sanction','regulatory_variance',
                           'gate_requirement_waiver','contingency_drawdown'));

-- R7. A CEILING IS AN AMOUNT **IN A CURRENCY**, AND 4D IS WHERE THAT STARTS
--     TO MATTER. `max_commitment_usd` is USD by its own name, and every
--     pre-4D comparison feeds it a USD-denominated field
--     (`recommendations.estimated_cost_usd`). A contingency pool declares its
--     OWN currency, so comparing a CAD drawdown to a USD ceiling is a category
--     error in both directions: at ~1.37 USD/CAD a CAD 340,000 draw (≈USD
--     248k, INSIDE the delegation) would be refused while a CAD 250,000 draw
--     (≈USD 182k) would pass, and a fund in a weak currency would let a
--     manager approve orders of magnitude beyond their real delegation. There
--     is no FX table in this product and inventing one would be worse than the
--     bug, so the ceiling STATES ITS OWN CURRENCY and a fund in another
--     currency REFUSES by name. Existing rows are USD, which is what the
--     column has always meant.
alter table public.authority_limits
  add column if not exists max_commitment_currency text not null default 'USD';
alter table public.authority_limits
  drop constraint if exists authority_limits_commitment_currency_check;
alter table public.authority_limits
  add constraint authority_limits_commitment_currency_check
    check (max_commitment_currency ~ '^[A-Z]{3}$');

comment on column public.authority_limits.max_commitment_currency is
  'The currency `max_commitment_usd` is denominated in. Defaults to USD, which is what the column name has always asserted. Slice 4D compares this ceiling to a contingency pool or change that declares its own currency, and REFUSES on a mismatch rather than comparing two different units — there is no FX table in this product, and a silent comparison is wrong in both directions.';

-- Draft delegation rows so the right EXISTS to be adopted (the 20260808210000
-- seed discipline: drafts enforce nothing and grant nothing, and R1 above
-- means an unadopted ladder refuses every drawdown rather than waving it
-- through).
insert into authority_limits (organization_id, role_key, tier_label, action_type,
  max_commitment_usd, max_risk_level, escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, 'contingency_drawdown',
       null, null, v.escalates, v.basis
from organizations o
cross join (values
  ('maintenance_manager', 'Project manager', 'executive',
   'Proposed: routine drawdowns against realized risk and scope maturation sit with the project manager. The AMOUNT is deliberately left null so this row cannot be adopted without the organization stating its own number — a null money ceiling REFUSES every drawdown (R2), it does not permit an unlimited one.'),
  ('executive', 'Executive', 'board',
   'Proposed: drawdowns above the project manager''s ceiling escalate to the executive layer. Placeholder pending the organization''s own delegation instrument; adopt (adopt_authority_limit) with a stated ceiling before any drawdown can be approved.'),
  ('board', 'Board', null,
   'Proposed: the top of the contingency ladder. Placeholder pending the board charter.')
) as v(role_key, tier_label, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
    and al.action_type = 'contingency_drawdown'
);

-- ---------------------------------------------------------------------------
-- 2. THE POOL. One per approved COST baseline; a re-baseline gets a new one
--    and the old one is reported beside it, never dropped (20261130090400).
-- ---------------------------------------------------------------------------
create table if not exists public.project_contingency_pools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- WHICH baseline this fund belongs to. Spec II.8's "original amount" is only
  -- meaningful against the estimate it was set aside from.
  baseline_id uuid not null references development_baselines(id) on delete restrict,
  pool_ref text not null check (btrim(pool_ref) <> ''),
  original_amount numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Spec II.8's "basis": WHY this amount. Never left implicit, exactly as
  -- authority_limits.basis and asset_economics.basis are never left implicit.
  basis text not null check (length(btrim(basis)) >= 20),
  status text not null default 'open' check (status in ('open','closed')),
  established_by uuid not null references auth.users(id),
  established_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  unique (development_case_id, baseline_id),
  -- R4 at the column: NaN and the infinities are valid numerics and pass
  -- every inequality vacuously.
  constraint contingency_pool_amount_finite check (
    original_amount > 0
    and original_amount <> 'NaN'::numeric
    and original_amount <> 'Infinity'::numeric
    and original_amount <> '-Infinity'::numeric),
  constraint contingency_pool_closure check (
    (status = 'closed') = (closed_at is not null)
    and (closed_at is null or closed_by is not null))
);

create index if not exists idx_contingency_pool_case
  on project_contingency_pools(organization_id, development_case_id, status);

alter table public.project_contingency_pools enable row level security;
drop policy if exists contingency_pools_read on public.project_contingency_pools;
create policy contingency_pools_read on public.project_contingency_pools
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: pools are established through the definer RPC only.

comment on table public.project_contingency_pools is
  'D5.18 (spec II.8): a contingency fund anchored to ONE approved cost baseline — original amount, basis, currency. Re-baselining establishes a NEW pool; the prior pool is reported beside it and never dropped (the 20261130090400 post-baseline attribution rule, applied to money).';

-- ---------------------------------------------------------------------------
-- 3. THE LEDGER. Append-only. Every entry names its cause, its approver, the
--    ceiling that approver was checked against, and the balance it left
--    behind.
-- ---------------------------------------------------------------------------
create table if not exists public.contingency_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  pool_id uuid not null references project_contingency_pools(id) on delete restrict,
  entry_no int not null check (entry_no > 0),
  entry_type text not null check (entry_type in ('establishment','drawdown','release')),
  amount numeric not null,
  -- D5.19. The spec's own four causes plus estimate error and approved change.
  -- `unattributed` exists so an unattributed spend can be SHOWN as one; the
  -- door refuses to mint it (see draw_down_contingency).
  cause_class text check (cause_class in
    ('realized_risk','approved_change','scope_maturation','market_escalation',
     'productivity','estimate_error','unattributed')),
  cause_risk_id uuid references risks(id) on delete restrict,
  -- cause_change_id is added by 20261203090100, where project_changes is born.
  cause_note text,
  justification text not null check (length(btrim(justification)) >= 20),
  -- Spec II.8's "approving authority", recorded as three facts rather than one
  -- name: who, under which adopted ladder, against which ceiling. A ceiling
  -- that was raised afterwards cannot rewrite what this spend was checked
  -- against.
  authority_limit_id uuid references authority_limits(id) on delete restrict,
  approver_id uuid not null references auth.users(id),
  approver_role text not null check (btrim(approver_role) <> ''),
  approver_ceiling_usd numeric,
  -- The running remainder AT THIS ENTRY. Recorded rather than only derived, so
  -- the ledger states the balance it left and a later reader can check the
  -- arithmetic instead of trusting it.
  balance_after numeric not null,
  reverses_entry_id uuid references contingency_ledger_entries(id) on delete restrict,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (pool_id, entry_no),
  -- R4: finite, positive.
  constraint contingency_entry_amount_finite check (
    amount > 0
    and amount <> 'NaN'::numeric
    and amount <> 'Infinity'::numeric
    and amount <> '-Infinity'::numeric),
  -- R3: the fund cannot go negative, whoever writes the row.
  constraint contingency_entry_balance_nonnegative check (
    balance_after >= 0
    and balance_after <> 'NaN'::numeric
    and balance_after <> 'Infinity'::numeric
    and balance_after <> '-Infinity'::numeric),
  constraint contingency_entry_ceiling_finite check (
    approver_ceiling_usd is null
    or (approver_ceiling_usd >= 0
        and approver_ceiling_usd <> 'NaN'::numeric
        and approver_ceiling_usd <> 'Infinity'::numeric
        and approver_ceiling_usd <> '-Infinity'::numeric)),
  -- The three entry shapes, each complete or refused. An establishment has no
  -- cause (it spends nothing); a drawdown must name one; a release must name
  -- both a cause and the drawdown it reverses.
  constraint contingency_entry_shape check (
    (entry_type = 'establishment'
       and cause_class is null and cause_risk_id is null and reverses_entry_id is null)
    or (entry_type = 'drawdown'
       and cause_class is not null and reverses_entry_id is null)
    or (entry_type = 'release'
       and cause_class is not null and reverses_entry_id is not null)),
  -- A linked cause without its subject is an unattributed spend wearing an
  -- attributed label.
  constraint contingency_entry_linked_cause check (
    cause_class is distinct from 'realized_risk' or cause_risk_id is not null)
);

create index if not exists idx_contingency_entry_pool
  on contingency_ledger_entries(pool_id, entry_no);
create index if not exists idx_contingency_entry_case
  on contingency_ledger_entries(organization_id, development_case_id, recorded_at desc);
create index if not exists idx_contingency_entry_cause
  on contingency_ledger_entries(pool_id, cause_class) where cause_class is not null;

alter table public.contingency_ledger_entries enable row level security;
drop policy if exists contingency_entries_read on public.contingency_ledger_entries;
create policy contingency_entries_read on public.contingency_ledger_entries
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: entries are written by the definer RPCs only.

comment on table public.contingency_ledger_entries is
  'D5.18/D5.19 (spec II.8): the append-only contingency ledger. Every drawdown names its cause, its approving authority and the ceiling that authority was checked against, and records the balance it left. Immutable to clients; TRUNCATE refused at statement level and revoked — one statement would erase the record of every dollar the fund ever spent.';

-- ---------------------------------------------------------------------------
-- 4. IMMUTABILITY (R6) + TRUNCATE (statement level, because a row trigger
--    never fires for TRUNCATE).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_contingency_entry_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE DUAL-CALLER GATE IS auth.uid(), NOT current_user. Inside a SECURITY
  -- DEFINER function `current_user` is the function OWNER, so
  -- `current_user in ('authenticated','anon')` is dead code that never fires
  -- (20261130090700 repaired thirteen of them).
  v_client boolean := auth.uid() is not null;
  v_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'the contingency ledger records every dollar drawn from this fund and by whose authority; truncating it erases all of that in one statement. It is append-only for every caller.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  -- THE MONEY FIELDS ARE REFUSED FOR EVERY CALLER, THE SERVICE PATH INCLUDED.
  -- The 4C repair's lesson (20261202090300 R7a): admitting-and-auditing a
  -- service write is right for a record whose worst case is a wrong label, and
  -- wrong for the one field the whole feature rests on. An UPDATE that raised
  -- `amount` or `balance_after` would create money in a ledger that reads as
  -- audited, and the security_events row would describe the theft rather than
  -- prevent it. Proven necessary in review: a superuser UPDATE moved a pool
  -- from $1M to $9M with every trigger "firing".
  --
  -- REVIEW REPAIR (4D-R9). The list walled the cause CLASS but not the cause
  -- SUBJECT, nor the ladder the spend was checked under: a service caller
  -- could leave `cause_class = 'approved_change'` and re-point
  -- `cause_change_id` at a different change, closing THAT change's contingency
  -- obligation with money drawn for another one, or null `authority_limit_id`
  -- so the entry quotes a ceiling with no delegation behind it. Attribution is
  -- the whole of D5.19 and the ladder reference is the whole of D5.18's
  -- "approving authority", so both are frozen with the amount.
  --
  -- `cause_change_id` is added by 20261203090100 (where project_changes is
  -- born), so it is compared through to_jsonb rather than by name — a direct
  -- reference would raise on the chain between the two files.
  if tg_op = 'UPDATE'
     and (new.amount is distinct from old.amount
          or new.balance_after is distinct from old.balance_after
          or new.entry_type is distinct from old.entry_type
          or new.entry_no is distinct from old.entry_no
          or new.pool_id is distinct from old.pool_id
          or new.development_case_id is distinct from old.development_case_id
          or new.cause_class is distinct from old.cause_class
          or new.cause_risk_id is distinct from old.cause_risk_id
          or (to_jsonb(new)->>'cause_change_id')
               is distinct from (to_jsonb(old)->>'cause_change_id')
          or new.authority_limit_id is distinct from old.authority_limit_id
          or new.reverses_entry_id is distinct from old.reverses_entry_id
          or new.recorded_by is distinct from old.recorded_by
          or new.approver_id is distinct from old.approver_id
          or new.approver_role is distinct from old.approver_role
          or new.approver_ceiling_usd is distinct from old.approver_ceiling_usd
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
      'the amount, balance, cause, cause subject, delegation and approver of a contingency ledger entry cannot be rewritten by ANY caller, service paths included — an entry that can be re-amounted or re-attributed is not a ledger. A spend made in error is REVERSED by a release entry, which is itself authority-checked and recorded.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 4D-R10. A TARGETED DELETE IS REFUSED FOR EVERY CALLER, FOR THE REASON THE
  -- UPDATE WALL EXISTS — AND DELETE IS STRICTLY WORSE. `sync_contingency_remaining`
  -- derives the balance from the entries, so deleting a $180,000 drawdown
  -- CREATES $180,000 of spendable authority while removing the audited row that
  -- would have shown it. The generic service branch used to return OLD with a
  -- security_events note, which is the exact "the audit describes the theft
  -- rather than prevents it" failure the UPDATE wall was written against.
  -- The ONLY admitted disappearance is the cascade from the development case
  -- itself being deleted — detectable because the parent row is already gone by
  -- the time this trigger runs — and even that is audited.
  if tg_op = 'DELETE' then
    if exists (select 1 from development_cases where id = old.development_case_id) then
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
        'a contingency ledger entry is not deleted by ANY caller, service paths included. The remaining balance is derived from the entries, so removing a recorded spend does not tidy the ledger — it hands back money that was already committed, and erases the audited row that would have shown it. A spend made in error is REVERSED by a release entry.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, coalesce('service (' || current_user || ')', 'service'),
         'admin_action', 'warning',
         'Contingency ledger entry ' || old.id || ' was removed with the development '
           || 'case it belonged to. The fund and its ledger disappear together, which is '
           || 'the only admitted way either disappears (D5.18).');
    end if;
    return old;
  end if;

  if not v_client then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'critical',
         'A contingency ledger entry was ' || lower(tg_op) || 'd by a service caller. '
           || 'The ledger is the record of money spent from a project fund and by '
           || 'whose delegated authority (D5.18); changing one changes what a '
           || 'project is understood to have spent.');
    end if;
    return new;
  end if;

  raise exception
    'a contingency ledger entry is immutable — it records a spend that happened, the authority it happened under, and the balance it left. A spend made in error is REVERSED by a release entry, which is itself authority-checked and recorded; it is never edited away.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.enforce_contingency_entry_immutable() from public, anon, authenticated;

drop trigger if exists trg_contingency_entry_immutable on public.contingency_ledger_entries;
create trigger trg_contingency_entry_immutable
  before update or delete on public.contingency_ledger_entries
  for each row execute function public.enforce_contingency_entry_immutable();

drop trigger if exists trg_contingency_entry_no_truncate on public.contingency_ledger_entries;
create trigger trg_contingency_entry_no_truncate
  before truncate on public.contingency_ledger_entries
  for each statement execute function public.enforce_contingency_entry_immutable();

revoke truncate on table public.contingency_ledger_entries from anon, authenticated, service_role;
revoke truncate on table public.project_contingency_pools from anon, authenticated, service_role;

-- The pool itself is not a ledger, but it carries the original amount every
-- balance is measured from, so it gets the same statement guard, the same
-- amount-and-baseline wall, AND the same provenance backstop the ledger has.
--
-- REVIEW REPAIR (4D-R8). The trigger was `before update or delete` and the
-- pool was therefore the ONE table in this slice with no INSERT-side check at
-- all: a service caller could mint a $50M fund anchored to another case's
-- SUPERSEDED SCOPE baseline, established by the AI identity, with no
-- security_events row — and `get_case_contingency` then reported the invented
-- amount as this tenant's remaining balance and
-- `compute_case_contingency_consumption` baked it into an immutable lineage
-- run. R5's sentence ("§70 on the ledger, not only in the door") was applied
-- to the ledger and NOT to the pool every ledger balance is measured from.
-- INSERT is covered here now, with the same assertions the door makes.
create or replace function public.enforce_contingency_pool_wall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
  v_role text;
  b development_baselines%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_contingency_pools carries the original amount every contingency balance is measured from; truncating it detaches every ledger entry from the fund it spent. It is not truncatable for any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  -- 4D-R8a. THE PROVENANCE BACKSTOP, ON INSERT AS WELL AS THE DOOR. Every
  -- assertion establish_contingency_pool makes is re-made here, so a row that
  -- reached the table by any other path carries the same guarantees.
  if tg_op = 'INSERT' then
    select * into b from development_baselines where id = new.baseline_id;
    if not found
       or b.development_case_id is distinct from new.development_case_id
       or b.organization_id is distinct from new.organization_id then
      raise exception
        'a contingency pool must be anchored to a baseline OF ITS OWN development case and organization. A fund measured against another project''s estimate is not a bookkeeping error, it is a cross-tenant reserve.'
        using errcode = 'check_violation';
    end if;
    if b.baseline_type <> 'COST' then
      raise exception
        'contingency is held against a COST baseline; baseline % is a % baseline.',
        b.id, b.baseline_type using errcode = 'check_violation';
    end if;
    if b.status <> 'approved' then
      raise exception
        'baseline % is %. Contingency is set aside against an APPROVED estimate; a fund anchored to a draft or superseded baseline is measured against a document that no longer governs.',
        b.id, b.status using errcode = 'check_violation';
    end if;

    select role into v_role from user_profiles
     where id = new.established_by and organization_id = new.organization_id;
    if v_role is null then
      raise exception
        'the establisher of a contingency fund must be a member of this organization; a fund established by somebody the organization does not know has no stated authority behind it.'
        using errcode = 'check_violation';
    end if;
    -- §70 on the ROW. Setting aside owner capital against an approved baseline
    -- is a funding determination.
    if v_role = 'ai_admin' then
      raise exception
        'this contingency fund is attributed to the AI-operator identity. Setting aside owner capital against an approved baseline is a funding determination and spec §70 forbids an AI or system identity from making it.'
        using errcode = 'check_violation';
    end if;
    if auth.uid() is not null and new.established_by is distinct from auth.uid() then
      raise exception
        'a contingency fund is established by the caller who establishes it; recording one in another user''s name attributes a funding determination to somebody who did not make it.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Same rule as the ledger, for the same reason: the original amount, the
  -- currency and the baseline anchor are refused to EVERY caller, because
  -- raising the original amount creates money for every later balance to be
  -- measured against.
  if tg_op = 'UPDATE'
     and (new.original_amount is distinct from old.original_amount
          or new.currency is distinct from old.currency
          or new.baseline_id is distinct from old.baseline_id
          or new.established_by is distinct from old.established_by
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
      'the original amount, currency, establisher and baseline anchor of a contingency pool cannot be rewritten by ANY caller, service paths included. A changed reserve is a NEW cost baseline with a NEW pool; the prior pool is reported beside it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 4D-R8b. A TARGETED DELETE IS REFUSED FOR EVERY CALLER. Deleting the pool
  -- destroys the original amount every recorded balance beneath it was
  -- measured from. The ONLY admitted disappearance is the cascade from the
  -- development case itself being deleted — detectable because the parent row
  -- is already gone by the time this trigger runs — and even that is audited.
  if tg_op = 'DELETE' then
    if exists (select 1 from development_cases where id = old.development_case_id) then
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
        'a contingency pool is not deleted while its development case exists — the original amount is what every recorded balance beneath it means, and removing it makes the ledger unreadable rather than empty. A fund that should no longer be drawn on is CLOSED.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, coalesce('service (' || current_user || ')', 'service'),
         'admin_action', 'warning',
         'Contingency pool ' || old.id || ' was removed with the development case it '
           || 'belonged to. The fund and its ledger disappear together, which is the '
           || 'only admitted way either disappears (D5.18).');
    end if;
    return old;
  end if;

  if not v_client then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'critical',
         'A contingency pool was ' || lower(tg_op) || 'd by a service caller. The '
           || 'original amount and its baseline anchor are what every recorded '
           || 'balance means (D5.18).');
    end if;
    return new;
  end if;

  raise exception
    'a contingency pool''s amount, currency, basis and baseline anchor are fixed when it is established — the recorded balances beneath it are all measured from them. A changed estimate is a NEW cost baseline with a NEW pool; the prior pool is reported beside it.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.enforce_contingency_pool_wall() from public, anon, authenticated;

drop trigger if exists trg_contingency_pool_wall on public.project_contingency_pools;
create trigger trg_contingency_pool_wall
  before insert or update or delete on public.project_contingency_pools
  for each row execute function public.enforce_contingency_pool_wall();

drop trigger if exists trg_contingency_pool_no_truncate on public.project_contingency_pools;
create trigger trg_contingency_pool_no_truncate
  before truncate on public.project_contingency_pools
  for each statement execute function public.enforce_contingency_pool_wall();

-- ---------------------------------------------------------------------------
-- 5. PROVENANCE BACKSTOP (R5 — §70 on the ledger, not only in the door).
--
--    Covers INSERT and UPDATE. The immutability trigger already refuses a
--    client UPDATE outright, but a SERVICE update is admitted-and-audited
--    there, and an admitted update that could flip an approver to the AI
--    identity would walk straight past a door that only checked INSERT.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_contingency_entry_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approver_role text;
  v_recorder_role text;
  p project_contingency_pools%rowtype;
begin
  select * into p from project_contingency_pools where id = new.pool_id;
  if not found then
    raise exception 'a contingency ledger entry must belong to an established pool'
      using errcode = 'foreign_key_violation';
  end if;
  if new.organization_id is distinct from p.organization_id
     or new.development_case_id is distinct from p.development_case_id then
    raise exception
      'a contingency ledger entry must carry the organization and development case of its pool — an entry filed against another tenant''s fund is not a bookkeeping error, it is a cross-tenant spend.'
      using errcode = 'check_violation';
  end if;

  select role into v_approver_role from user_profiles
   where id = new.approver_id and organization_id = new.organization_id;
  if v_approver_role is null then
    raise exception
      'the approver of a contingency movement must be a member of this organization; an approver the organization does not know is not an authority.'
      using errcode = 'check_violation';
  end if;
  -- §70 (R5). No AI or system identity may draw down contingency.
  if v_approver_role = 'ai_admin' then
    raise exception
      'this contingency movement is attributed to the AI-operator identity. Drawing money from a project contingency fund is committing the owner''s capital, and spec §70 forbids an AI or system identity from doing it. The AI may propose a drawdown and explain its cause; a human approves it.'
      using errcode = 'check_violation';
  end if;
  if new.approver_role is distinct from v_approver_role then
    raise exception
      'the recorded approver role (%) is not the role this approver holds (%). The ledger records the authority a spend was checked against; a role it records but the approver does not hold is a fabricated authority.',
      new.approver_role, v_approver_role
      using errcode = 'check_violation';
  end if;

  select role into v_recorder_role from user_profiles
   where id = new.recorded_by and organization_id = new.organization_id;
  if v_recorder_role is null then
    raise exception 'the recorder of a contingency movement must be a member of this organization'
      using errcode = 'check_violation';
  end if;
  if auth.uid() is not null and new.recorded_by is distinct from auth.uid() then
    raise exception
      'a contingency ledger entry is recorded by the caller who made it; recording one in another user''s name is attributing a spend to somebody who did not make it.'
      using errcode = 'check_violation';
  end if;

  -- A release must reverse a DRAWDOWN on the SAME pool.
  if new.reverses_entry_id is not null then
    if not exists (select 1 from contingency_ledger_entries e
                    where e.id = new.reverses_entry_id
                      and e.pool_id = new.pool_id
                      and e.entry_type = 'drawdown') then
      raise exception
        'a release must reverse a drawdown recorded against the same pool; a release pointing anywhere else returns money that was never taken.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_contingency_entry_provenance() from public, anon, authenticated;

drop trigger if exists trg_contingency_entry_provenance on public.contingency_ledger_entries;
create trigger trg_contingency_entry_provenance
  before insert or update on public.contingency_ledger_entries
  for each row execute function public.enforce_contingency_entry_provenance();

-- ---------------------------------------------------------------------------
-- 6. THE BALANCE, IN ONE PLACE. Both the door and the read use this, so the
--    number the refusal quotes and the number the screen shows can never be
--    two different computations of the same thing.
-- ---------------------------------------------------------------------------
create or replace function public.sync_contingency_remaining(p_pool_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(p.original_amount, 0)
       - coalesce((select sum(e.amount) from contingency_ledger_entries e
                    where e.pool_id = p.id and e.entry_type = 'drawdown'), 0)
       + coalesce((select sum(e.amount) from contingency_ledger_entries e
                    where e.pool_id = p.id and e.entry_type = 'release'), 0)
  from project_contingency_pools p where p.id = p_pool_id;
$$;

revoke all on function public.sync_contingency_remaining(uuid) from public, anon;
grant execute on function public.sync_contingency_remaining(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. THE AUTHORITY SELECTION, IN ONE PLACE (R1 + R2).
--
--    The org-node scope rule is the 20261121090100 §3 sentence, repeated
--    verbatim: an adopted ladder applies only when its org_node_id is null
--    (org-wide) or is the act organization or an ancestor of it; among
--    applicable rows the most SPECIFIC scope wins, newest version breaking
--    ties; and when adopted rows exist but NONE covers the act, the act is
--    REFUSED by name.
--
--    Returns a jsonb verdict rather than raising, so the calling RPC can
--    return the refusal as data in the shape the rest of the family uses.
-- ---------------------------------------------------------------------------
drop function if exists public.sync_contingency_authority(uuid, text, numeric);

create or replace function public.sync_contingency_authority(
  p_org uuid,
  p_role text,
  p_amount numeric,
  p_currency text default null,
  p_pool_id uuid default null,
  p_approver uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_committed numeric := 0;
begin
  select al.* into l
  from authority_limits al
  left join org_ancestry(p_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = p_org
    and al.role_key = p_role
    and al.action_type = 'contingency_drawdown'
    and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;

  if not found then
    if exists (select 1 from authority_limits
                where organization_id = p_org and role_key = p_role
                  and action_type = 'contingency_drawdown' and status = 'adopted') then
      return jsonb_build_object('permitted', false, 'refusal', format(
        'Delegation of authority: every adopted contingency delegation for %s is scoped to one organization node, and this fund sits outside every such subtree. Escalate to a higher authority, or adopt a delegation covering this node.',
        p_role));
    end if;
    -- R1. Absence refuses. This is the deliberate difference from
    -- enforce_authority_limit, and it is stated where it is enforced.
    return jsonb_build_object('permitted', false, 'refusal', format(
      'Delegation of authority: no adopted contingency-drawdown delegation exists for %s in this organization, so no amount can be verified as within your authority. "Nobody has said how much you may spend" is not permission to spend; adopt a contingency delegation (adopt_authority_limit) and state its ceiling (set_authority_ceiling) first.',
      p_role));
  end if;

  -- R2. A null money ceiling refuses. It means "unstated", not "unlimited".
  if l.max_commitment_usd is null then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'refusal', format(
      'Delegation of authority: the adopted %s contingency delegation for %s states no money ceiling, so authority to spend cannot be verified. A blank ceiling on a fund is an unfinished delegation, not an unlimited one — state the ceiling on the delegation (set_authority_ceiling), or escalate to %s.',
      l.tier_label, p_role, coalesce(l.escalates_to_role, 'a higher authority')));
  end if;

  -- R7. A CEILING IS AN AMOUNT IN A CURRENCY. Comparing a CAD fund to a USD
  -- ceiling is wrong in both directions and there is no FX table to convert
  -- with, so a mismatch refuses rather than comparing two different units.
  if p_currency is not null
     and upper(btrim(p_currency)) is distinct from l.max_commitment_currency then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
      'refusal', format(
      'Delegation of authority: this movement is in %s and the adopted %s contingency ceiling for %s is stated in %s. Sync holds no exchange rate, and comparing the two would be wrong in both directions — it would refuse amounts inside the delegation and admit amounts far beyond it. State a %s ceiling on the delegation (set_authority_ceiling), or hold this fund in %s.',
      upper(btrim(p_currency)), l.tier_label, p_role, l.max_commitment_currency,
      upper(btrim(p_currency)), l.max_commitment_currency));
  end if;

  -- R8. THE CEILING IS CUMULATIVE AGAINST ONE FUND, NOT PER TRANSACTION.
  --     Proven necessary in review: a $250,000 approver committed $500,000 in
  --     two calls seconds apart, both recorded as within authority, because
  --     nothing aggregated what the role had already drawn. A delegation
  --     ceiling that can be defeated by pressing the button twice is not a
  --     ceiling, and "spend $250k at a time, as often as you like" is not what
  --     any delegation instrument means. The measure is this approver's NET
  --     commitment against THIS pool — releases they authorised give the
  --     headroom back, because the money did too.
  if p_pool_id is not null and p_approver is not null then
    select coalesce(sum(e.amount) filter (where e.entry_type = 'drawdown'), 0)
         - coalesce(sum(e.amount) filter (where e.entry_type = 'release'), 0)
      into v_committed
    from contingency_ledger_entries e
    where e.pool_id = p_pool_id and e.approver_id = p_approver;
    -- When nothing has been committed yet the two checks are the same test, and
    -- the plain sentence below reads better; the cumulative sentence is
    -- reserved for the case it is actually about.
    if v_committed > 0 and v_committed + p_amount > l.max_commitment_usd then
      return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
        'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
        'alreadyCommitted', v_committed, 'escalatesTo', l.escalates_to_role,
        'refusal', format(
        'Delegation of authority: you have already committed $%s of the %s contingency ceiling of $%s against this fund, so a further $%s would take your total commitment to $%s. The ceiling is what you may commit from one fund, not what you may commit per transaction. Escalate to %s.',
        v_committed, l.tier_label, l.max_commitment_usd, p_amount,
        v_committed + p_amount, coalesce(l.escalates_to_role, 'the board')));
    end if;
  end if;

  if p_amount > l.max_commitment_usd then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
      'escalatesTo', l.escalates_to_role,
      'refusal', format(
      'Delegation of authority: $%s exceeds the %s contingency ceiling of $%s for %s. Escalate to %s.',
      p_amount, l.tier_label, l.max_commitment_usd, p_role,
      coalesce(l.escalates_to_role, 'the board')));
  end if;

  return jsonb_build_object('permitted', true, 'limitId', l.id, 'tierLabel', l.tier_label,
    'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
    'alreadyCommitted', v_committed, 'escalatesTo', l.escalates_to_role);
end
$$;

-- NOT CLIENT-CALLABLE. It takes an organization as an argument, and a signed-in
-- caller who could invoke it directly would read ANOTHER tenant's adopted
-- delegation — its tier label, its ceiling and who it escalates to. Every real
-- caller is a SECURITY DEFINER function owned by the migration role, which
-- executes it regardless of these grants and always passes an organization it
-- has already resolved from the session. src/test/definerTenancy.test.ts scans
-- for exactly this shape (definer + org-shaped uuid argument + granted to
-- `authenticated`) and the grant is what it keys on, so the revoke is the fix
-- rather than an exemption.
revoke all on function public.sync_contingency_authority(uuid, text, numeric, text, uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. A FINITE POSITIVE AMOUNT, PARSED ONCE (R4).
--
--    Text in, numeric out, or null. `'NaN'::numeric` is a legal cast, so the
--    guard has to be explicit; `1e400::numeric` raises rather than returning
--    Infinity, so the cast itself is wrapped.
-- ---------------------------------------------------------------------------
create or replace function public.sync_finite_money(p_text text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare v numeric;
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  begin
    v := btrim(p_text)::numeric;
  exception when others then
    return null;
  end;
  -- 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres (numeric NaN sorts and
  -- compares, unlike float NaN), which is exactly why `amount > 0` alone does
  -- NOT keep it out: NaN > 0 is false, but NaN is also not less than 0, and
  -- every downstream sum becomes NaN.
  if v = 'NaN'::numeric then return null; end if;
  if v = 'Infinity'::numeric or v = '-Infinity'::numeric then return null; end if;
  return v;
end
$$;

revoke all on function public.sync_finite_money(text) from public, anon;
grant execute on function public.sync_finite_money(text) to authenticated, service_role;

-- 8b. A UUID, PARSED ONCE (4D-R11).
--
--     REVIEW REPAIR. `nullif(btrim(x),'')::uuid` raises 22P02 on malformed
--     text, so a caller who passed "not-a-uuid" as a risk id received an
--     unhandled invalid_input_syntax with a Postgres error string, while every
--     other bad input in these RPCs refuses as data with a sentence. A door
--     that answers one kind of bad input with a refusal and another with a
--     stack trace is teaching the caller that some failures are the product's
--     and some are theirs.
create or replace function public.sync_safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare v uuid;
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  begin
    v := btrim(p_text)::uuid;
  exception when others then
    return null;
  end;
  return v;
end
$$;

revoke all on function public.sync_safe_uuid(text) from public, anon;
grant execute on function public.sync_safe_uuid(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. ESTABLISH THE POOL. §70: setting aside contingency against an approved
--    baseline is a funding determination, so the AI identity is refused by
--    name and the role bar is the governance set.
-- ---------------------------------------------------------------------------
create or replace function public.establish_contingency_pool(
  p_case_id uuid,
  p_pool jsonb
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
  b development_baselines%rowtype;
  v_amount numeric;
  v_currency text := upper(btrim(coalesce(p_pool->>'currency', 'CAD')));
  v_basis text := btrim(coalesce(p_pool->>'basis', ''));
  v_ref text := btrim(coalesce(p_pool->>'pool_ref', ''));
  v_pool uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70. Establishing the fund fixes the amount every later drawdown is
  -- measured against.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'establishing a contingency fund sets the amount of owner capital held in reserve against an approved baseline. Spec §70: no AI or system identity may make that determination. The AI may propose an amount and its basis; a human establishes it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'establishing a contingency fund requires a governance role (project manager, executive or administrator)');
  end if;

  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select * into b from development_baselines
   where id = sync_safe_uuid(p_pool->>'baseline_id')
     and development_case_id = c.id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error',
      'name the baseline this contingency is held against — an "original amount" means nothing without the estimate it was set aside from (spec II.8)');
  end if;
  if b.baseline_type <> 'COST' then
    return jsonb_build_object('error', format(
      'contingency is held against a COST baseline; %s is a %s baseline. Approve the cost baseline first.',
      b.id, b.baseline_type));
  end if;
  if b.status <> 'approved' then
    return jsonb_build_object('error', format(
      'baseline %s is %s. Contingency is set aside against an APPROVED estimate; a draft baseline can still change under the fund.',
      b.id, b.status));
  end if;

  if exists (select 1 from project_contingency_pools where baseline_id = b.id) then
    return jsonb_build_object('error',
      'a contingency pool already exists against this baseline. The original amount is fixed when the pool is established; a changed reserve is a NEW cost baseline with a new pool, and the prior pool stays reported beside it.');
  end if;

  v_amount := sync_finite_money(p_pool->>'original_amount');
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the original contingency amount is %s; it must be a finite amount greater than zero. A fund of zero, of NaN or of infinity is not a fund.',
      coalesce(p_pool->>'original_amount', 'absent')));
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error', 'state the currency as a three-letter code (for example CAD)');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'record the basis for this contingency amount (20 characters minimum). Spec II.8: contingency is not an invisible slush fund, and an amount with no stated basis is exactly that.');
  end if;
  if v_ref = '' then
    v_ref := 'CONT-' || b.baseline_type || '-v' || b.version;
  end if;

  insert into project_contingency_pools
    (organization_id, development_case_id, baseline_id, pool_ref, original_amount,
     currency, basis, established_by)
  values (v_org, c.id, b.id, v_ref, v_amount, v_currency, v_basis, auth.uid())
  returning id into v_pool;

  -- The establishment is itself a ledger entry, so the ledger reads as a
  -- complete account of the fund from the moment it existed rather than
  -- starting at the first spend.
  insert into contingency_ledger_entries
    (organization_id, development_case_id, pool_id, entry_no, entry_type, amount,
     justification, approver_id, approver_role, balance_after, recorded_by)
  values (v_org, c.id, v_pool, 1, 'establishment', v_amount,
     v_basis, auth.uid(), v_role, v_amount, auth.uid());

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'contingency_pool', coalesce(v_role, 'system'),
    jsonb_build_object('case_id', c.id, 'pool_id', v_pool, 'baseline_id', b.id),
    null,
    jsonb_build_object('pool_ref', v_ref, 'original_amount', v_amount,
      'currency', v_currency, 'baseline_type', b.baseline_type,
      'baseline_version', b.version, 'established_by', auth.uid()));

  return jsonb_build_object('pool_id', v_pool, 'pool_ref', v_ref,
    'original_amount', v_amount, 'currency', v_currency,
    'remaining', v_amount, 'baseline_id', b.id, 'baseline_version', b.version);
end
$$;

revoke all on function public.establish_contingency_pool(uuid, jsonb) from public, anon, service_role;
grant execute on function public.establish_contingency_pool(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. THE DRAWDOWN. The act that moves money.
--
--     Order of refusals is deliberate: identity (§70) → role → fund → amount
--     shape (R4) → cause (D5.19) → balance (R3) → authority (R1/R2). The
--     amount is checked for finiteness BEFORE it is compared to anything,
--     because NaN passes every comparison vacuously and would otherwise reach
--     the balance arithmetic and poison it.
-- ---------------------------------------------------------------------------
create or replace function public.draw_down_contingency(
  p_pool_id uuid,
  p_draw jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p project_contingency_pools%rowtype;
  v_amount numeric;
  v_cause text := lower(btrim(coalesce(p_draw->>'cause_class', '')));
  v_justification text := btrim(coalesce(p_draw->>'justification', ''));
  v_risk uuid;
  v_remaining numeric;
  v_auth jsonb;
  v_entry uuid;
  v_no int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70, in the door as well as on the ledger.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'drawing down contingency spends owner capital. Spec §70: no AI or system identity may commit funds, approve a change or close a decision. The AI may prepare the case for a drawdown — the cause, the amount, the evidence — and a human approves it.');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- 4D-R12. A ROLE FLOOR ON SPENDING, NOT ONLY ON REPORTING.
  --
  -- REVIEW REPAIR. R1's "the ladder IS the check" left the drawdown as the one
  -- 4D act with no role floor at all, while compute_case_contingency_consumption
  -- required a planning, engineering or governance role merely to REPORT what
  -- had been spent. `authority_limits.role_key` is free text with no check
  -- against the role vocabulary, so an organization that adopted a ladder
  -- against a mistyped or low-privilege role_key granted spend authority to a
  -- role that could not run the consumption report. The tightest gate in the
  -- file must not be on reading. The floor here is the READING floor: you may
  -- not spend from a fund you are not permitted to report on. The ladder still
  -- decides the AMOUNT; this decides who may stand in front of it.
  if v_role not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', format(
      'drawing down contingency requires a planning, engineering or governance role; %s is not one. A delegation ladder adopted against a role that cannot even report what the fund has spent is a delegation to nobody in particular.',
      v_role));
  end if;

  -- 4D-R13. THE POOL ROW IS LOCKED BEFORE THE BALANCE IS READ.
  --
  -- REVIEW REPAIR. Two concurrent drawdowns both read the same remaining
  -- balance and both passed the R3 check; the double spend was blocked only by
  -- `unique (pool_id, entry_no)`, an index that exists for ORDERING, and the
  -- loser received a raw 23505 instead of a refusal. Safety by accident is not
  -- safety: `for update` serialises the read-check-write against this fund so
  -- the second caller reads the balance the first one left and refuses by name
  -- if it no longer covers the draw.
  select * into p from project_contingency_pools
   where id = p_pool_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'contingency pool not found');
  end if;
  if p.status <> 'open' then
    return jsonb_build_object('error', format(
      'contingency pool %s is closed; a closed fund cannot be drawn on.', p.pool_ref));
  end if;

  -- R4, before any arithmetic.
  v_amount := sync_finite_money(p_draw->>'amount');
  if v_amount is null then
    return jsonb_build_object('error', format(
      'the drawdown amount is %s; it must be a finite number. NaN and infinity are legal numeric values in Postgres and would pass every ceiling and balance test vacuously, so they are refused before either is applied.',
      coalesce(nullif(btrim(coalesce(p_draw->>'amount', '')), ''), 'absent')));
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the drawdown amount is %s; a drawdown must be greater than zero. Returning money to the fund is a RELEASE against the drawdown it reverses (release_contingency), not a negative drawdown — a negative drawdown would be an unaudited credit.',
      v_amount));
  end if;

  if length(v_justification) < 20 then
    return jsonb_build_object('error',
      'record why this money is being drawn (20 characters minimum). Spec II.8''s whole point is that contingency consumption is explicable line by line.');
  end if;

  -- D5.19. The cause, from the spec's own taxonomy.
  if v_cause = '' then
    return jsonb_build_object('error',
      'name the cause of this drawdown. Spec II.8 reports consumption BY CAUSE ("$7M scope maturation, $4M market escalation, $3M construction productivity, $4M realized risk"), and a drawdown with no cause makes that report a guess. Classes: realized_risk, approved_change, scope_maturation, market_escalation, productivity, estimate_error.');
  end if;
  if v_cause = 'unattributed' then
    return jsonb_build_object('error',
      'a drawdown cannot be recorded as unattributed. The report carries an "unattributed" bucket so that a spend which somehow arrives without a cause is SHOWN rather than dropped from the total — it is not a class you may choose. Name the cause, or do not spend the money yet.');
  end if;
  if v_cause not in ('realized_risk','approved_change','scope_maturation',
                     'market_escalation','productivity','estimate_error') then
    return jsonb_build_object('error', format(
      '"%s" is not a contingency cause class. The vocabulary is the spec''s own: realized_risk, approved_change, scope_maturation, market_escalation, productivity, estimate_error.',
      v_cause));
  end if;
  if v_cause = 'realized_risk' then
    v_risk := sync_safe_uuid(p_draw->>'risk_id');
    if v_risk is null then
      return jsonb_build_object('error',
        'a realized-risk drawdown must cite the risk that was realized. Spec II.8 names "risk event" as part of the record, and the risk register is where risks live — a drawdown that says "a risk happened" without saying which is unattributed with a label on it.');
    end if;
    if not exists (select 1 from risks r where r.id = v_risk and r.organization_id = v_org) then
      return jsonb_build_object('error',
        'the cited risk is not in this organization''s risk register');
    end if;
  end if;
  -- `approved_change` is completed in 20261203090100: the change store is born
  -- there, and this door gains its subject check in the same file that gives
  -- the ledger its cause_change_id column. Until then the class is refused
  -- rather than accepted unlinked — an approved-change drawdown that cites no
  -- change is the unattributed spend this file just refused under another name.
  if v_cause = 'approved_change' then
    return jsonb_build_object('error',
      'the approved-change cause is wired in 20261203090100 together with the change store it cites. Recording one now would be an unattributed spend with an attributed label.');
  end if;

  -- R3. The balance, from the one definition.
  v_remaining := sync_contingency_remaining(p.id);
  if v_amount > v_remaining then
    return jsonb_build_object('error', format(
      'this drawdown of $%s exceeds what remains in %s: $%s of the original $%s. A contingency fund cannot go negative — the overspend is a cost overrun and belongs in the forecast, not in a fund that no longer holds the money.',
      v_amount, p.pool_ref, v_remaining, p.original_amount));
  end if;

  -- R1/R2/R7/R8. Authority, from the ONE store: the ladder, its currency, and
  -- this approver's cumulative commitment against THIS fund.
  v_auth := sync_contingency_authority(v_org, v_role, v_amount, p.currency, p.id, auth.uid());
  if (v_auth->>'permitted')::boolean is not true then
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel',
      'escalatesTo', v_auth->'escalatesTo');
  end if;

  select coalesce(max(entry_no), 0) + 1 into v_no
    from contingency_ledger_entries where pool_id = p.id;

  insert into contingency_ledger_entries
    (organization_id, development_case_id, pool_id, entry_no, entry_type, amount,
     cause_class, cause_risk_id, cause_note, justification,
     authority_limit_id, approver_id, approver_role, approver_ceiling_usd,
     balance_after, recorded_by)
  values (v_org, p.development_case_id, p.id, v_no, 'drawdown', v_amount,
     v_cause, v_risk, nullif(btrim(coalesce(p_draw->>'cause_note', '')), ''), v_justification,
     (v_auth->>'limitId')::uuid, auth.uid(), v_role, (v_auth->>'ceiling')::numeric,
     v_remaining - v_amount, auth.uid())
  returning id into v_entry;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'contingency_drawdown', v_role,
    jsonb_build_object('case_id', p.development_case_id, 'pool_id', p.id,
      'entry_id', v_entry, 'cause_class', v_cause, 'risk_id', v_risk),
    jsonb_build_object('remaining', v_remaining),
    jsonb_build_object('amount', v_amount, 'remaining', v_remaining - v_amount,
      'cause_class', v_cause, 'approver_id', auth.uid(), 'approver_role', v_role,
      'ceiling', (v_auth->>'ceiling')::numeric, 'tier_label', v_auth->>'tierLabel'));

  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no,
    'amount', v_amount, 'cause_class', v_cause,
    'remaining', v_remaining - v_amount, 'currency', p.currency,
    'approved_under', v_auth->'tierLabel', 'ceiling', v_auth->'ceiling');
end
$$;

revoke all on function public.draw_down_contingency(uuid, jsonb) from public, anon, service_role;
grant execute on function public.draw_down_contingency(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. THE RELEASE. A spend made in error is REVERSED, never edited away.
--
--     Routed through the SAME ladder and the SAME ceiling: returning money to
--     a fund changes what everybody else may still spend from it, so a release
--     nobody is delegated to make would be a back door to erasing a recorded
--     consumption. It can never exceed the un-released remainder of the
--     drawdown it reverses.
-- ---------------------------------------------------------------------------
create or replace function public.release_contingency(
  p_entry_id uuid,
  p_release jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d contingency_ledger_entries%rowtype;
  p project_contingency_pools%rowtype;
  v_amount numeric;
  v_released numeric;
  v_auth jsonb;
  v_remaining numeric;
  v_entry uuid;
  v_no int;
  v_justification text := btrim(coalesce(p_release->>'justification', ''));
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'releasing contingency changes what remains available to spend. Spec §70: no AI or system identity may commit or uncommit owner funds.');
  end if;
  if v_role is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- 4D-R12, the same floor as the drawdown: a release changes what everybody
  -- else may still spend from the fund.
  if v_role not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', format(
      'releasing contingency requires a planning, engineering or governance role; %s is not one.',
      v_role));
  end if;

  select * into d from contingency_ledger_entries
   where id = p_entry_id and organization_id = v_org and entry_type = 'drawdown';
  if not found then
    return jsonb_build_object('error', 'contingency drawdown not found');
  end if;
  select * into p from project_contingency_pools where id = d.pool_id for update;
  if p.status <> 'open' then
    return jsonb_build_object('error', format(
      'contingency pool %s is closed.', p.pool_ref));
  end if;

  v_amount := sync_finite_money(p_release->>'amount');
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the release amount is %s; it must be a finite amount greater than zero.',
      coalesce(nullif(btrim(coalesce(p_release->>'amount', '')), ''), 'absent')));
  end if;
  if length(v_justification) < 20 then
    return jsonb_build_object('error',
      'record why this money is being returned to the fund (20 characters minimum)');
  end if;

  select coalesce(sum(amount), 0) into v_released from contingency_ledger_entries
   where reverses_entry_id = d.id and entry_type = 'release';
  if v_amount > d.amount - v_released then
    return jsonb_build_object('error', format(
      'this release of $%s exceeds the un-released part of drawdown #%s: $%s of $%s has already been returned. Releasing more than was taken would credit the fund with money it never held.',
      v_amount, d.entry_no, v_released, d.amount));
  end if;

  -- A release RETURNS money, so it is checked against the ladder and its
  -- currency but NOT against the cumulative commitment: giving headroom back
  -- cannot itself require headroom.
  v_auth := sync_contingency_authority(v_org, v_role, v_amount, p.currency);
  if (v_auth->>'permitted')::boolean is not true then
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel');
  end if;

  v_remaining := sync_contingency_remaining(p.id);
  select coalesce(max(entry_no), 0) + 1 into v_no
    from contingency_ledger_entries where pool_id = p.id;

  insert into contingency_ledger_entries
    (organization_id, development_case_id, pool_id, entry_no, entry_type, amount,
     cause_class, cause_risk_id, justification, authority_limit_id,
     approver_id, approver_role, approver_ceiling_usd, balance_after,
     reverses_entry_id, recorded_by)
  values (v_org, p.development_case_id, p.id, v_no, 'release', v_amount,
     d.cause_class, d.cause_risk_id, v_justification, (v_auth->>'limitId')::uuid,
     auth.uid(), v_role, (v_auth->>'ceiling')::numeric, v_remaining + v_amount,
     d.id, auth.uid())
  returning id into v_entry;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'contingency_release', v_role,
    jsonb_build_object('case_id', p.development_case_id, 'pool_id', p.id,
      'entry_id', v_entry, 'reverses_entry_id', d.id),
    jsonb_build_object('remaining', v_remaining, 'drawdown_amount', d.amount,
      'already_released', v_released),
    jsonb_build_object('amount', v_amount, 'remaining', v_remaining + v_amount,
      'approver_id', auth.uid(), 'approver_role', v_role));

  return jsonb_build_object('entry_id', v_entry, 'entry_no', v_no,
    'amount', v_amount, 'reverses_entry_no', d.entry_no,
    'remaining', v_remaining + v_amount, 'currency', p.currency);
end
$$;

revoke all on function public.release_contingency(uuid, jsonb) from public, anon, service_role;
grant execute on function public.release_contingency(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. THE READ (D5.18 + D5.19).
--
--     PRIOR POOLS ARE REPORTED BESIDE THE CURRENT ONE, NEVER DROPPED — the
--     20261130090400 rule. A project that re-baselined twice has spent money
--     from three funds, and a report showing only the newest one understates
--     lifetime consumption by everything spent before the last re-baseline.
--
--     THE `unattributed` BUCKET IS ALWAYS PRESENT. Empty is a fact ("nothing
--     is unattributed"); absent is an invitation to assume it.
--
--     THE §23 CROSS-CHECK. project_cost_items.contingency is the line-level
--     contingency the estimate carries. The pool and the sum of those lines
--     are two statements of the same reserve, and when they disagree the read
--     says so rather than picking one — the 4A cost-reconciliation posture.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_contingency(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_pools jsonb := '[]'::jsonb;
  v_current jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_by_cause jsonb := '[]'::jsonb;
  v_refusal text;
  v_line_total numeric;
  v_line_count int;
  v_pool_total numeric;
  v_drawn numeric;
  v_released numeric;
  v_remaining numeric;
  v_currency text;
  v_currencies text[];
  v_currency_refusal text;
  v_mixed boolean := false;
  v_authority jsonb;
  v_role text;
  rec record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'poolRef', x.pool_ref, 'baselineId', x.baseline_id,
           'baselineVersion', x.version, 'baselineStatus', x.bstatus,
           'originalAmount', x.original_amount, 'currency', x.currency,
           'basis', x.basis, 'status', x.status,
           'establishedAt', x.established_at,
           'establishedBy', x.established_email,
           'drawnDown', x.drawn, 'released', x.rel,
           'remaining', x.original_amount - x.drawn + x.rel,
           'consumedPercent', case when x.original_amount > 0
             then round(((x.drawn - x.rel) / x.original_amount) * 100, 1) else null end,
           'isCurrent', x.is_current,
           'entryCount', x.entry_count) order by x.version desc), '[]'::jsonb)
    into v_pools
  from (
    select p.*, b.version, b.status as bstatus,
      (select email from user_profiles up where up.id = p.established_by) as established_email,
      coalesce((select sum(e.amount) from contingency_ledger_entries e
                 where e.pool_id = p.id and e.entry_type = 'drawdown'), 0) as drawn,
      coalesce((select sum(e.amount) from contingency_ledger_entries e
                 where e.pool_id = p.id and e.entry_type = 'release'), 0) as rel,
      (select count(*) from contingency_ledger_entries e where e.pool_id = p.id) as entry_count,
      (b.status = 'approved' and p.status = 'open'
       and b.version = (select max(b2.version) from development_baselines b2
                         where b2.development_case_id = c.id and b2.baseline_type = 'COST'
                           and b2.status = 'approved')) as is_current
    from project_contingency_pools p
    join development_baselines b on b.id = p.baseline_id
    where p.development_case_id = c.id
  ) x;

  select value into v_current from jsonb_array_elements(v_pools)
   where (value->>'isCurrent')::boolean is true limit 1;

  -- REFUSAL-FIRST. No fund is not "$0 remaining"; it is "no fund exists", and
  -- the two are different facts about a project.
  if jsonb_array_length(v_pools) = 0 then
    v_refusal :=
      'No contingency fund is established for this case. Spec II.8 measures consumption against an original amount held on an APPROVED cost baseline, and this case has none — which is a different fact from a fund with nothing left in it. Approve a cost baseline and establish the pool against it.';
  elsif v_current is null then
    v_refusal := format(
      'This case has %s contingency pool(s), but none of them is held against the CURRENT approved cost baseline — the fund and the estimate have drifted apart. The prior pools are reported below and their consumption still counts; establish a pool against the current baseline before drawing again.',
      jsonb_array_length(v_pools));
  end if;

  -- The pool total is summed on its OWN row set. Summing it across the join
  -- to the ledger would multiply each pool's original amount by its entry
  -- count, which is the classic fan-out that makes a fund look larger the
  -- more it has been spent from.
  select coalesce(sum(e.amount) filter (where e.entry_type = 'drawdown'), 0),
         coalesce(sum(e.amount) filter (where e.entry_type = 'release'), 0)
    into v_drawn, v_released
  from project_contingency_pools p
  join contingency_ledger_entries e on e.pool_id = p.id
  where p.development_case_id = c.id;
  select coalesce(sum(original_amount), 0) into v_pool_total
    from project_contingency_pools where development_case_id = c.id;
  v_remaining := v_pool_total - v_drawn + v_released;

  -- 4D-R14. MONEY IN TWO CURRENCIES IS NOT ADDED, IT IS REFUSED.
  --
  -- REVIEW REPAIR. `max(currency)` picked ONE label for a total summed across
  -- every pool on the case, so a CAD 1,000,000 fund beside a USD 1,000,000 one
  -- reported `originalTotal 2000000, currency "USD"` with no refusal, and
  -- `largestCause` was "largest" only because CAD and USD had been treated as
  -- equal. establish_contingency_pool accepts any ISO code and a re-baseline
  -- legitimately mints a second pool, so this is reachable through the client
  -- RPC and not only by a service write. This file's own decision-debt sibling
  -- already states the rule — "adding CAD to USD produces a number in no
  -- currency at all" — and it applies here. The PER-POOL figures are exact and
  -- stay; the case-level totals are WITHHELD and named.
  select array_agg(distinct currency order by currency) into v_currencies
    from project_contingency_pools where development_case_id = c.id;
  v_currency := case when coalesce(array_length(v_currencies, 1), 0) = 1
                     then v_currencies[1] end;
  v_mixed := coalesce(array_length(v_currencies, 1), 0) > 1;
  if v_mixed then
    v_currency_refusal := format(
      'This case holds contingency in %s different currencies (%s), so there is no case-level total to publish: adding %s produces a number in no currency at all. Each pool''s own original amount, consumption and remaining balance are exact and are shown per pool below; the case-level totals and the by-cause split are withheld rather than summed under one arbitrary label.',
      array_length(v_currencies, 1), array_to_string(v_currencies, ', '),
      array_to_string(v_currencies, ' to '));
  end if;

  -- D5.19: consumption by cause, ACROSS every pool this case has held. Each
  -- of the seven classes is emitted whether or not it has any consumption —
  -- including `unattributed`, which the door refuses to mint and the report
  -- refuses to hide.
  select coalesce(jsonb_agg(jsonb_build_object(
           'causeClass', k.cls,
           'label', k.label,
           'linked', k.linked,
           'drawnDown', case when v_mixed then null else coalesce(agg.drawn, 0) end,
           'released', case when v_mixed then null else coalesce(agg.rel, 0) end,
           'net', case when v_mixed then null
                  else coalesce(agg.drawn, 0) - coalesce(agg.rel, 0) end,
           'entryCount', coalesce(agg.n, 0),
           'sharePercent', case when v_mixed or v_drawn - v_released <= 0 then null
             else round(((coalesce(agg.drawn, 0) - coalesce(agg.rel, 0))
                         / (v_drawn - v_released)) * 100, 1) end,
           'refusal', case when v_mixed then
             'This case holds contingency in more than one currency, so consumption cannot be attributed to a cause as one figure. The per-entry amounts below carry their own pool currency.' end)
           order by coalesce(agg.drawn, 0) - coalesce(agg.rel, 0) desc, k.cls), '[]'::jsonb)
    into v_by_cause
  from (values
    ('realized_risk',     'Realized risk',      true),
    ('approved_change',   'Approved change',    true),
    ('scope_maturation',  'Scope maturation',   false),
    ('market_escalation', 'Market escalation',  false),
    ('productivity',      'Productivity',       false),
    ('estimate_error',    'Estimate error',     false),
    ('unattributed',      'Unattributed',       false)
  ) as k(cls, label, linked)
  left join (
    select e.cause_class,
           sum(e.amount) filter (where e.entry_type = 'drawdown') as drawn,
           sum(e.amount) filter (where e.entry_type = 'release') as rel,
           count(*) filter (where e.entry_type = 'drawdown') as n
    from contingency_ledger_entries e
    join project_contingency_pools p on p.id = e.pool_id
    where p.development_case_id = c.id and e.cause_class is not null
    group by e.cause_class
  ) agg on agg.cause_class = k.cls;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'poolId', e.pool_id, 'poolRef', p.pool_ref,
           'entryNo', e.entry_no, 'entryType', e.entry_type, 'amount', e.amount,
           'causeClass', e.cause_class, 'causeRiskId', e.cause_risk_id,
           'causeRiskTitle', r.title, 'causeNote', e.cause_note,
           'justification', e.justification,
           'approver', (select email from user_profiles up where up.id = e.approver_id),
           'approverRole', e.approver_role,
           'approverCeiling', e.approver_ceiling_usd,
           'tierLabel', al.tier_label,
           'balanceAfter', e.balance_after,
           'reversesEntryId', e.reverses_entry_id,
           'recordedAt', e.recorded_at) order by e.recorded_at desc, e.entry_no desc), '[]'::jsonb)
    into v_entries
  from contingency_ledger_entries e
  join project_contingency_pools p on p.id = e.pool_id
  left join risks r on r.id = e.cause_risk_id
  left join authority_limits al on al.id = e.authority_limit_id
  where p.development_case_id = c.id;

  select count(*), coalesce(sum(ci.contingency), 0)
    into v_line_count, v_line_total
  from project_cost_items ci
  where ci.development_case_id = c.id and ci.contingency is not null;

  -- The caller's own delegation, so the screen can state the ceiling BEFORE a
  -- drawdown is attempted rather than only in the refusal afterwards. Amount 0
  -- probes the ladder without proposing a spend.
  v_authority := case when v_role is null then null
                 else sync_contingency_authority(v_org, v_role, 0,
                        v_current->>'currency',
                        sync_safe_uuid(v_current->>'id'), auth.uid()) end;

  return jsonb_build_object(
    'caseId', c.id,
    'pools', v_pools,
    'currentPool', v_current,
    'entries', v_entries,
    'byCause', v_by_cause,
    'poolCount', jsonb_array_length(v_pools),
    -- Withheld, not zeroed, when the pools disagree on currency (4D-R14).
    'originalTotal', case when v_mixed then null else v_pool_total end,
    'drawnDownTotal', case when v_mixed then null else v_drawn end,
    'releasedTotal', case when v_mixed then null else v_released end,
    'consumedNet', case when v_mixed then null else v_drawn - v_released end,
    'remainingTotal', case when v_mixed then null else v_remaining end,
    'currency', v_currency,
    'poolCurrencies', to_jsonb(coalesce(v_currencies, array[]::text[])),
    'currencyRefusal', v_currency_refusal,
    'refusal', coalesce(v_refusal, v_currency_refusal),
    'authority', v_authority,
    'callerRole', v_role,
    -- The §23 cross-check. Two statements of one reserve; disagreement is
    -- reported, never resolved by preference.
    'lineContingency', jsonb_build_object(
      'costItemsWithContingency', v_line_count,
      'total', v_line_total,
      'agreesWithPools', case when v_line_count = 0 or v_mixed then null
                         else v_line_total = v_pool_total end,
      'note', case
        when v_mixed then
          'The pool total cannot be cross-checked against the line-level contingency while this case holds contingency in more than one currency (4D-R14).'
        when v_line_count = 0 then
          'No cost item on this case carries a line-level contingency (project_cost_items.contingency, the §23 field), so the pool total cannot be cross-checked against the estimate it came from.'
        when v_line_total = v_pool_total then
          'The pool total agrees with the line-level contingency carried in the cost estimate.'
        else format(
          'The contingency held in pools ($%s) and the contingency carried on the cost lines ($%s) disagree. Both are statements about the same reserve; neither is corrected here, because choosing one silently would make the disagreement invisible.',
          v_pool_total, v_line_total) end),
    'notInThisSlice', jsonb_build_array(
      'Contingency drawdown FORECASTING (how much of the fund the remaining risk exposure implies) is not computed here. The inputs exist — get_case_risk_schedule_economics prices risk in days and money — but a forecast draw is a probabilistic claim about a fund, and it needs its own refusal set before it can sit beside a recorded balance.'));
end
$$;

revoke all on function public.get_case_contingency(uuid) from public, anon, service_role;
grant execute on function public.get_case_contingency(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. THE CALCULATION (D5.19 + D11.29). Consumption by cause, with lineage.
--
--     REFUSAL-FIRST: no pool, or a pool with no drawdown, records a REFUSED
--     run — outputs null — rather than a confident zero-consumption report. A
--     project that has spent nothing and a project with no fund at all are
--     different facts, and both are different from "0% consumed".
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_contingency_consumption(p_case_id uuid)
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
  v_unattributed numeric;
  v_prior int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70. Recording the consumption report is stating what the fund has been
  -- spent on; the AI may read get_case_contingency, which records nothing.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording the contingency consumption report states what a project''s reserve has been spent on and how much is left to commit. Spec §70 forbids an AI or system identity from making that determination. The AI may read get_case_contingency, which records nothing.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'reporting contingency consumption requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_read := get_case_contingency(c.id);
  if v_read ? 'error' then
    return v_read;
  end if;

  if v_read->>'refusal' is not null then
    v_refusals := v_refusals || to_jsonb(v_read->>'refusal');
  end if;
  -- 4D-R14. A case holding contingency in more than one currency has no
  -- consumption TOTAL to record. Recording one would put a method, a code
  -- version and an immutable lineage row behind a figure that is arithmetically
  -- meaningless, and the Integrated Controls screen would render it as
  -- lineage-backed truth.
  if v_read->>'currencyRefusal' is not null then
    if v_read->>'refusal' is distinct from v_read->>'currencyRefusal' then
      v_refusals := v_refusals || to_jsonb(v_read->>'currencyRefusal');
    end if;
  end if;

  select coalesce(sum((value->>'net')::numeric), 0) into v_unattributed
    from jsonb_array_elements(v_read->'byCause')
   where value->>'causeClass' = 'unattributed';
  if v_unattributed <> 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '$%s of consumption on this case is UNATTRIBUTED. The drawdown door refuses to record an unattributed spend, so these entries reached the ledger by another path (a service write, an import or a repair). They are counted in the total and named here; they are not dropped, and they are not silently reassigned to a cause.',
      v_unattributed)::text);
  end if;

  -- `jsonb_build_object('currentPool', null)` stores a JSON null, so the
  -- SQL-null test has to go through ->> rather than ->.
  v_prior := (v_read->>'poolCount')::int
             - (case when v_read->>'currentPool' is null then 0 else 1 end);
  if v_prior > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s prior contingency pool(s) from superseded cost baselines are included in this total. Consumption from a fund does not stop counting because the estimate was re-baselined; the pools are reported beside the current one rather than replaced by it (the 20261130090400 post-baseline attribution rule).',
      v_prior)::text);
  end if;

  if (v_read->'lineContingency'->>'agreesWithPools') = 'false' then
    v_refusals := v_refusals || to_jsonb((v_read->'lineContingency'->>'note')::text);
  end if;

  if jsonb_array_length(v_read->'pools') = 0
     or v_read->>'currencyRefusal' is not null
     or coalesce((v_read->>'drawnDownTotal')::numeric, 0) = 0 then
    -- No outputs. An empty ledger is not a measurement of consumption.
    v_outputs := null;
    if jsonb_array_length(v_read->'pools') > 0
       and v_read->>'currencyRefusal' is null then
      v_refusals := v_refusals || to_jsonb(
        'No drawdown has been recorded against any contingency pool on this case, so there is no consumption to attribute. That is a different fact from "0% consumed against a plan" and it is recorded as a refusal rather than as a zero.'::text);
    end if;
  else
    v_outputs := jsonb_build_object(
      'originalTotal', v_read->'originalTotal',
      'drawnDownTotal', v_read->'drawnDownTotal',
      'releasedTotal', v_read->'releasedTotal',
      'consumedNet', v_read->'consumedNet',
      'remainingTotal', v_read->'remainingTotal',
      'consumedPercent', round(((v_read->>'consumedNet')::numeric
                                / nullif((v_read->>'originalTotal')::numeric, 0)) * 100, 1),
      'currency', v_read->'currency',
      'poolCount', v_read->'poolCount',
      'byCause', (select jsonb_object_agg(value->>'causeClass', value->'net')
                    from jsonb_array_elements(v_read->'byCause')),
      'largestCause', (select value->>'causeClass' from jsonb_array_elements(v_read->'byCause')
                        where (value->>'net')::numeric > 0
                        order by (value->>'net')::numeric desc limit 1),
      'unattributedAmount', v_unattributed);
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_contingency_consumption',
    'Contingency consumption attributed by cause across every pool this case has held (spec II.8). Each pool is anchored to one approved COST baseline; pools from superseded baselines are included and named rather than dropped, because money spent before a re-baseline was still spent. The seven cause classes are always all reported, including `unattributed` — the drawdown door refuses to mint an unattributed spend, and the report refuses to hide one that arrived by another path. A case with no fund, or a fund with no drawdown, REFUSES rather than reporting zero consumption.',
    jsonb_build_object(
      'poolCount', v_read->'poolCount',
      'originalTotal', v_read->'originalTotal',
      'entryCount', jsonb_array_length(v_read->'entries'),
      'drawnDownTotal', v_read->'drawnDownTotal',
      'releasedTotal', v_read->'releasedTotal',
      -- Counts alone cannot see a REVISED ledger. The digest is the content of
      -- every entry, so a service-path edit that the immutability trigger
      -- audits and admits still makes every published figure go stale.
      'ledgerDigest', coalesce((
        select md5(string_agg(e.id::text || '~' || e.entry_type || '~' || e.amount::text
                              || '~' || coalesce(e.cause_class, '-')
                              || '~' || e.balance_after::text, '|' order by e.recorded_at, e.entry_no))
          from contingency_ledger_entries e
          join project_contingency_pools p on p.id = e.pool_id
         where p.development_case_id = c.id), 'empty'),
      'poolCurrencies', v_read->'poolCurrencies',
      'lineContingencyTotal', v_read->'lineContingency'->'total'),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'contingency_ledger_entries', 'id', e.id))
                from contingency_ledger_entries e
                join project_contingency_pools p on p.id = e.pool_id
               where p.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_read || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_contingency_consumption'));
end
$$;

revoke all on function public.compute_case_contingency_consumption(uuid) from public, anon, service_role;
grant execute on function public.compute_case_contingency_consumption(uuid) to authenticated;
