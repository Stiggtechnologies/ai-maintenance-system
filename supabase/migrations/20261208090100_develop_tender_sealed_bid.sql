-- ============================================================================
-- Sync Develop — Slice 6A, part 2 of 3.
-- D6.04 — the tender objects of spec I.16: Bidder, Bid, TechnicalEvaluation,
-- CommercialEvaluation.
--
-- WHAT WAS ALREADY THERE. `contract_bids` (20260817140000:277) is a bid per
-- package per supplier carrying price, labour hours, the assumed productivity
-- factor, duration and qualifications, and `compareBids`
-- (src/lib/supply/index.ts) already refuses to rank two bids until both state
-- what they assumed about productivity. Register row D6.04 names what is
-- missing: a Bidder registry, separate technical and commercial evaluation
-- objects with a separation-of-duties hook, and a bid write path. This file
-- adds those three things to the existing table and its existing consumer. It
-- does not create a second bid store.
--
-- AN AWARD IS MONEY AND IT IS ADVERSARIAL. Four defects are the ones that
-- matter in a tender, and each is closed AT THE DATABASE rather than in a
-- screen:
--
--   1. A BID READABLE BEFORE THE ENVELOPE IS OPENED. A bid whose price can be
--      seen while the tender is still open lets the reader tell a favoured
--      bidder what to beat. Closed twice: the RLS policy on contract_bids
--      hides a sealed bid from every client until the package records an
--      OPEN ACT, and get_package_tender — the definer read the product uses,
--      which RLS does not constrain — returns the fact of submission and
--      nothing about its content until the same moment.
--
--   2. A BID EDITED AFTER SUBMISSION. A price revised once the others are
--      known is not a bid. Every substantive column of a sealed bid is frozen
--      at submission for EVERY writer; the only permitted later transition is
--      withdrawal, before close, through the door.
--
--   3. A TENDER RE-SCORED AFTER OPENING. An evaluation is immutable once
--      recorded — no update, no delete — so a score cannot be revised once
--      the prices are on the table. A second opinion is a NEW evaluation of a
--      kind not yet recorded, never a rewrite of the first.
--
--   4. AN EVALUATION WHOSE AUTHOR IS THE AWARDER. Separation of duties is
--      enforced by two triggers, in both directions, because the acts can
--      happen in either order: an evaluator cannot later award the package,
--      and an awarder cannot have evaluated any bid on it. A bidder's own
--      submitter cannot evaluate their bid either.
--
-- §70: opening a sealed bid and scoring a bid are human acts. The AI-operator
-- identity is refused BY NAME at every door and, for every writer, at the
-- table by enforce_procurement_act_is_human (20261208090000).
--
-- REFUSAL-FIRST: a package with no bids REFUSES rather than reporting "0 bids
-- evaluated", which reads as a completed evaluation. A price that is not a
-- finite, non-negative number is refused at the door and at the column
-- ('NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so `price >= 0` alone
-- does not keep NaN out).
--
-- Canonical reuse: contract_packages, contract_bids, suppliers,
-- development_cases, audit_events, security_events, sync_finite_money,
-- enforce_procurement_act_is_human, record_procurement_service_write.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE BIDDER (spec I.16). A bidder is a SUPPLIER invited to bid on one
--    package. `suppliers` stays the one supplier store — this is the
--    invitation, its prequalification and its outcome, which is what the
--    object is.
-- ---------------------------------------------------------------------------
create table if not exists public.package_bidders (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  supplier_id bigint not null references suppliers(id) on delete restrict,
  invited_at timestamptz not null default now(),
  invited_by uuid references auth.users(id),
  status text not null default 'invited' check (status in
    ('invited', 'declined', 'submitted', 'withdrawn', 'disqualified')),
  -- I.15/E7.05 applied to a tender: not "we asked three contractors" but WHY
  -- this one is capable of the work. Nullable and REPORTED as missing rather
  -- than assumed — a prequalification nobody wrote is not a prequalification.
  prequalification_basis text,
  disqualified_reason text,
  unique (package_id, supplier_id),
  constraint package_bidder_disqualified_reason check (
    status <> 'disqualified' or length(btrim(coalesce(disqualified_reason, ''))) >= 20)
);

create index if not exists idx_package_bidders_package
  on package_bidders(organization_id, package_id);

alter table public.package_bidders enable row level security;
drop policy if exists package_bidders_read on public.package_bidders;
create policy package_bidders_read on public.package_bidders
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: the only door is invite_package_bidder.

comment on table public.package_bidders is
  'D6.04 / spec I.16 Bidder: a supplier invited to bid on one procurement package, its prequalification basis and what became of the invitation. NOT a second supplier store — `suppliers` stays canonical and this is the invitation.';

-- THE BIDDER REGISTER GETS THE SAME WALL AS ITS FOUR SIBLINGS. It shipped with
-- NONE — no tenant arm, no provenance backstop, no delete guard and no
-- TRUNCATE trap, confirmed from pg_trigger — while contract_packages,
-- contract_bids, bid_evaluations and contract_commitment_lines each had two or
-- more. Three things were reachable and each was proven live:
--
--   * `truncate package_bidders` as postgres succeeded, where every sibling
--     raises. The `revoke truncate` stops service_role and nobody else.
--   * a service-path `delete from package_bidders where package_id = …` wiped
--     the entire bidder register of an AWARDED package — who was invited,
--     their prequalification, their disqualification — and left
--     security_events empty, because nothing called
--     record_procurement_service_write.
--   * a row stamped with one organization while pointing at another's package
--     inserted cleanly, and the FOREIGN tenant's ordinary authenticated user
--     then read it through package_bidders_read.
--
-- This is the register the prequalification (I.15/E7.05) lives in and the
-- thing submit_sealed_bid checks a bidder against, so an unwalled one is a
-- route around both.
create or replace function public.enforce_package_bidder_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.package_bidder_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'package_bidders is the bidder register: who was invited to each tender, on what prequalification, and what became of the invitation. Truncating it makes every tender in this organization look like one nobody was asked to bid. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: the declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id) then
      return old;
    end if;
    if old.status in ('submitted', 'withdrawn', 'disqualified') then
      raise exception
        'Bidder register row for supplier #% on package % is recorded as %. An invitation that was answered — or refused on stated grounds — is not deleted: removing it makes a tender that was contested look like one nobody entered, and takes the disqualification reason with it.',
        old.supplier_id,
        (select package_code from contract_packages where id = old.package_id),
        old.status
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_procurement_service_write(old.organization_id,
        format('Bidder register row for supplier #%s on package %s', old.supplier_id,
          (select package_code from contract_packages where id = old.package_id)),
        tg_op,
        'An invitation deleted outside invite_package_bidder takes its prequalification basis with it.');
    end if;
    return old;
  end if;

  -- THE TENANT ARM, for every writer including service.
  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this bidder register row is stamped with an organization that does not own its procurement package'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from suppliers s
                  where s.id = new.supplier_id and s.organization_id = new.organization_id) then
    raise exception
      'this bidder register row names a supplier from another organization — an invitation is to one of this tenant''s own suppliers, or the prequalification recorded against it belongs to somebody else'
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A bidder is put on the register through invite_package_bidder, which checks the role, refuses an invitation after the envelope is opened, and names a missing prequalification basis. A direct write reaches this table only by bypassing row-level security.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Bidder register row for supplier #%s on package %s',
             new.supplier_id, p.package_code), tg_op,
      'A register row written outside invite_package_bidder can admit a bidder to a tender whose envelope is already open, with no recorded prequalification and nobody named as inviting them.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_package_bidder_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_package_bidder_integrity on public.package_bidders;
