-- Governed context package for an engineering agent.
--
-- Retrieval stays on reliability_kb_chunks through retrieve_kb_context.
-- Evidence stays on evidence_items. Physics values are not calculated or
-- stored here: a caller may pass a capability code and a result reference.
-- The package never grants permission, work release, or approval.

create or replace function public.engineering_context_visible_chunk(
  p_chunk_id text,
  p_claim_type text
)
returns table (
  chunk_id text,
  title text,
  passage text,
  document_class text,
  trust_rank int,
  is_client_private boolean,
  source_ref text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    c.chunk_id,
    c.title,
    public.kb_untrusted_evidence_envelope(c.content),
    c.document_class,
    d.trust_rank,
    c.organization_id is not null,
    coalesce(c.governed_source_id::text, nullif(trim(c.source_id), ''))
  from public.reliability_kb_chunks c
  join public.kb_document_classes d on d.class_key = c.document_class
  left join public.engineering_knowledge_sources s
    on s.id = c.governed_source_id and s.organization_id = c.organization_id
  where c.chunk_id = p_chunk_id
    and c.security_status in ('cleared', 'released')
    and p_claim_type = any (d.permitted_claims)
    and (
      c.organization_id is null
      or (
        public.app_current_org() is not null
        and c.organization_id = public.app_current_org()
        and (
          c.governed_source_id is null
          or (s.review_state = 'approved' and s.superseded_by_source_id is null)
        )
      )
    );
$fn$;

revoke all on function public.engineering_context_visible_chunk(text, text)
  from public, anon, authenticated;

create or replace function public.build_governed_engineering_context(
  p_claim_type text,
  p_query text,
  p_asset_class text default null,
  p_asset_twin_id text default null,
  p_component_codes text[] default null,
  p_failure_mode_codes text[] default null,
  p_physics_capability_codes text[] default null,
  p_retrieved_chunk_ids text[] default null,
  p_physics_results jsonb default null,
  p_evidence_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_code text;
  v_hit record;
  v_visible record;
  v_item jsonb;
  v_allowed constant text[] := array['capabilityCode', 'resultRef'];
  v_capability text;
  v_result_ref text;
  v_retrieved jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_source_ids text[] := '{}';
  v_source text;
  v_unverified_chunks text[] := '{}';
  v_physics jsonb := '[]'::jsonb;
  v_evidence text[] := '{}';
  v_unverified_evidence text[] := '{}';
  v_evidence_id uuid;
  v_missing text[] := '{}';
  v_components text[] := '{}';
  v_failures text[] := '{}';
  v_physics_codes text[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  v_conflict_ids text[] := '{}';
  v_candidate_ids text[] := '{}';
  v_source_count int := 0;
  v_revision_count int := 0;
  v_authority_count int := 0;
  v_asset_class text := left(trim(coalesce(p_asset_class, '')), 240);
  v_asset_twin text := left(trim(coalesce(p_asset_twin_id, '')), 240);
begin
  if v_org is null then
    return jsonb_build_object(
      'error', 'forbidden',
      'retrieved', '[]'::jsonb,
      'evidenceIds', '[]'::jsonb,
      'missingEvidence', '[]'::jsonb,
      'humanApprovalRequired', true,
      'autonomousOperationalActionAllowed', false,
      'grantsWorkRelease', false,
      'grantsApprovalAuthority', false,
      'grantsApproval', false,
      'decisionBoundary',
        'A context package assembles references the caller can already read. It does not approve knowledge, release work, or grant permission.'
    );
  end if;
  if p_claim_type is null or not (p_claim_type = any (public.kb_claim_types())) then
    raise exception 'Claim type is not permitted';
  end if;
  if coalesce(cardinality(p_component_codes), 0) > 30
     or coalesce(cardinality(p_failure_mode_codes), 0) > 30
     or coalesce(cardinality(p_physics_capability_codes), 0) > 30
     or coalesce(cardinality(p_retrieved_chunk_ids), 0) > 20
     or coalesce(cardinality(p_evidence_ids), 0) > 20 then
    raise exception 'Context package inputs exceed the allowed reference count';
  end if;

  if nullif(trim(coalesce(p_query, '')), '') is not null then
    for v_hit in
      select
        r.chunk_id,
        r.title,
        r.content,
        r."documentClass" as document_class,
        r."trustRank" as trust_rank,
        r."isClientPrivate" as is_client_private
      from public.retrieve_kb_context(left(p_query, 500), p_claim_type, 8) r
    loop
      v_retrieved := v_retrieved || jsonb_build_array(jsonb_build_object(
        'chunkId', v_hit.chunk_id,
        'title', v_hit.title,
        'documentClass', v_hit.document_class,
        'trustRank', v_hit.trust_rank,
        'isClientPrivate', v_hit.is_client_private,
        'content', v_hit.content
      ));
      v_seen := v_seen || v_hit.chunk_id;
      v_source := null;
      select c.source_ref into v_source
      from public.engineering_context_visible_chunk(v_hit.chunk_id, p_claim_type) c;
      if v_source is not null and not (v_source = any (v_source_ids)) then
        v_source_ids := v_source_ids || v_source;
      end if;
    end loop;
  end if;

  foreach v_code in array coalesce(p_retrieved_chunk_ids, '{}'::text[]) loop
    if nullif(trim(v_code), '') is null then
      raise exception 'Retrieved chunk id is required';
    end if;
    if v_code = any (v_seen) then
      continue;
    end if;
    select * into v_visible
    from public.engineering_context_visible_chunk(left(trim(v_code), 240), p_claim_type);
    if not found then
      v_unverified_chunks := v_unverified_chunks || left(trim(v_code), 240);
      continue;
    end if;
    v_seen := v_seen || v_visible.chunk_id;
    v_retrieved := v_retrieved || jsonb_build_array(jsonb_build_object(
      'chunkId', v_visible.chunk_id,
      'title', v_visible.title,
      'documentClass', v_visible.document_class,
      'trustRank', v_visible.trust_rank,
      'isClientPrivate', v_visible.is_client_private,
      'content', v_visible.passage
    ));
    if v_visible.source_ref is not null and not (v_visible.source_ref = any (v_source_ids)) then
      v_source_ids := v_source_ids || v_visible.source_ref;
    end if;
  end loop;

  if p_physics_results is not null then
    if jsonb_typeof(p_physics_results) <> 'array' then
      raise exception 'Physics results must be an array of references';
    end if;
    if jsonb_array_length(p_physics_results) > 20 then
      raise exception 'Physics results are limited to 20 references';
    end if;
    for v_item in select value from jsonb_array_elements(p_physics_results) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'Physics results may contain only a capability code and a result reference';
      end if;
      if exists (
        select 1 from jsonb_object_keys(v_item) as keys(key_name)
        where keys.key_name <> all (v_allowed)
      ) then
        raise exception 'Physics results may contain only a capability code and a result reference';
      end if;
      v_capability := v_item ->> 'capabilityCode';
      v_result_ref := v_item ->> 'resultRef';
      if v_capability is null or v_result_ref is null
         or v_capability !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$'
         or v_result_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$'
         or v_result_ref ~ '^[+-]?[0-9]+([.][0-9]+)?$' then
        raise exception 'Physics results must reference a stored result, not carry a calculated value';
      end if;
      v_physics := v_physics || jsonb_build_array(jsonb_build_object(
        'capabilityCode', v_capability,
        'resultRef', v_result_ref
      ));
    end loop;
  end if;

  foreach v_evidence_id in array coalesce(p_evidence_ids, '{}'::uuid[]) loop
    if exists (
      select 1 from public.evidence_items e
      where e.id = v_evidence_id and e.organization_id = v_org
    ) then
      if not (v_evidence_id::text = any (v_evidence)) then
        v_evidence := v_evidence || v_evidence_id::text;
      end if;
    else
      v_unverified_evidence := v_unverified_evidence || v_evidence_id::text;
    end if;
  end loop;

  foreach v_code in array coalesce(p_component_codes, '{}'::text[]) loop
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$' then
      raise exception 'Canonical code is not an identifier';
    end if;
    v_components := v_components || v_code;
    if not exists (
      select 1
      from public.engineering_knowledge_mappings m
      join public.engineering_knowledge_sources s
        on s.id = m.source_id and s.organization_id = m.organization_id
      where m.organization_id = v_org
        and m.review_state = 'approved'
        and m.entity_type = 'component'
        and m.canonical_id = v_code
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
    ) then
      v_missing := v_missing || ('component:' || v_code);
    end if;
  end loop;

  foreach v_code in array coalesce(p_failure_mode_codes, '{}'::text[]) loop
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$' then
      raise exception 'Canonical code is not an identifier';
    end if;
    v_failures := v_failures || v_code;
    if not exists (
      select 1
      from public.engineering_knowledge_mappings m
      join public.engineering_knowledge_sources s
        on s.id = m.source_id and s.organization_id = m.organization_id
      where m.organization_id = v_org
        and m.review_state = 'approved'
        and m.entity_type = 'failure_mode'
        and m.canonical_id = v_code
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
    ) then
      v_missing := v_missing || ('failure_mode:' || v_code);
    end if;
  end loop;

  foreach v_code in array coalesce(p_physics_capability_codes, '{}'::text[]) loop
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._:+-]{0,240}$' then
      raise exception 'Canonical code is not an identifier';
    end if;
    v_physics_codes := v_physics_codes || v_code;
    if not exists (
      select 1
      from public.engineering_knowledge_mappings m
      join public.engineering_knowledge_sources s
        on s.id = m.source_id and s.organization_id = m.organization_id
      where m.organization_id = v_org
        and m.review_state = 'approved'
        and m.entity_type = 'physics_capability'
        and m.canonical_id = v_code
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
    ) then
      v_missing := v_missing || ('physics_capability:' || v_code);
    end if;
  end loop;

  select
    coalesce(array_agg(s.id::text order by s.id::text), '{}'::text[]),
    count(*)::int,
    count(distinct s.revision) filter (
      where nullif(trim(coalesce(s.revision, '')), '') is not null
    )::int,
    count(distinct s.authority_level)::int
  into v_candidate_ids, v_source_count, v_revision_count, v_authority_count
  from public.engineering_knowledge_sources s
  where s.organization_id = v_org
    and s.review_state = 'approved'
    and s.superseded_by_source_id is null
    and (
      (v_asset_class <> '' and s.asset_class = v_asset_class)
      or s.id::text = any (v_source_ids)
    );

  if v_source_count > 1 and v_revision_count > 1 then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'revision_conflict',
      'sourceIds', to_jsonb(v_candidate_ids)
    ));
    v_conflict_ids := v_candidate_ids;
  end if;
  if v_source_count > 1 and v_authority_count > 1 then
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'kind', 'authority_conflict',
      'sourceIds', to_jsonb(v_candidate_ids)
    ));
    v_conflict_ids := v_candidate_ids;
  end if;

  return jsonb_build_object(
    'tenantId', v_org,
    'assetTwinId', v_asset_twin,
    'assetClassCode', v_asset_class,
    'componentCodes', to_jsonb(v_components),
    'candidateFailureModeCodes', to_jsonb(v_failures),
    'physicsCapabilityCodes', to_jsonb(v_physics_codes),
    'evidenceIds', to_jsonb(v_evidence),
    'sourceIds', to_jsonb(v_source_ids),
    'sourceConflictIds', to_jsonb(v_conflict_ids),
    'missingEvidence', to_jsonb(v_missing),
    'retrieved', v_retrieved,
    'physicsResults', v_physics,
    'conflicts', v_conflicts,
    'unverifiedChunkIds', to_jsonb(v_unverified_chunks),
    'unverifiedEvidenceIds', to_jsonb(v_unverified_evidence),
    'humanApprovalRequired', true,
    'autonomousOperationalActionAllowed', false,
    'grantsWorkRelease', false,
    'grantsApprovalAuthority', false,
    'grantsApproval', false,
    'decisionBoundary',
      'A context package assembles references the caller can already read. It does not approve knowledge, release work, calculate a physics result, or grant permission.'
  );
end;
$fn$;

revoke all on function public.build_governed_engineering_context(text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]) from public, anon;
grant execute on function public.build_governed_engineering_context(text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]) to authenticated;

comment on function public.build_governed_engineering_context(text, text, text, text, text[], text[], text[], text[], jsonb, uuid[]) is
  'Packages visible knowledge-base passages, evidence ids, conflict ids, and missing canonical codes. Physics input is a reference only. The package grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
