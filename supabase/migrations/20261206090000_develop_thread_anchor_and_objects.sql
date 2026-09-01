-- ============================================================================
-- Sync Develop Slice 5C — the digital thread, part 1:
--   D11.19  the Asset as the thread's ONE anchor (spec III.§26)
--   D11.05  the Common Data Environment link model (spec II.2)
--
-- II.2 verbatim: "Every project object in one traceable thread: Requirement →
-- Tag → Equipment specification → Vendor document → Drawing → Procurement item
-- → Installed equipment → Commissioning test → SAP equipment → Operating
-- history. Sync knows: current authoritative version, what changed, what
-- downstream object is affected, has the operating system received the
-- change."
--
-- §26 verbatim: "Asset: id, enterprise_asset_id, tag, functional_location,
-- type, manufacturer, model, serial_number, criticality, lifecycle_status.
-- DesignObject → ProcuredEquipment → InstalledAsset → SAP Equipment: the
-- digital thread must never break."
--
-- ── RULING 5C-R1 — ONE CHAIN, NOT TWO ────────────────────────────────────────
--
-- II.2 states a ten-hop chain and §26 states a four-hop one. They are NOT two
-- chains: §26's is a SUBSEQUENCE of II.2's under different names.
--
--     §26 DesignObject     = II.2 equipment specification
--     §26 ProcuredEquipment = II.2 procurement item
--     §26 InstalledAsset    = II.2 installed equipment
--     §26 SAP Equipment     = II.2 "SAP equipment"
--
-- So there is ONE ordered vocabulary, `sync_thread_object_kinds()`, ten kinds
-- in II.2's order, and `sync_thread_chain_position()` is the only place that
-- order is written down. Two orderings of one chain is the two-answers failure
-- AGENTS.md invariant 1 forbids, arriving through a synonym instead of a
-- table.
--
-- The last kind is `eam_equipment`, NOT `sap_equipment`. Naming a column after
-- one vendor's product is how a product quietly assumes that vendor: this
-- repository already carries SAP, Maximo and generic-CMMS connectors, and a
-- customer on Maximo would have to write their equipment number into a column
-- called `sap_`. The specification's word is quoted in this header and in the
-- read's own note so the mapping is visible rather than lost.
--
-- ── RULING 5C-R2 — WHAT "ANCHORED" MEANS, AND WHY IT IS NOT NULL ─────────────
--
-- D11.20 has to enforce something exact, so D11.19 has to define something
-- exact. It is this:
--
--     A thread object is ANCHORED when it names exactly one row of `assets` —
--     the ONE canonical asset hierarchy (AGENTS invariant 1, C2.01) — in its
--     own organization.
--
-- `anchor_asset_id` is therefore NOT NULL. That is a real constraint with a
-- real cost, and the cost is stated rather than hidden: a requirement written
-- at concept stage, before anybody knows what equipment it lands on, CANNOT be
-- registered in the CDE. That is deliberate. A "thread object" with no asset
-- is not a thread object — it is a requirement, and it already has a canonical
-- home (`design_requirements`) that represents it perfectly well. Registering
-- it in the thread with a null anchor would make "the thread must never break"
-- unenforceable on the day it shipped, because the commonest object in it
-- would be allowed to hang from nothing.
--
-- The honest consequence is REPORTED, not hidden: `check_thread_continuity`
-- (20261206090200) counts the case's requirements that are NOT registered in
-- the CDE and reports them as a `requirements_outside_cde` gap.
-- An unregistered requirement is visible as unregistered; it is never counted
-- as threaded.
--
-- NO SECOND ASSET TABLE. The overlap map's D11.19 verdict is "REUSE the
-- hierarchy — no second asset table, ever." §26's two missing fields
-- (`enterprise_asset_id`, `functional_location`) are COLUMNS on `assets`.
-- Every other §26 field is already there.
--
-- ── RULING 5C-R3 — THE LINK RUNS FORWARD, AND THE TYPE NAMES THE HOP ─────────
--
-- A CDE link is directed: upstream → downstream, where downstream sits LATER
-- in the chain. Enforced, for every writer, on INSERT and on UPDATE. This is
-- the same convention 20261205090200 ruling 2 states for interfaces and for
-- the same reason: a graph that admits backward edges produces a cascade that
-- runs backwards, and a cascade that runs backwards is worse than none.
--
-- A link may SKIP positions (not every asset has a vendor document). A skip is
-- legal and is DERIVED as a gap on read — it is never silently normalised into
-- an adjacency. The distinction that matters, and it is the whole of D11.20:
--
--     CONTINUOUS ≠ COMPLETE.
--
-- The invariant is that a link, once made, cannot be quietly unmade and an
-- object cannot quietly lose its anchor. It is NOT that every asset must carry
-- all ten kinds. Enforcing completeness would either make the object
-- unusable or, far worse, invite the operator to fabricate a vendor document
-- to satisfy a constraint.
--
-- ── RULING 5C-R4 — THE SEVERANCE LEDGER LANDS HERE, WITH THE OBJECTS ─────────
--
-- `thread_severances` is D11.20's ledger and its rulings live in
-- 20261206090200. It is CREATED here because the walls that refuse a silent
-- deletion must ship in the same migration as the tables they protect — a
-- table that exists for one migration with a DELETE route and no wall is a
-- window, and windows in this repository have been used. The ledger is the
-- only thing those walls can record into, so it goes first.
--
-- ── RULING 5C-R5 — REGISTERING IS NOT COPYING ───────────────────────────────
--
-- Three of the ten kinds have canonical homes already: `requirement` →
-- design_requirements, `commissioning_test` → acceptance_tests,
-- `installed_equipment` → assets. For those kinds the thread object carries a
-- REAL foreign key to the canonical row and the write path REQUIRES it. It
-- does not copy the row's content: `title` is a label for the reader, and
-- everything else is read through the FK. A thread object that duplicated a
-- requirement's text would be a second requirement store, which the overlap
-- map forbids by name.
--
-- The other seven kinds have NO canonical home in this repository today (there
-- is no drawing register, no vendor-document store, no procurement-item
-- table). They are registered BY REFERENCE — object_ref plus title — and
-- `sync_thread_object_canonical_home()` says so, per kind, in the read. A
-- reference-registered object is honest about being a reference: it is not
-- presented as a document the product holds.
--
-- Canonical reuse: assets, development_cases, design_requirements,
-- acceptance_tests, audit_events, security_events, app_current_org(),
-- record_frontline_service_write, sync_text_as_uuid/int.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. D11.19 — §26's two missing Asset fields, on the ONE asset table.
-- ---------------------------------------------------------------------------
alter table public.assets
  add column if not exists enterprise_asset_id text,
  add column if not exists functional_location text;

-- One enterprise id per organization. PARTIAL, because the overwhelming
-- majority of rows will never have one and a plain unique index would collapse
-- every null-free tenant into a single-row table.
create unique index if not exists idx_assets_enterprise_asset_id
  on public.assets(organization_id, enterprise_asset_id)
  where enterprise_asset_id is not null;

create index if not exists idx_assets_functional_location
  on public.assets(organization_id, functional_location)
  where functional_location is not null;

comment on column public.assets.enterprise_asset_id is
  'D11.19 / spec §26: the identifier this asset carries in the enterprise system of record (SAP, Maximo, or another EAM). Populated from project delivery through set_asset_enterprise_identity. Unique per organization where present — two assets claiming one EAM number is the defect the index exists to refuse.';
comment on column public.assets.functional_location is
  'D11.19 / spec §26: the functional-location string this asset occupies in the enterprise hierarchy. A LABEL on the ONE canonical hierarchy, never a second hierarchy — the structural parentage stays site → asset → component.';

-- ---------------------------------------------------------------------------
-- 2. The ONE chain vocabulary (ruling 5C-R1). Written down once, server-side.
-- ---------------------------------------------------------------------------
create or replace function public.sync_thread_object_kinds()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'requirement',
    'tag',
    'equipment_specification',
    'vendor_document',
    'drawing',
    'procurement_item',
    'installed_equipment',
    'commissioning_test',
    'eam_equipment',
    'operating_history']::text[];
$$;

comment on function public.sync_thread_object_kinds() is
  'D11.05 / spec II.2: the ten digital-thread object kinds, in the specification''s order. §26''s four-hop DesignObject → ProcuredEquipment → InstalledAsset → SAP Equipment is a SUBSEQUENCE of this one chain (ruling 5C-R1), not a second one. `eam_equipment` is II.2''s "SAP equipment" under a vendor-neutral name.';

