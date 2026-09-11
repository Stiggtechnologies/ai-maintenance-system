-- E1.05 — append the Battery & Energy Storage pack to the canonical relational
-- pack catalog. The original generated membership migration is deployed and
-- immutable; this delta adds only the new canonical pack and derives counts
-- from its membership rows.

insert into public.kpi_packs(pack_name,industry_code)
values('Battery & Energy Storage KPI Pack','battery_energy_storage')
on conflict(industry_code) where industry_code is not null
do update set pack_name=excluded.pack_name;

insert into public.industry_asset_libraries(library_name,industry_code)
values('Battery & Energy Storage Asset Library','battery_energy_storage')
on conflict(industry_code) where industry_code is not null
do update set library_name=excluded.library_name;

insert into public.industry_failure_mode_packs(pack_name,industry_code)
values('Battery & Energy Storage Failure Modes','battery_energy_storage')
on conflict(industry_code) where industry_code is not null
do update set pack_name=excluded.pack_name;

with items(item_key,label,category,ordinal) as (values
  ('available_energy_capacity','Available Energy Capacity','primary',0),
  ('available_power_capability','Available Power Capability','primary',1),
  ('battery_availability','Battery Availability','primary',2),
  ('thermal_excursion_events','Thermal Excursion Events','primary',3),
  ('high_voltage_protection_demand_and_failure','High-Voltage Protection Demand and Failure','primary',4),
  ('fire_safety_barrier_readiness','Fire-Safety Barrier Readiness','primary',5),
  ('state_of_health_evidence_coverage','State-of-Health Evidence Coverage','primary',6),
  ('cell_or_module_temperature_spread','Cell or Module Temperature Spread','secondary',7),
  ('cell_voltage_imbalance','Cell Voltage Imbalance','secondary',8),
  ('measured_capacity_retention','Measured Capacity Retention','secondary',9),
  ('measured_resistance_or_impedance_change','Measured Resistance or Impedance Change','secondary',10),
  ('cooling_system_availability','Cooling-System Availability','secondary',11),
  ('protective_trip_and_alarm_test_compliance','Protective Trip and Alarm Test Compliance','secondary',12),
  ('unresolved_battery_safety_actions','Unresolved Battery Safety Actions','secondary',13)
)
insert into public.kpi_pack_items(pack_id,item_key,label,category,ordinal,source_ref)
select p.id,i.item_key,i.label,i.category,i.ordinal,
  'src/lib/industry-template-packs.ts#battery_energy_storage'
from public.kpi_packs p cross join items i
where p.industry_code='battery_energy_storage'
on conflict(pack_id,item_key) do update set label=excluded.label,
  category=excluded.category,ordinal=excluded.ordinal,source_ref=excluded.source_ref;

with items(item_key,label,ordinal) as (values
  ('battery_cells_modules_racks_and_strings','Battery Cells, Modules, Racks, and Strings',0),
  ('battery_management_systems','Battery Management Systems',1),
  ('power_conversion_systems','Power Conversion Systems',2),
  ('thermal_management_systems','Thermal Management Systems',3),
  ('high_voltage_contactors_and_protection','High-Voltage Contactors and Protection',4),
  ('energy_management_and_supervisory_controls','Energy Management and Supervisory Controls',5),
  ('fire_detection_ventilation_and_suppression','Fire Detection, Ventilation, and Suppression',6),
  ('transformers_switchgear_and_grid_interconnection','Transformers, Switchgear, and Grid Interconnection',7)
)
insert into public.industry_asset_library_items(library_id,item_key,label,ordinal,source_ref)
select p.id,i.item_key,i.label,i.ordinal,
  'src/lib/industry-template-packs.ts#battery_energy_storage'
from public.industry_asset_libraries p cross join items i
where p.industry_code='battery_energy_storage'
on conflict(library_id,item_key) do update set label=excluded.label,
  ordinal=excluded.ordinal,source_ref=excluded.source_ref;

with items(item_key,label,ordinal) as (values
  ('cell_internal_short_external_short_overheating_and_thermal_propagation','Cell internal short, external short, overheating, and thermal propagation',0),
  ('capacity_loss_resistance_growth_lithium_plating_imbalance_or_chemistry_specific_degradation','Capacity loss, resistance growth, lithium plating, imbalance, or chemistry-specific degradation',1),
  ('bms_sensor_drift_estimation_error_communications_loss_firmware_or_configuration_defect','BMS sensor drift, estimation error, communications loss, firmware, or configuration defect',2),
  ('high_voltage_isolation_loss_contactor_weld_failure_ground_fault_arc_or_protection_miscoordination','High-voltage isolation loss, contactor weld/failure, ground fault, arc, or protection miscoordination',3),
  ('power_conversion_failure_harmonic_thermal_stress_or_loss_of_commanded_charge_discharge','Power-conversion failure, harmonic/thermal stress, or loss of commanded charge/discharge',4),
  ('cooling_heating_component_failure_leakage_blockage_fouling_or_non_uniform_thermal_control','Cooling/heating component failure, leakage, blockage, fouling, or non-uniform thermal control',5),
  ('fire_off_gas_detection_ventilation_suppression_containment_or_emergency_response_impairment','Fire/off-gas detection, ventilation, suppression, containment, or emergency-response impairment',6)
)
insert into public.failure_mode_pack_items(pack_id,item_key,label,ordinal,source_ref)
select p.id,i.item_key,i.label,i.ordinal,
  'src/lib/industry-template-packs.ts#battery_energy_storage'
