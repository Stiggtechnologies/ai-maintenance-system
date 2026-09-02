-- ============================================================================
-- Sync Develop Slice 5D — the RAM Agent, scoped to a Development Case
--   D12.13 (spec III.§63)
--
-- ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
--
-- It adds NO MATHEMATICS. The register row for D12.13 is precise about what
-- already exists: the entire RAM kernel (weibullMLE, weibullMRR,
-- selectWeibullMethod, allocateAvailability, evaluateRbd,
-- optimalAgeReplacement, optimiseSpares, verifySIF) and a live agent carrying
-- the refusal standard verbatim — "Never calculate MTBF, Weibull parameters,
-- availability … without the required denominator and boundary data". The
-- named gap, and the ONLY thing built here, is SCOPING THAT KERNEL TO A
-- DEVELOPMENT CASE'S ASSET SET.
--
-- Re-deriving `target^(weight/totalWeight)` in SQL would be a second
-- implementation of `allocateAvailability`, which is the single defect this
-- program has found in nearly every chunk. So the arithmetic stays where it
-- is and where RE-2026.08's golden baseline already tests it, and this file
-- supplies the INPUTS and records the RUN.
--
-- ── RULING 5D-R12 — THE SCOPE READ REFUSES BY NAME, PER LEG ──────────────
--
-- `get_case_ram_scope` returns nothing that could be mistaken for a result.
-- It refuses, naming which input is missing, when:
--
--   * no asset is bound to the case (development_case_assets is empty) — an
--     availability answer over an empty asset set is a number about nothing;
--   * the case references no capital project — RAM targets hang off the
--     project, so there is nowhere to look;
--   * the project carries no ram_targets row — "the target is 98%" with no
--     recorded target is the sentence this product exists to refuse;
--
-- and it reports, per leg, the inputs that are present but insufficient:
--   * a target with no allocations (nothing to allocate across);
--   * an asset with fewer than two distinct failure records (the shape
--     parameter is not identifiable — selectWeibullMethod says so in the same
--     words and this read does not pre-empt it);
--   * the ABSENCE of any stored redundancy structure, which is why no system
--     reliability is computed here at all (see 5D-R13).
--
-- ── RULING 5D-R13 — NO RBD, AND THE REASON IS STATED RATHER THAN HIDDEN ──
--
-- `evaluateRbd` is in the kernel and it is not called. An RBD needs a declared
-- block structure — which blocks are in which redundancy group and how many of
-- each group must work — and NOTHING in this repository stores one for a
-- development case's assets. Inventing "every asset in series" would produce a
-- system reliability with a fabricated model behind it, which is worse than no
-- number because it looks like one. So the RBD leg is REFUSED BY NAME in the
-- scope payload and the refusal travels into the calculation run.
--
-- ── RULING 5D-R14 — THE KERNEL RUNS IN TYPESCRIPT, SO THE RUN RECORDS WHICH
--                     KERNEL ──────────────────────────────────────────────
--
-- Every other calculation in this program computes in SQL and records itself.
-- This one cannot without duplicating the kernel, so the honest arrangement is
-- stated rather than disguised:
--
--   * the INPUTS are re-read server-side. `record_ram_agent_report` calls
--     `get_case_ram_scope` itself; the caller cannot supply an asset, a target
--     or an allocation.
--   * the REFUSALS are re-derived server-side and MERGED with the caller's, so
--     a client cannot record a run claiming a clean profile over a scope this
--     database says is short of inputs.
--   * the KERNEL IDENTITY is pinned. `sync_ram_kernel_version()` is the
--     server's pin; a report declaring any other version is REFUSED by name.
--     `src/lib/develop/ram.ts` exports the same constant and the slice test
--     pins the two together, so a kernel change that does not update both
--     sides cannot record a run at all.
--   * `record_calculation_run` records method, version, inputs, outputs and
--     refusals exactly as D11.29 requires.
--
-- ── RULING 5D-R15 — THE AGENT PROPOSES ──────────────────────────────────
--
-- `ram_agent_reports` has no column that can hold a target, an acceptance, an
-- approval or a decision; `advisory` is pinned by a CHECK. Setting a RAM
-- target is `ram_targets`, which this agent never writes, and the §70 walls on
-- the acts around it (success-contract recording, gate review, sanction) each
-- refuse the AI-operator identity at their own door.
--
-- Canonical reuse: development_case_assets, assets, capital_projects,
-- ram_targets, ram_allocations, component_life_events, calculation_runs,
-- record_calculation_run, audit_events, app_current_org(), src/lib/reliability,
-- src/lib/design.
-- ============================================================================

