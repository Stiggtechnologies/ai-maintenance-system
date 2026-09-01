-- ============================================================================
-- Sync Develop Slice 5B — the frontline design review (D4.10, spec I.25) and
-- the recommendation disposition record (D4.11, spec I.25).
--
-- I.25 verbatim: "PMBOK empowered teams; Suncor frontline involvement. Require
-- maintenance/operators/constructors to review accessibility, isolation,
-- lifting, inspection, lubrication, ergonomics, removal routes, emergency
-- response. Capture accepted recommendation / rejected recommendation /
-- reason. Accountability for maintainability decisions."
--
-- WHAT ALREADY EXISTED, AND IS EXTENDED RATHER THAN REPLACED. `design_studies`
-- (20260818090000:154) carries `maintainer_participated` /
-- `operator_participated` booleans, `maintainability_review` /
-- `access_and_lifting` / `removal_route` kinds and `findings_count` /
-- `findings_closed` aggregates, and `get_project_posture` already reports
-- studies that ran without a maintainer. All of it stays. What was missing is
-- the part I.25 is actually about: WHO was in the room by name and discipline,
-- WHICH of the eight dimensions each recommendation concerns, and — the
-- accountability record — WHO answered it, HOW, and WHY.
--
-- ── RULING 1 — TWO ACTS, TWO RECORDS, ONE ACCOUNTABILITY CHAIN ─────────────
--
-- I.25 says "capture accepted recommendation / rejected recommendation /
-- reason" and does not say who accepts. Two readings are available and each
-- alone is wrong:
--
--   (a) the project dispositions the frontline's recommendation. Alone, this
--       makes the frontline an advisory body whose recommendations a project
--       can decline in silence — the exact failure I.25 exists to correct.
--   (b) the frontline dispositions the design. Alone, this makes a maintainer
--       the design authority, which they are not.
--
-- RULING: both, as two records. A FINDING is raised by a named human who was
-- recorded in the room, in a named discipline, against one of the eight
-- dimensions. A DISPOSITION is the accountable answer to it — accepted,
-- rejected, or accepted_with_conditions — recorded in the dispositioner's OWN
-- name, carrying the discipline they answer for, with a reason that is
-- mandatory on EVERY outcome and not only on a rejection. An acceptance with
-- no reason is a promise nobody can later check; a rejection with no reason is
-- the thing I.25 was written against.
--
-- ── RULING 2 — DISPOSITIONER ≠ RAISER ─────────────────────────────────────
--
-- The person who raised a design concern does not also record the answer to
-- it. Self-disposition is not an accountability record, it is a note. This is
-- the `risk_assurance_reviews` author≠assurer rule (20260921110102) applied
-- to the design room, and it is enforced at the door AND at the persistence
-- wall so no writer can dodge it. It is stated here rather than assumed
-- because it is a real constraint on a real customer: a lone maintainer
-- cannot close their own finding, and that is the intended behaviour.
--
-- ── RULING 3 — PARTICIPATION IS LOAD-BEARING, NOT DECORATIVE ──────────────
--
-- `maintainer_participated` / `operator_participated` were free booleans
-- anybody could type. On a CASE-BOUND study they are now DERIVED from
-- `design_study_participants` by trigger and cannot be typed at all: a writer
-- that sets one without a named participant behind it is REFUSED. The third
-- discipline I.25 names — constructors — was absent entirely and arrives as
-- `constructor_participated` on the same footing. Project-scoped rows
-- (development_case_id is null) keep their typed booleans EXACTLY as they
-- were: 20260818093000's demo project and every /design reading of it are
-- untouched.
--
-- And it is load-bearing in the other direction too: a finding may only be
-- raised BY a recorded participant, in THAT participant's discipline. A
-- frontline finding attributed to somebody who was not in the room is not
-- frontline participation.
--
-- ── RULING 4 — THE AGGREGATES BECOME ONE ANSWER ───────────────────────────
--
-- `findings_count` / `findings_closed` were the whole of D4.11 and are the
-- reason the row was 🟡: two integers with no rows behind them. On a
-- CASE-BOUND study they are now derived from the itemized findings and the
-- dispositions against them, by trigger, and a hand-typed value is REFUSED.
-- Two numbers answering "how many findings are open" is the two-answers
-- failure AGENTS.md forbids; this migration leaves exactly one.
--
-- ── RULING 5 — CONSEQUENCE RIDES THE SHIPPED BLOCKER MACHINERY ────────────
--
-- A disposition that changes nothing is theatre. An un-dispositioned frontline
-- finding therefore BLOCKS the gate — through the predicate family Slice 3C
-- built (20261122090300 §4c: "stated ONCE and consumed three times"), NOT
-- through a second evaluator. `case_frontline_design_obligations` is the ONE
-- new predicate; `case_gate_outstanding_obligations` APPENDS it (so
-- get_gate_readiness renders it for free), and
-- `enforce_gate_review_outstanding_obligations` refuses over it at the
-- persistence boundary for every writer. Both of those are transformed IN
-- PLACE from their live definitions and RAISE if the anchor is not found —
-- copying a 100-line body into this file is how a slice silently reverts a
-- fix made between then and now (20261130090700's stated reason).
--
-- Three blocker families, and the second one is the one that matters:
--   frontline_finding_open           raised, never answered.
--   frontline_acceptance_uncarried   accepted in the room, and no design
--                                    requirement carries it. This is the exact
--                                    shape of D3.09's `uncovered_commitment`
--                                    (a promise no requirement carries) and is
--                                    modelled on it deliberately.
--   frontline_review_unattended      a case-bound study of a kind I.25 demands
--                                    frontline attendance at, with nobody
--                                    recorded in the room.
--
-- SCOPE, STATED RATHER THAN QUIET: the blocker fires on rows that exist. A
-- case with NO design study at all is not blocked by this file. Making the
-- ABSENCE of a frontline review block a design-stage gate is a policy act on
-- the governance-intensity family (D3.16 decides what a case's governance
-- demands), and taking it here would re-decide another slice's contract from
-- inside this one — the refusal 20261122090300 already made for
-- `assurance_not_satisfied`. The register row says so rather than claiming a
-- refusal this code does not make.
--
-- ── RULING 6 — §70, AT FOUR DOORS AND FOUR WALLS ──────────────────────────
--
-- No AI or system identity attends a design review, raises a frontline
-- finding, dispositions one, or scores a design (the axis wall lands with
-- D4.12 in 20261205090100 and reuses this file's trigger function). These are
-- human judgements by definition, and an AI-recorded operator opinion is the
-- single most damaging thing this feature could ship: it would let the machine
-- manufacture the consent the whole capability exists to record. Refused by
-- name at every RPC door, and refused for EVERY writer — service key included,
-- no marker, no escape — at the table.
--
-- Canonical reuse: design_studies, design_requirements, development_cases,
-- stage_gates, case_gate_outstanding_obligations, audit_events,
-- app_current_org(), sync_text_as_int/uuid. No new gate evaluator, no second
-- requirement table, no parallel audit log.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. The vocabularies, named once, server-side — so the CHECKs, the doors,
--    the predicate, the reads and the TypeScript can never drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.sync_frontline_review_dimensions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'accessibility', 'isolation', 'lifting', 'inspection', 'lubrication',
    'ergonomics', 'removal_route', 'emergency_response']::text[];
$$;

comment on function public.sync_frontline_review_dimensions() is
  'D4.10 / spec I.25: the eight dimensions a frontline design review covers, VERBATIM from the specification and in its order. A finding names exactly one of them.';

create or replace function public.sync_frontline_disciplines()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['maintenance', 'operations', 'construction']::text[];
$$;

comment on function public.sync_frontline_disciplines() is
  'D4.10 / spec I.25: "maintenance/operators/constructors". The three frontline disciplines a participant attends as and a finding is raised in. The constructor role is the one design_studies never had.';

-- The dispositioner may also be the design authority answering the room, which
-- is not one of the three frontline disciplines (ruling 1). It is a FOURTH
-- value here and never a fourth participant discipline: engineering answers a
-- frontline finding, it does not attend as frontline.
create or replace function public.sync_disposition_disciplines()
returns text[]
language sql
immutable
set search_path = public
as $$
  select sync_frontline_disciplines() || array['engineering']::text[];
$$;

comment on function public.sync_disposition_disciplines() is
  'D4.11 / ruling 1: the disciplines a disposition may be answered for — the three frontline disciplines plus engineering (the design authority). Engineering is NOT a participant discipline: it answers the room, it does not attend as frontline.';

create or replace function public.sync_design_finding_outcomes()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['accepted', 'rejected', 'accepted_with_conditions']::text[];
$$;

comment on function public.sync_design_finding_outcomes() is
  'D4.11 / spec I.25 "accepted recommendation / rejected recommendation / reason", plus the third outcome every real review produces and the spec elides: accepted_with_conditions, which carries mandatory conditions.';

-- The study kinds at which I.25 demands somebody from the frontline is in the
-- room. Named rather than "every kind", because an equipment_selection or a
-- ram_study legitimately runs without an operator and calling that a defect
-- would make the blocker noise.
create or replace function public.sync_frontline_study_kinds()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    'frontline_design_review', 'maintainability_review',
    'access_and_lifting', 'removal_route']::text[];
$$;

comment on function public.sync_frontline_study_kinds() is
  'D4.10: the design_studies kinds I.25 demands frontline attendance at. A case-bound study of one of these kinds with nobody recorded in the room is a gate blocker (frontline_review_unattended).';

revoke all on function public.sync_frontline_review_dimensions() from public, anon;
revoke all on function public.sync_frontline_disciplines() from public, anon;
revoke all on function public.sync_disposition_disciplines() from public, anon;
revoke all on function public.sync_design_finding_outcomes() from public, anon;
revoke all on function public.sync_frontline_study_kinds() from public, anon;
grant execute on function public.sync_frontline_review_dimensions() to authenticated, service_role;
grant execute on function public.sync_frontline_disciplines() to authenticated, service_role;
grant execute on function public.sync_disposition_disciplines() to authenticated, service_role;
grant execute on function public.sync_design_finding_outcomes() to authenticated, service_role;
grant execute on function public.sync_frontline_study_kinds() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. design_studies grows the case scope, the third discipline, and the
--    'frontline_design_review' kind.
--
--    THE NOT NULL ON project_id IS TRANSFORMED, NOT DROPPED. A development
--    case is not required to have a capital_projects row
--    (development_cases.capital_project_id is nullable, 20261101090200:48), so
--    a case-scoped study cannot always carry one. The invariant that matters —
--    "a study is scoped to something" — is preserved by a CHECK added in the
--    SAME statement block, so no window exists in which a study could be
--    scoped to neither.
-- ---------------------------------------------------------------------------
alter table public.design_studies
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists constructor_participated boolean not null default false,
  add column if not exists recorded_by uuid references auth.users(id);