from public.industry_failure_mode_packs p cross join items i
where p.industry_code='battery_energy_storage'
on conflict(pack_id,item_key) do update set label=excluded.label,
  ordinal=excluded.ordinal,source_ref=excluded.source_ref;

-- Remove only stale membership from this additive pack. Other packs remain
-- owned by the deployed canonical membership migration.
delete from public.kpi_pack_items i using public.kpi_packs p
where i.pack_id=p.id and p.industry_code='battery_energy_storage'
  and i.source_ref='src/lib/industry-template-packs.ts#battery_energy_storage'
  and i.item_key not in (
    'available_energy_capacity','available_power_capability','battery_availability',
    'thermal_excursion_events','high_voltage_protection_demand_and_failure',
    'fire_safety_barrier_readiness','state_of_health_evidence_coverage',
    'cell_or_module_temperature_spread','cell_voltage_imbalance',
    'measured_capacity_retention','measured_resistance_or_impedance_change',
    'cooling_system_availability','protective_trip_and_alarm_test_compliance',
    'unresolved_battery_safety_actions');

update public.kpi_packs p set kpi_count=(select count(*) from public.kpi_pack_items i where i.pack_id=p.id)
where p.industry_code='battery_energy_storage';
update public.industry_asset_libraries p set asset_class_count=(select count(*) from public.industry_asset_library_items i where i.library_id=p.id)
where p.industry_code='battery_energy_storage';
update public.industry_failure_mode_packs p set failure_mode_count=(select count(*) from public.failure_mode_pack_items i where i.pack_id=p.id)
where p.industry_code='battery_energy_storage';

-- Extend the existing specialist registry functions. They remain the only SQL
-- allowlist used by the service-role persistence path.
create or replace function public.domain_specialist_method_is_registered(p_module_key text,p_method_key text)
returns boolean language sql immutable security invoker set search_path=public as $$
  select (p_module_key,p_method_key) in (
    ('oil-sands-tailings','tailings-geotechnical'),('oil-gas-well-integrity','well-integrity'),
    ('petrochemical-rbi','rbi-corrosion-loop'),('utilities-storm-response','storm-crew-dispatch'),
    ('manufacturing-operations','line-balancing'),('manufacturing-operations','robot-health'),
    ('food-beverage-safety','haccp-verification'),('food-beverage-safety','cip-validation'),
    ('food-beverage-safety','cold-chain'),('pharmaceutical-quality','gxp-validation'),
    ('pharmaceutical-quality','batch-record'),('transport-logistics','route-depot-optimization'),
    ('transport-logistics','inspection-scheduling'),('aviation-airworthiness','airworthiness-compliance'),
    ('aviation-airworthiness','msg3-trace'),('aviation-airworthiness','life-limited-part'),
    ('marine-shipping','class-survey-scheduling'),('marine-shipping','propulsion-efficiency'),
    ('marine-shipping','voyage-optimization'),('data-center-thermal','thermal-airflow'),
    ('defense-readiness','mission-readiness'),('defense-readiness','milspec-configuration'),
    ('defense-readiness','classified-deployment'),('aerospace-launch','reuse-life'),
    ('aerospace-launch','range-safety'),('aerospace-launch','propellant-degradation'),
    ('buildings-infrastructure','code-compliance'),('buildings-infrastructure','fire-life-safety'),
    ('buildings-infrastructure','occupancy-accessibility'),
    ('battery-energy-storage','battery-thermal-envelope'),
    ('battery-energy-storage','battery-hv-safety'),
    ('battery-energy-storage','battery-degradation'),
    ('battery-energy-storage','battery-fire-readiness')
  )
$$;

