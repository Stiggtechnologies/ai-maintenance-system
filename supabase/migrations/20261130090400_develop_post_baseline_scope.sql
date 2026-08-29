-- ============================================================================
-- Sync Develop Slice 4A — post-baseline scope cost attribution (D5.03,
-- spec I.6).
--
-- THE SENTENCE THIS FILE HAS TO MAKE ANSWERABLE FROM DATA, verbatim from
-- spec I.6: "$2.3M of current forecast is associated with scope added after
-- Gate 2."
--
-- Four things have to be true for that sentence to be honest, and each is
-- enforced rather than assumed:
--
--   1. THERE IS A BASELINE TO BE "AFTER". No approved SCOPE baseline → no
--      growth figure, and the refusal says exactly that. Growth measured
--      against nothing is not growth, it is an inventory. The baseline is
--      the Slice 1 object (development_baselines, D5.26) — this file
--      creates no second baseline concept, it attributes TO one.
--
--   2. THE ATTRIBUTION IS TO A SPECIFIC BASELINE VERSION, and the scope
--      must actually postdate it. A row claiming to be post-baseline growth
--      whose added_at precedes the baseline's approval is refused at the
--      persistence boundary for every writer — that is not a permission
--      question, it is arithmetic that would otherwise be wrong.
--
--   3. THE COST IS STATED, FINITE, AND CARRIES ITS BASIS. Never derived,
--      never defaulted to zero. A scope addition whose cost nobody has
--      estimated is recorded with cost_effect NULL and reports as
--      "cost not yet estimated" — which is the honest state and is counted
--      separately, so the headline figure never silently absorbs it.
--
--   4. THE SCOPE IS REAL SCOPE. Every attribution names the WBS element it
--      lands on (resolved, or refused), so growth is traceable to the same
--      chain everything else in this slice uses. Free-floating growth would
--      be a second scope record.
--
-- §70 AND THE CHANGE-CONTROL BOUNDARY. Recording that scope was added is an
-- OBSERVATION and the planning roles may make it. Deciding whether that
-- addition is an APPROVED change against the baseline is change control
-- (D5.27, the MOC machinery, Slice 4B) and is NOT decided here: the row
-- carries approved_change_ref as a nullable FACT and
-- get_case_scope_growth reports approved and unapproved growth SEPARATELY.
-- Unapproved growth showing up as a number is the point — it is what
-- "scope appears to have changed without a corresponding approved change
-- request" (spec I.7) looks like in data. The AI-operator identity may
-- record an observation and may NOT mark one approved: attaching an
-- approved-change reference asserts a governance act happened, which is the
-- determination class §70 reserves.
--
-- Canonical reuse: development_baselines (D5.26), project_wbs_elements,
-- project_cost_items, development_cases, audit_events, security_events.
-- ============================================================================

create table if not exists public.project_scope_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- The anchor. RESTRICT, not CASCADE: growth attributed to a baseline
  -- outlives nothing — deleting the reference would silently re-date every
  -- attribution hanging off it.
  baseline_id uuid not null references development_baselines(id) on delete restrict,
  change_ref text not null check (btrim(change_ref) <> ''),
  wbs_element_id uuid not null references project_wbs_elements(id) on delete restrict,
  scope_need_id uuid references project_scope_needs(id) on delete set null,
  description text not null check (length(btrim(description)) >= 10),
  -- Why the scope arrived. Deterministic vocabulary, no free text: this is
  -- what a scope-growth report groups by.
  origin text not null check (origin in
    ('design_development','regulatory','stakeholder_commitment','error_correction',
     'field_condition','owner_request','risk_treatment','interface')),
  added_at timestamptz not null,
  -- Cost is stated or absent. Absent is a real state, counted separately.
  cost_effect numeric,
  cost_basis text,
  currency text not null default 'CAD' check (btrim(currency) <> ''),
  -- The change-control fact, never a determination made here.
  approved_change_ref text,
  approved_change_recorded_by uuid references auth.users(id),
  approved_change_recorded_at timestamptz,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, change_ref),
  constraint scope_change_cost_finite check (
    cost_effect is null
    or (cost_effect > '-Infinity'::numeric and cost_effect < 'Infinity'::numeric)
  ),
  -- A cost with no basis is the number class this repository has retracted.
  constraint scope_change_cost_basis check (
    cost_effect is null or coalesce(length(btrim(cost_basis)), 0) >= 10
  ),
  constraint scope_change_added_finite check (isfinite(added_at)),
  constraint scope_change_approval_pair check (
    (approved_change_ref is null)
      = (approved_change_recorded_by is null and approved_change_recorded_at is null)
  )
);

