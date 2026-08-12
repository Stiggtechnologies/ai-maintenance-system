-- ============================================================================
-- Retrieval defect: a natural-language question matched nothing.
--
-- 20260825096000 replaced a literal ILIKE with websearch_to_tsquery, which was
-- right in direction and wrong in semantics: websearch_to_tsquery ANDs bare
-- terms. So "censored suspended maximum likelihood" required all three words in
-- one chunk and returned zero, while each word alone returned five hits. Every
-- question a person would actually type came back empty, and — worse — came back
-- empty as `absent`, which the engine reports as "the corpus does not cover
-- this" rather than "the query was too strict".
--
-- A retrieval that fails only on realistic input, and fails in the shape of a
-- legitimate verdict, is the hardest kind of bug to notice.
--
-- Now: OR across terms, ranked, so partial matches surface in relevance order.
-- AND-first would be better for precision, but the corpus is 767 chunks and
-- recall matters more than precision at that size.
-- ============================================================================

drop function if exists retrieve_kb_context(text, text, int, uuid);
create or replace function retrieve_kb_context(
  p_query text, p_claim_type text, p_limit int default 4,
  p_organization_id uuid default null
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  "documentClass" text, "trustRank" int, redistributable boolean,
  "isClientPrivate" boolean, rank real
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q tsquery;
  v_session_org uuid := app_current_org();
  v_org uuid := coalesce(v_session_org, p_organization_id);
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;

  -- OR across the query's terms. websearch_to_tsquery gives us tokenisation and
  -- stemming for free; replacing the & operators with | keeps both without the
  -- all-terms-required behaviour.
  v_q := replace(websearch_to_tsquery('english', coalesce(p_query,''))::text, '&', '|')::tsquery;
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         c.document_class, d.trust_rank, d.redistributable,
         c.organization_id is not null,
         ts_rank(to_tsvector('english', c.content), v_q)
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where p_claim_type = any (d.permitted_claims)
    and (c.organization_id is null
         or (v_org is not null and c.organization_id = v_org))
    and to_tsvector('english', c.content) @@ v_q
  order by ts_rank(to_tsvector('english', c.content), v_q) desc,
           d.trust_rank desc, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;
grant execute on function retrieve_kb_context(text, text, int, uuid) to authenticated;

notify pgrst, 'reload schema';