do $scope$
begin
  alter table public.design_studies alter column project_id drop not null;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.design_studies'::regclass
                   and conname = 'design_studies_scoped_somewhere') then
    alter table public.design_studies
      add constraint design_studies_scoped_somewhere
      check (project_id is not null or development_case_id is not null);
  end if;
end
$scope$;

create index if not exists idx_dstudy_case
  on design_studies(organization_id, development_case_id, study_kind)
  where development_case_id is not null;

comment on column public.design_studies.development_case_id is
  'D4.10 (20261205090000): the ONE design-study table generalized from capital_projects to the development case. Null keeps the pre-existing project-scoped contract exactly as it was, including its typed participation booleans and typed finding aggregates.';
comment on column public.design_studies.constructor_participated is
  'D4.10 / I.25 "maintenance/operators/constructors": the third discipline design_studies never had. On a case-bound study it is DERIVED from design_study_participants and cannot be typed (ruling 3).';

-- The 'frontline_design_review' kind, added as a UNION of the existing eight
-- (the 20261204090000 category-union idiom): transform the live constraint, or
-- RAISE. A migration that cannot find what it came to change fails loudly
-- rather than dropping something else and installing a check nobody reviewed.
do $kind$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.design_studies'::regclass
     and conname = 'design_studies_study_kind_check';

  if v_def is null then
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.design_studies'::regclass
                     and conname = 'design_studies_study_kind_frontline_union') then
      raise exception
        'design_studies has neither the original study_kind CHECK nor the frontline union CHECK — the table is not in a state this migration understands. Re-derive against the live constraint set before applying.'
        using errcode = 'check_violation';
    end if;
  else
    if position('removal_route' in v_def) = 0 then
      raise exception
        'design_studies_study_kind_check is not the 20260818090000 eight-kind constraint (%). Do not widen a constraint blind.',
        v_def
        using errcode = 'check_violation';
    end if;
    alter table public.design_studies
      drop constraint design_studies_study_kind_check;
    alter table public.design_studies
      add constraint design_studies_study_kind_frontline_union
      check (study_kind in
        ('equipment_selection', 'maintainability_review', 'access_and_lifting',
         'removal_route', 'standardisation_review', 'sparing_review',
         'instrumentation_review', 'ram_study', 'frontline_design_review'));
  end if;
end
$kind$;

-- Case-scoped study rows are definer-RPC-only, stated RESTRICTIVELY so a later
-- permissive INSERT policy for the project side cannot silently open the case
-- side too (the design_requirements idiom, 20261122090000:165).
drop policy if exists design_studies_case_no_ins on public.design_studies;
create policy design_studies_case_no_ins on public.design_studies as restrictive
  for insert to authenticated
  with check (development_case_id is null);
drop policy if exists design_studies_case_no_upd on public.design_studies;
create policy design_studies_case_no_upd on public.design_studies as restrictive
  for update to authenticated
  using (development_case_id is null)
  with check (development_case_id is null);
drop policy if exists design_studies_case_no_del on public.design_studies;
create policy design_studies_case_no_del on public.design_studies as restrictive
  for delete to authenticated
  using (development_case_id is null);

-- ---------------------------------------------------------------------------
-- 2. §70 — the human-only wall, one function, four triggers.
--
--    Written once and parameterised by column because four near-identical
--    copies is how one of them ends up missing the UPDATE branch. TG_ARGV[0]
--    is the actor column, TG_ARGV[1] the act, named in the refusal so the
--    message is specific to what was attempted.
--
--    SECURITY DEFINER because it reads user_profiles, which is RLS-scoped.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_frontline_judgement_is_human()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text := tg_argv[0];
  v_act text := tg_argv[1];
  v_actor uuid;
  v_role text;
begin
  -- FAIL LOUD ON A MIS-BINDING (5B-R1). `to_jsonb(new)->>'<column that does
  -- not exist>'` is NULL rather than an error, so a typo in TG_ARGV[0] — or a
  -- column renamed by a later slice — would silently disable §70 on that table
  -- while the trigger stayed present and apparently firing. A wall that can be
  -- switched off by a rename is not a wall.
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
  select role into v_role from user_profiles where id = v_actor;
  if coalesce(v_role, '') = 'ai_admin' then
    raise exception
      'The AI-operator identity cannot % (spec §70: no AI or system identity attends a design review, raises a frontline finding, dispositions a recommendation or scores a design). These are human judgements by definition — a machine-recorded operator opinion manufactures the consent this record exists to capture.',
      v_act
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_frontline_judgement_is_human()
  from public, anon, authenticated;

comment on function public.enforce_frontline_judgement_is_human() is
  'D4.10/D4.11/D4.12 §70 wall: refuses the AI-operator identity in the actor column named by TG_ARGV[0], for EVERY writer, on INSERT and UPDATE. One function, six triggers, so no copy can quietly lose its UPDATE branch. RAISES when bound to a column the table does not have (5B-R1), so a rename cannot silently uninstall it.';

-- ---------------------------------------------------------------------------
-- 2b. THE PROVENANCE BACKSTOP (5B-R2).
--
--     Every wall in this file refuses the writes that must never happen. What
--     was missing is the other half of this repository's convention: the
--     writes that ARE admitted outside the definer RPCs — a service key
--     inserting a participant, a disposition, a score or an interface directly
--     — left NOTHING behind. A service key could answer a maintainer's
--     recommendation on their behalf, clear the gate blocker, and leave no row
--     to find. This is the `enforce_development_sanction_provenance` /
--     20261203090000:443 shape: admit, and RECORD.
--
--     ONLY ON ADMITTED PATHS (4D-R33). A BEFORE trigger that inserts a
--     security_events row and then RAISEs loses the insert with the aborted
--     statement, so an audit call on a refusing path is dead code that reads
--     as an audit trail. The refusal is the enforcement; these rows cover what
--     the refusals let through.
-- ---------------------------------------------------------------------------
create or replace function public.record_frontline_service_write(
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

revoke all on function public.record_frontline_service_write(uuid, text, text, text)
  from public, anon, authenticated;

comment on function public.record_frontline_service_write(uuid, text, text, text) is
  'D4.10/D4.11/D4.12/D4.18 provenance backstop: records the service-path writes the frontline walls ADMIT, so a design record changed outside the RPCs leaves something to find. Never called on a refusing path (4D-R33).';

drop trigger if exists trg_design_study_recorder_is_human on public.design_studies;
create trigger trg_design_study_recorder_is_human
  before insert or update on public.design_studies
  for each row execute function public.enforce_frontline_judgement_is_human(
    'recorded_by', 'record a design study');

-- ---------------------------------------------------------------------------
-- 3. WHO WAS IN THE ROOM (D4.10). By name and by discipline.
-- ---------------------------------------------------------------------------
create table if not exists public.design_study_participants (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  study_id bigint not null references design_studies(id) on delete cascade,
  participant_id uuid not null references auth.users(id),
  discipline text not null check (discipline = any (sync_frontline_disciplines())),
  -- I.23's standard applied to a review: not "somebody from maintenance" but
  -- WHY this person speaks for the discipline. Nullable, and reported as
  -- missing rather than invented.
  basis text,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (study_id, participant_id, discipline)
);

create index if not exists idx_dstudy_participant_study
  on design_study_participants(study_id, discipline);

alter table public.design_study_participants enable row level security;
drop policy if exists dstudy_participants_read on public.design_study_participants;
create policy dstudy_participants_read on public.design_study_participants
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: participation is recorded through the definer RPC.

comment on table public.design_study_participants is
  'D4.10 / spec I.25: who attended a design review, by name and by one of the three frontline disciplines. The study''s maintainer/operator/constructor booleans are DERIVED from these rows on a case-bound study, and a finding may only be raised by somebody recorded here.';

drop trigger if exists trg_design_participant_is_human on public.design_study_participants;
create trigger trg_design_participant_is_human
  before insert or update on public.design_study_participants
  for each row execute function public.enforce_frontline_judgement_is_human(
    'participant_id', 'be recorded as a design-review participant');

-- Tenancy the FK cannot police: the study, the participant and the row must
-- be the same organization. INSERT and UPDATE, every writer.
create or replace function public.enforce_design_participant_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s design_studies%rowtype;
begin
  select * into s from design_studies where id = new.study_id;
  if not found or s.organization_id <> new.organization_id then
    raise exception
      'That design study belongs to another organization. A review roster is a tenant structure, and a participant recorded across the boundary is a tenancy hole wearing an attendance list.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from user_profiles u
                  where u.id = new.participant_id
                    and u.organization_id = new.organization_id) then
    raise exception
      'A design-review participant must be a member of this organization. Accountability that points outside the tenant is not accountability.'
      using errcode = 'check_violation';
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Design-review attendance (study %s, participant %s as %s)',
             new.study_id, new.participant_id, new.discipline),
      tg_op,
      'Attendance drives the DERIVED maintainer / operator / constructor flags a gate reads, so a roster written outside add_design_study_participant can make a review look attended that nobody attended.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_design_participant_tenancy()
  from public, anon, authenticated;

drop trigger if exists trg_design_participant_tenancy on public.design_study_participants;
create trigger trg_design_participant_tenancy
  before insert or update on public.design_study_participants
  for each row execute function public.enforce_design_participant_tenancy();

-- ---------------------------------------------------------------------------
-- 4. THE FINDING (D4.10) — one of the eight dimensions, raised by somebody who
--    was in the room, in that person's discipline.
-- ---------------------------------------------------------------------------
create table if not exists public.design_review_findings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  study_id bigint not null references design_studies(id) on delete cascade,
  finding_ref text not null,
  dimension text not null
    check (dimension = any (sync_frontline_review_dimensions())),
  raised_by uuid not null references auth.users(id),
  -- 5B-R3, THE SCRIBE COLUMN. `raised_by` is WHOSE opinion this is, and a
  -- caller may name somebody other than themselves — recording for the room is
  -- a real and ordinary act. `recorded_by` is WHO TYPED IT, always the caller,
  -- and it exists because without it one person could put a recommendation in
  -- a named colleague's mouth and then answer it themselves: the raiser ≠
  -- dispositioner wall compares the ATTRIBUTED raiser, so proxy attribution
  -- walks straight through it. §70 stops the machine manufacturing frontline
  -- consent; this stops a colleague doing it, and leaves the trace §70's
  -- refusal would have left.
  recorded_by uuid not null references auth.users(id),
  raised_by_discipline text not null
    check (raised_by_discipline = any (sync_frontline_disciplines())),
  -- What they want changed. I.25's "recommendation".
  recommendation text not null check (length(btrim(recommendation)) >= 20),
  severity text not null default 'significant'
    check (severity in ('blocking', 'significant', 'minor')),
  -- D4.11's "the requirement it concerns": the design requirement that CARRIES
  -- this recommendation. Nullable because the requirement usually does not
  -- exist yet — and an accepted finding with this still null is a gate blocker
  -- (frontline_acceptance_uncarried), which is the whole point of the column.
  requirement_id bigint references design_requirements(id) on delete set null,
  raised_at timestamptz not null default now(),
  unique (organization_id, finding_ref)
);

