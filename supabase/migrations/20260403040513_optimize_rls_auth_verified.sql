/*
  # Optimize RLS Policies - Auth Function Performance (Verified)

  This migration optimizes Row Level Security (RLS) policies by wrapping auth.uid()
  in SELECT statements based on verified existing policy structures.

  ## Performance Impact

  Without optimization: auth.uid() called once per row
  With optimization: auth.uid() called once per query

  ## Tables Optimized

  - document_uploads (uploaded_by)
  - system_alerts (target_users array)
  - tool_executions (user_id)
  - realtime_subscriptions (user_id)
  - realtime_messages (sender_id)
  - model_policies (user_id)
  - runtime_sessions (user_id)
  - trace_snapshots (created_by)
  - trace_replay_sessions (replayed_by)
  - evidence_repository (collected_by)
  - rate_limit_buckets (user_id)
  - rate_limit_config (admin check)
*/

-- ============================================================================
-- DOCUMENT UPLOADS
-- ============================================================================

DROP POLICY IF EXISTS "Users can update own uploads" ON document_uploads;
CREATE POLICY "Users can update own uploads"
  ON document_uploads FOR UPDATE
  TO authenticated
  USING (uploaded_by = (SELECT auth.uid()))
  WITH CHECK (uploaded_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own uploads" ON document_uploads;
CREATE POLICY "Users can delete own uploads"
  ON document_uploads FOR DELETE
  TO authenticated
  USING (uploaded_by = (SELECT auth.uid()));

-- ============================================================================
-- SYSTEM ALERTS
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their alerts" ON system_alerts;
CREATE POLICY "Users can view their alerts"
  ON system_alerts FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = ANY (target_users) OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = (SELECT auth.uid())
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "Users can acknowledge alerts" ON system_alerts;
CREATE POLICY "Users can acknowledge alerts"
  ON system_alerts FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = ANY (target_users))
  WITH CHECK ((SELECT auth.uid()) = ANY (target_users));

-- ============================================================================
-- TOOL EXECUTIONS
-- ============================================================================

DROP POLICY IF EXISTS "Users own executions" ON tool_executions;
CREATE POLICY "Users own executions"
  ON tool_executions FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own subscriptions" ON realtime_subscriptions;
CREATE POLICY "Users can manage own subscriptions"
  ON realtime_subscriptions FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ============================================================================
-- REALTIME MESSAGES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view messages in subscribed channels" ON realtime_messages;
CREATE POLICY "Users can view messages in subscribed channels"
  ON realtime_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM realtime_subscriptions
      WHERE realtime_subscriptions.channel_id = realtime_messages.channel_id
      AND realtime_subscriptions.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can send messages" ON realtime_messages;
CREATE POLICY "Users can send messages"
  ON realtime_messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()));

-- ============================================================================
-- MODEL POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own policies" ON model_policies;
CREATE POLICY "Users can view their own policies"
  ON model_policies FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = (SELECT auth.uid())
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage all policies" ON model_policies;
CREATE POLICY "Admins can manage all policies"
  ON model_policies FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = (SELECT auth.uid())
      AND user_profiles.role IN ('admin', 'super_admin')
    )
  );

-- ============================================================================
-- RUNTIME SESSIONS
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own runtime sessions" ON runtime_sessions;
CREATE POLICY "Users can view their own runtime sessions"
  ON runtime_sessions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- TRACE SNAPSHOTS
-- ============================================================================

DROP POLICY IF EXISTS "Users can create trace snapshots" ON trace_snapshots;
CREATE POLICY "Users can create trace snapshots"
  ON trace_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

-- ============================================================================
-- TRACE REPLAY SESSIONS
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their own replay sessions" ON trace_replay_sessions;
CREATE POLICY "Users can view their own replay sessions"
  ON trace_replay_sessions FOR SELECT
  TO authenticated
  USING (replayed_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own replay sessions" ON trace_replay_sessions;
CREATE POLICY "Users can manage their own replay sessions"
  ON trace_replay_sessions FOR ALL
  TO authenticated
  USING (replayed_by = (SELECT auth.uid()))
  WITH CHECK (replayed_by = (SELECT auth.uid()));

-- ============================================================================
-- EVIDENCE REPOSITORY
-- ============================================================================

DROP POLICY IF EXISTS "Users can create evidence" ON evidence_repository;
CREATE POLICY "Users can create evidence"
  ON evidence_repository FOR INSERT
  TO authenticated
  WITH CHECK (collected_by = (SELECT auth.uid()));

-- ============================================================================
-- RATE LIMIT BUCKETS
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own rate limit usage" ON rate_limit_buckets;
CREATE POLICY "Users can view own rate limit usage"
  ON rate_limit_buckets FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- RATE LIMIT CONFIG
-- ============================================================================

DROP POLICY IF EXISTS "Only admins can modify rate limit configs" ON rate_limit_config;
CREATE POLICY "Only admins can modify rate limit configs"
  ON rate_limit_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = (SELECT auth.uid())
      AND user_profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = (SELECT auth.uid())
      AND user_profiles.role = 'admin'
    )
  );
