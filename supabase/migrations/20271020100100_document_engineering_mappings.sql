-- Document-to-engineering mappings on the existing governed-knowledge table.
--
-- `engineering_knowledge_mappings` already records source applicability, but its
-- entity check predates the engineering ontology: asset twins, shared component
-- DNA, physics capabilities, inspection methods and sensors could not be stored.
-- This migration widens that check and adds one steward RPC. It does not create
-- a chunk store, a vector store, or a copy of any twin, document, or asset.
--
-- A mapping is an applicability reference. It does not grant permission, release
-- work, or approve an operational action.

alter table public.engineering_knowledge_mappings
  drop constraint if exists engineering_knowledge_mappings_entity_type_check;
alter table public.engineering_knowledge_mappings
  drop constraint if exists engineering_knowledge_mappings_review_state_check;

alter table public.engineering_knowledge_mappings
  add constraint engineering_knowledge_mappings_entity_type_check
  check (entity_type in (
    'site', 'asset_class', 'asset', 'asset_twin', 'component', 'shared_component',
    'failure_mode', 'physics_capability', 'inspection_method', 'sensor', 'evidence',
    'document', 'procedure', 'standard', 'work_order', 'root_cause_analysis',
    'recommendation', 'risk', 'verified_case', 'maintenance_task', 'other'
  ));

alter table public.engineering_knowledge_mappings
  add constraint engineering_knowledge_mappings_review_state_check
  check (review_state in ('draft', 'in_review', 'approved', 'rejected', 'superseded'));

alter table public.engineering_knowledge_mappings
  add column if not exists review_change_reason text;

comment on column public.engineering_knowledge_mappings.review_change_reason is
  'Reason recorded when an approved mapping is demoted or its reviewer is replaced. A blank value is not a reason.';

create index if not exists engineering_knowledge_mappings_target_idx
  on public.engineering_knowledge_mappings (organization_id, entity_type, canonical_id);

comment on table public.engineering_knowledge_mappings is
  'Applicability references from a governed knowledge source to canonical engineering ids. Rows do not copy twins, documents, assets, or evidence, and they grant no permission, work release, or approval.';

