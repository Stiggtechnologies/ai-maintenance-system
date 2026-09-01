-- ============================================================================
-- Sync Develop Slice 5B — the Interface object (D4.18, spec III.§19).
--
-- §19 verbatim: "Interface (§19, critical brownfield): id,
-- development_case_id, source_object, target_object, interface_type, owner_id,
-- requirement, due_date, status. Types: PHYSICAL, PROCESS, ELECTRICAL,
-- CONTROL, DATA, ORGANIZATIONAL, CONTRACTUAL."
--
-- ── RULING 1 — WHY THIS IS NOT A ROW IN asset_dependencies, AND WHY IT IS
--               STILL NOT A SECOND GRAPH ────────────────────────────────────
--
-- The overlap map's verdict for D4.18 is "EXTEND the dependency pattern, share
-- the traversal lib", and the register row names asset_dependencies
-- (20260815090000:50) as the substrate. The obvious reading — put the §19
-- columns on asset_dependencies — was tried and REFUSED, for one reason
-- stated here so nobody re-tries it:
--
--   asset_dependencies.dependent_asset_id and .supplier_asset_id are NOT NULL
--   FKs to `assets`. §19's endpoints are OBJECTS, and its own headline is
--   "critical brownfield": the commonest real interface is between a package
--   that does not exist yet and an existing header, a control system and a
--   contractor's scope, or two organizations. Carrying that on
--   asset_dependencies would require dropping those NOT NULLs — weakening an
--   invariant that holds for every existing row of a live table, to model
--   something else. This repository's standing rule is that a failing guard is
--   the answer, not the thing to widen.
--
-- So the Interface is its own row type AND NOT ITS OWN ARITHMETIC. What makes
-- it "not a second graph" is the part that matters:
--
--   * an interface whose endpoints ARE assets carries `source_asset_id` /
--     `target_asset_id`, so its nodes are THE SAME NODE IDS as
--     asset_dependencies uses;
--   * `get_case_interface_graph` returns ONE graph containing both the
--     interface edges and the asset_dependencies edges among every asset those
--     interfaces touch;
--   * that payload is the EXISTING `DependencyGraph` shape, and
--     `propagateLoss` / `singlePointsOfFailure`
--     (src/lib/interdependency/index.ts) traverse it unchanged. No second
--     traversal, no second cascade model, no second single-point-of-failure
--     rule.
--
-- ── RULING 2 — DIRECTION ─────────────────────────────────────────────────
--
-- §19 gives source_object and target_object and does not say which way the
-- dependency runs. RULING: the TARGET depends on the SOURCE — the source
-- delivers, the target needs it — which is the direction that makes an
-- unclosed interface propagate to the thing waiting on it. This is stated
-- rather than assumed because the opposite convention would make every
-- cascade run backwards, and a cascade that runs backwards is worse than none.
-- The read labels every edge with both, so a reader can check the convention
-- rather than trust it.
--
-- ── RULING 3 — STATUS AND OVERDUE ────────────────────────────────────────
--
-- §19 names `status` and does not enumerate it. RULING: identified → agreed →
-- delivered → closed, plus `disputed` for the state every brownfield project
-- actually has and no specification writes down. OVERDUE is DERIVED, never
-- stored: due_date in the past and status not in (delivered, closed). A stored
-- overdue flag is a flag that is wrong every night at midnight.
--
-- ── RULING 4 — NO GATE CONSEQUENCE IS CLAIMED HERE ───────────────────────
--
-- An overdue interface is REPORTED, prominently, and does not block a gate.
-- Adding it to case_gate_outstanding_obligations would be this slice deciding
-- governance policy for a family (D3.16/D3.19) that owns that decision — the
-- same refusal 20261122090300 made for `assurance_not_satisfied` and
-- 20261205090000 made for "no frontline review at all". The register row says
-- exactly that rather than implying a refusal this code does not make.
--
-- ── RULING 5 — THE OWNER IS ACCOUNTABLE, SO IT IS NOT A MACHINE ──────────
--
-- §19 lists owner_id. An interface with no owner is the defect the object
-- exists to expose, so owner_id is NOT NULL and org-validated; and the
-- AI-operator identity cannot hold it, because an interface owner is the
-- person who will be asked why the tie-in was not agreed. That is the
-- accountability rule the success contract already applies to outcome owners
-- (20261115090300), reusing 20261205090000's one §70 trigger function rather
-- than a copy.
--
-- Canonical reuse: development_cases, assets, asset_dependencies,
-- design_requirements, audit_events, app_current_org(),
-- enforce_frontline_judgement_is_human, src/lib/interdependency.
-- ============================================================================

