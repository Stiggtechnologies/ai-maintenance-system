-- ============================================================================
-- Sync Develop Slice 5C — the digital thread, part 4:
--   D11.07  downstream impact and change-receipt tracking (spec II.2)
--   D11.21  the nineteen core graph relationships (spec III.§34), reconciled
--           onto the ONE graph
--
-- II.2's last two questions: "what downstream object is affected, has the
-- operating system received the change."
--
-- ── RULING 5C-R12 — A RECEIPT IS PRODUCED BY THE CHANGE, NOT BY A REPORT ────
--
-- The register row for D11.07 cites two propagation precedents that already
-- work this way: the MOC re-review trigger on a configuration change
-- (00000000000012:402) and `propagate_risk_objective_change`
-- (20260921110102:629). Both fire ON the change. This follows them.
--
-- A receipt is written by an AFTER trigger on `thread_object_versions`, at the
-- moment a version becomes authoritative AND supersedes another. Not by a
-- nightly job and not by a screen, for one reason: a receipt produced by a
-- report exists only while somebody is looking at the report, and the state
-- II.2 is asking about — "has the operating system received the change" — is
-- exactly the state nobody is looking at.
--
-- A FIRST ISSUE PRODUCES NO RECEIPTS. There is no change to acknowledge: the
-- object did not have a previous revision, so nothing downstream was ever
-- built on one. Producing receipts anyway would fill the outstanding list with
-- notices nobody can act on, and an outstanding list nobody can act on gets
-- cleared in bulk.
--
-- ── RULING 5C-R13 — UNACKNOWLEDGED IS A STATE, NOT AN ABSENCE ──────────────
--
-- The receipt row is written at `unacknowledged` and stays there until a
-- person moves it. This is the whole design. A change with no receipt row is
-- indistinguishable from a change everybody has seen, which is why "we sent
-- the revision" and "the operating system has it" get confused in every
-- project post-mortem ever written.
--
-- There are exactly three terminal readings, and `not_applicable` is one of
-- them on purpose: sometimes the change genuinely does not reach the
-- downstream object, and forcing that to be recorded as "acknowledged" would
-- destroy the difference between "we looked and it does not affect us" and "we
-- looked and we have updated". Both need a note; neither may be silent.
--
-- ── RULING 5C-R14 — THE PERSON WHO MADE THE CHANGE DOES NOT ACKNOWLEDGE IT ──
--
-- §42's segregation-of-duties standard, applied at the smallest scale it has:
-- the engineer who declared Rev C authoritative cannot also record that the
-- downstream package received it. A receipt the sender signs is a delivery
-- confirmation the sender wrote — this repository already refuses the same
-- shape for a frontline finding (20261205090100: the raiser cannot disposition
-- their own) and for a deliverable acceptance (20261105090100).
--
-- §70 applies on top: no AI or system identity acknowledges a change receipt.
-- One wall, 20261205090000's, bound to `acknowledged_by`, INSERT and UPDATE.
--
-- ── RULING 5C-R15 — THE TRAVERSAL REFUSES ON A GAP ─────────────────────────
--
-- `get_case_thread_impact` walks live hops downstream. If ANY of these is true
-- inside the region it walked, it REFUSES and names the gap instead of
-- returning the set it reached:
--
--   * a traversed hop SKIPS chain positions (5C-R10) — there is an object
--     class between these two that nobody registered, so the reachable set is
--     a floor, not the affected set;
--   * a traversed object has NO authoritative version — its downstream cannot
--     be said to be built on anything current;
--   * the source object itself has no authoritative version;
--   * the traversal hit the depth limit.
--
-- And an EMPTY answer is a refusal, never a zero: "0 downstream impacts" over
-- an object nobody linked reads as "this change is safe", and it is the single
-- most dangerous sentence this product could print. The refusal says which of
-- the two it is — the object is genuinely terminal in the chain, or the object
-- was never joined to anything.
--
-- ── RULING 5C-R16 — §34's NINETEEN EDGES: ONE GRAPH, AND AN HONEST LEDGER ───
--
-- The instruction is that §34's nineteen relationships reconcile with the
-- existing asset_dependencies / case_interfaces graph rather than starting a
-- parallel store. Reconciling them turned up a fact worth stating plainly:
--
--   NOT ONE of §34's nineteen edges is asset → asset.
--
-- `asset_dependencies` has two NOT NULL foreign keys to `assets`, so it can
-- hold exactly the edges whose BOTH endpoints are assets — and §34 has none.
-- Its edges are Objective→Objective, Risk→Objective, Decision→Evidence,
-- Contract→Asset, Lesson→AssetClass, and so on. Widening those two NOT NULLs
-- to admit them would be weakening an invariant that holds for every existing
-- row of a live table in order to model something else, which is the move this
-- repository refuses by name (20261205090200 ruling 1 refused exactly it).
--
-- So the reconciliation is NOT "move the nineteen into asset_dependencies".
-- It is:
--
--   (a) ONE GRAPH PAYLOAD. `get_case_thread_graph` emits the thread's objects
--       and hops, the ANCHOR edge from every object to its asset, and the
--       `asset_dependencies` edges among those anchor assets — in the single
--       `DependencyGraph` shape `src/lib/interdependency` already traverses.
--       One node space, one traversal, `propagateLoss` and
--       `singlePointsOfFailure` unchanged. A change to a drawing and a loss of
--       the switchgear that drawing hangs on are answered by the same walk.
--
--   (b) ONE LEDGER, `sync_spec34_edges()`, naming all nineteen with the
--       canonical home each one lives in TODAY and its honest status. FIVE of
--       them have no home in this repository because an endpoint OBJECT does
--       not exist yet:
--
--           WorkPackage DEPENDS_ON Constraint   (§27 and §28 both unbuilt)
--           Contract PROVIDES Asset             (§24 lands with procurement)
--           Asset SUPPORTS Objective            (no stored relation; the
--                                                transitive path through a
--                                                requirement is NOT the edge)
--           Benefit MEASURES Objective          (§32 unbuilt)
--           Lesson APPLIES_TO AssetClass        (§33 unbuilt)
--
--       Those are named as absent. They are NOT modelled here, because
--       modelling an edge whose endpoints do not exist is how a parallel store
--       gets started.
--
--   (c) NO COUNT THIS FILE DID NOT COMPUTE. An edge whose canonical home is
--       another family's table reports `count: null` and says which read owns
--       it. Re-implementing "how many risks threaten an objective" here would
--       be a second implementation of a predicate that already has one, which
--       is how a chain reports itself complete from one end and broken from
--       the other (20261204090000 ruling 1 states this for the WBS question,
--       and this obeys the same rule).
--
-- Canonical reuse: thread_objects, thread_links, thread_object_versions,
-- design_requirements, assets, asset_dependencies, audit_events,
-- security_events, app_current_org(), enforce_frontline_judgement_is_human,
-- record_frontline_service_write, src/lib/interdependency.
-- ============================================================================

create or replace function public.sync_thread_receipt_statuses()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['unacknowledged', 'acknowledged', 'not_applicable']::text[];
$$;

revoke all on function public.sync_thread_receipt_statuses() from public, anon;
grant execute on function public.sync_thread_receipt_statuses() to authenticated, service_role;

comment on function public.sync_thread_receipt_statuses() is
  'D11.07 ruling 5C-R13: the three readings of a change receipt. `unacknowledged` is the state a receipt is BORN in, not the absence of one — a change with no receipt row is indistinguishable from a change everybody has seen.';

