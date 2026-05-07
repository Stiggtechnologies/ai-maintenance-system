-- =====================================================================
-- 012: Industry Templates Expanded
-- =====================================================================
-- Extends 007_control_plane.sql by populating deployment_templates with
-- 13 asset-intensive industry verticals + rich template_config JSONB.
--
-- Three templates (oil-and-gas, data-centers, pharma) are fully fleshed
-- with realistic asset classes, failure modes, KPIs, integrations, and
-- compliance frameworks. The remaining 10 are scaffolded with valid
-- minimal config that the deploy-tenant Edge Function can act on.
--
-- Schema of template_config:
--   {
--     "asset_classes":      [ {code, name, iso55000_class, criticality_default} ],
--     "failure_modes":      [ {code, asset_class, name, fmea_severity, detection_method} ],
--     "kpis_kois":          [ {code, name, iso55000, unit, formula_hint} ],
--     "integrations":       [ {vendor, product, category, status} ],
--     "compliance":         [ "FRAMEWORK_CODE", ... ],
--     "agent_priorities":   [ {agent, weight} ],
--     "default_dashboards": [ "operational", "tactical", ... ],
--     "default_governance": "advisory|conditional|autonomous",
--     "oee_model":          "availability-performance-quality|infrastructure|custom",
--     "summary_metrics":    {kpi_count, asset_class_count, failure_mode_count}
--   }
-- =====================================================================

-- Add columns missing from 007 that templates need (idempotent)
ALTER TABLE deployment_templates
    ADD COLUMN IF NOT EXISTS slug TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS hero_summary TEXT,
    ADD COLUMN IF NOT EXISTS recommended_pricing_tier TEXT,
    ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployment_templates_slug ON deployment_templates(slug);
CREATE INDEX IF NOT EXISTS idx_deployment_templates_category ON deployment_templates(category);
CREATE INDEX IF NOT EXISTS idx_deployment_templates_active_sort ON deployment_templates(is_active, sort_order);

-- Backfill slug for existing 007 seed rows
UPDATE deployment_templates SET slug = code WHERE slug IS NULL;

