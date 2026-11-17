-- Run against the migrated canonical schema. These pure-predicate probes do
-- not qualify tenant/site reads, HTTP, survey suitability or the future map.
\set ON_ERROR_STOP on
begin;
do $tests$
declare
  c public.connectors%rowtype;
  state text;
  kind text;
  n integer := 0;
  geometry jsonb;
begin
  if has_function_privilege('authenticated','public.sync_context_coordinate_count(jsonb,text)','EXECUTE')
    or has_function_privilege('authenticated','public.sync_context_geometry_is_valid(jsonb,text)','EXECUTE') then
    raise exception 'internal coordinate parser exposed as an authenticated RPC'; end if;
  foreach kind in array array['customer_operational','live_external','simulated_industrial',null,'unknown'] loop
    foreach state in array array['connected','live','simulated','not_connected','stale','unavailable','malformed',
      'throttled','delayed','conflicting','partial_coverage','clock_skew',null,'unknown'] loop
      c.context_source_class := kind;
      c.context_health_state := state;
      if public.sync_context_source_health_permits_emission(c) is distinct from coalesce(
        (kind='simulated_industrial' and state='simulated') or
        (kind in ('customer_operational','live_external') and state in
          ('connected','live','stale','throttled','delayed','conflicting','partial_coverage','clock_skew')),false) then
        raise exception 'health classifier mismatch for class %, state %',kind,state;
      end if;
      n := n+1;
    end loop;
  end loop;
  if public.sync_context_source_health_permits_emission(null::public.connectors) is distinct from false then
    raise exception 'NULL source was allowed'; end if;

  foreach geometry in array array[
    '{"type":"Point","coordinates":[-113.5,53.5]}'::jsonb,
    '{"type":"Point","coordinates":[180,-90,100]}'::jsonb,
    '{"type":"MultiPoint","coordinates":[[0,0],[1,1,3]]}'::jsonb,
    '{"type":"LineString","coordinates":[[0,0],[1,1]]}'::jsonb,
    '{"type":"MultiLineString","coordinates":[[[0,0],[1,1]],[[2,2],[3,3]]]}'::jsonb,
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[0,0]]]}'::jsonb,
    '{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[0,1],[0,0]]]]}'::jsonb
  ] loop
    if public.sync_context_geometry_is_valid(geometry,geometry->>'type') is distinct from true then
      raise exception 'valid structural geometry refused: %',geometry; end if;
    n := n+1;
  end loop;

  foreach geometry in array array[
    null::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,
    '{"type":"Point","coordinates":null}'::jsonb,
    '{"type":"Point","coordinates":[1]}'::jsonb,
    '{"type":"Point","coordinates":[1,2,3,4]}'::jsonb,
    '{"type":"Point","coordinates":["1",2]}'::jsonb,
    '{"type":"Point","coordinates":[1,null]}'::jsonb,
    '{"type":"Point","coordinates":[1,true]}'::jsonb,
    '{"type":"Point","coordinates":[0,0,1e309]}'::jsonb,
    '{"type":"Point","coordinates":[181,2]}'::jsonb,
    '{"type":"Point","coordinates":[1,-91]}'::jsonb,
    '{"type":"Point","coordinates":[0,0],"crs":null}'::jsonb,
    '{"type":"LineString","coordinates":[[0,0]]}'::jsonb,
    '{"type":"MultiPoint","coordinates":[]}'::jsonb,
    '{"type":"MultiLineString","coordinates":[[[0,0]]]}'::jsonb,
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1]]]}'::jsonb,
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,1],[1,1]]]}'::jsonb,
    '{"type":"Polygon","coordinates":[[[0,0,1],[1,0,1],[0,1,1],[0,0,2]]]}'::jsonb,
    '{"type":"MultiPolygon","coordinates":[[]]}'::jsonb,
    '{"type":"GeometryCollection","geometries":[]}'::jsonb
  ] loop
    if public.sync_context_geometry_is_valid(geometry,geometry->>'type') is distinct from false then
      raise exception 'malformed structural geometry permitted: %',geometry; end if;
    n := n+1;
  end loop;
  if public.sync_context_geometry_is_valid('{"type":"Point","coordinates":[0,0]}','Polygon')
    or public.sync_context_geometry_is_valid('{"type":"Point","coordinates":[0,0]}',null) then
    raise exception 'mismatched or NULL declared geometry type permitted'; end if;

  select jsonb_build_object('type','MultiPoint','coordinates',jsonb_agg(jsonb_build_array(0,0)))
    into geometry from generate_series(1,10000);
  if not public.sync_context_geometry_is_valid(geometry,'MultiPoint') then
    raise exception 'exact position budget refused'; end if;
  geometry := jsonb_set(geometry,'{coordinates}',(geometry->'coordinates')||'[[0,0]]'::jsonb);
  if public.sync_context_geometry_is_valid(geometry,'MultiPoint') then
    raise exception 'over-budget geometry permitted'; end if;
  select jsonb_build_object('type','MultiLineString','coordinates',jsonb_build_array(
    jsonb_agg(jsonb_build_array(0,0)),jsonb_agg(jsonb_build_array(1,1))))
    into geometry from generate_series(1,6000);
  if public.sync_context_geometry_is_valid(geometry,'MultiLineString') then
    raise exception 'nested cumulative position budget bypass'; end if;
  raise notice 'SC-02 native pure-predicate probes passed: health_vectors=%, geometry_and_budget_refusals=true',70;
