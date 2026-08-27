-- ============================================================================
-- Sync Develop Slice 1 — GateRequirement provenance (D3.25 / D3.14 / D3.15).
--
-- The requirement columns land ON stage_gate_criteria — overlap-map ruling:
-- not a parallel requirement table. Every requirement now carries WHERE IT
-- COMES FROM as an enforced eight-tier ladder (register standing constraint
-- 1), descending authority:
--
--   LAW > REGULATION > CORPORATE_STANDARD > PROJECT_FRAMEWORK > CONTRACT
--       > INDUSTRY_GUIDANCE > BEST_PRACTICE > AI_SUGGESTION
--
-- THE PROMOTION INVARIANT SHIPS IN THIS SAME MIGRATION (D3.15, Invariant
-- lane): a write that RAISES a requirement's tier without a recorded human
-- approval is refused at the persistence boundary — an AI_SUGGESTION can
-- never silently become a CORPORATE_STANDARD. Deliberate deviation from the
-- admit-the-service-path idiom (20261005090300 §1): tier escalation is
-- refused for EVERY caller without the marker, service roles included,
-- because "silently" is the word the invariant exists to kill — a restore
-- re-INSERTS rows (passing this trigger; the backstop below audits them on
-- adopted frameworks), and a deliberate operator can set the marker himself.
-- Demotion needs no marker: lowering a claim is the honest direction and
-- must never be harder than raising one.
--
-- Backfill: the pre-existing criteria are the EN 16646-derived whole-life
-- seeds (20260816090000) — industry-standard practice, so INDUSTRY_GUIDANCE,
-- applied BEFORE the trigger exists so the backfill itself cannot trip it.
--
-- Also here: the requirement authoring RPC (framework authoring is RPC-first
-- this slice), the human promotion RPC, deep framework versioning (clone
-- carries requirement provenance), and provision_organization re-created so
-- template cloning carries the tier and excludes gate-scoped rows.
-- ============================================================================

alter table public.stage_gate_criteria
  add column if not exists category text,
  add column if not exists evidence_type text,
  add column if not exists minimum_confidence numeric
    check (minimum_confidence is null or (minimum_confidence >= 0 and minimum_confidence <= 1)),
  add column if not exists source_authority text not null default 'BEST_PRACTICE'
    check (source_authority in
      ('LAW','REGULATION','CORPORATE_STANDARD','PROJECT_FRAMEWORK','CONTRACT',
       'INDUSTRY_GUIDANCE','BEST_PRACTICE','AI_SUGGESTION')),
  add column if not exists authority_promoted_by uuid references auth.users(id),
  add column if not exists authority_promoted_at timestamptz,
  add column if not exists authority_promotion_note text;

-- Backfill BEFORE the trigger exists (see header). Guarded on the trigger's
-- absence so a replay of this file cannot re-run the backfill into the
-- invariant it installs.
do $backfill$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_requirement_authority_provenance'
      and tgrelid = 'public.stage_gate_criteria'::regclass
  ) then
    update stage_gate_criteria
    set source_authority = 'INDUSTRY_GUIDANCE'
    where gate_id is null and source_authority = 'BEST_PRACTICE'
      and authority_promoted_at is null;
  end if;
end $backfill$;

