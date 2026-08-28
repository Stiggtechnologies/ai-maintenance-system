-- ============================================================================
-- Sync Develop Slice 1 — Baselines (D5.26, spec §20).
--
-- A Baseline is the ANCHOR a later Change will be diffed against (Slice 4's
-- change control, D5.27, is deliberately NOT built here — no impact vectors,
-- no propagation, no change table). The spec-§20 shape is kept faithful:
-- id, development_case_id, type, version, approved_at, approved_by, with the
-- six types VERBATIM: SCOPE, COST, SCHEDULE, DESIGN, RISK, BENEFITS.
--
-- Versioning discipline, per (case, type):
--   * versions are integers assigned by the create RPC, never by the client;
--   * exactly one version of a (case, type) may be 'approved' at a time —
--     approval supersedes the previously approved version, the
--     adopt_project_framework idiom (20261101090100);
--   * PRIOR VERSIONS ARE IMMUTABLE. The RPC guards are the front door; the
--     backstop trigger below is the wall behind it, copied from the adopted-
--     framework immutability backstop (20261101090100:447): a client write to
--     a non-draft baseline is refused even with RLS bypassed; the service
--     path is admitted AND audited into security_events for insert, update
--     and delete; a BEFORE DELETE returns OLD so cascades proceed.
--
-- Approval is a definer-RPC ACT recording approved_by/approved_at — not a
-- computed state, not a client PATCH. It is refused to the ai_admin identity
-- by name: a baseline is what later change control and gate decisions are
-- measured against, and the record of who fixed that reference is a human
-- accountability record (the §70 posture applied to the reference itself).
--
-- Content: description (what this baseline fixes, mandatory prose) +
-- content jsonb (structured values, optional) + document_id →
-- kb_intake_documents (the C2.15 rail stays the ONLY document door — same
-- rule as deliverables, 20261105090100). No second upload path.
--
-- Canonical reuse: development_cases, kb_intake_documents, audit_events,
-- security_events, app_current_org(), user_profiles. Nearest same-shape
-- precedent consulted: configuration_baselines (20260815140000:48) — that
-- table stays asset-configuration-scoped and is NOT overloaded; a project
-- baseline is a different noun with a different lifecycle (approved
-- versions, §20 types), which is why this is a NEW object per the build
-- plan's explicit ruling ("NEW six-type Baseline").
-- ============================================================================

create table if not exists public.development_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  baseline_type text not null check (baseline_type in
    ('SCOPE','COST','SCHEDULE','DESIGN','RISK','BENEFITS')),
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  -- What this baseline fixes, as prose a reviewer can check.
  description text not null check (btrim(description) <> ''),
  -- Structured values (e.g. {"total_cost": 4500000, "currency": "CAD"}).
  -- Data, not behaviour: nothing computes from it in this slice.
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  -- The C2.15 intake rail is the only document door.
  document_id uuid references kb_intake_documents(id) on delete set null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_note text,
  superseded_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (development_case_id, baseline_type, version),
  -- An approved-or-superseded baseline carries its approval record; a draft
  -- carries none. A record cannot appear without the status nor the status
  -- without the record (the development_cases sanction idiom).
  check (
    (status = 'draft') = (approved_at is null)
  ),
  check (
    approved_at is null or (approved_by is not null
      and coalesce(length(btrim(approval_note)), 0) >= 20)
  ),
  -- Supersession is a fact about approved history only.
  check (
    (status = 'superseded') = (superseded_at is not null)
  )
);

-- One approved version per (case, type): the current anchor.
create unique index if not exists idx_dev_baseline_one_approved
  on development_baselines(development_case_id, baseline_type)
  where status = 'approved';
create index if not exists idx_dev_baseline_case
  on development_baselines(organization_id, development_case_id, baseline_type, version desc);

alter table public.development_baselines enable row level security;
drop policy if exists development_baselines_read on public.development_baselines;
create policy development_baselines_read on public.development_baselines
  for select to authenticated using (organization_id = app_current_org());
-- No client write policy exists: every write is a definer RPC.

