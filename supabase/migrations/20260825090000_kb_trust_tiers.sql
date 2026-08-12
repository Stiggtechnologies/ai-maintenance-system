-- ============================================================================
-- Knowledge-base document classes and claim-type enforcement
-- (register E12 data governance, U19 AI governance, C7 method provenance).
--
-- THE PROBLEM THIS EXISTS TO PREVENT.
--
-- The corpus today is 767 chunks across MIL-HDBK-338B, the DoD RAM Guide,
-- RADC-TR-85-194 and one public failure investigation. Every one of those is a
-- government or public-domain engineering source, so retrieval has never had to
-- ask what KIND of document an answer came from.
--
-- That changes the moment OEM material arrives. A sales brochure chunked beside
-- MIL-HDBK-338B is retrieved by the same similarity search, rendered in the same
-- citation format, and read with the same confidence. Ask "how does a final
-- drive fail" and a spec sheet will happily supply a paragraph about durability
-- and reliability, because that is what marketing copy is FOR. The retrieval
-- layer cannot tell the difference and neither can the reader.
--
-- WHY A CLAIM TYPE AND NOT A SIMPLE SCORE.
--
-- A trust score would rank a brochure below a handbook and still return it. But
-- this is not a question of degree — it is a question of jurisdiction. A
-- brochure is AUTHORITATIVE about rated power and has NOTHING to say about
-- failure behaviour. A parts manual is definitive about what components exist
-- and silent on how often they break. So the caller declares what kind of claim
-- it is trying to support, and each document class either has standing on that
-- claim or does not.
--
-- WHAT AN EMPTY RESULT MEANS.
--
-- Every retrieval reports what it EXCLUDED and why. A search that returns
-- nothing because the corpus holds no answer, and one that returns nothing
-- because the only matching documents were brochures being asked a failure-mode
-- question, are completely different situations and must never look alike.
--
-- Canonical reuse: reliability_kb_chunks (767 rows, unchanged in content).
-- Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The matrix, as master data.
--
-- This lives in the database and NOT in TypeScript, for two reasons: the
-- enforcement point has to be server-side (the copilot's retrieval runs in an
-- edge function, and a browser-side rule enforces nothing), and a matrix
-- defined in two languages drifts the first time somebody edits one of them.
-- ---------------------------------------------------------------------------
create table if not exists kb_document_classes (
  class_key text primary key,
  label text not null,
  -- Ordering for display and for breaking ties between two documents that both
  -- have standing. Higher is stronger.
  trust_rank int not null,
  -- The claim types this class of document may be cited in support of.
  -- Empty array is legal and means "may be stored, may never be cited".
  permitted_claims text[] not null,
  -- Why those and not others. A permission with no rationale is a preference.
  rationale text not null,
  -- Whether the source may be redistributed verbatim to end users. Copyrighted
  -- OEM material generally may not, and THIS REPOSITORY IS PUBLIC.
  redistributable boolean not null,
  created_at timestamptz not null default now()
);

alter table kb_document_classes enable row level security;
drop policy if exists kbdc_read on kb_document_classes;
-- Reference data about document classes, not tenant data.
create policy kbdc_read on kb_document_classes
  for select to authenticated using (true);

insert into kb_document_classes
  (class_key, label, trust_rank, permitted_claims, rationale, redistributable)
values
  ('engineering_standard','Engineering standard or handbook', 100,
   array['analysis_method','failure_behaviour','component_structure','nameplate_spec'],
   'Consensus documents subject to formal review and revision control. They are '
   || 'the strongest available basis for method, and their failure-rate content is '
   || 'explicitly presented as generic prior data rather than as a claim about any '
   || 'particular fleet.', true),

  ('government_technical_report','Government technical report', 90,
   array['analysis_method','failure_behaviour'],
   'Peer-reviewed within an agency and published without restriction. Strong on '
   || 'method and on generic failure behaviour. Not a source for the physical '
   || 'construction of a specific machine.', true),

  ('incident_investigation','Incident or failure investigation report', 70,
   array['failure_behaviour'],
   'Direct evidence that a failure mechanism occurred, which is exactly what a '
   || 'single investigation establishes. It does NOT establish a rate — one '
   || 'documented event is a mechanism, not a frequency — so it has no standing '
   || 'on method and none on construction.', true),

  ('operator_history','Operator work-order history', 85,
   array['failure_behaviour'],
   'The only source that describes how THESE machines fail in THIS duty, which '
   || 'no external document can supply. Confined to failure behaviour: a work '
   || 'order records what was done, not how the machine was designed.', false),

  ('oem_service_manual','OEM service or parts manual', 80,
   array['component_structure','maintenance_task','nameplate_spec'],
   'Definitive on what components exist, how they are assembled and what the '
   || 'manufacturer requires to be serviced when. Deliberately NO standing on '
   || 'failure behaviour: a service interval states what the OEM requires, which '
   || 'is a different quantity from how often the item actually fails, and '
   || 'conflating the two is one of the most common errors in maintenance '
   || 'analysis.', false),

  ('oem_marketing','OEM brochure or specification sheet', 40,
   array['nameplate_spec'],
   'Authoritative on rated figures — power, weight, capacity, dimensions — '
   || 'because the manufacturer publishes them and is accountable for them. It '
   || 'has NO standing on failure behaviour, and this is the whole point of the '
   || 'table: durability and reliability language in a sales document is a '
   || 'claim about a product, not a measurement of one.', false),

  ('unclassified','Unclassified document', 0,
   array[]::text[],
   'Loaded but never assigned a class. Retrievable by an explicit audit query '
   || 'and citable in support of nothing. The default is silence, not trust — '
   || 'an unreviewed document must not gain standing by being forgotten about.', false)
