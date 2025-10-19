/*
  # StiggSync AI Maintenance System Database Schema

  1. New Tables
    - `assets`
      - `id` (uuid, primary key)
      - `name` (text)
      - `type` (text)
      - `status` (text)
      - `location` (text)
      - `criticality` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `work_orders`
      - `id` (uuid, primary key)
      - `asset_id` (uuid, foreign key)
      - `title` (text)
      - `description` (text)
      - `priority` (text)
      - `status` (text)
      - `assigned_to` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `completed_at` (timestamptz)
    
    - `ai_agent_logs`
      - `id` (uuid, primary key)
      - `agent_type` (text)
      - `user_id` (text)
      - `query` (text)
      - `response` (text)
      - `industry` (text)
      - `processing_time_ms` (integer)
      - `created_at` (timestamptz)
    
    - `maintenance_metrics`
      - `id` (uuid, primary key)
      - `total_assets` (integer)
      - `active_work_orders` (integer)
      - `esg_score` (numeric)
      - `cost_savings` (numeric)
      - `uptime` (numeric)
      - `efficiency` (numeric)
      - `recorded_at` (timestamptz)
  
  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Public read access for demo purposes (can be restricted later)
*/

-- Create assets table
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'operational',
  location text,
  criticality text DEFAULT 'medium',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create work_orders table
CREATE TABLE IF NOT EXISTS work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'medium',
  status text DEFAULT 'pending',
  assigned_to text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Create ai_agent_logs table
CREATE TABLE IF NOT EXISTS ai_agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text NOT NULL,
  user_id text,
  query text NOT NULL,
  response text,
  industry text,
  processing_time_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Create maintenance_metrics table
CREATE TABLE IF NOT EXISTS maintenance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_assets integer DEFAULT 0,
  active_work_orders integer DEFAULT 0,
  esg_score numeric(5,2) DEFAULT 0,
  cost_savings numeric(12,2) DEFAULT 0,
  uptime numeric(5,2) DEFAULT 0,
  efficiency numeric(5,2) DEFAULT 0,
  recorded_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_metrics ENABLE ROW LEVEL SECURITY;

-- Create policies for assets (public read for demo, authenticated write)
CREATE POLICY "Anyone can read assets"
  ON assets FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert assets"
  ON assets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update assets"
  ON assets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create policies for work_orders
CREATE POLICY "Anyone can read work orders"
  ON work_orders FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert work orders"
  ON work_orders FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update work orders"
  ON work_orders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create policies for ai_agent_logs
CREATE POLICY "Anyone can read AI logs"
  ON ai_agent_logs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert AI logs"
  ON ai_agent_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create policies for maintenance_metrics
CREATE POLICY "Anyone can read metrics"
  ON maintenance_metrics FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert metrics"
  ON maintenance_metrics FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_id ON work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_agent_type ON ai_agent_logs(agent_type);
CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_created_at ON ai_agent_logs(created_at DESC);

-- Insert initial demo data
INSERT INTO assets (name, type, status, location, criticality) VALUES
  ('Pump Unit A1', 'Centrifugal Pump', 'operational', 'Sector 1', 'high'),
  ('Compressor B2', 'Gas Compressor', 'operational', 'Sector 2', 'critical'),
  ('Turbine C3', 'Steam Turbine', 'maintenance', 'Sector 1', 'high'),
  ('Motor D4', 'Electric Motor', 'operational', 'Sector 3', 'medium'),
  ('Valve E5', 'Control Valve', 'operational', 'Sector 2', 'low')
ON CONFLICT DO NOTHING;

INSERT INTO maintenance_metrics (total_assets, active_work_orders, esg_score, cost_savings, uptime, efficiency) VALUES
  (2847, 156, 87.3, 2400000, 98.7, 94.2)
ON CONFLICT DO NOTHING;
