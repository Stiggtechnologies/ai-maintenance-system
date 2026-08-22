-- Governance hardening for approved engineering knowledge.
--
-- Approval applies to a specific reviewed source body and applicability mapping.
-- Any material source, mapping, or governed-chunk change invalidates that approval
-- synchronously so retrieval fails closed until a human steward re-approves it.

create or replace function public.enforce_engineering_source_reapproval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.source_key,
    new.title,
    new.document_type,
    new.document_class,
    new.authority_level,
    new.confidentiality,
    new.site_ref,
    new.asset_class,
    new.manufacturer,
    new.model,
    new.revision,
    new.effective_on,
    new.source_url,
    new.source_checksum,
    new.metadata
  ) is not distinct from (
    old.source_key,
    old.title,
    old.document_type,
    old.document_class,
    old.authority_level,
    old.confidentiality,
    old.site_ref,
    old.asset_class,
    old.manufacturer,
    old.model,
    old.revision,
    old.effective_on,
    old.source_url,
    old.source_checksum,
    old.metadata
  ) then
    return new;
  end if;

  if old.review_state = 'superseded' then
    raise exception 'Superseded engineering knowledge sources are immutable; register a replacement source'
      using errcode = 'check_violation';
  end if;

  new.review_state := 'in_review';
  new.approved_by := null;
  new.approved_at := null;
  return new;
end;
$$;

revoke all on function public.enforce_engineering_source_reapproval() from public, anon, authenticated;

drop trigger if exists trg_engineering_source_reapproval on public.engineering_knowledge_sources;
create trigger trg_engineering_source_reapproval
  before update of
    source_key, title, document_type, document_class, authority_level,
    confidentiality, site_ref, asset_class, manufacturer, model, revision,
    effective_on, source_url, source_checksum, metadata
  on public.engineering_knowledge_sources
  for each row execute function public.enforce_engineering_source_reapproval();

create or replace function public.invalidate_engineering_source_approval_from_mapping()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_source uuid;
  v_new_source uuid;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id,
    new.source_id,
    new.entity_type,
    new.canonical_id,
    new.relationship,
    new.confidence,
    new.review_state,
    new.provenance_chunk_ids
  ) is not distinct from (
    old.organization_id,
    old.source_id,
    old.entity_type,
    old.canonical_id,
    old.relationship,
    old.confidence,
    old.review_state,
    old.provenance_chunk_ids
  ) then
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_source := old.source_id;
    update public.engineering_knowledge_sources
    set review_state = 'in_review',
        approved_by = null,
        approved_at = null,
        updated_at = now()
    where id = v_old_source
      and review_state = 'approved';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_source := new.source_id;
    if v_new_source is not null
       and (v_old_source is null or v_new_source is distinct from v_old_source) then
      update public.engineering_knowledge_sources
      set review_state = 'in_review',
          approved_by = null,
          approved_at = null,
          updated_at = now()
      where id = v_new_source
        and review_state = 'approved';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.invalidate_engineering_source_approval_from_mapping() from public, anon, authenticated;

drop trigger if exists trg_engineering_mapping_invalidates_source_approval on public.engineering_knowledge_mappings;
create trigger trg_engineering_mapping_invalidates_source_approval
  after insert or delete or update of
    organization_id, source_id, entity_type, canonical_id, relationship,
    confidence, review_state, provenance_chunk_ids
  on public.engineering_knowledge_mappings
  for each row execute function public.invalidate_engineering_source_approval_from_mapping();

create or replace function public.invalidate_engineering_source_approval_from_chunk()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_source uuid;
  v_new_source uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_source := old.governed_source_id;
    if v_old_source is not null then
      update public.engineering_knowledge_sources
      set review_state = 'in_review',
          approved_by = null,
          approved_at = null,
          updated_at = now()
      where id = v_old_source
        and review_state = 'approved';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_source := new.governed_source_id;
    if v_new_source is not null
       and (v_old_source is null or v_new_source is distinct from v_old_source) then
      update public.engineering_knowledge_sources
      set review_state = 'in_review',
          approved_by = null,
          approved_at = null,
          updated_at = now()
      where id = v_new_source
        and review_state = 'approved';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.invalidate_engineering_source_approval_from_chunk() from public, anon, authenticated;

drop trigger if exists trg_engineering_chunk_invalidates_source_approval on public.reliability_kb_chunks;
create trigger trg_engineering_chunk_invalidates_source_approval
  after insert or delete or update of
    chunk_id, source_id, title, document_type, page_start, page_end, chunk_index,
    domain_tags, content, embedding, organization_id, document_class,
    governed_source_id, content_checksum, provenance
  on public.reliability_kb_chunks
  for each row execute function public.invalidate_engineering_source_approval_from_chunk();

notify pgrst, 'reload schema';
