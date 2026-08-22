-- Governed engineering knowledge registry on the canonical Reliability KB.
--
-- This migration intentionally does NOT create a second chunk/vector store.
-- `reliability_kb_chunks` remains the one retrieval corpus. The new source
-- registry, applicability mappings, provenance fields and approval RPCs add the
-- governance concepts preserved from the earlier knowledge-persistence design.

create table if not exists public.engineering_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null,
  title text not null,
  document_type text,
  document_class text not null default 'client_supplied' references public.kb_document_classes(class_key),
  authority_level text not null default 'draft_internal' check (authority_level in (
    'customer_approved','oem_authorized','regulatory','engineering_standard',
    'internal_approved','verified_operational_record','authoritative_public',
    'draft_internal','general_public','ai_generated'
  )),
  review_state text not null default 'draft' check (review_state in (
    'draft','in_review','approved','rejected','superseded'
  )),
  confidentiality text not null default 'customer_confidential' check (confidentiality in (
    'public','internal','customer_confidential','restricted'
  )),
  site_ref text,
  asset_class text,
  manufacturer text,
  model text,
  revision text,
  effective_on date,
  source_url text,
  source_checksum text,
  metadata jsonb not null default '{}'::jsonb,
  superseded_by_source_id uuid references public.engineering_knowledge_sources(id) on delete set null,
  created_by uuid references public.user_profiles(id) on delete set null,
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key),
  unique (id, organization_id)
);

create table if not exists public.engineering_knowledge_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  entity_type text not null check (entity_type in (
    'site','asset_class','asset','component','failure_mode','maintenance_task','procedure','standard','other'
  )),
  canonical_id text not null,
  relationship text not null default 'applies_to',
  confidence numeric(5,4) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  review_state text not null default 'draft' check (review_state in ('draft','approved','rejected')),
  provenance_chunk_ids uuid[] not null default '{}',
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, entity_type, canonical_id, relationship),
  constraint engineering_knowledge_mapping_source_org_fk
    foreign key (source_id, organization_id)
    references public.engineering_knowledge_sources(id, organization_id)
    on delete cascade
);

alter table public.reliability_kb_chunks
  add column if not exists governed_source_id uuid,
  add column if not exists content_checksum text,
  add column if not exists provenance jsonb;

create index if not exists engineering_knowledge_sources_org_state_idx
  on public.engineering_knowledge_sources (organization_id, review_state, created_at desc);
create index if not exists engineering_knowledge_mappings_source_idx
  on public.engineering_knowledge_mappings (source_id, review_state);
create index if not exists reliability_kb_governed_source_idx
  on public.reliability_kb_chunks (governed_source_id)
  where governed_source_id is not null;

alter table public.reliability_kb_chunks
  drop constraint if exists reliability_kb_governed_source_org_fk;
alter table public.reliability_kb_chunks
  add constraint reliability_kb_governed_source_org_fk
  foreign key (governed_source_id, organization_id)
  references public.engineering_knowledge_sources(id, organization_id)
  on delete restrict;

alter table public.engineering_knowledge_sources enable row level security;
alter table public.engineering_knowledge_mappings enable row level security;

drop policy if exists engineering_knowledge_sources_org_read on public.engineering_knowledge_sources;
create policy engineering_knowledge_sources_org_read
  on public.engineering_knowledge_sources for select to authenticated
  using (organization_id = public.app_current_org());

drop policy if exists engineering_knowledge_mappings_org_read on public.engineering_knowledge_mappings;
create policy engineering_knowledge_mappings_org_read
  on public.engineering_knowledge_mappings for select to authenticated
  using (organization_id = public.app_current_org());

create or replace function public.app_is_knowledge_steward()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_current_role() = any(array['admin','ai_admin','reliability_engineer']::text[])
$$;
revoke all on function public.app_is_knowledge_steward() from public, anon;
grant execute on function public.app_is_knowledge_steward() to authenticated;

