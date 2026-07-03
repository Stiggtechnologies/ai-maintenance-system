-- ============================================================================
-- SyncAI demo seed — Fort McMurray Oil Sands Demo Site
-- Repeated conveyor bearing failures and pump seal failures threaten production.
-- Login: demo@syncai.ca / Demo123!@#
-- ============================================================================

-- ---- Auth user (local GoTrue) ----------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue scans these into non-null Go strings; NULL causes "Database error querying schema".
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'demo@syncai.ca',
  crypt('Demo123!@#', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Reliability Engineer"}',
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
) values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"demo@syncai.ca"}',
  'email', now(), now(), now()
) on conflict do nothing;

-- ---- Organization + site ----------------------------------------------------
insert into organizations (id, name, industry) values
  ('11111111-1111-1111-1111-111111111111', 'Fort McMurray Oil Sands Demo', 'oil_sands')
on conflict (id) do nothing;

insert into sites (id, organization_id, name, location) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Fort McMurray Site A', 'Fort McMurray, AB')
on conflict (id) do nothing;

-- ---- Roles + user profile ---------------------------------------------------
insert into roles (id, organization_id, key, name, description) values
  ('33333333-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','executive','Executive','Mission readiness + value emphasis'),
  ('33333333-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','maintenance_manager','Maintenance Manager','Approvals + work execution'),
  ('33333333-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','reliability_engineer','Reliability Engineer','Reliability + RCA + FMEA'),
  ('33333333-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','planner','Planner','Scheduling + work board'),
  ('33333333-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','technician','Technician','Assigned work'),
  ('33333333-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','ai_admin','AI Admin','Agent + autonomy administration')
on conflict (id) do nothing;

update roles set code = key, level = 1 where code is null;
update sites set code = 'SITE-A' where code is null;

insert into user_profiles (id, organization_id, email, full_name, role) values
  ('00000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','demo@syncai.ca','Demo Reliability Engineer','reliability_engineer')
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role;

insert into user_role_assignments (organization_id, user_id, role_id) values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000003')
on conflict do nothing;

insert into raci_assignments (organization_id, decision_type, accountable, responsible, consulted, informed) values
  ('11111111-1111-1111-1111-111111111111','PM Strategy Change','Reliability Manager','Reliability Engineer','Maintenance Manager','Technician'),
  ('11111111-1111-1111-1111-111111111111','Work Order Creation','Maintenance Supervisor','Planner / AI','Operations','Technician'),
  ('11111111-1111-1111-1111-111111111111','PM Deferral (Critical)','Maintenance Manager','Planner','Ops Manager','Reliability Engineer'),
  ('11111111-1111-1111-1111-111111111111','Asset Shutdown','Site Manager','Ops Manager','Maintenance Manager','Executive'),
  ('11111111-1111-1111-1111-111111111111','Safety Override','Site Manager','HSE Manager','Operations','All')
on conflict do nothing;

-- ---- Assets -----------------------------------------------------------------
insert into assets (id, organization_id, site_id, tag, name, asset_class, criticality, status, health_score, risk_score, area, system, manufacturer, model, serial_number, installed_date) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','C-22','Conveyor C-22','Belt Conveyor — Overland','critical','critical',74,82,'Processing Plant','Material Handling','Metso Outotec','HBF-2400','MO-2019-HBF-88412','2019-03-15'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','P-101','Pump P-101','Centrifugal Pump','high','watch',81,67,'Cooling Circuit','Utilities','Flowserve','HPX-6x4','FS-2020-HPX-4471','2020-06-01'),
  ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','K-05','Compressor K-05','Reciprocating Compressor','high','watch',86,44,'Gas Handling','Process Gas','Ariel','JGK-4','AR-2018-JGK-3320','2018-09-10'),
  ('aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','HX-08','Heat Exchanger HX-08','Shell & Tube Exchanger','medium','healthy',90,31,'Utility Block','Heat Recovery','Alfa Laval','M15-BFG','AL-2017-M15-1180','2017-04-22'),
  ('aaaaaaaa-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','HT-027','Haul Truck HT-027','Ultra-Class Haul Truck','critical','watch',79,58,'Mine','Mobile Fleet','Caterpillar','797F','CAT-2021-797F-0271','2021-02-18'),
  ('aaaaaaaa-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','SH-004','Shovel SH-004','Electric Rope Shovel','critical','healthy',88,33,'Mine','Mobile Fleet','Komatsu','P&H 4100XPC','KOM-2019-4100-0040','2019-11-05')
on conflict (id) do nothing;

-- ---- Components + sensors (C-22, P-101) -------------------------------------
insert into components (id, organization_id, asset_id, name, type) values
  ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Drive Assembly','drive'),
  ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Drive-End Bearing','bearing'),
  ('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','Mechanical Seal','seal'),
  ('cccccccc-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','Pump Bearing','bearing')
on conflict (id) do nothing;

insert into sensors (organization_id, asset_id, name, signal_type, unit, last_value, threshold, status, trend) values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Vibration — Drive End','vibration','mm/s',12.4,10.0,'alarm','up'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Temperature — Drive End','temperature','degC',78,85,'warning','up'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Belt Speed','speed','m/s',4.2,4.5,'normal','stable'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','Seal Chamber Pressure','pressure','bar',3.1,2.5,'warning','up'),
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','Vibration — DE','vibration','mm/s',5.8,8.0,'normal','up');

