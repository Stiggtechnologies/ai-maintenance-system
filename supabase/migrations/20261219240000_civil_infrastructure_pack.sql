-- U5.07 — append Civil Infrastructure to the canonical pack and governed
-- specialist registry. Results remain evidence-bound, non-authoritative drafts.

insert into public.kpi_packs(pack_name,industry_code) values('Civil Infrastructure KPI Pack','civil_infrastructure')
on conflict(industry_code) where industry_code is not null do update set pack_name=excluded.pack_name;
insert into public.industry_asset_libraries(library_name,industry_code) values('Civil Infrastructure Asset Library','civil_infrastructure')
on conflict(industry_code) where industry_code is not null do update set library_name=excluded.library_name;
insert into public.industry_failure_mode_packs(pack_name,industry_code) values('Civil Infrastructure Failure Modes','civil_infrastructure')
on conflict(industry_code) where industry_code is not null do update set pack_name=excluded.pack_name;

with items(item_key,label,category,ordinal) as (values
 ('critical_findings_open','Critical Findings Open','primary',0),('qualified_inspection_compliance','Qualified Inspection Compliance','primary',1),
 ('condition_rating_evidence_coverage','Condition Rating Evidence Coverage','primary',2),('load_rating_and_posting_currency','Load Rating and Posting Currency','primary',3),
 ('high_criticality_deficiency_backlog','High-Criticality Deficiency Backlog','primary',4),('geographic_hazard_assessment_coverage','Geographic Hazard Assessment Coverage','primary',5),
 ('mandatory_renewal_commitment_coverage','Mandatory Renewal Commitment Coverage','primary',6),('inspection_finding_closure_time','Inspection Finding Closure Time','secondary',7),
 ('deterioration_forecast_verification_error','Deterioration Forecast Verification Error','secondary',8),('repeat_defect_rate','Repeat Defect Rate','secondary',9),
 ('network_detour_or_service_consequence','Network Detour or Service Consequence','secondary',10),('renewal_estimate_evidence_completeness','Renewal Estimate Evidence Completeness','secondary',11),
 ('restriction_implementation_verification','Restriction Implementation Verification','secondary',12)
) insert into public.kpi_pack_items(pack_id,item_key,label,category,ordinal,source_ref)
select p.id,i.item_key,i.label,i.category,i.ordinal,'src/lib/industry-template-packs.ts#civil_infrastructure'
from public.kpi_packs p cross join items i where p.industry_code='civil_infrastructure'
on conflict(pack_id,item_key) do update set label=excluded.label,category=excluded.category,ordinal=excluded.ordinal,source_ref=excluded.source_ref;

with items(item_key,label,ordinal) as (values
 ('bridges_and_culverts','Bridges and Culverts',0),('tunnels_and_underground_structures','Tunnels and Underground Structures',1),
 ('roadways_and_pavements','Roadways and Pavements',2),('retaining_walls_and_slope_stabilization','Retaining Walls and Slope Stabilization',3),
 ('stormwater_and_drainage_infrastructure','Stormwater and Drainage Infrastructure',4),('dams_levees_and_flood_control_structures','Dams, Levees and Flood-Control Structures',5),
 ('transit_rail_and_pedestrian_structures','Transit, Rail and Pedestrian Structures',6),('foundations_embankments_and_geotechnical_works','Foundations, Embankments and Geotechnical Works',7)
) insert into public.industry_asset_library_items(library_id,item_key,label,ordinal,source_ref)
select p.id,i.item_key,i.label,i.ordinal,'src/lib/industry-template-packs.ts#civil_infrastructure'
from public.industry_asset_libraries p cross join items i where p.industry_code='civil_infrastructure'
on conflict(library_id,item_key) do update set label=excluded.label,ordinal=excluded.ordinal,source_ref=excluded.source_ref;