create or replace function public.domain_specialist_reviewer_role(p_module_key text)
returns text language sql immutable security invoker set search_path=public as $$
  select case p_module_key
    when 'oil-sands-tailings' then 'domain_tailings_reviewer'
    when 'oil-gas-well-integrity' then 'domain_well_integrity_reviewer'
    when 'petrochemical-rbi' then 'domain_rbi_reviewer'
    when 'utilities-storm-response' then 'domain_storm_dispatch_reviewer'
    when 'manufacturing-operations' then 'domain_manufacturing_reviewer'
    when 'food-beverage-safety' then 'domain_food_safety_reviewer'
    when 'pharmaceutical-quality' then 'domain_pharmaceutical_quality_reviewer'
    when 'transport-logistics' then 'domain_transport_reviewer'
    when 'aviation-airworthiness' then 'domain_airworthiness_reviewer'
    when 'marine-shipping' then 'domain_marine_reviewer'
    when 'data-center-thermal' then 'domain_data_center_thermal_reviewer'
    when 'defense-readiness' then 'domain_defense_readiness_reviewer'
    when 'aerospace-launch' then 'domain_launch_reviewer'
    when 'buildings-infrastructure' then 'domain_building_safety_reviewer'
    when 'battery-energy-storage' then 'domain_battery_safety_reviewer'
    else null end
$$;

create or replace function public.domain_specialist_required_evidence(p_method_key text)
returns text[] language sql immutable security invoker set search_path=public as $$
  select case p_method_key
    when 'tailings-geotechnical' then array['geotechnical-model','survey-or-instrumentation','approved-criteria']
    when 'well-integrity' then array['well-schematic','barrier-verification','pressure-history','approved-operating-envelope']
    when 'rbi-corrosion-loop' then array['inspection-data','minimum-thickness-basis','damage-mechanism-review','approved-rbi-matrix']
    when 'storm-crew-dispatch' then array['incident-feed','crew-roster','competency-records','travel-time-source','dispatch-policy']
    when 'line-balancing' then array['time-study','demand-plan','precedence-definition']
    when 'robot-health' then array['robot-controller-history','condition-monitoring','maintenance-history','approved-signal-model']
    when 'haccp-verification' then array['approved-haccp-plan','monitoring-records','corrective-action-records','verification-records']
    when 'cip-validation' then array['validated-cip-recipe','cycle-historian','instrument-calibration','deviation-records']
    when 'cold-chain' then array['temperature-history','sensor-calibration','lot-traceability','approved-stability-or-shelf-life-basis']
    when 'gxp-validation' then array['validation-plan','requirements-specification','test-protocols-and-results','deviations','change-control']
    when 'batch-record' then array['master-batch-record','executed-batch-record','laboratory-results','deviation-and-oos-records']
    when 'route-depot-optimization' then array['orders-or-service-demand','depot-and-fleet-capacity','approved-route-cost-source','operating-constraints']
    when 'inspection-scheduling' then array['inspection-history','applicable-interval-register','fleet-status','qualified-inspector-capacity']
    when 'airworthiness-compliance' then array['current-airworthiness-publications','aircraft-configuration','technical-records','authorized-release-records']
    when 'msg3-trace' then array['approved-msg3-policy','configuration-baseline','decision-records','in-service-data']
    when 'life-limited-part' then array['authorized-component-records','back-to-birth-history','current-approved-life-limit','installation-configuration']
    when 'class-survey-scheduling' then array['class-status-report','credited-survey-history','approved-survey-cycle','docking-plan']
    when 'propulsion-efficiency' then array['fuel-or-energy-metering','distance-and-speed','draft-and-load','weather-current','approved-baseline-model']
    when 'voyage-optimization' then array['approved-route-options','weather-and-current-forecast','vessel-limitations','port-and-channel-constraints','charter-or-schedule-obligations']
    when 'thermal-airflow' then array['power-and-heat-load','airflow-measurement','thermal-sensors','cooling-topology','approved-envelopes']
    when 'mission-readiness' then array['approved-mission-requirements','configuration-status','maintenance-status','crew-qualification','supply-readiness']
    when 'milspec-configuration' then array['approved-configuration-baseline','as-maintained-configuration','deviations-and-waivers','obsolescence-and-substitution-records']
    when 'classified-deployment' then array['authorization-or-accreditation','system-security-plan','boundary-and-data-flow','offline-continuity-test','supply-chain-approval']
    when 'reuse-life' then array['as-flown-configuration','authenticated-mission-history','current-life-limits','inspection-and-refurbishment-records']
    when 'range-safety' then array['range-approved-requirements','trajectory-and-debris-analyses','flight-termination-system-status','weather-and-public-safety-constraints','launch-authorization-records']
    when 'propellant-degradation' then array['material-specification','sample-and-test-results','storage-history','handling-history','approved-degradation-model-or-limits']
    when 'code-compliance' then array['jurisdiction-and-adopted-code-register','approved-design-documents','as-built-records','inspection-and-permit-records']
    when 'fire-life-safety' then array['fire-safety-plan','inspection-test-maintenance-records','impairment-permits','egress-and-occupant-basis','emergency-drill-or-validation']
    when 'occupancy-accessibility' then array['permit-register','final-inspection-records','accessibility-review','fire-and-life-safety-clearance','authority-certificate']
    when 'battery-thermal-envelope' then array['approved-thermal-envelope','temperature-and-flow-history','instrument-calibration','thermal-control-test-records']
    when 'battery-hv-safety' then array['single-line-and-protection-design','isolation-and-protection-test-records','lockout-and-energized-work-procedures','approved-arc-flash-and-electrical-safety-basis']
    when 'battery-degradation' then array['controlled-battery-configuration','capacity-test-records','resistance-or-impedance-test-records','approved-service-criteria','duty-cycle-and-exposure-history']
    when 'battery-fire-readiness' then array['battery-fire-hazard-and-code-basis','detection-ventilation-suppression-test-records','barrier-and-impairment-register','emergency-response-plan-and-drill-evidence']
    else null end
