-- ============================================================================
-- Sync Develop — Slice 7A, part 2 of 3.
-- D7.18 (Constraint, spec III.§28 — ten types) and the §70-walled release
-- that D7.10/D7.17 refuse through.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RULING 20 (§28 Constraint). `restoration_constraints` IS the Constraint
-- object. SEVEN of the spec's ten types already existed among the SEVENTEEN
-- domain kinds it carried; THREE are added here. No parallel table is created
-- to hold ten of them, and no existing kind is removed to "match §28".
--
-- COUNT IT HONESTLY, because a ruling is the one artefact no test checks and
-- this one was wrong in its first draft (it called the ten a SUBSET in the
-- same sentence that said three were added, and said "the other EIGHT" above
-- a list of ten). The arithmetic:
--
--      17  domain kinds before this file (18 CHECK values, with `other`)
--    −  7  of them are already the spec's ten under this repo's own names
--    +  3  added here (drawing, access, scaffold)
--    ────
--      20  domain kinds after (21 CHECK values, with `other`)
--
--    So: the ten are NOT a subset of what was there. AFTER this file the
--    store's vocabulary is a strict SUPERSET of §28's ten — twenty domain
--    kinds covering the spec's ten and ten more besides. That is the claim,
--    and it is the claim the migration test asserts against the live CHECK.
--
-- WHAT IS ALREADY THERE. `restoration_constraints` (20260921090000:94, kinds
-- extended 20261002100000:25) carries seventeen domain kinds — richer than
-- the spec's ten — with `phase`, `is_hard`, a four-value `state`, a NOT NULL
-- `description` AND a NOT NULL `basis`, a `source_kind` that distinguishes a
-- stated constraint from a derived one, and the rule that matters most:
--
--     check (state <> 'satisfied' or (verified_by is not null
--                                     and verified_at is not null))
--
-- A constraint cannot be satisfied without somebody having verified it. That
-- check is UNTOUCHED by this file and is now additionally backed by a §70
-- wall on `verified_by` (section 4), so the identity doing the verifying
-- cannot be a machine.
--
-- Beside it, `operational_constraint_signals` (20261001090000:9) is NOT a
-- second constraint store and is not treated as one: it is the EVIDENCE FEED
-- that `refresh_restoration_readiness` reads to decide a derived constraint's
-- state, with a `valid_until` so stale evidence resolves to `unknown` instead
-- of to `satisfied`. It keeps that job unchanged.
--
-- ── THE TEN, MAPPED. Seven of the spec's ten already exist under this
--    repository's own names; three are added:
--
--      spec §28        restoration_constraints.constraint_kind
--      ───────────     ────────────────────────────────────────
--      DRAWING     →   drawing        (ADDED here)
--      MATERIAL    →   material
--      ACCESS      →   access         (ADDED here)
--      LABOUR      →   labour
--      CRANE       →   crane
--      PERMIT      →   permit
--      ISOLATION   →   isolation
--      SCAFFOLD    →   scaffold       (ADDED here)
--      PREDECESSOR →   precedence
--      INSPECTION  →   quality_hold
--
--    ACCESS is added rather than folded into the existing `work_zone`: a work
--    zone is a PHYSICAL RELATION between two pieces of work (Recovery's
--    interference constraint reads work_zone_relationships to ask whether two
--    jobs may run side by side), while §28's ACCESS is whether ONE package can
--    physically get to its worksite. Mapping one onto the other would make
--    Recovery's interference logic start reading project access rows.
--
--    INSPECTION maps to the existing `quality_hold` because that is exactly
--    what an inspection constraint is here — job_plans already carry
--    `is_hold_point` (20260811090000) and the vocabulary should not gain a
--    second word for one idea.
--
--    The other TEN domain kinds — resource, work_zone, tooling, bay, vendor,
--    weather, production, approval, asset_state, component_life — stay, as
--    does the `other` catch-all beside them. They are richer than the spec and
--    losing them to make the table "match §28" would be a downgrade dressed as
--    conformance. Ten mapped + ten unmapped = the twenty counted above.
--
-- ── SCOPE GENERALIZED, NOT WEAKENED. `event_id` was NOT NULL. It becomes one
--    of TWO anchors under a stricter statement of the same invariant:
--
--      check (num_nonnulls(event_id, work_package_id) = 1)
--
--    Every existing row satisfies it (event_id set, work_package_id null),
--    and a constraint anchored to NOTHING — which a bare `drop not null`
--    would have permitted — is refused where before it was impossible. This
--    is a generalization of scope with the anchoring requirement intact, and
--    the slice test pins the XOR so a later edit cannot drop it.
--
-- ── THE §34 EDGE, CLOSED AT THE COLUMN IT WAS PROMISED AT.
--    `sync_spec34_absent_edge_audit()` (20261207090300:169) pre-declared, in
--    live SQL rather than prose, that `WorkPackage DEPENDS_ON Constraint`
--    "closes when the canonical Constraint store names the canonical work
--    identity directly" — at `public.restoration_constraints.work_order_id`.
--    That column is added here, and the ledger entry is TRANSFORMED (section
--    8) rather than re-typed, so nothing else in it can drift.
--
-- ── THE FORWARD-LOOKING FIELDS (I.28, consumed by part 3). §28's Constraint
--    carries `required_by` and `expected_clear_date`; I.28's burn-down adds
--    "probability of clearance" and "schedule impact". All four land HERE, on
--    the ONE constraint store, because a burn-down needs a constraint that
--    knows when it must be gone — not a second table holding dates about the
--    first one. Register row D7.07 says it in one line: "EXTEND — not a new
--    burn-down table."
--
--    Every one of them refuses rather than inventing:
--      * a probability outside [0,1], NaN or infinite is refused at the door
--        AND at the table ('NaN'::numeric = 'NaN'::numeric is TRUE in
--        Postgres, so a range check alone does not keep NaN out);
--      * a probability with no stated basis is refused — a number somebody
--        will schedule against needs to say where it came from, the
--        restoration_blockers.impact_basis rule;
--      * a schedule impact with no basis is refused for the same reason;
--      * an expected clear date before the constraint was raised is refused.
--
-- ── §70. `release_work_package` is the act spec §70 reserves ("equipment
--    safe to start"), and `clear_package_constraint` closes a constraint. No
--    AI or system identity does either: the role gate excludes ai_admin, the
--    `enforce_awp_act_is_human` wall (part 1) refuses the identity in
--    `released_by` and in `verified_by` on every PACKAGE-anchored row for
--    every writer (section 4 states why event-anchored rows keep Recovery's
--    own rules, and what that leaves open), and the
--    permit/isolation/asset-state truths still cannot be toggled by hand at
--    all — that rule is Recovery's (20260921090000:398) and this file
--    preserves it verbatim rather than granting the project path an exemption
--    Recovery does not have.
--
-- ── REFUSAL-FIRST at the release door. A package with NO constraints
--    recorded REFUSES. "0 open constraints" against a package nobody assessed
--    reads as READY, and reading as ready is the exact failure §27 describes.
--
-- Canonical reuse: restoration_constraints, restoration_events,
-- work_packages, work_package_work, work_orders, development_cases,
-- user_profiles, audit_events, security_events, sync_awp_level,
-- sync_finite_money, enforce_awp_act_is_human, record_awp_service_write.
-- No new constraint table, no second constraint vocabulary, no second store
-- for dates about constraints.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE SPEC §28 VOCABULARY, AS DATA — the ten names, mapped onto the
--    canonical kinds. One function; the RPC reads it, the read reads it, and
--    src/lib/develop/workPackaging.ts mirrors it with the slice test pinning
--    the two together.
-- ---------------------------------------------------------------------------
create or replace function public.sync_spec28_constraint_kind(p_spec_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_spec_type, '')))
    when 'drawing'     then 'drawing'
    when 'material'    then 'material'
    when 'access'      then 'access'
    when 'labour'      then 'labour'
    when 'crane'       then 'crane'
    when 'permit'      then 'permit'
    when 'isolation'   then 'isolation'
    when 'scaffold'    then 'scaffold'
    when 'predecessor' then 'precedence'
    when 'inspection'  then 'quality_hold'
  end;
