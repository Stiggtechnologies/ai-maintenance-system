-- ============================================================================
-- Sync Develop — Slice 6B, part 3 of 4.
-- D6.06 (Commercial lifecycle objects, spec I.16) — the WARRANTY, and the
-- commercial read that puts the five objects on one screen.
--
-- WHAT THE REGISTER ROW SAID. `warranty_terms` and `warranty_claims`
-- (20260817140000:205,227) have existed since the supplier-management
-- migration and have ZERO references outside it: not read anywhere, not
-- written anywhere, not even demo-seeded. Schema is not a capability. This
-- file gives them their write paths and — the property the row turns on — an
-- EXPIRY THAT BITES.
--
-- THE FAILURE MODE, NAMED. A warranty that never stops covering is worse than
-- no warranty record at all, because it is the one a claim gets presented
-- against years after the remedy lapsed, and the product agrees. So:
--
--   * `record_warranty_term` REFUSES a term that states neither an end date
--     nor a usage limit. A warranty must expire. "Perpetual" is not a term
--     anybody wrote; it is a term nobody finished.
--   * `warranty_cover_position` is the ONE predicate for "was this covered on
--     that date". It REFUSES to answer for a legacy row with no stated
--     expiry rather than answering "covered" — refusal-first, on exactly the
--     question where a confident answer is the harm.
--   * a claim raised for a failure outside cover is REFUSED at the door,
--     naming the date the cover ended and by how long it was missed.
--   * a claim raised inside cover but SUBMITTED after the claim window closed
--     is recorded `time_barred` with the arithmetic stated, rather than
--     quietly submitted — that is a real commercial state and it is the
--     vendor-quality history's most expensive line.
--
-- ONE PREDICATE, ONE ANSWER. Every door that needs to know whether something
-- is covered calls warranty_cover_position. The screens call it too. There is
-- no second expiry arithmetic anywhere in the product.
--
-- §70: accepting a warranty settlement is a human act, refused for the
-- AI-operator identity at the door and at the table.
--
-- Canonical reuse: warranty_terms, warranty_claims, contract_packages,
-- suppliers, assets, materials, work_orders, contract_current_value,
-- contract_invoice_position, contract_commitment_position,
-- enforce_procurement_act_is_human, record_procurement_service_write,
-- sync_finite_money, sync_text_as_date, sync_text_as_uuid, audit_events.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE TWO EXISTING TABLES GROW THE COLUMNS A LIFECYCLE NEEDS.
--    Nullable, because these tables predate this slice; the RPCs require what
--    matters and the walls hold it for every writer.
-- ---------------------------------------------------------------------------
alter table public.warranty_terms
  add column if not exists warranty_ref text,
  -- CASCADE at the constraint, refused at the wall — the
  -- contract_commitment_lines posture (20261208090200:635). An awarded package
  -- cannot be deleted at all, so this cascade only ever fires in a genuine
  -- development-case teardown; a direct delete of a claimed-against term is
  -- refused BY NAME below while its contract is still there.
  add column if not exists package_id bigint references contract_packages(id) on delete cascade,
  add column if not exists basis text,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz;

create unique index if not exists idx_warranty_term_ref
  on warranty_terms(organization_id, warranty_ref) where warranty_ref is not null;
create index if not exists idx_warranty_term_package
  on warranty_terms(package_id) where package_id is not null;

comment on column public.warranty_terms.ends_on is
  'D6.06: the date cover ends. Required by record_warranty_term unless the term expires on USAGE instead — a warranty must expire, and warranty_cover_position REFUSES to answer for a term that states neither, because "covered" is the answer that costs money years later.';
comment on column public.warranty_terms.package_id is
  'D6.06 / spec §24 `warranty_terms`: the contract this warranty came out of. contract_packages.warranty_term_id points the other way (20261208090200) and is the §24 field; this is the reverse hop, so a contract''s warranties are readable without scanning.';
comment on column public.warranty_terms.claim_window_days is
  'D6.06: how long after a failure a claim may be lodged. Distinct from the cover period: a failure INSIDE cover whose claim is lodged after this window has closed is `time_barred`, which is a real and expensive state, and submit_warranty_claim records it as one rather than submitting it.';

