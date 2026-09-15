-- U15.01 — governed natural-hazard and climate exposure evaluation.
--
-- This extends the existing climate-resilience assessment family. Historical
-- concept_v1 assessments retain their eight-hazard contract; operational_v1
-- assessments use the exact thirteen-hazard enterprise taxonomy and connect
-- source evidence to five affected decision families. The records are advice
-- and evidence context only: no design, maintenance interval, stock position,
-- emergency plan, renewal decision, recommendation or work order is approved.

alter table public.climate_resilience_assessments
  alter column option_id drop not null,
  add column if not exists assessment_kind text not null default 'concept_v1'
    check (assessment_kind in ('concept_v1','operational_v1')),
  add column if not exists asset_id uuid references public.assets(id) on delete set null,
  add column if not exists site_id uuid references public.sites(id) on delete set null,
  add column if not exists risk_id uuid references public.risks(id) on delete set null,
  add column if not exists recommendation_id uuid references public.recommendations(id) on delete set null,
  add column if not exists source_as_of timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists evidence_item_ids uuid[] not null default '{}',
  add column if not exists geospatial_feature_ids uuid[] not null default '{}',
  add column if not exists missing_evidence text[] not null default '{}';

alter table public.climate_resilience_assessments
  add constraint climate_resilience_scope_kind check (
    (assessment_kind='concept_v1' and option_id is not null
      and asset_id is null and site_id is null)
    or
    (assessment_kind='operational_v1' and option_id is null
      and num_nonnulls(asset_id,site_id)>=1)
  ),
  add constraint climate_resilience_source_window check (
    (assessment_kind='concept_v1') or
    (source_as_of is not null and (valid_until is null or valid_until>source_as_of)
      and (cardinality(evidence_item_ids)>0 or cardinality(missing_evidence)>0))
  );