create or replace function public.sync_ram_kernel_version()
returns text
language sql
immutable
set search_path = public
as $$
  select 'develop-ram/5D/2026-12-07'::text;
$$;

revoke all on function public.sync_ram_kernel_version() from public, anon;
grant execute on function public.sync_ram_kernel_version() to authenticated, service_role;

comment on function public.sync_ram_kernel_version() is
  'D12.13 ruling 5D-R14: the pinned identity of the TypeScript RAM kernel a case-scoped profile may be recorded from. RAM_KERNEL_VERSION in src/lib/develop/ram.ts mirrors it and the slice test pins the two together.';

-- The calculation key registry gains the RAM profile. Re-declared in FULL from
-- the live 5B definition — the established idiom for this function — with one
-- key added and every prior version kept EXACTLY as it was: bumping a version
-- on unchanged code makes the version stop meaning anything.
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
    ('case_ram_profile',               'develop-ram/5D/2026-12-07')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. THE SCOPE (ruling 5D-R12). Inputs only — never a result.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_ram_scope(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_assets jsonb := '[]'::jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_asset_count int := 0;
  v_target_count int := 0;
  v_row record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*)::int into v_asset_count
    from development_case_assets d where d.development_case_id = c.id;

  if v_asset_count = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'assets', '[]'::jsonb, 'targets', '[]'::jsonb,
      'refusals', jsonb_build_array(
        'No asset is bound to this case, so there is no population to compute reliability, availability or maintainability over. An availability figure over an empty asset set is a number about nothing — bind the assets this case delivers (spec §26, the ONE asset hierarchy) and ask again.'),
      'refusal', 'No asset is bound to this case. §63''s RAM Agent needs an asset set before any of its five families has a denominator.');
  end if;

  if c.capital_project_id is null then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'assets', '[]'::jsonb, 'targets', '[]'::jsonb,
      'refusals', jsonb_build_array(
        'This case references no capital project. RAM targets and their allocations hang off the delivery-side project record, so there is nowhere to read a target from — and a RAM profile with no recorded target is an opinion about how reliable the plant ought to be.'),
      'refusal', 'This case references no capital project, so no recorded availability target can be found.');
  end if;

  select count(*)::int into v_target_count
    from ram_targets t where t.project_id = c.capital_project_id and t.organization_id = v_org;

  if v_target_count = 0 then
    return jsonb_build_object(
      'caseId', c.id, 'refused', true, 'assets', '[]'::jsonb, 'targets', '[]'::jsonb,
      'refusals', jsonb_build_array(
        format('The capital project behind this case carries no ram_targets row. "The target is 98%%" with no recorded target, basis and configuration is the sentence this product exists to refuse.')),
      'refusal', 'No availability target is recorded on this case''s capital project.');
  end if;

  -- The ASSET LEG. Life data from the ONE component-life store, per asset.
  -- `hours_at_change_out` is the life; `event_kind` separates a failure from a
  -- planned change-out, which is a SUSPENSION and not a failure — collapsing
  -- the two is the classic way a beta comes back optimistic.
  select coalesce(jsonb_agg(jsonb_build_object(
      'assetId', a.id,
      'assetTag', a.asset_tag,
      'name', a.name,
      'criticality', a.criticality,
      'failureTimes', coalesce(f.failures, '[]'::jsonb),
      'suspensionTimes', coalesce(f.suspensions, '[]'::jsonb),
      'failureCount', coalesce(jsonb_array_length(f.failures), 0),
      'suspensionCount', coalesce(jsonb_array_length(f.suspensions), 0))
      order by a.asset_tag), '[]'::jsonb)
    into v_assets
    from development_case_assets d
    join assets a on a.id = d.asset_id
    left join lateral (
      select
        jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
          filter (where e.event_kind = 'failure') failures,
        jsonb_agg(e.hours_at_change_out order by e.hours_at_change_out)
          filter (where e.event_kind <> 'failure') suspensions
      from component_life_events e
      where e.asset_id = a.id and e.organization_id = v_org
        and e.hours_at_change_out is not null and e.hours_at_change_out > 0
    ) f on true
   where d.development_case_id = c.id and d.organization_id = v_org;

  -- The TARGET LEG, with its allocations.
  select coalesce(jsonb_agg(jsonb_build_object(
      'targetId', t.id,
      'systemLabel', t.system_label,
      'targetAvailability', t.target_availability,
      'configuration', t.configuration,
      'basis', t.target_basis,
      'allocations', coalesce(al.rows, '[]'::jsonb),
      'allocationCount', coalesce(jsonb_array_length(al.rows), 0))
      order by t.system_label), '[]'::jsonb)
    into v_targets
    from ram_targets t
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'label', r.subsystem_label,
        'demonstrated', r.demonstrated_availability,
        'recordedAllocation', r.allocated_availability,
        'evidence', r.evidence,
        'complexityWeight', r.complexity_weight) order by r.subsystem_label) rows
      from ram_allocations r where r.target_id = t.id
    ) al on true
   where t.project_id = c.capital_project_id and t.organization_id = v_org;

  -- PER-LEG REFUSALS. Present but insufficient is a different fact from absent.
  for v_row in
    select value ->> 'systemLabel' label
      from jsonb_array_elements(v_targets)
     where (value ->> 'allocationCount')::int = 0
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'Target "%s" has no subsystem allocation recorded, so there is nothing to allocate it across. A system target with no allocation behind it is a number in a document (spec §63 / I.26).',
      v_row.label));
  end loop;

  -- A MIXED configuration has no model in this kernel, and that refusal now
  -- lives HERE rather than only on the client. It used to be raised solely by
  -- computeCaseRamProfile and reach the server as `p_refusals`, which the
  -- merge APPENDS rather than requires — so a caller that simply omitted it
  -- recorded an immutable lineage row with nothing saying the kernel had no
  -- model for the system. A refusal a caller can drop is not a refusal.
  for v_row in
    select value ->> 'systemLabel' label
      from jsonb_array_elements(v_targets)
     where value ->> 'configuration' = 'mixed'
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'Target "%s" is recorded as a MIXED configuration. The allocation kernel models series and parallel only; a mixed system needs its structure declared before any share can be allocated, and allocating it as series would allocate a target across a system this is not.',
      v_row.label));
  end loop;

  for v_row in
    select value ->> 'assetTag' tag, (value ->> 'failureCount')::int fc
      from jsonb_array_elements(v_assets)
     where (value ->> 'failureCount')::int < 2
  loop
    v_refusals := v_refusals || to_jsonb(format(
      'Asset %s has %s failure record(s) in the component-life store. Two distinct failures are the minimum for any Weibull estimator; below that the shape parameter is not identifiable and no life distribution is fitted for it.',
      v_row.tag, v_row.fc));
  end loop;

  -- RULING 5D-R13, carried as a refusal rather than as an omission.
  v_refusals := v_refusals || to_jsonb(
    'No system reliability (RBD) is computed for this case: nothing in this repository stores a redundancy structure for a development case''s assets — which blocks sit in which group and how many of each must work. Assuming a series system would produce a number with an invented model behind it, which is worse than no number because it looks like one.'::text);

  return jsonb_build_object(
    'caseId', c.id,
    'projectId', c.capital_project_id,
    'refused', false,
    'assetCount', v_asset_count,
    'targetCount', v_target_count,
    'assets', v_assets,
    'targets', v_targets,
    'refusals', v_refusals,
    'kernelVersion', sync_ram_kernel_version(),
    'note', 'These are INPUTS, not results. Every figure below came out of a stored row; nothing here has been fitted, allocated or averaged.');
