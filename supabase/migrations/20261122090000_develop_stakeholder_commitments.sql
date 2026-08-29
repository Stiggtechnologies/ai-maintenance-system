-- ============================================================================
-- Sync Develop Slice 3C — StakeholderCommitment (D3.08, spec I.18) and the
-- commitment↔requirement coverage detection (D3.09).
--
-- WHAT SPEC I.18 GIVES, VERBATIM: "StakeholderCommitment: stakeholder,
-- concern, commitment, project requirement, owner, due date, evidence."
-- Seven fields. The detection sentence is the point of the object:
-- "Community commitment C-42 has no corresponding project requirement."
--
-- RULINGS THIS FILE TAKES (I.18 names the fields, not the homes):
--
--   * STAKEHOLDER IS `risk_stakeholders`, NOT A NEW REGISTRY. That table is
--     the platform's ONE stakeholder identity (internal/external, external
--     organization, role_or_relationship, influence, information
--     sensitivity — 20260921110102:38) with a reachable write path
--     (upsert_risk_stakeholder ← RiskEnterprisePanels.tsx:1319). A second
--     "project stakeholder" table would be the exact parallel-store failure
--     the overlap map exists to refuse. The FK is ON DELETE RESTRICT: a
--     stakeholder who is owed a commitment is not silently removable.
--
--   * PROJECT REQUIREMENT IS `design_requirements` — overlap-map ruling
--     (D4.16/D4.01: "design_requirements is the ONE project requirement
--     table"). Its scope is GENERALIZED to the development case here, on
--     the stage_gate_reviews precedent from Slice 1: the new scope column
--     is added, the old contract keeps working, and the RPC below is the
--     first customer write path the table has ever had (it was SELECT-only
--     RLS + a demo seed). That closes part of D4.16's named gap; the row
--     stays 🟡 because hierarchy, the eleven §10 categories and
--     objective↔KPI traceability are still absent — this file does not
--     claim them.
--
--   * THE REQUIREMENT LINK IS NULLABLE, DELIBERATELY. D3.09 detects
--     commitments no requirement covers; a NOT NULL link would make the
--     defect unrepresentable and the detector a tautology that can only
--     ever return zero. The gap is the product.
--
--   * EVIDENCE IS THE ONE EVIDENCE MODEL (ruling 3) and closure is
--     EVIDENCE-GATED — the D3.18 gate_conditions contract, repeated because
--     the shape is identical: a commitment "the owner says is honoured" is
--     an assertion. Evidence must be recorded against the SAME case.
--
--   * OVERDUE COMMITMENTS ESCALATE THROUGH THE ONE SWEEP
--     (expire_governance_instruments), extended in 20261122090200 with the
--     regulatory conditions — one escalator, not three (ruling 15).
--
--   * §70: a commitment to a community is an undertaking made by the
--     organization. The AI-operator identity may PREPARE one (recording is
--     not a determination) but cannot DISCHARGE one — closing a commitment
--     asserts an obligation to an external party was met, which is the
--     class of determination §70 reserves to humans. ai_admin is refused BY
--     NAME at close_stakeholder_commitment and backstopped on the table.
--
--   * COVERAGE IS DETERMINISTIC AND BIDIRECTIONAL. get_case_commitment_
--     coverage returns commitments no requirement covers AND case
--     requirements no commitment backs, each NAMED. The second direction is
--     informational, not a blocker: not every engineering requirement
--     exists to honour a promise, and pretending otherwise would
--     manufacture noise. The first direction is a gate blocker for
--     commitments already past their due date (see 20261122090200 — the
--     readiness consumption lands with the propagation family).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. SHAPE-SAFE CASTS FOR CALLER JSON.
--
--    Slices 3A and 3B took typed SQL parameters (p_expires_at timestamptz,
--    p_approve boolean), so a malformed value was rejected at the PostgREST
--    boundary before any function ran. This slice takes jsonb payloads, and a
--    cast written in a DECLARE initializer executes BEFORE the first guard —
--    so `"expected_lead_time_days": "60 days"` raised a raw 22P02 naming a
--    Postgres type instead of the field. House law is that a refusal names
--    what is wrong; `invalid input syntax for type integer` names nothing.
--
--    These return NULL for an unparseable value instead of raising, so the
--    act keeps the RAW text beside the parsed value and refuses by name in
--    its own vocabulary. They are IMMUTABLE and used only in this slice's
--    DECLARE blocks.
-- ---------------------------------------------------------------------------
create or replace function public.sync_text_as_int(p_text text)
returns int language plpgsql immutable as $$
begin
  return p_text::int;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end $$;

create or replace function public.sync_text_as_numeric(p_text text)
returns numeric language plpgsql immutable as $$
begin
  return p_text::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end $$;

create or replace function public.sync_text_as_date(p_text text)
returns date language plpgsql immutable as $$
begin
  return p_text::date;
exception when invalid_text_representation or invalid_datetime_format
          or datetime_field_overflow then
  return null;
end $$;

create or replace function public.sync_text_as_uuid(p_text text)
returns uuid language plpgsql immutable as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end $$;

create or replace function public.sync_text_as_boolean(p_text text)
returns boolean language plpgsql immutable as $$
begin
  return p_text::boolean;
exception when invalid_text_representation then
  return null;
end $$;

create or replace function public.sync_text_as_bigint(p_text text)
returns bigint language plpgsql immutable as $$
begin
  return p_text::bigint;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end $$;

revoke all on function public.sync_text_as_int(text) from public, anon;
revoke all on function public.sync_text_as_numeric(text) from public, anon;
revoke all on function public.sync_text_as_date(text) from public, anon;
revoke all on function public.sync_text_as_uuid(text) from public, anon;
revoke all on function public.sync_text_as_boolean(text) from public, anon;
revoke all on function public.sync_text_as_bigint(text) from public, anon;
grant execute on function public.sync_text_as_int(text) to authenticated, service_role;
grant execute on function public.sync_text_as_numeric(text) to authenticated, service_role;
grant execute on function public.sync_text_as_date(text) to authenticated, service_role;
grant execute on function public.sync_text_as_uuid(text) to authenticated, service_role;
grant execute on function public.sync_text_as_boolean(text) to authenticated, service_role;
grant execute on function public.sync_text_as_bigint(text) to authenticated, service_role;

comment on function public.sync_text_as_int(text) is
  'Slice 3C: parse-or-NULL for caller JSON, so an act can refuse a malformed field BY NAME instead of raising a raw 22P02 from its DECLARE block.';

-- ---------------------------------------------------------------------------
-- 1. The ONE project requirement table, generalized to case scope.
--    No new columns beyond scope + case linkage: this file needs a
--    requirement a commitment can point at, not a requirements module.
-- ---------------------------------------------------------------------------
alter table public.design_requirements
  add column if not exists development_case_id uuid
    references development_cases(id) on delete cascade,
  add column if not exists created_by uuid references auth.users(id);

create index if not exists idx_dreq_case
  on design_requirements(organization_id, development_case_id, verification_status)
  where development_case_id is not null;

comment on column public.design_requirements.development_case_id is
  'D3.08/D3.10 (20261122090000): the ONE project requirement table generalized from capital_projects to the development case. Null keeps the pre-existing project-scoped contract exactly as it was.';

-- Case-scoped requirement rows are definer-RPC-only. The table has never
-- carried a client write policy (20260818090000:100 is SELECT-only), so
-- this states the posture rather than changing it — and states it as a
-- RESTRICTIVE policy so a later permissive INSERT policy for the project
-- side cannot silently open the case side too (the evidence_items
-- per-command idiom, 20261105090000).
drop policy if exists design_requirements_case_no_ins on public.design_requirements;
create policy design_requirements_case_no_ins on public.design_requirements as restrictive
  for insert to authenticated
  with check (development_case_id is null);
drop policy if exists design_requirements_case_no_upd on public.design_requirements;
create policy design_requirements_case_no_upd on public.design_requirements as restrictive
  for update to authenticated
  using (development_case_id is null)
  with check (development_case_id is null);
drop policy if exists design_requirements_case_no_del on public.design_requirements;
create policy design_requirements_case_no_del on public.design_requirements as restrictive
  for delete to authenticated
  using (development_case_id is null);

-- ---------------------------------------------------------------------------
-- 2. record_case_requirement — the first customer write path this table has.
--    The requirement_ref uniqueness is org-wide (idx_dreq_ref); a collision
--    is REFUSED by name rather than silently upserted over someone else's
--    requirement.
-- ---------------------------------------------------------------------------
create or replace function public.record_case_requirement(
  p_case_id uuid,
  p_requirement jsonb
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
  v_ref text := nullif(btrim(coalesce(p_requirement->>'requirement_ref','')), '');
  v_category text := nullif(btrim(coalesce(p_requirement->>'category','')), '');
  v_source text := coalesce(nullif(btrim(coalesce(p_requirement->>'source','')), ''), 'engineering');
  v_method text := nullif(btrim(coalesce(p_requirement->>'verification_method','')), '');
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a project requirement requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a requirement carries a reference the rest of the project can cite (requirement_ref)');
  end if;
  if v_category is null or v_category not in
     ('reliability','maintainability','access','instrumentation','standardisation',
      'sparing','safety','operability','data_handover') then
    return jsonb_build_object('error',
      'category must be one of the design_requirements categories: reliability, maintainability, access, instrumentation, standardisation, sparing, safety, operability, data_handover');
  end if;
  if v_source not in ('engineering','operations','maintenance','incident','regulatory','operational_lesson') then
    return jsonb_build_object('error',
      'source must be one of: engineering, operations, maintenance, incident, regulatory, operational_lesson');
  end if;
  if coalesce(length(btrim(coalesce(p_requirement->>'requirement',''))), 0) < 10 then
    return jsonb_build_object('error',
      'state the requirement — what must be true (10 characters minimum)');
  end if;
  if v_method is not null and v_method not in
     ('review','analysis','inspection','factory_test','site_test','demonstration') then
    return jsonb_build_object('error',
      'verification_method must be one of: review, analysis, inspection, factory_test, site_test, demonstration');
  end if;
  if exists (select 1 from design_requirements d
             where d.organization_id = v_org and d.requirement_ref = v_ref) then
    return jsonb_build_object('error',
      format('requirement reference "%s" already exists in this organization — a reference identifies one requirement, so pick another rather than overwriting it', v_ref));
  end if;

  insert into design_requirements (
    organization_id, project_id, development_case_id, requirement_ref,
    category, requirement, source, verification_method, created_by)
  values (
    v_org, c.capital_project_id, c.id, v_ref, v_category,
    btrim(p_requirement->>'requirement'), v_source, v_method, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'case_requirement', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'requirement_id', v_id,
      'requirement_ref', v_ref, 'category', v_category, 'source', v_source),
    null,
    jsonb_build_object('requirement_ref', v_ref, 'category', v_category,
      'source', v_source, 'verification_status', 'open'));

  return jsonb_build_object('requirement_id', v_id, 'case_id', c.id,
    'requirement_ref', v_ref);
end
$$;

revoke all on function public.record_case_requirement(uuid, jsonb) from public, anon;
grant execute on function public.record_case_requirement(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The object. Seven spec fields, one per column, none of them jsonb:
--      stakeholder  -> stakeholder_id  (risk_stakeholders, the ONE registry)
--      concern      -> concern
--      commitment   -> commitment
--      requirement  -> requirement_id  (design_requirements — NULLABLE)
--      owner        -> owner_id        (auth.users, NOT NULL)
--      due date     -> due_date        (NOT NULL — a promise with no date
--                                       cannot be overdue, and a commitment
--                                       that can never be late is decoration)
--      evidence     -> evidence_item_id (the ONE evidence model; arrives at
--                                        discharge, so nullable until then)
-- ---------------------------------------------------------------------------
create table if not exists public.stakeholder_commitments (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- Spec field 1. RESTRICT: the party owed the promise is not deletable
  -- while the promise stands.
  stakeholder_id uuid not null references risk_stakeholders(id) on delete restrict,
  commitment_ref text not null,
  -- Spec field 2 and 3.
  concern text not null check (btrim(concern) <> ''),
  commitment text not null check (btrim(commitment) <> ''),
  -- Spec field 4 — the coverage question, representable as absent.
  requirement_id bigint references design_requirements(id) on delete set null,
  -- Spec field 5 and 6.
  owner_id uuid not null references auth.users(id),
  due_date date not null,
  -- Spec field 7 — recorded at discharge.
  evidence_item_id uuid references evidence_items(id) on delete set null,
  commitment_kind text not null default 'community'
    check (commitment_kind in
      ('community','indigenous','regulatory','landowner','employee',
       'customer','contractual','environmental')),
  status text not null default 'open'
    check (status in ('open','satisfied','breached','withdrawn')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  closure_note text,
  breached_at timestamptz,
  withdrawal_reason text,
  withdrawn_by uuid references auth.users(id),
  withdrawn_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- A discharged commitment carries its evidence, its closer and its time —
  -- the D3.18 closure contract, same shape, same reason.
  constraint sc_closure_complete check (
    status <> 'satisfied'
    or (evidence_item_id is not null and closed_by is not null and closed_at is not null)),
  -- A withdrawn commitment states why it was withdrawn. "We stopped
  -- tracking it" is not a reason; the absence of one is how promises quietly
  -- disappear.
  constraint sc_withdrawal_reasoned check (
    status <> 'withdrawn'
    or (withdrawal_reason is not null and btrim(withdrawal_reason) <> ''
        and withdrawn_by is not null and withdrawn_at is not null))
);

create unique index if not exists idx_stakeholder_commitments_ref
  on stakeholder_commitments(organization_id, commitment_ref);
create index if not exists idx_stakeholder_commitments_case
  on stakeholder_commitments(organization_id, development_case_id, status);
create index if not exists idx_stakeholder_commitments_open_due
  on stakeholder_commitments(organization_id, status, due_date)
  where status in ('open','breached');
create index if not exists idx_stakeholder_commitments_requirement
  on stakeholder_commitments(requirement_id) where requirement_id is not null;

alter table public.stakeholder_commitments enable row level security;
drop policy if exists stakeholder_commitments_read on public.stakeholder_commitments;
create policy stakeholder_commitments_read on public.stakeholder_commitments
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy: every mutation is a definer RPC below. Stated, not
-- assumed — the table is safe by construction and the smoke proves it.

comment on table public.stakeholder_commitments is
  'D3.08 / spec I.18: what the organization committed, to whom, about which concern, with an owner, a due date, the project requirement that carries it (nullable — D3.09 detects the absence) and the evidence that discharged it. Stakeholder identity is risk_stakeholders (the ONE registry); requirement is design_requirements (the ONE project requirement table); evidence is evidence_items (the ONE evidence model).';

-- ---------------------------------------------------------------------------
-- 4. Provenance: commitments are born and change only through the acts
--    below. Clients are refused outright; the service path is admitted AND
--    audited (the 20261101090300 child idiom). The closure-shape and §70
--    invariants hold for EVERY writer, service included — a commitment
--    discharged by the AI-operator identity is corrupt governance data
--    whoever wrote the row.
-- ---------------------------------------------------------------------------
-- DEFINER + a pinned search_path, like every other trigger function in this
-- slice. This is the §70 backstop for D3.08 and it reads user_profiles,
-- organizations and security_events; the header above claims those checks hold
-- "for EVERY writer, service included", and a claim that rests on the
-- invoker's privileges, RLS visibility and an unpinned search_path rests on
-- ambient conditions the function does not control.
create or replace function public.enforce_stakeholder_commitment_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text := coalesce(current_setting('app.stakeholder_commitment_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_id text := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
begin
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Stakeholder commitment ' || v_id || ' written by a service caller ('
           || lower(tg_op) || '), bypassing the commitment acts '
           || '(record_stakeholder_commitment / link_commitment_to_requirement / '
           || 'close_stakeholder_commitment / the escalation sweep).');
    end if;
  elsif v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Stakeholder commitments are recorded, linked, discharged and escalated only '
      'through their governed acts. A promise to a community that any client can '
      'edit or delete is not a commitment — spec I.18.'
      using errcode = 'insufficient_privilege';
  end if;

  -- §70, for every writer: discharging a commitment asserts that an
  -- undertaking to an external party was met. The AI-operator identity
  -- prepares; a human discharges.
  if tg_op in ('INSERT','UPDATE') and new.status = 'satisfied'
     and exists (select 1 from user_profiles up
                 where up.id = new.closed_by and up.role = 'ai_admin') then
    raise exception
      'Spec §70: discharging a stakeholder commitment asserts an undertaking to an external '
      'party was met — a human determination the AI-operator identity cannot record.'
      using errcode = 'check_violation';
  end if;

  -- §70 again, for the other way a promise leaves the register: WITHDRAWING
  -- one asserts the organization is no longer bound by an undertaking it
  -- gave an external party. Retiring a promise is the same class of
  -- determination as discharging it, and the first draft of this file
  -- covered only 'satisfied' — which left the AI identity able to make a
  -- community commitment disappear through the status the coverage detector
  -- excludes.
  if tg_op in ('INSERT','UPDATE') and new.status = 'withdrawn'
     and exists (select 1 from user_profiles up
                 where up.id = new.withdrawn_by and up.role = 'ai_admin') then
    raise exception
      'Spec §70: withdrawing a stakeholder commitment asserts the organization is no longer '
      'bound by an undertaking it gave an external party — a human determination the '
      'AI-operator identity cannot record.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function public.enforce_stakeholder_commitment_provenance() from public, anon, authenticated;

drop trigger if exists trg_stakeholder_commitment_provenance on public.stakeholder_commitments;
create trigger trg_stakeholder_commitment_provenance
  before insert or update or delete on public.stakeholder_commitments
  for each row execute function public.enforce_stakeholder_commitment_provenance();

-- ---------------------------------------------------------------------------
-- 5. Recording a commitment. Preparation, not determination — the planner
--    role may record; ai_admin may record (and is refused at discharge).
-- ---------------------------------------------------------------------------
create or replace function public.record_stakeholder_commitment(
  p_case_id uuid,
  p_commitment jsonb
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
  s risk_stakeholders%rowtype;
  v_ref text := nullif(btrim(coalesce(p_commitment->>'commitment_ref','')), '');
  -- Raw text beside the parsed value: a cast in a DECLARE runs before the
  -- first guard, so an unparseable field must arrive here as NULL and be
  -- refused BY NAME below rather than raising a raw 22P02 (section 0).
  v_owner_raw text := nullif(btrim(coalesce(p_commitment->>'owner_id','')), '');
  v_owner uuid := sync_text_as_uuid(v_owner_raw);
  v_due_raw text := nullif(btrim(coalesce(p_commitment->>'due_date','')), '');
  v_due date := sync_text_as_date(v_due_raw);
  v_kind text := coalesce(nullif(btrim(coalesce(p_commitment->>'commitment_kind','')), ''), 'community');
  v_requirement_raw text := nullif(btrim(coalesce(p_commitment->>'requirement_id','')), '');
  v_requirement bigint := sync_text_as_bigint(v_requirement_raw);
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'recording a stakeholder commitment requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  -- Malformed caller JSON is refused BY NAME, before the shape guards, so a
  -- non-React client never meets a raw Postgres cast error (section 0).
  if v_owner_raw is not null and v_owner is null then
    return jsonb_build_object('error',
      format('owner_id must be a user id (uuid) — "%s" is not one', v_owner_raw));
  end if;
  if v_due_raw is not null and v_due is null then
    return jsonb_build_object('error',
      format('due_date must be a date (YYYY-MM-DD) — "%s" is not one', v_due_raw));
  end if;
  if v_requirement_raw is not null and v_requirement is null then
    return jsonb_build_object('error',
      format('requirement_id must be a requirement id (a whole number) — "%s" is not one', v_requirement_raw));
  end if;
  select * into s from risk_stakeholders
  where id = sync_text_as_uuid(nullif(btrim(coalesce(p_commitment->>'stakeholder_id','')), ''))
    and organization_id = v_org;
  if not found then
    return jsonb_build_object('error',
      'stakeholder not found in this organization — register the stakeholder first (upsert_risk_stakeholder); a commitment owed to nobody named is not a commitment');
  end if;
  if v_ref is null then
    return jsonb_build_object('error',
      'a commitment carries a reference the record can be cited by (commitment_ref, e.g. C-42)');
  end if;
  if coalesce(length(btrim(coalesce(p_commitment->>'concern',''))), 0) < 5 then
    return jsonb_build_object('error',
      'state the concern this commitment answers (5 characters minimum) — a commitment without its concern cannot be judged adequate');
  end if;
  if coalesce(length(btrim(coalesce(p_commitment->>'commitment',''))), 0) < 10 then
    return jsonb_build_object('error',
      'state what was committed (10 characters minimum)');
  end if;
  if v_owner is null or not exists (
    select 1 from user_profiles where id = v_owner and organization_id = v_org) then
    return jsonb_build_object('error',
      'a commitment has a named owner in this organization — an unowned promise is nobody''s work');
  end if;
  if v_due is null then
    return jsonb_build_object('error',
      'a commitment has a due date — a promise that can never be late is never escalated');
  end if;
  if v_kind not in ('community','indigenous','regulatory','landowner','employee',
                    'customer','contractual','environmental') then
    return jsonb_build_object('error',
      'commitment_kind must be one of: community, indigenous, regulatory, landowner, employee, customer, contractual, environmental');
  end if;
  if exists (select 1 from stakeholder_commitments sc
             where sc.organization_id = v_org and sc.commitment_ref = v_ref) then
    return jsonb_build_object('error',
      format('commitment reference "%s" already exists in this organization', v_ref));
  end if;
  -- A stated requirement link must be a requirement OF THIS CASE. A
  -- commitment "covered" by another project's requirement is not covered.
  if v_requirement is not null and not exists (
    select 1 from design_requirements d
    where d.id = v_requirement and d.organization_id = v_org
      and d.development_case_id = c.id) then
    return jsonb_build_object('error',
      'that requirement is not a requirement of this case — a commitment cannot be covered by another case''s requirement');
  end if;

  perform set_config('app.stakeholder_commitment_write', 'granted', true);
  insert into stakeholder_commitments (
    organization_id, development_case_id, stakeholder_id, commitment_ref,
    concern, commitment, requirement_id, owner_id, due_date, commitment_kind,
    created_by)
  values (
    v_org, c.id, s.id, v_ref, btrim(p_commitment->>'concern'),
    btrim(p_commitment->>'commitment'), v_requirement, v_owner, v_due, v_kind,
    auth.uid())
  returning id into v_id;
  perform set_config('app.stakeholder_commitment_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'stakeholder_commitment', coalesce(v_role, 'unknown'),
    jsonb_build_object('case_id', c.id, 'commitment_id', v_id, 'action', 'recorded',
      'commitment_ref', v_ref, 'stakeholder_id', s.id, 'stakeholder', s.name,
      'requirement_id', v_requirement, 'owner_id', v_owner, 'due_date', v_due),
    null,
    jsonb_build_object('status', 'open', 'requirement_id', v_requirement,
      'owner_id', v_owner, 'due_date', v_due));

  return jsonb_build_object('commitment_id', v_id, 'case_id', c.id,
    'commitment_ref', v_ref, 'status', 'open',
    'covered', v_requirement is not null);
end
$$;

revoke all on function public.record_stakeholder_commitment(uuid, jsonb) from public, anon;
grant execute on function public.record_stakeholder_commitment(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Closing the coverage gap: linking a commitment to the requirement that
--    carries it (and, deliberately, UNLINKING is not offered — severing a
--    commitment from its requirement would silently re-open a gap the
--    detector had reported as closed; re-point it at a different requirement
--    of the same case, which is recorded with both sides in the ledger).
-- ---------------------------------------------------------------------------
create or replace function public.link_commitment_to_requirement(
  p_commitment_id bigint,
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
  sc stakeholder_commitments%rowtype;
  d design_requirements%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'linking a commitment to a requirement requires a planning, engineering or governance role');
  end if;
  select * into sc from stakeholder_commitments
  where id = p_commitment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'stakeholder commitment not found');
  end if;
  -- A BREACHED commitment is LATE, not closed. Excluding it here made the
  -- D3.09 loop work only in the window before the hourly sweep ran: the sweep
  -- breaches an overdue uncovered commitment, the breach is exactly what
  -- makes it a gate blocker, and this refusal then made that blocker
  -- permanently unclearable — remediation refused on the ground that the
  -- commitment "closed", which it had not. Open and breached are both live.
  if sc.status not in ('open', 'breached') then
    return jsonb_build_object('error',
      format('this commitment is %s — coverage is recorded while a commitment is live, not rewritten after it closed', sc.status));
  end if;
  if p_requirement_id is null then
    return jsonb_build_object('error',
      'name the requirement that carries this commitment — clearing the link is not offered, because a severed link silently re-opens a gap the coverage report had closed');
  end if;
  select * into d from design_requirements
  where id = p_requirement_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found in this organization');
  end if;
  if d.development_case_id is distinct from sc.development_case_id then
    return jsonb_build_object('error',
      'that requirement is not a requirement of this commitment''s case — a commitment cannot be covered by another case''s requirement');
  end if;

  perform set_config('app.stakeholder_commitment_write', 'granted', true);
  update stakeholder_commitments
  set requirement_id = d.id
  where id = sc.id;
  perform set_config('app.stakeholder_commitment_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'stakeholder_commitment', coalesce(v_role, 'unknown'),
    jsonb_build_object('commitment_id', sc.id, 'action', 'requirement_linked',
      'case_id', sc.development_case_id, 'commitment_ref', sc.commitment_ref,
      'requirement_ref', d.requirement_ref),
    jsonb_build_object('requirement_id', sc.requirement_id),
    jsonb_build_object('requirement_id', d.id));

  return jsonb_build_object('commitment_id', sc.id, 'requirement_id', d.id,
    'requirement_ref', d.requirement_ref, 'covered', true);
end
$$;

revoke all on function public.link_commitment_to_requirement(bigint, bigint) from public, anon;
grant execute on function public.link_commitment_to_requirement(bigint, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Discharging a commitment. Evidence-gated (D3.18's contract), §70
--    human-only, late discharge keeps the breach on the record.
-- ---------------------------------------------------------------------------
create or replace function public.close_stakeholder_commitment(
  p_commitment_id bigint,
  p_evidence_id uuid,
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
  sc stakeholder_commitments%rowtype;
  ev evidence_items%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'discharging a stakeholder commitment asserts an undertaking to an external party was met — a §70 human determination the AI-operator identity cannot record');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'discharging a stakeholder commitment requires a governance or engineering role');
  end if;
  select * into sc from stakeholder_commitments
  where id = p_commitment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'stakeholder commitment not found');
  end if;
  if sc.status = 'satisfied' then
    return jsonb_build_object('error', 'this commitment is already satisfied — a discharge is not overwritable');
  end if;
  if sc.status = 'withdrawn' then
    return jsonb_build_object('error', 'this commitment was withdrawn — a withdrawn commitment is not discharged');
  end if;
  if p_evidence_id is null then
    return jsonb_build_object('error',
      format('discharging commitment %s requires the evidence that it was honoured — record it (record_case_evidence) and link it here', sc.commitment_ref));
  end if;
  select * into ev from evidence_items where id = p_evidence_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'evidence item not found in this organization');
  end if;
  if ev.development_case_id is distinct from sc.development_case_id then
    return jsonb_build_object('error',
      'that evidence item is not recorded against this commitment''s case — evidence for one case cannot discharge another case''s promise');
  end if;

  perform set_config('app.stakeholder_commitment_write', 'granted', true);
  update stakeholder_commitments
  set status = 'satisfied',
      closed_by = auth.uid(),
      closed_at = now(),
      evidence_item_id = ev.id,
      closure_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = sc.id;
  perform set_config('app.stakeholder_commitment_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'stakeholder_commitment', coalesce(v_role, 'unknown'),
    jsonb_build_object('commitment_id', sc.id, 'action', 'satisfied',
      'case_id', sc.development_case_id, 'commitment_ref', sc.commitment_ref,
      'evidence_id', ev.id, 'was_breached', sc.breached_at is not null),
    jsonb_build_object('status', sc.status, 'evidence_item_id', sc.evidence_item_id,
      'breached_at', sc.breached_at),
    jsonb_build_object('status', 'satisfied', 'evidence_item_id', ev.id,
      'closed_by', auth.uid(), 'closed_at', now(), 'breached_at', sc.breached_at));

  return jsonb_build_object('commitment_id', sc.id, 'status', 'satisfied',
    'evidence_id', ev.id, 'closed_late', sc.breached_at is not null);
end
$$;

revoke all on function public.close_stakeholder_commitment(bigint, uuid, text) from public, anon;
grant execute on function public.close_stakeholder_commitment(bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7b. WITHDRAWING a commitment. The status existed with no act, which made
--     `sc_withdrawal_reasoned` and the `status <> 'withdrawn'` exclusions in
--     the coverage detector unreachable code — a rule nobody can trip is not
--     a rule. A promise is withdrawn when the party owed it releases the
--     organization or the scope it attached to is gone, and that is a stated
--     reason with a named human behind it, never a quiet delete.
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_stakeholder_commitment(
  p_commitment_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  sc stakeholder_commitments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role, '') = 'ai_admin' then
    return jsonb_build_object('error',
      'withdrawing a stakeholder commitment asserts the organization is no longer bound by an undertaking it gave an external party — a §70 human determination the AI-operator identity cannot record');
  end if;
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'withdrawing a stakeholder commitment requires a governance or engineering role');
  end if;
  select * into sc from stakeholder_commitments
  where id = p_commitment_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'stakeholder commitment not found');
  end if;
  if sc.status = 'satisfied' then
    return jsonb_build_object('error', 'this commitment was discharged — a kept promise is not withdrawn');
  end if;
  if sc.status = 'withdrawn' then
    return jsonb_build_object('error', 'this commitment is already withdrawn');
  end if;
  if v_reason is null or length(v_reason) < 20 then
    return jsonb_build_object('error',
      'state why this commitment is withdrawn (20 characters minimum) — "we stopped tracking it" is not a reason, and the absence of one is how promises quietly disappear');
  end if;

  perform set_config('app.stakeholder_commitment_write', 'granted', true);
  update stakeholder_commitments
  set status = 'withdrawn', withdrawal_reason = v_reason,
      withdrawn_by = auth.uid(), withdrawn_at = now()
  where id = sc.id;
  perform set_config('app.stakeholder_commitment_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data,
    previous_state, new_state)
  values (v_org, 'stakeholder_commitment', coalesce(v_role, 'unknown'),
    jsonb_build_object('commitment_id', sc.id, 'action', 'withdrawn',
      'case_id', sc.development_case_id, 'commitment_ref', sc.commitment_ref,
      'reason', v_reason, 'was_breached', sc.breached_at is not null),
    jsonb_build_object('status', sc.status, 'withdrawal_reason', sc.withdrawal_reason),
    jsonb_build_object('status', 'withdrawn', 'withdrawal_reason', v_reason,
      'withdrawn_by', auth.uid(), 'withdrawn_at', now()));

  return jsonb_build_object('commitment_id', sc.id, 'status', 'withdrawn',
    'reason', v_reason);
end
$$;

revoke all on function public.withdraw_stakeholder_commitment(bigint, text) from public, anon;
grant execute on function public.withdraw_stakeholder_commitment(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. D3.09 — the coverage detection. Deterministic, bidirectional, NAMED.
--    Consumed by the workspace read (20261122090700) so it is visible on the
--    case surface, and by gate readiness (20261122090200) where an OVERDUE
--    uncovered commitment blocks.
-- ---------------------------------------------------------------------------
create or replace function public.get_case_commitment_coverage(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- THE ONE COVERAGE PREDICATE, callable from both sides of the register's
  -- own claim. The gate blocker (get_gate_readiness, 20261122090300) and the
  -- refusal at the act site both read THIS function rather than a
  -- hand-duplicated copy, so what the banner displays and what the server
  -- refuses over cannot drift. That requires it to work for a system caller
  -- with no JWT as well as for a client, so the organization is taken from
  -- the CASE and a client caller is confined to its own:
  --   * a client (app_current_org() non-null) sees only its own cases;
  --   * a definer/system caller has already resolved the case inside a
  --     tenant, and reads through it.
  -- A caller holding `authenticated` with no organization is refused.
  v_caller_org uuid := app_current_org();
  v_org uuid;
  c development_cases%rowtype;
  v_uncovered jsonb;
  v_covered jsonb;
  v_unbacked jsonb;
  v_total int;
  v_uncovered_count int;
begin
  if v_caller_org is null and current_user in ('authenticated', 'anon') then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into c from development_cases where id = p_case_id;
  if not found or (v_caller_org is not null and c.organization_id <> v_caller_org) then
    return jsonb_build_object('error', 'development case not found');
  end if;
  v_org := c.organization_id;

  -- Direction 1 (spec I.18's own sentence): commitments no requirement
  -- covers. Withdrawn commitments are excluded — a promise formally
  -- withdrawn with a stated reason is not an uncovered promise. Satisfied
  -- ones are NOT excluded: a commitment discharged without ever becoming a
  -- project requirement is exactly the failure mode I.18 describes, and
  -- hiding it once it closes would make the detector flatter over time.
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'commitmentId', sc.id,
      'commitmentRef', sc.commitment_ref,
      'stakeholder', st.name,
      'stakeholderType', st.stakeholder_type,
      'externalOrganization', st.external_organization,
      'kind', sc.commitment_kind,
      'concern', sc.concern,
      'commitment', sc.commitment,
      'owner', (select coalesce(p.full_name, p.email) from user_profiles p where p.id = sc.owner_id),
      'dueDate', sc.due_date,
      'status', sc.status,
      'overdue', sc.status in ('open','breached') and sc.due_date < current_date,
      'breachedAt', sc.breached_at)
      order by sc.due_date, sc.commitment_ref), '[]'::jsonb),
    count(*)
  into v_uncovered, v_uncovered_count
  from stakeholder_commitments sc
  join risk_stakeholders st on st.id = sc.stakeholder_id
  where sc.organization_id = v_org and sc.development_case_id = c.id
    and sc.requirement_id is null and sc.status <> 'withdrawn';

  select coalesce(jsonb_agg(jsonb_build_object(
      'commitmentId', sc.id,
      'commitmentRef', sc.commitment_ref,
      'stakeholder', st.name,
      'kind', sc.commitment_kind,
      'commitment', sc.commitment,
      'dueDate', sc.due_date,
      'status', sc.status,
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'requirementVerification', d.verification_status)
      order by sc.due_date, sc.commitment_ref), '[]'::jsonb)
  into v_covered
  from stakeholder_commitments sc
  join risk_stakeholders st on st.id = sc.stakeholder_id
  join design_requirements d on d.id = sc.requirement_id
  where sc.organization_id = v_org and sc.development_case_id = c.id
    and sc.status <> 'withdrawn';

  -- Direction 2: case requirements no commitment backs. Informational by
  -- design (header ruling) — most requirements are engineering decisions,
  -- not promises, so this is a list to read, never a blocker.
  select coalesce(jsonb_agg(jsonb_build_object(
      'requirementId', d.id,
      'requirementRef', d.requirement_ref,
      'category', d.category,
      'source', d.source,
      'requirement', d.requirement,
      'verificationStatus', d.verification_status)
      order by d.requirement_ref), '[]'::jsonb)
  into v_unbacked
  from design_requirements d
  where d.organization_id = v_org and d.development_case_id = c.id
    and not exists (
      select 1 from stakeholder_commitments sc
      where sc.requirement_id = d.id and sc.status <> 'withdrawn');

  select count(*) into v_total
  from stakeholder_commitments sc
  where sc.organization_id = v_org and sc.development_case_id = c.id
    and sc.status <> 'withdrawn';

  return jsonb_build_object(
    'caseId', c.id,
    'commitmentsTotal', v_total,
    'uncoveredCount', v_uncovered_count,
    -- Null, not 0 and not 100, when there are no commitments: a coverage
    -- percentage over an empty set is an invented number (the get_gate_
    -- readiness 0/0 rule, repeated).
    'coveragePct', case when v_total > 0
      then round(((v_total - v_uncovered_count)::numeric / v_total) * 100, 1) end,
    'uncoveredCommitments', v_uncovered,
    'coveredCommitments', v_covered,
    'requirementsWithoutCommitment', v_unbacked);
end
$$;

revoke all on function public.get_case_commitment_coverage(uuid) from public, anon;
grant execute on function public.get_case_commitment_coverage(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