with items(item_key,label,ordinal) as (values
 ('deck_superstructure_substructure_or_connection_deterioration','Deck, superstructure, substructure or connection deterioration',0),
 ('fatigue_fracture_corrosion_delamination_or_material_loss','Fatigue, fracture, corrosion, delamination or material loss',1),
 ('scour_erosion_settlement_slope_movement_or_foundation_instability','Scour, erosion, settlement, slope movement or foundation instability',2),
 ('pavement_distress_rutting_cracking_and_loss_of_serviceability','Pavement distress, rutting, cracking and loss of serviceability',3),
 ('drainage_blockage_hydraulic_capacity_loss_and_flood_damage','Drainage blockage, hydraulic capacity loss and flood damage',4),
 ('tunnel_lining_ventilation_fire_life_safety_or_water_ingress_failure','Tunnel lining, ventilation, fire/life-safety or water-ingress failure',5),
 ('load_rating_invalidation_missing_posting_or_uncontrolled_restriction','Load-rating invalidation, missing posting or uncontrolled restriction',6)
) insert into public.failure_mode_pack_items(pack_id,item_key,label,ordinal,source_ref)
select p.id,i.item_key,i.label,i.ordinal,'src/lib/industry-template-packs.ts#civil_infrastructure'
from public.industry_failure_mode_packs p cross join items i where p.industry_code='civil_infrastructure'
on conflict(pack_id,item_key) do update set label=excluded.label,ordinal=excluded.ordinal,source_ref=excluded.source_ref;

update public.kpi_packs p set kpi_count=(select count(*) from public.kpi_pack_items i where i.pack_id=p.id) where p.industry_code='civil_infrastructure';
update public.industry_asset_libraries p set asset_class_count=(select count(*) from public.industry_asset_library_items i where i.library_id=p.id) where p.industry_code='civil_infrastructure';
update public.industry_failure_mode_packs p set failure_mode_count=(select count(*) from public.failure_mode_pack_items i where i.pack_id=p.id) where p.industry_code='civil_infrastructure';

create or replace function public.domain_specialist_method_is_registered(p_module_key text,p_method_key text)
returns boolean language sql immutable security invoker set search_path=public as $$ select (p_module_key,p_method_key) in (values
 ('oil-sands-tailings','tailings-geotechnical'),('oil-gas-well-integrity','well-integrity'),('petrochemical-rbi','rbi-corrosion-loop'),('utilities-storm-response','storm-crew-dispatch'),
 ('manufacturing-operations','line-balancing'),('manufacturing-operations','robot-health'),('food-beverage-safety','haccp-verification'),('food-beverage-safety','cip-validation'),('food-beverage-safety','cold-chain'),
 ('pharmaceutical-quality','gxp-validation'),('pharmaceutical-quality','batch-record'),('transport-logistics','route-depot-optimization'),('transport-logistics','inspection-scheduling'),
 ('aviation-airworthiness','airworthiness-compliance'),('aviation-airworthiness','msg3-trace'),('aviation-airworthiness','life-limited-part'),
 ('marine-shipping','class-survey-scheduling'),('marine-shipping','propulsion-efficiency'),('marine-shipping','voyage-optimization'),('data-center-thermal','thermal-airflow'),
 ('defense-readiness','mission-readiness'),('defense-readiness','milspec-configuration'),('defense-readiness','classified-deployment'),('aerospace-launch','reuse-life'),('aerospace-launch','range-safety'),('aerospace-launch','propellant-degradation'),
 ('battery-energy-storage','battery-thermal-envelope'),('battery-energy-storage','battery-hv-safety'),('battery-energy-storage','battery-degradation'),('battery-energy-storage','battery-fire-readiness'),
 ('buildings-infrastructure','code-compliance'),('buildings-infrastructure','fire-life-safety'),('buildings-infrastructure','occupancy-accessibility'),('buildings-infrastructure','occupant-environment'),('buildings-infrastructure','bas-control-integrity'),('buildings-infrastructure','energy-water-performance'),('buildings-infrastructure','facility-renewal-priority'),
 ('healthcare-clinical-engineering','clinical-criticality'),('healthcare-clinical-engineering','device-availability'),('healthcare-clinical-engineering','calibration-assurance'),('healthcare-clinical-engineering','infection-control-readiness'),('healthcare-clinical-engineering','patient-risk'),('healthcare-clinical-engineering','device-traceability'),
 ('civil-infrastructure','structural-condition'),('civil-infrastructure','inspection-rating'),('civil-infrastructure','deterioration-forecast'),('civil-infrastructure','load-restriction'),('civil-infrastructure','geographic-risk'),('civil-infrastructure','renewal-planning')) $$;

