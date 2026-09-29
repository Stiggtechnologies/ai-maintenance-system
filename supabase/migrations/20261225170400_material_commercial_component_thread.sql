-- Extend the canonical traversal; retain legacy installedAssets API key while
-- explicitly describing BOM association, not proven installation or causation.
create or replace function public.get_specification_failure_thread(
  p_requirement_ref text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  d design_requirements%rowtype;
  v_packages jsonb;
  v_package_count int;
  v_awarded int;
  v_suppliers bigint[];
  v_materials uuid[];
  v_assets uuid[];
  v_failures jsonb;
  v_failure_total bigint;
  v_backward jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from design_requirements
   where organization_id = v_org
     and requirement_ref = nullif(btrim(coalesce(p_requirement_ref, '')), '');
  if not found then
    return jsonb_build_object('error', format('no requirement %s in this organization',
      coalesce(p_requirement_ref, '(none)')));
  end if;

  -- The backward direction, from the ONE live traversal. Read first so it is
  -- present even when the forward thread refuses at its first hop: a
  -- requirement derived from a failure mode has a story to tell even if
  -- nobody has tendered against it yet.
  select coalesce(jsonb_agg(jsonb_build_object(
      'failureMode', f.failure_mode, 'occurrences', f.occurrences,
      'assetsAffected', f.assets_affected,
      'requirementsReferencing', f.requirements_referencing,
      'loopClosed', f.loop_closed)), '[]'::jsonb)
    into v_backward
  from get_design_feedback_loop() f
  where d.derived_from_failure_mode is not null
    and f.failure_mode = d.derived_from_failure_mode;

  select count(*), count(*) filter (where p.awarded_at is not null),
         array_agg(distinct p.awarded_supplier_id) filter (where p.awarded_supplier_id is not null)
    into v_package_count, v_awarded, v_suppliers
  from contract_package_specifications l
  join contract_packages p on p.id = l.package_id
  where l.organization_id = v_org and l.requirement_id = d.id;

  -- REFUSAL-FIRST at the first hop. "0 failures traced" over a specification
  -- nobody linked to a package reads as a specification that produced no
  -- failures, which is the opposite of what is known.
  if coalesce(v_package_count, 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', '[]'::jsonb,
      'refusal', format(
        'Requirement %s is not linked to any procurement package, so the commercial half of this thread cannot be walked. That is not "this specification caused no failures": nothing connects it to anything that was bought, and every hop after the first is unreachable. Link it (link_package_specification) and the thread runs to the failure history.',
        d.requirement_ref),
      'backward', v_backward,
      'backwardNote', case when d.derived_from_failure_mode is null then
        'This requirement records no originating failure mode, so the reverse direction — from operational failures back to the requirement they produced — has nothing to match on.' end);
  end if;

  select jsonb_agg(jsonb_build_object(
      'packageId', p.id, 'packageCode', p.package_code, 'title', p.title,
      'linkBasis', l.basis,
      'bids', (select count(*) from contract_bids b
                where b.package_id = p.id and b.withdrawn_at is null),
      'awarded', p.awarded_at is not null,
      'contractValue', contract_current_value(p.id),
      'currency', p.contract_currency,
      'supplier', (select s.name from suppliers s where s.id = p.awarded_supplier_id),
      'supplierId', p.awarded_supplier_id,
      'hopNote', case
        when p.awarded_at is null and not exists (
          select 1 from contract_bids b where b.package_id = p.id and b.withdrawn_at is null)
        then 'The thread stops here: this package has been tendered against the specification but has received no live bid, so there is no vendor and no equipment downstream of it.'
        when p.awarded_at is null
        then 'The thread stops here: this package has bids but no award, so nothing downstream of it has a counterparty yet.'
        end)
      order by p.package_code)
    into v_packages
  from contract_package_specifications l
  join contract_packages p on p.id = l.package_id
  where l.organization_id = v_org and l.requirement_id = d.id;

  if coalesce(v_awarded, 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'refusal', format(
        'Requirement %s reaches %s procurement package(s) and NONE of them is awarded, so the thread stops at the tender. There is no vendor, no equipment and no BOM-associated asset downstream of an unawarded package — reporting "no failures" here would be reporting the absence of a purchase as the absence of a problem.',
        d.requirement_ref, v_package_count),
      'backward', v_backward);
  end if;

  -- Vendor → the materials that vendor supplies → the BOMs those materials sit
  -- on → the assets those BOMs belong to. Every hop is a join over a canonical
  -- store; nothing here is a second copy of the relationship.
  select array_agg(distinct ms.material_id) into v_materials
  from material_suppliers ms
  where ms.organization_id = v_org and ms.supplier_id = any (v_suppliers);

  if coalesce(array_length(v_materials, 1), 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'awardedPackages', v_awarded,
      'refusal', format(
        'Requirement %s reaches an awarded contract, and the winning vendor supplies no material recorded in this organization''s catalogue. The thread stops at the vendor: nothing connects what was bought to a part, so nothing connects it to an BOM-associated asset or to a failure. This is a gap in the material master, not evidence that the equipment has not failed.',
        d.requirement_ref),
      'backward', v_backward);
  end if;

  -- BOTH SHAPES OF BOM LINE. bom_lines hangs off a specific asset OR a whole
  -- asset CLASS (20260809180000:85, `check (asset_id is not null or asset_class
  -- is not null)`), and following only the first would refuse a thread whose
  -- parts are catalogued against a class — reporting "this part is on no bill
  -- of materials" about a part that is on every one of them.
  select array_agg(distinct a.id) into v_assets
  from assets a
  where a.organization_id = v_org
    and exists (
      select 1 from bom_lines b
      where b.organization_id = v_org
        and b.material_id = any (v_materials)
        and (b.asset_id = a.id
             or (b.asset_id is null and b.asset_class is not null
                 and b.asset_class = a.asset_class)));

  if coalesce(array_length(v_assets, 1), 0) = 0 then
    return jsonb_build_object('requirementRef', d.requirement_ref,
      'requirement', d.requirement, 'category', d.category,
      'derivedFromFailureMode', d.derived_from_failure_mode,
      'answered', false, 'packages', v_packages, 'packageCount', v_package_count,
      'awardedPackages', v_awarded, 'materials', array_length(v_materials, 1),
      'refusal', format(
        'Requirement %s reaches %s material(s) from the awarded vendor, and none of them appears on any asset''s bill of materials. The thread stops at the part: no BOM associates these parts with an asset, so no associated asset history can be retrieved.',
        d.requirement_ref, array_length(v_materials, 1)),
      'backward', v_backward);
  end if;

  -- Ordered on the COUNT ITSELF, not on its rendered text. Ordering a jsonb
  -- aggregate by the text of the occurrence field sorts the numbers as strings
  -- and puts 9 above 10, which reverses the top of every failure list this
  -- thread produces.
  select coalesce(jsonb_agg(jsonb_build_object(
           'failureMode', g.fm, 'occurrences', g.n,
           'assetsAffected', g.assets,
           'firstSeen', g.first_seen, 'lastSeen', g.last_seen)
         order by g.n desc, g.fm), '[]'::jsonb),
         coalesce(sum(g.n), 0)
    into v_failures, v_failure_total
  from (
    select coalesce(nullif(btrim(w.actual_failure_mode), ''), '(uncoded)') as fm,
           count(*)::bigint as n,
           count(distinct w.asset_id)::bigint as assets,
           min(w.created_at)::date as first_seen,
           max(w.created_at)::date as last_seen
    from work_orders w
    where w.organization_id = v_org and w.work_type = 'corrective'
      and w.asset_id = any (v_assets)
    group by 1
  ) g;

  return jsonb_build_object(
    'requirementRef', d.requirement_ref, 'requirement', d.requirement,
    'category', d.category, 'verificationStatus', d.verification_status,
    'derivedFromFailureMode', d.derived_from_failure_mode,
    'answered', true,
    'packages', v_packages, 'packageCount', v_package_count,
    'awardedPackages', v_awarded,
    'vendors', (select coalesce(jsonb_agg(jsonb_build_object(
        'supplierId', s.id, 'supplier', s.name, 'supplierCode', s.supplier_code,
        'approvedVendor', s.approved_vendor) order by s.name), '[]'::jsonb)
      from suppliers s where s.id = any (v_suppliers)),
    'materials', array_length(v_materials, 1),
    'installedAssets', array_length(v_assets, 1),
    'bomAssets', array_length(v_assets, 1),
    'componentLinks', (select coalesce(jsonb_agg(jsonb_build_object(
      'bomLineId', b.id, 'materialId', b.material_id, 'componentId', c.id,
      'componentName', c.name, 'assetId', c.asset_id, 'quantity', b.qty_per,
      'positionNote', b.position_note) order by c.name, b.id), '[]'::jsonb)
      from public.bom_lines b join public.components c on c.id = b.component_id
      where b.organization_id = v_org and c.organization_id = v_org
        and c.asset_id = b.asset_id and b.material_id = any(v_materials)),
    'historyScope', 'Corrective work orders are asset-level history. BOM and component relationships do not establish installation, component failure, supplier liability or causation.',
    'failures', v_failures,
    'failureTotal', v_failure_total,
    'failureNote', case when coalesce(v_failure_total, 0) = 0 then format(
      'The thread runs the whole way — specification %s, %s package(s), %s awarded, %s material(s), %s BOM-associated asset(s) — and NO corrective work order has been recorded against those assets. That is a fact about the maintenance history, not a warranty: it means nothing has been reported, and how long they have been in service is what makes it meaningful.',
      d.requirement_ref, v_package_count, v_awarded,
      array_length(v_materials, 1), array_length(v_assets, 1)) end,
    'backward', v_backward,
    'backwardNote', case when d.derived_from_failure_mode is null then
      'This requirement records no originating failure mode, so the reverse direction has nothing to match on — the forward half above still runs.'
      when jsonb_array_length(v_backward) = 0 then format(
      'The reverse direction found no corrective history under failure mode "%s" in this organization’s corrective work orders, so the loop this requirement was written to close is not visible in it.',
      d.derived_from_failure_mode) end,
    'basis',
      'Joins over the canonical stores, in the specification''s own order: design_requirements → contract_package_specifications → contract_packages → contract_bids → suppliers → material_suppliers → bom_lines → assets → work_orders. The reverse direction is get_design_feedback_loop, called rather than re-derived.');
end
$$;

revoke all on function public.get_specification_failure_thread(text)
  from public, anon, service_role;
grant execute on function public.get_specification_failure_thread(text) to authenticated;

comment on function public.get_specification_failure_thread(text) is
  'D6.07 / spec I.16: walks Specification → Bid → Contract → Vendor → Equipment → Installed Asset → Failure History as joins over the canonical stores, and REFUSES at whichever hop the chain breaks — naming the hop, because "0 failures traced" over a broken chain reads as a specification that caused none. The reverse direction is get_design_feedback_loop, CALLED rather than re-implemented: two traversals over the same hops would disagree the first time either was repaired.';

notify pgrst, 'reload schema';

