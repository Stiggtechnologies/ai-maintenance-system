-- ============================================================================
-- Sync Develop Slice 3C — Evidence Confidence (D11.22, spec III.§46):
-- EC = Q × A × F × V with TENANT-VISIBLE configurable weights, and a REFUSAL
-- naming the factor when a factor is absent.
--
-- SPEC §46, VERBATIM: "Evidence Confidence (§46): EC = Q × A × F × V
-- (quality, applicability, freshness, verification). Configurable weights —
-- do not pretend universal science."
--
-- THE HARD PART IS THE LAST CLAUSE OF THE ROW, NOT THE ARITHMETIC. Three of
-- the four factors did not exist as data a computation could read:
--   Q  data_quality was free text with a default of 'good' — a column whose
--      default asserts a grade nobody gave;
--   A  applicability was free text (20261105090000:78);
--   F  no validity horizon existed anywhere, so "fresh" had no meaning;
--   V  verification_status was already typed and NOT NULL — the one factor
--      that is genuinely always present.
--
-- RULINGS THIS FILE TAKES:
--
--   * WEIGHTS ARE DATA, VERSIONED AND ADOPTED, on the
--     risk_criteria_profiles.scoring_weights discipline the overlap map
--     names — draft → adopted → superseded, ONE adopted profile per
--     organization enforced by a partial unique index (the 3A rule: two rows
--     both labeled adopted with only one consulted is a lie in the data).
--     A dedicated table rather than a column on risk_criteria_profiles: that
--     profile is adopted per RISK CONTEXT and versions on risk-criteria
--     grounds, and hanging evidence weights on it would make an evidence
--     policy change require a risk-criteria version. Same discipline, own
--     lifecycle — the ruling is recorded here because the code cannot say it.
--
--   * NO ADOPTED PROFILE IS A NAMED REFUSAL, not a built-in default. A
--     hardcoded fallback weight set IS the pretended universal science §46
--     forbids; it would also mean every tenant silently shared one opinion.
--     The seeded profile is a DRAFT: it exists to be read, edited and
--     adopted, and it computes nothing until a human adopts it.
--
--   * A MISSING FACTOR REFUSES, NAMING IT. Never a midpoint, never a zero
--     (zero would multiply EC to zero and read as "we assessed this as
--     worthless"), never a skipped term (which silently re-weights the other
--     three). This is the assessGate/D3.04 refusal discipline applied to
--     §46. The refusal lists EVERY missing factor and what to record.
--
--   * 'unknown' IS ABSENT, NOT LOW. data_quality = 'unknown' means nobody
--     graded it. Grading absence as poor would be an invented judgement in
--     the pessimistic direction, which is no more honest than the optimistic
--     one.
--
--   * FRESHNESS IS A DECAY OVER A TENANT-STATED HALF-LIFE PER EVIDENCE
--     CLASS, floored at a tenant-stated minimum. A MEASURED reading and a
--     DOCUMENTED standard do not age at the same rate, and pretending they
--     do would be exactly the universal science §46 warns about. A class
--     with no stated half-life in the adopted profile refuses BY NAME —
--     adding a class without a policy for it cannot silently inherit
--     another class's.
--
--   * EC IS COMPUTED, NEVER STORED AS A COLUMN. A stored EC goes stale the
--     moment a weight is re-adopted or a day passes, and a stale confidence
--     is worse than none. It is a function over live inputs; the profile
--     version that produced a given number is returned WITH it.
--
--   * EC MOVES NO GATE. §70: a computed confidence never passes a gate,
--     accepts a risk or verifies evidence. get_gate_readiness reads
--     verification counts, not EC — unchanged by this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The typed factors. Q and A become graded columns; F gains the
--    observation basis it needs; V already exists.
-- ---------------------------------------------------------------------------
alter table public.evidence_items
  add column if not exists quality_grade text
    check (quality_grade is null or quality_grade in ('high','moderate','low')),
  add column if not exists applicability_grade text
    check (applicability_grade is null or applicability_grade in
      ('direct','analogous','indirect'));

