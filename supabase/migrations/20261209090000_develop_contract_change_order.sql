-- ============================================================================
-- Sync Develop — Slice 6B, part 1 of 4.
-- D6.06 (Commercial lifecycle objects, spec I.16) — the CHANGE ORDER, and the
-- ONE predicate for what a contract is worth today.
--
-- WHAT SLICE 6A LEFT, AND WHY THIS FILE IS SHAPED THE WAY IT IS.
--
--   * The award is FROZEN for every caller once decided
--     (enforce_procurement_package_integrity, 20261208090000). `awarded_value`
--     cannot be edited by anybody, service paths included, and that is
--     deliberate: an award that can be rewritten afterwards is an award nobody
--     can rely on. So a change order does NOT move `awarded_value`. It is its
--     own recorded act, and the contract's value TODAY is the award plus the
--     approved change orders — read from ONE function, contract_current_value.
--
--   * `project_cost_items.commitment` has exactly ONE writer
--     (enforce_cost_item_contract_commitment, 20261208090200:862): the sum of
--     the approved contract commitment lines pointing at that cost line.
--     NOTHING HERE BECOMES A SECOND SOURCE OF COMMITTED COST. An approved
--     change order raises the CEILING the commitment lines are checked
--     against; the money still reaches the cost model through
--     record_contract_commitment_line → approve_contract_commitments →
--     record_cost_item's own door, exactly as before. This file adds no write
--     to project_cost_items at all.
--
--   * The award routes through `authority_limits.action_type =
--     'contract_award'` with a CUMULATIVE per-case ceiling (4D-R8, applied in
--     sync_contract_award_authority). A change order commits the owner's
--     capital in precisely the same way, so it routes through THE SAME
--     evaluator — not a second one — and that evaluator is EXTENDED here to
--     count approved change orders in its cumulative measure. Without that,
--     one procurement split across five change orders, each individually under
--     the ceiling, defeats the delegation exactly as splitting it across two
--     packages did before 4D-R8 was applied to the award.
--
-- REFUSAL-FIRST, and the refusals this file adds:
--   * a change order in a currency the contract is not denominated in refuses
--     rather than being added to it — Sync holds no exchange rate;
--   * a change order that moves neither money nor time refuses, because it is
--     not a change to anything;
--   * a decided change order is FROZEN for every writer, and is never deleted;
--   * an approved change order that would take the contract below the
--     commitments already approved against it refuses and names them, because
--     the cost model would then carry committed money the contract no longer
--     obliges;
--   * a change order on a package with no development case refuses: the
--     cumulative ceiling is measured per case, and a change order outside every
--     case is a change order outside every ceiling.
--
-- §70: approving a change order is a human act, refused for the AI-operator
-- identity at the door and at the table.
--
-- Canonical reuse: contract_packages, authority_limits,
-- sync_contract_award_authority, contract_commitment_lines,
-- contract_commitment_position, enforce_procurement_act_is_human,
-- record_procurement_service_write, sync_finite_money, audit_events,
-- security_events.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CHANGE ORDER.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_change_orders (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- CASCADE at the constraint, refused at the wall — the
  -- contract_commitment_lines posture (20261208090200:635), for the same
  -- reason: a development case teardown cascades to contract_packages, and a
  -- RESTRICT reached first would make the case permanently undeletable.
  package_id bigint not null references contract_packages(id) on delete cascade,
  change_order_ref text not null check (btrim(change_order_ref) <> ''),
  description text not null check (length(btrim(description)) >= 20),
  reason text not null check (length(btrim(reason)) >= 20),
  -- NOT NULL on purpose, and the opposite decision from
  -- contract_commitment_lines.amount. An unpriced COMMITMENT LINE is a real
  -- state that the total refuses over and names; an unpriced CHANGE ORDER is
  -- not a change order at all — it is a variation somebody will price later,
  -- and recording it as one would put an authority-bearing act on the ledger
  -- with no amount for the ceiling to be checked against.
  value_delta numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  time_delta_days int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'withdrawn')),
  recorded_by uuid references auth.users(id),
  -- WHO SET THE NUMBER, which is not always who opened the draft. The
  -- separation-of-duties rule is "you may not approve a figure you set", and
  -- keying it on recorded_by alone left a hole with a name: a second person
  -- rewrites the value_delta on somebody else's draft (record_contract_change_order
  -- revises in place and does NOT move recorded_by) and then approves their
  -- own number. Both actors are refused at the decision.
  last_priced_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  authority_limit_id uuid references authority_limits(id),
  -- What the contract was worth immediately before and after THIS approval,
  -- recorded on the row so the sequence is readable without replaying it.
  contract_value_before numeric,
  contract_value_after numeric,
  unique (package_id, change_order_ref),
  -- 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so `<> 0` does not
  -- keep NaN out and every downstream sum becomes NaN.
  constraint change_order_delta_finite check (
    value_delta <> 'NaN'::numeric
    and value_delta > '-Infinity'::numeric
    and value_delta < 'Infinity'::numeric),
  constraint change_order_time_sane check (time_delta_days between -3650 and 3650),
  constraint change_order_moves_something check (
    value_delta <> 0 or time_delta_days <> 0),
  -- TWO EQUALITIES, NOT A CONJUNCTION (the 6A commitment-line lesson):
  -- `decided_at = now(), decided_by = null` passes a folded check, and the
  -- actor column is exactly what the §70 wall reads, where a NULL actor is an
  -- early return.
  constraint change_order_decision_actor check (
    (decided_at is null) = (decided_by is null)),
  constraint change_order_decision_note check (
    (decided_at is null) = (decision_note is null)),
  constraint change_order_decision_said_something check (
    decision_note is null or length(btrim(decision_note)) >= 20),
  constraint change_order_decided_status check (
    (status in ('approved', 'rejected', 'withdrawn')) = (decided_at is not null)),
  -- An approved change order quotes the ceiling it passed and the value it
  -- moved the contract between. A row that says 'approved' and cites neither
  -- is an approval with nothing behind it.
  constraint change_order_approval_record check (
    (status = 'approved') = (contract_value_before is not null)
    and (status = 'approved') = (contract_value_after is not null)
    and (status = 'approved') = (authority_limit_id is not null))
);