create index if not exists idx_dfinding_study
  on design_review_findings(study_id, dimension);
create index if not exists idx_dfinding_requirement
  on design_review_findings(requirement_id) where requirement_id is not null;

alter table public.design_review_findings enable row level security;
drop policy if exists dfinding_read on public.design_review_findings;
create policy dfinding_read on public.design_review_findings
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: findings are raised through the definer RPC.

comment on table public.design_review_findings is
  'D4.10/D4.11 / spec I.25: an itemized frontline recommendation against one of the eight dimensions, attributed to a named human who was recorded in the room. A finding with no disposition BLOCKS the case''s gates through case_frontline_design_obligations.';

drop trigger if exists trg_design_finding_raiser_is_human on public.design_review_findings;
create trigger trg_design_finding_raiser_is_human
  before insert or update on public.design_review_findings
  for each row execute function public.enforce_frontline_judgement_is_human(
    'raised_by', 'raise a frontline design-review finding');

-- The scribe is human too. An AI identity typing a maintainer's recommendation
-- for them is the same act §70 forbids, wearing an attribution.
drop trigger if exists trg_design_finding_scribe_is_human on public.design_review_findings;
create trigger trg_design_finding_scribe_is_human
  before insert or update on public.design_review_findings
  for each row execute function public.enforce_frontline_judgement_is_human(
    'recorded_by', 'record a frontline design-review finding for somebody');

-- ---------------------------------------------------------------------------
-- 5. THE DISPOSITION (D4.11) — the accountability record.
--
--    Append-only, latest wins. A disposition can be REVISED when something
--    new is learned; it cannot be rewritten or removed, because the value of
--    the record is entirely in what it says about the answer that was given at
--    the time.
-- ---------------------------------------------------------------------------
create table if not exists public.design_finding_dispositions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  finding_id bigint not null references design_review_findings(id) on delete cascade,
  disposition_no int not null check (disposition_no > 0),
  outcome text not null check (outcome = any (sync_design_finding_outcomes())),
  -- MANDATORY ON EVERY OUTCOME (ruling 1), not only on a rejection.
  reason text not null check (length(btrim(reason)) >= 20),
  conditions text,
  dispositioned_by uuid not null references auth.users(id),
  disposition_discipline text not null
    check (disposition_discipline = any (sync_disposition_disciplines())),
  dispositioned_at timestamptz not null default now(),
  unique (finding_id, disposition_no),
  -- Conditions exist exactly when the outcome is conditional. An
  -- accepted_with_conditions carrying no conditions is an acceptance wearing a
  -- hedge; conditions on a flat acceptance are a condition nothing tracks.
  constraint design_disposition_conditions_shape check (
    (outcome = 'accepted_with_conditions')
      = (conditions is not null and btrim(conditions) <> ''))
);

create index if not exists idx_ddisposition_finding
  on design_finding_dispositions(finding_id, disposition_no desc);

alter table public.design_finding_dispositions enable row level security;
drop policy if exists ddisposition_read on public.design_finding_dispositions;
create policy ddisposition_read on public.design_finding_dispositions
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: dispositions are recorded through the definer RPC.

comment on table public.design_finding_dispositions is
  'D4.11 / spec I.25 "accepted recommendation / rejected recommendation / reason": the accountability record. Who answered a frontline recommendation, in which discipline, with what outcome and — mandatory on every outcome — why. Append-only for every caller; TRUNCATE revoked and refused at statement level.';

drop trigger if exists trg_disposition_author_is_human on public.design_finding_dispositions;
create trigger trg_disposition_author_is_human
  before insert or update on public.design_finding_dispositions
  for each row execute function public.enforce_frontline_judgement_is_human(
    'dispositioned_by', 'disposition a frontline design-review recommendation');

-- ---------------------------------------------------------------------------
-- 6. The finding's own integrity wall — every writer, INSERT and UPDATE.
--
--    A finding is raised by somebody recorded in the room, in that person's
--    discipline. The RPC checks it at the door; this is the wall, so a service
--    key cannot mint a "maintenance" finding attributed to a person who was
--    never there.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_design_finding_from_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s design_studies%rowtype;
begin
  -- MID-CASCADE ESCAPE. `design_requirements.id` is referenced here with
  -- `on delete set null`, so deleting a case fires an UPDATE on findings whose
  -- study the same cascade may already have removed. Without this the FK
  -- promised a cleanup this trigger forbade, and a case that had ever held a
  -- carried recommendation became undeletable (the
  -- enforce_verification_result_provenance idiom, 20261204090100).
  if tg_op = 'UPDATE'
     and not exists (select 1 from design_studies where id = old.study_id) then
    return new;
  end if;

  select * into s from design_studies where id = new.study_id;
  if not found or s.organization_id <> new.organization_id then
    raise exception
      'That design study belongs to another organization. A finding is raised inside the tenant that held the review.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from design_study_participants p
                  where p.study_id = new.study_id
                    and p.participant_id = new.raised_by
                    and p.discipline = new.raised_by_discipline) then
    raise exception
      'A frontline finding can only be raised by somebody recorded as a participant of that review, in the discipline they attended as. Record who was in the room first — a maintenance finding attributed to a person who was never there is the opposite of frontline participation.'
      using errcode = 'check_violation';
  end if;
  -- 5B-R3. The scribe is a member of this tenant. A finding typed by somebody
  -- outside the organization is a frontline record with no accountable author,
  -- and the read renders their name.
  if not exists (select 1 from user_profiles u
                  where u.id = new.recorded_by
                    and u.organization_id = new.organization_id) then
    raise exception
      'Whoever records a frontline finding must be a member of this organization. A recommendation typed by somebody this tenant cannot ask about it is not an accountability record.'
      using errcode = 'check_violation';
  end if;
  -- The carried requirement belongs to the same tenant and, when the study is
  -- case-bound, to the same case. A finding "carried" by another case's
  -- requirement would make both cases' coverage reports wrong in opposite
  -- directions (the 20261204090000 cross-case parent rule).
  if new.requirement_id is not null then
    if not exists (select 1 from design_requirements d
                    where d.id = new.requirement_id
                      and d.organization_id = new.organization_id) then
      raise exception
        'That design requirement belongs to another organization.'
        using errcode = 'check_violation';
    end if;
    if s.development_case_id is not null
       and not exists (select 1 from design_requirements d
                        where d.id = new.requirement_id
                          and d.development_case_id = s.development_case_id) then
      raise exception
        'The requirement carrying this recommendation must belong to the same development case as the review that raised it.'
        using errcode = 'check_violation';
    end if;
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Frontline design finding %s (study %s, %s / %s, raised_by %s, recorded_by %s)',
             new.finding_ref, new.study_id, new.raised_by_discipline, new.dimension,
             new.raised_by, new.recorded_by),
      tg_op,
      'An open finding blocks every gate on the case and an accepted one is a commitment, so a finding written outside raise_design_review_finding changes what the gate refuses over.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_design_finding_from_participant()
  from public, anon, authenticated;

drop trigger if exists trg_design_finding_from_participant on public.design_review_findings;
create trigger trg_design_finding_from_participant
  before insert or update on public.design_review_findings
  for each row execute function public.enforce_design_finding_from_participant();

-- ---------------------------------------------------------------------------
-- 7. Immutability + the disposition SoD wall (ruling 2), for every writer.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_design_finding_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'design_review_findings records what the people who will maintain and operate this asset said about its design. Truncating it erases every one of those in a single statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- Mid-cascade: a declared parent is already gone (the
    -- enforce_verification_result_provenance idiom, 20261204090100).
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from design_studies where id = old.study_id) then
      return old;
    end if;
    raise exception
      'A frontline design finding is not deleted. One that turned out to be unnecessary is DISPOSITIONED as rejected with a stated reason — deleting it makes a recommendation that was overruled indistinguishable from one that was never raised, which is exactly the record spec I.25 exists to create.'
      using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE. Everything that identifies the finding and everything that says
  -- WHO said WHAT is frozen; only the carried requirement moves, and it moves
  -- through carry_design_finding_to_requirement.
  if new.study_id is distinct from old.study_id
     or new.finding_ref is distinct from old.finding_ref
     or new.dimension is distinct from old.dimension
     or new.raised_by is distinct from old.raised_by
     or new.recorded_by is distinct from old.recorded_by
     or new.raised_by_discipline is distinct from old.raised_by_discipline
     or new.recommendation is distinct from old.recommendation
     or new.severity is distinct from old.severity
     or new.organization_id is distinct from old.organization_id then
    raise exception
      'What a frontline reviewer recommended, on which dimension, in which discipline and at what severity — and who typed it for them — cannot be rewritten by ANY caller, service paths included. A recommendation that can be re-worded, re-attributed or re-scribed after it was answered is not a record of what was said. Raise a new finding, or disposition this one.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_design_finding_immutable()
  from public, anon, authenticated;

drop trigger if exists trg_design_finding_immutable on public.design_review_findings;
create trigger trg_design_finding_immutable
  before update or delete on public.design_review_findings
  for each row execute function public.enforce_design_finding_immutable();

drop trigger if exists trg_design_finding_no_truncate on public.design_review_findings;
create trigger trg_design_finding_no_truncate
  before truncate on public.design_review_findings
  for each statement execute function public.enforce_design_finding_immutable();

revoke truncate on table public.design_review_findings from anon, authenticated, service_role;