create trigger trg_package_bidder_integrity
  before insert or update or delete on public.package_bidders
  for each row execute function public.enforce_package_bidder_integrity();

drop trigger if exists trg_package_bidder_no_truncate on public.package_bidders;
create trigger trg_package_bidder_no_truncate
  before truncate on public.package_bidders
  for each statement execute function public.enforce_package_bidder_integrity();

comment on function public.enforce_package_bidder_integrity() is
  'D6.04: the bidder register''s wall, in the shape of its four siblings — tenant arm against the package''s AND the supplier''s organization for every writer, a marker door with record_procurement_service_write on the admitted service path, a refusal to delete an invitation that was answered, and a statement-level TRUNCATE guard. It shipped with none of these while every sibling table had them.';

-- ---------------------------------------------------------------------------
-- 2. THE BID GROWS A SEAL (spec I.16 Bid).
-- ---------------------------------------------------------------------------
alter table public.contract_bids
  add column if not exists bid_ref text,
  -- THE SEAL. Set at submission by submit_sealed_bid and never by hand. A row
  -- with sealed_at set is invisible to every client until its package records
  -- an open act; a row without it is a pre-Slice-6A row (the demo seed writes
  -- two) and keeps the visibility it has always had.
  add column if not exists sealed_at timestamptz,
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists currency text,
  add column if not exists price_basis text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_reason text;

alter table public.contract_bids
  drop constraint if exists contract_bid_price_finite;
alter table public.contract_bids
  add constraint contract_bid_price_finite check (
    price <> 'NaN'::numeric
    and price > '-Infinity'::numeric
    and price < 'Infinity'::numeric);

alter table public.contract_bids
  drop constraint if exists contract_bid_hours_finite;
alter table public.contract_bids
  add constraint contract_bid_hours_finite check (
    (labour_hours is null
     or (labour_hours <> 'NaN'::numeric and labour_hours >= 0
         and labour_hours < 'Infinity'::numeric))
    and (assumed_productivity_factor is null
         or (assumed_productivity_factor <> 'NaN'::numeric
             and assumed_productivity_factor < 'Infinity'::numeric)));

alter table public.contract_bids
  drop constraint if exists contract_bid_withdrawal_pair;
alter table public.contract_bids
  add constraint contract_bid_withdrawal_pair check (
    (withdrawn_at is null) = (withdrawn_reason is null));

alter table public.contract_bids
  drop constraint if exists contract_bid_withdrawal_said_something;
alter table public.contract_bids
  add constraint contract_bid_withdrawal_said_something check (
    withdrawn_reason is null or length(btrim(withdrawn_reason)) >= 10);

create index if not exists idx_contract_bids_sealed
  on contract_bids(package_id, sealed_at);

comment on column public.contract_bids.sealed_at is
  'D6.04: the moment this bid was submitted under seal. While it is set and the package has no bids_opened_at, the row is invisible to every client (RLS policy cb_read) and get_package_tender returns the fact of submission with none of its content. Set by submit_sealed_bid and frozen thereafter.';

-- THE SEAL, AT THE ROW LEVEL. This REPLACES cb_read with a strictly narrower
-- policy: same tenant rule, plus "no bid on a LIVE TENDER is visible to a
-- client until its package records an open act".
--
-- THE QUESTION THE POLICY ASKS IS THE QUESTION THE DEFINER READ ASKS. The
-- first draft asked "does THIS ROW carry a seal?" (`sealed_at is null or …`)
-- while get_package_tender asked "is this PACKAGE's envelope open?". Those are
-- the same answer only for rows submit_sealed_bid created. Any bid that
-- reached the table without a seal — the admitted service path, a data import,
-- a future migration — was fully readable by every client while the tender was
-- still running, which is the one leak this whole file exists to close, and it
-- was two implementations of one question disagreeing. Proven live: an
-- ordinary technician read the price of a service-inserted bid on an open
-- tender.
--
-- Rows on a package that was never issued for tender (`bids_close_at is null`
-- — the pre-Slice-6A demo rows and everything the /materials surface has ever
-- shown) keep exactly the visibility they had.
drop policy if exists cb_read on public.contract_bids;
create policy cb_read on public.contract_bids
  for select to authenticated using (
    organization_id = app_current_org()
    and not exists (select 1 from contract_packages p
                     where p.id = contract_bids.package_id
                       and p.bids_close_at is not null
                       and p.bids_opened_at is null));

-- ---------------------------------------------------------------------------
-- 3. THE BID IS FROZEN AT SUBMISSION, FOR EVERY WRITER.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_sealed_bid_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.sealed_bid_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_bids holds every sealed tender submission this organization has received. Truncating it erases the bids an award was made on — the only evidence that the tender was competitive. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: the declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id) then
      return old;
    end if;
    if old.sealed_at is not null then
      raise exception
        'A submitted bid is withdrawn, never deleted. Deleting it makes a bid that was received indistinguishable from one that never arrived — which is how a tender comes to look competitive after the inconvenient bid is removed.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this bid is stamped with an organization that does not own its procurement package'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if v_marker <> 'granted' then
      if v_client then
        raise exception
          'A bid is submitted through submit_sealed_bid, which checks that the tender is open, that the bidder was invited, and that the price is a finite non-negative number, and which seals the row. A direct insert puts a bid into a tender with none of that.'
          using errcode = 'insufficient_privilege';
      end if;
      perform record_procurement_service_write(new.organization_id,
        format('Bid on package %s', p.package_code), tg_op,
        'A bid inserted outside submit_sealed_bid carries no seal, so it is readable before the envelope is opened and is not frozen against later editing.');
    end if;
    return new;
  end if;

  -- UPDATE. A signed-in caller reaching this table at all has bypassed RLS
  -- (there is no client write policy), so it is refused outright before the
  -- column-by-column freeze below — which is what protects the pre-Slice-6A
  -- rows that carry no seal.
  if v_client and v_marker <> 'granted' then
    raise exception
      'A bid is written through submit_sealed_bid and changed only by withdraw_sealed_bid. A direct update reaches this table only by bypassing row-level security.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A SEALED BID IS FROZEN. Its substance is what the bidder submitted; a
  -- price revised once the others are known is not a bid. Enforced for EVERY
  -- writer, marker or no marker — the door itself never re-prices a bid.
  if old.sealed_at is not null then
    if new.price is distinct from old.price
       or new.labour_hours is distinct from old.labour_hours
       or new.assumed_productivity_factor is distinct from old.assumed_productivity_factor
       or new.duration_days is distinct from old.duration_days
       or new.inclusions is distinct from old.inclusions
       or new.qualifications is distinct from old.qualifications
       or new.price_basis is distinct from old.price_basis
       or new.currency is distinct from old.currency
       or new.submitted_on is distinct from old.submitted_on
       or new.supplier_id is distinct from old.supplier_id
       or new.package_id is distinct from old.package_id
       or new.sealed_at is distinct from old.sealed_at
       or new.submitted_by is distinct from old.submitted_by then
      raise exception
        'Bid % on package % was submitted under seal on %. Its price, hours, productivity assumption, duration, qualifications and bidder are frozen: a submitted bid that can still be edited is not a sealed bid, and every evaluation recorded against it would be an evaluation of something else. Withdraw it and submit a replacement before the tender closes.',
        coalesce(old.bid_ref, old.id::text), p.package_code, old.sealed_at
        using errcode = 'check_violation';
    end if;
    -- The one permitted transition: withdrawal, through the door.
    if (new.withdrawn_at is distinct from old.withdrawn_at
        or new.withdrawn_reason is distinct from old.withdrawn_reason)
       and v_marker <> 'granted' then
      raise exception
        'A bid is withdrawn through withdraw_sealed_bid, which records who withdrew it and why. A direct update removes a bid from a tender with nothing behind it.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.withdrawn_at is not null and new.withdrawn_at is not null
       and new.withdrawn_at is distinct from old.withdrawn_at then
      raise exception
        'This bid was already withdrawn on %. A withdrawal happens once.', old.withdrawn_at
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_sealed_bid_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_sealed_bid_integrity on public.contract_bids;
create trigger trg_sealed_bid_integrity
  before insert or update or delete on public.contract_bids
  for each row execute function public.enforce_sealed_bid_integrity();