-- ---------------------------------------------------------------------------
-- 1. The receipt.
-- ---------------------------------------------------------------------------
create table if not exists public.thread_change_receipts (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- The object that has to answer.
  thread_object_id bigint not null references thread_objects(id) on delete cascade,
  -- The object that changed, and the revision that did it.
  source_object_id bigint not null references thread_objects(id) on delete cascade,
  source_version_id bigint not null references thread_object_versions(id) on delete cascade,
  -- Snapshotted so the receipt still says what changed after the version rows
  -- have moved on. A receipt that has to join three tables to state its own
  -- subject is a receipt that reads as blank the first time one of them moves.
  source_object_ref text not null,
  source_version_label text not null,
  change_summary text not null,
  hops int not null check (hops >= 1),
  -- WAS THE AFFECTED SET A FLOOR? (ruling 5C-R15, applied to the producer.)
  --
  -- `get_case_thread_impact` REFUSES to state the affected set when the region
  -- it walked has a gap — but the trigger that raises these receipts walks the
  -- same region and acted on it. Without this column the product refuses to
  -- SAY what a change reaches while quietly raising receipts over it, and a
  -- case whose receipts are all answered then reads as a change that landed
  -- everywhere. NULLABLE on purpose: null means nobody assessed the region,
  -- which is a third state and not the same as `false`.
  source_region_gapped boolean,
  source_region_gap_note text,
  status text not null default 'unacknowledged'
    check (status = any (sync_thread_receipt_statuses())),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  acknowledgement_note text,
  created_at timestamptz not null default now(),
  -- One receipt per downstream object per change. A second copy of the same
  -- notice is a second thing to clear, and clearing in bulk is how a receipt
  -- register dies.
  unique (source_version_id, thread_object_id),
  constraint thread_receipt_not_self check (thread_object_id <> source_object_id),
  -- Answered means answered BY somebody, WITH something, AT a time. All three
  -- or none: `acknowledged_by` in particular is what the §70 wall reads, and a
  -- NULL actor is an early return in that wall.
  --
  -- TWO EQUALITIES, NOT ONE. Folding them into
  -- `(status = 'unacknowledged') = (acknowledged_at is null and acknowledged_by is null)`
  -- reads the same and is not: on the negative side the conjunction only
  -- requires ONE of the two to be non-null, so
  -- `status='acknowledged', acknowledged_at=now(), acknowledged_by=null`
  -- satisfies it. That row then walks past BOTH walls this table has — the §70
  -- trigger returns early on a NULL actor, and the §42 check below is gated on
  -- `acknowledged_by is not null` — leaving a receipt answered by nobody. The
  -- three sibling tables in this slice (thread_object_retirement,
  -- thread_link_severance, thread_version_declaration/_declarer) all write the
  -- pair, for exactly this reason.
  constraint thread_receipt_answered_at check (
    (status = 'unacknowledged') = (acknowledged_at is null)),
  constraint thread_receipt_answered_by check (
    (status = 'unacknowledged') = (acknowledged_by is null)),
  constraint thread_receipt_note check (
    status = 'unacknowledged'
    or (acknowledgement_note is not null
        and length(btrim(acknowledgement_note)) >= 20))
);

create index if not exists idx_thread_receipt_case
  on thread_change_receipts(organization_id, development_case_id, status);
create index if not exists idx_thread_receipt_object
  on thread_change_receipts(thread_object_id, status);
create index if not exists idx_thread_receipt_source
  on thread_change_receipts(source_version_id);

alter table public.thread_change_receipts enable row level security;
drop policy if exists thread_change_receipts_read on public.thread_change_receipts;
create policy thread_change_receipts_read on public.thread_change_receipts
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: receipts are produced by the trigger and answered
-- through the definer RPC.

comment on table public.thread_change_receipts is
  'D11.07 / spec II.2 "has the operating system received the change": one receipt per downstream object per supersession, born UNACKNOWLEDGED (ruling 5C-R13). Produced by a trigger on the change itself, not by a report — a receipt that exists only while somebody is looking at a screen is not a record of anything.';
comment on column public.thread_change_receipts.status is
  'D11.07 ruling 5C-R13. `not_applicable` exists on purpose: forcing "the change does not reach us" to be recorded as "acknowledged" destroys the difference between having looked and having updated.';

-- §70 and §42 (rulings 5C-R14). The wall, for every writer.
drop trigger if exists trg_thread_receipt_acknowledger_is_human on public.thread_change_receipts;
create trigger trg_thread_receipt_acknowledger_is_human
  before insert or update on public.thread_change_receipts
  for each row execute function public.enforce_frontline_judgement_is_human(
    'acknowledged_by', 'acknowledge a digital-thread change receipt');

create or replace function public.enforce_thread_receipt_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_declarer uuid;
  v_source_version_object bigint;
  o thread_objects%rowtype;
  src thread_objects%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'thread_change_receipts is the record of which downstream objects were told about a change and which answered. Truncating it clears every outstanding notice in one statement — the exact act ruling 5C-R13 exists to prevent — and the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id)
       or not exists (select 1 from thread_objects where id = old.thread_object_id)
       or not exists (select 1 from thread_object_versions where id = old.source_version_id) then
      return old;
    end if;
    raise exception
      'A change receipt is not deleted. An unanswered one is the finding; deleting it is answering it without saying so, by the one route that leaves nothing behind.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if new.thread_object_id is distinct from old.thread_object_id
       or new.source_object_id is distinct from old.source_object_id
       or new.source_version_id is distinct from old.source_version_id
       or new.change_summary is distinct from old.change_summary
       or new.organization_id is distinct from old.organization_id
       or new.development_case_id is distinct from old.development_case_id then
      raise exception
        'What a receipt IS — which object must answer, which change it is about, and what that change was — cannot be rewritten by any caller, service paths included. Rewriting the summary answers a different question than the one that was asked.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'unacknowledged' and new.status <> old.status then
      raise exception
        'A receipt is answered once. If the answer turned out to be wrong, the next revision produces the next receipt — re-answering this one would rewrite what somebody said at the time they said it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- TENANCY THE FOREIGN KEYS CANNOT POLICE, ON INSERT AND ON UPDATE.
  -- The three sibling walls in this slice all resolve their parents and compare
  -- organizations; this one used to fall straight through on INSERT, so a
  -- service path could write a receipt carrying org A's organization_id and org
  -- B's thread_object_id. RLS admits org A's readers by organization_id, and
  -- the receipts read joins thread_objects with no org predicate of its own —
  -- so org B's object reference, kind and title render on org A's screen. The
  -- immutability rules above only stop the values being CHANGED; they have to
  -- be right the first time.
  select * into o from thread_objects where id = new.thread_object_id;
  if not found or o.organization_id <> new.organization_id
     or o.development_case_id <> new.development_case_id then
    raise exception
      'A change receipt belongs to the same organization and development case as the object that has to answer it. A receipt pointing at another tenant''s object is a cross-tenant read with a friendly name.'
      using errcode = 'check_violation';
  end if;
  select * into src from thread_objects where id = new.source_object_id;
  if not found or src.organization_id <> new.organization_id
     or src.development_case_id <> new.development_case_id then
    raise exception
      'The object whose change raised this receipt belongs to the same organization and development case as the receipt.'
      using errcode = 'check_violation';
  end if;
  select declared_by, thread_object_id into v_declarer, v_source_version_object
    from thread_object_versions where id = new.source_version_id;
  if v_source_version_object is null or v_source_version_object <> new.source_object_id then
    raise exception
      'The revision named on a receipt is a revision OF the object that changed. Naming another object''s revision would make the receipt describe a change that never happened to the thing it cites.'
      using errcode = 'check_violation';
  end if;

  -- RULING 5C-R14. §42 at the smallest scale it has, enforced for EVERY writer
  -- rather than only at the RPC door — and on INSERT as well as UPDATE. A
  -- receipt can be BORN answered (`status='acknowledged'` in the insert
  -- itself), and gating this on TG_OP='UPDATE' left that one route open: the
  -- sender signs their own delivery confirmation in a single statement.
  if new.acknowledged_by is not null
     and (tg_op = 'INSERT' or new.acknowledged_by is distinct from old.acknowledged_by) then
    if v_declarer is not null and v_declarer = new.acknowledged_by then
      raise exception
        'The person who declared this revision authoritative cannot also record that the downstream object received it (spec §42). A receipt the sender signs is a delivery confirmation the sender wrote.'
        using errcode = 'check_violation';
    end if;
  end if;

  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Change receipt on %s for %s %s', new.source_object_ref,
             new.source_version_label, new.status),
      tg_op,
      'A change receipt written or answered outside the trigger and acknowledge_thread_receipt changes what the product reports as outstanding — and "outstanding" is the whole answer to II.2''s question about whether the operating system received the change.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_thread_receipt_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_thread_receipt_integrity on public.thread_change_receipts;
