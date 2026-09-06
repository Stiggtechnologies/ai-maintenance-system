-- ============================================================================
-- Sync Develop Slice 4A — the calculation service with recorded lineage
-- (D11.29, spec §71–78) and the Integrated Controls read.
--
-- THE SPEC'S SENTENCE: "Calculation service (cost forecasting, schedule
-- calcs, Monte Carlo, Weibull, availability, lifecycle economics, risk
-- models) — every calculation records method, version, inputs, outputs,
-- timestamp."
--
-- WHAT WAS ALREADY TRUE, AND WHAT WAS NOT. The register row is precise:
-- stated-basis discipline is pervasive (asset_economics.basis NOT NULL,
-- discount_rate_source, refusal-wrapped KPIs, reasoned refusals in every
-- kernel). What was missing is a UNIFORM RECORD — a row you can open from a
-- displayed number that says which method produced it, from which inputs,
-- under which code version, at which instant, and WHAT IT REFUSED on the
-- way. The kernels ARE the calculation service; this is the ledger they
-- write to.
--
-- THE FIFTH FIELD IS THE ONE THAT MATTERS HERE. Method, version, inputs,
-- timestamp are the spec's four. This slice records a fifth, REFUSALS,
-- because a controls number that came back partial is the normal case in
-- this product, not the exception: "the total excludes 3 un-costed
-- additions" is part of what the number MEANS, and a lineage record that
-- dropped it would make a caveated figure indistinguishable from a complete
-- one the moment it was written down.
--
-- IMMUTABILITY — the Slice 2 pattern (recorded evaluations), not the
-- audit_events pattern. A client cannot update or delete a run; a service
-- caller is admitted AND AUDITED into security_events. TRUNCATE is refused
-- by a statement-level trigger and the verb revoked, because a row-level
-- trigger never fires for it (20261121090000's lesson) and one statement
-- would erase every defensible number's defence.
--
-- THE VERSION IS SERVER-SIDE. code_version comes from
-- sync_calculation_code_version(), never from the caller: a lineage record
-- whose version the caller supplies certifies nothing. The TypeScript side
-- exports the same constant (src/lib/develop/controls.ts) and the slice test
-- pins the two together, so a version bump cannot land on one side only.
--
-- THE RUN IS NOT FORGEABLE. record_calculation_run is revoked from
-- `authenticated`: the only callers are the compute_* functions in this file
-- (the ingest_schedule_batch posture — one door, stated on day one). A user
-- cannot write a lineage row claiming a calculation happened.
--
-- WHY THE COMPUTE FUNCTIONS ARE VOLATILE AND THE READS ARE NOT. A stable
-- read cannot write, and lineage that is optional is lineage that is
-- missing. So the acts are split: get_case_* answer questions without
-- recording; compute_case_* answer the SAME question through the same
-- predicate AND record the run. The surface shows recorded runs, so every
-- controls number on screen has a lineage row behind it by construction.
--
-- Canonical reuse: development_cases, audit_events, security_events,
-- get_case_scope_growth / get_case_scope_traceability /
-- get_case_cost_reconciliation (the ONE predicates — nothing is
-- re-implemented here).
-- ============================================================================

create table if not exists public.calculation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid references development_cases(id) on delete cascade,
  -- Which calculation. A stable key a surface can ask for.
  calculation_key text not null check (btrim(calculation_key) <> ''),
  -- Spec §71-78 "method": how the number was produced, in words.
  method text not null check (length(btrim(method)) >= 10),
  -- Spec §71-78 "version": the code identity. Server-supplied.
  code_version text not null check (btrim(code_version) <> ''),
  -- Spec §71-78 "inputs": the values, or the ids of the rows they came from.
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  input_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(input_refs) = 'array'),
  -- Spec §71-78 "outputs". Null when the run refused outright.
  outputs jsonb check (outputs is null or jsonb_typeof(outputs) = 'object'),
  -- The fifth field. Always an array; empty means "nothing was refused",
  -- which is a different fact from "refusals were not recorded".
  refusals jsonb not null default '[]'::jsonb check (jsonb_typeof(refusals) = 'array'),
  status text not null check (status in ('computed','computed_with_refusals','refused')),
  computed_by uuid references auth.users(id),
  computed_at timestamptz not null default now(),
  -- A refused run has no outputs; a computed one has them. Neither state can
  -- be half-recorded.
  constraint calculation_run_outcome check (
    (status = 'refused' and outputs is null and jsonb_array_length(refusals) > 0)
    or (status = 'computed' and outputs is not null and jsonb_array_length(refusals) = 0)
    or (status = 'computed_with_refusals' and outputs is not null and jsonb_array_length(refusals) > 0)
  )
);