create index if not exists idx_change_orders_package
  on contract_change_orders(organization_id, package_id, status);
create index if not exists idx_change_orders_approved
  on contract_change_orders(package_id) where status = 'approved';

alter table public.contract_change_orders enable row level security;
drop policy if exists change_orders_read on public.contract_change_orders;
create policy change_orders_read on public.contract_change_orders
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: change orders are recorded and decided through the
-- definer RPCs below.

comment on table public.contract_change_orders is
  'D6.06 / spec I.16 ChangeOrder × §21: a recorded change to an AWARDED contract''s value and time. The award itself is frozen for every caller (20261208090000), so this table — not `contract_packages.awarded_value` — is where a contract moves after signature, and contract_current_value() is the ONE place the two are added together. Approving one is an authority-bearing act routed through authority_limits.action_type = ''contract_award'', the same store and the same evaluator the award used.';
comment on column public.contract_change_orders.value_delta is
  'Signed. A positive delta commits more of the owner''s capital; a negative one releases it. THE AUTHORITY CHECK MEASURES THE INCREASE ONLY — decide_contract_change_order passes greatest(value_delta, 0) and the cumulative arm sums greatest(value_delta, 0) — because a delegation ceiling is a measure of what this person may COMMIT on one project. Measuring a reduction as if it committed money produced a refusal that stated the opposite of its own arithmetic ("a further 650000 would take your total to 1300000" for an act that took it to 0); measuring it as a negative let a de-scope buy fresh headroom on somebody else''s contract. A reduction consumes no ceiling and releases none, and is still §70-human, role-gated, refused for its own author, refused below what is already committed or certified, and frozen once decided.';
comment on column public.contract_change_orders.authority_limit_id is
  'The adopted authority_limits row this approval was checked against, recorded ON the change order so every approval quotes the ceiling it passed. An adopted delegation is never edited (20261203090400), which is what makes the quotation falsifiable.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE CURRENT-VALUE PREDICATE.
--
--    Read by the change-order door, by the commitment position (transformed
--    below), by the invoice and claim families in 20261209090100, and by every
--    read surface. There is no second arithmetic for "what is this contract
--    worth now" anywhere.
--
--    The sum is single-currency BY CONSTRUCTION, not by a check here: a change
--    order's currency is forced equal to the contract's at the door AND at the
--    wall, so this function can never add two units together.
-- ---------------------------------------------------------------------------
create or replace function public.contract_current_value(p_package_id bigint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when p.awarded_at is null then null else
    p.awarded_value + coalesce((
      select sum(co.value_delta) from contract_change_orders co
       where co.package_id = p.id and co.status = 'approved'), 0)
  end
  from contract_packages p
  where p.id = p_package_id;
$$;

revoke all on function public.contract_current_value(bigint)
  from public, anon, authenticated, service_role;

comment on function public.contract_current_value(bigint) is
  'D6.06: what an awarded contract is worth TODAY — the frozen award plus every APPROVED change order. NULL for an unawarded package, which is not zero. Not client-callable: it takes a package id and has no tenant gate of its own, exactly as contract_commitment_position does; its callers resolve the tenant first.';

-- ---------------------------------------------------------------------------
-- 3. THE WALLS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_change_order_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.change_order_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_change_orders is the whole record of how an awarded contract moved after signature — the award itself is frozen, so this table is the only account of the difference between the contract signed and the contract being performed. Truncating it restores every contract to its award value with nothing recorded. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade, in the three shapes the sibling walls admit: the
    -- organization, the contract, or the development case the contract belongs
    -- to is already going.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id)
       or not exists (
            select 1 from contract_packages p2
            join development_cases dc on dc.id = p2.development_case_id
            where p2.id = old.package_id) then
      return old;
    end if;
    if old.status <> 'draft' then
      raise exception
        'Change order % was % on %. A decided change order is not deleted: an approved one is part of what the contract is worth and of the authority record behind it, and a rejected one is the evidence that somebody asked and was told no. Record a further change order instead.',
        old.change_order_ref, old.status, old.decided_at
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_procurement_service_write(old.organization_id,
        format('Change order %s', old.change_order_ref), tg_op,
        'A draft change order was deleted outside the definer RPCs.');
    end if;
    return old;
  end if;

  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this change order is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;
  if p.awarded_at is null then
    raise exception
      'Package % is not awarded. A change order changes a CONTRACT; before an award there is no contract to change, and recording one would put a value movement on the ledger against an agreement nobody has made.',
      p.package_code
      using errcode = 'check_violation';
  end if;
  -- ONE CURRENCY. Sync holds no exchange rate: a change order stated in
  -- another currency than the contract it moves would make
  -- contract_current_value add two units together and report the difference
  -- between them as the value of the contract.
  if new.currency is distinct from p.contract_currency then
    raise exception
      'Change order % is stated in % and contract % was awarded in %. Sync holds no exchange rate, so the two are never added: the contract''s current value would otherwise be a sum of two units presented as money.',
      new.change_order_ref, new.currency, p.package_code, p.contract_currency
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A change order is recorded through record_contract_change_order and decided through decide_contract_change_order — the approval is a §70 human act checked against a delegated ceiling. A direct write does it with no role check, no authority check, no audit row and no §70 wall behind the approver.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Change order %s on package %s', new.change_order_ref, p.package_code), tg_op,
      'A change order written outside the RPCs can be born approved, which moves the contract''s value with nobody named as the approver and no ceiling checked.');
  end if;

  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception
      'A change order is recorded as a DRAFT and decided afterwards by a named person holding a delegation. One that arrives already decided records a decision nobody took.'
      using errcode = 'check_violation';
  end if;

  -- THE CITED DELEGATION IS THE ROW'S OWN TENANT'S, AND IT IS A CONTRACT-AWARD
  -- ONE THAT WAS ADOPTED. change_order_approval_record forces an approval to
  -- cite SOME authority_limits row, and the foreign key accepts any row in the
  -- table — so a write that reached this table outside the door could cite
  -- another tenant's delegation, or a draft one, or a contingency ceiling, and
  -- the approval would render as quoting an authority it never passed. The
  -- door only ever cites what the evaluator returned; this is the wall saying
  -- the same thing to every other writer.
  if new.authority_limit_id is not null
     and (tg_op = 'INSERT'
          or new.authority_limit_id is distinct from old.authority_limit_id) then
    if not exists (
         select 1 from authority_limits al
          where al.id = new.authority_limit_id
            and al.organization_id = new.organization_id
            and al.action_type = 'contract_award'
            and al.status = 'adopted') then
      raise exception
        'Change order % cites authority limit % as the ceiling it passed, and that delegation is not an ADOPTED contract-award delegation of this organization. An approval quoting a ceiling it was never checked against is worse than one quoting none: it reads as evidence.',
        new.change_order_ref, new.authority_limit_id
        using errcode = 'check_violation';
    end if;
  end if;

  -- FROZEN ONCE DECIDED, for every writer. The 4D-R17 rule, applied to the
  -- change order: an approved change order that can be re-priced afterwards
  -- leaves the original approval, and the ceiling it was checked against,
  -- standing behind a different number.
  if tg_op = 'UPDATE' and old.decided_at is not null then
    if new.value_delta is distinct from old.value_delta
       or new.currency is distinct from old.currency
       or new.time_delta_days is distinct from old.time_delta_days
       or new.description is distinct from old.description
       or new.reason is distinct from old.reason
       or new.status is distinct from old.status
       or new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at
       or new.decision_note is distinct from old.decision_note
       or new.authority_limit_id is distinct from old.authority_limit_id
       or new.contract_value_before is distinct from old.contract_value_before
       or new.contract_value_after is distinct from old.contract_value_after
       or new.recorded_by is distinct from old.recorded_by
       or new.last_priced_by is distinct from old.last_priced_by
       or new.package_id is distinct from old.package_id then
      raise exception
        'Change order % was % on %. It is FROZEN for every caller: its value, its time effect, the ceiling it was checked against and the decision itself. A change order that can be re-priced after approval leaves the approval standing behind a number nobody approved. Record a further change order.',
        old.change_order_ref, old.status, old.decided_at
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_change_order_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_change_order_integrity on public.contract_change_orders;
create trigger trg_change_order_integrity
  before insert or update or delete on public.contract_change_orders
  for each row execute function public.enforce_change_order_integrity();

