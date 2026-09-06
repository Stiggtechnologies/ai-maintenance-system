-- ============================================================================
-- Sync Develop Slice 4A — the scope architecture chain (D5.01, spec I.6).
--
-- THE SPEC'S CHAIN, VERBATIM (I.6): "Business need → Requirement → System →
-- WBS → Work package → Contract → Schedule activity → Cost."
--
-- RULING 1 — WHERE THE CHAIN ORDER COMES FROM. The build plan's Slice 4 row
-- reads "Scope chain (WBS at last)". That phrase is the SEQUENCE OF WORK
-- ("at last, the WBS exists" — register row D5.04 records `wbs` grepping to
-- zero files across src+supabase), not a re-ordering of the spec's chain. A
-- WBS that sat AFTER schedule activity and cost would make every activity
-- and every cost line un-codable at the moment it is created, which is the
-- opposite of what D5.02 exists to detect. The chain is therefore built in
-- the spec's own order, and this comment is the ruling so a later reader
-- does not have to re-derive it from a four-word plan cell.
--
-- RULING 2 — WHICH LINKS GET A NEW TABLE, AND WHICH DO NOT. Overlap-map law
-- is that a canonical home is never forked. Applied link by link:
--
--   Business need    NEW  project_scope_needs. Nothing in the repository
--                         records "the need this project exists to serve"
--                         as a first-class row: problem_statement is prose
--                         on the case, and one case legitimately serves
--                         several needs.
--   Requirement      REUSE design_requirements — the ONE project
--                         requirement table (overlap map §13; generalized
--                         to case scope by 20261122090000). It gains a
--                         scope_need_id column, not a sibling table.
--   System           REUSE organizations at org_level='system' — the ONE
--                         five-level tree (D11.14, 20261120090000). The
--                         spec's "System" in this chain is the physical /
--                         functional system the scope serves, which is
--                         exactly what level 5 of that tree is. A second
--                         system hierarchy is forbidden (AGENTS inv. 1).
--   WBS              NEW  project_wbs_elements. The deliverable-oriented
--                         decomposition. No candidate exists to extend.
--   Work package     DEFERRED, NAMED. Overlap-map ruling 8 puts the work
--                         identity on work_orders with the AWP package
--                         wrapping it in Slice 7 (D7.17). Building a
--                         work-package row here would be the fourth
--                         work-grouping model. The chain therefore carries
--                         a NAMED HOLE between WBS and contract, and
--                         get_case_scope_traceability reports it as a hole
--                         rather than silently closing the gap.
--   Contract         DEFERRED, NAMED. contract_packages grows its award
--                         side in Slice 6 (D6.05/D6.08).
--   Schedule activity REUSE shutdown_tasks through the governed P6 door
--                         (20261112090000). D5.28 completes there.
--   Cost             NEW  project_cost_items (D5.29, 20261130090200).
--
--   The chain's TERMINUS in this slice is the CONTROL ACCOUNT — the
--   WBS × OBS intersection cost collects under. That is where the register
--   row's "…→ control account" lands, and it is the last link that can be
--   built without the two deferred ones.
--
-- RULING 3 — OBS IS NOT A NEW TABLE. The eleven controls structures (I.8,
-- D5.04) name an OBS. An organizational breakdown structure is an
-- ORGANIZATION hierarchy, and this repository has exactly one
-- (organizations, five-level, 20261120090000). The OBS leg is therefore
-- (a) the org node the scope belongs to and (b) the ACCOUNTABLE PERSON on
-- the control account — both columns on project_control_accounts, no second
-- org tree. Accountability with no name on it is what a control account
-- exists to prevent, so accountable_owner_id is NOT NULL.
--
-- REFUSAL-FIRST (the heart of this slice). Nothing here defaults:
--   * a WBS element whose parent does not resolve is refused BY NAME;
--   * a control account may not nest inside another control account (PMBOK:
--     cost collects at exactly one point on a branch) — refused with the
--     conflicting account named;
--   * a scope need with no statement, a WBS element with no scope
--     description, a control account with no accountable person: refused,
--     never defaulted to the caller;
--   * tree integrity (cycles, cross-case parents) is a DATA-INTEGRITY
--     invariant refused for EVERY writer including service, following
--     enforce_org_tree_integrity (20261120090000) and
--     enforce_objective_nesting_integrity (20261115090000). A cyclic WBS is
--     corrupt data no audited service path can make honest.
--
-- §70. Recording scope structure is PREPARATION, not determination — the
-- planning role set may author it. What §70 reserves is BASELINING it
-- (20261130090500) and approving a change against it; neither act lives in
-- this file. ai_admin may therefore author here and is refused there, which
-- is the same split create_case_deliverable/approve_case_baseline already
-- draws.
--
-- Canonical reuse: development_cases, design_requirements, organizations,
-- user_profiles, audit_events (prev/new snapshots), app_current_org().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Business need — the head of the chain.
-- ---------------------------------------------------------------------------
create table if not exists public.project_scope_needs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  need_ref text not null,
  -- What the business needs — the sentence a requirement must trace to.
  statement text not null check (length(btrim(statement)) >= 10),
  -- Where the need came from, so an invented need is distinguishable from a
  -- sanctioned one. Same eight-tier vocabulary GateRequirement uses.
  source_authority text not null default 'PROJECT_FRAMEWORK' check (source_authority in
    ('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT',
     'INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION')),
  -- A need nobody owns is a wish.
  owner_id uuid not null references auth.users(id),
  status text not null default 'open' check (status in ('open','met','withdrawn')),
  withdrawn_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, need_ref),
  check (status <> 'withdrawn' or coalesce(length(btrim(withdrawn_reason)), 0) >= 10)
);

create index if not exists idx_scope_need_case
  on project_scope_needs(organization_id, development_case_id, status);

alter table public.project_scope_needs enable row level security;
drop policy if exists project_scope_needs_read on public.project_scope_needs;
create policy project_scope_needs_read on public.project_scope_needs
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC.

-- ---------------------------------------------------------------------------
-- 2. The requirement leg — a COLUMN on the one requirement table.
-- ---------------------------------------------------------------------------
alter table public.design_requirements
  add column if not exists scope_need_id uuid
    references project_scope_needs(id) on delete set null;

