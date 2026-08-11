-- ============================================================================
-- Let the copilot's edge function retrieve client-scoped chunks, without
-- creating a way for a browser to ask for somebody else's.
--
-- THE PROBLEM.
--
-- `retrieve_kb_context` resolves the tenant with app_current_org(), which reads
-- auth.uid(). The copilot runs in the ai-agent-processor edge function using the
-- SERVICE ROLE, where there is no auth.uid() and app_current_org() is null. So
-- the copilot would silently see only the shared corpus and never a single one
-- of the client's own documents — the retrieval would look like it worked and
-- quietly answer from generic handbooks instead of the client's manuals.
--
-- THE FOOTGUN, AND THE FIX.
--
-- The obvious remedy is an organization_id parameter. On its own that is worse
-- than the bug: any authenticated browser session could pass another tenant's
-- UUID and read their corpus.
--
-- So the parameter is only honoured when there is NO session. If
-- app_current_org() returns a tenant, that value wins and the parameter is
-- discarded — a signed-in user always gets their own organization, whatever
-- they ask for. The parameter is reachable only by a caller that already holds
-- the service key, which can read the table directly anyway.
-- ============================================================================

drop function if exists retrieve_kb_context(text, text, int);
drop function if exists retrieve_kb_context(text, text, int, uuid);
create or replace function retrieve_kb_context(
  p_query text,
  p_claim_type text,
  p_limit int default 4,
  -- Honoured ONLY when there is no session. See above.
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
  -- A signed-in user's own organization always wins over the argument.
  v_org uuid := coalesce(v_session_org, p_organization_id);
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
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

drop function if exists explain_kb_exclusions(text, text);
drop function if exists explain_kb_exclusions(text, text, uuid);
create or replace function explain_kb_exclusions(
  p_query text, p_claim_type text, p_organization_id uuid default null
)
returns table (
  "documentClass" text, label text, "chunksMatchedButExcluded" bigint, rationale text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q tsquery;
  v_session_org uuid := app_current_org();
  v_org uuid := coalesce(v_session_org, p_organization_id);
begin
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select d.class_key, d.label, count(c.id), d.rationale
  from kb_document_classes d
  join reliability_kb_chunks c on c.document_class = d.class_key
  where not (p_claim_type = any (d.permitted_claims))
    and (c.organization_id is null
         or (v_org is not null and c.organization_id = v_org))
    and to_tsvector('english', c.content) @@ v_q
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
end;
$$;
grant execute on function explain_kb_exclusions(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
