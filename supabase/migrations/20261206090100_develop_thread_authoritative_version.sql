-- ============================================================================
-- Sync Develop Slice 5C — the digital thread, part 2:
--   D11.06  authoritative-version resolution per thread object (spec II.2)
--
-- II.2: "Sync knows: current authoritative version, what changed, what
-- downstream object is affected, has the operating system received the
-- change." This file answers the first two. 20261206090300 answers the rest.
--
-- The register row for D11.06 reads ❌ and says so accurately: `grep
-- 'authoritative_version'` finds nothing, and the version-bearing fields that
-- do exist are scattered `revision` columns on acceptance and configuration
-- objects. This is the first place the concept exists.
--
-- ── RULING 5C-R6 — ONE AUTHORITATIVE VERSION, ENFORCED, NOT ASSERTED ────────
--
-- "Exactly one authoritative version per thread object at a time" is a claim
-- that a report can make and a database can break. So it is a PARTIAL UNIQUE
-- INDEX:
--
--     unique (thread_object_id) where status = 'authoritative'
--
-- An index, not a trigger, deliberately: a trigger that counts rows is subject
-- to the read it does, and two concurrent declarations both counting zero
-- incumbents both succeed. The index is the only form of this rule that
-- survives concurrency, which is the form the rule needs — the whole point of
-- "which drawing is current" is that two people are looking at once.
--
-- This is the 4A/3A versioned-adopted precedent (`project_baselines`,
-- `project_frameworks`): one adopted row per subject, held by a partial unique
-- index, with the previous one MOVED to a terminal status rather than deleted.
--
-- ── RULING 5C-R7 — SUPERSESSION IS RECORDED, NOT OVERWRITTEN ────────────────
--
-- Declaring Rev C authoritative does not edit Rev B. It moves Rev B to
-- `superseded` and writes the pointer BOTH ways: Rev B gains
-- `superseded_by_version_id`, Rev C gains `supersedes_version_id`. Two
-- pointers rather than one, because the chain has to be walkable from either
-- end — "what did this replace" and "what replaced this" are both questions
-- somebody asks at 2am, and a singly-linked chain answers only one of them.
--
-- A SUPERSEDED VERSION WITH NO SUCCESSOR IS A HOLE, and it is a CHECK
-- constraint, not a convention:
--
--     (status = 'superseded') = (superseded_by_version_id is not null)
--
-- That is the third of D11.20's four definitions of a break, enforced where it
-- can be enforced most cheaply: in the shape of the row itself.
--
-- ── RULING 5C-R8 — §70: A MACHINE DOES NOT DECLARE WHAT IS CURRENT ──────────
--
-- Spec §70 bars an AI or system identity from the determinations that are
-- human by definition. "This revision is the one to build from" is one of
-- them: it is an engineering release, and the person named on it is the person
-- who will be asked why the fabricator built to the wrong sheet. The wall is
-- 20261205090000's ONE §70 trigger function, bound to `declared_by`, on INSERT
-- and UPDATE — not a fourth copy that can lose its UPDATE branch.
--
-- The declaration is also SEPARATE from the recording. `record_thread_version`
-- creates a DRAFT — anybody with a planning role may log that Rev C exists.
-- `declare_thread_version_authoritative` is the release, and it is the act §70
-- protects. Collapsing the two would mean that merely logging a revision
-- silently made it current, which is how a drawing register ends up
-- authoritative-by-upload.
--
-- ── RULING 5C-R9 — WHAT "WHAT CHANGED" IS ALLOWED TO BE ────────────────────
--
-- `change_summary` is mandatory on any version that supersedes another and is
-- refused as empty. A superseding version with no statement of what changed
-- produces a change receipt (D11.07) whose entire content is "something
-- changed", and a receipt that says nothing is a receipt nobody can act on —
-- so it is refused at the point where the information still exists, not
-- reported as missing three hops downstream.
--
-- The FIRST version of an object needs no summary: there is nothing to
-- differ from, and demanding one would only teach operators to type "initial
-- issue" into a field the product then reports as evidence.
--
-- Canonical reuse: thread_objects, audit_events, security_events,
-- app_current_org(), enforce_frontline_judgement_is_human (20261205090000),
-- record_frontline_service_write, record_thread_severance.
-- ============================================================================