drop trigger if exists trg_sealed_bid_no_truncate on public.contract_bids;
create trigger trg_sealed_bid_no_truncate
  before truncate on public.contract_bids
  for each statement execute function public.enforce_sealed_bid_integrity();

revoke truncate on table public.contract_bids from anon, authenticated, service_role;
revoke truncate on table public.package_bidders from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. THE TWO EVALUATION OBJECTS (spec I.16 TechnicalEvaluation and
--    CommercialEvaluation). ONE table, a `kind` column, and a unique index
--    that makes "one technical and one commercial per bid" a schema fact.
--
--    They are separate OBJECTS in the specification because they are separate
--    JUDGEMENTS by separate people — an engineer says whether the offer meets
--    the specification, a commercial reviewer says whether the price and terms
--    are acceptable — and collapsing them into one score is how a technically
--    non-compliant bid wins on price.
-- ---------------------------------------------------------------------------
create or replace function public.sync_bid_evaluation_kinds()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['technical', 'commercial']::text[];
$$;

revoke all on function public.sync_bid_evaluation_kinds() from public, anon;
grant execute on function public.sync_bid_evaluation_kinds() to authenticated, service_role;

comment on function public.sync_bid_evaluation_kinds() is
  'D6.04 / spec I.16: the two evaluation objects, TechnicalEvaluation and CommercialEvaluation. BID_EVALUATION_KINDS in src/lib/develop/procurement.ts mirrors this and the slice test pins the two together.';

create or replace function public.sync_bid_evaluation_outcomes()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['compliant', 'compliant_with_qualifications', 'non_compliant']::text[];
$$;

revoke all on function public.sync_bid_evaluation_outcomes() from public, anon;
grant execute on function public.sync_bid_evaluation_outcomes() to authenticated, service_role;

comment on function public.sync_bid_evaluation_outcomes() is
  'D6.04: what an evaluation concluded. `non_compliant` is a real outcome and award_contract refuses to award a bid carrying one — a technically non-compliant bid winning on price is the failure the two separate evaluations exist to prevent.';

create table if not exists public.bid_evaluations (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Denormalised from the bid so the RLS policy and the separation-of-duties
  -- trigger can scope without a join, and enforced to AGREE with the bid by
  -- enforce_bid_evaluation_integrity.
  package_id bigint not null references contract_packages(id) on delete cascade,
  bid_id bigint not null references contract_bids(id) on delete cascade,
  evaluation_kind text not null check (evaluation_kind = any (sync_bid_evaluation_kinds())),
  evaluator_id uuid not null references auth.users(id),
  outcome text not null check (outcome = any (sync_bid_evaluation_outcomes())),
  -- Optional, because a score is not what makes an evaluation: the outcome and
  -- the rationale are. A score with no rationale is a number nobody can argue
  -- with, which is exactly what an evaluation must not be.
  score numeric,
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  rationale text not null check (length(btrim(rationale)) >= 20),
  recorded_at timestamptz not null default now(),
  -- One technical and one commercial per bid. A second evaluation of the same
  -- kind is a re-score, and a re-score after the prices are known is the
  -- defect this whole file exists to prevent.
  unique (bid_id, evaluation_kind),
  constraint bid_evaluation_score_sane check (
    score is null
    or (score <> 'NaN'::numeric and score >= 0 and score <= 100))
);

create index if not exists idx_bid_evaluations_package
  on bid_evaluations(organization_id, package_id, evaluation_kind);
create index if not exists idx_bid_evaluations_evaluator
  on bid_evaluations(package_id, evaluator_id);

alter table public.bid_evaluations enable row level security;
drop policy if exists bid_evaluations_read on public.bid_evaluations;
create policy bid_evaluations_read on public.bid_evaluations
  for select to authenticated using (organization_id = app_current_org());

comment on table public.bid_evaluations is
  'D6.04 / spec I.16 TechnicalEvaluation and CommercialEvaluation: the two judgements on one bid, by two people, IMMUTABLE once recorded. No update and no delete — a score revised after the prices are on the table is a re-scored tender.';

-- §70. Scoring a bid is a human act.
drop trigger if exists trg_bid_evaluator_is_human on public.bid_evaluations;
create trigger trg_bid_evaluator_is_human
  before insert or update on public.bid_evaluations
  for each row execute function public.enforce_procurement_act_is_human(
    'evaluator_id', 'score a bid');

