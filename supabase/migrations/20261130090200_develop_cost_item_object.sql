-- ============================================================================
-- Sync Develop Slice 4A — CostItem, the CBS/WBS-coded cost line (D5.29,
-- spec §23) and its reconciliation to the Slice 2 finance model.
--
-- SPEC §23 VERBATIM: "CostItem: id, project_id, CBS_code, WBS_id,
-- baseline_cost, commitment, actual, forecast, contingency." Every one of
-- the nine lands as a typed column; none as jsonb.
--
-- THE RULING THAT MATTERS — THIS IS NOT A SECOND COST TRUTH. Slice 2's
-- finance model (20261115090200) is the CASE-LEVEL economics: the business
-- case, its options' dated full-life cash flows, the discount rate and its
-- source, contingency-with-basis on the option, the funding rows. That is
-- what the case is JUDGED by. A CostItem is the CONTROL-LEVEL line: what a
-- coded piece of scope was baselined at, committed, spent, is forecast to
-- cost, and how much contingency is held against it. Two different
-- questions, one of which is a decomposition of the other.
--
-- The register row D2.04 and the overlap map both forbid a parallel finance
-- store, so the boundary is drawn explicitly and enforced:
--   * a cost item NEVER contributes to NPV/IRR/payback. Those read the
--     option cash flows and nothing else — asserted statically in the slice
--     test, because the cheapest way to grow a second cost truth is for one
--     of them to start feeding a kernel;
--   * a cost item MUST name the business case it decomposes
--     (business_case_id NOT NULL) — a control line floating free of the
--     economics it is supposed to be under is exactly the second store;
--   * get_case_cost_reconciliation asks whether the lines and the recorded
--     economics AGREE, and REFUSES to answer when either side is absent.
--     It never fills in the missing side. "No recorded business case, so
--     the cost lines reconcile against nothing" is the answer.
--
-- REFUSALS (the row's own words: a cost item whose WBS code does not resolve
-- must REFUSE, not float free):
--   * wbs_element_id is NOT NULL, and the RPC refuses an unresolvable code
--     BY NAME before it gets there. There is no "unassigned" bucket: an
--     uncoded cost line is money nobody is accountable for, which is the
--     condition D5.02 exists to detect and this table exists not to create.
--   * cbs_code_id is NOT NULL, resolved against the case's own CBS.
--   * every numeric is finite or refused. Postgres parses 'NaN' and
--     '±Infinity' as valid numeric and NaN sorts ABOVE every number, so
--     `>= 0` is vacuously satisfied by both — the CHECK uses explicit
--     literal comparison, and it binds every writer including service.
--   * contingency without a stated basis is refused (the
--     business_case_options contingency_basis idiom, 20261115090200).
--   * a forecast is never derived. If nobody stated one, the line reports
--     "no forecast stated" — not baseline, not actual, not a midpoint.
--
-- §70. Recording and revising a cost line is preparation. What this file
-- does NOT do is approve anything: the cost BASELINE is development_
-- baselines (D5.26) captured by 20261130090500, and only a human role can
-- approve one. ai_admin may record a line and is refused at the baseline.
--
-- Canonical reuse: business_cases (Slice 2), project_wbs_elements,
-- project_cbs_codes, project_control_accounts, development_cases,
-- audit_events. No new finance store; budget_lines/capital_plan_items keep
-- their plan-level meaning untouched.
-- ============================================================================

