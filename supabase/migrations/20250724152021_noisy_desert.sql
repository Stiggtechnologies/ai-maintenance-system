/*
# Seed Data for AI Maintenance System

This file contains sample data to populate the database for development and testing purposes.

## Data Categories:
1. Sample Assets (industrial equipment)
2. Spare Parts inventory
3. Work Orders and Tasks
4. Maintenance History
5. Sensor Readings
6. ESG Metrics
7. Sample Agent Interactions
*/

-- Insert sample assets
INSERT INTO Assets (Id, Name, Type, SerialNumber, Location, InstallationDate, Status, CostCenter, Manufacturer, Model, Specifications)
VALUES 
(NEWID(), 'Compressor Unit A1', 'Critical', 'COMP-A1-2023', 'Plant Floor A', '2023-01-15', 'Active', 1001.00, 'Industrial Systems Inc', 'CS-2000X', '{"maxPressure": 150, "powerRating": "50kW", "operatingTemp": "60C"}'),
(NEWID(), 'Conveyor Belt B2', 'Important', 'CONV-B2-2022', 'Production Line B', '2022-06-10', 'Active', 1002.00, 'Motion Dynamics', 'MD-500B', '{"length": 50, "speed": "2m/s", "capacity": "1000kg"}'),
(NEWID(), 'Pump Station C3', 'Critical', 'PUMP-C3-2021', 'Utility Area C', '2021-11-20', 'Active', 1003.00, 'FluidTech Corp', 'FT-750P', '{"flowRate": "500L/min", "maxHead": "80m", "efficiency": "85%"}'),
(NEWID(), 'Generator Unit D4', 'Critical', 'GEN-D4-2020', 'Power House D', '2020-03-08', 'Active', 1004.00, 'PowerGen Solutions', 'PG-1000G', '{"power": "1000kVA", "fuel": "Diesel", "efficiency": "92%"}'),
(NEWID(), 'HVAC System E5', 'Standard', 'HVAC-E5-2019', 'Building E', '2019-09-14', 'Active', 1005.00, 'Climate Control Co', 'CC-2500H', '{"capacity": "250kW", "zones": 8, "efficiency": "SEER 16"}');

-- Declare variables to hold asset IDs for foreign key references
DECLARE @Asset1 UNIQUEIDENTIFIER, @Asset2 UNIQUEIDENTIFIER, @Asset3 UNIQUEIDENTIFIER, @Asset4 UNIQUEIDENTIFIER, @Asset5 UNIQUEIDENTIFIER;

SELECT @Asset1 = Id FROM Assets WHERE SerialNumber = 'COMP-A1-2023';
SELECT @Asset2 = Id FROM Assets WHERE SerialNumber = 'CONV-B2-2022';
SELECT @Asset3 = Id FROM Assets WHERE SerialNumber = 'PUMP-C3-2021';
SELECT @Asset4 = Id FROM Assets WHERE SerialNumber = 'GEN-D4-2020';
SELECT @Asset5 = Id FROM Assets WHERE SerialNumber = 'HVAC-E5-2019';

-- Insert sample spare parts
INSERT INTO SpareParts (Id, PartNumber, Name, Description, Category, CurrentStock, MinimumStock, MaximumStock, UnitCost, Supplier, LeadTimeDays, Location, CompatibleAssets)
VALUES 
(NEWID(), 'FILTER-001', 'Air Filter High Efficiency', 'HEPA air filter for compressor units', 'Filters', 25, 5, 50, 45.99, 'Filter Specialists Inc', 7, 'Warehouse A-1', '["' + CAST(@Asset1 AS NVARCHAR(36)) + '"]'),
(NEWID(), 'BELT-002', 'Conveyor Drive Belt', 'Heavy duty rubber belt for conveyor systems', 'Belts', 8, 2, 20, 125.50, 'Industrial Belts Co', 14, 'Warehouse B-2', '["' + CAST(@Asset2 AS NVARCHAR(36)) + '"]'),
(NEWID(), 'SEAL-003', 'Pump Mechanical Seal', 'Mechanical seal for centrifugal pumps', 'Seals', 12, 3, 25, 89.75, 'Seal Tech Ltd', 10, 'Warehouse C-1', '["' + CAST(@Asset3 AS NVARCHAR(36)) + '"]'),
(NEWID(), 'PLUG-004', 'Spark Plug Heavy Duty', 'Industrial spark plug for generators', 'Electrical', 30, 10, 60, 12.99, 'Electrical Supply House', 3, 'Warehouse D-1', '["' + CAST(@Asset4 AS NVARCHAR(36)) + '"]'),
(NEWID(), 'COIL-005', 'Evaporator Coil', 'Copper evaporator coil for HVAC systems', 'HVAC Parts', 4, 1, 10, 450.00, 'HVAC Components Inc', 21, 'Warehouse E-1', '["' + CAST(@Asset5 AS NVARCHAR(36)) + '"]');