-- =====================================================================
-- TEMPLATE 1: OIL & GAS  (fully fleshed reference)
-- =====================================================================
INSERT INTO deployment_templates (code, slug, name, industry, category, hero_summary, recommended_pricing_tier, sort_order, template_config)
VALUES (
  'oil_and_gas',
  'oil-and-gas',
  'Oil & Gas',
  'energy',
  'tier-1',
  'Upstream + downstream operations: rotating equipment risk scoring, mechanical integrity, PSM-aligned audit trails.',
  'enterprise',
  10,
  jsonb_build_object(
    'asset_classes', jsonb_build_array(
      jsonb_build_object('code','centrifugal_compressor','name','Centrifugal Compressor','iso55000_class','rotating','criticality_default','A'),
      jsonb_build_object('code','reciprocating_compressor','name','Reciprocating Compressor','iso55000_class','rotating','criticality_default','A'),
      jsonb_build_object('code','gas_turbine','name','Gas Turbine','iso55000_class','rotating','criticality_default','A'),
      jsonb_build_object('code','centrifugal_pump','name','Centrifugal Pump','iso55000_class','rotating','criticality_default','B'),
      jsonb_build_object('code','positive_displacement_pump','name','Positive Displacement Pump','iso55000_class','rotating','criticality_default','B'),
      jsonb_build_object('code','pressure_vessel','name','Pressure Vessel','iso55000_class','static','criticality_default','A'),
      jsonb_build_object('code','heat_exchanger','name','Heat Exchanger','iso55000_class','static','criticality_default','B'),
      jsonb_build_object('code','fired_heater','name','Fired Heater','iso55000_class','static','criticality_default','A'),
      jsonb_build_object('code','separator','name','Separator','iso55000_class','static','criticality_default','B'),
      jsonb_build_object('code','storage_tank','name','Storage Tank','iso55000_class','static','criticality_default','B'),
      jsonb_build_object('code','piping_system','name','Piping System','iso55000_class','static','criticality_default','B'),
      jsonb_build_object('code','control_valve','name','Control Valve','iso55000_class','instrumentation','criticality_default','C'),
      jsonb_build_object('code','relief_valve','name','Pressure Relief Valve','iso55000_class','instrumentation','criticality_default','A'),
      jsonb_build_object('code','wellhead','name','Wellhead Assembly','iso55000_class','wellsite','criticality_default','A'),
      jsonb_build_object('code','christmas_tree','name','Christmas Tree','iso55000_class','wellsite','criticality_default','A')
    ),
    'failure_modes', jsonb_build_array(
      jsonb_build_object('code','OG_FM_001','asset_class','centrifugal_compressor','name','Bearing degradation','fmea_severity',8,'detection_method','vibration_analysis'),
      jsonb_build_object('code','OG_FM_002','asset_class','centrifugal_compressor','name','Seal leakage','fmea_severity',7,'detection_method','gas_detection'),
      jsonb_build_object('code','OG_FM_003','asset_class','centrifugal_compressor','name','Surge / stall','fmea_severity',9,'detection_method','process_telemetry'),
      jsonb_build_object('code','OG_FM_010','asset_class','reciprocating_compressor','name','Valve failure','fmea_severity',7,'detection_method','ultrasonic_emissions'),
      jsonb_build_object('code','OG_FM_011','asset_class','reciprocating_compressor','name','Crosshead wear','fmea_severity',6,'detection_method','vibration_analysis'),
      jsonb_build_object('code','OG_FM_020','asset_class','gas_turbine','name','Hot gas path degradation','fmea_severity',9,'detection_method','borescope_inspection'),
      jsonb_build_object('code','OG_FM_021','asset_class','gas_turbine','name','Combustor cracking','fmea_severity',9,'detection_method','vibration_thermal'),
      jsonb_build_object('code','OG_FM_030','asset_class','centrifugal_pump','name','Cavitation','fmea_severity',6,'detection_method','vibration_acoustic'),
      jsonb_build_object('code','OG_FM_031','asset_class','centrifugal_pump','name','Mechanical seal failure','fmea_severity',7,'detection_method','leak_detection'),
      jsonb_build_object('code','OG_FM_040','asset_class','pressure_vessel','name','Corrosion under insulation (CUI)','fmea_severity',9,'detection_method','rbi_inspection'),
      jsonb_build_object('code','OG_FM_041','asset_class','pressure_vessel','name','Hydrogen-induced cracking','fmea_severity',10,'detection_method','rbi_inspection'),
      jsonb_build_object('code','OG_FM_050','asset_class','heat_exchanger','name','Tube fouling','fmea_severity',5,'detection_method','heat_transfer_analysis'),
      jsonb_build_object('code','OG_FM_051','asset_class','heat_exchanger','name','Tube leak','fmea_severity',8,'detection_method','process_telemetry'),
      jsonb_build_object('code','OG_FM_060','asset_class','fired_heater','name','Tube creep / rupture','fmea_severity',10,'detection_method','tube_metal_temp'),
      jsonb_build_object('code','OG_FM_070','asset_class','piping_system','name','External corrosion','fmea_severity',7,'detection_method','rbi_inspection'),
      jsonb_build_object('code','OG_FM_071','asset_class','piping_system','name','Internal erosion','fmea_severity',7,'detection_method','wall_thickness'),
      jsonb_build_object('code','OG_FM_080','asset_class','relief_valve','name','PSV pop pressure drift','fmea_severity',9,'detection_method','psv_test_program'),
      jsonb_build_object('code','OG_FM_090','asset_class','wellhead','name','Wellhead annulus pressure','fmea_severity',9,'detection_method','annulus_monitoring')
    ),
    'kpis_kois', jsonb_build_array(
      jsonb_build_object('code','MTBF','name','Mean Time Between Failures','iso55000',true,'unit','hours'),
      jsonb_build_object('code','MTTR','name','Mean Time To Repair','iso55000',true,'unit','hours'),
      jsonb_build_object('code','PM_COMPLIANCE','name','Preventive Maintenance Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','RBI_COMPLIANCE','name','Risk-Based Inspection Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','PSM_INCIDENTS','name','PSM Tier 1+2 Incidents','iso55000',true,'unit','count'),
      jsonb_build_object('code','UNPLANNED_DT','name','Unplanned Downtime','iso55000',true,'unit','hours'),
      jsonb_build_object('code','RCFA_CLOSURE','name','RCFA Closure Rate','iso55000',true,'unit','%'),
      jsonb_build_object('code','PSV_COMPLIANCE','name','PSV Test Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','BACKLOG_AGE','name','Work Order Backlog Age','iso55000',true,'unit','days'),
      jsonb_build_object('code','OEE','name','Overall Equipment Effectiveness','iso55000',true,'unit','%'),
      jsonb_build_object('code','HSE_TRIR','name','HSE Total Recordable Incident Rate','iso55000',true,'unit','rate')
    ),
    'integrations', jsonb_build_array(
      jsonb_build_object('vendor','SAP','product','SAP PM (S/4HANA)','category','erp_cmms','status','recommended'),
      jsonb_build_object('vendor','IBM','product','Maximo Application Suite','category','erp_cmms','status','recommended'),
      jsonb_build_object('vendor','AVEVA','product','PI System','category','historian','status','recommended'),
      jsonb_build_object('vendor','Honeywell','product','Experion PKS','category','dcs','status','supported'),
      jsonb_build_object('vendor','Emerson','product','DeltaV','category','dcs','status','supported'),
      jsonb_build_object('vendor','Bentley','product','AssetWise','category','reliability','status','supported'),
      jsonb_build_object('vendor','Hexagon','product','EAM','category','erp_cmms','status','supported'),
      jsonb_build_object('vendor','Anthropic','product','Claude API','category','ai','status','core'),
      jsonb_build_object('vendor','OpenAI','product','GPT API','category','ai','status','optional')
    ),
    'compliance', jsonb_build_array('API_580','API_581','API_510','API_570','OSHA_PSM_1910_119','ASME_B31_3','ASME_B31_8','ISO_55000','ISO_14224'),
    'agent_priorities', jsonb_build_array(
      jsonb_build_object('agent','reliability_engineering','weight',1.0),
      jsonb_build_object('agent','asset_management','weight',1.0),
      jsonb_build_object('agent','compliance_auditing','weight',0.95),
      jsonb_build_object('agent','condition_monitoring','weight',0.95),
      jsonb_build_object('agent','planning_scheduling','weight',0.85),
      jsonb_build_object('agent','work_order_management','weight',0.85),
      jsonb_build_object('agent','maintenance_strategy','weight',0.80),
      jsonb_build_object('agent','data_analytics','weight',0.75),
      jsonb_build_object('agent','quality_assurance','weight',0.70),
      jsonb_build_object('agent','financial_contract','weight',0.70),
      jsonb_build_object('agent','sustainability_esg','weight',0.65),
      jsonb_build_object('agent','inventory_management','weight',0.65),
      jsonb_build_object('agent','maintenance_operations','weight',0.60),
      jsonb_build_object('agent','continuous_improvement','weight',0.55),
      jsonb_build_object('agent','training_workforce','weight',0.50)
    ),
    'default_dashboards', jsonb_build_array('operational','tactical','strategic','compliance','executive','war_room'),
    'default_governance', 'conditional',
    'oee_model', 'availability-performance-quality',
    'summary_metrics', jsonb_build_object('kpi_count',11,'asset_class_count',15,'failure_mode_count',18)
  )
)
ON CONFLICT (code) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  industry = EXCLUDED.industry,
  category = EXCLUDED.category,
  hero_summary = EXCLUDED.hero_summary,
  recommended_pricing_tier = EXCLUDED.recommended_pricing_tier,
  sort_order = EXCLUDED.sort_order,
  template_config = EXCLUDED.template_config,
  updated_at = NOW();