alter table public.warranty_claims
  add column if not exists claim_ref text,
  add column if not exists failure_on date,
  add column if not exists usage_at_failure numeric,
  add column if not exists currency text,
  add column if not exists cover_basis text,
  add column if not exists raised_by uuid references auth.users(id),
  add column if not exists submitted_by uuid references auth.users(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists answered_by uuid references auth.users(id),
  add column if not exists answered_at timestamptz,
  add column if not exists answer_note text;

create unique index if not exists idx_warranty_claim_ref
  on warranty_claims(organization_id, claim_ref) where claim_ref is not null;
create index if not exists idx_warranty_claim_warranty
  on warranty_claims(warranty_id) where warranty_id is not null;

-- THE CLAIM FOLLOWS ITS TERM. `on delete set null` (20260817140000) left a
-- claim pointing at nothing when its term went, and a claim whose cover cannot
-- be re-derived is a claim nobody can defend or refuse. Deleting a term that
-- carries claims is refused outright while its contract is still there, so
-- this cascade fires only in a genuine teardown.
alter table public.warranty_claims
  drop constraint if exists warranty_claims_warranty_id_fkey;
alter table public.warranty_claims
  add constraint warranty_claims_warranty_id_fkey
  foreign key (warranty_id) references warranty_terms(id) on delete cascade;

alter table public.warranty_claims
  drop constraint if exists warranty_claim_value_finite;
alter table public.warranty_claims
  add constraint warranty_claim_value_finite check (
    claim_value is null
    or (claim_value <> 'NaN'::numeric
        and claim_value > '-Infinity'::numeric
        and claim_value < 'Infinity'::numeric
        and claim_value >= 0));

alter table public.warranty_claims
  drop constraint if exists warranty_claim_recovered_finite;
alter table public.warranty_claims
  add constraint warranty_claim_recovered_finite check (
    recovered_value is null
    or (recovered_value <> 'NaN'::numeric
        and recovered_value > '-Infinity'::numeric
        and recovered_value < 'Infinity'::numeric
        and recovered_value >= 0));

alter table public.warranty_claims
  drop constraint if exists warranty_claim_answer_actor;
alter table public.warranty_claims
  add constraint warranty_claim_answer_actor check (
    (answered_at is null) = (answered_by is null));

alter table public.warranty_claims
  drop constraint if exists warranty_claim_answer_note;
alter table public.warranty_claims
  add constraint warranty_claim_answer_note check (
    answer_note is null or length(btrim(answer_note)) >= 20);

-- A recovery is recorded only where something was accepted; a rejected claim
-- that carries a recovered value would report money nobody agreed to pay.
alter table public.warranty_claims
  drop constraint if exists warranty_claim_recovery_only_when_accepted;
alter table public.warranty_claims
  add constraint warranty_claim_recovery_only_when_accepted check (
    recovered_value is null or status = 'accepted');

comment on column public.warranty_claims.failure_on is
  'D6.06: the date the failure occurred. THE date cover is tested at — not the date the claim was raised, which a claimant chooses. warranty_cover_position is asked about this date and its answer is recorded verbatim in cover_basis.';
comment on column public.warranty_claims.cover_basis is
  'D6.06: the cover answer this claim was admitted on, recorded at the moment it was raised. A warranty term can later be revised; what a claim was admitted on cannot be.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE COVER PREDICATE.
--
--    Asked by the claim door, by the vendor-quality accrual and by every read.
--    There is no second expiry arithmetic in the product.
-- ---------------------------------------------------------------------------
create or replace function public.warranty_cover_position(
  p_warranty_id bigint,
  p_on date,
  p_usage numeric default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w warranty_terms%rowtype;
begin
  select * into w from warranty_terms where id = p_warranty_id;
  if not found then
    return jsonb_build_object('answered', false, 'covered', null,
      'refusal', 'warranty term not found');
  end if;
  if p_on is null then
    return jsonb_build_object('answered', false, 'covered', null,
      'refusal', 'Cover is a question about a DATE — the date the failure happened. Without one there is nothing to test the term against, and answering "covered" would be answering a question nobody asked.');
  end if;

  -- THE REFUSAL THIS FUNCTION EXISTS FOR. A term with no stated end and no
  -- stated usage limit does not cover forever; it is a term whose end nobody
  -- recorded. Answering "covered" here is how a claim is presented years
  -- after the remedy lapsed, with the product agreeing.
  if w.ends_on is null and w.usage_limit is null then
    return jsonb_build_object('answered', false, 'covered', null,
      'warrantyId', w.id, 'startsOn', w.starts_on,
      'refusal', format(
        'Warranty term %s states neither an end date nor a usage limit, so whether it covered a failure on %s cannot be answered. It is REFUSED rather than assumed: an unstated expiry is not a permanent warranty, it is a warranty nobody finished recording — and silently permanent cover is exactly the answer a claim gets presented against years after the remedy lapsed. Record the end date or the usage limit that was actually agreed.',
        coalesce(w.warranty_ref, w.id::text), p_on));
  end if;

  if p_on < w.starts_on then
    return jsonb_build_object('answered', true, 'covered', false,
      'warrantyId', w.id, 'startsOn', w.starts_on, 'endsOn', w.ends_on,
      'reason', format(
        'Warranty term %s starts on %s and this failure is dated %s — %s day(s) before cover began.',
        coalesce(w.warranty_ref, w.id::text), w.starts_on, p_on, w.starts_on - p_on));
  end if;

  if w.ends_on is not null and p_on > w.ends_on then
    return jsonb_build_object('answered', true, 'covered', false,
      'warrantyId', w.id, 'startsOn', w.starts_on, 'endsOn', w.ends_on,
      'expiredByDays', p_on - w.ends_on,
      'reason', format(
        'Warranty term %s EXPIRED on %s. This failure is dated %s — %s day(s) after cover ended, so it is not covered. An expired warranty stops covering; it does not keep covering quietly.',
        coalesce(w.warranty_ref, w.id::text), w.ends_on, p_on, p_on - w.ends_on));
  end if;

  if w.usage_limit is not null then
    if p_usage is null then
      -- A usage-limited term with no reading is NOT ASSESSABLE on that leg.
      -- If usage is the ONLY limit, the whole question refuses; if a date
      -- limit also exists, the date answer stands and the gap is named.
      if w.ends_on is null then
        return jsonb_build_object('answered', false, 'covered', null,
          'warrantyId', w.id, 'usageLimit', w.usage_limit, 'usageUnit', w.usage_unit,
          'refusal', format(
            'Warranty term %s expires on USAGE (%s %s) and no reading was supplied for this failure, so whether it was still covered cannot be answered. A usage-limited warranty with no reading is not a covered one.',
            coalesce(w.warranty_ref, w.id::text), w.usage_limit,
            coalesce(w.usage_unit, 'units')));
      end if;
      return jsonb_build_object('answered', true, 'covered', true,
        'warrantyId', w.id, 'startsOn', w.starts_on, 'endsOn', w.ends_on,
        'daysRemaining', w.ends_on - p_on,
        'usageLimit', w.usage_limit, 'usageUnit', w.usage_unit,
        'usageAssessed', false,
        'reason', format(
          'Covered on the DATE leg: warranty term %s runs to %s and this failure is dated %s. The USAGE leg (%s %s) was not assessed because no reading was supplied, so cover is confirmed on one of the two limits, not both.',
          coalesce(w.warranty_ref, w.id::text), w.ends_on, p_on, w.usage_limit,
          coalesce(w.usage_unit, 'units')));
    end if;
    if p_usage > w.usage_limit then
      return jsonb_build_object('answered', true, 'covered', false,
        'warrantyId', w.id, 'usageLimit', w.usage_limit, 'usageUnit', w.usage_unit,
        'usageAtFailure', p_usage, 'usageAssessed', true,
        'reason', format(
          'Warranty term %s expires at %s %s and this failure occurred at %s. The usage limit was passed, so it is not covered — a warranty that runs out on hours runs out whatever the calendar says.',
          coalesce(w.warranty_ref, w.id::text), w.usage_limit,
          coalesce(w.usage_unit, 'units'), p_usage));
    end if;
  end if;

  return jsonb_build_object('answered', true, 'covered', true,
    'warrantyId', w.id, 'startsOn', w.starts_on, 'endsOn', w.ends_on,
    'daysRemaining', case when w.ends_on is not null then w.ends_on - p_on end,
    'usageLimit', w.usage_limit, 'usageUnit', w.usage_unit,
    'usageAtFailure', p_usage,
    'usageAssessed', w.usage_limit is not null and p_usage is not null,
    'claimWindowDays', w.claim_window_days,
    'reason', format(
      'Covered: warranty term %s runs from %s%s and this failure is dated %s.',
      coalesce(w.warranty_ref, w.id::text), w.starts_on,
      case when w.ends_on is not null then ' to ' || w.ends_on::text else '' end, p_on));
end
$$;

revoke all on function public.warranty_cover_position(bigint, date, numeric)
  from public, anon, authenticated, service_role;

comment on function public.warranty_cover_position(bigint, date, numeric) is
  'D6.06: THE ONE predicate for "did this warranty cover a failure on that date". An expired term answers covered=false naming the expiry and the days missed; a term with NEITHER an end date NOR a usage limit REFUSES rather than answering covered, because silently permanent cover is the failure mode this family exists to prevent; a usage-limited term with no reading refuses that leg rather than assuming it. Every door and every screen reads this one function — there is no second expiry arithmetic.';

-- ---------------------------------------------------------------------------
-- 3. THE WALLS.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_warranty_term_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.warranty_term_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_claims int;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'warranty_terms is what every warranty claim was admitted against. Truncating it leaves the claims pointing at nothing and every remaining question about cover unanswerable. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE, in three shapes: the organization is going, the CONTRACT
    -- this term came out of is going (which is how a development-case teardown
    -- reaches the warranty leg), or the ASSET the warranty attaches to is
    -- going. Whichever arrives here first must not refuse, or the parent
    -- delete aborts and the case becomes permanently undeletable.
    if not exists (select 1 from organizations where id = old.organization_id)
       or (old.package_id is not null
           and not exists (select 1 from contract_packages where id = old.package_id))
       or (old.asset_id is not null
           and not exists (select 1 from assets where id = old.asset_id)) then
      return old;
    end if;
    select count(*) into v_claims from warranty_claims where warranty_id = old.id;
    if coalesce(v_claims, 0) > 0 then
      raise exception
        'Warranty term % carries % claim(s). Deleting it detaches them from the terms they were admitted under, and a claim whose cover cannot be re-derived is a claim nobody can defend or refuse.',
        coalesce(old.warranty_ref, old.id::text), v_claims
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_procurement_service_write(old.organization_id,
        format('Warranty term %s', coalesce(old.warranty_ref, old.id::text)), tg_op,
        'A warranty term with no claims was deleted outside the definer RPCs.');
    end if;
    return old;
  end if;

  if new.ends_on is not null and new.ends_on < new.starts_on then
    raise exception
      'a warranty that ends before it starts covers nothing and would answer every cover question false'
      using errcode = 'check_violation';
  end if;
  -- 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so the float idiom
  -- `x <> x` catches nothing here — and NaN is not less than or equal to zero
  -- either, so `<= 0` alone lets it straight through and every cover
  -- comparison against it answers false vacuously.
  if new.usage_limit is not null
     and (new.usage_limit = 'NaN'::numeric
          or new.usage_limit = 'Infinity'::numeric
          or new.usage_limit = '-Infinity'::numeric
          or new.usage_limit <= 0) then
    raise exception
      'a usage limit must be a finite quantity greater than zero'
      using errcode = 'check_violation';
  end if;
  if new.claim_window_days is not null and new.claim_window_days < 0 then
    raise exception 'a claim window cannot be negative' using errcode = 'check_violation';
  end if;
  if new.package_id is not null and not exists (
       select 1 from contract_packages p
        where p.id = new.package_id and p.organization_id = new.organization_id) then
    raise exception
      'this warranty term is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A warranty term is recorded through record_warranty_term, which requires a stated expiry, a role and an audit row. A direct write can create a warranty that never expires, which is the one shape this family exists to refuse.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Warranty term %s', coalesce(new.warranty_ref, new.id::text)), tg_op,
      'A warranty term written outside the RPCs can state no expiry at all.');
  end if;

  -- FROZEN ONCE CLAIMED AGAINST. Moving the end date of a warranty a claim has
  -- already been admitted under changes, retrospectively, what that claim was
  -- admitted on.
  if tg_op = 'UPDATE' then
    select count(*) into v_claims from warranty_claims where warranty_id = old.id;
    if coalesce(v_claims, 0) > 0
       and (new.starts_on is distinct from old.starts_on
            or new.ends_on is distinct from old.ends_on
            or new.usage_limit is distinct from old.usage_limit
            or new.usage_unit is distinct from old.usage_unit
            or new.claim_window_days is distinct from old.claim_window_days
            or new.asset_id is distinct from old.asset_id
            or new.material_id is distinct from old.material_id
            or new.supplier_id is distinct from old.supplier_id) then
      raise exception
        'Warranty term % has % claim(s) admitted against it. Its dates, its usage limit, its claim window and what it attaches to are FROZEN: moving them changes, after the fact, what those claims were admitted on. Record a further term.',
        coalesce(old.warranty_ref, old.id::text), v_claims
        using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

