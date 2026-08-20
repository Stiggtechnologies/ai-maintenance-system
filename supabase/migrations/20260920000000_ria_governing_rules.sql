-- ============================================================================
-- Reliability Intelligence Assessment — the governing rules, enforced.
--
-- 20260918100000 landed the nine assessment objects and the two publishing
-- RPCs. What it did NOT land is the part the $35K engagement actually sells:
-- the rules of §5 of the workspace specification, enforced where they cannot
-- be talked around. Today every one of them is a convention:
--
--   * publish_ria_finding() sets review_state='published' and never once looks
--     at whether the finding has any evidence. A finding drafted with an empty
--     evidence_refs array publishes exactly as readily as one built from four
--     source files. The customer cannot tell the two apart in the report.
--   * evidence_refs is uuid[] with no referential integrity of any kind. It
--     will hold a uuid belonging to another tenant's data source, a deleted
--     source, or a uuid that never existed, and nothing complains. The Evidence
--     Explorer renders "Source 3f2a1b9c" for all three cases.
--   * ria_decisions.authority_role and .boundary are `not null`, which admits
--     the empty string — a decision with no named authority and no stated
--     boundary satisfies the column contract completely.
--   * ria_actions carries no authority, no boundary and no approval gate at
--     all, so a 90-day plan item arising from a CRITICAL finding is writable
--     and completable with nobody named.
--   * a raw source file may be deleted from storage by any authenticated
--     member of the org and leaves nothing behind. The row in ria_data_sources
--     survives only because RLS grants no DELETE — which is a policy omission,
--     not a decision, and the next migration that adds `for all` removes it.
--
-- This migration makes each of those a property of the schema.
--
-- WHY EXTEND ria_* RATHER THAN BUILD assessment_*. The implementation contract
-- for this slice was written against 34d96ae, before #231 merged, and specifies
-- a net-new `assessments` / `assessment_findings` / `assessment_decisions`
-- family. Those objects now exist under the ria_ prefix on main with a live UI
-- on /pilot/reliability. Building the specified family would create a second
-- assessment persistence model — precisely what invariant 8 forbids — so the
-- rules are enforced on the carrier that exists.
--
-- THE PLATFORM NEVER CLEARS ITS OWN GATE. reviewer_id is an auth identity, the
-- evidence requirement counts rows a human attached, and the publication check
-- is a trigger rather than logic inside publish_ria_finding() so that a future
-- RPC, a connector, or a direct service-role write cannot reach 'published'
-- without satisfying it. The gatekeeper idiom is 20260808120000's.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. EVIDENCE AS A LINK, NOT AN ARRAY OF HOPEFUL UUIDS.
-- ---------------------------------------------------------------------------
-- One row per (finding, source, cited record). The foreign keys are the point:
-- a finding cannot cite a source that does not exist, and the organization_id
-- on the link is checked against BOTH parents so a link can never straddle two
-- tenants even if a definer function is careless with its inputs.
create table if not exists public.ria_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null references public.ria_findings(id) on delete cascade,
  data_source_id uuid not null references public.ria_data_sources(id) on delete restrict,
  -- Which rows in that export carry the claim. Free text because the shape
  -- differs per dataset ("WO 4411-4478", "rows 12,19,55"); the specification
  -- asks for traceability to the record, not for a parsed row cursor.
  record_reference text,
  note text,
  linked_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (finding_id, data_source_id, record_reference)
);

create index if not exists ria_finding_evidence_finding_idx
  on public.ria_finding_evidence (finding_id);
create index if not exists ria_finding_evidence_source_idx
  on public.ria_finding_evidence (data_source_id);

-- The straddle guard. A CHECK cannot reach another table, so this is a trigger,
-- and it fires on INSERT as well as UPDATE because the first write is the one
-- that would create the cross-tenant link.
create or replace function public.enforce_ria_evidence_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finding_org uuid;
  v_source_org uuid;
