-- ============================================================================
-- Sync Develop — Slice 6A, part 1 of 3.
-- D6.03 (ProcurementPackage, spec I.16) and D6.09 (spec III.§25 — the four
-- status dimensions and gate blocking).
--
-- WHAT WAS ALREADY THERE, AND WHY THIS IS AN EXTENSION.
-- `contract_packages` (20260817140000:257) already carries the scope side of
-- a procurement package — scope_of_work, exclusions, interfaces,
-- acceptance_criteria, site_conditions_stated — and an award linkage
-- (awarded_supplier_id, awarded_value). Register row D6.03 names exactly what
-- is missing: the four §25 status dimensions, `required_date`, a write path,
-- and late/at-risk surfacing. Row E7.02 says the same thing from the other
-- register: schema with no write path, demo-seed only.
--
-- So this file GROWS that table. It does not create a `procurement_packages`
-- table beside it — the overlap map's ruling 13 is that contract_packages is
-- the home for both the ProcurementPackage and (part 3) the Contract, and a
-- second package store would be the parallel track AGENTS.md invariant 1
-- forbids.
--
-- WHAT §25 ASKS FOR, FIELD BY FIELD:
--   id                    → contract_packages.id                (already)
--   project_id            → capital_project_id + development_case_id (new)
--   equipment_or_scope    → equipment_or_scope                  (new)
--   required_date         → required_date                       (new)
--   supplier_id           → awarded_supplier_id                 (already)
--   technical_status      → technical_status                    (new)
--   commercial_status     → commercial_status                   (new)
--   manufacturing_status  → manufacturing_status                (new)
--   delivery_status       → delivery_status                     (new)
--
-- THE GATE BLOCKING (D6.09), AND THE ONE RULE IT USES.
-- Register row D6.09: "adds mandatory long-lead slippage as a gate blocker
-- once case gates exist." Case gates exist (Slice 1/3C), and so does ONE
-- gate-blocker predicate — `case_gate_outstanding_obligations`
-- (20261122090300) — which the readiness screen renders, the gate-review RPC
-- refuses over and `enforce_gate_review_outstanding_obligations` backstops for
-- every writer. Slices 5B and 5D each appended a family to it rather than
-- writing a second evaluator. This one does the same, by the same
-- transformation idiom, and RAISES if the anchor has moved.
--
-- THE BLOCKING RULE IS DECLARED, NOT INFERRED. A package blocks a gate when
-- it is MANDATORY for the case (`is_mandatory`, stated by a human with a
-- basis — §25's mandatory long-lead item) and either:
--
--   procurement_package_unawarded  it holds no awarded contract and the date
--                                  by which the award had to happen for the
--                                  equipment to arrive on time
--                                  (required_date − lead_time_days) has
--                                  passed;
--   procurement_package_late       it is awarded and its FORECAST delivery is
--                                  after the date the project needs it.
--
-- Both legs are arithmetic over dates a person recorded. Neither infers
-- critical-path membership: Sync imports P6's own float (20261202090000) and
-- does not recompute a network, so a second critical path derived here would
-- be the two-answers failure. Where a package is linked to a WBS element the
-- read REPORTS that element's imported float beside the package — evidence,
-- not a second computation — and where the schedule carries no float it says
-- so instead of treating "no float" as "not critical".
--
-- REFUSAL-FIRST, everywhere a number could be invented:
--   * a case with no packages REFUSES rather than reporting "0 packages late",
--     which reads as a clean bill;
--   * a mandatory package missing `required_date` or `lead_time_days` is
--     reported as NOT ASSESSABLE by name and blocks nothing — an alarm wired
--     to an absent date is worse than no alarm;
--   * every money and day figure goes through the finite/non-negative doors
--     ('NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so `>= 0` alone
--     does not keep NaN out).
--
-- Canonical reuse: contract_packages, suppliers, development_cases,
-- capital_projects, project_wbs_elements, stage_gates,
-- case_gate_outstanding_obligations, enforce_gate_review_outstanding_obligations,
-- audit_events, security_events, sync_finite_money, app_current_org.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE §25 STATUS VOCABULARY, AS DATA.
--
--    Four dimensions, four ordered vocabularies, one immutable function. The
--    CHECK constraints read it, the read RPC reads it, and the TypeScript
--    mirrors it with the slice test pinning the two together — so a fifth
--    value cannot appear on one side only. (The `sync_develop_event_names`
--    idiom, 20261207090000.)
-- ---------------------------------------------------------------------------
create or replace function public.sync_procurement_status_values(p_dimension text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_dimension
    when 'technical' then array[
      'not_started', 'specification_issued', 'technically_evaluated',
      'technically_approved', 'technically_rejected']
    when 'commercial' then array[
      'not_started', 'tendered', 'bids_received', 'commercially_evaluated',
      'awarded', 'cancelled']
    when 'manufacturing' then array[
      'not_applicable', 'not_started', 'released_for_manufacture',
      'in_manufacture', 'manufacturing_complete', 'factory_accepted', 'on_hold']
    when 'delivery' then array[
      'not_started', 'in_transit', 'delivered_to_site',
      'received_and_inspected', 'rejected_on_receipt']
  end::text[];
$$;

revoke all on function public.sync_procurement_status_values(text) from public, anon;
grant execute on function public.sync_procurement_status_values(text)
  to authenticated, service_role;

comment on function public.sync_procurement_status_values(text) is
  'D6.03/D6.09 / spec III.§25: the permitted values of each of the four procurement status dimensions. The CHECK constraints on contract_packages read this function, so the vocabulary lives in one place; PROCUREMENT_STATUS_VALUES in src/lib/develop/procurement.ts mirrors it and the slice test pins the two together.';

create or replace function public.sync_procurement_status_dimensions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['technical', 'commercial', 'manufacturing', 'delivery']::text[];
$$;

revoke all on function public.sync_procurement_status_dimensions() from public, anon;
grant execute on function public.sync_procurement_status_dimensions()
  to authenticated, service_role;

comment on function public.sync_procurement_status_dimensions() is
  'D6.09 / spec III.§25: the four status dimensions of a ProcurementPackage, verbatim. §25 names four and a package that carried three would be reported as complete on a dimension nobody tracked.';

-- ---------------------------------------------------------------------------
-- 2. THE OBJECT GROWS (D6.03). Every column nullable or defaulted: the demo
--    seed (20260817143000) already wrote a package with none of these, and a
--    NOT NULL added over it would fail the migration on every existing
--    database.
--
--    ONE ALTER FOR THE WHOLE SLICE. The tender lifecycle columns (part 2) and
--    the §24 contract columns (part 3) are added HERE rather than in the files
--    that use them, because the guard trigger installed below reads them: a
--    trigger created in this file that references a column added two files
--    later is a trigger that raises `record "old" has no field ...` for every
--    delete in between. PL/pgSQL resolves record fields at run time, so
--    nothing catches that at creation.
-- ---------------------------------------------------------------------------
alter table public.contract_packages
  -- §25's `project_id`, both halves. The capital project is the delivery-side
  -- record; the development case is Sync Develop's subject and what the gate
  -- blocker scopes on. Neither is invented from the other.
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists capital_project_id bigint
    references capital_projects(id) on delete set null,
  -- §25's `equipment_or_scope`. `title` is a label; this is the thing being
  -- bought, in the words the specification uses.
  add column if not exists equipment_or_scope text,
  -- §25's `required_date` — the date the PROJECT needs it, not a promise.
  add column if not exists required_date date,
  -- The long-lead arithmetic. `lead_time_days` is how long the market takes
  -- from award to delivery; required_date − lead_time_days is the date the
  -- award had to happen. Both stated, neither derived.
  add column if not exists lead_time_days integer,
  add column if not exists forecast_delivery_date date,
  -- THE DATED RECEIPT. The slippage blocker's discharge is a FACT ABOUT A
  -- DATE, so it is written by a dated act (record_package_delivery_receipt)
  -- and never read off `delivery_status` — a status anybody can type is not
  -- evidence that anything arrived, and the first draft of this file
  -- discharged the blocker off exactly that.
  add column if not exists actual_delivery_date date,
  -- §25's mandatory long-lead item, and the ONLY thing the gate blocker
  -- treats as critical. Declared by a human WITH A BASIS: a boolean with no
  -- stated reason is a flag people set to silence a screen.
  add column if not exists is_mandatory boolean not null default false,
  add column if not exists mandatory_basis text,
  -- The scope this package delivers, in the case's own WBS. Optional, and
  -- reported as absent rather than assumed.
  add column if not exists wbs_element_id uuid
    references project_wbs_elements(id) on delete set null,
  -- The four §25 dimensions.
  add column if not exists technical_status text not null default 'not_started',
  add column if not exists commercial_status text not null default 'not_started',
  add column if not exists manufacturing_status text not null default 'not_started',
  add column if not exists delivery_status text not null default 'not_started',
  add column if not exists status_updated_at timestamptz,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now(),
  -- ── The sealed-bid lifecycle (D6.04, used by 20261208090100). The package
  --    IS the tender: no separate Tender object is invented, because spec I.16
  --    names ProcurementPackage, Bidder, Bid, TechnicalEvaluation,
  --    CommercialEvaluation and Contract, and not a Tender.
  add column if not exists bids_close_at timestamptz,
  add column if not exists bids_opened_at timestamptz,
  add column if not exists bids_opened_by uuid references auth.users(id),
  -- ── The award record (D6.05/D6.08, written by 20261208090200).
  add column if not exists awarded_at timestamptz,
  add column if not exists awarded_by uuid references auth.users(id),
  add column if not exists awarded_bid_id bigint
    references contract_bids(id) on delete restrict,
  add column if not exists award_basis text,
  add column if not exists award_authority_limit_id uuid
    references authority_limits(id) on delete restrict,
  -- ── The §24 Contract fields the ruling promotes onto this table.
  add column if not exists contract_type text,
  add column if not exists contract_currency text,
  add column if not exists contract_start_date date,
  add column if not exists contract_completion_date date,
  add column if not exists performance_requirements text,
  add column if not exists warranty_term_id bigint
    references warranty_terms(id) on delete set null;

alter table public.contract_packages
  drop constraint if exists contract_package_status_vocabulary;
alter table public.contract_packages
  add constraint contract_package_status_vocabulary check (
    technical_status = any (sync_procurement_status_values('technical'))
    and commercial_status = any (sync_procurement_status_values('commercial'))
    and manufacturing_status = any (sync_procurement_status_values('manufacturing'))
    and delivery_status = any (sync_procurement_status_values('delivery')));

-- MONEY AT THE DOOR. `awarded_value` shipped with no constraint at all, so
-- 'NaN'::numeric and 'Infinity'::numeric were both storable — and NaN passes
-- every `>= 0` test vacuously while turning each downstream sum into NaN.
alter table public.contract_packages
  drop constraint if exists contract_package_awarded_value_sane;
alter table public.contract_packages
  add constraint contract_package_awarded_value_sane check (
    awarded_value is null
    or (awarded_value <> 'NaN'::numeric
        and awarded_value > '-Infinity'::numeric
        and awarded_value < 'Infinity'::numeric
        and awarded_value >= 0));

alter table public.contract_packages
  drop constraint if exists contract_package_lead_time_sane;
alter table public.contract_packages
  add constraint contract_package_lead_time_sane check (
    lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 3650));

-- A MANDATORY PACKAGE STATES WHY. §25's mandatory long-lead item is what the
-- gate blocker fires on; a flag with no basis is one somebody sets to make a
-- banner go away.
alter table public.contract_packages
  drop constraint if exists contract_package_mandatory_basis;
alter table public.contract_packages
  add constraint contract_package_mandatory_basis check (
    is_mandatory = false or length(btrim(coalesce(mandatory_basis, ''))) >= 20);

-- TWO EQUALITIES, NOT ONE (the 5C thread_change_receipts lesson). Folding
-- these into a single equality against a conjunction lets
-- `bids_opened_at = now(), bids_opened_by = null` through — and the actor
-- column is exactly what the §70 wall reads, where a NULL actor is an early
-- return.
alter table public.contract_packages
  drop constraint if exists contract_package_open_actor;
alter table public.contract_packages
  add constraint contract_package_open_actor check (
    (bids_opened_at is null) = (bids_opened_by is null));

alter table public.contract_packages
  drop constraint if exists contract_package_award_actor;
alter table public.contract_packages
  add constraint contract_package_award_actor check (
    (awarded_at is null) = (awarded_by is null));

-- An award names WHO won: a package carrying a value and a date but no
-- supplier is an award against nobody.
alter table public.contract_packages
  drop constraint if exists contract_package_award_supplier;
alter table public.contract_packages
  add constraint contract_package_award_supplier check (
    awarded_at is null or awarded_supplier_id is not null);

-- ...AND WHICH OFFER IT ACCEPTED. award_contract's own refusal says "an award
-- names the offer it accepts, or the contract has no price anybody submitted",
-- and that sentence bound only the RPC: a service-path write could set a
-- value, a supplier and the whole §24 field set while naming no bid, and the
-- award then quotes no submitted price at all.
alter table public.contract_packages
  drop constraint if exists contract_package_award_bid;
alter table public.contract_packages
  add constraint contract_package_award_bid check (
    awarded_at is null or awarded_bid_id is not null);

-- THE RECEIPT AND ITS STATUS ARE ONE FACT. `received_and_inspected` without a
-- recorded arrival date is the status-as-evidence failure this file's own
-- column comment forbids; an arrival date without the status is a receipt
-- nobody finished. Both directions, one equality.
alter table public.contract_packages
  drop constraint if exists contract_package_receipt_pair;
alter table public.contract_packages
  add constraint contract_package_receipt_pair check (
    (actual_delivery_date is not null)
    = (delivery_status = 'received_and_inspected'));

create index if not exists idx_contract_packages_case
  on contract_packages(organization_id, development_case_id)
  where development_case_id is not null;
create index if not exists idx_contract_packages_mandatory
  on contract_packages(organization_id, development_case_id, required_date)
  where is_mandatory;

comment on column public.contract_packages.development_case_id is
  'D6.03 / spec III.§25 `project_id`: the development case this package belongs to. NULLABLE because the table predates Sync Develop and carries demo rows with no case; every §25 read and the gate blocker require it, and a package without one is invisible to both rather than attributed to a case it does not belong to.';
comment on column public.contract_packages.is_mandatory is
  'D6.09 / spec III.§25: the mandatory long-lead item. The ONLY packages case_procurement_gate_obligations blocks a gate over — and it carries mandatory_basis (20 characters minimum, enforced by CHECK) so the flag is a stated judgement rather than a switch.';
comment on column public.contract_packages.lead_time_days is
  'D6.09: award-to-delivery lead time in days. required_date − lead_time_days is the date the award had to happen; a mandatory package missing either date is reported NOT ASSESSABLE by name and blocks nothing, because an alarm wired to an absent date is worse than no alarm.';
comment on column public.contract_packages.technical_status is
  'Spec III.§25, dimension 1 of 4. Vocabulary from sync_procurement_status_values(''technical''), enforced by contract_package_status_vocabulary.';
comment on column public.contract_packages.commercial_status is
  'Spec III.§25, dimension 2 of 4. Moved to `awarded` by award_contract (20261208090200), never by hand: the status and the award record cannot disagree.';
comment on column public.contract_packages.manufacturing_status is
  'Spec III.§25, dimension 3 of 4. Carries not_applicable, because a services package has no manufacturing leg and "not_started" forever reads as a stall.';
comment on column public.contract_packages.delivery_status is
  'Spec III.§25, dimension 4 of 4. Distinct from the date arithmetic: `late` is computed from forecast_delivery_date against required_date, never read off a status somebody could set — and `received_and_inspected` is refused BY NAME in set_procurement_package_status for exactly that reason, because it is the value that would DISCHARGE the slippage blocker. It is reached only through record_package_delivery_receipt, which records the arrival DATE the blocker actually reads.';
comment on column public.contract_packages.actual_delivery_date is
  'D6.09: the date the equipment actually arrived and was inspected, written by record_package_delivery_receipt and paired with delivery_status by contract_package_receipt_pair. THIS — not delivery_status — is what stops the mandatory long-lead slippage blocker. The first draft of this file discharged that blocker on `delivery_status = ''received_and_inspected''`, which one planner could type with a ten-character basis while the recorded dates still said the equipment was 45 days late.';

-- ---------------------------------------------------------------------------
-- 3. THE WALLS. A package is written through the RPCs below or it leaves a
--    trace; it is never truncated; and a status set by hand is refused.
-- ---------------------------------------------------------------------------
create or replace function public.record_procurement_service_write(
  p_org uuid,
  p_object text,
  p_op text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or not exists (select 1 from organizations where id = p_org) then
    return;
  end if;
  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values (p_org, null, 'service (' || current_user || ')',
    'admin_action', 'warning',
    format('%s was %sd by a caller that did not come through a definer RPC (no auth.uid()). %s',
      p_object, lower(p_op), p_detail));
end
$$;

revoke all on function public.record_procurement_service_write(uuid, text, text, text)
  from public, anon, authenticated;

comment on function public.record_procurement_service_write(uuid, text, text, text) is
  'D6.03/D6.04/D6.05 provenance backstop: records the service-path writes the procurement walls ADMIT, so a tender, an evaluation or an award changed outside the RPCs leaves something to find. Never called on a refusing path.';

-- §70, bound to the four acts spec §70 reserves for people. ONE function, used
-- by every actor column in this slice, so no copy can lose its UPDATE branch.
create or replace function public.enforce_procurement_act_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text := tg_argv[0];
  v_act text := tg_argv[1];
  v_actor uuid;
  v_org uuid;
  v_role text;
begin
  -- FAIL LOUD ON A MIS-BINDING (the 5B lesson): `to_jsonb(new)->>'<missing
  -- column>'` is NULL, not an error, so a typo or a later rename would switch
  -- §70 off on this table while the trigger stayed present and apparently
  -- firing.
  if not (to_jsonb(new) ? v_col) then
    raise exception
      'the §70 human-only trigger on % is bound to actor column "%", which that table does not have. Refusing the write rather than admitting it: a wall bound to a column that does not exist admits everything while looking installed.',
      tg_table_name, v_col
      using errcode = 'check_violation';
  end if;
  v_actor := sync_text_as_uuid(to_jsonb(new)->>v_col);
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new)->>v_col) is not distinct from (to_jsonb(old)->>v_col) then
    return new;
  end if;
  -- THE LOOKUP IS SCOPED TO THE ROW'S OWN TENANT AND AN UNKNOWN IDENTITY
  -- RAISES. Both halves matter, and the first draft of this wall had neither:
  --
  --   * unscoped, it accepted an actor belonging to ANOTHER organization as
  --     the person who opened these envelopes, scored this bid or awarded this
  --     contract — and get_package_tender then renders that foreign user's
  --     email as `awardedBy`, so the leak is a read as well as a write;
  --   * `select role into v_role` over a uuid with no user_profiles row
  --     returns NULL, `coalesce(NULL,'') = 'ai_admin'` is FALSE, and the
  --     function returned NEW. A §70 wall whose "identity I have never heard
  --     of" branch is an early return is a wall that any AI or system account
  --     provisioned without a profile walks straight through.
  --
  -- enforce_project_change_governance (20261203090100) already refuses both
  -- shapes by name for the change-approval act; this is the same rule, on the
  -- four acts §70 reserves.
  v_org := sync_text_as_uuid(to_jsonb(new)->>'organization_id');
  select role into v_role from user_profiles
   where id = v_actor and organization_id = v_org;
  if v_role is null then
    raise exception
      'the person recorded to % must be a member of the organization that owns this record. The identity named here has no profile in it, so nothing can say whether it is a person or a machine — and a §70 wall that admits an identity it cannot resolve admits every identity nobody registered.',
      v_act
      using errcode = 'check_violation';
  end if;
  if v_role = 'ai_admin' then
    raise exception
      'The AI-operator identity cannot % (spec §70: no AI or system identity opens a sealed bid, scores a bid, awards a contract or approves a commitment — an award is the owner''s money and a machine-recorded opinion manufactures the judgement these records exist to capture). The AI may prepare the tender documents, normalise the bids and draft the recommendation; a named person does the act.',
      v_act
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_procurement_act_is_human()
  from public, anon, authenticated;

