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
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    Name varchar(255) NOT NULL,
    Type varchar(100) NOT NULL,
    SerialNumber varchar(100) UNIQUE NOT NULL,
    Location varchar(255) NOT NULL,
    InstallationDate timestamptz NOT NULL,
    Status varchar(50) NOT NULL DEFAULT 'Active',
    CostCenter DECIMAL(18,2) NOT NULL DEFAULT 0,
    Manufacturer varchar(255) NOT NULL DEFAULT '',
    Model varchar(255) NOT NULL DEFAULT '',
    Specifications text NOT NULL DEFAULT '{}', -- JSON
    CreatedAt timestamptz NOT NULL DEFAULT now(),
    UpdatedAt timestamptz NOT NULL DEFAULT now()
);

-- Work Orders table
CREATE TABLE WorkOrders (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    Title varchar(255) NOT NULL,
    Description text NOT NULL DEFAULT '',
    Type varchar(50) NOT NULL DEFAULT 'Corrective',
    Priority varchar(20) NOT NULL DEFAULT 'Medium',
    Status varchar(50) NOT NULL DEFAULT 'Open',
    AssetId uuid NOT NULL,
    AssignedTo varchar(255) NOT NULL DEFAULT '',
    RequestedDate timestamptz NOT NULL DEFAULT now(),
    ScheduledDate timestamptz NULL,
    CompletedDate timestamptz NULL,
    EstimatedCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    ActualCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    CreatedBy varchar(255) NOT NULL DEFAULT '',
    CreatedAt timestamptz NOT NULL DEFAULT now(),
    UpdatedAt timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Work Order Tasks table
CREATE TABLE WorkOrderTasks (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    WorkOrderId uuid NOT NULL,
    Description text NOT NULL,
    Status varchar(50) NOT NULL DEFAULT 'Pending',
    EstimatedHours INT NOT NULL DEFAULT 0,
    ActualHours INT NOT NULL DEFAULT 0,
    AssignedTo varchar(255) NOT NULL DEFAULT '',
    CompletedDate timestamptz NULL,
    Notes text NOT NULL DEFAULT '',
    FOREIGN KEY (WorkOrderId) REFERENCES WorkOrders(Id) ON DELETE CASCADE
);

-- Maintenance History table
CREATE TABLE MaintenanceHistories (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    AssetId uuid NOT NULL,
    MaintenanceType varchar(100) NOT NULL,
    Date timestamptz NOT NULL,
    Description text NOT NULL,
    PerformedBy varchar(255) NOT NULL,
    Cost DECIMAL(18,2) NOT NULL DEFAULT 0,
    Status varchar(50) NOT NULL DEFAULT 'Completed',
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Spare Parts table
CREATE TABLE SpareParts (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    PartNumber varchar(100) UNIQUE NOT NULL,
    Name varchar(255) NOT NULL,
    Description text NOT NULL DEFAULT '',
    Category varchar(100) NOT NULL DEFAULT 'General',
    CurrentStock INT NOT NULL DEFAULT 0,
    MinimumStock INT NOT NULL DEFAULT 0,
    MaximumStock INT NOT NULL DEFAULT 0,
    UnitCost DECIMAL(18,2) NOT NULL DEFAULT 0,
    Supplier varchar(255) NOT NULL DEFAULT '',
    LeadTimeDays INT NOT NULL DEFAULT 0,
    Location varchar(255) NOT NULL DEFAULT '',
    CompatibleAssets text NOT NULL DEFAULT '[]' -- JSON array of asset IDs
);

-- Sensor Readings table
CREATE TABLE SensorReadings (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    AssetId uuid NOT NULL,
    SensorType varchar(100) NOT NULL,
    Value FLOAT NOT NULL,
    Unit varchar(20) NOT NULL DEFAULT '',
    Timestamp timestamptz NOT NULL DEFAULT now(),
    IsAnomaly boolean NOT NULL DEFAULT false,
    Threshold FLOAT NULL,
    Metadata text NOT NULL DEFAULT '{}', -- JSON
    FOREIGN KEY (AssetId) REFERENCES Assets(Id)
);

-- Agent Interaction Logs table
CREATE TABLE AgentInteractionLogs (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    AgentType varchar(100) NOT NULL,
    RequestId varchar(255) NOT NULL,
    UserId varchar(255) NOT NULL,
    Request text NOT NULL,
    Response text NOT NULL,
    Timestamp timestamptz NOT NULL DEFAULT now(),
    Success boolean NOT NULL DEFAULT true,
    ErrorMessage text NULL
);

-- Audit Logs table with blockchain verification
CREATE TABLE AuditLogs (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    Action varchar(100) NOT NULL,
    EntityType varchar(100) NOT NULL,
    EntityId varchar(255) NOT NULL,
    UserId varchar(255) NOT NULL,
    Changes text NOT NULL,
    Timestamp timestamptz NOT NULL DEFAULT now(),
    IPAddress varchar(45) NOT NULL DEFAULT '',
    UserAgent text NOT NULL DEFAULT '',
    IsBlockchainVerified boolean NOT NULL DEFAULT false,
    BlockchainHash varchar(512) NULL
);

-- ESG Metrics table
CREATE TABLE ESGMetrics (
    Id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    Category varchar(50) NOT NULL, -- Environmental, Social, Governance
    MetricName varchar(255) NOT NULL,
    Value FLOAT NOT NULL,
    Unit varchar(50) NOT NULL DEFAULT '',
    ReportingDate timestamptz NOT NULL,
    AssetId uuid NULL,
    Source varchar(255) NOT NULL DEFAULT '',
    IsVerified boolean NOT NULL DEFAULT false,
    VerificationMethod varchar(255) NOT NULL DEFAULT '',
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
    AVG(CASE WHEN sr.Timestamp >= now() - interval '30 days' THEN sr.Value END) as AvgRecentSensorValue
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