create or replace function public.sync_thread_chain_position(p_kind text)
returns int
language sql
immutable
set search_path = public
as $$
  -- WITH ORDINALITY, never a window numbering over an unordered scan. The
  -- window form happens to produce array order today and is not guaranteed to;
  -- being wrong here would silently reverse hops rather than fail, and a
  -- reversed hop is the one defect this whole file is built to make
  -- impossible.
  select p::int from unnest(sync_thread_object_kinds()) with ordinality as m(k, p)
   where m.k = p_kind;
$$;

comment on function public.sync_thread_chain_position(text) is
  'D11.05 ruling 5C-R3: the kind''s position in the ONE chain. The only place the order is written down, so a link''s direction and a thread gap are both computed from one source. NULL for a kind outside the vocabulary — callers treat that as a refusal, never as position zero.';

-- The §26 subsequence, named so the mapping in ruling 5C-R1 is data a reader
-- can check rather than a claim in a comment.
create or replace function public.sync_thread_spec26_chain()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'equipment_specification',  -- §26 DesignObject
    'procurement_item',         -- §26 ProcuredEquipment
    'installed_equipment',      -- §26 InstalledAsset
    'eam_equipment']::text[];   -- §26 "SAP Equipment"
$$;

comment on function public.sync_thread_spec26_chain() is
  'D11.19 / spec §26: "DesignObject → ProcuredEquipment → InstalledAsset → SAP Equipment: the digital thread must never break", expressed as the subsequence of sync_thread_object_kinds() it actually is (ruling 5C-R1).';

create or replace function public.sync_thread_link_types()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'identifies',  -- a requirement or a tag names the thing downstream
    'specifies',   -- §34 Requirement IMPLEMENTED_BY DesignObject
    'documents',   -- a specification is documented by vendor data
    'depicts',     -- a drawing depicts what the document describes
    'procures',    -- a specification or drawing becomes a purchase
    'becomes',     -- §34 DesignObject BECOMES Asset
    'verifies',    -- §34 Requirement VERIFIED_BY Verification, on the thread
    'registers',   -- installed equipment enters the enterprise system
    'records']::text[];  -- the operating history the enterprise system accrues
$$;

comment on function public.sync_thread_link_types() is
  'D11.05: the named forward hops of the CDE link model. A type NAMES a hop; it never licenses a backward edge — direction is decided by sync_thread_chain_position alone (ruling 5C-R3).';