-- Insert sample work orders
DECLARE @WorkOrder1 UNIQUEIDENTIFIER = NEWID(), @WorkOrder2 UNIQUEIDENTIFIER = NEWID(), @WorkOrder3 UNIQUEIDENTIFIER = NEWID();

INSERT INTO WorkOrders (Id, Title, Description, Type, Priority, Status, AssetId, AssignedTo, RequestedDate, ScheduledDate, EstimatedCost, CreatedBy)
VALUES 
(@WorkOrder1, 'Quarterly Compressor Maintenance', 'Routine quarterly maintenance for compressor unit including filter replacement and oil change', 'Preventive', 'Medium', 'Scheduled', @Asset1, 'maintenance.team@company.com', GETUTCDATE(), DATEADD(day, 7, GETUTCDATE()), 250.00, 'system.scheduler@company.com'),
(@WorkOrder2, 'Conveyor Belt Replacement', 'Replace worn conveyor belt showing signs of cracking', 'Corrective', 'High', 'Open', @Asset2, 'belt.specialist@company.com', GETUTCDATE(), DATEADD(day, 2, GETUTCDATE()), 400.00, 'operator.b2@company.com'),
(@WorkOrder3, 'Pump Seal Inspection', 'Investigate reported leak in pump station seal', 'Corrective', 'High', 'In Progress', @Asset3, 'pump.technician@company.com', DATEADD(day, -1, GETUTCDATE()), GETUTCDATE(), 150.00, 'supervisor.c@company.com');

-- Insert work order tasks
INSERT INTO WorkOrderTasks (Id, WorkOrderId, Description, Status, EstimatedHours, AssignedTo)
VALUES 
(NEWID(), @WorkOrder1, 'Replace air filter', 'Pending', 2, 'technician.a@company.com'),
(NEWID(), @WorkOrder1, 'Change compressor oil', 'Pending', 3, 'technician.a@company.com'),
(NEWID(), @WorkOrder1, 'Check pressure settings', 'Pending', 1, 'technician.a@company.com'),
(NEWID(), @WorkOrder2, 'Remove old belt', 'Pending', 4, 'belt.specialist@company.com'),
(NEWID(), @WorkOrder2, 'Install new belt', 'Pending', 4, 'belt.specialist@company.com'),
(NEWID(), @WorkOrder2, 'Test belt alignment', 'Pending', 2, 'belt.specialist@company.com'),
(NEWID(), @WorkOrder3, 'Inspect seal condition', 'Completed', 2, 'pump.technician@company.com'),
(NEWID(), @WorkOrder3, 'Order replacement seal', 'In Progress', 1, 'pump.technician@company.com');