create or replace function public.domain_specialist_reviewer_role(p_module_key text)
returns text language sql immutable security invoker set search_path=public as $$ select case p_module_key
 when 'oil-sands-tailings' then 'domain_tailings_reviewer' when 'oil-gas-well-integrity' then 'domain_well_integrity_reviewer' when 'petrochemical-rbi' then 'domain_rbi_reviewer'
 when 'utilities-storm-response' then 'domain_storm_dispatch_reviewer' when 'manufacturing-operations' then 'domain_manufacturing_reviewer' when 'food-beverage-safety' then 'domain_food_safety_reviewer'
 when 'pharmaceutical-quality' then 'domain_pharmaceutical_quality_reviewer' when 'transport-logistics' then 'domain_transport_reviewer' when 'aviation-airworthiness' then 'domain_airworthiness_reviewer'
 when 'marine-shipping' then 'domain_marine_reviewer' when 'data-center-thermal' then 'domain_data_center_thermal_reviewer' when 'defense-readiness' then 'domain_defense_readiness_reviewer'
 when 'aerospace-launch' then 'domain_launch_reviewer' when 'battery-energy-storage' then 'domain_battery_safety_reviewer' when 'buildings-infrastructure' then 'domain_building_safety_reviewer'
 when 'healthcare-clinical-engineering' then 'domain_healthcare_clinical_engineering_reviewer' when 'civil-infrastructure' then 'domain_civil_infrastructure_reviewer' else null end $$;

