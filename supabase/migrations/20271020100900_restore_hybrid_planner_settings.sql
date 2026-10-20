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
