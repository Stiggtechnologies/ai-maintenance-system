-- ============================================================================
-- Sync Develop Slice 7C, part 3 — competency requirement, availability, and
-- readiness WHEN NEEDED (register D7.03 and D7.04, spec I.23).
--
-- THE SENTENCE THE SPECIFICATION USES, and the whole reason this row exists:
--
--     "Readiness is not '14 people available' but '14 QUALIFIED people
--      available WHEN NEEDED.'"
--
-- WHAT WAS ALREADY HERE. The full competency model landed on 2026-08-17:
-- `competencies` with `is_statutory` and `validity_months`,
-- `member_competencies` with `granted_on`, `expires_on` and a verifier,
-- `workforce_members`, `shift_assignments`, `labour_rules`, and the reads
-- `get_workforce_posture` / `get_roster_window`. Every one of those is read
-- from a screen today.
--
-- WHAT WAS MISSING, and the register says both parts plainly:
--
--   D7.03  "only writes are the demo seed; no customer write RPC/UI. EXTEND =
--          wire write paths + required-competency-per-role link."
--   D7.04  "Missing: the joining calc (roster × unexpired competency ×
--          required competency in a demand window) + the expiring-cert flip
--          test."
--
-- So this file adds the REQUIREMENT — which competency a role or a package
-- needs, and how many holders of it — the write paths that make the
-- availability record something a customer can create rather than something
-- the demo seed created, and the joining calculation that asks the question
-- in the FUTURE TENSE.
--
-- THE FUTURE TENSE IS THE POINT. A check that asks `expires_on >=
-- current_date` reports a person as available when their ticket lapses three
-- weeks before the work happens. That is not a rounding error: it is the
-- difference between a crew that can legally start and one that cannot, found
-- on the morning of the job. `sync_competency_when_needed` therefore compares
-- expiry against the END of the work window and has a state of its own —
-- `expires_during_window` — so the flip is nameable, testable and visible on
-- the screen rather than folded into "not qualified".
--
-- REFUSAL. A package with no competency requirement recorded against any of
-- its crafts is UNASSESSED, and this refuses rather than reporting that
-- everybody is qualified. A window that cannot be established — no
-- `required_by` on the package and none supplied — is refused too: "qualified
-- when needed" has no answer when nothing says when.
--
-- §70. Declaring a person competent is a human determination.
-- `member_competencies.verified_by` is walled by the ONE wall Slice 7A
-- installed, `enforce_awp_act_is_human`, bound by TG_ARGV to that column. The
-- wall is SCOPED, and here is the enumeration RULING 20's residual demands:
-- `member_competencies` has exactly ONE writer in the entire repository —
-- `20260817093000_demo_workforce.sql:76`, which inserts (organization_id,
-- member_id, competency_id, granted_on, expires_on) and sets NO verifier, so
-- it passes the wall's NULL-actor early return unchanged. Every other
-- reference to the table in this repository is a read (the four SoD/ABAC/
-- assurance/ISO joins). Nothing legitimate is blocked. RECORDING a
-- requirement is NOT walled — drafting what a job needs is evidence assembly,
-- the half §70 leaves to the machine (RULING 22).
--
-- Canonical reuse: competencies, member_competencies, workforce_members,
-- shift_assignments, labour_rules, work_packages, work_package_work,
-- work_orders, job_plan_steps, work_order_tasks, calculation_runs +
-- record_calculation_run, enforce_awp_act_is_human, app_current_org. One new
-- table — the requirement — and it is the thing nothing held.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CODE VERSIONS (D11.29). Every existing key keeps its own version:
--    their code did not change, and bumping a version on unchanged code makes
--    the version stop meaning anything.
--
--    FOUR KEYS ARE ADDED ACROSS THIS SLICE and they are pinned here, in the
--    file that first needs one, exactly as 7A and 7B pinned theirs.
--    `constraint_free_work_index` is ONE key for TWO register rows: D7.08
--    (spec I.28) and D7.20 (spec III.§49) are the same calculation named
--    twice by the specification, and D7.20's own gap statement says so —
--    "Duplicate spec reference of the I.28 forward metric — one calc."
-- ---------------------------------------------------------------------------
create or replace function public.sync_calculation_code_version(p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select v from (values
    ('case_scope_growth',              'develop-controls/4A/2026-11-24'),
    ('case_cost_reconciliation',       'develop-controls/4A/2026-11-24'),
    ('case_earned_value',              'develop-performance/4B/2026-12-01'),
    ('case_performance_trend',         'develop-performance/4B/2026-12-01'),
    ('case_progress_integrity',        'develop-performance/4B/2026-12-01'),
    ('case_estimate_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_forecast_confidence',       'develop-performance/4B/2026-12-01'),
    ('case_schedule_quality',          'develop-schedule/4C/2026-12-02'),
    ('case_schedule_simulation',       'develop-schedule/4C/2026-12-02'),
    ('case_risk_schedule_economics',   'develop-schedule/4C/2026-12-02'),
    ('case_contingency_consumption',   'develop-change/4D/2026-12-03'),
    ('case_change_control',            'develop-change/4D/2026-12-03'),
    ('case_decision_latency',          'develop-change/4D/2026-12-03'),
    ('case_decision_debt',             'develop-change/4D/2026-12-03'),
    ('case_requirement_traceability',  'develop-requirements/5A/2026-12-04'),
    ('case_design_scorecard',          'develop-design/5B/2026-12-05'),
    ('case_ram_profile',               'develop-ram/5D/2026-12-07'),
    ('case_procurement_position',      'develop-procurement/6A/2026-12-08'),
    ('package_constraint_burndown',    'develop-awp/7A/2026-12-10'),
    ('package_field_readiness',        'develop-awp/7B/2026-12-11'),
    ('case_resource_balance',          'develop-workforce/7C/2026-12-12'),
    ('competency_readiness',           'develop-workforce/7C/2026-12-12'),
    ('constraint_free_work_index',     'develop-workforce/7C/2026-12-12'),
    ('workface_execution_metrics',     'develop-workforce/7C/2026-12-12')
  ) as versions(k, v) where k = p_key;
$$;

revoke all on function public.sync_calculation_code_version(text) from public, anon;
grant execute on function public.sync_calculation_code_version(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE REQUIREMENT OBJECT.
--
--    XOR-anchored on (craft, work_package_id) — the RULING 20 shape, and for
--    the same reason: one invariant over two scopes rather than two tables.
--    A CRAFT requirement is standing ("every electrician needs an authorised
--    person ticket"); a PACKAGE requirement is specific ("this tie-in needs
--    two confined-space entrants"). Both are the same question asked at
--    different grain, and holding them apart would produce two answers to
--    "what does this job need".
-- ---------------------------------------------------------------------------
create table if not exists public.competency_requirements (
  id bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competency_id bigint not null references public.competencies(id) on delete cascade,
  craft text,
  work_package_id bigint references public.work_packages(id) on delete cascade,
  min_holders int not null default 1,
  basis text not null check (length(btrim(basis)) >= 20),
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  retirement_reason text,
  constraint competency_requirement_anchor
    check (num_nonnulls(craft, work_package_id) = 1),
  constraint competency_requirement_craft_named
    check (craft is null or btrim(craft) <> ''),
  constraint competency_requirement_holders
    check (min_holders >= 1 and min_holders <= 500),
  constraint competency_requirement_retirement_actor
    check ((retired_at is null) = (retired_by is null)),
  constraint competency_requirement_retirement_reason
    check ((retired_at is null) = (retirement_reason is null)),
  constraint competency_requirement_retirement_said_something
    check (retirement_reason is null or length(btrim(retirement_reason)) >= 20)
);

create unique index if not exists uq_competency_requirement_live
  on public.competency_requirements(
    organization_id, competency_id, coalesce(craft, ''), coalesce(work_package_id, 0))
  where retired_at is null;

create index if not exists idx_competency_requirement_craft
  on public.competency_requirements(organization_id, craft)
  where craft is not null and retired_at is null;
create index if not exists idx_competency_requirement_package
  on public.competency_requirements(organization_id, work_package_id)
  where work_package_id is not null and retired_at is null;

alter table public.competency_requirements enable row level security;
drop policy if exists competency_requirements_read on public.competency_requirements;
create policy competency_requirements_read on public.competency_requirements
  for select to authenticated using (organization_id = app_current_org());

revoke truncate on table public.competency_requirements from anon, authenticated, service_role;

comment on table public.competency_requirements is
  'D7.03 (spec I.23): what competency a ROLE or a PACKAGE requires, and how many holders of it. XOR-anchored over (craft, work_package_id) — the RULING 20 shape, one invariant over two scopes. This is the requirement half of "required competency vs available"; member_competencies is the availability half and stays where it is.';

-- ---------------------------------------------------------------------------
-- 3. THE WALL. Tenancy across three tables, a retirement that is final, and
--    a DELETE branch that admits a cascade and refuses a hand.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_competency_requirement_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cmp competencies%rowtype;
  p work_packages%rowtype;
begin
  if tg_op = 'TRUNCATE' then
    raise exception
      'competency_requirements is what makes "qualified when needed" answerable. Truncating it makes every crew fully qualified for everything in one statement. Not truncatable by any caller.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    if not exists (select 1 from organizations where id = old.organization_id) then
      return old;
    end if;
    if old.work_package_id is not null
       and not exists (select 1 from work_packages where id = old.work_package_id) then
      return old;
    end if;
    if not exists (select 1 from competencies where id = old.competency_id) then
      return old;
    end if;
    raise exception
      'competency requirement % is not deletable. A requirement that disappears leaves every past readiness answer standing over a question nobody can now see was asked — retire it with a reason instead, which keeps both the requirement and its withdrawal legible.',
      old.id
      using errcode = 'insufficient_privilege';
  end if;

  select * into cmp from competencies where id = new.competency_id;
  if not found or cmp.organization_id <> new.organization_id then
    raise exception
      'this requirement names a competency owned by a different organization. A requirement filed across that boundary is a qualification one tenant cannot see and another cannot explain.'
      using errcode = 'check_violation';
  end if;

  if new.work_package_id is not null then
    select * into p from work_packages where id = new.work_package_id;
    if not found or p.organization_id <> new.organization_id then
      raise exception
        'this requirement names a work package owned by a different organization'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at
       or new.retired_by is distinct from old.retired_by
       or new.competency_id is distinct from old.competency_id
       or new.min_holders is distinct from old.min_holders) then
    raise exception
      'competency requirement % is retired. A retired requirement is not edited back into force: record a new one, so the history says what was required when.',
      old.id
      using errcode = 'insufficient_privilege';
  end if;

  -- A bare `auth.uid() is null`, matching record_awp_service_write's four
  -- other callers. The first draft ANDed `current_user not in
  -- ('authenticated','anon')` onto it; inside a SECURITY DEFINER `current_user`
  -- is the owner, so that conjunct is a constant TRUE and reads to a later
  -- maintainer as a guard that is doing work.
  if auth.uid() is null then
    perform record_awp_service_write(new.organization_id,
      format('Competency requirement %s', coalesce(new.id::text, 'new')), tg_op,
      'A competency requirement was written outside the definer RPCs.');
  end if;

  return new;
end
$$;

revoke all on function public.enforce_competency_requirement_integrity()
  from public, anon, authenticated;

drop trigger if exists trg_competency_requirement_integrity on public.competency_requirements;
create trigger trg_competency_requirement_integrity
  before insert or update or delete on public.competency_requirements
  for each row execute function public.enforce_competency_requirement_integrity();

drop trigger if exists trg_competency_requirement_no_truncate on public.competency_requirements;
create trigger trg_competency_requirement_no_truncate
  before truncate on public.competency_requirements
  for each statement execute function public.enforce_competency_requirement_integrity();

-- §70 on the availability record. See this file's header for the enumeration
-- proving the scope: member_competencies has ONE writer in the repository and
-- it sets no verifier, so nothing legitimate is blocked.
drop trigger if exists trg_member_competency_verifier_human on public.member_competencies;
create trigger trg_member_competency_verifier_human
  before insert or update on public.member_competencies
  for each row execute function public.enforce_awp_act_is_human(
    'verified_by', 'declare a person competent');

-- ---------------------------------------------------------------------------
-- 4. QUALIFIED WHEN NEEDED — the predicate, stated once.
--
--    `expires_during_window` exists because it is the whole row. A ticket
--    valid today and lapsed by the last shift makes its holder qualified NOW
--    and unqualified THEN, and every check that asks about today reports them
--    as available.
--
--    THE EXPIRY CONVENTION IS INCLUSIVE, AND THE OPERATORS SAY SO.
--    `expires_on` is the last day a certificate is valid — valid THROUGH the
--    end of that date — which is how a ticket, a medical and a statutory
--    authorisation are written. Both comparisons follow from that one
--    convention and neither is a preference:
--
--      `p_expires_on < p_window_start`  already_expired — it lapsed before the
--                                       work begins. A certificate expiring ON
--                                       the first day still covers that day, so
--                                       it is not already expired.
--      `p_expires_on < p_window_end`    expires_during_window — it lapses while
--                                       the work is still running. A
--                                       certificate expiring ON the last day
--                                       covers the last day, so it is
--                                       `qualified_through`.
--
--    An earlier draft of this comment claimed the opposite — that `<` would
--    "call a certificate expiring the morning of the final shift sufficient" —
--    while `<` shipped. The code was right and the prose was wrong, on the one
--    boundary this row exists for. The three boundary cases are now pinned by
--    the transcript and by a unit test each, in both mirrors, so the
--    convention cannot drift back into ambiguity.
-- ---------------------------------------------------------------------------
create or replace function public.sync_competency_when_needed(
  p_held boolean,
  p_expires_on date,
  p_window_start date,
  p_window_end date
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when not coalesce(p_held, false) then 'not_held'
    when p_expires_on is null then 'qualified_through'
    when p_expires_on < p_window_start then 'already_expired'
    when p_expires_on < p_window_end then 'expires_during_window'
    else 'qualified_through' end;
$$;

revoke all on function public.sync_competency_when_needed(boolean, date, date, date)
  from public, anon;
grant execute on function public.sync_competency_when_needed(boolean, date, date, date)
  to authenticated, service_role;

comment on function public.sync_competency_when_needed(boolean, date, date, date) is
  'D7.04 (spec I.23): the future-tense qualification test. Compares a certificate''s expiry against the END of the work window, not against today, and gives the flip its own state — `expires_during_window` — so a holder who is qualified now and unqualified when the work happens is reported as the second thing. Expiry is INCLUSIVE: expires_on is the last day the certificate is valid, so a certificate expiring ON the last day of the window covers the window and one expiring ON the first day does not cover the rest of it.';

-- ---------------------------------------------------------------------------
-- 5. THE WRITE PATHS. D7.03's demoted pattern, closed.
-- ---------------------------------------------------------------------------
create or replace function public.record_competency(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_key text := btrim(coalesce(p_payload->>'competencyKey', ''));
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_kind text := btrim(coalesce(p_payload->>'kind', ''));
  v_months int;
  v_statutory boolean := coalesce(sync_text_as_boolean(p_payload->>'isStatutory'), false);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a competency requires a planning, supervisory or governance role');
  end if;
  if v_key = '' or v_title = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'a competency needs a key and a title');
  end if;
  if v_kind not in ('certification', 'licence', 'statutory_authorisation', 'skill', 'familiarisation') then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not a recorded competency kind', v_kind));
  end if;
  v_months := nullif(p_payload->>'validityMonths', '')::int;
  if v_months is not null and v_months <= 0 then
    return jsonb_build_object('answered', false,
      'refusal', 'a validity period must be a positive number of months, or absent to mean it does not expire');
  end if;
  -- A statutory item with no validity period is almost always a data error,
  -- and the consequence of that error is a readiness answer that never
  -- expires anybody. It is refused rather than accepted with a warning.
  if v_statutory and v_months is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a STATUTORY competency with no validity period would never expire anybody in the readiness calculation. If it genuinely does not expire, record it as a skill; if it does, state the period.');
  end if;

  insert into competencies
    (organization_id, competency_key, title, kind, issuing_body,
     validity_months, is_statutory, description)
  values
    (v_org, v_key, v_title, v_kind, nullif(btrim(p_payload->>'issuingBody'), ''),
     v_months, v_statutory, nullif(btrim(p_payload->>'description'), ''))
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'competency', coalesce(v_role, 'system'),
    jsonb_build_object('competencyId', v_id, 'competencyKey', v_key),
    null,
    jsonb_build_object('competencyKey', v_key, 'title', v_title, 'kind', v_kind,
      'validityMonths', v_months, 'isStatutory', v_statutory));

  return jsonb_build_object('answered', true, 'competencyId', v_id,
    'competencyKey', v_key, 'validityMonths', v_months, 'isStatutory', v_statutory);
exception when unique_violation then
  return jsonb_build_object('answered', false,
    'refusal', format('A competency with key "%s" already exists in this organization.', v_key));
end
$$;

revoke all on function public.record_competency(jsonb) from public, anon;
grant execute on function public.record_competency(jsonb) to authenticated;

create or replace function public.record_workforce_member(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_ref text := btrim(coalesce(p_payload->>'employeeRef', ''));
  v_name text := btrim(coalesce(p_payload->>'displayName', ''));
  v_craft text := nullif(btrim(p_payload->>'craft'), '');
  v_employment text := coalesce(nullif(btrim(p_payload->>'employmentType'), ''), 'employee');
  v_fte numeric;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a workforce member requires a planning, supervisory or governance role');
  end if;
  if v_ref = '' or v_name = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'a workforce member needs an employee reference and a display name');
  end if;
  if v_employment not in ('employee', 'contractor', 'agency', 'oem_specialist') then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not a recorded employment type', v_employment));
  end if;
  v_fte := coalesce(nullif(p_payload->>'fte', '')::numeric, 1.0);
  if not sync_is_finite_numeric(v_fte) or v_fte <= 0 or v_fte > 1.5 then
    return jsonb_build_object('answered', false,
      'refusal', 'FTE must be a finite number greater than zero and no more than 1.5');
  end if;

  insert into workforce_members
    (organization_id, site_id, employee_ref, display_name, craft,
     employment_type, employer, fte, hired_on, expected_departure)
  values
    (v_org, sync_text_as_uuid(p_payload->>'siteId'), v_ref, v_name, v_craft,
     v_employment, nullif(btrim(p_payload->>'employer'), ''), v_fte,
     nullif(p_payload->>'hiredOn', '')::date,
     nullif(p_payload->>'expectedDeparture', '')::date)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'workforce_member', coalesce(v_role, 'system'),
    jsonb_build_object('memberId', v_id, 'employeeRef', v_ref),
    null,
    jsonb_build_object('employeeRef', v_ref, 'displayName', v_name,
      'craft', v_craft, 'employmentType', v_employment, 'fte', v_fte));

  return jsonb_build_object('answered', true, 'memberId', v_id,
    'employeeRef', v_ref, 'craft', v_craft);
exception when unique_violation then
  return jsonb_build_object('answered', false,
    'refusal', format('A workforce member with reference "%s" already exists in this organization.', v_ref));
end
$$;

revoke all on function public.record_workforce_member(jsonb) from public, anon;
grant execute on function public.record_workforce_member(jsonb) to authenticated;

create or replace function public.record_member_competency(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  m workforce_members%rowtype;
  cmp competencies%rowtype;
  v_granted date;
  v_expires date;
  v_evidence text := btrim(coalesce(p_payload->>'evidenceReference', ''));
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'declaring a person competent requires a planning, supervisory or governance role');
  end if;
  select * into m from workforce_members
   where id = nullif(p_payload->>'memberId', '')::bigint and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'workforce member not found');
  end if;
  select * into cmp from competencies
   where id = nullif(p_payload->>'competencyId', '')::bigint and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'competency not found');
  end if;
  if v_evidence = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'a competency record names its evidence — the certificate, the assessment or the authorisation it rests on. A qualification with nothing behind it is an assertion.');
  end if;
  v_granted := coalesce(nullif(p_payload->>'grantedOn', '')::date, current_date);
  v_expires := nullif(p_payload->>'expiresOn', '')::date;
  -- Derived from the competency's own validity period when not stated. This
  -- is not an invented date: the period is master data somebody recorded.
  if v_expires is null and cmp.validity_months is not null then
    v_expires := (v_granted + make_interval(months => cmp.validity_months))::date;
  end if;
  if cmp.validity_months is not null and v_expires is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" has a stated validity period, so a holding of it has an expiry. Recording one with no expiry would make its holder permanently qualified in every readiness answer.', cmp.title));
  end if;
  if v_expires is not null and v_expires < v_granted then
    return jsonb_build_object('answered', false,
      'refusal', 'a competency cannot expire before it was granted');
  end if;

  insert into member_competencies
    (organization_id, member_id, competency_id, granted_on, expires_on,
     verified_by, evidence_reference)
  values
    (v_org, m.id, cmp.id, v_granted, v_expires, auth.uid(), v_evidence)
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'member_competency', coalesce(v_role, 'system'),
    jsonb_build_object('memberCompetencyId', v_id, 'memberId', m.id,
      'competencyId', cmp.id),
    null,
    jsonb_build_object('memberRef', m.employee_ref, 'competencyKey', cmp.competency_key,
      'grantedOn', v_granted, 'expiresOn', v_expires,
      'evidenceReference', v_evidence));

  return jsonb_build_object('answered', true, 'memberCompetencyId', v_id,
    'memberId', m.id, 'competencyId', cmp.id,
    'grantedOn', v_granted, 'expiresOn', v_expires,
    'note', case when v_expires is null
      then 'Recorded with no expiry: this competency states no validity period.'
      else format('Recorded, expiring %s. Readiness asks whether that date covers the work, not whether it covers today.', v_expires) end);