$$;

revoke all on function public.sync_spec28_constraint_kind(text) from public, anon;
grant execute on function public.sync_spec28_constraint_kind(text) to authenticated, service_role;

comment on function public.sync_spec28_constraint_kind(text) is
  'D7.18 (spec III.§28): the ten spec constraint types mapped onto the canonical restoration_constraints vocabulary. RULING 20 — SEVEN of the spec''s ten already existed among this store''s seventeen domain kinds (PREDECESSOR is `precedence` and INSPECTION is `quality_hold`, under names this repository already uses) and DRAWING/ACCESS/SCAFFOLD are added here, so the vocabulary becomes a strict SUPERSET of §28''s ten at twenty domain kinds. NULL for anything else, which every caller treats as a refusal.';

-- ---------------------------------------------------------------------------
-- 2. THE CONSTRAINT STORE GENERALIZES (D7.18).
-- ---------------------------------------------------------------------------
alter table public.restoration_constraints
  -- The project-delivery anchor, beside the restoration-event one.
  add column if not exists work_package_id bigint references work_packages(id) on delete cascade,
  -- §34's `WorkPackage DEPENDS_ON Constraint`, at the column
  -- sync_spec34_absent_edge_audit() named for it: the canonical Constraint
  -- store naming the canonical WORK IDENTITY directly, rather than through
  -- Recovery's two-hop event path.
  add column if not exists work_order_id uuid references work_orders(id) on delete cascade,
  -- §28 "required_by" — the date this must be cleared BY for the work it
  -- qualifies to start on time. The burn-down is blind without it and says so
  -- by name rather than assuming today.
  add column if not exists required_by date,
  -- §28 "expected_clear_date" — when the owner expects it gone.
  add column if not exists expected_clear_date date,
  -- I.28 "probability of clearance", with its basis. Never inferred.
  add column if not exists probability_of_clearance numeric,
  add column if not exists probability_basis text,
  -- I.28 "schedule impact", with its basis — the restoration_blockers rule
  -- (a number nobody can source is a number nobody should schedule against).
  add column if not exists schedule_impact_days numeric,
  add column if not exists impact_basis text,
  -- §28 "owner_id". `owner_role` already exists and stays; a role owns the
  -- CLASS of constraint and a person owns THIS one.
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

-- The anchor. ONE of the two, never neither and never both.
alter table public.restoration_constraints
  alter column event_id drop not null;
alter table public.restoration_constraints
  drop constraint if exists restoration_constraint_one_anchor;
alter table public.restoration_constraints
  add constraint restoration_constraint_one_anchor check (
    num_nonnulls(event_id, work_package_id) = 1);

-- The forward-looking numbers, at the table, for every writer.
alter table public.restoration_constraints
  drop constraint if exists restoration_constraint_probability_sane;
alter table public.restoration_constraints
  add constraint restoration_constraint_probability_sane check (
    probability_of_clearance is null
    or (probability_of_clearance <> 'NaN'::numeric
        and probability_of_clearance >= 0
        and probability_of_clearance <= 1));

alter table public.restoration_constraints
  drop constraint if exists restoration_constraint_probability_basis;
alter table public.restoration_constraints
  add constraint restoration_constraint_probability_basis check (
    probability_of_clearance is null
    or length(btrim(coalesce(probability_basis, ''))) >= 20);

alter table public.restoration_constraints
  drop constraint if exists restoration_constraint_impact_sane;
alter table public.restoration_constraints
  add constraint restoration_constraint_impact_sane check (
    schedule_impact_days is null
    or (schedule_impact_days <> 'NaN'::numeric
        and schedule_impact_days > '-Infinity'::numeric
        and schedule_impact_days < 'Infinity'::numeric
        and schedule_impact_days >= 0));

alter table public.restoration_constraints
  drop constraint if exists restoration_constraint_impact_basis;
alter table public.restoration_constraints
  add constraint restoration_constraint_impact_basis check (
    schedule_impact_days is null
    or length(btrim(coalesce(impact_basis, ''))) >= 10);

-- THE THREE ADDED KINDS. Every existing kind is preserved verbatim — the
-- 20261002100000 discipline, which added `component_life` the same way and
-- said why using `other` would have hidden the domain meaning from the
-- product and the audit trail.
alter table public.restoration_constraints
  drop constraint if exists restoration_constraints_constraint_kind_check;
alter table public.restoration_constraints
  add constraint restoration_constraints_constraint_kind_check check (
    constraint_kind in (
      'precedence','resource','work_zone','material','labour','tooling','bay','crane',
      'vendor','weather','production','approval','permit','isolation','asset_state',
      'quality_hold','component_life',
      'drawing','access','scaffold',
      'other'
    )
  );

create index if not exists idx_restoration_constraints_package
  on restoration_constraints(organization_id, work_package_id, state)
  where work_package_id is not null;
create index if not exists idx_restoration_constraints_work_order
  on restoration_constraints(organization_id, work_order_id)
  where work_order_id is not null;

comment on table public.restoration_constraints is
  'D7.18 (spec III.§28) / D7.05 / D7.11: THE Constraint object. RULING 20 — seven of the spec''s ten types already existed among the seventeen domain kinds this store carried, three names (drawing, access, scaffold) were added to its vocabulary, making the vocabulary a strict SUPERSET of §28''s ten at twenty domain kinds, and no parallel table holds ten of them. Anchored to EXACTLY ONE of a restoration event (Sync Recovery) or a work package (Sync Develop, §27), by CHECK. `state <> ''satisfied'' or verified` is the original 2026-09-21 rule and is unchanged; a §70 wall on verified_by now says the verifier must be a person.';
comment on column public.restoration_constraints.work_package_id is
  'D7.18: the §27 work package this constraint qualifies. Exactly one of (event_id, work_package_id) is set — the generalization of the original NOT NULL event_id, stated as an XOR so a constraint anchored to nothing is refused where before it was impossible.';
