-- ============================================================================
-- Demo dependency graph for the Fort McMurray demo organization only.
--
-- THIS IS ILLUSTRATIVE DATA. Every edge is written with source = 'demo', which
-- the coverage function counts separately and reports in plain words, so a
-- reader is told the findings demonstrate the method rather than describe a
-- real plant. It is seeded ONLY into the demo organization; the private
-- operator fleet is left unmapped, and its coverage line says so.
--
-- The shape is the textbook case the analysis exists to find, built from the
-- fixed-plant assets the demo org already has:
--
--   P-101 ─┐
--          ├─[redundancy group "cooling-pumps", 100% each]─> HX-08 ─> K-201
--   P-201 ─┘                                                          (critical)
--
--   Both pumps also sit in one common-cause group, "Utility Block MCC-3".
--
-- Read on its own the cooling pair looks safe: lose either pump and the heat
-- exchanger keeps running. The common-cause group is what turns that into the
-- real finding — one MCC feeds both, so the redundancy defends against a pump
-- failure and not against the thing most likely to take both pumps at once.
-- ============================================================================

do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_p101 uuid; v_p201 uuid; v_hx uuid; v_k201 uuid; v_k05 uuid;
  v_group_id bigint;
begin
  -- Only touch the demo org, and only if it is actually there.
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;

  select id into v_p101 from assets where organization_id = v_org and tag = 'P-101';
  select id into v_p201 from assets where organization_id = v_org and tag = 'P-201';
  select id into v_hx   from assets where organization_id = v_org and tag = 'HX-08';
  select id into v_k201 from assets where organization_id = v_org and tag = 'K-201';
  select id into v_k05  from assets where organization_id = v_org and tag = 'K-05';

  if v_p101 is null or v_p201 is null or v_hx is null or v_k201 is null then
    return;  -- demo asset set differs; leave the graph empty rather than guess
  end if;

  -- The redundant cooling pair.
  insert into asset_dependencies
    (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind,
     redundancy_group, min_suppliers_required, capacity_share_pct, evidence, source)
  values
    (v_org, v_hx, v_p101, 'utility', 'cooling-pumps', 1, 100,
     'Illustrative demo edge. Either cooling pump can carry the full exchanger duty.', 'demo'),
    (v_org, v_hx, v_p201, 'utility', 'cooling-pumps', 1, 100,
     'Illustrative demo edge. Either cooling pump can carry the full exchanger duty.', 'demo')
  on conflict do nothing;

  -- The critical compressor that has no alternative source of cooling.
  insert into asset_dependencies
    (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind,
     evidence, source)
  values
    (v_org, v_k201, v_hx, 'functional',
     'Illustrative demo edge. Gas recovery trips on high discharge temperature '
     || 'with no second cooling path.', 'demo')
  on conflict do nothing;

  if v_k05 is not null then
    insert into asset_dependencies
      (organization_id, dependent_asset_id, supplier_asset_id, dependency_kind,
       evidence, source)
    values
      (v_org, v_k05, v_hx, 'functional',
       'Illustrative demo edge. Shares the same cooling loop as gas recovery.', 'demo')
    on conflict do nothing;
  end if;

  -- The common cause that makes the redundancy above worth less than it looks.
  select id into v_group_id from common_cause_groups
   where organization_id = v_org and name = 'Utility Block MCC-3';
  if v_group_id is null then
    insert into common_cause_groups (organization_id, name, cause_kind, description)
    values (v_org, 'Utility Block MCC-3', 'shared_supply',
            'Illustrative demo group. Both cooling pumps are fed from one motor '
            || 'control centre, so the N+1 pair does not defend against a loss of that MCC.')
    returning id into v_group_id;
  end if;
  insert into common_cause_members (group_id, asset_id, organization_id)
  values (v_group_id, v_p101, v_org), (v_group_id, v_p201, v_org)
  on conflict do nothing;

  -- What the loss actually costs, so restoration has something to order by.
  insert into asset_service_levels
    (asset_id, organization_id, service_name, beneficiary,
     tolerable_downtime_hours, consequence_class, restoration_rank, notes)
  values
    (v_k201, v_org, 'Gas recovery', 'Upgrader flare and emissions envelope',
     4, 'environmental', 1,
     'Illustrative demo service level. Extended loss routes gas to flare.')
  on conflict (asset_id) do nothing;
end $$;