-- Future tenant-specific chunks must be attached to an explicit governed source.
-- Existing historical rows are not rewritten; the retrieval functions below
-- stop treating unregistered tenant chunks as approved knowledge.
create or replace function public.enforce_governed_client_kb_chunk()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
begin
  if new.organization_id is null then
    if new.governed_source_id is not null then
      raise exception 'Shared knowledge cannot reference a tenant-governed source';
    end if;
    return new;
  end if;

  if new.governed_source_id is null then
    raise exception 'Tenant knowledge requires a governed engineering source before ingestion';
  end if;
  if nullif(trim(coalesce(new.content_checksum, '')), '') is null then
    raise exception 'Tenant knowledge requires a content checksum';
  end if;
  if new.provenance is null or new.provenance = '{}'::jsonb then
    raise exception 'Tenant knowledge requires provenance metadata';
  end if;

  select review_state into v_state
  from public.engineering_knowledge_sources
  where id = new.governed_source_id
    and organization_id = new.organization_id;
  if v_state is null then
    raise exception 'Governed source does not belong to the chunk organization';
  end if;
  if v_state in ('rejected','superseded') then
    raise exception 'Cannot ingest chunks against a rejected or superseded source';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_governed_client_kb_chunk on public.reliability_kb_chunks;
create trigger trg_governed_client_kb_chunk
  before insert or update of organization_id, governed_source_id, content_checksum, provenance
  on public.reliability_kb_chunks
  for each row execute function public.enforce_governed_client_kb_chunk();