revoke all on function public.enforce_warranty_term_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_warranty_term_integrity on public.warranty_terms;
create trigger trg_warranty_term_integrity
  before insert or update or delete on public.warranty_terms
  for each row execute function public.enforce_warranty_term_integrity();

drop trigger if exists trg_warranty_term_no_truncate on public.warranty_terms;
create trigger trg_warranty_term_no_truncate
  before truncate on public.warranty_terms
  for each statement execute function public.enforce_warranty_term_integrity();

revoke truncate on table public.warranty_terms from anon, authenticated, service_role;

create or replace function public.enforce_warranty_claim_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.warranty_claim_write', true), '');
  v_client boolean := auth.uid() is not null;
  w warranty_terms%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'warranty_claims is the record of what was recovered from a supplier and what was refused — the money most sites leave on the table, and the most expensive line of a vendor''s quality history. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE: the organization or the warranty TERM is already gone. The
    -- term's own wall has already refused, or recorded, whatever took it.
    if not exists (select 1 from organizations where id = old.organization_id)
       or (old.warranty_id is not null
           and not exists (select 1 from warranty_terms where id = old.warranty_id)) then
      return old;
    end if;
    raise exception
      'Warranty claim % is %. A claim is WITHDRAWN with a stated reason, never deleted: an answered one is the record of what the supplier agreed or refused, and it is what the next procurement is supposed to read.',
      coalesce(old.claim_ref, old.id::text), old.status
      using errcode = 'insufficient_privilege';
  end if;

  if new.warranty_id is not null then
    select * into w from warranty_terms where id = new.warranty_id;
    if not found or w.organization_id <> new.organization_id then
      raise exception
        'this warranty claim is stamped with an organization that does not own its warranty term'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'accepted' and new.recovered_value is null then
    raise exception
      'an ACCEPTED warranty claim states what was recovered — an acceptance with no figure is a recovery nobody can reconcile and a vendor history that reports nothing'
      using errcode = 'check_violation';
  end if;
  if new.claim_value is not null and new.recovered_value is not null
     and new.recovered_value > new.claim_value then
    raise exception
      'a warranty claim cannot recover more than was claimed'
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A warranty claim is raised through raise_warranty_claim, submitted through submit_warranty_claim and answered through answer_warranty_claim — the answer is a §70 human act and it freezes the claim. A direct write admits a claim against cover nobody checked.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Warranty claim %s', coalesce(new.claim_ref, new.id::text)), tg_op,
      'A warranty claim written outside the RPCs is admitted with no cover check and can be born accepted.');
  end if;

  if tg_op = 'INSERT' and new.status <> 'raised' then
    raise exception
      'A warranty claim is RAISED and answered afterwards. One that arrives already accepted records a settlement nobody agreed.'
      using errcode = 'check_violation';
  end if;

  -- FROZEN ONCE ANSWERED, for every writer.
  if tg_op = 'UPDATE' and old.answered_at is not null then
    if new.claim_value is distinct from old.claim_value
       or new.recovered_value is distinct from old.recovered_value
       or new.status is distinct from old.status
       or new.warranty_id is distinct from old.warranty_id
       or new.failure_on is distinct from old.failure_on
       or new.cover_basis is distinct from old.cover_basis
       or new.answered_by is distinct from old.answered_by
       or new.answered_at is distinct from old.answered_at
       or new.answer_note is distinct from old.answer_note
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception
        'Warranty claim % was answered on % (%). It is FROZEN for every caller: what was claimed, what was recovered and the answer itself. A claim that can be re-valued after the supplier answered it makes the vendor history a number somebody chose.',
        coalesce(old.claim_ref, old.id::text), old.answered_at, old.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_warranty_claim_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_warranty_claim_integrity on public.warranty_claims;
