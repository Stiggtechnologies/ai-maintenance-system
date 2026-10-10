-- SC-02 prerequisite: canonical coordinate provenance and independent health
-- emission classification. No backfill, inferred CRS/accuracy, shadow store,
-- tenant/site operating RPC, map renderer or operational authority is added.
-- Coordinated after all 76 open PRs; prior maximum 20270103140000 (#652).

create or replace function public.sync_context_source_health_permits_emission(p_source public.connectors)
returns boolean language sql immutable set search_path=public as $$
  select coalesce(case p_source.context_source_class
    when 'simulated_industrial' then p_source.context_health_state='simulated'
    when 'customer_operational' then p_source.context_health_state in
      ('connected','live','stale','throttled','delayed','conflicting','partial_coverage','clock_skew')
    when 'live_external' then p_source.context_health_state in
      ('connected','live','stale','throttled','delayed','conflicting','partial_coverage','clock_skew')
    else false end,false)
$$;
-- Pure value classifier, not a stored-row lookup or a legal rights decision.
-- Use together with sync_context_source_rights_permit in the operating RPC;
-- do not use it to hide repairable records from authoring/verification RLS.
revoke all on function public.sync_context_source_health_permits_emission(public.connectors) from public,anon,service_role;
grant execute on function public.sync_context_source_health_permits_emission(public.connectors) to authenticated;

-- Keep existing historical contradictions available for a governed repair;
-- reject new or amended real-source records claiming simulation. Do not alter
-- health telemetry, connector execution, monotonic clocks or rights reviews.
alter table public.connectors add constraint connectors_context_no_real_simulation check (
  context_health_state is distinct from 'simulated' or coalesce(context_source_class='simulated_industrial',false)
) not valid;

-- Internal structural parser. A NULL count means invalid; all supported paths
-- have fixed depth and a shared cumulative 10,000-position rendering budget.
create or replace function public.sync_context_coordinate_count(p_coordinates jsonb,p_shape text)
returns integer language plpgsql immutable set search_path=public as $$
declare
  v_size integer; v_total integer:=0; v_count integer; v_component jsonb;
  v_child text; v_minimum integer; v_number numeric;
begin
  if jsonb_typeof(p_coordinates) is distinct from 'array' then return null; end if;
  v_size:=jsonb_array_length(p_coordinates);
  if p_shape='position' then
    if v_size not in (2,3) then return null; end if;
    for v_component in select value from jsonb_array_elements(p_coordinates) loop
      if jsonb_typeof(v_component) is distinct from 'number' then return null; end if;
      v_number:=(v_component#>>'{}')::numeric;
      if abs(v_number)>1.7976931348623157e308::numeric then return null; end if;
    end loop;
    if (p_coordinates->>0)::numeric not between -180 and 180
      or (p_coordinates->>1)::numeric not between -90 and 90 then return null; end if;
    return 1;
  end if;
  case p_shape
    when 'points' then v_child:='position'; v_minimum:=1;
    when 'line' then v_child:='position'; v_minimum:=2;
    when 'ring' then v_child:='position'; v_minimum:=4;
    when 'lines' then v_child:='line'; v_minimum:=1;
    when 'polygon' then v_child:='ring'; v_minimum:=1;
    when 'polygons' then v_child:='polygon'; v_minimum:=1;
    else return null;
  end case;
  if v_size<v_minimum or v_size>10000 then return null; end if;
  if p_shape='ring' and p_coordinates->0 is distinct from p_coordinates->(v_size-1) then return null; end if;
  for v_component in select value from jsonb_array_elements(p_coordinates) loop
    v_count:=public.sync_context_coordinate_count(v_component,v_child);
    if v_count is null then return null; end if;
    v_total:=v_total+v_count;
    if v_total>10000 then return null; end if;
  end loop;
  return v_total;
exception when invalid_text_representation or numeric_value_out_of_range then return null;
end $$;
revoke all on function public.sync_context_coordinate_count(jsonb,text) from public,anon,authenticated,service_role;

create or replace function public.sync_context_geometry_is_valid(p_geometry jsonb,p_geometry_type text)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_shape text;
begin
  if jsonb_typeof(p_geometry) is distinct from 'object' or p_geometry?'crs'
    or p_geometry_type is null or p_geometry->>'type' is distinct from p_geometry_type then return false; end if;
  v_shape:=case p_geometry_type
    when 'Point' then 'position' when 'MultiPoint' then 'points'
    when 'LineString' then 'line' when 'MultiLineString' then 'lines'
    when 'Polygon' then 'polygon' when 'MultiPolygon' then 'polygons' else null end;
  if v_shape is null then return false; end if;
  return public.sync_context_coordinate_count(p_geometry->'coordinates',v_shape) is not null;
end $$;
revoke all on function public.sync_context_geometry_is_valid(jsonb,text) from public,anon,authenticated,service_role;

alter table public.geospatial_features
  add column coordinate_reference_system text,
  add column coordinate_axis_order text,
  add column coordinate_basis text,
  add column horizontal_accuracy_m numeric;

alter table public.geospatial_features add constraint geospatial_coordinate_metadata_complete check (
  (num_nonnulls(coordinate_reference_system,coordinate_axis_order,coordinate_basis,horizontal_accuracy_m)=0)
  or coalesce(coordinate_reference_system='EPSG:4326' and coordinate_axis_order='longitude_latitude'
    and length(btrim(coordinate_basis))>=20 and length(coordinate_basis)<=4000
    and (horizontal_accuracy_m is null or (horizontal_accuracy_m>=5e-324::numeric
      and horizontal_accuracy_m not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      and horizontal_accuracy_m<=1.7976931348623157e308::numeric)),false)
);
-- NOT VALID preserves historical rows without asserting new provenance. It
-- enforces the contract on new/updated verified rows; superseding an old row
-- remains possible. The new projection must explicitly exclude old NULLs.
alter table public.geospatial_features add constraint geospatial_verified_coordinate_contract check (
  status<>'verified' or coalesce(coordinate_reference_system='EPSG:4326'
    and coordinate_axis_order='longitude_latitude' and length(btrim(coordinate_basis))>=20
    and public.sync_context_geometry_is_valid(geometry,geometry_type),false)
) not valid;

-- Same signature, canonical source/tenant/evidence/owner/audit and independent
-- human workflow. New drafts carry explicit coordinates before verification.
create or replace function public.record_geospatial_feature(p_feature jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid; v_source public.connectors%rowtype;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'evidence_item_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'missing_evidence','[]'))),'{}');
  v_coordinate jsonb:=p_feature->'coordinate'; v_accuracy numeric;
begin
  if auth.uid() is null or v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','executive','admin') then return jsonb_build_object('error','a named same-tenant human role must record geospatial evidence; AI identity is not accepted'); end if;
  select * into v_source from public.connectors where id=nullif(p_feature->>'source_connector_id','')::uuid and organization_id=v_org and context_source_class is not null;
  if not found then return jsonb_build_object('error','select a same-tenant classified Context source; free-text source authority is not accepted'); end if;
  if not coalesce(public.sync_context_source_rights_permit(v_source),false) then
    return jsonb_build_object('error','source rights review does not permit this Context use'); end if;
  if coalesce(p_feature->>'feature_type','') not in ('site','asset','linear_route','access_route','hazard_zone','weather_cell','receptor','logistics_hub','spares_region','failure_cluster') then return jsonb_build_object('error','unsupported geospatial feature type'); end if;
  if not public.sync_context_geometry_is_valid(p_feature->'geometry',p_feature->>'geometry_type') then
    return jsonb_build_object('error','source-supplied structural GeoJSON geometry is invalid or exceeds the coordinate budget'); end if;
  if jsonb_typeof(v_coordinate) is distinct from 'object'
    or v_coordinate->>'referenceSystem' is distinct from 'EPSG:4326'
    or v_coordinate->>'axisOrder' is distinct from 'longitude_latitude'
    or jsonb_typeof(v_coordinate->'basis') is distinct from 'string'
    or coalesce(length(btrim(v_coordinate->>'basis')),0)<20 or length(v_coordinate->>'basis')>4000
    or not v_coordinate?'horizontalAccuracyM'
    or jsonb_typeof(v_coordinate->'horizontalAccuracyM') not in ('number','null') then
    return jsonb_build_object('error','explicit WGS84 longitude/latitude provenance and supplied accuracy or unknown null are required'); end if;
  if jsonb_typeof(v_coordinate->'horizontalAccuracyM')='number' then
    v_accuracy:=(v_coordinate->>'horizontalAccuracyM')::numeric;
    if v_accuracy<5e-324::numeric or v_accuracy>1.7976931348623157e308::numeric then
      return jsonb_build_object('error','coordinate accuracy must be positive finite metres or unknown null'); end if;
  end if;
  if coalesce(length(trim(p_feature->>'feature_key')),0)<2 or coalesce(length(trim(p_feature->>'name')),0)<2 or coalesce(length(trim(p_feature->>'source_reference')),0)<2 or nullif(p_feature->>'observed_at','') is null then return jsonb_build_object('error','feature identity, source reference and observation time are required'); end if;
  if coalesce(p_feature->>'data_quality','') not in ('unknown','poor','fair','good','verified') then return jsonb_build_object('error','state the source data quality'); end if;
  if coalesce(p_feature->>'validity_kind','') not in ('permanent','temporary') or (p_feature->>'validity_kind'='temporary' and nullif(p_feature->>'valid_until','') is null) or (p_feature->>'validity_kind'='permanent' and nullif(p_feature->>'valid_until','') is not null) then return jsonb_build_object('error','state permanent or bounded temporary validity'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then return jsonb_build_object('error','cite canonical evidence or name missing evidence; SyncAI will not invent coordinates or source authority'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence))) or exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null) then return jsonb_build_object('error','evidence ids must be unique and belong to this organization'); end if;
  update public.geospatial_features set status='superseded' where organization_id=v_org and feature_key=trim(p_feature->>'feature_key') and status in ('draft','verified');
  insert into public.geospatial_features(organization_id,feature_key,feature_type,name,geometry_type,geometry,
    source_system,source_reference,source_connector_id,observed_at,valid_until,validity_kind,data_quality,
    evidence_item_ids,missing_evidence,recorded_by,context_owner_id,
    coordinate_reference_system,coordinate_axis_order,coordinate_basis,horizontal_accuracy_m)
  values(v_org,trim(p_feature->>'feature_key'),p_feature->>'feature_type',trim(p_feature->>'name'),p_feature->>'geometry_type',p_feature->'geometry',
    v_source.connector_key,trim(p_feature->>'source_reference'),v_source.id,(p_feature->>'observed_at')::timestamptz,
    nullif(p_feature->>'valid_until','')::timestamptz,p_feature->>'validity_kind',p_feature->>'data_quality',v_evidence,v_missing,auth.uid(),auth.uid(),
    v_coordinate->>'referenceSystem',v_coordinate->>'axisOrder',v_coordinate->>'basis',v_accuracy) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data) values(v_org,'geospatial_feature',v_role,
    jsonb_build_object('feature_id',v_id,'source_connector_id',v_source.id,'source_class',v_source.context_source_class,
      'status','draft','coordinate_basis_asserted',true,'horizontal_accuracy_m',v_accuracy,
      'boundary','source geometry recorded only; no dispatch, approval or work release'));
  return jsonb_build_object('feature_id',v_id,'status','draft','source_class',v_source.context_source_class,'operational_authority',false);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error','feature identifiers and timestamps must use their declared formats');
  when others then return jsonb_build_object('error','unable to record geospatial feature; review geometry, validity and provenance');
