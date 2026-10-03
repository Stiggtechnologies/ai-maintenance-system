-- ============================================================================
-- U2.08 — governed service-level consequences on the canonical dependency graph.
--
-- Canonical reuse only: asset_service_levels remains the service consequence
-- model; assets remains the identity; evidence_items remains the evidence
-- model; audit_events remains the audit trail. Drafts do not influence cascade
-- or restoration analysis until a second named human verifies them.
-- ============================================================================

alter table public.asset_service_levels
  add column if not exists basis text,
  add column if not exists evidence_item_id uuid,
  add column if not exists status text not null default 'draft',
  add column if not exists version integer not null default 1,
  add column if not exists recorded_by uuid references auth.users(id),
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_status_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_status_check
  check (status in ('draft', 'verified', 'superseded'));

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_version_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_version_check check (version >= 1);

alter table public.asset_service_levels
  drop constraint if exists asset_service_levels_review_shape_check;
alter table public.asset_service_levels
  add constraint asset_service_levels_review_shape_check check (
    (status = 'draft' and reviewed_by is null and reviewed_at is null
      and review_note is null)
    or (status = 'verified' and recorded_by is not null
      and reviewed_by is not null and reviewed_at is not null
      and reviewed_by <> recorded_by
      and length(btrim(coalesce(review_note, ''))) >= 20)
    or status = 'superseded'
  );

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_service_levels_asset_tenant_fk'
      and conrelid = 'public.asset_service_levels'::regclass
  ) then
    alter table public.asset_service_levels
      add constraint asset_service_levels_asset_tenant_fk
      foreign key (organization_id, asset_id)
      references public.assets(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'asset_service_levels_evidence_tenant_fk'
      and conrelid = 'public.asset_service_levels'::regclass
  ) then
    alter table public.asset_service_levels
      add constraint asset_service_levels_evidence_tenant_fk
      foreign key (organization_id, evidence_item_id)
      references public.evidence_items(organization_id, id)
      on delete restrict;
  end if;
end
$migration$;

comment on table public.asset_service_levels is
  'U2.08 canonical primary service consequence per asset. Only independently verified rows enter dependency cascade and restoration analysis; a service declaration grants no work, operating, risk-acceptance or restoration authority.';

revoke insert, update, delete, truncate on public.asset_service_levels
  from public, anon, authenticated;

create or replace function public.record_asset_service_level(
  p_asset_id uuid,
  p_service_name text,
  p_beneficiary text,
  p_tolerable_downtime_hours numeric,
  p_consequence_class text,
  p_restoration_rank integer,
  p_notes text,
  p_basis text,
  p_evidence_item_id uuid,
  p_expected_version integer default null
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
  v_current public.asset_service_levels%rowtype;
  v_exists boolean := false;
  v_version integer;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'executive', 'admin') then
    return jsonb_build_object('error',
      'a named same-tenant reliability engineering or accountable management role must author the service consequence; AI identities are not accepted');
  end if;

  if not exists (
    select 1 from public.assets a
    where a.id = p_asset_id and a.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'asset not found in this organization');
  end if;
  if coalesce(length(btrim(p_service_name)), 0) < 3 then
    return jsonb_build_object('error', 'service name must identify the delivered service');
  end if;
  if coalesce(length(btrim(p_beneficiary)), 0) < 3 then
    return jsonb_build_object('error', 'beneficiary must identify who or what receives the service');
  end if;
  if p_tolerable_downtime_hours is not null and (
    p_tolerable_downtime_hours < 0
    or p_tolerable_downtime_hours in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  ) then
    return jsonb_build_object('error', 'tolerable downtime must be a finite non-negative stated value or left unknown');
  end if;
  if p_consequence_class not in
    ('safety', 'environmental', 'regulatory', 'customer', 'production', 'financial') then
    return jsonb_build_object('error', 'unsupported consequence class');
  end if;
  if p_restoration_rank is not null and p_restoration_rank < 1 then
    return jsonb_build_object('error', 'restoration rank must be positive or left unknown');
  end if;
  if coalesce(length(btrim(p_notes)), 0) < 10 then
    return jsonb_build_object('error', 'notes must state the consequence and important limitations');
  end if;
  if coalesce(length(btrim(p_basis)), 0) < 20 then
    return jsonb_build_object('error', 'basis must name the source and limitations (20 characters minimum)');
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = p_evidence_item_id and e.organization_id = v_org
      and (e.asset_id is null or e.asset_id = p_asset_id)
      and e.verification_status = 'verified'
      and e.evidence_class in
        ('MEASURED', 'INSPECTED', 'CALCULATED', 'TESTED',
         'DOCUMENTED', 'HISTORICAL', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
  ) then
    return jsonb_build_object('error',
      'service consequence requires applicable verified same-tenant non-AI evidence');
  end if;

  select * into v_current
  from public.asset_service_levels
  where asset_id = p_asset_id and organization_id = v_org
  for update;
  v_exists := found;

  if v_exists then
    if p_expected_version is null or p_expected_version <> v_current.version then
      return jsonb_build_object('error',
        'service consequence changed since it was loaded; refresh before replacing the draft');
    end if;
    update public.asset_service_levels
    set service_name = btrim(p_service_name),
        beneficiary = btrim(p_beneficiary),
        tolerable_downtime_hours = p_tolerable_downtime_hours,
        consequence_class = p_consequence_class,
        restoration_rank = p_restoration_rank,
        notes = btrim(p_notes),
        basis = btrim(p_basis),
        evidence_item_id = p_evidence_item_id,
        status = 'draft',
        version = version + 1,
        recorded_by = v_uid,
        reviewed_by = null,
        reviewed_at = null,
        review_note = null,
        updated_at = now()
    where asset_id = p_asset_id and organization_id = v_org
    returning version into v_version;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      return jsonb_build_object('error',
        'service consequence does not exist at the expected version');
    end if;
    begin
      insert into public.asset_service_levels (
        asset_id, organization_id, service_name, beneficiary,
        tolerable_downtime_hours, consequence_class, restoration_rank,
        notes, basis, evidence_item_id, status, version, recorded_by, updated_at
      ) values (
        p_asset_id, v_org, btrim(p_service_name), btrim(p_beneficiary),
        p_tolerable_downtime_hours, p_consequence_class, p_restoration_rank,
        btrim(p_notes), btrim(p_basis), p_evidence_item_id,
        'draft', 1, v_uid, now()
      ) returning version into v_version;
    exception when unique_violation then
      return jsonb_build_object('error',
        'service consequence was created concurrently; refresh before editing');
    end;
  end if;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'asset_service_level', v_role, jsonb_build_object(
    'asset_id', p_asset_id, 'service_name', btrim(p_service_name),
    'consequence_class', p_consequence_class,
    'tolerable_downtime_hours', p_tolerable_downtime_hours,
    'restoration_rank', p_restoration_rank, 'version', v_version,
    'status', 'draft', 'evidence_item_id', p_evidence_item_id,
    'recorded_by', v_uid,
    'boundary', 'Draft service consequence only; it does not enter cascade or restoration analysis and grants no work, operating, risk-acceptance or restoration authority.'));

  return jsonb_build_object(
    'asset_id', p_asset_id, 'version', v_version, 'status', 'draft',
    'note', 'Service consequence recorded as a draft for independent human verification.');