-- ---- AI agents (15) ---------------------------------------------------------
insert into ai_agents (id, organization_id, key, name, category, status, autonomy_mode, current_task, recommendations_generated, actions_executed, approvals_pending, confidence, supervisor, last_action, last_action_at) values
  ('00000000-aaaa-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','maintenance_strategy','Maintenance Strategy Development','strategic','active','conditional','Advancing PM on Conveyor C-22',23,18,2,91,'Reliability Manager','Recommended PM advance for C-22', now() - interval '12 minutes'),
  ('00000000-aaaa-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','asset_management','Asset Management','strategic','active','advisory','Updating criticality on haul fleet',14,6,1,84,'Asset Manager','Refreshed criticality on HT-027', now() - interval '40 minutes'),
  ('00000000-aaaa-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','reliability_engineering','Reliability Engineering','strategic','active','conditional','RCA for repeated P-101 seal failures',31,12,1,87,'Reliability Manager','Opened RCA for P-101', now() - interval '35 minutes'),
  ('00000000-aaaa-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','planning_scheduling','Planning & Scheduling','operational','active','controlled','Resolving PM/production conflicts',19,15,0,94,'Planner','Rescheduled 3 PMs', now() - interval '2 hours'),
  ('00000000-aaaa-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','work_order_management','Work Order Management','operational','active','controlled','Drafting work orders from recs',28,22,1,96,'Maintenance Supervisor','Created WO-4821 for P-101', now() - interval '1 hour'),
  ('00000000-aaaa-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','condition_monitoring','Condition Monitoring','operational','active','controlled','Tracking C-22 vibration trend',26,20,0,89,'Reliability Engineer','Raised C-22 vibration alarm', now() - interval '8 minutes'),
  ('00000000-aaaa-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','inventory_management','Inventory Management','operational','active','conditional','Checking seal kit stock',11,9,1,82,'Planner','Ordered seal kit for P-101', now() - interval '58 minutes'),
  ('00000000-aaaa-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','maintenance_operations','Maintenance Operations','operational','active','advisory','Coordinating shift execution',9,7,0,80,'Maintenance Supervisor','Assigned WO-4819', now() - interval '3 hours'),
  ('00000000-aaaa-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','quality_assurance','Quality Assurance','quality','idle','advisory','Idle',5,3,0,78,'Quality Lead','Validated PM closeout', now() - interval '1 day'),
  ('00000000-aaaa-0000-0000-000000000010','11111111-1111-1111-1111-111111111111','compliance_auditing','Compliance & Auditing','quality','active','advisory','PSV test compliance check',7,2,1,85,'HSE Manager','Flagged overdue PSV test', now() - interval '5 hours'),
  ('00000000-aaaa-0000-0000-000000000011','11111111-1111-1111-1111-111111111111','sustainability_esg','Sustainability & ESG','intelligence','idle','advisory','Idle',4,1,0,76,'ESG Lead','Updated emissions baseline', now() - interval '2 days'),
  ('00000000-aaaa-0000-0000-000000000012','11111111-1111-1111-1111-111111111111','data_analytics','Data Analytics','intelligence','active','conditional','Refreshing reliability models',22,14,0,88,'Reliability Manager','Improved seal prediction model', now() - interval '20 minutes'),
  ('00000000-aaaa-0000-0000-000000000013','11111111-1111-1111-1111-111111111111','continuous_improvement','Continuous Improvement','intelligence','idle','advisory','Idle',6,4,0,79,'CI Lead','Closed CI action', now() - interval '3 days'),
  ('00000000-aaaa-0000-0000-000000000014','11111111-1111-1111-1111-111111111111','training_workforce','Training & Workforce','intelligence','idle','advisory','Idle',3,1,0,77,'Training Lead','Scheduled training', now() - interval '4 days'),
  ('00000000-aaaa-0000-0000-000000000015','11111111-1111-1111-1111-111111111111','financial_contract','Financial & Contract','intelligence','active','advisory','Costing C-22 intervention',8,5,0,83,'Finance','Estimated downtime exposure', now() - interval '30 minutes')
on conflict (id) do nothing;