create trigger trg_thread_receipt_integrity
  before insert or update or delete on public.thread_change_receipts
  for each row execute function public.enforce_thread_receipt_integrity();

drop trigger if exists trg_thread_receipt_no_truncate on public.thread_change_receipts;
create trigger trg_thread_receipt_no_truncate
  before truncate on public.thread_change_receipts
  for each statement execute function public.enforce_thread_receipt_integrity();

revoke truncate on table public.thread_change_receipts from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE PRODUCER (ruling 5C-R12). On the change itself.
-- ---------------------------------------------------------------------------
create or replace function public.raise_thread_change_receipts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src thread_objects%rowtype;
  v_ids bigint[];
  v_hops int[];
  v_made int := 0;
  v_gapped boolean;
  v_gap_note text;
begin
  -- Only a supersession. A first issue changes nothing anyone built on
  -- (ruling 5C-R12).
  --
  -- TG_OP IS CHECKED IN ITS OWN STATEMENT, not folded into the OR below.
  -- PL/pgSQL leaves OLD unassigned on an INSERT and reading a field of it
  -- RAISES; PostgreSQL does not promise to short-circuit an OR, so
  -- `... or (tg_op = 'UPDATE' and old.status = ...)` is an exception waiting
  -- for the first row inserted straight into `authoritative`.
  if tg_op = 'UPDATE' and old.status = 'authoritative' then
    return null;
  end if;
  if new.status <> 'authoritative' or new.supersedes_version_id is null then
    return null;
  end if;

  select * into src from thread_objects where id = new.thread_object_id;
  if not found then
    return null;
  end if;

  -- THE AFFECTED SET IS RESOLVED FIRST, INTO ARRAYS, and the INSERT is a
  -- plain statement over them. Folding the INSERT into the recursive WITH as a
  -- data-modifying CTE would put a write inside a `with recursive` list, which
  -- is at best a corner of the standard nobody should be betting a wall on —
  -- and this file could not be run against a database before it was committed,
  -- so it does not bet on corners.
  with recursive downstream(object_id, hops) as (
    select l.downstream_object_id, 1
      from thread_links l
      join thread_objects t on t.id = l.downstream_object_id
     where l.upstream_object_id = src.id
       and l.status = 'live'
       and t.status = 'live'
    union
    select l.downstream_object_id, d.hops + 1
      from downstream d
      join thread_links l on l.upstream_object_id = d.object_id and l.status = 'live'
      join thread_objects t on t.id = l.downstream_object_id and t.status = 'live'
     where d.hops < 32
  ),
  shortest as (
    select object_id, min(hops) hops from downstream
     where object_id <> src.id
     group by object_id
  )
  select coalesce(array_agg(object_id order by object_id), '{}'::bigint[]),
         coalesce(array_agg(hops order by object_id), '{}'::int[])
    into v_ids, v_hops
    from shortest;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return null;
  end if;

  -- THE REGION IS ASSESSED BEFORE THE RECEIPTS ARE STAMPED WITH IT.
  -- Exactly the tests `get_case_thread_impact` refuses on, run over exactly the
  -- region this traversal walked. A receipt raised over a gapped region is
  -- still a receipt — somebody downstream does have to answer — but it is a
  -- receipt for a FLOOR, and saying so on the row is the difference between
  -- "the change landed everywhere" and "the change landed everywhere we could
  -- see".
  select string_agg(g, ' ') into v_gap_note from (
    select format('The hop %s → %s skips %s chain position(s); whatever belongs in between was never registered.',
             up.object_ref, dn.object_ref,
             sync_thread_chain_position(dn.object_kind)
               - sync_thread_chain_position(up.object_kind) - 1) g
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'live'
       and (up.id = src.id or up.id = any (v_ids))
       and sync_thread_chain_position(dn.object_kind)
           - sync_thread_chain_position(up.object_kind) > 1
    union all
    select format('A hop out of %s was severed, so what used to be downstream of it is outside this set.',
             up.object_ref)
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
     where l.status = 'severed'
       and (up.id = src.id or up.id = any (v_ids))
    union all
    select format('The hop out of %s runs into RETIRED object %s, so the traversal stopped there.',
             up.object_ref, dn.object_ref)
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'live' and dn.status = 'retired'
       and (up.id = src.id or up.id = any (v_ids))) q;
  v_gapped := v_gap_note is not null;

  with made as (
    insert into thread_change_receipts (organization_id, development_case_id,
      thread_object_id, source_object_id, source_version_id, source_object_ref,
      source_version_label, change_summary, hops,
      source_region_gapped, source_region_gap_note)
    select src.organization_id, src.development_case_id, d.object_id, src.id,
           new.id, src.object_ref, new.version_label,
           coalesce(nullif(btrim(new.change_summary), ''),
             'The superseding revision recorded no summary. This receipt exists anyway: a change nobody described is still a change the downstream object has to answer for.'),
           d.hops, v_gapped, v_gap_note
      from unnest(v_ids, v_hops) as d(object_id, hops)
    on conflict (source_version_id, thread_object_id) do nothing
    returning 1)
  select count(*)::int into v_made from made;

  if v_made > 0 then
    insert into audit_events (organization_id, entity_type, actor, event_data,
      previous_state, new_state)
    values (src.organization_id, 'thread_change_receipts', 'system',
      jsonb_build_object('case_id', src.development_case_id,
        'source_object_id', src.id, 'source_object_ref', src.object_ref,
        'source_version_id', new.id, 'version_label', new.version_label),
      null,
      jsonb_build_object('receipts_raised', v_made, 'status', 'unacknowledged'));
  end if;
  return null;
end
$$;

revoke all on function public.raise_thread_change_receipts()
  from public, anon, authenticated;

drop trigger if exists trg_thread_change_receipts on public.thread_object_versions;
create trigger trg_thread_change_receipts
  after insert or update on public.thread_object_versions
  for each row execute function public.raise_thread_change_receipts();

comment on function public.raise_thread_change_receipts() is
  'D11.07 ruling 5C-R12: produces one UNACKNOWLEDGED receipt for every live downstream object, at the moment a revision becomes authoritative AND supersedes another. A first issue produces none — nothing downstream was built on a previous revision. Follows the MOC re-review and propagate_risk_objective_change precedents: the change fires it, not a report.';

