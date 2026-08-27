-- ============================================================================
-- Sync Develop Slice 1 — DevelopmentCase, the root object (D1.04), with its
-- §70 prohibition ON THE DAY IT EXISTS (D11.24).
--
-- Intake is PROBLEM-FIRST (D1.05 / spec workflow 1): the entry point captures
-- a problem/opportunity statement, never a cold "Create Project". The intake
-- RPC refuses a case whose problem statement is missing or token-thin.
--
-- SANCTION IS A §70 DETERMINATION. "Project sanctioned" may never be
-- computed, inferred, or asserted by a client write. The trigger below is the
-- structural half of that promise: the sanction columns and the 'sanctioned'
-- status are writable ONLY through sanction_development_case
-- (20261101090500), which checks a NEW 'sanction' action_type on the adopted
-- authority_limits ladder. The trigger follows the post-fix engineering-
-- signature pattern (20261005090300): SECURITY INVOKER so current_user is
-- real; transaction-local marker so only the sanctioned path passes; NULL-
-- role-safe; no silent overwrite; the service path admitted AND audited into
-- security_events rather than refused into uselessness.
--
-- Canonical reuse and references (overlap-map §13): capital_projects stays
-- the delivery-side record — a case REFERENCES it (capital_project_id), its
-- fields are not duplicated. risk_objectives stays the ONE Objective store —
-- objective_id references it. lifecycle_stages stays the ONE stage
-- vocabulary — current_stage_key references it (ruling 2). Additive.
-- ============================================================================

create table if not exists public.development_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  sponsor_id uuid references auth.users(id),
  business_unit text,
  site_id uuid references sites(id) on delete set null,
  -- Ruling 2: the case's stage position IS a canonical stage_key.
  current_stage_key text references lifecycle_stages(stage_key),
  framework_id uuid references project_frameworks(id) on delete set null,
  lifecycle_type text not null check (lifecycle_type in
    ('greenfield','brownfield','sustaining_capital','replacement',
     'reliability_improvement','regulatory','capacity','life_extension',
     'decommissioning')),
  -- Problem-first: the statement is NOT NULL at the schema, and the intake
  -- RPC additionally refuses statements under 20 characters.
  problem_statement text not null check (btrim(problem_statement) <> ''),
  opportunity_statement text,
  -- Reuse, not duplication: the ONE Objective store (D11.15 ruling).
  objective_id uuid references risk_objectives(id) on delete set null,
  -- Reuse, not duplication: the delivery-side capital project record.
  capital_project_id bigint references capital_projects(id) on delete set null,
  estimated_capex numeric check (estimated_capex is null or estimated_capex >= 0),
  expected_value numeric,
  status text not null default 'active' check (status in
    ('active','on_hold','sanctioned','cancelled','completed')),
  -- The §70-protected sanction record. Written only by the sanctioned path.
  sanctioned_by uuid references auth.users(id),
  sanctioned_at timestamptz,
  sanctioned_value numeric check (sanctioned_value is null or sanctioned_value >= 0),
  sanction_note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A sanctioned case carries its sanction record; a record cannot appear
  -- without the status, nor the status without the record.
  check (
    (status = 'sanctioned') = (sanctioned_at is not null)
  )
);

create index if not exists idx_development_cases_org
  on development_cases(organization_id, status, created_at desc);
create index if not exists idx_development_cases_framework
  on development_cases(framework_id) where framework_id is not null;