comment on column public.restoration_constraints.work_order_id is
  'D11.21 / spec §34 `WorkPackage DEPENDS_ON Constraint`: the canonical WORK IDENTITY (work_orders), named directly. sync_spec34_absent_edge_audit() declared in live SQL that the edge closes at exactly this column (20261207090300:169). When the constraint also names a package, the work order must be a MEMBER of that package — a constraint naming work the package does not contain would make the edge point somewhere the package cannot reach.';
comment on column public.restoration_constraints.probability_of_clearance is
  'I.28: the probability this constraint is cleared by its required-by date, in [0,1], stated by a person WITH A BASIS (>= 20 chars, enforced by CHECK) and never inferred. Non-finite is refused at the table as well as the door because ''NaN''::numeric = ''NaN''::numeric is TRUE in Postgres.';

-- ---------------------------------------------------------------------------
-- 3. THE WALL on the generalized store. Package-anchored rows get a marker
--    door; event-anchored rows are left exactly as Recovery writes them.
--
--    WHY THE DOOR IS SCOPED. Recovery's own definer RPCs
--    (add_restoration_constraint, refresh_restoration_readiness) do not set a
--    marker, and a marker door applied to every row would refuse them — a
--    guard that breaks the caller it was not written for. The tenant arms and
--    the forward-field arms below apply to EVERY row, because those are
--    statements about the data rather than about which door it came through.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_constraint_anchor_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.package_constraint_write', true), '');
  p work_packages%rowtype;
  old_p work_packages%rowtype;
  v_anchor bigint;
  v_label text;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'restoration_constraints is the record of what has to be true before work starts — for restoration events and for §27 work packages alike. Truncating it makes every package look constraint-free in one statement, which is the exact reading spec §27 exists to prevent. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id) then
      return old;
    end if;
    if old.work_package_id is not null then
      select * into p from work_packages where id = old.work_package_id;
      -- Mid-cascade: the package itself is going.
      if not found then
        return old;
      end if;
      if p.released_at is not null then
        raise exception
          'Work package % was released on % against this constraint set. Deleting one of its constraints now rewrites what the release was checked against — the release would still stand, over a set that no longer contains what it cleared.',
          p.package_code, p.released_at
          using errcode = 'insufficient_privilege';
      end if;
      if auth.uid() is null then
        perform record_awp_service_write(old.organization_id,
          format('Constraint on work package %s', p.package_code), tg_op,
          'A package constraint was deleted outside the definer RPCs.');
      end if;
    end if;
    return old;
  end if;

  -- ── Arms that apply to EVERY row, whichever door it came through.
  if new.work_package_id is not null then
    select * into p from work_packages where id = new.work_package_id;
    if not found or p.organization_id <> new.organization_id then
      raise exception
        'this constraint is stamped with an organization that does not own its work package'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.event_id is not null
     and not exists (select 1 from restoration_events e
                      where e.id = new.event_id
                        and e.organization_id = new.organization_id) then
    raise exception
      'this constraint is stamped with an organization that does not own its restoration event'
      using errcode = 'check_violation';
  end if;
  if new.work_order_id is not null then
    if not exists (select 1 from work_orders w
                    where w.id = new.work_order_id
                      and w.organization_id = new.organization_id) then
      raise exception
        'this constraint names a work order from another organization'
        using errcode = 'check_violation';
    end if;
    -- The §34 edge has to point somewhere the package can reach.
    if new.work_package_id is not null
       and not exists (select 1 from work_package_work m
                        where m.work_package_id = new.work_package_id
                          and m.work_order_id = new.work_order_id) then
      raise exception
        'This constraint names work order % and work package %, and that work order is not in that package. An edge from a package to a constraint over work the package does not contain reads as a dependency the package has no way to discharge.',
        new.work_order_id, p.package_code
        using errcode = 'check_violation';
    end if;
  end if;
  if new.expected_clear_date is not null
     and new.expected_clear_date < new.created_at::date then
    raise exception
      'an expected clear date before the constraint was raised is not a forecast'
      using errcode = 'check_violation';
  end if;
  if new.owner_id is not null
     and not exists (select 1 from user_profiles u
                      where u.id = new.owner_id
                        and u.organization_id = new.organization_id) then
    raise exception
      'the owner of a constraint must be a member of the organization that owns it'
      using errcode = 'check_violation';
  end if;

  -- ── THE RELEASED-PACKAGE FREEZE, ON UPDATE AS WELL AS DELETE.
  --    The DELETE arm above names the harm exactly — "the release would still
  --    stand, over a set that no longer contains what it cleared" — and an
  --    UPDATE performs that removal and an addition in one statement. Without
  --    this arm a released package's hard constraint could be flipped back to
  --    `unknown`, re-pointed at another package, or DETACHED to an event
  --    anchor, after which the package's own burn-down answered "UNASSESSED"
  --    for work a named person had released. OLD is the side that matters:
  --    what is being rewritten is what THAT release was checked against.
  if tg_op = 'UPDATE' and old.work_package_id is not null then
    select * into old_p from work_packages where id = old.work_package_id;
    if found and old_p.released_at is not null
       and (new.work_package_id is distinct from old.work_package_id
            or new.event_id is distinct from old.event_id
            or new.work_order_id is distinct from old.work_order_id
            or new.is_hard is distinct from old.is_hard
            or new.state is distinct from old.state
            or new.required_by is distinct from old.required_by
            or new.expected_clear_date is distinct from old.expected_clear_date) then
      raise exception
        'Work package % was released on % against this constraint set. Changing what this constraint IS — its anchor, its work order, whether it is hard, its state or its dates — rewrites what the release was checked against, which a DELETE of the same row is already refused for. Cancel the package instead.',
        old_p.package_code, old_p.released_at
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ── The marker door, for PACKAGE-anchored rows only (see the header).
  --    ANCHORED ON coalesce(NEW, OLD): gating on NEW alone meant a DETACH —
  --    setting work_package_id to NULL and an event_id in its place — walked
  --    past the door and left NO security_events row at all, so the one act
  --    that empties a released package's constraint set was the one act
  --    nothing recorded.
  v_anchor := coalesce(new.work_package_id, case when tg_op = 'UPDATE' then old.work_package_id end);
  if v_anchor is not null then
    select package_code into v_label from work_packages where id = v_anchor;
    -- Caller-conditioned, not marker-conditioned: `app.package_constraint_write`
    -- is an ordinary custom GUC that any role reaching this table can set, so a
    -- backstop written only when the marker is ABSENT could be switched off by
    -- forging it. See enforce_work_package_chain for the same correction. The
    -- marker still decides whether a CLIENT is refused.
    if auth.uid() is null then
      perform record_awp_service_write(new.organization_id,
        format('Constraint on work package %s', coalesce(v_label, v_anchor::text)), tg_op,
        case when new.work_package_id is null
          then 'A package constraint was DETACHED from its work package outside the RPCs, which empties the set a release was checked against.'
          else 'A package constraint written outside the RPCs can be born satisfied, which makes a package readable as ready with nobody named as having verified anything.' end);
    elsif v_marker <> 'granted' then
      raise exception
        'A package constraint is recorded through record_package_constraint, forecast through forecast_package_constraint and closed through clear_package_constraint — closing one is a §70 human act. A direct write does it with no role check, no §70 wall and no audit row.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.enforce_constraint_anchor_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_constraint_anchor_integrity on public.restoration_constraints;
