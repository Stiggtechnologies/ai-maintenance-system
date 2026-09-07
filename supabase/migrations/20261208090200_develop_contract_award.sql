-- ============================================================================
-- Sync Develop — Slice 6A, part 3 of 3.
-- D6.05 (Contract, spec I.16) and D6.08 (Contract, spec III.§24) — the same
-- object under two spec references, and the overlap map gives them one home:
-- "grow `contract_packages`' award side; `warranty_terms` stays its warranty
-- leg" (ruling 13). ONE contract model. No `contracts` table is created here.
--
-- WHAT THE ROW SAID WAS MISSING, AND WHERE EACH PIECE LANDS:
--   contract_type            → the I.17 vocabulary, on contract_packages
--   value                    → awarded_value, with a ceiling behind it
--   performance_requirements → performance_requirements
--   dates                    → contract_start_date, contract_completion_date
--   warranty_terms           → warranty_term_id → the EXISTING warranty_terms
--
-- THE AWARD IS AN AUTHORITY-BEARING ACT. Awarding a contract commits the
-- owner's capital exactly as approving a change or drawing on contingency
-- does, so it routes through the ONE authority store with a new
-- `action_type = 'contract_award'` — never a parallel authority table, never
-- an ad-hoc role list. Absence refuses and a null ceiling refuses, the two
-- deliberate defaults 4D established (20261203090000 R1/R2): nobody having
-- said how much you may commit is not permission to commit.
--
-- The 4D self-adoption and stated-ceiling rules are EXTENDED to cover
-- contract_award by transformation of the live function bodies, not by
-- re-typing them: a contract award is money, so you do not state or adopt your
-- own contract-award ceiling, and a blank ceiling is an unfinished delegation
-- rather than an unlimited one.
--
-- THE COMMITMENT FEEDS SLICE 4'S COST MODEL, NOT A SECOND ONE. Spec §23's
-- CostItem already carries a `commitment` column and `project_cost_items`
-- (20261130090200, D5.29 ✅) is where it lives. A commitment line here names
-- the cost item it commits against; approving the commitments SUMS them onto
-- that line's `commitment` through record_cost_item's own door
-- (`app.cost_item_write`), so the controls reconciliation, the earned-value
-- suite and the contingency ledger all see one number. There is no second
-- commitment total anywhere.
--
-- REFUSAL-FIRST, and the two refusals the task names:
--   * a package with NO BIDS refuses rather than reporting "0 bids evaluated",
--     which reads as a completed evaluation;
--   * a commitment total with a MISSING PRICE refuses and NAMES the line,
--     rather than summing the priced lines and presenting the total as the
--     contract's commitment.
--
-- §70: awarding a contract and approving a commitment are human acts, refused
-- for the AI-operator identity by name at every door and, for every writer, at
-- the table.
--
-- Canonical reuse: contract_packages, contract_bids, bid_evaluations,
-- suppliers, warranty_terms, authority_limits, org_ancestry,
-- project_cost_items, record_calculation_run, audit_events, security_events,
-- sync_finite_money, enforce_procurement_act_is_human.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE §24 / I.17 CONTRACT VOCABULARY.
-- ---------------------------------------------------------------------------
create or replace function public.sync_contract_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  -- Spec I.17's seven strategies, verbatim and in its order.
  select array[
    'lump_sum', 'unit_rate', 'epc', 'epcm', 'alliance',
    'owner_executed', 'performance_contract']::text[];
$$;

revoke all on function public.sync_contract_types() from public, anon;
grant execute on function public.sync_contract_types() to authenticated, service_role;

comment on function public.sync_contract_types() is
  'D6.05/D6.08 / spec I.17: the seven contract strategies, verbatim. §24''s `contract_type` takes one of these; CONTRACT_TYPES in src/lib/develop/procurement.ts mirrors it and the slice test pins the two together. Which strategy SUITS a package is I.17''s recommendation problem (D6.10) and is not decided here.';

alter table public.contract_packages
  drop constraint if exists contract_package_contract_type;
alter table public.contract_packages
  add constraint contract_package_contract_type check (
    contract_type is null or contract_type = any (sync_contract_types()));

alter table public.contract_packages
  drop constraint if exists contract_package_contract_currency;
alter table public.contract_packages
  add constraint contract_package_contract_currency check (
    contract_currency is null or contract_currency ~ '^[A-Z]{3}$');

-- A contract that completes before it starts is a data-entry slip that then
-- drives every delivery forecast and every late-package gate blocker.
alter table public.contract_packages
  drop constraint if exists contract_package_contract_dates;
alter table public.contract_packages
  add constraint contract_package_contract_dates check (
    contract_start_date is null or contract_completion_date is null
    or contract_completion_date >= contract_start_date);

-- §24's field set is ALL-OR-NONE at the award. A "contract" with a supplier
-- and a value but no type, no dates and no performance requirements is a
-- purchase order somebody will later call a contract.
alter table public.contract_packages
  drop constraint if exists contract_package_section24_complete;
alter table public.contract_packages
  add constraint contract_package_section24_complete check (
    awarded_at is null
    or (contract_type is not null
        and contract_currency is not null
        and awarded_value is not null
        and contract_start_date is not null
        and contract_completion_date is not null
        and length(btrim(coalesce(performance_requirements, ''))) >= 20
        and length(btrim(coalesce(award_basis, ''))) >= 20));

comment on constraint contract_package_section24_complete on public.contract_packages is
  'D6.08 / spec III.§24: an AWARDED package carries the full §24 field set or it is not an award. Enforced at the schema for every writer, because the RPC''s checks do not bind a service key and an incomplete contract is what a claim is later argued over.';

comment on column public.contract_packages.contract_type is
  'Spec III.§24 `contract_type`, from I.17''s seven strategies (sync_contract_types()). Recorded at award and never inferred: which strategy suits a package is I.17''s recommendation problem (D6.10, open).';
comment on column public.contract_packages.performance_requirements is
  'Spec III.§24 `performance_requirements`: what the counterparty must achieve, in words, at award. Twenty characters minimum on an awarded package — a contract with no performance requirement has nothing to hold the supplier to and nothing for D9.02''s operational performance warranty to reference.';
comment on column public.contract_packages.warranty_term_id is
  'Spec III.§24 `warranty_terms`: a reference to the EXISTING warranty_terms row (20260817140000:205), which stays the vendor-warranty leg per overlap-map ruling 13. Not a copy of the terms onto this table — one warranty model.';
comment on column public.contract_packages.award_authority_limit_id is
  'D6.05: the adopted authority_limits row the award was checked against, recorded ON the contract so every award quotes the ceiling it passed. An adopted delegation is never edited (20261203090400), which is what makes the quotation falsifiable.';

-- ---------------------------------------------------------------------------
-- 2. THE ONE AUTHORITY STORE GAINS THE CONTRACT AWARD.
-- ---------------------------------------------------------------------------
alter table public.authority_limits
  drop constraint if exists authority_limits_action_type_check;
alter table public.authority_limits
  add constraint authority_limits_action_type_check
    check (action_type in ('general','sanction','regulatory_variance',
                           'gate_requirement_waiver','contingency_drawdown',
                           'change_approval','contract_award'));

insert into authority_limits (organization_id, role_key, tier_label, action_type,
  max_commitment_usd, max_risk_level, escalates_to_role, basis)
select o.id, v.role_key, v.tier_label, 'contract_award',
       null, v.risk, v.escalates, v.basis
from organizations o
cross join (values
  ('maintenance_manager', 'Project manager', 'Medium', 'executive',
   'Proposed: contracts whose value sits inside the project manager''s delegation are awarded there. The AMOUNT is deliberately null so the row cannot be adopted without the organization stating its own number — a null ceiling REFUSES every award, it does not permit an unlimited one.'),
  ('executive', 'Executive', 'High', 'board',
   'Proposed: awards above the project manager''s ceiling escalate to the executive layer. Placeholder pending the organization''s own delegation instrument.'),
  ('board', 'Board', 'Critical', null,
   'Proposed: the top of the contract-award ladder. Placeholder pending the board charter.')
) as v(role_key, tier_label, risk, escalates, basis)
where not exists (
  select 1 from authority_limits al
  where al.organization_id = o.id and al.role_key = v.role_key
    and al.action_type = 'contract_award'
);

-- The 4D money rules EXTENDED to the new action type, by transformation of the
-- LIVE bodies. Re-typing them here would silently revert whatever was fixed in
-- them since; both raise if their anchor has moved.
do $money$
declare
  v_def text;
  v_new text;
  v_fn text;