-- The ladder, as a function both the trigger and reviewers can consult.
create or replace function public.source_authority_rank(p_tier text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_tier
    when 'AI_SUGGESTION' then 1
    when 'BEST_PRACTICE' then 2
    when 'INDUSTRY_GUIDANCE' then 3
    when 'CONTRACT' then 4
    when 'PROJECT_FRAMEWORK' then 5
    when 'CORPORATE_STANDARD' then 6
    when 'REGULATION' then 7
    when 'LAW' then 8
    else 0 end;
$$;

revoke all on function public.source_authority_rank(text) from public, anon;
grant execute on function public.source_authority_rank(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The promotion invariant (D3.15).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_requirement_authority_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.requirement_authority_write', true), '');
begin
  if tg_op = 'UPDATE'
     and source_authority_rank(new.source_authority) > source_authority_rank(old.source_authority) then
    if v_marker <> 'granted' then
      raise exception
        'Provenance tier escalation refused: raising % to % requires a recorded human '
        'approval through promote_requirement_authority(criterion_id, tier, note). An '
        'AI suggestion never silently becomes a corporate requirement (D3.15).',
        old.source_authority, new.source_authority
        using errcode = 'insufficient_privilege';
    end if;
    -- Even on the marked path, the approval must be RECORDED, not implied.
    if new.authority_promoted_by is null
       or coalesce(length(btrim(new.authority_promotion_note)), 0) < 20 then
      raise exception
        'A provenance promotion carries its human approval: promoted_by and a note of '
        'at least 20 characters naming the authority for the new tier.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_requirement_authority_provenance on public.stage_gate_criteria;
create trigger trg_requirement_authority_provenance
  before update on public.stage_gate_criteria
  for each row execute function public.enforce_requirement_authority_provenance();

-- ---------------------------------------------------------------------------
-- The adopted-framework immutability backstop for gate-scoped requirements —
-- the same wall 20261101090100 builds behind frameworks/stages/gates, on the
-- columns THIS file owns. What it guards on a criterion whose gate belongs to
-- a non-draft framework: the CONTENT — text, the mandatory flag (flipping
-- is_mandatory off silently disarms a gate), guidance, ordering, category,
-- evidence_type, minimum_confidence, and its scope (stage_key/gate_id) — plus
-- INSERT into and DELETE from such a gate. What it deliberately does NOT
-- guard: the provenance columns (source_authority + promotion record), which
-- belong to the promotion machinery above — raises are policed by
-- trg_requirement_authority_provenance for every caller, demotion stays free,
-- and both remain legitimate on adopted frameworks because provenance is a
-- property of the organization's claim, not of the framework version.
-- Stage-scoped rows (gate_id null, the asset-stage list) are outside this
-- boundary. Naming note: 'f' < 'r', so this trigger fires before the
-- promotion trigger; a provenance-only update passes through here untouched.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_framework_requirement_immutability()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.framework_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_gate_id bigint := case when tg_op = 'DELETE' then old.gate_id else new.gate_id end;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  v_fw_status text;
  v_guarded boolean := false;
begin
  -- A re-scope between gates is judged against the stricter side.
  if tg_op = 'UPDATE' and new.gate_id is distinct from old.gate_id then
    if old.gate_id is not null then
      select f.status into v_fw_status
      from stage_gates g join project_frameworks f on f.id = g.framework_id
      where g.id = old.gate_id;
      if found and v_fw_status <> 'draft' then
        v_guarded := true;
      end if;
    end if;
  end if;

  if not v_guarded then
    if v_gate_id is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    select f.status into v_fw_status
    from stage_gates g join project_frameworks f on f.id = g.framework_id
    where g.id = v_gate_id;
    if not found or v_fw_status = 'draft' then
      -- Draft framework, or gate mid-cascade-delete: not this boundary.
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'UPDATE' then
      v_guarded := new.criterion is distinct from old.criterion
                or new.is_mandatory is distinct from old.is_mandatory
                or new.guidance is distinct from old.guidance
                or new.sort_order is distinct from old.sort_order
                or new.category is distinct from old.category
                or new.evidence_type is distinct from old.evidence_type
                or new.minimum_confidence is distinct from old.minimum_confidence
                or new.stage_key is distinct from old.stage_key
                or new.gate_id is distinct from old.gate_id;
    else
      v_guarded := true;
    end if;
  end if;

  if not v_guarded then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not v_client and current_user not in ('authenticated', 'anon') then
    if v_marker <> 'granted'
       and exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         'Adopted-framework requirement content on stage_gate_criteria (' || lower(tg_op)
           || ', row ' || (case when tg_op = 'DELETE' then old.id::text else new.id::text end)
           || ') written by a service caller outside the framework RPCs. An adopted '
           || 'framework version''s requirements are immutable to clients; a service '
           || 'rewrite is recorded because it changes what past gate decisions required.');
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'An adopted framework version is immutable — its requirements (text, mandatory '
      'flag, thresholds, scope) are the record of what its gates demanded. Change '
      'arrives as a new version (create_project_framework_version); provenance moves '
      'only through its own governed machinery (promote_requirement_authority).'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_framework_requirement_immutability on public.stage_gate_criteria;
create trigger trg_framework_requirement_immutability
  before insert or update or delete on public.stage_gate_criteria
  for each row execute function public.enforce_framework_requirement_immutability();

-- ---------------------------------------------------------------------------
-- Requirement authoring (RPC-first this slice; a page is a later slice).
-- Tier changes through this path go DOWN only; raising routes through the
-- promotion RPC so the human approval is never implicit.
-- ---------------------------------------------------------------------------
create or replace function public.set_gate_requirement(
  p_gate_id bigint,
  p_criterion text,
  p_is_mandatory boolean,
  p_source_authority text,
  p_category text default null,
  p_evidence_type text default null,
  p_minimum_confidence numeric default null,
  p_guidance text default null,
  p_sort_order int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  g stage_gates%rowtype;
  f project_frameworks%rowtype;
  v_existing stage_gate_criteria%rowtype;
  v_id bigint;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'authoring gate requirements requires a governance or engineering role');
  end if;
  select * into g from stage_gates where id = p_gate_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'gate not found');
  end if;
  select * into f from project_frameworks where id = g.framework_id;
  if f.status <> 'draft' then
    return jsonb_build_object('error',
      'an adopted framework version is immutable — create a new version to change its requirements');
  end if;
  if coalesce(length(btrim(p_criterion)), 0) < 5 then
    return jsonb_build_object('error', 'a requirement states what must be established (5 characters minimum)');
  end if;
  if source_authority_rank(p_source_authority) = 0 then
    return jsonb_build_object('error', 'source_authority must be one of the eight provenance tiers');
  end if;
  if p_source_authority in ('LAW','REGULATION','CORPORATE_STANDARD','CONTRACT')
     and coalesce(length(btrim(p_guidance)), 0) < 20 then
    return jsonb_build_object('error',
      'a requirement at the ' || p_source_authority || ' tier names the instrument it comes from in guidance (20 characters minimum)');
  end if;
  if p_minimum_confidence is not null and (p_minimum_confidence < 0 or p_minimum_confidence > 1) then
    return jsonb_build_object('error', 'minimum_confidence is a fraction between 0 and 1');
  end if;

  select * into v_existing from stage_gate_criteria
  where organization_id = v_org and gate_id = g.id and criterion = btrim(p_criterion);

  if found and source_authority_rank(p_source_authority) > source_authority_rank(v_existing.source_authority) then
    return jsonb_build_object('error',
      format('raising this requirement''s provenance (%s to %s) is a recorded human act — use promote_requirement_authority',
             v_existing.source_authority, p_source_authority));
  end if;

  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, minimum_confidence, source_authority)
  values
    (v_org, g.stage_key, g.id, btrim(p_criterion), coalesce(p_is_mandatory, true),
     p_guidance, coalesce(p_sort_order, 100), nullif(btrim(coalesce(p_category,'')), ''),
     nullif(btrim(coalesce(p_evidence_type,'')), ''), p_minimum_confidence, p_source_authority)
  on conflict (gate_id, criterion) where gate_id is not null do update set
    is_mandatory = excluded.is_mandatory,
    guidance = excluded.guidance,
    sort_order = excluded.sort_order,
    category = excluded.category,
    evidence_type = excluded.evidence_type,
    minimum_confidence = excluded.minimum_confidence,
    source_authority = excluded.source_authority
  returning id into v_id;

  return jsonb_build_object('criterion_id', v_id, 'gate_id', g.id,
    'source_authority', p_source_authority);
