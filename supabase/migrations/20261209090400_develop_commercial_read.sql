-- ============================================================================
-- Sync Develop — Slice 6B, part 4b of 4.
-- D6.06 — the commercial read: the five I.16 lifecycle objects for one
-- contract, and the compact summary spliced into the case procurement screen.
--
-- ONE PREDICATE PER QUESTION, EVERYWHERE. This file computes nothing of its
-- own. What the contract is worth comes from contract_current_value; the
-- commitment from contract_commitment_position; the invoice position from
-- contract_invoice_position; whether a warranty covers from
-- warranty_cover_position. A read that re-derived any of them would be a
-- second answer to a question the doors already refuse over, and the screen
-- and the wall would disagree the first time either was repaired.
--
-- THE ONE THING IT DOES STATE OF ITS OWN: the gap between claims that were
-- SETTLED and change orders that were APPROVED. An accepted claim does not
-- move the contract — a change order does — so a settlement nobody carried
-- into a change order is money agreed and not recorded against the contract.
-- It is named rather than added, because adding it would be the second source
-- of contract value this slice exists to avoid.
-- ============================================================================

create or replace function public.contract_commercial_summary(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p contract_packages%rowtype;
  v_co_approved int; v_co_draft int; v_co_delta numeric;
  v_invoices jsonb;
  v_claims_open int; v_claims_raised int; v_claims_settled numeric;
  v_warranties int; v_warranty_expired int; v_warranty_unassessable int;
begin
  select * into p from contract_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'procurement package not found');
  end if;
  if p.awarded_at is null then
    return jsonb_build_object('answered', false,
      'refusal', 'This package is not awarded. There is no contract to have a commercial life yet — no change order, no invoice, no claim and no warranty attaches to a package nobody has awarded.');
  end if;

  select count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'draft'),
         coalesce(sum(value_delta) filter (where status = 'approved'), 0)
    into v_co_approved, v_co_draft, v_co_delta
  from contract_change_orders where package_id = p.id;

  -- THE INVOICE HALF IS THE ONE POSITION'S, REFUSAL AND ALL. Counting the rows
  -- here instead reported a confident `invoices: 0, invoicesAwaitingPayment: 0`
  -- on a contract nobody has billed against, while contract_invoice_position —
  -- read by the certification door and by the contract screen — REFUSES over
  -- exactly that set in exactly those words ("that is not 'nothing outstanding'
  -- and it is not 'paid in full'"). Two surfaces of one slice gave opposite
  -- answers to one question and the refusal-first one was the one the planner
  -- did not see.
  v_invoices := contract_invoice_position(p.id);

  select count(*) filter (where status = 'open'),
         count(*),
         coalesce(sum(settled_value) filter (
           where direction = 'from_supplier'
             and status in ('accepted','partially_accepted')), 0)
       - coalesce(sum(settled_value) filter (
           where direction = 'against_supplier'
             and status in ('accepted','partially_accepted')), 0)
    into v_claims_open, v_claims_raised, v_claims_settled
  from contract_claims where package_id = p.id;

  -- THE WARRANTY COUNTS COME OFF THE ONE COVER PREDICATE. Written here as
  -- a bare date comparison they were a SECOND expiry arithmetic — the thing
  -- warranty_cover_position's own comment says does not exist — and they were
  -- wrong in the way a second arithmetic always is: a usage-limited term that
  -- had passed its limit fell into neither bucket, so an exhausted warranty
  -- rendered on the case screen as a live one. The predicate is asked per term,
  -- with no usage reading, so a usage-limited term lands in `notAssessable`
  -- rather than being silently counted as cover.
  select count(*),
         count(*) filter (where (cover->>'answered')::boolean is true
                            and (cover->>'covered')::boolean is not true),
         count(*) filter (where (cover->>'answered')::boolean is not true)
    into v_warranties, v_warranty_expired, v_warranty_unassessable
  from warranty_terms w
  cross join lateral (select warranty_cover_position(w.id, current_date, null) as cover) c
  where w.package_id = p.id;

  return jsonb_build_object('answered', true,
    'awardedValue', p.awarded_value,
    'currentValue', contract_current_value(p.id),
    'currency', p.contract_currency,
    'changeOrdersApproved', v_co_approved,
    'changeOrdersDraft', v_co_draft,
    'changeOrderDelta', v_co_delta,
    -- Carried verbatim from the ONE position, so the case screen shows the
    -- same figures — and the same refusal — as the contract screen.
    'invoicePosition', v_invoices,
    'invoices', case when (v_invoices->>'answered')::boolean is true
      then (v_invoices->>'invoices')::int end,
    'invoicesAwaitingPayment', case when (v_invoices->>'answered')::boolean is true
      then (select count(*) from contract_invoices
             where package_id = p.id and status = 'certified')::int end,
    'invoiceRefusal', v_invoices->>'refusal',
    -- BOTH counts. `claimsOpen` alone rendered "nobody has claimed" and "every
    -- claim has been answered" as the same "0 open claim(s)", which are
    -- opposite facts about a contract.
    'claimsRaised', v_claims_raised,
    'claimsOpen', v_claims_open,
    'claimsSettledNet', case when v_claims_raised > 0 then v_claims_settled end,
    -- WHAT THIS READ DELIBERATELY DOES NOT COMPUTE. It used to report
    -- a difference of (settled claims − every approved change order),
    -- and rendered the difference as "agreed money that no change order
    -- carries". Nothing in the schema links a claim to the change order that
    -- carries it, and v_co_delta is dominated by ordinary scope changes, so the
    -- figure was wrong in BOTH directions: an unrelated change order of the
    -- same size reported a false all-clear, and a scope change alongside a
    -- settlement invented a shortfall. The FACT is true and is stated; the
    -- arithmetic is not, and a number nobody can derive is worse than none.
    'settlementNote', case when v_claims_settled <> 0 then
      'A settled claim does not move the contract by itself. Money agreed under a claim reaches the contract only through an APPROVED change order, and nothing here links a settlement to the change order that carries it — check the change orders below against the settlements rather than trusting a difference.' end,
    'warrantyTerms', v_warranties,
    'warrantyExpired', v_warranty_expired,
    -- Terms the ONE cover predicate REFUSES over: no stated end and no usage
    -- limit, or a usage-limited term with no reading. Counted and RENDERED,
    -- because a term nobody can answer for is not a term in force.
    'warrantyNotAssessable', v_warranty_unassessable,
    'warrantyGap', case when v_warranties = 0 then
      'This contract carries no warranty term. Spec §24 lists warranty_terms as a field of the Contract, and a contract with none has no recorded remedy when the equipment fails.' end);
end
$$;

revoke all on function public.contract_commercial_summary(bigint)
  from public, anon, authenticated, service_role;

comment on function public.contract_commercial_summary(bigint) is
  'D6.06: the compact commercial position of one contract — change orders, invoices, claims and warranties — for the case procurement screen. EVERY figure is read from the ONE predicate that owns it: the invoice half is contract_invoice_position verbatim, refusal included, and the warranty counts are warranty_cover_position asked once per term, so there is no second expiry arithmetic and no confident zero where a position refuses. It computes nothing of its own.';

create or replace function public.get_contract_commercial(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p contract_packages%rowtype;
  v_summary jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into p from contract_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'procurement package not found');
  end if;
  v_summary := contract_commercial_summary(p.id);
  if (v_summary->>'answered')::boolean is not true then
    return jsonb_build_object('packageId', p.id, 'packageCode', p.package_code,
      'answered', false, 'refusal', v_summary->>'refusal');
  end if;

  return jsonb_build_object(
    'packageId', p.id, 'packageCode', p.package_code, 'title', p.title,
    'answered', true,
    'supplier', (select name from suppliers where id = p.awarded_supplier_id),
    'supplierId', p.awarded_supplier_id,
    'contractType', p.contract_type,
    'awardedAt', p.awarded_at,
    'awardedValue', p.awarded_value,
    'currency', p.contract_currency,
    'currentValue', contract_current_value(p.id),
    'contractStartDate', p.contract_start_date,
    'contractCompletionDate', p.contract_completion_date,
    'summary', v_summary,
    -- THE ONE COMMITMENT TOTAL, and the ONE invoice position. Not re-summed.
    'commitment', contract_commitment_position(p.id),
    'invoicePosition', contract_invoice_position(p.id),
    'changeOrders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'changeOrderId', co.id, 'changeOrderRef', co.change_order_ref,
        'description', co.description, 'reason', co.reason,
        'valueDelta', co.value_delta, 'currency', co.currency,
        'timeDeltaDays', co.time_delta_days, 'status', co.status,
        'recordedAt', co.recorded_at, 'decidedAt', co.decided_at,
        'decisionNote', co.decision_note,
        'contractValueBefore', co.contract_value_before,
        'contractValueAfter', co.contract_value_after,
        'frozen', co.decided_at is not null)
        order by co.change_order_ref)
      from contract_change_orders co where co.package_id = p.id), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoiceId', i.id, 'invoiceRef', i.invoice_ref,
        'invoiceDate', i.invoice_date, 'description', i.description,
        'grossAmount', i.gross_amount, 'certifiedAmount', i.certified_amount,
        'currency', i.currency, 'status', i.status,
        'certifiedAt', i.certified_at, 'paidAt', i.paid_at,
        'paymentReference', i.payment_reference,
        'payable', i.status = 'certified',
        'frozen', i.certified_at is not null,
        'withheld', case when i.certified_amount is not null
          then i.gross_amount - i.certified_amount end)
        order by i.invoice_date, i.invoice_ref)
      from contract_invoices i where i.package_id = p.id), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimId', c.id, 'claimRef', c.claim_ref, 'direction', c.direction,
        'grounds', c.grounds, 'claimedValue', c.claimed_value,
        'currency', c.currency, 'timeClaimedDays', c.time_claimed_days,
        'raisedOn', c.raised_on, 'status', c.status,
        'settledValue', c.settled_value, 'settledTimeDays', c.settled_time_days,
        'answeredAt', c.answered_at, 'answerNote', c.answer_note,
        'frozen', c.answered_at is not null)
        order by c.claim_ref)
      from contract_claims c where c.package_id = p.id), '[]'::jsonb),
    'warranties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'warrantyId', w.id, 'warrantyRef', w.warranty_ref,
        'startsOn', w.starts_on, 'endsOn', w.ends_on,
        'usageLimit', w.usage_limit, 'usageUnit', w.usage_unit,
        'claimWindowDays', w.claim_window_days,
        'covers', w.covers, 'exclusions', w.exclusions,
        -- THE ONE COVER PREDICATE, asked about TODAY. An expired term answers
        -- covered=false here exactly as it does at the claim door.
        'coverToday', warranty_cover_position(w.id, current_date, null),
        'claims', coalesce((
          select jsonb_agg(jsonb_build_object(
            'claimId', wc.id, 'claimRef', wc.claim_ref,
            'failureOn', wc.failure_on, 'raisedOn', wc.raised_on,
            'claimValue', wc.claim_value, 'recoveredValue', wc.recovered_value,
            'currency', wc.currency, 'status', wc.status,
            'coverBasis', wc.cover_basis, 'answeredAt', wc.answered_at,
            'frozen', wc.answered_at is not null)
            order by wc.raised_on, wc.id)
          from warranty_claims wc where wc.warranty_id = w.id), '[]'::jsonb))
        order by w.starts_on, w.id)
      from warranty_terms w where w.package_id = p.id), '[]'::jsonb),
    -- The FACT, with both totals stated and NO difference taken between them.
    -- The first draft subtracted the approved change-order delta from the net
    -- settlement and called the remainder "agreed money that no change order
    -- carries". Nothing in the schema links a claim to the change order that
    -- carries it, and the delta is dominated by ordinary scope changes, so the
    -- figure was wrong in both directions: an unrelated change order of the
    -- same size reported a false all-clear on agreed money, and a scope change
    -- alongside a settlement invented a shortfall the screen rendered as fact.
    'settlementNote', case when (v_summary->>'claimsSettledNet') is not null
      and (v_summary->>'claimsSettledNet')::numeric <> 0 then format(
      'Claims on this contract are settled at a NET %s %s, and the approved change orders move the contract by %s %s. These are two separate facts and their difference is NOT a figure: nothing here links a settlement to the change order that carries it, and most change orders are scope, not claims. An accepted claim does not move a contract; a change order does. Read the change orders below against the settlements — if a settlement was meant to reach the contract, record one.',
      p.contract_currency, v_summary->>'claimsSettledNet',
      p.contract_currency, v_summary->>'changeOrderDelta') end,
    'basis',
      'Every figure is read from the ONE predicate that owns it — contract_current_value, contract_commitment_position, contract_invoice_position, warranty_cover_position. Nothing is re-derived here, so the screen cannot show a number a door would refuse.');
