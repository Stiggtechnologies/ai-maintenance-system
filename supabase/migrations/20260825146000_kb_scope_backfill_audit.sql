-- ============================================================================
-- Validate the rows that were already there.
--
-- WHAT WENT WRONG, AND WHY IT IS WORTH A MIGRATION OF ITS OWN.
--
-- 20260825140000 added a BEFORE INSERT OR UPDATE trigger refusing to place a
-- client-scoped document class in the shared corpus. A trigger only ever sees
-- writes. Every row already in the table — including the synthetic OEM brochure
-- fixture inserted one migration earlier — was never checked, and the brochure
-- sat in the shared corpus in direct violation of the rule its own class
-- defines.
--
-- Nobody would have noticed from the data. It took rendering the corpus panel,
-- where a row reading "OEM brochure ... 1 shared ... per-client only" is
-- visibly self-contradictory.
--
-- The general lesson is the one this migration encodes: adding a constraint
-- protects the future and says nothing about the past. So this does two things
-- rather than one — it fixes the row, and it adds a standing audit that will
-- catch the same class of mistake next time a rule is introduced.
-- ============================================================================

-- The fixture is synthetic test content and belongs to nobody, so it is scoped
-- to the demo organization rather than deleted: it still needs to exist for the
-- claim-type guard to have something to refuse.
--
-- It is CREATED here rather than in 20260825093000, where it used to be written
-- unscoped one migration before the trigger that forbids that. On a database
-- which already had the trigger the old write was refused outright and the
-- chain stopped here — production did exactly that. By this point the
-- organization_id column and the trigger both exist, so the row can be created
-- correct on the first attempt instead of created wrong and repaired.
--
-- The update still runs first, for databases that already hold the unscoped row
-- from the original version of 20260825093000.
update reliability_kb_chunks
set organization_id = '11111111-1111-1111-1111-111111111111'
where chunk_id = 'FIXTURE-BROCHURE-0001'
  and organization_id is null;

-- Synthetic content belongs in the demo tenant or nowhere: the demo seed is
-- marked EXCLUDE for customer deployments, so a customer database gets no
-- fixture at all rather than a synthetic brochure in its knowledge base.
insert into reliability_kb_chunks
  (organization_id, chunk_id, source_id, title, document_type, document_class,
   page_start, page_end, chunk_index, domain_tags, content)
select
  '11111111-1111-1111-1111-111111111111',
  'FIXTURE-BROCHURE-0001',
  'fixture-oem-brochure',
  'SYNTHETIC FIXTURE — Example Manufacturer Track-Type Tractor Brochure',
  'oem-brochure',
  'oem_marketing',
  1, 1, 0,
  array['dozer','undercarriage','final drive'],
  'SYNTHETIC FIXTURE, NOT A REAL DOCUMENT. Written to imitate sales-brochure '
  || 'register for testing the claim-type guard. "The heavy-duty final drive '
  || 'is engineered for exceptional durability and long service life in the '
  || 'most demanding applications. Robust undercarriage components deliver '
  || 'outstanding reliability and reduced downtime, keeping the machine '
  || 'productive shift after shift." Rated net power 354 hp. Operating weight '
  || '84,573 lb. Note what this paragraph does: it makes confident-sounding '
  || 'claims about durability, reliability and downtime for a final drive and '
  || 'an undercarriage without stating a single failure rate, sample size, '
  || 'duty cycle or observation period. The power and weight figures ARE '
  || 'authoritative — the manufacturer publishes and stands behind them. The '
  || 'durability language is not a measurement. This is why oem_marketing has '
  || 'standing on nameplate_spec and none on failure_behaviour.'
where exists (
  select 1 from organizations
  where id = '11111111-1111-1111-1111-111111111111'
)
on conflict (chunk_id) do update set
  organization_id = excluded.organization_id,
  content = excluded.content,
  document_class = excluded.document_class;

-- ---------------------------------------------------------------------------
-- Standing audit. Returns rows only when something is wrong, so an empty
-- result is the healthy state — and it is checked, not assumed, because it
-- names what it inspected.
-- ---------------------------------------------------------------------------
drop function if exists audit_kb_corpus_scope();
create or replace function audit_kb_corpus_scope()
returns table (
  finding text,
  "chunkId" text,
  title text,
  "documentClass" text,
  detail text
)
language sql stable security definer set search_path = public as $$
  -- Client-class documents sitting in the shared corpus. The disclosure risk.
  select 'global_but_client_class'::text, c.chunk_id, c.title, c.document_class,
         'This class may not be global, yet the chunk has no organization_id, so '
         || 'every tenant can retrieve it. The insert trigger would refuse this '
         || 'today — it predates the trigger, or was written by a path that '
         || 'bypasses it.'
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where c.organization_id is null and not d.may_be_global

  union all

  -- Documents that can be cited in support of nothing. Not a risk, but they
  -- consume retrieval budget and imply coverage that does not exist.
  select 'stored_but_uncitable', c.chunk_id, c.title, c.document_class,
         'Class permits no claim type, so this chunk can never be cited. It is '
         || 'stored, not usable — classify it or remove it.'
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where cardinality(d.permitted_claims) = 0

  union all

  -- Orphaned tenant scope: chunk points at an organization that no longer
  -- exists. The FK cascade should prevent it; checked rather than trusted.
  select 'orphaned_tenant', c.chunk_id, c.title, c.document_class,
         'organization_id does not resolve to an existing organization.'
  from reliability_kb_chunks c
  where c.organization_id is not null
    and not exists (select 1 from organizations o where o.id = c.organization_id)

  order by 1, 2;
$$;

grant execute on function audit_kb_corpus_scope() to authenticated;

notify pgrst, 'reload schema';
