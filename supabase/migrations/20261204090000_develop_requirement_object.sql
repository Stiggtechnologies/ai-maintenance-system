-- ============================================================================
-- Sync Develop Slice 5A — the Requirement object (D4.16, spec III.§10).
--
-- §10 verbatim: "Requirement: id, development_case_id, parent_requirement_id,
-- source, category, description, owner_id, verification_method,
-- acceptance_criteria, status. Categories: FUNCTIONAL, PERFORMANCE, SAFETY,
-- RELIABILITY, AVAILABILITY, MAINTAINABILITY, ENVIRONMENTAL, CYBER,
-- REGULATORY, OPERABILITY, QUALITY. Traceability: Objective → Requirement →
-- Design Object → Procurement Specification → Installed Asset →
-- Commissioning Test → Operating KPI."
--
-- ZERO NEW TABLES. Overlap-map ruling (docs/sync-develop/overlap-map.md §13):
-- "design_requirements is the ONE project requirement table." The register row
-- says EXTEND, and this file extends. Every §10 field that was missing is a
-- COLUMN on that table, and every traceability link is either a column on it,
-- a join table that already exists (project_requirement_wbs, 20261130090000),
-- or a NAMED HOLE reported as a hole.
--
-- ── RULING 1 — ONE REQUIREMENT CONCEPT, TWO CHAINS THROUGH IT ──────────────
--
-- Slice 4A built the I.6 SCOPE chain: business need → requirement → system →
-- WBS → … → control account. §10 states a different chain — the DIGITAL
-- THREAD: objective → requirement → … → operating KPI. They are not rivals
-- and they do not get two requirement tables: they meet AT the requirement
-- row. `scope_need_id` (4A) is the requirement's upstream in the scope chain;
-- `objective_id` (here) is its upstream in the thread. Downstream, the scope
-- chain goes to the WBS through `project_requirement_wbs` and the thread goes
-- to the installed asset, the commissioning test and the operating KPI.
--
-- The consequence for reporting is the point of the ruling:
-- get_case_requirement_traceability DOES NOT re-implement "does this
-- requirement appear in the WBS". That question has ONE implementation,
-- get_case_scope_traceability (D5.02, 20261130090300), and this report
-- DELEGATES to it and lifts its answer. Two implementations of one predicate
-- is how a chain reports itself complete from one end and broken from the
-- other — which is the exact defect that migration's own comments record.
--
-- ── RULING 2 — THE ELEVEN CATEGORIES DO NOT EVICT THE NINE ─────────────────
--
-- design_requirements shipped with nine reliability-by-design categories
-- (20260818090000:70). Four of them are §10 categories under the same name
-- (reliability, maintainability, safety, operability). Five are not:
-- access, instrumentation, standardisation, sparing, data_handover.
--
-- The category CHECK therefore becomes the UNION of sixteen, not a
-- replacement by eleven. Mapping 'sparing' onto QUALITY or 'data_handover'
-- onto REGULATORY would be a silent guess inside a governance model, and this
-- repository already refuses that class of move by name (parseFrameworkProposal
-- refuses to map a non-canonical stage key rather than guessing at it).
--
-- The eleven are still a NAMED set — `sync_spec10_requirement_categories()` —
-- and a requirement sitting outside them is REPORTED as outside the §10
-- taxonomy by the traceability read and by the Requirements Agent. Reported,
-- not rewritten, and not silently counted as compliant.
--
-- ── RULING 3 — WHICH THREAD LINKS ARE BUILT, AND WHICH ARE NAMED HOLES ─────
--
-- Applied link by link, in the Slice 4A idiom (a deferred link is rendered in
-- the chain as deferred, never omitted, because an omitted link reads as a
-- link that does not exist):
--
--   Objective        REUSE risk_objectives — the ONE objective store
--                          (D11.15, 20260921110102:10). That row's own
--                          residual reads "requirements anchoring objectives
--                          is D4.16 (Slice 5)". This is it.
--   Requirement      design_requirements. This table.
--   Design Object    DEFERRED, NAMED. No canonical home exists. design_studies
--                          is a STUDY (a piece of analysis), not the designed
--                          object; project_wbs_elements is a deliverable
--                          decomposition, not a design object. Inventing one
--                          here would be the second scope hierarchy AGENTS
--                          invariant 1 forbids. The nearest BUILT downstream
--                          is the WBS element, already linked, and the report
--                          says so rather than implying the design object is
--                          covered by it.
--   Procurement spec DEFERRED, NAMED. contract_packages grows its
--                          specification side in Slice 6 (D6.05/D6.08) — the
--                          same deferral 20261130090000 already records for
--                          the contract link of the scope chain. One deferral,
--                          stated the same way in both chains.
--   Installed Asset  REUSE assets. A new column `satisfied_by_asset_id`,
--                          DISTINCT from the existing `derived_from_asset_id`:
--                          derived_from points BACKWARD (this requirement
--                          exists because that asset failed, E8.14), and
--                          satisfied_by points FORWARD (this asset is what
--                          the requirement became). Collapsing them would
--                          make the learning loop and the digital thread the
--                          same edge in opposite directions.
--   Commissioning    REUSE acceptance_tests (20260818090000:186) — the ONE
--                          commissioning/acceptance test store, with its
--                          stages, outcome and punch items already modelled.
--   Operating KPI    REUSE kpi_catalog (00000000000017:21) — the ONE
--                          operating KPI catalogue, keyed by kpi_key.
--
-- ── RULING 4 — ONE KPI PER REQUIREMENT, AND WHY THAT IS NOT A SIMPLIFICATION
--
-- operating_kpi_key is a single column, not a join table. A requirement
-- measured in operation by three different KPIs is a requirement that has not
-- been decomposed: it is three requirements wearing one reference, and the
-- hierarchy this file adds is exactly the instrument for saying so. The
-- constraint is therefore deliberate and is stated to the user in the refusal
-- text of link_requirement_thread rather than worked around.
--
-- ── RULING 5 — owner_id IS NULLABLE AT THE TABLE AND DEMANDED BY THE AGENT ─
--
-- §10 lists owner_id. An unowned requirement is a wish, and the honest thing
-- would be NOT NULL. It is nullable anyway, for one reason that is not
-- convenience: rows already exist (the reliability-by-design demo project and
-- every case requirement recorded since 20261122090000) and NOT NULL would
-- have to invent an owner for each of them. Inventing an accountable person
-- is worse than recording that nobody is accountable. So the column is
-- nullable, the write path OFFERS it and validates it, and an unowned
-- requirement is a FINDING of the Requirements Agent (D12.09) rather than a
-- silence. The same reasoning the stakeholder-commitment file used for a
-- nullable requirement link (20261122090000: "DELIBERATELY NULLABLE so
-- D3.09's gap is representable").
--
-- ── RULING 6 — THE SELF-FK CASCADES ───────────────────────────────────────
--
-- parent_requirement_id is `on delete cascade`, not restrict. The only delete
-- path this table has is the organization/development-case cascade (there is
-- no delete RPC and no client delete policy), and under an ancestor cascade a
-- RESTRICT self-FK fires on delete order rather than on intent — it would
-- make a case that had ever used requirement nesting undeletable. Cascade is
-- consistent with what the parent cascade already means: the case goes, the
-- requirements go.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. The §10 category vocabulary, named once, server-side.
-- ---------------------------------------------------------------------------
create or replace function public.sync_spec10_requirement_categories()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'functional', 'performance', 'safety', 'reliability', 'availability',
    'maintainability', 'environmental', 'cyber', 'regulatory', 'operability',
    'quality']::text[];