-- ---- Recommendations --------------------------------------------------------
insert into recommendations (id, organization_id, asset_id, agent_id, title, issue, action, impact, confidence, urgency, status, approval_required, accountable, responsible, consulted, informed, financial_impact, risk_impact, rationale) values
  ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','00000000-aaaa-0000-0000-000000000001',
   'Reschedule PM on Conveyor C-22','Vibration signature indicates drive-end bearing wear — 82% failure probability within 9 days','Advance PM from Day 14 to Day 3 — bearing replacement','$2.4M downtime risk mitigation',91,'critical','pending','Maintenance Manager','Maintenance Manager','Planner','Operations Manager','Reliability Engineer','$2.4M risk mitigation','High','Vibration signature analysis indicates 82% failure probability within 9 days. Advancing the PM reduces failure risk to <5%.'),
  ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','00000000-aaaa-0000-0000-000000000007',
   'Order replacement seal kit for P-101','Seal degradation detected — high probability of failure within 14 days','Create purchase order for seal kit — est. $4,200','Prevents $1.1M unplanned downtime',87,'action','pending','Autonomous (< $5K)','Planner','Inventory','Maintenance Lead','Site Manager','$4,200 cost','Low','Seal wear detected via process-data deviation. Part value is below the $5,000 autonomous threshold.'),
  ('dddddddd-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003','00000000-aaaa-0000-0000-000000000006',
   'Increase sensor polling on K-05','Temperature deviation detected — early-stage anomaly','Increase polling interval from 5min to 1min for 72 hours','Early detection reduces risk by 60%',78,'advisory','approved','Autonomous','Reliability Engineer','AI Agent','Maintenance Lead','Technician','Minimal ($0)','Low','Anomaly detected; enhanced monitoring is a defensive action within autonomous authority.'),
  ('dddddddd-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000005','00000000-aaaa-0000-0000-000000000002',
   'Inspect HT-027 transmission cooling','Transmission temperature trending up under payload','Schedule inspection within 96 hours','Prevents $760K mobile-fleet downtime',81,'action','pending','Maintenance Manager','Maintenance Manager','Planner','Operations','Reliability Engineer','$760K exposure','Medium','Payload-correlated transmission temperature rise indicates cooling degradation.')
on conflict (id) do nothing;

-- ---- Evidence for the C-22 recommendation ----------------------------------
insert into evidence_items (organization_id, recommendation_id, asset_id, source_system, evidence_type, description, confidence_contribution, data_quality, related_asset, ts) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Condition Monitoring','Vibration spectrum','Drive-end vibration at 12.4 mm/s vs 10.0 mm/s alarm; bearing defect frequency (BPFO) energy rising over 6 days',34,'high','Conveyor C-22', now() - interval '6 hours'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Historian','Temperature trend','Drive-end temperature rising 0.4°C/day, approaching 85°C alarm',22,'high','Conveyor C-22', now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','CMMS','Failure history','4 bearing-related failures in trailing 12 months on this conveyor class',20,'medium','Conveyor C-22', now() - interval '3 days'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Reliability Model','ML prediction','bearing-failure-rf-v4.2 predicts 82% failure probability within 9 days',15,'high','Conveyor C-22', now() - interval '2 hours');

-- ---- Scenarios for the C-22 recommendation ---------------------------------
insert into scenarios (organization_id, recommendation_id, asset_id, key, label, cost, downtime_impact, production_impact, safety_risk, environmental_risk, financial_exposure, mission_readiness_impact, recommended) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','execute_now','Execute now',48000,'4h planned outage','Low — within maintenance window','Low','Low','$48K cost vs $2.4M risk','+9 readiness points',true),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','defer_7','Defer 7 days',52000,'Rising failure probability','Medium','Medium','Elevated','$1.4M expected exposure','-3 readiness points',false),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','defer_14','Defer 14 days',60000,'High likelihood of failure before window','High','Medium','High','$2.1M expected exposure','-9 readiness points',false),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','run_to_failure','Run to failure',0,'18-24h unplanned outage likely','Severe','High','Medium','$2.4M+ exposure','-18 readiness points',false),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','replace_asset','Replace asset',420000,'Multi-day install','High during change-out','Low','Low','$420K capital','Neutral long-term',false),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','repair_asset','Repair asset (bearing)',48000,'4h planned outage','Low','Low','Low','$48K cost','+9 readiness points',false);

-- ---- Work orders ------------------------------------------------------------
insert into work_orders (id, organization_id, asset_id, recommendation_id, wo_number, title, status, priority, type, assignee, scheduled_date, estimated_hours, parts_ready, risk_score, financial_exposure, production_impact, safety_flag, approval_required, description) values
  ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000002','WO-4821','Pump P-101 seal inspection & replacement','critical','critical','ai_generated','J. Morrison','2026-05-30',6,true,81,'$1.1M','High',true,false,'AI-detected seal degradation. Replace mechanical seal — all parts staged.'),
  ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000003',null,'WO-4815','Monthly PM — Compressor K-05','scheduled','high','human_created','K. Patel','2026-06-04',4,true,68,'$680K','Medium',true,false,'Scheduled quarterly compression PM. Filters and oil change.'),
  ('bbbbbbbb-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000004',null,'WO-4818','Heat Exchanger HX-08 tube cleaning','blocked','medium','human_created',null,'2026-05-30',12,false,42,'$290K','Low',false,false,'Thermal efficiency degradation. Blocked — cleaning chemicals not in stock.')
on conflict (id) do nothing;

-- ---- Approvals --------------------------------------------------------------
insert into approvals (organization_id, recommendation_id, work_order_id, status, owner_role, reason, consequence_of_wrong, required_validation) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001',null,'required','Maintenance Manager','PM advancement on critical conveyor','Unplanned bearing failure causes ~$2.4M production loss and possible secondary damage.','Confirm vibration trend, spare availability, and production window before execution.');

