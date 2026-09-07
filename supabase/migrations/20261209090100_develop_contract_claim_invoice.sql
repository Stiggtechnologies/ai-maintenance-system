-- ============================================================================
-- Sync Develop — Slice 6B, part 2 of 4.
-- D6.06 (Commercial lifecycle objects, spec I.16) — the CLAIM and the INVOICE.
--
-- THE TWO PROPERTIES THIS FILE EXISTS FOR:
--
--   1. AN INVOICE MUST NOT BE PAYABLE TWICE. That is four walls, not one,
--      because paying twice has four routes:
--        * the same invoice entered as a second ROW — refused by a unique
--          index on (organization, supplier, lower(invoice_ref)), because the
--          duplicate is nearly always the same number re-keyed, sometimes
--          against a different package;
--        * a paid invoice PAID AGAIN — refused at the door by name, quoting
--          the date and the payment reference;
--        * a paid invoice UN-PAID and re-paid — refused at the table for every
--          caller, service paths included, because `paid_at → null` is the one
--          edit that makes route two available again;
--        * the same BANK PAYMENT recorded against two invoices — refused by a
--          unique index on the payment reference, which is what a
--          reconciliation against the bank statement would otherwise have to
--          find by hand.
--
--   2. A CLAIM IS FROZEN ONCE IT IS ANSWERED. A claim whose grounds or value
--      can be edited after the answer leaves the answer standing against a
--      different claim, which is precisely the document a dispute turns on.
--
-- WHAT NEITHER OF THEM DOES: move money in the controls model.
-- `project_cost_items.commitment` keeps the single writer Slice 6A gave it
-- (enforce_cost_item_contract_commitment). A certified invoice is an ACTUAL,
-- not a commitment, and Slice 4A owns actuals through record_cost_item; this
-- file adds no writer to either column. What it does add is the REFUSAL that
-- keeps the two coherent: an invoice may not be certified beyond what the
-- contract is worth, read from the ONE value predicate (contract_current_value).
--
-- REFUSAL-FIRST: an empty invoice set REFUSES rather than reporting a
-- confident zero — a contract nobody has invoiced against and a contract that
-- has been paid in full both show "nothing outstanding" to a counter that
-- starts at zero. Mixed currencies refuse rather than summing. Non-finite and
-- negative money is refused at every door.
--
-- §70: answering a claim and certifying an invoice are human acts, refused for
-- the AI-operator identity at the door and at the table.
--
-- Canonical reuse: contract_packages, suppliers, contract_current_value,
-- contract_change_orders, enforce_procurement_act_is_human,
-- record_procurement_service_write, sync_finite_money, sync_text_as_int,
-- sync_text_as_date, audit_events.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CLAIM.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_claims (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  claim_ref text not null check (btrim(claim_ref) <> ''),
  -- Both directions are real and they are not symmetrical: a claim FROM the
  -- supplier asks the owner for money, one AGAINST the supplier (liquidated
  -- damages, defective work) asks for it back. A single unsigned "claim value"
  -- would put the two on the same side of the contract.
  direction text not null check (direction in ('from_supplier', 'against_supplier')),
  grounds text not null check (length(btrim(grounds)) >= 20),
  claimed_value numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  time_claimed_days int not null default 0,
  raised_on date not null default current_date,
  raised_by uuid references auth.users(id),
  -- WHO SET THE NUMBER. record_contract_claim revises an open claim in place
  -- and does not move raised_by, so a separation-of-duties rule keyed on the
  -- raiser alone let a second person rewrite the claimed value — and the
  -- DIRECTION — on somebody else's open claim and then answer their own
  -- figure. Both actors are refused at the answer.
  last_priced_by uuid references auth.users(id),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'partially_accepted', 'rejected', 'withdrawn')),
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  answer_note text,
  settled_value numeric,
  settled_time_days int,
  created_at timestamptz not null default now(),
  unique (package_id, claim_ref),
  constraint claim_value_finite check (
    claimed_value <> 'NaN'::numeric
    and claimed_value > '-Infinity'::numeric
    and claimed_value < 'Infinity'::numeric
    and claimed_value >= 0),
  constraint claim_time_sane check (time_claimed_days between 0 and 3650),
  constraint claim_answer_actor check ((answered_at is null) = (answered_by is null)),
  constraint claim_answer_note check ((answered_at is null) = (answer_note is null)),
  constraint claim_answer_said_something check (
    answer_note is null or length(btrim(answer_note)) >= 20),
  constraint claim_answered_status check (
    (status <> 'open') = (answered_at is not null)),
  -- An accepted or partly accepted claim settles at a stated amount; a
  -- rejected or withdrawn one settles at nothing, and recording that nothing
  -- as 0 would make "rejected" and "accepted for nil" the same row.
  constraint claim_settlement check (
    (status in ('accepted', 'partially_accepted')) = (settled_value is not null)),
  constraint claim_settlement_finite check (
    settled_value is null
    or (settled_value <> 'NaN'::numeric
        and settled_value > '-Infinity'::numeric
        and settled_value < 'Infinity'::numeric
        and settled_value >= 0)),
  constraint claim_settlement_within_claim check (
    settled_value is null or settled_value <= claimed_value),
  constraint claim_settled_time check (
    settled_time_days is null
    or (settled_time_days >= 0 and settled_time_days <= time_claimed_days))
);

create index if not exists idx_contract_claims_package
  on contract_claims(organization_id, package_id, status);

alter table public.contract_claims enable row level security;
drop policy if exists contract_claims_read on public.contract_claims;
create policy contract_claims_read on public.contract_claims
  for select to authenticated using (organization_id = app_current_org());

comment on table public.contract_claims is
  'D6.06 / spec I.16 Claim: a claim under an awarded contract, in either direction. FROZEN once answered, for every writer — a claim whose grounds or value can be edited after the answer leaves the answer standing against a different claim, and the claim document is what a dispute turns on. An accepted claim does NOT move the contract''s value by itself: money reaches the contract through an approved change order (contract_change_orders), and get_contract_commercial states the settled total BESIDE the approved change-order total rather than differencing them, because nothing links a claim to the change order that carries it.';

