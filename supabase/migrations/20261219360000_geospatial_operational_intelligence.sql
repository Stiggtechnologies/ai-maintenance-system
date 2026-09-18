-- U10.01 — governed geospatial operational intelligence.
-- Canonical reuse: assets/sites, linear routes/segments/defects, workforce/crews,
-- materials/stock, recommendations, evidence, Recovery signals and audit events.
-- Geometry is source-supplied GeoJSON; SyncAI does not invent coordinates.

create table if not exists public.geospatial_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_key text not null,
  feature_type text not null check (feature_type in
    ('site','asset','linear_route','access_route','hazard_zone','weather_cell',
     'receptor','logistics_hub','spares_region','failure_cluster')),
  name text not null,
  geometry_type text not null check (geometry_type in
    ('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon')),
  geometry jsonb not null,
  source_system text not null,
  source_reference text not null,
  observed_at timestamptz not null,
  valid_until timestamptz,
  data_quality text not null check (data_quality in ('unknown','poor','fair','good','verified')),
  evidence_item_ids uuid[] not null default '{}',
  missing_evidence text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','verified','superseded')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  check (length(trim(feature_key))>=2 and length(trim(name))>=2),
  check (length(trim(source_system))>=2 and length(trim(source_reference))>=2),
  check (jsonb_typeof(geometry)='object' and geometry->>'type'=geometry_type
    and jsonb_typeof(geometry->'coordinates')='array'),
  check (valid_until is null or valid_until>observed_at),
  check (cardinality(evidence_item_ids)>0 or cardinality(missing_evidence)>0),
  check ((status='draft' and verified_by is null and verified_at is null)
    or (status='verified' and verified_by is not null and verified_at is not null
      and verified_by<>recorded_by and length(trim(coalesce(verification_note,'')))>=20)
    or status='superseded')
);
create unique index if not exists uq_geospatial_feature_active
  on public.geospatial_features(organization_id,feature_key) where status in ('draft','verified');
create index if not exists idx_geospatial_features_type
  on public.geospatial_features(organization_id,feature_type,status,observed_at desc);

