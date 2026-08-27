-- ============================================================================
-- Sync Develop Slice 1 — ProjectFramework as data (D3.01 / D3.22 / D3.37).
--
-- Framework-as-data: an organization's stage-gate model is CONFIGURATION,
-- versioned and human-adopted, never hard-coded. The versioning discipline is
-- copied from risk_criteria_profiles + adopt_risk_criteria (20260921110101):
-- draft → adopted → superseded, prior versions immutable, adoption is an act
-- of authority with a recorded basis.
--
-- THE TWO RULINGS THIS FILE IS BUILT UNDER (overlap-map.md, binding):
--
--   Ruling 2 — stage vocabulary. project_framework_stages MAP onto
--   lifecycle_stages.stage_key (the canonical vocabulary, extended in
--   20261101090000). A framework renames and orders stages for its tenant;
--   it never mints a second answer to "what stage is this in".
--
--   Ruling 1 / D3.37 — checkpoints. The spec's PART I calls ProjectFramework
--   members "stages/gates/checkpoints"; its §4 HAS-list omits checkpoints.
--   Resolved explicitly here: a checkpoint is a LIGHTER GATE ROW on the same
--   gate family — stage_gates.decision_type = 'checkpoint' — advisory unless
--   one of its criteria is mandatory. No parallel checkpoint table exists or
--   may be created.
--
-- Write model: SELECT is org-scoped RLS; every write goes through a
-- SECURITY DEFINER RPC that names the tenant from the session and the role
-- from user_profiles. No client write policy exists on any of these tables.
--
-- Canonical reuse: lifecycle_stages, app_current_org(), user_profiles,
-- audit_events. Additive.
-- ============================================================================

create table if not exists public.project_frameworks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  version int not null default 1 check (version > 0),
  -- Where this framework's content came from, as prose a reviewer can check.
  source text not null,
  -- The provenance TIER of the framework itself (register standing
  -- constraint 1). Seeded reference profiles are INDUSTRY_GUIDANCE; a
  -- customer's own adopted model is PROJECT_FRAMEWORK or CORPORATE_STANDARD
  -- when configured from that customer's authoritative documents.
  source_authority text not null default 'INDUSTRY_GUIDANCE' check (source_authority in
    ('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT',
     'INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION')),
  status text not null default 'draft' check (status in ('draft','adopted','superseded')),
  effective_date date,
  -- Applicability classes the tailoring compiler (Slice 3) will select on,
  -- e.g. ["major_project","sustaining_capital"]. Data, not behaviour, today.
  project_classes jsonb not null default '[]'::jsonb,
  basis text not null,
  adopted_by uuid references auth.users(id),
  adopted_at timestamptz,
  superseded_by uuid references project_frameworks(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(project_classes) = 'array')
);

create unique index if not exists idx_project_frameworks_name_version
  on project_frameworks(organization_id, name, version);
create index if not exists idx_project_frameworks_active
  on project_frameworks(organization_id, status);

alter table public.project_frameworks enable row level security;
drop policy if exists project_frameworks_read on public.project_frameworks;
create policy project_frameworks_read on public.project_frameworks
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Framework stages: a NAMING AND ORDERING of canonical stage_keys (ruling 2).
-- ---------------------------------------------------------------------------
create table if not exists public.project_framework_stages (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  framework_id uuid not null references project_frameworks(id) on delete cascade,
  -- The canonical vocabulary. Never a free-text stage name standing alone.
  stage_key text not null references lifecycle_stages(stage_key),
  sequence int not null check (sequence > 0),
  -- What THIS framework calls the stage ("Identify", "DBM", "FEL-2"...).
  display_name text not null,
  purpose text,
  entry_criteria text,
  exit_criteria text,
  created_at timestamptz not null default now(),
  unique (framework_id, stage_key),
  unique (framework_id, sequence)
);

create index if not exists idx_pfs_framework on project_framework_stages(framework_id, sequence);

alter table public.project_framework_stages enable row level security;
drop policy if exists project_framework_stages_read on public.project_framework_stages;
create policy project_framework_stages_read on public.project_framework_stages
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Gates — the gate IDENTITY object the stage_gate_* family has never had.
-- A gate (or checkpoint — same family, lighter row) belongs to a framework
-- stage; the composite FK guarantees the stage really is a member of that
-- framework. Criteria attach to gates via stage_gate_criteria.gate_id
-- (20261101090300) — the SAME criteria table the asset gates use, because
-- ruling 1 forbids a parallel requirement store.
-- ---------------------------------------------------------------------------
create table if not exists public.stage_gates (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  framework_id uuid not null references project_frameworks(id) on delete cascade,
  stage_key text not null references lifecycle_stages(stage_key),
  name text not null,
  sequence int not null default 1 check (sequence > 0),
  -- D3.37: a checkpoint is a lighter row on THIS table, not a parallel one.
  decision_type text not null default 'gate' check (decision_type in ('gate','checkpoint')),
  risk_threshold text,
  -- Percentage 0–100. Advisory display threshold; a failed MANDATORY
  -- criterion blocks at ANY percentage (D3.35 discipline, assessGate).
  readiness_threshold numeric check
    (readiness_threshold is null or (readiness_threshold >= 0 and readiness_threshold <= 100)),
  independent_assurance_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (framework_id, stage_key, name),
  foreign key (framework_id, stage_key)
    references project_framework_stages(framework_id, stage_key) on delete cascade
);