begin
  select organization_id into v_finding_org from ria_findings where id = new.finding_id;
  select organization_id into v_source_org from ria_data_sources where id = new.data_source_id;

  if v_finding_org is null or v_source_org is null then
    raise exception 'Evidence link references an assessment object that does not exist'
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from v_finding_org
     or new.organization_id is distinct from v_source_org then
    raise exception
      'Evidence link crosses a tenant boundary: link org %, finding org %, source org %',
      new.organization_id, v_finding_org, v_source_org
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists trg_ria_evidence_tenancy on public.ria_finding_evidence;
create trigger trg_ria_evidence_tenancy
  before insert or update on public.ria_finding_evidence
  for each row execute function public.enforce_ria_evidence_tenancy();

-- Carry across whatever the uuid[] column legitimately held. A ref that does
-- not resolve to a data source in the same organization is not migrated,
-- because it was never evidence — it was a uuid.
insert into public.ria_finding_evidence (organization_id, finding_id, data_source_id, note)
select f.organization_id, f.id, s.id, 'Migrated from ria_findings.evidence_refs'
from public.ria_findings f
cross join lateral unnest(f.evidence_refs) as ref(id)
join public.ria_data_sources s
  on s.id = ref.id and s.organization_id = f.organization_id
on conflict do nothing;

-- One column, one meaning. The array is retired rather than kept in step with
-- the table, because two stores of the same fact drift and the older one wins
-- an argument it should not be in (invariant 8).
alter table public.ria_findings drop column if exists evidence_refs;

-- ---------------------------------------------------------------------------
-- 2. REMEDIATION BEFORE ENFORCEMENT.
-- ---------------------------------------------------------------------------
-- A trigger that fires on TRANSITION leaves rows that are already 'published'
-- exactly as they are. Any finding published before this migration that cannot
-- satisfy the gate was published without the property the gate exists to
-- guarantee, so it is walked back to 'reviewed' with the reason recorded — the
-- posture of 20260911090000, which deleted fabricated aggregates rather than
-- leaving them to be read as measurements.
with demoted as (
  update public.ria_findings f
     set review_state = 'reviewed'
   where f.review_state = 'published'
     and (
       f.reviewer_id is null
       or not exists (select 1 from public.ria_finding_evidence e where e.finding_id = f.id)
     )
  returning f.id, f.organization_id, f.title, f.reviewer_id
)
insert into public.audit_events (organization_id, entity_type, event_data, actor)
select d.organization_id, 'ria_finding',
  jsonb_build_object(
    'event', 'publication_withdrawn',
    'finding_id', d.id,
    'title', d.title,
    'reason', case when d.reviewer_id is null
                then 'published without a reviewer identity'
                else 'published without any resolvable evidence link' end,
    'migration', '20260920000000_ria_governing_rules'),
  'migration'
from demoted d;

-- ---------------------------------------------------------------------------
-- 3. FINDINGS AND DECISIONS ARE LINKED, SO SEVERITY CAN REACH AUTHORITY.
-- ---------------------------------------------------------------------------
-- The specification's rule is "a high or critical finding requires authority
-- and boundary on its decision or action". Without a link from the decision to
-- the finding there is no way to evaluate it, so the link is added here rather
-- than the rule being downgraded to a convention.
alter table public.ria_decisions
  add column if not exists finding_id uuid references public.ria_findings(id) on delete set null;
alter table public.ria_actions
  add column if not exists finding_id uuid references public.ria_findings(id) on delete set null;
alter table public.ria_actions
  add column if not exists authority_role text;
alter table public.ria_actions
  add column if not exists boundary text;
alter table public.ria_actions
  add column if not exists approval_state text not null default 'not_required';
alter table public.ria_actions
  add column if not exists approved_by uuid references public.user_profiles(id) on delete set null;
alter table public.ria_actions
  add column if not exists approved_at timestamptz;

