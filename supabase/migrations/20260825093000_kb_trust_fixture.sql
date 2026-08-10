-- ============================================================================
-- A fixture that makes the claim-type guard fire.
--
-- Before this, every chunk in the corpus belonged to a class with standing on
-- failure behaviour, so the enforcement added in 20260825090000 could never
-- have excluded anything. A guard that has never refused is a guard nobody has
-- tested.
--
-- IMPORTANT: the prose below is SYNTHETIC. It is written here to imitate the
-- register of a manufacturer's sales brochure — confident durability language
-- with no measurement behind it — because that is precisely the failure mode
-- being defended against. No copyrighted OEM text appears in this repository,
-- which is public.
--
-- The chunk carries no embedding, so it participates in the text-search path
-- and not the vector path. That is deliberate: the guard must hold on both
-- routes, and leaving this one out of the vector index proves the text route
-- enforces on its own rather than inheriting protection from the other.
-- ============================================================================

insert into reliability_kb_chunks
  (chunk_id, source_id, title, document_type, document_class,
   page_start, page_end, chunk_index, domain_tags, content)
values
  ('FIXTURE-BROCHURE-0001',
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
   || 'standing on nameplate_spec and none on failure_behaviour.')
on conflict (chunk_id) do update set
  content = excluded.content,
  document_class = excluded.document_class;

notify pgrst, 'reload schema';