end
$$;

create or replace function public.verify_asset_service_level(
  p_asset_id uuid,
  p_expected_version integer,
  p_review_note text
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
  v_level public.asset_service_levels%rowtype;
  v_version integer;
begin
  if v_org is null or v_uid is null or coalesce(v_role, '') not in
    ('reliability_engineer', 'maintenance_manager', 'executive', 'admin') then
    return jsonb_build_object('error',
      'independent service-consequence verification requires a named engineering or accountable management role');
  end if;

  select * into v_level
  from public.asset_service_levels
  where asset_id = p_asset_id and organization_id = v_org
  for update;
  if not found then
    return jsonb_build_object('error', 'service consequence not found in this organization');
  end if;
  if v_level.status <> 'draft' then
    return jsonb_build_object('error', 'only a current draft can be verified');
  end if;
  if p_expected_version is null or p_expected_version <> v_level.version then
    return jsonb_build_object('error',
      'service consequence changed since review began; refresh before verifying');
  end if;
  if v_level.recorded_by is null then
    return jsonb_build_object('error',
      'legacy service consequence has no named author and must be re-recorded before verification');
  end if;
  if v_level.recorded_by = v_uid then
    return jsonb_build_object('error', 'the author cannot verify their own service consequence');
  end if;
  if coalesce(length(btrim(p_review_note)), 0) < 20 then
    return jsonb_build_object('error', 'verification note must state the independent review basis');
  end if;
  if not exists (
    select 1 from public.evidence_items e
    where e.id = v_level.evidence_item_id and e.organization_id = v_org
      and (e.asset_id is null or e.asset_id = v_level.asset_id)
      and e.verification_status = 'verified'
      and e.evidence_class in
        ('MEASURED', 'INSPECTED', 'CALCULATED', 'TESTED',
         'DOCUMENTED', 'HISTORICAL', 'EXPERT_JUDGEMENT')
      and nullif(btrim(coalesce(e.source_system, '')), '') is not null
      and coalesce(length(btrim(e.description)), 0) >= 10
  ) then
    return jsonb_build_object('error',
      'the linked evidence is no longer verified and applicable; verification is refused');
  end if;

  update public.asset_service_levels
  set status = 'verified',
      version = version + 1,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = btrim(p_review_note),
      updated_at = now()
  where asset_id = p_asset_id and organization_id = v_org
  returning version into v_version;

  insert into public.audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'asset_service_level_verification', v_role, jsonb_build_object(
    'asset_id', p_asset_id, 'service_name', v_level.service_name,
    'version', v_version, 'status', 'verified',
    'recorded_by', v_level.recorded_by, 'reviewed_by', v_uid,
    'evidence_item_id', v_level.evidence_item_id,
    'boundary', 'Independent verification admits the stated service consequence to dependency analysis only; it does not authorize work, operation, risk acceptance or restoration.'));

  return jsonb_build_object(
    'asset_id', p_asset_id, 'version', v_version, 'status', 'verified',
    'note', 'Service consequence independently verified and admitted to dependency analysis.');