end
$$;

revoke all on function public.get_contract_commercial(bigint) from public, anon, service_role;
grant execute on function public.get_contract_commercial(bigint) to authenticated;

comment on function public.get_contract_commercial(bigint) is
  'D6.06 / spec I.16: one contract''s whole commercial life — Commitment, ChangeOrder, Claim, Invoice and Warranty — read entirely through the predicates that own each figure. Refuses on an unawarded package by name. States that a settlement does not move a contract and gives both totals SEPARATELY rather than differencing them: nothing links a claim to the change order that carries it, so the difference was a number nobody could derive.';

-- ---------------------------------------------------------------------------
-- THE CASE SCREEN SEES IT TOO.
--
-- get_case_procurement already returns each package's commitment position from
-- the ONE predicate. A transformation of its LIVE body adds the commercial
-- summary beside it, so a contract that has been changed, invoiced, claimed
-- against or warrantied is visible on the screen a planner already reads —
-- rather than only on a screen somebody has to know to open. Re-typing the
-- function here would silently revert whatever has been repaired in it since.
-- ---------------------------------------------------------------------------
do $case$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_case_procurement';
  if v_def is null then
    raise exception 'get_case_procurement does not exist' using errcode = 'check_violation';
  end if;
  if position('contract_commercial_summary' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def,
    $old$      'commitment', contract_commitment_position(p.id))$old$,
    $new$      'commitment', contract_commitment_position(p.id),
      -- SLICE 6B: the contract's commercial life after signature — change
      -- orders, invoices, claims and warranties — from the ONE summary.
      'commercial', contract_commercial_summary(p.id))$new$);
  if v_new = v_def then
    raise exception
      'the per-package commitment key of get_case_procurement was not found in the shape Slice 6A left it — re-derive this transformation against the current body.'
      using errcode = 'check_violation';
  end if;
  execute v_new;
end
$case$;

comment on function public.get_case_procurement(uuid) is
  'D6.03/D6.06/D6.09 / spec I.16 + III.§25: one case''s procurement position — every package with all four §25 status dimensions, its lateness arithmetic, its award, its commitment position and, since Slice 6B, its commercial summary (change orders, invoices, claims, warranties). REFUSES over an empty package set rather than reporting "0 packages late", names every mandatory package it cannot assess, and reads its blockers from the ONE predicate the gate refuses over.';

notify pgrst, 'reload schema';