$$;

comment on function public.sync_spec10_requirement_categories() is
  'D4.16 / spec III.§10: the eleven requirement categories, named in one place so the CHECK, the write path, the traceability read and the Requirements Agent cannot drift from each other.';

-- The five categories design_requirements predates §10 with. Named rather
-- than left as "whatever is in the CHECK but not in the eleven", so a reader
-- can see the union is deliberate.
create or replace function public.sync_reliability_by_design_requirement_categories()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'access', 'instrumentation', 'standardisation', 'sparing',
    'data_handover']::text[];
$$;

comment on function public.sync_reliability_by_design_requirement_categories() is
  'D4.16 ruling 2: the five E8.01 reliability-by-design categories that are NOT §10 categories. They stay valid and are reported as outside the §10 taxonomy; they are never silently mapped onto one of the eleven.';

-- The five §11 verification methods, named here beside the categories because
-- they are the same kind of thing — a controlled vocabulary this slice's write
-- paths, CHECKs and reports all have to agree about. D4.17 (20261204090100)
-- is where they become the Verification OBJECT; this is only the vocabulary,
-- and record_case_requirement below needs it one migration early.
create or replace function public.sync_verification_methods()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'analysis', 'inspection', 'demonstration', 'test',
    'operational_validation']::text[];
$$;

comment on function public.sync_verification_methods() is
  'D4.17 / spec III.§11: the five verification methods (ANALYSIS, INSPECTION, DEMONSTRATION, TEST, OPERATIONAL_VALIDATION), named in one place so the requirement''s stated method, the verification obligation''s method and the write paths cannot drift apart.';

create or replace function public.is_spec10_requirement_category(p_category text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_category = any (sync_spec10_requirement_categories()), false);
$$;

revoke all on function public.sync_spec10_requirement_categories() from public, anon;
revoke all on function public.sync_reliability_by_design_requirement_categories() from public, anon;
revoke all on function public.is_spec10_requirement_category(text) from public, anon;
revoke all on function public.sync_verification_methods() from public, anon;
grant execute on function public.sync_spec10_requirement_categories() to authenticated, service_role;
grant execute on function public.sync_reliability_by_design_requirement_categories() to authenticated, service_role;
grant execute on function public.is_spec10_requirement_category(text) to authenticated, service_role;
grant execute on function public.sync_verification_methods() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The category CHECK becomes the union of sixteen (ruling 2).
--
--    Transformed rather than assumed: if the constraint this migration
--    describes is not the constraint on the table, it RAISES instead of
--    dropping something else and installing a check nobody reviewed. Same
--    posture as 20261130090700's repair — a migration that cannot find what
--    it came to change fails loudly.
-- ---------------------------------------------------------------------------
do $category$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.design_requirements'::regclass
     and conname = 'design_requirements_category_check';

  if v_def is null then
    -- Already replaced by a previous run of this migration.
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.design_requirements'::regclass
                     and conname = 'design_requirements_category_spec10_union') then
      raise exception
        'design_requirements has neither the original category CHECK nor the §10 union CHECK — the table is not in a state this migration understands. Re-derive against the live constraint set before applying.'
        using errcode = 'check_violation';
    end if;
  else
    if position('data_handover' in v_def) = 0 then
      raise exception
        'design_requirements_category_check is not the 20260818090000 nine-category constraint (%). Do not widen a constraint blind.',
        v_def
        using errcode = 'check_violation';
    end if;
    alter table public.design_requirements
      drop constraint design_requirements_category_check;
    alter table public.design_requirements
      add constraint design_requirements_category_spec10_union
      check (category = any (
        sync_spec10_requirement_categories()
        || sync_reliability_by_design_requirement_categories()));
  end if;
end
$category$;