create or replace function public.enforce_bid_evaluation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.bid_evaluation_write', true), '');
  v_client boolean := auth.uid() is not null;
  b contract_bids%rowtype;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'bid_evaluations holds every technical and commercial judgement an award rests on. Truncating it erases the basis of every contract awarded through this product. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_bids where id = old.bid_id)
       or not exists (select 1 from contract_packages where id = old.package_id) then
      return old;
    end if;
    raise exception
      'A recorded evaluation is not deleted. Deleting it removes the judgement an award was made on, and a package can then be re-scored by somebody else as though the first evaluation never happened.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    raise exception
      'A recorded evaluation is FROZEN. What this evaluator concluded on % about bid % is the fact a later reader has; a correction is a matter for the award record and the audit trail, never a rewrite of the judgement. Editing it would let a tender be re-scored once the prices are known.',
      old.recorded_at, old.bid_id
      using errcode = 'insufficient_privilege';
  end if;

  -- INSERT.
  select * into b from contract_bids where id = new.bid_id;
  if not found then
    raise exception 'bid not found' using errcode = 'no_data_found';
  end if;
  select * into p from contract_packages where id = new.package_id;
  if not found then
    raise exception 'procurement package not found' using errcode = 'no_data_found';
  end if;
  if b.package_id <> new.package_id
     or b.organization_id <> new.organization_id
     or p.organization_id <> new.organization_id then
    raise exception
      'this evaluation names a bid, a package and an organization that do not belong together — an evaluation filed against the wrong package is read, and awarded on, by the wrong tenant'
      using errcode = 'check_violation';
  end if;

  -- THE ENVELOPE MUST BE OPEN. Scoring a bid whose price nobody is allowed to
  -- see yet is either an evaluation of nothing or a leak.
  if p.bids_opened_at is null then
    raise exception
      'Bids on package % have not been opened. A bid cannot be evaluated before the envelope is opened: the evaluator either cannot see the offer, or has seen it before the other bidders'' offers were revealed, and both make the evaluation worthless.',
      p.package_code
      using errcode = 'check_violation';
  end if;

  if b.withdrawn_at is not null then
    raise exception
      'Bid % was withdrawn on %. A withdrawn bid is not evaluated — recording a judgement on it puts a score behind an offer that is no longer on the table.',
      coalesce(b.bid_ref, b.id::text), b.withdrawn_at
      using errcode = 'check_violation';
  end if;

  -- SEPARATION OF DUTIES, LEG 1: the evaluator did not, and will not, award.
  -- The reverse leg lives on contract_packages (section 5) because the two
  -- acts can happen in either order.
  if p.awarded_by is not null and p.awarded_by = new.evaluator_id then
    raise exception
      'This evaluation is recorded by the person who awarded package %. An award is a decision taken on somebody else''s assessment: an awarder who also scores the bids is marking their own homework, and the separation is what makes the evaluation evidence rather than a formality.',
      p.package_code
      using errcode = 'check_violation';
  end if;

  -- SEPARATION OF DUTIES, LEG 2: the bidder's own submitter does not score
  -- their own bid.
  if b.submitted_by is not null and b.submitted_by = new.evaluator_id then
    raise exception
      'This evaluation is recorded by the person who submitted the bid. Nobody evaluates their own offer.'
      using errcode = 'check_violation';
  end if;

  -- SEPARATION OF DUTIES, LEG 3: THE TWO EVALUATIONS ARE TWO PEOPLE.
  -- `unique (bid_id, evaluation_kind)` was the only cross-evaluation rule, so
  -- one person recorded BOTH the technical and the commercial evaluation of a
  -- bid and award_contract then treated it as fully evaluated. This file's own
  -- header says they are separate objects in the specification "because they
  -- are separate JUDGEMENTS by separate people" and that collapsing them "is
  -- how a technically non-compliant bid wins on price" — which is exactly what
  -- one evaluator holding both scores is. Enforced here, for every writer, so
  -- the service path cannot do it either.
  if exists (select 1 from bid_evaluations e
              where e.bid_id = new.bid_id
                and e.evaluation_kind <> new.evaluation_kind
                and e.evaluator_id = new.evaluator_id) then
    raise exception
      'The % evaluation of bid % is recorded by the person who already wrote its % evaluation. Spec I.16 makes them separate objects because they are separate judgements by separate people: an engineer says whether the offer meets the specification and a commercial reviewer says whether its price and terms are acceptable, and one person holding both is how a technically non-compliant bid comes to win on price. Route the second evaluation to somebody else.',
      new.evaluation_kind, coalesce(b.bid_ref, b.id::text),
      (select string_agg(distinct e.evaluation_kind, ' and ' order by e.evaluation_kind)
         from bid_evaluations e
        where e.bid_id = new.bid_id and e.evaluator_id = new.evaluator_id)
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'An evaluation is recorded through record_bid_evaluation, which checks the role, refuses the AI-operator identity by name, and enforces the separation of duties. A direct insert puts a judgement behind an award with none of that.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('%s evaluation of bid %s on package %s',
             initcap(new.evaluation_kind), coalesce(b.bid_ref, b.id::text), p.package_code),
      tg_op,
      'An evaluation is immutable once written, so a service-path insert creates a permanent judgement nobody made.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_bid_evaluation_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_bid_evaluation_integrity on public.bid_evaluations;
create trigger trg_bid_evaluation_integrity
  before insert or update or delete on public.bid_evaluations
  for each row execute function public.enforce_bid_evaluation_integrity();

drop trigger if exists trg_bid_evaluation_no_truncate on public.bid_evaluations;
create trigger trg_bid_evaluation_no_truncate
  before truncate on public.bid_evaluations
  for each statement execute function public.enforce_bid_evaluation_integrity();

revoke truncate on table public.bid_evaluations from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. SEPARATION OF DUTIES, THE OTHER DIRECTION. An awarder who evaluated any
--    bid on this package is refused AT THE TABLE — for every writer, INSERT
--    and UPDATE. Two triggers, because the two acts can happen in either
--    order and a single check on one of them is a control you dodge by
--    reversing the sequence.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_award_separation_of_duties()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kinds text;
begin
  if new.awarded_by is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.awarded_by is not distinct from old.awarded_by then
    return new;
  end if;
  select string_agg(distinct e.evaluation_kind, ' and ' order by e.evaluation_kind)
    into v_kinds
  from bid_evaluations e
  where e.package_id = new.id and e.evaluator_id = new.awarded_by;
  if v_kinds is not null then
    raise exception
      'The award of package % is being recorded by the person who wrote its % evaluation. An award is a decision taken on somebody else''s assessment — one person doing both is the single control failure that makes a competitive tender ceremonial. Route the award to somebody who did not evaluate.',
      new.package_code, v_kinds
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_award_separation_of_duties()
  from public, anon, authenticated;

drop trigger if exists trg_award_separation_of_duties on public.contract_packages;
create trigger trg_award_separation_of_duties
  before insert or update on public.contract_packages
  for each row execute function public.enforce_award_separation_of_duties();

comment on function public.enforce_award_separation_of_duties() is
  'D6.04/D6.05 separation of duties, enforced at the DATABASE for every writer on INSERT and UPDATE: the person recorded as awarding a package must not have evaluated any bid on it. The reverse leg (an evaluation by the awarder) is enforced in enforce_bid_evaluation_integrity, because the two acts can happen in either order.';

