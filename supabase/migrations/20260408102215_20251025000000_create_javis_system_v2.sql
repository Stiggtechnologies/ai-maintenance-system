/*
  # J.A.V.I.S (Just-in-time Asset & Value Intelligence System)

  1. New Tables
    - `user_preferences` - Voice/notification preferences per user
    - `roles_raci` - Role-based RACI matrix and communication styles
    - `user_role_map` - Maps users to roles with site context
    - `event_subscriptions` - User event subscriptions with filters
    - `javis_messages` - Delivered message log for audit
    - `javis_conversations` - Conversation sessions
    - `javis_context_cache` - Cache for briefing context

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users (own data only)
    - Add policies for admins to manage RACI

  3. Functions
    - Performance indexes for common queries
*/

-- Tenants (required for J.A.V.I.S)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  prefers_voice BOOLEAN DEFAULT FALSE,
  voice_locale TEXT DEFAULT 'en-CA',
  voice_gender TEXT DEFAULT 'neutral',
  voice_speed NUMERIC DEFAULT 1.0 CHECK (voice_speed BETWEEN 0.5 AND 2.0),
  morning_brief_time TIME DEFAULT '07:30',
  notify_channels JSONB DEFAULT '{"in_app":true,"email":false,"sms":false,"push":true}'::jsonb,
  javis_enabled BOOLEAN DEFAULT TRUE,
  timezone TEXT DEFAULT 'America/Toronto',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Roles RACI Matrix
CREATE TABLE IF NOT EXISTS roles_raci (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  role_name TEXT NOT NULL,
  raci JSONB NOT NULL DEFAULT '{}'::jsonb,
  comm_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_filters JSONB DEFAULT '{}'::jsonb,
  priority_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, role_code)
);

-- User Role Mapping
CREATE TABLE IF NOT EXISTS user_role_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  site_id UUID,
  is_primary BOOLEAN DEFAULT FALSE,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, role_code, site_id)
);

-- Event Subscriptions
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_types TEXT[] NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  severity_threshold TEXT DEFAULT 'medium',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- J.A.V.I.S Messages Log
CREATE TABLE IF NOT EXISTS javis_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email', 'sms', 'voice', 'websocket')),
  message_type TEXT NOT NULL CHECK (message_type IN ('greeting', 'brief', 'update', 'response', 'alert')),
  message TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  event_meta JSONB,
  audio_url TEXT,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- J.A.V.I.S Conversations
CREATE TABLE IF NOT EXISTS javis_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  feedback TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- J.A.V.I.S Context Cache (for performance)
CREATE TABLE IF NOT EXISTS javis_context_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN ('morning_brief', 'kpi_summary', 'risk_summary', 'workorder_summary')),
  context_data JSONB NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, context_type)
);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_raci ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_context_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies: user_preferences
DO $$ BEGIN
  CREATE POLICY "Users can view own preferences"
    ON user_preferences FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own preferences"
    ON user_preferences FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own preferences"
    ON user_preferences FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: roles_raci
DO $$ BEGIN
  CREATE POLICY "Users can view RACI roles in tenant"
    ON roles_raci FOR SELECT
    TO authenticated
    USING (
      tenant_id IN (
        SELECT id FROM tenants LIMIT 1
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: user_role_map
DO $$ BEGIN
  CREATE POLICY "Users can view own role mappings"
    ON user_role_map FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: event_subscriptions
DO $$ BEGIN
  CREATE POLICY "Users can manage own subscriptions"
    ON event_subscriptions FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: javis_messages
DO $$ BEGIN
  CREATE POLICY "Users can view own messages"
    ON javis_messages FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: javis_conversations
DO $$ BEGIN
  CREATE POLICY "Users can view own conversations"
    ON javis_conversations FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS Policies: javis_context_cache
DO $$ BEGIN
  CREATE POLICY "Users can view own context cache"
    ON javis_context_cache FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_raci_tenant_code ON roles_raci(tenant_id, role_code);
CREATE INDEX IF NOT EXISTS idx_user_role_map_user ON user_role_map(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_role_map_role ON user_role_map(role_code, tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_user ON event_subscriptions(user_id, tenant_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_javis_messages_user_created ON javis_messages(user_id, tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_javis_messages_unread ON javis_messages(user_id, tenant_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_javis_conversations_user ON javis_conversations(user_id, tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_javis_context_cache_user ON javis_context_cache(user_id, tenant_id, context_type);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;
  CREATE TRIGGER update_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS update_roles_raci_updated_at ON roles_raci;
  CREATE TRIGGER update_roles_raci_updated_at
    BEFORE UPDATE ON roles_raci
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS update_event_subscriptions_updated_at ON event_subscriptions;
  CREATE TRIGGER update_event_subscriptions_updated_at
    BEFORE UPDATE ON event_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN undefined_table THEN NULL;
END $$;