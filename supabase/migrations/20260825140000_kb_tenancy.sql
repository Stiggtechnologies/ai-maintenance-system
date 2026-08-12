-- ============================================================================
-- Per-client scoping for the knowledge base.
--
-- THE DEFECT THIS CLOSES.
--
-- `reliability_kb_chunks` had no organization_id and its RLS policy read
-- `using (true)`. Every authenticated user of every tenant could read every
-- chunk. That was harmless only because of what happened to be in it — 767
-- chunks of MIL-HDBK-338B, the DoD RAM Guide, RADC-TR-85-194 and one public
-- investigation report, all freely redistributable.
--
-- It stops being harmless the moment a client uploads their own material:
-- their service manuals, their procedures, their incident reports, their
-- work-order history. One ingestion into this table and every other client can
-- retrieve it. That is a cross-tenant disclosure, and it is also a licensing
-- problem — a manual a client is licensed to hold does not come with the right
-- to serve it to that client's competitors.
--
-- THE SHAPE.
--
-- organization_id is NULLABLE and null means "shared corpus". That is a
-- deliberate choice over a sentinel UUID: a real foreign key does real work,
-- and the null is readable as what it is.
--
-- The risk is asymmetric. A shared document wrongly scoped to one client is a
-- nuisance — somebody notices it is missing. A client document wrongly left
-- global is a disclosure that nobody notices at all, because everything still
-- works. So the guard runs in that direction: only classes on an explicit
-- allowlist may be global, and the allowlist contains nothing client-supplied.
-- Getting a client's document into the shared corpus now requires editing
-- master data, not just forgetting a parameter.
--
-- Canonical reuse: kb_document_classes, app_current_org(). Additive.
-- ============================================================================

-- Two different questions that were briefly conflated:
--   redistributable — may verbatim text be served to an end user?
--   may_be_global   — may a chunk of this class live in the shared corpus that
--                     every tenant can read?
-- A public standard is both. A client's own work-order history is neither. An
-- OEM manual can be quoted to the client who licensed it and must never be
-- global.
alter table kb_document_classes
  add column if not exists may_be_global boolean not null default false;

update kb_document_classes set may_be_global = case class_key
  when 'engineering_standard' then true
  when 'government_technical_report' then true
  -- Public regulatory filings belong in the shared corpus. A CLIENT's internal
  -- investigation must be ingested as client_supplied instead, which cannot be
  -- global — see the ingestion rule below.
  when 'incident_investigation' then true
  else false
end;

insert into kb_document_classes
  (class_key, label, trust_rank, permitted_claims, rationale, redistributable, may_be_global)
values
  ('client_supplied','Client-supplied document', 75,
   array['component_structure','maintenance_task','failure_behaviour','nameplate_spec'],
   'Material a client provides about their own operation: procedures, internal '
   || 'standards, incident reports, engineering studies. Broad standing, because '
   || 'about their own plant the client is the best authority there is — and '
   || 'never global, because it is theirs. Anything a client uploads lands here '
   || 'unless somebody classifies it more precisely.', false, false)
on conflict (class_key) do update set
  permitted_claims = excluded.permitted_claims,
  rationale = excluded.rationale,
  redistributable = excluded.redistributable,
  may_be_global = excluded.may_be_global;

-- ---------------------------------------------------------------------------
-- Scope the chunks.
-- ---------------------------------------------------------------------------
alter table reliability_kb_chunks
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

create index if not exists idx_kbchunk_org
  on reliability_kb_chunks(organization_id);

-- The existing 767 chunks plus the synthetic fixture stay global: they are
-- public-domain sources and a test fixture. Left explicit rather than relying
-- on the column defaulting to null, so the intent is recorded.
update reliability_kb_chunks set organization_id = null
where organization_id is null;

