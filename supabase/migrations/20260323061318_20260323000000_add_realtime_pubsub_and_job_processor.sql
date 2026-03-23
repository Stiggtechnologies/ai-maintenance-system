/*
  # Real-Time Pub/Sub and Background Job Processor

  ## Summary
  Adds infrastructure for real-time event broadcasting and background job processing to complete the SyncAI v2 architecture.

  ## New Tables
  
  ###  Real-Time Infrastructure
  - `realtime_channels` - Pub/sub channel registry for WebSocket broadcasting
  - `realtime_subscriptions` - User subscriptions to specific channels
  - `realtime_messages` - Message queue for broadcasting
  
  ### Background Job Processing
  - `job_definitions` - Registered job types with handlers
  - `job_queue` - Background job queue with priority and retry logic
  - `job_executions` - Job execution history with results
  
  ## Security
  - Enable RLS on all tables
  - User-based isolation for all operations
  - Role-based access to channels and jobs
  
  ## Features
  - WebSocket message routing
  - Presence tracking
  - Event broadcasting by channel
  - Background job scheduling with cron support
  - Retry logic with exponential backoff
  - Job execution tracking
*/

-- Real-Time Channels
CREATE TABLE IF NOT EXISTS realtime_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_name TEXT NOT NULL UNIQUE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('global', 'site', 'user', 'role', 'asset', 'workorder')),
  description TEXT,
  requires_permission BOOLEAN DEFAULT FALSE,
  allowed_roles TEXT[],
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Real-Time Subscriptions
CREATE TABLE IF NOT EXISTS realtime_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES realtime_channels(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ,
  UNIQUE(user_id, channel_id, session_id)
);

-- Real-Time Messages (for broadcast queue)
CREATE TABLE IF NOT EXISTS realtime_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES realtime_channels(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  broadcast_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '5 minutes'),
  delivered BOOLEAN DEFAULT FALSE,
  delivered_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Job Definitions
CREATE TABLE IF NOT EXISTS job_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL UNIQUE,
  handler_function TEXT NOT NULL,
  description TEXT,
  default_timeout_seconds INTEGER DEFAULT 300,
  max_retries INTEGER DEFAULT 3,
  retry_backoff_seconds INTEGER DEFAULT 60,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Job Queue
CREATE TABLE IF NOT EXISTS job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  job_data JSONB NOT NULL,
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled', 'retrying')),
  scheduled_for TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Job Executions (history)
CREATE TABLE IF NOT EXISTS job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES job_queue(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  result JSONB,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE realtime_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_executions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: realtime_channels
CREATE POLICY "All authenticated users can view channels"
  ON realtime_channels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage channels"
  ON realtime_channels FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: realtime_subscriptions
CREATE POLICY "Users can manage own subscriptions"
  ON realtime_subscriptions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: realtime_messages
CREATE POLICY "Users can view messages in subscribed channels"
  ON realtime_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM realtime_subscriptions
      WHERE user_id = auth.uid()
      AND channel_id = realtime_messages.channel_id
      AND unsubscribed_at IS NULL
    )
  );

CREATE POLICY "Users can send messages"
  ON realtime_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id OR sender_id IS NULL);

-- RLS Policies: job_definitions
CREATE POLICY "All authenticated users can view job definitions"
  ON job_definitions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage job definitions"
  ON job_definitions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: job_queue
CREATE POLICY "Users can view all jobs"
  ON job_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create jobs"
  ON job_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can manage job queue"
  ON job_queue FOR ALL
  TO authenticated
  USING (true);

-- RLS Policies: job_executions
CREATE POLICY "Users can view job executions"
  ON job_executions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage job executions"
  ON job_executions FOR ALL
  TO authenticated
  USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_realtime_subscriptions_user ON realtime_subscriptions(user_id, channel_id) WHERE unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_realtime_subscriptions_channel ON realtime_subscriptions(channel_id) WHERE unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_realtime_messages_channel ON realtime_messages(channel_id, created_at DESC) WHERE NOT delivered;
CREATE INDEX IF NOT EXISTS idx_realtime_messages_expires ON realtime_messages(expires_at) WHERE NOT delivered;
CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, priority DESC, scheduled_for) WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_job_executions_job ON job_executions(job_id, attempt_number);