end
$$;

revoke all on function public.get_case_ram_scope(uuid) from public, anon;
grant execute on function public.get_case_ram_scope(uuid) to authenticated, service_role;

comment on function public.get_case_ram_scope(uuid) is
  'D12.13 / spec III.§63 ruling 5D-R12: the RAM kernel''s inputs SCOPED TO ONE DEVELOPMENT CASE — the bound asset set with its component-life failures and suspensions, and the capital project''s availability targets with their allocations. Refuses by name with no asset set, no capital project or no recorded target, and reports every present-but-insufficient leg (including the absent RBD structure, 5D-R13). It computes nothing.';

-- ---------------------------------------------------------------------------
-- 2. The report. Advisory, immutable, no column that can hold a target.
-- ---------------------------------------------------------------------------
create table if not exists public.ram_agent_reports (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- The server's own re-read of the inputs, whole.
  scope jsonb not null check (jsonb_typeof(scope) = 'object'),
  -- The kernel's output, and the kernel that produced it.
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  kernel_version text not null check (btrim(kernel_version) <> ''),
  refused boolean not null,
  refusals jsonb not null default '[]'::jsonb check (jsonb_typeof(refusals) = 'array'),
  narrative text check (narrative is null or length(narrative) <= 6000),
  -- BOUNDED like the narrative beside it. The sibling agent-report table this
  -- idiom came from carries a model bound and this one dropped it: the column
  -- is rendered on screen and the row is immutable, org-readable and
  -- undeletable, so an unbounded caller string here is permanent.
  model text check (model is null or length(model) <= 200),
  calculation_run_id uuid references calculation_runs(id) on delete set null,
  agent_key text not null default 'sync-develop-ram' check (btrim(agent_key) <> ''),
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- THE COLUMNS THAT ARE NOT HERE. No target, no acceptance, no approval, no
  -- decision. A RAM agent that could store the string 'accepted' anywhere
  -- would eventually have it read as one.
  advisory boolean not null default true,
  constraint ram_agent_report_is_advisory check (advisory)
);