comment on function public.enforce_procurement_act_is_human() is
  'D6.03/D6.04/D6.05 §70 wall: refuses the AI-operator identity in the actor column named by TG_ARGV[0], for EVERY writer, on INSERT and UPDATE. One function, six triggers across the three slice-6A migrations. RAISES when bound to a column the table does not have, so a rename cannot silently uninstall it, and RAISES when the actor has no user_profiles row IN THE ROW''S OWN ORGANIZATION — an unresolvable identity is refused rather than admitted, because a NULL role read as "not ai_admin" is how a machine account with no profile walks through a §70 wall, and an unscoped lookup let another tenant''s user be recorded as the person who opened, scored or awarded.';

create or replace function public.enforce_procurement_package_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.procurement_package_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_case_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_packages holds every procurement package a case''s gates are blocked on and every awarded contract''s §24 record. Truncating it clears all of them in one statement, which no row-level wall can refuse. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: the declared parent is already gone.
    if not exists (select 1 from organizations where id = old.organization_id)
       or (old.development_case_id is not null
           and not exists (select 1 from development_cases where id = old.development_case_id)) then
      return old;
    end if;
    if old.awarded_at is not null then
      raise exception
        'Package % holds an awarded contract. A contract is superseded or closed out, never deleted: deleting it erases the award, its authority record and every commitment posted under it, and the cost lines those commitments moved stay moved.',
        old.package_code
        using errcode = 'insufficient_privilege';
    end if;
    if old.bids_opened_at is not null then
      raise exception
        'Package % has had its bids opened. Deleting it destroys the sealed-bid record — who bid what, and when the envelope was opened — which is the only evidence that the tender was run fairly.',
        old.package_code
        using errcode = 'insufficient_privilege';
    end if;
    -- A TENDER THAT RECEIVED AN OFFER IS NOT DELETED EITHER. Guarding only on
    -- `bids_opened_at` left the window between the first bid arriving and the
    -- envelope being opened: deleting the package there cascaded the bid and
    -- its bidder-register row away, and contract_bids' own DELETE branch
    -- returns OLD mid-cascade because its parent is already gone — so the very
    -- wall whose message is 'a submitted bid is withdrawn, never deleted'
    -- never fired. An inconvenient bid removed with the package around it
    -- looks exactly like a tender nobody responded to.
    if exists (select 1 from contract_bids where package_id = old.id) then
      raise exception
        'Package % has received % bid(s). A tender that received an offer is not deleted: the bid rows go with it through the cascade, and a tender somebody entered becomes indistinguishable from one nobody answered. Withdraw the bids and re-issue, or close the package out.',
        old.package_code,
        (select count(*) from contract_bids where package_id = old.id)
        using errcode = 'insufficient_privilege';
    end if;
    -- THE ADMITTED DELETE STILL LEAVES A TRACE. Every other branch of this
    -- wall records the service-path writes it admits; the DELETE branch did
    -- not, so a package removed outside the RPCs left security_events empty.
    if auth.uid() is null then
      perform record_procurement_service_write(old.organization_id,
        format('Procurement package %s', old.package_code), tg_op,
        'A package deleted outside the definer RPCs takes its bidder register with it through the declared cascade.');
    end if;
    return old;
  end if;

  -- THE TENANT ARM, for every writer including service: a package stamped
  -- with one organization while its case belongs to another is read, blocked
  -- on and awarded by the wrong tenant.
  if new.development_case_id is not null then
    select organization_id into v_case_org
      from development_cases where id = new.development_case_id;
    if v_case_org is null or v_case_org <> new.organization_id then
      raise exception
        'this procurement package is stamped with an organization that does not own its development case'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A DECIDED AWARD IS FROZEN, FOR EVERY CALLER — the 4D-R17 rule, applied to
  -- the contract. This arm closes three separate defects that all live in the
  -- same gap:
  --
  --   1. THE DOUBLE AWARD. award_contract read the package without FOR UPDATE
  --      and re-checked nothing on the UPDATE, so two overlapping transactions
  --      each returned a full success payload and two different suppliers were
  --      each told they had won at their own price. The second write is
  --      refused here regardless of what the door did.
  --   2. THE REWRITE. Everything but the four status columns was writable on
  --      an awarded row by any caller with no auth.uid(): awarded_value 640000
  --      -> 1, award_authority_limit_id -> NULL, while the posted commitments
  --      stayed at 640000 and the award stopped citing the ceiling it passed.
  --   3. THE LAUNDERING LOOP. awarded_at -> NULL re-opened the package for
  --      record_procurement_package and for a SECOND award under a possibly
  --      lower ceiling, with the original commitments still posted. That is
  --      verbatim the failure 20261203090100's 4D-R17 comment names, and its
  --      answer there was to refuse for EVERY caller, service included.
  --
  -- A change to an awarded contract is a change order (spec §21). The delivery
  -- forecast and the four §25 dimensions are deliberately NOT in this list:
  -- the contract's terms are frozen, when the equipment actually arrives is
  -- not.
  if tg_op = 'UPDATE' and old.awarded_at is not null then
    -- THE SUPPLIER DELETE ARRIVES HERE AS A NULLED COLUMN, NOT AS A DELETE.
    -- `awarded_supplier_id` carries ON DELETE SET NULL from before this slice,
    -- so `delete from suppliers where id = <the winner>` reaches this table as
    -- an UPDATE setting that column to NULL — and without this arm the reader
    -- got the generic frozen-award sentence about change orders, which is not
    -- what they did. Named separately so the refusal describes the act.
    if new.awarded_supplier_id is null and old.awarded_supplier_id is not null
       and not exists (select 1 from suppliers where id = old.awarded_supplier_id) then
      raise exception
        'Supplier #% holds the award on package % (% %, awarded %). A supplier that has won a contract is not deleted out from under it: the contract would then name nobody, and every commitment posted under it would explain money paid to a counterparty the system no longer has. Close the contract out or supersede it first.',
        old.awarded_supplier_id, old.package_code,
        coalesce(old.contract_currency, ''),
        coalesce(old.awarded_value::text, 'an unrecorded amount'), old.awarded_at::date
        using errcode = 'insufficient_privilege';
    end if;
    if new.awarded_at is distinct from old.awarded_at
       or new.awarded_by is distinct from old.awarded_by
       or new.awarded_bid_id is distinct from old.awarded_bid_id
       or new.awarded_supplier_id is distinct from old.awarded_supplier_id
       or new.awarded_value is distinct from old.awarded_value
       or new.contract_currency is distinct from old.contract_currency
       or new.contract_type is distinct from old.contract_type
       or new.contract_start_date is distinct from old.contract_start_date
       or new.contract_completion_date is distinct from old.contract_completion_date
       or new.performance_requirements is distinct from old.performance_requirements
       or new.award_basis is distinct from old.award_basis
       or new.award_authority_limit_id is distinct from old.award_authority_limit_id then
      raise exception
        'Package % was awarded on % at % %. The award record — who won, at what price, under which delegated ceiling, and the whole §24 field set — is FROZEN for every caller: an award that can be rewritten afterwards is an award nobody can rely on, and one that can be set back to unawarded can be made a second time under a different ceiling while the commitments posted under the first one still stand. A change to an awarded contract is a change order (spec §21), not an edit.',
        old.package_code, old.awarded_at, coalesce(old.contract_currency, ''),
        coalesce(old.awarded_value::text, 'an unrecorded amount')
        using errcode = 'check_violation';
    end if;
  end if;

  -- ONE DOOR, AND THE §25 DIMENSIONS ARE GOVERNED INSIDE IT.
  --
  -- The CHECK constrains the vocabulary; this constrains the DOOR. A signed-in
  -- caller that reaches this table at all has bypassed RLS (there is no client
  -- write policy), so it is refused rather than recorded — the
  -- enforce_cost_item_coding posture, verbatim. The STATUS message comes first
  -- because a dimension moved by hand is the specific harm: the gate blocker
  -- and the delivery forecast both read those four columns, and
  -- `commercial_status = 'awarded'` set this way is an award nobody made.
  if v_marker <> 'granted' then
    if tg_op = 'UPDATE'
       and (new.technical_status is distinct from old.technical_status
            or new.commercial_status is distinct from old.commercial_status
            or new.manufacturing_status is distinct from old.manufacturing_status
            or new.delivery_status is distinct from old.delivery_status) then
      if v_client then
        raise exception
          'A §25 status dimension is moved through set_procurement_package_status, which requires a role, records the basis and writes the audit row. A direct update moves a dimension the gate blocker and the delivery forecast both read, with none of that behind it.'
          using errcode = 'insufficient_privilege';
      end if;
      perform record_procurement_service_write(new.organization_id,
        format('Procurement package %s status', new.package_code), tg_op,
        'A §25 status dimension moved outside set_procurement_package_status. The four dimensions are what the gate blocker and the delivery forecast read.');
    elsif v_client then
      raise exception
        'A procurement package is written through record_procurement_package, set_procurement_package_status, record_package_delivery_forecast, open_package_bidding, open_package_bids or award_contract. A direct write reaches this table only by bypassing row-level security, and it can create a package that is born mandatory, opened or awarded.'
        using errcode = 'insufficient_privilege';
    else
      perform record_procurement_service_write(new.organization_id,
        format('Procurement package %s', new.package_code), tg_op,
        'A package written outside the definer RPCs carries no recorded author and can be born mandatory, awarded or opened.');
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.enforce_procurement_package_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_procurement_package_integrity on public.contract_packages;
create trigger trg_procurement_package_integrity
  before insert or update or delete on public.contract_packages
  for each row execute function public.enforce_procurement_package_integrity();