-- ---------------------------------------------------------------------------
-- 2. THE INVOICE.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_invoices (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  invoice_ref text not null check (btrim(invoice_ref) <> ''),
  supplier_id bigint not null references suppliers(id),
  invoice_date date not null,
  period_start date,
  period_end date,
  description text not null check (length(btrim(description)) >= 10),
  gross_amount numeric not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'received'
    check (status in ('received', 'certified', 'rejected', 'paid')),
  recorded_by uuid references auth.users(id),
  -- WHO SET THE AMOUNT. record_contract_invoice revises an uncertified
  -- invoice in place without moving recorded_by, so a certifier could raise
  -- the gross on somebody else's received invoice and then certify their own
  -- figure. Both actors are refused at the certification.
  last_priced_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  certified_by uuid references auth.users(id),
  certified_at timestamptz,
  certification_note text,
  -- A PARTIAL certification is the normal case, not an exception: the sum
  -- certified is what the owner accepts as due, and it is what gets paid.
  certified_amount numeric,
  paid_by uuid references auth.users(id),
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz not null default now(),
  constraint invoice_amount_finite check (
    gross_amount <> 'NaN'::numeric
    and gross_amount > '-Infinity'::numeric
    and gross_amount < 'Infinity'::numeric
    and gross_amount > 0),
  constraint invoice_period check (
    period_start is null or period_end is null or period_end >= period_start),
  constraint invoice_certification_actor check (
    (certified_at is null) = (certified_by is null)),
  constraint invoice_certification_note check (
    (certified_at is null) = (certification_note is null)),
  constraint invoice_certification_said_something check (
    certification_note is null or length(btrim(certification_note)) >= 20),
  constraint invoice_answered_status check (
    (status in ('certified', 'rejected', 'paid')) = (certified_at is not null)),
  constraint invoice_certified_amount check (
    (status in ('certified', 'paid')) = (certified_amount is not null)),
  constraint invoice_certified_amount_finite check (
    certified_amount is null
    or (certified_amount <> 'NaN'::numeric
        and certified_amount > '-Infinity'::numeric
        and certified_amount < 'Infinity'::numeric
        and certified_amount > 0
        and certified_amount <= gross_amount)),
  -- THE PAYMENT RECORD IS ALL-OR-NONE. A paid_at with no actor is a payment
  -- nobody made, and the §70 wall reads exactly that column; a payment with no
  -- reference cannot be reconciled to a bank statement, which is how the same
  -- invoice gets paid twice and nobody notices.
  constraint invoice_payment_record check (
    (paid_at is null) = (paid_by is null)
    and (paid_at is null) = (payment_reference is null)),
  constraint invoice_payment_reference check (
    payment_reference is null or length(btrim(payment_reference)) >= 3),
  constraint invoice_paid_status check ((status = 'paid') = (paid_at is not null))
);

-- THE DUPLICATE-INVOICE WALL. The same supplier's invoice number, in one
-- organization, exists once. A duplicate payment is nearly always the same
-- number re-keyed — sometimes deliberately, against a different package — and
-- a uniqueness scoped to the package would not have seen it.
create unique index if not exists idx_contract_invoice_ref
  on contract_invoices(organization_id, supplier_id, lower(btrim(invoice_ref)));

-- THE DUPLICATE-PAYMENT WALL. One bank payment settles one invoice. Recording
-- the same reference against two invoices is the shape a double payment takes
-- once the invoice-number wall has been walked around.
create unique index if not exists idx_contract_invoice_payment_ref
  on contract_invoices(organization_id, lower(btrim(payment_reference)))
  where paid_at is not null;

create index if not exists idx_contract_invoices_package
  on contract_invoices(organization_id, package_id, status);

alter table public.contract_invoices enable row level security;
drop policy if exists contract_invoices_read on public.contract_invoices;
create policy contract_invoices_read on public.contract_invoices
  for select to authenticated using (organization_id = app_current_org());

comment on table public.contract_invoices is
  'D6.06 / spec I.16 Invoice: what a supplier has billed under an awarded contract, what the owner certified as due, and what was paid. NOT PAYABLE TWICE, by four separate walls: a unique (organization, supplier, invoice_ref); a unique payment reference among paid invoices; a door that refuses a second payment by name; and a table wall that refuses un-paying for every caller, because `paid_at → null` is the edit that makes the second payment available again.';
comment on column public.contract_invoices.certified_amount is
  'What the owner accepts as due — at most the gross, often less. This, not the gross, is what is paid. Its total across the contract may not exceed contract_current_value() (award plus approved change orders), refused by name in certify_contract_invoice.';

-- ---------------------------------------------------------------------------
-- 3. THE WALLS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_contract_claim_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.contract_claim_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_claims is the record of what was claimed under a contract and how it was answered — the document a dispute is decided on. Truncating it removes every claim and every answer in one statement. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id)
       or not exists (
            select 1 from contract_packages p2
            join development_cases dc on dc.id = p2.development_case_id
            where p2.id = old.package_id) then
      return old;
    end if;
    raise exception
      'Claim % on this contract is %. A claim is WITHDRAWN with a stated reason, never deleted: deleting an answered claim destroys the answer with it, and deleting an open one makes a claim somebody made indistinguishable from one nobody made.',
      old.claim_ref, old.status
      using errcode = 'insufficient_privilege';
  end if;

  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this claim is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;
  if p.awarded_at is null then
    raise exception
      'Package % is not awarded. A claim is made under a CONTRACT; there is nothing to claim under before one exists.',
      p.package_code
      using errcode = 'check_violation';
  end if;
  if new.currency is distinct from p.contract_currency then
    raise exception
      'Claim % is stated in % and contract % was awarded in %. Sync holds no exchange rate, so a claim is never compared to or added to the contract across two units.',
      new.claim_ref, new.currency, p.package_code, p.contract_currency
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A claim is recorded through record_contract_claim and answered through answer_contract_claim — the answer is a §70 human act and it freezes the claim. A direct write does it with no role check, no audit row and no §70 wall behind the answer.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Claim %s on package %s', new.claim_ref, p.package_code), tg_op,
      'A claim written outside the RPCs can be born answered, which records an answer nobody gave.');
  end if;

  if tg_op = 'INSERT' and new.status <> 'open' then
    raise exception
      'A claim is recorded OPEN and answered afterwards by a named person. One that arrives already answered records an answer nobody gave.'
      using errcode = 'check_violation';
  end if;

  -- FROZEN ONCE ANSWERED, for every writer. This is the property the row
  -- exists for.
  if tg_op = 'UPDATE' and old.answered_at is not null then
    if new.claim_ref is distinct from old.claim_ref
       or new.direction is distinct from old.direction
       or new.grounds is distinct from old.grounds
       or new.claimed_value is distinct from old.claimed_value
       or new.currency is distinct from old.currency
       or new.time_claimed_days is distinct from old.time_claimed_days
       or new.raised_on is distinct from old.raised_on
       or new.status is distinct from old.status
       or new.answered_by is distinct from old.answered_by
       or new.answered_at is distinct from old.answered_at
       or new.answer_note is distinct from old.answer_note
       or new.settled_value is distinct from old.settled_value
       or new.settled_time_days is distinct from old.settled_time_days
       or new.raised_by is distinct from old.raised_by
       or new.last_priced_by is distinct from old.last_priced_by
       or new.package_id is distinct from old.package_id then
      raise exception
        'Claim % was answered on % (%). It is FROZEN for every caller: its grounds, its value, the answer and the settlement. A claim that can be edited after it is answered leaves the answer standing against a different claim — and the claim document is what the dispute is decided on.',
        old.claim_ref, old.answered_at, old.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contract_claim_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_contract_claim_integrity on public.contract_claims;
