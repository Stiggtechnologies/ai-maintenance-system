-- U5.05 — make the existing Buildings & Infrastructure pack operational.
-- Extends the one domain-specialist registry used by the Risk workspace. The
-- service still recalculates every result; browsers cannot persist a result.

create or replace function public.domain_specialist_method_is_registered(
  p_module_key text,
  p_method_key text
) returns boolean language sql immutable security invoker set search_path=public as $$
  select (p_module_key,p_method_key) in (
    values
    ('oil-sands-tailings','tailings-geotechnical'),
    ('oil-gas-well-integrity','well-integrity'),
    ('petrochemical-rbi','rbi-corrosion-loop'),
    ('utilities-storm-response','storm-crew-dispatch'),
    ('manufacturing-operations','line-balancing'),
    ('manufacturing-operations','robot-health'),
    ('food-beverage-safety','haccp-verification'),
    ('food-beverage-safety','cip-validation'),
    ('food-beverage-safety','cold-chain'),
    ('pharmaceutical-quality','gxp-validation'),
    ('pharmaceutical-quality','batch-record'),
    ('transport-logistics','route-depot-optimization'),
    ('transport-logistics','inspection-scheduling'),
    ('aviation-airworthiness','airworthiness-compliance'),
    ('aviation-airworthiness','msg3-trace'),
    ('aviation-airworthiness','life-limited-part'),
    ('marine-shipping','class-survey-scheduling'),
    ('marine-shipping','propulsion-efficiency'),
    ('marine-shipping','voyage-optimization'),
    ('data-center-thermal','thermal-airflow'),
    ('defense-readiness','mission-readiness'),
    ('defense-readiness','milspec-configuration'),
    ('defense-readiness','classified-deployment'),
    ('aerospace-launch','reuse-life'),
    ('aerospace-launch','range-safety'),
    ('aerospace-launch','propellant-degradation'),
    ('battery-energy-storage','battery-thermal-envelope'),
    ('battery-energy-storage','battery-hv-safety'),
    ('battery-energy-storage','battery-degradation'),
    ('battery-energy-storage','battery-fire-readiness'),
    ('buildings-infrastructure','code-compliance'),
    ('buildings-infrastructure','fire-life-safety'),
    ('buildings-infrastructure','occupancy-accessibility'),
    ('buildings-infrastructure','occupant-environment'),
    ('buildings-infrastructure','bas-control-integrity'),
    ('buildings-infrastructure','energy-water-performance'),
    ('buildings-infrastructure','facility-renewal-priority')
  )
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
    when 'battery-thermal-envelope' then array['approved-thermal-envelope','temperature-and-flow-history','instrument-calibration','thermal-control-test-records']
    when 'battery-hv-safety' then array['single-line-and-protection-design','isolation-and-protection-test-records','lockout-and-energized-work-procedures','approved-arc-flash-and-electrical-safety-basis']
    when 'battery-degradation' then array['controlled-battery-configuration','capacity-test-records','resistance-or-impedance-test-records','approved-service-criteria','duty-cycle-and-exposure-history']
    when 'battery-fire-readiness' then array['battery-fire-hazard-and-code-basis','detection-ventilation-suppression-test-records','barrier-and-impairment-register','emergency-response-plan-and-drill-evidence']
    when 'code-compliance' then array['jurisdiction-and-adopted-code-register','approved-design-documents','as-built-records','inspection-and-permit-records']
    when 'fire-life-safety' then array['fire-safety-plan','inspection-test-maintenance-records','impairment-permits','egress-and-occupant-basis','emergency-drill-or-validation']
    when 'occupancy-accessibility' then array['permit-register','final-inspection-records','accessibility-review','fire-and-life-safety-clearance','authority-certificate']
    when 'occupant-environment' then array['approved-indoor-environment-criteria','occupancy-schedule','bas-or-independent-trend-data','sensor-calibration']
    when 'bas-control-integrity' then array['approved-control-sequences','bas-point-and-trend-export','alarm-and-fail-safe-test-records','override-and-bypass-register']
    when 'energy-water-performance' then array['metered-energy-and-water-data','approved-normalized-baseline','weather-occupancy-and-service-drivers','meter-and-boundary-quality-review']
    when 'facility-renewal-priority' then array['approved-capital-priority-model','condition-and-deficiency-register','cost-estimate-basis','service-and-occupant-consequence-basis','energy-opportunity-basis']
    else null end
$$;

revoke all on function public.domain_specialist_method_is_registered(text,text) from public,anon;
grant execute on function public.domain_specialist_method_is_registered(text,text) to authenticated,service_role;
revoke all on function public.domain_specialist_required_evidence(text) from public,anon,authenticated;
grant execute on function public.domain_specialist_required_evidence(text) to service_role;

comment on function public.domain_specialist_method_is_registered(text,text) is
  'One server-side allowlist for governed domain methods. U5.05 adds occupied environment, BAS integrity, normalized resource performance and facility renewal priority; none authorize controls, compliance, occupancy or expenditure.';