create index if not exists idx_dreq_scope_need
  on design_requirements(scope_need_id) where scope_need_id is not null;

comment on column public.design_requirements.scope_need_id is
  'D5.01 (spec I.6): the business need this requirement traces to. Null means the requirement has no need behind it — which is a traceability GAP get_case_scope_traceability reports, not a defect of the column.';

-- ---------------------------------------------------------------------------
-- 3. CBS — the cost breakdown structure codes a cost line is coded against.
--    Case-scoped (a CBS belongs to a project's cost plan) with an org-wide
--    uniqueness inside the case, so two lines carrying "C-2100" mean one
--    thing.
-- ---------------------------------------------------------------------------
create table if not exists public.project_cbs_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  cbs_code text not null check (btrim(cbs_code) <> ''),
  title text not null check (length(btrim(title)) >= 3),
  -- The spec's own §23 cost vocabulary, kept small and typed.
  cost_type text not null check (cost_type in
    ('labour','material','equipment','subcontract','indirect','owner_cost','contingency','escalation')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, cbs_code)
);

create index if not exists idx_cbs_case
  on project_cbs_codes(organization_id, development_case_id, cbs_code);

alter table public.project_cbs_codes enable row level security;
drop policy if exists project_cbs_codes_read on public.project_cbs_codes;
create policy project_cbs_codes_read on public.project_cbs_codes
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 4. WBS — the decomposition itself.
-- ---------------------------------------------------------------------------
create table if not exists public.project_wbs_elements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  wbs_code text not null check (btrim(wbs_code) <> ''),
  parent_id uuid references project_wbs_elements(id) on delete restrict,
  title text not null check (length(btrim(title)) >= 3),
  -- What is IN this element. A WBS element with no scope statement is a
  -- label, and a label cannot be traced to or from.
  scope_description text not null check (length(btrim(scope_description)) >= 10),
  -- The chain's "System" link — organizations at org_level='system'
  -- (ruling 2). Nullable: not every element serves a single system.
  system_node_id uuid references organizations(id) on delete set null,
  -- Maintained by the tree trigger, never by a caller: depth is derived.
  depth int not null default 1 check (depth between 1 and 12),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, wbs_code)
);

create index if not exists idx_wbs_case
  on project_wbs_elements(organization_id, development_case_id, wbs_code);
create index if not exists idx_wbs_parent
  on project_wbs_elements(parent_id) where parent_id is not null;

alter table public.project_wbs_elements enable row level security;
drop policy if exists project_wbs_elements_read on public.project_wbs_elements;
create policy project_wbs_elements_read on public.project_wbs_elements
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 5. Requirement → WBS. Many-to-many: one requirement can be delivered by
--    several elements, one element can serve several requirements. A join
--    table, not a column, because either direction collapsing to one would
--    make the D5.02 gap report lie in the direction it collapsed.
-- ---------------------------------------------------------------------------
create table if not exists public.project_requirement_wbs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  requirement_id bigint not null references design_requirements(id) on delete cascade,
  wbs_element_id uuid not null references project_wbs_elements(id) on delete cascade,
  linked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (requirement_id, wbs_element_id)
);

create index if not exists idx_req_wbs_case
  on project_requirement_wbs(organization_id, development_case_id);
create index if not exists idx_req_wbs_element
  on project_requirement_wbs(wbs_element_id);

alter table public.project_requirement_wbs enable row level security;
drop policy if exists project_requirement_wbs_read on public.project_requirement_wbs;
create policy project_requirement_wbs_read on public.project_requirement_wbs
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 6. Control account — the WBS × OBS intersection, and this slice's chain
--    terminus. Cost collects HERE; a cost line whose WBS element sits under
--    no control account is money with no accountable owner.
-- ---------------------------------------------------------------------------
create table if not exists public.project_control_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  control_account_ref text not null check (btrim(control_account_ref) <> ''),
  -- One control account per WBS element (the unique below), and control
  -- accounts do not nest (the trigger).
  wbs_element_id uuid not null references project_wbs_elements(id) on delete cascade,
  -- The OBS leg (ruling 3): the org node, and the human who answers for it.
  org_node_id uuid references organizations(id) on delete set null,
  accountable_owner_id uuid not null references auth.users(id),
  cbs_code_id uuid not null references project_cbs_codes(id) on delete restrict,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, control_account_ref),
  unique (wbs_element_id)
);

create index if not exists idx_ca_case
  on project_control_accounts(organization_id, development_case_id);

alter table public.project_control_accounts enable row level security;
drop policy if exists project_control_accounts_read on public.project_control_accounts;
create policy project_control_accounts_read on public.project_control_accounts
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- 7. TREE INTEGRITY — every writer, no exemptions.
--
-- INSERT and UPDATE both covered (house law), with an is-distinct guard so
-- an UPDATE that does not move the row does no walk. DELETE needs no arm:
-- parent_id is ON DELETE RESTRICT, so a parent cannot be deleted out from
-- under a child in the first place.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_wbs_tree_integrity()
returns trigger
language plpgsql
as $$
declare
  v_parent project_wbs_elements%rowtype;
  v_walk uuid;
  v_depth int := 1;
