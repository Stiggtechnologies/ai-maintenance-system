-- ============================================================================
-- Sync Develop — Slice 7A, part 1 of 3.
-- D7.17 (WorkPackage, spec III.§27 — five types) and D7.10 (spec II.4 — the
-- typed EWP → PWP → CWP → IWP chain, enforced at the database).
--
-- ════════════════════════════════════════════════════════════════════════════
-- THE RULING. Read this before the schema.
--
-- Slice 7A opens with THREE live work-grouping models keyed to `work_orders`
-- and TWO constraint families already in the tree. The register says so at
-- D7.17 and D7.18, and the overlap map rules both. This header states the
-- ruling in the form the earlier CONFLICT rulings use (gate → stage_gate_*,
-- evidence → evidence_items, decision → decisions, assumption →
-- risk_assumptions), because the most reliable defect in this programme —
-- found in six consecutive chunks — is a SECOND implementation of one
-- question.
--
-- ── RULING 19 (§27 WorkPackage). `work_orders` remains the work IDENTITY.
--    The AWP package is a THIRD CONTEXT of the shape the other two already
--    have: one grouping row plus one membership row referencing work_orders.
--
--    The three models are not three answers to one question:
--
--      work_orders             (00000000000001:214) — THE WORK IDENTITY. One
--                              unit of executable work, one asset, one status,
--                              one set of hours. Every other model points at
--                              it.
--      restoration_event_work  (20260921090000:62)  — a MEMBERSHIP of a work
--                              order in a restoration EVENT.
--                              `unique(event_id, work_order_id)`, event_id
--                              NOT NULL, cascading from the event.
--      outage_work             (20260811130000:85)  — a MEMBERSHIP of a work
--                              order in an outage WINDOW.
--                              `unique(outage_window_id, work_order_id)`,
--                              outage_window_id NOT NULL, cascading from the
--                              window.
--
--    So the repository already holds ONE work identity and TWO operating
--    contexts that group it. Neither context can hold a project-delivery
--    package: a package would have to invent a restoration event or an outage
--    window in order to exist.
--
--    This file therefore adds the third context in exactly that shape —
--    `work_packages` (the grouping) + `work_package_work` (the membership) —
--    and copies NOTHING from work_orders. Not the job title, not the asset,
--    not the craft, not the hours, not the execution status. A package's
--    `status` is its own RELEASE state; the execution state of the work stays
--    on work_orders and the read below joins to it rather than duplicating it.
--
--    ALTERNATIVES REJECTED, and why:
--
--    (a) `package_type` + `parent_package_id` ON work_orders. Rejected: one
--        table would then answer both "what is this job" and "what is this
--        package", which is the two-answers failure AGENTS invariant 8
--        forbids. Every existing consumer of work_orders — the §71-78 event
--        emitter (20261207090000:1049), evaluate_schedule_feasibility,
--        refresh_restoration_readiness, both membership tables, the KPI reads
--        — would begin seeing package rows as WORK, inflating backlog counts
--        and craft-hour demand with rows that are containers. The cardinality
--        differs too: an IWP contains work orders; a CWP contains IWPs.
--
--    (b) Reuse restoration_event_work or outage_work with a nullable anchor.
--        Rejected: both anchors are NOT NULL and both cascade from their
--        context. Making either nullable turns a membership table into a
--        second package store AND puts project rows inside Recovery's and
--        Scheduling's own queries, every one of which filters by event_id or
--        outage_window_id and would silently exclude them — a store that half
--        the product cannot see.
--
--    (c) Hang the package off `project_wbs_elements` (20261130090000:168).
--        Rejected on domain grounds: the WBS is the SCOPE/COST breakdown and
--        the AWP package is the EXECUTION breakdown, and the entire point of
--        Advanced Work Packaging is that the two decompositions differ. The
--        package REFERENCES a WBS element (`wbs_element_id`) instead of
--        copying it, so "which WBS does this package deliver" has one answer.
--
--    (d) Build spec §27's standalone WorkPackage with its own scope, area,
--        status and work list. Rejected: that is a FOURTH work store. It is
--        what the overlap map already ruled against for D7.17 and what
--        AGENTS invariant 8 forbids.
--
--    §27 FIELD BY FIELD:
--      id            → work_packages.id
--      project_id    → development_case_id (and, THROUGH the case,
--                      capital_project_id — referenced, never copied)
--      type          → package_type, the spec's five: ENGINEERING,
--                      PROCUREMENT, CONSTRUCTION, INSTALLATION, COMMISSIONING
--      area          → area, plus wbs_element_id for the structured answer
--      scope         → scope (>= 20 chars; a package with no scope statement
--                      is a label, the project_wbs_elements rule)
--      required_by   → required_by
--      status        → status (the package's RELEASE state; see above)
--
--    §34's `WorkPackage DEPENDS_ON Constraint` edge is closed in part 2 of
--    this slice, at the column `sync_spec34_absent_edge_audit()` pre-declared
--    for it (20261207090300:169) — restoration_constraints.work_order_id —
--    plus the direct package anchor. Part 2 also carries RULING 20 (§28).
--
-- ── D7.10, THE TYPED CHAIN. Spec II.4: ENGINEERING WP → PROCUREMENT WP →
--    CONSTRUCTION WP → INSTALLATION WP → FIELD EXECUTION. The five §27 types
--    are ordered ONCE, by `sync_awp_level`, and the ordering is enforced by a
--    trigger rather than by a CHECK because the rule reads the PARENT ROW:
--
--      * a package at level N > 1 must have a parent at exactly level N − 1 —
--        no skipping, and no pointing at the wrong type;
--      * a level-1 (engineering) package must have NO parent — the head of
--        the chain is the head;
--      * a package below level 1 must HAVE a parent — a floating IWP is a
--        package nobody planned;
--      * the parent belongs to the same development case and the same tenant.
--
--    COMMISSIONING is level 5, below INSTALLATION. II.4's chain names four
--    levels and ends at FIELD EXECUTION; §27 names five types. Rather than
--    leave the fifth type outside the ordering — where it would be the one
--    package kind with no rule about what it may hang from, which is how a
--    typed chain quietly becomes an untyped one — it takes the place the §29
--    commissioning state machine already gives it: after installation
--    (CONSTRUCTION_COMPLETE → MECHANICAL_COMPLETE → …). This is a decision,
--    it is stated here, and the slice test pins it.
--
-- ── §70. No AI or system identity releases a work package. The release is
--    the act that says "start work", and spec §70 reserves "equipment safe to
--    start" for people. `enforce_awp_act_is_human` is the ONE wall, bound by
--    TG_ARGV to the actor column, raising if bound to a column that does not
--    exist (the 5B lesson) and raising on an actor with no user_profiles row
--    IN THE ROW'S OWN TENANT (the 6A lesson: a NULL role read as "not
--    ai_admin" is how a machine account with no profile walks through).
--
-- ── REFUSAL-FIRST. `release_work_package` refuses a package with NO
--    constraints recorded against it. "0 open constraints" on a package
--    nobody assessed reads as READY, and reading as ready is the whole failure
--    spec §27 describes ("Construction should not start merely to create
--    reported progress"). An unassessed package is not constraint-free; it is
--    unassessed, and the refusal says so by name.
--
-- Canonical reuse: work_orders, development_cases, project_wbs_elements,
-- organizations, user_profiles, audit_events, security_events,
-- app_current_org, sync_text_as_uuid. No new work store, no second execution
-- status, no second audit log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE AWP ORDERING, AS DATA. One function, read by the trigger, by the
--    RPCs, by the read, and mirrored in src/lib/develop/workPackaging.ts with
--    the slice test pinning the two together — so a sixth type or a reordering
--    cannot land on one side only.
-- ---------------------------------------------------------------------------
create or replace function public.sync_awp_level(p_type text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'engineering'   then 1
    when 'procurement'   then 2
    when 'construction'  then 3
    when 'installation'  then 4
    when 'commissioning' then 5
  end;
$$;

revoke all on function public.sync_awp_level(text) from public, anon;
grant execute on function public.sync_awp_level(text) to authenticated, service_role;

comment on function public.sync_awp_level(text) is
  'D7.10 (spec II.4): the ONE ordering of the five §27 package types — EWP(1) → PWP(2) → CWP(3) → IWP(4) → commissioning(5). NULL for an unknown type, which every caller treats as a refusal rather than as level zero.';

create or replace function public.sync_awp_parent_type(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'procurement'   then 'engineering'
    when 'construction'  then 'procurement'
    when 'installation'  then 'construction'
    when 'commissioning' then 'installation'
  end;
$$;

revoke all on function public.sync_awp_parent_type(text) from public, anon;
grant execute on function public.sync_awp_parent_type(text) to authenticated, service_role;

comment on function public.sync_awp_parent_type(text) is
  'D7.10: the type a package of the given type must hang from. NULL for ''engineering'' (the head of the chain) and NULL for an unknown type — the trigger distinguishes the two rather than treating both as "no parent required".';

-- ---------------------------------------------------------------------------
-- 2. THE PACKAGE (§27) — the grouping row.
-- ---------------------------------------------------------------------------
create table if not exists public.work_packages (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- CASCADE at the constraint, refused at the wall — the
  -- contract_change_orders posture (20261209090000:69). A development case
  -- teardown must remain possible; a RESTRICT reached first would make a case
  -- with one released package permanently undeletable.
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- RESTRICT: the chain is the point. A parent deleted out from under its
  -- children would leave installation packages hanging from nothing, which is
  -- exactly the state the chain trigger refuses to CREATE.
  parent_package_id bigint references work_packages(id) on delete restrict,
  package_code text not null check (btrim(package_code) <> ''),
  title text not null check (length(btrim(title)) >= 3),
  package_type text not null check (package_type in
    ('engineering', 'procurement', 'construction', 'installation', 'commissioning')),
  -- §27 "area". Free text beside the STRUCTURED answer, which is the WBS
  -- reference: the AWP execution breakdown is not the WBS scope breakdown, so
  -- the package names the element it delivers rather than restating it.
  area text,
  wbs_element_id uuid references project_wbs_elements(id) on delete set null,
  scope text not null check (length(btrim(scope)) >= 20),
  required_by date,
  -- THREE STATES, BECAUSE THREE IS WHAT THE PRODUCT CAN REACH. An earlier
  -- draft of this table also listed 'planned', 'executing' and 'complete'.
  -- Nothing sets them: `release_work_package` writes 'released',
  -- `cancel_work_package` writes 'cancelled', and every other door leaves the
  -- row in 'draft'. Shipping states no door can produce invites a reader to
  -- filter on them and get an always-empty answer, and invites the next
  -- author to assume the execution lifecycle lives here. It does not — the
  -- EXECUTION state of the work is `work_orders.status` (RULING 19), and the
  -- read joins to it. A package's own status is its RELEASE state: recorded,
  -- released, or withdrawn.
  status text not null default 'draft' check (status in
    ('draft', 'released', 'cancelled')),
  released_by uuid references auth.users(id),
  released_at timestamptz,
  release_note text,
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, package_code),
  -- TWO EQUALITIES, NOT A CONJUNCTION (the 6A commitment-line lesson):
  -- `released_at = now(), released_by = null` passes a folded check, and the
  -- actor column is exactly what the §70 wall reads, where a NULL actor is an
  -- early return.
  constraint work_package_release_actor check (
    (released_at is null) = (released_by is null)),
  constraint work_package_release_note check (
    (released_at is null) = (release_note is null)),
  constraint work_package_release_said_something check (
    release_note is null or length(btrim(release_note)) >= 20),
  -- A released package CARRIES its release record. Stated as an implication
  -- rather than an equality on purpose: a package that was released and is
  -- later CANCELLED keeps the record of the release that happened, and an
  -- equality would force that record to be erased.
  constraint work_package_released_status check (
    status <> 'released' or released_at is not null),
  constraint work_package_unreleased_status check (
    status <> 'draft' or released_at is null)
);

create index if not exists idx_work_packages_case
  on work_packages(organization_id, development_case_id, package_type, status);
create index if not exists idx_work_packages_parent
  on work_packages(parent_package_id) where parent_package_id is not null;

alter table public.work_packages enable row level security;
drop policy if exists work_packages_read on public.work_packages;
create policy work_packages_read on public.work_packages
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: packages are recorded and released through the
-- definer RPCs below.

comment on table public.work_packages is
  'D7.17 (spec III.§27) / D7.10 (spec II.4): the typed Advanced Work Packaging container. RULING 19 — `work_orders` remains the work IDENTITY and this is the THIRD grouping CONTEXT beside restoration_event_work and outage_work, in the same shape (a grouping row plus a membership row). It copies no work-order field: `status` here is the package''s RELEASE state and the execution state of the work stays on work_orders. Levels are ordered once by sync_awp_level and the parent chain is enforced by enforce_work_package_chain, not by a CHECK, because the rule reads the parent row.';
comment on column public.work_packages.parent_package_id is
  'D7.10: the package one level up. Enforced to be EXACTLY one level up and of exactly the type sync_awp_parent_type names — a construction package cannot hang from an engineering package (a skipped level) and an installation package cannot hang from a procurement one (a wrong-typed parent). Engineering packages have no parent; every other type must have one.';
comment on column public.work_packages.status is
  'The PACKAGE''s release state, which is not the work''s execution state. get_case_work_packages reports the execution status of the member work orders by reading work_orders — the one place that answer lives.';

-- ---------------------------------------------------------------------------
-- 3. THE MEMBERSHIP — the same shape restoration_event_work and outage_work
--    already use, and for the same reason: the work identity is elsewhere.
-- ---------------------------------------------------------------------------
create table if not exists public.work_package_work (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  work_package_id bigint not null references work_packages(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  assignment_basis text not null check (length(btrim(assignment_basis)) >= 20),
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (work_package_id, work_order_id)
);

create index if not exists idx_work_package_work_package
  on work_package_work(organization_id, work_package_id);
create index if not exists idx_work_package_work_order
  on work_package_work(organization_id, work_order_id);

alter table public.work_package_work enable row level security;
drop policy if exists work_package_work_read on public.work_package_work;
create policy work_package_work_read on public.work_package_work
  for select to authenticated using (organization_id = app_current_org());

comment on table public.work_package_work is
  'D7.17: which work orders this package contains. `unique(work_package_id, work_order_id)` and nothing else — the same membership shape as outage_work(outage_window_id, work_order_id) and restoration_event_work(event_id, work_order_id). A work order may legitimately appear in packages at different LEVELS (the job named in the CWP is the job the IWP installs); that is the AWP thread, not a duplicate.';

-- ---------------------------------------------------------------------------
-- 4. THE PROVENANCE BACKSTOP. Records the service-path writes the walls below
--    ADMIT, so a package released outside the RPCs leaves something to find.
--    Never called on a refusing path.
-- ---------------------------------------------------------------------------
create or replace function public.record_awp_service_write(
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

revoke all on function public.record_awp_service_write(uuid, text, text, text)
  from public, anon, authenticated;

comment on function public.record_awp_service_write(uuid, text, text, text) is
  'D7.17/D7.10/D7.18 provenance backstop: the admitted service path leaves a security_events row. A package released, a work order packaged or a constraint cleared outside the RPCs is findable afterwards.';

-- ---------------------------------------------------------------------------
-- 5. §70 — ONE WALL, bound by TG_ARGV to the actor column, used by every
--    actor column in this slice so no copy can lose its UPDATE branch.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_awp_act_is_human()
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
  -- FAIL LOUD ON A MIS-BINDING: `to_jsonb(new)->>'<missing column>'` is NULL,
  -- not an error, so a typo or a later rename would switch §70 off on this
  -- table while the trigger stayed present and apparently firing.
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
      'The AI-operator identity cannot % (spec §70: no AI or system identity releases a work package, closes a constraint or declares readiness — "equipment safe to start" is reserved for a person). The AI may assemble the package, gather the constraint evidence and say what is still open; a named person releases it.',
      v_act
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_awp_act_is_human()
  from public, anon, authenticated;

comment on function public.enforce_awp_act_is_human() is
  'D7.10/D7.17/D7.18 §70 wall: refuses the AI-operator identity in the actor column named by TG_ARGV[0], for EVERY writer, on INSERT and UPDATE. RAISES when bound to a column the table does not have, and RAISES when the actor has no user_profiles row IN THE ROW''S OWN ORGANIZATION.';

drop trigger if exists trg_work_package_release_human on public.work_packages;
create trigger trg_work_package_release_human
  before insert or update on public.work_packages
  for each row execute function public.enforce_awp_act_is_human(
    'released_by', 'release a work package');

-- ---------------------------------------------------------------------------
-- 6. THE CHAIN (D7.10) AND THE PACKAGE WALL.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_work_package_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.work_package_write', true), '');
  v_level int;
  v_parent_type text;
  v_child_code text;
  v_child_type text;
  p work_packages%rowtype;
  c development_cases%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'work_packages is the record of what work was packaged, what it depends on and who released it. Truncating it detaches every constraint and every membership row from the thing they qualified, in one statement. It is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade, in the two shapes the sibling walls admit: the
    -- organization or the development case is already going.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    if old.released_at is not null then
      raise exception
        'Work package % was released on % by a named person. A released package is not deleted — the release is the record that somebody said this work was safe to start, and the constraints it was released against hang from it. Cancel it instead.',
        old.package_code, old.released_at
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_awp_service_write(old.organization_id,
        format('Work package %s', old.package_code), tg_op,
        'An unreleased work package was deleted outside the definer RPCs.');
    end if;
    return old;
  end if;

  -- Tenant arm: the case must belong to the organization stamped on the row.
  select * into c from development_cases where id = new.development_case_id;
  if not found or c.organization_id <> new.organization_id then
    raise exception
      'this work package is stamped with an organization that does not own its development case'
      using errcode = 'check_violation';
  end if;
  if new.wbs_element_id is not null
     and not exists (select 1 from project_wbs_elements w
                      where w.id = new.wbs_element_id
                        and w.organization_id = new.organization_id
                        and w.development_case_id = new.development_case_id) then
    raise exception
      'the WBS element this package delivers belongs to another organization or another case'
      using errcode = 'check_violation';
  end if;

  -- ── THE TYPED CHAIN. Level and parent type, at the database, for every
  --    writer — not in the RPC, where a second writer would not meet it.
  v_level := sync_awp_level(new.package_type);
  if v_level is null then
    raise exception
      'package type "%" has no place in the AWP ordering. A package whose level is unknown cannot be told from one at the head of the chain.',
      new.package_type
      using errcode = 'check_violation';
  end if;
  v_parent_type := sync_awp_parent_type(new.package_type);

  if v_parent_type is null then
    if new.parent_package_id is not null then
      raise exception
        'An ENGINEERING work package is the head of the AWP chain (spec II.4: EWP → PWP → CWP → IWP) and hangs from nothing. Package % names a parent, which would put the chain''s head inside it.',
        new.package_code
        using errcode = 'check_violation';
    end if;
  else
    if new.parent_package_id is null then
      raise exception
        'A % work package must hang from a % package (spec II.4: EWP → PWP → CWP → IWP → commissioning). Package % names no parent, and a package nobody planned above is not part of a chain.',
        new.package_type, v_parent_type, new.package_code
        using errcode = 'check_violation';
    end if;
    select * into p from work_packages where id = new.parent_package_id;
    if not found then
      raise exception 'the parent work package does not exist'
        using errcode = 'check_violation';
    end if;
    if p.organization_id <> new.organization_id
       or p.development_case_id <> new.development_case_id then
      raise exception
        'Package % names a parent in another organization or another development case. An AWP chain runs inside one case; a cross-case parent makes one project''s release depend on a package its own people cannot see.',
        new.package_code
        using errcode = 'check_violation';
    end if;
    if p.package_type <> v_parent_type then
      raise exception
        'A % work package hangs from a % package, and package % names a % parent (%). This is the SKIPPED-LEVEL / WRONG-PARENT refusal: the chain EWP → PWP → CWP → IWP is typed and ordered, and a package that skips a level is a package whose predecessors were never planned.',
        new.package_type, v_parent_type, new.package_code, p.package_type, p.package_code
        using errcode = 'check_violation';
    end if;
    if sync_awp_level(p.package_type) <> v_level - 1 then
      raise exception
        'the parent of a level-% package must be level %, and % is level %',
        v_level, v_level - 1, p.package_code, sync_awp_level(p.package_type)
        using errcode = 'check_violation';
    end if;
    if new.id = new.parent_package_id then
      raise exception 'a work package cannot be its own parent'
        using errcode = 'check_violation';
    end if;
  end if;

  -- ── THE CHAIN IS VALIDATED IN BOTH DIRECTIONS.
  --
  --    Everything above validates this row against its PARENT. On INSERT that
  --    is the whole rule, because a new row has no children. On UPDATE it is
  --    not: re-typing or re-homing a package that ALREADY HAS CHILDREN leaves
  --    those children holding a parent of the wrong type, at the wrong level,
  --    or in another development case — verbatim the states the arms above
  --    refuse to create, reached in two ordinary steps through
  --    record_work_package's revise branch (build EWP → PWP → CWP, then
  --    re-type the PWP to engineering; the CWP is left hanging from a level-1
  --    package and every read renders it as a well-formed chain).
  --
  --    A per-row check is not a chain check. This arm looks DOWN, so the
  --    refusals above mean what they say for every writer and every operation.
  --    It also stops the wedge that version created: once a child was broken,
  --    every later UPDATE of it re-ran the parent arm and raised, so the
  --    package could no longer be released, cancelled or repaired at all.
  if tg_op = 'UPDATE'
     and (new.package_type is distinct from old.package_type
          or new.development_case_id is distinct from old.development_case_id
          or new.organization_id is distinct from old.organization_id) then
    select ch.package_code, ch.package_type into v_child_code, v_child_type
      from work_packages ch
     where ch.parent_package_id = new.id
       and (sync_awp_parent_type(ch.package_type) is distinct from new.package_type
            or ch.development_case_id is distinct from new.development_case_id
            or ch.organization_id is distinct from new.organization_id)
     order by ch.package_code
     limit 1;
    if v_child_code is not null then
      raise exception
        'Work package % has children and cannot be re-typed to % or moved to another development case while they hang from it: % is a % package, which must hang from a % package in its own case. This is the SKIPPED-LEVEL / WRONG-PARENT / CROSS-CASE state stated from below — a per-row check that only looked UP would have admitted it and left % unreleasable and unrepairable. Re-point or cancel the children first.',
        old.package_code, new.package_type, v_child_code, v_child_type,
        sync_awp_parent_type(v_child_type), v_child_code
        using errcode = 'check_violation';
    end if;
  end if;

  -- THE BACKSTOP IS CONDITIONED ON THE CALLER, NOT ON THE MARKER.
  -- `app.work_package_write` is an ordinary custom GUC and any role that can
  -- reach this table can set it. Writing the security_events row only when
  -- the marker is ABSENT meant a service-path writer could forge the marker
  -- and thereby switch off the only record of itself — one `set_config` away
  -- from unauditable. The marker decides whether a CLIENT is refused; the
  -- provenance record is written for every write that arrives with no
  -- authenticated identity, marker or not. The definer RPCs always carry one
  -- (they refuse when app_current_org() is null), so this never double-logs
  -- the legitimate path.
  if auth.uid() is null then
    perform record_awp_service_write(new.organization_id,
      format('Work package %s', new.package_code), tg_op,
      'A package written outside the RPCs can be born released, which tells a crew to start work with nobody named as having said it was safe to.');
  elsif v_marker <> 'granted' then
    raise exception
      'A work package is recorded through record_work_package and released through release_work_package — the release is a §70 human act that refuses over unresolved hard constraints and over a package nobody assessed. A direct write does it with no role check, no constraint check, no audit row and no §70 wall behind the releaser.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' and new.released_at is not null then
    raise exception
      'A work package is recorded UNRELEASED and released afterwards by a named person, against its constraints. One that arrives already released records a release nobody performed.'
      using errcode = 'check_violation';
  end if;

  -- Frozen once released, for every writer: the scope, the type, the parent
  -- and the case a package was released against are what the release MEANT.
  if tg_op = 'UPDATE' and old.released_at is not null then
    if new.package_type is distinct from old.package_type
       or new.parent_package_id is distinct from old.parent_package_id
       or new.development_case_id is distinct from old.development_case_id
       or new.scope is distinct from old.scope
       or new.released_by is distinct from old.released_by
       or new.released_at is distinct from old.released_at then
      raise exception
        'Work package % was released on %. Its type, parent, case, scope and release record are frozen: a package re-scoped after release leaves the release standing behind different work.',
        old.package_code, old.released_at
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.enforce_work_package_chain()
  from public, anon, authenticated;

drop trigger if exists trg_work_package_chain on public.work_packages;
create trigger trg_work_package_chain
  before insert or update or delete on public.work_packages
  for each row execute function public.enforce_work_package_chain();

drop trigger if exists trg_work_package_no_truncate on public.work_packages;
create trigger trg_work_package_no_truncate
  before truncate on public.work_packages
  for each statement execute function public.enforce_work_package_chain();

revoke truncate on table public.work_packages from anon, authenticated, service_role;

comment on function public.enforce_work_package_chain() is
  'D7.10: the AWP chain at the DATABASE — level and parent TYPE enforced for every writer, on INSERT and UPDATE, plus the tenant arm, the release freeze, the DELETE refusal for a released package and the statement-level TRUNCATE guard. A skipped level and a wrong-typed parent are refused BY NAME.';

-- ---------------------------------------------------------------------------
-- 7. THE MEMBERSHIP WALL.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_work_package_work_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.work_package_write', true), '');
  p work_packages%rowtype;
  old_p work_packages%rowtype;
  v_twin text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'work_package_work is the record of WHICH work a package released. Truncating it empties every released package of its contents while the releases stand. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from work_packages where id = old.work_package_id) then
      return old;
    end if;
    select * into p from work_packages where id = old.work_package_id;
    if p.released_at is not null then
      raise exception
        'Work package % was released on %, and this work order was part of what was released. Removing it now rewrites what the release covered. Cancel the package instead.',
        p.package_code, p.released_at
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_awp_service_write(old.organization_id,
        format('Work package membership on %s', p.package_code), tg_op,
        'A package membership row was deleted outside the definer RPCs.');
    end if;
    return old;
  end if;

  select * into p from work_packages where id = new.work_package_id;
  if not found or p.organization_id <> new.organization_id then
    raise exception
      'this membership row is stamped with an organization that does not own its work package'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from work_orders w
                  where w.id = new.work_order_id
                    and w.organization_id = new.organization_id) then
    raise exception
      'this membership row names a work order from another organization — a package contains this tenant''s own work, or it contains somebody else''s'
      using errcode = 'check_violation';
  end if;
  -- INSERT **AND UPDATE**. An UPDATE performs a removal and an addition in
  -- one statement, so a freeze that only named INSERT admitted exactly what
  -- the DELETE arm above refuses ("Removing it now rewrites what the release
  -- covered"): a released package's membership could be re-pointed at a
  -- different work order, or moved off the released package entirely. Both
  -- OLD's package and NEW's are checked, because either end of that move
  -- rewrites what a release covered.
  if p.released_at is not null and tg_op in ('INSERT', 'UPDATE') then
    raise exception
      'Work package % was released on %. Work added to it after the release was not released with it: the constraint set the release was checked against did not include this work order.',
      p.package_code, p.released_at
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    select * into old_p from work_packages where id = old.work_package_id;
    if found and old_p.released_at is not null then
      raise exception
        'Work package % was released on %, and this work order was part of what was released. Moving or re-pointing the membership row now rewrites what the release covered, which a DELETE of the same row is already refused for. Cancel the package instead.',
        old_p.package_code, old_p.released_at
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ── ONE JOB, ONE PACKAGE PER LEVEL.
  --    The `unique(work_package_id, work_order_id)` constraint above allows a
  --    work order to sit in packages at different LEVELS on purpose — the job
  --    named in the CWP is the job the IWP installs, and that is the AWP
  --    thread. It does NOT license two packages at the SAME level: those are
  --    two independent release decisions over one job, each checked against a
  --    constraint set the other cannot see, and BOTH can be released. Two
  --    supervisors would each be told "READY — a named person said so" for
  --    the same work, against disjoint evidence.
  select p2.package_code into v_twin
    from work_package_work m2
    join work_packages p2 on p2.id = m2.work_package_id
   where m2.work_order_id = new.work_order_id
     and m2.work_package_id <> new.work_package_id
     and p2.organization_id = new.organization_id
     and sync_awp_level(p2.package_type) = sync_awp_level(p.package_type)
   order by p2.package_code
   limit 1;
  if v_twin is not null then
    raise exception
      'This work order is already in work package % , which is at the same AWP level (%) as %. A work order belongs to packages at DIFFERENT levels — the job named in the CWP is the job the IWP installs — but two same-level packages are two release decisions over one job, each blind to the other''s constraints, and both can be released.',
      v_twin, p.package_type, p.package_code
      using errcode = 'check_violation';
  end if;

  -- Caller-conditioned, not marker-conditioned — see enforce_work_package_chain.
  if auth.uid() is null then
    perform record_awp_service_write(new.organization_id,
      format('Work package membership on %s', p.package_code), tg_op,
      'A membership row written outside assign_work_to_package can add work to a released package, with nobody named as having done it.');
  elsif v_marker <> 'granted' then
    raise exception
      'Work is put into a package through assign_work_to_package, which checks the role, refuses a released package and refuses another tenant''s work order. A direct write reaches this table only by bypassing row-level security.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_work_package_work_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_work_package_work_integrity on public.work_package_work;
create trigger trg_work_package_work_integrity
  before insert or update or delete on public.work_package_work
  for each row execute function public.enforce_work_package_work_integrity();

drop trigger if exists trg_work_package_work_no_truncate on public.work_package_work;
create trigger trg_work_package_work_no_truncate
  before truncate on public.work_package_work
  for each statement execute function public.enforce_work_package_work_integrity();

revoke truncate on table public.work_package_work from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. THE DOORS.
-- ---------------------------------------------------------------------------
create or replace function public.record_work_package(
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
  v_code text := nullif(btrim(coalesce(p_package->>'package_code', '')), '');
  v_title text := nullif(btrim(coalesce(p_package->>'title', '')), '');
  v_type text := nullif(btrim(coalesce(p_package->>'package_type', '')), '');
  v_scope text := nullif(btrim(coalesce(p_package->>'scope', '')), '');
  v_area text := nullif(btrim(coalesce(p_package->>'area', '')), '');
  v_parent_code text := nullif(btrim(coalesce(p_package->>'parent_package_code', '')), '');
  v_wbs_code text := nullif(btrim(coalesce(p_package->>'wbs_code', '')), '');
  v_required text := nullif(btrim(coalesce(p_package->>'required_by', '')), '');
  v_required_by date;
  v_parent_id bigint;
  v_wbs_id uuid;
  v_existing work_packages%rowtype;
  -- CAPTURED, NOT RE-READ FROM `FOUND`. `perform set_config(...)` sets FOUND,
  -- so a later `if found` reads the marker call's result rather than the
  -- lookup's: the first draft of this function took the UPDATE branch for a
  -- package that did not exist, updated nothing, and returned a null
  -- work_package_id from `returning id into v_id`. The slice transcript caught
  -- it on its first run.
  v_revising boolean;
  v_prev jsonb;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'recording a work package requires a planning, engineering, supervisory or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_code is null or v_title is null or v_scope is null then
    return jsonb_build_object('error',
      'a package code, a title and a scope statement are required — a package with no scope statement is a label, and a label cannot be released against anything');
  end if;
  if length(v_scope) < 20 then
    return jsonb_build_object('error',
      'the scope statement must say what is in this package (20 characters minimum)');
  end if;
  if sync_awp_level(coalesce(v_type, '')) is null then
    return jsonb_build_object('error',
      'package_type must be one of the five §27 types: engineering, procurement, construction, installation, commissioning');
  end if;
  if v_required is not null then
    begin
      v_required_by := v_required::date;
    exception when others then
      return jsonb_build_object('error', 'required_by is not a date');
    end;
  end if;

  if v_parent_code is not null then
    select id into v_parent_id from work_packages
     where organization_id = v_org and package_code = v_parent_code;
    if v_parent_id is null then
      return jsonb_build_object('error',
        format('no work package with code %s exists in this organization', v_parent_code));
    end if;
  end if;
  if v_wbs_code is not null then
    select id into v_wbs_id from project_wbs_elements
     where organization_id = v_org and development_case_id = c.id and wbs_code = v_wbs_code;
    if v_wbs_id is null then
      return jsonb_build_object('error',
        format('no WBS element %s exists on this case', v_wbs_code));
    end if;
  end if;

  select * into v_existing from work_packages
   where organization_id = v_org and package_code = v_code;
  v_revising := found;
  if v_revising and v_existing.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s and its scope is frozen',
        v_code, v_existing.released_at::date));
  end if;
  -- PACKAGE CODES ARE UNIQUE PER ORGANIZATION, NOT PER CASE. Without this
  -- arm, recording "EWP-01" on case B when case A already has one is not a
  -- refusal and not a new package: it MOVES case A's package — with its
  -- constraints, its memberships and its release state — to case B, and case
  -- A's own read then names a parent its people cannot open. "EWP-01" on two
  -- projects is the default naming, not an exotic input. The lookup above is
  -- deliberately org-wide (that is what the unique index enforces), so the
  -- case mismatch is answered here rather than by a confusing unique-violation.
  if v_revising and v_existing.development_case_id <> c.id then
    return jsonb_build_object('error',
      format('package code %s already belongs to another development case in this organization. Package codes are unique per organization, so recording it here would move that package — with its constraints, its work and its release state — out of the case whose people are working to it. Choose a code that is free, or revise it on its own case.',
        v_code));
  end if;

  perform set_config('app.work_package_write', 'granted', true);
  if v_revising then
    v_prev := jsonb_build_object('title', v_existing.title, 'package_type', v_existing.package_type,
      'scope', v_existing.scope, 'area', v_existing.area, 'required_by', v_existing.required_by,
      'parent_package_id', v_existing.parent_package_id, 'status', v_existing.status);
    -- development_case_id is NOT in this SET list. The arm above has already
    -- established that the existing row is on this case, so writing it would
    -- be a no-op that reads as permission to move a package between cases.
    update work_packages
       set title = v_title, package_type = v_type, scope = v_scope, area = v_area,
           required_by = v_required_by, parent_package_id = v_parent_id,
           wbs_element_id = v_wbs_id
     where id = v_existing.id
    returning id into v_id;
  else
    insert into work_packages (organization_id, development_case_id, parent_package_id,
      package_code, title, package_type, area, wbs_element_id, scope, required_by,
      recorded_by)
    values (v_org, c.id, v_parent_id, v_code, v_title, v_type, v_area, v_wbs_id,
      v_scope, v_required_by, auth.uid())
    returning id into v_id;
  end if;
  perform set_config('app.work_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'work_package_id', v_id, 'package_code', v_code,
      'action', case when v_revising then 'revised' else 'recorded' end),
    v_prev,
    jsonb_build_object('package_code', v_code, 'title', v_title, 'package_type', v_type,
      'level', sync_awp_level(v_type), 'scope', v_scope, 'required_by', v_required_by,
      'parent_package_id', v_parent_id));

  return jsonb_build_object('work_package_id', v_id, 'package_code', v_code,
    'package_type', v_type, 'level', sync_awp_level(v_type),
    'parentType', sync_awp_parent_type(v_type),
    'note', 'The package is recorded UNRELEASED. Releasing it is a §70 human act that refuses while any hard constraint is open — and refuses outright while no constraint has been recorded against it at all.');
end
$$;

revoke all on function public.record_work_package(uuid, jsonb) from public, anon;
grant execute on function public.record_work_package(uuid, jsonb) to authenticated;

comment on function public.record_work_package(uuid, jsonb) is
  'D7.17/D7.10: records or revises a §27 work package on a development case. The typed chain is enforced by the trigger for every writer; this door resolves the parent by CODE and refuses a released package''s re-scope. Revising is in place and does not move recorded_by.';

create or replace function public.assign_work_to_package(
  p_package_id bigint,
  p_work_order_id uuid,
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
  p work_packages%rowtype;
  w work_orders%rowtype;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_twin text;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'packaging work requires a planning, engineering, supervisory or governance role');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work package not found');
  end if;
  select * into w from work_orders where id = p_work_order_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work order not found');
  end if;
  if v_basis is null or length(v_basis) < 20 then
    return jsonb_build_object('error',
      'say why this work belongs in this package (20 characters minimum) — an unexplained membership is what makes a package''s contents unauditable later');
  end if;
  if p.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s; work added afterwards was not released with it',
        p.package_code, p.released_at::date));
  end if;
  if exists (select 1 from work_package_work
              where work_package_id = p.id and work_order_id = w.id) then
    return jsonb_build_object('error',
      format('work order %s is already in package %s',
        coalesce(w.wo_number, w.id::text), p.package_code));
  end if;
  -- The same-level rule, answered at the door as a refusal rather than left
  -- to the trigger's exception. Different levels are the AWP thread; the same
  -- level twice is two release decisions over one job (see the trigger).
  select p2.package_code into v_twin
    from work_package_work m2
    join work_packages p2 on p2.id = m2.work_package_id
   where m2.work_order_id = w.id
     and m2.work_package_id <> p.id
     and p2.organization_id = v_org
     and sync_awp_level(p2.package_type) = sync_awp_level(p.package_type)
   order by p2.package_code
   limit 1;
  if v_twin is not null then
    return jsonb_build_object('error',
      format('work order %s is already in package %s, which is a %s package like %s. A work order belongs to packages at different AWP levels, not to two at the same level: those are two release decisions over one job, each checked against constraints the other cannot see.',
        coalesce(w.wo_number, w.id::text), v_twin, p.package_type, p.package_code));
  end if;

  perform set_config('app.work_package_write', 'granted', true);
  insert into work_package_work (organization_id, work_package_id, work_order_id,
    assignment_basis, assigned_by)
  values (v_org, p.id, w.id, v_basis, auth.uid())
  returning id into v_id;
  perform set_config('app.work_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'action', 'work_assigned'),
    null,
    jsonb_build_object('work_order_id', w.id, 'wo_number', w.wo_number,
      'basis', v_basis));

  return jsonb_build_object('membership_id', v_id, 'package_code', p.package_code,
    'work_order', coalesce(w.wo_number, w.id::text),
    'note', 'The work order is unchanged: this package REFERENCES it. Its execution status stays where it has always lived.');
