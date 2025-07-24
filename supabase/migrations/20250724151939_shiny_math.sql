/*
# AI Maintenance System Database Schema

This file contains the complete database schema for the StiggSyncAI maintenance and reliability system.

## Tables Created:
1. Assets - Physical assets being maintained
2. WorkOrders - Maintenance work orders
3. WorkOrderTasks - Individual tasks within work orders
4. MaintenanceHistories - Historical maintenance records
5. SpareParts - Inventory of spare parts
6. SensorReadings - IoT sensor data from assets
7. AgentInteractionLogs - AI agent interaction logs
8. AuditLogs - System audit trail with blockchain verification
9. ESGMetrics - Environmental, Social, Governance metrics

## Security Features:
- All tables include audit fields (CreatedAt, UpdatedAt)
- Blockchain hash verification for audit logs
- Comprehensive indexing for performance
- Foreign key relationships for data integrity
*/

-- Assets table
CREATE TABLE Assets (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Name NVARCHAR(255) NOT NULL,
    Type NVARCHAR(100) NOT NULL,
    SerialNumber NVARCHAR(100) UNIQUE NOT NULL,
    Location NVARCHAR(255) NOT NULL,
    InstallationDate DATETIME2 NOT NULL,
    Status NVARCHAR(50) NOT NULL DEFAULT 'Active',
    CostCenter DECIMAL(18,2) NOT NULL DEFAULT 0,
    Manufacturer NVARCHAR(255) NOT NULL DEFAULT '',
    Model NVARCHAR(255) NOT NULL DEFAULT '',
    Specifications NVARCHAR(MAX) NOT NULL DEFAULT '{}', -- JSON
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

-- Work Orders table
CREATE TABLE WorkOrders (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Title NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NOT NULL DEFAULT '',
    Type NVARCHAR(50) NOT NULL DEFAULT 'Corrective',
    Priority NVARCHAR(20) NOT NULL DEFAULT 'Medium',
    Status NVARCHAR(50) NOT NULL DEFAULT 'Open',
    AssetId UNIQUEIDENTIFIER NOT NULL,
    AssignedTo NVARCHAR(255) NOT NULL DEFAULT '',
    RequestedDate DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    ScheduledDate DATETIME2 NULL,
    CompletedDate DATETIME2 NULL,
    EstimatedCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    ActualCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    CreatedBy NVARCHAR(255) NOT NULL DEFAULT '',
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Work Order Tasks table
CREATE TABLE WorkOrderTasks (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    WorkOrderId UNIQUEIDENTIFIER NOT NULL,
    Description NVARCHAR(MAX) NOT NULL,
    Status NVARCHAR(50) NOT NULL DEFAULT 'Pending',
    EstimatedHours INT NOT NULL DEFAULT 0,
    ActualHours INT NOT NULL DEFAULT 0,
    AssignedTo NVARCHAR(255) NOT NULL DEFAULT '',
    CompletedDate DATETIME2 NULL,
    Notes NVARCHAR(MAX) NOT NULL DEFAULT '',
    FOREIGN KEY (WorkOrderId) REFERENCES WorkOrders(Id) ON DELETE CASCADE
);

-- Maintenance History table
CREATE TABLE MaintenanceHistories (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    AssetId UNIQUEIDENTIFIER NOT NULL,
    MaintenanceType NVARCHAR(100) NOT NULL,
    Date DATETIME2 NOT NULL,
    Description NVARCHAR(MAX) NOT NULL,
    PerformedBy NVARCHAR(255) NOT NULL,
    Cost DECIMAL(18,2) NOT NULL DEFAULT 0,
    Status NVARCHAR(50) NOT NULL DEFAULT 'Completed',
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Spare Parts table
CREATE TABLE SpareParts (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    PartNumber NVARCHAR(100) UNIQUE NOT NULL,
    Name NVARCHAR(255) NOT NULL,
    Description NVARCHAR(MAX) NOT NULL DEFAULT '',
    Category NVARCHAR(100) NOT NULL DEFAULT 'General',
    CurrentStock INT NOT NULL DEFAULT 0,
    MinimumStock INT NOT NULL DEFAULT 0,
    MaximumStock INT NOT NULL DEFAULT 0,
    UnitCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    Supplier NVARCHAR(255) NOT NULL DEFAULT '',
    LeadTimeDays INT NOT NULL DEFAULT 0,
    Location NVARCHAR(255) NOT NULL DEFAULT '',
    CompatibleAssets NVARCHAR(MAX) NOT NULL DEFAULT '[]' -- JSON array of asset IDs
);

-- Sensor Readings table
CREATE TABLE SensorReadings (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    AssetId UNIQUEIDENTIFIER NOT NULL,
    SensorType NVARCHAR(100) NOT NULL,
    Value FLOAT NOT NULL,
    Unit NVARCHAR(20) NOT NULL DEFAULT '',
    Timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    IsAnomaly BIT NOT NULL DEFAULT 0,
    Threshold FLOAT NULL,
    Metadata NVARCHAR(MAX) NOT NULL DEFAULT '{}', -- JSON
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Agent Interaction Logs table
CREATE TABLE AgentInteractionLogs (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    AgentType NVARCHAR(100) NOT NULL,
    RequestId NVARCHAR(255) NOT NULL,
    UserId NVARCHAR(255) NOT NULL,
    Request NVARCHAR(MAX) NOT NULL,
    Response NVARCHAR(MAX) NOT NULL,
    Timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    Success BIT NOT NULL DEFAULT 1,
    ErrorMessage NVARCHAR(MAX) NULL
);

-- Audit Logs table with blockchain verification
CREATE TABLE AuditLogs (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Action NVARCHAR(100) NOT NULL,
    EntityType NVARCHAR(100) NOT NULL,
    EntityId NVARCHAR(255) NOT NULL,
    UserId NVARCHAR(255) NOT NULL,
    Changes NVARCHAR(MAX) NOT NULL,
    Timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    IPAddress NVARCHAR(45) NOT NULL DEFAULT '',
    UserAgent NVARCHAR(MAX) NOT NULL DEFAULT '',
    IsBlockchainVerified BIT NOT NULL DEFAULT 0,
    BlockchainHash NVARCHAR(512) NULL
);

-- ESG Metrics table
CREATE TABLE ESGMetrics (
    Id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    Category NVARCHAR(50) NOT NULL, -- Environmental, Social, Governance
    MetricName NVARCHAR(255) NOT NULL,
    Value FLOAT NOT NULL,
    Unit NVARCHAR(50) NOT NULL DEFAULT '',
    ReportingDate DATETIME2 NOT NULL,
    AssetId UNIQUEIDENTIFIER NULL,
    Source NVARCHAR(255) NOT NULL DEFAULT '',
    IsVerified BIT NOT NULL DEFAULT 0,
    VerificationMethod NVARCHAR(255) NOT NULL DEFAULT '',
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Create indexes for performance optimization
CREATE INDEX IX_Assets_Status ON Assets(Status);
CREATE INDEX IX_Assets_Type ON Assets(Type);
CREATE INDEX IX_Assets_Location ON Assets(Location);

CREATE INDEX IX_WorkOrders_Status ON WorkOrders(Status);
CREATE INDEX IX_WorkOrders_AssetId ON WorkOrders(AssetId);
CREATE INDEX IX_WorkOrders_Priority ON WorkOrders(Priority);
CREATE INDEX IX_WorkOrders_AssignedTo ON WorkOrders(AssignedTo);
CREATE INDEX IX_WorkOrders_RequestedDate ON WorkOrders(RequestedDate);

CREATE INDEX IX_WorkOrderTasks_WorkOrderId ON WorkOrderTasks(WorkOrderId);
CREATE INDEX IX_WorkOrderTasks_Status ON WorkOrderTasks(Status);

CREATE INDEX IX_MaintenanceHistories_AssetId ON MaintenanceHistories(AssetId);
CREATE INDEX IX_MaintenanceHistories_Date ON MaintenanceHistories(Date);
CREATE INDEX IX_MaintenanceHistories_MaintenanceType ON MaintenanceHistories(MaintenanceType);

CREATE INDEX IX_SpareParts_Category ON SpareParts(Category);
CREATE INDEX IX_SpareParts_CurrentStock ON SpareParts(CurrentStock);

CREATE INDEX IX_SensorReadings_AssetId_Timestamp ON SensorReadings(AssetId, Timestamp);
CREATE INDEX IX_SensorReadings_SensorType ON SensorReadings(SensorType);
CREATE INDEX IX_SensorReadings_IsAnomaly ON SensorReadings(IsAnomaly);

CREATE INDEX IX_AgentInteractionLogs_AgentType ON AgentInteractionLogs(AgentType);
CREATE INDEX IX_AgentInteractionLogs_UserId ON AgentInteractionLogs(UserId);
CREATE INDEX IX_AgentInteractionLogs_Timestamp ON AgentInteractionLogs(Timestamp);

CREATE INDEX IX_AuditLogs_Timestamp ON AuditLogs(Timestamp);
CREATE INDEX IX_AuditLogs_UserId ON AuditLogs(UserId);
CREATE INDEX IX_AuditLogs_EntityType ON AuditLogs(EntityType);

CREATE INDEX IX_ESGMetrics_Category ON ESGMetrics(Category);
CREATE INDEX IX_ESGMetrics_ReportingDate ON ESGMetrics(ReportingDate);
CREATE INDEX IX_ESGMetrics_AssetId ON ESGMetrics(AssetId);

-- Create views for common queries
CREATE VIEW vw_AssetSummary AS
SELECT 
    a.Id,
    a.Name,
    a.Type,
    a.Status,
    a.Location,
    COUNT(DISTINCT wo.Id) as TotalWorkOrders,
    COUNT(DISTINCT CASE WHEN wo.Status = 'Open' THEN wo.Id END) as OpenWorkOrders,
    COUNT(DISTINCT mh.Id) as MaintenanceCount,
    MAX(mh.Date) as LastMaintenanceDate,
    AVG(CASE WHEN sr.Timestamp >= DATEADD(day, -30, GETUTCDATE()) THEN sr.Value END) as AvgRecentSensorValue
FROM Assets a
LEFT JOIN WorkOrders wo ON a.Id = wo.AssetId
LEFT JOIN MaintenanceHistories mh ON a.Id = mh.AssetId
LEFT JOIN SensorReadings sr ON a.Id = sr.AssetId
GROUP BY a.Id, a.Name, a.Type, a.Status, a.Location;

CREATE VIEW vw_WorkOrderSummary AS
SELECT 
    wo.Id,
    wo.Title,
    wo.Type,
    wo.Priority,
    wo.Status,
    a.Name as AssetName,
    wo.AssignedTo,
    wo.RequestedDate,
    wo.ScheduledDate,
    wo.EstimatedCost,
    wo.ActualCost,
    COUNT(wot.Id) as TaskCount,
    COUNT(CASE WHEN wot.Status = 'Completed' THEN wot.Id END) as CompletedTasks
FROM WorkOrders wo
INNER JOIN Assets a ON wo.AssetId = a.Id
LEFT JOIN WorkOrderTasks wot ON wo.Id = wot.WorkOrderId
GROUP BY wo.Id, wo.Title, wo.Type, wo.Priority, wo.Status, a.Name, 
         wo.AssignedTo, wo.RequestedDate, wo.ScheduledDate, wo.EstimatedCost, wo.ActualCost;

-- Create stored procedures for common operations
CREATE PROCEDURE sp_GetAssetHealth
    @AssetId UNIQUEIDENTIFIER
AS
BEGIN
    SELECT 
        a.Id,
        a.Name,
        a.Status,
        COUNT(DISTINCT wo.Id) as TotalWorkOrders,
        COUNT(DISTINCT CASE WHEN wo.Status = 'Open' THEN wo.Id END) as OpenWorkOrders,
        COUNT(DISTINCT CASE WHEN sr.IsAnomaly = 1 AND sr.Timestamp >= DATEADD(day, -7, GETUTCDATE()) THEN sr.Id END) as RecentAnomalies,
        AVG(CASE WHEN sr.Timestamp >= DATEADD(day, -30, GETUTCDATE()) THEN sr.Value END) as AvgRecentValue,
        MAX(mh.Date) as LastMaintenanceDate,
        DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) as DaysSinceLastMaintenance
    FROM Assets a
    LEFT JOIN WorkOrders wo ON a.Id = wo.AssetId
    LEFT JOIN SensorReadings sr ON a.Id = sr.AssetId
    LEFT JOIN MaintenanceHistories mh ON a.Id = mh.AssetId
    WHERE a.Id = @AssetId
    GROUP BY a.Id, a.Name, a.Status;
END;

CREATE PROCEDURE sp_GenerateMaintenanceSchedule
    @Days INT = 30
AS
BEGIN
    SELECT 
        a.Id as AssetId,
        a.Name as AssetName,
        a.Type,
        a.Location,
        MAX(mh.Date) as LastMaintenanceDate,
        DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) as DaysSinceLastMaintenance,
        CASE 
            WHEN a.Type = 'Critical' AND DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) > 30 THEN 'High'
            WHEN a.Type = 'Important' AND DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) > 60 THEN 'Medium'
            WHEN DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) > 90 THEN 'Low'
            ELSE 'Normal'
        END as MaintenancePriority
    FROM Assets a
    LEFT JOIN MaintenanceHistories mh ON a.Id = mh.AssetId
    WHERE a.Status = 'Active'
    GROUP BY a.Id, a.Name, a.Type, a.Location
    HAVING MAX(mh.Date) IS NULL OR DATEDIFF(day, MAX(mh.Date), GETUTCDATE()) > @Days
    ORDER BY DaysSinceLastMaintenance DESC;
END;