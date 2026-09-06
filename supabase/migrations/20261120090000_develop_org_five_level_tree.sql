-- ============================================================================
-- Sync Develop Slice 3 — Organization five-level tree + governance profile
-- carrier (D11.14, spec III.§2).
--
-- The spec's Organization object — id, name, type, jurisdiction, parent_id,
-- governance_profile_id; Enterprise → BU → Site → Area → System — lands as
-- an EXTENSION of the one `organizations` table (register row D11.14:
-- "EXTEND organizations"). No parallel org-node table exists or may be
-- created: the tenant boundary (app_current_org(), org-scoped RLS
-- everywhere) and the governance tree are the SAME rows, so a case's
-- organization_id is simultaneously its tenant stamp and its position in
-- the tree the governance profile inherits down.
--
-- RULINGS TAKEN HERE (documented because the spec does not decide them):
--
--   * Levels are the spec §2 five, typed and ranked: enterprise(1) →
--     business_unit(2) → site(3) → area(4) → system(5). A parent must sit
--     STRICTLY ABOVE its child in rank — but not necessarily adjacent,
--     because real tenants skip layers (a site directly under an
--     enterprise). Any level may be a root: a tenant that models only a
--     site is a site-rooted tree, not an error.
--   * TREE INTEGRITY IS A DATA-INTEGRITY INVARIANT, NOT A PROVENANCE
--     QUESTION. The cycle/rank trigger refuses EVERY writer — service roles
--     included — following enforce_objective_nesting_integrity
--     (20261115090000): a cyclic or inverted hierarchy is corrupt data no
--     audited service path can make honest.
--   * governance_profile_id references project_frameworks — the ONE
--     framework family (overlap-map: no parallel profile object). It may
--     be attached only pointing at an ADOPTED framework owned by the node
--     itself or an ancestor node: governance flows DOWN a tree, so a node
--     cannot be governed by a sibling's or descendant's framework.
--   * INHERITANCE RESOLUTION follows supersession: the attached row pins a
--     framework identity; resolve_org_governance_profile returns the
--     CURRENTLY ADOPTED version of that framework name in its owning org,
--     so inheritance never governs a new case by a retired version. A
--     pointed-at framework whose name currently has NO adopted version is
--     skipped and the walk continues upward — an unresolvable pointer is
--     an absence, never a silent fallback.
--   * CHILD-CASE INHERITANCE lands in create_development_case (re-created
--     below from its 20261101090200 definition): a case created WITHOUT an
--     explicit framework resolves one by walking up the org tree from its
--     organization, and the audit row names the node it inherited from. A
--     case that resolves nothing stays ungoverned exactly as before — the
--     walk adds governance, it never invents it.
--
-- Tree authoring is definer-RPC-first this slice (create_sub_organization /
-- set_organization_node / set_org_governance_profile) — the same
-- authoring-surface caveat the register carries for D3.01 framework
-- authoring. The tree and the resolution are customer-VISIBLE through
-- get_case_governance (20261120090200) on the Case Workspace governance
-- panel.
-- ============================================================================

alter table public.organizations
  add column if not exists org_level text not null default 'enterprise'
    check (org_level in ('enterprise','business_unit','site','area','system')),
  add column if not exists parent_id uuid references organizations(id) on delete set null,
  add column if not exists jurisdiction text,
  add column if not exists governance_profile_id uuid references project_frameworks(id) on delete set null;

create index if not exists idx_organizations_parent
  on organizations(parent_id) where parent_id is not null;

-- ---------------------------------------------------------------------------
-- The rank ladder. One function, consulted by trigger, RPCs and resolver —
-- never restated as inline CASE arms that could drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.org_level_rank(p_level text)
returns int
language sql
immutable
as $$
  select case p_level
    when 'enterprise' then 1
    when 'business_unit' then 2
    when 'site' then 3
    when 'area' then 4
    when 'system' then 5
    else 0
  end
$$;