create table if not exists public.geospatial_subject_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id uuid not null references public.geospatial_features(id) on delete cascade,
  relationship_type text not null check (relationship_type in
    ('located_at','traverses','exposed_to','accessible_via','near_receptor','served_by','in_region')),
  asset_id uuid references public.assets(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  linear_route_id bigint references public.linear_asset_routes(id) on delete cascade,
  linear_segment_id bigint references public.linear_segments(id) on delete cascade,
  from_measure numeric,
  to_measure numeric,
  basis text not null,
  evidence_item_ids uuid[] not null default '{}',
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  check (num_nonnulls(asset_id,site_id,linear_route_id,linear_segment_id)>=1),
  check ((from_measure is null and to_measure is null)
    or (linear_route_id is not null and from_measure is not null and to_measure is not null
      and to_measure>from_measure)),
  check (length(trim(basis))>=20)
);
create unique index if not exists uq_geospatial_subject_link
  on public.geospatial_subject_links(organization_id,feature_id,relationship_type,
    coalesce(asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(linear_route_id,0),coalesce(linear_segment_id,0));

create table if not exists public.geospatial_operational_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_type text not null check (assessment_type in
    ('weather_hazard_exposure','access_route','crew_travel','remote_logistics',
     'regional_spares','failure_clustering','hazard_overlay','linear_reference')),
  title text not null,
  asset_id uuid references public.assets(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  recommendation_id uuid references public.recommendations(id) on delete set null,
  linear_route_id bigint references public.linear_asset_routes(id) on delete set null,
  from_measure numeric,
  to_measure numeric,
  access_route_feature_id uuid references public.geospatial_features(id) on delete set null,
  crew_template_id bigint references public.crew_templates(id) on delete set null,
  material_id uuid references public.materials(id) on delete set null,
  stock_site_id uuid references public.sites(id) on delete set null,
  input_feature_ids uuid[] not null default '{}',
  evidence_item_ids uuid[] not null default '{}',
  missing_evidence text[] not null default '{}',
  observed_distance numeric,
  distance_unit text,
  observed_travel_minutes numeric,
  exposure_rating text not null default 'unknown' check (exposure_rating in
    ('none','low','medium','high','critical','unknown')),
  findings jsonb not null default '{}',
  basis text not null,
  conclusion text not null,
  status text not null default 'draft' check (status in ('draft','verified','superseded')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  verification_note text,
  check (length(trim(title))>=3 and length(trim(basis))>=20 and length(trim(conclusion))>=20),
  check ((from_measure is null and to_measure is null)
    or (linear_route_id is not null and from_measure is not null and to_measure is not null
      and to_measure>from_measure)),
  check ((observed_distance is null and distance_unit is null)
    or (observed_distance>=0 and observed_distance not in
      ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      and length(trim(coalesce(distance_unit,'')))>=1)),
  check (observed_travel_minutes is null or (observed_travel_minutes>=0
    and observed_travel_minutes not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))),
  check (cardinality(evidence_item_ids)>0 or cardinality(missing_evidence)>0),
  check ((status='draft' and verified_by is null and verified_at is null)
    or (status='verified' and verified_by is not null and verified_at is not null
      and verified_by<>recorded_by and length(trim(coalesce(verification_note,'')))>=20)
    or status='superseded')
);
create index if not exists idx_geo_assessment_org
  on public.geospatial_operational_assessments(organization_id,assessment_type,status,recorded_at desc);

alter table public.geospatial_features enable row level security;
alter table public.geospatial_subject_links enable row level security;
alter table public.geospatial_operational_assessments enable row level security;
drop policy if exists geospatial_features_read on public.geospatial_features;
create policy geospatial_features_read on public.geospatial_features for select to authenticated
  using (organization_id=public.app_current_org());
drop policy if exists geospatial_subject_links_read on public.geospatial_subject_links;
create policy geospatial_subject_links_read on public.geospatial_subject_links for select to authenticated
  using (organization_id=public.app_current_org());
drop policy if exists geospatial_assessments_read on public.geospatial_operational_assessments;
create policy geospatial_assessments_read on public.geospatial_operational_assessments for select to authenticated
  using (organization_id=public.app_current_org() and
    (recommendation_id is null or exists(select 1 from public.recommendations r
      where r.id=recommendation_id and r.organization_id=public.app_current_org()
        and (r.risk_id is null or public.can_read_risk(r.risk_id)))));
revoke insert,update,delete,truncate on public.geospatial_features,
  public.geospatial_subject_links,public.geospatial_operational_assessments
  from public,anon,authenticated;

create or replace function public.record_geospatial_feature(p_feature jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'evidence_item_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_feature->'missing_evidence','[]'))),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','planner','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human role must record geospatial evidence; AI identity is not accepted'); end if;
  if p_feature->>'feature_type' not in ('site','asset','linear_route','access_route','hazard_zone',
    'weather_cell','receptor','logistics_hub','spares_region','failure_cluster') then
    return jsonb_build_object('error','unsupported geospatial feature type'); end if;
  if p_feature->>'geometry_type' not in ('Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon')
    or jsonb_typeof(p_feature->'geometry')<>'object'
    or p_feature->'geometry'->>'type'<>p_feature->>'geometry_type'
    or jsonb_typeof(p_feature->'geometry'->'coordinates')<>'array' then
    return jsonb_build_object('error','source-supplied GeoJSON geometry and matching geometry type are required'); end if;
  if coalesce(length(trim(p_feature->>'feature_key')),0)<2 or coalesce(length(trim(p_feature->>'name')),0)<2
    or coalesce(length(trim(p_feature->>'source_system')),0)<2
    or coalesce(length(trim(p_feature->>'source_reference')),0)<2
    or nullif(p_feature->>'observed_at','') is null then
    return jsonb_build_object('error','feature identity, source reference and observation time are required'); end if;
  if p_feature->>'data_quality' not in ('unknown','poor','fair','good','verified') then
    return jsonb_build_object('error','state the source data quality'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then
    return jsonb_build_object('error','cite canonical evidence or name missing evidence; SyncAI will not invent coordinates or source authority'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence)))
    or exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e
      on e.id=x.id and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','evidence ids must be unique and belong to this organization'); end if;
  update public.geospatial_features set status='superseded'
    where organization_id=v_org and feature_key=trim(p_feature->>'feature_key') and status in ('draft','verified');
  insert into public.geospatial_features(organization_id,feature_key,feature_type,name,
    geometry_type,geometry,source_system,source_reference,observed_at,valid_until,
    data_quality,evidence_item_ids,missing_evidence,recorded_by)
  values(v_org,trim(p_feature->>'feature_key'),p_feature->>'feature_type',trim(p_feature->>'name'),
    p_feature->>'geometry_type',p_feature->'geometry',trim(p_feature->>'source_system'),
    trim(p_feature->>'source_reference'),(p_feature->>'observed_at')::timestamptz,
    nullif(p_feature->>'valid_until','')::timestamptz,p_feature->>'data_quality',
    v_evidence,v_missing,auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'geospatial_feature',v_role,jsonb_build_object('feature_id',v_id,'status','draft',
      'boundary','source geometry recorded only; no dispatch, approval or work release'));
  return jsonb_build_object('feature_id',v_id,'status','draft');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.verify_geospatial_feature(p_feature_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); f public.geospatial_features%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','planner','executive','admin') then
    return jsonb_build_object('error','independent verification requires a named same-tenant human role'); end if;
  select * into f from public.geospatial_features where id=p_feature_id and organization_id=v_org for update;
  if not found or f.status<>'draft' then return jsonb_build_object('error','draft geospatial feature not found'); end if;
  if f.recorded_by=auth.uid() then return jsonb_build_object('error','the feature author cannot independently verify the same source feature'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive verification method and conclusion'); end if;
  if cardinality(f.evidence_item_ids)=0 then return jsonb_build_object('error','verified geospatial features require canonical evidence'); end if;
  if exists(select 1 from unnest(f.evidence_item_ids) x(id) left join public.evidence_items e
    on e.id=x.id and e.organization_id=v_org where e.id is null or e.verification_status<>'verified') then
    return jsonb_build_object('error','all cited evidence must be independently verified'); end if;
  update public.geospatial_features set status='verified',data_quality='verified',verified_by=auth.uid(),
    verified_at=now(),verification_note=trim(p_note) where id=f.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'geospatial_feature_verification',v_role,jsonb_build_object('feature_id',f.id,'independent',true));
  return jsonb_build_object('feature_id',f.id,'status','verified');