-- ---------------------------------------------------------------------------
-- 6. THE DOORS.
-- ---------------------------------------------------------------------------
create or replace function public.invite_package_bidder(
  p_package_id bigint,
  p_supplier_id bigint,
  p_prequalification_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p contract_packages%rowtype;
  s suppliers%rowtype;
  v_basis text := nullif(btrim(coalesce(p_prequalification_basis, '')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'inviting a bidder requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.bids_opened_at is not null then
    return jsonb_build_object('error', format(
      'bids on package %s were opened on %s. A bidder invited after the envelope is open would be bidding against known prices.',
      p.package_code, p.bids_opened_at));
  end if;
  select * into s from suppliers where id = p_supplier_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'supplier not found');
  end if;
  if exists (select 1 from package_bidders
              where package_id = p.id and supplier_id = s.id) then
    return jsonb_build_object('error', format(
      '%s is already on the bidder register for %s', s.name, p.package_code));
  end if;

  perform set_config('app.package_bidder_write', 'granted', true);
  insert into package_bidders
    (organization_id, package_id, supplier_id, invited_by, prequalification_basis)
  values (v_org, p.id, s.id, auth.uid(), v_basis)
  returning id into v_id;
  perform set_config('app.package_bidder_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'package_bidder', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'bidder_id', v_id),
    null,
    jsonb_build_object('supplier', s.name, 'supplier_code', s.supplier_code,
      'prequalification_basis', v_basis,
      'approvedVendor', s.approved_vendor,
      'safetyQualification', s.safety_qualification_status));

  return jsonb_build_object('bidder_id', v_id, 'package_code', p.package_code,
    'supplier', s.name,
    -- E7.05 surfaced where it matters: at invitation, not after the award.
    'prequalificationStated', v_basis is not null,
    'prequalificationGap', case when v_basis is null then
      format('No prequalification basis is recorded for %s on this package. "We asked three contractors" is not a prequalification, and I.15''s contractor quality history is what this field is meant to cite.', s.name) end,
    'safetyQualificationStatus', s.safety_qualification_status,
    'safetyQualificationWarning', case
      when s.safety_qualification_status in ('suspended','disqualified') then
        format('%s is recorded as %s on safety qualification. Inviting them is a decision somebody is making.',
               s.name, s.safety_qualification_status)
      when s.safety_qualification_status = 'not_assessed' then
        format('%s has never been assessed for safety qualification.', s.name) end);
end
$$;

revoke all on function public.invite_package_bidder(bigint, bigint, text) from public, anon;
grant execute on function public.invite_package_bidder(bigint, bigint, text)
  to authenticated, service_role;

comment on function public.invite_package_bidder(bigint, bigint, text) is
  'D6.04 / spec I.16 Bidder: puts a supplier on one package''s bidder register. Refuses after the envelope is opened (a bidder invited then would be bidding against known prices) and NAMES a missing prequalification basis and a suspended safety qualification rather than staying quiet about either.';

create or replace function public.open_package_bidding(
  p_package_id bigint,
  p_close_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p contract_packages%rowtype;
  v_bids int;
  v_reissue boolean := false;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'issuing a tender requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.bids_opened_at is not null then
    return jsonb_build_object('error', format(
      'bids on package %s were already opened on %s', p.package_code, p.bids_opened_at));
  end if;
  if p_close_at is null or p_close_at <= now() then
    return jsonb_build_object('error',
      'the tender close must be in the future — a tender that closes in the past accepts nothing and reads as an open one');
  end if;
  select count(*) into v_bids from contract_bids
   where package_id = p.id and withdrawn_at is null;
  -- A LIVE TENDER'S CLOSE IS NOT PULLED FORWARD. There was no guard against
  -- re-issuing an already-issued package and none that the new close was not
  -- earlier than the standing one, so a second call collapsed a week-long
  -- window to one second: every remaining bidder was refused as late,
  -- open_package_bids became available immediately, and both calls recorded
  -- the same audit `action`. With a shortened close and an unguarded
  -- withdrawal after it, one planner could drop the inconvenient bidder and
  -- then open. Extending a close costs the bidders nothing and is allowed;
  -- shortening one after an offer has arrived is refused by name.
  if v_bids > 0 and p.bids_close_at is not null and p_close_at < p.bids_close_at then
    return jsonb_build_object('error', format(
      'package %s is issued and closes %s, and %s bid(s) have already been lodged against that date. Bringing the close forward to %s cuts off every bidder still working to the published one and hands whoever asked for it a shorter field. A close is extended, not shortened.',
      p.package_code, p.bids_close_at, v_bids, p_close_at));
  end if;
  v_reissue := p.bids_close_at is not null;
  -- SCOPE BEFORE PRICE. A tender issued against a package with no scope of
  -- work and no acceptance criteria is what produces a claim eighteen months
  -- later, and this is the last moment it costs nothing to say so.
  if coalesce(length(btrim(coalesce(p.scope_of_work, ''))), 0) < 20
     or coalesce(length(btrim(coalesce(p.acceptance_criteria, ''))), 0) < 20 then
    return jsonb_build_object('error', format(
      'package %s has no %s recorded. Bidders price what they are told; the questions a claim gets made against later are exactly the ones this package has not answered, and every bid received against it will be priced against a different reading of the scope.',
      p.package_code,
      case
        when coalesce(length(btrim(coalesce(p.scope_of_work, ''))), 0) < 20
             and coalesce(length(btrim(coalesce(p.acceptance_criteria, ''))), 0) < 20
          then 'scope of work or acceptance criteria'
        when coalesce(length(btrim(coalesce(p.scope_of_work, ''))), 0) < 20
          then 'scope of work'
        else 'acceptance criteria' end));
  end if;

  perform set_config('app.procurement_package_write', 'granted', true);
  update contract_packages
     set bids_close_at = p_close_at,
         commercial_status = 'tendered',
         status_updated_at = now()
   where id = p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_tender', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code,
      -- A RE-ISSUE IS ITS OWN ACT IN THE LEDGER. Both calls recorded `issued`,
      -- so a tender whose close had been moved after bids arrived read as one
      -- that was issued once.
      'action', case when v_reissue then 'reissued' else 'issued' end,
      'liveBidsAtReissue', case when v_reissue then v_bids end),
    jsonb_build_object('bids_close_at', p.bids_close_at,
      'commercial_status', p.commercial_status),
    jsonb_build_object('bids_close_at', p_close_at, 'commercial_status', 'tendered'));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'bidsCloseAt', p_close_at, 'commercialStatus', 'tendered',
    'reissued', v_reissue,
    'reissueNote', case when v_reissue then format(
      'This package was already issued with a close of %s. The close is now %s and %s live bid(s) stand against the earlier date; the ledger records this as a re-issue, not as a first issue.',
      p.bids_close_at, p_close_at, v_bids) end,
    'invitedBidders', (select count(*) from package_bidders where package_id = p.id));
end
$$;

revoke all on function public.open_package_bidding(bigint, timestamptz) from public, anon;
grant execute on function public.open_package_bidding(bigint, timestamptz)
  to authenticated, service_role;

comment on function public.open_package_bidding(bigint, timestamptz) is
  'D6.04: issues the tender — sets the close, moves the §25 commercial dimension to `tendered`. Refuses a package with no scope of work or no acceptance criteria BY NAME: bidders price what they are told, and this is the last moment that costs nothing to fix.';

