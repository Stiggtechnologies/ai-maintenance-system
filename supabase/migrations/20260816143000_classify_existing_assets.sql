-- ============================================================================
-- Classify the assets already in the register against the ontology.
--
-- This is not demo data. Every asset currently held by either organization is
-- genuinely a discrete machine — haul trucks, shovels, dozers, graders, pumps,
-- compressors, conveyors, a heat exchanger — so classifying them as point
-- assets records something true rather than filling a column.
--
-- The mapping is deliberately conservative and EXPLICIT. Anything whose class
-- text is not recognised is left unclassified rather than defaulted to
-- fixed_equipment, because the coverage function reports unclassified assets
-- as "analysed as discrete machines by default", and that warning has to stay
-- true for the assets it is warning about. A silent default here would erase
-- exactly the signal the ontology was built to raise.
-- ============================================================================

insert into asset_class_assignments (asset_id, organization_id, class_key, basis)
select a.id, a.organization_id,
  case
    when a.asset_class ilike '%haul truck%'
      or a.asset_class ilike '%shovel%'
      or a.asset_class ilike '%dozer%'
      or a.asset_class ilike '%grader%'
      or a.asset_class ilike '%loader%'
      or a.asset_class ilike '%water truck%'
      or a.asset_class ilike '%transporter%'
      then 'mobile_fleet'
    when a.asset_class ilike '%pump%'
      or a.asset_class ilike '%compressor%'
      or a.asset_class ilike '%conveyor%'
      or a.asset_class ilike '%exchanger%'
      then 'fixed_equipment'
  end,
  'Classified from the recorded asset class. Both classes are point assets: '
  || 'discrete machines with a serial number and running hours, for which the '
  || 'platform''s existing reliability arithmetic is valid.'
from assets a
where a.asset_class is not null
  and (
    a.asset_class ilike '%haul truck%' or a.asset_class ilike '%shovel%'
    or a.asset_class ilike '%dozer%' or a.asset_class ilike '%grader%'
    or a.asset_class ilike '%loader%' or a.asset_class ilike '%water truck%'
    or a.asset_class ilike '%transporter%' or a.asset_class ilike '%pump%'
    or a.asset_class ilike '%compressor%' or a.asset_class ilike '%conveyor%'
    or a.asset_class ilike '%exchanger%'
  )
on conflict (asset_id) do nothing;

-- ---------------------------------------------------------------------------
-- One illustrative linear route in the DEMO organization only, so the density
-- analysis has something to run against. Labelled DEMO in the route code and
-- description; the private operator organization gets nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_asset uuid;
  v_route bigint;
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;
  if exists (select 1 from linear_asset_routes where organization_id = v_org) then
    return;  -- idempotent
  end if;

  -- Hang the route off the overland conveyor, which is the one genuinely
  -- linear thing in the demo register.
  select id into v_asset from assets
   where organization_id = v_org and tag = 'C-001' limit 1;
  if v_asset is null then
    return;
  end if;

  insert into asset_class_assignments (asset_id, organization_id, class_key, basis)
  values (v_asset, v_org, 'linear',
          'DEMO — reclassified as a linear asset to demonstrate route-based analysis. '
          || 'An overland conveyor genuinely is measured along its length.')
  on conflict (asset_id) do update set class_key = 'linear', basis = excluded.basis;

  insert into linear_asset_routes
    (organization_id, asset_id, route_code, measure_unit, start_measure, end_measure, description)
  values (v_org, v_asset, 'DEMO-CV-001', 'km', 0, 10,
          'DEMO — illustrative 10 km overland conveyor route.')
  returning id into v_route;

  insert into linear_segments (organization_id, route_id, from_measure, to_measure, attributes)
  values
    (v_org, v_route, 0, 3, '{"terrain":"flat","idler_spacing_m":1.2}'),
    (v_org, v_route, 3, 5, '{"terrain":"incline","idler_spacing_m":1.0,"note":"DEMO — steepest section"}'),
    (v_org, v_route, 5, 10, '{"terrain":"flat","idler_spacing_m":1.2}');

  -- Defects concentrated on the incline, which is the finding: a single
  -- availability figure for the conveyor would average this away entirely.
  insert into linear_defects
    (organization_id, route_id, at_measure, defect_type, severity, detection_method, detected_at)
  values
    (v_org, v_route, 0.5, 'idler seizure', 'minor',    'DEMO — walkdown', now() - interval '200 days'),
    (v_org, v_route, 3.1, 'idler seizure', 'moderate', 'DEMO — walkdown', now() - interval '180 days'),
    (v_org, v_route, 3.4, 'belt wear',     'moderate', 'DEMO — walkdown', now() - interval '150 days'),
    (v_org, v_route, 3.8, 'idler seizure', 'major',    'DEMO — walkdown', now() - interval '120 days'),
    (v_org, v_route, 4.1, 'belt tear',     'major',    'DEMO — walkdown', now() - interval '90 days'),
    (v_org, v_route, 4.5, 'idler seizure', 'moderate', 'DEMO — walkdown', now() - interval '60 days'),
    (v_org, v_route, 4.9, 'belt wear',     'moderate', 'DEMO — walkdown', now() - interval '30 days'),
    (v_org, v_route, 8.2, 'coating loss',  'minor',    'DEMO — walkdown', now() - interval '20 days');
end $$;