drop trigger if exists trg_procurement_package_no_truncate on public.contract_packages;
create trigger trg_procurement_package_no_truncate
  before truncate on public.contract_packages
  for each statement execute function public.enforce_procurement_package_integrity();

revoke truncate on table public.contract_packages from anon, authenticated, service_role;

-- §70 on the two package-level acts spec §70 reserves for people. Bound here,
-- in the file that adds the columns, so a wall and the column it guards can
-- never arrive in different migrations.
drop trigger if exists trg_procurement_opener_is_human on public.contract_packages;
create trigger trg_procurement_opener_is_human
  before insert or update on public.contract_packages
  for each row execute function public.enforce_procurement_act_is_human(
    'bids_opened_by', 'open the sealed bids on a procurement package');

drop trigger if exists trg_procurement_awarder_is_human on public.contract_packages;
create trigger trg_procurement_awarder_is_human
  before insert or update on public.contract_packages
  for each row execute function public.enforce_procurement_act_is_human(
    'awarded_by', 'award a contract');

-- ---------------------------------------------------------------------------
-- 4. THE WRITE PATH (what E7.02 and D6.03 both name as missing).
-- ---------------------------------------------------------------------------
create or replace function public.record_procurement_package(
  p_case_id uuid,
  p_package jsonb
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
  v_code text := nullif(btrim(coalesce(p_package->>'package_code','')), '');
  v_title text := nullif(btrim(coalesce(p_package->>'title','')), '');
  v_scope text := nullif(btrim(coalesce(p_package->>'equipment_or_scope','')), '');
  v_sow text := nullif(btrim(coalesce(p_package->>'scope_of_work','')), '');
  v_excl text := nullif(btrim(coalesce(p_package->>'exclusions','')), '');
  v_interfaces text := nullif(btrim(coalesce(p_package->>'interfaces','')), '');
  v_accept text := nullif(btrim(coalesce(p_package->>'acceptance_criteria','')), '');
  -- OMITTED IS NOT `false`. Every other field on the revise branch below is
  -- coalesce(stated, existing) — title, scope, required_date, lead_time_days,
  -- the WBS link. `is_mandatory` alone was `?? false`, on the ONE flag that
  -- blocks a gate: a cosmetic retitle through the documented write path (and
  -- the shipped form is exactly that — a blank-slate form keyed on
  -- package_code that never loads the existing row) cleared the flag, cleared
  -- its basis, and dropped a live gate blocker with the payload recording
  -- `is_mandatory: false` as though the author had asked for it. So the flag
  -- is now three-valued at the door: stated true, stated false, or absent.
  v_mandatory_stated boolean := (p_package ? 'is_mandatory')
                                and jsonb_typeof(p_package->'is_mandatory') <> 'null';
  v_mandatory_asked boolean;
  v_mandatory boolean;
  v_mbasis text := nullif(btrim(coalesce(p_package->>'mandatory_basis','')), '');
  -- RELEASING THE FLAG IS ITS OWN JUDGEMENT. The flag is a stated judgement
  -- with a 20-character basis behind it (contract_package_mandatory_basis);
  -- un-stating it is a judgement too, and it is the one that takes a gate
  -- blocker off the board.
  v_release text := nullif(btrim(coalesce(p_package->>'mandatory_release_basis','')), '');
  v_revising boolean;
  v_blocking int;
  v_required date;
  v_lead integer;
  v_eff_required date;
  v_eff_lead integer;
  v_wbs_code text := nullif(btrim(coalesce(p_package->>'wbs_code','')), '');
  v_wbs uuid;
  v_existing contract_packages%rowtype;
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
      'recording a procurement package requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_code is null or length(v_code) > 40 then
    return jsonb_build_object('error',
      'the package needs a package_code (40 characters maximum) — it is the reference every bid, evaluation and commitment quotes');
  end if;
  if v_title is null or length(v_title) < 5 then
    return jsonb_build_object('error', 'the package needs a title (5 characters minimum)');
  end if;
  if v_scope is null or length(v_scope) < 20 then
    return jsonb_build_object('error',
      'state what is being bought (equipment_or_scope, 20 characters minimum). Spec §25 names this field because a package titled "Pumps" is not a package anybody can bid, evaluate or claim against.');
  end if;

  begin
    v_required := nullif(btrim(coalesce(p_package->>'required_date','')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'required_date is not a date');
  end;

  if nullif(btrim(coalesce(p_package->>'lead_time_days','')), '') is not null then
    begin
      v_lead := btrim(p_package->>'lead_time_days')::integer;
    exception when others then
      return jsonb_build_object('error', 'lead_time_days is not a whole number of days');
    end;
    if v_lead < 0 or v_lead > 3650 then
      return jsonb_build_object('error',
        'lead_time_days must be between 0 and 3650 — a lead time outside that is a data-entry slip, and it sets the date the award had to happen');
    end if;
  end if;

  v_mandatory_asked := v_mandatory_stated and (p_package->>'is_mandatory')::boolean;

  if v_wbs_code is not null then
    select id into v_wbs from project_wbs_elements
     where organization_id = v_org and development_case_id = c.id and wbs_code = v_wbs_code;
    if v_wbs is null then
      return jsonb_build_object('error', format(
        'WBS element %s does not exist on this case. A package codes to its OWN case''s WBS or to none — pointing it at a neighbour''s element would attribute this scope to another case''s schedule and cost.',
        v_wbs_code));
    end if;
  end if;

  -- THE LOOKUP AND EVERY REFUSAL COME BEFORE THE MARKER IS GRANTED. The
  -- marker opened the wall for the whole transaction and was never cleared, so
  -- a call that REFUSED below still left `app.procurement_package_write =
  -- 'granted'` standing: in one multi-statement session a direct
  -- `update contract_packages ...` that had just been refused went through,
  -- and record_procurement_service_write — the only thing that makes a
  -- service-path write findable afterwards — went silent with it. Twelve
  -- earlier migrations clear their markers immediately after the guarded
  -- statement; this file now does too. `found` is captured into a variable
  -- because PERFORM resets it (the record_cost_item lesson, 20261130090200).
  select * into v_existing from contract_packages
   where organization_id = v_org and package_code = v_code;
  v_revising := found;

  if v_revising then
    -- A package already AWARDED is a contract. Its scope is what the
    -- counterparty signed, and a scope edited after award is a change order
    -- (D6.06), not a correction.
    if v_existing.awarded_at is not null then
      return jsonb_build_object('error', format(
        'package %s is awarded. Its scope, exclusions and acceptance criteria are what the counterparty signed — changing them here would rewrite the contract without a change order and without the counterparty. Record a change (record_project_change) instead.',
        v_code));
    end if;
    -- THE SCOPE FREEZES AT THE OPEN ACT, NOT AT THE AWARD. Guarding only on
    -- `awarded_at` left the window every bidder is exposed in: read the prices,
    -- then rewrite the scope, the exclusions and the acceptance criteria so the
    -- cheap non-compliant offer becomes the compliant one, then award it.
    -- open_package_bidding already refuses to issue a tender against a package
    -- with no scope or acceptance criteria BECAUSE BIDDERS PRICE WHAT THEY ARE
    -- TOLD; the same sentence says those fields stop moving the moment the
    -- envelopes come off.
    if v_existing.bids_opened_at is not null then
      return jsonb_build_object('error', format(
        'the bids on package %s were opened on %s. What this package asked for is what the bidders priced, and it is frozen from the moment the prices became legible — rewriting the scope, the exclusions or the acceptance criteria now re-decides which offer complies AFTER their numbers are on the table. Re-issue the tender if the scope was wrong.',
        v_code, v_existing.bids_opened_at));
    end if;
    if v_existing.development_case_id is not null
       and v_existing.development_case_id <> c.id then
      return jsonb_build_object('error', format(
        'package %s already belongs to another development case. A package code is unique per organization; moving one between cases would move its bids, evaluations and commitments with it.',
        v_code));
    end if;
    -- OMITTED MEANS UNCHANGED; STATED `false` ON A MANDATORY PACKAGE IS AN ACT.
    v_mandatory := case when v_mandatory_stated then v_mandatory_asked
                        else v_existing.is_mandatory end;
    if v_existing.is_mandatory and not v_mandatory then
      if v_release is null or length(v_release) < 20 then
        select count(*) into v_blocking
          from jsonb_array_elements(case_procurement_gate_obligations(c.id, null)) b
         where (b->>'id')::bigint = v_existing.id;
        return jsonb_build_object('error', format(
          'package %s is declared MANDATORY (%s). Removing that flag is the one edit here that takes a gate blocker off the board%s, so it is its own judgement and states its own reason: send mandatory_release_basis (20 characters minimum) saying what changed — the scope is bought another way, the need went away, the date moved. Omitting is_mandatory leaves the flag exactly as it is.',
          v_code, v_existing.mandatory_basis,
          case when coalesce(v_blocking, 0) > 0
            then format(' — and this package is raising %s of them right now', v_blocking)
            else '' end));
      end if;
    end if;
    -- A mandatory package keeps a stated basis: omitted means the existing
    -- one stands, and the CHECK holds the 20 characters for every writer.
    if v_mandatory then
      v_mbasis := coalesce(v_mbasis, v_existing.mandatory_basis);
      if v_mbasis is null or length(v_mbasis) < 20 then
        return jsonb_build_object('error',
          'a MANDATORY package states why it is mandatory (mandatory_basis, 20 characters minimum). This flag is the only thing that blocks a gate, so a flag with no stated reason is one somebody sets to silence a screen.');
      end if;
    end if;
    v_prev := jsonb_build_object(
      'title', v_existing.title, 'equipment_or_scope', v_existing.equipment_or_scope,
      'required_date', v_existing.required_date, 'lead_time_days', v_existing.lead_time_days,
      'is_mandatory', v_existing.is_mandatory,
      'mandatory_basis', v_existing.mandatory_basis);
  else
    v_mandatory := coalesce(v_mandatory_asked, false);
    if v_mandatory and (v_mbasis is null or length(v_mbasis) < 20) then
      return jsonb_build_object('error',
        'a MANDATORY package states why it is mandatory (mandatory_basis, 20 characters minimum). This flag is the only thing that blocks a gate, so a flag with no stated reason is one somebody sets to silence a screen.');
    end if;
  end if;

  v_eff_required := coalesce(v_required,
    case when v_revising then v_existing.required_date end);
  v_eff_lead := coalesce(v_lead,
    case when v_revising then v_existing.lead_time_days end);

  perform set_config('app.procurement_package_write', 'granted', true);

  if v_revising then
    update contract_packages
    set title = v_title,
        equipment_or_scope = v_scope,
        scope_of_work = coalesce(v_sow, scope_of_work),
        exclusions = coalesce(v_excl, exclusions),
        interfaces = coalesce(v_interfaces, interfaces),
        acceptance_criteria = coalesce(v_accept, acceptance_criteria),
        site_conditions_stated = coalesce(
          (p_package->>'site_conditions_stated')::boolean, site_conditions_stated),
        development_case_id = c.id,
        capital_project_id = coalesce(c.capital_project_id, capital_project_id),
        required_date = coalesce(v_required, required_date),
        lead_time_days = coalesce(v_lead, lead_time_days),
        is_mandatory = v_mandatory,
        mandatory_basis = case when v_mandatory then v_mbasis else null end,
        wbs_element_id = coalesce(v_wbs, wbs_element_id)
    where id = v_existing.id
    returning id into v_id;
  else
    insert into contract_packages
      (organization_id, package_code, title, equipment_or_scope, scope_of_work,
       exclusions, interfaces, acceptance_criteria, site_conditions_stated,
       development_case_id, capital_project_id, required_date, lead_time_days,
       is_mandatory, mandatory_basis, wbs_element_id, recorded_by)
    values
      (v_org, v_code, v_title, v_scope, v_sow, v_excl, v_interfaces, v_accept,
       coalesce((p_package->>'site_conditions_stated')::boolean, false),
       c.id, c.capital_project_id, v_required, v_lead,
       v_mandatory, case when v_mandatory then v_mbasis else null end, v_wbs, auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_package', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'package_id', v_id, 'package_code', v_code,
      'action', case
        when not v_revising then 'recorded'
        when v_existing.is_mandatory and not v_mandatory then 'mandatory_released'
        else 'revised' end),
    v_prev,
    jsonb_build_object('package_code', v_code, 'title', v_title,
      'equipment_or_scope', v_scope, 'required_date', v_required,
      'lead_time_days', v_lead, 'is_mandatory', v_mandatory,
      'mandatory_basis', case when v_mandatory then v_mbasis else null end,
      'mandatory_release_basis',
        case when v_revising and v_existing.is_mandatory and not v_mandatory
          then v_release end));

  return jsonb_build_object('package_id', v_id, 'package_code', v_code,
    'case_id', c.id, 'revised', v_revising,
    'isMandatory', v_mandatory,
    'mandatoryReleased', v_revising and v_existing.is_mandatory and not v_mandatory,
    -- REPORTED OFF THE EFFECTIVE DATES, NOT OFF THE PAYLOAD. A revise that
    -- omits required_date keeps the recorded one (the UPDATE coalesces), and
    -- answering from the payload alone told the author their package was NOT
    -- ASSESSABLE and blocked nothing while it was in fact blocking a gate.
    'awardRequiredBy', case when v_eff_required is not null and v_eff_lead is not null
      then v_eff_required - v_eff_lead else null end,
    'assessable', v_eff_required is not null and v_eff_lead is not null,
    'notAssessableReason', case
      when v_eff_required is null and v_eff_lead is null then
        'This package states neither a required date nor a lead time, so the date the award had to happen cannot be computed. It will be listed and it will block nothing.'
      when v_eff_required is null then
        'This package states no required_date, so the date the award had to happen cannot be computed. It will be listed and it will block nothing.'
      when v_eff_lead is null then
        'This package states no lead_time_days, so the date the award had to happen cannot be computed. It will be listed and it will block nothing.'
      end);
end
$$;

revoke all on function public.record_procurement_package(uuid, jsonb) from public, anon;
grant execute on function public.record_procurement_package(uuid, jsonb)
  to authenticated, service_role;

comment on function public.record_procurement_package(uuid, jsonb) is
  'D6.03 / spec I.16 + III.§25: the ProcurementPackage write path that E7.02 and D6.03 both named as missing. EXTENDS contract_packages — no second package store. Refuses a package with no stated equipment_or_scope, a mandatory flag with no basis, a WBS element from another case, any edit once the BIDS ARE OPENED (what the package asked for is what the bidders priced, and rewriting it after the prices are legible re-decides which offer complies), and any edit to an AWARDED package (that is a change order, not a correction). OMITTING `is_mandatory` LEAVES IT ALONE: clearing that flag is the one edit here that takes a gate blocker off the board, so it is its own act and requires `mandatory_release_basis`.';

-- ---------------------------------------------------------------------------
-- 5. THE STATUS ACT. §25's four dimensions move one at a time, with a basis.
-- ---------------------------------------------------------------------------
create or replace function public.set_procurement_package_status(
  p_package_id bigint,
  p_dimension text,
  p_status text,
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
  p contract_packages%rowtype;
  v_dim text := lower(nullif(btrim(coalesce(p_dimension, '')), ''));
  v_status text := lower(nullif(btrim(coalesce(p_status, '')), ''));
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_prev text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'moving a §25 status dimension requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if v_dim is null or not (v_dim = any (sync_procurement_status_dimensions())) then
    return jsonb_build_object('error', format(
      'dimension must be one of: %s (spec III.§25 names four)',
      array_to_string(sync_procurement_status_dimensions(), ', ')));
  end if;
  if v_status is null or not (v_status = any (sync_procurement_status_values(v_dim))) then
    return jsonb_build_object('error', format(
      'the %s dimension takes one of: %s',
      v_dim, array_to_string(sync_procurement_status_values(v_dim), ', ')));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state what moved this dimension (basis, 10 characters minimum) — a status that changed for no recorded reason is a status nobody can question later');
  end if;

  -- THE COMMERCIAL DIMENSION IS NOT SET BY HAND AT ITS DECIDED VALUE.
  -- `awarded` is written by award_contract, which checks the authority, the
  -- separation of duties and the evaluations. Letting a person type it here
  -- would make the §25 dimension and the award record disagree, and the
  -- dimension is what the screens read.
  if v_dim = 'commercial' and v_status = 'awarded' then
    return jsonb_build_object('error',
      'the commercial dimension reaches `awarded` through award_contract, which checks the delegated authority, the separation of duties between evaluator and awarder, and that the winning bid was actually evaluated. Typing it here would record an award nobody made.');
  end if;

  -- ...AND IT IS NOT MOVED OFF IT BY HAND EITHER. The guard was one-directional
  -- and the column comment claims "the status and the award record cannot
  -- disagree": a planner moved the commercial dimension of a package holding a
  -- live award to `cancelled`, leaving awarded_at, the supplier, the value and
  -- the whole §24 field set standing while every screen rendered the contract
  -- as cancelled — and it could not be undone, because putting `awarded` back
  -- is refused by the arm above and award_contract refuses a second award.
  if v_dim = 'commercial' and p.awarded_at is not null then
    return jsonb_build_object('error', format(
      'package %s holds an awarded contract (%s %s to %s, awarded %s). Its commercial dimension says `awarded` because a contract exists, and moving it by hand would leave the four §25 dimensions saying one thing while the award record says another — the screens read the dimension, so the screen would carry the lie. Ending a signed contract is a termination or a change order (spec §21), not a status edit.',
      p.package_code, coalesce(p.contract_currency, ''),
      coalesce(p.awarded_value::text, 'an unrecorded amount'),
      coalesce((select name from suppliers where id = p.awarded_supplier_id), 'the awarded supplier'),
      p.awarded_at::date));
  end if;

  -- A MANDATORY PACKAGE IS NOT CANCELLED WITH A TEN-CHARACTER BASIS. Leg 1 of
  -- the gate blocker fires on a mandatory package with no award, and it does
  -- not stop firing because somebody typed `cancelled` — so a cancelled
  -- mandatory package blocked every gate on the case for ever, and the wall's
  -- own remedy (award it) was the one thing that could no longer be done. The
  -- flag is what blocks the gate, so releasing it is the act: it costs a
  -- twenty-character judgement through record_procurement_package, and this
  -- refusal names it rather than offering a cheaper way to the same silence.
  if v_dim = 'commercial' and v_status = 'cancelled' and p.is_mandatory then
    return jsonb_build_object('error', format(
      'package %s is declared MANDATORY (%s), and a mandatory package with no awarded contract blocks every gate on this case. Cancelling the commercial dimension would leave that blocker standing with nothing left that could ever discharge it. Release the mandatory flag first — record_procurement_package with is_mandatory false and a mandatory_release_basis saying what changed — and then cancel.',
      p.package_code, p.mandatory_basis));
  end if;

  -- THE DELIVERY DIMENSION AND THE ARRIVAL DATE ARE ONE FACT.
  -- `received_and_inspected` is the value that DISCHARGES the mandatory
  -- long-lead slippage blocker, and the first draft of this file let one
  -- planner type it with a ten-character basis while the recorded dates still
  -- said the equipment was 45 days late. It is now reached only through
  -- record_package_delivery_receipt, which records the arrival DATE the
  -- blocker actually reads — and once that date is recorded the dimension is
  -- frozen with it, because contract_package_receipt_pair holds the two
  -- together for every writer and moving one alone would be a raw constraint
  -- violation rather than a sentence.
  if v_dim = 'delivery' and v_status = 'received_and_inspected' then
    return jsonb_build_object('error', format(
      'the delivery dimension reaches `received_and_inspected` through record_package_delivery_receipt, which records the DATE the equipment arrived. That date — not this status — is what discharges the mandatory long-lead slippage blocker on package %s: a status somebody can type is not evidence that anything arrived.',
      p.package_code));
  end if;
  if v_dim = 'delivery' and p.actual_delivery_date is not null then
    return jsonb_build_object('error', format(
      'package %s was received and inspected on %s. The delivery dimension and that arrival date are one fact (contract_package_receipt_pair), so the dimension does not move away from `received_and_inspected` while the date stands. If the receipt was wrong, that is a rejection on receipt recorded against the goods, not a status edit.',
      p.package_code, p.actual_delivery_date));
  end if;

  execute format('select %I from contract_packages where id = $1', v_dim || '_status')
    into v_prev using p.id;
  if v_prev = v_status then
    return jsonb_build_object('error', format(
      'the %s dimension is already %s', v_dim, v_status));
  end if;

  -- THE MARKER IS CLEARED IMMEDIATELY. Left standing it opens the wall for the
  -- whole transaction, and record_procurement_service_write — the only thing
  -- that makes a service-path write findable afterwards — goes silent with it.
  perform set_config('app.procurement_package_write', 'granted', true);
  execute format(
    'update contract_packages set %I = $1, status_updated_at = now() where id = $2',
    v_dim || '_status') using v_status, p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_package_status', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'dimension', v_dim),
    jsonb_build_object('dimension', v_dim, 'status', v_prev),
    jsonb_build_object('dimension', v_dim, 'status', v_status, 'basis', v_basis));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'dimension', v_dim, 'previousStatus', v_prev, 'status', v_status);