begin
  foreach v_fn in array array['adopt_authority_limit', 'state_authority_ceiling'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then
      raise exception
        '% does not exist — the Slice 4D authority machinery this slice extends is missing, and building a parallel authority store instead is forbidden.', v_fn
        using errcode = 'check_violation';
    end if;
    if position('contract_award' in v_def) > 0 then
      continue;  -- already extended by a previous run of this migration
    end if;
    v_new := replace(v_def,
      $old$('contingency_drawdown','change_approval')$old$,
      $new$('contingency_drawdown','change_approval','contract_award')$new$);
    if v_new = v_def then
      raise exception
        'the money-action list of % was not found in the shape Slice 4D left it — do not extend an authority rule blind; re-derive this insertion against the current body.', v_fn
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end loop;
end
$money$;

-- The delegation SCREEN reads the same rule, so a contract-award delegation
-- shows its self-adoption refusal like the other two money ladders do.
do $screen$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_authority_delegations';
  if v_def is null then
    raise exception 'get_authority_delegations does not exist'
      using errcode = 'check_violation';
  end if;
  if position('contract_award' in v_def) = 0 then
    v_new := replace(v_def,
      $old$al.action_type in ('contingency_drawdown','change_approval')$old$,
      $new$al.action_type in ('contingency_drawdown','change_approval','contract_award')$new$);
    if v_new = v_def then
      raise exception
        'the self-adoption clause of get_authority_delegations was not found in the shape Slice 4D left it — the screen and the door must read the same rule, so this fails rather than letting them diverge.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$screen$;

-- ---------------------------------------------------------------------------
-- 3. THE AWARD AUTHORITY SELECTION. Same store, same org-node scope rule, same
--    two deliberate defaults as sync_contingency_authority and
--    sync_change_authority: absence refuses, and a null ceiling refuses.
--
--    NOT CLIENT-CALLABLE, for the reason stated on both siblings: it takes an
--    organization as an argument, so a direct client call would read another
--    tenant's adopted delegation. Its caller is a definer owned by the
--    migration role that passes an organization already resolved from the
--    session.
-- ---------------------------------------------------------------------------
drop function if exists public.sync_contract_award_authority(uuid, text, numeric, text);

create or replace function public.sync_contract_award_authority(
  p_org uuid,
  p_role text,
  p_value numeric,
  p_currency text default null,
  p_case_id uuid default null,
  p_awarder uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l authority_limits%rowtype;
  v_magnitude numeric := abs(coalesce(p_value, 0));
  v_committed numeric := 0;
begin
  select al.* into l
  from authority_limits al
  left join org_ancestry(p_org) anc on anc.node_id = al.org_node_id
  where al.organization_id = p_org
    and al.role_key = p_role
    and al.action_type = 'contract_award'
    and al.status = 'adopted'
    and (al.org_node_id is null or anc.node_id is not null)
  order by (al.org_node_id is not null) desc, anc.depth asc nulls last, al.version desc
  limit 1;

  if not found then
    if exists (select 1 from authority_limits
                where organization_id = p_org and role_key = p_role
                  and action_type = 'contract_award' and status = 'adopted') then
      return jsonb_build_object('permitted', false, 'refusal', format(
        'Delegation of authority: every adopted contract-award delegation for %s is scoped to one organization node, and this case sits outside every such subtree. Escalate, or adopt a delegation covering this node.',
        p_role));
    end if;
    return jsonb_build_object('permitted', false, 'refusal', format(
      'Delegation of authority: no adopted contract-award delegation exists for %s in this organization. Awarding a contract commits the owner''s capital to a counterparty and is not a default-permitted act. Adopt a contract-award delegation with a stated ceiling first.',
      p_role));
  end if;

  if l.max_commitment_usd is null then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'refusal', format(
      'Delegation of authority: the adopted %s contract-award delegation for %s states no money ceiling, so authority over a %s award cannot be verified. A blank ceiling is an unfinished delegation, not an unlimited one — state it with state_authority_ceiling.',
      l.tier_label, p_role, v_magnitude));
  end if;

  -- The ceiling states its own currency and an award denominated in another
  -- one refuses rather than being compared across units Sync cannot convert
  -- between (4D-R7, restated for the award).
  if p_currency is not null
     and upper(btrim(p_currency)) is distinct from l.max_commitment_currency then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
      'refusal', format(
      'Delegation of authority: this contract is valued in %s and the adopted %s contract-award ceiling for %s is stated in %s. Sync holds no exchange rate, so the two are not compared. State a %s ceiling on the delegation (state_authority_ceiling), or award in %s.',
      upper(btrim(p_currency)), l.tier_label, p_role, l.max_commitment_currency,
      upper(btrim(p_currency)), l.max_commitment_currency));
  end if;

  -- 4D-R8, APPLIED TO THE AWARD: THE CEILING IS CUMULATIVE, NOT PER CONTRACT.
  -- sync_contingency_authority already carries the reasoning verbatim — "a
  -- delegation ceiling that can be defeated by pressing the button twice is
  -- not a ceiling" — and this slice shipped without it. Proven live: one
  -- maintenance_manager holding a single adopted CAD 750,000 contract-award
  -- delegation awarded 640,000 + 640,000 + 200,000 on ONE development case,
  -- CAD 1,480,000 in total, every award individually "within authority".
  -- Splitting one procurement across two packages defeated the delegation
  -- entirely.
  --
  -- The measure is THIS awarder's awards on THIS case, which is what a
  -- delegation instrument means by "a project": the case is the unit the
  -- business case, the cost model, the contingency pool and the gates are all
  -- scoped to. Awards in another currency are excluded from the sum rather
  -- than converted — Sync holds no exchange rate — and they are NAMED, because
  -- a silently-excluded award is a hole in the same ceiling.
  if p_case_id is not null and p_awarder is not null then
    select coalesce(sum(cp.awarded_value), 0) into v_committed
    from contract_packages cp
    where cp.organization_id = p_org
      and cp.development_case_id = p_case_id
      and cp.awarded_by = p_awarder
      and cp.awarded_at is not null
      and cp.contract_currency is not distinct from l.max_commitment_currency;
    if v_committed > 0 and v_committed + v_magnitude > l.max_commitment_usd then
      return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
        'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
        'alreadyAwarded', v_committed, 'escalatesTo', l.escalates_to_role,
        'refusal', format(
        'Delegation of authority: you have already awarded %s %s of contracts on this case under the %s contract-award ceiling of %s %s, so a further %s would take your total to %s. The ceiling is what you may commit on one project, not what you may commit per contract — splitting a procurement across two packages is not a way through it. Escalate to %s.',
        l.max_commitment_currency, v_committed, l.tier_label,
        l.max_commitment_currency, l.max_commitment_usd, v_magnitude,
        v_committed + v_magnitude, coalesce(l.escalates_to_role, 'the board')));
    end if;
  end if;

  if v_magnitude > l.max_commitment_usd then
    return jsonb_build_object('permitted', false, 'limitId', l.id, 'tierLabel', l.tier_label,
      'ceiling', l.max_commitment_usd, 'escalatesTo', l.escalates_to_role,
      'refusal', format(
      'Delegation of authority: a contract valued at %s exceeds the %s contract-award ceiling of %s for %s. Escalate to %s.',
      v_magnitude, l.tier_label, l.max_commitment_usd, p_role,
      coalesce(l.escalates_to_role, 'the board')));
  end if;

  return jsonb_build_object('permitted', true, 'limitId', l.id, 'tierLabel', l.tier_label,
    'ceiling', l.max_commitment_usd, 'ceilingCurrency', l.max_commitment_currency,
    'magnitude', v_magnitude, 'alreadyAwarded', v_committed,
    'headroom', l.max_commitment_usd - v_committed - v_magnitude,
    'escalatesTo', l.escalates_to_role);
end
$$;