create or replace function public.enforce_disposition_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f design_review_findings%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'design_finding_dispositions is the accountability record for every frontline recommendation this organization answered. Truncating it erases who accepted what, who rejected what, and why, in one statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from design_review_findings where id = old.finding_id) then
      return old;
    end if;
    raise exception
      'A disposition is not deleted. An answer that turned out to be wrong is SUPERSEDED by a later disposition on the same finding, which is recorded beside it — deleting one makes a rejection that was overturned indistinguishable from a rejection that never happened.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if new.finding_id is distinct from old.finding_id
       or new.disposition_no is distinct from old.disposition_no
       or new.outcome is distinct from old.outcome
       or new.reason is distinct from old.reason
       or new.conditions is distinct from old.conditions
       or new.dispositioned_by is distinct from old.dispositioned_by
       or new.disposition_discipline is distinct from old.disposition_discipline
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'A recorded disposition cannot be rewritten by ANY caller, service paths included — an outcome or a reason that can be edited after the fact is not an accountability record. Record a NEW disposition on the same finding; the earlier one stays visible beside it.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- INSERT. Tenancy, membership, then ruling 2.
  select * into f from design_review_findings where id = new.finding_id;
  if not found or f.organization_id <> new.organization_id then
    raise exception
      'That finding belongs to another organization. A disposition is recorded inside the tenant that raised the finding.'
      using errcode = 'check_violation';
  end if;
  -- 5B-R4. The dispositioner is a MEMBER of this tenant. Without this the
  -- §70 wall reads as string equality against a profile that need not exist,
  -- so an identity with no user_profiles row at all — exactly the shape of an
  -- unprovisioned system account — was admitted, and a member of ANOTHER
  -- tenant was admitted and then rendered onto this tenant's screen by the
  -- read's user_profiles join. The sibling triggers on participants and
  -- interfaces have carried this check since they were written.
  if not exists (select 1 from user_profiles u
                  where u.id = new.dispositioned_by
                    and u.organization_id = new.organization_id) then
    raise exception
      'Whoever answers a frontline recommendation must be a member of this organization. An accountable answer from an identity this tenant has no profile for is not accountability, and an identity with no profile is exactly what an unprovisioned system account looks like.'
      using errcode = 'check_violation';
  end if;
  if new.dispositioned_by = f.raised_by then
    raise exception
      'The person who raised a frontline finding cannot record the answer to it (spec I.25 accountability; the author-is-not-assurer rule this platform already enforces on assurance reviews). Self-disposition is a note, not an accountability record.'
      using errcode = 'check_violation';
  end if;
  -- 5B-R3, THE PROXY DODGE. The rule above compares the ATTRIBUTED raiser, so
  -- somebody who raised a finding in a colleague's name would pass it and
  -- answer their own recommendation. The scribe is barred from answering what
  -- they wrote for exactly the reason the raiser is.
  if new.dispositioned_by = f.recorded_by then
    raise exception
      'The person who RECORDED this finding cannot record the answer to it either. Writing a recommendation down in somebody else''s name and then answering it yourself is self-disposition with an attribution in front of it, which is what the raiser-is-not-dispositioner rule exists to stop.'
      using errcode = 'check_violation';
  end if;
  -- 5B-R5. A frontline DISCIPLINE claim is checked against the room. This
  -- column is the load-bearing sentence of the whole record — "maintenance
  -- accepted this" — and it was a free choice among four. `raised_by_discipline`
  -- has always been read from the roster; the asymmetry inside one file was the
  -- defect. `engineering` needs no roster entry, because ruling 1 says the
  -- design authority ANSWERS the room rather than attending it.
  if new.disposition_discipline <> 'engineering'
     and not exists (select 1 from design_study_participants p
                      where p.study_id = f.study_id
                        and p.participant_id = new.dispositioned_by
                        and p.discipline = new.disposition_discipline) then
    raise exception
      'Answering for %s means being recorded in that discipline at this review. A disposition that claims a frontline discipline nobody attended in makes "%s accepted this" a sentence with nothing behind it — answer as engineering (the design authority answers the room), or record the attendance that actually happened.',
      new.disposition_discipline, new.disposition_discipline
      using errcode = 'check_violation';
  end if;
  if auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Disposition %s on finding %s (%s by %s as %s)',
             new.disposition_no, new.finding_id, new.outcome,
             new.dispositioned_by, new.disposition_discipline),
      tg_op,
      'A disposition written outside disposition_design_finding answers a maintainer''s recommendation on their behalf AND clears the gate blocker it was holding.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_disposition_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_disposition_integrity on public.design_finding_dispositions;
create trigger trg_disposition_integrity
  before insert or update or delete on public.design_finding_dispositions
  for each row execute function public.enforce_disposition_integrity();

drop trigger if exists trg_disposition_no_truncate on public.design_finding_dispositions;
create trigger trg_disposition_no_truncate
  before truncate on public.design_finding_dispositions
  for each statement execute function public.enforce_disposition_integrity();

revoke truncate on table public.design_finding_dispositions from anon, authenticated, service_role;
revoke truncate on table public.design_study_participants from anon, authenticated, service_role;

-- The roster is a record of who was in a room on a date, so it is not quietly
-- editable either. There is no removal RPC and no client write policy; this is
-- the wall for the service and superuser paths.
create or replace function public.enforce_design_participant_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'design_study_participants records who was in the room. Truncating it turns every attended review on this platform into an unattended one in a single statement; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from design_studies where id = old.study_id) then
      return old;
    end if;
    raise exception
      'An attendance record is not deleted. Removing the person a finding is attributed to would leave that finding claiming a discipline nobody in the room held, and would silently clear the participation flags a gate reads.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.study_id is distinct from old.study_id
     or new.participant_id is distinct from old.participant_id
     or new.discipline is distinct from old.discipline
     or new.organization_id is distinct from old.organization_id then
    raise exception
      'Who attended a design review, and in which discipline, cannot be rewritten by ANY caller, service paths included. Record the attendance that actually happened.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_design_participant_immutable()
  from public, anon, authenticated;

drop trigger if exists trg_design_participant_immutable on public.design_study_participants;
create trigger trg_design_participant_immutable
  before update or delete on public.design_study_participants
  for each row execute function public.enforce_design_participant_immutable();

drop trigger if exists trg_design_participant_no_truncate on public.design_study_participants;
create trigger trg_design_participant_no_truncate
  before truncate on public.design_study_participants
  for each statement execute function public.enforce_design_participant_immutable();

-- ---------------------------------------------------------------------------
-- 7b. THE PARENT (5B-R6). Every wall above is on a CHILD of `design_studies`,
--     and the parent carried none of them: no DELETE guard, no TRUNCATE guard,
--     and nothing freezing the case a study belongs to. Each child's DELETE
--     branch deliberately steps aside when the study is already gone (the
--     mid-cascade escape a legitimate case teardown needs), so a single
--     `delete from design_studies` walked through all three walls at once —
--     erasing every participant, every finding and every disposition, and
--     clearing every gate blocker with them. `update ... set
--     development_case_id = null` did the same to the gate without even
--     touching the rows.
--
--     The children's immunity is only as real as the parent's, so the parent
--     gets the same treatment: refused for EVERY writer, service key included,
--     with the genuine organization / development-case cascade admitted AND
--     recorded. Project-scoped rows (development_case_id is null) keep the
--     pre-existing 20260818090000 contract exactly as it was — this file
--     narrows nothing that was already working on the /design side.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_case_study_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'design_studies is the parent of every frontline attendance record, finding and disposition on this platform, and each of those tables refuses TRUNCATE. Truncating the parent would erase them through the declared cascade instead; the table is not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    -- The project side is untouched: it never had this guard and nothing in
    -- this slice hangs off it.
    if old.development_case_id is null then
      return old;
    end if;
    -- MID-CASCADE. The organization or the development case is already gone,
    -- so this delete is the declared teardown rather than a targeted erasure.
    -- Admitted, and RECORDED — a case that had ever held a frontline review
    -- must not be able to take it away silently.
    if not exists (select 1 from organizations where id = old.organization_id)
       or not exists (select 1 from development_cases where id = old.development_case_id) then
      perform record_frontline_service_write(old.organization_id,
        format('Design study %s (%s) and every attendance, finding and disposition under it',
               old.id, old.study_kind),
        tg_op,
        'Removed with the development case it belonged to. The case and its frontline record disappear together, which is the only admitted way either disappears (D4.10).');
      return old;
    end if;
    raise exception
      'A case-bound design study is not deleted. Deleting it takes every participant, every recommendation and every disposition recorded under it through the declared cascade — each of those tables refuses deletion for exactly that reason, and the gate blockers they hold would clear with them. Record what actually happened instead; nothing here is ever unsaid.'
      using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE. The case a review belongs to and the kind of review it was are
  -- what the blocker predicate reads, so both are frozen once the study is
  -- case-bound: re-kinding a frontline review to 'ram_study' cleared the
  -- unattended blocker, and detaching it cleared all three.
  if old.development_case_id is not null then
    if new.development_case_id is distinct from old.development_case_id
       or new.study_kind is distinct from old.study_kind
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'The development case a design review belongs to, the kind of review it was, and its organization cannot be changed by ANY caller, service paths included. All three decide which gate obligations the review raises, so moving one is a way of discharging an obligation without answering it. Record a new study.'
        using errcode = 'insufficient_privilege';
    end if;
    if auth.uid() is null then
      perform record_frontline_service_write(new.organization_id,
        format('Design study %s (%s, case %s)', new.id, new.study_kind, new.development_case_id),
        tg_op,
        'The participation flags and finding aggregates on this row are DERIVED, so a service update either matches the rows or is refused — this records that one was attempted outside the RPCs.');
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_case_study_immutable()
  from public, anon, authenticated;

drop trigger if exists trg_case_study_immutable on public.design_studies;
create trigger trg_case_study_immutable
  before update or delete on public.design_studies
  for each row execute function public.enforce_case_study_immutable();

drop trigger if exists trg_case_study_no_truncate on public.design_studies;
create trigger trg_case_study_no_truncate
  before truncate on public.design_studies
  for each statement execute function public.enforce_case_study_immutable();

revoke truncate on table public.design_studies from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RULINGS 3 AND 4 — the derived participation flags and the derived
--    aggregates, on CASE-BOUND studies only.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_case_study_derivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maint boolean;
  v_ops boolean;
  v_cons boolean;
  v_count int;
  v_closed int;
begin
  if new.development_case_id is null then
    return new;
  end if;

  select coalesce(bool_or(discipline = 'maintenance'), false),
         coalesce(bool_or(discipline = 'operations'), false),
         coalesce(bool_or(discipline = 'construction'), false)
    into v_maint, v_ops, v_cons
    from design_study_participants where study_id = new.id;

  if new.maintainer_participated is distinct from v_maint
     or new.operator_participated is distinct from v_ops
     or new.constructor_participated is distinct from v_cons then
    raise exception
      'On a case-bound design study the maintainer / operator / constructor flags are DERIVED from the people recorded in the room (design_study_participants) and cannot be typed. Add the participant; the flag follows. A typed participation flag is a claim that a review happened with nobody behind it.'
      using errcode = 'check_violation';
  end if;

  select count(*)::int,
         count(*) filter (where exists (
           select 1 from design_finding_dispositions d where d.finding_id = f.id))::int
    into v_count, v_closed
    from design_review_findings f where f.study_id = new.id;

  if new.findings_count is distinct from v_count
     or new.findings_closed is distinct from v_closed then
    raise exception
      'On a case-bound design study findings_count and findings_closed are DERIVED from the itemized findings and the dispositions recorded against them, and cannot be typed. Two numbers answering "how many recommendations are still open" is exactly the aggregate-without-rows this slice exists to replace.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and auth.uid() is null then
    perform record_frontline_service_write(new.organization_id,
      format('Design study %s on case %s', new.study_kind, new.development_case_id),
      tg_op,
      'A frontline-kind study recorded outside record_case_design_study raises an unattended-review gate blocker nobody asked for, or supplies the parent a service-written finding needs.');
  end if;
  return new;
end
$$;

revoke all on function public.enforce_case_study_derivation()
  from public, anon, authenticated;

drop trigger if exists trg_case_study_derivation on public.design_studies;
create trigger trg_case_study_derivation
  before insert or update on public.design_studies
  for each row execute function public.enforce_case_study_derivation();

-- The writer of the derived values. Fires AFTER any change to the children, so
-- the parent's flags and aggregates are never stale, and re-derives the parent
-- the change belonged to (both parents, if a row moved between studies).
create or replace function public.refresh_design_study_derivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids bigint[] := array[]::bigint[];
  v_id bigint;
  v_finding bigint;