end
$$;

revoke all on function public.set_procurement_package_status(bigint, text, text, text)
  from public, anon;
grant execute on function public.set_procurement_package_status(bigint, text, text, text)
  to authenticated, service_role;

comment on function public.set_procurement_package_status(bigint, text, text, text) is
  'D6.09 / spec III.§25: moves ONE of the four status dimensions, with a stated basis and an audit row carrying previous_state and new_state. Refuses `commercial = awarded` by name — that value is written by award_contract, which checks the authority and the separation of duties; typed here it would be an award nobody made.';

-- ---------------------------------------------------------------------------
-- 5b. THE DELIVERY FORECAST. Its own act, and the only §25 field that may move
--     on an AWARDED package: the contract's terms are what the counterparty
--     signed and are frozen, but when the equipment will actually arrive is a
--     fact that changes, and it is the fact D6.09's slippage blocker measures.
--     Recording it through record_procurement_package would have meant either
--     re-opening an awarded contract's scope or leaving the slippage blocker
--     unreachable after award — which is exactly when it matters.
-- ---------------------------------------------------------------------------
create or replace function public.record_package_delivery_forecast(
  p_package_id bigint,
  p_forecast_date date,
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
  p contract_packages%rowtype;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a delivery forecast requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p_forecast_date is null then
    return jsonb_build_object('error',
      'state the forecast delivery date. Clearing it would remove the only fact the slippage blocker measures against, which is not the same as the package being on time.');
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state where the forecast comes from (basis, 10 characters minimum) — a delivery date with no source behind it is a hope, and this one moves a gate');
  end if;
  if p.required_date is null then
    return jsonb_build_object('error', format(
      'package %s states no required_date, so a forecast has nothing to be early or late against. Record the date the project needs it first.',
      p.package_code));
  end if;
  if p.actual_delivery_date is not null then
    return jsonb_build_object('error', format(
      'package %s arrived on %s. A forecast of when something will arrive is not recorded after it has, and overwriting the forecast would rewrite the slippage the receipt already settled.',
      p.package_code, p.actual_delivery_date));
  end if;

  perform set_config('app.procurement_package_write', 'granted', true);
  update contract_packages
     set forecast_delivery_date = p_forecast_date
   where id = p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_package_forecast', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code),
    jsonb_build_object('forecast_delivery_date', p.forecast_delivery_date),
    jsonb_build_object('forecast_delivery_date', p_forecast_date, 'basis', v_basis));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'forecastDeliveryDate', p_forecast_date, 'requiredDate', p.required_date,
    'slippageDays', p_forecast_date - p.required_date,
    'late', p_forecast_date > p.required_date,
    -- READ OFF THE ARRIVAL DATE, NEVER OFF delivery_status. The discharge is a
    -- FACT ABOUT A DATE and this is the predicate's own answer restated.
    'blocksGate', p.is_mandatory and p_forecast_date > p.required_date
                  and p.actual_delivery_date is null);
