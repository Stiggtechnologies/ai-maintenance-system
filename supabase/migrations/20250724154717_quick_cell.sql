-- StiggSync AI Database Schema (Enhanced with ESG and Audit Data)

CREATE TABLE organizations (
    org_id INT IDENTITY(1,1) PRIMARY KEY,
    org_name NVARCHAR(100) NOT NULL UNIQUE,
    max_concurrent_users INT DEFAULT 1,
    max_seats INT DEFAULT 1,
    license_type NVARCHAR(20) NOT NULL CHECK (license_type IN ('concurrent', 'per_seat')) DEFAULT 'concurrent',
    stripe_customer_id NVARCHAR(100),
    subscription_plan NVARCHAR(20) DEFAULT 'freemium',
    billing_cycle NVARCHAR(20),
    asset_management_policy NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETUTCDATE(),
    updated_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE users (
    user_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    username NVARCHAR(50) NOT NULL UNIQUE,
    email NVARCHAR(100) NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    role NVARCHAR(20) NOT NULL CHECK (role IN ('admin', 'technician', 'viewer')) DEFAULT 'viewer',
    is_active BIT DEFAULT 1,
    token NVARCHAR(255),
    created_at DATETIME DEFAULT GETUTCDATE(),
    updated_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE sessions (
    session_id INT IDENTITY(1,1) PRIMARY KEY,
    user_id INT FOREIGN KEY REFERENCES users(user_id),
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    token NVARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE licenses (
    license_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    user_id INT FOREIGN KEY REFERENCES users(user_id),
    seat_allocated BIT DEFAULT 0,
    allocated_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE assets (
    asset_id NVARCHAR(50) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    name NVARCHAR(100) NOT NULL,
    industry NVARCHAR(50) DEFAULT 'General',
    operational_impact FLOAT DEFAULT 0.5,
    safety_risk FLOAT DEFAULT 0.5,
    replacement_cost FLOAT DEFAULT 0,
    failure_frequency FLOAT DEFAULT 0.1,
    diagnostic_coverage FLOAT DEFAULT 0.8,
    historical_criticality INT DEFAULT 1,
    fmea_score FLOAT DEFAULT 50.0,
    criticality_score INT DEFAULT 1,
    lifecycle_stage NVARCHAR(50) DEFAULT 'Operation',
    asset_management_plan NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETUTCDATE(),
    updated_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE work_orders (
    work_order_id NVARCHAR(50) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    asset_id NVARCHAR(50) FOREIGN KEY REFERENCES assets(asset_id),
    description NVARCHAR(MAX) NOT NULL,
    priority NVARCHAR(20) DEFAULT 'Medium',
    maintenance_type NVARCHAR(20) DEFAULT 'corrective',
    assigned_technician NVARCHAR(50),
    status NVARCHAR(20) DEFAULT 'Open',
    estimated_cost DECIMAL(18,2) DEFAULT 0,
    actual_cost DECIMAL(18,2) DEFAULT 0,
    created_at DATETIME DEFAULT GETUTCDATE(),
    updated_at DATETIME DEFAULT GETUTCDATE(),
    completed_at DATETIME NULL
);

CREATE TABLE maintenance_history (
    history_id INT IDENTITY(1,1) PRIMARY KEY,
    asset_id NVARCHAR(50) FOREIGN KEY REFERENCES assets(asset_id),
    work_order_id NVARCHAR(50) FOREIGN KEY REFERENCES work_orders(work_order_id),
    maintenance_type NVARCHAR(50) NOT NULL,
    description NVARCHAR(MAX),
    performed_by NVARCHAR(100),
    cost DECIMAL(18,2) DEFAULT 0,
    downtime_hours FLOAT DEFAULT 0,
    performed_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE spare_parts (
    part_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    part_number NVARCHAR(100) UNIQUE NOT NULL,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX),
    category NVARCHAR(100) DEFAULT 'General',
    current_stock INT DEFAULT 0,
    minimum_stock INT DEFAULT 0,
    unit_cost DECIMAL(18,2) DEFAULT 0,
    supplier NVARCHAR(255),
    lead_time_days INT DEFAULT 0,
    created_at DATETIME DEFAULT GETUTCDATE(),
    updated_at DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE sensor_readings (
    reading_id INT IDENTITY(1,1) PRIMARY KEY,
    asset_id NVARCHAR(50) FOREIGN KEY REFERENCES assets(asset_id),
    sensor_type NVARCHAR(100) NOT NULL,
    value FLOAT NOT NULL,
    unit NVARCHAR(20) DEFAULT '',
    timestamp DATETIME DEFAULT GETUTCDATE(),
    is_anomaly BIT DEFAULT 0,
    threshold FLOAT NULL,
    metadata NVARCHAR(MAX) DEFAULT '{}'
);

CREATE TABLE audit_logs (
    log_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    user_id INT FOREIGN KEY REFERENCES users(user_id) NULL,
    action NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(100),
    entity_id NVARCHAR(255),
    details NVARCHAR(MAX),
    ip_address NVARCHAR(45),
    user_agent NVARCHAR(MAX),
    timestamp DATETIME DEFAULT GETUTCDATE(),
    blockchain_hash NVARCHAR(512),
    is_blockchain_verified BIT DEFAULT 0
);

CREATE TABLE esg_metrics (
    metric_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    asset_id NVARCHAR(50) FOREIGN KEY REFERENCES assets(asset_id) NULL,
    category NVARCHAR(50) NOT NULL CHECK (category IN ('Environmental', 'Social', 'Governance')),
    metric_name NVARCHAR(255) NOT NULL,
    emission_type NVARCHAR(50), -- For backward compatibility
    emission_value FLOAT, -- For backward compatibility
    value FLOAT NOT NULL,
    unit NVARCHAR(50) DEFAULT '',
    reporting_date DATETIME DEFAULT GETUTCDATE(),
    source NVARCHAR(255) DEFAULT 'Manual',
    is_verified BIT DEFAULT 0,
    verification_method NVARCHAR(255),
    timestamp DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE agent_interactions (
    interaction_id INT IDENTITY(1,1) PRIMARY KEY,
    org_id INT FOREIGN KEY REFERENCES organizations(org_id),
    user_id INT FOREIGN KEY REFERENCES users(user_id) NULL,
    agent_type NVARCHAR(100) NOT NULL,
    request_data NVARCHAR(MAX),
    response_data NVARCHAR(MAX),
    execution_time_ms INT DEFAULT 0,
    success BIT DEFAULT 1,
    error_message NVARCHAR(MAX),
    timestamp DATETIME DEFAULT GETUTCDATE()
);

CREATE TABLE digital_twins (
    twin_id INT IDENTITY(1,1) PRIMARY KEY,
    asset_id NVARCHAR(50) FOREIGN KEY REFERENCES assets(asset_id),
    twin_model NVARCHAR(MAX), -- JSON representation
    last_sync DATETIME DEFAULT GETUTCDATE(),
    sync_status NVARCHAR(50) DEFAULT 'Active',
    created_at DATETIME DEFAULT GETUTCDATE()
);

-- Indexes for performance optimization
CREATE INDEX idx_organizations_org_id ON organizations (org_id);
CREATE INDEX idx_users_org_id ON users (org_id);
CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_assets_org_id ON assets (org_id);
CREATE INDEX idx_assets_industry ON assets (industry);
CREATE INDEX idx_work_orders_org_id ON work_orders (org_id);
CREATE INDEX idx_work_orders_status ON work_orders (status);
CREATE INDEX idx_work_orders_priority ON work_orders (priority);
CREATE INDEX idx_maintenance_history_asset_id ON maintenance_history (asset_id);
CREATE INDEX idx_sensor_readings_asset_id ON sensor_readings (asset_id);
CREATE INDEX idx_sensor_readings_timestamp ON sensor_readings (timestamp);
CREATE INDEX idx_audit_logs_org_id ON audit_logs (org_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs (timestamp);
CREATE INDEX idx_esg_metrics_org_id ON esg_metrics (org_id);
CREATE INDEX idx_esg_metrics_category ON esg_metrics (category);
CREATE INDEX idx_agent_interactions_org_id ON agent_interactions (org_id);
CREATE INDEX idx_agent_interactions_agent_type ON agent_interactions (agent_type);

-- Views for common queries
CREATE VIEW vw_asset_health AS
SELECT 
    a.asset_id,
    a.name,
    a.industry,
    a.criticality_score,
    COUNT(DISTINCT wo.work_order_id) as total_work_orders,
    COUNT(DISTINCT CASE WHEN wo.status = 'Open' THEN wo.work_order_id END) as open_work_orders,
    MAX(mh.performed_at) as last_maintenance,
    AVG(CASE WHEN sr.timestamp >= DATEADD(day, -30, GETUTCDATE()) THEN sr.value END) as avg_recent_sensor_value
FROM assets a
LEFT JOIN work_orders wo ON a.asset_id = wo.asset_id
LEFT JOIN maintenance_history mh ON a.asset_id = mh.asset_id
LEFT JOIN sensor_readings sr ON a.asset_id = sr.asset_id
GROUP BY a.asset_id, a.name, a.industry, a.criticality_score;

CREATE VIEW vw_esg_summary AS
SELECT 
    org_id,
    category,
    COUNT(*) as metric_count,
    AVG(value) as avg_value,
    SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count,
    MAX(reporting_date) as latest_report
FROM esg_metrics
GROUP BY org_id, category;

-- Stored procedures for common operations
CREATE PROCEDURE sp_GetOrganizationMetrics
    @OrgId INT
AS
BEGIN
    SELECT 
        o.org_name,
        o.subscription_plan,
        COUNT(DISTINCT u.user_id) as total_users,
        COUNT(DISTINCT a.asset_id) as total_assets,
        COUNT(DISTINCT wo.work_order_id) as total_work_orders,
        COUNT(DISTINCT CASE WHEN wo.status = 'Open' THEN wo.work_order_id END) as open_work_orders,
        AVG(a.criticality_score) as avg_asset_criticality
    FROM organizations o
    LEFT JOIN users u ON o.org_id = u.org_id AND u.is_active = 1
    LEFT JOIN assets a ON o.org_id = a.org_id
    LEFT JOIN work_orders wo ON o.org_id = wo.org_id
    WHERE o.org_id = @OrgId
    GROUP BY o.org_name, o.subscription_plan;
END;

CREATE PROCEDURE sp_GenerateMaintenanceSchedule
    @OrgId INT,
    @Days INT = 30
AS
BEGIN
    SELECT 
        a.asset_id,
        a.name,
        a.industry,
        a.criticality_score,
        MAX(mh.performed_at) as last_maintenance,
        DATEDIFF(day, MAX(mh.performed_at), GETUTCDATE()) as days_since_maintenance,
        CASE 
            WHEN a.criticality_score >= 3 AND DATEDIFF(day, MAX(mh.performed_at), GETUTCDATE()) > 30 THEN 'High'
            WHEN a.criticality_score >= 2 AND DATEDIFF(day, MAX(mh.performed_at), GETUTCDATE()) > 60 THEN 'Medium'
            WHEN DATEDIFF(day, MAX(mh.performed_at), GETUTCDATE()) > 90 THEN 'Low'
            ELSE 'Normal'
        END as maintenance_priority
    FROM assets a
    LEFT JOIN maintenance_history mh ON a.asset_id = mh.asset_id
    WHERE a.org_id = @OrgId
    GROUP BY a.asset_id, a.name, a.industry, a.criticality_score
    HAVING MAX(mh.performed_at) IS NULL OR DATEDIFF(day, MAX(mh.performed_at), GETUTCDATE()) > @Days
    ORDER BY days_since_maintenance DESC;
END;