create or replace function public.domain_specialist_required_evidence(p_method_key text)
returns text[] language sql immutable security invoker set search_path=public as $$ select case p_method_key
 when 'tailings-geotechnical' then array['geotechnical-model','survey-or-instrumentation','approved-criteria'] when 'well-integrity' then array['well-schematic','barrier-verification','pressure-history','approved-operating-envelope']
 when 'rbi-corrosion-loop' then array['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix'] when 'storm-crew-dispatch' then array['incident-feed','crew-roster','competency-records','travel-time-source','dispatch-policy']
 when 'line-balancing' then array['time-study','demand-plan','precedence-definition'] when 'robot-health' then array['robot-controller-history','condition-monitoring','maintenance-history','approved-signal-model']
 when 'haccp-verification' then array['approved-haccp-plan','monitoring-records','corrective-action-records','verification-records'] when 'cip-validation' then array['validated-cip-recipe','cycle-historian','instrument-calibration','deviation-records'] when 'cold-chain' then array['temperature-history','sensor-calibration','lot-traceability','approved-stability-or-shelf-life-basis']
 when 'gxp-validation' then array['validation-plan','requirements-specification','test-protocols-and-results','deviations','change-control'] when 'batch-record' then array['master-batch-record','executed-batch-record','laboratory-results','deviation-and-oos-records']
 when 'route-depot-optimization' then array['orders-or-service-demand','depot-and-fleet-capacity','approved-route-cost-source','operating-constraints'] when 'inspection-scheduling' then array['inspection-history','applicable-interval-register','fleet-status','qualified-inspector-capacity']
 when 'airworthiness-compliance' then array['current-airworthiness-publications','aircraft-configuration','technical-records','authorized-release-records'] when 'msg3-trace' then array['approved-msg3-policy','configuration-baseline','decision-records','in-service-data'] when 'life-limited-part' then array['authorized-component-records','back-to-birth-history','current-approved-life-limit','installation-configuration']
 when 'class-survey-scheduling' then array['class-status-report','credited-survey-history','approved-survey-cycle','docking-plan'] when 'propulsion-efficiency' then array['fuel-or-energy-metering','distance-and-speed','draft-and-load','weather-current','approved-baseline-model'] when 'voyage-optimization' then array['approved-route-options','weather-and-current-forecast','vessel-limitations','port-and-channel-constraints','charter-or-schedule-obligations']
 when 'thermal-airflow' then array['power-and-heat-load','airflow-measurement','thermal-sensors','cooling-topology','approved-envelopes'] when 'mission-readiness' then array['approved-mission-requirements','configuration-status','maintenance-status','crew-qualification','supply-readiness']
 when 'milspec-configuration' then array['approved-configuration-baseline','as-maintained-configuration','deviations-and-waivers','obsolescence-and-substitution-records'] when 'classified-deployment' then array['authorization-or-accreditation','system-security-plan','boundary-and-data-flow','offline-continuity-test','supply-chain-approval']
 when 'reuse-life' then array['as-flown-configuration','authenticated-mission-history','current-life-limits','inspection-and-refurbishment-records'] when 'range-safety' then array['range-approved-requirements','trajectory-and-debris-analyses','flight-termination-system-status','weather-and-public-safety-constraints','launch-authorization-records'] when 'propellant-degradation' then array['material-specification','sample-and-test-results','storage-history','handling-history','approved-degradation-model-or-limits']
 when 'battery-thermal-envelope' then array['approved-thermal-envelope','temperature-and-flow-history','instrument-calibration','thermal-control-test-records'] when 'battery-hv-safety' then array['single-line-and-protection-design','isolation-and-protection-test-records','lockout-and-energized-work-procedures','approved-arc-flash-and-electrical-safety-basis'] when 'battery-degradation' then array['controlled-battery-configuration','capacity-test-records','resistance-or-impedance-test-records','approved-service-criteria','duty-cycle-and-exposure-history'] when 'battery-fire-readiness' then array['battery-fire-hazard-and-code-basis','detection-ventilation-suppression-test-records','barrier-and-impairment-register','emergency-response-plan-and-drill-evidence']
 when 'code-compliance' then array['jurisdiction-and-adopted-code-register','approved-design-documents','as-built-records','inspection-and-permit-records'] when 'fire-life-safety' then array['fire-safety-plan','inspection-test-maintenance-records','impairment-permits','egress-and-occupant-basis','emergency-drill-or-validation'] when 'occupancy-accessibility' then array['permit-register','final-inspection-records','accessibility-review','fire-and-life-safety-clearance','authority-certificate']
 when 'occupant-environment' then array['approved-indoor-environment-criteria','occupancy-schedule','bas-or-independent-trend-data','sensor-calibration'] when 'bas-control-integrity' then array['approved-control-sequences','bas-point-and-trend-export','alarm-and-fail-safe-test-records','override-and-bypass-register'] when 'energy-water-performance' then array['metered-energy-and-water-data','approved-normalized-baseline','weather-occupancy-and-service-drivers','meter-and-boundary-quality-review'] when 'facility-renewal-priority' then array['approved-capital-priority-model','condition-and-deficiency-register','cost-estimate-basis','service-and-occupant-consequence-basis','energy-opportunity-basis']
 when 'clinical-criticality' then array['device-inventory','clinical-service-definition','approved-criticality-method','criticality-approval-record'] when 'device-availability' then array['device-population','availability-history','clinical-service-requirements','impairment-and-alternative-plan'] when 'calibration-assurance' then array['calibration-program','calibration-certificates','traceable-standards','approved-tolerances-and-dispositions'] when 'infection-control-readiness' then array['manufacturer-reprocessing-instructions','infection-prevention-approved-method','cycle-or-process-records','release-and-exception-records'] when 'patient-risk' then array['device-risk-file','incident-and-hazard-history','control-test-records','residual-risk-acceptance'] when 'device-traceability' then array['device-inventory','configuration-baseline','maintenance-and-calibration-history','recall-and-safety-action-register']
 when 'structural-condition' then array['asset-and-component-register','qualified-inspection-records','approved-condition-scale','defect-disposition-register']
 when 'inspection-rating' then array['inspection-program','approved-rating-scale','inspection-reports','critical-finding-follow-up']
 when 'deterioration-forecast' then array['condition-observation-history','approved-deterioration-model','model-calibration-record','applicability-and-uncertainty-basis']
 when 'load-restriction' then array['current-load-rating-analysis','controlled-asset-condition-and-configuration','applicable-legal-and-permit-load-basis','posting-and-restriction-records']
 when 'geographic-risk' then array['canonical-asset-geometries','approved-hazard-layers','layer-metadata-and-vintage','approved-overlay-method']
 when 'renewal-planning' then array['condition-and-critical-finding-register','approved-renewal-priority-model','cost-estimate-basis','network-service-and-community-consequence-basis','mandatory-obligation-register'] else null end $$;

