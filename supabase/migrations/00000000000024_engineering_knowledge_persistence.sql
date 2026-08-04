-- ============================================================================
-- Governed engineering-knowledge persistence v1.
--
-- This active-schema foundation replaces reliance on archived RAG tables. It
-- persists source metadata, immutable chunks, and canonical applicability
-- mappings using the same authority, review, confidentiality, provenance, and
-- supersession concepts as src/lib/engineering-knowledge.
--
-- It deliberately does not add embeddings, generative extraction, or direct
-- operational action. Those are separate bounded layers.
-- ============================================================================

create or replace function public.app_role_has_knowledge_steward_authority(p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_role, '')) = any(array[
    'admin',
    'ai_admin',
    'reliability_engineer'
  ]::text[])
$$;

create or replace function public.app_has_knowledge_steward_authority()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role_has_knowledge_steward_authority(public.app_current_role())
$$;

revoke all on function public.app_role_has_knowledge_steward_authority(text) from public, anon;
revoke all on function public.app_has_knowledge_steward_authority() from public, anon;
grant execute on function public.app_role_has_knowledge_steward_authority(text) to authenticated, service_role;
grant execute on function public.app_has_knowledge_steward_authority() to authenticated;

create table if not exists public.engineering_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id text not null,
  title text not null,
  document_type text not null,
  site_id uuid references public.sites(id) on delete set null,
  functional_location_id text,
  asset_class_code text,
  engineering_dna_code text,
  asset_twin_id text,
  manufacturer text,
  model text,
  serial_number text,
  revision text,
  effective_date date,
  superseded_date date,
  authority_level text not null check (authority_level in (
    'customer_approved',
    'oem_authorized',
    'regulatory',
    'engineering_standard',
    'internal_approved',
    'verified_operational_record',
    'authoritative_public',
    'draft_internal',
    'general_public',
    'ai_generated'
  )),
  review_state text not null default 'draft' check (review_state in (
    'draft', 'in_review', 'approved', 'rejected', 'superseded'
  )),
  confidentiality text not null default 'internal' check (confidentiality in (
    'public', 'internal', 'customer_confidential', 'restricted'
  )),
  source_url text,
  checksum text not null check (length(btrim(checksum)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_id),
  check (review_state <> 'superseded' or superseded_date is not null),
  check (review_state <> 'approved' or authority_level <> 'ai_generated'),
  check (
    (approved_at is null and approved_by is null)
    or (approved_at is not null and approved_by is not null)
  )
);

create table if not exists public.engineering_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null references public.engineering_knowledge_sources(id) on delete cascade,
  chunk_key text not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0),
  content_checksum text not null check (length(btrim(content_checksum)) > 0),
  page_start integer,
  page_end integer,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_key),
  unique (source_id, chunk_index),
  check (page_start is null or page_start >= 0),
  check (page_end is null or page_end >= coalesce(page_start, 0))
);

create table if not exists public.engineering_knowledge_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null references public.engineering_knowledge_sources(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'asset_class',
    'asset_twin',
    'component',
    'shared_component',
    'failure_mode',
    'physics_capability',
    'inspection_method',
    'sensor',
    'procedure',
    'standard'
  )),
  canonical_id text not null check (length(btrim(canonical_id)) > 0),
  relationship_type text not null default 'applies_to' check (relationship_type in (
    'applies_to', 'supports', 'contradicts', 'supersedes'
  )),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  review_state text not null default 'draft' check (review_state in (
    'draft', 'in_review', 'approved', 'rejected', 'superseded'
  )),
  provenance_chunk_ids uuid[] not null default '{}'::uuid[],
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, entity_type, canonical_id, relationship_type)
);

create index if not exists engineering_knowledge_sources_scope_idx
  on public.engineering_knowledge_sources(
    organization_id,
    review_state,
    authority_level,
    asset_class_code,
    asset_twin_id
  );

create index if not exists engineering_knowledge_sources_revision_idx
  on public.engineering_knowledge_sources(
    organization_id,
    source_id,
    revision,
    effective_date desc
  );

create index if not exists engineering_knowledge_chunks_source_idx
  on public.engineering_knowledge_chunks(source_id, chunk_index);

create index if not exists engineering_knowledge_mappings_lookup_idx
  on public.engineering_knowledge_mappings(
    organization_id,
    entity_type,
    canonical_id,
    review_state
  );

alter table public.engineering_knowledge_sources enable row level security;
alter table public.engineering_knowledge_chunks enable row level security;
alter table public.engineering_knowledge_mappings enable row level security;

drop policy if exists engineering_knowledge_sources_org_read on public.engineering_knowledge_sources;
drop policy if exists engineering_knowledge_sources_steward_insert on public.engineering_knowledge_sources;
drop policy if exists engineering_knowledge_sources_steward_update on public.engineering_knowledge_sources;
drop policy if exists engineering_knowledge_sources_steward_delete on public.engineering_knowledge_sources;