create or replace function public.sync_thread_version_statuses()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['draft', 'authoritative', 'superseded']::text[];
$$;

revoke all on function public.sync_thread_version_statuses() from public, anon;
grant execute on function public.sync_thread_version_statuses() to authenticated, service_role;

comment on function public.sync_thread_version_statuses() is
  'D11.06: the three states a thread-object version can be in. There is no `withdrawn`: a draft nobody declared stays a draft, and a version that was ever authoritative is superseded rather than removed (ruling 5C-R7).';

-- ---------------------------------------------------------------------------
-- 1. The version.
-- ---------------------------------------------------------------------------
create table if not exists public.thread_object_versions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  thread_object_id bigint not null references thread_objects(id) on delete cascade,
  version_label text not null check (btrim(version_label) <> ''),
  issued_on date,
  -- Where the artefact itself lives. Nullable and REPORTED as absent rather
  -- than invented: this repository has no drawing store (5C-R5), so a version
  -- of a drawing is honestly a reference to one held elsewhere.
  content_ref text,
  -- Ruling 5C-R9.
  change_summary text,
  status text not null default 'draft'
    check (status = any (sync_thread_version_statuses())),
  -- Ruling 5C-R7: the chain, pointered both ways.
  --
  -- CASCADE, not RESTRICT, on both self-FKs. The only delete route these rows
  -- have is the object/case/organization cascade (DELETE is refused for every
  -- caller below), and under an ancestor cascade a RESTRICT self-FK fires on
  -- delete ORDER rather than on intent — it would make any case that had ever
  -- superseded a revision undeletable. This is 20261204090000 ruling 6, applied
  -- to the same shape of self-reference for the same reason.
  supersedes_version_id bigint references thread_object_versions(id) on delete cascade,
  superseded_by_version_id bigint references thread_object_versions(id) on delete cascade,
  -- Ruling 5C-R8: the human who released it.
  declared_by uuid references auth.users(id),
  declared_at timestamptz,
  declaration_basis text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (thread_object_id, version_label),
  -- A version that was ever declared carries who declared it and when; a draft
  -- carries neither. Both directions, so neither half can drift.
  constraint thread_version_declaration check (
    (status in ('authoritative', 'superseded')) = (declared_at is not null)),
  constraint thread_version_declarer check (
    (status in ('authoritative', 'superseded')) = (declared_by is not null)),
  -- RULING 5C-R7 / D11.20's third definition of a break: a superseded version
  -- with no successor is a hole in the chain, refused in the row's own shape.
  constraint thread_version_supersession check (
    (status = 'superseded') = (superseded_by_version_id is not null)),
  constraint thread_version_no_self_supersede check (
    supersedes_version_id is null or supersedes_version_id <> id),
  constraint thread_version_no_self_superseded check (
    superseded_by_version_id is null or superseded_by_version_id <> id)
);

-- ── RULING 5C-R6. THE INVARIANT. ────────────────────────────────────────────
create unique index if not exists idx_thread_version_one_authoritative
  on public.thread_object_versions(thread_object_id)
  where status = 'authoritative';

create index if not exists idx_thread_version_object
  on thread_object_versions(thread_object_id, status);
create index if not exists idx_thread_version_case
  on thread_object_versions(organization_id, development_case_id, status);

alter table public.thread_object_versions enable row level security;
drop policy if exists thread_object_versions_read on public.thread_object_versions;
create policy thread_object_versions_read on public.thread_object_versions
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: versions are recorded and declared through the
-- definer RPCs.

comment on table public.thread_object_versions is
  'D11.06 / spec II.2 "current authoritative version": the versions of one digital-thread object. EXACTLY ONE may be authoritative at a time and that is a partial unique index, not a report (ruling 5C-R6). Supersession is recorded both ways and never overwrites (ruling 5C-R7); only a human may declare (§70, ruling 5C-R8).';
