-- ============================================================================
-- Sync Develop — Slice 6B, part 4a of 4.
--   D6.01  VendorQualityRecord (spec I.13 / I.15) — a vendor history that
--          ACCRUES from recorded acts instead of being typed.
--   D6.07  The specification-to-failure-history commercial thread (spec I.16).
--   D6.06  The commercial read: the five lifecycle objects on one screen.
--
-- D6.01 — WHAT THE ROW SAID WAS MISSING. `contract_performance`
-- (20260817140000:297) already carries per-supplier per-period planned and
-- actual hours and cost, rework events, safety incidents and quality escapes.
-- It has NO WRITE PATH: register E7.01 is 🟡, demo-seed only. So this file adds
-- the definer write path and the ACCRUAL — and the accrual is a read over the
-- acts, never a stored score. A stored vendor score is a number somebody chose
-- once; the point of I.15 is that "future procurement gets evidence".
--
-- REFUSAL-FIRST, and the refusal the task names: A VENDOR RECORD WITH NO
-- PERIODS REFUSES. Averaging nothing produces 100% schedule reliability, a 0%
-- rework rate and a productivity factor of 1.00 — a perfect vendor, for a
-- vendor nobody has measured. Every derived ratio here refuses separately too:
-- a rework rate needs hours to divide by, an on-time rate needs deliveries with
-- both dates, and a cost total needs one currency.
--
-- D6.07 — WHAT THE ROW SAID WAS MISSING. The supplier ↔ material ↔ asset ↔
-- failure-mode hops exist and ONE full traversal is live:
-- `get_design_feedback_loop` (20260818090000:350), failure → requirement, on
-- 582 real failures. Missing were the Specification → Bid → Contract hops
-- (those objects had no write paths) and a BOTH-DIRECTIONS surface. Slice 6A
-- gave Bid and Contract their write paths; what remained was the first hop —
-- which specification a package was tendered against — and this file adds it
-- as a LINK over the two canonical stores (`design_requirements` is the ONE
-- requirement table, ruling D4.16), not as a graph store and not as a copy.
--
-- The backward direction is NOT re-implemented. get_specification_failure_thread
-- CALLS get_design_feedback_loop for it. Two traversals over the same hops
-- would disagree the first time either was repaired.
--
-- Canonical reuse: design_requirements, contract_packages, contract_bids,
-- suppliers, material_suppliers, materials, bom_lines, assets, work_orders,
-- contract_performance, supplier_deliveries, warranty_terms, warranty_claims,
-- contract_claims, contract_invoices, contract_change_orders,
-- get_design_feedback_loop, contract_current_value,
-- contract_commitment_position, contract_invoice_position,
-- warranty_cover_position.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. D6.01 — THE CONTRACT PERFORMANCE PERIOD GETS ITS WRITE PATH.
-- ---------------------------------------------------------------------------
alter table public.contract_performance
  add column if not exists basis text,
  add column if not exists recorded_by uuid references auth.users(id);

-- MONEY AND HOURS AT THE TABLE, NOT ONLY AT THE DOOR — the treatment 6A gave
-- contract_packages.awarded_value (20261208090000:220), applied to the four
-- quantities this record is accrued from. record_contract_performance_period
-- refuses non-finite and negative figures, but it is not the only writer this
-- table has: the wall ADMITS-AND-RECORDS a service path, and one row of
-- 'NaN'/'Infinity' through it poisons every derived figure in
-- get_vendor_quality_record — which then answers `answered: true` with
-- productivityFactor NaN and plannedCost Infinity, the refusal-first rule
-- inverted. 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so `>= 0`
-- alone does not keep it out.
alter table public.contract_performance
  drop constraint if exists contract_performance_quantities_finite;
alter table public.contract_performance
  add constraint contract_performance_quantities_finite check (
    (planned_hours is null
       or (planned_hours <> 'NaN'::numeric and planned_hours > '-Infinity'::numeric
           and planned_hours < 'Infinity'::numeric and planned_hours >= 0))
    and (actual_hours is null
       or (actual_hours <> 'NaN'::numeric and actual_hours > '-Infinity'::numeric
           and actual_hours < 'Infinity'::numeric and actual_hours >= 0))
    and (planned_cost is null
       or (planned_cost <> 'NaN'::numeric and planned_cost > '-Infinity'::numeric
           and planned_cost < 'Infinity'::numeric and planned_cost >= 0))
    and (actual_cost is null
       or (actual_cost <> 'NaN'::numeric and actual_cost > '-Infinity'::numeric
           and actual_cost < 'Infinity'::numeric and actual_cost >= 0)));

-- ONE period per supplier per contract per start date. Two rows for the same
-- window double every hour, every cost and every rework event in the accrual.
create unique index if not exists idx_cperf_period
  on contract_performance(organization_id, supplier_id, coalesce(package_id, 0), period_start);

comment on table public.contract_performance is
  'D6.01 / spec I.13 VendorQualityRecord × I.15: what a supplier actually delivered in a period — planned and actual hours and cost, rework events, safety incidents, quality escapes. Written through record_contract_performance_period; READ through get_vendor_quality_record, which accrues the history from these rows rather than storing a score. Overlapping periods for one supplier on one contract are refused, because an overlap double-counts every number in the record.';