create table if not exists public.project_cost_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  cost_item_ref text not null check (btrim(cost_item_ref) <> ''),
  -- Spec §23 CBS_code / WBS_id. Both NOT NULL: the coding IS the object.
  cbs_code_id uuid not null references project_cbs_codes(id) on delete restrict,
  wbs_element_id uuid not null references project_wbs_elements(id) on delete restrict,
  -- Derived at write time from the WBS element's control account, so the
  -- roll-up point is recorded rather than re-derived by each reader. Null
  -- when the element sits under no control account — a D5.02 gap, kept
  -- visible instead of blocking the line.
  control_account_id uuid references project_control_accounts(id) on delete set null,
  -- The Slice 2 anchor. NOT NULL by design (see the header ruling).
  business_case_id bigint not null references business_cases(id) on delete restrict,
  description text not null check (length(btrim(description)) >= 5),
  -- The line is DENOMINATED IN ITS BUSINESS CASE'S CURRENCY. There is no
  -- independent default: a line that quietly said CAD while the case it
  -- decomposes said USD produced a "variance" that was an exchange rate.
  -- Enforced for every writer by trg_cost_item_coding.
  currency text not null check (btrim(currency) <> ''),
  -- Spec §23's five money columns. All nullable — an absent commitment is
  -- "nothing committed yet", which is a different fact from zero, and the
  -- read renders it as absence.
  baseline_cost numeric,
  commitment numeric,
  actual numeric,
  forecast numeric,
  contingency numeric,
  contingency_basis text,
  -- Where the line came from, when it came from a cost/ERP connector. Both
  -- null for a Sync-authored line. The Slice 6 cost connector lands on this
  -- pair through the same one door; the idempotency shape is reserved here.
  source_system text,
  external_id text,
  basis text not null check (length(btrim(basis)) >= 10),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (development_case_id, cost_item_ref),
  -- FINITE OR ABSENT, for every writer. `x < 'Infinity'` is false for NaN
  -- and +Infinity both, which is what makes one arm cover the pair.
  constraint cost_item_amounts_finite check (
    (baseline_cost is null or (baseline_cost > '-Infinity'::numeric and baseline_cost < 'Infinity'::numeric))
    and (commitment is null or (commitment > '-Infinity'::numeric and commitment < 'Infinity'::numeric))
    and (actual is null or (actual > '-Infinity'::numeric and actual < 'Infinity'::numeric))
    and (forecast is null or (forecast > '-Infinity'::numeric and forecast < 'Infinity'::numeric))
    and (contingency is null or (contingency > '-Infinity'::numeric and contingency < 'Infinity'::numeric))
  ),
  constraint cost_item_amounts_non_negative check (
    coalesce(baseline_cost, 0) >= 0 and coalesce(commitment, 0) >= 0
    and coalesce(actual, 0) >= 0 and coalesce(forecast, 0) >= 0
    and coalesce(contingency, 0) >= 0
  ),
  -- Contingency without its basis is a number somebody liked.
  constraint cost_item_contingency_basis check (
    contingency is null or coalesce(length(btrim(contingency_basis)), 0) >= 10
  ),
  constraint cost_item_source_pair check (
    (source_system is null) = (external_id is null)
  )
);

create unique index if not exists idx_cost_item_external
  on project_cost_items(development_case_id, source_system, external_id)
  where external_id is not null;
create index if not exists idx_cost_item_case
  on project_cost_items(organization_id, development_case_id, cost_item_ref);
create index if not exists idx_cost_item_wbs
  on project_cost_items(wbs_element_id);
create index if not exists idx_cost_item_ca
  on project_cost_items(control_account_id) where control_account_id is not null;

alter table public.project_cost_items enable row level security;
drop policy if exists project_cost_items_read on public.project_cost_items;
create policy project_cost_items_read on public.project_cost_items
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_cost_items is
  'D5.29 (spec §23): the CBS/WBS-coded cost line. Decomposes the Slice 2 business case (business_case_id NOT NULL) — it is not a second cost truth, and no kernel computes NPV/IRR/payback from it.';