create trigger trg_constraint_anchor_integrity
  before insert or update or delete on public.restoration_constraints
  for each row execute function public.enforce_constraint_anchor_integrity();

drop trigger if exists trg_constraint_no_truncate on public.restoration_constraints;
create trigger trg_constraint_no_truncate
  before truncate on public.restoration_constraints
  for each statement execute function public.enforce_constraint_anchor_integrity();

revoke truncate on table public.restoration_constraints from anon, authenticated, service_role;

comment on function public.enforce_constraint_anchor_integrity() is
  'D7.18: the generalized Constraint store''s wall — tenant arms against the event, the package, the work order and the owner for EVERY writer on INSERT and UPDATE, the §34 edge kept inside the package''s own membership, a DELETE refusal for a released package''s constraints, a statement-level TRUNCATE guard, and a marker door scoped to PACKAGE-anchored rows so Recovery''s own definer paths are untouched.';

-- ---------------------------------------------------------------------------
-- 4. §70 ON THE VERIFIER — SCOPED TO THIS SLICE'S OWN ROWS.
--
--    The satisfied-requires-verifier CHECK has been on this table since
--    2026-09-21 and says a verifier must EXIST. It never said the verifier
--    must be a person, and spec §70 does: no AI or system identity closes a
--    constraint. This wall says it for the rows Slice 7A creates.
--
--    IT IS SCOPED BY `work_package_id is not null`, and the scope is the
--    correction of a real break rather than a weakening. The first draft bound
--    it to EVERY row, including Recovery's event-anchored ones, and that broke
--    two shipped RPCs:
--
--      refresh_restoration_readiness   (20261001090000:288)
--      refresh_recovery_planning_inputs (20261002100000:286)
--
--    Both name `ai_admin` in their OWN authority list, and both stamp
--    `verified_by = auth.uid()` on the DERIVED constraints they resolve to
--    `satisfied` (they must: the 2026-09-21 CHECK requires a verifier). With
--    the wall bound to every row, an authorized `ai_admin` caller got an
--    unhandled `check_violation` instead of a refusal, the surrounding
--    `delete … source_kind='derived'` rolled back with it, and the event kept
--    STALE derived constraints. It fired only when some derived item happened
--    to resolve satisfied, so it was intermittent, and no smoke covers it
--    (all three Recovery transcripts drive as a planner). The first draft's
--    header asserted "no service, page or smoke reaches those RPCs as the AI
--    identity — checked"; that check was by RPC name and missed
--    `src/services/syncRecoveryService.ts` calling the second one, and it
--    checked today's callers rather than the authority envelope the RPCs
--    themselves publish.
--
--    So the wall governs the anchor this slice owns, exactly as the marker
--    door two sections above is scoped for the same reason: a guard bound to
--    another module's rows is a guard that breaks the caller it was not
--    written for. Recovery's event rows keep the behaviour they had before
--    Slice 7A — this file adds no §70 hole there and closes none.
--
--    WHAT REMAINS OPEN, NAMED RATHER THAN ABSORBED. On EVENT-anchored rows
--    Recovery still admits `ai_admin` at `set_restoration_constraint_state`
--    (20260921090000:406), and its refresh functions stamp `verified_by =
--    auth.uid()` — the CALLING IDENTITY, which on those rows may itself be
--    `ai_admin`, because both refresh RPCs admit it. Say that plainly rather
--    than "the calling human": scoping this wall to package rows means an AI
--    identity CAN be recorded as the verifier of an event-anchored derived
--    constraint, and it does happen — running `refresh_restoration_readiness`
--    as `ai_admin` over an event whose labour item resolves `satisfied` leaves
--    `restoration_constraints.verified_by` holding that AI identity's uid. So
--    on those rows "verified" means "an authorized caller ran the rule", and
--    the authorized caller is not necessarily a person. Both are pre-existing
--    Recovery decisions with a live authority envelope behind them, they are
--    not Slice 7A's to change under a §27 header, and closing either means
--    editing Recovery's role list or its derived-provenance model. Register
--    rows D7.05 and D7.18 carry it as a named residual so nobody reads §70 as
--    closed across the whole table.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_constraint_verifier_human on public.restoration_constraints;
create trigger trg_constraint_verifier_human
  before insert or update on public.restoration_constraints
  for each row
  when (new.work_package_id is not null)
  execute function public.enforce_awp_act_is_human(
    'verified_by', 'close a constraint');