create trigger trg_contract_claim_integrity
  before insert or update or delete on public.contract_claims
  for each row execute function public.enforce_contract_claim_integrity();

drop trigger if exists trg_contract_claim_no_truncate on public.contract_claims;
create trigger trg_contract_claim_no_truncate
  before truncate on public.contract_claims
  for each statement execute function public.enforce_contract_claim_integrity();

revoke truncate on table public.contract_claims from anon, authenticated, service_role;

drop trigger if exists trg_contract_claim_answerer_is_human on public.contract_claims;
create trigger trg_contract_claim_answerer_is_human
  before insert or update on public.contract_claims
  for each row execute function public.enforce_procurement_act_is_human(
    -- The label names BOTH acts this column carries: withdraw_contract_claim
    -- writes answered_by too, and a withdrawal refused with a message about an
    -- answer sends the reader looking for an answer nobody gave.
    'answered_by', 'answer or withdraw a claim under a contract');

create or replace function public.enforce_contract_invoice_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.contract_invoice_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_invoices is the record of what has been billed, certified and PAID under every contract. Truncating it erases the evidence that an invoice was already paid, which is the fact the duplicate-payment walls are built on. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id)
       or not exists (
            select 1 from contract_packages p2
            join development_cases dc on dc.id = p2.development_case_id
            where p2.id = old.package_id) then
      return old;
    end if;
    raise exception
      'Invoice % is %. An invoice is not deleted: a paid one is the only record that the money went out, and deleting it makes the invoice available to be entered and paid again — which is the exact failure the uniqueness on (supplier, invoice number) exists to prevent. Reject it, or credit it with a further invoice.',
      old.invoice_ref, old.status
      using errcode = 'insufficient_privilege';
  end if;

  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this invoice is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;
  if p.awarded_at is null then
    raise exception
      'Package % is not awarded. An invoice is issued under a CONTRACT, and certifying one against a package nobody has awarded pays for an agreement that does not exist.',
      p.package_code
      using errcode = 'check_violation';
  end if;
  if new.currency is distinct from p.contract_currency then
    raise exception
      'Invoice % is stated in % and contract % was awarded in %. Sync holds no exchange rate, so an invoice is never certified against a contract value denominated in another unit.',
      new.invoice_ref, new.currency, p.package_code, p.contract_currency
      using errcode = 'check_violation';
  end if;
  -- The invoice is from the counterparty, not from anybody.
  if new.supplier_id is distinct from p.awarded_supplier_id then
    raise exception
      'Invoice % names a supplier that did not win contract %. An invoice under a contract comes from the counterparty to it.',
      new.invoice_ref, p.package_code
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'An invoice is recorded through record_contract_invoice, certified through certify_contract_invoice and paid through record_invoice_payment. A direct write reaches this table only by bypassing row-level security, and it can create an invoice that is born certified and paid — with nobody named, no ceiling checked and no audit row.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Invoice %s on package %s', new.invoice_ref, p.package_code), tg_op,
      'An invoice written outside the RPCs can be born certified and paid, which is a payment nobody authorised.');
  end if;

  if tg_op = 'INSERT' and (new.status <> 'received'
      or new.certified_at is not null or new.paid_at is not null) then
    raise exception
      'An invoice is received UNCERTIFIED and UNPAID. One that arrives already certified or already paid records a certification and a payment nobody made.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- FROZEN ONCE ANSWERED. Certification is the owner's answer to the
    -- invoice, and everything the answer was given about is fixed by it.
    if old.certified_at is not null then
      if new.invoice_ref is distinct from old.invoice_ref
         or new.supplier_id is distinct from old.supplier_id
         or new.invoice_date is distinct from old.invoice_date
         or new.gross_amount is distinct from old.gross_amount
         or new.currency is distinct from old.currency
         or new.description is distinct from old.description
         or new.certified_by is distinct from old.certified_by
         or new.certified_at is distinct from old.certified_at
         or new.certification_note is distinct from old.certification_note
         or new.certified_amount is distinct from old.certified_amount
         or new.recorded_by is distinct from old.recorded_by
         or new.last_priced_by is distinct from old.last_priced_by
         or new.package_id is distinct from old.package_id then
        raise exception
          'Invoice % was % on %. It is FROZEN for every caller: the amount billed, the amount certified, and the certification itself. An invoice whose certified amount can move after certification is an invoice that can be paid for more than anybody approved.',
          old.invoice_ref, old.status, old.certified_at
          using errcode = 'check_violation';
      end if;
    end if;
    -- UN-PAYING IS THE SECOND PAYMENT. Refused for every caller, service
    -- included: clearing paid_at is the one edit that makes
    -- record_invoice_payment available on this row a second time, and the
    -- money has already gone.
    if old.paid_at is not null then
      if new.paid_at is distinct from old.paid_at
         or new.paid_by is distinct from old.paid_by
         or new.payment_reference is distinct from old.payment_reference
         or new.status is distinct from old.status then
        raise exception
          'Invoice % was PAID on % under payment reference %. The payment record is immutable for every caller — un-paying it is how the same invoice is paid a second time, and the first payment has already left the bank. A payment made in error is corrected by a credit note recorded as its own invoice, which leaves both facts on the ledger.',
          old.invoice_ref, old.paid_at, old.payment_reference
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contract_invoice_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_contract_invoice_integrity on public.contract_invoices;
create trigger trg_contract_invoice_integrity
  before insert or update or delete on public.contract_invoices
  for each row execute function public.enforce_contract_invoice_integrity();

drop trigger if exists trg_contract_invoice_no_truncate on public.contract_invoices;
create trigger trg_contract_invoice_no_truncate
  before truncate on public.contract_invoices
  for each statement execute function public.enforce_contract_invoice_integrity();

revoke truncate on table public.contract_invoices from anon, authenticated, service_role;

drop trigger if exists trg_contract_invoice_certifier_is_human on public.contract_invoices;
create trigger trg_contract_invoice_certifier_is_human
  before insert or update on public.contract_invoices
  for each row execute function public.enforce_procurement_act_is_human(
    'certified_by', 'certify an invoice');

-- Paying is not on §70's own list, but it is the act that moves the money the
-- certification approved, and a machine identity recording it would be a
-- payment with nobody behind it. Bound to the same ONE wall.
drop trigger if exists trg_contract_invoice_payer_is_human on public.contract_invoices;
create trigger trg_contract_invoice_payer_is_human
  before insert or update on public.contract_invoices
  for each row execute function public.enforce_procurement_act_is_human(
    'paid_by', 'record a payment against a certified invoice');