create or replace function public.enforce_contract_performance_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.contract_performance_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_overlap text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_performance is the whole measured history of every supplier. Truncating it leaves every vendor record refusing for want of periods, which is honest but irrecoverable. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from suppliers where id = old.supplier_id)
       or (old.package_id is not null
           and not exists (select 1 from contract_packages where id = old.package_id)) then
      return old;
    end if;
    raise exception
      'The performance period % to % is part of this supplier''s measured history. Deleting a period silently IMPROVES the record — the rework events and the safety incidents go with it, and so do the hours they were measured against. Revise it instead.',
      old.period_start, old.period_end
      using errcode = 'insufficient_privilege';
  end if;

  if new.period_end < new.period_start then
    raise exception 'a performance period cannot end before it starts'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from suppliers s
              where s.id = new.supplier_id and s.organization_id <> new.organization_id) then
    raise exception
      'this performance period is stamped with an organization that does not own its supplier'
      using errcode = 'check_violation';
  end if;
  if new.package_id is not null and not exists (
       select 1 from contract_packages p
        where p.id = new.package_id and p.organization_id = new.organization_id) then
    raise exception
      'this performance period is stamped with an organization that does not own its contract'
      using errcode = 'check_violation';
  end if;

  -- OVERLAP, for every writer. Two periods covering the same days double every
  -- number the vendor record accrues, and nothing downstream could tell.
  select string_agg(cp.period_start::text || '–' || cp.period_end::text, ', ')
    into v_overlap
  from contract_performance cp
  where cp.organization_id = new.organization_id
    and cp.supplier_id = new.supplier_id
    and cp.package_id is not distinct from new.package_id
    and (tg_op = 'INSERT' or cp.id <> new.id)
    and daterange(cp.period_start, cp.period_end, '[]')
        && daterange(new.period_start, new.period_end, '[]');
  if v_overlap is not null then
    raise exception
      'This performance period (% to %) overlaps % already recorded for this supplier on this contract. Overlapping periods double every hour, every cost and every rework event the vendor record accrues, and nothing downstream can tell.',
      new.period_start, new.period_end, v_overlap
      using errcode = 'check_violation';
  end if;

  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A performance period is recorded through record_contract_performance_period, which requires a role, states its basis and writes the audit row. A direct write moves a supplier''s measured history with nobody named.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      'A contract performance period', tg_op,
      'A performance period written outside the RPC changes a vendor record with no recorded author.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contract_performance_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_contract_performance_integrity on public.contract_performance;
create trigger trg_contract_performance_integrity
  before insert or update or delete on public.contract_performance
  for each row execute function public.enforce_contract_performance_integrity();

drop trigger if exists trg_contract_performance_no_truncate on public.contract_performance;
create trigger trg_contract_performance_no_truncate
  before truncate on public.contract_performance
  for each statement execute function public.enforce_contract_performance_integrity();

revoke truncate on table public.contract_performance from anon, authenticated, service_role;