-- ---------------------------------------------------------------------------
-- 5. THE DOORS.
-- ---------------------------------------------------------------------------
create or replace function public.record_package_constraint(
  p_package_id bigint,
  p_constraint jsonb
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
  v_spec_type text := nullif(btrim(coalesce(p_constraint->>'constraint_type', '')), '');
  v_kind text;
  v_desc text := nullif(btrim(coalesce(p_constraint->>'description', '')), '');
  v_basis text := nullif(btrim(coalesce(p_constraint->>'basis', '')), '');
  v_phase text := coalesce(nullif(btrim(coalesce(p_constraint->>'phase', '')), ''), 'planning');
  v_owner_role text := nullif(btrim(coalesce(p_constraint->>'owner_role', '')), '');
  -- THE RAW TEXT IS KEPT, and parsed inside BEGIN. Two defects lived in the
  -- first draft of this DECLARE block:
  --
  --   * `(p_constraint->>'is_hard')::boolean` is an unwrapped cast, and DECLARE
  --     runs BEFORE the body — so `is_hard: "maybe"` raised a raw 22P02 ahead
  --     of the authorization gate, and an unauthorised caller got an internal
  --     error shape where every other bad input gets a refusal. The
  --     contingency ledger ruled on exactly this by name (20261203090000:934).
  --
  --   * `sync_text_as_uuid(...)` returns NULL on unparseable text, and the
  --     guards below then skip it as "not supplied". `work_order_id:
  --     "not-a-uuid"` therefore returned SUCCESS with the work order silently
  --     dropped — the §34 edge column left NULL on a constraint the caller
  --     believes names a job, and an owner-less constraint in the burn-down.
  --     ABSENT and PRESENT-BUT-UNPARSEABLE are different answers and get
  --     different ones here.
  v_hard_raw text := nullif(btrim(coalesce(p_constraint->>'is_hard', '')), '');
  v_owner_raw text := nullif(btrim(coalesce(p_constraint->>'owner_id', '')), '');
  v_wo_raw text := nullif(btrim(coalesce(p_constraint->>'work_order_id', '')), '');
  v_hard boolean;
  v_owner_id uuid;
  v_work_order uuid;
  v_required text := nullif(btrim(coalesce(p_constraint->>'required_by', '')), '');
  v_required_by date;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'recording a constraint requires a planning, engineering, supervisory or governance role');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work package not found');
  end if;
  if p.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s; its constraint set is what the release was checked against and does not grow afterwards',
        p.package_code, p.released_at::date));
  end if;
  v_kind := sync_spec28_constraint_kind(v_spec_type);
  if v_kind is null then
    return jsonb_build_object('error',
      'constraint_type must be one of the ten §28 types: drawing, material, access, labour, crane, permit, isolation, scaffold, predecessor, inspection');
  end if;
  if v_desc is null or length(v_desc) < 10 or v_basis is null or length(v_basis) < 10 then
    return jsonb_build_object('error',
      'a description and a basis are required — a constraint nobody can source is one nobody can discharge');
  end if;
  if v_phase not in ('planning', 'execution', 'return_to_service') then
    return jsonb_build_object('error', 'phase must be planning, execution or return_to_service');
  end if;
  -- Parsed HERE, behind the role gate, and refused by name.
  if v_hard_raw is null then
    v_hard := true;
  else
    v_hard := sync_text_as_boolean(v_hard_raw);
    if v_hard is null then
      return jsonb_build_object('error',
        format('is_hard must be true or false; "%s" is neither, and defaulting it either way decides whether this constraint can stop a release', v_hard_raw));
    end if;
  end if;
  if v_wo_raw is not null then
    v_work_order := sync_text_as_uuid(v_wo_raw);
    if v_work_order is null then
      return jsonb_build_object('error',
        format('work_order_id "%s" is not an identifier. It is not treated as "no work order supplied": a constraint recorded as naming a job, with the name silently dropped, leaves the §34 package-to-constraint edge pointing at nothing.', v_wo_raw));
    end if;
  end if;
  if v_owner_raw is not null then
    v_owner_id := sync_text_as_uuid(v_owner_raw);
    if v_owner_id is null then
      return jsonb_build_object('error',
        format('owner_id "%s" is not an identifier. A constraint recorded as owned, with the owner silently dropped, is a constraint the burn-down lists with nobody to chase.', v_owner_raw));
    end if;
  end if;
  if v_required is not null then
    begin
      v_required_by := v_required::date;
    exception when others then
      return jsonb_build_object('error', 'required_by is not a date');
    end;
  end if;
  if v_work_order is not null
     and not exists (select 1 from work_package_work m
                      where m.work_package_id = p.id and m.work_order_id = v_work_order) then
    return jsonb_build_object('error',
      'that work order is not in this package — a constraint on work the package does not contain has nothing to block');
  end if;
  if v_owner_id is not null
     and not exists (select 1 from user_profiles u
                      where u.id = v_owner_id and u.organization_id = v_org) then
    return jsonb_build_object('error', 'the constraint owner is not a member of this organization');
  end if;

  perform set_config('app.package_constraint_write', 'granted', true);
  insert into restoration_constraints (organization_id, event_id, work_package_id,
    work_order_id, constraint_kind, phase, is_hard, state, description, basis,
    source_kind, owner_role, owner_id, required_by, created_by)
  values (v_org, null, p.id, v_work_order, v_kind, v_phase, v_hard, 'unknown',
    v_desc, v_basis, 'manual', v_owner_role, v_owner_id, v_required_by, auth.uid())
  returning id into v_id;
  perform set_config('app.package_constraint_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package_constraint', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'constraint_id', v_id, 'action', 'recorded'),
    null,
    jsonb_build_object('specType', v_spec_type, 'constraint_kind', v_kind,
      'phase', v_phase, 'is_hard', v_hard, 'state', 'unknown',
      'description', v_desc, 'required_by', v_required_by));

  return jsonb_build_object('constraint_id', v_id, 'package_code', p.package_code,
    'specType', v_spec_type, 'constraint_kind', v_kind, 'state', 'unknown',
    'note', 'Recorded as UNKNOWN, which is not "satisfied" and not "blocked". It becomes satisfied only when a named person verifies it.');
end
$$;

revoke all on function public.record_package_constraint(bigint, jsonb) from public, anon;
grant execute on function public.record_package_constraint(bigint, jsonb) to authenticated;

comment on function public.record_package_constraint(bigint, jsonb) is
  'D7.18: records one §28 Constraint against a §27 work package, on the ONE canonical constraint store (RULING 20). The ten spec type names map through sync_spec28_constraint_kind; the row is born `unknown`, never `satisfied`.';

create or replace function public.forecast_package_constraint(
  p_constraint_id uuid,
  p_forecast jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c restoration_constraints%rowtype;
  p work_packages%rowtype;
  v_expected text := nullif(btrim(coalesce(p_forecast->>'expected_clear_date', '')), '');
  v_expected_date date;
  v_prob numeric := sync_finite_money(p_forecast->>'probability_of_clearance');
  v_prob_basis text := nullif(btrim(coalesce(p_forecast->>'probability_basis', '')), '');
  v_impact numeric := sync_finite_money(p_forecast->>'schedule_impact_days');
  v_impact_basis text := nullif(btrim(coalesce(p_forecast->>'impact_basis', '')), '');
  v_required text := nullif(btrim(coalesce(p_forecast->>'required_by', '')), '');
  v_required_by date;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'forecasting a constraint requires a planning, engineering, supervisory or governance role');
  end if;
  select * into c from restoration_constraints
   where id = p_constraint_id and organization_id = v_org and work_package_id is not null;
  if not found then
    return jsonb_build_object('error', 'package constraint not found');
  end if;
  select * into p from work_packages where id = c.work_package_id;
  if p.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s; its constraint forecasts are the record the release was made against',
        p.package_code, p.released_at::date));
  end if;

  if p_forecast ? 'probability_of_clearance'
     and nullif(btrim(coalesce(p_forecast->>'probability_of_clearance', '')), '') is not null then
    if v_prob is null then
      return jsonb_build_object('error',
        'the probability of clearance must be a finite number between 0 and 1');
    end if;
    if v_prob < 0 or v_prob > 1 then
      return jsonb_build_object('error',
        format('a probability of clearance of %s is not a probability — it is a number between 0 and 1 or it is nothing', v_prob));
    end if;
    if v_prob_basis is null or length(v_prob_basis) < 20 then
      return jsonb_build_object('error',
        'a probability of clearance needs its basis (20 characters minimum): somebody will schedule against this number');
    end if;
  end if;
  if p_forecast ? 'schedule_impact_days'
     and nullif(btrim(coalesce(p_forecast->>'schedule_impact_days', '')), '') is not null then
    if v_impact is null or v_impact < 0 then
      return jsonb_build_object('error',
        'the schedule impact must be a finite number of days, zero or more');
    end if;
    if v_impact_basis is null or length(v_impact_basis) < 10 then
      return jsonb_build_object('error',
        'a schedule impact needs its basis (10 characters minimum) — the restoration_blockers rule, applied to the constraint that causes the delay');
    end if;
  end if;
  if v_expected is not null then
    begin
      v_expected_date := v_expected::date;
    exception when others then
      return jsonb_build_object('error', 'expected_clear_date is not a date');
    end;
  end if;
  if v_required is not null then
    begin
      v_required_by := v_required::date;
    exception when others then
      return jsonb_build_object('error', 'required_by is not a date');
    end;
  end if;

  v_prev := jsonb_build_object('required_by', c.required_by,
    'expected_clear_date', c.expected_clear_date,
    'probability_of_clearance', c.probability_of_clearance,
    'schedule_impact_days', c.schedule_impact_days);

  perform set_config('app.package_constraint_write', 'granted', true);
  update restoration_constraints
     set required_by = coalesce(v_required_by, required_by),
         expected_clear_date = coalesce(v_expected_date, expected_clear_date),
         probability_of_clearance = coalesce(v_prob, probability_of_clearance),
         probability_basis = coalesce(v_prob_basis, probability_basis),
         schedule_impact_days = coalesce(v_impact, schedule_impact_days),
         impact_basis = coalesce(v_impact_basis, impact_basis)
   where id = c.id;
  perform set_config('app.package_constraint_write', '', true);

  select * into c from restoration_constraints where id = c.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package_constraint', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'constraint_id', c.id, 'action', 'forecast'),
    v_prev,
    jsonb_build_object('required_by', c.required_by,
      'expected_clear_date', c.expected_clear_date,
      'probability_of_clearance', c.probability_of_clearance,
      'probability_basis', c.probability_basis,
      'schedule_impact_days', c.schedule_impact_days));

  return jsonb_build_object('constraint_id', c.id, 'required_by', c.required_by,
    'expected_clear_date', c.expected_clear_date,
    'probability_of_clearance', c.probability_of_clearance,
    'schedule_impact_days', c.schedule_impact_days,
    'note', 'A forecast, not a clearance. The state is unchanged and only a named person verifying it makes this constraint satisfied.');