create index if not exists idx_ram_agent_reports_case
  on ram_agent_reports(organization_id, development_case_id, created_at desc);

alter table public.ram_agent_reports enable row level security;
drop policy if exists ram_agent_reports_read on public.ram_agent_reports;
create policy ram_agent_reports_read on public.ram_agent_reports
  for select to authenticated using (organization_id = app_current_org());

comment on table public.ram_agent_reports is
  'D12.13 / spec III.§63: a dated case-scoped RAM reading. `scope` is the server''s own re-read of get_case_ram_scope; `profile` is the TypeScript kernel''s output under a PINNED kernel version (ruling 5D-R14). No column here can hold a target or an acceptance.';

create or replace function public.enforce_ram_agent_report_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.ram_agent_report_write', true), '');
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'ram_agent_reports is the dated record of what the RAM agent said and what it refused to say. Truncating it erases every reading in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if v_marker <> 'granted' then
      raise exception
        'A RAM agent report is a dated reading with a lineage row behind it. It is not deleted.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'A RAM agent report is immutable. Run the agent again — a second reading dated now is honest; an edited one dated then is not.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marker <> 'granted' then
    raise exception
      'A RAM agent report cannot be written directly: record_ram_agent_report is the path, and it re-reads the scope and the refusals from get_case_ram_scope rather than trusting its caller.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_ram_agent_report_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_ram_agent_report_provenance on public.ram_agent_reports;
