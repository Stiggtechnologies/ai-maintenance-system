-- ============================================================================
-- KB document intake — C2.15 Document-management integration
--
-- The Reliability Knowledge Activation intake: a tenant-scoped document
-- register plus the single sanctioned write path into that tenant's
-- reliability_kb_chunks. Direct inserts remain closed to clients; everything
-- goes through kb_ingest_document (SECURITY DEFINER, org-scoped from the
-- session, role-gated, audited).
--
-- Trust tiers are inherited from kb_document_classes (20260825090000): an
-- unreviewed upload defaults to 'unclassified' and gains no standing until a
-- reviewer assigns a class. The corpus-scope trigger (20260825140000) already
-- refuses client-class documents without an organization_id — every chunk
-- written here is tenant-scoped by construction.
-- ============================================================================

create table if not exists public.kb_intake_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_id text not null,
  title text not null,
  document_class text not null
    references kb_document_classes(class_key) default 'unclassified',
  document_type text,
  original_filename text,
  status text not null default 'indexed'
    check (status in ('pending','chunking','indexed','failed')),
  page_count int,
  chunk_count int not null default 0,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  error_message text,
  -- One source id per tenant.
  constraint kb_intake_doc_unique_per_org unique (organization_id, source_id)
);

alter table public.kb_intake_documents enable row level security;

-- Read: org-scoped. Write: no direct policy — the sanctioned path is the RPC.
drop policy if exists kb_intake_documents_read on public.kb_intake_documents;
create policy kb_intake_documents_read on public.kb_intake_documents
  for select to authenticated
  using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The sanctioned write path.
-- ---------------------------------------------------------------------------
create or replace function public.kb_ingest_document(
  p_source_id text,
  p_title text,
  p_document_class text default 'unclassified',
  p_document_type text default null,
  p_original_filename text default null,
  p_page_count int default null,
  p_chunks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_chunk_count int;
  v_row record;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin', 'ai_admin', 'reliability_engineer') then
    return jsonb_build_object('error', 'kb intake requires the admin or reliability_engineer role');
  end if;

  if coalesce(length(trim(p_source_id)), 0) < 3 then
    return jsonb_build_object('error', 'source_id is required (min 3 characters)');
  end if;
  if coalesce(length(trim(p_title)), 0) < 2 then
    return jsonb_build_object('error', 'title is required');
  end if;
  if p_document_class is not null and not exists (
    select 1 from kb_document_classes where class_key = p_document_class
  ) then
    return jsonb_build_object('error', 'unknown document_class ' || p_document_class);
  end if;
  if p_chunks is null or jsonb_array_length(p_chunks) = 0 then
    return jsonb_build_object('error', 'no chunks supplied');
  end if;
  -- Every chunk must be a non-empty string; a silent empty corpus is a
  -- retrieval-shaped lie.
  if exists (
    select 1 from jsonb_array_elements(p_chunks) c
    where coalesce(length(trim(c->>'content')), 0) < 20
  ) then
    return jsonb_build_object('error', 'chunks must each contain at least 20 characters');
  end if;

  v_chunk_count := jsonb_array_length(p_chunks);

  insert into kb_intake_documents
    (organization_id, source_id, title, document_class, document_type,
     original_filename, status, page_count, chunk_count, uploaded_by)
  values
    (v_org, p_source_id, trim(p_title), coalesce(p_document_class, 'unclassified'),
     p_document_type, p_original_filename, 'indexed', p_page_count,
     v_chunk_count, auth.uid())
  on conflict (organization_id, source_id) do update set
    title = excluded.title,
    document_class = excluded.document_class,
    document_type = excluded.document_type,
    original_filename = excluded.original_filename,
    status = excluded.status,
    page_count = excluded.page_count,
    chunk_count = excluded.chunk_count,
    uploaded_by = excluded.uploaded_by,
    uploaded_at = now(),
    error_message = null;

  -- Replace the source's chunks atomically: a re-upload is a new version of
  -- the same source, and stale chunks must not linger beside the new ones.
  delete from reliability_kb_chunks
  where organization_id = v_org and source_id = p_source_id;

  insert into reliability_kb_chunks
    (organization_id, chunk_id, source_id, title, document_type,
     document_class, page_start, page_end, chunk_index, content)
  select
    v_org,
    substr(replace(v_org::text, '-', ''), 1, 8) || '-' || p_source_id || '-c' || (c->>'chunk_index'),
    p_source_id,
    trim(p_title),
    p_document_type,
    coalesce(p_document_class, 'unclassified'),
    nullif(c->>'page_start', '')::int,
    nullif(c->>'page_end', '')::int,
    (c->>'chunk_index')::int,
    c->>'content'
  from jsonb_array_elements(p_chunks) c;

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('KB intake: %s chunk(s) from "%s" (%s) as %s', v_chunk_count,
            trim(p_title), p_source_id, coalesce(v_role, 'none')));

  return jsonb_build_object(
    'source_id', p_source_id,
    'chunk_count', v_chunk_count,
    'status', 'indexed'
  );
end
$$;

revoke execute on function public.kb_ingest_document(text, text, text, text, text, int, jsonb)
  from public, anon;
grant execute on function public.kb_ingest_document(text, text, text, text, text, int, jsonb)
  to authenticated;