end
$$;

revoke all on function public.forecast_package_constraint(uuid, jsonb) from public, anon;
grant execute on function public.forecast_package_constraint(uuid, jsonb) to authenticated;

comment on function public.forecast_package_constraint(uuid, jsonb) is
  'I.28 (D7.07): records the FORWARD-LOOKING fields of one constraint — required-by, expected clear date, probability of clearance with its basis, schedule impact with its basis. Refuses a probability outside [0,1], a non-finite number, and either number with no stated basis. It never changes state: forecasting is not clearing.';

create or replace function public.clear_package_constraint(
  p_constraint_id uuid,
  p_state text,
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
  c restoration_constraints%rowtype;
  p work_packages%rowtype;
  v_basis text := nullif(btrim(coalesce(p_basis, '')), '');
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- ai_admin is absent from this list AND refused by the §70 wall on
  -- verified_by. Two doors, because the role list is policy and the wall is
  -- enforcement: a later edit to one is not an edit to the other.
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer', 'planner', 'supervisor') then
    return jsonb_build_object('error',
      'closing a constraint requires a planning, engineering, supervisory or governance role — and spec §70 reserves it for a person');
  end if;
  if p_state not in ('unknown', 'satisfied', 'blocked', 'not_applicable') then
    return jsonb_build_object('error',
      'state must be unknown, satisfied, blocked or not_applicable');
  end if;
  select * into c from restoration_constraints
   where id = p_constraint_id and organization_id = v_org and work_package_id is not null;
  if not found then
    return jsonb_build_object('error', 'package constraint not found');
  end if;
  select * into p from work_packages where id = c.work_package_id;
  if p.released_at is not null then
    return jsonb_build_object('error',
      format('work package %s was released on %s against this constraint set', p.package_code, p.released_at::date));
  end if;
  -- PRESERVED VERBATIM from set_restoration_constraint_state
  -- (20260921090000:398). Permit, isolation and asset-state truth comes from
  -- the canonical operating and release controls, not from a toggle — and the
  -- project path gets no exemption Recovery does not have.
  if p_state = 'satisfied' and c.constraint_kind in ('permit', 'isolation', 'asset_state') then
    return jsonb_build_object('error',
      'permit/isolation/asset-state truth must come from canonical operating and release controls, not a work-package toggle');
  end if;
  if p_state in ('satisfied', 'not_applicable') and (v_basis is null or length(v_basis) < 10) then
    return jsonb_build_object('error',
      'evidence or basis is required to clear a constraint (10 characters minimum)');
  end if;

  v_prev := jsonb_build_object('state', c.state, 'verified_by', c.verified_by,
    'verified_at', c.verified_at, 'basis', c.basis);

  perform set_config('app.package_constraint_write', 'granted', true);
  update restoration_constraints
     set state = p_state,
         basis = coalesce(v_basis, basis),
         verified_by = case when p_state in ('satisfied', 'not_applicable') then auth.uid() end,
         verified_at = case when p_state in ('satisfied', 'not_applicable') then now() end
   where id = c.id;
  perform set_config('app.package_constraint_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package_constraint', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'constraint_id', c.id, 'action', 'state_set'),
    v_prev,
    jsonb_build_object('state', p_state, 'verified_by',
      case when p_state in ('satisfied', 'not_applicable') then auth.uid() end,
      'basis', coalesce(v_basis, c.basis)));

  return jsonb_build_object('constraint_id', c.id, 'state', p_state,
    'package_code', p.package_code);
end
$$;

revoke all on function public.clear_package_constraint(uuid, text, text) from public, anon;
grant execute on function public.clear_package_constraint(uuid, text, text) to authenticated;

comment on function public.clear_package_constraint(uuid, text, text) is
  'D7.18 / §70: sets a package constraint''s state. Satisfied requires a verifier (the 2026-09-21 table CHECK) and that verifier must be a PERSON (the §70 wall on verified_by). Permit, isolation and asset-state constraints still cannot be satisfied by hand — Recovery''s rule, preserved rather than exempted.';