create policy engineering_knowledge_sources_org_read
  on public.engineering_knowledge_sources
  for select to authenticated
  using (organization_id = public.app_current_org());

create policy engineering_knowledge_sources_steward_insert
  on public.engineering_knowledge_sources
  for insert to authenticated
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
  );

create policy engineering_knowledge_sources_steward_update
  on public.engineering_knowledge_sources
  for update to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
  )
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
  );

create policy engineering_knowledge_sources_steward_delete
  on public.engineering_knowledge_sources
  for delete to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and review_state <> 'approved'
  );

drop policy if exists engineering_knowledge_chunks_org_read on public.engineering_knowledge_chunks;
drop policy if exists engineering_knowledge_chunks_steward_insert on public.engineering_knowledge_chunks;
drop policy if exists engineering_knowledge_chunks_steward_update on public.engineering_knowledge_chunks;
drop policy if exists engineering_knowledge_chunks_steward_delete on public.engineering_knowledge_chunks;

create policy engineering_knowledge_chunks_org_read
  on public.engineering_knowledge_chunks
  for select to authenticated
  using (organization_id = public.app_current_org());

create policy engineering_knowledge_chunks_steward_insert
  on public.engineering_knowledge_chunks
  for insert to authenticated
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

create policy engineering_knowledge_chunks_steward_update
  on public.engineering_knowledge_chunks
  for update to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  )
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

create policy engineering_knowledge_chunks_steward_delete
  on public.engineering_knowledge_chunks
  for delete to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

drop policy if exists engineering_knowledge_mappings_org_read on public.engineering_knowledge_mappings;
drop policy if exists engineering_knowledge_mappings_steward_insert on public.engineering_knowledge_mappings;
drop policy if exists engineering_knowledge_mappings_steward_update on public.engineering_knowledge_mappings;
drop policy if exists engineering_knowledge_mappings_steward_delete on public.engineering_knowledge_mappings;

create policy engineering_knowledge_mappings_org_read
  on public.engineering_knowledge_mappings
  for select to authenticated
  using (organization_id = public.app_current_org());

create policy engineering_knowledge_mappings_steward_insert
  on public.engineering_knowledge_mappings
  for insert to authenticated
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

create policy engineering_knowledge_mappings_steward_update
  on public.engineering_knowledge_mappings
  for update to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  )
  with check (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

create policy engineering_knowledge_mappings_steward_delete
  on public.engineering_knowledge_mappings
  for delete to authenticated
  using (
    organization_id = public.app_current_org()
    and public.app_has_knowledge_steward_authority()
    and exists (
      select 1
      from public.engineering_knowledge_sources source
      where source.id = source_id
        and source.organization_id = public.app_current_org()
        and source.review_state <> 'approved'
    )
  );

create or replace function public.approve_engineering_knowledge_source(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_source public.engineering_knowledge_sources%rowtype;
  v_chunk_count integer;
  v_mapping_count integer;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Authenticated organization context is required';
  end if;

  if not public.app_has_knowledge_steward_authority() then
    raise exception 'Knowledge steward authority is required';
  end if;

  select * into v_source
  from public.engineering_knowledge_sources
  where id = p_source_id
    and organization_id = v_org
  for update;

  if not found then
    raise exception 'Engineering knowledge source not found in current organization';
  end if;

  if v_source.review_state in ('rejected', 'superseded') then
    raise exception 'Rejected or superseded sources cannot be approved';
  end if;

  if v_source.authority_level = 'ai_generated' then
    raise exception 'AI-generated material cannot be approved as authoritative knowledge';
  end if;

  select count(*) into v_chunk_count
  from public.engineering_knowledge_chunks
  where source_id = p_source_id
    and organization_id = v_org
    and length(btrim(content_checksum)) > 0
    and jsonb_typeof(provenance) = 'object';

  if v_chunk_count = 0 then
    raise exception 'At least one provenance-bearing source chunk is required';
  end if;

  select count(*) into v_mapping_count
  from public.engineering_knowledge_mappings
  where source_id = p_source_id
    and organization_id = v_org
    and review_state = 'approved'
    and cardinality(provenance_chunk_ids) > 0;

  if v_mapping_count = 0 then
    raise exception 'At least one approved canonical mapping with chunk provenance is required';
  end if;

  update public.engineering_knowledge_sources
  set review_state = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_source_id;

  return jsonb_build_object(
    'source_id', p_source_id,
    'review_state', 'approved',
    'chunks', v_chunk_count,
    'approved_mappings', v_mapping_count,
    'approved_by', auth.uid()
  );
end
$$;

revoke all on function public.approve_engineering_knowledge_source(uuid) from public, anon;
grant execute on function public.approve_engineering_knowledge_source(uuid) to authenticated;