create or replace function public.sync_interface_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'physical', 'process', 'electrical', 'control',
    'data', 'organizational', 'contractual']::text[];
$$;

comment on function public.sync_interface_types() is
  'D4.18 / spec III.§19: the seven interface types, VERBATIM from the specification and in its order.';

-- Ruling 1: the traversal kind each interface type presents as when it enters
-- the SHARED dependency graph. Stated as data, in one place, and echoed on
-- every edge the read emits so the mapping is visible rather than buried.
create or replace function public.sync_interface_traversal_kind(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select k from (values
    ('physical',       'functional'),
    ('process',        'functional'),
    ('electrical',     'utility'),
    ('control',        'control'),
    ('data',           'control'),
    ('organizational', 'logistical'),
    ('contractual',    'logistical')
  ) as m(t, k) where t = p_type;
$$;

comment on function public.sync_interface_traversal_kind(text) is
  'D4.18 ruling 1: maps each §19 interface type onto one of asset_dependencies'' six dependency kinds so interface edges traverse the SHARED graph (propagateLoss / singlePointsOfFailure) rather than getting a second traversal. The mapping is echoed on every edge the read emits — it is a stated judgement, not a hidden one.';

create or replace function public.sync_interface_statuses()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['identified', 'agreed', 'disputed', 'delivered', 'closed']::text[];
$$;

comment on function public.sync_interface_statuses() is
  'D4.18 ruling 3: the interface lifecycle the specification names but does not enumerate, plus `disputed` — the state every brownfield project has and no specification writes down.';

revoke all on function public.sync_interface_types() from public, anon;
revoke all on function public.sync_interface_traversal_kind(text) from public, anon;
revoke all on function public.sync_interface_statuses() from public, anon;
grant execute on function public.sync_interface_types() to authenticated, service_role;
grant execute on function public.sync_interface_traversal_kind(text) to authenticated, service_role;
grant execute on function public.sync_interface_statuses() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The §19 object.
-- ---------------------------------------------------------------------------
create table if not exists public.case_interfaces (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  interface_ref text not null,
  -- §19's source_object / target_object. TEXT, because the commonest real
  -- interface has an endpoint that is not an asset yet (ruling 1).
  source_object text not null check (btrim(source_object) <> ''),
  target_object text not null check (btrim(target_object) <> ''),
  -- ...and the asset identity where there IS one, so the interface graph and
  -- the asset graph share node ids and one traversal covers both.
  source_asset_id uuid references assets(id) on delete set null,
  target_asset_id uuid references assets(id) on delete set null,
  interface_type text not null check (interface_type = any (sync_interface_types())),
  owner_id uuid not null references auth.users(id),
  -- §19's `requirement`: what must be true across this boundary.
  requirement text not null check (length(btrim(requirement)) >= 20),
  -- The project requirement carrying it, where one does. Nullable and
  -- REPORTED as missing rather than invented.
  requirement_id bigint references design_requirements(id) on delete set null,
  due_date date,
  status text not null default 'identified'
    check (status = any (sync_interface_statuses())),
  status_note text,
  closed_at timestamptz,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, interface_ref),
  -- An interface between an object and itself is a note, not a boundary.
  constraint case_interface_endpoints_distinct check (
    btrim(lower(source_object)) <> btrim(lower(target_object))),
  constraint case_interface_assets_distinct check (
    source_asset_id is null or target_asset_id is null
    or source_asset_id <> target_asset_id),
  -- A terminal status carries the date it reached it; a live one does not.
  constraint case_interface_closure check (
    (status in ('delivered', 'closed')) = (closed_at is not null))
);

create index if not exists idx_case_interface_case
  on case_interfaces(organization_id, development_case_id, status);
create index if not exists idx_case_interface_due
  on case_interfaces(organization_id, development_case_id, due_date)
  where due_date is not null;

alter table public.case_interfaces enable row level security;
drop policy if exists case_interfaces_read on public.case_interfaces;
create policy case_interfaces_read on public.case_interfaces
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: interfaces are recorded through the definer RPCs.

