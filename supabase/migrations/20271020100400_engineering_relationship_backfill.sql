-- Backfill canonical engineering relationships.
--
-- Edges point at canonical ids. They do not copy twins, chunk text, evidence
-- bodies, or asset rows. Provenance is a chunk id and/or a canonical id that
-- already existed. Backfill always stores review_state = draft. A relationship
-- does not grant permission, work release, or approval.

create table if not exists public.engineering_knowledge_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_code text not null,
  relationship_type text not null check (relationship_type in (
    'contains', 'composed_of', 'may_fail_by', 'governed_by', 'detected_by', 'verified_by',
    'explained_by', 'supported_by', 'contradicted_by', 'applies_to', 'observed_on',
    'resulted_in', 'resolved_by', 'similar_to', 'supersedes'
  )),
  from_entity_type text not null check (from_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case'
  )),
  from_canonical_id text not null,
  to_entity_type text not null check (to_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case'
  )),
  to_canonical_id text not null,
  provenance_chunk_ids uuid[] not null default '{}',
  provenance_canonical_ids text[] not null default '{}',
  review_state text not null default 'draft' check (review_state in (
    'draft', 'in_review', 'approved', 'rejected', 'superseded'
  )),
  confidence numeric(5,4),
  created_by_kind text not null check (created_by_kind in ('system', 'human', 'agent', 'migration')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, relationship_code),
  check (from_entity_type <> to_entity_type or from_canonical_id <> to_canonical_id),
  check (
    coalesce(cardinality(provenance_chunk_ids), 0) > 0
    or coalesce(cardinality(provenance_canonical_ids), 0) > 0
  ),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists engineering_knowledge_relationships_from_idx
  on public.engineering_knowledge_relationships (organization_id, from_entity_type, from_canonical_id);
create index if not exists engineering_knowledge_relationships_to_idx
  on public.engineering_knowledge_relationships (organization_id, to_entity_type, to_canonical_id);

alter table public.engineering_knowledge_relationships enable row level security;
drop policy if exists engineering_knowledge_relationships_org_read
  on public.engineering_knowledge_relationships;
create policy engineering_knowledge_relationships_org_read
  on public.engineering_knowledge_relationships
  for select to authenticated
  using (organization_id = app_current_org());

revoke all on public.engineering_knowledge_relationships from public, anon, authenticated;
grant select on public.engineering_knowledge_relationships to authenticated;

comment on table public.engineering_knowledge_relationships is
  'Canonical engineering edges. Ids only; no copied twins, documents, or evidence. A relationship grants no permission, work release, or approval.';