create trigger trg_ram_agent_report_provenance
  before insert or update or delete on public.ram_agent_reports
  for each row execute function public.enforce_ram_agent_report_provenance();

drop trigger if exists trg_ram_agent_report_no_truncate on public.ram_agent_reports;
create trigger trg_ram_agent_report_no_truncate
  before truncate on public.ram_agent_reports
  for each statement execute function public.enforce_ram_agent_report_provenance();

revoke truncate on table public.ram_agent_reports from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. record_ram_agent_report — the agent's ONLY write (ruling 5D-R14).
-- ---------------------------------------------------------------------------
create or replace function public.record_ram_agent_report(
  p_case_id uuid,
  p_kernel_version text,
  p_profile jsonb default '{}'::jsonb,
  p_refusals jsonb default '[]'::jsonb,
  p_narrative text default null,
  p_model text default null
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
  v_scope jsonb;
  v_scope_refused boolean;
  v_refusals jsonb := '[]'::jsonb;
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_run uuid;
  v_id bigint;
  v_input_refs jsonb;
  -- RULING 5D-R21: the server's scope, and what the caller's profile claims.
  v_scope_targets text[];
  v_scope_assets text[];
  v_claim_targets text[];
  v_claim_assets text[];
  v_key text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- The AI-operator identity is ADMITTED here: this is the act §63 describes.
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician','ai_admin') then
    return jsonb_build_object('error', 'recording a RAM reading requires a role on this project');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  -- RULING 5D-R14: the kernel identity is the SERVER's pin.
  if coalesce(btrim(p_kernel_version), '') <> sync_ram_kernel_version() then
    return jsonb_build_object('error', format(
      'this report declares RAM kernel "%s" and the server pins "%s". A lineage row whose kernel identity the caller chooses certifies nothing, so the run is refused rather than recorded under a version nobody can reproduce.',
      coalesce(nullif(btrim(coalesce(p_kernel_version, '')), ''), '(none)'), sync_ram_kernel_version()));
  end if;
  if p_narrative is not null and length(p_narrative) > 6000 then
    return jsonb_build_object('error',
      'the narrative is longer than 6000 characters; the row is immutable and org-readable, so it is refused rather than silently truncated');
  end if;
  if p_model is not null and length(btrim(p_model)) > 200 then
    return jsonb_build_object('error',
      'the model identifier is longer than 200 characters. It is rendered beside the reading as the thing that produced it, and the row is immutable and undeletable — so an unbounded string is refused here rather than made permanent.');
  end if;

  -- THE INPUTS ARE RE-READ HERE. Not a parameter.
  v_scope := get_case_ram_scope(c.id);
  if v_scope ? 'error' then
    return jsonb_build_object('error', v_scope ->> 'error');
  end if;
  v_scope_refused := coalesce((v_scope ->> 'refused')::boolean, true);

  -- THE REFUSALS ARE MERGED, server side first. A caller cannot record a clean
  -- profile over a scope this database says is short of inputs.
  v_refusals := coalesce(v_scope -> 'refusals', '[]'::jsonb);
  if jsonb_typeof(coalesce(p_refusals, '[]'::jsonb)) = 'array' then
    v_refusals := v_refusals || p_refusals;
  end if;
  if v_scope_refused then
    v_profile := '{}'::jsonb;
  end if;

  -- ── RULING 5D-R21 — THE PROFILE IS TIED TO THE SERVER'S OWN SCOPE ───────
  --
  -- 5D-R14 re-reads the INPUTS and merges the REFUSALS, and refuses a kernel
  -- version the server does not pin. None of that constrained the NUMBERS:
  -- `p_profile` went into `ram_agent_reports.profile` AND into
  -- `record_calculation_run`'s `outputs` verbatim, stamped
  -- `code_version = sync_ram_kernel_version()` under a method string reading
  -- "from the shipped reliability kernel". A caller holding any project role —
  -- including the ai_admin identity this door admits by design — could post a
  -- fabricated availability against an asset tag that does not exist and a
  -- target id that was never allocated, and the immutable lineage row
  -- certified it. That is exactly the D11.29 failure this row claims to close:
  -- a run naming a method and a version over outputs that method never
  -- produced. Proven live before this block existed.
  --
  -- So the profile must TIE TO THE SCOPE THE SERVER JUST RE-READ. Every target
  -- and asset it reports must be one this database put in scope, and it must
  -- report all of them — a profile over a subset is a reading of a different
  -- population presented as a reading of this one. It is REFUSED rather than
  -- trimmed: silently dropping the parts that do not tie would record a
  -- shorter profile under the same certified version, which is the same lie
  -- one size smaller.
  if not v_scope_refused then
    select coalesce(array_agg(value ->> 'targetId'), '{}'::text[]) into v_scope_targets
      from jsonb_array_elements(coalesce(v_scope -> 'targets', '[]'::jsonb));
    select coalesce(array_agg(value ->> 'assetId'), '{}'::text[]) into v_scope_assets
      from jsonb_array_elements(coalesce(v_scope -> 'assets', '[]'::jsonb));

    select coalesce(array_agg(value ->> 'targetId'), '{}'::text[]) into v_claim_targets
      from jsonb_array_elements(case when jsonb_typeof(v_profile -> 'targets') = 'array'
                                     then v_profile -> 'targets' else '[]'::jsonb end);
    select coalesce(array_agg(value ->> 'assetId'), '{}'::text[]) into v_claim_assets
      from jsonb_array_elements(case when jsonb_typeof(v_profile -> 'assets') = 'array'
                                     then v_profile -> 'assets' else '[]'::jsonb end);

    if v_profile <> '{}'::jsonb then
      foreach v_key in array v_claim_targets loop
        if v_key is null or not (v_key = any (v_scope_targets)) then
          return jsonb_build_object('error', format(
            'this profile reports availability target "%s", which is not a target on this case''s capital project. The lineage row would be stamped with the server''s kernel version over a figure the server cannot tie to anything it read, so it is refused rather than certified.',
            coalesce(v_key, '(none)')));
        end if;
      end loop;
      foreach v_key in array v_claim_assets loop
        if v_key is null or not (v_key = any (v_scope_assets)) then
          return jsonb_build_object('error', format(
            'this profile reports asset "%s", which is not bound to this development case. A RAM reading names the population it was computed over, and this one names a member the server did not put in scope.',
            coalesce(v_key, '(none)')));
        end if;
      end loop;
      if array_length(v_claim_targets, 1) is distinct from array_length(v_scope_targets, 1)
         or array_length(v_claim_assets, 1) is distinct from array_length(v_scope_assets, 1) then
        return jsonb_build_object('error', format(
          'this profile covers %s target(s) and %s asset(s); the scope the server just re-read has %s and %s. A profile over part of the population, recorded under the full population''s scope and the server''s kernel version, reads as a reading of the whole — so it is refused rather than trimmed.',
          coalesce(array_length(v_claim_targets, 1), 0), coalesce(array_length(v_claim_assets, 1), 0),
          coalesce(array_length(v_scope_targets, 1), 0), coalesce(array_length(v_scope_assets, 1), 0)));
      end if;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('table', 'assets', 'id', value ->> 'assetId')), '[]'::jsonb)
    into v_input_refs
    from jsonb_array_elements(coalesce(v_scope -> 'assets', '[]'::jsonb));

  -- D11.29: the run records method, version, inputs, outputs AND refusals.
  -- A refused scope records a run with NULL outputs — a refusal with no
  -- lineage is a refusal nobody can later prove happened.
  v_run := record_calculation_run(
    c.id,
    'case_ram_profile',
    'Availability allocation (allocateAvailability) and life-data estimator selection (selectWeibullMethod → weibullMLE/weibullMRR) from the shipped reliability kernel, applied to the assets bound to this development case and the availability targets recorded on its capital project. No arithmetic is re-implemented in SQL; the kernel identity is pinned server-side.',
    jsonb_build_object(
      'assetCount', v_scope -> 'assetCount',
      'targetCount', v_scope -> 'targetCount',
      'kernelVersion', sync_ram_kernel_version(),
      'model', p_model),
    v_input_refs,
    case when v_scope_refused then null else v_profile end,
    v_refusals);

  perform set_config('app.ram_agent_report_write', 'granted', true);
  insert into ram_agent_reports
    (organization_id, development_case_id, scope, profile, kernel_version,
     refused, refusals, narrative, model, calculation_run_id, requested_by)
  values
    (v_org, c.id, v_scope, v_profile, sync_ram_kernel_version(),
     v_scope_refused, v_refusals,
     nullif(btrim(coalesce(p_narrative, '')), ''), nullif(btrim(coalesce(p_model, '')), ''),
     v_run, auth.uid())
  returning id into v_id;
  perform set_config('app.ram_agent_report_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'ram_agent_report', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'report_id', v_id, 'run_id', v_run,
      'kernel_version', sync_ram_kernel_version(), 'model', p_model),
    null,
    jsonb_build_object('refused', v_scope_refused,
      'refusalCount', jsonb_array_length(v_refusals),
      'assetCount', v_scope -> 'assetCount', 'targetCount', v_scope -> 'targetCount'));

  return jsonb_build_object(
    'report_id', v_id,
    'run_id', v_run,
    'refused', v_scope_refused,
    'refusalCount', jsonb_array_length(v_refusals),
    'refusals', v_refusals,
    'kernelVersion', sync_ram_kernel_version(),
    'advisory', true,
    'note', case when v_scope_refused
      then 'Recorded as a REFUSAL with a lineage row behind it. The profile is empty because the inputs were not there — not because the plant is reliable.'
      else 'Recorded, with the lineage row naming the method, the kernel version, the inputs and every refusal on the way. This agent sets no RAM target and accepts nothing.' end);