-- ---------------------------------------------------------------------------
-- 4. THE ONE INVOICE POSITION, AND ITS REFUSALS.
--
--    Read by the certification door and by the commercial read, so the number
--    on the screen and the number the certification is checked against cannot
--    diverge.
-- ---------------------------------------------------------------------------
create or replace function public.contract_invoice_position(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p contract_packages%rowtype;
  v_count int;
  v_currencies int;
  v_currency text;
  v_value numeric;
  v_certified numeric;
  v_paid numeric;
  v_uncertified numeric;
begin
  select * into p from contract_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('answered', false, 'invoices', 0,
      'refusal', format(
        'Package %s is not awarded, so there is no contract to invoice against.',
        p.package_code));
  end if;

  select count(*) into v_count from contract_invoices where package_id = p_package_id;
  -- REFUSAL-FIRST. Zero invoices is not "nothing outstanding": a contract
  -- nobody has billed against and a contract paid in full look identical to a
  -- counter that starts at zero, and the first is the one that surprises the
  -- forecast.
  if coalesce(v_count, 0) = 0 then
    return jsonb_build_object('answered', false, 'invoices', 0,
      'certifiedTotal', null, 'paidTotal', null,
      'refusal', format(
        'No invoice has been recorded against contract %s. That is not "nothing outstanding" and it is not "paid in full": the contract obliges the owner to pay %s %s and nothing here says how much of it has been billed.',
        p.package_code, coalesce(p.contract_currency, ''),
        coalesce(contract_current_value(p.id)::text, 'an unrecorded amount')));
  end if;

  select count(distinct currency), min(currency) into v_currencies, v_currency
  from contract_invoices where package_id = p_package_id;
  if v_currencies > 1 then
    return jsonb_build_object('answered', false, 'invoices', v_count,
      'certifiedTotal', null, 'paidTotal', null,
      'refusal', format(
        'The invoices on contract %s are stated in %s different currencies. Sync holds no exchange rate, so they are not summed — a total across two units is not money.',
        p.package_code, v_currencies));
  end if;

  v_value := contract_current_value(p.id);
  select coalesce(sum(certified_amount) filter (where status in ('certified','paid')), 0),
         coalesce(sum(certified_amount) filter (where status = 'paid'), 0),
         coalesce(sum(gross_amount) filter (where status = 'received'), 0)
    into v_certified, v_paid, v_uncertified
  from contract_invoices where package_id = p_package_id;

  return jsonb_build_object('answered', true,
    'invoices', v_count, 'currency', v_currency,
    'contractValue', v_value,
    'certifiedTotal', v_certified,
    'paidTotal', v_paid,
    'awaitingPayment', v_certified - v_paid,
    'awaitingCertification', v_uncertified,
    'remainingToCertify', case when v_value is not null then v_value - v_certified end,
    'overCertified', v_value is not null and v_certified > v_value,
    'rejectedCount', (select count(*) from contract_invoices
                       where package_id = p_package_id and status = 'rejected'));
end
$$;

revoke all on function public.contract_invoice_position(bigint)
  from public, anon, authenticated, service_role;

comment on function public.contract_invoice_position(bigint) is
  'D6.06: the ONE invoice position for a contract — billed, certified, paid, and what remains certifiable against contract_current_value(). REFUSES over an empty invoice set (that is neither "nothing outstanding" nor "paid in full"), refuses a mixed-currency sum, and refuses on an unawarded package. Read by certify_contract_invoice and by get_contract_commercial, so the screen and the door cannot disagree.';

-- ---------------------------------------------------------------------------
-- 5. THE CLAIM WRITE PATHS.
-- ---------------------------------------------------------------------------
create or replace function public.record_contract_claim(
  p_package_id bigint,
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
  p contract_packages%rowtype;
  v_ref text := nullif(btrim(coalesce(p_claim->>'claim_ref','')), '');
  v_dir text := lower(nullif(btrim(coalesce(p_claim->>'direction','')), ''));
  v_grounds text := nullif(btrim(coalesce(p_claim->>'grounds','')), '');
  v_raw text := nullif(btrim(coalesce(p_claim->>'claimed_value','')), '');
  v_value numeric := sync_finite_money(p_claim->>'claimed_value');
  v_days int := coalesce(sync_text_as_int(p_claim->>'time_claimed_days'), 0);
  v_raised date;
  v_existing contract_claims%rowtype;
  v_revising boolean;
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
      'recording a claim requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded. A claim is made under a CONTRACT — there is nothing to claim under before one exists.',
      p.package_code));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the claim needs a claim_ref');
  end if;
  if v_dir not in ('from_supplier','against_supplier') then
    return jsonb_build_object('error',
      'state the direction: from_supplier (the counterparty is asking the owner for money) or against_supplier (the owner is asking for it back). The two sit on opposite sides of the contract and an unsigned claim value would put them on the same one.');
  end if;
  if v_grounds is null or length(v_grounds) < 20 then
    return jsonb_build_object('error',
      'state the grounds (20 characters minimum) — the clause and the facts relied on, which is what the answer will be given against');
  end if;
  if v_raw is null then
    return jsonb_build_object('error',
      'state the amount claimed (claimed_value). A claim with no number is a notice, and recording it as a claim puts a figure of zero into every commercial total.');
  end if;
  if v_value is null or v_value < 0 then
    return jsonb_build_object('error', format(
      'the amount claimed is %s; it must be a finite amount of at least zero. NaN and infinity are legal numeric values in Postgres and turn every downstream total into NaN, so they are refused at the door.',
      v_raw));
  end if;
  if v_days < 0 or v_days > 3650 then
    return jsonb_build_object('error',
      'the time claimed must be between 0 and 3650 days');
  end if;
  begin
    v_raised := coalesce(sync_text_as_date(p_claim->>'raised_on'), current_date);
  exception when others then
    v_raised := current_date;
  end;
  if v_raised > current_date then
    return jsonb_build_object('error',
      'a claim cannot be raised in the future');
  end if;

  select * into v_existing from contract_claims
   where package_id = p.id and claim_ref = v_ref;
  v_revising := found;
  if v_revising then
    if v_existing.answered_at is not null then
      return jsonb_build_object('error', format(
        'claim %s was answered on %s (%s) and is frozen. Editing an answered claim leaves the answer standing against a different claim; raise a further claim instead.',
        v_ref, v_existing.answered_at, v_existing.status));
    end if;
    v_prev := jsonb_build_object('claimed_value', v_existing.claimed_value,
      'grounds', v_existing.grounds, 'direction', v_existing.direction,
      'time_claimed_days', v_existing.time_claimed_days,
      'last_priced_by', v_existing.last_priced_by);
    perform set_config('app.contract_claim_write', 'granted', true);
    -- last_priced_by moves with the figure; raised_by does not.
    update contract_claims
       set direction = v_dir, grounds = v_grounds, claimed_value = v_value,
           currency = p.contract_currency, time_claimed_days = v_days,
           raised_on = v_raised, last_priced_by = auth.uid()
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.contract_claim_write', 'granted', true);
    insert into contract_claims
      (organization_id, package_id, claim_ref, direction, grounds, claimed_value,
       currency, time_claimed_days, raised_on, raised_by, last_priced_by)
    values (v_org, p.id, v_ref, v_dir, v_grounds, v_value, p.contract_currency,
            v_days, v_raised, auth.uid(), auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.contract_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'claim_id', v_id, 'claim_ref', v_ref,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('claim_ref', v_ref, 'direction', v_dir,
      'claimed_value', v_value, 'currency', p.contract_currency,
      'time_claimed_days', v_days, 'grounds', v_grounds));

  return jsonb_build_object('claim_id', v_id, 'claim_ref', v_ref,
    'package_code', p.package_code, 'direction', v_dir,
    'claimedValue', v_value, 'currency', p.contract_currency,
    'timeClaimedDays', v_days, 'status', 'open', 'revised', v_revising,
    'note',
      'Recorded OPEN. It is editable until it is answered and frozen the moment it is — and the answer does not by itself move the contract: money agreed under a claim reaches the contract through an approved change order.');
