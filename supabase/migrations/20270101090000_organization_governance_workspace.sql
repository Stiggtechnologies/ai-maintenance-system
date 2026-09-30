-- ============================================================================
-- Organization governance workspace (D3.02 / D11.14).
--
-- Two reachability gaps are closed without introducing a second organization
-- or framework family:
--   1. every customer-reachable ROOT creation path now receives the six draft
--      framework profiles and tailoring defaults through one persistence
--      trigger; and
--   2. the existing five-level tree authoring RPCs receive a tenant-scoped read
--      model that the Settings surface can actually operate.
--
-- The trigger is root-only. `organizations` also stores business units, sites,
-- areas and systems; seeding a complete framework shelf for every child node
-- would manufacture duplicate methodology libraries and is not provisioning.
-- The seeders are idempotent, so the legacy service-only
-- `provision_organization` path may continue to call them explicitly without
-- changing tenant state.
-- ============================================================================

create or replace function public.seed_new_root_governance_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Defense in depth beside the trigger WHEN clause. A child organization is
  -- an organization-tree node, not a newly provisioned tenant root.
  if new.parent_id is not null then
    return new;
  end if;

  perform seed_governance_framework_library(new.id);
  perform seed_governance_tailoring_defaults(new.id);
  return new;
end
$$;

revoke all on function public.seed_new_root_governance_defaults()
  from public, anon, authenticated;

drop trigger if exists trg_seed_new_root_governance_defaults
  on public.organizations;
create trigger trg_seed_new_root_governance_defaults
  after insert on public.organizations
  for each row
  when (new.parent_id is null)
  execute function public.seed_new_root_governance_defaults();

-- ---------------------------------------------------------------------------
-- One read model for organization administration. The underlying organizations
-- policy intentionally exposes only app_current_org(); this SECURITY DEFINER
-- function expands only into that node's descendants. It never accepts an org
-- id from the client, so another tenant cannot be selected or probed.
--
-- Frameworks are adopted rows eligible for at least one managed node: a
-- framework may be owned by that node or by one of its ancestors. The read
-- model returns server-derived eligible node ids so the UI never has to infer
-- ancestry. The write RPC remains authoritative and cannot be weakened by a
-- client-side selection.
-- ---------------------------------------------------------------------------
create or replace function public.get_organization_governance_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_nodes jsonb := '[]'::jsonb;
  v_frameworks jsonb := '[]'::jsonb;
  v_root jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select role into v_role from user_profiles where id = auth.uid();

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'industry', o.industry,
    'timezone', o.timezone,
    'orgLevel', o.org_level,
    'jurisdiction', o.jurisdiction
  ) into v_root
  from organizations o
  where o.id = v_org;

  if v_root is null then
    return jsonb_build_object('error', 'organization not found');
  end if;

  with recursive tree as (
    select o.id, o.name, o.org_level, o.parent_id, o.jurisdiction,
           o.governance_profile_id, 0 as depth, array[o.id] as seen
    from organizations o
    where o.id = v_org
    union all
    select child.id, child.name, child.org_level, child.parent_id,
           child.jurisdiction, child.governance_profile_id,
           tree.depth + 1, tree.seen || child.id
    from tree
    join organizations child on child.parent_id = tree.id
    where tree.depth < 64 and not child.id = any(tree.seen)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', tree.id,
    'name', tree.name,
    'orgLevel', tree.org_level,
    'parentId', tree.parent_id,
    'jurisdiction', tree.jurisdiction,
    'depth', tree.depth,
    'attachedProfile', case when pinned.id is null then null else jsonb_build_object(
      'id', pinned.id,
      'name', pinned.name,
      'version', pinned.version,
      'status', pinned.status
    ) end,
    'resolvedProfile', case when resolved.framework_id is null then null else jsonb_build_object(
      'id', current_fw.id,
      'name', current_fw.name,
      'version', current_fw.version,
      'sourceAuthority', current_fw.source_authority,
      'sourceNodeId', resolved.source_node_id,
      'sourceNodeName', source_node.name,
      'sourceDepth', resolved.source_depth
    ) end
  ) order by tree.depth, tree.name), '[]'::jsonb)
  into v_nodes
  from tree
  left join project_frameworks pinned on pinned.id = tree.governance_profile_id
  left join lateral (
    select r.framework_id, r.source_node_id, r.source_depth
    from resolve_org_governance_profile(tree.id) r
    limit 1
  ) resolved on true
  left join project_frameworks current_fw on current_fw.id = resolved.framework_id
  left join organizations source_node on source_node.id = resolved.source_node_id;

  with recursive managed_tree as (
    select o.id, o.parent_id, o.name, 0 as depth, array[o.id] as seen
    from organizations o
    where o.id = v_org
    union all
    select child.id, child.parent_id, child.name, managed_tree.depth + 1,
           managed_tree.seen || child.id
    from managed_tree
    join organizations child on child.parent_id = managed_tree.id
    where managed_tree.depth < 64 and not child.id = any(managed_tree.seen)
  ), eligible_pairs as (
    select distinct ancestry.node_id as owner_id,
           managed_tree.id as eligible_node_id,
           managed_tree.name as eligible_node_name
    from managed_tree
    cross join lateral org_ancestry(managed_tree.id) ancestry
  ), eligible as (
    select f.id, f.name, f.version, f.source_authority,
           f.organization_id, owner.name as organization_name,
           jsonb_agg(eligible_pairs.eligible_node_id
                     order by eligible_pairs.eligible_node_name) as eligible_node_ids
    from eligible_pairs
    join project_frameworks f
      on f.organization_id = eligible_pairs.owner_id and f.status = 'adopted'
    join organizations owner on owner.id = f.organization_id
    group by f.id, f.name, f.version, f.source_authority,
             f.organization_id, owner.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', eligible.id,
    'name', eligible.name,
    'version', eligible.version,
    'sourceAuthority', eligible.source_authority,
    'organizationId', eligible.organization_id,
    'organizationName', eligible.organization_name,
    'eligibleNodeIds', eligible.eligible_node_ids
  ) order by eligible.organization_name, eligible.name, eligible.version desc), '[]'::jsonb)
  into v_frameworks
  from eligible;

  return jsonb_build_object(
    'root', v_root,
    'nodes', v_nodes,
    'frameworks', v_frameworks,
    'actorRole', v_role,
    'canManage', coalesce(v_role, '') in ('admin', 'executive'),
    'governance', jsonb_build_object(
      'writes', 'Executive or administrator only. Every change is audited.',
      'inheritance', 'A node inherits the nearest attached adopted profile from itself or an ancestor.',
      'automation', 'SyncAI never adopts or attaches a framework automatically.'
    )
  );
end
$$;

revoke all on function public.get_organization_governance_workspace()
  from public, anon;
grant execute on function public.get_organization_governance_workspace()
  to authenticated;

notify pgrst, 'reload schema';