create index if not exists idx_calc_run_case
  on calculation_runs(organization_id, development_case_id, calculation_key, computed_at desc);

alter table public.calculation_runs enable row level security;
drop policy if exists calculation_runs_read on public.calculation_runs;
create policy calculation_runs_read on public.calculation_runs
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: runs are written by the compute functions only.

comment on table public.calculation_runs is
  'D11.29 (spec §71-78): one lineage record per calculation — method, code version, inputs, outputs, timestamp AND the refusals hit on the way. Immutable to clients; append-only in practice. Every Slice 4 controls number a user sees is a row here.';

-- ---------------------------------------------------------------------------
create or replace function public.enforce_calculation_run_immutable()
returns trigger
language plpgsql
as $$
declare
  v_client boolean := auth.uid() is not null;
  v_org uuid;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'calculation_runs is the record of how every controls number was produced; truncating it erases every number''s defence in one statement. It is append-only for every caller.'
      using errcode = 'insufficient_privilege';
  end if;

  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'A calculation lineage row was ' || lower(tg_op) || 'd by a service caller. '
           || 'The row is what makes a displayed controls number defensible; '
           || 'changing one changes what a past number is understood to have been '
           || 'computed from (D11.29).');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'a recorded calculation is immutable — it states what was computed, from what, by which code version, at an instant that has passed. Compute again and a new run is recorded beside it.'
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.enforce_calculation_run_immutable() from public, anon, authenticated;

drop trigger if exists trg_calculation_run_immutable on public.calculation_runs;
create trigger trg_calculation_run_immutable
  before update or delete on public.calculation_runs
  for each row execute function public.enforce_calculation_run_immutable();

drop trigger if exists trg_calculation_run_no_truncate on public.calculation_runs;
create trigger trg_calculation_run_no_truncate
  before truncate on public.calculation_runs
  for each statement execute function public.enforce_calculation_run_immutable();