comment on table public.case_interfaces is
  'D4.18 / spec III.§19: a typed, owned, dated boundary between two objects on a development case. Seven types. Where both endpoints are assets it shares node identity with asset_dependencies, and get_case_interface_graph emits ONE graph the existing propagateLoss / singlePointsOfFailure traverse — the interface is a new row type, never a second graph.';

comment on column public.case_interfaces.source_asset_id is
  'D4.18 ruling 1: the asset identity of the SOURCE endpoint where there is one. Its presence is what lets an interface edge and an asset_dependencies edge meet at the same node in one traversal.';
comment on column public.case_interfaces.status is
  'D4.18 ruling 3. OVERDUE is never stored — it is derived from due_date and status at read time, because a stored overdue flag is wrong every night at midnight.';

drop trigger if exists trg_interface_owner_is_human on public.case_interfaces;
create trigger trg_interface_owner_is_human
  before insert or update on public.case_interfaces
  for each row execute function public.enforce_frontline_judgement_is_human(
    'owner_id', 'own a project interface');

create or replace function public.enforce_case_interface_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'case_interfaces records every boundary this project has to get right, who owns it and when it is due. Truncating it erases all of them in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      return old;
    end if;
    raise exception
      'An interface is not deleted. One that turned out not to exist is CLOSED with a stated note — deleting it makes a boundary somebody dropped indistinguishable from one that was never there, which is the failure mode §19 calls "critical brownfield".'
      using errcode = 'insufficient_privilege';
  end if;

  -- MID-CASCADE ESCAPE, for the same reason the finding trigger has one:
  -- `requirement_id`, `source_asset_id` and `target_asset_id` are all
  -- `on delete set null`, so deleting a case or an asset fires an UPDATE here
  -- against a parent the same cascade may already have removed.
  if tg_op = 'UPDATE'
     and not exists (select 1 from development_cases where id = old.development_case_id) then
    return new;
  end if;

  -- Tenancy the FKs cannot police, on INSERT and on UPDATE.
  select * into c from development_cases where id = new.development_case_id;
  if not found or c.organization_id <> new.organization_id then
    raise exception
      'That development case belongs to another organization. An interface is recorded inside its own tenant.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from user_profiles u
                  where u.id = new.owner_id and u.organization_id = new.organization_id) then
    raise exception
      'An interface owner must be a member of this organization. An owner outside the tenant is a name nobody can ask.'
      using errcode = 'check_violation';
  end if;
  if new.source_asset_id is not null
     and not exists (select 1 from assets a where a.id = new.source_asset_id
                      and a.organization_id = new.organization_id) then
    raise exception
      'That source asset belongs to another organization.' using errcode = 'check_violation';
  end if;
  if new.target_asset_id is not null
     and not exists (select 1 from assets a where a.id = new.target_asset_id
                      and a.organization_id = new.organization_id) then
    raise exception
      'That target asset belongs to another organization.' using errcode = 'check_violation';
  end if;
  if new.requirement_id is not null
     and not exists (select 1 from design_requirements d where d.id = new.requirement_id
                      and d.organization_id = new.organization_id
                      and d.development_case_id = new.development_case_id) then
    raise exception
      'That project requirement is not on this development case.' using errcode = 'check_violation';
  end if;

  -- What the interface IS cannot be rewritten; only its status, its note, its
  -- owner, its date and the requirement carrying it move.
  if tg_op = 'UPDATE'
     and (new.interface_ref is distinct from old.interface_ref
          or new.source_object is distinct from old.source_object
          or new.target_object is distinct from old.target_object
          or new.interface_type is distinct from old.interface_type
          or new.requirement is distinct from old.requirement
          or new.development_case_id is distinct from old.development_case_id
          or new.organization_id is distinct from old.organization_id) then
    raise exception
      'What an interface is — its two endpoints, its type and what must be true across it — cannot be rewritten by ANY caller, service paths included. An interface that turned out to be a different interface is a NEW one; re-typing this row would silently move every date and every status onto a boundary they were never agreed for.'
      using errcode = 'insufficient_privilege';
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Interface %s (%s, %s → %s, status %s)',
             new.interface_ref, new.interface_type, new.source_object,
             new.target_object, new.status),
      tg_op,
      'An interface written or moved outside record_case_interface / set_case_interface_status changes what the register reports as open, late and owned — and a status moved to closed takes its edge out of the shared traversal.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_case_interface_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_case_interface_integrity on public.case_interfaces;