-- ---------------------------------------------------------------------------
-- The coding wall. A cost line's WBS element and its case must agree, and
-- so must its CBS code and its business case: a line coded to another case's
-- WBS would make every roll-up on both cases wrong. Enforced for EVERY
-- writer (a cross-case coding is corrupt data, not a provenance question),
-- INSERT and UPDATE, with an is-distinct guard.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_cost_item_coding()
returns trigger
language plpgsql
as $$
declare
  v_case uuid;
  v_case_org uuid;
  v_bc_currency text;
  v_marker text := coalesce(current_setting('app.cost_item_write', true), '');
  v_client boolean := auth.uid() is not null;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_cost_items is the coded cost record every controls figure is summed from; truncating it erases every tenant''s cost lines in one statement, which no row-level wall can refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  -- THE §70 BACKSTOP, ahead of the fast path so a service write cannot slip
  -- through the is-distinct guard unrecorded. RLS already denies a client any
  -- write; this arm is what makes an RLS-BYPASSING write visible.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = new.organization_id) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Cost line ' || new.cost_item_ref || ' written (' || lower(tg_op) ||
           ') by a service caller outside record_cost_item. Cost lines are what '
           'the reconciliation to the business case is summed from (D5.29), so a '
           'write nobody recorded moves a figure people act on.');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'a cost line is written through record_cost_item — a direct write would put money into the controls figures with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The tenant arm binds every writer including service: a line stamped with
  -- one organization while its case belongs to another is read by the wrong
  -- tenant under the RLS read policy.
  select organization_id into v_case_org from development_cases where id = new.development_case_id;
  if v_case_org is null or v_case_org <> new.organization_id then
    raise exception
      'this cost line is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and new.wbs_element_id is not distinct from old.wbs_element_id
     and new.cbs_code_id is not distinct from old.cbs_code_id
     and new.business_case_id is not distinct from old.business_case_id
     and new.development_case_id is not distinct from old.development_case_id
     -- control_account_id is DERIVED, so it belongs in the guard: leaving it
     -- out let a writer set the roll-up point to another case's account and
     -- the fast path returned without re-deriving it. The account then
     -- counted money that is not on its case, and D5.02 reported no gap.
     and new.control_account_id is not distinct from old.control_account_id
     and new.currency is not distinct from old.currency then
    new.updated_at := now();
    return new;
  end if;

  select development_case_id into v_case from project_wbs_elements where id = new.wbs_element_id;
  if v_case is null or v_case <> new.development_case_id then
    raise exception
      'this cost line is coded to a WBS element belonging to another development case — a cost line codes to its own case''s WBS or it does not exist'
      using errcode = 'check_violation';
  end if;

  select development_case_id into v_case from project_cbs_codes where id = new.cbs_code_id;
  if v_case is null or v_case <> new.development_case_id then
    raise exception
      'this cost line is coded to a CBS code belonging to another development case'
      using errcode = 'check_violation';
  end if;

  select development_case_id, currency into v_case, v_bc_currency
    from business_cases where id = new.business_case_id;
  if v_case is null or v_case <> new.development_case_id then
    raise exception
      'this cost line names a business case belonging to another development case — the line decomposes ITS case''s economics (D5.29), it does not point at a neighbour''s'
      using errcode = 'check_violation';
  end if;

  -- ONE CURRENCY PER RECONCILIATION. The line and the economics it decomposes
  -- are the two sides of get_case_cost_reconciliation; denominated
  -- differently, their difference is an exchange rate reported as a project
  -- variance. Refused for every writer, because a mixed-currency total is
  -- corrupt data rather than a provenance question.
  if new.currency is distinct from v_bc_currency then
    raise exception
      'this cost line is denominated in %s while the business case it decomposes is in %s — a line and its business case reconcile in one currency or the difference between them is an exchange rate reported as a project variance.',
      new.currency, v_bc_currency
      using errcode = 'check_violation';
  end if;

  -- The roll-up point is recorded, not re-derived per reader — and it is the
  -- nearest account AT OR ABOVE the element, because cost collects up the
  -- branch (resolve_control_account_for_wbs, 20261130090000). An exact-match
  -- lookup would leave every line below a control account reading as
  -- uncoded, which D5.02 would then report as a gap that is not there.
  new.control_account_id := resolve_control_account_for_wbs(new.wbs_element_id);

  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.enforce_cost_item_coding() from public, anon, authenticated;

drop trigger if exists trg_cost_item_coding on public.project_cost_items;
create trigger trg_cost_item_coding
  before insert or update on public.project_cost_items
  for each row execute function public.enforce_cost_item_coding();

drop trigger if exists trg_cost_item_no_truncate on public.project_cost_items;
create trigger trg_cost_item_no_truncate
  before truncate on public.project_cost_items
  for each statement execute function public.enforce_cost_item_coding();