-- ---------------------------------------------------------------------------
-- 6. THE ONE RELEASE VERDICT (D7.06/D7.10/D7.17 × §70).
--
--    ONE PREDICATE, TWO CONSUMERS — the Slice 3C shape (one gate-blocker
--    predicate read by several sites), and it is here because the first draft
--    of this slice did the opposite and reproduced this programme's signature
--    defect for the seventh consecutive chunk.
--
--    In that draft `release_work_package` refused on FIVE conditions and
--    `get_case_work_packages` re-implemented the verdict inline on THREE,
--    under a comment claiming it was "stated by the same rules
--    release_work_package refuses through — never a second verdict". The
--    screen therefore printed "Every hard constraint is cleared; release is a
--    §70 human act and has not been performed" for a package with NO WORK
--    ORDERS, for a package under an UNRELEASED PARENT, and for a CANCELLED
--    package — three states the door refuses. The weaker copy was the one on
--    the surface a supervisor acts on, and it read as ready. That is the exact
--    failure §27 exists to prevent, committed by the code meant to prevent it.
--
--    So there is one function. `release_work_package` refuses through it and
--    `get_case_work_packages` renders its `reason` verbatim; neither restates
--    a rule. The sentences are written to be true in both places — the screen
--    says what the door would say, in the door's own words.
--
--    REFUSAL-FIRST, in the order that matters:
--      1. a CANCELLED package is not released — withdrawn is not ready;
--      2. an already-RELEASED package reports the release that happened;
--      3. a package with NO constraints recorded refuses OUTRIGHT — an
--         unassessed package is not constraint-free;
--      4. a package containing no work refuses — releasing an empty container
--         tells a crew to start nothing and reports progress for it;
--      5. a package whose parent is not released refuses — releasing an IWP
--         under an unreleased CWP releases work whose predecessors nobody
--         cleared;
--      6. a package with any HARD constraint unknown or blocked refuses, and
--         NAMES them.
-- ---------------------------------------------------------------------------
create or replace function public.sync_work_package_release_verdict(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p work_packages%rowtype;
  parent work_packages%rowtype;
  v_total int;
  v_open_hard int;
  v_work int;
  v_open jsonb;
begin
  select * into p from work_packages where id = p_package_id;
  if not found then
    return jsonb_build_object('verdict', 'not_found', 'canRelease', false,
      'reason', 'work package not found');
  end if;

  select count(*) filter (where true),
         count(*) filter (where is_hard and state in ('unknown', 'blocked'))
    into v_total, v_open_hard
    from restoration_constraints
   where work_package_id = p.id;
  select count(*) into v_work from work_package_work where work_package_id = p.id;

  if p.status = 'cancelled' then
    return jsonb_build_object('verdict', 'cancelled', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work,
      'reason', format('CANCELLED — work package %s was withdrawn%s. A cancelled work package is not released.',
        p.package_code,
        case when p.released_at is not null
          then format(' after being released on %s', p.released_at::date) else '' end));
  end if;

  if p.released_at is not null then
    return jsonb_build_object('verdict', 'released', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work,
      'reason', format('RELEASED on %s — every hard constraint recorded against work package %s was cleared and a named person said so. It is not released again.',
        p.released_at::date, p.package_code));
  end if;

  if v_total = 0 then
    return jsonb_build_object('verdict', 'unassessed', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', 0,
      'openHard', 0, 'workOrders', v_work,
      'reason', format('UNASSESSED — no constraint has been recorded against work package %s. That is not "constraint-free": reporting zero open constraints for a package nobody assessed is the reading spec §27 exists to prevent. Record its drawing, material, access, labour, crane, permit, isolation, scaffold, predecessor and inspection position first.',
        p.package_code));
  end if;

  if v_work = 0 then
    return jsonb_build_object('verdict', 'empty', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', 0,
      'reason', format('NOT READY — work package %s contains no work orders; releasing an empty package tells a crew to start nothing and reports progress for it.',
        p.package_code));
  end if;

  if p.parent_package_id is not null then
    select * into parent from work_packages where id = p.parent_package_id;
    if parent.released_at is null then
      return jsonb_build_object('verdict', 'parent_unreleased', 'canRelease', false,
        'packageCode', p.package_code, 'constraintsRecorded', v_total,
        'openHard', v_open_hard, 'workOrders', v_work,
        'reason', format('NOT READY — work package %s hangs from %s (%s), which is not released. Releasing this package would release work whose predecessors nobody has cleared.',
          p.package_code, parent.package_code, parent.package_type));
    end if;
  end if;

  if v_open_hard > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'constraint_id', x.id, 'kind', x.constraint_kind, 'state', x.state,
             'description', x.description, 'owner_role', x.owner_role,
             'required_by', x.required_by, 'expected_clear_date', x.expected_clear_date)
             order by x.constraint_kind, x.id), '[]'::jsonb)
      into v_open
      from restoration_constraints x
     where x.work_package_id = p.id
       and x.is_hard and x.state in ('unknown', 'blocked');
    return jsonb_build_object('verdict', 'not_ready', 'canRelease', false,
      'packageCode', p.package_code, 'constraintsRecorded', v_total,
      'openHard', v_open_hard, 'workOrders', v_work, 'openConstraints', v_open,
      'reason', format('NOT READY: %s hard constraint(s) on work package %s are unknown or blocked. A package is released when its constraints are cleared, not when somebody needs the progress.',
        v_open_hard, p.package_code));
  end if;

  return jsonb_build_object('verdict', 'ready_for_human', 'canRelease', true,
    'packageCode', p.package_code, 'constraintsRecorded', v_total,
    'openHard', 0, 'workOrders', v_work,
    'reason', format('Every hard constraint recorded against work package %s is cleared, it contains %s work order(s)%s. Release is a §70 human act and has not been performed.',
      p.package_code, v_work,
      case when p.parent_package_id is not null
        then ' and its parent is released' else ' and it is the head of its chain' end));
end
$$;

revoke all on function public.sync_work_package_release_verdict(bigint)
  from public, anon, authenticated;

comment on function public.sync_work_package_release_verdict(bigint) is
  'D7.06/D7.11: THE release verdict for one §27 work package — cancelled, released, unassessed, empty, parent_unreleased, not_ready or ready_for_human, with the sentence a person reads. ONE predicate (the Slice 3C shape): release_work_package refuses through it and get_case_work_packages renders its reason verbatim, so the screen cannot say "cleared, awaiting a signature" about a package the door will refuse. Revoked from clients — it carries no org filter of its own and is only ever called from inside a definer that has already established the tenant.';
create or replace function public.release_work_package(
  p_package_id bigint,
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
  p work_packages%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_verdict jsonb;
  v_total int;
  v_work int;
  v_prev jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'supervisor') then
    return jsonb_build_object('error',
      'releasing a work package requires a supervisory, management or governance role — spec §70 reserves "safe to start" for an authorized person');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'work package not found');
  end if;
  if v_note is null or length(v_note) < 20 then
    return jsonb_build_object('error',
      'say what you are releasing and on what basis (20 characters minimum) — the note is the record that a person judged this work safe to start');
  end if;

  -- THE ONE VERDICT. Every readiness refusal below this line comes from
  -- sync_work_package_release_verdict, which is the same function
  -- get_case_work_packages renders — so the screen cannot describe a package
  -- as cleared-and-awaiting-a-signature while this door refuses it.
  v_verdict := sync_work_package_release_verdict(p.id);
  if (v_verdict->>'canRelease')::boolean is not true then
    return jsonb_build_object('error', v_verdict->>'reason',
      'verdict', v_verdict->>'verdict')
      || (case when v_verdict ? 'openConstraints'
            then jsonb_build_object('openConstraints', v_verdict->'openConstraints')
            else '{}'::jsonb end);
  end if;
  v_total := (v_verdict->>'constraintsRecorded')::int;
  v_work := (v_verdict->>'workOrders')::int;

  v_prev := jsonb_build_object('status', p.status, 'released_at', p.released_at);

  perform set_config('app.work_package_write', 'granted', true);
  update work_packages
     set status = 'released', released_by = auth.uid(), released_at = now(),
         release_note = v_note
   where id = p.id;
  perform set_config('app.work_package_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'work_package', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', p.development_case_id, 'work_package_id', p.id,
      'package_code', p.package_code, 'action', 'released'),
    v_prev,
    jsonb_build_object('status', 'released', 'released_by', auth.uid(),
      'note', v_note, 'constraintsChecked', v_total, 'workOrders', v_work));

  return jsonb_build_object('work_package_id', p.id, 'package_code', p.package_code,
    'status', 'released', 'constraintsChecked', v_total, 'workOrders', v_work,
    -- CONDITIONAL ON A PARENT EXISTING. The first draft asserted "its parent
    -- is released" on every success, including head (engineering) packages,
    -- which have no parent — a claim about a row that does not exist.
    'note', format('READY: every hard constraint recorded against this package is satisfied or not applicable, %s, and a named person said so.',
      case when p.parent_package_id is not null
        then 'its parent is released' else 'it is the head of its chain' end));