drop trigger if exists trg_change_order_no_truncate on public.contract_change_orders;
create trigger trg_change_order_no_truncate
  before truncate on public.contract_change_orders
  for each statement execute function public.enforce_change_order_integrity();

revoke truncate on table public.contract_change_orders
  from anon, authenticated, service_role;

-- §70, on the act spec §70 reserves for a person. The ONE wall, bound to the
-- decision actor, on INSERT and UPDATE.
--
-- THE LABEL NAMES BOTH ACTS THIS COLUMN CARRIES. decided_by is written by the
-- decision AND by withdraw_contract_change_order, so a label reading only
-- "decide" refused a withdrawal with a message about a decision — a refusal
-- that names the wrong act sends the reader looking for a decision nobody
-- made. Both are correctly refused for the AI identity; only the sentence was
-- wrong.
drop trigger if exists trg_change_order_decider_is_human on public.contract_change_orders;
create trigger trg_change_order_decider_is_human
  before insert or update on public.contract_change_orders
  for each row execute function public.enforce_procurement_act_is_human(
    'decided_by', 'decide or withdraw a contract change order');

-- ---------------------------------------------------------------------------
-- 4. THE CUMULATIVE CEILING LEARNS ABOUT CHANGE ORDERS.
--
--    4D-R8, restated once more: "a delegation ceiling that can be defeated by
--    pressing the button twice is not a ceiling". Slice 6A closed the
--    split-across-two-packages hole in sync_contract_award_authority. A change
--    order is the SAME hole through a different door: one procurement awarded
--    small and grown by five change orders, each individually inside the
--    ceiling, commits whatever the approver likes.
--
--    THE EVALUATOR IS EXTENDED, NOT DUPLICATED. There is exactly one function
--    that answers "may this person commit this much on this case", and this is
--    a transformation of its LIVE body — re-typing it here would silently
--    revert whatever has been fixed in it since. It raises if its anchor has
--    moved rather than extending an authority rule blind.
-- ---------------------------------------------------------------------------
do $auth$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_contract_award_authority';
  if v_def is null then
    raise exception
      'sync_contract_award_authority does not exist — the Slice 6A award authority this slice extends is missing, and building a second money gate instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('contract_change_orders' in v_def) = 0 then
    v_new := replace(v_def,
      $old$      and cp.contract_currency is not distinct from l.max_commitment_currency;$old$,
      $new$      and cp.contract_currency is not distinct from l.max_commitment_currency;
    -- SLICE 6B: THE APPROVED CHANGE ORDERS THIS PERSON DECIDED ON THIS CASE.
    -- The award is frozen, so a contract grown after signature grows HERE and
    -- nowhere else; a cumulative ceiling that could not see it could be
    -- defeated by awarding small and changing five times.
    --
    -- greatest(value_delta, 0), NOT the signed delta, and the difference is a
    -- hole rather than a rounding choice. `sum(value_delta)` is signed, so an
    -- approved REDUCTION subtracts from the running total; awards contribute
    -- via cp.awarded_by while change orders contribute via co.decided_by, so
    -- the two are not even the same set — a de-scope approved on a contract
    -- SOMEBODY ELSE awarded bought the approver that much fresh headroom, and
    -- it could take v_committed to zero or below, where 6A's `v_committed > 0`
    -- short-circuit skips the cumulative arm entirely with real history behind
    -- it. Measured live before this line was written: a manager holding a CAD
    -- 700,000 ceiling awarded CAD 1,300,000 on one case by signing one
    -- -600,000 change order in between. The ceiling is a measure of how much
    -- of the owner's capital this person has COMMITTED; releasing exposure
    -- never adds headroom, so a reduction consumes nothing and returns
    -- nothing. It is not ungoverned: the reduction is still §70-human,
    -- role-gated, refused for its own author, refused below what is already
    -- committed or certified, and frozen once decided.
    select v_committed + coalesce(sum(greatest(co.value_delta, 0)), 0) into v_committed
    from contract_change_orders co
    join contract_packages cp2 on cp2.id = co.package_id
    where co.organization_id = p_org
      and cp2.development_case_id = p_case_id
      and co.decided_by = p_awarder
      and co.status = 'approved'
      and co.currency is not distinct from l.max_commitment_currency;$new$);
    if v_new = v_def then
      raise exception
        'the cumulative-award subquery of sync_contract_award_authority was not found in the shape Slice 6A left it — do not extend an authority rule blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$auth$;

