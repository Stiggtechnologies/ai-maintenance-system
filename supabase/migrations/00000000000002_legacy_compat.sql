-- ============================================================================
-- Legacy-surface compatibility layer
-- ----------------------------------------------------------------------------
-- Creates every table still referenced by the pre-operating-loop pages
-- (dashboards, OEE, integrations, research, deployments, approvals, billing,
-- Javis, SIR runtime, trace replay) so ALL routes run on live Supabase data.
-- Column shapes are inferred from the exact queries in src/ (see
-- docs/operating-loop-demo.md). Org-scoped RLS where an organization_id
-- exists; authenticated-scoped otherwise (tightening tracked as GTM item).
-- ============================================================================

-- ---- asset embeds used by AssetManagement ----------------------------------
create table if not exists asset_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists asset_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table assets add column if not exists asset_class_id uuid references asset_classes(id);
alter table assets add column if not exists location_id uuid references asset_locations(id);
alter table assets add column if not exists asset_tag text;

-- ---- work order extensions used by legacy work surfaces --------------------
alter table work_orders add column if not exists site_id uuid references sites(id);
alter table work_orders add column if not exists assigned_to uuid;
alter table work_orders add column if not exists due_date timestamptz;
alter table work_orders add column if not exists actual_hours numeric default 0;
alter table work_orders add column if not exists work_type text;
alter table work_orders add column if not exists completed_at timestamptz;
alter table work_orders add column if not exists updated_at timestamptz default now();
alter table work_orders add column if not exists closeout_notes text;

create table if not exists work_order_tasks (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_orders(id) on delete cascade,
  task_sequence int default 1,
  description text,
  status text default 'pending',
  estimated_hours numeric default 0,
  actual_hours numeric default 0,
  created_at timestamptz not null default now()
);

create table if not exists work_order_status_history (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_orders(id) on delete cascade,
  status_from text,
  status_to text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  comments text
);

-- ---- integrations -----------------------------------------------------------
create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  connector_type text,
  name text not null,
  status text default 'active',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists connector_runs (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid references connectors(id) on delete cascade,
  run_type text default 'sync',
  status text default 'success',
  started_at timestamptz default now(),
  finished_at timestamptz,
  records_processed int default 0,
  error_message text
);

-- ---- OEE ---------------------------------------------------------------------
create table if not exists oee_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  site_id uuid references sites(id),
  production_line_id uuid,
  measurement_date timestamptz not null default now(),
  availability numeric default 0,
  performance numeric default 0,
  quality numeric default 0,
  oee numeric default 0
);

create table if not exists oee_loss_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  loss_type text,
  description text,
  start_time timestamptz default now(),
  duration_minutes numeric default 0
);

-- ---- KPIs ---------------------------------------------------------------------
create table if not exists kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text,
  unit text,
  category text,
  active boolean default true
);

create table if not exists kpis_kois (
  id uuid primary key default gen_random_uuid(),
  kpi_code text,
  kpi_name text,
  description text,
  unit_of_measure text,
  target_value numeric,
  threshold_green numeric,
  threshold_yellow numeric,
  active boolean default true
);

create table if not exists kpi_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  kpi_definition_id uuid,
  kpi_id uuid,
  site_id uuid,
  measurement_time timestamptz default now(),
  measured_value numeric default 0,
  status text default 'on_target',
  created_at timestamptz not null default now()
);

create table if not exists user_kpi_dashboard (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  kpi_id uuid,
  kpi_code text,
  kpi_name text,
  kpi_type text default 'kpi',
  category_name text,
  latest_value numeric,
  target_value numeric,
  status text default 'on_target',
  trend text default 'stable',
  last_updated timestamptz default now()
);

create table if not exists maintenance_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  total_assets int default 0,
  pm_compliance numeric,
  schedule_compliance numeric,
  mtbf_hours numeric,
  mttr_hours numeric
);

create table if not exists asset_health_monitoring (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  health_score int default 100,
  status text default 'normal',
  monitored_at timestamptz default now(),
  sensor_data jsonb default '{}'
);

-- ---- alerts + notifications ---------------------------------------------------
create table if not exists system_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  severity text default 'info',
  title text,
  description text,
  alert_type text,
  target_users text[] default '{}',
  acknowledged boolean default false,
  resolved boolean default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  site_id uuid,
  title text,
  message text,
  read boolean default false,
  reported_at timestamptz default now(),
  created_at timestamptz not null default now()
);

-- ---- autonomous decisions / approvals ------------------------------------------
create table if not exists autonomous_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  decision_type text,
  decision_data jsonb default '{}',
  confidence_score numeric default 0,
  status text default 'pending',
  requires_approval boolean default true,
  approval_deadline timestamptz,
  approved_by uuid,
  executed_at timestamptz,
  modified_before_approval boolean default false,
  correlation_id text,
  asset_id uuid,
  work_order_id uuid,
  autonomy_level text default 'advisory',
  duration_ms int,
  created_at timestamptz not null default now()
);