end
$$;

revoke all on function public.record_package_delivery_forecast(bigint, date, text)
  from public, anon;
grant execute on function public.record_package_delivery_forecast(bigint, date, text)
  to authenticated, service_role;

comment on function public.record_package_delivery_forecast(bigint, date, text) is
  'D6.09 / spec III.§25: records when a package is now forecast to arrive, with its source. The one §25 field that may move on an AWARDED package — the contract terms are frozen, the delivery forecast is not — and the fact the mandatory long-lead slippage blocker measures. Refuses a forecast on a package with no required_date, because there is then nothing to be late against, and on one that has already arrived.';

-- ---------------------------------------------------------------------------
-- 5c. THE DATED RECEIPT — the ONLY thing that discharges the slippage blocker.
--
--     The first draft of this file discharged it on
--     `delivery_status = 'received_and_inspected'`, which one planner could
--     type through set_procurement_package_status with a ten-character basis
--     while the recorded dates still said the equipment was 45 days late: the
--     blocker went from firing to silent, and the gate review the wall had
--     just refused was accepted, with nothing arrived. The column's own
--     comment forbids exactly that — "`late` is computed from the dates, never
--     read off a status somebody could set" — and leg 2 read it off that
--     status anyway.
--
--     So the discharge is an ACT with a DATE. It states when the equipment
--     arrived, and contract_package_receipt_pair holds the date and the
--     dimension together for every writer, so neither can move without the
--     other. A receipt dated in the future is refused: a receipt is a record
--     of something that has happened.
-- ---------------------------------------------------------------------------
create or replace function public.record_package_delivery_receipt(
  p_package_id bigint,
  p_received_date date,
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
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a delivery receipt requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.actual_delivery_date is not null then
    return jsonb_build_object('error', format(
      'package %s was already received and inspected on %s. A receipt happens once.',
      p.package_code, p.actual_delivery_date));
  end if;
  if p_received_date is null then
    return jsonb_build_object('error',
      'state the date the equipment arrived and was inspected. That date is what discharges the mandatory long-lead slippage blocker; without it there is only a status somebody typed.');
  end if;
  if p_received_date > current_date then
    return jsonb_build_object('error', format(
      'the receipt is dated %s, which is in the future. A receipt records something that has happened; a date that has not arrived yet is a forecast (record_package_delivery_forecast).',
      p_received_date));
  end if;
  if p.awarded_at is not null and p_received_date < p.awarded_at::date then
    return jsonb_build_object('error', format(
      'the receipt is dated %s and the contract for package %s was not awarded until %s. Equipment does not arrive before the contract that buys it.',
      p_received_date, p.package_code, p.awarded_at::date));
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'record the receipt (note, 20 characters minimum) — what arrived, who inspected it and against what. This is the act that takes a mandatory long-lead package off the gate, so a receipt with nothing behind it is the same failure as the status it replaces.');
  end if;

  perform set_config('app.procurement_package_write', 'granted', true);
  update contract_packages
     set actual_delivery_date = p_received_date,
         delivery_status = 'received_and_inspected',
         status_updated_at = now()
   where id = p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'procurement_package_receipt', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code),
    jsonb_build_object('actual_delivery_date', p.actual_delivery_date,
      'delivery_status', p.delivery_status),
    jsonb_build_object('actual_delivery_date', p_received_date,
      'delivery_status', 'received_and_inspected', 'note', v_note));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'actualDeliveryDate', p_received_date, 'requiredDate', p.required_date,
    'deliveryStatus', 'received_and_inspected',
    -- THE RECEIPT DOES NOT ERASE THE LATENESS, IT SETTLES IT. A package that
    -- arrived 45 days late stops blocking the gate because it has arrived, and
    -- the sentence says how late it was rather than letting the blocker
    -- disappear without a trace.
    'daysLate', case when p.required_date is not null
      then p_received_date - p.required_date end,
    'arrivedLateNote', case
      when p.required_date is not null and p_received_date > p.required_date then format(
        'This package arrived %s day(s) after the %s the project needed it. The gate blocker is discharged because the equipment is here, not because it was on time.',
        p_received_date - p.required_date, p.required_date)
      end);