-- ---------------------------------------------------------------------------
-- 3. Answering one.
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_thread_receipt(
  p_receipt_id bigint,
  p_disposition text,
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
  r thread_change_receipts%rowtype;
  o thread_objects%rowtype;
  v_disposition text := nullif(btrim(coalesce(p_disposition, '')), '');
  v_note text := btrim(coalesce(p_note, ''));
  v_declarer uuid;
  v_outstanding int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 first, so the specific refusal is reachable rather than shadowed by
  -- the role list below.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot acknowledge a change receipt (spec §70). "We have received this and dealt with it" is a statement about the physical world made on behalf of a team, and a machine cannot make it.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'acknowledging a change receipt requires a role on this project');
  end if;
  select * into r from thread_change_receipts where id = p_receipt_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'change receipt not found');
  end if;
  if r.status <> 'unacknowledged' then
    return jsonb_build_object('error',
      format('this receipt was already answered as %s — a receipt is answered once, and the next revision produces the next one', r.status));
  end if;
  if v_disposition is null or v_disposition not in ('acknowledged', 'not_applicable') then
    return jsonb_build_object('error',
      'disposition must be `acknowledged` (we have it and have acted) or `not_applicable` (we looked and it does not reach us)');
  end if;
  if length(v_note) < 20 then
    return jsonb_build_object('error',
      'say what you did about it (20 characters minimum). A receipt cleared with no note records that somebody clicked, which is not the same as the change having landed.');
  end if;
  -- RULING 5C-R14, at the door as well as at the wall.
  select declared_by into v_declarer from thread_object_versions where id = r.source_version_id;
  if v_declarer is not null and v_declarer = auth.uid() then
    return jsonb_build_object('error',
      'you declared this revision authoritative, so you cannot also record that the downstream object received it (spec §42). Ask the person who owns the downstream object.');
  end if;

  select * into o from thread_objects where id = r.thread_object_id;

  update thread_change_receipts
     set status = v_disposition,
         acknowledged_by = auth.uid(),
         acknowledged_at = now(),
         acknowledgement_note = v_note
   where id = r.id;

  select count(*)::int into v_outstanding
    from thread_change_receipts
   where organization_id = v_org
     and development_case_id = r.development_case_id
     and status = 'unacknowledged';

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_change_receipt', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', r.development_case_id, 'receipt_id', r.id,
      'object_ref', o.object_ref, 'source_object_ref', r.source_object_ref,
      'source_version_label', r.source_version_label),
    jsonb_build_object('status', 'unacknowledged'),
    jsonb_build_object('status', v_disposition, 'note', v_note,
      'acknowledged_by', auth.uid()));

  return jsonb_build_object(
    'receipt_id', r.id,
    'status', v_disposition,
    'objectRef', o.object_ref,
    'sourceObjectRef', r.source_object_ref,
    'outstandingOnCase', v_outstanding,
    'note', case when v_disposition = 'not_applicable'
      then 'Recorded as not applicable, with the reason. This is deliberately NOT the same state as "acknowledged" — the difference between having looked and having updated is the thing this register exists to keep.'
      else 'Acknowledged. The operating system has this change, and there is now a named person and a sentence saying so.' end);
end
$$;

revoke all on function public.acknowledge_thread_receipt(bigint, text, text) from public, anon;
grant execute on function public.acknowledge_thread_receipt(bigint, text, text)
  to authenticated, service_role;

comment on function public.acknowledge_thread_receipt(bigint, text, text) is
  'D11.07 / spec II.2 + §42 + §70: answers one change receipt as `acknowledged` or `not_applicable`, both with a mandatory note. Refuses the AI-operator identity and refuses the person who declared the revision — a receipt the sender signs is a delivery confirmation the sender wrote.';