create trigger trg_warranty_claim_integrity
  before insert or update or delete on public.warranty_claims
  for each row execute function public.enforce_warranty_claim_integrity();

drop trigger if exists trg_warranty_claim_no_truncate on public.warranty_claims;
create trigger trg_warranty_claim_no_truncate
  before truncate on public.warranty_claims
  for each statement execute function public.enforce_warranty_claim_integrity();

revoke truncate on table public.warranty_claims from anon, authenticated, service_role;

drop trigger if exists trg_warranty_claim_answerer_is_human on public.warranty_claims;
create trigger trg_warranty_claim_answerer_is_human
  before insert or update on public.warranty_claims
  for each row execute function public.enforce_procurement_act_is_human(
    'answered_by', 'accept or refuse a warranty settlement');

-- ---------------------------------------------------------------------------
-- 4. THE WRITE PATHS.
-- ---------------------------------------------------------------------------
create or replace function public.record_warranty_term(p_term jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_ref text := nullif(btrim(coalesce(p_term->>'warranty_ref','')), '');
  v_covers text := nullif(btrim(coalesce(p_term->>'covers','')), '');
  v_basis text := nullif(btrim(coalesce(p_term->>'basis','')), '');
  v_starts date := sync_text_as_date(p_term->>'starts_on');
  v_ends date := sync_text_as_date(p_term->>'ends_on');
  v_limit numeric := sync_finite_money(p_term->>'usage_limit');
  v_unit text := nullif(btrim(coalesce(p_term->>'usage_unit','')), '');
  v_window int := sync_text_as_int(p_term->>'claim_window_days');
  v_asset uuid := sync_text_as_uuid(p_term->>'asset_id');
  v_material uuid := sync_text_as_uuid(p_term->>'material_id');
  v_package bigint := sync_text_as_bigint(p_term->>'package_id');
  v_supplier bigint := sync_text_as_bigint(p_term->>'supplier_id');
  p contract_packages%rowtype;
  v_existing warranty_terms%rowtype;
  v_revising boolean;
  v_claims int;
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
      'recording a warranty term requires a planning, engineering or governance role');
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the warranty term needs a warranty_ref');
  end if;
  if v_covers is null or length(v_covers) < 20 then
    return jsonb_build_object('error',
      'state what the warranty covers (covers, 20 characters minimum) — the remedy somebody will try to claim, in the words of the contract');
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state where these terms come from (basis, 10 characters minimum) — the clause, the purchase order or the vendor document');
  end if;
  if v_starts is null then
    return jsonb_build_object('error',
      'state when cover starts (starts_on)');
  end if;

  -- THE REFUSAL THIS FAMILY EXISTS FOR: A WARRANTY MUST EXPIRE.
  if v_ends is null and v_limit is null then
    return jsonb_build_object('error',
      'state when this warranty ends — a date (ends_on), a usage limit (usage_limit and usage_unit), or both. A warranty term with no stated expiry is refused: it does not cover forever, it is a term whose end nobody recorded, and the product would then answer "covered" to a claim presented years after the remedy lapsed. Every cover question against such a term REFUSES, so recording one would create a warranty that can never be used either.');
  end if;
  if v_ends is not null and v_ends < v_starts then
    return jsonb_build_object('error', 'the warranty ends before it starts');
  end if;
  if nullif(btrim(coalesce(p_term->>'usage_limit','')), '') is not null
     and v_limit is null then
    return jsonb_build_object('error', format(
      'the usage limit is %s; it must be a finite quantity. NaN and infinity are legal numeric values in Postgres and would be silently dropped here, leaving a term that states a usage limit nobody can compare against.',
      p_term->>'usage_limit'));
  end if;
  if v_limit is not null and v_limit <= 0 then
    return jsonb_build_object('error',
      'the usage limit must be a finite quantity greater than zero');
  end if;
  if v_limit is not null and v_unit is null then
    return jsonb_build_object('error',
      'a usage limit needs its unit (usage_unit) — "12000" is not a warranty, "12000 operating hours" is');
  end if;
  if v_window is not null and v_window < 0 then
    return jsonb_build_object('error', 'the claim window cannot be negative');
  end if;

  if v_package is not null then
    select * into p from contract_packages where id = v_package and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'that contract does not exist in this organization');
    end if;
    if p.awarded_at is null then
      return jsonb_build_object('error', format(
        'package %s is not awarded, so it carries no warranty terms yet', p.package_code));
    end if;
    v_supplier := coalesce(v_supplier, p.awarded_supplier_id);
  end if;
  if v_supplier is not null and not exists (
       select 1 from suppliers s where s.id = v_supplier and s.organization_id = v_org) then
    return jsonb_build_object('error', 'that supplier does not exist in this organization');
  end if;
  if v_asset is not null and not exists (
       select 1 from assets a where a.id = v_asset and a.organization_id = v_org) then
    return jsonb_build_object('error', 'that asset does not exist in this organization');
  end if;
  if v_material is not null and not exists (
       select 1 from materials m where m.id = v_material and m.organization_id = v_org) then
    return jsonb_build_object('error', 'that material does not exist in this organization');
  end if;
  -- The existing table CHECK says a warranty attaches to something; refused
  -- here as a sentence rather than as a constraint name.
  if v_asset is null and v_material is null then
    return jsonb_build_object('error',
      'a warranty attaches to an asset (asset_id) or to a material (material_id). A warranty against nothing cannot be found when the thing it covers fails, which is the only moment anybody looks for it.');
  end if;

  select * into v_existing from warranty_terms
   where organization_id = v_org and warranty_ref = v_ref;
  v_revising := found;
  if v_revising then
    select count(*) into v_claims from warranty_claims where warranty_id = v_existing.id;
    if coalesce(v_claims, 0) > 0 then
      return jsonb_build_object('error', format(
        'warranty term %s has %s claim(s) admitted against it and its terms are frozen. Changing the dates now would change, after the fact, what those claims were admitted on. Record a further term.',
        v_ref, v_claims));
    end if;
    v_prev := jsonb_build_object('starts_on', v_existing.starts_on,
      'ends_on', v_existing.ends_on, 'usage_limit', v_existing.usage_limit,
      'claim_window_days', v_existing.claim_window_days);
    -- OMITTED IS NOT CLEARED, on the links. `record_cost_item`'s own trap
    -- (20261208090200:862) is the same one: a revise payload that leaves a
    -- link out would silently detach this term from the contract it came out
    -- of — and with it the cascade a development-case teardown reaches it by.
    -- The EXPIRY fields are deliberately not coalesced: a revision that omits
    -- them is refused above, because a warranty must expire.
    perform set_config('app.warranty_term_write', 'granted', true);
    update warranty_terms
       set asset_id = coalesce(v_asset, v_existing.asset_id),
           material_id = coalesce(v_material, v_existing.material_id),
           supplier_id = coalesce(v_supplier, v_existing.supplier_id),
           package_id = coalesce(v_package, v_existing.package_id),
           starts_on = v_starts, ends_on = v_ends,
           usage_limit = v_limit, usage_unit = v_unit, covers = v_covers,
           exclusions = nullif(btrim(coalesce(p_term->>'exclusions','')), ''),
           claim_window_days = v_window, basis = v_basis
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.warranty_term_write', 'granted', true);
    insert into warranty_terms
      (organization_id, warranty_ref, asset_id, material_id, supplier_id, package_id,
       starts_on, ends_on, usage_limit, usage_unit, covers, exclusions,
       claim_window_days, basis, recorded_by)
    values (v_org, v_ref, v_asset, v_material, v_supplier, v_package,
            v_starts, v_ends, v_limit, v_unit, v_covers,
            nullif(btrim(coalesce(p_term->>'exclusions','')), ''),
            v_window, v_basis, auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.warranty_term_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'warranty_term', coalesce(v_role, 'unknown'),
    jsonb_build_object('warranty_id', v_id, 'warranty_ref', v_ref,
      'package_id', v_package,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('warranty_ref', v_ref, 'starts_on', v_starts,
      'ends_on', v_ends, 'usage_limit', v_limit, 'usage_unit', v_unit,
      'claim_window_days', v_window, 'covers', v_covers, 'basis', v_basis));

  return jsonb_build_object('warranty_id', v_id, 'warranty_ref', v_ref,
    'startsOn', v_starts, 'endsOn', v_ends,
    'usageLimit', v_limit, 'usageUnit', v_unit,
    'claimWindowDays', v_window, 'revised', v_revising,
    'coverToday', warranty_cover_position(v_id, current_date, null),
    'note', case when v_window is null then
      'No claim window is recorded. A failure inside cover can then be claimed at any time afterwards, and nothing here will report a claim as time-barred.' end);
end
$$;

revoke all on function public.record_warranty_term(jsonb) from public, anon;
grant execute on function public.record_warranty_term(jsonb) to authenticated, service_role;

comment on function public.record_warranty_term(jsonb) is
  'D6.06 / spec I.16 Warranty × §24: records or revises a vendor warranty term against an asset or a material, optionally naming the contract it came from. REFUSES a term with no stated expiry — neither an end date nor a usage limit — because a warranty that never stops covering is the failure mode, and refuses to revise a term that claims have already been admitted under.';

create or replace function public.raise_warranty_claim(
  p_warranty_id bigint,
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
  w warranty_terms%rowtype;
  v_ref text := nullif(btrim(coalesce(p_claim->>'claim_ref','')), '');
  v_failure date := sync_text_as_date(p_claim->>'failure_on');
  v_usage numeric := sync_finite_money(p_claim->>'usage_at_failure');
  v_raw text := nullif(btrim(coalesce(p_claim->>'claim_value','')), '');
  v_value numeric := sync_finite_money(p_claim->>'claim_value');
  v_currency text := upper(nullif(btrim(coalesce(p_claim->>'currency','')), ''));
  v_wo uuid := sync_text_as_uuid(p_claim->>'work_order_id');
  v_cover jsonb;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner','technician') then
    return jsonb_build_object('error',
      'raising a warranty claim requires a maintenance, planning, engineering or governance role');
  end if;
  select * into w from warranty_terms where id = p_warranty_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'warranty term not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the claim needs a claim_ref');
  end if;
  if v_failure is null then
    return jsonb_build_object('error',
      'state the date the failure occurred (failure_on). Cover is tested at the failure date, not at the date somebody got round to claiming.');
  end if;
  if v_failure > current_date then
    return jsonb_build_object('error', 'a failure cannot be dated in the future');
  end if;
  if v_raw is null then
    return jsonb_build_object('error',
      'state what is being claimed (claim_value). A claim with no figure recovers nothing and reports nothing in the vendor history.');
  end if;
  if v_value is null or v_value < 0 then
    return jsonb_build_object('error', format(
      'the claim value is %s; it must be a finite amount of at least zero.', v_raw));
  end if;
  -- A CLAIM VALUE WITH NO CURRENCY IS NOT MONEY, AND IT DOES NOT STAY
  -- HARMLESS. claim_value is required two checks above; the currency was
  -- validated only IF SUPPLIED, and the vendor-quality accrual counts
  -- currencies with count(distinct currency), which IGNORES NULLs — so a
  -- claim with no currency was silently added to the CAD claims and the total
  -- was labelled CAD, in the record that decides the next award. Required
  -- here; the accrual counts a missing currency as its own bucket as well,
  -- because warranty_claims is a grown table and rows predating this door
  -- exist.
  if v_currency is null then
    return jsonb_build_object('error',
      'state the currency of the claim (currency, a three-letter code). A claim value with no unit is not money, and a supplier''s recovery history is what the next award is decided on.');
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('error', 'the currency must be a three-letter code');
  end if;
  if v_wo is not null and not exists (
       select 1 from work_orders o where o.id = v_wo and o.organization_id = v_org) then
    return jsonb_build_object('error', 'that work order does not exist in this organization');
  end if;
  if exists (select 1 from warranty_claims
              where organization_id = v_org and claim_ref = v_ref) then
    return jsonb_build_object('error', format(
      'warranty claim %s already exists in this organization', v_ref));
  end if;

  -- THE ONE COVER PREDICATE. Its refusal is the door's refusal; its "not
  -- covered" is the door's refusal too, in the predicate's own words.
  v_cover := warranty_cover_position(w.id, v_failure, v_usage);
  if (v_cover->>'answered')::boolean is not true then
    return jsonb_build_object('error', v_cover->>'refusal', 'cover', v_cover);
  end if;
  if (v_cover->>'covered')::boolean is not true then
    return jsonb_build_object('error', format(
      '%s A claim is not raised against cover that was not in force — recording it would put a recovery into the vendor history that nothing obliges the supplier to pay.',
      v_cover->>'reason'), 'cover', v_cover);
  end if;

  -- THE CLAIM WINDOW, at the moment of raising. A failure inside cover whose
  -- window has already closed is time-barred before it starts.
  if w.claim_window_days is not null
     and (current_date - v_failure) > w.claim_window_days then
    return jsonb_build_object('error', format(
      'Warranty term %s allows %s day(s) to lodge a claim after a failure. This failure is dated %s, which was %s day(s) ago, so the window closed %s day(s) ago and the claim is TIME-BARRED. The cover was real; the entitlement to claim under it has lapsed.',
      coalesce(w.warranty_ref, w.id::text), w.claim_window_days, v_failure,
      current_date - v_failure,
      (current_date - v_failure) - w.claim_window_days),
      'cover', v_cover, 'timeBarred', true);
  end if;

  perform set_config('app.warranty_claim_write', 'granted', true);
  insert into warranty_claims
    (organization_id, warranty_id, work_order_id, asset_id, claim_ref, failure_on,
     usage_at_failure, raised_on, claim_value, currency, cover_basis, raised_by, status)
  values (v_org, w.id, v_wo, w.asset_id, v_ref, v_failure, v_usage, current_date,
          v_value, v_currency, v_cover->>'reason', auth.uid(), 'raised')
  returning id into v_id;
  perform set_config('app.warranty_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'warranty_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('warranty_id', w.id, 'warranty_ref', w.warranty_ref,
      'claim_id', v_id, 'claim_ref', v_ref, 'action', 'raised'),
    null,
    jsonb_build_object('claim_ref', v_ref, 'failure_on', v_failure,
      'claim_value', v_value, 'currency', v_currency,
      'cover_basis', v_cover->>'reason', 'raised_by', auth.uid()));

  return jsonb_build_object('claim_id', v_id, 'claim_ref', v_ref,
    'warrantyId', w.id, 'warrantyRef', w.warranty_ref,
    'failureOn', v_failure, 'claimValue', v_value, 'currency', v_currency,
    'status', 'raised', 'cover', v_cover,
    'claimWindowDays', w.claim_window_days,
    'note', case when w.claim_window_days is not null then format(
      'The claim window closes %s day(s) after the failure — %s. Submitting after that records the claim as TIME-BARRED rather than submitting it.',
      w.claim_window_days, v_failure + w.claim_window_days) end);
end
$$;

revoke all on function public.raise_warranty_claim(bigint, jsonb) from public, anon;
grant execute on function public.raise_warranty_claim(bigint, jsonb) to authenticated, service_role;

comment on function public.raise_warranty_claim(bigint, jsonb) is
  'D6.06 / spec I.16 Warranty: raises a claim against a warranty term. Reads the ONE cover predicate at the FAILURE date and refuses in its words when cover was not in force — an expired warranty stops covering, provably — refuses a claim already time-barred by the term''s own claim window, refuses a non-finite or negative amount, and records the cover answer it was admitted on so a later revision of the term cannot rewrite it.';

create or replace function public.submit_warranty_claim(
  p_claim_id bigint,
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
  c warranty_claims%rowtype;
  w warranty_terms%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_late int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'submitting a warranty claim requires a planning, engineering or governance role');
  end if;
  if v_note is null or length(v_note) < 10 then
    return jsonb_build_object('error',
      'state what is being submitted and to whom (note, 10 characters minimum)');
  end if;
  select * into c from warranty_claims
   where id = p_claim_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'warranty claim not found');
  end if;
  if c.status <> 'raised' then
    return jsonb_build_object('error', format(
      'warranty claim %s is %s. Only a raised claim is submitted.',
      coalesce(c.claim_ref, c.id::text), c.status));
  end if;
  select * into w from warranty_terms where id = c.warranty_id;

  -- THE WINDOW CLOSED WHILE THE CLAIM SAT. Recorded as what it is rather than
  -- submitted: `time_barred` is a real commercial state, and it is the most
  -- expensive line in a vendor's quality history precisely because nobody
  -- writes it down.
  if w.id is not null and w.claim_window_days is not null and c.failure_on is not null then
    v_late := (current_date - c.failure_on) - w.claim_window_days;
    if v_late > 0 then
      perform set_config('app.warranty_claim_write', 'granted', true);
      update warranty_claims
         set status = 'time_barred',
             rejection_reason = format(
               'The claim window on warranty term %s is %s day(s) from the failure on %s, so it closed on %s. This claim was submitted %s day(s) after that. The cover was real and the entitlement to claim under it has lapsed.',
               coalesce(w.warranty_ref, w.id::text), w.claim_window_days,
               c.failure_on, c.failure_on + w.claim_window_days, v_late)
       where id = c.id;
      perform set_config('app.warranty_claim_write', '', true);
      insert into audit_events (organization_id, entity_type, actor, event_data,
        previous_state, new_state)
      values (v_org, 'warranty_claim', coalesce(v_role, 'unknown'),
        jsonb_build_object('warranty_id', c.warranty_id, 'claim_id', c.id,
          'claim_ref', c.claim_ref, 'action', 'time_barred'),
        jsonb_build_object('status', 'raised'),
        jsonb_build_object('status', 'time_barred', 'days_late', v_late));
      return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
        'status', 'time_barred', 'daysLate', v_late,
        'windowClosedOn', c.failure_on + w.claim_window_days,
        'note', 'Recorded TIME-BARRED, not submitted. Sending it anyway would put a claim in front of a supplier that the contract no longer entitles anybody to make, and reporting it as submitted would leave a recovery in the forecast that will never arrive.');
    end if;
  end if;

  perform set_config('app.warranty_claim_write', 'granted', true);
  update warranty_claims
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
   where id = c.id;
  perform set_config('app.warranty_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'warranty_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('warranty_id', c.warranty_id, 'claim_id', c.id,
      'claim_ref', c.claim_ref, 'action', 'submitted'),
    jsonb_build_object('status', 'raised'),
    jsonb_build_object('status', 'submitted', 'submitted_by', auth.uid(),
      'note', v_note));

  return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
    'status', 'submitted', 'claimValue', c.claim_value, 'currency', c.currency,
    'windowClosesOn', case when w.claim_window_days is not null and c.failure_on is not null
      then c.failure_on + w.claim_window_days end);