end
$$;

revoke all on function public.record_ram_agent_report(uuid, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.record_ram_agent_report(uuid, text, jsonb, jsonb, text, text)
  to authenticated, service_role;

comment on function public.record_ram_agent_report(uuid, text, jsonb, jsonb, text, text) is
  'D12.13 / spec III.§63 ruling 5D-R14: records a case-scoped RAM reading. The inputs and the refusals are RE-READ from get_case_ram_scope server-side and merged over the caller''s; the kernel identity is refused unless it matches sync_ram_kernel_version(); and record_calculation_run captures method, version, inputs, outputs and refusals (D11.29). A refused scope still records a run, with NULL outputs.';

create or replace function public.get_ram_agent_reports(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_reports jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'asAt', r.created_at,
      'refused', r.refused,
      'refusals', r.refusals,
      'scope', r.scope,
      'profile', r.profile,
      'kernelVersion', r.kernel_version,
      'narrative', r.narrative,
      'model', r.model,
      'runId', r.calculation_run_id,
      'agentKey', r.agent_key,
      'advisory', r.advisory,
      'requestedBy', u.full_name)
      order by r.created_at desc, r.id desc), '[]'::jsonb)
    into v_reports
    from ram_agent_reports r
    left join user_profiles u on u.id = r.requested_by
   where r.organization_id = v_org and r.development_case_id = c.id;
  return jsonb_build_object('caseId', c.id, 'kernelVersion', sync_ram_kernel_version(), 'reports', v_reports);
end
$$;

revoke all on function public.get_ram_agent_reports(uuid) from public, anon;
grant execute on function public.get_ram_agent_reports(uuid) to authenticated, service_role;

comment on function public.get_ram_agent_reports(uuid) is
  'D12.13: the dated case-scoped RAM readings, refusals included.';