end $$;

create or replace function public.link_geospatial_subject(p_link jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_feature uuid:=nullif(p_link->>'feature_id','')::uuid; v_asset uuid:=nullif(p_link->>'asset_id','')::uuid;
  v_site uuid:=nullif(p_link->>'site_id','')::uuid; v_route bigint:=nullif(p_link->>'linear_route_id','')::bigint;
  v_segment bigint:=nullif(p_link->>'linear_segment_id','')::bigint;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_link->'evidence_item_ids','[]'))::uuid),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','admin') then
    return jsonb_build_object('error','a named same-tenant human role must link geospatial context'); end if;
  if p_link->>'relationship_type' not in ('located_at','traverses','exposed_to','accessible_via','near_receptor','served_by','in_region')
    or coalesce(length(trim(p_link->>'basis')),0)<20 then return jsonb_build_object('error','valid relationship and substantive basis are required'); end if;
  if not exists(select 1 from public.geospatial_features where id=v_feature and organization_id=v_org and status='verified') then
    return jsonb_build_object('error','verified geospatial feature not found in this organization'); end if;
  if num_nonnulls(v_asset,v_site,v_route,v_segment)<1 then return jsonb_build_object('error','link a canonical asset, site, route or segment'); end if;
  if v_asset is not null and not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  if v_site is not null and not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then return jsonb_build_object('error','site not found'); end if;
  if v_route is not null and not exists(select 1 from public.linear_asset_routes where id=v_route and organization_id=v_org) then return jsonb_build_object('error','linear route not found'); end if;
  if v_segment is not null and not exists(select 1 from public.linear_segments where id=v_segment and organization_id=v_org and (v_route is null or route_id=v_route)) then return jsonb_build_object('error','linear segment not found'); end if;
  if exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null) then return jsonb_build_object('error','link evidence must belong to this organization'); end if;
  insert into public.geospatial_subject_links(organization_id,feature_id,relationship_type,asset_id,site_id,
    linear_route_id,linear_segment_id,from_measure,to_measure,basis,evidence_item_ids,recorded_by)
  values(v_org,v_feature,p_link->>'relationship_type',v_asset,v_site,v_route,v_segment,
    nullif(p_link->>'from_measure','')::numeric,nullif(p_link->>'to_measure','')::numeric,
    trim(p_link->>'basis'),v_evidence,auth.uid()) returning id into v_id;
  return jsonb_build_object('link_id',v_id,'status','recorded');