on conflict (class_key) do update set
  trust_rank = excluded.trust_rank,
  permitted_claims = excluded.permitted_claims,
  rationale = excluded.rationale,
  redistributable = excluded.redistributable;

-- ---------------------------------------------------------------------------
-- Attach a class to every chunk.
-- ---------------------------------------------------------------------------
alter table reliability_kb_chunks
  add column if not exists document_class text
    references kb_document_classes(class_key);

-- Backfill from the existing document_type. Anything unrecognised becomes
-- 'unclassified' rather than being guessed into a trusted class.
update reliability_kb_chunks set document_class = case
  when document_type = 'military-handbook' then 'engineering_standard'
  when document_type in ('source-document','technical-report')
    then 'government_technical_report'
  when document_type = 'failure-investigation-report' then 'incident_investigation'
  else 'unclassified'
end
where document_class is null;

alter table reliability_kb_chunks
  alter column document_class set default 'unclassified';

-- Nothing may enter the corpus without a class. The default above makes that
-- cheap to satisfy and the default is the one with no standing.
alter table reliability_kb_chunks
  alter column document_class set not null;

create index if not exists idx_kbchunk_class
  on reliability_kb_chunks(document_class);

-- ---------------------------------------------------------------------------
-- Retrieval, enforced.
--
-- Both callers go through these. The edge function currently selects from the
-- table directly, which means today there is no enforcement point at all — that
-- is changed in the same PR as this migration.
-- ---------------------------------------------------------------------------

-- Valid claim types, kept as a function so the check exists in one place.
create or replace function kb_claim_types()
returns text[] language sql immutable as $$
  select array['analysis_method','failure_behaviour','component_structure',
               'maintenance_task','nameplate_spec'];
$$;

drop function if exists retrieve_kb_context(text, text, int);
create or replace function retrieve_kb_context(
  p_query text,
  p_claim_type text,
  p_limit int default 4
)
returns table (
  chunk_id text,
  title text,
  page_start int,
  page_end int,
  content text,
  "documentClass" text,
  "trustRank" int,
  redistributable boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    -- An unrecognised claim type returns nothing rather than everything. A
    -- typo must not silently widen what the corpus is allowed to answer.
    return;
  end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         c.document_class, d.trust_rank, d.redistributable
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where p_claim_type = any (d.permitted_claims)
    and c.content ilike '%' || coalesce(nullif(btrim(p_query), ''), '\x00') || '%'
  order by d.trust_rank desc, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;

grant execute on function retrieve_kb_context(text, text, int) to authenticated;

-- What a retrieval was NOT allowed to see, and why. Called alongside the
-- retrieval so an empty result can always be explained.
drop function if exists explain_kb_exclusions(text, text);
create or replace function explain_kb_exclusions(
  p_query text,
  p_claim_type text
)
returns table (
  "documentClass" text,
  label text,
  "chunksMatchedButExcluded" bigint,
  rationale text
)
language sql stable security definer set search_path = public as $$
  select d.class_key, d.label, count(c.id), d.rationale
  from kb_document_classes d
  join reliability_kb_chunks c on c.document_class = d.class_key
  where not (p_claim_type = any (d.permitted_claims))
    and c.content ilike '%' || coalesce(nullif(btrim(p_query), ''), '\x00') || '%'
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
$$;

grant execute on function explain_kb_exclusions(text, text) to authenticated;

-- The vector path, enforced identically. Two retrieval routes with two
-- different permission rules would be one route with no permission rule.
drop function if exists match_reliability_kb(vector, int);
drop function if exists match_reliability_kb(vector, int, text);
create or replace function match_reliability_kb(
  query_embedding vector,
  match_count int default 5,
  p_claim_type text default null
)
returns table (
  chunk_id text,
  title text,
  page_start int,
  page_end int,
  content text,
  similarity double precision,
  "documentClass" text,
  "trustRank" int
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         1 - (c.embedding <=> query_embedding), c.document_class, d.trust_rank
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where c.embedding is not null
    and p_claim_type = any (d.permitted_claims)
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
end;
$$;

grant execute on function match_reliability_kb(vector, int, text) to authenticated;

-- Corpus composition by class, for the trust panel.
drop function if exists get_kb_corpus_posture();
create or replace function get_kb_corpus_posture()
returns table (
  "documentClass" text,
  label text,
  "trustRank" int,
  "permittedClaims" text[],
  redistributable boolean,
  chunks bigint,
  sources bigint,
  titles text
)
language sql stable security definer set search_path = public as $$
  select d.class_key, d.label, d.trust_rank, d.permitted_claims, d.redistributable,
         count(c.id), count(distinct c.source_id),
         coalesce(string_agg(distinct c.title, ', '), '')
  from kb_document_classes d
  left join reliability_kb_chunks c on c.document_class = d.class_key
  group by d.class_key, d.label, d.trust_rank, d.permitted_claims, d.redistributable
  order by d.trust_rank desc;
$$;

grant execute on function get_kb_corpus_posture() to authenticated;

notify pgrst, 'reload schema';