-- ---------------------------------------------------------------------------
-- 4b. THE CUMULATIVE MEASURE IS SERIALIZED AT ITS OTHER DOOR TOO.
--
--     A cumulative ceiling read without a lock is defeated by pressing the
--     button twice AT ONCE, which is the same hole as pressing it twice.
--     decide_contract_change_order takes the package row and then the case row
--     before it reads the measure; award_contract (Slice 6A) locks the PACKAGE
--     row — which stops one package being awarded twice — and then reads a
--     measure that spans every package on the CASE with nothing serializing it.
--     Two awards on two packages of one case therefore each saw the other's
--     absence, exactly as two change orders did.
--
--     The lock object and the ORDER are the same at every door in this family:
--     package first, then case. A transformation of the live body, asserted,
--     rather than a re-type of a 300-line award act.
-- ---------------------------------------------------------------------------
do $awardlock$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'award_contract';
  if v_def is null then
    raise exception
      'award_contract does not exist — the Slice 6A award act this slice serializes alongside is missing.'
      using errcode = 'check_violation';
  end if;
  if position('for update;  -- the case, after the package' in v_def) = 0 then
    v_new := replace(v_def,
      $old$  -- THE AUTHORITY. Checked against the value of the offer being accepted, in
  -- the currency the offer was made in.
  v_auth := sync_contract_award_authority(v_org, v_role, b.price, b.currency,$old$,
      $new$  -- SLICE 6B: THE CASE IS LOCKED BEFORE THE CUMULATIVE MEASURE IS READ.
  -- The package lock above stops one package being awarded twice; the measure
  -- below spans every package on the case, and two awards on two packages each
  -- read the other's absence. Package first, then case, at every door.
  if p.development_case_id is not null then
    perform 1 from development_cases where id = p.development_case_id
     for update;  -- the case, after the package
  end if;

  -- THE AUTHORITY. Checked against the value of the offer being accepted, in
  -- the currency the offer was made in.
  v_auth := sync_contract_award_authority(v_org, v_role, b.price, b.currency,$new$);
    if v_new = v_def then
      raise exception
        'the authority read of award_contract was not found in the shape Slice 6A left it — do not serialize a money gate blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$awardlock$;

comment on function public.sync_contract_award_authority(uuid, text, numeric, text, uuid, uuid) is
  'D6.05/D6.06 / spec §41-43: THE ONE evaluator for "may this person commit this much on this case". Resolves the adopted contract-award delegation for a role and checks a value against its ceiling. Absence refuses, a null ceiling refuses, a ceiling in another currency refuses rather than converting, and the ceiling is CUMULATIVE (4D-R8) against this person''s AWARDS and, since Slice 6B, their APPROVED CHANGE ORDERS on this case — a delegation that can be defeated by splitting one procurement across two packages, or by awarding small and changing five times, is not a delegation.';

-- ---------------------------------------------------------------------------
-- 5. THE COMMITMENT POSITION LEARNS ABOUT CHANGE ORDERS.
--
--    contract_commitment_position is the ONE commitment total and its
--    over-commitment arm compares that total to the CONTRACT VALUE. Left
--    reading `p.awarded_value`, an approved change order that increased the
--    contract by 100,000 could never be committed against: the commitment
--    lines carrying it would be refused as over-committed, the cost model
--    would stay short by the change order, and nothing would say why.
--
--    Again a TRANSFORMATION of the live body, with each replacement asserted,
--    so a repair made to that function since Slice 6A is not reverted here.
-- ---------------------------------------------------------------------------
do $pos$
declare
  v_def text;
  v_new text;
  v_step text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'contract_commitment_position';
  if v_def is null then
    raise exception 'contract_commitment_position does not exist'
      using errcode = 'check_violation';
  end if;
  if position('v_contract_value' in v_def) > 0 then
    return;  -- already extended by a previous run of this migration
  end if;

  -- (a) the declaration
  v_step := 'the declaration block';
  v_new := replace(v_def,
    $old$  p contract_packages%rowtype;
begin$old$,
    $new$  p contract_packages%rowtype;
  v_contract_value numeric;
begin$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found in the shape Slice 6A left it — re-derive this transformation against the current body.', v_step
    using errcode = 'check_violation'; end if;
  v_def := v_new;

  -- (b) the assignment, from the ONE predicate
  v_step := 'the line-count anchor';
  v_new := replace(v_def,
    $old$  select count(*) into v_lines from contract_commitment_lines where package_id = p_package_id;$old$,
    $new$  -- SLICE 6B: the contract's value TODAY — the frozen award plus every
  -- approved change order — from the ONE predicate.
  v_contract_value := contract_current_value(p_package_id);
  select count(*) into v_lines from contract_commitment_lines where package_id = p_package_id;$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found in the shape Slice 6A left it.', v_step
    using errcode = 'check_violation'; end if;
  v_def := v_new;

  -- (c) the four live readings of the contract value. The comment mentioning
  --     `p.awarded_value` is deliberately left alone: it is describing the
  --     defect the currency arm closed, and rewriting history in a comment is
  --     how a comment stops being evidence.
  v_step := 'the empty-lines refusal';
  v_new := replace(v_def,
    $old$        p.package_code, coalesce(p.awarded_value::text, 'an unrecorded amount')));$old$,
    $new$        p.package_code, coalesce(v_contract_value::text, 'an unrecorded amount')));$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found.', v_step using errcode = 'check_violation'; end if;
  v_def := v_new;

  v_step := 'the cross-currency refusal';
  v_new := replace(v_def,
    $old$        coalesce(p.awarded_value::text, 'an unrecorded amount')));$old$,
    $new$        coalesce(v_contract_value::text, 'an unrecorded amount')));$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found.', v_step using errcode = 'check_violation'; end if;
  v_def := v_new;

  v_step := 'the awarded-at wording of the cross-currency refusal';
  v_new := replace(v_def,
    $old$and the contract was awarded at %s %s.$old$,
    $new$and the contract value stands at %s %s.$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found.', v_step using errcode = 'check_violation'; end if;
  v_def := v_new;

  v_step := 'the answered payload';
  v_new := replace(v_def,
    $old$    'contractValue', p.awarded_value,
    'variance', case when p.awarded_value is not null then v_total - p.awarded_value end,
    'overCommitted', p.awarded_value is not null and v_total > p.awarded_value,$old$,
    $new$    'contractValue', v_contract_value,
    'awardedValue', p.awarded_value,
    'changeOrderDelta', case when p.awarded_value is not null
      then v_contract_value - p.awarded_value end,
    'variance', case when v_contract_value is not null then v_total - v_contract_value end,
    'overCommitted', v_contract_value is not null and v_total > v_contract_value,$new$);
  if v_new = v_def then raise exception
    'contract_commitment_position: % was not found.', v_step using errcode = 'check_violation'; end if;
  execute v_new;
end
$pos$;

comment on function public.contract_commitment_position(bigint) is
  'D6.05/D6.06: the ONE commitment total for a contract, and its refusals. Refuses over zero lines (that is not a commitment of zero), refuses while any line carries no agreed amount and NAMES those lines, refuses a mixed-currency sum, and refuses to compare the total to the contract value across currencies. Since Slice 6B the value it compares against is contract_current_value() — the frozen award PLUS the approved change orders — because an approved change order that could never be committed against would leave the cost model permanently short by exactly its own amount, and `awardedValue`/`changeOrderDelta` are reported beside it so the two halves are readable.';

-- The over-commitment SENTENCE in approve_contract_commitments quoted
-- `p.awarded_value` directly. Its CONDITION already reads the one position
-- above, so the refusal fired correctly the moment that changed; the words
-- naming the number did not, and a refusal that names a figure other than the
-- one it refused over is how a reader concludes the product is wrong.
do $appr$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'approve_contract_commitments';
  if v_def is null then
    raise exception 'approve_contract_commitments does not exist' using errcode = 'check_violation';
  end if;
  if position('contract_current_value' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def,
    $old$      'the commitment lines total %s and contract %s was awarded at %s. Committing more than the contract obliges the owner to pay is a change order (spec §21), not a commitment.',
      v_position->>'total', p.package_code, p.awarded_value),$old$,
    $new$      'the commitment lines total %s and contract %s is worth %s today (its award plus every approved change order). Committing more than the contract obliges the owner to pay is a change order (spec §21), not a commitment.',
      v_position->>'total', p.package_code, contract_current_value(p.id)),$new$);
  if v_new = v_def then
    raise exception
      'the over-commitment refusal of approve_contract_commitments was not found in the shape Slice 6A left it — re-derive this transformation against the current body.'
      using errcode = 'check_violation';
  end if;
  v_def := v_new;

  -- AND THE SAME PACKAGE LOCK EVERY OTHER DOOR IN THIS FAMILY TAKES. This act
  -- now reads a value that a change order can MOVE, and the two were not
  -- serialized: a reduction reading zero approved commitment and a commitment
  -- approval reading the pre-reduction contract value would both pass, leaving
  -- project_cost_items.commitment above what the contract obliges — with the
  -- single-writer rule holding it there and un-committing not being this
  -- door's act either.
  v_new := replace(v_def,
    $old$  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded, so there is no contract to commit against', p.package_code));$old$,
    $new$  select * into p from contract_packages where id = p_package_id and organization_id = v_org
   for update;  -- SLICE 6B: the contract value can move under this read.
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded, so there is no contract to commit against', p.package_code));$new$);
  if v_new = v_def then
    raise exception
      'the package resolution of approve_contract_commitments was not found in the shape Slice 6A left it — do not leave a money read unserialized; re-derive this transformation against the current body.'
      using errcode = 'check_violation';
  end if;
  execute v_new;
end
$appr$;

-- ---------------------------------------------------------------------------
-- 6. THE WRITE PATH.
-- ---------------------------------------------------------------------------
create or replace function public.record_contract_change_order(
  p_package_id bigint,
  p_change jsonb
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
  v_ref text := nullif(btrim(coalesce(p_change->>'change_order_ref','')), '');
  v_desc text := nullif(btrim(coalesce(p_change->>'description','')), '');
  v_reason text := nullif(btrim(coalesce(p_change->>'reason','')), '');
  v_raw text := nullif(btrim(coalesce(p_change->>'value_delta','')), '');
  v_delta numeric := sync_finite_money(p_change->>'value_delta');
  v_days int := coalesce(sync_text_as_int(p_change->>'time_delta_days'), 0);
  v_existing contract_change_orders%rowtype;
  v_revising boolean;
  v_current numeric;
  v_prev jsonb;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a change order requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded. A change order changes a CONTRACT — before the award there is nothing to change, and what a package should cost before it is awarded is the estimate, not a variation.',
      p.package_code));
  end if;
  -- THE CUMULATIVE CEILING IS MEASURED PER CASE. A change order on a package
  -- belonging to no development case sits outside every ceiling that exists.
  if p.development_case_id is null then
    return jsonb_build_object('error', format(
      'package %s belongs to no development case. The contract-award ceiling is what one person may commit on one project, so a change order outside every case is a change order outside every ceiling — it would be checked against the per-change amount alone.',
      p.package_code));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the change order needs a change_order_ref');
  end if;
  if v_desc is null or length(v_desc) < 20 then
    return jsonb_build_object('error',
      'describe the change (description, 20 characters minimum) — what the contractor will now do that the contract did not already require');
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why the change is needed (reason, 20 characters minimum) — the sentence somebody reads in two years when the final account is in dispute');
  end if;
  if v_raw is null then
    return jsonb_build_object('error',
      'state the value change (value_delta), signed: positive commits more of the owner''s money, negative releases it, and 0 is legitimate only alongside a time change. A change order with no amount is a variation nobody has priced, and recording it as a change order puts an authority-bearing act on the ledger with no number for the ceiling to check.');
  end if;
  if v_delta is null then
    return jsonb_build_object('error', format(
      'the value change is %s; it must be a finite number. NaN and infinity are legal numeric values in Postgres — NaN is neither greater nor less than zero and turns every downstream total into NaN — so they are refused before the number reaches a contract.',
      v_raw));
  end if;
  if p_change ? 'time_delta_days'
     and nullif(btrim(coalesce(p_change->>'time_delta_days','')), '') is not null
     and sync_text_as_int(p_change->>'time_delta_days') is null then
    return jsonb_build_object('error', format(
      'time_delta_days is %s; it must be a whole number of days.', p_change->>'time_delta_days'));
  end if;
  if abs(v_days) > 3650 then
    return jsonb_build_object('error',
      'a time change of more than ten years is refused as a data-entry slip; record the extension that was actually agreed');
  end if;
  if v_delta = 0 and v_days = 0 then
    return jsonb_build_object('error',
      'this change order moves neither money nor time, so it changes nothing. A record of a change that changed nothing is a record somebody will later cite as evidence that the contract moved.');
  end if;

  v_current := contract_current_value(p.id);
  if v_current + v_delta < 0 then
    return jsonb_build_object('error', format(
      'contract %s is worth %s %s today and this change order would take it to %s. A contract with a negative value is not a contract — record the reduction that was actually agreed.',
      p.package_code, p.contract_currency, v_current, v_current + v_delta));
  end if;

  select * into v_existing from contract_change_orders
   where package_id = p.id and change_order_ref = v_ref;
  v_revising := found;
  if v_revising then
    if v_existing.decided_at is not null then
      return jsonb_build_object('error', format(
        'change order %s was %s on %s and is frozen. Changing a decided change order leaves the decision, and the ceiling it was checked against, standing behind a different number; record a further change order.',
        v_ref, v_existing.status, v_existing.decided_at));
    end if;
    v_prev := jsonb_build_object('value_delta', v_existing.value_delta,
      'time_delta_days', v_existing.time_delta_days,
      'description', v_existing.description, 'reason', v_existing.reason,
      'last_priced_by', v_existing.last_priced_by);
    perform set_config('app.change_order_write', 'granted', true);
    -- last_priced_by MOVES, recorded_by does not. Whoever last set the number
    -- is refused at the decision alongside whoever opened the draft: without
    -- this, a second person rewrote the value on somebody else's draft and
    -- approved their own figure, which is the exact control this door exists
    -- to be.
    update contract_change_orders
       set description = v_desc, reason = v_reason, value_delta = v_delta,
           time_delta_days = v_days, currency = p.contract_currency,
           last_priced_by = auth.uid()
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.change_order_write', 'granted', true);
    insert into contract_change_orders
      (organization_id, package_id, change_order_ref, description, reason,
       value_delta, currency, time_delta_days, recorded_by, last_priced_by)
    values (v_org, p.id, v_ref, v_desc, v_reason, v_delta, p.contract_currency,
            v_days, auth.uid(), auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.change_order_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_change_order', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'change_order_id', v_id,
      'change_order_ref', v_ref,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('change_order_ref', v_ref, 'value_delta', v_delta,
      'currency', p.contract_currency, 'time_delta_days', v_days,
      'description', v_desc, 'reason', v_reason));

  return jsonb_build_object('change_order_id', v_id, 'change_order_ref', v_ref,
    'package_code', p.package_code, 'valueDelta', v_delta,
    'currency', p.contract_currency, 'timeDeltaDays', v_days,
    'contractValueNow', v_current,
    'contractValueIfApproved', v_current + v_delta,
    'revised', v_revising,
    'note',
      'Recorded as a DRAFT. It changes nothing until somebody who did not record it approves it, and the approval is checked against that person''s contract-award delegation — the same ceiling the award itself passed.');