end
$$;

revoke all on function public.record_package_delivery_receipt(bigint, date, text)
  from public, anon;
grant execute on function public.record_package_delivery_receipt(bigint, date, text)
  to authenticated, service_role;

comment on function public.record_package_delivery_receipt(bigint, date, text) is
  'D6.09 / spec III.§25: THE DATED RECEIPT — the only act that discharges the mandatory long-lead slippage blocker. Records the date the equipment arrived and was inspected, and moves delivery_status with it (contract_package_receipt_pair holds the pair for every writer). set_procurement_package_status refuses `received_and_inspected` BY NAME and points here, because a status somebody can type with a ten-character basis is not evidence that anything arrived.';

-- ---------------------------------------------------------------------------
-- 6. THE §25 GATE OBLIGATIONS (D6.09) — in the shape
--    case_gate_outstanding_obligations already speaks, so the readiness
--    screen, the gate-review RPC and the persistence wall read the SAME rows.
--
--    ORG-GATED IN THAT PREDICATE'S OWN IDIOM: a signed-in caller of another
--    tenant gets an empty list; a caller with NO auth.uid() (the trigger and
--    service paths the wall runs on) is admitted, because refusing that one
--    would switch the wall off.
-- ---------------------------------------------------------------------------
create or replace function public.case_procurement_gate_obligations(
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
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  v_org uuid;
  v_out jsonb := '[]'::jsonb;
begin
  -- THE DUAL-CALLER GATE IS auth.uid(). Inside a SECURITY DEFINER the session
  -- role is the function OWNER for every caller alike, so gating on that role
  -- name instead is dead code that never fires — 20261130090700 repaired
  -- thirteen of them and this file does not add a fourteenth.
  if v_caller_org is null and auth.uid() is not null then
    return '[]'::jsonb;
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return '[]'::jsonb;
  end if;
  v_org := c.organization_id;

  -- LEG 1 — the award that had to happen and did not. A MANDATORY package
  -- with no awarded contract whose award-by date (required_date minus the
  -- stated lead time) has passed. A package missing either date is NOT
  -- assessable and is deliberately absent from this list.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'procurement_package_unawarded',
      'id', p.id,
      'name', format(
        '%s (%s): a mandatory long-lead package with no awarded contract. The award had to be placed by %s for delivery by %s (%s-day lead time); that date has passed.',
        p.package_code, p.equipment_or_scope,
        (p.required_date - p.lead_time_days)::text, p.required_date::text, p.lead_time_days),
      'packageCode', p.package_code,
      'requiredDate', p.required_date,
      'awardRequiredBy', p.required_date - p.lead_time_days,
      'leadTimeDays', p.lead_time_days,
      'commercialStatus', p.commercial_status,
      'mandatoryBasis', p.mandatory_basis)
      order by (p.required_date - p.lead_time_days), p.package_code), '[]'::jsonb)
  into v_out
  from contract_packages p
  where p.organization_id = v_org
    and p.development_case_id = c.id
    and p.is_mandatory
    and p.awarded_at is null
    and p.required_date is not null
    and p.lead_time_days is not null
    and (p.required_date - p.lead_time_days) < current_date;

  -- LEG 2 — D6.09's own words: mandatory long-lead SLIPPAGE. The package is
  -- awarded and the forecast delivery is after the date the project needs it.
  -- Read off the two dates, never off delivery_status: a status somebody can
  -- set is not evidence about a date, and the discharge term below is
  -- `actual_delivery_date is null` — the DATED receipt — for the same reason.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'procurement_package_late',
      'id', p.id,
      'name', format(
        '%s (%s): a mandatory long-lead package forecast to arrive %s, %s day(s) after the %s the project needs it.',
        p.package_code, p.equipment_or_scope, p.forecast_delivery_date::text,
        (p.forecast_delivery_date - p.required_date), p.required_date::text),
      'packageCode', p.package_code,
      'requiredDate', p.required_date,
      'forecastDeliveryDate', p.forecast_delivery_date,
      'slippageDays', p.forecast_delivery_date - p.required_date,
      'deliveryStatus', p.delivery_status,
      'mandatoryBasis', p.mandatory_basis)
      order by (p.forecast_delivery_date - p.required_date) desc, p.package_code), '[]'::jsonb)
  into v_out
  from contract_packages p
  where p.organization_id = v_org
    and p.development_case_id = c.id
    and p.is_mandatory
    and p.required_date is not null
    and p.forecast_delivery_date is not null
    and p.forecast_delivery_date > p.required_date
    and p.actual_delivery_date is null;

  -- LEG 3 — THE CONTRACT THAT CANNOT DELIVER ON TIME BY ITS OWN TERMS.
  --
  -- Legs 1 and 2 between them left the exact case D6.09 exists for silent: a
  -- MANDATORY package awarded LATE, with no forecast recorded. Leg 1 stops the
  -- moment anything is awarded and never asks whether the award happened
  -- before the award-by date; leg 2 needs a forecast_delivery_date, and
  -- recording one is voluntary — nothing requires it. So "mandatory, awarded
  -- sixty days late, contract completing 170 days after the project needs the
  -- equipment" produced ZERO blockers and the gate passed.
  --
  -- The evidence this leg reads costs nothing to obtain, because §24 already
  -- makes it mandatory on every awarded package
  -- (contract_package_section24_complete): a contract that COMPLETES after the
  -- date the project needs the thing cannot deliver on time by its own terms,
  -- whatever anybody has or has not forecast. Discharged by the same dated
  -- receipt as leg 2 — the equipment being here is the only thing that ends
  -- it.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'procurement_package_contract_late',
      'id', p.id,
      'name', format(
        '%s (%s): a mandatory long-lead package whose awarded contract completes %s, %s day(s) after the %s the project needs it. The contract cannot deliver on time by its own terms.',
        p.package_code, p.equipment_or_scope, p.contract_completion_date::text,
        (p.contract_completion_date - p.required_date), p.required_date::text),
      'packageCode', p.package_code,
      'requiredDate', p.required_date,
      'contractCompletionDate', p.contract_completion_date,
      'slippageDays', p.contract_completion_date - p.required_date,
      'awardedAt', p.awarded_at,
      'forecastDeliveryDate', p.forecast_delivery_date,
      'deliveryStatus', p.delivery_status,
      'mandatoryBasis', p.mandatory_basis)
      order by (p.contract_completion_date - p.required_date) desc, p.package_code), '[]'::jsonb)
  into v_out
  from contract_packages p
  where p.organization_id = v_org
    and p.development_case_id = c.id
    and p.is_mandatory
    and p.awarded_at is not null
    and p.required_date is not null
    and p.contract_completion_date is not null
    and p.contract_completion_date > p.required_date
    and p.actual_delivery_date is null;

  -- p_gate_id is accepted and deliberately unused for filtering: a mandatory
  -- package that cannot arrive in time is a fact about the CASE, not about one
  -- gate, so it blocks every gate until it is resolved. The argument exists so
  -- this predicate has the signature case_gate_outstanding_obligations calls
  -- its members with, and so a later rule that IS gate-scoped can use it
  -- without changing every call site. Referenced here so a reader does not
  -- read the omission as an oversight.
  if p_gate_id is not null and jsonb_array_length(v_out) = 0 then
    return '[]'::jsonb;
  end if;

  return v_out;