begin
  if tg_op = 'UPDATE'
     and new.parent_id is not distinct from old.parent_id
     and new.development_case_id is not distinct from old.development_case_id then
    -- Nothing structural moved for THIS row, so no walk is needed — but
    -- depth is DERIVED, never carried: freezing it to old.depth is what let
    -- a re-parented subtree keep stale depths (a moved branch reported the
    -- level it used to sit at, and the 12-level cap was then enforced only
    -- against the row that moved). Re-deriving from the parent is one index
    -- lookup and makes the top-down refresh below correct by construction.
    new.depth := coalesce(
      (select p.depth from project_wbs_elements p where p.id = new.parent_id), 0) + 1;
    if new.depth > 12 then
      raise exception
        'WBS depth exceeds 12 levels — a decomposition this deep is a data fault, not a plan'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    new.depth := 1;
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception
      'WBS element % cannot be its own parent — a decomposition that contains itself decomposes nothing.',
      new.wbs_code
      using errcode = 'check_violation';
  end if;

  select * into v_parent from project_wbs_elements where id = new.parent_id;
  if not found then
    raise exception
      'the parent WBS element does not exist — a WBS element hangs off a real element or off nothing, never off an id'
      using errcode = 'check_violation';
  end if;
  if v_parent.development_case_id <> new.development_case_id then
    raise exception
      'the parent WBS element belongs to a different development case — one WBS does not span two cases'
      using errcode = 'check_violation';
  end if;

  -- Walk up. A cycle is corrupt data, not a provenance question.
  v_walk := v_parent.id;
  while v_walk is not null loop
    v_depth := v_depth + 1;
    if v_walk = new.id then
      raise exception
        'that parent sits below this element — a WBS is a tree, and this move would make a cycle'
        using errcode = 'check_violation';
    end if;
    if v_depth > 12 then
      raise exception
        'WBS depth exceeds 12 levels — a decomposition this deep is a data fault, not a plan'
        using errcode = 'check_violation';
    end if;
    select parent_id into v_walk from project_wbs_elements where id = v_walk;
  end loop;

  new.depth := v_depth;
  return new;
end
$$;

revoke all on function public.enforce_wbs_tree_integrity() from public, anon, authenticated;

drop trigger if exists trg_wbs_tree_integrity on public.project_wbs_elements;
create trigger trg_wbs_tree_integrity
  before insert or update on public.project_wbs_elements
  for each row execute function public.enforce_wbs_tree_integrity();

-- ---------------------------------------------------------------------------
-- 8. CONTROL ACCOUNTS DO NOT NEST. If cost collected at two points on one
--    branch, every roll-up would double-count the lower one; the "what did
--    this account cost" question would have two answers, which is the exact
--    two-answers failure the house forbids. Refused for every writer, both
--    directions (an ancestor already holds one, or a descendant does).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_control_account_no_nesting()
returns trigger
language plpgsql
as $$
declare
  v_walk uuid;
  v_conflict text;
  v_guard int := 0;
begin
  if tg_op = 'UPDATE' and new.wbs_element_id is not distinct from old.wbs_element_id then
    return new;
  end if;

  -- Upward: any ancestor already a control account?
  select parent_id into v_walk from project_wbs_elements where id = new.wbs_element_id;
  while v_walk is not null loop
    v_guard := v_guard + 1;
    exit when v_guard > 12;
    select ca.control_account_ref into v_conflict
      from project_control_accounts ca
     where ca.wbs_element_id = v_walk and ca.id is distinct from new.id;
    if v_conflict is not null then
      raise exception
        'WBS element already rolls up into control account % — control accounts do not nest, because cost that collected at both points would be counted twice.',
        v_conflict
        using errcode = 'check_violation';
    end if;
    select parent_id into v_walk from project_wbs_elements where id = v_walk;
  end loop;

  -- Downward: any descendant already a control account?
  select ca.control_account_ref into v_conflict
  from project_control_accounts ca
  where ca.id is distinct from new.id
    and ca.wbs_element_id in (
      with recursive sub as (
        select id from project_wbs_elements where parent_id = new.wbs_element_id
        union all
        select w.id from project_wbs_elements w join sub s on w.parent_id = s.id
      )
      select id from sub)
  limit 1;
  if v_conflict is not null then
    raise exception
      'a WBS element below this one already carries control account % — control accounts do not nest.',
      v_conflict
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_control_account_no_nesting() from public, anon, authenticated;

drop trigger if exists trg_control_account_no_nesting on public.project_control_accounts;
create trigger trg_control_account_no_nesting
  before insert or update on public.project_control_accounts
  for each row execute function public.enforce_control_account_no_nesting();

-- ---------------------------------------------------------------------------
-- THE ROLL-UP POINT, resolved once.
--
-- Cost collects at the nearest control account AT OR ABOVE an element, not
-- only at an exact match. The first cut of the cost-item trigger matched
-- exactly, so a line coded to 1.1.1 under a control account on 1.1 recorded
-- control_account_id = NULL and was then reported by D5.02 as "outside every
-- control account" — a FALSE gap, and the most damaging kind, because a gap
-- report people learn to disbelieve is worse than none. Control accounts do
-- not nest (the trigger above), so "nearest at or above" is unambiguous:
-- there is at most one on any branch.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_control_account_for_wbs(p_wbs uuid)
returns uuid
language sql
stable
set search_path = public
as $$
  with recursive up(id, parent_id, depth) as (
    select w.id, w.parent_id, 0 from project_wbs_elements w where w.id = p_wbs
    union all
    select w.id, w.parent_id, u.depth + 1
      from project_wbs_elements w join up u on w.id = u.parent_id
     where u.depth < 12
  )
  select ca.id
    from up
    join project_control_accounts ca on ca.wbs_element_id = up.id
   order by up.depth
   limit 1;
$$;

