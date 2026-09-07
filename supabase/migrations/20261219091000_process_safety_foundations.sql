-- Controlled authoring for the existing E2.01–E2.03 safety foundation.
-- Reuses the canonical safety tables and audit_events ledger; no limits are
-- calculated or supplied by SyncAI.

create or replace function public.assert_safety_foundation_actor(p_action text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); v_role text;
begin
 if v_org is null or v_uid is null then raise exception '% requires an authenticated organization member',p_action using errcode='insufficient_privilege'; end if;
 select role into v_role from user_profiles where id=v_uid and organization_id=v_org;
 if coalesce(v_role,'')='ai_admin' then raise exception 'AI cannot %; a named human must make this process-safety assertion',p_action using errcode='insufficient_privilege'; end if;
 if coalesce(v_role,'') not in ('admin','executive','maintenance_manager','reliability_engineer') then raise exception '% requires accountable operations or engineering authority',p_action using errcode='insufficient_privilege'; end if;
 return v_uid;
end $$;

create or replace function public.record_safety_critical_element(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid:=nullif(p_record->>'asset_id','')::uuid; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record a safety-critical element');
 if length(btrim(coalesce(p_record->>'sce_ref','')))<2 or length(btrim(coalesce(p_record->>'label','')))<3 or nullif(p_record->>'barrier_kind','') is null or nullif(p_record->>'barrier_role','') is null or length(btrim(coalesce(p_record->>'performance_standard','')))<20 or v_basis is null or length(v_basis)<20 then raise exception 'reference, label, kind, role, testable performance standard and evidence basis are required'; end if;
 if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'asset is not in this organization'; end if;
 insert into safety_critical_elements(organization_id,asset_id,sce_ref,label,barrier_kind,barrier_role,performance_standard,test_interval_months,last_tested_on)
 values(v_org,v_asset,btrim(p_record->>'sce_ref'),btrim(p_record->>'label'),p_record->>'barrier_kind',p_record->>'barrier_role',btrim(p_record->>'performance_standard'),nullif(p_record->>'test_interval_months','')::int,nullif(p_record->>'last_tested_on','')::date) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'process_safety_sce',v_uid::text,jsonb_build_object('id',v_id,'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_major_hazard(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record a major hazard');
 if length(btrim(coalesce(p_record->>'hazard_ref','')))<2 or length(btrim(coalesce(p_record->>'title','')))<5 or length(btrim(coalesce(p_record->>'top_event','')))<5 or v_basis is null or length(v_basis)<20 then raise exception 'hazard reference, title, top event and evidence basis are required'; end if;
 insert into major_hazards(organization_id,site_id,hazard_ref,title,top_event,worst_credible_consequence,consequence_class) values(v_org,nullif(p_record->>'site_id','')::uuid,btrim(p_record->>'hazard_ref'),btrim(p_record->>'title'),btrim(p_record->>'top_event'),nullif(btrim(p_record->>'worst_credible_consequence'),''),nullif(p_record->>'consequence_class','')) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'process_safety_hazard',v_uid::text,jsonb_build_object('id',v_id,'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.link_hazard_barrier(p_hazard_id bigint,p_sce_id bigint,p_relation text,p_basis text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid;
begin
 v_uid:=assert_safety_foundation_actor('link a barrier to a hazard');
 if length(btrim(coalesce(p_relation,'')))<5 or length(btrim(coalesce(p_basis,'')))<20 then raise exception 'state the threat or consequence relationship and evidence basis'; end if;
 if not exists(select 1 from major_hazards where id=p_hazard_id and organization_id=v_org) or not exists(select 1 from safety_critical_elements where id=p_sce_id and organization_id=v_org) then raise exception 'hazard and barrier must belong to this organization'; end if;
 insert into hazard_barriers(hazard_id,sce_id,organization_id,threat_or_consequence) values(p_hazard_id,p_sce_id,v_org,btrim(p_relation)) on conflict(hazard_id,sce_id) do nothing;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'process_safety_hazard_barrier',v_uid::text,jsonb_build_object('hazardId',p_hazard_id,'sceId',p_sce_id,'action','linked','evidenceBasis',p_basis));
 return jsonb_build_object('status','linked');
end $$;

create or replace function public.record_integrity_window(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_asset uuid:=nullif(p_record->>'asset_id','')::uuid; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record an integrity operating window');
 if v_asset is null or not exists(select 1 from assets where id=v_asset and organization_id=v_org) then raise exception 'name an asset in this organization'; end if;
 if length(btrim(coalesce(p_record->>'parameter','')))<2 or length(btrim(coalesce(p_record->>'damage_mechanism','')))<10 or length(btrim(coalesce(p_record->>'consequence_of_exceedance','')))<10 or v_basis is null or length(v_basis)<20 then raise exception 'parameter, damage mechanism, consequence and evidence basis are required'; end if;
 if nullif(p_record->>'critical_low','') is null and nullif(p_record->>'critical_high','') is null then raise exception 'an integrity window must state at least one owner-approved critical limit'; end if;
 insert into integrity_windows(organization_id,asset_id,parameter,unit,standard_low,standard_high,critical_low,critical_high,damage_mechanism,consequence_of_exceedance) values(v_org,v_asset,btrim(p_record->>'parameter'),nullif(btrim(p_record->>'unit'),''),nullif(p_record->>'standard_low','')::numeric,nullif(p_record->>'standard_high','')::numeric,nullif(p_record->>'critical_low','')::numeric,nullif(p_record->>'critical_high','')::numeric,btrim(p_record->>'damage_mechanism'),btrim(p_record->>'consequence_of_exceedance')) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'process_safety_integrity_window',v_uid::text,jsonb_build_object('id',v_id,'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','recorded');
end $$;

create or replace function public.record_integrity_exceedance(p_record jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=app_current_org(); v_uid uuid; v_id bigint; v_window bigint:=nullif(p_record->>'window_id','')::bigint; v_basis text:=nullif(btrim(p_record->>'evidence_basis'),'');
begin
 v_uid:=assert_safety_foundation_actor('record an integrity-window exceedance');
 if v_window is null or not exists(select 1 from integrity_windows where id=v_window and organization_id=v_org) then raise exception 'name an integrity window in this organization'; end if;
 if nullif(p_record->>'occurred_at','') is null or nullif(p_record->>'severity','') not in ('standard','critical') or v_basis is null or length(v_basis)<20 then raise exception 'occurrence time, standard or critical severity, and evidence basis are required'; end if;
 insert into integrity_exceedances(organization_id,window_id,occurred_at,ended_at,peak_value,severity,acknowledged_by,engineering_assessed,assessment_note)
 values(v_org,v_window,(p_record->>'occurred_at')::timestamptz,nullif(p_record->>'ended_at','')::timestamptz,nullif(p_record->>'peak_value','')::numeric,p_record->>'severity',v_uid,false,null) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'process_safety_integrity_exceedance',v_uid::text,jsonb_build_object('id',v_id,'action','recorded','evidenceBasis',v_basis));
 return jsonb_build_object('id',v_id,'status','awaiting_engineering_assessment');
end $$;

revoke all on function public.assert_safety_foundation_actor(text) from public,anon;
revoke all on function public.record_safety_critical_element(jsonb) from public,anon;
revoke all on function public.record_major_hazard(jsonb) from public,anon;
revoke all on function public.link_hazard_barrier(bigint,bigint,text,text) from public,anon;
revoke all on function public.record_integrity_window(jsonb) from public,anon;
revoke all on function public.record_integrity_exceedance(jsonb) from public,anon;
grant execute on function public.record_safety_critical_element(jsonb),public.record_major_hazard(jsonb),public.link_hazard_barrier(bigint,bigint,text,text),public.record_integrity_window(jsonb),public.record_integrity_exceedance(jsonb) to authenticated;
notify pgrst,'reload schema';
