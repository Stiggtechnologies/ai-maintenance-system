-- Conflict and supersession detection over governed engineering knowledge.
--
-- Reads engineering_knowledge_sources and engineering_knowledge_mappings.
-- It does not update them, does not choose a winner, and does not grant
-- permission, work release, or approval.

create or replace function public.detect_engineering_knowledge_conflicts(
  p_entity_type text,
  p_canonical_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_findings jsonb := '[]'::jsonb;
  v_active uuid[];
  v_revisions int;
  v_authorities int;
  v_gap uuid[];
  v_stale uuid[];
  v_dangling uuid[];
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if nullif(trim(coalesce(p_entity_type, '')), '') is null
     or nullif(trim(coalesce(p_canonical_id, '')), '') is null then
    raise exception 'entity type and canonical id are required';
  end if;

  select coalesce(array_agg(distinct s.id), '{}')
    into v_active
  from public.engineering_knowledge_mappings m
  join public.engineering_knowledge_sources s
    on s.id = m.source_id and s.organization_id = m.organization_id
  where m.organization_id = v_org
    and m.entity_type = p_entity_type
    and m.canonical_id = left(trim(p_canonical_id), 500)
    and m.review_state = 'approved'
    and s.review_state = 'approved'
    and s.superseded_by_source_id is null;

  select count(distinct s.revision) into v_revisions
  from public.engineering_knowledge_sources s
  where s.id = any (v_active)
    and nullif(trim(coalesce(s.revision, '')), '') is not null;
  if v_revisions > 1 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'kind', 'revision_conflict',
      'sourceIds', to_jsonb(v_active),
      'detail', 'Approved sources name different revisions for the same canonical target.'
    ));
  end if;

  select count(distinct s.authority_level) into v_authorities
  from public.engineering_knowledge_sources s
  where s.id = any (v_active);
  if coalesce(array_length(v_active, 1), 0) > 1 and v_authorities > 1 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'kind', 'authority_conflict',
      'sourceIds', to_jsonb(v_active),
      'detail', 'Approved sources name different authority levels for the same canonical target.'
    ));
  end if;

  select coalesce(array_agg(distinct s.id), '{}') into v_gap
  from public.engineering_knowledge_mappings m
  join public.engineering_knowledge_sources s
    on s.id = m.source_id and s.organization_id = m.organization_id
  where m.organization_id = v_org
    and m.entity_type = p_entity_type
    and m.canonical_id = left(trim(p_canonical_id), 500)
    and s.review_state = 'superseded'
    and (
      s.superseded_by_source_id is null
      or not exists (
        select 1 from public.engineering_knowledge_sources r
        where r.id = s.superseded_by_source_id
          and r.organization_id = v_org
          and r.review_state = 'approved'
      )
    );
  if coalesce(array_length(v_gap, 1), 0) > 0 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'kind', 'supersession_gap',
      'sourceIds', to_jsonb(v_gap),
      'detail', 'A superseded source has no approved same-tenant replacement.'
    ));
  end if;

  select coalesce(array_agg(distinct s.id), '{}') into v_stale
  from public.engineering_knowledge_mappings m
  join public.engineering_knowledge_sources s
    on s.id = m.source_id and s.organization_id = m.organization_id
  where m.organization_id = v_org
    and m.entity_type = p_entity_type
    and m.canonical_id = left(trim(p_canonical_id), 500)
    and m.review_state = 'approved'
    and (s.review_state = 'superseded' or s.superseded_by_source_id is not null);
  if coalesce(array_length(v_stale, 1), 0) > 0 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'kind', 'superseded_mapping_still_approved',
      'sourceIds', to_jsonb(v_stale),
      'detail', 'An approved mapping still points at a superseded source.'
    ));
  end if;

  select coalesce(array_agg(distinct s.id), '{}') into v_dangling
  from public.engineering_knowledge_mappings m
  join public.engineering_knowledge_sources s
    on s.id = m.source_id and s.organization_id = m.organization_id
  where m.organization_id = v_org
    and m.entity_type = p_entity_type
    and m.canonical_id = left(trim(p_canonical_id), 500)
    and s.superseded_by_source_id is not null
    and s.review_state <> 'superseded';
  if coalesce(array_length(v_dangling, 1), 0) > 0 then
    v_findings := v_findings || jsonb_build_array(jsonb_build_object(
      'kind', 'successor_not_applied',
      'sourceIds', to_jsonb(v_dangling),
      'detail', 'A source names a replacement but is not itself marked superseded.'
    ));
  end if;

  return jsonb_build_object(
    'entityType', p_entity_type,
    'canonicalId', left(trim(p_canonical_id), 500),
    'findings', v_findings,
    'grantsAuthority', false,
    'grantsWorkRelease', false,
    'grantsApproval', false,
    'decisionBoundary',
      'Conflict detection names disagreements and broken supersession chains. It does not supersede a source, approve knowledge, release work, or grant permission.'
  );
end;
$fn$;

revoke all on function public.detect_engineering_knowledge_conflicts(text, text) from public, anon;
grant execute on function public.detect_engineering_knowledge_conflicts(text, text) to authenticated;

comment on function public.detect_engineering_knowledge_conflicts(text, text) is
  'Reports revision, authority, and supersession conflicts for one canonical target in the caller organization. It writes nothing and grants no authority.';

notify pgrst, 'reload schema';