begin
  if tg_table_name = 'design_finding_dispositions' then
    v_finding := case when tg_op = 'DELETE' then old.finding_id else new.finding_id end;
    select array_agg(distinct study_id) into v_ids
      from design_review_findings where id = v_finding;
  else
    if tg_op <> 'INSERT' then v_ids := v_ids || old.study_id; end if;
    if tg_op <> 'DELETE' then v_ids := v_ids || new.study_id; end if;
  end if;

  foreach v_id in array coalesce(v_ids, array[]::bigint[]) loop
    -- Skip a parent already gone: this fires mid-cascade when a study or a
    -- case is deleted, and an UPDATE of a deleted row is a silent no-op that
    -- would leave the aggregate half-written if the row came back.
    if exists (select 1 from design_studies where id = v_id and development_case_id is not null) then
      update design_studies s set
        maintainer_participated = coalesce((select bool_or(p.discipline = 'maintenance')
          from design_study_participants p where p.study_id = s.id), false),
        operator_participated = coalesce((select bool_or(p.discipline = 'operations')
          from design_study_participants p where p.study_id = s.id), false),
        constructor_participated = coalesce((select bool_or(p.discipline = 'construction')
          from design_study_participants p where p.study_id = s.id), false),
        findings_count = (select count(*) from design_review_findings f where f.study_id = s.id),
        findings_closed = (select count(*) from design_review_findings f
                            where f.study_id = s.id
                              and exists (select 1 from design_finding_dispositions d
                                           where d.finding_id = f.id))
      where s.id = v_id;
    end if;
  end loop;
  return null;
end
$$;

revoke all on function public.refresh_design_study_derivation()
  from public, anon, authenticated;

drop trigger if exists trg_refresh_study_from_participants on public.design_study_participants;
create trigger trg_refresh_study_from_participants
  after insert or update or delete on public.design_study_participants
  for each row execute function public.refresh_design_study_derivation();

drop trigger if exists trg_refresh_study_from_findings on public.design_review_findings;
create trigger trg_refresh_study_from_findings
  after insert or update or delete on public.design_review_findings
  for each row execute function public.refresh_design_study_derivation();

drop trigger if exists trg_refresh_study_from_dispositions on public.design_finding_dispositions;
create trigger trg_refresh_study_from_dispositions
  after insert or update or delete on public.design_finding_dispositions
  for each row execute function public.refresh_design_study_derivation();

-- ---------------------------------------------------------------------------
-- 9. THE WRITE PATHS. Four doors, each a SECURITY DEFINER RPC with a role
--    check, the §70 refusal by name, and an audit_events row carrying
--    previous_state / new_state.
--
--    WHO MAY DO WHAT, stated rather than assumed:
--      * recording a STUDY is a planning/engineering act (the
--        record_case_requirement role set);
--      * attending, raising and dispositioning are FRONTLINE acts, so the
--        supervisor and technician roles — the people who will actually
--        maintain and operate the thing — are admitted BY NAME. A design
--        review whose findings only a manager may type is not a frontline
--        design review.
--      * ai_admin is refused at all four.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_design_study(
  p_case_id uuid,
  p_study jsonb
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
  v_kind text := nullif(btrim(coalesce(p_study->>'study_kind','')), '');
  v_summary text := nullif(btrim(coalesce(p_study->>'summary','')), '');
  v_on date;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording a design review is a §70 human act — the AI-operator identity may prepare the agenda, it does not assert that a review took place');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'recording a design study requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_kind is null or v_kind not in
     ('equipment_selection','maintainability_review','access_and_lifting',
      'removal_route','standardisation_review','sparing_review',
      'instrumentation_review','ram_study','frontline_design_review') then
    return jsonb_build_object('error',
      'study_kind must be one of: equipment_selection, maintainability_review, access_and_lifting, removal_route, standardisation_review, sparing_review, instrumentation_review, ram_study, frontline_design_review');
  end if;
  if v_summary is null or length(v_summary) < 20 then
    return jsonb_build_object('error',
      'state what the review covered (summary, 20 characters minimum) — a study with no scope cannot be read later as evidence that anything was examined');
  end if;
  begin
    v_on := coalesce(nullif(btrim(coalesce(p_study->>'performed_on','')), '')::date, current_date);
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'performed_on is not a date');
  end;
  if v_on > current_date then
    return jsonb_build_object('error',
      'a design review cannot be recorded as performed in the future');
  end if;

  insert into design_studies (organization_id, project_id, development_case_id,
    study_kind, performed_on, summary, recorded_by)
  values (v_org, c.capital_project_id, c.id, v_kind, v_on, v_summary, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_study', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'study_id', v_id, 'study_kind', v_kind),
    null,
    jsonb_build_object('study_kind', v_kind, 'performed_on', v_on,
      'summary', v_summary, 'frontline_kind', v_kind = any (sync_frontline_study_kinds())));

  return jsonb_build_object('study_id', v_id, 'case_id', c.id,
    'studyKind', v_kind,
    'frontlineKind', v_kind = any (sync_frontline_study_kinds()),
    'note', case when v_kind = any (sync_frontline_study_kinds())
      then 'This is a review spec I.25 demands the frontline attends. Until somebody is recorded in the room it is a gate blocker (frontline_review_unattended).'
      else 'This kind of study does not demand frontline attendance, so no unattended blocker is raised for it.' end);
end
$$;

revoke all on function public.record_case_design_study(uuid, jsonb) from public, anon;
grant execute on function public.record_case_design_study(uuid, jsonb) to authenticated, service_role;

comment on function public.record_case_design_study(uuid, jsonb) is
  'D4.10 / spec I.25: the first customer write path design_studies has ever had (the table was demo-seed only). Case-scoped; the participation flags and finding aggregates it creates are derived, never typed.';

-- ---------------------------------------------------------------------------
create or replace function public.add_design_study_participant(
  p_study_id bigint,
  p_participant jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  s design_studies%rowtype;
  v_member uuid := sync_text_as_uuid(p_participant->>'participant_id');
  v_discipline text := nullif(btrim(coalesce(p_participant->>'discipline','')), '');
  v_basis text := nullif(btrim(coalesce(p_participant->>'basis','')), '');
  v_member_role text;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'recording who attended a design review is a §70 human act — the AI-operator identity cannot place a person in a room');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'recording a design-review participant requires an operating, planning, engineering or governance role');
  end if;
  select * into s from design_studies
    where id = p_study_id and organization_id = v_org and development_case_id is not null;
  if not found then
    return jsonb_build_object('error',
      'case-bound design study not found — participants are recorded against a study on a development case');
  end if;
  if p_participant ? 'participant_id'
     and nullif(btrim(coalesce(p_participant->>'participant_id','')), '') is not null
     and v_member is null then
    return jsonb_build_object('error', 'participant_id is not a valid identifier');
  end if;
  if v_member is null then
    return jsonb_build_object('error',
      'name who attended (participant_id) — "somebody from maintenance" is not frontline participation');
  end if;
  if v_discipline is null or not (v_discipline = any (sync_frontline_disciplines())) then
    return jsonb_build_object('error',
      format('discipline must be one of the three spec I.25 frontline disciplines: %s',
        array_to_string(sync_frontline_disciplines(), ', ')));
  end if;
  select role into v_member_role from user_profiles
    where id = v_member and organization_id = v_org;
  if v_member_role is null then
    return jsonb_build_object('error',
      'that participant is not a member of this organization');
  end if;
  if v_member_role = 'ai_admin' then
    return jsonb_build_object('error',
      'the AI-operator identity cannot attend a design review (spec §70) — a machine recorded in the room would make every participation figure on this case a fiction');
  end if;
  if exists (select 1 from design_study_participants
             where study_id = s.id and participant_id = v_member and discipline = v_discipline) then
    return jsonb_build_object('error',
      'that person is already recorded on this review in that discipline');
  end if;

  insert into design_study_participants (organization_id, study_id, participant_id,
    discipline, basis, recorded_by)
  values (v_org, s.id, v_member, v_discipline, v_basis, auth.uid())
  returning id into v_id;

  select * into s from design_studies where id = s.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_study_participant', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', s.development_case_id, 'study_id', s.id,
      'participant_id', v_member, 'discipline', v_discipline),
    null,
    jsonb_build_object('discipline', v_discipline, 'basis', v_basis,
      'maintainer_participated', s.maintainer_participated,
      'operator_participated', s.operator_participated,
      'constructor_participated', s.constructor_participated));

  return jsonb_build_object('participant_id', v_id, 'study_id', s.id,
    'discipline', v_discipline,
    'maintainerParticipated', s.maintainer_participated,
    'operatorParticipated', s.operator_participated,
    'constructorParticipated', s.constructor_participated,
    'basisStated', v_basis is not null);
end
$$;

revoke all on function public.add_design_study_participant(bigint, jsonb) from public, anon;
grant execute on function public.add_design_study_participant(bigint, jsonb) to authenticated, service_role;

comment on function public.add_design_study_participant(bigint, jsonb) is
  'D4.10 / spec I.25: records WHO was in the room, by name and discipline. Recording a participant is what MOVES maintainer_participated / operator_participated / constructor_participated on a case-bound study — the flags cannot be typed (ruling 3).';