revoke truncate on table public.project_cost_items from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_cost_item — the write path. One function, INSERT or REVISE, because
-- the refusals are identical and duplicating them is how two sets of rules
-- drift.
-- ---------------------------------------------------------------------------
create or replace function public.record_cost_item(
  p_case_id uuid,
  p_item jsonb
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
  v_ref text := nullif(btrim(coalesce(p_item->>'cost_item_ref','')), '');
  v_wbs_code text := nullif(btrim(coalesce(p_item->>'wbs_code','')), '');
  v_cbs_code text := nullif(btrim(coalesce(p_item->>'cbs_code','')), '');
  v_desc text := nullif(btrim(coalesce(p_item->>'description','')), '');
  v_basis text := nullif(btrim(coalesce(p_item->>'basis','')), '');
  v_cont_basis text := nullif(btrim(coalesce(p_item->>'contingency_basis','')), '');
  -- STATED OR INHERITED, never defaulted to a constant. An omitted currency
  -- on a REVISE means "unchanged", and on an INSERT means "the business
  -- case's". A silent 'CAD' here re-denominated a USD line whenever a caller
  -- updated an actual without re-sending every field.
  v_currency_raw text := nullif(btrim(coalesce(p_item->>'currency','')), '');
  v_currency text;
  w project_wbs_elements%rowtype;
  b project_cbs_codes%rowtype;
  bc business_cases%rowtype;
  v_bcase bigint;
  v_bcase_count int;
  v_bcase_refs text;
  v_amounts text[] := array['baseline_cost','commitment','actual','forecast','contingency'];
  v_name text;
  v_raw text;
  v_val numeric;
  v_parsed numeric[] := array[null, null, null, null, null]::numeric[];
  i int;
  existing project_cost_items%rowtype;
  v_id uuid;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a cost line requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error', 'a cost line carries its reference (cost_item_ref)');
  end if;
  if v_desc is null or length(v_desc) < 5 then
    return jsonb_build_object('error', 'describe what this line pays for (description, 5 characters minimum)');
  end if;
  if v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'state the basis for these figures (basis, 10 characters minimum) — a cost with no stated basis is the class of number this repository has retracted before');
  end if;

  -- THE REFUSAL THE ROW DEMANDS: an unresolvable WBS code does not float.
  if v_wbs_code is null then
    return jsonb_build_object('error',
      'name the WBS element this cost is coded to (wbs_code) — an uncoded cost line is money nobody is accountable for');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = c.id and wbs_code = v_wbs_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not resolve on this case — record the WBS element first. A cost line with an unresolvable code is refused rather than parked in an unassigned bucket.', v_wbs_code));
  end if;
  if v_cbs_code is null then
    return jsonb_build_object('error', 'name the CBS code this cost is collected under (cbs_code)');
  end if;
  select * into b from project_cbs_codes
   where development_case_id = c.id and cbs_code = v_cbs_code;
  if not found then
    return jsonb_build_object('error',
      format('CBS code "%s" does not resolve on this case — record it first', v_cbs_code));
  end if;

  -- Amounts: parse-or-refuse, finite-or-refuse, non-negative-or-refuse.
  for i in 1 .. array_length(v_amounts, 1) loop
    v_name := v_amounts[i];
    v_raw := nullif(btrim(coalesce(p_item->>v_name, '')), '');
    if v_raw is null then
      continue;
    end if;
    v_val := sync_text_as_numeric(v_raw);
    if v_val is null then
      return jsonb_build_object('error', format('%s "%s" is not a number', v_name, v_raw));
    end if;
    if v_val = 'NaN'::numeric or v_val = 'Infinity'::numeric or v_val = '-Infinity'::numeric then
      return jsonb_build_object('error',
        format('%s is %s; a cost figure must be a finite number', v_name, v_val));
    end if;
    if v_val < 0 then
      return jsonb_build_object('error',
        format('%s is %s; a cost figure cannot be negative — a credit is a separate line, not a negative one', v_name, v_val));
    end if;
    v_parsed[i] := v_val;
  end loop;

  -- The Slice 2 anchor. Exactly one business case per development case is
  -- the family's shape; if none is recorded the line is refused, because a
  -- control line under no economics is the second cost store this file
  -- exists not to become.
  -- The Slice 2 anchor, resolved the way the rest of the family resolves it
  -- (order by created_at DESC, id DESC — 20261115090200:703,
  -- 20261115090400:221, 20261115090500:86/241) so a line and the finance
  -- model never point at different business cases. And when there is MORE
  -- than one, this refuses instead of choosing: nothing enforces one business
  -- case per development case, and a silent pick made every figure derived
  -- from it an artefact of which row was found first.
  select count(*), string_agg(case_ref, ', ' order by created_at desc, id desc)
    into v_bcase_count, v_bcase_refs
  from business_cases where organization_id = v_org and development_case_id = c.id;
  if coalesce(v_bcase_count, 0) = 0 then
    return jsonb_build_object('error',
      'this case has no recorded business case, so a cost line has nothing to decompose. Record the business case first (Slice 2) — cost control lines sit UNDER the economics, they do not replace them.');
  end if;
  if v_bcase_count > 1 then
    return jsonb_build_object('error',
      format('this development case carries %s business cases (%s), so which economics this line decomposes is not decided. A cost line anchors to ONE business case; choosing one here would make every reconciliation an artefact of that choice.',
             v_bcase_count, v_bcase_refs));
  end if;
  select * into bc from business_cases
   where organization_id = v_org and development_case_id = c.id
   order by created_at desc, id desc limit 1;
  v_bcase := bc.id;

  -- ONE CURRENCY. The line decomposes THIS business case, so it is
  -- denominated in that case's currency; an explicit disagreement is refused
  -- by name rather than summed into a variance that is an exchange rate.
  if v_currency_raw is not null and v_currency_raw <> bc.currency then
    return jsonb_build_object('error',
      format('this line is stated in %s but the business case it decomposes (%s) is in %s — a cost line and its business case reconcile in one currency, or their difference is an exchange rate reported as a project variance.',
             v_currency_raw, bc.case_ref, bc.currency));
  end if;
  v_currency := bc.currency;

  if v_parsed[5] is not null and (v_cont_basis is null or length(v_cont_basis) < 10) then
    return jsonb_build_object('error',
      'contingency carries its basis (contingency_basis, 10 characters minimum) — how much risk it covers and why that much');
  end if;

  -- The door names itself BEFORE the lookup: PERFORM resets FOUND, so a
  -- set_config between the SELECT INTO and the `if found` would make every
  -- insert look like a revision of a row that is not there.
  perform set_config('app.cost_item_write', 'granted', true);

  select * into existing from project_cost_items
   where development_case_id = c.id and cost_item_ref = v_ref;

  if found then
    v_prev := jsonb_build_object(
      'baseline_cost', existing.baseline_cost, 'commitment', existing.commitment,
      'actual', existing.actual, 'forecast', existing.forecast,
      'contingency', existing.contingency, 'wbs_code', v_wbs_code,
      -- currency belongs in BOTH snapshots: a revision that changed the unit
      -- and recorded only the amounts would leave an audit trail in which the
      -- figure moved for no visible reason.
      'currency', existing.currency);
    update project_cost_items
    set cbs_code_id = b.id,
        wbs_element_id = w.id,
        description = v_desc,
        currency = v_currency,
        baseline_cost = v_parsed[1],
        commitment = v_parsed[2],
        actual = v_parsed[3],
        forecast = v_parsed[4],
        contingency = v_parsed[5],
        contingency_basis = case when v_parsed[5] is null then null else v_cont_basis end,
        basis = v_basis
    where id = existing.id
    returning id into v_id;
  else
    v_prev := null;
    insert into project_cost_items
      (organization_id, development_case_id, cost_item_ref, cbs_code_id, wbs_element_id,
       business_case_id, description, currency, baseline_cost, commitment, actual,
       forecast, contingency, contingency_basis, basis, created_by)
    values
      (v_org, c.id, v_ref, b.id, w.id, v_bcase, v_desc, v_currency,
       v_parsed[1], v_parsed[2], v_parsed[3], v_parsed[4], v_parsed[5],
       case when v_parsed[5] is null then null else v_cont_basis end, v_basis, auth.uid())
    returning id into v_id;
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_cost_item', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'cost_item_id', v_id, 'cost_item_ref', v_ref,
      'action', case when v_prev is null then 'recorded' else 'revised' end),
    v_prev,
    jsonb_build_object('cost_item_ref', v_ref, 'wbs_code', v_wbs_code, 'cbs_code', v_cbs_code,
      'currency', v_currency,
      'baseline_cost', v_parsed[1], 'commitment', v_parsed[2], 'actual', v_parsed[3],
      'forecast', v_parsed[4], 'contingency', v_parsed[5], 'basis', v_basis));

  return jsonb_build_object('cost_item_id', v_id, 'cost_item_ref', v_ref,
    'wbs_code', v_wbs_code, 'cbs_code', v_cbs_code, 'currency', v_currency,
    'revised', v_prev is not null,
    -- The roll-up point the TRIGGER stored — nearest account at or above the
    -- element. An exact-match lookup here reported "no control account" on a
    -- line whose stored roll-up point was set, i.e. the response contradicted
    -- the row it had just written.
    'control_account', (select ca.control_account_ref from project_control_accounts ca
                         where ca.id = resolve_control_account_for_wbs(w.id)));