create or replace function public.record_contract_performance_period(
  p_package_id bigint,
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
  p contract_packages%rowtype;
  v_from date := sync_text_as_date(p_period->>'period_start');
  v_to date := sync_text_as_date(p_period->>'period_end');
  v_ph numeric := sync_finite_money(p_period->>'planned_hours');
  v_ah numeric := sync_finite_money(p_period->>'actual_hours');
  v_pc numeric := sync_finite_money(p_period->>'planned_cost');
  v_ac numeric := sync_finite_money(p_period->>'actual_cost');
  v_rework int := coalesce(sync_text_as_int(p_period->>'rework_events'), 0);
  v_safety int := coalesce(sync_text_as_int(p_period->>'safety_incidents'), 0);
  v_escapes int := coalesce(sync_text_as_int(p_period->>'quality_escapes'), 0);
  v_basis text := nullif(btrim(coalesce(p_period->>'basis','')), '');
  v_note text := nullif(btrim(coalesce(p_period->>'note','')), '');
  v_existing contract_performance%rowtype;
  v_revising boolean;
  v_prev jsonb;
  v_id bigint;
  v_field text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording contract performance requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  if p.awarded_at is null or p.awarded_supplier_id is null then
    return jsonb_build_object('error', format(
      'package %s is not awarded, so no supplier has performed anything under it. A performance period before the award measures work nobody was contracted to do.',
      p.package_code));
  end if;
  if v_from is null or v_to is null then
    return jsonb_build_object('error',
      'state the period (period_start and period_end) — a measurement with no window is a number nobody can compare');
  end if;
  if v_to < v_from then
    return jsonb_build_object('error', 'the period ends before it starts');
  end if;
  if v_to > current_date then
    return jsonb_build_object('error', format(
      'the period ends on %s, which has not happened yet. A performance period reports what a supplier DID; reporting a window that is still open understates every actual in it and flatters the productivity factor.',
      v_to));
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state where these figures come from (basis, 10 characters minimum) — the timesheet, the progress claim or the report they were read off');
  end if;

  -- NON-FINITE AND NEGATIVE, AT THE DOOR. Every one of these is divided by or
  -- summed into the vendor record; NaN turns the whole record into NaN and a
  -- negative hour makes a productivity factor that reads as excellent.
  foreach v_field in array array['planned_hours','actual_hours','planned_cost','actual_cost'] loop
    if nullif(btrim(coalesce(p_period->>v_field,'')), '') is not null
       and (sync_finite_money(p_period->>v_field) is null
            or sync_finite_money(p_period->>v_field) < 0) then
      return jsonb_build_object('error', format(
        '%s is %s; it must be a finite quantity of at least zero, or omitted. NaN and infinity are legal numeric values in Postgres and every ratio computed from them is NaN.',
        v_field, p_period->>v_field));
    end if;
  end loop;
  if v_rework < 0 or v_safety < 0 or v_escapes < 0 then
    return jsonb_build_object('error',
      'rework events, safety incidents and quality escapes are counts and cannot be negative');
  end if;

  select * into v_existing from contract_performance
   where organization_id = v_org and supplier_id = p.awarded_supplier_id
     and package_id is not distinct from p.id and period_start = v_from;
  v_revising := found;
  if v_revising then
    v_prev := jsonb_build_object('actual_hours', v_existing.actual_hours,
      'actual_cost', v_existing.actual_cost, 'rework_events', v_existing.rework_events,
      'safety_incidents', v_existing.safety_incidents,
      'quality_escapes', v_existing.quality_escapes);
    perform set_config('app.contract_performance_write', 'granted', true);
    update contract_performance
       set period_end = v_to, planned_hours = v_ph, actual_hours = v_ah,
           planned_cost = v_pc, actual_cost = v_ac, rework_events = v_rework,
           safety_incidents = v_safety, quality_escapes = v_escapes,
           note = v_note, basis = v_basis
     where id = v_existing.id
    returning id into v_id;
  else
    v_prev := null;
    perform set_config('app.contract_performance_write', 'granted', true);
    insert into contract_performance
      (organization_id, package_id, supplier_id, period_start, period_end,
       planned_hours, actual_hours, planned_cost, actual_cost,
       rework_events, safety_incidents, quality_escapes, note, basis, recorded_by)
    values (v_org, p.id, p.awarded_supplier_id, v_from, v_to,
            v_ph, v_ah, v_pc, v_ac, v_rework, v_safety, v_escapes,
            v_note, v_basis, auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.contract_performance_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'contract_performance', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'performance_id', v_id,
      'supplier_id', p.awarded_supplier_id,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('period_start', v_from, 'period_end', v_to,
      'planned_hours', v_ph, 'actual_hours', v_ah, 'planned_cost', v_pc,
      'actual_cost', v_ac, 'rework_events', v_rework,
      'safety_incidents', v_safety, 'quality_escapes', v_escapes, 'basis', v_basis));

  return jsonb_build_object('performance_id', v_id, 'package_code', p.package_code,
    'supplierId', p.awarded_supplier_id, 'periodStart', v_from, 'periodEnd', v_to,
    'plannedHours', v_ph, 'actualHours', v_ah,
    'reworkEvents', v_rework, 'safetyIncidents', v_safety,
    'qualityEscapes', v_escapes, 'revised', v_revising,
    'note', 'This period now accrues into the supplier''s quality record (get_vendor_quality_record). Nothing stores a score: the record is derived from periods like this one, so it cannot be typed.');
end
$$;

revoke all on function public.record_contract_performance_period(bigint, jsonb)
  from public, anon;
grant execute on function public.record_contract_performance_period(bigint, jsonb)
  to authenticated, service_role;

comment on function public.record_contract_performance_period(bigint, jsonb) is
  'D6.01 / spec I.13: records or revises ONE measured performance period for the supplier holding an awarded contract. Refuses before the award, refuses a period that has not finished (it would understate every actual in it), refuses non-finite and negative quantities at the door, and refuses a period overlapping one already recorded — an overlap double-counts every number the vendor record accrues.';

-- ---------------------------------------------------------------------------
-- 2. D6.01 — THE ACCRUAL. A READ, never a stored score.
-- ---------------------------------------------------------------------------
create or replace function public.get_vendor_quality_record(p_supplier_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  s suppliers%rowtype;
  v_periods int;
  v_ph numeric; v_ah numeric; v_pc numeric; v_ac numeric;
  v_rework int; v_safety int; v_escapes int;
  v_first date; v_last date;
  v_currencies int; v_currency text; v_uncosted int;
  v_del_total int; v_del_dated int; v_del_ontime int; v_del_rejected int;
  v_wt int; v_wc int; v_wc_accepted int; v_wc_barred int;
  v_wc_claimed numeric; v_wc_recovered numeric; v_wc_currencies int;
  v_wc_uncurrenced int;
  v_contracts int; v_claims int;
  v_cc_from numeric; v_cc_against numeric; v_cc_currencies int; v_cc_currency text;
  v_cost jsonb; v_contract_claims jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into s from suppliers where id = p_supplier_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'supplier not found');
  end if;

  select count(*), sum(planned_hours), sum(actual_hours),
         sum(planned_cost), sum(actual_cost),
         sum(rework_events), sum(safety_incidents), sum(quality_escapes),
         min(period_start), max(period_end)
    into v_periods, v_ph, v_ah, v_pc, v_ac, v_rework, v_safety, v_escapes,
         v_first, v_last
  from contract_performance
  where organization_id = v_org and supplier_id = s.id;

  -- THE REFUSAL THE ROW TURNS ON. A vendor record averaged over nothing reports
  -- a perfect supplier: no rework, no incidents, a productivity factor of 1.00
  -- and a schedule reliability of 100%. That is the number a future
  -- procurement would be handed as evidence.
  if coalesce(v_periods, 0) = 0 then
    return jsonb_build_object('supplierId', s.id, 'supplier', s.name,
      'supplierCode', s.supplier_code, 'answered', false, 'periods', 0,
      'refusal', format(
        'No performance period has been recorded for %s. A vendor quality record is ACCRUED from measured periods, and there are none — so this refuses rather than averaging nothing, which would report no rework, no incidents and a productivity factor of 1.00 for a supplier nobody has measured. Record what they actually delivered (record_contract_performance_period) and the record follows.',
        s.name),
      'approvedVendor', s.approved_vendor,
      'safetyQualificationStatus', s.safety_qualification_status,
      'safetyQualificationExpires', s.safety_qualification_expires);
  end if;

  -- THE COST HALF ANSWERS SEPARATELY, AND ONLY IN ONE CURRENCY. A performance
  -- period carries no currency of its own; it inherits the CONTRACT's, and a
  -- period on no contract has none at all. Summing across either is a number
  -- whose difference is an exchange rate or a guess.
  select count(distinct p.contract_currency), min(p.contract_currency),
         count(*) filter (where cp.package_id is null
                            and (cp.planned_cost is not null or cp.actual_cost is not null))
    into v_currencies, v_currency, v_uncosted
  from contract_performance cp
  left join contract_packages p on p.id = cp.package_id
  where cp.organization_id = v_org and cp.supplier_id = s.id;

  if coalesce(v_uncosted, 0) > 0 then
    v_cost := jsonb_build_object('answered', false, 'refusal', format(
      '%s performance period(s) for %s carry a cost but sit on no contract, so nothing states what currency those figures are in. The cost half of this record REFUSES rather than summing numbers with no unit.',
      v_uncosted, s.name));
  elsif coalesce(v_currencies, 0) > 1 then
    v_cost := jsonb_build_object('answered', false, 'refusal', format(
      'The performance periods for %s sit on contracts in %s different currencies. Sync holds no exchange rate, so the cost half of this record REFUSES rather than summing two units.',
      s.name, v_currencies));
  else
    v_cost := jsonb_build_object('answered', true, 'currency', v_currency,
      'plannedCost', v_pc, 'actualCost', v_ac,
      'costPerformanceFactor', case when coalesce(v_ac, 0) > 0 and v_pc is not null
        then round(v_pc / v_ac, 4) end,
      'costFactorNote', case when coalesce(v_ac, 0) = 0 then
        'No actual cost has been recorded across these periods, so a cost performance factor is NOT ASSESSABLE — it is not 1.00.' end);
  end if;

  select count(*), count(*) filter (where promised_on is not null and received_on is not null),
         count(*) filter (where promised_on is not null and received_on is not null
                            and received_on <= promised_on),
         count(*) filter (where quality_outcome like 'rejected%')
    into v_del_total, v_del_dated, v_del_ontime, v_del_rejected
  from supplier_deliveries
  where organization_id = v_org and supplier_id = s.id;

  select count(*) into v_wt from warranty_terms
   where organization_id = v_org and supplier_id = s.id;
  -- count(distinct currency) IGNORES NULLs, so a claim with no stated currency
  -- was invisible to the mixed-currency refusal and its value was added to the
  -- others under their label. raise_warranty_claim now requires a currency, but
  -- warranty_claims is a GROWN table (20260817140000) and rows that predate the
  -- door exist, so the count buckets a missing currency as its own unit — the
  -- refusal fires rather than a total appearing under a currency nobody stated.
  select count(*), count(*) filter (where wc.status = 'accepted'),
         count(*) filter (where wc.status = 'time_barred'),
         sum(wc.claim_value), sum(wc.recovered_value),
         count(distinct coalesce(wc.currency, '(none stated)')),
         count(*) filter (where wc.currency is null
                            and (wc.claim_value is not null
                                 or wc.recovered_value is not null))
    into v_wc, v_wc_accepted, v_wc_barred, v_wc_claimed, v_wc_recovered,
         v_wc_currencies, v_wc_uncurrenced
  from warranty_claims wc
  join warranty_terms wt on wt.id = wc.warranty_id
  where wc.organization_id = v_org and wt.supplier_id = s.id;

  -- CONTRACT CLAIMS ARE SIGNED AND SINGLE-CURRENCY, like every other total in
  -- this record. The first draft was neither, and it was the one money figure
  -- in the function with no currency predicate at all: `sum(settled_value)`
  -- across every direction and every contract. contract_claims.direction
  -- exists precisely to stop that — the table's own comment says an unsigned
  -- claim value "would put the two on the same side of the contract" — and
  -- contract_commercial_summary in the same slice already nets it correctly,
  -- so the slice shipped two predicates for one quantity that disagreed. A
  -- supplier who claimed 200k off the owner and had 200k of liquidated damages
  -- recovered from them read identically to one who simply won 400k.
  select count(distinct p.id), count(cc.id),
         coalesce(sum(cc.settled_value) filter (
           where cc.direction = 'from_supplier'
             and cc.status in ('accepted','partially_accepted')), 0),
         coalesce(sum(cc.settled_value) filter (
           where cc.direction = 'against_supplier'
             and cc.status in ('accepted','partially_accepted')), 0),
         count(distinct p.contract_currency), min(p.contract_currency)
    into v_contracts, v_claims, v_cc_from, v_cc_against, v_cc_currencies, v_cc_currency
  from contract_packages p
  left join contract_claims cc on cc.package_id = p.id
  where p.organization_id = v_org and p.awarded_supplier_id = s.id
    and p.awarded_at is not null;

  if coalesce(v_claims, 0) = 0 then
    v_contract_claims := jsonb_build_object('raised', 0,
      'settledNet', null, 'settledFromSupplier', null, 'settledAgainstSupplier', null,
      'refusal', format(
        'No claim has been made under any of %s''s contracts. That is not a settled position of zero — it is the absence of a dispute, and the two read the same only to a counter that starts at zero.',
        s.name));
  elsif coalesce(v_cc_currencies, 0) > 1 then
    v_contract_claims := jsonb_build_object('raised', v_claims,
      'settledNet', null, 'settledFromSupplier', null, 'settledAgainstSupplier', null,
      'refusal', format(
        'The contracts %s holds are denominated in %s different currencies. Sync holds no exchange rate, so the claims settled under them are NOT summed — a total across two units is not money.',
        s.name, v_cc_currencies));
  else
    v_contract_claims := jsonb_build_object('raised', v_claims,
      'currency', v_cc_currency,
      'settledFromSupplier', v_cc_from,
      'settledAgainstSupplier', v_cc_against,
      -- Signed, in the owner's direction: what the supplier won, less what was
      -- recovered from them.
      'settledNet', v_cc_from - v_cc_against);
  end if;

  return jsonb_build_object(
    'supplierId', s.id, 'supplier', s.name, 'supplierCode', s.supplier_code,
    'answered', true,
    'approvedVendor', s.approved_vendor,
    'safetyQualificationStatus', s.safety_qualification_status,
    'safetyQualificationExpires', s.safety_qualification_expires,
    'qualificationExpired', s.safety_qualification_expires is not null
      and s.safety_qualification_expires < current_date,
    'periods', v_periods, 'firstPeriod', v_first, 'lastPeriod', v_last,
    'awardedContracts', coalesce(v_contracts, 0),
    'plannedHours', v_ph, 'actualHours', v_ah,
    -- Planned ÷ actual: above 1.00 means the supplier beat the plan. Refused
    -- when there are no actual hours to divide by, because a factor of 1.00
    -- over nothing reads as exactly on plan.
    'productivityFactor', case when coalesce(v_ah, 0) > 0 and v_ph is not null
      then round(v_ph / v_ah, 4) end,
    'productivityNote', case when coalesce(v_ah, 0) = 0 then
      'No actual hours have been recorded across these periods, so a productivity factor is NOT ASSESSABLE. It is not 1.00 — nothing here divides by zero and reports "on plan".' end,
    'cost', v_cost,
    'reworkEvents', coalesce(v_rework, 0),
    'reworkPerThousandHours', case when coalesce(v_ah, 0) > 0
      then round(coalesce(v_rework, 0)::numeric / (v_ah / 1000), 3) end,
    'reworkRateNote', case when coalesce(v_ah, 0) = 0 then
      'A rework rate is per hour worked and no actual hours are recorded, so it is NOT ASSESSABLE — a count of rework events with no denominator ranks a big contractor worse than a small one for doing more work.' end,
    'safetyIncidents', coalesce(v_safety, 0),
    'qualityEscapes', coalesce(v_escapes, 0),
    'deliveries', jsonb_build_object(
      'recorded', coalesce(v_del_total, 0),
      'assessable', coalesce(v_del_dated, 0),
      'onTime', coalesce(v_del_ontime, 0),
      'rejectedOnReceipt', coalesce(v_del_rejected, 0),
      'onTimeRate', case when coalesce(v_del_dated, 0) > 0
        then round(v_del_ontime::numeric / v_del_dated, 4) end,
      'refusal', case when coalesce(v_del_dated, 0) = 0 then format(
        '%s delivery event(s) are recorded for %s and none of them carries both a promised and a received date, so an on-time rate is REFUSED. "100%% on time" over deliveries nobody dated is the number this refusal exists to prevent.',
        coalesce(v_del_total, 0), s.name) end),
    'warranty', jsonb_build_object(
      'terms', coalesce(v_wt, 0),
      'claims', coalesce(v_wc, 0),
      'accepted', coalesce(v_wc_accepted, 0),
      'timeBarred', coalesce(v_wc_barred, 0),
      'claimedValue', case when coalesce(v_wc_currencies, 0) <= 1
        and coalesce(v_wc_uncurrenced, 0) = 0 then v_wc_claimed end,
      'recoveredValue', case when coalesce(v_wc_currencies, 0) <= 1
        and coalesce(v_wc_uncurrenced, 0) = 0 then v_wc_recovered end,
      'currency', case when coalesce(v_wc_currencies, 0) = 1
        and coalesce(v_wc_uncurrenced, 0) = 0
        then (select min(wc.currency) from warranty_claims wc
               join warranty_terms wt on wt.id = wc.warranty_id
              where wc.organization_id = v_org and wt.supplier_id = s.id) end,
      'refusal', case
        when coalesce(v_wc_uncurrenced, 0) > 0 then format(
          '%s warranty claim(s) against %s carry a value with NO stated currency, so no recovery total is reported. A figure with no unit is not money, and adding it to the ones that do have a unit would report it under a currency nobody stated.',
          v_wc_uncurrenced, s.name)
        when coalesce(v_wc_currencies, 0) > 1 then
          'The warranty claims against this supplier are stated in more than one currency. Sync holds no exchange rate, so no recovery total is reported.' end,
      'timeBarredNote', case when coalesce(v_wc_barred, 0) > 0 then format(
        '%s warranty claim(s) against %s were TIME-BARRED — cover was real and the entitlement lapsed before the claim was lodged. That is money the owner was entitled to and did not recover, and it belongs in this record rather than nowhere.',
        v_wc_barred, s.name) end),
    'contractClaims', v_contract_claims,
    'basis',
      'Accrued from recorded acts: performance periods, delivery events, warranty claims and contract claims. Nothing here is a stored score — there is no column to type it into, and a supplier''s record cannot be improved except by performing.');
end
$$;

revoke all on function public.get_vendor_quality_record(bigint) from public, anon, service_role;
grant execute on function public.get_vendor_quality_record(bigint) to authenticated;

comment on function public.get_vendor_quality_record(bigint) is
  'D6.01 / spec I.13 VendorQualityRecord × I.15: a supplier''s history ACCRUED from recorded acts — performance periods, deliveries, warranty claims, contract claims — and never stored. REFUSES entirely when no period has been recorded (averaging nothing reports a perfect supplier), and refuses each derived ratio separately: no actual hours means no productivity factor and no rework rate, no dated deliveries means no on-time rate, mixed currencies mean no cost or recovery total.';

-- ---------------------------------------------------------------------------
-- 3. D6.07 — THE FIRST HOP: WHICH SPECIFICATION A PACKAGE WAS TENDERED AGAINST.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_package_specifications (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  package_id bigint not null references contract_packages(id) on delete cascade,
  requirement_id bigint not null references design_requirements(id) on delete cascade,
  basis text not null check (length(btrim(basis)) >= 20),
  linked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (package_id, requirement_id)
);

create index if not exists idx_package_spec_requirement
  on contract_package_specifications(organization_id, requirement_id);

alter table public.contract_package_specifications enable row level security;
drop policy if exists package_spec_read on public.contract_package_specifications;
create policy package_spec_read on public.contract_package_specifications
  for select to authenticated using (organization_id = app_current_org());

comment on table public.contract_package_specifications is
  'D6.07 / spec I.16: the Specification → ProcurementPackage hop of the commercial thread — which requirements of the ONE requirement table (design_requirements, ruling D4.16) a package was tendered against. A LINK between two canonical stores, not a copy of either and not a graph store: everything downstream of it is a join over rows that already existed.';

create or replace function public.enforce_package_specification_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.package_spec_write', true), '');
  v_client boolean := auth.uid() is not null;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'contract_package_specifications is the first hop of the commercial thread. Truncating it detaches every purchased specification from the contract that bought it, and the thread then reports "no specification linked" for the whole estate. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if not exists (select 1 from contract_packages p
                  where p.id = new.package_id and p.organization_id = new.organization_id) then
    raise exception
      'this specification link is stamped with an organization that does not own its package'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from design_requirements d
                  where d.id = new.requirement_id and d.organization_id = new.organization_id) then
    raise exception
      'this specification link is stamped with an organization that does not own its requirement'
      using errcode = 'check_violation';
  end if;
  if v_marker <> 'granted' then
    if v_client then
      raise exception
        'A specification link is made through link_package_specification, which requires a role, states its basis and writes the audit row.'
        using errcode = 'insufficient_privilege';
    end if;
    perform record_procurement_service_write(new.organization_id,
      'A package specification link', tg_op,
      'A specification link written outside the RPC has no recorded author and no stated basis.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_package_specification_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_package_spec_integrity on public.contract_package_specifications;
create trigger trg_package_spec_integrity
  before insert or update or delete on public.contract_package_specifications
  for each row execute function public.enforce_package_specification_integrity();

drop trigger if exists trg_package_spec_no_truncate on public.contract_package_specifications;
create trigger trg_package_spec_no_truncate
  before truncate on public.contract_package_specifications
  for each statement execute function public.enforce_package_specification_integrity();

revoke truncate on table public.contract_package_specifications
  from anon, authenticated, service_role;

create or replace function public.link_package_specification(
  p_package_id bigint,
  p_requirement_ref text,
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
  d design_requirements%rowtype;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking a specification requires a planning, engineering or governance role');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  select * into d from design_requirements
   where organization_id = v_org
     and requirement_ref = nullif(btrim(coalesce(p_requirement_ref, '')), '');
  if not found then
    return jsonb_build_object('error', format(
      'no requirement %s exists in this organization. A package is tendered against the ONE requirement table; a specification that is not a requirement is a document nothing downstream can trace.',
      coalesce(p_requirement_ref, '(none)')));
  end if;
  if v_basis is null or length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state how this requirement reaches this package (basis, 20 characters minimum) — the clause of the specification, the datasheet or the scope item that carries it');
  end if;
  if exists (select 1 from contract_package_specifications
              where package_id = p.id and requirement_id = d.id) then
    return jsonb_build_object('error', format(
      'requirement %s is already linked to package %s', d.requirement_ref, p.package_code));
  end if;

  perform set_config('app.package_spec_write', 'granted', true);
  insert into contract_package_specifications
    (organization_id, package_id, requirement_id, basis, linked_by)
  values (v_org, p.id, d.id, v_basis, auth.uid())
  returning id into v_id;
  perform set_config('app.package_spec_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'package_specification', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'package_id', p.id,
      'package_code', p.package_code, 'requirement_id', d.id,
      'requirement_ref', d.requirement_ref, 'link_id', v_id, 'action', 'linked'),
    null,
    jsonb_build_object('requirement_ref', d.requirement_ref,
      'package_code', p.package_code, 'basis', v_basis));

  return jsonb_build_object('link_id', v_id, 'package_code', p.package_code,
    'requirementRef', d.requirement_ref, 'requirement', d.requirement,
    'derivedFromFailureMode', d.derived_from_failure_mode,
    'note', 'The commercial thread now runs from this specification to the contract that bought it. get_specification_failure_thread walks it forward to the failures that followed, and reads the reverse direction from the live design-feedback traversal rather than re-deriving it.');
end
$$;

revoke all on function public.link_package_specification(bigint, text, text)
  from public, anon;
grant execute on function public.link_package_specification(bigint, text, text)
  to authenticated, service_role;

comment on function public.link_package_specification(bigint, text, text) is
  'D6.07 / spec I.16: links a design requirement (the ONE requirement table) to the procurement package tendered against it — the first hop of the Specification → Bid → Contract → Vendor → Equipment → Installed Asset → Failure History thread. Refuses a requirement that is not in the requirement table, because a specification nothing else knows about is a document the thread cannot traverse.';

-- ---------------------------------------------------------------------------
-- 4. D6.07 — THE TRAVERSAL, BOTH DIRECTIONS.
--
--    Forward: specification → packages → bids → contract → vendor → materials
--    → BOM → installed assets → corrective failure history.
--    Backward: NOT re-implemented. get_design_feedback_loop (20260818090000)
--    is the live failure → requirement traversal and it is CALLED here.
-- ---------------------------------------------------------------------------
create or replace function public.get_specification_failure_thread(
  p_requirement_ref text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  d design_requirements%rowtype;
  v_packages jsonb;
  v_package_count int;
  v_awarded int;
  v_suppliers bigint[];
  v_materials uuid[];
  v_assets uuid[];
  v_failures jsonb;
  v_failure_total bigint;
  v_backward jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from design_requirements
   where organization_id = v_org
     and requirement_ref = nullif(btrim(coalesce(p_requirement_ref, '')), '');
  if not found then
    return jsonb_build_object('error', format('no requirement %s in this organization',
      coalesce(p_requirement_ref, '(none)')));
  end if;

  -- The backward direction, from the ONE live traversal. Read first so it is
  -- present even when the forward thread refuses at its first hop: a
  -- requirement derived from a failure mode has a story to tell even if
  -- nobody has tendered against it yet.
  select coalesce(jsonb_agg(jsonb_build_object(
      'failureMode', f.failure_mode, 'occurrences', f.occurrences,
      'assetsAffected', f.assets_affected,
      'requirementsReferencing', f.requirements_referencing,
      'loopClosed', f.loop_closed)), '[]'::jsonb)
    into v_backward
  from get_design_feedback_loop() f
  where d.derived_from_failure_mode is not null
    and f.failure_mode = d.derived_from_failure_mode;

  select count(*), count(*) filter (where p.awarded_at is not null),
         array_agg(distinct p.awarded_supplier_id) filter (where p.awarded_supplier_id is not null)
    into v_package_count, v_awarded, v_suppliers
  from contract_package_specifications l
  join contract_packages p on p.id = l.package_id
  where l.organization_id = v_org and l.requirement_id = d.id;

  -- REFUSAL-FIRST at the first hop. "0 failures traced" over a specification
  -- nobody linked to a package reads as a specification that produced no
  -- failures, which is the opposite of what is known.
  if coalesce(v_package_count, 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', '[]'::jsonb,
      'refusal', format(
        'Requirement %s is not linked to any procurement package, so the commercial half of this thread cannot be walked. That is not "this specification caused no failures": nothing connects it to anything that was bought, and every hop after the first is unreachable. Link it (link_package_specification) and the thread runs to the failure history.',
        d.requirement_ref),
      'backward', v_backward,
      'backwardNote', case when d.derived_from_failure_mode is null then
        'This requirement records no originating failure mode, so the reverse direction — from operational failures back to the requirement they produced — has nothing to match on.' end);
  end if;

  select jsonb_agg(jsonb_build_object(
      'packageId', p.id, 'packageCode', p.package_code, 'title', p.title,
      'linkBasis', l.basis,
      'bids', (select count(*) from contract_bids b
                where b.package_id = p.id and b.withdrawn_at is null),
      'awarded', p.awarded_at is not null,
      'contractValue', contract_current_value(p.id),
      'currency', p.contract_currency,
      'supplier', (select s.name from suppliers s where s.id = p.awarded_supplier_id),
      'supplierId', p.awarded_supplier_id,
      'hopNote', case
        when p.awarded_at is null and not exists (
          select 1 from contract_bids b where b.package_id = p.id and b.withdrawn_at is null)
        then 'The thread stops here: this package has been tendered against the specification but has received no live bid, so there is no vendor and no equipment downstream of it.'
        when p.awarded_at is null
        then 'The thread stops here: this package has bids but no award, so nothing downstream of it has a counterparty yet.'
        end)
      order by p.package_code)
    into v_packages
  from contract_package_specifications l
  join contract_packages p on p.id = l.package_id
  where l.organization_id = v_org and l.requirement_id = d.id;

  if coalesce(v_awarded, 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'refusal', format(
        'Requirement %s reaches %s procurement package(s) and NONE of them is awarded, so the thread stops at the tender. There is no vendor, no equipment and no installed asset downstream of an unawarded package — reporting "no failures" here would be reporting the absence of a purchase as the absence of a problem.',
        d.requirement_ref, v_package_count),
      'backward', v_backward);
  end if;

  -- Vendor → the materials that vendor supplies → the BOMs those materials sit
  -- on → the assets those BOMs belong to. Every hop is a join over a canonical
  -- store; nothing here is a second copy of the relationship.
  select array_agg(distinct ms.material_id) into v_materials
  from material_suppliers ms
  where ms.organization_id = v_org and ms.supplier_id = any (v_suppliers);

  if coalesce(array_length(v_materials, 1), 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'awardedPackages', v_awarded,
      'refusal', format(
        'Requirement %s reaches an awarded contract, and the winning vendor supplies no material recorded in this organization''s catalogue. The thread stops at the vendor: nothing connects what was bought to a part, so nothing connects it to an installed asset or to a failure. This is a gap in the material master, not evidence that the equipment has not failed.',
        d.requirement_ref),
      'backward', v_backward);
  end if;

  -- BOTH SHAPES OF BOM LINE. bom_lines hangs off a specific asset OR a whole
  -- asset CLASS (20260809180000:85, `check (asset_id is not null or asset_class
  -- is not null)`), and following only the first would refuse a thread whose
  -- parts are catalogued against a class — reporting "this part is on no bill
  -- of materials" about a part that is on every one of them.
  select array_agg(distinct a.id) into v_assets
  from assets a
  where a.organization_id = v_org
    and exists (
      select 1 from bom_lines b
      where b.organization_id = v_org
        and b.material_id = any (v_materials)
        and (b.asset_id = a.id
             or (b.asset_id is null and b.asset_class is not null
                 and b.asset_class = a.asset_class)));

  if coalesce(array_length(v_assets, 1), 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'awardedPackages', v_awarded, 'materials', array_length(v_materials, 1),
      'refusal', format(
        'Requirement %s reaches %s material(s) from the awarded vendor, and none of them appears on any asset''s bill of materials. The thread stops at the part: nothing says where these parts are installed, so no failure history can be attributed to them.',
        d.requirement_ref, array_length(v_materials, 1)),
      'backward', v_backward);
  end if;

  -- Ordered on the COUNT ITSELF, not on its rendered text. Ordering a jsonb
  -- aggregate by the text of the occurrence field sorts the numbers as strings
  -- and puts 9 above 10, which reverses the top of every failure list this
  -- thread produces.
  select coalesce(jsonb_agg(jsonb_build_object(
           'failureMode', g.fm, 'occurrences', g.n,
           'assetsAffected', g.assets,
           'firstSeen', g.first_seen, 'lastSeen', g.last_seen)
         order by g.n desc, g.fm), '[]'::jsonb),
         coalesce(sum(g.n), 0)
    into v_failures, v_failure_total
  from (
    select coalesce(nullif(btrim(w.actual_failure_mode), ''), '(uncoded)') as fm,
           count(*)::bigint as n,
           count(distinct w.asset_id)::bigint as assets,
           min(w.created_at)::date as first_seen,
           max(w.created_at)::date as last_seen
    from work_orders w
    where w.organization_id = v_org and w.work_type = 'corrective'
      and w.asset_id = any (v_assets)
    group by 1
  ) g;

  return jsonb_build_object(
    'requirementRef', d.requirement_ref, 'requirement', d.requirement,
    'category', d.category, 'verificationStatus', d.verification_status,
    'derivedFromFailureMode', d.derived_from_failure_mode,
    'answered', true,
    'packages', v_packages, 'packageCount', v_package_count,
    'awardedPackages', v_awarded,
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object(
        'supplierId', s.id, 'supplier', s.name, 'supplierCode', s.supplier_code,
        'approvedVendor', s.approved_vendor) order by s.name), '[]'::jsonb)
      from suppliers s where s.id = any (v_suppliers)),
    'materials', array_length(v_materials, 1),
    'installedAssets', array_length(v_assets, 1),
    'failures', v_failures,
    'failureTotal', v_failure_total,
    'failureNote', case when coalesce(v_failure_total, 0) = 0 then format(
      'The thread runs the whole way — specification %s, %s package(s), %s awarded, %s material(s), %s installed asset(s) — and NO corrective work order has been recorded against those assets. That is a fact about the maintenance history, not a warranty: it means nothing has been reported, and how long they have been in service is what makes it meaningful.',
      d.requirement_ref, v_package_count, v_awarded,
      array_length(v_materials, 1), array_length(v_assets, 1)) end,
    'backward', v_backward,
    'backwardNote', case when d.derived_from_failure_mode is null then
      'This requirement records no originating failure mode, so the reverse direction has nothing to match on — the forward half above still runs.'
      when jsonb_array_length(v_backward) = 0 then format(
      'The reverse direction found no corrective history under failure mode "%s" in the top fifteen modes the design-feedback traversal reports, so the loop this requirement was written to close is not visible in it.',
      d.derived_from_failure_mode) end,
    'basis',
      'Joins over the canonical stores, in the specification''s own order: design_requirements → contract_package_specifications → contract_packages → contract_bids → suppliers → material_suppliers → bom_lines → assets → work_orders. The reverse direction is get_design_feedback_loop, called rather than re-derived.');
end
$$;

revoke all on function public.get_specification_failure_thread(text)
  from public, anon, service_role;
grant execute on function public.get_specification_failure_thread(text) to authenticated;

comment on function public.get_specification_failure_thread(text) is
  'D6.07 / spec I.16: walks Specification → Bid → Contract → Vendor → Equipment → Installed Asset → Failure History as joins over the canonical stores, and REFUSES at whichever hop the chain breaks — naming the hop, because "0 failures traced" over a broken chain reads as a specification that caused none. The reverse direction is get_design_feedback_loop, CALLED rather than re-implemented: two traversals over the same hops would disagree the first time either was repaired.';

notify pgrst, 'reload schema';