-- ---------------------------------------------------------------------------
-- 2. The §10 fields that were missing, and the thread links of ruling 3.
-- ---------------------------------------------------------------------------
alter table public.design_requirements
  add column if not exists parent_requirement_id bigint
    references design_requirements(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists acceptance_criteria text,
  add column if not exists objective_id uuid
    references risk_objectives(id) on delete set null,
  add column if not exists satisfied_by_asset_id uuid
    references assets(id) on delete set null,
  add column if not exists commissioning_test_id bigint
    references acceptance_tests(id) on delete set null,
  add column if not exists operating_kpi_key text
    references kpi_catalog(kpi_key) on delete set null;

create index if not exists idx_dreq_parent
  on design_requirements(parent_requirement_id)
  where parent_requirement_id is not null;
create index if not exists idx_dreq_objective
  on design_requirements(organization_id, objective_id)
  where objective_id is not null;
create index if not exists idx_dreq_kpi
  on design_requirements(organization_id, operating_kpi_key)
  where operating_kpi_key is not null;

comment on column public.design_requirements.parent_requirement_id is
  'D4.16 / §10: requirement hierarchy. A parent decomposes into children; a cycle, a self-parent, a cross-organization parent and a cross-case parent are each refused by trg_requirement_hierarchy_integrity for EVERY writer.';
comment on column public.design_requirements.owner_id is
  'D4.16 / §10 owner_id. Nullable by ruling 5 — an unowned requirement is representable so the Requirements Agent can report it, rather than an owner being invented at migration time.';
comment on column public.design_requirements.acceptance_criteria is
  'D4.16 / §10: what "met" means, in measurable terms. A requirement verified by TEST or OPERATIONAL_VALIDATION with no acceptance criteria is a deterministic inconsistency finding (D12.09) — there is nothing to test against.';
comment on column public.design_requirements.objective_id is
  'D4.16 / §10 traceability head: Objective → Requirement, on risk_objectives (the ONE objective store, D11.15). Closes that row''s named residual.';
comment on column public.design_requirements.satisfied_by_asset_id is
  'D4.16 / §10 traceability: Installed Asset. Distinct from derived_from_asset_id, which points BACKWARD to the asset whose failure produced the requirement (E8.14).';
comment on column public.design_requirements.commissioning_test_id is
  'D4.16 / §10 traceability: Commissioning Test, on acceptance_tests (the ONE acceptance test store, 20260818090000).';
comment on column public.design_requirements.operating_kpi_key is
  'D4.16 / §10 traceability terminus: Operating KPI, on kpi_catalog (the ONE KPI catalogue). One per requirement by ruling 4 — a requirement needing several has not been decomposed.';

-- ---------------------------------------------------------------------------
-- 3. Hierarchy integrity — INSERT and UPDATE, every writer, no service escape.
--
--    A cycle is corrupt data, not a provenance question: the D11.15 objective
--    nesting trigger states that ruling and this follows it. There is no
--    marker that admits a cycle.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_hierarchy_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p design_requirements%rowtype;
  v_walk bigint;
  v_hops int := 0;
begin
  if new.parent_requirement_id is null then
    return new;
  end if;
  if new.parent_requirement_id = new.id then
    raise exception
      'A requirement cannot be its own parent. Decomposition means a requirement is broken into DIFFERENT requirements; a self-parent records a loop, not a breakdown.'
      using errcode = 'check_violation';
  end if;

  select * into p from design_requirements where id = new.parent_requirement_id;
  if not found then
    raise exception
      'Parent requirement % does not exist. A hierarchy that points at nothing is worse than a flat list, because it reads as decomposed.',
      new.parent_requirement_id
      using errcode = 'foreign_key_violation';
  end if;
  if p.organization_id <> new.organization_id then
    raise exception
      'A requirement cannot be nested under another organization''s requirement. The hierarchy is a tenant structure, and a parent outside the tenant is a tenancy hole wearing an org chart.'
      using errcode = 'check_violation';
  end if;
  -- Case scoping mirrors trg_requirement_need_case (20261130090000): a
  -- requirement on case A decomposed from a requirement on case B would make
  -- every per-case traceability count disagree with every other one.
  if new.development_case_id is not null
     and p.development_case_id is distinct from new.development_case_id then
    raise exception
      'The parent requirement belongs to a different development case. Decomposition happens inside one case; a cross-case parent makes both cases'' traceability reports wrong in opposite directions.'
      using errcode = 'check_violation';
  end if;

  -- Walk up. new.id is 0/NULL on INSERT (bigserial is assigned before the
  -- BEFORE trigger fires, so it is present) — the walk still terminates on
  -- the depth cap even if it were not.
  v_walk := p.parent_requirement_id;
  while v_walk is not null loop
    v_hops := v_hops + 1;
    if v_walk = new.id then
      raise exception
        'That parent is already a descendant of this requirement — the link would close a cycle. A requirement hierarchy is a tree; a cycle in it makes "what does this requirement decompose into" unanswerable.'
        using errcode = 'check_violation';
    end if;
    if v_hops > 64 then
      raise exception
        'The requirement hierarchy above % is deeper than 64 levels, or already contains a cycle. Refusing rather than walking forever.',
        new.parent_requirement_id
        using errcode = 'check_violation';
    end if;
    select parent_requirement_id into v_walk
      from design_requirements where id = v_walk;
  end loop;

  return new;
end
$$;

revoke all on function public.enforce_requirement_hierarchy_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_hierarchy_integrity on public.design_requirements;
create trigger trg_requirement_hierarchy_integrity
  before insert or update on public.design_requirements
  for each row execute function public.enforce_requirement_hierarchy_integrity();

-- ---------------------------------------------------------------------------
-- 4. Thread integrity — the links a foreign key cannot police.
--
--    Every FK in section 2 proves the target EXISTS. None of them proves the
--    target belongs to this tenant, and three of the four targets are
--    org-scoped. A requirement pointing at another organization's objective,
--    asset or commissioning test is a cross-tenant read dressed as
--    traceability. INSERT and UPDATE, every writer.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_thread_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.objective_id is not null
     and not exists (select 1 from risk_objectives o
                      where o.id = new.objective_id
                        and o.organization_id = new.organization_id) then
    raise exception
      'That objective belongs to another organization. A requirement traces to an objective inside its own tenant or to none at all.'
      using errcode = 'check_violation';
  end if;
  if new.satisfied_by_asset_id is not null
     and not exists (select 1 from assets a
                      where a.id = new.satisfied_by_asset_id
                        and a.organization_id = new.organization_id) then
    raise exception
      'That asset belongs to another organization. The installed-asset link is inside the tenant or absent.'
      using errcode = 'check_violation';
  end if;
  if new.commissioning_test_id is not null
     and not exists (select 1 from acceptance_tests t
                      where t.id = new.commissioning_test_id
                        and t.organization_id = new.organization_id) then
    raise exception
      'That acceptance test belongs to another organization. The commissioning-test link is inside the tenant or absent.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_requirement_thread_tenancy()
  from public, anon, authenticated;

drop trigger if exists trg_requirement_thread_tenancy on public.design_requirements;
create trigger trg_requirement_thread_tenancy
  before insert or update on public.design_requirements
  for each row execute function public.enforce_requirement_thread_tenancy();

-- ---------------------------------------------------------------------------
-- 5. record_case_requirement, carrying the §10 fields.
--
--    RE-CREATED, not forked. This is the shipped write path (20261122090000)
--    and its existing caller (developService.recordCaseRequirement →
--    CaseChainsPanels) keeps working unchanged: every new field is optional
--    and every existing refusal is preserved verbatim. The category list is
--    now read from the two vocabulary functions instead of being retyped, so
--    the CHECK and the door can no longer disagree.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_requirement(
  p_case_id uuid,
  p_requirement jsonb
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
  v_ref text := nullif(btrim(coalesce(p_requirement->>'requirement_ref','')), '');
  v_category text := nullif(btrim(coalesce(p_requirement->>'category','')), '');
  v_source text := coalesce(nullif(btrim(coalesce(p_requirement->>'source','')), ''), 'engineering');
  v_method text := nullif(btrim(coalesce(p_requirement->>'verification_method','')), '');
  v_criteria text := nullif(btrim(coalesce(p_requirement->>'acceptance_criteria','')), '');
  v_owner uuid := sync_text_as_uuid(p_requirement->>'owner_id');
  v_objective uuid := sync_text_as_uuid(p_requirement->>'objective_id');
  v_parent bigint := sync_text_as_int(p_requirement->>'parent_requirement_id');
  v_kpi text := nullif(btrim(coalesce(p_requirement->>'operating_kpi_key','')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a project requirement requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a requirement carries a reference the rest of the project can cite (requirement_ref)');
  end if;
  if v_category is null or not (v_category = any (
       sync_spec10_requirement_categories()
       || sync_reliability_by_design_requirement_categories())) then
    return jsonb_build_object('error',
      format('category must be one of the eleven §10 categories (%s) or one of the reliability-by-design categories this table predates §10 with (%s)',
        array_to_string(sync_spec10_requirement_categories(), ', '),
        array_to_string(sync_reliability_by_design_requirement_categories(), ', ')));
  end if;
  if v_source not in ('engineering','operations','maintenance','incident','regulatory','operational_lesson') then
    return jsonb_build_object('error',
      'source must be one of: engineering, operations, maintenance, incident, regulatory, operational_lesson');
  end if;
  if coalesce(length(btrim(coalesce(p_requirement->>'requirement',''))), 0) < 10 then
    return jsonb_build_object('error',
      'state the requirement — what must be true (10 characters minimum)');
  end if;
  if v_method is not null and not (v_method = any (sync_verification_methods())) then
    return jsonb_build_object('error',
      format('verification_method must be one of: %s',
        array_to_string(sync_verification_methods(), ', ')));
  end if;
  if p_requirement ? 'owner_id'
     and nullif(btrim(coalesce(p_requirement->>'owner_id','')), '') is not null
     and v_owner is null then
    return jsonb_build_object('error', 'owner_id is not a valid identifier');
  end if;
  if v_owner is not null
     and not exists (select 1 from user_profiles u
                      where u.id = v_owner and u.organization_id = v_org) then
    return jsonb_build_object('error',
      'the requirement owner must be a member of this organization — accountability that points outside the tenant is not accountability');
  end if;
  if p_requirement ? 'parent_requirement_id'
     and nullif(btrim(coalesce(p_requirement->>'parent_requirement_id','')), '') is not null
     and v_parent is null then
    return jsonb_build_object('error', 'parent_requirement_id is not a valid identifier');
  end if;
  if v_parent is not null
     and not exists (select 1 from design_requirements d
                      where d.id = v_parent and d.organization_id = v_org
                        and d.development_case_id = c.id) then
    return jsonb_build_object('error',
      'the parent requirement must be a requirement on this same case');
  end if;
  if v_objective is not null
     and not exists (select 1 from risk_objectives o
                      where o.id = v_objective and o.organization_id = v_org) then
    return jsonb_build_object('error', 'that objective is not in this organization');
  end if;
  if v_kpi is not null
     and not exists (select 1 from kpi_catalog k where k.kpi_key = v_kpi) then
    return jsonb_build_object('error',
      format('"%s" is not an operating KPI in the catalogue — the thread terminates on a KPI that exists or on none at all', v_kpi));
  end if;
  if exists (select 1 from design_requirements d
             where d.organization_id = v_org and d.requirement_ref = v_ref) then
    return jsonb_build_object('error',
      format('requirement reference "%s" already exists in this organization — a reference identifies one requirement, so pick another rather than overwriting it', v_ref));
  end if;

  insert into design_requirements (
    organization_id, project_id, development_case_id, requirement_ref,
    category, requirement, source, verification_method, created_by,
    parent_requirement_id, owner_id, acceptance_criteria, objective_id,
    operating_kpi_key)
  values (
    v_org, c.capital_project_id, c.id, v_ref, v_category,
    btrim(p_requirement->>'requirement'), v_source, v_method, auth.uid(),
    v_parent, v_owner, v_criteria, v_objective, v_kpi)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_requirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'requirement_id', v_id,
      'requirement_ref', v_ref, 'category', v_category, 'source', v_source,
      'spec10_category', is_spec10_requirement_category(v_category)),
    null,
    jsonb_build_object('requirement_ref', v_ref, 'category', v_category,
      'source', v_source, 'verification_status', 'open',
      'parent_requirement_id', v_parent, 'owner_id', v_owner,
      'objective_id', v_objective, 'operating_kpi_key', v_kpi,
      'acceptance_criteria', v_criteria));

  return jsonb_build_object('requirement_id', v_id, 'case_id', c.id,
    'requirement_ref', v_ref,
    'spec10Category', is_spec10_requirement_category(v_category));
end
$$;

revoke all on function public.record_case_requirement(uuid, jsonb) from public, anon;
grant execute on function public.record_case_requirement(uuid, jsonb) to authenticated, service_role;

comment on function public.record_case_requirement(uuid, jsonb) is
  'D3.08/D4.16: the ONE customer write path for a project requirement, carrying the §10 fields (parent, owner, acceptance criteria, objective, operating KPI). Category is validated against the vocabulary functions, never a retyped list.';

-- ---------------------------------------------------------------------------
-- 6. link_requirement_thread — attaching the thread AFTER the requirement
--    exists, which is when most of it is knowable.
--
--    A requirement is written at FEL; the asset it becomes and the test that
--    proves it exist years later. So the thread is a separate act with its
--    own audit trail carrying previous_state and new_state, rather than a
--    field on creation that would be null forever in practice.
--
--    CLEARING A LINK IS REFUSED BY NAME (the link_commitment_to_requirement
--    precedent, 20261122090000): re-pointing a thread link is a correction,
--    but erasing one is the digital thread quietly losing a hop, and a hop
--    that disappears is indistinguishable from one that never existed.
-- ---------------------------------------------------------------------------
create or replace function public.link_requirement_thread(
  p_requirement_id bigint,
  p_link jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d design_requirements%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_objective uuid;
  v_asset uuid;
  v_test bigint;
  v_kpi text;
  v_parent bigint;
  v_owner uuid;
  v_criteria text;
  v_touched int := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking the requirement thread requires a planning, engineering or governance role');
  end if;
  select * into d from design_requirements
   where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;

  v_before := jsonb_build_object(
    'objective_id', d.objective_id, 'satisfied_by_asset_id', d.satisfied_by_asset_id,
    'commissioning_test_id', d.commissioning_test_id,
    'operating_kpi_key', d.operating_kpi_key,
    'parent_requirement_id', d.parent_requirement_id,
    'owner_id', d.owner_id, 'acceptance_criteria', d.acceptance_criteria);

  v_objective := d.objective_id;
  v_asset := d.satisfied_by_asset_id;
  v_test := d.commissioning_test_id;
  v_kpi := d.operating_kpi_key;
  v_parent := d.parent_requirement_id;
  v_owner := d.owner_id;
  v_criteria := d.acceptance_criteria;

  -- Each key: present and non-empty re-points; present and EMPTY is refused
  -- by name; absent leaves the link alone.
  if p_link ? 'objective_id' then
    if nullif(btrim(coalesce(p_link->>'objective_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the objective link is refused — a requirement that stops tracing to an objective has not lost its objective, it has lost the record of it. Re-point it at the objective it now serves.');
    end if;
    v_objective := sync_text_as_uuid(p_link->>'objective_id');
    if v_objective is null then
      return jsonb_build_object('error', 'objective_id is not a valid identifier');
    end if;
    if not exists (select 1 from risk_objectives o
                    where o.id = v_objective and o.organization_id = v_org) then
      return jsonb_build_object('error', 'that objective is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'satisfied_by_asset_id' then
    if nullif(btrim(coalesce(p_link->>'satisfied_by_asset_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the installed-asset link is refused — re-point it at the asset that now carries the requirement.');
    end if;
    v_asset := sync_text_as_uuid(p_link->>'satisfied_by_asset_id');
    if v_asset is null then
      return jsonb_build_object('error', 'satisfied_by_asset_id is not a valid identifier');
    end if;
    if not exists (select 1 from assets a
                    where a.id = v_asset and a.organization_id = v_org) then
      return jsonb_build_object('error', 'that asset is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'commissioning_test_id' then
    if nullif(btrim(coalesce(p_link->>'commissioning_test_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the commissioning-test link is refused — re-point it at the test that now proves the requirement.');
    end if;
    v_test := sync_text_as_int(p_link->>'commissioning_test_id');
    if v_test is null then
      return jsonb_build_object('error', 'commissioning_test_id is not a valid identifier');
    end if;
    if not exists (select 1 from acceptance_tests t
                    where t.id = v_test and t.organization_id = v_org) then
      return jsonb_build_object('error', 'that acceptance test is not in this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'operating_kpi_key' then
    if nullif(btrim(coalesce(p_link->>'operating_kpi_key','')), '') is null then
      return jsonb_build_object('error',
        'clearing the operating-KPI link is refused — a requirement that stops being measured in operation is the thread going dark at exactly the point it was built to reach.');
    end if;
    v_kpi := btrim(p_link->>'operating_kpi_key');
    if not exists (select 1 from kpi_catalog k where k.kpi_key = v_kpi) then
      return jsonb_build_object('error',
        format('"%s" is not an operating KPI in the catalogue. If this requirement is measured by several KPIs it has not been decomposed — record child requirements under it and give each one its KPI (ruling 4).', v_kpi));
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'parent_requirement_id' then
    if nullif(btrim(coalesce(p_link->>'parent_requirement_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the parent link is refused — a requirement promoted to a root is a restructuring, and a restructuring is recorded by re-pointing, not by erasure.');
    end if;
    v_parent := sync_text_as_int(p_link->>'parent_requirement_id');
    if v_parent is null then
      return jsonb_build_object('error', 'parent_requirement_id is not a valid identifier');
    end if;
    if not exists (select 1 from design_requirements x
                    where x.id = v_parent and x.organization_id = v_org
                      and x.development_case_id is not distinct from d.development_case_id) then
      return jsonb_build_object('error',
        'the parent requirement must be a requirement on this same case');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'owner_id' then
    if nullif(btrim(coalesce(p_link->>'owner_id','')), '') is null then
      return jsonb_build_object('error',
        'clearing the owner is refused — a requirement that had an accountable person and now has none is a handover nobody recorded. Name the person it moved to.');
    end if;
    v_owner := sync_text_as_uuid(p_link->>'owner_id');
    if v_owner is null then
      return jsonb_build_object('error', 'owner_id is not a valid identifier');
    end if;
    if not exists (select 1 from user_profiles u
                    where u.id = v_owner and u.organization_id = v_org) then
      return jsonb_build_object('error',
        'the requirement owner must be a member of this organization');
    end if;
    v_touched := v_touched + 1;
  end if;

  if p_link ? 'acceptance_criteria' then
    v_criteria := nullif(btrim(coalesce(p_link->>'acceptance_criteria','')), '');
    if v_criteria is null then
      return jsonb_build_object('error',
        'acceptance criteria cannot be blanked — state what "met" means, measurably, or leave the previous statement standing.');
    end if;
    v_touched := v_touched + 1;
  end if;

  if v_touched = 0 then
    return jsonb_build_object('error',
      'nothing to link — supply at least one of objective_id, satisfied_by_asset_id, commissioning_test_id, operating_kpi_key, parent_requirement_id, owner_id or acceptance_criteria');
  end if;

  update design_requirements set
    objective_id = v_objective,
    satisfied_by_asset_id = v_asset,
    commissioning_test_id = v_test,
    operating_kpi_key = v_kpi,
    parent_requirement_id = v_parent,
    owner_id = v_owner,
    acceptance_criteria = v_criteria
  where id = d.id;

  v_after := jsonb_build_object(
    'objective_id', v_objective, 'satisfied_by_asset_id', v_asset,
    'commissioning_test_id', v_test, 'operating_kpi_key', v_kpi,
    'parent_requirement_id', v_parent, 'owner_id', v_owner,
    'acceptance_criteria', v_criteria);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'requirement_thread', coalesce(v_role, 'unknown'),
    jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref,
      'case_id', d.development_case_id, 'links_touched', v_touched),
    v_before, v_after);

  return jsonb_build_object('requirement_id', d.id,
    'requirement_ref', d.requirement_ref, 'linksTouched', v_touched,
    'thread', v_after);
end
$$;

revoke all on function public.link_requirement_thread(bigint, jsonb) from public, anon;
grant execute on function public.link_requirement_thread(bigint, jsonb) to authenticated, service_role;

comment on function public.link_requirement_thread(bigint, jsonb) is
  'D4.16 / spec II.2 + §10: attaches the digital-thread links to an existing requirement. Re-pointing is allowed; CLEARING any link is refused by name, because a hop that disappears is indistinguishable from one that never existed.';

-- ---------------------------------------------------------------------------
-- 7. get_case_requirement_traceability — the §10 thread, refusal-first.
--
--    THE REFUSAL THAT MATTERS. Over a case with NO requirements this returns
--    a refusal, not a report of zero orphans. "0 orphans, 0 unverified, 0
--    missing methods" over an empty set is the single most dangerous output
--    this function could produce: it is indistinguishable from a project
--    whose requirements are all traced, and it would be rendered in green.
--
--    Every percentage carries its denominator, and a percentage whose
--    denominator is zero is NULL with a stated reason — never 0 and never
--    100. Non-finite is impossible here because every figure is a count
--    ratio, but the division is guarded anyway so a later numeric input
--    cannot make 'NaN'::numeric = 'NaN' true somewhere downstream.
--
--    The WBS question is DELEGATED (ruling 1): get_case_scope_traceability is
--    the ONE implementation and its answer is lifted, not recomputed.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_requirement_traceability(p_case_id uuid)
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
  v_total int;
  v_scope jsonb;
  v_reqs_no_wbs jsonb := '[]'::jsonb;
  v_reqs_no_need jsonb := '[]'::jsonb;
  v_no_objective jsonb;
  v_no_method jsonb;
  v_unverified jsonb;
  v_no_owner jsonb;
  v_no_criteria jsonb;
  v_outside_spec10 jsonb;
  v_no_asset int;
  v_no_test int;
  v_no_kpi int;
  v_roots int;
  v_children int;
  v_max_depth int;
  v_threaded int;
  v_refusals jsonb := '[]'::jsonb;
  v_thread_pct numeric;
  v_verified_pct numeric;
begin
  if auth.uid() is not null and v_caller_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id
    and (v_caller_org is null or organization_id = v_caller_org);
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  select count(*) into v_total
    from design_requirements d where d.development_case_id = c.id;

  -- ── THE EMPTY-SET REFUSAL ────────────────────────────────────────────────
  if v_total = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'refused', true,
      'requirementCount', 0,
      'refusal',
        'No requirement has been recorded on this case, so there is no traceability to report. This is a REFUSAL, not a clean bill: a report saying "0 orphans, 0 unverified, 0 missing verification methods" over an empty requirement set is indistinguishable from a fully traced project, and it would be read as one. Record the requirements first (§10), then ask this question.',
      'threadCoveragePct', null,
      'verifiedPct', null,
      'chain', '[]'::jsonb,
      'gaps', '{}'::jsonb);
  end if;

  -- ── The WBS answer, delegated to the ONE predicate (ruling 1) ────────────
  v_scope := get_case_scope_traceability(c.id);
  if v_scope ? 'error' then
    v_refusals := v_refusals || to_jsonb(format(
      'The scope chain could not be read (%s), so "which requirements are absent from the WBS" is not answered here. It is NOT reported as zero.',
      v_scope->>'error'));
  else
    v_reqs_no_wbs := coalesce(v_scope->'forwardGaps'->'requirementsWithoutWbs', '[]'::jsonb);
    v_reqs_no_need := coalesce(v_scope->'orphans'->'requirementsWithoutNeed', '[]'::jsonb);
  end if;

  -- ── Objective head of the thread ────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_objective
  from design_requirements d
  where d.development_case_id = c.id and d.objective_id is null;

  -- ── Verification method / status ────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'requirement', d.requirement,
    'owner', (select coalesce(u.full_name, u.email) from user_profiles u where u.id = d.owner_id))
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_method
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.verification_method), '') = '';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category, 'verificationMethod', d.verification_method,
    'verificationStatus', d.verification_status)
    order by d.requirement_ref), '[]'::jsonb)
  into v_unverified
  from design_requirements d
  where d.development_case_id = c.id and d.verification_status = 'open';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_owner
  from design_requirements d
  where d.development_case_id = c.id and d.owner_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'verificationMethod', d.verification_method)
    order by d.requirement_ref), '[]'::jsonb)
  into v_no_criteria
  from design_requirements d
  where d.development_case_id = c.id
    and coalesce(btrim(d.acceptance_criteria), '') = '';

  select coalesce(jsonb_agg(jsonb_build_object(
    'requirementId', d.id, 'requirementRef', d.requirement_ref,
    'category', d.category)
    order by d.requirement_ref), '[]'::jsonb)
  into v_outside_spec10
  from design_requirements d
  where d.development_case_id = c.id
    and not is_spec10_requirement_category(d.category);

  select
    count(*) filter (where d.satisfied_by_asset_id is null),
    count(*) filter (where d.commissioning_test_id is null),
    count(*) filter (where d.operating_kpi_key is null),
    count(*) filter (where d.parent_requirement_id is null),
    count(*) filter (where d.parent_requirement_id is not null),
    count(*) filter (where d.objective_id is not null
                       and d.satisfied_by_asset_id is not null
                       and d.commissioning_test_id is not null
                       and d.operating_kpi_key is not null)
  into v_no_asset, v_no_test, v_no_kpi, v_roots, v_children, v_threaded
  from design_requirements d
  where d.development_case_id = c.id;

  with recursive tree(id, depth) as (
    select d.id, 1
      from design_requirements d
     where d.development_case_id = c.id and d.parent_requirement_id is null
    union all
    select d.id, t.depth + 1
      from design_requirements d
      join tree t on d.parent_requirement_id = t.id
     where d.development_case_id = c.id and t.depth < 64
  )
  select coalesce(max(depth), 0) into v_max_depth from tree;

  -- ── The two percentages, with their denominators ────────────────────────
  --  v_total is > 0 here (the empty case returned above), so the division is
  --  defined. The guard is kept anyway and the refusal is explicit: a
  --  coverage percentage with no denominator is refused, never printed.
  if v_total > 0 then
    v_thread_pct := round((v_threaded::numeric / v_total::numeric) * 100, 1);
    v_verified_pct := round((
      (select count(*) from design_requirements d
        where d.development_case_id = c.id and d.verification_status = 'verified')::numeric
      / v_total::numeric) * 100, 1);
  else
    v_refusals := v_refusals || to_jsonb(
      'Coverage percentages are refused: the denominator is zero. A percentage over no requirements is not 0% and not 100% — it is undefined, and printing either would be a claim about a set that does not exist.'::text);
  end if;
  -- Postgres treats 'NaN'::numeric = 'NaN'::numeric as TRUE, so a non-finite
  -- percentage would compare equal to itself and pass an ordinary sanity
  -- check. Tested by name.
  if v_thread_pct is not null and v_thread_pct = 'NaN'::numeric then
    v_thread_pct := null;
    v_refusals := v_refusals || to_jsonb(
      'The thread coverage percentage was non-finite and has been refused rather than displayed.'::text);
  end if;
  if v_verified_pct is not null and v_verified_pct = 'NaN'::numeric then
    v_verified_pct := null;
    v_refusals := v_refusals || to_jsonb(
      'The verified percentage was non-finite and has been refused rather than displayed.'::text);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', false,
    'requirementCount', v_total,
    'spec10Categories', to_jsonb(sync_spec10_requirement_categories()),
    'hierarchy', jsonb_build_object(
      'roots', v_roots, 'children', v_children, 'maxDepth', v_max_depth),
    'threadCoveragePct', v_thread_pct,
    'verifiedPct', v_verified_pct,
    -- The §10 chain, every link stated — built or deferred. A deferred link
    -- is RENDERED, never dropped: a link absent from the list reads as a link
    -- that does not exist rather than one that is not built yet.
    'chain', jsonb_build_array(
      jsonb_build_object('link', 'objective', 'home', 'risk_objectives', 'built', true,
        'count', v_total - jsonb_array_length(v_no_objective)),
      jsonb_build_object('link', 'requirement', 'home', 'design_requirements', 'built', true,
        'count', v_total),
      jsonb_build_object('link', 'design object', 'home', 'none — no canonical store', 'built', false,
        'count', null,
        'deferral', 'No design-object store exists (ruling 3). design_studies is analysis and project_wbs_elements is a deliverable decomposition; neither is the designed object. The nearest built downstream is the WBS element, reached through project_requirement_wbs, and this report does NOT let that stand in for the design object.'),
      jsonb_build_object('link', 'procurement specification', 'home', 'contract_packages (D6.05/D6.08)', 'built', false,
        'count', null,
        'deferral', 'Procurement specification lands in Slice 6, the same deferral the I.6 scope chain already records for its contract link. No specification link is asserted here and none is implied by the links either side of it.'),
      jsonb_build_object('link', 'installed asset', 'home', 'assets', 'built', true,
        'count', v_total - v_no_asset),
      jsonb_build_object('link', 'commissioning test', 'home', 'acceptance_tests', 'built', true,
        'count', v_total - v_no_test),
      jsonb_build_object('link', 'operating KPI', 'home', 'kpi_catalog', 'built', true,
        'count', v_total - v_no_kpi)),
    -- The scope chain is NOT restated here. It is named, with its owner, so a
    -- reader knows where the other half of the requirement's traceability
    -- lives and that it is one predicate, not two.
    'scopeChain', jsonb_build_object(
      'owner', 'get_case_scope_traceability (D5.02)',
      'requirementsWithoutWbs', v_reqs_no_wbs,
      'requirementsWithoutNeed', v_reqs_no_need,
      'note', 'The requirement → WBS question and the requirement → business-need question each have ONE implementation and this report delegates to it. Two implementations of one predicate is how a chain reports itself complete from one end and broken from the other.'),
    'gaps', jsonb_build_object(
      'withoutObjective', v_no_objective,
      'withoutVerificationMethod', v_no_method,
      'unverified', v_unverified,
      'withoutOwner', v_no_owner,
      'withoutAcceptanceCriteria', v_no_criteria,
      'outsideSpec10Taxonomy', v_outside_spec10,
      'withoutInstalledAsset', v_no_asset,
      'withoutCommissioningTest', v_no_test,
      'withoutOperatingKpi', v_no_kpi),
    'refusals', v_refusals);
end
$$;

revoke all on function public.get_case_requirement_traceability(uuid) from public, anon;
grant execute on function public.get_case_requirement_traceability(uuid) to authenticated, service_role;

comment on function public.get_case_requirement_traceability(uuid) is
  'D4.16 / spec III.§10 + II.2: the digital thread over one case''s requirements. REFUSES over an empty requirement set rather than reporting zero orphans, refuses a percentage with a zero denominator, and DELEGATES the requirement→WBS question to get_case_scope_traceability (D5.02) rather than re-implementing it.';

-- ---------------------------------------------------------------------------
-- 8. The lineage record (D11.29). The traceability report produces NUMBERS —
--    two percentages and nine counts — so it records a run naming the code
--    version that produced them and every refusal it hit on the way.
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  -- ONLY KEYS A COMPUTE FUNCTION RECORDS. The slice tests assert that every
  -- key pinned here appears in a record_calculation_run call, so a pin can
  -- never read as coverage that does not exist.
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
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

create or replace function public.compute_case_requirement_traceability(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_result jsonb;
  v_run uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  v_result := get_case_requirement_traceability(c.id);
  if v_result ? 'error' then
    return v_result;
  end if;

  -- A REFUSED report still records a run. The refusal IS the output, and a
  -- refusal with no lineage is a refusal nobody can later prove happened.
  v_run := record_calculation_run(
    c.id,
    'case_requirement_traceability',
    'deterministic count and ratio over design_requirements, delegating requirement→WBS to get_case_scope_traceability',
    jsonb_build_object(
      'requirementCount', v_result->'requirementCount',
      'spec10CategoryCount', array_length(sync_spec10_requirement_categories(), 1)),
    jsonb_build_array(
      jsonb_build_object('table', 'design_requirements', 'scope', 'development_case_id = ' || c.id::text),
      jsonb_build_object('function', 'get_case_scope_traceability', 'scope', c.id::text)),
    case when coalesce((v_result->>'refused')::boolean, false)
      then null
      else jsonb_build_object(
        'threadCoveragePct', v_result->'threadCoveragePct',
        'verifiedPct', v_result->'verifiedPct',
        'hierarchy', v_result->'hierarchy',
        'gapCounts', jsonb_build_object(
          'withoutObjective', jsonb_array_length(v_result->'gaps'->'withoutObjective'),
          'withoutVerificationMethod', jsonb_array_length(v_result->'gaps'->'withoutVerificationMethod'),
          'unverified', jsonb_array_length(v_result->'gaps'->'unverified'),
          'withoutOwner', jsonb_array_length(v_result->'gaps'->'withoutOwner'),
          'outsideSpec10Taxonomy', jsonb_array_length(v_result->'gaps'->'outsideSpec10Taxonomy')))
      end,
    case when coalesce((v_result->>'refused')::boolean, false)
      then jsonb_build_array(v_result->>'refusal')
      else coalesce(v_result->'refusals', '[]'::jsonb) end);

  return v_result || jsonb_build_object('calculationRunId', v_run);
end
$$;

revoke all on function public.compute_case_requirement_traceability(uuid) from public, anon;
grant execute on function public.compute_case_requirement_traceability(uuid) to authenticated, service_role;

comment on function public.compute_case_requirement_traceability(uuid) is
  'D4.16 + D11.29: the traceability read with a calculation_runs row behind it. A REFUSED report records a run too — a refusal with no lineage is a refusal nobody can later prove happened.';

notify pgrst, 'reload schema';