end
$$;

revoke all on function public.case_procurement_gate_obligations(uuid, bigint)
  from public, anon;
grant execute on function public.case_procurement_gate_obligations(uuid, bigint)
  to authenticated, service_role;

comment on function public.case_procurement_gate_obligations(uuid, bigint) is
  'D6.09 / spec III.§25: the procurement obligations that BLOCK a gate — a MANDATORY long-lead package whose award-by date has passed with nothing awarded, a mandatory package forecast to arrive after the date the project needs it, and a mandatory package whose AWARDED CONTRACT completes after that date (the leg that closes "awarded late, no forecast recorded", which the first two legs between them left silent). All three are discharged by the DATED receipt, never by delivery_status. Appended by case_gate_outstanding_obligations, refused over by enforce_gate_review_outstanding_obligations, rendered by get_gate_readiness and by get_case_procurement: ONE predicate, four consumers, so the enforced truth and the displayed truth are the same rows. A package missing required_date or lead_time_days is NOT ASSESSABLE and is absent here — an alarm wired to a date nobody recorded is worse than no alarm, and get_case_procurement names every such package.';

-- ---------------------------------------------------------------------------
-- 7. WIRING, BY TRANSFORMATION (the 5B/5D idiom). Both functions below are
--    edited IN PLACE from their LIVE definitions and RAISE if the anchor is
--    absent — re-typing a body here is how a slice silently reverts a fix made
--    between then and now.
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
      'case_gate_outstanding_obligations does not exist — the Slice 3C predicate this slice extends is missing, and building a second gate evaluator instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('case_procurement_gate_obligations' in v_def) > 0 then
    null;  -- already extended by a previous run of this migration
  else
    v_new := replace(v_def,
      E'\n  return v_out;\nend',
      E'\n  -- D6.09 (20261208090000, marked insertion): the §25 procurement\n  -- obligations, read from the ONE predicate this slice adds. Appended here\n  -- rather than queried again by the readiness screen, so the screen and the\n  -- persistence wall speak from the same rows.\n  v_out := v_out || case_procurement_gate_obligations(c.id, g.id);\n\n  return v_out;\nend');
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
  if position('procurement_package_unawarded' in v_def) > 0 then
    null;
  else
    -- SHORT, EXACT ANCHOR: the last element of the refused-type list plus its
    -- closing paren, which does not depend on how earlier insertions wrapped
    -- the list across lines.
    v_new := replace(v_def,
      $old$'event_consequence_unanswered');$old$,
      $new$'event_consequence_unanswered', 'procurement_package_unawarded', 'procurement_package_late', 'procurement_package_contract_late');$new$);
    if v_new = v_def then
      raise exception
        'the refused-type list of enforce_gate_review_outstanding_obligations was not found in the shape Slice 5D left it — do not widen a wall blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    -- THE REFUSAL MUST DESCRIBE WHAT IT ACTUALLY CHECKED (the 4C ruling). A
    -- gate refused purely over an unawarded long-lead package must not tell
    -- the reader it refused over a permit condition.
    v_new := replace(v_new,
      $old$a risk indicator gone critical (spec I.18, I.19, I.25, III.§71-78). '$old$,
      $new$a risk indicator gone critical, '
    'or a mandatory long-lead procurement package that cannot arrive when the project needs it '
    '(spec I.18, I.19, I.25, III.§25, III.§71-78). '$new$);
    v_new := replace(v_new,
      $old$answer_develop_event_consequence), or record an outcome $old$,
      $new$answer_develop_event_consequence / award_contract), or record an outcome $new$);
    if position('III.§25' in v_new) = 0
       or position('award_contract' in v_new) = 0 then
      raise exception
        'the refusal message of enforce_gate_review_outstanding_obligations was not found in the shape this migration expected — a wall whose message no longer describes what it checks is worse than no message, so this fails rather than widening the type list alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$wall$;

notify pgrst, 'reload schema';