$$;

create or replace function public.seed_domain_specialist_reviewer_roles()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.roles(organization_id,key,code,name,description,level)
  select new.id,d.key,d.key,d.name,
    'Authorizes independent review of non-authoritative SyncAI domain specialist runs only.',1
  from (values
    ('domain_tailings_reviewer','Tailings Geotechnical Reviewer'),
    ('domain_well_integrity_reviewer','Well Integrity Reviewer'),('domain_rbi_reviewer','RBI Reviewer'),
    ('domain_storm_dispatch_reviewer','Storm Dispatch Reviewer'),('domain_manufacturing_reviewer','Manufacturing Specialist Reviewer'),
    ('domain_food_safety_reviewer','Food Safety Reviewer'),('domain_pharmaceutical_quality_reviewer','Pharmaceutical Quality Reviewer'),
    ('domain_transport_reviewer','Transport Specialist Reviewer'),('domain_airworthiness_reviewer','Airworthiness Reviewer'),
    ('domain_marine_reviewer','Marine Specialist Reviewer'),('domain_data_center_thermal_reviewer','Data Center Thermal Reviewer'),
    ('domain_defense_readiness_reviewer','Defense Readiness Reviewer'),('domain_launch_reviewer','Aerospace and Launch Reviewer'),
    ('domain_building_safety_reviewer','Building Safety Reviewer'),('domain_battery_safety_reviewer','Battery Safety Reviewer')
  ) d(key,name)
  where not exists(select 1 from public.roles r where r.organization_id=new.id and r.key=d.key);
  return new;
end
$$;

insert into public.roles(organization_id,key,code,name,description,level)
select o.id,'domain_battery_safety_reviewer','domain_battery_safety_reviewer','Battery Safety Reviewer',
  'Authorizes independent review of non-authoritative SyncAI domain specialist runs only.',1
from public.organizations o
where not exists(select 1 from public.roles r where r.organization_id=o.id and r.key='domain_battery_safety_reviewer');

revoke all on function public.domain_specialist_method_is_registered(text,text) from public,anon;
grant execute on function public.domain_specialist_method_is_registered(text,text) to authenticated,service_role;
revoke all on function public.domain_specialist_reviewer_role(text) from public,anon,authenticated;
grant execute on function public.domain_specialist_reviewer_role(text) to service_role;
revoke all on function public.domain_specialist_required_evidence(text) from public,anon,authenticated;
grant execute on function public.domain_specialist_required_evidence(text) to service_role;
revoke all on function public.seed_domain_specialist_reviewer_roles() from public,anon,authenticated;

-- Extend the canonical ISO 31000 implementation provenance allowlist without
-- copying or weakening the governed RPC. Refuse if the known predecessor is
-- absent so a changed function cannot be patched silently.
do $migration$
declare
  v_signature regprocedure := 'public.start_iso31000_implementation(jsonb)'::regprocedure;
  v_definition text;
  v_before text :=
    'when ''buildings_infrastructure'' then v_expected_label := ''Buildings & Infrastructure''; v_expected_readiness := ''kernel_bound''; v_expected_focus_source := ''curated'';';
  v_after text := v_before || chr(10) ||
    '    when ''battery_energy_storage'' then v_expected_label := ''Battery & Energy Storage''; v_expected_readiness := ''kernel_bound'';';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if position('when ''battery_energy_storage'' then' in v_definition)>0 then return; end if;
  if position(v_before in v_definition)=0 then
    raise exception 'refusing battery catalog patch: expected kernel-bound Buildings predecessor is absent';
  end if;
  execute replace(v_definition,v_before,v_after);
end
$migration$;

revoke execute on function public.start_iso31000_implementation(jsonb) from public,anon;
grant execute on function public.start_iso31000_implementation(jsonb) to authenticated,service_role;

notify pgrst,'reload schema';