create or replace function public.seed_domain_specialist_reviewer_roles()
returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.roles(organization_id,key,code,name,description,level)
 select new.id,d.key,d.key,d.name,'Authorizes independent review of non-authoritative SyncAI domain specialist runs only.',1 from (values
 ('domain_tailings_reviewer','Tailings Geotechnical Reviewer'),('domain_well_integrity_reviewer','Well Integrity Reviewer'),('domain_rbi_reviewer','RBI Reviewer'),('domain_storm_dispatch_reviewer','Storm Dispatch Reviewer'),('domain_manufacturing_reviewer','Manufacturing Specialist Reviewer'),('domain_food_safety_reviewer','Food Safety Reviewer'),('domain_pharmaceutical_quality_reviewer','Pharmaceutical Quality Reviewer'),('domain_transport_reviewer','Transport Specialist Reviewer'),('domain_airworthiness_reviewer','Airworthiness Reviewer'),('domain_marine_reviewer','Marine Specialist Reviewer'),('domain_data_center_thermal_reviewer','Data Center Thermal Reviewer'),('domain_defense_readiness_reviewer','Defense Readiness Reviewer'),('domain_launch_reviewer','Aerospace and Launch Reviewer'),('domain_building_safety_reviewer','Building Safety Reviewer'),('domain_battery_safety_reviewer','Battery Safety Reviewer'),('domain_healthcare_clinical_engineering_reviewer','Healthcare Clinical Engineering Reviewer'),('domain_civil_infrastructure_reviewer','Civil Infrastructure Reviewer')) d(key,name)
 where not exists(select 1 from public.roles r where r.organization_id=new.id and r.key=d.key); return new; end $$;

insert into public.roles(organization_id,key,code,name,description,level)
select o.id,'domain_civil_infrastructure_reviewer','domain_civil_infrastructure_reviewer','Civil Infrastructure Reviewer','Authorizes independent review of non-authoritative SyncAI civil infrastructure specialist runs only.',1 from public.organizations o
where not exists(select 1 from public.roles r where r.organization_id=o.id and r.key='domain_civil_infrastructure_reviewer');

do $migration$ declare v_signature regprocedure := 'public.start_iso31000_implementation(jsonb)'::regprocedure; v_definition text;
 v_before text := 'when ''healthcare'' then v_expected_label := ''Healthcare''; v_expected_readiness := ''kernel_bound'';';
 v_after text := v_before || chr(10) || '    when ''civil_infrastructure'' then v_expected_label := ''Civil Infrastructure''; v_expected_readiness := ''kernel_bound'';';
begin select pg_get_functiondef(v_signature) into v_definition; if position('when ''civil_infrastructure'' then' in v_definition)>0 then return; end if;
 if position(v_before in v_definition)=0 then raise exception 'refusing civil infrastructure catalog patch: expected Healthcare predecessor is absent'; end if;
 execute replace(v_definition,v_before,v_after); end; $migration$;

revoke all on function public.domain_specialist_method_is_registered(text,text) from public,anon;
grant execute on function public.domain_specialist_method_is_registered(text,text) to authenticated,service_role;
revoke all on function public.domain_specialist_reviewer_role(text) from public,anon,authenticated;
grant execute on function public.domain_specialist_reviewer_role(text) to service_role;
revoke all on function public.domain_specialist_required_evidence(text) from public,anon,authenticated;
grant execute on function public.domain_specialist_required_evidence(text) to service_role;
revoke all on function public.seed_domain_specialist_reviewer_roles() from public,anon,authenticated;
revoke execute on function public.start_iso31000_implementation(jsonb) from public,anon;
grant execute on function public.start_iso31000_implementation(jsonb) to authenticated,service_role;
comment on function public.domain_specialist_method_is_registered(text,text) is 'Canonical governed specialist allowlist. U5.07 adds civil infrastructure screens without safety certification, load/posting authority, closure/reopening authority or expenditure approval.';
notify pgrst,'reload schema';