create or replace function public.submit_sealed_bid(
  p_package_id bigint,
  p_bid jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p contract_packages%rowtype;
  s suppliers%rowtype;
  b package_bidders%rowtype;
  v_supplier_code text := nullif(btrim(coalesce(p_bid->>'supplier_code','')), '');
  v_ref text := nullif(btrim(coalesce(p_bid->>'bid_ref','')), '');
  v_price numeric := sync_finite_money(p_bid->>'price');
  v_hours numeric := sync_finite_money(p_bid->>'labour_hours');
  v_factor numeric := sync_finite_money(p_bid->>'assumed_productivity_factor');
  v_currency text := upper(nullif(btrim(coalesce(p_bid->>'currency','')), ''));
  v_basis text := nullif(btrim(coalesce(p_bid->>'price_basis','')), '');
  v_days integer;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'lodging a bid requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.bids_close_at is null then
    return jsonb_build_object('error', format(
      'package %s has not been issued for tender. Issue it (open_package_bidding) before bids are lodged — a bid against a package with no close date is one nobody can say arrived on time.',
      p.package_code));
  end if;
  if p.bids_opened_at is not null then
    return jsonb_build_object('error', format(
      'bids on package %s were opened on %s. A bid lodged after the envelope is open is a bid priced against known competitors.',
      p.package_code, p.bids_opened_at));
  end if;
  if p.bids_close_at <= now() then
    return jsonb_build_object('error', format(
      'the tender for package %s closed on %s. A late bid is refused: accepting one is the same act as re-opening the tender for one bidder.',
      p.package_code, p.bids_close_at));
  end if;

  if v_supplier_code is null then
    return jsonb_build_object('error', 'name the bidder (supplier_code)');
  end if;
  select * into s from suppliers where organization_id = v_org and supplier_code = v_supplier_code;
  if not found then
    return jsonb_build_object('error', format('supplier %s not found', v_supplier_code));
  end if;
  -- SEALED MEANS INVITED. A bid from somebody nobody invited is either a
  -- mistake or a route around the bidder register and its prequalification.
  select * into b from package_bidders where package_id = p.id and supplier_id = s.id;
  if not found then
    return jsonb_build_object('error', format(
      '%s is not on the bidder register for %s. Invite them first (invite_package_bidder) — the register is where the prequalification is recorded, and a bid from outside it has none.',
      s.name, p.package_code));
  end if;
  if b.status = 'disqualified' then
    return jsonb_build_object('error', format(
      '%s is disqualified from this package: %s', s.name, b.disqualified_reason));
  end if;
  -- ONE ROW PER BIDDER PER PACKAGE, live or withdrawn. `idx_cb_pair`
  -- (20260817140000) makes that a schema fact and this file does not relax it:
  -- a withdrawn bid is kept ON ITS OWN ROW so a bid that was received and a
  -- bid that never arrived can never look the same, and a second row for the
  -- same pair would be the place a replacement price hides. The consequence —
  -- a bidder who withdraws cannot lodge a replacement under the same supplier
  -- code — is named here rather than discovered as a unique-violation, and is
  -- carried as a stated residual on register row D6.04.
  if exists (select 1 from contract_bids
              where package_id = p.id and supplier_id = s.id) then
    return jsonb_build_object('error', format(
      '%s already has a bid on %s (%s). One bidder holds one bid row per package: the withdrawn bid is retained as evidence that an offer was received, so a replacement is not lodged under the same bidder. Issue a fresh package if the tender is being re-run.',
      s.name, p.package_code,
      case when exists (select 1 from contract_bids
                         where package_id = p.id and supplier_id = s.id
                           and withdrawn_at is not null)
        then 'withdrawn, and retained' else 'live' end));
  end if;

  if v_price is null or v_price < 0 then
    return jsonb_build_object('error', format(
      'the bid price is %s; it must be a finite amount of at least zero. NaN and infinity are legal numeric values in Postgres and pass every comparison test vacuously — NaN is not less than zero and turns every downstream total into NaN — so they are refused before the number reaches the tender.',
      coalesce(nullif(btrim(coalesce(p_bid->>'price','')), ''), 'absent')));
  end if;
  if v_hours is not null and v_hours < 0 then
    return jsonb_build_object('error', 'labour_hours cannot be negative');
  end if;
  if v_factor is not null and v_factor <= 0 then
    return jsonb_build_object('error',
      'assumed_productivity_factor must be greater than zero — it is the divisor that puts two bids on the same footing, and a zero or negative one makes the comparison meaningless');
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error',
      'state the currency of the bid as a three-letter code (for example CAD). Sync holds no exchange rate: two bids in different currencies are not compared, and an award ceiling in another currency is refused rather than converted.');
  end if;
  if nullif(btrim(coalesce(p_bid->>'duration_days','')), '') is not null then
    begin
      v_days := btrim(p_bid->>'duration_days')::integer;
    exception when others then
      return jsonb_build_object('error', 'duration_days is not a whole number of days');
    end;
    if v_days < 0 then
      return jsonb_build_object('error', 'duration_days cannot be negative');
    end if;
  end if;

  perform set_config('app.sealed_bid_write', 'granted', true);
  insert into contract_bids
    (organization_id, package_id, supplier_id, price, labour_hours,
     assumed_productivity_factor, duration_days, inclusions, qualifications,
     submitted_on, bid_ref, sealed_at, submitted_by, currency, price_basis)
  values
    (v_org, p.id, s.id, v_price, v_hours, v_factor, v_days,
     nullif(btrim(coalesce(p_bid->>'inclusions','')), ''),
     nullif(btrim(coalesce(p_bid->>'qualifications','')), ''),
     current_date,
     coalesce(v_ref, p.package_code || '-' || s.supplier_code),
     now(), auth.uid(), v_currency, v_basis)
  returning id into v_id;

  perform set_config('app.sealed_bid_write', '', true);

  perform set_config('app.package_bidder_write', 'granted', true);
  update package_bidders set status = 'submitted' where id = b.id;
  perform set_config('app.package_bidder_write', '', true);

  -- THE AUDIT ROW CARRIES NO PRICE. audit_events is readable by the tenant,
  -- and a sealed bid whose amount is legible in the audit ledger while the
  -- tender is open is not sealed. What happened is recorded; what was offered
  -- is not, until the envelope is opened.
  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'sealed_bid', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'bid_id', v_id, 'action', 'submitted'),
    null,
    jsonb_build_object('supplier', s.name, 'bid_ref',
      coalesce(v_ref, p.package_code || '-' || s.supplier_code),
      'currency', v_currency, 'sealed', true,
      'note', 'The bid content is deliberately absent from this audit row: audit_events is readable by the tenant, and a price legible here while the tender is open is not sealed.'));

  return jsonb_build_object('bid_id', v_id, 'package_code', p.package_code,
    'supplier', s.name,
    'bidRef', coalesce(v_ref, p.package_code || '-' || s.supplier_code),
    'sealed', true,
    'sealedUntil', 'the bids on this package are opened',
    'productivityStated', v_factor is not null,
    'comparabilityWarning', case when v_factor is null then
      'This bid states no assumed productivity factor. Two bids are not comparable until each says how much work it assumed gets done per hour, and the comparison will be returned as UNSAFE rather than as a ranking with a caveat nobody reads.' end);
end
$$;

revoke all on function public.submit_sealed_bid(bigint, jsonb) from public, anon;
grant execute on function public.submit_sealed_bid(bigint, jsonb) to authenticated, service_role;

comment on function public.submit_sealed_bid(bigint, jsonb) is
  'D6.04 / spec I.16 Bid: lodges a bid UNDER SEAL. Refuses a bidder not on the register, a late bid, a bid after the envelope is opened, a second bid from the same bidder, and any price that is not a finite non-negative number. The row is frozen at submission by enforce_sealed_bid_integrity and invisible to every client until the open act, and the audit row deliberately carries no price.';

create or replace function public.withdraw_sealed_bid(
  p_bid_id bigint,
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
  b contract_bids%rowtype;
  p contract_packages%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'withdrawing a bid requires a planning, engineering or governance role');
  end if;
  select * into b from contract_bids where id = p_bid_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'bid not found');
  end if;
  select * into p from contract_packages where id = b.package_id;
  if p.bids_opened_at is not null then
    return jsonb_build_object('error', format(
      'bids on package %s were opened on %s. A bid is not withdrawn after the envelope is open — the offers are known, and removing one then changes the field the award is made from.',
      p.package_code, p.bids_opened_at));
  end if;
  -- BEFORE THE CLOSE, WHICH IS WHAT THIS FILE'S OWN HEADER SAYS: "the only
  -- permitted later transition is withdrawal, before close". The function
  -- contained no reference to bids_close_at at all and refused only after the
  -- OPEN act, so a bid could be pulled out of a closed tender in the window
  -- between the close and the opening — and because one bidder holds one bid
  -- row per package, that bidder can never re-lodge, so the field was shaped
  -- after the deadline. With a close that can be brought forward, one planner
  -- could shorten the tender, drop the inconvenient bidder, then open.
  if p.bids_close_at is not null and p.bids_close_at <= now() then
    return jsonb_build_object('error', format(
      'the tender for package %s closed on %s. A bid is withdrawn before the close, not after it: once the deadline has passed the field is what it is, and removing an offer from it now shapes the competition the award will be made from. The envelope is opened with every bid that was lodged in time.',
      p.package_code, p.bids_close_at));
  end if;
  if b.withdrawn_at is not null then
    return jsonb_build_object('error', 'this bid was already withdrawn');
  end if;
  if v_reason is null or length(v_reason) < 10 then
    return jsonb_build_object('error',
      'state why the bid is withdrawn (10 characters minimum). A withdrawal is FINAL for this bidder on this package: the row is retained as evidence that an offer was received, and one bidder holds one bid row per package.');
  end if;

  perform set_config('app.sealed_bid_write', 'granted', true);
  update contract_bids
     set withdrawn_at = now(), withdrawn_reason = v_reason
   where id = b.id;
  perform set_config('app.sealed_bid_write', '', true);
  perform set_config('app.package_bidder_write', 'granted', true);
  update package_bidders
     set status = 'withdrawn'
   where package_id = b.package_id and supplier_id = b.supplier_id;
  perform set_config('app.package_bidder_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'sealed_bid', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'bid_id', b.id, 'action', 'withdrawn'),
    jsonb_build_object('withdrawn', false),
    jsonb_build_object('withdrawn', true, 'reason', v_reason));

  return jsonb_build_object('bid_id', b.id, 'withdrawn', true, 'reason', v_reason);