create index if not exists idx_scope_change_case
  on project_scope_changes(organization_id, development_case_id, added_at);
create index if not exists idx_scope_change_baseline
  on project_scope_changes(baseline_id);

alter table public.project_scope_changes enable row level security;
drop policy if exists project_scope_changes_read on public.project_scope_changes;
create policy project_scope_changes_read on public.project_scope_changes
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

comment on table public.project_scope_changes is
  'D5.03 (spec I.6): scope added AFTER an approved baseline, attributed to that baseline version with its cost and basis. Answers "what did scope growth cost" from data; carries whether an approved change request exists as a FACT, never as a determination made here.';

-- ---------------------------------------------------------------------------
-- The attribution wall. Refused for EVERY writer, INSERT and UPDATE:
--   * the baseline must be an APPROVED (or since-superseded) SCOPE baseline
--     of the same case — attributing growth to a draft, or to another
--     case's baseline, produces a number that is simply wrong;
--   * added_at must be AFTER that baseline's approval instant. "Post-
--     baseline" is the whole claim of the row.
-- DELETE is guarded too: erasing an attribution is the cheapest way to make
-- scope growth disappear, so a client cannot, and a service caller is
-- admitted AND audited.
--
-- AND SO ARE THE THREE approved_change_* COLUMNS. §70 reserves "an approved
-- change request covers this" to a human, and that wall lived only at the RPC
-- door — an RLS-bypassing UPDATE could stamp CR-FORGED across every
-- attribution and silently zero get_case_scope_growth's "N addition(s) name
-- no approved change request" signal (spec I.7), the exact signal this file
-- exists to raise. A client is refused; a service caller is admitted AND
-- audited, the Slice 3 backstop shape.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_post_baseline_scope()
returns trigger
language plpgsql
as $$
declare
  b development_baselines%rowtype;
  v_marker text := coalesce(current_setting('app.scope_change_write', true), '');
  v_service boolean := (auth.uid() is null and current_user not in ('authenticated', 'anon'));
  v_approval_changed boolean := false;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'project_scope_changes is the record of what scope was added after a baseline was approved; truncating it makes every tenant''s scope growth disappear in one statement, which the row-level guard below cannot refuse.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    v_approval_changed :=
      new.approved_change_ref is distinct from old.approved_change_ref
      or new.approved_change_recorded_by is distinct from old.approved_change_recorded_by
      or new.approved_change_recorded_at is distinct from old.approved_change_recorded_at;
  end if;

  if tg_op = 'INSERT' and new.approved_change_ref is not null and v_service
     and v_marker <> 'granted' then
    v_approval_changed := true;
  end if;

  if v_approval_changed then
    if v_service then
      if v_marker <> 'granted'
         and exists (select 1 from organizations where id = new.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (new.organization_id, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'The approved-change reference on scope attribution ' || new.change_ref ||
             ' was set to ' || coalesce(new.approved_change_ref, 'null') ||
             ' by a service caller. Asserting that an approved change request '
             'covers a scope addition is a governance determination (spec §70); '
             'doing it here removes that addition from the "changed without an '
             'approved change request" signal without any recorded act.');
      end if;
    elsif v_marker <> 'granted' then
      raise exception
        'whether an approved change request covers this scope addition is a governance determination (spec §70) — it is recorded through attribute_post_baseline_scope, never written onto the row.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'DELETE' then
    if v_service then
      if v_marker <> 'granted'
         and exists (select 1 from organizations where id = old.organization_id) then
        insert into security_events
          (organization_id, actor_id, actor_label, event_type, severity, detail)
        values
          (old.organization_id, null, 'service (' || current_user || ')',
           'admin_action', 'warning',
           'Post-baseline scope attribution ' || old.change_ref || ' deleted by a '
             || 'service caller. Deleting an attribution removes cost from the '
             || 'scope-growth answer without changing a single figure, which is '
             || 'why the deletion is recorded here (D5.03).');
      end if;
      return old;
    end if;
    raise exception
      'a post-baseline scope attribution is not deletable — scope growth that is erased stops being growth. Record a correcting attribution instead.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE'
     and new.baseline_id is not distinct from old.baseline_id
     and new.added_at is not distinct from old.added_at
     and new.development_case_id is not distinct from old.development_case_id then
    return new;
  end if;

  select * into b from development_baselines where id = new.baseline_id;
  if not found then
    raise exception 'the baseline this scope is attributed to does not exist'
      using errcode = 'check_violation';
  end if;
  if b.development_case_id <> new.development_case_id then
    raise exception
      'that baseline belongs to a different development case — scope growth is measured against ITS case''s baseline'
      using errcode = 'check_violation';
  end if;
  if b.baseline_type <> 'SCOPE' then
    raise exception
      'scope growth is attributed to a SCOPE baseline, not a % one — the other five baseline types anchor other questions',
      b.baseline_type
      using errcode = 'check_violation';
  end if;
  if b.approved_at is null then
    raise exception
      'that baseline is still a draft, so nothing can be "after" it. Approve the scope baseline first (approve_case_baseline).'
      using errcode = 'check_violation';
  end if;
  if new.added_at <= b.approved_at then
    raise exception
      'this scope was added at %, which is at or before the baseline was approved at % — it is baseline scope, not growth. Attributing it as growth would overstate what scope change has cost.',
      new.added_at, b.approved_at
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_post_baseline_scope() from public, anon, authenticated;

drop trigger if exists trg_post_baseline_scope on public.project_scope_changes;
create trigger trg_post_baseline_scope
  before insert or update or delete on public.project_scope_changes
  for each row execute function public.enforce_post_baseline_scope();

drop trigger if exists trg_post_baseline_scope_no_truncate on public.project_scope_changes;
create trigger trg_post_baseline_scope_no_truncate
  before truncate on public.project_scope_changes
  for each statement execute function public.enforce_post_baseline_scope();

revoke truncate on table public.project_scope_changes from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The write path.
-- ---------------------------------------------------------------------------
create or replace function public.attribute_post_baseline_scope(
  p_case_id uuid,
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
  c development_cases%rowtype;
  b development_baselines%rowtype;
  v_ref text := nullif(btrim(coalesce(p_change->>'change_ref','')), '');
  v_desc text := nullif(btrim(coalesce(p_change->>'description','')), '');
  v_origin text := nullif(btrim(coalesce(p_change->>'origin','')), '');
  v_wbs_code text := nullif(btrim(coalesce(p_change->>'wbs_code','')), '');
  v_added_raw text := nullif(btrim(coalesce(p_change->>'added_at','')), '');
  v_added timestamptz;
  v_cost_raw text := nullif(btrim(coalesce(p_change->>'cost_effect','')), '');
  v_cost numeric;
  v_cost_basis text := nullif(btrim(coalesce(p_change->>'cost_basis','')), '');
  v_approved_ref text := nullif(btrim(coalesce(p_change->>'approved_change_ref','')), '');
  v_currency text := coalesce(nullif(btrim(coalesce(p_change->>'currency','')), ''), 'CAD');
  w project_wbs_elements%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording post-baseline scope requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- 1. The baseline must exist. This is the refusal the row lives or dies on.
  select * into b from development_baselines
   where development_case_id = c.id and baseline_type = 'SCOPE' and status = 'approved'
   order by version desc limit 1;
  if not found then
    return jsonb_build_object('error',
      'this case has no approved SCOPE baseline, so nothing can be attributed as scope added AFTER one. Approve a scope baseline first — growth measured against nothing is an inventory, not growth.');
  end if;

  if v_ref is null then
    return jsonb_build_object('error', 'a scope addition carries its reference (change_ref)');
  end if;
  if v_desc is null or length(v_desc) < 10 then
    return jsonb_build_object('error',
      'state what scope was added (description, 10 characters minimum)');
  end if;
  if v_origin is null or v_origin not in
     ('design_development','regulatory','stakeholder_commitment','error_correction',
      'field_condition','owner_request','risk_treatment','interface') then
    return jsonb_build_object('error',
      'origin must be one of: design_development, regulatory, stakeholder_commitment, error_correction, field_condition, owner_request, risk_treatment, interface');
  end if;
  if v_wbs_code is null then
    return jsonb_build_object('error',
      'name the WBS element this scope lands on (wbs_code) — growth that codes to nothing cannot be traced or costed');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = c.id and wbs_code = v_wbs_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not resolve on this case — record the element the new scope belongs to first', v_wbs_code));
  end if;
  if v_added_raw is null then
    return jsonb_build_object('error',
      'state when this scope was added (added_at) — "after the baseline" is a claim about a date');
  end if;
  v_added := sync_text_as_timestamptz(v_added_raw);
  if v_added is null then
    return jsonb_build_object('error', format('added_at "%s" is not a date', v_added_raw));
  end if;
  if not isfinite(v_added) then
    return jsonb_build_object('error',
      format('added_at is %s; a date must be a finite calendar instant', v_added));
  end if;
  if v_added <= b.approved_at then
    return jsonb_build_object('error',
      format('that scope was added on %s, at or before the SCOPE baseline v%s was approved on %s — it is baseline scope, not growth',
             v_added, b.version, b.approved_at));
  end if;

  if v_cost_raw is not null then
    v_cost := sync_text_as_numeric(v_cost_raw);
    if v_cost is null then
      return jsonb_build_object('error', format('cost_effect "%s" is not a number', v_cost_raw));
    end if;
    if v_cost = 'NaN'::numeric or v_cost = 'Infinity'::numeric or v_cost = '-Infinity'::numeric then
      return jsonb_build_object('error',
        format('cost_effect is %s; a cost effect must be a finite number', v_cost));
    end if;
    if v_cost_basis is null or length(v_cost_basis) < 10 then
      return jsonb_build_object('error',
        'a stated cost carries its basis (cost_basis, 10 characters minimum). Leave cost_effect empty if it has not been estimated — the report counts un-costed additions separately rather than treating them as zero.');
    end if;
  end if;

  -- §70: asserting that an approved change request exists is a governance
  -- claim, not an observation.
  if v_approved_ref is not null and coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity may record that scope was added, and may not assert that an approved change request covers it — that is a governance determination (spec §70)');
  end if;

  if exists (select 1 from project_scope_changes
             where development_case_id = c.id and change_ref = v_ref) then
    return jsonb_build_object('error',
      format('scope change reference "%s" already exists on this case', v_ref));
  end if;

  perform set_config('app.scope_change_write', 'granted', true);
  insert into project_scope_changes
    (organization_id, development_case_id, baseline_id, change_ref, wbs_element_id,
     description, origin, added_at, cost_effect, cost_basis, currency,
     approved_change_ref, approved_change_recorded_by, approved_change_recorded_at,
     recorded_by)
  values
    (v_org, c.id, b.id, v_ref, w.id, v_desc, v_origin, v_added, v_cost,
     case when v_cost is null then null else v_cost_basis end, v_currency,
     v_approved_ref,
     case when v_approved_ref is null then null else auth.uid() end,
     case when v_approved_ref is null then null else now() end,
     auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_scope_change', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'scope_change_id', v_id, 'change_ref', v_ref,
      'action', 'attributed', 'baseline_id', b.id, 'baseline_version', b.version),
    null,
    jsonb_build_object('change_ref', v_ref, 'wbs_code', v_wbs_code, 'origin', v_origin,
      'added_at', v_added, 'cost_effect', v_cost, 'approved_change_ref', v_approved_ref));

  return jsonb_build_object('scope_change_id', v_id, 'change_ref', v_ref,
    'baseline_version', b.version, 'wbs_code', v_wbs_code,
    'cost_effect', v_cost, 'approved', v_approved_ref is not null);
end
$$;

revoke all on function public.attribute_post_baseline_scope(uuid, jsonb) from public, anon;
grant execute on function public.attribute_post_baseline_scope(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_case_scope_growth — the answer, or the refusal.
--
-- WHY THE PRIOR VERSIONS ARE IN THE PAYLOAD. The figure is growth since the
-- CURRENTLY approved SCOPE baseline, which is the question spec I.6 asks
-- ("scope added after Gate 2"). But approving v2 supersedes v1, and every
-- attribution made against v1 then fell out of the answer entirely: a case
-- with $2.3M of recorded growth reported "0 additions" the instant it was
-- re-baselined, while the D5.04 `changes` structure still counted two rows.
-- Two answers to one question at the same instant, and no product path to
-- re-point a stranded attribution (the rows are client-immutable).
--
-- Growth that was folded INTO v2 is genuinely no longer growth against v2 —
-- so it is not silently added to the headline. It is reported BESIDE it, per
-- superseded version, with its own total, and named in a caveat. Nothing
-- disappears; nothing is double-counted.
--
-- The dual-caller shape, because compute_case_scope_growth (20261130090600)
-- reads it from inside a definer as well. The discriminator is auth.uid():
-- current_user inside a definer owned by postgres is postgres, so a guard
-- written against current_user never fires (see 20261130090300's header).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_scope_growth(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_org uuid := app_current_org();
  c development_cases%rowtype;
  b development_baselines%rowtype;
  v_items jsonb;
  v_by_origin jsonb;
  v_prior jsonb;
  v_prior_count int;
  v_prior_total numeric;
  v_total numeric;
  v_approved_total numeric;
  v_unapproved_total numeric;
  v_count int;
  v_uncosted int;
  v_unapproved int;
  v_currencies text[];
  v_currency text;
  v_cost_refusal text;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  -- `order by version desc limit 1` rather than a bare SELECT INTO: the query
  -- is single-row today only because of the partial unique index
  -- idx_dev_baseline_one_approved. If that ever moves, an unordered SELECT
  -- INTO takes an arbitrary row instead of failing.
  select * into b from development_baselines
   where development_case_id = c.id and baseline_type = 'SCOPE' and status = 'approved'
   order by version desc limit 1;
  if not found then
    return jsonb_build_object(
      'caseId', c.id,
      'evaluable', false,
      'refusal',
      'This case has no approved SCOPE baseline. "What did scope growth cost" is a question about change from a fixed reference, and no reference is fixed — so there is no figure to give, and a total of the scope recorded so far would not be one.');
  end if;

  select count(*), count(*) filter (where cost_effect is null),
         count(*) filter (where approved_change_ref is null),
         sum(cost_effect),
         sum(cost_effect) filter (where approved_change_ref is not null),
         sum(cost_effect) filter (where approved_change_ref is null),
         array_agg(distinct currency) filter (where cost_effect is not null)
    into v_count, v_uncosted, v_unapproved, v_total, v_approved_total, v_unapproved_total,
         v_currencies
  from project_scope_changes
  where development_case_id = c.id and baseline_id = b.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', sc.id, 'changeRef', sc.change_ref, 'description', sc.description,
    'origin', sc.origin, 'addedAt', sc.added_at,
    'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = sc.wbs_element_id),
    'costEffect', sc.cost_effect, 'costBasis', sc.cost_basis, 'currency', sc.currency,
    'approvedChangeRef', sc.approved_change_ref,
    'recordedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = sc.recorded_by))
    order by sc.added_at desc), '[]'::jsonb)
  into v_items
  from project_scope_changes sc
  where sc.development_case_id = c.id and sc.baseline_id = b.id;

  select coalesce(jsonb_object_agg(o.origin, o.figures), '{}'::jsonb) into v_by_origin
  from (
    select sc.origin,
           jsonb_build_object('count', count(*),
             'costed', count(*) filter (where sc.cost_effect is not null),
             'costTotal', sum(sc.cost_effect)) as figures
    from project_scope_changes sc
    where sc.development_case_id = c.id and sc.baseline_id = b.id
    group by sc.origin) o;

  -- Everything attributed to a SUPERSEDED version of this case's scope
  -- baseline. Not added to the headline; never dropped from the record.
  select count(*), sum(sc.cost_effect) into v_prior_count, v_prior_total
  from project_scope_changes sc
  where sc.development_case_id = c.id and sc.baseline_id <> b.id;

  select coalesce(jsonb_agg(p.payload order by p.version desc), '[]'::jsonb) into v_prior
  from (
    select pb.version,
           jsonb_build_object('baselineId', pb.id, 'version', pb.version,
             'status', pb.status, 'approvedAt', pb.approved_at,
             'additionCount', count(*),
             'costTotal', sum(sc.cost_effect),
             'uncostedCount', count(*) filter (where sc.cost_effect is null)) as payload
    from project_scope_changes sc
    join development_baselines pb on pb.id = sc.baseline_id
    where sc.development_case_id = c.id and sc.baseline_id <> b.id
    group by pb.id, pb.version, pb.status, pb.approved_at) p;

  -- ONE CURRENCY OR NO TOTAL. Summing 1,000,000 CAD and 1,000,000 USD into
  -- "2,000,000" and rendering it without a unit is a fabricated figure, so
  -- the total refuses and names the currencies instead.
  if v_count = 0 then
    v_cost_refusal := null;
  elsif v_count = v_uncosted then
    v_cost_refusal := format(
      '%s scope addition(s) since the baseline, none of them costed — so there is a count, not a figure.', v_count);
  elsif coalesce(array_length(v_currencies, 1), 0) > 1 then
    v_cost_refusal := format(
      'the costed additions are recorded in %s different currencies (%s), which are not addable — there is no single growth figure until they are reconciled to one.',
      array_length(v_currencies, 1), array_to_string(v_currencies, ', '));
  else
    v_currency := v_currencies[1];
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'evaluable', true,
    'baseline', jsonb_build_object('id', b.id, 'version', b.version,
      'approvedAt', b.approved_at,
      'approvedBy', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = b.approved_by),
      'description', b.description),
    'additionCount', v_count,
    -- NULL, never 0, when there is no addable total: "nothing has been
    -- priced" / "these are not one currency" / "growth cost nothing" are
    -- three different statements.
    'costTotal', case when v_cost_refusal is not null then null else v_total end,
    'costTotalRefusal', v_cost_refusal,
    'currency', v_currency,
    'approvedCostTotal', case when v_cost_refusal is not null then null else v_approved_total end,
    'unapprovedCostTotal', case when v_cost_refusal is not null then null else v_unapproved_total end,
    'uncostedCount', v_uncosted,
    'unapprovedCount', v_unapproved,
    'byOrigin', v_by_origin,
    'additions', v_items,
    'priorBaselines', jsonb_build_object(
      'additionCount', coalesce(v_prior_count, 0),
      'costTotal', v_prior_total,
      'versions', v_prior),
    'caveats', (
      case when v_count = 0 then
        jsonb_build_array('No scope has been attributed to this baseline yet, so the growth cost is zero recorded additions — not a measured zero.')
      else '[]'::jsonb end
      || case when v_cost_refusal is not null and v_count > 0 then
        jsonb_build_array(v_cost_refusal)
      else '[]'::jsonb end
      || case when v_uncosted > 0 and v_uncosted < v_count then
        jsonb_build_array(format('%s of %s additions carry no cost estimate; their cost is NOT in the total, which therefore understates growth by an unknown amount.', v_uncosted, v_count))
      else '[]'::jsonb end
      || case when v_unapproved > 0 then
        jsonb_build_array(format('%s addition(s) name no approved change request — scope that appears to have changed without one (spec I.7). Whether that constitutes a scope change is a human determination, not this report''s.', v_unapproved))
      else '[]'::jsonb end
      || case when coalesce(v_prior_count, 0) > 0 then
        jsonb_build_array(format('%s further addition(s) are attributed to superseded SCOPE baseline version(s) and are NOT in this figure — they were folded into version %s when it was approved. They are listed under priorBaselines so re-baselining cannot make recorded growth disappear.',
                                 v_prior_count, b.version))
      else '[]'::jsonb end));
end
$$;

revoke all on function public.get_case_scope_growth(uuid) from public, anon;
grant execute on function public.get_case_scope_growth(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
