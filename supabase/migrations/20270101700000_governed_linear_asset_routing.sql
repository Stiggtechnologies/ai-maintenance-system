-- ============================================================================
-- U3.03 — governed linear-asset routes, sections and observed defects.
--
-- Canonical reuse only: assets + asset_class_assignments identify the thing;
-- linear_asset_routes / linear_segments / linear_defects hold linear position;
-- evidence_items is the ONE evidence store; audit_events is the ONE audit log.
-- No parallel inspection, recommendation, work or approval model is created.
-- ============================================================================

alter table public.linear_asset_routes
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid,
  add column if not exists recorded_by uuid references auth.users(id);

alter table public.linear_segments
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid,
  add column if not exists recorded_by uuid references auth.users(id);

alter table public.linear_defects
  add column if not exists evidence_item_id uuid,
  add column if not exists recorded_by uuid references auth.users(id);

create unique index if not exists linear_asset_routes_org_identity
  on public.linear_asset_routes(organization_id, id);

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_asset_routes_asset_tenant_fk'
      and conrelid = 'public.linear_asset_routes'::regclass
  ) then
    alter table public.linear_asset_routes
      add constraint linear_asset_routes_asset_tenant_fk
      foreign key (organization_id, asset_id)
      references public.assets(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_asset_routes_evidence_tenant_fk'
      and conrelid = 'public.linear_asset_routes'::regclass
  ) then
    alter table public.linear_asset_routes
      add constraint linear_asset_routes_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_segments_route_tenant_fk'
      and conrelid = 'public.linear_segments'::regclass
  ) then
    alter table public.linear_segments
      add constraint linear_segments_route_tenant_fk
      foreign key (organization_id, route_id)
      references public.linear_asset_routes(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_segments_evidence_tenant_fk'
      and conrelid = 'public.linear_segments'::regclass
  ) then
    alter table public.linear_segments
      add constraint linear_segments_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_defects_route_tenant_fk'
      and conrelid = 'public.linear_defects'::regclass
  ) then
    alter table public.linear_defects
      add constraint linear_defects_route_tenant_fk
      foreign key (organization_id, route_id)
      references public.linear_asset_routes(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'linear_defects_evidence_tenant_fk'
      and conrelid = 'public.linear_defects'::regclass
  ) then
    alter table public.linear_defects
      add constraint linear_defects_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;
end
$migration$;

comment on column public.linear_asset_routes.evidence_item_id is
  'Verified canonical evidence supporting the route identity and extent. Legacy demo rows remain nullable; governed customer writes require evidence.';
comment on column public.linear_segments.evidence_item_id is
  'Verified canonical evidence supporting the stated section boundaries and attributes.';
comment on column public.linear_defects.evidence_item_id is
  'Verified canonical observation supporting the defect type, location and detection method.';