end
$$;

revoke all on function public.record_contract_change_order(bigint, jsonb) from public, anon;
grant execute on function public.record_contract_change_order(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_contract_change_order(bigint, jsonb) is
  'D6.06 / spec I.16 ChangeOrder: records a DRAFT change to an awarded contract''s value and time. Refuses before the award, refuses on a package outside every development case (the ceiling is per case), refuses a non-finite amount, refuses a change that moves neither money nor time, refuses one that would make the contract negative, and refuses to revise a decided change order.';

-- ---------------------------------------------------------------------------
-- 7. THE DECISION — the authority-bearing act.
-- ---------------------------------------------------------------------------
create or replace function public.decide_contract_change_order(
  p_change_order_id bigint,
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
  co contract_change_orders%rowtype;
  p contract_packages%rowtype;
  v_decision text := lower(nullif(btrim(coalesce(p_decision, '')), ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before numeric;
  v_after numeric;
  v_committed numeric;
  v_certified numeric;
  v_paid numeric;
  v_floor numeric;
  v_lines text;
  v_auth jsonb;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'approving a change order is a §70 human act: it commits the owner''s capital to a counterparty on terms nobody competed for, which is the least contested and most expensive money on a project. The AI may assemble the change, price it against the contract and draft the recommendation; a named person holding a delegated authority decides it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'deciding a change order requires a management or executive role holding an adopted contract-award delegation');
  end if;
  if v_decision not in ('approved','rejected') then
    return jsonb_build_object('error',
      'the decision must be approved or rejected. A change order that is no longer wanted is WITHDRAWN by the person who raised it (withdraw_contract_change_order), which is a different act and is recorded as one.');
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'state the decision (note, 20 characters minimum) — what was decided and on what basis');
  end if;

  -- FOR UPDATE. Two overlapping approvals of the same change order would each
  -- read `decided_at is null`, each pass the ceiling against the same
  -- pre-change position, and the contract would move twice on one approval.
  select * into co from contract_change_orders
   where id = p_change_order_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'change order not found');
  end if;
  if co.decided_at is not null then
    return jsonb_build_object('error', format(
      'change order %s was %s on %s. A change order is decided once; a further movement of the contract is a further change order.',
      co.change_order_ref, co.status, co.decided_at));
  end if;
  -- THE CROSS-ROW LOCKS, IN THE ORDER EVERY DOOR IN THIS FAMILY TAKES THEM:
  -- package, then case. The FOR UPDATE above locks the change-order ROW, which
  -- only stops the same change order being decided twice. Both money reads
  -- below span SIBLING rows — contract_current_value sums every approved
  -- change order on the package, and the cumulative authority measure sums
  -- every award and approved change order on the CASE — and neither was
  -- serialized. Measured live before these two lines were written: two +40,000
  -- change orders approved concurrently on one case each read
  -- alreadyCommittedOnCase = 650,000 and each passed a CAD 700,000 ceiling,
  -- leaving the contract at 730,000 with BOTH rows recording
  -- contract_value_before = 650,000 — so the sequence the row comment promises
  -- is "readable without replaying it" was wrong on both rows as well.
  select * into p from contract_packages where id = co.package_id for update;
  if p.development_case_id is not null then
    perform 1 from development_cases where id = p.development_case_id for update;
  end if;

  -- SEPARATION OF DUTIES, one level down from the evaluator-not-awarding rule,
  -- AND KEYED ON WHO SET THE NUMBER as well as who opened the draft. Keyed on
  -- recorded_by alone this was walked around in one step: the revise branch of
  -- record_contract_change_order rewrites value_delta and leaves recorded_by
  -- where it was, so a second person raised somebody else's 1,000 draft to
  -- 400,000 and approved it — one person writing the figure and approving it,
  -- which is what this control is.
  if co.recorded_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you recorded change order %s. Approving your own change order is not an approval — it is the single control standing between a contractor''s claim and the owner''s money. Route it to somebody who did not record it.',
      co.change_order_ref));
  end if;
  if co.last_priced_by is not null and co.last_priced_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you set the value of change order %s (%s %s). Approving a figure you wrote is one person creating and approving a claim on the owner''s money, whoever opened the draft. Route it to somebody who neither recorded nor priced it.',
      co.change_order_ref, co.currency, co.value_delta));
  end if;

  if v_decision = 'rejected' then
    v_prev := jsonb_build_object('status', co.status, 'decided_at', co.decided_at);
    perform set_config('app.change_order_write', 'granted', true);
    update contract_change_orders
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = v_note
     where id = co.id;
    perform set_config('app.change_order_write', '', true);
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (v_org, 'contract_change_order', coalesce(v_role, 'unknown'),
      jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
        'package_code', p.package_code, 'change_order_id', co.id,
        'change_order_ref', co.change_order_ref, 'action', 'rejected'),
      v_prev,
      jsonb_build_object('status', 'rejected', 'decided_by', auth.uid(),
        'note', v_note, 'value_delta', co.value_delta));
    return jsonb_build_object('change_order_id', co.id,
      'change_order_ref', co.change_order_ref, 'status', 'rejected',
      'contractValue', contract_current_value(p.id), 'currency', p.contract_currency,
      'note', 'The contract is unchanged. The rejection is kept: it is the evidence that somebody asked and was told no.');
  end if;

  v_before := contract_current_value(p.id);
  v_after := v_before + co.value_delta;
  if v_after < 0 then
    return jsonb_build_object('error', format(
      'contract %s is worth %s %s and this change order would take it to %s. A contract with a negative value is not a contract.',
      p.package_code, p.contract_currency, v_before, v_after));
  end if;

  -- A REDUCTION MAY NOT GO BELOW WHAT IS ALREADY COMMITTED **OR CERTIFIED**.
  -- The cost model carries the approved commitment lines as committed cost;
  -- taking the contract below them would leave project_cost_items.commitment
  -- explaining money no contract obliges, with the single-writer rule holding
  -- it there. CERTIFIED money is the harder half and the first draft of this
  -- guard missed it entirely: certify_contract_invoice refuses to take the
  -- certified total ABOVE the contract value, and nothing stopped the contract
  -- value being moved DOWN underneath it. Measured live: a CAD 1,800,000
  -- contract with no commitment lines, 1,000,000 certified and PAID, reduced
  -- to 100,000 — leaving the ledger explaining a payment no contract obliges
  -- and a payment that cannot be reversed, because un-paying is refused for
  -- every caller. The binding figure is whichever is larger, and it is named.
  select coalesce(sum(cl.amount), 0),
         string_agg(cl.line_ref, ', ' order by cl.line_ref)
    into v_committed, v_lines
  from contract_commitment_lines cl
  where cl.package_id = p.id and cl.approved_at is not null;
  select coalesce(sum(i.certified_amount) filter (
           where i.status in ('certified','paid')), 0),
         coalesce(sum(i.certified_amount) filter (where i.status = 'paid'), 0)
    into v_certified, v_paid
  from contract_invoices i where i.package_id = p.id;
  v_floor := greatest(coalesce(v_committed, 0), coalesce(v_certified, 0));
  if co.value_delta < 0 and v_floor > 0 and v_after < v_floor then
    return jsonb_build_object('error', format(
      'contract %s already carries %s %s of APPROVED commitment%s and %s %s CERTIFIED (of which %s is PAID). This change order would take the contract to %s — below what is already committed or certified against it (%s %s, the binding figure being the %s one) — and the ledger would then explain money no contract obliges. %s Reverse it first, or reduce by no more than %s.',
      p.package_code, p.contract_currency, coalesce(v_committed, 0),
      case when v_lines is null then '' else format(' (line(s) %s)', v_lines) end,
      p.contract_currency, coalesce(v_certified, 0), coalesce(v_paid, 0), v_after,
      p.contract_currency, v_floor,
      case when coalesce(v_certified, 0) >= coalesce(v_committed, 0)
           then 'certified' else 'committed' end,
      case when coalesce(v_paid, 0) > 0
           then 'A payment already made is not reversible here: the table refuses un-paying for every caller.'
           else '' end,
      v_before - v_floor),
      'approvedCommitment', coalesce(v_committed, 0),
      'certifiedTotal', coalesce(v_certified, 0),
      'paidTotal', coalesce(v_paid, 0),
      'contractValueAfter', v_after);
  end if;

  -- THE AUTHORITY. The same evaluator, the same store, the same action type as
  -- the award — and its cumulative measure now counts this person's approved
  -- change orders on this case as well as their awards.
  -- greatest(value_delta, 0): the ceiling measures what this person COMMITS.
  -- sync_contract_award_authority's first line is abs(p_value), so a signed
  -- delta handed to it measured a CAD 650,000 de-scope as a CAD 650,000
  -- commitment and refused it with a sentence that stated the opposite of its
  -- own arithmetic — "a further 650000 would take your total to 1300000" for
  -- an act that took it to nothing. Releasing exposure consumes no ceiling.
  v_auth := sync_contract_award_authority(v_org, v_role, greatest(co.value_delta, 0),
                                          co.currency, p.development_case_id, auth.uid());
  if (v_auth->>'permitted')::boolean is not true then
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values (v_org, auth.uid(), coalesce(v_role, 'unknown'), 'admin_action', 'warning',
      format('Change order %s on package %s (%s %s) refused: %s',
             co.change_order_ref, p.package_code, co.currency, co.value_delta,
             v_auth->>'refusal'));
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel',
      'alreadyCommittedOnCase', v_auth->'alreadyAwarded',
      'escalatesTo', v_auth->'escalatesTo');
  end if;

  v_prev := jsonb_build_object('status', co.status, 'decided_at', co.decided_at,
    'contract_value', v_before);
  perform set_config('app.change_order_write', 'granted', true);
  update contract_change_orders
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = v_note, authority_limit_id = (v_auth->>'limitId')::uuid,
         contract_value_before = v_before, contract_value_after = v_after
   where id = co.id;
  perform set_config('app.change_order_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_change_order', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'change_order_id', co.id,
      'change_order_ref', co.change_order_ref, 'action', 'approved'),
    v_prev,
    jsonb_build_object('status', 'approved', 'value_delta', co.value_delta,
      'currency', co.currency, 'time_delta_days', co.time_delta_days,
      'contract_value_before', v_before, 'contract_value_after', v_after,
      'authority_limit_id', v_auth->>'limitId', 'tier_label', v_auth->>'tierLabel',
      'ceiling', (v_auth->>'ceiling')::numeric,
      'alreadyCommittedOnCase', v_auth->'alreadyAwarded',
      'decided_by', auth.uid(), 'note', v_note));

  return jsonb_build_object('change_order_id', co.id,
    'change_order_ref', co.change_order_ref, 'status', 'approved',
    'package_code', p.package_code,
    'valueDelta', co.value_delta, 'currency', co.currency,
    'timeDeltaDays', co.time_delta_days,
    'contractValueBefore', v_before, 'contractValue', v_after,
    'approvedUnder', v_auth->'tierLabel', 'ceiling', v_auth->'ceiling',
    'alreadyCommittedOnCase', v_auth->'alreadyAwarded',
    'contractCompletionNote', case when co.time_delta_days <> 0 then format(
      'This change order carries %s day(s) of time. The §24 contract completion date is part of the FROZEN award record and is not rewritten by it: the extension is recorded here, and the delivery forecast (record_package_delivery_forecast) is what the mandatory long-lead blocker measures.',
      co.time_delta_days) end,
    -- The note follows the SIGN. Written unconditionally it told the approver
    -- of a de-scope that "the contract is now worth more", which is the
    -- opposite of what they had just done.
    'commitmentNote', case when co.value_delta > 0 then
      'The contract is now worth more, and none of the difference is committed. The commitment reaches the controls model the same way it always does — record_contract_commitment_line then approve_contract_commitments — and until then the cost reconciliation is short by exactly this change order.'
    when co.value_delta < 0 then
      'The contract is now worth less. The commitment lines already approved against it are NOT reduced by this: committed cost has one writer (approve_contract_commitments) and it is not this door. Reverse or re-approve the lines that no longer have a contract behind them, or the cost model will report a commitment the contract no longer obliges.'
    else
      'This change order moves time and not money, so nothing about the committed cost changes.' end);
