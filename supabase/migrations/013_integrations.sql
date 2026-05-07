-- =====================================================================
-- 013: Integrations (catalog + org-scoped instances)
-- =====================================================================
-- Replaces the hardcoded mock array in IntegrationsDashboard.tsx with a
-- real DB-backed integration system that supports:
--   - Global catalog of integration types (vendor x product combos)
--   - Per-org integration instances with encrypted credentials (pgcrypto)
--   - Audit trail of connect / test / disconnect events
--   - Real round-trip testing for integrations with `has_test_endpoint`
--
-- Architecture:
--   integration_catalog  ─── (global)              26 vendors seeded
--   integrations         ─── (per organization)    instances of catalog items
--   integration_events   ─── (per integration)     audit / activity log
--
-- Encryption:
--   Credentials are encrypted with pgcrypto's pgp_sym_encrypt using a
--   per-database secret stored in `app.integration_encryption_key`.
--
--   REQUIRED ONE-TIME SETUP (post-deploy):
--     ALTER DATABASE postgres SET app.integration_encryption_key
--       = '<32+ char random secret>';
--
--   Without this, integration_create_connected() fails-closed. This is
--   intentional — never silently store credentials in plaintext.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- TABLES
-- =====================================================================

CREATE TABLE IF NOT EXISTS integration_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    vendor TEXT NOT NULL,
    product TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    auth_type TEXT NOT NULL CHECK (auth_type IN ('api_key','oauth2','connection_string','ssh_keys','none')),
    credentials_schema JSONB DEFAULT '{}',  -- JSON Schema for required credential fields
    docs_url TEXT,
    logo_url TEXT,
    has_test_endpoint BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    catalog_code TEXT NOT NULL REFERENCES integration_catalog(code),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected'
      CHECK (status IN ('disconnected','connecting','connected','syncing','error')),
    health NUMERIC DEFAULT 0 CHECK (health >= 0 AND health <= 100),
    credentials_encrypted BYTEA,
    config JSONB DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    last_test_at TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL
      CHECK (event_type IN ('connect_attempt','connect_success','connect_failure',
                            'test_success','test_failure',
                            'disconnect','sync_start','sync_complete','sync_error')),
    details JSONB DEFAULT '{}',
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);
CREATE INDEX IF NOT EXISTS idx_integrations_catalog ON integrations(catalog_code);
CREATE INDEX IF NOT EXISTS idx_integration_catalog_active_sort ON integration_catalog(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_integration_events_org_time ON integration_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_events_integration ON integration_events(integration_id, created_at DESC);

-- =====================================================================
-- ENCRYPTION HELPERS  (key from app.integration_encryption_key)
-- =====================================================================

CREATE OR REPLACE FUNCTION integration_encrypt_credentials(creds JSONB)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    key TEXT;
BEGIN
    IF creds IS NULL THEN RETURN NULL; END IF;
    key := current_setting('app.integration_encryption_key', true);
    IF key IS NULL OR key = '' THEN
        RAISE EXCEPTION 'app.integration_encryption_key is not set. One-time setup: ALTER DATABASE postgres SET app.integration_encryption_key = ''<32+ char secret>''';
    END IF;
    IF length(key) < 16 THEN
        RAISE EXCEPTION 'app.integration_encryption_key is too short (min 16 chars)';
    END IF;
    RETURN pgp_sym_encrypt(creds::text, key, 'cipher-algo=aes256');
END;
$$;

CREATE OR REPLACE FUNCTION integration_decrypt_credentials(encrypted BYTEA)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    key TEXT;
BEGIN
    IF encrypted IS NULL THEN RETURN NULL; END IF;
    key := current_setting('app.integration_encryption_key', true);
    IF key IS NULL OR key = '' THEN
        RAISE EXCEPTION 'app.integration_encryption_key is not set';
    END IF;
    RETURN pgp_sym_decrypt(encrypted, key)::jsonb;
END;
$$;

-- Lock encryption helpers down — only the Edge Function (service_role) calls these
REVOKE ALL ON FUNCTION integration_encrypt_credentials(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_decrypt_credentials(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_encrypt_credentials(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION integration_decrypt_credentials(BYTEA) TO service_role;

-- =====================================================================
-- RPCs called by Edge Functions
-- =====================================================================

-- Create or update an integration with credentials. Idempotent on (org, catalog_code, name).
CREATE OR REPLACE FUNCTION integration_upsert_with_credentials(
    p_organization_id UUID,
    p_catalog_code TEXT,
    p_name TEXT,
    p_credentials JSONB,
    p_config JSONB DEFAULT '{}',
    p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Verify catalog entry exists and is active
    PERFORM 1 FROM integration_catalog WHERE code = p_catalog_code AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown or inactive catalog_code: %', p_catalog_code;
    END IF;

    INSERT INTO integrations (organization_id, catalog_code, name, status, credentials_encrypted, config, created_by)
    VALUES (
        p_organization_id, p_catalog_code, p_name, 'connecting',
        integration_encrypt_credentials(p_credentials),
        COALESCE(p_config, '{}'::jsonb),
        p_user_id
    )
    ON CONFLICT (organization_id, catalog_code, name) DO UPDATE SET
        status = 'connecting',
        credentials_encrypted = integration_encrypt_credentials(p_credentials),
        config = COALESCE(EXCLUDED.config, integrations.config),
        last_error = NULL,
        updated_at = NOW()
    RETURNING id INTO v_id;

    INSERT INTO integration_events (organization_id, integration_id, event_type, user_id, details)
    VALUES (p_organization_id, v_id, 'connect_attempt', p_user_id, jsonb_build_object('catalog_code', p_catalog_code));

    RETURN v_id;
END;
$$;

-- Unique constraint that the upsert relies on (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_org_code_name
    ON integrations (organization_id, catalog_code, name);

-- Read decrypted credentials. Service-role only.
CREATE OR REPLACE FUNCTION integration_read_credentials(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_creds JSONB;
BEGIN
    SELECT integration_decrypt_credentials(credentials_encrypted) INTO v_creds
    FROM integrations WHERE id = p_id;
    RETURN v_creds;
END;
$$;

-- Record the result of a connection / test attempt.
CREATE OR REPLACE FUNCTION integration_record_result(
    p_id UUID,
    p_event_type TEXT,
    p_success BOOLEAN,
    p_health NUMERIC DEFAULT NULL,
    p_error TEXT DEFAULT NULL,
    p_details JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_org_id UUID;
    v_new_status TEXT;
BEGIN
    SELECT organization_id INTO v_org_id FROM integrations WHERE id = p_id;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Integration not found: %', p_id;
    END IF;

    v_new_status := CASE
        WHEN p_event_type IN ('connect_success','test_success') THEN 'connected'
        WHEN p_event_type IN ('connect_failure','test_failure')  THEN 'error'
        WHEN p_event_type = 'disconnect'                          THEN 'disconnected'
        WHEN p_event_type = 'sync_start'                          THEN 'syncing'
        WHEN p_event_type = 'sync_complete'                       THEN 'connected'
        ELSE NULL
    END;

    UPDATE integrations SET
        status = COALESCE(v_new_status, status),
        health = COALESCE(p_health, health),
        last_test_at = CASE WHEN p_event_type IN ('test_success','test_failure') THEN NOW() ELSE last_test_at END,
        last_sync_at = CASE WHEN p_event_type = 'sync_complete' THEN NOW() ELSE last_sync_at END,
        last_error = CASE WHEN p_success THEN NULL ELSE p_error END,
        error_count = CASE WHEN p_success THEN 0 ELSE error_count + 1 END,
        credentials_encrypted = CASE WHEN p_event_type = 'disconnect' THEN NULL ELSE credentials_encrypted END,
        updated_at = NOW()
    WHERE id = p_id;

    INSERT INTO integration_events (organization_id, integration_id, event_type, details)
    VALUES (v_org_id, p_id, p_event_type, p_details);
END;
$$;

REVOKE ALL ON FUNCTION integration_upsert_with_credentials(UUID, TEXT, TEXT, JSONB, JSONB, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_read_credentials(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION integration_record_result(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_upsert_with_credentials(UUID, TEXT, TEXT, JSONB, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION integration_read_credentials(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION integration_record_result(UUID, TEXT, BOOLEAN, NUMERIC, TEXT, JSONB) TO service_role;

-- =====================================================================
-- RLS  (catalog public; instances + events org-scoped)
-- =====================================================================

ALTER TABLE integration_catalog  ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_select" ON integration_catalog;
CREATE POLICY "catalog_select" ON integration_catalog FOR SELECT USING (true);

DROP POLICY IF EXISTS "integrations_select" ON integrations;
CREATE POLICY "integrations_select" ON integrations FOR SELECT
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "integrations_insert" ON integrations;
CREATE POLICY "integrations_insert" ON integrations FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "integrations_update" ON integrations;
CREATE POLICY "integrations_update" ON integrations FOR UPDATE
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "integrations_delete" ON integrations;
CREATE POLICY "integrations_delete" ON integrations FOR DELETE
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS "integration_events_select" ON integration_events;
CREATE POLICY "integration_events_select" ON integration_events FOR SELECT
  USING (organization_id = current_user_org_id());

-- =====================================================================
-- VIEW: integrations + catalog joined, NO credentials exposed
-- =====================================================================

CREATE OR REPLACE VIEW v_integrations_for_org AS
SELECT
    i.id, i.organization_id, i.name, i.status, i.health,
    i.last_sync_at, i.last_test_at, i.last_error, i.error_count,
    i.config, i.metadata, i.created_at, i.updated_at,
    c.code AS catalog_code, c.vendor, c.product, c.category,
    c.description AS catalog_description, c.auth_type,
    c.credentials_schema, c.has_test_endpoint, c.docs_url, c.logo_url,
    (i.credentials_encrypted IS NOT NULL) AS has_credentials
FROM integrations i
JOIN integration_catalog c ON c.code = i.catalog_code;
-- RLS on integrations enforces org-scoping at the row level.

GRANT SELECT ON v_integrations_for_org TO authenticated;

-- =====================================================================
-- SEED: 26 integration_catalog entries — covers all vendors referenced
-- across the 13 industry templates (migration 012)
-- =====================================================================

INSERT INTO integration_catalog (code, vendor, product, category, description, auth_type, credentials_schema, has_test_endpoint, sort_order) VALUES
    ('anthropic', 'Anthropic', 'Claude API', 'ai', 'Claude AI for agent reasoning, RCA, and natural-language work order interactions.', 'api_key',
     '{"type":"object","required":["api_key"],"properties":{"api_key":{"type":"string","format":"password","title":"Anthropic API key","description":"Starts with sk-ant-"},"model":{"type":"string","default":"claude-sonnet-4-6","enum":["claude-opus-4-7","claude-sonnet-4-6","claude-haiku-4-5-20251001"]}}}'::jsonb,
     true, 10),
    ('openai', 'OpenAI', 'GPT API', 'ai', 'OpenAI GPT models — fallback / specialized tasks.', 'api_key',
     '{"type":"object","required":["api_key"],"properties":{"api_key":{"type":"string","format":"password","title":"OpenAI API key"}}}'::jsonb,
     true, 11),
    ('sap_pm', 'SAP', 'SAP PM (S/4HANA)', 'erp_cmms', 'Plant Maintenance: work orders, notifications, equipment master.', 'connection_string',
     '{"type":"object","required":["base_url","client","username","password"],"properties":{"base_url":{"type":"string","format":"uri","title":"OData base URL"},"client":{"type":"string","title":"SAP client (e.g. 100)"},"username":{"type":"string"},"password":{"type":"string","format":"password"}}}'::jsonb,
     false, 20),
    ('maximo', 'IBM', 'Maximo Application Suite', 'erp_cmms', 'Asset, work order, inventory management via REST.', 'api_key',
     '{"type":"object","required":["base_url","api_key"],"properties":{"base_url":{"type":"string","format":"uri","title":"Maximo API base URL"},"api_key":{"type":"string","format":"password","title":"Maximo API key"}}}'::jsonb,
     false, 21),
    ('oracle_fusion', 'Oracle', 'Oracle Fusion', 'erp_cmms', 'Oracle ERP and asset management (OAuth2).', 'oauth2',
     '{"type":"object","required":["client_id","client_secret","tenant_url"],"properties":{"client_id":{"type":"string"},"client_secret":{"type":"string","format":"password"},"tenant_url":{"type":"string","format":"uri"}}}'::jsonb,
     false, 22),
    ('aveva_pi', 'AVEVA', 'PI System', 'historian', 'OSIsoft PI Web API connector — process data historian.', 'connection_string',
     '{"type":"object","required":["base_url","username","password"],"properties":{"base_url":{"type":"string","format":"uri"},"username":{"type":"string"},"password":{"type":"string","format":"password"}}}'::jsonb,
     false, 30),
    ('honeywell_experion', 'Honeywell', 'Experion PKS', 'dcs', 'Process control system data access.', 'connection_string', '{"type":"object"}'::jsonb, false, 31),
    ('emerson_deltav', 'Emerson', 'DeltaV', 'dcs', 'Distributed control system integration.', 'connection_string', '{"type":"object"}'::jsonb, false, 32),
    ('bentley_assetwise', 'Bentley', 'AssetWise', 'reliability', 'Reliability and lifecycle management.', 'api_key', '{"type":"object"}'::jsonb, false, 33),
    ('hexagon_eam', 'Hexagon', 'EAM', 'erp_cmms', 'Enterprise asset management.', 'api_key', '{"type":"object"}'::jsonb, false, 34),
    ('schneider_ecostruxure', 'Schneider', 'EcoStruxure IT', 'dcim', 'Data center infrastructure management.', 'api_key', '{"type":"object"}'::jsonb, false, 40),
    ('vertiv_trellis', 'Vertiv', 'Trellis', 'dcim', 'DCIM platform.', 'api_key', '{"type":"object"}'::jsonb, false, 41),
    ('sunbird_dctrack', 'Sunbird', 'dcTrack', 'dcim', 'DCIM and asset tracking.', 'api_key', '{"type":"object"}'::jsonb, false, 42),
    ('nlyte', 'Nlyte', 'Nlyte DCIM', 'dcim', 'Data center infrastructure.', 'api_key', '{"type":"object"}'::jsonb, false, 43),
    ('eaton_brightlayer', 'Eaton', 'Brightlayer', 'power_monitoring', 'Power management and monitoring.', 'api_key', '{"type":"object"}'::jsonb, false, 44),
    ('siemens_desigo', 'Siemens', 'Desigo CC', 'bms', 'Building management system.', 'api_key', '{"type":"object"}'::jsonb, false, 45),
    ('honeywell_bms', 'Honeywell', 'Building Management', 'bms', 'BMS integration.', 'api_key', '{"type":"object"}'::jsonb, false, 46),
    ('servicenow_itom', 'ServiceNow', 'ITOM', 'itsm', 'IT operations management.', 'oauth2', '{"type":"object"}'::jsonb, false, 50),
    ('veeva_quality', 'Veeva', 'Vault QualityDocs', 'quality', 'GMP quality document management.', 'oauth2', '{"type":"object"}'::jsonb, false, 60),
    ('mastercontrol', 'MasterControl', 'Quality Excellence', 'quality', 'Quality management system.', 'api_key', '{"type":"object"}'::jsonb, false, 61),
    ('rockwell_pharma', 'Rockwell', 'PharmaSuite MES', 'mes', 'Pharma manufacturing execution.', 'connection_string', '{"type":"object"}'::jsonb, false, 62),
    ('werum_pas_x', 'Werum', 'PAS-X MES', 'mes', 'Pharma MES.', 'connection_string', '{"type":"object"}'::jsonb, false, 63),
    ('grafana', 'Grafana', 'Grafana Cloud', 'observability', 'Visualization and monitoring.', 'api_key', '{"type":"object"}'::jsonb, false, 70),
    ('influxdb', 'InfluxData', 'InfluxDB', 'historian', 'Time-series database.', 'connection_string', '{"type":"object"}'::jsonb, false, 71),
    ('azure_iot', 'Microsoft', 'Azure IoT Hub', 'cloud_iot', 'Cloud IoT data ingestion.', 'connection_string', '{"type":"object"}'::jsonb, false, 80),
    ('aws_iot', 'AWS', 'AWS IoT Core', 'cloud_iot', 'Cloud IoT data ingestion.', 'api_key', '{"type":"object"}'::jsonb, false, 81)
ON CONFLICT (code) DO NOTHING;

SELECT '013: Integrations registered — 26 catalog entries seeded' AS status;