end
$$;

revoke all on function public.submit_warranty_claim(bigint, text) from public, anon;
grant execute on function public.submit_warranty_claim(bigint, text) to authenticated, service_role;

comment on function public.submit_warranty_claim(bigint, text) is
  'D6.06: submits a raised warranty claim to the supplier — unless the term''s claim window has closed since the claim was raised, in which case it is recorded TIME_BARRED with the arithmetic stated. That is the one writer of that status, and it exists because a lapsed entitlement reported as submitted leaves a recovery in the forecast that will never arrive.';

create or replace function public.answer_warranty_claim(
  p_claim_id bigint,
  p_outcome text,
  p_note text,
  p_recovered_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c warranty_claims%rowtype;
  w warranty_terms%rowtype;
  v_outcome text := lower(nullif(btrim(coalesce(p_outcome, '')), ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_recovered numeric := sync_finite_money(p_recovered_value);
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'accepting a warranty settlement is a §70 human act: it closes an entitlement against a supplier for an agreed sum, and once closed the difference is the owner''s. The AI may assemble the failure evidence, test the cover and draft the position; a named person accepts or refuses the settlement.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'answering a warranty claim requires a management or executive role');
  end if;
  if v_outcome not in ('accepted','rejected') then
    return jsonb_build_object('error',
      'the outcome must be accepted or rejected. A claim nobody is pressing is WITHDRAWN by the claimant (withdraw_warranty_claim), and one whose window closed is TIME_BARRED by submit_warranty_claim — three different facts, kept apart.');
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'state the settlement or the refusal (note, 20 characters minimum) — what the supplier agreed, or the grounds on which they refused');
  end if;

  select * into c from warranty_claims
   where id = p_claim_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'warranty claim not found');
  end if;
  if c.answered_at is not null then
    return jsonb_build_object('error', format(
      'warranty claim %s was answered on %s (%s). A claim is answered once; re-answering it would replace the settlement the supplier agreed.',
      coalesce(c.claim_ref, c.id::text), c.answered_at, c.status));
  end if;
  if c.status not in ('raised','submitted') then
    return jsonb_build_object('error', format(
      'warranty claim %s is %s, so there is nothing outstanding to answer.',
      coalesce(c.claim_ref, c.id::text), c.status));
  end if;
  if c.raised_by is not null and c.raised_by = auth.uid() then
    return jsonb_build_object('error', format(
      'you raised warranty claim %s. Accepting a settlement on your own claim is one person creating and closing a recovery — route it to somebody who did not raise it.',
      coalesce(c.claim_ref, c.id::text)));
  end if;
  select * into w from warranty_terms where id = c.warranty_id;

  if v_outcome = 'accepted' then
    if nullif(btrim(coalesce(p_recovered_value, '')), '') is null then
      return jsonb_build_object('error',
        'an accepted warranty claim states what was recovered (recovered_value). An acceptance with no figure reports nothing in the vendor history and nothing in the cost model.');
    end if;
    if v_recovered is null or v_recovered < 0 then
      return jsonb_build_object('error', format(
        'the recovered amount is %s; it must be a finite amount of at least zero.', p_recovered_value));
    end if;
    if c.claim_value is not null and v_recovered > c.claim_value then
      return jsonb_build_object('error', format(
        'claim %s is for %s and this settlement recovers %s. A warranty claim cannot recover more than was claimed.',
        coalesce(c.claim_ref, c.id::text), c.claim_value, v_recovered));
    end if;
  else
    v_recovered := null;
  end if;

  v_prev := jsonb_build_object('status', c.status, 'answered_at', c.answered_at);
  perform set_config('app.warranty_claim_write', 'granted', true);
  update warranty_claims
     set status = v_outcome, recovered_value = v_recovered,
         answered_by = auth.uid(), answered_at = now(), answer_note = v_note,
         rejection_reason = case when v_outcome = 'rejected' then v_note else rejection_reason end
   where id = c.id;
  perform set_config('app.warranty_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'warranty_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('warranty_id', c.warranty_id,
      'warranty_ref', w.warranty_ref, 'claim_id', c.id, 'claim_ref', c.claim_ref,
      'action', 'answered'),
    v_prev,
    jsonb_build_object('status', v_outcome, 'recovered_value', v_recovered,
      'claim_value', c.claim_value, 'currency', c.currency,
      'answered_by', auth.uid(), 'note', v_note));

  return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
    'status', v_outcome, 'claimValue', c.claim_value,
    'recoveredValue', v_recovered, 'currency', c.currency,
    'shortfall', case when v_outcome = 'accepted' and c.claim_value is not null
      then c.claim_value - coalesce(v_recovered, 0) end,
    'frozen', true,
    'note', 'Answered and frozen. It now counts in this supplier''s quality history (get_vendor_quality_record), which accrues from acts like this one rather than being typed.');
