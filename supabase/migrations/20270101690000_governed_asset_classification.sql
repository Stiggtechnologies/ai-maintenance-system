-- ============================================================================
-- U3.05 — customer-reachable, governed asset classification.
--
-- Canonical reuse only:
--   * assets / asset_class_profiles / asset_class_assignments are the identity
--     and ontology records;
--   * evidence_items is the ONE evidence store;
--   * asset_condition_assessments remains the condition-rating overlay;
--   * audit_events is the ONE audit trail.
--
-- This migration does not create another structural-inspection table. A named
-- human classifies an existing tenant asset from named-human verified,
-- non-AI evidence. Civil/structural condition is then expressed through the
-- existing governed condition assessment and specialist paths, never through a
-- machine-style failure rate or an invented rating scale.
-- ============================================================================

alter table public.asset_class_assignments
  add column if not exists evidence_item_id uuid;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_class_assignments_evidence_tenant_fk'
      and conrelid = 'public.asset_class_assignments'::regclass
  ) then
    alter table public.asset_class_assignments
      add constraint asset_class_assignments_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;
end
$migration$;

comment on column public.asset_class_assignments.evidence_item_id is
  'Verified canonical evidence supporting the human asset-class determination. Legacy seeded assignments remain nullable; every customer write through assign_asset_class_profile requires it.';

create or replace function public.assign_asset_class_profile(
  p_asset_id uuid,
  p_class_key text,
  p_basis text,
  p_evidence_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text := public.app_current_role();
  v_uid uuid := auth.uid();
  v_profile public.asset_class_profiles%rowtype;
  v_evidence public.evidence_items%rowtype;
  v_old public.asset_class_assignments%rowtype;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object(
      'error',
      'asset classification requires a named same-tenant reliability engineering, maintenance management, or administrator role; AI identities cannot classify assets'
    );
  end if;

  if not exists (
    select 1 from public.assets
    where id = p_asset_id and organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;

  select * into v_profile
  from public.asset_class_profiles
  where class_key = nullif(btrim(coalesce(p_class_key, '')), '');
  if not found then
    return jsonb_build_object('error', 'asset class profile is not registered');
  end if;

  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object(
      'error',
      'classification basis must state the observed identity and limitations (20 characters minimum)'
    );
  end if;

  select * into v_evidence
  from public.evidence_items
  where id = p_evidence_item_id
    and organization_id = v_org
    and verification_status = 'verified'
    and evidence_class in
      ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
    and nullif(btrim(coalesce(source_system, '')), '') is not null
    and coalesce(length(btrim(description)), 0) >= 10
    and (asset_id is null or asset_id = p_asset_id);
  if not found then
    return jsonb_build_object(
      'error',
      'classification requires verified same-tenant measured, inspected, documented, or expert-judgement evidence applicable to this asset'
    );
  end if;

  select * into v_old
  from public.asset_class_assignments
  where asset_id = p_asset_id and organization_id = v_org
  for update;

  insert into public.asset_class_assignments (
    asset_id,
    organization_id,
    class_key,
    assigned_by,
    assigned_at,
    basis,
    evidence_item_id
  ) values (
    p_asset_id,
    v_org,
    v_profile.class_key,
    v_uid,
    now(),
    btrim(p_basis),
    v_evidence.id
  )
  on conflict (asset_id) do update set
    organization_id = excluded.organization_id,
    class_key = excluded.class_key,
    assigned_by = excluded.assigned_by,
    assigned_at = excluded.assigned_at,
    basis = excluded.basis,
    evidence_item_id = excluded.evidence_item_id;

  insert into public.audit_events (
    organization_id,
    entity_type,
    actor,
    event_data
  ) values (
    v_org,
    'asset_class_assignment',
    v_role,
    jsonb_build_object(
      'asset_id', p_asset_id,
      'previous_class_key', v_old.class_key,
      'class_key', v_profile.class_key,
      'measurement_basis', v_profile.measurement_basis,
      'evidence_item_id', v_evidence.id,
      'assigned_by', v_uid,
      'boundary', 'Classification controls applicable analysis only; it does not establish condition, structural capacity, safety, a limit, a recommendation, work, or approval.'
    )
  );

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'class_key', v_profile.class_key,
    'measurement_basis', v_profile.measurement_basis,
    'evidence_item_id', v_evidence.id,
    'status', 'assigned',
    'note', 'Asset class recorded from verified evidence. Condition and engineering determinations remain separate governed acts.'
  );
end
$$;

revoke all on function public.assign_asset_class_profile(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.assign_asset_class_profile(uuid, text, text, uuid)
  to authenticated, service_role;

comment on function public.assign_asset_class_profile(uuid, text, text, uuid) is
  'U3.05 governed asset-class assignment. Same-tenant named humans use named-human verified non-AI canonical evidence; the act grants no condition, structural-safety, work, recommendation, limit, or approval authority.';

notify pgrst, 'reload schema';