comment on column public.evidence_items.quality_grade is
  'D11.22 / spec §46 factor Q. Typed because the legacy data_quality column is free text with a default of ''good'' — a default that asserts a grade nobody gave. Null means UNGRADED and refuses the EC computation by name; it is never treated as a midpoint.';
comment on column public.evidence_items.applicability_grade is
  'D11.22 / spec §46 factor A: direct (this evidence is about this subject), analogous (a comparable subject), indirect (bears on it at a remove). Null refuses the computation by name — the free-text applicability column stays as the human note.';

create index if not exists idx_evidence_confidence_factors
  on evidence_items(organization_id, quality_grade, applicability_grade)
  where quality_grade is not null and applicability_grade is not null;

-- ---------------------------------------------------------------------------
-- 2. The weights, as adopted data.
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_confidence_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  version int not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  -- Factor value maps. Each is {grade: weight} with weights in [0,1].
  -- Validated complete at ADOPTION, not at authoring: a draft is allowed to
  -- be half-written, an adopted profile is not.
  quality_weights jsonb not null default '{}'::jsonb,
  applicability_weights jsonb not null default '{}'::jsonb,
  verification_weights jsonb not null default '{}'::jsonb,
  -- Freshness policy: per evidence class, the half-life in days and the
  -- floor the decay never falls below. {"MEASURED": {"halfLifeDays": 30,
  -- "floor": 0.1}, ...}
  freshness_half_life_days jsonb not null default '{}'::jsonb,
  basis text not null check (btrim(basis) <> ''),
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references evidence_confidence_profiles(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(quality_weights) = 'object'),
  check (jsonb_typeof(applicability_weights) = 'object'),
  check (jsonb_typeof(verification_weights) = 'object'),
  check (jsonb_typeof(freshness_half_life_days) = 'object')
);

create unique index if not exists idx_evidence_confidence_name_version
  on evidence_confidence_profiles(organization_id, name, version);
-- ONE adopted profile per organization (the 3A rule).
create unique index if not exists idx_evidence_confidence_one_adopted
  on evidence_confidence_profiles(organization_id) where status = 'adopted';

alter table public.evidence_confidence_profiles enable row level security;
-- Tenant-VISIBLE is the row's own requirement: the weights are readable by
-- every authenticated member of the organization, because a confidence
-- number whose weights are hidden is the pretended universal science §46
-- forbids, wearing a tenant's name.
drop policy if exists evidence_confidence_profiles_read on public.evidence_confidence_profiles;
create policy evidence_confidence_profiles_read on public.evidence_confidence_profiles
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: authoring and adoption are the definer RPCs below.