-- ---------------------------------------------------------------------------
-- 4. THE TRAVERSAL (ruling 5C-R15).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_thread_impact(
  p_case_id uuid,
  p_object_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  src thread_objects%rowtype;
  v_gaps jsonb := '[]'::jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_count int := 0;
  v_max_hops int := 0;
  v_outstanding int := 0;
  v_ids bigint[];
  v_hops int[];
  v_src_version text;
  v_terminal boolean;
  v_row record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into src from thread_objects
   where id = p_object_id and organization_id = v_org and development_case_id = c.id;
  if not found then
    return jsonb_build_object('error', 'that thread object is not on this case');
  end if;

  select version_label into v_src_version from thread_object_versions
   where thread_object_id = src.id and status = 'authoritative';
  v_terminal := sync_thread_chain_position(src.object_kind)
                = array_length(sync_thread_object_kinds(), 1);

  -- TWO PARALLEL ARRAYS, not a temporary table. A temp table would make this
  -- function write in a read path (it is declared STABLE, and CREATE TEMP
  -- TABLE fails outright in a read-only transaction), and it would leak
  -- between two impact reads in one transaction. array_agg over one query
  -- fills both arrays from the same row order, so unnest(ids, hops) pairs
  -- them correctly.
  with recursive downstream(object_id, hops) as (
    select l.downstream_object_id, 1
      from thread_links l
      join thread_objects t on t.id = l.downstream_object_id
     where l.upstream_object_id = src.id and l.status = 'live' and t.status = 'live'
    union
    select l.downstream_object_id, d.hops + 1
      from downstream d
      join thread_links l on l.upstream_object_id = d.object_id and l.status = 'live'
      join thread_objects t on t.id = l.downstream_object_id and t.status = 'live'
     where d.hops < 32
  ),
  shortest as (
    select object_id, min(hops) hops from downstream
     where object_id <> src.id
     group by object_id
  )
  select coalesce(array_agg(object_id order by object_id), '{}'::bigint[]),
         coalesce(array_agg(hops order by object_id), '{}'::int[])
    into v_ids, v_hops
    from shortest;

  v_count := coalesce(array_length(v_ids, 1), 0);
  select coalesce(max(h), 0) into v_max_hops from unnest(v_hops) h;

  -- ── THE EMPTY-ANSWER REFUSAL (ruling 5C-R15) ────────────────────────────
  if v_count = 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'objectId', src.id,
      'objectRef', src.object_ref,
      'refused', true,
      'downstreamCount', null,
      'affected', '[]'::jsonb,
      'gaps', '[]'::jsonb,
      'refusal', case when v_terminal
        then format('%s is the last kind in the spec II.2 chain, so nothing is downstream of it BY DESIGN. This is stated rather than returned as "0 downstream impacts", because those two sentences mean opposite things and only one of them is safe.', src.object_ref)
        else format('%s has no live hop leaving it, so this traversal reaches nothing. That is NOT "0 downstream impacts" — a change to an object nobody joined to anything is not safe, it is unassessed. Register the objects it feeds and link them (spec II.2), then ask again.', src.object_ref) end);
  end if;

  -- ── GAPS INSIDE THE REGION WALKED ───────────────────────────────────────
  if v_src_version is null then
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'source_has_no_authoritative_version',
      'objectRef', src.object_ref,
      'detail', format('%s has no released revision, so "what changed" has no defined answer and nothing downstream can be said to be built on anything current.', src.object_ref));
  end if;

  for v_row in
    select t.object_ref, t.object_kind
      from unnest(v_ids) as i(object_id)
      join thread_objects t on t.id = i.object_id
     where not exists (select 1 from thread_object_versions v
                        where v.thread_object_id = t.id and v.status = 'authoritative')
     order by t.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'no_authoritative_version',
      'objectRef', v_row.object_ref,
      'detail', format('%s %s is in the affected set and has no released revision. Telling somebody their drawing is superseded when the project never released one is not an impact answer.',
        v_row.object_kind, v_row.object_ref));
  end loop;

  for v_row in
    select up.object_ref up_ref, dn.object_ref dn_ref,
           (sync_thread_chain_position(dn.object_kind)
            - sync_thread_chain_position(up.object_kind) - 1) skipped
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'live'
       and (up.id = src.id or up.id = any (v_ids))
       and sync_thread_chain_position(dn.object_kind)
           - sync_thread_chain_position(up.object_kind) > 1
     order by up.object_ref, dn.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'chain_skip',
      'detail', format('The hop %s → %s skips %s chain position(s). Whatever belongs in between was never registered, so the set this traversal reached is a FLOOR, not the affected set.',
        v_row.up_ref, v_row.dn_ref, v_row.skipped));
  end loop;

  -- A HOP OUT OF THIS REGION THAT WAS SEVERED.
  --
  -- The walk sees only `status = 'live'` links, so a severed hop is invisible
  -- to it — and a severance is precisely the event that removes something from
  -- the affected set while leaving it physically downstream. Without this, the
  -- sequence "S → M → D, retire M" produces `refused: false, downstreamCount: 1,
  -- gaps: []` and the sentence "this IS the affected set": D is gone from the
  -- answer and nothing says so. That is the reachable-subgraph-as-complete
  -- failure the refusal exists to prevent, arriving through the severance
  -- ledger instead of through a missing link.
  for v_row in
    select up.object_ref up_ref, dn.object_ref dn_ref, l.severance_reason
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'severed'
       and (up.id = src.id or up.id = any (v_ids))
     order by up.object_ref, dn.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'severed_hop_out_of_region',
      'detail', format('The hop %s → %s was SEVERED (%s). Whatever hangs below %s is still physically downstream of this change and is not in the set below, so the set is a floor.',
        v_row.up_ref, v_row.dn_ref,
        coalesce(v_row.severance_reason, 'no reason recorded'), v_row.dn_ref));
  end loop;

  -- A LIVE HOP INTO A RETIRED OBJECT. The walk drops it on `t.status = 'live'`
  -- and reports nothing; the continuity read calls the same state a BREAK.
  for v_row in
    select up.object_ref up_ref, dn.object_ref dn_ref
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'live' and dn.status = 'retired'
       and (up.id = src.id or up.id = any (v_ids))
     order by up.object_ref, dn.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'retired_object_in_path',
      'detail', format('The live hop %s → %s runs into a RETIRED object. The traversal stopped there, so everything below %s is missing from this answer.',
        v_row.up_ref, v_row.dn_ref, v_row.dn_ref));
  end loop;

  -- A LIVE HOP RUNNING BACKWARD out of this region. `check_thread_continuity`
  -- classes this as a BREAK; the traversal had no gap of its own for it, so a
  -- cycle produced by one would walk to the hop cap and report `depth_limit` —
  -- a truncation message for an integrity defect. Naming the defect is the
  -- answer; the cap is a symptom.
  for v_row in
    select up.object_ref up_ref, up.object_kind up_kind,
           dn.object_ref dn_ref, dn.object_kind dn_kind
      from thread_links l
      join thread_objects up on up.id = l.upstream_object_id
      join thread_objects dn on dn.id = l.downstream_object_id
     where l.status = 'live'
       and (up.id = src.id or up.id = any (v_ids))
       and coalesce(sync_thread_chain_position(dn.object_kind), -1)
           <= coalesce(sync_thread_chain_position(up.object_kind), 999)
     order by up.object_ref, dn.object_ref
  loop
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'backward_link',
      'detail', format('The hop %s (%s) → %s (%s) runs against the spec II.2 chain. Every downstream-impact answer computed over it is wrong in the most convincing possible way, and check_thread_continuity reports it as a BREAK rather than a gap.',
        v_row.up_ref, v_row.up_kind, v_row.dn_ref, v_row.dn_kind));
  end loop;

  if v_max_hops >= 32 then
    v_gaps := v_gaps || jsonb_build_object(
      'kind', 'depth_limit',
      'detail', 'The traversal reached its 32-hop limit, so the affected set is truncated. A truncated set presented as complete is worse than no answer. The chain has ten positions and every live hop must advance strictly, so a well-formed thread cannot reach this — seeing it means a backward hop has made a cycle, which the gap above names.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'objectId', t.id,
      'objectRef', t.object_ref,
      'objectKind', t.object_kind,
      'title', t.title,
      'hops', i.hops,
      'anchorAssetId', t.anchor_asset_id,
      'anchorAssetName', a.name,
      'authoritativeVersion', (select v.version_label from thread_object_versions v
                                where v.thread_object_id = t.id and v.status = 'authoritative'),
      'outstandingReceipts', (select count(*)::int from thread_change_receipts rc
                               where rc.thread_object_id = t.id
                                 and rc.organization_id = v_org
                                 and rc.status = 'unacknowledged'))
      order by i.hops, t.object_ref), '[]'::jsonb)
    into v_affected
  from unnest(v_ids, v_hops) as i(object_id, hops)
  join thread_objects t on t.id = i.object_id
  left join assets a on a.id = t.anchor_asset_id;

  select count(*)::int into v_outstanding
    from thread_change_receipts rc
   where rc.source_object_id = src.id and rc.organization_id = v_org
     and rc.status = 'unacknowledged';

  if jsonb_array_length(v_gaps) > 0 then
    return jsonb_build_object(
      'caseId', c.id,
      'objectId', src.id,
      'objectRef', src.object_ref,
      'refused', true,
      -- NULL, not the number. Printing the count beside a refusal is how a
      -- refusal gets read as an answer with a caveat.
      'downstreamCount', null,
      'reachedCount', v_count,
      'affected', v_affected,
      'gaps', v_gaps,
      'outstandingReceiptsFromThisObject', v_outstanding,
      'refusal', format('This traversal REFUSES to report a downstream impact for %s: the thread has %s gap(s) inside the region it walked, so the %s object(s) it reached are a floor and not the affected set. The gaps are named below — close them and ask again. Reporting the reachable subgraph as if it were complete is the failure this refusal exists to prevent.',
        src.object_ref, jsonb_array_length(v_gaps), v_count));
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'objectId', src.id,
    'objectRef', src.object_ref,
    'objectKind', src.object_kind,
    'authoritativeVersion', v_src_version,
    'refused', false,
    'downstreamCount', v_count,
    'reachedCount', v_count,
    'maxHops', v_max_hops,
    'affected', v_affected,
    'gaps', '[]'::jsonb,
    'outstandingReceiptsFromThisObject', v_outstanding,
    'note', 'Every object below is reachable from this one through live hops with no gap on the way, so this IS the affected set rather than a floor. A change to this object''s authoritative revision raises one receipt for each of them.');
end
$$;

revoke all on function public.get_case_thread_impact(uuid, bigint) from public, anon;
grant execute on function public.get_case_thread_impact(uuid, bigint) to authenticated, service_role;

comment on function public.get_case_thread_impact(uuid, bigint) is
  'D11.07 / spec II.2 "what downstream object is affected": walks live hops downstream and REFUSES (ruling 5C-R15) when the region it walked contains a chain skip, an object with no released revision, or the depth limit — naming the gap instead of presenting the reachable subgraph as complete. An empty result is a refusal that says WHICH empty it is, never "0 downstream impacts".';