create or replace function public.insert_knowledge_relationship_edge(
  p_code text,
  p_relationship text,
  p_from_type text,
  p_from_id text,
  p_to_type text,
  p_to_id text,
  p_chunks uuid[],
  p_canonical text[],
  p_confidence numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_id uuid;
  v_chunk uuid;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if nullif(trim(coalesce(p_from_id, '')), '') is null
     or nullif(trim(coalesce(p_to_id, '')), '') is null
     or nullif(trim(coalesce(p_code, '')), '') is null then
    raise exception 'Relationship endpoints and code are required';
  end if;
  if p_from_type = p_to_type and left(trim(p_from_id), 500) = left(trim(p_to_id), 500) then
    raise exception 'A relationship cannot point an entity to itself';
  end if;
  if coalesce(cardinality(p_chunks), 0) = 0 and coalesce(cardinality(p_canonical), 0) = 0 then
    raise exception 'Relationship provenance is required';
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'Relationship confidence must be between 0 and 1';
  end if;

  if coalesce(cardinality(p_chunks), 0) > 0 then
    foreach v_chunk in array p_chunks loop
      if not exists (
        select 1 from public.reliability_kb_chunks c
        where c.id = v_chunk and c.organization_id = v_org
      ) then
        raise exception 'Relationship provenance chunk is outside the current organization';
      end if;
    end loop;
  end if;

  if not exists (
    select 1 from public.user_profiles where id = v_actor and organization_id = v_org
  ) then
    v_actor := null;
  end if;

  insert into public.engineering_knowledge_relationships (
    organization_id, relationship_code, relationship_type,
    from_entity_type, from_canonical_id, to_entity_type, to_canonical_id,
    provenance_chunk_ids, provenance_canonical_ids, review_state,
    confidence, created_by_kind, created_by
  ) values (
    v_org, left(trim(p_code), 500), p_relationship,
    p_from_type, left(trim(p_from_id), 500), p_to_type, left(trim(p_to_id), 500),
    coalesce(p_chunks, '{}'), coalesce(p_canonical, '{}'), 'draft',
    p_confidence,
    case
      when public.app_current_role() = 'ai_admin' then 'agent'
      when v_actor is not null then 'human'
      else 'system'
    end,
    v_actor
  )
  on conflict (organization_id, relationship_code) do nothing
  returning id into v_id;

  return v_id is not null;
end;
$fn$;

revoke all on function public.insert_knowledge_relationship_edge(text, text, text, text, text, text, uuid[], text[], numeric)
  from public, anon, authenticated;

create or replace function public.backfill_engineering_relationships(p_edges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_item jsonb;
  v_allowed constant text[] := array[
    'relationshipCode', 'relationshipType', 'fromEntityType', 'fromCanonicalId',
    'toEntityType', 'toCanonicalId', 'provenanceChunkIds', 'provenanceCanonicalIds', 'confidence'
  ];
  v_inserted int := 0;
  v_existing int := 0;
  v_chunks uuid[];
  v_canonical text[];
  v_text text;
  v_confidence numeric;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if p_edges is null or jsonb_typeof(p_edges) <> 'array' then
    raise exception 'Edges must be a JSON array of canonical references';
  end if;
  if jsonb_array_length(p_edges) < 1 or jsonb_array_length(p_edges) > 200 then
    raise exception 'Backfill between 1 and 200 relationships at a time';
  end if;

  for v_item in select value from jsonb_array_elements(p_edges) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each edge must be an object of canonical references';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_item) as keys(key_name)
      where keys.key_name <> all (v_allowed)
    ) then
      raise exception 'Edge payload may contain only canonical references, not copied records';
    end if;
    if v_item ? 'reviewState' or v_item ? 'content' or v_item ? 'description' then
      raise exception 'Backfill cannot carry review state or copied record bodies';
    end if;

    v_chunks := '{}';
    if v_item ? 'provenanceChunkIds' and jsonb_typeof(v_item->'provenanceChunkIds') = 'array' then
      for v_text in select value from jsonb_array_elements_text(v_item->'provenanceChunkIds') loop
        v_chunks := v_chunks || v_text::uuid;
      end loop;
    end if;
    v_canonical := '{}';
    if v_item ? 'provenanceCanonicalIds' and jsonb_typeof(v_item->'provenanceCanonicalIds') = 'array' then
      for v_text in select value from jsonb_array_elements_text(v_item->'provenanceCanonicalIds') loop
        if nullif(trim(v_text), '') is null then
          raise exception 'Provenance canonical id is required';
        end if;
        v_canonical := v_canonical || left(trim(v_text), 240);
      end loop;
    end if;
    if v_item ? 'confidence' and v_item->>'confidence' is not null then
      v_confidence := (v_item->>'confidence')::numeric;
    else
      v_confidence := null;
    end if;

    if public.insert_knowledge_relationship_edge(
      v_item->>'relationshipCode',
      v_item->>'relationshipType',
      v_item->>'fromEntityType',
      v_item->>'fromCanonicalId',
      v_item->>'toEntityType',
      v_item->>'toCanonicalId',
      v_chunks,
      v_canonical,
      v_confidence
    ) then
      v_inserted := v_inserted + 1;
    else
      v_existing := v_existing + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'organizationId', v_org,
    'inserted', v_inserted,
    'alreadyPresent', v_existing,
    'reviewState', 'draft',
    'grantsAuthority', false,
    'grantsWorkRelease', false,
    'grantsApproval', false,
    'decisionBoundary',
      'Backfilled relationships are draft canonical references. They do not approve knowledge, release work, or grant permission.'
  );
end;
$fn$;