create trigger trg_case_interface_integrity
  before insert or update or delete on public.case_interfaces
  for each row execute function public.enforce_case_interface_integrity();

drop trigger if exists trg_case_interface_no_truncate on public.case_interfaces;
create trigger trg_case_interface_no_truncate
  before truncate on public.case_interfaces
  for each statement execute function public.enforce_case_interface_integrity();

revoke truncate on table public.case_interfaces from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The write paths.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_interface(
  p_case_id uuid,
  p_interface jsonb
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
  v_ref text := nullif(btrim(coalesce(p_interface->>'interface_ref','')), '');
  v_source text := nullif(btrim(coalesce(p_interface->>'source_object','')), '');
  v_target text := nullif(btrim(coalesce(p_interface->>'target_object','')), '');
  v_type text := nullif(btrim(coalesce(p_interface->>'interface_type','')), '');
  v_owner uuid := sync_text_as_uuid(p_interface->>'owner_id');
  v_requirement text := btrim(coalesce(p_interface->>'requirement',''));
  v_req_id bigint := sync_text_as_int(p_interface->>'requirement_id');
  v_source_asset uuid := sync_text_as_uuid(p_interface->>'source_asset_id');
  v_target_asset uuid := sync_text_as_uuid(p_interface->>'target_asset_id');
  v_due date;
  v_owner_role text;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a project interface requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'an interface carries a reference the rest of the project can cite (interface_ref)');
  end if;
  if v_source is null or v_target is null then
    return jsonb_build_object('error',
      'an interface has two sides — name the source object and the target object');
  end if;
  if btrim(lower(v_source)) = btrim(lower(v_target)) then
    return jsonb_build_object('error',
      'the two sides of an interface must be different objects — a boundary with itself is a note');
  end if;
  if v_type is null or not (v_type = any (sync_interface_types())) then
    return jsonb_build_object('error',
      format('interface_type must be one of the seven §19 types: %s',
        array_to_string(sync_interface_types(), ', ')));
  end if;
  if length(v_requirement) < 20 then
    return jsonb_build_object('error',
      'state what must be true across this boundary (requirement, 20 characters minimum) — an interface with no stated requirement cannot be agreed or disputed, only forgotten');
  end if;
  if v_owner is null then
    return jsonb_build_object('error',
      'name the owner (owner_id) — an interface nobody owns is the defect this object exists to expose, so it is not recordable without one');
  end if;
  select role into v_owner_role from user_profiles
    where id = v_owner and organization_id = v_org;
  if v_owner_role is null then
    return jsonb_build_object('error',
      'the interface owner must be a member of this organization');
  end if;
  if v_owner_role = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot own an interface — the owner is the person who will be asked why the tie-in was not agreed');
  end if;
  begin
    v_due := nullif(btrim(coalesce(p_interface->>'due_date','')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'due_date is not a date');
  end;
  if v_source_asset is not null
     and not exists (select 1 from assets a where a.id = v_source_asset and a.organization_id = v_org) then
    return jsonb_build_object('error', 'that source asset is not in this organization');
  end if;
  if v_target_asset is not null
     and not exists (select 1 from assets a where a.id = v_target_asset and a.organization_id = v_org) then
    return jsonb_build_object('error', 'that target asset is not in this organization');
  end if;
  if v_req_id is not null
     and not exists (select 1 from design_requirements d where d.id = v_req_id
                      and d.organization_id = v_org and d.development_case_id = c.id) then
    return jsonb_build_object('error', 'that project requirement is not on this case');
  end if;
  if exists (select 1 from case_interfaces where organization_id = v_org and interface_ref = v_ref) then
    return jsonb_build_object('error',
      format('interface reference "%s" already exists in this organization', v_ref));
  end if;

  insert into case_interfaces (organization_id, development_case_id, interface_ref,
    source_object, target_object, source_asset_id, target_asset_id, interface_type,
    owner_id, requirement, requirement_id, due_date, recorded_by)
  values (v_org, c.id, v_ref, v_source, v_target, v_source_asset, v_target_asset,
    v_type, v_owner, v_requirement, v_req_id, v_due, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_interface', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'interface_id', v_id, 'interface_ref', v_ref,
      'interface_type', v_type),
    null,
    jsonb_build_object('source_object', v_source, 'target_object', v_target,
      'interface_type', v_type, 'owner_id', v_owner, 'due_date', v_due,
      'status', 'identified', 'requirement_id', v_req_id));

  return jsonb_build_object('interface_id', v_id, 'case_id', c.id,
    'interfaceRef', v_ref, 'interfaceType', v_type,
    'traversalKind', sync_interface_traversal_kind(v_type),
    'dueDateStated', v_due is not null,
    'graphNode', v_source_asset is not null and v_target_asset is not null,
    'note', case when v_due is null
      then 'Recorded with no required-by date. An interface with no date cannot be overdue, which means it will never appear on the list of things that are late — state one when it is known.'
      else 'Recorded. It becomes overdue on the day after its required-by date unless it is delivered or closed.' end);