create table if not exists autonomous_actions (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references autonomous_decisions(id) on delete cascade,
  action_type text,
  target_id uuid,
  action_data jsonb default '{}',
  triggered_by text,
  success boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists approval_workflows (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references autonomous_decisions(id) on delete cascade,
  approval_level int default 1,
  status text default 'pending',
  comments text,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- research orchestrator -------------------------------------------------------
create table if not exists research_programs (
  id uuid primary key default gen_random_uuid(),
  program_code text,
  program_name text,
  description text,
  domain text,
  active boolean default true,
  max_experiment_duration_minutes int default 60,
  created_at timestamptz not null default now()
);

create table if not exists research_runs (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references research_programs(id) on delete cascade,
  variant_id uuid,
  benchmark_id uuid,
  run_number int default 1,
  status text default 'completed',
  started_at timestamptz default now(),
  completed_at timestamptz,
  duration_ms int
);

create table if not exists research_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references research_runs(id) on delete cascade,
  metric_name text,
  metric_value numeric,
  baseline_value numeric,
  improvement_pct numeric,
  improved boolean default false
);

create table if not exists promotion_candidates (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid,
  program_id uuid references research_programs(id) on delete cascade,
  net_improvement_pct numeric,
  benchmarks_passed int default 0,
  benchmarks_total int default 0,
  review_status text default 'pending',
  review_comments text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- deployments ------------------------------------------------------------------
create table if not exists deployment_templates (
  id uuid primary key default gen_random_uuid(),
  name text,
  slug text,
  description text,
  master_family text,
  master_template_name text,
  is_active boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists deployment_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references deployment_templates(id),
  organization_id uuid references organizations(id) on delete cascade,
  site_id uuid,
  name text,
  site_name text,
  operating_region text,
  timezone text,
  asset_range text,
  site_count int default 1,
  operating_model text,
  primary_cmms text,
  autonomy_mode text default 'advisory',
  approval_strictness text default 'strict',
  audit_retention text default '7y',
  industry_code text,
  use_case text,
  status text default 'draft',
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---- ops snapshots / audit ----------------------------------------------------------
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  entity_type text,
  event_data jsonb default '{}',
  actor text,
  event_time timestamptz default now(),
  created_at timestamptz not null default now()
);

create table if not exists asset_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  asset_count int default 0,
  captured_at timestamptz not null default now()
);

create table if not exists backlog_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  site_id uuid,
  backlog_count int default 0,
  snapshot_time timestamptz not null default now()
);

-- ---- tenancy/prefs (Javis) -------------------------------------------------------------
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists tenant_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  settings jsonb default '{}',
  created_at timestamptz not null default now()
);

create table if not exists user_preferences (
  user_id uuid primary key,
  tenant_id uuid,
  display_name text,
  prefers_voice boolean default false,
  voice_locale text default 'en-CA',
  voice_gender text default 'neutral',
  voice_speed numeric default 1.0,
  morning_brief_time text default '07:00',
  javis_enabled boolean default true,
  timezone text default 'America/Edmonton',
  notify_channels jsonb default '{}'
);

-- ---- billing -------------------------------------------------------------------------------
create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  plan text default 'enterprise_pilot',
  status text default 'active',
  current_period_start timestamptz default now(),
  current_period_end timestamptz default now() + interval '30 days',
  created_at timestamptz not null default now()
);

create table if not exists billing_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references billing_subscriptions(id) on delete cascade,
  total_cad numeric default 0,
  status text default 'paid',
  created_at timestamptz not null default now()
);

-- ---- SIR runtime + trace replay ---------------------------------------------------------------
create table if not exists sir_agents (
  id uuid primary key default gen_random_uuid(),
  name text,
  status text default 'active',
  created_at timestamptz not null default now()
);

create table if not exists sir_events (
  id uuid primary key default gen_random_uuid(),
  event_type text,
  payload jsonb default '{}',
  created_at timestamptz not null default now()
);

create table if not exists sir_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text,
  status text default 'queued',
  payload jsonb default '{}',
  created_at timestamptz not null default now()
);

create table if not exists trace_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  trace_data jsonb default '{}',
  tool_calls jsonb default '[]',
  costs jsonb default '[]',
  created_at timestamptz not null default now()
);

-- ---- RLS ---------------------------------------------------------------------------------------
do $$
declare
  t text;
  org_scoped text[] := array[
    'asset_classes','asset_locations','connectors','oee_measurements','oee_loss_events',
    'kpi_measurements','maintenance_metrics','asset_health_monitoring','system_alerts',
    'notifications','autonomous_decisions','audit_events','asset_snapshots',
    'backlog_snapshots','deployment_instances','billing_subscriptions'
  ];
  authed text[] := array[
    'connector_runs','work_order_tasks','work_order_status_history','kpi_definitions',
    'kpis_kois','user_kpi_dashboard','autonomous_actions','approval_workflows',
    'research_programs','research_runs','research_results','promotion_candidates',
    'deployment_templates','tenants','tenant_settings','user_preferences',
    'billing_invoices','sir_agents','sir_events','sir_queue','trace_snapshots'
  ];
begin
  foreach t in array org_scoped loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (organization_id is null or organization_id = app_current_org()) with check (organization_id is null or organization_id = app_current_org())',
      t || '_org_rw', t
    );
  end loop;
  foreach t in array authed loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_authed_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_authed_rw', t
    );
  end loop;
end $$;