end
$$;

revoke all on function public.release_work_package(bigint, text) from public, anon;
grant execute on function public.release_work_package(bigint, text) to authenticated;

comment on function public.release_work_package(bigint, text) is
  'D7.06/D7.10/D7.17 × §70: the act of releasing a §27 work package. Every readiness refusal comes from sync_work_package_release_verdict — the ONE predicate get_case_work_packages also renders — so a cancelled package, an already-released one, an UNASSESSED one, an empty one, one under an unreleased parent and one with any hard constraint unknown or blocked are refused in the same words the screen shows. The releaser is a person: the role gate excludes ai_admin and enforce_awp_act_is_human refuses it in released_by for every writer.';

-- ---------------------------------------------------------------------------
-- 7. THE §34 EDGE LEDGER, TRANSFORMED (not re-typed).
--
--    Slice 5C recorded `WorkPackage DEPENDS_ON Constraint` as absent because
--    "§27 WorkPackage and §28 Constraint are not built". Both are built now,
--    and 5D's information engine declared IN LIVE SQL the exact column whose
--    existence closes the edge. This asks the catalogue rather than trusting
--    this file's own prose, and RAISES if the ledger is not in the shape it
--    was left in — a blind edit to a ledger is how one starts lying.
-- ---------------------------------------------------------------------------
do $spec34awp$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_spec34_edges';
  if v_def is null then
    raise exception
      'sync_spec34_edges does not exist — the Slice 5C ledger this file corrects is missing, and writing a second ledger instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'restoration_constraints'
                    and column_name = 'work_order_id') then
    raise exception
      'restoration_constraints.work_order_id does not exist, so WorkPackage DEPENDS_ON Constraint is genuinely absent and this correction would be the false claim it exists to remove.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'work_packages') then
    raise exception
      'work_packages does not exist, so §27''s WorkPackage is still unbuilt and the tail of this edge has nothing to hang from.'
      using errcode = 'check_violation';
  end if;
  if position('restoration_constraints.work_package_id' in v_def) > 0 then
    null;  -- already corrected by a previous run of this migration
  else
    v_new := replace(v_def,
      $old$'home','none — spec §27 WorkPackage and §28 Constraint are not built','status','absent',$old$,
      $new$'home','restoration_constraints.work_package_id + .work_order_id (20261210090100, register rows D7.17/D7.18)','status','live_elsewhere',$new$);
    if v_new = v_def then
      raise exception
        'the WorkPackage DEPENDS_ON Constraint entry of sync_spec34_edges was not found in the shape Slice 5C left it — do not edit a ledger blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      $old$'note','Both endpoints are unbuilt objects (II.4 Advanced Work Packaging). Modelling the edge before its endpoints exist is how a parallel store starts.'$old$,
      $new$'note','CORRECTED 20261210090100: both endpoints are built. RULING 19 — work_orders stays the work identity and `work_packages` is the typed AWP context beside restoration_event_work and outage_work; RULING 20 — `restoration_constraints` IS §28 Constraint and now carries the package anchor AND work_order_id, which is the column sync_spec34_absent_edge_audit() itself named as the closing condition. Not on the CDE thread: the edge lives on the constraint store, which has its own reads, and this ledger does not re-implement them.'$new$);
    if position('CORRECTED 20261210090100' in v_new) = 0 then
      raise exception
        'the WorkPackage DEPENDS_ON Constraint note of sync_spec34_edges was not found — a ledger whose status and whose note disagree is worse than one that is simply wrong, so this fails rather than moving the status alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$spec34awp$;

-- ---------------------------------------------------------------------------
-- 8. THE ABSENT-EDGE AUDIT, ACTED ON RATHER THAN LEFT TO ALARM.
--
--    `sync_spec34_absent_edge_audit()` (20261207090300) exists so that a
--    ledger's absence claim is CHECKED rather than asserted, and its own note
--    says what a caller should do when it fires: "`newlyClosableCount` above
--    zero means the endpoint got built and the ledger's prose is stale". This
--    slice is the endpoint getting built, so leaving the audit to report a
--    closable edge forever — with its prose still saying "spec §27 WorkPackage
--    is unbuilt" and "FOUR ... as ABSENT" — would be the unchecked-prose
--    defect that file was written to catch, committed by the file that closed
--    the gap.
--
--    So the WorkPackage tuple is REMOVED from the absent list and the note is
--    corrected, by TRANSFORMATION of the live body — the three remaining
--    entries are never re-typed, so nothing else in the audit can drift. Both
--    replacements RAISE if the body is not in the shape 5D left it in.
-- ---------------------------------------------------------------------------
do $spec34audit$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_spec34_absent_edge_audit';
  if v_def is null then
    raise exception
      'sync_spec34_absent_edge_audit does not exist — the Slice 5D audit this file acts on is missing, and writing a second one instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('THREE of' in v_def) > 0 then
    null;  -- already corrected by a previous run of this migration
  else
    v_new := replace(v_def,
$old$      ('WorkPackage DEPENDS_ON Constraint',
       'restoration_constraints', 'work_order_id',
       'spec §27 WorkPackage is unbuilt. A two-hop path exists (restoration_constraints.event_work_id → restoration_event_work.work_order_id) and a transitive path is not the edge. This closes when the canonical Constraint store names the canonical work identity directly.'),
$old$, '');
    if v_new = v_def then
      raise exception
        'the WorkPackage entry of sync_spec34_absent_edge_audit was not found in the shape Slice 5D left it — do not edit an audit blind; re-derive this correction against the current body.'
        using errcode = 'check_violation';
    end if;
    v_new := replace(v_new,
      'states FOUR of §34''''s nineteen relationships as ABSENT (five until this file closed Benefit MEASURES Objective on value_metrics.objective_id)',
      'states THREE of §34''''s nineteen relationships as ABSENT (five until 20261207090300 closed Benefit MEASURES Objective on value_metrics.objective_id, and four until 20261210090100 closed WorkPackage DEPENDS_ON Constraint at restoration_constraints.work_order_id — the column this audit itself named as the closing condition)');
    if position('states THREE of' in v_new) = 0 then
      raise exception
        'the note of sync_spec34_absent_edge_audit was not found — an audit whose list and whose note disagree is worse than one that is simply wrong, so this fails rather than moving the list alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$spec34audit$;

comment on function public.sync_spec34_absent_edge_audit() is
  'D11.21 / spec III.§34 ruling 5D-R16, updated by Slice 7A: makes the remaining THREE absent edges falsifiable. Benefit MEASURES Objective was closed by 20261207090300; WorkPackage DEPENDS_ON Constraint was closed by 20261210090100 at restoration_constraints.work_order_id — the exact column this audit named as its closing condition, which is what an audit is FOR. For each remaining edge it names the table and column whose existence would close it and asks information_schema.';
