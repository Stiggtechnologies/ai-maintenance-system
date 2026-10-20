-- Human authority for mapping approval.
--
-- app_is_knowledge_steward() includes ai_admin so that identity can draft
-- governed knowledge. Approval and supersession stay with a human steward.
-- Replacing an approved mapping's state or reviewer requires an explicit reason.
-- This replaces upsert_engineering_knowledge_mapping; it does not add a table.

alter table public.engineering_knowledge_mappings
  add column if not exists review_change_reason text;

drop function if exists public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[]);

create or replace function public.upsert_engineering_knowledge_mapping(
  p_source_id uuid,
  p_entity_type text,
  p_canonical_id text,
  p_relationship text default 'applies_to',
  p_confidence numeric default 1.0,
  p_review_state text default 'draft',
  p_provenance_chunk_ids uuid[] default '{}',
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_id uuid;
  v_bad integer;
  v_canonical text := left(nullif(trim(p_canonical_id), ''), 500);
  v_relationship text := coalesce(nullif(trim(p_relationship), ''), 'applies_to');
  v_review text := coalesce(nullif(trim(p_review_state), ''), 'draft');
  v_reason text := left(nullif(trim(p_reason), ''), 2000);
  v_existing_state text;
  v_existing_reviewer uuid;
  v_next_reviewer uuid;
begin
  if v_org is null or not public.app_is_knowledge_steward() then
    raise exception 'Knowledge steward authority required';
  end if;
  if public.app_current_role() = 'ai_admin' and v_review <> 'draft' then
    raise exception 'ai_admin cannot set a mapping review state other than draft';
  end if;
  if not exists (
    select 1 from public.engineering_knowledge_sources
    where id = p_source_id and organization_id = v_org
  ) then
    raise exception 'Source not found in current organization';
  end if;
  if v_canonical is null then
    raise exception 'Mapping canonical id is required';
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

  v_next_reviewer := case when v_review = 'approved' then auth.uid() else null end;
  v_existing_state := null;
  v_existing_reviewer := null;
  select m.review_state, m.reviewed_by
    into v_existing_state, v_existing_reviewer
  from public.engineering_knowledge_mappings m
  where m.organization_id = v_org
    and m.source_id = p_source_id
    and m.entity_type = p_entity_type
    and m.canonical_id = v_canonical
    and m.relationship = v_relationship
  for update;
  if v_existing_state = 'approved'
     and (
       v_review is distinct from 'approved'
       or v_existing_reviewer is distinct from v_next_reviewer
     )
     and v_reason is null then
    raise exception 'Changing an approved mapping requires an explicit reason';
  end if;

  v_id := null;
  insert into public.engineering_knowledge_mappings (
    organization_id, source_id, entity_type, canonical_id, relationship,
    confidence, review_state, provenance_chunk_ids, reviewed_by, reviewed_at,
    review_change_reason
  ) values (
    v_org, p_source_id, p_entity_type, v_canonical,
    v_relationship, p_confidence,
    v_review, p_provenance_chunk_ids,
    v_next_reviewer,
    case when v_review = 'approved' then now() else null end,
    v_reason
  )
  on conflict (source_id, entity_type, canonical_id, relationship) do update set
    confidence = excluded.confidence,
    review_state = excluded.review_state,
    provenance_chunk_ids = excluded.provenance_chunk_ids,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_change_reason = coalesce(
      excluded.review_change_reason,
      engineering_knowledge_mappings.review_change_reason
    ),
    updated_at = now()
  where not (
    engineering_knowledge_mappings.review_state = 'approved'
    and (
      excluded.review_state is distinct from 'approved'
      or engineering_knowledge_mappings.reviewed_by is distinct from excluded.reviewed_by
    )
    and excluded.review_change_reason is null
  )
  returning id into v_id;
  if v_id is null then
    raise exception 'Changing an approved mapping requires an explicit reason';
  end if;
  return v_id;
end;
$fn$;

revoke all on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) from public, anon;
grant execute on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) to authenticated;

comment on function public.upsert_engineering_knowledge_mapping(uuid, text, text, text, numeric, text, uuid[], text) is
  'Upserts one applicability mapping. ai_admin may only leave it draft. Demoting an approved mapping or replacing its reviewer requires an explicit reason. Grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