create index if not exists idx_stage_gates_framework on stage_gates(framework_id, stage_key, sequence);

alter table public.stage_gates enable row level security;
drop policy if exists stage_gates_read on public.stage_gates;
create policy stage_gates_read on public.stage_gates
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Authoring RPCs. Draft frameworks only; an adopted version is immutable —
-- change arrives as a new version (create_project_framework_version lands
-- with the requirement columns in 20261101090400, so a clone can carry
-- requirement provenance with it).
-- ---------------------------------------------------------------------------
create or replace function public.create_project_framework(
  p_name text,
  p_source text,
  p_source_authority text default 'INDUSTRY_GUIDANCE',
  p_basis text default null,
  p_project_classes jsonb default '[]'::jsonb
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
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring a project framework requires a governance or engineering role');
  end if;
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'a framework needs a name (3 characters minimum)');
  end if;
  if coalesce(length(trim(p_source)), 0) < 10 then
    return jsonb_build_object('error', 'state where this framework''s content comes from (10 characters minimum)');
  end if;
  if p_source_authority not in ('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT','INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION') then
    return jsonb_build_object('error', 'source_authority must be one of the eight provenance tiers');
  end if;
  -- A framework claiming corporate/regulatory/legal authority must name the
  -- instrument it derives from; a bare label at those tiers is an invented
  -- corporate requirement (register standing constraint 1).
  if p_source_authority in ('LAW','REGULATION','CORPORATE_STANDARD','CONTRACT')
     and coalesce(length(trim(p_basis)), 0) < 30 then
    return jsonb_build_object('error',
      'a framework at the ' || p_source_authority || ' tier must name the authoritative instrument it derives from in basis (30 characters minimum)');
  end if;
  if coalesce(length(trim(p_basis)), 0) < 10 then
    return jsonb_build_object('error', 'record the basis for this framework (10 characters minimum)');
  end if;
  if p_project_classes is null or jsonb_typeof(p_project_classes) <> 'array' then
    return jsonb_build_object('error', 'project_classes must be a json array');
  end if;
  if exists (select 1 from project_frameworks
             where organization_id = v_org and name = trim(p_name) and status = 'draft') then
    return jsonb_build_object('error', 'a draft of that framework already exists — edit or adopt it first');
  end if;

  insert into project_frameworks
    (organization_id, name, version, source, source_authority, status,
     project_classes, basis, created_by)
  values
    (v_org, trim(p_name),
     coalesce((select max(version) from project_frameworks
               where organization_id = v_org and name = trim(p_name)), 0) + 1,
     trim(p_source), p_source_authority, 'draft',
     p_project_classes, trim(p_basis), auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('framework_id', v_id, 'action', 'created', 'name', trim(p_name),
      'source_authority', p_source_authority, 'status', 'draft'));

  return jsonb_build_object('framework_id', v_id, 'status', 'draft', 'adoption_required', true);
end
$$;

revoke all on function public.create_project_framework(text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_project_framework(text, text, text, text, jsonb) to authenticated, service_role;

create or replace function public.add_framework_stage(
  p_framework_id uuid,
  p_stage_key text,
  p_sequence int,
  p_display_name text,
  p_purpose text default null,
  p_entry_criteria text default null,
  p_exit_criteria text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f project_frameworks%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring a project framework requires a governance or engineering role');
  end if;
  select * into f from project_frameworks where id = p_framework_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'framework not found');
  end if;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      'an adopted framework version is immutable — create a new version to change its stages');
  end if;
  if not exists (select 1 from lifecycle_stages where stage_key = p_stage_key) then
    return jsonb_build_object('error',
      'unknown stage_key "' || coalesce(p_stage_key, '') || '" — framework stages map onto the canonical lifecycle_stages vocabulary');
  end if;
  if coalesce(length(trim(p_display_name)), 0) < 2 then
    return jsonb_build_object('error', 'the framework''s display name for this stage is required');
  end if;
  if p_sequence is null or p_sequence < 1 then
    return jsonb_build_object('error', 'sequence must be a positive integer');
  end if;

  insert into project_framework_stages
    (organization_id, framework_id, stage_key, sequence, display_name, purpose, entry_criteria, exit_criteria)
  values
    (v_org, f.id, p_stage_key, p_sequence, trim(p_display_name), p_purpose, p_entry_criteria, p_exit_criteria)
  on conflict (framework_id, stage_key) do update set
    sequence = excluded.sequence,
    display_name = excluded.display_name,
    purpose = excluded.purpose,
    entry_criteria = excluded.entry_criteria,
    exit_criteria = excluded.exit_criteria
  returning id into v_id;

  return jsonb_build_object('framework_stage_id', v_id, 'stage_key', p_stage_key);