end
$$;

revoke all on function public.decide_contract_change_order(bigint, text, text)
  from public, anon, service_role;
grant execute on function public.decide_contract_change_order(bigint, text, text) to authenticated;

comment on function public.decide_contract_change_order(bigint, text, text) is
  'D6.06 / spec I.16 ChangeOrder × §21 × §41-43 × §70: approves or rejects a change order. Routed through THE SAME authority evaluator and the same authority_limits.action_type = ''contract_award'' the award used, refused above the ceiling BY NAME with a security_events row, refused for the AI-operator identity by name, refused for the person who recorded it, refused when a reduction would take the contract below the commitments already approved against it, and refused a second time on an already-decided change order. Never touches project_cost_items: committed cost keeps its single writer.';

create or replace function public.withdraw_contract_change_order(
  p_change_order_id bigint,
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
  co contract_change_orders%rowtype;
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
      'withdrawing a change order requires a planning, engineering or governance role');
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why the change order is withdrawn (reason, 20 characters minimum)');
  end if;
  select * into co from contract_change_orders
   where id = p_change_order_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'change order not found');
  end if;
  if co.decided_at is not null then
    return jsonb_build_object('error', format(
      'change order %s was %s on %s. A decided change order is not withdrawn — an approved one is part of what the contract is worth, and a rejected one is the record that somebody asked.',
      co.change_order_ref, co.status, co.decided_at));
  end if;
  select * into p from contract_packages where id = co.package_id;

  perform set_config('app.change_order_write', 'granted', true);
  update contract_change_orders
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
         decision_note = v_reason
   where id = co.id;
  perform set_config('app.change_order_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_change_order', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'change_order_id', co.id,
      'change_order_ref', co.change_order_ref, 'action', 'withdrawn'),
    jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'withdrawn', 'reason', v_reason,
      'withdrawn_by', auth.uid()));

  return jsonb_build_object('change_order_id', co.id,
    'change_order_ref', co.change_order_ref, 'status', 'withdrawn',
    'contractValue', contract_current_value(p.id), 'currency', p.contract_currency,
    'note', 'Withdrawn, not deleted: a change order somebody raised and pulled is not the same as one nobody ever raised.');
end
$$;

revoke all on function public.withdraw_contract_change_order(bigint, text)
  from public, anon, service_role;
grant execute on function public.withdraw_contract_change_order(bigint, text) to authenticated;

comment on function public.withdraw_contract_change_order(bigint, text) is
  'D6.06: withdraws a DRAFT change order with a stated reason. A decided one is refused — an approved change order is part of the contract''s value and a rejected one is the evidence that somebody asked and was told no. Withdrawn, never deleted.';

notify pgrst, 'reload schema';