exception when unique_violation then
  return jsonb_build_object('answered', false,
    'refusal', 'that member already holds that competency. Record the renewal with `renew_member_competency`, which supersedes the existing holding in place, rather than adding a second one.');
end
$$;

revoke all on function public.record_member_competency(jsonb) from public, anon;
grant execute on function public.record_member_competency(jsonb) to authenticated;

comment on function public.record_member_competency(jsonb) is
  'D7.03: the customer write path onto member_competencies, which until now only the demo seed could write. §70 refuses the AI-operator identity at the DATABASE — enforce_awp_act_is_human bound to verified_by — so the refusal survives every path into the table, not only this one.';

-- The ROSTER write path. `shift_assignments` had the same demoted pattern
-- `member_competencies` had — a table only the demo seed could write — and it
-- is one of D7.04's three inputs, so leaving it seed-only would make
-- "available when needed" answerable only against fixture data.
create or replace function public.record_shift_assignment(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  m workforce_members%rowtype;
  v_kind text := coalesce(nullif(btrim(p_payload->>'shiftKind'), ''), 'day');
  v_starts timestamptz;
  v_ends timestamptz;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'rostering a shift requires a planning, supervisory or governance role');
  end if;
  select * into m from workforce_members
   where id = nullif(p_payload->>'memberId', '')::bigint and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'workforce member not found');
  end if;
  if v_kind not in ('day', 'night', 'swing', 'callout', 'overtime', 'training', 'leave') then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" is not a recorded shift kind', v_kind));
  end if;
  v_starts := nullif(p_payload->>'startsAt', '')::timestamptz;
  v_ends := nullif(p_payload->>'endsAt', '')::timestamptz;
  if v_starts is null or v_ends is null then
    return jsonb_build_object('answered', false,
      'refusal', 'a shift needs a start and an end. A roster row with no times cannot answer whether anybody is available when the work happens.');
  end if;
  if v_ends <= v_starts then
    return jsonb_build_object('answered', false,
      'refusal', 'a shift ends after it starts');
  end if;

  insert into shift_assignments
    (organization_id, member_id, starts_at, ends_at, shift_kind, assigned_by)
  values (v_org, m.id, v_starts, v_ends, v_kind, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'shift_assignment', coalesce(v_role, 'system'),
    jsonb_build_object('shiftId', v_id, 'memberId', m.id),
    null,
    jsonb_build_object('memberRef', m.employee_ref, 'startsAt', v_starts,
      'endsAt', v_ends, 'shiftKind', v_kind));

  return jsonb_build_object('answered', true, 'shiftId', v_id,
    'memberId', m.id, 'startsAt', v_starts, 'endsAt', v_ends, 'shiftKind', v_kind);
