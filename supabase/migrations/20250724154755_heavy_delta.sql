-- StiggSync AI Seed Data (Enhanced with ESG and Multi-Industry Data)

-- Insert sample organizations
INSERT INTO organizations (org_name, max_concurrent_users, license_type, subscription_plan, billing_cycle, asset_management_policy)
VALUES 
  ('DemoOrg', 1, 'concurrent', 'freemium', NULL, 'ISO 55000-compliant policy: Optimize asset lifecycle for maximum value delivery.'),
  ('AlphaCorp', 20, 'concurrent', 'pro', 'annual', 'ISO 55000-compliant policy: Ensure mission readiness and operational excellence.'),
  ('BetaIndustries', 50, 'per_seat', 'enterprise', 'annual', 'Advanced asset management with predictive maintenance and ESG compliance.');

-- Insert sample users with BCrypt hashed passwords
INSERT INTO users (org_id, username, email, password_hash, role, is_active)
VALUES 
  (1, 'admin@demo.org', 'admin@demo.org', '$2b$12$8X7z0Z9z3X9z3X9z3X9z3u', 'admin', 1),
  (2, 'admin@alpha.org', 'admin@alpha.org', '$2b$12$9Y8z1A0a4B2c6D8e0F2g4h', 'admin', 1),
  (3, 'admin@beta.org', 'admin@beta.org', '$2b$12$7W6y9Z8a3B1c5D7e9F1g3i', 'admin', 1),
  (1, 'tech@demo.org', 'tech@demo.org', '$2b$12$6V5x8Y7z2A0b4C6d8E0f2h', 'technician', 1),
  (2, 'tech@alpha.org', 'tech@alpha.org', '$2b$12$5U4w7X6y1Z9a3B5c7D9e1g', 'technician', 1);

-- Insert sample assets across different industries
INSERT INTO assets (asset_id, org_id, name, industry, operational_impact, safety_risk, replacement_cost, failure_frequency, diagnostic_coverage, historical_criticality, fmea_score, criticality_score, lifecycle_stage, asset_management_plan)
VALUES 
  -- Oil & Gas assets
  ('A001', 1, 'Centrifugal Pump X1', 'Oil & Gas', 0.8, 0.7, 50000, 0.1, 0.9, 1, 56.0, 3, 'Operation', 'Preventive maintenance every 6 months. Monitor vibration and temperature.'),
  ('A002', 1, 'Emergency Generator Y1', 'Oil & Gas', 0.9, 0.8, 100000, 0.05, 0.95, 2, 34.2, 2, 'Operation', 'Monthly testing and annual overhaul.'),
  
  -- Mining assets
  ('A003', 2, 'Haul Truck Z1', 'Mining', 0.85, 0.9, 200000, 0.08, 0.92, 3, 61.2, 3, 'Operation', 'Daily inspection and 500-hour maintenance intervals.'),
  ('A004', 2, 'Conveyor Belt W1', 'Mining', 0.75, 0.6, 150000, 0.12, 0.88, 2, 45.0, 2, 'Operation', 'Weekly belt inspection and quarterly alignment checks.'),
  
  -- Power & Utilities assets
  ('A005', 3, 'Steam Turbine T1', 'Power & Utilities', 0.95, 0.85, 500000, 0.03, 0.98, 1, 28.5, 3, 'Operation', 'Continuous monitoring with annual major inspection.'),
  ('A006', 3, 'Transformer X2', 'Power & Utilities', 0.9, 0.7, 300000, 0.04, 0.94, 2, 38.7, 2, 'Operation', 'Oil analysis every 6 months and thermal imaging annually.'),
  
  -- Chemical/Manufacturing assets
  ('A007', 1, 'Reactor Vessel R1', 'Chemical/Manufacturing', 0.92, 0.95, 800000, 0.02, 0.96, 1, 22.1, 3, 'Operation', 'Pressure testing and catalyst replacement per schedule.'),
  ('A008', 2, 'Distillation Column D1', 'Chemical/Manufacturing', 0.88, 0.8, 400000, 0.06, 0.91, 2, 41.3, 2, 'Operation', 'Tray inspection and efficiency monitoring quarterly.'),
  
  -- Aerospace & Transportation assets
  ('A009', 3, 'Aircraft Engine E1', 'Aerospace & Transportation', 0.98, 0.99, 2000000, 0.01, 0.99, 1, 15.8, 3, 'Operation', 'Flight hour-based maintenance with predictive analytics.'),
  ('A010', 3, 'Landing Gear L1', 'Aerospace & Transportation', 0.85, 0.9, 150000, 0.05, 0.93, 2, 35.2, 2, 'Operation', 'Cycle-based inspection and NDT testing.');