end
$$;

revoke all on function public.record_contract_claim(bigint, jsonb) from public, anon;
grant execute on function public.record_contract_claim(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_contract_claim(bigint, jsonb) is
  'D6.06 / spec I.16 Claim: records or revises an OPEN claim under an awarded contract, in either direction. Refuses before the award, refuses a non-finite or negative amount, refuses a claim raised in the future, and refuses to edit an answered claim by name.';

create or replace function public.answer_contract_claim(
  p_claim_id bigint,
  p_answer text,
  p_note text,
  p_settled_value text default null,
  p_settled_time_days text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c contract_claims%rowtype;
  p contract_packages%rowtype;
  v_answer text := lower(nullif(btrim(coalesce(p_answer, '')), ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_settled numeric := sync_finite_money(p_settled_value);
  v_settled_days int := sync_text_as_int(p_settled_time_days);
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'answering a claim is a §70 human act: it is a determination about a contractual entitlement between two parties, and it is the document a dispute is decided on. The AI may assemble the record, price the claim and draft the position; a named person answers it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'answering a claim requires a management or executive role');
  end if;
  if v_answer not in ('accepted','partially_accepted','rejected') then
    return jsonb_build_object('error',
      'the answer must be accepted, partially_accepted or rejected. A claim the claimant no longer presses is WITHDRAWN by them (withdraw_contract_claim), which is a different act.');
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'state the answer (note, 20 characters minimum) — the reasoning somebody reads when this claim is arbitrated');
  end if;

  select * into c from contract_claims
   where id = p_claim_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'claim not found');
  end if;
  if c.answered_at is not null then
    return jsonb_build_object('error', format(
      'claim %s was answered on %s (%s). A claim is answered once — a further position on the same facts is a further claim, and re-answering this one would replace the answer the counterparty was given.',
      c.claim_ref, c.answered_at, c.status));
  end if;
  select * into p from contract_packages where id = c.package_id;

  -- The person who raised the claim does not answer it. One person doing both
  -- is what makes a claims register a formality.
  if c.last_priced_by is not null and c.last_priced_by = auth.uid()
     and c.last_priced_by is distinct from c.raised_by then
    return jsonb_build_object('error', format(
      'you set the value of claim %s (%s %s). Answering a figure you wrote is one person making and determining a claim, whoever raised it. Route it to somebody who neither raised nor priced it.',
      c.claim_ref, c.currency, c.claimed_value));
  end if;
  if c.raised_by is not null and c.raised_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you raised claim %s. Answering your own claim is not an answer — route it to somebody who did not raise it.',
      c.claim_ref));
  end if;

  if v_answer = 'rejected' then
    v_settled := null;
    v_settled_days := null;
  elsif v_answer = 'accepted' then
    -- Accepted in full means exactly that. A settled amount below the claim is
    -- `partially_accepted`, and calling it "accepted" would make the two
    -- indistinguishable in every total.
    if p_settled_value is not null
       and nullif(btrim(p_settled_value), '') is not null
       and v_settled is distinct from c.claimed_value then
      return jsonb_build_object('error', format(
        'claim %s is for %s %s and this answer settles it at %s. Accepting in full means settling at the amount claimed; settling below it is partially_accepted, and recording it as "accepted" makes a negotiated reduction indistinguishable from a claim paid in full.',
        c.claim_ref, c.currency, c.claimed_value, coalesce(v_settled::text, p_settled_value)));
    end if;
    v_settled := c.claimed_value;
    v_settled_days := coalesce(v_settled_days, c.time_claimed_days);
  else
    if nullif(btrim(coalesce(p_settled_value, '')), '') is null then
      return jsonb_build_object('error',
        'a partial acceptance states what it settles at (settled_value)');
    end if;
    if v_settled is null or v_settled < 0 then
      return jsonb_build_object('error', format(
        'the settled amount is %s; it must be a finite amount of at least zero.', p_settled_value));
    end if;
    if v_settled >= c.claimed_value then
      return jsonb_build_object('error', format(
        'claim %s is for %s %s and a partial acceptance settles it BELOW that. Settling at or above the amount claimed is `accepted`.',
        c.claim_ref, c.currency, c.claimed_value));
    end if;
    v_settled_days := coalesce(v_settled_days, 0);
  end if;
  if v_settled_days is not null
     and (v_settled_days < 0 or v_settled_days > c.time_claimed_days) then
    return jsonb_build_object('error', format(
      'claim %s claims %s day(s) and this answer grants %s. An answer cannot grant more time than was claimed.',
      c.claim_ref, c.time_claimed_days, v_settled_days));
  end if;

  v_prev := jsonb_build_object('status', c.status, 'answered_at', c.answered_at);
  perform set_config('app.contract_claim_write', 'granted', true);
  update contract_claims
     set status = v_answer, answered_by = auth.uid(), answered_at = now(),
         answer_note = v_note, settled_value = v_settled,
         settled_time_days = v_settled_days
   where id = c.id;
  perform set_config('app.contract_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'claim_id', c.id, 'claim_ref', c.claim_ref,
      'action', 'answered'),
    v_prev,
    jsonb_build_object('status', v_answer, 'settled_value', v_settled,
      'settled_time_days', v_settled_days, 'currency', c.currency,
      'answered_by', auth.uid(), 'note', v_note));

  return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
    'status', v_answer, 'claimedValue', c.claimed_value,
    'settledValue', v_settled, 'currency', c.currency,
    'settledTimeDays', v_settled_days,
    'frozen', true,
    'contractValue', contract_current_value(p.id),
    'carryNote', case when coalesce(v_settled, 0) > 0 then format(
      'This answer settles %s %s. The contract is NOT changed by it: what the contract is worth is its award plus its approved change orders, so record a change order carrying this settlement (record_contract_change_order) and have it approved under the contract-award delegation. Until then the commercial read states %s %s of settled claims BESIDE the approved change orders, and does not difference the two — nothing links a settlement to the change order that carries it, so the difference would be a number nobody could derive.',
      c.currency, v_settled, c.currency, v_settled) end);