end
$$;

revoke all on function public.record_shift_assignment(jsonb) from public, anon;
grant execute on function public.record_shift_assignment(jsonb) to authenticated;

create or replace function public.record_competency_requirement(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  cmp competencies%rowtype;
  p work_packages%rowtype;
  v_craft text := nullif(btrim(p_payload->>'craft'), '');
  v_package bigint := nullif(p_payload->>'workPackageId', '')::bigint;
  v_basis text := btrim(coalesce(p_payload->>'basis', ''));
  v_min int := coalesce(nullif(p_payload->>'minHolders', '')::int, 1);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a competency requirement requires a planning, engineering, supervisory or governance role');
  end if;
  select * into cmp from competencies
   where id = nullif(p_payload->>'competencyId', '')::bigint and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'competency not found');
  end if;
  if (v_craft is null) = (v_package is null) then
    return jsonb_build_object('answered', false,
      'refusal', 'a requirement is anchored to EXACTLY one of a craft or a work package. Both would make the same requirement answerable two ways; neither would make it answerable at all.');
  end if;
  if v_package is not null then
    select * into p from work_packages where id = v_package and organization_id = v_org;
    if not found then
      return jsonb_build_object('answered', false, 'refusal', 'work package not found');
    end if;
  end if;
  if length(v_basis) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'a requirement states why, in at least 20 characters — the regulation, the standard or the hazard it comes from');
  end if;
  if v_min < 1 or v_min > 500 then
    return jsonb_build_object('answered', false,
      'refusal', 'a requirement needs at least one holder and at most five hundred');
  end if;

  insert into competency_requirements
    (organization_id, competency_id, craft, work_package_id, min_holders,
     basis, recorded_by)
  values
    (v_org, cmp.id, v_craft, v_package, v_min, v_basis, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'competency_requirement', coalesce(v_role, 'system'),
    jsonb_build_object('requirementId', v_id, 'competencyId', cmp.id,
      'craft', v_craft, 'workPackageId', v_package),
    null,
    jsonb_build_object('competencyKey', cmp.competency_key, 'craft', v_craft,
      'workPackageId', v_package, 'minHolders', v_min, 'basis', v_basis));

  return jsonb_build_object('answered', true, 'requirementId', v_id,
    'competencyKey', cmp.competency_key, 'craft', v_craft,
    'workPackageId', v_package, 'minHolders', v_min);