-- =====================================================================
-- TEMPLATE 2: DATA CENTERS (fully fleshed reference)
-- =====================================================================
INSERT INTO deployment_templates (code, slug, name, industry, category, hero_summary, recommended_pricing_tier, sort_order, template_config)
VALUES (
  'data_centers',
  'data-centers',
  'Data Centers & Critical Digital Infrastructure',
  'digital_infrastructure',
  'tier-1',
  'Hyperscale + colocation: thermal-risk scoring, workload-aware PM, BMS+DCIM+CMMS unified intelligence layer.',
  'enterprise',
  20,
  jsonb_build_object(
    'asset_classes', jsonb_build_array(
      jsonb_build_object('code','chiller','name','Chiller','iso55000_class','cooling','criticality_default','A'),
      jsonb_build_object('code','crah_unit','name','CRAH Unit','iso55000_class','cooling','criticality_default','A'),
      jsonb_build_object('code','crac_unit','name','CRAC Unit','iso55000_class','cooling','criticality_default','A'),
      jsonb_build_object('code','cooling_tower','name','Cooling Tower','iso55000_class','cooling','criticality_default','A'),
      jsonb_build_object('code','dry_cooler','name','Dry Cooler','iso55000_class','cooling','criticality_default','B'),
      jsonb_build_object('code','liquid_cooling_cdu','name','Liquid Cooling Distribution Unit','iso55000_class','cooling','criticality_default','A'),
      jsonb_build_object('code','ups','name','Uninterruptible Power Supply','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','battery_string','name','Battery String','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','generator','name','Standby Generator','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','ats','name','Automatic Transfer Switch','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','transformer','name','Transformer','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','switchgear','name','Switchgear','iso55000_class','power','criticality_default','A'),
      jsonb_build_object('code','pdu','name','Power Distribution Unit','iso55000_class','power','criticality_default','B'),
      jsonb_build_object('code','rpp','name','Remote Power Panel','iso55000_class','power','criticality_default','B'),
      jsonb_build_object('code','busway','name','Busway','iso55000_class','power','criticality_default','B'),
      jsonb_build_object('code','rack','name','Server Rack','iso55000_class','it','criticality_default','C'),
      jsonb_build_object('code','network_switch','name','Network Switch','iso55000_class','network','criticality_default','B'),
      jsonb_build_object('code','fire_suppression','name','Fire Suppression System','iso55000_class','life_safety','criticality_default','A'),
      jsonb_build_object('code','bms_sensor','name','BMS Sensor','iso55000_class','controls','criticality_default','C')
    ),
    'failure_modes', jsonb_build_array(
      jsonb_build_object('code','DC_FM_001','asset_class','chiller','name','Compressor failure','fmea_severity',9,'detection_method','vibration_thermal'),
      jsonb_build_object('code','DC_FM_002','asset_class','chiller','name','Refrigerant leak','fmea_severity',7,'detection_method','refrigerant_sensor'),
      jsonb_build_object('code','DC_FM_003','asset_class','chiller','name','Approach temperature drift','fmea_severity',5,'detection_method','process_telemetry'),
      jsonb_build_object('code','DC_FM_010','asset_class','crah_unit','name','Fan motor failure','fmea_severity',7,'detection_method','vibration_current'),
      jsonb_build_object('code','DC_FM_011','asset_class','crah_unit','name','Filter loading','fmea_severity',4,'detection_method','dp_sensor'),
      jsonb_build_object('code','DC_FM_020','asset_class','cooling_tower','name','Fill degradation','fmea_severity',5,'detection_method','approach_temp_drift'),
      jsonb_build_object('code','DC_FM_021','asset_class','cooling_tower','name','Drift / legionella risk','fmea_severity',8,'detection_method','water_quality'),
      jsonb_build_object('code','DC_FM_030','asset_class','liquid_cooling_cdu','name','Coolant leak','fmea_severity',9,'detection_method','leak_detection'),
      jsonb_build_object('code','DC_FM_031','asset_class','liquid_cooling_cdu','name','Pump cavitation','fmea_severity',6,'detection_method','vibration_acoustic'),
      jsonb_build_object('code','DC_FM_040','asset_class','ups','name','Capacitor degradation','fmea_severity',7,'detection_method','impedance_test'),
      jsonb_build_object('code','DC_FM_041','asset_class','ups','name','Inverter failure','fmea_severity',9,'detection_method','telemetry_alarm'),
      jsonb_build_object('code','DC_FM_050','asset_class','battery_string','name','Cell impedance drift','fmea_severity',8,'detection_method','impedance_monitoring'),
      jsonb_build_object('code','DC_FM_051','asset_class','battery_string','name','Thermal runaway','fmea_severity',10,'detection_method','thermal_monitoring'),
      jsonb_build_object('code','DC_FM_060','asset_class','generator','name','Failure to start','fmea_severity',10,'detection_method','load_bank_test'),
      jsonb_build_object('code','DC_FM_061','asset_class','generator','name','Fuel polishing required','fmea_severity',6,'detection_method','fuel_quality'),
      jsonb_build_object('code','DC_FM_070','asset_class','transformer','name','Insulating oil degradation','fmea_severity',8,'detection_method','dga_analysis'),
      jsonb_build_object('code','DC_FM_080','asset_class','switchgear','name','Partial discharge','fmea_severity',9,'detection_method','pd_monitoring'),
      jsonb_build_object('code','DC_FM_090','asset_class','fire_suppression','name','Suppression agent loss','fmea_severity',9,'detection_method','weight_monitoring'),
      jsonb_build_object('code','DC_FM_100','asset_class','rack','name','Hot spot / thermal anomaly','fmea_severity',7,'detection_method','rack_temp_sensor')
    ),
    'kpis_kois', jsonb_build_array(
      jsonb_build_object('code','PUE','name','Power Usage Effectiveness','iso55000',true,'unit','ratio'),
      jsonb_build_object('code','WUE','name','Water Usage Effectiveness','iso55000',true,'unit','L/kWh'),
      jsonb_build_object('code','CUE','name','Carbon Usage Effectiveness','iso55000',true,'unit','kgCO2e/kWh'),
      jsonb_build_object('code','UPTIME','name','Facility Uptime','iso55000',true,'unit','%'),
      jsonb_build_object('code','SLA_BREACHES','name','SLA Breach Count','iso55000',true,'unit','count'),
      jsonb_build_object('code','THERMAL_EVENTS','name','Thermal Events','iso55000',true,'unit','count'),
      jsonb_build_object('code','MTBF_CRITICAL','name','MTBF on Critical Assets','iso55000',true,'unit','hours'),
      jsonb_build_object('code','MTTR','name','Mean Time To Repair','iso55000',true,'unit','hours'),
      jsonb_build_object('code','PM_COMPLIANCE','name','PM Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','GENERATOR_TEST_RATE','name','Generator Test Pass Rate','iso55000',true,'unit','%'),
      jsonb_build_object('code','UPS_RUNTIME','name','UPS Runtime At Load','iso55000',true,'unit','minutes'),
      jsonb_build_object('code','BATTERY_HEALTH','name','Battery String Health Index','iso55000',true,'unit','%')
    ),
    'integrations', jsonb_build_array(
      jsonb_build_object('vendor','IBM','product','Maximo Application Suite','category','erp_cmms','status','recommended'),
      jsonb_build_object('vendor','ServiceNow','product','ITOM','category','itsm','status','recommended'),
      jsonb_build_object('vendor','Schneider','product','EcoStruxure IT','category','dcim','status','recommended'),
      jsonb_build_object('vendor','Vertiv','product','Trellis','category','dcim','status','supported'),
      jsonb_build_object('vendor','Sunbird','product','dcTrack','category','dcim','status','supported'),
      jsonb_build_object('vendor','Nlyte','product','Nlyte DCIM','category','dcim','status','supported'),
      jsonb_build_object('vendor','Eaton','product','Brightlayer','category','power_monitoring','status','supported'),
      jsonb_build_object('vendor','Honeywell','product','Building Management','category','bms','status','recommended'),
      jsonb_build_object('vendor','Siemens','product','Desigo CC','category','bms','status','supported'),
      jsonb_build_object('vendor','Anthropic','product','Claude API','category','ai','status','core')
    ),
    'compliance', jsonb_build_array('UPTIME_TIER_III','UPTIME_TIER_IV','TIA_942','ASHRAE_TC_9_9','ISO_50001','ISO_27001','NFPA_75','NFPA_76','SOC_2'),
    'agent_priorities', jsonb_build_array(
      jsonb_build_object('agent','condition_monitoring','weight',1.0),
      jsonb_build_object('agent','reliability_engineering','weight',1.0),
      jsonb_build_object('agent','asset_management','weight',0.95),
      jsonb_build_object('agent','planning_scheduling','weight',0.95),
      jsonb_build_object('agent','sustainability_esg','weight',0.90),
      jsonb_build_object('agent','compliance_auditing','weight',0.85),
      jsonb_build_object('agent','data_analytics','weight',0.85),
      jsonb_build_object('agent','work_order_management','weight',0.80),
      jsonb_build_object('agent','maintenance_strategy','weight',0.75),
      jsonb_build_object('agent','quality_assurance','weight',0.70),
      jsonb_build_object('agent','inventory_management','weight',0.65),
      jsonb_build_object('agent','financial_contract','weight',0.65),
      jsonb_build_object('agent','maintenance_operations','weight',0.60),
      jsonb_build_object('agent','continuous_improvement','weight',0.55),
      jsonb_build_object('agent','training_workforce','weight',0.50)
    ),
    'default_dashboards', jsonb_build_array('operational','thermal','power_quality','sla','sustainability','executive','war_room'),
    'default_governance', 'conditional',
    'oee_model', 'infrastructure',
    'summary_metrics', jsonb_build_object('kpi_count',12,'asset_class_count',19,'failure_mode_count',19)
  )
)
ON CONFLICT (code) DO UPDATE SET
  slug = EXCLUDED.slug, name = EXCLUDED.name, industry = EXCLUDED.industry, category = EXCLUDED.category,
  hero_summary = EXCLUDED.hero_summary, recommended_pricing_tier = EXCLUDED.recommended_pricing_tier,
  sort_order = EXCLUDED.sort_order, template_config = EXCLUDED.template_config, updated_at = NOW();