end
$$;

revoke all on function public.withdraw_sealed_bid(bigint, text) from public, anon;
grant execute on function public.withdraw_sealed_bid(bigint, text)
  to authenticated, service_role;

comment on function public.withdraw_sealed_bid(bigint, text) is
  'D6.04: the ONE permitted change to a sealed bid after submission, and only before the envelope is opened. The row and its price survive — a withdrawn bid is marked, never deleted, because a bid that was received and a bid that never arrived must not look the same.';

-- ---------------------------------------------------------------------------
-- 7. THE OPEN ACT. The single moment the seal comes off, recorded with the
--    person who did it.
-- ---------------------------------------------------------------------------
create or replace function public.open_package_bids(
  p_package_id bigint,
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
  p contract_packages%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_live int;
  v_total int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'opening the sealed bids on a tender is a §70 human act. The AI may prepare the tender documents and normalise the offers once they are open; it does not decide the moment the prices become known.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'opening sealed bids requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.bids_close_at is null then
    return jsonb_build_object('error', format(
      'package %s has not been issued for tender', p.package_code));
  end if;
  if p.bids_opened_at is not null then
    return jsonb_build_object('error', format(
      'bids on package %s were opened on %s by %s. An envelope is opened once.',
      p.package_code, p.bids_opened_at,
      coalesce((select email from user_profiles where id = p.bids_opened_by), 'somebody')));
  end if;
  -- OPENING BEFORE THE CLOSE IS THE LEAK. Whoever sees the prices while the
  -- tender is still running can tell a favoured bidder what to beat.
  if p.bids_close_at > now() then
    return jsonb_build_object('error', format(
      'the tender for package %s does not close until %s. Opening the envelope while bidders can still submit is the leak sealing exists to prevent: whoever reads the prices now can tell a remaining bidder exactly what to beat.',
      p.package_code, p.bids_close_at));
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'record the opening (note, 20 characters minimum) — who was present, and what was found in the envelopes');
  end if;

  select count(*) filter (where withdrawn_at is null), count(*)
    into v_live, v_total
  from contract_bids where package_id = p.id;

  -- REFUSAL-FIRST. A tender with nothing in it is not an opened tender, and
  -- recording an open act over zero bids would put the package into
  -- `bids_received` — a state whose whole meaning is that bids arrived.
  if coalesce(v_live, 0) = 0 then
    return jsonb_build_object('error', format(
      'no live bid was lodged on package %s (%s received, %s withdrawn). There is nothing to open. A package with no bids is not a package that was evaluated and found wanting — re-issue the tender, or record why the market did not respond.',
      p.package_code, v_total, v_total - v_live));
  end if;

  perform set_config('app.procurement_package_write', 'granted', true);
  update contract_packages
     set bids_opened_at = now(),
         bids_opened_by = auth.uid(),
         commercial_status = 'bids_received',
         status_updated_at = now()
   where id = p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_tender', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'action', 'bids_opened'),
    jsonb_build_object('bids_opened_at', null, 'commercial_status', p.commercial_status),
    jsonb_build_object('bids_opened_at', now(), 'opened_by', auth.uid(),
      'commercial_status', 'bids_received', 'liveBids', v_live,
      'withdrawnBids', v_total - v_live, 'note', v_note));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'openedAt', now(), 'liveBids', v_live, 'withdrawnBids', v_total - v_live,
    'commercialStatus', 'bids_received');
end
$$;

revoke all on function public.open_package_bids(bigint, text) from public, anon;
grant execute on function public.open_package_bids(bigint, text) to authenticated, service_role;

comment on function public.open_package_bids(bigint, text) is
  'D6.04 / spec §70: THE OPEN ACT — the single moment the seal comes off, recorded with the person who did it. Refuses before the close (opening early is the leak sealing exists to prevent), refuses a second opening, refuses the AI-operator identity by name, and REFUSES over zero live bids rather than recording a tender that was opened and found empty as one that was evaluated.';