exception when unique_violation then
  return jsonb_build_object('answered', false,
    'refusal', 'that competency is already required at that scope. Retire the existing requirement before restating it.');
end
$$;

revoke all on function public.record_competency_requirement(jsonb) from public, anon;
grant execute on function public.record_competency_requirement(jsonb) to authenticated;

comment on function public.record_competency_requirement(jsonb) is
  'D7.03: records what a role or a package requires. ADMITS ai_admin — stating that a confined-space entry needs an entrant ticket is evidence assembly, the half §70 leaves to the machine. Declaring a PERSON to hold it is the human act and is walled at member_competencies.verified_by.';

create or replace function public.retire_competency_requirement(
  p_requirement_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  rq competency_requirements%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'retiring a competency requirement requires a planning, supervisory or governance role');
  end if;
  select * into rq from competency_requirements
   where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'competency requirement not found');
  end if;
  if rq.retired_at is not null then
    return jsonb_build_object('answered', false,
      'refusal', format('Requirement %s was already retired on %s.', rq.id, rq.retired_at::date));
  end if;
  if length(v_reason) < 20 then
    return jsonb_build_object('answered', false,
      'refusal', 'retiring a requirement states why, in at least 20 characters. A qualification that stops being required without a reason is one somebody will re-argue at the next incident.');
  end if;

  update competency_requirements
     set retired_by = auth.uid(), retired_at = now(), retirement_reason = v_reason
   where id = rq.id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'competency_requirement', coalesce(v_role, 'system'),
    jsonb_build_object('requirementId', rq.id, 'act', 'retire'),
    jsonb_build_object('retired', false, 'minHolders', rq.min_holders),
    jsonb_build_object('retired', true, 'reason', v_reason));

  return jsonb_build_object('answered', true, 'requirementId', rq.id, 'retired', true);
end
$$;