-- =====================================================================
-- TEMPLATE 3: PHARMACEUTICALS & LIFE SCIENCES  (fully fleshed reference)
-- =====================================================================
INSERT INTO deployment_templates (code, slug, name, industry, category, hero_summary, recommended_pricing_tier, sort_order, template_config)
VALUES (
  'pharmaceuticals',
  'pharmaceuticals',
  'Pharmaceuticals & Life Sciences',
  'life_sciences',
  'tier-1',
  'GMP-critical equipment qualification, calibration drift detection, regulator-ready audit trails (FDA 21 CFR Part 11).',
  'enterprise',
  30,
  jsonb_build_object(
    'asset_classes', jsonb_build_array(
      jsonb_build_object('code','bioreactor','name','Bioreactor','iso55000_class','process','criticality_default','A'),
      jsonb_build_object('code','autoclave','name','Autoclave','iso55000_class','process','criticality_default','A'),
      jsonb_build_object('code','lyophilizer','name','Lyophilizer','iso55000_class','process','criticality_default','A'),
      jsonb_build_object('code','filling_line','name','Filling Line','iso55000_class','process','criticality_default','A'),
      jsonb_build_object('code','tablet_press','name','Tablet Press','iso55000_class','process','criticality_default','B'),
      jsonb_build_object('code','blister_packer','name','Blister Packer','iso55000_class','process','criticality_default','B'),
      jsonb_build_object('code','hvac_cleanroom','name','Cleanroom HVAC','iso55000_class','utilities','criticality_default','A'),
      jsonb_build_object('code','wfi_system','name','Water for Injection System','iso55000_class','utilities','criticality_default','A'),
      jsonb_build_object('code','clean_steam','name','Clean Steam Generator','iso55000_class','utilities','criticality_default','A'),
      jsonb_build_object('code','compressed_air','name','Pharma Compressed Air','iso55000_class','utilities','criticality_default','A'),
      jsonb_build_object('code','glove_box','name','Isolator / Glove Box','iso55000_class','process','criticality_default','A'),
      jsonb_build_object('code','particle_counter','name','Particle Counter','iso55000_class','quality_instrument','criticality_default','B'),
      jsonb_build_object('code','tank_jacketed','name','Jacketed Process Tank','iso55000_class','process','criticality_default','B')
    ),
    'failure_modes', jsonb_build_array(
      jsonb_build_object('code','PH_FM_001','asset_class','bioreactor','name','Sterility breach','fmea_severity',10,'detection_method','particle_micro'),
      jsonb_build_object('code','PH_FM_002','asset_class','bioreactor','name','Agitator seal failure','fmea_severity',8,'detection_method','seal_pressure'),
      jsonb_build_object('code','PH_FM_010','asset_class','autoclave','name','Failed sterilization cycle','fmea_severity',10,'detection_method','validation_failure'),
      jsonb_build_object('code','PH_FM_020','asset_class','lyophilizer','name','Vacuum leak','fmea_severity',8,'detection_method','leak_test'),
      jsonb_build_object('code','PH_FM_030','asset_class','filling_line','name','Fill weight deviation','fmea_severity',7,'detection_method','checkweigher'),
      jsonb_build_object('code','PH_FM_031','asset_class','filling_line','name','Stopper misplacement','fmea_severity',6,'detection_method','vision_system'),
      jsonb_build_object('code','PH_FM_040','asset_class','hvac_cleanroom','name','Differential pressure loss','fmea_severity',9,'detection_method','dp_continuous'),
      jsonb_build_object('code','PH_FM_041','asset_class','hvac_cleanroom','name','HEPA filter loading','fmea_severity',7,'detection_method','dp_filter'),
      jsonb_build_object('code','PH_FM_050','asset_class','wfi_system','name','Endotoxin excursion','fmea_severity',10,'detection_method','endotoxin_test'),
      jsonb_build_object('code','PH_FM_051','asset_class','wfi_system','name','Conductivity drift','fmea_severity',7,'detection_method','conductivity'),
      jsonb_build_object('code','PH_FM_060','asset_class','particle_counter','name','Calibration drift','fmea_severity',6,'detection_method','calibration_check')
    ),
    'kpis_kois', jsonb_build_array(
      jsonb_build_object('code','GMP_DEVIATIONS','name','GMP Deviation Count','iso55000',true,'unit','count'),
      jsonb_build_object('code','CALIBRATION_COMPLIANCE','name','Calibration Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','QUALIFICATION_CURRENCY','name','Equipment Qualification Currency','iso55000',true,'unit','%'),
      jsonb_build_object('code','BATCH_DISPOSITION_TIME','name','Batch Disposition Time','iso55000',true,'unit','days'),
      jsonb_build_object('code','OEE','name','Overall Equipment Effectiveness','iso55000',true,'unit','%'),
      jsonb_build_object('code','MTBF','name','Mean Time Between Failures','iso55000',true,'unit','hours'),
      jsonb_build_object('code','PM_COMPLIANCE','name','PM Compliance','iso55000',true,'unit','%'),
      jsonb_build_object('code','CHANGE_CONTROL_AGE','name','Change Control Age','iso55000',true,'unit','days'),
      jsonb_build_object('code','CAPA_AGE','name','CAPA Open Age','iso55000',true,'unit','days'),
      jsonb_build_object('code','CLEANROOM_EXCURSIONS','name','Cleanroom Environmental Excursions','iso55000',true,'unit','count')
    ),
    'integrations', jsonb_build_array(
      jsonb_build_object('vendor','SAP','product','SAP S/4HANA PM','category','erp_cmms','status','recommended'),
      jsonb_build_object('vendor','IBM','product','Maximo','category','erp_cmms','status','recommended'),
      jsonb_build_object('vendor','Veeva','product','Vault QualityDocs','category','quality','status','recommended'),
      jsonb_build_object('vendor','Honeywell','product','TrackWise','category','quality','status','supported'),
      jsonb_build_object('vendor','MasterControl','product','Quality Excellence','category','quality','status','supported'),
      jsonb_build_object('vendor','Rockwell','product','PharmaSuite MES','category','mes','status','recommended'),
      jsonb_build_object('vendor','Werum','product','PAS-X MES','category','mes','status','supported'),
      jsonb_build_object('vendor','Anthropic','product','Claude API','category','ai','status','core')
    ),
    'compliance', jsonb_build_array('FDA_21_CFR_PART_11','FDA_21_CFR_PART_210','FDA_21_CFR_PART_211','EU_GMP_ANNEX_1','EU_GMP_ANNEX_11','ICH_Q7','ICH_Q9','ISO_13485','ISO_55000'),
    'agent_priorities', jsonb_build_array(
      jsonb_build_object('agent','compliance_auditing','weight',1.0),
      jsonb_build_object('agent','quality_assurance','weight',1.0),
      jsonb_build_object('agent','condition_monitoring','weight',0.95),
      jsonb_build_object('agent','asset_management','weight',0.90),
      jsonb_build_object('agent','reliability_engineering','weight',0.85),
      jsonb_build_object('agent','planning_scheduling','weight',0.80),
      jsonb_build_object('agent','data_analytics','weight',0.80),
      jsonb_build_object('agent','work_order_management','weight',0.75),
      jsonb_build_object('agent','maintenance_strategy','weight',0.70),
      jsonb_build_object('agent','training_workforce','weight',0.70),
      jsonb_build_object('agent','financial_contract','weight',0.60),
      jsonb_build_object('agent','sustainability_esg','weight',0.60),
      jsonb_build_object('agent','inventory_management','weight',0.55),
      jsonb_build_object('agent','maintenance_operations','weight',0.55),
      jsonb_build_object('agent','continuous_improvement','weight',0.50)
    ),
    'default_dashboards', jsonb_build_array('operational','quality','compliance','calibration','batch','executive'),
    'default_governance', 'conditional',
    'oee_model', 'availability-performance-quality',
    'summary_metrics', jsonb_build_object('kpi_count',10,'asset_class_count',13,'failure_mode_count',11)
  )
)
ON CONFLICT (code) DO UPDATE SET
  slug = EXCLUDED.slug, name = EXCLUDED.name, industry = EXCLUDED.industry, category = EXCLUDED.category,
  hero_summary = EXCLUDED.hero_summary, recommended_pricing_tier = EXCLUDED.recommended_pricing_tier,
  sort_order = EXCLUDED.sort_order, template_config = EXCLUDED.template_config, updated_at = NOW();