exception when unique_violation then return jsonb_build_object('error','the active feature-to-subject link already exists'); end $$;

create or replace function public.record_geospatial_operational_assessment(p_assessment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_asset uuid:=nullif(p_assessment->>'asset_id','')::uuid; v_site uuid:=nullif(p_assessment->>'site_id','')::uuid;
  v_rec uuid:=nullif(p_assessment->>'recommendation_id','')::uuid;
  v_route bigint:=nullif(p_assessment->>'linear_route_id','')::bigint;
  v_access uuid:=nullif(p_assessment->>'access_route_feature_id','')::uuid;
  v_crew bigint:=nullif(p_assessment->>'crew_template_id','')::bigint;
  v_material uuid:=nullif(p_assessment->>'material_id','')::uuid; v_stock_site uuid:=nullif(p_assessment->>'stock_site_id','')::uuid;
  v_features uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'input_feature_ids','[]'))::uuid),'{}');
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'evidence_item_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'missing_evidence','[]'))),'{}');
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human role must record the assessment; AI identity is not accepted'); end if;
  if p_assessment->>'assessment_type' not in ('weather_hazard_exposure','access_route','crew_travel','remote_logistics',
    'regional_spares','failure_clustering','hazard_overlay','linear_reference') then return jsonb_build_object('error','unsupported geospatial assessment type'); end if;
  if coalesce(length(trim(p_assessment->>'title')),0)<3 or coalesce(length(trim(p_assessment->>'basis')),0)<20
    or coalesce(length(trim(p_assessment->>'conclusion')),0)<20 then return jsonb_build_object('error','title, substantive evidence basis and bounded conclusion are required'); end if;
  if p_assessment->>'exposure_rating' not in ('none','low','medium','high','critical','unknown') then return jsonb_build_object('error','valid exposure rating is required'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then return jsonb_build_object('error','cite evidence or name missing evidence; SyncAI will not infer exposure, travel, stock or clustering'); end if;
  if v_asset is not null and not exists(select 1 from public.assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found'); end if;
  if v_site is not null and not exists(select 1 from public.sites where id=v_site and organization_id=v_org) then return jsonb_build_object('error','site not found'); end if;
  if v_rec is not null and not exists(select 1 from public.recommendations where id=v_rec and organization_id=v_org and (risk_id is null or public.can_read_risk(risk_id))) then return jsonb_build_object('error','recommendation not found'); end if;
  if v_rec is not null and v_asset is not null and exists(select 1 from public.recommendations where id=v_rec and organization_id=v_org and asset_id is not null and asset_id<>v_asset) then return jsonb_build_object('error','recommendation and assessment assets do not match'); end if;
  if v_route is not null and not exists(select 1 from public.linear_asset_routes where id=v_route and organization_id=v_org and (v_asset is null or asset_id=v_asset)) then return jsonb_build_object('error','linear route not found for the assessment asset'); end if;
  if v_access is not null and not exists(select 1 from public.geospatial_features where id=v_access and organization_id=v_org and feature_type='access_route' and status='verified') then return jsonb_build_object('error','verified access-route feature not found'); end if;
  if v_crew is not null and not exists(select 1 from public.crew_templates where id=v_crew and organization_id=v_org) then return jsonb_build_object('error','crew template not found'); end if;
  if v_material is not null and not exists(select 1 from public.materials where id=v_material and organization_id=v_org) then return jsonb_build_object('error','material not found'); end if;
  if v_stock_site is not null and not exists(select 1 from public.sites where id=v_stock_site and organization_id=v_org) then return jsonb_build_object('error','stock site not found'); end if;
  if p_assessment->>'assessment_type'='regional_spares' and (v_material is null or v_stock_site is null
    or not exists(select 1 from public.material_stock where material_id=v_material and site_id=v_stock_site and organization_id=v_org)) then
    return jsonb_build_object('error','regional spares assessment requires an existing canonical material-stock site record'); end if;
  if exists(select 1 from unnest(v_features) x(id) left join public.geospatial_features f on f.id=x.id and f.organization_id=v_org and f.status='verified' where f.id is null) then return jsonb_build_object('error','all input features must be verified and belong to this organization'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence))) or exists(select 1 from unnest(v_evidence) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null or (v_asset is not null and e.asset_id is not null and e.asset_id<>v_asset)) then return jsonb_build_object('error','assessment evidence must be unique and belong to this organization and asset'); end if;
  insert into public.geospatial_operational_assessments(organization_id,assessment_type,title,asset_id,site_id,
    recommendation_id,linear_route_id,from_measure,to_measure,access_route_feature_id,crew_template_id,
    material_id,stock_site_id,input_feature_ids,evidence_item_ids,missing_evidence,observed_distance,
    distance_unit,observed_travel_minutes,exposure_rating,findings,basis,conclusion,recorded_by)
  values(v_org,p_assessment->>'assessment_type',trim(p_assessment->>'title'),v_asset,v_site,v_rec,v_route,
    nullif(p_assessment->>'from_measure','')::numeric,nullif(p_assessment->>'to_measure','')::numeric,
    v_access,v_crew,v_material,v_stock_site,v_features,v_evidence,v_missing,
    nullif(p_assessment->>'observed_distance','')::numeric,nullif(trim(coalesce(p_assessment->>'distance_unit','')),''),
    nullif(p_assessment->>'observed_travel_minutes','')::numeric,p_assessment->>'exposure_rating',
    coalesce(p_assessment->'findings','{}'::jsonb),trim(p_assessment->>'basis'),trim(p_assessment->>'conclusion'),auth.uid()) returning id into v_id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'geospatial_operational_assessment',v_role,jsonb_build_object('assessment_id',v_id,
      'type',p_assessment->>'assessment_type','status','draft','boundary','decision support only; no crew dispatch, route release, recommendation approval or work authorization'));
  return jsonb_build_object('assessment_id',v_id,'status','draft','note','Recorded for independent human verification; operational authority is unchanged.');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.verify_geospatial_operational_assessment(p_assessment_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); a public.geospatial_operational_assessments%rowtype;