create or replace function public.record_linear_asset_route(
  p_asset_id uuid,
  p_route_code text,
  p_measure_unit text,
  p_start_measure numeric,
  p_end_measure numeric,
  p_description text,
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
  v_route_id bigint;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error',
      'recording a linear route requires a named same-tenant reliability engineering, maintenance management, or administrator role; AI identities cannot establish route truth');
  end if;

  if not exists (
    select 1
    from public.assets a
    join public.asset_class_assignments c
      on c.asset_id = a.id and c.organization_id = a.organization_id
    where a.id = p_asset_id and a.organization_id = v_org
      and c.class_key = 'linear'
  ) then
    return jsonb_build_object('error',
      'asset must belong to this organization and carry the governed linear class before a route can be recorded');
  end if;

  if coalesce(length(btrim(p_route_code)), 0) < 3
     or length(btrim(p_route_code)) > 80 then
    return jsonb_build_object('error', 'route code must contain 3 to 80 characters');
  end if;
  if p_measure_unit not in ('km', 'm', 'mi', 'ft', 'chain') then
    return jsonb_build_object('error', 'measure unit must be km, m, mi, ft, or chain');
  end if;
  if p_start_measure is null or p_end_measure is null
     or p_start_measure::text = 'NaN' or p_end_measure::text = 'NaN'
     or p_end_measure <= p_start_measure then
    return jsonb_build_object('error', 'route end measure must be greater than its start measure');
  end if;
  if coalesce(length(btrim(p_description)), 0) < 10 then
    return jsonb_build_object('error', 'route description must identify the linear asset (10 characters minimum)');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'route basis must state the source and limitations (20 characters minimum)');
  end if;

  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id
      and e.organization_id = v_org
      and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
      and (e.asset_id is null or e.asset_id = p_asset_id)
  ) then
    return jsonb_build_object('error',
      'route creation requires verified same-tenant measured, inspected, documented, or expert-judgement evidence applicable to this asset');
  end if;

  begin
    insert into public.linear_asset_routes (
      organization_id, asset_id, route_code, measure_unit,
      start_measure, end_measure, description, basis,
      evidence_item_id, recorded_by
    ) values (
      v_org, p_asset_id, btrim(p_route_code), p_measure_unit,
      p_start_measure, p_end_measure, btrim(p_description), btrim(p_basis),
      p_evidence_item_id, v_uid
    ) returning id into v_route_id;
  exception when unique_violation then
    return jsonb_build_object('error', 'route code already exists in this organization');
  end;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'linear_asset_route', v_role, jsonb_build_object(
    'route_id', v_route_id, 'asset_id', p_asset_id,
    'route_code', btrim(p_route_code), 'measure_unit', p_measure_unit,
    'start_measure', p_start_measure, 'end_measure', p_end_measure,
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'Route geometry establishes location and exposure only; it does not establish condition, capacity, an operating limit, work, a recommendation, repair completion, or approval.'));

  return jsonb_build_object(
    'route_id', v_route_id, 'asset_id', p_asset_id,
    'route_code', btrim(p_route_code), 'measure_unit', p_measure_unit,
    'start_measure', p_start_measure, 'end_measure', p_end_measure,
    'status', 'recorded',
    'note', 'Route identity and extent recorded from verified evidence; engineering and operating determinations remain separate governed acts.');
end
$$;

create or replace function public.record_linear_segment(
  p_route_id bigint,
  p_from_measure numeric,
  p_to_measure numeric,
  p_attributes jsonb,
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
  v_route public.linear_asset_routes%rowtype;
  v_segment_id bigint;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording a linear section requires a named authorized human role');
  end if;

  select * into v_route from public.linear_asset_routes
  where id = p_route_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'linear route not found in this organization');
  end if;

  if p_from_measure is null or p_to_measure is null
     or p_from_measure::text = 'NaN' or p_to_measure::text = 'NaN'
     or p_from_measure < v_route.start_measure
     or p_to_measure > v_route.end_measure
     or p_to_measure <= p_from_measure then
    return jsonb_build_object('error', 'section measures must form a positive interval inside the route bounds');
  end if;
  if coalesce(jsonb_typeof(p_attributes), '') <> 'object' then
    return jsonb_build_object('error', 'section attributes must be a JSON object');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'section basis must state the source and limitations (20 characters minimum)');
  end if;
  if exists (
    select 1 from public.linear_segments s
    where s.organization_id = v_org and s.route_id = v_route.id
      and p_from_measure < s.to_measure and p_to_measure > s.from_measure
  ) then
    return jsonb_build_object('error', 'section overlaps an existing section; correct the canonical boundaries instead of duplicating coverage');
  end if;

  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
      and (e.asset_id is null or e.asset_id = v_route.asset_id)
  ) then
    return jsonb_build_object('error', 'section requires applicable verified same-tenant non-AI evidence');
  end if;

  insert into public.linear_segments (
    organization_id, route_id, from_measure, to_measure, attributes,
    basis, evidence_item_id, recorded_by
  ) values (
    v_org, v_route.id, p_from_measure, p_to_measure, coalesce(p_attributes, '{}'::jsonb),
    btrim(p_basis), p_evidence_item_id, v_uid
  ) returning id into v_segment_id;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'linear_segment', v_role, jsonb_build_object(
    'segment_id', v_segment_id, 'route_id', v_route.id,
    'from_measure', p_from_measure, 'to_measure', p_to_measure,
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'A section is an evidence-backed location model, not a condition, capacity, limit, work or approval determination.'));

  return jsonb_build_object('segment_id', v_segment_id, 'route_id', v_route.id,
    'status', 'recorded', 'note', 'Section recorded; supplied attributes remain evidence-bound observations, not approved engineering limits.');
end
$$;