-- =====================================================================
-- TEMPLATES 4-13: SCAFFOLDED  (minimum viable template_config)
-- =====================================================================
-- These ship today with valid structure. The deploy-tenant Edge Function
-- handles them gracefully via fallback to _base defaults. Each can be
-- enriched without schema changes — just UPDATE template_config.
--
-- A scaffolded template includes hero copy, recommended pricing tier,
-- target compliance frameworks, default agent priorities, and placeholders
-- for asset_classes / failure_modes / kpis_kois that the deploy engine
-- inherits from the closest tier-1 reference.
-- =====================================================================

-- Helper function to build a scaffold template_config
CREATE OR REPLACE FUNCTION _scaffold_template_config(
  inherit_from TEXT,
  compliance_codes TEXT[],
  oee_model TEXT,
  governance TEXT,
  dashboards TEXT[]
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'inherits_from', inherit_from,
    'asset_classes', '[]'::jsonb,
    'failure_modes', '[]'::jsonb,
    'kpis_kois', '[]'::jsonb,
    'integrations', '[]'::jsonb,
    'compliance', to_jsonb(compliance_codes),
    'agent_priorities', '[]'::jsonb,
    'default_dashboards', to_jsonb(dashboards),
    'default_governance', governance,
    'oee_model', oee_model,
    'summary_metrics', jsonb_build_object('kpi_count',0,'asset_class_count',0,'failure_mode_count',0,'scaffold',true)
  );