revoke all on function public.retire_competency_requirement(bigint, text) from public, anon;
grant execute on function public.retire_competency_requirement(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE JOINING CALCULATION (D7.04).
--
--    roster × unexpired-AT-THE-WINDOW competency × required competency.
--    All three inputs were already live; nothing joined them.
-- ---------------------------------------------------------------------------
create or replace function public.get_competency_readiness(
  p_package_id bigint,
  p_window_start date default null,
  p_window_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  p work_packages%rowtype;
  v_start date;
  v_end date;
  v_crafts text[];
  v_work int;
  v_reqs int;
  v_items jsonb := '[]'::jsonb;
  v_short int := 0;
  v_expiring int := 0;
  v_met int := 0;
  v_no_roster int := 0;
  v_rostered_members int;
  v_candidates int := 0;
  v_scope_rostered int := 0;
  v_refusals jsonb := '[]'::jsonb;
  r record;
  v_holders jsonb;
  v_qualified int;
  v_rostered int;
  v_expiring_here int;
  v_state text;
  v_rules jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;

  -- ── THE WINDOW. "Qualified when needed" has no answer when nothing says
  --    when. A package with no required-by date and no window supplied is
  --    refused rather than answered against today, because answering against
  --    today is exactly the defect this row exists to close.
  v_start := coalesce(p_window_start, current_date);
  v_end := coalesce(p_window_end, p.required_by);
  if v_end is null then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'refusal', format('Work package %s carries no required-by date and none was supplied, so "qualified WHEN NEEDED" has no "when". Answering against today would report a crew whose tickets lapse before the work as available, which is the reading spec I.23 exists to prevent.', p.package_code));
  end if;
  if v_end <= v_start then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'refusal', format('The work window for %s ends on or before it starts (%s to %s). A window of no days has nobody working in it.', p.package_code, v_start, v_end));
  end if;

  select count(*) into v_work from work_package_work where work_package_id = p.id;
  if v_work = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'windowStart', v_start, 'windowEnd', v_end,
      'refusal', format('Work package %s contains no work orders, so there is no craft demand to qualify anybody against. An empty package is not a fully qualified one.', p.package_code));
  end if;

  -- The crafts this package's work actually needs, from the job plan steps
  -- and the work-order tasks — the two places craft is recorded.
  select coalesce(array_agg(distinct c), '{}'::text[]) into v_crafts
    from (
      select nullif(btrim(s.craft), '') as c
        from work_package_work ww
        join work_orders w on w.id = ww.work_order_id
        join job_plan_steps s on s.job_plan_id = w.job_plan_id
       where ww.work_package_id = p.id and w.organization_id = v_org
      union
      select nullif(btrim(t.craft), '') as c
        from work_package_work ww
        join work_order_tasks t on t.work_order_id = ww.work_order_id
       where ww.work_package_id = p.id
    ) x
   where c is not null;

  -- Requirements in scope: this package's own, plus every standing craft
  -- requirement for a craft this package's work needs.
  select count(*) into v_reqs
    from competency_requirements rq
   where rq.organization_id = v_org and rq.retired_at is null
     and (rq.work_package_id = p.id
       or (rq.craft is not null and rq.craft = any(v_crafts)));

  -- REFUSAL: nothing required. UNASSESSED is not "everybody is qualified",
  -- and the two are indistinguishable on a screen that reports 100%.
  if v_reqs = 0 then
    return jsonb_build_object('answered', false, 'packageCode', p.package_code,
      'windowStart', v_start, 'windowEnd', v_end,
      'workOrders', v_work,
      'craftsRequired', to_jsonb(v_crafts),
      'requirementsInScope', 0,
      'refusal', format('No competency requirement is recorded for work package %s or for any of the craft(s) its work needs (%s). That is UNASSESSED — it is not "every competency is held", and a readiness figure computed over an empty requirement set would report a fully qualified crew for a job nobody has stated the qualifications for.',
        p.package_code,
        case when coalesce(array_length(v_crafts, 1), 0) = 0
          then 'none recorded' else array_to_string(v_crafts, ', ') end));
  end if;

  -- Is there a roster covering this window at all, ANYWHERE in the
  -- organization? Kept as CONTEXT only. It is not the per-requirement test:
  -- see the two counts computed inside the loop, and the comment there.
  select count(distinct sa.member_id) into v_rostered_members
    from shift_assignments sa
    join workforce_members wm on wm.id = sa.member_id
   where sa.organization_id = v_org and wm.active
     and sa.starts_at < (v_end + 1)::timestamptz
     and sa.ends_at > v_start::timestamptz
     and sa.shift_kind <> 'leave';

  for r in
    select rq.id, rq.competency_id, rq.craft, rq.work_package_id, rq.min_holders,
           rq.basis, c.competency_key, c.title, c.is_statutory, c.validity_months
      from competency_requirements rq
      join competencies c on c.id = rq.competency_id
     where rq.organization_id = v_org and rq.retired_at is null
       and (rq.work_package_id = p.id
         or (rq.craft is not null and rq.craft = any(v_crafts)))
     order by c.is_statutory desc, c.competency_key, rq.id
  loop
    -- Every candidate: a member of the required craft (or any member, where
    -- the requirement is package-anchored), with their holding of this
    -- competency classified in the FUTURE TENSE and their roster position in
    -- the window read beside it.
    select coalesce(jsonb_agg(jsonb_build_object(
             'memberId', h.member_id,
             -- The HOLDING's id, so the screen that detects the
             -- expiring-certificate flip can offer the renewal that fixes it
             -- rather than only naming the problem.
             'memberCompetencyId', h.member_competency_id,
             'displayName', h.display_name,
             'craft', h.craft,
             'expiresOn', h.expires_on,
             'whenNeeded', h.when_needed,
             'rosteredHoursInWindow', h.rostered_hours,
             'rostered', h.rostered_hours > 0,
             'qualifiedWhenNeeded', h.when_needed = 'qualified_through')
             order by (h.when_needed = 'qualified_through') desc,
                      h.rostered_hours desc, h.display_name), '[]'::jsonb),
           count(*) filter (where h.when_needed = 'qualified_through'),
           count(*) filter (where h.when_needed = 'qualified_through' and h.rostered_hours > 0),
           count(*) filter (where h.when_needed = 'expires_during_window')
      into v_holders, v_qualified, v_rostered, v_expiring_here
      from (
        select wm.id as member_id, mc.id as member_competency_id,
               wm.display_name, wm.craft, mc.expires_on,
               sync_competency_when_needed(mc.id is not null, mc.expires_on, v_start, v_end)
                 as when_needed,
               coalesce((
                 select sum(extract(epoch from (least(sa.ends_at, (v_end + 1)::timestamptz)
                                              - greatest(sa.starts_at, v_start::timestamptz))) / 3600.0)
                   from shift_assignments sa
                  where sa.member_id = wm.id
                    and sa.organization_id = v_org
                    and sa.shift_kind <> 'leave'
                    and sa.starts_at < (v_end + 1)::timestamptz
                    and sa.ends_at > v_start::timestamptz), 0) as rostered_hours
          from workforce_members wm
          left join member_competencies mc
            on mc.member_id = wm.id and mc.competency_id = r.competency_id
         where wm.organization_id = v_org and wm.active
           and (r.craft is null or wm.craft = r.craft)
      ) h;

    -- ── THE ROSTER TEST IS SCOPED TO THE REQUIREMENT, not to the whole
    --    organization.
    --
    --    The first draft fired `roster_not_recorded` only when NOBODY in the
    --    organization was rostered in the window, while the candidate set `h`
    --    above is scoped to the requirement's own craft. So an organization
    --    with two rostered mechanics and a requirement against an electrical
    --    craft that has NO workforce members at all reported `short` —
    --    "0 of 1 required holder(s) are qualified through … and rostered" —
    --    which says "we looked and nobody qualifies" about a craft nobody has
    --    entered into the system. That is the exact conflation this slice
    --    refuses everywhere else: not assessed and assessed-and-zero are
    --    opposite facts.
    --
    --    Two counts, because they are two different facts and a reader can act
    --    on each differently: nobody of this craft EXISTS, versus they exist
    --    and none of them is rostered in this window.
    v_candidates := jsonb_array_length(v_holders);
    select count(*) into v_scope_rostered
      from jsonb_array_elements(v_holders) x
     where (x->>'rostered')::boolean;

    v_state := case
      when v_candidates = 0 then 'craft_not_staffed'
      when v_scope_rostered = 0 then 'roster_not_recorded'
      when v_rostered >= r.min_holders then 'met'
      when v_qualified >= r.min_holders then 'qualified_but_not_rostered'
      else 'short' end;

    if v_state = 'met' then v_met := v_met + 1;
    elsif v_state in ('roster_not_recorded', 'craft_not_staffed') then
      v_no_roster := v_no_roster + 1;
    else v_short := v_short + 1;
    end if;
    v_expiring := v_expiring + v_expiring_here;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'requirementId', r.id,
      'competencyKey', r.competency_key,
      'competencyTitle', r.title,
      'isStatutory', r.is_statutory,
      'validityMonths', r.validity_months,
      'scope', case when r.work_package_id is not null then 'package' else 'craft' end,
      'craft', r.craft,
      'minHolders', r.min_holders,
      'holdersQualifiedWhenNeeded', v_qualified,
      'holdersQualifiedAndRostered', v_rostered,
      'holdersExpiringInWindow', v_expiring_here,
      'basis', r.basis,
      'state', v_state,
      'holders', v_holders,
      'candidatesInScope', v_candidates,
      'candidatesRostered', v_scope_rostered,
      'detail', case v_state
        when 'craft_not_staffed' then
          format('Not assessable: NO workforce member is recorded%s at all, so there is nobody whose qualification could be checked. This is not "nobody qualifies" — it is a craft the organization has not entered.',
            case when r.craft is null then '' else format(' for craft "%s"', r.craft) end)
        when 'roster_not_recorded' then
          format('Not assessable: %s workforce member(s)%s exist, and NONE of them is rostered between %s and %s, so nothing can say who is available when the work happens. This is not "nobody is available".',
            v_candidates,
            case when r.craft is null then '' else format(' of craft "%s"', r.craft) end,
            v_start, v_end)
        when 'met' then
          format('%s of %s required holder(s) of "%s" are qualified THROUGH %s and rostered in the window.',
            v_rostered, r.min_holders, r.title, v_end)
        when 'qualified_but_not_rostered' then
          format('%s person(s) hold "%s" through %s, but only %s of the %s required are rostered in the window. Qualified is not the same as available.',
            v_qualified, r.title, v_end, v_rostered, r.min_holders)
        else
          format('SHORT: %s of %s required holder(s) of "%s" are qualified through %s and rostered%s.',
            v_rostered, r.min_holders, r.title, v_end,
            case when v_expiring_here > 0
              then format(', and %s further holder(s) lapse INSIDE the window — qualified today, not qualified when the work happens', v_expiring_here)
              else '' end) end));
  end loop;

  if v_expiring > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s competency holding(s) expire between %s and %s. Those holders are qualified TODAY and not qualified WHEN THE WORK HAPPENS, and they are excluded from every count above.', v_expiring, v_start, v_end),
      'scope', 'competency'));
  end if;
  if v_no_roster > 0 then
    v_refusals := v_refusals || jsonb_build_array(jsonb_build_object(
      'reason', format('%s requirement(s) are NOT ASSESSABLE — either no workforce member of the required craft is recorded at all, or none of the ones that are is rostered in the window. They are neither met nor short, and each one says which of the two it is.', v_no_roster),
      'scope', 'roster'));
  end if;

  -- The labour rules that bound the roster (E6.07). Reported, not applied:
  -- this calculation says who is qualified and rostered, and the rules say
  -- what the roster may not do. Silently dropping an over-limit member here
  -- would be a second fatigue engine.
  select coalesce(jsonb_agg(jsonb_build_object(
           'ruleKey', rule_key, 'title', title, 'source', source,
           'limitKind', limit_kind, 'limitValue', limit_value,
           'appliesToCraft', applies_to_craft) order by rule_key), '[]'::jsonb)
    into v_rules
    from labour_rules
   where organization_id = v_org
     and (applies_to_craft is null or applies_to_craft = any(v_crafts));

  return jsonb_build_object(
    'answered', true,
    'packageId', p.id,
    'packageCode', p.package_code,
    'windowStart', v_start,
    'windowEnd', v_end,
    'windowFrom', case when p_window_end is null then 'the package''s required-by date' else 'the caller''s window' end,
    'workOrders', v_work,
    'craftsRequired', to_jsonb(v_crafts),
    'requirementsInScope', v_reqs,
    'requirementsMet', v_met,
    'requirementsShort', v_short,
    'requirementsNotAssessable', v_no_roster,
    'holdingsExpiringInWindow', v_expiring,
    'rosteredMembersInWindow', v_rostered_members,
    'rosteredMembersNote', 'Organization-wide context. The NOT-ASSESSABLE test is per requirement and scoped to that requirement''s own craft: see candidatesInScope and candidatesRostered on each row.',
    'labourRules', v_rules,
    'requirements', v_items,
    'refusals', v_refusals,
    'readyToCrew', v_short = 0 and v_no_roster = 0,
    'basis', 'Required competency × the availability record × the roster, all asked about the WORK WINDOW rather than about today. A holding that lapses inside the window makes its holder NOT qualified when needed and is excluded from every count. Labour rules are reported beside the answer, not applied to it — what the roster may not do is the fatigue engine''s question, not this one''s.');
