-- Customer-reachable E2.04 pressure-integrity authoring and calculation.
-- Extends canonical corrosion stores; all engineering limits remain owner supplied.

create or replace function public.record_corrosion_circuit(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record a corrosion circuit');
 if length(btrim(coalesce(p_record->>'circuit_ref','')))<2 or length(btrim(coalesce(p_record->>'description','')))<5 or length(btrim(coalesce(p_record->>'material','')))<2 or length(btrim(coalesce(p_record->>'service_fluid','')))<2 or length(btrim(coalesce(p_record->>'damage_mechanisms','')))<5 or v_basis is null or length(v_basis)<20 then raise exception 'reference, description, material, service, damage mechanisms and evidence basis are required'; end if;
 if nullif(p_record->>'minimum_thickness_mm','') is null then raise exception 'owner-approved minimum thickness is required; SyncAI does not invent it'; end if;
 insert into corrosion_circuits(organization_id,circuit_ref,description,material,service_fluid,damage_mechanisms,design_thickness_mm,minimum_thickness_mm)
 values(v_org,btrim(p_record->>'circuit_ref'),btrim(p_record->>'description'),btrim(p_record->>'material'),btrim(p_record->>'service_fluid'),btrim(p_record->>'damage_mechanisms'),nullif(p_record->>'design_thickness_mm','')::numeric,(p_record->>'minimum_thickness_mm')::numeric) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'pressure_integrity_circuit',v_uid::text,jsonb_build_object('id',v_id,'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_thickness_reading(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_circuit bigint:=nullif(p_record->>'circuit_id','')::bigint; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record a thickness reading');
 if v_circuit is null or not exists(select 1 from corrosion_circuits where id=v_circuit and organization_id=v_org) then raise exception 'name a corrosion circuit in this organization'; end if;
 if length(btrim(coalesce(p_record->>'cml_ref','')))<2 or nullif(p_record->>'measured_on','') is null or nullif(p_record->>'thickness_mm','')::numeric<=0 or length(btrim(coalesce(p_record->>'method','')))<2 or v_basis is null or length(v_basis)<20 then raise exception 'CML, measurement date, positive thickness, method and evidence basis are required'; end if;
 insert into thickness_readings(organization_id,circuit_id,cml_ref,measured_on,thickness_mm,method) values(v_org,v_circuit,btrim(p_record->>'cml_ref'),(p_record->>'measured_on')::date,(p_record->>'thickness_mm')::numeric,btrim(p_record->>'method')) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'pressure_integrity_reading',v_uid::text,jsonb_build_object('id',v_id,'circuitId',v_circuit,'cmlRef',btrim(p_record->>'cml_ref'),'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.assess_corrosion_circuit(p_circuit_id bigint,p_cml_ref text,p_inspection_fraction numeric)
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare v_org uuid:=app_current_org(); v_min numeric; v_current numeric; v_previous numeric; v_current_on date; v_previous_on date; v_years numeric; v_rate numeric; v_life numeric;
begin
 if auth.uid() is null or v_org is null then raise exception 'authenticated organization membership is required' using errcode='insufficient_privilege'; end if;
 if p_inspection_fraction is null or p_inspection_fraction<=0 or p_inspection_fraction>1 then raise exception 'approved inspection fraction must be greater than zero and no greater than one'; end if;
 select minimum_thickness_mm into v_min from corrosion_circuits where id=p_circuit_id and organization_id=v_org;
 if not found then raise exception 'corrosion circuit not found'; end if;
 if v_min is null then raise exception 'owner-approved minimum thickness is missing; assessment is blocked'; end if;
 select thickness_mm,measured_on into v_current,v_current_on from thickness_readings where circuit_id=p_circuit_id and organization_id=v_org and cml_ref=p_cml_ref order by measured_on desc,id desc limit 1;
 select thickness_mm,measured_on into v_previous,v_previous_on from thickness_readings where circuit_id=p_circuit_id and organization_id=v_org and cml_ref=p_cml_ref and measured_on<v_current_on order by measured_on desc,id desc limit 1;
 if v_previous is null then raise exception 'two readings on different dates are required for this CML'; end if;
 v_years:=(v_current_on-v_previous_on)/365.25; v_rate:=(v_previous-v_current)/v_years;
 if v_current<=v_min then return jsonb_build_object('status','at_or_below_minimum','currentThicknessMm',v_current,'minimumThicknessMm',v_min,'corrosionRateMmPerYear',round(v_rate,6),'remainingLifeYears',null,'candidateIntervalYears',null); end if;
 if v_rate<=0 then return jsonb_build_object('status','no_positive_metal_loss','currentThicknessMm',v_current,'minimumThicknessMm',v_min,'corrosionRateMmPerYear',round(v_rate,6),'remainingLifeYears',null,'candidateIntervalYears',null); end if;
 v_life:=(v_current-v_min)/v_rate;
 return jsonb_build_object('status','screened','currentThicknessMm',v_current,'minimumThicknessMm',v_min,'elapsedYears',round(v_years,6),'corrosionRateMmPerYear',round(v_rate,6),'remainingLifeYears',round(v_life,6),'candidateIntervalYears',round(v_life*p_inspection_fraction,6),'inspectionFraction',p_inspection_fraction);
end $$;

revoke all on function public.record_corrosion_circuit(jsonb) from public,anon;
revoke all on function public.record_thickness_reading(jsonb) from public,anon;
revoke all on function public.assess_corrosion_circuit(bigint,text,numeric) from public,anon;
grant execute on function public.record_corrosion_circuit(jsonb) to authenticated;
grant execute on function public.record_thickness_reading(jsonb) to authenticated;
grant execute on function public.assess_corrosion_circuit(bigint,text,numeric) to authenticated;
notify pgrst,'reload schema';