revoke all on function public.org_level_rank(text) from public, anon;
grant execute on function public.org_level_rank(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ancestry walk, cycle-guarded and depth-capped. Returns the chain FROM the
-- node upward (depth 0 = the node itself). SECURITY DEFINER because the
-- organizations read policy is deliberately self-row-only — walking one's
-- ancestors is exactly the inheritance feature, and callers receive ids
-- only; what is exposed of an ancestor is decided by the RPCs that use this.
-- ---------------------------------------------------------------------------
create or replace function public.org_ancestry(p_start uuid)
returns table(node_id uuid, depth int)
language sql
stable
security definer
set search_path = public
as $$
  with recursive walk(node_id, depth, seen) as (
    select o.id, 0, array[o.id]
    from organizations o where o.id = p_start
    union all
    select p.id, w.depth + 1, w.seen || p.id
    from walk w
    join organizations c on c.id = w.node_id
    join organizations p on p.id = c.parent_id
    where not p.id = any(w.seen) and w.depth < 64
  )
  select node_id, depth from walk
$$;

revoke all on function public.org_ancestry(uuid) from public, anon;
grant execute on function public.org_ancestry(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Tree integrity at the persistence boundary. Refuses EVERY writer (the
-- objective-nesting posture): a cycle, a self-parent, an inverted rank or a
-- governance profile a node has no right to is corrupt data whoever writes
-- it. check_violation so callers can tell integrity from permission.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_organization_tree_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent organizations%rowtype;
  v_child record;
  v_cycle boolean;
  f project_frameworks%rowtype;
begin
  if org_level_rank(new.org_level) = 0 then
    raise exception
      'organization level "%" is not one of the spec §2 five: enterprise, business_unit, site, area, system',
      coalesce(new.org_level, 'null')
      using errcode = 'check_violation';
  end if;

  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'an organization cannot be its own parent'
        using errcode = 'check_violation';
    end if;
    select * into v_parent from organizations where id = new.parent_id;
    if not found then
      raise exception 'parent organization % does not exist', new.parent_id
        using errcode = 'check_violation';
    end if;
    if org_level_rank(v_parent.org_level) >= org_level_rank(new.org_level) then
      raise exception
        'a % cannot sit under a % — the five-level tree descends enterprise → business_unit → site → area → system, and a parent sits strictly above its child',
        new.org_level, v_parent.org_level
        using errcode = 'check_violation';
    end if;
    -- A cycle can only form on UPDATE (an INSERT's fresh id is nobody's
    -- ancestor) — and because ranks strictly decrease up every edge, a
    -- rank-legal cycle is structurally impossible while the rule above
    -- holds. The walk stays as defense-in-depth: if the level set is ever
    -- widened or the rank rule relaxed, the cycle refusal is already
    -- standing rather than remembered.
    if tg_op = 'UPDATE' then
      select exists (
        select 1 from org_ancestry(new.parent_id) a where a.node_id = new.id
      ) into v_cycle;
      if v_cycle then
        raise exception
          'that parent assignment would close a cycle — % is a descendant of this organization',
          new.parent_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- A level change must leave every existing child still strictly below.
  if tg_op = 'UPDATE' and new.org_level is distinct from old.org_level then
    select id, name, org_level into v_child
    from organizations
    where parent_id = new.id
      and org_level_rank(org_level) <= org_level_rank(new.org_level)
    limit 1;
    if found then
      raise exception
        'cannot re-level this organization to %: child "%" is a %, which would no longer sit strictly below it',
        new.org_level, v_child.name, v_child.org_level
        using errcode = 'check_violation';
    end if;
  end if;

  -- Governance profile: validated when it CHANGES (an unrelated edit must
  -- not re-litigate a pointer whose framework was later superseded — the
  -- resolver follows supersession by name, see the header ruling).
  if new.governance_profile_id is not null
     and (tg_op = 'INSERT' or new.governance_profile_id is distinct from old.governance_profile_id) then
    select * into f from project_frameworks where id = new.governance_profile_id;
    if not found then
      raise exception 'governance profile % does not exist', new.governance_profile_id
        using errcode = 'check_violation';
    end if;
    if f.status <> 'adopted' then
      raise exception
        'a % framework cannot govern an organization — adopt it first (adopt_project_framework); attaching a draft would let unadopted governance flow to every descendant case',
        f.status
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from org_ancestry(new.id) a where a.node_id = f.organization_id
    ) then
      raise exception
        'framework "%" belongs to an organization outside this node''s ancestry — governance flows DOWN the tree, so a node carries only its own or an ancestor''s framework',
        f.name
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_organization_tree_integrity() from public, anon, authenticated;

drop trigger if exists trg_organization_tree_integrity on public.organizations;
create trigger trg_organization_tree_integrity
  before insert or update of org_level, parent_id, governance_profile_id on public.organizations
  for each row execute function public.enforce_organization_tree_integrity();

-- ---------------------------------------------------------------------------
-- Scope helper for the authoring RPCs: TRUE when p_node is the caller's org
-- or one of its descendants — the only rows a tenant administrator may
-- shape. Walks upward from the candidate; cheaper than materializing the
-- subtree, and the same cycle guard applies.
-- ---------------------------------------------------------------------------
create or replace function public.org_node_in_scope(p_node uuid, p_root uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from org_ancestry(p_node) a where a.node_id = p_root)
$$;

revoke all on function public.org_node_in_scope(uuid, uuid) from public, anon;
grant execute on function public.org_node_in_scope(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Inheritance resolution: walk up from a node (inclusive) and return the
-- first governance profile that resolves to a CURRENTLY ADOPTED framework —
-- the attached row names the framework; supersession redirects to the
-- adopted version of the same name in the owning org so inheritance never
-- selects a retired version. Nothing resolving is an ABSENCE the callers
-- render as one.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_org_governance_profile(p_node uuid)
returns table(framework_id uuid, source_node_id uuid, source_depth int)
language sql
stable
security definer
set search_path = public
as $$
  select fw.id, a.node_id, a.depth
  from org_ancestry(p_node) a
  join organizations o on o.id = a.node_id
  join project_frameworks pinned on pinned.id = o.governance_profile_id
  join project_frameworks fw
    on fw.organization_id = pinned.organization_id
   and fw.name = pinned.name
   and fw.status = 'adopted'
  order by a.depth asc, fw.version desc
  limit 1
$$;

revoke all on function public.resolve_org_governance_profile(uuid) from public, anon;
grant execute on function public.resolve_org_governance_profile(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Authoring RPCs. Admin/executive only — shaping the governance tree is an
-- act of organizational design, not planning. Every write audited.
-- ---------------------------------------------------------------------------
create or replace function public.create_sub_organization(
  p_name text,
  p_node_level text,
  p_parent_node_id uuid,
  p_jurisdiction text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_parent organizations%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'shaping the organization tree requires an executive or administrator');
  end if;
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'an organization node needs a name (3 characters minimum)');
  end if;
  if org_level_rank(p_node_level) = 0 then
    return jsonb_build_object('error', 'level must be one of enterprise, business_unit, site, area, system (spec §2)');
  end if;
  if p_parent_node_id is null then
    return jsonb_build_object('error', 'a sub-organization names its parent node — roots are provisioned, not authored here');
  end if;
  if not org_node_in_scope(p_parent_node_id, v_org) then
    return jsonb_build_object('error', 'that parent node is not this organization or one of its descendants');
  end if;
  select * into v_parent from organizations where id = p_parent_node_id;
  if org_level_rank(v_parent.org_level) >= org_level_rank(p_node_level) then
    return jsonb_build_object('error',
      format('a %s cannot sit under a %s — a parent sits strictly above its child in the five-level tree', p_node_level, v_parent.org_level));
  end if;
  -- Name uniqueness is scoped to the caller's own subtree: probing another
  -- tenant's names must neither refuse (existence oracle) nor deny this
  -- tenant a name an unrelated tenant happens to hold. Tenant ROOTS stay
  -- globally unique via provision_organization (service-only). The advisory
  -- lock closes the check-then-insert race — organizations.name carries no
  -- unique constraint to catch it.
  perform pg_advisory_xact_lock(hashtextextended('organizations.name:' || lower(trim(p_name)), 0));
  if exists (
    select 1 from organizations o
    where o.name = trim(p_name) and org_node_in_scope(o.id, v_org)
  ) then
    return jsonb_build_object('error', 'an organization with that name already exists');
  end if;

  insert into organizations (name, industry, org_level, parent_id, jurisdiction)
  values (trim(p_name), v_parent.industry, p_node_level, v_parent.id,
          nullif(trim(coalesce(p_jurisdiction, '')), ''))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'organization_tree', coalesce(v_role, 'unknown'),
    jsonb_build_object('action', 'node_created', 'node_id', v_id,
      'name', trim(p_name), 'org_level', p_node_level, 'parent_id', v_parent.id));

  return jsonb_build_object('node_id', v_id, 'org_level', p_node_level, 'parent_id', v_parent.id);
end
$$;

revoke all on function public.create_sub_organization(text, text, uuid, text) from public, anon;
grant execute on function public.create_sub_organization(text, text, uuid, text) to authenticated;

create or replace function public.set_organization_node(
  p_node_id uuid,
  p_node_level text default null,
  p_jurisdiction text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  o organizations%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'shaping the organization tree requires an executive or administrator');
  end if;
  if not org_node_in_scope(p_node_id, v_org) then
    return jsonb_build_object('error', 'that node is not this organization or one of its descendants');
  end if;
  select * into o from organizations where id = p_node_id;
  if p_node_level is not null and org_level_rank(p_node_level) = 0 then
    return jsonb_build_object('error', 'level must be one of enterprise, business_unit, site, area, system (spec §2)');
  end if;

  -- The integrity trigger holds rank and child coherence; refusals surface
  -- verbatim to the caller as check_violation messages.
  update organizations
  set org_level = coalesce(p_node_level, org_level),
      jurisdiction = coalesce(nullif(trim(coalesce(p_jurisdiction, '')), ''), jurisdiction)
  where id = o.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'organization_tree', coalesce(v_role, 'unknown'),
    jsonb_build_object('action', 'node_updated', 'node_id', o.id,
      'org_level', coalesce(p_node_level, o.org_level),
      'jurisdiction', coalesce(nullif(trim(coalesce(p_jurisdiction, '')), ''), o.jurisdiction)));

  return jsonb_build_object('node_id', o.id,
    'org_level', coalesce(p_node_level, o.org_level));