comment on column public.thread_object_versions.superseded_by_version_id is
  'D11.20: a superseded version with no successor is a HOLE in the version chain — one of the four things "the thread must never break" means — and the CHECK constraint on this column is where that is refused.';
comment on column public.thread_object_versions.change_summary is
  'D11.06 ruling 5C-R9: mandatory on a version that supersedes another. A superseding version with no statement of what changed produces a downstream receipt whose whole content is "something changed", which nobody can act on.';

-- ---------------------------------------------------------------------------
-- 2. §70 — the same wall, the same function (ruling 5C-R8).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_thread_version_declarer_is_human on public.thread_object_versions;
create trigger trg_thread_version_declarer_is_human
  before insert or update on public.thread_object_versions
  for each row execute function public.enforce_frontline_judgement_is_human(
    'declared_by', 'declare a digital-thread version authoritative');

-- ---------------------------------------------------------------------------
-- 3. The version's walls.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_thread_version_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o thread_objects%rowtype;
  prev thread_object_versions%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'thread_object_versions is the record of which revision was current, when, and who released it. Truncating it erases every supersession in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- MID-CASCADE ESCAPE, same reasoning as the object trigger: the case, the
    -- organization or the object itself is going.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id)
       or not exists (select 1 from thread_objects where id = old.thread_object_id) then
      return old;
    end if;
    raise exception
      'A thread-object version is not deleted. Deleting the version that was current leaves the chain pointing at nothing, and deleting the one that superseded it makes a supersession look like it never happened. A version that turned out to be wrong is superseded by a corrected one, on the record.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE'
     and not exists (select 1 from thread_objects where id = old.thread_object_id) then
    return new;
  end if;

  select * into o from thread_objects where id = new.thread_object_id;
  if not found then
    raise exception 'that thread object does not exist' using errcode = 'check_violation';
  end if;
  if o.organization_id <> new.organization_id then
    raise exception
      'That thread object belongs to another organization. A version is recorded inside its own tenant.'
      using errcode = 'check_violation';
  end if;
  if o.development_case_id <> new.development_case_id then
    raise exception
      'A version''s development case is the case its object belongs to. Two answers to "which case is this drawing on" is the failure this column exists to make impossible.'
      using errcode = 'check_violation';
  end if;
  if o.status = 'retired' and new.status <> 'draft' then
    raise exception
      'That thread object is retired. A retired object does not get a new authoritative version — the thread stopped at it, on the record, and declaring a current revision of something out of the thread would make the continuity report disagree with the severance ledger.'
      using errcode = 'check_violation';
  end if;

  -- RULING 5C-R9.
  if new.supersedes_version_id is not null
     and coalesce(length(btrim(new.change_summary)), 0) < 20 then
    raise exception
      'A version that supersedes another states what changed (change_summary, 20 characters minimum). Every downstream change receipt this supersession produces carries that sentence and nothing else — a receipt reading "something changed" is one nobody can act on (ruling 5C-R9).'
      using errcode = 'check_violation';
  end if;
  -- RULING 5C-R7, the other half. A DRAFT supersedes nothing: superseding is
  -- what declaring does, in the same statement, and a draft carrying the
  -- pointer produces a one-way chain — a row claiming to have replaced one
  -- that does not point back — which every read presents as intact.
  if new.status = 'draft' and new.supersedes_version_id is not null then
    raise exception
      'A draft revision supersedes nothing. The supersession is written by declare_thread_version_authoritative, in the same statement that makes this revision current and moves the incumbent — a draft holding the pointer claims to have replaced something that does not point back.'
      using errcode = 'check_violation';
  end if;
  if new.supersedes_version_id is not null then
    select * into prev from thread_object_versions where id = new.supersedes_version_id;
    if not found or prev.thread_object_id <> new.thread_object_id then
      raise exception
        'A version supersedes an earlier version OF THE SAME OBJECT. Superseding across objects would move one object''s history onto another''s and leave both wrong.'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.superseded_by_version_id is not null then
    select * into prev from thread_object_versions where id = new.superseded_by_version_id;
    if not found or prev.thread_object_id <> new.thread_object_id then
      raise exception
        'A version is superseded by a later version OF THE SAME OBJECT.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- What a version IS cannot be rewritten. Re-labelling Rev B as Rev C, or
    -- moving it to another object, rewrites what was released without
    -- releasing anything.
    if new.thread_object_id is distinct from old.thread_object_id
       or new.version_label is distinct from old.version_label
       or new.organization_id is distinct from old.organization_id
       or new.development_case_id is distinct from old.development_case_id then
      raise exception
        'What a version IS — its object and its label — cannot be rewritten by any caller, service paths included. A revision that turned out to be a different revision is a NEW row.'
        using errcode = 'insufficient_privilege';
    end if;
    -- ...AND SO IS WHAT IT SAYS, once it has been released. Freezing the label
    -- while leaving the CONTENT writable is the same defect wearing a
    -- different column: `update … set content_ref = <a different sheet> where
    -- status = 'authoritative'` leaves "Rev C is authoritative" pointing at a
    -- document nobody released, with no supersession, no receipt and no row
    -- recording the change. D11.06's claim is that supersession is RECORDED
    -- rather than overwritten; that claim is only true if the released row is
    -- immutable in the fields anybody reads.
    if old.status <> 'draft'
       and (new.content_ref is distinct from old.content_ref
            or new.issued_on is distinct from old.issued_on
            or new.change_summary is distinct from old.change_summary
            or new.declaration_basis is distinct from old.declaration_basis) then
      raise exception
        'A released revision is not edited. What it points at, when it was issued, what changed and on whose basis it went out are what the project stood behind at the time — a correction is the NEXT revision, declared, which supersedes this one on the record and raises the receipts. Rewriting them in place changes what everyone downstream believes they acknowledged.'
        using errcode = 'insufficient_privilege';
    end if;
    -- The declaration and the supersession chain move only through the
    -- recorded acts. Without this, `update … set status = ''authoritative''`
    -- releases a drawing with nobody named on it, and the §70 wall above never
    -- fires because `declared_by` was already set on some earlier row.
    if (new.status is distinct from old.status
        or new.declared_by is distinct from old.declared_by
        or new.declared_at is distinct from old.declared_at
        or new.supersedes_version_id is distinct from old.supersedes_version_id
        or new.superseded_by_version_id is distinct from old.superseded_by_version_id)
       and coalesce(current_setting('app.thread_version_write', true), '') <> 'granted' then
      raise exception
        'A version is declared authoritative through declare_thread_version_authoritative, which supersedes the incumbent and records the change. Moving the status column directly makes a revision current with no supersession, no receipt and nobody named — which is precisely the state spec II.2 exists to prevent.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Terminal means terminal. A superseded version does not come back: the
    -- thing that replaced it exists, and un-superseding would leave two rows
    -- both claiming to be what the other replaced.
    if old.status = 'superseded' and new.status <> 'superseded' then
      raise exception
        'A superseded version stays superseded. If the older revision is current again, declare it again as a NEW version — the history then says the project went back, instead of pretending it never moved.'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status = 'authoritative' and new.status = 'draft' then
      raise exception
        'A version that has been released is not returned to draft. Withdrawing a release is superseding it with the revision that is current instead.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Thread version %s of %s %s', new.version_label, o.object_kind, o.object_ref),
      tg_op,
      'A version written or moved outside record_thread_version / declare_thread_version_authoritative changes which revision the product reports as current, and every downstream change receipt is produced from that transition.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_thread_version_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_thread_version_integrity on public.thread_object_versions;
