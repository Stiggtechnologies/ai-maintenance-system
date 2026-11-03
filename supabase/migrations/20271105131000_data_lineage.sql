-- ============================================================================
-- E12.08 — data lineage.
--
-- The other E12 master-data records say who owns a domain, how good it is,
-- and which historian tag a person confirmed. They do not say which source
-- record a canonical row came from, or which prior row a derivation read.
-- This adds that attestation on the existing data_domains register.
--
-- A named maintenance, reliability or administrator human appends an edge.
-- A correction inserts a successor; it does not rewrite the edge it replaces.
-- The function stores the attestation and an audit receipt. It does not call
-- a source system, change stock, merge records, or authorize work.
-- ============================================================================

create table if not exists public.data_lineage_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_domain_id bigint not null references public.data_domains(id) on delete restrict,
  relationship text not null check (relationship in ('sourced_from', 'derived_from')),
  subject_class text not null check (subject_class in (
    'asset', 'sensor', 'work_order', 'material_stock', 'evidence_item')),
  subject_id uuid not null,
  source_system text not null check (char_length(source_system) between 2 and 80),
  source_object text not null check (char_length(source_object) between 2 and 120),
  source_key text not null check (char_length(source_key) between 1 and 240),
  transformation text not null check (char_length(transformation) between 12 and 2000),
  observed_at timestamptz not null,
  basis text not null check (char_length(basis) between 12 and 2000),
  evidence_reference text not null check (char_length(evidence_reference) between 3 and 240),
  parent_edge_id uuid references public.data_lineage_edges(id) on delete restrict,
  supersedes_edge_id uuid references public.data_lineage_edges(id) on delete restrict,
  connector_id uuid references public.connectors(id) on delete restrict,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (relationship <> 'derived_from' or parent_edge_id is not null),
  check (relationship <> 'sourced_from' or parent_edge_id is null),
  check (id is distinct from parent_edge_id),
  check (id is distinct from supersedes_edge_id),
  check (parent_edge_id is null or supersedes_edge_id is null or parent_edge_id <> supersedes_edge_id),
  check (observed_at <= created_at)
);

create index if not exists idx_data_lineage_subject
  on public.data_lineage_edges(organization_id, subject_class, subject_id, created_at desc);
create unique index if not exists idx_data_lineage_one_successor
  on public.data_lineage_edges(supersedes_edge_id)
  where supersedes_edge_id is not null;

alter table public.data_lineage_edges enable row level security;
drop policy if exists data_lineage_edges_read on public.data_lineage_edges;
create policy data_lineage_edges_read on public.data_lineage_edges
  for select to authenticated
  using (organization_id = app_current_org());

revoke insert, update, delete, truncate on public.data_lineage_edges
  from public, anon, authenticated;
grant select on public.data_lineage_edges to authenticated;

create or replace function public.protect_data_lineage_edges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'data lineage edges cannot be truncated';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'data lineage is append-only; record a superseding edge';
  end if;
  if coalesce(current_setting('app.data_lineage_write', true), '') <> 'granted' then
    raise exception 'data lineage is written only by the named-human lineage function';
  end if;
  if new.organization_id is null or new.recorded_by is null then
    raise exception 'data lineage requires a tenant and a named recorder';
  end if;
  return new;
end $$;
revoke all on function public.protect_data_lineage_edges() from public, anon, authenticated;

drop trigger if exists trg_protect_data_lineage_edges on public.data_lineage_edges;
create trigger trg_protect_data_lineage_edges
  before insert or update or delete on public.data_lineage_edges
  for each row execute function public.protect_data_lineage_edges();
drop trigger if exists trg_protect_data_lineage_edges_truncate on public.data_lineage_edges;
create trigger trg_protect_data_lineage_edges_truncate
  before truncate on public.data_lineage_edges
  for each statement execute function public.protect_data_lineage_edges();