-- ---------------------------------------------------------------------------
create or replace function public.raise_design_review_finding(
  p_study_id bigint,
  p_finding jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  s design_studies%rowtype;
  v_ref text := nullif(btrim(coalesce(p_finding->>'finding_ref','')), '');
  v_dimension text := nullif(btrim(coalesce(p_finding->>'dimension','')), '');
  v_recommendation text := btrim(coalesce(p_finding->>'recommendation',''));
  v_severity text := coalesce(nullif(btrim(coalesce(p_finding->>'severity','')), ''), 'significant');
  v_raised_by uuid := coalesce(sync_text_as_uuid(p_finding->>'raised_by'), auth.uid());
  v_stated text := nullif(btrim(coalesce(p_finding->>'discipline','')), '');
  v_discipline text;
  v_seen int;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'raising a frontline design finding is a §70 human act — the AI-operator identity may flag a pattern, it does not hold a maintainer''s opinion about a design');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'raising a design-review finding requires an operating, planning, engineering or governance role');
  end if;
  select * into s from design_studies
    where id = p_study_id and organization_id = v_org and development_case_id is not null;
  if not found then
    return jsonb_build_object('error', 'case-bound design study not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a finding carries a reference the rest of the project can cite (finding_ref)');
  end if;
  if v_dimension is null or not (v_dimension = any (sync_frontline_review_dimensions())) then
    return jsonb_build_object('error',
      format('dimension must be one of the eight spec I.25 review dimensions: %s',
        array_to_string(sync_frontline_review_dimensions(), ', ')));
  end if;
  if length(v_recommendation) < 20 then
    return jsonb_build_object('error',
      'state the recommendation — what should change and why (20 characters minimum)');
  end if;
  if v_severity not in ('blocking','significant','minor') then
    return jsonb_build_object('error', 'severity must be one of: blocking, significant, minor');
  end if;
  if p_finding ? 'raised_by'
     and nullif(btrim(coalesce(p_finding->>'raised_by','')), '') is not null
     and sync_text_as_uuid(p_finding->>'raised_by') is null then
    return jsonb_build_object('error', 'raised_by is not a valid identifier');
  end if;
  if v_stated is not null and not (v_stated = any (sync_frontline_disciplines())) then
    return jsonb_build_object('error',
      format('discipline must be one of the three spec I.25 frontline disciplines: %s',
        array_to_string(sync_frontline_disciplines(), ', ')));
  end if;

  -- The discipline is READ FROM THE ROSTER, never invented: a finding's
  -- discipline is a discipline the person actually attended as. A caller may
  -- NAME which one when the person attended in more than one (a supervisor
  -- recorded for both maintenance and construction is ordinary), and is
  -- REFUSED with the ambiguity named rather than having one silently picked.
  if v_stated is not null then
    select discipline into v_discipline from design_study_participants
      where study_id = s.id and participant_id = v_raised_by and discipline = v_stated;
    if v_discipline is null then
      return jsonb_build_object('error',
        format('that person is not recorded on this review as %s. A finding is raised in the discipline somebody attended as.', v_stated));
    end if;
  else
    select count(*)::int, min(discipline) into v_seen, v_discipline
      from design_study_participants
     where study_id = s.id and participant_id = v_raised_by;
    if coalesce(v_seen, 0) = 0 then
      return jsonb_build_object('error',
        'that person is not recorded as a participant of this review. A frontline finding is raised by somebody who was in the room — record the attendance first (add_design_study_participant).');
    end if;
    if v_seen > 1 then
      return jsonb_build_object('error',
        'that person attended this review in more than one discipline, so state which one this finding is raised in (discipline). Picking one for you would file a constructor''s view as maintenance''s.');
    end if;
  end if;
  if exists (select 1 from design_review_findings
             where organization_id = v_org and finding_ref = v_ref) then
    return jsonb_build_object('error',
      format('finding reference "%s" already exists in this organization — pick another rather than overwriting somebody else''s recommendation', v_ref));
  end if;

  insert into design_review_findings (organization_id, study_id, finding_ref,
    dimension, raised_by, recorded_by, raised_by_discipline, recommendation, severity)
  values (v_org, s.id, v_ref, v_dimension, v_raised_by, auth.uid(), v_discipline,
    v_recommendation, v_severity)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_review_finding', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', s.development_case_id, 'study_id', s.id,
      'finding_id', v_id, 'finding_ref', v_ref, 'dimension', v_dimension),
    null,
    -- 5B-R3: `recorded_by` is the CALLER, and it goes in the audit row because
    -- `actor` is a role string ('planner') and `raised_by` is whoever the
    -- caller named. Without this the ledger could not answer "who typed it".
    jsonb_build_object('dimension', v_dimension, 'discipline', v_discipline,
      'severity', v_severity, 'raised_by', v_raised_by,
      'recorded_by', auth.uid(), 'by_proxy', v_raised_by <> auth.uid(),
      'recommendation', v_recommendation, 'disposition', null));

  return jsonb_build_object('finding_id', v_id, 'study_id', s.id,
    'findingRef', v_ref, 'dimension', v_dimension, 'discipline', v_discipline,
    'severity', v_severity,
    'raisedBy', v_raised_by, 'recordedBy', auth.uid(),
    'byProxy', v_raised_by <> auth.uid(),
    'note', case when v_raised_by <> auth.uid()
      then 'This finding is OPEN and blocks every gate on this case until it is dispositioned. You recorded it in somebody else''s name, so it carries you as the scribe — and neither they nor you may record the answer to it.'
      else 'This finding is OPEN and blocks every gate on this case until somebody other than the person who raised it records a disposition against it.' end);
end
$$;

revoke all on function public.raise_design_review_finding(bigint, jsonb) from public, anon;
grant execute on function public.raise_design_review_finding(bigint, jsonb) to authenticated, service_role;

comment on function public.raise_design_review_finding(bigint, jsonb) is
  'D4.10 / spec I.25: an itemized recommendation on one of the eight dimensions. The discipline is READ FROM THE ROSTER rather than taken from the caller, and a person who was not in the room cannot have a finding attributed to them (door and wall).';

-- ---------------------------------------------------------------------------
create or replace function public.disposition_design_finding(
  p_finding_id bigint,
  p_disposition jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f design_review_findings%rowtype;
  s design_studies%rowtype;
  v_outcome text := nullif(btrim(coalesce(p_disposition->>'outcome','')), '');
  v_reason text := btrim(coalesce(p_disposition->>'reason',''));
  v_conditions text := nullif(btrim(coalesce(p_disposition->>'conditions','')), '');
  v_discipline text := nullif(btrim(coalesce(p_disposition->>'discipline','')), '');
  v_prev jsonb;
  v_no int;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'dispositioning a frontline recommendation is a §70 human act, refused to the AI-operator identity by name. An AI-recorded acceptance would manufacture exactly the frontline consent this record exists to capture.');
  end if;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner',
      'supervisor','technician') then
    return jsonb_build_object('error',
      'dispositioning a design-review finding requires an operating, planning, engineering or governance role');
  end if;
  select * into f from design_review_findings where id = p_finding_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'design review finding not found');
  end if;
  select * into s from design_studies where id = f.study_id;
  if v_outcome is null or not (v_outcome = any (sync_design_finding_outcomes())) then
    return jsonb_build_object('error',
      format('outcome must be one of: %s', array_to_string(sync_design_finding_outcomes(), ', ')));
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('error',
      'a disposition carries a reason on EVERY outcome, not only on a rejection (20 characters minimum). An acceptance with no reason is a promise nobody can later check.');
  end if;
  if v_outcome = 'accepted_with_conditions' and v_conditions is null then
    return jsonb_build_object('error',
      'accepted_with_conditions carries the conditions. An acceptance hedged by conditions nobody wrote down is a rejection that reads as an acceptance.');
  end if;
  if v_outcome <> 'accepted_with_conditions' and v_conditions is not null then
    return jsonb_build_object('error',
      'conditions belong to the accepted_with_conditions outcome — a condition on a flat acceptance is a condition nothing tracks');
  end if;
  if v_discipline is null or not (v_discipline = any (sync_disposition_disciplines())) then
    return jsonb_build_object('error',
      format('state the discipline you are answering for, one of: %s',
        array_to_string(sync_disposition_disciplines(), ', ')));
  end if;
  -- Ruling 2, at the door. The wall behind it is trg_disposition_integrity.
  if f.raised_by = auth.uid() then
    return jsonb_build_object('error',
      'you raised this finding, so you cannot record the answer to it. Self-disposition is a note, not an accountability record — the platform applies the same author-is-not-assurer rule to assurance reviews.');
  end if;
  -- 5B-R3. The scribe is barred too: the rule above compares the ATTRIBUTED
  -- raiser, so writing a recommendation in a colleague's name and answering it
  -- yourself would otherwise walk straight through it.
  if f.recorded_by = auth.uid() then
    return jsonb_build_object('error',
      'you recorded this finding, so you cannot record the answer to it. Writing a recommendation down in somebody else''s name and then answering it is self-disposition with an attribution in front of it.');
  end if;
  -- 5B-R5. Claiming a frontline discipline means having attended in it.
  if v_discipline <> 'engineering'
     and not exists (select 1 from design_study_participants p
                      where p.study_id = f.study_id
                        and p.participant_id = auth.uid()
                        and p.discipline = v_discipline) then
    return jsonb_build_object('error',
      format('you are not recorded at this review as %s, so you cannot answer for %s. This field is what makes the record read "%s accepted this" — answer as engineering (the design authority answers the room rather than attending it), or have the attendance recorded first.',
        v_discipline, v_discipline, v_discipline));
  end if;

  select jsonb_build_object('outcome', d.outcome, 'reason', d.reason,
           'conditions', d.conditions, 'dispositioned_by', d.dispositioned_by,
           'discipline', d.disposition_discipline, 'disposition_no', d.disposition_no)
    into v_prev
    from design_finding_dispositions d
   where d.finding_id = f.id order by d.disposition_no desc limit 1;

  select coalesce(max(disposition_no), 0) + 1 into v_no
    from design_finding_dispositions where finding_id = f.id;

  insert into design_finding_dispositions (organization_id, finding_id,
    disposition_no, outcome, reason, conditions, dispositioned_by,
    disposition_discipline)
  values (v_org, f.id, v_no, v_outcome, v_reason, v_conditions, auth.uid(), v_discipline)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_finding_disposition', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', s.development_case_id, 'finding_id', f.id,
      'finding_ref', f.finding_ref, 'disposition_id', v_id, 'disposition_no', v_no),
    v_prev,
    jsonb_build_object('outcome', v_outcome, 'reason', v_reason,
      'conditions', v_conditions, 'dispositioned_by', auth.uid(),
      'discipline', v_discipline, 'disposition_no', v_no));

  return jsonb_build_object('disposition_id', v_id, 'finding_id', f.id,
    'dispositionNo', v_no, 'outcome', v_outcome,
    'supersedes', v_prev,
    'requirementCarried', f.requirement_id is not null,
    'note', case
      when v_outcome = 'rejected' then
        'Recorded. The recommendation is answered, so it no longer blocks the gate — and the rejection, its reason and its author stay on the record permanently.'
      when f.requirement_id is null then
        'Recorded. An ACCEPTED recommendation that no design requirement carries still blocks the gate (frontline_acceptance_uncarried) — accepting it in the room and never building it is the failure spec I.25 exists to stop. Carry it with carry_design_finding_to_requirement.'
      else
        'Recorded, and a design requirement already carries it.' end);
end
$$;

revoke all on function public.disposition_design_finding(bigint, jsonb) from public, anon;
grant execute on function public.disposition_design_finding(bigint, jsonb) to authenticated, service_role;

comment on function public.disposition_design_finding(bigint, jsonb) is
  'D4.11 / spec I.25: THE accountability record — accepted / rejected / accepted_with_conditions, in the dispositioner''s own name, with a reason mandatory on every outcome. §70-refused to the AI-operator identity at the door and at the wall; the raiser cannot answer their own finding (ruling 2).';