create or replace function public.record_linear_defect(
  p_route_id bigint,
  p_at_measure numeric,
  p_defect_type text,
  p_severity text,
  p_detection_method text,
  p_detected_at timestamptz,
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
  v_route public.linear_asset_routes%rowtype;
  v_defect_id bigint;
  v_detected_at timestamptz := coalesce(p_detected_at, now());
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'admin') then
    return jsonb_build_object('error', 'recording a linear defect requires a named authorized human role');
  end if;

  select * into v_route from public.linear_asset_routes
  where id = p_route_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'linear route not found in this organization');
  end if;

  if p_at_measure is null or p_at_measure::text = 'NaN'
     or p_at_measure < v_route.start_measure or p_at_measure > v_route.end_measure then
    return jsonb_build_object('error', 'defect location must fall inside the route bounds');
  end if;
  if coalesce(length(btrim(p_defect_type)), 0) < 3 then
    return jsonb_build_object('error', 'defect type must contain at least 3 characters');
  end if;
  if p_severity is not null and p_severity not in ('minor', 'moderate', 'major', 'critical') then
    return jsonb_build_object('error', 'severity must be minor, moderate, major, critical, or left unstated');
  end if;
  if coalesce(length(btrim(p_detection_method)), 0) < 5 then
    return jsonb_build_object('error', 'detection method must identify how the observation was made');
  end if;
  if v_detected_at > now() then
    return jsonb_build_object('error', 'detected-at time cannot be in the future');
  end if;

  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and e.verification_status = 'verified'
      and e.evidence_class in ('MEASURED', 'INSPECTED', 'DOCUMENTED', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
      and (e.asset_id is null or e.asset_id = v_route.asset_id)
  ) then
    return jsonb_build_object('error', 'defect capture requires applicable verified same-tenant non-AI evidence');
  end if;

  insert into public.linear_defects (
    organization_id, route_id, at_measure, detected_at, defect_type,
    severity, detection_method, evidence_item_id, recorded_by
  ) values (
    v_org, v_route.id, p_at_measure, v_detected_at, btrim(p_defect_type),
    p_severity, btrim(p_detection_method), p_evidence_item_id, v_uid
  ) returning id into v_defect_id;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'linear_defect', v_role, jsonb_build_object(
    'defect_id', v_defect_id, 'route_id', v_route.id,
    'at_measure', p_at_measure, 'defect_type', btrim(p_defect_type),
    'severity', p_severity, 'detected_at', v_detected_at,
    'evidence_item_id', p_evidence_item_id, 'recorded_by', v_uid,
    'boundary', 'The record is an observed defect, not a repair decision, operating restriction, fitness-for-service determination, recommendation, work order, or approval.'));

  return jsonb_build_object('defect_id', v_defect_id, 'route_id', v_route.id,
    'status', 'recorded',
    'note', 'Observed defect recorded. Severity is the named human classification supplied with the evidence; SyncAI has not determined fitness for service or repair.');
end
$$;

revoke all on function public.record_linear_asset_route(uuid, text, text, numeric, numeric, text, text, uuid)
  from public, anon;
revoke all on function public.record_linear_segment(bigint, numeric, numeric, jsonb, text, uuid)
  from public, anon;
revoke all on function public.record_linear_defect(bigint, numeric, text, text, text, timestamptz, uuid)
  from public, anon;

grant execute on function public.record_linear_asset_route(uuid, text, text, numeric, numeric, text, text, uuid)
  to authenticated;
grant execute on function public.record_linear_segment(bigint, numeric, numeric, jsonb, text, uuid)
  to authenticated;
grant execute on function public.record_linear_defect(bigint, numeric, text, text, text, timestamptz, uuid)
  to authenticated;

comment on function public.record_linear_asset_route(uuid, text, text, numeric, numeric, text, text, uuid) is
  'U3.03 governed customer route creation. Requires a pre-classified same-tenant linear asset and verified canonical non-AI evidence; grants no engineering, work or approval authority.';
comment on function public.record_linear_segment(bigint, numeric, numeric, jsonb, text, uuid) is
  'U3.03 governed non-overlapping section capture within canonical route bounds, from verified evidence.';
comment on function public.record_linear_defect(bigint, numeric, text, text, text, timestamptz, uuid) is
  'U3.03 governed evidence-backed defect observation within canonical route bounds; does not determine fitness for service or repair.';

notify pgrst, 'reload schema';