-- Every CDE link is also an edge in the ONE dependency graph the rest of the
-- product traverses. This is the same device 20261205090200 uses for the seven
-- §19 interface types, for the same reason: one traversal, not two.
create or replace function public.sync_thread_traversal_kind(p_link_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select k from (values
    ('identifies', 'functional'),
    ('specifies',  'functional'),
    ('documents',  'logistical'),
    ('depicts',    'logistical'),
    ('procures',   'logistical'),
    ('becomes',    'functional'),
    ('verifies',   'control'),
    ('registers',  'control'),
    ('records',    'control')
  ) as m(t, k) where t = p_link_type;
$$;

comment on function public.sync_thread_traversal_kind(text) is
  'D11.05/D11.21: maps each CDE link type onto one of asset_dependencies'' six dependency kinds, so thread edges and asset edges traverse the SAME graph (propagateLoss / singlePointsOfFailure) instead of getting a second traversal. Echoed on every edge the read emits — a stated judgement, not a hidden one.';

-- Ruling 5C-R5, as data: which kinds have a canonical row behind them and
-- which are registered by reference only.
create or replace function public.sync_thread_object_canonical_home(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select h from (values
    ('requirement',             'design_requirements'),
    ('tag',                     'none — registered by reference'),
    ('equipment_specification', 'none — registered by reference'),
    ('vendor_document',         'none — registered by reference'),
    ('drawing',                 'none — registered by reference'),
    ('procurement_item',        'none — registered by reference'),
    ('installed_equipment',     'assets'),
    ('commissioning_test',      'acceptance_tests'),
    ('eam_equipment',           'none — registered by reference'),
    ('operating_history',       'none — registered by reference')
  ) as m(k, h) where k = p_kind;
$$;

comment on function public.sync_thread_object_canonical_home(text) is
  'D11.05 ruling 5C-R5: the canonical table behind each thread-object kind, or the literal statement that there is none and the object is registered by reference. Reported on every object the read emits, so a reference-registered drawing is never presented as a drawing the product holds.';

revoke all on function public.sync_thread_object_kinds() from public, anon;
revoke all on function public.sync_thread_chain_position(text) from public, anon;
revoke all on function public.sync_thread_spec26_chain() from public, anon;
revoke all on function public.sync_thread_link_types() from public, anon;
revoke all on function public.sync_thread_traversal_kind(text) from public, anon;
revoke all on function public.sync_thread_object_canonical_home(text) from public, anon;
grant execute on function public.sync_thread_object_kinds() to authenticated, service_role;
grant execute on function public.sync_thread_chain_position(text) to authenticated, service_role;
grant execute on function public.sync_thread_spec26_chain() to authenticated, service_role;
grant execute on function public.sync_thread_link_types() to authenticated, service_role;
grant execute on function public.sync_thread_traversal_kind(text) to authenticated, service_role;
grant execute on function public.sync_thread_object_canonical_home(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE SEVERANCE LEDGER (ruling 5C-R4; the rulings are in 20261206090200).
--
--    It carries SNAPSHOTS, not foreign keys, to the rows it records the loss
--    of. A ledger whose rows vanish with their subject is not a ledger — the
--    one row you would go looking for after a cascade is exactly the one an
--    `on delete cascade` would take with it.
-- ---------------------------------------------------------------------------
create table if not exists public.thread_severances (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Deliberately NOT a foreign key: the case may be the thing being deleted.
  development_case_id uuid,
  -- How the thread lost this piece.
  route text not null check (route in (
    'object_retired',     -- a stated human act: this object is out of the thread
    'link_severed',       -- a stated human act: this hop no longer holds
    'object_reanchored',  -- the object moved to a different asset
    'case_cascade',       -- the development case was deleted
    'asset_cascade',      -- the anchoring asset was deleted
    'canonical_cascade')), -- the canonical row this object registers was deleted
  subject_kind text not null check (subject_kind in ('thread_object', 'thread_link')),
  subject_ref text not null,
  -- Everything the vanished row said, kept as text so nothing here depends on
  -- a row that may already be gone.
  subject_snapshot jsonb not null default '{}'::jsonb,
  -- How much of the thread this took with it, counted at the moment it went.
  links_severed int not null default 0 check (links_severed >= 0),
  reason text not null check (length(btrim(reason)) >= 20),
  severed_by uuid references auth.users(id),
  severed_at timestamptz not null default now()
);

create index if not exists idx_thread_severance_org
  on thread_severances(organization_id, severed_at desc);
create index if not exists idx_thread_severance_case
  on thread_severances(organization_id, development_case_id, severed_at desc)
  where development_case_id is not null;

alter table public.thread_severances enable row level security;
drop policy if exists thread_severances_read on public.thread_severances;
create policy thread_severances_read on public.thread_severances
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: the ledger is written by the definer paths and the
-- walls, never by a client.

comment on table public.thread_severances is
  'D11.20: every place the digital thread was allowed to come apart, and why. Five routes, three of them acts a person took and two of them genuine cascades. Append-only for every caller; TRUNCATE revoked and refused by a statement trigger. Carries SNAPSHOTS rather than foreign keys, because the row it records the loss of is usually already gone.';

create or replace function public.enforce_thread_severance_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'thread_severances is the record of every time the digital thread was allowed to come apart. Truncating it erases all of them in one statement, which is the single act that would make "the thread never broke silently" true by deletion. The table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception
      'A severance record is not editable. What was severed, why, and by whom are the facts a later reader has instead of the rows themselves — a correction is a NEW record, never a rewrite of the old one.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    -- MID-CASCADE ESCAPE: the organization itself is going. Nothing survives
    -- to read this ledger, so refusing here would only make a tenant
    -- undeletable.
    if not exists (select 1 from organizations where id = old.organization_id) then
      return old;
    end if;
    raise exception
      'A severance record is not deleted. Deleting it makes a thread somebody cut indistinguishable from one that was never joined.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ── INSERT. THE LEDGER'S OWN DOOR. ──────────────────────────────────────
  -- The append-only guard above is what makes a forged row PERMANENT: a wrong
  -- severance naming a real engineer cannot be corrected or deleted by anyone.
  -- So the forgery has to be refused on the way in, not regretted afterwards.
  --
  -- `record_thread_severance` is the one sanctioned insert site and it sets a
  -- transaction-local marker. A direct `insert into thread_severances` — the
  -- service-key path the rest of this slice walls off everywhere else — has no
  -- marker and is refused here.
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.thread_severance_write', true), '') <> 'granted' then
      raise exception
        'A severance is recorded through record_thread_severance, which the walls and the RPCs share as their ONE insert site. A row inserted directly names a person as having cut the thread, and the append-only guard on this table then makes that permanently uncorrectable — so it is refused here rather than regretted later.'
        using errcode = 'insufficient_privilege';
    end if;
    -- The person named must be a member of the tenant whose ledger this is.
    -- Naming somebody else's engineer would put a name nobody in this
    -- organization can question against a cut nobody in it made.
    if new.severed_by is not null
       and not exists (select 1 from user_profiles p
                        where p.id = new.severed_by
                          and p.organization_id = new.organization_id) then
      raise exception
        'The person named on a severance belongs to the organization whose thread was cut. A name from another tenant is a name this one cannot ask about.'
        using errcode = 'check_violation';
    end if;
    -- PROVENANCE BACKSTOP, on the ADMITTED path only (4D-R33).
    if auth.uid() is null then
      perform record_frontline_service_write(new.organization_id,
        format('Thread severance (%s) on %s', new.route, new.subject_ref),
        tg_op,
        'A severance recorded with no auth.uid() behind it is a break in the digital thread attributed to nobody. The ledger row is append-only, so this security event is the only place the circumstances of the write survive.');
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_thread_severance_append_only()
  from public, anon, authenticated;

drop trigger if exists trg_thread_severance_append_only on public.thread_severances;
create trigger trg_thread_severance_append_only
  before insert or update or delete on public.thread_severances
  for each row execute function public.enforce_thread_severance_append_only();

-- WHY NO §70 TRIGGER ON THIS TABLE, when every other actor column in the slice
-- carries one. `severed_by` here is not a column a judgement is recorded in —
-- it is a copy of whoever held the session when a row went, and on the two
-- cascade routes that is simply the person who deleted a case or an asset.
-- Binding §70 to it would make a development case UNDELETABLE by the
-- AI-operator identity, raising an error about severing the digital thread at
-- a caller who deleted a project. The three acts §70 actually governs —
-- sever_thread_link, retire_thread_object, reanchor_thread_object — each
-- refuse that identity at their own door and at the wall on the object's and
-- the link's own actor columns, which is where the judgement lives.

drop trigger if exists trg_thread_severance_no_truncate on public.thread_severances;
create trigger trg_thread_severance_no_truncate
  before truncate on public.thread_severances
  for each statement execute function public.enforce_thread_severance_append_only();

revoke truncate on table public.thread_severances from anon, authenticated, service_role;

-- The one writer. SECURITY DEFINER so the walls (which run as the table owner)
-- and the RPCs share exactly one insert site.
create or replace function public.record_thread_severance(
  p_org uuid,
  p_case_id uuid,
  p_route text,
  p_subject_kind text,
  p_subject_ref text,
  p_snapshot jsonb,
  p_links_severed int,
  p_reason text,
  p_actor uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_org is null or not exists (select 1 from organizations where id = p_org) then
    -- The tenant is going. There is nothing left to read a ledger, and a row
    -- referencing a vanished organization cannot be inserted anyway.
    return null;
  end if;
  -- The sanctioned write. Transaction-local: it cannot outlive this statement,
  -- and the INSERT wall on thread_severances refuses a row that arrives
  -- without it.
  perform set_config('app.thread_severance_write', 'granted', true);
  insert into thread_severances (organization_id, development_case_id, route,
    subject_kind, subject_ref, subject_snapshot, links_severed, reason, severed_by)
  values (p_org, p_case_id, p_route, p_subject_kind, p_subject_ref,
    coalesce(p_snapshot, '{}'::jsonb), greatest(coalesce(p_links_severed, 0), 0),
    p_reason, p_actor)
  returning id into v_id;
  perform set_config('app.thread_severance_write', '', true);
  return v_id;
end
$$;

-- service_role is revoked EXPLICITLY. Supabase's default privileges already
-- granted it, and revoking from public/anon/authenticated does not remove an
-- explicit role grant — so without this line the stated ACL and the real one
-- differ, and a service key can write this tenant's severance ledger naming
-- any person it likes (20261130090500 / 20261130090600 record the same trap).
revoke all on function public.record_thread_severance(uuid, uuid, text, text, text, jsonb, int, text, uuid)
  from public, anon, authenticated, service_role;

comment on function public.record_thread_severance(uuid, uuid, text, text, text, jsonb, int, text, uuid) is
  'D11.20: the ONE insert site for thread_severances, shared by the walls and the RPCs. Sets the transaction-local marker the INSERT wall demands, so a direct insert into the ledger is refused rather than permanently uncorrectable. Returns null (records nothing) when the organization itself is being deleted — a tenant cascade has no reader left, and the row could not be inserted against a vanished FK in any case.';

-- ---------------------------------------------------------------------------
-- 3b. WHAT ELSE A CASCADE DESTROYS.
--
--     A cascade that takes a thread object also takes its recorded revisions
--     and — the one that matters — its UNANSWERED change receipts: spec II.2's
--     "has the operating system received the change" with the answer still
--     missing, gone with nothing counting it. The ledger snapshot carries both
--     numbers so the loss is a figure somebody can read afterwards.
--
--     It is a separate function on purpose. `thread_object_versions` and
--     `thread_change_receipts` are created by 20261206090100 and
--     20261206090300; a wall defined HERE that named them directly would be a
--     forward reference resolved only at run time — harmless on the day the
--     four files run together, a hard error the first time a case is deleted
--     against a half-applied slice. So the walls call this, and
--     20261206090300 replaces its body once both tables exist.
-- ---------------------------------------------------------------------------
create or replace function public.sync_thread_object_cascade_losses(p_object_id bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'versions_lost', null::int,
    'unacknowledged_receipts_lost', null::int,
    'lossesCounted', false);
$$;

revoke all on function public.sync_thread_object_cascade_losses(bigint)
  from public, anon, authenticated, service_role;

comment on function public.sync_thread_object_cascade_losses(bigint) is
  'D11.20: the versions and unanswered change receipts a cascade takes along with a thread object, for the severance snapshot. Placeholder body here (the two tables arrive in later files of this slice); 20261206090300 replaces it with the real counts. Reports NULL rather than 0 while unreplaced — "0 receipts lost" from a function that cannot see the receipts table is the plausible zero this slice exists to refuse.';

-- ---------------------------------------------------------------------------
-- 4. D11.05 — the thread object.
-- ---------------------------------------------------------------------------
create table if not exists public.thread_objects (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  object_kind text not null check (object_kind = any (sync_thread_object_kinds())),
  -- The reference the rest of the project cites: a tag number, a drawing
  -- number, a PO line, a requirement ref.
  object_ref text not null check (btrim(object_ref) <> ''),
  title text not null check (length(btrim(title)) >= 3),
  -- RULING 5C-R2. THE ANCHOR. Not null, in-tenant, and enforced.
  anchor_asset_id uuid not null references assets(id) on delete cascade,
  -- Ruling 5C-R5: the canonical row, for the three kinds that have one.
  requirement_id bigint references design_requirements(id) on delete cascade,
  commissioning_test_id bigint references acceptance_tests(id) on delete cascade,
  status text not null default 'live' check (status in ('live', 'retired')),
  retired_reason text,
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  -- Moving the anchor is severing the object from the asset it hung on, so it
  -- carries a NAMED person the same way a retirement does. These columns exist
  -- so §70 has something to bind to on that act: a transaction marker alone
  -- guards the ROUTE, and a caller that can call set_config is past it. A
  -- column the wall reads is past nothing.
  anchor_moved_by uuid references auth.users(id),
  anchor_moved_at timestamptz,
  registered_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, object_kind, object_ref),
  -- A retired object carries the record of its retirement; a live one does not.
  -- retired_by is required in the same breath as retired_at, and that is not
  -- tidiness: the §70 wall below reads `retired_by`, and
  -- enforce_frontline_judgement_is_human returns early on a NULL actor. Without
  -- this half of the constraint, `status = 'retired', retired_by = null` walks
  -- straight past the wall that exists to keep a machine from cutting the
  -- thread.
  constraint thread_object_retirement check (
    (status = 'retired') = (retired_at is not null)
    and (status = 'retired') = (retired_by is not null)),
  constraint thread_object_retirement_reason check (
    status <> 'retired'
    or (retired_reason is not null and length(btrim(retired_reason)) >= 20)),
  constraint thread_object_anchor_move check (
    (anchor_moved_at is null) = (anchor_moved_by is null)),
  -- Exactly the canonical pointer the kind calls for, and no other. A
  -- `drawing` carrying a requirement_id would be a link wearing a column.
  constraint thread_object_canonical_pointer check (
    (object_kind = 'requirement') = (requirement_id is not null)
    and (object_kind = 'commissioning_test') = (commissioning_test_id is not null))
);

create index if not exists idx_thread_object_case
  on thread_objects(organization_id, development_case_id, object_kind, status);
create index if not exists idx_thread_object_anchor
  on thread_objects(organization_id, anchor_asset_id, status);
create index if not exists idx_thread_object_requirement
  on thread_objects(requirement_id) where requirement_id is not null;

alter table public.thread_objects enable row level security;
drop policy if exists thread_objects_read on public.thread_objects;
create policy thread_objects_read on public.thread_objects
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: objects are registered through the definer RPCs.

comment on table public.thread_objects is
  'D11.05 / spec II.2: one object in the Common Data Environment''s traceable thread, in one of the ten kinds of sync_thread_object_kinds(). ANCHORED (D11.19, ruling 5C-R2): anchor_asset_id is NOT NULL and names a row of the ONE canonical asset hierarchy. Registering is not copying — the three kinds with canonical homes carry a foreign key to them (ruling 5C-R5).';
comment on column public.thread_objects.anchor_asset_id is
  'D11.19 ruling 5C-R2: the ONE asset this thread object hangs from. NOT NULL — an object with no anchor is not a thread object, and admitting one would make D11.20 unenforceable on the day it shipped. Moving it is a recorded act (reanchor_thread_object); losing it is refused.';
comment on column public.thread_objects.status is
  'D11.20: `retired` is the recorded way out of the thread. There is no unrecorded one — DELETE is refused for every caller, service paths included.';

-- ---------------------------------------------------------------------------
-- 5. The thread object''s walls: INSERT, UPDATE and DELETE.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_thread_object_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c development_cases%rowtype;
  a assets%rowtype;
  v_links int;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'thread_objects is the register of every object the digital thread hangs together. Truncating it severs every link in one statement with nothing recorded; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE ESCAPE. development_case_id, anchor_asset_id and the two
    -- canonical pointers are all cascading FKs, so an ancestor delete arrives
    -- here as a DELETE against a parent that may already be gone. Refusing
    -- would make a case (or a tenant) undeletable; permitting silently would
    -- be the break this file exists to prevent. So: permit, and RECORD.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      select count(*) into v_links from thread_links
        where upstream_object_id = old.id or downstream_object_id = old.id;
      perform record_thread_severance(old.organization_id, old.development_case_id,
        'case_cascade', 'thread_object',
        old.object_kind || ' ' || old.object_ref,
        jsonb_build_object('object_kind', old.object_kind, 'object_ref', old.object_ref,
          'title', old.title, 'anchor_asset_id', old.anchor_asset_id,
          'status', old.status)
          || sync_thread_object_cascade_losses(old.id),
        v_links,
        'The development case this thread object belonged to was deleted, so the object and every link touching it went with it. This is a permitted cascade, recorded because a cascade nobody can see afterwards is indistinguishable from a thread that was never joined. links_severed counts the links still present when this row went — a cascade may have removed some of them first, so treat it as a floor, not a total.',
        auth.uid());
      return old;
    end if;
    -- The anchoring asset is going and the case is not: the asset wall below
    -- decides whether that is allowed. If it let the delete through, it has
    -- already recorded it — one ledger row per affected case.
    if not exists (select 1 from assets where id = old.anchor_asset_id) then
      return old;
    end if;
    -- THE CANONICAL ROW IS GOING (the fifth cascade route). `requirement_id`
    -- and `commissioning_test_id` cascade from design_requirements and
    -- acceptance_tests, which themselves cascade from capital_projects. Without
    -- this branch the refusal below fires mid-cascade with the case, the
    -- organization and the anchor all still present — which does not protect
    -- anything, it just makes a capital project undeletable and reports the
    -- reason as a sentence about digital-thread objects the operator never
    -- touched. Permitted, and RECORDED, exactly like the other two cascades.
    if (old.requirement_id is not null
        and not exists (select 1 from design_requirements where id = old.requirement_id))
       or (old.commissioning_test_id is not null
        and not exists (select 1 from acceptance_tests where id = old.commissioning_test_id)) then
      select count(*) into v_links from thread_links
        where upstream_object_id = old.id or downstream_object_id = old.id;
      perform record_thread_severance(old.organization_id, old.development_case_id,
        'canonical_cascade', 'thread_object',
        old.object_kind || ' ' || old.object_ref,
        jsonb_build_object('object_kind', old.object_kind, 'object_ref', old.object_ref,
          'title', old.title, 'anchor_asset_id', old.anchor_asset_id,
          'status', old.status, 'requirement_id', old.requirement_id,
          'commissioning_test_id', old.commissioning_test_id)
          || sync_thread_object_cascade_losses(old.id),
        v_links,
        'The canonical row this thread object registered — its requirement or its acceptance test — was deleted, so the CDE entry pointing at it went too. Registering is not copying (ruling 5C-R5): when the row a thread object IS disappears, the object cannot outlive it. Permitted, and recorded here because the thread lost an object and nothing else would say so.',
        auth.uid());
      return old;
    end if;
    raise exception
      'A thread object is not deleted. One that is out of the thread is RETIRED with a stated reason (retire_thread_object), which records what it severed. Deleting it makes an object somebody removed indistinguishable from one that was never registered — the exact failure spec §26 calls "the digital thread must never break".'
      using errcode = 'insufficient_privilege';
  end if;

  -- MID-CASCADE UPDATE ESCAPE: nothing below can be validated against parents
  -- that are already gone.
  if tg_op = 'UPDATE'
     and not exists (select 1 from development_cases where id = old.development_case_id) then
    return new;
  end if;

  -- Tenancy the foreign keys cannot police, on INSERT and on UPDATE.
  select * into c from development_cases where id = new.development_case_id;
  if not found or c.organization_id <> new.organization_id then
    raise exception
      'That development case belongs to another organization. A thread object is registered inside its own tenant.'
      using errcode = 'check_violation';
  end if;
  select * into a from assets where id = new.anchor_asset_id;
  if not found or a.organization_id <> new.organization_id then
    raise exception
      'The anchoring asset must exist and belong to this organization. An anchor in another tenant is not an anchor — it is a cross-tenant read waiting to happen (D11.19 ruling 5C-R2).'
      using errcode = 'check_violation';
  end if;
  if new.requirement_id is not null
     and not exists (select 1 from design_requirements d
                      where d.id = new.requirement_id
                        and d.organization_id = new.organization_id
                        and d.development_case_id = new.development_case_id) then
    raise exception
      'That requirement is not on this development case. A thread object of kind `requirement` points at the ONE requirement store''s row for THIS case (ruling 5C-R5).'
      using errcode = 'check_violation';
  end if;
  if new.commissioning_test_id is not null
     and not exists (select 1 from acceptance_tests t
                      where t.id = new.commissioning_test_id
                        and t.organization_id = new.organization_id) then
    raise exception
      'That commissioning test belongs to another organization.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    -- WHAT A THREAD OBJECT IS cannot be rewritten by ANY caller. Re-typing a
    -- row would move every link, every version and every receipt onto an
    -- object they were never made for.
    if new.object_kind is distinct from old.object_kind
       or new.object_ref is distinct from old.object_ref
       or new.development_case_id is distinct from old.development_case_id
       or new.organization_id is distinct from old.organization_id
       or new.requirement_id is distinct from old.requirement_id
       or new.commissioning_test_id is distinct from old.commissioning_test_id then
      raise exception
        'What a thread object IS — its kind, its reference, its case and the canonical row behind it — cannot be rewritten by any caller, service paths included. An object that turned out to be a different object is a NEW one.'
        using errcode = 'insufficient_privilege';
    end if;
    -- THE ANCHOR MOVES ONLY THROUGH THE RECORDED ACT (D11.20). Without this,
    -- `update thread_objects set anchor_asset_id = <another asset>` is a
    -- silent severance: every downstream reader now believes the drawing
    -- belongs to a different machine and nothing anywhere says it moved.
    if new.anchor_asset_id is distinct from old.anchor_asset_id
       and coalesce(current_setting('app.thread_reanchor_write', true), '') <> 'granted' then
      raise exception
        'A thread object''s anchor is not moved by an UPDATE. Re-anchoring is a recorded act (reanchor_thread_object): it states why, and it leaves a severance record saying the object used to hang from a different asset. An anchor that moves silently is the break spec §26 forbids, arriving as a one-line update.'
        using errcode = 'insufficient_privilege';
    end if;
    -- ...and the move names a person, freshly, on the row itself. The marker
    -- guards the route; this guards the ACT, so a caller that reached
    -- set_config still cannot move an anchor anonymously — and the §70 trigger
    -- on `anchor_moved_by` still has something to refuse.
    if new.anchor_asset_id is distinct from old.anchor_asset_id
       and (new.anchor_moved_by is null
            or new.anchor_moved_at is not distinct from old.anchor_moved_at) then
      raise exception
        'Moving a thread object''s anchor records WHO moved it and WHEN, on this row, in the same statement. An anchor that changed with nobody named is a severance nobody can be asked about.'
        using errcode = 'check_violation';
    end if;
    -- Retirement likewise: the recorded act sets these, and nothing else does.
    if (new.status is distinct from old.status
        or new.retired_at is distinct from old.retired_at
        or new.retired_by is distinct from old.retired_by
        or new.retired_reason is distinct from old.retired_reason)
       and coalesce(current_setting('app.thread_retire_write', true), '') <> 'granted' then
      raise exception
        'A thread object is retired through retire_thread_object, which records what the retirement severed. Flipping the status column directly retires it with nothing in the severance ledger, which is the silent break this table exists to make impossible.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Un-retiring is not a status flip either: what was severed stays severed
    -- unless the links are re-made, each on the record.
    if old.status = 'retired' and new.status = 'live' then
      raise exception
        'A retired thread object is not un-retired. Its links were severed and recorded; bringing it back by flipping a column would restore an object whose hops no longer exist. Retirement is a ONE-WAY DOOR on this reference: (organization, kind, object_ref) stays unique across retired rows on purpose, so that a severance snapshot naming "% %" cannot become ambiguous between two rows later. If the object is genuinely back, register it under the reference the project will cite from now on and re-make the hops that still hold.',
        old.object_kind, old.object_ref
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- PROVENANCE BACKSTOP. What the walls admit outside the definer RPCs still
  -- leaves something to find. Only on the ADMITTED path (4D-R33): an insert
  -- here on a refusing path would be lost with the aborted statement.
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Thread object %s %s (case %s)', new.object_kind, new.object_ref,
             new.development_case_id),
      tg_op,
      'A digital-thread object written outside register_thread_object changes what the continuity invariant is computed over, and an object registered with no person behind it has no accountable registrar.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_thread_object_integrity()
  from public, anon, authenticated;

-- §70, on the act that CUTS the thread. Spec §70 bars an AI or system identity
-- from severing a thread link; retiring an object severs every link touching
-- it, so it is the same act at a larger radius. One function
-- (20261205090000's), bound by column, on INSERT and UPDATE — not a fourth
-- copy that can quietly lose its UPDATE branch.
drop trigger if exists trg_thread_object_retirer_is_human on public.thread_objects;
create trigger trg_thread_object_retirer_is_human
  before insert or update on public.thread_objects
  for each row execute function public.enforce_frontline_judgement_is_human(
    'retired_by', 'retire a digital-thread object');

drop trigger if exists trg_thread_object_anchor_mover_is_human on public.thread_objects;
create trigger trg_thread_object_anchor_mover_is_human
  before insert or update on public.thread_objects
  for each row execute function public.enforce_frontline_judgement_is_human(
    'anchor_moved_by', 'move a digital-thread object to a different asset');

drop trigger if exists trg_thread_object_registrar_is_human on public.thread_objects;
create trigger trg_thread_object_registrar_is_human
  before insert or update on public.thread_objects
  for each row execute function public.enforce_frontline_judgement_is_human(
    'registered_by', 'register a digital-thread object');

drop trigger if exists trg_thread_object_integrity on public.thread_objects;
create trigger trg_thread_object_integrity
  before insert or update or delete on public.thread_objects
  for each row execute function public.enforce_thread_object_integrity();

drop trigger if exists trg_thread_object_no_truncate on public.thread_objects;
create trigger trg_thread_object_no_truncate
  before truncate on public.thread_objects
  for each statement execute function public.enforce_thread_object_integrity();

revoke truncate on table public.thread_objects from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. D11.05 — the link.
-- ---------------------------------------------------------------------------
create table if not exists public.thread_links (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  upstream_object_id bigint not null references thread_objects(id) on delete cascade,
  downstream_object_id bigint not null references thread_objects(id) on delete cascade,
  link_type text not null check (link_type = any (sync_thread_link_types())),
  -- Why this hop is believed to hold. An unevidenced thread is a drawing
  -- exercise — the same standard asset_dependencies.evidence sets.
  basis text not null check (length(btrim(basis)) >= 20),
  status text not null default 'live' check (status in ('live', 'severed')),
  severance_reason text,
  severed_by uuid references auth.users(id),
  severed_at timestamptz,
  linked_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (upstream_object_id, downstream_object_id, link_type),
  constraint thread_link_distinct check (upstream_object_id <> downstream_object_id),
  -- severed_by is required alongside severed_at for the same reason the object
  -- requires retired_by: the §70 wall reads that column, and a NULL actor is
  -- an early return.
  constraint thread_link_severance check (
    (status = 'severed') = (severed_at is not null)
    and (status = 'severed') = (severed_by is not null)),
  constraint thread_link_severance_reason check (
    status <> 'severed'
    or (severance_reason is not null and length(btrim(severance_reason)) >= 20))
);

create index if not exists idx_thread_link_case
  on thread_links(organization_id, development_case_id, status);
create index if not exists idx_thread_link_up
  on thread_links(upstream_object_id, status);
create index if not exists idx_thread_link_down
  on thread_links(downstream_object_id, status);

alter table public.thread_links enable row level security;
drop policy if exists thread_links_read on public.thread_links;
create policy thread_links_read on public.thread_links
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: links are made and severed through the definer RPCs.

comment on table public.thread_links is
  'D11.05 / spec II.2: one directed hop of the Common Data Environment thread. Direction is decided by sync_thread_chain_position — downstream sits strictly LATER in the chain — and enforced for every writer on INSERT and UPDATE (ruling 5C-R3). A link is never deleted; it is SEVERED with a stated reason, which lands in thread_severances.';

create or replace function public.enforce_thread_link_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  up thread_objects%rowtype;
  dn thread_objects%rowtype;
  v_up_pos int;
  v_dn_pos int;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'thread_links IS the digital thread. Truncating it breaks every hop in one statement with nothing recorded; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE ESCAPE: the case, the organization or an endpoint object is
    -- going. The object trigger has already recorded the cascade that took
    -- this link with it, counting it.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id)
       or not exists (select 1 from thread_objects where id = old.upstream_object_id)
       or not exists (select 1 from thread_objects where id = old.downstream_object_id) then
      return old;
    end if;
    raise exception
      'A thread link is not deleted. A hop that no longer holds is SEVERED with a stated reason (sever_thread_link), which records it. Deleting it makes a thread somebody cut indistinguishable from one that was never joined.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE'
     and not exists (select 1 from development_cases where id = old.development_case_id) then
    return new;
  end if;

  select * into up from thread_objects where id = new.upstream_object_id;
  if not found then
    raise exception 'the upstream thread object does not exist' using errcode = 'check_violation';
  end if;
  select * into dn from thread_objects where id = new.downstream_object_id;
  if not found then
    raise exception 'the downstream thread object does not exist' using errcode = 'check_violation';
  end if;
  if up.organization_id <> new.organization_id or dn.organization_id <> new.organization_id then
    raise exception
      'Both ends of a thread link belong to the link''s own organization. A link across tenants is a cross-tenant read with a friendly name.'
      using errcode = 'check_violation';
  end if;
  if up.development_case_id <> new.development_case_id
     or dn.development_case_id <> new.development_case_id then
    raise exception
      'Both ends of a thread link belong to the link''s own development case. A link across cases would make one case''s continuity depend on rows the other case can retire.'
      using errcode = 'check_violation';
  end if;

  -- RULING 5C-R3: the link runs FORWARD.
  v_up_pos := sync_thread_chain_position(up.object_kind);
  v_dn_pos := sync_thread_chain_position(dn.object_kind);
  if v_up_pos is null or v_dn_pos is null then
    raise exception
      'One end of this link has a kind outside the ten of spec II.2, so its position in the chain is unknown. An unknown position is refused, never treated as zero — a link whose direction cannot be decided is exactly the edge that makes a cascade run backwards.'
      using errcode = 'check_violation';
  end if;
  if v_dn_pos <= v_up_pos then
    raise exception
      'A thread link runs forward: % is at position % and % is at position %. The chain of spec II.2 has one direction, and an edge that runs against it makes every downstream-impact answer wrong in the most convincing possible way (ruling 5C-R3).',
      up.object_kind, v_up_pos, dn.object_kind, v_dn_pos
      using errcode = 'check_violation';
  end if;

  -- A live link may not hang off a retired object: that is a dangling
  -- endpoint, which is one of D11.20's four definitions of a break.
  if new.status = 'live' and (up.status = 'retired' or dn.status = 'retired') then
    raise exception
      'A live link cannot touch a retired thread object (% / %). Retiring an object severs its links on the record; re-making one afterwards would restore a hop whose far end is gone.',
      up.object_ref, dn.object_ref
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.upstream_object_id is distinct from old.upstream_object_id
       or new.downstream_object_id is distinct from old.downstream_object_id
       or new.link_type is distinct from old.link_type
       or new.development_case_id is distinct from old.development_case_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'What a thread link IS — its two ends and the hop it names — cannot be rewritten by any caller, service paths included. Re-pointing a link is severing one hop and making another, and both of those are recorded acts.'
        using errcode = 'insufficient_privilege';
    end if;
    if (new.status is distinct from old.status
        or new.severed_at is distinct from old.severed_at
        or new.severed_by is distinct from old.severed_by
        or new.severance_reason is distinct from old.severance_reason)
       and coalesce(current_setting('app.thread_sever_write', true), '') <> 'granted' then
      raise exception
        'A thread link is severed through sever_thread_link, which records it in thread_severances. Flipping the status column directly cuts the thread with nothing to find afterwards — the silent break spec §26 forbids.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status = 'severed' and new.status = 'live' then
      raise exception
        'A severed link is not un-severed. The severance is on the record; if the hop holds again, make it again — a new link, with its own basis, so the history says the thread was cut and re-joined rather than pretending it never was.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Thread link %s → %s (%s)', up.object_ref, dn.object_ref, new.link_type),
      tg_op,
      'A digital-thread hop written or moved outside link_thread_objects / sever_thread_link changes what a downstream-impact traversal reaches, and receipts are produced from exactly these edges.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_thread_link_integrity()
  from public, anon, authenticated;

-- §70, verbatim on the act it names: "no AI or system identity may sever a
-- thread link."
drop trigger if exists trg_thread_link_severer_is_human on public.thread_links;
create trigger trg_thread_link_severer_is_human
  before insert or update on public.thread_links
  for each row execute function public.enforce_frontline_judgement_is_human(
    'severed_by', 'sever a digital-thread link');

drop trigger if exists trg_thread_link_linker_is_human on public.thread_links;
create trigger trg_thread_link_linker_is_human
  before insert or update on public.thread_links
  for each row execute function public.enforce_frontline_judgement_is_human(
    'linked_by', 'assert a digital-thread hop');

drop trigger if exists trg_thread_link_integrity on public.thread_links;
create trigger trg_thread_link_integrity
  before insert or update or delete on public.thread_links
  for each row execute function public.enforce_thread_link_integrity();

drop trigger if exists trg_thread_link_no_truncate on public.thread_links;
create trigger trg_thread_link_no_truncate
  before truncate on public.thread_links
  for each statement execute function public.enforce_thread_link_integrity();

revoke truncate on table public.thread_links from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6b. THE ASSET-SIDE WALL (D11.20, shipped here on purpose).
--
--     `thread_objects.anchor_asset_id` is `on delete cascade`, which means
--     `delete from assets where id = …` would remove every thread object
--     hanging off that asset, and the object trigger's own mid-cascade escape
--     would let it through — silently. The escape is right (refusing there
--     would make a tenant undeletable); the SILENCE is the defect.
--
--     RESTRICT was considered and rejected. `assets.organization_id` cascades
--     from `organizations`, so a RESTRICT child would fire on delete ORDER
--     rather than on intent and could make an organization undeletable — the
--     same trap 20261204090000 ruling 6 records for the requirement self-FK.
--
--     So the wall is a BEFORE DELETE trigger on `assets` that decides:
--       * organization gone      → permit (tenant cascade; nothing survives to
--                                  read a ledger, and the ledger row could not
--                                  be inserted against a vanished FK anyway);
--       * live thread objects    → REFUSE, and name them;
--       * retired objects only   → permit, and RECORD an `asset_cascade`.
--
--     This ships in the SAME migration as the table it protects. A table that
--     exists for even one migration with a cascade route and no wall is a
--     window, and windows in this repository have been climbed through.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_asset_thread_anchor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live int;
  v_retired int;
  v_sample text;
  v_row record;
  v_versions int;
  v_open_receipts int;
begin
  if not exists (select 1 from organizations where id = old.organization_id) then
    return old;
  end if;

  select
    count(*) filter (where status = 'live'),
    count(*) filter (where status = 'retired')
    into v_live, v_retired
  from thread_objects where anchor_asset_id = old.id;

  if coalesce(v_live, 0) > 0 then
    select string_agg(object_kind || ' ' || object_ref, ', ')
      into v_sample
      from (select object_kind, object_ref from thread_objects
             where anchor_asset_id = old.id and status = 'live'
             order by object_ref limit 5) s;
    raise exception
      'This asset anchors % live digital-thread object(s) (%). Deleting it would take them out of the thread with nothing recorded — the break spec §26 forbids. Retire the thread objects first (retire_thread_object), which states why and leaves a severance record, then delete the asset.',
      v_live, coalesce(v_sample, 'unnamed')
      using errcode = 'insufficient_privilege';
  end if;

  -- ONE LEDGER ROW PER AFFECTED CASE, carrying that case's real id.
  --
  -- Writing a single row with `development_case_id = null` records the
  -- severance into a shape no read can return: the case ledger filters on the
  -- case id, so a null matches nothing and the loss is recorded-but-unreadable
  -- — which, for the person who has to find out what happened, is
  -- indistinguishable from silent. D11.20's contract is that a permitted break
  -- is VISIBLE afterwards, so the route stamps the case each object belonged
  -- to and the case's own ledger shows it.
  if coalesce(v_retired, 0) > 0 then
    for v_row in
      select t.development_case_id case_id,
             count(*)::int n,
             string_agg(t.object_kind || ' ' || t.object_ref, ', ' order by t.object_ref) refs,
             array_agg(t.id) ids
        from thread_objects t
       where t.anchor_asset_id = old.id and t.status = 'retired'
       group by t.development_case_id
    loop
      -- Explicit column alias, matching the `unnest(...) as i(object_id)` form
      -- the rest of this slice uses: a bare `i` is a name that could resolve to
      -- either the FROM item or its column, and this file cannot be run to find
      -- out which.
      select sum((sync_thread_object_cascade_losses(u.object_id)->>'versions_lost')::int),
             sum((sync_thread_object_cascade_losses(u.object_id)->>'unacknowledged_receipts_lost')::int)
        into v_versions, v_open_receipts
        from unnest(v_row.ids) as u(object_id);
      perform record_thread_severance(old.organization_id, v_row.case_id,
        'asset_cascade', 'thread_object',
        coalesce(old.asset_tag, old.tag, old.name, old.id::text),
        jsonb_build_object('asset_id', old.id, 'asset_name', old.name,
          'enterprise_asset_id', old.enterprise_asset_id,
          'retired_objects', v_row.n,
          'retired_object_refs', v_row.refs,
          'versions_lost', v_versions,
          'unacknowledged_receipts_lost', v_open_receipts),
        0,
        'The asset anchoring these already-retired thread objects was deleted, so the objects went with it. Permitted because nothing live hung from it, and recorded because the anchor is what the thread hangs from. Any unanswered change receipt counted here went with them: spec II.2''s question with the answer still missing, and this number is the only thing left of it.',
        auth.uid());
    end loop;
  end if;
  return old;
end
$$;

revoke all on function public.enforce_asset_thread_anchor()
  from public, anon, authenticated;

drop trigger if exists trg_asset_thread_anchor on public.assets;
create trigger trg_asset_thread_anchor
  before delete on public.assets
  for each row execute function public.enforce_asset_thread_anchor();

comment on function public.enforce_asset_thread_anchor() is
  'D11.20: refuses to delete an asset that anchors LIVE digital-thread objects, for every caller including service paths; permits the tenant cascade (organization already gone) and permits a delete that only takes retired objects — recording ONE ledger row per affected development case, stamped with that case''s id so the loss is readable afterwards. The asset is the thread''s one anchor (D11.19), so losing it silently is the break §26 names.';

-- ---------------------------------------------------------------------------
-- 6b. THE ASSET, ON UPDATE. The other half of the anchor's wall.
--
--     `assets` is one of the 29 tables carrying the baseline `assets_org_rw`
--     policy — `for all to authenticated`, with a check on organization_id and
--     nothing else. So every column on it is writable by any signed-in member
--     of the tenant straight through PostgREST, and the app already writes to
--     the table directly (the CSV import wizard does).
--
--     That makes an RPC-only guard on the two new §26 columns no guard at all:
--     `set_asset_enterprise_identity` refuses a duplicate number, refuses a
--     re-point and demands a planning role, and a PATCH on
--     /rest/v1/assets?id=eq.<uuid> walks past all three. The unique index would
--     still stop two assets sharing one number, but not a re-point, not a
--     clear-to-null, and not a technician doing either. The enterprise identity
--     is what a change receipt uses to say WHICH MACHINE the change reached, so
--     re-pointing it silently re-points every downstream record that cites it.
--
--     Two things are refused here, for every caller:
--       * a change to enterprise_asset_id or functional_location outside
--         set_asset_enterprise_identity (transaction-local marker, same idiom
--         as the anchor-move and retirement guards above); and
--       * moving an asset to another organization while it anchors thread
--         objects — the state D11.20's break definition (1) names as "an anchor
--         in another tenant", which until now was checked only on writes to
--         `thread_objects` and so could be produced from the asset's side.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_asset_thread_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchored int;
begin
  if new.organization_id is distinct from old.organization_id then
    select count(*) into v_anchored from thread_objects where anchor_asset_id = old.id;
    if coalesce(v_anchored, 0) > 0 then
      raise exception
        'This asset anchors % digital-thread object(s) and cannot be moved to another organization. The object would keep an anchor in a tenant that can no longer read it — break definition (1) in 20261206090200, arriving from the asset''s side rather than the object''s.',
        v_anchored
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if (new.enterprise_asset_id is distinct from old.enterprise_asset_id
      or new.functional_location is distinct from old.functional_location)
     and coalesce(current_setting('app.asset_identity_write', true), '') <> 'granted' then
    raise exception
      'An asset''s enterprise identity (enterprise_asset_id, functional_location) is recorded through set_asset_enterprise_identity, which refuses a number another asset already holds, refuses to re-point one already registered, and demands a planning, engineering or governance role. Setting the columns directly is past all three — and this identity is what a change receipt uses to say which machine the change reached, so re-pointing it re-points every downstream record that cites the old number.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_asset_thread_identity()
  from public, anon, authenticated;

drop trigger if exists trg_asset_thread_identity on public.assets;
create trigger trg_asset_thread_identity
  before update on public.assets
  for each row execute function public.enforce_asset_thread_identity();

comment on function public.enforce_asset_thread_identity() is
  'D11.19/D11.20: the UPDATE half of the anchor''s wall on the ONE asset table. Refuses a §26 enterprise-identity write outside set_asset_enterprise_identity for EVERY caller (assets carries a permissive `for all to authenticated` policy, so an RPC-only guard is not a guard), and refuses moving an anchoring asset to another tenant.';

-- ---------------------------------------------------------------------------
-- 7. D11.19 — populating the enterprise identity from project delivery.
-- ---------------------------------------------------------------------------
create or replace function public.set_asset_enterprise_identity(
  p_asset_id uuid,
  p_enterprise_asset_id text,
  p_functional_location text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  a assets%rowtype;
  v_eam text := nullif(btrim(coalesce(p_enterprise_asset_id, '')), '');
  v_floc text := nullif(btrim(coalesce(p_functional_location, '')), '');
  v_clash text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording an enterprise asset identity requires a planning, engineering or governance role');
  end if;
  select * into a from assets where id = p_asset_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;
  if v_eam is null and v_floc is null then
    return jsonb_build_object('error',
      'name the enterprise asset id, the functional location, or both — this call with neither would clear an identity somebody recorded');
  end if;
  -- An enterprise id is not re-pointed by a later call: two assets sharing one
  -- EAM number is the state the unique index refuses, and the refusal here is
  -- the readable version of it.
  if v_eam is not null then
    select name into v_clash from assets
     where organization_id = v_org and enterprise_asset_id = v_eam and id <> a.id
     limit 1;
    if v_clash is not null then
      return jsonb_build_object('error',
        format('enterprise asset id "%s" already belongs to "%s". One enterprise identity names one asset — a shared number makes the operating system''s record and this one disagree about which machine changed.',
          v_eam, v_clash));
    end if;
    if a.enterprise_asset_id is not null and a.enterprise_asset_id <> v_eam then
      return jsonb_build_object('error',
        format('this asset is already registered as "%s" in the enterprise system. Changing it re-points every downstream record that cites the old number; record the new asset instead.',
          a.enterprise_asset_id));
    end if;
  end if;

  -- The sanctioned write. Transaction-local marker: the UPDATE wall on
  -- `assets` refuses a §26 identity change that arrives without it.
  perform set_config('app.asset_identity_write', 'granted', true);
  update assets set
    enterprise_asset_id = coalesce(v_eam, enterprise_asset_id),
    functional_location = coalesce(v_floc, functional_location)
  where id = a.id;
  perform set_config('app.asset_identity_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'asset_enterprise_identity', coalesce(v_role, 'unknown'),
    jsonb_build_object('asset_id', a.id, 'asset_name', a.name),
    jsonb_build_object('enterprise_asset_id', a.enterprise_asset_id,
      'functional_location', a.functional_location),
    jsonb_build_object('enterprise_asset_id', coalesce(v_eam, a.enterprise_asset_id),
      'functional_location', coalesce(v_floc, a.functional_location)));

  return jsonb_build_object(
    'asset_id', a.id,
    'enterpriseAssetId', coalesce(v_eam, a.enterprise_asset_id),
    'functionalLocation', coalesce(v_floc, a.functional_location),
    'note', 'Recorded on the ONE asset hierarchy. This is the identity the operating system uses, so a change receipt can say which machine the change reached.');
end
$$;

revoke all on function public.set_asset_enterprise_identity(uuid, text, text) from public, anon;
grant execute on function public.set_asset_enterprise_identity(uuid, text, text)
  to authenticated, service_role;

comment on function public.set_asset_enterprise_identity(uuid, text, text) is
  'D11.19 / spec §26: records enterprise_asset_id and functional_location on the ONE canonical asset row — the register row''s named gap, "enterprise_asset_id population from project delivery". Refuses a number already held by another asset and refuses to re-point one that is already registered; `enforce_asset_thread_identity` holds the same two columns shut for every OTHER caller, because `assets` carries a permissive for-all policy.';

-- ---------------------------------------------------------------------------
-- 8. D11.05 — the write paths.
-- ---------------------------------------------------------------------------
create or replace function public.register_thread_object(
  p_case_id uuid,
  p_object jsonb
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
  a assets%rowtype;
  v_kind text := nullif(btrim(coalesce(p_object->>'object_kind','')), '');
  v_ref text := nullif(btrim(coalesce(p_object->>'object_ref','')), '');
  v_title text := btrim(coalesce(p_object->>'title',''));
  v_anchor uuid := sync_text_as_uuid(p_object->>'anchor_asset_id');
  v_req_id bigint := sync_text_as_int(p_object->>'requirement_id');
  v_test_id bigint := sync_text_as_int(p_object->>'commissioning_test_id');
  v_existing_status text;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'registering a digital-thread object requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_kind is null or not (v_kind = any (sync_thread_object_kinds())) then
    return jsonb_build_object('error',
      format('object_kind must be one of the ten spec II.2 kinds: %s',
        array_to_string(sync_thread_object_kinds(), ', ')));
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a thread object carries the reference the rest of the project cites (object_ref) — a tag number, a drawing number, a PO line');
  end if;
  if length(v_title) < 3 then
    return jsonb_build_object('error',
      'give the object a title a reader can recognise (3 characters minimum)');
  end if;
  -- RULING 5C-R2, at the door as well as at the wall.
  if v_anchor is null then
    return jsonb_build_object('error',
      'name the asset this object hangs from (anchor_asset_id). An unanchored object is not a thread object — the whole of "the thread must never break" is that every object resolves to one asset in the ONE canonical hierarchy (spec §26).');
  end if;
  select * into a from assets where id = v_anchor and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'that anchoring asset is not in this organization');
  end if;
  if v_kind = 'requirement' and v_req_id is null then
    return jsonb_build_object('error',
      'a thread object of kind `requirement` names the requirement it IS (requirement_id) — the CDE registers the row in the ONE requirement store, it does not hold a second copy of it');
  end if;
  if v_kind <> 'requirement' and v_req_id is not null then
    return jsonb_build_object('error',
      'only a `requirement` object carries requirement_id — a link between two objects is a thread link, not a column');
  end if;
  if v_kind = 'commissioning_test' and v_test_id is null then
    return jsonb_build_object('error',
      'a thread object of kind `commissioning_test` names the acceptance_tests row it IS (commissioning_test_id)');
  end if;
  if v_kind <> 'commissioning_test' and v_test_id is not null then
    return jsonb_build_object('error',
      'only a `commissioning_test` object carries commissioning_test_id');
  end if;
  if v_req_id is not null
     and not exists (select 1 from design_requirements d where d.id = v_req_id
                      and d.organization_id = v_org and d.development_case_id = c.id) then
    return jsonb_build_object('error', 'that requirement is not on this development case');
  end if;
  if v_test_id is not null
     and not exists (select 1 from acceptance_tests t where t.id = v_test_id
                      and t.organization_id = v_org) then
    return jsonb_build_object('error', 'that commissioning test is not in this organization');
  end if;
  -- The reference is unique per tenant across RETIRED rows too, and the two
  -- cases need different sentences. "Already registered" sends somebody looking
  -- for a row on a screen; the retired case has to say plainly that the
  -- reference is spent, or the operator reads the un-retire refusal, is told to
  -- register it again, tries, and is refused with a message that looks like a
  -- bug.
  select status into v_existing_status from thread_objects
   where organization_id = v_org and object_kind = v_kind and object_ref = v_ref;
  if v_existing_status = 'live' then
    return jsonb_build_object('error',
      format('a %s with reference "%s" is already registered in this organization', v_kind, v_ref));
  elsif v_existing_status is not null then
    return jsonb_build_object('error',
      format('a %s with reference "%s" was registered in this organization and RETIRED. That reference is spent: it stays unique across retired rows so a severance record naming it cannot become ambiguous between two objects. Register this one under the reference the project will cite from now on.',
        v_kind, v_ref));
  end if;

  insert into thread_objects (organization_id, development_case_id, object_kind,
    object_ref, title, anchor_asset_id, requirement_id, commissioning_test_id,
    registered_by)
  values (v_org, c.id, v_kind, v_ref, v_title, v_anchor, v_req_id, v_test_id, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_object', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'object_id', v_id, 'object_kind', v_kind,
      'object_ref', v_ref),
    null,
    jsonb_build_object('title', v_title, 'anchor_asset_id', v_anchor,
      'requirement_id', v_req_id, 'commissioning_test_id', v_test_id, 'status', 'live'));

  return jsonb_build_object(
    'object_id', v_id,
    'objectKind', v_kind,
    'objectRef', v_ref,
    'chainPosition', sync_thread_chain_position(v_kind),
    'anchorAssetId', v_anchor,
    'anchorAssetName', a.name,
    'canonicalHome', sync_thread_object_canonical_home(v_kind),
    'note', case when sync_thread_object_canonical_home(v_kind) like 'none%'
      then 'Registered BY REFERENCE: this repository has no store for this kind, so the thread holds its reference and its title and does not pretend to hold the document itself.'
      else format('Registered against its canonical row in %s. The thread points at that row; it does not copy it.',
        sync_thread_object_canonical_home(v_kind)) end);
end
$$;

revoke all on function public.register_thread_object(uuid, jsonb) from public, anon;
grant execute on function public.register_thread_object(uuid, jsonb) to authenticated, service_role;

comment on function public.register_thread_object(uuid, jsonb) is
  'D11.05 / spec II.2: registers one object into the Common Data Environment thread, anchored to exactly one asset in the ONE canonical hierarchy (D11.19). Refuses an unanchored object at the door, and refuses a `requirement` or `commissioning_test` object that does not name its canonical row (ruling 5C-R5).';

create or replace function public.link_thread_objects(
  p_upstream_id bigint,
  p_downstream_id bigint,
  p_link_type text,
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
  up thread_objects%rowtype;
  dn thread_objects%rowtype;
  v_type text := nullif(btrim(coalesce(p_link_type,'')), '');
  v_basis text := btrim(coalesce(p_basis,''));
  v_up_pos int;
  v_dn_pos int;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'linking digital-thread objects requires a planning, engineering or governance role');
  end if;
  select * into up from thread_objects where id = p_upstream_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'the upstream object is not in this organization');
  end if;
  select * into dn from thread_objects where id = p_downstream_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'the downstream object is not in this organization');
  end if;
  if up.id = dn.id then
    return jsonb_build_object('error', 'an object is not linked to itself');
  end if;
  if up.development_case_id <> dn.development_case_id then
    return jsonb_build_object('error',
      'both ends of a thread link belong to one development case');
  end if;
  if up.status = 'retired' or dn.status = 'retired' then
    return jsonb_build_object('error',
      'one end of this link is retired. A live hop cannot touch a retired object — that is a dangling endpoint, which is one of the four things "the thread must never break" means (D11.20).');
  end if;
  if v_type is null or not (v_type = any (sync_thread_link_types())) then
    return jsonb_build_object('error',
      format('link_type must be one of: %s', array_to_string(sync_thread_link_types(), ', ')));
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state why this hop holds (basis, 20 characters minimum) — an unevidenced thread is a drawing exercise, and every downstream impact this product reports is computed from exactly these edges');
  end if;
  v_up_pos := sync_thread_chain_position(up.object_kind);
  v_dn_pos := sync_thread_chain_position(dn.object_kind);
  if v_dn_pos <= v_up_pos then
    return jsonb_build_object('error',
      format('a thread link runs forward along the spec II.2 chain: %s is at position %s and %s is at position %s. Link them the other way round.',
        up.object_kind, v_up_pos, dn.object_kind, v_dn_pos));
  end if;
  if exists (select 1 from thread_links
              where upstream_object_id = up.id and downstream_object_id = dn.id
                and link_type = v_type) then
    return jsonb_build_object('error',
      format('these two objects are already linked as `%s`', v_type));
  end if;

  insert into thread_links (organization_id, development_case_id, upstream_object_id,
    downstream_object_id, link_type, basis, linked_by)
  values (v_org, up.development_case_id, up.id, dn.id, v_type, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_link', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', up.development_case_id, 'link_id', v_id,
      'upstream', up.object_ref, 'downstream', dn.object_ref),
    null,
    jsonb_build_object('link_type', v_type, 'basis', v_basis, 'status', 'live'));

  return jsonb_build_object(
    'link_id', v_id,
    'linkType', v_type,
    'traversalKind', sync_thread_traversal_kind(v_type),
    'upstreamKind', up.object_kind,
    'downstreamKind', dn.object_kind,
    'positionsSkipped', greatest(v_dn_pos - v_up_pos - 1, 0),
    'anchorsAgree', up.anchor_asset_id = dn.anchor_asset_id,
    'note', case
      when v_dn_pos - v_up_pos > 1 then
        format('This hop skips %s chain position(s). That is legal — not every asset has a vendor document — and it is REPORTED as a gap by the continuity read rather than normalised away. Continuous is not the same as complete (ruling 5C-R3).',
          v_dn_pos - v_up_pos - 1)
      when up.anchor_asset_id <> dn.anchor_asset_id then
        'The two ends hang from different assets. That is legal and it is reported: a hop that crosses anchors is exactly where a change on one machine reaches another.'
      else 'Linked. This edge is what a downstream-impact traversal walks and what a change receipt is produced from.' end);
end
$$;

revoke all on function public.link_thread_objects(bigint, bigint, text, text) from public, anon;
grant execute on function public.link_thread_objects(bigint, bigint, text, text)
  to authenticated, service_role;

comment on function public.link_thread_objects(bigint, bigint, text, text) is
  'D11.05 / spec II.2: makes one forward hop of the CDE thread, with a mandatory basis. Refuses a backward link, a cross-case link and a link touching a retired object — at the door, and again at the wall for every writer.';

notify pgrst, 'reload schema';