end
$$;

revoke all on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int) from public, anon;
grant execute on function public.set_gate_requirement(bigint, text, boolean, text, text, text, numeric, text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The recorded human approval that a tier raise requires (D3.15).
-- admin / executive only: promotion is an act of organizational authority,
-- and the AI-operator identity is deliberately not on the list.
-- ---------------------------------------------------------------------------
create or replace function public.promote_requirement_authority(
  p_criterion_id bigint,
  p_to_authority text,
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
  r stage_gate_criteria%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive') then
    return jsonb_build_object('error',
      'promoting a requirement''s provenance tier requires an executive or administrator — it asserts the organization now stands behind it at that level');
  end if;
  select * into r from stage_gate_criteria
  where id = p_criterion_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'requirement not found');
  end if;
  if source_authority_rank(p_to_authority) = 0 then
    return jsonb_build_object('error', 'target tier must be one of the eight provenance tiers');
  end if;
  if source_authority_rank(p_to_authority) <= source_authority_rank(r.source_authority) then
    return jsonb_build_object('error',
      'that is not a promotion — lowering or restating a tier goes through set_gate_requirement');
  end if;
  if coalesce(length(btrim(p_note)), 0) < 20 then
    return jsonb_build_object('error',
      'name the authority for the new tier — the instrument, decision or approval it now rests on (20 characters minimum)');
  end if;

  perform set_config('app.requirement_authority_write', 'granted', true);

  update stage_gate_criteria
  set source_authority = p_to_authority,
      authority_promoted_by = auth.uid(),
      authority_promoted_at = now(),
      authority_promotion_note = btrim(p_note)
  where id = r.id;

  perform set_config('app.requirement_authority_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'gate_requirement_provenance', coalesce(v_role, 'unknown'),
    jsonb_build_object('criterion_id', r.id, 'from', r.source_authority,
      'to', p_to_authority, 'note', btrim(p_note)));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Requirement provenance promoted %s to %s on criterion %s by role %s.',
            r.source_authority, p_to_authority, r.id, coalesce(v_role, 'none')));

  return jsonb_build_object('criterion_id', r.id,
    'source_authority', p_to_authority, 'promoted_by', auth.uid());