end $tests$;
rollback;

-- Copy CHECK constraints, not canonical FKs, RLS or workflow triggers. This is
-- explicitly a structural constraint probe, never an independent review claim.
begin;
create temporary table context_coordinate_constraint_probe
  (like public.geospatial_features including constraints) on commit drop;
insert into context_coordinate_constraint_probe(id,organization_id,feature_key,feature_type,name,
  geometry_type,geometry,source_system,source_reference,observed_at,data_quality,
  evidence_item_ids,missing_evidence,status,recorded_by,recorded_at)
values('ee010000-0000-4000-8000-000000000001','ee010000-0000-4000-8000-000000000002',
  'sc02-structural-probe','asset','Synthetic structural check only','Point',
  '{"type":"Point","coordinates":[-113.5,53.5]}','ci-synthetic','ci-structural',now(),'good',
  '{}',array['Synthetic constraint probe; no survey or human verification is asserted.'],
  'draft','ee010000-0000-4000-8000-000000000003',now());
do $constraints$
declare v_constraint text; v_accuracy numeric;
begin
  begin
    update context_coordinate_constraint_probe set status='verified',
      verified_by='ee010000-0000-4000-8000-000000000004',verified_at=now(),
      verification_note='Synthetic CHECK-constraint probe, not human verification.';
    raise exception 'missing coordinate contract promoted';
  exception when check_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint<>'geospatial_verified_coordinate_contract' then raise; end if;
  end;
  update context_coordinate_constraint_probe set coordinate_reference_system='EPSG:4326',
    coordinate_axis_order='longitude_latitude',coordinate_basis='Synthetic source declares longitude/latitude WGS84.',
    horizontal_accuracy_m=null;
  update context_coordinate_constraint_probe set status='verified',
    verified_by='ee010000-0000-4000-8000-000000000004',verified_at=now(),
    verification_note='Synthetic CHECK-constraint probe, not human verification.';
  foreach v_accuracy in array array[0::numeric,-1::numeric,1e-400::numeric,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric,1e309::numeric] loop
    begin
      update context_coordinate_constraint_probe set horizontal_accuracy_m=v_accuracy;
      raise exception 'invalid accuracy % accepted',v_accuracy;
    exception when check_violation then
      get stacked diagnostics v_constraint=constraint_name;
      if v_constraint<>'geospatial_coordinate_metadata_complete' then raise; end if;
    end;
  end loop;
  update context_coordinate_constraint_probe set horizontal_accuracy_m=5e-324::numeric;
  update context_coordinate_constraint_probe set horizontal_accuracy_m=0.25;
  begin
    update context_coordinate_constraint_probe set coordinate_axis_order='latitude_longitude';
    raise exception 'wrong axis order accepted';
  exception when check_violation then null; end;
  begin
    update context_coordinate_constraint_probe set coordinate_reference_system=null;
    raise exception 'partial coordinate metadata accepted';
  exception when check_violation then null; end;
  begin
    update context_coordinate_constraint_probe set geometry='{"type":"Point","coordinates":[181,0]}';
    raise exception 'invalid verified geometry accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint<>'geospatial_verified_coordinate_contract' then raise; end if;
  end;
  raise notice 'SC-02 native CHECK probes passed: unknown_accuracy_not_zero=true explicit_axis=true verified_structure=true';
end $constraints$;
rollback;