end
$$;

revoke all on function public.get_competency_readiness(bigint, date, date) from public, anon;
grant execute on function public.get_competency_readiness(bigint, date, date) to authenticated;

comment on function public.get_competency_readiness(bigint, date, date) is
  'D7.04 (spec I.23): "14 QUALIFIED people available WHEN NEEDED" — the joining calculation over the roster, the availability record and the requirement, asked about the work window. Refuses a package with no window (nothing says when), no work (nothing to crew) and no requirement recorded (UNASSESSED is not "everybody is qualified"), and reports a window with no roster as NOT ASSESSABLE rather than as nobody being available.';

-- ---------------------------------------------------------------------------
-- 7. THE RECORDED READINESS. Same predicate, plus a lineage row (D11.29).
--    VOLATILE on purpose: a STABLE function cannot write.
-- ---------------------------------------------------------------------------
create or replace function public.compute_competency_readiness(
  p_package_id bigint,
  p_window_start date default null,
  p_window_end date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  p work_packages%rowtype;
  v_result jsonb;
  v_refusals jsonb := '[]'::jsonb;
  v_run uuid;
  v_method text :=
    'Required competency (craft-scoped and package-scoped) joined to the availability record and to the roster, evaluated against the WORK WINDOW. A holding whose expiry falls inside the window is classified expires_during_window and excluded from the qualified count. Counts and date comparisons only — no competency is inferred from a job title, no expiry is extended, and no roster is generated.';
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  -- ADMITS ai_admin. Gathering the evidence for a readiness position is what
  -- §70 leaves to the machine (RULING 22); DECLARING a person competent is
  -- refused at the database and this call cannot reach it.
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'reliability_engineer',
      'planner', 'supervisor', 'ai_admin') then
    return jsonb_build_object('answered', false,
      'refusal', 'recording a competency readiness position requires a planning, engineering, supervisory or governance role');
  end if;
  select * into p from work_packages where id = p_package_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'work package not found');
  end if;

  v_result := get_competency_readiness(p.id, p_window_start, p_window_end);

  if (v_result->>'answered')::boolean is not true then
    -- A REFUSAL IS RECORDED TOO. "Readiness refused on this date, for this
    -- reason" is a fact about the package; a history that kept only the
    -- answers would show a clean run with the unassessed weeks missing.
    v_refusals := jsonb_build_array(jsonb_build_object(
      'reason', v_result->>'refusal', 'scope', 'package'));
    v_run := record_calculation_run(p.development_case_id, 'competency_readiness',
      v_method,
      jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code,
        'windowStart', p_window_start, 'windowEnd', p_window_end),
      jsonb_build_array(
        jsonb_build_object('table', 'competency_requirements',
          'scope', 'craft or work_package_id = ' || p.id::text),
        jsonb_build_object('table', 'member_competencies', 'scope', 'organization'),
        jsonb_build_object('table', 'shift_assignments', 'scope', 'the work window')),
      null, v_refusals);
    return v_result || jsonb_build_object('calculationRunId', v_run,
      'codeVersion', sync_calculation_code_version('competency_readiness'));
  end if;

  v_refusals := coalesce(v_result->'refusals', '[]'::jsonb);
  v_run := record_calculation_run(p.development_case_id, 'competency_readiness',
    v_method,
    jsonb_build_object('workPackageId', p.id, 'packageCode', p.package_code,
      'windowStart', v_result->'windowStart', 'windowEnd', v_result->'windowEnd',
      'requirementsInScope', v_result->'requirementsInScope',
      'workOrders', v_result->'workOrders'),
    jsonb_build_array(
      jsonb_build_object('table', 'competency_requirements',
        'scope', 'craft or work_package_id = ' || p.id::text),
      jsonb_build_object('table', 'member_competencies', 'scope', 'organization'),
      jsonb_build_object('table', 'shift_assignments', 'scope', 'the work window'),
      jsonb_build_object('table', 'labour_rules', 'scope', 'the crafts this package needs')),
    jsonb_build_object(
      'requirementsMet', v_result->'requirementsMet',
      'requirementsShort', v_result->'requirementsShort',
      'requirementsNotAssessable', v_result->'requirementsNotAssessable',
      'holdingsExpiringInWindow', v_result->'holdingsExpiringInWindow',
      'rosteredMembersInWindow', v_result->'rosteredMembersInWindow',
      'readyToCrew', v_result->'readyToCrew',
      'requirements', v_result->'requirements'),
    v_refusals);

  return v_result || jsonb_build_object('calculationRunId', v_run,
    'codeVersion', sync_calculation_code_version('competency_readiness'),
    'recorded', true,
    'recordNote', 'This readiness position is now a row in calculation_runs. It cannot be edited or deleted by any client, and the next one is recorded BESIDE it rather than over it.');