revoke all on function public.backfill_engineering_relationships(jsonb) from public, anon;
grant execute on function public.backfill_engineering_relationships(jsonb) to authenticated;

create or replace function public.backfill_relationships_from_knowledge_chunks()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_chunk public.reliability_kb_chunks%rowtype;
  v_source public.engineering_knowledge_sources%rowtype;
  v_key text;
  v_entity text;
  v_relationship text;
  v_code text;
  v_inserted int := 0;
  v_existing int := 0;
  v_skipped int := 0;
  v_from text;
  v_anchor uuid;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;

  for v_source in
    select * from public.engineering_knowledge_sources
    where organization_id = v_org
      and nullif(trim(coalesce(asset_class, '')), '') is not null
  loop
    if v_source.asset_class !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_anchor := null;
    select c.id into v_anchor
    from public.reliability_kb_chunks c
    where c.organization_id = v_org and c.governed_source_id = v_source.id
    order by c.chunk_index
    limit 1;
    if public.insert_knowledge_relationship_edge(
      'SOURCE:' || v_source.id::text || ':applies_to:asset_class:' || v_source.asset_class,
      'applies_to', 'document', v_source.id::text, 'asset_class', v_source.asset_class,
      case when v_anchor is null then '{}'::uuid[] else array[v_anchor] end,
      array[v_source.source_key],
      null
    ) then v_inserted := v_inserted + 1; else v_existing := v_existing + 1; end if;
  end loop;

  for v_chunk in
    select * from public.reliability_kb_chunks
    where organization_id = v_org and provenance is not null and provenance <> '{}'::jsonb
  loop
    v_from := coalesce(v_chunk.governed_source_id::text, nullif(trim(v_chunk.source_id), ''));
    if v_from is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    foreach v_key in array array[
      'componentCodes', 'sharedComponentDnaCodes', 'failureModeCodes',
      'physicsCapabilityCodes', 'detectionMethodCodes'
    ] loop
      if jsonb_typeof(v_chunk.provenance -> v_key) is distinct from 'array' then
        continue;
      end if;
      v_entity := case v_key
        when 'componentCodes' then 'component'
        when 'sharedComponentDnaCodes' then 'shared_component'
        when 'failureModeCodes' then 'failure_mode'
        when 'physicsCapabilityCodes' then 'physics_capability'
        else 'inspection_method'
      end;
      v_relationship := case v_key
        when 'componentCodes' then 'applies_to'
        when 'sharedComponentDnaCodes' then 'supported_by'
        when 'failureModeCodes' then 'may_fail_by'
        when 'physicsCapabilityCodes' then 'explained_by'
        else 'detected_by'
      end;
      for v_code in
        select value from jsonb_array_elements_text(v_chunk.provenance -> v_key)
      loop
        if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$' then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        if public.insert_knowledge_relationship_edge(
          'CHUNK:' || v_chunk.chunk_id || ':' || v_relationship || ':' || v_entity || ':' || v_code,
          v_relationship, 'document', v_from, v_entity, v_code,
          array[v_chunk.id], array[v_chunk.chunk_id], null
        ) then v_inserted := v_inserted + 1; else v_existing := v_existing + 1; end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'organizationId', v_org,
    'inserted', v_inserted,
    'alreadyPresent', v_existing,
    'skipped', v_skipped,
    'reviewState', 'draft',
    'grantsAuthority', false,
    'grantsWorkRelease', false,
    'grantsApproval', false,
    'decisionBoundary',
      'Chunk and source backfill stores draft canonical references only. It does not read chunk text into the graph, approve knowledge, release work, or grant permission.'
  );
end;
$fn$;

revoke all on function public.backfill_relationships_from_knowledge_chunks() from public, anon;
grant execute on function public.backfill_relationships_from_knowledge_chunks() to authenticated;

comment on function public.backfill_engineering_relationships(jsonb) is
  'Stores draft canonical relationship edges for the caller organization. Does not copy records and grants no authority.';
comment on function public.backfill_relationships_from_knowledge_chunks() is
  'Derives draft edges from asset_class and provenance code arrays already stored on canonical chunks and sources. Does not parse chunk text and grants no authority.';

notify pgrst, 'reload schema';