create unique index if not exists uq_climate_operational_draft_scope
  on public.climate_resilience_assessments(
    organization_id,
    coalesce(asset_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) where assessment_kind='operational_v1' and status='draft';

alter table public.climate_resilience_hazard_assessments
  drop constraint if exists climate_resilience_hazard_assessments_hazard_check;
alter table public.climate_resilience_hazard_assessments
  add constraint climate_resilience_hazard_assessments_hazard_check check (hazard in (
    -- Historical concept vocabulary.
    'extreme_temperature','wildfire','flood','precipitation','water_availability',
    'freeze_thaw','permafrost','storm_severity',
    -- U15.01 operational vocabulary.
    'heat','cold','wind','ice','drought','sea_level','seismic','landslide',
    'storm_surge','water_scarcity'
  )),
  add column if not exists exposure_statement text,
  add column if not exists decision_effects jsonb,
  add column if not exists geospatial_feature_ids uuid[] not null default '{}',
  add column if not exists missing_evidence text[] not null default '{}';

alter table public.climate_resilience_hazard_assessments
  add constraint climate_hazard_decision_effects_shape check (
    decision_effects is null or (
      jsonb_typeof(decision_effects)='object'
      and decision_effects ?& array['design','maintenance_interval','spares','emergency_plan','renewal']
      and jsonb_typeof(decision_effects->'design')='string'
      and jsonb_typeof(decision_effects->'maintenance_interval')='string'
      and jsonb_typeof(decision_effects->'spares')='string'
      and jsonb_typeof(decision_effects->'emergency_plan')='string'
      and jsonb_typeof(decision_effects->'renewal')='string'
      and length(trim(decision_effects->>'design'))>=10
      and length(trim(decision_effects->>'maintenance_interval'))>=10
      and length(trim(decision_effects->>'spares'))>=10
      and length(trim(decision_effects->>'emergency_plan'))>=10
      and length(trim(decision_effects->>'renewal'))>=10
    )
  );

-- Replace the original scope trigger so both versioned workflows share the
-- same governed table without weakening the historical option boundary.
create or replace function public.enforce_climate_assessment_scope()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.assessment_kind='concept_v1' then
    if not exists(select 1 from business_case_options
        where id=new.option_id and organization_id=new.organization_id) then
      raise exception 'concept climate assessment and option must belong to the same organization';
    end if;
  else
    if new.asset_id is not null and not exists(select 1 from assets
        where id=new.asset_id and organization_id=new.organization_id) then
      raise exception 'climate exposure and asset must belong to the same organization';
    end if;
    if new.site_id is not null and not exists(select 1 from sites
        where id=new.site_id and organization_id=new.organization_id) then
      raise exception 'climate exposure and site must belong to the same organization';
    end if;
    if new.risk_id is not null and not exists(select 1 from risks
        where id=new.risk_id and organization_id=new.organization_id) then
      raise exception 'climate exposure and risk must belong to the same organization';
    end if;
    if new.recommendation_id is not null and not exists(select 1 from recommendations
        where id=new.recommendation_id and organization_id=new.organization_id) then
      raise exception 'climate exposure and recommendation must belong to the same organization';
    end if;
    if exists(select 1 from unnest(new.evidence_item_ids) x(id)
      left join evidence_items e on e.id=x.id and e.organization_id=new.organization_id
      where e.id is null) then
      raise exception 'climate exposure evidence must belong to the same organization';
    end if;
    if exists(select 1 from unnest(new.geospatial_feature_ids) x(id)
      left join geospatial_features f on f.id=x.id and f.organization_id=new.organization_id
      where f.id is null) then
      raise exception 'climate exposure geospatial inputs must belong to the same organization';
    end if;
  end if;
  if tg_op='UPDATE' and old.status<>new.status
     and coalesce(current_setting('app.climate_review_write',true),'')<>'granted' then
    raise exception 'climate assessment status changes require the governed review function';
  end if;
  if tg_op='UPDATE' and old.status<>'draft'
     and coalesce(current_setting('app.climate_review_write',true),'')<>'granted' then
    raise exception 'reviewed or superseded climate assessments are immutable';
  end if;
  return new;
end $$;

create or replace function public.enforce_climate_hazard_scope()
returns trigger language plpgsql set search_path=public as $$
declare a public.climate_resilience_assessments%rowtype;
begin
  select * into a from climate_resilience_assessments
    where id=new.assessment_id and organization_id=new.organization_id and status='draft';
  if not found then
    raise exception 'climate hazard and a draft assessment must belong to the same organization';
  end if;
  if not exists(select 1 from evidence_items
      where id=new.evidence_item_id and organization_id=new.organization_id) then
    raise exception 'climate hazard and evidence must belong to the same organization';
  end if;
  if exists(select 1 from unnest(new.geospatial_feature_ids) x(id)
    left join geospatial_features f on f.id=x.id and f.organization_id=new.organization_id
    where f.id is null) then
    raise exception 'climate hazard geospatial inputs must belong to the same organization';
  end if;
  if a.assessment_kind='operational_v1' and (
    new.hazard not in ('heat','cold','flood','wildfire','wind','ice','drought','sea_level',
      'permafrost','seismic','landslide','storm_surge','water_scarcity')
    or coalesce(length(trim(new.exposure_statement)),0)<10
    or new.decision_effects is null) then
    raise exception 'operational climate hazards require the U15 taxonomy, exposure and all five decision effects';
  end if;
  return new;
end $$;

create or replace function public.create_climate_hazard_exposure(p_assessment jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid;
  v_asset uuid:=nullif(p_assessment->>'asset_id','')::uuid;
  v_site uuid:=nullif(p_assessment->>'site_id','')::uuid;
  v_risk uuid:=nullif(p_assessment->>'risk_id','')::uuid;
  v_recommendation uuid:=nullif(p_assessment->>'recommendation_id','')::uuid;
  v_evidence uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'evidence_item_ids','[]'))::uuid),'{}');
  v_features uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'geospatial_feature_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_assessment->'missing_evidence','[]'))),'{}');
  v_revision int;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','planner','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human engineering or governance role must create an exposure assessment'); end if;
  if num_nonnulls(v_asset,v_site)=0 then
    return jsonb_build_object('error','select at least one canonical asset or site'); end if;
  if coalesce(length(trim(p_assessment->>'assessment_ref')),0)<3
    or coalesce(length(trim(p_assessment->>'future_conditions_basis')),0)<20
    or nullif(p_assessment->>'source_as_of','') is null then
    return jsonb_build_object('error','assessment reference, source and horizon basis, and source observation time are required'); end if;
  if cardinality(v_evidence)=0 and cardinality(v_missing)=0 then
    return jsonb_build_object('error','cite canonical evidence or explicitly name missing evidence; SyncAI will not invent hazard exposure'); end if;
  if cardinality(v_evidence)<>cardinality(array(select distinct unnest(v_evidence)))
    or exists(select 1 from unnest(v_evidence) x(id) left join evidence_items e
      on e.id=x.id and e.organization_id=v_org where e.id is null) then
    return jsonb_build_object('error','evidence ids must be unique and belong to this organization'); end if;
  if cardinality(v_features)<>cardinality(array(select distinct unnest(v_features)))
    or exists(select 1 from unnest(v_features) x(id) left join geospatial_features f
      on f.id=x.id and f.organization_id=v_org where f.id is null) then
    return jsonb_build_object('error','geospatial feature ids must be unique and belong to this organization'); end if;
  if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then
    return jsonb_build_object('error','asset not found in this organization'); end if;
  if v_site is not null and not exists(select 1 from sites where id=v_site and organization_id=v_org) then
    return jsonb_build_object('error','site not found in this organization'); end if;
  if v_risk is not null and not exists(select 1 from risks where id=v_risk and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  if v_recommendation is not null and not exists(select 1 from recommendations where id=v_recommendation and organization_id=v_org) then
    return jsonb_build_object('error','recommendation not found in this organization'); end if;
  if exists(select 1 from climate_resilience_assessments where organization_id=v_org
    and assessment_kind='operational_v1' and status='draft'
    and asset_id is not distinct from v_asset and site_id is not distinct from v_site) then
    return jsonb_build_object('error','this asset/site scope already has a draft exposure assessment'); end if;
  select coalesce(max(revision),0)+1 into v_revision from climate_resilience_assessments
    where organization_id=v_org and assessment_kind='operational_v1'
      and asset_id is not distinct from v_asset and site_id is not distinct from v_site;
  insert into climate_resilience_assessments(organization_id,assessment_kind,asset_id,site_id,
    risk_id,recommendation_id,assessment_ref,revision,future_conditions_basis,source_as_of,
    valid_until,evidence_item_ids,geospatial_feature_ids,missing_evidence,created_by)
  values(v_org,'operational_v1',v_asset,v_site,v_risk,v_recommendation,
    trim(p_assessment->>'assessment_ref'),v_revision,trim(p_assessment->>'future_conditions_basis'),
    (p_assessment->>'source_as_of')::timestamptz,nullif(p_assessment->>'valid_until','')::timestamptz,
    v_evidence,v_features,v_missing,auth.uid()) returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data) values
    (v_org,'climate_hazard_exposure',v_role,jsonb_build_object('assessment_id',v_id,
      'action','drafted','asset_id',v_asset,'site_id',v_site,'revision',v_revision,
      'boundary','evidence context only; no design, interval, stock, emergency, renewal, recommendation or work approval'));
  return jsonb_build_object('assessment_id',v_id,'revision',v_revision,'status','draft');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.record_climate_hazard_exposure(p_assessment_id uuid,p_hazard jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  a public.climate_resilience_assessments%rowtype; v_id bigint;
  v_feature_ids uuid[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_hazard->'geospatial_feature_ids','[]'))::uuid),'{}');
  v_missing text[]:=coalesce(array(select jsonb_array_elements_text(coalesce(p_hazard->'missing_evidence','[]'))),'{}');
  v_evidence uuid:=nullif(p_hazard->>'evidence_item_id','')::uuid;
  v_effects jsonb:=p_hazard->'decision_effects';
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','planner','executive','admin') then
    return jsonb_build_object('error','a named same-tenant human engineering or governance role must record hazard exposure'); end if;
  select * into a from climate_resilience_assessments where id=p_assessment_id
    and organization_id=v_org and assessment_kind='operational_v1' for update;
  if not found or a.status<>'draft' then return jsonb_build_object('error','draft operational exposure assessment not found'); end if;
  if p_hazard->>'hazard' not in ('heat','cold','flood','wildfire','wind','ice','drought','sea_level',
      'permafrost','seismic','landslide','storm_surge','water_scarcity') then
    return jsonb_build_object('error','use one of the thirteen U15 natural-hazard types'); end if;
  if coalesce(length(trim(p_hazard->>'future_condition')),0)<10
    or coalesce(length(trim(p_hazard->>'exposure_statement')),0)<10
    or coalesce(length(trim(p_hazard->>'design_response')),0)<10
    or coalesce(length(trim(p_hazard->>'residual_gap')),0)<3 then
    return jsonb_build_object('error','future condition, exposure, response and residual gap must be stated without invented values'); end if;
  if jsonb_typeof(v_effects)<>'object' or not(v_effects ?& array['design','maintenance_interval','spares','emergency_plan','renewal'])
    or exists(select 1 from jsonb_each_text(v_effects) e where e.key in
      ('design','maintenance_interval','spares','emergency_plan','renewal') and length(trim(e.value))<10) then
    return jsonb_build_object('error','state substantive effects on design, maintenance interval, spares, emergency plan and renewal'); end if;
  if v_evidence is null or not exists(select 1 from evidence_items where id=v_evidence and organization_id=v_org) then
    return jsonb_build_object('error','canonical same-tenant evidence is required for each hazard'); end if;
  if cardinality(v_feature_ids)<>cardinality(array(select distinct unnest(v_feature_ids)))
    or exists(select 1 from unnest(v_feature_ids) x(id) left join geospatial_features f
      on f.id=x.id and f.organization_id=v_org where f.id is null) then
    return jsonb_build_object('error','geospatial feature ids must be unique and belong to this organization'); end if;
  insert into climate_resilience_hazard_assessments(organization_id,assessment_id,hazard,
    future_condition,exposure_statement,design_response,residual_gap,decision_effects,
    evidence_item_id,geospatial_feature_ids,missing_evidence,assessed_by)
  values(v_org,a.id,p_hazard->>'hazard',trim(p_hazard->>'future_condition'),
    trim(p_hazard->>'exposure_statement'),trim(p_hazard->>'design_response'),
    trim(p_hazard->>'residual_gap'),v_effects,v_evidence,v_feature_ids,v_missing,auth.uid())
  on conflict(assessment_id,hazard) do update set future_condition=excluded.future_condition,
    exposure_statement=excluded.exposure_statement,design_response=excluded.design_response,
    residual_gap=excluded.residual_gap,decision_effects=excluded.decision_effects,
    evidence_item_id=excluded.evidence_item_id,geospatial_feature_ids=excluded.geospatial_feature_ids,
    missing_evidence=excluded.missing_evidence,assessed_by=excluded.assessed_by,assessed_at=now()
  returning id into v_id;
  insert into audit_events(organization_id,entity_type,actor,event_data) values
    (v_org,'climate_hazard_exposure',v_role,jsonb_build_object('assessment_id',a.id,
      'hazard',p_hazard->>'hazard','action','recorded','evidence_item_id',v_evidence));
  return jsonb_build_object('id',v_id,'assessment_id',a.id,'hazard',p_hazard->>'hazard');
exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create or replace function public.review_climate_hazard_exposure(p_assessment_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role();
  a public.climate_resilience_assessments%rowtype; v_count int; v_unverified int;
begin
  if v_org is null or coalesce(v_role,'') not in
    ('reliability_engineer','maintenance_manager','executive','admin') then
    return jsonb_build_object('error','independent review requires a named same-tenant engineering or governance role'); end if;
  select * into a from climate_resilience_assessments where id=p_assessment_id
    and organization_id=v_org and assessment_kind='operational_v1' for update;
  if not found or a.status<>'draft' then return jsonb_build_object('error','draft operational exposure assessment not found'); end if;
  if a.created_by=auth.uid() then return jsonb_build_object('error','the assessment author cannot perform the independent review'); end if;
  if coalesce(length(trim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive independent review note'); end if;
  select count(*) into v_count from climate_resilience_hazard_assessments h
    where h.assessment_id=a.id and h.organization_id=v_org
      and h.hazard in ('heat','cold','flood','wildfire','wind','ice','drought','sea_level',
        'permafrost','seismic','landslide','storm_surge','water_scarcity')
      and h.decision_effects ?& array['design','maintenance_interval','spares','emergency_plan','renewal'];
  if v_count<>13 then return jsonb_build_object('error',format(
    'all thirteen hazards and five decision effects are required before review; %s of 13 are complete',v_count)); end if;
  select count(*) into v_unverified from (
    select unnest(a.evidence_item_ids) id union
    select h.evidence_item_id from climate_resilience_hazard_assessments h where h.assessment_id=a.id
  ) x left join evidence_items e on e.id=x.id and e.organization_id=v_org
  where e.id is null or e.verification_status<>'verified';
  if v_unverified>0 then return jsonb_build_object('error','independent review requires all cited canonical evidence to be verified'); end if;
  if a.valid_until is not null and a.valid_until<=now() then
    return jsonb_build_object('error','the assessment source validity has expired; refresh the evidence before review'); end if;
  if exists(select 1 from (
      select unnest(a.geospatial_feature_ids) id union
      select unnest(h.geospatial_feature_ids) from climate_resilience_hazard_assessments h where h.assessment_id=a.id
    ) x left join geospatial_features f on f.id=x.id and f.organization_id=v_org
    where f.id is null or f.status<>'verified' or (f.valid_until is not null and f.valid_until<=now())) then
    return jsonb_build_object('error','all cited geospatial inputs must be independently verified and current'); end if;
  perform set_config('app.climate_review_write','granted',true);
  update climate_resilience_assessments set status='superseded',superseded_at=now()
    where organization_id=v_org and assessment_kind='operational_v1' and status='reviewed'
      and asset_id is not distinct from a.asset_id and site_id is not distinct from a.site_id;
  update climate_resilience_assessments set status='reviewed',reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=trim(p_note) where id=a.id;
  insert into audit_events(organization_id,entity_type,actor,event_data) values
    (v_org,'climate_hazard_exposure_review',v_role,jsonb_build_object('assessment_id',a.id,
      'hazards',13,'decision_families',5,'independent',true,
      'boundary','review confirms evidence completeness only; human authorities retain every operational approval'));
  return jsonb_build_object('assessment_id',a.id,'status','reviewed','hazards',13,
    'decision_families',5,'decision_boundary','Evidence review only; no design, interval, stock, emergency, renewal, recommendation or work approval.');
end $$;

create or replace function public.get_climate_hazard_exposure_workspace()
returns jsonb language sql stable security definer set search_path=public as $$
select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else jsonb_build_object(
  'hazards',jsonb_build_array('heat','cold','flood','wildfire','wind','ice','drought','sea_level',
    'permafrost','seismic','landslide','storm_surge','water_scarcity'),
  'decision_families',jsonb_build_array('design','maintenance_interval','spares','emergency_plan','renewal'),
  'assessments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object(
      'hazards',coalesce((select jsonb_agg(to_jsonb(h) order by h.hazard)
        from climate_resilience_hazard_assessments h where h.assessment_id=a.id),'[]'::jsonb),
      'missing_hazards',(select coalesce(jsonb_agg(x.hazard),'[]'::jsonb) from unnest(array[
        'heat','cold','flood','wildfire','wind','ice','drought','sea_level','permafrost',
        'seismic','landslide','storm_surge','water_scarcity']) x(hazard) where not exists(
          select 1 from climate_resilience_hazard_assessments h where h.assessment_id=a.id and h.hazard=x.hazard))
    ) order by a.created_at desc) from climate_resilience_assessments a
    where a.organization_id=public.app_current_org() and a.assessment_kind='operational_v1'
      and (a.risk_id is null or public.can_read_risk(a.risk_id))),'[]'::jsonb),
  'basis','Thirteen-hazard exposure evidence informs design, maintenance intervals, spares, emergency planning and renewal. It never fabricates projections or approves an operational decision.'
) end $$;

revoke all on function public.create_climate_hazard_exposure(jsonb) from public,anon;
revoke all on function public.record_climate_hazard_exposure(uuid,jsonb) from public,anon;
revoke all on function public.review_climate_hazard_exposure(uuid,text) from public,anon;
revoke all on function public.get_climate_hazard_exposure_workspace() from public,anon;
grant execute on function public.create_climate_hazard_exposure(jsonb) to authenticated,service_role;
grant execute on function public.record_climate_hazard_exposure(uuid,jsonb) to authenticated,service_role;
grant execute on function public.review_climate_hazard_exposure(uuid,text) to authenticated,service_role;
grant execute on function public.get_climate_hazard_exposure_workspace() to authenticated,service_role;

comment on function public.get_climate_hazard_exposure_workspace() is
  'U15.01 versioned extension of canonical climate resilience: exact thirteen-hazard exposure and five decision-family evidence, without operational authority.';
notify pgrst,'reload schema';