create or replace function public.record_data_lineage_edge(
  p_domain_id bigint,
  p_relationship text,
  p_subject_class text,
  p_subject_id uuid,
  p_source_system text,
  p_source_object text,
  p_source_key text,
  p_transformation text,
  p_observed_at timestamptz,
  p_basis text,
  p_evidence_reference text,
  p_parent_edge_id uuid,
  p_supersedes_edge_id uuid,
  p_connector_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_class text := btrim(p_subject_class);
  v_relationship text := btrim(p_relationship);
  v_source_system text := btrim(p_source_system);
  v_source_object text := btrim(p_source_object);
  v_source_key text := btrim(p_source_key);
  v_transformation text := btrim(p_transformation);
  v_basis text := btrim(p_basis);
  v_evidence text := btrim(p_evidence_reference);
  v_id uuid;
  v_open uuid;
  v_cursor uuid;
  v_depth integer := 0;
  v_seen uuid[] := '{}';
  v_parent_org uuid;
  v_parent_domain bigint;
  v_parent_class text;
  v_parent_subject uuid;
  v_parent_next uuid;
  v_previous jsonb;
  v_new jsonb;
begin
  if not public.data_governance_human_role_allowed() then
    return jsonb_build_object('error', 'named human data-lineage authority is required');
  end if;
  if v_relationship not in ('sourced_from', 'derived_from')
     or v_class not in ('asset', 'sensor', 'work_order', 'material_stock', 'evidence_item')
     or p_subject_id is null
     or p_domain_id is null
     or char_length(v_source_system) < 2 or char_length(v_source_system) > 80
     or char_length(v_source_object) < 2 or char_length(v_source_object) > 120
     or char_length(v_source_key) < 1 or char_length(v_source_key) > 240
     or char_length(v_transformation) < 12 or char_length(v_transformation) > 2000
     or char_length(v_basis) < 12 or char_length(v_basis) > 2000
     or char_length(v_evidence) < 3 or char_length(v_evidence) > 240 then
    return jsonb_build_object('error', 'relationship, canonical subject, source identity, transformation, basis and evidence reference are required');
  end if;
  if p_observed_at is null or p_observed_at > now() then
    return jsonb_build_object('error', 'observation time is required and cannot be in the future');
  end if;
  if not exists (
    select 1 from public.data_domains d
    where d.id = p_domain_id and d.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'data domain not found in this organization');
  end if;
  if v_class = 'asset' and not exists (
    select 1 from public.assets a where a.id = p_subject_id and a.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'canonical subject is not in this tenant');
  elsif v_class = 'sensor' and not exists (
    select 1 from public.sensors s where s.id = p_subject_id and s.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'canonical subject is not in this tenant');
  elsif v_class = 'work_order' and not exists (
    select 1 from public.work_orders w where w.id = p_subject_id and w.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'canonical subject is not in this tenant');
  elsif v_class = 'material_stock' and not exists (
    select 1 from public.material_stock m where m.id = p_subject_id and m.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'canonical subject is not in this tenant');
  elsif v_class = 'evidence_item' and not exists (
    select 1 from public.evidence_items e where e.id = p_subject_id and e.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'canonical subject is not in this tenant');
  end if;
  if p_connector_id is not null and not exists (
    select 1 from public.connectors c
    where c.id = p_connector_id and c.organization_id = v_org
  ) then
    return jsonb_build_object('error', 'connector not found in this organization');
  end if;
  if p_supersedes_edge_id is not null then
    if not exists (
      select 1 from public.data_lineage_edges prior
      where prior.id = p_supersedes_edge_id
        and prior.organization_id = v_org
        and prior.data_domain_id = p_domain_id
        and prior.subject_class = v_class
        and prior.subject_id = p_subject_id
    ) then
      return jsonb_build_object('error', 'the superseded lineage edge is not this subject in this organization');
    end if;
    if exists (
      select 1 from public.data_lineage_edges newer
      where newer.supersedes_edge_id = p_supersedes_edge_id
        and newer.organization_id = v_org
    ) then
      return jsonb_build_object('error', 'that lineage edge already has a successor');
    end if;
  end if;
  if v_relationship = 'sourced_from' and p_parent_edge_id is not null then
    return jsonb_build_object('error', 'a sourced-from edge has no parent; record derivation separately');
  end if;
  if v_relationship = 'derived_from' then
    if p_parent_edge_id is null then
      return jsonb_build_object('error', 'a derived lineage edge must name the parent edge it was derived from');
    end if;
    if p_parent_edge_id = p_supersedes_edge_id then
      return jsonb_build_object('error', 'a lineage edge cannot replace the same edge it cites as its parent');
    end if;
    v_cursor := p_parent_edge_id;
    while v_cursor is not null loop
      v_depth := v_depth + 1;
      if v_depth > 20 then
        return jsonb_build_object('error', 'lineage chain exceeds 20 hops and is refused rather than stored as a complete path');
      end if;
      if v_cursor = any(v_seen) then
        return jsonb_build_object('error', 'lineage parent chain contains a cycle');
      end if;
      v_seen := v_seen || v_cursor;
      select e.organization_id, e.data_domain_id, e.subject_class, e.subject_id, e.parent_edge_id
        into v_parent_org, v_parent_domain, v_parent_class, v_parent_subject, v_parent_next
      from public.data_lineage_edges e
      where e.id = v_cursor;
      if not found or v_parent_org is distinct from v_org then
        return jsonb_build_object('error', 'parent lineage edge is not in this organization');
      end if;
      if v_parent_domain is distinct from p_domain_id then
        return jsonb_build_object('error', 'a derived edge must stay in the same data domain as its parent');
      end if;
      if v_depth = 1 and exists (
        select 1 from public.data_lineage_edges newer
        where newer.supersedes_edge_id = v_cursor and newer.organization_id = v_org
      ) then
        return jsonb_build_object('error', 'the parent edge has been superseded; cite the current edge');
      end if;
      if v_parent_class = v_class and v_parent_subject = p_subject_id then
        return jsonb_build_object('error', 'lineage cycle: this subject already appears in the parent chain');
      end if;
      v_cursor := v_parent_next;
    end loop;
  end if;

  select e.id into v_open
  from public.data_lineage_edges e
  where e.organization_id = v_org
    and e.data_domain_id = p_domain_id
    and e.relationship = v_relationship
    and e.subject_class = v_class
    and e.subject_id = p_subject_id
    and e.source_system = v_source_system
    and e.source_object = v_source_object
    and e.source_key = v_source_key
    and e.parent_edge_id is not distinct from p_parent_edge_id
    and e.id is distinct from p_supersedes_edge_id
    and not exists (
      select 1 from public.data_lineage_edges newer
      where newer.supersedes_edge_id = e.id and newer.organization_id = v_org
    )
  order by e.created_at desc
  limit 1;
  if v_open is not null then
    if exists (
      select 1 from public.data_lineage_edges e
      where e.id = v_open
        and e.transformation = v_transformation
        and e.observed_at = p_observed_at
        and e.basis = v_basis
        and e.evidence_reference = v_evidence
        and e.connector_id is not distinct from p_connector_id
        and e.supersedes_edge_id is not distinct from p_supersedes_edge_id
    ) then
      return jsonb_build_object(
        'edgeId', v_open,
        'status', 'already_recorded',
        'writesSourceSystem', false,
        'changesCanonicalValues', false,
        'authorizesWork', false);
    end if;
    return jsonb_build_object('error', 'an open lineage edge already cites this source; supersede it rather than adding a second current edge');
  end if;

  if p_supersedes_edge_id is not null then
    select jsonb_build_object(
      'edgeId', prior.id,
      'relationship', prior.relationship,
      'sourceSystem', prior.source_system,
      'sourceObject', prior.source_object,
      'sourceKey', prior.source_key,
      'transformation', prior.transformation,
      'observedAt', prior.observed_at,
      'basis', prior.basis,
      'evidenceReference', prior.evidence_reference)
    into v_previous
    from public.data_lineage_edges prior
    where prior.id = p_supersedes_edge_id and prior.organization_id = v_org;
  end if;

  perform set_config('app.data_lineage_write', 'granted', true);
  insert into public.data_lineage_edges(
    organization_id, data_domain_id, relationship, subject_class, subject_id,
    source_system, source_object, source_key, transformation, observed_at,
    basis, evidence_reference, parent_edge_id, supersedes_edge_id, connector_id,
    recorded_by)
  values (
    v_org, p_domain_id, v_relationship, v_class, p_subject_id,
    v_source_system, v_source_object, v_source_key, v_transformation, p_observed_at,
    v_basis, v_evidence, p_parent_edge_id, p_supersedes_edge_id, p_connector_id,
    auth.uid())
  returning id into v_id;
  perform set_config('app.data_lineage_write', '', true);

  v_new := jsonb_build_object(
    'edgeId', v_id,
    'domainId', p_domain_id,
    'relationship', v_relationship,
    'subjectClass', v_class,
    'subjectId', p_subject_id,
    'sourceSystem', v_source_system,
    'sourceObject', v_source_object,
    'sourceKey', v_source_key,
    'transformation', v_transformation,
    'observedAt', p_observed_at,
    'basis', v_basis,
    'evidenceReference', v_evidence,
    'parentEdgeId', p_parent_edge_id,
    'supersedesEdgeId', p_supersedes_edge_id,
    'connectorId', p_connector_id,
    'recordedBy', auth.uid());
  insert into public.audit_events(
    organization_id, entity_type, actor, previous_state, new_state, event_data)
  values (
    v_org, 'data_lineage_edge', public.app_current_role(), v_previous, v_new,
    jsonb_build_object(
      'action', 'recorded',
      'edge_id', v_id,
      'actor_id', auth.uid(),
      'writesSourceSystem', false,
      'changesCanonicalValues', false,
      'authorizesWork', false));
  return v_new || jsonb_build_object(
    'status', 'recorded',
    'writesSourceSystem', false,
    'changesCanonicalValues', false,
    'authorizesWork', false);
exception
  when unique_violation then
    perform set_config('app.data_lineage_write', '', true);
    return jsonb_build_object('error', 'this lineage edge was superseded concurrently; reload and cite the current edge');
  when others then
    perform set_config('app.data_lineage_write', '', true);
    raise;
end $$;
revoke all on function public.record_data_lineage_edge(
  bigint, text, text, uuid, text, text, text, text, timestamptz, text, text, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.record_data_lineage_edge(
  bigint, text, text, uuid, text, text, text, text, timestamptz, text, text, uuid, uuid, uuid)
  to authenticated;

create or replace function public.get_data_lineage(
  p_subject_class text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_class text := btrim(p_subject_class);
  v_present boolean := false;
  v_current jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_ancestors jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_edge record;
  v_cursor uuid;
  v_depth integer;
  v_seen uuid[];
  v_parent record;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  if v_class not in ('asset', 'sensor', 'work_order', 'material_stock', 'evidence_item')
     or p_subject_id is null then
    return jsonb_build_object('error', 'a canonical subject class and id are required');
  end if;
  v_present := case v_class
    when 'asset' then exists (select 1 from public.assets a where a.id = p_subject_id and a.organization_id = v_org)
    when 'sensor' then exists (select 1 from public.sensors s where s.id = p_subject_id and s.organization_id = v_org)
    when 'work_order' then exists (select 1 from public.work_orders w where w.id = p_subject_id and w.organization_id = v_org)
    when 'material_stock' then exists (select 1 from public.material_stock m where m.id = p_subject_id and m.organization_id = v_org)
    else exists (select 1 from public.evidence_items e where e.id = p_subject_id and e.organization_id = v_org)
  end;
  if not v_present then
    v_gaps := v_gaps || jsonb_build_array('canonical subject is not in this tenant');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'domainId', e.data_domain_id, 'relationship', e.relationship,
    'subjectClass', e.subject_class, 'subjectId', e.subject_id,
    'sourceSystem', e.source_system, 'sourceObject', e.source_object,
    'sourceKey', e.source_key, 'transformation', e.transformation,
    'observedAt', e.observed_at, 'basis', e.basis,
    'evidenceReference', e.evidence_reference, 'parentEdgeId', e.parent_edge_id,
    'supersedesEdgeId', e.supersedes_edge_id, 'connectorId', e.connector_id,
    'recordedBy', e.recorded_by, 'createdAt', e.created_at, 'current', true
  ) order by e.created_at), '[]'::jsonb)
  into v_current
  from public.data_lineage_edges e
  where e.organization_id = v_org
    and e.subject_class = v_class
    and e.subject_id = p_subject_id
    and not exists (
      select 1 from public.data_lineage_edges newer
      where newer.supersedes_edge_id = e.id and newer.organization_id = v_org
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'relationship', e.relationship, 'sourceSystem', e.source_system,
    'sourceKey', e.source_key, 'supersedesEdgeId', e.supersedes_edge_id,
    'createdAt', e.created_at
  ) order by e.created_at), '[]'::jsonb)
  into v_history
  from public.data_lineage_edges e
  where e.organization_id = v_org
    and e.subject_class = v_class
    and e.subject_id = p_subject_id;

  for v_edge in
    select e.id, e.parent_edge_id, e.relationship
    from public.data_lineage_edges e
    where e.organization_id = v_org
      and e.subject_class = v_class
      and e.subject_id = p_subject_id
      and e.relationship = 'derived_from'
      and not exists (
        select 1 from public.data_lineage_edges newer
        where newer.supersedes_edge_id = e.id and newer.organization_id = v_org
      )
  loop
    v_cursor := v_edge.parent_edge_id;
    v_depth := 0;
    v_seen := '{}';
    while v_cursor is not null loop
      v_depth := v_depth + 1;
      if v_depth > 20 then
        v_truncated := true;
        v_gaps := v_gaps || jsonb_build_array(
          'chain longer than 20 hops; remaining hops are not shown and are not treated as absent');
        exit;
      end if;
      if v_cursor = any(v_seen) then
        v_gaps := v_gaps || jsonb_build_array('lineage parent chain contains a cycle');
        exit;
      end if;
      v_seen := v_seen || v_cursor;
      select e.id, e.organization_id, e.subject_class, e.subject_id, e.relationship,
             e.source_system, e.source_object, e.source_key, e.parent_edge_id
        into v_parent
      from public.data_lineage_edges e
      where e.id = v_cursor and e.organization_id = v_org;
      if not found then
        v_gaps := v_gaps || jsonb_build_array('parent edge is not visible in this tenant');
        exit;
      end if;
      if not exists (
        select 1 from jsonb_array_elements(v_ancestors) item
        where item->>'id' = v_parent.id::text
      ) then
        v_ancestors := v_ancestors || jsonb_build_array(jsonb_build_object(
          'id', v_parent.id,
          'subjectClass', v_parent.subject_class,
          'subjectId', v_parent.subject_id,
          'relationship', v_parent.relationship,
          'sourceSystem', v_parent.source_system,
          'sourceObject', v_parent.source_object,
          'sourceKey', v_parent.source_key,
          'parentEdgeId', v_parent.parent_edge_id));
      end if;
      v_cursor := v_parent.parent_edge_id;
    end loop;
  end loop;

  return jsonb_build_object(
    'subjectClass', v_class,
    'subjectId', p_subject_id,
    'subjectPresent', v_present,
    'currentEdges', v_current,
    'history', v_history,
    'ancestors', v_ancestors,
    'gaps', v_gaps,
    'truncated', v_truncated,
    'writesSourceSystem', false,
    'changesCanonicalValues', false,
    'authorizesWork', false);