end
$$;

revoke all on function public.answer_contract_claim(bigint, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.answer_contract_claim(bigint, text, text, text, text)
  to authenticated;

comment on function public.answer_contract_claim(bigint, text, text, text, text) is
  'D6.06 / spec I.16 Claim × §70: answers a claim once and FREEZES it. Refused for the AI-operator identity by name, refused for the person who raised the claim, refused a second time on an answered claim, refused when "accepted" is used for a settlement below the amount claimed (which would make a negotiated reduction indistinguishable from a claim paid in full), and refused when the answer grants more time than was claimed. It does NOT move the contract''s value: that is a change order, and the commercial read states the settled total beside the approved change-order total rather than differencing them.';

create or replace function public.withdraw_contract_claim(
  p_claim_id bigint,
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
  c contract_claims%rowtype;
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
      'withdrawing a claim requires a planning, engineering or governance role');
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why the claim is withdrawn (reason, 20 characters minimum)');
  end if;
  select * into c from contract_claims
   where id = p_claim_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'claim not found');
  end if;
  if c.answered_at is not null then
    return jsonb_build_object('error', format(
      'claim %s was answered on %s (%s). An answered claim is not withdrawn — the answer is the record of what was determined.',
      c.claim_ref, c.answered_at, c.status));
  end if;
  select * into p from contract_packages where id = c.package_id;

  perform set_config('app.contract_claim_write', 'granted', true);
  update contract_claims
     set status = 'withdrawn', answered_by = auth.uid(), answered_at = now(),
         answer_note = v_reason
   where id = c.id;
  perform set_config('app.contract_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'claim_id', c.id, 'claim_ref', c.claim_ref,
      'action', 'withdrawn'),
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', 'withdrawn', 'reason', v_reason,
      'withdrawn_by', auth.uid()));

  return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
    'status', 'withdrawn', 'frozen', true,
    'note', 'Withdrawn and frozen, not deleted: a claim somebody made and dropped is not the same as one nobody made.');
end
$$;

revoke all on function public.withdraw_contract_claim(bigint, text) from public, anon, service_role;
grant execute on function public.withdraw_contract_claim(bigint, text) to authenticated;

comment on function public.withdraw_contract_claim(bigint, text) is
  'D6.06: withdraws an OPEN claim with a stated reason, and freezes it. An answered claim is refused — the answer is the record of what was determined.';

-- ---------------------------------------------------------------------------
-- 6. THE INVOICE WRITE PATHS.
-- ---------------------------------------------------------------------------
create or replace function public.record_contract_invoice(
  p_package_id bigint,
  p_invoice jsonb
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
  v_ref text := nullif(btrim(coalesce(p_invoice->>'invoice_ref','')), '');
  v_desc text := nullif(btrim(coalesce(p_invoice->>'description','')), '');
  v_raw text := nullif(btrim(coalesce(p_invoice->>'gross_amount','')), '');
  v_amount numeric := sync_finite_money(p_invoice->>'gross_amount');
  v_date date := sync_text_as_date(p_invoice->>'invoice_date');
  v_from date := sync_text_as_date(p_invoice->>'period_start');
  v_to date := sync_text_as_date(p_invoice->>'period_end');
  v_existing contract_invoices%rowtype;
  v_dup contract_invoices%rowtype;
  v_revising boolean;
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
      'recording an invoice requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded. An invoice is issued under a CONTRACT — certifying one against a package nobody has awarded pays for an agreement that does not exist.',
      p.package_code));
  end if;
  if p.awarded_supplier_id is null then
    return jsonb_build_object('error', format(
      'contract %s names no supplier, so nothing can say who this invoice is from.', p.package_code));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the invoice needs an invoice_ref — the supplier''s own invoice number, which is what the duplicate-payment wall is keyed on');
  end if;
  if v_desc is null or length(v_desc) < 10 then
    return jsonb_build_object('error',
      'state what is being invoiced (description, 10 characters minimum)');
  end if;
  if v_raw is null then
    return jsonb_build_object('error', 'state the amount invoiced (gross_amount)');
  end if;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the amount invoiced is %s; it must be a finite amount greater than zero. A credit is recorded as its own invoice against the party that owes it, not as a negative invoice, so that both facts stay on the ledger.',
      v_raw));
  end if;
  if v_date is null then
    return jsonb_build_object('error',
      'state the invoice date. It is what a payment term is counted from, and an invoice with no date cannot be aged.');
  end if;
  if v_date > current_date then
    return jsonb_build_object('error', 'an invoice cannot be dated in the future');
  end if;
  if v_from is not null and v_to is not null and v_to < v_from then
    return jsonb_build_object('error', 'the invoice period ends before it starts');
  end if;

  -- THE DUPLICATE, NAMED AT THE DOOR. The unique index refuses it for every
  -- writer; a caller should read the sentence, not a constraint name — and the
  -- sentence has to say WHERE the first one is, because the duplicate is
  -- routinely lodged against a different package.
  select * into v_dup from contract_invoices
   where organization_id = v_org
     and supplier_id = p.awarded_supplier_id
     and lower(btrim(invoice_ref)) = lower(btrim(v_ref))
     and (package_id <> p.id or invoice_ref <> v_ref);
  if found then
    return jsonb_build_object('error', format(
      'invoice %s from this supplier is already recorded against package %s (%s %s, %s). One invoice number from one supplier exists once in this organization: re-entering it — most often against a different package — is how the same invoice gets paid twice.',
      v_ref,
      (select package_code from contract_packages where id = v_dup.package_id),
      v_dup.currency, v_dup.gross_amount, v_dup.status));
  end if;

  select * into v_existing from contract_invoices
   where package_id = p.id and invoice_ref = v_ref;
  v_revising := found;
  if v_revising then
    if v_existing.certified_at is not null then
      return jsonb_build_object('error', format(
        'invoice %s was %s on %s and is frozen. The amount billed and the amount certified do not move after certification — an invoice whose figures can change afterwards can be paid for more than anybody approved.',
        v_ref, v_existing.status, v_existing.certified_at));
    end if;
    v_prev := jsonb_build_object('gross_amount', v_existing.gross_amount,
      'invoice_date', v_existing.invoice_date, 'description', v_existing.description,
      'last_priced_by', v_existing.last_priced_by);
    perform set_config('app.contract_invoice_write', 'granted', true);
    -- last_priced_by moves with the amount; recorded_by does not.
    update contract_invoices
       set description = v_desc, gross_amount = v_amount, invoice_date = v_date,
           period_start = v_from, period_end = v_to, currency = p.contract_currency,
           last_priced_by = auth.uid()
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.contract_invoice_write', 'granted', true);
    insert into contract_invoices
      (organization_id, package_id, invoice_ref, supplier_id, invoice_date,
       period_start, period_end, description, gross_amount, currency, recorded_by,
       last_priced_by)
    values (v_org, p.id, v_ref, p.awarded_supplier_id, v_date, v_from, v_to,
            v_desc, v_amount, p.contract_currency, auth.uid(), auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.contract_invoice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_invoice', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'invoice_id', v_id, 'invoice_ref', v_ref,
      'action', case when v_revising then 'revised' else 'received' end),
    v_prev,
    jsonb_build_object('invoice_ref', v_ref, 'gross_amount', v_amount,
      'currency', p.contract_currency, 'invoice_date', v_date,
      'description', v_desc));

  return jsonb_build_object('invoice_id', v_id, 'invoice_ref', v_ref,
    'package_code', p.package_code, 'grossAmount', v_amount,
    'currency', p.contract_currency, 'invoiceDate', v_date,
    'status', 'received', 'revised', v_revising,
    'note',
      'Received, not certified and not payable. Certification is a §70 human act, it may not take the contract''s certified total above what the contract is worth, and payment is only possible after it.');