$$ LANGUAGE SQL IMMUTABLE;

-- 4. Mining & Metals (extend existing 'mining' from 007)
UPDATE deployment_templates SET
  slug = 'mining-and-metals',
  name = 'Mining & Metals',
  industry = 'mining',
  category = 'tier-1',
  hero_summary = 'Haul fleet + fixed plant: throughput-aligned reliability, MSHA/ISO 14001 compliance, fleet-level benchmarking.',
  recommended_pricing_tier = 'enterprise',
  sort_order = 40,
  template_config = _scaffold_template_config('oil_and_gas', ARRAY['MSHA','ISO_14001','ISO_45001','ISO_55000'], 'availability-performance-quality', 'conditional', ARRAY['operational','tactical','strategic','fleet','compliance','executive']),
  updated_at = NOW()
WHERE code = 'mining';

-- 5. Power Generation & Utilities (extend existing 'utilities' from 007)
UPDATE deployment_templates SET
  slug = 'power-generation-and-utilities',
  name = 'Power Generation & Utilities',
  industry = 'energy',
  category = 'tier-1',
  hero_summary = 'Generation, transmission, distribution: SAIDI/SAIFI risk scoring, NERC CIP compliance, asset replacement modeling.',
  recommended_pricing_tier = 'enterprise',
  sort_order = 50,
  template_config = _scaffold_template_config('oil_and_gas', ARRAY['NERC_CIP','IEEE_C37','IEC_61850','ISO_55000','ISO_50001'], 'infrastructure', 'conditional', ARRAY['operational','reliability','compliance','executive']),
  updated_at = NOW()