create trigger trg_thread_version_integrity
  before insert or update or delete on public.thread_object_versions
  for each row execute function public.enforce_thread_version_integrity();

drop trigger if exists trg_thread_version_no_truncate on public.thread_object_versions;
create trigger trg_thread_version_no_truncate
  before truncate on public.thread_object_versions
  for each statement execute function public.enforce_thread_version_integrity();

revoke truncate on table public.thread_object_versions from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Recording a version (a draft — not a release).
-- ---------------------------------------------------------------------------
create or replace function public.record_thread_version(
  p_object_id bigint,
  p_version jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  o thread_objects%rowtype;
  v_label text := nullif(btrim(coalesce(p_version->>'version_label','')), '');
  v_content text := nullif(btrim(coalesce(p_version->>'content_ref','')), '');
  v_summary text := nullif(btrim(coalesce(p_version->>'change_summary','')), '');
  v_issued date;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a thread-object version requires a planning, engineering or governance role');
  end if;
  select * into o from thread_objects where id = p_object_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'thread object not found');
  end if;
  if o.status = 'retired' then
    return jsonb_build_object('error',
      'that thread object is retired — it is out of the thread on the record, and recording a new revision of it would put it back without saying so');
  end if;
  if v_label is null then
    return jsonb_build_object('error',
      'name the revision (version_label) — "Rev C", "issue 4", whatever the project actually says');
  end if;
  begin
    v_issued := nullif(btrim(coalesce(p_version->>'issued_on','')), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'issued_on is not a date');
  end;
  if exists (select 1 from thread_object_versions
              where thread_object_id = o.id and version_label = v_label) then
    return jsonb_build_object('error',
      format('revision "%s" is already recorded against this object', v_label));
  end if;

  insert into thread_object_versions (organization_id, development_case_id,
    thread_object_id, version_label, issued_on, content_ref, change_summary,
    status, recorded_by)
  values (v_org, o.development_case_id, o.id, v_label, v_issued, v_content,
    v_summary, 'draft', auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_object_version', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', o.development_case_id, 'object_id', o.id,
      'object_ref', o.object_ref, 'version_id', v_id, 'version_label', v_label),
    null,
    jsonb_build_object('status', 'draft', 'issued_on', v_issued,
      'content_ref', v_content, 'change_summary', v_summary));

  return jsonb_build_object(
    'version_id', v_id,
    'objectRef', o.object_ref,
    'versionLabel', v_label,
    'status', 'draft',
    'note', 'Recorded as a DRAFT. Recording a revision does not make it current: declaring it authoritative is a separate, human-only act (§70), because a register where uploading a sheet silently made it the one to build from is the register that gets somebody hurt.');