end
$$;

revoke all on function public.assign_work_to_package(bigint, uuid, text) from public, anon;
grant execute on function public.assign_work_to_package(bigint, uuid, text) to authenticated;

comment on function public.assign_work_to_package(bigint, uuid, text) is
  'D7.17: puts an existing work order into a package. RULING 19 in one function — it writes a membership row and touches no work_orders column, because work_orders is the work identity and this package is a context that references it.';

-- ---------------------------------------------------------------------------
-- 9. THE WITHDRAWAL.
--
--    THREE refusals in this slice tell the reader to "Cancel it instead" —
--    the DELETE arm on work_packages, the DELETE arm on work_package_work and
--    the DELETE arm on a released package's constraints. A remedy a product
--    names and does not offer is not a remedy: without this door the only way
--    to reach `cancelled` was a superuser UPDATE, and a released package that
--    should not proceed had no exit at all.
--
--    Cancelling is NOT the inverse of releasing. The release record stays
--    exactly as it was written (`work_package_released_status` is stated as an
--    implication for this reason) — somebody DID say this work was safe to
--    start on that date, and erasing that would be rewriting history to make
--    the present tidy. Cancelling records that the package is withdrawn.
--
--    §70: cancelling is not "declaring readiness", so no §70 wall fires on
--    it — but it withdraws an act §70 reserved for a person, so the role gate
--    is the RELEASE list (ai_admin absent from it), not the wider recording
--    list. An AI may not undo a person's release any more than it may make one.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_work_package(
  p_package_id bigint,
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
  p work_packages%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_child text;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'supervisor') then
    return jsonb_build_object('error',
      'cancelling a work package requires a supervisory, management or governance role — it withdraws work a person released, and spec §70 reserves both ends of that decision for people');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work package not found');
  end if;
  if p.status = 'cancelled' then
    return jsonb_build_object('error',
      format('work package %s is already cancelled', p.package_code));
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'say why this package is being withdrawn (20 characters minimum) — a cancellation with no stated reason is indistinguishable from a mistake');
  end if;
  -- A cancelled parent with live children is the chain broken from above: the
  -- children would still name a parent, and that parent would be withdrawn.
  select ch.package_code into v_child
    from work_packages ch
   where ch.parent_package_id = p.id and ch.status <> 'cancelled'
   order by ch.package_code
   limit 1;
  if v_child is not null then
    return jsonb_build_object('error',
      format('work package %s cannot be cancelled while %s still hangs from it. Cancelling a parent under live children leaves work whose predecessor was withdrawn — cancel or re-point the children first.',
        p.package_code, v_child));
  end if;

  v_prev := jsonb_build_object('status', p.status, 'released_at', p.released_at,
    'released_by', p.released_by);

  perform set_config('app.work_package_write', 'granted', true);
  update work_packages set status = 'cancelled' where id = p.id;
  perform set_config('app.work_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'action', 'cancelled'),
    v_prev,
    jsonb_build_object('status', 'cancelled', 'reason', v_reason,
      'released_at', p.released_at, 'released_by', p.released_by));

  return jsonb_build_object('work_package_id', p.id, 'package_code', p.package_code,
    'status', 'cancelled', 'wasReleased', p.released_at is not null,
    'note', case when p.released_at is not null
      then 'Withdrawn. The release record is UNCHANGED: a person did say this work was safe to start on that date, and cancelling does not unsay it.'
      else 'Withdrawn before release. Nothing was ever declared safe to start.' end);
end
$$;

revoke all on function public.cancel_work_package(bigint, text) from public, anon;
grant execute on function public.cancel_work_package(bigint, text) to authenticated;

comment on function public.cancel_work_package(bigint, text) is
  'D7.17: withdraws a work package — the remedy the DELETE refusals on work_packages, work_package_work and restoration_constraints all name. Requires the RELEASE role list (ai_admin absent), a stated reason, and no live children. The release record is preserved, not erased: cancelling records that the package is withdrawn, it does not unsay that a person released it.';