-- Insert sample work orders
INSERT INTO work_orders (work_order_id, org_id, asset_id, description, priority, maintenance_type, assigned_technician, status, estimated_cost)
VALUES 
  ('WO001', 1, 'A001', 'Inspect pump vibration levels and replace bearings if necessary', 'High', 'preventive', 'tech@demo.org', 'Open', 2500.00),
  ('WO002', 2, 'A003', 'Inspect haul truck brakes and hydraulic system', 'Medium', 'preventive', 'tech@alpha.org', 'In Progress', 1800.00),
  ('WO003', 3, 'A005', 'Steam turbine blade inspection and balancing', 'High', 'preventive', 'turbine.specialist@beta.org', 'Scheduled', 15000.00),
  ('WO004', 1, 'A007', 'Reactor pressure relief valve testing', 'Critical', 'compliance', 'safety.engineer@demo.org', 'Open', 3200.00),
  ('WO005', 3, 'A009', 'Engine borescope inspection per flight hours', 'High', 'preventive', 'aircraft.mechanic@beta.org', 'Completed', 8500.00);

-- Insert maintenance history
INSERT INTO maintenance_history (asset_id, work_order_id, maintenance_type, description, performed_by, cost, downtime_hours, performed_at)
VALUES 
  ('A001', 'WO001', 'Preventive', 'Quarterly pump maintenance - bearings replaced', 'tech@demo.org', 2350.00, 4.5, DATEADD(month, -3, GETUTCDATE())),
  ('A003', 'WO002', 'Corrective', 'Brake pad replacement due to excessive wear', 'tech@alpha.org', 1650.00, 2.0, DATEADD(month, -2, GETUTCDATE())),
  ('A005', 'WO003', 'Preventive', 'Annual turbine inspection completed', 'turbine.specialist@beta.org', 14500.00, 24.0, DATEADD(month, -1, GETUTCDATE())),
  ('A009', 'WO005', 'Preventive', 'Engine borescope inspection - no issues found', 'aircraft.mechanic@beta.org', 8200.00, 8.0, DATEADD(week, -2, GETUTCDATE()));

-- Insert spare parts inventory
INSERT INTO spare_parts (org_id, part_number, name, description, category, current_stock, minimum_stock, unit_cost, supplier, lead_time_days)
VALUES 
  (1, 'BEARING-001', 'Pump Bearing Assembly', 'High-performance bearing for centrifugal pumps', 'Bearings', 15, 5, 245.99, 'Industrial Bearings Inc', 7),
  (2, 'BRAKE-PAD-002', 'Heavy Duty Brake Pad', 'Brake pad for mining haul trucks', 'Brakes', 25, 8, 185.50, 'Mining Equipment Co', 14),
  (3, 'TURBINE-BLADE-003', 'Steam Turbine Blade', 'Replacement blade for steam turbines', 'Turbine Parts', 4, 2, 12500.00, 'Power Generation Parts', 45),
  (1, 'VALVE-004', 'Pressure Relief Valve', 'Safety valve for reactor vessels', 'Valves', 8, 3, 1850.75, 'Safety Systems Ltd', 21),
  (3, 'ENGINE-FILTER-005', 'Aircraft Engine Filter', 'High-efficiency filter for jet engines', 'Filters', 20, 6, 425.00, 'Aerospace Components', 10);

-- Insert sensor readings (sample data for last 7 days)
DECLARE @Counter INT = 0;
DECLARE @ReadingDate DATETIME2;