-- ---------------------------------------------------------------------------
create or replace function public.carry_design_finding_to_requirement(
  p_finding_id bigint,
  p_requirement_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f design_review_findings%rowtype;
  s design_studies%rowtype;
  d design_requirements%rowtype;
  v_outcome text;
  v_prev bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error',
      'carrying a recommendation into a design requirement requires a planning, engineering or governance role');
  end if;
  select * into f from design_review_findings where id = p_finding_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'design review finding not found');
  end if;
  select * into s from design_studies where id = f.study_id;
  select * into d from design_requirements where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'design requirement not found');
  end if;
  if s.development_case_id is not null
     and d.development_case_id is distinct from s.development_case_id then
    return jsonb_build_object('error',
      'that requirement belongs to a different development case — a recommendation is carried by a requirement on the case whose review raised it');
  end if;
  -- Alias `dd`, not `d`: `d` is the design_requirements record variable above,
  -- and a table alias that shadows it resolves to the variable ("record d has
  -- no field outcome") at run time rather than at create time.
  select dd.outcome into v_outcome from design_finding_dispositions dd
   where dd.finding_id = f.id order by dd.disposition_no desc limit 1;
  if v_outcome is null then
    return jsonb_build_object('error',
      'this finding has not been dispositioned yet. A requirement raised against a recommendation nobody has answered records an acceptance that never happened — disposition it first.');
  end if;
  -- 5B-R7. Only an ACCEPTANCE is carried. "Carried by REQ-04" beside a
  -- rejection reads as a commitment the room declined to make, and the
  -- blocker family this act discharges only ever fires on an acceptance.
  if v_outcome not in ('accepted', 'accepted_with_conditions') then
    return jsonb_build_object('error',
      format('the latest disposition on this finding is "%s", so there is nothing to carry. A requirement is the record of a recommendation the project ACCEPTED; pointing one at a rejection says the opposite of what was decided.', v_outcome));
  end if;
  -- 5B-R7. And not onto a requirement that is already known not to hold. The
  -- blocker this act discharges exists to stop "accepted in the room and never
  -- built"; discharging it with a requirement whose verification FAILED, or one
  -- that was waived, is the same failure with a link in front of it.
  if d.verification_status in ('failed', 'waived') then
    return jsonb_build_object('error',
      format('design requirement %s is %s, so it cannot carry an accepted recommendation. Carrying an acceptance on a requirement that has been verified as not achieved (or waived) discharges the gate obligation while leaving the recommendation exactly as unbuilt as it was — pick a requirement that still stands, or raise one.',
        d.requirement_ref, d.verification_status));
  end if;

  v_prev := f.requirement_id;
  update design_review_findings set requirement_id = d.id where id = f.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'design_finding_requirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', s.development_case_id, 'finding_id', f.id,
      'finding_ref', f.finding_ref, 'requirement_id', d.id),
    jsonb_build_object('requirement_id', v_prev),
    jsonb_build_object('requirement_id', d.id, 'requirement_ref', d.requirement_ref));

  return jsonb_build_object('finding_id', f.id, 'requirement_id', d.id,
    'requirementRef', d.requirement_ref, 'previousRequirementId', v_prev);
end
$$;

revoke all on function public.carry_design_finding_to_requirement(bigint, bigint) from public, anon;
grant execute on function public.carry_design_finding_to_requirement(bigint, bigint) to authenticated, service_role;

comment on function public.carry_design_finding_to_requirement(bigint, bigint) is
  'D4.11: links an ANSWERED recommendation to the design requirement that carries it — the act that clears the frontline_acceptance_uncarried blocker. Refused before a disposition exists: a requirement raised against an unanswered recommendation records an acceptance that never happened.';

-- ---------------------------------------------------------------------------
-- 10. THE ONE PREDICATE (ruling 5). Stated once, consumed FOUR times:
--       * case_gate_outstanding_obligations appends it, so get_gate_readiness
--         renders it without a second query;
--       * enforce_gate_review_outstanding_obligations refuses over it at the
--         persistence boundary, for every writer, INSERT and UPDATE;
--       * record_case_gate_review trips that wall, so the act site refuses;
--       * get_case_frontline_review renders it on the case surface.
--     One function, so displayed truth and enforced truth cannot diverge.
--
--     NO GATE ARGUMENT, deliberately. These obligations are properties of the
--     CASE, not of a particular gate: an unanswered maintainer is unanswered at
--     every gate. Taking a gate id would imply a per-gate scoping this file
--     does not implement and would invite one to be invented later.
--
--     THE DUAL-CALLER GATE IS auth.uid(). Inside a SECURITY DEFINER
--     `current_user` is the function owner for every caller alike, so
--     `current_user in ('authenticated','anon')` is dead code that never fires
--     — 20261130090700 repaired thirteen of them and this file does not add a
--     fourteenth.
-- ---------------------------------------------------------------------------
create or replace function public.case_frontline_design_obligations(p_case_id uuid)
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
  v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and v_caller_org is null then
    return '[]'::jsonb;
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return '[]'::jsonb;
  end if;
  v_org := c.organization_id;

  -- (1) Raised, never answered. The differentiator: a maintainer said the pump
  -- cannot be pulled and nobody has answered them.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'frontline_finding_open',
      'id', f.id,
      'name', f.finding_ref || ' (' || f.raised_by_discipline || ', ' || f.dimension || '): '
              || f.recommendation,
      'dimension', f.dimension,
      'discipline', f.raised_by_discipline,
      'severity', f.severity,
      'studyId', f.study_id,
      'raisedAt', f.raised_at)
      -- SEVERITY ORDER, NOT ALPHABETICAL ORDER. `order by f.severity` over a
      -- text column sorts blocking, minor, significant — putting the least
      -- serious recommendation above the more serious one in the very list a
      -- gate refusal prints.
      order by array_position(array['blocking','significant','minor'], f.severity),
               f.finding_ref), '[]'::jsonb)
  into v_out
  from design_review_findings f
  join design_studies s on s.id = f.study_id
  where f.organization_id = v_org
    and s.development_case_id = c.id
    and not exists (select 1 from design_finding_dispositions d where d.finding_id = f.id);

  -- (2) Accepted in the room, and no design requirement carries it. The exact
  -- shape of D3.09's uncovered_commitment, and for the same reason: a promise
  -- nothing carries is a promise that will not be kept.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'frontline_acceptance_uncarried',
      'id', f.id,
      'name', f.finding_ref || ' (' || f.raised_by_discipline || ', ' || f.dimension
              || ') was ' || latest.outcome || ' and no design requirement carries it: '
              || f.recommendation,
      'dimension', f.dimension,
      'discipline', f.raised_by_discipline,
      'outcome', latest.outcome,
      'studyId', f.study_id)
      order by f.finding_ref), '[]'::jsonb)
  into v_out
  from design_review_findings f
  join design_studies s on s.id = f.study_id
  join lateral (
    select d.outcome from design_finding_dispositions d
     where d.finding_id = f.id order by d.disposition_no desc limit 1) latest on true
  where f.organization_id = v_org
    and s.development_case_id = c.id
    and f.requirement_id is null
    and latest.outcome in ('accepted', 'accepted_with_conditions');

  -- (2b) Accepted, CARRIED, and the requirement carrying it has been verified
  -- as not achieved — or waived. Family (2) clears the moment a requirement id
  -- is attached, which made "carried" mean "linked" rather than "will be
  -- built": an acceptance discharged onto a requirement whose verification
  -- FAILED is exactly the failure family (2) exists to stop, with a link in
  -- front of it. `carry_design_finding_to_requirement` refuses to create this
  -- state; this family catches the one that arrives when a carrier goes
  -- terminal-bad AFTERWARDS, which is the ordinary way it happens.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'frontline_acceptance_carried_by_failed_requirement',
      'id', f.id,
      'name', f.finding_ref || ' (' || f.raised_by_discipline || ', ' || f.dimension
              || ') was ' || latest.outcome || ', and the only requirement carrying it ('
              || dr.requirement_ref || ') is ' || dr.verification_status || ': '
              || f.recommendation,
      'dimension', f.dimension,
      'discipline', f.raised_by_discipline,
      'outcome', latest.outcome,
      'requirementId', dr.id,
      'requirementRef', dr.requirement_ref,
      'verificationStatus', dr.verification_status,
      'studyId', f.study_id)
      order by f.finding_ref), '[]'::jsonb)
  into v_out
  from design_review_findings f
  join design_studies s on s.id = f.study_id
  join design_requirements dr on dr.id = f.requirement_id
  join lateral (
    select d.outcome from design_finding_dispositions d
     where d.finding_id = f.id order by d.disposition_no desc limit 1) latest on true
  where f.organization_id = v_org
    and s.development_case_id = c.id
    and latest.outcome in ('accepted', 'accepted_with_conditions')
    and dr.verification_status in ('failed', 'waived');

  -- (3) A review spec I.25 demands the frontline attends, with nobody in the
  -- room. The participation flags are derived, so this reads the roster
  -- directly rather than trusting a boolean.
  select v_out || coalesce(jsonb_agg(jsonb_build_object(
      'type', 'frontline_review_unattended',
      'id', s.id,
      'name', format('The %s recorded on this case has nobody from maintenance, operations or construction recorded in the room (spec I.25 requires maintenance/operators/constructors to review it).',
                     replace(s.study_kind, '_', ' ')),
      'studyKind', s.study_kind,
      'performedOn', s.performed_on)
      order by s.id), '[]'::jsonb)
  into v_out
  from design_studies s
  where s.organization_id = v_org
    and s.development_case_id = c.id
    and s.study_kind = any (sync_frontline_study_kinds())
    and not exists (select 1 from design_study_participants p where p.study_id = s.id);

  return v_out;
end
$$;

revoke all on function public.case_frontline_design_obligations(uuid) from public, anon;
grant execute on function public.case_frontline_design_obligations(uuid) to authenticated, service_role;

comment on function public.case_frontline_design_obligations(uuid) is
  'D4.10/D4.11 / spec I.25: the frontline design obligations that BLOCK a gate — an un-dispositioned recommendation, an accepted recommendation no requirement carries, and a review the frontline never attended. Appended by case_gate_outstanding_obligations, refused over by enforce_gate_review_outstanding_obligations, rendered by get_gate_readiness and by get_case_frontline_review: one predicate, four consumers.';

-- ---------------------------------------------------------------------------
-- 11. WIRING, BY TRANSFORMATION (ruling 5). Both functions below are edited IN
--     PLACE from their live definitions and RAISE if the anchor is absent.
--     Re-typing a 100-line body here is how a slice silently reverts a fix made
--     between then and now — the reason 20261130090700 was written the same
--     way, and the reason 20261122090300 records for rebuilding
--     get_gate_readiness from the wrong ancestor.
-- ---------------------------------------------------------------------------
do $wire$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'case_gate_outstanding_obligations';
  if v_def is null then
    raise exception
      'case_gate_outstanding_obligations does not exist — the Slice 3C predicate this slice extends is missing, and building a second blocker evaluator instead is forbidden.'
      using errcode = 'check_violation';
  end if;
  if position('frontline_design_obligations' in v_def) > 0 then
    -- Already extended by a previous run of this migration.
    null;
  else
    v_new := replace(v_def,
      E'\n  return v_out;\nend',
      E'\n  -- D4.10/D4.11 (20261205090000, marked insertion): the frontline design\n  -- obligations, read from the ONE predicate this slice adds. Appended here\n  -- rather than queried again by the readiness screen, so the screen and the\n  -- persistence wall speak from the same rows.\n  v_out := v_out || case_frontline_design_obligations(c.id);\n\n  return v_out;\nend');
    if v_new = v_def then
      raise exception
        'the `return v_out;` tail of case_gate_outstanding_obligations was not found — do not append blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$wire$;