end $$;
revoke all on function public.record_geospatial_feature(jsonb) from public,anon,service_role;
grant execute on function public.record_geospatial_feature(jsonb) to authenticated;

-- Retain the canonical authoring workspace and its explicit privacy projection.
-- Independent reviewers must be able to inspect the asserted encoding/basis
-- and unknown versus supplied accuracy before verifying a source feature.
create or replace function public.get_geospatial_operational_workspace()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
begin
  if v_org is null or coalesce(v_role,'') not in
    ('technician','planner','reliability_engineer','maintenance_manager','executive','admin','ai_admin') then
    return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'feature_types',jsonb_build_array('site','asset','linear_route','access_route','hazard_zone','weather_cell','receptor','logistics_hub','spares_region','failure_cluster'),
    'assessment_types',jsonb_build_array('weather_hazard_exposure','access_route','crew_travel','remote_logistics','regional_spares','failure_clustering','hazard_overlay','linear_reference'),
    'features',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'feature_key',f.feature_key,'feature_type',f.feature_type,'name',f.name,
      'geometry_type',f.geometry_type,'geometry',f.geometry,'source_system',f.source_system,
      'source_connector_id',f.source_connector_id,'source_reference',f.source_reference,
      'observed_at',f.observed_at,'valid_until',f.valid_until,'validity_kind',f.validity_kind,
      'coordinate_reference_system',f.coordinate_reference_system,'coordinate_axis_order',f.coordinate_axis_order,
      'coordinate_basis',f.coordinate_basis,'horizontal_accuracy_m',f.horizontal_accuracy_m,
      'data_quality',f.data_quality,'evidence_item_ids',f.evidence_item_ids,
      'missing_evidence',f.missing_evidence,'status',f.status) order by f.recorded_at desc)
      from public.geospatial_features f join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
      where f.organization_id=v_org and f.status in ('draft','verified')
        and public.sync_context_source_rights_permit(c)),'[]'::jsonb) end,
    'links',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'organization_id',l.organization_id,'feature_id',l.feature_id,'relationship_type',l.relationship_type,
      'asset_id',l.asset_id,'site_id',l.site_id,'linear_route_id',l.linear_route_id,'linear_segment_id',l.linear_segment_id,
      'from_measure',l.from_measure,'to_measure',l.to_measure,'basis',l.basis,'evidence_item_ids',l.evidence_item_ids,
      'recorded_at',l.recorded_at) order by l.recorded_at desc)
      from public.geospatial_subject_links l
      join public.geospatial_features f on f.id=l.feature_id and f.organization_id=l.organization_id
      join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
      where l.organization_id=v_org and public.sync_context_source_rights_permit(c)),'[]'::jsonb) end,
    'assessments',case when v_role='technician' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'assessment_type',a.assessment_type,'title',a.title,'asset_id',a.asset_id,
      'site_id',a.site_id,'recommendation_id',a.recommendation_id,'exposure_rating',a.exposure_rating,
      'basis',a.basis,'conclusion',a.conclusion,'evidence_item_ids',a.evidence_item_ids,
      'missing_evidence',a.missing_evidence,'status',a.status) order by a.recorded_at desc)
      from public.geospatial_operational_assessments a where a.organization_id=v_org and a.status in ('draft','verified')
        and (a.recommendation_id is null or exists(select 1 from public.recommendations r where r.id=a.recommendation_id
          and r.organization_id=a.organization_id and (r.risk_id is null or public.can_read_risk(r.risk_id))))
        and (a.access_route_feature_id is null or exists(select 1 from public.geospatial_features f
          join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
          where f.id=a.access_route_feature_id and f.organization_id=a.organization_id
            and public.sync_context_source_rights_permit(c)))
        and not exists(select 1 from unnest(a.input_feature_ids) x(id)
          left join public.geospatial_features f on f.id=x.id and f.organization_id=a.organization_id
          left join public.connectors c on c.id=f.source_connector_id and c.organization_id=f.organization_id
          where f.id is null or c.id is null or not public.sync_context_source_rights_permit(c))),'[]'::jsonb) end,
    'regional_stock',coalesce((select jsonb_agg(jsonb_build_object('material_id',s.material_id,'material_code',m.material_code,
      'description',m.description,'site_id',s.site_id,'site_name',si.name,'qty_on_hand',s.qty_on_hand,
      'qty_reserved',s.qty_reserved,'qty_on_order',s.qty_on_order,'last_counted_at',s.last_counted_at,
      'source_system',s.source_system) order by m.material_code,si.name) from public.material_stock s
      join public.materials m on m.id=s.material_id and m.organization_id=s.organization_id
      left join public.sites si on si.id=s.site_id and si.organization_id=s.organization_id where s.organization_id=v_org),'[]'::jsonb),
    'linear_routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'asset_id',r.asset_id,'route_code',r.route_code,
      'measure_unit',r.measure_unit,'start_measure',r.start_measure,'end_measure',r.end_measure,
      'defect_count',(select count(*) from public.linear_defects d where d.organization_id=r.organization_id and d.route_id=r.id))
      order by r.route_code) from public.linear_asset_routes r where r.organization_id=v_org),'[]'::jsonb),
    'weather_signals',coalesce((select jsonb_agg(to_jsonb(s) order by s.observed_at desc)
      from public.operational_constraint_signals s where s.organization_id=v_org and s.signal_kind='weather'),'[]'::jsonb),
    'basis','Verified, source-supplied geospatial evidence is decision context only. SyncAI does not infer coordinates, exposure, travel, stock availability or cluster significance and never dispatches crews, approves a route or recommendation, or releases work.');
end $$;
revoke all on function public.get_geospatial_operational_workspace() from public,anon,service_role;
grant execute on function public.get_geospatial_operational_workspace() to authenticated;

comment on column public.geospatial_features.coordinate_basis is
  'Asserted source-coordinate description, not independently authenticated survey evidence. Historical NULL remains unknown.';
comment on function public.sync_context_geometry_is_valid(jsonb,text) is
  'Structural RFC 7946 renderer gate only. No topology, survey, safety, route, distance or engineering suitability certification.';
notify pgrst,'reload schema';