end
$$;

revoke all on function public.compute_competency_readiness(bigint, date, date) from public, anon;
grant execute on function public.compute_competency_readiness(bigint, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. THE REQUIREMENT LIST, so a screen can show what it is about to check.
-- ---------------------------------------------------------------------------
create or replace function public.get_competency_requirements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_rows jsonb;
  v_comps jsonb;
  v_members jsonb;
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'requirementId', rq.id,
           'competencyId', rq.competency_id,
           'competencyKey', c.competency_key,
           'competencyTitle', c.title,
           'isStatutory', c.is_statutory,
           'validityMonths', c.validity_months,
           'scope', case when rq.work_package_id is not null then 'package' else 'craft' end,
           'craft', rq.craft,
           'workPackageId', rq.work_package_id,
           'packageCode', p.package_code,
           'minHolders', rq.min_holders,
           'basis', rq.basis,
           'retired', rq.retired_at is not null,
           'retiredAt', rq.retired_at,
           'retirementReason', rq.retirement_reason)
           order by c.is_statutory desc, c.competency_key, rq.id), '[]'::jsonb)
    into v_rows
    from competency_requirements rq
    join competencies c on c.id = rq.competency_id
    left join work_packages p on p.id = rq.work_package_id
   where rq.organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
           'competencyId', id, 'competencyKey', competency_key, 'title', title,
           'kind', kind, 'isStatutory', is_statutory,
           'validityMonths', validity_months) order by competency_key), '[]'::jsonb)
    into v_comps
    from competencies where organization_id = v_org;

  -- INACTIVE MEMBERS ARE LISTED, marked, and ordered after the active ones.
  -- The first draft filtered them out entirely, so once somebody was taken off
  -- the roster nothing in the product could put them back on — and the act
  -- that takes them off is new in this slice.
  select coalesce(jsonb_agg(jsonb_build_object(
           'memberId', id, 'displayName', display_name, 'craft', craft,
           'employeeRef', employee_ref, 'active', active)
           order by active desc, display_name), '[]'::jsonb)
    into v_members
    from workforce_members where organization_id = v_org;

  return jsonb_build_object('answered', true, 'requirements', v_rows,
    'competencies', v_comps, 'members', v_members,
    'basis', 'Every competency requirement recorded in this organization, retired ones included and marked as such, beside the competencies and active members a new requirement or holding can name.');
end
$$;

revoke all on function public.get_competency_requirements() from public, anon;
grant execute on function public.get_competency_requirements() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. §70 AT THE DATABASE FOR THE ROSTER ACT.
--
--    The brief's §70 sentence names three acts: no AI or system identity may
--    declare competency, APPROVE A ROSTER, or certify a metric. Two of the
--    three were already walled at the database in this slice —
--    `member_competencies.verified_by` and `resource_demand.approved_by`. The
--    third rested entirely on `record_shift_assignment`'s role list, because
--    `shift_assignments` had NO actor column at all: `enforce_awp_act_is_human`
--    could not be bound to it, and the audit row recorded only a role string.
--    A wall that exists only in one RPC is a wall the next writer walks around.
--
--    OVER-BLOCKING, CHECKED RATHER THAN ASSUMED. `shift_assignments` has
--    exactly two writers in the repository: `20260817093000_demo_workforce.sql`
--    (lines 115 and 121), which names an explicit column list WITHOUT
--    `assigned_by` and therefore passes the wall's NULL-actor early return
--    untouched, and `record_shift_assignment` above, whose role gate already
--    excludes `ai_admin`. The column is nullable with no default for exactly
--    that reason: a seeded or imported roster carries no actor and is not
--    retro-attributed to anybody.
-- ---------------------------------------------------------------------------
alter table public.shift_assignments
  add column if not exists assigned_by uuid references public.user_profiles(id);

comment on column public.shift_assignments.assigned_by is
  '§70: the person who put this member on this shift. NULL where the roster came from a seed or an import — the act was not performed by a named identity and is not attributed to one. Walled by enforce_awp_act_is_human on INSERT and UPDATE, so the AI-operator identity cannot approve a roster through any path into this table.';

drop trigger if exists trg_shift_assignment_actor_human on public.shift_assignments;
create trigger trg_shift_assignment_actor_human
  before insert or update on public.shift_assignments
  for each row execute function public.enforce_awp_act_is_human(
    'assigned_by', 'approve a roster — put a named person on a named shift');

