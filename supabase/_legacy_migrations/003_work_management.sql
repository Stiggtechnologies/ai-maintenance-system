-- SyncAI Work Management Migration
-- Workstream 3: Notifications, Work Requests, Work Orders, Backlog

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- WORK MANAGEMENT DOMAIN
-- ============================================

-- Notifications (intake)
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    source TEXT NOT NULL, -- user, system, integration
    source_id TEXT,
    subject TEXT NOT NULL,
    body TEXT,
    priority TEXT DEFAULT 'routine', -- emergency, urgent, routine
    category TEXT,
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Requests
CREATE TABLE work_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    request_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    requested_by UUID REFERENCES users(id),
    priority TEXT DEFAULT 'routine', -- emergency, urgent, routine, low
    status TEXT DEFAULT 'submitted', -- submitted, validated, rejected, converted
    estimated_hours NUMERIC,
    estimated_cost NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Orders
CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_number TEXT UNIQUE NOT NULL,
    work_request_id UUID REFERENCES work_requests(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    work_type TEXT NOT NULL, -- preventive, corrective, predictive, project, safety
    status TEXT DEFAULT 'draft', -- draft, planned, approved, in_progress, completed, cancelled
    priority TEXT DEFAULT 'routine',
    requested_by UUID REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    estimated_cost NUMERIC,
    actual_cost NUMERIC,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Work Order Tasks
CREATE TABLE work_order_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    sequence_num INTEGER,
    description TEXT NOT NULL,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Order Status History
CREATE TABLE work_order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL,
    changed_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Priorities
CREATE TABLE work_priorities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    priority_level INTEGER NOT NULL, -- 1=highest
    response_time_hours INTEGER,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Failure Codes
CREATE TABLE failure_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT, -- mechanical, electrical, instrumentation,操作, external
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work Closeout Records
CREATE TABLE work_closeout_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    completed_by UUID REFERENCES users(id),
    work_performed TEXT,
    parts_used TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    lessons_learned TEXT,
    signature_data TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backlog Snapshots (for trend analysis)
CREATE TABLE backlog_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    total_work_orders INTEGER,
    total_estimated_hours NUMERIC,
    overdue_work_orders INTEGER,
    overdue_hours NUMERIC,
    snapshot_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_work_requests_org ON work_requests(organization_id);
CREATE INDEX idx_work_requests_status ON work_requests(status);
CREATE INDEX idx_work_requests_asset ON work_requests(asset_id);
CREATE INDEX idx_work_orders_org ON work_orders(organization_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_asset ON work_orders(asset_id);
CREATE INDEX idx_work_orders_scheduled ON work_orders(scheduled_start);
CREATE INDEX idx_work_closeout_work_order ON work_closeout_records(work_order_id);
CREATE INDEX idx_backlog_snapshots_date ON backlog_snapshots(snapshot_date);

-- ============================================
-- SEED DATA: WORK PRIORITIES
-- ============================================

INSERT INTO work_priorities (organization_id, name, priority_level, response_time_hours, color) VALUES
    (NULL, 'Emergency', 1, 1, '#DC2626'),
    (NULL, 'Urgent', 2, 4, '#EA580C'),
    (NULL, 'Routine', 3, 48, '#CA8A04'),
    (NULL, 'Low', 4, 168, '#16A34A')
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: FAILURE CODES
-- ============================================

INSERT INTO failure_codes (organization_id, code, description, category) VALUES
    (NULL, 'M01', 'Bearing failure', 'mechanical'),
    (NULL, 'M02', 'Seal leak', 'mechanical'),
    (NULL, 'M03', 'Gear wear', 'mechanical'),
    (NULL, 'E01', 'Motor winding failure', 'electrical'),
    (NULL, 'E02', 'Control system fault', 'electrical'),
    (NULL, 'E03', 'Power supply failure', 'electrical'),
    (NULL, 'I01', 'Sensor malfunction', 'instrumentation'),
    (NULL, 'I02', 'Transmitter error', 'instrumentation'),
    (NULL, 'O01', 'Operator error', '操作'),
    (NULL, 'X01', 'External damage', 'external')
ON CONFLICT DO NOTHING;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE failure_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_closeout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlog_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_org_isolation" ON notifications FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wr_org_isolation" ON work_requests FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wo_org_isolation" ON work_orders FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wot_org_isolation" ON work_order_tasks FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wosh_org_isolation" ON work_order_status_history FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wp_org_isolation" ON work_priorities FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "fc_org_isolation" ON failure_codes FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "wcr_org_isolation" ON work_closeout_records FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

CREATE POLICY "bs_org_isolation" ON backlog_snapshots FOR ALL USING (
    organization_id = current_setting('app.current_organization_id', true)::uuid
);

-- ============================================
-- FUNCTION: GENERATE WORK ORDER NUMBER
-- ============================================

CREATE OR REPLACE FUNCTION generate_work_order_number(organization_id UUID)
RETURNS TEXT AS $$
DECLARE
    prefix TEXT;
    seq_num INTEGER;
    result TEXT;
BEGIN
    SELECT TO_CHAR(NOW(), 'YY') INTO prefix;
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(wo.work_order_number FROM 4 FOR 8)::INTEGER), 0) + 1
    INTO seq_num
    FROM work_orders wo
    WHERE wo.organization_id = generate_work_order_number.organization_id;
    
    result := 'WO' || LPAD(seq_num::TEXT, 8, '0');
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'SyncAI Work Management Migration Complete' AS status;