WHERE code = 'utilities';

-- 6. Heavy Manufacturing (extend existing 'manufacturing' from 007)
UPDATE deployment_templates SET
  slug = 'heavy-manufacturing',
  name = 'Heavy Manufacturing',
  industry = 'manufacturing',
  category = 'tier-1',
  hero_summary = 'Discrete + continuous process: OEE-aligned prioritization, MES/CMMS/ERP integration, production-economics-driven strategy.',
  recommended_pricing_tier = 'professional',
  sort_order = 60,
  template_config = _scaffold_template_config('oil_and_gas', ARRAY['ISO_9001','ISO_14001','ISO_45001','ISO_55000','IATF_16949'], 'availability-performance-quality', 'advisory', ARRAY['operational','tactical','strategic','executive']),
  updated_at = NOW()
WHERE code = 'manufacturing';

-- 7-13. NEW industries (no row yet in 007) — insert scaffolded
INSERT INTO deployment_templates (code, slug, name, industry, category, hero_summary, recommended_pricing_tier, sort_order, template_config) VALUES
  (
    'chemicals_petrochemicals',
    'chemicals-and-petrochemicals',
    'Chemicals & Petrochemicals',
    'process_industries',
    'tier-1',
    'Refining + specialty chems: continuous corrosion modeling, RBI per API 580/581, automated PSM/MOC documentation.',
    'enterprise',
    70,
    _scaffold_template_config('oil_and_gas', ARRAY['API_580','API_581','OSHA_PSM_1910_119','ISO_14001','ISO_45001','ISO_55000','REACH'], 'availability-performance-quality', 'conditional', ARRAY['operational','tactical','strategic','compliance','psm','executive'])
  ),
  (
    'pulp_paper_packaging',
    'pulp-paper-and-packaging',
    'Pulp, Paper & Packaging',
    'process_industries',
    'tier-2',
    'Continuous-process plants: recovery boiler integrity, condition-based roll/felt forecasting, ISO 50001 energy scoring.',
    'professional',
    80,
    _scaffold_template_config('oil_and_gas', ARRAY['ISO_50001','ISO_14001','ISO_55000','OSHA_PSM_1910_119'], 'availability-performance-quality', 'advisory', ARRAY['operational','tactical','strategic','energy','executive'])
  ),
  (
    'aerospace_defense',
    'aerospace-and-defense',
    'Aerospace & Defense Manufacturing + MRO',
    'aerospace_defense',
    'tier-1',
    'High-CAPEX tooling + airframe MRO: AS9100/ITAR audit trails, configuration-aware work orders, predictive turn-time.',
    'enterprise',
    90,
    _scaffold_template_config('pharmaceuticals', ARRAY['AS9100','ITAR','EAR','ISO_55000','ISO_9001','MIL_STD_810'], 'availability-performance-quality', 'conditional', ARRAY['operational','tactical','strategic','compliance','mro','executive'])
  ),
  (
    'pipelines_midstream',
    'pipelines-and-midstream',
    'Pipelines & Midstream',
    'energy',
    'tier-1',
    'Distributed integrity: ASME B31.8S threat modeling, unified ILI history, automated PHMSA / NEB submittals.',
    'enterprise',
    100,
    _scaffold_template_config('oil_and_gas', ARRAY['DOT_PHMSA_192','DOT_PHMSA_195','ASME_B31_8S','API_1160','API_1163','CSA_Z662','ISO_55000'], 'availability-performance-quality', 'conditional', ARRAY['operational','integrity','compliance','executive'])
  ),
  (
    'rail_marine_aviation',
    'rail-marine-and-aviation',
    'Rail, Marine & Aviation Infrastructure',
    'transportation',
    'tier-2',
    'Cross-fleet reliability + condition-based lifing: predictive overhaul scheduling, network-level disruption forecasting.',
    'enterprise',
    110,
    _scaffold_template_config('aerospace_defense', ARRAY['FRA_PART_213','IMO_ISM','EASA_PART_M','ICAO_ANNEX_8','ISO_55000','ISO_45001'], 'availability-performance-quality', 'conditional', ARRAY['operational','tactical','strategic','fleet','executive'])
  ),
  (
    'equipment_rental',
    'equipment-rental',
    'Equipment Rental & Leasing',
    'services',
    'tier-2',
    'Utilization-aware PM: rental-readiness optimization, fleet-level health visibility, asset turnover efficiency.',
    'professional',
    120,
    _scaffold_template_config('mining', ARRAY['ISO_55000','ISO_9001','OSHA_29_CFR_1910'], 'availability-performance-quality', 'advisory', ARRAY['operational','tactical','strategic','utilization','executive'])
  ),
  (
    'multi_site_operators',
    'multi-site-operators',
    'Multi-site Operators',
    'cross_cutting',
    'tier-2',
    'Enterprise-wide: cross-site risk benchmarking, standardized AI prioritization, executive operational dashboards.',
    'enterprise',
    130,
    _scaffold_template_config('oil_and_gas', ARRAY['ISO_55000','ISO_31000'], 'availability-performance-quality', 'advisory', ARRAY['operational','tactical','strategic','enterprise','executive'])
  )