end
$$;

revoke all on function public.record_cost_item(uuid, jsonb) from public, anon;
grant execute on function public.record_cost_item(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_case_cost_reconciliation — do the coded lines and the recorded
-- economics agree? REFUSES on either side missing OR PARTIAL, and never
-- invents the missing side.
--
-- The four ways this answer used to be filled in rather than refused, each
-- now named at the door:
--
--   1. PARTIAL BASELINE. lineBaselineTotal is the sum over lines that HAVE a
--      baseline; comparing it against the WHOLE capital figure priced every
--      un-baselined line at zero and reported "they agree". A partial
--      numerator over a whole denominator is not a reconciliation, so
--      reconciles is NULL and the count of unbaselined lines is named.
--   2. MIXED CURRENCY. The lines and the business case are two sides of one
--      subtraction; denominated differently their difference is an exchange
--      rate presented as a project variance. Refused, with the currencies
--      named, and the payload's `currency` is NULL rather than borrowed from
--      whichever row sorted first.
--   3. SEVERAL OPTIONS. Choosing an option is a decision (the Slice 2 family
--      makes the caller NAME one — 20261115090400:230). With more than one
--      real option and nothing recording a selection, this refuses with the
--      labels rather than taking the oldest; when one is used, its id and
--      label are in the payload so a reader can see WHICH.
--   4. SEVERAL BUSINESS CASES. Nothing enforces one per development case, so
--      the anchor is refused rather than guessed.
--
-- Lines outside every control account are a CAVEAT, not a blocker: the sum is
-- still the sum. It is carried into refusals so the recorded run says so —
-- the same treatment compute_case_scope_growth gives the same condition.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_cost_reconciliation(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  v_org uuid;
  c development_cases%rowtype;
  bc business_cases%rowtype;
  v_bcase_count int;
  v_bcase_refs text;
  v_option business_case_options%rowtype;
  v_option_count int;
  v_real_options int;
  v_option_labels text;
  v_capital numeric;
  v_lines int;
  v_baselined int;
  v_line_total numeric;
  v_uncoded int;
  v_currencies text[];
  v_currency text;
  v_comparable boolean := true;
  v_refusals jsonb := '[]'::jsonb;
begin
  -- THE CALLER GATE. `current_user` inside a SECURITY DEFINER owned by
  -- postgres IS postgres, never 'authenticated' — so a guard written against
  -- current_user can never fire, and a JWT holder with no user_profiles row
  -- (app_current_org() null) fell through to a query whose org filter that
  -- same NULL had switched off. auth.uid() is the honest discriminator: a
  -- caller holding a JWT but no organization is refused; a true service
  -- caller (no JWT) reads through, which is what the definer callers need.
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select count(*), count(*) filter (where baseline_cost is not null),
         sum(baseline_cost) filter (where baseline_cost is not null),
         array_agg(distinct currency)
    into v_lines, v_baselined, v_line_total, v_currencies
  from project_cost_items where development_case_id = c.id;

  select count(*) into v_uncoded
  from project_cost_items where development_case_id = c.id and control_account_id is null;

  select count(*), string_agg(case_ref, ', ' order by created_at desc, id desc)
    into v_bcase_count, v_bcase_refs
  from business_cases where organization_id = v_org and development_case_id = c.id;

  if coalesce(v_bcase_count, 0) = 0 then
    v_comparable := false;
    v_refusals := v_refusals || to_jsonb(
      'no business case is recorded on this case, so the cost lines reconcile against nothing. Record the business case (Slice 2) — this figure is not computed from the lines alone, because that would make the lines their own justification.'::text);
  elsif v_bcase_count > 1 then
    v_comparable := false;
    v_refusals := v_refusals || to_jsonb(format(
      'this development case carries %s business cases (%s). Which economics the cost lines decompose is not recorded, and picking one would make the whole reconciliation an artefact of that pick.',
      v_bcase_count, v_bcase_refs)::text);
  else
    select * into bc from business_cases
     where organization_id = v_org and development_case_id = c.id
     order by created_at desc, id desc limit 1;

    select count(*), count(*) filter (where is_do_nothing = false),
           string_agg(label, ', ') filter (where is_do_nothing = false)
      into v_option_count, v_real_options, v_option_labels
    from business_case_options where case_id = bc.id;

    if coalesce(v_option_count, 0) = 0 then
      v_comparable := false;
      v_refusals := v_refusals || to_jsonb(
        'the business case records no option, so it states no capital cost to reconcile against.'::text);
    elsif coalesce(v_real_options, 0) = 0 then
      v_comparable := false;
      v_refusals := v_refusals || to_jsonb(
        'the business case records only a do-nothing option, which states no capital spend to reconcile against.'::text);
    elsif v_real_options > 1 then
      v_comparable := false;
      v_refusals := v_refusals || to_jsonb(format(
        'the business case records %s options that spend money (%s) and nothing records which one is the plan of record. Reconciling against one of them would compare the cost lines with an option nobody chose.',
        v_real_options, v_option_labels)::text);
    else
      select * into v_option from business_case_options
       where case_id = bc.id and is_do_nothing = false limit 1;
      select sum(-(f->>'amount')::numeric) into v_capital
      from jsonb_array_elements(v_option.cash_flows) f
      where coalesce((f->>'period')::int, -1) = 0
        and coalesce((f->>'amount')::numeric, 0) < 0;
      if v_capital is null then
        v_comparable := false;
        v_refusals := v_refusals || to_jsonb(format(
          'option "%s" records no period-0 outflow, so it states no capital cost to reconcile against.',
          v_option.label)::text);
      end if;
    end if;
  end if;

  -- One currency, or no subtraction.
  if coalesce(array_length(v_currencies, 1), 0) > 1 then
    v_comparable := false;
    v_currency := null;
    v_refusals := v_refusals || to_jsonb(format(
      'the cost lines on this case are denominated in %s different currencies (%s). They are not addable, so there is no line total to compare — record them in one currency or reconcile them separately.',
      array_length(v_currencies, 1), array_to_string(v_currencies, ', '))::text);
  else
    v_currency := coalesce(v_currencies[1], bc.currency);
    if bc.id is not null and v_currencies[1] is not null and v_currencies[1] <> bc.currency then
      v_comparable := false;
      v_refusals := v_refusals || to_jsonb(format(
        'the cost lines are stated in %s and the business case in %s — their difference would be an exchange rate reported as a project variance.',
        v_currencies[1], bc.currency)::text);
    end if;
  end if;

  if v_lines = 0 then
    v_comparable := false;
    v_refusals := v_refusals || to_jsonb(
      'no cost lines are coded on this case, so there is nothing to reconcile. A reconciliation over zero lines is not agreement.'::text);
  elsif v_baselined = 0 then
    v_comparable := false;
    v_refusals := v_refusals || to_jsonb(
      format('%s cost line(s) exist but none carries a baseline cost, so their total is not a baseline total.', v_lines)::text);
  elsif v_baselined < v_lines then
    -- THE ZERO THAT USED TO BE SILENT. Comparing a sum over the baselined
    -- lines against the whole capital figure prices every other line at zero
    -- and can report "they agree" while most of the cost is missing.
    v_comparable := false;
    v_refusals := v_refusals || to_jsonb(
      format('%s of %s cost line(s) carry no baseline cost. The line total covers only the %s that do, so it cannot be compared with the whole capital figure — the difference would count the others as zero.',
             v_lines - v_baselined, v_lines, v_baselined)::text);
  end if;

  if v_uncoded > 0 then
    v_refusals := v_refusals || to_jsonb(format(
      '%s cost line(s) sit outside every control account, so this total is money with no accountable roll-up point behind part of it (D5.02 lists them).', v_uncoded)::text);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'lineCount', v_lines,
    'baselinedLineCount', v_baselined,
    -- NULL, never 0, when nothing is baselined: a zero here would read as
    -- "the project is baselined at nothing".
    'lineBaselineTotal', case when v_baselined = 0 then null else v_line_total end,
    'linesOutsideAControlAccount', v_uncoded,
    'businessCaseRef', case when bc.id is null then null else bc.case_ref end,
    'businessCaseCapital', v_capital,
    'optionId', case when v_option.id is null then null else v_option.id end,
    'optionLabel', case when v_option.id is null then null else v_option.label end,
    -- NULL when the lines are not addable: a currency taken from whichever
    -- row sorted first labels a total that is not in that unit.
    'currency', v_currency,
    'variance', case when v_comparable and v_capital is not null
                     then v_line_total - v_capital else null end,
    'reconciles', case when v_comparable and v_capital is not null
                       then abs(v_line_total - v_capital) < 0.005 else null end,
    'refusals', v_refusals);
end
$$;

revoke all on function public.get_case_cost_reconciliation(uuid) from public, anon;
grant execute on function public.get_case_cost_reconciliation(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
