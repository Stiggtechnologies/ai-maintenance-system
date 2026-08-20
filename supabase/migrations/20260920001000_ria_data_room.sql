-- ============================================================================
-- The Data Room — §4 of the workspace specification, and §§2-4 and 8 of the
-- customer Data Intake & Readiness Pack, made into state the product holds.
--
-- WHAT EXISTS. 20260918100000 gave ria_data_sources a `category` free-text
-- column and a `quality_grade`, and the workspace page offers a six-item
-- dropdown. That is an upload log. It is not a data room, because it cannot
-- answer the four questions the engagement is actually blocked on:
--
--   * which of the pack's required datasets have NOT arrived (a missing slot
--     has no row, and a thing with no row cannot be shown as outstanding);
--   * what is inside the file that did arrive — identifiers, date coverage,
--     completeness, the rows that failed validation;
--   * whether the dataset is Green, Amber or Red against the pack's §4
--     scoring, which is the sentence the customer is given at kickoff;
--   * what we asked the customer and whether they answered.
--
-- The upload path computed `record_count` by splitting the file on newlines,
-- which over-counts every export containing a quoted field with a line break
-- in it — long_text on a work order, routinely. The repository already owns a
-- correct CSV reader (src/lib/fleet-import parseCSV/profileColumns); the
-- profile is computed there and recorded here, rather than a second parser
-- being written against the same files.
--
-- READINESS IS THE PACK'S, VERBATIM (§4):
--   green — key identifiers, dates and operating measure are coherent.
--   amber — material gaps or inconsistent coding, useful analysis remains
--           possible; proceed with explicit evidence limitations.
--   red   — asset linkage, chronology or operating denominator too weak for
--           the requested conclusion.
-- and kickoff is data-ready (§8) when scope is confirmed, the asset register
-- and work-order history are received, the primary management question is
-- agreed, and known missing datasets are explicitly logged. get_ria_readiness()
-- returns exactly that predicate rather than a percentage, because a
-- percentage cannot say which of the four is outstanding.
--
-- NOTHING HERE GRADES ITSELF. A profile is a measurement and is computed. A
-- readiness rating is a judgement about whether analysis can proceed, so it is
-- set by a named engineer through an RPC, and the row records who and when.
-- ============================================================================

-- The management question the assessment exists to answer. §8 makes agreeing it
-- a precondition of kickoff, so it is a column, not a note.
alter table public.ria_assessments
  add column if not exists primary_management_question text;
alter table public.ria_assessments
  add column if not exists scope_confirmed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. THE SLOTS. One row per dataset the pack names, per assessment, from the
--    moment the assessment exists — so "not supplied" is a state the workspace
--    holds rather than the absence of one.
-- ---------------------------------------------------------------------------
create table if not exists public.ria_dataset_slots (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Keys match the categories the shipped workspace page already writes, so no
  -- existing ria_data_sources row is orphaned by a rename.
  dataset_key text not null check (dataset_key in (
    'asset_register','work_orders','pm_plans',
    'downtime_meter','dealer_oem','operating_measure','alias_map')),
  requirement text not null check (requirement in ('required','preferred','optional')),
  label text not null,
  minimum_fields text[] not null default '{}',
  preferred_history text,
  readiness text not null default 'missing'
    check (readiness in ('missing','received','profiled','green','amber','red')),
  -- Why it is amber, or which gap makes it red. §4's "assessment response"
  -- column is a sentence the customer is owed, not a colour.
  readiness_note text,
  rated_by uuid references public.user_profiles(id) on delete set null,
  rated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (assessment_id, dataset_key)
);

create index if not exists ria_dataset_slots_assessment_idx
  on public.ria_dataset_slots (assessment_id, dataset_key);

-- A colour is a judgement; it may not exist without the person who made it and
-- the reason. 'missing'/'received'/'profiled' are observations and need neither.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_slot_rating_is_attributed') then
    alter table public.ria_dataset_slots
      add constraint ria_slot_rating_is_attributed
      check (
        readiness not in ('green','amber','red')
        or (rated_by is not null and rated_at is not null
            and btrim(coalesce(readiness_note, '')) <> '')
      );
  end if;