WHILE @Counter < 168 -- 24 readings per day for 7 days
BEGIN
    SET @ReadingDate = DATEADD(hour, -@Counter, GETUTCDATE());
    
    -- Oil & Gas pump readings
    INSERT INTO sensor_readings (asset_id, sensor_type, value, unit, timestamp, is_anomaly, threshold)
    VALUES 
    ('A001', 'Vibration', 2.5 + (RAND() * 1.5) - 0.75, 'mm/s', @ReadingDate, CASE WHEN RAND() > 0.95 THEN 1 ELSE 0 END, 4.0),
    ('A001', 'Temperature', 65 + (RAND() * 10) - 5, 'C', @ReadingDate, CASE WHEN RAND() > 0.98 THEN 1 ELSE 0 END, 80),
    ('A002', 'Fuel Level', 75 + (RAND() * 20) - 10, '%', @ReadingDate, CASE WHEN RAND() > 0.9 THEN 1 ELSE 0 END, 20);
    
    -- Mining equipment readings
    INSERT INTO sensor_readings (asset_id, sensor_type, value, unit, timestamp, is_anomaly, threshold)
    VALUES 
    ('A003', 'Engine Temperature', 85 + (RAND() * 15) - 7.5, 'C', @ReadingDate, CASE WHEN RAND() > 0.96 THEN 1 ELSE 0 END, 105),
    ('A004', 'Belt Speed', 1.8 + (RAND() * 0.4) - 0.2, 'm/s', @ReadingDate, CASE WHEN RAND() > 0.97 THEN 1 ELSE 0 END, 2.5);
    
    -- Power generation readings
    INSERT INTO sensor_readings (asset_id, sensor_type, value, unit, timestamp, is_anomaly, threshold)
    VALUES 
    ('A005', 'Steam Pressure', 45 + (RAND() * 5) - 2.5, 'bar', @ReadingDate, CASE WHEN RAND() > 0.99 THEN 1 ELSE 0 END, 55),
    ('A006', 'Oil Temperature', 55 + (RAND() * 8) - 4, 'C', @ReadingDate, CASE WHEN RAND() > 0.98 THEN 1 ELSE 0 END, 70);
    
    SET @Counter = @Counter + 1;
END;

-- Insert comprehensive ESG metrics
INSERT INTO esg_metrics (org_id, asset_id, category, metric_name, value, unit, reporting_date, source, is_verified, verification_method)
VALUES 
  -- Environmental metrics
  (1, 'A001', 'Environmental', 'Energy Consumption', 2850.5, 'kWh', DATEADD(month, -1, GETUTCDATE()), 'Smart Meter', 1, 'Automated Reading'),
  (1, 'A002', 'Environmental', 'CO2 Emissions', 1.25, 'tons', DATEADD(month, -1, GETUTCDATE()), 'Emissions Monitor', 1, 'Third Party Verification'),
  (2, 'A003', 'Environmental', 'Fuel Consumption', 15000, 'L', DATEADD(month, -1, GETUTCDATE()), 'Fleet Management System', 1, 'Automated Reading'),
  (3, 'A005', 'Environmental', 'Steam Efficiency', 92.5, '%', DATEADD(month, -1, GETUTCDATE()), 'Performance Monitor', 1, 'Engineering Calculation'),
  (1, 'A007', 'Environmental', 'Waste Heat Recovery', 85.2, '%', DATEADD(month, -1, GETUTCDATE()), 'Heat Exchanger Monitor', 1, 'Automated Reading'),
  
  -- Social metrics
  (1, NULL, 'Social', 'Safety Incidents', 0, 'count', DATEADD(month, -1, GETUTCDATE()), 'Safety Management System', 1, 'Management Review'),
  (2, NULL, 'Social', 'Training Hours Completed', 145, 'hours', DATEADD(month, -1, GETUTCDATE()), 'HR System', 1, 'System Generated'),
  (3, NULL, 'Social', 'Employee Safety Score', 98.2, 'percentage', DATEADD(month, -1, GETUTCDATE()), 'Safety Dashboard', 1, 'Monthly Assessment'),
  (1, NULL, 'Social', 'Diversity Index', 0.75, 'ratio', DATEADD(month, -1, GETUTCDATE()), 'HR Analytics', 1, 'Quarterly Review'),
  
  -- Governance metrics
  (1, NULL, 'Governance', 'Compliance Score', 98.5, 'percentage', DATEADD(month, -1, GETUTCDATE()), 'Compliance System', 1, 'Internal Audit'),
  (2, NULL, 'Governance', 'Maintenance Compliance', 96.8, 'percentage', DATEADD(month, -1, GETUTCDATE()), 'CMMS System', 1, 'Automated Calculation'),
  (3, NULL, 'Governance', 'Risk Management Score', 94.3, 'percentage', DATEADD(month, -1, GETUTCDATE()), 'Risk Management System', 1, 'Monthly Review'),
  (1, NULL, 'Governance', 'Data Quality Index', 97.1, 'percentage', DATEADD(month, -1, GETUTCDATE()), 'Data Quality Monitor', 1, 'Automated Assessment');

