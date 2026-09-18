-- U9.01: complete the existing ISO 31000 consequence model. This migration
-- extends risk_consequences; it does not create a second risk or consequence
-- store. Assessments remain advisory and cannot accept risk or execute work.

alter table public.risk_consequences
  drop constraint if exists risk_consequences_dimension_check;

alter table public.risk_consequences
  add constraint risk_consequences_dimension_check check (dimension in (
    -- Legacy dimensions remain readable for prior assessments.
    'safety','environment','production','financial','regulatory','asset_integrity',
    'reputation','customer','cybersecurity',
    -- U9 decision-complete consequence dimensions.
    'fatality','injury','environmental_damage','customer_interruption',
    'vulnerable_populations','public_health','transportation_disruption',
    'community_trust','infrastructure_impact','political_regulatory'
  )),
  add column if not exists assessment_state text not null default 'unknown'
    check (assessment_state in ('known','estimated','predicted','unknown','conflicting')),
  add column if not exists magnitude_unit text,
  add column if not exists evidence_basis text,
  add column if not exists status text not null default 'draft'
    check (status in ('draft','verified','superseded')),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text;

alter table public.risk_consequences
  add constraint risk_consequences_magnitude_unit_pair check (
    (magnitude is null and magnitude_unit is null) or
    (magnitude is not null and nullif(btrim(magnitude_unit),'') is not null)
  ) not valid,
  add constraint risk_consequences_unknown_has_no_magnitude check (
    assessment_state <> 'unknown' or magnitude is null
  ) not valid,
  add constraint risk_consequences_verification_shape check (
    (status in ('draft','superseded') and verified_by is null and verified_at is null and verification_note is null) or
    (status = 'verified' and verified_by is not null and verified_at is not null
      and length(btrim(verification_note)) >= 20) or
    (status = 'superseded' and verified_by is not null and verified_at is not null
      and length(btrim(verification_note)) >= 20)
  );

comment on column public.risk_consequences.assessment_state is
  'Epistemic state of this consequence statement; never inferred from missing data.';
comment on column public.risk_consequences.magnitude is
  'Optional source magnitude. Magnitude and magnitude unit must be supplied together; no cross-dimension score is implied.';

create or replace function public.record_risk_analysis_element(
  p_risk_id uuid,p_kind text,p_element jsonb
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=app_current_org();
  v_id uuid;
  v_role text;
  v_evidence uuid:=nullif(p_element->>'evidence_item_id','')::uuid;
  v_state text:=p_element->>'assessment_state';
  v_magnitude numeric:=nullif(p_element->>'magnitude','')::numeric;
  v_unit text:=nullif(btrim(p_element->>'magnitude_unit'),'');
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','executive','maintenance_manager','reliability_engineer') then
    return jsonb_build_object('error','named human risk author role required');
  end if;
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  -- Serialize current-dimension replacement without inventing a parallel queue.
  perform 1 from risks where id=p_risk_id and organization_id=v_org for update;
  if v_evidence is not null and not exists(
    select 1 from evidence_items where id=v_evidence and organization_id=v_org
  ) then return jsonb_build_object('error','evidence not found in this organization'); end if;

  if p_kind='source' then
    if coalesce(length(btrim(p_element->>'description')),0)<5 or
       coalesce(length(btrim(p_element->>'source_type')),0)<2 or
       p_element->>'controllability' not in ('controllable','influenceable','external','unknown') then
      return jsonb_build_object('error','source description, type and controllability are required'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_element->'related_asset_ids','[]'::jsonb)) x
      left join assets a on a.id=x.value::uuid and a.organization_id=v_org where a.id is null) then
      return jsonb_build_object('error','one or more related assets are outside this organization'); end if;
    insert into risk_sources(organization_id,risk_id,description,source_type,controllability,
      related_asset_ids,related_processes,evidence_item_id)
    values(v_org,p_risk_id,btrim(p_element->>'description'),btrim(p_element->>'source_type'),
      p_element->>'controllability',coalesce(p_element->'related_asset_ids','[]'::jsonb),
      coalesce(p_element->'related_processes','[]'::jsonb),v_evidence) returning id into v_id;
  elsif p_kind='consequence' then
    if p_element->>'dimension' not in (
      'fatality','injury','environmental_damage','customer_interruption',
      'vulnerable_populations','public_health','transportation_disruption',
      'community_trust','infrastructure_impact','reputation','political_regulatory'
    ) or coalesce(length(btrim(p_element->>'description')),0)<10 or
       p_element->>'effect_type' not in ('direct','indirect','cascading') or
       v_state not in ('known','estimated','predicted','unknown','conflicting') or
       coalesce(length(btrim(p_element->>'evidence_basis')),0)<20 then
      return jsonb_build_object('error','dimension, consequence, effect type, assessment state and substantive evidence basis are required');
    end if;
    if (v_magnitude is null) <> (v_unit is null) then
      return jsonb_build_object('error','magnitude and magnitude unit must be supplied together'); end if;
    if v_state='unknown' and v_magnitude is not null then
      return jsonb_build_object('error','an unknown consequence cannot carry a magnitude'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_element->'affected_objective_ids','[]'::jsonb)) x
      left join risk_objectives o on o.id=x.value::uuid and o.organization_id=v_org where o.id is null) then
      return jsonb_build_object('error','one or more affected objectives are outside this organization'); end if;

    update risk_consequences set status='superseded'
      where organization_id=v_org and risk_id=p_risk_id
        and dimension=p_element->>'dimension' and status in ('draft','verified');
    insert into risk_consequences(
      organization_id,risk_id,dimension,description,magnitude,magnitude_unit,time_horizon,
      effect_type,affected_objective_ids,evidence_item_id,assessment_state,evidence_basis,
      status,created_by
    ) values(
      v_org,p_risk_id,p_element->>'dimension',btrim(p_element->>'description'),
      v_magnitude,v_unit,nullif(btrim(p_element->>'time_horizon'),''),p_element->>'effect_type',
      coalesce(p_element->'affected_objective_ids','[]'::jsonb),v_evidence,v_state,
      btrim(p_element->>'evidence_basis'),'draft',auth.uid()
    ) returning id into v_id;
  else return jsonb_build_object('error','analysis element kind must be source or consequence');
  end if;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_analysis_element',v_role,
    jsonb_build_object('risk_id',p_risk_id,'kind',p_kind,'element_id',v_id,'advisory_only',true));
  return jsonb_build_object('element_id',v_id,'kind',p_kind,'status',case when p_kind='consequence' then 'draft' else null end);