-- ---------------------------------------------------------------------------
-- The immutability backstop (the 20261101090100:447 pattern, copied).
-- Guarded operations:
--   * INSERT arriving non-draft — a baseline is born a draft; arriving
--     approved would forge an approval nobody performed;
--   * any UPDATE or DELETE of a non-draft row — prior versions immutable;
--   * any STATUS TRANSITION — draft→approved is the act of authority
--     approve_case_baseline performs; a direct write of it is a forged
--     approval even on a draft row.
-- Client (including RLS-bypassed simulated client): refused. Service:
-- admitted AND audited for every operation. BEFORE DELETE returns OLD.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_baseline_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.baseline_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_guarded boolean;
begin
  if tg_op = 'INSERT' then
    v_guarded := new.status <> 'draft';
  elsif tg_op = 'DELETE' then
    v_guarded := old.status <> 'draft';
  else
    v_guarded := old.status <> 'draft'
              or new.status is distinct from old.status;
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Audited service path (restore, correction). The org-exists guard keeps
  -- organization teardown from inserting an audit row that references the
  -- organization being removed; the marker skips the audit for the governed
  -- approval path.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Approved-baseline content on development_baselines (' || lower(tg_op)
           || ', row ' || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside the baseline RPCs. A prior '
           || 'baseline version is immutable to clients; a service rewrite of one is '
           || 'recorded here because it changes the anchor later change control and '
           || 'gate decisions are measured against.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'A baseline version, once approved, is immutable — it is the anchor change '
      'control diffs against and the reference past decisions were measured against. '
      'Change arrives as a NEW draft version (create_case_baseline) approved through '
      'approve_case_baseline; a direct write cannot rewrite or forge an approval.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_baseline_immutability on public.development_baselines;
create trigger trg_baseline_immutability
  before insert or update or delete on public.development_baselines
  for each row execute function public.enforce_baseline_immutability();

-- ---------------------------------------------------------------------------
-- Create a DRAFT baseline version. Preparation, not determination — the
-- planning role set (create_case_deliverable's, 20261105090100). Version is
-- assigned here, never by the caller. Only one draft per (case, type) at a
-- time: a second concurrent draft would race the version number and the
-- approval semantics.
-- ---------------------------------------------------------------------------
create or replace function public.create_case_baseline(
  p_case_id uuid,
  p_type text,
  p_description text,
  p_content jsonb default '{}'::jsonb,
  p_document_id uuid default null
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
  v_id uuid;
  v_version int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'drafting a baseline requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'baselines are not draftable on a ' || c.status || ' case');
  end if;
  if p_type not in ('SCOPE','COST','SCHEDULE','DESIGN','RISK','BENEFITS') then
    return jsonb_build_object('error',
      'baseline type must be one of SCOPE, COST, SCHEDULE, DESIGN, RISK, BENEFITS (spec §20)');
  end if;
  if coalesce(length(btrim(p_description)), 0) < 10 then
    return jsonb_build_object('error', 'state what this baseline fixes (10 characters minimum)');
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return jsonb_build_object('error', 'content must be a json object');
  end if;
  if p_document_id is not null and not exists (
    select 1 from kb_intake_documents k
    where k.id = p_document_id and k.organization_id = v_org
  ) then
    return jsonb_build_object('error',
      'that document is not in this organization''s intake register — the C2.15 intake rail is the only document door');
  end if;
  if exists (select 1 from development_baselines
             where development_case_id = c.id and baseline_type = p_type and status = 'draft') then
    return jsonb_build_object('error',
      'a draft ' || p_type || ' baseline already exists on this case — approve or replace its content first');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from development_baselines
  where development_case_id = c.id and baseline_type = p_type;

  insert into development_baselines
    (organization_id, development_case_id, baseline_type, version, status,
     description, content, document_id, created_by)
  values
    (v_org, c.id, p_type, v_version, 'draft',
     btrim(p_description), p_content, p_document_id, auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_baseline', coalesce(v_role, 'unknown'),
    jsonb_build_object('baseline_id', v_id, 'case_id', c.id, 'action', 'drafted',
      'baseline_type', p_type, 'version', v_version));

  return jsonb_build_object('baseline_id', v_id, 'baseline_type', p_type,
    'version', v_version, 'status', 'draft', 'approval_required', true);
end
$$;

revoke all on function public.create_case_baseline(uuid, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_case_baseline(uuid, text, text, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approval: the act that fixes the anchor. Records approved_by/approved_at,
-- supersedes the previously approved version of the same (case, type).
-- Role boundary: admin, executive, maintenance_manager, reliability_engineer.
-- ai_admin is refused BY NAME — the record of who fixed the reference is a
-- human accountability record (record_case_gate_review's posture).
-- ---------------------------------------------------------------------------
create or replace function public.approve_case_baseline(
  p_baseline_id uuid,
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
  b development_baselines%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'approving a baseline is a human accountability act — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'approving a baseline requires a governance or engineering role');
  end if;
  select * into b from development_baselines where id = p_baseline_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'baseline not found');
  end if;
  if b.status <> 'draft' then
    return jsonb_build_object('error',
      'only a draft baseline can be approved — a prior version is immutable and its approval is not overwritable');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error', 'record the basis for approving this baseline (20 characters minimum)');
  end if;

  -- Both writes are status transitions the immutability backstop guards; the
  -- transaction-local marker names this RPC as the governed path.
  perform set_config('app.baseline_write', 'granted', true);

  update development_baselines
  set status = 'superseded', superseded_at = now()
  where development_case_id = b.development_case_id
    and baseline_type = b.baseline_type
    and status = 'approved';

  update development_baselines
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      approval_note = btrim(p_note)
  where id = b.id;

  perform set_config('app.baseline_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'development_baseline', coalesce(v_role, 'unknown'),
    jsonb_build_object('baseline_id', b.id, 'case_id', b.development_case_id,
      'action', 'approved', 'baseline_type', b.baseline_type, 'version', b.version));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Baseline %s v%s approved on case %s as role %s — prior approved version (if any) superseded.',
            b.baseline_type, b.version, b.development_case_id, coalesce(v_role, 'none')));

  return jsonb_build_object('baseline_id', b.id, 'baseline_type', b.baseline_type,
    'version', b.version, 'status', 'approved');
end
$$;

revoke all on function public.approve_case_baseline(uuid, text) from public, anon;
grant execute on function public.approve_case_baseline(uuid, text) to authenticated;

notify pgrst, 'reload schema';
