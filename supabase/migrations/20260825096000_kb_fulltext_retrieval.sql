-- Replace the literal-substring match with real full-text search.
--
-- The first cut used `content ilike '%query%'`, which is a LITERAL substring
-- test: a natural-language question like "how does a final drive fail" matches
-- nothing at all, because that exact string appears in no document. The caller
-- being replaced used PostgreSQL full-text search, so shipping ilike would have
-- traded a retrieval-quality regression for a governance improvement.
--
-- websearch_to_tsquery rather than plainto_tsquery: the query string arrives
-- from a user, and websearch_to_tsquery is defined to tolerate arbitrary
-- punctuation and quoting instead of raising on it.
create index if not exists idx_kbchunk_fts
  on reliability_kb_chunks using gin (to_tsvector('english', content));

drop function if exists retrieve_kb_context(text, text, int);
create or replace function retrieve_kb_context(
  p_query text,
  p_claim_type text,
  p_limit int default 4
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  "documentClass" text, "trustRank" int, redistributable boolean,
  rank real
)
language plpgsql stable security definer set search_path = public as $$
declare v_q tsquery;
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then
    return;
  end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         c.document_class, d.trust_rank, d.redistributable,
         ts_rank(to_tsvector('english', c.content), v_q)
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where p_claim_type = any (d.permitted_claims)
    and to_tsvector('english', c.content) @@ v_q
  -- Relevance first, then trust as the tie-break. Sorting by trust first would
  -- surface an irrelevant handbook page above a directly relevant one.
  order by ts_rank(to_tsvector('english', c.content), v_q) desc,
           d.trust_rank desc, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;
grant execute on function retrieve_kb_context(text, text, int) to authenticated;

drop function if exists explain_kb_exclusions(text, text);
create or replace function explain_kb_exclusions(p_query text, p_claim_type text)
returns table (
  "documentClass" text, label text, "chunksMatchedButExcluded" bigint, rationale text
)
language plpgsql stable security definer set search_path = public as $$
declare v_q tsquery;
begin
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select d.class_key, d.label, count(c.id), d.rationale
  from kb_document_classes d
  join reliability_kb_chunks c on c.document_class = d.class_key
  where not (p_claim_type = any (d.permitted_claims))
    and to_tsvector('english', c.content) @@ v_q
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
end;
$$;
grant execute on function explain_kb_exclusions(text, text) to authenticated;

notify pgrst, 'reload schema';