-- ---------------------------------------------------------------------------
-- 8. THE EVALUATION DOOR.
-- ---------------------------------------------------------------------------
create or replace function public.record_bid_evaluation(
  p_bid_id bigint,
  p_evaluation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  b contract_bids%rowtype;
  p contract_packages%rowtype;
  v_kind text := lower(nullif(btrim(coalesce(p_evaluation->>'evaluation_kind','')), ''));
  v_outcome text := lower(nullif(btrim(coalesce(p_evaluation->>'outcome','')), ''));
  v_rationale text := nullif(btrim(coalesce(p_evaluation->>'rationale','')), '');
  v_score numeric := sync_finite_money(p_evaluation->>'score');
  v_criteria jsonb := coalesce(p_evaluation->'criteria', '{}'::jsonb);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'scoring a bid is a §70 human act. The AI may normalise the offers, list the qualifications and draft the comparison; whether an offer meets the specification and whether its price is acceptable are judgements a named person makes and is accountable for.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'evaluating a bid requires a planning, engineering or governance role');
  end if;
  select * into b from contract_bids where id = p_bid_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'bid not found');
  end if;
  select * into p from contract_packages where id = b.package_id;
  if v_kind is null or not (v_kind = any (sync_bid_evaluation_kinds())) then
    return jsonb_build_object('error', format(
      'evaluation_kind must be one of: %s (spec I.16 names TechnicalEvaluation and CommercialEvaluation as separate objects because they are separate judgements by separate people)',
      array_to_string(sync_bid_evaluation_kinds(), ', ')));
  end if;
  if v_outcome is null or not (v_outcome = any (sync_bid_evaluation_outcomes())) then
    return jsonb_build_object('error', format(
      'outcome must be one of: %s', array_to_string(sync_bid_evaluation_outcomes(), ', ')));
  end if;
  if v_rationale is null or length(v_rationale) < 20 then
    return jsonb_build_object('error',
      'state the reasoning (rationale, 20 characters minimum). A score with no rationale is a number nobody can argue with, which is what an evaluation must never be.');
  end if;
  if nullif(btrim(coalesce(p_evaluation->>'score','')), '') is not null
     and (v_score is null or v_score < 0 or v_score > 100) then
    return jsonb_build_object('error', format(
      'the score is %s; it must be a finite number between 0 and 100',
      coalesce(nullif(btrim(coalesce(p_evaluation->>'score','')), ''), 'absent')));
  end if;
  if jsonb_typeof(v_criteria) <> 'object' then
    return jsonb_build_object('error', 'criteria must be a JSON object');
  end if;
  if exists (select 1 from bid_evaluations
              where bid_id = b.id and evaluation_kind = v_kind) then
    return jsonb_build_object('error', format(
      'a %s evaluation of this bid is already recorded, and an evaluation is frozen once written. Re-scoring a bid after the prices are known is the defect sealed bidding exists to prevent; if the first evaluation was wrong, the award record and its basis are where that is said.',
      v_kind));
  end if;

  -- The two separation-of-duties legs and the envelope check are enforced at
  -- the TABLE for every writer. They are repeated at this door so the person
  -- doing it reads a sentence rather than a trigger's exception.
  if p.bids_opened_at is null then
    return jsonb_build_object('error', format(
      'bids on package %s have not been opened. A bid cannot be evaluated before the envelope is opened.',
      p.package_code));
  end if;
  if p.awarded_by is not null and p.awarded_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you awarded package %s. An award is a decision taken on somebody else''s assessment, so the awarder does not also evaluate.',
      p.package_code));
  end if;
  if b.submitted_by is not null and b.submitted_by = auth.uid() then
    return jsonb_build_object('error',
      'you lodged this bid. Nobody evaluates their own offer.');
  end if;
  -- THE TWO EVALUATIONS ARE TWO PEOPLE. Named at the door; enforced at the
  -- table for every writer by enforce_bid_evaluation_integrity.
  if exists (select 1 from bid_evaluations e
              where e.bid_id = b.id and e.evaluation_kind <> v_kind
                and e.evaluator_id = auth.uid()) then
    return jsonb_build_object('error', format(
      'you already recorded the %s evaluation of this bid. Spec I.16 makes the technical and the commercial evaluation separate objects because they are separate judgements by separate people — one person holding both is how a technically non-compliant bid comes to win on price. Route the %s evaluation to somebody else.',
      (select string_agg(distinct e.evaluation_kind, ' and ' order by e.evaluation_kind)
         from bid_evaluations e where e.bid_id = b.id and e.evaluator_id = auth.uid()),
      v_kind));
  end if;

  perform set_config('app.bid_evaluation_write', 'granted', true);
  insert into bid_evaluations
    (organization_id, package_id, bid_id, evaluation_kind, evaluator_id,
     outcome, score, criteria, rationale)
  values (v_org, p.id, b.id, v_kind, auth.uid(), v_outcome, v_score, v_criteria, v_rationale)
  returning id into v_id;
  perform set_config('app.bid_evaluation_write', '', true);

  perform set_config('app.procurement_package_write', 'granted', true);
  if v_kind = 'technical'
     and p.technical_status in ('not_started', 'specification_issued') then
    update contract_packages
       set technical_status = 'technically_evaluated', status_updated_at = now()
     where id = p.id;
  elsif v_kind = 'commercial' and p.commercial_status = 'bids_received' then
    update contract_packages
       set commercial_status = 'commercially_evaluated', status_updated_at = now()
     where id = p.id;
  end if;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'bid_evaluation', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'bid_id', b.id, 'evaluation_id', v_id,
      'evaluation_kind', v_kind),
    null,
    jsonb_build_object('evaluation_kind', v_kind, 'outcome', v_outcome,
      'score', v_score, 'rationale', v_rationale, 'evaluator', auth.uid()));

  return jsonb_build_object('evaluation_id', v_id, 'bid_id', b.id,
    'package_code', p.package_code, 'evaluationKind', v_kind, 'outcome', v_outcome,
    'score', v_score, 'frozen', true,
    'awaiting', (select string_agg(k, ', ' order by k)
                 from unnest(sync_bid_evaluation_kinds()) k
                 where not exists (select 1 from bid_evaluations e
                                    where e.bid_id = b.id and e.evaluation_kind = k)));
end
$$;

revoke all on function public.record_bid_evaluation(bigint, jsonb) from public, anon;
grant execute on function public.record_bid_evaluation(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_bid_evaluation(bigint, jsonb) is
  'D6.04 / spec I.16: records a TechnicalEvaluation or a CommercialEvaluation of one bid. Refuses before the envelope is opened, refuses a second evaluation of the same kind (an evaluation is frozen once written), refuses the AI-operator identity by name, refuses the awarder and refuses the bid''s own submitter. Every one of those is ALSO enforced at the table for every writer.';

-- ---------------------------------------------------------------------------
-- 9. THE EXISTING /materials BID READ LEARNS WHAT THE SEAL DID TO IT.
--
--    `get_package_bids` (20260817140000) is SECURITY INVOKER and granted to
--    `authenticated`, so the narrowed cb_read policy now hides sealed bids
--    from it — and it returned a SHORT list with no indication that anything
--    had been withheld. `compareBids` (src/lib/supply/index.ts) then states
--    the absence as a fact: "No bids are recorded for this package" over a
--    tender that has three. A read that cannot see something must say so; an
--    empty set REFUSES rather than reporting a confident zero.
--
--    Edited by TRANSFORMATION of the live body, not re-typed: this function
--    predates the slice and re-declaring it here would revert anything fixed
--    in it since.
-- ---------------------------------------------------------------------------
create or replace function public.sync_sealed_bid_withheld_count(p_package_id bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  -- The FACT of a submission, never its content. get_package_tender already
  -- returns the same fact (who was invited, who has lodged) while the tender
  -- is sealed; a count is not a price and this is what stops the invoker read
  -- from reporting an empty tender.
  select coalesce((
    select count(*)::int from contract_bids b
    join contract_packages p on p.id = b.package_id
    where b.package_id = p_package_id
      and p.organization_id = app_current_org()
      and p.bids_close_at is not null
      and p.bids_opened_at is null), 0);
$$;

revoke all on function public.sync_sealed_bid_withheld_count(bigint) from public, anon;
grant execute on function public.sync_sealed_bid_withheld_count(bigint)
  to authenticated, service_role;

comment on function public.sync_sealed_bid_withheld_count(bigint) is
  'D6.04: how many bids the row-level seal is withholding from a client on one package. Returns the FACT of submission and never its content, so the pre-existing invoker read get_package_bids can say "3 sealed bids withheld" instead of returning an empty list that reads as a tender nobody entered.';

do $bids$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_package_bids';
  if v_def is null then
    raise exception
      'get_package_bids does not exist — the /materials bid read this slice''s seal narrows is missing.'
      using errcode = 'check_violation';
  end if;
  if position('tenderSealed' in v_def) = 0 then
    v_new := replace(v_def,
      $old$    'siteConditionsStated', p.site_conditions_stated,$old$,
      $new$    'siteConditionsStated', p.site_conditions_stated,
    -- 20261208090100 (marked insertion): the seal. cb_read now hides every bid
    -- on an issued-but-unopened package from every client, so this read must
    -- say what it cannot see rather than returning a short list as a complete
    -- one.
    'tenderSealed', (p.bids_close_at is not null and p.bids_opened_at is null),
    'withheldBidCount', sync_sealed_bid_withheld_count(p.id),
    'sealNote', case when p.bids_close_at is not null and p.bids_opened_at is null
      then format('The tender for %s closes %s and its envelopes have not been opened. %s bid(s) have been lodged and every one of them is withheld from this read: the list below is not this package''s bids, and an empty one here is not a tender nobody entered.',
                  p.package_code, p.bids_close_at, sync_sealed_bid_withheld_count(p.id))
      end,$new$);
    if v_new = v_def then
      raise exception
        'the `siteConditionsStated` key of get_package_bids was not found — do not narrow a read blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$bids$;

notify pgrst, 'reload schema';