create or replace function public.persist_document_engineering_mappings(
  p_source_id uuid,
  p_mappings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_authority text;
  v_item jsonb;
  v_entity text;
  v_canonical text;
  v_relationship text;
  v_review text;
  v_confidence numeric;
  v_chunks uuid[];
  v_chunk uuid;
  v_bad integer;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_reason text;
  v_existing_state text;
  v_existing_reviewer uuid;
  v_next_reviewer uuid;
  v_allowed_keys constant text[] := array[
    'entityType', 'canonicalId', 'relationship', 'confidence', 'reviewState',
    'provenanceChunkIds', 'reason'
  ];
  v_entities constant text[] := array[
    'site', 'asset_class', 'asset', 'asset_twin', 'component', 'shared_component',
    'failure_mode', 'physics_capability', 'inspection_method', 'sensor', 'evidence',
    'document', 'procedure', 'standard', 'work_order', 'root_cause_analysis',
    'recommendation', 'risk', 'verified_case', 'maintenance_task', 'other'
  ];
  v_relationships constant text[] := array[
    'contains', 'composed_of', 'may_fail_by', 'governed_by', 'detected_by', 'verified_by',
    'explained_by', 'supported_by', 'contradicted_by', 'applies_to', 'observed_on',
    'resulted_in', 'resolved_by', 'similar_to', 'supersedes'
  ];
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'Mappings must be a JSON array of canonical references';
  end if;
  if jsonb_array_length(p_mappings) < 1 or jsonb_array_length(p_mappings) > 50 then
    raise exception 'Persist between 1 and 50 document mappings at a time';
  end if;

  select authority_level into v_authority
  from public.engineering_knowledge_sources
  where id = p_source_id
    and organization_id = v_org
  for update;
  if v_authority is null then
    raise exception 'Source not found in current organization';
  end if;

  for v_item in select value from jsonb_array_elements(p_mappings)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each mapping must be an object of canonical references';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_item) as keys(key_name)
      where keys.key_name <> all (v_allowed_keys)
    ) then
      raise exception 'Mapping payload may contain only canonical references, not copied records';
    end if;

    v_entity := nullif(trim(v_item->>'entityType'), '');
    v_canonical := left(nullif(trim(v_item->>'canonicalId'), ''), 500);
    v_relationship := coalesce(nullif(trim(v_item->>'relationship'), ''), 'applies_to');
    v_review := coalesce(nullif(trim(v_item->>'reviewState'), ''), 'draft');
    if v_item ? 'confidence' and v_item->>'confidence' is not null then
      v_confidence := (v_item->>'confidence')::numeric;
    else
      v_confidence := 1;
    end if;

    if v_entity is null or not (v_entity = any (v_entities)) then
      raise exception 'Mapping entity type is not a canonical engineering reference';
    end if;
    if v_canonical is null then
      raise exception 'Mapping canonical id is required';
    end if;
    if not (v_relationship = any (v_relationships)) then
      raise exception 'Mapping relationship is not in the engineering ontology';
    end if;
    if v_review not in ('draft', 'in_review', 'approved', 'rejected', 'superseded') then
      raise exception 'Mapping review state is not valid';
    end if;
    if v_confidence < 0 or v_confidence > 1 then
      raise exception 'Mapping confidence must be between 0 and 1';
    end if;
    if v_authority = 'ai_generated' and v_review = 'approved' then
      raise exception 'AI-generated material cannot be approved as an authoritative mapping';
    end if;
    if public.app_current_role() = 'ai_admin' and v_review <> 'draft' then
      raise exception 'ai_admin cannot set a mapping review state other than draft';
    end if;
    v_reason := left(nullif(trim(v_item->>'reason'), ''), 2000);
    if v_entity = 'document' and v_canonical = p_source_id::text then
      raise exception 'A relationship cannot point an entity to itself';
    end if;
    if jsonb_typeof(v_item->'provenanceChunkIds') <> 'array'
       or jsonb_array_length(v_item->'provenanceChunkIds') < 1 then
      raise exception 'Mapping requires provenance-bearing source chunks';
    end if;

    v_chunks := '{}';
    for v_chunk in
      select value::uuid
      from jsonb_array_elements_text(v_item->'provenanceChunkIds')
    loop
      v_chunks := v_chunks || v_chunk;
    end loop;

    select count(*) into v_bad
    from unnest(v_chunks) as ref(chunk_id)
    left join public.reliability_kb_chunks c
      on c.id = ref.chunk_id
     and c.governed_source_id = p_source_id
     and c.organization_id = v_org
    where c.id is null;
    if v_bad > 0 then
      raise exception 'Mapping provenance references a chunk outside the governed source';
    end if;

    v_next_reviewer := case when v_review = 'approved' then auth.uid() else null end;
    v_existing_state := null;
    v_existing_reviewer := null;
    select m.review_state, m.reviewed_by
      into v_existing_state, v_existing_reviewer
    from public.engineering_knowledge_mappings m
    where m.organization_id = v_org
      and m.source_id = p_source_id
      and m.entity_type = v_entity
      and m.canonical_id = v_canonical
      and m.relationship = v_relationship
    for update;
    if v_existing_state = 'approved'
       and (
         v_review is distinct from 'approved'
         or v_existing_reviewer is distinct from v_next_reviewer
       )
       and v_reason is null then
      raise exception 'Changing an approved mapping requires an explicit reason';
    end if;

    v_id := null;
    insert into public.engineering_knowledge_mappings (
      organization_id, source_id, entity_type, canonical_id, relationship,
      confidence, review_state, provenance_chunk_ids, reviewed_by, reviewed_at,
      review_change_reason
    ) values (
      v_org, p_source_id, v_entity, v_canonical, v_relationship,
      v_confidence, v_review, v_chunks,
      v_next_reviewer,
      case when v_review = 'approved' then now() else null end,
      v_reason
    )
    on conflict (source_id, entity_type, canonical_id, relationship) do update set
      confidence = excluded.confidence,
      review_state = excluded.review_state,
      provenance_chunk_ids = excluded.provenance_chunk_ids,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      review_change_reason = coalesce(
        excluded.review_change_reason,
        engineering_knowledge_mappings.review_change_reason
      ),
      updated_at = now()
    where not (
      engineering_knowledge_mappings.review_state = 'approved'
      and (
        excluded.review_state is distinct from 'approved'
        or engineering_knowledge_mappings.reviewed_by is distinct from excluded.reviewed_by
      )
      and excluded.review_change_reason is null
    )
    returning id into v_id;
    if v_id is null then
      raise exception 'Changing an approved mapping requires an explicit reason';
    end if;

    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  return jsonb_build_object(
    'sourceId', p_source_id,
    'mappingIds', v_ids,
    'count', jsonb_array_length(v_ids),
    'grantsAuthority', false,
    'grantsWorkRelease', false,
    'grantsApproval', false,
    'decisionBoundary',
      'A document mapping names reviewed applicability to canonical engineering ids. It does not grant permission, release work, or approve an operational action.'
  );
end;
$fn$;

revoke all on function public.persist_document_engineering_mappings(uuid, jsonb) from public, anon;
grant execute on function public.persist_document_engineering_mappings(uuid, jsonb) to authenticated;