ON CONFLICT (code) DO UPDATE SET
  slug = EXCLUDED.slug, name = EXCLUDED.name, industry = EXCLUDED.industry, category = EXCLUDED.category,
  hero_summary = EXCLUDED.hero_summary, recommended_pricing_tier = EXCLUDED.recommended_pricing_tier,
  sort_order = EXCLUDED.sort_order, template_config = EXCLUDED.template_config, updated_at = NOW();

-- =====================================================================
-- VIEW: public templates with derived summary_metrics for the UI
-- =====================================================================
CREATE OR REPLACE VIEW v_deployment_templates_public AS
SELECT
  id,
  code,
  slug,
  name,
  industry,
  category,
  description,
  hero_summary,
  recommended_pricing_tier,
  sort_order,
  is_active,
  COALESCE(template_config->'summary_metrics'->>'kpi_count','0')::int            AS kpi_count,
  COALESCE(template_config->'summary_metrics'->>'asset_class_count','0')::int    AS asset_class_count,
  COALESCE(template_config->'summary_metrics'->>'failure_mode_count','0')::int   AS failure_mode_count,
  COALESCE(template_config->>'oee_model','availability-performance-quality')    AS oee_model,
  COALESCE(template_config->>'default_governance','advisory')                   AS governance,
  COALESCE((template_config->'summary_metrics'->>'scaffold')::boolean, false)   AS is_scaffold,
  template_config
FROM deployment_templates
WHERE is_active = true
ORDER BY sort_order, name;

GRANT SELECT ON v_deployment_templates_public TO anon, authenticated;

SELECT '012: Industry Templates Expanded — 13 templates registered' AS status;