end;
$$;

create or replace function public.verify_risk_consequence(
  p_consequence_id uuid,p_decision text,p_note text
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_role text; v_author uuid; v_status text;
begin
  select role into v_role from user_profiles where id=auth.uid() and organization_id=v_org;
  if v_role not in ('admin','executive','reliability_engineer') then
    return jsonb_build_object('error','independent consequence reviewer role required'); end if;
  if p_decision not in ('verified','superseded') or coalesce(length(btrim(p_note)),0)<20 then
    return jsonb_build_object('error','verified or superseded decision and substantive review note required'); end if;
  select created_by,status into v_author,v_status from risk_consequences
    where id=p_consequence_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','consequence not found in this organization'); end if;
  if v_status<>'draft' then return jsonb_build_object('error','only a draft consequence can be reviewed'); end if;
  if v_author=auth.uid() then
    return jsonb_build_object('error','the author cannot verify their own consequence assessment'); end if;
  update risk_consequences set status=p_decision,verified_by=case when p_decision='verified' then auth.uid() end,
    verified_at=case when p_decision='verified' then now() end,
    verification_note=case when p_decision='verified' then btrim(p_note) end
    where id=p_consequence_id and organization_id=v_org;
  insert into audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'risk_consequence_review',v_role,jsonb_build_object(
    'consequence_id',p_consequence_id,'decision',p_decision,'note',btrim(p_note),'advisory_only',true));
  return jsonb_build_object('consequence_id',p_consequence_id,'status',p_decision);
end;
$$;

create or replace function public.get_risk_consequence_model(p_risk_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_dimensions constant text[]:=array[
  'fatality','injury','environmental_damage','customer_interruption',
  'vulnerable_populations','public_health','transportation_disruption',
  'community_trust','infrastructure_impact','reputation','political_regulatory'];
  v_missing text[];
begin
  if not exists(select 1 from risks where id=p_risk_id and organization_id=v_org and can_read_risk(id)) then
    return jsonb_build_object('error','risk not found in this organization'); end if;
  select array_agg(d order by d) into v_missing from unnest(v_dimensions) d
    where not exists(select 1 from risk_consequences c where c.organization_id=v_org
      and c.risk_id=p_risk_id and c.dimension=d and c.status in ('draft','verified'));
  return jsonb_build_object(
    'risk_id',p_risk_id,'required_dimensions',to_jsonb(v_dimensions),
    'consequences',coalesce((select jsonb_agg(to_jsonb(c) order by array_position(v_dimensions,c.dimension))
      from risk_consequences c where c.organization_id=v_org and c.risk_id=p_risk_id
        and c.dimension=any(v_dimensions) and c.status in ('draft','verified')),'[]'::jsonb),
    'missing_dimensions',to_jsonb(coalesce(v_missing,array[]::text[])),
    'coverage_complete',coalesce(cardinality(v_missing),0)=0,
    'basis','Coverage reports recorded dimensions only. No aggregate consequence score is calculated and no risk is accepted.'
  );
end;
$$;

revoke all on function public.record_risk_analysis_element(uuid,text,jsonb) from public,anon;
revoke all on function public.verify_risk_consequence(uuid,text,text) from public,anon;
revoke all on function public.get_risk_consequence_model(uuid) from public,anon;
grant execute on function public.record_risk_analysis_element(uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.verify_risk_consequence(uuid,text,text) to authenticated,service_role;
grant execute on function public.get_risk_consequence_model(uuid) to authenticated,service_role;
