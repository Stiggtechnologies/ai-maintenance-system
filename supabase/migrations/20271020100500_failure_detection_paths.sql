-- Failure-propagation and detection paths over canonical relationship edges.
--
-- The table is created here as well as in the backfill migration so this
-- change applies on its own. Nodes are canonical ids. A path does not copy
-- records and does not grant permission, work release, or approval.

create table if not exists public.engineering_knowledge_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_code text not null,
  relationship_type text not null check (relationship_type in (
    'contains', 'composed_of', 'may_fail_by', 'governed_by', 'detected_by', 'verified_by',
    'explained_by', 'supported_by', 'contradicted_by', 'applies_to', 'observed_on',
    'resulted_in', 'resolved_by', 'similar_to', 'supersedes'
  )),
  from_entity_type text not null check (from_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case'
  )),
  from_canonical_id text not null,
  to_entity_type text not null check (to_entity_type in (
    'asset_class', 'asset_twin', 'component', 'shared_component', 'failure_mode',
    'physics_capability', 'inspection_method', 'sensor', 'evidence', 'document',
    'procedure', 'standard', 'work_order', 'root_cause_analysis', 'recommendation',
    'risk', 'verified_case'
  )),
  to_canonical_id text not null,
  provenance_chunk_ids uuid[] not null default '{}',
  provenance_canonical_ids text[] not null default '{}',
  review_state text not null default 'draft' check (review_state in (
    'draft', 'in_review', 'approved', 'rejected', 'superseded'
  )),
  confidence numeric(5,4),
  created_by_kind text not null check (created_by_kind in ('system', 'human', 'agent', 'migration')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, relationship_code),
  check (from_entity_type <> to_entity_type or from_canonical_id <> to_canonical_id),
  check (
    coalesce(cardinality(provenance_chunk_ids), 0) > 0
    or coalesce(cardinality(provenance_canonical_ids), 0) > 0
  ),
  check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists engineering_knowledge_relationships_from_idx
  on public.engineering_knowledge_relationships (organization_id, from_entity_type, from_canonical_id);
create index if not exists engineering_knowledge_relationships_to_idx
  on public.engineering_knowledge_relationships (organization_id, to_entity_type, to_canonical_id);

alter table public.engineering_knowledge_relationships enable row level security;
drop policy if exists engineering_knowledge_relationships_org_read
  on public.engineering_knowledge_relationships;
create policy engineering_knowledge_relationships_org_read
  on public.engineering_knowledge_relationships
  for select to authenticated
  using (organization_id = app_current_org());

revoke all on public.engineering_knowledge_relationships from public, anon, authenticated;
grant select on public.engineering_knowledge_relationships to authenticated;

comment on table public.engineering_knowledge_relationships is
  'Canonical engineering edges. Ids only; no copied twins, documents, or evidence. A relationship grants no permission, work release, or approval.';