revoke truncate on table public.calculation_runs from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The pinned code versions. One place, server-side, per calculation key.
-- A key with no pinned version is an unknown calculation and is refused —
-- defaulting to 'unknown' would make every future lineage row look recorded
-- while identifying nothing.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  -- ONLY KEYS A COMPUTE FUNCTION RECORDS. 'case_scope_traceability' was
  -- pinned here and never recorded by anything: get_case_scope_traceability
  -- is consumed as an INPUT by compute_case_scope_growth and produces no run
  -- of its own, so the pin read as coverage that does not exist and
  -- get_case_calculation_lineage could never return that key. The slice test
  -- now asserts every pinned key appears in a record_calculation_run call.
  select v from (values
    ('case_scope_growth',        'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation', 'develop-controls/4A/2026-11-24')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The recorder. Not callable by a client: a lineage row a user could write
-- is a claim that a calculation happened, made by the party the claim is
-- for.
-- ---------------------------------------------------------------------------
create or replace function public.record_calculation_run(
  p_case_id uuid,
  p_key text,
  p_method text,
  p_inputs jsonb,
  p_input_refs jsonb,
  p_outputs jsonb,
  p_refusals jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text := sync_calculation_code_version(p_key);
  c development_cases%rowtype;
  v_refusals jsonb := coalesce(p_refusals, '[]'::jsonb);
  v_status text;
  v_id uuid;
begin
  if v_version is null then
    raise exception
      'no code version is pinned for calculation key "%" — a lineage record that cannot name the code that produced it records nothing (D11.29).',
      p_key
      using errcode = 'check_violation';
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found then
    raise exception 'development case not found' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(v_refusals) <> 'array' then
    v_refusals := '[]'::jsonb;
  end if;

  v_status := case
    when p_outputs is null then 'refused'
    when jsonb_array_length(v_refusals) > 0 then 'computed_with_refusals'
    else 'computed' end;

  insert into calculation_runs
    (organization_id, development_case_id, calculation_key, method, code_version,
     inputs, input_refs, outputs, refusals, status, computed_by)
  values
    (c.organization_id, c.id, p_key, p_method, v_version,
     coalesce(p_inputs, '{}'::jsonb), coalesce(p_input_refs, '[]'::jsonb),
     p_outputs, v_refusals, v_status, auth.uid())
  returning id into v_id;

  -- A lineage row minted with no JWT behind it did not reach security_events,
  -- so a raw service caller could record a run for any organization and only
  -- audit_events would know. The run is legitimate (the compute functions are
  -- definers); one made OUTSIDE them is worth seeing.
  if auth.uid() is null and current_user not in ('authenticated', 'anon')
     and exists (select 1 from organizations where id = c.organization_id) then
    insert into security_events
      (organization_id, actor_id, actor_label, event_type, severity, detail)
    values
      (c.organization_id, null, 'service (' || current_user || ')',
       'admin_action', 'notice',
       'Calculation run ' || p_key || ' recorded on case ' || c.id ||
         ' by a service caller with no signed-in identity. A recorded run is '
         'what makes a displayed controls number defensible (D11.29), so one '
         'produced outside a user act is recorded as such.');
  end if;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (c.organization_id, 'calculation_run',
    coalesce((select role from user_profiles where id = auth.uid()), 'system'),
    jsonb_build_object('case_id', c.id, 'calculation_run_id', v_id,
      'calculation_key', p_key, 'code_version', v_version, 'status', v_status),
    null,
    jsonb_build_object('calculation_key', p_key, 'code_version', v_version,
      'status', v_status, 'refusalCount', jsonb_array_length(v_refusals)));

  return v_id;
end
$$;

revoke all on function public.record_calculation_run(uuid, text, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_calculation_run(uuid, text, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- compute_case_scope_growth (D5.03 + D11.29). Same predicate as the read,
-- plus the lineage row. The traceability report is consulted too, because a
-- scope-growth figure computed over a chain with holes in it carries those
-- holes as caveats — the number is not wrong, but it is not complete, and
-- the run says which.
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_scope_growth(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_growth jsonb;
  v_trace jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_outputs jsonb;
  v_run uuid;
  v_uncoded int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing scope growth requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_growth := get_case_scope_growth(c.id);
  v_trace := get_case_scope_traceability(c.id);

  if coalesce((v_growth->>'evaluable')::boolean, false) = false then
    v_refusals := v_refusals || to_jsonb(v_growth->>'refusal');
    v_outputs := null;
  else
    v_refusals := v_growth->'caveats';
    v_uncoded := jsonb_array_length(v_trace->'orphans'->'costItemsOutsideAControlAccount');
    if v_uncoded > 0 then
      v_refusals := v_refusals || to_jsonb(format(
        '%s cost line(s) sit outside every control account, so growth attributed through the WBS cannot be reconciled to them.', v_uncoded)::text);
    end if;
    -- The UNIT travels with the figure. A recorded output a surface has to
    -- pair with a separately-read currency is a number that can be rendered
    -- under the wrong symbol.
    v_outputs := jsonb_build_object(
      'costTotal', v_growth->'costTotal',
      'currency', v_growth->'currency',
      'approvedCostTotal', v_growth->'approvedCostTotal',
      'unapprovedCostTotal', v_growth->'unapprovedCostTotal',
      'additionCount', v_growth->'additionCount',
      'uncostedCount', v_growth->'uncostedCount',
      'priorBaselineAdditionCount', v_growth->'priorBaselines'->'additionCount',
      'byOrigin', v_growth->'byOrigin');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_scope_growth',
    'Sum of cost_effect over project_scope_changes attributed to the currently approved SCOPE baseline, split by approved-change presence and grouped by origin. No estimate is imputed for an un-costed addition and no total is produced without an approved baseline.',
    -- These five are also the STALENESS FINGERPRINT the surface compares a
    -- displayed run against: when the live read no longer produces them, the
    -- figure on screen is from a run whose inputs have moved, and the page
    -- says so instead of quietly showing yesterday's number.
    jsonb_build_object(
      'baselineId', v_growth->'baseline'->'id',
      'baselineVersion', v_growth->'baseline'->'version',
      'additionCount', v_growth->'additionCount',
      'uncostedCount', v_growth->'uncostedCount',
      'brokenScopeLinks', v_trace->'brokenLinkCount'),
    -- EXACTLY THE ROWS THE AGGREGATE SUMMED. This listed every scope change
    -- on the case while get_case_scope_growth sums only those attributed to
    -- the CURRENTLY approved baseline, so replaying from the recorded refs
    -- gave a different number than the recorded output — the one property a
    -- lineage record must not have. Same predicate, same rows.
    coalesce((select jsonb_agg(jsonb_build_object('table', 'project_scope_changes', 'id', sc.id))
                from project_scope_changes sc
               where sc.development_case_id = c.id
                 and sc.baseline_id = (v_growth->'baseline'->>'id')::uuid), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_growth || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_scope_growth'));
end
$$;

-- service_role is revoked explicitly: Supabase's default privileges already
-- granted it, and revoking from public/anon does not remove an explicit role
-- grant, so the stated ACL and the real one differed.
revoke all on function public.compute_case_scope_growth(uuid) from public, anon, service_role;
grant execute on function public.compute_case_scope_growth(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_case_cost_reconciliation (D5.29 + D11.29).
-- ---------------------------------------------------------------------------
create or replace function public.compute_case_cost_reconciliation(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  v_recon jsonb;
  v_refusals jsonb;
  v_outputs jsonb;
  v_run uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'computing the cost reconciliation requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_recon := get_case_cost_reconciliation(c.id);
  v_refusals := coalesce(v_recon->'refusals', '[]'::jsonb);

  if v_recon->'reconciles' is null or jsonb_typeof(v_recon->'reconciles') = 'null' then
    -- One side is missing. The reconciliation has no answer, and the run
    -- records that rather than a variance computed against a blank.
    v_outputs := null;
    if jsonb_array_length(v_refusals) = 0 then
      v_refusals := jsonb_build_array(
        'the reconciliation has no answer and no reason was recorded, which is itself a defect worth seeing');
    end if;
  else
    v_outputs := jsonb_build_object(
      'lineBaselineTotal', v_recon->'lineBaselineTotal',
      'businessCaseCapital', v_recon->'businessCaseCapital',
      'currency', v_recon->'currency',
      'businessCaseRef', v_recon->'businessCaseRef',
      'optionLabel', v_recon->'optionLabel',
      'variance', v_recon->'variance',
      'reconciles', v_recon->'reconciles',
      'lineCount', v_recon->'lineCount');
  end if;

  v_run := record_calculation_run(
    c.id,
    'case_cost_reconciliation',
    'Sum of project_cost_items.baseline_cost for the case against the period-0 capital outflow of the recorded business-case option (Slice 2 finance model). Neither side is imputed from the other; a missing side refuses.',
    jsonb_build_object(
      'lineCount', v_recon->'lineCount',
      'baselinedLineCount', v_recon->'baselinedLineCount',
      'businessCaseRef', v_recon->'businessCaseRef',
      'linesOutsideAControlAccount', v_recon->'linesOutsideAControlAccount'),
    coalesce((select jsonb_agg(jsonb_build_object('table', 'project_cost_items', 'id', ci.id))
                from project_cost_items ci
               where ci.development_case_id = c.id), '[]'::jsonb),
    v_outputs,
    v_refusals);

  return v_recon || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('case_cost_reconciliation'));
end
$$;

-- service_role is revoked explicitly: Supabase's default privileges already
-- granted it, and revoking from public/anon does not remove an explicit role
-- grant, so the stated ACL and the real one differed.
revoke all on function public.compute_case_cost_reconciliation(uuid) from public, anon, service_role;
grant execute on function public.compute_case_cost_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The lineage read. Opening a number is the whole point, so the payload is
-- the run itself — inputs, refs, outputs, refusals, version, instant, actor.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_calculation_lineage(
  p_case_id uuid,
  p_limit int default 20
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
  v_runs jsonb;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(r.payload order by r.computed_at desc), '[]'::jsonb) into v_runs
  from (
    select cr.computed_at, jsonb_build_object(
      'id', cr.id,
      'calculationKey', cr.calculation_key,
      'method', cr.method,
      'codeVersion', cr.code_version,
      'inputs', cr.inputs,
      'inputRefs', cr.input_refs,
      'outputs', cr.outputs,
      'refusals', cr.refusals,
      'status', cr.status,
      'computedAt', cr.computed_at,
      'computedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                      where p.id = cr.computed_by)) as payload
    from calculation_runs cr
    where cr.development_case_id = c.id
    order by cr.computed_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))) r;

  return jsonb_build_object('caseId', c.id, 'runs', v_runs);
end
$$;

revoke all on function public.get_case_calculation_lineage(uuid, int) from public, anon;
grant execute on function public.get_case_calculation_lineage(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_case_controls — the Integrated Controls read (spec §44: "scope,
-- schedule, cost, risk, change, procurement in one coherent view"). Slice 4A
-- covers scope, schedule, cost and change; risk and procurement are named
-- as arriving with their own rows rather than rendered empty.
--
-- Follows the get_case_chains precedent (20261122090700): a per-section read
-- BESIDE get_development_case, not a v6 of it, so nothing this file does can
-- perturb the workspace payload the whole page already depends on. What it
-- renders is what the RPCs enforce — traceability comes from
-- get_case_scope_traceability, the same function compute_case_scope_growth
-- records refusals from.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_controls(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_needs jsonb;
  v_wbs jsonb;
  v_cbs jsonb;
  v_accounts jsonb;
  v_costs jsonb;
  v_activities jsonb;
  v_system_nodes jsonb;
  v_latest jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'needRef', n.need_ref, 'statement', n.statement,
    'sourceAuthority', n.source_authority, 'status', n.status,
    'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = n.owner_id),
    -- ON THIS CASE, the same filter get_case_scope_traceability's gap 1 uses:
    -- a requirement from another case must not make a need look covered.
    'requirementCount', (select count(*) from design_requirements d
                          where d.scope_need_id = n.id and d.development_case_id = c.id))
    order by n.need_ref), '[]'::jsonb)
  into v_needs
  from project_scope_needs n where n.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id, 'wbsCode', w.wbs_code, 'title', w.title,
    'scopeDescription', w.scope_description, 'depth', w.depth,
    'parentWbsCode', (select p2.wbs_code from project_wbs_elements p2 where p2.id = w.parent_id),
    'systemNode', (select o.name from organizations o where o.id = w.system_node_id),
    'requirementCount', (select count(*) from project_requirement_wbs l where l.wbs_element_id = w.id),
    'activityCount', (select count(*) from shutdown_tasks t where t.wbs_element_id = w.id),
    'costItemCount', (select count(*) from project_cost_items ci where ci.wbs_element_id = w.id),
    'controlAccountRef', (select ca.control_account_ref from project_control_accounts ca
                           where ca.wbs_element_id = w.id))
    order by w.wbs_code), '[]'::jsonb)
  into v_wbs
  from project_wbs_elements w where w.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'cbsCode', b.cbs_code, 'title', b.title, 'costType', b.cost_type)
    order by b.cbs_code), '[]'::jsonb)
  into v_cbs
  from project_cbs_codes b where b.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ca.id, 'controlAccountRef', ca.control_account_ref,
    'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = ca.wbs_element_id),
    'cbsCode', (select b.cbs_code from project_cbs_codes b where b.id = ca.cbs_code_id),
    'accountableOwner', (select coalesce(p.full_name, p.email) from user_profiles p
                          where p.id = ca.accountable_owner_id),
    'orgNode', (select o.name from organizations o where o.id = ca.org_node_id),
    'costItemCount', (select count(*) from project_cost_items ci where ci.control_account_id = ca.id))
    order by ca.control_account_ref), '[]'::jsonb)
  into v_accounts
  from project_control_accounts ca where ca.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ci.id, 'costItemRef', ci.cost_item_ref, 'description', ci.description,
    'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = ci.wbs_element_id),
    'cbsCode', (select b.cbs_code from project_cbs_codes b where b.id = ci.cbs_code_id),
    'controlAccountRef', (select ca.control_account_ref from project_control_accounts ca
                           where ca.id = ci.control_account_id),
    'currency', ci.currency,
    'baselineCost', ci.baseline_cost, 'commitment', ci.commitment, 'actual', ci.actual,
    'forecast', ci.forecast, 'contingency', ci.contingency,
    'contingencyBasis', ci.contingency_basis, 'basis', ci.basis,
    'sourceSystem', ci.source_system)
    order by ci.cost_item_ref), '[]'::jsonb)
  into v_costs
  from project_cost_items ci where ci.development_case_id = c.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'activityKey', t.task_key, 'label', t.label,
    'origin', t.origin, 'sourceSystem', t.source_system,
    'durationHours', t.duration_hours,
    'plannedStart', t.planned_start, 'plannedFinish', t.planned_finish,
    'calendarName', t.calendar_name, 'wbsPath', t.wbs_path,
    'wbsCode', (select w.wbs_code from project_wbs_elements w where w.id = t.wbs_element_id),
    'schedule', e.title)
    order by t.task_key), '[]'::jsonb)
  into v_activities
  from shutdown_tasks t
  join shutdown_events e on e.id = t.event_id
  where e.organization_id = v_org and e.development_case_id = c.id;

  -- The chain's SYSTEM link, offered where the WBS is authored. The
  -- organizations RLS policy exposes only the caller's own root row, so a
  -- client cannot list the five-level tree directly — which is why
  -- record_wbs_element accepted a system_node_id nothing could supply and the
  -- link, reported as `built`, was unreachable in the shipped product. The
  -- definer that already resolved the tenant returns the nodes, scoped by the
  -- tree module's own containment predicate.
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name)
    order by o.name), '[]'::jsonb)
  into v_system_nodes
  from organizations o
  where o.org_level = 'system' and org_node_in_scope(o.id, v_org);

  -- The latest recorded run per calculation key — the numbers the surface
  -- is entitled to show, each already carrying its lineage.
  select coalesce(jsonb_object_agg(k.calculation_key, k.payload), '{}'::jsonb) into v_latest
  from (
    select distinct on (cr.calculation_key) cr.calculation_key,
      jsonb_build_object('id', cr.id, 'codeVersion', cr.code_version,
        'method', cr.method, 'inputs', cr.inputs, 'outputs', cr.outputs,
        'refusals', cr.refusals, 'status', cr.status, 'computedAt', cr.computed_at,
        'computedBy', (select coalesce(p.full_name, p.email) from user_profiles p
                        where p.id = cr.computed_by)) as payload
    from calculation_runs cr
    where cr.development_case_id = c.id
    order by cr.calculation_key, cr.computed_at desc) k;

  return jsonb_build_object(
    'caseId', c.id,
    'caseTitle', c.title,
    'needs', v_needs,
    'wbs', v_wbs,
    'cbs', v_cbs,
    'controlAccounts', v_accounts,
    'costItems', v_costs,
    'scheduleActivities', v_activities,
    'systemNodes', v_system_nodes,
    'traceability', get_case_scope_traceability(c.id),
    'controlsBaseline', get_case_controls_baseline(c.id),
    -- THESE TWO ARE THE LIVE READ, NOT A RECORDED CALCULATION. They record
    -- nothing, so the surface uses them for the REFUSALS (which are
    -- statements, not figures), for the row listings, and to detect that a
    -- recorded run has gone stale — never as the money figure it renders.
    -- The figure comes from latestCalculations, which is a run.
    'scopeGrowth', get_case_scope_growth(c.id),
    'costReconciliation', get_case_cost_reconciliation(c.id),
    'latestCalculations', v_latest,
    -- §44's other two columns, named rather than rendered as empty panels.
    'notInThisSlice', jsonb_build_array(
      'Risk and procurement columns of the §44 Integrated Controls view arrive with their own register rows (D5.09 risk-cost-schedule, D6.x procurement).',
      'Earned value, CPI/SPI, EAC/VAC and forecast confidence are D5.05-D5.08 and D5.13-D5.16 — deliberately absent here rather than shown as zero.'));
end
$$;

-- service_role is revoked explicitly: Supabase's default privileges already
-- granted it, and revoking from public/anon does not remove an explicit role
-- grant, so the stated ACL and the real one differed.
revoke all on function public.get_case_controls(uuid) from public, anon, service_role;
grant execute on function public.get_case_controls(uuid) to authenticated;

notify pgrst, 'reload schema';