-- The starting point, seeded as a DRAFT for every organization: real
-- numbers a tenant can read, argue with and change, arming nothing until
-- somebody adopts it. The basis states where the numbers come from and,
-- explicitly, that they are a starting position rather than a finding.
--
-- SEEDED FOR EVERY ORGANIZATION THAT EVER EXISTS, not only those that existed
-- when this migration ran. The first draft was a one-shot backfill over
-- `organizations` with no trigger, so every tenant provisioned afterwards had
-- no profile at all — no draft to adopt, no client insert policy, and no
-- create verb — which left compute_evidence_confidence returning
-- 'no_adopted_profile' permanently with no path out. A capability only the
-- migration's own contemporaries can reach is not a capability.
create or replace function public.seed_evidence_confidence_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into evidence_confidence_profiles (
    organization_id, name, version, status, quality_weights, applicability_weights,
    verification_weights, freshness_half_life_days, basis)
  select new.id, 'Default evidence confidence', 1, 'draft',
    '{"high": 1.0, "moderate": 0.7, "low": 0.4}'::jsonb,
    '{"direct": 1.0, "analogous": 0.7, "indirect": 0.4}'::jsonb,
    '{"verified": 1.0, "unverified": 0.6, "rejected": 0.0}'::jsonb,
    ('{"MEASURED": {"halfLifeDays": 90, "floor": 0.2},'
     '"INSPECTED": {"halfLifeDays": 180, "floor": 0.2},'
     '"CALCULATED": {"halfLifeDays": 365, "floor": 0.3},'
     '"TESTED": {"halfLifeDays": 365, "floor": 0.3},'
     '"DOCUMENTED": {"halfLifeDays": 1095, "floor": 0.4},'
     '"HISTORICAL": {"halfLifeDays": 1825, "floor": 0.3},'
     '"EXPERT_JUDGEMENT": {"halfLifeDays": 365, "floor": 0.3},'
     '"AI_INFERENCE": {"halfLifeDays": 90, "floor": 0.1}}')::jsonb,
    'Starting position, not a finding: an ordering the organization is expected to argue with and re-adopt. Faster-ageing classes (measured readings, AI inferences) carry shorter half-lives than slower ones (documents, history). Spec §46 is explicit that these weights are configurable and are not universal science.'
  where not exists (
    select 1 from evidence_confidence_profiles p
    where p.organization_id = new.id and p.name = 'Default evidence confidence');
  return new;
end
$$;

revoke all on function public.seed_evidence_confidence_profile() from public, anon, authenticated;

drop trigger if exists trg_seed_evidence_confidence_profile on public.organizations;
create trigger trg_seed_evidence_confidence_profile
  after insert on public.organizations
  for each row execute function public.seed_evidence_confidence_profile();

insert into evidence_confidence_profiles (
  organization_id, name, version, status, quality_weights, applicability_weights,
  verification_weights, freshness_half_life_days, basis)
select o.id, 'Default evidence confidence', 1, 'draft',
  '{"high": 1.0, "moderate": 0.7, "low": 0.4}'::jsonb,
  '{"direct": 1.0, "analogous": 0.7, "indirect": 0.4}'::jsonb,
  '{"verified": 1.0, "unverified": 0.6, "rejected": 0.0}'::jsonb,
  ('{"MEASURED": {"halfLifeDays": 90, "floor": 0.2},'
   '"INSPECTED": {"halfLifeDays": 180, "floor": 0.2},'
   '"CALCULATED": {"halfLifeDays": 365, "floor": 0.3},'
   '"TESTED": {"halfLifeDays": 365, "floor": 0.3},'
   '"DOCUMENTED": {"halfLifeDays": 1095, "floor": 0.4},'
   '"HISTORICAL": {"halfLifeDays": 1825, "floor": 0.3},'
   '"EXPERT_JUDGEMENT": {"halfLifeDays": 365, "floor": 0.3},'
   '"AI_INFERENCE": {"halfLifeDays": 90, "floor": 0.1}}')::jsonb,
  'Starting position, not a finding: an ordering the organization is expected to argue with and re-adopt. Faster-ageing classes (measured readings, AI inferences) carry shorter half-lives than slower ones (documents, history). Spec §46 is explicit that these weights are configurable and are not universal science.'
from organizations o
where not exists (
  select 1 from evidence_confidence_profiles p
  where p.organization_id = o.id and p.name = 'Default evidence confidence');