end
$$;

revoke all on function public.record_case_interface(uuid, jsonb) from public, anon;
grant execute on function public.record_case_interface(uuid, jsonb) to authenticated, service_role;

comment on function public.record_case_interface(uuid, jsonb) is
  'D4.18 / spec III.§19: records a typed, owned, dated interface on a development case. The owner is mandatory and human; the two endpoints must differ; the asset ids, where given, are what let the interface join the shared dependency graph.';

create or replace function public.set_case_interface_status(
  p_interface_id bigint,
  p_status text,
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
  i case_interfaces%rowtype;
  v_status text := nullif(btrim(coalesce(p_status,'')), '');
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'moving an interface requires a planning, engineering or governance role');
  end if;
  select * into i from case_interfaces where id = p_interface_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'interface not found');
  end if;
  if v_status is null or not (v_status = any (sync_interface_statuses())) then
    return jsonb_build_object('error',
      format('status must be one of: %s', array_to_string(sync_interface_statuses(), ', ')));
  end if;
  if v_status = i.status then
    return jsonb_build_object('error',
      format('this interface is already %s', v_status));
  end if;
  -- A terminal state and a dispute both demand a note: "delivered" with no
  -- record of what was delivered, and "disputed" with no record of what is in
  -- dispute, are both statuses that cannot be read later.
  if v_status in ('delivered','closed','disputed') and (v_note is null or length(v_note) < 20) then
    return jsonb_build_object('error',
      format('moving an interface to %s requires a note saying what happened (20 characters minimum)', v_status));
  end if;
  -- 5B-R8. REOPENING IS A STATED ACT. Leaving a terminal status silently
  -- clears `closed_at`, so a delivery that is walked back would otherwise leave
  -- no record on the row that it ever happened. The note is what survives.
  if i.status in ('delivered','closed') and (v_note is null or length(v_note) < 20) then
    return jsonb_build_object('error',
      format('this interface is %s, and reopening it clears the date it reached that state. Say what changed (20 characters minimum) — an interface that was delivered and then was not is the thing a reader most needs explained.', i.status));
  end if;

  update case_interfaces set
    status = v_status,
    -- 5B-R8. THE NOTE BELONGS TO THE STATUS THAT PRODUCED IT. `coalesce(v_note,
    -- status_note)` carried a dispute's text forward onto the agreement that
    -- resolved it, so the register rendered `Agreed — "the vendor disputes the
    -- flange rating"` and the audit row recorded the stale sentence as the new
    -- one. A status with no note of its own has no note.
    status_note = v_note,
    closed_at = case when v_status in ('delivered','closed') then coalesce(closed_at, now()) else null end
  where id = i.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_interface_status', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', i.development_case_id, 'interface_id', i.id,
      'interface_ref', i.interface_ref),
    jsonb_build_object('status', i.status, 'status_note', i.status_note,
      'closed_at', i.closed_at),
    jsonb_build_object('status', v_status, 'status_note', v_note,
      'closed_at', case when v_status in ('delivered','closed') then coalesce(i.closed_at, now()) else null end));

  return jsonb_build_object('interface_id', i.id, 'status', v_status,
    'previousStatus', i.status,
    'stillOverdue', v_status not in ('delivered','closed')
                    and i.due_date is not null and i.due_date < current_date);
end
$$;

revoke all on function public.set_case_interface_status(bigint, text, text) from public, anon;
grant execute on function public.set_case_interface_status(bigint, text, text) to authenticated, service_role;

comment on function public.set_case_interface_status(bigint, text, text) is
  'D4.18 ruling 3: moves an interface through identified → agreed → disputed → delivered → closed. A terminal state or a dispute demands a note; overdue is never written, only derived.';