-- Insert maintenance history
INSERT INTO MaintenanceHistories (Id, AssetId, MaintenanceType, Date, Description, PerformedBy, Cost, Status)
VALUES 
(NEWID(), @Asset1, 'Preventive', DATEADD(month, -3, GETUTCDATE()), 'Quarterly maintenance - filter and oil change completed', 'maintenance.team@company.com', 235.50, 'Completed'),
(NEWID(), @Asset2, 'Corrective', DATEADD(month, -2, GETUTCDATE()), 'Replaced damaged roller bearing', 'belt.specialist@company.com', 180.75, 'Completed'),
(NEWID(), @Asset3, 'Preventive', DATEADD(month, -1, GETUTCDATE()), 'Monthly pump inspection and lubrication', 'pump.technician@company.com', 95.25, 'Completed'),
(NEWID(), @Asset4, 'Corrective', DATEADD(week, -2, GETUTCDATE()), 'Replaced faulty spark plugs', 'generator.tech@company.com', 65.99, 'Completed'),
(NEWID(), @Asset5, 'Preventive', DATEADD(week, -1, GETUTCDATE()), 'HVAC system cleaning and filter replacement', 'hvac.team@company.com', 125.00, 'Completed');

-- Insert sensor readings (last 30 days of sample data)
DECLARE @Counter INT = 0;
DECLARE @ReadingDate DATETIME2;

WHILE @Counter < 720 -- 24 readings per day for 30 days
BEGIN
    SET @ReadingDate = DATEADD(hour, -@Counter, GETUTCDATE());
    
    -- Compressor readings
    INSERT INTO SensorReadings (Id, AssetId, SensorType, Value, Unit, Timestamp, IsAnomaly, Threshold)
    VALUES 
    (NEWID(), @Asset1, 'Pressure', 120 + (RAND() * 20) - 10, 'PSI', @ReadingDate, CASE WHEN RAND() > 0.95 THEN 1 ELSE 0 END, 140),
    (NEWID(), @Asset1, 'Temperature', 55 + (RAND() * 10) - 5, 'C', @ReadingDate, CASE WHEN RAND() > 0.98 THEN 1 ELSE 0 END, 65),
    (NEWID(), @Asset1, 'Vibration', 2.5 + (RAND() * 1) - 0.5, 'mm/s', @ReadingDate, CASE WHEN RAND() > 0.97 THEN 1 ELSE 0 END, 4.0);
    
    -- Conveyor readings
    INSERT INTO SensorReadings (Id, AssetId, SensorType, Value, Unit, Timestamp, IsAnomaly, Threshold)
    VALUES 
    (NEWID(), @Asset2, 'Speed', 1.9 + (RAND() * 0.2) - 0.1, 'm/s', @ReadingDate, CASE WHEN RAND() > 0.96 THEN 1 ELSE 0 END, 2.2),
    (NEWID(), @Asset2, 'Current', 15 + (RAND() * 4) - 2, 'A', @ReadingDate, CASE WHEN RAND() > 0.95 THEN 1 ELSE 0 END, 20);
    
    -- Pump readings
    INSERT INTO SensorReadings (Id, AssetId, SensorType, Value, Unit, Timestamp, IsAnomaly, Threshold)
    VALUES 
    (NEWID(), @Asset3, 'Flow', 480 + (RAND() * 40) - 20, 'L/min', @ReadingDate, CASE WHEN RAND() > 0.94 THEN 1 ELSE 0 END, 520),
    (NEWID(), @Asset3, 'Pressure', 75 + (RAND() * 10) - 5, 'm', @ReadingDate, CASE WHEN RAND() > 0.96 THEN 1 ELSE 0 END, 85);
    
    SET @Counter = @Counter + 1;
END;