begin
  if v_org is null or coalesce(v_role,'') not in ('reliability_engineer','maintenance_manager','planner','executive','admin') then return jsonb_build_object('error','independent verification requires a named same-tenant human role'); end if;
  select * into a from public.geospatial_operational_assessments where id=p_assessment_id and organization_id=v_org for update;
  if not found or a.status<>'draft' then return jsonb_build_object('error','draft geospatial assessment not found'); end if;
  if a.recorded_by=auth.uid() then return jsonb_build_object('error','the assessment author cannot independently verify the same assessment'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive verification method and conclusion'); end if;
  if cardinality(a.evidence_item_ids)=0 then return jsonb_build_object('error','verification requires canonical evidence; missing-evidence-only drafts remain draft'); end if;
  if exists(select 1 from unnest(a.evidence_item_ids) x(id) left join public.evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null or e.verification_status<>'verified') then return jsonb_build_object('error','all cited evidence must be independently verified'); end if;
  if exists(select 1 from unnest(a.input_feature_ids) x(id) left join public.geospatial_features f on f.id=x.id and f.organization_id=v_org where f.id is null or f.status<>'verified' or (f.valid_until is not null and f.valid_until<=now())) then return jsonb_build_object('error','all geospatial inputs must be verified and current'); end if;
  update public.geospatial_operational_assessments set status='verified',verified_by=auth.uid(),verified_at=now(),verification_note=trim(p_note) where id=a.id;
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
    values(v_org,'geospatial_assessment_verification',v_role,jsonb_build_object('assessment_id',a.id,'independent',true,
      'boundary','verification does not dispatch crews, approve routes or recommendations, or release work'));
  return jsonb_build_object('assessment_id',a.id,'status','verified');
end $$;

create or replace function public.get_geospatial_operational_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else jsonb_build_object(
    'feature_types',jsonb_build_array('site','asset','linear_route','access_route','hazard_zone','weather_cell','receptor','logistics_hub','spares_region','failure_cluster'),
    'assessment_types',jsonb_build_array('weather_hazard_exposure','access_route','crew_travel','remote_logistics','regional_spares','failure_clustering','hazard_overlay','linear_reference'),
    'features',coalesce((select jsonb_agg(to_jsonb(f) order by f.recorded_at desc) from public.geospatial_features f where f.organization_id=public.app_current_org() and f.status in ('draft','verified')),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.recorded_at desc) from public.geospatial_subject_links l where l.organization_id=public.app_current_org()),'[]'::jsonb),
    'assessments',coalesce((select jsonb_agg(to_jsonb(a) order by a.recorded_at desc) from public.geospatial_operational_assessments a where a.organization_id=public.app_current_org() and a.status in ('draft','verified') and (a.recommendation_id is null or exists(select 1 from public.recommendations r where r.id=a.recommendation_id and r.organization_id=a.organization_id and (r.risk_id is null or public.can_read_risk(r.risk_id))))),'[]'::jsonb),
    'regional_stock',coalesce((select jsonb_agg(jsonb_build_object('material_id',s.material_id,'material_code',m.material_code,'description',m.description,'site_id',s.site_id,'site_name',si.name,'qty_on_hand',s.qty_on_hand,'qty_reserved',s.qty_reserved,'qty_on_order',s.qty_on_order,'last_counted_at',s.last_counted_at,'source_system',s.source_system) order by m.material_code,si.name) from public.material_stock s join public.materials m on m.id=s.material_id and m.organization_id=s.organization_id left join public.sites si on si.id=s.site_id and si.organization_id=s.organization_id where s.organization_id=public.app_current_org()),'[]'::jsonb),
    'linear_routes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'asset_id',r.asset_id,'route_code',r.route_code,'measure_unit',r.measure_unit,'start_measure',r.start_measure,'end_measure',r.end_measure,'defect_count',(select count(*) from public.linear_defects d where d.organization_id=r.organization_id and d.route_id=r.id)) order by r.route_code) from public.linear_asset_routes r where r.organization_id=public.app_current_org()),'[]'::jsonb),
    'weather_signals',coalesce((select jsonb_agg(to_jsonb(s) order by s.observed_at desc) from public.operational_constraint_signals s where s.organization_id=public.app_current_org() and s.signal_kind='weather'),'[]'::jsonb),
    'basis','Verified, source-supplied geospatial evidence is decision context only. SyncAI does not infer coordinates, exposure, travel, stock availability or cluster significance and never dispatches crews, approves a route or recommendation, or releases work.'
  ) end $$;

revoke all on function public.record_geospatial_feature(jsonb) from public,anon;
revoke all on function public.verify_geospatial_feature(uuid,text) from public,anon;
revoke all on function public.link_geospatial_subject(jsonb) from public,anon;
revoke all on function public.record_geospatial_operational_assessment(jsonb) from public,anon;
revoke all on function public.verify_geospatial_operational_assessment(uuid,text) from public,anon;
revoke all on function public.get_geospatial_operational_workspace() from public,anon;
grant execute on function public.record_geospatial_feature(jsonb) to authenticated,service_role;
grant execute on function public.verify_geospatial_feature(uuid,text) to authenticated,service_role;
grant execute on function public.link_geospatial_subject(jsonb) to authenticated,service_role;
grant execute on function public.record_geospatial_operational_assessment(jsonb) to authenticated,service_role;
grant execute on function public.verify_geospatial_operational_assessment(uuid,text) to authenticated,service_role;
grant execute on function public.get_geospatial_operational_workspace() to authenticated,service_role;

notify pgrst,'reload schema';
comment on table public.geospatial_operational_assessments is
  'U10.01 evidence-backed geospatial decision context over canonical operational records; never dispatch or approval authority.';