alter table public.development_cases enable row level security;
drop policy if exists development_cases_read on public.development_cases;
create policy development_cases_read on public.development_cases
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The §70 prohibition trigger — day one, before any RPC exists.
--
-- SECURITY INVOKER on purpose: a DEFINER trigger reports its own owner as
-- current_user whoever fired it, which would make the client-role check a
-- tautology (20261005090100's argument, kept).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_development_sanction_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.development_sanction_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.status = 'sanctioned'
              or new.sanctioned_by is not null
              or new.sanctioned_at is not null
              or new.sanctioned_value is not null
              or nullif(btrim(coalesce(new.sanction_note, '')), '') is not null;
  else
    v_changed := (new.status is distinct from old.status
                  and (new.status = 'sanctioned' or old.status = 'sanctioned'))
              or new.sanctioned_by is distinct from old.sanctioned_by
              or new.sanctioned_at is distinct from old.sanctioned_at
              or new.sanctioned_value is distinct from old.sanctioned_value
              or new.sanction_note is distinct from old.sanction_note;
  end if;

  if not v_changed then
    return new;
  end if;

  -- The audited service path (restore, backfill, correction). Refusing the
  -- service key buys nothing — a holder can disable the trigger — so the
  -- honest posture is admit-and-record (20261005090300 §1's argument).
  if not v_client and current_user not in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (new.organization_id, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Sanction record on development case ' || new.id::text
           || ' written by a service caller, bypassing sanction_development_case(). Was '
           || coalesce(old.status, 'none') || ', now ' || coalesce(new.status, 'none') || '.');
    end if;
    return new;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Project sanction is a deterministic human determination (spec §70). It cannot '
      'be written directly: call sanction_development_case(case_id, note, value), '
      'which verifies the caller holds an ADOPTED sanction authority under the '
      'delegation-of-authority ladder and records the act. A sanction asserted by '
      'an unchecked write is not a sanction.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end
$$;

drop trigger if exists trg_development_sanction_provenance on public.development_cases;
create trigger trg_development_sanction_provenance
  before insert or update on public.development_cases
  for each row execute function public.enforce_development_sanction_provenance();

-- ---------------------------------------------------------------------------
-- Problem-first intake (D1.05). The only client write path into the table.
-- ---------------------------------------------------------------------------
create or replace function public.create_development_case(
  p_title text,
  p_problem_statement text,
  p_lifecycle_type text,
  p_opportunity_statement text default null,
  p_framework_id uuid default null,
  p_site_id uuid default null,
  p_business_unit text default null,
  p_estimated_capex numeric default null,
  p_expected_value numeric default null,
  p_objective_id uuid default null,
  p_sponsor_id uuid default null
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
  v_stage text;
  f project_frameworks%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'creating a development case requires a planning, engineering or governance role');
  end if;
  -- PROBLEM-FIRST. This is the rule that makes intake an act of framing
  -- rather than a cold "Create Project".
  if coalesce(length(trim(p_problem_statement)), 0) < 20 then
    return jsonb_build_object('error',
      'a development case begins with the problem, not the project: state the problem or opportunity being addressed (20 characters minimum)');
  end if;
  if coalesce(length(trim(p_title)), 0) < 3 then
    return jsonb_build_object('error', 'a case needs a title (3 characters minimum)');
  end if;
  if p_lifecycle_type not in
     ('greenfield','brownfield','sustaining_capital','replacement',
      'reliability_improvement','regulatory','capacity','life_extension','decommissioning') then
    return jsonb_build_object('error', 'lifecycle_type must be one of the nine spec §3 values');
  end if;
  if p_estimated_capex is not null and p_estimated_capex < 0 then
    return jsonb_build_object('error', 'estimated_capex cannot be negative');
  end if;

  v_stage := 'need_identification';
  if p_framework_id is not null then
    select * into f from project_frameworks
    where id = p_framework_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'framework not found in this organization');
    end if;
    if f.status <> 'adopted' then
      return jsonb_build_object('error',
        'a draft framework cannot govern a case — adopt it first (adopt_project_framework)');
    end if;
    select stage_key into v_stage from project_framework_stages
    where framework_id = f.id order by sequence asc limit 1;
    if v_stage is null then
      return jsonb_build_object('error', 'the selected framework has no stages');
    end if;
  end if;

  if p_site_id is not null and not exists
     (select 1 from sites where id = p_site_id and organization_id = v_org) then
    return jsonb_build_object('error', 'site not found in this organization');
  end if;
  if p_objective_id is not null and not exists
     (select 1 from risk_objectives where id = p_objective_id and organization_id = v_org) then
    return jsonb_build_object('error', 'objective not found in this organization');
  end if;

  insert into development_cases
    (organization_id, title, sponsor_id, business_unit, site_id,
     current_stage_key, framework_id, lifecycle_type, problem_statement,
     opportunity_statement, objective_id, estimated_capex, expected_value,
     status, created_by)
  values
    (v_org, trim(p_title), coalesce(p_sponsor_id, auth.uid()),
     nullif(trim(coalesce(p_business_unit, '')), ''), p_site_id,
     v_stage, p_framework_id, p_lifecycle_type, trim(p_problem_statement),
     nullif(trim(coalesce(p_opportunity_statement, '')), ''), p_objective_id,
     p_estimated_capex, p_expected_value, 'active', auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_case', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', v_id, 'action', 'created',
      'lifecycle_type', p_lifecycle_type, 'stage', v_stage,
      'framework_id', p_framework_id));

  return jsonb_build_object('case_id', v_id, 'current_stage_key', v_stage, 'status', 'active');
end
$$;

revoke all on function public.create_development_case(text, text, text, text, uuid, uuid, text, numeric, numeric, uuid, uuid) from public, anon;
grant execute on function public.create_development_case(text, text, text, text, uuid, uuid, text, numeric, numeric, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