create or replace function public.query_failure_detection_paths(
  p_root_canonical_id text,
  p_max_depth int default 4
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := public.app_current_org();
  v_root text := left(trim(coalesce(p_root_canonical_id, '')), 500);
  v_depth int := coalesce(p_max_depth, 4);
  v_types constant text[] := array[
    'may_fail_by', 'detected_by', 'verified_by', 'resulted_in',
    'composed_of', 'contains', 'supported_by'
  ];
  v_queue jsonb := '[]'::jsonb;
  v_paths jsonb := '[]'::jsonb;
  v_current jsonb;
  v_steps jsonb;
  v_visited text[];
  v_from_type text;
  v_from_id text;
  v_edge record;
  v_expanded int;
  v_truncated boolean := false;
  v_guard int := 0;
  v_from_key text;
  v_to_key text;
begin
  if v_org is null then
    return jsonb_build_object(
      'error', 'forbidden',
      'paths', '[]'::jsonb,
      'truncated', false,
      'grantsAuthority', false,
      'grantsWorkRelease', false,
      'grantsApproval', false,
      'decisionBoundary',
        'A path lists canonical links already stored for this organization. It does not establish that a failure will occur, release work, or grant permission.'
    );
  end if;
  if nullif(v_root, '') is null then
    raise exception 'Root canonical id is required';
  end if;
  if v_depth < 1 or v_depth > 8 then
    raise exception 'Path depth must be between 1 and 8';
  end if;

  v_queue := jsonb_build_array(jsonb_build_object(
    'steps', '[]'::jsonb,
    'visited', '[]'::jsonb,
    'entityType', null,
    'canonicalId', v_root,
    'depth', 0
  ));

  while jsonb_array_length(v_queue) > 0 and v_guard < 400 loop
    v_guard := v_guard + 1;
    v_current := v_queue -> 0;
    v_queue := v_queue - 0;
    v_steps := v_current -> 'steps';
    v_from_type := nullif(v_current ->> 'entityType', '');
    v_from_id := v_current ->> 'canonicalId';

    select coalesce(array_agg(value), '{}'::text[]) into v_visited
    from jsonb_array_elements_text(v_current -> 'visited') as visited(value);

    if (v_current ->> 'depth')::int >= v_depth then
      if jsonb_array_length(v_steps) > 0 then
        v_paths := v_paths || jsonb_build_array(jsonb_build_object('steps', v_steps));
        if jsonb_array_length(v_paths) >= 32 then
          v_truncated := true;
          exit;
        end if;
      end if;
      continue;
    end if;

    v_expanded := 0;
    for v_edge in
      select
        e.relationship_code, e.relationship_type, e.review_state,
        e.from_entity_type, e.from_canonical_id, e.to_entity_type, e.to_canonical_id
      from public.engineering_knowledge_relationships e
      where e.organization_id = v_org
        and e.review_state in ('draft', 'in_review', 'approved')
        and e.relationship_type = any (v_types)
        and e.from_canonical_id = v_from_id
        and (v_from_type is null or e.from_entity_type = v_from_type)
      order by e.relationship_code
    loop
      v_to_key := v_edge.to_entity_type || ':' || v_edge.to_canonical_id;
      if v_to_key = any (v_visited) then
        continue;
      end if;
      v_expanded := v_expanded + 1;
      if v_expanded > 12 then
        v_truncated := true;
        exit;
      end if;
      v_from_key := v_edge.from_entity_type || ':' || v_edge.from_canonical_id;
      v_queue := v_queue || jsonb_build_array(jsonb_build_object(
        'steps', v_steps || jsonb_build_array(jsonb_build_object(
          'relationshipType', v_edge.relationship_type,
          'relationshipCode', v_edge.relationship_code,
          'reviewState', v_edge.review_state,
          'fromEntityType', v_edge.from_entity_type,
          'fromCanonicalId', v_edge.from_canonical_id,
          'toEntityType', v_edge.to_entity_type,
          'toCanonicalId', v_edge.to_canonical_id
        )),
        'visited', (v_current -> 'visited') || jsonb_build_array(v_from_key, v_to_key),
        'entityType', v_edge.to_entity_type,
        'canonicalId', v_edge.to_canonical_id,
        'depth', (v_current ->> 'depth')::int + 1
      ));
    end loop;

    if v_expanded = 0 and jsonb_array_length(v_steps) > 0 then
      v_paths := v_paths || jsonb_build_array(jsonb_build_object('steps', v_steps));
      if jsonb_array_length(v_paths) >= 32 then
        v_truncated := true;
        exit;
      end if;
    end if;
  end loop;

  if v_guard >= 400 then
    v_truncated := true;
  end if;

  return jsonb_build_object(
    'rootCanonicalId', v_root,
    'paths', v_paths,
    'truncated', v_truncated,
    'grantsAuthority', false,
    'grantsWorkRelease', false,
    'grantsApproval', false,
    'decisionBoundary',
      'A path lists canonical links already stored for this organization. It does not establish that a failure will occur, release work, or grant permission.'
  );
end;
$fn$;

revoke all on function public.query_failure_detection_paths(text, int) from public, anon;
grant execute on function public.query_failure_detection_paths(text, int) to authenticated;

comment on function public.query_failure_detection_paths(text, int) is
  'Walks canonical failure, detection, and composition edges inside the caller organization. Draft edges stay labelled draft. A path grants no permission, work release, or approval.';

notify pgrst, 'reload schema';