-- ---------------------------------------------------------------------------
-- 5. Outstanding receipts, per case.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_thread_receipts(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_rows jsonb;
  v_total int;
  v_outstanding int;
  v_acknowledged int;
  v_na int;
  v_objects int;
  v_gapped int;
  v_unassessed int;
  v_supersessions int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select count(*)::int into v_objects
    from thread_objects where organization_id = v_org and development_case_id = c.id;

  -- HOW MANY SUPERSESSIONS HAVE HAPPENED ON THIS CASE.
  --
  -- Two different states produce zero receipts, and the difference is the whole
  -- answer to II.2's question: (a) no revision has superseded another, so there
  -- was nothing to tell anybody about; and (b) a revision DID supersede another
  -- and the source object had no live hop, so the change reached nobody because
  -- nobody is joined to it. Without this count the read says (a) in both cases,
  -- which is the plausible zero one level up from the one the refusal already
  -- catches.
  select count(*)::int into v_supersessions
    from thread_object_versions v
    join thread_objects t on t.id = v.thread_object_id
   where t.organization_id = v_org and t.development_case_id = c.id
     and v.supersedes_version_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'objectId', r.thread_object_id,
      'objectRef', t.object_ref,
      'objectKind', t.object_kind,
      'sourceObjectRef', r.source_object_ref,
      'sourceVersionLabel', r.source_version_label,
      'changeSummary', r.change_summary,
      'hops', r.hops,
      'status', r.status,
      'regionGapped', r.source_region_gapped,
      'regionGapNote', r.source_region_gap_note,
      'acknowledgedBy', coalesce(u.full_name, u.email),
      'acknowledgedAt', r.acknowledged_at,
      'acknowledgementNote', r.acknowledgement_note,
      'raisedAt', r.created_at)
      order by (r.status <> 'unacknowledged'), r.created_at desc, r.id desc), '[]'::jsonb),
    count(*)::int,
    count(*) filter (where r.status = 'unacknowledged')::int,
    count(*) filter (where r.status = 'acknowledged')::int,
    count(*) filter (where r.status = 'not_applicable')::int,
    count(*) filter (where r.source_region_gapped)::int,
    count(*) filter (where r.source_region_gapped is null)::int
    into v_rows, v_total, v_outstanding, v_acknowledged, v_na, v_gapped, v_unassessed
  from thread_change_receipts r
  join thread_objects t on t.id = r.thread_object_id and t.organization_id = v_org
  left join user_profiles u on u.id = r.acknowledged_by and u.organization_id = v_org
  where r.organization_id = v_org and r.development_case_id = c.id;

  return jsonb_build_object(
    'caseId', c.id,
    -- REFUSAL over a case with no thread at all. "No outstanding receipts"
    -- across an unregistered CDE reads as a project where every change has
    -- landed.
    'refused', v_objects = 0,
    'refusal', case when v_objects = 0
      then 'No object on this case is registered in the Common Data Environment, so no change can raise a receipt and none has. That is not "every change has landed" — it is a project with no thread to change.'
      else null end,
    'objectCount', v_objects,
    'total', case when v_objects = 0 then null else v_total end,
    'outstanding', case when v_objects = 0 then null else v_outstanding end,
    'acknowledged', case when v_objects = 0 then null else v_acknowledged end,
    'notApplicable', case when v_objects = 0 then null else v_na end,
    -- Receipts raised over a region the impact read would REFUSE to state.
    -- Answering all of them does not mean the change landed everywhere; it
    -- means it landed everywhere the thread could see.
    'raisedOverAGappedRegion', case when v_objects = 0 then null else v_gapped end,
    'regionUnassessed', case when v_objects = 0 then null else v_unassessed end,
    'supersessions', case when v_objects = 0 then null else v_supersessions end,
    'statuses', to_jsonb(sync_thread_receipt_statuses()),
    'receipts', v_rows,
    'note', 'An outstanding receipt is spec II.2''s question with the answer still missing: the revision changed, and nobody downstream has said they have it.');
end
$$;

revoke all on function public.get_case_thread_receipts(uuid) from public, anon;
grant execute on function public.get_case_thread_receipts(uuid) to authenticated, service_role;

comment on function public.get_case_thread_receipts(uuid) is
  'D11.07: the case''s change receipts with their three states. REFUSES over a case with no registered CDE rather than reporting zero outstanding, which reads as a project where every change has landed.';

-- ---------------------------------------------------------------------------
-- 6. D11.21 — §34's nineteen edges, as an honest ledger (ruling 5C-R16 (b)).
-- ---------------------------------------------------------------------------
create or replace function public.sync_spec34_edges()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_array(
    jsonb_build_object('edge','Objective SUPPORTS Objective','tail','Objective','head','Objective',
      'home','risk_objectives (D11.15 objective nesting)','status','live_elsewhere',
      'note','The ONE objective store carries its own nesting. Counted by the risk operating system''s reads, not re-implemented here.'),
    jsonb_build_object('edge','Risk THREATENS Objective','tail','Risk','head','Objective',
      'home','risks.objective_id + the D11.15 link invariant','status','live_elsewhere',
      'note','Enforced at the database by the risk→objective invariant. Its counts belong to the risk reads.'),
    jsonb_build_object('edge','Requirement SUPPORTS Objective','tail','Requirement','head','Objective',
      'home','design_requirements.objective_id (20261204090000)','status','live_elsewhere',
      'note','Slice 5A''s thread head. get_case_requirement_traceability owns the coverage answer.'),
    jsonb_build_object('edge','Control MODIFIES Risk','tail','Control','head','Risk',
      'home','risk_control_links','status','live_elsewhere',
      'note','ISO 31000 operating system. Not re-queried here.'),
    jsonb_build_object('edge','Treatment MODIFIES Risk','tail','Treatment','head','Risk',
      'home','the canonical recommendation model + risk_treatment_dependencies','status','live_elsewhere',
      'note','Overlap-map ruling D5.25: treatments ride the recommendation model, no standalone Treatment table.'),
    jsonb_build_object('edge','Decision SELECTS Option','tail','Decision','head','Option',
      'home','decisions.selected_option_id (20261105090300)','status','live_elsewhere',
      'note','Options are the generalized scenarios per the overlap-map decision ruling.'),
    jsonb_build_object('edge','Decision USES Evidence','tail','Decision','head','Evidence',
      'home','evidence_items + the case evidence linkage','status','live_elsewhere',
      'note','evidence_items is the ONE evidence model (AGENTS invariant 3).'),
    jsonb_build_object('edge','Decision DEPENDS_ON Assumption','tail','Decision','head','Assumption',
      'home','risk_assumptions + risk_assumption_dependencies','status','live_elsewhere',
      'note','The assumption family is canonical per the overlap map.'),
    jsonb_build_object('edge','Requirement VERIFIED_BY Verification','tail','Requirement','head','Verification',
      'home','verification_obligations (20261204090100)','status','live_elsewhere',
      'note','Slice 5A. On the CDE thread the same relationship also appears as a `verifies` hop into a commissioning_test object.'),
    jsonb_build_object('edge','Requirement IMPLEMENTED_BY DesignObject','tail','Requirement','head','DesignObject',
      'home','thread_links: requirement → equipment_specification','status','live_on_thread',
      'note','Slice 5A recorded "no design-object store exists" as a named hole. The CDE closes it: II.2''s equipment specification IS §26''s DesignObject (ruling 5C-R1), registered as a thread object.'),
    jsonb_build_object('edge','DesignObject BECOMES Asset','tail','DesignObject','head','Asset',
      'home','thread_links: equipment_specification → … → installed_equipment, anchored on assets','status','live_on_thread',
      'note','§26''s chain, on the ONE asset hierarchy. The anchor edge is what makes the object and the asset one node space.'),
    jsonb_build_object('edge','Change MODIFIES Baseline','tail','Change','head','Baseline',
      'home','project_changes → development_baselines (20261203090100)','status','live_elsewhere',
      'note','Slice 4D change control. Its own reads own the counts.'),
    jsonb_build_object('edge','Change IMPACTS Requirement','tail','Change','head','Requirement',
      'home','project_change_propagation (20261203090100)','status','live_elsewhere',
      'note','The propagation table carries the affected objects of an approved change; the CDE receipt is the same shape one level down, at the revision.'),
    jsonb_build_object('edge','WorkPackage DEPENDS_ON Constraint','tail','WorkPackage','head','Constraint',
      'home','none — spec §27 WorkPackage and §28 Constraint are not built','status','absent',
      'note','Both endpoints are unbuilt objects (II.4 Advanced Work Packaging). Modelling the edge before its endpoints exist is how a parallel store starts.'),
    jsonb_build_object('edge','Contract PROVIDES Asset','tail','Contract','head','Asset',
      'home','contract_packages exists; no contract→asset relation does','status','absent',
      'note','The §24 Contract object lands with procurement (D6.05/D6.08). The CDE''s procurement_item kind is registered by reference until then and does not pretend to be a contract.'),
    jsonb_build_object('edge','Asset SUPPORTS Objective','tail','Asset','head','Objective',
      'home','none — no asset→objective relation is stored','status','absent',
      'note','Reachable today only transitively (asset ← requirement → objective). A transitive path is not the edge, and this ledger does not claim it is.'),
    jsonb_build_object('edge','Benefit MEASURES Objective','tail','Benefit','head','Objective',
      'home','none — spec §32 Benefit is not built','status','absent',
      'note','Benefits realization is II.23/§32 and unbuilt. Naming the edge without the object would be the claim this register exists to refuse.'),
    jsonb_build_object('edge','Failure RELATES_TO Asset','tail','Failure','head','Asset',
      'home','the failure-event family, asset-scoped','status','live_elsewhere',
      'note','Failure history hangs off the ONE asset hierarchy already. The CDE''s operating_history kind is the same relationship expressed as a thread terminus.'),
    jsonb_build_object('edge','Lesson APPLIES_TO AssetClass','tail','Lesson','head','AssetClass',
      'home','none — spec §33 Lesson/FRACAS object is not built','status','absent',
      'note','screen_similar_assets is the nearest live machinery and it screens ASSETS, not a lesson register. Named as absent rather than counted as covered.')
  );