end
$$;

revoke all on function public.record_contract_invoice(bigint, jsonb) from public, anon;
grant execute on function public.record_contract_invoice(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_contract_invoice(bigint, jsonb) is
  'D6.06 / spec I.16 Invoice: records an invoice RECEIVED under an awarded contract. Refuses before the award, refuses a non-finite or non-positive amount (a credit is its own invoice, not a negative one), refuses a future date, refuses to revise a certified invoice, and refuses a DUPLICATE invoice number from the same supplier BY NAME — naming the package the first one is on, because that is where the second one usually is not.';

create or replace function public.certify_contract_invoice(
  p_invoice_id bigint,
  p_decision text,
  p_note text,
  p_certified_amount text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  i contract_invoices%rowtype;
  p contract_packages%rowtype;
  v_decision text := lower(nullif(btrim(coalesce(p_decision, '')), ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_amount numeric := sync_finite_money(p_certified_amount);
  v_position jsonb;
  v_value numeric;
  v_certified numeric;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'certifying an invoice is a §70 human act: it is the statement that work was done and money is due, and it is what a payment run executes without asking again. The AI may check the invoice against the contract, the commitments and the progress record; a named person certifies it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'certifying an invoice requires a management or executive role');
  end if;
  if v_decision not in ('certified','rejected') then
    return jsonb_build_object('error', 'the decision must be certified or rejected');
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'state what is being certified and against what evidence (note, 20 characters minimum)');
  end if;

  select * into i from contract_invoices
   where id = p_invoice_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'invoice not found');
  end if;
  if i.certified_at is not null then
    return jsonb_build_object('error', format(
      'invoice %s was %s on %s. An invoice is certified once — a second certification would replace the figure a payment run has already been told to pay.',
      i.invoice_ref, i.status, i.certified_at));
  end if;
  -- THE PACKAGE ROW, LOCKED. The FOR UPDATE above locks the INVOICE, which
  -- only stops one invoice being certified twice. The ceiling this act is
  -- checked against — contract_invoice_position — sums the certified amounts
  -- of every OTHER invoice on the package, and nothing serialized that read.
  -- Measured live before this line was written: two 400,000 invoices on a
  -- CAD 650,000 contract, certified concurrently, each read certifiedTotal =
  -- 0 and each passed; both were then payable through their own once-only
  -- walls and CAD 800,000 left the bank against a CAD 650,000 contract, with
  -- un-paying refused for every caller so the over-payment could not be
  -- reversed. Package first, then case, at every door in this family.
  select * into p from contract_packages where id = i.package_id for update;

  if i.recorded_by is not null and i.recorded_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you recorded invoice %s. Certifying an invoice you entered is one person creating and approving a payment — route it to somebody who did not record it.',
      i.invoice_ref));
  end if;
  if i.last_priced_by is not null and i.last_priced_by = auth.uid()
     and i.last_priced_by is distinct from i.recorded_by then
    return jsonb_build_object('error', format(
      'you set the amount of invoice %s (%s %s). Certifying a figure you wrote is one person creating and approving a payment, whoever entered the invoice first — record_contract_invoice revises in place and does not move who recorded it. Route it to somebody who neither recorded nor priced it.',
      i.invoice_ref, i.currency, i.gross_amount));
  end if;

  if v_decision = 'rejected' then
    v_prev := jsonb_build_object('status', i.status, 'certified_at', i.certified_at);
    perform set_config('app.contract_invoice_write', 'granted', true);
    update contract_invoices
       set status = 'rejected', certified_by = auth.uid(), certified_at = now(),
           certification_note = v_note
     where id = i.id;
    perform set_config('app.contract_invoice_write', '', true);
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (v_org, 'contract_invoice', coalesce(v_role, 'unknown'),
      jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
        'package_code', p.package_code, 'invoice_id', i.id,
        'invoice_ref', i.invoice_ref, 'action', 'rejected'),
      v_prev,
      jsonb_build_object('status', 'rejected', 'certified_by', auth.uid(),
        'note', v_note, 'gross_amount', i.gross_amount));
    return jsonb_build_object('invoice_id', i.id, 'invoice_ref', i.invoice_ref,
      'status', 'rejected', 'frozen', true,
      'note', 'Rejected and frozen. Nothing is payable against it, and the rejection stays on the ledger — a rejected invoice deleted is a dispute nobody can reconstruct.');
  end if;

  -- The amount certified: the gross unless a lesser figure is stated.
  if nullif(btrim(coalesce(p_certified_amount, '')), '') is null then
    v_amount := i.gross_amount;
  elsif v_amount is null or v_amount <= 0 then
    return jsonb_build_object('error', format(
      'the certified amount is %s; it must be a finite amount greater than zero, or omitted to certify the invoice in full.',
      p_certified_amount));
  elsif v_amount > i.gross_amount then
    return jsonb_build_object('error', format(
      'invoice %s is for %s %s and this would certify %s. Certifying more than was invoiced pays money nobody billed for.',
      i.invoice_ref, i.currency, i.gross_amount, v_amount));
  end if;

  -- THE ONE POSITION, AND ITS REFUSALS. Reading it here rather than
  -- re-summing means the ceiling this certification is checked against is
  -- exactly the number the commercial screen shows.
  v_position := contract_invoice_position(p.id);
  if (v_position->>'answered')::boolean is not true then
    return jsonb_build_object('error', v_position->>'refusal');
  end if;
  v_value := (v_position->>'contractValue')::numeric;
  v_certified := coalesce((v_position->>'certifiedTotal')::numeric, 0);
  if v_value is null then
    return jsonb_build_object('error', format(
      'contract %s states no value, so nothing here can say whether this certification is within it.', p.package_code));
  end if;
  if v_certified + v_amount > v_value then
    return jsonb_build_object('error', format(
      'contract %s is worth %s %s (its award plus every approved change order) and %s is already certified. Certifying a further %s would take the total to %s — beyond what the contract obliges the owner to pay. Approve a change order first if the work was instructed, or certify %s.',
      p.package_code, i.currency, v_value, v_certified, v_amount,
      v_certified + v_amount, v_value - v_certified),
      'contractValue', v_value, 'certifiedTotal', v_certified,
      'remainingToCertify', v_value - v_certified);
  end if;

  v_prev := jsonb_build_object('status', i.status, 'certified_at', i.certified_at);
  perform set_config('app.contract_invoice_write', 'granted', true);
  update contract_invoices
     set status = 'certified', certified_by = auth.uid(), certified_at = now(),
         certification_note = v_note, certified_amount = v_amount
   where id = i.id;
  perform set_config('app.contract_invoice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_invoice', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'invoice_id', i.id,
      'invoice_ref', i.invoice_ref, 'action', 'certified'),
    v_prev,
    jsonb_build_object('status', 'certified', 'certified_amount', v_amount,
      'gross_amount', i.gross_amount, 'currency', i.currency,
      'certified_by', auth.uid(), 'note', v_note,
      'certifiedTotalAfter', v_certified + v_amount, 'contractValue', v_value));

  return jsonb_build_object('invoice_id', i.id, 'invoice_ref', i.invoice_ref,
    'status', 'certified', 'grossAmount', i.gross_amount,
    'certifiedAmount', v_amount, 'currency', i.currency,
    'certifiedTotal', v_certified + v_amount, 'contractValue', v_value,
    'remainingToCertify', v_value - v_certified - v_amount,
    'withheld', case when v_amount < i.gross_amount then i.gross_amount - v_amount end,
    'frozen', true,
    'note', 'Certified and frozen. It is payable ONCE, through record_invoice_payment, which refuses a second payment by name and requires a payment reference no other paid invoice in this organization carries.');