end
$$;

revoke all on function public.answer_warranty_claim(bigint, text, text, text)
  from public, anon, service_role;
grant execute on function public.answer_warranty_claim(bigint, text, text, text) to authenticated;

comment on function public.answer_warranty_claim(bigint, text, text, text) is
  'D6.06 / spec I.16 Warranty × §70: accepts or refuses a warranty settlement ONCE and freezes the claim. Refused for the AI-operator identity by name, refused for the person who raised the claim, refused a second time, refused for an acceptance with no recovered figure, and refused when the recovery exceeds the claim.';

create or replace function public.withdraw_warranty_claim(
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
  c warranty_claims%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'withdrawing a warranty claim requires a planning, engineering or governance role');
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why the claim is withdrawn (reason, 20 characters minimum)');
  end if;
  select * into c from warranty_claims
   where id = p_claim_id and organization_id = v_org for update;
  if not found then
    return jsonb_build_object('error', 'warranty claim not found');
  end if;
  if c.answered_at is not null or c.status not in ('raised','submitted') then
    return jsonb_build_object('error', format(
      'warranty claim %s is %s. Only a raised or submitted claim is withdrawn — an answered one is the record of what the supplier agreed or refused.',
      coalesce(c.claim_ref, c.id::text), c.status));
  end if;

  perform set_config('app.warranty_claim_write', 'granted', true);
  update warranty_claims
     set status = 'withdrawn', answered_by = auth.uid(), answered_at = now(),
         answer_note = v_reason
   where id = c.id;
  perform set_config('app.warranty_claim_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'warranty_claim', coalesce(v_role, 'unknown'),
    jsonb_build_object('warranty_id', c.warranty_id, 'claim_id', c.id,
      'claim_ref', c.claim_ref, 'action', 'withdrawn'),
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', 'withdrawn', 'reason', v_reason,
      'withdrawn_by', auth.uid()));

  return jsonb_build_object('claim_id', c.id, 'claim_ref', c.claim_ref,
    'status', 'withdrawn', 'frozen', true,
    'note', 'Withdrawn and frozen, not deleted.');
end
$$;

revoke all on function public.withdraw_warranty_claim(bigint, text)
  from public, anon, service_role;
grant execute on function public.withdraw_warranty_claim(bigint, text) to authenticated;

comment on function public.withdraw_warranty_claim(bigint, text) is
  'D6.06: withdraws a raised or submitted warranty claim with a stated reason, and freezes it. An answered claim is refused.';

notify pgrst, 'reload schema';