$$;

revoke all on function public.sync_spec34_edges() from public, anon;
grant execute on function public.sync_spec34_edges() to authenticated, service_role;

comment on function public.sync_spec34_edges() is
  'D11.21 / spec III.§34: all nineteen core graph relationships with the canonical home each lives in today and an honest status — live_on_thread, live_elsewhere, or absent. NOT ONE of the nineteen is asset→asset, which is why none of them can move into asset_dependencies (ruling 5C-R16). The ones with no home at all are ABSENT because their OBJECT is unbuilt, and they are named rather than implied — the count is derived from this array by every read that states it, never written into a sentence that can drift from it.';

-- ---------------------------------------------------------------------------
-- 7. THE ONE GRAPH (ruling 5C-R16 (a)).
-- ---------------------------------------------------------------------------
create or replace function public.get_case_thread_graph(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_nodes jsonb;
  v_thread_edges jsonb;
  v_anchor_edges jsonb;
  v_asset_edges jsonb;
  v_objects jsonb;
  v_total int;
  v_live int;
  v_asset_ids uuid[];
  v_spec34 jsonb;
  v_implemented int;
  v_becomes int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'objectKind', t.object_kind,
      'objectRef', t.object_ref,
      'title', t.title,
      'chainPosition', sync_thread_chain_position(t.object_kind),
      'canonicalHome', sync_thread_object_canonical_home(t.object_kind),
      'registeredByReference', sync_thread_object_canonical_home(t.object_kind) like 'none%',
      'anchorAssetId', t.anchor_asset_id,
      'anchorAssetName', a.name,
      'status', t.status,
      'requirementId', t.requirement_id,
      'commissioningTestId', t.commissioning_test_id,
      'authoritativeVersion', (select v.version_label from thread_object_versions v
                                where v.thread_object_id = t.id and v.status = 'authoritative'),
      'draftVersions', (select count(*)::int from thread_object_versions v
                         where v.thread_object_id = t.id and v.status = 'draft'),
      -- THE DRAFTS, BY ID — not just how many. `declare_thread_version_
      -- authoritative` takes a version id, and a count cannot be released: with
      -- only the number on the wire, the central act of D11.06 is reachable
      -- from psql and from nowhere in the product, and D11.07's receipts (which
      -- only a supersession raises) can never be produced at all.
      'drafts', (select coalesce(jsonb_agg(jsonb_build_object(
                          'versionId', v.id, 'versionLabel', v.version_label,
                          'changeSummary', v.change_summary,
                          'contentRef', v.content_ref)
                          order by v.created_at, v.id), '[]'::jsonb)
                   from thread_object_versions v
                  where v.thread_object_id = t.id and v.status = 'draft'),
      'outstandingReceipts', (select count(*)::int from thread_change_receipts rc
                               where rc.thread_object_id = t.id
                                 and rc.organization_id = v_org
                                 and rc.status = 'unacknowledged'))
      order by sync_thread_chain_position(t.object_kind), t.object_ref), '[]'::jsonb),
    count(*)::int,
    count(*) filter (where t.status = 'live')::int
    into v_objects, v_total, v_live
  from thread_objects t
  left join assets a on a.id = t.anchor_asset_id
  where t.organization_id = v_org and t.development_case_id = c.id;

  select array_agg(distinct t.anchor_asset_id) into v_asset_ids
    from thread_objects t
   where t.organization_id = v_org and t.development_case_id = c.id;

  -- Node space: every thread object as `obj:<id>`, plus every anchor asset AND
  -- both ends of every asset dependency this graph carries, by their real
  -- asset ids. The second half exists for the reason 20261205090200 records:
  -- emitting an asset edge whose far node is missing leaves the client to
  -- back-fill `{id, name: id}` — a real asset shown as a bare UUID with no
  -- criticality, which is exactly what singlePointsOfFailure reads.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'id', n.node_id, 'name', n.node_name, 'tag', n.node_tag,
           'criticality', n.criticality)), '[]'::jsonb)
    into v_nodes
  from (
    select 'obj:' || t.id::text node_id,
           t.object_kind || ' ' || t.object_ref node_name,
           t.object_ref node_tag,
           null::text criticality
      from thread_objects t
     where t.organization_id = v_org and t.development_case_id = c.id
    union
    select a.id::text, a.name, coalesce(a.asset_tag, a.tag), a.criticality
      from assets a
     where a.organization_id = v_org
       and v_asset_ids is not null and a.id = any (v_asset_ids)
    union
    select a.id::text, a.name, coalesce(a.asset_tag, a.tag), a.criticality
      from asset_dependencies ad
      join assets a on a.id in (ad.dependent_asset_id, ad.supplier_asset_id)
     where ad.organization_id = v_org and a.organization_id = v_org
       and v_asset_ids is not null
       and (ad.dependent_asset_id = any (v_asset_ids)
            or ad.supplier_asset_id = any (v_asset_ids))) n;

  -- The thread hops. DOWNSTREAM depends on UPSTREAM, the same direction
  -- 20261205090200 ruling 2 fixes for interfaces: the thing waiting on the
  -- change is the dependent.
  select coalesce(jsonb_agg(jsonb_build_object(
           'dependent', 'obj:' || l.downstream_object_id::text,
           'supplier', 'obj:' || l.upstream_object_id::text,
           'kind', sync_thread_traversal_kind(l.link_type),
           'linkType', l.link_type,
           'linkId', l.id,
           'source', 'thread_link',
           'evidence', l.basis)
           order by l.id), '[]'::jsonb)
    into v_thread_edges
  from thread_links l
  where l.organization_id = v_org and l.development_case_id = c.id and l.status = 'live';

  -- THE ANCHOR EDGE (D11.19). Every object depends on the asset it hangs from,
  -- which is what puts the thread and the plant in ONE node space: lose the
  -- switchgear and the shared traversal already knows which drawings, POs and
  -- commissioning tests went with it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'dependent', 'obj:' || t.id::text,
           'supplier', t.anchor_asset_id::text,
           'kind', 'functional',
           'source', 'thread_anchor',
           'evidence', format('%s %s hangs from this asset (D11.19: the asset is the thread''s one anchor)',
                              t.object_kind, t.object_ref))
           order by t.id), '[]'::jsonb)
    into v_anchor_edges
  from thread_objects t
  where t.organization_id = v_org and t.development_case_id = c.id and t.status = 'live';

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

  -- Ruling 5C-R16 (c): count ONLY what this read computed.
  select
    count(*) filter (where up.object_kind = 'requirement'
                       and dn.object_kind = 'equipment_specification')::int,
    count(*) filter (where up.object_kind in ('equipment_specification', 'procurement_item')
                       and dn.object_kind = 'installed_equipment')::int
    into v_implemented, v_becomes
  from thread_links l
  join thread_objects up on up.id = l.upstream_object_id
  join thread_objects dn on dn.id = l.downstream_object_id
  where l.organization_id = v_org and l.development_case_id = c.id and l.status = 'live';

  select jsonb_agg(
      case
        when e->>'edge' = 'Requirement IMPLEMENTED_BY DesignObject'
          then e || jsonb_build_object('caseCount', v_implemented)
        when e->>'edge' = 'DesignObject BECOMES Asset'
          then e || jsonb_build_object('caseCount', v_becomes)
        -- REPAIR, first live run of this slice's smoke. Both edges below are
        -- status='live_elsewhere': their canonical home owns the answer. They
        -- were still handed a count computed HERE, which is exactly the second
        -- implementation of one predicate the else-branch's own note warns
        -- about — a reader sees a number beside the edge and takes it as the
        -- edge's answer, and the two can disagree. A live_elsewhere edge now
        -- reports no count and names who to ask, like every other one.
        when e->>'edge' = 'Requirement VERIFIED_BY Verification'
          then e || jsonb_build_object('caseCount', null,
            'countNote', 'Not counted here. This read sees thread hops into a commissioning_test object, which is a narrower thing than requirement verification; verification_obligations owns that answer.')
        when e->>'edge' = 'Requirement SUPPORTS Objective'
          then e || jsonb_build_object('caseCount', null,
            'countNote', 'Not counted here. Slice 5A''s get_case_requirement_traceability owns the coverage answer.')
        else e || jsonb_build_object('caseCount', null,
          'countNote', 'Not counted here. Its canonical home owns that query, and a second implementation of one predicate is how a chain reports itself complete from one end and broken from the other.')
      end order by ord)
    into v_spec34
  from jsonb_array_elements(sync_spec34_edges()) with ordinality as x(e, ord);

  return jsonb_build_object(
    'caseId', c.id,
    'refused', v_total = 0,
    'refusal', case when v_total = 0
      then 'No object on this case is registered in the Common Data Environment. An empty thread graph has no broken hops and no single points of failure for the same reason an unmapped plant has none — this read refuses rather than drawing an empty picture that looks like a clean one.'
      else null end,
    'objectCount', v_total,
    'liveObjects', case when v_total = 0 then null else v_live end,
    'objects', v_objects,
    'objectKinds', to_jsonb(sync_thread_object_kinds()),
    'spec26Chain', to_jsonb(sync_thread_spec26_chain()),
    'linkTypes', to_jsonb(sync_thread_link_types()),
    -- ONE payload, in the shape src/lib/interdependency already traverses.
    'graph', jsonb_build_object(
      'nodes', v_nodes,
      'edges', coalesce(v_thread_edges, '[]'::jsonb)
               || coalesce(v_anchor_edges, '[]'::jsonb)
               || coalesce(v_asset_edges, '[]'::jsonb),
      'commonCauseGroups', '[]'::jsonb),
    'threadEdgeCount', jsonb_array_length(coalesce(v_thread_edges, '[]'::jsonb)),
    'anchorEdgeCount', jsonb_array_length(coalesce(v_anchor_edges, '[]'::jsonb)),
    'assetEdgeCount', jsonb_array_length(coalesce(v_asset_edges, '[]'::jsonb)),
    'spec34Edges', coalesce(v_spec34, '[]'::jsonb),
    -- The count is COMPUTED from the ledger it is describing. Writing "six"
    -- into a sentence beside an array of five is the one mistake this row
    -- cannot afford: D11.21's entire value is an honest count of what is
    -- missing, and a prose number is a second source of truth that drifts on
    -- the first edit.
    'note', format('ONE graph: the thread hops, the anchor edge from every object to its asset, and the recorded asset dependencies among those assets, in one node space. propagateLoss and singlePointsOfFailure traverse it unchanged — there is no second cascade model. The §34 ledger beside it names all %s relationships with their canonical homes; %s are ABSENT because their object is unbuilt, and this read says so rather than implying coverage.',
      jsonb_array_length(coalesce(v_spec34, '[]'::jsonb)),
      (select count(*) from jsonb_array_elements(coalesce(v_spec34, '[]'::jsonb)) e
        where e->>'status' = 'absent')));