end
$$;

revoke all on function public.record_thread_version(bigint, jsonb) from public, anon;
grant execute on function public.record_thread_version(bigint, jsonb) to authenticated, service_role;

comment on function public.record_thread_version(bigint, jsonb) is
  'D11.06: records a DRAFT version of a thread object. Deliberately separate from declaring it authoritative (ruling 5C-R8) — recording is bookkeeping, declaring is an engineering release.';

-- ---------------------------------------------------------------------------
-- 5. THE DECLARATION. §70, the partial unique index, and the recorded
--    supersession, in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.declare_thread_version_authoritative(
  p_version_id bigint,
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
  v thread_object_versions%rowtype;
  o thread_objects%rowtype;
  incumbent thread_object_versions%rowtype;
  v_basis text := btrim(coalesce(p_basis, ''));
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- §70 at the door as well as at the wall, and BEFORE the role list. The
  -- role list below already excludes `ai_admin`, so putting this second would
  -- make it unreachable — a specific refusal shadowed by a generic one is dead
  -- code inside a definer, which is the shape this repository refuses by name.
  -- The wall refuses the AI-operator identity in `declared_by`; this refuses it
  -- as the CALLER, with the reason a person would actually need to read.
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot declare a revision authoritative (spec §70). "This is the revision to build from" is an engineering release: the name on it is the name that will be asked why the fabricator built to the wrong sheet.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'declaring a revision authoritative requires a planning, engineering or governance role');
  end if;
  select * into v from thread_object_versions where id = p_version_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'version not found');
  end if;
  select * into o from thread_objects where id = v.thread_object_id;
  if o.status = 'retired' then
    return jsonb_build_object('error',
      'that thread object is retired — declaring a current revision of something out of the thread would make the continuity report and the severance ledger disagree');
  end if;
  if v.status = 'authoritative' then
    return jsonb_build_object('error', 'this revision is already the authoritative one');
  end if;
  if v.status = 'superseded' then
    return jsonb_build_object('error',
      'this revision was superseded. If it is current again, record it as a NEW revision and declare that — the history then says the project went back, instead of pretending it never moved.');
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('error',
      'state the basis for the release (20 characters minimum) — who checked it, against what, and on whose authority');
  end if;

  select * into incumbent from thread_object_versions
   where thread_object_id = v.thread_object_id and status = 'authoritative';

  -- RULING 5C-R9, at the door: a version that will supersede one states what
  -- changed, and it must already say so before the release happens.
  if found and coalesce(length(btrim(v.change_summary)), 0) < 20 then
    return jsonb_build_object('error',
      format('revision "%s" is about to supersede "%s" and has no statement of what changed. Record that first (change_summary, 20 characters minimum): every downstream receipt this produces carries that sentence and nothing else.',
        v.version_label, incumbent.version_label));
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.thread_version_write', 'granted', true);

  if incumbent.id is not null then
    -- RULING 5C-R7. Both pointers, and the incumbent moves rather than
    -- disappears. The incumbent is retired to `superseded` BEFORE the new row
    -- becomes authoritative, so the partial unique index is never asked to
    -- hold two.
    update thread_object_versions
       set status = 'superseded',
           superseded_by_version_id = v.id
     where id = incumbent.id;
  end if;

  update thread_object_versions
     set status = 'authoritative',
         declared_by = auth.uid(),
         declared_at = now(),
         declaration_basis = v_basis,
         supersedes_version_id = incumbent.id
   where id = v.id;

  perform set_config('app.thread_version_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'thread_version_declaration', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', o.development_case_id, 'object_id', o.id,
      'object_ref', o.object_ref, 'version_id', v.id),
    jsonb_build_object('authoritative_version_id', incumbent.id,
      'authoritative_version_label', incumbent.version_label),
    jsonb_build_object('authoritative_version_id', v.id,
      'authoritative_version_label', v.version_label,
      'declared_by', auth.uid(), 'basis', v_basis,
      'change_summary', v.change_summary));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values (v_org, auth.uid(),
    (select coalesce(p.full_name, u.email) from auth.users u
       left join user_profiles p on p.id = u.id where u.id = auth.uid()),
    'admin_action', 'notice',
    format('Revision %s of %s %s declared authoritative%s.',
      v.version_label, o.object_kind, o.object_ref,
      case when incumbent.id is null then ' (first issue)'
           else ', superseding ' || incumbent.version_label end));

  return jsonb_build_object(
    'version_id', v.id,
    'objectRef', o.object_ref,
    'versionLabel', v.version_label,
    'supersededVersionId', incumbent.id,
    'supersededVersionLabel', incumbent.version_label,
    'firstIssue', incumbent.id is null,
    'changeSummary', v.change_summary,
    'note', case when incumbent.id is null
      then 'First issue. Nothing was superseded, so no downstream receipt is produced — there is no change for anyone to acknowledge yet.'
      else 'Superseded the previous revision, both pointers written. Downstream receipts are raised for every object this one feeds, and they start UNACKNOWLEDGED — an explicit state, not an absence.' end);