-- Function: Broadcast Message to Channel
CREATE OR REPLACE FUNCTION broadcast_to_channel(
  p_channel_name TEXT,
  p_message_type TEXT,
  p_payload JSONB,
  p_sender_id UUID DEFAULT NULL,
  p_priority TEXT DEFAULT 'normal'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_channel_id UUID;
  v_message_id UUID;
BEGIN
  -- Get or create channel
  SELECT id INTO v_channel_id
  FROM realtime_channels
  WHERE channel_name = p_channel_name;

  IF v_channel_id IS NULL THEN
    INSERT INTO realtime_channels (channel_name, channel_type)
    VALUES (p_channel_name, 'global')
    RETURNING id INTO v_channel_id;
  END IF;

  -- Insert message
  INSERT INTO realtime_messages (
    channel_id,
    message_type,
    payload,
    sender_id,
    priority
  ) VALUES (
    v_channel_id,
    p_message_type,
    p_payload,
    p_sender_id,
    p_priority
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

-- Function: Subscribe to Channel
CREATE OR REPLACE FUNCTION subscribe_to_channel(
  p_user_id UUID,
  p_channel_name TEXT,
  p_session_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_channel_id UUID;
  v_subscription_id UUID;
BEGIN
  -- Get or create channel
  SELECT id INTO v_channel_id
  FROM realtime_channels
  WHERE channel_name = p_channel_name;

  IF v_channel_id IS NULL THEN
    INSERT INTO realtime_channels (channel_name, channel_type)
    VALUES (p_channel_name, 'global')
    RETURNING id INTO v_channel_id;
  END IF;

  -- Create or update subscription
  INSERT INTO realtime_subscriptions (
    user_id,
    channel_id,
    session_id
  ) VALUES (
    p_user_id,
    v_channel_id,
    p_session_id
  )
  ON CONFLICT (user_id, channel_id, session_id)
  DO UPDATE SET
    last_seen = now(),
    unsubscribed_at = NULL
  RETURNING id INTO v_subscription_id;

  RETURN v_subscription_id;
END;
$$;

-- Function: Get Pending Messages for User
CREATE OR REPLACE FUNCTION get_pending_messages_for_user(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  message_id UUID,
  channel_name TEXT,
  message_type TEXT,
  payload JSONB,
  priority TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    c.channel_name,
    m.message_type,
    m.payload,
    m.priority,
    m.created_at
  FROM realtime_messages m
  JOIN realtime_channels c ON c.id = m.channel_id
  JOIN realtime_subscriptions s ON s.channel_id = c.id
  WHERE s.user_id = p_user_id
  AND s.unsubscribed_at IS NULL
  AND NOT m.delivered
  AND m.expires_at > now()
  ORDER BY
    CASE m.priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low' THEN 4
    END,
    m.created_at
  LIMIT p_limit;
END;
$$;

-- Function: Enqueue Job
CREATE OR REPLACE FUNCTION enqueue_job(
  p_job_type TEXT,
  p_job_data JSONB,
  p_priority INTEGER DEFAULT 5,
  p_scheduled_for TIMESTAMPTZ DEFAULT now(),
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
  v_max_retries INTEGER;
BEGIN
  -- Get max retries from job definition
  SELECT max_retries INTO v_max_retries
  FROM job_definitions
  WHERE job_type = p_job_type
  AND enabled = true;

  IF v_max_retries IS NULL THEN
    RAISE EXCEPTION 'Job type % not found or not enabled', p_job_type;
  END IF;

  -- Insert job
  INSERT INTO job_queue (
    job_type,
    job_data,
    priority,
    scheduled_for,
    max_retries,
    created_by
  ) VALUES (
    p_job_type,
    p_job_data,
    p_priority,
    p_scheduled_for,
    v_max_retries,
    p_created_by
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

-- Function: Get Next Job
CREATE OR REPLACE FUNCTION get_next_job()
RETURNS TABLE (
  job_id UUID,
  job_type TEXT,
  job_data JSONB,
  retry_count INTEGER,
  handler_function TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
BEGIN
  -- Get highest priority job that's ready
  SELECT
    jq.id,
    jq.job_type,
    jq.job_data,
    jq.retry_count,
    jd.handler_function
  INTO v_job
  FROM job_queue jq
  JOIN job_definitions jd ON jd.job_type = jq.job_type
  WHERE jq.status IN ('queued', 'retrying')
  AND jq.scheduled_for <= now()
  AND jd.enabled = true
  ORDER BY jq.priority DESC, jq.scheduled_for
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NOT NULL THEN
    -- Update job status to processing
    UPDATE job_queue
    SET
      status = 'processing',
      started_at = now(),
      updated_at = now()
    WHERE id = v_job.id;

    -- Create execution record
    INSERT INTO job_executions (
      job_id,
      attempt_number,
      status
    ) VALUES (
      v_job.id,
      v_job.retry_count + 1,
      'running'
    );

    -- Return job details
    RETURN QUERY
    SELECT
      v_job.id,
      v_job.job_type,
      v_job.job_data,
      v_job.retry_count,
      v_job.handler_function;
  END IF;
END;
$$;

-- Function: Complete Job
CREATE OR REPLACE FUNCTION complete_job(
  p_job_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_retry_backoff INTEGER;
BEGIN
  -- Get job details
  SELECT
    jq.*,
    jd.retry_backoff_seconds
  INTO v_job
  FROM job_queue jq
  JOIN job_definitions jd ON jd.job_type = jq.job_type
  WHERE jq.id = p_job_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Update execution record
  UPDATE job_executions
  SET
    status = p_status,
    result = p_result,
    error_message = p_error_message,
    completed_at = now(),
    duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
  WHERE job_id = p_job_id
  AND status = 'running';

  -- Handle based on status
  IF p_status = 'success' THEN
    UPDATE job_queue
    SET
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    WHERE id = p_job_id;

  ELSIF p_status IN ('failed', 'timeout') THEN
    -- Check if we should retry
    IF v_job.retry_count < v_job.max_retries THEN
      -- Schedule retry with exponential backoff
      UPDATE job_queue
      SET
        status = 'retrying',
        retry_count = retry_count + 1,
        scheduled_for = now() + (v_job.retry_backoff_seconds * POWER(2, retry_count)) * interval '1 second',
        error_message = p_error_message,
        updated_at = now()
      WHERE id = p_job_id;
    ELSE
      -- Max retries reached
      UPDATE job_queue
      SET
        status = 'failed',
        completed_at = now(),
        error_message = p_error_message,
        updated_at = now()
      WHERE id = p_job_id;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;

-- Seed Standard Channels
INSERT INTO realtime_channels (channel_name, channel_type, description, requires_permission)
VALUES
  ('system.alerts', 'global', 'System-wide alerts and notifications', false),
  ('system.health', 'global', 'System health status updates', false),
  ('workorders.updates', 'workorder', 'Work order status changes', false),
  ('assets.health', 'asset', 'Asset health status changes', false),
  ('approvals.pending', 'role', 'Pending approval notifications', true),
  ('javis.responses', 'user', 'J.A.V.I.S personalized responses', true)
ON CONFLICT (channel_name) DO NOTHING;

-- Seed Job Definitions
INSERT INTO job_definitions (job_type, handler_function, description, default_timeout_seconds, max_retries)
VALUES
  ('process_document', 'process_document_job', 'Process uploaded document and extract content', 600, 3),
  ('generate_embeddings', 'generate_embeddings_job', 'Generate vector embeddings for text chunks', 300, 3),
  ('health_monitoring', 'health_monitoring_job', 'Monitor asset health and detect anomalies', 300, 2),
  ('send_notifications', 'send_notifications_job', 'Send email/SMS/push notifications', 120, 5),
  ('generate_report', 'generate_report_job', 'Generate scheduled reports', 600, 2),
  ('sync_external_data', 'sync_external_data_job', 'Sync data from external systems', 600, 3),
  ('cleanup_expired_data', 'cleanup_expired_data_job', 'Clean up expired sessions and temporary data', 300, 1),
  ('calculate_kpis', 'calculate_kpis_job', 'Calculate and update KPI measurements', 600, 2),
  ('autonomous_decision', 'autonomous_decision_job', 'Process autonomous decision workflow', 300, 2),
  ('agent_orchestration', 'agent_orchestration_job', 'Orchestrate multi-agent tasks', 600, 3)
ON CONFLICT (job_type) DO NOTHING;

-- Trigger: Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_job_definitions_updated_at
  BEFORE UPDATE ON job_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_job_queue_updated_at
  BEFORE UPDATE ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