-- ---------------------------------------------------------------------------
-- 3. Authoring (draft-only), VERSIONING and adoption.
--
--    THE VERB THE REFUSAL NAMES. set_evidence_confidence_weights refuses an
--    edit to an adopted profile with "create a new version and adopt it" —
--    and the first draft of this file shipped no way to create one. There was
--    exactly one INSERT in the whole chain (the seed), no client write policy
--    and no create RPC, so a tenant's weights froze permanently on first
--    adoption and the draft → adopted → superseded lifecycle, the one-adopted
--    index and the supersede branch could never be exercised twice. A refusal
--    that names a remedy the system does not have is worse than no refusal:
--    it tells the user the fault is theirs.
-- ---------------------------------------------------------------------------
create or replace function public.create_evidence_confidence_profile_version(
  p_from_profile_id uuid,
  p_basis text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p evidence_confidence_profiles%rowtype;
  v_id uuid;
  v_version int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('admin','executive','reliability_engineer') then
    return jsonb_build_object('error', 'creating an evidence-confidence weight set requires an admin, executive or reliability-engineering role');
  end if;
  select * into p from evidence_confidence_profiles
  where id = p_from_profile_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence confidence profile not found');
  end if;
  if exists (select 1 from evidence_confidence_profiles d
             where d.organization_id = v_org and d.name = p.name and d.status = 'draft') then
    return jsonb_build_object('error',
      format('a draft of "%s" already exists — edit that draft (set_evidence_confidence_weights) and adopt it, rather than opening a second unadopted version of the same weight set', p.name));
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from evidence_confidence_profiles
  where organization_id = v_org and name = p.name;

  -- COPY FORWARD, never blank. The new version starts as the numbers the
  -- organization is actually running on, so an edit is an argument with a
  -- stated position rather than a fresh invention.
  insert into evidence_confidence_profiles (
    organization_id, name, version, status, quality_weights, applicability_weights,
    verification_weights, freshness_half_life_days, basis, created_by)
  values (
    v_org, p.name, v_version, 'draft', p.quality_weights, p.applicability_weights,
    p.verification_weights, p.freshness_half_life_days,
    coalesce(nullif(btrim(coalesce(p_basis, '')), ''),
             format('Version %s, copied forward from version %s. %s', v_version, p.version, p.basis)),
    auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'evidence_confidence_profile', coalesce(v_role, 'unknown'),
    jsonb_build_object('profile_id', v_id, 'action', 'version_created',
      'from_profile_id', p.id, 'from_version', p.version, 'version', v_version,
      'name', p.name),
    jsonb_build_object('version', p.version, 'status', p.status),
    jsonb_build_object('version', v_version, 'status', 'draft'));

  return jsonb_build_object('profile_id', v_id, 'name', p.name,
    'version', v_version, 'status', 'draft');
end
$$;

revoke all on function public.create_evidence_confidence_profile_version(uuid, text) from public, anon;
grant execute on function public.create_evidence_confidence_profile_version(uuid, text) to authenticated;

create or replace function public.set_evidence_confidence_weights(
  p_profile_id uuid,
  p_weights jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p evidence_confidence_profiles%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('admin','executive','reliability_engineer') then
    return jsonb_build_object('error', 'authoring evidence-confidence weights requires an admin, executive or reliability-engineering role');
  end if;
  select * into p from evidence_confidence_profiles
  where id = p_profile_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence confidence profile not found');
  end if;
  if p.status <> 'draft' then
    return jsonb_build_object('error',
      format('this profile is %s — an adopted weight set is not edited in place; create a new version and adopt it, so every computed confidence can name the profile version that produced it', p.status));
  end if;

  update evidence_confidence_profiles
  set quality_weights = coalesce(p_weights->'quality_weights', p.quality_weights),
      applicability_weights = coalesce(p_weights->'applicability_weights', p.applicability_weights),
      verification_weights = coalesce(p_weights->'verification_weights', p.verification_weights),
      freshness_half_life_days = coalesce(p_weights->'freshness_half_life_days', p.freshness_half_life_days),
      basis = coalesce(nullif(btrim(coalesce(p_weights->>'basis','')), ''), p.basis)
  where id = p.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'evidence_confidence_profile', coalesce(v_role, 'unknown'),
    jsonb_build_object('profile_id', p.id, 'action', 'weights_authored',
      'version', p.version),
    jsonb_build_object('quality_weights', p.quality_weights,
      'applicability_weights', p.applicability_weights,
      'verification_weights', p.verification_weights,
      'freshness_half_life_days', p.freshness_half_life_days),
    (select jsonb_build_object('quality_weights', q.quality_weights,
       'applicability_weights', q.applicability_weights,
       'verification_weights', q.verification_weights,
       'freshness_half_life_days', q.freshness_half_life_days)
     from evidence_confidence_profiles q where q.id = p.id));

  return jsonb_build_object('profile_id', p.id, 'status', 'draft');
end
$$;

revoke all on function public.set_evidence_confidence_weights(uuid, jsonb) from public, anon;
grant execute on function public.set_evidence_confidence_weights(uuid, jsonb) to authenticated;

create or replace function public.adopt_evidence_confidence_profile(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p evidence_confidence_profiles%rowtype;
  v_grade text;
  v_class text;
  v_w numeric;
  v_missing text[] := '{}';
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error', 'adopting an evidence-confidence weight set requires an admin or executive role');
  end if;
  select * into p from evidence_confidence_profiles
  where id = p_profile_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence confidence profile not found');
  end if;
  if p.status = 'adopted' then
    return jsonb_build_object('error', 'this profile is already adopted');
  end if;
  if p.status = 'superseded' then
    return jsonb_build_object('error', 'a superseded profile is not re-adopted — create a new version');
  end if;

  -- Completeness is checked AT ADOPTION: an adopted profile that cannot
  -- score a grade the schema allows would refuse live computations at random
  -- depending on which evidence you looked at.
  -- EVERY READ IS TYPE-CHECKED BEFORE IT IS CAST. set_evidence_confidence_
  -- weights accepts any jsonb object by design (a draft may be half-written),
  -- so a value like "very high" survived authoring and detonated HERE as a
  -- raw 22P02 from inside the loop — bypassing the careful v_missing list
  -- this function builds for every other failure. sync_text_as_numeric
  -- (20261122090000 section 0) returns NULL instead, so a non-numeric weight
  -- lands in the list by name like any other missing one.
  foreach v_grade in array array['high','moderate','low'] loop
    v_w := sync_text_as_numeric(nullif(p.quality_weights->>v_grade, ''));
    if v_w is null or v_w = 'NaN'::numeric or v_w < 0 or v_w > 1 then
      v_missing := array_append(v_missing, 'quality.' || v_grade);
    end if;
  end loop;
  foreach v_grade in array array['direct','analogous','indirect'] loop
    v_w := sync_text_as_numeric(nullif(p.applicability_weights->>v_grade, ''));
    if v_w is null or v_w = 'NaN'::numeric or v_w < 0 or v_w > 1 then
      v_missing := array_append(v_missing, 'applicability.' || v_grade);
    end if;
  end loop;
  foreach v_grade in array array['verified','unverified','rejected'] loop
    v_w := sync_text_as_numeric(nullif(p.verification_weights->>v_grade, ''));
    if v_w is null or v_w = 'NaN'::numeric or v_w < 0 or v_w > 1 then
      v_missing := array_append(v_missing, 'verification.' || v_grade);
    end if;
  end loop;
  foreach v_class in array array['MEASURED','INSPECTED','CALCULATED','TESTED',
                                'DOCUMENTED','HISTORICAL','EXPERT_JUDGEMENT','AI_INFERENCE'] loop
    v_w := sync_text_as_numeric(nullif(p.freshness_half_life_days->v_class->>'halfLifeDays', ''));
    if v_w is null or v_w = 'NaN'::numeric or v_w <= 0 then
      v_missing := array_append(v_missing, 'freshness.' || v_class || '.halfLifeDays');
    end if;
    v_w := sync_text_as_numeric(nullif(p.freshness_half_life_days->v_class->>'floor', ''));
    if v_w is null or v_w = 'NaN'::numeric or v_w < 0 or v_w > 1 then
      v_missing := array_append(v_missing, 'freshness.' || v_class || '.floor');
    end if;
  end loop;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('error',
      format('this weight set cannot be adopted: %s missing or out of range (%s). An adopted profile scores every grade the schema allows and every §9 evidence class, or the same evidence would score or refuse depending on which row you opened.',
             array_length(v_missing, 1), array_to_string(v_missing, ', ')));
  end if;

  -- Adoption supersedes every currently adopted set (the one-adopted index).
  update evidence_confidence_profiles
  set status = 'superseded', superseded_by = p.id
  where organization_id = v_org and status = 'adopted' and id <> p.id;

  update evidence_confidence_profiles
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now()
  where id = p.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'evidence_confidence_profile', coalesce(v_role, 'unknown'),
    jsonb_build_object('profile_id', p.id, 'action', 'adopted',
      'version', p.version, 'name', p.name),
    jsonb_build_object('status', p.status),
    jsonb_build_object('status', 'adopted', 'adopted_by', auth.uid()));

  return jsonb_build_object('profile_id', p.id, 'status', 'adopted',
    'version', p.version);
end
$$;

revoke all on function public.adopt_evidence_confidence_profile(uuid) from public, anon;
grant execute on function public.adopt_evidence_confidence_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Grading an evidence item's Q and A. Separate from record_case_evidence
--    on purpose: grading is a judgement about the evidence, made possibly by
--    someone other than whoever recorded it, and forcing it at capture time
--    would produce exactly the reflex 'good' the legacy default produced.
-- ---------------------------------------------------------------------------
create or replace function public.grade_evidence_item(
  p_evidence_id uuid,
  p_quality_grade text,
  p_applicability_grade text,
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
  e evidence_items%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'grading evidence requires a planning, engineering or governance role');
  end if;
  select * into e from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found');
  end if;
  if coalesce(p_quality_grade, '') not in ('high','moderate','low') then
    return jsonb_build_object('error',
      'quality_grade must be high, moderate or low (spec §46 factor Q) — leaving it ungraded is honest, but grading it requires one of the three');
  end if;
  if coalesce(p_applicability_grade, '') not in ('direct','analogous','indirect') then
    return jsonb_build_object('error',
      'applicability_grade must be direct, analogous or indirect (spec §46 factor A)');
  end if;

  -- The case-scoped restrictive UPDATE policy makes case-linked evidence
  -- untouchable by clients; this definer path is how a graded case evidence
  -- row is written at all (20261105090000's posture, unchanged).
  update evidence_items
  set quality_grade = p_quality_grade,
      applicability_grade = p_applicability_grade,
      applicability = coalesce(nullif(btrim(coalesce(p_note, '')), ''), applicability)
  where id = e.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'evidence_grade', coalesce(v_role, 'unknown'),
    jsonb_build_object('evidence_id', e.id, 'action', 'graded',
      'case_id', e.development_case_id, 'quality_grade', p_quality_grade,
      'applicability_grade', p_applicability_grade),
    jsonb_build_object('quality_grade', e.quality_grade,
      'applicability_grade', e.applicability_grade),
    jsonb_build_object('quality_grade', p_quality_grade,
      'applicability_grade', p_applicability_grade));

  return jsonb_build_object('evidence_id', e.id,
    'quality_grade', p_quality_grade, 'applicability_grade', p_applicability_grade);
end
$$;

revoke all on function public.grade_evidence_item(uuid, text, text, text) from public, anon;
grant execute on function public.grade_evidence_item(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE CALCULATION. EC = Q × A × F × V, each factor a weight in [0,1] read
--    from the ADOPTED profile, with the whole thing refused by name when any
--    factor is absent.
-- ---------------------------------------------------------------------------
create or replace function public.compute_evidence_confidence(p_evidence_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  e evidence_items%rowtype;
  p evidence_confidence_profiles%rowtype;
  v_missing text[] := '{}';
  v_q numeric;
  v_a numeric;
  v_f numeric;
  v_v numeric;
  v_half numeric;
  v_floor numeric;
  v_age numeric;
  v_ec numeric;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into e from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found');
  end if;

  select * into p from evidence_confidence_profiles
  where organization_id = v_org and status = 'adopted';
  if not found then
    return jsonb_build_object('error',
      'no evidence-confidence weight set is adopted in this organization, so EC cannot be computed. Spec §46 is explicit that the weights are configurable and not universal science, so there is no built-in default to fall back to — a hidden default would be one opinion imposed on every tenant. Author and adopt a profile (set_evidence_confidence_weights, adopt_evidence_confidence_profile).',
      'refusal', 'no_adopted_profile');
  end if;

  -- Q. 'unknown' is ABSENT, not low (header ruling).
  if e.quality_grade is null then
    v_missing := array_append(v_missing, 'quality (Q): this evidence has no quality grade — grade it (grade_evidence_item) rather than assuming one');
  else
    v_q := sync_text_as_numeric(nullif(p.quality_weights->>e.quality_grade, ''));
    if v_q is null then
      v_missing := array_append(v_missing, format('quality (Q): the adopted weight set scores no value for grade "%s"', e.quality_grade));
    end if;
  end if;

  -- A.
  if e.applicability_grade is null then
    v_missing := array_append(v_missing, 'applicability (A): this evidence has no applicability grade — is it direct, analogous or indirect to what it is being used for?');
  else
    v_a := sync_text_as_numeric(nullif(p.applicability_weights->>e.applicability_grade, ''));
    if v_a is null then
      v_missing := array_append(v_missing, format('applicability (A): the adopted weight set scores no value for grade "%s"', e.applicability_grade));
    end if;
  end if;

  -- F. Freshness needs BOTH an observation time and a class-specific policy.
  if e.ts is null then
    v_missing := array_append(v_missing, 'freshness (F): this evidence carries no observation time, so its age is unknown — record when it was observed');
  elsif e.evidence_class is null then
    v_missing := array_append(v_missing, 'freshness (F): this evidence has no §9 provenance class, and freshness decays at a class-specific rate — a measured reading and a standard do not age alike');
  else
    v_half := sync_text_as_numeric(nullif(p.freshness_half_life_days->e.evidence_class->>'halfLifeDays', ''));
    v_floor := sync_text_as_numeric(nullif(p.freshness_half_life_days->e.evidence_class->>'floor', ''));
    if v_half is null or v_half <= 0 then
      v_missing := array_append(v_missing, format('freshness (F): the adopted weight set states no half-life for evidence class %s', e.evidence_class));
    elsif v_floor is null then
      v_missing := array_append(v_missing, format('freshness (F): the adopted weight set states no decay floor for evidence class %s', e.evidence_class));
    else
      v_age := greatest(0, extract(epoch from (now() - e.ts)) / 86400.0);
      v_f := greatest(v_floor, power(0.5, v_age / v_half));
    end if;
  end if;

  -- V. Always present: verification_status is NOT NULL with a default that
  -- states an actual position ('unverified'), so it is never absent.
  v_v := sync_text_as_numeric(nullif(p.verification_weights->>e.verification_status, ''));
  if v_v is null then
    v_missing := array_append(v_missing, format('verification (V): the adopted weight set scores no value for status "%s"', e.verification_status));
  end if;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'error', format('Evidence confidence (§46) cannot be computed for this item — %s of the four factors are missing. %s. No factor is defaulted to a midpoint: a made-up factor would produce a number that looks like a measurement.',
                      array_length(v_missing, 1), array_to_string(v_missing, '; ')),
      'refusal', 'missing_factors',
      'missingFactors', to_jsonb(v_missing),
      'evidenceId', e.id);
  end if;

  v_ec := v_q * v_a * v_f * v_v;

  return jsonb_build_object(
    'evidenceId', e.id,
    'evidenceConfidence', round(v_ec, 4),
    'evidenceConfidencePct', round(v_ec * 100, 1),
    'factors', jsonb_build_object(
      'quality', jsonb_build_object('grade', e.quality_grade, 'weight', v_q),
      'applicability', jsonb_build_object('grade', e.applicability_grade, 'weight', v_a),
      'freshness', jsonb_build_object('evidenceClass', e.evidence_class,
        'observedAt', e.ts, 'ageDays', round(v_age, 1),
        'halfLifeDays', v_half, 'floor', v_floor, 'weight', round(v_f, 4)),
      'verification', jsonb_build_object('status', e.verification_status, 'weight', v_v)),
    -- The weights travel WITH the number, always. A confidence whose basis
    -- the reader cannot see is the thing §46 tells us not to build.
    'profile', jsonb_build_object('id', p.id, 'name', p.name, 'version', p.version,
      'adoptedAt', p.adopted_at, 'basis', p.basis));
end
$$;

revoke all on function public.compute_evidence_confidence(uuid) from public, anon;
grant execute on function public.compute_evidence_confidence(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The case-level read: every evidence item's EC, with the refusals kept
--    visible as refusals rather than dropped from the list. Consumed by the
--    workspace read (20261122090700) so EC appears wherever evidence appears.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_evidence_confidence(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  c development_cases%rowtype;
  p evidence_confidence_profiles%rowtype;
  rec record;
  v_items jsonb := '[]'::jsonb;
  v_one jsonb;
  v_scored int := 0;
  v_refused int := 0;
  v_sum numeric := 0;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  select * into p from evidence_confidence_profiles
  where organization_id = v_org and status = 'adopted';

  -- Every item carries its raw §46 inputs, computed or refused alike, so the
  -- surface can preview what a grade WOULD produce with the tenant's own
  -- adopted weights (src/lib/develop/chains.ts:evidenceConfidence, the
  -- documented mirror) instead of asking the user to grade blind.
  for rec in
    select e.id, e.evidence_class, e.ts, e.verification_status,
           e.description, e.quality_grade, e.applicability_grade
    from evidence_items e
    where e.organization_id = v_org and e.development_case_id = c.id
    order by e.created_at desc
  loop
    v_one := compute_evidence_confidence(rec.id);
    if v_one ? 'error' then
      v_refused := v_refused + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'evidenceId', rec.id, 'computed', false,
        'refusal', v_one->>'refusal',
        'missingFactors', coalesce(v_one->'missingFactors', '[]'::jsonb),
        'reason', v_one->>'error',
        'evidenceClass', rec.evidence_class,
        'observedAt', rec.ts,
        'verificationStatus', rec.verification_status,
        'description', rec.description,
        'qualityGrade', rec.quality_grade,
        'applicabilityGrade', rec.applicability_grade));
    else
      v_scored := v_scored + 1;
      v_sum := v_sum + (v_one->>'evidenceConfidence')::numeric;
      v_items := v_items || jsonb_build_array(
        jsonb_build_object('computed', true,
          'evidenceClass', rec.evidence_class,
          'observedAt', rec.ts,
          'verificationStatus', rec.verification_status,
          'description', rec.description,
          'qualityGrade', rec.quality_grade,
          'applicabilityGrade', rec.applicability_grade) || v_one);
    end if;
  end loop;

  return jsonb_build_object(
    'caseId', c.id,
    'profile', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'name', p.name, 'version', p.version, 'basis', p.basis,
      'quality', p.quality_weights, 'applicability', p.applicability_weights,
      'verification', p.verification_weights,
      'freshness', p.freshness_half_life_days) end,
    'scoredCount', v_scored,
    'refusedCount', v_refused,
    -- Null when nothing scored: a mean over zero items is not a mean.
    'meanConfidence', case when v_scored > 0 then round(v_sum / v_scored, 4) end,
    'items', v_items);
end
$$;

revoke all on function public.get_case_evidence_confidence(uuid) from public, anon;
grant execute on function public.get_case_evidence_confidence(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