-- ---------------------------------------------------------------------------
-- The guard. A trigger rather than a check constraint because the rule depends
-- on another table, which a check constraint may not reference.
-- ---------------------------------------------------------------------------
create or replace function enforce_kb_corpus_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_may_be_global boolean;
begin
  if new.organization_id is not null then
    -- Client-scoped. Always allowed; RLS confines it.
    return new;
  end if;

  select may_be_global into v_may_be_global
  from kb_document_classes where class_key = new.document_class;

  if coalesce(v_may_be_global, false) then
    return new;
  end if;

  raise exception
    'Refusing to place a % chunk in the shared corpus. Documents of this class '
    'are client-specific: leaving organization_id null would make "%" readable '
    'by every tenant. Supply an organization_id, or change the class if this '
    'really is a public-domain source.',
    new.document_class, coalesce(new.title, new.chunk_id)
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_kb_corpus_scope on reliability_kb_chunks;
create trigger trg_kb_corpus_scope
  before insert or update of organization_id, document_class
  on reliability_kb_chunks
  for each row execute function enforce_kb_corpus_scope();

-- ---------------------------------------------------------------------------
-- RLS. Replaces `using (true)`.
-- ---------------------------------------------------------------------------
drop policy if exists reliability_kb_chunks_read on reliability_kb_chunks;
create policy reliability_kb_chunks_read on reliability_kb_chunks
  for select to authenticated
  using (organization_id is null or organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Retrieval, scoped as well as class-checked.
--
-- These are SECURITY DEFINER, so RLS does not apply to them and the scope has
-- to be written into each one. That is exactly the kind of thing that gets
-- missed, which is why the tests assert it per function rather than trusting
-- the policy above to cover them.
-- ---------------------------------------------------------------------------
drop function if exists retrieve_kb_context(text, text, int);
create or replace function retrieve_kb_context(
  p_query text, p_claim_type text, p_limit int default 4
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  "documentClass" text, "trustRank" int, redistributable boolean,
  "isClientPrivate" boolean, rank real
)
language plpgsql stable security definer set search_path = public as $$
declare v_q tsquery; v_org uuid := app_current_org();
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
    and (c.organization_id is null or c.organization_id = v_org)
    and to_tsvector('english', c.content) @@ v_q
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
declare v_q tsquery; v_org uuid := app_current_org();
begin
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select d.class_key, d.label, count(c.id), d.rationale
  from kb_document_classes d
  join reliability_kb_chunks c on c.document_class = d.class_key
  where not (p_claim_type = any (d.permitted_claims))
    -- Only ever counts documents the caller could otherwise have seen. Telling
    -- one tenant that eleven chunks of another tenant's material were excluded
    -- would leak the existence of it while claiming to protect it.
    and (c.organization_id is null or c.organization_id = v_org)
    and to_tsvector('english', c.content) @@ v_q
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
end;
$$;
grant execute on function explain_kb_exclusions(text, text) to authenticated;

drop function if exists match_reliability_kb(vector, int, text);
create or replace function match_reliability_kb(
  query_embedding vector, match_count int default 5, p_claim_type text default null
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  similarity double precision, "documentClass" text, "trustRank" int,
  "isClientPrivate" boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := app_current_org();
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         1 - (c.embedding <=> query_embedding), c.document_class, d.trust_rank,
         c.organization_id is not null
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where c.embedding is not null
    and p_claim_type = any (d.permitted_claims)
    and (c.organization_id is null or c.organization_id = v_org)
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
end;
$$;
grant execute on function match_reliability_kb(vector, int, text) to authenticated;

drop function if exists get_kb_corpus_posture();
create or replace function get_kb_corpus_posture()
returns table (
  "documentClass" text, label text, "trustRank" int, "permittedClaims" text[],
  redistributable boolean, "mayBeGlobal" boolean,
  "sharedChunks" bigint, "clientChunks" bigint, sources bigint, titles text
)
language sql stable security definer set search_path = public as $$
  select d.class_key, d.label, d.trust_rank, d.permitted_claims,
         d.redistributable, d.may_be_global,
         count(c.id) filter (where c.organization_id is null),
         count(c.id) filter (where c.organization_id = app_current_org()),
         count(distinct c.source_id),
         coalesce(string_agg(distinct c.title, ', '), '')
  from kb_document_classes d
  left join reliability_kb_chunks c
    on c.document_class = d.class_key
   and (c.organization_id is null or c.organization_id = app_current_org())
  group by d.class_key, d.label, d.trust_rank, d.permitted_claims,
           d.redistributable, d.may_be_global
  order by d.trust_rank desc;
$$;
grant execute on function get_kb_corpus_posture() to authenticated;

notify pgrst, 'reload schema';