end
$$;

revoke all on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer
) from public, anon;
revoke all on function public.verify_asset_service_level(uuid, integer, text)
  from public, anon;
grant execute on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer
) to authenticated;
grant execute on function public.verify_asset_service_level(uuid, integer, text)
  to authenticated;

comment on function public.record_asset_service_level(
  uuid, text, text, numeric, text, integer, text, text, uuid, integer
) is 'Records or replaces a same-tenant service consequence as a draft. Unknown downtime and restoration rank remain null; every edit invalidates prior verification.';
comment on function public.verify_asset_service_level(uuid, integer, text) is
  'Independently verifies the current version against still-valid evidence, admitting it to dependency analysis without granting operational authority.';

-- Only independently verified service consequences affect graph conclusions.
create or replace function public.get_dependency_graph()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'tag', a.tag, 'name', a.name,
        'criticality', a.criticality, 'assetClass', a.asset_class,
        'serviceName', sl.service_name,
        'consequenceClass', sl.consequence_class,
        'tolerableDowntimeHours', sl.tolerable_downtime_hours,
        'restorationRank', sl.restoration_rank
      ) order by a.name)
      from public.assets a
      left join public.asset_service_levels sl
        on sl.asset_id = a.id and sl.organization_id = a.organization_id
       and sl.status = 'verified'
      where a.organization_id = public.app_current_org()
        and (exists (select 1 from public.asset_dependencies d
                     where d.organization_id = a.organization_id
                       and (d.dependent_asset_id = a.id or d.supplier_asset_id = a.id))
             or sl.asset_id is not null)
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dependent', d.dependent_asset_id,
        'supplier', d.supplier_asset_id,
        'kind', d.dependency_kind,
        'redundancyGroup', d.redundancy_group,
        'minRequired', d.min_suppliers_required,
        'capacitySharePct', d.capacity_share_pct,
        'evidence', d.evidence,
        'source', d.source
      ))
      from public.asset_dependencies d
      where d.organization_id = public.app_current_org()
    ), '[]'::jsonb),
    'commonCauseGroups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'causeKind', g.cause_kind,
        'members', coalesce((select jsonb_agg(m.asset_id)
                             from public.common_cause_members m where m.group_id = g.id), '[]'::jsonb)
      ))
      from public.common_cause_groups g
      where g.organization_id = public.app_current_org()
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_dependency_coverage()
returns table (
  total_assets bigint,
  assets_with_edges bigint,
  coverage_pct numeric,
  edge_count bigint,
  demo_edges bigint,
  unevidenced_edges bigint,
  common_cause_groups_defined bigint,
  assets_with_service_level bigint,
  open_candidates bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (
    select count(*)::bigint n from public.assets
    where organization_id = public.app_current_org()
  ),
  linked as (
    select count(distinct id)::bigint n from (
      select dependent_asset_id id from public.asset_dependencies
      where organization_id = public.app_current_org()
      union
      select supplier_asset_id from public.asset_dependencies
      where organization_id = public.app_current_org()
    ) x
  ),
  e as (
    select count(*)::bigint n,
           count(*) filter (where source = 'demo')::bigint demo,
           count(*) filter (where evidence is null or btrim(evidence) = '')::bigint unevidenced
    from public.asset_dependencies
    where organization_id = public.app_current_org()
  )
  select a.n,
         linked.n,
         case when a.n = 0 then 0 else round(linked.n * 100.0 / a.n, 1) end,
         e.n,
         e.demo,
         e.unevidenced,
         (select count(*) from public.common_cause_groups
          where organization_id = public.app_current_org()),
         (select count(*) from public.asset_service_levels
          where organization_id = public.app_current_org() and status = 'verified'),
         (select count(*) from public.dependency_candidates
          where organization_id = public.app_current_org() and status = 'open'),
         case
           when e.n = 0 then
             'No dependency edges are recorded. Any cascade or single-point-of-failure result below is empty because the graph is empty, not because the site is resilient.'
           when linked.n * 100.0 / greatest(a.n, 1) < 25 then
             'Only ' || round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the graph. Findings cover the mapped part of the plant and say nothing about the rest.'
           else
             round(linked.n * 100.0 / greatest(a.n, 1), 1) || '% of assets appear in the dependency graph across '
             || e.n || ' edges'
             || case when e.unevidenced > 0
                     then ', ' || e.unevidenced || ' of them with no recorded evidence' else '' end || '.'
         end
         || case when e.demo > 0 then ' ' || e.demo || ' of these edges are ILLUSTRATIVE DEMO edges, not a mapping of a real plant, and every finding drawn from them demonstrates the method rather than describing equipment.' else '' end
  from a, linked, e;
$$;

grant execute on function public.get_dependency_graph() to authenticated;
grant execute on function public.get_dependency_coverage() to authenticated;

notify pgrst, 'reload schema';