end
$$;

revoke all on function public.promote_requirement_authority(bigint, text, text) from public, anon;
grant execute on function public.promote_requirement_authority(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Deep versioning: clone a framework (stages, gates, requirements WITH their
-- provenance) into the next draft version. Copies the
-- create_risk_criteria_version discipline; the clone is a draft and adopts
-- through the same act of authority as any other.
-- ---------------------------------------------------------------------------
create or replace function public.create_project_framework_version(
  p_source_id uuid
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
  v_new uuid;
  v_version int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','ai_admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error', 'versioning a project framework requires a governance or engineering role');
  end if;
  select * into f from project_frameworks where id = p_source_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'source framework not found');
  end if;
  if exists (select 1 from project_frameworks
             where organization_id = v_org and name = f.name and status = 'draft') then
    return jsonb_build_object('error', 'a draft of that framework already exists — adopt or edit it first');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from project_frameworks where organization_id = v_org and name = f.name;

  insert into project_frameworks
    (organization_id, name, version, source, source_authority, status,
     project_classes, basis, created_by)
  values
    (v_org, f.name, v_version, f.source, f.source_authority, 'draft',
     f.project_classes,
     f.basis || format(' | Version %s drafted from version %s.', v_version, f.version),
     auth.uid())
  returning id into v_new;

  insert into project_framework_stages
    (organization_id, framework_id, stage_key, sequence, display_name,
     purpose, entry_criteria, exit_criteria)
  select organization_id, v_new, stage_key, sequence, display_name,
         purpose, entry_criteria, exit_criteria
  from project_framework_stages where framework_id = f.id;

  insert into stage_gates
    (organization_id, framework_id, stage_key, name, sequence, decision_type,
     risk_threshold, readiness_threshold, independent_assurance_required)
  select organization_id, v_new, stage_key, name, sequence, decision_type,
         risk_threshold, readiness_threshold, independent_assurance_required
  from stage_gates where framework_id = f.id;

  -- Requirements travel with their provenance tier AND promotion record —
  -- the promotion happened to this requirement's content and remains true of
  -- it in the new version; severing it would demote silently.
  insert into stage_gate_criteria
    (organization_id, stage_key, gate_id, criterion, is_mandatory, guidance,
     sort_order, category, evidence_type, minimum_confidence, source_authority,
     authority_promoted_by, authority_promoted_at, authority_promotion_note)
  select sc.organization_id, sc.stage_key, ng.id, sc.criterion, sc.is_mandatory,
         sc.guidance, sc.sort_order, sc.category, sc.evidence_type,
         sc.minimum_confidence, sc.source_authority,
         sc.authority_promoted_by, sc.authority_promoted_at, sc.authority_promotion_note
  from stage_gate_criteria sc
  join stage_gates og on og.id = sc.gate_id and og.framework_id = f.id
  join stage_gates ng on ng.framework_id = v_new
    and ng.stage_key = og.stage_key and ng.name = og.name;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'project_framework', coalesce(v_role, 'unknown'),
    jsonb_build_object('framework_id', v_new, 'action', 'version_created',
      'from_version', f.version, 'version', v_version));

  return jsonb_build_object('framework_id', v_new, 'version', v_version, 'status', 'draft');
end
$$;