create or replace function public.register_engineering_knowledge_source(
  p_source_key text,
  p_title text,
  p_document_type text default null,
  p_document_class text default 'client_supplied',
  p_authority_level text default 'draft_internal',
  p_confidentiality text default 'customer_confidential',
  p_site_ref text default null,
  p_asset_class text default null,
  p_manufacturer text default null,
  p_model text default null,
  p_revision text default null,
  p_effective_on date default null,
  p_source_url text default null,
  p_source_checksum text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_id uuid;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if nullif(trim(p_source_key), '') is null or nullif(trim(p_title), '') is null then
    raise exception 'Source key and title are required';
  end if;
  if not exists (select 1 from public.kb_document_classes where class_key = p_document_class) then
    raise exception 'Unknown document class';
  end if;

  insert into public.engineering_knowledge_sources (
    organization_id, source_key, title, document_type, document_class,
    authority_level, confidentiality, site_ref, asset_class, manufacturer,
    model, revision, effective_on, source_url, source_checksum, metadata, created_by
  ) values (
    v_org, left(trim(p_source_key), 240), left(trim(p_title), 500), p_document_type,
    p_document_class, p_authority_level, p_confidentiality, p_site_ref,
    p_asset_class, p_manufacturer, p_model, p_revision, p_effective_on,
    p_source_url, p_source_checksum, coalesce(p_metadata, '{}'::jsonb), auth.uid()
  )
  on conflict (organization_id, source_key) do update set
    title = excluded.title,
    document_type = excluded.document_type,
    document_class = excluded.document_class,
    authority_level = excluded.authority_level,
    confidentiality = excluded.confidentiality,
    site_ref = excluded.site_ref,
    asset_class = excluded.asset_class,
    manufacturer = excluded.manufacturer,
    model = excluded.model,
    revision = excluded.revision,
    effective_on = excluded.effective_on,
    source_url = excluded.source_url,
    source_checksum = excluded.source_checksum,
    metadata = excluded.metadata,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.register_engineering_knowledge_source(text,text,text,text,text,text,text,text,text,text,text,date,text,text,jsonb) from public, anon;
grant execute on function public.register_engineering_knowledge_source(text,text,text,text,text,text,text,text,text,text,text,date,text,text,jsonb) to authenticated;

create or replace function public.upsert_engineering_knowledge_mapping(
  p_source_id uuid,
  p_entity_type text,
  p_canonical_id text,
  p_relationship text default 'applies_to',
  p_confidence numeric default 1.0,
  p_review_state text default 'draft',
  p_provenance_chunk_ids uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_id uuid;
  v_bad integer;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if not exists (
    select 1 from public.engineering_knowledge_sources
    where id = p_source_id and organization_id = v_org
  ) then
    raise exception 'Source not found in current organization';
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

  insert into public.engineering_knowledge_mappings (
    organization_id, source_id, entity_type, canonical_id, relationship,
    confidence, review_state, provenance_chunk_ids, reviewed_by, reviewed_at
  ) values (
    v_org, p_source_id, p_entity_type, left(trim(p_canonical_id), 500),
    coalesce(nullif(trim(p_relationship), ''), 'applies_to'), p_confidence,
    p_review_state, p_provenance_chunk_ids,
    case when p_review_state = 'approved' then auth.uid() else null end,
    case when p_review_state = 'approved' then now() else null end
  )
  on conflict (source_id, entity_type, canonical_id, relationship) do update set
    confidence = excluded.confidence,
    review_state = excluded.review_state,
    provenance_chunk_ids = excluded.provenance_chunk_ids,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.upsert_engineering_knowledge_mapping(uuid,text,text,text,numeric,text,uuid[]) from public, anon;
grant execute on function public.upsert_engineering_knowledge_mapping(uuid,text,text,text,numeric,text,uuid[]) to authenticated;

create or replace function public.approve_engineering_knowledge_source(p_source_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_source public.engineering_knowledge_sources%rowtype;
  v_chunk_count integer;
  v_mapping_count integer;
  v_bad integer;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;

  select * into v_source
  from public.engineering_knowledge_sources
  where id = p_source_id and organization_id = v_org
  for update;
  if not found then raise exception 'Source not found in current organization'; end if;
  if v_source.authority_level = 'ai_generated' then
    raise exception 'AI-generated material cannot be approved as authoritative source knowledge';
  end if;
  if v_source.review_state in ('rejected','superseded') then
    raise exception 'Rejected or superseded source cannot be approved';
  end if;
  if v_source.superseded_by_source_id is not null then
    raise exception 'Source has been superseded';
  end if;

  select count(*) into v_chunk_count
  from public.reliability_kb_chunks
  where governed_source_id = p_source_id
    and organization_id = v_org
    and nullif(trim(coalesce(content_checksum, '')), '') is not null
    and provenance is not null
    and provenance <> '{}'::jsonb;
  if v_chunk_count = 0 then
    raise exception 'Source cannot be approved without provenance-bearing canonical chunks';
  end if;

  select count(*) into v_mapping_count
  from public.engineering_knowledge_mappings
  where source_id = p_source_id
    and organization_id = v_org
    and review_state = 'approved';
  if v_mapping_count = 0 then
    raise exception 'Source cannot be approved without an approved applicability mapping';
  end if;

  select count(*) into v_bad
  from public.engineering_knowledge_mappings m
  cross join lateral unnest(m.provenance_chunk_ids) as ref(chunk_id)
  left join public.reliability_kb_chunks c
    on c.id = ref.chunk_id
   and c.governed_source_id = p_source_id
   and c.organization_id = v_org
  where m.source_id = p_source_id
    and m.organization_id = v_org
    and m.review_state = 'approved'
    and c.id is null;
  if v_bad > 0 then
    raise exception 'Approved applicability mapping contains invalid provenance';
  end if;

  update public.engineering_knowledge_sources
  set review_state = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_source_id and organization_id = v_org;
end;
$$;
revoke all on function public.approve_engineering_knowledge_source(uuid) from public, anon;
grant execute on function public.approve_engineering_knowledge_source(uuid) to authenticated;

create or replace function public.supersede_engineering_knowledge_source(
  p_source_id uuid,
  p_replacement_source_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if p_source_id = p_replacement_source_id then
    raise exception 'Replacement source must be different';
  end if;
  if not exists (select 1 from public.engineering_knowledge_sources where id = p_replacement_source_id and organization_id = v_org and review_state = 'approved') then
    raise exception 'Replacement source must be approved in the current organization';
  end if;
  update public.engineering_knowledge_sources
  set review_state = 'superseded', superseded_by_source_id = p_replacement_source_id, updated_at = now()
  where id = p_source_id and organization_id = v_org;
  if not found then raise exception 'Source not found in current organization'; end if;
end;
$$;
revoke all on function public.supersede_engineering_knowledge_source(uuid,uuid) from public, anon;
grant execute on function public.supersede_engineering_knowledge_source(uuid,uuid) to authenticated;

-- The latest tenancy-hardening migration correctly protected the SECURITY
-- DEFINER org parameter but accidentally reintroduced AND-across-query-terms.
-- Re-declare the retrieval function with BOTH properties: session-safe tenant
-- selection, OR term semantics, and governed-source approval for client chunks.
create or replace function public.retrieve_kb_context(
  p_query text,
  p_claim_type text,
  p_limit int default 4,
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
  v_org uuid := case when auth.uid() is not null then public.app_current_org() else p_organization_id end;
begin
  if p_claim_type is null or not (p_claim_type = any (public.kb_claim_types())) then
    return;
  end if;
  v_q := replace(websearch_to_tsquery('english', coalesce(p_query, ''))::text, '&', '|')::tsquery;
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         c.document_class, d.trust_rank, d.redistributable,
         c.organization_id is not null,
         ts_rank(to_tsvector('english', c.content), v_q)
  from public.reliability_kb_chunks c
  join public.kb_document_classes d on d.class_key = c.document_class
  left join public.engineering_knowledge_sources s
    on s.id = c.governed_source_id and s.organization_id = c.organization_id
  where p_claim_type = any (d.permitted_claims)
    and (
      c.organization_id is null
      or (
        v_org is not null
        and c.organization_id = v_org
        and c.governed_source_id is not null
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
      )
    )
    and to_tsvector('english', c.content) @@ v_q
  order by ts_rank(to_tsvector('english', c.content), v_q) desc,
           d.trust_rank desc, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;
revoke all on function public.retrieve_kb_context(text,text,int,uuid) from public, anon;
grant execute on function public.retrieve_kb_context(text,text,int,uuid) to authenticated, service_role;

create or replace function public.explain_kb_exclusions(
  p_query text, p_claim_type text, p_organization_id uuid default null
)
returns table (
  "documentClass" text, label text, "chunksMatchedButExcluded" bigint, rationale text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q tsquery;
  v_org uuid := case when auth.uid() is not null then public.app_current_org() else p_organization_id end;
begin
  v_q := replace(websearch_to_tsquery('english', coalesce(p_query, ''))::text, '&', '|')::tsquery;
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select d.class_key, d.label, count(c.id), d.rationale
  from public.kb_document_classes d
  join public.reliability_kb_chunks c on c.document_class = d.class_key
  left join public.engineering_knowledge_sources s
    on s.id = c.governed_source_id and s.organization_id = c.organization_id
  where not (p_claim_type = any (d.permitted_claims))
    and (
      c.organization_id is null
      or (
        v_org is not null and c.organization_id = v_org
        and c.governed_source_id is not null
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
      )
    )
    and to_tsvector('english', c.content) @@ v_q
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
end;
$$;
revoke all on function public.explain_kb_exclusions(text,text,uuid) from public, anon;
grant execute on function public.explain_kb_exclusions(text,text,uuid) to authenticated, service_role;

create or replace function public.match_reliability_kb(
  query_embedding vector,
  match_count int default 5,
  p_claim_type text default null
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  similarity double precision, "documentClass" text, "trustRank" int,
  "isClientPrivate" boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
begin
  if p_claim_type is null or not (p_claim_type = any (public.kb_claim_types())) then return; end if;
  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         1 - (c.embedding <=> query_embedding), c.document_class, d.trust_rank,
         c.organization_id is not null
  from public.reliability_kb_chunks c
  join public.kb_document_classes d on d.class_key = c.document_class
  left join public.engineering_knowledge_sources s
    on s.id = c.governed_source_id and s.organization_id = c.organization_id
  where c.embedding is not null
    and p_claim_type = any (d.permitted_claims)
    and (
      c.organization_id is null
      or (
        v_org is not null and c.organization_id = v_org
        and c.governed_source_id is not null
        and s.review_state = 'approved'
        and s.superseded_by_source_id is null
      )
    )
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
end;
$$;
revoke all on function public.match_reliability_kb(vector,int,text) from public, anon;
grant execute on function public.match_reliability_kb(vector,int,text) to authenticated;

notify pgrst, 'reload schema';