do $wall$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_gate_review_outstanding_obligations';
  if v_def is null then
    raise exception
      'enforce_gate_review_outstanding_obligations does not exist — the Slice 3C persistence wall this slice extends is missing.'
      using errcode = 'check_violation';
  end if;
  if position('frontline_finding_open' in v_def) > 0 then
    null;
  else
    v_new := replace(v_def,
      $old$where x->>'type' in ('regulatory_condition', 'uncovered_commitment');$old$,
      $new$where x->>'type' in ('regulatory_condition', 'uncovered_commitment',
                     'frontline_finding_open', 'frontline_acceptance_uncarried',
                     'frontline_acceptance_carried_by_failed_requirement',
                     'frontline_review_unattended');$new$);
    if v_new = v_def then
      raise exception
        'the refused-type list of enforce_gate_review_outstanding_obligations was not found — do not widen a wall blind; re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    -- THE REFUSAL MUST DESCRIBE WHAT IT ACTUALLY CHECKED (20261202090300 R10:
    -- "a false sentence is worse than no sentence"). Two defects, both fixed
    -- here rather than left as cosmetics:
    --
    --   (a) the descriptive clause named only I.18/I.19 — a permit condition
    --       and an uncovered commitment — so a gate refused PURELY on an
    --       unanswered maintainer told the reader it had refused over a permit.
    --       That is a refusal naming the wrong specification section on the
    --       differentiator's own path.
    --   (b) the remedy list was concatenated as two dollar-quoted literals
    --       whose seam re-opened the quote, so the rendered sentence carried a
    --       stray apostrophe: "... / 'disposition_design_finding / ...".
    --       ONE literal, no seam.
    v_new := replace(v_new,
      $old$'or a commitment to an external party that no project requirement carries (spec I.18, I.19). '$old$,
      $old2$'a commitment to an external party that no project requirement carries, a frontline design '
    'recommendation nobody has answered, an accepted recommendation no live design requirement carries, '
    'or a design review the frontline never attended (spec I.18, I.19, I.25). '$old2$);
    v_new := replace(v_new,
      $old$'Discharge them (close_regulatory_condition / link_commitment_to_requirement), or record an outcome '$old$,
      $new$'Discharge them (close_regulatory_condition / link_commitment_to_requirement / disposition_design_finding / carry_design_finding_to_requirement / add_design_study_participant), or record an outcome '$new$);
    if position('spec I.18, I.19, I.25' in v_new) = 0
       or position('disposition_design_finding' in v_new) = 0 then
      raise exception
        'the refusal message of enforce_gate_review_outstanding_obligations was not found in the shape this migration expected — a wall whose message no longer describes what it checks is worse than no message, so this fails rather than widening the type list alone.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$wall$;

-- ---------------------------------------------------------------------------
-- 12. /design counts the PROJECT side of the one table.
--
--     get_project_posture's "studies that ran without a maintainer" counted
--     every row, so a case-bound frontline review would change the
--     reliability-by-design reading for reasons that have nothing to do with a
--     capital project. Scoped BEFORE the first drift, exactly as the 5A repair
--     scoped the requirement counts (20261204090300:2500).
-- ---------------------------------------------------------------------------
do $posture$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_project_posture';
  if v_def is null then
    raise exception 'get_project_posture does not exist' using errcode = 'check_violation';
  end if;
  if position('-- case studies are counted on the case' in v_def) > 0 then
    null;
  else
    v_new := replace(v_def,
      E'    from design_studies where organization_id = (select id from org)\n  ),',
      E'    from design_studies where organization_id = (select id from org)\n       -- case studies are counted on the case, not here (D4.10)\n       and development_case_id is null\n  ),');
    if v_new = v_def then
      raise exception
        'the design_studies scope line of get_project_posture was not found — re-derive this insertion against the current body.'
        using errcode = 'check_violation';
    end if;
    execute v_new;
  end if;
end
$posture$;

-- ---------------------------------------------------------------------------
-- 13. THE READ. Refusal-first: an empty finding set REFUSES rather than
--     reporting "0 open findings", which reads as a healthy review.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_frontline_review(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  v_studies jsonb;
  v_study_n int;
  v_finding_n int;
  v_open_n int;
  v_blockers jsonb;
  v_refused boolean := false;
  v_refusal text;
  v_by_discipline jsonb;
  v_by_dimension jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;

  select coalesce(jsonb_agg(x order by x->>'performedOn' desc nulls last, (x->>'id')::bigint desc), '[]'::jsonb),
         count(*)::int
    into v_studies, v_study_n
  from (
    select jsonb_build_object(
      'id', s.id,
      'studyKind', s.study_kind,
      'frontlineKind', s.study_kind = any (sync_frontline_study_kinds()),
      'performedOn', s.performed_on,
      'summary', s.summary,
      'maintainerParticipated', s.maintainer_participated,
      'operatorParticipated', s.operator_participated,
      'constructorParticipated', s.constructor_participated,
      'findingsCount', s.findings_count,
      'findingsClosed', s.findings_closed,
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'participantId', p.participant_id,
                 'name', coalesce(u.full_name, u.email, p.participant_id::text),
                 'discipline', p.discipline, 'basis', p.basis)
                 order by p.discipline, p.id)
          from design_study_participants p
          left join user_profiles u on u.id = p.participant_id and u.organization_id = v_org
         where p.study_id = s.id), '[]'::jsonb),
      'findings', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', f.id, 'findingRef', f.finding_ref, 'dimension', f.dimension,
                 'discipline', f.raised_by_discipline, 'severity', f.severity,
                 'recommendation', f.recommendation,
                 'raisedBy', coalesce(ru.full_name, ru.email, f.raised_by::text),
                 -- 5B-R3. WHO TYPED IT, beside whose opinion it is. The screen
                 -- says "raised by X, recorded by Y" only when they differ, so
                 -- a proxy attribution is visible instead of indistinguishable
                 -- from somebody speaking for themselves.
                 'recordedBy', coalesce(su.full_name, su.email, f.recorded_by::text),
                 'byProxy', f.recorded_by is distinct from f.raised_by,
                 'raisedAt', f.raised_at,
                 'requirementId', f.requirement_id,
                 'requirementRef', dr.requirement_ref,
                 -- 5B-R7. The carrier's verification state travels with the
                 -- link. "Carried by REQ-04" is only good news while REQ-04
                 -- still stands, and the reader cannot see that without this.
                 'requirementVerification', dr.verification_status,
                 'dispositions', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', d.id, 'no', d.disposition_no, 'outcome', d.outcome,
                            'reason', d.reason, 'conditions', d.conditions,
                            'discipline', d.disposition_discipline,
                            'by', coalesce(du.full_name, du.email, d.dispositioned_by::text),
                            'at', d.dispositioned_at)
                            order by d.disposition_no desc)
                     from design_finding_dispositions d
                     left join user_profiles du
                            on du.id = d.dispositioned_by
                           and du.organization_id = v_org
                    where d.finding_id = f.id), '[]'::jsonb))
                 order by array_position(array['blocking','significant','minor'], f.severity),
                          f.finding_ref)
          from design_review_findings f
          -- The name joins are TENANT-SCOPED. An unscoped join here renders a
          -- foreign tenant's email onto this tenant's screen the moment a row
          -- names somebody outside it; the walls now refuse those rows, and
          -- this is the second lock on the same door.
          left join user_profiles ru on ru.id = f.raised_by and ru.organization_id = v_org
          left join user_profiles su on su.id = f.recorded_by and su.organization_id = v_org
          left join design_requirements dr on dr.id = f.requirement_id
         where f.study_id = s.id), '[]'::jsonb)) x
    from design_studies s
   where s.organization_id = v_org and s.development_case_id = c.id) t;

  select count(*)::int,
         count(*) filter (where not exists (
           select 1 from design_finding_dispositions d where d.finding_id = f.id))::int
    into v_finding_n, v_open_n
    from design_review_findings f
    join design_studies s on s.id = f.study_id
   where f.organization_id = v_org and s.development_case_id = c.id;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_by_discipline
    from (select f.raised_by_discipline k, count(*)::int n
            from design_review_findings f
            join design_studies s on s.id = f.study_id
           where f.organization_id = v_org and s.development_case_id = c.id
           group by 1) g;
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into v_by_dimension
    from (select f.dimension k, count(*)::int n
            from design_review_findings f
            join design_studies s on s.id = f.study_id
           where f.organization_id = v_org and s.development_case_id = c.id
           group by 1) g;

  v_blockers := case_frontline_design_obligations(c.id);

  -- THE TWO REFUSALS. A count of zero here is not a good number, it is an
  -- absent one, and rendering "0 open findings" green is how a review nobody
  -- held becomes evidence that the design was reviewed.
  if v_study_n = 0 then
    v_refused := true;
    v_refusal :=
      'No design review is recorded against this case, so there is nothing to report. This is not "no open findings": it is no review. Spec I.25 requires the people who will maintain, operate and build this asset to look at the design before it is built, and the record of whether they did is this.';
  elsif v_finding_n = 0 then
    v_refused := true;
    v_refusal := format(
      '%s design review(s) are recorded against this case and not one finding was raised at any of them. A review that found nothing is reported as a review that found nothing, never as zero open findings — the two look identical on a screen and mean opposite things.',
      v_study_n);
  end if;

  return jsonb_build_object(
    'caseId', c.id,
    'refused', v_refused,
    'refusal', v_refusal,
    'studyCount', v_study_n,
    'studies', v_studies,
    'findingCount', case when v_refused then null else v_finding_n end,
    'openFindingCount', case when v_refused then null else v_open_n end,
    'dispositionedCount', case when v_refused then null else v_finding_n - v_open_n end,
    'byDiscipline', v_by_discipline,
    'byDimension', v_by_dimension,
    'dimensions', to_jsonb(sync_frontline_review_dimensions()),
    'disciplines', to_jsonb(sync_frontline_disciplines()),
    'dispositionDisciplines', to_jsonb(sync_disposition_disciplines()),
    'outcomes', to_jsonb(sync_design_finding_outcomes()),
    'frontlineStudyKinds', to_jsonb(sync_frontline_study_kinds()),
    'blockers', v_blockers,
    'blockerCount', jsonb_array_length(v_blockers));
end
$$;

revoke all on function public.get_case_frontline_review(uuid) from public, anon;
grant execute on function public.get_case_frontline_review(uuid) to authenticated, service_role;

comment on function public.get_case_frontline_review(uuid) is
  'D4.10/D4.11 / spec I.25: the frontline design review on one case — who was in the room, what they recommended against which of the eight dimensions, and how each recommendation was answered. REFUSES over an empty study set and over an empty finding set rather than reporting a comfortable zero, and reads its blockers from the ONE predicate the gate refuses over.';

notify pgrst, 'reload schema';