-- ---------------------------------------------------------------------------
-- 3. THE SHARED GRAPH (ruling 1). One payload, in the shape
--    src/lib/interdependency already traverses, carrying BOTH the interface
--    edges and the asset_dependencies edges among the assets they touch.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_interface_graph(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_interfaces jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_asset_edges jsonb;
  v_total int;
  v_overdue int;
  v_open int;
  v_unowned_dates int;
  v_asset_ids uuid[];
  v_refused boolean := false;
  v_refusal text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'interfaceRef', i.interface_ref,
      'sourceObject', i.source_object,
      'targetObject', i.target_object,
      'sourceAssetId', i.source_asset_id,
      'targetAssetId', i.target_asset_id,
      'interfaceType', i.interface_type,
      'traversalKind', sync_interface_traversal_kind(i.interface_type),
      'ownerId', i.owner_id,
      'owner', coalesce(u.full_name, u.email, i.owner_id::text),
      'requirement', i.requirement,
      'requirementId', i.requirement_id,
      'requirementRef', d.requirement_ref,
      'dueDate', i.due_date,
      'status', i.status,
      'statusNote', i.status_note,
      -- DERIVED, never stored (ruling 3).
      'overdue', i.due_date is not null and i.due_date < current_date
                 and i.status not in ('delivered','closed'),
      'daysLate', case when i.due_date is not null and i.due_date < current_date
                         and i.status not in ('delivered','closed')
                       then (current_date - i.due_date) else null end)
      order by (i.due_date is null), i.due_date, i.interface_ref), '[]'::jsonb),
    count(*)::int,
    count(*) filter (where i.due_date is not null and i.due_date < current_date
                       and i.status not in ('delivered','closed'))::int,
    count(*) filter (where i.status not in ('delivered','closed'))::int,
    count(*) filter (where i.due_date is null and i.status not in ('delivered','closed'))::int
    into v_interfaces, v_total, v_overdue, v_open, v_unowned_dates
  from case_interfaces i
  left join user_profiles u on u.id = i.owner_id and u.organization_id = v_org
  left join design_requirements d on d.id = i.requirement_id
  where i.organization_id = v_org and i.development_case_id = c.id;

  -- The set of assets the interfaces touch, resolved BEFORE the node list so
  -- the node list can span both edge sources (see below).
  select array_agg(distinct x) into v_asset_ids
    from (
      select i.source_asset_id x from case_interfaces i
       where i.organization_id = v_org and i.development_case_id = c.id
         and i.source_asset_id is not null
      union
      select i.target_asset_id from case_interfaces i
       where i.organization_id = v_org and i.development_case_id = c.id
         and i.target_asset_id is not null) s;

  -- The node set: every interface endpoint, PLUS both ends of every asset
  -- dependency this graph carries. An endpoint with an asset id uses THAT id,
  -- so an interface edge and an asset_dependencies edge touching the same
  -- equipment meet at one node instead of two.
  --
  -- WHY THE SECOND HALF EXISTS. The asset edges below are selected on either
  -- endpoint matching an interface asset, so their FAR endpoint is very often
  -- an asset no interface names. Emitting those edges while omitting their far
  -- node left the client's `index()` to back-fill `{id, name: id}` — a real
  -- asset presented to the customer as a bare UUID, and, substantively, a node
  -- with NO criticality and NO service name. `singlePointsOfFailure` reads both
  -- of those, so its `underrated` flag (its stated point: a low-criticality
  -- asset that takes a lot with it) and `servicesLost` could never fire across
  -- the interface→asset join — which is the whole join D4.18 exists to enable.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', n.node_id, 'name', n.node_name, 'tag', n.node_tag,
           'criticality', n.criticality)), '[]'::jsonb)
    into v_nodes
  from (
    select coalesce(i.source_asset_id::text, 'obj:' || i.source_object) node_id,
           coalesce(a.name, i.source_object) node_name,
           a.asset_tag node_tag, a.criticality
      from case_interfaces i
      left join assets a on a.id = i.source_asset_id
     where i.organization_id = v_org and i.development_case_id = c.id
    union
    select coalesce(i.target_asset_id::text, 'obj:' || i.target_object),
           coalesce(a.name, i.target_object), a.asset_tag, a.criticality
      from case_interfaces i
      left join assets a on a.id = i.target_asset_id
     where i.organization_id = v_org and i.development_case_id = c.id
    union
    select a.id::text, a.name, a.asset_tag, a.criticality
      from asset_dependencies ad
      join assets a on a.id in (ad.dependent_asset_id, ad.supplier_asset_id)
     where ad.organization_id = v_org
       and a.organization_id = v_org
       and v_asset_ids is not null
       and (ad.dependent_asset_id = any (v_asset_ids)
            or ad.supplier_asset_id = any (v_asset_ids))) n;

  -- Ruling 2: the TARGET depends on the SOURCE.
  select coalesce(jsonb_agg(jsonb_build_object(
           'dependent', coalesce(i.target_asset_id::text, 'obj:' || i.target_object),
           'supplier', coalesce(i.source_asset_id::text, 'obj:' || i.source_object),
           'kind', sync_interface_traversal_kind(i.interface_type),
           'interfaceType', i.interface_type,
           'interfaceId', i.id,
           'source', 'interface',
           'evidence', i.interface_ref || ': ' || i.requirement)
           order by i.interface_ref), '[]'::jsonb)
    into v_edges
  from case_interfaces i
  where i.organization_id = v_org and i.development_case_id = c.id
    and i.status not in ('closed');

  -- ...and the ASSET edges among the assets those interfaces touch, so the ONE
  -- traversal spans both row sources. This is the whole of ruling 1: there is
  -- no second graph, there is one graph with two kinds of edge in it.
  -- `v_asset_ids` was resolved above the node set, because the node set needs
  -- it too: every node these edges reach has to be a real node.
  select coalesce(jsonb_agg(jsonb_build_object(
           'dependent', ad.dependent_asset_id::text,
           'supplier', ad.supplier_asset_id::text,
           'kind', ad.dependency_kind,
           'redundancyGroup', ad.redundancy_group,
           'minRequired', ad.min_suppliers_required,
           'capacitySharePct', ad.capacity_share_pct,
           'source', 'asset_dependency',
           'evidence', ad.evidence)), '[]'::jsonb)
    into v_asset_edges
  from asset_dependencies ad
  where ad.organization_id = v_org
    and v_asset_ids is not null
    and (ad.dependent_asset_id = any (v_asset_ids)
         or ad.supplier_asset_id = any (v_asset_ids));

  if v_total = 0 then
    v_refused := true;
    v_refusal :=
      'No interfaces are recorded on this case. On a brownfield project that is almost never true — it means nobody has written the tie-ins down, not that there are none. An empty interface register produces a clean traversal for the same reason an unmapped plant produces no single points of failure (spec III.§19: "critical brownfield").';
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', v_refused,
    'refusal', v_refusal,
    'interfaces', v_interfaces,
    'interfaceTypes', to_jsonb(sync_interface_types()),
    'statuses', to_jsonb(sync_interface_statuses()),
    'total', v_total,
    'openCount', case when v_refused then null else v_open end,
    'overdueCount', case when v_refused then null else v_overdue end,
    'openWithoutDueDate', case when v_refused then null else v_unowned_dates end,
    -- The payload the SHARED traversal consumes. Same shape as the asset
    -- interdependency graph, deliberately: propagateLoss and
    -- singlePointsOfFailure read it unchanged.
    'graph', jsonb_build_object(
      'nodes', v_nodes,
      'edges', coalesce(v_edges, '[]'::jsonb) || coalesce(v_asset_edges, '[]'::jsonb),
      'commonCauseGroups', '[]'::jsonb),
    'assetEdgeCount', jsonb_array_length(coalesce(v_asset_edges, '[]'::jsonb)),
    'interfaceEdgeCount', jsonb_array_length(coalesce(v_edges, '[]'::jsonb)),
    'note', 'The graph carries the interface edges AND the recorded asset dependencies among every asset those interfaces touch, in one node space, so the shared traversal answers "what else stops" across both. A closed interface is not an edge: the boundary has been dealt with.');
end
$$;

revoke all on function public.get_case_interface_graph(uuid) from public, anon;
grant execute on function public.get_case_interface_graph(uuid) to authenticated, service_role;

comment on function public.get_case_interface_graph(uuid) is
  'D4.18 / spec III.§19: the case''s interfaces with derived overdue flags, and ONE dependency graph containing both the interface edges and the asset_dependencies edges among the assets they touch — the shape src/lib/interdependency traverses unchanged. REFUSES over an empty register rather than presenting a clean traversal of nothing.';

notify pgrst, 'reload schema';