comment on function public.persist_document_engineering_mappings(uuid, jsonb) is
  'Persists document-to-engineering applicability as canonical ids on engineering_knowledge_mappings. Does not copy records and does not grant permission, work release, or approval.';

notify pgrst, 'reload schema';

-- Human authority for mapping approval.
--
-- app_is_knowledge_steward() includes ai_admin so that identity can draft
-- governed knowledge. Approval and supersession stay with a human steward.
-- Replacing an approved mapping's state or reviewer requires an explicit reason.
-- This replaces upsert_engineering_knowledge_mapping; it does not add a table.

alter table public.engineering_knowledge_mappings
  add column if not exists review_change_reason text;

drop function if exists public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[]);

create or replace function public.upsert_engineering_knowledge_mapping(
  p_source_id uuid,
  p_entity_type text,
  p_canonical_id text,
  p_relationship text default 'applies_to',
  p_confidence numeric default 1.0,
  p_review_state text default 'draft',
  p_provenance_chunk_ids uuid[] default '{}',
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_id uuid;
  v_bad integer;
  v_canonical text := left(nullif(trim(p_canonical_id), ''), 500);
  v_relationship text := coalesce(nullif(trim(p_relationship), ''), 'applies_to');
  v_review text := coalesce(nullif(trim(p_review_state), ''), 'draft');
  v_reason text := left(nullif(trim(p_reason), ''), 2000);
  v_existing_state text;
  v_existing_reviewer uuid;
  v_next_reviewer uuid;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if public.app_current_role() = 'ai_admin' and v_review <> 'draft' then
    raise exception 'ai_admin cannot set a mapping review state other than draft';
  end if;
  if not exists (
    select 1 from public.engineering_knowledge_sources
    where id = p_source_id and organization_id = v_org
  ) then
    raise exception 'Source not found in current organization';
  end if;
  if v_canonical is null then
    raise exception 'Mapping canonical id is required';
  end if;
  if coalesce(array_length(p_provenance_chunk_ids, 1), 0) = 0 then
    raise exception 'Mapping requires provenance-bearing source chunks';
  end if;

  select count(*) into v_bad
  from unnest(p_provenance_chunk_ids) as ref(chunk_id)
  left join public.reliability_kb_chunks c
    on c.id = ref.chunk_id
   and c.governed_source_id = p_source_id
   and c.organization_id = v_org
  where c.id is null;
  if v_bad > 0 then
    raise exception 'Mapping provenance references a chunk outside the governed source';
  end if;

  v_next_reviewer := case when v_review = 'approved' then auth.uid() else null end;
  v_existing_state := null;
  v_existing_reviewer := null;
  select m.review_state, m.reviewed_by
    into v_existing_state, v_existing_reviewer
  from public.engineering_knowledge_mappings m
  where m.organization_id = v_org
    and m.source_id = p_source_id
    and m.entity_type = p_entity_type
    and m.canonical_id = v_canonical
    and m.relationship = v_relationship
  for update;
  if v_existing_state = 'approved'
     and (
       v_review is distinct from 'approved'
       or v_existing_reviewer is distinct from v_next_reviewer
     )
     and v_reason is null then
    raise exception 'Changing an approved mapping requires an explicit reason';
  end if;

  v_id := null;
  insert into public.engineering_knowledge_mappings (
    organization_id, source_id, entity_type, canonical_id, relationship,
    confidence, review_state, provenance_chunk_ids, reviewed_by, reviewed_at,
    review_change_reason
  ) values (
    v_org, p_source_id, p_entity_type, v_canonical,
    v_relationship, p_confidence,
    v_review, p_provenance_chunk_ids,
    v_next_reviewer,
    case when v_review = 'approved' then now() else null end,
    v_reason
  )
  on conflict (source_id, entity_type, canonical_id, relationship) do update set
    confidence = excluded.confidence,
    review_state = excluded.review_state,
    provenance_chunk_ids = excluded.provenance_chunk_ids,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_change_reason = coalesce(
      excluded.review_change_reason,
      engineering_knowledge_mappings.review_change_reason
    ),
    updated_at = now()
  where not (
    engineering_knowledge_mappings.review_state = 'approved'
    and (
      excluded.review_state is distinct from 'approved'
      or engineering_knowledge_mappings.reviewed_by is distinct from excluded.reviewed_by
    )
    and excluded.review_change_reason is null
  )
  returning id into v_id;
  if v_id is null then
    raise exception 'Changing an approved mapping requires an explicit reason';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) from public, anon;
grant execute on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) to authenticated;

comment on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) is
  'Upserts one applicability mapping. ai_admin may only leave it draft. Demoting an approved mapping or replacing its reviewer requires an explicit reason. Grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
