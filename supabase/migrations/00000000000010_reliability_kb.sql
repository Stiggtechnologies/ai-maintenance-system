-- ============================================================================
-- Reliability knowledge base — the copilot's citable corpus.
--
-- Chunks of the reliability engineering body of knowledge (DoD RAM Guide,
-- MIL-HDBK-338B, RADC-TR-85-194, real failure investigations), embedded with
-- Gemini text-embedding-004 (768 dims, free tier). The copilot retrieves
-- top-k chunks per query and cites them as [Title p.X] — matching the
-- owner's "Stigg Reliability Engineer" GPT, which carries the same documents
-- as knowledge files.
--
-- Global knowledge (no org column): readable by any authenticated user,
-- writable only by service_role (ingestion pipeline).
-- ============================================================================

create extension if not exists vector;

create table if not exists reliability_kb_chunks (
  id uuid primary key default gen_random_uuid(),
  chunk_id text unique not null,
  source_id text not null,
  title text not null,
  document_type text,
  page_start int,
  page_end int,
  chunk_index int,
  domain_tags text[] default '{}',
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists idx_kb_chunks_embedding
  on reliability_kb_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 64);

alter table reliability_kb_chunks enable row level security;
drop policy if exists reliability_kb_chunks_read on reliability_kb_chunks;
create policy reliability_kb_chunks_read on reliability_kb_chunks
  for select to authenticated using (true);

-- Top-k cosine retrieval. SECURITY DEFINER so edge functions can call it with
-- a plain match; execution limited to authenticated + service paths.
create or replace function public.match_reliability_kb(
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  chunk_id text,
  title text,
  page_start int,
  page_end int,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.chunk_id,
    c.title,
    c.page_start,
    c.page_end,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from reliability_kb_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke execute on function public.match_reliability_kb(vector, int) from public, anon;
grant execute on function public.match_reliability_kb(vector, int) to authenticated, service_role;
