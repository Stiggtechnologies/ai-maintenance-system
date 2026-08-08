-- ============================================================================
-- Engineering-knowledge parent/child tenant integrity.
--
-- RLS controls the caller. Composite foreign keys additionally guarantee that
-- a chunk or canonical mapping can never reference a source owned by another
-- organization, including through trusted service or migration paths.
-- ============================================================================

alter table public.engineering_knowledge_sources
  add constraint engineering_knowledge_sources_id_org_key
  unique (id, organization_id);

alter table public.engineering_knowledge_chunks
  drop constraint if exists engineering_knowledge_chunks_source_id_fkey;

alter table public.engineering_knowledge_chunks
  add constraint engineering_knowledge_chunks_source_org_fkey
  foreign key (source_id, organization_id)
  references public.engineering_knowledge_sources(id, organization_id)
  on delete cascade;

alter table public.engineering_knowledge_mappings
  drop constraint if exists engineering_knowledge_mappings_source_id_fkey;

alter table public.engineering_knowledge_mappings
  add constraint engineering_knowledge_mappings_source_org_fkey
  foreign key (source_id, organization_id)
  references public.engineering_knowledge_sources(id, organization_id)
  on delete cascade;