end
$$;

revoke all on function public.declare_thread_version_authoritative(bigint, text) from public, anon;
grant execute on function public.declare_thread_version_authoritative(bigint, text)
  to authenticated, service_role;

comment on function public.declare_thread_version_authoritative(bigint, text) is
  'D11.06 / spec II.2 + §70: the engineering release. Moves the incumbent to `superseded` with both pointers written, then makes this one authoritative under the partial unique index. Refuses the AI-operator identity at the door and at the wall, refuses a supersession with no statement of what changed, and refuses re-declaring a superseded revision.';

-- ---------------------------------------------------------------------------
-- 6. Resolution — the question II.2 asks first.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_thread_authoritative_version(p_object_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  o thread_objects%rowtype;
  v thread_object_versions%rowtype;
  v_drafts int;
  v_draft_rows jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into o from thread_objects where id = p_object_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'thread object not found');
  end if;
  select * into v from thread_object_versions
   where thread_object_id = o.id and status = 'authoritative';
  select count(*) into v_drafts from thread_object_versions
   where thread_object_id = o.id and status = 'draft';
  -- The unreleased revisions, BY ID (D11.06 reachability). A count cannot be
  -- released: `declare_thread_version_authoritative` takes a version id, and
  -- until this read hands one out the only way to obtain it is to query the
  -- table — so the central act of this row would be reachable from psql and
  -- from nowhere in the product.
  select coalesce(jsonb_agg(jsonb_build_object(
           'versionId', d.id, 'versionLabel', d.version_label,
           'issuedOn', d.issued_on, 'contentRef', d.content_ref,
           'changeSummary', d.change_summary, 'recordedAt', d.created_at)
           order by d.created_at, d.id), '[]'::jsonb)
    into v_draft_rows
    from thread_object_versions d
   where d.thread_object_id = o.id and d.status = 'draft';

  -- RETIREMENT IS NOT A VERSION EVENT, and that is exactly why this refuses.
  -- `retire_thread_object` severs the object's hops and records the severance;
  -- it does not touch the version rows, so the incumbent stays `authoritative`
  -- for ever. Reporting it as the current revision tells somebody to build to a
  -- sheet whose object is on the record as OUT of the thread. The label is
  -- still stated — hiding it would lose the forensic answer — but not as an
  -- answer to "what is current".
  if o.status = 'retired' then
    return jsonb_build_object(
      'object_id', o.id,
      'objectRef', o.object_ref,
      'objectKind', o.object_kind,
      'objectStatus', o.status,
      'resolved', false,
      'draftCount', v_drafts,
      'drafts', v_draft_rows,
      'lastAuthoritativeLabel', v.version_label,
      'refusal', case when v.id is null
        then format('%s is RETIRED — out of the digital thread on the record — so it has no current revision and this read will not imply one.', o.object_ref)
        else format('%s is RETIRED — out of the digital thread on the record. Revision "%s" is still the last one that was declared authoritative, and it is named here so the history is not lost, but it is NOT the answer to "what is current": the object it belongs to left the thread, and building to it is building to a sheet the project has withdrawn.',
          o.object_ref, v.version_label) end);
  end if;

  if v.id is null then
    return jsonb_build_object(
      'object_id', o.id,
      'objectRef', o.object_ref,
      'resolved', false,
      'draftCount', v_drafts,
      -- REFUSAL, not a null. "No authoritative version" reads as "no version
      -- exists" unless it says otherwise, and the difference between those two
      -- is the difference between a project with no drawings and a project
      -- whose drawings nobody has released.
      'refusal', case when v_drafts > 0
        then format('%s revision(s) of %s are recorded and NONE has been declared authoritative. This is not "no version" — it is a register nobody has released from, and anyone working from one of those drafts is working from a sheet the project has not stood behind.', v_drafts, o.object_ref)
        else format('No revision of %s has been recorded at all. Nothing downstream of it can be said to be current, and this read refuses to imply otherwise by returning an empty answer.', o.object_ref) end);
  end if;

  return jsonb_build_object(
    'object_id', o.id,
    'objectRef', o.object_ref,
    'objectKind', o.object_kind,
    'resolved', true,
    'versionId', v.id,
    'versionLabel', v.version_label,
    'issuedOn', v.issued_on,
    'contentRef', v.content_ref,
    'contentHeld', v.content_ref is not null,
    'changeSummary', v.change_summary,
    'declaredAt', v.declared_at,
    'declaredBy', (select coalesce(u.full_name, u.email, v.declared_by::text)
                     from user_profiles u where u.id = v.declared_by),
    'declarationBasis', v.declaration_basis,
    'supersedesVersionId', v.supersedes_version_id,
    'supersedesVersionLabel', (select s.version_label from thread_object_versions s
                                where s.id = v.supersedes_version_id),
    'draftCount', v_drafts);
end
$$;

revoke all on function public.resolve_thread_authoritative_version(bigint) from public, anon;
grant execute on function public.resolve_thread_authoritative_version(bigint)
  to authenticated, service_role;

comment on function public.resolve_thread_authoritative_version(bigint) is
  'D11.06 / spec II.2 "current authoritative version": resolves one object to its one released revision, or REFUSES with the distinction that matters — no revision recorded at all, versus revisions recorded and none released.';

notify pgrst, 'reload schema';