-- Insert sample ESG metrics
INSERT INTO ESGMetrics (Id, Category, MetricName, Value, Unit, ReportingDate, AssetId, Source, IsVerified, VerificationMethod)
VALUES 
(NEWID(), 'Environmental', 'Energy Consumption', 2850.5, 'kWh', DATEADD(month, -1, GETUTCDATE()), @Asset1, 'Smart Meter', 1, 'Automated Reading'),
(NEWID(), 'Environmental', 'CO2 Emissions', 1.25, 'tons', DATEADD(month, -1, GETUTCDATE()), @Asset4, 'Emissions Monitor', 1, 'Third Party Verification'),
(NEWID(), 'Environmental', 'Water Usage', 15000, 'L', DATEADD(month, -1, GETUTCDATE()), @Asset3, 'Flow Meter', 1, 'Automated Reading'),
(NEWID(), 'Social', 'Safety Incidents', 0, 'count', DATEADD(month, -1, GETUTCDATE()), NULL, 'Safety Report', 1, 'Management Review'),
(NEWID(), 'Social', 'Training Hours', 45, 'hours', DATEADD(month, -1, GETUTCDATE()), NULL, 'HR System', 1, 'System Generated'),
(NEWID(), 'Governance', 'Compliance Score', 98.5, 'percentage', DATEADD(month, -1, GETUTCDATE()), NULL, 'Audit System', 1, 'Internal Audit'),
(NEWID(), 'Environmental', 'Waste Recycled', 850.2, 'kg', DATEADD(month, -1, GETUTCDATE()), NULL, 'Waste Management', 1, 'Third Party Verification');

-- Insert sample agent interaction logs
INSERT INTO AgentInteractionLogs (Id, AgentType, RequestId, UserId, Request, Response, Timestamp, Success)
VALUES 
(NEWID(), 'preventive-maintenance', 'REQ-001', 'user@company.com', '{"assetId": "' + CAST(@Asset1 AS NVARCHAR(36)) + '", "action": "schedule"}', '{"recommendations": ["Schedule filter replacement", "Check oil levels"], "nextDate": "2024-02-15"}', DATEADD(hour, -2, GETUTCDATE()), 1),
(NEWID(), 'predictive-analytics', 'REQ-002', 'analyst@company.com', '{"assetId": "' + CAST(@Asset2 AS NVARCHAR(36)) + '", "sensorData": true}', '{"prediction": "Belt replacement needed in 15 days", "confidence": 0.87}', DATEADD(hour, -1, GETUTCDATE()), 1),
(NEWID(), 'asset-health', 'REQ-003', 'technician@company.com', '{"assetId": "' + CAST(@Asset3 AS NVARCHAR(36)) + '"}', '{"healthScore": 0.78, "status": "Good", "alerts": ["Monitor seal condition"]}', DATEADD(minute, -30, GETUTCDATE()), 1),
(NEWID(), 'energy-efficiency', 'REQ-004', 'manager@company.com', '{"timeRange": "30days", "assets": "all"}', '{"totalSavings": "$1,250", "recommendations": ["Optimize compressor schedule", "Upgrade pump motor"]}', DATEADD(minute, -15, GETUTCDATE()), 1),
(NEWID(), 'cost-optimization', 'REQ-005', 'finance@company.com', '{"analysis": "maintenance_costs"}', '{"projected_savings": 15000, "optimization_areas": ["Spare parts inventory", "Preventive scheduling"]}', DATEADD(minute, -5, GETUTCDATE()), 1);