end
$$;

revoke all on function public.set_organization_node(uuid, text, text) from public, anon;
grant execute on function public.set_organization_node(uuid, text, text) to authenticated;

create or replace function public.set_org_governance_profile(
  p_node_id uuid,
  p_framework_id uuid,
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
  o organizations%rowtype;
  f project_frameworks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'attaching a governance profile requires an executive or administrator — it decides what governs every descendant case');
  end if;
  if not org_node_in_scope(p_node_id, v_org) then
    return jsonb_build_object('error', 'that node is not this organization or one of its descendants');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error', 'record the basis for changing what governs this node (10 characters minimum)');
  end if;
  select * into o from organizations where id = p_node_id;

  if p_framework_id is not null then
    select * into f from project_frameworks where id = p_framework_id;
    if not found then
      return jsonb_build_object('error', 'framework not found');
    end if;
    if f.status <> 'adopted' then
      return jsonb_build_object('error',
        'a ' || f.status || ' framework cannot govern an organization — adopt it first (adopt_project_framework)');
    end if;
    if not exists (select 1 from org_ancestry(o.id) a where a.node_id = f.organization_id) then
      return jsonb_build_object('error',
        format('framework "%s" belongs to an organization outside this node''s ancestry — governance flows down the tree', f.name));
    end if;
  end if;

  update organizations set governance_profile_id = p_framework_id where id = o.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'organization_tree', coalesce(v_role, 'unknown'),
    jsonb_build_object('action',
      case when p_framework_id is null then 'governance_profile_cleared' else 'governance_profile_attached' end,
      'node_id', o.id, 'framework_id', p_framework_id,
      'framework', case when p_framework_id is null then null else f.name end,
      'note', btrim(p_note)));

  return jsonb_build_object('node_id', o.id, 'governance_profile_id', p_framework_id);
