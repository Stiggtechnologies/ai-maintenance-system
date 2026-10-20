-- Hybrid retrieval over the canonical Reliability KB.
--
-- Lexical rank and optional cosine similarity are blended, then restricted by
-- canonical mapping metadata. This does not create a second vector store.
-- `reliability_kb_chunks.embedding` remains the only embedding column.
--
-- The 0.55 semantic / 0.45 lexical blend matches the in-memory asset-aware
-- retrieval plan. It is a ranking weight, not an engineering limit. Callers
-- who want a similarity floor pass it explicitly; this function does not
-- invent one.
--
-- A hit does not grant permission, work release, or approval.

create or replace function public.retrieve_engineering_knowledge_hybrid(
  p_claim_type text,
  p_query text default null,
  p_query_embedding vector default null,
  p_entity_type text default null,
  p_canonical_id text default null,
  p_asset_class text default null,
  p_minimum_semantic_score double precision default null,
  p_limit int default 8
)
returns table (
  chunk_id text,
  title text,
  content text,
  "documentClass" text,
  "trustRank" int,
  "isClientPrivate" boolean,
  "lexicalRank" real,
  "semanticSimilarity" double precision,
  "combinedScore" double precision,
  "governedSourceId" uuid,
  "matchedCanonicalId" text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_q tsquery;
begin
  if p_claim_type is null or not (p_claim_type = any (public.kb_claim_types())) then
    return;
  end if;
  if (p_entity_type is null) <> (p_canonical_id is null) then
    raise exception 'entity type and canonical id must be supplied together';
  end if;
  if p_minimum_semantic_score is not null
     and (p_minimum_semantic_score < 0 or p_minimum_semantic_score > 1) then
    raise exception 'minimum semantic score must be between 0 and 1';
  end if;

  if nullif(trim(coalesce(p_query, '')), '') is not null then
    v_q := replace(websearch_to_tsquery('english', p_query)::text, '&', '|')::tsquery;
    if v_q is null or v_q::text = '' then
      v_q := null;
    end if;
  end if;
  if v_q is null and p_query_embedding is null then
    return;
  end if;

  -- Exact similarity. The ivfflat index is approximate and must not drop a
  -- governed hit. Restored before return so the caller's transaction is unchanged.
  perform set_config('enable_indexscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);

  return query
  with scored as (
    select
      c.chunk_id,
      c.title,
      public.kb_untrusted_evidence_envelope(c.content) as enveloped,
      c.document_class,
      d.trust_rank,
      c.organization_id is not null as is_private,
      case
        when v_q is null then 0::real
        else ts_rank(to_tsvector('english', c.content), v_q)
      end as lexical_raw,
      case
        when p_query_embedding is null or c.embedding is null then null
        else 1 - (c.embedding <=> p_query_embedding)
      end as semantic,
      c.governed_source_id,
      c.chunk_index
    from public.reliability_kb_chunks c
    join public.kb_document_classes d on d.class_key = c.document_class
    left join public.engineering_knowledge_sources s
      on s.id = c.governed_source_id and s.organization_id = c.organization_id
    where c.security_status in ('cleared', 'released')
      and p_claim_type = any (d.permitted_claims)
      and (
        c.organization_id is null
        or (
          v_org is not null
          and c.organization_id = v_org
          and (
            c.governed_source_id is null
            or (
              s.review_state = 'approved'
              and s.superseded_by_source_id is null
            )
          )
        )
      )
      and (
        (v_q is not null and to_tsvector('english', c.content) @@ v_q)
        or (p_query_embedding is not null and c.embedding is not null)
      )
      and (
        (p_entity_type is null and p_asset_class is null)
        or (
          v_org is not null
          and c.organization_id = v_org
          and c.governed_source_id is not null
          and (
            p_entity_type is null
            or exists (
              select 1
              from public.engineering_knowledge_mappings m
              where m.organization_id = v_org
                and m.source_id = c.governed_source_id
                and m.review_state = 'approved'
                and m.entity_type = p_entity_type
                and m.canonical_id = p_canonical_id
            )
          )
          and (
            p_asset_class is null
            or s.asset_class = p_asset_class
            or exists (
              select 1
              from public.engineering_knowledge_mappings m
              where m.organization_id = v_org
                and m.source_id = c.governed_source_id
                and m.review_state = 'approved'
                and m.entity_type = 'asset_class'
                and m.canonical_id = p_asset_class
            )
          )
        )
      )
  )
  select
    scored.chunk_id,
    scored.title,
    scored.enveloped,
    scored.document_class,
    scored.trust_rank,
    scored.is_private,
    scored.lexical_raw,
    scored.semantic,
    case
      when scored.semantic is not null and scored.lexical_raw > 0 then
        scored.semantic * 0.55 + (scored.lexical_raw / (scored.lexical_raw + 1)) * 0.45
      when scored.semantic is not null then scored.semantic
      else scored.lexical_raw / (scored.lexical_raw + 1)
    end,
    scored.governed_source_id,
    coalesce(p_canonical_id, p_asset_class)
  from scored
  where p_minimum_semantic_score is null
     or (scored.semantic is not null and scored.semantic >= p_minimum_semantic_score)
  order by 9 desc, scored.trust_rank desc, scored.chunk_id
  limit greatest(1, least(coalesce(p_limit, 8), 20));

  perform set_config('enable_indexscan', 'on', true);
  perform set_config('enable_bitmapscan', 'on', true);
end;
$fn$;

revoke all on function public.retrieve_engineering_knowledge_hybrid(text, text, vector, text, text, text, double precision, int) from public, anon;
grant execute on function public.retrieve_engineering_knowledge_hybrid(text, text, vector, text, text, text, double precision, int) to authenticated, service_role;

comment on function public.retrieve_engineering_knowledge_hybrid(text, text, vector, text, text, text, double precision, int) is
  'Hybrid lexical and cosine retrieval over reliability_kb_chunks, optionally filtered by approved canonical mappings. A hit grants no permission, work release, or approval.';

notify pgrst, 'reload schema';

-- The hybrid query turns index scans off so ivfflat cannot drop a hit, then
-- used to force them back on. Restore the caller's previous settings instead.

alter function public.retrieve_engineering_knowledge_hybrid(
  text, text, vector, text, text, text, double precision, int
) rename to retrieve_engineering_knowledge_hybrid_core;

revoke all on function public.retrieve_engineering_knowledge_hybrid_core(
  text, text, vector, text, text, text, double precision, int
) from public, anon, authenticated, service_role;

create or replace function public.retrieve_engineering_knowledge_hybrid(
  p_claim_type text,
  p_query text default null,
  p_query_embedding vector default null,
  p_entity_type text default null,
  p_canonical_id text default null,
  p_asset_class text default null,
  p_minimum_semantic_score double precision default null,
  p_limit int default 8
)
returns table (
  chunk_id text,
  title text,
  content text,
  "documentClass" text,
  "trustRank" int,
  "isClientPrivate" boolean,
  "lexicalRank" real,
  "semanticSimilarity" double precision,
  "combinedScore" double precision,
  "governedSourceId" uuid,
  "matchedCanonicalId" text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_indexscan text := current_setting('enable_indexscan');
  v_bitmapscan text := current_setting('enable_bitmapscan');
begin
  return query
  select *
  from public.retrieve_engineering_knowledge_hybrid_core(
    p_claim_type,
    p_query,
    p_query_embedding,
    p_entity_type,
    p_canonical_id,
    p_asset_class,
    p_minimum_semantic_score,
    p_limit
  );
  perform set_config('enable_indexscan', v_indexscan, true);
  perform set_config('enable_bitmapscan', v_bitmapscan, true);
exception
  when others then
    perform set_config('enable_indexscan', v_indexscan, true);
    perform set_config('enable_bitmapscan', v_bitmapscan, true);
    raise;
end;
$fn$;

revoke all on function public.retrieve_engineering_knowledge_hybrid(
  text, text, vector, text, text, text, double precision, int
) from public, anon;
grant execute on function public.retrieve_engineering_knowledge_hybrid(
  text, text, vector, text, text, text, double precision, int
) to authenticated, service_role;

comment on function public.retrieve_engineering_knowledge_hybrid(
  text, text, vector, text, text, text, double precision, int
) is
  'Hybrid lexical and cosine retrieval over the canonical chunk corpus. Index scans are disabled only for that query, then the caller''s previous planner settings are restored. A hit grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