revoke all on function public.resolve_control_account_for_wbs(uuid) from public, anon;
grant execute on function public.resolve_control_account_for_wbs(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The write paths. Planning role set — authoring scope structure is
--    preparation. Every one takes jsonb, so every scalar goes through the
--    3C parse-or-NULL helpers rather than raising a raw 22P02 from a
--    DECLARE block.
-- ---------------------------------------------------------------------------
create or replace function public.record_scope_need(
  p_case_id uuid,
  p_need jsonb
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
  v_ref text := nullif(btrim(coalesce(p_need->>'need_ref','')), '');
  v_statement text := nullif(btrim(coalesce(p_need->>'statement','')), '');
  v_authority text := coalesce(nullif(btrim(coalesce(p_need->>'source_authority','')), ''), 'PROJECT_FRAMEWORK');
  v_owner_raw text := nullif(btrim(coalesce(p_need->>'owner_id','')), '');
  v_owner uuid := sync_text_as_uuid(v_owner_raw);
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a business need requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a need carries a reference the requirements can cite (need_ref)');
  end if;
  if v_statement is null or length(v_statement) < 10 then
    return jsonb_build_object('error',
      'state the business need — what the organization needs to be true (10 characters minimum)');
  end if;
  if v_authority not in ('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT',
                         'INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION') then
    return jsonb_build_object('error',
      'source_authority must be one of LAW, REGULATION, CORPORATE_STANDARD, PROJECT_FRAMEWORK, CONTRACT, INDUSTRY_GUIDANCE, BEST_PRACTICE, AI_SUGGESTION');
  end if;
  -- The AI-operator identity may prepare, but what it prepares is stamped
  -- AI_SUGGESTION and cannot claim a higher tier (the 3D tier cap).
  if coalesce(v_role, '') = 'ai_admin' and v_authority <> 'AI_SUGGESTION' then
    return jsonb_build_object('error',
      'the AI-operator identity may record a need only at the AI_SUGGESTION tier — a need it states is a suggestion until a human raises it');
  end if;
  if v_owner_raw is null then
    return jsonb_build_object('error',
      'name the owner of this need — a need nobody owns cannot be met or withdrawn by anyone');
  end if;
  if v_owner is null then
    return jsonb_build_object('error', format('owner_id "%s" is not a uuid', v_owner_raw));
  end if;
  if not exists (select 1 from user_profiles where id = v_owner and organization_id = v_org) then
    return jsonb_build_object('error', 'the named owner is not a member of this organization');
  end if;
  if exists (select 1 from project_scope_needs
             where development_case_id = c.id and need_ref = v_ref) then
    return jsonb_build_object('error',
      format('need reference "%s" already exists on this case — a reference identifies one need', v_ref));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  insert into project_scope_needs
    (organization_id, development_case_id, need_ref, statement, source_authority, owner_id, created_by)
  values (v_org, c.id, v_ref, v_statement, v_authority, v_owner, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_scope_need', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'need_id', v_id, 'need_ref', v_ref, 'action', 'recorded'),
    null,
    jsonb_build_object('need_ref', v_ref, 'statement', v_statement,
      'source_authority', v_authority, 'owner_id', v_owner, 'status', 'open'));

  return jsonb_build_object('need_id', v_id, 'need_ref', v_ref, 'case_id', c.id);
end
$$;

revoke all on function public.record_scope_need(uuid, jsonb) from public, anon;
grant execute on function public.record_scope_need(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.record_cbs_code(
  p_case_id uuid,
  p_code jsonb
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
  v_code text := nullif(btrim(coalesce(p_code->>'cbs_code','')), '');
  v_title text := nullif(btrim(coalesce(p_code->>'title','')), '');
  v_type text := nullif(btrim(coalesce(p_code->>'cost_type','')), '');
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a CBS code requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_code is null then
    return jsonb_build_object('error', 'a CBS entry carries its code (cbs_code)');
  end if;
  if v_title is null or length(v_title) < 3 then
    return jsonb_build_object('error', 'name what this CBS code collects (title, 3 characters minimum)');
  end if;
  if v_type is null or v_type not in
     ('labour','material','equipment','subcontract','indirect','owner_cost','contingency','escalation') then
    return jsonb_build_object('error',
      'cost_type must be one of: labour, material, equipment, subcontract, indirect, owner_cost, contingency, escalation');
  end if;
  if exists (select 1 from project_cbs_codes
             where development_case_id = c.id and cbs_code = v_code) then
    return jsonb_build_object('error',
      format('CBS code "%s" already exists on this case — one code, one meaning', v_code));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  insert into project_cbs_codes
    (organization_id, development_case_id, cbs_code, title, cost_type, created_by)
  values (v_org, c.id, v_code, v_title, v_type, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_cbs_code', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'cbs_code_id', v_id, 'cbs_code', v_code, 'action', 'recorded'),
    null,
    jsonb_build_object('cbs_code', v_code, 'title', v_title, 'cost_type', v_type));

  return jsonb_build_object('cbs_code_id', v_id, 'cbs_code', v_code, 'case_id', c.id);
end
$$;

revoke all on function public.record_cbs_code(uuid, jsonb) from public, anon;
grant execute on function public.record_cbs_code(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.record_wbs_element(
  p_case_id uuid,
  p_element jsonb
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
  v_code text := nullif(btrim(coalesce(p_element->>'wbs_code','')), '');
  v_title text := nullif(btrim(coalesce(p_element->>'title','')), '');
  v_scope text := nullif(btrim(coalesce(p_element->>'scope_description','')), '');
  v_parent_raw text := nullif(btrim(coalesce(p_element->>'parent_wbs_code','')), '');
  v_system_raw text := nullif(btrim(coalesce(p_element->>'system_node_id','')), '');
  v_system uuid := sync_text_as_uuid(v_system_raw);
  v_parent uuid;
  v_id uuid;
  v_depth int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a WBS element requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_code is null then
    return jsonb_build_object('error', 'a WBS element carries its code (wbs_code)');
  end if;
  if v_title is null or length(v_title) < 3 then
    return jsonb_build_object('error', 'name the WBS element (title, 3 characters minimum)');
  end if;
  if v_scope is null or length(v_scope) < 10 then
    return jsonb_build_object('error',
      'state what is IN this element (scope_description, 10 characters minimum) — a WBS element with no scope statement is a label, and nothing can be traced to a label');
  end if;
  if v_parent_raw is not null then
    select id into v_parent from project_wbs_elements
     where development_case_id = c.id and wbs_code = v_parent_raw;
    if v_parent is null then
      return jsonb_build_object('error',
        format('parent WBS code "%s" does not exist on this case — record the parent first, or leave parent_wbs_code empty for a root element', v_parent_raw));
    end if;
  end if;
  if v_system_raw is not null then
    if v_system is null then
      return jsonb_build_object('error', format('system_node_id "%s" is not a uuid', v_system_raw));
    end if;
    -- The ONE five-level tree. A "system" here means org_level='system'
    -- (ruling 2); pointing at a site or an area would quietly redefine the
    -- chain's third link.
    if not exists (select 1 from organizations o
                    where o.id = v_system and o.org_level = 'system') then
      return jsonb_build_object('error',
        'system_node_id must name an organization node at the system level — the chain''s System link is the five-level tree (D11.14), not free text');
    end if;
    -- ...and inside THIS tenant's own subtree. org_node_in_scope is the tree
    -- module's own containment predicate (20261120090000) — reusing it keeps
    -- one answer to "is this node mine", and a node in a foreign tenant's
    -- tree is refused rather than silently accepted as a system name.
    if not org_node_in_scope(v_system, v_org) then
      return jsonb_build_object('error',
        'that system node is not inside this organization''s tree');
    end if;
  end if;
  if exists (select 1 from project_wbs_elements
             where development_case_id = c.id and wbs_code = v_code) then
    return jsonb_build_object('error',
      format('WBS code "%s" already exists on this case — one code, one element', v_code));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  insert into project_wbs_elements
    (organization_id, development_case_id, wbs_code, parent_id, title,
     scope_description, system_node_id, created_by)
  values (v_org, c.id, v_code, v_parent, v_title, v_scope, v_system, auth.uid())
  returning id, depth into v_id, v_depth;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_wbs_element', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'wbs_element_id', v_id, 'wbs_code', v_code, 'action', 'recorded'),
    null,
    jsonb_build_object('wbs_code', v_code, 'title', v_title, 'parent_wbs_code', v_parent_raw,
      'depth', v_depth, 'system_node_id', v_system));

  return jsonb_build_object('wbs_element_id', v_id, 'wbs_code', v_code,
    'depth', v_depth, 'case_id', c.id);
end
$$;

revoke all on function public.record_wbs_element(uuid, jsonb) from public, anon;
grant execute on function public.record_wbs_element(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Requirement → need, and requirement → WBS. Two links, one function each,
-- because the refusals differ: a need link is a statement about WHY the
-- requirement exists; a WBS link is a statement about WHERE it is delivered.
-- ---------------------------------------------------------------------------
create or replace function public.link_requirement_to_need(
  p_requirement_id bigint,
  p_need_id uuid
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
  n project_scope_needs%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'linking scope requires a planning, engineering or governance role');
  end if;
  select * into d from design_requirements where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;
  select * into n from project_scope_needs where id = p_need_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business need not found');
  end if;
  if d.development_case_id is null then
    return jsonb_build_object('error',
      'that requirement is not bound to a development case, so it cannot trace to that case''s needs');
  end if;
  if d.development_case_id <> n.development_case_id then
    return jsonb_build_object('error',
      'the requirement and the need belong to different development cases — a chain does not jump between cases');
  end if;

  update design_requirements set scope_need_id = n.id where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_scope_chain', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', n.development_case_id, 'requirement_id', d.id,
      'need_id', n.id, 'action', 'requirement_linked_to_need'),
    jsonb_build_object('scope_need_id', d.scope_need_id),
    jsonb_build_object('scope_need_id', n.id));

  return jsonb_build_object('requirement_id', d.id, 'need_id', n.id,
    'requirement_ref', d.requirement_ref, 'need_ref', n.need_ref);
end
$$;

revoke all on function public.link_requirement_to_need(bigint, uuid) from public, anon;
grant execute on function public.link_requirement_to_need(bigint, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.link_requirement_to_wbs(
  p_requirement_id bigint,
  p_wbs_element_id uuid
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
  w project_wbs_elements%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'linking scope requires a planning, engineering or governance role');
  end if;
  select * into d from design_requirements where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;
  select * into w from project_wbs_elements where id = p_wbs_element_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'WBS element not found');
  end if;
  if d.development_case_id is null or d.development_case_id <> w.development_case_id then
    return jsonb_build_object('error',
      'the requirement and the WBS element belong to different development cases — a chain does not jump between cases');
  end if;
  if exists (select 1 from project_requirement_wbs
             where requirement_id = d.id and wbs_element_id = w.id) then
    return jsonb_build_object('error',
      format('requirement %s is already delivered by WBS %s', d.requirement_ref, w.wbs_code));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  insert into project_requirement_wbs
    (organization_id, development_case_id, requirement_id, wbs_element_id, linked_by)
  values (v_org, w.development_case_id, d.id, w.id, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_scope_chain', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', w.development_case_id, 'requirement_id', d.id,
      'wbs_element_id', w.id, 'action', 'requirement_linked_to_wbs'),
    null,
    jsonb_build_object('requirement_ref', d.requirement_ref, 'wbs_code', w.wbs_code));

  return jsonb_build_object('link_id', v_id, 'requirement_ref', d.requirement_ref,
    'wbs_code', w.wbs_code);
end
$$;

revoke all on function public.link_requirement_to_wbs(bigint, uuid) from public, anon;
grant execute on function public.link_requirement_to_wbs(bigint, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.designate_control_account(
  p_case_id uuid,
  p_account jsonb
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
  v_ref text := nullif(btrim(coalesce(p_account->>'control_account_ref','')), '');
  v_wbs_code text := nullif(btrim(coalesce(p_account->>'wbs_code','')), '');
  v_cbs_code text := nullif(btrim(coalesce(p_account->>'cbs_code','')), '');
  v_owner_raw text := nullif(btrim(coalesce(p_account->>'accountable_owner_id','')), '');
  v_owner uuid := sync_text_as_uuid(v_owner_raw);
  w project_wbs_elements%rowtype;
  b project_cbs_codes%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'designating a control account requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  -- SERIALIZE THE NESTING DECISION. "Control accounts do not nest" is a
  -- check-then-insert: two transactions designating an account on a parent
  -- and on its child each see no COMMITTED conflict and both commit, and
  -- resolve_control_account_for_wbs then silently picks one of two roll-up
  -- points. No unique index can express "no account anywhere on this
  -- branch", so the lock is the serialization — the create_sub_organization
  -- idiom (pinned by developSlice3GovernanceMigration), keyed on the case
  -- because a WBS branch never spans two.
  perform pg_advisory_xact_lock(hashtextextended('control_account:' || c.id::text, 0));
  if v_ref is null then
    return jsonb_build_object('error', 'a control account carries its reference (control_account_ref)');
  end if;
  if v_wbs_code is null then
    return jsonb_build_object('error', 'name the WBS element this control account sits on (wbs_code)');
  end if;
  select * into w from project_wbs_elements
   where development_case_id = c.id and wbs_code = v_wbs_code;
  if not found then
    return jsonb_build_object('error',
      format('WBS code "%s" does not exist on this case', v_wbs_code));
  end if;
  if v_cbs_code is null then
    return jsonb_build_object('error',
      'name the CBS code cost collects under (cbs_code) — a control account with no cost code collects nothing');
  end if;
  select * into b from project_cbs_codes
   where development_case_id = c.id and cbs_code = v_cbs_code;
  if not found then
    return jsonb_build_object('error',
      format('CBS code "%s" does not exist on this case — record it first', v_cbs_code));
  end if;
  if v_owner_raw is null then
    return jsonb_build_object('error',
      'name the accountable owner — a control account is the point where scope, cost and a PERSON meet (spec I.8 OBS)');
  end if;
  if v_owner is null then
    return jsonb_build_object('error', format('accountable_owner_id "%s" is not a uuid', v_owner_raw));
  end if;
  if not exists (select 1 from user_profiles where id = v_owner and organization_id = v_org) then
    return jsonb_build_object('error', 'the named accountable owner is not a member of this organization');
  end if;
  if exists (select 1 from project_control_accounts
             where development_case_id = c.id and control_account_ref = v_ref) then
    return jsonb_build_object('error',
      format('control account "%s" already exists on this case', v_ref));
  end if;
  if exists (select 1 from project_control_accounts where wbs_element_id = w.id) then
    return jsonb_build_object('error',
      format('WBS element %s already carries a control account', w.wbs_code));
  end if;
  -- The nesting rule, stated at the door in the caller's own vocabulary. The
  -- trigger behind it (trg_control_account_no_nesting) is the wall that holds
  -- for every writer; without this the only refusal a user would ever see is
  -- a raw check_violation, which names the rule to a developer and nobody
  -- else.
  if exists (
    with recursive up(id, parent_id) as (
      select w.id, w.parent_id
      union all
      select e.id, e.parent_id from project_wbs_elements e join up u on e.id = u.parent_id
    ),
    down(id) as (
      select w.id
      union all
      select e.id from project_wbs_elements e join down d on e.parent_id = d.id
    )
    select 1 from project_control_accounts ca
     where ca.wbs_element_id in (select id from up)
        or ca.wbs_element_id in (select id from down)
  ) then
    return jsonb_build_object('error',
      format('a control account already sits on this branch of the WBS (at or under %s) — control accounts do not nest, because cost that collected at two points on one branch would be counted twice', w.wbs_code));
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  insert into project_control_accounts
    (organization_id, development_case_id, control_account_ref, wbs_element_id,
     org_node_id, accountable_owner_id, cbs_code_id, created_by)
  values (v_org, c.id, v_ref, w.id, w.system_node_id, v_owner, b.id, auth.uid())
  returning id into v_id;

  -- Lines already coded to this branch acquire their roll-up point NOW.
  -- Without this, a cost line recorded before its control account existed
  -- would stay reported as an orphan for ever, and the fix would be to
  -- re-type the line — which is a data-entry ritual standing in for a
  -- resolution the database can do exactly once. (Forward reference to
  -- project_cost_items: plpgsql bodies resolve names at RUN time, and by then
  -- 20261130090200 has applied; the slice's smoke exercises this path.)
  perform set_config('app.cost_item_write', 'granted', true);
  update project_cost_items ci
     set control_account_id = v_id
   where ci.development_case_id = c.id
     and ci.control_account_id is null
     and resolve_control_account_for_wbs(ci.wbs_element_id) = v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_control_account', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'control_account_id', v_id,
      'control_account_ref', v_ref, 'action', 'designated'),
    null,
    jsonb_build_object('control_account_ref', v_ref, 'wbs_code', w.wbs_code,
      'cbs_code', b.cbs_code, 'accountable_owner_id', v_owner));

  return jsonb_build_object('control_account_id', v_id, 'control_account_ref', v_ref,
    'wbs_code', w.wbs_code, 'cbs_code', b.cbs_code);
end
$$;

revoke all on function public.designate_control_account(uuid, jsonb) from public, anon;
grant execute on function public.designate_control_account(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. DEPTH IS DERIVED FOR THE WHOLE SUBTREE, not just the row that moved.
--
-- Re-parenting an element changes the level of everything beneath it. The
-- BEFORE trigger can only see the row in front of it, so a moved branch kept
-- the depths it had at its old position — which get_case_controls and
-- get_case_scope_traceability then rendered. This walks the subtree TOP DOWN
-- and touches each row, so each row's own BEFORE trigger re-derives its
-- depth from a parent that is already correct. The 12-level cap therefore
-- binds every descendant, not only the element a caller happened to move.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_wbs_subtree_depth()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.parent_id is not distinct from old.parent_id then
    return null;
  end if;
  for r in
    with recursive sub(id, lvl) as (
      select w.id, 1 from project_wbs_elements w where w.parent_id = new.id
      union all
      select w.id, s.lvl + 1
        from project_wbs_elements w join sub s on w.parent_id = s.id
       where s.lvl < 12
    )
    select id from sub order by lvl
  loop
    -- A no-op assignment: the value comes from the BEFORE trigger, which
    -- derives it from the (already refreshed) parent.
    update project_wbs_elements set depth = depth where id = r.id;
  end loop;

  -- ...and the ROLL-UP POINT moves with the branch. control_account_id is
  -- derived from "the nearest control account at or above this element", so
  -- a moved element whose account was left behind would keep collecting cost
  -- at a point that is no longer above it — money counted against an account
  -- on another branch, with nothing reporting it. The new value is written
  -- explicitly rather than as a no-op assignment: control_account_id is
  -- inside trg_cost_item_coding's is-distinct guard (which is what stops a
  -- caller setting it to another case's account), so an unchanged value
  -- would take the fast path and re-derive nothing.
  perform set_config('app.cost_item_write', 'granted', true);
  update project_cost_items ci
     set control_account_id = resolve_control_account_for_wbs(ci.wbs_element_id)
   where ci.development_case_id = new.development_case_id
     and ci.wbs_element_id in (
       with recursive sub(id) as (
         select new.id
         union all
         select w.id from project_wbs_elements w join sub s on w.parent_id = s.id
       )
       select id from sub)
     and ci.control_account_id is distinct from resolve_control_account_for_wbs(ci.wbs_element_id);

  return null;
end
$$;

revoke all on function public.refresh_wbs_subtree_depth() from public, anon, authenticated;

drop trigger if exists trg_wbs_subtree_depth on public.project_wbs_elements;
create trigger trg_wbs_subtree_depth
  after update on public.project_wbs_elements
  for each row execute function public.refresh_wbs_subtree_depth();

-- ---------------------------------------------------------------------------
-- 11. THE §70 PROVENANCE BACKSTOP over the five scope tables, plus the arm
--     that binds every writer: a row's organization_id and its case must
--     agree.
--
-- RLS already denies a client any write (no write policy), so the client arm
-- is defence in depth. The arm that earns its keep is the SERVICE one: a
-- caller with rolbypassrls could previously land a WBS element, a CBS code
-- or a control account with nothing recorded anywhere — the same hole the
-- Slice 3 arming tables closed with enforce_governance_config_provenance.
-- The organization arm is NOT a provenance question: a row whose
-- organization_id points at one tenant while its case belongs to another is
-- corrupt data (the RLS read policy would then show it to the wrong tenant),
-- so it is refused for every writer, service included.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_scope_architecture_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.scope_architecture_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_case uuid := case when tg_op = 'DELETE' then old.development_case_id else new.development_case_id end;
  v_case_org uuid;
begin
  if tg_op <> 'DELETE' then
    select organization_id into v_case_org from development_cases where id = v_case;
    if v_case_org is null then
      raise exception
        'this scope row names a development case that does not exist'
        using errcode = 'check_violation';
    end if;
    if v_case_org <> v_org then
      raise exception
        'this % row is stamped with organization % while its development case belongs to % — a row whose tenant and whose case disagree is read by the wrong tenant.',
        tg_table_name, v_org, v_case_org
        using errcode = 'check_violation';
    end if;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         tg_table_name || ' row ' ||
           (case when tg_op = 'DELETE' then old.id::text else new.id::text end) ||
           ' written (' || lower(tg_op) || ') by a service caller outside the ' ||
           'scope-architecture RPCs. The scope chain is what every controls ' ||
           'number is coded to (D5.01/D5.02), so a write nobody recorded ' ||
           'changes what those numbers mean without an act behind it.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'the scope architecture is written only through its authoring RPCs '
      '(record_scope_need, record_cbs_code, record_wbs_element, '
      'link_requirement_to_wbs, designate_control_account). A direct write '
      'would put scope into the chain with no recorded act behind it.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_scope_architecture_provenance() from public, anon, authenticated;

drop trigger if exists trg_scope_needs_provenance on public.project_scope_needs;
create trigger trg_scope_needs_provenance
  before insert or update or delete on public.project_scope_needs
  for each row execute function public.enforce_scope_architecture_provenance();
drop trigger if exists trg_cbs_codes_provenance on public.project_cbs_codes;
create trigger trg_cbs_codes_provenance
  before insert or update or delete on public.project_cbs_codes
  for each row execute function public.enforce_scope_architecture_provenance();
drop trigger if exists trg_wbs_elements_provenance on public.project_wbs_elements;
create trigger trg_wbs_elements_provenance
  before insert or update or delete on public.project_wbs_elements
  for each row execute function public.enforce_scope_architecture_provenance();
drop trigger if exists trg_requirement_wbs_provenance on public.project_requirement_wbs;
create trigger trg_requirement_wbs_provenance
  before insert or update or delete on public.project_requirement_wbs
  for each row execute function public.enforce_scope_architecture_provenance();
drop trigger if exists trg_control_accounts_provenance on public.project_control_accounts;
create trigger trg_control_accounts_provenance
  before insert or update or delete on public.project_control_accounts
  for each row execute function public.enforce_scope_architecture_provenance();

-- ---------------------------------------------------------------------------
-- 12. THE LINK WALLS. project_cost_items got trg_cost_item_coding because a
--     cross-case coding is corrupt data; the two REQUIREMENT links need the
--     same wall for the same reason, and did not have it.
--
-- A requirement pointing at another case's need made get_case_scope_
-- traceability report the need as "covered" while the requirement was not
-- even on the case — a broken chain that reads complete from both ends,
-- which is precisely what D5.02 exists to prevent. Enforced for EVERY
-- writer, INSERT and UPDATE (DELETE cannot create a mismatch).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_need_case_agreement()
returns trigger
language plpgsql
as $$
declare
  v_need_case uuid;
begin
  if new.scope_need_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.scope_need_id is not distinct from old.scope_need_id
     and new.development_case_id is not distinct from old.development_case_id then
    return new;
  end if;
  select development_case_id into v_need_case
    from project_scope_needs where id = new.scope_need_id;
  if v_need_case is null then
    raise exception 'that business need does not exist' using errcode = 'check_violation';
  end if;
  if new.development_case_id is null or new.development_case_id <> v_need_case then
    raise exception
      'this requirement traces to a business need on a different development case — a scope chain does not jump between cases, and a link that did would make the traceability report show a chain that is not there'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_requirement_need_case_agreement() from public, anon, authenticated;

drop trigger if exists trg_requirement_need_case on public.design_requirements;
create trigger trg_requirement_need_case
  before insert or update on public.design_requirements
  for each row execute function public.enforce_requirement_need_case_agreement();

create or replace function public.enforce_requirement_wbs_case_agreement()
returns trigger
language plpgsql
as $$
declare
  v_req_case uuid;
  v_wbs_case uuid;
begin
  if tg_op = 'UPDATE'
     and new.requirement_id is not distinct from old.requirement_id
     and new.wbs_element_id is not distinct from old.wbs_element_id
     and new.development_case_id is not distinct from old.development_case_id then
    return new;
  end if;
  select development_case_id into v_req_case from design_requirements where id = new.requirement_id;
  select development_case_id into v_wbs_case from project_wbs_elements where id = new.wbs_element_id;
  if v_wbs_case is null then
    raise exception 'that WBS element does not exist' using errcode = 'check_violation';
  end if;
  if v_req_case is null or v_req_case <> v_wbs_case or v_wbs_case <> new.development_case_id then
    raise exception
      'this link joins a requirement and a WBS element that do not both belong to development case % — a delivery link across cases makes both cases'' traceability reports wrong',
      new.development_case_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_requirement_wbs_case_agreement() from public, anon, authenticated;

drop trigger if exists trg_requirement_wbs_case on public.project_requirement_wbs;
create trigger trg_requirement_wbs_case
  before insert or update on public.project_requirement_wbs
  for each row execute function public.enforce_requirement_wbs_case_agreement();

-- ---------------------------------------------------------------------------
-- 13. TRUNCATE. RLS does not gate it and no row-level trigger fires for it,
--     so the row-level walls above are all dodgeable in one statement by any
--     role holding the verb — and Supabase's defaults grant it to anon,
--     authenticated and service_role. The verb is revoked and a
--     statement-level trigger refuses it, the audit_events posture
--     (20261121090000) applied to the tables the chain is made of.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_scope_architecture_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is part of the scope architecture chain every controls number is coded to; truncating it erases the chain for every tenant in one statement, which no row-level wall can refuse. Delete through the acts that own these rows, or not at all.',
    tg_table_name
    using errcode = 'insufficient_privilege';
end
$$;

revoke all on function public.refuse_scope_architecture_truncate() from public, anon, authenticated;

drop trigger if exists trg_scope_needs_no_truncate on public.project_scope_needs;
create trigger trg_scope_needs_no_truncate
  before truncate on public.project_scope_needs
  for each statement execute function public.refuse_scope_architecture_truncate();
drop trigger if exists trg_cbs_codes_no_truncate on public.project_cbs_codes;
create trigger trg_cbs_codes_no_truncate
  before truncate on public.project_cbs_codes
  for each statement execute function public.refuse_scope_architecture_truncate();
drop trigger if exists trg_wbs_elements_no_truncate on public.project_wbs_elements;
create trigger trg_wbs_elements_no_truncate
  before truncate on public.project_wbs_elements
  for each statement execute function public.refuse_scope_architecture_truncate();
drop trigger if exists trg_requirement_wbs_no_truncate on public.project_requirement_wbs;
create trigger trg_requirement_wbs_no_truncate
  before truncate on public.project_requirement_wbs
  for each statement execute function public.refuse_scope_architecture_truncate();
drop trigger if exists trg_control_accounts_no_truncate on public.project_control_accounts;
create trigger trg_control_accounts_no_truncate
  before truncate on public.project_control_accounts
  for each statement execute function public.refuse_scope_architecture_truncate();

revoke truncate on table public.project_scope_needs from anon, authenticated, service_role;
revoke truncate on table public.project_cbs_codes from anon, authenticated, service_role;
revoke truncate on table public.project_wbs_elements from anon, authenticated, service_role;
revoke truncate on table public.project_requirement_wbs from anon, authenticated, service_role;
revoke truncate on table public.project_control_accounts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. A need's LIFECYCLE. project_scope_needs.status carried three values and
--     had no act that could reach two of them, so 'met' and 'withdrawn' were
--     a vocabulary the product could not produce: the traceability report
--     filtered on a value nothing could set, and the surface rendered a
--     status that was always 'open'.
--
-- Closing a need is an observation about delivery, not a governance
-- determination, so the planning role set may make it — but a WITHDRAWAL
-- removes a need from the chain, and a need that leaves silently takes its
-- requirements' justification with it. The reason is therefore mandatory,
-- and get_case_scope_traceability treats a requirement tracing to a
-- withdrawn need as untraced (gap 4) rather than as covered.
-- ---------------------------------------------------------------------------
create or replace function public.set_scope_need_status(
  p_need_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  n project_scope_needs%rowtype;
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'changing a business need''s status requires a planning, engineering or governance role');
  end if;
  select * into n from project_scope_needs where id = p_need_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'business need not found');
  end if;
  if v_status not in ('open','met','withdrawn') then
    return jsonb_build_object('error', 'status must be one of: open, met, withdrawn');
  end if;
  if v_status = 'withdrawn' and (v_reason is null or length(v_reason) < 10) then
    return jsonb_build_object('error',
      'withdrawing a business need takes it out of the scope chain and leaves every requirement that traced to it untraced — state why (reason, 10 characters minimum)');
  end if;
  if v_status = 'met' and not exists (
       select 1 from design_requirements d where d.scope_need_id = n.id
        and d.development_case_id = n.development_case_id) then
    return jsonb_build_object('error',
      'that need has no requirement tracing to it, so nothing was delivered that could have met it. Link a requirement first, or withdraw the need with a reason.');
  end if;

  perform set_config('app.scope_architecture_write', 'granted', true);
  update project_scope_needs
     set status = v_status,
         withdrawn_reason = case when v_status = 'withdrawn' then v_reason else null end
   where id = n.id;

  insert into audit_events (organization_id, entity_type, actor, event_data, previous_state, new_state)
  values (v_org, 'project_scope_need', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', n.development_case_id, 'need_id', n.id,
      'need_ref', n.need_ref, 'action', 'status_changed'),
    jsonb_build_object('status', n.status, 'withdrawn_reason', n.withdrawn_reason),
    jsonb_build_object('status', v_status,
      'withdrawn_reason', case when v_status = 'withdrawn' then v_reason else null end));

  return jsonb_build_object('need_id', n.id, 'need_ref', n.need_ref, 'status', v_status);
end
$$;

revoke all on function public.set_scope_need_status(uuid, text, text) from public, anon;
grant execute on function public.set_scope_need_status(uuid, text, text) to authenticated, service_role;

comment on table public.project_wbs_elements is
  'D5.01 (spec I.6): the WBS. The decomposition the scope chain passes through on its way from a business need to a control account. Definer-RPC-only writes; tree integrity refused for every writer.';
comment on table public.project_control_accounts is
  'D5.01/D5.04: the WBS x OBS intersection where cost collects and a named person is accountable. This slice''s chain terminus — work package and contract are the two links deliberately deferred to Slices 7 and 6.';

notify pgrst, 'reload schema';