end $$;
revoke all on function public.get_data_lineage(text, uuid) from public, anon;
grant execute on function public.get_data_lineage(text, uuid) to authenticated;

create or replace function public.get_data_lineage_register(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_edges jsonb;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error', 'authentication required');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('error', 'lineage register limit must be between 1 and 100');
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_edges
  from (
    select e.id, e.data_domain_id as "domainId", e.relationship,
      e.subject_class as "subjectClass", e.subject_id as "subjectId",
      e.source_system as "sourceSystem", e.source_object as "sourceObject",
      e.source_key as "sourceKey", e.transformation, e.observed_at as "observedAt",
      e.parent_edge_id as "parentEdgeId", e.supersedes_edge_id as "supersedesEdgeId",
      e.created_at as "createdAt",
      not exists (
        select 1 from public.data_lineage_edges newer
        where newer.supersedes_edge_id = e.id and newer.organization_id = v_org
      ) as current
    from public.data_lineage_edges e
    where e.organization_id = v_org
    order by e.created_at desc
    limit p_limit
  ) x;
  return jsonb_build_object(
    'edges', v_edges,
    'writesSourceSystem', false,
    'changesCanonicalValues', false,
    'authorizesWork', false);
end $$;
revoke all on function public.get_data_lineage_register(integer) from public, anon;
grant execute on function public.get_data_lineage_register(integer) to authenticated;

notify pgrst, 'reload schema';