end
$$;

revoke all on function public.certify_contract_invoice(bigint, text, text, text)
  from public, anon, service_role;
grant execute on function public.certify_contract_invoice(bigint, text, text, text)
  to authenticated;

comment on function public.certify_contract_invoice(bigint, text, text, text) is
  'D6.06 / spec I.16 Invoice × §70: certifies or rejects an invoice ONCE and freezes it. Refused for the AI-operator identity by name, refused for the person who recorded the invoice, refused above the gross, and REFUSED when the certified total would exceed contract_current_value() — the award plus approved change orders — read from the ONE invoice position so the ceiling and the screen cannot diverge.';

create or replace function public.record_invoice_payment(
  p_invoice_id bigint,
  p_payment_reference text,
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
  i contract_invoices%rowtype;
  p contract_packages%rowtype;
  v_ref text := nullif(btrim(coalesce(p_payment_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_other contract_invoices%rowtype;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording a payment is a human act: it is the assertion that the owner''s money left the bank against this invoice, and it is what makes the invoice unpayable again. A named person records it.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'recording a payment requires a management or executive role');
  end if;
  if v_ref is null or length(v_ref) < 3 then
    return jsonb_build_object('error',
      'state the payment reference (3 characters minimum) — the bank or ledger reference this payment carries. Without it a payment cannot be reconciled to a statement, and an unreconcilable payment is how the same invoice is paid twice without anybody noticing.');
  end if;
  if v_note is null or length(v_note) < 10 then
    return jsonb_build_object('error',
      'state what was paid and from where (note, 10 characters minimum)');
  end if;

  select * into i from contract_invoices
   where id = p_invoice_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'invoice not found');
  end if;

  -- THE SECOND PAYMENT, NAMED. The table wall refuses the write for every
  -- caller; a caller should read this instead of a check violation.
  if i.paid_at is not null then
    return jsonb_build_object('error', format(
      'invoice %s was PAID on %s under payment reference %s (%s %s). It is not payable a second time — and the payment record cannot be cleared to make it so, for any caller. A payment made in error is corrected by a credit recorded as its own invoice, which leaves both facts on the ledger.',
      i.invoice_ref, i.paid_at::date, i.payment_reference, i.currency, i.certified_amount),
      'paidAt', i.paid_at, 'paymentReference', i.payment_reference);
  end if;
  if i.status <> 'certified' then
    return jsonb_build_object('error', format(
      'invoice %s is %s. Only a CERTIFIED invoice is payable: certification is the statement that the work was done and the money is due, and paying without it pays on the supplier''s word alone.',
      i.invoice_ref, i.status));
  end if;

  -- ONE BANK PAYMENT, ONE INVOICE. The unique index refuses it for every
  -- writer; this names the invoice it is already against.
  select * into v_other from contract_invoices
   where organization_id = v_org and paid_at is not null
     and lower(btrim(payment_reference)) = lower(v_ref);
  if found then
    return jsonb_build_object('error', format(
      'payment reference %s is already recorded against invoice %s, paid on %s. One payment settles one invoice: reusing the reference is how a single bank payment comes to explain two settled invoices, and the reconciliation then balances while one supplier has been paid twice.',
      v_ref, v_other.invoice_ref, v_other.paid_at::date));
  end if;

  select * into p from contract_packages where id = i.package_id;
  v_prev := jsonb_build_object('status', i.status, 'paid_at', i.paid_at);
  perform set_config('app.contract_invoice_write', 'granted', true);
  update contract_invoices
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         payment_reference = v_ref
   where id = i.id;
  perform set_config('app.contract_invoice_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_invoice', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'invoice_id', i.id,
      'invoice_ref', i.invoice_ref, 'action', 'paid'),
    v_prev,
    jsonb_build_object('status', 'paid', 'paid_amount', i.certified_amount,
      'currency', i.currency, 'payment_reference', v_ref,
      'paid_by', auth.uid(), 'note', v_note));

  return jsonb_build_object('invoice_id', i.id, 'invoice_ref', i.invoice_ref,
    'status', 'paid', 'paidAmount', i.certified_amount, 'currency', i.currency,
    'paymentReference', v_ref,
    'position', contract_invoice_position(p.id),
    'note', 'Paid once. This invoice cannot be paid again, cannot be un-paid, and this payment reference cannot be recorded against another invoice — three separate walls, because a duplicate payment takes three separate routes.');
end
$$;

revoke all on function public.record_invoice_payment(bigint, text, text)
  from public, anon, service_role;
grant execute on function public.record_invoice_payment(bigint, text, text) to authenticated;

comment on function public.record_invoice_payment(bigint, text, text) is
  'D6.06 / spec I.16 Invoice: records the ONE payment of a certified invoice. Refuses a second payment BY NAME (quoting the date and the reference), refuses an uncertified invoice, and refuses a payment reference already recorded against another paid invoice. Un-paying is refused at the table for every caller, service paths included.';

notify pgrst, 'reload schema';