revoke all on function public.sync_contract_award_authority(uuid, text, numeric, text, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.sync_contract_award_authority(uuid, text, numeric, text, uuid, uuid) is
  'D6.05 / spec §41-43: resolves the adopted contract-award delegation for a role and checks a contract value against its ceiling. THE SAME authority_limits store the sanction, the waiver, the contingency drawdown and the change approval all ride — a new action_type, never a parallel store. Absence refuses, a null ceiling refuses, a ceiling in another currency refuses rather than converting, and the ceiling is CUMULATIVE against this awarder''s awards on this case (4D-R8) — a delegation that can be defeated by splitting one procurement across two packages is not a delegation.';

-- ---------------------------------------------------------------------------
-- 4. THE AWARD ACT.
-- ---------------------------------------------------------------------------
create or replace function public.award_contract(
  p_package_id bigint,
  p_award jsonb
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
  b contract_bids%rowtype;
  s suppliers%rowtype;
  v_bid_id bigint := sync_text_as_int(p_award->>'bid_id');
  v_type text := lower(nullif(btrim(coalesce(p_award->>'contract_type','')), ''));
  v_perf text := nullif(btrim(coalesce(p_award->>'performance_requirements','')), '');
  v_basis text := nullif(btrim(coalesce(p_award->>'award_basis','')), '');
  v_start date;
  v_finish date;
  v_warranty bigint := sync_text_as_int(p_award->>'warranty_term_id');
  v_live int;
  v_total int;
  v_missing text;
  v_unassessed text;
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
      'awarding a contract is a §70 human act: it commits the owner''s capital to a counterparty and, with it, what the project will legally be able to demand. The AI may normalise the bids, list the qualifications and draft the recommendation; a named person with a delegated authority makes the award.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'awarding a contract requires a management or executive role holding an adopted contract-award delegation');
  end if;

  -- FOR UPDATE. Without the lock two overlapping transactions each read
  -- `awarded_at is null`, each ran the whole door, and each returned a full
  -- success payload — two different suppliers were told they had won, at their
  -- own prices, and the second write overwrote the first. The table wall now
  -- refuses the second write outright (enforce_procurement_package_integrity's
  -- frozen-award arm), but a caller should read the SENTENCE below rather than
  -- a trigger's exception, so the row is locked and the check is made behind
  -- the lock.
  select * into p from contract_packages
   where id = p_package_id and organization_id = v_org
   for update;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is not null then
    return jsonb_build_object('error', format(
      'package %s was awarded on %s. An award is made once; a change to an awarded contract is a change order (spec §21), not a second award.',
      p.package_code, p.awarded_at));
  end if;
  if p.bids_opened_at is null then
    return jsonb_build_object('error', format(
      'bids on package %s have not been opened. A contract awarded before the envelope is opened is awarded on prices nobody has seen.',
      p.package_code));
  end if;

  -- REFUSAL-FIRST: a package with NO BIDS refuses. Reporting a count of zero
  -- evaluated bids instead would read as an evaluation that ran and found
  -- nothing better, which is the opposite of what happened.
  select count(*) filter (where withdrawn_at is null), count(*)
    into v_live, v_total from contract_bids where package_id = p.id;
  if coalesce(v_live, 0) = 0 then
    return jsonb_build_object('error', format(
      'no live bid exists on package %s (%s received, %s withdrawn). There is nothing to award. A package with no bids is not a package whose bids were evaluated — re-issue the tender, or record a single-source justification and award through a package that has one.',
      p.package_code, v_total, v_total - v_live));
  end if;

  if v_bid_id is null then
    return jsonb_build_object('error',
      'name the winning bid (bid_id). An award names the offer it accepts, or the contract has no price anybody submitted.');
  end if;
  select * into b from contract_bids
   where id = v_bid_id and package_id = p.id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'that bid is not on this package');
  end if;
  if b.withdrawn_at is not null then
    return jsonb_build_object('error', format(
      'that bid was withdrawn on %s. A withdrawn offer is no longer on the table.', b.withdrawn_at));
  end if;
  -- AN OFFER WITH NO STATED CURRENCY IS NOT COMPARED TO A CEILING.
  -- `contract_bids.currency` is nullable and every pre-Slice-6A row carries
  -- NULL, and the ceiling's own currency gate is `if p_currency is not null
  -- and …` — so a NULL-currency bid skipped the currency check entirely and
  -- was compared as a bare number against a ceiling stated in CAD. Refused
  -- here, beside the withdrawn-bid check, rather than dying later on
  -- contract_package_section24_complete as a raw CHECK violation.
  if b.currency is null or btrim(b.currency) = '' then
    return jsonb_build_object('error', format(
      'bid %s states no currency. An award ceiling is an amount in a currency and Sync holds no exchange rate, so an offer with no stated unit cannot be checked against one — it would be compared as a bare number against a ceiling denominated in something else, and the currency gate on the delegation would be skipped entirely. Re-lodge the bid through submit_sealed_bid, which requires it.',
      coalesce(b.bid_ref, b.id::text)));
  end if;

  -- BOTH EVALUATIONS, OR NAME THE MISSING ONE. Spec I.16 makes the technical
  -- and the commercial evaluation separate objects precisely so a technically
  -- non-compliant bid cannot win on price.
  select string_agg(k, ' and ' order by k) into v_missing
  from unnest(sync_bid_evaluation_kinds()) k
  where not exists (select 1 from bid_evaluations e
                     where e.bid_id = b.id and e.evaluation_kind = k);
  if v_missing is not null then
    return jsonb_build_object('error', format(
      'the winning bid on %s has no %s evaluation. Spec I.16 makes the technical and the commercial evaluation separate objects because they are separate judgements: awarding without one of them is awarding on the other alone.',
      p.package_code, v_missing));
  end if;
  if exists (select 1 from bid_evaluations e
              where e.bid_id = b.id and e.outcome = 'non_compliant') then
    return jsonb_build_object('error', format(
      'the winning bid on %s was evaluated NON-COMPLIANT (%s). Awarding it overrules the evaluation that was recorded to prevent exactly this; if the evaluation was wrong, that is a matter for a re-tender, not for the award.',
      p.package_code,
      (select string_agg(e.evaluation_kind || ': ' || e.rationale, '; ' order by e.evaluation_kind)
         from bid_evaluations e where e.bid_id = b.id and e.outcome = 'non_compliant')));
  end if;

  -- SEPARATION OF DUTIES, named at the door. Also enforced at the table for
  -- every writer by enforce_award_separation_of_duties.
  if exists (select 1 from bid_evaluations e
              where e.package_id = p.id and e.evaluator_id = auth.uid()) then
    return jsonb_build_object('error', format(
      'you evaluated a bid on package %s. An award is a decision taken on somebody else''s assessment — one person doing both is what makes a competitive tender ceremonial. Route the award to somebody who did not evaluate.',
      p.package_code));
  end if;

  if v_type is null or not (v_type = any (sync_contract_types())) then
    return jsonb_build_object('error', format(
      'contract_type must be one of: %s (spec I.17)', array_to_string(sync_contract_types(), ', ')));
  end if;
  if v_perf is null or length(v_perf) < 20 then
    return jsonb_build_object('error',
      'state the performance requirements (20 characters minimum). Spec §24 names this field because a contract with nothing to achieve has nothing to hold the counterparty to, and D9.02''s operational performance warranty has nothing to reference.');
  end if;
  if v_basis is null or length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state why this bid is the award (award_basis, 20 characters minimum) — the sentence somebody reads in two years when the contract is in dispute');
  end if;
  begin
    v_start := nullif(btrim(coalesce(p_award->>'contract_start_date','')), '')::date;
    v_finish := nullif(btrim(coalesce(p_award->>'contract_completion_date','')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'contract_start_date or contract_completion_date is not a date');
  end;
  if v_start is null or v_finish is null then
    return jsonb_build_object('error',
      'a §24 contract states its start and its completion. Without them nothing downstream can say whether the package is late, and the mandatory long-lead gate blocker has no date to measure against.');
  end if;
  if v_finish < v_start then
    return jsonb_build_object('error', 'the contract completes before it starts');
  end if;
  if v_warranty is not null and not exists (
       select 1 from warranty_terms w where w.id = v_warranty and w.organization_id = v_org) then
    return jsonb_build_object('error',
      'that warranty term does not exist in this organization');
  end if;

  select * into s from suppliers where id = b.supplier_id;

  -- THE AUTHORITY. Checked against the value of the offer being accepted, in
  -- the currency the offer was made in.
  v_auth := sync_contract_award_authority(v_org, v_role, b.price, b.currency,
                                          p.development_case_id, auth.uid());
  if (v_auth->>'permitted')::boolean is not true then
    -- An award refused for want of authority is a security-relevant attempt on
    -- the owner's capital, recorded the way the sanction path records one.
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values (v_org, auth.uid(), coalesce(v_role, 'unknown'), 'admin_action', 'warning',
      format('Contract award on package %s (%s %s to %s) refused: %s',
             p.package_code, coalesce(b.currency, ''), b.price, coalesce(s.name, 'unknown'),
             v_auth->>'refusal'));
    return jsonb_build_object('error', v_auth->>'refusal',
      'ceiling', v_auth->'ceiling', 'tierLabel', v_auth->'tierLabel',
      'escalatesTo', v_auth->'escalatesTo');
  end if;

  -- READ OFF THE ROW, NEVER HARD-CODED. `'awarded_at', null` asserted in every
  -- award audit row that the package had been unawarded beforehand, so the
  -- ledger could not have shown a second award overwriting a live one even
  -- when one happened.
  v_prev := jsonb_build_object('awarded_at', p.awarded_at,
    'awarded_supplier_id', p.awarded_supplier_id,
    'awarded_value', p.awarded_value, 'commercial_status', p.commercial_status);

  -- THE FIELD THAT WAS NEVER ASSESSED, NAMED. Both evaluation checks above are
  -- scoped to the NOMINATED bid, so a three-bid tender could be awarded to the
  -- dearest offer with the two cheaper ones never opened for assessment — no
  -- refusal, no warning, nothing in the ledger. Given this file's own framing
  -- ("so a technically non-compliant bid cannot win on price"), an unassessed
  -- field is the same failure from the other direction. It does not refuse the
  -- award — a single-source or a clearly non-responsive field is a real state
  -- — but it is stated in the response and written into the award audit row,
  -- so "we only ever scored the one we wanted" is visible afterwards.
  select string_agg(coalesce(ob.bid_ref, ob.id::text) || ' (' || os.name || ')',
                    '; ' order by ob.id)
    into v_unassessed
  from contract_bids ob
  join suppliers os on os.id = ob.supplier_id
  where ob.package_id = p.id and ob.withdrawn_at is null and ob.id <> b.id
    and not exists (select 1 from bid_evaluations e where e.bid_id = ob.id);

  perform set_config('app.procurement_package_write', 'granted', true);
  update contract_packages
     set awarded_at = now(),
         awarded_by = auth.uid(),
         awarded_bid_id = b.id,
         awarded_supplier_id = b.supplier_id,
         awarded_value = b.price,
         contract_currency = b.currency,
         contract_type = v_type,
         contract_start_date = v_start,
         contract_completion_date = v_finish,
         performance_requirements = v_perf,
         warranty_term_id = coalesce(v_warranty, warranty_term_id),
         award_basis = v_basis,
         award_authority_limit_id = (v_auth->>'limitId')::uuid,
         commercial_status = 'awarded',
         status_updated_at = now()
   where id = p.id;
  perform set_config('app.procurement_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_award', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'bid_id', b.id),
    v_prev,
    jsonb_build_object('awarded_supplier', s.name, 'awarded_value', b.price,
      'currency', b.currency, 'contract_type', v_type,
      'contract_start_date', v_start, 'contract_completion_date', v_finish,
      'performance_requirements', v_perf, 'award_basis', v_basis,
      'authority_limit_id', v_auth->>'limitId', 'tier_label', v_auth->>'tierLabel',
      'ceiling', (v_auth->>'ceiling')::numeric,
      'alreadyAwardedOnCase', v_auth->'alreadyAwarded',
      'unevaluatedLiveBids', v_unassessed, 'awarded_by', auth.uid()));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'supplier', s.name, 'value', b.price, 'currency', b.currency,
    'contractType', v_type, 'contractStart', v_start, 'contractCompletion', v_finish,
    'awardedUnder', v_auth->'tierLabel', 'ceiling', v_auth->'ceiling',
    'alreadyAwardedOnCase', v_auth->'alreadyAwarded',
    'unevaluatedLiveBids', v_unassessed,
    'unevaluatedFieldNote', case when v_unassessed is not null then format(
      'This award was made while %s live bid(s) on %s carried NO evaluation at all: %s. Both evaluations were checked on the bid that won and on nothing else, so the field this award was chosen from was never assessed. That is recorded on the award.',
      (select count(*) from contract_bids ob where ob.package_id = p.id
        and ob.withdrawn_at is null and ob.id <> b.id
        and not exists (select 1 from bid_evaluations e where e.bid_id = ob.id)),
      p.package_code, v_unassessed) end,
    'warrantyLinked', coalesce(v_warranty, p.warranty_term_id) is not null,
    'warrantyGap', case when coalesce(v_warranty, p.warranty_term_id) is null then
      'This contract references no warranty term. Spec §24 lists warranty_terms as a field of the Contract; warranty_terms (20260817140000) is where it lives, and a contract with none has no recorded remedy when the equipment fails inside its warranty.' end,
    'commitmentNext',
      'The contract value is not yet a commitment in the controls model. Record its commitment lines against this case''s cost items (record_contract_commitment_line) and approve them (approve_contract_commitments) — the approval is what moves project_cost_items.commitment, and until then the cost reconciliation reports this contract as uncommitted.');
end
$$;

revoke all on function public.award_contract(bigint, jsonb) from public, anon, service_role;
grant execute on function public.award_contract(bigint, jsonb) to authenticated;

comment on function public.award_contract(bigint, jsonb) is
  'D6.05/D6.08 / spec I.16 + III.§24 + §41-43 + §70: THE AWARD. Routed through authority_limits.action_type = contract_award and refused above the ceiling BY NAME (with a security_events row on the refusal); refused before the envelope is opened; REFUSED over zero bids rather than reporting "0 bids evaluated"; refused when the winning bid lacks a technical or a commercial evaluation, naming the missing one; refused when either evaluation said non_compliant; refused when the awarder evaluated any bid on the package (also enforced at the table); refused for the AI-operator identity by name. Writes the full §24 field set, which the schema then holds all-or-none.';

-- ---------------------------------------------------------------------------
-- 5. THE COMMITMENT, INTO SLICE 4'S COST MODEL.
--
--    §23's CostItem already has a `commitment` column and project_cost_items
--    is its home (D5.29 ✅). A commitment line here is the LINK between a
--    contract and one coded cost line; approving them SUMS onto that line
--    through record_cost_item's own door. There is no second commitment total.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_commitment_lines (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  -- CASCADE AT THE CONSTRAINT, REFUSED AT THE WALL. RESTRICT here was the
  -- first draft and it made a development case PERMANENTLY undeletable once
  -- any contract committed against it: deleting the case cascades to
  -- project_cost_items and to contract_packages, Postgres does not promise an
  -- order between those two referential actions, and a RESTRICT reached first
  -- aborts the whole delete. So the constraint cascades and
  -- enforce_commitment_line_integrity refuses the delete BY NAME whenever the
  -- development case is still there — which is every direct delete of a cost
  -- line a contract commits against — while a genuine mid-cascade teardown
  -- (the case itself going) passes. Same protection, no dead end.
  cost_item_id uuid not null references project_cost_items(id) on delete cascade,
  line_ref text not null check (btrim(line_ref) <> ''),
  description text not null check (length(btrim(description)) >= 5),
  -- NULLABLE ON PURPOSE. A contract line whose price is not yet agreed is a
  -- real state; recording it as zero would make the commitment total look
  -- complete. The TOTAL refuses while any line is unpriced, and NAMES it.
  amount numeric,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  basis text not null check (length(btrim(basis)) >= 10),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  posted_at timestamptz,
  unique (package_id, line_ref),
  constraint commitment_line_amount_sane check (
    amount is null
    or (amount <> 'NaN'::numeric
        and amount > '-Infinity'::numeric
        and amount < 'Infinity'::numeric
        and amount >= 0)),
  -- TWO EQUALITIES, NOT ONE. Folded into a conjunction, `approved_at = now(),
  -- approved_by = null` passes — and the actor column is exactly what the §70
  -- wall reads, where a NULL actor is an early return.
  constraint commitment_line_approval_actor check (
    (approved_at is null) = (approved_by is null)),
  constraint commitment_line_approval_note check (
    (approved_at is null) = (approval_note is null)),
  constraint commitment_line_approval_said_something check (
    approval_note is null or length(btrim(approval_note)) >= 20)
);

create index if not exists idx_commitment_lines_package
  on contract_commitment_lines(organization_id, package_id);
create index if not exists idx_commitment_lines_cost_item
  on contract_commitment_lines(cost_item_id);

alter table public.contract_commitment_lines enable row level security;
drop policy if exists commitment_lines_read on public.contract_commitment_lines;
create policy commitment_lines_read on public.contract_commitment_lines
  for select to authenticated using (organization_id = app_current_org());

comment on table public.contract_commitment_lines is
  'D6.05 / spec I.16 Commitment × §23 CostItem: what one contract commits, line by line, against the CODED cost lines of Slice 4''s controls model. Approving the lines writes their sum onto project_cost_items.commitment through record_cost_item''s own door — there is no second commitment total, and the controls reconciliation, the earned-value suite and the contingency ledger all read the one number.';

-- §70. Approving a commitment is a human act.
drop trigger if exists trg_commitment_approver_is_human on public.contract_commitment_lines;
create trigger trg_commitment_approver_is_human
  before insert or update on public.contract_commitment_lines
  for each row execute function public.enforce_procurement_act_is_human(
    'approved_by', 'approve a commitment');

create or replace function public.enforce_commitment_line_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.commitment_line_write', true), '');
  v_client boolean := auth.uid() is not null;
  p contract_packages%rowtype;
  ci project_cost_items%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_commitment_lines is what every committed figure in the controls model is summed from. Truncating it detaches every posted commitment from the contract that produced it while the money stays on the cost lines. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE, in three shapes: the organization, the contract, or the
    -- DEVELOPMENT CASE the contract belongs to is already gone. The third is
    -- what makes a case teardown work, and it is the one a naive guard misses:
    -- the case delete cascades to project_cost_items and to contract_packages
    -- at once, and whichever arrives here first must not refuse.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from contract_packages where id = old.package_id)
       or not exists (
            select 1 from contract_packages p2
            join development_cases dc on dc.id = p2.development_case_id
            where p2.id = old.package_id) then
      return old;
    end if;
    raise exception
      'Commitment line % is %. Deleting it — or deleting the cost line it commits against — removes the contract''s side of a figure the controls model still carries, and the reconciliation would then show committed money that no contract explains. Record a change order instead.',
      old.line_ref,
      case when old.posted_at is not null then 'posted to the controls model'
           else 'recorded against an awarded contract' end
      using errcode = 'insufficient_privilege';
  end if;

  select * into p from contract_packages where id = new.package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this commitment line is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;
  select * into ci from project_cost_items where id = new.cost_item_id;
  if not found or ci.organization_id <> new.organization_id then
    raise exception
      'this commitment line is stamped with an organization that does not own its cost line'
      using errcode = 'check_violation';
  end if;
  -- THE CONTRACT AND THE COST LINE ARE ON THE SAME CASE. A commitment posted
  -- to another case's cost line moves money on a project the contract has
  -- nothing to do with, and both reconciliations then report a figure the
  -- other one explains.
  if p.development_case_id is null or ci.development_case_id <> p.development_case_id then
    raise exception
      'commitment line % commits contract % against a cost line on a different development case. A commitment sits on the case the contract belongs to, or two projects each report money the other one spent.',
      new.line_ref, p.package_code
      using errcode = 'check_violation';
  end if;
  -- ONE CURRENCY. Sync holds no exchange rate: a commitment stated in another
  -- currency than the cost line it moves is a total whose difference is an
  -- exchange rate reported as a project figure.
  if new.currency is distinct from ci.currency then
    raise exception
      'commitment line % is stated in % and the cost line it commits against is in %. Sync holds no exchange rate, so summing them would report an exchange difference as committed cost.',
      new.line_ref, new.currency, ci.currency
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A commitment line is recorded through record_contract_commitment_line and approved through approve_contract_commitments — the approval is a §70 human act that moves money in the controls model. A direct write does it with no role check, no audit row and no §70 wall behind the approver.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      format('Commitment line %s on package %s', new.line_ref, p.package_code), tg_op,
      'A commitment line written outside the RPCs can be born approved and posted, which moves project_cost_items.commitment with nobody named as the approver.');
  end if;

  if tg_op = 'INSERT' and (new.approved_at is not null or new.posted_at is not null) then
    raise exception
      'A commitment line is recorded UNAPPROVED and approved afterwards by a named person. A line that arrives already approved records an approval nobody gave.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.approved_at is not null
       and (new.amount is distinct from old.amount
            or new.cost_item_id is distinct from old.cost_item_id
            or new.currency is distinct from old.currency
            or new.package_id is distinct from old.package_id) then
      raise exception
        'Commitment line % was approved on %. Its amount and the cost line it commits against are frozen: changing them would move committed money with the original approval still standing behind the new figure.',
        old.line_ref, old.approved_at
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_commitment_line_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_commitment_line_integrity on public.contract_commitment_lines;
create trigger trg_commitment_line_integrity
  before insert or update or delete on public.contract_commitment_lines
  for each row execute function public.enforce_commitment_line_integrity();

drop trigger if exists trg_commitment_line_no_truncate on public.contract_commitment_lines;
create trigger trg_commitment_line_no_truncate
  before truncate on public.contract_commitment_lines
  for each statement execute function public.enforce_commitment_line_integrity();

revoke truncate on table public.contract_commitment_lines
  from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5b. ONE WRITER FOR `project_cost_items.commitment`.
--
--     This slice did not extend Slice 4A's cost model — it added a SECOND
--     WRITER to the same column, and the two overwrote each other:
--
--       * approve_contract_commitments sets `commitment` to the sum of the
--         approved contract lines pointing at the cost line;
--       * record_cost_item (20261130090200:451) sets `commitment = v_parsed[2]`
--         unconditionally on every revise, and an OMITTED `commitment` key
--         parses to NULL.
--
--     Proven live: after the approval posted 640,000, a planner re-called
--     record_cost_item on the same ref changing only the DESCRIPTION and
--     `commitment` went 640,000 → NULL, while contract_commitment_lines still
--     reported `postedTotal 640000, approvedLines 1` and the panel still said
--     "3 posted to the cost model". There was no repair path:
--     approve_contract_commitments answers "every commitment line on this
--     contract is already approved and posted" and
--     record_contract_commitment_line answers "line L1 was approved on … and
--     is frozen". The controls reconciliation, the earned-value suite and the
--     contingency ledger all read `ci.commitment`, so they were permanently
--     short by the whole contract value with nothing flagging it.
--
--     Register row D6.05 says "there is no second commitment total anywhere",
--     which was true of TOTALS and false of WRITERS — and the writer is the
--     property that matters.
--
--     The fix makes the column DERIVED for exactly the rows a contract commits
--     against: while approved contract commitment lines point at a cost line,
--     their sum IS its commitment. An omitted value is not a clearance, and a
--     STATED disagreement is refused BY NAME rather than silently losing to
--     whichever writer ran last. A cost line no contract commits against is
--     untouched and Slice 4A remains its only writer.
--
--     A trigger rather than an edit to record_cost_item, because the column has
--     more than one caller and a rule enforced in one door is a rule the other
--     writers do not have. It is named to sort AFTER trg_cost_item_coding, so
--     the coding trigger's own derivation runs first.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_cost_item_contract_commitment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committed numeric;
  v_contracts text;
begin
  select sum(cl.amount) into v_committed
  from contract_commitment_lines cl
  where cl.cost_item_id = new.id and cl.approved_at is not null;

  -- No contract commits against this line: Slice 4A owns the column, exactly
  -- as it did before this slice existed.
  if v_committed is null then
    return new;
  end if;

  if new.commitment is not null and new.commitment is distinct from v_committed then
    select string_agg(distinct p.package_code, ', ' order by p.package_code)
      into v_contracts
    from contract_commitment_lines cl
    join contract_packages p on p.id = cl.package_id
    where cl.cost_item_id = new.id and cl.approved_at is not null;
    raise exception
      'Cost line % carries % of APPROVED contract commitment from contract(s) %, and its commitment figure is what those contracts oblige the owner to pay — it is not typed on this line. Writing % here would leave the cost model and the contracts disagreeing about the same money, with no way to tell which number a reconciliation was reading. Change the contract (a change order, spec §21) and the commitment follows.',
      new.cost_item_ref, v_committed, v_contracts, new.commitment
      using errcode = 'check_violation';
  end if;

  -- OMITTED IS NOT CLEARED. record_cost_item writes NULL for every money field
  -- its payload leaves out; on a line a contract commits against that is a
  -- silent erasure of the contract's own figure, so the derived value stands.
  new.commitment := v_committed;
  return new;
end
$$;

revoke all on function public.enforce_cost_item_contract_commitment()
  from public, anon, authenticated;

drop trigger if exists trg_cost_item_contract_commitment on public.project_cost_items;
create trigger trg_cost_item_contract_commitment
  before update on public.project_cost_items
  for each row execute function public.enforce_cost_item_contract_commitment();

comment on function public.enforce_cost_item_contract_commitment() is
  'D6.05 × D5.29: makes `project_cost_items.commitment` SINGLE-WRITER for every cost line an approved contract commitment points at. Slice 6A shipped a second writer beside record_cost_item''s and the two overwrote each other — a cosmetic description edit through the Controls surface silently wiped a posted 640,000 commitment, unrepairable through the product, while the contract still reported it as posted. An omitted value no longer clears the figure and a stated disagreement is refused by name.';

create or replace function public.record_contract_commitment_line(
  p_package_id bigint,
  p_line jsonb
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
  ci project_cost_items%rowtype;
  v_ref text := nullif(btrim(coalesce(p_line->>'line_ref','')), '');
  v_cost_ref text := nullif(btrim(coalesce(p_line->>'cost_item_ref','')), '');
  v_desc text := nullif(btrim(coalesce(p_line->>'description','')), '');
  v_basis text := nullif(btrim(coalesce(p_line->>'basis','')), '');
  v_raw text := nullif(btrim(coalesce(p_line->>'amount','')), '');
  v_amount numeric := sync_finite_money(p_line->>'amount');
  v_existing contract_commitment_lines%rowtype;
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
      'recording a commitment line requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded. A commitment is what a CONTRACT obliges the owner to pay: recording one before an award would put money into the controls model that nobody is contractually committed to.',
      p.package_code));
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'the line needs a line_ref');
  end if;
  if v_desc is null or length(v_desc) < 5 then
    return jsonb_build_object('error', 'the line needs a description (5 characters minimum)');
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state what this line commits and on what evidence (basis, 10 characters minimum)');
  end if;
  if v_cost_ref is null then
    return jsonb_build_object('error',
      'name the coded cost line this commits against (cost_item_ref). Spec §23''s CostItem carries the commitment figure; a commitment with no cost line is a number in a second place.');
  end if;
  select * into ci from project_cost_items
   where organization_id = v_org and development_case_id = p.development_case_id
     and cost_item_ref = v_cost_ref;
  if not found then
    return jsonb_build_object('error', format(
      'cost line %s does not exist on this contract''s development case. Record it first (record_cost_item) — a commitment codes to its own case''s cost breakdown or it is money nobody can reconcile.',
      v_cost_ref));
  end if;
  -- A STATED AMOUNT MUST BE A NUMBER; AN OMITTED ONE IS A REAL STATE. The
  -- distinction matters: '' means "not agreed yet" and is kept as NULL so the
  -- total can refuse and name it, while 'NaN' or '-5' is a bad number and is
  -- refused here.
  if v_raw is not null and (v_amount is null or v_amount < 0) then
    return jsonb_build_object('error', format(
      'the amount is %s; it must be a finite amount of at least zero, or omitted entirely if the price is not yet agreed. NaN and infinity are legal numeric values in Postgres — NaN is not less than zero and turns every downstream total into NaN — so they are refused before the number reaches the controls model.',
      v_raw));
  end if;

  -- THE LOOKUP AND ITS REFUSAL COME BEFORE THE MARKER. Granted first and never
  -- cleared, the marker opened the wall for the whole transaction — so a call
  -- that REFUSED here left `app.commitment_line_write = 'granted'` standing,
  -- and record_procurement_service_write went silent with it.
  select * into v_existing from contract_commitment_lines
   where package_id = p.id and line_ref = v_ref;
  v_revising := found;
  if v_revising then
    if v_existing.approved_at is not null then
      return jsonb_build_object('error', format(
        'commitment line %s was approved on %s and is frozen. Changing an approved commitment leaves the original approval standing behind a different figure; record a change order instead.',
        v_ref, v_existing.approved_at));
    end if;
    v_prev := jsonb_build_object('amount', v_existing.amount,
      'cost_item_ref', v_cost_ref, 'description', v_existing.description);
    perform set_config('app.commitment_line_write', 'granted', true);
    update contract_commitment_lines
       set cost_item_id = ci.id, description = v_desc, amount = v_amount,
           currency = ci.currency, basis = v_basis
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.commitment_line_write', 'granted', true);
    insert into contract_commitment_lines
      (organization_id, package_id, cost_item_id, line_ref, description,
       amount, currency, basis, recorded_by)
    values (v_org, p.id, ci.id, v_ref, v_desc, v_amount, ci.currency, v_basis, auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.commitment_line_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_commitment_line', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'line_id', v_id, 'line_ref', v_ref,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('line_ref', v_ref, 'cost_item_ref', v_cost_ref,
      'amount', v_amount, 'currency', ci.currency, 'basis', v_basis));

  return jsonb_build_object('line_id', v_id, 'line_ref', v_ref,
    'package_code', p.package_code, 'costItemRef', v_cost_ref,
    'amount', v_amount, 'currency', ci.currency, 'priced', v_amount is not null,
    'unpricedNote', case when v_amount is null then
      format('Line %s carries no agreed amount. It is kept as unpriced rather than as zero, and the commitment total for this contract will REFUSE and name it until a price is agreed.', v_ref) end);
end
$$;

revoke all on function public.record_contract_commitment_line(bigint, jsonb) from public, anon;
grant execute on function public.record_contract_commitment_line(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_contract_commitment_line(bigint, jsonb) is
  'D6.05 / spec I.16 Commitment: records one line of what an awarded contract commits, against a CODED cost line of Slice 4''s model. Refuses before the award, refuses a cost line from another case, refuses a non-finite or negative amount, and keeps an unagreed price as NULL rather than as zero — because zero reads as a settled commitment.';

-- ---------------------------------------------------------------------------
-- 6. THE COMMITMENT TOTAL, AND ITS REFUSAL. Used by both the read and the
--    approval, so the number the screen shows and the number the approval
--    posts cannot diverge.
-- ---------------------------------------------------------------------------
create or replace function public.contract_commitment_position(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lines int;
  v_unpriced text;
  v_unpriced_count int;
  v_total numeric;
  v_currency text;
  v_currencies int;
  p contract_packages%rowtype;
begin
  select * into p from contract_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'procurement package not found');
  end if;
  select count(*) into v_lines from contract_commitment_lines where package_id = p_package_id;

  -- REFUSAL-FIRST. Zero lines is not a commitment of zero.
  if coalesce(v_lines, 0) = 0 then
    return jsonb_build_object('answered', false, 'lines', 0, 'total', null,
      'refusal', format(
        'No commitment line has been recorded against contract %s. That is not a commitment of zero: the contract obliges the owner to pay %s and none of it has been coded to a cost line, so every controls figure on this case is currently short by the whole contract value.',
        p.package_code, coalesce(p.awarded_value::text, 'an unrecorded amount')));
  end if;

  select string_agg(line_ref || ' (' || description || ')', '; ' order by line_ref),
         count(*)
    into v_unpriced, v_unpriced_count
  from contract_commitment_lines
  where package_id = p_package_id and amount is null;

  if coalesce(v_unpriced_count, 0) > 0 then
    return jsonb_build_object('answered', false, 'lines', v_lines, 'total', null,
      'unpricedLines', v_unpriced_count,
      'refusal', format(
        '%s of %s commitment lines on contract %s carry no agreed amount: %s. The total is REFUSED rather than summed over the priced lines — a partial sum presented as the contract''s commitment understates it by exactly the amount nobody has agreed yet, and that is the figure the cost reconciliation would then report as complete.',
        v_unpriced_count, v_lines, p.package_code, v_unpriced));
  end if;

  select count(distinct currency), min(currency), sum(amount)
    into v_currencies, v_currency, v_total
  from contract_commitment_lines where package_id = p_package_id;
  if v_currencies > 1 then
    return jsonb_build_object('answered', false, 'lines', v_lines, 'total', null,
      'refusal', format(
        'The commitment lines on contract %s are stated in %s different currencies. Sync holds no exchange rate, so they are not summed.',
        p.package_code, v_currencies));
  end if;

  -- ...AND THE TOTAL IS NOT COMPARED TO THE CONTRACT ACROSS CURRENCIES EITHER.
  -- `variance` and `overCommitted` put v_total — in the LINES' currency, which
  -- record_contract_commitment_line forces to the COST ITEM's — beside
  -- p.awarded_value, which is in the WINNING BID's, and nothing anywhere
  -- required those to be equal. Proven live: a CAD 640,000 contract carrying
  -- one USD 640,000 commitment line reported `variance 0, overCommitted
  -- false`, and approve_contract_commitments — which refuses on that same flag
  -- — approved and posted it. Every other door in this slice refuses a
  -- cross-currency comparison by name; the line-to-line refusal is three lines
  -- above this one.
  if p.awarded_at is not null and v_currency is distinct from p.contract_currency then
    return jsonb_build_object('answered', false, 'lines', v_lines, 'total', null,
      'commitmentCurrency', v_currency, 'contractCurrency', p.contract_currency,
      'refusal', format(
        'The commitment lines on contract %s are stated in %s and the contract was awarded at %s %s. Sync holds no exchange rate, so the committed total is not compared to the contract value across two units — the difference between them would be an exchange rate reported as a contract variance, and "over-committed" would be answered in a currency nobody named. The cost lines this contract commits against are denominated by the case''s business case; award in that currency, or record the commitment against cost lines that match the contract.',
        p.package_code, v_currency, p.contract_currency,
        coalesce(p.awarded_value::text, 'an unrecorded amount')));
  end if;

  return jsonb_build_object('answered', true, 'lines', v_lines, 'total', v_total,
    'currency', v_currency,
    'contractValue', p.awarded_value,
    'variance', case when p.awarded_value is not null then v_total - p.awarded_value end,
    'overCommitted', p.awarded_value is not null and v_total > p.awarded_value,
    'approvedLines', (select count(*) from contract_commitment_lines
                       where package_id = p_package_id and approved_at is not null),
    'postedTotal', (select sum(amount) from contract_commitment_lines
                     where package_id = p_package_id and posted_at is not null));
end
$$;

revoke all on function public.contract_commitment_position(bigint)
  from public, anon, authenticated, service_role;

comment on function public.contract_commitment_position(bigint) is
  'D6.05: the ONE commitment total for a contract, and its refusals. Refuses over zero lines (that is not a commitment of zero), refuses while any line carries no agreed amount and NAMES those lines, refuses a mixed-currency sum, and refuses to compare the total to the CONTRACT VALUE across currencies — a USD 640,000 commitment against a CAD 640,000 contract reported variance 0 and was approved and posted. Read by get_case_procurement and by approve_contract_commitments, so the number on the screen and the number the approval posts cannot diverge. Not client-callable: it takes a package id and has no tenant gate of its own — its callers resolve the tenant first.';

create or replace function public.approve_contract_commitments(
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
  v_position jsonb;
  v_self text;
  r record;
  v_posted int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the table.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'approving a commitment is a §70 human act: it moves money into the figures every controls report is measured against. The AI may assemble the lines and check them against the contract; a named person approves them.');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error',
      'approving a commitment requires a management or executive role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded, so there is no contract to commit against', p.package_code));
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'state what is being approved and against what (note, 20 characters minimum)');
  end if;

  -- SELF-APPROVAL. The person who wrote the lines does not approve them; that
  -- is the same control as the evaluator not awarding, one level down.
  select string_agg(line_ref, ', ' order by line_ref) into v_self
  from contract_commitment_lines
  where package_id = p.id and approved_at is null and recorded_by = auth.uid();
  if v_self is not null then
    return jsonb_build_object('error', format(
      'you recorded commitment line(s) %s on this contract. Approving your own commitment lines is not an approval — route it to somebody who did not record them.',
      v_self));
  end if;

  -- THE ONE TOTAL, AND ITS REFUSALS.
  v_position := contract_commitment_position(p.id);
  if (v_position->>'answered')::boolean is not true then
    return jsonb_build_object('error', v_position->>'refusal',
      'lines', v_position->'lines', 'unpricedLines', v_position->'unpricedLines');
  end if;
  if (v_position->>'overCommitted')::boolean is true then
    return jsonb_build_object('error', format(
      'the commitment lines total %s and contract %s was awarded at %s. Committing more than the contract obliges the owner to pay is a change order (spec §21), not a commitment.',
      v_position->>'total', p.package_code, p.awarded_value),
      'total', v_position->'total', 'contractValue', v_position->'contractValue');
  end if;
  if coalesce((v_position->>'approvedLines')::int, 0) = coalesce((v_position->>'lines')::int, 0) then
    return jsonb_build_object('error',
      'every commitment line on this contract is already approved and posted');
  end if;

  perform set_config('app.commitment_line_write', 'granted', true);
  update contract_commitment_lines
     set approved_by = auth.uid(), approved_at = now(), approval_note = v_note
   where package_id = p.id and approved_at is null;
  perform set_config('app.commitment_line_write', '', true);

  -- POST TO SLICE 4'S COST MODEL. `commitment` on the CODED line becomes the
  -- sum of every approved commitment against it — from THIS contract and any
  -- other. Written through record_cost_item's own door (`app.cost_item_write`,
  -- 20261130090200) so the cost line's own walls, its tenant arm and its
  -- control-account derivation all still run.
  for r in
    select ci.id as cost_item_id, ci.cost_item_ref, ci.commitment as previous_commitment,
           (select sum(cl.amount) from contract_commitment_lines cl
             where cl.cost_item_id = ci.id and cl.approved_at is not null) as committed
    from project_cost_items ci
    where ci.id in (select distinct cost_item_id from contract_commitment_lines
                     where package_id = p.id)
  loop
    -- Slice 4A's own door, and CLEARED IMMEDIATELY: left standing this marker
    -- opens the cost-item wall for the rest of the transaction.
    perform set_config('app.cost_item_write', 'granted', true);
    update project_cost_items set commitment = r.committed where id = r.cost_item_id;
    perform set_config('app.cost_item_write', '', true);
    v_posted := v_posted + 1;
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (v_org, 'project_cost_item', coalesce(v_role, 'unknown'),
      jsonb_build_object('case_id', p.development_case_id,
        'cost_item_id', r.cost_item_id, 'cost_item_ref', r.cost_item_ref,
        'action', 'commitment_posted_from_contract',
        'package_code', p.package_code),
      jsonb_build_object('commitment', r.previous_commitment),
      jsonb_build_object('commitment', r.committed, 'source_contract', p.package_code));
  end loop;

  perform set_config('app.commitment_line_write', 'granted', true);
  update contract_commitment_lines
     set posted_at = now()
   where package_id = p.id and approved_at is not null and posted_at is null;
  perform set_config('app.commitment_line_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_commitment', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'action', 'approved'),
    jsonb_build_object('approvedLines', v_position->'approvedLines'),
    jsonb_build_object('total', v_position->'total', 'currency', v_position->>'currency',
      'costLinesPosted', v_posted, 'approver', auth.uid(), 'note', v_note));

  return jsonb_build_object('package_id', p.id, 'package_code', p.package_code,
    'total', v_position->'total', 'currency', v_position->>'currency',
    'costLinesPosted', v_posted,
    'contractValue', v_position->'contractValue',
    'variance', v_position->'variance',
    'note',
      'The committed figure now sits on project_cost_items.commitment — the ONE cost model. get_case_cost_reconciliation, the earned-value suite and the contingency ledger all read it there; nothing here keeps a second total.');
end
$$;

revoke all on function public.approve_contract_commitments(bigint, text) from public, anon, service_role;
grant execute on function public.approve_contract_commitments(bigint, text) to authenticated;

comment on function public.approve_contract_commitments(bigint, text) is
  'D6.05 / spec I.16 Commitment × §23 CostItem × §70: approves an awarded contract''s commitment lines and POSTS their sum onto project_cost_items.commitment through record_cost_item''s own door. Refuses the AI-operator identity by name, refuses self-approval by the person who recorded the lines, refuses while any line is unpriced (naming it, through the ONE total predicate), and refuses a commitment above the contract value.';

-- ---------------------------------------------------------------------------
-- 7. THE CALCULATION LINEAGE (D11.29). The procurement position produces
--    NUMBERS — a commitment total, a slippage in days, bid counts — so it
--    records a run naming the code version that produced them and every
--    refusal it hit on the way, INCLUDING when it refused entirely.
--
--    Re-declared in FULL from the live 5D definition — the established idiom —
--    with one key added and every prior version kept EXACTLY as it was:
--    bumping a version on unchanged code makes the version stop meaning
--    anything.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
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
    ('case_decision_debt',             'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',          'develop-design/5B/2026-12-05'),
    ('case_ram_profile',               'develop-ram/5D/2026-12-07'),
    ('case_procurement_position',      'develop-procurement/6A/2026-12-08')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. THE READS.
-- ---------------------------------------------------------------------------
create or replace function public.get_package_tender(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p contract_packages%rowtype;
  -- TWO DIFFERENT FACTS, KEPT APART. `v_sealed` governs REDACTION and stays
  -- the conservative rule (nothing is legible until an open act is recorded),
  -- so a bid that reached the table by any route is never exposed. `v_tendered`
  -- is what the word "sealed" MEANS to a reader: a package that was never
  -- issued for tender has no envelope to be sealed, and reporting `sealed:
  -- true` with the note "The envelopes are sealed…" over a package nobody ever
  -- put to market — which is what shipped — describes a tender that does not
  -- exist. The panel rendered "Bids (SEALED)" for it.
  v_sealed boolean;
  v_tendered boolean;
  v_bid_count int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  v_sealed := p.bids_opened_at is null;
  v_tendered := p.bids_close_at is not null;
  select count(*) into v_bid_count from contract_bids where package_id = p.id;

  return jsonb_build_object(
    'packageId', p.id, 'packageCode', p.package_code, 'title', p.title,
    'equipmentOrScope', p.equipment_or_scope,
    'bidsCloseAt', p.bids_close_at, 'bidsOpenedAt', p.bids_opened_at,
    'openedBy', (select email from user_profiles where id = p.bids_opened_by),
    'tendered', v_tendered,
    'sealed', v_sealed and v_tendered,
    'contentSealed', v_sealed,
    'sealNote', case when v_sealed and v_tendered then
      'The envelopes are sealed. Who was invited and who has lodged a bid are visible; no price, hours, duration or qualification is returned until the bids are opened, and the row-level policy hides the bids themselves from every client until the same moment.' end,
    -- REFUSAL-FIRST ON THE BID SIDE, the way the commitment side already does
    -- it. An empty `bids` array meant three different things — not tendered,
    -- tendered and nobody has answered, opened and empty — and returned the
    -- same confident `[]` for all three.
    'bidsRefusal', case
      when not v_tendered then format(
        'Package %s has not been issued for tender, so there are no envelopes: nothing is sealed and nothing has been withheld. Issue it (open_package_bidding) before reading its bids.', p.package_code)
      when v_bid_count = 0 and p.bids_close_at > now() then format(
        'The tender for %s is open until %s and no bid has been lodged yet. That is a tender nobody has answered so far, not a tender that was run and found empty.',
        p.package_code, p.bids_close_at)
      when v_bid_count = 0 then format(
        'The tender for %s closed on %s and NO bid was ever lodged against it. That is not a package whose bids were evaluated and found wanting — the market did not respond, and the reason is worth recording before the package is re-issued or single-sourced.',
        p.package_code, p.bids_close_at)
      end,
    'bidders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bidderId', pb.id, 'supplier', s.name, 'supplierCode', s.supplier_code,
        'status', pb.status,
        'prequalificationStated', pb.prequalification_basis is not null,
        'prequalificationBasis', pb.prequalification_basis,
        'safetyQualificationStatus', s.safety_qualification_status,
        'approvedVendor', s.approved_vendor)
        order by s.name)
      from package_bidders pb join suppliers s on s.id = pb.supplier_id
      where pb.package_id = p.id), '[]'::jsonb),
    -- THE SEAL. Before the open act this list carries the FACT of a submission
    -- and nothing about its content; after it, the bid as submitted. One
    -- expression, so there is no second place the price could leak from.
    'bids', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bidId', b.id, 'bidRef', b.bid_ref, 'supplier', s.name,
        'submittedOn', b.submitted_on,
        'withdrawn', b.withdrawn_at is not null,
        'withdrawnReason', b.withdrawn_reason,
        'sealed', v_sealed,
        'price', case when v_sealed then null else b.price end,
        'currency', case when v_sealed then null else b.currency end,
        'labourHours', case when v_sealed then null else b.labour_hours end,
        'assumedProductivityFactor',
          case when v_sealed then null else b.assumed_productivity_factor end,
        'durationDays', case when v_sealed then null else b.duration_days end,
        'qualifications', case when v_sealed then null else b.qualifications end,
        'priceBasis', case when v_sealed then null else b.price_basis end,
        'evaluations', case when v_sealed then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
            'evaluationId', e.id, 'kind', e.evaluation_kind, 'outcome', e.outcome,
            'score', e.score, 'rationale', e.rationale,
            'evaluator', (select email from user_profiles up where up.id = e.evaluator_id),
            'recordedAt', e.recorded_at) order by e.evaluation_kind)
          from bid_evaluations e where e.bid_id = b.id), '[]'::jsonb) end)
        order by b.id)
      from contract_bids b join suppliers s on s.id = b.supplier_id
      where b.package_id = p.id), '[]'::jsonb),
    'contract', case when p.awarded_at is null then null else jsonb_build_object(
      'awardedAt', p.awarded_at,
      'awardedBy', (select email from user_profiles where id = p.awarded_by),
      'supplier', (select name from suppliers where id = p.awarded_supplier_id),
      'value', p.awarded_value, 'currency', p.contract_currency,
      'contractType', p.contract_type,
      'start', p.contract_start_date, 'completion', p.contract_completion_date,
      'performanceRequirements', p.performance_requirements,
      'awardBasis', p.award_basis,
      'warrantyTermId', p.warranty_term_id,
      'authorityTier', (select tier_label from authority_limits
                         where id = p.award_authority_limit_id),
      'authorityCeiling', (select max_commitment_usd from authority_limits
                            where id = p.award_authority_limit_id)) end,
    'commitment', contract_commitment_position(p.id),
    -- THE LINES THEMSELVES, so the screen renders the commitment position from
    -- the same rows the server summed rather than from a total it has to
    -- trust. `commitmentTotal` (src/lib/develop/procurement.ts) restates the
    -- four refusal conditions of contract_commitment_position over exactly
    -- these rows; the slice test pins the two sets of conditions together.
    'commitmentLines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineRef', cl.line_ref, 'description', cl.description,
        'amount', cl.amount, 'currency', cl.currency,
        'costItemRef', (select ci.cost_item_ref from project_cost_items ci
                         where ci.id = cl.cost_item_id),
        'approved', cl.approved_at is not null,
        'posted', cl.posted_at is not null) order by cl.line_ref)
      from contract_commitment_lines cl where cl.package_id = p.id), '[]'::jsonb));
end
$$;

revoke all on function public.get_package_tender(bigint) from public, anon, service_role;
grant execute on function public.get_package_tender(bigint) to authenticated;

comment on function public.get_package_tender(bigint) is
  'D6.04/D6.05: one package''s tender — its bidder register, its bids, its evaluations, its §24 contract and its commitment position. THE SEAL IS ENFORCED HERE TOO: this is SECURITY DEFINER, so the row-level policy does not constrain it, and every content field of a bid is returned as NULL until the package records an open act. One expression governs all of them, so there is no second place a sealed price could leak from.';

create or replace function public.get_case_procurement(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_packages jsonb;
  v_total int;
  v_mandatory int;
  v_assessable int;
  v_delivery_blind int;
  v_blockers jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*), count(*) filter (where is_mandatory),
         count(*) filter (where is_mandatory and required_date is not null
                            and lead_time_days is not null),
         count(*) filter (where is_mandatory and awarded_at is not null
                            and actual_delivery_date is null
                            and forecast_delivery_date is null
                            and contract_completion_date is null)
    into v_total, v_mandatory, v_assessable, v_delivery_blind
  from contract_packages
  where organization_id = v_org and development_case_id = c.id;

  -- REFUSAL-FIRST. An empty package set is a SENTENCE, never "0 packages late"
  -- — which reads as a procurement position that was assessed and found clean.
  if coalesce(v_total, 0) = 0 then
    return jsonb_build_object('caseId', c.id, 'answered', false,
      'packages', '[]'::jsonb, 'packageCount', 0,
      'refusal',
        'No procurement package has been recorded on this case. That is not "nothing is late": nothing has been described, so nothing can be assessed, and the gate blockers this family raises have no rows to raise them from. Record the packages first.',
      'blockers', '[]'::jsonb, 'blockerCount', 0);
  end if;

  select jsonb_agg(jsonb_build_object(
      'packageId', p.id, 'packageCode', p.package_code, 'title', p.title,
      'equipmentOrScope', p.equipment_or_scope,
      'requiredDate', p.required_date, 'leadTimeDays', p.lead_time_days,
      'awardRequiredBy', case when p.required_date is not null and p.lead_time_days is not null
        then p.required_date - p.lead_time_days end,
      'forecastDeliveryDate', p.forecast_delivery_date,
      'slippageDays', case when p.required_date is not null and p.forecast_delivery_date is not null
        then p.forecast_delivery_date - p.required_date end,
      'isMandatory', p.is_mandatory, 'mandatoryBasis', p.mandatory_basis,
      -- THE FOUR §25 DIMENSIONS, always all four.
      'status', jsonb_build_object(
        'technical', p.technical_status, 'commercial', p.commercial_status,
        'manufacturing', p.manufacturing_status, 'delivery', p.delivery_status),
      'statusUpdatedAt', p.status_updated_at,
      'awarded', p.awarded_at is not null,
      'awardedSupplier', (select name from suppliers where id = p.awarded_supplier_id),
      'awardedValue', p.awarded_value, 'contractCurrency', p.contract_currency,
      'contractType', p.contract_type,
      'bidsCloseAt', p.bids_close_at, 'bidsOpenedAt', p.bids_opened_at,
      -- A PACKAGE NOBODY TENDERED IS NOT "SEALED". `bids_opened_at is null` is
      -- also true of a package that was never issued, so one that had never
      -- been to market came back `sealed: true, bidCount: 0` and the panel
      -- rendered "Bids (SEALED)" over it.
      'tendered', p.bids_close_at is not null,
      'sealed', p.bids_close_at is not null and p.bids_opened_at is null,
      'bidCount', (select count(*) from contract_bids b
                    where b.package_id = p.id and b.withdrawn_at is null),
      'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = p.wbs_element_id),
      -- CRITICAL-PATH EVIDENCE, NOT A SECOND CRITICAL PATH. Sync imports P6's
      -- own float (20261202090000) and does not recompute a network, so this
      -- REPORTS the minimum imported float on the linked WBS element and says
      -- plainly when the schedule carries none. The gate blocker fires on the
      -- declared mandatory flag, never on this.
      'scheduleFloatHours', case when p.wbs_element_id is null then null else
        (select min(t.total_float_hours) from shutdown_tasks t
          where t.wbs_element_id = p.wbs_element_id and t.total_float_hours is not null) end,
      'schedulePositionNote', case
        when p.wbs_element_id is null then
          'This package is not linked to a WBS element, so nothing connects it to the schedule.'
        when not exists (select 1 from shutdown_tasks t
                          where t.wbs_element_id = p.wbs_element_id
                            and t.total_float_hours is not null) then
          'The schedule carries no imported float for this package''s WBS element, so its critical-path position is NOT ASSESSABLE. Sync reads P6''s own float and does not recompute the network; absence of float is not evidence of slack.'
        end,
      'assessable', p.required_date is not null and p.lead_time_days is not null,
      'notAssessableReason', case
        when p.required_date is null and p.lead_time_days is null then
          'Neither a required date nor a lead time is recorded, so the date the award had to happen cannot be computed and this package blocks nothing.'
        when p.required_date is null then
          'No required_date is recorded, so the date the award had to happen cannot be computed and this package blocks nothing.'
        when p.lead_time_days is null then
          'No lead_time_days is recorded, so the date the award had to happen cannot be computed and this package blocks nothing.'
        end,
      -- DELIVERY IS ITS OWN ASSESSABILITY QUESTION, AND IT WAS NEVER ASKED.
      -- `assessable` above answers "can the award-by date be computed"; it
      -- says nothing about whether anybody can tell when this thing will
      -- arrive. Recording a forecast is voluntary, so a MANDATORY awarded
      -- package with no forecast was reported clean by every counter on this
      -- screen while nothing on it was measuring the delivery at all. Named
      -- here rather than counted as on time.
      'deliveryAssessable', p.actual_delivery_date is not null
        or p.forecast_delivery_date is not null
        or p.contract_completion_date is not null,
      'deliveryNotAssessableReason', case
        when p.actual_delivery_date is null
             and p.forecast_delivery_date is null
             and p.contract_completion_date is null then
          case when p.awarded_at is not null then
            'This package is awarded and states neither a forecast delivery date nor a contract completion date, so nothing here can say whether it will arrive when the project needs it. It is NOT ASSESSABLE for lateness — that is not the same as on time.'
          else
            'No forecast delivery date is recorded, so when this package will arrive is NOT ASSESSABLE. Recording a forecast (record_package_delivery_forecast) is what makes the slippage measurable.'
          end
        end,
      'actualDeliveryDate', p.actual_delivery_date,
      'commitment', contract_commitment_position(p.id))
      order by p.is_mandatory desc, p.required_date nulls last, p.package_code)
    into v_packages
  from contract_packages p
  where p.organization_id = v_org and p.development_case_id = c.id;

  v_blockers := case_procurement_gate_obligations(c.id, null);

  return jsonb_build_object('caseId', c.id, 'answered', true,
    'packages', coalesce(v_packages, '[]'::jsonb),
    'packageCount', v_total,
    'mandatoryCount', v_mandatory,
    'mandatoryAssessable', v_assessable,
    'mandatoryNotAssessable', v_mandatory - v_assessable,
    'assessabilityNote', case when v_mandatory - v_assessable > 0 then format(
      '%s of %s mandatory packages cannot be assessed for lateness because a required date or a lead time is missing. They are listed and they block nothing — an alarm wired to a date nobody recorded is worse than no alarm.',
      v_mandatory - v_assessable, v_mandatory) end,
    'mandatoryDeliveryNotAssessable', coalesce(v_delivery_blind, 0),
    'deliveryAssessabilityNote', case when coalesce(v_delivery_blind, 0) > 0 then format(
      '%s mandatory package(s) on this case hold an AWARDED contract but state no forecast delivery date and no contract completion date, so nothing here measures when they will arrive. They raise no blocker and they are not on time — they are NOT ASSESSABLE, and the counters above would otherwise report them as clean.',
      v_delivery_blind) end,
    -- THE SAME ROWS THE GATE REFUSES OVER. Read from the ONE predicate, not
    -- re-derived here, so the screen and the wall cannot disagree — and read
    -- ONCE, so the list and its count can never come from two evaluations.
    'blockers', v_blockers,
    'blockerCount', jsonb_array_length(v_blockers));
end
$$;

revoke all on function public.get_case_procurement(uuid) from public, anon, service_role;
grant execute on function public.get_case_procurement(uuid) to authenticated;

comment on function public.get_case_procurement(uuid) is
  'D6.03/D6.09 / spec I.16 + III.§25: one case''s procurement position — every package with all four §25 status dimensions, its lateness arithmetic, its award and its commitment position. REFUSES over an empty package set rather than reporting "0 packages late", names every mandatory package it cannot assess, and reads its blockers from the ONE predicate the gate refuses over.';

create or replace function public.compute_case_procurement_position(p_case_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_result jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_run uuid;
  v_committed numeric := 0;
  v_currency text;
  v_mixed boolean := false;
  v_pkg jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the procurement position requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_result := get_case_procurement(c.id);

  if (v_result->>'answered')::boolean is not true then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'refusal', 'scope', 'case'));
    v_run := record_calculation_run(c.id, 'case_procurement_position',
      'Counts and date arithmetic over the case''s recorded procurement packages: the award-by date is required_date minus the stated lead time, and slippage is the forecast delivery minus the required date. No number is estimated and nothing is inferred from the schedule.',
      jsonb_build_object('packageCount', 0),
      jsonb_build_array(
        jsonb_build_object('table', 'contract_packages',
          'scope', 'development_case_id = ' || c.id::text)),
      null, v_refusals);
    return v_result || jsonb_build_object('calculationRunId', v_run,
      'codeVersion', sync_calculation_code_version('case_procurement_position'));
  end if;

  -- Every package whose commitment total REFUSED is carried into the lineage
  -- row by name: a run that recorded only the answers would certify a
  -- procurement position whose money half was never computed.
  for v_pkg in select * from jsonb_array_elements(v_result->'packages') loop
    if (v_pkg->'commitment'->>'answered')::boolean is true then
      -- ONE CURRENCY OR NO SUM. Every other door in this slice refuses a
      -- cross-currency addition by name; this one added the per-contract
      -- totals with no check at all and wrote the unlabelled result into
      -- calculation_runs as `committedTotal`.
      if v_currency is null then
        v_currency := v_pkg->'commitment'->>'currency';
      elsif v_currency is distinct from (v_pkg->'commitment'->>'currency') then
        v_mixed := true;
      end if;
      v_committed := v_committed + coalesce((v_pkg->'commitment'->>'total')::numeric, 0);
    elsif (v_pkg->>'awarded')::boolean is true then
      v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
        'reason', v_pkg->'commitment'->>'refusal',
        'scope', v_pkg->>'packageCode'));
    end if;
  end loop;
  if v_mixed then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format(
        'The contracts on this case answered their commitment totals in more than one currency (%s among them). Sync holds no exchange rate, so no case-wide committed total is reported — a single number here would be a sum of two units presented as money.',
        v_currency),
      'scope', 'committedTotal'));
    v_committed := null;
    v_currency := null;
  end if;
  if (v_result->>'mandatoryNotAssessable')::int > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'assessabilityNote', 'scope', 'mandatory packages'));
  end if;
  if coalesce((v_result->>'mandatoryDeliveryNotAssessable')::int, 0) > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'deliveryAssessabilityNote',
      'scope', 'mandatory awarded packages'));
  end if;

  v_run := record_calculation_run(c.id, 'case_procurement_position',
    'Counts and date arithmetic over the case''s recorded procurement packages: the award-by date is required_date minus the stated lead time, and slippage is the forecast delivery minus the required date. The committed total is the sum of the per-contract totals that answered; a contract whose total refused is carried as a refusal rather than counted as zero.',
    jsonb_build_object('packageCount', v_result->'packageCount',
      'mandatoryCount', v_result->'mandatoryCount',
      'mandatoryAssessable', v_result->'mandatoryAssessable'),
    jsonb_build_array(
      jsonb_build_object('table', 'contract_packages',
        'scope', 'development_case_id = ' || c.id::text),
      jsonb_build_object('table', 'contract_commitment_lines',
        'scope', 'package_id in (the case''s packages)'),
      jsonb_build_object('table', 'project_cost_items',
        'scope', 'development_case_id = ' || c.id::text)),
    jsonb_build_object('blockerCount', v_result->'blockerCount',
      'committedTotal', v_committed, 'committedCurrency', v_currency),
    v_refusals);

  return v_result || jsonb_build_object('calculationRunId', v_run,
    'committedTotal', v_committed,
    'committedCurrency', v_currency,
    'codeVersion', sync_calculation_code_version('case_procurement_position'));
end
$$;

revoke all on function public.compute_case_procurement_position(uuid) from public, anon, service_role;
grant execute on function public.compute_case_procurement_position(uuid) to authenticated;

comment on function public.compute_case_procurement_position(uuid) is
  'D6.03/D6.09/D11.29: the same answer as get_case_procurement AND a calculation_runs row — recorded even when the report REFUSED, and carrying every per-contract commitment refusal by package code. Role-gated like every sibling compute_case_*, so a technician cannot mint permanent lineage rows through it.';

notify pgrst, 'reload schema';