end $$;

-- The pack's §2 minimum-viable-data table, as data. Requirement and minimum
-- fields are quoted from it; nothing here is invented.
--
-- NOT CALLABLE BY A CLIENT. It is SECURITY DEFINER, it takes an assessment id
-- from its caller and it writes rows for whatever tenant owns that assessment.
-- Every other RPC in these two migrations carries an explicit revoke; this one
-- did not, so the default PUBLIC grant stood and `anon` — denied even SELECT on
-- ria_assessments — could write seven slot rows into any tenant whose
-- assessment uuid it held. The blast radius was small (fixed content, `on
-- conflict do nothing`), but "you also need a uuid" is not an access control.
-- It is invoked by the trigger below and by the backfill, both of which run as
-- the function owner.
create or replace function public.seed_ria_dataset_slots(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from ria_assessments where id = p_assessment_id;
  if v_org is null then return; end if;

  insert into ria_dataset_slots
    (assessment_id, organization_id, dataset_key, requirement, label,
     minimum_fields, preferred_history)
  values
    (p_assessment_id, v_org, 'asset_register', 'required', 'Asset register',
     array['asset_id','asset_description','asset_class','site_or_fleet','status'],
     'Current snapshot + hierarchy'),
    (p_assessment_id, v_org, 'work_orders', 'required', 'Work orders / notifications',
     array['work_order_id','asset_id','created_date','complete_date','work_type','status','short_text'],
     '24-36 months'),
    (p_assessment_id, v_org, 'pm_plans', 'required', 'PM plans / tasks',
     array['pm_id','asset_id_or_class','task_name','trigger_type','frequency','frequency_unit','active_status'],
     'Current + major revisions if available'),
    (p_assessment_id, v_org, 'downtime_meter', 'preferred', 'Downtime / meter / operating history',
     array['asset_id','period_start','period_end','downtime_hours','meter_reading','reason'],
     '24-36 months'),
    (p_assessment_id, v_org, 'dealer_oem', 'preferred', 'Dealer / OEM / external repairs',
     array['external_event_id','asset_id_or_alias','vendor','event_date'],
     '24-36 months'),
    (p_assessment_id, v_org, 'operating_measure', 'preferred', 'Business outcome measure',
     array['asset_id','period_start','period_end','utilization_pct','production','oee'],
     '12-36 months'),
    (p_assessment_id, v_org, 'alias_map', 'optional', 'Dealer / legacy alias mapping',
     array['source_system','source_alias','canonical_asset_id'],
     'Current')
  on conflict (assessment_id, dataset_key) do nothing;
end
$$;

create or replace function public.seed_ria_dataset_slots_on_assessment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_ria_dataset_slots(new.id);
  return new;
end
$$;

drop trigger if exists trg_ria_seed_dataset_slots on public.ria_assessments;
create trigger trg_ria_seed_dataset_slots
  after insert on public.ria_assessments
  for each row execute function public.seed_ria_dataset_slots_on_assessment();

revoke all on function public.seed_ria_dataset_slots(uuid) from public, anon, authenticated;
revoke all on function public.seed_ria_dataset_slots_on_assessment() from public, anon, authenticated;

-- Assessments that already exist get their slots too.
do $$
declare r record;
begin
  for r in select id from public.ria_assessments loop
    perform public.seed_ria_dataset_slots(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE PROFILE OF WHAT ARRIVED.
-- ---------------------------------------------------------------------------
alter table public.ria_data_sources
  add column if not exists slot_id uuid references public.ria_dataset_slots(id) on delete set null;
alter table public.ria_data_sources
  add column if not exists row_count integer;
alter table public.ria_data_sources
  add column if not exists column_count integer;
-- Column-level profile from profileColumns(): header, non-empty share,
-- distinct count, numeric/date share. Held as jsonb because the shape is the
-- client library's and duplicating it as columns would fork the contract.
alter table public.ria_data_sources
  add column if not exists profile jsonb not null default '{}'::jsonb;
alter table public.ria_data_sources
  add column if not exists identifier_coverage numeric;
alter table public.ria_data_sources
  add column if not exists coverage_from date;
alter table public.ria_data_sources
  add column if not exists coverage_to date;
-- Rows the profiler refused and why — the same surface get_import_rejects()
-- gives a manual import (20260907090000): a rejection nobody sees is a dropped
-- row.
alter table public.ria_data_sources
  add column if not exists dq_exceptions jsonb not null default '[]'::jsonb;
alter table public.ria_data_sources
  add column if not exists missing_required_fields text[] not null default '{}';
alter table public.ria_data_sources
  add column if not exists content_sha256 text;
alter table public.ria_data_sources
  add column if not exists profiled_at timestamptz;
-- Whether the raw export is still held. The pack's §5 checklist makes retention
-- a contracted period, so the workspace has to be able to say "the file is gone
-- and here is its fingerprint" without that reading as data loss.
alter table public.ria_data_sources
  add column if not exists raw_retained boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_source_coverage_is_ordered') then
    alter table public.ria_data_sources
      add constraint ria_source_coverage_is_ordered
      check (coverage_from is null or coverage_to is null or coverage_from <= coverage_to);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ria_source_identifier_coverage_is_a_share') then
    alter table public.ria_data_sources
      add constraint ria_source_identifier_coverage_is_a_share
      check (identifier_coverage is null or (identifier_coverage >= 0 and identifier_coverage <= 1));
  end if;
end $$;

-- Existing rows are attached to the slot their category already names.
update public.ria_data_sources d
   set slot_id = s.id
  from public.ria_dataset_slots s
 where s.assessment_id = d.assessment_id
   and s.dataset_key = d.category
   and d.slot_id is null;

-- ---------------------------------------------------------------------------
-- 3. THE CLARIFICATION QUEUE.
-- ---------------------------------------------------------------------------
-- The pack's §6 kickoff questions and every "which codes are unreliable?"
-- follow-up currently live in email. An unanswered clarification is a stated
-- evidence limitation; it belongs where the finding that depends on it can see
-- it. `blocks_analysis` is the honesty flag borrowed from the provenance
-- ladder's blocked_on (20260814090000).
create table if not exists public.ria_clarifications (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.ria_data_sources(id) on delete set null,
  dataset_key text,
  question text not null,
  context text,
  blocks_analysis boolean not null default false,
  status text not null default 'open' check (status in ('open','answered','withdrawn')),
  asked_by uuid references public.user_profiles(id) on delete set null,
  asked_at timestamptz not null default now(),
  answer text,
  answered_by uuid references public.user_profiles(id) on delete set null,
  answered_at timestamptz
);

create index if not exists ria_clarifications_assessment_idx
  on public.ria_clarifications (assessment_id, status);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_clarification_answered_needs_answer') then
    alter table public.ria_clarifications
      add constraint ria_clarification_answered_needs_answer
      check (
        status <> 'answered'
        or (btrim(coalesce(answer, '')) <> '' and answered_by is not null and answered_at is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ria_clarification_question_is_asked') then
    alter table public.ria_clarifications
      add constraint ria_clarification_question_is_asked
      check (btrim(question) <> '');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE ALIAS MAP.
-- ---------------------------------------------------------------------------
-- The workbook's Alias_Map sheet. asset_class_aliases (20260823096000) maps a
-- CLASS to the catalogue and is a different concept; this maps one customer's
-- dealer or legacy identifier for a specific machine to the asset record, which
-- is what makes an external repair joinable to work-order history at all.
-- canonical_asset_id is nullable on purpose: an alias whose asset we have not
-- identified yet is exactly the row worth holding, and `resolved` says so.
create table if not exists public.ria_asset_aliases (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_system text not null,
  source_alias text not null,
  canonical_asset_id uuid references public.assets(id) on delete set null,
  canonical_asset_ref text,
  resolved boolean not null default false,
  notes text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (assessment_id, source_system, source_alias)
);

create index if not exists ria_asset_aliases_assessment_idx
  on public.ria_asset_aliases (assessment_id, resolved);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ria_alias_resolved_needs_a_target') then
    alter table public.ria_asset_aliases
      add constraint ria_alias_resolved_needs_a_target
      check (
        resolved = false
        or canonical_asset_id is not null
        or btrim(coalesce(canonical_asset_ref, '')) <> ''
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. OBSERVATIONS ADVANCE A SLOT; JUDGEMENTS DO NOT.
-- ---------------------------------------------------------------------------
-- A file arriving moves the slot missing -> received, and a profile arriving
-- moves it received -> profiled. Neither ever sets green/amber/red, and neither
-- ever moves a slot backwards from a colour an engineer set — re-uploading a
-- file does not silently un-rate the dataset.
--
-- THE SLOT IS DERIVED, NEVER ACCEPTED. This function is SECURITY DEFINER, so
-- its UPDATE runs with RLS off. The first version took new.slot_id verbatim
-- whenever the client supplied one and only resolved the NULL case safely —
-- and ria_data_sources_org_insert validates organization_id and assessment_id
-- but never looks at slot_id. Table-level grants to `authenticated` accept any
-- column over PostgREST, so an authenticated member of org B could insert a
-- source that was entirely legal for org B carrying org A's slot uuid, and
-- march org A's asset_register from 'missing' to 'received'. That is the
-- surface get_ria_readiness() reports at kickoff: the customer would have been
-- shown "asset register received" with zero sources behind it. The intra-org
-- form needed no leaked uuid at all — any assessment's slot would do.
--
-- So the slot is resolved from (assessment_id, category), which RLS has
-- already vouched for, and a supplied slot_id that disagrees is refused rather
-- than ignored: silently correcting a hostile input teaches nothing and hides
-- the attempt.
create or replace function public.advance_ria_slot_on_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
begin
  select id into v_slot from ria_dataset_slots
   where assessment_id = new.assessment_id
     and organization_id = new.organization_id
     and dataset_key = new.category;

  if new.slot_id is not null and new.slot_id is distinct from v_slot then
    raise exception
      'Dataset slot % does not belong to assessment % in this organization',
      new.slot_id, new.assessment_id using errcode = 'check_violation';
  end if;

  if v_slot is null then
    new.slot_id := null;
    return new;
  end if;

  new.slot_id := v_slot;

  update ria_dataset_slots s
     set readiness = case
           when new.deleted_at is not null then s.readiness
           when new.profiled_at is not null and s.readiness = 'received' then 'profiled'
           when s.readiness = 'missing' then 'received'
           else s.readiness
         end,
         updated_at = now()
   where s.id = v_slot
     and s.assessment_id = new.assessment_id
     and s.organization_id = new.organization_id;

  return new;
end
$$;

drop trigger if exists trg_ria_advance_slot on public.ria_data_sources;
create trigger trg_ria_advance_slot
  before insert or update on public.ria_data_sources
  for each row execute function public.advance_ria_slot_on_source();

revoke all on function public.advance_ria_slot_on_source() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE GOVERNED WRITES.
-- ---------------------------------------------------------------------------
-- Every one resolves the organization from the session. None takes an
-- organization argument, so none widens the surface definerTenancy.test.ts
-- scans for.

create or replace function public.record_ria_source_profile(
  p_source_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_source ria_data_sources%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  if not app_can_supply_ria_sources() then
    return jsonb_build_object('error', 'profiling an assessment source requires a data-supplying role');
  end if;

  select * into v_source from ria_data_sources
   where id = p_source_id and organization_id = v_org and deleted_at is null;
  if not found then
    return jsonb_build_object('error', 'source not found in current organization, or retired');
  end if;

  update ria_data_sources
     set row_count = nullif(p_profile->>'row_count', '')::int,
         column_count = nullif(p_profile->>'column_count', '')::int,
         profile = coalesce(p_profile->'columns', '{}'::jsonb),
         identifier_coverage = nullif(p_profile->>'identifier_coverage', '')::numeric,
         coverage_from = nullif(p_profile->>'coverage_from', '')::date,
         coverage_to = nullif(p_profile->>'coverage_to', '')::date,
         dq_exceptions = coalesce(p_profile->'dq_exceptions', '[]'::jsonb),
         missing_required_fields = coalesce(
           (select array_agg(value::text) from jsonb_array_elements_text(
              coalesce(p_profile->'missing_required_fields', '[]'::jsonb)) as t(value)),
           '{}'),
         content_sha256 = nullif(p_profile->>'content_sha256', ''),
         record_count = coalesce(nullif(p_profile->>'row_count', '')::bigint, record_count),
         status = case when status = 'uploaded' then 'profiled' else status end,
         profiled_at = now()
   where id = p_source_id;

  return jsonb_build_object('source_id', p_source_id, 'profiled', true);
end
$$;

revoke all on function public.record_ria_source_profile(uuid, jsonb) from public, anon;
grant execute on function public.record_ria_source_profile(uuid, jsonb) to authenticated;

-- Green/Amber/Red is an engineering judgement about whether the requested
-- conclusion is reachable. It is gated to the engineering roles and it always
-- carries its reason — the constraint above refuses the colour without one.
create or replace function public.set_ria_dataset_readiness(
  p_slot_id uuid,
  p_readiness text,
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
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error',
      'rating dataset readiness requires an engineering or administrator role');
  end if;

  if p_readiness not in ('green','amber','red') then
    return jsonb_build_object('error',
      'readiness rating must be green, amber or red - received/profiled are observed, not rated');
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    return jsonb_build_object('error',
      'a rating needs its reason: what is coherent, what the gap is, or why the conclusion is unreachable');
  end if;

  update ria_dataset_slots
     set readiness = p_readiness,
         readiness_note = p_note,
         rated_by = auth.uid(),
         rated_at = now(),
         updated_at = now()
   where id = p_slot_id and organization_id = v_org;

  if not found then
    return jsonb_build_object('error', 'dataset slot not found in current organization');
  end if;

  return jsonb_build_object('slot_id', p_slot_id, 'readiness', p_readiness);
end
$$;

revoke all on function public.set_ria_dataset_readiness(uuid, text, text) from public, anon;
grant execute on function public.set_ria_dataset_readiness(uuid, text, text) to authenticated;

create or replace function public.open_ria_clarification(
  p_assessment_id uuid,
  p_question text,
  p_dataset_key text default null,
  p_data_source_id uuid default null,
  p_blocks_analysis boolean default false
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
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'raising a clarification requires a planning, engineering or administrator role');
  end if;

  if btrim(coalesce(p_question, '')) = '' then
    return jsonb_build_object('error', 'a clarification needs a question');
  end if;

  if not exists (select 1 from ria_assessments where id = p_assessment_id and organization_id = v_org) then
    return jsonb_build_object('error', 'assessment not found in current organization');
  end if;

  insert into ria_clarifications
    (assessment_id, organization_id, data_source_id, dataset_key, question,
     blocks_analysis, asked_by)
  values (p_assessment_id, v_org,
          (select id from ria_data_sources
            where id = p_data_source_id and organization_id = v_org),
          p_dataset_key, btrim(p_question), coalesce(p_blocks_analysis, false), auth.uid())
  returning id into v_id;

  return jsonb_build_object('clarification_id', v_id);
end
$$;

revoke all on function public.open_ria_clarification(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.open_ria_clarification(uuid, text, text, uuid, boolean) to authenticated;

-- Answering is the sponsor's job as much as the engineer's, so the role gate
-- here is deliberately the data-supplying set rather than the engineering one.
create or replace function public.answer_ria_clarification(
  p_clarification_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  if not app_can_supply_ria_sources() then
    return jsonb_build_object('error', 'answering a clarification requires a sponsor, planning, engineering or administrator role');
  end if;
  if btrim(coalesce(p_answer, '')) = '' then
    return jsonb_build_object('error', 'an answer cannot be blank');
  end if;

  update ria_clarifications
     set status = 'answered',
         answer = btrim(p_answer),
         answered_by = auth.uid(),
         answered_at = now()
   where id = p_clarification_id
     and organization_id = v_org
     and status = 'open';

  if not found then
    return jsonb_build_object('error', 'open clarification not found in current organization');
  end if;

  return jsonb_build_object('clarification_id', p_clarification_id, 'status', 'answered');
end
$$;

revoke all on function public.answer_ria_clarification(uuid, text) from public, anon;
grant execute on function public.answer_ria_clarification(uuid, text) to authenticated;

create or replace function public.upsert_ria_asset_alias(
  p_assessment_id uuid,
  p_source_system text,
  p_source_alias text,
  p_canonical_asset_id uuid default null,
  p_canonical_asset_ref text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_asset uuid;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  if not app_can_supply_ria_sources() then
    return jsonb_build_object('error', 'editing the alias map requires a data-supplying role');
  end if;
  if btrim(coalesce(p_source_system, '')) = '' or btrim(coalesce(p_source_alias, '')) = '' then
    return jsonb_build_object('error', 'an alias needs both a source system and the alias itself');
  end if;
  if not exists (select 1 from ria_assessments where id = p_assessment_id and organization_id = v_org) then
    return jsonb_build_object('error', 'assessment not found in current organization');
  end if;

  -- An alias may only ever point at an asset in the caller's own organization.
  select id into v_asset from assets
   where id = p_canonical_asset_id and organization_id = v_org;
  if p_canonical_asset_id is not null and v_asset is null then
    return jsonb_build_object('error', 'canonical asset not found in current organization');
  end if;

  insert into ria_asset_aliases
    (assessment_id, organization_id, source_system, source_alias,
     canonical_asset_id, canonical_asset_ref, resolved, notes, created_by)
  values (p_assessment_id, v_org, btrim(p_source_system), btrim(p_source_alias),
          v_asset, nullif(btrim(coalesce(p_canonical_asset_ref, '')), ''),
          v_asset is not null or btrim(coalesce(p_canonical_asset_ref, '')) <> '',
          p_notes, auth.uid())
  on conflict (assessment_id, source_system, source_alias) do update
    set canonical_asset_id = excluded.canonical_asset_id,
        canonical_asset_ref = excluded.canonical_asset_ref,
        resolved = excluded.resolved,
        notes = coalesce(excluded.notes, ria_asset_aliases.notes)
  returning id into v_id;

  return jsonb_build_object('alias_id', v_id);
end
$$;

revoke all on function public.upsert_ria_asset_alias(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.upsert_ria_asset_alias(uuid, text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. THE READINESS ROLLUP — the pack's §8 acceptance test, answered honestly.
-- ---------------------------------------------------------------------------
-- Returns the four conditions separately. A caller that wants one number can
-- compute one; a caller that wants to tell the customer what is outstanding
-- can, which the shipped percentage could not.
create or replace function public.get_ria_readiness(p_assessment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_assessment ria_assessments%rowtype;
  v_slots jsonb;
  v_register_received boolean;
  v_work_orders_received boolean;
  v_question_agreed boolean;
  v_gaps_logged boolean;
  v_missing_required int;
  v_open_blocking int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;

  select * into v_assessment from ria_assessments
   where id = p_assessment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'assessment not found in current organization');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slot_id', s.id,
           'dataset_key', s.dataset_key,
           'label', s.label,
           'requirement', s.requirement,
           'readiness', s.readiness,
           'readiness_note', s.readiness_note,
           'sources', (select count(*) from ria_data_sources d
                        where d.slot_id = s.id and d.deleted_at is null)
         ) order by
           case s.requirement when 'required' then 0 when 'preferred' then 1 else 2 end,
           s.dataset_key), '[]'::jsonb)
    into v_slots
    from ria_dataset_slots s
   where s.assessment_id = p_assessment_id;

  select count(*) into v_missing_required
    from ria_dataset_slots s
   where s.assessment_id = p_assessment_id
     and s.requirement = 'required'
     and s.readiness = 'missing';

  v_register_received := exists (
    select 1 from ria_dataset_slots s
     where s.assessment_id = p_assessment_id and s.dataset_key = 'asset_register'
       and s.readiness <> 'missing');

  v_work_orders_received := exists (
    select 1 from ria_dataset_slots s
     where s.assessment_id = p_assessment_id and s.dataset_key = 'work_orders'
       and s.readiness <> 'missing');

  v_question_agreed := btrim(coalesce(v_assessment.primary_management_question, '')) <> '';

  -- "Known missing datasets are explicitly logged" — a slot still sitting at
  -- 'missing' with nothing said about it is not a logged gap, it is silence.
  -- Optional datasets are excluded: the alias map was never a dataset the pack
  -- asks for, so its absence is not a gap anyone has to account for.
  v_gaps_logged := not exists (
    select 1 from ria_dataset_slots s
     where s.assessment_id = p_assessment_id
       and s.readiness = 'missing'
       and s.requirement in ('required','preferred')
       and btrim(coalesce(s.readiness_note, '')) = ''
       and not exists (
         select 1 from ria_clarifications c
          where c.assessment_id = p_assessment_id
            and c.dataset_key = s.dataset_key));

  select count(*) into v_open_blocking
    from ria_clarifications c
   where c.assessment_id = p_assessment_id
     and c.status = 'open' and c.blocks_analysis;

  return jsonb_build_object(
    'assessment_id', p_assessment_id,
    'scope_confirmed', v_assessment.scope_confirmed_at is not null,
    'asset_register_received', v_register_received,
    'work_orders_received', v_work_orders_received,
    'primary_question_agreed', v_question_agreed,
    'gaps_explicitly_logged', v_gaps_logged,
    -- The pack's §8 acceptance test, all four conditions, no partial credit.
    'kickoff_data_ready',
      v_assessment.scope_confirmed_at is not null
      and v_register_received and v_work_orders_received
      and v_question_agreed and v_gaps_logged,
    'required_datasets_missing', v_missing_required,
    'open_blocking_clarifications', v_open_blocking,
    'slots', v_slots);
end
$$;

-- ---------------------------------------------------------------------------
-- 6b. THE CONTRACTED PURGE OF A RAW EXPORT.
-- ---------------------------------------------------------------------------
-- Lives here rather than in 20260920000000 because raw_retained and
-- content_sha256 are this file's columns, and a function should not be
-- defined a migration ahead of the state it writes.
-- The raw export is gone; say so, and only once it is true. Called after the
-- storage removal succeeds, never before — a flag set in hope is how a
-- retention claim becomes a false one.
create or replace function public.confirm_ria_source_raw_purged(
  p_source_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_source ria_data_sources%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  if not app_can_supply_ria_sources() then
    return jsonb_build_object('error', 'confirming a purge requires a data-supplying role');
  end if;

  select * into v_source from ria_data_sources
   where id = p_source_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'source not found in current organization');
  end if;
  if v_source.deleted_at is null then
    return jsonb_build_object('error', 'source is not retired - retire it before purging the raw export');
  end if;

  update ria_data_sources set raw_retained = false where id = p_source_id;

  insert into audit_events (organization_id, entity_type, event_data, actor)
  values (v_org, 'ria_data_source',
    jsonb_build_object(
      'event', 'raw_export_purged',
      'source_id', p_source_id,
      'assessment_id', v_source.assessment_id,
      'file_name', v_source.file_name,
      'object_path', v_source.object_path,
      'content_sha256', v_source.content_sha256,
      'note', p_note),
    coalesce(auth.uid()::text, 'unknown'));

  return jsonb_build_object('source_id', p_source_id, 'raw_retained', false);
end
$$;

revoke all on function public.confirm_ria_source_raw_purged(uuid, text) from public, anon;
grant execute on function public.confirm_ria_source_raw_purged(uuid, text) to authenticated;

revoke all on function public.get_ria_readiness(uuid) from public, anon;
grant execute on function public.get_ria_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS. Read is org-scoped; every write goes through the RPCs above.
-- ---------------------------------------------------------------------------
alter table public.ria_dataset_slots enable row level security;
alter table public.ria_clarifications enable row level security;
alter table public.ria_asset_aliases enable row level security;

drop policy if exists ria_dataset_slots_org_read on public.ria_dataset_slots;
create policy ria_dataset_slots_org_read on public.ria_dataset_slots for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_clarifications_org_read on public.ria_clarifications;
create policy ria_clarifications_org_read on public.ria_clarifications for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_asset_aliases_org_read on public.ria_asset_aliases;
create policy ria_asset_aliases_org_read on public.ria_asset_aliases for select to authenticated
using (organization_id = public.app_current_org());

notify pgrst, 'reload schema';