-- Insert sample audit logs
INSERT INTO AuditLogs (Id, Action, EntityType, EntityId, UserId, Changes, Timestamp, IPAddress, UserAgent, IsBlockchainVerified, BlockchainHash)
VALUES 
(NEWID(), 'CREATE', 'WorkOrder', CAST(@WorkOrder1 AS NVARCHAR(36)), 'system.scheduler@company.com', '{"title": "Quarterly Compressor Maintenance", "status": "Scheduled"}', DATEADD(hour, -3, GETUTCDATE()), '192.168.1.10', 'StiggSyncAI/1.0', 1, 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYnw'),
(NEWID(), 'UPDATE', 'WorkOrder', CAST(@WorkOrder3 AS NVARCHAR(36)), 'pump.technician@company.com', '{"status": "In Progress"}', DATEADD(hour, -1, GETUTCDATE()), '192.168.1.25', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1, 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYnx'),
(NEWID(), 'CREATE', 'Asset', CAST(@Asset1 AS NVARCHAR(36)), 'admin@company.com', '{"name": "Compressor Unit A1", "status": "Active"}', DATEADD(day, -30, GETUTCDATE()), '192.168.1.5', 'StiggSyncAI/1.0', 1, 'QmNtQKYnwSfFKF5mH5zJ8yYKHqNHzHzQJzHcQmNtQKYny');

-- Create some additional realistic data for testing
-- Add more recent sensor readings for real-time dashboard
INSERT INTO SensorReadings (Id, AssetId, SensorType, Value, Unit, Timestamp, IsAnomaly, Threshold)
VALUES 
-- Recent critical readings
(NEWID(), @Asset1, 'Pressure', 138.5, 'PSI', DATEADD(minute, -5, GETUTCDATE()), 1, 140), -- Near threshold
(NEWID(), @Asset2, 'Vibration', 3.8, 'mm/s', DATEADD(minute, -3, GETUTCDATE()), 1, 4.0), -- Near threshold
(NEWID(), @Asset3, 'Temperature', 85.2, 'C', DATEADD(minute, -2, GETUTCDATE()), 1, 80), -- Over threshold
(NEWID(), @Asset4, 'Fuel Level', 15.5, '%', DATEADD(minute, -1, GETUTCDATE()), 1, 20), -- Low fuel
(NEWID(), @Asset5, 'Filter Pressure', 2.8, 'bar', GETUTCDATE(), 1, 2.5); -- Filter needs replacement

-- Insert some completed work orders for reporting
DECLARE @CompletedWO1 UNIQUEIDENTIFIER = NEWID(), @CompletedWO2 UNIQUEIDENTIFIER = NEWID();

INSERT INTO WorkOrders (Id, Title, Description, Type, Priority, Status, AssetId, AssignedTo, RequestedDate, ScheduledDate, CompletedDate, EstimatedCost, ActualCost, CreatedBy)
VALUES 
(@CompletedWO1, 'Generator Oil Change', 'Routine oil change for backup generator', 'Preventive', 'Low', 'Completed', @Asset4, 'generator.tech@company.com', DATEADD(week, -2, GETUTCDATE()), DATEADD(week, -1, GETUTCDATE()), DATEADD(day, -5, GETUTCDATE()), 120.00, 115.50, 'maintenance.scheduler@company.com'),
(@CompletedWO2, 'HVAC Filter Replacement', 'Replace clogged HVAC filters', 'Preventive', 'Medium', 'Completed', @Asset5, 'hvac.team@company.com', DATEADD(week, -1, GETUTCDATE()), DATEADD(day, -3, GETUTCDATE()), DATEADD(day, -2, GETUTCDATE()), 80.00, 85.25, 'facility.manager@company.com');

-- Add performance metrics for dashboard
INSERT INTO ESGMetrics (Id, Category, MetricName, Value, Unit, ReportingDate, Source, IsVerified, VerificationMethod)
VALUES 
(NEWID(), 'Environmental', 'Energy Efficiency', 92.5, 'percentage', GETUTCDATE(), 'Energy Management System', 1, 'Automated Calculation'),
(NEWID(), 'Social', 'Employee Safety Score', 98.2, 'percentage', GETUTCDATE(), 'Safety Management System', 1, 'Monthly Review'),
(NEWID(), 'Governance', 'Maintenance Compliance', 96.8, 'percentage', GETUTCDATE(), 'Compliance Tracker', 1, 'Automated Audit'),
(NEWID(), 'Environmental', 'Waste Reduction', 12.5, 'percentage', GETUTCDATE(), 'Waste Tracking System', 1, 'Monthly Report');

PRINT 'Seed data insertion completed successfully.';
PRINT 'Database now contains:';
PRINT '- 5 Sample Assets';
PRINT '- 5 Spare Parts';
PRINT '- 5 Work Orders (3 active, 2 completed)';
PRINT '- 8 Work Order Tasks';
PRINT '- 5 Maintenance History Records';
PRINT '- 2,160+ Sensor Readings (30 days of data)';
PRINT '- 11 ESG Metrics';
PRINT '- 5 Agent Interaction Logs';
PRINT '- 3 Audit Log Entries';