-- ---- Decisions (history) ----------------------------------------------------
insert into decisions (organization_id, recommendation_id, agent_id, asset_id, decision_type, action_taken, approval_status, autonomy_mode, confidence_score, human_actor, rationale, outcome_status) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000002','00000000-aaaa-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000002','work_order','Created inspection work order WO-4821 — assigned to J. Morrison','autonomous','controlled',96,'AI Agent (autonomous)','Seal wear detected; confidence above autonomous threshold.','executed'),
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000003','00000000-aaaa-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000003','pm_strategy','Increased K-05 polling 5min→1min for 72h','autonomous','controlled',78,'AI Agent (autonomous)','Defensive monitoring within autonomous authority.','executed');

-- ---- Value metrics ----------------------------------------------------------
insert into value_metrics (organization_id, recommendation_id, asset_id, metric_type, label, value, unit, status, period) values
  ('11111111-1111-1111-1111-111111111111',null,null,'downtime_avoided','Downtime avoided',384,'hours','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'maintenance_cost_savings','Maintenance cost savings',1400000,'usd','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'avoided_production_loss','Avoided production loss',890000,'usd','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'risk_exposure_reduced','Risk exposure reduced',12400000,'usd','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'recommendations_accepted','Recommendations accepted',84,'percent','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'autonomous_actions_executed','Autonomous actions executed',142,'count','verified','MTD'),
  ('11111111-1111-1111-1111-111111111111',null,null,'projected_annualized_value','Projected annualized value',28200000,'usd','projected','annualized');

-- ---- Learning events --------------------------------------------------------
insert into learning_events (organization_id, recommendation_id, asset_id, event_type, title, detail, expected_value, verified_value, model_confidence) values
  ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003','recommendation_accepted','K-05 enhanced monitoring accepted','Autonomous polling increase accepted; baseline recalibrated.',null,null,78),
  ('11111111-1111-1111-1111-111111111111',null,'aaaaaaaa-0000-0000-0000-000000000002','model_confidence','Seal-failure model improved','Prediction accuracy improved from 72% to 87% for P-101 class.',null,null,87),
  ('11111111-1111-1111-1111-111111111111',null,'aaaaaaaa-0000-0000-0000-000000000001','work_completed','Idler roller replacement verified','Verified $180K downtime avoided from proactive idler change-out.',180000,180000,90);

-- ---- Integrations -----------------------------------------------------------
insert into integrations (organization_id, name, category, status, last_sync, records_synced) values
  ('11111111-1111-1111-1111-111111111111','SAP PM','CMMS','connected', now() - interval '10 minutes', 18422),
  ('11111111-1111-1111-1111-111111111111','OSIsoft PI','Historian','connected', now() - interval '2 minutes', 982231),
  ('11111111-1111-1111-1111-111111111111','Maximo','CMMS','degraded', now() - interval '3 hours', 5120),
  ('11111111-1111-1111-1111-111111111111','Bently Nevada','Condition Monitoring','connected', now() - interval '1 minute', 44120);

-- ---- Cowork workspace example ----------------------------------------------
insert into cowork_workspaces (id, organization_id, asset_id, title, objective, status, agents, progress, artifacts, next_action, created_by) values
  ('cccccccc-1111-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000002','RCA Copilot — Pump P-101','Root cause analysis for repeated seal failures on P-101 class pumps','active','{"Reliability Engineering","Condition Monitoring","Work Order Management","Financial & Contract"}',78,3,'Validate corrective action with maintenance manager','demo@syncai.ca')
on conflict (id) do nothing;

insert into cowork_messages (organization_id, workspace_id, agent, role, message, confidence) values
  ('11111111-1111-1111-1111-111111111111','cccccccc-1111-0000-0000-000000000001','Reliability Engineering','agent','Analyzed 5 seal failures over 9 months on P-101. Dominant failure mode: seal face wear from intermittent dry-running during low-flow excursions.',88),
  ('11111111-1111-1111-1111-111111111111','cccccccc-1111-0000-0000-000000000001','Condition Monitoring','agent','Seal chamber pressure rising to 3.1 bar vs 2.5 bar setpoint, correlated with low-flow periods.',85),
  ('11111111-1111-1111-1111-111111111111','cccccccc-1111-0000-0000-000000000001','Financial & Contract','agent','Each seal failure averages $1.1M exposure. Corrective action ROI is strongly positive.',83);

insert into artifacts (organization_id, workspace_id, asset_id, type, title, content) values
  ('11111111-1111-1111-1111-111111111111','cccccccc-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','rca_report','RCA Starter — P-101 Seal Failures','Root cause: seal face wear from intermittent dry-running during low-flow excursions. Corrective actions: add minimum-flow protection, revise operating procedure, upgrade to dual seal with API Plan 53B.');

-- ============================================================================
-- Legacy-surface demo data (OEE, KPIs, integrations, research, deployments,
-- approvals queue, alerts, billing, SIR, trace replay) — every page live.
-- ============================================================================

-- ---- asset classes + locations, link assets --------------------------------
insert into asset_classes (id, organization_id, name, description) values
  ('ac000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Belt Conveyor','Overland and plant conveyors'),
  ('ac000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Centrifugal Pump','Process and utility pumps'),
  ('ac000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Reciprocating Compressor','Process gas compression'),
  ('ac000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Heat Exchanger','Shell & tube exchangers'),
  ('ac000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Haul Truck','Ultra-class mining trucks'),
  ('ac000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Electric Rope Shovel','Primary loading units')
on conflict (id) do nothing;

insert into asset_locations (id, organization_id, name) values
  ('a1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Processing Plant'),
  ('a1000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Cooling Circuit'),
  ('a1000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Gas Handling'),
  ('a1000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Utility Block'),
  ('a1000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Mine North Pit')
on conflict (id) do nothing;

update assets set asset_tag = tag where asset_tag is null;
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000001', location_id = 'a1000000-0000-0000-0000-000000000001' where tag = 'C-22';
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000002', location_id = 'a1000000-0000-0000-0000-000000000002' where tag = 'P-101';
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000003', location_id = 'a1000000-0000-0000-0000-000000000003' where tag = 'K-05';
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000004', location_id = 'a1000000-0000-0000-0000-000000000004' where tag = 'HX-08';
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000005', location_id = 'a1000000-0000-0000-0000-000000000005' where tag = 'HT-027';
update assets set asset_class_id = 'ac000000-0000-0000-0000-000000000006', location_id = 'a1000000-0000-0000-0000-000000000005' where tag = 'SH-004';

-- ---- work order legacy columns ----------------------------------------------
update work_orders set
  site_id = '22222222-2222-2222-2222-222222222222',
  due_date = now() + interval '3 days',
  work_type = case when type = 'ai_generated' then 'corrective' else 'preventive' end,
  updated_at = now()
where site_id is null;

insert into work_order_tasks (work_order_id, task_sequence, description, status, estimated_hours) values
  ('bbbbbbbb-0000-0000-0000-000000000001',1,'Isolate and lock out pump P-101','completed',0.5),
  ('bbbbbbbb-0000-0000-0000-000000000001',2,'Replace mechanical seal','in_progress',3),
  ('bbbbbbbb-0000-0000-0000-000000000001',3,'Leak test and return to service','pending',1.5);

insert into work_order_status_history (work_order_id, status_from, status_to, comments) values
  ('bbbbbbbb-0000-0000-0000-000000000001','pending','critical','Escalated by Condition Monitoring agent — seal chamber pressure trending up');

-- ---- connectors + runs --------------------------------------------------------
insert into connectors (id, organization_id, connector_type, name, status, last_success_at) values
  ('c0e00000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','sap_pm','SAP PM/EAM','active', now() - interval '10 minutes'),
  ('c0e00000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','osisoft_pi','OSIsoft PI Historian','active', now() - interval '2 minutes'),
  ('c0e00000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','maximo','IBM Maximo','degraded', now() - interval '3 hours'),
  ('c0e00000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','bently','Bently Nevada System 1','active', now() - interval '1 minute')
on conflict (id) do nothing;

insert into connector_runs (connector_id, run_type, status, started_at, finished_at, records_processed) values
  ('c0e00000-0000-0000-0000-000000000001','sync','success', now() - interval '12 minutes', now() - interval '10 minutes', 1842),
  ('c0e00000-0000-0000-0000-000000000002','stream','success', now() - interval '3 minutes', now() - interval '2 minutes', 98223),
  ('c0e00000-0000-0000-0000-000000000003','sync','failed', now() - interval '3 hours', now() - interval '3 hours', 0),
  ('c0e00000-0000-0000-0000-000000000004','stream','success', now() - interval '2 minutes', now() - interval '1 minute', 44120);
update connector_runs set error_message = 'Authentication token expired — refresh required' where status = 'failed';

-- ---- OEE: 14 days of measurements + loss events -------------------------------
insert into oee_measurements (organization_id, site_id, measurement_date, availability, performance, quality, oee)
select
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
  now() - (d || ' days')::interval,
  86 + (d % 5), 88 + (d % 4), 97 + (d % 2),
  round((86 + (d % 5)) * (88 + (d % 4)) * (97 + (d % 2)) / 10000.0, 1)
from generate_series(0, 13) as d;

insert into oee_loss_events (organization_id, loss_type, description, start_time, duration_minutes) values
  ('11111111-1111-1111-1111-111111111111','unplanned_downtime','Conveyor C-22 vibration trip', now() - interval '2 days', 145),
  ('11111111-1111-1111-1111-111111111111','speed_loss','Belt speed reduced pending bearing replacement', now() - interval '1 day', 320),
  ('11111111-1111-1111-1111-111111111111','planned_maintenance','K-05 quarterly PM window', now() - interval '5 days', 240);

-- ---- KPIs ------------------------------------------------------------------------
insert into kpi_definitions (id, code, name, unit, category, active) values
  ('4b100000-0000-0000-0000-000000000001','MTBF','Mean Time Between Failures','hours','reliability',true),
  ('4b100000-0000-0000-0000-000000000002','MTTR','Mean Time To Repair','hours','reliability',true),
  ('4b100000-0000-0000-0000-000000000003','PM_COMP','PM Compliance','%','maintenance',true),
  ('4b100000-0000-0000-0000-000000000004','SCHED_COMP','Schedule Compliance','%','maintenance',true),
  ('4b100000-0000-0000-0000-000000000005','OEE','Overall Equipment Effectiveness','%','production',true),
  ('4b100000-0000-0000-0000-000000000006','BACKLOG','Maintenance Backlog','weeks','planning',true)
on conflict (id) do nothing;

insert into kpis_kois (kpi_code, kpi_name, description, unit_of_measure, target_value, threshold_green, threshold_yellow, active) values
  ('MTBF','Mean Time Between Failures','Fleet reliability','hours',3000,2800,2400,true),
  ('MTTR','Mean Time To Repair','Repair responsiveness','hours',4,4.5,6,true),
  ('PM_COMP','PM Compliance','Preventive maintenance execution','%',95,90,80,true),
  ('SCHED_COMP','Schedule Compliance','Weekly schedule adherence','%',90,85,75,true),
  ('OEE','Overall Equipment Effectiveness','Production effectiveness','%',85,80,72,true),
  ('BACKLOG','Maintenance Backlog','Ready backlog','weeks',4,5,7,true);

insert into kpi_measurements (organization_id, kpi_definition_id, site_id, measurement_time, measured_value, status)
select '11111111-1111-1111-1111-111111111111', k.id, '22222222-2222-2222-2222-222222222222',
       now() - (d || ' days')::interval,
       case k.code when 'MTBF' then 2847 - d*10 when 'MTTR' then 4.2 + d*0.05 when 'PM_COMP' then 91 - (d%3) when 'SCHED_COMP' then 86 - (d%4) when 'OEE' then 78 + (d%5) else 4.8 - d*0.05 end,
       'on_target'
from kpi_definitions k, generate_series(0, 6) as d;

insert into user_kpi_dashboard (user_id, kpi_id, kpi_code, kpi_name, kpi_type, category_name, latest_value, target_value, status, trend) values
  ('00000000-0000-0000-0000-000000000001','4b100000-0000-0000-0000-000000000001','MTBF','Mean Time Between Failures','kpi','Reliability',2847,3000,'watch','up'),
  ('00000000-0000-0000-0000-000000000001','4b100000-0000-0000-0000-000000000002','MTTR','Mean Time To Repair','kpi','Reliability',4.2,4,'watch','down'),
  ('00000000-0000-0000-0000-000000000003','4b100000-0000-0000-0000-000000000003','PM_COMP','PM Compliance','kpi','Maintenance',91,95,'watch','up'),
  ('00000000-0000-0000-0000-000000000001','4b100000-0000-0000-0000-000000000005','OEE','Overall Equipment Effectiveness','kpi','Production',78.4,85,'attention','up');

insert into maintenance_metrics (organization_id, recorded_at, total_assets, pm_compliance, schedule_compliance, mtbf_hours, mttr_hours) values
  ('11111111-1111-1111-1111-111111111111', now(), 6, 91, 86, 2847, 4.2);

insert into asset_health_monitoring (organization_id, asset_id, health_score, status, sensor_data)
select organization_id, id, health_score,
       case when health_score < 75 then 'alarm' when health_score < 85 then 'warning' else 'normal' end,
       jsonb_build_object('risk_score', risk_score)
from assets;

-- ---- alerts + notifications ---------------------------------------------------------
insert into system_alerts (organization_id, severity, title, description, alert_type, acknowledged, resolved) values
  ('11111111-1111-1111-1111-111111111111','critical','C-22 drive-end vibration above alarm','12.4 mm/s vs 10.0 mm/s alarm — bearing defect frequencies rising','condition',false,false),
  ('11111111-1111-1111-1111-111111111111','warning','P-101 seal chamber pressure trending up','3.1 bar vs 2.5 bar setpoint — correlated with low-flow excursions','condition',true,false),
  ('11111111-1111-1111-1111-111111111111','info','Maximo connector degraded','Auth token expired 3 hours ago — sync paused','integration',false,false);

insert into notifications (organization_id, site_id, title, message) values
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Approval required','PM advancement on Conveyor C-22 awaits Maintenance Manager approval');

-- ---- autonomous decisions queue -------------------------------------------------------
insert into autonomous_decisions (id, organization_id, decision_type, decision_data, confidence_score, status, requires_approval, approval_deadline, autonomy_level, asset_id, correlation_id) values
  ('ad000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pm_advance','{"asset":"C-22","from_day":14,"to_day":3,"reason":"bearing wear 82% failure probability"}',91,'pending',true, now() + interval '20 hours','conditional','aaaaaaaa-0000-0000-0000-000000000001','corr-c22-001'),
  ('ad000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','create_work_order','{"asset":"P-101","wo":"WO-4821","action":"seal replacement"}',96,'executed',false, null,'controlled','aaaaaaaa-0000-0000-0000-000000000002','corr-p101-001'),
  ('ad000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','sensor_polling','{"asset":"K-05","from":"5min","to":"1min","duration":"72h"}',78,'executed',false, null,'controlled','aaaaaaaa-0000-0000-0000-000000000003','corr-k05-001'),
  ('ad000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','parts_order','{"asset":"P-101","part":"seal kit","cost_usd":4200}',87,'pending',true, now() + interval '44 hours','conditional','aaaaaaaa-0000-0000-0000-000000000002','corr-p101-002')
on conflict (id) do nothing;
update autonomous_decisions set executed_at = created_at + interval '2 minutes', duration_ms = 1840 where status = 'executed';

insert into autonomous_actions (decision_id, action_type, action_data, triggered_by, success) values
  ('ad000000-0000-0000-0000-000000000002','work_order_created','{"wo_number":"WO-4821"}','ai_agent',true),
  ('ad000000-0000-0000-0000-000000000003','polling_updated','{"interval":"1min"}','ai_agent',true);

insert into approval_workflows (decision_id, approval_level, status) values
  ('ad000000-0000-0000-0000-000000000001',1,'pending'),
  ('ad000000-0000-0000-0000-000000000004',1,'pending');

-- ---- research orchestrator --------------------------------------------------------------
insert into research_programs (id, program_code, program_name, description, domain, active, max_experiment_duration_minutes) values
  ('4e500000-0000-0000-0000-000000000001','RP-SEAL','Seal-failure prediction tuning','Optimize P-101-class seal failure model features','reliability_models',true,120),
  ('4e500000-0000-0000-0000-000000000002','RP-PM','PM interval optimization','Search optimal PM intervals for conveyor drive assemblies','maintenance_strategy',true,90)
on conflict (id) do nothing;

insert into research_runs (id, program_id, run_number, status, started_at, completed_at, duration_ms) values
  ('4e600000-0000-0000-0000-000000000001','4e500000-0000-0000-0000-000000000001',12,'completed', now() - interval '6 hours', now() - interval '5 hours', 3540000),
  ('4e600000-0000-0000-0000-000000000002','4e500000-0000-0000-0000-000000000002',8,'completed', now() - interval '1 day', now() - interval '23 hours', 2160000),
  ('4e600000-0000-0000-0000-000000000003','4e500000-0000-0000-0000-000000000001',13,'running', now() - interval '30 minutes', null, null)
on conflict (id) do nothing;

insert into research_results (run_id, metric_name, metric_value, baseline_value, improvement_pct, improved) values
  ('4e600000-0000-0000-0000-000000000001','prediction_accuracy',87.2,72.0,21.1,true),
  ('4e600000-0000-0000-0000-000000000001','false_positive_rate',3.1,5.8,-46.6,true),
  ('4e600000-0000-0000-0000-000000000002','expected_downtime_hours',68,94,-27.7,true);

insert into promotion_candidates (program_id, net_improvement_pct, benchmarks_passed, benchmarks_total, review_status) values
  ('4e500000-0000-0000-0000-000000000001',21.1,5,6,'pending');

-- ---- deployment templates -----------------------------------------------------------------
insert into deployment_templates (id, name, slug, description, master_family, master_template_name, is_active) values
  ('de000000-0000-0000-0000-000000000001','Oil Sands Operations','oil-sands','Mining + extraction + upgrading with heavy mobile fleet','oil_gas','Oil Sands Master',true),
  ('de000000-0000-0000-0000-000000000002','Hard Rock Mining','mining','Open pit and underground mining operations','mining','Mining Master',true),
  ('de000000-0000-0000-0000-000000000003','Heavy Manufacturing','manufacturing','Discrete + process manufacturing lines','manufacturing','Manufacturing Master',true),
  ('de000000-0000-0000-0000-000000000004','Power Generation','power','Thermal and renewable generation fleets','utilities','Power Master',true)
on conflict (id) do nothing;

insert into deployment_instances (template_id, organization_id, site_id, name, site_name, operating_region, timezone, asset_range, operating_model, primary_cmms, autonomy_mode, industry_code, use_case, status, created_by) values
  ('de000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Fort McMurray Pilot','Fort McMurray Site A','AB, Canada','America/Edmonton','1-5k','multi_site','SAP PM','conditional','oil_sands','90-day strategic pilot','active','00000000-0000-0000-0000-000000000001');

-- ---- audit + snapshots -------------------------------------------------------------------------
insert into audit_events (organization_id, entity_type, event_data, actor) values
  ('11111111-1111-1111-1111-111111111111','recommendation','{"action":"created","title":"Reschedule PM on Conveyor C-22"}','maintenance_strategy_agent'),
  ('11111111-1111-1111-1111-111111111111','work_order','{"action":"created","wo":"WO-4821"}','work_order_agent'),
  ('11111111-1111-1111-1111-111111111111','decision','{"action":"executed","type":"sensor_polling"}','condition_monitoring_agent');

insert into asset_snapshots (organization_id, asset_count) values ('11111111-1111-1111-1111-111111111111', 6);
insert into backlog_snapshots (organization_id, site_id, backlog_count) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', 23);

-- ---- tenants / prefs / billing / SIR / trace ----------------------------------------------------
insert into tenants (id, name) values ('7e000000-0000-0000-0000-000000000001','Fort McMurray Oil Sands Demo') on conflict (id) do nothing;
insert into tenant_settings (tenant_id, settings) values ('7e000000-0000-0000-0000-000000000001','{"autonomy_default":"conditional"}');
insert into user_preferences (user_id, tenant_id, display_name, timezone) values
  ('00000000-0000-0000-0000-000000000001','7e000000-0000-0000-0000-000000000001','Demo Reliability Engineer','America/Edmonton')
on conflict (user_id) do nothing;

insert into billing_subscriptions (id, organization_id, plan, status) values
  ('b1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','enterprise_pilot','active')
on conflict (id) do nothing;
insert into billing_invoices (subscription_id, total_cad, status) values
  ('b1000000-0000-0000-0000-000000000001', 45000, 'paid');

insert into sir_agents (name, status) values ('orchestrator','active'), ('risk-analyzer','active');
insert into sir_events (event_type, payload) values ('agent_run_completed','{"agent":"risk-analyzer","asset":"C-22"}');
insert into sir_queue (job_type, status, payload) values ('risk_scan','queued','{"scope":"site-a"}');
insert into trace_snapshots (run_id, trace_data, tool_calls, costs) values
  (gen_random_uuid(), '{"summary":"C-22 risk analysis run"}', '[{"tool":"vibration_analysis","ms":420}]', '[{"model":"gpt-4o-mini","usd":0.004}]');

-- ============================================================================
-- Embed-relation demo data (production lines, loss categories, research
-- variants, deployment template packs)
-- ============================================================================
insert into production_lines (id, organization_id, code, name) values
  ('91000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','LINE-1','Extraction Train 1'),
  ('91000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','LINE-2','Extraction Train 2')
on conflict (id) do nothing;

update oee_measurements set production_line_id = '91000000-0000-0000-0000-000000000001' where production_line_id is null;

insert into oee_loss_categories (id, code, name) values
  ('92000000-0000-0000-0000-000000000001','UNPLANNED','Unplanned Downtime'),
  ('92000000-0000-0000-0000-000000000002','SPEED','Speed Loss'),
  ('92000000-0000-0000-0000-000000000003','PLANNED','Planned Maintenance')
on conflict (id) do nothing;

update oee_loss_events set category_id = '92000000-0000-0000-0000-000000000001', asset_id = 'aaaaaaaa-0000-0000-0000-000000000001' where loss_type = 'unplanned_downtime';
update oee_loss_events set category_id = '92000000-0000-0000-0000-000000000002', asset_id = 'aaaaaaaa-0000-0000-0000-000000000001' where loss_type = 'speed_loss';
update oee_loss_events set category_id = '92000000-0000-0000-0000-000000000003', asset_id = 'aaaaaaaa-0000-0000-0000-000000000003' where loss_type = 'planned_maintenance';

insert into research_variants (id, program_id, variant_code, description, status, change_payload) values
  ('93000000-0000-0000-0000-000000000001','4e500000-0000-0000-0000-000000000001','SEAL-V13','Add low-flow excursion features to seal model','active','{"features":["low_flow_minutes","chamber_pressure_slope"]}'),
  ('93000000-0000-0000-0000-000000000002','4e500000-0000-0000-0000-000000000002','PM-V8','65-day interval for criticality-A conveyors','active','{"interval_days":65}')
on conflict (id) do nothing;

update research_runs set variant_id = '93000000-0000-0000-0000-000000000001' where program_id = '4e500000-0000-0000-0000-000000000001';
update research_runs set variant_id = '93000000-0000-0000-0000-000000000002' where program_id = '4e500000-0000-0000-0000-000000000002';
update promotion_candidates set variant_id = '93000000-0000-0000-0000-000000000001' where variant_id is null;

insert into kpi_packs (id, pack_name, kpi_count) values ('94000000-0000-0000-0000-000000000001','Oil Sands KPI Pack',24) on conflict (id) do nothing;
insert into industry_asset_libraries (id, library_name, asset_class_count) values ('94100000-0000-0000-0000-000000000001','Oil Sands Asset Library',38) on conflict (id) do nothing;
insert into industry_criticality_profiles (id, profile_name) values ('94200000-0000-0000-0000-000000000001','Oil Sands Criticality Profile') on conflict (id) do nothing;
insert into industry_governance_profiles (id, profile_name, default_autonomy_mode) values ('94300000-0000-0000-0000-000000000001','Oil Sands Governance','conditional') on conflict (id) do nothing;
insert into industry_failure_mode_packs (id, pack_name, failure_mode_count) values ('94400000-0000-0000-0000-000000000001','Oil Sands Failure Modes',412) on conflict (id) do nothing;
insert into industry_oee_models (id, model_name) values ('94500000-0000-0000-0000-000000000001','Continuous Process OEE') on conflict (id) do nothing;

update deployment_templates set
  template_type = 'derived',
  kpi_pack_id = '94000000-0000-0000-0000-000000000001',
  asset_library_id = '94100000-0000-0000-0000-000000000001',
  criticality_profile_id = '94200000-0000-0000-0000-000000000001',
  governance_profile_id = '94300000-0000-0000-0000-000000000001',
  failure_mode_pack_id = '94400000-0000-0000-0000-000000000001',
  oee_model_id = '94500000-0000-0000-0000-000000000001';