end
$$;

revoke all on function public.add_framework_stage(uuid, text, int, text, text, text, text) from public, anon;
grant execute on function public.add_framework_stage(uuid, text, int, text, text, text, text) to authenticated, service_role;

create or replace function public.add_framework_gate(
  p_framework_id uuid,
  p_stage_key text,
  p_name text,
  p_sequence int default 1,
  p_decision_type text default 'gate',
  p_readiness_threshold numeric default null,
  p_independent_assurance_required boolean default false,
  p_risk_threshold text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  f project_frameworks%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring a project framework requires a governance or engineering role');
  end if;
  select * into f from project_frameworks where id = p_framework_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'framework not found');
  end if;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      'an adopted framework version is immutable — create a new version to change its gates');
  end if;
  if p_decision_type not in ('gate','checkpoint') then
    return jsonb_build_object('error', 'decision_type must be gate or checkpoint (D3.37: a checkpoint is a lighter gate row, not a separate object)');
  end if;
  if coalesce(length(trim(p_name)), 0) < 2 then
    return jsonb_build_object('error', 'a gate needs a name');
  end if;
  if not exists (select 1 from project_framework_stages
                 where framework_id = f.id and stage_key = p_stage_key) then
    return jsonb_build_object('error',
      'stage "' || coalesce(p_stage_key, '') || '" is not a member of this framework — add the stage first');
  end if;
  if p_readiness_threshold is not null and (p_readiness_threshold < 0 or p_readiness_threshold > 100) then
    return jsonb_build_object('error', 'readiness_threshold is a percentage (0–100)');
  end if;

  insert into stage_gates
    (organization_id, framework_id, stage_key, name, sequence, decision_type,
     risk_threshold, readiness_threshold, independent_assurance_required)
  values
    (v_org, f.id, p_stage_key, trim(p_name), coalesce(p_sequence, 1), p_decision_type,
     p_risk_threshold, p_readiness_threshold, coalesce(p_independent_assurance_required, false))
  on conflict (framework_id, stage_key, name) do update set
    sequence = excluded.sequence,
    decision_type = excluded.decision_type,
    risk_threshold = excluded.risk_threshold,
    readiness_threshold = excluded.readiness_threshold,
    independent_assurance_required = excluded.independent_assurance_required
  returning id into v_id;

  return jsonb_build_object('gate_id', v_id, 'decision_type', p_decision_type);
end
$$;

revoke all on function public.add_framework_gate(uuid, text, text, int, text, numeric, boolean, text) from public, anon;
grant execute on function public.add_framework_gate(uuid, text, text, int, text, numeric, boolean, text) to authenticated, service_role;