create index if not exists ria_decisions_finding_idx on public.ria_decisions (finding_id);
create index if not exists ria_actions_finding_idx on public.ria_actions (finding_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_actions_approval_state_check') then
    alter table public.ria_actions
      add constraint ria_actions_approval_state_check
      check (approval_state in ('not_required','pending','approved'));
  end if;
end $$;

-- `not null` on a text column is not a requirement that it says anything.
-- Blank authority and blank boundary are the shapes this constraint exists to
-- refuse; they were both legal until now.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_decisions_authority_stated') then
    update public.ria_decisions
       set authority_role = 'UNSTATED - recorded before the authority constraint'
     where btrim(coalesce(authority_role, '')) = '';
    update public.ria_decisions
       set boundary = 'UNSTATED - recorded before the boundary constraint'
     where btrim(coalesce(boundary, '')) = '';
    alter table public.ria_decisions
      add constraint ria_decisions_authority_stated
      check (btrim(authority_role) <> '' and btrim(boundary) <> '');
  end if;
end $$;

-- An action that carries an approval must carry the identity that gave it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_actions_approved_needs_approver') then
    alter table public.ria_actions
      add constraint ria_actions_approved_needs_approver
      check (approval_state <> 'approved' or (approved_by is not null and approved_at is not null));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE PUBLICATION GATE.
-- ---------------------------------------------------------------------------
-- A finding becomes customer-visible only when all three hold:
--   (a) a named human reviewer,
--   (b) at least one evidence link to a source in this assessment,
--   (c) if the finding is high or critical, a decision or action that names the
--       authority and states the boundary.
-- Fires only on the transition INTO 'published', so re-saving an already
-- published row does not re-litigate it, and drafting is unconstrained.
create or replace function public.enforce_ria_publication_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evidence int;
  v_governed int;
begin
  if new.review_state is distinct from 'published'
     or old.review_state is not distinct from new.review_state then
    return new;
  end if;

  if new.reviewer_id is null then
    raise exception
      'Publication gate: finding % cannot be customer-published without a named reviewer',
      new.id using errcode = 'check_violation';
  end if;

  select count(*) into v_evidence
    from ria_finding_evidence e where e.finding_id = new.id;

  if v_evidence = 0 then
    raise exception
      'Publication gate: finding % cannot be customer-published with no evidence link',
      new.id using errcode = 'check_violation';
  end if;

  if new.severity in ('critical','high') then
    select count(*) into v_governed
      from (
        select 1 from ria_decisions d
         where d.finding_id = new.id
           and btrim(coalesce(d.authority_role, '')) <> ''
           and btrim(coalesce(d.boundary, '')) <> ''
        union all
        select 1 from ria_actions a
         where a.finding_id = new.id
           and btrim(coalesce(a.authority_role, '')) <> ''
           and btrim(coalesce(a.boundary, '')) <> ''
      ) governed;

    if v_governed = 0 then
      raise exception
        'Publication gate: % finding % requires a decision or action naming the authority and the boundary',
        new.severity, new.id using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists trg_ria_publication_gate on public.ria_findings;
create trigger trg_ria_publication_gate
  before update of review_state on public.ria_findings
  for each row execute function public.enforce_ria_publication_gate();

-- An action arising from a high or critical finding cannot be worked or closed
-- while its approval is outstanding. Same transition-only shape.
create or replace function public.enforce_ria_action_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_severity text;
begin
  if new.status not in ('in_progress','complete')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select severity into v_severity from ria_findings where id = new.finding_id;

  if v_severity in ('critical','high') then
    if btrim(coalesce(new.authority_role, '')) = ''
       or btrim(coalesce(new.boundary, '')) = '' then
      raise exception
        'Authority gate: action % arises from a % finding and must name an authority and a boundary',
        new.id, v_severity using errcode = 'check_violation';
    end if;
    if new.approval_state <> 'approved' then
      raise exception
        'Authority gate: action % arises from a % finding and is not approved',
        new.id, v_severity using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists trg_ria_action_authority on public.ria_actions;
create trigger trg_ria_action_authority
  before update of status on public.ria_actions
  for each row execute function public.enforce_ria_action_authority();

-- ---------------------------------------------------------------------------
-- 5. AN UNSUPPORTED METRIC IS A STATUS DOWNSTREAM QUERIES CAN EXCLUDE.
-- ---------------------------------------------------------------------------
-- evidence_grade already carries the Evidence Integrity Matrix label. What was
-- missing is (a) anything that stops a metric CLAIMING support without a
-- reviewer or a method, and (b) a named surface a report can read that is
-- guaranteed to exclude the unsupported ones.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_metric_support_is_earned') then
    update public.ria_baseline_metrics
       set evidence_grade = 'unsupported'
     where evidence_grade in ('supported','partially_supported')
       and (reviewer_id is null or btrim(coalesce(method, '')) = '');
    alter table public.ria_baseline_metrics
      add constraint ria_metric_support_is_earned
      check (
        evidence_grade = 'unsupported'
        or (reviewer_id is not null and btrim(coalesce(method, '')) <> '')
      );
  end if;
end $$;

create index if not exists ria_baseline_metrics_decision_ready_idx
  on public.ria_baseline_metrics (assessment_id)
  where evidence_grade <> 'unsupported';

-- security_invoker so the view is subject to the caller's RLS. A view created
-- without it runs as its owner and is a documented way to hand every tenant
-- every row; the exclusion this view exists for would then be its only guard.
drop view if exists public.ria_decision_ready_metrics;
create view public.ria_decision_ready_metrics
with (security_invoker = true) as
select id, assessment_id, organization_id, metric_key, label, value_text, unit,
       method, evidence_grade, reviewer_id, reviewed_at, created_at
from public.ria_baseline_metrics
where evidence_grade <> 'unsupported';

revoke all on public.ria_decision_ready_metrics from public, anon;
grant select on public.ria_decision_ready_metrics to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A RETIRED SOURCE LEAVES A STUB. ALWAYS.
-- ---------------------------------------------------------------------------
alter table public.ria_data_sources
  add column if not exists deleted_at timestamptz;
alter table public.ria_data_sources
  add column if not exists deleted_by uuid references public.user_profiles(id) on delete set null;
alter table public.ria_data_sources
  add column if not exists delete_note text;
alter table public.ria_data_sources
  add column if not exists retention_basis text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_data_sources_retirement_is_explained') then
    alter table public.ria_data_sources
      add constraint ria_data_sources_retirement_is_explained
      check (deleted_at is null or btrim(coalesce(delete_note, '')) <> '');
  end if;
end $$;

-- Belt and braces. RLS granting no DELETE is an omission a later migration can
-- undo without noticing; this refuses the row deletion outright, including from
-- a service-role script, so removing the audit stub is a deliberate act that
-- has to drop a trigger by name and appear in a diff.
create or replace function public.refuse_ria_source_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Assessment source % cannot be deleted: retire it with retire_ria_data_source() so the audit stub survives',
    old.id using errcode = 'check_violation';
end
$$;

drop trigger if exists trg_ria_source_no_hard_delete on public.ria_data_sources;
create trigger trg_ria_source_no_hard_delete
  before delete on public.ria_data_sources
  for each row execute function public.refuse_ria_source_hard_delete();

create or replace function public.retire_ria_data_source(
  p_source_id uuid,
  p_note text,
  p_retention_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_source ria_data_sources%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    return jsonb_build_object('error', 'a retirement note is required - the stub records why');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'retiring an assessment source requires a planning, engineering or administrator role');
  end if;

  select * into v_source from ria_data_sources
   where id = p_source_id and organization_id = v_org;

  if not found then
    return jsonb_build_object('error', 'source not found in current organization');
  end if;

  if v_source.deleted_at is not null then
    return jsonb_build_object('error', 'source is already retired', 'source_id', p_source_id);
  end if;

  if exists (select 1 from ria_finding_evidence where data_source_id = p_source_id) then
    return jsonb_build_object('error',
      'source is cited as evidence by a finding - withdraw the citation before retiring it');
  end if;

  update ria_data_sources
     set deleted_at = now(),
         deleted_by = auth.uid(),
         delete_note = p_note,
         retention_basis = coalesce(p_retention_basis, retention_basis),
         status = 'rejected'
   where id = p_source_id;

  insert into audit_events (organization_id, entity_type, event_data, actor)
  values (v_org, 'ria_data_source',
    jsonb_build_object(
      'event', 'source_retired',
      'source_id', p_source_id,
      'assessment_id', v_source.assessment_id,
      'file_name', v_source.file_name,
      'object_path', v_source.object_path,
      'received_at', v_source.created_at,
      'note', p_note,
      'retention_basis', p_retention_basis),
    coalesce(auth.uid()::text, 'unknown'));

  return jsonb_build_object('source_id', p_source_id, 'retired_at', now());
end
$$;

revoke all on function public.retire_ria_data_source(uuid, text, text) from public, anon;
grant execute on function public.retire_ria_data_source(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. THE PUBLISHING RPC NO LONGER DECIDES — IT PROPOSES AND THE GATE RULES.
-- ---------------------------------------------------------------------------
-- Kept because the UI calls it, rewritten so its failure message names the
-- reason. The trigger is still the enforcement: this function cannot publish
-- past it, and neither can anything else.
create or replace function public.publish_ria_finding(p_finding_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or v_role not in ('admin','ai_admin','reliability_engineer') then
    raise exception 'Reliability Engineer or administrator authority required';
  end if;

  update public.ria_findings
     set review_state = 'published', reviewer_id = auth.uid(), reviewed_at = now()
   where id = p_finding_id and organization_id = v_org;

  if not found then raise exception 'Finding not found in current organization'; end if;
end;
$$;

create or replace function public.link_ria_finding_evidence(
  p_finding_id uuid,
  p_data_source_id uuid,
  p_record_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_link uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'attaching evidence requires an engineering or administrator role');
  end if;

  if not exists (select 1 from ria_findings where id = p_finding_id and organization_id = v_org) then
    return jsonb_build_object('error', 'finding not found in current organization');
  end if;

  if not exists (select 1 from ria_data_sources
                  where id = p_data_source_id and organization_id = v_org and deleted_at is null) then
    return jsonb_build_object('error', 'source not found in current organization, or retired');
  end if;

  insert into ria_finding_evidence
    (organization_id, finding_id, data_source_id, record_reference, note, linked_by)
  values (v_org, p_finding_id, p_data_source_id,
          nullif(btrim(coalesce(p_record_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (finding_id, data_source_id, record_reference) do nothing
  returning id into v_link;

  return jsonb_build_object('link_id', v_link, 'finding_id', p_finding_id);
end
$$;

revoke all on function public.link_ria_finding_evidence(uuid, uuid, text, text) from public, anon;
grant execute on function public.link_ria_finding_evidence(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS FOR THE NEW LINK TABLE, AND A TIGHTER DOOR ON THE OLD ONES.
-- ---------------------------------------------------------------------------
alter table public.ria_finding_evidence enable row level security;

drop policy if exists ria_finding_evidence_org_read on public.ria_finding_evidence;
create policy ria_finding_evidence_org_read on public.ria_finding_evidence for select to authenticated
using (organization_id = public.app_current_org());

-- No INSERT/UPDATE/DELETE policy: evidence is attached through
-- link_ria_finding_evidence(), which checks the role and both parents. A
-- client that could write this table directly could attach a source from a
-- draft it is not entitled to read.

-- Supplying an export is a data-owner act, not something every account in the
-- tenant may do. Same role set as begin_manual_import (20260907090000), plus
-- the assessment sponsor, whose whole job in the engagement is to supply data.
create or replace function public.app_can_supply_ria_sources()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.user_profiles where id = auth.uid()), ''
  ) in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin','assessment_sponsor');
$$;

revoke all on function public.app_can_supply_ria_sources() from public, anon;
grant execute on function public.app_can_supply_ria_sources() to authenticated;

drop policy if exists ria_data_sources_org_insert on public.ria_data_sources;
create policy ria_data_sources_org_insert on public.ria_data_sources for insert to authenticated
with check (
  organization_id = public.app_current_org()
  and public.app_can_supply_ria_sources()
  and exists (
    select 1 from public.ria_assessments a
    where a.id = assessment_id and a.organization_id = public.app_current_org()
  )
);

-- Raw files: uploading stays role-gated the same way, and the blanket delete is
-- replaced. Once a source row cites an object, that object is no longer
-- deletable through the client at all — which is what makes the stub a stub of
-- something rather than a note about a file nobody can account for. Orphans
-- (uploaded, then the metadata insert failed) remain removable by their own
-- uploader, so a failed upload does not leave litter in the bucket.
drop policy if exists ria_source_files_insert on storage.objects;
create policy ria_source_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'ria-source-files'
  and (storage.foldername(name))[1] = public.app_current_org()::text
  and public.app_can_supply_ria_sources()
);

drop policy if exists ria_source_files_delete on storage.objects;
create policy ria_source_files_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'ria-source-files'
  and (storage.foldername(name))[1] = public.app_current_org()::text
  and owner = auth.uid()
  and not exists (
    select 1 from public.ria_data_sources d where d.object_path = storage.objects.name
  )
);

notify pgrst, 'reload schema';