end
$$;

revoke all on function public.get_case_thread_graph(uuid) from public, anon;
grant execute on function public.get_case_thread_graph(uuid) to authenticated, service_role;

comment on function public.get_case_thread_graph(uuid) is
  'D11.05/D11.19/D11.21 / spec II.2 + §26 + §34: the case''s CDE objects and hops as ONE DependencyGraph — thread edges, anchor edges to the ONE asset hierarchy, and the asset_dependencies edges among those assets — plus the honest nineteen-edge §34 ledger, whose absent count is COMPUTED from the ledger rather than written into the sentence beside it. REFUSES over an empty register rather than drawing an empty picture that reads as a clean one.';

-- ---------------------------------------------------------------------------
-- 8. THE CASCADE-LOSS COUNTER, now that both tables it counts exist.
--
--    20261206090000 created this as a placeholder returning NULLs, because the
--    walls that call it are defined in that file and `thread_object_versions`
--    and `thread_change_receipts` are created here and in 20261206090100. This
--    is the real body.
--
--    The number that matters is the second one. A cascade takes a thread
--    object's UNANSWERED receipts with it — spec II.2's "has the operating
--    system received the change" with the answer still missing — and the
--    receipts table cascades from the object, so both DELETE walls escape
--    silently and nothing anywhere would count what went. The severance
--    snapshot is the only place that number can still be read afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.sync_thread_object_cascade_losses(p_object_id bigint)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'versions_lost',
      (select count(*)::int from thread_object_versions v
        where v.thread_object_id = p_object_id),
    'unacknowledged_receipts_lost',
      (select count(*)::int from thread_change_receipts r
        where r.thread_object_id = p_object_id and r.status = 'unacknowledged'),
    'lossesCounted', true);
$$;

revoke all on function public.sync_thread_object_cascade_losses(bigint)
  from public, anon, authenticated, service_role;

comment on function public.sync_thread_object_cascade_losses(bigint) is
  'D11.20: the revisions and UNANSWERED change receipts a cascade destroys along with a thread object, counted into the severance snapshot at the moment the object goes. Both child tables cascade from the object, so without this the loss leaves nothing behind at all.';

notify pgrst, 'reload schema';
