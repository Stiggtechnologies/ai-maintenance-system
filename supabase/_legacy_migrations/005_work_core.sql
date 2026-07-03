-- SyncAI MVP - Work Core Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- G. WORK DOMAIN
-- ============================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    source_type TEXT,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'routine',
    status TEXT DEFAULT 'open',
    reported_at TIMESTAMPTZ DEFAULT NOW(),
    reported_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE work_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
    request_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    work_type TEXT,
    priority TEXT DEFAULT 'routine',
    status TEXT DEFAULT 'submitted',
    requested_by UUID REFERENCES user_profiles(id),
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, request_number)
);

CREATE TABLE work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    work_request_id UUID REFERENCES work_requests(id) ON DELETE SET NULL,
    work_order_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    work_type TEXT NOT NULL,
    priority TEXT DEFAULT 'routine',
    status TEXT DEFAULT 'draft',
    planned_start TIMESTAMPTZ,
    planned_finish TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_finish TIMESTAMPTZ,
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    required_approval BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, work_order_number)
);

CREATE TABLE work_order_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID REFERENCES user_profiles(id),
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    comments TEXT
);

CREATE TABLE work_priorities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    rank INTEGER NOT NULL,
    response_target_hours NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, code)
);

CREATE TABLE work_closeout_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE UNIQUE NOT NULL,
    completion_summary TEXT,
    failure_code TEXT,
    cause_code TEXT,
    remedy_code TEXT,
    lessons_learned TEXT,
    closed_by UUID REFERENCES user_profiles(id),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE backlog_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    snapshot_time TIMESTAMPTZ DEFAULT NOW(),
    open_work_order_count INTEGER DEFAULT 0,
    overdue_count INTEGER DEFAULT 0,
    backlog_hours NUMERIC DEFAULT 0,
    critical_backlog_hours NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INDEXES
CREATE INDEX idx_notifications_org ON notifications(organization_id);
CREATE INDEX idx_notifications_site ON notifications(site_id);
CREATE INDEX idx_work_requests_org ON work_requests(organization_id);
CREATE INDEX idx_work_requests_status ON work_requests(status);
CREATE INDEX idx_work_requests_asset ON work_requests(asset_id);
CREATE INDEX idx_work_orders_org ON work_orders(organization_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_asset ON work_orders(asset_id);
CREATE INDEX idx_work_orders_scheduled ON work_orders(planned_start);
CREATE INDEX idx_wo_status_history_wo ON work_order_status_history(work_order_id);
CREATE INDEX idx_backlog_snapshots_time ON backlog_snapshots(snapshot_time);

-- SEED: WORK PRIORITIES
INSERT INTO work_priorities (organization_id, code, name, rank, response_target_hours) VALUES
    (NULL, 'emergency', 'Emergency', 1, 1),
    (NULL, 'urgent', 'Urgent', 2, 4),
    (NULL, 'routine', 'Routine', 3, 48),
    (NULL, 'low', 'Low', 4, 168)
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_closeout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE backlog_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select" ON notifications FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "wr_select" ON work_requests FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "wo_select" ON work_orders FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "wo_insert" ON work_orders FOR INSERT WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "wo_update" ON work_orders FOR UPDATE USING (organization_id = current_user_org_id());
CREATE POLICY "wosh_select" ON work_order_status_history FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "wp_select" ON work_priorities FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "wcr_select" ON work_closeout_records FOR SELECT USING (organization_id = current_user_org_id());
CREATE POLICY "bs_select" ON backlog_snapshots FOR SELECT USING (organization_id = current_user_org_id());

-- Work order number generator
CREATE OR REPLACE FUNCTION generate_work_order_number(org_id UUID) RETURNS TEXT AS $$
DECLARE
    prefix TEXT;
    seq_num INTEGER;
BEGIN
    prefix := TO_CHAR(NOW(), 'YY') || 'WO';
    SELECT COALESCE(MAX(CAST(SUBSTRING(wo.work_order_number FROM 4 FOR 8)::INTEGER), 0) + 1
    INTO seq_num
    FROM work_orders wo
    WHERE wo.organization_id = org_id;
    RETURN prefix || LPAD(seq_num::TEXT, 8, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'Work Core Migration Complete' AS status;