-- Adoption: the act of authority. Copies adopt_risk_criteria's shape —
-- restricted roles, a 20-character minimum note, an executability check, and
-- supersession of the previously adopted version of the same name.
create or replace function public.adopt_project_framework(
  p_framework_id uuid,
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
  f project_frameworks%rowtype;
  v_stages int;
  v_gates int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive') then
    return jsonb_build_object('error', 'adopting a project framework requires an executive or administrator');
  end if;
  select * into f from project_frameworks where id = p_framework_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'framework not found');
  end if;
  if f.status <> 'draft' then
    return jsonb_build_object('error', 'only draft frameworks can be adopted');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the authority and basis for adoption (20 characters minimum)');
  end if;
  select count(*) into v_stages from project_framework_stages where framework_id = f.id;
  select count(*) into v_gates from stage_gates where framework_id = f.id;
  if v_stages = 0 or v_gates = 0 then
    return jsonb_build_object('error',
      'this framework is not executable: it needs at least one stage and one gate before it can govern anything');
  end if;

  -- Both writes below are status transitions the immutability backstop
  -- (enforce_framework_immutability) guards; the transaction-local marker
  -- names this RPC as the governed path. Cannot outlive the transaction.
  perform set_config('app.framework_write', 'granted', true);

  update project_frameworks set status = 'superseded', superseded_by = f.id
  where organization_id = v_org and name = f.name and status = 'adopted';

  update project_frameworks
  set status = 'adopted', adopted_by = auth.uid(), adopted_at = now(),
      effective_date = coalesce(effective_date, current_date),
      basis = basis || ' | Adoption: ' || btrim(p_note)
  where id = f.id;

  perform set_config('app.framework_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('framework_id', f.id, 'version', f.version, 'status', 'adopted'));

  return jsonb_build_object('framework_id', f.id, 'version', f.version, 'status', 'adopted');
end
$$;

revoke all on function public.adopt_project_framework(uuid, text) from public, anon;
grant execute on function public.adopt_project_framework(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The immutability BACKSTOP at the persistence boundary. The RPC guards above
-- ("only drafts can be edited/adopted") are the front door; this trigger is
-- the wall behind it, so "prior versions immutable" is a property of the
-- TABLES, not a property of remembering to use the RPCs. Guarded operations:
--
--   * any write that lands adopted/superseded framework CONTENT — an INSERT
--     arriving with a non-draft status (a framework is born a draft; arriving
--     adopted would forge an adoption nobody performed), any UPDATE or DELETE
--     of a non-draft framework row, and any INSERT/UPDATE/DELETE of a stage
--     or gate whose framework is not a draft;
--   * any STATUS TRANSITION on the framework row itself — draft→adopted is
--     the act of authority adopt_project_framework performs (role check,
--     executability check, recorded basis), so a direct write of it is a
--     forged adoption even on a draft row.
--
-- Same posture as the §70 triggers (20261101090200's argument): SECURITY
-- INVOKER; clients refused without the transaction-local marker (which only
-- adopt_project_framework sets); the service path admitted AND audited into
-- security_events (refusing the service key buys nothing — a holder can
-- disable the trigger — but an unaudited rewrite of an adopted gate is the
-- "silently" this backstop exists to kill). A parent framework row that no
-- longer exists means the member row is mid-cascade; the cascade proceeds.
-- Gate-scoped stage_gate_criteria get the same backstop where their columns
-- live (20261101090400).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_framework_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.framework_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_fw_status text;
  v_guarded boolean := false;
begin
  if tg_table_name = 'project_frameworks' then
    if tg_op = 'INSERT' then
      v_guarded := new.status <> 'draft';
    elsif tg_op = 'DELETE' then
      v_guarded := old.status <> 'draft';
    else
      v_guarded := old.status <> 'draft'
                or new.status is distinct from old.status;
    end if;
  else
    -- project_framework_stages / stage_gates: guarded when their framework
    -- is not a draft (on UPDATE, when EITHER side's framework is not — a
    -- re-parent out of an adopted framework is as much a mutation of it as
    -- an edit in place).
    if tg_op = 'DELETE' then
      select status into v_fw_status from project_frameworks where id = old.framework_id;
      v_guarded := found and v_fw_status <> 'draft';
    else
      select status into v_fw_status from project_frameworks where id = new.framework_id;
      v_guarded := found and v_fw_status <> 'draft';
      if not v_guarded and tg_op = 'UPDATE'
         and new.framework_id is distinct from old.framework_id then
        select status into v_fw_status from project_frameworks where id = old.framework_id;
        v_guarded := found and v_fw_status <> 'draft';
      end if;
    end if;
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Audited service path. The org-exists guard keeps organization teardown
  -- from inserting an audit row that references the organization being
  -- removed; the marker skips the audit for the governed adoption path.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Adopted-framework content on ' || tg_table_name || ' (' || lower(tg_op)
           || ', row ' || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside the framework RPCs. An adopted '
           || 'framework version is immutable to clients; a service rewrite of one is '
           || 'recorded here because it changes what a past decision was measured against.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'An adopted framework version is immutable — its identity, stages and gates are '
      'the record of what past decisions were measured against. Change arrives as a new '
      'version (create_project_framework_version) adopted through adopt_project_framework; '
      'a direct write cannot rewrite or forge an adoption.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_framework_immutability on public.project_frameworks;
create trigger trg_framework_immutability
  before insert or update or delete on public.project_frameworks
  for each row execute function public.enforce_framework_immutability();

drop trigger if exists trg_framework_stage_immutability on public.project_framework_stages;
create trigger trg_framework_stage_immutability
  before insert or update or delete on public.project_framework_stages
  for each row execute function public.enforce_framework_immutability();

drop trigger if exists trg_stage_gate_immutability on public.stage_gates;
create trigger trg_stage_gate_immutability
  before insert or update or delete on public.stage_gates
  for each row execute function public.enforce_framework_immutability();

notify pgrst, 'reload schema';