revoke all on function public.create_project_framework_version(uuid) from public, anon;
grant execute on function public.create_project_framework_version(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- provision_organization, re-created (last definition 20260816090000) with
-- exactly one change: the stage_gate_criteria clone carries the provenance
-- tier and excludes gate-scoped rows. Everything else is byte-identical to
-- the prior definition — diffed at authoring time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_organization(p_name text, p_template_org uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_new uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'an organisation needs a name');
  end if;
  if exists (select 1 from organizations where name = trim(p_name)) then
    return jsonb_build_object('error', 'an organisation with that name already exists');
  end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_new;

  -- Independent reference data first.
  insert into damage_mechanisms (organization_id, mechanism_key, name, description)
  select v_new, mechanism_key, name, description
  from damage_mechanisms where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('damage_mechanisms', v_n);

  insert into detection_techniques (organization_id, technique_key, name, description)
  select v_new, technique_key, name, description
  from detection_techniques where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('detection_techniques', v_n);

  -- Then the matrix, remapped through the keys rather than the ids.
  insert into mechanism_detectability (organization_id, mechanism_id, technique_id,
    detectability, typical_warning, basis)
  select v_new, nm.id, nt.id, d.detectability, d.typical_warning, d.basis
  from mechanism_detectability d
  join damage_mechanisms om on om.id = d.mechanism_id
  join detection_techniques ot on ot.id = d.technique_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  join detection_techniques nt on nt.organization_id = v_new and nt.technique_key = ot.technique_key
  where d.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mechanism_detectability', v_n);

  insert into system_group_candidates (organization_id, source_label, mechanism_id, basis)
  select v_new, c.source_label, nm.id, c.basis
  from system_group_candidates c
  join damage_mechanisms om on om.id = c.mechanism_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  where c.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('system_group_candidates', v_n);

  -- Governance reference data, all reset to DRAFT. See the header: one
  -- tenant's adoption is not another's.
  insert into taxonomy_definitions (organization_id, def_key, title, definition, basis, register_ref, status, version)
  select v_new, def_key, title, definition, basis, register_ref, 'draft', 1
  from taxonomy_definitions where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('taxonomy_definitions', v_n);

  insert into authority_limits (organization_id, role_key, tier_label, max_commitment_usd,
    max_risk_level, max_production_downtime_hours, escalates_to_role, basis, status)
  select v_new, role_key, tier_label, max_commitment_usd, max_risk_level,
         max_production_downtime_hours, escalates_to_role, basis, 'draft'
  from authority_limits where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('authority_limits', v_n);

  insert into retention_policies (organization_id, record_class, table_name, timestamp_column,
    retain_years, basis, status)
  select v_new, record_class, table_name, timestamp_column, retain_years, basis, 'draft'
  from retention_policies where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('retention_policies', v_n);

  insert into governance_standards (organization_id, standard_key, title, requirement,
    mandatory, owner_role, variance_approver_role, basis, status, version)
  select v_new, standard_key, title, requirement, mandatory, owner_role,
         variance_approver_role, basis, 'draft', 1
  from governance_standards where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('governance_standards', v_n);

  insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis, status)
  select v_new, change_class, title, required_role, basis, 'draft'
  from engineering_approval_rules where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engineering_approval_rules', v_n);

  insert into pf_intervals (organization_id, asset_class, failure_mode, detection_technique,
    pf_interval_days, basis, status)
  select v_new, asset_class, failure_mode, detection_technique, pf_interval_days, basis, 'draft'
  from pf_intervals where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pf_intervals', v_n);

  -- Template materials only. Another tenant's real catalogue is their data.
  insert into materials (organization_id, material_code, description, category,
    unit_of_measure, lead_time_days, repairable, criticality, is_template, basis)
  select v_new, material_code, description, category, unit_of_measure, lead_time_days,
         repairable, criticality, true, basis
  from materials where organization_id = p_template_org and is_template;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('materials_templates', v_n);

  insert into ai_agents (organization_id, key, name, category, status, autonomy_mode)
  select v_new, key, name, category, 'active', autonomy_mode
  from ai_agents where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_agents', v_n);

  -- Added by the lifecycle-stages slice. A new tenant with no gate criteria
  -- has gates that block nothing, which looks like control and is not.
  -- Only STAGE-scoped criteria travel (gate_id is null): gate-scoped rows
  -- belong to a framework this clone does not copy, and copying them without
  -- their gate would junk them into the asset-stage list. The provenance
  -- TIER travels with the content; the promotion RECORD does not — nobody in
  -- the new organisation performed that promotion.
  insert into stage_gate_criteria
    (organization_id, stage_key, criterion, is_mandatory, guidance, sort_order,
     category, evidence_type, minimum_confidence, source_authority)
  select v_new, stage_key, criterion, is_mandatory, guidance, sort_order,
         category, evidence_type, minimum_confidence, source_authority
  from stage_gate_criteria where organization_id = p_template_org and gate_id is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stage_gate_criteria', v_n);

  return jsonb_build_object('organization_id', v_new, 'name', trim(p_name),
    'cloned', v_counts,
    'note', 'All governance reference data arrives as DRAFT. Adoption is an act by an accountable person in THIS organisation; inheriting another tenant''s adoptions would manufacture governance nobody performed.');
end
$$;


-- Grants unchanged from 20260813090000: service_role only, revoked from
-- public and anon. Restated so the ratchet reads them beside the definition.
revoke all on function public.provision_organization(text, uuid) from public, anon;
grant execute on function public.provision_organization(text, uuid) to service_role;

notify pgrst, 'reload schema';