-- ---------------------------------------------------------------------------
-- 10. THE ACTS THE REFUSALS PROMISE.
--
--     Three refusal sentences in this slice instructed the reader to perform
--     an act the product could not perform:
--
--       record_member_competency  "Record the renewal by superseding the
--                                  existing holding rather than adding a
--                                  second one."   — `idx_mc_pair` is UNIQUE on
--                                  (member_id, competency_id) and this RPC was
--                                  the table's only runtime writer, INSERT
--                                  only. D7.04's entire headline is the
--                                  expiring-certificate flip: the product
--                                  detected the lapse and offered no way to
--                                  record the renewal.
--       record_competency_requirement
--                                 "Retire the existing requirement before
--                                  restating it." — `retire_competency_
--                                  requirement` existed and NOTHING in the
--                                  product called it (fixed on the surface, in
--                                  CompetencyReadinessPanel).
--       record_resource_capacity  "Supersede it by closing it with an
--                                  effective-to date"  — closed in part 1 by
--                                  `close_resource_capacity`.
--
--     A refusal that instructs an impossible act is a lie about the product,
--     and it is a worse one than silence because the reader believes there is
--     a path and goes looking for it.
--
--     A leaver is the fourth: `workforce_members.active` drives every
--     readiness answer and could only ever be set at INSERT, so a departed
--     person stayed qualified and rostered forever in a ✅ metric.
-- ---------------------------------------------------------------------------
create or replace function public.renew_member_competency(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  mc member_competencies%rowtype;
  m workforce_members%rowtype;
  cmp competencies%rowtype;
  v_granted date;
  v_expires date;
  v_evidence text := btrim(coalesce(p_payload->>'evidenceReference', ''));
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  -- The SAME role list as the original declaration, and it excludes ai_admin
  -- for the same reason: a renewal IS a declaration of competency. The
  -- database wall on `verified_by` refuses the AI identity again below,
  -- because this UPDATE changes that column.
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'renewing a competency is declaring a person competent, and requires a planning, supervisory or governance role');
  end if;
  select * into mc from member_competencies
   where id = nullif(p_payload->>'memberCompetencyId', '')::bigint
     and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'competency holding not found');
  end if;
  select * into m from workforce_members where id = mc.member_id and organization_id = v_org;
  select * into cmp from competencies where id = mc.competency_id and organization_id = v_org;
  if v_evidence = '' then
    return jsonb_build_object('answered', false,
      'refusal', 'a renewal names its evidence — the new certificate, assessment or authorisation. A renewal with nothing behind it moves an expiry date on an assertion.');
  end if;
  v_granted := coalesce(nullif(p_payload->>'grantedOn', '')::date, current_date);
  v_expires := nullif(p_payload->>'expiresOn', '')::date;
  if v_expires is null and cmp.validity_months is not null then
    v_expires := (v_granted + make_interval(months => cmp.validity_months))::date;
  end if;
  if cmp.validity_months is not null and v_expires is null then
    return jsonb_build_object('answered', false,
      'refusal', format('"%s" has a stated validity period, so a renewal of it has an expiry. Recording one with no expiry would make its holder permanently qualified in every readiness answer.', cmp.title));
  end if;
  if v_expires is not null and v_expires < v_granted then
    return jsonb_build_object('answered', false,
      'refusal', 'a competency cannot expire before it was granted');
  end if;
  -- A RENEWAL MOVES THE DATE FORWARD. Moving it backwards is not a renewal:
  -- it is a correction of a record somebody made, and shortening a validity
  -- silently would take a person off a crew with no trace of who did it.
  if mc.expires_on is not null and v_expires is not null and v_expires < mc.expires_on then
    return jsonb_build_object('answered', false,
      'refusal', format('The existing holding runs to %s and this renewal would end it earlier, on %s. A renewal extends a qualification; shortening one is a correction and this act does not make corrections.',
        mc.expires_on, v_expires));
  end if;

  update member_competencies
     set granted_on = v_granted,
         expires_on = v_expires,
         evidence_reference = v_evidence,
         verified_by = auth.uid()
   where id = mc.id and organization_id = v_org;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'member_competency', coalesce(v_role, 'system'),
    jsonb_build_object('memberCompetencyId', mc.id, 'act', 'renew',
      'memberId', mc.member_id, 'competencyId', mc.competency_id),
    jsonb_build_object('memberRef', m.employee_ref, 'competencyKey', cmp.competency_key,
      'grantedOn', mc.granted_on, 'expiresOn', mc.expires_on,
      'evidenceReference', mc.evidence_reference),
    jsonb_build_object('memberRef', m.employee_ref, 'competencyKey', cmp.competency_key,
      'grantedOn', v_granted, 'expiresOn', v_expires,
      'evidenceReference', v_evidence));

  return jsonb_build_object('answered', true, 'memberCompetencyId', mc.id,
    'memberId', mc.member_id, 'competencyId', mc.competency_id,
    'previousExpiresOn', mc.expires_on,
    'grantedOn', v_granted, 'expiresOn', v_expires,
    'note', format('Superseded in place: this member holds "%s" once, and the holding now runs to %s. The previous dates and evidence are in audit_events as the previous state.',
      cmp.title, coalesce(v_expires::text, 'no stated expiry')));
end
$$;

revoke all on function public.renew_member_competency(jsonb) from public, anon;
grant execute on function public.renew_member_competency(jsonb) to authenticated;

comment on function public.renew_member_competency(jsonb) is
  'D7.03/D7.04: the supersede act `record_member_competency`''s unique-violation refusal instructs. One member holds one competency once (idx_mc_pair), so a renewal moves the existing holding''s dates rather than adding a second row. Declaring competency, so §70-walled on verified_by at the database and excluded from ai_admin at the RPC; refuses a renewal that would SHORTEN a qualification, which is a correction rather than a renewal.';

create or replace function public.set_workforce_member_active(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  m workforce_members%rowtype;
  v_active boolean;
  v_reason text := btrim(coalesce(p_payload->>'reason', ''));
begin
  if v_org is null then
    return jsonb_build_object('answered', false, 'refusal', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin', 'executive', 'maintenance_manager', 'planner', 'supervisor') then
    return jsonb_build_object('answered', false,
      'refusal', 'changing who is on the roster requires a planning, supervisory or governance role');
  end if;
  select * into m from workforce_members
   where id = nullif(p_payload->>'memberId', '')::bigint and organization_id = v_org;
  if not found then
    return jsonb_build_object('answered', false, 'refusal', 'workforce member not found');
  end if;
  if jsonb_typeof(p_payload->'active') <> 'boolean' then
    return jsonb_build_object('answered', false,
      'refusal', 'state whether the member is active as a boolean. There is no default here: guessing would either resurrect a leaver or remove a working person.');
  end if;
  v_active := (p_payload->>'active')::boolean;
  if length(v_reason) < 10 then
    return jsonb_build_object('answered', false,
      'refusal', 'a change to who is on the roster needs a reason of at least 10 characters. Every competency readiness answer counts only active members, so this changes numbers a crew relies on.');
  end if;
  if m.active = v_active then
    return jsonb_build_object('answered', false,
      'refusal', format('%s is already %s.', m.employee_ref,
        case when v_active then 'active' else 'inactive' end));
  end if;

  update workforce_members set active = v_active
   where id = m.id and organization_id = v_org;

  insert into audit_events (organization_id, entity_type, actor, event_data,
                            previous_state, new_state)
  values (v_org, 'workforce_member', coalesce(v_role, 'system'),
    jsonb_build_object('memberId', m.id, 'act', 'set_active', 'reason', v_reason),
    jsonb_build_object('employeeRef', m.employee_ref, 'active', m.active),
    jsonb_build_object('employeeRef', m.employee_ref, 'active', v_active));

  return jsonb_build_object('answered', true, 'memberId', m.id,
    'employeeRef', m.employee_ref, 'active', v_active,
    'note', case when v_active
      then 'Back on the roster. Their holdings are unchanged and are counted again from now.'
      else 'Off the roster. Their competency holdings are RETAINED — a record of what somebody held is not deleted because they left — and they stop counting toward any requirement.' end);
end
$$;

revoke all on function public.set_workforce_member_active(jsonb) from public, anon;
grant execute on function public.set_workforce_member_active(jsonb) to authenticated;

comment on function public.set_workforce_member_active(jsonb) is
  'D7.03: the leaver act. workforce_members.active gates every competency readiness count and could previously only be set at INSERT, so a departed person stayed qualified and rostered forever in a metric. Requires a stated reason, refuses a no-op, and RETAINS the person''s holdings rather than deleting the record of what they held.';

notify pgrst, 'reload schema';