end
$$;

revoke all on function public.set_org_governance_profile(uuid, uuid, text) from public, anon;
grant execute on function public.set_org_governance_profile(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_development_case, re-created from its 20261101090200 definition
-- with EXACTLY ONE addition (D11.14 child-case inheritance): when no
-- framework is passed, the org tree is walked for a governance profile and
-- the resolved ADOPTED framework governs the case from birth, with the
-- source node named in the audit trail and the return. Everything else is
-- byte-identical — assembled from the prior definition at authoring time.
-- ---------------------------------------------------------------------------
create or replace function public.create_development_case(
  p_title text,
  p_problem_statement text,
  p_lifecycle_type text,
  p_opportunity_statement text default null,
  p_framework_id uuid default null,
  p_site_id uuid default null,
  p_business_unit text default null,
  p_estimated_capex numeric default null,
  p_expected_value numeric default null,
  p_objective_id uuid default null,
  p_sponsor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
  v_stage text;
  f project_frameworks%rowtype;
  v_resolved record;
  v_inherited_from uuid;
  v_framework_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'creating a development case requires a planning, engineering or governance role');
  end if;
  -- PROBLEM-FIRST. This is the rule that makes intake an act of framing
  -- rather than a cold "Create Project".
  if coalesce(length(trim(p_problem_statement)), 0) < 20 then
    return jsonb_build_object('error',
      'a development case begins with the problem, not the project: state the problem or opportunity being addressed (20 characters minimum)');
  end if;
  if coalesce(length(trim(p_title)), 0) < 3 then
    return jsonb_build_object('error', 'a case needs a title (3 characters minimum)');
  end if;
  if p_lifecycle_type not in
     ('greenfield','brownfield','sustaining_capital','replacement',
      'reliability_improvement','regulatory','capacity','life_extension','decommissioning') then
    return jsonb_build_object('error', 'lifecycle_type must be one of the nine spec §3 values');
  end if;
  if p_estimated_capex is not null and p_estimated_capex < 0 then
    return jsonb_build_object('error', 'estimated_capex cannot be negative');
  end if;
  -- D3.04 (marked insertion): numeric NaN/Infinity satisfy the >= 0 column
  -- check and band ABOVE every governance threshold — a non-finite stated
  -- number is refused at the door, never banded.
  if p_estimated_capex is not null
     and (p_estimated_capex = 'NaN'::numeric
          or p_estimated_capex = 'Infinity'::numeric
          or p_estimated_capex = '-Infinity'::numeric) then
    return jsonb_build_object('error', 'estimated_capex must be a finite amount');
  end if;

  v_framework_id := p_framework_id;

  -- D11.14: a case created without an explicit framework resolves one by
  -- walking up the organization tree. Resolution is the ADOPTED version of
  -- the attached profile's framework name (see this file's header); a tree
  -- that resolves nothing leaves the case ungoverned exactly as before —
  -- inheritance adds governance, it never invents it. A resolution whose
  -- framework is OWNED by an ancestor node is reported, not silently used:
  -- the gate machinery and the framework read surface are org-scoped to the
  -- case's own node, so an ancestor-owned framework is not yet operable
  -- here — get_case_governance renders the same resolution with the same
  -- note, and cross-node framework operation is named future work
  -- (register D11.14), never a silent half-governed case.
  if v_framework_id is null then
    select * into v_resolved from resolve_org_governance_profile(v_org);
    if found then
      if exists (select 1 from project_frameworks pf
                 where pf.id = v_resolved.framework_id and pf.organization_id = v_org) then
        v_framework_id := v_resolved.framework_id;
        v_inherited_from := v_resolved.source_node_id;
      else
        insert into audit_events (organization_id, entity_type, actor, event_data)
        values (v_org, 'development_case', coalesce(v_role, 'unknown'),
          jsonb_build_object('action', 'framework_inheritance_not_operable',
            'resolved_framework_id', v_resolved.framework_id,
            'source_node_id', v_resolved.source_node_id));
      end if;
    end if;
  end if;

  v_stage := 'need_identification';
  if v_framework_id is not null then
    select * into f from project_frameworks
    where id = v_framework_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'framework not found in this organization');
    end if;
    if f.status <> 'adopted' then
      return jsonb_build_object('error',
        'a draft framework cannot govern a case — adopt it first (adopt_project_framework)');
    end if;
    select stage_key into v_stage from project_framework_stages
    where framework_id = f.id order by sequence asc limit 1;
    if v_stage is null then
      return jsonb_build_object('error', 'the selected framework has no stages');
    end if;
  end if;

  if p_site_id is not null and not exists
     (select 1 from sites where id = p_site_id and organization_id = v_org) then
    return jsonb_build_object('error', 'site not found in this organization');
  end if;
  if p_objective_id is not null and not exists
     (select 1 from risk_objectives where id = p_objective_id and organization_id = v_org) then
    return jsonb_build_object('error', 'objective not found in this organization');
  end if;
  -- The sponsor is accountable inside THIS organization — same org check as
  -- site and objective, so no case ever carries a dangling or foreign-org
  -- sponsor reference.
  if p_sponsor_id is not null and not exists
     (select 1 from user_profiles where id = p_sponsor_id and organization_id = v_org) then
    return jsonb_build_object('error', 'the sponsor must be a member of this organization');
  end if;

  insert into development_cases
    (organization_id, title, sponsor_id, business_unit, site_id,
     current_stage_key, framework_id, lifecycle_type, problem_statement,
     opportunity_statement, objective_id, estimated_capex, expected_value,
     status, created_by)
  values
    (v_org, trim(p_title), coalesce(p_sponsor_id, auth.uid()),
     nullif(trim(coalesce(p_business_unit, '')), ''), p_site_id,
     v_stage, v_framework_id, p_lifecycle_type, trim(p_problem_statement),
     nullif(trim(coalesce(p_opportunity_statement, '')), ''), p_objective_id,
     p_estimated_capex, p_expected_value, 'active', auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', v_id, 'action', 'created',
      'lifecycle_type', p_lifecycle_type, 'stage', v_stage,
      'framework_id', v_framework_id,
      'framework_inherited_from', v_inherited_from));

  return jsonb_build_object('case_id', v_id, 'current_stage_key', v_stage, 'status', 'active',
    'framework_id', v_framework_id,
    'framework_inherited_from', v_inherited_from);
end
$$;

revoke all on function public.create_development_case(text, text, text, text, uuid, uuid, text, numeric, numeric, uuid, uuid) from public, anon;
grant execute on function public.create_development_case(text, text, text, text, uuid, uuid, text, numeric, numeric, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