-- Insert agent interaction logs
INSERT INTO agent_interactions (org_id, user_id, agent_type, request_data, response_data, execution_time_ms, success, timestamp)
VALUES 
  (1, 1, 'MaintenanceStrategyDevelopmentAgent', '{"industry": "Oil & Gas", "assets": ["A001", "A002"]}', '{"strategy": "Implement condition-based maintenance", "savings": "$50K annually"}', 1250, 1, DATEADD(hour, -2, GETUTCDATE())),
  (2, 2, 'AssetManagementAgent', '{"action": "criticality_analysis", "assets": ["A003", "A004"]}', '{"updated_criticality": [{"A003": 3}, {"A004": 2}]}', 890, 1, DATEADD(hour, -1, GETUTCDATE())),
  (3, 3, 'ReliabilityEngineeringAgent', '{"analysis_type": "failure_prediction", "asset": "A005"}', '{"prediction": "No failures expected in next 6 months", "confidence": 0.94}', 2100, 1, DATEADD(minute, -30, GETUTCDATE())),
  (1, 1, 'ComplianceAuditingAgent', '{"compliance_type": "ISO_55000", "scope": "all_assets"}', '{"compliance_score": 98.5, "recommendations": ["Update asset register"]}', 1750, 1, DATEADD(minute, -15, GETUTCDATE())),
  (2, 2, 'SustainabilityESGAgent', '{"report_type": "monthly", "metrics": ["emissions", "energy"]}', '{"esg_score": 87.3, "improvement_areas": ["Energy efficiency"]}', 1420, 1, DATEADD(minute, -5, GETUTCDATE()));

-- Insert audit logs with blockchain verification
INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent, blockchain_hash, is_blockchain_verified, timestamp)
VALUES 
  (1, 1, 'CREATE', 'WorkOrder', 'WO001', 'Created work order for pump maintenance', '192.168.1.10', 'StiggSyncAI/1.0', 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYnw', 1, DATEADD(hour, -3, GETUTCDATE())),
  (2, 2, 'UPDATE', 'Asset', 'A003', 'Updated asset criticality score', '192.168.1.25', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYnx', 1, DATEADD(hour, -1, GETUTCDATE())),
  (3, 3, 'EXECUTE', 'Agent', 'ReliabilityEngineeringAgent', 'Executed reliability analysis for turbine', '192.168.1.15', 'StiggSyncAI/1.0', 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYny', 1, DATEADD(minute, -30, GETUTCDATE())),
  (1, 1, 'SUBSCRIBE', 'Organization', '1', 'Upgraded to enterprise plan', '192.168.1.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYnz', 1, DATEADD(day, -1, GETUTCDATE()));

-- Insert digital twin data
INSERT INTO digital_twins (asset_id, twin_model, sync_status)
VALUES 
  ('A001', '{"type": "pump", "model": "centrifugal", "parameters": {"flow_rate": 500, "head": 80, "efficiency": 0.85}}', 'Active'),
  ('A005', '{"type": "turbine", "model": "steam", "parameters": {"power_output": 100, "steam_pressure": 45, "efficiency": 0.92}}', 'Active'),
  ('A009', '{"type": "engine", "model": "jet", "parameters": {"thrust": 25000, "fuel_flow": 1200, "temperature": 1500}}', 'Active');

PRINT 'Enhanced seed data insertion completed successfully.';
PRINT 'Database now contains:';
PRINT '- 3 Organizations (DemoOrg, AlphaCorp, BetaIndustries)';
PRINT '- 5 Users across different roles';
PRINT '- 10 Assets across 5 industries';
PRINT '- 5 Work Orders in various states';
PRINT '- 4 Maintenance History Records';
PRINT '- 5 Spare Parts';
PRINT '- 1,176 Sensor Readings (7 days of data)';
PRINT '- 13 ESG Metrics across all categories';
PRINT '- 5 Agent Interaction Logs';
PRINT '- 4 Audit Log Entries with blockchain verification';
PRINT '- 3 Digital Twin Records';