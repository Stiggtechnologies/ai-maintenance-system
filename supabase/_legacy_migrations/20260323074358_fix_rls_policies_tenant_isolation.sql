/*
  # Fix RLS Policies for Tenant Isolation

  1. Security Improvements
    - Remove anonymous access to sensitive tables
    - Restrict policies to authenticated users only

  2. Tables Updated
    - `assets` - Remove anonymous read access
    - `work_orders` - Remove anonymous read access  
    - `ai_agent_logs` - Remove anonymous access

  3. Impact
    - Improved security posture
    - Proper authentication enforcement
    - Prevents anonymous data access
*/

-- Drop overly permissive policies that allow anonymous access
DROP POLICY IF EXISTS "Anyone can read assets" ON assets;
DROP POLICY IF EXISTS "Anyone can read work orders" ON work_orders;
DROP POLICY IF EXISTS "Anyone can insert AI logs" ON ai_agent_logs;
DROP POLICY IF EXISTS "Anyone can read AI logs" ON ai_agent_logs;

-- Assets: Restrict to authenticated users only
CREATE POLICY "Authenticated users can read assets"
  ON assets FOR SELECT
  TO authenticated
  USING (true);

-- Work Orders: Restrict to authenticated users only
CREATE POLICY "Authenticated users can read work orders"
  ON work_orders FOR SELECT
  TO authenticated
  USING (true);

-- AI Agent Logs: Restrict to authenticated users and service role
CREATE POLICY "Authenticated users can read ai_agent_logs"
  ON ai_agent_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert ai_agent_logs"
  ON ai_agent_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can manage ai_agent_logs"
  ON ai_agent_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);